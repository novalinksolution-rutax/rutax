-- =============================================================================
-- Migración 0010 · Infra — Rate limiting transversal (contadores por ventana)
-- =============================================================================
-- Crea el schema `infra` (infraestructura transversal, NO negocio), la tabla
-- UNLOGGED `infra.rate_limit_contadores` y la RPC `public.rate_limit_consumir`,
-- única superficie de acceso al contador (fixed-window counter).
--
-- EXCEPCIÓN DOCUMENTADA a la regla "toda tabla de negocio lleva tenant_id":
-- `infra` NO contiene tablas de negocio — solo mecánica transversal de la
-- plataforma. El tenant, cuando aplica al límite, va embebido en la llave
-- (p. ej. 'login:<tenant_id>:<ip>'), no como columna con FK ni RLS por tenant.
--
-- Modelo de seguridad (deny-by-default total):
--   - Tabla: RLS enable + force SIN políticas + REVOKE a authenticated/anon/
--     public. Nadie llega a la tabla salvo service_role (y el definer de la RPC).
--   - SIN vista espejo en `public`: esta tabla JAMÁS se expone a PostgREST.
--     La RPC es la única superficie, y su EXECUTE es exclusivo de service_role.
--
-- Idempotente: IF NOT EXISTS / OR REPLACE en cada objeto; REVOKE/GRANT son
-- re-aplicables. Sin enums ni DO-blocks de ALTER TYPE.
-- =============================================================================

-- =============================================================================
-- 1. Schema infra
-- =============================================================================
create schema if not exists infra;

comment on schema infra is
  'Infraestructura transversal de la plataforma (rate limiting y similares).
   NO contiene tablas de negocio — excepción documentada a la regla
   "toda tabla de negocio lleva tenant_id": aquí el tenant, cuando aplica,
   va embebido en la llave del contador, no como columna. Nada de este schema
   se expone a PostgREST; el acceso es exclusivo de service_role vía RPC.';

-- =============================================================================
-- 2. infra.rate_limit_contadores — contador fixed-window por llave
--    UNLOGGED a propósito: dato efímero de alta rotación. Sin WAL las
--    escrituras son baratas (cada request del limitador hace un upsert).
--    Si Postgres se recupera de un crash la tabla se trunca y el limitador
--    "olvida" los contadores en vuelo → fail-open momentáneo, aceptable para
--    rate limiting (nunca para datos de negocio).
-- =============================================================================
create unlogged table if not exists infra.rate_limit_contadores (
  llave          text        not null,
  ventana_inicio timestamptz not null,
  contador       integer     not null default 1,

  constraint rate_limit_contadores_pk primary key (llave, ventana_inicio)
);

comment on table infra.rate_limit_contadores is
  'Contadores de rate limiting por llave y ventana fija (fixed window).
   UNLOGGED: efímero, sin WAL; tras crash recovery se trunca y el limitador
   olvida (fail-open momentáneo, aceptable). Deny-by-default: RLS forzada SIN
   políticas + sin grants a authenticated/anon + sin vista en public. La única
   superficie es la RPC public.rate_limit_consumir (solo service_role). La
   limpieza de ventanas viejas es oportunista dentro de la propia RPC (~1% de
   las llamadas) — sin job ni cron adicional.';

-- =============================================================================
-- 3. RPC public.rate_limit_consumir — consume 1 unidad del límite y retorna
--    el contador acumulado de la ventana actual. El caller (service_role,
--    capa de aplicación) compara el retorno contra su umbral y decide 429.
--
--    SECURITY DEFINER con search_path fijo (infra, pg_temp): patrón seguro
--    contra search-path hijacking. El definer (postgres) tiene BYPASSRLS en
--    Supabase, por eso puede escribir la tabla pese a la RLS forzada sin
--    políticas — esa es exactamente la intención: solo este camino escribe.
-- =============================================================================
create or replace function public.rate_limit_consumir(
  p_llave            text,
  p_ventana_segundos integer
) returns integer
language plpgsql
security definer
set search_path = infra, pg_temp
as $$
declare
  v_ventana  timestamptz;
  v_contador integer;
begin
  if p_ventana_segundos is null or p_ventana_segundos <= 0 then
    raise exception
      'rate_limit_consumir: p_ventana_segundos debe ser > 0 (recibido: %)',
      p_ventana_segundos
      using errcode = '22023'; -- invalid_parameter_value
  end if;

  -- Inicio de la ventana fija: epoch truncado al múltiplo de la ventana.
  v_ventana := to_timestamp(
    floor(extract(epoch from now()) / p_ventana_segundos) * p_ventana_segundos
  );

  insert into infra.rate_limit_contadores (llave, ventana_inicio)
  values (p_llave, v_ventana)
  on conflict (llave, ventana_inicio)
    do update set contador = rate_limit_contadores.contador + 1
  returning contador into v_contador;

  -- Limpieza oportunista anti-bloat (~1% de las llamadas): borra ventanas
  -- viejas sin job/cron nuevo. UNLOGGED + ventanas cortas → DELETE barato.
  if random() < 0.01 then
    delete from infra.rate_limit_contadores
    where ventana_inicio < now() - interval '1 hour';
  end if;

  return v_contador;
end;
$$;

comment on function public.rate_limit_consumir(text, integer) is
  'Consume 1 unidad de rate limit para la llave en la ventana fija actual y
   retorna el contador acumulado (1 = primera llamada de la ventana). EXECUTE
   exclusivo de service_role — anon/authenticated NO pueden invocarla (la capa
   de aplicación la llama server-side). Incluye limpieza oportunista (~1%) de
   ventanas con más de 1 hora. Lanza 22023 si p_ventana_segundos <= 0.';

-- =============================================================================
-- 4. Seguridad — deny-by-default total
-- =============================================================================

-- 4.1 Tabla: RLS forzada SIN políticas. Ni siquiera el owner la salta sin
--     BYPASSRLS. No se crean políticas a propósito.
alter table infra.rate_limit_contadores enable row level security;
alter table infra.rate_limit_contadores force row level security;

-- 4.2 Grants de schema: solo service_role. authenticated/anon ni siquiera
--     tienen USAGE sobre infra (defensa en profundidad antes de la RLS).
revoke all on schema infra from public, anon, authenticated;
grant usage on schema infra to service_role;

-- 4.3 Grants de tabla: REVOKE explícito a todos los roles de PostgREST,
--     GRANT completo solo a service_role.
revoke all on infra.rate_limit_contadores from public, anon, authenticated;
grant select, insert, update, delete on infra.rate_limit_contadores to service_role;

-- 4.4 RPC: Postgres otorga EXECUTE a PUBLIC por defecto al crear funciones
--     (y Supabase suma default privileges para anon/authenticated en public) —
--     se revoca todo y se concede solo a service_role.
revoke execute on function public.rate_limit_consumir(text, integer)
  from public, anon, authenticated;
grant execute on function public.rate_limit_consumir(text, integer)
  to service_role;
