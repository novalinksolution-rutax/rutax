-- =============================================================================
-- Pruebas de aislamiento RLS — módulo operacion (Fase B)
-- =============================================================================
-- Demuestra, contra una base Postgres real (no mocks de aplicación):
--   1. Un usuario del tenant A NO puede ver pedidos/manifiestos del tenant B.
--   2. Un seller NO ve datos de otro seller (P2 en pedidos, incidencias,
--      asignaciones) ni datos internos del courier (manifiestos).
--   3. Un conductor solo ve sus propios manifiestos y pedidos asignados a él (P3).
--   4. Sellers y conductores que intentan UPDATE reciben 42501 explícito
--      (no "UPDATE 0" silencioso) — guard de defensa en profundidad.
--   5. intentos_backfill es estructuralmente invisible para authenticated.
--   6. El trigger de consistencia de asignaciones_pedido rechaza driver_id/
--      seller_id incorrectos con errcode 23514.
--   7. El trigger sincronizar_driver_id_asignado mantiene pedidos.driver_id_asignado.
--
-- Mecanismo: idéntico a rls_aislamiento.test.sql — simulamos el JWT fijando
-- `request.jwt.claims` y conmutando el rol a `authenticated` con set local role.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(37);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada (mismo mecanismo que los archivos existentes;
-- redefinidos aquí porque cada .test.sql corre en su propia transacción).
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
-- Fixtures: dos tenants (A y B). Tenant A tiene:
--   - 2 sellers (s_a, s_a2), 2 conductores (d_a, d_a2)
--   - 2 manifiestos (uno por conductor)
--   - 4 pedidos (2 del seller A, 2 del seller A2; de los del seller A,
--     uno asignado al conductor A y otro sin asignar)
--   - 1 asignación activa (pedido_a1 → manifiesto_a → conductor_a)
--   - 1 incidencia y 1 evidencia del seller A
-- Tenant B tiene datos mínimos para probar el aislamiento de tenant cruzado.
--
-- Se insertan como `postgres` (bypassa RLS) — igual que en los tests existentes.
-- -----------------------------------------------------------------------------
do $$
declare
  -- Tenants
  t_a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';

  -- Sellers (dos del tenant A)
  s_a  uuid := 'aaaaaaaa-1111-0000-0000-000000000001';
  s_a2 uuid := 'aaaaaaaa-1111-0000-0000-000000000003';
  s_b  uuid := 'bbbbbbbb-1111-0000-0000-000000000002';

  -- Conductores (dos del tenant A)
  d_a  uuid := 'aaaaaaaa-2222-0000-0000-000000000001';
  d_a2 uuid := 'aaaaaaaa-2222-0000-0000-000000000003';
  d_b  uuid := 'bbbbbbbb-2222-0000-0000-000000000002';

  -- Usuarios auth
  u_interno_a    uuid := 'aaaaaaaa-3333-0000-0000-000000000001';
  u_interno_b    uuid := 'bbbbbbbb-3333-0000-0000-000000000002';
  u_seller_a     uuid := 'aaaaaaaa-3333-0000-0000-000000000003';
  u_seller_a2    uuid := 'aaaaaaaa-3333-0000-0000-000000000004';
  u_seller_b     uuid := 'bbbbbbbb-3333-0000-0000-000000000005';
  u_conductor_a  uuid := 'aaaaaaaa-3333-0000-0000-000000000006';
  u_conductor_a2 uuid := 'aaaaaaaa-3333-0000-0000-000000000007';
  u_conductor_b  uuid := 'bbbbbbbb-3333-0000-0000-000000000008';

  -- IDs de entidades del módulo operacion
  manifiesto_a  uuid := 'aaaaaaaa-5555-0000-0000-000000000001'; -- conductor A, tenant A
  manifiesto_a2 uuid := 'aaaaaaaa-5555-0000-0000-000000000002'; -- conductor A2, tenant A
  manifiesto_b  uuid := 'bbbbbbbb-5555-0000-0000-000000000003'; -- conductor B, tenant B

  pedido_a1 uuid := 'aaaaaaaa-6666-0000-0000-000000000001'; -- seller A,  tenant A, asignado a d_a
  pedido_a2 uuid := 'aaaaaaaa-6666-0000-0000-000000000002'; -- seller A,  tenant A, sin asignar
  pedido_a3 uuid := 'aaaaaaaa-6666-0000-0000-000000000003'; -- seller A2, tenant A
  pedido_b1 uuid := 'bbbbbbbb-6666-0000-0000-000000000001'; -- seller B,  tenant B

  asignacion_a1 uuid := 'aaaaaaaa-7777-0000-0000-000000000001'; -- pedido_a1 → manifiesto_a
  incidencia_a1 uuid := 'aaaaaaaa-8888-0000-0000-000000000001'; -- del pedido_a1, seller A
  evidencia_a1  uuid := 'aaaaaaaa-9999-0000-0000-000000000001'; -- de la incidencia_a1
