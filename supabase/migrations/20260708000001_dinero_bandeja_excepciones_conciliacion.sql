-- =============================================================================
-- Migración 0036 (ts 20260708000001) · Dinero — Bandeja de excepciones (§1.1 P1)
-- =============================================================================
-- Auditoría jul 2026 §1.1 P1. Eleva dinero.eventos_conciliacion de "log
-- append-only de 4 estados" a BANDEJA DE EXCEPCIONES GESTIONABLE:
--   · 8 estados de ciclo de vida (antes 4), con RENAME de los datos existentes.
--   · categorización de negocio (categoria_negocio) + acción sugerida.
--   · asignación (a quién, por quién, cuándo) + SLA (fecha_limite).
--   · bloqueo de acciones financieras (bloquea_facturacion / bloquea_pago) con
--     motivo obligatorio cuando hay bloqueo.
--   · fuentes comparadas (jsonb) para trazabilidad del detector.
--   · actualizado_en + trigger (la tabla deja de ser append-only: ahora es
--     estado mutable gestionable).
--   · nueva tabla dinero.eventos_conciliacion_historial (bitácora de cambios de
--     cada excepción), append-only, con RLS enable+force propia.
--
-- Contrato de aislamiento (NO se relaja): eventos_conciliacion y su historial
-- siguen siendo P1 estricta solo-interno dueno/administracion. Sellers y
-- conductores JAMÁS ven una fila; internos con otros roles tampoco. force row
-- level security en ambas tablas. Escritura exclusiva de service_role.
--
-- Modelo de datos fijado por `arquitecto` (diseño + reconciliación con ux-ui).
-- Aquí solo se implementa en SQL. No toca src/modules/dinero/*.ts (eso es
-- `backend`, fase siguiente).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS, DROP/ADD CONSTRAINT IF EXISTS,
-- UPDATE guardados por predicado, CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE
-- VIEW, CREATE TABLE IF NOT EXISTS, DROP TRIGGER/POLICY IF EXISTS. Re-aplicable.
--
-- La columna estado sigue siendo `text` + CHECK (NO se migra al enum SQL
-- dinero.estado_evento_conciliacion — cambio de tipo innecesario y más
-- arriesgado). El backfill del RENAME toca solo filas con valores viejos.
-- =============================================================================

-- =============================================================================
-- 1. Columnas nuevas en dinero.eventos_conciliacion
--    Se agregan primero (nullable / con default) para poder hacer el backfill
--    antes de imponer NOT NULL. Los CHECK se añaden en la sección 2 (drop/add
--    idempotente). Las FK a auth.users van inline (ADD COLUMN IF NOT EXISTS es
--    atómico con la columna, así que no se duplican al re-ejecutar).
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'dinero' and table_name = 'eventos_conciliacion'
  ) then
    raise notice 'dinero.eventos_conciliacion no existe; se omite la migración de bandeja de excepciones.';
    return;
  end if;

  -- categoria_negocio: nullable ahora; NOT NULL tras backfill (sección 4).
  alter table dinero.eventos_conciliacion
    add column if not exists categoria_negocio text;

  -- accion_sugerida: NOT NULL con default seguro desde el inicio (el backfill
  -- refina el valor por tipo_diferencia).
  alter table dinero.eventos_conciliacion
    add column if not exists accion_sugerida text not null default 'sin_accion_requerida';

  -- Asignación.
  alter table dinero.eventos_conciliacion
    add column if not exists asignado_a_usuario_id uuid
      references auth.users (id) on delete set null;
  alter table dinero.eventos_conciliacion
    add column if not exists asignado_en timestamptz;
  alter table dinero.eventos_conciliacion
    add column if not exists asignado_por_usuario_id uuid
      references auth.users (id) on delete set null;

  -- SLA.
  alter table dinero.eventos_conciliacion
    add column if not exists fecha_limite date;

  -- Bloqueo de acciones financieras.
  alter table dinero.eventos_conciliacion
    add column if not exists bloquea_facturacion boolean not null default false;
  alter table dinero.eventos_conciliacion
    add column if not exists bloquea_pago boolean not null default false;
  alter table dinero.eventos_conciliacion
    add column if not exists motivo_bloqueo text;

  -- Fuentes comparadas por el detector (trazabilidad del hallazgo).
  alter table dinero.eventos_conciliacion
    add column if not exists fuentes_comparadas jsonb;

  -- Timestamp de modificación (la tabla deja de ser append-only).
  alter table dinero.eventos_conciliacion
    add column if not exists actualizado_en timestamptz not null default now();
end $$;

comment on column dinero.eventos_conciliacion.categoria_negocio is
  'Categoría de negocio de la excepción: cumplimiento_dte | fuga_ingreso |
   pagos_pendientes | integridad_datos. Deriva de tipo_diferencia (ver backfill).';
comment on column dinero.eventos_conciliacion.accion_sugerida is
  'Acción recomendada al operador para resolver la excepción. Default
   sin_accion_requerida. La resolución sigue siendo humana (nunca automática).';
comment on column dinero.eventos_conciliacion.asignado_a_usuario_id is
  'Usuario interno responsable de gestionar la excepción (auth.users). Null = sin asignar.';
comment on column dinero.eventos_conciliacion.asignado_por_usuario_id is
  'Usuario que hizo la asignación (auth.users). Null si nunca se asignó.';
comment on column dinero.eventos_conciliacion.fecha_limite is
  'SLA: fecha límite de resolución (zona America/Santiago). Null en estados
   terminales. El backfill la deriva de la categoría para las excepciones abiertas.';
comment on column dinero.eventos_conciliacion.bloquea_facturacion is
  'Si true, la excepción bloquea la emisión de facturas del período/seller
   afectado. Exige motivo_bloqueo (CHECK eventos_conciliacion_bloqueo_motivo).';
comment on column dinero.eventos_conciliacion.bloquea_pago is
  'Si true, la excepción bloquea el pago (payout) al conductor afectado. Exige
   motivo_bloqueo.';
comment on column dinero.eventos_conciliacion.motivo_bloqueo is
  'Justificación del bloqueo. Obligatorio (no vacío) cuando bloquea_facturacion o
   bloquea_pago es true.';
comment on column dinero.eventos_conciliacion.fuentes_comparadas is
  'jsonb con las fuentes/valores cruzados por el detector (trazabilidad). Solo
   dueno/administracion lo ve (RLS P1 estricta; sin exposición a seller/conductor).';
comment on column dinero.eventos_conciliacion.actualizado_en is
  'Última modificación de la excepción. La tabla dejó de ser append-only: el ciclo
   de vida de la excepción (estado, asignación, bloqueo) la muta.';

-- =============================================================================
-- 2. CHECK de las columnas nuevas + FK recomendada de resuelto_por_usuario_id
--    Patrón drop/add idempotente (igual que F17 con tipo_valido). Los CHECK
--    `in (...)` pasan sobre NULL, y los defaults elegidos ya satisfacen cada
--    constraint, así que añadirlos antes del backfill es seguro.
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'dinero' and table_name = 'eventos_conciliacion'
  ) then
    return;
  end if;

  -- categoria_negocio ∈ 4 categorías.
  alter table dinero.eventos_conciliacion
    drop constraint if exists eventos_conciliacion_categoria_valida;
  alter table dinero.eventos_conciliacion
    add constraint eventos_conciliacion_categoria_valida
      check (categoria_negocio in (
        'cumplimiento_dte',
        'fuga_ingreso',
        'pagos_pendientes',
        'integridad_datos'
      ));

  -- accion_sugerida ∈ 11 acciones.
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
        'sin_accion_requerida'
      ));

  -- Bloqueo con motivo obligatorio.
  alter table dinero.eventos_conciliacion
    drop constraint if exists eventos_conciliacion_bloqueo_motivo;
  alter table dinero.eventos_conciliacion
    add constraint eventos_conciliacion_bloqueo_motivo
      check (
        (bloquea_facturacion = false and bloquea_pago = false)
        or (motivo_bloqueo is not null and length(trim(motivo_bloqueo)) > 0)
      );

  -- FK recomendada (bajo riesgo): resuelto_por_usuario_id → auth.users. Hoy es
  -- un uuid suelto. NOT VALID: enforce en escrituras futuras sin re-escanear
  -- filas existentes (podrían referenciar un usuario ya eliminado — el ON DELETE
  -- SET NULL sigue activo para referencias válidas). Idempotente vía drop/add.
  alter table dinero.eventos_conciliacion
    drop constraint if exists eventos_conciliacion_resuelto_por_fk;
  alter table dinero.eventos_conciliacion
    add constraint eventos_conciliacion_resuelto_por_fk
      foreign key (resuelto_por_usuario_id) references auth.users (id)
      on delete set null not valid;
end $$;

comment on constraint eventos_conciliacion_resuelto_por_fk on dinero.eventos_conciliacion is
  'FK recomendada (§1.1): resuelto_por/cerrado_por → auth.users. Semántica: en el
   modelo de 8 estados, resuelto_en/resuelto_por significan "cerrado en / cerrado
   por" para cualquier estado terminal (resuelta_auto/resuelta_manual/
   aceptada_justificada/ignorada), no solo el viejo resuelto.';

-- =============================================================================
-- 3. Estado: reemplazo del CHECK a 8 valores + RENAME de datos existentes.
--    Orden estricto: (a) drop del CHECK viejo, (b) UPDATE de rename idempotente
--    (solo filas con valores viejos), (c) add del CHECK nuevo. El default de la
--    columna sigue siendo 'pendiente' (no se renombra).
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'dinero' and table_name = 'eventos_conciliacion'
  ) then
    return;
  end if;

  -- (a) Quitar el CHECK viejo (4 valores) para poder renombrar sin violarlo.
  alter table dinero.eventos_conciliacion
    drop constraint if exists eventos_conciliacion_estado_valido;

  -- (b) RENAME de los estados existentes (idempotente: solo toca valores viejos).
  update dinero.eventos_conciliacion set estado = case estado
    when 'revisado' then 'en_analisis'
    when 'resuelto' then 'resuelta_manual'
    when 'ignorado' then 'ignorada'
    else estado end
  where estado in ('revisado', 'resuelto', 'ignorado');

  -- (c) CHECK nuevo (8 valores). 'pendiente' se conserva sin renombrar.
  alter table dinero.eventos_conciliacion
    add constraint eventos_conciliacion_estado_valido
      check (estado in (
        'pendiente',
        'en_analisis',
        'esperando_info',
        'requiere_ajuste',
        'resuelta_auto',
        'resuelta_manual',
        'aceptada_justificada',
        'ignorada'
      ));
end $$;

-- =============================================================================
-- 4. Backfill (en orden) — ANTES de imponer NOT NULL sobre categoria_negocio.
--    categoria_negocio + accion_sugerida se derivan de tipo_diferencia; la
--    fecha_limite (SLA) solo se pone en excepciones ABIERTAS (no terminales).
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'dinero' and table_name = 'eventos_conciliacion'
  ) then
    return;
  end if;

  -- 4.1 categoría + acción sugerida por tipo de diferencia (solo filas sin
  --     categoría → idempotente; en re-ejecución categoria_negocio ya es NOT NULL).
  update dinero.eventos_conciliacion set
    categoria_negocio = case tipo_diferencia
      when 'folio_consumido_sin_dte_persistido'   then 'cumplimiento_dte'
      when 'monto_dte_difiere_de_lineas'          then 'cumplimiento_dte'
      when 'pagado_conductor_sin_cobro_seller'    then 'fuga_ingreso'
      when 'reprogramacion_no_cobrada'            then 'fuga_ingreso'
      when 'minimo_omitido'                       then 'fuga_ingreso'
      when 'pago_seller_faltante'                 then 'pagos_pendientes'
      when 'pago_conductor_faltante'              then 'pagos_pendientes'
      else 'integridad_datos' end,
    accion_sugerida = case tipo_diferencia
      when 'pedido_entregado_sin_linea_cobro'        then 'generar_cobro_manual'
      when 'pedido_entregado_sin_linea_liquidacion'  then 'generar_ajuste_liquidacion'
      when 'linea_cobro_sin_pedido_entregado'        then 'marcar_error_del_motor'
      when 'folio_consumido_sin_dte_persistido'      then 'reenviar_o_verificar_dte'
      when 'periodo_cerrado_con_lineas_sueltas'      then 'reasignar_lineas_a_periodo'
      when 'monto_dte_difiere_de_lineas'             then 'reenviar_o_verificar_dte'
      when 'pagado_conductor_sin_cobro_seller'       then 'generar_cobro_manual'
      when 'cobrado_seller_no_pagado_conductor'      then 'generar_ajuste_liquidacion'
      when 'reprogramacion_no_cobrada'               then 'generar_cobro_manual'
      when 'minimo_omitido'                          then 'confirmar_con_seller'
      when 'pago_seller_faltante'                    then 'gestionar_cobranza_seller'
      when 'pago_conductor_faltante'                 then 'gestionar_pago_conductor'
      else 'sin_accion_requerida' end
  where categoria_negocio is null;

  -- 4.2 fecha_limite (SLA) solo para excepciones ABIERTAS (no terminales).
  --     Terminal = resuelta_auto/resuelta_manual/aceptada_justificada/ignorada → NULL.
  update dinero.eventos_conciliacion set
    fecha_limite = (creado_en at time zone 'America/Santiago')::date + (case categoria_negocio
      when 'cumplimiento_dte'   then 2
      when 'fuga_ingreso'       then 3
      when 'pagos_pendientes'   then 5
      else 7 end)
  where fecha_limite is null
    and estado in ('pendiente', 'en_analisis', 'esperando_info', 'requiere_ajuste');

  -- 4.3 Ahora que toda fila tiene categoría, imponer NOT NULL.
  alter table dinero.eventos_conciliacion
    alter column categoria_negocio set not null;
end $$;

-- =============================================================================
-- 5. Índices nuevos (D).
-- =============================================================================
create index if not exists idx_conciliacion_tenant_categoria
  on dinero.eventos_conciliacion (tenant_id, categoria_negocio);

create index if not exists idx_conciliacion_tenant_asignado
  on dinero.eventos_conciliacion (tenant_id, asignado_a_usuario_id)
  where asignado_a_usuario_id is not null;

create index if not exists idx_conciliacion_bloqueo_activo
  on dinero.eventos_conciliacion (tenant_id)
  where bloquea_facturacion or bloquea_pago;

-- =============================================================================
-- 6. Trigger actualizado_en (reutiliza identidad.set_actualizado_en(), como el
--    resto del schema — NO se crea función nueva).
-- =============================================================================
drop trigger if exists trg_eventos_conc_actualizado_en on dinero.eventos_conciliacion;
create trigger trg_eventos_conc_actualizado_en
  before update on dinero.eventos_conciliacion
  for each row execute function identidad.set_actualizado_en();

-- =============================================================================
-- 7. Re-emitir la vista public.eventos_conciliacion (select *) para exponer las
--    columnas nuevas. RLS NO cambia (security_invoker hereda la política base:
--    P1 + solo dueno/administracion; seller y conductor jamás). Re-aplicar
--    grants/revokes por idempotencia (patrón F17).
-- =============================================================================
create or replace view public.eventos_conciliacion
  with (security_invoker = true)
  as select * from dinero.eventos_conciliacion;

comment on view public.eventos_conciliacion is
  'Espejo de dinero.eventos_conciliacion para PostgREST. Bandeja de excepciones
   gestionable (ya NO append-only): 8 estados, categoría de negocio, asignación,
   SLA (fecha_limite) y bloqueo de acciones financieras. RLS heredada: P1 + solo
   roles internos dueno/administracion. Sellers y conductores no acceden jamás.';

grant select on public.eventos_conciliacion to authenticated;
revoke insert, update, delete on public.eventos_conciliacion from authenticated, anon;

-- Actualizar también el comment de la tabla base (ya no es append-only).
comment on table dinero.eventos_conciliacion is
  'Bandeja de excepciones de conciliación (§1.1). Estado mutable gestionable
   (8 estados, categoría, asignación, SLA, bloqueo de facturación/pago con motivo).
   Cada cambio se bitácora en dinero.eventos_conciliacion_historial. RLS P1 +
   solo dueno/administracion; seller y conductor jamás. Escritura: solo service_role.';

-- =============================================================================
-- 8. Nueva tabla dinero.eventos_conciliacion_historial — bitácora de cambios de
--    cada excepción (append-only). RLS enable+force propia (misma P1 estricta).
-- =============================================================================
create table if not exists dinero.eventos_conciliacion_historial (
  id               uuid primary key default gen_random_uuid(),

  -- P1
  tenant_id        uuid not null references identidad.tenants (id) on delete restrict,

  evento_id        uuid not null
                     references dinero.eventos_conciliacion (id) on delete cascade,

  tipo_cambio      text not null
    constraint eventos_conc_hist_tipo_valido
      check (tipo_cambio in (
        'deteccion',
        'cambio_estado',
        'asignacion',
        'fecha_limite',
        'bloqueo',
        'accion_sugerida',
        'comentario'
      )),

  estado_anterior  text,
  estado_nuevo     text,
  comentario       text,
  datos            jsonb not null default '{}'::jsonb,

  actor_usuario_id uuid references auth.users (id) on delete set null,
  actor_tipo       text not null default 'usuario'
    constraint eventos_conc_hist_actor_valido
      check (actor_tipo in ('usuario', 'sistema')),

  creado_en        timestamptz not null default now()
  -- Append-only: sin actualizado_en. Las entradas de historial no se modifican.
);

comment on table dinero.eventos_conciliacion_historial is
  'Bitácora append-only de cambios de cada excepción de conciliación (§1.1):
   detección, cambios de estado/asignación/SLA/bloqueo, acción sugerida y
   comentarios. RLS P1 + solo dueno/administracion; seller y conductor jamás.
   Escritura: solo service_role.';

create index if not exists idx_conc_hist_evento
  on dinero.eventos_conciliacion_historial (evento_id, creado_en);

create index if not exists idx_conc_hist_tenant
  on dinero.eventos_conciliacion_historial (tenant_id);

-- 8.1 RLS enable + force (el meta-test rls_cobertura_meta exige ambas).
alter table dinero.eventos_conciliacion_historial enable row level security;
alter table dinero.eventos_conciliacion_historial force row level security;

drop policy if exists eventos_conc_hist_select on dinero.eventos_conciliacion_historial;
create policy eventos_conc_hist_select
  on dinero.eventos_conciliacion_historial
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
    and identidad.claim_rol() in ('dueno', 'administracion')
  );

-- 8.2 Vista espejo en public (security_invoker → hereda la RLS de la tabla base).
create or replace view public.eventos_conciliacion_historial
  with (security_invoker = true)
  as select * from dinero.eventos_conciliacion_historial;

comment on view public.eventos_conciliacion_historial is
  'Espejo de dinero.eventos_conciliacion_historial para PostgREST. RLS heredada:
   P1 + solo dueno/administracion. Sellers y conductores no acceden jamás.';

-- 8.3 Grants — mismo patrón que el resto de dinero: SELECT directo sobre la tabla
--     base (requerido por security_invoker) y la vista; REVOKE explícito de DML
--     para authenticated/anon (escritura solo service_role). El grant de
--     service_role sobre la tabla base es explícito (el `grant ... on all tables
--     in schema dinero` de 0006 fue un snapshot; las tablas nuevas no lo heredan;
--     la vista pública sí se cubre por alter default privileges de 0013).
grant select on dinero.eventos_conciliacion_historial to authenticated;
revoke insert, update, delete on dinero.eventos_conciliacion_historial from authenticated, anon;

grant select on public.eventos_conciliacion_historial to authenticated;
revoke insert, update, delete on public.eventos_conciliacion_historial from authenticated, anon;

grant select, insert, update, delete on dinero.eventos_conciliacion_historial to service_role;
