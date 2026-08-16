-- =============================================================================
-- Pruebas de aislamiento RLS + restricciones — POD same-day y ubicación del
-- conductor (Bloque 2: migraciones 0016 + 0017)
-- =============================================================================
-- Demuestra, contra una base Postgres real (no mocks de aplicación):
--
-- P-1: Aislamiento cross-tenant en pruebas_entrega
--   1. Conductor del tenant B NO puede SELECT pruebas_entrega del tenant A
--      (is_empty from public.pruebas_entrega where pedido_id = pedido_a).
--   2. Conductor del tenant B NO puede INSERT en pruebas_entrega del tenant A
--      → 42501 (no hay política de escritura para authenticated).
--
-- P-2: Trigger trg_pruebas_entrega_solo_same_day (FRONTERA DURA)
--   3. INSERT de POD para pedido tipo_pedido='flex' → 23514 (el trigger rechaza
--      cualquier POD contra un pedido que no sea same_day).
--
-- P-3: UNIQUE parcial idx_pruebas_entrega_entregado_uk
--   4. Segundo INSERT con mismo pedido_id y tipo_resultado='entregado' → 23505
--      (idempotencia de sync: un reintento no duplica el POD de entrega).
--
-- P-4: RLS ubicacion_conductor
--   5. Seller NO puede leer ubicacion_conductor del tenant A → is_empty de
--      public.ubicacion_conductor (el seller no tiene rama en la política).
--   6. Conductor A SÍ ve su propia ubicacion (isnt_empty where conductor_id = d_a).
--   7. Conductor B NO ve la ubicacion del conductor A → is_empty.
--
-- Mecanismo: idéntico al resto de tests de esta suite. Fixtures con UUIDs
-- prefijo dddddddd para no colisionar con las otras suites de POD/tracking.
--
-- Ejecutar: npx supabase test db
-- =============================================================================

begin;

select plan(7);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada (redefinidos — cada .test.sql vive en su propio
-- BEGIN/ROLLBACK).
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
-- Dos tenants (A y B). UUIDs con prefijo dddddddd para no colisionar con
-- rls_aislamiento_pod_tracking.test.sql (que usa aaaaaaaa/bbbbbbbb).
--
-- Tenant A: 1 seller (s_a), 2 conductores (d_a, d_a2), 1 manifiesto,
--   - pedido_a_sd:   same_day asignado a d_a  → para el POD válido + UNIQUE test
--   - pedido_a_flex: flex    asignado a d_a  → para el test de FRONTERA DURA
-- Tenant B: 1 seller (s_b), 1 conductor (d_b), 1 pedido same_day (pedido_b_sd)
--   sin POD ni ubicación (para el cross-tenant).
-- Ubicaciones: d_a (tenant A) con lat/long; ninguna para d_b.
--
-- Se insertan como `postgres` (bypassa RLS, pero los triggers de frontera y
-- de consistencia sí se evalúan — los pedidos asignados satisfacen el trigger
-- de denormalización).
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'dddddddd-0000-0000-0000-000000000001';
  t_b uuid := 'dddddddd-0000-0000-0000-000000000002';

  s_a uuid := 'dddddddd-1111-0000-0000-000000000001';
  s_b uuid := 'dddddddd-1111-0000-0000-000000000002';

  d_a  uuid := 'dddddddd-2222-0000-0000-000000000001';
  d_a2 uuid := 'dddddddd-2222-0000-0000-000000000002';
  d_b  uuid := 'dddddddd-2222-0000-0000-000000000003';

  u_interno_a    uuid := 'dddddddd-3333-0000-0000-000000000001';
  u_seller_a     uuid := 'dddddddd-3333-0000-0000-000000000002';
  u_conductor_a  uuid := 'dddddddd-3333-0000-0000-000000000003';
  u_conductor_b  uuid := 'dddddddd-3333-0000-0000-000000000004';

  manifiesto_a uuid := 'dddddddd-5555-0000-0000-000000000001';
  manifiesto_b uuid := 'dddddddd-5555-0000-0000-000000000002';

  pedido_a_sd   uuid := 'dddddddd-6666-0000-0000-000000000001'; -- same_day, d_a
  pedido_a_flex uuid := 'dddddddd-6666-0000-0000-0000000000ff'; -- flex,     d_a (FRONTERA)
  pedido_b_sd   uuid := 'dddddddd-6666-0000-0000-000000000002'; -- same_day, d_b

  asg_a_sd   uuid := 'dddddddd-7777-0000-0000-000000000001';
  asg_a_flex uuid := 'dddddddd-7777-0000-0000-0000000000ff';
  asg_b_sd   uuid := 'dddddddd-7777-0000-0000-000000000002';

  pod_a_sd uuid := 'dddddddd-aaaa-0000-0000-000000000001'; -- POD 'entregado' de pedido_a_sd
