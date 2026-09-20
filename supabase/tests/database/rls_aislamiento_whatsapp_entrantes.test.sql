-- =============================================================================
-- WhatsApp entrantes — deny-all, confidencialidad del texto libre y purga
-- =============================================================================
-- Migración probada:
--   20260920000001_integraciones_whatsapp_mensajes_entrantes.sql
--
-- Alcance: `docs/arquitectura/conversacion-whatsapp.md` (§5.1, §6.1, §9, §10).
--
-- Qué fija este archivo, en orden de importancia:
--
--   1. DENY-ALL CON 42501 EXPLÍCITO. Ninguna sesión de usuario alcanza la tabla,
--      ni el dueño del courier ni el seller, ni por `public` (no hay vista) ni
--      por el esquema directo. Se prueba con el código de error y no con "0
--      filas": si el `revoke` se perdiera y solo quedara RLS sin políticas, un
--      `select` devolvería 0 filas y una prueba por conteo pasaría igual sin
--      proteger nada.
--
--   2. CONFIDENCIALIDAD DE `texto` CON CONTRAPRUEBA. No basta afirmar que la
--      columna prohibida no se lee: una aserción de privilegios mal escrita
--      devuelve `false` para TODO y pasa en verde con la tabla abierta de par en
--      par. Por eso cada aserción negativa viene con su positiva al lado — la
--      lección del pgTAP que reponía el CHECK dentro del propio test.
--
--   3. EL `tenant_id` NULLABLE NO ABRE UN HUECO. Una fila sin tenant no puede
--      contener NI UN dato de negocio (ni texto, ni seller, ni contacto, ni
--      clasificación), y una fila resuelta no puede contradecir al tenant de su
--      seller.
--
--   4. LOS DOS CONTEOS DE §6.1 SIN TABLA DE CONTADORES: consultas por contacto
--      en la última hora (tope de abuso) e intentos numéricos SIN match (señal
--      de barrido), que se cuentan aparte a propósito.
--
--   5. LA PURGA DEJA LA MÉTRICA. Borra el texto y conserva cuántas consultas
--      hubo, de qué tipo y si encontraron algo.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(38);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada (cada .test.sql corre en su propia transacción)
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
  t_a uuid := 'aaaaaaaa-0000-0000-0000-0000000000f1';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-0000000000f2';
  s_a uuid := 'aaaaaaaa-1111-0000-0000-0000000000f1';
  s_b uuid := 'bbbbbbbb-1111-0000-0000-0000000000f2';
  u_interno_a uuid := 'aaaaaaaa-3333-0000-0000-0000000000f1';
  u_seller_a  uuid := 'aaaaaaaa-3333-0000-0000-0000000000f3';
  c_1 uuid := 'aaaaaaaa-5555-0000-0000-0000000000f1';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier WAE A', 'Courier WAE A SpA', '76222222-2', 'activo'),
    (t_b, 'Courier WAE B', 'Courier WAE B SpA', '76333333-3', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_interno_a, 'interno.a@wae.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,  'seller.a@wae.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a, t_a, 'Seller WAE A', '77222222-2', 'Contacto A', 'a@wae.test', 'activo'),
    (s_b, t_b, 'Seller WAE B', '77333333-3', 'Contacto B', 'b@wae.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a, t_a, 'Interno A', 'interno', null, null, 'dueno',  'activo'),
    (u_seller_a,  t_a, 'Seller A',  'seller',  s_a,  null, 'seller', 'activo')
  on conflict (id) do nothing;

  insert into integraciones.whatsapp_contactos
    (id, tenant_id, seller_id, telefono_e164, etiqueta, origen, opt_in_estado, opt_in_en)
  values
    (c_1, t_a, s_a, '56922220001', 'Su número', 'perfil_seller', 'otorgado', now())
  on conflict (id) do nothing;

  -- Dos consultas recientes del MISMO contacto: la ventana del tope de abuso.
  -- La segunda es una ristra de dígitos que no encontró nada — la sonda de §6.1.
  insert into integraciones.whatsapp_mensajes_entrantes
    (id, meta_message_id, telefono_e164, resolucion, tenant_id, seller_id, contacto_id,
     texto, texto_largo, clasificacion, hubo_match, recibido_en)
  values
    ('aaaaaaaa-7777-0000-0000-0000000000f1', 'wamid.ENT001', '56922220001', 'resuelto',
     t_a, s_a, c_1, 'RX-0001-0002', 12, 'codigo_interno', true, now() - interval '10 minutes'),
    ('aaaaaaaa-7777-0000-0000-0000000000f2', 'wamid.ENT002', '56922220001', 'resuelto',
     t_a, s_a, c_1, '44760788901', 11, 'flex_manual', false, now() - interval '20 minutes'),
    -- Vieja: es la que la purga tiene que alcanzar.
    ('aaaaaaaa-7777-0000-0000-0000000000f3', 'wamid.ENT003', '56922220001', 'resuelto',
     t_a, s_a, c_1, 'retiro', 6, 'intencion_retiro', true, now() - interval '100 days');

  -- Un número que no conocemos y uno ambiguo (§5.1): teléfono, hora y el hecho
  -- de que no se resolvió. NADA más.
  insert into integraciones.whatsapp_mensajes_entrantes
    (id, meta_message_id, telefono_e164, resolucion, recibido_en)
  values
    ('aaaaaaaa-7777-0000-0000-0000000000f4', 'wamid.ENT004', '56999990004', 'sin_contacto', now() - interval '5 minutes'),
    ('aaaaaaaa-7777-0000-0000-0000000000f5', 'wamid.ENT005', '56999990005', 'ambiguo',      now() - interval '5 minutes');
end $$;

-- =============================================================================
-- BLOQUE 0 · Contrato de esquema
-- =============================================================================
select has_table('integraciones', 'whatsapp_mensajes_entrantes',
  'esquema: existe integraciones.whatsapp_mensajes_entrantes');

-- La decisión de §10: tabla HERMANA, no una columna en la de salientes. Si
-- alguien "simplifica" fusionando las dos, esta ausencia es lo que se pone roja.
select hasnt_column('integraciones', 'whatsapp_mensajes', 'direccion',
  'esquema: la tabla de SALIENTES no gana una columna `direccion` — son hermanas');

select hasnt_view('public', 'whatsapp_mensajes_entrantes',
  'esquema: NO hay vista espejo en public — PostgREST no tiene por dónde entrar');

select col_is_null('integraciones', 'whatsapp_mensajes_entrantes', 'tenant_id',
  'esquema: tenant_id es NULLABLE — el mensaje entra antes de saber de quién es');

select has_column('integraciones', 'whatsapp_mensajes_entrantes', 'texto_largo',
  'esquema: existe texto_largo — sobrevive a la purga y sostiene la métrica');

select has_index('integraciones', 'whatsapp_mensajes_entrantes', 'whatsapp_entrantes_meta_id_uk',
  'esquema: índice único por meta_message_id — la idempotencia del webhook');

select has_index('integraciones', 'whatsapp_mensajes_entrantes', 'idx_whatsapp_entrantes_sondeo_numerico',
  'esquema: índice parcial de sondeos numéricos sin match — la señal de barrido de §6.1');

select has_function('public', 'whatsapp_entrantes_purgar_texto', array['integer', 'integer'],
  'esquema: existe la purga como función; el CUÁNDO lo pone un job de Inngest, no un cron de base');

-- =============================================================================
-- BLOQUE 1 · Idempotencia y las redes del tenant nullable
-- =============================================================================

-- Meta reenvía ante cualquier no-2xx y no firma un timestamp: el mismo wamid
-- llega dos veces POR DISEÑO. La llave es global, sin tenant adentro.
select throws_ok(
  $$insert into integraciones.whatsapp_mensajes_entrantes
      (meta_message_id, telefono_e164, resolucion)
    values ('wamid.ENT001', '56922220001', 'sin_contacto')$$,
  '23505',
  null,
  'idempotencia: el mismo wamid no entra dos veces, aunque cambie la resolución');

select lives_ok(
  $$insert into integraciones.whatsapp_mensajes_entrantes
      (meta_message_id, telefono_e164, resolucion)
    values ('wamid.ENT010', '56999990010', 'sin_contacto')$$,
  'no resuelto: se guarda teléfono, hora y el hecho de que no se resolvió — y alcanza');

-- Un mensaje de un número que no conocemos NO deja una línea escrita de puño de
-- alguien con quien no tenemos relación ni consentimiento.
select throws_ok(
  $$insert into integraciones.whatsapp_mensajes_entrantes
      (meta_message_id, telefono_e164, resolucion, texto, texto_largo)
    values ('wamid.ENT011', '56999990011', 'sin_contacto', 'hola, mi pedido?', 16)$$,
  '23514',
  null,
  'minimización: un mensaje SIN resolver no guarda texto — es la regla de §10 en la base');

select throws_ok(
  $$insert into integraciones.whatsapp_mensajes_entrantes
      (meta_message_id, telefono_e164, resolucion, tenant_id)
    values ('wamid.ENT012', '56999990012', 'ambiguo',
            'aaaaaaaa-0000-0000-0000-0000000000f1'::uuid)$$,
  '23514',
  null,
  '§5.1: un mensaje AMBIGUO no puede quedar atribuido a un tenant — ese error no se deshace');

select throws_ok(
  $$insert into integraciones.whatsapp_mensajes_entrantes
      (meta_message_id, telefono_e164, resolucion)
    values ('wamid.ENT013', '56999990013', 'resuelto')$$,
  '23514',
  null,
  'coherencia: `resuelto` exige tenant, seller y contacto — si no, no está resuelto');

-- ⚠️ La red del aislamiento. Sin la FK compuesta, un tenant_id mal escrito
-- rompe la separación entre couriers por la puerta de atrás y nada se queja.
select throws_ok(
  $$insert into integraciones.whatsapp_mensajes_entrantes
      (meta_message_id, telefono_e164, resolucion, tenant_id, seller_id, contacto_id)
    values ('wamid.ENT014', '56922220001', 'resuelto',
            'bbbbbbbb-0000-0000-0000-0000000000f2'::uuid,
            'aaaaaaaa-1111-0000-0000-0000000000f1'::uuid,
            'aaaaaaaa-5555-0000-0000-0000000000f1'::uuid)$$,
  '23503',
  null,
  'aislamiento: el tenant del entrante no puede contradecir al del seller');

select throws_ok(
  $$insert into integraciones.whatsapp_mensajes_entrantes
      (meta_message_id, telefono_e164, resolucion, tenant_id, seller_id, contacto_id, texto)
    values ('wamid.ENT015', '56922220001', 'resuelto',
            'aaaaaaaa-0000-0000-0000-0000000000f1'::uuid,
            'aaaaaaaa-1111-0000-0000-0000000000f1'::uuid,
            'aaaaaaaa-5555-0000-0000-0000000000f1'::uuid,
            'hola')$$,
  '23514',
  null,
  'métrica: texto sin texto_largo se rechaza — purgada, la fila no diría que hubo contenido');

select throws_ok(
  $$update integraciones.whatsapp_mensajes_entrantes
       set purgado_en = now()
     where meta_message_id = 'wamid.ENT001'$$,
  '23514',
  null,
  'purga: marcarla purgada dejando el texto vivo se rechaza — sería una purga que no purgó');

-- =============================================================================
-- BLOQUE 2 · DENY-ALL, con 42501 explícito
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000f1'::uuid,
  'aaaaaaaa-0000-0000-0000-0000000000f1'::uuid,
  'interno', 'dueno');

