-- =============================================================================
-- Migración 0014 · Zonas, mapeo comuna→zona, ventanas de corte y SLA (F7, ítem 1.2)
-- =============================================================================
-- Cimiento de datos del SLA + horario de corte por seller. Lo consumen `backend`
-- (resolución de zona en ingesta, cálculo de fecha_compromiso_hora y corte_riesgo,
-- evaluación de sla_cumplido) y `frontend` (CRUD de zonas/comunas/ventanas en el
-- área (tenant)).
--
-- Qué crea / modifica:
--   1. identidad.zonas               — agrupación operativa de comunas por tenant.
--                                       Interna (solo roles internos). FORCE RLS P1.
--   2. identidad.zona_comunas        — mapeo comuna→zona (1 comuna = 1 zona/tenant).
--                                       Interna. FORCE RLS P1.
--   3. identidad.tarifas.zona_id     — columna nueva OPCIONAL (FK compuesta a zonas).
--                                       NO toca `zona text` ni la FK a sellers. NULL
--                                       = tarifa legada / monto fijo.
--   4. identidad.ventanas_corte      — SLA + hora de corte por seller (y opcionalmente
--                                       por zona). Interna. FORCE RLS P1.
--   5. operacion.pedidos             — 3 columnas nuevas (fecha_compromiso_hora,
--                                       corte_riesgo, sla_cumplido) + índices parciales.
--                                       Re-emite public.pedidos para heredarlas.
--   6. identidad.resolver_zona(...)  — helper: comuna (ya normalizada por el backend)
--                                       → zona_id del tenant, o NULL si no mapeada.
--
-- Idempotente: create table/index if not exists, add column if not exists,
-- DO-blocks para constraints, create or replace view/function.
--
-- Patrón calcado de la migración 0004 (`tarifas`/`conexiones_seller_ml`): vista
-- public con security_invoker, RLS solo-interno P1, triggers set_actualizado_en +
-- solo_interno_edita, FK compuesta (tenant_id, id), grants directos sobre la tabla
-- base requeridos por la vista security_invoker.
--
-- TZ: `hora_corte` es `time` LOCAL de America/Santiago, SIN offset. La BD no
-- convierte zonas horarias: el backend interpreta esa hora en la zona del courier
-- al construir fecha_compromiso_hora (timestamptz). No se hardcodea UTC-3/-4.
--
-- NO toca: la máquina de estados de pedidos, `fecha_compromiso` (date) existente,
-- ni la FK/columna `zona text` de tarifas.
-- =============================================================================

-- =============================================================================
-- 1. identidad.zonas — agrupación operativa de comunas (interna del courier)
-- =============================================================================
-- Una zona agrupa comunas con el mismo tratamiento operativo/tarifario (p. ej.
-- "Centro", "Oriente"). Dato interno: el seller y el conductor NO la ven; sirve
-- para resolver tarifa y ventana de corte por área. tenant_id directo (P1 sin join).
create table if not exists identidad.zonas (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identidad.tenants (id) on delete cascade,
  nombre          text not null,
  activa          boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),

  -- Un nombre de zona único por tenant (no choca con zonas de otro courier).
  constraint zonas_tenant_nombre_uk unique (tenant_id, nombre),
  -- Necesaria para las FK compuestas (tenant_id, zona_id) de zona_comunas,
  -- tarifas y ventanas_corte: garantiza que la zona referenciada pertenece al
  -- MISMO tenant, sin confiar en disciplina de inserción de la app.
  constraint zonas_tenant_id_id_uk unique (tenant_id, id)
);

comment on table identidad.zonas is
  'Agrupación operativa de comunas por tenant (courier). Dato interno: el seller y
   el conductor NO la ven (RLS solo-interno, P1). Es el eje sobre el que se resuelven
   tarifas (tarifas.zona_id) y ventanas de corte/SLA (ventanas_corte.zona_id). El
   mapeo comuna→zona vive en zona_comunas. unique (tenant_id, id) habilita las FK
   compuestas que aíslan por tenant.';

