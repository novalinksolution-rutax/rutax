-- =============================================================================
-- Pruebas de aislamiento RLS — retiro en bodega (etapa 3)
-- =============================================================================
-- Migración bajo prueba: 20260813000004_operacion_retiro_sesiones_bultos_qr.sql
-- Diseño: docs/arquitectura/retiro-y-ruteo.md §1.5, §1.7, §2.1.
--
-- QUÉ SE DEMUESTRA, contra un Postgres real y no contra mocks de aplicación
-- (§1.7 del alcance: TODA la superficie del retiro vive en rutas Bearer que usan
-- service_role y por lo tanto SALTAN RLS — la base es la única barrera que no
-- depende de que un filtro del código esté bien escrito):
--
--   1. Un courier NO lee las sesiones ni los bultos de otro. EN LAS DOS
--      DIRECCIONES: una condición mal escrita puede aislar en un sentido y
--      filtrar en el otro, y solo la mitad espejo lo detecta.
--   2. Un conductor ve SOLO sus propias visitas y sus propios bultos — ni los de
--      un colega del mismo courier.
--   3. Un seller ve CERO FILAS EN LAS TRES TABLAS. El retiro es logística
--      interna: la visita de un conductor lleva bultos de VARIOS sellers, así que
--      una rama P2 le mostraría el ritmo y los faltantes de la operación completa
--      del courier y, por el seller del bulto, de sus competidores en la misma van.
--   4. `operacion.bultos_retiro_qr` es DENY-ALL de verdad: cero políticas,
--      privilegio revocado (42501 explícito, no "0 filas") y SIN vista en `public`.
--      Es la tabla del string del QR: credencial-símil e IRRECUPERABLE, porque
--      hash_code es una firma de ML que no se puede recalcular y la etiqueta no se
--      reimprime una vez retirado el bulto.
--   5. Ningún rol de cliente ESCRIBE en ninguna de las tres.
--   6. Las DOS idempotencias de bultos_retiro, que hacen cosas distintas: por
--      escaneo_id (reintento del lote) y por (sesión, código) (doble escaneo
--      físico). Un duplicado infla el acta, y el acta es lo que se le paga al
--      conductor por la visita.
--   7. El trigger rechazando un pedido de OTRO TENANT — el chequeo que le falta
--      al molde cierres_conductor y que aquí importa porque las dos funciones
--      escriben sobre operacion.pedidos con BYPASSRLS.
--   8. Las dos funciones: cierre transaccional idempotente, 42501 ante conductor
--      ajeno, y el paso de situacion_retiro también cuando el bulto se resuelve
--      DESPUÉS del cierre (sin eso, un bulto que va arriba de la van nunca llega
--      a la bandeja de asignación).
--
-- Mecanismo idéntico al resto de la suite: se simula el JWT fijando
-- `request.jwt.claims` y conmutando el rol con `set local role authenticated`.
-- Los fixtures se insertan como `postgres` (bypassa RLS).
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(62);

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

