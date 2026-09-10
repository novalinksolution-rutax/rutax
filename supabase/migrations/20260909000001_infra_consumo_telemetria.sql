-- =============================================================================
-- 20260909000001 · Infra — Módulo Consumo: telemetría de costo y uso de plataforma
-- =============================================================================
-- Observabilidad de PLATAFORMA (interna de Rutax): cuánto cuesta y cuánto usan
-- los couriers/conductores las APIs de pago (Google Route Optimization, Compute
-- Routes, Geocoding, WhatsApp, Resend) y las cuotas gratuitas (ML). El courier
-- NUNCA lee su consumo — exponerlo sería una decisión nueva que abre RLS.
--
-- Modelo: DENY-ALL en el schema `infra`, NO tabla de negocio con tenant_id+RLS.
-- Aunque dar de alta un courier agrega filas, cumple el carve-out completo igual
-- que `infra.ejecuciones_job` (migración 20260709000002, el molde de este archivo):
--   (1) solo el super-admin la lee, cross-tenant, para decidir sobre costos;
--   (2) `tenant_id` es columna de TRIAJE, no frontera de aislamiento;
--   (3) solo `service_role` escribe/lee.
-- => RLS forzada SIN políticas + REVOKE a authenticated/anon + SIN vista espejo
--    en `public` + RPCs security definer como única superficie (EXECUTE service_role).
--
-- Idempotente: IF NOT EXISTS / OR REPLACE; REVOKE/GRANT re-aplicables.
-- Diseño: docs/arquitectura/consumo-telemetria.md · Precios: consumo-precios-apis.md
-- =============================================================================

create schema if not exists infra;

-- =============================================================================
-- 1. infra.precios_consumo — tarifario versionado por vigente_desde
-- =============================================================================
create table if not exists infra.precios_consumo (
  proveedor_costo     text          not null,
  sku                 text          not null default '',
  vigente_desde       date          not null,
  precio_unitario_usd numeric(12,6) not null,
  unidad              text          not null
                        check (unidad in ('parada','request','mensaje','email','llamada')),
  free_tier_mensual   numeric,                 -- unidades gratis/mes de PLATAFORMA (no por courier)
  nota                text,
  primary key (proveedor_costo, sku, vigente_desde)
);

comment on table infra.precios_consumo is
  'Tarifario versionado por vigente_desde para el módulo Consumo. free_tier_mensual
   es de PLATAFORMA (por proveedor/SKU/mes), no por courier — Google retiró el
   crédito común en 2025. Fuente: docs/arquitectura/consumo-precios-apis.md.
   Deny-all: RLS forzada sin políticas, grants solo a service_role.';

-- Seed (idempotente por PK). Precios verificados el 2026-09-09.
insert into infra.precios_consumo
  (proveedor_costo, sku, vigente_desde, precio_unitario_usd, unidad, free_tier_mensual, nota)
values
  ('google_route_optimization', 'single_vehicle', date '2026-09-09', 0.010000, 'parada',  5000, 'Single Vehicle Routing (2020-AA6E-7D49): cobra por parada, 1 vehiculo/request.'),
  ('google_route_optimization', 'fleet',          date '2026-09-09', 0.030000, 'parada',  1000, 'Fleet Routing (08E0-0D24-6C8E): cobra por parada, >=2 vehiculos/request.'),
  ('google_compute_routes',     'essentials',     date '2026-09-09', 0.005000, 'request', 10000, 'Routes API Compute Routes Essentials: cobra por request.'),
  ('google_geocoding',          '',               date '2026-09-09', 0.005000, 'request', 10000, 'Geocoding API (BAC8-4E68-E261): cobra por request; solo llamada real, no cache hit.'),
  ('whatsapp_cloud',            'utility',         date '2026-09-09', 0.007700, 'mensaje', null,  'Plantilla utility (el aviso de retiro). ~$0.0077 es Rest of World: verificar rate card Chile (CLP desde 1-abr-2026).'),
  ('whatsapp_cloud',            'marketing',       date '2026-09-09', 0.060400, 'mensaje', null,  'Plantilla marketing (Chile). ~$0.0604: verificar rate card Chile.'),
  ('resend',                    '',               date '2026-09-09', 0.000000, 'email',   3000,  'Free: 3000/mes, tope 100/dia — el gatillo real es el tope diario.'),
  ('ml',                        '',               date '2026-09-09', 0.000000, 'llamada', null,  'Mercado Libre gratis: se cuenta para vigilar la cuota de tasa (~1500 req/min/seller), no el gasto.')
