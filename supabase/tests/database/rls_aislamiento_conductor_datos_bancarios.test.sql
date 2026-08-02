-- =============================================================================
-- Pruebas de aislamiento RLS + CHECK — datos bancarios del conductor
-- (migración 20260621000012_identidad_conductor_datos_bancarios)
-- =============================================================================
-- Demuestra, contra una base Postgres real (no mocks de aplicación):
--
--   Columnas banco / tipo_cuenta / numero_cuenta en identidad.conductores:
--     1. Interno del tenant A VE los datos bancarios del conductor de su tenant.
--     2. Conductor A VE sus propios datos bancarios (su propia fila).
--     3. Conductor A NO ve la fila del conductor A2 del mismo tenant (RLS P3).
--     4. Seller NUNCA ve datos de conductores (tabla bloqueada por RLS).
--     5. Interno del tenant B NO ve datos del conductor del tenant A (P1 cross-tenant).
--     6. Conductor A no puede hacer UPDATE de su propio banco → 42501
--        (trg_conductores_solo_interno_edita).
--     7. CHECK conductores_tipo_cuenta_valido: INSERT con tipo_cuenta='invalid'
--        rechazado → 23514 (como postgres, que bypassa RLS pero no el constraint).
--
-- Mecanismo: idéntico al resto de tests de esta suite — simulamos el JWT fijando
-- `request.jwt.claims` y conmutando el rol a `authenticated`. Los fixtures se
-- insertan como `postgres` (bypassa RLS).
--
-- Ejecutar: npx supabase test db
-- =============================================================================

begin;

select plan(7);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada (redefinidos aquí — cada .test.sql corre en su
-- propia transacción BEGIN/ROLLBACK).
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
      'sub',          p_user_id,
      'role',         'authenticated',
      'tenant_id',    p_tenant_id,
      'tipo_usuario', p_tipo_usuario,
      'seller_id',    p_seller_id,
      'driver_id',    p_driver_id,
      'rol',          p_rol
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
-- Fixtures
-- Dos tenants (A y B). Tenant A: 1 seller, 2 conductores (d_a con datos
-- bancarios completos; d_a2 sin banco), 1 interno. Tenant B: 1 conductor,
-- 1 interno.
--
-- UUIDs exclusivos de esta suite (prefijo cccc) para no chocar con otras suites
-- que corren en la misma transacción.
--
-- Se insertan como `postgres` (bypassa RLS).
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'cccccccc-0000-0000-0000-000000000001';
  t_b uuid := 'cccccccc-0000-0000-0000-000000000002';

  s_a  uuid := 'cccccccc-1111-0000-0000-000000000001';

  d_a  uuid := 'cccccccc-2222-0000-0000-000000000001'; -- tiene banco
  d_a2 uuid := 'cccccccc-2222-0000-0000-000000000002'; -- sin banco
  d_b  uuid := 'cccccccc-2222-0000-0000-000000000003';

  u_interno_a   uuid := 'cccccccc-3333-0000-0000-000000000001';
  u_seller_a    uuid := 'cccccccc-3333-0000-0000-000000000002';
  u_conductor_a uuid := 'cccccccc-3333-0000-0000-000000000003';
  u_interno_b   uuid := 'cccccccc-3333-0000-0000-000000000004';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Banco Test Courier A', 'Banco Test A SpA', '76881111-1', 'activo'),
    (t_b, 'Banco Test Courier B', 'Banco Test B SpA', '76882222-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_interno_a,   'interno.a@bancario.test',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,    'seller.a@bancario.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a, 'conductor.a@bancario.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_interno_b,   'interno.b@bancario.test',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a, t_a, 'Seller Bancario A', '77881111-1', 'Contacto A', 'a@bancario.test', 'activo')
  on conflict (id) do nothing;

  -- d_a: conductor con datos bancarios completos (caso de prueba positivo).
  -- d_a2: conductor del mismo tenant sin banco (caso de aislamiento lateral).
  -- d_b: conductor del tenant B (caso de cross-tenant).
  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado,
    banco, tipo_cuenta, numero_cuenta)
  values
    (d_a,  t_a, 'Conductor A Bancario',  '78881111-1', 'dependiente',   'activo',
     'Banco de Chile', 'corriente', '00123456789'),
    (d_a2, t_a, 'Conductor A2 Bancario', '78882222-2', 'independiente', 'activo',
     null, null, null),
    (d_b,  t_b, 'Conductor B Bancario',  '78883333-3', 'dependiente',   'activo',
     'BCI', 'vista', '00987654321')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a,   t_a, 'Interno A Bancario',    'interno',   null, null, 'dueno',     'activo'),
    (u_seller_a,    t_a, 'Seller A Bancario',     'seller',    s_a,  null, 'seller',    'activo'),
    (u_conductor_a, t_a, 'Conductor A Bancario',  'conductor', null, d_a,  'conductor', 'activo'),
    (u_interno_b,   t_b, 'Interno B Bancario',    'interno',   null, null, 'dueno',     'activo')
  on conflict (id) do nothing;
