-- =============================================================================
-- Pruebas de aislamiento RLS — bodegas (etapas 2 y 2b de "retiro + ruteo")
-- =============================================================================
-- Demuestra, contra un Postgres real (no mocks de aplicación), que:
--
--   1. Un courier NO puede leer las bodegas de otro. En las DOS direcciones:
--      A no ve nada de B y B no ve nada de A (una política mal escrita puede
--      aislar en un sentido y no en el otro).
--   2. Un seller ve SOLO sus propias bodegas — ni las de otro seller del mismo
--      courier, ni ningún dato interno: `courier_bodegas` le da CERO filas.
--   3. El conductor ve CERO en ambas tablas. Es la prueba que atrapa la forma
--      `tipo_usuario <> 'seller'`, que ya se coló dos veces en este repo
--      (20260101000002:132-140, 20260101000004:236-241) y que dejaría el
--      domicilio y el teléfono de TODAS las bodegas de TODOS los sellers a la
--      vista de cualquier usuario-conductor.
--   4. El seller no puede escribir: INSERT / UPDATE / DELETE devuelven 42501
--      explícito (no el "0 filas" silencioso que deja a la interfaz diciendo
--      "guardado" sin haber guardado).
--   5. Nadie —ni siquiera un interno— puede borrar: DELETE está revocado a
--      nivel de privilegio en tabla base y vista. La baja es `activa = false`.
--   6. Los índices parciales de `es_principal` impiden dos bodegas principales
--      del mismo seller / del mismo courier, y están acotados al alcance
--      correcto (por seller, no por tenant, en seller_bodegas).
--
-- Mecanismo idéntico al resto de la suite (rls_aislamiento_ventanas_corte,
-- _operacion, _geocoding): se simula el JWT fijando `request.jwt.claims` y
-- conmutando el rol a `authenticated`.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(35);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada (redefinidos aquí — cada .test.sql corre en su
-- propia transacción y no ve los helpers de los demás).
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
-- Fixtures. Dos couriers:
--   Tenant A · 3 sellers (A1 con 2 bodegas, A2 con 1, A3 sin ninguna — un seller
--              sin bodegas es un estado legítimo y hace falta para probar el
--              alcance del índice de principal) + 2 bodegas propias del courier.
--   Tenant B · 1 seller con 1 bodega + 1 bodega propia. Existe para que el
--              aislamiento cruzado tenga algo real que NO ver.
-- Se insertan como `postgres` (superusuario: bypassa RLS).
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-0000000000b1';

  s_a1 uuid := 'aaaaaaaa-1111-0000-0000-0000000000a1';
  s_a2 uuid := 'aaaaaaaa-1111-0000-0000-0000000000a2';
  s_a3 uuid := 'aaaaaaaa-1111-0000-0000-0000000000a3';
  s_b1 uuid := 'bbbbbbbb-1111-0000-0000-0000000000b1';

  c_a1 uuid := 'aaaaaaaa-2222-0000-0000-0000000000a1';

  u_interno_a   uuid := 'aaaaaaaa-3333-0000-0000-0000000000a1';
  u_seller_a1   uuid := 'aaaaaaaa-3333-0000-0000-0000000000a2';
  u_conductor_a uuid := 'aaaaaaaa-3333-0000-0000-0000000000a3';
  u_interno_b   uuid := 'bbbbbbbb-3333-0000-0000-0000000000b1';

  sb_a1_1 uuid := 'aaaaaaaa-9999-0000-0000-0000000000a1';
  sb_a1_2 uuid := 'aaaaaaaa-9999-0000-0000-0000000000a2';
  sb_a2_1 uuid := 'aaaaaaaa-9999-0000-0000-0000000000a3';
  sb_b1_1 uuid := 'bbbbbbbb-9999-0000-0000-0000000000b1';

  cb_a1 uuid := 'aaaaaaaa-8888-0000-0000-0000000000a1';
  cb_a2 uuid := 'aaaaaaaa-8888-0000-0000-0000000000a2';
  cb_b1 uuid := 'bbbbbbbb-8888-0000-0000-0000000000b1';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier A', 'Courier A SpA', '76911111-1', 'activo'),
    (t_b, 'Courier B', 'Courier B SpA', '76922222-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_interno_a,   'interno.a@bodegas.test',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a1,   'seller.a1@bodegas.test',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a, 'conductor.a@bodegas.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_interno_b,   'interno.b@bodegas.test',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a1, t_a, 'Seller A1', '77911111-1', 'Contacto A1', 'a1@seller.test', 'activo'),
    (s_a2, t_a, 'Seller A2', '77922222-2', 'Contacto A2', 'a2@seller.test', 'activo'),
    (s_a3, t_a, 'Seller A3', '77933333-3', 'Contacto A3', 'a3@seller.test', 'activo'),
    (s_b1, t_b, 'Seller B1', '77944444-4', 'Contacto B1', 'b1@seller.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values
    (c_a1, t_a, 'Conductor A1', '78911111-1', 'dependiente', 'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a,   t_a, 'Interno A',   'interno',   null, null, 'dueno',     'activo'),
    (u_seller_a1,   t_a, 'Seller A1',   'seller',    s_a1, null, 'seller',    'activo'),
    (u_conductor_a, t_a, 'Conductor A', 'conductor', null, c_a1, 'conductor', 'activo'),
    (u_interno_b,   t_b, 'Interno B',   'interno',   null, null, 'dueno',     'activo')
  on conflict (id) do nothing;

  -- Bodegas de sellers. Datos de contacto poblados a propósito: son justamente
  -- lo que NO debe cruzar de seller a seller ni llegar al conductor.
  insert into identidad.seller_bodegas
    (id, tenant_id, seller_id, nombre, direccion, comuna, instrucciones_acceso,
     contacto_nombre, contacto_telefono, es_principal, activa)
  values
    (sb_a1_1, t_a, s_a1, 'Bodega Quilicura', 'Av. Industrial 1200', 'Quilicura',
     'Portón azul, tocar timbre', 'Jefe A1', '+56911111111', true,  true),
    (sb_a1_2, t_a, s_a1, 'Local Centro',     'Bandera 340',        'Santiago',
     null, 'Vendedor A1', '+56922222222', false, true),
    (sb_a2_1, t_a, s_a2, 'Bodega Pudahuel',  'Camino Lo Boza 500', 'Pudahuel',
     null, 'Jefe A2', '+56933333333', true,  true),
    (sb_b1_1, t_b, s_b1, 'Bodega Maipú',     'Camino Melipilla 90','Maipú',
     null, 'Jefe B1', '+56944444444', true,  true)
  on conflict (id) do nothing;

  -- Bodegas del courier (origen de ruta). Dato interno.
  insert into identidad.courier_bodegas
    (id, tenant_id, nombre, direccion, comuna, instrucciones_acceso, es_principal, activa)
  values
    (cb_a1, t_a, 'Central A',   'Panamericana Norte 5000', 'Conchalí', 'Andén 3', true,  true),
    (cb_a2, t_a, 'Satélite A',  'Los Libertadores 77',     'Colina',   null,      false, true),
    (cb_b1, t_b, 'Central B',   'Ruta 68 km 12',           'Pudahuel', null,      true,  true)
  on conflict (id) do nothing;
end $$;

-- =============================================================================
-- BLOQUE 1 · Cross-tenant: el interno del courier A no ve nada del courier B
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000a1'::uuid, -- u_interno_a
  'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, -- t_a
  'interno', 'dueno'
);

select is_empty(
  $$ select 1 from public.seller_bodegas
      where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000000b1' $$,
  'P1 seller_bodegas: el interno del courier A NO ve ninguna bodega de sellers del courier B'
);

select is_empty(
  $$ select 1 from public.courier_bodegas
      where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000000b1' $$,
  'P1 courier_bodegas: el interno del courier A NO ve las bodegas del courier B'
);

select results_eq(
  $$ select count(*)::int from public.seller_bodegas $$,
  $$ values (3) $$,
  'P1 seller_bodegas: el interno de A ve exactamente sus 3 bodegas de seller (2 de A1 + 1 de A2)'
);

select results_eq(
  $$ select count(*)::int from public.courier_bodegas $$,
  $$ values (2) $$,
  'P1 courier_bodegas: el interno de A ve exactamente sus 2 bodegas propias'
);

-- =============================================================================
-- BLOQUE 2 · El espejo: el interno del courier B no ve nada del courier A
-- =============================================================================
-- Se prueba en las DOS direcciones a propósito: una condición mal escrita puede
-- aislar en un sentido y filtrar en el otro, y solo esta mitad lo detecta.
select test_iniciar_sesion(
  'bbbbbbbb-3333-0000-0000-0000000000b1'::uuid, -- u_interno_b
  'bbbbbbbb-0000-0000-0000-0000000000b1'::uuid, -- t_b
  'interno', 'dueno'
);

select is_empty(
  $$ select 1 from public.seller_bodegas
      where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' $$,
  'P1 seller_bodegas: el interno del courier B NO ve ninguna bodega de sellers del courier A'
);

select is_empty(
  $$ select 1 from public.courier_bodegas
      where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' $$,
  'P1 courier_bodegas: el interno del courier B NO ve las bodegas del courier A'
);

select results_eq(
  $$ select count(*)::int from public.seller_bodegas $$,
  $$ values (1) $$,
  'P1 seller_bodegas: el interno de B ve exactamente su única bodega de seller'
);

select results_eq(
  $$ select count(*)::int from public.courier_bodegas $$,
  $$ values (1) $$,
  'P1 courier_bodegas: el interno de B ve exactamente su única bodega propia'
);

-- =============================================================================
-- BLOQUE 3 · El seller A1: solo lo suyo, y nada interno del courier
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000a2'::uuid, -- u_seller_a1
  'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-0000000000a1'::uuid -- s_a1
);

