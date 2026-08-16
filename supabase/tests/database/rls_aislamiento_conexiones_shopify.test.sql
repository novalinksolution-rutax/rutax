-- =============================================================================
-- Aislamiento RLS + confidencialidad del token — conexiones_seller_shopify
-- =============================================================================
-- Migración probada:
--   20260816000005_identidad_conexiones_seller_shopify.sql
--
-- Demuestra, contra una base Postgres real (no mocks de aplicación):
--
--   1. AISLAMIENTO — un seller ve EXACTAMENTE sus conexiones Shopify: ninguna de
--      otro seller del mismo tenant, ninguna de otro tenant. El interno ve las de
--      SU tenant y cero del otro. El conductor ve cero.
--
--   2. CONFIDENCIALIDAD DE `token_ref` — LA PRUEBA CENTRAL. No es alcanzable por
--      `authenticated` NI por la vista `public.*` NI por la tabla base del
--      esquema `identidad` (que PostgREST expone directo con Accept-Profile).
--      Si el grant volviera a ser de TABLA COMPLETA, la prueba del bloque 2
--      falla: es exactamente la forma del hallazgo de `snapshot_regla`
--      (20260707000002) y del token de invitación (20260807000001), que este
--      repo ya sufrió dos veces. Mismo trato para `cursor_ingesta_en`.
--
--   3. ESCRITURA — el seller no puede INSERT ni UPDATE (42501 explícito, no
--      "0 filas" silencioso). El interno solo puede tocar alias/filtro_etiqueta/
--      activa: ni salud, ni token, ni alta, ni borrado.
--
--   4. REGLAS DE NEGOCIO EN LA BASE — la misma tienda no se conecta dos veces al
--      mismo courier, pero SÍ puede estar en dos couriers distintos; y el
--      tenant_id denormalizado no puede contradecir al del seller.
--
-- El rol interno elegido para el bloque 2 es `coordinador` A PROPÓSITO: es el
-- caso que más duele, porque es interno legítimo y aun así no tiene por qué ver
-- una credencial de la tienda de un seller.
--
-- Mecanismo idéntico al resto de la suite: se simula el JWT fijando
-- `request.jwt.claims` y conmutando el rol a `authenticated`.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(37);

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
-- Fixtures (como postgres → bypassa RLS; el guard `solo_interno_edita` no se
-- dispara porque auth.role() es NULL sin claims).
--   Tenant A: seller A con 2 tiendas Shopify + seller A2 con 1.
--   Tenant B: seller B con 1.
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-0000000000c1';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-0000000000c2';

  s_a  uuid := 'aaaaaaaa-1111-0000-0000-0000000000c1'; -- seller A (2 tiendas)
  s_a2 uuid := 'aaaaaaaa-1111-0000-0000-0000000000c3'; -- seller A2 (1 tienda)
  s_b  uuid := 'bbbbbbbb-1111-0000-0000-0000000000c2'; -- seller B (1 tienda)

  u_interno_a uuid := 'aaaaaaaa-3333-0000-0000-0000000000c1';
  u_coord_a   uuid := 'aaaaaaaa-3333-0000-0000-0000000000c2';
  u_seller_a  uuid := 'aaaaaaaa-3333-0000-0000-0000000000c3';
  u_seller_a2 uuid := 'aaaaaaaa-3333-0000-0000-0000000000c4';
  u_seller_b  uuid := 'bbbbbbbb-3333-0000-0000-0000000000c5';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier Shopify A', 'Courier Shopify A SpA', '76444444-4', 'activo'),
    (t_b, 'Courier Shopify B', 'Courier Shopify B SpA', '76555555-5', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_interno_a, 'interno.a@shopify.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_coord_a,   'coord.a@shopify.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,  'seller.a@shopify.test',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a2, 'seller.a2@shopify.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_b,  'seller.b@shopify.test',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a,  t_a, 'Seller Shopify A',  '77444444-4', 'Contacto A',  'a@sellershopify.test',  'activo'),
    (s_a2, t_a, 'Seller Shopify A2', '77555555-5', 'Contacto A2', 'a2@sellershopify.test', 'activo'),
    (s_b,  t_b, 'Seller Shopify B',  '77666666-6', 'Contacto B',  'b@sellershopify.test',  'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a, t_a, 'Interno A',         'interno', null, null, 'dueno',       'activo'),
    (u_coord_a,   t_a, 'Coordinador A',     'interno', null, null, 'coordinador', 'activo'),
    (u_seller_a,  t_a, 'Usuario Seller A',  'seller',  s_a,  null, 'seller',      'activo'),
    (u_seller_a2, t_a, 'Usuario Seller A2', 'seller',  s_a2, null, 'seller',      'activo'),
    (u_seller_b,  t_b, 'Usuario Seller B',  'seller',  s_b,  null, 'seller',      'activo')
  on conflict (id) do nothing;

  -- Las conexiones. `token_ref` con valor en todas: si estuviera NULL, una fuga
  -- de la columna no se notaría al leerla.
  insert into identidad.conexiones_seller_shopify
    (id, tenant_id, seller_id, shop_domain, token_ref, scopes_otorgados,
     filtro_etiqueta, cursor_ingesta_en, estado_salud, alias, nombre_tienda)
  values
    ('aaaaaaaa-4444-0000-0000-0000000000c1', t_a, s_a,  'tienda-a1.myshopify.com',
     'aaaaaaaa-5555-0000-0000-0000000000c1', array['read_orders','write_fulfillments'],
     'despacho-rutax', now() - interval '1 hour', 'sana', 'Tienda oficial', 'Tienda A1'),
    ('aaaaaaaa-4444-0000-0000-0000000000c2', t_a, s_a,  'tienda-a2.myshopify.com',
     'aaaaaaaa-5555-0000-0000-0000000000c2', array['read_orders'],
     null, null, 'pendiente', 'Outlet', 'Tienda A2'),
    ('aaaaaaaa-4444-0000-0000-0000000000c3', t_a, s_a2, 'tienda-a3.myshopify.com',
     'aaaaaaaa-5555-0000-0000-0000000000c3', array['read_orders'],
     null, null, 'sana', null, 'Tienda A3'),
    ('bbbbbbbb-4444-0000-0000-0000000000c4', t_b, s_b,  'tienda-b1.myshopify.com',
     'bbbbbbbb-5555-0000-0000-0000000000c4', array['read_orders'],
     null, null, 'sana', null, 'Tienda B1')
  on conflict do nothing;
end $$;

-- =============================================================================
-- BLOQUE 0 · Contrato de esquema
-- =============================================================================
select has_table('identidad', 'conexiones_seller_shopify',
  'esquema: existe identidad.conexiones_seller_shopify');

-- Enum PROPIO, no el de ML: los modos de falla de una app instalada en Shopify
-- no son los de un OAuth con refresh token, y compartir el tipo haría que un
-- valor nuevo de Shopify ampliara en silencio el dominio de ML.
select has_type('identidad', 'estado_salud_conexion_shopify',
  'esquema: la salud usa su propio enum identidad.estado_salud_conexion_shopify');

-- La confidencialidad se logra con PRIVILEGIOS, no borrando la columna.
select has_column('identidad', 'conexiones_seller_shopify', 'token_ref',
  'esquema: la tabla base conserva token_ref (se protege con privilegios, no borrándola)');

-- Cursor separado de la marca de salud (lección de 20260813000001): si vivieran
-- en la misma columna, una reconexión empujaría el cursor sin haber ingerido y
-- ese hueco de pedidos se perdería en silencio.
select has_column('identidad', 'conexiones_seller_shopify', 'cursor_ingesta_en',
  'esquema: cursor_ingesta_en es columna PROPIA, separada de ultima_sync_exitosa_en');

select hasnt_column('public', 'conexiones_seller_shopify', 'token_ref',
  'vista: public.conexiones_seller_shopify NO expone token_ref');

select hasnt_column('public', 'conexiones_seller_shopify', 'cursor_ingesta_en',
  'vista: public.conexiones_seller_shopify NO expone cursor_ingesta_en');

select has_column('public', 'conexiones_seller_shopify', 'estado_salud',
  'vista: sigue exponiendo estado_salud (el seller lo ve en su portal)');

select has_column('public', 'conexiones_seller_shopify', 'ultima_sync_exitosa_en',
  'vista: sigue exponiendo ultima_sync_exitosa_en (marca de salud del seller)');

-- unique (tenant_id, id): habilita FK compuestas futuras sin re-migrar.
select isnt_empty(
  $$ select 1 from pg_constraint con
     join pg_class c on c.oid = con.conrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'identidad' and c.relname = 'conexiones_seller_shopify'
      and con.contype = 'u'
      and (
        select array_agg(a.attname::text order by a.attname)
          from unnest(con.conkey) as k(attnum)
          join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
      ) = array['id', 'tenant_id'] $$,
  'esquema: existe unique (tenant_id, id) — FK compuestas futuras sin re-migrar'
);

-- =============================================================================
-- BLOQUE 1 · AISLAMIENTO
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000c3'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-0000000000c1'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-0000000000c1'::uuid -- s_a
);

select results_eq(
  $$ select count(*)::int from public.conexiones_seller_shopify $$,
  $$ values (2) $$,
  'aislamiento: seller A ve EXACTAMENTE sus 2 conexiones Shopify'
);

select results_eq(
  $$ select distinct seller_id::text from public.conexiones_seller_shopify $$,
  $$ values ('aaaaaaaa-1111-0000-0000-0000000000c1') $$,
  'aislamiento: todas las filas visibles del seller A son de su propio seller_id'
);

select is_empty(
  $$ select 1 from public.conexiones_seller_shopify
     where seller_id = 'aaaaaaaa-1111-0000-0000-0000000000c3' $$,
  'aislamiento: seller A NO ve la conexión del seller A2 (mismo tenant, otro seller)'
);

-- Y tampoco por la tabla base del esquema, que PostgREST expone directo.
select is_empty(
  $$ select 1 from identidad.conexiones_seller_shopify
     where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000000c2' $$,
  'aislamiento: seller A NO ve NADA del tenant B, ni golpeando identidad.* directo'
);

select test_iniciar_sesion(
  'bbbbbbbb-3333-0000-0000-0000000000c5'::uuid, -- u_seller_b
  'bbbbbbbb-0000-0000-0000-0000000000c2'::uuid, -- t_b
  'seller', 'seller',
  p_seller_id => 'bbbbbbbb-1111-0000-0000-0000000000c2'::uuid -- s_b
);

select results_eq(
  $$ select count(*)::int from public.conexiones_seller_shopify $$,
  $$ values (1) $$,
  'aislamiento: seller B (otro tenant) ve solo la suya, ninguna de las 3 del tenant A'
);

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000c1'::uuid, -- u_interno_a
  'aaaaaaaa-0000-0000-0000-0000000000c1'::uuid, -- t_a
  'interno', 'dueno'
);