begin
  -- Tenants (idempotente — estos fixtures ya existen en los otros tests,
  -- pero ON CONFLICT DO NOTHING los hace seguros si este archivo corre primero
  -- o en aislamiento)
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier A', 'Courier A SpA', '76111111-1', 'activo'),
    (t_b, 'Courier B', 'Courier B SpA', '76222222-2', 'activo')
  on conflict (id) do nothing;

  -- auth.users
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_interno_a,    'interno.a@operacion.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_interno_b,    'interno.b@operacion.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,     'seller.a@operacion.test',     crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a2,    'seller.a2@operacion.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_b,     'seller.b@operacion.test',     crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a,  'conductor.a@operacion.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a2, 'conductor.a2@operacion.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_b,  'conductor.b@operacion.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  -- Sellers
  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a,  t_a, 'Seller Uno A', '77111111-1', 'Contacto Uno A', 'uno.a@seller.test', 'activo'),
    (s_a2, t_a, 'Seller Dos A', '77222222-2', 'Contacto Dos A', 'dos.a@seller.test', 'activo'),
    (s_b,  t_b, 'Seller Uno B', '77333333-3', 'Contacto Uno B', 'uno.b@seller.test', 'activo')
  on conflict (id) do nothing;

  -- Conductores
  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values
    (d_a,  t_a, 'Conductor Uno A',  '78111111-1', 'dependiente',   'activo'),
    (d_a2, t_a, 'Conductor Dos A',  '78222222-2', 'independiente', 'activo'),
    (d_b,  t_b, 'Conductor Uno B',  '78333333-3', 'dependiente',   'activo')
  on conflict (id) do nothing;

  -- usuarios_perfil
  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a,    t_a, 'Interno A',            'interno',   null, null, 'dueno',     'activo'),
    (u_interno_b,    t_b, 'Interno B',            'interno',   null, null, 'dueno',     'activo'),
    (u_seller_a,     t_a, 'Usuario Seller A',     'seller',    s_a,  null, 'seller',    'activo'),
    (u_seller_a2,    t_a, 'Usuario Seller A2',    'seller',    s_a2, null, 'seller',    'activo'),
    (u_seller_b,     t_b, 'Usuario Seller B',     'seller',    s_b,  null, 'seller',    'activo'),
    (u_conductor_a,  t_a, 'Usuario Conductor A',  'conductor', null, d_a,  'conductor', 'activo'),
    (u_conductor_a2, t_a, 'Usuario Conductor A2', 'conductor', null, d_a2, 'conductor', 'activo'),
    (u_conductor_b,  t_b, 'Usuario Conductor B',  'conductor', null, d_b,  'conductor', 'activo')
  on conflict (id) do nothing;

  -- Manifiestos (uno por conductor)
  insert into operacion.manifiestos (id, tenant_id, driver_id, nombre, fecha_operacion, estado)
  values
    (manifiesto_a,  t_a, d_a,  'Ruta A 2026-06-08 AM', '2026-06-08', 'confirmado'),
    (manifiesto_a2, t_a, d_a2, 'Ruta A2 2026-06-08 AM','2026-06-08', 'borrador'),
    (manifiesto_b,  t_b, d_b,  'Ruta B 2026-06-08',    '2026-06-08', 'confirmado')
  on conflict (id) do nothing;

  -- Pedidos: pedido_a1 se asignará al conductor A; los demás sin conductor.
  -- driver_id_asignado se rellena después de insertar la asignación (trigger).
  insert into operacion.pedidos (id, tenant_id, seller_id, tipo_pedido, origen,
    ml_shipment_id, estado, destinatario_nombre, destinatario_direccion, destinatario_comuna)
  values
    (pedido_a1, t_a, s_a,  'flex',     'ml_ingesta', 'SHP-A-001', 'pendiente_asignacion',
     'Destinatario A1', 'Calle A 1', 'Santiago'),
    (pedido_a2, t_a, s_a,  'flex',     'ml_ingesta', 'SHP-A-002', 'pendiente_asignacion',
     'Destinatario A2', 'Calle A 2', 'Providencia'),
    (pedido_a3, t_a, s_a2, 'same_day', 'same_day_manual', null,    'pendiente_asignacion',
     'Destinatario A3', 'Calle A 3', 'Las Condes'),
    (pedido_b1, t_b, s_b,  'flex',     'ml_ingesta', 'SHP-B-001', 'pendiente_asignacion',
     'Destinatario B1', 'Calle B 1', 'Vitacura')
  on conflict (id) do nothing;

  -- Asignación activa: pedido_a1 → manifiesto_a (conductor A), seller A
  -- El trigger sincronizar_driver_id_asignado actualizará pedidos.driver_id_asignado.
  insert into operacion.asignaciones_pedido
    (id, tenant_id, pedido_id, manifiesto_id, driver_id, seller_id, activa)
  values
    (asignacion_a1, t_a, pedido_a1, manifiesto_a, d_a, s_a, true)
  on conflict (id) do nothing;

  -- Incidencia del pedido_a1 (seller A), tenant A
  insert into operacion.incidencias
    (id, tenant_id, pedido_id, seller_id, tipo, estado, descripcion)
  values
    (incidencia_a1, t_a, pedido_a1, s_a, 'destinatario_ausente', 'abierta', 'No había nadie')
  on conflict (id) do nothing;

  -- Evidencia de la incidencia anterior
  insert into operacion.evidencias_incidencia
    (id, tenant_id, incidencia_id, seller_id, tipo_archivo, storage_path, nombre_original)
  values
    (evidencia_a1, t_a, incidencia_a1, s_a, 'imagen',
     'aaaaaaaa-0000-0000-0000-000000000001/incidencias/aaaaaaaa-8888-0000-0000-000000000001/aaaaaaaa-9999-0000-0000-000000000001',
     'foto_puerta.jpg')
  on conflict (id) do nothing;