select results_eq(
  $$ select count(*)::int from public.seller_bodegas $$,
  $$ values (2) $$,
  'P2 seller_bodegas: el seller A1 ve exactamente SUS 2 bodegas, ninguna más'
);

select is_empty(
  $$ select 1 from public.seller_bodegas
      where seller_id = 'aaaaaaaa-1111-0000-0000-0000000000a2' $$, -- s_a2
  'P2 seller_bodegas: el seller A1 NO ve la bodega del seller A2 (mismo courier, otro seller)'
);

select is_empty(
  $$ select 1 from public.courier_bodegas $$,
  'P2 courier_bodegas: el seller NO ve NINGUNA bodega del courier (desde qué galpón opera su proveedor no es información suya)'
);

select isnt_empty(
  $$ select direccion, contacto_telefono from public.seller_bodegas
      where id = 'aaaaaaaa-9999-0000-0000-0000000000a1' and es_principal $$,
  'P2 seller_bodegas: el seller A1 SÍ ve su propia bodega principal (la política no lo deja fuera de todo)'
);

select throws_ok(
  $$ insert into public.seller_bodegas (tenant_id, seller_id, nombre, direccion, comuna)
     values ('aaaaaaaa-0000-0000-0000-0000000000a1',
             'aaaaaaaa-1111-0000-0000-0000000000a1',
             'Bodega Fantasma', 'Calle Falsa 123', 'Santiago') $$,
  '42501',
  null,
  'Escritura seller: el seller NO puede INSERT en seller_bodegas (las carga el courier)'
);

