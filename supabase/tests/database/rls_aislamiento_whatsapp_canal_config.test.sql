-- =============================================================================
-- WhatsApp — configuración del canal de consulta: apagado por defecto y deny-all
-- =============================================================================
-- Migración probada:
--   20260920000002_integraciones_whatsapp_canal_consulta_config.sql
--
-- Alcance: `docs/arquitectura/conversacion-whatsapp.md` (§3, §6.1, §9).
--
-- Qué fija este archivo, en orden de importancia:
--
--   1. EL CANAL NACE APAGADO, POR LAS DOS VÍAS. El default de `canal_activo` es
--      `false`, y un courier SIN FILA se comporta exactamente igual que uno con
--      la fila en `false`. Lo segundo se prueba contra la función de lectura,
--      que es lo que hace que «cero filas» no pueda leerse como «encendido».
--
--   2. DENY-ALL CON 42501 EXPLÍCITO. Ni el dueño del courier ni el seller
--      alcanzan la tabla ni la función. Se prueba con el código de error y no
--      con «0 filas»: si el revoke se perdiera y solo quedara RLS sin
--      políticas, un select devolvería 0 filas y una prueba por conteo pasaría
--      en verde sin proteger nada.
--
--   3. LOS CHECK DE RANGO RECHAZAN DE VERDAD. Cada rechazo con su aceptación al
--      lado: un CHECK mal escrito que rechaza TODO pasaría en verde con solo la
--      mitad negativa. Es la lección del pgTAP que reponía el CHECK dentro del
--      propio test.
--
--   4. EL GRANT ES POR COLUMNA Y NO LLEGA A `authenticated`. Cada aserción
--      negativa de privilegios viene con su positiva sobre `service_role`: una
--      aserción mal escrita devuelve `false` para todo.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(41);

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
-- Tres couriers a propósito:
--   A → con fila, encendido a mano (el caso "Rutax lo habilitó").
--   B → con fila creada SIN tocar canal_activo (prueba el DEFAULT).
--   C → SIN FILA (prueba que la ausencia equivale a apagado).
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-0000000000c1';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-0000000000c2';
  t_c uuid := 'cccccccc-0000-0000-0000-0000000000c3';
  s_a uuid := 'aaaaaaaa-1111-0000-0000-0000000000c1';
  u_interno_a uuid := 'aaaaaaaa-3333-0000-0000-0000000000c1';
  u_seller_a  uuid := 'aaaaaaaa-3333-0000-0000-0000000000c3';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier CFG A', 'Courier CFG A SpA', '76444444-4', 'activo'),
    (t_b, 'Courier CFG B', 'Courier CFG B SpA', '76555555-5', 'activo'),
    (t_c, 'Courier CFG C', 'Courier CFG C SpA', '76666666-6', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_interno_a, 'interno.a@cfg.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,  'seller.a@cfg.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values (s_a, t_a, 'Seller CFG A', '77444444-4', 'Contacto A', 'a@cfg.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a, t_a, 'Interno A', 'interno', null, null, 'dueno',  'activo'),
    (u_seller_a,  t_a, 'Seller A',  'seller',  s_a,  null, 'seller', 'activo')
  on conflict (id) do nothing;

  -- A: Rutax lo encendió y dejó su firma.
  insert into integraciones.whatsapp_canal_consulta_config
    (tenant_id, canal_activo, tope_consultas_hora, tope_intentos_sin_match_hora,
     actualizado_por, nota)
  values (t_a, true, 30, 8, u_interno_a, 'Piloto con el courier grande')
  on conflict (tenant_id) do nothing;

  -- B: fila creada sin tocar NADA. Es la que prueba los defaults.
  insert into integraciones.whatsapp_canal_consulta_config (tenant_id)
  values (t_b)
  on conflict (tenant_id) do nothing;

  -- C: a propósito, NINGUNA fila.
end $$;

-- =============================================================================
-- BLOQUE 0 · Contrato de esquema
-- =============================================================================
select has_table('integraciones', 'whatsapp_canal_consulta_config',
  'esquema: existe integraciones.whatsapp_canal_consulta_config');

select hasnt_view('public', 'whatsapp_canal_consulta_config',
  'esquema: NO hay vista espejo en public — PostgREST no tiene por dónde entrar');

-- Decisión del usuario: acá NO se repite el nullable de la tabla de entrantes.
-- Una fila por courier, sin fila global y sin orden de precedencia implícito.
select col_not_null('integraciones', 'whatsapp_canal_consulta_config', 'tenant_id',
  'esquema: tenant_id es NOT NULL — no hay fila global, una fila por courier');

select col_is_pk('integraciones', 'whatsapp_canal_consulta_config', 'tenant_id',
  'esquema: tenant_id es la PK — una sola configuración por courier, impuesta por la base');

select col_is_fk('integraciones', 'whatsapp_canal_consulta_config', 'tenant_id',
  'esquema: tenant_id es FK a identidad.tenants — la config se va con el courier');

select has_function('public', 'whatsapp_canal_consulta_config', array['uuid'],
  'esquema: existe la lectura fail-closed; el "cero filas" no se interpreta en el llamador');

-- =============================================================================
-- BLOQUE 1 · EL CANAL NACE APAGADO (lo más importante de la migración)
-- =============================================================================

-- (a) El default de la columna, afirmado sobre el catálogo. Si alguien lo
--     cambia a true, esto se pone rojo antes de que un courier reciba una
--     respuesta con copy sin revisar.
select col_default_is('integraciones', 'whatsapp_canal_consulta_config',
  'canal_activo', 'false',
  'apagado: el DEFAULT de canal_activo es false — el copy todavía no pasó por copywriter');

-- (b) Y el default de verdad, sobre una fila real creada sin tocar la columna.
--     El catálogo puede decir `false` y un trigger podría pisarlo.
select results_eq(
  $$select canal_activo, tope_consultas_hora, tope_intentos_sin_match_hora
      from integraciones.whatsapp_canal_consulta_config
     where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000000c2'::uuid$$,
  $$values (false, 20, 5)$$,
  'apagado: una fila creada sin tocar nada nace apagada y con los topes de §9 y §6.1');

-- ⚠️ CONTRAPRUEBA: la afirmación de arriba no puede ser "siempre false". El
-- courier que Rutax SÍ encendió tiene que leerse encendido, o lo anterior
-- estaría probando una columna rota.
select results_eq(
  $$select canal_activo, tope_consultas_hora, tope_intentos_sin_match_hora
      from integraciones.whatsapp_canal_consulta_config
     where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000c1'::uuid$$,
  $$values (true, 30, 8)$$,
  'contraprueba: el courier que Rutax encendió a mano SÍ queda encendido');

-- (c) LA AUSENCIA DE FILA ES APAGADO. Esta es la mitad que un select crudo no
--     da: `where tenant_id = C` devuelve CERO FILAS, no `false`.
select is_empty(
  $$select 1 from integraciones.whatsapp_canal_consulta_config
     where tenant_id = 'cccccccc-0000-0000-0000-0000000000c3'::uuid$$,
  'ausencia: el courier C no tiene fila — el select crudo devuelve cero filas, no false');

select results_eq(
  $$select canal_activo, tope_consultas_hora, tope_intentos_sin_match_hora, configurado
      from public.whatsapp_canal_consulta_config('cccccccc-0000-0000-0000-0000000000c3'::uuid)$$,
  $$values (false, 20, 5, false)$$,
  'fail-closed: sin fila, la lectura devuelve UNA fila apagada — no cero filas');

select results_eq(
  $$select count(*)::int from public.whatsapp_canal_consulta_config('cccccccc-0000-0000-0000-0000000000c3'::uuid)$$,
  $$values (1)$$,
  'fail-closed: la función SIEMPRE devuelve exactamente una fila, haya config o no');

-- Contraprueba de la función: con fila, devuelve lo configurado y `configurado`
-- distingue «apagado porque sí» de «apagado porque nadie lo configuró».
select results_eq(
  $$select canal_activo, tope_consultas_hora, tope_intentos_sin_match_hora, configurado
      from public.whatsapp_canal_consulta_config('aaaaaaaa-0000-0000-0000-0000000000c1'::uuid)$$,
  $$values (true, 30, 8, true)$$,
  'fail-closed: con fila, la función devuelve lo configurado y marca configurado=true');

select results_eq(
  $$select canal_activo, configurado
      from public.whatsapp_canal_consulta_config('bbbbbbbb-0000-0000-0000-0000000000c2'::uuid)$$,
  $$values (false, true)$$,
  'fail-closed: `configurado` distingue "apagado a mano" de "nunca configurado"');

-- =============================================================================
-- BLOQUE 2 · Los CHECK de rango, cada rechazo con su aceptación
-- =============================================================================

select throws_ok(
  $$insert into integraciones.whatsapp_canal_consulta_config (tenant_id, tope_consultas_hora)
    values ('cccccccc-0000-0000-0000-0000000000c3'::uuid, 0)$$,
  '23514',
  null,
  'rango: un tope de 0 consultas/hora se rechaza — sería el canal apagado por la puerta de atrás');

select throws_ok(
  $$insert into integraciones.whatsapp_canal_consulta_config (tenant_id, tope_consultas_hora)
    values ('cccccccc-0000-0000-0000-0000000000c3'::uuid, -1)$$,
  '23514',
  null,
  'rango: un tope negativo se rechaza');

select throws_ok(
  $$insert into integraciones.whatsapp_canal_consulta_config (tenant_id, tope_consultas_hora)
    values ('cccccccc-0000-0000-0000-0000000000c3'::uuid, 5000)$$,
  '23514',
  null,
  'rango: un tope "generoso" puesto de apuro apagaría la protección sin apagar nada visible');

-- ⚠️ CONTRAPRUEBA de las tres anteriores: el CHECK no rechaza TODO.
select lives_ok(
  $$insert into integraciones.whatsapp_canal_consulta_config (tenant_id, tope_consultas_hora)
    values ('cccccccc-0000-0000-0000-0000000000c3'::uuid, 50)$$,
  'contraprueba: un tope dentro de rango SÍ entra — el CHECK no rechaza todo');

select lives_ok(
  $$delete from integraciones.whatsapp_canal_consulta_config
     where tenant_id = 'cccccccc-0000-0000-0000-0000000000c3'::uuid$$,
  'limpieza: se retira la fila de prueba del courier C');

select throws_ok(
  $$insert into integraciones.whatsapp_canal_consulta_config
      (tenant_id, tope_intentos_sin_match_hora)
    values ('cccccccc-0000-0000-0000-0000000000c3'::uuid, 0)$$,
  '23514',
  null,
  'rango: un corte por barrido de 0 se rechaza — cortaría el canal al primer intento');

select throws_ok(
  $$insert into integraciones.whatsapp_canal_consulta_config
      (tenant_id, tope_consultas_hora, tope_intentos_sin_match_hora)
    values ('cccccccc-0000-0000-0000-0000000000c3'::uuid, 200, 150)$$,
  '23514',
  null,
  'rango: el corte por barrido no pasa de 100');

-- El invariante entre los dos topes: un sondeo sin match TAMBIÉN es una
-- consulta. Si el corte por barrido fuera más alto que el tope general, el
-- general cortaría primero siempre y el de §6.1 no se ejecutaría jamás — una
-- protección muerta que el backstage muestra como viva.
select throws_ok(
  $$insert into integraciones.whatsapp_canal_consulta_config
      (tenant_id, tope_consultas_hora, tope_intentos_sin_match_hora)
    values ('cccccccc-0000-0000-0000-0000000000c3'::uuid, 10, 20)$$,
  '23514',
  null,
  'coherencia: el corte por barrido no puede superar al tope general — nunca se dispararía');

select lives_ok(
  $$insert into integraciones.whatsapp_canal_consulta_config
      (tenant_id, tope_consultas_hora, tope_intentos_sin_match_hora)
    values ('cccccccc-0000-0000-0000-0000000000c3'::uuid, 10, 10)$$,
  'contraprueba: iguales SÍ se acepta — el corte es <=, no <');

-- El mismo invariante tiene que resistir un UPDATE, no solo el INSERT: el
-- backstage edita filas existentes, que es por donde entraría el valor malo.
select throws_ok(
  $$update integraciones.whatsapp_canal_consulta_config
       set tope_consultas_hora = 5
     where tenant_id = 'cccccccc-0000-0000-0000-0000000000c3'::uuid$$,
  '23514',
  null,
  'coherencia: bajar el tope general por debajo del corte por barrido también se rechaza');

select lives_ok(
  $$delete from integraciones.whatsapp_canal_consulta_config
     where tenant_id = 'cccccccc-0000-0000-0000-0000000000c3'::uuid$$,
  'limpieza: el courier C vuelve a quedar SIN fila');

-- Una sola fila por courier: el segundo INSERT choca contra la PK. Si esto se
-- perdiera, dos filas del mismo tenant darían respuestas distintas según el
-- orden de lectura.
select throws_ok(
  $$insert into integraciones.whatsapp_canal_consulta_config (tenant_id)
    values ('aaaaaaaa-0000-0000-0000-0000000000c1'::uuid)$$,
  '23505',
  null,
  'unicidad: un courier no puede tener dos configuraciones');

-- =============================================================================
-- BLOQUE 3 · DENY-ALL, con 42501 explícito
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000c1'::uuid,
  'aaaaaaaa-0000-0000-0000-0000000000c1'::uuid,
  'interno', 'dueno');

select throws_ok(
  'select count(*) from integraciones.whatsapp_canal_consulta_config',
  '42501',
  null,
  'deny-all: el DUEÑO del courier no alcanza su propia configuración — la administra Rutax');

-- Ni siquiera el interruptor, que es lo que el courier querría tocar.
select throws_ok(
  'select canal_activo from integraciones.whatsapp_canal_consulta_config',
  '42501',
  null,
  'deny-all: el courier no puede leer si su canal está encendido');

-- ⚠️ CONTRAPRUEBA DEL TIPO DE BARRERA: tampoco una columna inocua. Las dos
-- juntas dicen que la barrera es la tabla entera y no un filtro por columna.
select throws_ok(
  'select creado_en from integraciones.whatsapp_canal_consulta_config',
  '42501',
  null,
  'deny-all: ni una columna inocua — la barrera es la tabla, no una columna');

select throws_ok(
  $$update integraciones.whatsapp_canal_consulta_config set canal_activo = true$$,
  '42501',
  null,
  'deny-all: el courier no puede encenderse el canal a sí mismo');

select throws_ok(
  $$select * from public.whatsapp_canal_consulta_config('aaaaaaaa-0000-0000-0000-0000000000c1'::uuid)$$,
  '42501',
  null,
  'deny-all: la función security definer tampoco es una puerta — sin EXECUTE para el courier');

select test_cerrar_sesion();

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000c3'::uuid,
  'aaaaaaaa-0000-0000-0000-0000000000c1'::uuid,
  'seller', 'seller',
  'aaaaaaaa-1111-0000-0000-0000000000c1'::uuid);

