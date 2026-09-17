-- =============================================================================
-- Aislamiento RLS — alta de seller por autoservicio (multi-courier)
-- =============================================================================
-- Migración probada:
--   20260916000001_identidad_alta_seller_autoservicio.sql
--
-- Demuestra, contra una base Postgres real (no mocks de aplicación), la matriz de
-- aislamiento cruzado con CONTRAPRUEBA:
--
--   (a) DENY-ALL EFECTIVO — un courier NO puede leer seller_identidades,
--       seller_membresias (por tenant) ni enlaces_registro_seller de NADIE. No es
--       "ausencia de política": es privilegio DENEGADO (42501 al golpear
--       identidad.* directo, que es como PostgREST expone el esquema) + sin vista
--       espejo en public para las dos tablas deny-all.
--   (b) SELF-READ DEL SELLER — el seller ve EXACTAMENTE sus seller_membresias,
--       incluidas las de VARIOS couriers (multi-courier), y ninguna de otro seller.
--       Un courier ve CERO membresías (deny-all a couriers).
--   (c) TENANT-SCOPE — seller_fuentes_declaradas respeta el tenant: el interno ve
--       las de su courier y cero del otro; el seller solo las de su propio seller;
--       el conductor ninguna. Y la escritura es de interno/service_role, no del
--       seller (42501 explícito, no "0 filas" silencioso).
--
-- Mecanismo idéntico al resto de la suite: se simula el JWT fijando
-- request.jwt.claims (incluido 'sub', que es lo que lee auth.uid()) y conmutando
-- el rol a authenticated.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(36);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada.
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
-- Fixtures (como postgres → bypassa RLS; los guards `solo_interno_edita` no se
-- disparan porque auth.role() es NULL sin claims).
--   Tenant A: seller_multi (también en B), seller_solo, interno, conductor.
--   Tenant B: seller_multi encarnado en s_b_multi, interno.
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-0000000000d1';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-0000000000d2';

  s_a_multi uuid := 'aaaaaaaa-1111-0000-0000-0000000000d1';
  s_a_solo  uuid := 'aaaaaaaa-1111-0000-0000-0000000000d2';
  s_b_multi uuid := 'bbbbbbbb-1111-0000-0000-0000000000d2';

  c_a uuid := 'aaaaaaaa-2222-0000-0000-0000000000d1';

  u_seller_multi uuid := 'aaaaaaaa-3333-0000-0000-0000000000d1';
  u_seller_solo  uuid := 'aaaaaaaa-3333-0000-0000-0000000000d2';
  u_interno_a    uuid := 'aaaaaaaa-3333-0000-0000-0000000000d3';
  u_interno_b    uuid := 'bbbbbbbb-3333-0000-0000-0000000000d4';
  u_conductor_a  uuid := 'aaaaaaaa-3333-0000-0000-0000000000d5';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier Alta A', 'Courier Alta A SpA', '76700000-1', 'activo'),
    (t_b, 'Courier Alta B', 'Courier Alta B SpA', '76800000-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_seller_multi, 'multi@alta.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_solo,  'solo@alta.test',     crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_interno_a,    'interno.a@alta.test',crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_interno_b,    'interno.b@alta.test',crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a,  'cond.a@alta.test',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, estado)
  values
    (s_a_multi, t_a, 'Empresa Multi (en A)', '77700000-1', 'activo'),
    (s_a_solo,  t_a, 'Empresa Solo',         '77800000-2', 'activo'),
    (s_b_multi, t_b, 'Empresa Multi (en B)', '77700000-1', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values (c_a, t_a, 'Conductor A', '15111111-1', 'dependiente', 'activo')
  on conflict (id) do nothing;

  -- usuarios_perfil (1:1, la membresía ACTIVA). El seller_multi tiene su fila
  -- activa apuntando a su seller de A; su membresía en B vive solo en
  -- seller_membresias (el switcher la activaría).
  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_seller_multi, t_a, 'Usuario Multi', 'seller',   s_a_multi, null, 'seller',      'activo'),
    (u_seller_solo,  t_a, 'Usuario Solo',  'seller',   s_a_solo,  null, 'seller',      'activo'),
    (u_interno_a,    t_a, 'Interno A',     'interno',  null,      null, 'dueno',       'activo'),
    (u_interno_b,    t_b, 'Interno B',     'interno',  null,      null, 'dueno',       'activo'),
    (u_conductor_a,  t_a, 'Conductor A',   'conductor',null,      c_a,  'conductor',   'activo')
  on conflict (id) do nothing;

  -- seller_identidades (la empresa compartida).
  insert into identidad.seller_identidades (auth_user_id, razon_social, rut, nombre_contacto)
  values
    (u_seller_multi, 'Empresa Multi', '77700000-1', 'Contacto Multi'),
    (u_seller_solo,  'Empresa Solo',  '77800000-2', 'Contacto Solo')
  on conflict (auth_user_id) do nothing;

  -- seller_membresias: multi pertenece a A y a B; solo, solo a A.
  insert into identidad.seller_membresias (auth_user_id, tenant_id, seller_id, estado)
  values
    (u_seller_multi, t_a, s_a_multi, 'activa'),
    (u_seller_multi, t_b, s_b_multi, 'activa'),
    (u_seller_solo,  t_a, s_a_solo,  'activa')
  on conflict (auth_user_id, tenant_id) do nothing;

  -- enlaces_registro_seller: uno vivo por courier.
  insert into identidad.enlaces_registro_seller (tenant_id, token, creado_por)
  values
    (t_a, 'tok-a', u_interno_a),
    (t_b, 'tok-b', u_interno_b)
  on conflict (token) do nothing;

  -- seller_fuentes_declaradas.
  insert into identidad.seller_fuentes_declaradas (tenant_id, seller_id, fuente, estado)
  values
    (t_a, s_a_multi, 'ml_flex',      'pendiente'),
    (t_a, s_a_multi, 'rutax_manual', 'conectada'),
    (t_a, s_a_solo,  'shopify',      'pendiente'),
    (t_b, s_b_multi, 'ml_flex',      'conectada')
  on conflict (tenant_id, seller_id, fuente) do nothing;
