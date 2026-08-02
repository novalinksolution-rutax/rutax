-- =============================================================================
-- Migración 0038 (ts 20260709000001) · Dinero — Separar "estado externo de payout
-- no reconocido" de la reversión genuina en la bandeja de excepciones
-- =============================================================================
-- Recomendación de QA sobre la feature del webhook de payout Fintoc (migración
-- 0037 · 20260708000002). Ahí, 'payout_revertido_post_confirmacion' se estaba
-- reusando para DOS casos semánticamente distintos:
--
--   1) Reversión financiera GENUINA: un payout ya confirmado que el proveedor
--      revirtió (transfer.outbound.returned/failed post-confirmación). La
--      liquidación vuelve a 'emitida' → ES, de nuevo, un pago a conductor
--      pendiente. Categoría 'pagos_pendientes' + acción 'gestionar_pago_conductor'.
--      ESTE CASO SE QUEDA IGUAL (no se toca).
--
--   2) Un estado_externo de Fintoc NO reconocido (status nuevo/inesperado). NO es
--      un pago pendiente: requiere revisión humana del estado raro. Decirle al
--      dueño "gestiona el pago al conductor" es engañoso.
--
-- Esta migración separa el caso 2 con su propio tipo_diferencia y su propia acción
-- sugerida, reutilizando la categoría existente 'integridad_datos' (SLA 7 días):
--
--   · nuevo tipo_diferencia  'payout_estado_no_reconocido'
--   · nueva accion_sugerida  'revisar_estado_externo'
--   · categoría              'integridad_datos'  (YA existe — NO se duplica)
--
-- Alcance: SOLO esquema (CHECK constraints de dinero.eventos_conciliacion). No
-- toca src/modules/dinero/*.ts — el cableado del mapeo tipo→categoría/acción del
-- NUEVO valor (payout_estado_no_reconocido → integridad_datos / revisar_estado_externo)
-- es responsabilidad de la capa de aplicación (conciliacion-clasificacion.ts +
-- tipos.ts), fase backend siguiente. Ese archivo declara "mismo dato, dos
-- lenguajes; si cambian aquí, cambian también allá": esta migración NO contradice
-- ese contrato — solo AMPLÍA el conjunto de valores permitidos; el backfill del
-- mapeo del valor nuevo lo cierra backend (no hay filas productivas del caso 2 mal
-- clasificadas: la feature es nueva y en local se regenera con `db reset`).
--
-- NO se toca 'payout_revertido_post_confirmacion' (caso 1) ni el enum SQL
-- dinero.tipo_diferencia_conciliacion (la columna eventos_conciliacion.tipo_diferencia
-- es text + CHECK, no el tipo enum directo; el detector C7 del caso 2 escribe el
-- literal text — no requiere ADD VALUE al enum). NO se agrega categoría nueva.
--
-- Idempotente: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT dentro de un DO-block
-- guardado por la existencia de la tabla. Re-aplicable sobre base ya migrada.
-- Mismo mecanismo de reemplazo de CHECK que las migraciones 0001 y 0037.
-- =============================================================================

-- =============================================================================
-- 1. tipo_diferencia: reemplazar el CHECK con la lista completa (13 previos de la
--    migración 0037 + 1 nuevo). La columna es text + CHECK, así que hay que
--    reponer la lista entera. Drop/add idempotente.
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
        -- webhook payout (0037): confirmado y luego revertido por el proveedor
        -- (reversión GENUINA → pago a conductor pendiente). SE CONSERVA.
        'payout_revertido_post_confirmacion',
        -- NUEVO (0038): estado_externo de Fintoc no reconocido (status raro/nuevo)
        -- → NO es un pago pendiente; requiere revisión humana del estado externo.
        'payout_estado_no_reconocido'
      ));
  end if;
end $$;

-- =============================================================================
-- 2. accion_sugerida: reemplazar el CHECK con la lista completa (11 previas de la
--    migración 0001 + 1 nueva). Se conservan TODAS las acciones existentes.
--    Drop/add idempotente.
-- =============================================================================
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'dinero' and table_name = 'eventos_conciliacion'
  ) then
    alter table dinero.eventos_conciliacion
      drop constraint if exists eventos_conciliacion_accion_valida;

    alter table dinero.eventos_conciliacion
      add constraint eventos_conciliacion_accion_valida
      check (accion_sugerida in (
        'revisar_tarifa_aplicada',
        'confirmar_con_seller',
        'confirmar_con_conductor',
        'generar_cobro_manual',
        'generar_ajuste_liquidacion',
        'reasignar_lineas_a_periodo',
        'reenviar_o_verificar_dte',
        'gestionar_cobranza_seller',
        'gestionar_pago_conductor',
        'marcar_error_del_motor',
        'sin_accion_requerida',
        -- NUEVO (0038): revisar un estado externo de payout no reconocido. NO le
        -- dice al dueño "gestiona el pago al conductor" (eso sería engañoso para
        -- el caso 2); le pide revisar el status externo inesperado.
        'revisar_estado_externo'
      ));
  end if;
end $$;

-- =============================================================================
-- 3. categoria_negocio: NO se toca. El caso 2 usa la categoría EXISTENTE
--    'integridad_datos' (SLA 7 días, ya definida en el CHECK
--    eventos_conciliacion_categoria_valida de la migración 0001). Verificación
--    defensiva: si por alguna razón 'integridad_datos' NO estuviera en el CHECK,
--    abortamos con un error claro en vez de dejar el esquema inconsistente. Esto
--    NO altera el constraint (no lo dropea ni lo recrea) — solo lo inspecciona.
-- =============================================================================
do $$
declare
  v_def text;
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'dinero' and table_name = 'eventos_conciliacion'
  ) then
    select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'dinero'
      and t.relname = 'eventos_conciliacion'
      and c.conname = 'eventos_conciliacion_categoria_valida';

    if v_def is null then
      raise exception
        'eventos_conciliacion_categoria_valida no existe: la migración 0001 (bandeja de excepciones) debe correr antes que 0038.';
    end if;

    if position('integridad_datos' in v_def) = 0 then
      raise exception
        'La categoría integridad_datos no está en eventos_conciliacion_categoria_valida; el caso payout_estado_no_reconocido la necesita.';
    end if;
  end if;
end $$;

-- =============================================================================
-- 4. Handoff a la fase backend (NO se implementa aquí — solo se documenta):
--    src/modules/dinero/tipos.ts
--      · TipoDiferenciaConciliacion   += 'payout_estado_no_reconocido'
--      · AccionSugeridaConciliacion   += 'revisar_estado_externo'
--    src/modules/dinero/conciliacion-clasificacion.ts (espejo del backfill SQL)
--      · CATEGORIA_POR_TIPO['payout_estado_no_reconocido'] = 'integridad_datos'
--      · ACCION_POR_TIPO['payout_estado_no_reconocido']    = 'revisar_estado_externo'
--    El detector del webhook (backend) debe emitir 'payout_estado_no_reconocido'
--    (no 'payout_revertido_post_confirmacion') cuando el estado_externo de Fintoc
--    cae en 'desconocido' (status no mapeado), separando el caso 2 del caso 1.
-- =============================================================================
