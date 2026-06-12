-- =============================================================================
-- Pruebas de aislamiento RLS — dinero.pagos_recibidos (cobranza Fintoc)
-- =============================================================================
-- Demuestra, contra una base Postgres real (no mocks de aplicación):
--   1. P1 cross-tenant: seller del tenant A NO ve pagos del tenant B.
--   2. P2: seller A no ve pagos del seller A2 (mismo tenant).
--   3. CASO CENTRAL: un pago con seller_id IS NULL (sin atribuir) es invisible
--      al seller A (la comparación NULL = claim_seller_id() es falsa → deseado).
--   4. Seller A ve exactamente sus N pagos atribuidos (count exacto).
--   5. Conductor: is_empty sobre public.pagos_recibidos.
--   6. Interno del tenant A ve los pagos de A, incluidos los sin_atribuir.
--   7. INSERT desde authenticated (seller) en dinero.pagos_recibidos → 42501.
--   8. Interno de A no ve pagos de B (P1 cross-tenant, rama interno).
--
-- Mecanismo idéntico a rls_aislamiento_dinero.test.sql: simulamos el JWT
-- fijando `request.jwt.claims` y conmutando el rol a `authenticated` con
-- set local role.
--
-- Ejecutar: npx supabase test db
-- =============================================================================

begin;

select plan(16);

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
-- Dos tenants (A y B). Tenant A:
--   - 2 sellers (s_a, s_a2), 1 conductor (d_a)
--   - pagos del seller A: 2 atribuidos (estado 'atribuido'/'conciliado')
--   - 1 pago del seller A2 (atribuido)
--   - 1 pago SIN ATRIBUIR del tenant A (seller_id NULL, 'sin_atribuir')
-- Tenant B: 1 pago atribuido al seller B.
--
-- Se insertan como `postgres` (bypassa RLS). UUIDs propios de esta suite para
-- no chocar con las demás suites (ON CONFLICT (id) DO NOTHING).
-- -----------------------------------------------------------------------------
do $$
declare
  -- Tenants
  t_a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';

  -- Sellers
  s_a  uuid := 'aaaaaaaa-1111-0000-0000-000000000001';
  s_a2 uuid := 'aaaaaaaa-1111-0000-0000-000000000003';
  s_b  uuid := 'bbbbbbbb-1111-0000-0000-000000000002';

  -- Conductor
  d_a  uuid := 'aaaaaaaa-2222-0000-0000-000000000001';

  -- Usuarios auth
  u_dueno_a     uuid := 'aaaaaaaa-3333-0000-0000-000000000001';
  u_seller_a    uuid := 'aaaaaaaa-3333-0000-0000-000000000003';
  u_seller_a2   uuid := 'aaaaaaaa-3333-0000-0000-000000000004';
  u_conductor_a uuid := 'aaaaaaaa-3333-0000-0000-000000000006';
  u_dueno_b     uuid := 'bbbbbbbb-3333-0000-0000-000000000002';

  -- Pagos (UUIDs propios de esta suite)
  pago_a_atr1   uuid := 'aaaaaaaa-7777-0000-0000-000000000001'; -- seller A, atribuido
  pago_a_atr2   uuid := 'aaaaaaaa-7777-0000-0000-000000000002'; -- seller A, conciliado
  pago_a2_atr   uuid := 'aaaaaaaa-7777-0000-0000-000000000003'; -- seller A2, atribuido
  pago_a_null   uuid := 'aaaaaaaa-7777-0000-0000-000000000004'; -- tenant A, SIN atribuir
  pago_b_atr    uuid := 'bbbbbbbb-7777-0000-0000-000000000001'; -- seller B, atribuido
