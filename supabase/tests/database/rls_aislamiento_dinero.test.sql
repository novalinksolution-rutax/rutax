-- =============================================================================
-- Pruebas de aislamiento RLS — módulo dinero (Fase C)
-- =============================================================================
-- Demuestra, contra una base Postgres real (no mocks de aplicación):
--   1. Un seller del tenant A NO ve líneas de cobro del tenant B (P1 cross-tenant).
--   2. Un seller A no ve líneas de cobro del seller B (mismo tenant, P2).
--   3. Un conductor A no ve líneas de liquidación del conductor B (mismo tenant, P3).
--   4. El seller no puede SELECT en dinero.liquidaciones.
--   5. El conductor no puede SELECT en dinero.lineas_cobro.
--   6. El seller no puede SELECT en dinero.eventos_conciliacion.
--   7. El conductor no puede SELECT en dinero.eventos_conciliacion.
--   8. Un interno con rol 'operaciones' (no dueno/administracion) no ve conciliacion.
--   9. ningún INSERT desde authenticated en ninguna tabla de dinero.
--  10. identidad.claim_rol() devuelve el rol correcto del JWT.
--  11. Seller A ve sus periodos_cobro pero no los del seller B.
--  12. Seller A ve sus documentos_dte pero no los del seller B.
--  13. Conductor A ve solo sus liquidaciones, no las del conductor B.
--
-- Mecanismo: idéntico a rls_aislamiento_operacion.test.sql — simulamos el JWT
-- fijando `request.jwt.claims` y conmutando el rol a `authenticated` con
-- set local role.
--
-- Ejecutar: npx supabase test db
-- =============================================================================

begin;

