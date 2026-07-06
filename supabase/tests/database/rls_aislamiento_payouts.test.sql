-- =============================================================================
-- Pruebas de aislamiento RLS — payouts a conductores (F19, Bloque 3)
-- =============================================================================
-- Demuestra, contra una base Postgres real (no mocks de aplicación):
--
-- payouts_conductor (P1 + P3 conductor; seller NUNCA):
--   1. El conductor A ve SU payout (P3 — cierra el loop "ya te pagué").
--   2. El conductor A NO ve el payout del conductor A2 (mismo tenant, otro driver).
--   3. El conductor A ve exactamente 1 payout (el suyo).
--   4. Cross-tenant: el interno del tenant A NO ve payouts del tenant B.
--   5. El interno del tenant A SÍ ve los payouts de su tenant.
--   6. El seller NUNCA ve payouts (resultado vacío).
--   7. INSERT desde authenticated → 42501 (solo service_role escribe).
--
-- Idempotencia de dinero saliente:
--   8. UNIQUE (tenant_id, liquidacion_id): segundo payout para la misma
--      liquidación → 23505 (insertado como postgres, que bypassa RLS pero no
--      el constraint).
--
-- courier_config_payout (solo-interno):
--   9. El interno SÍ ve la config de payout de su tenant.
--  10. El seller NO ve courier_config_payout.
--  11. El conductor NO ve courier_config_payout.
--  12. payout_real_habilitado nace en false (opt-in explícito).
--
-- Mecanismo: idéntico a rls_aislamiento_dinero.test.sql — simulamos el JWT
-- fijando `request.jwt.claims` y conmutando el rol a `authenticated`.
--
-- Ejecutar: npx supabase test db
-- =============================================================================

begin;