begin
  -- Tenants
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier A', 'Courier A SpA', '76111111-1', 'activo'),
    (t_b, 'Courier B', 'Courier B SpA', '76222222-2', 'activo')
  on conflict (id) do nothing;

  -- auth.users
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_dueno_a,     'dueno.a@pagos.test',     crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,    'seller.a@pagos.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a2,   'seller.a2@pagos.test',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a, 'conductor.a@pagos.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_dueno_b,     'dueno.b@pagos.test',     crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  -- Sellers
  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a,  t_a, 'Seller Uno A', '77111111-1', 'Contacto A',  'a@pseller.test',  'activo'),
    (s_a2, t_a, 'Seller Dos A', '77222222-2', 'Contacto A2', 'a2@pseller.test', 'activo'),
    (s_b,  t_b, 'Seller Uno B', '77333333-3', 'Contacto B',  'b@pseller.test',  'activo')
  on conflict (id) do nothing;

  -- Conductor
  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values
    (d_a, t_a, 'Conductor A', '78111111-1', 'dependiente', 'activo')
  on conflict (id) do nothing;

  -- usuarios_perfil
  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_dueno_a,     t_a, 'Dueno A',             'interno',   null, null, 'dueno',     'activo'),
    (u_seller_a,    t_a, 'Usuario Seller A',    'seller',    s_a,  null, 'seller',    'activo'),
    (u_seller_a2,   t_a, 'Usuario Seller A2',   'seller',    s_a2, null, 'seller',    'activo'),
    (u_conductor_a, t_a, 'Usuario Conductor A', 'conductor', null, d_a,  'conductor', 'activo'),
    (u_dueno_b,     t_b, 'Dueno B',             'interno',   null, null, 'dueno',     'activo')
  on conflict (id) do nothing;

  -- Pagos recibidos
  insert into dinero.pagos_recibidos (id, tenant_id, seller_id, movimiento_externo_id,
    monto_clp, fecha_movimiento, estado_match)
  values
    (pago_a_atr1, t_a, s_a,  'mov_a_0001', 50000, '2026-06-05', 'atribuido'),
    (pago_a_atr2, t_a, s_a,  'mov_a_0002', 30000, '2026-06-06', 'conciliado'),
    (pago_a2_atr, t_a, s_a2, 'mov_a_0003', 40000, '2026-06-05', 'atribuido'),
    -- CASO CENTRAL: seller_id NULL, sin atribuir.
    (pago_a_null, t_a, null, 'mov_a_0004', 99000, '2026-06-07', 'sin_atribuir'),
    (pago_b_atr,  t_b, s_b,  'mov_b_0001', 70000, '2026-06-05', 'atribuido')
  on conflict (id) do nothing;

  -- Config de cobranza por tenant (solo referencias opacas — nunca el token).
  insert into identidad.courier_config_cobranza
    (tenant_id, link_token_ref, secreto_webhook_ref, cuenta_banco_alias, estado_conexion)
  values
    (t_a, gen_random_uuid(), gen_random_uuid(), 'Cuenta A', 'conectado'),
    (t_b, gen_random_uuid(), gen_random_uuid(), 'Cuenta B', 'conectado')
  on conflict (tenant_id) do nothing;
end $$;

-- =============================================================================
-- BLOQUE 1 · Sesión como seller A
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

-- Test 1 · P1 cross-tenant
select is_empty(
  $$ select 1 from public.pagos_recibidos
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'P1 cross-tenant: seller del tenant A NO ve pagos del tenant B'
);

-- Test 2 · P2 mismo tenant, otro seller
select is_empty(
  $$ select 1 from public.pagos_recibidos
     where seller_id = 'aaaaaaaa-1111-0000-0000-000000000003' $$, -- s_a2
  'P2: seller A NO ve pagos del seller A2 (mismo tenant)'
);

-- Test 3 · CASO CENTRAL: pago sin atribuir (seller_id NULL) invisible al seller
select is_empty(
  $$ select 1 from public.pagos_recibidos
     where movimiento_externo_id = 'mov_a_0004' $$,
  'CENTRAL: seller A NO ve el pago sin atribuir (seller_id NULL) de su tenant'
);

-- Test 4 · Seller A ve exactamente sus 2 pagos atribuidos (no el de A2, ni el
--          sin atribuir, ni el de B).
select results_eq(
  $$ select count(*)::int from public.pagos_recibidos $$,
  $$ values (2) $$,
  'Seller A ve exactamente sus 2 pagos atribuidos (count exacto)'
);

-- =============================================================================
-- BLOQUE 2 · Conductor no accede a pagos_recibidos
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

-- Test 5
select is_empty(
  $$ select 1 from public.pagos_recibidos $$,
  'Conductor no puede ver pagos_recibidos: resultado vacío (RLS filtra todo)'
);

-- =============================================================================
-- BLOQUE 3 · Interno del tenant A
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- u_dueno_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

