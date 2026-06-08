-- =============================================================================
-- Migración 0004 · Tarifas, Conexiones ML y Bitácora de auditoría
-- =============================================================================
-- Cierra el cimiento de Fase A: `tarifas` (insumo del motor entrega→dinero,
-- interna), `conexiones_seller_ml` (P1+P2, el seller ve su propia conexión) y
-- `bitacora_auditoria` (append-only, P1 estricta, solo roles internos con
-- permiso — nunca seller/conductor).
--
-- Idempotente: guards en cada objeto.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tipo_entrega') then
    create type identidad.tipo_entrega as enum ('flex', 'same_day');
  end if;

  if not exists (select 1 from pg_type where typname = 'modo_calculo_tarifa') then
    create type identidad.modo_calculo_tarifa as enum ('monto_fijo', 'por_zona');
  end if;

  if not exists (select 1 from pg_type where typname = 'estado_tarifa') then
    create type identidad.estado_tarifa as enum ('activa', 'inactiva');
  end if;

  if not exists (select 1 from pg_type where typname = 'estado_salud_conexion_ml') then
    create type identidad.estado_salud_conexion_ml as enum ('sana', 'atencion', 'desvinculada', 'pendiente');
  end if;

  if not exists (select 1 from pg_type where typname = 'actor_tipo_auditoria') then
    create type identidad.actor_tipo_auditoria as enum ('usuario', 'sistema', 'super_admin');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. tarifas — interna (insumo del motor entrega→dinero, Fase C)
-- -----------------------------------------------------------------------------
-- Pre-requisito de la FK compuesta (tenant_id, seller_id) -> sellers (tenant_id, id):
-- se necesita una unique constraint sobre (tenant_id, id) en sellers. Debe existir
-- ANTES de crear `tarifas` (que la referencia inline en su DDL).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sellers_tenant_id_id_uk'
  ) then
    alter table identidad.sellers
      add constraint sellers_tenant_id_id_uk unique (tenant_id, id);
  end if;
end $$;

create table if not exists identidad.tarifas (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identidad.tenants (id) on delete cascade,
  -- NULL = tarifa por defecto del tenant; con valor = override específico del seller.
  seller_id       uuid references identidad.sellers (id) on delete cascade,
  tipo_entrega    identidad.tipo_entrega not null,
  zona            text,
  modo_calculo    identidad.modo_calculo_tarifa not null default 'monto_fijo',
  monto_clp       integer not null,
  vigente_desde   date not null,
  vigente_hasta   date,
  estado          identidad.estado_tarifa not null default 'activa',
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),

  constraint tarifas_monto_no_negativo check (monto_clp >= 0),
  constraint tarifas_vigencia_valida check (vigente_hasta is null or vigente_hasta >= vigente_desde),
  constraint tarifas_seller_pertenece_al_tenant
    foreign key (tenant_id, seller_id)
    references identidad.sellers (tenant_id, id)
    -- truco: permite NULL en seller_id (tarifa default del tenant) y, cuando
    -- hay valor, obliga a que ese seller pertenezca al MISMO tenant.
    deferrable initially immediate
);

comment on table identidad.tarifas is
  'Tarifas por seller/tipo de entrega/zona, versionadas por vigencia (no se
   pierde histórico — el motor entrega→dinero de Fase C reconstruye "qué tarifa
   aplicaba" a la fecha de cada entrega). Dato puramente interno: el seller NO
   ve montos pactados (§8.2) — ve su factura final en Fase C.';

create index if not exists tarifas_tenant_id_idx on identidad.tarifas (tenant_id);
create index if not exists tarifas_tenant_seller_idx on identidad.tarifas (tenant_id, seller_id);
create index if not exists tarifas_vigencia_idx on identidad.tarifas (tenant_id, tipo_entrega, vigente_desde, vigente_hasta);

drop trigger if exists trg_tarifas_actualizado_en on identidad.tarifas;
create trigger trg_tarifas_actualizado_en
  before update on identidad.tarifas
  for each row execute function identidad.set_actualizado_en();