create index if not exists idx_zonas_tenant_id on identidad.zonas (tenant_id);

drop trigger if exists trg_zonas_actualizado_en on identidad.zonas;
create trigger trg_zonas_actualizado_en
  before update on identidad.zonas
  for each row execute function identidad.set_actualizado_en();

create or replace view public.zonas
  with (security_invoker = true)
  as select * from identidad.zonas;

comment on view public.zonas is
  'Espejo de identidad.zonas para PostgREST. RLS solo-interno (P1) heredada de la
   tabla base (security_invoker = true). Seller/conductor: 0 filas.';

alter table identidad.zonas enable row level security;
alter table identidad.zonas force row level security;

-- P1 estricta: SOLO roles internos del tenant. Sin P2/P3 — zonas es configuración
-- interna del courier, nunca visible para seller ni conductor.
drop policy if exists zonas_select_interno on identidad.zonas;
create policy zonas_select_interno
  on identidad.zonas
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists zonas_insert_interno on identidad.zonas;
create policy zonas_insert_interno
  on identidad.zonas
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists zonas_update_interno on identidad.zonas;
create policy zonas_update_interno
  on identidad.zonas
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

-- Guard de defensa en profundidad (mismo patrón que tarifas/conductores): un
-- seller/conductor no ve ninguna zona (P1), por lo que su UPDATE caería en
-- "UPDATE 0" silencioso. El disparador por sentencia lanza 42501 explícito.
drop trigger if exists trg_zonas_solo_interno_edita on identidad.zonas;
create trigger trg_zonas_solo_interno_edita
  before update on identidad.zonas
  for each statement execute function identidad.solo_interno_edita();

-- =============================================================================
-- 2. identidad.zona_comunas — mapeo comuna→zona (interna)
-- =============================================================================
-- Una comuna pertenece a UNA sola zona por tenant (unique (tenant_id, comuna)).
-- `comuna` es text, NO enum: el catálogo de comunas RM vive en la app
-- (src/lib/ui/comunas-rm.ts) y el backend valida ahí antes de insertar; modelar
-- un enum en BD obligaría a migrar cada vez que cambie el catálogo.
create table if not exists identidad.zona_comunas (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identidad.tenants (id) on delete cascade,
  zona_id         uuid not null,
  comuna          text not null,
  creado_en       timestamptz not null default now(),

  -- La zona referenciada debe pertenecer al MISMO tenant (FK compuesta).
  constraint zona_comunas_zona_pertenece_al_tenant
    foreign key (tenant_id, zona_id)
    references identidad.zonas (tenant_id, id)
    on delete cascade,

  -- Una comuna = una zona por tenant: evita que una comuna resuelva a 2 zonas.
  constraint zona_comunas_tenant_comuna_uk unique (tenant_id, comuna)
);

comment on table identidad.zona_comunas is
  'Mapeo comuna→zona por tenant. Una comuna pertenece a una sola zona (unique
   (tenant_id, comuna)). `comuna` es text (no enum): se valida en la app contra
   src/lib/ui/comunas-rm.ts. Interna (RLS solo-interno, P1). Insumo de
   identidad.resolver_zona(). FK compuesta (tenant_id, zona_id) aísla por tenant.';

create index if not exists idx_zona_comunas_tenant_id on identidad.zona_comunas (tenant_id);
create index if not exists idx_zona_comunas_zona on identidad.zona_comunas (tenant_id, zona_id);
-- Lookup de resolver_zona: por (tenant_id, comuna). El unique ya crea índice,
-- pero lo dejamos explícito por claridad (Postgres no lo duplica funcionalmente).
create index if not exists idx_zona_comunas_lookup on identidad.zona_comunas (tenant_id, comuna);

create or replace view public.zona_comunas
  with (security_invoker = true)
  as select * from identidad.zona_comunas;