end $$;

-- =============================================================================
-- BLOQUE 0 · Contrato de esquema
-- =============================================================================
select has_table('identidad', 'seller_identidades',       'esquema: existe identidad.seller_identidades');
select has_table('identidad', 'seller_membresias',        'esquema: existe identidad.seller_membresias');
select has_table('identidad', 'enlaces_registro_seller',  'esquema: existe identidad.enlaces_registro_seller');
select has_table('identidad', 'seller_fuentes_declaradas','esquema: existe identidad.seller_fuentes_declaradas');

-- Las dos deny-all NO tienen vista espejo en public.
select hasnt_view('public', 'seller_identidades',
  'deny-all: seller_identidades NO tiene vista espejo en public');
select hasnt_view('public', 'enlaces_registro_seller',
  'deny-all: enlaces_registro_seller NO tiene vista espejo en public');

-- Las dos que el cliente lee SÍ tienen vista espejo.
select has_view('public', 'seller_membresias',
  'esquema: seller_membresias sí tiene vista espejo (el seller la lee por PostgREST)');
select has_view('public', 'seller_fuentes_declaradas',
  'esquema: seller_fuentes_declaradas sí tiene vista espejo');

-- Deny-all NO es "olvido de política": es que NO hay ninguna política y el
-- privilegio está revocado. La ausencia de política se prueba aquí; el privilegio,
-- en los bloques 1 y 2 con el 42501.
select is_empty(
  $$ select 1 from pg_policies where schemaname = 'identidad' and tablename = 'seller_identidades' $$,
  'deny-all: seller_identidades no tiene NINGUNA política (aislada por privilegio, no por policy)'
);
select is_empty(
  $$ select 1 from pg_policies where schemaname = 'identidad' and tablename = 'enlaces_registro_seller' $$,
  'deny-all: enlaces_registro_seller no tiene NINGUNA política'
);

-- Un enlace VIVO por courier (unique parcial where activo).
select throws_ok(
  $$ insert into identidad.enlaces_registro_seller (tenant_id, token)
     values ('aaaaaaaa-0000-0000-0000-0000000000d1', 'tok-a-2') $$,
  '23505',
  null,
  'enlace: un courier no puede tener dos enlaces vivos a la vez (unique parcial where activo)'
);

-- Regenerar = bajar el vigente (baja lógica) + insertar otro. Legítimo.
update identidad.enlaces_registro_seller
   set activo = false, revocado_en = now()
 where token = 'tok-a';
select lives_ok(
  $$ insert into identidad.enlaces_registro_seller (tenant_id, token)
     values ('aaaaaaaa-0000-0000-0000-0000000000d1', 'tok-a-3') $$,
  'enlace: tras revocar el vigente, se puede insertar uno nuevo (regenerar = baja + alta)'
);

