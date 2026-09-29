-- =============================================================================
-- QA adversarial — zonas, tarifas, courier_config_operacion y el guardado del
-- paso 4 (migraciones 20260928000002/3/4)
-- =============================================================================
-- Complementa (no repite) identidad_resolver_tarifa, identidad_guardar_zonas_y_
-- tarifas_puesta_en_marcha y rls_aislamiento_courier_config_operacion. Foco:
--
--   A. Aislamiento de las tablas que el paso 4 escribe (zonas, zona_comunas,
--      tarifas) y de la config: el dueño de A no lee ni escribe lo de B, ni
--      "mueve" filas propias a B; seller, conductor y anon no ven nada.
--   B. Las funciones sensibles NO se ejecutan desde una sesión de usuario.
--   C. Las invariantes que el paso 4 da por supuestas viven en la base: una sola
--      zona de respaldo activa, fuente XOR régimen, una tarifa activa por clave.
--   D. Payloads hostiles al RPC (mismo id de zona dos veces, forma equivocada):
--      fallan sin dejar NADA a medias.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(44);

create or replace function qa_sesion(
  p_tenant uuid, p_tipo text, p_rol text,
  p_seller uuid default null, p_driver uuid default null
) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-0000-0000-00000000aaaa', 'role', 'authenticated',
    'tenant_id', p_tenant, 'tipo_usuario', p_tipo, 'rol', p_rol,
    'seller_id', p_seller, 'driver_id', p_driver)::text, true);
end $$;

create or replace function qa_fin() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
end $$;

-- Payload de dos zonas válido, parametrizable en los ids.
create or replace function qa_payload(z1 uuid, z2 uuid) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('id', z1, 'nombre', 'Urbano', 'es_respaldo', false,
      'comunas', '["Providencia","Ñuñoa"]'::jsonb, 'cobro_clp', 3500, 'pago_clp', 2400, 'excepciones', '[]'::jsonb),
    jsonb_build_object('id', z2, 'nombre', 'Periferia', 'es_respaldo', true,
      'comunas', '["Buin","Pirque"]'::jsonb, 'cobro_clp', 4000, 'pago_clp', 2900, 'excepciones', '[]'::jsonb))
$$;

-- -----------------------------------------------------------------------------
-- Fixtures (como postgres)
-- -----------------------------------------------------------------------------
insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado, creado_en) values
  ('a1a1a1a1-0000-0000-0000-00000000000a', 'QA A', 'QA A SpA', '76920111-5', 'activo', now()),
  ('b1b1b1b1-0000-0000-0000-00000000000b', 'QA B', 'QA B SpA', '76920222-7', 'activo', now());

insert into identidad.courier_config_operacion (tenant_id, ofrece_flex, ofrece_shopify, puesta_en_marcha_paso) values
  ('a1a1a1a1-0000-0000-0000-00000000000a', true, false, 3),
  ('b1b1b1b1-0000-0000-0000-00000000000b', true, true, 3);

insert into identidad.sellers (id, tenant_id, razon_social, rut, estado) values
  ('a1a1a1a1-1000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-00000000000a', 'Seller A', '77920111-3', 'activo');
insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion) values
  ('a1a1a1a1-3000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-00000000000a', 'Cond A', '12920111-3', 'independiente');

insert into identidad.zonas (id, tenant_id, nombre, activa, es_respaldo) values
  ('a1a1a1a1-2000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-00000000000a', 'Zona A1', true, false),
  ('a1a1a1a1-2000-0000-0000-000000000002', 'a1a1a1a1-0000-0000-0000-00000000000a', 'Zona A2', true, true),
  ('b1b1b1b1-2000-0000-0000-000000000001', 'b1b1b1b1-0000-0000-0000-00000000000b', 'Zona B1', true, true);
insert into identidad.zona_comunas (tenant_id, zona_id, comuna) values
  ('a1a1a1a1-0000-0000-0000-00000000000a', 'a1a1a1a1-2000-0000-0000-000000000001', 'Providencia'),
  ('b1b1b1b1-0000-0000-0000-00000000000b', 'b1b1b1b1-2000-0000-0000-000000000001', 'Las Condes');