select throws_ok(
  'select count(*) from integraciones.whatsapp_canal_consulta_config',
  '42501',
  null,
  'deny-all: el seller tampoco llega a la configuración del canal por el que consulta');

select test_cerrar_sesion();

-- =============================================================================
-- BLOQUE 4 · El GRANT por columna, afirmado sobre el catálogo
-- =============================================================================
-- El bloque anterior prueba el HOY. Éste prueba el MAÑANA: el día que alguien
-- agregue una columna o copie la lista del grant, esto es lo que se pone rojo.
--
-- Cada negativa con su positiva al lado: una aserción de privilegios mal escrita
-- devuelve `false` para TODO y pasaría en verde con la tabla abierta de par en
-- par.

select is(
  has_column_privilege('authenticated', 'integraciones.whatsapp_canal_consulta_config', 'canal_activo', 'select'),
  false,
  'grant: `authenticated` NO tiene select sobre canal_activo');

select is(
  has_column_privilege('service_role', 'integraciones.whatsapp_canal_consulta_config', 'canal_activo', 'select'),
  true,
  'contraprueba: `service_role` SÍ lo tiene — la aserción de privilegios está bien escrita');

select is(
  has_column_privilege('anon', 'integraciones.whatsapp_canal_consulta_config', 'tope_consultas_hora', 'select'),
  false,
  'grant: `anon` no lee los topes — publicarlos es publicar cómo evadirlos');

