-- =============================================================================
-- Aislamiento RLS — contactos y bitácora de WhatsApp
-- =============================================================================
-- Migración probada:
--   20260825000002_integraciones_whatsapp.sql
--
-- Demuestra, contra una base Postgres real (no mocks de aplicación):
--
--   1. AISLAMIENTO — el interno ve EXACTAMENTE los contactos de SU courier y
--      cero del otro. **El seller ve CERO, aunque su propio teléfono esté en la
--      tabla**: el directorio y la declaración de consentimiento son del
--      courier, no suyos. El conductor ve cero.
--
--   2. LA BITÁCORA ES DENY-ALL — `whatsapp_mensajes` no es alcanzable por
--      `authenticated` ni para leer. La escriben el job de envío y el webhook de
--      acuses, ambos con `service_role`. Se comprueba con 42501 explícito y no
--      con "0 filas": un `revoke` que se pierda daría 0 filas por RLS y la
--      prueba pasaría igual sin proteger nada.
--
--   3. LAS BARRERAS DE NEGOCIO ESTÁN EN LA BASE — el rol tiene que traer su FK,
--      el teléfono tiene que venir sin `+` (como lo quiere la Cloud API), y un
--      consentimiento `otorgado` no puede quedar sin fecha. Son las tres cosas
--      que, mal puestas, hacen que Meta acepte el mensaje con un 200 y el aviso
--      simplemente no llegue nunca.
--
-- ⚠️ NO HAY TABLA DE PLANTILLAS, Y SE PRUEBA QUE NO LA HAY. El catálogo vive en
-- TypeScript a propósito (ver `catalogo-plantillas.ts`): un `estado_meta`
-- persistido se vuelve un filtro obsoleto que bloquea envíos que Meta sí habría
-- aceptado — el patrón que mordió el 2026-08-25 con la lista blanca de estados
-- de ML. El `hasnt_table` está para que nadie la reintroduzca por descuido.
--
-- Mecanismo idéntico al resto de la suite: se simula el JWT fijando
-- `request.jwt.claims` y conmutando el rol a `authenticated`.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(27);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada (cada .test.sql corre en su propia transacción).
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
-- Fixtures (como postgres → bypassa RLS).
--   Tenant A: seller A con bodega, 3 contactos (seller, bodega, courier).
--   Tenant B: seller B, 1 contacto.
-- -----------------------------------------------------------------------------

do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-00000000ee01';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-00000000ee02';

  s_a uuid := 'aaaaaaaa-1111-0000-0000-00000000ee01';
  s_b uuid := 'bbbbbbbb-1111-0000-0000-00000000ee02';

  bod_a uuid := 'aaaaaaaa-2222-0000-0000-00000000ee01';

  u_interno_a uuid := 'aaaaaaaa-3333-0000-0000-00000000ee01';
  u_interno_b uuid := 'bbbbbbbb-3333-0000-0000-00000000ee02';
  u_seller_a  uuid := 'aaaaaaaa-3333-0000-0000-00000000ee03';
  u_cond_a    uuid := 'aaaaaaaa-3333-0000-0000-00000000ee04';
  d_a         uuid := 'aaaaaaaa-4444-0000-0000-00000000ee01';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier WA A', 'Courier WA A SpA', '76777777-7', 'activo'),
    (t_b, 'Courier WA B', 'Courier WA B SpA', '76888888-8', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_interno_a, 'interno.a@wa.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_interno_b, 'interno.b@wa.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,  'seller.a@wa.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_cond_a,    'cond.a@wa.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a, t_a, 'Seller WA A', '77777777-7', 'Contacto A', 'a@wa.test', 'activo'),
    (s_b, t_b, 'Seller WA B', '77888888-8', 'Contacto B', 'b@wa.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values (d_a, t_a, 'Conductor WA A', '78888888-8', 'independiente', 'activo')
  on conflict (id) do nothing;

  insert into identidad.seller_bodegas (id, tenant_id, seller_id, nombre, direccion, comuna)
  values (bod_a, t_a, s_a, 'Bodega central A', 'Av. Siempre Viva 742', 'Maipú')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a, t_a, 'Interno A',  'interno',   null, null, 'dueno',  'activo'),
    (u_interno_b, t_b, 'Interno B',  'interno',   null, null, 'dueno',  'activo'),
    (u_seller_a,  t_a, 'Seller A',   'seller',    s_a,  null, 'seller', 'activo'),
    (u_cond_a,    t_a, 'Cond A',     'conductor', null, d_a,  'conductor', 'activo')
  on conflict (id) do nothing;

  -- Los contactos. El del seller lleva el MISMO teléfono que después se usa
  -- para probar que el seller no ve ni su propia fila.
  insert into integraciones.whatsapp_contactos
    (id, tenant_id, rol, seller_id, bodega_id, telefono_e164, etiqueta, opt_in_estado, opt_in_en)
  values
    ('aaaaaaaa-5555-0000-0000-00000000ee01', t_a, 'seller',  s_a,  null,  '56911110001', 'Dueño seller A', 'otorgado', now()),
    ('aaaaaaaa-5555-0000-0000-00000000ee02', t_a, 'bodega',  null, bod_a, '56911110002', 'Jefe bodega A',  'otorgado', now()),
    ('aaaaaaaa-5555-0000-0000-00000000ee03', t_a, 'courier', null, null,  '56911110003', 'Coordinación A', 'pendiente', null),
    ('bbbbbbbb-5555-0000-0000-00000000ee04', t_b, 'seller',  s_b,  null,  '56911110004', 'Dueño seller B', 'otorgado', now())
  on conflict (id) do nothing;

  -- Una fila en la bitácora, para que un `select` que se cuele devuelva algo y
  -- la fuga se note. Con la tabla vacía, un revoke perdido daría 0 filas y la
  -- prueba pasaría sin proteger nada.
  insert into integraciones.whatsapp_mensajes
    (id, tenant_id, contacto_id, clave_evento, nombre_plantilla, clave_idempotencia, variables, estado, meta_message_id)
  values
    ('aaaaaaaa-6666-0000-0000-00000000ee01', t_a, 'aaaaaaaa-5555-0000-0000-00000000ee01',
     'retiro_completado', 'notificacion_retiro_pedidos', 'retiro_completado:sesion-1',
     '["Seller WA A","87","Juan Pérez","XX-1234","32 Maipú"]'::jsonb, 'enviado', 'wamid.TEST001')
  on conflict (id) do nothing;