begin
  -- Tenants
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'POD Test Courier A', 'POD Test A SpA', '76991111-1', 'activo'),
    (t_b, 'POD Test Courier B', 'POD Test B SpA', '76992222-2', 'activo')
  on conflict (id) do nothing;

  -- Usuarios auth
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_interno_a,   'interno.a@pod2.test',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,    'seller.a@pod2.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a, 'conductor.a@pod2.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_b, 'conductor.b@pod2.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  -- Sellers
  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a, t_a, 'Seller POD A', '77991111-1', 'Contacto POD A', 'a@pod2.test', 'activo'),
    (s_b, t_b, 'Seller POD B', '77992222-2', 'Contacto POD B', 'b@pod2.test', 'activo')
  on conflict (id) do nothing;

  -- Conductores
  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values
    (d_a,  t_a, 'Conductor A POD',  '78991111-1', 'dependiente',   'activo'),
    (d_a2, t_a, 'Conductor A2 POD', '78992222-2', 'independiente', 'activo'),
    (d_b,  t_b, 'Conductor B POD',  '78993333-3', 'dependiente',   'activo')
  on conflict (id) do nothing;

  -- Perfiles de usuario
  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a,   t_a, 'Interno A POD',    'interno',   null, null, 'dueno',     'activo'),
    (u_seller_a,    t_a, 'Seller A POD',     'seller',    s_a,  null, 'seller',    'activo'),
    (u_conductor_a, t_a, 'Conductor A POD',  'conductor', null, d_a,  'conductor', 'activo'),
    (u_conductor_b, t_b, 'Conductor B POD',  'conductor', null, d_b,  'conductor', 'activo')
  on conflict (id) do nothing;

  -- Manifiestos (requeridos por asignaciones_pedido FK)
  insert into operacion.manifiestos (id, tenant_id, driver_id, nombre, fecha_operacion, estado)
  values
    (manifiesto_a, t_a, d_a, 'Ruta POD A', '2026-06-21', 'confirmado'),
    (manifiesto_b, t_b, d_b, 'Ruta POD B', '2026-06-21', 'confirmado')
  on conflict (id) do nothing;

  -- Pedidos: same_day asignado (para el POD) + flex (para la FRONTERA)
  insert into operacion.pedidos
    (id, tenant_id, seller_id, tipo_pedido, fuente, origen, ml_shipment_id, estado,
     destinatario_nombre, destinatario_direccion, destinatario_comuna)
  values
    (pedido_a_sd,   t_a, s_a, 'same_day', 'rutax_manual', 'same_day_manual', null,       'asignado',
     'Destinatario POD A',    'Calle POD A 1',   'Santiago'),
    (pedido_a_flex, t_a, s_a, 'flex',     'ml_flex',     'ml_ingesta',      'SHP-POD-F', 'asignado',
     'Destinatario POD Flex', 'Calle POD Flex 1','Providencia'),
    (pedido_b_sd,   t_b, s_b, 'same_day', 'rutax_manual', 'same_day_manual', null,       'asignado',
     'Destinatario POD B',    'Calle POD B 1',   'Vitacura')
  on conflict (id) do nothing;

  -- Asignaciones (el trigger sincroniza pedidos.driver_id_asignado para satisfacer
  -- el trigger de consistencia del POD: pruebas_entrega_validar_denormalizados).
  insert into operacion.asignaciones_pedido
    (id, tenant_id, pedido_id, manifiesto_id, driver_id, seller_id, activa)
  values
    (asg_a_sd,   t_a, pedido_a_sd,   manifiesto_a, d_a, s_a, true),
    (asg_a_flex, t_a, pedido_a_flex, manifiesto_a, d_a, s_a, true),
    (asg_b_sd,   t_b, pedido_b_sd,   manifiesto_b, d_b, s_b, true)
  on conflict (id) do nothing;

  -- POD 'entregado' para pedido_a_sd (necesario para el test UNIQUE P-3).
  -- Se inserta como postgres (bypassa RLS + BYPASSRLS): el trigger de
  -- consistencia y el de FRONTERA sí se evalúan y dejan pasar same_day.
  insert into operacion.pruebas_entrega
    (id, tenant_id, pedido_id, seller_id, conductor_id, tipo_resultado,
     tiene_foto, foto_object_path, geocerca_resultado, es_valido, capturado_en)
  values
    (pod_a_sd, t_a, pedido_a_sd, s_a, d_a, 'entregado',
     true,
     'dddddddd-0000-0000-0000-000000000001/dddddddd-6666-0000-0000-000000000001/dddddddd-aaaa-0000-0000-000000000001/foto.jpg',
     'dentro', true, now())
  on conflict (id) do nothing;

  -- Ubicación del conductor A (para P-4 T6).
  insert into operacion.ubicacion_conductor (conductor_id, tenant_id, lat, long, precision_m)
  values
    (d_a, t_a, -33.4489, -70.6693, 10.0)
  on conflict (conductor_id) do nothing;
