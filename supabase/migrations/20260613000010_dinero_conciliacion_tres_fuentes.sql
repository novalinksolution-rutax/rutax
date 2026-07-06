-- =============================================================================
-- Migración 0013 (ts 20260613000010) · Dinero — F17 Conciliación de 3 fuentes
-- =============================================================================
-- Bloque 3. Amplía el motor de conciliación para cruzar TRES fuentes:
--   (1) líneas de cobro al seller, (2) líneas de liquidación al conductor y
--   (3) la rate card (mínimos y recargos pactados). El job C7 (backend) usará
--   estos tipos/columnas para detectar fugas directas (pagado al conductor sin
--   cobro al seller), faltas de cobro de recargos/mínimos, y pagos faltantes.
--
-- Cambios:
--   1. Amplía el enum dinero.tipo_diferencia_conciliacion con 6 tipos nuevos.
--   2. Reemplaza idempotente el CHECK de dinero.eventos_conciliacion.tipo_diferencia
--      con la lista completa (la columna usa text + CHECK, no el tipo enum directo).
--   3. Añade columnas driver_id y liquidacion_id a eventos_conciliacion + índices.
--   4. Re-emite la vista public.eventos_conciliacion (select *) para exponer las
--      columnas nuevas. RLS NO cambia (solo dueno/administracion; seller y
--      conductor jamás acceden).
--   5. Añade columnas de rate card a identidad.tarifas (mínimos y recargo de
--      reprogramación) — nullable, sin romper datos existentes. Prerrequisito de
--      los detectores 'minimo_omitido' y 'reprogramacion_no_cobrada'.
--
-- Idempotente: DO-blocks, ADD COLUMN IF NOT EXISTS, DROP/ADD CONSTRAINT IF EXISTS,
-- CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE VIEW. Re-aplicable sobre base ya
-- migrada.
--
-- NO toca: la lógica de C6 (eso es backend), el RLS de conciliación, ni los
-- datos/RLS existentes de tarifas (solo agrega columnas opcionales).
-- =============================================================================

-- =============================================================================
-- 1. Ampliar el enum dinero.tipo_diferencia_conciliacion
--    Postgres no soporta IF NOT EXISTS en ADD VALUE antes de PG12; usamos
--    el guard de PG12+ `add value if not exists`. ALTER TYPE ADD VALUE no
--    puede correr dentro de un bloque transaccional junto a su uso, pero sí
--    como sentencias sueltas en la migración (cada una autocommit en Supabase
--    CLI). Se ejecutan ANTES de cualquier uso del nuevo valor.
-- =============================================================================
do $$
begin
  -- Solo intenta si el tipo existe (la base de dinero pudo no haberse migrado
  -- aún en un entorno limpio raro; en la práctica 0006 ya lo creó).
  if exists (select 1 from pg_type where typname = 'tipo_diferencia_conciliacion') then
    alter type dinero.tipo_diferencia_conciliacion add value if not exists 'pagado_conductor_sin_cobro_seller';
    alter type dinero.tipo_diferencia_conciliacion add value if not exists 'cobrado_seller_no_pagado_conductor';
    alter type dinero.tipo_diferencia_conciliacion add value if not exists 'reprogramacion_no_cobrada';
    alter type dinero.tipo_diferencia_conciliacion add value if not exists 'minimo_omitido';
    alter type dinero.tipo_diferencia_conciliacion add value if not exists 'pago_seller_faltante';
    alter type dinero.tipo_diferencia_conciliacion add value if not exists 'pago_conductor_faltante';
  end if;
end $$;

-- =============================================================================
-- 2. Reemplazar el CHECK de eventos_conciliacion.tipo_diferencia
--    La columna usa `text` + CHECK constraint (no el tipo enum directamente),
--    así que el enum ampliado por sí solo no habilita los nuevos valores en la
--    tabla. Reemplazamos el CHECK con la lista completa (6 originales + 6 nuevos).
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
        -- 6 originales (C6) — conservados.
        'pedido_entregado_sin_linea_cobro',
        'pedido_entregado_sin_linea_liquidacion',
        'linea_cobro_sin_pedido_entregado',
        'folio_consumido_sin_dte_persistido',
        'periodo_cerrado_con_lineas_sueltas',
        'monto_dte_difiere_de_lineas',
        -- 6 nuevos (C7 · conciliación de 3 fuentes).
        'pagado_conductor_sin_cobro_seller',
        'cobrado_seller_no_pagado_conductor',
        'reprogramacion_no_cobrada',
        'minimo_omitido',
        'pago_seller_faltante',
        'pago_conductor_faltante'
      ));
  end if;
end $$;

-- =============================================================================
-- 3. Columnas nuevas en dinero.eventos_conciliacion
--    Las discrepancias de la fuente 3 (liquidación al conductor) apuntan a un
--    conductor y/o a la liquidación afectada. Ambas nullable (no toda
--    discrepancia tiene conductor: p.ej. minimo_omitido es a nivel seller).
-- =============================================================================
alter table dinero.eventos_conciliacion
  add column if not exists driver_id uuid
    references identidad.conductores(id) on delete restrict;

