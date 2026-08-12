-- =============================================================================
-- dinero · bandeja de excepciones: tipo `liquidacion_atribuida_a_conductor_incorrecto`
-- =============================================================================
-- CONTEXTO (bug real detectado en revisión de código, 2026-08-12):
--
-- El job C1 (`generar-lineas.ts`, paso `generar-linea-liquidacion`) inserta una
-- línea de liquidación con `ON CONFLICT (pedido_id) DO NOTHING`. Cuando el
-- INSERT choca porque YA existe una línea para ese pedido, el código leía la
-- fila existente y la devolvía tal cual si estaba activa (`anulada = false`) —
-- sin comparar su `driver_id` contra el conductor que trae el evento actual.
--
-- Camino real: un pedido llega a `fallido` con una incidencia que
-- `afecta_liquidacion` → se genera línea de liquidación a nombre del conductor
-- A (compensación por el intento). El pedido se reasigna al conductor B, que
-- termina entregándolo. El evento de `entregado` vuelve a intentar generar la
-- línea, choca con el UNIQUE(pedido_id), y sin este fix la línea existente —
-- todavía a nombre de A — quedaba tal cual: "B entrega, A cobra".
--
-- El fix (`generar-lineas.ts`) SÍ re-atribuye la línea al conductor correcto,
-- pero SOLO si la liquidación de origen sigue en `borrador` (misma doctrina que
-- la anulación pre-cierre del propio archivo: `emitida`/`pagada` son
-- inmutables, la compuerta humana manda). Cuando la liquidación de origen ya
-- no es mutable, el job NO muta nada y deja esta excepción visible en la
-- bandeja para que el dueño/administración resuelva a mano (bono al conductor
-- que entregó, penalización al que no, vía `ajustarLiquidacion` — F16).
--
-- Clasificación: `pagos_pendientes` (concierne directamente a qué conductor
-- cobra por una entrega — mismo terreno que `pago_conductor_faltante` y
-- `payout_revertido_post_confirmacion`) con acción sugerida
-- `generar_ajuste_liquidacion` (el remedio real: bono/penalización manual).
-- SLA de esa categoría: 5 días.
--
-- Idempotente: DROP CONSTRAINT IF EXISTS + ADD dentro de un DO-block guardado
-- por la existencia de la tabla. Mismo mecanismo que las migraciones 0001,
-- 0037, 0038 y 20260805000001.
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
        -- línea de cobro sin período (20260805000001)
        'linea_cobro_sin_periodo',
        -- NUEVO: línea de liquidación activa que quedó atribuida al conductor
        -- equivocado tras una reasignación (C1 no pudo re-atribuirla porque su
        -- liquidación de origen ya no es mutable). "Pedro entrega, Juan cobra".
        'liquidacion_atribuida_a_conductor_incorrecto'
      ));
  end if;
end $$;

comment on constraint eventos_conciliacion_tipo_valido on dinero.eventos_conciliacion is
  'Tipos de diferencia válidos de la bandeja de excepciones (16). Espejo de '
  'TipoDiferenciaConciliacion en src/modules/dinero/tipos.ts — si cambia uno, cambia el otro.';
