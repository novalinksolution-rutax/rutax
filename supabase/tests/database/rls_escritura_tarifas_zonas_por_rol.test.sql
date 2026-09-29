-- =============================================================================
-- pgTAP: escritura de tarifas, zonas y comunas de zona restringida por rol
-- =============================================================================
-- Migración bajo prueba: 20260929000001_identidad_tarifas_zonas_escritura_por_rol.sql
--
-- Escriben solo los roles con `gestionar_tarifas` en la matriz de TypeScript
-- (hoy dueño y administración). Supervisor y coordinador leen pero NO escriben:
-- antes de esta migración podían cambiar montos con un PATCH a PostgREST.
--
-- Un INSERT que la política rechaza da 42501. Un UPDATE o DELETE rechazado NO da
-- error: la fila simplemente no calza con el USING y se afectan 0 filas. Por eso
-- esos casos se comprueban leyendo el valor después, como postgres.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(23);

create or replace function test_iniciar_sesion(
  p_user_id uuid, p_tenant_id uuid, p_tipo_usuario text, p_rol text,
  p_seller_id uuid default null, p_driver_id uuid default null
) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user_id, 'role', 'authenticated', 'tenant_id', p_tenant_id,
    'tipo_usuario', p_tipo_usuario, 'seller_id', p_seller_id,
    'driver_id', p_driver_id, 'rol', p_rol)::text, true);
end $$;

create or replace function test_cerrar_sesion() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
end $$;

-- Sesión interna del tenant A con el rol pedido.
create or replace function test_interno_a(p_rol text) returns void language plpgsql as $$
begin
  perform test_iniciar_sesion('a0000000-9000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-00000000000a', 'interno', p_rol);
end $$;

-- -----------------------------------------------------------------------------
-- Fixtures (como postgres)
-- -----------------------------------------------------------------------------
insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado) values
  ('a0000000-0000-0000-0000-00000000000a', 'Courier Rol A', 'Courier Rol A SpA', '76911111-1', 'activo'),
  ('b0000000-0000-0000-0000-00000000000b', 'Courier Rol B', 'Courier Rol B SpA', '76922222-2', 'activo');

