-- =============================================================================
-- Migración 0002 · Sellers y Conductores — alcances P2/P3
-- =============================================================================
-- Crea `sellers` y `conductores` (identidad básica — operación/dinero los
-- referencian, nunca los duplican, §9 del documento de arquitectura), añade
-- las FKs diferidas desde usuarios_perfil.seller_id/driver_id, y activa RLS
-- de tres capas (P1 tenant, P2 seller, P3 conductor) sobre estas tablas y
-- sobre usuarios_perfil (cierre del alcance P2/P3 iniciado en la migración 0001).
--
-- Idempotente: guards IF NOT EXISTS / OR REPLACE / DO-blocks en cada objeto.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'estado_seller') then
    create type identidad.estado_seller as enum ('invitado', 'activo', 'suspendido');
  end if;

  if not exists (select 1 from pg_type where typname = 'tipo_relacion_conductor') then
    create type identidad.tipo_relacion_conductor as enum ('dependiente', 'independiente');
  end if;

  if not exists (select 1 from pg_type where typname = 'estado_conductor') then
    create type identidad.estado_conductor as enum ('activo', 'inactivo');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Tabla sellers
-- -----------------------------------------------------------------------------
create table if not exists identidad.sellers (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identidad.tenants (id) on delete cascade,
  razon_social    text not null,
  rut             text not null,
  nombre_contacto text,
  email_contacto  text,
  estado          identidad.estado_seller not null default 'invitado',
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),

  constraint sellers_rut_formato check (rut ~ '^[0-9]{1,8}-[0-9kK]$')
);

comment on table identidad.sellers is
  'Cliente del courier (tenant). Identidad de negocio estable; su conexión OAuth
   con Mercado Libre vive separada en conexiones_seller_ml (migración 0004).';

create index if not exists sellers_tenant_id_idx on identidad.sellers (tenant_id);
create unique index if not exists sellers_tenant_rut_uk on identidad.sellers (tenant_id, rut);

drop trigger if exists trg_sellers_actualizado_en on identidad.sellers;
create trigger trg_sellers_actualizado_en
  before update on identidad.sellers
  for each row execute function identidad.set_actualizado_en();

create or replace view public.sellers
  with (security_invoker = true)
  as select * from identidad.sellers;

-- -----------------------------------------------------------------------------
-- 3. Tabla conductores (identidad mínima; "qué hace"/"cuánto se le paga" en
--    Fases B/C referencian esta misma fila — no se duplica, §9).
-- -----------------------------------------------------------------------------
create table if not exists identidad.conductores (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identidad.tenants (id) on delete cascade,
  nombre_completo text not null,
  rut             text not null,
  tipo_relacion   identidad.tipo_relacion_conductor not null,
  estado          identidad.estado_conductor not null default 'activo',
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),

  constraint conductores_rut_formato check (rut ~ '^[0-9]{1,8}-[0-9kK]$')
);

comment on table identidad.conductores is
  'Identidad mínima del conductor (Ley 21.431: tipo_relacion se registra, no se
   infiere). "Qué hace" vive en operación, "cuánto se le paga" en dinero — ambos
   referencian conductores.id.';

create index if not exists conductores_tenant_id_idx on identidad.conductores (tenant_id);
create unique index if not exists conductores_tenant_rut_uk on identidad.conductores (tenant_id, rut);

drop trigger if exists trg_conductores_actualizado_en on identidad.conductores;
create trigger trg_conductores_actualizado_en
  before update on identidad.conductores
  for each row execute function identidad.set_actualizado_en();

create or replace view public.conductores
  with (security_invoker = true)
  as select * from identidad.conductores;

-- -----------------------------------------------------------------------------
-- 4. FKs diferidas desde usuarios_perfil (las columnas nacieron en 0001 para
--    fijar el contrato de claims desde el día 1; las FKs llegan ahora que
--    existen las tablas referenciadas).
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'usuarios_perfil_seller_id_fkey'
  ) then
    alter table identidad.usuarios_perfil
      add constraint usuarios_perfil_seller_id_fkey
      foreign key (seller_id) references identidad.sellers (id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'usuarios_perfil_driver_id_fkey'
  ) then
    alter table identidad.usuarios_perfil
      add constraint usuarios_perfil_driver_id_fkey
      foreign key (driver_id) references identidad.conductores (id) on delete restrict;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5. RLS — sellers (P1 + P2)
