-- =============================================================================
-- Operación · Preparación del día — LA CARGA MUESTRA SOLO LO QUE FALTA DESPACHAR
-- =============================================================================
-- CONTEXTO: `docs/arquitectura/retiro-y-ruteo.md` §7. Predecesoras:
-- 20260813000006 (creó la función) y 20260815000002 (le sacó los terminales).
--
-- =============================================================================
-- QUÉ CAMBIA, Y POR QUÉ ES LA MISMA IDEA LLEVADA HASTA EL FINAL
-- =============================================================================
-- La migración anterior sacó los pedidos en estado terminal. El usuario observó
-- en producción que faltaba la otra mitad: cuatro bultos de Lampa ya asignados
-- —algunos incluso EN RUTA— seguían apareciendo como carga a repartir.
--
-- Tiene razón, y la razón está en para qué existe este panel: es el insumo para
-- decidir **cuántos conductores mandar a cada zona**. Un bulto que ya tiene
-- conductor y cuyo manifiesto está confirmado ya no participa de esa decisión —
-- está tomada. Dejarlo ahí infla la cifra con la que se reparte la flota, que es
-- exactamente lo que el panel vino a dar bien.
--
-- REGLA NUEVA — un bulto se muestra mientras su trabajo siga ABIERTO:
--
--   ✔ el pedido está `pendiente_asignacion`            → nadie lo tomó todavía
--   ✔ está `asignado` y su manifiesto sigue `borrador` → el coordinador aún lo mueve
--   ✔ el bulto NO casó con ningún pedido               → la excepción a resolver
--   ✘ su manifiesto ya está confirmado / en ruta / completado
--   ✘ el pedido está `en_ruta` o en estado terminal
--
-- El corte es el manifiesto CONFIRMADO y no la simple asignación, a propósito:
-- entre "lo puse en un manifiesto" y "lo cerré" el coordinador todavía está
-- repartiendo, y esas dos situaciones no son lo mismo. Mientras el manifiesto
-- sigue en `borrador`, el bulto todavía se puede mover de conductor y por lo
-- tanto sigue siendo parte de la decisión.
--
-- =============================================================================
-- LO QUE ESTO **NO** TOCA, Y CONVIENE NO CONFUNDIR
-- =============================================================================
-- La cifra "Bultos retirados hoy" NO sale de acá: se calcula sumando las visitas
-- (`preparacion_visitas_del_dia`, ver `_lib/estado-preparacion.ts`). Eso es
-- correcto y se conserva — "cuánto se retiró hoy" es un número que solo debe
-- CRECER durante el día, y el acta de cada visita sigue siendo el respaldo del
-- pago del retiro al conductor. Este panel responde otra pregunta: "de lo que
-- entró, ¿cuánto falta por despachar y hacia dónde?".
--
-- Dos números distintos que ahora divergen a propósito durante el día. Si alguna
-- vez alguien los ve distintos y "los cuadra", romperá uno de los dos.
--
-- =============================================================================
-- EL JOIN NUEVO, Y POR QUÉ NO ALCANZABA CON `pedidos.estado`
-- =============================================================================
-- `estado = 'asignado'` no distingue "en un borrador que el coordinador sigue
-- armando" de "en un manifiesto ya cerrado y entregado al conductor". Esa
-- diferencia solo vive en `manifiestos.estado`, alcanzable por la fila ACTIVA de
-- `asignaciones_pedido`. De ahí el LEFT JOIN: si no hay asignación activa (o no
-- hay manifiesto), no hay nada que ocultar y el bulto se muestra.
--
-- Idempotente (`create or replace`). No toca datos ni permisos ni la firma.
-- Prueba: supabase/tests/database/rls_aislamiento_preparacion_dia.test.sql
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
    -- clave NULL. Es la excepción que el retiro existe para destapar.
    left join operacion.pedidos p
      on p.id        = b.pedido_id
     and p.tenant_id = b.tenant_id
     and p.tenant_id = p_tenant_id

    -- La asignación VIGENTE del pedido, para llegar al estado de su manifiesto.
    -- `activa` es lo que distingue la asignación válida de las superadas: sin
    -- ese filtro, una reasignación vieja podría esconder un bulto que hoy está
    -- libre.
    left join operacion.asignaciones_pedido ap
      on ap.pedido_id = p.id
     and ap.tenant_id = p.tenant_id
     and ap.activa

    left join operacion.manifiestos m
      on m.id        = ap.manifiesto_id
     and m.tenant_id = ap.tenant_id

    where b.tenant_id       = p_tenant_id
      and s.tenant_id       = p_tenant_id
      and s.fecha_operacion = p_fecha

      -- `p.estado is null` conserva los bultos sin pedido. Sin esa mitad el
      -- LEFT JOIN de arriba quedaría convertido en INNER y los ilegibles
      -- desaparecerían del panel en silencio.
      and (
        p.estado is null
        or (
          -- Fuera lo cerrado y lo que ya salió a la calle.
          p.estado not in (
            'entregado', 'entregado_manual', 'fallido',
            'fallido_manual', 'cancelado', 'devuelto', 'en_ruta'
          )
          -- Y fuera lo que ya está en un manifiesto CERRADO. Sin manifiesto, o
          -- con uno en `borrador`, el trabajo sigue abierto y se muestra.
          and (m.estado is null or m.estado = 'borrador')
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
  'De lo retirado hoy, ¿cuánto FALTA POR DESPACHAR y hacia dónde? Es el insumo
   para decidir cuántos conductores mandar a cada zona.

   Muestra un bulto mientras su trabajo siga abierto: pedido en
   `pendiente_asignacion`, o `asignado` con su manifiesto todavía en `borrador`
   (el coordinador aún puede moverlo), o bulto sin pedido resuelto — la excepción
   que el retiro existe para destapar.

   Deja de mostrarlo cuando su manifiesto se confirma, cuando sale a la calle
   (`en_ruta`) o cuando llega a un estado terminal. El corte es el manifiesto
   CONFIRMADO y no la simple asignación: entre poner un pedido en un manifiesto y
   cerrarlo, el coordinador todavía está repartiendo.

   ⚠️ NO es "cuánto se retiró hoy": esa cifra sale de las visitas y solo crece
   durante el día. Las dos divergen a propósito — cuadrarlas rompe una de las
   dos. Y el respaldo del pago del retiro al conductor es el ACTA de cada visita
   (sesiones_retiro.bultos_total), que esta función no toca.';
