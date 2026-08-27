-- =============================================================================
-- Operación · paradas fijadas por el conductor + geometría de la ruta
-- =============================================================================
-- Alcance: el mapa de ruta de la app del conductor (tablero de diseño B5c).
--
-- DOS COSAS QUE VIAJAN CON LA PARADA, Y POR ESO VIVEN EN `asignaciones_pedido`
-- JUNTO A `orden_ruta`:
--
--   1. `orden_fijado` — el conductor movió esta parada a mano y el motor NO
--      puede volver a moverla.
--   2. `tramo_polilinea` / `tramo_distancia_m` / `tramo_duracion_s` — el tramo
--      que LLEGA a esta parada, por calle.
--
-- Van en la misma tabla que la secuencia a propósito: se escriben y se borran
-- con ella, en el mismo acto. Una tabla aparte obligaría a mantener dos cosas
-- sincronizadas que en realidad son una sola —el orden de las paradas de hoy—
-- y la primera vez que se desincronizaran, el mapa dibujaría una línea que no
-- corresponde al orden que muestra la lista.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ `orden_fijado` NO ES OPCIONAL PARA QUE LA APP SIRVA
-- -----------------------------------------------------------------------------
-- El motor mide en línea recta y a veces propone un salto absurdo (la parada 7
-- al otro lado del Mapocho y la 8 de vuelta: 400 m en recta, 15 min de manejo).
-- El conductor lo corrige con el dedo. **Si el recálculo siguiente se lo
-- deshace, deja de usar la app** — y con razón. Sin persistir la fijación, cada
-- re-optimización borraría la corrección.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ LA GEOMETRÍA SE GUARDA Y NO SE RECALCULA AL PINTAR
-- -----------------------------------------------------------------------------
-- La entrega Google Route Optimization y **se cobra por parada, cada vez**.
-- Recalcular para pintar una pantalla que se abre veinte veces en la tarde
-- multiplicaría la factura por veinte sin ganar nada: la ruta es la misma hasta
-- que alguien la cambia.
--
-- Sin esto, además, hay un descuadre visible hoy: el aviso del cálculo dice
-- «7,8 km por calle» y la tabla, que recalcula en el navegador con haversine,
-- suma 4,2 km. Dos números distintos para la misma ruta, en la misma pantalla.
--
-- `tramo_polilinea` NO es dato personal: es el trazado por la calle entre dos
-- puntos de entrega, y el tramo final hacia el punto de término del conductor
-- **nunca llega hasta acá** — lo descarta el adaptador (canal 3 de
-- docs/seguridad/punto-de-termino-conductor.md).
-- =============================================================================

-- =============================================================================
-- 1. Columnas nuevas
-- =============================================================================
alter table operacion.asignaciones_pedido
  add column if not exists orden_fijado boolean not null default false;

alter table operacion.asignaciones_pedido
  add column if not exists tramo_polilinea text;

alter table operacion.asignaciones_pedido
  add column if not exists tramo_distancia_m integer;

alter table operacion.asignaciones_pedido
  add column if not exists tramo_duracion_s integer;

comment on column operacion.asignaciones_pedido.orden_fijado is
  'El conductor puso esta parada en esta posición a mano y el motor no la mueve
   en las re-optimizaciones siguientes. La escribe SOLO
   operacion.aplicar_secuencia_paradas, junto con orden_ruta, y se apaga con
   ella. La fijación es del DÍA, no del pedido.
   Ver src/modules/operacion/ruteo/paradas-fijas.ts.';

comment on column operacion.asignaciones_pedido.tramo_polilinea is
  'Polilínea codificada (algoritmo de Google) del tramo que LLEGA a esta parada,
   por calle. NULL cuando la ruta la calculó el motor local, que solo sabe de
   líneas rectas y no tiene geometría que guardar.
   NUNCA contiene el tramo hacia el punto de término del conductor.';

comment on column operacion.asignaciones_pedido.tramo_distancia_m is
  'Metros por CALLE del tramo que llega a esta parada. NULL con motor local.
   Manda sobre la distancia en línea recta que calcula el navegador.';

