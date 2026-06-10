-- =============================================================================
-- Migración 0001 · Identidad — cimiento multi-tenant
-- =============================================================================
-- Crea: esquema `identidad`, enums base, tabla raíz `tenants`, `usuarios_perfil`
-- (1:1 con auth.users), `invitaciones`, y el mecanismo de claims JWT
-- (custom access token hook) del que depende TODO el esquema de RLS posterior.
--
-- Idempotente: usa IF NOT EXISTS / OR REPLACE / DO $$ ... $$ guards en todos
-- los objetos para poder re-aplicarse sin error sobre una base ya migrada.
--
-- Contrato de claims (lo que el resto de migraciones y `backend` consumen):
--   auth.jwt() ->> 'tenant_id'    -- uuid as text, o NULL si super_admin
--   auth.jwt() ->> 'tipo_usuario' -- 'interno' | 'seller' | 'conductor' | 'super_admin'
--   auth.jwt() ->> 'seller_id'    -- uuid as text, NULL salvo tipo_usuario='seller'
--   auth.jwt() ->> 'driver_id'    -- uuid as text, NULL salvo tipo_usuario='conductor'
--   auth.jwt() ->> 'rol'          -- enum identidad.rol_usuario as text
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Esquemas y extensiones
-- -----------------------------------------------------------------------------
create schema if not exists identidad;

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Enums (creación idempotente vía DO-block: CREATE TYPE no soporta IF NOT EXISTS)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'estado_tenant') then
    create type identidad.estado_tenant as enum ('activo', 'suspendido', 'onboarding');
  end if;

  if not exists (select 1 from pg_type where typname = 'tipo_usuario') then
    create type identidad.tipo_usuario as enum ('interno', 'seller', 'conductor', 'super_admin');
  end if;

  if not exists (select 1 from pg_type where typname = 'rol_usuario') then
    create type identidad.rol_usuario as enum (
      'super_admin',
      'dueno',
      'supervisor',
      'coordinador',
      'administracion',
      'conductor',
      'seller'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'estado_usuario') then
    create type identidad.estado_usuario as enum ('activo', 'invitado', 'suspendido');
  end if;

  if not exists (select 1 from pg_type where typname = 'estado_invitacion') then
    create type identidad.estado_invitacion as enum ('pendiente', 'aceptada', 'expirada', 'revocada');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Función utilitaria de timestamps (actualizado_en)
-- -----------------------------------------------------------------------------
create or replace function identidad.set_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Tabla raíz: tenants (= courier). Sin tenant_id — es la raíz.
-- -----------------------------------------------------------------------------
create table if not exists identidad.tenants (
  id               uuid primary key default gen_random_uuid(),
  nombre_fantasia  text not null,
  razon_social     text not null,
  rut              text not null,
  estado           identidad.estado_tenant not null default 'onboarding',
  plan_id          text not null default 'estandar',
  zona_horaria     text not null default 'America/Santiago',
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  constraint tenants_rut_formato check (rut ~ '^[0-9]{1,8}-[0-9kK]$')
);

comment on table identidad.tenants is
  'Tenant raíz = empresa courier. 1 fila = 1 suscripción. No lleva tenant_id.';

create unique index if not exists tenants_rut_uk on identidad.tenants (rut);

drop trigger if exists trg_tenants_actualizado_en on identidad.tenants;
create trigger trg_tenants_actualizado_en
  before update on identidad.tenants
  for each row execute function identidad.set_actualizado_en();

-- View pública de conveniencia (expuesta vía PostgREST en `public`).
-- NOTA: Postgres no soporta "CREATE VIEW IF NOT EXISTS"; usamos CREATE OR REPLACE,
-- que es idempotente para vistas con la misma firma de columnas.
create or replace view public.tenants
  with (security_invoker = true)
  as select * from identidad.tenants;

comment on view public.tenants is
  'Espejo de identidad.tenants para exponer vía API. RLS se hereda de la tabla base
   gracias a security_invoker = true.';