create or replace view public.tarifas
  with (security_invoker = true)
  as select * from identidad.tarifas;

-- RLS: P1 estricta, SIN P2 (el seller no ve montos pactados, §8.2). Roles
-- internos con permiso financiero (distinción fina = regla de aplicación).
alter table identidad.tarifas enable row level security;
alter table identidad.tarifas force row level security;

drop policy if exists tarifas_select_interno on identidad.tarifas;
create policy tarifas_select_interno
  on identidad.tarifas
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists tarifas_insert_interno on identidad.tarifas;
create policy tarifas_insert_interno
  on identidad.tarifas
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists tarifas_update_interno on identidad.tarifas;
create policy tarifas_update_interno
  on identidad.tarifas
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

-- -----------------------------------------------------------------------------
-- 3. conexiones_seller_ml — P1 + P2 (el seller ve y puede iniciar reconexión
--    de SU conexión; tokens/salud los escriben solo jobs/service_role)
-- -----------------------------------------------------------------------------
create table if not exists identidad.conexiones_seller_ml (
  id                      uuid primary key default gen_random_uuid(),
  -- tenant_id denormalizado deliberadamente desde sellers (regla de §1/§7):
  -- toda tabla que el seller pueda leer necesita tenant_id directo, sin join,
  -- para que la política de capa-tenant no dependa de subselect.
  tenant_id               uuid not null references identidad.tenants (id) on delete cascade,
  seller_id               uuid not null unique references identidad.sellers (id) on delete cascade,
  ml_user_id              text,
  -- Referencias opacas a secretos_cifrados — NUNCA el token aquí.
  access_token_ref        uuid,
  refresh_token_ref       uuid,
  token_expira_en         timestamptz,
  estado_salud            identidad.estado_salud_conexion_ml not null default 'pendiente',
  ultima_sync_exitosa_en  timestamptz,
  desconectada_desde      timestamptz,
  ultimo_error            text,
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),

  constraint conexiones_seller_ml_seller_pertenece_al_tenant
    foreign key (tenant_id, seller_id)
    references identidad.sellers (tenant_id, id)
);

comment on table identidad.conexiones_seller_ml is
  'Conexión OAuth 1:1 del seller con Mercado Libre (separada de la entidad
   estable `sellers`). tenant_id denormalizado a propósito para que la política
   de capa-tenant del seller no dependa de un join. Tokens cifrados en
   secretos_cifrados — aquí solo referencias opacas. Escritura de tokens/salud:
   solo jobs/service_role; el seller únicamente inicia reconexión vía acción de
   servidor (no edita la fila directo).';

create index if not exists conexiones_seller_ml_tenant_id_idx on identidad.conexiones_seller_ml (tenant_id);
create unique index if not exists conexiones_seller_ml_seller_id_uk on identidad.conexiones_seller_ml (seller_id);

drop trigger if exists trg_conexiones_seller_ml_actualizado_en on identidad.conexiones_seller_ml;
create trigger trg_conexiones_seller_ml_actualizado_en
  before update on identidad.conexiones_seller_ml
  for each row execute function identidad.set_actualizado_en();

-- Trigger de consistencia: tenant_id denormalizado siempre debe coincidir con
-- el tenant del seller referenciado (defensa de la regla de §7, no confiar
-- solo en disciplina de inserción de la app).
create or replace function identidad.conexiones_seller_ml_validar_tenant()
returns trigger
language plpgsql
as $$
declare
  tenant_del_seller uuid;
begin
  select tenant_id into tenant_del_seller
  from identidad.sellers
  where id = new.seller_id;

  if tenant_del_seller is null then
    raise exception 'seller_id % no existe', new.seller_id;
  end if;

  if new.tenant_id is distinct from tenant_del_seller then
    raise exception 'tenant_id denormalizado (%) no coincide con el tenant del seller (%)',
      new.tenant_id, tenant_del_seller;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_conexiones_seller_ml_validar_tenant on identidad.conexiones_seller_ml;