end $$;

-- =============================================================================
-- P-1 TEST 1 · Conductor B NO ve POD del tenant A (cross-tenant SELECT)
-- =============================================================================
select test_iniciar_sesion(
  'dddddddd-3333-0000-0000-000000000004'::uuid, -- u_conductor_b
  'dddddddd-0000-0000-0000-000000000002'::uuid, -- t_b
  'conductor', 'conductor',
  p_driver_id => 'dddddddd-2222-0000-0000-000000000003'::uuid -- d_b
);

select is_empty(
  $$ select 1 from public.pruebas_entrega
     where pedido_id = 'dddddddd-6666-0000-0000-000000000001' $$, -- pedido_a_sd (tenant A)
  'P-1 T1: conductor del tenant B NO ve pruebas_entrega del tenant A (RLS P1 cross-tenant)'
);

-- =============================================================================
-- P-1 TEST 2 · Conductor B no puede INSERT en pruebas_entrega del tenant A → 42501
--             (no hay política de escritura para authenticated en la tabla)
-- =============================================================================
-- Sigue como conductor B (dddd t_b).

select throws_ok(
  $$ insert into public.pruebas_entrega
       (tenant_id, pedido_id, seller_id, conductor_id, tipo_resultado)
     values
       ('dddddddd-0000-0000-0000-000000000001',  -- t_a (otro tenant)
        'dddddddd-6666-0000-0000-000000000001',  -- pedido_a_sd
        'dddddddd-1111-0000-0000-000000000001',  -- s_a
        'dddddddd-2222-0000-0000-000000000001',  -- d_a
        'fallido') $$,
  '42501',
  null,
  'P-1 T2: conductor del tenant B NO puede INSERT en pruebas_entrega del tenant A → 42501 (sin política escritura authenticated)'
);

-- =============================================================================
-- P-2 TEST 3 · FRONTERA DURA — POD contra pedido Flex → 23514
--             Se prueba como postgres: el trigger se evalúa para cualquier rol.
-- =============================================================================
select test_cerrar_sesion(); -- vuelve a postgres