select throws_ok(
  'select count(*) from integraciones.whatsapp_mensajes_entrantes',
  '42501',
  null,
  'deny-all: el DUEÑO del courier no alcanza la tabla — la v1 no le da pantalla');

select throws_ok(
  'select texto from integraciones.whatsapp_mensajes_entrantes',
  '42501',
  null,
  'confidencialidad: el dueño no puede leer el texto libre de sus sellers');

-- ⚠️ CONTRAPRUEBA DE LA ANTERIOR. Si `recibido_en` SÍ se leyera, lo de arriba
-- estaría probando un filtro por columna; como tampoco se lee, lo que está
-- probado es deny-all. Las dos afirmaciones juntas dicen qué tipo de barrera es.
select throws_ok(
  'select recibido_en from integraciones.whatsapp_mensajes_entrantes',
  '42501',
  null,
  'deny-all: ni siquiera una columna inocua — la barrera es la tabla entera, no una columna');

select throws_ok(
  $$insert into integraciones.whatsapp_mensajes_entrantes
      (meta_message_id, telefono_e164, resolucion)
    values ('wamid.ENT020', '56922220099', 'sin_contacto')$$,
  '42501',
  null,
  'deny-all: el courier tampoco puede fabricar un mensaje entrante');

select throws_ok(
  'select public.whatsapp_entrantes_purgar_texto(90, 10)',
  '42501',
  null,
  'purga: el courier no puede ejecutar la purga (42501, sin EXECUTE)');