end $$;

-- =============================================================================
-- TEST 1 · Interno del tenant A VE banco/tipo_cuenta/numero_cuenta del conductor A
-- =============================================================================
select test_iniciar_sesion(
  'cccccccc-3333-0000-0000-000000000001'::uuid, -- u_interno_a
  'cccccccc-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

select isnt_empty(
  $$ select 1 from public.conductores
     where id         = 'cccccccc-2222-0000-0000-000000000001'
       and banco      = 'Banco de Chile'
       and tipo_cuenta = 'corriente'
       and numero_cuenta = '00123456789' $$,
  'Bancario T1: interno del tenant A VE banco/tipo_cuenta/numero_cuenta del conductor A'
);

-- =============================================================================
-- TEST 2 · Conductor A VE sus propios datos bancarios
-- =============================================================================
select test_iniciar_sesion(
  'cccccccc-3333-0000-0000-000000000003'::uuid, -- u_conductor_a
  'cccccccc-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'cccccccc-2222-0000-0000-000000000001'::uuid -- d_a
);

select isnt_empty(
  $$ select 1 from public.conductores
     where id = 'cccccccc-2222-0000-0000-000000000001'
       and banco = 'Banco de Chile' $$,
  'Bancario T2: conductor A VE sus propios datos bancarios (su fila, RLS P3)'
);

-- =============================================================================
-- TEST 3 · Conductor A NO ve la fila del conductor A2 (mismo tenant, otro conductor)
-- =============================================================================
-- La política conductores_select filtra a (interno todo tenant) OR (conductor su
-- propia fila). El conductor A nunca ve la fila del conductor A2.

select is_empty(
  $$ select 1 from public.conductores
     where id = 'cccccccc-2222-0000-0000-000000000002' $$, -- d_a2
  'Bancario T3: conductor A NO ve la fila del conductor A2 (mismo tenant — RLS P3)'
);

-- =============================================================================
-- TEST 4 · Seller NUNCA ve datos de conductores
-- =============================================================================
select test_iniciar_sesion(
  'cccccccc-3333-0000-0000-000000000002'::uuid, -- u_seller_a
  'cccccccc-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'cccccccc-1111-0000-0000-000000000001'::uuid -- s_a
);

select is_empty(
  $$ select 1 from public.conductores $$,
  'Bancario T4: el seller NUNCA ve datos de conductores (tabla bloqueada por RLS)'
);

-- =============================================================================
-- TEST 5 · Interno del tenant B NO ve datos del conductor del tenant A
-- =============================================================================
select test_iniciar_sesion(
  'cccccccc-3333-0000-0000-000000000004'::uuid, -- u_interno_b
  'cccccccc-0000-0000-0000-000000000002'::uuid, -- t_b
  'interno', 'dueno'
);

select is_empty(
  $$ select 1 from public.conductores
     where tenant_id = 'cccccccc-0000-0000-0000-000000000001' $$, -- t_a
  'Bancario T5: interno del tenant B NO ve conductores del tenant A (P1 cross-tenant)'
);

-- =============================================================================
-- TEST 6 · Conductor A no puede hacer UPDATE de su propio banco → 42501
--          (trg_conductores_solo_interno_edita: BEFORE UPDATE FOR EACH STATEMENT)
-- =============================================================================
select test_iniciar_sesion(
  'cccccccc-3333-0000-0000-000000000003'::uuid, -- u_conductor_a
  'cccccccc-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'cccccccc-2222-0000-0000-000000000001'::uuid -- d_a
);

select throws_ok(
  $$ update identidad.conductores
        set banco = 'Banco Estado'
      where id = 'cccccccc-2222-0000-0000-000000000001' $$,
  '42501',
  null,
  'Bancario T6: conductor A no puede UPDATE su banco → 42501 (trg_conductores_solo_interno_edita)'
);

-- =============================================================================
-- TEST 7 · CHECK conductores_tipo_cuenta_valido: tipo_cuenta='invalid' → 23514
--          Se inserta como postgres (bypassa RLS pero NO el CHECK constraint).
-- =============================================================================
select test_cerrar_sesion(); -- vuelve a postgres

select throws_ok(
  $$ insert into identidad.conductores
       (id, tenant_id, nombre_completo, rut, tipo_relacion, estado, banco, tipo_cuenta, numero_cuenta)
     values (
       gen_random_uuid(),
       'cccccccc-0000-0000-0000-000000000001',
       'Conductor CHECK Test',
       '78889999-9',
       'dependiente',
       'activo',
       'Banco Estado',
       'invalid',   -- valor fuera del dominio corriente|vista|ahorro
       '00000000000'
     ) $$,
  '23514',
  null,
  'Bancario T7: tipo_cuenta con valor inválido rechazado por CHECK conductores_tipo_cuenta_valido → 23514'
);

-- =============================================================================
-- Cierre
-- =============================================================================
select * from finish();

rollback;