comment on column operacion.asignaciones_pedido.tramo_duracion_s is
  'Segundos de conducción del tramo que llega a esta parada, con el tráfico que
   consideró el proveedor. NULL con motor local, que no tiene noción de tiempo.';

-- Los tres campos de geometría son un paquete: tener la polilínea sin sus
-- métricas (o al revés) no significa nada y delataría una escritura a medias.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'operacion.asignaciones_pedido'::regclass
       and conname  = 'asignaciones_pedido_tramo_completo'
  ) then
    alter table operacion.asignaciones_pedido
      add constraint asignaciones_pedido_tramo_completo
      check (
        (tramo_polilinea is null and tramo_distancia_m is null and tramo_duracion_s is null)
        or (tramo_polilinea is not null and tramo_distancia_m is not null and tramo_duracion_s is not null)
      );
  end if;
end $$;

-- Fijar es fijar una POSICIÓN: sin `orden_ruta` no hay posición que fijar.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'operacion.asignaciones_pedido'::regclass
       and conname  = 'asignaciones_pedido_fijado_exige_orden'
  ) then
    alter table operacion.asignaciones_pedido
      add constraint asignaciones_pedido_fijado_exige_orden
      check (not orden_fijado or orden_ruta is not null);
  end if;
end $$;

-- =============================================================================
-- 2. La escritura sigue siendo ÚNICA: se EXTIENDE el RPC, no se abre otra vía
-- =============================================================================
-- Esta función es una copia fiel de la de `20260814000004` con dos parámetros
-- nuevos, y se conservan sus seis pasos tal cual porque cada uno tapa algo:
--
--   · la validación de NULL y repetidos en `p_pedido_ids`;
--   · el `for update` sobre la fila del MANIFIESTO (serializa a dos
--     coordinadores sin estorbar a otros manifiestos);
--   · el rechazo de `completado`/`cancelado`;
--   · **el apagado de la secuencia en sentencia PROPIA**, que es lo que evita
--     chocar contra el índice único a mitad de la escritura al intercambiar dos
--     paradas;
--   · el conteo de filas escritas contra las enviadas, que convierte un pedido
--     ajeno en un fallo y no en un filtrado silencioso;
--   · la bitácora al final y DENTRO de la transacción, con la secuencia entera.
--
-- ⚠️ `p_fijados` y `p_tramos` se indexan POR POSICIÓN contra `p_pedido_ids`.
-- Posicional y no un jsonb por pedido porque **el orden ES el dato** de esta
-- función: unos tramos desalineados se ven en el mapa de inmediato (la línea no
-- calza con los pines) en vez de esconderse dentro de una clave.
--
-- Los dos llevan DEFAULT null para no romper a los llamadores de cinco
-- argumentos: la web del coordinador sigue funcionando igual, sin fijar nada y
-- sin geometría.
create or replace function operacion.aplicar_secuencia_paradas(
  p_tenant_id        uuid,
  p_manifiesto_id    uuid,
  p_pedido_ids       uuid[],
  p_origen           text,
  p_actor_usuario_id uuid,
  p_fijados          boolean[] default null,
  p_tramos           jsonb     default null
)
returns table (
  total_paradas            integer,
  total_sin_secuencia      integer,
  total_previas_limpiadas  integer
)
language plpgsql
security definer
set search_path = operacion, identidad, public, pg_temp
as $fn$
declare
  v_driver_id  uuid;
  v_fecha      date;
  v_estado     text;
  v_total      integer;
  v_distintos  integer;
  v_limpiadas  integer := 0;
  v_escritas   integer := 0;
  v_sin_sec    integer := 0;
  v_fijadas    integer := 0;
