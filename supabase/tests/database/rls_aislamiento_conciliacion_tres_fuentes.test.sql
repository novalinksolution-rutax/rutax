-- =============================================================================
-- Pruebas de aislamiento RLS — F17 conciliación de 3 fuentes (Bloque 3)
-- =============================================================================
-- Demuestra, contra una base Postgres real (no mocks de aplicación), que tras
-- ampliar dinero.eventos_conciliacion con los nuevos tipos de diferencia y las
-- columnas driver_id / liquidacion_id:
--
--   1. Los eventos con los NUEVOS tipos (pagado_conductor_sin_cobro_seller,
--      cobrado_seller_no_pagado_conductor, reprogramacion_no_cobrada,
--      minimo_omitido, pago_seller_faltante, pago_conductor_faltante) siguen
--      restringidos: solo dueno/administracion del tenant los ven.
--   2. Seller NO ve NADA en eventos_conciliacion (0 filas), incluso eventos que
--      lo referencian por seller_id.
--   3. Conductor NO ve NADA en eventos_conciliacion (0 filas), incluso eventos
--      que lo referencian por driver_id (su propia liquidación) — el conductor
--      JAMÁS ve conciliación.
--   4. Interno con rol no privilegiado (coordinador) NO ve conciliación.
--   5. Cross-tenant intacto: administracion del tenant A NO ve eventos del B.
--   6. Las columnas nuevas (driver_id, liquidacion_id) se exponen vía la vista
--      re-emitida y respetan la misma RLS.
--   7. authenticated no puede INSERT en eventos_conciliacion (42501).
--   8. Las columnas nuevas de rate card (minimo_retiro_clp, etc.) en
--      identidad.tarifas siguen siendo solo-internas: el seller NO ve tarifas.
--
-- Mecanismo: idéntico a rls_aislamiento_dinero.test.sql — simulamos el JWT
-- fijando request.jwt.claims y conmutando el rol a authenticated.
--
-- Ejecutar: npx supabase test db
-- =============================================================================

begin;

