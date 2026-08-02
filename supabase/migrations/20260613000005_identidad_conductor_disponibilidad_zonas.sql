-- =============================================================================
-- Migración 0015 · Disponibilidad/capacidad del conductor + zonas preferentes
--                  (F6, ítem 1.3 · Auto-assign heurístico)
-- =============================================================================
-- Cimiento de datos para la asignación automática heurística. Lo consume
-- `backend` (puntaje conductor↔pedido: disponibilidad, cupo de paradas y afinidad
-- de zona) y `frontend` (CRUD de zonas preferentes y toggle de disponibilidad en
-- el área (tenant)). NO toca la lógica de pedidos/manifiestos ni la asignación
-- existente — solo provee el modelo de datos aislado por tenant.
--
-- Qué crea / modifica:
--   1. identidad.conductores            — 2 columnas nuevas:
--                                            disponible (disponibilidad operativa
--                                            del día, distinta de estado activo|inactivo)
--                                            capacidad_paradas (cupo máximo > 0).
--                                          Re-emite public.conductores para heredarlas.
--   2. conductores_tenant_id_id_uk       — unique (tenant_id, id), prerrequisito de la
--                                          FK compuesta. YA existe desde la migración 0005
--                                          (manifiestos); se guarda idempotentemente por si
--                                          esta migración se aplica sobre una base sin 0005.
--   3. identidad.conductor_zonas         — zonas preferentes N:M conductor↔zona.
--                                          Interna (solo roles internos). FORCE RLS P1.
--
-- Idempotente: add column if not exists, create table/index if not exists,
-- DO-blocks para constraints, create or replace view.
--
-- Patrón calcado EXACTAMENTE de la migración 0014 (`zona_comunas`): FK compuesta
-- (tenant_id, X) que aísla por tenant, vista public con security_invoker, RLS
-- solo-interno P1 (select/insert/update/DELETE — el CRUD reasigna borrando+
-- insertando), trigger por sentencia `solo_interno_edita`, grants directos sobre
-- la tabla base requeridos por la vista security_invoker + sobre la vista, y
-- service_role explícito.
--
-- Alcance de visibilidad (§8.2): conductor_zonas es INTERNA. El conductor NO ve
-- su propio mapa de zonas preferentes (lo gestiona el coordinador del courier); el
-- seller jamás lo ve. Las 2 columnas nuevas de conductores heredan la RLS ya
-- existente de esa tabla (P1 interno + P3 conductor ve SOLO su propia fila).
--
-- NO toca: la máquina de estados de pedidos, manifiestos, asignación, ni el
-- significado de `estado activo|inactivo` (de ahí columna `disponible` aparte).
-- =============================================================================

-- =============================================================================
-- 1. identidad.conductores — disponibilidad operativa + capacidad de paradas
-- =============================================================================
-- `disponible`: disponibilidad operativa del día (¿entra hoy al pool de
-- auto-asignación?). DISTINTA de `estado` (activo|inactivo, alta/baja del
-- conductor en la nómina). Un conductor `activo` pero `disponible = false`
-- (día libre, licencia) no recibe auto-asignación, pero sigue de alta.
-- `capacidad_paradas`: cupo máximo de paradas que admite en un turno (> 0).
alter table identidad.conductores
  add column if not exists disponible boolean not null default true;

alter table identidad.conductores
  add column if not exists capacidad_paradas integer not null default 30;

-- Constraint de cupo > 0 idempotente (no se puede usar IF NOT EXISTS en el
-- check de `add column`; se añade en DO-block para que la re-aplicación no falle).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'conductores_capacidad_paradas_positiva'
  ) then
    alter table identidad.conductores
      add constraint conductores_capacidad_paradas_positiva
      check (capacidad_paradas > 0);
  end if;
end $$;

comment on column identidad.conductores.disponible is
  'Disponibilidad operativa del día: ¿entra hoy al pool de auto-asignación? DISTINTA
   de `estado` (activo|inactivo = alta/baja en la nómina). Un conductor activo pero
   disponible=false (día libre, licencia) no recibe auto-asignación pero sigue de alta.
   Default true.';
comment on column identidad.conductores.capacidad_paradas is
  'Cupo máximo de paradas que el conductor admite en un turno (> 0). Lo usa el
   auto-assign heurístico para no sobrecargar. Default 30.';

-- -----------------------------------------------------------------------------
-- 2. conductores_tenant_id_id_uk — prerrequisito de la FK compuesta
-- -----------------------------------------------------------------------------
-- YA existe desde la migración 0005 (la FK compuesta de manifiestos lo creó). Se
-- guarda idempotentemente por si esta migración se aplicara sobre una base sin
-- 0005. La PK actual es `conductores_pkey` sobre (id) — NO estorba: el unique
-- adicional sobre (tenant_id, id) es el destino de las FK compuestas que aíslan
-- por tenant (mismo patrón que sellers_tenant_id_id_uk / zonas_tenant_id_id_uk).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'conductores_tenant_id_id_uk'
  ) then
    alter table identidad.conductores
      add constraint conductores_tenant_id_id_uk unique (tenant_id, id);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Re-emitir public.conductores para heredar disponible/capacidad_paradas
-- -----------------------------------------------------------------------------
-- La vista es `select *` (migración 0002). create or replace conserva los grants
-- existentes; se reafirman en §6. security_invoker = true: la RLS de la tabla
-- base (P1 interno + P3 conductor sobre su propia fila) sigue gobernando.
create or replace view public.conductores
  with (security_invoker = true)
  as select * from identidad.conductores;