-- Test 6 · Interno ve TODOS los pagos de A, incluido el sin_atribuir (4 filas:
--          2 de seller A + 1 de seller A2 + 1 sin atribuir).
select results_eq(
  $$ select count(*)::int from public.pagos_recibidos
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  $$ values (4) $$,
  'Interno de A ve los 4 pagos de su tenant, incluido el sin_atribuir'
);

-- Test 8 (cross-tenant para interno; agrupado aquí por reutilizar la sesión)
select is_empty(
  $$ select 1 from public.pagos_recibidos
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'P1 cross-tenant: interno de A NO ve pagos del tenant B'
);

-- =============================================================================
-- BLOQUE 4 · INSERT desde authenticated falla con 42501
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

-- Test 7 · INSERT en dinero.pagos_recibidos como authenticated → 42501
select throws_ok(
  $$ insert into dinero.pagos_recibidos
       (tenant_id, seller_id, movimiento_externo_id, monto_clp, fecha_movimiento, estado_match)
     values (
       'aaaaaaaa-0000-0000-0000-000000000001',
       'aaaaaaaa-1111-0000-0000-000000000001',
       'mov_fake_0001', 12345, current_date, 'atribuido'
     ) $$,
  '42501',
  null,
  'INSERT en dinero.pagos_recibidos como authenticated falla con 42501 (no silencioso)'
);

-- Test 9 · UPDATE en dinero.pagos_recibidos como authenticated (seller) → 42501.
-- El seller no puede auto-atribuirse un pago ni mover su estado de match.
select throws_ok(
  $$ update dinero.pagos_recibidos
       set estado_match = 'descartado'
     where id = 'aaaaaaaa-7777-0000-0000-000000000001' $$,
  '42501',
  null,
  'UPDATE en dinero.pagos_recibidos como authenticated falla con 42501 (escritura solo service_role)'
);

-- Test 10 · DELETE en dinero.pagos_recibidos como authenticated (seller) → 42501.
select throws_ok(
  $$ delete from dinero.pagos_recibidos
     where id = 'aaaaaaaa-7777-0000-0000-000000000001' $$,
  '42501',
  null,
  'DELETE en dinero.pagos_recibidos como authenticated falla con 42501 (escritura solo service_role)'
);

-- =============================================================================
-- BLOQUE 5 · identidad.courier_config_cobranza — dato puramente interno.
--   El seller NO la ve (P1 estricta, sin rama seller); el interno solo la suya.
-- =============================================================================

-- Test 11 · Seller A NO ve NINGUNA config de cobranza (ni la de su tenant).
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

select is_empty(
  $$ select 1 from public.courier_config_cobranza $$,
  'Seller A NO ve config de cobranza alguna (dato interno del courier, ni la de su tenant)'
);

-- Test 12 · Conductor A tampoco ve config de cobranza.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

select is_empty(
  $$ select 1 from public.courier_config_cobranza $$,
  'Conductor A NO ve config de cobranza alguna'
);

-- Test 13-14 · Interno de A ve SOLO su config (1 fila), nunca la de B.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- u_dueno_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

select results_eq(
  $$ select count(*)::int from public.courier_config_cobranza $$,
  $$ values (1) $$,
  'Interno de A ve exactamente 1 config de cobranza (la suya)'
);

select is_empty(
  $$ select 1 from public.courier_config_cobranza
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'P1 cross-tenant: interno de A NO ve la config de cobranza del tenant B'
);

-- Test 15 · INSERT de config de cobranza con tenant_id de OTRO tenant → bloqueado
--           (with check de la política impide sembrar config ajena). 42501.
select throws_ok(
  $$ insert into identidad.courier_config_cobranza (tenant_id, estado_conexion)
     values ('bbbbbbbb-0000-0000-0000-000000000002', 'conectado') $$,
  '42501',
  null,
  'Interno de A NO puede INSERTAR config de cobranza para el tenant B (with check)'
);

-- Test 16 · Seller NO puede actualizar la config de cobranza de su tenant
--           (guard solo_interno_edita → 42501 explícito, no UPDATE silencioso).
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

select throws_ok(
  $$ update identidad.courier_config_cobranza
       set estado_conexion = 'revocado'
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'Seller A NO puede actualizar la config de cobranza (guard solo_interno_edita → 42501)'
);

-- =============================================================================
-- Cierre
-- =============================================================================
select * from finish();

rollback;