insert into identidad.tarifas (id, tenant_id, zona_id, modo_calculo, monto_clp, monto_conductor_clp, vigente_desde) values
  ('a1a1a1a1-4000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-00000000000a', 'a1a1a1a1-2000-0000-0000-000000000001', 'por_zona', 3500, 2400, '2026-01-01'),
  ('b1b1b1b1-4000-0000-0000-000000000001', 'b1b1b1b1-0000-0000-0000-00000000000b', 'b1b1b1b1-2000-0000-0000-000000000001', 'por_zona', 9000, 6000, '2026-01-01');

-- =============================================================================
-- A. Aislamiento
-- =============================================================================
select qa_sesion('a1a1a1a1-0000-0000-0000-00000000000a', 'interno', 'dueno');

select is((select count(*)::int from identidad.zonas where tenant_id = 'b1b1b1b1-0000-0000-0000-00000000000b'), 0,
  'dueño A: no ve zonas de B (tabla)');
select is((select count(*)::int from public.zonas where tenant_id = 'b1b1b1b1-0000-0000-0000-00000000000b'), 0,
  'dueño A: no ve zonas de B (vista espejo)');
select is((select count(*)::int from public.tarifas where tenant_id = 'b1b1b1b1-0000-0000-0000-00000000000b'), 0,
  'dueño A: no ve tarifas de B (vista espejo)');
select is((select count(*)::int from identidad.zona_comunas where tenant_id = 'b1b1b1b1-0000-0000-0000-00000000000b'), 0,
  'dueño A: no ve comunas mapeadas de B');
select is((select count(*)::int from public.courier_config_operacion where tenant_id = 'b1b1b1b1-0000-0000-0000-00000000000b'), 0,
  'dueño A: no ve la config de operación de B');
select is((select count(*)::int from identidad.zonas), 2, 'contraprueba: dueño A sí ve sus 2 zonas');
select is((select count(*)::int from identidad.tarifas), 1, 'contraprueba: dueño A sí ve su tarifa');

select throws_ok(
  $$ insert into identidad.zonas (tenant_id, nombre, activa) values ('b1b1b1b1-0000-0000-0000-00000000000b', 'Intrusa', true) $$,
  '42501', null, 'dueño A no crea una zona en B');
select throws_ok(
  $$ insert into identidad.tarifas (tenant_id, zona_id, modo_calculo, monto_clp, monto_conductor_clp, vigente_desde)
     values ('b1b1b1b1-0000-0000-0000-00000000000b', 'b1b1b1b1-2000-0000-0000-000000000001', 'por_zona', 1, 1, '2026-02-01') $$,
  '42501', null, 'dueño A no crea una tarifa en B');
select throws_ok(
  $$ update identidad.tarifas set tenant_id = 'b1b1b1b1-0000-0000-0000-00000000000b'
      where id = 'a1a1a1a1-4000-0000-0000-000000000001' $$,
  '42501', null, 'dueño A no MUEVE su tarifa al tenant de B');
select throws_ok(
  $$ update identidad.zonas set tenant_id = 'b1b1b1b1-0000-0000-0000-00000000000b'
      where id = 'a1a1a1a1-2000-0000-0000-000000000001' $$,
  '42501', null, 'dueño A no MUEVE su zona al tenant de B');
select throws_ok(
  $$ insert into identidad.courier_config_operacion (tenant_id) values ('b1b1b1b1-0000-0000-0000-00000000000b') $$,
  '42501', null, 'dueño A no escribe la config de B');
select throws_ok(
  $$ insert into public.courier_config_operacion (tenant_id) values ('a1a1a1a1-0000-0000-0000-00000000000a') $$,
  '42501', null, 'la vista espejo de la config es SOLO lectura (ni al propio tenant)');

