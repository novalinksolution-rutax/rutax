-- =============================================================================
-- Pruebas de aislamiento RLS — definición de hecho de la skill multitenant-rls
-- =============================================================================
-- Demuestra, contra una base Postgres real (no mocks de aplicación):
--   1. Un usuario del tenant A NO puede leer filas del tenant B.
--   2. Un seller NO ve datos de otro seller ni internos del courier
--      (tarifas, courier_config_dte, folios_caf, secretos_cifrados, bitácora).
--   3. Un conductor solo ve lo suyo (su propia fila en `conductores`,
--      nada de otro conductor ni del tenant ajeno).
--   4. `secretos_cifrados` es estructuralmente inalcanzable para cualquier
--      rol de cliente (authenticated), incluidos los internos — solo service_role.
--
-- Mecanismo: simulamos el JWT que el custom access token hook produciría,
-- fijando `request.jwt.claims` (la misma fuente que lee auth.jwt()/auth.uid()
-- en producción) y CONMUTANDO el rol de ejecución a `authenticated` (la tabla
-- tiene FORCE ROW LEVEL SECURITY, pero eso no alcanza a un superusuario/rol con
-- rolbypassrls=true como `postgres` — bajo el cual corre pgTAP por defecto).
-- Las consultas van contra las vistas en `public` (igual que la API de datos
-- real vía PostgREST), excepto `secretos_cifrados`, que deliberadamente NO
-- tiene vista pública — ahí se prueba el acceso directo al esquema `identidad`
-- y se espera un error de permiso por falta de USAGE sobre el esquema.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(57);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada
-- -----------------------------------------------------------------------------
-- IMPORTANTE: pgTAP corre como `postgres` (rolbypassrls = true): FORCE ROW
-- LEVEL SECURITY no lo afecta y vería todas las filas sin que ninguna política
-- aplique — un falso "pasa". Para probar RLS de verdad hay que CONMUTAR el rol
-- de ejecución a `authenticated` (rolbypassrls = false, igual que en
-- producción vía PostgREST) Y fijar los claims que el hook inyectaría.
-- `set local role` requiere PL/pgSQL (no `language sql`) y es transaccional:
-- se revierte con `reset role` o con el rollback final de la prueba.
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

-- Vuelve a `postgres` (bypass RLS) y limpia los claims — usado en el bloque
-- de control positivo (confirmar que las tablas SÍ tienen datos de fixture).
create or replace function test_cerrar_sesion() returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
end;
$$;

-- -----------------------------------------------------------------------------
-- Fixtures: dos tenants (A y B), cada uno con usuario interno, dos sellers
-- (con su usuario-seller respectivo), dos conductores (con su usuario-
-- conductor respectivo), conexión ML, tarifas, config DTE, folio CAF,
-- secreto cifrado y una entrada de bitácora.
--
-- Se insertan como `postgres` (bypassa RLS) para tener control total del
-- escenario — igual que lo haría una función service_role de aprovisionamiento
-- (alta de tenant, aceptación de invitación, etc., que vendrán de `backend`).
-- -----------------------------------------------------------------------------
do $$
declare
  -- Tenants
  t_a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';

  -- Sellers (dos del tenant A, para probar aislamiento seller-vs-seller
  -- DENTRO del mismo tenant — el caso más fácil de pasar por alto)
  s_a  uuid := 'aaaaaaaa-1111-0000-0000-000000000001';
  s_a2 uuid := 'aaaaaaaa-1111-0000-0000-000000000003';
  s_b  uuid := 'bbbbbbbb-1111-0000-0000-000000000002';

  -- Conductores (idem: dos del tenant A)
  d_a  uuid := 'aaaaaaaa-2222-0000-0000-000000000001';
  d_a2 uuid := 'aaaaaaaa-2222-0000-0000-000000000003';
  d_b  uuid := 'bbbbbbbb-2222-0000-0000-000000000002';

  -- Usuarios (auth.users + usuarios_perfil)
  u_interno_a    uuid := 'aaaaaaaa-3333-0000-0000-000000000001';
  u_interno_b    uuid := 'bbbbbbbb-3333-0000-0000-000000000002';
  u_seller_a     uuid := 'aaaaaaaa-3333-0000-0000-000000000003';
  u_seller_a2    uuid := 'aaaaaaaa-3333-0000-0000-000000000004';
  u_seller_b     uuid := 'bbbbbbbb-3333-0000-0000-000000000005';
  u_conductor_a  uuid := 'aaaaaaaa-3333-0000-0000-000000000006';
  u_conductor_a2 uuid := 'aaaaaaaa-3333-0000-0000-000000000007';
  u_conductor_b  uuid := 'bbbbbbbb-3333-0000-0000-000000000008';