create trigger trg_conexiones_seller_ml_validar_tenant
  before insert or update on identidad.conexiones_seller_ml
  for each row execute function identidad.conexiones_seller_ml_validar_tenant();

create or replace view public.conexiones_seller_ml
  with (security_invoker = true)
  as select * from identidad.conexiones_seller_ml;

alter table identidad.conexiones_seller_ml enable row level security;
alter table identidad.conexiones_seller_ml force row level security;

-- SELECT: internos ven todas las conexiones de su tenant; el seller ve solo
-- la suya (fila.seller_id = claim.seller_id) — RF-048 portal del seller.
--
-- OJO (mismo cuidado que en sellers_select / conductores_select, §8.1 nota):
-- NO escribir esto como `tipo_usuario <> 'seller' or seller_id = claim.seller_id`
-- — esa condición deja pasar también a `conductor` (su tipo_usuario tampoco es
-- 'seller'), exponiendo TODAS las conexiones ML del courier a cualquier
-- usuario-conductor. Se enumeran explícitamente los dos casos permitidos:
-- interno (ve todo su tenant) o seller viendo EXCLUSIVAMENTE su propia conexión.
drop policy if exists conexiones_seller_ml_select on identidad.conexiones_seller_ml;
create policy conexiones_seller_ml_select
  on identidad.conexiones_seller_ml
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or (identidad.claim_tipo_usuario() = 'seller' and seller_id = identidad.claim_seller_id())
    )
  );

-- Escritura: reservada a roles internos / service_role. Los tokens y el
-- estado de salud los gestionan jobs (RF-012/RF-013); "iniciar reconexión"
-- es una acción de servidor (función), no una edición directa de fila por el
-- seller — por eso NO existe política de UPDATE para `tipo_usuario = 'seller'`.
drop policy if exists conexiones_seller_ml_insert_interno on identidad.conexiones_seller_ml;
create policy conexiones_seller_ml_insert_interno
  on identidad.conexiones_seller_ml
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists conexiones_seller_ml_update_interno on identidad.conexiones_seller_ml;
create policy conexiones_seller_ml_update_interno
  on identidad.conexiones_seller_ml
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

-- Mismo guard de defensa en profundidad que en `conductores` (migración 0002,
-- ver `identidad.solo_interno_edita`): el seller SÍ puede *ver* su propia
-- conexión (política de SELECT de arriba), así que un UPDATE suyo no cae en
-- "cero filas visibles" por tenant/seller_id — cae en "cero filas visibles
-- para escritura" (using exige tipo_usuario = 'interno'), lo que Postgres
-- resolvería como "UPDATE 0" silencioso. El disparador por sentencia lanza
-- 42501 explícitamente, tal como espera la suite de aislamiento.
drop trigger if exists trg_conexiones_seller_ml_solo_interno_edita on identidad.conexiones_seller_ml;
create trigger trg_conexiones_seller_ml_solo_interno_edita
  before update on identidad.conexiones_seller_ml
  for each statement execute function identidad.solo_interno_edita();

-- -----------------------------------------------------------------------------
-- 4. bitacora_auditoria — append-only, P1 estricta, solo roles internos
-- -----------------------------------------------------------------------------
create table if not exists identidad.bitacora_auditoria (
  id                bigint generated always as identity primary key,
  -- NULL solo para acciones de plataforma (alta de tenant, soporte super_admin).
  tenant_id         uuid references identidad.tenants (id) on delete restrict,
  actor_usuario_id  uuid references auth.users (id) on delete set null,
  actor_tipo        identidad.actor_tipo_auditoria not null default 'usuario',
  accion            text not null,
  entidad_tipo      text not null,
  entidad_id        uuid,
  -- jsonb sin secretos ni tokens — regla dura (§10). Se valida en aplicación;
  -- aquí se documenta y se añade un guard mínimo de defensa en profundidad.
  detalle           jsonb not null default '{}'::jsonb,
  creado_en         timestamptz not null default now(),

  constraint bitacora_auditoria_detalle_sin_secretos check (
    not (detalle ? 'token')
    and not (detalle ? 'access_token')
    and not (detalle ? 'refresh_token')
    and not (detalle ? 'password')
    and not (detalle ? 'secret')
    and not (detalle ? 'certificado')
    and not (detalle ? 'valor_cifrado')
  ),
  constraint bitacora_auditoria_tenant_nulo_solo_plataforma check (
    tenant_id is not null or actor_tipo = 'super_admin'
  )
);

