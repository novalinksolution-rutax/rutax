-- =============================================================================
-- Etapa 9 · Traspaso de pedidos entre conductores
--
-- LA ESCENA REAL: son las 18:30, Juan tiene 8 paquetes que no va a alcanzar a
-- entregar y se los pasa a Pedro en la calle. Pedro abre su app, escanea los 8,
-- y quedan suyos. En Flex esto ya funciona así de suelto —re-escanear un bulto
-- ajeno lo mueve solo, sin pedir permiso— y el diseño de Rutax calza con eso a
-- propósito: el traspaso es LIBRE, sin aprobación, y el autor es quien escanea.
--
-- =============================================================================
-- POR QUÉ HACE FALTA UNA FUNCIÓN PROPIA (los dos caminos existentes no sirven)
-- =============================================================================
-- · `asignarPedidosAManifiesto` (manifiestos.ts:144) exige manifiesto en
--   `borrador`. A las 18:30 el de Pedro está `en_ruta`. Rechaza.
-- · `asignar_pedidos_en_bloque` (20260814000001) SÍ acepta un manifiesto
--   `confirmado`/`en_ruta` — pero rechaza todo pedido que no esté
--   `pendiente_asignacion`/`asignado` (:345), y el bulto que Juan pasa está
--   `en_ruta`. Su propia cabecera lo dice: «el traspaso ENTRE CONDUCTORES con el
--   bulto ya en la calle es otra cosa —mueve a quién se le paga— y tiene camino
--   propio; esta función NO lo implementa» (:110-114).
--
-- Esta es esa función. Es su HERMANA: mismo cerrojo, mismo find-or-create de
-- manifiesto, misma forma de retorno. Lo que cambia es la reja.
--
-- =============================================================================
-- LA REJA, INVERTIDA — y el requisito que la define
-- =============================================================================
-- Un traspaso EXIGE que el pedido ya esté asignado a OTRO conductor. Esa es la
-- diferencia con una asignación, y no es un detalle de validación: es lo que
-- hace que la operación signifique "cambiar a quién se le paga" en vez de
-- "repartir trabajo". Un pedido sin asignación activa NO se traspasa — no hay de
-- quién recibirlo — y se omite con motivo propio en vez de asignarse por la
-- puerta de atrás.
--
--   acepta:  estado in ('asignado', 'en_ruta')  +  asignación activa de OTRO
--   omite:   sin_asignacion · ya_mio · estado_no_traspasable · ajeno
--
-- =============================================================================
-- EL ESTADO DEL PEDIDO NO SE TOCA, Y ES DELIBERADO
-- =============================================================================
-- El bulto sigue exactamente donde estaba: en la calle, camino a su
-- destinatario. Lo único que cambió es en manos de quién. Mover el estado hacia
-- atrás (`en_ruta` → `asignado`) mentiría sobre el mundo físico, y además la
-- máquina de estados no tiene esa transición (`maquina-estados.ts:85-106`) — con
-- razón.
--
-- =============================================================================
-- EL DINERO SE ACOMODA SOLO. NO HAY QUE CONSTRUIRLO, HAY QUE NO ROMPERLO
-- =============================================================================
-- · El evento financiero lee `pedidos.driver_id_asignado` (pedidos.ts:319), que
--   mantiene el trigger de `asignaciones_pedido`. Si el traspaso ocurre ANTES de
--   la entrega, la línea de liquidación NACE a nombre de Pedro. No hay nada que
--   reatribuir.
-- · Si ya existía línea (p. ej. un `fallido` previo), `decidirReatribucion-
--   Liquidacion` la mueve si la liquidación sigue en borrador, o levanta
--   excepción bloqueante si ya se emitió. Ya construido y probado.
-- · **Juan conserva el pago de su RETIRO**, y eso lo impone el ESQUEMA, no este
--   código: la línea de retiro cuelga de `sesion_retiro_id`, no de ningún
--   pedido (etapa 8, 20260815000004). Esta función no puede tocarla ni
--   queriendo.
--
-- =============================================================================
-- ⚠️ LA BITÁCORA VA DENTRO DE LA TRANSACCIÓN, NO ANTES — Y ME APARTO DEL PLAN
-- =============================================================================
-- El plan de la etapa pide bitácora ANTES del efecto por ser acción financiera.
-- Acá se hace como su hermana (20260814000001:475-483) y por la misma razón:
-- esa regla de CLAUDE.md existe porque un evento Inngest o una llamada externa
-- NO SE PUEDEN DESHACER, así que hay que dejar rastro antes de disparar. Acá el
-- efecto es puramente transaccional y no hay ninguna llamada externa: si algo
-- falla, el rollback se lleva el UPDATE, el INSERT y el asiento juntos. La
-- atomicidad da una garantía MÁS FUERTE que el orden — no puede existir un
-- traspaso sin su asiento, ni un asiento sin su traspaso. Escribirlo antes desde
-- TypeScript sí abriría el hueco de un asiento fantasma.
-- El `actorUsuarioId` (RNF-04, el "quién") va igual: es parámetro obligatorio.
--
-- =============================================================================
-- EL HUECO EN LA SECUENCIA DE RUTA DEL ORIGEN: SE ACEPTA, Y NO ES DEUDA
-- =============================================================================
-- La asignación nueva nace con `orden_ruta` NULL ("sin rutear en su nuevo
-- manifiesto"), que es correcto. En el manifiesto de Juan queda un hueco:
-- 1, 2, 4, 5. No se renumera a propósito — `orden_ruta` define un ORDEN, no una
-- posición, y `ordenarParadasConSecuencia` ordena por ese valor: 1,2,4,5 se lee
-- idéntico a 1,2,3,4. Renumerar exigiría re-tomar el manifiesto del origen con
-- `for update` en medio de su reparto, a cambio de nada visible.
--
-- IDEMPOTENTE Y NO DESTRUCTIVA: `create or replace function`.
-- Prueba de aislamiento: supabase/tests/database/rls_aislamiento_traspaso.test.sql
-- =============================================================================

create or replace function operacion.traspasar_pedidos_a_conductor(
  p_tenant_id            uuid,
  p_conductor_receptor   uuid,
  p_fecha                date,
  p_pedido_ids           uuid[],
  p_actor_usuario_id     uuid
)
returns table (
  manifiesto_id                uuid,
  manifiesto_creado            boolean,
  total_solicitados            integer,
  total_traspasados            integer,
  total_omitidos               integer,
  omitidos_sin_asignacion      integer,
  omitidos_ya_mio              integer,
  omitidos_estado_no_traspasable integer,
  omitidos_ajenos              integer,
  omitidos_detalle             jsonb,
  conductores_origen           jsonb
)
language plpgsql
security definer
set search_path = operacion, identidad, pg_temp
as $fn$
declare
  v_ids                uuid[];
  v_conductor_nombre   text;
  v_manifiesto_id      uuid;
  v_manifiesto_creado  boolean := false;

  v_traspasar          uuid[];

  v_om_sin_asig        integer;
  v_om_ya_mio          integer;
  v_om_estado          integer;
  v_om_ajenos          integer;
  v_om_total           integer;
  v_omitidos_detalle   jsonb;
  v_origenes           jsonb;

  v_desactivados       integer;
  v_insertados         integer;
begin
  -- ---------------------------------------------------------------------------
  -- (0) Parámetros
  -- ---------------------------------------------------------------------------
  if p_tenant_id is null or p_conductor_receptor is null or p_fecha is null then
    raise exception
      'traspasar_pedidos_a_conductor: p_tenant_id, p_conductor_receptor y p_fecha son obligatorios'
      using errcode = '22023';
  end if;

  -- `distinct`: un id repetido intentaría insertar DOS asignaciones activas del
  -- mismo pedido y chocaría con el unique parcial, tumbando el lote entero. En
  -- esta función el riesgo es MAYOR que en su hermana: el lote viene de un
  -- escáner, y escanear dos veces el mismo bulto es lo normal, no la excepción.
  select coalesce(array_agg(distinct u.pedido_id), '{}'::uuid[])
    into v_ids
    from unnest(p_pedido_ids) as u(pedido_id)
   where u.pedido_id is not null;

  if cardinality(v_ids) = 0 then
    raise exception
      'traspasar_pedidos_a_conductor: p_pedido_ids llegó vacío (o solo con nulos)'
      using errcode = '22023';
  end if;

  -- ---------------------------------------------------------------------------
  -- (1) El receptor tiene que ser de ESTE courier.
  --     P0002 tanto si no existe como si es de otro tenant: indistinguibles a
  --     propósito, para no confirmar la existencia de datos ajenos.
  -- ---------------------------------------------------------------------------
  select c.nombre_completo
    into v_conductor_nombre
    from identidad.conductores c
   where c.id        = p_conductor_receptor
     and c.tenant_id = p_tenant_id;

  if not found then
    raise exception
      'traspasar_pedidos_a_conductor: el conductor % no existe en el tenant %',
      p_conductor_receptor, p_tenant_id
      using errcode = 'P0002';
  end if;

  -- ---------------------------------------------------------------------------
  -- (2) Cerrojo del cupo (tenant, receptor, fecha).
  --     El MISMO texto de llave que usa `asignar_pedidos_en_bloque`, y eso es
  --     deliberado: las dos funciones pueden crear el manifiesto del día de ese
  --     conductor, así que tienen que serializarse ENTRE SÍ. Una llave distinta
  --     las dejaría correr en paralelo y crear dos manifiestos.
  -- ---------------------------------------------------------------------------
  perform pg_advisory_xact_lock(
    hashtextextended(
      'operacion.asignar_pedidos_en_bloque:' ||
      p_tenant_id::text || ':' || p_conductor_receptor::text || ':' || p_fecha::text,
      0
    )
  );

  -- ---------------------------------------------------------------------------
  -- (3) Bloqueo de los pedidos candidatos, EN ORDEN DE id (evita deadlocks).
  -- ---------------------------------------------------------------------------
  perform 1
     from operacion.pedidos p
    where p.tenant_id = p_tenant_id
      and p.id = any(v_ids)
    order by p.id
      for update;

  -- ---------------------------------------------------------------------------
  -- (4) Manifiesto del receptor: reutilizar el vivo del día, o crearlo.
  --     Idéntico a su hermana, incluido el `creado_en desc` — el mismo criterio
  --     que usan las dos pantallas del conductor para decidir cuál es "el
  --     manifiesto de hoy".
  -- ---------------------------------------------------------------------------
  select m.id
    into v_manifiesto_id
    from operacion.manifiestos m
   where m.tenant_id       = p_tenant_id
     and m.driver_id       = p_conductor_receptor
     and m.fecha_operacion = p_fecha
     and m.estado in ('borrador', 'confirmado', 'en_ruta')
   order by m.creado_en desc, m.id desc
   limit 1
     for update;

  if v_manifiesto_id is null then
    insert into operacion.manifiestos
      (tenant_id, driver_id, nombre, fecha_operacion, estado, creado_por_usuario_id)
    values
      (p_tenant_id,
       p_conductor_receptor,
       'Reparto ' || to_char(p_fecha, 'DD-MM-YYYY') || ' — ' || v_conductor_nombre,
       p_fecha,
       'borrador',
       p_actor_usuario_id)
    returning operacion.manifiestos.id into v_manifiesto_id;

    v_manifiesto_creado := true;
  end if;

  -- ---------------------------------------------------------------------------
  -- (5) Clasificación. LA REJA INVERTIDA vive acá.
  -- ---------------------------------------------------------------------------
  -- El `tenant_id` explícito en los dos LEFT JOIN no sobra aunque las FK ya lo
  -- garanticen: bajo SECURITY DEFINER no hay RLS debajo y este texto es la única
  -- barrera.
  --
  -- Orden de los `when`: primero lo que no existe, después lo que no se puede
  -- traspasar por estado, después lo que no tiene de quién venir, y al final lo
  -- que ya es mío. `ya_mio` va último a propósito — es el caso más benigno (un
  -- re-escaneo) y debe reportarse como tal, no confundirse con un rechazo.
  with candidatos as (
    select distinct u.pedido_id
      from unnest(v_ids) as u(pedido_id)
  ),
  clasificado as (
    select
      c.pedido_id,
      a.driver_id as driver_origen,
      case
        when p.id is null                                  then 'ajeno'
        when p.estado not in ('asignado', 'en_ruta')       then 'estado_no_traspasable'
        when a.id is null                                  then 'sin_asignacion'
        when a.driver_id = p_conductor_receptor            then 'ya_mio'
        else                                                    'traspasar'
      end as motivo
    from candidatos c
    left join operacion.pedidos p
      on p.id        = c.pedido_id
     and p.tenant_id = p_tenant_id
    left join operacion.asignaciones_pedido a
      on a.pedido_id = p.id
     and a.tenant_id = p_tenant_id
     and a.activa
  )
  select
    coalesce(array_agg(cl.pedido_id) filter (where cl.motivo = 'traspasar'), '{}'::uuid[]),
    count(*) filter (where cl.motivo = 'sin_asignacion')::integer,
    count(*) filter (where cl.motivo = 'ya_mio')::integer,
    count(*) filter (where cl.motivo = 'estado_no_traspasable')::integer,
    count(*) filter (where cl.motivo = 'ajeno')::integer,
    coalesce(
      jsonb_object_agg(cl.pedido_id::text, cl.motivo)
        filter (where cl.motivo <> 'traspasar'),
      '{}'::jsonb
    ),
    -- De quién viene cada uno. Se devuelve para que la app pueda decir "recibiste
    -- 8 de Juan" en vez de un número pelado, y para que el asiento de bitácora
    -- registre el origen — sin eso, la auditoría diría que Pedro recibió 8
    -- paquetes de la nada.
    coalesce(
      jsonb_object_agg(cl.pedido_id::text, cl.driver_origen)
        filter (where cl.motivo = 'traspasar'),
      '{}'::jsonb
    )
  into v_traspasar, v_om_sin_asig, v_om_ya_mio, v_om_estado, v_om_ajenos,
       v_omitidos_detalle, v_origenes
  from clasificado cl;

  v_om_total := v_om_sin_asig + v_om_ya_mio + v_om_estado + v_om_ajenos;

  -- ---------------------------------------------------------------------------
  -- (6) Apagar la asignación de origen, y solo la de los que sí se traspasan.
  -- ---------------------------------------------------------------------------
  v_desactivados := 0;
  v_insertados   := 0;

  if cardinality(v_traspasar) > 0 then
    update operacion.asignaciones_pedido a
       set activa         = false,
           desasignado_en = now()
     where a.tenant_id = p_tenant_id
       and a.activa
       and a.pedido_id = any(v_traspasar);

    get diagnostics v_desactivados = row_count;

    -- Aserción: cada pedido clasificado como 'traspasar' TENÍA asignación activa
    -- (lo garantiza el `when a.id is null then 'sin_asignacion'`). Si los números
    -- no cuadran, algo cambió bajo nuestros pies pese al `for update` y es
    -- preferible reventar que dejar dos asignaciones activas del mismo pedido.
    if v_desactivados <> cardinality(v_traspasar) then
      raise exception
        'traspasar_pedidos_a_conductor: se esperaba desactivar % asignaciones y se desactivaron %',
        cardinality(v_traspasar), v_desactivados
        using errcode = 'P0001';
    end if;

    -- `orden_ruta` NO se copia: la parada nace SIN rutear en su manifiesto nuevo.
    -- Heredar la posición del manifiesto de Juan pondría a Pedro una parada
    -- número 7 que no tiene relación con su propio recorrido.
    insert into operacion.asignaciones_pedido
      (tenant_id, pedido_id, manifiesto_id, driver_id, seller_id,
       activa, asignado_por_usuario_id, asignado_en)
    select
      p_tenant_id, p.id, v_manifiesto_id, p_conductor_receptor, p.seller_id,
      true, p_actor_usuario_id, now()
    from operacion.pedidos p
    where p.tenant_id = p_tenant_id
      and p.id = any(v_traspasar);

    get diagnostics v_insertados = row_count;
  end if;

  -- ---------------------------------------------------------------------------
  -- (7) Bitácora — dentro de la transacción (ver la cabecera).
  -- ---------------------------------------------------------------------------
  if v_insertados > 0 then
    insert into identidad.bitacora_auditoria
      (tenant_id, actor_usuario_id, actor_tipo, accion, entidad_tipo, entidad_id, detalle)
    values (
      p_tenant_id,
      p_actor_usuario_id,
      'usuario',
      'manifiesto.pedidos_traspasados',
      'manifiesto',
      v_manifiesto_id,
      jsonb_build_object(
        'conductor_receptor',  p_conductor_receptor,
        'fecha_operacion',     p_fecha,
        'total_solicitados',   cardinality(v_ids),
        'total_traspasados',   v_insertados,
        'total_omitidos',      v_om_total,
        -- El origen SÍ va con detalle por pedido: es una acción que mueve a
        -- quién se le paga, y "de quién" es la mitad de la pregunta que la
        -- auditoría tiene que poder responder.
        'origenes',            v_origenes,
        'manifiesto_creado',   v_manifiesto_creado
      )
    );
  end if;

  return query
  select
    v_manifiesto_id,
    v_manifiesto_creado,
    cardinality(v_ids)::integer,
    v_insertados,
    v_om_total,
    v_om_sin_asig,
    v_om_ya_mio,
    v_om_estado,
    v_om_ajenos,
    v_omitidos_detalle,
    v_origenes;
end;
$fn$;

comment on function operacion.traspasar_pedidos_a_conductor(uuid, uuid, date, uuid[], uuid) is
  'Traspasa pedidos YA ASIGNADOS a otro conductor, con el bulto en la calle
   (etapa 9). Hermana de asignar_pedidos_en_bloque con la reja INVERTIDA: exige
   estado asignado/en_ruta y asignación activa de OTRO conductor. NO toca el
   estado del pedido — el bulto no se movió, solo cambió de manos. El dinero se
   acomoda solo vía el trigger de driver_id_asignado; el pago del RETIRO del
   conductor de origen es intocable por construcción (cuelga de la visita, no
   del pedido).';

-- Solo `service_role`: el endpoint Bearer del conductor la llama con ese rol,
-- igual que todo el resto de la superficie de la app. Un `authenticated` no
-- puede invocarla ni conociendo la firma.
revoke all on function operacion.traspasar_pedidos_a_conductor(uuid, uuid, date, uuid[], uuid) from public;
revoke all on function operacion.traspasar_pedidos_a_conductor(uuid, uuid, date, uuid[], uuid) from authenticated;
grant execute on function operacion.traspasar_pedidos_a_conductor(uuid, uuid, date, uuid[], uuid) to service_role;