select plan(26);

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
-- Dos tenants (A y B). Tenant A tiene:
--   - 2 sellers (s_a, s_a2), 2 conductores (d_a, d_a2)
--   - 1 tarifa base (para lineas_cobro)
--   - 1 pedido por seller / conductor
--   - 1 linea_cobro del seller A, 1 linea_cobro del seller A2
--   - 1 liquidacion del conductor A, 1 liquidacion del conductor A2
--   - 1 linea_liquidacion del conductor A
--   - 1 periodo_cobro del seller A, 1 del seller A2
--   - 1 documento_dte del seller A
--   - 1 evento_conciliacion del tenant A
-- Tenant B tiene datos mínimos para probar el aislamiento cross-tenant.
--
-- Se insertan como `postgres` (bypassa RLS).
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

  -- Conductores
  d_a  uuid := 'aaaaaaaa-2222-0000-0000-000000000001';
  d_a2 uuid := 'aaaaaaaa-2222-0000-0000-000000000003';
  d_b  uuid := 'bbbbbbbb-2222-0000-0000-000000000002';

  -- Usuarios auth
  u_dueno_a        uuid := 'aaaaaaaa-3333-0000-0000-000000000001';
  u_admin_a        uuid := 'aaaaaaaa-3333-0000-0000-000000000009';
  u_coordinador_a  uuid := 'aaaaaaaa-3333-0000-0000-000000000010';
  u_dueno_b        uuid := 'bbbbbbbb-3333-0000-0000-000000000002';
  u_seller_a       uuid := 'aaaaaaaa-3333-0000-0000-000000000003';
  u_seller_a2      uuid := 'aaaaaaaa-3333-0000-0000-000000000004';
  u_seller_b       uuid := 'bbbbbbbb-3333-0000-0000-000000000005';
  u_conductor_a    uuid := 'aaaaaaaa-3333-0000-0000-000000000006';
  u_conductor_a2   uuid := 'aaaaaaaa-3333-0000-0000-000000000007';
  u_conductor_b    uuid := 'bbbbbbbb-3333-0000-0000-000000000008';

  -- Entidades de dinero
  tarifa_a         uuid := 'aaaaaaaa-aaaa-0000-0000-000000000001';
  tarifa_b         uuid := 'bbbbbbbb-aaaa-0000-0000-000000000001';

  -- Pedidos con UUIDs distintos a los de rls_aislamiento_operacion.test.sql
  -- para evitar conflictos de ON CONFLICT (id) DO NOTHING entre suites.
  pedido_a1        uuid := 'aaaaaaaa-6666-dddd-0000-000000000001';
  pedido_a2        uuid := 'aaaaaaaa-6666-dddd-0000-000000000002';
  pedido_a3        uuid := 'aaaaaaaa-6666-dddd-0000-000000000003';
  pedido_b1        uuid := 'bbbbbbbb-6666-dddd-0000-000000000001';

  periodo_a1       uuid := 'aaaaaaaa-dddd-0000-0000-000000000001'; -- seller A
  periodo_a2       uuid := 'aaaaaaaa-dddd-0000-0000-000000000002'; -- seller A2
  periodo_b1       uuid := 'bbbbbbbb-dddd-0000-0000-000000000001'; -- seller B

  dte_a1           uuid := 'aaaaaaaa-eeee-0000-0000-000000000001'; -- seller A

  linea_cobro_a1   uuid := 'aaaaaaaa-cccc-0000-0000-000000000001'; -- seller A
  linea_cobro_a2   uuid := 'aaaaaaaa-cccc-0000-0000-000000000002'; -- seller A2
  linea_cobro_b1   uuid := 'bbbbbbbb-cccc-0000-0000-000000000001'; -- seller B

  liq_a1           uuid := 'aaaaaaaa-ffff-0000-0000-000000000001'; -- conductor A
  liq_a2           uuid := 'aaaaaaaa-ffff-0000-0000-000000000002'; -- conductor A2
  liq_b1           uuid := 'bbbbbbbb-ffff-0000-0000-000000000001'; -- conductor B

  linea_liq_a1     uuid := 'aaaaaaaa-bbbb-0000-0000-000000000001'; -- conductor A
  linea_liq_b1     uuid := 'bbbbbbbb-bbbb-0000-0000-000000000001'; -- conductor B

  concil_a1        uuid := 'aaaaaaaa-9999-0000-0000-000000000001'; -- tenant A
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
    (u_dueno_a,       'dueno.a@dinero.test',       crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_admin_a,       'admin.a@dinero.test',        crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_coordinador_a, 'coordinador.a@dinero.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_dueno_b,       'dueno.b@dinero.test',        crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,      'seller.a@dinero.test',       crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a2,     'seller.a2@dinero.test',      crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_b,      'seller.b@dinero.test',       crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a,   'conductor.a@dinero.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a2,  'conductor.a2@dinero.test',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_b,   'conductor.b@dinero.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  -- Sellers
  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a,  t_a, 'Seller Uno A',  '77111111-1', 'Contacto A',  'a@seller.test',  'activo'),
    (s_a2, t_a, 'Seller Dos A',  '77222222-2', 'Contacto A2', 'a2@seller.test', 'activo'),
    (s_b,  t_b, 'Seller Uno B',  '77333333-3', 'Contacto B',  'b@seller.test',  'activo')
  on conflict (id) do nothing;

  -- Conductores
  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values
    (d_a,  t_a, 'Conductor A',  '78111111-1', 'dependiente',   'activo'),
    (d_a2, t_a, 'Conductor A2', '78222222-2', 'independiente', 'activo'),
    (d_b,  t_b, 'Conductor B',  '78333333-3', 'dependiente',   'activo')
  on conflict (id) do nothing;

  -- usuarios_perfil
  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_dueno_a,       t_a, 'Dueno A',            'interno',   null,  null,  'dueno',          'activo'),
    (u_admin_a,       t_a, 'Admin A',             'interno',   null,  null,  'administracion', 'activo'),
    (u_coordinador_a, t_a, 'Coordinador A',       'interno',   null,  null,  'coordinador',    'activo'),
    (u_dueno_b,       t_b, 'Dueno B',             'interno',   null,  null,  'dueno',          'activo'),
    (u_seller_a,      t_a, 'Usuario Seller A',    'seller',    s_a,   null,  'seller',         'activo'),
    (u_seller_a2,     t_a, 'Usuario Seller A2',   'seller',    s_a2,  null,  'seller',         'activo'),
    (u_seller_b,      t_b, 'Usuario Seller B',    'seller',    s_b,   null,  'seller',         'activo'),
    (u_conductor_a,   t_a, 'Usuario Conductor A', 'conductor', null,  d_a,   'conductor',      'activo'),
    (u_conductor_a2,  t_a, 'Usuario Conductor A2','conductor', null,  d_a2,  'conductor',      'activo'),
    (u_conductor_b,   t_b, 'Usuario Conductor B', 'conductor', null,  d_b,   'conductor',      'activo')
  on conflict (id) do nothing;

  -- Tarifas (necesarias para la FK en lineas_cobro)
  insert into identidad.tarifas (id, tenant_id, tipo_entrega, modo_calculo, monto_clp, vigente_desde, estado)
  values
    (tarifa_a, t_a, 'flex', 'monto_fijo', 2500, '2026-01-01', 'activa'),
    (tarifa_b, t_b, 'flex', 'monto_fijo', 2500, '2026-01-01', 'activa')
  on conflict (id) do nothing;

  -- Pedidos (mínimos para las FKs de lineas_cobro y lineas_liquidacion)
  insert into operacion.pedidos (id, tenant_id, seller_id, tipo_pedido, origen, ml_shipment_id,
    estado, destinatario_nombre, destinatario_direccion, destinatario_comuna)
  values
    (pedido_a1, t_a, s_a,  'flex',     'ml_ingesta',     'SHP-D-A-001', 'entregado', 'Dest A1', 'Calle A1', 'Santiago'),
    (pedido_a2, t_a, s_a2, 'same_day', 'same_day_manual', null,         'entregado', 'Dest A2', 'Calle A2', 'Providencia'),
    (pedido_a3, t_a, s_a,  'flex',     'ml_ingesta',     'SHP-D-A-003', 'entregado', 'Dest A3', 'Calle A3', 'Las Condes'),
    (pedido_b1, t_b, s_b,  'flex',     'ml_ingesta',     'SHP-D-B-001', 'entregado', 'Dest B1', 'Calle B1', 'Vitacura')
  on conflict (id) do nothing;

  -- Periodos de cobro
  insert into dinero.periodos_cobro (id, tenant_id, seller_id, fecha_inicio, fecha_fin, tipo_periodo, estado)
  values
    (periodo_a1, t_a, s_a,  '2026-06-01', '2026-06-07', 'semanal', 'abierto'),
    (periodo_a2, t_a, s_a2, '2026-06-01', '2026-06-07', 'semanal', 'abierto'),
    (periodo_b1, t_b, s_b,  '2026-06-01', '2026-06-07', 'semanal', 'abierto')
  on conflict (id) do nothing;

  -- Documentos DTE (solo del tenant A / seller A para el test de DTEs)
  insert into dinero.documentos_dte (id, tenant_id, seller_id, periodo_cobro_id,
    tipo_documento, folio, fecha_emision, monto_neto_clp, monto_iva_clp, monto_total_clp,
    estado_sii, estado_proveedor)
  values
    (dte_a1, t_a, s_a, periodo_a1, 33, 1001, '2026-06-08', 4202, 798, 5000,
     'pendiente', 'pendiente')
  on conflict (id) do nothing;

  -- Lineas de cobro
  insert into dinero.lineas_cobro (id, tenant_id, seller_id, pedido_id, periodo_cobro_id,
    tarifa_id, monto_base_clp, ajuste_incidencia_clp, concepto, tipo_pedido, fecha_entrega,
    origen_generacion)
  values
    (linea_cobro_a1, t_a, s_a,  pedido_a1, periodo_a1, tarifa_a, 2500, 0,
     'Entrega flex SHP-D-A-001', 'flex', '2026-06-05', 'motor_automatico'),
    (linea_cobro_a2, t_a, s_a2, pedido_a2, periodo_a2, tarifa_a, 2500, 0,
     'Entrega same_day', 'same_day', '2026-06-05', 'motor_automatico'),
    (linea_cobro_b1, t_b, s_b,  pedido_b1, periodo_b1, tarifa_b, 2500, 0,
     'Entrega flex SHP-D-B-001', 'flex', '2026-06-05', 'motor_automatico')
  on conflict (id) do nothing;

  -- Liquidaciones
  insert into dinero.liquidaciones (id, tenant_id, driver_id, fecha_inicio, fecha_fin,
    tipo_periodo, estado, tipo_relacion_conductor)
  values
    (liq_a1, t_a, d_a,  '2026-06-01', '2026-06-07', 'semanal', 'borrador', 'dependiente'),
    (liq_a2, t_a, d_a2, '2026-06-01', '2026-06-07', 'semanal', 'borrador', 'independiente'),
    (liq_b1, t_b, d_b,  '2026-06-01', '2026-06-07', 'semanal', 'borrador', 'dependiente')
  on conflict (id) do nothing;

  -- Lineas de liquidacion
  insert into dinero.lineas_liquidacion (id, tenant_id, driver_id, pedido_id,
    liquidacion_id, monto_base_clp, ajuste_incidencia_clp, concepto, fecha_entrega,
    origen_generacion)
  values
    (linea_liq_a1, t_a, d_a, pedido_a3, liq_a1, 1200, 0,
     'Liquidacion entrega flex A3', '2026-06-05', 'motor_automatico'),
    (linea_liq_b1, t_b, d_b, pedido_b1, liq_b1, 1200, 0,
     'Liquidacion entrega flex B1', '2026-06-05', 'motor_automatico')
  on conflict (id) do nothing;

  -- Evento de conciliacion (tenant A)
  insert into dinero.eventos_conciliacion (id, tenant_id, seller_id, periodo_cobro_id,
    tipo_diferencia, descripcion, estado)
  values
    (concil_a1, t_a, s_a, periodo_a1,
     'pedido_entregado_sin_linea_cobro',
     'Test: pedido sin linea de cobro detectado',
     'pendiente')
  on conflict (id) do nothing;
