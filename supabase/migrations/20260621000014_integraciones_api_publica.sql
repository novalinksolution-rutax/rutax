-- =============================================================================
-- 0014 · Schema `integraciones` — API pública /api/v1/ y webhooks salientes
-- =============================================================================
-- Crea el schema NUEVO `integraciones` y sus cuatro tablas base:
--   1. api_keys              — claves API por tenant para /api/v1/ (hash, nunca claro)
--   2. webhook_endpoints     — URLs externas suscritas a eventos del courier
--   3. webhook_outbox        — cola persistente de entrega (la lee un job Inngest)
--   4. idempotencia_requests — cache de respuestas por Idempotency-Key
--
-- Aislamiento (igual al resto del proyecto; el contrato es la BD, no la app):
--   - api_keys y webhook_endpoints: P1 estricta, SOLO roles internos del courier
--     (claim_tipo_usuario() = 'interno' y tenant_id = claim_tenant_id()). Ningún
--     seller ni conductor las ve jamás. SELECT + gestión (INSERT/UPDATE/DELETE)
--     para internos. Espejo en public.* con security_invoker = true (PostgREST).
--   - webhook_outbox e idempotencia_requests: SOLO sistema. RLS activa + FORCE
--     sin políticas para authenticated/anon => inalcanzables salvo service_role
--     (que bypasea RLS por diseño). Los jobs Inngest usan crearClienteServiceRole().
--     No se exponen como vistas en public.
--
-- Secretos: webhook_endpoints.secreto_firma_ref es una referencia OPACA a
-- identidad.secretos_cifrados — la clave HMAC de firma NUNCA vive en esta tabla
-- de negocio ni en texto plano. api_keys guarda solo el hash SHA-256 de la clave;
-- la clave completa se muestra una sola vez al generarla y jamás se persiste.
--
-- Migración IDEMPOTENTE: CREATE SCHEMA/TABLE/INDEX IF NOT EXISTS, DROP POLICY IF
-- EXISTS antes de CREATE POLICY, triggers con DROP previo. Re-aplicable.
--
-- Contrato de claims (heredado de Fase A / migración 0003):
--   identidad.claim_tenant_id()    → uuid del tenant del JWT
--   identidad.claim_tipo_usuario() → 'interno' | 'seller' | 'conductor' | …
-- =============================================================================

-- =============================================================================
-- 0. Schema nuevo
-- =============================================================================
create schema if not exists integraciones;

grant usage on schema integraciones to authenticated, service_role;

-- =============================================================================
-- 1. integraciones.api_keys — claves API por tenant para /api/v1/
-- =============================================================================
create table if not exists integraciones.api_keys (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references identidad.tenants (id) on delete cascade,

  -- Etiqueta humana de la clave (ej. "Integración ERP"). Única por tenant.
  nombre            text not null,

  -- Primeros 8 chars de la clave, EN CLARO, solo para que el usuario identifique
  -- cuál es cuál en la lista (ej. "ak_abc123"). No es secreto por sí mismo.
  prefijo           text not null,

  -- SHA-256 hex de la clave COMPLETA. NUNCA se guarda la clave en texto plano:
  -- la autenticación recalcula el hash de la clave entrante y compara aquí.
  hash_clave        text not null,

  -- Permisos otorgados a esta clave (ej. "pedidos:leer", "liquidaciones:leer",
  -- "webhooks:gestionar"). El gating fino vive en la capa /api/v1/.
  permisos          text[] not null default '{}',

  estado            text not null default 'activa'
    constraint api_keys_estado_valido check (estado in ('activa', 'revocada')),

  -- Se actualiza en cada llamada autenticada exitosa (observabilidad de uso).
  ultima_llamada_en timestamptz,

  creada_en         timestamptz not null default now(),
  revocada_en       timestamptz,

  constraint api_keys_tenant_nombre_uk unique (tenant_id, nombre)
);

comment on table integraciones.api_keys is
  'Claves API por tenant (courier) para autenticar llamadas a /api/v1/. RLS P1
   estricta, solo roles internos. Sellers/conductores nunca. Espejo en public.';
comment on column integraciones.api_keys.prefijo is
  'Primeros 8 chars de la clave EN CLARO, solo para identificarla en la lista.';
comment on column integraciones.api_keys.hash_clave is
  'SHA-256 hex de la clave completa. NUNCA la clave en texto plano: se compara hash.';

create index if not exists idx_api_keys_tenant
  on integraciones.api_keys (tenant_id);
-- Lookup rápido por hash en cada autenticación de /api/v1/.
create index if not exists idx_api_keys_hash_clave
  on integraciones.api_keys (hash_clave);
create index if not exists idx_api_keys_tenant_estado
  on integraciones.api_keys (tenant_id, estado);