end $$;

-- =============================================================================
-- BLOQUE 1 · Aislamiento de TENANT (P1) en pedidos y manifiestos
-- =============================================================================

-- --- Interno del tenant A: ve solo su tenant ---------------------

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- u_interno_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

select is_empty(
  $$ select 1 from public.pedidos
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'P1 pedidos: interno del tenant A NO puede ver pedidos del tenant B'
);

select isnt_empty(
  $$ select 1 from public.pedidos
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'P1 pedidos: interno del tenant A SÍ ve sus propios pedidos'
);

select is_empty(
  $$ select 1 from public.manifiestos
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'P1 manifiestos: interno del tenant A NO puede ver manifiestos del tenant B'
);

-- --- Seller del tenant A: no puede ver pedidos del tenant B -----

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

select is_empty(
  $$ select 1 from public.pedidos
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'P1+P2 pedidos: seller del tenant A NO puede ver pedidos del tenant B'
);

-- --- Conductor del tenant A: no puede ver manifiestos del tenant B

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

select is_empty(
  $$ select 1 from public.manifiestos
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'P1+P3 manifiestos: conductor del tenant A NO puede ver manifiestos del tenant B'
);

-- =============================================================================
-- BLOQUE 2 · Aislamiento del SELLER (P2)
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

-- El seller A ve solo SUS pedidos (pedido_a1 y pedido_a2), no los de seller A2
select is_empty(
  $$ select 1 from public.pedidos
     where seller_id = 'aaaaaaaa-1111-0000-0000-000000000003' $$, -- s_a2
  'P2 pedidos: seller A NO ve los pedidos del seller A2 (mismo tenant)'
);

