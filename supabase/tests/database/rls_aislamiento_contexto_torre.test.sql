-- =============================================================================
-- Pruebas de aislamiento RLS — schema `contexto` (Torre de control)
-- =============================================================================
-- Este archivo defiende una EXCEPCIÓN a una regla no-negociable del proyecto:
-- seis de las tablas del schema `contexto` no llevan `tenant_id` porque el clima
-- de Santiago no es dato de ningún courier. La excepción solo se sostiene si el
-- carve-out es real, así que aquí se demuestra contra una base Postgres real:
--
--   BLOQUE 1 · Las 8 GLOBALES son deny-all: RLS enable+force SIN políticas.
--   BLOQUE 2 · Ni `authenticated` ni `anon` tienen privilegio sobre ellas, y el
--              SELECT real falla con 42501 — pese a que `authenticated` SÍ tiene
--              USAGE sobre el schema (lo necesita para las vistas
--              security_invoker de las tablas por tenant). USAGE no es lectura.
--   BLOQUE 3 · Ninguna global tiene vista espejo en `public`: no hay superficie
--              PostgREST. Es el vector real — el gotcha verificado del repo fue
--              exactamente una tabla alcanzable vía Accept-Profile.
--   BLOQUE 4 · Aislamiento cross-tenant en las 3 tablas POR TENANT.
--   BLOQUE 5 · Seller y conductor ven 0 filas y reciben 42501 al escribir.
--   BLOQUE 6 · Los cerrojos de integridad: la FK compuesta rechaza la zona de
--              otro tenant, y el trigger rechaza `zonas_afectadas` intrusas.
--
-- Mecanismo idéntico al resto de la suite: se simula el JWT fijando
-- `request.jwt.claims` y conmutando el rol a `authenticated`.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(28);

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
-- Fixtures: dos tenants (A y B), cada uno con su zona. Tenant A tiene interno,
-- seller y conductor. Se inserta como `postgres` (bypassa RLS).
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-0000000000c1';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-0000000000c2';

  s_a uuid := 'aaaaaaaa-1111-0000-0000-0000000000c1';
  d_a uuid := 'aaaaaaaa-2222-0000-0000-0000000000c1';

  u_interno_a   uuid := 'aaaaaaaa-3333-0000-0000-0000000000c1';
  u_seller_a    uuid := 'aaaaaaaa-3333-0000-0000-0000000000c2';
  u_conductor_a uuid := 'aaaaaaaa-3333-0000-0000-0000000000c3';

  z_a uuid := 'aaaaaaaa-7777-0000-0000-0000000000c1';
  z_b uuid := 'bbbbbbbb-7777-0000-0000-0000000000c2';

  sen_1 uuid := 'cccccccc-9999-0000-0000-0000000000c1';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier Torre A', 'Courier Torre A SpA', '76911111-1', 'activo'),
    (t_b, 'Courier Torre B', 'Courier Torre B SpA', '76922222-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_interno_a,   'interno.a@torre.test',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,    'seller.a@torre.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a, 'conductor.a@torre.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values (s_a, t_a, 'Seller Torre A', '77911111-1', 'Contacto A', 'c.a@torre.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values (d_a, t_a, 'Conductor Torre A', '78911111-1', 'dependiente', 'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a,   t_a, 'Interno A',   'interno',   null, null, 'dueno',     'activo'),
    (u_seller_a,    t_a, 'Seller A',    'seller',    s_a,  null, 'seller',    'activo'),
    (u_conductor_a, t_a, 'Conductor A', 'conductor', null, d_a,  'conductor', 'activo')
  on conflict (id) do nothing;

  insert into identidad.zonas (id, tenant_id, nombre, activa)
  values
    (z_a, t_a, 'Oriente', true),
    (z_b, t_b, 'Oriente', true)   -- mismo nombre, otro tenant
  on conflict (id) do nothing;

  -- Riesgo: una fila por tenant, misma fecha y franja.
  insert into contexto.riesgo_zona
    (tenant_id, zona_id, fecha, franja, puntaje, desglose, pedidos_pendientes, monto_comprometido_clp)
  values
    (t_a, z_a, date '2026-07-25', 'punta', 81, '{"franja_dominante":"punta"}'::jsonb, 86, 486200),
    (t_b, z_b, date '2026-07-25', 'punta', 31, '{"franja_dominante":"punta"}'::jsonb, 62, 298400)
  on conflict do nothing;

  -- Marcas operativas: una por tenant. `nota` con PII deliberada (es el caso real).
  insert into contexto.marcas_operativas
    (tenant_id, lat, long, radio_m, nota, vigencia_inicio, autor_usuario_id)
  values
    (t_a, -33.4152, -70.6634, 600, 'Corte en Independencia por feria. Confirmado por Marcelo.', now(), u_interno_a),
    (t_b, -33.5000, -70.7000, 500, 'Marca del courier B — el A jamás debe verla.', now(), null)
  on conflict do nothing;

  -- Señal GLOBAL (una sola, compartida) + su parte por tenant (una por courier).
  insert into contexto.senales
    (id, titulo, resumen, tipo, comunas, severidad, confianza, afecta_operacion, hash_dedup)
  values
    (sen_1, 'Cierre perimetral en Ñuñoa', 'Carabineros informa desvíos.', 'corte_transito',
     array['Ñuñoa'], 'media', 0.86, true, 'pgtap-torre-hash-1')
  on conflict (id) do nothing;

  insert into contexto.senales_tenant
    (tenant_id, senal_id, pedidos_en_rango, zonas_afectadas)
  values
    (t_a, sen_1, 24, array[z_a]),
    (t_b, sen_1, 99, array[z_b])   -- volumen de B: el A no puede verlo
  on conflict do nothing;
end $$;

-- =============================================================================
-- BLOQUE 1 · Las 8 globales son deny-all (RLS enable + force, CERO políticas)
-- =============================================================================

-- Test 1 · Las 8 tienen RLS enable + force.
select results_eq(
  $$ select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'contexto'
       and c.relkind = 'r'
       and c.relrowsecurity
       and c.relforcerowsecurity
       and c.relname in ('clima_horario','aire_horario','eventos_ciudad','calendario',
                         'eventos_comerciales','restriccion_vehicular','senales','fuentes_estado') $$,
  $$ values (8) $$,
  'Las 8 tablas globales de contexto tienen RLS enable + force'
);

-- Test 2 · Ninguna tiene políticas: deny-by-default real, no una política laxa.
select is_empty(
  $$ select tablename from pg_policies
     where schemaname = 'contexto'
       and tablename in ('clima_horario','aire_horario','eventos_ciudad','calendario',
                         'eventos_comerciales','restriccion_vehicular','senales','fuentes_estado') $$,
  'Ninguna tabla global tiene políticas RLS: nadie pasa salvo BYPASSRLS'
);

-- =============================================================================
-- BLOQUE 2 · Privilegios: authenticated/anon fuera; service_role dentro
-- =============================================================================

-- Test 3 · `authenticated` sin SELECT sobre ninguna global.
select ok(
  not bool_or(has_table_privilege('authenticated', t, 'SELECT')),
  'authenticated NO tiene SELECT sobre ninguna de las 8 tablas globales'
) from unnest(array[
  'contexto.clima_horario','contexto.aire_horario','contexto.eventos_ciudad',
  'contexto.calendario','contexto.eventos_comerciales','contexto.restriccion_vehicular',
  'contexto.senales','contexto.fuentes_estado'
]) as t;

-- Test 4 · `anon` tampoco.
select ok(
  not bool_or(has_table_privilege('anon', t, 'SELECT')),
  'anon NO tiene SELECT sobre ninguna de las 8 tablas globales'
) from unnest(array[
  'contexto.clima_horario','contexto.aire_horario','contexto.eventos_ciudad',
  'contexto.calendario','contexto.eventos_comerciales','contexto.restriccion_vehicular',
  'contexto.senales','contexto.fuentes_estado'
]) as t;

-- Test 5 · `service_role` sí lee: es quien alimenta el composer.
select ok(
  bool_and(has_table_privilege('service_role', t, 'SELECT')),
  'service_role SÍ tiene SELECT sobre las 8 tablas globales'
) from unnest(array[
  'contexto.clima_horario','contexto.aire_horario','contexto.eventos_ciudad',
  'contexto.calendario','contexto.eventos_comerciales','contexto.restriccion_vehicular',
  'contexto.senales','contexto.fuentes_estado'
]) as t;

-- Test 6 · `anon` no tiene ni USAGE sobre el schema.
select ok(
  not has_schema_privilege('anon', 'contexto', 'USAGE'),
  'anon NO tiene USAGE sobre el schema contexto'
);

-- Test 7 · `authenticated` SÍ tiene USAGE — lo necesita para las vistas
--          security_invoker. Este test fija la premisa del test 8: el bloqueo
--          NO viene de la falta de USAGE, viene de la falta de privilegio de tabla.
select ok(
  has_schema_privilege('authenticated', 'contexto', 'USAGE'),
  'authenticated SÍ tiene USAGE sobre el schema (lo exigen las vistas security_invoker)'
);

-- -----------------------------------------------------------------------------
-- Denegación REAL como usuario interno del tenant A (no solo catálogo).
-- El interno es el rol MÁS privilegiado del courier: si él no llega, nadie llega.
-- -----------------------------------------------------------------------------
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000c1'::uuid,
  'aaaaaaaa-0000-0000-0000-0000000000c1'::uuid,
  'interno', 'dueno'
);

-- Test 8 · Clima: 42501 pese a tener USAGE sobre el schema.
select throws_ok(
  $$ select * from contexto.clima_horario $$,
  '42501',
  null,
  'SELECT en contexto.clima_horario como interno falla con 42501'
);

-- Test 9 · Señales: la tabla global de prensa tampoco es alcanzable.
select throws_ok(
  $$ select * from contexto.senales $$,
  '42501',
  null,
  'SELECT en contexto.senales como interno falla con 42501'
);

-- Test 10 · Escritura sobre una global: tampoco.
select throws_ok(
  $$ insert into contexto.calendario (fecha, tipo, nombre) values (date '2026-09-18', 'feriado', 'x') $$,
  '42501',
  null,
  'INSERT en contexto.calendario como interno falla con 42501'
);

select test_cerrar_sesion();

-- =============================================================================
-- BLOQUE 3 · Ninguna global tiene vista espejo en `public`
-- -----------------------------------------------------------------------------
-- Es el vector que ya mordió a este repo: la superficie de PostgREST es
-- `public`, y una vista ahí vuelve alcanzable lo que la tabla base protegía.
-- =============================================================================

-- Test 11 · Cero vistas en public con el nombre de una global.
select is_empty(
  $$ select table_name from information_schema.views
     where table_schema = 'public'
       and table_name in ('clima_horario','aire_horario','eventos_ciudad','calendario',
                          'eventos_comerciales','restriccion_vehicular','senales','fuentes_estado') $$,
  'Ninguna tabla global tiene vista espejo en public: sin superficie PostgREST'
);

-- Test 12 · Las 3 por tenant SÍ tienen su vista, y con security_invoker.
select results_eq(
  $$ select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'v'
       and c.relname in ('riesgo_zona','marcas_operativas','senales_tenant')
       and c.reloptions @> array['security_invoker=true'] $$,
  $$ values (3) $$,
  'Las 3 tablas por tenant exponen vista en public con security_invoker = true'
);

-- =============================================================================
-- BLOQUE 4 · Aislamiento cross-tenant en las 3 tablas por tenant
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000c1'::uuid,
  'aaaaaaaa-0000-0000-0000-0000000000c1'::uuid,
  'interno', 'dueno'
);