select results_eq(
  $$ select count(*)::int from public.conexiones_seller_shopify $$,
  $$ values (3) $$,
  'aislamiento: interno A ve las 3 conexiones de SU tenant (2 de A + 1 de A2)'
);

select is_empty(
  $$ select 1 from public.conexiones_seller_shopify
     where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000000c2' $$,
  'aislamiento: interno A NO ve conexiones del tenant B'
);

-- El conductor: cero filas. Es la rama que este repo ya olvidó dos veces al
-- escribir la política como `tipo_usuario <> 'seller' or ...`.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000c1'::uuid,
  'aaaaaaaa-0000-0000-0000-0000000000c1'::uuid,
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-0000000000c9'::uuid
);

select is_empty(
  $$ select 1 from public.conexiones_seller_shopify $$,
  'aislamiento: un conductor del tenant A ve CERO conexiones Shopify'
);

-- =============================================================================
-- BLOQUE 2 · CONFIDENCIALIDAD DE token_ref — la prueba central
-- =============================================================================
-- Si el grant fuera de TABLA COMPLETA (el bug que este repo cometió dos veces),
-- las dos pruebas de `identidad.*` de abajo pasarían a `lives_ok` y esta suite
-- se pondría roja. Ese es exactamente su trabajo.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000c3'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-0000000000c1'::uuid,
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-0000000000c1'::uuid
);

