-- =============================================================================
-- identidad.cerrar_tarifas_legadas_del_tenant (20260928000004)
-- =============================================================================
-- Al guardar tarifas del modelo nuevo, las legadas del tenant (tipo_entrega, sin
-- seller) se cierran, para que la tarifa por zona deje de perder contra ellas.
--   1. Sin general del modelo nuevo no se cierra nada.
--   2. Con general: la legada anterior a hoy termina ayer; la de hoy sin uso pasa
--      a inactiva; tras cerrar, resolver_tarifa_por_comuna devuelve la de zona.
--   3. Las legadas de un seller quedan intactas.
--   4. Una legada de hoy ya usada por un pedido rige hoy tal como se uso.
--   5. Aislamiento entre tenants; idempotencia; privilegios; integracion con el
--      guardado del paso 4.
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;
select plan(24);

insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado) values
  ('e1000000-0000-0000-0000-00000000000a', 'X', 'X SpA', '76920111-5', 'activo'),
  ('e2000000-0000-0000-0000-00000000000b', 'Y', 'Y SpA', '76920222-7', 'activo'),
  ('e3000000-0000-0000-0000-00000000000c', 'Z', 'Z SpA', '76920333-9', 'activo'),
  ('e4000000-0000-0000-0000-00000000000d', 'W', 'W SpA', '76920444-1', 'activo'),
  ('e5000000-0000-0000-0000-00000000000e', 'V', 'V SpA', '76920555-3', 'activo');

insert into identidad.courier_config_operacion (tenant_id, ofrece_flex, ofrece_shopify, puesta_en_marcha_paso) values
  ('e5000000-0000-0000-0000-00000000000e', false, false, 3);

insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado) values
  ('e1000000-1000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'Seller X', '77920111-3', 'C', 'x@cl.test', 'activo'),
  ('e4000000-1000-0000-0000-000000000001', 'e4000000-0000-0000-0000-00000000000d', 'Seller W', '77920222-1', 'C', 'w@cl.test', 'activo');

-- X: zona con tarifa, general, legadas flex (antigua) y same_day (de hoy), y una
-- legada de seller.
insert into identidad.zonas (id, tenant_id, nombre, activa, es_respaldo) values
  ('e1000000-2000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'Zona X', true, true);
insert into identidad.zona_comunas (tenant_id, zona_id, comuna) values
  ('e1000000-0000-0000-0000-00000000000a', 'e1000000-2000-0000-0000-000000000001', 'Providencia');
insert into identidad.tarifas (id, tenant_id, seller_id, tipo_entrega, zona_id, monto_clp, monto_conductor_clp, vigente_desde) values
  ('e1000000-3000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', null, 'flex', null, 9000, 6000, '2026-01-01'),
  ('e1000000-3000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a', null, 'same_day', null, 9500, 6000, '2026-09-29'),
  ('e1000000-3000-0000-0000-000000000003', 'e1000000-0000-0000-0000-00000000000a', 'e1000000-1000-0000-0000-000000000001', 'flex', null, 7000, 5000, '2026-01-01'),
  ('e1000000-3000-0000-0000-000000000004', 'e1000000-0000-0000-0000-00000000000a', null, null, null, 4000, 2500, '2026-09-20'),
  ('e1000000-3000-0000-0000-000000000005', 'e1000000-0000-0000-0000-00000000000a', null, null, 'e1000000-2000-0000-0000-000000000001', 3500, 2400, '2026-09-20');

-- Y: solo legadas, SIN general.
insert into identidad.tarifas (id, tenant_id, tipo_entrega, monto_clp, monto_conductor_clp, vigente_desde) values
  ('e2000000-3000-0000-0000-000000000001', 'e2000000-0000-0000-0000-00000000000b', 'flex', 9000, 6000, '2026-01-01'),
  ('e2000000-3000-0000-0000-000000000002', 'e2000000-0000-0000-0000-00000000000b', 'same_day', 9500, 6000, '2026-01-01');

-- Z: legada + general (aislamiento respecto de X).
insert into identidad.tarifas (id, tenant_id, tipo_entrega, monto_clp, monto_conductor_clp, vigente_desde) values
  ('e3000000-3000-0000-0000-000000000001', 'e3000000-0000-0000-0000-00000000000c', 'flex', 9000, 6000, '2026-01-01'),
  ('e3000000-3000-0000-0000-000000000002', 'e3000000-0000-0000-0000-00000000000c', null, 4000, 2500, '2026-09-20');

-- W: general + legada flex creada HOY y ya usada por un pedido.
insert into identidad.tarifas (id, tenant_id, tipo_entrega, monto_clp, monto_conductor_clp, vigente_desde) values
  ('e4000000-3000-0000-0000-000000000001', 'e4000000-0000-0000-0000-00000000000d', 'flex', 9000, 6000, '2026-09-29'),
  ('e4000000-3000-0000-0000-000000000002', 'e4000000-0000-0000-0000-00000000000d', null, 4000, 2500, '2026-09-20');
insert into operacion.pedidos (id, tenant_id, seller_id, tipo_pedido, fuente, origen, ml_shipment_id, estado,
                               destinatario_nombre, destinatario_direccion, destinatario_comuna, tarifa_aplicable_id)
values ('e4000000-4000-0000-0000-000000000001', 'e4000000-0000-0000-0000-00000000000d',
        'e4000000-1000-0000-0000-000000000001', 'flex', 'ml_flex', 'ml_ingesta', 'SHP-CL-1', 'pendiente_asignacion',
        'Dest', 'Calle 1', 'Providencia', 'e4000000-3000-0000-0000-000000000001');

-- V: para la integracion con el paso 4.
insert into identidad.tarifas (id, tenant_id, tipo_entrega, monto_clp, monto_conductor_clp, vigente_desde) values
  ('e5000000-3000-0000-0000-000000000001', 'e5000000-0000-0000-0000-00000000000e', 'flex', 9000, 6000, '2026-01-01');

set local role service_role;

-- ---- 1. Sin general no se cierra nada --------------------------------------
select is(
  (identidad.cerrar_tarifas_legadas_del_tenant('e2000000-0000-0000-0000-00000000000b', '2026-09-29'))->>'hay_general',
  'false', 'sin general: lo reporta');
select is(
  (select count(*)::int from identidad.tarifas
    where tenant_id = 'e2000000-0000-0000-0000-00000000000b' and estado = 'activa' and vigente_hasta is null),
  2, 'sin general: las dos legadas siguen intactas');

-- ---- 2. Con general --------------------------------------------------------
select is(
  (select por_regimen from identidad.resolver_tarifa_por_comuna(
    'e1000000-0000-0000-0000-00000000000a', null, 'ml_flex', 'flex', 'Providencia', '2026-09-29')),
  true, 'antes: la legada le gana a la tarifa por zona');

select is(
  jsonb_array_length((identidad.cerrar_tarifas_legadas_del_tenant('e1000000-0000-0000-0000-00000000000a', '2026-09-29'))->'cerradas'),
  1, 'cierra la legada anterior a hoy');
select is(
  (select vigente_hasta from identidad.tarifas where id = 'e1000000-3000-0000-0000-000000000001'),
  '2026-09-28'::date, 'la legada antigua termina ayer');
select is(
  (select estado::text from identidad.tarifas where id = 'e1000000-3000-0000-0000-000000000002'),
  'inactiva', 'la legada de hoy sin uso pasa a inactiva');
select is(
  (select tarifa_id from identidad.resolver_tarifa_por_comuna(
    'e1000000-0000-0000-0000-00000000000a', null, 'ml_flex', 'flex', 'Providencia', '2026-09-29')),
  'e1000000-3000-0000-0000-000000000005'::uuid, 'despues: resuelve la tarifa de la zona');

-- ---- 3. Seller intacto -----------------------------------------------------
select ok(
  (select estado = 'activa' and vigente_hasta is null from identidad.tarifas where id = 'e1000000-3000-0000-0000-000000000003'),
  'la legada de un seller no se toca');
select is(
  (select tarifa_id from identidad.resolver_tarifa(
    'e1000000-0000-0000-0000-00000000000a', 'e1000000-1000-0000-0000-000000000001', 'ml_flex', 'flex',
    'e1000000-2000-0000-0000-000000000001', '2026-09-29')),
  'e1000000-3000-0000-0000-000000000003'::uuid, 'el precio negociado con el seller sigue mandando');

-- ---- 5. Aislamiento e idempotencia -----------------------------------------
select ok(
  (select bool_and(estado = 'activa' and vigente_hasta is null) from identidad.tarifas
    where tenant_id = 'e3000000-0000-0000-0000-00000000000c'),
  'cerrar las de X no toca las de otro tenant');
select is(
  jsonb_array_length((identidad.cerrar_tarifas_legadas_del_tenant('e1000000-0000-0000-0000-00000000000a', '2026-09-29'))->'cerradas'),
  0, 'repetir no cierra nada mas');

-- ---- 4. Legada de hoy ya usada ---------------------------------------------
select is(
  jsonb_array_length((identidad.cerrar_tarifas_legadas_del_tenant('e4000000-0000-0000-0000-00000000000d', '2026-09-29'))->'cerradas'),
  1, 'la usada se cierra (no se inactiva)');
select is(
  (select vigente_hasta from identidad.tarifas where id = 'e4000000-3000-0000-0000-000000000001'),
  '2026-09-29'::date, 'rige hoy tal como se uso');
select is(
  (select estado::text from identidad.tarifas where id = 'e4000000-3000-0000-0000-000000000001'),
  'activa', 'sigue activa: el cobro ya generado no cambia');
select is(
  (select tarifa_aplicable_id from operacion.pedidos where id = 'e4000000-4000-0000-0000-000000000001'),
  'e4000000-3000-0000-0000-000000000001'::uuid, 'el pedido conserva su tarifa');
select is(
  (select tarifa_id from identidad.resolver_tarifa('e4000000-0000-0000-0000-00000000000d', null, 'ml_flex', 'flex', null, '2026-09-29')),
  'e4000000-3000-0000-0000-000000000001'::uuid, 'hoy sigue resolviendo la usada');
select is(
  (select tarifa_id from identidad.resolver_tarifa('e4000000-0000-0000-0000-00000000000d', null, 'ml_flex', 'flex', null, '2026-09-30')),
  'e4000000-3000-0000-0000-000000000002'::uuid, 'desde manana resuelve la general');

-- ---- Candidatas (para la bitacora previa) ----------------------------------
select is(
  (select count(*)::int from identidad.tarifas_legadas_del_tenant('e2000000-0000-0000-0000-00000000000b', '2026-09-29')),
  2, 'lista las legadas del tenant (sin seller)');
select is(
  (select count(*)::int from identidad.tarifas_legadas_del_tenant('e1000000-0000-0000-0000-00000000000a', '2026-09-29')),
  0, 'y ninguna si ya estan cerradas');

-- ---- Integracion con el paso 4 ---------------------------------------------
select is(
  jsonb_array_length((identidad.guardar_zonas_y_tarifas_puesta_en_marcha(
    'e5000000-0000-0000-0000-00000000000e', '2026-09-29',
    jsonb_build_array(
      jsonb_build_object('id', null, 'nombre', 'Urbano', 'es_respaldo', false, 'comunas', jsonb_build_array('Providencia'),
        'cobro_clp', 3500, 'pago_clp', 2400, 'excepciones', '[]'::jsonb),
      jsonb_build_object('id', null, 'nombre', 'Periferia', 'es_respaldo', true, 'comunas', jsonb_build_array('Buin'),
        'cobro_clp', 4000, 'pago_clp', 2900, 'excepciones', '[]'::jsonb))
  ))->'legadas_cerradas'->'cerradas'),
  1, 'el guardado del paso 4 cierra las legadas');
select is(
  (select vigente_hasta from identidad.tarifas where id = 'e5000000-3000-0000-0000-000000000001'),
  '2026-09-28'::date, 'y la legada termina ayer');

reset role;

-- ---- Privilegios -----------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'identidad.cerrar_tarifas_legadas_del_tenant(uuid, date)', 'execute'),
  'authenticated no ejecuta el cierre');
select ok(not has_function_privilege('anon', 'identidad.cerrar_tarifas_legadas_del_tenant(uuid, date)', 'execute'),
  'anon no ejecuta el cierre');
select ok(has_function_privilege('service_role', 'identidad.cerrar_tarifas_legadas_del_tenant(uuid, date)', 'execute'),
  'service_role si');

select * from finish();
rollback;