end $$;

-- =============================================================================
-- BLOQUE 1 · P1 cross-tenant: seller del tenant A NO ve datos del tenant B
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

-- Test 1
select is_empty(
  $$ select 1 from public.lineas_cobro
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'P1 cross-tenant lineas_cobro: seller del tenant A NO ve lineas_cobro del tenant B'
);

-- Test 2
select is_empty(
  $$ select 1 from public.periodos_cobro
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'P1 cross-tenant periodos_cobro: seller del tenant A NO ve periodos_cobro del tenant B'
);

-- =============================================================================
-- BLOQUE 2 · P2 seller: seller A no ve datos del seller A2 (mismo tenant)
-- =============================================================================

-- (sesión ya iniciada como seller A)

-- Test 3
select is_empty(
  $$ select 1 from public.lineas_cobro
     where seller_id = 'aaaaaaaa-1111-0000-0000-000000000003' $$, -- s_a2
  'P2 lineas_cobro: seller A NO ve lineas_cobro del seller A2 (mismo tenant)'
);

-- Test 4
select results_eq(
  $$ select count(*)::int from public.lineas_cobro $$,
  $$ values (1) $$,
  'P2 lineas_cobro: seller A ve exactamente su 1 linea de cobro'
);

-- Test 5
select is_empty(
  $$ select 1 from public.periodos_cobro
     where seller_id = 'aaaaaaaa-1111-0000-0000-000000000003' $$, -- s_a2
  'P2 periodos_cobro: seller A NO ve periodos_cobro del seller A2 (mismo tenant)'
);