-- -----------------------------------------------------------------------------
-- Internos del tenant ven todos los sellers de su tenant; un usuario-seller
-- solo ve su propia fila (fila.id = claim.seller_id). Conductor: no aplica
-- (no listado en 8.2 para esta tabla).
alter table identidad.sellers enable row level security;
alter table identidad.sellers force row level security;

-- OJO con el patrón "si no eres X, no te restringe" (§8.1 nota): funciona
-- para distinguir interno vs. el alcance propio de ESTA tabla, pero NO debe
-- escribirse como `tipo_usuario <> 'seller'` — eso dejaría pasar también a
-- conductor (su tipo_usuario tampoco es 'seller'), exponiendo la cartera
-- completa de sellers a cualquier usuario-conductor. La condición correcta
-- enumera explícitamente los dos casos permitidos: interno (ve todo su
-- tenant) o seller viendo EXCLUSIVAMENTE su propia fila. Cualquier otro
-- tipo_usuario (conductor, super_admin) queda fuera por construcción.
drop policy if exists sellers_select on identidad.sellers;
create policy sellers_select
  on identidad.sellers
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or (identidad.claim_tipo_usuario() = 'seller' and id = identidad.claim_seller_id())
    )
  );

-- Escritura: solo roles internos (creación/edición de sellers es función de
-- gestión del courier — distinción fina dueño/administración queda en backend,
-- §4 RBAC). El seller jamás escribe su propia fila vía API de datos directa.
drop policy if exists sellers_insert_interno on identidad.sellers;
create policy sellers_insert_interno
  on identidad.sellers
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists sellers_update_interno on identidad.sellers;
create policy sellers_update_interno
  on identidad.sellers
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

-- Sin DELETE: baja lógica vía `estado = 'suspendido'` (trazabilidad/integridad
-- referencial con pedidos, cobros, etc. en fases siguientes).

-- -----------------------------------------------------------------------------
-- 6. RLS — conductores (P1 + P3)
-- -----------------------------------------------------------------------------
-- Internos del tenant ven todos los conductores de su tenant; un usuario-
-- conductor solo ve su propia fila (fila.id = claim.driver_id). Seller: no
-- aplica (no listado en 8.2 para esta tabla — un seller jamás ve la nómina
-- de conductores del courier).
alter table identidad.conductores enable row level security;
alter table identidad.conductores force row level security;

-- Mismo cuidado que en sellers_select: NO usar `tipo_usuario <> 'conductor'`
-- (dejaría pasar también a seller, exponiendo la nómina de conductores del
-- courier a cualquier usuario-seller). Se enumeran explícitamente los dos
-- casos permitidos: interno (todo su tenant) o conductor viendo
-- EXCLUSIVAMENTE su propia fila.
drop policy if exists conductores_select on identidad.conductores;
create policy conductores_select
  on identidad.conductores
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or (identidad.claim_tipo_usuario() = 'conductor' and id = identidad.claim_driver_id())
    )
  );

drop policy if exists conductores_insert_interno on identidad.conductores;
create policy conductores_insert_interno
  on identidad.conductores
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists conductores_update_interno on identidad.conductores;
create policy conductores_update_interno
  on identidad.conductores
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