-- =============================================================================
-- BLOQUE 1 · DENY-ALL de seller_identidades (dato personal cross-tenant)
-- =============================================================================
-- Un courier (interno) NO llega a la empresa del seller, ni la de su propio
-- tenant. Se golpea identidad.* directo: es como PostgREST expone el esquema, y es
-- donde un grant de tabla completa se habría filtrado.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d3'::uuid, -- interno A
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid, -- t_a
  'interno', 'dueno'
);
select throws_ok(
  $$ select razon_social from identidad.seller_identidades $$,
  '42501', null,
  'deny-all: el interno A NO lee seller_identidades (privilegio denegado, no "0 filas")'
);

select test_iniciar_sesion(
  'bbbbbbbb-3333-0000-0000-0000000000d4'::uuid, -- interno B
  'bbbbbbbb-0000-0000-0000-0000000000d2'::uuid, -- t_b
  'interno', 'dueno'
);
select throws_ok(
  $$ select razon_social from identidad.seller_identidades $$,
  '42501', null,
  'deny-all: el courier B NO lee la empresa de ningún seller (aislamiento cross-tenant)'
);

-- Ni el propio seller por la vía de cliente (la lee por service_role, no por RLS).
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid, -- seller_multi
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-0000000000d1'::uuid
);
select throws_ok(
  $$ select razon_social from identidad.seller_identidades $$,
  '42501', null,
  'deny-all: ni el propio seller lee seller_identidades por cliente (va por service_role)'
);

-- =============================================================================
-- BLOQUE 2 · DENY-ALL de enlaces_registro_seller
-- =============================================================================
-- El interno NO enumera enlaces, ni los de su propio tenant: el panel del courier
-- los gestiona por service_role. La landing pública resuelve token→tenant también
-- por service_role.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d3'::uuid, -- interno A
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'interno', 'dueno'
);
select throws_ok(
  $$ select token from identidad.enlaces_registro_seller $$,
  '42501', null,
  'deny-all: el interno A NO enumera enlaces_registro_seller (ni los de su tenant): service_role'
);

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid, -- seller_multi
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-0000000000d1'::uuid
);
select throws_ok(
  $$ select token from identidad.enlaces_registro_seller $$,
  '42501', null,
  'deny-all: un seller NO lee enlaces_registro_seller'
);

-- =============================================================================
-- BLOQUE 3 · SELF-READ del seller en seller_membresias (multi-courier)
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid, -- seller_multi, activo en A
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-0000000000d1'::uuid
);

-- Ve sus DOS membresías (A y B), aunque su claim activo es solo A: el filtro es la
-- identidad Auth, no el tenant. Esto es lo que alimenta el selector.
select results_eq(
  $$ select count(*)::int from public.seller_membresias $$,
  $$ values (2) $$,
  'self-read: seller_multi ve sus 2 membresías (courier A y courier B) — multi-courier'
);
select results_eq(
  $$ select distinct auth_user_id::text from public.seller_membresias $$,
  $$ values ('aaaaaaaa-3333-0000-0000-0000000000d1') $$,
  'self-read: todas las filas visibles son de su propia identidad'
);
select is_empty(
  $$ select 1 from public.seller_membresias
     where auth_user_id = 'aaaaaaaa-3333-0000-0000-0000000000d2' $$,
  'self-read: seller_multi NO ve la membresía del seller_solo (otra identidad)'
);

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d2'::uuid, -- seller_solo
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-0000000000d2'::uuid
);
select results_eq(
  $$ select count(*)::int from public.seller_membresias $$,
  $$ values (1) $$,
  'self-read: seller_solo ve solo su única membresía'
);

-- Un courier ve CERO membresías: deny-all a couriers (no hay política por tenant).
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d3'::uuid, -- interno A
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'interno', 'dueno'
);
select is_empty(
  $$ select 1 from public.seller_membresias $$,
  'deny-all a couriers: el interno A ve CERO membresías (no puede enumerar con quién trabaja un seller)'
);

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d5'::uuid, -- conductor A
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-0000000000d1'::uuid
);
select is_empty(
  $$ select 1 from public.seller_membresias $$,
  'deny-all: un conductor ve CERO membresías'
);

