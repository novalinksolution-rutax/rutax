-- =============================================================================
-- Operación · etapa 6 — asignación EN BLOQUE, en UNA transacción
-- =============================================================================
-- CONTEXTO: docs/arquitectura/retiro-y-ruteo.md §4 ("la asignación no es
-- clustering automático: el coordinador filtra, selecciona 30 y los asigna en
-- bloque"; "el manifiesto pasa a ser SUBPRODUCTO de la asignación, no paso
-- previo") y §2.2 (la asignación tiene que estar TERMINADA a las 16:00).
-- Plan: docs/arquitectura/retiro-y-ruteo-plan.md, etapa 6.
-- Predecesoras: 20260601000005 (pedidos, manifiestos, asignaciones_pedido y sus
-- tres triggers), 20260812000002 (situacion_retiro — la reja), 20260813000004
-- (las dos funciones que llevan un pedido a `retirado`).
--
-- =============================================================================
-- POR QUÉ ESTO ES UNA FUNCIÓN SQL Y NO SE QUEDA EN TypeScript
-- =============================================================================
-- El camino actual (src/modules/operacion/manifiestos.ts:204-263) recorre un
-- BUCLE SECUENCIAL con hasta 3 escrituras `await`adas por pedido, y supabase-js
-- NO tiene transacciones: cada escritura es su propio commit. A 400 pedidos/día
-- y lotes de 30 eso significa que, si el pedido 200 falla, LOS 199 ANTERIORES
-- QUEDAN APLICADOS y no hay forma de deshacerlos. Peor: la bitácora se escribe
-- DESPUÉS del bucle, así que esa asignación partida a la mitad no deja ni un
-- asiento de auditoría — el "quién tocó qué" desaparece justo en el caso en que
-- hace falta.
--
-- Una función es UNA transacción: o se aplican todos o no se aplica ninguno.
-- Mismo argumento y mismo molde que operacion.cerrar_sesion_retiro
-- (20260813000004 §6), operacion.pruebas_entrega_del_seller (20260613000009) e
-- infra.rate_limit (20260612000001).
--
-- BENEFICIO COLATERAL QUE CONVIENE ENTENDER: los identificadores viajan como
-- `uuid[]` en el CUERPO del POST del RPC, no en la query string. Eso mata de
-- raíz el `URI too long` del `.in()` sin lotear —que este repo ya sufrió con mil
-- UUID (CLAUDE.md §Comandos)— sin necesidad de trocear nada del lado del cliente.
--
-- =============================================================================
-- EL TENANT VA POR PARÁMETRO, NUNCA POR CLAIM
-- =============================================================================
-- SECURITY DEFINER: corre como el dueño (postgres, BYPASSRLS), así que la RLS de
-- pedidos / manifiestos / asignaciones_pedido NO la filtra. El aislamiento lo
-- impone `p_tenant_id`, que el llamador ya resolvió contra la sesión. Mismo
-- contrato que operacion.preparacion_visitas_del_dia (20260813000006) e
-- identidad.resolver_zona (20260613000004).
--
-- ⚠️ CONSECUENCIA QUE OBLIGA A ESCRIBIR EL SQL CON DISCIPLINA: como no hay RLS
-- debajo, CADA lectura y CADA escritura lleva su propio `tenant_id` en el WHERE,
-- aunque la FK compuesta ya lo garantice. Si mañana una FK se afloja al
-- refactorizar, la única barrera que queda es el texto de esta función.
--
-- EXECUTE revocado a public/anon/authenticated y concedido solo a service_role:
-- si un rol de cliente pudiera llamarla, le bastaría pasar el uuid de otro
-- courier para reasignarle la operación del día.
--
-- Idempotente (create or replace + revoke/grant reejecutables), no destructiva
-- (no toca ninguna tabla ni ningún dato) y con aserciones defensivas al final.
-- Prueba: supabase/tests/database/rls_aislamiento_asignacion_en_bloque.test.sql
-- =============================================================================


-- =============================================================================
-- 1. operacion.asignar_pedidos_en_bloque
-- =============================================================================
-- Los nombres de salida NO chocan con ninguna columna referenciada en el cuerpo
-- (en plpgsql los parámetros de un `returns table` son variables en ámbito y
-- `variable_conflict = error` aborta si una consulta las vuelve ambiguas). Por
-- eso, además, TODA referencia a columna va calificada con su alias.
--
-- -----------------------------------------------------------------------------
-- LAS REJAS, EN ORDEN DE PRECEDENCIA — y por qué ese orden
-- -----------------------------------------------------------------------------
-- Cada identificador recibido cae en EXACTAMENTE UN cubo, y la suma de los cubos
-- es siempre el total de identificadores distintos recibidos (hay una aserción
-- que lo comprueba en caliente). El orden importa porque un pedido puede fallar
-- dos rejas a la vez y hay que decirle al coordinador la que le sirve para
-- actuar:
--
--   1. `ajeno`                — no existe, o es de otro courier. Se OMITE, nunca
--                               se lanza: un error distinto para "existe pero es
--                               de otro tenant" confirmaría la existencia del
--                               pedido ajeno, que es exactamente lo que el
--                               aislamiento no puede permitir. Los dos casos son
--                               deliberadamente indistinguibles desde afuera.
--   2. `no_retirado`          — LA REJA DE ESTA ETAPA. Solo se asigna lo que
--                               alguien escaneó en una bodega y está físicamente
--                               en poder del courier. Un seller despacha con
--                               VARIOS couriers: la ingesta de ML trae
--                               CANDIDATOS, y asignar un candidato ajeno termina
--                               en un cobro con DTE por una entrega que hizo
--                               otro (20260812000002, "es una reja de dinero, no
--                               un flag de conveniencia"). Va antes que la reja
--                               de estado porque es la accionable: el
--                               coordinador puede ir a buscar el bulto.
--   3. `estado_no_asignable`  — el pedido ya salió de la bandeja: en_ruta,
--                               entregado, fallido, cancelado, devuelto. Se
--                               admiten solo `pendiente_asignacion` y `asignado`.
--   4. `ya_en_manifiesto`     — ya está activo en ESTE mismo manifiesto. No es
--                               error: es la idempotencia del reenvío.
--
-- LO QUE DELIBERADAMENTE NO ES REJA (y no es olvido):
--   · `fecha_compromiso` vs `p_fecha`. La fecha que ML manda en un pedido Flex
--     puede caer días después; lo que decide qué se reparte hoy es lo que está en
--     el piso de la bodega, no una promesa de la fuente. Agregar ese filtro haría
--     desaparecer bultos reales de la bandeja sin un solo error.
--   · `conductores.estado` y `conductores.disponible`. Quién trabaja hoy es
--     política de dotación y se resuelve en la pantalla; convertirlo en reja dura
--     aquí haría fallar el traspaso de emergencia (alcance §5) justo cuando un
--     conductor se cae a media tarde. Lo que SÍ se verifica es que el conductor
--     sea del tenant.
--   · El estado del manifiesto de ORIGEN en una reasignación. La reja que
--     importa es el `estado` del PEDIDO: si ya va `en_ruta` no se mueve, y si
--     sigue `asignado` (manifiesto confirmado pero sin salir) reordenar la flota
--     antes de las 16:00 es exactamente lo que el coordinador tiene que poder
--     hacer. Ojo: el traspaso ENTRE CONDUCTORES con el bulto ya en la calle es
--     otra cosa —mueve a quién se le paga— y tiene camino propio (etapa 8); esta
--     función NO lo implementa.
create or replace function operacion.asignar_pedidos_en_bloque(
  p_tenant_id        uuid,
  p_conductor_id     uuid,
  p_fecha            date,
  p_pedido_ids       uuid[],
  p_actor_usuario_id uuid
)
returns table (
  manifiesto_id                  uuid,
  manifiesto_creado              boolean,
  total_solicitados              integer,
  total_asignados                integer,
  total_reasignados              integer,
  total_omitidos                 integer,
  omitidos_no_retirado           integer,
  omitidos_estado_no_asignable   integer,
  omitidos_ya_en_manifiesto      integer,
  omitidos_ajenos                integer,
  omitidos_detalle               jsonb
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

  v_asignar            uuid[];
  v_reasignar          uuid[];
  v_a_escribir         uuid[];

  v_om_no_retirado     integer;
  v_om_estado          integer;
  v_om_ya              integer;
  v_om_ajenos          integer;
  v_om_total           integer;
  v_omitidos_detalle   jsonb;

  v_desactivados       integer;
  v_insertados         integer;
begin
  -- ---------------------------------------------------------------------------
  -- (0) Parámetros. 22023 = invalid_parameter_value.
  -- ---------------------------------------------------------------------------
  if p_tenant_id is null or p_conductor_id is null or p_fecha is null then
    raise exception
      'asignar_pedidos_en_bloque: p_tenant_id, p_conductor_id y p_fecha son obligatorios'
      using errcode = '22023';
  end if;

  -- Identificadores distintos y sin nulos. El `distinct` no es cosmético: un id
  -- repetido en el arreglo intentaría insertar DOS asignaciones activas para el
  -- mismo pedido y chocaría con el unique parcial, tumbando el lote entero por un
  -- doble clic de la interfaz.
  select coalesce(array_agg(distinct u.pedido_id), '{}'::uuid[])
    into v_ids
    from unnest(p_pedido_ids) as u(pedido_id)
   where u.pedido_id is not null;

  -- Lote vacío: se LANZA, no se devuelve "0 de 0". La pantalla no deja seleccionar
  -- cero pedidos, así que un lote vacío es un defecto del llamador (identificadores
  -- perdidos al serializar, filtro que se comió la selección). Devolver ceros en
  -- silencio haría que el coordinador leyera "no seleccionaste nada" cuando en
  -- realidad seleccionó 30 y se perdieron por el camino. Y evita el efecto
  -- colateral peor: crear un manifiesto vacío como subproducto de una llamada que
  -- no asigna nada.
  if cardinality(v_ids) = 0 then
    raise exception
      'asignar_pedidos_en_bloque: p_pedido_ids llegó vacío (o solo con nulos); no se asigna nada y no se crea manifiesto'
      using errcode = '22023';
  end if;

  -- ---------------------------------------------------------------------------
  -- (1) El conductor tiene que ser de ESTE courier.
  -- ---------------------------------------------------------------------------
  -- P0002 (no_data_found) tanto si no existe como si es de otro tenant: son
  -- deliberadamente indistinguibles, por lo mismo que los pedidos ajenos se
  -- omiten en vez de lanzar. La FK compuesta manifiestos_driver_pertenece_al_tenant
  -- también lo atajaría, pero con un 23503 críptico y solo al crear el manifiesto.
  select c.nombre_completo
    into v_conductor_nombre
    from identidad.conductores c
   where c.id        = p_conductor_id
     and c.tenant_id = p_tenant_id;

  if not found then
    raise exception
      'asignar_pedidos_en_bloque: el conductor % no existe en el tenant %',
      p_conductor_id, p_tenant_id
      using errcode = 'P0002';
  end if;

  -- ---------------------------------------------------------------------------
  -- (2) Cerrojo del cupo (tenant, conductor, fecha) — antes de mirar nada.
  -- ---------------------------------------------------------------------------
  -- Sin esto, dos lotes simultáneos para el MISMO conductor y día en los que
  -- todavía no existe un borrador crearían DOS manifiestos y partirían la ruta en
  -- dos. Un `for update` no sirve para ese caso: no hay fila que bloquear. El
  -- cerrojo consultivo es de transacción (se suelta solo al hacer commit o
  -- rollback) y solo serializa el cupo exacto: dos coordinadores repartiendo a
  -- conductores distintos no se estorban.
  --
  -- ⚠️ NO se resuelve con un UNIQUE (tenant_id, driver_id, fecha_operacion): esa
  -- constraint NO existe hoy y NO debe crearse — la función necesita poder abrir
  -- un SEGUNDO manifiesto del día cuando el primero ya está confirmado (ver (4)).
  perform pg_advisory_xact_lock(
    hashtextextended(
      'operacion.asignar_pedidos_en_bloque:' ||
      p_tenant_id::text || ':' || p_conductor_id::text || ':' || p_fecha::text,
      0
    )
  );

  -- ---------------------------------------------------------------------------
  -- (3) Bloqueo de los pedidos candidatos, EN ORDEN DE id.
  -- ---------------------------------------------------------------------------
  -- Dos coordinadores que seleccionan el mismo pedido para conductores distintos
  -- son la carrera real de esta pantalla (§2.2: se reparte por lotes parciales
  -- toda la mañana). Sin bloqueo, el segundo INSERT choca con el unique parcial
  -- `idx_asignaciones_pedido_activa_uk` y un 23505 tumba SUS 30 asignaciones por
  -- culpa de 1. Con el bloqueo, el segundo espera, re-lee el estado ya
  -- actualizado y clasifica ese pedido como REASIGNACIÓN, que es lo que de verdad
  -- ocurrió.
  --
  -- `order by p.id` da un orden de bloqueo determinista: dos lotes con pedidos en
  -- común pero enviados en distinto orden no se abrazan en un deadlock.
  perform 1
     from operacion.pedidos p
    where p.tenant_id = p_tenant_id
      and p.id = any(v_ids)
    order by p.id
      for update;

  -- ---------------------------------------------------------------------------
  -- (4) El manifiesto: SUBPRODUCTO de la asignación, no paso previo.
  -- ---------------------------------------------------------------------------
  -- SE REUTILIZA EL MANIFIESTO DEL DÍA SI SIGUE VIVO — `borrador`, `confirmado`
  -- O `en_ruta`. Solo se crea uno nuevo si no hay ninguno, o si el único que hay
  -- ya está `completado` o `cancelado` (ahí sí es una segunda vuelta genuina y
  -- separarlas es correcto).
  --
  -- ⚠️ ESTA REGLA REEMPLAZA A "solo se reutiliza el borrador", que era la primera
  -- versión de esta migración. El motivo de la vuelta atrás es concreto y está
  -- verificado en el código de producción, no es una preferencia de diseño:
  --
  --   `src/app/api/conductor/manifiesto/route.ts:37-45` (el endpoint Bearer que
  --   alimenta la app nativa) y `src/app/conductor/manifiesto/page.tsx` (la PWA)
  --   buscan LOS MANIFIESTOS DEL DÍA y hacen
  --   `.order('creado_en', {ascending:false}).limit(1)`: se quedan con UNO SOLO,
  --   el más reciente. En el instante en que existiera un segundo manifiesto del
  --   día, las paradas del primero DESAPARECERÍAN de la app del conductor — en
  --   plena calle, sin un error, sin un aviso y sin nada que mirar.
  --
  -- El razonamiento anterior ("un manifiesto confirmado ya salió a la calle, no se
  -- le inyectan paradas por detrás") describía un riesgo real pero elegía el peor
  -- de los dos males: una asignación tardía es EXACTAMENTE lo que la operación
  -- necesita —el coordinador reparte por lotes toda la mañana y el corte es a las
  -- 16:00 (alcance §2.2)—, y tiene que caer en la lista que el conductor ya tiene
  -- abierta, no en una lista paralela que él no va a ver nunca. Que la parada
  -- aparezca sin avisar es un problema de interfaz, que se resuelve avisando; que
  -- desaparezcan 25 paradas ya cargadas es una entrega perdida.
  --
  -- Con esto la función CONSERVA el invariante "un manifiesto por conductor y día"
  -- que todo lo de aguas abajo ya asume, en vez de romperlo, y no hay que tocar un
  -- endpoint que ya está en producción con la app nativa encima.
  --
  -- ⚠️ CONSECUENCIA QUE HAY QUE TENER PRESENTE: esta función es hoy el ÚNICO camino
  -- que agrega pedidos a un manifiesto que no está en `borrador`. El camino
  -- TypeScript (`asignarPedidosAManifiesto`, manifiestos.ts:144) lo sigue
  -- rechazando con ErrorConflicto. Los dos difieren a propósito y el alcance lo
  -- anticipaba (§5: "hoy el código no lo permite… necesita camino propio").
  --
  -- ORDEN `creado_en desc`: el MISMO criterio que usan las dos pantallas del
  -- conductor, para que las dos mitades coincidan siempre en cuál es "el
  -- manifiesto de hoy". (Antes se tomaba el más antiguo, que era justo el que la
  -- app NO mira.) El `m.id desc` es solo desempate determinista; un empate exacto
  -- de `creado_en` no lo puede producir esta función —nunca deja dos reutilizables
  -- vivos— y solo se alcanzaría con filas insertadas a mano.
  --
  -- El esquema lo permite y hace falta que lo siga permitiendo: `operacion.manifiestos`
  -- tiene índice (tenant_id, driver_id, fecha_operacion) pero NO es único, y ese
  -- segundo manifiesto es imprescindible para la segunda vuelta tras un
  -- `completado`. La ausencia de esa unicidad es un INVARIANTE del que esta función
  -- depende, y hay una prueba pgTAP que falla si alguien la convierte en constraint.
  select m.id
    into v_manifiesto_id
    from operacion.manifiestos m
   where m.tenant_id       = p_tenant_id
     and m.driver_id       = p_conductor_id
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
       p_conductor_id,
       'Reparto ' || to_char(p_fecha, 'DD-MM-YYYY') || ' — ' || v_conductor_nombre,
       p_fecha,
       'borrador',
       p_actor_usuario_id)
    returning operacion.manifiestos.id into v_manifiesto_id;

    v_manifiesto_creado := true;
  end if;

  -- ---------------------------------------------------------------------------
  -- (5) Clasificación — una sola pasada, un solo cubo por identificador.
  -- ---------------------------------------------------------------------------
  -- Los dos LEFT JOIN llevan su `tenant_id` explícito aunque las FK ya lo
  -- garanticen: bajo SECURITY DEFINER no hay RLS debajo y este texto es la única
  -- barrera (ver cabecera). El join a asignaciones filtra `a.activa` — el unique
  -- parcial garantiza que hay como mucho una, así que no puede multiplicar filas.
  with candidatos as (
    select distinct u.pedido_id
      from unnest(v_ids) as u(pedido_id)
  ),
  clasificado as (
    select
      c.pedido_id,
      case
        when p.id is null                                          then 'ajeno'
        when p.situacion_retiro <> 'retirado'                      then 'no_retirado'
        when p.estado not in ('pendiente_asignacion', 'asignado')  then 'estado_no_asignable'
        when a.manifiesto_id = v_manifiesto_id                     then 'ya_en_manifiesto'
        when a.id is not null                                      then 'reasignar'
        else                                                            'asignar'
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
    coalesce(array_agg(cl.pedido_id) filter (where cl.motivo = 'asignar'),   '{}'::uuid[]),
    coalesce(array_agg(cl.pedido_id) filter (where cl.motivo = 'reasignar'), '{}'::uuid[]),
    count(*) filter (where cl.motivo = 'no_retirado')::integer,
    count(*) filter (where cl.motivo = 'estado_no_asignable')::integer,
    count(*) filter (where cl.motivo = 'ya_en_manifiesto')::integer,
    count(*) filter (where cl.motivo = 'ajeno')::integer,
    -- El desglose CON identificadores, no solo cifras. "Se asignaron 28 de 30"
    -- sin decir CUÁLES son los otros 2 obliga al coordinador a buscarlos a mano, y
    -- a esa hora no tiene tiempo. Son identificadores que el propio llamador acaba
    -- de enviar: no revela nada que no supiera.
    coalesce(
      jsonb_agg(
        jsonb_build_object('pedido_id', cl.pedido_id, 'motivo', cl.motivo)
        order by cl.motivo, cl.pedido_id
      ) filter (
        where cl.motivo in ('ajeno', 'no_retirado', 'estado_no_asignable', 'ya_en_manifiesto')
      ),
      '[]'::jsonb
    )
    into v_asignar, v_reasignar, v_om_no_retirado, v_om_estado, v_om_ya, v_om_ajenos,
         v_omitidos_detalle
    from clasificado cl;

  v_om_total   := v_om_no_retirado + v_om_estado + v_om_ya + v_om_ajenos;
  v_a_escribir := v_asignar || v_reasignar;

  -- Aserción de reparto: todo identificador cae en exactamente un cubo. Si esto
  -- se rompiera, la pantalla mostraría cifras que no suman y nadie sabría por qué.
  if cardinality(v_ids) <> cardinality(v_a_escribir) + v_om_total then
    raise exception
      'asignar_pedidos_en_bloque: la clasificación no cuadra (% solicitados, % a escribir, % omitidos)',
      cardinality(v_ids), cardinality(v_a_escribir), v_om_total
      using errcode = 'P0001';
  end if;

  -- ---------------------------------------------------------------------------
  -- (6) Reasignación: apagar la asignación vigente ANTES de insertar la nueva.
  -- ---------------------------------------------------------------------------
  -- El orden no es negociable: `idx_asignaciones_pedido_activa_uk` es un unique
  -- parcial sobre (pedido_id) where activa — dos activas a la vez es un 23505. Y
  -- son dos SENTENCIAS separadas a propósito: metidas en un mismo statement con
  -- CTEs modificantes, ambas verían el mismo snapshot y el orden de ejecución
  -- entre ellas no está definido, así que el índice podría ver las dos filas
  -- activas y reventar de forma intermitente.
  --
  -- Al apagar la fila, `trg_asignaciones_sincronizar_driver_id` limpia
  -- `pedidos.driver_id_asignado` solo si todavía apunta a ESE conductor, y al
  -- insertar la nueva lo vuelve a poner. Por eso esta función NO escribe esa
  -- columna a mano: duplicarla sería tener dos dueños de un mismo dato.
  if cardinality(v_reasignar) > 0 then
    update operacion.asignaciones_pedido a
       set activa         = false,
           desasignado_en = now()
     where a.tenant_id = p_tenant_id
       and a.activa
       and a.pedido_id = any(v_reasignar);

    get diagnostics v_desactivados = row_count;

    if v_desactivados <> cardinality(v_reasignar) then
      raise exception
        'asignar_pedidos_en_bloque: se esperaba desactivar % asignaciones y se desactivaron % (alguien escribió en paralelo pese al bloqueo)',
        cardinality(v_reasignar), v_desactivados
        using errcode = 'P0001';
    end if;
  end if;

  -- ---------------------------------------------------------------------------
  -- (7) La asignación nueva. `seller_id` sale del propio pedido, y el trigger
  --     asignaciones_pedido_validar_denormalizados lo vuelve a verificar (23514).
  -- ---------------------------------------------------------------------------
  -- `asignado_por_usuario_id` se escribe SIEMPRE que venga: es el "quién" a nivel
  -- de fila, y el camino TypeScript al que esta función reemplaza nunca lo
  -- llenaba. Un actor inexistente hace fallar el lote entero por FK, y está bien:
  -- una asignación sin autor rastreable no es una asignación auditable.
  if cardinality(v_a_escribir) > 0 then
    insert into operacion.asignaciones_pedido
      (tenant_id, pedido_id, manifiesto_id, driver_id, seller_id, activa,
       asignado_por_usuario_id, asignado_en)
    select
      p_tenant_id, p.id, v_manifiesto_id, p_conductor_id, p.seller_id, true,
      p_actor_usuario_id, now()
      from operacion.pedidos p
     where p.tenant_id = p_tenant_id
       and p.id = any(v_a_escribir)
     order by p.id;

    get diagnostics v_insertados = row_count;

    if v_insertados <> cardinality(v_a_escribir) then
      raise exception
        'asignar_pedidos_en_bloque: se esperaba insertar % asignaciones y se insertaron %',
        cardinality(v_a_escribir), v_insertados
        using errcode = 'P0001';
    end if;

    -- ---------------------------------------------------------------------------
    -- (8) El estado del pedido. Solo sube `pendiente_asignacion` → `asignado`.
    -- ---------------------------------------------------------------------------
    -- El WHERE hace todo el trabajo: lo que ya estaba `asignado` no se toca (ni
    -- siquiera se le mueve `actualizado_en`), y ningún otro estado entra porque la
    -- reja 3 ya los dejó fuera. NO se tocan `origen`, `situacion_retiro` ni
    -- `estado_ml`: son ejes de otros dueños (la ingesta de ML escribe los dos
    -- últimos) y meter la mano aquí es como se reseteó una operación entera en el
    -- upsert del backfill (CLAUDE.md §bloqueador raíz).
    update operacion.pedidos p
       set estado = 'asignado'
     where p.tenant_id = p_tenant_id
       and p.estado    = 'pendiente_asignacion'
       and p.id = any(v_a_escribir);
  end if;

  -- ---------------------------------------------------------------------------
  -- (9) Bitácora — DENTRO de la transacción, y al final.
  -- ---------------------------------------------------------------------------
  -- ⚠️ ESTO SE APARTA DEL PATRÓN "bitácora ANTES del efecto" de CLAUDE.md, y el
  -- porqué tiene que quedar escrito: esa regla existe porque un evento Inngest o
  -- una llamada a una integración externa NO SE PUEDEN DESHACER, así que la
  -- auditoría tiene que sobrevivir al fallo del paso siguiente. Aquí el efecto es
  -- puramente transaccional: si algo falla, se deshace TODO, y un asiento que
  -- describa una asignación que no ocurrió sería peor que no tenerlo —
  -- contaminaría la única evidencia que hay. La atomicidad da una garantía MÁS
  -- FUERTE que el orden, y por eso el asiento va al final, donde las cifras ya
  -- están calculadas.
  --
  -- Un asiento POR LOTE (no por pedido) con su `actorUsuarioId` — RNF-04 exige el
  -- "quién". El detalle guarda las CIFRAS, no la lista de identificadores: el
  -- rastro fino por pedido ya vive en `asignaciones_pedido`, con
  -- `asignado_por_usuario_id` y `asignado_en` en cada fila.
  --
  -- Verbo PROPIO (`...en_bloque`) y no el `manifiesto.pedidos_asignados` del
  -- camino TypeScript, a propósito: la forma de `detalle` es distinta (trae el
  -- desglose de omitidos), y un consumidor que parsee la forma vieja leería mal la
  -- nueva sin enterarse. Mientras los dos caminos convivan, el verbo dice cuál corrió.
  --
  -- El INSERT lo permite el privilegio del DEFINER (dueño de la tabla) más su
  -- BYPASSRLS: `identidad.bitacora_auditoria` tiene FORCE RLS y ninguna política
  -- de INSERT (20260101000004 §4), y 20260811000001 revocó INSERT a todo rol de
  -- cliente. Hay una aserción en el §3 de esta migración que lo comprueba en
  -- tiempo de migración en vez de descubrirlo a las 15:58.
  insert into identidad.bitacora_auditoria
    (tenant_id, actor_usuario_id, actor_tipo, accion, entidad_tipo, entidad_id, detalle)
  values (
    p_tenant_id,
    p_actor_usuario_id,
    case when p_actor_usuario_id is null then 'sistema' else 'usuario' end::identidad.actor_tipo_auditoria,
    'manifiesto.pedidos_asignados_en_bloque',
    'manifiesto',
    v_manifiesto_id,
    jsonb_build_object(
      'driver_id',                    p_conductor_id,
      'fecha_operacion',              p_fecha,
      'manifiesto_creado',            v_manifiesto_creado,
      'total_solicitados',            cardinality(v_ids),
      'total_asignados',              cardinality(v_asignar),
      'total_reasignados',            cardinality(v_reasignar),
      'total_omitidos',               v_om_total,
      'omitidos_no_retirado',         v_om_no_retirado,
      'omitidos_estado_no_asignable', v_om_estado,
      'omitidos_ya_en_manifiesto',    v_om_ya,
      'omitidos_ajenos',              v_om_ajenos
    )
  );

  -- ---------------------------------------------------------------------------
  -- (10) La verdad para la pantalla.
  -- ---------------------------------------------------------------------------
  return query
    select
      v_manifiesto_id,
      v_manifiesto_creado,
      cardinality(v_ids),
      cardinality(v_asignar),
      cardinality(v_reasignar),
      v_om_total,
      v_om_no_retirado,
      v_om_estado,
      v_om_ya,
      v_om_ajenos,
      v_omitidos_detalle;
end;
$fn$;

comment on function operacion.asignar_pedidos_en_bloque(uuid, uuid, date, uuid[], uuid) is
  'ASIGNA UN LOTE DE PEDIDOS A UN CONDUCTOR EN UNA SOLA TRANSACCIÓN. Reemplaza el
   bucle de src/modules/operacion/manifiestos.ts, que hacía hasta 3 escrituras
   sueltas por pedido sin transacción: si el pedido 200 fallaba, los 199 anteriores
   quedaban aplicados y sin un solo asiento de auditoría. Aquí o se aplican todos o
   no se aplica ninguno. Además, los identificadores viajan en el CUERPO del RPC y
   no en la query string, lo que elimina el "URI too long" del .in() sin lotear.

   EL MANIFIESTO ES SUBPRODUCTO, NO PASO PREVIO (alcance §4): reutiliza el
   manifiesto del día del conductor si sigue VIVO (borrador, confirmado o en_ruta,
   el más reciente por creado_en) y crea uno nuevo solo si no hay ninguno o si el
   que hay ya está completado o cancelado — ahí sí es una segunda vuelta genuina.

   ⚠️ Reutiliza también el CONFIRMADO y el EN_RUTA a propósito, y esto invierte la
   primera versión de la migración. Las dos pantallas del conductor
   (api/conductor/manifiesto/route.ts:37-45 y conductor/manifiesto/page.tsx) piden
   los manifiestos del día y se quedan con UNO, el más reciente por creado_en: en
   cuanto existiera un segundo, las paradas del primero desaparecerían de la app en
   plena calle, sin error ni aviso. Una asignación tardía es justo lo que la
   operación necesita (se reparte por lotes toda la mañana, corte a las 16:00) y
   tiene que caer en la lista que el conductor ya tiene abierta. Así la función
   CONSERVA el invariante "un manifiesto por conductor y día" en vez de romperlo.
   Es hoy el único camino que agrega a un manifiesto no-borrador: el camino
   TypeScript sigue rechazándolo, y difieren a propósito.

   Aun así, NO puede existir un unique (tenant_id, driver_id, fecha_operacion) en
   operacion.manifiestos: el segundo manifiesto hace falta para la segunda vuelta
   tras un completado. Es un invariante del que esta función depende y hay pgTAP
   que lo vigila.

   REJAS, en orden de precedencia y con un solo cubo por identificador: ajeno (no
   existe o es de otro courier — se OMITE, nunca se lanza: distinguir los dos casos
   confirmaría la existencia de un pedido ajeno) · no_retirado (LA reja de la
   etapa: solo se asigna lo escaneado en bodega; un seller despacha con varios
   couriers y asignar un candidato ajeno termina en un DTE por una entrega de otro)
   · estado_no_asignable (solo pendiente_asignacion y asignado) · ya_en_manifiesto
   (idempotencia del reenvío). Devuelve las cifras Y el desglose con
   identificadores, para que la pantalla no obligue a buscar a mano los que faltan.

   NO escribe pedidos.driver_id_asignado: de eso se encarga
   trg_asignaciones_sincronizar_driver_id. NO filtra por fecha_compromiso, ni por
   conductores.estado/disponible, ni por el estado del manifiesto de origen — cada
   una de esas ausencias es deliberada y está argumentada en la migración.

   La bitácora va DENTRO de la transacción y al final, apartándose del patrón
   "bitácora antes del efecto": esa regla protege de efectos externos irreversibles;
   aquí, si algo falla se deshace todo y un asiento de una asignación que no ocurrió
   sería peor que no tenerlo. Un asiento por lote, con actor.

   SECURITY DEFINER con el tenant por parámetro (no por claim, para servir también a
   jobs de service_role); EXECUTE solo para service_role.';


-- =============================================================================
-- 2. Privilegios de ejecución — ningún rol de cliente
-- =============================================================================
-- Molde 20260813000004 §6 y 20260813000006 §3. Es SECURITY DEFINER y escribe
-- pedidos, manifiestos y asignaciones saltándose RLS: si `authenticated` pudiera
-- ejecutarla, a cualquier usuario le bastaría pasar el uuid de otro courier para
-- reasignarle la operación del día — y encima quedaría auditado a nombre del
-- courier víctima. La llama el servidor con service_role, después de resolver el
-- tenant y la capacidad RBAC (`puedeAsignarYReasignarPedidos`) desde la sesión.
revoke all on function operacion.asignar_pedidos_en_bloque(uuid, uuid, date, uuid[], uuid)
  from public, anon, authenticated;

grant execute on function operacion.asignar_pedidos_en_bloque(uuid, uuid, date, uuid[], uuid)
  to service_role;


-- =============================================================================
-- 3. Aserciones defensivas — la migración ABORTA si algo no quedó en pie
-- =============================================================================
-- No altera nada: inspecciona el catálogo y falla ruidosamente. Las seis cosas que
-- revisa fallarían tarde y mal — algunas en silencio, otras a las 15:58 de un
-- martes, que es peor.
do $$
declare
  v_fn constant text := 'operacion.asignar_pedidos_en_bloque(uuid,uuid,date,uuid[],uuid)';
begin
  -- 3.1 Existe. to_regprocedure devuelve NULL en vez de reventar si no.
  if to_regprocedure(v_fn) is null then
    raise exception
      'No existe la función %. La asignación en bloque volvería al bucle sin transacción, que deja lotes aplicados a medias y sin auditoría.', v_fn;
  end if;

  -- 3.2 SECURITY DEFINER. Sin él la función se evalúa con los privilegios del
  --     invocador: service_role seguiría funcionando (BYPASSRLS) y la divergencia
  --     pasaría inadvertida hasta que la llame cualquier otro rol.
  if not exists (select 1 from pg_proc where oid = to_regprocedure(v_fn)::oid and prosecdef) then
    raise exception
      'La función % no es SECURITY DEFINER. El contrato es explícito: escribe sin RLS y el aislamiento lo impone p_tenant_id.', v_fn;
  end if;

  -- 3.3 Ningún rol de cliente conserva EXECUTE. Se mide con has_function_privilege
  --     y no contando GRANTs: lo que importa es el privilegio EFECTIVO, incluido el
  --     que se hereda vía PUBLIC.
  if has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception
      'authenticated conserva EXECUTE sobre %. Escribe sin RLS: bastaría pasar el uuid de otro courier para reasignarle su operación del día.', v_fn;
  end if;

  if has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'anon conserva EXECUTE sobre %. Escribe sin RLS.', v_fn;
  end if;

  -- 3.4 Control positivo: el revoke no dejó la función inservible para quien sí
  --     debe llamarla. Sin esto, un revoke de más pasaría por "seguro" y la
  --     pantalla de asignación quedaría muerta en producción.
  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception
      'service_role NO puede ejecutar %. El revoke se pasó de largo y la asignación en bloque no funcionaría.', v_fn;
  end if;

  -- 3.5 LAS DOS PIEZAS AJENAS DE LAS QUE ESTA FUNCIÓN DEPENDE.
  --
  --     (a) El unique parcial. Es LA invariante: una sola asignación vigente por
  --         pedido. La función se apoya en él para que la reasignación sea segura
  --         (apaga y luego inserta). Si desapareciera, un pedido podría quedar
  --         activo en dos manifiestos y salir en la ruta de dos conductores, sin
  --         ningún error en ninguna parte.
  if not exists (
    select 1 from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'operacion'
      and t.relname = 'asignaciones_pedido'
      and c.relname = 'idx_asignaciones_pedido_activa_uk'
      and i.indisunique
      and i.indpred is not null
  ) then
    raise exception
      'Falta el unique parcial idx_asignaciones_pedido_activa_uk sobre operacion.asignaciones_pedido (pedido_id) where activa. Es la invariante "una sola asignación vigente por pedido"; sin él la reasignación de esta función dejaría dos activas y el pedido saldría en dos rutas.';
  end if;

  --     (b) El trigger que sincroniza pedidos.driver_id_asignado. La función NO
  --         escribe esa columna a propósito. Si el trigger no estuviera, la
  --         asignación se aplicaría, el conductor no vería ni un pedido en su app
  --         (su política RLS P3 filtra por driver_id_asignado) y no habría ni un
  --         error que mirar.
  if not exists (
    select 1 from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'operacion'
      and c.relname = 'asignaciones_pedido'
      and tg.tgname = 'trg_asignaciones_sincronizar_driver_id'
      and not tg.tgisinternal
  ) then
    raise exception
      'Falta el trigger trg_asignaciones_sincronizar_driver_id en operacion.asignaciones_pedido. asignar_pedidos_en_bloque NO escribe pedidos.driver_id_asignado porque ese trigger es su dueño: sin él, el conductor no vería ni uno de sus pedidos asignados y no habría error alguno.';
  end if;

  -- 3.6 El asiento de bitácora tiene que poder escribirse. La tabla es append-only
  --     con FORCE RLS y sin política de INSERT: el único camino es el privilegio
  --     del DEFINER (dueño) más BYPASSRLS. Si alguna de las dos mitades faltara, la
  --     asignación entera fallaría — y lo haría en caliente, no aquí.
  --     current_user en una migración es el dueño de la función recién creada.
  if not has_table_privilege(current_user, 'identidad.bitacora_auditoria', 'INSERT') then
    raise exception
      'El dueño de asignar_pedidos_en_bloque (%) no puede INSERTAR en identidad.bitacora_auditoria. El asiento de auditoría del lote fallaría y con él la asignación completa.', current_user;
  end if;

  if not exists (select 1 from pg_roles where rolname = current_user and rolbypassrls) then
    raise exception
      'El dueño de asignar_pedidos_en_bloque (%) no tiene BYPASSRLS. identidad.bitacora_auditoria tiene FORCE RLS y ninguna política de INSERT, así que el asiento del lote sería rechazado por RLS.', current_user;
  end if;
end $$;


-- =============================================================================
-- 4. Handoff (NO se implementa aquí — solo se documenta)
-- =============================================================================
--
--    `backend`
--      · Llamar SIEMPRE por RPC con service_role:
--          cliente.rpc('asignar_pedidos_en_bloque', {
--            p_tenant_id, p_conductor_id, p_fecha, p_pedido_ids, p_actor_usuario_id })
--        La capacidad RBAC (`puedeAsignarYReasignarPedidos`) se valida ANTES, en la
--        Server Action: la función no la conoce ni debe conocerla.
--      · `p_fecha` la calcula el llamador con `fechaLocalEnSantiago`. La base corre
--        en UTC: si alguien mete un `current_date` dentro de la función, a partir de
--        las 21:00 de Santiago el día operativo se adelanta y la asignación de la
--        tarde crearía el manifiesto de mañana. Por eso la fecha es PARÁMETRO.
--      · `asignarPedidosAManifiesto` (manifiestos.ts:112) queda como camino heredado.
--        Mientras conviva con este, se distinguen en la bitácora por el verbo
--        (`manifiesto.pedidos_asignados` vs `...pedidos_asignados_en_bloque`).
--      · Errores que hay que traducir a mensaje de interfaz: 22023 (lote vacío o
--        parámetros nulos), P0002 (conductor que no es de este courier), 23503
--        (actor que no existe en auth.users).
--
--    `frontend`
--      · La respuesta trae `omitidos_detalle`: un arreglo de {pedido_id, motivo}.
--        Es lo que permite decir "28 de 30 · 2 no estaban retirados" y ADEMÁS
--        marcarlos en la lista. Los cuatro motivos son `ajeno`, `no_retirado`,
--        `estado_no_asignable` y `ya_en_manifiesto`; los textos los define
--        `copywriter`.
--      · `manifiesto_creado` distingue "se creó el manifiesto del día" de "se sumó
--        al que ya existía", que es lo que el coordinador necesita leer.
--      · El nombre autogenerado del manifiesto es
--        'Reparto DD-MM-YYYY — <conductor>'. Si `copywriter` prefiere otro, se
--        cambia aquí y en ningún otro sitio.
--
--    ⚠️ `frontend` / app Expo — LO QUE SÍ HAY QUE RESOLVER ARRIBA
--      La función ya NO parte el día en dos manifiestos, así que las dos pantallas
--      del conductor siguen funcionando sin tocarlas. Lo que sí cambia es que a un
--      manifiesto CONFIRMADO o EN_RUTA le pueden aparecer paradas nuevas mientras el
--      conductor lo tiene abierto. Eso es deliberado —la asignación tardía tiene que
--      llegarle— pero merece un aviso en la app ("se agregaron N paradas"), no una
--      lista que crece en silencio. Es trabajo de interfaz, no de base de datos.
--
--    ⚠️ `arquitecto` / `qa` — EL INVARIANTE QUE ESTA FUNCIÓN CONSERVA PERO NO IMPONE
--      "Un manifiesto vivo por conductor y día" lo respeta esta función, pero NO lo
--      impone el esquema (no hay unique, y no puede haberlo: hace falta un segundo
--      manifiesto para la segunda vuelta tras un `completado`). Cualquier otro
--      escritor de `operacion.manifiestos` —`crearManifiesto` desde
--      /manifiestos/actions.ts, o lo que quede de la auto-asignación— sí puede
--      romperlo, y el síntoma sería el mismo: paradas que desaparecen de la app.
--      Si esos caminos se conservan, conviene que pasen por esta misma regla.
--
--    `qa`
--      · La prueba vive en
--        supabase/tests/database/rls_aislamiento_asignacion_en_bloque.test.sql.
--      · Los seeds de demo insertan pedidos sin `situacion_retiro`, así que nacen
--        `pendiente` y esta función los OMITIRÁ TODOS. Para probar la pantalla hay
--        que sembrar `retirado` a propósito — y dejar algunos en `pendiente` para
--        poder demostrar la reja.
--
--    `arquitecto` (deuda conocida, NO se paga aquí)
--      · `asignaciones_pedido.activa` no se apaga nunca al entregar (plan, "Deuda
--        previa a la etapa 6"). Esta función no la agrava —solo apaga al reasignar,
--        igual que el camino que reemplaza— pero tampoco la resuelve. La etapa 7
--        depende de esa decisión para saber dónde persistir la secuencia de paradas.
-- =============================================================================
