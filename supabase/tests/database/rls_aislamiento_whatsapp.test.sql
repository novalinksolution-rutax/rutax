-- =============================================================================
-- Aislamiento — contactos y bitácora de WhatsApp (modelo del 2026-08-25)
-- =============================================================================
-- Migraciones probadas:
--   20260825000002_integraciones_whatsapp.sql
--   20260825000004_whatsapp_contactos_del_seller.sql
--
-- El cambio que este archivo fija: **el courier dejó de administrar WhatsApp.**
-- Los destinatarios son siempre de un seller, el número propio lo pone el
-- seller, los adicionales los agrega Rutax desde el backstage, y las dos tablas
-- son DENY-ALL para toda sesión de usuario.
--
-- Se comprueba con 42501 explícito y no con "0 filas": si el `revoke` se
-- perdiera y solo quedara RLS sin políticas, un `select` devolvería 0 filas y
-- una prueba por conteo pasaría igual sin proteger nada. Esa distinción es todo
-- el valor de este archivo.
--
-- ⚠️ NO HAY TABLA DE PLANTILLAS, Y SE PRUEBA QUE NO LA HAY. El catálogo vive en
-- TypeScript a propósito: un `estado_meta` persistido se vuelve un filtro
-- obsoleto que bloquea envíos que Meta sí habría aceptado.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(18);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada
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
-- Fixtures
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-00000000ee01';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-00000000ee02';
  s_a uuid := 'aaaaaaaa-1111-0000-0000-00000000ee01';
  s_b uuid := 'bbbbbbbb-1111-0000-0000-00000000ee02';
  u_interno_a uuid := 'aaaaaaaa-3333-0000-0000-00000000ee01';
  u_seller_a  uuid := 'aaaaaaaa-3333-0000-0000-00000000ee03';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier WA A', 'Courier WA A SpA', '76777777-7', 'activo'),
    (t_b, 'Courier WA B', 'Courier WA B SpA', '76888888-8', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_interno_a, 'interno.a@wa.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,  'seller.a@wa.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a, t_a, 'Seller WA A', '77777777-7', 'Contacto A', 'a@wa.test', 'activo'),
    (s_b, t_b, 'Seller WA B', '77888888-8', 'Contacto B', 'b@wa.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a, t_a, 'Interno A', 'interno', null, null, 'dueno',  'activo'),
    (u_seller_a,  t_a, 'Seller A',  'seller',  s_a,  null, 'seller', 'activo')
  on conflict (id) do nothing;

  -- El número propio del seller (lo puso él) y uno que agregó Rutax: el caso
  -- real que motivó el modelo — que el aviso le llegue también a su pareja.
  insert into integraciones.whatsapp_contactos
    (id, tenant_id, seller_id, telefono_e164, etiqueta, origen, opt_in_estado, opt_in_en)
  values
    ('aaaaaaaa-5555-0000-0000-00000000ee01', t_a, s_a, '56911110001', 'Su número',
     'perfil_seller', 'otorgado', now()),
    ('aaaaaaaa-5555-0000-0000-00000000ee02', t_a, s_a, '56911110002', 'Su pareja',
     'agregado_por_rutax', 'otorgado', now())
  on conflict (id) do nothing;

  insert into integraciones.whatsapp_mensajes
    (id, tenant_id, contacto_id, clave_evento, nombre_plantilla, clave_idempotencia, estado, meta_message_id)
  values
    ('aaaaaaaa-6666-0000-0000-00000000ee01', t_a, 'aaaaaaaa-5555-0000-0000-00000000ee01',
     'retiro_completado', 'notificacion_retiro_pedidos', 'retiro_completado:sesion-1',
     'enviado', 'wamid.TEST001')
  on conflict (id) do nothing;
end $$;

-- =============================================================================
-- BLOQUE 0 · Contrato de esquema
-- =============================================================================
select has_table('integraciones', 'whatsapp_contactos',
  'esquema: existe integraciones.whatsapp_contactos');

select has_column('integraciones', 'whatsapp_contactos', 'origen',
  'esquema: existe `origen` — dice quién puso el número y qué vale su consentimiento');

-- El modelo viejo tenía tres tipos de destinatario y una pantalla del courier.
-- Estas dos ausencias SON la decisión: todo aviso va a un seller.
select hasnt_column('integraciones', 'whatsapp_contactos', 'rol',
  'esquema: NO existe `rol` — no hay destinatarios que no sean de un seller');

select hasnt_column('integraciones', 'whatsapp_contactos', 'bodega_id',
  'esquema: NO existe `bodega_id` — la bodega se nombra DENTRO del mensaje, no es destinataria');

select col_not_null('integraciones', 'whatsapp_contactos', 'seller_id',
  'esquema: `seller_id` es obligatorio — un contacto sin seller no tiene a quién representar');

select hasnt_table('infra', 'whatsapp_plantillas',
  'esquema: NO existe una tabla de plantillas — el catálogo vive en TypeScript a propósito');

-- La vista espejo se retiró junto con el acceso del courier.
select hasnt_view('public', 'whatsapp_contactos',
  'esquema: NO queda vista espejo en public — nadie llega por PostgREST');

-- =============================================================================
-- BLOQUE 1 · Deny-all: NADIE alcanza estas tablas con una sesión de usuario
-- =============================================================================
-- El courier es el caso que más importa: hasta el 2026-08-25 SÍ podía, y este
-- bloque es lo que impide que vuelva por descuido.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-00000000ee01'::uuid,
  'aaaaaaaa-0000-0000-0000-00000000ee01'::uuid,
  'interno', 'dueno');