select throws_ok(
  $$ update public.seller_bodegas set direccion = 'Otra dirección'
      where id = 'aaaaaaaa-9999-0000-0000-0000000000a1' $$,
  '42501',
  null,
  'Escritura seller: el seller NO puede UPDATE su propia bodega — 42501 explícito, no "0 filas" silencioso (guard solo_interno_edita)'
);

select throws_ok(
  $$ delete from public.seller_bodegas
      where id = 'aaaaaaaa-9999-0000-0000-0000000000a1' $$,
  '42501',
  null,
  'Escritura seller: el seller NO puede DELETE su propia bodega (privilegio revocado; la baja es activa = false)'
);

select throws_ok(
  $$ insert into public.courier_bodegas (tenant_id, nombre, direccion, comuna)
     values ('aaaaaaaa-0000-0000-0000-0000000000a1', 'Central Pirata', 'Calle Falsa 456', 'Santiago') $$,
  '42501',
  null,
  'Escritura seller: el seller NO puede INSERT en courier_bodegas'
);

select throws_ok(
  $$ update public.courier_bodegas set direccion = 'Otra'
      where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' $$,
  '42501',
  null,
  'Escritura seller: el seller NO puede UPDATE courier_bodegas (guard solo_interno_edita)'
);

select throws_ok(
  $$ delete from public.courier_bodegas
      where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' $$,
  '42501',
  null,
  'Escritura seller: el seller NO puede DELETE courier_bodegas'
);

