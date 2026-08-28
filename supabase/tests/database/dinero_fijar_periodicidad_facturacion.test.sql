-- =============================================================================
-- Dinero · fijar la periodicidad de facturación: candado, atomicidad y ACL
-- =============================================================================
-- POR QUÉ EXISTE ESTE ARCHIVO
--
-- `dinero.config_periodos` la leía el motor desde el primer día y **no la
-- escribía nadie**: el único insert del repositorio estaba en los seeds de demo.
-- La lectura caía siempre en el respaldo del código —'mensual'— así que todo
-- courier facturaba mensual sin poder cambiarlo, en silencio.
--
-- Al darle una vía de escritura aparecen tres formas nuevas de romper dinero, y
-- las tres viven en SQL:
--
--   1. **Quedarse sin fila activa.** El cambio son dos escrituras (desactivar la
--      vigente, insertar la nueva) y el índice único parcial impone el orden. Si
--      dejaran de compartir transacción, un fallo en la segunda deja al tenant
--      sin ninguna activa — y eso NO falla: vuelve a caer en 'mensual' por el
--      respaldo del motor, que es el bug original otra vez.
--
--   2. **Partir un período en curso.** Cambiar el tipo a mitad de período crea
--      un rango que se solapa con el que ya tiene líneas, y el seller recibe dos
--      facturas por días repetidos.
--
--   3. **Que la ejecute quien no debe.** `create or replace function` NO resetea
--      la ACL: si alguien repone esta función sin repetir los `revoke`, el grant
--      viejo sobrevive y la prueba de mutación pasa en verde.
--
-- ⚠️ El candado se comprueba CON CONTRAPRUEBA: un candado que bloquee siempre
-- también pasaría una prueba que solo verifique el bloqueo, y dejaría la
-- periodicidad imposible de cambiar para siempre.
--
-- ⚠️ Y se comprueba que el candado mira las LÍNEAS y no `total_lineas`: esa
-- columna se rellena al cerrar y vale 0 durante todo el período, así que
-- confiársela lo dejaría abierto justo cuando tiene que cerrarse. El fixture la
-- deja en 0 a propósito.
-- =============================================================================

begin;
select plan(17);

-- -----------------------------------------------------------------------------
-- 0 · Fixture propio. No se apoya en el seed: estas pruebas corren en bases
--     que pueden no tenerlo.
-- -----------------------------------------------------------------------------
insert into identidad.tenants (id, nombre_fantasia, razon_social, rut)
values ('dddddddd-0000-0000-0000-000000000001', 'Courier Periodicidad',
        'Courier Periodicidad SpA', '77000001-1');

insert into identidad.sellers (id, tenant_id, razon_social, rut)
values ('dddddddd-0000-0000-0000-00000000000a',
        'dddddddd-0000-0000-0000-000000000001', 'Seller de Prueba', '77000002-k');

insert into identidad.tarifas (id, tenant_id, tipo_entrega, monto_clp, vigente_desde)
values ('dddddddd-0000-0000-0000-00000000000b',
        'dddddddd-0000-0000-0000-000000000001', 'same_day', 3000, '2026-01-01');

insert into operacion.pedidos (
  id, tenant_id, seller_id, tipo_pedido, origen, fuente,
  destinatario_nombre, destinatario_direccion, destinatario_comuna)
values ('dddddddd-0000-0000-0000-00000000000c',
        'dddddddd-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-00000000000a',
        'same_day', 'same_day_manual', 'rutax_manual',
        'Destinatario', 'Calle 123', 'Maipú');

-- -----------------------------------------------------------------------------
-- 1 · La función existe y su ACL es la que debe ser
-- -----------------------------------------------------------------------------
select has_function('dinero', 'fijar_periodicidad_facturacion', array['uuid', 'text'],
  'existe dinero.fijar_periodicidad_facturacion(uuid, text)');

select ok(
  has_function_privilege('service_role', 'dinero.fijar_periodicidad_facturacion(uuid, text)', 'execute'),
  'service_role SÍ puede ejecutarla: la llaman las Server Actions');

select ok(
  not has_function_privilege('authenticated', 'dinero.fijar_periodicidad_facturacion(uuid, text)', 'execute'),
  'authenticated NO puede ejecutarla — el navegador nunca cambia la periodicidad directo');

select ok(
  not has_function_privilege('anon', 'dinero.fijar_periodicidad_facturacion(uuid, text)', 'execute'),
  'anon NO puede ejecutarla');

-- -----------------------------------------------------------------------------
-- 2 · Validación de entrada
-- -----------------------------------------------------------------------------
select throws_ok(
  $$ select dinero.fijar_periodicidad_facturacion('dddddddd-0000-0000-0000-000000000001', 'bimestral') $$,
  '23514',
  null,
  'un tipo fuera de la lista del CHECK se rechaza, no se guarda');

