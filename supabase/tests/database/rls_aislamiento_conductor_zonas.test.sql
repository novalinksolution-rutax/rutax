-- =============================================================================
-- Pruebas de aislamiento RLS — disponibilidad/capacidad del conductor + zonas
-- preferentes (conductor_zonas) (F6, ítem 1.3 · Auto-assign heurístico)
-- =============================================================================
-- Demuestra, contra una base Postgres real (no mocks de aplicación):
--   1. Aislamiento cross-tenant: el interno del tenant A NO ve conductor_zonas del
--      tenant B (y ve exactamente las suyas).
--   2. conductor_zonas es INTERNA: seller y conductor ven 0 filas en SELECT y reciben
--      42501 en INSERT/UPDATE/DELETE.
--   3. Las columnas nuevas de conductores (disponible, capacidad_paradas) respetan la
--      RLS existente: P1 interno ve su nómina; P3 conductor ve SOLO su propia fila;
--      el seller no ve ningún conductor; aislamiento cross-tenant intacto.
--
-- Mecanismo idéntico a rls_aislamiento_ventanas_corte.test.sql: simulamos el JWT
-- fijando `request.jwt.claims` y conmutando el rol a `authenticated`.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(17);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada (redefinidos aquí — cada .test.sql corre en su
-- propia transacción).
-- -----------------------------------------------------------------------------
create or replace function test_iniciar_sesion(
  p_user_id      uuid,
  p_tenant_id    uuid,
  p_tipo_usuario text,
  p_rol          text,
  p_seller_id    uuid default null,
  p_driver_id    uuid default null
) returns void
language plpgsql
as $$
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_user_id,
      'role', 'authenticated',
      'tenant_id', p_tenant_id,
      'tipo_usuario', p_tipo_usuario,
      'seller_id', p_seller_id,
      'driver_id', p_driver_id,
      'rol', p_rol
    )::text,
    true
  );
end;
$$;

create or replace function test_cerrar_sesion() returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
end;
$$;

-- -----------------------------------------------------------------------------
-- Fixtures: dos tenants (A y B). Tenant A: 1 seller, 2 conductores (uno con
-- usuario-conductor), 2 zonas y 2 zonas preferentes para el conductor A1. Tenant
-- B: 1 conductor, 1 zona y 1 zona preferente, para probar aislamiento cross-tenant.
-- Se insertan como `postgres` (bypassa RLS).
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';

  s_a  uuid := 'aaaaaaaa-1111-0000-0000-000000000001';
  s_b  uuid := 'bbbbbbbb-1111-0000-0000-000000000002';

  d_a1 uuid := 'aaaaaaaa-2222-0000-0000-000000000001';
  d_a2 uuid := 'aaaaaaaa-2222-0000-0000-000000000002';
  d_b1 uuid := 'bbbbbbbb-2222-0000-0000-000000000001';

  u_interno_a  uuid := 'aaaaaaaa-3333-0000-0000-000000000001';
  u_seller_a   uuid := 'aaaaaaaa-3333-0000-0000-000000000003';
  u_conductor_a uuid := 'aaaaaaaa-3333-0000-0000-000000000004'; -- usuario del conductor d_a1

  z_a_centro  uuid := 'aaaaaaaa-7777-0000-0000-000000000001';
  z_a_oriente uuid := 'aaaaaaaa-7777-0000-0000-000000000002';
  z_b_centro  uuid := 'bbbbbbbb-7777-0000-0000-000000000001';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier A', 'Courier A SpA', '76111111-1', 'activo'),
    (t_b, 'Courier B', 'Courier B SpA', '76222222-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_interno_a,   'interno.a@czonas.test',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,    'seller.a@czonas.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a, 'conductor.a@czonas.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a, t_a, 'Seller A', '77111111-1', 'Contacto A', 'a@seller.test', 'activo'),
    (s_b, t_b, 'Seller B', '77222222-2', 'Contacto B', 'b@seller.test', 'activo')
  on conflict (id) do nothing;

  -- Conductores con las columnas NUEVAS pobladas (disponible / capacidad_paradas).
  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado, disponible, capacidad_paradas)
  values
    (d_a1, t_a, 'Conductor A1', '78111111-1', 'dependiente',   'activo',   true,  40),
    (d_a2, t_a, 'Conductor A2', '78222222-2', 'independiente', 'activo',   false, 25),
    (d_b1, t_b, 'Conductor B1', '78333333-3', 'dependiente',   'activo',   true,  30)
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a,   t_a, 'Interno A',        'interno',   null, null, 'dueno',     'activo'),
    (u_seller_a,    t_a, 'Usuario Seller A', 'seller',    s_a,  null, 'seller',    'activo'),
    (u_conductor_a, t_a, 'Usuario Cond A',   'conductor', null, d_a1, 'conductor', 'activo')
  on conflict (id) do nothing;

  -- Zonas
  insert into identidad.zonas (id, tenant_id, nombre, activa)
  values
    (z_a_centro,  t_a, 'Centro',  true),
    (z_a_oriente, t_a, 'Oriente', true),
    (z_b_centro,  t_b, 'Centro',  true)
  on conflict (id) do nothing;

  -- Zonas preferentes: el conductor A1 prefiere Centro y Oriente; B1 prefiere Centro de B.
  insert into identidad.conductor_zonas (tenant_id, conductor_id, zona_id)
  values
    (t_a, d_a1, z_a_centro),
    (t_a, d_a1, z_a_oriente),
    (t_b, d_b1, z_b_centro)
  on conflict (tenant_id, conductor_id, zona_id) do nothing;
end $$;

-- =============================================================================
-- BLOQUE 1 · Aislamiento cross-tenant de conductor_zonas (interno A)
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- u_interno_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