select throws_ok(
  $$ select token_ref from public.conexiones_seller_shopify $$,
  '42703',
  null,
  'token: el seller NO llega a token_ref por la vista (columna inexistente en public.*)'
);

select throws_ok(
  $$ select token_ref from identidad.conexiones_seller_shopify $$,
  '42501',
  null,
  'token: el seller NO llega a token_ref golpeando identidad.* directo (privilegio de COLUMNA denegado) — la barrera que la vista NO da'
);

select lives_ok(
  $$ select id, shop_domain, estado_salud, ultima_sync_exitosa_en, filtro_etiqueta
       from public.conexiones_seller_shopify $$,
  'token: el seller SÍ lee las columnas de negocio (cerrar el token no dejó ciega la pantalla)'
);

-- Un interno legítimo tampoco. Coordinador a propósito: no tiene por qué ver
-- una credencial de la tienda de un seller.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000c2'::uuid, -- u_coord_a
  'aaaaaaaa-0000-0000-0000-0000000000c1'::uuid,
  'interno', 'coordinador'
);

select throws_ok(
  $$ select token_ref from identidad.conexiones_seller_shopify $$,
  '42501',
  null,
  'token: un coordinador interno TAMPOCO lee token_ref en la tabla base'
);

select throws_ok(
  $$ select cursor_ingesta_en from identidad.conexiones_seller_shopify $$,
  '42501',
  null,
  'cursor: cursor_ingesta_en es service_role — ni el interno lo lee (es operación, no negocio)'
);

