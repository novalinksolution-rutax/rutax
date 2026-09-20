-- =============================================================================
-- WhatsApp entrantes — el MOTIVO de no-respuesta: lista, coherencia y grant
-- =============================================================================
-- Migración probada:
--   20260920000003_integraciones_whatsapp_entrantes_motivo_no_respondido.sql
--
-- Alcance: `docs/arquitectura/conversacion-whatsapp.md` (§3, §5, §6.1, §9, §10).
--
-- Archivo APARTE de `rls_aislamiento_whatsapp_entrantes.test.sql` a propósito:
-- ese fija el contrato de la migración `…0001` y su `plan(38)`; meter esto
-- adentro obligaría a renumerar un plan ajeno en cada cambio. Las fixtures se
-- repiten (cada .test.sql corre en su propia transacción y hace rollback).
--
-- Qué fija este archivo, en orden de importancia:
--
--   1. EL CONJUNTO EXACTO DE VALORES DEL CHECK, con `set_eq` sobre el catálogo
--      y NUNCA un conteo. El incidente del 12-ago dejó 16 valores antes y 16
--      después, con distinta lista: cualquier prueba por cardinalidad lo habría
--      dado por bueno. Y se lee de `pg_constraint`, no se re-aplica el DDL
--      dentro del test — ese fue justamente el pgTAP que tapaba el bug que
--      debía detectar.
--
--   2. LAS TRES CAUSAS QUEDAN DISTINGUIBLES. Es el problema que la migración
--      existe para cerrar: `canal_apagado`, `tope_consultas` y
--      `barrido_codigos` se cuentan por separado sobre las mismas filas que
--      antes eran indistinguibles.
--
--   3. `null` NO ES "SE RESPONDIÓ". La fila reservada por el webhook y todavía
--      sin procesar no puede confundirse con una respondida.
--
--   4. LOS CHECK DE COHERENCIA ENTRE LOS DOS EJES, cada uno con su CONTRAPRUEBA
--      al lado: una aserción negativa sin su positiva pasa en verde con el
--      constraint borrado.
--
--   5. LA COLUMNA NUEVA NO ABRE NADA. Deny-all sigue siendo deny-all, el grant
--      por columna alcanza a `service_role` y a nadie más, y la purga de 90
--      días conserva el motivo.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(34);

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
-- Fixtures — un courier, un seller, un contacto, y las SEIS formas de fila que
-- el job puede dejar. Es el escenario que antes producía un solo contador
-- borroso y ahora tiene que producir seis cifras separadas.
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-0000000000e1';
  s_a uuid := 'aaaaaaaa-1111-0000-0000-0000000000e1';
  u_a uuid := 'aaaaaaaa-3333-0000-0000-0000000000e1';
  c_1 uuid := 'aaaaaaaa-5555-0000-0000-0000000000e1';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values (t_a, 'Courier MOT A', 'Courier MOT A SpA', '76444444-4', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values (u_a, 'interno.a@mot.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values (s_a, t_a, 'Seller MOT A', '77444444-4', 'Contacto A', 'a@mot.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values (u_a, t_a, 'Interno A', 'interno', null, null, 'dueno', 'activo')
  on conflict (id) do nothing;

  insert into integraciones.whatsapp_contactos
    (id, tenant_id, seller_id, telefono_e164, etiqueta, origen, opt_in_estado, opt_in_en)
  values (c_1, t_a, s_a, '56933330001', 'Su número', 'perfil_seller', 'otorgado', now())
  on conflict (id) do nothing;

  -- (a) RESPONDIDA. Llegó hasta el final: clasificó y contestó.
  insert into integraciones.whatsapp_mensajes_entrantes
    (id, meta_message_id, telefono_e164, resolucion, tenant_id, seller_id, contacto_id,
     texto, texto_largo, clasificacion, hubo_match, motivo_no_respondido, recibido_en)
  values
    ('aaaaaaaa-7777-0000-0000-0000000000e1', 'wamid.MOT001', '56933330001', 'resuelto',
     t_a, s_a, c_1, 'RX-0001-0002', 12, 'codigo_interno', true, 'respondido', now() - interval '10 minutes'),

  -- (b) CANAL APAGADO. Identidad resuelta, nunca se clasificó nada.
    ('aaaaaaaa-7777-0000-0000-0000000000e2', 'wamid.MOT002', '56933330001', 'resuelto',
     t_a, s_a, c_1, null, null, null, null, 'canal_apagado', now() - interval '9 minutes'),

  -- (c) TOPE DE CONSULTAS. Misma forma que (b) en columnas, motivo distinto —
  --     que es exactamente lo que antes NO se podía distinguir.
    ('aaaaaaaa-7777-0000-0000-0000000000e3', 'wamid.MOT003', '56933330001', 'resuelto',
     t_a, s_a, c_1, null, null, null, null, 'tope_consultas', now() - interval '8 minutes'),

  -- (d) BARRIDO. Con su evidencia: flex_manual sin match. Antes ni se persistía.
    ('aaaaaaaa-7777-0000-0000-0000000000e4', 'wamid.MOT004', '56933330001', 'resuelto',
     t_a, s_a, c_1, '44760788901', 11, 'flex_manual', false, 'barrido_codigos', now() - interval '7 minutes'),

  -- (e) INTENTO flex_manual SIN match que NO cortó. Es el que hacía que el
  --     contador de barrido fuera un techo y no un número.
    ('aaaaaaaa-7777-0000-0000-0000000000e5', 'wamid.MOT005', '56933330001', 'resuelto',
     t_a, s_a, c_1, '44760788902', 11, 'flex_manual', false, 'respondido', now() - interval '6 minutes'),

  -- (f) PENDIENTE: reservada por el webhook, el job todavía no la tocó.
    ('aaaaaaaa-7777-0000-0000-0000000000e6', 'wamid.MOT006', '56933330001', 'resuelto',
     t_a, s_a, c_1, null, null, null, null, null, now() - interval '5 minutes');

  -- (g) y (h) SIN tenant: los dos motivos de las filas no resueltas.
  insert into integraciones.whatsapp_mensajes_entrantes
    (id, meta_message_id, telefono_e164, resolucion, motivo_no_respondido, recibido_en)
  values
    ('aaaaaaaa-7777-0000-0000-0000000000e7', 'wamid.MOT007', null, 'ilegible',
     'sin_alcance', now() - interval '4 minutes'),
    ('aaaaaaaa-7777-0000-0000-0000000000e8', 'wamid.MOT008', '56999990008', 'sin_contacto',
     'aviso_neutro_omitido', now() - interval '3 minutes');
end $$;

-- =============================================================================
-- BLOQUE 0 · Contrato de esquema
-- =============================================================================
select has_column('integraciones', 'whatsapp_mensajes_entrantes', 'motivo_no_respondido',
  'esquema: existe motivo_no_respondido — el POR QUÉ deja de ser una inferencia');

select col_is_null('integraciones', 'whatsapp_mensajes_entrantes', 'motivo_no_respondido',
  'esquema: es NULLABLE — el webhook reserva la fila antes de que el job decida nada');

-- ⚠️ LA DECISIÓN DE FORMA, FIJADA. Si alguien "simplifica" metiendo el motivo
-- como un valor más de `clasificacion`, este par se pone rojo: el motivo dejaría
-- de tener columna propia y `clasificacion` volvería a cargar dos significados
-- (el bug de `tipo_pedido`). Además rompería el detector de §6.1, porque
-- escribir el motivo ahí borraría el `flex_manual` que el corte cuenta.
select col_type_is('integraciones', 'whatsapp_mensajes_entrantes', 'motivo_no_respondido', 'text',
  'esquema: es text + CHECK, no un enum — misma forma que el resto del repo');

select has_index('integraciones', 'whatsapp_mensajes_entrantes', 'idx_whatsapp_entrantes_motivo',
  'esquema: índice del contador por courier y motivo — el desglose de /admin/whatsapp');

select has_index('integraciones', 'whatsapp_mensajes_entrantes', 'idx_whatsapp_entrantes_motivo_global',
  'esquema: índice de los motivos SIN tenant — se cuentan globales, como `resolucion`');

-- =============================================================================
-- BLOQUE 1 · EL CONJUNTO EXACTO DE VALORES — `set_eq`, jamás un conteo
-- =============================================================================
-- Se lee del CATÁLOGO (`pg_constraint`), no re-aplicando el DDL dentro del
-- test: el pgTAP que reponía el CHECK adentro pasaba en verde con el bug vivo.
-- Un conteo tampoco sirve: el 12-ago hubo 16 valores antes y 16 después, con
-- distinta lista.
select set_eq(
  $$select m[1]
      from pg_constraint c,
           lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') as m
     where c.conname = 'whatsapp_entrantes_motivo_valido'
       and c.conrelid = 'integraciones.whatsapp_mensajes_entrantes'::regclass$$,
  array['respondido', 'canal_apagado', 'tope_consultas', 'barrido_codigos',
        'sin_alcance', 'aviso_neutro_omitido'],
  'CHECK: la lista de motivos es EXACTAMENTE la esperada (set_eq, no un conteo)');

-- Y que la lista sea cerrada de verdad. Sin esto, un CHECK mal escrito
-- (`motivo_no_respondido is not null` a secas) pasaría el set_eq de arriba por
-- vacuidad, porque el extractor solo mira el texto del constraint.
select throws_ok(
  $$insert into integraciones.whatsapp_mensajes_entrantes
      (meta_message_id, telefono_e164, resolucion, motivo_no_respondido)
    values ('wamid.MOT100', '56999990100', 'sin_contacto', 'porque_si')$$,
  '23514',
  null,
  'CHECK: un motivo inventado se rechaza — la lista es cerrada, no decorativa');

-- CONTRAPRUEBA de la anterior: uno de la lista SÍ entra. Sin esto, un CHECK que
-- rechazara TODO (columna inutilizable) pasaría la aserción de arriba.
select lives_ok(
  $$insert into integraciones.whatsapp_mensajes_entrantes
      (meta_message_id, telefono_e164, resolucion, motivo_no_respondido)
    values ('wamid.MOT101', '56999990101', 'sin_contacto', 'aviso_neutro_omitido')$$,
  'contraprueba: un motivo de la lista SÍ entra — el CHECK no rechaza todo');

-- =============================================================================
-- BLOQUE 2 · `null` NO SIGNIFICA "SE RESPONDIÓ"
-- =============================================================================
-- Es la razón por la que el caso normal tiene valor propio. Si «respondido»
-- fuera el nulo, un job que murió a mitad y una respuesta exitosa serían la
-- misma fila — el fallo silencioso reintroducido por la puerta de al lado.

select results_eq(
  $$select count(*)::int from integraciones.whatsapp_mensajes_entrantes
     where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000e1'::uuid
       and motivo_no_respondido is null$$,
  $$values (1)$$,
  'pendiente: la fila reservada y no procesada queda con motivo NULL, sola en su categoría');

select results_eq(
  $$select count(*)::int from integraciones.whatsapp_mensajes_entrantes
     where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000e1'::uuid
       and motivo_no_respondido = 'respondido'$$,
  $$values (2)$$,
  'respondido: el caso normal tiene valor propio y no se confunde con la pendiente');

-- =============================================================================
-- BLOQUE 3 · LAS TRES CAUSAS, YA DISTINGUIBLES — el problema que cierra
-- =============================================================================
-- Antes las tres filas (b), (c) y (d) eran indistinguibles: (b) y (c) tenían
-- la MISMA forma en columnas y (d) ni siquiera se persistía como corte.

select results_eq(
  $$select motivo_no_respondido, count(*)::int
      from integraciones.whatsapp_mensajes_entrantes
     where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000e1'::uuid
       and motivo_no_respondido in ('canal_apagado', 'tope_consultas', 'barrido_codigos')
     group by motivo_no_respondido
     order by motivo_no_respondido$$,
  $$values ('barrido_codigos', 1), ('canal_apagado', 1), ('tope_consultas', 1)$$,
  'CONTADOR: las tres causas de corte se cuentan por separado — 1, 1 y 1, no "3 cortadas"');

-- El contador viejo (`clasificacion is null and hubo_match is null`) seguía
-- mezclando canal apagado, tope de consultas Y la pendiente. Esta aserción
-- documenta por qué no servía: tres cosas distintas, una sola cifra.
select results_eq(
  $$select count(*)::int from integraciones.whatsapp_mensajes_entrantes
     where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000e1'::uuid
       and resolucion = 'resuelto'
       and clasificacion is null and hubo_match is null$$,
  $$values (3)$$,
  'el contador viejo mezclaba TRES cosas (apagado + tope + pendiente): por eso no servía');

-- El corte por barrido deja de ser un TECHO. Dos intentos flex_manual sin
-- match, uno solo cortó.
select results_eq(
  $$select count(*)::int from integraciones.whatsapp_mensajes_entrantes
     where contacto_id = 'aaaaaaaa-5555-0000-0000-0000000000e1'::uuid
       and clasificacion = 'flex_manual' and hubo_match = false$$,
  $$values (2)$$,
  'barrido: hay DOS intentos numéricos sin match — el techo viejo diría "2 cortes"');

select results_eq(
  $$select count(*)::int from integraciones.whatsapp_mensajes_entrantes
     where contacto_id = 'aaaaaaaa-5555-0000-0000-0000000000e1'::uuid
       and motivo_no_respondido = 'barrido_codigos'$$,
  $$values (1)$$,
  'barrido: pero UNO solo cortó — el motivo da el número exacto, no un techo');

-- Los motivos sin tenant se cuentan globales, como `resolucion`: no son de
-- ningún courier.
select results_eq(
  $$select count(*)::int from integraciones.whatsapp_mensajes_entrantes
     where tenant_id is null and motivo_no_respondido = 'sin_alcance'$$,
  $$values (1)$$,
  'global: `sin_alcance` queda contado aunque no haya tenant al que atribuirlo');

-- =============================================================================
-- BLOQUE 4 · COHERENCIA ENTRE LOS DOS EJES, cada red con su contraprueba
-- =============================================================================

-- (1) Las tres compuertas del canal exigen identidad RESUELTA: ninguna se llega
--     a evaluar antes de tener tenant_id.
select throws_ok(
  $$insert into integraciones.whatsapp_mensajes_entrantes
      (meta_message_id, telefono_e164, resolucion, motivo_no_respondido)
    values ('wamid.MOT110', '56999990110', 'sin_contacto', 'canal_apagado')$$,
  '23514',
  null,
  'coherencia: `canal_apagado` sin identidad resuelta se rechaza — esa compuerta ni se evalúa');

select throws_ok(
  $$insert into integraciones.whatsapp_mensajes_entrantes
      (meta_message_id, telefono_e164, resolucion, tenant_id, seller_id, contacto_id, motivo_no_respondido)
    values ('wamid.MOT111', '56933330001', 'resuelto',
            'aaaaaaaa-0000-0000-0000-0000000000e1'::uuid,
            'aaaaaaaa-1111-0000-0000-0000000000e1'::uuid,
            'aaaaaaaa-5555-0000-0000-0000000000e1'::uuid,
            'sin_alcance')$$,
  '23514',
  null,
  'coherencia: `sin_alcance` en una fila RESUELTA se rechaza — se contradice con `resolucion`');

select lives_ok(
  $$insert into integraciones.whatsapp_mensajes_entrantes
      (meta_message_id, telefono_e164, resolucion, tenant_id, seller_id, contacto_id, motivo_no_respondido)
    values ('wamid.MOT112', '56933330001', 'resuelto',
            'aaaaaaaa-0000-0000-0000-0000000000e1'::uuid,
            'aaaaaaaa-1111-0000-0000-0000000000e1'::uuid,
            'aaaaaaaa-5555-0000-0000-0000000000e1'::uuid,
            'canal_apagado')$$,
  'contraprueba: `canal_apagado` CON identidad resuelta sí entra — la red no rechaza todo');

-- (2) El corte por barrido EXIGE su evidencia. Es lo que lo distingue: se
--     decide DESPUÉS de clasificar, contando sobre flex_manual + sin match.
select throws_ok(
  $$insert into integraciones.whatsapp_mensajes_entrantes
      (meta_message_id, telefono_e164, resolucion, tenant_id, seller_id, contacto_id,
       clasificacion, hubo_match, motivo_no_respondido)
    values ('wamid.MOT120', '56933330001', 'resuelto',
            'aaaaaaaa-0000-0000-0000-0000000000e1'::uuid,
            'aaaaaaaa-1111-0000-0000-0000000000e1'::uuid,
            'aaaaaaaa-5555-0000-0000-0000000000e1'::uuid,
            'codigo_interno', true, 'barrido_codigos')$$,
  '23514',
  null,
  'barrido: no se puede marcar sin su evidencia (flex_manual + sin match) — sería otro corte');

select throws_ok(
  $$insert into integraciones.whatsapp_mensajes_entrantes
      (meta_message_id, telefono_e164, resolucion, tenant_id, seller_id, contacto_id,
       motivo_no_respondido)
    values ('wamid.MOT121', '56933330001', 'resuelto',
            'aaaaaaaa-0000-0000-0000-0000000000e1'::uuid,
            'aaaaaaaa-1111-0000-0000-0000000000e1'::uuid,
            'aaaaaaaa-5555-0000-0000-0000000000e1'::uuid,
            'barrido_codigos')$$,
  '23514',
  null,
  'barrido: tampoco SIN clasificar — el corte de §6.1 solo se decide después de clasificar');

select lives_ok(
  $$insert into integraciones.whatsapp_mensajes_entrantes
      (meta_message_id, telefono_e164, resolucion, tenant_id, seller_id, contacto_id,
       clasificacion, hubo_match, motivo_no_respondido)
    values ('wamid.MOT122', '56933330001', 'resuelto',
            'aaaaaaaa-0000-0000-0000-0000000000e1'::uuid,
            'aaaaaaaa-1111-0000-0000-0000000000e1'::uuid,
            'aaaaaaaa-5555-0000-0000-0000000000e1'::uuid,
            'flex_manual', false, 'barrido_codigos')$$,
  'contraprueba: CON flex_manual + sin match, `barrido_codigos` sí entra');

-- (3) Simétrico: las dos compuertas que cortan ANTES de leer el texto no pueden
--     dejar clasificación. Si la dejaran, significaría que se leyó `operacion`
--     igual — o sea, que la compuerta no cortó nada.
select throws_ok(
  $$insert into integraciones.whatsapp_mensajes_entrantes
      (meta_message_id, telefono_e164, resolucion, tenant_id, seller_id, contacto_id,
       clasificacion, hubo_match, motivo_no_respondido)
    values ('wamid.MOT130', '56933330001', 'resuelto',
            'aaaaaaaa-0000-0000-0000-0000000000e1'::uuid,
            'aaaaaaaa-1111-0000-0000-0000000000e1'::uuid,
            'aaaaaaaa-5555-0000-0000-0000000000e1'::uuid,
            'codigo_interno', true, 'tope_consultas')$$,
  '23514',
  null,
  'tope: cortado por tope pero CON clasificación se rechaza — se habría leído operacion igual');

-- (4) Una fila resuelta marcada `respondido` clasificó algo: es la definición
--     de haber llegado al final del camino.
select throws_ok(
  $$insert into integraciones.whatsapp_mensajes_entrantes
      (meta_message_id, telefono_e164, resolucion, tenant_id, seller_id, contacto_id,
       motivo_no_respondido)
    values ('wamid.MOT140', '56933330001', 'resuelto',
            'aaaaaaaa-0000-0000-0000-0000000000e1'::uuid,
            'aaaaaaaa-1111-0000-0000-0000000000e1'::uuid,
            'aaaaaaaa-5555-0000-0000-0000000000e1'::uuid,
            'respondido')$$,
  '23514',
  null,
  'respondido: una fila resuelta sin clasificación no pudo responder nada de negocio');

-- CONTRAPRUEBA que además fija el caso del AVISO NEUTRO de §5: sin resolver, sí
-- se responde, y sin clasificación (el CHECK del tenant nulo la prohíbe).
select lives_ok(
  $$insert into integraciones.whatsapp_mensajes_entrantes
      (meta_message_id, telefono_e164, resolucion, motivo_no_respondido)
    values ('wamid.MOT141', '56999990141', 'sin_contacto', 'respondido')$$,
  '§5: el aviso neutro a un número sin contacto TAMBIÉN es `respondido`, y no clasifica nada');

-- ⚠️ Y la red vieja sigue mandando: el motivo NO le abre la puerta a datos de
-- negocio en una fila sin tenant. La columna se admite sin tenant porque es del
-- mismo tipo que `resolucion` (nuestra compuerta, no dato del courier); el
-- resto sigue prohibido.
select throws_ok(
  $$insert into integraciones.whatsapp_mensajes_entrantes
      (meta_message_id, telefono_e164, resolucion, motivo_no_respondido, texto, texto_largo)
    values ('wamid.MOT142', '56999990142', 'sin_contacto', 'respondido', 'hola', 4)$$,
  '23514',
  null,
  'minimización: el motivo no abre la puerta — sin tenant sigue sin guardarse texto');

-- =============================================================================
-- BLOQUE 5 · LA COLUMNA NUEVA NO ABRE NADA
-- =============================================================================
-- Un `grant` por columna hace que la columna nueva nazca sin privilegio para
-- NADIE, ni para service_role: sin el grant explícito de la migración el job
-- fallaría con 42501 en ejecución. Y `authenticated` no la gana por la puerta
-- de atrás.

select is(
  has_column_privilege('authenticated', 'integraciones.whatsapp_mensajes_entrantes', 'motivo_no_respondido', 'select'),
  false,
  'grant: `authenticated` NO lee `motivo_no_respondido` — la tabla sigue deny-all');

select is(
  has_column_privilege('service_role', 'integraciones.whatsapp_mensajes_entrantes', 'motivo_no_respondido', 'select'),
  true,
  'contraprueba: `service_role` SÍ lo lee — es quien arma el contador del backstage');

select is(
  has_column_privilege('service_role', 'integraciones.whatsapp_mensajes_entrantes', 'motivo_no_respondido', 'update'),
  true,
  'grant: `service_role` lo ESCRIBE por update — el job decide después de reservar la fila');

select is(
  has_column_privilege('service_role', 'integraciones.whatsapp_mensajes_entrantes', 'motivo_no_respondido', 'insert'),
  true,
  'grant: y también por insert, para el camino que ya nace decidido');

-- El grant de las OTRAS columnas no se tocó al agregar ésta: `texto` sigue
-- fuera de `authenticated` y `meta_message_id` sigue sin ser actualizable.
select is(
  has_column_privilege('authenticated', 'integraciones.whatsapp_mensajes_entrantes', 'texto', 'select'),
  false,
  'no-regresión: `texto` sigue fuera de `authenticated` después de la migración');

select is(
  has_column_privilege('service_role', 'integraciones.whatsapp_mensajes_entrantes', 'meta_message_id', 'update'),
  false,
  'no-regresión: `meta_message_id` sigue sin ser actualizable — la llave de idempotencia');

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000e1'::uuid,
  'aaaaaaaa-0000-0000-0000-0000000000e1'::uuid,
  'interno', 'dueno');

select throws_ok(
  'select motivo_no_respondido from integraciones.whatsapp_mensajes_entrantes',
  '42501',
  null,
  'deny-all: el dueño del courier no alcanza la columna nueva (42501, no "0 filas")');

select test_cerrar_sesion();

-- =============================================================================
-- BLOQUE 6 · LA PURGA DE 90 DÍAS CONSERVA EL MOTIVO
-- =============================================================================
-- «¿Este número estuvo barriendo códigos?» hay que poder responderla seis meses
-- después. El motivo acompaña a `clasificacion`, `hubo_match` y `texto_largo`
-- del otro lado de la purga.
do $$
begin
  insert into integraciones.whatsapp_mensajes_entrantes
    (id, meta_message_id, telefono_e164, resolucion, tenant_id, seller_id, contacto_id,
     texto, texto_largo, clasificacion, hubo_match, motivo_no_respondido, recibido_en)
  values
    ('aaaaaaaa-7777-0000-0000-0000000000e9', 'wamid.MOT200', '56933330001', 'resuelto',
     'aaaaaaaa-0000-0000-0000-0000000000e1'::uuid,
     'aaaaaaaa-1111-0000-0000-0000000000e1'::uuid,
     'aaaaaaaa-5555-0000-0000-0000000000e1'::uuid,
     '44760788903', 11, 'flex_manual', false, 'barrido_codigos', now() - interval '200 days');
end $$;

select lives_ok(
  $$select public.whatsapp_entrantes_purgar_texto(90, 100)$$,
  'purga: sigue corriendo con la columna nueva — no hubo que tocar la función');

select results_eq(
  $$select texto is null, motivo_no_respondido, clasificacion, hubo_match, texto_largo
      from integraciones.whatsapp_mensajes_entrantes
     where meta_message_id = 'wamid.MOT200'$$,
  $$values (true, 'barrido_codigos', 'flex_manual', false, 11)$$,
  'purga: se va el texto y SOBREVIVE el motivo — "¿estuvo barriendo?" se responde a los 6 meses');

select * from finish();
rollback;