-- Test 13 · riesgo_zona: solo la fila del tenant A.
select results_eq(
  $$ select puntaje::int from public.riesgo_zona $$,
  $$ values (81) $$,
  'Interno de A ve SOLO el riesgo de su tenant (81), no el de B (31)'
);

-- Test 14 · marcas_operativas: solo la suya. La nota de B no se filtra.
select results_eq(
  $$ select count(*)::int from public.marcas_operativas
     where nota like '%courier B%' $$,
  $$ values (0) $$,
  'Interno de A NO ve la marca operativa del tenant B'
);

-- Test 15 · senales_tenant: la señal global es una sola, pero el volumen es del
--           courier. A ve 24, jamás los 99 de B. Es la fuga que motivó desdoblar
--           el tipo `Senal` en tabla global + tabla por tenant.
select results_eq(
  $$ select pedidos_en_rango::int from public.senales_tenant $$,
  $$ values (24) $$,
  'Interno de A ve su volumen (24) y no el del tenant B (99) sobre la MISMA señal'
);

-- Test 16 · UPDATE cross-tenant: 0 filas afectadas (la USING no calza).
select lives_ok(
  $$ update public.riesgo_zona set puntaje = 1
     where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000000c2'::uuid $$,
  'UPDATE sobre riesgo_zona del tenant B no lanza error…'
);