select is(
  has_column_privilege('authenticated', 'integraciones.whatsapp_canal_consulta_config', 'canal_activo', 'update'),
  false,
  'grant: `authenticated` no puede escribir el interruptor');

select is(
  has_column_privilege('service_role', 'integraciones.whatsapp_canal_consulta_config', 'canal_activo', 'update'),
  true,
  'contraprueba: `service_role` SÍ puede — el backstage escribe por ahí');

-- `tenant_id` queda fuera del UPDATE a propósito: mover la configuración de un
-- courier a otro con un update sería pisarle el canal al tenant equivocado sin
-- que nada se queje. Se borra y se crea.
select is(
  has_column_privilege('service_role', 'integraciones.whatsapp_canal_consulta_config', 'tenant_id', 'update'),
  false,
  'grant: ni service_role puede mover la fila de tenant con un update');

select is(
  has_column_privilege('service_role', 'integraciones.whatsapp_canal_consulta_config', 'tenant_id', 'insert'),
  true,
  'contraprueba: service_role SÍ puede escribir tenant_id al crear la fila');

select is(
  has_function_privilege('authenticated', 'public.whatsapp_canal_consulta_config(uuid)', 'execute'),
  false,
  'grant: `authenticated` no ejecuta la lectura de configuración');

select is(
  has_function_privilege('service_role', 'public.whatsapp_canal_consulta_config(uuid)', 'execute'),
  true,
  'contraprueba: `service_role` SÍ la ejecuta — es como lee el job de conversacion');

select * from finish();
rollback;
