-- =============================================================================
-- Pruebas de aislamiento RLS — codigo_interno del pedido same-day (QR etiqueta)
-- =============================================================================
-- Demuestra, contra una base Postgres real (no mocks de aplicación):
--   1. La columna operacion.pedidos.codigo_interno existe y es NULLABLE.
--   2. El índice único parcial es GLOBAL (idx_pedidos_codigo_interno_global_uk,
--      solo sobre codigo_interno) y el viejo por tenant ya no existe.
--   3. Aislamiento de TENANT (P1): un usuario del tenant A NO lee el codigo_interno
--      de un pedido del tenant B a través de public.pedidos (bajo RLS).
--   4. Aislamiento de SELLER (P2): el seller A solo ve el codigo_interno de SUS
--      pedidos, NO el de otro seller del mismo tenant.
--   5. La unicidad de codigo_interno es GLOBAL (desde 2026-09-29): repetirlo en
--      OTRO tenant es rechazado (23505), igual que dentro del mismo. Antes esta
--      prueba afirmaba lo contrario — el mismo código podía vivir en dos couriers.
--
-- Mecanismo: idéntico a rls_aislamiento_operacion.test.sql — simulamos el JWT
-- fijando `request.jwt.claims` y conmutando el rol a `authenticated`. Los fixtures
-- se insertan como `postgres` (bypassa RLS).
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(10);

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

-- =============================================================================
-- BLOQUE 0 · Contrato de esquema: la columna existe y es NULLABLE
-- =============================================================================
select has_column(
  'operacion', 'pedidos', 'codigo_interno',
  'operacion.pedidos tiene la columna codigo_interno'
);

select col_is_null(
  'operacion', 'pedidos', 'codigo_interno',
  'codigo_interno es NULLABLE (solo se pobla en same-day)'
);

select has_index(
  'operacion', 'pedidos', 'idx_pedidos_codigo_interno_global_uk', array['codigo_interno'],
  'Existe el índice único parcial GLOBAL, solo sobre codigo_interno (sin tenant_id)'
);

select hasnt_index(
  'operacion', 'pedidos', 'idx_pedidos_codigo_interno_uk',
  'El índice por tenant se retiró: si volviera, alguien podría creer que basta'
);