-- =============================================================================
-- 2. integraciones.webhook_endpoints — URLs externas suscritas a eventos
-- =============================================================================
create table if not exists integraciones.webhook_endpoints (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references identidad.tenants (id) on delete cascade,

  -- Destino de entrega. Solo HTTPS (CHECK abajo).
  url                text not null,

  -- Eventos suscritos (ej. "pedido.entregado", "liquidacion.emitida").
  eventos            text[] not null default '{}',

  -- Referencia OPACA a identidad.secretos_cifrados con la clave HMAC de firma —
  -- la clave NUNCA vive aquí en claro. ON DELETE SET NULL: si se purga el secreto,
  -- el endpoint queda sin firma (la capa de entrega lo trata como no firmable).
  secreto_firma_ref  uuid references identidad.secretos_cifrados (id) on delete set null,

  activo             boolean not null default true,
  reintentos_max     int not null default 3,

  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),

  constraint webhook_endpoints_url_https check (url like 'https://%')
);

comment on table integraciones.webhook_endpoints is
  'Endpoints HTTPS externos suscritos a eventos del courier. RLS P1 estricta,
   solo roles internos. secreto_firma_ref es referencia opaca a secretos_cifrados
   (clave HMAC) — nunca en claro. Espejo en public.';
comment on column integraciones.webhook_endpoints.secreto_firma_ref is
  'Referencia opaca a identidad.secretos_cifrados con la clave HMAC de firma. Jamás el valor.';

create index if not exists idx_webhook_endpoints_tenant
  on integraciones.webhook_endpoints (tenant_id);
create index if not exists idx_webhook_endpoints_tenant_activo
  on integraciones.webhook_endpoints (tenant_id, activo);

drop trigger if exists trg_webhook_endpoints_actualizado_en on integraciones.webhook_endpoints;
create trigger trg_webhook_endpoints_actualizado_en
  before update on integraciones.webhook_endpoints
  for each row execute function identidad.set_actualizado_en();

-- =============================================================================
-- 3. integraciones.webhook_outbox — cola persistente de entrega (solo sistema)
-- =============================================================================
create table if not exists integraciones.webhook_outbox (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  endpoint_id        uuid not null references integraciones.webhook_endpoints (id) on delete cascade,

  evento_tipo        text not null,
  payload            jsonb not null default '{}',

  estado             text not null default 'pendiente'
    constraint webhook_outbox_estado_valido
      check (estado in ('pendiente', 'enviando', 'enviado', 'fallido', 'descartado')),

  intento_num        int not null default 0,
  proximo_intento_en timestamptz not null default now(),
  ultimo_error       text,

  creado_en          timestamptz not null default now(),
  enviado_en         timestamptz
);

comment on table integraciones.webhook_outbox is
  'Cola persistente de webhooks a entregar. Un job Inngest (service_role) lista
   pendientes por (estado, proximo_intento_en) y entrega con reintentos. SOLO
   sistema: RLS + FORCE sin políticas para clientes; inalcanzable salvo service_role.';

create index if not exists idx_webhook_outbox_tenant
  on integraciones.webhook_outbox (tenant_id);
-- El job lista pendientes vencidos por este índice.
create index if not exists idx_webhook_outbox_estado_proximo
  on integraciones.webhook_outbox (estado, proximo_intento_en);
create index if not exists idx_webhook_outbox_endpoint
  on integraciones.webhook_outbox (endpoint_id);

-- =============================================================================
-- 4. integraciones.idempotencia_requests — cache de respuestas Idempotency-Key
-- =============================================================================
create table if not exists integraciones.idempotencia_requests (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  idempotency_key   text not null,

  metodo            text not null,
  ruta              text not null,
  respuesta_status  int not null,
  respuesta_body    jsonb not null default '{}',

  expira_en         timestamptz not null default (now() + interval '24 hours'),
  creada_en         timestamptz not null default now(),

  constraint idempotencia_requests_tenant_key_uk unique (tenant_id, idempotency_key)
);

comment on table integraciones.idempotencia_requests is
  'Cache de respuestas por Idempotency-Key para /api/v1/: un reintento del cliente
   devuelve la respuesta original en vez de re-ejecutar. SOLO sistema: RLS + FORCE
   sin políticas para clientes; inalcanzable salvo service_role. Limpieza por expira_en.';

-- El UNIQUE ya cubre lookups por (tenant_id, idempotency_key); índice explícito
-- por idempotencia documental + claridad de intención.
create index if not exists idx_idempotencia_tenant_key
  on integraciones.idempotencia_requests (tenant_id, idempotency_key);
-- Barrido de expirados.
create index if not exists idx_idempotencia_expira
  on integraciones.idempotencia_requests (expira_en);

-- =============================================================================
-- 5. RLS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 5.1 integraciones.api_keys — P1 estricta, solo internos. SELECT + gestión.
-- -----------------------------------------------------------------------------
alter table integraciones.api_keys enable row level security;
alter table integraciones.api_keys force row level security;