select results_eq(
  $$ select count(*)::int from public.pedidos $$,
  $$ values (2) $$,
  'P2 pedidos: seller A ve exactamente sus 2 pedidos (pedido_a1 y pedido_a2)'
);

-- El seller A ve sus incidencias, no las del seller A2
-- (pedido_a3 pertenece a s_a2 y no tiene incidencia, pero seller_id en incidencias
--  debe filtrarse igualmente)
select isnt_empty(
  $$ select 1 from public.incidencias
     where seller_id = 'aaaaaaaa-1111-0000-0000-000000000001' $$, -- s_a
  'P2 incidencias: seller A ve sus propias incidencias'
);

select is_empty(
  $$ select 1 from public.incidencias
     where seller_id = 'aaaaaaaa-1111-0000-0000-000000000003' $$, -- s_a2
  'P2 incidencias: seller A NO ve incidencias de otro seller del mismo tenant'
);

-- El seller A ve sus asignaciones (tiene la asignación del pedido_a1)
select results_eq(
  $$ select count(*)::int from public.asignaciones_pedido $$,
  $$ values (1) $$,
  'P2 asignaciones: seller A ve exactamente las asignaciones de sus pedidos (1 asignación activa)'
);

-- El seller NO ve manifiestos (tabla interna del courier)
select is_empty(
  $$ select 1 from public.manifiestos $$,
  'P2 manifiestos: seller A NO ve manifiestos (tabla interna del courier, sin P2)'
);

-- =============================================================================
-- BLOQUE 3 · Aislamiento del CONDUCTOR (P3)
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a (driver_id = d_a)
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

-- El conductor A solo ve SU manifiesto, no el del conductor A2
select results_eq(
  $$ select count(*)::int from public.manifiestos $$,
  $$ values (1) $$,
  'P3 manifiestos: conductor A ve exactamente su manifiesto (no el de conductor A2)'
);

select is_empty(
  $$ select 1 from public.manifiestos
     where driver_id = 'aaaaaaaa-2222-0000-0000-000000000003' $$, -- d_a2
  'P3 manifiestos: conductor A NO ve el manifiesto del conductor A2 (mismo tenant)'
);

-- El conductor A solo ve pedidos donde driver_id_asignado = d_a (pedido_a1)
-- pedido_a2 es del mismo seller pero sin conductor asignado → no visible
-- pedido_a3 es de otro seller → no visible
select results_eq(
  $$ select count(*)::int from public.pedidos $$,
  $$ values (1) $$,
  'P3 pedidos: conductor A ve exactamente los pedidos asignados a él (1 pedido: pedido_a1)'
);

select isnt_empty(
  $$ select 1 from public.pedidos
     where id = 'aaaaaaaa-6666-0000-0000-000000000001' $$, -- pedido_a1
  'P3 pedidos: conductor A SÍ ve el pedido asignado a él (pedido_a1)'
);

-- Conductor A NO ve pedidos asignados al conductor A2 (que tiene 0 en este fixture,
-- pero la política debe filtrar por driver_id_asignado = claim)
-- Verificamos con el conductor A2 directamente
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000007'::uuid, -- u_conductor_a2
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000003'::uuid -- d_a2
);

select is_empty(
  $$ select 1 from public.pedidos
     where driver_id_asignado = 'aaaaaaaa-2222-0000-0000-000000000001' $$, -- d_a
  'P3 pedidos: conductor A2 NO ve pedidos del conductor A (mismo tenant, otro conductor)'
);

-- =============================================================================
-- BLOQUE 4 · Escritura — UPDATE silencioso vs 42501 explícito
-- =============================================================================

