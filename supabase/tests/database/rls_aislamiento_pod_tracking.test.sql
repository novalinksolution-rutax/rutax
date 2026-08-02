-- =============================================================================
-- Pruebas de aislamiento RLS + FRONTERA — POD y tracking same-day (Bloque 2)
-- =============================================================================
-- Demuestra, contra una base Postgres real (no mocks de aplicación):
--   1. Aislamiento de tenant (P1): un conductor del tenant A NO ve POD ni
--      ubicacion del tenant B; cross-tenant intacto.
--   2. Aislamiento de conductor (P3): conductor A NO ve el POD ni la ubicacion
--      del conductor A2 (mismo tenant).
--   3. Aislamiento de seller (P2): el seller A solo ve POD de SUS pedidos, NO los
--      de otro seller; y NO accede a ubicacion_conductor (dato del trabajador).
--   4. [FRONTERA DURA] Un INSERT de POD contra un pedido Flex (tipo_pedido='flex')
--      es RECHAZADO por el trigger trg_pruebas_entrega_solo_same_day (throws 23514).
--      Un POD contra un pedido same_day SÍ se acepta.
--   5. La escritura de POD/ubicacion por authenticated está denegada (42501):
--      solo service_role escribe.
--
-- Mecanismo: idéntico a rls_aislamiento_operacion.test.sql — simulamos el JWT
-- fijando `request.jwt.claims` y conmutando el rol a `authenticated`. Los
-- fixtures se insertan como `postgres` (bypassa RLS y los triggers se evalúan,
-- pero postgres tiene privilegios — los POD válidos se insertan con un conductor
-- asignado al pedido para satisfacer el trigger de consistencia).
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(15);

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
-- Fixtures: dos tenants (A y B).
--   Tenant A: 2 sellers (s_a, s_a2), 2 conductores (d_a, d_a2), manifiestos por
--     conductor, y pedidos SAME-DAY asignados (para poder capturar POD):
--       pedido_a1 (seller A,  same_day, asignado a d_a)  → POD de d_a
--       pedido_a3 (seller A2, same_day, asignado a d_a2) → POD de d_a2
--     Más pedido_a_flex (seller A, FLEX, asignado a d_a) para la FRONTERA.
--   Tenant B: 1 seller, 1 conductor, 1 pedido same_day asignado, 1 POD.
--   Ubicaciones: una por conductor (d_a, d_a2, d_b).
-- Se insertan como `postgres` (bypassa RLS).
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';

  s_a  uuid := 'aaaaaaaa-1111-0000-0000-000000000001';
  s_a2 uuid := 'aaaaaaaa-1111-0000-0000-000000000003';
  s_b  uuid := 'bbbbbbbb-1111-0000-0000-000000000002';

  d_a  uuid := 'aaaaaaaa-2222-0000-0000-000000000001';
  d_a2 uuid := 'aaaaaaaa-2222-0000-0000-000000000003';
  d_b  uuid := 'bbbbbbbb-2222-0000-0000-000000000002';

  u_interno_a   uuid := 'aaaaaaaa-3333-0000-0000-000000000001';
  u_seller_a    uuid := 'aaaaaaaa-3333-0000-0000-000000000003';
  u_seller_a2   uuid := 'aaaaaaaa-3333-0000-0000-000000000004';
  u_conductor_a uuid := 'aaaaaaaa-3333-0000-0000-000000000006';
  u_conductor_a2 uuid := 'aaaaaaaa-3333-0000-0000-000000000007';

  manifiesto_a  uuid := 'aaaaaaaa-5555-0000-0000-000000000001';
  manifiesto_a2 uuid := 'aaaaaaaa-5555-0000-0000-000000000002';
  manifiesto_b  uuid := 'bbbbbbbb-5555-0000-0000-000000000003';

  pedido_a1      uuid := 'aaaaaaaa-6666-0000-0000-000000000001'; -- seller A,  same_day, d_a
  pedido_a3      uuid := 'aaaaaaaa-6666-0000-0000-000000000003'; -- seller A2, same_day, d_a2
  pedido_a_flex  uuid := 'aaaaaaaa-6666-0000-0000-0000000000ff'; -- seller A,  FLEX,     d_a
  pedido_b1      uuid := 'bbbbbbbb-6666-0000-0000-000000000001'; -- seller B,  same_day, d_b

  asg_a1   uuid := 'aaaaaaaa-7777-0000-0000-000000000001';
  asg_a3   uuid := 'aaaaaaaa-7777-0000-0000-000000000003';
  asg_flex uuid := 'aaaaaaaa-7777-0000-0000-0000000000ff';
  asg_b1   uuid := 'bbbbbbbb-7777-0000-0000-000000000001';

  pod_a1 uuid := 'aaaaaaaa-aaaa-0000-0000-000000000001'; -- POD de pedido_a1 (seller A,  d_a)
  pod_a3 uuid := 'aaaaaaaa-aaaa-0000-0000-000000000003'; -- POD de pedido_a3 (seller A2, d_a2)
  pod_b1 uuid := 'bbbbbbbb-aaaa-0000-0000-000000000001'; -- POD de pedido_b1 (seller B,  d_b)
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier A', 'Courier A SpA', '76111111-1', 'activo'),
    (t_b, 'Courier B', 'Courier B SpA', '76222222-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_interno_a,    'interno.a@pod.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,     'seller.a@pod.test',     crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a2,    'seller.a2@pod.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a,  'conductor.a@pod.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a2, 'conductor.a2@pod.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a,  t_a, 'Seller Uno A', '77111111-1', 'Contacto Uno A', 'uno.a@seller.test', 'activo'),
    (s_a2, t_a, 'Seller Dos A', '77222222-2', 'Contacto Dos A', 'dos.a@seller.test', 'activo'),
    (s_b,  t_b, 'Seller Uno B', '77333333-3', 'Contacto Uno B', 'uno.b@seller.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values
    (d_a,  t_a, 'Conductor Uno A', '78111111-1', 'dependiente',   'activo'),
    (d_a2, t_a, 'Conductor Dos A', '78222222-2', 'independiente', 'activo'),
    (d_b,  t_b, 'Conductor Uno B', '78333333-3', 'dependiente',   'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a,    t_a, 'Interno A',            'interno',   null, null, 'dueno',     'activo'),
    (u_seller_a,     t_a, 'Usuario Seller A',     'seller',    s_a,  null, 'seller',    'activo'),
    (u_seller_a2,    t_a, 'Usuario Seller A2',    'seller',    s_a2, null, 'seller',    'activo'),
    (u_conductor_a,  t_a, 'Usuario Conductor A',  'conductor', null, d_a,  'conductor', 'activo'),
    (u_conductor_a2, t_a, 'Usuario Conductor A2', 'conductor', null, d_a2, 'conductor', 'activo')
  on conflict (id) do nothing;

  insert into operacion.manifiestos (id, tenant_id, driver_id, nombre, fecha_operacion, estado)
  values
    (manifiesto_a,  t_a, d_a,  'Ruta A',  '2026-06-19', 'confirmado'),
    (manifiesto_a2, t_a, d_a2, 'Ruta A2', '2026-06-19', 'confirmado'),
    (manifiesto_b,  t_b, d_b,  'Ruta B',  '2026-06-19', 'confirmado')
  on conflict (id) do nothing;

  -- Pedidos. Los same_day se asignan a un conductor (necesario para el POD).
  insert into operacion.pedidos (id, tenant_id, seller_id, tipo_pedido, origen,
    ml_shipment_id, estado, destinatario_nombre, destinatario_direccion, destinatario_comuna)
  values
    (pedido_a1,     t_a, s_a,  'same_day', 'same_day_manual', null,        'asignado',
     'Destinatario A1', 'Calle A 1', 'Santiago'),
    (pedido_a3,     t_a, s_a2, 'same_day', 'same_day_manual', null,        'asignado',
     'Destinatario A3', 'Calle A 3', 'Las Condes'),
    (pedido_a_flex, t_a, s_a,  'flex',     'ml_ingesta',      'SHP-A-FLX', 'asignado',
     'Destinatario AF', 'Calle A F', 'Providencia'),
    (pedido_b1,     t_b, s_b,  'same_day', 'same_day_manual', null,        'asignado',
     'Destinatario B1', 'Calle B 1', 'Vitacura')
  on conflict (id) do nothing;

  -- Asignaciones (el trigger sincroniza pedidos.driver_id_asignado).
  insert into operacion.asignaciones_pedido
    (id, tenant_id, pedido_id, manifiesto_id, driver_id, seller_id, activa)
  values
    (asg_a1,   t_a, pedido_a1,     manifiesto_a,  d_a,  s_a,  true),
    (asg_a3,   t_a, pedido_a3,     manifiesto_a2, d_a2, s_a2, true),
    (asg_flex, t_a, pedido_a_flex, manifiesto_a,  d_a,  s_a,  true),
    (asg_b1,   t_b, pedido_b1,     manifiesto_b,  d_b,  s_b,  true)
  on conflict (id) do nothing;

  -- POD same-day (válidos: conductor_id = driver_id_asignado del pedido).
  insert into operacion.pruebas_entrega
    (id, tenant_id, pedido_id, seller_id, conductor_id, tipo_resultado,
     tiene_foto, foto_object_path, geocerca_resultado, es_valido, capturado_en)
  values
    (pod_a1, t_a, pedido_a1, s_a,  d_a,  'entregado', true,
     'aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-6666-0000-0000-000000000001/aaaaaaaa-aaaa-0000-0000-000000000001/foto.jpg',
     'dentro', true, now()),
    (pod_a3, t_a, pedido_a3, s_a2, d_a2, 'entregado', true,
     'aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-6666-0000-0000-000000000003/aaaaaaaa-aaaa-0000-0000-000000000003/foto.jpg',
     'dentro', true, now()),
    (pod_b1, t_b, pedido_b1, s_b,  d_b,  'entregado', true,
     'bbbbbbbb-0000-0000-0000-000000000002/bbbbbbbb-6666-0000-0000-000000000001/bbbbbbbb-aaaa-0000-0000-000000000001/foto.jpg',
     'dentro', true, now())
  on conflict (id) do nothing;

  -- Ubicaciones (una por conductor).
  insert into operacion.ubicacion_conductor (conductor_id, tenant_id, lat, long, precision_m)
  values
    (d_a,  t_a, -33.4489, -70.6693, 12.0),
    (d_a2, t_a, -33.4090, -70.5670, 15.0),
    (d_b,  t_b, -33.3900, -70.5400, 10.0)
  on conflict (conductor_id) do nothing;
end $$;

-- =============================================================================
-- BLOQUE 1 · [FRONTERA DURA] El POD es exclusivo de same_day
-- =============================================================================
-- Se prueba como postgres (sin sesión simulada): el trigger de frontera se
-- evalúa para cualquier rol, incluido service_role/postgres. Es la barrera de
-- último recurso que protege Flex aunque el backend (service_role) se equivoque.

-- Un POD contra un pedido FLEX es RECHAZADO (23514).
select throws_ok(
  $$ insert into operacion.pruebas_entrega
       (tenant_id, pedido_id, seller_id, conductor_id, tipo_resultado)
     values
       ('aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-6666-0000-0000-0000000000ff',  -- pedido_a_flex (FLEX)
        'aaaaaaaa-1111-0000-0000-000000000001',  -- s_a
        'aaaaaaaa-2222-0000-0000-000000000001',  -- d_a (asignado al flex)
        'fallido') $$,
  '23514',
  null,
  'FRONTERA: un POD contra un pedido Flex es RECHAZADO por el trigger (protege Flex)'
);

-- Un POD adicional (fallido) contra un pedido same_day SÍ se acepta (la frontera
-- solo bloquea Flex; un 'fallido' puede repetirse sobre un mismo same_day).
select lives_ok(
  $$ insert into operacion.pruebas_entrega
       (tenant_id, pedido_id, seller_id, conductor_id, tipo_resultado)
     values
       ('aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-6666-0000-0000-000000000001',  -- pedido_a1 (same_day)
        'aaaaaaaa-1111-0000-0000-000000000001',  -- s_a
        'aaaaaaaa-2222-0000-0000-000000000001',  -- d_a
        'fallido') $$,
  'FRONTERA: un POD fallido contra un pedido same_day SÍ se acepta'
);

-- El UNIQUE parcial impide un segundo POD 'entregado' del mismo pedido same_day.
select throws_ok(
  $$ insert into operacion.pruebas_entrega
       (tenant_id, pedido_id, seller_id, conductor_id, tipo_resultado)
     values
       ('aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-6666-0000-0000-000000000001',  -- pedido_a1 (ya tiene un 'entregado')
        'aaaaaaaa-1111-0000-0000-000000000001',
        'aaaaaaaa-2222-0000-0000-000000000001',
        'entregado') $$,
  '23505',  -- unique_violation
  null,
  'Idempotencia: un segundo POD entregado del mismo pedido es rechazado (UNIQUE parcial)'
);

-- =============================================================================
-- BLOQUE 2 · Aislamiento de TENANT (P1) en POD y ubicacion
-- =============================================================================

-- --- Conductor A del tenant A ---
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

select is_empty(
  $$ select 1 from public.pruebas_entrega
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'P1 POD: conductor del tenant A NO ve POD del tenant B'
);

select is_empty(
  $$ select 1 from public.ubicacion_conductor
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'P1 ubicacion: conductor del tenant A NO ve ubicacion del tenant B'
);

-- =============================================================================
-- BLOQUE 3 · Aislamiento de CONDUCTOR (P3)
-- =============================================================================
-- Sigue como conductor A (d_a). NO debe ver el POD ni la ubicacion del conductor
-- A2 (mismo tenant), solo los suyos.

select isnt_empty(
  $$ select 1 from public.pruebas_entrega
     where conductor_id = 'aaaaaaaa-2222-0000-0000-000000000001' $$, -- d_a
  'P3 POD: conductor A SÍ ve su propio POD'
);

select is_empty(
  $$ select 1 from public.pruebas_entrega
     where conductor_id = 'aaaaaaaa-2222-0000-0000-000000000003' $$, -- d_a2
  'P3 POD: conductor A NO ve el POD del conductor A2 (mismo tenant, otro conductor)'
);

select isnt_empty(
  $$ select 1 from public.ubicacion_conductor
     where conductor_id = 'aaaaaaaa-2222-0000-0000-000000000001' $$, -- d_a
  'P3 ubicacion: conductor A SÍ ve su propia ubicacion'
);

select is_empty(
  $$ select 1 from public.ubicacion_conductor
     where conductor_id = 'aaaaaaaa-2222-0000-0000-000000000003' $$, -- d_a2
  'P3 ubicacion: conductor A NO ve la ubicacion del conductor A2'
);

-- =============================================================================
-- BLOQUE 4 · Aislamiento de SELLER (P2) en POD + sin acceso a ubicacion
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

-- MEDIO-3 (migración 0017): la rama P2 se quitó de pruebas_entrega — el seller YA
-- NO ve filas en la tabla/vista base (sin ruta SQL a geo_lat/geo_long). El seller
-- ahora consume public.pruebas_entrega_seller (vista minimizada, sin geo).
select is_empty(
  $$ select 1 from public.pruebas_entrega
     where seller_id = 'aaaaaaaa-1111-0000-0000-000000000001' $$, -- s_a
  'MEDIO-3: seller A YA NO ve POD en public.pruebas_entrega (rama P2 retirada, sin geo crudo)'
);

-- El seller A ve el POD de SU pedido en la vista minimizada (sin geo).
select isnt_empty(
  $$ select 1 from public.pruebas_entrega_seller
     where seller_id = 'aaaaaaaa-1111-0000-0000-000000000001' $$, -- s_a
  'MEDIO-3: seller A SÍ ve el POD de su propio pedido en la vista reducida'
);

-- Conteo: en la vista minimizada el seller A solo ve POD de SUS pedidos (no del A2
-- ni del tenant B). Filtramos a 'entregado' porque BLOQUE 1 añadió un 'fallido'
-- extra a pedido_a1 (mismo seller) — hay exactamente 1 'entregado' del seller A.
select results_eq(
  $$ select count(*)::int from public.pruebas_entrega_seller
     where tipo_resultado = 'entregado' $$,
  $$ values (1) $$,
  'MEDIO-3: seller A ve exactamente 1 POD entregado en la vista reducida (el suyo), ni de otro seller ni del tenant B'
);

-- El SELLER NO accede a ubicacion_conductor (dato sensible del trabajador): 0 filas
-- aunque la tabla tenga ubicaciones de su tenant.
select is_empty(
  $$ select 1 from public.ubicacion_conductor $$,
  'Privacidad: el seller A NO ve NINGUNA ubicacion de conductor (Ley 21.431)'
);

-- =============================================================================
-- BLOQUE 5 · Escritura denegada para authenticated (solo service_role escribe)
-- =============================================================================
-- Reusamos la sesión del conductor A. Un INSERT directo debe fallar por falta de
-- privilegio (42501): no hay grant de INSERT a authenticated.

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

select throws_ok(
  $$ insert into public.pruebas_entrega
       (tenant_id, pedido_id, seller_id, conductor_id, tipo_resultado)
     values
       ('aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-6666-0000-0000-000000000001',
        'aaaaaaaa-1111-0000-0000-000000000001',
        'aaaaaaaa-2222-0000-0000-000000000001',
        'fallido') $$,
  '42501',
  null,
  'Escritura POD: conductor authenticated NO puede INSERT (solo service_role escribe)'
);

select throws_ok(
  $$ update public.ubicacion_conductor
       set lat = -33.0
     where conductor_id = 'aaaaaaaa-2222-0000-0000-000000000001' $$,
  '42501',
  null,
  'Escritura ubicacion: conductor authenticated NO puede UPDATE (solo service_role escribe)'
);

select * from finish();

rollback;