-- -----------------------------------------------------------------------------
-- 4. usuarios_perfil — 1:1 con auth.users. Pieza central de RBAC y de claims.
-- -----------------------------------------------------------------------------
create table if not exists identidad.usuarios_perfil (
  id               uuid primary key references auth.users (id) on delete cascade,
  tenant_id        uuid references identidad.tenants (id) on delete restrict,
  nombre_completo  text not null,
  tipo_usuario     identidad.tipo_usuario not null default 'interno',
  -- seller_id/driver_id referencian tablas creadas en la migración 0002.
  -- Se agregan como columnas nulas aquí y la FK se añade allá (evita dependencia circular
  -- de creación; el contrato de columnas vive desde el día 1 en esta migración).
  seller_id        uuid,
  driver_id        uuid,
  rol              identidad.rol_usuario not null,
  estado           identidad.estado_usuario not null default 'invitado',
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),

  -- Reglas de consistencia de dominio: el contrato de §3 del documento de arquitectura.
  constraint usuarios_perfil_tenant_excepto_super_admin check (
    (tipo_usuario = 'super_admin' and tenant_id is null)
    or (tipo_usuario <> 'super_admin' and tenant_id is not null)
  ),
  constraint usuarios_perfil_seller_id_coherente check (
    (tipo_usuario = 'seller' and seller_id is not null)
    or (tipo_usuario <> 'seller' and seller_id is null)
  ),
  constraint usuarios_perfil_driver_id_coherente check (
    (tipo_usuario = 'conductor' and driver_id is not null)
    or (tipo_usuario <> 'conductor' and driver_id is null)
  ),
  constraint usuarios_perfil_rol_coherente_con_tipo check (
    (tipo_usuario = 'super_admin' and rol = 'super_admin')
    or (tipo_usuario = 'seller' and rol = 'seller')
    or (tipo_usuario = 'conductor' and rol = 'conductor')
    or (tipo_usuario = 'interno' and rol in ('dueno', 'supervisor', 'coordinador', 'administracion'))
  )
);

comment on table identidad.usuarios_perfil is
  'Identidad de dominio 1:1 con auth.users: tenant, tipo, rol, y vínculo a seller/conductor.
   Fuente de verdad de los claims inyectados al JWT por el custom access token hook.';

create index if not exists usuarios_perfil_tenant_id_idx on identidad.usuarios_perfil (tenant_id);
create index if not exists usuarios_perfil_seller_id_idx on identidad.usuarios_perfil (seller_id) where seller_id is not null;
create index if not exists usuarios_perfil_driver_id_idx on identidad.usuarios_perfil (driver_id) where driver_id is not null;

drop trigger if exists trg_usuarios_perfil_actualizado_en on identidad.usuarios_perfil;
create trigger trg_usuarios_perfil_actualizado_en
  before update on identidad.usuarios_perfil
  for each row execute function identidad.set_actualizado_en();

create or replace view public.usuarios_perfil
  with (security_invoker = true)
  as select * from identidad.usuarios_perfil;

-- -----------------------------------------------------------------------------
-- 5. invitaciones
-- -----------------------------------------------------------------------------
create table if not exists identidad.invitaciones (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identidad.tenants (id) on delete cascade,
  email           text not null,
  tipo_usuario    identidad.tipo_usuario not null,
  rol             identidad.rol_usuario not null,
  seller_id       uuid,
  driver_id       uuid,
  token           text not null,
  estado          identidad.estado_invitacion not null default 'pendiente',
  expira_en       timestamptz not null,
  creado_en       timestamptz not null default now(),

  constraint invitaciones_tipo_no_super_admin check (tipo_usuario <> 'super_admin'),
  constraint invitaciones_seller_id_coherente check (
    (tipo_usuario = 'seller' and seller_id is not null)
    or (tipo_usuario <> 'seller' and seller_id is null)
  ),
  constraint invitaciones_driver_id_coherente check (
    (tipo_usuario = 'conductor' and driver_id is not null)
    or (tipo_usuario <> 'conductor' and driver_id is null)
  )
);

comment on table identidad.invitaciones is
  'Invitación de un solo uso: cubre alta interna, onboarding de seller y de conductor.
   Se resuelve por token (fuera de RLS normal); no expone listado a seller/conductor.';

create unique index if not exists invitaciones_token_uk on identidad.invitaciones (token);
create index if not exists invitaciones_tenant_id_idx on identidad.invitaciones (tenant_id);
create index if not exists invitaciones_email_idx on identidad.invitaciones (lower(email));

create or replace view public.invitaciones
  with (security_invoker = true)
  as select * from identidad.invitaciones;