-- Escritura: nadie del cliente escribe (alta/switcher/bloqueo son service_role).
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid, -- seller_multi
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-0000000000d1'::uuid
);
select throws_ok(
  $$ insert into identidad.seller_membresias (auth_user_id, tenant_id, seller_id)
     values ('aaaaaaaa-3333-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-0000000000d1',
             'aaaaaaaa-1111-0000-0000-0000000000d1') $$,
  '42501', null,
  'escritura: el seller NO puede auto-insertarse una membresía (42501, no un self-insert)'
);

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d3'::uuid, -- interno A
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'interno', 'dueno'
);
select throws_ok(
  $$ insert into identidad.seller_membresias (auth_user_id, tenant_id, seller_id)
     values ('aaaaaaaa-3333-0000-0000-0000000000d2', 'aaaaaaaa-0000-0000-0000-0000000000d1',
             'aaaaaaaa-1111-0000-0000-0000000000d2') $$,
  '42501', null,
  'escritura: ni el interno puede agregar membresías a mano (es service_role)'
);

-- =============================================================================
-- BLOQUE 4 · TENANT-SCOPE de seller_fuentes_declaradas
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d3'::uuid, -- interno A
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'interno', 'dueno'
);
select results_eq(
  $$ select count(*)::int from public.seller_fuentes_declaradas $$,
  $$ values (3) $$,
  'tenant-scope: el interno A ve las 3 fuentes declaradas de su tenant'
);
select is_empty(
  $$ select 1 from public.seller_fuentes_declaradas
     where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000000d2' $$,
  'tenant-scope: el interno A NO ve las fuentes del tenant B'
);

select test_iniciar_sesion(
  'bbbbbbbb-3333-0000-0000-0000000000d4'::uuid, -- interno B
  'bbbbbbbb-0000-0000-0000-0000000000d2'::uuid,
  'interno', 'dueno'
);
select results_eq(
  $$ select count(*)::int from public.seller_fuentes_declaradas $$,
  $$ values (1) $$,
  'tenant-scope: el interno B ve solo la fuente de su tenant, ninguna de las 3 de A'
);

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid, -- seller_multi
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-0000000000d1'::uuid
);
select results_eq(
  $$ select count(*)::int from public.seller_fuentes_declaradas $$,
  $$ values (2) $$,
  'seller: seller_multi ve EXACTAMENTE sus 2 fuentes (ml_flex + rutax_manual)'
);
select is_empty(
  $$ select 1 from public.seller_fuentes_declaradas
     where seller_id = 'aaaaaaaa-1111-0000-0000-0000000000d2' $$,
  'seller: seller_multi NO ve las fuentes del seller_solo (mismo tenant, otro seller)'
);

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d2'::uuid, -- seller_solo
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-0000000000d2'::uuid
);
select results_eq(
  $$ select count(*)::int from public.seller_fuentes_declaradas $$,
  $$ values (1) $$,
  'seller: seller_solo ve solo su fuente'
);

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d5'::uuid, -- conductor A
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-0000000000d1'::uuid
);
select is_empty(
  $$ select 1 from public.seller_fuentes_declaradas $$,
  'seller: un conductor ve CERO fuentes declaradas'
);

-- Escritura: el interno SÍ escribe las de su tenant; el seller NO; cruzar tenant NO.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d3'::uuid, -- interno A
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'interno', 'dueno'
);
select lives_ok(
  $$ insert into identidad.seller_fuentes_declaradas (tenant_id, seller_id, fuente, estado)
     values ('aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-1111-0000-0000-0000000000d2',
             'ml_flex', 'pendiente') $$,
  'escritura: el interno A declara una fuente para un seller de SU tenant'
);
select throws_ok(
  $$ insert into identidad.seller_fuentes_declaradas (tenant_id, seller_id, fuente, estado)
     values ('bbbbbbbb-0000-0000-0000-0000000000d2', 'bbbbbbbb-1111-0000-0000-0000000000d2',
             'shopify', 'pendiente') $$,
  '42501', null,
  'escritura: el interno A NO puede escribir en el tenant B (with check + claim)'
);

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid, -- seller_multi
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-0000000000d1'::uuid
);
-- El seller VE su fila (P2), así que sin el guard este UPDATE sería "0 filas"
-- silencioso y la interfaz diría "guardado".
select throws_ok(
  $$ update identidad.seller_fuentes_declaradas set estado = 'conectada'
      where seller_id = 'aaaaaaaa-1111-0000-0000-0000000000d1' and fuente = 'ml_flex' $$,
  '42501', null,
  'escritura: el seller NO puede editar su propia fuente declarada (42501 explícito por el guard)'
);

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d5'::uuid, -- conductor A
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-0000000000d1'::uuid
);
select throws_ok(
  $$ update identidad.seller_fuentes_declaradas set estado = 'conectada' $$,
  '42501', null,
  'escritura: un conductor NO puede escribir seller_fuentes_declaradas'
);

select test_cerrar_sesion();

select * from finish();

rollback;
