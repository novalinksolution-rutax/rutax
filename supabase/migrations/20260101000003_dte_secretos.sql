-- =============================================================================
-- Migración 0003 · Onboarding DTE y secretos cifrados
-- =============================================================================
-- Crea `courier_config_dte`, `folios_caf` y `secretos_cifrados`. Las tres son
-- de uso puramente interno (RLS P1 estricta, SIN P2/P3 — ningún seller ni
-- conductor las ve jamás, §8.2).
--
-- Patrón de secretos (§5.1): las tablas de configuración SOLO guardan una
-- referencia opaca (`*_ref`) a `secretos_cifrados`; el valor cifrado nunca
-- aparece en una tabla de negocio. `secretos_cifrados` es la tabla más
-- restrictiva del esquema: ni siquiera se expone como vista en `public` —
-- solo accesible vía `service_role` (cifrado/descifrado vive en `integraciones`).
--
-- Idempotente: guards en cada objeto.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'estado_certificacion_dte') then
    create type identidad.estado_certificacion_dte as enum ('pendiente', 'en_proceso', 'activo', 'con_problemas');
  end if;

  if not exists (select 1 from pg_type where typname = 'estado_folio_caf') then
    create type identidad.estado_folio_caf as enum ('vigente', 'agotado', 'vencido');
  end if;

  if not exists (select 1 from pg_type where typname = 'tipo_secreto') then
    -- Cierra el conjunto de secretos que el cimiento conoce. `integraciones`
    -- puede ampliar esta lista en sus propias migraciones si surgen otros tipos.
    create type identidad.tipo_secreto as enum (
      'certificado_digital_courier',
      'credenciales_proveedor_dte',
      'token_oauth_ml_access',
      'token_oauth_ml_refresh',
      'archivo_caf'
    );
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. secretos_cifrados — la tabla más restrictiva del esquema
-- -----------------------------------------------------------------------------
-- Guarda el VALOR cifrado (o una referencia al objeto en Storage cifrado, para
-- archivos grandes como el .pfx o el CAF) — nunca el secreto en claro. El
-- cifrado/descifrado lo ejecuta una utilidad central de `integraciones` con
-- clave gestionada (Supabase Vault o equivalente); esta tabla solo persiste.
--
-- Deliberadamente NO se expone una vista en `public.secretos_cifrados`: ni
-- siquiera con RLS activa queremos que aparezca en el listado de la API de
-- datos. Acceso exclusivo vía `service_role` desde funciones/jobs auditados.
create table if not exists identidad.secretos_cifrados (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references identidad.tenants (id) on delete cascade,
  tipo_secreto      identidad.tipo_secreto not null,
  -- Valor cifrado en reposo (cifrado por la app/integraciones antes de llegar
  -- aquí — esta columna nunca contiene texto plano). bytea para soportar
  -- tanto blobs binarios (certificados) como tokens cifrados serializados.
  valor_cifrado     bytea not null,
  -- Metadatos NO sensibles únicamente (jamás el secreto, ni fragmentos de él).
  -- p.ej. {"alg": "aes-256-gcm", "kid": "vault-key-2026-01", "storage_ref": "..."}
  metadata          jsonb not null default '{}'::jsonb,
  referencia_externa_id uuid not null default gen_random_uuid(),
  vence_en          timestamptz,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  constraint secretos_cifrados_metadata_sin_secretos check (
    -- Defensa en profundidad: bloquea claves comunes de fuga accidental
    -- (no reemplaza la disciplina de capa de aplicación, la respalda).
    not (metadata ? 'valor')
    and not (metadata ? 'token')
    and not (metadata ? 'password')
    and not (metadata ? 'secret')
    and not (metadata ? 'access_token')
    and not (metadata ? 'refresh_token')
  )
);

comment on table identidad.secretos_cifrados is
  'Almacén separado de valores cifrados (certificados, credenciales DTE, tokens
   OAuth ML). Nunca expuesto en vistas normales ni a seller/conductor — solo
   service_role vía utilidades de integraciones. Las tablas de negocio guardan
   referencia_externa_id como "*_ref" opaca, jamás el valor.';

