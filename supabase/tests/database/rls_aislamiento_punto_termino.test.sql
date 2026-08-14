-- =============================================================================
-- Aislamiento del punto de término de ruta del conductor (etapa 7)
-- =============================================================================
-- Migración bajo prueba: 20260814000003_operacion_punto_termino_conductor.sql
-- Fuente de verdad del diseño: docs/seguridad/punto-de-termino-conductor.md §6.3
--
-- QUÉ SE PROTEGE: `operacion.punto_termino_conductor` guarda dónde el conductor
-- pide TERMINAR su ruta — o sea, dónde vive. Es dato personal del trabajador
-- (Ley 21.431) y su base de licitud es el consentimiento. Bajo subordinación
-- laboral ese consentimiento solo es libre si negarse no queda a la vista del
-- jefe: por eso el aislamiento aquí no es "el coordinador no debería verlo",
-- es "el coordinador NO PUEDE verlo, ni saber que existe".
--
-- ⚠️ LO QUE ESTE ARCHIVO **NO** PRUEBA, y hay que decirlo para que nadie lo lea
-- como una garantía completa: el riesgo principal NO está en la base. El motor
-- de ruteo corre con `service_role`, que bypasea RLS por diseño; nada de lo que
-- se prueba aquí impide que el servidor serialice el ancla en las props que
-- viajan al navegador del coordinador. Esa mitad se prueba en Vitest
-- (comparar los DTO de dos conductores con las mismas paradas, uno con ancla y
-- otro sin ella, y exigir salida idéntica). Los 15 canales de fuga están en
-- §4.3 del documento.
--
-- ESTRUCTURA DEL ARCHIVO — se prueban DOS capas distintas, y el orden importa:
--
--   Sección 1 · La barrera de HOY: `authenticated` no tiene NINGÚN privilegio
--     sobre la tabla y no hay vista espejo en `public`. Todo intento de lectura
--     por PostgREST muere en 42501, incluso el del propio conductor. Esta es la
--     puerta cerrada de verdad.
--
--   Sección 2 · La POLÍTICA, ejercitada bajo un GRANT TEMPORAL que la propia
--     prueba otorga y que la transacción deshace. Simula el escenario que la
--     política existe para cubrir: "alguien agrega una vista (o un grant) sin
--     pensar". Sin esta sección la política sería incomprobable —nadie puede
--     llegar a ella— y el día que el grant apareciera nos enteraríamos en
--     producción. La Sección 1 corre ANTES y afirma que ese grant hoy NO está,
--     así que el grant temporal no puede tapar la ausencia del real.
--
--   Sección 3 · Escritura: ni con privilegio otorgado escribe una sesión de
--     usuario. No hay política de INSERT/UPDATE/DELETE: solo service_role.
--
--   Sección 4 · El trigger de redondeo a 3 decimales (~110 m). Vive en la BD y
--     no en TypeScript justamente para que un escritor con un bug no pueda
--     persistir la coordenada fina del domicilio de un trabajador.
--
--   Sección 5 · Consentimiento POR FINALIDAD: un consentimiento de punto de
--     término no autoriza el rastreo en vivo, ni al revés.
--
-- Fixtures con prefijo `7e` para no colisionar con otras suites.
-- Ejecutar: npx supabase test db
-- =============================================================================

begin;