-- =============================================================================
-- Fixtures — DOS couriers, ambos CON DATOS PROPIOS
--
-- Si el tenant B estuviera vacío, "A no ve nada de B" pasaría por ausencia y no
-- probaría ningún aislamiento.
--
-- Tenant A (cccccccc…):
--   · sellers S_A1 y S_A2, con una bodega cada uno
--   · conductores D_A1 y D_A2  → cruce conductor↔conductor dentro del courier
--   · sesiones: SES_A1 (D_A1, bodega A1, hoy, ABIERTA)
--               SES_A2 (D_A2, bodega A2, hoy, ABIERTA)
--               SES_A3 (D_A1, bodega A1, AYER, CERRADA)  ← el escaneo tardío
--   · bultos:   BU_A1 (SES_A1, flex_qr, casado con P_A1)
--               BU_A2 (SES_A1, DESCONOCIDO — el ilegible que igual se guarda)
--               BU_A3 (SES_A2, flex_qr, casado con P_A2)
--               BU_A4 (SES_A3, flex_qr, SIN casar) ← lo resuelve la función
--   · QR: uno por cada bulto flex de A
--
-- Tenant B (dddddddd…): un seller, un conductor, una bodega, una sesión abierta,
--   un bulto casado con su pedido y su fila de QR.
--
-- Prefijos cccccccc/dddddddd para no chocar con los fixtures de los demás
-- archivos de la suite ni con el seed de demo.
-- =============================================================================
do $$
declare
  t_a uuid := 'cccccccc-0000-0000-0000-0000000000a1';
  t_b uuid := 'dddddddd-0000-0000-0000-0000000000b1';

  s_a1 uuid := 'cccccccc-1111-0000-0000-0000000000a1';
  s_a2 uuid := 'cccccccc-1111-0000-0000-0000000000a2';
  s_b1 uuid := 'dddddddd-1111-0000-0000-0000000000b1';

  d_a1 uuid := 'cccccccc-2222-0000-0000-0000000000a1';
  d_a2 uuid := 'cccccccc-2222-0000-0000-0000000000a2';
  d_b1 uuid := 'dddddddd-2222-0000-0000-0000000000b1';

  u_interno_a    uuid := 'cccccccc-3333-0000-0000-0000000000a1';
  u_seller_a1    uuid := 'cccccccc-3333-0000-0000-0000000000a2';
  u_conductor_a1 uuid := 'cccccccc-3333-0000-0000-0000000000a3';
  u_conductor_a2 uuid := 'cccccccc-3333-0000-0000-0000000000a4';
  u_interno_b    uuid := 'dddddddd-3333-0000-0000-0000000000b1';

  sb_a1 uuid := 'cccccccc-9999-0000-0000-0000000000a1';
  sb_a2 uuid := 'cccccccc-9999-0000-0000-0000000000a2';
  sb_b1 uuid := 'dddddddd-9999-0000-0000-0000000000b1';

  p_a1 uuid := 'cccccccc-6666-0000-0000-0000000000a1';
  p_a2 uuid := 'cccccccc-6666-0000-0000-0000000000a2';
  p_a3 uuid := 'cccccccc-6666-0000-0000-0000000000a3';
  p_b1 uuid := 'dddddddd-6666-0000-0000-0000000000b1';

  ses_a1 uuid := 'cccccccc-7777-0000-0000-0000000000a1';
  ses_a2 uuid := 'cccccccc-7777-0000-0000-0000000000a2';
  ses_a3 uuid := 'cccccccc-7777-0000-0000-0000000000a3';
  ses_b1 uuid := 'dddddddd-7777-0000-0000-0000000000b1';

  bu_a1 uuid := 'cccccccc-8888-0000-0000-0000000000a1';
  bu_a2 uuid := 'cccccccc-8888-0000-0000-0000000000a2';
  bu_a3 uuid := 'cccccccc-8888-0000-0000-0000000000a3';
  bu_a4 uuid := 'cccccccc-8888-0000-0000-0000000000a4';
  bu_b1 uuid := 'dddddddd-8888-0000-0000-0000000000b1';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier Bodega A', 'Courier Bodega A SpA', '76707071-1', 'activo'),
    (t_b, 'Courier Bodega B', 'Courier Bodega B SpA', '76707072-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          created_at, updated_at, raw_app_meta_data,
                          raw_user_meta_data, aud, role)
  values
    (u_interno_a,    'interno.a@bodega.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a1,    'seller.a1@bodega.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a1, 'conductor.a1@bodega.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a2, 'conductor.a2@bodega.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_interno_b,    'interno.b@bodega.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a1, t_a, 'Seller Bodega A1', '77707071-1', 'Contacto A1', 'a1@bodega.test', 'activo'),
    (s_a2, t_a, 'Seller Bodega A2', '77707072-2', 'Contacto A2', 'a2@bodega.test', 'activo'),
    (s_b1, t_b, 'Seller Bodega B1', '77707073-3', 'Contacto B1', 'b1@bodega.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values
    (d_a1, t_a, 'Conductor Bodega A1', '78707071-1', 'dependiente',   'activo'),
    (d_a2, t_a, 'Conductor Bodega A2', '78707072-2', 'independiente', 'activo'),
    (d_b1, t_b, 'Conductor Bodega B1', '78707073-3', 'dependiente',   'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a,    t_a, 'Interno Bodega A',     'interno',   null, null, 'dueno',     'activo'),
    (u_seller_a1,    t_a, 'Usuario Seller A1',    'seller',    s_a1, null, 'seller',    'activo'),
    (u_conductor_a1, t_a, 'Usuario Conductor A1', 'conductor', null, d_a1, 'conductor', 'activo'),
    (u_conductor_a2, t_a, 'Usuario Conductor A2', 'conductor', null, d_a2, 'conductor', 'activo'),
    (u_interno_b,    t_b, 'Interno Bodega B',     'interno',   null, null, 'dueno',     'activo')
  on conflict (id) do nothing;

  insert into identidad.seller_bodegas (id, tenant_id, seller_id, nombre, direccion, comuna, es_principal, activa)
  values
    (sb_a1, t_a, s_a1, 'Bodega A1', 'Av. Industrial 1', 'Quilicura', true, true),
    (sb_a2, t_a, s_a2, 'Bodega A2', 'Camino Lo Boza 2', 'Pudahuel',  true, true),
    (sb_b1, t_b, s_b1, 'Bodega B1', 'Camino Melipilla 3', 'Maipu',   true, true)
  on conflict (id) do nothing;

  -- Todos los pedidos nacen `pendiente`: son candidatos hasta que un escaneo los
  -- ponga en poder del courier. Es la reja de 20260812000002.
  insert into operacion.pedidos (
    id, tenant_id, seller_id, tipo_pedido, origen, ml_shipment_id, estado,
    destinatario_nombre, destinatario_direccion, destinatario_comuna,
    situacion_retiro)
  values
    (p_a1, t_a, s_a1, 'flex', 'backfill', 'SHIPBODA1', 'pendiente_asignacion',
     'Destinatario A1', 'Calle Bodega A 1', 'Santiago', 'pendiente'),
    (p_a2, t_a, s_a2, 'flex', 'backfill', 'SHIPBODA2', 'pendiente_asignacion',
     'Destinatario A2', 'Calle Bodega A 2', 'Providencia', 'pendiente'),
    (p_a3, t_a, s_a1, 'flex', 'backfill', 'SHIPBODA3', 'pendiente_asignacion',
     'Destinatario A3', 'Calle Bodega A 3', 'Renca', 'pendiente'),
    (p_b1, t_b, s_b1, 'flex', 'backfill', 'SHIPBODB1', 'pendiente_asignacion',
     'Destinatario B1', 'Calle Bodega B 1', 'Vitacura', 'pendiente')
  on conflict (id) do nothing;

  -- Sesiones. SES_A3 nace ABIERTA y se cierra más abajo con un UPDATE: el
  -- trigger prohíbe insertar un bulto normal en una sesión ya cerrada, así que
  -- el orden real de la operación es el único que la base acepta.
  insert into operacion.sesiones_retiro
    (id, tenant_id, bodega_id, seller_id, conductor_id, fecha_operacion, estado)
  values
    (ses_a1, t_a, sb_a1, s_a1, d_a1, date '2026-08-13', 'abierta'),
    (ses_a2, t_a, sb_a2, s_a2, d_a2, date '2026-08-13', 'abierta'),
    (ses_a3, t_a, sb_a1, s_a1, d_a1, date '2026-08-12', 'abierta'),
    (ses_b1, t_b, sb_b1, s_b1, d_b1, date '2026-08-13', 'abierta')
  on conflict (id) do nothing;

  insert into operacion.bultos_retiro
    (id, tenant_id, sesion_retiro_id, conductor_id, escaneo_id, codigo_formato,
     codigo_normalizado, muestra_codigo, ml_shipment_id, pedido_id, seller_id,
     escaneado_en, resuelto_en)
  values
    (bu_a1, t_a, ses_a1, d_a1, 'cccccccc-4444-0000-0000-0000000000a1', 'flex_qr',
     'SHIPBODA1', null, 'SHIPBODA1', p_a1, s_a1, now(), now()),
    -- El ilegible. SE GUARDA IGUAL: perder un escaneo es irreversible.
    (bu_a2, t_a, ses_a1, d_a1, 'cccccccc-4444-0000-0000-0000000000a2', 'desconocido',
     'BASURA-ILEGIBLE-A1', 'BASURA-ILEG', null, null, null, now(), null),
    (bu_a3, t_a, ses_a2, d_a2, 'cccccccc-4444-0000-0000-0000000000a3', 'flex_qr',
     'SHIPBODA2', null, 'SHIPBODA2', p_a2, s_a2, now(), now()),
    -- Escaneado pero SIN casar contra la ingesta: lo resuelve la función, ya con
    -- la visita cerrada. Es el caso que se descubre en producción si falta.
    (bu_a4, t_a, ses_a3, d_a1, 'cccccccc-4444-0000-0000-0000000000a4', 'flex_qr',
     'SHIPBODA3', null, 'SHIPBODA3', null, null, now(), null),
    (bu_b1, t_b, ses_b1, d_b1, 'dddddddd-4444-0000-0000-0000000000b1', 'flex_qr',
     'SHIPBODB1', null, 'SHIPBODB1', p_b1, s_b1, now(), now())
  on conflict (id) do nothing;

  -- SES_A3 se cierra: acta de 1 bulto, 0 resueltos, 1 sin resolver.
  update operacion.sesiones_retiro
     set estado = 'cerrada',
         cerrada_en = now(),
         bultos_total = 1,
         bultos_resueltos = 0,
         bultos_sin_resolver = 1
   where id = ses_a3;

  -- El string del QR, cifrado. Contenido irrelevante para la prueba: lo que se
  -- prueba es que NADIE que no sea service_role pueda siquiera mirarlo.
  insert into operacion.bultos_retiro_qr
    (bulto_id, tenant_id, tipo_payload, payload_cifrado)
  values
    (bu_a1, t_a, 'flex_hash',    '\x0102030405'::bytea),
    (bu_a4, t_a, 'flex_hash',    '\x0102030406'::bytea),
    (bu_a2, t_a, 'codigo_crudo', '\x0102030407'::bytea),
    (bu_b1, t_b, 'flex_hash',    '\x0908070605'::bytea)
  on conflict (bulto_id) do nothing;
end $$;


-- =============================================================================
-- BLOQUE 0 · Contrato de esquema (10 tests)
-- =============================================================================

select has_type('operacion', 'estado_sesion_retiro',
  'esquema: existe el tipo operacion.estado_sesion_retiro');

select results_eq(
  $$ select enum_range(null::operacion.estado_sesion_retiro)::text[] $$,
  $$ values (array['abierta', 'cerrada']) $$,
  'esquema: estado_sesion_retiro tiene exactamente dos valores (abierta, cerrada)'
);

select has_type('operacion', 'formato_codigo_bulto',
  'esquema: existe el tipo operacion.formato_codigo_bulto');

select results_eq(
  $$ select enum_range(null::operacion.formato_codigo_bulto)::text[] $$,
  $$ values (array['flex_qr', 'rutax_interno', 'desconocido']) $$,
  'esquema: formato_codigo_bulto tiene los tres valores, y "desconocido" existe porque un código ilegible SE GUARDA IGUAL'
);

-- El alcance §2.1 la PROHÍBE: un seller despacha con varios couriers, la ingesta
-- entrega candidatos y "te faltaron 2" contra candidatos ajenos es alarma falsa.
-- La prueba existe para que nadie la agregue "porque parece que falta".
select hasnt_column('operacion', 'sesiones_retiro', 'bultos_esperados',
  'esquema: sesiones_retiro NO tiene bultos_esperados (alcance §2.1: contra candidatos ajenos sería una alarma falsa)');

-- La resolución se DERIVA (desconocido ⇒ ilegible · pedido_id null ⇒ no
-- procesado · resto ⇒ resuelto). Una columna redundante que hay que mantener
-- sincronizada es la misma familia de bug que el CHECK de tipo_diferencia.
select hasnt_column('operacion', 'bultos_retiro', 'resolucion',
  'esquema: bultos_retiro NO tiene columna resolucion (es derivable; una copia desincronizable es la familia de bug del CHECK de tipo_diferencia)');

select is(
  (select count(*)::int from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'bultos_retiro_qr'),
  0,
  'deny-all: NO existe public.bultos_retiro_qr — la tabla del QR no lleva vista espejo (molde secretos_cifrados)'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'operacion' and tablename = 'bultos_retiro_qr'),
  0,
  'deny-all: operacion.bultos_retiro_qr tiene CERO políticas (con force RLS eso es negar a todo rol de cliente)'
);

-- Contadores NULL mientras la visita está abierta, a propósito: un default 0
-- mostraría "0 bultos" en una visita con 40 escaneados.
select is(
  (select bultos_total from operacion.sesiones_retiro
    where id = 'cccccccc-7777-0000-0000-0000000000a1'),
  null::integer,
  'acta: los contadores son NULL mientras la sesión está abierta ("todavía no hay acta", distinto de "el acta dice cero")'
);

select is(
  has_table_privilege('service_role', 'operacion.bultos_retiro_qr', 'SELECT'),
  true,
  'deny-all: service_role SÍ conserva SELECT sobre la tabla del QR (control positivo: el revoke no la dejó inservible)'
);


-- =============================================================================
-- BLOQUE 1 · Cross-tenant: el interno del courier A no ve nada del courier B
-- =============================================================================
select test_iniciar_sesion(
  'cccccccc-3333-0000-0000-0000000000a1'::uuid, -- u_interno_a
  'cccccccc-0000-0000-0000-0000000000a1'::uuid, -- t_a
  'interno', 'dueno'
);

select is_empty(
  $$ select 1 from public.sesiones_retiro
      where tenant_id = 'dddddddd-0000-0000-0000-0000000000b1' $$,
  'P1 sesiones_retiro: el interno del courier A NO ve ninguna visita del courier B'
);

select is_empty(
  $$ select 1 from public.bultos_retiro
      where tenant_id = 'dddddddd-0000-0000-0000-0000000000b1' $$,
  'P1 bultos_retiro: el interno del courier A NO ve ningún bulto del courier B'
);

select results_eq(
  $$ select count(*)::int from public.sesiones_retiro $$,
  $$ values (3) $$,
  'P1 sesiones_retiro: el interno de A ve exactamente sus 3 visitas'
);

select results_eq(
  $$ select count(*)::int from public.bultos_retiro $$,
  $$ values (4) $$,
  'P1 bultos_retiro: el interno de A ve exactamente sus 4 bultos (incluido el ilegible)'
);

select isnt_empty(
  $$ select 1 from public.bultos_retiro where codigo_formato = 'desconocido' $$,
  'P1 control positivo: el interno de A SÍ ve el bulto ilegible (la política no lo deja fuera de todo, y el ilegible existe en la base)'
);


-- =============================================================================
-- BLOQUE 2 · El espejo: el interno del courier B no ve nada del courier A
-- =============================================================================
-- Se prueba la otra dirección a propósito: una condición mal escrita puede
-- aislar en un sentido y filtrar en el otro.
select test_iniciar_sesion(
  'dddddddd-3333-0000-0000-0000000000b1'::uuid, -- u_interno_b
  'dddddddd-0000-0000-0000-0000000000b1'::uuid, -- t_b
  'interno', 'dueno'
);

select is_empty(
  $$ select 1 from public.sesiones_retiro
      where tenant_id = 'cccccccc-0000-0000-0000-0000000000a1' $$,
  'P1 sesiones_retiro: el interno del courier B NO ve ninguna visita del courier A'
);

select is_empty(
  $$ select 1 from public.bultos_retiro
      where tenant_id = 'cccccccc-0000-0000-0000-0000000000a1' $$,
  'P1 bultos_retiro: el interno del courier B NO ve ningún bulto del courier A'
);

select results_eq(
  $$ select count(*)::int from public.sesiones_retiro $$,
  $$ values (1) $$,
  'P1 sesiones_retiro: el interno de B ve exactamente su única visita'
);

select results_eq(
  $$ select count(*)::int from public.bultos_retiro $$,
  $$ values (1) $$,
  'P1 bultos_retiro: el interno de B ve exactamente su único bulto'
);


-- =============================================================================
-- BLOQUE 3 · El conductor: solo lo suyo, ni siquiera lo de un colega
-- =============================================================================
select test_iniciar_sesion(
  'cccccccc-3333-0000-0000-0000000000a3'::uuid, -- u_conductor_a1
  'cccccccc-0000-0000-0000-0000000000a1'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'cccccccc-2222-0000-0000-0000000000a1'::uuid -- d_a1
);

select results_eq(
  $$ select count(*)::int from public.sesiones_retiro $$,
  $$ values (2) $$,
  'P3 sesiones_retiro: el conductor A1 ve exactamente SUS 2 visitas (la de hoy y la cerrada de ayer)'
);

select is_empty(
  $$ select 1 from public.sesiones_retiro
      where conductor_id = 'cccccccc-2222-0000-0000-0000000000a2' $$, -- d_a2
  'P3 sesiones_retiro: el conductor A1 NO ve la visita de su colega A2 (mismo courier, otro conductor)'
);

select results_eq(
  $$ select count(*)::int from public.bultos_retiro $$,
  $$ values (3) $$,
  'P3 bultos_retiro: el conductor A1 ve exactamente SUS 3 bultos'
);

select is_empty(
  $$ select 1 from public.bultos_retiro
      where sesion_retiro_id = 'cccccccc-7777-0000-0000-0000000000a2' $$, -- ses_a2
  'P3 bultos_retiro: el conductor A1 NO ve los bultos de la visita de su colega A2'
);

select throws_ok(
  $$ select 1 from operacion.bultos_retiro_qr $$,
  '42501',
  null,
  'deny-all: el CONDUCTOR recibe 42501 al tocar la tabla del QR — ni siquiera para sus propios bultos (el string es credencial-símil)'
);


-- =============================================================================
-- BLOQUE 4 · El seller: CERO en las tres tablas
-- =============================================================================
-- El retiro es logística interna del courier. Una rama P2 aquí le mostraría al
-- seller el ritmo, la carga y los faltantes de la operación completa —y, por el
-- seller_id del bulto, la de sus competidores en la misma van.
select test_iniciar_sesion(
  'cccccccc-3333-0000-0000-0000000000a2'::uuid, -- u_seller_a1
  'cccccccc-0000-0000-0000-0000000000a1'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'cccccccc-1111-0000-0000-0000000000a1'::uuid -- s_a1
);

select is_empty(
  $$ select 1 from public.sesiones_retiro $$,
  'P2 sesiones_retiro: el seller ve CERO visitas, incluidas las de su propia bodega (el retiro es interno del courier)'
);

select is_empty(
  $$ select 1 from public.bultos_retiro $$,
  'P2 bultos_retiro: el seller ve CERO bultos, incluidos los de sus propios pedidos'
);

select throws_ok(
  $$ select 1 from operacion.bultos_retiro_qr $$,
  '42501',
  null,
  'deny-all: el SELLER recibe 42501 al tocar la tabla del QR'
);

-- Control positivo: el seller SÍ ve sus pedidos. Sin esto, los tres ceros de
-- arriba podrían venir de un JWT mal armado y no de las políticas.
select isnt_empty(
  $$ select 1 from public.pedidos
      where seller_id = 'cccccccc-1111-0000-0000-0000000000a1' $$,
  'P2 control positivo: el seller SÍ ve sus propios pedidos — los tres ceros de arriba son de las políticas, no de un JWT mal armado'
);


-- =============================================================================
-- BLOQUE 5 · Escritura: ningún rol de cliente escribe, y falla RUIDOSO
-- =============================================================================
-- 42501 explícito y no "0 filas" silencioso: el privilegio está revocado, así
-- que Postgres corta antes de que la RLS filtre. Es el mismo razonamiento por el
-- que cierres_conductor no necesita el guard `solo_interno_edita`.
select test_iniciar_sesion(
  'cccccccc-3333-0000-0000-0000000000a1'::uuid, -- u_interno_a
  'cccccccc-0000-0000-0000-0000000000a1'::uuid, -- t_a
  'interno', 'dueno'
);

select throws_ok(
  $$ insert into public.sesiones_retiro (tenant_id, bodega_id, seller_id, conductor_id, fecha_operacion)
     values ('cccccccc-0000-0000-0000-0000000000a1',
             'cccccccc-9999-0000-0000-0000000000a1',
             'cccccccc-1111-0000-0000-0000000000a1',
             'cccccccc-2222-0000-0000-0000000000a1',
             date '2026-08-14') $$,
  '42501',
  null,
  'Escritura: ni siquiera el DUEÑO del courier puede INSERT en sesiones_retiro (escribe solo service_role, vía la app del conductor)'
);

select throws_ok(
  $$ update public.bultos_retiro set codigo_normalizado = 'ADULTERADO'
      where id = 'cccccccc-8888-0000-0000-0000000000a1' $$,
  '42501',
  null,
  'Escritura: el interno NO puede UPDATE un bulto — el acta respalda un pago y no se edita por PostgREST'
);

select throws_ok(
  $$ delete from public.sesiones_retiro
      where id = 'cccccccc-7777-0000-0000-0000000000a1' $$,
  '42501',
  null,
  'Escritura: el interno NO puede DELETE una visita'
);

select test_iniciar_sesion(
  'cccccccc-3333-0000-0000-0000000000a3'::uuid, -- u_conductor_a1
  'cccccccc-0000-0000-0000-0000000000a1'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'cccccccc-2222-0000-0000-0000000000a1'::uuid
);

select throws_ok(
  $$ update public.bultos_retiro set pedido_id = null
      where id = 'cccccccc-8888-0000-0000-0000000000a1' $$,
  '42501',
  null,
  'Escritura: el conductor NO puede UPDATE ni sus propios bultos (los escribe el endpoint Bearer con service_role, no el cliente)'
);

select test_iniciar_sesion(
  'cccccccc-3333-0000-0000-0000000000a2'::uuid, -- u_seller_a1
  'cccccccc-0000-0000-0000-0000000000a1'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'cccccccc-1111-0000-0000-0000000000a1'::uuid
);

select throws_ok(
  $$ insert into public.bultos_retiro
       (tenant_id, sesion_retiro_id, conductor_id, escaneo_id, codigo_formato,
        codigo_normalizado, ml_shipment_id, escaneado_en)
     values ('cccccccc-0000-0000-0000-0000000000a1',
             'cccccccc-7777-0000-0000-0000000000a1',
             'cccccccc-2222-0000-0000-0000000000a1',
             gen_random_uuid(), 'flex_qr', 'FALSIFICADO', 'FALSIFICADO', now()) $$,
  '42501',
  null,
  'Escritura: el seller NO puede fabricar un bulto (declararse "ya retirado" es forzar la entrada de su pedido a la bandeja de asignación)'
);


-- =============================================================================
-- BLOQUE 6 · Privilegios medidos, no supuestos
-- =============================================================================
-- Independiente de RLS, y por eso importa: lo que una tabla o vista nace teniendo
-- depende del rol que la creó (el default ACL de supabase_admin otorga arwdDxtm).
select test_cerrar_sesion();

select is(
  has_table_privilege('authenticated', 'operacion.bultos_retiro_qr', 'SELECT'),
  false,
  'Privilegios: authenticated NO tiene SELECT sobre operacion.bultos_retiro_qr (deny-all real, no solo ausencia de política)'
);

select is(
  has_table_privilege('anon', 'operacion.bultos_retiro_qr', 'SELECT'),
  false,
  'Privilegios: anon NO tiene SELECT sobre operacion.bultos_retiro_qr'
);

select is(
  has_table_privilege('authenticated', 'operacion.bultos_retiro_qr', 'INSERT'),
  false,
  'Privilegios: authenticated NO tiene INSERT sobre operacion.bultos_retiro_qr'
);

select is(
  has_table_privilege('authenticated', 'public.bultos_retiro', 'INSERT'),
  false,
  'Privilegios: authenticated NO tiene INSERT sobre la vista public.bultos_retiro'
);

select is(
  has_function_privilege('authenticated', 'operacion.cerrar_sesion_retiro(uuid,uuid,uuid)', 'EXECUTE'),
  false,
  'Privilegios: authenticated NO puede ejecutar cerrar_sesion_retiro (es SECURITY DEFINER y escribe operacion.pedidos saltándose RLS)'
);

select is(
  has_function_privilege('authenticated', 'operacion.resolver_bulto_retiro(uuid,uuid,uuid)', 'EXECUTE'),
  false,
  'Privilegios: authenticated NO puede ejecutar resolver_bulto_retiro'
);


-- =============================================================================
-- BLOQUE 7 · Idempotencia e integridad del bulto (como postgres)
-- =============================================================================
-- Se ejecuta con el rol dueño (bypassa RLS) para aislar lo que se mide: estas son
-- garantías de ESQUEMA, no de política. Van después de los conteos porque mutan.

-- IDEMPOTENCIA #1 — reintento del lote.
select throws_ok(
  $$ insert into operacion.bultos_retiro
       (tenant_id, sesion_retiro_id, conductor_id, escaneo_id, codigo_formato,
        codigo_normalizado, ml_shipment_id, escaneado_en)
     values ('cccccccc-0000-0000-0000-0000000000a1',
             'cccccccc-7777-0000-0000-0000000000a1',
             'cccccccc-2222-0000-0000-0000000000a1',
             'cccccccc-4444-0000-0000-0000000000a1',  -- escaneo_id ya usado
             'flex_qr', 'OTRO-CODIGO', 'OTRO-CODIGO', now()) $$,
  '23505',
  null,
  'Idempotencia #1 (tenant_id, escaneo_id): reintentar el mismo lote no duplica el bulto'
);

-- IDEMPOTENCIA #2 — doble escaneo físico. Cada disparo de la cámara trae un
-- escaneo_id NUEVO, así que la unique #1 no lo ve: hacen falta las dos.
select throws_ok(
  $$ insert into operacion.bultos_retiro
       (tenant_id, sesion_retiro_id, conductor_id, escaneo_id, codigo_formato,
        codigo_normalizado, ml_shipment_id, escaneado_en)
     values ('cccccccc-0000-0000-0000-0000000000a1',
             'cccccccc-7777-0000-0000-0000000000a1',
             'cccccccc-2222-0000-0000-0000000000a1',
             gen_random_uuid(),                        -- escaneo_id NUEVO
             'flex_qr', 'SHIPBODA1', 'SHIPBODA1', now()) $$,
  '23505',
  null,
  'Idempotencia #2 (sesion_retiro_id, codigo_normalizado): el doble escaneo del MISMO bulto no crea una segunda fila — y la unique #1 no lo habría atrapado'
);

-- …pero el alcance de la #2 es LA SESIÓN, no el courier: el mismo código en otra
-- visita es un hecho legítimo (un bulto devuelto y vuelto a retirar).
select lives_ok(
  $$ insert into operacion.bultos_retiro
       (tenant_id, sesion_retiro_id, conductor_id, escaneo_id, codigo_formato,
        codigo_normalizado, ml_shipment_id, escaneado_en)
     values ('cccccccc-0000-0000-0000-0000000000a1',
             'cccccccc-7777-0000-0000-0000000000a2',  -- OTRA sesión
             'cccccccc-2222-0000-0000-0000000000a2',
             gen_random_uuid(), 'flex_qr', 'SHIPBODA1', 'SHIPBODA1', now()) $$,
  'Idempotencia #2: el alcance es la SESIÓN, no el courier — el mismo código en otra visita sí se registra'
);

-- EL CHEQUEO QUE LE FALTA AL MOLDE cierres_conductor.
select throws_ok(
  $$ insert into operacion.bultos_retiro
       (tenant_id, sesion_retiro_id, conductor_id, escaneo_id, codigo_formato,
        codigo_normalizado, ml_shipment_id, pedido_id, seller_id, escaneado_en)
     values ('cccccccc-0000-0000-0000-0000000000a1',
             'cccccccc-7777-0000-0000-0000000000a1',
             'cccccccc-2222-0000-0000-0000000000a1',
             gen_random_uuid(), 'flex_qr', 'CRUZADO-B', 'CRUZADO-B',
             'dddddddd-6666-0000-0000-0000000000b1',   -- pedido del TENANT B
             'dddddddd-1111-0000-0000-0000000000b1',
             now()) $$,
  '23514',
  null,
  'Trigger: un bulto del courier A NO puede colgar de un pedido del courier B (marcarlo `retirado` lo metería en la bandeja de asignación del courier equivocado)'
);

select throws_ok(
  $$ insert into operacion.bultos_retiro
       (tenant_id, sesion_retiro_id, conductor_id, escaneo_id, codigo_formato,
        codigo_normalizado, ml_shipment_id, pedido_id, seller_id, escaneado_en)
     values ('cccccccc-0000-0000-0000-0000000000a1',
             'cccccccc-7777-0000-0000-0000000000a1',
             'cccccccc-2222-0000-0000-0000000000a1',
             gen_random_uuid(), 'flex_qr', 'SELLER-MAL', 'SELLER-MAL',
             'cccccccc-6666-0000-0000-0000000000a1',   -- pedido del seller A1
             'cccccccc-1111-0000-0000-0000000000a2',   -- …pero seller A2
             now()) $$,
  '23514',
  null,
  'Trigger: el seller denormalizado del bulto tiene que ser el del PEDIDO, no otro del mismo courier'
);

select throws_ok(
  $$ insert into operacion.bultos_retiro
       (tenant_id, sesion_retiro_id, conductor_id, escaneo_id, codigo_formato,
        codigo_normalizado, ml_shipment_id, escaneado_en, posterior_al_cierre)
     values ('cccccccc-0000-0000-0000-0000000000a1',
             'cccccccc-7777-0000-0000-0000000000a3',  -- ses_a3, CERRADA
             'cccccccc-2222-0000-0000-0000000000a1',
             gen_random_uuid(), 'flex_qr', 'TARDIO-SIN-MARCA', 'TARDIO-SIN-MARCA',
             now(), false) $$,
  '23514',
  null,
  'Trigger: un escaneo que entra a una visita CERRADA debe declararse (posterior_al_cierre), o el acta congelada quedaría desmentida en silencio'
);

select lives_ok(
  $$ insert into operacion.bultos_retiro
       (tenant_id, sesion_retiro_id, conductor_id, escaneo_id, codigo_formato,
        codigo_normalizado, ml_shipment_id, escaneado_en, posterior_al_cierre)
     values ('cccccccc-0000-0000-0000-0000000000a1',
             'cccccccc-7777-0000-0000-0000000000a3',  -- ses_a3, CERRADA
             'cccccccc-2222-0000-0000-0000000000a1',
             gen_random_uuid(), 'flex_qr', 'TARDIO-CON-MARCA', 'TARDIO-CON-MARCA',
             now(), true) $$,
  'Trigger: el escaneo tardío SÍ se acepta marcado — la cola sin conexión lo vuelve inevitable y rechazarlo perdería un escaneo, que es el único fallo irreversible del retiro'
);

-- La FK que hace honesto al seller denormalizado de la visita.
select throws_ok(
  $$ insert into operacion.sesiones_retiro
       (tenant_id, bodega_id, seller_id, conductor_id, fecha_operacion)
     values ('cccccccc-0000-0000-0000-0000000000a1',
             'cccccccc-9999-0000-0000-0000000000a1',  -- bodega del seller A1
             'cccccccc-1111-0000-0000-0000000000a2',  -- …atribuida al seller A2
             'cccccccc-2222-0000-0000-0000000000a1',
             date '2026-08-14') $$,
  '23503',
  null,
  'FK sesiones_retiro_bodega_es_del_seller: el seller de la visita debe ser el DUEÑO REAL de la bodega (el acta nombra a quien se le paga el retiro)'
);


-- =============================================================================
-- BLOQUE 8 · CHECKs de forma
-- =============================================================================

select throws_ok(
  $$ update operacion.sesiones_retiro set estado = 'cerrada', cerrada_en = now()
      where id = 'cccccccc-7777-0000-0000-0000000000a1' $$,
  '23514',
  null,
  'CHECK cierre coherente: no se puede cerrar una visita sin acta — una sesión "cerrada" con contadores nulos parece cerrada y no respalda ningún pago'
);

select throws_ok(
  $$ update operacion.sesiones_retiro
        set estado = 'cerrada', cerrada_en = now(),
            bultos_total = 10, bultos_resueltos = 3, bultos_sin_resolver = 3
      where id = 'cccccccc-7777-0000-0000-0000000000a1' $$,
  '23514',
  null,
  'CHECK cierre coherente: el acta tiene que cuadrar (total = resueltos + sin_resolver)'
);

select throws_ok(
  $$ update operacion.bultos_retiro set muestra_codigo = 'FRAGMENTO'
      where id = 'cccccccc-8888-0000-0000-0000000000a1' $$, -- bu_a1, flex_qr
  '23514',
  null,
  'CHECK muestra_solo_desconocido: la muestra es exclusiva del código ilegible — en un flex_qr sería una segunda copia del mismo dato'
);

select throws_ok(
  $$ insert into operacion.bultos_retiro
       (tenant_id, sesion_retiro_id, conductor_id, escaneo_id, codigo_formato,
        codigo_normalizado, pedido_id, seller_id, escaneado_en)
     values ('cccccccc-0000-0000-0000-0000000000a1',
             'cccccccc-7777-0000-0000-0000000000a1',
             'cccccccc-2222-0000-0000-0000000000a1',
             gen_random_uuid(), 'desconocido', 'ILEGIBLE-CON-PEDIDO',
             'cccccccc-6666-0000-0000-0000000000a1',
             'cccccccc-1111-0000-0000-0000000000a1',
             now()) $$,
  '23514',
  null,
  'CHECK desconocido_sin_vinculo: de un código que Rutax no entiende no se puede afirmar a qué pedido corresponde'
);

select throws_ok(
  $$ insert into operacion.sesiones_retiro
       (tenant_id, bodega_id, seller_id, conductor_id, fecha_operacion)
     values ('cccccccc-0000-0000-0000-0000000000a1',
             'cccccccc-9999-0000-0000-0000000000a1',
             'cccccccc-1111-0000-0000-0000000000a1',
             'cccccccc-2222-0000-0000-0000000000a1',
             date '2026-08-13') $$,   -- ya hay una ABIERTA para ese día
  '23505',
  null,
  'sesiones_retiro_abierta_uk: un conductor tiene como máximo UNA visita abierta por bodega y por día (idempotencia de la apertura)'
);


-- =============================================================================
-- BLOQUE 9 · Las dos funciones — el cierre transaccional y el escaneo tardío
-- =============================================================================
-- Corren como `postgres`; el privilegio de EXECUTE ya se midió en el bloque 6.
-- ses_a1 tiene 2 bultos no posteriores al cierre: bu_a1 (casado con p_a1) y
-- bu_a2 (ilegible). El acta debe quedar 2 / 1 / 1 y marcar 1 pedido.

select results_eq(
  $$ select total_bultos, total_resueltos, total_sin_resolver, ya_estaba_cerrada, pedidos_marcados
       from operacion.cerrar_sesion_retiro(
              'cccccccc-0000-0000-0000-0000000000a1'::uuid,
              'cccccccc-7777-0000-0000-0000000000a1'::uuid,
              'cccccccc-2222-0000-0000-0000000000a1'::uuid) $$,
  $$ values (2, 1, 1, false, 1) $$,
  'cerrar_sesion_retiro: congela el acta (2 bultos, 1 resuelto, 1 sin resolver) y marca 1 pedido como retirado, en UNA transacción'
);

select is(
  (select situacion_retiro::text from operacion.pedidos
    where id = 'cccccccc-6666-0000-0000-0000000000a1'),
  'retirado',
  'cerrar_sesion_retiro: el pedido del bulto escaneado pasa a `retirado` — es la compuerta que lo hace visible en la bandeja de asignación'
);

select isnt(
  (select retirado_en from operacion.pedidos
    where id = 'cccccccc-6666-0000-0000-0000000000a1'),
  null::timestamptz,
  'cerrar_sesion_retiro: retirado_en queda poblado (el CHECK pedidos_retirado_en_coherente exige que no sobre ni falte)'
);

select results_eq(
  $$ select total_bultos, total_resueltos, total_sin_resolver, ya_estaba_cerrada, pedidos_marcados
       from operacion.cerrar_sesion_retiro(
              'cccccccc-0000-0000-0000-0000000000a1'::uuid,
              'cccccccc-7777-0000-0000-0000000000a1'::uuid,
              'cccccccc-2222-0000-0000-0000000000a1'::uuid) $$,
  $$ values (2, 1, 1, true, 0) $$,
  'cerrar_sesion_retiro: cerrar dos veces devuelve el acta CONGELADA tal cual, sin error y sin recalcular (una cola de reintentos no puede distinguir "falló" de "ya estaba hecho")'
);

select throws_ok(
  $$ select * from operacion.cerrar_sesion_retiro(
       'cccccccc-0000-0000-0000-0000000000a1'::uuid,
       'cccccccc-7777-0000-0000-0000000000a2'::uuid,   -- visita del conductor A2
       'cccccccc-2222-0000-0000-0000000000a1'::uuid) $$, -- …cerrada por A1
  '42501',
  null,
  'cerrar_sesion_retiro: un conductor NO cierra la visita de un colega — 42501 explícito, no "0 filas"'
);

select throws_ok(
  $$ select * from operacion.cerrar_sesion_retiro(
       'dddddddd-0000-0000-0000-0000000000b1'::uuid,   -- tenant B
       'cccccccc-7777-0000-0000-0000000000a2'::uuid,   -- visita del tenant A
       'cccccccc-2222-0000-0000-0000000000a2'::uuid) $$,
  'P0002',
  null,
  'cerrar_sesion_retiro: la función NO ve una visita de otro courier aunque sea SECURITY DEFINER con BYPASSRLS (filtra por tenant_id por dentro)'
);

-- EL PASO QUE SE DESCUBRE EN PRODUCCIÓN SI FALTA: bu_a4 vive en ses_a3, que ya
-- estaba cerrada. Resolverlo debe marcar su pedido igual, o el bulto se queda
-- arriba de la van y nunca entra a la bandeja de asignación.
select results_eq(
  $$ select seller_resuelto_id, sesion_estaba_cerrada, pedido_marcado_retirado
       from operacion.resolver_bulto_retiro(
              'cccccccc-0000-0000-0000-0000000000a1'::uuid,
              'cccccccc-8888-0000-0000-0000000000a4'::uuid,
              'cccccccc-6666-0000-0000-0000000000a3'::uuid) $$,
  $$ values ('cccccccc-1111-0000-0000-0000000000a1'::uuid, true, true) $$,
  'resolver_bulto_retiro: un escaneo resuelto DESPUÉS del cierre también marca su pedido (sin esto el bulto va en la van y nunca llega a la bandeja de asignación)'
);

select is(
  (select situacion_retiro::text from operacion.pedidos
    where id = 'cccccccc-6666-0000-0000-0000000000a3'),
  'retirado',
  'resolver_bulto_retiro: el pedido resuelto tarde quedó en `retirado` de verdad, no solo en el valor de retorno'
);

select throws_ok(
  $$ select * from operacion.resolver_bulto_retiro(
       'cccccccc-0000-0000-0000-0000000000a1'::uuid,
       'cccccccc-8888-0000-0000-0000000000a4'::uuid,
       'dddddddd-6666-0000-0000-0000000000b1'::uuid) $$,  -- pedido del tenant B
  '23514',
  null,
  'resolver_bulto_retiro: NO se puede casar un bulto del courier A con un pedido del courier B (la función escribe operacion.pedidos con BYPASSRLS)'
);

select throws_ok(
  $$ select * from operacion.resolver_bulto_retiro(
       'cccccccc-0000-0000-0000-0000000000a1'::uuid,
       'cccccccc-8888-0000-0000-0000000000a2'::uuid,   -- bu_a2, ilegible
       'cccccccc-6666-0000-0000-0000000000a2'::uuid) $$,
  '23514',
  null,
  'resolver_bulto_retiro: un código ilegible no se "resuelve" a un pedido — primero hay que reclasificar el formato'
);

select * from finish();

rollback;