-- -----------------------------------------------------------------------------
-- 3 · Camino feliz: primera vez que el courier elige
-- -----------------------------------------------------------------------------
select is(
  (dinero.fijar_periodicidad_facturacion(
     'dddddddd-0000-0000-0000-000000000001', 'quincenal') ->> 'aplicado')::boolean,
  true,
  'sin configuración previa, la elección se aplica');

select is(
  (select count(*)::int from dinero.config_periodos
    where tenant_id = 'dddddddd-0000-0000-0000-000000000001' and seller_id is null and activa),
  1,
  'queda exactamente UNA fila activa');

select is(
  (select tipo_periodo from dinero.config_periodos
    where tenant_id = 'dddddddd-0000-0000-0000-000000000001' and seller_id is null and activa),
  'quincenal',
  'y es la que se pidió');

-- `dia_cierre` NULL a propósito: `calcularRangoPeriodo` no la lee. Si algún día
-- el motor la respeta, esta aserción es el sitio donde enterarse.
select is(
  (select dia_cierre from dinero.config_periodos
    where tenant_id = 'dddddddd-0000-0000-0000-000000000001' and seller_id is null and activa),
  null,
  'dia_cierre queda NULL: el motor todavía no la lee y no se finge que sí');

-- -----------------------------------------------------------------------------
-- 4 · El cambio conserva historial y deja UNA sola activa
-- -----------------------------------------------------------------------------
select is(
  (dinero.fijar_periodicidad_facturacion(
     'dddddddd-0000-0000-0000-000000000001', 'semanal') ->> 'tipo_anterior'),
  'quincenal',
  'el cambio informa de qué venía');

select is(
  (select count(*)::int from dinero.config_periodos
    where tenant_id = 'dddddddd-0000-0000-0000-000000000001' and seller_id is null and activa),
  1,
  'tras el cambio sigue habiendo UNA sola activa — el índice único parcial se respeta');

select is(
  (select count(*)::int from dinero.config_periodos
    where tenant_id = 'dddddddd-0000-0000-0000-000000000001' and seller_id is null),
  2,
  'y la anterior no se borra: la tabla es un historial');

-- -----------------------------------------------------------------------------
-- 5 · Reafirmar lo mismo es un no-op, no una fila más de historial
-- -----------------------------------------------------------------------------
select is(
  (dinero.fijar_periodicidad_facturacion(
     'dddddddd-0000-0000-0000-000000000001', 'semanal') ->> 'motivo'),
  'sin_cambio',
  'pedir lo que ya está puesto no cambia nada');

select is(
  (select count(*)::int from dinero.config_periodos
    where tenant_id = 'dddddddd-0000-0000-0000-000000000001' and seller_id is null),
  2,
  'y no agrega una fila de historial por cada pulsación de Guardar');

-- -----------------------------------------------------------------------------
-- 6 · El candado, con su contraprueba
-- -----------------------------------------------------------------------------

-- Un período ABIERTO pero SIN líneas no bloquea: es el caso del courier que
-- acaba de entrar. Sin esta contraprueba, un candado que bloquee siempre pasaría
-- la prueba de abajo y dejaría la periodicidad imposible de cambiar.
insert into dinero.periodos_cobro (id, tenant_id, seller_id, fecha_inicio, fecha_fin, tipo_periodo, estado, total_lineas)
values ('dddddddd-0000-0000-0000-00000000000d',
        'dddddddd-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-00000000000a',
        '2026-08-01', '2026-08-31', 'mensual', 'abierto', 0);

select is(
  (dinero.fijar_periodicidad_facturacion(
     'dddddddd-0000-0000-0000-000000000001', 'mensual') ->> 'aplicado')::boolean,
  true,
  'un período abierto SIN líneas no bloquea el cambio');

-- Ahora con una línea colgando. `total_lineas` se deja en 0 A PROPÓSITO: es lo
-- que vale en la vida real durante todo el período, y el candado no debe mirarla.
insert into dinero.lineas_cobro (
  tenant_id, seller_id, pedido_id, tarifa_id, periodo_cobro_id,
  monto_base_clp, concepto, tipo_pedido, fecha_hecho)
values ('dddddddd-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-00000000000a',
        'dddddddd-0000-0000-0000-00000000000c',
        'dddddddd-0000-0000-0000-00000000000b',
        'dddddddd-0000-0000-0000-00000000000d',
        3000, 'Entrega de prueba', 'same_day', '2026-08-20');

select is(
  (dinero.fijar_periodicidad_facturacion(
     'dddddddd-0000-0000-0000-000000000001', 'semanal') ->> 'motivo'),
  'periodos_abiertos_con_lineas',
  'con un período abierto que YA tiene líneas, el cambio se niega (y total_lineas seguía en 0)');

select is(
  (select tipo_periodo from dinero.config_periodos
    where tenant_id = 'dddddddd-0000-0000-0000-000000000001' and seller_id is null and activa),
  'mensual',
  'y la configuración NO se movió tras el rechazo');

select * from finish();
rollback;
