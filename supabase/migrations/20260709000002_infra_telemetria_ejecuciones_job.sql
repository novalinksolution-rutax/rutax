-- =============================================================================
-- 0002 (2026-07-09) · Infra — Telemetría de ejecución de jobs (QW3 auditoría)
-- =============================================================================
-- Cierra la brecha §2.7 / §3.2 / QW3: "última ejecución exitosa, duración,
-- elementos procesados, alerta por fallo/acumulación" para TODOS los procesos
-- automáticos (crons y jobs por evento de Inngest).
--
-- El middleware de Inngest (`middleware-telemetria.ts`) llama a la RPC
-- `public.job_run_registrar` en `onRunStart` / `onRunComplete` / `onRunError`:
-- una fila por run, keyed por el runId de Inngest (único). El super-admin lee
-- el resumen vía `public.salud_jobs_resumen`.
--
-- Vive en el schema `infra` (infraestructura transversal, NO negocio) — misma
-- excepción documentada que `infra.rate_limit_contadores` (migración 0010): sin
-- tenant_id como columna con FK/RLS; el tenant del run, cuando aplica, se guarda
-- como dato de triaje, no como frontera de aislamiento. Estos datos son de
-- operación de la PLATAFORMA (Rutax), cross-tenant, y solo los ve el super-admin.
--
-- Modelo de seguridad (deny-by-default total, igual que rate_limit):
--   - Tabla: RLS enable + force SIN políticas + REVOKE a authenticated/anon.
--   - SIN vista espejo en `public`: la tabla nunca se expone a PostgREST.
--   - Las RPCs (registrar/leer) son la única superficie, EXECUTE solo service_role.
--
-- Idempotente: IF NOT EXISTS / OR REPLACE; REVOKE/GRANT re-aplicables.
-- =============================================================================

-- El schema `infra` ya existe (migración 20260612000001). `if not exists` por si
-- esta migración se aplica antes en un entorno reconstruido.
create schema if not exists infra;

-- =============================================================================
-- 1. infra.ejecuciones_job — una fila por run de Inngest
-- =============================================================================
create table if not exists infra.ejecuciones_job (
  run_id         text        primary key,   -- runId de Inngest (ULID, único por run)
  job_id         text        not null,       -- fn.id(): 'dinero/cerrarPeriodo', etc.
  evento         text,                        -- nombre del evento/cron que lo disparó
  tenant_id      uuid,                        -- del event.data si aplica; crons globales: NULL
  estado         text        not null default 'ejecutando'
                   check (estado in ('ejecutando','ok','error')),
  intento        integer,                     -- attempt de Inngest (0 = primer intento)
  iniciado_en    timestamptz not null default now(),
  finalizado_en  timestamptz,
  duracion_ms    integer,                     -- wall-clock del run (fin - inicio)
  resumen        jsonb,                       -- output del job (redactado, sin secretos)
  error          text,                        -- mensaje de error redactado (estado='error')
  actualizado_en timestamptz not null default now()
);

comment on table infra.ejecuciones_job is
  'Telemetría de ejecución de jobs de Inngest (QW3 auditoría): una fila por run,
   keyed por runId. La escribe el middleware de telemetría vía RPC. Infra
   transversal cross-tenant (solo super-admin la ve) — sin RLS por tenant.
   Deny-by-default: RLS forzada SIN políticas + sin grants a authenticated/anon
   + sin vista en public. Retención ~30 días vía prune oportunista en la RPC.';
comment on column infra.ejecuciones_job.resumen is
  'Valor de retorno del job (conteos, ids), redactado de secretos y acotado en
   tamaño por el middleware. Nunca tokens, certificados ni credenciales.';

-- Última ejecución por job (el tablero hace distinct on (job_id) order by desc).
create index if not exists idx_ejecuciones_job_job_iniciado
  on infra.ejecuciones_job (job_id, iniciado_en desc);
-- Última ejecución EXITOSA por job (watchdog de crons stale).
create index if not exists idx_ejecuciones_job_ok
  on infra.ejecuciones_job (job_id, finalizado_en desc)
  where estado = 'ok';
-- Barrido de fallos recientes / conteos 24h y prune por antigüedad.
create index if not exists idx_ejecuciones_job_iniciado
  on infra.ejecuciones_job (iniciado_en);

-- =============================================================================
-- 2. RPC public.job_run_registrar — upsert idempotente de una fila de run
-- -----------------------------------------------------------------------------
-- El middleware la llama 2-3 veces por run:
--   'ejecutando' (onRunStart) → INSERT con iniciado_en = now().
--   'ok'         (onRunComplete) → UPDATE: finalizado_en, duracion_ms, resumen.
--   'error'      (onRunError, fallo final) → UPDATE: finalizado_en, error.
-- ON CONFLICT (run_id): si 'ok'/'error' llega sin un 'ejecutando' previo
-- (onRunStart no disparó por algún edge case), el INSERT crea la fila igual
-- (duracion_ms queda NULL — duración desconocida, aceptable).
--
-- SECURITY DEFINER con search_path fijo (infra, pg_temp): mismo patrón seguro
-- que rate_limit_consumir. El definer (postgres) tiene BYPASSRLS.
-- =============================================================================
create or replace function public.job_run_registrar(
  p_run_id    text,
  p_estado    text,
  p_job_id    text,
  p_evento    text     default null,
  p_tenant_id uuid     default null,
  p_intento   integer  default null,
  p_resumen   jsonb    default null,
  p_error     text     default null
) returns void
language plpgsql
security definer
set search_path = infra, pg_temp
as $$
declare
  v_final boolean := p_estado in ('ok','error');