-- -----------------------------------------------------------------------------
-- Fixtures: dos tenants (A y B). Tenant A tiene 2 sellers (s_a, s_a2) con un
-- pedido same-day cada uno y su codigo_interno. Tenant B tiene 1 seller con un
-- pedido same-day con su PROPIO código. Insertados como `postgres`.
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';

  s_a  uuid := 'aaaaaaaa-1111-0000-0000-000000000001';
  s_a2 uuid := 'aaaaaaaa-1111-0000-0000-000000000003';
  s_b  uuid := 'bbbbbbbb-1111-0000-0000-000000000002';

  u_interno_a uuid := 'aaaaaaaa-3333-0000-0000-000000000001';
  u_seller_a  uuid := 'aaaaaaaa-3333-0000-0000-000000000003';

  pedido_a1 uuid := 'aaaaaaaa-6666-0000-0000-000000000001'; -- seller A,  code RX-AAAA-0001
  pedido_a3 uuid := 'aaaaaaaa-6666-0000-0000-000000000003'; -- seller A2, code RX-AAAA-0003
  pedido_b1 uuid := 'bbbbbbbb-6666-0000-0000-000000000001'; -- seller B,  code RX-BBBB-0001
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier A', 'Courier A SpA', '76111111-1', 'activo'),
    (t_b, 'Courier B', 'Courier B SpA', '76222222-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_interno_a, 'interno.a@codigo.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,  'seller.a@codigo.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a,  t_a, 'Seller Uno A', '77111111-1', 'Contacto Uno A', 'uno.a@seller.test', 'activo'),
    (s_a2, t_a, 'Seller Dos A', '77222222-2', 'Contacto Dos A', 'dos.a@seller.test', 'activo'),
    (s_b,  t_b, 'Seller Uno B', '77333333-3', 'Contacto Uno B', 'uno.b@seller.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a, t_a, 'Interno A',        'interno', null, null, 'dueno',  'activo'),
    (u_seller_a,  t_a, 'Usuario Seller A', 'seller',  s_a,  null, 'seller', 'activo')
  on conflict (id) do nothing;

  -- Pedidos same-day con codigo_interno, todos distintos: el índice es global.
  insert into operacion.pedidos (id, tenant_id, seller_id, tipo_pedido, fuente, origen,
    ml_shipment_id, estado, destinatario_nombre, destinatario_direccion,
    destinatario_comuna, codigo_interno)
  values
    (pedido_a1, t_a, s_a,  'same_day', 'rutax_manual', 'same_day_manual', null, 'pendiente_asignacion',
     'Destinatario A1', 'Calle A 1', 'Santiago',   'RX-AAAA-0001'),
    (pedido_a3, t_a, s_a2, 'same_day', 'rutax_manual', 'same_day_manual', null, 'pendiente_asignacion',
     'Destinatario A3', 'Calle A 3', 'Las Condes', 'RX-AAAA-0003'),
    (pedido_b1, t_b, s_b,  'same_day', 'rutax_manual', 'same_day_manual', null, 'pendiente_asignacion',
     'Destinatario B1', 'Calle B 1', 'Vitacura',   'RX-BBBB-0001')
  on conflict (id) do nothing;
end $$;

-- =============================================================================
-- BLOQUE 1 · Unicidad GLOBAL
-- =============================================================================
-- Reusar en el tenant B un código que ya tiene el tenant A es rechazado (23505).
-- Es el caso que el índice por tenant dejaba pasar.
select throws_ok(
  $$ insert into operacion.pedidos (tenant_id, seller_id, tipo_pedido, fuente, origen,
       estado, destinatario_nombre, destinatario_direccion, destinatario_comuna,
       codigo_interno)
     values
       ('bbbbbbbb-0000-0000-0000-000000000002',  -- t_b (OTRO tenant)
        'bbbbbbbb-1111-0000-0000-000000000002',  -- s_b
        'same_day', 'rutax_manual', 'same_day_manual', 'pendiente_asignacion',
        'Dup B', 'Calle Dup', 'Ñuñoa',
        'RX-AAAA-0001') $$,                        -- código ya usado en t_a
  '23505',  -- unique_violation
  null,
  'Unicidad global: repetir en otro tenant un codigo_interno ya usado es rechazado'
);

-- Repetir el código DENTRO del mismo tenant A es rechazado (23505).
select throws_ok(
  $$ insert into operacion.pedidos (tenant_id, seller_id, tipo_pedido, fuente, origen,
       estado, destinatario_nombre, destinatario_direccion, destinatario_comuna,
       codigo_interno)
     values
       ('aaaaaaaa-0000-0000-0000-000000000001',  -- t_a (mismo tenant que pedido_a1)
        'aaaaaaaa-1111-0000-0000-000000000001',  -- s_a
        'same_day', 'rutax_manual', 'same_day_manual', 'pendiente_asignacion',
        'Dup A', 'Calle Dup', 'Ñuñoa',
        'RX-AAAA-0001') $$,                        -- código ya usado en t_a
  '23505',  -- unique_violation
  null,
  'Unicidad global: repetir codigo_interno dentro del mismo tenant también es rechazado'
);

-- =============================================================================
-- BLOQUE 2 · Aislamiento de TENANT (P1) sobre codigo_interno vía public.pedidos
-- =============================================================================
-- Usuario interno del tenant A: NO debe leer el pedido (ni su codigo_interno) del
-- tenant B, aunque conozca el código.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- u_interno_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

select is_empty(
  $$ select 1 from public.pedidos
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'P1: interno del tenant A NO ve pedidos del tenant B'
);

-- Aunque conozca el código exacto de un pedido del tenant B, el interno de A no
-- lo alcanza: la barrera es la RLS de fila, no la unicidad del código.
select is_empty(
  $$ select 1 from public.pedidos where codigo_interno = 'RX-BBBB-0001' $$,
  'P1: buscando por el codigo_interno de un pedido del tenant B, el interno de A no ve nada'
);

-- =============================================================================
-- BLOQUE 3 · Aislamiento de SELLER (P2) sobre codigo_interno vía public.pedidos
-- =============================================================================
-- El seller A solo ve el codigo_interno de SUS pedidos, no el del seller A2.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

select isnt_empty(
  $$ select 1 from public.pedidos
     where codigo_interno = 'RX-AAAA-0001'
       and seller_id = 'aaaaaaaa-1111-0000-0000-000000000001' $$, -- s_a
  'P2: seller A SÍ ve el codigo_interno de su propio pedido'
);

select is_empty(
  $$ select 1 from public.pedidos
     where codigo_interno = 'RX-AAAA-0003' $$, -- código del seller A2 (mismo tenant)
  'P2: seller A NO ve el codigo_interno de un pedido de otro seller (A2) del mismo tenant'
);

select * from finish();

rollback;
