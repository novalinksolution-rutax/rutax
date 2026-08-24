-- =============================================================================
-- Deny-all + confidencialidad del token — dispositivos_conductor
-- =============================================================================
-- Migración probada:
--   20260824000001_identidad_dispositivos_conductor.sql
--
-- La tabla guarda el token de notificación de cada instalación de la app del
-- conductor. Con el token de alguien se le puede mandar una notificación falsa:
-- no abre su cuenta ni lee sus datos, pero **no puede estar al alcance de una
-- sesión de usuario**, ni siquiera de la del propio conductor.
--
-- Lo que se demuestra, contra una base real:
--
--   1. DENY-ALL — ni `anon`, ni `authenticated`, ni el conductor dueño de la
--      fila la alcanzan. La app llega por ruta Bearer con `service_role`, igual
--      que el resto de sus superficies, así que no hay motivo para exponerla.
--
--   2. NO HAY VISTA ESPEJO en `public` — es la forma del hallazgo que este repo
--      ya sufrió dos veces (`snapshot_regla`, token de invitación): una tabla
--      restringida en su esquema pero alcanzable por `public.*`.
--
--   3. EL TOKEN ES LA IDENTIDAD DEL TELÉFONO — el índice único por token impide
--      que el mismo aparato quede colgando de dos conductores. Si un teléfono
--      cambia de dueño, la fila se REASIGNA; sin esto, el conductor anterior
--      seguiría recibiendo las paradas del nuevo.
--
--   4. EL FORMATO SE VALIDA EN LA BASE — un token que no tiene forma de token de
--      Expo no entra, aunque una ruta futura se olvide de validarlo.

begin;
select plan(11);

-- ─── Montaje ────────────────────────────────────────────────────────────────
insert into identidad.tenants (id, nombre_fantasia, razon_social, rut)
values
  ('11111111-1111-1111-1111-111111111111', 'Courier A', 'Courier A SpA', '76111111-1'),
  ('22222222-2222-2222-2222-222222222222', 'Courier B', 'Courier B SpA', '76222222-2')
on conflict (id) do nothing;

insert into identidad.conductores (id, tenant_id, nombre_completo, rut, estado, tipo_relacion)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Juan Pérez', '11111111-1', 'activo', 'independiente'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Pedro Soto', '12222222-2', 'activo', 'independiente')
on conflict (id) do nothing;

insert into identidad.dispositivos_conductor (tenant_id, conductor_id, token, plataforma)
values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
   'ExponentPushToken[juan-telefono-1]', 'android');

-- ─── 1 · Deny-all para sesiones de usuario ──────────────────────────────────
set local role anon;
select throws_ok(
  $$ select token from identidad.dispositivos_conductor $$,
  '42501',
  null,
  'anon no alcanza la tabla'
);
reset role;

set local role authenticated;
select throws_ok(
  $$ select token from identidad.dispositivos_conductor $$,
  '42501',
  null,
  'authenticated no alcanza la tabla: ni el conductor dueño de la fila'
);
select throws_ok(
  $$ insert into identidad.dispositivos_conductor (tenant_id, conductor_id, token, plataforma)
     values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
             'ExponentPushToken[intruso]', 'ios') $$,
  '42501',
  null,
  'authenticated no puede insertar: registrar un teléfono pasa por la ruta Bearer'
);
select throws_ok(
  $$ delete from identidad.dispositivos_conductor $$,
  '42501',
  null,
  'authenticated no puede borrar'
);
reset role;

-- ─── 2 · Sin vista espejo en public ─────────────────────────────────────────
select is_empty(
  $$ select table_name from information_schema.views
     where table_schema = 'public' and table_name = 'dispositivos_conductor' $$,
  'no existe vista espejo en public'
);

-- ─── 3 · RLS forzada, y sin políticas ───────────────────────────────────────
select is(
  (select relrowsecurity from pg_class where oid = 'identidad.dispositivos_conductor'::regclass),
  true,
  'RLS habilitada'
);
select is(
  (select relforcerowsecurity from pg_class where oid = 'identidad.dispositivos_conductor'::regclass),
  true,
  'RLS FORZADA: ni el dueño de la tabla la salta'
);
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'identidad' and tablename = 'dispositivos_conductor'),
  0,
  'sin políticas: deny-all de verdad, no una política que alguien pueda ampliar'
);

-- ─── 4 · El token es la identidad del teléfono ──────────────────────────────
select throws_ok(
  $$ insert into identidad.dispositivos_conductor (tenant_id, conductor_id, token, plataforma)
     values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002',
             'ExponentPushToken[juan-telefono-1]', 'android') $$,
  '23505',
  null,
  'el mismo token no puede colgar de dos conductores: se reasigna, no se duplica'
);

-- ─── 5 · El formato se valida en la base ────────────────────────────────────
select throws_ok(
  $$ insert into identidad.dispositivos_conductor (tenant_id, conductor_id, token, plataforma)
     values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002',
             'no-soy-un-token', 'android') $$,
  '23514',
  null,
  'un token con otra forma no entra, aunque la ruta se olvide de validarlo'
);

select throws_ok(
  $$ insert into identidad.dispositivos_conductor (tenant_id, conductor_id, token, plataforma)
     values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002',
             'ExponentPushToken[otro]', 'blackberry') $$,
  '23514',
  null,
  'la plataforma solo puede ser ios o android'
);

select * from finish();
rollback;
