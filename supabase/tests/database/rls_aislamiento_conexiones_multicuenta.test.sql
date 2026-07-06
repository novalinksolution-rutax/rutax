-- =============================================================================
-- Pruebas de aislamiento RLS + reglas de negocio — conexiones_seller_ml 1:N
-- (seller con hasta 3 cuentas de Mercado Libre)
-- =============================================================================
-- Migración probada: 20260630000002_identidad_conexiones_seller_ml_multicuenta.sql
-- Diseño: docs/arquitectura/seller-multicuenta-ml.md (§3 RLS, §7-D2/D5).
--
-- Demuestra, contra una base Postgres real (no mocks de aplicación):
--   1. AISLAMIENTO — un seller con 3 conexiones ve EXACTAMENTE las suyas
--      (por seller y por tenant); un seller distinto del mismo tenant no las ve;
--      un seller de otro tenant no ve ninguna; un interno ve las de su tenant y
--      no las del otro.
--   2. TOPE 3 (D5) — la 4ª inserción para un mismo seller falla (check_violation).
--   3. UNICIDAD PARCIAL (D2) — la MISMA ml_user_id repetida para el mismo seller
--      falla (unique_violation); la MISMA cuenta en DOS sellers distintos SE
--      PERMITE; filas "pendientes" (ml_user_id null) múltiples SE PERMITEN.
--
-- Mecanismo idéntico al resto de la suite: simulamos el JWT fijando
-- `request.jwt.claims` y conmutando el rol a `authenticated`.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(19);

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
-- Fixtures (insertados como postgres → bypassa RLS y el trigger de tope NO se
-- salta: BEFORE INSERT corre para cualquier rol, así que sembramos con cuidado
-- de no exceder el tope en el fixture).
--   Tenant A: seller A con 3 conexiones ML (tope lleno) + seller A2 con 1.
--   Tenant B: seller B con 1 conexión.
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-0000000000b2';

  s_a  uuid := 'aaaaaaaa-1111-0000-0000-0000000000a1'; -- seller A (3 cuentas)
  s_a2 uuid := 'aaaaaaaa-1111-0000-0000-0000000000a3'; -- seller A2 (1 cuenta)
  s_b  uuid := 'bbbbbbbb-1111-0000-0000-0000000000b2'; -- seller B (1 cuenta)

  u_interno_a uuid := 'aaaaaaaa-3333-0000-0000-0000000000a1';
  u_seller_a  uuid := 'aaaaaaaa-3333-0000-0000-0000000000a3';
  u_seller_a2 uuid := 'aaaaaaaa-3333-0000-0000-0000000000a4';
  u_interno_b uuid := 'bbbbbbbb-3333-0000-0000-0000000000b2';
  u_seller_b  uuid := 'bbbbbbbb-3333-0000-0000-0000000000b5';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier A', 'Courier A SpA', '76111111-1', 'activo'),
    (t_b, 'Courier B', 'Courier B SpA', '76222222-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_interno_a, 'interno.a@multicuenta.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,  'seller.a@multicuenta.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a2, 'seller.a2@multicuenta.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_interno_b, 'interno.b@multicuenta.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_b,  'seller.b@multicuenta.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
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
    (u_seller_a2, t_a, 'Usuario Seller A2', 'seller',  s_a2, null, 'seller', 'activo'),
    (u_interno_b, t_b, 'Interno B',         'interno', null, null, 'dueno',  'activo'),
    (u_seller_b,  t_b, 'Usuario Seller B',  'seller',  s_b,  null, 'seller', 'activo')
  on conflict (id) do nothing;

  -- Seller A: 3 conexiones (tope lleno). Distintas ml_user_id + alias/nickname.
  insert into identidad.conexiones_seller_ml (tenant_id, seller_id, ml_user_id, alias, ml_nickname, estado_salud)
  values
    (t_a, s_a, 'ML-A-1', 'Tienda oficial', 'nick_a1', 'sana'),
    (t_a, s_a, 'ML-A-2', 'Outlet',         'nick_a2', 'sana'),
    (t_a, s_a, 'ML-A-3', 'Mayorista',      'nick_a3', 'pendiente')
  on conflict do nothing;

  -- Seller A2: 1 conexión (mismo tenant, otro seller).
  insert into identidad.conexiones_seller_ml (tenant_id, seller_id, ml_user_id, estado_salud)
  values (t_a, s_a2, 'ML-A2-1', 'sana')
  on conflict do nothing;

  -- Seller B: 1 conexión (otro tenant).
  insert into identidad.conexiones_seller_ml (tenant_id, seller_id, ml_user_id, estado_salud)
  values (t_b, s_b, 'ML-B-1', 'sana')
  on conflict do nothing;
end $$;

-- =============================================================================
-- BLOQUE 1 · Columnas nuevas existen y la vista public las hereda
-- =============================================================================
select has_column('identidad', 'conexiones_seller_ml', 'alias',
  'esquema: identidad.conexiones_seller_ml tiene columna alias');
select has_column('identidad', 'conexiones_seller_ml', 'ml_nickname',
  'esquema: identidad.conexiones_seller_ml tiene columna ml_nickname');
select has_column('public', 'conexiones_seller_ml', 'alias',
  'vista public.conexiones_seller_ml re-emitida hereda columna alias');

-- El índice único de seller_id fue soltado (ya no es 1:1); queda el parcial.
-- (Chequeo por catálogo pg_indexes — inequívoco para índices parciales.)
select is_empty(
  $$ select 1 from pg_indexes
     where schemaname = 'identidad'
       and indexname = 'conexiones_seller_ml_seller_id_uk' $$,
  'esquema: el índice único 1:1 conexiones_seller_ml_seller_id_uk fue soltado'
);

select is_empty(
  $$ select 1 from pg_constraint
     where conname = 'conexiones_seller_ml_seller_id_key' $$,
  'esquema: la constraint de columna unique(seller_id) fue soltada'
);

select isnt_empty(
  $$ select 1 from pg_indexes
     where schemaname = 'identidad'
       and indexname = 'conexiones_seller_ml_seller_cuenta_uk'
       and indexdef ilike '%where (ml_user_id is not null)%' $$,
  'esquema: existe el índice único PARCIAL (seller_id, ml_user_id) where ml_user_id is not null'
);

select isnt_empty(
  $$ select 1 from pg_indexes
     where schemaname = 'identidad'
       and indexname = 'conexiones_seller_ml_seller_id_idx' $$,
  'esquema: existe el índice NO único de lookup en seller_id'
);

-- =============================================================================
-- BLOQUE 2 · AISLAMIENTO — seller A con 3 conexiones ve exactamente las suyas
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000a3'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-0000000000a1'::uuid -- s_a
);

