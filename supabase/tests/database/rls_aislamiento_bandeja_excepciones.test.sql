-- =============================================================================
-- Pruebas de aislamiento RLS — Bandeja de excepciones de conciliación (§1.1 P1)
-- =============================================================================
-- Demuestra, contra una base Postgres real (no mocks de aplicación), que tras
-- elevar dinero.eventos_conciliacion a bandeja gestionable (8 estados,
-- categoría, asignación, SLA, bloqueo) y crear dinero.eventos_conciliacion_historial:
--
--   1. dueno/administracion del tenant A SÍ ven sus excepciones y su historial,
--      incluidas las columnas nuevas (categoria_negocio, bloquea_facturacion…).
--   2. Cross-tenant: administracion del tenant A NO ve NADA del tenant B, ni en
--      eventos ni en el historial (P1).
--   3. Interno con rol no privilegiado (coordinador) NO ve excepciones ni historial.
--   4. Seller NO ve NINGUNA excepción ni entrada de historial (0 filas) — jamás ve
--      los datos internos del courier.
--   5. Conductor NO ve NINGUNA excepción ni entrada de historial (0 filas).
--   6. authenticated NO puede INSERT en el historial (42501) — escritura solo service_role.
--   7. El CHECK de bloqueo (motivo obligatorio) y el CHECK de estado de 8 valores
--      se imponen a nivel de datos (no dependen de la app).
--
-- Mecanismo: idéntico a rls_aislamiento_conciliacion_tres_fuentes.test.sql —
-- simulamos el JWT fijando request.jwt.claims y conmutando el rol a authenticated.
--
-- Ejecutar: npx supabase test db
-- =============================================================================

begin;

select plan(17);

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
-- Fixtures. Dos tenants (A, B). Tenant A: seller, conductor, 2 excepciones (una
-- con bloqueo de facturación) y 2 entradas de historial. Tenant B: 1 excepción +
-- 1 entrada de historial para el cruce de tenant. UUIDs con sufijo 6161.
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-000000006161';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-000000006162';

  s_a uuid := 'aaaaaaaa-1111-0000-0000-000000006161';
  s_b uuid := 'bbbbbbbb-1111-0000-0000-000000006162';

  d_a uuid := 'aaaaaaaa-2222-0000-0000-000000006161';

  u_dueno_a       uuid := 'aaaaaaaa-3333-0000-0000-000000006161';
  u_admin_a       uuid := 'aaaaaaaa-3333-0000-0000-000000006169';
  u_coordinador_a uuid := 'aaaaaaaa-3333-0000-0000-000000006170';
  u_admin_b       uuid := 'bbbbbbbb-3333-0000-0000-000000006162';
  u_seller_a      uuid := 'aaaaaaaa-3333-0000-0000-000000006163';
  u_conductor_a   uuid := 'aaaaaaaa-3333-0000-0000-000000006166';

  ev_a1 uuid := 'aaaaaaaa-6161-0000-0000-000000000001'; -- fuga_ingreso, bloquea facturación
  ev_a2 uuid := 'aaaaaaaa-6161-0000-0000-000000000002'; -- cumplimiento_dte, en_analisis
  ev_b1 uuid := 'bbbbbbbb-6161-0000-0000-000000000001'; -- tenant B
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier A', 'Courier A SpA', '76161161-1', 'activo'),
    (t_b, 'Courier B', 'Courier B SpA', '76262262-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_dueno_a,       'dueno.a@bandeja.test',       crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_admin_a,       'admin.a@bandeja.test',       crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_coordinador_a, 'coordinador.a@bandeja.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_admin_b,       'admin.b@bandeja.test',       crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,      'seller.a@bandeja.test',      crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a,   'conductor.a@bandeja.test',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a, t_a, 'Seller A', '77161161-1', 'Contacto A', 'a@bandeja.test', 'activo'),
    (s_b, t_b, 'Seller B', '77262262-2', 'Contacto B', 'b@bandeja.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values
    (d_a, t_a, 'Conductor A', '78161161-1', 'dependiente', 'activo')
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

  -- Excepciones (columnas nuevas pobladas: categoria_negocio NOT NULL, bloqueo).
  insert into dinero.eventos_conciliacion (id, tenant_id, seller_id, tipo_diferencia,
    descripcion, monto_diferencia_clp, estado, categoria_negocio, accion_sugerida,
    bloquea_facturacion, motivo_bloqueo)
  values
    (ev_a1, t_a, s_a, 'pagado_conductor_sin_cobro_seller',
     'Test: fuga — pagado al conductor sin cobro al seller', 1200,
     'pendiente', 'fuga_ingreso', 'generar_cobro_manual',
     true, 'Se retiene facturación hasta confirmar el cobro faltante'),
    (ev_a2, t_a, s_a, 'monto_dte_difiere_de_lineas',
     'Test: monto DTE difiere de líneas', 3000,
     'en_analisis', 'cumplimiento_dte', 'reenviar_o_verificar_dte',
     false, null)
  on conflict (id) do nothing;

  insert into dinero.eventos_conciliacion (id, tenant_id, seller_id, tipo_diferencia,
    descripcion, monto_diferencia_clp, estado, categoria_negocio, accion_sugerida)
  values
    (ev_b1, t_b, s_b, 'pagado_conductor_sin_cobro_seller',
     'Test B: fuga tenant B', 999, 'pendiente', 'fuga_ingreso', 'generar_cobro_manual')
  on conflict (id) do nothing;

  -- Historial de cambios.
  insert into dinero.eventos_conciliacion_historial (tenant_id, evento_id, tipo_cambio,
    estado_anterior, estado_nuevo, actor_tipo)
  values
    (t_a, ev_a1, 'deteccion',     null,        'pendiente',   'sistema'),
    (t_a, ev_a2, 'cambio_estado', 'pendiente', 'en_analisis', 'usuario'),
    (t_b, ev_b1, 'deteccion',     null,        'pendiente',   'sistema')
  on conflict do nothing;
end $$;

-- =============================================================================
-- BLOQUE 1 · dueno/administracion del tenant A SÍ ven excepciones + historial
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000006161'::uuid, -- u_dueno_a
  'aaaaaaaa-0000-0000-0000-000000006161'::uuid, -- t_a
  'interno', 'dueno'
);