select lives_ok(
  $$ select id, shop_domain, alias, nombre_tienda, scopes_otorgados
       from identidad.conexiones_seller_shopify $$,
  'cursor/token: el interno SÍ lee las columnas de negocio en la tabla base'
);

-- =============================================================================
-- BLOQUE 3 · ESCRITURA
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000c3'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-0000000000c1'::uuid,
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-0000000000c1'::uuid
);

-- Un self-insert del seller conectaría una tienda a su nombre sin pasar por el
-- OAuth: ni siquiera tiene el privilegio.
select throws_ok(
  $$ insert into identidad.conexiones_seller_shopify (tenant_id, seller_id, shop_domain)
     values ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-1111-0000-0000-0000000000c1',
             'tienda-pirata.myshopify.com') $$,
  '42501',
  null,
  'escritura: el seller NO puede INSERT (42501, no un self-insert saltándose el OAuth)'
);

-- El seller SÍ ve su fila (P2), así que sin el guard este UPDATE sería
-- "UPDATE 0" silencioso y la interfaz le diría "guardado".
select throws_ok(
  $$ update identidad.conexiones_seller_shopify set alias = 'mío'
      where id = 'aaaaaaaa-4444-0000-0000-0000000000c1' $$,
  '42501',
  null,
  'escritura: el seller NO puede UPDATE su propia conexión (42501 explícito, no "0 filas")'
);

select throws_ok(
  $$ update identidad.conexiones_seller_shopify
        set token_ref = 'aaaaaaaa-5555-0000-0000-00000000ffff' $$,
  '42501',
  null,
  'escritura: el seller NO puede reapuntar token_ref a otro secreto'
);

select throws_ok(
  $$ delete from identidad.conexiones_seller_shopify $$,
  '42501',
  null,
  'escritura: el seller NO puede DELETE (la baja es activa = false)'
);

-- --- Interno: solo las tres columnas del panel ------------------------------
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000c1'::uuid, -- u_interno_a
  'aaaaaaaa-0000-0000-0000-0000000000c1'::uuid,
  'interno', 'dueno'
);

select lives_ok(
  $$ update identidad.conexiones_seller_shopify
        set alias = 'Tienda principal', filtro_etiqueta = 'rutax', activa = false
      where id = 'aaaaaaaa-4444-0000-0000-0000000000c1' $$,
  'escritura: el interno SÍ edita alias/filtro_etiqueta/activa de su tenant'
);