-- Seller que intenta UPDATE sobre sus propios pedidos (puede verlos): 42501
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

-- Precondición: el seller puede VER el pedido
select isnt_empty(
  $$ select 1 from public.pedidos where id = 'aaaaaaaa-6666-0000-0000-000000000001' $$,
  'control: seller A puede ver pedido_a1 (precondición para el caso UPDATE silencioso)'
);

-- Pero no puede editarlo (guard trg_pedidos_solo_interno_edita lanza 42501)
select throws_ok(
  $$ update public.pedidos set notas_internas = 'HACKED'
     where id = 'aaaaaaaa-6666-0000-0000-000000000001' $$,
  '42501',
  null,
  'GUARD pedidos: seller que intenta UPDATE sobre pedido visible recibe 42501 explícito (no "UPDATE 0" silencioso)'
);

-- Seller que intenta UPDATE sobre incidencias (puede verlas): 42501
select isnt_empty(
  $$ select 1 from public.incidencias where id = 'aaaaaaaa-8888-0000-0000-000000000001' $$,
  'control: seller A puede ver incidencia_a1 (precondición)'
);

select throws_ok(
  $$ update public.incidencias set descripcion = 'HACKED'
     where id = 'aaaaaaaa-8888-0000-0000-000000000001' $$,
  '42501',
  null,
  'GUARD incidencias: seller que intenta UPDATE sobre incidencia visible recibe 42501 explícito'
);

-- Conductor que intenta UPDATE sobre su manifiesto (puede verlo): 42501
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

select isnt_empty(
  $$ select 1 from public.manifiestos where id = 'aaaaaaaa-5555-0000-0000-000000000001' $$,
  'control: conductor A puede ver manifiesto_a (precondición)'
);

select throws_ok(
  $$ update public.manifiestos set notas = 'HACKED'
     where id = 'aaaaaaaa-5555-0000-0000-000000000001' $$,
  '42501',
  null,
  'GUARD manifiestos: conductor que intenta UPDATE sobre manifiesto visible recibe 42501 explícito'
);

-- =============================================================================
-- BLOQUE 5 · intentos_backfill invisible para authenticated
-- =============================================================================

-- Volvemos al interno del tenant A (autenticado pero no service_role)
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- u_interno_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

-- intentos_backfill no tiene vista en public ni privilegios para authenticated.
-- El acceso directo al esquema lanza 42501 (sin USAGE en operacion para este
-- objeto específico, o sin política de RLS que lo habilite).
-- En Supabase, `grant usage on schema operacion to authenticated` se otorga en
-- §14, pero `revoke all on operacion.intentos_backfill from authenticated` lo
-- anula explícitamente para esta tabla.
select throws_ok(
  $$ select 1 from operacion.intentos_backfill $$,
  '42501',
  null,
  'intentos_backfill: usuario interno autenticado NO puede SELECT (tabla invisible para authenticated)'
);

-- El seller tampoco puede acceder
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

select throws_ok(
  $$ select 1 from operacion.intentos_backfill $$,
  '42501',
  null,
  'intentos_backfill: seller NO puede SELECT (sin vista en public ni privilegios de tabla)'
);

-- =============================================================================
-- BLOQUE 6 · Trigger de consistencia en asignaciones_pedido
-- =============================================================================

-- Volvemos a postgres para insertar datos de prueba (los triggers validan como
-- postgres también, pero el guard de RLS se omite porque postgres bypassa RLS).
select test_cerrar_sesion();