-- Test 6
select results_eq(
  $$ select count(*)::int from public.periodos_cobro $$,
  $$ values (1) $$,
  'P2 periodos_cobro: seller A ve exactamente su 1 periodo (no el de seller A2)'
);

-- =============================================================================
-- BLOQUE 3 · P3 conductor: conductor A no ve datos del conductor A2
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

-- Test 7
select is_empty(
  $$ select 1 from public.lineas_liquidacion
     where driver_id = 'aaaaaaaa-2222-0000-0000-000000000003' $$, -- d_a2
  'P3 lineas_liquidacion: conductor A NO ve lineas_liquidacion del conductor A2 (mismo tenant)'
);

-- Test 8
select results_eq(
  $$ select count(*)::int from public.lineas_liquidacion $$,
  $$ values (1) $$,
  'P3 lineas_liquidacion: conductor A ve exactamente su 1 linea de liquidacion'
);

-- =============================================================================
-- BLOQUE 4 · Seller no puede SELECT en liquidaciones ni lineas_liquidacion
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

-- Test 9
select is_empty(
  $$ select 1 from public.liquidaciones $$,
  'Seller no puede ver liquidaciones: resultado vacío (RLS filtra todo)'
);

-- Test 10
select is_empty(
  $$ select 1 from public.lineas_liquidacion $$,
  'Seller no puede ver lineas_liquidacion: resultado vacío (RLS filtra todo)'
);