-- =============================================================================
-- 6. Mecanismo de claims JWT — Custom Access Token Hook
-- =============================================================================
-- Supabase Auth invoca esta función ANTES de emitir cada access token (login,
-- refresh). Lee usuarios_perfil del usuario y agrega tenant_id/tipo_usuario/
-- seller_id/driver_id/rol como claims de primer nivel del JWT.
--
-- Las políticas RLS leen `(auth.jwt() ->> 'tenant_id')::uuid`, etc. — sin
-- subselects por fila, rápido y fácil de razonar.
--
-- Requisitos de Supabase para hooks de Postgres:
--   - Vive en un esquema NO expuesto por la API de datos (usamos `identidad`,
--     que no está en `api.schemas` de config.toml).
--   - El rol `supabase_auth_admin` necesita USAGE sobre el esquema y EXECUTE
--     sobre la función (otorgado abajo). No debe ser ejecutable por `authenticated`
--     ni `anon` — un usuario nunca debe poder fabricar sus propios claims.
--   - Debe ser robusta ante perfiles inexistentes/incompletos: si no hay perfil
--     (p. ej. usuario recién creado, aún no aprovisionado), no agrega claims de
--     negocio y el usuario queda sin acceso a filas de negocio (RLS lo bloquea
--     por defecto al no calzar tenant_id).
-- =============================================================================
create or replace function identidad.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = identidad, public
as $$
declare
  claims     jsonb;
  perfil     identidad.usuarios_perfil%rowtype;
  usuario_id uuid;
begin
  usuario_id := (event ->> 'user_id')::uuid;
  claims     := coalesce(event -> 'claims', '{}'::jsonb);

  select up.* into perfil
  from identidad.usuarios_perfil up
  where up.id = usuario_id;

  if not found then
    -- Sin perfil de negocio todavía: no inyectamos claims de tenant/rol.
    -- El usuario queda autenticado pero sin acceso a tablas de negocio (RLS
    -- exige tenant_id = claim.tenant_id, que aquí será NULL).
    event := jsonb_set(event, '{claims}', claims);
    return event;
  end if;

  claims := claims
    || jsonb_build_object('tenant_id', perfil.tenant_id)
    || jsonb_build_object('tipo_usuario', perfil.tipo_usuario)
    || jsonb_build_object('seller_id', perfil.seller_id)
    || jsonb_build_object('driver_id', perfil.driver_id)
    || jsonb_build_object('rol', perfil.rol)
    || jsonb_build_object('estado_usuario', perfil.estado);

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

comment on function identidad.custom_access_token_hook(jsonb) is
  'Custom Access Token Hook (Supabase Auth): inyecta tenant_id/tipo_usuario/
   seller_id/driver_id/rol/estado_usuario al JWT desde usuarios_perfil. Toda
   política RLS de tres capas (P1 tenant / P2 seller / P3 conductor) depende
   de estos claims. Configurado en supabase/config.toml [auth.hook.custom_access_token].';

-- Permisos del hook: solo el rol interno de Auth puede ejecutarlo.
-- (revoke primero por idempotencia / higiene si alguna vez se otorgó de más)
revoke all on function identidad.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant usage on schema identidad to supabase_auth_admin;
grant execute on function identidad.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- SECURITY DEFINER hace que la función corra como su owner (postgres/superuser),
-- lo que bypasea RLS al leer identidad.usuarios_perfil para construir los claims.

-- -----------------------------------------------------------------------------
-- 7. Funciones auxiliares de claims (para usar dentro de políticas RLS)
-- -----------------------------------------------------------------------------
-- Encapsulan el parseo de auth.jwt() para que las políticas sean legibles y
-- para tener un solo lugar que tocar si cambia la forma del claim.
create or replace function identidad.claim_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'tenant_id', '')::uuid
$$;

create or replace function identidad.claim_tipo_usuario()
returns text
language sql
stable
as $$
  select auth.jwt() ->> 'tipo_usuario'
$$;

create or replace function identidad.claim_seller_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'seller_id', '')::uuid
$$;

create or replace function identidad.claim_driver_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'driver_id', '')::uuid
$$;

comment on function identidad.claim_tenant_id() is 'Lee tenant_id del JWT (claim inyectado por el custom access token hook).';
comment on function identidad.claim_tipo_usuario() is 'Lee tipo_usuario del JWT: interno | seller | conductor | super_admin.';
comment on function identidad.claim_seller_id() is 'Lee seller_id del JWT (NULL salvo tipo_usuario = seller).';
comment on function identidad.claim_driver_id() is 'Lee driver_id del JWT (NULL salvo tipo_usuario = conductor).';