-- =============================================================================
-- BLOQUE 4 · El conductor: cero en ambas tablas
-- =============================================================================
-- ESTA es la prueba que atrapa la forma `tipo_usuario <> 'seller'`. Si la
-- política de seller_bodegas se escribiera así, el conductor pasaría el filtro
-- (su tipo_usuario tampoco es 'seller') y se llevaría la dirección, el contacto
-- y el teléfono de TODAS las bodegas de TODOS los sellers del courier.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000a3'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-0000000000a1'::uuid -- c_a1
);

select is_empty(
  $$ select 1 from public.seller_bodegas $$,
  'P3 seller_bodegas: el conductor ve CERO bodegas de seller (su punto de retiro llega por endpoint Bearer con DTO mínimo, no por esta tabla)'
);

select is_empty(
  $$ select 1 from public.courier_bodegas $$,
  'P3 courier_bodegas: el conductor ve CERO bodegas del courier'
);

select throws_ok(
  $$ update public.seller_bodegas set direccion = 'Hack'
      where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000a1' $$,
  '42501',
  null,
  'Escritura conductor: el conductor NO puede UPDATE seller_bodegas (guard solo_interno_edita)'
);

select throws_ok(
  $$ insert into public.courier_bodegas (tenant_id, nombre, direccion, comuna)
     values ('aaaaaaaa-0000-0000-0000-0000000000a1', 'Central Hack', 'Calle Falsa 789', 'Santiago') $$,
  '42501',
  null,
  'Escritura conductor: el conductor NO puede INSERT en courier_bodegas'
);

-- =============================================================================
-- BLOQUE 5 · Privilegios: NADIE borra desde una sesión de usuario
-- =============================================================================
-- Independiente de RLS, y por eso importa: si el revoke de la migración no
-- tomara efecto, el DELETE quedaría gobernado SOLO por la ausencia de política
-- — es decir, "0 filas" en silencio en vez de un error. Y lo que una vista nace
-- teniendo en `public` depende del rol que la crea: el default ACL de `postgres`
-- no da DML, pero el de `supabase_admin` otorga `arwdDxtm`, DELETE incluido.
select test_cerrar_sesion();

select is(
  has_table_privilege('authenticated', 'identidad.seller_bodegas', 'DELETE'),
  false,
  'Privilegios: authenticated NO tiene DELETE sobre identidad.seller_bodegas (la baja es activa = false)'
);

select is(
  has_table_privilege('authenticated', 'public.seller_bodegas', 'DELETE'),
  false,
  'Privilegios: authenticated NO tiene DELETE sobre la vista public.seller_bodegas'
);

select is(
  has_table_privilege('authenticated', 'identidad.courier_bodegas', 'DELETE'),
  false,
  'Privilegios: authenticated NO tiene DELETE sobre identidad.courier_bodegas'
);

select is(
  has_table_privilege('authenticated', 'public.courier_bodegas', 'DELETE'),
  false,
  'Privilegios: authenticated NO tiene DELETE sobre la vista public.courier_bodegas'
);

-- =============================================================================
-- BLOQUE 6 · Integridad del modelo: una sola principal, y del alcance correcto
-- =============================================================================
-- Se ejecuta como `postgres` (bypassa RLS) para aislar lo que se mide: estas son
-- garantías de esquema, no de política. Van al final porque mutan datos.