-- =============================================================================
-- BLOQUE 5 · Conductor no puede SELECT en lineas_cobro ni periodos_cobro
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

-- Test 11
select is_empty(
  $$ select 1 from public.lineas_cobro $$,
  'Conductor no puede ver lineas_cobro: resultado vacío (RLS filtra todo)'
);

-- Test 12
select is_empty(
  $$ select 1 from public.periodos_cobro $$,
  'Conductor no puede ver periodos_cobro: resultado vacío (RLS filtra todo)'
);

-- =============================================================================
-- BLOQUE 6 · eventos_conciliacion invisible para seller y conductor
-- =============================================================================

-- Seller no ve conciliacion
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

-- Test 13
select is_empty(
  $$ select 1 from public.eventos_conciliacion $$,
  'Seller no puede ver eventos_conciliacion: resultado vacío (RLS filtra todo)'
);

-- Conductor no ve conciliacion
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

-- Test 14
select is_empty(
  $$ select 1 from public.eventos_conciliacion $$,
  'Conductor no puede ver eventos_conciliacion: resultado vacío (RLS filtra todo)'
);

-- =============================================================================
-- BLOQUE 7 · eventos_conciliacion invisible para internos sin rol adecuado
--            (coordinador tiene tipo_usuario='interno' pero rol='coordinador',
--             no 'dueno' ni 'administracion')
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000010'::uuid, -- u_coordinador_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'coordinador'
);

-- Test 15
select is_empty(
  $$ select 1 from public.eventos_conciliacion $$,
  'Interno con rol coordinador NO puede ver eventos_conciliacion (solo dueno/administracion)'
);

-- =============================================================================
-- BLOQUE 8 · eventos_conciliacion visible para dueno y administracion
-- =============================================================================

-- Dueno puede ver conciliacion
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- u_dueno_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

-- Test 16
select isnt_empty(
  $$ select 1 from public.eventos_conciliacion
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'Interno con rol dueno SÍ puede ver eventos_conciliacion de su tenant'
);

-- Administracion puede ver conciliacion
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000009'::uuid, -- u_admin_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'administracion'
);

-- Test 17
select isnt_empty(
  $$ select 1 from public.eventos_conciliacion $$,
  'Interno con rol administracion SÍ puede ver eventos_conciliacion'
);