select plan(13);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada (redefinidos — cada .test.sql corre aislado).
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
-- Dos tenants (A, B). Tenant A: 1 seller, 1 conductor, 1 liquidación, y VARIOS
-- eventos de conciliación con los NUEVOS tipos (uno con driver_id+liquidacion_id,
-- uno con seller_id, uno a nivel seller sin conductor). Tenant B: 1 evento para
-- el cruce de tenant. UUIDs propios de esta suite (sufijo 7777) para no chocar.
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';

  s_a uuid := 'aaaaaaaa-1111-0000-0000-000000000001';
  s_b uuid := 'bbbbbbbb-1111-0000-0000-000000000002';

  d_a uuid := 'aaaaaaaa-2222-0000-0000-000000000001';
  d_b uuid := 'bbbbbbbb-2222-0000-0000-000000000002';

  u_dueno_a       uuid := 'aaaaaaaa-3333-0000-0000-000000000001';
  u_admin_a       uuid := 'aaaaaaaa-3333-0000-0000-000000000009';
  u_coordinador_a uuid := 'aaaaaaaa-3333-0000-0000-000000000010';
  u_admin_b       uuid := 'bbbbbbbb-3333-0000-0000-000000000002';
  u_seller_a      uuid := 'aaaaaaaa-3333-0000-0000-000000000003';
  u_conductor_a   uuid := 'aaaaaaaa-3333-0000-0000-000000000006';

  liq_a uuid := 'aaaaaaaa-ffff-7777-0000-000000000001'; -- conductor A
  liq_b uuid := 'bbbbbbbb-ffff-7777-0000-000000000001'; -- conductor B

  -- Eventos de conciliación con los NUEVOS tipos.
  ev_a_fuga    uuid := 'aaaaaaaa-7777-0000-0000-000000000001'; -- pagado_conductor_sin_cobro_seller (driver+liq)
  ev_a_minimo  uuid := 'aaaaaaaa-7777-0000-0000-000000000002'; -- minimo_omitido (a nivel seller, sin driver)
  ev_a_reprog  uuid := 'aaaaaaaa-7777-0000-0000-000000000003'; -- reprogramacion_no_cobrada (seller)
  ev_b_fuga    uuid := 'bbbbbbbb-7777-0000-0000-000000000001'; -- tenant B
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier A', 'Courier A SpA', '76111111-1', 'activo'),
    (t_b, 'Courier B', 'Courier B SpA', '76222222-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_dueno_a,       'dueno.a@concil3.test',       crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_admin_a,       'admin.a@concil3.test',       crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_coordinador_a, 'coordinador.a@concil3.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_admin_b,       'admin.b@concil3.test',       crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,      'seller.a@concil3.test',      crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a,   'conductor.a@concil3.test',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a, t_a, 'Seller A', '77111111-1', 'Contacto A', 'a@seller.test', 'activo'),
    (s_b, t_b, 'Seller B', '77222222-2', 'Contacto B', 'b@seller.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values
    (d_a, t_a, 'Conductor A', '78111111-1', 'dependiente', 'activo'),
    (d_b, t_b, 'Conductor B', '78222222-2', 'dependiente', 'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_dueno_a,       t_a, 'Dueno A',       'interno',   null, null, 'dueno',          'activo'),
    (u_admin_a,       t_a, 'Admin A',       'interno',   null, null, 'administracion', 'activo'),
    (u_coordinador_a, t_a, 'Coordinador A', 'interno',   null, null, 'coordinador',    'activo'),
    (u_admin_b,       t_b, 'Admin B',       'interno',   null, null, 'administracion', 'activo'),
    (u_seller_a,      t_a, 'Seller A user', 'seller',    s_a,  null, 'seller',         'activo'),
    (u_conductor_a,   t_a, 'Cond A user',   'conductor', null, d_a,  'conductor',      'activo')
  on conflict (id) do nothing;

  -- Liquidaciones (para la FK liquidacion_id de eventos_conciliacion).
  insert into dinero.liquidaciones (id, tenant_id, driver_id, fecha_inicio, fecha_fin,
    tipo_periodo, estado, tipo_relacion_conductor)
  values
    (liq_a, t_a, d_a, '2026-06-01', '2026-06-07', 'semanal', 'borrador', 'dependiente'),
    (liq_b, t_b, d_b, '2026-06-01', '2026-06-07', 'semanal', 'borrador', 'dependiente')
  on conflict (id) do nothing;

  -- Tarifa A con columnas nuevas de rate card pobladas (para el test solo-interno).
  insert into identidad.tarifas (id, tenant_id, seller_id, tipo_entrega, modo_calculo,
    monto_clp, vigente_desde, estado, minimo_retiro_clp, minimo_facturacion_clp, recargo_reprogramacion_clp)
  values
    ('aaaaaaaa-aaaa-7777-0000-000000000001', t_a, s_a, 'flex', 'monto_fijo',
     2500, '2026-01-01', 'activa', 1500, 50000, 800)
  on conflict (id) do nothing;

  -- Eventos de conciliación con los NUEVOS tipos.
  -- categoria_negocio es NOT NULL desde la migración de bandeja de excepciones
  -- (20260708000001). Los cuatro tipos usados aquí mapean a 'fuga_ingreso' según
  -- el backfill de esa migración.
  insert into dinero.eventos_conciliacion (id, tenant_id, seller_id, driver_id, liquidacion_id,
    tipo_diferencia, descripcion, monto_diferencia_clp, estado, categoria_negocio)
  values
    -- Fuga directa: pagado al conductor sin cobro al seller (referencia driver + liq).
    (ev_a_fuga, t_a, s_a, d_a, liq_a,
     'pagado_conductor_sin_cobro_seller',
     'Test: entrega pagada al conductor sin línea de cobro al seller', 1200, 'pendiente', 'fuga_ingreso'),
    -- Mínimo omitido (a nivel seller, sin conductor).
    (ev_a_minimo, t_a, s_a, null, null,
     'minimo_omitido',
     'Test: período bajo el mínimo de facturación pactado', 8000, 'pendiente', 'fuga_ingreso'),
    -- Reprogramación no cobrada (seller).
    (ev_a_reprog, t_a, s_a, null, null,
     'reprogramacion_no_cobrada',
     'Test: reprogramación sin recargo cobrado', 800, 'pendiente', 'fuga_ingreso'),
    -- Tenant B: para el cruce de tenant.
    (ev_b_fuga, t_b, s_b, d_b, liq_b,
     'pagado_conductor_sin_cobro_seller',
     'Test B: fuga directa tenant B', 999, 'pendiente', 'fuga_ingreso')
  on conflict (id) do nothing;
end $$;

-- =============================================================================
-- BLOQUE 1 · dueno/administracion del tenant A SÍ ven los nuevos tipos
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- u_dueno_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

-- Test 1: dueno A ve sus 3 eventos (los nuevos tipos), no el del tenant B.
select results_eq(
  $$ select count(*)::int from public.eventos_conciliacion $$,
  $$ values (3) $$,
  'F17: dueno A ve sus 3 eventos de conciliación (nuevos tipos), no el del tenant B'
);

-- Test 2: el evento de fuga directa expone driver_id y liquidacion_id (columnas nuevas).
select results_eq(
  $$ select driver_id, liquidacion_id from public.eventos_conciliacion
     where tipo_diferencia = 'pagado_conductor_sin_cobro_seller'
       and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  $$ values ('aaaaaaaa-2222-0000-0000-000000000001'::uuid,
             'aaaaaaaa-ffff-7777-0000-000000000001'::uuid) $$,
  'F17: vista expone driver_id y liquidacion_id del evento de fuga directa'
);

-- Test 3: administracion también ve los nuevos tipos.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000009'::uuid, -- u_admin_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'administracion'
);
select isnt_empty(
  $$ select 1 from public.eventos_conciliacion
     where tipo_diferencia = 'minimo_omitido' $$,
  'F17: administracion ve eventos con el nuevo tipo minimo_omitido'
);

-- =============================================================================
-- BLOQUE 2 · Cross-tenant intacto
-- =============================================================================

-- Test 4: administracion del tenant A NO ve el evento del tenant B.
select is_empty(
  $$ select 1 from public.eventos_conciliacion
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'F17 P1: administracion del tenant A NO ve eventos de conciliación del tenant B'
);

-- =============================================================================
-- BLOQUE 3 · Interno con rol no privilegiado NO ve conciliación
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000010'::uuid, -- u_coordinador_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'coordinador'
);

