-- =============================================================================
-- Plataforma · áreas habilitadas: deny-all y el default apagado
-- =============================================================================
-- POR QUÉ EXISTE ESTE ARCHIVO
--
-- Esta tabla decide qué partes del producto ve cada courier. Dos cosas tienen
-- que ser ciertas para siempre y ninguna se ve mirando la app:
--
--   1. 🔴 **La AUSENCIA de fila significa apagada.** Es lo que hace que un
--      courier nuevo nazca sin nada abierto sin depender de que alguien lo
--      configure. Si algún día alguien "mejora" el modelo invirtiéndolo —una
--      tabla de deshabilitadas— el default se da vuelta y el courier que se dé
--      de alta un domingo nace con el módulo de dinero abierto. Acá se fija que
--      un tenant recién creado tiene CERO filas.
--
--   2. 🔴 **El courier no la lee.** Es la lista de lo que NO tiene: información
--      del backstage. `plataforma` es deny-all para `authenticated` y esta tabla
--      no puede ser la excepción — ni con política, ni con una vista espejo en
--      `public` que se cuele por PostgREST.
--
-- ⚠️ Y la lista de áreas del CHECK es la misma que `AREAS_PRODUCTO` en
-- TypeScript. Si divergen, una fila se guarda y no gobierna nada, o la Server
-- Action falla con 23514 al encender. Acá se fija el conjunto exacto —con
-- `set_eq`, nunca con un conteo, que es la lección del CHECK de conciliación.
-- =============================================================================

begin;
select plan(11);

select has_table('plataforma', 'areas_habilitadas', 'existe plataforma.areas_habilitadas');

-- -----------------------------------------------------------------------------
-- 1 · La lista de áreas, EXACTA
-- -----------------------------------------------------------------------------
-- Se extraen los valores del propio CHECK y se comparan con el conjunto
-- esperado. `set_eq`, no un conteo: cinco antes y cinco después puede ser una
-- lista distinta — es la lección del CHECK de tipos de conciliación, que perdió
-- un valor sin que el número cambiara.
select set_eq(
  $$ select (regexp_matches(pg_get_constraintdef(oid), '''([a-z_]+)''::text', 'g'))[1]
       from pg_constraint
      where conname = 'areas_habilitadas_area_valida' $$,
  $$ values ('emision_facturas'), ('folios_caf'), ('pago_conductores'),
            ('conciliacion_cobranza'), ('suscripcion_rutax') $$,
  'el CHECK admite exactamente las cinco áreas de AREAS_PRODUCTO'
);

-- -----------------------------------------------------------------------------
-- 2 · Deny-all: sin políticas para `authenticated`, sin vista espejo
-- -----------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'plataforma' and tablename = 'areas_habilitadas'),
  0,
  'sin políticas: el courier no lee esta tabla ni con RLS a favor');

select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'plataforma' and c.relname = 'areas_habilitadas'),
  'RLS habilitada y FORZADA (también para el owner)');

select hasnt_view('public', 'areas_habilitadas',
  'NO hay vista espejo en public: exponerla por PostgREST sería la puerta trasera');

select ok(
  not has_table_privilege('authenticated', 'plataforma.areas_habilitadas', 'SELECT'),
  'authenticated no tiene SELECT ni por grant heredado');

select ok(
  not has_table_privilege('anon', 'plataforma.areas_habilitadas', 'SELECT'),
  'anon tampoco');

select ok(
  has_table_privilege('service_role', 'plataforma.areas_habilitadas', 'SELECT'),
  'service_role SÍ: es por donde la lee la app (superficie courier-safe)');

-- -----------------------------------------------------------------------------
-- 3 · 🔴 El default: un courier nuevo nace APAGADO
-- -----------------------------------------------------------------------------
insert into identidad.tenants (id, nombre_fantasia, razon_social, rut)
values ('cccccccc-0000-0000-0000-000000000001', 'Courier Nuevo', 'Courier Nuevo SpA', '77200001-6');

select is(
  (select count(*)::int from plataforma.areas_habilitadas
    where tenant_id = 'cccccccc-0000-0000-0000-000000000001'),
  0,
  '🔴 un courier recién creado tiene CERO filas: nace con todo apagado');

-- Contraprueba: encender es insertar, y la fila se guarda.
insert into plataforma.areas_habilitadas (tenant_id, area)
values ('cccccccc-0000-0000-0000-000000000001', 'emision_facturas');

select is(
  (select count(*)::int from plataforma.areas_habilitadas
    where tenant_id = 'cccccccc-0000-0000-0000-000000000001'),
  1,
  'encender es insertar una fila');

-- -----------------------------------------------------------------------------
-- 4 · Un área inventada se rechaza
-- -----------------------------------------------------------------------------
select throws_ok(
  $$ insert into plataforma.areas_habilitadas (tenant_id, area)
     values ('cccccccc-0000-0000-0000-000000000001', 'ruteo') $$,
  '23514', null,
  'un área que no está en la lista se rechaza, no se guarda inerte');

select * from finish();
rollback;