select test_cerrar_sesion();

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000f3'::uuid,
  'aaaaaaaa-0000-0000-0000-0000000000f1'::uuid,
  'seller', 'seller',
  'aaaaaaaa-1111-0000-0000-0000000000f1'::uuid);

select throws_ok(
  'select count(*) from integraciones.whatsapp_mensajes_entrantes',
  '42501',
  null,
  'deny-all: el seller no llega ni a sus propios mensajes por PostgREST');

select test_cerrar_sesion();

-- =============================================================================
-- BLOQUE 3 · El GRANT por columna, afirmado sobre el catálogo
-- =============================================================================
-- El bloque anterior prueba el hoy. Éste prueba el MAÑANA: el día que alguien
-- construya la pantalla del courier va a copiar la lista de columnas del grant,
-- y estas aserciones son lo que se pone rojo si `texto` se cuela en ella.
--
-- Cada negativa viene con su positiva al lado: una aserción de privilegios mal
-- escrita devuelve `false` para TODO y pasaría en verde con la tabla abierta.

select is(
  has_column_privilege('authenticated', 'integraciones.whatsapp_mensajes_entrantes', 'texto', 'select'),
  false,
  'grant: `authenticated` NO tiene select sobre `texto` (dato personal en crudo)');

select is(
  has_column_privilege('authenticated', 'integraciones.whatsapp_mensajes_entrantes', 'recibido_en', 'select'),
  false,
  'grant: `authenticated` no tiene select ni sobre `recibido_en` — deny-all, no filtro');