insert into identidad.zonas (id, tenant_id, nombre, activa) values
  ('a0000000-2000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'Urbano A', true),
  ('b0000000-2000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'Urbano B', true);

insert into identidad.zona_comunas (tenant_id, zona_id, comuna) values
  ('a0000000-0000-0000-0000-00000000000a', 'a0000000-2000-0000-0000-000000000001', 'Providencia'),
  ('b0000000-0000-0000-0000-00000000000b', 'b0000000-2000-0000-0000-000000000001', 'Providencia');

insert into identidad.tarifas (id, tenant_id, zona_id, monto_clp, monto_conductor_clp, vigente_desde) values
  ('a0000000-3000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a',
   'a0000000-2000-0000-0000-000000000001', 3500, 2400, '2026-01-01'),
  ('b0000000-3000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b',
   'b0000000-2000-0000-0000-000000000001', 5000, 3000, '2026-01-01');

-- =============================================================================
-- BLOQUE 1 · Supervisor y coordinador NO escriben (2 × 6 = 12 tests, + 1 de lectura)
-- =============================================================================

create or replace function test_rol_sin_escritura(p_rol text) returns setof text
language plpgsql as $$
begin
  perform test_interno_a(p_rol);

  return next throws_ok(
    $q$ insert into identidad.tarifas (tenant_id, monto_clp, monto_conductor_clp, vigente_desde)
        values ('a0000000-0000-0000-0000-00000000000a', 1, 1, '2026-02-01') $q$,
    '42501', null, p_rol || ': NO puede crear una tarifa');

  update identidad.tarifas set monto_clp = 1, monto_conductor_clp = 1
   where id = 'a0000000-3000-0000-0000-000000000001';

  return next throws_ok(
    $q$ insert into identidad.zonas (tenant_id, nombre, activa)
        values ('a0000000-0000-0000-0000-00000000000a', 'Zona colada', true) $q$,
    '42501', null, p_rol || ': NO puede crear una zona');

  update identidad.zonas set nombre = 'Renombrada'
   where id = 'a0000000-2000-0000-0000-000000000001';

  return next throws_ok(
    $q$ insert into identidad.zona_comunas (tenant_id, zona_id, comuna)
        values ('a0000000-0000-0000-0000-00000000000a', 'a0000000-2000-0000-0000-000000000001', 'Ñuñoa') $q$,
    '42501', null, p_rol || ': NO puede agregar una comuna a una zona');

  delete from identidad.zona_comunas
   where tenant_id = 'a0000000-0000-0000-0000-00000000000a' and comuna = 'Providencia';

  perform test_cerrar_sesion();

  return next is(
    (select monto_clp::int || '/' || monto_conductor_clp::int from identidad.tarifas
      where id = 'a0000000-3000-0000-0000-000000000001'),
    '3500/2400', p_rol || ': su UPDATE de montos no tocó la tarifa');
  return next is(
    (select nombre from identidad.zonas where id = 'a0000000-2000-0000-0000-000000000001'),
    'Urbano A', p_rol || ': su UPDATE no renombró la zona');
  return next ok(
    exists (select 1 from identidad.zona_comunas
             where tenant_id = 'a0000000-0000-0000-0000-00000000000a' and comuna = 'Providencia'),
    p_rol || ': su DELETE no sacó la comuna de la zona');
end $$;

select * from test_rol_sin_escritura('supervisor');
select * from test_rol_sin_escritura('coordinador');

-- Lectura intacta: el coordinador sigue viendo la tarifa (la operación la usa).
select test_interno_a('coordinador');
select is(
  (select monto_clp::int from identidad.tarifas where id = 'a0000000-3000-0000-0000-000000000001'),
  3500, 'coordinador: SÍ puede LEER la tarifa de su tenant (el cierre es solo de escritura)');
select test_cerrar_sesion();

-- =============================================================================
-- BLOQUE 2 · Dueño y administración SÍ escriben (6 tests)
-- =============================================================================
select test_interno_a('dueno');
select lives_ok(
  $$ insert into identidad.tarifas (tenant_id, monto_clp, monto_conductor_clp, vigente_desde)
     values ('a0000000-0000-0000-0000-00000000000a', 3000, 2000, '2026-03-01') $$,
  'dueño: SÍ crea una tarifa');
update identidad.tarifas set monto_clp = 3600 where id = 'a0000000-3000-0000-0000-000000000001';
select lives_ok(
  $$ insert into identidad.zona_comunas (tenant_id, zona_id, comuna)
     values ('a0000000-0000-0000-0000-00000000000a', 'a0000000-2000-0000-0000-000000000001', 'Ñuñoa') $$,
  'dueño: SÍ agrega una comuna a una zona');
delete from identidad.zona_comunas
 where tenant_id = 'a0000000-0000-0000-0000-00000000000a' and comuna = 'Ñuñoa';
select test_cerrar_sesion();

select is(
  (select monto_clp::int from identidad.tarifas where id = 'a0000000-3000-0000-0000-000000000001'),
  3600, 'dueño: su UPDATE de monto SÍ se aplicó');
select ok(
  not exists (select 1 from identidad.zona_comunas
               where tenant_id = 'a0000000-0000-0000-0000-00000000000a' and comuna = 'Ñuñoa'),
  'dueño: su DELETE de comuna SÍ se aplicó');

select test_interno_a('administracion');
select lives_ok(
  $$ insert into identidad.tarifas (tenant_id, monto_clp, monto_conductor_clp, vigente_desde)
     values ('a0000000-0000-0000-0000-00000000000a', 3100, 2100, '2026-04-01') $$,
  'administración: SÍ crea una tarifa (RF-009: «Dueño / admin»)');
update identidad.tarifas set monto_conductor_clp = 2500 where id = 'a0000000-3000-0000-0000-000000000001';
select test_cerrar_sesion();

select is(
  (select monto_conductor_clp::int from identidad.tarifas where id = 'a0000000-3000-0000-0000-000000000001'),
  2500, 'administración: su UPDATE de monto al conductor SÍ se aplicó');

-- =============================================================================
-- BLOQUE 3 · Aislamiento A↔B y roles no internos (4 tests)
-- =============================================================================
select test_interno_a('dueno');
select throws_ok(
  $$ insert into identidad.tarifas (tenant_id, monto_clp, monto_conductor_clp, vigente_desde)
     values ('b0000000-0000-0000-0000-00000000000b', 1, 1, '2026-05-01') $$,
  '42501', null, 'aislamiento: el dueño de A NO crea tarifas en el tenant B');
update identidad.tarifas set monto_clp = 1 where id = 'b0000000-3000-0000-0000-000000000001';
select test_cerrar_sesion();

select is(
  (select monto_clp::int from identidad.tarifas where id = 'b0000000-3000-0000-0000-000000000001'),
  5000, 'aislamiento: el UPDATE del dueño de A no tocó la tarifa de B');

select test_iniciar_sesion('a0000000-9000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-00000000000a', 'seller', 'seller');
select throws_ok(
  $$ insert into identidad.tarifas (tenant_id, monto_clp, monto_conductor_clp, vigente_desde)
     values ('a0000000-0000-0000-0000-00000000000a', 1, 1, '2026-06-01') $$,
  '42501', null, 'un seller NO crea tarifas aunque su claim de rol diga lo que diga');
select test_cerrar_sesion();

-- Un claim de rol privilegiado con tipo_usuario no interno tampoco pasa: el rol
-- solo cuenta dentro de «interno».
select test_iniciar_sesion('a0000000-9000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-00000000000a', 'conductor', 'dueno');
select throws_ok(
  $$ insert into identidad.zonas (tenant_id, nombre, activa)
     values ('a0000000-0000-0000-0000-00000000000a', 'Zona de conductor', true) $$,
  '42501', null, 'un conductor con claim rol=dueno NO crea zonas (hace falta ser interno)');
select test_cerrar_sesion();

select * from finish();

rollback;