create index if not exists secretos_cifrados_tenant_id_idx on identidad.secretos_cifrados (tenant_id);
create unique index if not exists secretos_cifrados_referencia_externa_uk on identidad.secretos_cifrados (referencia_externa_id);

drop trigger if exists trg_secretos_cifrados_actualizado_en on identidad.secretos_cifrados;
create trigger trg_secretos_cifrados_actualizado_en
  before update on identidad.secretos_cifrados
  for each row execute function identidad.set_actualizado_en();

-- RLS activa igual (defensa en profundidad) pero SIN políticas para
-- `authenticated`/`anon`: con FORCE RLS y cero políticas, ningún rol de
-- cliente puede ver ni una fila — únicamente `service_role` (que bypassa RLS
-- por diseño de Postgres/Supabase) o `postgres` vía función auditada.
alter table identidad.secretos_cifrados enable row level security;
alter table identidad.secretos_cifrados force row level security;

-- Higiene de permisos explícita: revocar cualquier grant heredado a roles de
-- cliente. No se otorga nada a authenticated/anon a propósito.
revoke all on identidad.secretos_cifrados from authenticated, anon, public;

-- -----------------------------------------------------------------------------
-- 3. courier_config_dte — 1:1 con tenants. Solo referencias opacas.
-- -----------------------------------------------------------------------------
create table if not exists identidad.courier_config_dte (
  tenant_id                   uuid primary key references identidad.tenants (id) on delete cascade,
  proveedor_dte               text not null,
  -- Referencias opacas a identidad.secretos_cifrados.referencia_externa_id —
  -- NUNCA el valor. Sin FK física a propósito: mantiene secretos_cifrados
  -- desacoplada y no exponible vía joins desde tablas de negocio expuestas.
  proveedor_credenciales_ref  uuid,
  certificado_digital_ref     uuid,
  certificado_vence_en        date,
  estado_certificacion        identidad.estado_certificacion_dte not null default 'pendiente',
  creado_en                   timestamptz not null default now(),
  actualizado_en              timestamptz not null default now()
);

comment on table identidad.courier_config_dte is
  'Configuración de facturación DTE del courier (1:1 con tenants). Solo guarda
   referencias opacas a secretos_cifrados — nunca certificados ni credenciales
   en claro. Visible solo a roles internos con permiso financiero (dueño/administración).';

drop trigger if exists trg_courier_config_dte_actualizado_en on identidad.courier_config_dte;
create trigger trg_courier_config_dte_actualizado_en
  before update on identidad.courier_config_dte
  for each row execute function identidad.set_actualizado_en();

create or replace view public.courier_config_dte
  with (security_invoker = true)
  as select * from identidad.courier_config_dte;

-- -----------------------------------------------------------------------------
-- 4. folios_caf
-- -----------------------------------------------------------------------------
create table if not exists identidad.folios_caf (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identidad.tenants (id) on delete cascade,
  tipo_documento  smallint not null,
  folio_desde     bigint not null,
  folio_hasta     bigint not null,
  folio_actual    bigint not null,
  -- Referencia opaca al archivo CAF cifrado en Storage/secretos_cifrados.
  archivo_caf_ref uuid,
  estado          identidad.estado_folio_caf not null default 'vigente',
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),

  constraint folios_caf_rango_valido check (folio_desde <= folio_hasta),
  constraint folios_caf_actual_en_rango check (folio_actual between folio_desde and folio_hasta + 1)
);

comment on table identidad.folios_caf is
  'Folios CAF por tipo de documento SII. Dato puramente interno/tributario — si
   el proveedor DTE gestiona folios por el courier, esta tabla puede reducirse
   a espejo de solo-lectura (decisión pendiente de integraciones, §5 nota de alcance).';