-- B. El dueño de A no ejecuta el guardado del paso 4 ni las funciones internas
select throws_ok(
  $$ select identidad.guardar_zonas_y_tarifas_puesta_en_marcha('a1a1a1a1-0000-0000-0000-00000000000a', '2026-09-29',
       qa_payload('a1a1a1a1-2000-0000-0000-000000000001', 'a1a1a1a1-2000-0000-0000-000000000002')) $$,
  '42501', null, 'una sesión de usuario no ejecuta el guardado del paso 4 (ni para su propio tenant)');
select throws_ok(
  $$ select identidad.guardar_zonas_y_tarifas_puesta_en_marcha('b1b1b1b1-0000-0000-0000-00000000000b', '2026-09-29',
       qa_payload(null, null)) $$,
  '42501', null, 'y menos para el tenant de B');
select throws_ok(
  $$ select identidad.courier_config_operacion_marcar_existentes(now()) $$,
  '42501', null, 'el backfill que marca completados a los couriers no es ejecutable desde sesión');
select is(
  (select count(*)::int from identidad.resolver_tarifa('b1b1b1b1-0000-0000-0000-00000000000b', null, 'ml_flex', 'flex',
     'b1b1b1b1-2000-0000-0000-000000000001', '2026-09-29') where tarifa_id is not null), 0,
  'dueño A pidiendo la tarifa de B por resolver_tarifa: nada (no filtra montos ajenos)');

select qa_fin();

-- Coordinador / administración: pueden LEER la config (interno) pero no crearla.
select qa_sesion('a1a1a1a1-0000-0000-0000-00000000000a', 'interno', 'coordinador');
select is((select count(*)::int from identidad.courier_config_operacion), 1, 'coordinador A: lee la config de su courier');
select qa_fin();
select qa_sesion('a1a1a1a1-0000-0000-0000-00000000000a', 'interno', 'administracion');
update identidad.courier_config_operacion set hora_salida_reparto = '10:00'
 where tenant_id = 'a1a1a1a1-0000-0000-0000-00000000000a';
select qa_fin();
select is((select hora_salida_reparto::text from identidad.courier_config_operacion
            where tenant_id = 'a1a1a1a1-0000-0000-0000-00000000000a'),
  '16:00:00', 'administración A: su UPDATE de horario no cambió nada (RLS lo deja en 0 filas)');

-- Seller y conductor: nada.
select qa_sesion('a1a1a1a1-0000-0000-0000-00000000000a', 'seller', null, 'a1a1a1a1-1000-0000-0000-000000000001');
select is((select count(*)::int from identidad.zonas) + (select count(*)::int from identidad.tarifas)
        + (select count(*)::int from identidad.zona_comunas) + (select count(*)::int from identidad.courier_config_operacion),
  0, 'seller A: cero filas de zonas, comunas, tarifas y config');
select throws_ok(
  $$ insert into identidad.zonas (tenant_id, nombre, activa) values ('a1a1a1a1-0000-0000-0000-00000000000a', 'Zona seller', true) $$,
  '42501', null, 'seller A no crea zonas ni en su propio tenant');
select throws_ok(
  $$ insert into identidad.tarifas (tenant_id, modo_calculo, monto_clp, monto_conductor_clp, vigente_desde)
     values ('a1a1a1a1-0000-0000-0000-00000000000a', 'monto_fijo', 1, 1, '2026-03-01') $$,
  '42501', null, 'seller A no crea tarifas (no fija su propio precio)');
select qa_fin();

select qa_sesion('a1a1a1a1-0000-0000-0000-00000000000a', 'conductor', null, null, 'a1a1a1a1-3000-0000-0000-000000000001');
select is((select count(*)::int from identidad.zonas) + (select count(*)::int from identidad.tarifas)
        + (select count(*)::int from identidad.zona_comunas) + (select count(*)::int from identidad.courier_config_operacion),
  0, 'conductor A: cero filas (no ve cuánto se cobra ni cuánto se paga a otros)');
select throws_ok(
  $$ update identidad.tarifas set monto_conductor_clp = 999999 where id = 'a1a1a1a1-4000-0000-0000-000000000001' $$,
  '42501', null, 'conductor A no puede subirse su pago editando la tarifa') ;