end $$;

-- =============================================================================
-- BLOQUE 0 · Contrato de esquema
-- =============================================================================
select has_table('integraciones', 'whatsapp_contactos',
  'esquema: existe integraciones.whatsapp_contactos');

select has_table('integraciones', 'whatsapp_mensajes',
  'esquema: existe integraciones.whatsapp_mensajes');

-- La ausencia es la decisión. Ver el encabezado de este archivo.
select hasnt_table('infra', 'whatsapp_plantillas',
  'esquema: NO existe una tabla de plantillas — el catálogo vive en TypeScript a propósito');

-- El contacto apunta a la entidad que representa. Sin estos FKs, el aviso
-- "retiramos N pedidos desde TU bodega" no puede direccionarse a un seller.
select has_column('integraciones', 'whatsapp_contactos', 'seller_id',
  'esquema: el contacto sabe A QUÉ SELLER pertenece, no solo que "es un seller"');

select has_column('integraciones', 'whatsapp_contactos', 'bodega_id',
  'esquema: el contacto sabe A QUÉ BODEGA pertenece');

-- Sin esta columna, un reintento del job reenvía y vuelve a cobrar.
select has_column('integraciones', 'whatsapp_mensajes', 'clave_idempotencia',
  'esquema: la bitácora tiene llave de idempotencia (Meta no acepta idempotency key)');

-- =============================================================================
-- BLOQUE 1 · Aislamiento de lectura de contactos
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-00000000ee01'::uuid,
  'aaaaaaaa-0000-0000-0000-00000000ee01'::uuid,
  'interno', 'dueno');

select is(
  (select count(*)::int from integraciones.whatsapp_contactos),
  3,
  'aislamiento: el interno de A ve los 3 contactos de su courier');

select is(
  (select count(*)::int from integraciones.whatsapp_contactos
    where tenant_id = 'bbbbbbbb-0000-0000-0000-00000000ee02'::uuid),
  0,
  'aislamiento: el interno de A ve CERO contactos del courier B');

select is(
  (select count(*)::int from public.whatsapp_contactos),
  3,
  'aislamiento: la vista public espeja exactamente lo mismo (no es un atajo sin RLS)');

select test_cerrar_sesion();

select test_iniciar_sesion(
  'bbbbbbbb-3333-0000-0000-00000000ee02'::uuid,
  'bbbbbbbb-0000-0000-0000-00000000ee02'::uuid,
  'interno', 'dueno');

select is(
  (select count(*)::int from integraciones.whatsapp_contactos),
  1,
  'aislamiento: el interno de B ve solo el suyo');

select test_cerrar_sesion();