-- CONTRAPRUEBA: la misma pregunta, contra el rol que SÍ debe poder. Sin esto,
-- las dos de arriba pasarían aunque `has_column_privilege` estuviera mal usada.
select is(
  has_column_privilege('service_role', 'integraciones.whatsapp_mensajes_entrantes', 'texto', 'select'),
  true,
  'contraprueba: `service_role` SÍ lee `texto` — la aserción de privilegios no es vacua');

select is(
  has_column_privilege('service_role', 'integraciones.whatsapp_mensajes_entrantes', 'recibido_en', 'select'),
  true,
  'contraprueba: `service_role` SÍ lee `recibido_en`');

-- El UPDATE es acotado: el hecho tal como llegó no se reescribe. Si se
-- reescribiera, se borraría la evidencia del abuso que esta tabla existe para
-- contar.
select is(
  has_column_privilege('service_role', 'integraciones.whatsapp_mensajes_entrantes', 'meta_message_id', 'update'),
  false,
  'grant: ni service_role reescribe `meta_message_id` — es la llave de idempotencia');

select is(
  has_column_privilege('service_role', 'integraciones.whatsapp_mensajes_entrantes', 'telefono_e164', 'update'),
  false,
  'grant: ni service_role reescribe `telefono_e164` — es el hecho tal como llegó');