-- Test 1: dueno A ve sus 2 excepciones, no la del tenant B.
select results_eq(
  $$ select count(*)::int from public.eventos_conciliacion
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000006161' $$,
  $$ values (2) $$,
  'Bandeja: dueno A ve sus 2 excepciones de conciliación'
);

-- Test 2: expone la columna nueva bloquea_facturacion (true) del evento ev_a1.
select results_eq(
  $$ select bloquea_facturacion, categoria_negocio from public.eventos_conciliacion
     where id = 'aaaaaaaa-6161-0000-0000-000000000001' $$,
  $$ values (true, 'fuga_ingreso') $$,
  'Bandeja: la vista expone bloquea_facturacion + categoria_negocio de la excepción'
);

-- Test 3: administracion A ve el historial de sus excepciones (2 filas), no las de B.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000006169'::uuid, -- u_admin_a
  'aaaaaaaa-0000-0000-0000-000000006161'::uuid, -- t_a
  'interno', 'administracion'
);
select results_eq(
  $$ select count(*)::int from public.eventos_conciliacion_historial
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000006161' $$,
  $$ values (2) $$,
  'Bandeja: administracion A ve las 2 entradas de historial de su tenant'
);

-- =============================================================================
-- BLOQUE 2 · Cross-tenant: A NO ve NADA de B (eventos ni historial)
-- =============================================================================
-- Test 4
select is_empty(
  $$ select 1 from public.eventos_conciliacion
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000006162' $$,
  'Bandeja P1: administracion del tenant A NO ve excepciones del tenant B'
);
-- Test 5
select is_empty(
  $$ select 1 from public.eventos_conciliacion_historial
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000006162' $$,
  'Bandeja P1: administracion del tenant A NO ve el historial del tenant B'
);

-- =============================================================================
-- BLOQUE 3 · Interno con rol no privilegiado (coordinador) NO ve nada
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000006170'::uuid, -- u_coordinador_a
  'aaaaaaaa-0000-0000-0000-000000006161'::uuid, -- t_a
  'interno', 'coordinador'
);
-- Test 6
select is_empty(
  $$ select 1 from public.eventos_conciliacion $$,
  'Bandeja: interno coordinador NO ve excepciones (solo dueno/administracion)'
);
-- Test 7
select is_empty(
  $$ select 1 from public.eventos_conciliacion_historial $$,
  'Bandeja: interno coordinador NO ve el historial (solo dueno/administracion)'
);

-- =============================================================================
-- BLOQUE 4 · Seller NO ve datos internos del courier (0 filas)
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000006163'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000006161'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000006161'::uuid -- s_a
);
-- Test 8
select is_empty(
  $$ select 1 from public.eventos_conciliacion $$,
  'Bandeja: seller A NO ve NINGUNA excepción (aunque la refiera por su seller_id)'
);
-- Test 9
select is_empty(
  $$ select 1 from public.eventos_conciliacion_historial $$,
  'Bandeja: seller A NO ve NINGUNA entrada de historial (datos internos del courier)'
);

-- =============================================================================
-- BLOQUE 5 · Conductor NO ve nada (0 filas)
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000006166'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000006161'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000006161'::uuid -- d_a
);
-- Test 10
select is_empty(
  $$ select 1 from public.eventos_conciliacion $$,
  'Bandeja: conductor A NO ve NINGUNA excepción'
);
-- Test 11
select is_empty(
  $$ select 1 from public.eventos_conciliacion_historial $$,
  'Bandeja: conductor A NO ve NINGUNA entrada de historial'
);

