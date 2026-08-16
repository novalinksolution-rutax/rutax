-- =============================================================================
-- Pruebas de aislamiento RLS — geocoding (F4, ítem 1.1)
-- =============================================================================
-- Demuestra, contra una base Postgres real (no mocks de aplicación):
--   1. integraciones.geocoding_cache es estructuralmente invisible para
--      authenticated, sea cual sea su tipo de rol (interno/seller/conductor):
--      0 filas / 42501 — el cache global solo lo toca service_role.
--   2. Las columnas nuevas de geocoding en pedidos (lat, long, geo_estado,
--      cobertura_estado, ...) respetan las políticas P1/P2/P3 existentes:
--        - Aislamiento de tenant: un interno del tenant A no ve lat/long del tenant B.
--        - Aislamiento de seller: un seller NO ve lat/long de un pedido de otro
--          seller del mismo tenant, ni datos internos del courier.
--   3. La vista public.pedidos expone las columnas nuevas heredando la RLS base.
--
-- Mecanismo idéntico a rls_aislamiento_operacion.test.sql: simulamos el JWT
-- fijando `request.jwt.claims` y conmutando el rol a `authenticated`.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(12);

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
-- Fixtures: dos tenants (A y B). Tenant A tiene 2 sellers; geocodificamos
-- (como postgres) los pedidos para poblar lat/long. Tenant B tiene 1 pedido
-- geocodificado para probar el aislamiento de tenant cruzado.
-- Además insertamos 1 fila en el cache global de geocoding (sin tenant).
-- Se insertan como `postgres` (bypassa RLS).
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';

  s_a  uuid := 'aaaaaaaa-1111-0000-0000-000000000001';
  s_a2 uuid := 'aaaaaaaa-1111-0000-0000-000000000003';
  s_b  uuid := 'bbbbbbbb-1111-0000-0000-000000000002';

  u_interno_a   uuid := 'aaaaaaaa-3333-0000-0000-000000000001';
  u_seller_a    uuid := 'aaaaaaaa-3333-0000-0000-000000000003';
  u_seller_a2   uuid := 'aaaaaaaa-3333-0000-0000-000000000004';

  -- Pedidos geocodificados de fixture
  pedido_a1 uuid := 'aaaaaaaa-6666-0000-0000-000000000001'; -- seller A,  tenant A
  pedido_a3 uuid := 'aaaaaaaa-6666-0000-0000-000000000003'; -- seller A2, tenant A
  pedido_b1 uuid := 'bbbbbbbb-6666-0000-0000-000000000001'; -- seller B,  tenant B
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier A', 'Courier A SpA', '76111111-1', 'activo'),
    (t_b, 'Courier B', 'Courier B SpA', '76222222-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_interno_a, 'interno.a@geocoding.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,  'seller.a@geocoding.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a2, 'seller.a2@geocoding.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a,  t_a, 'Seller Uno A', '77111111-1', 'Contacto Uno A', 'uno.a@seller.test', 'activo'),
    (s_a2, t_a, 'Seller Dos A', '77222222-2', 'Contacto Dos A', 'dos.a@seller.test', 'activo'),
    (s_b,  t_b, 'Seller Uno B', '77333333-3', 'Contacto Uno B', 'uno.b@seller.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a, t_a, 'Interno A',         'interno', null, null, 'dueno',  'activo'),
    (u_seller_a,  t_a, 'Usuario Seller A',  'seller',  s_a,  null, 'seller', 'activo'),
    (u_seller_a2, t_a, 'Usuario Seller A2', 'seller',  s_a2, null, 'seller', 'activo')
  on conflict (id) do nothing;

  -- Pedidos geocodificados (lat/long pobladas, geo_estado = resuelto).
  insert into operacion.pedidos (id, tenant_id, seller_id, tipo_pedido, fuente, origen,
    ml_shipment_id, estado, destinatario_nombre, destinatario_direccion, destinatario_comuna,
    lat, long, geo_estado, geo_confianza, geocodificado_en, cobertura_estado)
  values
    (pedido_a1, t_a, s_a,  'flex',     'ml_flex',     'ml_ingesta',     'SHP-GEO-A-001', 'pendiente_asignacion',
     'Destinatario A1', 'Calle A 1', 'Santiago',
     -33.4489, -70.6693, 'resuelto', 0.950, now(), 'tarifada'),
    (pedido_a3, t_a, s_a2, 'same_day', 'rutax_manual', 'same_day_manual', null,           'pendiente_asignacion',
     'Destinatario A3', 'Calle A 3', 'Las Condes',
     -33.4090, -70.5670, 'resuelto', 0.880, now(), 'tarifada'),
    (pedido_b1, t_b, s_b,  'flex',     'ml_flex',     'ml_ingesta',     'SHP-GEO-B-001', 'pendiente_asignacion',
     'Destinatario B1', 'Calle B 1', 'Vitacura',
     -33.3900, -70.5400, 'resuelto', 0.910, now(), 'tarifada')
  on conflict (id) do nothing;

  -- Cache global de geocoding (sin tenant_id) — una entrada de prueba.
  insert into integraciones.geocoding_cache
    (clave_hash, direccion_norm, comuna_norm, lat, long, geo_estado, confianza, proveedor)
  values
    ('hash-test-calle-a-1-santiago', 'calle a 1', 'santiago',
     -33.4489, -70.6693, 'resuelto', 0.950, 'stub')
  on conflict (clave_hash) do nothing;
end $$;

-- =============================================================================
-- BLOQUE 1 · geocoding_cache invisible para authenticated (cualquier rol)
-- =============================================================================
-- El cache es GLOBAL y solo service_role. FORCE RLS sin política + revoke all +
-- sin vista en public → cualquier authenticated recibe 42501 al acceder al
-- esquema/tabla directamente (no hay vista en public que consultar).

-- --- Interno del tenant A ---
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- u_interno_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

select throws_ok(
  $$ select 1 from integraciones.geocoding_cache $$,
  '42501',
  null,
  'geocoding_cache: interno autenticado NO puede SELECT (cache global, solo service_role)'
);

-- No existe vista pública del cache: el objeto public.geocoding_cache no existe.
select is_empty(
  $$ select 1 from information_schema.views
     where table_schema = 'public' and table_name = 'geocoding_cache' $$,
  'geocoding_cache: NO hay vista public.geocoding_cache (cache no expuesto a PostgREST)'
);

-- --- Seller del tenant A ---
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

select throws_ok(
  $$ select 1 from integraciones.geocoding_cache $$,
  '42501',
  null,
  'geocoding_cache: seller autenticado NO puede SELECT (cache global, sin privilegios)'
);

-- --- Conductor (simulado, sin entidad: basta el claim de tipo) ---
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- reusamos un user válido
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000099'::uuid
);