comment on table identidad.bitacora_auditoria is
  'Bitácora append-only (sin UPDATE/DELETE, ni para dueño). RF-004/RNF-04 — P0.
   tenant_id NULL solo para acciones de plataforma. detalle jsonb NUNCA contiene
   secretos ni tokens (constraint de defensa en profundidad + disciplina de
   aplicación). Visible solo a roles internos con permiso (dueño/administración),
   nunca seller/conductor.';

create index if not exists bitacora_auditoria_tenant_id_idx on identidad.bitacora_auditoria (tenant_id);
create index if not exists bitacora_auditoria_tenant_creado_idx on identidad.bitacora_auditoria (tenant_id, creado_en desc);
create index if not exists bitacora_auditoria_entidad_idx on identidad.bitacora_auditoria (entidad_tipo, entidad_id);

create or replace view public.bitacora_auditoria
  with (security_invoker = true)
  as select * from identidad.bitacora_auditoria;

alter table identidad.bitacora_auditoria enable row level security;
alter table identidad.bitacora_auditoria force row level security;

-- SELECT: solo internos de su tenant. La distinción fina "con permiso"
-- (dueño/administración vs. supervisor/coordinador) es regla de aplicación
-- (RNF-03) — aquí se garantiza, como mínimo, que jamás sale del tenant ni
-- llega a seller/conductor.
drop policy if exists bitacora_auditoria_select_interno on identidad.bitacora_auditoria;
create policy bitacora_auditoria_select_interno
  on identidad.bitacora_auditoria
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

-- INSERT: exclusivamente desde funciones de servidor (service_role) — incluso
-- un usuario interno autenticado normal NO puede insertar directo (evita que
-- alguien fabrique entradas falsas o "limpias" de su propia acción). No se
-- crea política de INSERT para `authenticated`; con FORCE RLS y cero política
-- de escritura, solo `service_role` (que bypassa RLS) puede insertar.
--
-- Sin políticas de UPDATE/DELETE para NINGÚN rol de cliente: append-only real.
-- Ni siquiera se otorgan los privilegios de tabla correspondientes.
revoke update, delete on identidad.bitacora_auditoria from authenticated, anon, public;
revoke insert on identidad.bitacora_auditoria from authenticated, anon, public;

-- -----------------------------------------------------------------------------
-- 5. Grants de API
-- -----------------------------------------------------------------------------
-- Privilegios directos sobre las tablas base en `identidad` — requeridos por
-- las vistas `security_invoker = true` de `public` para que RLS se evalúe con
-- los privilegios/claims del rol que consulta. Detalle en migración 0001 §9.
grant select, insert, update on identidad.tarifas to authenticated;
grant select, insert, update on identidad.conexiones_seller_ml to authenticated;
-- bitacora_auditoria es append-only real: SELECT directo sí (RLS lo acota a
-- internos de su tenant), pero NUNCA INSERT/UPDATE/DELETE para roles de
-- cliente — ni siquiera a nivel de privilegio de tabla (defensa en profundidad,
-- más fuerte que solo "ninguna política lo permite").
grant select on identidad.bitacora_auditoria to authenticated;
revoke insert, update, delete on identidad.bitacora_auditoria from authenticated, anon, public;

grant select, insert, update on public.tarifas to authenticated;
grant select, insert, update on public.conexiones_seller_ml to authenticated;
-- bitacora_auditoria: solo SELECT vía la vista (filtrado por RLS de la base);
-- nunca INSERT/UPDATE/DELETE para roles de cliente.
grant select on public.bitacora_auditoria to authenticated;
revoke insert, update, delete on public.bitacora_auditoria from authenticated, anon, public;