-- El caso que más cuesta explicar y que hay que dejar fijo: el seller NO ve el
-- directorio, ni siquiera la fila con su propio teléfono. El alta y la
-- declaración de consentimiento las hace el courier (decisión del usuario,
-- 2026-08-25); si el seller pudiera editarla, podría otorgarse a sí mismo un
-- consentimiento que nadie declaró.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-00000000ee03'::uuid,
  'aaaaaaaa-0000-0000-0000-00000000ee01'::uuid,
  'seller', 'seller',
  'aaaaaaaa-1111-0000-0000-00000000ee01'::uuid);

select is(
  (select count(*)::int from integraciones.whatsapp_contactos),
  0,
  'aislamiento: el seller ve CERO contactos, incluido el que lleva su propio teléfono');

select test_cerrar_sesion();

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-00000000ee04'::uuid,
  'aaaaaaaa-0000-0000-0000-00000000ee01'::uuid,
  'conductor', 'conductor',
  null,
  'aaaaaaaa-4444-0000-0000-00000000ee01'::uuid);

select is(
  (select count(*)::int from integraciones.whatsapp_contactos),
  0,
  'aislamiento: el conductor ve CERO contactos');

select test_cerrar_sesion();

-- =============================================================================
-- BLOQUE 2 · La bitácora de mensajes es DENY-ALL
-- =============================================================================
-- Se exige 42501 (permiso denegado) y no "0 filas": si el `revoke` se perdiera y
-- solo quedara RLS sin políticas, el `select` devolvería 0 filas y una prueba
-- por conteo pasaría igual sin proteger nada.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-00000000ee01'::uuid,
  'aaaaaaaa-0000-0000-0000-00000000ee01'::uuid,
  'interno', 'dueno');

select throws_ok(
  'select count(*) from integraciones.whatsapp_mensajes',
  '42501',
  null,
  'deny-all: ni el DUEÑO del courier puede leer la bitácora de mensajes');

select throws_ok(
  $$insert into integraciones.whatsapp_mensajes
      (tenant_id, clave_evento, nombre_plantilla, clave_idempotencia)
    values ('aaaaaaaa-0000-0000-0000-00000000ee01'::uuid, 'x', 'y', 'z')$$,
  '42501',
  null,
  'deny-all: el interno tampoco puede fabricar una entrada en la bitácora');

select test_cerrar_sesion();

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-00000000ee03'::uuid,
  'aaaaaaaa-0000-0000-0000-00000000ee01'::uuid,
  'seller', 'seller',
  'aaaaaaaa-1111-0000-0000-00000000ee01'::uuid);

select throws_ok(
  'select count(*) from integraciones.whatsapp_mensajes',
  '42501',
  null,
  'deny-all: el seller tampoco alcanza la bitácora');

select test_cerrar_sesion();

-- =============================================================================
-- BLOQUE 3 · Escritura de contactos
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-00000000ee01'::uuid,
  'aaaaaaaa-0000-0000-0000-00000000ee01'::uuid,
  'interno', 'dueno');

select lives_ok(
  $$insert into integraciones.whatsapp_contactos
      (tenant_id, rol, telefono_e164, etiqueta)
    values ('aaaaaaaa-0000-0000-0000-00000000ee01'::uuid, 'courier', '56911119999', 'Turno noche')$$,
  'escritura: el interno da de alta un contacto en SU courier');

-- El contacto nace SIN consentimiento: dar de alta un teléfono no es, por sí
-- solo, permiso para escribirle.
select is(
  (select opt_in_estado from integraciones.whatsapp_contactos where telefono_e164 = '56911119999'),
  'pendiente',
  'consentimiento: el contacto nace en `pendiente` — el alta no otorga el opt-in');

select throws_ok(
  $$insert into integraciones.whatsapp_contactos
      (tenant_id, rol, telefono_e164)
    values ('bbbbbbbb-0000-0000-0000-00000000ee02'::uuid, 'courier', '56911118888')$$,
  '42501',
  null,
  'aislamiento: el interno de A NO puede dar de alta un contacto en el courier B');

select test_cerrar_sesion();

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-00000000ee03'::uuid,
  'aaaaaaaa-0000-0000-0000-00000000ee01'::uuid,
  'seller', 'seller',
  'aaaaaaaa-1111-0000-0000-00000000ee01'::uuid);

select throws_ok(
  $$insert into integraciones.whatsapp_contactos
      (tenant_id, rol, seller_id, telefono_e164, opt_in_estado, opt_in_en)
    values ('aaaaaaaa-0000-0000-0000-00000000ee01'::uuid, 'seller',
            'aaaaaaaa-1111-0000-0000-00000000ee01'::uuid, '56911117777', 'otorgado', now())$$,
  '42501',
  null,
  'consentimiento: el seller NO puede otorgarse a sí mismo el opt-in');