select throws_ok(
  $$ select 1 from integraciones.geocoding_cache $$,
  '42501',
  null,
  'geocoding_cache: conductor autenticado NO puede SELECT (cache global, sin privilegios)'
);

-- Tampoco puede INSERT (defensa en profundidad).
select throws_ok(
  $$ insert into integraciones.geocoding_cache
       (clave_hash, direccion_norm, comuna_norm, geo_estado, proveedor)
     values ('hash-hack', 'x', 'y', 'no_resuelto', 'stub') $$,
  '42501',
  null,
  'geocoding_cache: authenticated NO puede INSERT (solo service_role escribe el cache)'
);

-- =============================================================================
-- BLOQUE 2 · Columnas de geocoding en pedidos respetan P1 (tenant)
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- u_interno_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

-- El interno del tenant A NO ve lat/long de pedidos del tenant B.
select is_empty(
  $$ select lat, long from public.pedidos
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'P1 geocoding: interno del tenant A NO ve lat/long de pedidos del tenant B'
);

-- El interno SÍ ve las coordenadas de sus propios pedidos geocodificados.
select isnt_empty(
  $$ select lat, long from public.pedidos
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
       and lat is not null and long is not null $$,
  'P1 geocoding: interno del tenant A SÍ ve lat/long de sus propios pedidos'
);

-- La columna geo_estado se expone vía la vista re-emitida.
select isnt_empty(
  $$ select 1 from public.pedidos
     where geo_estado = 'resuelto'
       and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'vista public.pedidos: expone geo_estado heredado (columna nueva visible para el interno)'
);

-- =============================================================================
-- BLOQUE 3 · Columnas de geocoding en pedidos respetan P2 (seller)
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

-- El seller A ve lat/long de SUS pedidos (pedido_a1).
select isnt_empty(
  $$ select lat, long from public.pedidos
     where id = 'aaaaaaaa-6666-0000-0000-000000000001'  -- pedido_a1 (seller A)
       and lat is not null $$,
  'P2 geocoding: seller A SÍ ve lat/long de su propio pedido (pedido_a1)'
);

-- El seller A NO ve lat/long de un pedido de OTRO seller (pedido_a3, seller A2),
-- aunque sea del mismo tenant. La fila completa queda fuera de su alcance.
select is_empty(
  $$ select lat, long from public.pedidos
     where seller_id = 'aaaaaaaa-1111-0000-0000-000000000003'  -- s_a2
       and lat is not null $$,
  'P2 geocoding: seller A NO ve lat/long de un pedido del seller A2 (mismo tenant, otro seller)'
);

-- Conteo: el seller A solo ve sus pedidos geocodificados (pedido_a1), no el del A2.
select results_eq(
  $$ select count(*)::int from public.pedidos where lat is not null $$,
  $$ values (1) $$,
  'P2 geocoding: seller A ve exactamente 1 pedido geocodificado (el suyo), no el de otro seller ni del tenant B'
);

-- El seller A tampoco ve pedidos del tenant B (defensa de tenant dentro de P2).
select is_empty(
  $$ select 1 from public.pedidos
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'P1+P2 geocoding: seller A NO ve ningún pedido del tenant B'
);

select * from finish();

rollback;