on conflict (proveedor_costo, sku, vigente_desde) do nothing;

-- =============================================================================
-- 2. infra.eventos_consumo — el crudo (bigint identity, por volumen)
-- =============================================================================
create table if not exists infra.eventos_consumo (
  id                  bigint generated always as identity primary key,
  ocurrido_en         timestamptz   not null default now(),
  tenant_id           uuid,                    -- triaje, no frontera
  usuario_id          uuid,
  tipo_usuario        text,
  tipo_evento         text          not null,
  superficie          text          not null
                        check (superficie in ('api_route','server_action','adaptador','job','cron')),
  recurso             text,
  proveedor_costo     text,
  sku                 text,
  unidades            numeric(12,3) not null default 1,
  costo_estimado_usd  numeric(12,6),
  dentro_free_tier    boolean,
  resultado           text,
  correlacion_id      text,
  metadata            jsonb,                   -- REDACTADO: nunca coordenadas, direcciones, nombres ni tokens
  clave_idempotencia  text
);

comment on table infra.eventos_consumo is
  'Crudo de telemetría de consumo de plataforma (una fila por evento de costo/uso).
   tenant_id es dato de TRIAJE, no frontera. metadata SIEMPRE redactada. Retencion
   ~90 dias via prune oportunista en la RPC; agregados en infra.consumo_mensual.
   Deny-all: RLS forzada sin politicas, grants solo a service_role.';
comment on column infra.eventos_consumo.metadata is
  'JSON redactado: solo conteos, SKUs y codigos de estado. JAMAS coordenadas,
   direcciones, nombres, domicilio del conductor ni tokens.';

-- Idempotencia de eventos con reintento (WhatsApp, geocoding): indice unico parcial.
create unique index if not exists uq_eventos_consumo_idempotencia
  on infra.eventos_consumo (clave_idempotencia)
  where clave_idempotencia is not null;

create index if not exists idx_eventos_consumo_ocurrido
  on infra.eventos_consumo (ocurrido_en);
create index if not exists idx_eventos_consumo_tenant_ocurrido
  on infra.eventos_consumo (tenant_id, ocurrido_en);
create index if not exists idx_eventos_consumo_tenant_usuario_ocurrido
  on infra.eventos_consumo (tenant_id, usuario_id, ocurrido_en);
create index if not exists idx_eventos_consumo_proveedor_ocurrido
  on infra.eventos_consumo (proveedor_costo, ocurrido_en)
  where proveedor_costo is not null;
create index if not exists idx_eventos_consumo_tipo_ocurrido
  on infra.eventos_consumo (tipo_evento, ocurrido_en);

-- =============================================================================
-- 3. infra.consumo_mensual — materializacion mensual para tendencias
-- =============================================================================
-- Poblada por el cron antes de podar el crudo. tenant_id/usuario_id/proveedor_costo
-- son nullable (triaje); una PK natural con NULLs no impone unicidad, asi que se
-- usa surrogate identity + indice unico sobre las claves COALESCE-adas.
create table if not exists infra.consumo_mensual (
  id               bigint generated always as identity primary key,
  tenant_id        uuid,
  usuario_id       uuid,
  tipo_evento      text,
  proveedor_costo  text,
  mes              date          not null,     -- primer dia del mes
  total_unidades   numeric,
  total_costo_usd  numeric(14,6)
);

comment on table infra.consumo_mensual is
  'Agregado mensual del consumo (poblado por cron antes de podar el crudo de 90 dias).
   Granularidad: (tenant, usuario, tipo_evento, proveedor, mes). Deny-all.';