select throws_ok(
  $$ insert into operacion.pruebas_entrega
       (tenant_id, pedido_id, seller_id, conductor_id, tipo_resultado)
     values
       ('dddddddd-0000-0000-0000-000000000001',
        'dddddddd-6666-0000-0000-0000000000ff',  -- pedido_a_flex (tipo_pedido='flex')
        'dddddddd-1111-0000-0000-000000000001',  -- s_a
        'dddddddd-2222-0000-0000-000000000001',  -- d_a (asignado al pedido flex)
        'fallido') $$,
  '23514',
  null,
  'P-2 T3: FRONTERA DURA — POD para pedido Flex rechazado → 23514 (trg_pruebas_entrega_solo_same_day)'
);

-- =============================================================================
-- P-3 TEST 4 · UNIQUE parcial idx_pruebas_entrega_entregado_uk → 23505
--             pedido_a_sd ya tiene un POD 'entregado' (pod_a_sd del fixture).
--             Un segundo INSERT con tipo_resultado='entregado' viola el índice único.
-- =============================================================================
-- Sigue como postgres.

select throws_ok(
  $$ insert into operacion.pruebas_entrega
       (tenant_id, pedido_id, seller_id, conductor_id, tipo_resultado)
     values
       ('dddddddd-0000-0000-0000-000000000001',
        'dddddddd-6666-0000-0000-000000000001',  -- pedido_a_sd (ya tiene 'entregado')
        'dddddddd-1111-0000-0000-000000000001',  -- s_a
        'dddddddd-2222-0000-0000-000000000001',  -- d_a
        'entregado') $$,
  '23505',
  null,
  'P-3 T4: segundo POD entregado para el mismo pedido → 23505 (idx_pruebas_entrega_entregado_uk)'
);

-- =============================================================================
-- P-4 TEST 5 · Seller NO puede leer ubicacion_conductor → is_empty
-- =============================================================================
select test_iniciar_sesion(
  'dddddddd-3333-0000-0000-000000000002'::uuid, -- u_seller_a
  'dddddddd-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'dddddddd-1111-0000-0000-000000000001'::uuid -- s_a
);

select is_empty(
  $$ select 1 from public.ubicacion_conductor $$,
  'P-4 T5: seller A NO ve NINGUNA ubicacion_conductor (dato sensible del trabajador — Ley 21.431)'
);

-- =============================================================================
-- P-4 TEST 6 · Conductor A SÍ ve su propia ubicacion
-- =============================================================================
select test_iniciar_sesion(
  'dddddddd-3333-0000-0000-000000000003'::uuid, -- u_conductor_a
  'dddddddd-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'dddddddd-2222-0000-0000-000000000001'::uuid -- d_a
);

select isnt_empty(
  $$ select 1 from public.ubicacion_conductor
     where conductor_id = 'dddddddd-2222-0000-0000-000000000001' $$, -- d_a
  'P-4 T6: conductor A SÍ ve su propia fila en ubicacion_conductor (RLS P3)'
);

-- =============================================================================
-- P-4 TEST 7 · Conductor B NO ve ubicacion del conductor A (cross-tenant)
-- =============================================================================
select test_iniciar_sesion(
  'dddddddd-3333-0000-0000-000000000004'::uuid, -- u_conductor_b
  'dddddddd-0000-0000-0000-000000000002'::uuid, -- t_b
  'conductor', 'conductor',
  p_driver_id => 'dddddddd-2222-0000-0000-000000000003'::uuid -- d_b
);

select is_empty(
  $$ select 1 from public.ubicacion_conductor
     where conductor_id = 'dddddddd-2222-0000-0000-000000000001' $$, -- d_a (tenant A)
  'P-4 T7: conductor B NO ve la ubicacion del conductor A (RLS P1 cross-tenant + P3)'
);

-- =============================================================================
-- Cierre
-- =============================================================================
select * from finish();

rollback;