-- Caso 1: driver_id distinto al manifiestos.driver_id → lanza 23514
-- Intentamos asignar pedido_a2 al manifiesto_a (conductor A) pero con driver_id
-- del conductor A2 (incorrecto).
select throws_ok(
  $$ insert into operacion.asignaciones_pedido
       (tenant_id, pedido_id, manifiesto_id, driver_id, seller_id, activa)
     values (
       'aaaaaaaa-0000-0000-0000-000000000001',  -- t_a
       'aaaaaaaa-6666-0000-0000-000000000002',  -- pedido_a2 (seller_id = s_a)
       'aaaaaaaa-5555-0000-0000-000000000001',  -- manifiesto_a (driver_id = d_a)
       'aaaaaaaa-2222-0000-0000-000000000003',  -- d_a2 (INCORRECTO — debería ser d_a)
       'aaaaaaaa-1111-0000-0000-000000000001',  -- s_a (correcto)
       true
     ) $$,
  '23514',
  null,
  'TRIGGER consistencia: driver_id distinto al manifiestos.driver_id lanza 23514 (check_violation)'
);

-- Caso 2: seller_id distinto al pedidos.seller_id → lanza 23514
-- Intentamos asignar pedido_a2 (seller_id = s_a) pero con seller_id = s_a2 (incorrecto).
select throws_ok(
  $$ insert into operacion.asignaciones_pedido
       (tenant_id, pedido_id, manifiesto_id, driver_id, seller_id, activa)
     values (
       'aaaaaaaa-0000-0000-0000-000000000001',  -- t_a
       'aaaaaaaa-6666-0000-0000-000000000002',  -- pedido_a2 (seller_id = s_a)
       'aaaaaaaa-5555-0000-0000-000000000001',  -- manifiesto_a (driver_id = d_a)
       'aaaaaaaa-2222-0000-0000-000000000001',  -- d_a (correcto)
       'aaaaaaaa-1111-0000-0000-000000000003',  -- s_a2 (INCORRECTO — debería ser s_a)
       true
     ) $$,
  '23514',
  null,
  'TRIGGER consistencia: seller_id distinto al pedidos.seller_id lanza 23514 (check_violation)'
);

-- =============================================================================
-- BLOQUE 7 · Trigger sincronizar_driver_id_asignado
-- =============================================================================

-- Verificar que pedido_a1 tiene driver_id_asignado = d_a (ya asignado en fixtures)
select results_eq(
  $$ select driver_id_asignado::text from operacion.pedidos
     where id = 'aaaaaaaa-6666-0000-0000-000000000001' $$,
  $$ values ('aaaaaaaa-2222-0000-0000-000000000001') $$,
  'TRIGGER sync driver_id: al crear asignación activa, pedidos.driver_id_asignado se actualiza con el conductor'
);

-- Desactivar la asignación y verificar que driver_id_asignado vuelve a NULL
update operacion.asignaciones_pedido
set activa = false, desasignado_en = now()
where id = 'aaaaaaaa-7777-0000-0000-000000000001';

select is(
  (select driver_id_asignado from operacion.pedidos
   where id = 'aaaaaaaa-6666-0000-0000-000000000001'),
  null,
  'TRIGGER sync driver_id: al desactivar la asignación, pedidos.driver_id_asignado vuelve a NULL'
);

-- =============================================================================
-- BLOQUE 8 · Control positivo: confirmar que los datos de fixture existen
--            (el aislamiento es RLS filtrando, no tablas vacías)
-- =============================================================================

select results_eq(
  $$ select count(*)::int from operacion.pedidos where tenant_id in ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002') $$,
  $$ values (4) $$,
  'control positivo: como postgres existen los 4 pedidos de fixture'
);

select results_eq(
  $$ select count(*)::int from operacion.manifiestos where tenant_id in ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002') $$,
  $$ values (3) $$,
  'control positivo: como postgres existen los 3 manifiestos de fixture'
);

-- =============================================================================
-- BLOQUE 9 · INSERT isolation — sellers y conductores no pueden insertar
-- =============================================================================

-- El trigger solo_interno_edita() protege INSERT también (lanza 42501).
-- Aquí verificamos que el guard cubre INSERT, no solo UPDATE.

-- Seller que intenta INSERT en pedidos: 42501
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