-- Unicidad de la granularidad tolerando NULLs (que un indice comun trataria como distintos).
create unique index if not exists uq_consumo_mensual_granularidad
  on infra.consumo_mensual (
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(usuario_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(tipo_evento, ''),
    coalesce(proveedor_costo, ''),
    mes
  );

-- =============================================================================
-- 4. RPC public.consumo_registrar — escritura idempotente con calculo de costo
-- -----------------------------------------------------------------------------
-- Resuelve el precio vigente (vigente_desde <= ahora, el mas reciente para ese
-- proveedor+sku), calcula costo_estimado_usd = unidades × precio, marca
-- dentro_free_tier si el precio es 0, inserta. Idempotente por clave_idempotencia
-- (ON CONFLICT sobre el indice unico PARCIAL, repitiendo su predicado como arbitro).
-- Prune oportunista (~1%): crudo con mas de 90 dias.
-- =============================================================================
create or replace function public.consumo_registrar(
  p_tipo_evento        text,
  p_superficie         text,
  p_tenant_id          uuid          default null,
  p_usuario_id         uuid          default null,
  p_tipo_usuario       text          default null,
  p_recurso            text          default null,
  p_proveedor_costo    text          default null,
  p_sku                text          default null,
  p_unidades           numeric       default 1,
  p_resultado          text          default null,
  p_correlacion_id     text          default null,
  p_metadata           jsonb         default null,
  p_clave_idempotencia text          default null,
  p_ocurrido_en        timestamptz   default null
) returns bigint
language plpgsql
security definer
set search_path = infra, pg_temp
as $$
declare
  v_ocurrido       timestamptz := coalesce(p_ocurrido_en, now());
  v_precio         numeric;
  v_free_tier      numeric;
  v_costo          numeric(12,6);
  v_dentro_free    boolean;
  v_id             bigint;
begin
  if p_tipo_evento is null or p_superficie is null then
    raise exception 'consumo_registrar: tipo_evento y superficie son obligatorios'
      using errcode = '22023';
  end if;
  if p_superficie not in ('api_route','server_action','adaptador','job','cron') then
    raise exception 'consumo_registrar: superficie inválida "%"', p_superficie
      using errcode = '22023';
  end if;

  -- Precio vigente para el proveedor+sku a la fecha del evento (el mas reciente).
  if p_proveedor_costo is not null then
    select pc.precio_unitario_usd, pc.free_tier_mensual
      into v_precio, v_free_tier
    from infra.precios_consumo pc
    where pc.proveedor_costo = p_proveedor_costo
      and pc.sku = coalesce(p_sku, '')
      and pc.vigente_desde <= v_ocurrido::date
    order by pc.vigente_desde desc
    limit 1;
  end if;

  if v_precio is not null then
    v_costo := round(coalesce(p_unidades, 0) * v_precio, 6);
    -- dentro_free_tier informativo: precio 0 (ML/Resend free) => siempre dentro;
    -- si hay free_tier definido, el "gasto" nace en 0 hasta agotarlo (el corte real
    -- por acumulado mensual lo decide el agregador, aqui solo el flag de precio-0).
    v_dentro_free := (v_precio = 0);
  else
    -- Sin proveedor de costo o sin precio (p.ej. fallback local haversine): sin costo.
    v_costo := null;
    v_dentro_free := null;
  end if;

  insert into infra.eventos_consumo (
    ocurrido_en, tenant_id, usuario_id, tipo_usuario, tipo_evento, superficie,
    recurso, proveedor_costo, sku, unidades, costo_estimado_usd, dentro_free_tier,
    resultado, correlacion_id, metadata, clave_idempotencia
  ) values (
    v_ocurrido, p_tenant_id, p_usuario_id, p_tipo_usuario, p_tipo_evento, p_superficie,
    p_recurso, p_proveedor_costo, p_sku, coalesce(p_unidades, 1), v_costo, v_dentro_free,
    p_resultado, p_correlacion_id, p_metadata, p_clave_idempotencia
  )
  on conflict (clave_idempotencia) where clave_idempotencia is not null
  do nothing
  returning id into v_id;

  -- Prune oportunista (~1%): retencion ~90 dias del crudo, sin cron extra.
  if random() < 0.01 then
    delete from infra.eventos_consumo
    where ocurrido_en < now() - interval '90 days';
  end if;

  return v_id;  -- NULL si el evento era duplicado (idempotente)
end;
$$;

comment on function public.consumo_registrar(text, text, uuid, uuid, text, text, text, text, numeric, text, text, jsonb, text, timestamptz) is
  'Registra un evento de consumo de plataforma calculando costo_estimado_usd desde
   infra.precios_consumo (precio vigente por proveedor+sku). Idempotente por
   clave_idempotencia. EXECUTE exclusivo de service_role. Prune oportunista (~1%)
   del crudo con mas de 90 dias. Retorna el id insertado (NULL si duplicado).';

-- =============================================================================
-- 5. RPCs de lectura (agregacion) — EXECUTE solo service_role. tenant POR PARAMETRO.
-- =============================================================================

-- 5.1 Costo/uso por courier (tenant) en la ventana.
create or replace function public.consumo_por_courier(
  desde timestamptz,
  hasta timestamptz
) returns table (
  tenant_id      uuid,
  eventos        bigint,
  total_unidades numeric,
  total_costo_usd numeric
)
language sql
security definer
set search_path = infra, pg_temp
as $$
  select
    e.tenant_id,
    count(*)                             as eventos,
    coalesce(sum(e.unidades), 0)         as total_unidades,
    coalesce(sum(e.costo_estimado_usd), 0) as total_costo_usd
  from infra.eventos_consumo e
  where e.ocurrido_en >= desde and e.ocurrido_en < hasta
  group by e.tenant_id
  order by total_costo_usd desc nulls last;
$$;

comment on function public.consumo_por_courier(timestamptz, timestamptz) is
  'Agregado de consumo por courier (tenant) en la ventana. EXECUTE solo service_role.';

-- 5.2 Costo/uso por conductor (usuario) dentro de un courier.
create or replace function public.consumo_por_conductor(
  p_tenant_id uuid,
  desde timestamptz,
  hasta timestamptz
) returns table (
  usuario_id     uuid,
  eventos        bigint,
  total_unidades numeric,
  total_costo_usd numeric
)
language sql
security definer
set search_path = infra, pg_temp
as $$
  select
    e.usuario_id,
    count(*)                             as eventos,
    coalesce(sum(e.unidades), 0)         as total_unidades,
    coalesce(sum(e.costo_estimado_usd), 0) as total_costo_usd
  from infra.eventos_consumo e
  where e.tenant_id = p_tenant_id
    and e.ocurrido_en >= desde and e.ocurrido_en < hasta
  group by e.usuario_id
  order by total_costo_usd desc nulls last;
$$;

comment on function public.consumo_por_conductor(uuid, timestamptz, timestamptz) is
  'Agregado de consumo por conductor (usuario) dentro de un courier. tenant POR
   PARAMETRO, nunca por claim. EXECUTE solo service_role.';

-- 5.3 Costo/uso por proveedor (donde va la plata / la cuota).
create or replace function public.consumo_por_proveedor(
  desde timestamptz,
  hasta timestamptz
) returns table (
  proveedor_costo text,
  sku             text,
  eventos         bigint,
  total_unidades  numeric,
  total_costo_usd numeric
)
language sql
security definer
set search_path = infra, pg_temp
as $$
  select
    e.proveedor_costo,
    e.sku,
    count(*)                             as eventos,
    coalesce(sum(e.unidades), 0)         as total_unidades,
    coalesce(sum(e.costo_estimado_usd), 0) as total_costo_usd
  from infra.eventos_consumo e
  where e.ocurrido_en >= desde and e.ocurrido_en < hasta
  group by e.proveedor_costo, e.sku
  order by total_costo_usd desc nulls last;
$$;

comment on function public.consumo_por_proveedor(timestamptz, timestamptz) is
  'Agregado de consumo por proveedor+sku en la ventana. EXECUTE solo service_role.';

-- 5.4 Uso por tipo de evento (agrupa por tipo_evento × usuario × proveedor).
-- El esquema `infra` NO está expuesto a PostgREST (y config.toml no aplica al
-- hosted), así que la agregación por tipo_evento —que las 3 RPCs de arriba no
-- hacen— DEBE pasar por una RPC en `public`, no por un `.schema('infra')` directo
-- (que fallaría en prod con PGRST106). Cubre "costo por entrega" (filtrar
-- tipo_evento='entrega.cerrar') y los KPIs de Uso (reoptimizaciones/conductor,
-- reordenamientos, ratio local-vs-proveedor).
create or replace function public.consumo_uso_por_tipo(
  desde timestamptz,
  hasta timestamptz
) returns table (
  tipo_evento     text,
  usuario_id      uuid,
  proveedor_costo text,
  eventos         bigint
)
language sql
security definer
set search_path = infra, pg_temp
as $$
  select
    e.tipo_evento,
    e.usuario_id,
    e.proveedor_costo,
    count(*) as eventos
  from infra.eventos_consumo e
  where e.ocurrido_en >= desde and e.ocurrido_en < hasta
  group by e.tipo_evento, e.usuario_id, e.proveedor_costo;
$$;

comment on function public.consumo_uso_por_tipo(timestamptz, timestamptz) is
  'Consumo agrupado por tipo_evento × usuario × proveedor en la ventana. Única
   superficie pública para leer eventos por tipo (infra no está expuesto a
   PostgREST). EXECUTE solo service_role.';

-- 5.5 Free tier vigente por proveedor+sku a una fecha (el tarifario más reciente).
create or replace function public.consumo_precios_vigentes(
  p_hasta date
) returns table (
  proveedor_costo   text,
  sku               text,
  free_tier_mensual numeric
)
language sql
security definer
set search_path = infra, pg_temp
as $$
  select distinct on (pc.proveedor_costo, pc.sku)
    pc.proveedor_costo,
    pc.sku,
    pc.free_tier_mensual
  from infra.precios_consumo pc
  where pc.vigente_desde <= p_hasta
  order by pc.proveedor_costo, pc.sku, pc.vigente_desde desc;
$$;

comment on function public.consumo_precios_vigentes(date) is
  'Free tier mensual vigente (más reciente con vigente_desde <= p_hasta) por
   proveedor+sku. EXECUTE solo service_role.';

-- =============================================================================
-- 6. Seguridad — deny-by-default total (igual que infra.ejecuciones_job)
-- =============================================================================

-- 6.1 Tablas: RLS forzada SIN politicas. Solo BYPASSRLS (definer/service_role) accede.
alter table infra.eventos_consumo  enable row level security;
alter table infra.eventos_consumo  force  row level security;
alter table infra.precios_consumo  enable row level security;
alter table infra.precios_consumo  force  row level security;
alter table infra.consumo_mensual  enable row level security;
alter table infra.consumo_mensual  force  row level security;

-- 6.2 Grants de tabla: REVOKE a roles de PostgREST, GRANT solo a service_role.
revoke all on infra.eventos_consumo from public, anon, authenticated;
revoke all on infra.precios_consumo from public, anon, authenticated;
revoke all on infra.consumo_mensual from public, anon, authenticated;
grant select, insert, update, delete on infra.eventos_consumo to service_role;
grant select, insert, update, delete on infra.precios_consumo to service_role;
grant select, insert, update, delete on infra.consumo_mensual to service_role;

-- 6.3 RPCs: revocar el EXECUTE por defecto y concederlo solo a service_role.
revoke execute on function public.consumo_registrar(text, text, uuid, uuid, text, text, text, text, numeric, text, text, jsonb, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.consumo_registrar(text, text, uuid, uuid, text, text, text, text, numeric, text, text, jsonb, text, timestamptz)
  to service_role;

revoke execute on function public.consumo_por_courier(timestamptz, timestamptz) from public, anon, authenticated;
grant  execute on function public.consumo_por_courier(timestamptz, timestamptz) to service_role;

revoke execute on function public.consumo_por_conductor(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant  execute on function public.consumo_por_conductor(uuid, timestamptz, timestamptz) to service_role;

revoke execute on function public.consumo_por_proveedor(timestamptz, timestamptz) from public, anon, authenticated;
grant  execute on function public.consumo_por_proveedor(timestamptz, timestamptz) to service_role;

revoke execute on function public.consumo_uso_por_tipo(timestamptz, timestamptz) from public, anon, authenticated;
grant  execute on function public.consumo_uso_por_tipo(timestamptz, timestamptz) to service_role;

revoke execute on function public.consumo_precios_vigentes(date) from public, anon, authenticated;
grant  execute on function public.consumo_precios_vigentes(date) to service_role;