select throws_ok(
  'select count(*) from integraciones.whatsapp_contactos',
  '42501',
  null,
  'deny-all: el DUEÑO del courier NO puede leer los contactos (antes sí podía)');

select throws_ok(
  $$insert into integraciones.whatsapp_contactos
      (tenant_id, seller_id, telefono_e164, origen)
    values ('aaaaaaaa-0000-0000-0000-00000000ee01'::uuid,
            'aaaaaaaa-1111-0000-0000-00000000ee01'::uuid, '56911119999', 'agregado_por_rutax')$$,
  '42501',
  null,
  'deny-all: el courier tampoco puede dar de alta un número');

select throws_ok(
  'select count(*) from integraciones.whatsapp_mensajes',
  '42501',
  null,
  'deny-all: el courier no alcanza la bitácora de mensajes');

select test_cerrar_sesion();

-- El seller tampoco: su número lo escribe por una Server Action que comprueba
-- su sesión, nunca por PostgREST.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-00000000ee03'::uuid,
  'aaaaaaaa-0000-0000-0000-00000000ee01'::uuid,
  'seller', 'seller',
  'aaaaaaaa-1111-0000-0000-00000000ee01'::uuid);

select throws_ok(
  'select count(*) from integraciones.whatsapp_contactos',
  '42501',
  null,
  'deny-all: el seller no llega ni a su propia fila por PostgREST');

select throws_ok(
  $$update integraciones.whatsapp_contactos set opt_in_estado = 'otorgado'$$,
  '42501',
  null,
  'deny-all: el seller no puede otorgarse el consentimiento por la puerta de atrás');

select test_cerrar_sesion();

-- =============================================================================
-- BLOQUE 2 · Las barreras de negocio viven en la base
-- =============================================================================

select throws_ok(
  $$insert into integraciones.whatsapp_contactos
      (tenant_id, seller_id, telefono_e164, origen)
    values ('aaaaaaaa-0000-0000-0000-00000000ee01'::uuid,
            'aaaaaaaa-1111-0000-0000-00000000ee01'::uuid, '56911110009', 'perfil_seller')$$,
  '23505',
  null,
  'negocio: UN SOLO número propio por seller — su pantalla no sabría cuál editar');

select lives_ok(
  $$insert into integraciones.whatsapp_contactos
      (tenant_id, seller_id, telefono_e164, etiqueta, origen)
    values ('aaaaaaaa-0000-0000-0000-00000000ee01'::uuid,
            'aaaaaaaa-1111-0000-0000-00000000ee01'::uuid, '56911110003', 'Su jefe de bodega',
            'agregado_por_rutax')$$,
  'negocio: Rutax SÍ puede sumar varios números adicionales al mismo seller');

select throws_ok(
  $$insert into integraciones.whatsapp_contactos
      (tenant_id, seller_id, telefono_e164, origen)
    values ('aaaaaaaa-0000-0000-0000-00000000ee01'::uuid,
            'aaaaaaaa-1111-0000-0000-00000000ee01'::uuid, '56911110001', 'agregado_por_rutax')$$,
  '23505',
  null,
  'negocio: el mismo número no se registra dos veces para el mismo seller — cada envío se cobra');

select throws_ok(
  $$insert into integraciones.whatsapp_contactos
      (tenant_id, seller_id, telefono_e164, origen)
    values ('aaaaaaaa-0000-0000-0000-00000000ee01'::uuid,
            'aaaaaaaa-1111-0000-0000-00000000ee01'::uuid, '56911110004', 'inventado')$$,
  '23514',
  null,
  'negocio: un `origen` que no existe se rechaza — falla cerrado ante una vía de escritura nueva');

-- ⚠️ La red del aislamiento: el tenant denormalizado NO puede contradecir al
-- del seller. Sin esta FK compuesta, un tenant_id mal escrito rompe la
-- separación entre couriers por la puerta de atrás y nada se queja.
select throws_ok(
  $$insert into integraciones.whatsapp_contactos
      (tenant_id, seller_id, telefono_e164, origen)
    values ('bbbbbbbb-0000-0000-0000-00000000ee02'::uuid,
            'aaaaaaaa-1111-0000-0000-00000000ee01'::uuid, '56911110005', 'agregado_por_rutax')$$,
  '23503',
  null,
  'aislamiento: el tenant del contacto no puede contradecir al del seller');

select throws_ok(
  $$insert into integraciones.whatsapp_contactos
      (tenant_id, seller_id, telefono_e164, origen, opt_in_estado)
    values ('aaaaaaaa-0000-0000-0000-00000000ee01'::uuid,
            'aaaaaaaa-1111-0000-0000-00000000ee01'::uuid, '56911110006', 'perfil_seller', 'otorgado')$$,
  '23514',
  null,
  'consentimiento: `otorgado` sin fecha se rechaza — la auditoría de Meta pregunta el cuándo');

select * from finish();
rollback;