comment on view public.zona_comunas is
  'Espejo de identidad.zona_comunas para PostgREST. RLS solo-interno (P1).
   Seller/conductor: 0 filas.';

alter table identidad.zona_comunas enable row level security;
alter table identidad.zona_comunas force row level security;

drop policy if exists zona_comunas_select_interno on identidad.zona_comunas;
create policy zona_comunas_select_interno
  on identidad.zona_comunas
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists zona_comunas_insert_interno on identidad.zona_comunas;
create policy zona_comunas_insert_interno
  on identidad.zona_comunas
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists zona_comunas_update_interno on identidad.zona_comunas;
create policy zona_comunas_update_interno
  on identidad.zona_comunas
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

-- zona_comunas admite DELETE como parte del CRUD de mapeo (reasignar una comuna
-- a otra zona se hace borrando + insertando, o el frontend hace upsert). El
-- DELETE queda gobernado por la política de SELECT a nivel de fila visible y por
-- el guard de abajo. Añadimos política de DELETE solo-interno explícita.
drop policy if exists zona_comunas_delete_interno on identidad.zona_comunas;
create policy zona_comunas_delete_interno
  on identidad.zona_comunas
  for delete
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop trigger if exists trg_zona_comunas_solo_interno_edita on identidad.zona_comunas;
create trigger trg_zona_comunas_solo_interno_edita
  before update on identidad.zona_comunas
  for each statement execute function identidad.solo_interno_edita();

-- =============================================================================
-- 3. identidad.tarifas.zona_id — columna nueva OPCIONAL (no rompe lo existente)
-- =============================================================================
-- Permite vincular una tarifa a una zona estructurada (FK compuesta) además del
-- `zona text` legado, que se conserva intacto. NULL = tarifa legada (usa `zona
-- text` o monto fijo). NO se toca `zona text` ni la FK a sellers.
alter table identidad.tarifas
  add column if not exists zona_id uuid;

comment on column identidad.tarifas.zona_id is
  'Zona estructurada de la tarifa (FK compuesta a zonas, aísla por tenant). OPCIONAL:
   NULL = tarifa legada (modo monto_fijo o `zona` texto). Convive con `zona text`,
   que NO se elimina. El backend prefiere zona_id cuando está presente.';