begin
  -- (1) Parámetros.
  if p_tenant_id is null or p_manifiesto_id is null or p_pedido_ids is null then
    raise exception
      'aplicar_secuencia_paradas: p_tenant_id, p_manifiesto_id y p_pedido_ids son obligatorios'
      using errcode = '22023';
  end if;

  if p_origen is null or p_origen not in ('motor', 'manual') then
    raise exception
      'aplicar_secuencia_paradas: p_origen debe ser ''motor'' o ''manual'' (llegó %)',
      coalesce(p_origen, '<null>')
      using errcode = '22023';
  end if;

  v_total := cardinality(p_pedido_ids);

  if exists (select 1 from unnest(p_pedido_ids) as u(pedido_id) where u.pedido_id is null) then
    raise exception
      'aplicar_secuencia_paradas: p_pedido_ids contiene NULL; un identificador perdido corre todas las posiciones siguientes y la secuencia dejaría de ser la que se calculó'
      using errcode = '22023';
  end if;

  select count(distinct u.pedido_id)::integer
    into v_distintos
    from unnest(p_pedido_ids) as u(pedido_id);

  if v_distintos <> v_total then
    raise exception
      'aplicar_secuencia_paradas: p_pedido_ids trae identificadores repetidos (% posiciones, % pedidos distintos)',
      v_total, v_distintos
      using errcode = '22023';
  end if;

  -- ⚠️ NUEVO: un `p_tramos` que no sea un arreglo JSON es un llamador roto, no
  -- un caso previsto. Se rechaza en vez de escribir la ruta sin geometría: una
  -- ruta que se guarda "a medias bien" es peor que una que falla.
  if p_tramos is not null and jsonb_typeof(p_tramos) <> 'array' then
    raise exception
      'aplicar_secuencia_paradas: p_tramos debe ser un arreglo JSON (llegó %)',
      jsonb_typeof(p_tramos)
      using errcode = '22023';
  end if;

  -- (2) El manifiesto es de ESTE courier, y sigue vivo. Cerrojo incluido.
  select m.driver_id, m.fecha_operacion, m.estado::text
    into v_driver_id, v_fecha, v_estado
    from operacion.manifiestos m
   where m.id        = p_manifiesto_id
     and m.tenant_id = p_tenant_id
     for update;

  if not found then
    raise exception
      'aplicar_secuencia_paradas: el manifiesto % no existe en el tenant %',
      p_manifiesto_id, p_tenant_id
      using errcode = 'P0002';
  end if;

  if v_estado in ('completado', 'cancelado') then
    raise exception
      'aplicar_secuencia_paradas: el manifiesto % está % y ya no se rutea',
      p_manifiesto_id, v_estado
      using errcode = '55000';
  end if;

  -- (3) Apagar la secuencia vigente. Es lo que permite cualquier permutación.
  -- Sin este paso, reordenar dos paradas intercambiadas chocaría con el índice
  -- único a MITAD de la sentencia siguiente. Va en sentencia PROPIA a propósito.
  -- ⚠️ NUEVO: se apagan también la fijación y la geometría. Son parte de la
  -- secuencia y sobrevivir a un recálculo las dejaría describiendo un orden que
  -- ya no existe — una línea dibujada entre paradas que cambiaron de sitio.
  update operacion.asignaciones_pedido a
     set orden_ruta        = null,
         orden_fijado      = false,
         tramo_polilinea   = null,
         tramo_distancia_m = null,
         tramo_duracion_s  = null
   where a.tenant_id     = p_tenant_id
     and a.manifiesto_id = p_manifiesto_id
     and a.activa
     and (a.orden_ruta is not null or a.orden_fijado or a.tramo_polilinea is not null);

  get diagnostics v_limpiadas = row_count;

  -- (4) Escribir la secuencia nueva. La posición en el arreglo ES el orden.
  if v_total > 0 then
    update operacion.asignaciones_pedido a
       set orden_ruta        = s.orden,
           orden_fijado      = s.fijado,
           tramo_polilinea   = s.polilinea,
           tramo_distancia_m = s.distancia_m,
           tramo_duracion_s  = s.duracion_s
      from (
        select u.pedido_id,
               u.orden::integer as orden,
               coalesce(p_fijados[u.orden::integer], false) as fijado,
               nullif(t.tramo ->> 'polilinea', '') as polilinea,
               -- Las métricas solo entran si hay polilínea: es el CHECK
               -- `asignaciones_pedido_tramo_completo` dicho en SQL, para que un
               -- tramo a medias falle acá y no en la constraint.
               case when nullif(t.tramo ->> 'polilinea', '') is null then null
                    else (t.tramo ->> 'distanciaM')::integer end as distancia_m,
               case when nullif(t.tramo ->> 'polilinea', '') is null then null
                    else (t.tramo ->> 'duracionS')::integer end as duracion_s
          from unnest(p_pedido_ids) with ordinality as u(pedido_id, orden)
          left join lateral (
            select case when p_tramos is null then null::jsonb
                        else p_tramos -> (u.orden::integer - 1) end as tramo
          ) t on true
      ) s
     where a.tenant_id     = p_tenant_id
       and a.manifiesto_id = p_manifiesto_id
       and a.activa
       and a.pedido_id     = s.pedido_id;

    get diagnostics v_escritas = row_count;

    if v_escritas <> v_total then
      raise exception
        'aplicar_secuencia_paradas: la secuencia no corresponde al manifiesto % (% posiciones enviadas, % paradas activas alcanzadas). Hay un pedido que no está en este manifiesto, o la asignación cambió mientras se ordenaba',
        p_manifiesto_id, v_total, v_escritas
        using errcode = 'P0001';
    end if;
  end if;

  -- (5) Cuántas paradas vivas quedaron SIN secuencia.
  select count(*)::integer
    into v_sin_sec
    from operacion.asignaciones_pedido a
   where a.tenant_id     = p_tenant_id
     and a.manifiesto_id = p_manifiesto_id
     and a.activa
     and a.orden_ruta is null;

  select count(*)::integer
    into v_fijadas
    from unnest(coalesce(p_fijados, array[]::boolean[])) as f(v)
   where f.v;

  -- (6) Bitácora — DENTRO de la transacción, y al final.
  -- Se aparta del patrón "bitácora ANTES del efecto" porque aquí el efecto es
  -- puramente transaccional: si algo falla se deshace TODO, y un asiento que
  -- describa una ruta que no se aplicó contaminaría la única evidencia que hay.
  -- La atomicidad da una garantía MÁS FUERTE que el orden.
  --
  -- La lista de pedidos SÍ viaja: la secuencia anterior la destruye la
  -- escritura siguiente, así que sin esto "en qué orden iba el conductor cuando
  -- se cayó la entrega" sería irrecuperable. No hay un solo dato personal ahí.
  -- La geometría NO viaja: es un asiento de auditoría, no un respaldo de la ruta.
  insert into identidad.bitacora_auditoria
    (tenant_id, actor_usuario_id, actor_tipo, accion, entidad_tipo, entidad_id, detalle)
  values (
    p_tenant_id,
    p_actor_usuario_id,
    case when p_actor_usuario_id is null then 'sistema' else 'usuario' end::identidad.actor_tipo_auditoria,
    'manifiesto.secuencia_paradas_aplicada',
    'manifiesto',
    p_manifiesto_id,
    jsonb_build_object(
      'origen',                     p_origen,
      'driver_id',                  v_driver_id,
      'fecha_operacion',            v_fecha,
      'estado_manifiesto',          v_estado,
      'total_paradas',              v_escritas,
      'total_sin_secuencia',        v_sin_sec,
      'total_previas_limpiadas',    v_limpiadas,
      'total_fijadas',              v_fijadas,
      'con_geometria',              (p_tramos is not null),
      'secuencia',                  to_jsonb(p_pedido_ids)
    )
  );

  return query select v_escritas, v_sin_sec, v_limpiadas;
end;
$fn$;

-- ⚠️ El GRANT se repone porque `create or replace` con FIRMA NUEVA crea una
-- función DISTINTA, que nace con EXECUTE para PUBLIC. La firma vieja de cinco
-- argumentos sigue existiendo aparte y se retira: dejarla viva permitiría
-- llamar a la versión sin fijación sin que nadie lo note.
-- Ver: memoria «create or replace no resetea la ACL».
revoke all on function operacion.aplicar_secuencia_paradas(uuid, uuid, uuid[], text, uuid, boolean[], jsonb) from public;
grant execute on function operacion.aplicar_secuencia_paradas(uuid, uuid, uuid[], text, uuid, boolean[], jsonb) to service_role;

drop function if exists operacion.aplicar_secuencia_paradas(uuid, uuid, uuid[], text, uuid);