-- Test 5
select is_empty(
  $$ select 1 from public.eventos_conciliacion $$,
  'F17: interno con rol coordinador NO ve eventos (solo dueno/administracion), pese a nuevos tipos'
);

-- =============================================================================
-- BLOQUE 4 · Seller NO ve NADA, ni siquiera eventos que lo referencian
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

-- Test 6: 0 filas — el seller jamás ve conciliación, aunque seller_id sea el suyo.
select is_empty(
  $$ select 1 from public.eventos_conciliacion $$,
  'F17: seller A NO ve NINGÚN evento de conciliación (0 filas), aunque lo referencien por seller_id'
);

-- Test 7: tampoco vía consulta dirigida a sus propios tipos (defensa explícita).
select is_empty(
  $$ select 1 from public.eventos_conciliacion
     where seller_id = 'aaaaaaaa-1111-0000-0000-000000000001'
       and tipo_diferencia in ('minimo_omitido', 'reprogramacion_no_cobrada') $$,
  'F17: seller A NO ve eventos minimo_omitido/reprogramacion_no_cobrada referidos a él'
);

-- =============================================================================
-- BLOQUE 5 · Conductor NO ve NADA, ni siquiera eventos de SU liquidación
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

-- Test 8: 0 filas — el conductor JAMÁS ve conciliación.
select is_empty(
  $$ select 1 from public.eventos_conciliacion $$,
  'F17: conductor A NO ve NINGÚN evento de conciliación (0 filas)'
);

-- Test 9: ni siquiera el evento que referencia su propio driver_id/liquidacion_id.
select is_empty(
  $$ select 1 from public.eventos_conciliacion
     where driver_id = 'aaaaaaaa-2222-0000-0000-000000000001' $$,
  'F17: conductor A NO ve el evento de conciliación que apunta a su propio driver_id'
);

-- =============================================================================
-- BLOQUE 6 · Sin INSERT desde authenticated (42501)
-- =============================================================================

-- (sesión: conductor A) — INSERT debe fallar con permiso denegado.
select throws_ok(
  $$ insert into dinero.eventos_conciliacion
       (tenant_id, seller_id, driver_id, tipo_diferencia, descripcion, estado)
     values (
       'aaaaaaaa-0000-0000-0000-000000000001',
       'aaaaaaaa-1111-0000-0000-000000000001',
       'aaaaaaaa-2222-0000-0000-000000000001',
       'pagado_conductor_sin_cobro_seller',
       'FAKE inyectado', 'pendiente'
     ) $$,
  '42501',
  null,
  'F17: INSERT en eventos_conciliacion como authenticated falla con 42501 (solo service_role escribe)'
);

-- =============================================================================
-- BLOQUE 7 · Rate card: columnas nuevas de tarifas siguen solo-internas
-- =============================================================================

-- Seller NO ve tarifas (P1 solo-interna, §8.2) — incluidas las columnas nuevas.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

-- Test 10: seller no ve NINGUNA tarifa, ni la suya (no debe ver mínimos/recargos).
select is_empty(
  $$ select 1 from public.tarifas $$,
  'F17 rate card: seller A NO ve tarifas (ni minimo_retiro_clp/recargo_reprogramacion_clp de su propia tarifa)'
);

-- Interno SÍ ve las columnas nuevas pobladas.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- u_dueno_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

-- Test 11: interno ve los mínimos/recargo de su tarifa.
select results_eq(
  $$ select minimo_retiro_clp, minimo_facturacion_clp, recargo_reprogramacion_clp
     from public.tarifas
     where id = 'aaaaaaaa-aaaa-7777-0000-000000000001' $$,
  $$ values (1500::numeric, 50000::numeric, 800::numeric) $$,
  'F17 rate card: interno ve minimo_retiro/minimo_facturacion/recargo_reprogramacion de su tarifa'
);

-- Test 12: interno del tenant A NO ve tarifas del tenant B (cross-tenant).
select is_empty(
  $$ select 1 from public.tarifas
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'F17 rate card: interno del tenant A NO ve tarifas del tenant B (P1 intacta)'
);

-- =============================================================================
-- Cierre
-- =============================================================================
select * from finish();

rollback;
