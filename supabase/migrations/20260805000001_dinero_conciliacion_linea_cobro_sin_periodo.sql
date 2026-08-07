-- =============================================================================
-- dinero · bandeja de excepciones: tipo `linea_cobro_sin_periodo`
-- =============================================================================
-- CONTEXTO (hallado el 2026-08-05 ejecutando N-E2E-1 contra el stack vivo):
--
-- El job C1 (`generar-lineas`) ordena sus pasos así:
--   3. `generar-linea-cobro`     ← inserta la línea
--   4. `asignar-periodo-cobro`   ← le cuelga el período
--
-- `obtenerOCrearPeriodoCobroAbierto` lanza a propósito si el período destino ya
-- está `cerrado`/`facturado`, para no misfilar líneas en un período que ya se
-- facturó. La guarda es correcta. El problema es lo que queda detrás: Inngest
-- memoiza los pasos completados, así que el paso 3 NO se revierte y la línea
-- queda con `periodo_cobro_id = NULL` para siempre. El paso 7
-- (`actualizar-flags-pedido`) nunca corre, así que el pedido además aparece como
-- si jamás hubiera generado cobro.
--
-- Resultado: un cobro real que no está en ninguna factura y que nadie ve. No lo
-- caza ningún detector — `esLineaCobroHuerfana` mira el ESTADO DEL PEDIDO, y
-- excluye `fallido` a propósito para no dar falsos positivos, que es justo el
-- estado del caso típico (entrega fallida con incidencia que sí cobra, cuyo
-- evento llega después del cierre del período).
--
-- Esta migración NO cambia el comportamiento del motor: solo habilita que el
-- caso sea VISIBLE en la bandeja. Qué hacer con esas líneas —no crearlas,
-- reasignarlas al siguiente período abierto, o resolverlas a mano— es una
-- decisión de negocio pendiente; hacerlas visibles no la prejuzga.
--
-- Clasificación: `fuga_ingreso` (es ingreso que se pierde, no un dato feo) con
-- acción sugerida `reasignar_lineas_a_periodo`, ambos valores ya existentes en
-- sus CHECK respectivos. SLA de esa categoría: 3 días.
--
-- Idempotente: DROP CONSTRAINT IF EXISTS + ADD dentro de un DO-block guardado
-- por la existencia de la tabla. Mismo mecanismo que las migraciones 0001, 0037
-- y 0038.
-- =============================================================================

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'dinero' and table_name = 'eventos_conciliacion'
  ) then
    alter table dinero.eventos_conciliacion
      drop constraint if exists eventos_conciliacion_tipo_valido;

    alter table dinero.eventos_conciliacion
      add constraint eventos_conciliacion_tipo_valido
      check (tipo_diferencia in (
        -- 6 originales (C6 · 2 fuentes)
        'pedido_entregado_sin_linea_cobro',
        'pedido_entregado_sin_linea_liquidacion',
        'linea_cobro_sin_pedido_entregado',
        'folio_consumido_sin_dte_persistido',
        'periodo_cerrado_con_lineas_sueltas',
        'monto_dte_difiere_de_lineas',
        -- 6 de C7 (F17 · 3 fuentes)
        'pagado_conductor_sin_cobro_seller',
        'cobrado_seller_no_pagado_conductor',
        'reprogramacion_no_cobrada',
        'minimo_omitido',
        'pago_seller_faltante',
        'pago_conductor_faltante',
        -- webhook payout (0037)
        'payout_revertido_post_confirmacion',
        -- estado_externo no reconocido (0038)
        'payout_estado_no_reconocido',
        -- NUEVO: línea de cobro activa que quedó sin período por un fallo del
        -- paso `asignar-periodo-cobro` de C1. Nunca se facturará si nadie la
        -- reasigna.
        'linea_cobro_sin_periodo'
      ));
  end if;
end $$;

comment on constraint eventos_conciliacion_tipo_valido on dinero.eventos_conciliacion is
  'Tipos de diferencia válidos de la bandeja de excepciones (15). Espejo de '
  'TipoDiferenciaConciliacion en src/modules/dinero/tipos.ts — si cambia uno, cambia el otro.';
