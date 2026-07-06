-- =============================================================================
-- Migración 0013 · Geocoding + validación de cobertura en ingesta (F4, ítem 1.1)
-- =============================================================================
-- Cimiento de datos del motor de geocodificación. Lo consumen `integraciones`
-- (puerto de geocoding: google/here/stub) y `backend` (job de ingesta que
-- normaliza, hashea, consulta cache y persiste lat/long + estado de cobertura).
--
-- Qué crea / modifica:
--   1. Esquema `integraciones` (idempotente) + grants a service_role.
--   2. Tabla `integraciones.geocoding_cache` — GLOBAL (sin tenant_id), cache
--      compartido entre todos los couriers. Solo service_role; FORCE RLS sin
--      políticas para authenticated/anon → estructuralmente invisible. Plantilla:
--      operacion.intentos_backfill (migración 0005 §9 y §12.6).
--   3. Enums `operacion.geo_estado` y `operacion.cobertura_estado` (DO-blocks
--      idempotentes — el repo no usa `create type if not exists`).
--   4. Columnas nuevas en `operacion.pedidos` (todas nullable o con default —
--      no rompen filas ni ingesta existente) + índices parciales.
--   5. Re-emite `public.pedidos` (security_invoker) para heredar las columnas.
--
-- Idempotente: create schema/index if not exists, add column if not exists,
-- DO-blocks para tipos, create or replace view.
--
-- NO toca estado/estado_ml/subestado_ml ni la lógica de estados. No modela
-- zonas/zona_comunas (otro ítem). La validación granular comuna→zona queda fuera;
-- aquí solo se declara el campo `cobertura_estado` que el backend poblará.
-- =============================================================================

-- =============================================================================
-- 1. Esquema integraciones
--    Los "puertos" de integración viven en src/ (adaptadores TypeScript). En BD
--    no existía aún ningún schema `integraciones`. El cache de geocoding es el
--    primer objeto persistente del módulo, así que creamos el schema aquí.
-- =============================================================================
create schema if not exists integraciones;

comment on schema integraciones is
  'Módulo de integraciones externas (ML, DTE, pagos, geocoding). Objetos de
   datos persistentes que dan soporte a los adaptadores de src/modules/integraciones.
   geocoding_cache es GLOBAL (sin tenant_id) y solo accesible por service_role.';

-- service_role necesita USAGE en el schema para operar el cache desde los jobs.
grant usage on schema integraciones to service_role;

-- =============================================================================
-- 2. Tabla integraciones.geocoding_cache — GLOBAL, sin tenant_id, solo service_role
-- =============================================================================
-- Cache compartido entre TODOS los couriers: una dirección normalizada se
-- geocodifica una sola vez para toda la plataforma (las direcciones de Santiago
-- no son datos de un tenant — son hechos geográficos públicos). Por eso NO lleva
-- tenant_id: no es una tabla de negocio sino infraestructura compartida.
--
-- clave_hash la calcula el backend (hash determinista de direccion_norm|comuna_norm)
-- y es el punto de lookup. Modelo de aislamiento idéntico a intentos_backfill:
-- FORCE RLS sin políticas para authenticated/anon, revoke all, sin vista en public.
create table if not exists integraciones.geocoding_cache (
  id                uuid primary key default gen_random_uuid(),

  -- Hash determinista de "direccion_norm|comuna_norm" calculado por el backend
  -- (no lo calcula la BD — el backend controla el algoritmo de normalización).
  -- UNIQUE = punto de upsert idempotente del cache.
  clave_hash        text not null unique,

  -- Insumos normalizados que produjeron el hash (para auditoría/depuración y
  -- para regenerar el cache si cambia el algoritmo de normalización).
  direccion_norm    text not null,
  comuna_norm       text not null,

  -- Resultado de la geocodificación. lat/long nulos si geo_estado != 'resuelto'.
  lat               double precision,
  long              double precision,

  -- Estado del resultado de geocodificación de ESTA dirección en el cache.
  -- Texto (no el enum operacion.geo_estado) para mantener el módulo integraciones
  -- desacoplado del esquema operacion. El backend mapea ambos.
  -- 'pendiente' no aplica aquí: una fila en cache ya fue resuelta o intentada.
  geo_estado        text not null
    check (geo_estado in ('resuelto', 'no_resuelto', 'fuera_cobertura')),

  -- Confianza del proveedor (0.000–1.000). NULL si no_resuelto.
  confianza         numeric(4,3) check (confianza is null or (confianza >= 0 and confianza <= 1)),

  -- Proveedor que resolvió la dirección: google | here | stub (modo local/tests).
  proveedor         text not null
    check (proveedor in ('google', 'here', 'stub')),

  geocodificado_en  timestamptz not null default now()
);

