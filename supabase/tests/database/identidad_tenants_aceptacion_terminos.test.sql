-- =============================================================================
-- Pruebas — identidad.tenants: evidencia de aceptación de términos
-- Migración 20261001000002.
-- =============================================================================
-- Qué se demuestra contra un Postgres real:
--   1. Las cuatro columnas existen.
--   2. Todas-o-ninguna: 0 de 4 y 4 de 4 pasan; 1, 2 y 3 de 4 fallan (23514).
--   3. Versión vacía/en blanco rechazada.
--   4. `authenticated` (dueño del tenant) NO puede escribirlas, ni siquiera en
--      su propio tenant, y service_role/postgres sí (contraprueba).
--   5. La vista espejo public.tenants NO las expone.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(13);

insert into identidad.tenants (id, nombre_fantasia, rut, estado)
values ('dddddddd-0000-0000-0000-0000000e0e01', 'Courier T', '76000010-0', 'onboarding')
on conflict (id) do nothing;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values ('dddddddd-2222-0000-0000-0000000e0e01', 'dueno@terminos-t.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
on conflict (id) do nothing;

-- 1. Columnas
select has_column('identidad', 'tenants', 'terminos_version', 'existe terminos_version');
select has_column('identidad', 'tenants', 'terminos_aceptados_en', 'existe terminos_aceptados_en');
select has_column('identidad', 'tenants', 'terminos_aceptados_por', 'existe terminos_aceptados_por');
select has_column('identidad', 'tenants', 'privacidad_version_informada', 'existe privacidad_version_informada');

-- 2. Todas o ninguna
select lives_ok(
  $$ update identidad.tenants
        set terminos_version = 'v1',
            terminos_aceptados_en = now(),
            terminos_aceptados_por = 'dddddddd-2222-0000-0000-0000000e0e01',
            privacidad_version_informada = 'v2'
      where id = 'dddddddd-0000-0000-0000-0000000e0e01' $$,
  'las cuatro juntas: válido');
select throws_ok(
  $$ update identidad.tenants set privacidad_version_informada = null
      where id = 'dddddddd-0000-0000-0000-0000000e0e01' $$,
  '23514', null, 'tres de cuatro: rechazado');
select throws_ok(
  $$ update identidad.tenants
        set terminos_version = null, terminos_aceptados_en = null
      where id = 'dddddddd-0000-0000-0000-0000000e0e01' $$,
  '23514', null, 'dos de cuatro: rechazado');
select throws_ok(
  $$ update identidad.tenants
        set terminos_version = null, terminos_aceptados_en = null,
            terminos_aceptados_por = null
      where id = 'dddddddd-0000-0000-0000-0000000e0e01' $$,
  '23514', null, 'una de cuatro: rechazado');
select lives_ok(
  $$ update identidad.tenants
        set terminos_version = null, terminos_aceptados_en = null,
            terminos_aceptados_por = null, privacidad_version_informada = null
      where id = 'dddddddd-0000-0000-0000-0000000e0e01' $$,
  'ninguna: válido (sin evidencia)');

-- 3. Versión en blanco
select throws_ok(
  $$ update identidad.tenants
        set terminos_version = '  ', terminos_aceptados_en = now(),
            terminos_aceptados_por = 'dddddddd-2222-0000-0000-0000000e0e01',
            privacidad_version_informada = 'v2'
      where id = 'dddddddd-0000-0000-0000-0000000e0e01' $$,
  '23514', null, 'versión en blanco: rechazada');

-- 4. authenticated no escribe (aunque sea el dueño del propio tenant)
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'dddddddd-2222-0000-0000-0000000e0e01', 'role', 'authenticated',
  'tenant_id', 'dddddddd-0000-0000-0000-0000000e0e01',
  'tipo_usuario', 'interno', 'rol', 'dueno')::text, true);
select throws_ok(
  $$ update identidad.tenants set terminos_version = 'v9'
      where id = 'dddddddd-0000-0000-0000-0000000e0e01' $$,
  '42501', null, 'dueño authenticated: UPDATE de terminos_version denegado');
select throws_ok(
  $$ update identidad.tenants
        set terminos_version = 'v1', terminos_aceptados_en = now(),
            terminos_aceptados_por = 'dddddddd-2222-0000-0000-0000000e0e01',
            privacidad_version_informada = 'v2'
      where id = 'dddddddd-0000-0000-0000-0000000e0e01' $$,
  '42501', null, 'dueño authenticated: no puede fabricarse evidencia de aceptación');

-- 5. La vista espejo no las expone
select set_config('request.jwt.claims', '', true);
reset role;
select hasnt_column('public', 'tenants', 'terminos_version', 'public.tenants no expone la evidencia');

select * from finish();
rollback;