grant execute on function identidad.claim_tenant_id() to authenticated, anon;
grant execute on function identidad.claim_tipo_usuario() to authenticated, anon;
grant execute on function identidad.claim_seller_id() to authenticated, anon;
grant execute on function identidad.claim_driver_id() to authenticated, anon;

-- =============================================================================
-- 8. RLS — tenants, usuarios_perfil, invitaciones
-- =============================================================================

-- --- tenants --------------------------------------------------------------
-- Cada usuario (no super_admin) ve solo la fila de SU tenant. No hay política
-- de bypass para super_admin: sus operaciones van por funciones service_role
-- auditadas (§8.3 del documento de arquitectura).
alter table identidad.tenants enable row level security;
alter table identidad.tenants force row level security;

drop policy if exists tenants_select_propio on identidad.tenants;
create policy tenants_select_propio
  on identidad.tenants
  for select
  to authenticated
  using (id = identidad.claim_tenant_id());

-- Sin políticas de INSERT/UPDATE/DELETE para `authenticated`: el alta y
-- mantenimiento de tenants es responsabilidad de funciones service_role
-- (alta de tenant RF-006, suspensión, soporte super_admin), todas auditadas.
-- FORCE RLS + ausencia de política de escritura = ningún rol de cliente escribe aquí.

-- --- usuarios_perfil -------------------------------------------------------
-- P1 (tenant) + regla "su propia fila" para seller/conductor (equivalente a P2/P3
-- aquí: la única fila propia visible es la suya). Los internos ven todo su tenant.
alter table identidad.usuarios_perfil enable row level security;
alter table identidad.usuarios_perfil force row level security;

drop policy if exists usuarios_perfil_select on identidad.usuarios_perfil;
create policy usuarios_perfil_select
  on identidad.usuarios_perfil
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or id = auth.uid()
    )
  );

-- Un usuario puede actualizar campos no sensibles de SU PROPIA fila (p. ej.
-- nombre_completo). No puede cambiar tenant_id/rol/tipo_usuario/estado — eso
-- se controla mejor en backend (verificación de columnas) + función service_role
-- para cambios de rol (auditados). Mantenemos la política de UPDATE acotada a
-- "su propia fila dentro de su tenant"; la inmutabilidad de columnas sensibles
-- la garantiza un trigger.
drop policy if exists usuarios_perfil_update_propio on identidad.usuarios_perfil;
create policy usuarios_perfil_update_propio
  on identidad.usuarios_perfil
  for update
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and id = auth.uid()
  )
  with check (
    tenant_id = identidad.claim_tenant_id()
    and id = auth.uid()
  );

create or replace function identidad.usuarios_perfil_proteger_columnas_sensibles()
returns trigger
language plpgsql
as $$
begin
  -- Solo aplica a updates ejecutados como `authenticated` (el cliente). Las
  -- funciones service_role (rol→cambio, suspensión) usan service_role y
  -- pasan por bitácora; no las bloqueamos aquí.
  --
  -- NOTA — por qué NO hay aquí un guard de "fila ajena ⇒ 42501" (a diferencia
  -- de `sellers`/`tarifas`/`invitaciones`, ver `identidad.solo_interno_edita`):
  -- la política `usuarios_perfil_update_propio` ya exige `using (id = auth.uid())`,
  -- así que un seller/conductor que apunta a la fila de OTRO usuario nunca
  -- llega a este disparador FOR EACH ROW — RLS la excluye ANTES de que el
  -- trigger se evalúe fila por fila, y Postgres reporta "UPDATE 0" sin pasar
  -- por aquí (confirmado empíricamente: un trigger por fila jamás ve filas que
  -- el `using` ya filtró). Un guard `old.id <> auth.uid()` en este disparador
  -- sería código muerto — nunca se ejecutaría en el escenario que pretende
  -- cubrir. Y a diferencia de `sellers`/`tarifas` (donde CUALQUIER intento de
  -- escritura por un no-interno es ilegítimo y un guard de sentencia puede
  -- lanzar 42501 sin mirar la fila), aquí el self-update SÍ es legítimo — no
  -- existe forma de distinguir "apunto a mi propia fila" de "apunto a la fila
  -- ajena" sin inspeccionar el WHERE, algo que ningún disparador puede hacer.
  --
  -- Esa ambigüedad ("UPDATE 0" tanto si la fila no existe como si es ajena) es
  -- aquí CORRECTA y deseable: ambos casos producen la misma respuesta, sin
  -- oracle que permita a un atacante distinguir "existe pero no es mía" de
  -- "no existe" — exactamente la propiedad de no-fuga que sí faltaba en
  -- `sellers`/`tarifas` (donde el atacante SÍ puede *ver* la fila vía SELECT,
  -- así que el "UPDATE 0" en una fila visible es una inconsistencia confusa
  -- y no-auditable, no una protección).
  if auth.role() = 'authenticated' then
    if new.tenant_id is distinct from old.tenant_id
       or new.tipo_usuario is distinct from old.tipo_usuario
       or new.rol is distinct from old.rol
       or new.estado is distinct from old.estado
       or new.seller_id is distinct from old.seller_id
       or new.driver_id is distinct from old.driver_id then
      raise exception using
        errcode = '42501',
        message = 'No autorizado: tenant_id, tipo_usuario, rol, estado, seller_id y driver_id solo se modifican vía funciones internas auditadas';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_usuarios_perfil_proteger_columnas on identidad.usuarios_perfil;