-- Test 17 · …y, sobre todo, no cambió nada.
select test_cerrar_sesion();
select results_eq(
  $$ select puntaje::int from contexto.riesgo_zona
     where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000000c2'::uuid $$,
  $$ values (31) $$,
  'El riesgo del tenant B sigue intacto (31): el UPDATE cross-tenant no tocó nada'
);

-- Test 18 · DELETE cross-tenant tampoco borra.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000c1'::uuid,
  'aaaaaaaa-0000-0000-0000-0000000000c1'::uuid,
  'interno', 'dueno'
);
select lives_ok(
  $$ delete from public.marcas_operativas
     where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000000c2'::uuid $$,
  'DELETE sobre marcas del tenant B no lanza error (0 filas)'
);
select test_cerrar_sesion();

-- Test 19 · La marca de B sigue ahí.
select results_eq(
  $$ select count(*)::int from contexto.marcas_operativas
     where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000000c2'::uuid $$,
  $$ values (1) $$,
  'La marca operativa del tenant B sobrevivió al DELETE cross-tenant'
);

-- =============================================================================
-- BLOQUE 5 · Seller y conductor: 0 filas y 42501 al escribir
-- -----------------------------------------------------------------------------
-- La Torre es análisis operativo INTERNO. El seller no ve el riesgo de las zonas
-- ni el monto comprometido de su courier; el conductor tampoco.
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000c2'::uuid,
  'aaaaaaaa-0000-0000-0000-0000000000c1'::uuid,
  'seller', 'seller',
  'aaaaaaaa-1111-0000-0000-0000000000c1'::uuid, null
);