begin
  -- Tenants
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier A', 'Courier A SpA', '76123456-7', 'activo'),
    (t_b, 'Courier B', 'Courier B SpA', '76987654-3', 'activo')
  on conflict (id) do nothing;

  -- auth.users (mínimo necesario para las FKs de usuarios_perfil/bitácora)
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_interno_a,    'interno.a@courier-a.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_interno_b,    'interno.b@courier-b.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,     'seller.a@courier-a.test',     crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a2,    'seller.a2@courier-a.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_b,     'seller.b@courier-b.test',     crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a,  'conductor.a@courier-a.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a2, 'conductor.a2@courier-a.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_b,  'conductor.b@courier-b.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
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
    (d_a,  t_a, 'Conductor Uno A', '78111111-1', 'dependiente',   'activo'),
    (d_a2, t_a, 'Conductor Dos A', '78222222-2', 'independiente', 'activo'),
    (d_b,  t_b, 'Conductor Uno B', '78333333-3', 'dependiente',   'activo')
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

  -- conexiones_seller_ml (1:1 con seller, tenant_id denormalizado)
  insert into identidad.conexiones_seller_ml (tenant_id, seller_id, ml_user_id, estado_salud)
  values
    (t_a, s_a,  'ML-A-1', 'sana'),
    (t_a, s_a2, 'ML-A-2', 'pendiente'),
    (t_b, s_b,  'ML-B-1', 'sana')
  on conflict (seller_id) do nothing;

  -- tarifas (interna — el seller jamás debe verlas, ni la suya propia)
  insert into identidad.tarifas (tenant_id, seller_id, tipo_entrega, modo_calculo, monto_clp, vigente_desde, estado)
  values
    (t_a, null, 'flex', 'monto_fijo', 1500, '2026-01-01', 'activa'),
    (t_a, s_a,  'flex', 'monto_fijo', 1800, '2026-01-01', 'activa'),
    (t_b, null, 'flex', 'monto_fijo', 1600, '2026-01-01', 'activa')
  on conflict do nothing;

  -- courier_config_dte (interna)
  insert into identidad.courier_config_dte (tenant_id, proveedor_dte, estado_certificacion)
  values
    (t_a, 'simplefactura', 'activo'),
    (t_b, 'simplefactura', 'pendiente')
  on conflict (tenant_id) do nothing;

  -- folios_caf (interna)
  insert into identidad.folios_caf (tenant_id, tipo_documento, folio_desde, folio_hasta, folio_actual, estado)
  values
    (t_a, 33, 1, 100, 1, 'vigente'),
    (t_b, 33, 1, 100, 1, 'vigente')
  on conflict do nothing;

  -- secretos_cifrados (la más restrictiva — ni siquiera roles internos)
  insert into identidad.secretos_cifrados (tenant_id, tipo_secreto, valor_cifrado, metadata)
  values
    (t_a, 'certificado_digital_courier', '\x00010203'::bytea, '{"alg":"aes-256-gcm"}'::jsonb),
    (t_b, 'certificado_digital_courier', '\x04050607'::bytea, '{"alg":"aes-256-gcm"}'::jsonb)
  on conflict do nothing;

  -- bitacora_auditoria (interna — visible solo a internos de su propio tenant)
  insert into identidad.bitacora_auditoria (tenant_id, actor_usuario_id, actor_tipo, accion, entidad_tipo, entidad_id, detalle)
  values
    (t_a, u_interno_a, 'usuario', 'tarifa.creada', 'tarifa', s_a, '{"monto_clp": 1800}'::jsonb),
    (t_b, u_interno_b, 'usuario', 'tarifa.creada', 'tarifa', s_b, '{"monto_clp": 1600}'::jsonb)
  on conflict do nothing;