comment on table integraciones.geocoding_cache is
  'Cache GLOBAL de geocodificación, compartido entre todos los couriers. SIN
   tenant_id: una dirección normalizada se geocodifica una vez para la plataforma.
   INVISIBLE para authenticated (FORCE RLS sin política + revoke all + sin vista
   en public) — solo service_role (jobs de Inngest / puerto de geocoding). El
   backend calcula clave_hash y hace UPSERT sobre ella. Plantilla de aislamiento:
   operacion.intentos_backfill.';

-- Índice sobre el punto de lookup. El UNIQUE ya crea un índice sobre clave_hash,
-- pero lo declaramos explícito (idempotente) por claridad y para alinearnos con
-- el diseño del arquitecto. Postgres no duplica el UNIQUE — el índice nombrado
-- coexiste sin coste relevante para una tabla de cache.
create index if not exists idx_geocoding_cache_clave_hash
  on integraciones.geocoding_cache (clave_hash);

-- -----------------------------------------------------------------------------
-- RLS de geocoding_cache — solo service_role, igual que intentos_backfill.
-- FORCE RLS + cero políticas para authenticated → cero filas visibles. revoke all
-- anula cualquier privilegio heredado. NO hay vista en public.
-- -----------------------------------------------------------------------------
alter table integraciones.geocoding_cache enable row level security;
alter table integraciones.geocoding_cache force row level security;

-- Revocar explícitamente cualquier privilegio para roles de cliente.
revoke all on integraciones.geocoding_cache from authenticated, anon, public;

-- service_role (BYPASSRLS) salta las políticas pero NO reemplaza GRANT SQL:
-- necesita privilegios explícitos para leer/escribir el cache.
grant select, insert, update on integraciones.geocoding_cache to service_role;

-- =============================================================================
-- 3. Enums nuevos en el esquema operacion
--    DO-blocks idempotentes (el repo no usa `create type if not exists`).
-- =============================================================================

-- operacion.geo_estado: estado de geocodificación de un pedido.
--   pendiente       → aún no geocodificado (default de columna nueva).
--   resuelto        → lat/long obtenidos con confianza aceptable.
--   no_resuelto     → el proveedor no pudo geocodificar la dirección.
--   fuera_cobertura → geocodificado pero fuera del área operable del courier.
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'geo_estado' and n.nspname = 'operacion'
  ) then
    create type operacion.geo_estado as enum (
      'pendiente',
      'resuelto',
      'no_resuelto',
      'fuera_cobertura'
    );
  end if;
end $$;

-- operacion.cobertura_estado: estado de tarificación/cobertura de un pedido.
--   pendiente         → aún no evaluado contra tarifas/cobertura (default).
--   tarifada          → existe tarifa aplicable para la zona del pedido.
--   sin_tarifa_zona   → no hay tarifa configurada para la zona → requiere acción.
--   requiere_revision → caso ambiguo que un interno debe revisar manualmente.
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'cobertura_estado' and n.nspname = 'operacion'
  ) then
    create type operacion.cobertura_estado as enum (
      'pendiente',
      'tarifada',
      'sin_tarifa_zona',
      'requiere_revision'
    );
  end if;