select test_cerrar_sesion();

-- =============================================================================
-- BLOQUE 4 · Las barreras de negocio viven en la base
-- =============================================================================
-- Estas tres son las que evitan el fallo mudo: Meta ACEPTA un mensaje mal
-- dirigido o con un número mal formado y responde 200; el aviso simplemente no
-- llega y no hay error que mirar.

select throws_ok(
  $$insert into integraciones.whatsapp_contactos (tenant_id, rol, telefono_e164)
    values ('aaaaaaaa-0000-0000-0000-00000000ee01'::uuid, 'seller', '56911116666')$$,
  '23514',
  null,
  'negocio: un contacto rol=seller SIN seller_id se rechaza — no habría a quién dirigir el aviso');

select throws_ok(
  $$insert into integraciones.whatsapp_contactos (tenant_id, rol, seller_id, telefono_e164)
    values ('aaaaaaaa-0000-0000-0000-00000000ee01'::uuid, 'courier',
            'aaaaaaaa-1111-0000-0000-00000000ee01'::uuid, '56911115555')$$,
  '23514',
  null,
  'negocio: un contacto rol=courier NO puede colgar de un seller');

select throws_ok(
  $$insert into integraciones.whatsapp_contactos (tenant_id, rol, telefono_e164)
    values ('aaaaaaaa-0000-0000-0000-00000000ee01'::uuid, 'courier', '+56911114444')$$,
  '23514',
  null,
  'negocio: el teléfono se guarda SIN el signo + (es lo que exige el campo `to` de la Cloud API)');

select throws_ok(
  $$insert into integraciones.whatsapp_contactos (tenant_id, rol, telefono_e164, opt_in_estado)
    values ('aaaaaaaa-0000-0000-0000-00000000ee01'::uuid, 'courier', '56911113333', 'otorgado')$$,
  '23514',
  null,
  'negocio: un consentimiento `otorgado` sin fecha se rechaza — la auditoría de Meta pregunta el cuándo');

select throws_ok(
  $$insert into integraciones.whatsapp_contactos (tenant_id, rol, seller_id, telefono_e164)
    values ('aaaaaaaa-0000-0000-0000-00000000ee01'::uuid, 'seller',
            'aaaaaaaa-1111-0000-0000-00000000ee01'::uuid, '56911110001')$$,
  '23505',
  null,
  'negocio: el mismo número no se registra dos veces para el mismo destino — cada envío se cobra');

-- El mismo número SÍ puede estar en dos couriers distintos: un seller que
-- trabaja con dos couriers es un caso real, no un duplicado.
select lives_ok(
  $$insert into integraciones.whatsapp_contactos (tenant_id, rol, seller_id, telefono_e164)
    values ('bbbbbbbb-0000-0000-0000-00000000ee02'::uuid, 'seller',
            'bbbbbbbb-1111-0000-0000-00000000ee02'::uuid, '56911110001')$$,
  'negocio: el mismo teléfono SÍ puede ser contacto de dos couriers distintos');

-- La llave de idempotencia deja pasar un segundo aviso del mismo tipo con otra
-- referencia. Es el caso que rompería en silencio: dos sesiones de retiro el
-- mismo día, y la segunda sin aviso para siempre.
select lives_ok(
  $$insert into integraciones.whatsapp_mensajes
      (tenant_id, contacto_id, clave_evento, nombre_plantilla, clave_idempotencia)
    values ('aaaaaaaa-0000-0000-0000-00000000ee01'::uuid,
            'aaaaaaaa-5555-0000-0000-00000000ee01'::uuid,
            'retiro_completado', 'notificacion_retiro_pedidos', 'retiro_completado:sesion-2')$$,
  'idempotencia: un segundo retiro del mismo día (otra referencia) SÍ genera su aviso');

select throws_ok(
  $$insert into integraciones.whatsapp_mensajes
      (tenant_id, contacto_id, clave_evento, nombre_plantilla, clave_idempotencia)
    values ('aaaaaaaa-0000-0000-0000-00000000ee01'::uuid,
            'aaaaaaaa-5555-0000-0000-00000000ee01'::uuid,
            'retiro_completado', 'notificacion_retiro_pedidos', 'retiro_completado:sesion-1')$$,
  '23505',
  null,
  'idempotencia: repetir evento+referencia+contacto se rechaza — el reintento no vuelve a cobrar');

select * from finish();
rollback;