end $$;

-- =============================================================================
-- BLOQUE 1 · Aislamiento por TENANT (P1)
-- usuarios_perfil, sellers, conductores, conexiones_seller_ml,
-- courier_config_dte, folios_caf, tarifas, bitacora_auditoria, tenants
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- u_interno_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

select set_eq(
  $$ select tenant_id::text from public.usuarios_perfil $$,
  $$ values ('aaaaaaaa-0000-0000-0000-000000000001') $$,
  'usuarios_perfil: interno del tenant A solo ve filas con tenant_id = A (ninguna de B)'
);

select isnt_empty(
  $$ select 1 from public.usuarios_perfil where id = 'aaaaaaaa-3333-0000-0000-000000000001' $$,
  'usuarios_perfil: interno del tenant A se ve a sí mismo'
);

select is_empty(
  $$ select 1 from public.usuarios_perfil where id = 'bbbbbbbb-3333-0000-0000-000000000002' $$,
  'usuarios_perfil: interno del tenant A NO ve al interno del tenant B'
);

select set_eq(
  $$ select tenant_id::text from public.sellers $$,
  $$ values ('aaaaaaaa-0000-0000-0000-000000000001'), ('aaaaaaaa-0000-0000-0000-000000000001') $$,
  'sellers: interno del tenant A solo ve sellers de su tenant (2 filas, ambas tenant A)'
);

select is_empty(
  $$ select 1 from public.sellers where id = 'bbbbbbbb-1111-0000-0000-000000000002' $$,
  'sellers: interno del tenant A NO puede leer el seller del tenant B'
);

select set_eq(
  $$ select tenant_id::text from public.conductores $$,
  $$ values ('aaaaaaaa-0000-0000-0000-000000000001'), ('aaaaaaaa-0000-0000-0000-000000000001') $$,
  'conductores: interno del tenant A solo ve conductores de su tenant'
);

select is_empty(
  $$ select 1 from public.conductores where id = 'bbbbbbbb-2222-0000-0000-000000000002' $$,
  'conductores: interno del tenant A NO puede leer el conductor del tenant B'
);

select is_empty(
  $$ select 1 from public.conexiones_seller_ml where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'conexiones_seller_ml: interno del tenant A NO ve conexiones del tenant B'
);

select is_empty(
  $$ select 1 from public.courier_config_dte where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'courier_config_dte: interno del tenant A NO ve la config DTE del tenant B'
);

select isnt_empty(
  $$ select 1 from public.courier_config_dte where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'courier_config_dte: interno del tenant A SÍ ve su propia config DTE'
);

select is_empty(
  $$ select 1 from public.folios_caf where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'folios_caf: interno del tenant A NO ve folios CAF del tenant B'
);

select is_empty(
  $$ select 1 from public.tarifas where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'tarifas: interno del tenant A NO ve tarifas del tenant B'
);

select results_eq(
  $$ select count(*)::int from public.tarifas $$,
  $$ values (2) $$,
  'tarifas: interno del tenant A ve exactamente sus 2 tarifas (default + override del seller A)'
);

select is_empty(
  $$ select 1 from public.bitacora_auditoria where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'bitacora_auditoria: interno del tenant A NO ve entradas del tenant B'
);

select isnt_empty(
  $$ select 1 from public.bitacora_auditoria where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'bitacora_auditoria: interno del tenant A ve sus propias entradas'
);

select throws_ok(
  $$ insert into public.bitacora_auditoria (tenant_id, actor_tipo, accion, entidad_tipo, detalle)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'usuario', 'hack.intento', 'test', '{}'::jsonb) $$,
  '42501',
  null,
  'bitacora_auditoria: un interno autenticado NO puede insertar directo (append-only — solo service_role)'
);

