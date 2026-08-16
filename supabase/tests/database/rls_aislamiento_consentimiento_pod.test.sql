-- =============================================================================
-- Pruebas de aislamiento RLS — consentimiento de ubicación + minimización POD
-- (Bloque 2, hallazgos ALTO-2 y MEDIO-3)
-- =============================================================================
-- Demuestra, contra una base Postgres real (no mocks de aplicación):
--
--   ALTO-2 (consentimientos_ubicacion):
--     1. El SELLER NO ve NINGÚN consentimiento (dato del trabajador) — 0 filas.
--     2. El conductor A SÍ ve SU consentimiento vigente, NO el del conductor A2.
--     3. Aislamiento cross-tenant: el conductor A no ve consentimientos del tenant B.
--     4. La escritura por authenticated está denegada (42501): solo service_role.
--
--   MEDIO-3 (minimización del POD al seller):
--     5. Tras quitar la rama P2, el seller ve 0 filas en public.pruebas_entrega
--        (ya no tiene ruta SQL a geo_lat/geo_long).
--     6. El seller SÍ ve SUS POD en public.pruebas_entrega_seller, pero esa vista
--        NO expone columnas geo (la columna geo_lat ni existe en la vista).
--     7. El seller A solo ve SUS POD en la vista reducida, no los del seller A2
--        ni los del tenant B.
--     8. interno y conductor SIGUEN viendo pruebas_entrega (no se rompió su acceso).
--
-- Mecanismo: idéntico a rls_aislamiento_pod_tracking.test.sql — simulamos el JWT
-- fijando `request.jwt.claims` y conmutando el rol a `authenticated`. Los fixtures
-- se insertan como `postgres` (bypassa RLS).
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(13);

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
--   Tenant A: 2 sellers (s_a, s_a2), 2 conductores (d_a, d_a2), manifiestos,
--     pedidos SAME-DAY asignados con su POD, y consentimientos por conductor.
--   Tenant B: 1 seller, 1 conductor, 1 pedido same_day con POD, 1 consentimiento.
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

  u_interno_a    uuid := 'aaaaaaaa-3333-0000-0000-000000000001';
  u_seller_a     uuid := 'aaaaaaaa-3333-0000-0000-000000000003';
  u_seller_a2    uuid := 'aaaaaaaa-3333-0000-0000-000000000004';
  u_conductor_a  uuid := 'aaaaaaaa-3333-0000-0000-000000000006';
  u_conductor_a2 uuid := 'aaaaaaaa-3333-0000-0000-000000000007';

  manifiesto_a  uuid := 'aaaaaaaa-5555-0000-0000-000000000001';
  manifiesto_a2 uuid := 'aaaaaaaa-5555-0000-0000-000000000002';
  manifiesto_b  uuid := 'bbbbbbbb-5555-0000-0000-000000000003';

  pedido_a1 uuid := 'aaaaaaaa-6666-0000-0000-000000000001'; -- seller A,  same_day, d_a
  pedido_a3 uuid := 'aaaaaaaa-6666-0000-0000-000000000003'; -- seller A2, same_day, d_a2
  pedido_b1 uuid := 'bbbbbbbb-6666-0000-0000-000000000001'; -- seller B,  same_day, d_b

  asg_a1 uuid := 'aaaaaaaa-7777-0000-0000-000000000001';
  asg_a3 uuid := 'aaaaaaaa-7777-0000-0000-000000000003';
  asg_b1 uuid := 'bbbbbbbb-7777-0000-0000-000000000001';

  pod_a1 uuid := 'aaaaaaaa-aaaa-0000-0000-000000000001';
  pod_a3 uuid := 'aaaaaaaa-aaaa-0000-0000-000000000003';
  pod_b1 uuid := 'bbbbbbbb-aaaa-0000-0000-000000000001';

  cons_a  uuid := 'aaaaaaaa-cccc-0000-0000-000000000001';
  cons_a2 uuid := 'aaaaaaaa-cccc-0000-0000-000000000003';
  cons_b  uuid := 'bbbbbbbb-cccc-0000-0000-000000000001';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier A', 'Courier A SpA', '76111111-1', 'activo'),
    (t_b, 'Courier B', 'Courier B SpA', '76222222-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_interno_a,    'interno.a@cons.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,     'seller.a@cons.test',     crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a2,    'seller.a2@cons.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a,  'conductor.a@cons.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a2, 'conductor.a2@cons.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
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

  insert into operacion.pedidos (id, tenant_id, seller_id, tipo_pedido, fuente, origen,
    ml_shipment_id, estado, destinatario_nombre, destinatario_direccion, destinatario_comuna)
  values
    (pedido_a1, t_a, s_a,  'same_day', 'rutax_manual', 'same_day_manual', null, 'asignado',
     'Destinatario A1', 'Calle A 1', 'Santiago'),
    (pedido_a3, t_a, s_a2, 'same_day', 'rutax_manual', 'same_day_manual', null, 'asignado',
     'Destinatario A3', 'Calle A 3', 'Las Condes'),
    (pedido_b1, t_b, s_b,  'same_day', 'rutax_manual', 'same_day_manual', null, 'asignado',
     'Destinatario B1', 'Calle B 1', 'Vitacura')
  on conflict (id) do nothing;

  insert into operacion.asignaciones_pedido
    (id, tenant_id, pedido_id, manifiesto_id, driver_id, seller_id, activa)
  values
    (asg_a1, t_a, pedido_a1, manifiesto_a,  d_a,  s_a,  true),
    (asg_a3, t_a, pedido_a3, manifiesto_a2, d_a2, s_a2, true),
    (asg_b1, t_b, pedido_b1, manifiesto_b,  d_b,  s_b,  true)
  on conflict (id) do nothing;

  -- POD same-day con coordenadas geo pobladas (para probar que el seller NO las ve).
  insert into operacion.pruebas_entrega
    (id, tenant_id, pedido_id, seller_id, conductor_id, tipo_resultado,
     tiene_foto, foto_object_path, geo_lat, geo_long, geo_precision_m,
     distancia_destino_m, geocerca_resultado, es_valido, capturado_en)
  values
    (pod_a1, t_a, pedido_a1, s_a,  d_a,  'entregado', true,
     'aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-6666-0000-0000-000000000001/pod/foto.jpg',
     -33.4489, -70.6693, 12.0, 8.5, 'dentro', true, now()),
    (pod_a3, t_a, pedido_a3, s_a2, d_a2, 'entregado', true,
     'aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-6666-0000-0000-000000000003/pod/foto.jpg',
     -33.4090, -70.5670, 15.0, 11.0, 'dentro', true, now()),
    (pod_b1, t_b, pedido_b1, s_b,  d_b,  'entregado', true,
     'bbbbbbbb-0000-0000-0000-000000000002/bbbbbbbb-6666-0000-0000-000000000001/pod/foto.jpg',
     -33.3900, -70.5400, 10.0, 5.0, 'dentro', true, now())
  on conflict (id) do nothing;

  -- Consentimientos de ubicación (uno vigente por conductor).
  insert into operacion.consentimientos_ubicacion
    (id, tenant_id, conductor_id, acepto, version_texto, otorgado_en)
  values
    (cons_a,  t_a, d_a,  true, 'v1', now()),
    (cons_a2, t_a, d_a2, true, 'v1', now()),
    (cons_b,  t_b, d_b,  true, 'v1', now())
  on conflict (id) do nothing;
end $$;

-- =============================================================================
-- BLOQUE 1 · ALTO-2 — consentimientos_ubicacion: SELLER no ve nada
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

select is_empty(
  $$ select 1 from public.consentimientos_ubicacion $$,
  'ALTO-2: el seller A NO ve NINGÚN consentimiento de ubicación (dato del trabajador)'
);

-- El seller tampoco accede a ubicacion_conductor (regresión de la 0016).
select is_empty(
  $$ select 1 from public.ubicacion_conductor $$,
  'ALTO-2/0016: el seller A NO ve ubicacion_conductor (dato sensible del trabajador)'
);

-- =============================================================================
-- BLOQUE 2 · ALTO-2 — conductor ve SU consentimiento, no el de otro conductor
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

select isnt_empty(
  $$ select 1 from public.consentimientos_ubicacion
     where conductor_id = 'aaaaaaaa-2222-0000-0000-000000000001' $$, -- d_a
  'ALTO-2: el conductor A SÍ ve su propio consentimiento vigente'
);

select is_empty(
  $$ select 1 from public.consentimientos_ubicacion
     where conductor_id = 'aaaaaaaa-2222-0000-0000-000000000003' $$, -- d_a2
  'ALTO-2: el conductor A NO ve el consentimiento del conductor A2 (mismo tenant)'
);

-- Cross-tenant: el conductor A no ve consentimientos del tenant B.
select is_empty(
  $$ select 1 from public.consentimientos_ubicacion
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'ALTO-2: el conductor A NO ve consentimientos del tenant B (aislamiento cross-tenant)'
);

-- El interno SÍ ve la nómina de consentimientos de su tenant (2: d_a y d_a2).
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- u_interno_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

select results_eq(
  $$ select count(*)::int from public.consentimientos_ubicacion $$,
  $$ values (2) $$,
  'ALTO-2: el interno A ve los 2 consentimientos de su tenant (no los del tenant B)'
);

-- =============================================================================
-- BLOQUE 3 · ALTO-2 — escritura denegada para authenticated (solo service_role)
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

select throws_ok(
  $$ insert into public.consentimientos_ubicacion
       (tenant_id, conductor_id, acepto)
     values
       ('aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-2222-0000-0000-000000000001',
        true) $$,
  '42501',
  null,
  'ALTO-2: el conductor authenticated NO puede INSERT consentimiento (solo service_role)'
);

-- =============================================================================
-- BLOQUE 4 · MEDIO-3 — el seller NO ve geo en pruebas_entrega; sí la vista reducida
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

-- Tras quitar la rama P2: el seller ve 0 filas en pruebas_entrega → no hay ruta
-- SQL a geo_lat/geo_long.
select is_empty(
  $$ select 1 from public.pruebas_entrega $$,
  'MEDIO-3: el seller A NO ve NINGUNA fila en public.pruebas_entrega (sin acceso a geo crudo)'
);

-- La vista reducida NO expone la columna geo_lat (ni siquiera existe en la vista).
select is_empty(
  $$ select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'pruebas_entrega_seller'
       and column_name in ('geo_lat', 'geo_long', 'geo_precision_m', 'distancia_destino_m') $$,
  'MEDIO-3: public.pruebas_entrega_seller NO expone columnas geo (geo_lat/long/precision/distancia)'
);

-- El seller SÍ ve SUS POD en la vista reducida (pedido_a1).
select isnt_empty(
  $$ select 1 from public.pruebas_entrega_seller
     where seller_id = 'aaaaaaaa-1111-0000-0000-000000000001' $$, -- s_a
  'MEDIO-3: el seller A SÍ ve su propio POD en la vista reducida (con geocerca_resultado, sin geo)'
);

-- geocerca_resultado SÍ es visible en la vista (es un resultado, no una coordenada).
select isnt_empty(
  $$ select 1 from public.pruebas_entrega_seller
     where geocerca_resultado = 'dentro' $$,
  'MEDIO-3: la vista reducida SÍ expone geocerca_resultado (dentro/fuera/sin_referencia)'
);

-- El seller A solo ve SU POD, no el del seller A2 ni el del tenant B.
select results_eq(
  $$ select count(*)::int from public.pruebas_entrega_seller $$,
  $$ values (1) $$,
  'MEDIO-3: el seller A ve exactamente 1 POD en la vista reducida (el suyo), no de otro seller ni tenant B'
);

-- =============================================================================
-- BLOQUE 5 · MEDIO-3 — interno y conductor NO perdieron acceso a pruebas_entrega
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

select isnt_empty(
  $$ select geo_lat, geo_long from public.pruebas_entrega
     where conductor_id = 'aaaaaaaa-2222-0000-0000-000000000001' $$, -- d_a
  'MEDIO-3: el conductor A SÍ sigue viendo su POD con geo (su acceso no se rompió)'
);

select * from finish();

rollback;