comment on view public.conductores is
  'Espejo de identidad.conductores para PostgREST. RLS heredada de la tabla base
   (security_invoker = true): P1 interno ve toda su nómina; P3 conductor ve SOLO su
   propia fila. Incluye disponible / capacidad_paradas, sujetas a las mismas políticas.';

-- =============================================================================
-- 4. identidad.conductor_zonas — zonas preferentes del conductor (N:M, interna)
-- =============================================================================
-- Un conductor puede tener varias zonas preferentes; una zona, varios conductores.
-- Lo usa el auto-assign para sumar afinidad cuando la comuna del pedido cae en una
-- zona preferente del conductor. Interno del courier: ni el conductor ni el seller
-- lo ven. FK compuestas (tenant_id, X) aíslan por tenant sin confiar en la app.
create table if not exists identidad.conductor_zonas (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identidad.tenants (id) on delete cascade,
  conductor_id    uuid not null,
  zona_id         uuid not null,
  creado_en       timestamptz not null default now(),

  -- El conductor referenciado debe pertenecer al MISMO tenant (FK compuesta).
  constraint conductor_zonas_conductor_pertenece_al_tenant
    foreign key (tenant_id, conductor_id)
    references identidad.conductores (tenant_id, id)
    on delete cascade,

  -- La zona referenciada debe pertenecer al MISMO tenant (FK compuesta).
  constraint conductor_zonas_zona_pertenece_al_tenant
    foreign key (tenant_id, zona_id)
    references identidad.zonas (tenant_id, id)
    on delete cascade,

  -- Una zona preferente no se repite para el mismo conductor.
  constraint conductor_zonas_tenant_conductor_zona_uk
    unique (tenant_id, conductor_id, zona_id)
);

comment on table identidad.conductor_zonas is
  'Zonas preferentes del conductor (N:M conductor↔zona) por tenant. Insumo de afinidad
   del auto-assign heurístico (F6). Interna (RLS solo-interno, P1): el conductor NO ve
   su propio mapa de zonas y el seller jamás. FK compuestas (tenant_id, conductor_id) y
   (tenant_id, zona_id) aíslan por tenant.';

create index if not exists idx_conductor_zonas_tenant_id on identidad.conductor_zonas (tenant_id);
create index if not exists idx_conductor_zonas_conductor on identidad.conductor_zonas (tenant_id, conductor_id);
create index if not exists idx_conductor_zonas_zona on identidad.conductor_zonas (tenant_id, zona_id);

create or replace view public.conductor_zonas
  with (security_invoker = true)
  as select * from identidad.conductor_zonas;

comment on view public.conductor_zonas is
  'Espejo de identidad.conductor_zonas para PostgREST. RLS solo-interno (P1) heredada
   de la tabla base (security_invoker = true). Seller/conductor: 0 filas.';

-- =============================================================================
-- 5. RLS — conductor_zonas (P1 estricta, solo-interno; calcada de zona_comunas)
-- =============================================================================
-- SOLO roles internos del tenant. Sin P2/P3 — es configuración interna del courier.
alter table identidad.conductor_zonas enable row level security;
alter table identidad.conductor_zonas force row level security;

drop policy if exists conductor_zonas_select_interno on identidad.conductor_zonas;
create policy conductor_zonas_select_interno
  on identidad.conductor_zonas
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists conductor_zonas_insert_interno on identidad.conductor_zonas;
create policy conductor_zonas_insert_interno
  on identidad.conductor_zonas
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists conductor_zonas_update_interno on identidad.conductor_zonas;
create policy conductor_zonas_update_interno
  on identidad.conductor_zonas
  for update
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  )
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

-- conductor_zonas admite DELETE como parte del CRUD: reasignar las zonas
-- preferentes de un conductor se hace borrando + insertando (igual que el mapeo
-- de zona_comunas, migración 0014 §2). DELETE solo-interno explícito.
drop policy if exists conductor_zonas_delete_interno on identidad.conductor_zonas;
create policy conductor_zonas_delete_interno
  on identidad.conductor_zonas
  for delete
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

-- Guard de defensa en profundidad (disparador POR SENTENCIA, before update): un
-- seller/conductor no ve ninguna fila (P1), por lo que su UPDATE caería en
-- "UPDATE 0" silencioso. El trigger lanza 42501 explícito y auditable.
drop trigger if exists trg_conductor_zonas_solo_interno_edita on identidad.conductor_zonas;
create trigger trg_conductor_zonas_solo_interno_edita
  before update on identidad.conductor_zonas
  for each statement execute function identidad.solo_interno_edita();

-- =============================================================================
-- 6. Grants de API — privilegios directos sobre tablas base (vistas
--    security_invoker = true) + sobre las vistas en public. Patrón de 0014.
-- =============================================================================
-- conductores: reafirmar grants (la vista se re-emitió; create or replace los
-- conserva, pero se reafirman por defensa en profundidad). Sin DELETE (baja
-- lógica vía estado), igual que la migración 0002.
grant select, insert, update on identidad.conductores to authenticated;
grant select, insert, update on public.conductores   to authenticated;
grant select, insert, update, delete on identidad.conductores to service_role;
grant select, insert, update, delete on public.conductores   to service_role;

-- conductor_zonas admite DELETE (CRUD de reasignación).
grant select, insert, update, delete on identidad.conductor_zonas to authenticated;
grant select, insert, update, delete on public.conductor_zonas    to authenticated;
grant select, insert, update, delete on identidad.conductor_zonas to service_role;
grant select, insert, update, delete on public.conductor_zonas    to service_role;