select plan(26);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada (cada .test.sql vive en su propio BEGIN/ROLLBACK).
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
      'sub',          p_user_id,
      'role',         'authenticated',
      'tenant_id',    p_tenant_id,
      'tipo_usuario', p_tipo_usuario,
      'seller_id',    p_seller_id,
      'driver_id',    p_driver_id,
      'rol',          p_rol
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
--   Tenant A: seller s_a, conductores d_a1 y d_a2 (LOS DOS con punto de término
--     — así "conductor A1 no ve la fila de A2" no puede pasar por vacuidad),
--     internos dueño y coordinador, y un seller.
--   Tenant B: conductor d_b, también con punto de término (control positivo del
--     cross-tenant: prueba que el aislamiento filtra, no que la tabla esté
--     vacía).
--   Consentimientos: d_a1 tiene UNO de finalidad 'punto_termino_ruta' y NINGUNO
--     de 'rastreo_en_ruta' — es el fixture de la Sección 5.
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := '7e000000-0000-0000-0000-000000000001';
  t_b uuid := '7e000000-0000-0000-0000-000000000002';

  s_a uuid := '7e111111-0000-0000-0000-000000000001';

  d_a1 uuid := '7e222222-0000-0000-0000-000000000001';
  d_a2 uuid := '7e222222-0000-0000-0000-000000000002';
  d_b  uuid := '7e222222-0000-0000-0000-000000000003';

  u_dueno_a       uuid := '7e333333-0000-0000-0000-000000000001';
  u_coordinador_a uuid := '7e333333-0000-0000-0000-000000000002';
  u_seller_a      uuid := '7e333333-0000-0000-0000-000000000003';
  u_conductor_a1  uuid := '7e333333-0000-0000-0000-000000000004';
  u_conductor_b   uuid := '7e333333-0000-0000-0000-000000000005';
  u_super_admin   uuid := '7e333333-0000-0000-0000-000000000006';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Termino Courier A', 'Termino A SpA', '76551111-1', 'activo'),
    (t_b, 'Termino Courier B', 'Termino B SpA', '76552222-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_dueno_a,       'dueno.a@termino.test',       crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_coordinador_a, 'coordinador.a@termino.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,      'seller.a@termino.test',      crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a1,  'conductor.a1@termino.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_b,   'conductor.b@termino.test',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_super_admin,   'super@termino.test',         crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values (s_a, t_a, 'Seller Termino A', '77551111-1', 'Contacto A', 'sa@termino.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values
    (d_a1, t_a, 'Conductor A1 Termino', '78551111-1', 'dependiente',   'activo'),
    (d_a2, t_a, 'Conductor A2 Termino', '78552222-2', 'independiente', 'activo'),
    (d_b,  t_b, 'Conductor B Termino',  '78553333-3', 'dependiente',   'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_dueno_a,       t_a,  'Dueño A',       'interno',     null, null, 'dueno',       'activo'),
    (u_coordinador_a, t_a,  'Coordinador A', 'interno',     null, null, 'coordinador', 'activo'),
    (u_seller_a,      t_a,  'Seller A',      'seller',      s_a,  null, 'seller',      'activo'),
    (u_conductor_a1,  t_a,  'Conductor A1',  'conductor',   null, d_a1, 'conductor',   'activo'),
    (u_conductor_b,   t_b,  'Conductor B',   'conductor',   null, d_b,  'conductor',   'activo'),
    (u_super_admin,   null, 'Super Admin',   'super_admin', null, null, 'super_admin', 'activo')
  on conflict (id) do nothing;

  -- Los tres puntos de término. Se insertan como `postgres` (BYPASSRLS); el
  -- trigger de redondeo SÍ se evalúa, así que estos valores ya vienen a 3
  -- decimales para que las comparaciones de más abajo sean exactas.
  insert into operacion.punto_termino_conductor (conductor_id, tenant_id, lat, long, comuna)
  values
    (d_a1, t_a, -33.500, -70.700, 'Maipú'),
    (d_a2, t_a, -33.600, -70.580, 'La Florida'),
    (d_b,  t_b, -33.420, -70.600, 'Providencia')
  on conflict (conductor_id) do nothing;

  -- Consentimiento vigente SOLO de punto de término para d_a1.
  insert into operacion.consentimientos_ubicacion
    (tenant_id, conductor_id, acepto, version_texto, finalidad)
  values (t_a, d_a1, true, 'v2', 'punto_termino_ruta');
end $$;

-- =============================================================================
-- SECCIÓN 1 · La barrera de HOY: cero privilegios de cliente, cero vista espejo
-- =============================================================================
-- Es la puerta que de verdad está cerrada. Si cualquiera de estas cae, el
-- esquema `operacion` está expuesto a PostgREST (api.schemas en config.toml) y
-- la tabla queda a un `Accept-Profile: operacion` de distancia.

-- T1 ---------------------------------------------------------------------------
select ok(
  not has_table_privilege('authenticated', 'operacion.punto_termino_conductor', 'SELECT'),
  'T1: `authenticated` NO tiene SELECT sobre operacion.punto_termino_conductor '
  '(el esquema está expuesto a PostgREST: un grant aquí abre la tabla al mundo autenticado)'
);

-- T2 ---------------------------------------------------------------------------
select ok(
  not has_table_privilege('authenticated', 'operacion.punto_termino_conductor', 'INSERT')
  and not has_table_privilege('authenticated', 'operacion.punto_termino_conductor', 'UPDATE')
  and not has_table_privilege('authenticated', 'operacion.punto_termino_conductor', 'DELETE'),
  'T2: `authenticated` NO tiene INSERT/UPDATE/DELETE (escritura exclusiva de service_role)'
);

-- T3 ---------------------------------------------------------------------------
select ok(
  not has_table_privilege('anon', 'operacion.punto_termino_conductor', 'SELECT')
  and not has_table_privilege('anon', 'operacion.punto_termino_conductor', 'INSERT')
  and not has_table_privilege('anon', 'operacion.punto_termino_conductor', 'UPDATE')
  and not has_table_privilege('anon', 'operacion.punto_termino_conductor', 'DELETE'),
  'T3: `anon` no tiene ningún privilegio sobre la tabla'
);

-- T4 ---------------------------------------------------------------------------
-- No basta con "no hay vista": se comprueba que no exista NINGUNA relación con
-- ese nombre en `public` (tabla, vista o materializada).
select is_empty(
  $$ select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'punto_termino_conductor' $$,
  'T4: NO existe relación espejo public.punto_termino_conductor (el diseño no lleva vista)'
);

-- T5 ---------------------------------------------------------------------------
select ok(
  has_table_privilege('service_role', 'operacion.punto_termino_conductor', 'SELECT')
  and has_table_privilege('service_role', 'operacion.punto_termino_conductor', 'INSERT')
  and has_table_privilege('service_role', 'operacion.punto_termino_conductor', 'UPDATE')
  and has_table_privilege('service_role', 'operacion.punto_termino_conductor', 'DELETE'),
  'T5: service_role SÍ escribe (BYPASSRLS no reemplaza el GRANT SQL)'
);

-- T6 · El PROPIO conductor tampoco llega por PostgREST hoy ---------------------
select test_iniciar_sesion(
  '7e333333-0000-0000-0000-000000000004'::uuid, -- u_conductor_a1
  '7e000000-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => '7e222222-0000-0000-0000-000000000001'::uuid -- d_a1
);

select throws_ok(
  $$ select 1 from operacion.punto_termino_conductor $$,
  '42501',
  null,
  'T6: ni el propio conductor lee la tabla por PostgREST → 42501. Su punto le llega '
  'por ruta Bearer / Server Action con service_role, nunca por la API de datos'
);

-- T7 · Interno del tenant A → permission denied --------------------------------
select test_iniciar_sesion(
  '7e333333-0000-0000-0000-000000000001'::uuid, -- u_dueno_a
  '7e000000-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

select throws_ok(
  $$ select 1 from operacion.punto_termino_conductor $$,
  '42501',
  null,
  'T7: el DUEÑO del courier no puede ni consultar la tabla → 42501'
);

-- T8 · Seller del tenant A → permission denied ---------------------------------
select test_iniciar_sesion(
  '7e333333-0000-0000-0000-000000000003'::uuid, -- u_seller_a
  '7e000000-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => '7e111111-0000-0000-0000-000000000001'::uuid
);

select throws_ok(
  $$ select 1 from operacion.punto_termino_conductor $$,
  '42501',
  null,
  'T8: el seller no puede ni consultar la tabla → 42501'
);

-- =============================================================================
-- SECCIÓN 2 · La política, ejercitada bajo un GRANT TEMPORAL
-- =============================================================================
-- A partir de aquí se otorga `select` a `authenticated` SOLO dentro de esta
-- transacción, que termina en rollback. NO es un atajo: es la única forma de
-- ejercitar la política real que crea la migración, en vez de re-implementarla
-- en el test (el error clásico — un test que repone la regla que debía
-- comprobar pasa en verde sin probar nada).
--
-- La Sección 1 ya afirmó que este grant NO existe en el esquema real, así que
-- esto no puede enmascarar su ausencia. Lo que se prueba aquí es la segunda
-- línea de defensa: el día que alguien agregue una vista en `public` o un grant
-- "para que el panel muestre el mapa", la política tiene que seguir dejando
-- fuera al coordinador.
select test_cerrar_sesion();
grant select on operacion.punto_termino_conductor to authenticated;

-- T9 · El conductor ve SU fila -------------------------------------------------
select test_iniciar_sesion(
  '7e333333-0000-0000-0000-000000000004'::uuid, -- u_conductor_a1
  '7e000000-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => '7e222222-0000-0000-0000-000000000001'::uuid -- d_a1
);

select results_eq(
  $$ select conductor_id, lat, long, comuna
       from operacion.punto_termino_conductor $$,
  $$ values ('7e222222-0000-0000-0000-000000000001'::uuid,
             (-33.500)::double precision, (-70.700)::double precision, 'Maipú'::text) $$,
  'T9: el conductor A1 ve SU fila, y SOLO la suya (una fila exacta, no un is_empty complaciente)'
);

-- T10 · …y no la de su compañero de tenant ------------------------------------
select is_empty(
  $$ select 1 from operacion.punto_termino_conductor
      where conductor_id = '7e222222-0000-0000-0000-000000000002' $$, -- d_a2
  'T10: el conductor A1 NO ve el punto de término del conductor A2 (mismo tenant, otro trabajador)'
);

-- T11 · EL MÁS IMPORTANTE DEL ARCHIVO -----------------------------------------
-- Es la diferencia exacta con el molde `ubicacion_conductor`, cuya política SÍ
-- tenía rama `interno` (y por eso administración podía consultar dónde estaba un
-- conductor sin ninguna razón operativa). Aquí no hay rama que valga: el jefe no
-- puede ver el punto NI DEDUCIR QUIÉN LO DEFINIÓ, porque si pudiera, negarse
-- tendría costo visible y el consentimiento de todos los demás dejaría de ser
-- libre (Ley 21.431 · subordinación laboral).
select test_iniciar_sesion(
  '7e333333-0000-0000-0000-000000000001'::uuid, -- u_dueno_a
  '7e000000-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

select is_empty(
  $$ select 1 from operacion.punto_termino_conductor $$,
  'T11: el DUEÑO del tenant A no ve NINGUNA fila, ni siquiera con SELECT otorgado '
  '(la política NO tiene rama `interno` — esta es la diferencia con ubicacion_conductor)'
);

-- T12 · Coordinador: el que más "querría" verlo -------------------------------
select test_iniciar_sesion(
  '7e333333-0000-0000-0000-000000000002'::uuid, -- u_coordinador_a
  '7e000000-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'coordinador'
);

select is_empty(
  $$ select 1 from operacion.punto_termino_conductor $$,
  'T12: el COORDINADOR del tenant A no ve NINGUNA fila (es quien arma las rutas, y aun así no)'
);

-- T13 · Seller -----------------------------------------------------------------
select test_iniciar_sesion(
  '7e333333-0000-0000-0000-000000000003'::uuid, -- u_seller_a
  '7e000000-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => '7e111111-0000-0000-0000-000000000001'::uuid
);

select is_empty(
  $$ select 1 from operacion.punto_termino_conductor $$,
  'T13: el seller no ve NINGUNA fila (dónde vive el conductor de su courier no es asunto suyo)'
);

-- T14 · Cross-tenant: conductor del tenant B ----------------------------------
select test_iniciar_sesion(
  '7e333333-0000-0000-0000-000000000005'::uuid, -- u_conductor_b
  '7e000000-0000-0000-0000-000000000002'::uuid, -- t_b
  'conductor', 'conductor',
  p_driver_id => '7e222222-0000-0000-0000-000000000003'::uuid -- d_b
);

select is_empty(
  $$ select 1 from operacion.punto_termino_conductor
      where conductor_id in ('7e222222-0000-0000-0000-000000000001',
                             '7e222222-0000-0000-0000-000000000002') $$,
  'T14: el conductor del tenant B NO ve ninguna fila del tenant A (aislamiento entre couriers)'
);

-- T15 · Control positivo del cross-tenant --------------------------------------
-- Sin esto, T14 pasaría igual si la política filtrara TODO por un error: hay que
-- demostrar que el conductor B sí llega a lo suyo.
select results_eq(
  $$ select conductor_id from operacion.punto_termino_conductor $$,
  $$ values ('7e222222-0000-0000-0000-000000000003'::uuid) $$,
  'T15: …y el conductor del tenant B sí ve la suya — T14 filtra, no está vacío por error'
);

-- T15b · EL QUE HACE TRABAJAR AL FILTRO DE TENANT ------------------------------
-- Sin esta prueba, `tenant_id = claim_tenant_id()` sería decorativo: como la PK
-- es `conductor_id` y la política ya compara contra `claim_driver_id()`, un
-- conductor legítimo nunca alcanza la fila de otro tenant aunque se quite el
-- filtro. Lo que el filtro protege de verdad es el caso de CLAIMS CRUZADOS: un
-- JWT que dice tenant B pero lleva el `driver_id` de un conductor del tenant A
-- —un token viejo que sobrevivió a un cambio, o uno fabricado—. La RLS no puede
-- descansar en que la aplicación emita siempre claims coherentes: para eso es la
-- segunda barrera.
select test_iniciar_sesion(
  '7e333333-0000-0000-0000-000000000005'::uuid,  -- usuario del tenant B…
  '7e000000-0000-0000-0000-000000000002'::uuid,  -- …con tenant B…
  'conductor', 'conductor',
  p_driver_id => '7e222222-0000-0000-0000-000000000001'::uuid -- …pero driver_id de TENANT A
);

select is_empty(
  $$ select 1 from operacion.punto_termino_conductor $$,
  'T15b: un JWT con claims CRUZADOS (tenant B + driver_id del tenant A) no ve nada — '
  'es lo único que hace trabajar al filtro de tenant en esta política'
);

-- T16 · super_admin ------------------------------------------------------------
-- La impersonation auditada de `plataforma` no abre esta puerta.
select test_iniciar_sesion(
  '7e333333-0000-0000-0000-000000000006'::uuid, -- u_super_admin
  null,
  'super_admin', 'super_admin'
);

select is_empty(
  $$ select 1 from operacion.punto_termino_conductor $$,
  'T16: super_admin no ve NINGUNA fila (la política no tiene rama super_admin, a propósito)'
);

-- =============================================================================
-- SECCIÓN 3 · Escritura: ni con privilegio otorgado escribe una sesión de usuario
-- =============================================================================
-- Se otorgan también I/U/D dentro de la transacción. Sin política de escritura y
-- con `force row level security`, el INSERT muere con 42501 y el UPDATE/DELETE
-- caen en CERO FILAS. Las dos formas cuentan como rechazo, pero hay que probar
-- las dos: el "cero filas" es silencioso y es el modo de falla que se confunde
-- con "no había nada que actualizar".
select test_cerrar_sesion();
grant insert, update, delete on operacion.punto_termino_conductor to authenticated;

select test_iniciar_sesion(
  '7e333333-0000-0000-0000-000000000004'::uuid, -- u_conductor_a1
  '7e000000-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => '7e222222-0000-0000-0000-000000000001'::uuid -- d_a1
);

-- T17 ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into operacion.punto_termino_conductor (conductor_id, tenant_id, lat, long)
     values ('7e222222-0000-0000-0000-00000000000f',
             '7e000000-0000-0000-0000-000000000001', -33.1, -70.1) $$,
  '42501',
  null,
  'T17: el conductor NO puede INSERT ni con privilegio otorgado → 42501 (no hay política de escritura)'
);

-- T18 ---------------------------------------------------------------------------
select is_empty(
  $$ update operacion.punto_termino_conductor
        set lat = -33.999
      where conductor_id = '7e222222-0000-0000-0000-000000000001'
      returning 1 $$,
  'T18: el conductor NO puede UPDATE su propia fila (cero filas, no hay política de UPDATE)'
);

-- T19 ---------------------------------------------------------------------------
select is_empty(
  $$ delete from operacion.punto_termino_conductor
      where conductor_id = '7e222222-0000-0000-0000-000000000001'
      returning 1 $$,
  'T19: el conductor NO puede DELETE su propia fila (el borrado lo ejecuta service_role tras la revocación)'
);

-- Se devuelve la tabla a su estado real. El rollback lo haría igual; esto deja
-- explícito que el grant era del test y no del esquema.
select test_cerrar_sesion();
revoke all on operacion.punto_termino_conductor from authenticated;

-- =============================================================================
-- SECCIÓN 4 · Trigger de redondeo a 3 decimales (~110 m)
-- =============================================================================
-- 3 decimales identifican una MANZANA, no una casa. El redondeo vive en la BD
-- para que un escritor con un bug —o un endpoint que nadie revisó— no pueda
-- persistir la coordenada fina.

-- T20 · INSERT ------------------------------------------------------------------
insert into operacion.punto_termino_conductor (conductor_id, tenant_id, lat, long, comuna)
values ('7e222222-0000-0000-0000-000000000002',  -- d_a2 (ya existe: se pisa)
        '7e000000-0000-0000-0000-000000000001',
        -33.456789, -70.123456, 'Ñuñoa')
on conflict (conductor_id) do update
   set lat = excluded.lat, long = excluded.long;

select results_eq(
  $$ select lat, long from operacion.punto_termino_conductor
      where conductor_id = '7e222222-0000-0000-0000-000000000002' $$,
  $$ values ((-33.457)::double precision, (-70.123)::double precision) $$,
  'T20: el trigger redondea a 3 decimales al escribir (-33.456789 → -33.457)'
);

-- T21 · UPDATE ------------------------------------------------------------------
-- Un trigger solo-INSERT dejaría pasar la coordenada fina en cada REdefinición
-- del punto, que es justo el camino que más se va a usar.
update operacion.punto_termino_conductor
   set lat = -33.111222333, long = -70.987654321
 where conductor_id = '7e222222-0000-0000-0000-000000000002';

select results_eq(
  $$ select lat, long from operacion.punto_termino_conductor
      where conductor_id = '7e222222-0000-0000-0000-000000000002' $$,
  $$ values ((-33.111)::double precision, (-70.988)::double precision) $$,
  'T21: el trigger también redondea en UPDATE (redefinir el punto es el camino normal)'
);

-- =============================================================================
-- SECCIÓN 5 · Consentimiento POR FINALIDAD
-- =============================================================================
-- Son dos tratamientos distintos: dónde estás durante el turno / dónde vives.
-- Mezclarlos rompe en las dos direcciones.

-- T22 ---------------------------------------------------------------------------
-- d_a1 tiene consentimiento vigente de 'punto_termino_ruta' y NINGUNO de
-- 'rastreo_en_ruta'. La consulta imita exactamente la de
-- `tieneConsentimientoVigente(..., 'rastreo_en_ruta')`.
select is_empty(
  $$ select 1 from operacion.consentimientos_ubicacion
      where tenant_id    = '7e000000-0000-0000-0000-000000000001'
        and conductor_id = '7e222222-0000-0000-0000-000000000001'
        and finalidad    = 'rastreo_en_ruta' $$,
  'T22: el consentimiento de punto de término NO aparece como consentimiento de rastreo '
  '(si `finalidad` no filtrara, autorizaría un tratamiento que el conductor nunca aceptó)'
);

-- T23 ---------------------------------------------------------------------------
select isnt_empty(
  $$ select 1 from operacion.consentimientos_ubicacion
      where tenant_id    = '7e000000-0000-0000-0000-000000000001'
        and conductor_id = '7e222222-0000-0000-0000-000000000001'
        and finalidad    = 'punto_termino_ruta'
        and acepto and revocado_en is null $$,
  'T23: …y sí aparece bajo su propia finalidad (T22 filtra, no está vacío por error)'
);

-- T24 ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into operacion.consentimientos_ubicacion
       (tenant_id, conductor_id, acepto, finalidad)
     values ('7e000000-0000-0000-0000-000000000001',
             '7e222222-0000-0000-0000-000000000001',
             true, 'lo_que_sea') $$,
  '23514',
  null,
  'T24: una finalidad fuera del CHECK se rechaza → 23514 (un typo crearía un permiso que no autoriza nada y no falla)'
);

-- T25 ---------------------------------------------------------------------------
-- El default backfilea las filas históricas: todas eran del rastreo en vivo.
insert into operacion.consentimientos_ubicacion (tenant_id, conductor_id, acepto)
values ('7e000000-0000-0000-0000-000000000001',
        '7e222222-0000-0000-0000-000000000002', true);

select results_eq(
  $$ select finalidad from operacion.consentimientos_ubicacion
      where conductor_id = '7e222222-0000-0000-0000-000000000002' $$,
  $$ values ('rastreo_en_ruta'::text) $$,
  'T25: sin finalidad explícita se asume `rastreo_en_ruta` — el default que backfilea el histórico'
);

-- =============================================================================
-- Cierre
-- =============================================================================
select * from finish();

rollback;