-- Dueno del tenant A NO ve conciliacion del tenant B
-- Test 18
select is_empty(
  $$ select 1 from public.eventos_conciliacion
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'P1 conciliacion: administracion del tenant A NO ve eventos del tenant B'
);

-- =============================================================================
-- BLOQUE 9 · Sin INSERT desde authenticated en tablas de dinero
--            El REVOKE + ausencia de política de escritura provoca error de
--            permisos (42501), no silencio.
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

-- Test 19: INSERT en lineas_cobro debe fallar con 42501
select throws_ok(
  $$ insert into dinero.lineas_cobro
       (tenant_id, seller_id, pedido_id, tarifa_id, monto_base_clp, ajuste_incidencia_clp,
        concepto, tipo_pedido, fecha_entrega, origen_generacion)
     values (
       'aaaaaaaa-0000-0000-0000-000000000001',
       'aaaaaaaa-1111-0000-0000-000000000001',
       gen_random_uuid(),
       'aaaaaaaa-aaaa-0000-0000-000000000001',
       1000, 0, 'FAKE', 'flex', current_date, 'motor_automatico'
     ) $$,
  '42501',
  null,
  'INSERT en dinero.lineas_cobro como authenticated falla con 42501 (no silencioso)'
);

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

-- Test 20: INSERT en lineas_liquidacion debe fallar con 42501
select throws_ok(
  $$ insert into dinero.lineas_liquidacion
       (tenant_id, driver_id, pedido_id, monto_base_clp, ajuste_incidencia_clp,
        concepto, fecha_entrega, origen_generacion)
     values (
       'aaaaaaaa-0000-0000-0000-000000000001',
       'aaaaaaaa-2222-0000-0000-000000000001',
       gen_random_uuid(),
       800, 0, 'FAKE', current_date, 'motor_automatico'
     ) $$,
  '42501',
  null,
  'INSERT en dinero.lineas_liquidacion como authenticated falla con 42501 (no silencioso)'
);

-- =============================================================================
-- BLOQUE 10 · claim_rol() devuelve el rol correcto del JWT
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- u_dueno_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

-- Test 21
select is(
  identidad.claim_rol(),
  'dueno',
  'claim_rol() devuelve "dueno" cuando el JWT tiene rol=dueno'
);

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000009'::uuid, -- u_admin_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'administracion'
);

-- Test 22
select is(
  identidad.claim_rol(),
  'administracion',
  'claim_rol() devuelve "administracion" cuando el JWT tiene rol=administracion'
);

-- =============================================================================
-- BLOQUE 11 · Seller A ve sus DTEs pero no los del seller B
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

-- Test 23
select results_eq(
  $$ select count(*)::int from public.documentos_dte $$,
  $$ values (1) $$,
  'P2 documentos_dte: seller A ve exactamente su 1 DTE (no los de otros sellers)'
);

-- Seller A2 no tiene DTE y no ve el de seller A
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000004'::uuid, -- u_seller_a2
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000003'::uuid -- s_a2
);

-- Test 24
select is_empty(
  $$ select 1 from public.documentos_dte $$,
  'P2 documentos_dte: seller A2 NO ve DTEs del seller A (mismo tenant, diferente seller_id)'
);

-- =============================================================================
-- BLOQUE 12 · Conductor A ve solo sus liquidaciones, no las del conductor A2
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

-- Test 25
select results_eq(
  $$ select count(*)::int from public.liquidaciones $$,
  $$ values (1) $$,
  'P3 liquidaciones: conductor A ve exactamente su 1 liquidacion'
);

-- Test 26
select is_empty(
  $$ select 1 from public.liquidaciones
     where driver_id = 'aaaaaaaa-2222-0000-0000-000000000003' $$, -- d_a2
  'P3 liquidaciones: conductor A NO ve liquidaciones del conductor A2 (mismo tenant)'
);

-- =============================================================================
-- Cierre
-- =============================================================================
select * from finish();

rollback;