select qa_fin();

-- anon
set local role anon;
select throws_ok($$ select 1 from identidad.tarifas $$, '42501', null, 'anon: sin acceso a tarifas');
select throws_ok($$ select 1 from identidad.zonas $$, '42501', null, 'anon: sin acceso a zonas');
select throws_ok($$ select 1 from identidad.courier_config_operacion $$, '42501', null, 'anon: sin acceso a la config de operación');
select qa_fin();

-- =============================================================================
-- C. Invariantes que el paso 4 da por supuestas
-- =============================================================================
select throws_ok(
  $$ update identidad.zonas set es_respaldo = true where id = 'a1a1a1a1-2000-0000-0000-000000000001' $$,
  '23505', null, 'a lo más UNA zona de respaldo por tenant');
select throws_ok(
  $$ update identidad.zonas set activa = false where id = 'a1a1a1a1-2000-0000-0000-000000000002' $$,
  '23514', null, 'la zona de respaldo no puede desactivarse (dejaría sin cobrar lo que existe para cobrar)');
select lives_ok(
  $$ update identidad.zonas set activa = false where id = 'a1a1a1a1-2000-0000-0000-000000000001' $$,
  'una zona normal sí se desactiva');
select throws_ok(
  $$ insert into identidad.tarifas (tenant_id, tipo_entrega, fuente, modo_calculo, monto_clp, monto_conductor_clp, vigente_desde)
     values ('a1a1a1a1-0000-0000-0000-00000000000a', 'flex', 'ml_flex', 'monto_fijo', 1000, 500, '2026-04-01') $$,
  '23514', null, 'una tarifa es por fuente O por régimen legado, nunca ambos');
insert into identidad.tarifas (tenant_id, modo_calculo, monto_clp, monto_conductor_clp, vigente_desde)
  values ('a1a1a1a1-0000-0000-0000-00000000000a', 'monto_fijo', 3000, 2000, '2026-05-01');
select throws_ok(
  $$ insert into identidad.tarifas (tenant_id, modo_calculo, monto_clp, monto_conductor_clp, vigente_desde)
     values ('a1a1a1a1-0000-0000-0000-00000000000a', 'monto_fijo', 3100, 2000, '2026-05-01') $$,
  '23505', null, 'dos tarifas GENERALES activas con la misma vigencia no conviven (NULLS NOT DISTINCT)');
select lives_ok(
  $$ insert into identidad.tarifas (tenant_id, modo_calculo, monto_clp, monto_conductor_clp, vigente_desde, estado)
     values ('a1a1a1a1-0000-0000-0000-00000000000a', 'monto_fijo', 3100, 2000, '2026-05-01', 'inactiva') $$,
  'pero una inactiva con la misma clave sí (es el rastro de lo reemplazado)');
select throws_ok(
  $$ update identidad.courier_config_operacion set hora_corte_reparto = '15:00'
      where tenant_id = 'a1a1a1a1-0000-0000-0000-00000000000a' $$,
  '23514', null, 'el corte del reparto no puede ser anterior a la salida');

-- =============================================================================
-- D. Payloads hostiles al RPC (como service_role, que es quien lo llama)
-- =============================================================================
set local role service_role;

create temp table qa_antes as
  select (select count(*) from identidad.zonas where tenant_id = 'a1a1a1a1-0000-0000-0000-00000000000a') zonas,
         (select count(*) from identidad.tarifas where tenant_id = 'a1a1a1a1-0000-0000-0000-00000000000a') tarifas,
         (select count(*) from identidad.zona_comunas where tenant_id = 'a1a1a1a1-0000-0000-0000-00000000000a') comunas,
         (select string_agg(id::text || es_respaldo::text || activa::text, ',' order by id)
            from identidad.zonas where tenant_id = 'a1a1a1a1-0000-0000-0000-00000000000a') firma;
grant select on qa_antes to service_role;

