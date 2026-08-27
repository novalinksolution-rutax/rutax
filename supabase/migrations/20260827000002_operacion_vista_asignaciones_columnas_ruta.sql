-- =============================================================================
-- Operación · la vista espejo vuelve a tener TODAS las columnas de la tabla
-- =============================================================================
-- 🔴 ARREGLA UN FALLO EN PRODUCCIÓN (2026-08-27): el conductor abría la app y
-- no veía NINGUNA de sus paradas, con el manifiesto confirmado y visible en la
-- web.
--
-- -----------------------------------------------------------------------------
-- LA TRAMPA: `select *` EN UNA VISTA SE EXPANDE AL CREARLA
-- -----------------------------------------------------------------------------
-- `public.asignaciones_pedido` es el espejo de `operacion.asignaciones_pedido`
-- para PostgREST, y se definió como `select * from operacion.asignaciones_pedido`.
-- Postgres **expande ese `*` en el momento de crear la vista** y lo congela: la
-- migración `20260827000001` agregó cuatro columnas a la tabla base
-- —`orden_fijado`, `tramo_polilinea`, `tramo_distancia_m`, `tramo_duracion_s`—
-- y la vista siguió con las once de antes.
--
-- Consecuencia: `/api/conductor/manifiesto` pedía `orden_fijado` contra la
-- vista, PostgREST respondía «column does not exist», y como el llamador
-- desestructuraba solo `data` sin mirar `error`, la respuesta salía **200 con
-- cero paradas**. Un fallo total y una ruta vacía se ven exactamente igual.
--
-- ⚠️ **Regla que queda:** agregar una columna a una tabla de `operacion` NO la
-- publica. Hay que reponer su vista espejo en la misma migración, o el día que
-- alguien la lea desde PostgREST se encontrará con esto.
--
-- -----------------------------------------------------------------------------
-- ⚠️ `security_invoker` NO ES OPCIONAL AL REPONER UNA VISTA ESPEJO
-- -----------------------------------------------------------------------------
-- `create or replace view` conserva los GRANT pero **reemplaza las opciones**.
-- Perder `security_invoker = true` apagaría la RLS y la vista pasaría a leerse
-- con los permisos del dueño: **filtraría asignaciones entre couriers, sin un
-- solo error**. Con un tenant en producción el resultado se ve idéntico al
-- correcto, que es lo que lo hace peligroso. Ya mordió una vez con
-- `public.conductores`.
-- =============================================================================

create or replace view public.asignaciones_pedido
  with (security_invoker = true)
  as select * from operacion.asignaciones_pedido;

comment on view public.asignaciones_pedido is
  'Espejo de operacion.asignaciones_pedido para PostgREST.
   RLS: P1 + (P2 seller OR P3 conductor).
   orden_ruta y orden_fijado son LEGIBLES pero NO escribibles: el privilegio de
   INSERT/UPDATE está revocado a authenticated en la vista y en la tabla base.
   La secuencia, la fijación y la geometría del tramo se escriben SOLO por
   operacion.aplicar_secuencia_paradas.';

-- Se reponen por si el `create or replace` de arriba tocara la ACL: la escritura
-- de estas columnas nunca pasa por PostgREST.
revoke insert, update on operacion.asignaciones_pedido from authenticated;
revoke insert, update on public.asignaciones_pedido    from authenticated;

-- =============================================================================
-- Aserción: la vista y la tabla tienen las MISMAS columnas
-- =============================================================================
-- Falla la migración si vuelven a divergir. Es barata y es exactamente la
-- comprobación que nadie hizo el 26 de agosto.
do $$
declare
  v_faltan text;
begin
  select string_agg(c.column_name, ', ' order by c.ordinal_position)
    into v_faltan
    from information_schema.columns c
   where c.table_schema = 'operacion'
     and c.table_name   = 'asignaciones_pedido'
     and not exists (
       select 1 from information_schema.columns v
        where v.table_schema = 'public'
          and v.table_name   = 'asignaciones_pedido'
          and v.column_name  = c.column_name
     );

  if v_faltan is not null then
    raise exception
      'public.asignaciones_pedido no publica estas columnas de la tabla base: %. Un select * en una vista se congela al crearla.',
      v_faltan;
  end if;
end $$;