create index if not exists folios_caf_tenant_id_idx on identidad.folios_caf (tenant_id);
create index if not exists folios_caf_tenant_tipo_idx on identidad.folios_caf (tenant_id, tipo_documento);

drop trigger if exists trg_folios_caf_actualizado_en on identidad.folios_caf;
create trigger trg_folios_caf_actualizado_en
  before update on identidad.folios_caf
  for each row execute function identidad.set_actualizado_en();

create or replace view public.folios_caf
  with (security_invoker = true)
  as select * from identidad.folios_caf;

-- -----------------------------------------------------------------------------
-- 5. RLS — courier_config_dte y folios_caf: P1 estricta, SIN P2/P3 (§8.2)
-- -----------------------------------------------------------------------------
-- Ambas son "solo roles internos" — no hay distinción seller/conductor porque
-- directamente no tienen acceso. La distinción fina dueño/administración vs.
-- supervisor/coordinador es regla de aplicación (RNF-03), no política RLS
-- (evita explosión combinatoria rol×tabla, §4).
alter table identidad.courier_config_dte enable row level security;
alter table identidad.courier_config_dte force row level security;

drop policy if exists courier_config_dte_select_interno on identidad.courier_config_dte;
create policy courier_config_dte_select_interno
  on identidad.courier_config_dte
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists courier_config_dte_insert_interno on identidad.courier_config_dte;
create policy courier_config_dte_insert_interno
  on identidad.courier_config_dte
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists courier_config_dte_update_interno on identidad.courier_config_dte;
create policy courier_config_dte_update_interno
  on identidad.courier_config_dte
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

-- Guard de defensa en profundidad — mismo patrón que `conductores`/
-- `conexiones_seller_ml`/`sellers`/`tarifas` (`identidad.solo_interno_edita`,
-- definida en la migración 0002): convierte el "UPDATE 0" silencioso que
-- vería un seller/conductor autenticado en un 42501 explícito y auditable.
drop trigger if exists trg_courier_config_dte_solo_interno_edita on identidad.courier_config_dte;
create trigger trg_courier_config_dte_solo_interno_edita
  before update on identidad.courier_config_dte
  for each statement execute function identidad.solo_interno_edita();

alter table identidad.folios_caf enable row level security;
alter table identidad.folios_caf force row level security;

drop policy if exists folios_caf_select_interno on identidad.folios_caf;
create policy folios_caf_select_interno
  on identidad.folios_caf
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists folios_caf_insert_interno on identidad.folios_caf;
create policy folios_caf_insert_interno
  on identidad.folios_caf
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists folios_caf_update_interno on identidad.folios_caf;
create policy folios_caf_update_interno
  on identidad.folios_caf
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

-- Guard de defensa en profundidad — mismo patrón que las demás tablas
-- "solo interno" (`identidad.solo_interno_edita`, migración 0002): 42501
-- explícito en vez de "UPDATE 0" silencioso ante un UPDATE de seller/conductor.
drop trigger if exists trg_folios_caf_solo_interno_edita on identidad.folios_caf;
create trigger trg_folios_caf_solo_interno_edita
  before update on identidad.folios_caf
  for each statement execute function identidad.solo_interno_edita();

-- -----------------------------------------------------------------------------
-- 6. Grants de API (secretos_cifrados queda DELIBERADAMENTE fuera de todo esto:
--    sin vista en `public`, sin privilegios de tabla, inalcanzable para
--    authenticated/anon — únicamente service_role. Ver §2 de esta migración.)
-- -----------------------------------------------------------------------------
-- Privilegios directos sobre las tablas base en `identidad` — requeridos por
-- las vistas `security_invoker = true` de `public` para que RLS se evalúe con
-- los privilegios/claims del rol que consulta. Detalle en migración 0001 §9.
grant select, insert, update on identidad.courier_config_dte to authenticated;
grant select, insert, update on identidad.folios_caf to authenticated;

grant select, insert, update on public.courier_config_dte to authenticated;
grant select, insert, update on public.folios_caf to authenticated;