select throws_ok(
  $$ update public.bitacora_auditoria set detalle = '{}'::jsonb where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'bitacora_auditoria: nadie autenticado puede hacer UPDATE (append-only real, ni para dueño)'
);

-- --- Simetría: ahora el interno del tenant B ---------------------------------
select test_iniciar_sesion(
  'bbbbbbbb-3333-0000-0000-000000000002'::uuid, -- u_interno_b
  'bbbbbbbb-0000-0000-0000-000000000002'::uuid, -- t_b
  'interno', 'dueno'
);

select is_empty(
  $$ select 1 from public.sellers where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'sellers: interno del tenant B NO ve sellers del tenant A (simétrico)'
);

select is_empty(
  $$ select 1 from public.usuarios_perfil where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'usuarios_perfil: interno del tenant B NO ve perfiles del tenant A (simétrico)'
);

select is_empty(
  $$ select 1 from public.tarifas where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'tarifas: interno del tenant B NO ve tarifas del tenant A (simétrico)'
);

select is_empty(
  $$ select 1 from public.tenants where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'tenants: usuario del tenant B no puede leer la fila del tenant A (ni listarla, ni por id)'
);

select results_eq(
  $$ select id::text from public.tenants $$,
  $$ values ('bbbbbbbb-0000-0000-0000-000000000002') $$,
  'tenants: usuario del tenant B solo ve su propia fila en tenants'
);

-- =============================================================================
-- BLOQUE 2 · Aislamiento del SELLER (P2)
-- El seller solo ve SUS propias filas; nunca otro seller ni datos internos.
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a (seller_id = s_a)
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

select results_eq(
  $$ select id::text from public.sellers $$,
  $$ values ('aaaaaaaa-1111-0000-0000-000000000001') $$,
  'sellers: el usuario-seller A ve EXCLUSIVAMENTE su propia fila (ni siquiera otro seller del mismo tenant)'
);

select is_empty(
  $$ select 1 from public.sellers where id = 'aaaaaaaa-1111-0000-0000-000000000003' $$,
  'sellers: el seller A NO ve al seller A2 (mismo tenant, otro seller)'
);

select is_empty(
  $$ select 1 from public.sellers where id = 'bbbbbbbb-1111-0000-0000-000000000002' $$,
  'sellers: el seller A NO ve al seller del tenant B'
);

select results_eq(
  $$ select seller_id::text from public.conexiones_seller_ml $$,
  $$ values ('aaaaaaaa-1111-0000-0000-000000000001') $$,
  'conexiones_seller_ml: el seller A ve únicamente su propia conexión ML'
);

select is_empty(
  $$ select 1 from public.conexiones_seller_ml where seller_id = 'aaaaaaaa-1111-0000-0000-000000000003' $$,
  'conexiones_seller_ml: el seller A NO ve la conexión del seller A2 (mismo tenant)'
);

select results_eq(
  $$ select id::text from public.usuarios_perfil $$,
  $$ values ('aaaaaaaa-3333-0000-0000-000000000003') $$,
  'usuarios_perfil: el usuario-seller solo ve su propia fila de perfil (no la de otros, ni internos)'
);

-- --- Datos internos del courier: el seller NO debe verlos jamás --------------
select is_empty(
  $$ select 1 from public.tarifas $$,
  'tarifas: el seller NO ve absolutamente ninguna tarifa (ni la suya — son montos pactados internos, §8.2)'
);

select is_empty(
  $$ select 1 from public.courier_config_dte $$,
  'courier_config_dte: el seller NO ve la configuración DTE del courier'
);

select is_empty(
  $$ select 1 from public.folios_caf $$,
  'folios_caf: el seller NO ve folios CAF (dato interno/tributario)'
);

select is_empty(
  $$ select 1 from public.bitacora_auditoria $$,
  'bitacora_auditoria: el seller NO ve ninguna entrada de la bitácora del courier'
);

select is_empty(
  $$ select 1 from public.conductores $$,
  'conductores: el seller NO ve la nómina de conductores del courier (dato interno)'
);

