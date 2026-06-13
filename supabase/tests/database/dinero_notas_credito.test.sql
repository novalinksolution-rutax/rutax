-- =============================================================================
-- Pruebas — Notas de crédito (61) y anulación de períodos (migración 0011)
-- =============================================================================
-- Demuestra, contra una base Postgres real:
--   1. periodos_cobro tiene las columnas de auditoría de anulación y acepta
--      la transición a estado 'anulado' con motivo/fecha/autor.
--   2. CHECK documentos_dte_referencia_coherente: rechaza un 33 con
--      dte_referencia_id y un 61 sin referencia (23514).
--   3. Índice único parcial idx_dte_nc_unica_por_documento: rechaza un
--      segundo 61 apuntando a la misma factura (23505).
--   4. RLS heredada: el seller dueño VE su NC (61) — debe poder descargarla —
--      pero otro seller del mismo tenant NO la ve, y un interno de otro
--      tenant tampoco (P1+P2 de 0006, sin políticas nuevas).
--   5. Escritura: un seller NO puede insertar un 61 (42501) — solo service_role.
--
-- Mecanismo idéntico a las demás suites: claims JWT simulados + set local role.
--
-- Ejecutar: npx supabase test db
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
-- Fixtures (como postgres — bypassa RLS). UUIDs con prefijo dddddddd propios
-- de esta suite para no chocar con las demás (ON CONFLICT (id) DO NOTHING).
--   Tenant A: sellers s1 y s2; período facturado de s1 con factura 33.
--   Tenant B: solo un dueño (verificación cross-tenant).
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'dddddddd-0000-0000-0000-000000000001';
  t_b uuid := 'dddddddd-0000-0000-0000-000000000002';

  s_1 uuid := 'dddddddd-1111-0000-0000-000000000001';
  s_2 uuid := 'dddddddd-1111-0000-0000-000000000002';

  u_seller_1 uuid := 'dddddddd-3333-0000-0000-000000000001';
  u_seller_2 uuid := 'dddddddd-3333-0000-0000-000000000002';
  u_dueno_a  uuid := 'dddddddd-3333-0000-0000-000000000003';
  u_dueno_b  uuid := 'dddddddd-3333-0000-0000-000000000004';

  periodo_1  uuid := 'dddddddd-5555-0000-0000-000000000001';
  factura_33 uuid := 'dddddddd-8888-0000-0000-000000000001';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier NC A', 'Courier NC A SpA', '76616161-1', 'activo'),
    (t_b, 'Courier NC B', 'Courier NC B SpA', '76626262-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_seller_1, 'seller.1@nc.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_2, 'seller.2@nc.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_dueno_a,  'dueno.a@nc.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_dueno_b,  'dueno.b@nc.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_1, t_a, 'Seller NC Uno', '77616161-1', 'Contacto 1', 's1@ncseller.test', 'activo'),
    (s_2, t_a, 'Seller NC Dos', '77626262-2', 'Contacto 2', 's2@ncseller.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_seller_1, t_a, 'Usuario Seller 1', 'seller',  s_1,  null, 'seller', 'activo'),
    (u_seller_2, t_a, 'Usuario Seller 2', 'seller',  s_2,  null, 'seller', 'activo'),
    (u_dueno_a,  t_a, 'Dueno NC A',       'interno', null, null, 'dueno',  'activo'),
    (u_dueno_b,  t_b, 'Dueno NC B',       'interno', null, null, 'dueno',  'activo')
  on conflict (id) do nothing;

  insert into dinero.periodos_cobro (id, tenant_id, seller_id, fecha_inicio, fecha_fin, tipo_periodo, estado, total_lineas, monto_total_clp)
  values
    (periodo_1, t_a, s_1, '2026-06-01', '2026-06-07', 'semanal', 'facturado', 3, 119000)
  on conflict (id) do nothing;

  -- Factura electrónica (33) del período — SIN referencia (coherente).
  insert into dinero.documentos_dte (id, tenant_id, seller_id, periodo_cobro_id,
    tipo_documento, folio, fecha_emision, monto_neto_clp, monto_iva_clp, monto_total_clp)
  values
    (factura_33, t_a, s_1, periodo_1, 33, 9101, '2026-06-08', 100000, 19000, 119000)
  on conflict (id) do nothing;
end $$;

-- =============================================================================
-- BLOQUE 1 · Columnas de anulación en periodos_cobro
-- =============================================================================

-- Test 1-3 · Existen las tres columnas nuevas
select has_column('dinero', 'periodos_cobro', 'motivo_anulacion',
  'periodos_cobro tiene la columna motivo_anulacion');
select has_column('dinero', 'periodos_cobro', 'anulado_en',
  'periodos_cobro tiene la columna anulado_en');
select has_column('dinero', 'periodos_cobro', 'anulado_por_usuario_id',
  'periodos_cobro tiene la columna anulado_por_usuario_id');

-- Test 4 · La transición a 'anulado' con auditoría completa es aceptada
--          (estado 'anulado' ya estaba en el CHECK desde 0006).
select lives_ok(
  $$ update dinero.periodos_cobro
       set estado                 = 'anulado',
           motivo_anulacion       = 'Factura emitida con monto erróneo — anulada vía NC',
           anulado_en             = now(),
           anulado_por_usuario_id = 'dddddddd-3333-0000-0000-000000000003'
     where id = 'dddddddd-5555-0000-0000-000000000001' $$,
  'El período acepta estado=anulado con motivo, fecha y autor'
);

-- =============================================================================
-- BLOQUE 2 · CHECK documentos_dte_referencia_coherente (como postgres)
-- =============================================================================

-- Test 5 · Un 33 CON referencia viola el CHECK → 23514
select throws_ok(
  $$ insert into dinero.documentos_dte (tenant_id, seller_id, periodo_cobro_id,
       tipo_documento, folio, fecha_emision, monto_neto_clp, monto_iva_clp, monto_total_clp,
       dte_referencia_id)
     values ('dddddddd-0000-0000-0000-000000000001',
             'dddddddd-1111-0000-0000-000000000001',
             'dddddddd-5555-0000-0000-000000000001',
             33, 9100, '2026-06-08', 100000, 19000, 119000,
             'dddddddd-8888-0000-0000-000000000001') $$,
  '23514',
  null,
  'CHECK: una factura (33) con dte_referencia_id se rechaza (23514)'
);

-- Test 6 · Un 61 SIN referencia viola el CHECK → 23514
select throws_ok(
  $$ insert into dinero.documentos_dte (tenant_id, seller_id, periodo_cobro_id,
       tipo_documento, folio, fecha_emision, monto_neto_clp, monto_iva_clp, monto_total_clp)
     values ('dddddddd-0000-0000-0000-000000000001',
             'dddddddd-1111-0000-0000-000000000001',
             'dddddddd-5555-0000-0000-000000000001',
             61, 9102, '2026-06-09', 100000, 19000, 119000) $$,
  '23514',
  null,
  'CHECK: una NC (61) sin dte_referencia_id se rechaza (23514)'
);

-- Test 7 · El 61 correcto (referenciando a su 33) se inserta sin error
select lives_ok(
  $$ insert into dinero.documentos_dte (id, tenant_id, seller_id, periodo_cobro_id,
       tipo_documento, folio, fecha_emision, monto_neto_clp, monto_iva_clp, monto_total_clp,
       dte_referencia_id)
     values ('dddddddd-8888-0000-0000-000000000002',
             'dddddddd-0000-0000-0000-000000000001',
             'dddddddd-1111-0000-0000-000000000001',
             'dddddddd-5555-0000-0000-000000000001',
             61, 9102, '2026-06-09', 100000, 19000, 119000,
             'dddddddd-8888-0000-0000-000000000001') $$,
  'Una NC (61) que referencia a su factura (33) se inserta correctamente'
);

-- Test 8 · Un SEGUNDO 61 apuntando a la misma factura → 23505 (índice único parcial)
select throws_ok(
  $$ insert into dinero.documentos_dte (tenant_id, seller_id, periodo_cobro_id,
       tipo_documento, folio, fecha_emision, monto_neto_clp, monto_iva_clp, monto_total_clp,
       dte_referencia_id)
     values ('dddddddd-0000-0000-0000-000000000001',
             'dddddddd-1111-0000-0000-000000000001',
             'dddddddd-5555-0000-0000-000000000001',
             61, 9103, '2026-06-10', 100000, 19000, 119000,
             'dddddddd-8888-0000-0000-000000000001') $$,
  '23505',
  null,
  'Índice único parcial: un segundo 61 sobre la misma factura se rechaza (23505)'
);

-- =============================================================================
-- BLOQUE 3 · RLS heredada sobre la NC (sin políticas nuevas — P1+P2 de 0006)
-- =============================================================================

-- Test 9 · El seller dueño VE su NC (debe poder descargarla del portal)
select test_iniciar_sesion(
  'dddddddd-3333-0000-0000-000000000001'::uuid, -- u_seller_1
  'dddddddd-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'dddddddd-1111-0000-0000-000000000001'::uuid -- s_1
);

select results_eq(
  $$ select count(*)::int from public.documentos_dte
     where tipo_documento = 61
       and dte_referencia_id = 'dddddddd-8888-0000-0000-000000000001' $$,
  $$ values (1) $$,
  'P2: el seller dueño de la factura VE su nota de crédito (61)'
);

-- Test 10 · Un seller cannot-insert: el 61 lo escribe SOLO service_role → 42501
select throws_ok(
  $$ insert into dinero.documentos_dte (tenant_id, seller_id, periodo_cobro_id,
       tipo_documento, folio, fecha_emision, monto_neto_clp, monto_iva_clp, monto_total_clp,
       dte_referencia_id)
     values ('dddddddd-0000-0000-0000-000000000001',
             'dddddddd-1111-0000-0000-000000000001',
             'dddddddd-5555-0000-0000-000000000001',
             61, 9104, '2026-06-10', 100000, 19000, 119000,
             'dddddddd-8888-0000-0000-000000000001') $$,
  '42501',
  null,
  'Un seller NO puede insertar una NC (42501) — escritura solo service_role'
);

-- Test 11 · OTRO seller del MISMO tenant NO ve la NC ajena
select test_iniciar_sesion(
  'dddddddd-3333-0000-0000-000000000002'::uuid, -- u_seller_2
  'dddddddd-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'dddddddd-1111-0000-0000-000000000002'::uuid -- s_2
);

select is_empty(
  $$ select 1 from public.documentos_dte
     where dte_referencia_id = 'dddddddd-8888-0000-0000-000000000001' $$,
  'P2: otro seller del mismo tenant NO ve la NC del seller 1'
);

-- Test 12 · Interno de OTRO tenant NO ve la NC (P1 cross-tenant)
select test_iniciar_sesion(
  'dddddddd-3333-0000-0000-000000000004'::uuid, -- u_dueno_b
  'dddddddd-0000-0000-0000-000000000002'::uuid, -- t_b
  'interno', 'dueno'
);

select is_empty(
  $$ select 1 from public.documentos_dte
     where tenant_id = 'dddddddd-0000-0000-0000-000000000001' $$,
  'P1 cross-tenant: interno del tenant B NO ve los DTE (ni la NC) del tenant A'
);

select test_cerrar_sesion();

-- =============================================================================
-- Cierre
-- =============================================================================
select * from finish();

rollback;