create trigger trg_usuarios_perfil_proteger_columnas
  before update on identidad.usuarios_perfil
  for each row execute function identidad.usuarios_perfil_proteger_columnas_sensibles();

-- Sin política de INSERT/DELETE para `authenticated`: el aprovisionamiento de
-- perfiles ocurre vía función service_role al aceptar invitación / aprovisionar
-- tenant (auditado). Esto evita que cualquiera se autoasigne tenant_id/rol.

-- --- invitaciones ----------------------------------------------------------
-- P1 estricta. Sin acceso de seller/conductor (se resuelven por token, fuera
-- de RLS normal — el flujo de aceptar invitación usa función service_role que
-- valida el token y crea el perfil). Lectura/gestión solo roles internos.
alter table identidad.invitaciones enable row level security;
alter table identidad.invitaciones force row level security;

drop policy if exists invitaciones_select_interno on identidad.invitaciones;
create policy invitaciones_select_interno
  on identidad.invitaciones
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists invitaciones_insert_interno on identidad.invitaciones;
create policy invitaciones_insert_interno
  on identidad.invitaciones
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists invitaciones_update_interno on identidad.invitaciones;
create policy invitaciones_update_interno
  on identidad.invitaciones
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

-- Sin DELETE: una invitación se revoca cambiando `estado`, no se borra
-- (trazabilidad). La aceptación por token corre vía función service_role
-- (no requiere que el invitado tenga ya sesión con claims del tenant).

-- -----------------------------------------------------------------------------
-- 9. Grants de API (PostgREST)
-- -----------------------------------------------------------------------------
-- Las vistas en `public` se crean con `security_invoker = true` para que RLS
-- se evalúe con los privilegios y claims del ROL QUE CONSULTA (authenticated/
-- anon), no con los del dueño de la vista (`postgres`, que tiene
-- rolbypassrls = true y vería todo — convertiría la vista en un bypass de RLS
-- de facto). La contraparte de `security_invoker = true`: el rol que consulta
-- necesita privilegios DIRECTOS sobre la tabla base, no solo sobre la vista.
-- Por eso, además del grant sobre la vista en `public`, se otorgan:
--   1. USAGE sobre el esquema `identidad` (sin esto, "permission denied for
--      schema identidad" — el esquema sigue sin estar en api.schemas, así que
--      PostgREST no genera endpoints directos sobre él; solo es alcanzable a
--      través de las vistas de `public`).
--   2. SELECT/INSERT/UPDATE sobre las tablas base correspondientes — siempre
--      filtrados por las políticas RLS ya definidas arriba (FORCE ROW LEVEL
--      SECURITY se aplica también a estos roles no-superusuario).
--
-- `secretos_cifrados` queda deliberadamente FUERA de estos grants (migración
-- 0003): ni vista en `public`, ni USAGE, ni privilegios de tabla — la tabla es
-- estructuralmente inalcanzable para `authenticated`/`anon`.
grant usage on schema identidad to authenticated, anon;

grant select on identidad.tenants to authenticated;
grant select, update on identidad.usuarios_perfil to authenticated;
grant select, insert, update on identidad.invitaciones to authenticated;

grant select on public.tenants to authenticated;
grant select, update on public.usuarios_perfil to authenticated;
grant select, insert, update on public.invitaciones to authenticated;