select throws_ok(
  $$ insert into public.pedidos
       (tenant_id, seller_id, tipo_pedido, origen, estado,
        destinatario_nombre, destinatario_direccion, destinatario_comuna)
     values (
       'aaaaaaaa-0000-0000-0000-000000000001',
       'aaaaaaaa-1111-0000-0000-000000000001',
       'same_day', 'same_day_manual', 'pendiente_asignacion',
       'Destinatario Falso', 'Calle Falsa 999', 'Santiago'
     ) $$,
  '42501',
  null,
  'GUARD INSERT pedidos: seller que intenta INSERT recibe 42501 explícito (no puede crear pedidos directamente)'
);

-- Conductor que intenta INSERT en manifiestos: 42501
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

select throws_ok(
  $$ insert into public.manifiestos
       (tenant_id, driver_id, nombre, fecha_operacion, estado)
     values (
       'aaaaaaaa-0000-0000-0000-000000000001',
       'aaaaaaaa-2222-0000-0000-000000000001',
       'Manifiesto Falso', '2026-06-08', 'borrador'
     ) $$,
  '42501',
  null,
  'GUARD INSERT manifiestos: conductor que intenta INSERT recibe 42501 explícito'
);

-- =============================================================================
-- BLOQUE 10 · Conductor A2 no ve pedido asignado a Conductor A (P3 explícito)
-- =============================================================================

-- Reasignar pedido_a1 a Conductor A para tener un pedido asignado explícito.
-- (pedido_a1 ya tiene driver_id_asignado = d_a después del BLOQUE 7 que lo desactivó;
--  re-insertamos la asignación como postgres para esta verificación).

select test_cerrar_sesion();

-- Asignación temporal: pedido_a2 → manifiesto_a2 (conductor A2) para dar a A2 algo.
-- (no necesitamos insertar — solo verificar que conductor A2 no puede ver
--  pedidos del conductor A). El fixture ya tiene pedido_a1 sin driver_id_asignado
--  (lo desactivamos en BLOQUE 7). Reactivamos para este bloque:
update operacion.asignaciones_pedido
set activa = true, desasignado_en = null
where id = 'aaaaaaaa-7777-0000-0000-000000000001';

-- Ahora pedido_a1.driver_id_asignado = d_a (trigger re-sincronizó al activar).
-- Conductor A2 NO debe ver ese pedido.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000007'::uuid, -- u_conductor_a2
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000003'::uuid -- d_a2
);

select is_empty(
  $$ select 1 from public.pedidos
     where driver_id_asignado = 'aaaaaaaa-2222-0000-0000-000000000001' $$, -- d_a
  'P3 explícito: conductor A2 NO ve pedido asignado al conductor A (mismo tenant, diferente driver_id_asignado)'
);

-- =============================================================================
-- BLOQUE 11 · Seller ve solo sus incidencias (conteo preciso), no de otro seller
-- =============================================================================

-- Verificar que el COUNT de incidencias es exactamente 1 (la de su pedido)
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

select results_eq(
  $$ select count(*)::int from public.incidencias $$,
  $$ values (1) $$,
  'P2 incidencias: seller A ve exactamente 1 incidencia (la propia) — no incidencias de otros sellers'
);

-- Seller A2 (que no tiene incidencias) ve 0
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000004'::uuid, -- u_seller_a2
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000003'::uuid -- s_a2
);

select results_eq(
  $$ select count(*)::int from public.incidencias $$,
  $$ values (0) $$,
  'P2 incidencias: seller A2 ve 0 incidencias (no tiene ninguna propia, y no ve las del seller A)'
);

-- =============================================================================
-- BLOQUE 12 · evidencias_incidencia — seller solo ve sus evidencias
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

select results_eq(
  $$ select count(*)::int from public.evidencias_incidencia $$,
  $$ values (1) $$,
  'P2 evidencias: seller A ve exactamente su evidencia (no la de otro seller)'
);

-- Seller A2 no ve evidencias ajenas
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000004'::uuid, -- u_seller_a2
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000003'::uuid -- s_a2
);

select is_empty(
  $$ select 1 from public.evidencias_incidencia $$,
  'P2 evidencias: seller A2 NO ve evidencias del seller A (mismo tenant, diferente seller_id)'
);

select * from finish();

rollback;