end $$;

-- =============================================================================
-- 4. Columnas nuevas en operacion.pedidos
--    Todas nullable o con default → no rompen filas ni ingesta existentes.
--    `add column if not exists` para idempotencia.
-- =============================================================================
alter table operacion.pedidos
  add column if not exists lat               double precision;

alter table operacion.pedidos
  add column if not exists long              double precision;

alter table operacion.pedidos
  add column if not exists geo_estado        operacion.geo_estado not null default 'pendiente';

alter table operacion.pedidos
  add column if not exists geo_confianza     numeric(4,3);

alter table operacion.pedidos
  add column if not exists geocodificado_en  timestamptz;

alter table operacion.pedidos
  add column if not exists cobertura_estado  operacion.cobertura_estado not null default 'pendiente';

comment on column operacion.pedidos.lat is
  'Latitud geocodificada del destinatario. NULL salvo geo_estado = resuelto.';
comment on column operacion.pedidos.long is
  'Longitud geocodificada del destinatario. NULL salvo geo_estado = resuelto.';
comment on column operacion.pedidos.geo_estado is
  'Estado de geocodificación (pendiente|resuelto|no_resuelto|fuera_cobertura).
   Default pendiente: la ingesta crea el pedido y un paso posterior lo geocodifica.';
comment on column operacion.pedidos.geo_confianza is
  'Confianza (0.000–1.000) del proveedor de geocoding para este pedido. NULL si no resuelto.';
comment on column operacion.pedidos.geocodificado_en is
  'Momento en que el pedido fue geocodificado. NULL mientras geo_estado = pendiente.';
comment on column operacion.pedidos.cobertura_estado is
  'Estado de cobertura/tarificación (pendiente|tarifada|sin_tarifa_zona|requiere_revision).
   La validación granular comuna→zona se modela en otro ítem; aquí solo el campo.';

-- Índice parcial: pedidos pendientes de geocodificar, por tenant. Lo usa el job
-- que barre y geocodifica en lote (set pequeño = índice pequeño).
create index if not exists idx_pedidos_geo_pendiente
  on operacion.pedidos (tenant_id)
  where geo_estado = 'pendiente';

-- Índice parcial: pedidos que requieren atención humana (no geocodificados,
-- fuera de cobertura, o que requieren revisión de tarifa). Alimenta la bandeja
-- de excepciones de la ingesta.
create index if not exists idx_pedidos_geo_revision
  on operacion.pedidos (tenant_id)
  where geo_estado in ('no_resuelto', 'fuera_cobertura')
     or cobertura_estado = 'requiere_revision';

-- =============================================================================
-- 5. Re-emitir la vista public.pedidos
--    `create or replace view ... select *` para que herede las 6 columnas nuevas.
--    Conserva security_invoker = true (RLS evaluada con el rol que consulta).
--    La definición vigente (migración 0005 §13) es `select * from operacion.pedidos`
--    con security_invoker = true — se re-emite idéntica para refrescar el esquema.
--    Los grants sobre la vista (migración 0005 §14) persisten al hacer REPLACE.
-- =============================================================================
create or replace view public.pedidos
  with (security_invoker = true)
  as select * from operacion.pedidos;

comment on view public.pedidos is
  'Espejo de operacion.pedidos para PostgREST. RLS heredada de la tabla base
   (security_invoker = true): P1 tenant + P2 seller + P3 conductor. Incluye las
   columnas de geocoding (lat, long, geo_estado, geo_confianza, geocodificado_en,
   cobertura_estado) heredadas automáticamente — sujetas a las mismas políticas.';

-- Re-afirmar grants sobre la vista (idempotente). create or replace view conserva
-- los privilegios existentes, pero los re-emitimos por defensa en profundidad —
-- mismo conjunto que la migración 0005 §14.
grant select, insert, update on public.pedidos to authenticated;
grant select, insert, update, delete on public.pedidos to service_role;