select is(
  has_column_privilege('service_role', 'integraciones.whatsapp_mensajes_entrantes', 'resolucion', 'update'),
  true,
  'contraprueba: `resolucion` SÍ es actualizable — se resuelve después de reservar la fila');

select is(
  has_function_privilege('authenticated', 'public.whatsapp_entrantes_purgar_texto(integer, integer)', 'execute'),
  false,
  'grant: `authenticated` no puede ejecutar la purga');

select is(
  has_function_privilege('service_role', 'public.whatsapp_entrantes_purgar_texto(integer, integer)', 'execute'),
  true,
  'contraprueba: `service_role` SÍ puede — la llama el job de Inngest');

-- =============================================================================
-- BLOQUE 4 · Los dos conteos de §6.1, SIN tabla de contadores
-- =============================================================================

select results_eq(
  $$select count(*)::int
      from integraciones.whatsapp_mensajes_entrantes
     where contacto_id = 'aaaaaaaa-5555-0000-0000-0000000000f1'::uuid
       and recibido_en > now() - interval '1 hour'$$,
  $$values (2)$$,
  'tope de abuso: las consultas de la última hora se cuentan sobre las propias filas');

-- Contado APARTE a propósito: un match fallido y uno exitoso no pesan igual.
select results_eq(
  $$select count(*)::int
      from integraciones.whatsapp_mensajes_entrantes
     where contacto_id = 'aaaaaaaa-5555-0000-0000-0000000000f1'::uuid
       and clasificacion = 'flex_manual'
       and hubo_match = false
       and recibido_en > now() - interval '1 hour'$$,
  $$values (1)$$,
  'barrido: los intentos numéricos SIN match se cuentan aparte de las consultas normales');

-- La anomalía de §5.1 tiene que poder contarse para el contador de
-- /admin/whatsapp. Si no, el seller queda sin canal y el job en verde.
select results_eq(
  $$select count(*)::int
      from integraciones.whatsapp_mensajes_entrantes
     where resolucion = 'ambiguo'$$,
  $$values (1)$$,
  '§5.1: el caso ambiguo queda CONTADO — falla cerrado, pero no en silencio');

-- =============================================================================
-- BLOQUE 5 · La purga borra el texto y DEJA la métrica
-- =============================================================================

select results_eq(
  $$select public.whatsapp_entrantes_purgar_texto(90, 100)$$,
  $$values (1)$$,
  'purga: alcanza exactamente la fila de más de 90 días');

select results_eq(
  $$select texto is null, texto_largo, clasificacion, hubo_match, purgado_en is not null
      from integraciones.whatsapp_mensajes_entrantes
     where meta_message_id = 'wamid.ENT003'$$,
  $$values (true, 6, 'intencion_retiro', true, true)$$,
  'purga: se va el texto y quedan el largo, el tipo de consulta y si encontró algo');

select results_eq(
  $$select texto from integraciones.whatsapp_mensajes_entrantes
     where meta_message_id = 'wamid.ENT001'$$,
  $$values ('RX-0001-0002'::text)$$,
  'purga: no toca lo que está dentro de la ventana de 90 días');

select results_eq(
  $$select public.whatsapp_entrantes_purgar_texto(90, 100)$$,
  $$values (0)$$,
  'purga: es idempotente — el job la llama en bucle hasta que devuelve 0');

select * from finish();
rollback;