drop policy if exists api_keys_solo_interno_lee on integraciones.api_keys;
create policy api_keys_solo_interno_lee
  on integraciones.api_keys
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists api_keys_solo_interno_gestiona_insert on integraciones.api_keys;
create policy api_keys_solo_interno_gestiona_insert
  on integraciones.api_keys
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists api_keys_solo_interno_gestiona_update on integraciones.api_keys;
create policy api_keys_solo_interno_gestiona_update
  on integraciones.api_keys
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

drop policy if exists api_keys_solo_interno_gestiona_delete on integraciones.api_keys;
create policy api_keys_solo_interno_gestiona_delete
  on integraciones.api_keys
  for delete
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

-- -----------------------------------------------------------------------------
-- 5.2 integraciones.webhook_endpoints — P1 estricta, solo internos. SELECT + gestión.
-- -----------------------------------------------------------------------------
alter table integraciones.webhook_endpoints enable row level security;
alter table integraciones.webhook_endpoints force row level security;

drop policy if exists webhook_endpoints_solo_interno_lee on integraciones.webhook_endpoints;
create policy webhook_endpoints_solo_interno_lee
  on integraciones.webhook_endpoints
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists webhook_endpoints_solo_interno_gestiona_insert on integraciones.webhook_endpoints;
create policy webhook_endpoints_solo_interno_gestiona_insert
  on integraciones.webhook_endpoints
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists webhook_endpoints_solo_interno_gestiona_update on integraciones.webhook_endpoints;
create policy webhook_endpoints_solo_interno_gestiona_update
  on integraciones.webhook_endpoints
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

drop policy if exists webhook_endpoints_solo_interno_gestiona_delete on integraciones.webhook_endpoints;
create policy webhook_endpoints_solo_interno_gestiona_delete
  on integraciones.webhook_endpoints
  for delete
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

-- -----------------------------------------------------------------------------
-- 5.3 integraciones.webhook_outbox — SOLO sistema (service_role). Sin políticas
--     para clientes: RLS + FORCE => cero filas visibles para authenticated/anon.
-- -----------------------------------------------------------------------------
alter table integraciones.webhook_outbox enable row level security;
alter table integraciones.webhook_outbox force row level security;
revoke all on integraciones.webhook_outbox from authenticated, anon, public;

-- -----------------------------------------------------------------------------
-- 5.4 integraciones.idempotencia_requests — SOLO sistema (service_role). Igual.
-- -----------------------------------------------------------------------------
alter table integraciones.idempotencia_requests enable row level security;
alter table integraciones.idempotencia_requests force row level security;
revoke all on integraciones.idempotencia_requests from authenticated, anon, public;

-- =============================================================================
-- 6. Vistas en public con security_invoker = true (solo para tablas de internos)
-- =============================================================================
-- Espejos para PostgREST. webhook_outbox e idempotencia_requests NO se exponen:
-- son de sistema y deben quedar fuera del alcance de la API de datos del cliente.
create or replace view public.api_keys
  with (security_invoker = true)
  as select * from integraciones.api_keys;

comment on view public.api_keys is
  'Espejo de integraciones.api_keys para PostgREST. RLS heredada: P1 solo interno.
   hash_clave nunca es secreto recuperable (es un hash); la clave en claro no se persiste.';

create or replace view public.webhook_endpoints
  with (security_invoker = true)
  as select * from integraciones.webhook_endpoints;

comment on view public.webhook_endpoints is
  'Espejo de integraciones.webhook_endpoints para PostgREST. RLS heredada: P1 solo
   interno. secreto_firma_ref es referencia opaca; la clave HMAC no se expone.';

-- =============================================================================
-- 7. Grants
-- =============================================================================

-- api_keys y webhook_endpoints: internos gestionan vía las políticas RLS de §5.
-- Privilegios directos sobre la tabla base requeridos por security_invoker.
grant select, insert, update, delete on integraciones.api_keys          to authenticated;
grant select, insert, update, delete on integraciones.webhook_endpoints to authenticated;

grant select, insert, update, delete on public.api_keys          to authenticated;
grant select, insert, update, delete on public.webhook_endpoints to authenticated;

-- service_role: escritura plena sobre las cuatro tablas (jobs Inngest, API /v1).
grant select, insert, update, delete on integraciones.api_keys              to service_role;
grant select, insert, update, delete on integraciones.webhook_endpoints     to service_role;
grant select, insert, update, delete on integraciones.webhook_outbox        to service_role;
grant select, insert, update, delete on integraciones.idempotencia_requests to service_role;

grant select, insert, update, delete on public.api_keys          to service_role;
grant select, insert, update, delete on public.webhook_endpoints to service_role;