-- Test 20 · Seller: 0 filas en riesgo_zona (ni siquiera de su propio tenant).
select is_empty(
  $$ select 1 from public.riesgo_zona $$,
  'Seller ve 0 filas en riesgo_zona, incluso las de su propio courier'
);

-- Test 21 · Seller: 0 filas en marcas_operativas (la nota puede tener PII).
select is_empty(
  $$ select 1 from public.marcas_operativas $$,
  'Seller ve 0 filas en marcas_operativas (nota con posible PII)'
);

-- Test 22 · Seller: 0 filas en senales_tenant.
select is_empty(
  $$ select 1 from public.senales_tenant $$,
  'Seller ve 0 filas en senales_tenant'
);

-- Test 23 · Seller escribiendo: 42501 explícito, no un "0 filas" silencioso.
select throws_ok(
  $$ update public.riesgo_zona set puntaje = 0 $$,
  '42501',
  null,
  'UPDATE de seller en riesgo_zona lanza 42501 (guard solo_interno_edita)'
);

select test_cerrar_sesion();

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000c3'::uuid,
  'aaaaaaaa-0000-0000-0000-0000000000c1'::uuid,
  'conductor', 'conductor',
  null, 'aaaaaaaa-2222-0000-0000-0000000000c1'::uuid
);

-- Test 24 · Conductor: 0 filas en riesgo_zona.
select is_empty(
  $$ select 1 from public.riesgo_zona $$,
  'Conductor ve 0 filas en riesgo_zona'
);

-- Test 25 · Conductor: 0 filas en marcas_operativas.
select is_empty(
  $$ select 1 from public.marcas_operativas $$,
  'Conductor ve 0 filas en marcas_operativas'
);

-- Test 26 · Conductor escribiendo una marca: 42501.
select throws_ok(
  $$ insert into public.marcas_operativas (tenant_id, lat, long, radio_m, nota, vigencia_inicio)
     values ('aaaaaaaa-0000-0000-0000-0000000000c1'::uuid, -33.4, -70.6, 100, 'intento', now()) $$,
  '42501',
  null,
  'INSERT de conductor en marcas_operativas lanza 42501'
);

select test_cerrar_sesion();

-- =============================================================================
-- BLOQUE 6 · Cerrojos de integridad a nivel de motor
-- -----------------------------------------------------------------------------
-- Estos dos no dependen de RLS ni de la disciplina de la aplicación: son la FK
-- compuesta y un trigger. Se prueban como `postgres` (BYPASSRLS) justamente para
-- demostrar que ni siquiera un cliente con service_role puede cruzarlos.
-- =============================================================================

-- Test 27 · La FK compuesta rechaza una zona de OTRO tenant.
select throws_ok(
  $$ insert into contexto.riesgo_zona
       (tenant_id, zona_id, fecha, franja, puntaje)
     values ('aaaaaaaa-0000-0000-0000-0000000000c1'::uuid,
             'bbbbbbbb-7777-0000-0000-0000000000c2'::uuid,
             date '2026-07-26', 'tarde', 50) $$,
  '23503',
  null,
  'La FK compuesta (tenant_id, zona_id) rechaza la zona de otro tenant con 23503'
);

-- Test 28 · El trigger rechaza `zonas_afectadas` con una zona intrusa.
select throws_ok(
  $$ update contexto.senales_tenant
       set zonas_afectadas = array['bbbbbbbb-7777-0000-0000-0000000000c2'::uuid]
     where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000c1'::uuid $$,
  '23514',
  null,
  'El trigger rechaza con 23514 una zona de otro tenant en zonas_afectadas'
);

-- =============================================================================
-- Cierre
-- =============================================================================
select * from finish();

rollback;