select throws_ok(
  $$ select identidad.guardar_zonas_y_tarifas_puesta_en_marcha('a1a1a1a1-0000-0000-0000-00000000000a', '2026-09-29',
       qa_payload('a1a1a1a1-2000-0000-0000-000000000002', 'a1a1a1a1-2000-0000-0000-000000000002')) $$,
  '23505', null, 'el MISMO id de zona en las dos posiciones falla');
select is(
  (select array[(select count(*) from identidad.zonas where tenant_id = 'a1a1a1a1-0000-0000-0000-00000000000a'),
                (select count(*) from identidad.tarifas where tenant_id = 'a1a1a1a1-0000-0000-0000-00000000000a'),
                (select count(*) from identidad.zona_comunas where tenant_id = 'a1a1a1a1-0000-0000-0000-00000000000a')]),
  (select array[zonas, tarifas, comunas] from qa_antes),
  '...y no deja zonas, tarifas ni comunas a medias');
select is(
  (select string_agg(id::text || es_respaldo::text || activa::text, ',' order by id)
     from identidad.zonas where tenant_id = 'a1a1a1a1-0000-0000-0000-00000000000a'),
  (select firma from qa_antes),
  '...ni cambia la marca de respaldo ni el estado de las zonas existentes (el "liberar respaldo" se revirtió)');

select throws_ok(
  $$ select identidad.guardar_zonas_y_tarifas_puesta_en_marcha('a1a1a1a1-0000-0000-0000-00000000000a', '2026-09-29', '{"a":1}'::jsonb) $$,
  '22023', null, 'p_zonas que no es un arreglo se rechaza');
select throws_ok(
  $$ select identidad.guardar_zonas_y_tarifas_puesta_en_marcha('a1a1a1a1-0000-0000-0000-00000000000a', '2026-09-29',
       qa_payload(null, null) || qa_payload(null, null)) $$,
  '22023', null, 'cuatro zonas se rechazan (son exactamente dos)');
select throws_ok(
  $$ select identidad.guardar_zonas_y_tarifas_puesta_en_marcha('a1a1a1a1-0000-0000-0000-00000000000a', '2026-09-29',
       (select jsonb_agg(jsonb_set(z, '{es_respaldo}', 'true')) from jsonb_array_elements(qa_payload(null, null)) z)) $$,
  '22023', null, 'dos zonas de respaldo se rechazan');
select throws_ok(
  $$ select identidad.guardar_zonas_y_tarifas_puesta_en_marcha('a1a1a1a1-0000-0000-0000-00000000000a', '2026-09-29',
       (select jsonb_agg(jsonb_set(z, '{es_respaldo}', 'false')) from jsonb_array_elements(qa_payload(null, null)) z)) $$,
  '22023', null, 'cero zonas de respaldo se rechazan');
select throws_ok(
  $$ select identidad.guardar_zonas_y_tarifas_puesta_en_marcha('a1a1a1a1-0000-0000-0000-00000000000a', '2026-09-29',
       (select jsonb_agg(jsonb_set(z, '{cobro_clp}', '"3500"')) from jsonb_array_elements(qa_payload(null, null)) z)) $$,
  '23514', null, 'un monto como texto se rechaza');
select throws_ok(
  $$ select identidad.guardar_zonas_y_tarifas_puesta_en_marcha('a1a1a1a1-0000-0000-0000-00000000000a', '2026-09-29',
       (select jsonb_agg(z - 'pago_clp') from jsonb_array_elements(qa_payload('a1a1a1a1-2000-0000-0000-000000000001', 'a1a1a1a1-2000-0000-0000-000000000002')) z)) $$,
  '23502', null, 'un pago ausente NO produce una tarifa con pago NULL (not null lo frena y revierte todo)');
select throws_ok(
  $$ select identidad.guardar_zonas_y_tarifas_puesta_en_marcha('a1a1a1a1-0000-0000-0000-00000000000a', '2026-09-29',
       (select jsonb_agg(jsonb_set(z, '{comunas}', '"Providencia"')) from jsonb_array_elements(qa_payload(null, null)) z)) $$,
  '23514', null, 'comunas que no es arreglo se rechaza');

select * from finish();
rollback;