select is_empty(
  $$ select 1 from public.invitaciones $$,
  'invitaciones: el seller NO ve invitaciones del courier'
);

-- --- Escritura: el seller no puede crear/editar sellers ni conexiones --------
select throws_ok(
  $$ insert into public.sellers (tenant_id, razon_social, rut, estado)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'Seller Pirata', '79999999-9', 'activo') $$,
  '42501',
  null,
  'sellers: el seller NO puede insertar nuevas filas de seller (solo roles internos)'
);

select throws_ok(
  $$ update public.conexiones_seller_ml
     set estado_salud = 'sana', ml_user_id = 'FALSIFICADO'
     where seller_id = 'aaaaaaaa-1111-0000-0000-000000000001' $$,
  '42501',
  null,
  'conexiones_seller_ml: el seller NO puede editar directamente su fila (tokens/salud son de jobs/service_role)'
);

-- --- Seller A2 (mismo tenant, otra cuenta): mismo aislamiento ----------------
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000004'::uuid, -- u_seller_a2
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000003'::uuid -- s_a2
);

select results_eq(
  $$ select id::text from public.sellers $$,
  $$ values ('aaaaaaaa-1111-0000-0000-000000000003') $$,
  'sellers: el seller A2 ve únicamente su propia fila (no la del seller A, mismo tenant)'
);

select is_empty(
  $$ select 1 from public.conexiones_seller_ml where seller_id = 'aaaaaaaa-1111-0000-0000-000000000001' $$,
  'conexiones_seller_ml: el seller A2 NO ve la conexión del seller A (mismo tenant)'
);

-- --- Seller del tenant B: aislamiento cruzado de tenant + de seller ----------
select test_iniciar_sesion(
  'bbbbbbbb-3333-0000-0000-000000000005'::uuid, -- u_seller_b
  'bbbbbbbb-0000-0000-0000-000000000002'::uuid, -- t_b
  'seller', 'seller',
  p_seller_id => 'bbbbbbbb-1111-0000-0000-000000000002'::uuid -- s_b
);

select results_eq(
  $$ select id::text from public.sellers $$,
  $$ values ('bbbbbbbb-1111-0000-0000-000000000002') $$,
  'sellers: el seller del tenant B ve únicamente su propia fila'
);

select is_empty(
  $$ select 1 from public.sellers where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'sellers: el seller del tenant B no ve absolutamente nada del tenant A'
);

-- =============================================================================
-- BLOQUE 3 · Aislamiento del CONDUCTOR (P3)
-- El conductor solo ve su propia fila en `conductores`.
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a (driver_id = d_a)
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

select results_eq(
  $$ select id::text from public.conductores $$,
  $$ values ('aaaaaaaa-2222-0000-0000-000000000001') $$,
  'conductores: el conductor A ve EXCLUSIVAMENTE su propia fila (ni siquiera otro conductor del mismo tenant)'
);

select is_empty(
  $$ select 1 from public.conductores where id = 'aaaaaaaa-2222-0000-0000-000000000003' $$,
  'conductores: el conductor A NO ve al conductor A2 (mismo tenant, otra persona)'
);

select is_empty(
  $$ select 1 from public.conductores where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'conductores: el conductor A NO ve conductores del tenant B'
);

select results_eq(
  $$ select id::text from public.usuarios_perfil $$,
  $$ values ('aaaaaaaa-3333-0000-0000-000000000006') $$,
  'usuarios_perfil: el usuario-conductor solo ve su propia fila de perfil'
);

-- Datos internos / de otros alcances: el conductor no debe ver nada de eso.
select is_empty(
  $$ select 1 from public.sellers $$,
  'sellers: el conductor NO ve la cartera de sellers del courier'
);

select is_empty(
  $$ select 1 from public.tarifas $$,
  'tarifas: el conductor NO ve tarifas (interno/financiero)'
);

select is_empty(
  $$ select 1 from public.bitacora_auditoria $$,
  'bitacora_auditoria: el conductor NO ve la bitácora del courier'
);

select is_empty(
  $$ select 1 from public.conexiones_seller_ml $$,
  'conexiones_seller_ml: el conductor NO ve conexiones ML de sellers'
);