select is_empty(
  $$ select 1 from public.conductor_zonas where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'P1 conductor_zonas: interno del tenant A NO ve zonas preferentes del tenant B'
);

select results_eq(
  $$ select count(*)::int from public.conductor_zonas $$,
  $$ values (2) $$,
  'P1 conductor_zonas: interno del tenant A ve exactamente sus 2 zonas preferentes (Centro + Oriente del conductor A1)'
);

-- El interno SÍ puede gestionar el CRUD (insert + delete) de zonas preferentes.
select lives_ok(
  $$ insert into public.conductor_zonas (tenant_id, conductor_id, zona_id)
     values ('aaaaaaaa-0000-0000-0000-000000000001',
             'aaaaaaaa-2222-0000-0000-000000000002',   -- d_a2
             'aaaaaaaa-7777-0000-0000-000000000001') $$, -- z_a_centro
  'CRUD interno: el interno SÍ puede INSERT una zona preferente para otro conductor de su tenant'
);

select lives_ok(
  $$ delete from public.conductor_zonas
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
       and conductor_id = 'aaaaaaaa-2222-0000-0000-000000000002' $$,
  'CRUD interno: el interno SÍ puede DELETE la zona preferente que acaba de crear (reasignación borrando+insertando)'
);

-- La FK compuesta impide vincular una zona de OTRO tenant (aislamiento estructural).
select throws_ok(
  $$ insert into public.conductor_zonas (tenant_id, conductor_id, zona_id)
     values ('aaaaaaaa-0000-0000-0000-000000000001',  -- t_a
             'aaaaaaaa-2222-0000-0000-000000000001',  -- d_a1 (tenant A)
             'bbbbbbbb-7777-0000-0000-000000000001') $$, -- zona del tenant B
  '23503',
  null,
  'FK compuesta: el interno A NO puede vincular una zona del tenant B (violación de FK, aislamiento estructural)'
);

-- =============================================================================
-- BLOQUE 2 · conductor_zonas invisible/inmutable para el SELLER
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

select is_empty(
  $$ select 1 from public.conductor_zonas $$,
  'Aislamiento seller: el seller NO ve ninguna zona preferente (interna del courier)'
);

select throws_ok(
  $$ insert into public.conductor_zonas (tenant_id, conductor_id, zona_id)
     values ('aaaaaaaa-0000-0000-0000-000000000001',
             'aaaaaaaa-2222-0000-0000-000000000001',
             'aaaaaaaa-7777-0000-0000-000000000001') $$,
  '42501',
  null,
  'Aislamiento seller: el seller NO puede INSERT en conductor_zonas (solo interno)'
);

select throws_ok(
  $$ update public.conductor_zonas set zona_id = 'aaaaaaaa-7777-0000-0000-000000000002'
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'Aislamiento seller: el seller NO puede UPDATE conductor_zonas (guard solo_interno_edita)'
);

select throws_ok(
  $$ delete from public.conductor_zonas
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'Aislamiento seller: el seller NO puede DELETE en conductor_zonas (solo interno)'
);

-- El seller tampoco ve la nómina de conductores ni sus columnas nuevas.
select is_empty(
  $$ select 1 from public.conductores $$,
  'Aislamiento seller: el seller NO ve ningún conductor (ni disponible ni capacidad_paradas)'
);

-- =============================================================================
-- BLOQUE 3 · conductor_zonas invisible/inmutable para el CONDUCTOR
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000004'::uuid, -- u_conductor_a (dueño de d_a1)
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a1
);

-- El conductor NO ve su propio mapa de zonas preferentes (lo gestiona el courier).
select is_empty(
  $$ select 1 from public.conductor_zonas $$,
  'Aislamiento conductor: el conductor NO ve sus propias zonas preferentes (configuración interna del courier)'
);

select throws_ok(
  $$ insert into public.conductor_zonas (tenant_id, conductor_id, zona_id)
     values ('aaaaaaaa-0000-0000-0000-000000000001',
             'aaaaaaaa-2222-0000-0000-000000000001',
             'aaaaaaaa-7777-0000-0000-000000000002') $$,
  '42501',
  null,
  'Aislamiento conductor: el conductor NO puede INSERT en conductor_zonas (solo interno)'
);

select throws_ok(
  $$ delete from public.conductor_zonas
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'Aislamiento conductor: el conductor NO puede DELETE en conductor_zonas (solo interno)'
);

-- =============================================================================
-- BLOQUE 4 · Columnas nuevas de conductores respetan la RLS existente
-- =============================================================================
-- 4a. El conductor (P3) ve SOLO su propia fila, con sus columnas nuevas.
select results_eq(
  $$ select disponible, capacidad_paradas from public.conductores $$,
  $$ values (true, 40) $$,
  'P3 conductores: el conductor d_a1 ve SOLO su propia fila, con disponible=true / capacidad_paradas=40'
);

-- 4b. El interno (P1) ve toda su nómina (2 conductores del tenant A) con las columnas nuevas.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- u_interno_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

select results_eq(
  $$ select count(*)::int from public.conductores $$,
  $$ values (2) $$,
  'P1 conductores: el interno del tenant A ve sus 2 conductores (no el del tenant B)'
);

select is_empty(
  $$ select 1 from public.conductores where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'Aislamiento cross-tenant: el interno del tenant A NO ve el conductor del tenant B'
);

-- 4c. El interno puede actualizar disponible/capacidad_paradas de su conductor.
select lives_ok(
  $$ update public.conductores
     set disponible = false, capacidad_paradas = 50
     where id = 'aaaaaaaa-2222-0000-0000-000000000001'
       and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'P1 conductores: el interno SÍ puede actualizar disponible/capacidad_paradas de su conductor'
);

select * from finish();

rollback;