alter table dinero.eventos_conciliacion
  add column if not exists liquidacion_id uuid
    references dinero.liquidaciones(id) on delete restrict;

comment on column dinero.eventos_conciliacion.driver_id is
  'Conductor afectado por la discrepancia (fuente 3 · liquidación). Nullable:
   discrepancias a nivel seller (p.ej. minimo_omitido) no lo llevan.';

comment on column dinero.eventos_conciliacion.liquidacion_id is
  'Liquidación afectada por la discrepancia. Nullable: muchas discrepancias se
   detectan antes de existir la liquidación (a nivel pedido/línea).';

-- Índices parciales (solo filas donde la columna no es null — la mayoría de
-- eventos no llevan estas referencias).
create index if not exists idx_conciliacion_tenant_driver
  on dinero.eventos_conciliacion (tenant_id, driver_id)
  where driver_id is not null;

create index if not exists idx_conciliacion_tenant_liquidacion
  on dinero.eventos_conciliacion (tenant_id, liquidacion_id)
  where liquidacion_id is not null;

-- =============================================================================
-- 4. Re-emitir la vista public.eventos_conciliacion
--    Es `select *`: las columnas nuevas no aparecen hasta re-crearla. RLS NO
--    cambia — la vista es security_invoker=true y hereda la política base
--    (solo dueno/administracion del tenant; seller y conductor jamás).
-- =============================================================================
create or replace view public.eventos_conciliacion
  with (security_invoker = true)
  as select * from dinero.eventos_conciliacion;

comment on view public.eventos_conciliacion is
  'Espejo de dinero.eventos_conciliacion para PostgREST. RLS heredada: P1 + solo
   roles internos dueno/administracion. Sellers y conductores no acceden.
   Incluye driver_id y liquidacion_id (F17 · conciliación de 3 fuentes).';

-- Re-asegurar grants/revokes (CREATE OR REPLACE VIEW conserva privilegios, pero
-- los repetimos por idempotencia/defensa en profundidad — coherente con 0006).
grant select on public.eventos_conciliacion to authenticated;
revoke insert, update, delete on public.eventos_conciliacion from authenticated, anon;

-- =============================================================================
-- 5. Rate card: columnas de mínimos y recargo de reprogramación en tarifas
--    PRERREQUISITO de los detectores 'minimo_omitido' y 'reprogramacion_no_cobrada'.
--    identidad.tarifas hoy solo modela el monto base por entrega (monto_clp) y el
--    monto al conductor (monto_conductor_clp). No expresa mínimos ni recargos.
--    Se agregan como columnas opcionales (nullable) — NO rompen datos existentes
--    ni la RLS solo-interna de tarifas (P1, sin P2: el seller jamás las ve).
--
--    Semántica (la consume el backend en C7):
--      - minimo_retiro_clp: monto mínimo a cobrar por un retiro/visita, aunque la
--        tarifa por entrega resulte menor. NULL = sin mínimo pactado.
--      - minimo_facturacion_clp: piso de facturación del período para el seller.
--        NULL = sin mínimo de facturación pactado.
--      - recargo_reprogramacion_clp: monto a cobrar por cada reprogramación de
--        entrega. NULL = no se cobra recargo por reprogramación.
-- =============================================================================
alter table identidad.tarifas
  add column if not exists minimo_retiro_clp numeric(12,0)
    constraint tarifas_minimo_retiro_no_negativo
      check (minimo_retiro_clp is null or minimo_retiro_clp >= 0);

alter table identidad.tarifas
  add column if not exists minimo_facturacion_clp numeric(12,0)
    constraint tarifas_minimo_facturacion_no_negativo
      check (minimo_facturacion_clp is null or minimo_facturacion_clp >= 0);

alter table identidad.tarifas
  add column if not exists recargo_reprogramacion_clp numeric(12,0)
    constraint tarifas_recargo_reprogramacion_no_negativo
      check (recargo_reprogramacion_clp is null or recargo_reprogramacion_clp >= 0);

comment on column identidad.tarifas.minimo_retiro_clp is
  'Mínimo a cobrar por retiro/visita (F17). NULL = sin mínimo. Dato interno: el
   seller no lo ve (RLS P1 solo-interna heredada).';
comment on column identidad.tarifas.minimo_facturacion_clp is
  'Piso de facturación del período para el seller (F17). NULL = sin mínimo.';
comment on column identidad.tarifas.recargo_reprogramacion_clp is
  'Recargo por reprogramación de entrega (F17). NULL = no se cobra.';

-- Re-emitir la vista public.tarifas (select *) para exponer las columnas nuevas
-- a la capa de aplicación interna. RLS solo-interna heredada (security_invoker).
create or replace view public.tarifas
  with (security_invoker = true)
  as select * from identidad.tarifas;

-- CREATE OR REPLACE VIEW conserva privilegios; los repetimos por idempotencia.
grant select, insert, update on public.tarifas to authenticated;
