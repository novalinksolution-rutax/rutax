-- =============================================================================
-- identidad.guardar_zonas_y_tarifas_puesta_en_marcha (20260928000004)
-- =============================================================================
-- Demuestra contra Postgres real:
--   A. Privilegios: solo service_role ejecuta (authenticated y anon, no).
--   B. Escritura completa: 2 zonas (una de respaldo), sus comunas, tarifas por
--      zona + excepciones por plataforma + la general con los montos del
--      respaldo, tipo_entrega siempre NULL, paso = 4.
--   C. Aislamiento A<->B: guardar para A no toca zonas, tarifas ni config de B, y
--      pasar una zona de A en la llamada de B falla sin alterarla.
--   D. Regla de re-guardado: identico = no toca; montos distintos NUNCA editan
--      la fila: hoy sin uso -> inactiva; anterior -> vigente_hasta = ayer; ya
--      usada hoy -> se cierra hoy y la nueva empieza manana; apagar las
--      excepciones las retira.
--   E. Validaciones y atomicidad: plataforma no ofrecida, zona sin comunas,
--      monto 0, comuna repetida, tenant sin configuracion; un fallo a mitad de
--      camino no deja zonas huerfanas.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(41);

-- Payload de dos zonas. `exc` agrega excepciones rutax_manual y ml_flex por zona
-- con los montos de la zona.
create or replace function t_pl(
  z1 uuid, z2 uuid, c1 int, p1 int, c2 int, p2 int, exc boolean,
  com1 text[] default array['Providencia', 'Ñuñoa'],
  com2 text[] default array['Buin', 'Pirque']
) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('id', z1, 'nombre', 'Gran Santiago urbano', 'es_respaldo', false,
      'comunas', to_jsonb(com1), 'cobro_clp', c1, 'pago_clp', p1,
      'excepciones', case when exc then jsonb_build_array(
        jsonb_build_object('fuente', 'rutax_manual', 'cobro_clp', c1, 'pago_clp', p1),
        jsonb_build_object('fuente', 'ml_flex', 'cobro_clp', c1, 'pago_clp', p1)) else '[]'::jsonb end),
    jsonb_build_object('id', z2, 'nombre', 'Periferia', 'es_respaldo', true,
      'comunas', to_jsonb(com2), 'cobro_clp', c2, 'pago_clp', p2,
      'excepciones', case when exc then jsonb_build_array(
        jsonb_build_object('fuente', 'rutax_manual', 'cobro_clp', c2, 'pago_clp', p2),
        jsonb_build_object('fuente', 'ml_flex', 'cobro_clp', c2, 'pago_clp', p2)) else '[]'::jsonb end))
$$;

-- Atajo: guarda para A y devuelve el resumen.
create or replace function t_guardar_a(p_hoy date, p_payload jsonb) returns jsonb language sql as $$
  select identidad.guardar_zonas_y_tarifas_puesta_en_marcha('a0000000-0000-0000-0000-00000000000a', p_hoy, p_payload)
$$;

-- Ids de las zonas de A (existen tras el primer guardado).
create or replace function t_z1() returns uuid language sql as $$
  select id from identidad.zonas where tenant_id = 'a0000000-0000-0000-0000-00000000000a' and not es_respaldo $$;
create or replace function t_z2() returns uuid language sql as $$
  select id from identidad.zonas where tenant_id = 'a0000000-0000-0000-0000-00000000000a' and es_respaldo $$;

-- -----------------------------------------------------------------------------
-- Fixtures. A: Flex si, Shopify no. B: con zona y tarifa propias. C: para la
-- atomicidad. D: sin fila de configuracion.
-- -----------------------------------------------------------------------------
insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado) values
  ('a0000000-0000-0000-0000-00000000000a', 'Courier A', 'Courier A SpA', '76910111-5', 'activo'),
  ('b0000000-0000-0000-0000-00000000000b', 'Courier B', 'Courier B SpA', '76910222-7', 'activo'),
  ('c0000000-0000-0000-0000-00000000000c', 'Courier C', 'Courier C SpA', '76910333-9', 'activo'),
  ('d0000000-0000-0000-0000-00000000000d', 'Courier D', 'Courier D SpA', '76910444-1', 'activo');

insert into identidad.courier_config_operacion (tenant_id, ofrece_flex, ofrece_shopify, puesta_en_marcha_paso) values
  ('a0000000-0000-0000-0000-00000000000a', true,  false, 3),
  ('b0000000-0000-0000-0000-00000000000b', false, false, 3),
  ('c0000000-0000-0000-0000-00000000000c', false, false, 3);

insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'Seller A1', '77910111-3', 'C', 'a1@zt.test', 'activo');

insert into identidad.zonas (id, tenant_id, nombre, activa, es_respaldo) values
  ('b0000000-2000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'Zona B', true, true);
insert into identidad.zona_comunas (tenant_id, zona_id, comuna) values
  ('b0000000-0000-0000-0000-00000000000b', 'b0000000-2000-0000-0000-000000000001', 'Providencia');
insert into identidad.tarifas (id, tenant_id, zona_id, monto_clp, monto_conductor_clp, vigente_desde) values
  ('b0000000-3000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'b0000000-2000-0000-0000-000000000001', 5000, 3000, '2026-01-01');

-- =============================================================================
-- A. Privilegios
-- =============================================================================
select is(has_function_privilege('authenticated',
  'identidad.guardar_zonas_y_tarifas_puesta_en_marcha(uuid, date, jsonb)', 'execute'), false,
  'authenticated NO puede ejecutarla');
select is(has_function_privilege('anon',
  'identidad.guardar_zonas_y_tarifas_puesta_en_marcha(uuid, date, jsonb)', 'execute'), false,
  'anon NO puede ejecutarla');
select is(has_function_privilege('service_role',
  'identidad.guardar_zonas_y_tarifas_puesta_en_marcha(uuid, date, jsonb)', 'execute'), true,
  'service_role SI: la llama la Server Action tras exigir al dueño');

-- =============================================================================
-- B. Primer guardado de A (2026-09-20), como service_role
-- =============================================================================
grant execute on function t_pl(uuid, uuid, int, int, int, int, boolean, text[], text[]) to service_role;
grant execute on function t_guardar_a(date, jsonb) to service_role;
grant execute on function t_z1() to service_role;
grant execute on function t_z2() to service_role;
set local role service_role;

select is(
  (t_guardar_a('2026-09-20', t_pl(null, null, 3500, 2400, 4000, 2900, true)))->>'tarifas_creadas',
  '7', 'primer guardado: 2 zonas + 4 excepciones + 1 general = 7 tarifas');

select is((select count(*)::int from identidad.zonas where tenant_id = 'a0000000-0000-0000-0000-00000000000a'), 2,
  'A quedo con 2 zonas');
select is((select count(*)::int from identidad.zonas where tenant_id = 'a0000000-0000-0000-0000-00000000000a' and es_respaldo and nombre = 'Periferia'), 1,
  'Periferia es la zona de respaldo');
select is((select count(*)::int from identidad.zona_comunas where tenant_id = 'a0000000-0000-0000-0000-00000000000a'), 4,
  'A tiene 4 comunas asignadas');
select is((select count(*)::int from identidad.tarifas where tenant_id = 'a0000000-0000-0000-0000-00000000000a' and estado = 'activa' and vigente_hasta is null), 7,
  '7 tarifas activas abiertas');
select is((select array[monto_clp::text, monto_conductor_clp::text] from identidad.tarifas
   where tenant_id = 'a0000000-0000-0000-0000-00000000000a' and zona_id is null and fuente is null),
  array['4000', '2900'], 'la general lleva los montos de la zona de respaldo');
select is((select count(*)::int from identidad.tarifas where tenant_id = 'a0000000-0000-0000-0000-00000000000a' and (tipo_entrega is not null or seller_id is not null)), 0,
  'ninguna tarifa nueva escribe tipo_entrega ni seller');
select is((select puesta_en_marcha_paso::int from identidad.courier_config_operacion where tenant_id = 'a0000000-0000-0000-0000-00000000000a'), 4,
  'el paso avanzo a 4');

-- C. Aislamiento: B intacto
select is((select count(*)::int from identidad.zonas where tenant_id = 'b0000000-0000-0000-0000-00000000000b'), 1, 'B conserva su unica zona');
select is((select array[monto_clp::text, estado::text] from identidad.tarifas where id = 'b0000000-3000-0000-0000-000000000001'),
  array['5000', 'activa'], 'la tarifa de B no se toco');
select is((select puesta_en_marcha_paso::int from identidad.courier_config_operacion where tenant_id = 'b0000000-0000-0000-0000-00000000000b'), 3,
  'la configuracion de B no avanzo');

-- =============================================================================
-- D. Re-guardado
-- =============================================================================
select is(
  (t_guardar_a('2026-09-20', t_pl(t_z1(), t_z2(), 3500, 2400, 4000, 2900, true)))->>'tarifas_sin_cambio',
  '7', 're-guardar identico: 7 sin cambio');
select is((select count(*)::int from identidad.zonas where tenant_id = 'a0000000-0000-0000-0000-00000000000a'), 2,
  'no se duplicaron las zonas');

-- Mismo dia, cambia el cobro de la zona 1 y nadie uso las tarifas: se reemplazan
-- (la zona 1 y sus 2 excepciones, que llevan el mismo monto).
select is(
  (t_guardar_a('2026-09-20', t_pl(t_z1(), t_z2(), 3600, 2400, 4000, 2900, true)))->>'tarifas_inactivadas',
  '3', 'mismo dia y sin uso: las 3 filas de la zona 1 pasan a inactiva');
select is((select count(*)::int from identidad.tarifas where tenant_id = 'a0000000-0000-0000-0000-00000000000a' and estado = 'inactiva'), 3,
  'las reemplazadas quedaron inactivas, no se borraron');
select is((select count(*)::int from identidad.tarifas where tenant_id = 'a0000000-0000-0000-0000-00000000000a' and estado = 'activa' and vigente_hasta is null), 7,
  'siguen 7 activas abiertas');

-- Dia siguiente, cambia el respaldo: zona 2 + sus 2 excepciones + la general
-- llevan el dinero de ayer; se CIERRAN, no se editan.
select is(
  (t_guardar_a('2026-09-28', t_pl(t_z1(), t_z2(), 3600, 2400, 4100, 2900, true)))->>'tarifas_cerradas',
  '4', 'dia siguiente: se cierran zona 2, sus 2 excepciones y la general');
select is((select vigente_hasta from identidad.tarifas
   where tenant_id = 'a0000000-0000-0000-0000-00000000000a' and zona_id = t_z2() and fuente is null and monto_clp = 4000),
  '2026-09-27'::date, 'la fila vieja de la zona 2 termina ayer');
select is((select vigente_desde from identidad.tarifas
   where tenant_id = 'a0000000-0000-0000-0000-00000000000a' and zona_id = t_z2() and fuente is null and monto_clp = 4100 and vigente_hasta is null),
  '2026-09-28'::date, 'la nueva de la zona 2 empieza hoy');
select is((select monto_clp::int from identidad.tarifas
   where tenant_id = 'a0000000-0000-0000-0000-00000000000a' and zona_id = t_z2() and fuente is null and monto_clp = 4000),
  4000, 'el monto de la fila vieja NO se edito');

-- Cambia la zona 1 hoy: cierra las 3 filas del 20-sep. La nueva zona-1 nace hoy.
select is(
  (t_guardar_a('2026-09-28', t_pl(t_z1(), t_z2(), 3700, 2400, 4100, 2900, true)))->>'tarifas_cerradas',
  '3', 'cambio de zona 1: se cierran sus 3 filas anteriores');

-- Una tarifa de HOY que ya se uso no se reemplaza: se cierra hoy y la nueva
-- empieza manana. Se referencia desde un pedido.
reset role;
insert into operacion.pedidos (id, tenant_id, seller_id, tipo_pedido, fuente, origen, ml_shipment_id, estado,
                               destinatario_nombre, destinatario_direccion, destinatario_comuna, tarifa_aplicable_id)
select 'a3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a',
       'a1000000-0000-0000-0000-000000000001', 'flex', 'ml_flex', 'ml_ingesta', 'SHP-ZT-1', 'pendiente_asignacion',
       'Dest', 'Calle 1', 'Providencia', t.id
from identidad.tarifas t
where t.tenant_id = 'a0000000-0000-0000-0000-00000000000a' and t.zona_id = t_z1() and t.fuente is null
  and t.estado = 'activa' and t.vigente_hasta is null;
set local role service_role;

select is(
  (t_guardar_a('2026-09-28', t_pl(t_z1(), t_z2(), 3800, 2400, 4100, 2900, true)))->>'tarifas_inactivadas',
  '2', 'las 2 excepciones de hoy sin uso pasan a inactiva');
select is((select vigente_hasta from identidad.tarifas where id =
   (select tarifa_aplicable_id from operacion.pedidos where id = 'a3000000-0000-0000-0000-000000000001')),
  '2026-09-28'::date, 'la tarifa ya usada hoy se cierra hoy: rige tal como se uso');
select is((select estado::text from identidad.tarifas where id =
   (select tarifa_aplicable_id from operacion.pedidos where id = 'a3000000-0000-0000-0000-000000000001')),
  'activa', 'y sigue activa (el pedido se cobra con ella)');
select is((select vigente_desde from identidad.tarifas
   where tenant_id = 'a0000000-0000-0000-0000-00000000000a' and zona_id = t_z1() and fuente is null and monto_clp = 3800),
  '2026-09-29'::date, 'la nueva de la zona 1 empieza manana');

-- Apagar "Diferenciar por plataforma": las excepciones se retiran (una viva le
-- gana a la tarifa de la zona).
select is(
  (t_guardar_a('2026-09-28', t_pl(t_z1(), t_z2(), 3800, 2400, 4100, 2900, false)))->>'tarifas_sin_cambio',
  '3', 'sin excepciones: zona 1, zona 2 y la general no se tocan');
select is((select count(*)::int from identidad.tarifas
   where tenant_id = 'a0000000-0000-0000-0000-00000000000a' and estado = 'activa' and vigente_hasta is null and fuente is not null),
  0, 'no queda ninguna excepcion abierta');

-- =============================================================================
-- E. Validaciones y atomicidad
-- =============================================================================
select throws_ok(
  $$ select t_guardar_a('2026-09-28', replace(t_pl(t_z1(), t_z2(), 3800, 2400, 4100, 2900, true)::text, 'ml_flex', 'shopify')::jsonb) $$,
  '23514', null, 'una plataforma que el courier no ofrece se rechaza');
select throws_ok(
  $$ select t_guardar_a('2026-09-28', t_pl(t_z1(), t_z2(), 3800, 2400, 4100, 2900, false, array[]::text[])) $$,
  '23514', null, 'una zona sin comunas se rechaza');
select throws_ok(
  $$ select t_guardar_a('2026-09-28', t_pl(t_z1(), t_z2(), 0, 2400, 4100, 2900, false)) $$,
  '23514', null, 'cobro en 0 se rechaza');
select throws_ok(
  $$ select t_guardar_a('2026-09-28', t_pl(t_z1(), t_z2(), 3800, 0, 4100, 2900, false)) $$,
  '23514', null, 'pago al conductor en 0 se rechaza');
select throws_ok(
  $$ select t_guardar_a('2026-09-28', t_pl(t_z1(), t_z2(), 3800, 2400, 4100, 2900, false, array['Providencia'], array['Providencia'])) $$,
  '23505', null, 'una comuna en las dos zonas se rechaza');
select is((select count(*)::int from identidad.zona_comunas where tenant_id = 'a0000000-0000-0000-0000-00000000000a'), 4,
  'tras los rechazos A conserva sus 4 comunas (nada quedo a medias)');

-- Atomicidad: C falla al final (plataforma no ofrecida) DESPUES de haber
-- insertado zonas y comunas; no debe quedar nada.
select throws_ok(
  $$ select identidad.guardar_zonas_y_tarifas_puesta_en_marcha('c0000000-0000-0000-0000-00000000000c', '2026-09-28',
       replace(t_pl(null, null, 3500, 2400, 4000, 2900, true)::text, 'ml_flex', 'shopify')::jsonb) $$,
  '23514', null, 'C: falla a mitad de camino');
select is((select count(*)::int from identidad.zonas where tenant_id = 'c0000000-0000-0000-0000-00000000000c')
        + (select count(*)::int from identidad.tarifas where tenant_id = 'c0000000-0000-0000-0000-00000000000c'),
  0, 'C: ni zonas ni tarifas huerfanas');

-- Aislamiento: la llamada de B con una zona de A falla y no la altera.
select throws_ok(
  $$ select identidad.guardar_zonas_y_tarifas_puesta_en_marcha('b0000000-0000-0000-0000-00000000000b', '2026-09-28',
       t_pl(t_z1(), null, 3500, 2400, 4000, 2900, false)) $$,
  'P0002', null, 'B no puede reescribir una zona de A');
select is((select nombre from identidad.zonas where id = t_z1()), 'Gran Santiago urbano', 'la zona de A no cambio');

-- Sin configuracion de operacion (el paso 3 no ocurrio).
select throws_ok(
  $$ select identidad.guardar_zonas_y_tarifas_puesta_en_marcha('d0000000-0000-0000-0000-00000000000d', '2026-09-28',
       t_pl(null, null, 3500, 2400, 4000, 2900, false)) $$,
  'P0002', null, 'sin configuracion de operacion no se guarda nada');

reset role;
select * from finish();
rollback;