select throws_ok(
  $$ insert into identidad.seller_bodegas (tenant_id, seller_id, nombre, direccion, comuna, es_principal)
     values ('aaaaaaaa-0000-0000-0000-0000000000a1',
             'aaaaaaaa-1111-0000-0000-0000000000a1',
             'Segunda Principal A1', 'Calle Dos 200', 'Renca', true) $$,
  '23505',
  null,
  'seller_bodegas_principal_uk: un seller NO puede tener dos bodegas principales'
);

select lives_ok(
  $$ insert into identidad.seller_bodegas (tenant_id, seller_id, nombre, direccion, comuna, es_principal)
     values ('aaaaaaaa-0000-0000-0000-0000000000a1',
             'aaaaaaaa-1111-0000-0000-0000000000a3',
             'Bodega A3', 'Calle Tres 300', 'Renca', true) $$,
  'seller_bodegas_principal_uk: OTRO seller del mismo courier SÍ puede tener la suya (el índice es por (tenant, seller), no por tenant)'
);

select throws_ok(
  $$ update identidad.courier_bodegas set es_principal = true
      where id = 'aaaaaaaa-8888-0000-0000-0000000000a2' $$,
  '23505',
  null,
  'courier_bodegas_principal_uk: un courier NO puede tener dos bodegas principales (también al MARCAR una segunda, que es el camino real de la interfaz)'
);

select throws_ok(
  $$ insert into identidad.courier_bodegas (tenant_id, nombre, direccion, comuna, es_principal)
     values ('aaaaaaaa-0000-0000-0000-0000000000a1', 'Central Duplicada', 'Otra 1', 'Colina', true) $$,
  '23505',
  null,
  'courier_bodegas_principal_uk: tampoco al INSERTAR una segunda principal en el mismo courier'
);

select throws_ok(
  $$ update identidad.seller_bodegas set activa = false
      where id = 'aaaaaaaa-9999-0000-0000-0000000000a1' $$,
  '23514',
  null,
  'seller_bodegas_principal_debe_estar_activa: no se puede dar de baja la bodega principal sin antes traspasar la marca'
);

select throws_ok(
  $$ update identidad.courier_bodegas set activa = false
      where id = 'aaaaaaaa-8888-0000-0000-0000000000a1' $$,
  '23514',
  null,
  'courier_bodegas_principal_debe_estar_activa: no se puede dar de baja la bodega principal del courier sin traspasar la marca'
);

select throws_ok(
  $$ update identidad.seller_bodegas set geo_estado = 'casi'
      where id = 'aaaaaaaa-9999-0000-0000-0000000000a2' $$,
  '23514',
  null,
  'seller_bodegas_geo_estado_valido: el CHECK fija los cuatro valores del contrato del puerto de geocoding'
);

-- La FK compuesta (tenant_id, seller_id) es la que impide que una bodega de un
-- courier apunte a un seller de otro. Sin ella, la fila quedaría visible para el
-- courier equivocado por su tenant_id y para el seller equivocado por su seller_id.
select throws_ok(
  $$ insert into identidad.seller_bodegas (tenant_id, seller_id, nombre, direccion, comuna)
     values ('aaaaaaaa-0000-0000-0000-0000000000a1',
             'bbbbbbbb-1111-0000-0000-0000000000b1',
             'Bodega Cruzada', 'Calle Cruzada 1', 'Maipú') $$,
  '23503',
  null,
  'seller_bodegas_seller_pertenece_al_tenant: NO se puede colgar una bodega del courier A de un seller del courier B'
);

-- El nombre único entre las ACTIVAS del mismo seller: dos bodegas vivas con el
-- mismo nombre hacen imposible que el conductor sepa a cuál lo mandan.
select throws_ok(
  $$ insert into identidad.seller_bodegas (tenant_id, seller_id, nombre, direccion, comuna)
     values ('aaaaaaaa-0000-0000-0000-0000000000a1',
             'aaaaaaaa-1111-0000-0000-0000000000a1',
             'Bodega Quilicura', 'Otra dirección 9', 'Quilicura') $$,
  '23505',
  null,
  'seller_bodegas_nombre_activa_uk: dos bodegas ACTIVAS del mismo seller no pueden llamarse igual'
);

select * from finish();

rollback;