-- Que un interno pudiera escribir 'sana' a mano es cómo una conexión rota deja
-- de avisar que está rota.
select throws_ok(
  $$ update identidad.conexiones_seller_shopify set estado_salud = 'sana' $$,
  '42501',
  null,
  'escritura: el interno NO puede escribir estado_salud (lo produce un job, no una opinión)'
);

select throws_ok(
  $$ update identidad.conexiones_seller_shopify
        set token_ref = 'aaaaaaaa-5555-0000-0000-00000000ffff' $$,
  '42501',
  null,
  'escritura: el interno NO puede escribir token_ref'
);

select throws_ok(
  $$ insert into identidad.conexiones_seller_shopify (tenant_id, seller_id, shop_domain)
     values ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-1111-0000-0000-0000000000c1',
             'tienda-a9.myshopify.com') $$,
  '42501',
  null,
  'escritura: ni el interno da de alta a mano (la fila y su token nacen juntos en el callback OAuth)'
);

select throws_ok(
  $$ delete from identidad.conexiones_seller_shopify $$,
  '42501',
  null,
  'escritura: el interno NO puede DELETE (borrar deja huérfanos los pedidos ya ingestados)'
);

select test_cerrar_sesion();

-- =============================================================================
-- BLOQUE 4 · Reglas de negocio impuestas por la base
-- =============================================================================
-- Como postgres: bypassa RLS, pero NO los constraints ni los triggers BEFORE.
select throws_ok(
  $$ insert into identidad.conexiones_seller_shopify (tenant_id, seller_id, shop_domain)
     values ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-1111-0000-0000-0000000000c3',
             'tienda-a1.myshopify.com') $$,
  '23505',
  null,
  'unicidad: la MISMA tienda no se conecta dos veces al mismo courier (ni cambiando de seller)'
);

-- Y la otra mitad: quién decide conectarse a dos couriers es el merchant.
select lives_ok(
  $$ insert into identidad.conexiones_seller_shopify (tenant_id, seller_id, shop_domain)
     values ('bbbbbbbb-0000-0000-0000-0000000000c2', 'bbbbbbbb-1111-0000-0000-0000000000c2',
             'tienda-a1.myshopify.com') $$,
  'unicidad: la MISMA tienda en OTRO tenant SE PERMITE (no hay unicidad global de shop_domain)'
);

-- El trigger de consistencia gana a la FK compuesta y nombra los dos tenants.
select throws_ok(
  $$ insert into identidad.conexiones_seller_shopify (tenant_id, seller_id, shop_domain)
     values ('bbbbbbbb-0000-0000-0000-0000000000c2', 'aaaaaaaa-1111-0000-0000-0000000000c1',
             'tienda-cruzada.myshopify.com') $$,
  'P0001',
  null,
  'consistencia: un tenant_id que no es el del seller se rechaza en el trigger, antes de la FK'
);

-- Sin forma canónica, "Tienda.myshopify.com" y "tienda.myshopify.com" serían dos
-- conexiones a la misma tienda, con dos tokens y el mismo pedido entrando dos veces.
select throws_ok(
  $$ insert into identidad.conexiones_seller_shopify (tenant_id, seller_id, shop_domain)
     values ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-1111-0000-0000-0000000000c1',
             'Tienda-A9.myshopify.com') $$,
  '23514',
  null,
  'canonicidad: un shop_domain con mayúsculas se rechaza (la unique es case-sensitive)'
);

-- '' sería indistinguible de "sin filtro" y dejaría al seller con cero pedidos
-- y cero errores.
select throws_ok(
  $$ insert into identidad.conexiones_seller_shopify (tenant_id, seller_id, shop_domain, filtro_etiqueta)
     values ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-1111-0000-0000-0000000000c1',
             'tienda-a8.myshopify.com', '   ') $$,
  '23514',
  null,
  'filtro: una etiqueta vacía/en blanco se rechaza (sería un filtro que no matchea nada, sin error)'
);

select * from finish();

rollback;