select plan(12);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada.
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
-- Dos tenants (A y B). Tenant A: 1 seller, 2 conductores (d_a, d_a2), 1
-- liquidación por conductor, 1 payout por liquidación. Tenant B: 1 conductor,
-- 1 liquidación, 1 payout (para el cross-tenant). courier_config_payout en
-- ambos tenants (con su default payout_real_habilitado=false).
--
-- Se insertan como `postgres` (bypassa RLS).
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';

  s_a  uuid := 'aaaaaaaa-1111-0000-0000-000000000001';
  s_b  uuid := 'bbbbbbbb-1111-0000-0000-000000000002';

  d_a  uuid := 'aaaaaaaa-2222-0000-0000-000000000001';
  d_a2 uuid := 'aaaaaaaa-2222-0000-0000-000000000003';
  d_b  uuid := 'bbbbbbbb-2222-0000-0000-000000000002';

  u_dueno_a     uuid := 'aaaaaaaa-3333-0000-0000-000000000001';
  u_seller_a    uuid := 'aaaaaaaa-3333-0000-0000-000000000003';
  u_conductor_a uuid := 'aaaaaaaa-3333-0000-0000-000000000006';
  u_conductor_a2 uuid := 'aaaaaaaa-3333-0000-0000-000000000007';
  u_dueno_b     uuid := 'bbbbbbbb-3333-0000-0000-000000000002';

  -- Liquidaciones (una por conductor) — UUIDs propios de esta suite.
  liq_a1 uuid := 'aaaaaaaa-ffff-eeee-0000-000000000001'; -- conductor A
  liq_a2 uuid := 'aaaaaaaa-ffff-eeee-0000-000000000002'; -- conductor A2
  liq_b1 uuid := 'bbbbbbbb-ffff-eeee-0000-000000000001'; -- conductor B

  -- Payouts (uno por liquidación).
  pay_a1 uuid := 'aaaaaaaa-7777-eeee-0000-000000000001'; -- conductor A
  pay_a2 uuid := 'aaaaaaaa-7777-eeee-0000-000000000002'; -- conductor A2
  pay_b1 uuid := 'bbbbbbbb-7777-eeee-0000-000000000001'; -- conductor B
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier A', 'Courier A SpA', '76111111-1', 'activo'),
    (t_b, 'Courier B', 'Courier B SpA', '76222222-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_dueno_a,      'dueno.a@payouts.test',      crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,     'seller.a@payouts.test',     crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a,  'conductor.a@payouts.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a2, 'conductor.a2@payouts.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_dueno_b,      'dueno.b@payouts.test',      crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a, t_a, 'Seller Uno A', '77111111-1', 'Contacto A', 'a@seller.test', 'activo'),
    (s_b, t_b, 'Seller Uno B', '77333333-3', 'Contacto B', 'b@seller.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values
    (d_a,  t_a, 'Conductor A',  '78111111-1', 'dependiente',   'activo'),
    (d_a2, t_a, 'Conductor A2', '78222222-2', 'independiente', 'activo'),
    (d_b,  t_b, 'Conductor B',  '78333333-3', 'dependiente',   'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_dueno_a,      t_a, 'Dueno A',             'interno',   null, null, 'dueno',     'activo'),
    (u_seller_a,     t_a, 'Usuario Seller A',    'seller',    s_a,  null, 'seller',    'activo'),
    (u_conductor_a,  t_a, 'Usuario Conductor A', 'conductor', null, d_a,  'conductor', 'activo'),
    (u_conductor_a2, t_a, 'Usuario Conductor A2','conductor', null, d_a2, 'conductor', 'activo'),
    (u_dueno_b,      t_b, 'Dueno B',             'interno',   null, null, 'dueno',     'activo')
  on conflict (id) do nothing;

  -- Liquidaciones (FK de payouts).
  insert into dinero.liquidaciones (id, tenant_id, driver_id, fecha_inicio, fecha_fin,
    tipo_periodo, estado, tipo_relacion_conductor)
  values
    (liq_a1, t_a, d_a,  '2026-06-01', '2026-06-07', 'semanal', 'emitida', 'dependiente'),
    (liq_a2, t_a, d_a2, '2026-06-01', '2026-06-07', 'semanal', 'emitida', 'independiente'),
    (liq_b1, t_b, d_b,  '2026-06-01', '2026-06-07', 'semanal', 'emitida', 'dependiente')
  on conflict (id) do nothing;

  -- Payouts (uno por liquidación). líquido = bruto − retención (constraint).
  insert into dinero.payouts_conductor (id, tenant_id, driver_id, liquidacion_id,
    monto_bruto_clp, monto_retencion_clp, monto_liquido_clp, tipo_relacion_conductor,
    metodo, estado, solicitado_por_usuario_id)
  values
    (pay_a1, t_a, d_a,  liq_a1, 100000,     0, 100000, 'dependiente',   'manual', 'pendiente', u_dueno_a),
    (pay_a2, t_a, d_a2, liq_a2, 100000, 10000,  90000, 'independiente', 'fintoc', 'enviado',   u_dueno_a),
    (pay_b1, t_b, d_b,  liq_b1, 100000,     0, 100000, 'dependiente',   'manual', 'pendiente', u_dueno_b)
  on conflict (id) do nothing;

  -- courier_config_payout (default payout_real_habilitado=false).
  insert into identidad.courier_config_payout (tenant_id)
  values (t_a), (t_b)
  on conflict (tenant_id) do nothing;
end $$;

-- =============================================================================
-- BLOQUE 1 · payouts_conductor — P3 conductor ve SU payout, no el de otro
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

-- Test 1
select isnt_empty(
  $$ select 1 from public.payouts_conductor
     where driver_id = 'aaaaaaaa-2222-0000-0000-000000000001' $$, -- d_a
  'P3 payouts: conductor A SÍ ve su propio payout (cierra el loop "ya te pagué")'
);

-- Test 2
select is_empty(
  $$ select 1 from public.payouts_conductor
     where driver_id = 'aaaaaaaa-2222-0000-0000-000000000003' $$, -- d_a2
  'P3 payouts: conductor A NO ve el payout del conductor A2 (mismo tenant, otro driver)'
);

-- Test 3
select results_eq(
  $$ select count(*)::int from public.payouts_conductor $$,
  $$ values (1) $$,
  'P3 payouts: conductor A ve exactamente 1 payout (el suyo)'
);

-- =============================================================================
-- BLOQUE 2 · payouts_conductor — P1 interno (cross-tenant) y seller NUNCA
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- u_dueno_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

-- Test 4
select is_empty(
  $$ select 1 from public.payouts_conductor
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$, -- t_b
  'P1 payouts: interno del tenant A NO ve payouts del tenant B'
);

-- Test 5: el interno SÍ ve los payouts de su tenant (los 2 conductores).
select results_eq(
  $$ select count(*)::int from public.payouts_conductor
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  $$ values (2) $$,
  'P1 payouts: interno del tenant A SÍ ve los 2 payouts de su tenant'
);

-- Seller NUNCA ve payouts.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

-- Test 6
select is_empty(
  $$ select 1 from public.payouts_conductor $$,
  'payouts: el seller NUNCA ve payouts (resultado vacío, RLS filtra todo)'
);

-- =============================================================================
-- BLOQUE 3 · Escritura: authenticated NO inserta payouts (solo service_role)
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

-- Test 7: INSERT directo en la tabla base falla con 42501 (revoke + sin política).
select throws_ok(
  $$ insert into dinero.payouts_conductor
       (tenant_id, driver_id, liquidacion_id, monto_bruto_clp, monto_retencion_clp,
        monto_liquido_clp, tipo_relacion_conductor, metodo)
     values (
       'aaaaaaaa-0000-0000-0000-000000000001',
       'aaaaaaaa-2222-0000-0000-000000000001',
       gen_random_uuid(),
       50000, 0, 50000, 'dependiente', 'manual'
     ) $$,
  '42501',
  null,
  'payouts: INSERT como authenticated falla con 42501 (solo service_role escribe dinero saliente)'
);

-- =============================================================================
-- BLOQUE 4 · Idempotencia: UNIQUE (tenant_id, liquidacion_id) → 23505
--            Se inserta como postgres (bypassa RLS pero NO el constraint), para
--            probar que la barrera de doble-pago es de la BASE, no de la app.
-- =============================================================================

select test_cerrar_sesion(); -- vuelve a postgres

-- Test 8: segundo payout para liq_a1 (ya tiene pay_a1) choca con el UNIQUE.
select throws_ok(
  $$ insert into dinero.payouts_conductor
       (tenant_id, driver_id, liquidacion_id, monto_bruto_clp, monto_retencion_clp,
        monto_liquido_clp, tipo_relacion_conductor, metodo)
     values (
       'aaaaaaaa-0000-0000-0000-000000000001',
       'aaaaaaaa-2222-0000-0000-000000000001',
       'aaaaaaaa-ffff-eeee-0000-000000000001', -- liq_a1, ya tiene payout pay_a1
       100000, 0, 100000, 'dependiente', 'manual'
     ) $$,
  '23505',
  null,
  'idempotencia: segundo payout para la misma liquidación → 23505 (barrera de doble-pago en la BASE)'
);

-- =============================================================================
-- BLOQUE 5 · courier_config_payout — solo-interno; opt-in default false
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- u_dueno_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

-- Test 9
select isnt_empty(
  $$ select 1 from public.courier_config_payout
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'courier_config_payout: interno del tenant A SÍ ve la config de su tenant'
);

-- Test 12: opt-in nace en false.
select results_eq(
  $$ select payout_real_habilitado from public.courier_config_payout
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  $$ values (false) $$,
  'courier_config_payout: payout_real_habilitado nace en false (opt-in explícito)'
);

-- Seller no ve la config.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

-- Test 10
select is_empty(
  $$ select 1 from public.courier_config_payout $$,
  'courier_config_payout: el seller NO ve la config de payout (solo interno)'
);

-- Conductor no ve la config.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

-- Test 11
select is_empty(
  $$ select 1 from public.courier_config_payout $$,
  'courier_config_payout: el conductor NO ve la config de payout (solo interno)'
);

-- =============================================================================
-- Cierre
-- =============================================================================
select * from finish();

rollback;