begin
  if p_estado not in ('ejecutando','ok','error') then
    raise exception 'job_run_registrar: estado inválido "%" (esperado ejecutando|ok|error)', p_estado
      using errcode = '22023'; -- invalid_parameter_value
  end if;
  if p_run_id is null or p_job_id is null then
    raise exception 'job_run_registrar: run_id y job_id son obligatorios'
      using errcode = '22023';
  end if;

  insert into infra.ejecuciones_job as e (
    run_id, job_id, evento, tenant_id, estado, intento,
    iniciado_en, finalizado_en, duracion_ms, resumen, error, actualizado_en
  ) values (
    p_run_id, p_job_id, p_evento, p_tenant_id, p_estado, p_intento,
    now(),
    case when v_final then now() else null end,
    null,                       -- sin inicio previo no hay duración fiable
    p_resumen, p_error, now()
  )
  on conflict (run_id) do update set
    estado        = excluded.estado,
    evento        = coalesce(e.evento, excluded.evento),
    tenant_id     = coalesce(excluded.tenant_id, e.tenant_id),
    intento       = coalesce(excluded.intento, e.intento),
    finalizado_en = case when v_final then now() else e.finalizado_en end,
    duracion_ms   = case
                      when v_final
                      then greatest(0, floor(extract(epoch from (now() - e.iniciado_en)) * 1000)::int)
                      else e.duracion_ms
                    end,
    resumen       = coalesce(excluded.resumen, e.resumen),
    error         = coalesce(excluded.error, e.error),
    actualizado_en = now();

  -- Prune oportunista (~1% de las llamadas): retención ~30 días, sin cron extra.
  if random() < 0.01 then
    delete from infra.ejecuciones_job
    where iniciado_en < now() - interval '30 days';
  end if;
end;
$$;

comment on function public.job_run_registrar(text, text, text, text, uuid, integer, jsonb, text) is
  'Upsert idempotente de una fila de telemetría de run de job (keyed por run_id).
   estado ejecutando|ok|error; en ok/error calcula duracion_ms desde iniciado_en.
   EXECUTE exclusivo de service_role (la llama el middleware server-side).
   Incluye prune oportunista (~1%) de runs con más de 30 días.';

-- =============================================================================
-- 3. RPC public.salud_jobs_resumen — última ejecución (y última exitosa) por job
-- -----------------------------------------------------------------------------
-- Alimenta el tablero de salud del super-admin (admin/salud). Una fila por
-- job_id con el estado del último run, la última ejecución exitosa, y conteos
-- de las últimas 24h para detectar rachas de fallos.
-- =============================================================================
create or replace function public.salud_jobs_resumen()
returns table (
  job_id          text,
  evento          text,
  estado          text,
  tenant_id       uuid,
  iniciado_en     timestamptz,
  finalizado_en   timestamptz,
  duracion_ms     integer,
  error           text,
  ultimo_ok_en    timestamptz,
  ejecuciones_24h bigint,
  errores_24h     bigint
)
language sql
security definer
set search_path = infra, pg_temp
as $$
  with ultimas as (
    select distinct on (job_id)
      job_id, evento, estado, tenant_id, iniciado_en, finalizado_en, duracion_ms, error
    from infra.ejecuciones_job
    order by job_id, iniciado_en desc
  ),
  ultimas_ok as (
    select distinct on (job_id) job_id, finalizado_en as ultimo_ok_en
    from infra.ejecuciones_job
    where estado = 'ok'
    order by job_id, finalizado_en desc
  ),
  conteos as (
    select job_id,
      count(*)                                   as ejecuciones_24h,
      count(*) filter (where estado = 'error')   as errores_24h
    from infra.ejecuciones_job
    where iniciado_en > now() - interval '24 hours'
    group by job_id
  )
  select
    u.job_id, u.evento, u.estado, u.tenant_id, u.iniciado_en, u.finalizado_en,
    u.duracion_ms, u.error, ok.ultimo_ok_en,
    coalesce(c.ejecuciones_24h, 0), coalesce(c.errores_24h, 0)
  from ultimas u
  left join ultimas_ok ok using (job_id)
  left join conteos    c  using (job_id)
  order by
    -- Primero lo que requiere atención: en error, luego nunca-exitoso, luego por recencia.
    (u.estado = 'error') desc,
    (ok.ultimo_ok_en is null) desc,
    u.iniciado_en desc;
$$;

comment on function public.salud_jobs_resumen() is
  'Resumen de salud de jobs para el tablero del super-admin: última ejecución,
   última exitosa y conteos 24h por job_id. EXECUTE exclusivo de service_role.';

-- =============================================================================
-- 4. Seguridad — deny-by-default total (igual que infra.rate_limit_contadores)
-- =============================================================================

-- 4.1 Tabla: RLS forzada SIN políticas. Solo BYPASSRLS (definer/service_role) accede.
alter table infra.ejecuciones_job enable row level security;
alter table infra.ejecuciones_job force  row level security;

-- 4.2 Grants de tabla: REVOKE a roles de PostgREST, GRANT solo a service_role.
--     (El schema `infra` ya tiene USAGE solo para service_role — migración 0010.)
revoke all on infra.ejecuciones_job from public, anon, authenticated;
grant select, insert, update, delete on infra.ejecuciones_job to service_role;

-- 4.3 RPCs: revocar el EXECUTE que Postgres/Supabase otorgan por defecto y
--     concederlo solo a service_role.
revoke execute on function public.job_run_registrar(text, text, text, text, uuid, integer, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.job_run_registrar(text, text, text, text, uuid, integer, jsonb, text)
  to service_role;

revoke execute on function public.salud_jobs_resumen() from public, anon, authenticated;
grant execute on function public.salud_jobs_resumen() to service_role;
