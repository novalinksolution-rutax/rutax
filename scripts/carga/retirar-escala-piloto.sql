-- =============================================================================
-- Retira el fixture de carga a escala del piloto.
-- =============================================================================
-- Borra SOLO lo que sembró `sembrar-escala-piloto.sql`, identificado por sus
-- prefijos de id. No toca una sola fila del seed de demo.
--
-- Orden inverso al de creación por las claves foráneas: primero las líneas de
-- dinero, después los pedidos, y al final los catálogos.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

delete from dinero.lineas_liquidacion where id::text like 'c6000000%';
delete from dinero.lineas_cobro       where id::text like 'c5000000%';
delete from operacion.incidencias     where pedido_id in (select id from operacion.pedidos where id::text like 'c2000000%');
delete from operacion.pruebas_entrega where pedido_id in (select id from operacion.pedidos where id::text like 'c2000000%');
delete from operacion.asignaciones_pedido where pedido_id in (select id from operacion.pedidos where id::text like 'c2000000%');
delete from operacion.pedidos         where id::text like 'c2000000%';
delete from dinero.periodos_cobro     where id::text like 'c4000000%';
delete from identidad.tarifas         where id::text like 'c3000000%';
delete from identidad.conductores     where id::text like 'c1000000%';
delete from identidad.sellers         where id::text like 'c0000000%';

commit;

select
  (select count(*) from operacion.pedidos where id::text like 'c2000000%') as pedidos_restantes,
  (select count(*) from dinero.lineas_cobro where id::text like 'c5000000%') as lineas_restantes,
  (select count(*) from operacion.pedidos) as pedidos_totales;