-- FK compuesta idempotente (no se puede usar `add column ... references` con
-- IF NOT EXISTS sobre la constraint; se añade en DO-block).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tarifas_zona_pertenece_al_tenant'
  ) then
    alter table identidad.tarifas
      add constraint tarifas_zona_pertenece_al_tenant
      foreign key (tenant_id, zona_id)
      references identidad.zonas (tenant_id, id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_tarifas_tenant_zona
  on identidad.tarifas (tenant_id, zona_id)
  where zona_id is not null;

-- La vista public.tarifas es `select *` (migración 0004) — re-emitir para que
-- herede la columna nueva. Conserva security_invoker y los grants existentes.
create or replace view public.tarifas
  with (security_invoker = true)
  as select * from identidad.tarifas;

-- =============================================================================
-- 4. identidad.ventanas_corte — SLA + hora de corte por seller (y opc. zona)
-- =============================================================================
-- Define, por seller (y opcionalmente por zona), la hora límite de corte para
-- comprometer entrega same-day/flex, los buffers de preparación y ruta, y el
-- objetivo de SLA. zona_id NULL = ventana por DEFECTO del seller (aplica a las
-- comunas sin ventana específica). Interna del courier.
create table if not exists identidad.ventanas_corte (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references identidad.tenants (id) on delete cascade,
  seller_id              uuid not null,

  -- NULL = ventana por defecto del seller; con valor = override específico de zona.
  zona_id                uuid,

  tipo_entrega           identidad.tipo_entrega not null default 'same_day',

  -- Hora límite de corte, LOCAL America/Santiago, SIN offset. La BD no convierte
  -- TZ: el backend interpreta esta hora en la zona del courier. Nunca con TZ.
  hora_corte             time not null,

  -- Buffers operativos en minutos (>= 0). El backend los suma a hora_corte para
  -- construir fecha_compromiso_hora (timestamptz).
  minutos_preparacion    integer not null default 0 check (minutos_preparacion >= 0),
  minutos_ruta_estimado  integer not null default 0 check (minutos_ruta_estimado >= 0),

  -- Objetivo de SLA (% de entregas a tiempo). 0..100, default 97.00.
  sla_objetivo_pct       numeric(5,2) not null default 97.00
    check (sla_objetivo_pct >= 0 and sla_objetivo_pct <= 100),

  activa                 boolean not null default true,
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now(),

  -- El seller referenciado debe pertenecer al mismo tenant (FK compuesta).
  constraint ventanas_corte_seller_pertenece_al_tenant
    foreign key (tenant_id, seller_id)
    references identidad.sellers (tenant_id, id),

  -- La zona (si la hay) debe pertenecer al mismo tenant (FK compuesta).
  constraint ventanas_corte_zona_pertenece_al_tenant
    foreign key (tenant_id, zona_id)
    references identidad.zonas (tenant_id, id)
    on delete cascade,

  -- Unicidad de la ventana por (seller, zona, tipo_entrega). NULLS NOT DISTINCT
  -- (PG 15+; el repo corre PG 17 — config.toml major_version = 17) trata el
  -- zona_id NULL (ventana DEFAULT del seller) como UNA sola fila por
  -- (seller, tipo_entrega), evitando dos "defaults" en conflicto. Sin esto,
  -- NULL != NULL permitiría duplicar la ventana por defecto.
  constraint ventanas_corte_fallback_uk
    unique nulls not distinct (tenant_id, seller_id, zona_id, tipo_entrega)
);

comment on table identidad.ventanas_corte is
  'SLA + hora de corte por seller (y opcionalmente por zona). zona_id NULL = ventana
   por defecto del seller; con valor = override por zona. hora_corte es time LOCAL
   America/Santiago (sin TZ): el backend la interpreta en la zona del courier al
   construir operacion.pedidos.fecha_compromiso_hora. Interna (RLS solo-interno, P1):
   el seller NO ve sus propias ventanas de corte ni su objetivo de SLA pactado
   (igual criterio que tarifas, §8.2). Unicidad de la ventana por defecto vía
   UNIQUE NULLS NOT DISTINCT (PG 15+).';

create index if not exists idx_ventanas_corte_tenant_id on identidad.ventanas_corte (tenant_id);
create index if not exists idx_ventanas_corte_tenant_seller on identidad.ventanas_corte (tenant_id, seller_id);
-- Lookup de la ventana aplicable: por (tenant, seller, tipo) entre las activas.
create index if not exists idx_ventanas_corte_lookup
  on identidad.ventanas_corte (tenant_id, seller_id, tipo_entrega)
  where activa = true;

drop trigger if exists trg_ventanas_corte_actualizado_en on identidad.ventanas_corte;
create trigger trg_ventanas_corte_actualizado_en
  before update on identidad.ventanas_corte
  for each row execute function identidad.set_actualizado_en();

create or replace view public.ventanas_corte
  with (security_invoker = true)
  as select * from identidad.ventanas_corte;

comment on view public.ventanas_corte is
  'Espejo de identidad.ventanas_corte para PostgREST. RLS solo-interno (P1):
   seller/conductor 0 filas. El seller NO ve su SLA pactado ni su hora de corte
   (configuración interna del courier).';

alter table identidad.ventanas_corte enable row level security;
alter table identidad.ventanas_corte force row level security;

-- P1 estricta, SIN P2 (el seller no ve su ventana de corte ni su SLA pactado —
-- mismo criterio que tarifas, §8.2). Solo roles internos del tenant.
drop policy if exists ventanas_corte_select_interno on identidad.ventanas_corte;
create policy ventanas_corte_select_interno
  on identidad.ventanas_corte
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists ventanas_corte_insert_interno on identidad.ventanas_corte;
create policy ventanas_corte_insert_interno
  on identidad.ventanas_corte
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists ventanas_corte_update_interno on identidad.ventanas_corte;
create policy ventanas_corte_update_interno
  on identidad.ventanas_corte
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

drop trigger if exists trg_ventanas_corte_solo_interno_edita on identidad.ventanas_corte;
create trigger trg_ventanas_corte_solo_interno_edita
  before update on identidad.ventanas_corte
  for each statement execute function identidad.solo_interno_edita();

-- =============================================================================
-- 5. operacion.pedidos — columnas de compromiso/SLA + índices + re-emitir vista
-- =============================================================================
-- Todas nullable o con default → no rompen filas ni ingesta existentes.
--   fecha_compromiso_hora: instante prometido de entrega (timestamptz). El backend
--     lo calcula desde la ventana de corte (hora_corte LOCAL + buffers) interpretada
--     en la zona del courier. NO sustituye `fecha_compromiso` (date), que se conserva.
--   corte_riesgo: el pedido ingresó cerca/después de la hora de corte y peligra el
--     compromiso (lo marca el backend en ingesta). Alimenta una bandeja de riesgo.
--   sla_cumplido: NULL mientras no se cierra el pedido; true/false al evaluar la
--     entrega contra fecha_compromiso_hora (lo escribe el motor de SLA del backend).
alter table operacion.pedidos
  add column if not exists fecha_compromiso_hora  timestamptz;

alter table operacion.pedidos
  add column if not exists corte_riesgo           boolean not null default false;

alter table operacion.pedidos
  add column if not exists sla_cumplido           boolean;

comment on column operacion.pedidos.fecha_compromiso_hora is
  'Instante prometido de entrega (timestamptz). Calculado por el backend desde la
   ventana de corte aplicable (hora_corte LOCAL Santiago + buffers) interpretada en
   la zona del courier. NO sustituye fecha_compromiso (date), que se conserva.';
comment on column operacion.pedidos.corte_riesgo is
  'true = el pedido ingresó cerca/después de la hora de corte y el compromiso peligra.
   Lo marca el backend en la ingesta. Default false. Alimenta la bandeja de riesgo.';
comment on column operacion.pedidos.sla_cumplido is
  'Evaluación de SLA: NULL hasta cerrar el pedido; true/false al comparar la entrega
   contra fecha_compromiso_hora. Lo escribe el motor de SLA del backend.';

-- Índice parcial: pedidos en riesgo de corte, por tenant. Set pequeño (solo los
-- en riesgo) = índice pequeño. Alimenta la bandeja de riesgo de la operación.
create index if not exists idx_pedidos_corte_riesgo
  on operacion.pedidos (tenant_id)
  where corte_riesgo = true;

-- Índice parcial: pedidos con SLA incumplido, por tenant. Para reportes y la
-- bandeja de incumplimientos. sla_cumplido = false excluye los NULL (no evaluados).
create index if not exists idx_pedidos_sla_incumplido
  on operacion.pedidos (tenant_id)
  where sla_cumplido = false;

-- Re-emitir public.pedidos para heredar las 3 columnas nuevas. `select *` con
-- security_invoker = true (definición vigente, migraciones 0005 §13 y 0013 §5).
-- create or replace view conserva los grants existentes; se reafirman abajo.
create or replace view public.pedidos
  with (security_invoker = true)
  as select * from operacion.pedidos;

comment on view public.pedidos is
  'Espejo de operacion.pedidos para PostgREST. RLS heredada de la tabla base
   (security_invoker = true): P1 tenant + P2 seller + P3 conductor. Incluye las
   columnas de geocoding (lat, long, geo_estado, ...) y de compromiso/SLA
   (fecha_compromiso_hora, corte_riesgo, sla_cumplido), todas sujetas a las mismas
   políticas: el seller ve corte_riesgo / sla_cumplido SOLO de sus propios pedidos.';

-- Reafirmar grants sobre la vista (idempotente, defensa en profundidad — mismo
-- conjunto que migraciones 0005 §14 y 0013 §5).
grant select, insert, update on public.pedidos to authenticated;
grant select, insert, update, delete on public.pedidos to service_role;

-- =============================================================================
-- 6. identidad.resolver_zona(p_tenant_id, p_comuna) → uuid
-- =============================================================================
-- Devuelve la zona_id mapeada a `p_comuna` para `p_tenant_id`, o NULL si la comuna
-- no está mapeada. La NORMALIZACIÓN de la comuna la hace el backend ANTES de llamar
-- (la función compara por igualdad exacta sobre `comuna`, tal como se almacenó).
--
-- SECURITY DEFINER + search_path fijo: la resolución de zona es un lookup interno
-- que el backend invoca con un tenant ya validado por la sesión; igual que otras
-- funciones de servidor del repo, se ejecuta con privilegios del owner para leer
-- zona_comunas sin depender de la RLS del invocador (que de todos modos solo
-- permitiría a internos). El parámetro p_tenant_id acota el resultado al tenant
-- correcto — NO usa el claim, así también sirve a jobs de service_role.
create or replace function identidad.resolver_zona(
  p_tenant_id uuid,
  p_comuna    text
) returns uuid
language sql
stable
security definer
set search_path = identidad, pg_temp
as $$
  select zc.zona_id
  from identidad.zona_comunas zc
  join identidad.zonas z
    on z.tenant_id = zc.tenant_id and z.id = zc.zona_id
  where zc.tenant_id = p_tenant_id
    and zc.comuna    = p_comuna
    and z.activa     = true
  limit 1
$$;

comment on function identidad.resolver_zona(uuid, text) is
  'Resuelve comuna→zona_id para un tenant. La comuna debe venir YA normalizada por
   el backend (compara por igualdad exacta). Devuelve NULL si la comuna no está
   mapeada o su zona está inactiva. SECURITY DEFINER + search_path fijo (lookup
   interno); acota por el parámetro p_tenant_id, no por el claim, para servir tanto
   a acciones de usuario como a jobs de service_role.';

-- Ejecutable por roles internos (acciones de servidor) y service_role (jobs de
-- ingesta). NO se otorga a anon. El SECURITY DEFINER no expone datos cruzados:
-- el resultado se acota siempre por p_tenant_id que pasa el llamador.
grant execute on function identidad.resolver_zona(uuid, text) to authenticated, service_role;

-- =============================================================================
-- 7. Grants de API — privilegios directos sobre tablas base (vistas
--    security_invoker = true) + sobre las vistas en public. Patrón de 0004/0005.
-- =============================================================================
-- Tablas base en identidad (requeridos por las vistas security_invoker).
grant select, insert, update on identidad.zonas          to authenticated;
-- zona_comunas admite DELETE (CRUD de mapeo); las demás solo select/insert/update.
grant select, insert, update, delete on identidad.zona_comunas to authenticated;
grant select, insert, update on identidad.ventanas_corte to authenticated;

-- Vistas en public.
grant select, insert, update on public.zonas          to authenticated;
grant select, insert, update, delete on public.zona_comunas to authenticated;
grant select, insert, update on public.ventanas_corte to authenticated;

-- service_role: BYPASSRLS salta políticas pero NO reemplaza GRANT SQL.
grant select, insert, update, delete on identidad.zonas          to service_role;
grant select, insert, update, delete on identidad.zona_comunas   to service_role;
grant select, insert, update, delete on identidad.ventanas_corte to service_role;
grant select, insert, update, delete on public.zonas          to service_role;
grant select, insert, update, delete on public.zona_comunas   to service_role;
grant select, insert, update, delete on public.ventanas_corte to service_role;