-- =============================================================================
-- BLOQUE 6 · Sin INSERT desde authenticated en el historial (42501)
-- =============================================================================
-- Test 12: (sesión: conductor A) — INSERT debe fallar con permiso denegado.
select throws_ok(
  $$ insert into dinero.eventos_conciliacion_historial
       (tenant_id, evento_id, tipo_cambio, actor_tipo)
     values (
       'aaaaaaaa-0000-0000-0000-000000006161',
       'aaaaaaaa-6161-0000-0000-000000000001',
       'comentario', 'usuario'
     ) $$,
  '42501',
  null,
  'Bandeja: INSERT en historial como authenticated falla con 42501 (solo service_role)'
);

-- =============================================================================
-- BLOQUE 7 · Constraints de datos (independientes de la app)
--   Se ejecutan como el rol por defecto (superuser del test): bypass de RLS y de
--   GRANT, para aislar el CHECK puro.
-- =============================================================================
select test_cerrar_sesion();

-- Test 13: el CHECK de bloqueo exige motivo cuando bloquea_facturacion = true.
select throws_ok(
  $$ insert into dinero.eventos_conciliacion
       (tenant_id, seller_id, tipo_diferencia, descripcion, categoria_negocio,
        bloquea_facturacion)
     values (
       'aaaaaaaa-0000-0000-0000-000000006161',
       'aaaaaaaa-1111-0000-0000-000000006161',
       'pagado_conductor_sin_cobro_seller', 'Bloqueo sin motivo', 'fuga_ingreso',
       true
     ) $$,
  '23514',
  null,
  'Bandeja: bloquea_facturacion=true sin motivo viola eventos_conciliacion_bloqueo_motivo (23514)'
);

-- Test 14: el estado viejo 'resuelto' ya NO es válido (swap a 8 valores nuevos).
select throws_ok(
  $$ insert into dinero.eventos_conciliacion
       (tenant_id, seller_id, tipo_diferencia, descripcion, categoria_negocio, estado)
     values (
       'aaaaaaaa-0000-0000-0000-000000006161',
       'aaaaaaaa-1111-0000-0000-000000006161',
       'monto_dte_difiere_de_lineas', 'Estado viejo', 'cumplimiento_dte',
       'resuelto'
     ) $$,
  '23514',
  null,
  'Bandeja: el estado viejo "resuelto" viola el CHECK de 8 estados nuevos (23514)'
);

-- Test 15: el historial rechaza un tipo_cambio fuera del catálogo (23514).
select throws_ok(
  $$ insert into dinero.eventos_conciliacion_historial
       (tenant_id, evento_id, tipo_cambio, actor_tipo)
     values (
       'aaaaaaaa-0000-0000-0000-000000006161',
       'aaaaaaaa-6161-0000-0000-000000000001',
       'tipo_inventado', 'sistema'
     ) $$,
  '23514',
  null,
  'Bandeja: tipo_cambio inválido viola eventos_conc_hist_tipo_valido (23514)'
);

-- =============================================================================
-- BLOQUE 8 · Separación del "estado externo de payout no reconocido" (migración
--   0038). El caso 2 del webhook Fintoc (status raro/no mapeado) usa su propio
--   tipo_diferencia + acción, con la categoría existente 'integridad_datos'. Se
--   ejecuta como el rol por defecto (superuser del test): bypass de RLS/GRANT
--   para aislar el CHECK puro. Sesión ya cerrada en el BLOQUE 7.
-- =============================================================================

-- Test 16: la combinación NUEVA es ACEPTADA por los 3 CHECK (tipo_diferencia +
-- accion_sugerida + categoria_negocio). estado toma su default 'pendiente';
-- sin bloqueo → no exige motivo.
select lives_ok(
  $$ insert into dinero.eventos_conciliacion
       (tenant_id, seller_id, tipo_diferencia, descripcion, categoria_negocio,
        accion_sugerida)
     values (
       'aaaaaaaa-0000-0000-0000-000000006161',
       'aaaaaaaa-1111-0000-0000-000000006161',
       'payout_estado_no_reconocido',
       'Test: estado externo de payout no reconocido (caso 2, requiere revisión)',
       'integridad_datos',
       'revisar_estado_externo'
     ) $$,
  'Bandeja 0038: tipo payout_estado_no_reconocido + accion revisar_estado_externo + categoria integridad_datos es ACEPTADO por los CHECK'
);

-- Test 17: una accion_sugerida basura sigue siendo RECHAZADA (23514) — el CHECK
-- de acción no se volvió permisivo al ampliarlo.
select throws_ok(
  $$ insert into dinero.eventos_conciliacion
       (tenant_id, seller_id, tipo_diferencia, descripcion, categoria_negocio,
        accion_sugerida)
     values (
       'aaaaaaaa-0000-0000-0000-000000006161',
       'aaaaaaaa-1111-0000-0000-000000006161',
       'payout_estado_no_reconocido',
       'Test: accion basura', 'integridad_datos',
       'accion_inventada'
     ) $$,
  '23514',
  null,
  'Bandeja 0038: una accion_sugerida fuera del catálogo viola eventos_conciliacion_accion_valida (23514)'
);

-- =============================================================================
-- Cierre
-- =============================================================================
select * from finish();

rollback;