-- Ve sus 3 conexiones — la RLS escala a N filas.
select results_eq(
  $$ select count(*)::int from public.conexiones_seller_ml $$,
  $$ values (3) $$,
  'aislamiento: seller A ve EXACTAMENTE sus 3 conexiones ML (RLS escala a N filas)'
);

-- Todas son suyas (ninguna de otro seller se cuela).
select results_eq(
  $$ select distinct seller_id::text from public.conexiones_seller_ml $$,
  $$ values ('aaaaaaaa-1111-0000-0000-0000000000a1') $$,
  'aislamiento: todas las filas visibles del seller A son de su propio seller_id'
);

-- No ve la conexión del seller A2 (mismo tenant, otro seller).
select is_empty(
  $$ select 1 from public.conexiones_seller_ml
     where seller_id = 'aaaaaaaa-1111-0000-0000-0000000000a3' $$,
  'aislamiento: seller A NO ve la conexión del seller A2 (mismo tenant, otro seller)'
);

-- No ve nada del tenant B.
select is_empty(
  $$ select 1 from public.conexiones_seller_ml
     where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000000b2' $$,
  'aislamiento: seller A NO ve conexiones del tenant B'
);

-- --- Seller B (otro tenant): no ve ninguna de A -----------------------------
select test_iniciar_sesion(
  'bbbbbbbb-3333-0000-0000-0000000000b5'::uuid, -- u_seller_b
  'bbbbbbbb-0000-0000-0000-0000000000b2'::uuid, -- t_b
  'seller', 'seller',
  p_seller_id => 'bbbbbbbb-1111-0000-0000-0000000000b2'::uuid -- s_b
);

select results_eq(
  $$ select count(*)::int from public.conexiones_seller_ml $$,
  $$ values (1) $$,
  'aislamiento: seller B (otro tenant) ve solo su propia conexión, no las 3 de A'
);