select throws_ok(
  $$ update public.conductores set estado = 'inactivo'
     where id = 'aaaaaaaa-2222-0000-0000-000000000001' $$,
  '42501',
  null,
  'conductores: el propio conductor NO puede editar su ficha (gestión es de roles internos)'
);

-- --- Conductor A2 (mismo tenant): ve solo lo suyo, no lo de A ----------------
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000007'::uuid, -- u_conductor_a2
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000003'::uuid -- d_a2
);

select results_eq(
  $$ select id::text from public.conductores $$,
  $$ values ('aaaaaaaa-2222-0000-0000-000000000003') $$,
  'conductores: el conductor A2 ve únicamente su propia fila (no la del conductor A)'
);

-- --- Conductor del tenant B: aislamiento cruzado -----------------------------
select test_iniciar_sesion(
  'bbbbbbbb-3333-0000-0000-000000000008'::uuid, -- u_conductor_b
  'bbbbbbbb-0000-0000-0000-000000000002'::uuid, -- t_b
  'conductor', 'conductor',
  p_driver_id => 'bbbbbbbb-2222-0000-0000-000000000002'::uuid -- d_b
);

select results_eq(
  $$ select id::text from public.conductores $$,
  $$ values ('bbbbbbbb-2222-0000-0000-000000000002') $$,
  'conductores: el conductor del tenant B ve únicamente su propia fila'
);

select is_empty(
  $$ select 1 from public.conductores where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'conductores: el conductor del tenant B no ve nada de los conductores del tenant A'
);

-- =============================================================================
-- BLOQUE 4 · secretos_cifrados — estructuralmente inalcanzable para
-- CUALQUIER rol de cliente, incluidos los internos (§5.1 / §8.2)
-- =============================================================================
-- No tiene vista en `public` (decisión deliberada: ni siquiera se expone como
-- vista normal) y `authenticated` carece de USAGE sobre el esquema `identidad`
-- (revoke explícito + sin grant). El resultado es un error de permiso a nivel
-- de esquema — más fuerte que "0 filas": para cualquier cliente, incluido el
-- dueño/interno del propio tenant, la tabla NO EXISTE. Solo service_role.

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- u_interno_a (¡el dueño!)
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'interno', 'dueno'
);

select throws_ok(
  $$ select 1 from identidad.secretos_cifrados $$,
  '42501',
  null,
  'secretos_cifrados: NI SIQUIERA el dueño/interno del tenant A puede alcanzar la tabla de secretos (sin USAGE sobre el esquema identidad — solo service_role)'
);

select throws_ok(
  $$ insert into identidad.secretos_cifrados (tenant_id, tipo_secreto, valor_cifrado)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'token_oauth_ml_access', '\x00'::bytea) $$,
  '42501',
  null,
  'secretos_cifrados: ningún rol authenticated puede insertar secretos (sin USAGE sobre el esquema — exclusivo service_role/integraciones)'
);

-- =============================================================================
-- BLOQUE 5 · Control positivo: confirma que el aislamiento visto arriba es
-- RLS filtrando filas reales — no tablas vacías ni fixtures mal cargados.
-- Vuelve a `postgres` (bypass RLS) para verificar que los datos existen.
-- =============================================================================

select test_cerrar_sesion();

select isnt_empty(
  $$ select 1 from identidad.secretos_cifrados $$,
  'control positivo: como postgres (bypass RLS) la tabla secretos_cifrados SÍ tiene filas — la inalcanzabilidad anterior es por permisos/RLS, no por datos vacíos'
);

select results_eq(
  $$ select count(*)::int from identidad.tarifas $$,
  $$ values (3) $$,
  'control positivo: como postgres existen las 3 tarifas de fixture (2 del tenant A + 1 del tenant B)'
);

select results_eq(
  $$ select count(*)::int from identidad.sellers $$,
  $$ values (3) $$,
  'control positivo: como postgres existen los 3 sellers de fixture — confirma que lo visto antes es RLS filtrando, no ausencia de datos'
);

select * from finish();

rollback;