-- La política `using (tipo_usuario = 'interno')` de arriba alcanza para
-- aislar los datos (RLS filtra qué filas son visibles/editables), pero un
-- UPDATE emitido por un seller/conductor sobre una fila que SÍ puede *ver*
-- (la suya) simplemente no encontraría filas que cumplan el `using` de
-- escritura — Postgres reporta "UPDATE 0", sin lanzar excepción. Para que la
-- denegación sea explícita y auditable (y coincida con la expectativa de la
-- suite de aislamiento: `throws_ok(..., '42501', ...)`), añadimos un guard de
-- defensa en profundidad que sí lanza `insufficient_privilege` (42501) — un
-- disparador POR SENTENCIA, que se ejecuta siempre (incluso con cero filas
-- afectadas), antes de que RLS filtre. Reutilizable en cualquier tabla cuya
-- escritura esté reservada a roles internos / service_role aunque otros
-- alcances puedan leer alguna de sus filas (p. ej. conexiones_seller_ml).
create or replace function identidad.solo_interno_edita()
returns trigger
language plpgsql
as $$
begin
  -- service_role (jobs, funciones de servidor) y el propio Supabase Studio
  -- usan otros roles de Postgres; solo interceptamos al cliente autenticado.
  if auth.role() = 'authenticated' and identidad.claim_tipo_usuario() <> 'interno' then
    raise exception using
      errcode = '42501',
      message = 'No autorizado: esta tabla solo se edita desde roles internos del courier o procesos de servidor (service_role)';
  end if;
  return null;
end;
$$;

comment on function identidad.solo_interno_edita() is
  'Guard de defensa en profundidad (disparador POR SENTENCIA, before update): rechaza con 42501 cualquier UPDATE intentado por un usuario autenticado cuyo tipo_usuario no sea interno, incluso si RLS ya lo filtraría silenciosamente a cero filas.';

drop trigger if exists trg_conductores_solo_interno_edita on identidad.conductores;
create trigger trg_conductores_solo_interno_edita
  before update on identidad.conductores
  for each statement execute function identidad.solo_interno_edita();

-- Mismo guard en `invitaciones` (creada en la migración 0001, antes de que
-- esta función existiera — el disparador se agrega aquí, donde la función ya
-- está disponible). Un interno SÍ puede ver invitaciones de su tenant
-- (política `invitaciones_select_interno`); un seller/conductor que intente
-- `update invitaciones set estado = 'revocada' where id = ...` (p. ej. para
-- intentar autoaceptarse o sabotear una invitación ajena) vería "UPDATE 0"
-- silencioso sin este guard — la política ya lo bloquea correctamente, pero
-- Postgres no distingue "no autorizado" de "no encontrado". 42501 explícito.
drop trigger if exists trg_invitaciones_solo_interno_edita on identidad.invitaciones;
create trigger trg_invitaciones_solo_interno_edita
  before update on identidad.invitaciones
  for each statement execute function identidad.solo_interno_edita();

-- Mismo guard en `sellers`: el seller SÍ puede *ver* su propia fila
-- (política `sellers_select` de §5), así que un UPDATE suyo sobre ella no
-- cae en "0 filas visibles" por tenant — cae en "0 filas visibles para
-- escritura" (el `using` de `sellers_update_interno` exige tipo_usuario =
-- 'interno'), que Postgres resolvería como "UPDATE 0" silencioso. Sin este
-- disparador, un seller que intente `update sellers set ... where id =
-- <su propia fila>` no vería ningún error — exactamente el patrón de "UPDATE
-- silencioso" que la nota de la sesión anterior pidió perseguir en otras
-- políticas. Lo cerramos aquí con el mismo guard reusado en
-- `conductores`/`conexiones_seller_ml`.
drop trigger if exists trg_sellers_solo_interno_edita on identidad.sellers;
create trigger trg_sellers_solo_interno_edita
  before update on identidad.sellers
  for each statement execute function identidad.solo_interno_edita();

-- -----------------------------------------------------------------------------
-- 7. Grants de API para las vistas nuevas
-- -----------------------------------------------------------------------------
-- Las vistas en `public` usan security_invoker = true (definidas arriba): RLS
-- se evalúa con los privilegios del rol que consulta, que por eso necesita
-- también privilegios DIRECTOS sobre las tablas base en `identidad` (la
-- política RLS sigue siendo la que filtra filas — esto solo habilita el acceso
-- a nivel de objeto). Ver nota extendida en la migración 0001 §9.
grant select, insert, update on identidad.sellers to authenticated;
grant select, insert, update on identidad.conductores to authenticated;

grant select, insert, update on public.sellers to authenticated;
grant select, insert, update on public.conductores to authenticated;