-- --- Interno A: ve las 4 de su tenant (3 de A + 1 de A2), 0 del tenant B ----
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000a1'::uuid, -- u_interno_a
  'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, -- t_a
  'interno', 'dueno'
);

select results_eq(
  $$ select count(*)::int from public.conexiones_seller_ml $$,
  $$ values (4) $$,
  'aislamiento: interno A ve las 4 conexiones de SU tenant (3 de A + 1 de A2)'
);

select is_empty(
  $$ select 1 from public.conexiones_seller_ml
     where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000000b2' $$,
  'aislamiento: interno A NO ve conexiones del tenant B'
);

select test_cerrar_sesion();

-- =============================================================================
-- BLOQUE 3 · TOPE 3 (D5) — la 4ª inserción para el seller A falla
-- =============================================================================
-- Se prueba como postgres (bypassa RLS pero NO el trigger BEFORE INSERT).
select throws_ok(
  $$ insert into identidad.conexiones_seller_ml (tenant_id, seller_id, ml_user_id, estado_salud)
     values ('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-1111-0000-0000-0000000000a1',
             'ML-A-4', 'pendiente') $$,
  '23514',  -- check_violation (errcode que el trigger de tope emite)
  null,
  'tope 3: insertar la 4ª conexión del seller A falla (check_violation)'
);

-- El seller A2 (con 1 conexión) SÍ puede agregar más — el tope es por seller.
select lives_ok(
  $$ insert into identidad.conexiones_seller_ml (tenant_id, seller_id, ml_user_id, estado_salud)
     values ('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-1111-0000-0000-0000000000a3',
             'ML-A2-2', 'pendiente') $$,
  'tope 3: el seller A2 (bajo el tope) SÍ puede agregar una 2ª conexión'
);

-- =============================================================================
-- BLOQUE 4 · UNICIDAD PARCIAL (D2)
-- =============================================================================
-- Misma ml_user_id repetida para el MISMO seller → rechazada. Usamos el seller
-- B (1 conexión ML-B-1, bajo el tope) para aislar del tope del bloque 3.
select throws_ok(
  $$ insert into identidad.conexiones_seller_ml (tenant_id, seller_id, ml_user_id, estado_salud)
     values ('bbbbbbbb-0000-0000-0000-0000000000b2', 'bbbbbbbb-1111-0000-0000-0000000000b2',
             'ML-B-1', 'pendiente') $$,
  '23505',  -- unique_violation (índice parcial (seller_id, ml_user_id))
  null,
  'unicidad parcial: repetir la MISMA ml_user_id para el mismo seller falla (unique_violation)'
);

-- La MISMA cuenta ML en DOS sellers distintos SE PERMITE (no unicidad global).
-- El seller A2 (tenant A) conecta la MISMA ml_user_id que el seller B (tenant B).
select lives_ok(
  $$ insert into identidad.conexiones_seller_ml (tenant_id, seller_id, ml_user_id, estado_salud)
     values ('aaaaaaaa-0000-0000-0000-0000000000a1', 'aaaaaaaa-1111-0000-0000-0000000000a3',
             'ML-B-1', 'pendiente') $$,
  'unicidad parcial: la MISMA cuenta ML en dos sellers distintos SE PERMITE (no hay unicidad global de ml_user_id)'
);

-- Múltiples filas "pendientes" (ml_user_id null) para el mismo seller SE PERMITEN
-- (el índice único es parcial: where ml_user_id is not null). Seller B tiene 1
-- fila con ml_user_id; agregamos dos pendientes → total 3, bajo el tope.
select lives_ok(
  $$ insert into identidad.conexiones_seller_ml (tenant_id, seller_id, ml_user_id, estado_salud)
     values
       ('bbbbbbbb-0000-0000-0000-0000000000b2', 'bbbbbbbb-1111-0000-0000-0000000000b2', null, 'pendiente'),
       ('bbbbbbbb-0000-0000-0000-0000000000b2', 'bbbbbbbb-1111-0000-0000-0000000000b2', null, 'pendiente') $$,
  'unicidad parcial: múltiples filas pendientes (ml_user_id null) del mismo seller SE PERMITEN'
);

select * from finish();

rollback;
