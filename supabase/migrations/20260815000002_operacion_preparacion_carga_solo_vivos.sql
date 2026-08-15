-- =============================================================================
-- Operación · Preparación del día — LA CARGA POR COMUNA CUENTA SOLO LO VIVO
-- =============================================================================
-- CONTEXTO: `docs/arquitectura/retiro-y-ruteo.md` §7 ("Acumulado por comuna,
-- creciendo solo — el insumo para decidir cuántos conductores por zona antes de
-- que llegue el primer camión"). Predecesora: 20260813000006, que creó
-- `operacion.preparacion_carga_por_comuna`.
--
-- =============================================================================
-- EL PROBLEMA, MEDIDO EN PRODUCCIÓN POR EL USUARIO (2026-08-15)
-- =============================================================================
-- Hizo el flujo completo, entregó un same-day, y volvió a la Preparación del
-- día: el pedido YA ENTREGADO seguía contando como trabajo por repartir.
--
-- Los números lo delataban solos:
--
--   · Carga por comuna: "Lampa · 5 bultos · 1 asignado · 4 por asignar"
--   · Bandeja de asignación: 4 pedidos de Lampa + 1 de Santiago
--
-- Cinco contra cuatro en la misma comuna. La bandeja excluye bien lo entregado
-- —`asignacion.ts` filtra `estado in ('pendiente_asignacion','asignado')`— pero
-- esta función NO tenía filtro de estado: contaba cada bulto escaneado hoy
-- aunque su pedido ya estuviera entregado, cancelado o devuelto.
--
-- =============================================================================
-- POR QUÉ SE FILTRA ACÁ Y NO SE "ARREGLA" EL TOTAL EN LA PANTALLA
-- =============================================================================
-- La tentación es restar los terminales en TypeScript. No sirve: la pantalla
-- calcula `por asignar = total - asignados`, así que un pedido entregado que
-- conserva su `driver_id_asignado` se cuela como "asignado" y uno cuya
-- asignación se soltó se cuela como "por asignar". Las dos cifras mienten, y la
-- segunda es la que manda a un coordinador a repartir trabajo que no existe.
--
-- =============================================================================
-- QUÉ PREGUNTA RESPONDE ESTE PANEL — Y CUÁL NO
-- =============================================================================
-- Responde **"¿cuánto queda por repartir y hacia dónde?"**, que es lo que decide
-- cuántos conductores mandar a cada zona. NO responde "¿cuánto se retiró hoy?".
--
-- Esa distinción importa y no es cosmética: el retiro se le paga al conductor
-- POR VISITA A BODEGA (alcance, Decisiones de cierre), y el respaldo de lo
-- retirado es el ACTA de cada visita —`sesiones_retiro.bultos_total`, congelada
-- al cerrar— que este cambio NO toca. Un bulto entregado sigue estando en su
-- acta y sigue respaldando el pago. Lo único que deja de hacer es figurar como
-- trabajo pendiente en el panel que sirve para repartir trabajo.
--
-- =============================================================================
-- LOS BULTOS SIN PEDIDO SIGUEN CONTANDO
-- =============================================================================
-- El LEFT JOIN no se toca: un bulto escaneado que no casó con ningún pedido
-- (ilegible, o de una ingesta que aún no llegó) sigue entrando y aterrizando en
-- la fila de clave NULL. Es la excepción que el retiro EXISTE para destapar, y
-- esconderla daría un total que no cuadra con lo que hay en el piso. El filtro
-- nuevo solo descarta pedidos que SÍ existen y ya están cerrados.
--
-- Lista de estados terminales: espejo EXACTO de `ESTADOS_TERMINALES_PEDIDO`
-- (`src/modules/operacion/metricas.ts`). Si agregas uno allá, agrégalo acá en el
-- mismo cambio — y repón la lista ENTERA copiándola de esa constante, nunca de
-- una versión vieja de otra migración (CLAUDE.md §Invariantes: así se perdió un
-- valor del CHECK de `tipo_diferencia` sin que nada fallara al migrar).
--
-- Idempotente: `create or replace`. No toca datos, ni permisos, ni la firma —
-- los `grant`/`revoke` de 20260813000006 siguen vigentes tal cual.
-- =============================================================================

create or replace function operacion.preparacion_carga_por_comuna(
  p_tenant_id uuid,
  p_fecha     date
)
returns table (
  comuna_clave        text,
  comuna_etiqueta     text,
  bultos_total        bigint,
  bultos_asignados    bigint,
  bultos_sin_resolver bigint
)
language sql
stable
security definer
set search_path = operacion, identidad, pg_temp
as $$
  with bultos_del_dia as (
    select
      b.pedido_id,
      p.driver_id_asignado,
      p.destinatario_comuna,
      nullif(lower(btrim(p.destinatario_comuna)), '') as comuna_clave

    from operacion.bultos_retiro b

    join operacion.sesiones_retiro s
      on s.id        = b.sesion_retiro_id
     and s.tenant_id = b.tenant_id

    -- LEFT JOIN intacto: un bulto sin pedido entra igual y cae en la fila de
    -- clave NULL. Ver la cabecera — es la excepción que hay que destapar.
    left join operacion.pedidos p
      on p.id        = b.pedido_id
     and p.tenant_id = b.tenant_id
     and p.tenant_id = p_tenant_id

    where b.tenant_id       = p_tenant_id
      and s.tenant_id       = p_tenant_id
      and s.fecha_operacion = p_fecha

      -- EL FILTRO NUEVO. `p.estado is null` conserva los bultos sin pedido: sin
      -- esa mitad, el LEFT JOIN de arriba quedaría convertido en un INNER y los
      -- ilegibles desaparecerían del panel en silencio.
      and (
        p.estado is null
        or p.estado not in (
          'entregado', 'entregado_manual', 'fallido',
          'fallido_manual', 'cancelado', 'devuelto'
        )
      )
  )
  select
    d.comuna_clave,
    max(d.destinatario_comuna) filter (where d.comuna_clave is not null),
    count(*),
    count(*) filter (where d.driver_id_asignado is not null),
    count(*) filter (where d.pedido_id is null)
  from bultos_del_dia d
  group by d.comuna_clave
  order by (d.comuna_clave is null), count(*) desc, d.comuna_clave;
$$;

comment on function operacion.preparacion_carga_por_comuna(uuid, date) is
  'De lo retirado hoy, ¿cuánto queda POR REPARTIR y hacia dónde? Agrupa los
   bultos escaneados en las visitas del día por comuna de destino del pedido.

   ⚠️ Desde el 2026-08-15 EXCLUYE los pedidos en estado terminal (entregado,
   entregado_manual, fallido, fallido_manual, cancelado, devuelto): este panel
   decide cuántos conductores mandar a cada zona, y un pedido ya cerrado no es
   trabajo pendiente. Antes los contaba, y un same-day entregado en la mañana
   seguía figurando como carga de la tarde.

   NO es la cifra de "cuánto se retiró hoy" ni el respaldo del pago del retiro
   al conductor: eso es el ACTA de cada visita (sesiones_retiro.bultos_total),
   que se congela al cerrar y no se toca acá.

   Los bultos SIN pedido resuelto (ilegibles, o de una ingesta que no llegó)
   siguen contando y caen en la fila de clave NULL: son la excepción que el
   retiro existe para destapar.';
