-- =============================================================================
-- Operación · etapa 7 — PERSISTIR LA SECUENCIA DE PARADAS
-- =============================================================================
-- CONTEXTO: docs/arquitectura/retiro-y-ruteo.md §4/§4.1 (ruteo por conductor
-- sobre sus 25-30 paradas ya asignadas, con reordenamiento manual) y
-- docs/arquitectura/retiro-y-ruteo-plan.md §Etapa 7.
-- Predecesoras: 20260601000005 (asignaciones_pedido, manifiestos y sus
-- triggers), 20260814000001 (asignar_pedidos_en_bloque — el molde de esta
-- función y de su bitácora dentro de la transacción).
--
-- =============================================================================
-- EL PROBLEMA QUE CIERRA
-- =============================================================================
-- Hoy NO existe una secuencia. `src/modules/operacion/orden-paradas.ts` ordena
-- alfabéticamente por comuna y dirección, se aplica en TRES puntos de render
-- distintos y no se persiste en ninguna columna: lo que ve el conductor es un
-- orden accidental que se recalcula cada vez que alguien mira la pantalla. El
-- motor de ruteo (`src/modules/operacion/ruteo/`) ya calcula `secuencia`, pero
-- no tenía dónde dejarla, así que su resultado se evaporaba.
--
-- =============================================================================
-- POR QUÉ VA EN LA FILA ACTIVA DE asignaciones_pedido Y NO EN TABLA PROPIA
-- =============================================================================
-- El plan de ejecución dejó la decisión colgando de la "deuda de `activa`": si
-- la etapa 6 no la pagaba, la secuencia iba a tabla propia. La deuda se resolvió
-- al revés de lo previsto — `activa` NO significa "en curso", significa "ésta es
-- la asignación válida de este pedido", y lo impone el índice único parcial
-- `idx_asignaciones_pedido_activa_uk (pedido_id) where activa`. El motor
-- entrega→dinero lee de ahí a quién pagarle.
--
-- Con esa lectura, la fila activa es el lugar natural: el orden es "de este
-- pedido dentro de este manifiesto", que es exactamente lo que esa fila
-- representa. Una tabla propia duplicaría la pareja (pedido, manifiesto), con su
-- propia FK, su propia RLS y su propia forma de quedar desincronizada cuando el
-- pedido se reasigna — el reordenamiento y la reasignación pasarían a ser dos
-- verdades sobre el mismo hecho.
--
-- CONSECUENCIA GRATIS Y DESEADA: reasignar un pedido a otro manifiesto ya apaga
-- su fila e inserta una nueva; la nueva nace con `orden_ruta` NULL, o sea "sin
-- rutear en su nuevo manifiesto". No hay nada que limpiar a mano.
--
-- =============================================================================
-- QUÉ CONSTRUYE
-- =============================================================================
--   1. `operacion.asignaciones_pedido.orden_ruta` — nullable (NULL = sin
--      rutear), con su CHECK de rango.
--   2. Un índice único PARCIAL `(manifiesto_id, orden_ruta) where activa and
--      orden_ruta is not null` — la elección está razonada abajo, en §2, junto
--      con la trampa del intercambio y el caso de dos coordinadores a la vez.
--   3. `operacion.aplicar_secuencia_paradas` — la ÚNICA escritura de esa
--      columna. Transaccional, con bitácora y autor.
--   4. Privilegio POR COLUMNA: `authenticated` pierde INSERT/UPDATE sobre
--      `orden_ruta` (y solo sobre ella). La secuencia se escribe por la función
--      o no se escribe.
--
-- Idempotente (`add column if not exists`, `create unique index if not exists`,
-- `create or replace`, DO-blocks con guardas) y no destructiva: no borra ni
-- reescribe una sola fila existente.
--
-- Prueba: supabase/tests/database/rls_aislamiento_secuencia_paradas.test.sql
-- =============================================================================


-- =============================================================================
-- 1. La columna
-- =============================================================================
alter table operacion.asignaciones_pedido
  add column if not exists orden_ruta integer;

comment on column operacion.asignaciones_pedido.orden_ruta is
  'Posición de esta parada DENTRO DE SU MANIFIESTO. Arranca en 1 (la primera
   parada es 1, no 0) y es contigua por construcción: la escribe
   operacion.aplicar_secuencia_paradas a partir de la POSICIÓN en el arreglo que
   recibe, así que una secuencia con huecos o con dos paradas en el mismo lugar
   es inexpresable.

   NULL = esta parada NO está ruteada. Es un estado normal y frecuente, no un
   defecto: un manifiesto recién armado no tiene secuencia hasta que alguien
   corre el motor, y una parada sin coordenada usable nunca entra a la secuencia
   (el motor la devuelve en `sinUbicar`). Los tres puntos de render caen al orden
   alfabético por comuna y dirección cuando el manifiesto no tiene ni una parada
   ruteada, y ponen las NULL al final —alfabéticamente— cuando solo faltan
   algunas. El orden alfabético NO se retira: es el respaldo legítimo.

   El orden es por MANIFIESTO, nunca global ni por conductor: dos manifiestos
   distintos tienen los dos una parada número 1. La unicidad la impone el índice
   parcial idx_asignaciones_secuencia_manifiesto_uk, que excluye las filas
   inactivas — una asignación superada conserva el número que tuvo, como dato
   histórico, y no bloquea el espacio de orden del manifiesto vivo.

   ESCRITURA: solo operacion.aplicar_secuencia_paradas. authenticated NO tiene
   privilegio de INSERT ni de UPDATE sobre esta columna (grant por columna, §5) —
   la vista public.asignaciones_pedido tampoco es una puerta trasera.';

-- Cordura mínima. El motor emite 1..N; un 0 sería un bug de índice base-cero y
-- un negativo, basura. No se acota por arriba: no hay tope real de paradas.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'asignaciones_pedido_orden_ruta_rango'
       and conrelid = 'operacion.asignaciones_pedido'::regclass
  ) then
    alter table operacion.asignaciones_pedido
      add constraint asignaciones_pedido_orden_ruta_rango
      check (orden_ruta is null or orden_ruta >= 1);
  end if;
end $$;


-- =============================================================================
-- 2. LA UNICIDAD — la decisión, y por qué no es la obvia
-- =============================================================================
-- LA TRAMPA: `unique (manifiesto_id, orden_ruta)` a secas parece lo correcto y
-- rompe dos cosas distintas.
--
--   (a) EL INTERCAMBIO. Reordenar a mano son permutaciones: mover la parada 5 al
--       lugar 2 desplaza cuatro filas y, en el caso mínimo, intercambia dos. Un
--       índice único NO diferido se comprueba fila a fila DENTRO de la misma
--       sentencia, así que `update ... set orden_ruta = <nuevo>` revienta con
--       23505 en el estado intermedio aunque el estado final sea impecable. Es el
--       mismo motivo por el que `update t set pos = pos + 1` falla.
--   (b) EL HISTORIAL. `asignaciones_pedido` guarda historia: una asignación
--       superada conserva su `manifiesto_id` con `activa = false`. Si esa fila
--       muerta conservara su número dentro del índice, el manifiesto perdería
--       ese lugar para siempre y la ruta siguiente fallaría contra un fantasma.
--
-- LAS DOS SALIDAS QUE EL PLAN CONTEMPLABA, Y POR QUÉ NINGUNA SE ELIGIÓ ENTERA:
--
--   · `deferrable initially deferred` resuelve (a), pero NO PUEDE resolver (b):
--     una constraint diferible se declara con ALTER TABLE ... ADD CONSTRAINT, y
--     esa forma NO admite cláusula WHERE. O sea que sería forzosamente TOTAL y
--     se tragaría las filas históricas. Para salvarla habría que apagar
--     `orden_ruta` en cada camino que desactiva una asignación — hoy son cuatro,
--     tres de ellos en TypeScript y fuera de esta migración — o esconderlo en un
--     trigger. Y encima su violación estalla en el COMMIT, fuera de toda
--     sentencia: plpgsql no la puede atrapar y el mensaje no señala nada útil.
--   · "No poner constraint y confiar en la función" resuelve las dos, pero deja
--     el invariante sin red en la base, que es justo lo que este proyecto no
--     hace.
--
-- LO QUE SE ELIGE: índice único PARCIAL, no diferido, más una escritura EN DOS
-- SENTENCIAS dentro de la misma transacción (§3, pasos 3 y 4: primero se apaga
-- la secuencia vigente del manifiesto, después se escribe la nueva).
--
--   · El `where activa` mata (b): las filas históricas no están en el índice.
--   · El apagado previo mata (a): el estado intermedio es "todas NULL", y en
--     Postgres los NULL no colisionan entre sí (NULLS DISTINCT por defecto), así
--     que CUALQUIER permutación es aplicable sin pasar por un estado inválido.
--     No hace falta diferir nada.
--   · Y la red queda EN LA BASE: si algún día alguien escribiera dos veces el
--     mismo lugar, el índice lo rechaza con 23505 en el acto, dentro de la
--     sentencia, donde el error dice qué pasó.
--
-- DOS COORDINADORES RUTEANDO EL MISMO MANIFIESTO A LA VEZ:
-- la función toma `for update` sobre la fila del manifiesto ANTES de mirar nada
-- (§3, paso 2). El segundo espera al commit del primero y recién entonces aplica
-- SU secuencia completa — gana el último, con una secuencia entera y coherente,
-- nunca una mezcla de las dos. No puede haber interleaving porque cada llamada
-- escribe la secuencia COMPLETA del manifiesto, no un delta.
--
-- ⚠️ Esto es distinto del cerrojo consultivo de asignar_pedidos_en_bloque
-- (20260814000001, paso (2)) y la diferencia importa: allí el manifiesto puede
-- NO EXISTIR todavía —es subproducto de la asignación— y no hay fila que
-- bloquear, así que hace falta un `pg_advisory_xact_lock` sobre la tripleta
-- (tenant, conductor, fecha). Aquí el manifiesto es un parámetro y su fila
-- siempre existe: `for update` sobre ella es más barato y más preciso.
create unique index if not exists idx_asignaciones_secuencia_manifiesto_uk
  on operacion.asignaciones_pedido (manifiesto_id, orden_ruta)
  where activa and orden_ruta is not null;

comment on index operacion.idx_asignaciones_secuencia_manifiesto_uk is
  'Dos paradas no pueden ocupar el mismo lugar en el mismo manifiesto. PARCIAL a
   propósito: `activa` excluye las asignaciones superadas (que conservan su
   manifiesto_id y bloquearían el lugar para siempre) y `orden_ruta is not null`
   deja fuera lo no ruteado, que es la mayoría del día. NO es diferible, y no
   hace falta: aplicar_secuencia_paradas apaga la secuencia vigente antes de
   escribir la nueva, así que ninguna permutación pasa por un estado duplicado.';


-- =============================================================================
-- 3. operacion.aplicar_secuencia_paradas — LA ÚNICA ESCRITURA
-- =============================================================================
-- UNA SOLA FUNCIÓN PARA LOS DOS CASOS. El motor de ruteo y el arrastre manual
-- del coordinador son EL MISMO HECHO: "la secuencia de este manifiesto pasa a
-- ser ésta". Dos funciones significarían dos validaciones, dos bitácoras y, el
-- día que se toque una, dos comportamientos. Lo único que las distingue es
-- `p_origen`, que solo viaja al asiento de auditoría.
--
-- LA SECUENCIA SE DERIVA DE LA POSICIÓN EN EL ARREGLO, no viene en pares
-- (pedido, orden). Es la decisión que hace inexpresable la entrada inválida: no
-- hay forma de mandar dos paradas en el lugar 3, ni un hueco entre el 4 y el 6,
-- ni un 0. `with ordinality` numera 1..N y ya está.
--
-- POR QUÉ ES SQL Y NO UN BUCLE EN TypeScript: mismo argumento que la etapa 6.
-- supabase-js no tiene transacciones; escribir parada por parada dejaría, ante
-- un fallo en la número 18, un manifiesto con media ruta nueva y media vieja —
-- que es peor que no tener ruta, porque parece una ruta.
--
-- EL TENANT VA POR PARÁMETRO, NUNCA POR CLAIM. SECURITY DEFINER: corre como el
-- dueño (BYPASSRLS), así que la RLS de asignaciones_pedido y manifiestos no
-- filtra nada debajo. El aislamiento lo impone `p_tenant_id`, y por eso CADA
-- lectura y CADA escritura lo lleva en su WHERE aunque las FK ya lo garanticen.
-- EXECUTE solo para service_role (§4).
--
-- -----------------------------------------------------------------------------
-- LOS ERRORES, Y POR QUÉ CADA UNO ES EL QUE ES
-- -----------------------------------------------------------------------------
--   22023  invalid_parameter_value           — el llamador mandó basura:
--          parámetros nulos, `p_origen` desconocido, un NULL dentro del arreglo
--          o un pedido repetido. Los dos últimos NO se toleran ni se filtran: un
--          NULL perdido corre TODAS las posiciones siguientes, y un id repetido
--          haría que `update ... from unnest` aplicara uno de los dos lugares de
--          forma no determinista, dejando un hueco sin que nada fallara.
--   P0002  no_data_found                     — el manifiesto no existe O es de
--          otro courier. DELIBERADAMENTE indistinguibles: un error distinto para
--          "existe pero es ajeno" confirmaría su existencia, que es exactamente
--          lo que el aislamiento no puede permitir. Mismo criterio que el
--          conductor ajeno en asignar_pedidos_en_bloque.
--   55000  object_not_in_prerequisite_state  — el manifiesto ya está `completado`
--          o `cancelado`. Rutear un día cerrado reescribiría historia y no
--          serviría a nadie.
--   P0001  raise_exception                   — la lista NO coincide con las
--          paradas activas del manifiesto. Cubre los dos casos que importan:
--          alguien coló un pedido de otro manifiesto (o de otro courier), o la
--          asignación cambió entre que la pantalla se dibujó y el coordinador
--          apretó guardar. Se rechaza el lote ENTERO en vez de escribir lo que sí
--          calzaba: una secuencia parcial que no es la que el coordinador vio es
--          peor que ninguna.
--
-- LO QUE SÍ SE ADMITE Y NO ES OLVIDO: un arreglo VACÍO. Aquí significa "este
-- manifiesto queda sin secuencia" y es una operación legítima —el motor puede
-- devolver cero paradas ruteables si ninguna tiene coordenada usable, y el
-- coordinador puede querer volver al orden alfabético—. Se aparta a propósito de
-- asignar_pedidos_en_bloque, donde el lote vacío LANZA: allí un lote vacío no
-- tiene significado y encima crearía un manifiesto fantasma. El precio asumido
-- es que un llamador que pierda la lista por el camino borra la ruta en vez de
-- fallar; queda acotado porque el asiento de bitácora registra `total_paradas: 0`
-- con su autor, así que es visible y reversible corriendo el motor otra vez.
create or replace function operacion.aplicar_secuencia_paradas(
  p_tenant_id        uuid,
  p_manifiesto_id    uuid,
  p_pedido_ids       uuid[],
  p_origen           text,
  p_actor_usuario_id uuid
)
returns table (
  -- Ningún nombre de salida coincide con una columna de las tablas que toca el
  -- cuerpo: en plpgsql los parámetros de un `returns table` son variables en
  -- ámbito, y `manifiesto_id` como nombre de salida volvería ambigua cualquier
  -- referencia sin calificar. Aun así, TODA columna del cuerpo va calificada.
  total_paradas            integer,
  total_sin_secuencia      integer,
  total_previas_limpiadas  integer
)
language plpgsql
security definer
set search_path = operacion, identidad, pg_temp
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
begin
  -- ---------------------------------------------------------------------------
  -- (1) Parámetros.
  -- ---------------------------------------------------------------------------
  if p_tenant_id is null or p_manifiesto_id is null or p_pedido_ids is null then
    raise exception
      'aplicar_secuencia_paradas: p_tenant_id, p_manifiesto_id y p_pedido_ids son obligatorios'
      using errcode = '22023';
  end if;

  -- `p_origen` no es decorativo: es lo único que distingue en la bitácora "el
  -- motor calculó la ruta" de "el coordinador movió una parada a mano", y esas
  -- dos son preguntas distintas cuando una entrega se cae. Se valida contra la
  -- lista cerrada en vez de aceptar texto libre.
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

  -- ---------------------------------------------------------------------------
  -- (2) El manifiesto es de ESTE courier, y sigue vivo. Cerrojo incluido.
  -- ---------------------------------------------------------------------------
  -- `for update` serializa a dos coordinadores sobre el mismo manifiesto (ver la
  -- nota larga en §2). No estorba a nadie más: dos manifiestos distintos no
  -- comparten fila.
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

  -- ---------------------------------------------------------------------------
  -- (3) Apagar la secuencia vigente. Es lo que permite cualquier permutación.
  -- ---------------------------------------------------------------------------
  -- Sin este paso, reordenar dos paradas intercambiadas chocaría con el índice
  -- único a MITAD de la sentencia siguiente, con el estado final impecable (§2).
  -- Va en sentencia PROPIA: metido en el mismo statement con CTEs modificantes,
  -- ambas mitades verían el mismo snapshot y el orden entre ellas no está
  -- definido — el índice podría ver el viejo y el nuevo valor a la vez y reventar
  -- de forma intermitente. Es la misma razón por la que la reasignación de
  -- asignar_pedidos_en_bloque son dos sentencias y no una.
  update operacion.asignaciones_pedido a
     set orden_ruta = null
   where a.tenant_id     = p_tenant_id
     and a.manifiesto_id = p_manifiesto_id
     and a.activa
     and a.orden_ruta is not null;

  get diagnostics v_limpiadas = row_count;

  -- ---------------------------------------------------------------------------
  -- (4) Escribir la secuencia nueva. La posición en el arreglo ES el orden.
  -- ---------------------------------------------------------------------------
  -- El WHERE lleva `a.tenant_id`, `a.manifiesto_id` y `a.activa`: un pedido de
  -- otro manifiesto, de otro courier, o cuya asignación ya fue superada, NO CASA
  -- CON NINGUNA FILA. No se filtra en silencio — la cuenta de abajo lo convierte
  -- en un fallo que deshace todo.
  if v_total > 0 then
    update operacion.asignaciones_pedido a
       set orden_ruta = s.orden
      from (
        select u.pedido_id, u.orden::integer as orden
          from unnest(p_pedido_ids) with ordinality as u(pedido_id, orden)
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

  -- ---------------------------------------------------------------------------
  -- (5) Cuántas paradas vivas quedaron SIN secuencia.
  -- ---------------------------------------------------------------------------
  -- No es adorno: es lo que permite a la pantalla decir "27 secuenciadas, 3 sin
  -- coordenada" en vez de dejar que el conductor descubra en la calle que tres
  -- paradas venían pegadas al final por orden alfabético.
  select count(*)::integer
    into v_sin_sec
    from operacion.asignaciones_pedido a
   where a.tenant_id     = p_tenant_id
     and a.manifiesto_id = p_manifiesto_id
     and a.activa
     and a.orden_ruta is null;

  -- ---------------------------------------------------------------------------
  -- (6) Bitácora — DENTRO de la transacción, y al final.
  -- ---------------------------------------------------------------------------
  -- ⚠️ Se aparta del patrón "bitácora ANTES del efecto" de CLAUDE.md por el mismo
  -- motivo que asignar_pedidos_en_bloque (20260814000001 §1 paso (9)): esa regla
  -- existe porque un evento Inngest o una llamada a un tercero NO SE PUEDEN
  -- DESHACER, así que la auditoría tiene que sobrevivir al fallo del paso
  -- siguiente. Aquí el efecto es puramente transaccional: si algo falla se
  -- deshace TODO, y un asiento que describa una ruta que no se aplicó
  -- contaminaría la única evidencia que hay. La atomicidad da una garantía MÁS
  -- FUERTE que el orden.
  --
  -- UN ASIENTO POR OPERACIÓN, con su `actor_usuario_id` — rutear y reordenar son
  -- acciones operativas con autor.
  --
  -- ⚠️ Y AQUÍ SÍ VIAJA LA LISTA DE PEDIDOS, a diferencia de la etapa 6, que
  -- guarda solo cifras. La diferencia no es de gusto: allí el rastro fino
  -- sobrevive en cada fila (`asignado_por_usuario_id`, `asignado_en` no se
  -- pisan nunca), mientras que aquí la secuencia anterior LA DESTRUYE la
  -- siguiente escritura. Si el asiento no la guardara, "en qué orden iba a ir el
  -- conductor cuando se cayó la entrega" sería irrecuperable diez minutos
  -- después. Son ~30 identificadores por asiento; el orden del arreglo es el
  -- orden de la ruta. No hay un solo dato personal ahí dentro.
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
      'secuencia',                  to_jsonb(p_pedido_ids)
    )
  );

  return query select v_escritas, v_sin_sec, v_limpiadas;
end;
$fn$;

comment on function operacion.aplicar_secuencia_paradas(uuid, uuid, uuid[], text, uuid) is
  'ESCRIBE LA SECUENCIA COMPLETA DE PARADAS DE UN MANIFIESTO, EN UNA TRANSACCIÓN.
   Es la única escritura de asignaciones_pedido.orden_ruta: authenticated no tiene
   privilegio sobre esa columna y EXECUTE aquí es solo para service_role.

   SIRVE PARA LOS DOS CASOS Y ES UN SOLO CAMINO: la ruta que calcula el motor y el
   reordenamiento manual del coordinador son el mismo hecho ("la secuencia de este
   manifiesto pasa a ser ésta"). Lo único que los separa es p_origen (''motor'' |
   ''manual''), que viaja al asiento de bitácora y a ningún otro sitio.

   LA POSICIÓN EN EL ARREGLO ES EL ORDEN (with ordinality, 1..N). Así una entrada
   inválida es inexpresable: no hay forma de mandar dos paradas en el mismo lugar,
   ni un hueco, ni un 0. Los repetidos y los NULL se rechazan con 22023 en vez de
   filtrarse — filtrarlos correría todas las posiciones siguientes en silencio.

   ESCRIBE EN DOS SENTENCIAS a propósito: primero apaga la secuencia vigente del
   manifiesto (todas a NULL) y después escribe la nueva. Eso es lo que permite
   CUALQUIER permutación —incluido el intercambio de dos paradas— contra un índice
   único NO diferido: el estado intermedio es todo NULL, y los NULL no colisionan.

   AISLAMIENTO: p_tenant_id por parámetro, en el WHERE de cada lectura y cada
   escritura. Un manifiesto de otro courier devuelve P0002, el mismo error que si
   no existiera. Un pedido de otro manifiesto o de otro courier no casa con
   ninguna fila y hace fallar la operación ENTERA con P0001 — nunca se escribe una
   secuencia parcial.

   Errores: 22023 (parámetros, repetidos, NULL en el arreglo) · P0002 (manifiesto
   inexistente o ajeno) · 55000 (manifiesto completado o cancelado) · P0001 (la
   lista no corresponde a las paradas activas del manifiesto). Un arreglo VACÍO SÍ
   se admite: significa "este manifiesto queda sin secuencia", y queda registrado
   en bitácora con su autor.

   Devuelve total_paradas, total_sin_secuencia (paradas activas que quedaron sin
   rutear — las que el motor no pudo ubicar) y total_previas_limpiadas.

   Concurrencia: `for update` sobre la fila del manifiesto. Dos coordinadores
   ruteando a la vez se serializan y gana el último, con una secuencia completa;
   nunca una mezcla de las dos.';


-- =============================================================================
-- 4. Privilegios de EJECUCIÓN — ningún rol de cliente
-- =============================================================================
-- Molde 20260814000001 §2. Es SECURITY DEFINER y escribe saltándose RLS: si
-- `authenticated` pudiera ejecutarla, bastaría pasar el uuid de otro courier
-- para reordenarle la ruta del día a su flota — y el asiento de auditoría
-- quedaría a nombre del courier víctima.
revoke all on function operacion.aplicar_secuencia_paradas(uuid, uuid, uuid[], text, uuid)
  from public, anon, authenticated;

grant execute on function operacion.aplicar_secuencia_paradas(uuid, uuid, uuid[], text, uuid)
  to service_role;


-- =============================================================================
-- 5. Privilegio POR COLUMNA — la función no es la única puerta si la columna
--    se puede escribir por PostgREST
-- =============================================================================
-- `operacion.asignaciones_pedido` tiene `grant select, insert, update ... to
-- authenticated` (20260601000005 §14) y la política `asignaciones_pedido_update_
-- interno` deja escribir a CUALQUIER usuario interno del tenant. Sin este
-- bloque, un `PATCH /rest/v1/asignaciones_pedido?id=eq.X` con {"orden_ruta": 1}
-- reordenaría la ruta del día sin pasar por la función, sin validar nada y SIN UN
-- SOLO ASIENTO DE BITÁCORA — incluidos los roles a los que la aplicación le
-- niega tocar la operación.
--
-- Es el patrón que en este repo ya mordió dos veces (snapshot_regla y el token
-- de invitación): LA VISTA public.* NO ES BARRERA — `Accept-Profile: operacion`
-- alcanza la tabla base directamente. Por eso el revoke/grant se hace en las DOS
-- superficies, tabla y vista.
--
-- SELECT se deja INTACTO: la secuencia no es un secreto, el conductor tiene que
-- poder leer la suya y el seller la de sus pedidos, y su RLS ya los separa. Lo
-- que se cierra es la ESCRITURA.
--
-- ⚠️ La lista de columnas es EXPLÍCITA, no derivada del catálogo. Es a propósito:
-- una lista dinámica volvería a otorgar sola cualquier columna sensible que una
-- migración futura agregue, si ésta se re-aplicara. El precio es que una columna
-- nueva nace SIN privilegio de escritura para authenticated hasta que su propia
-- migración se lo dé — falla cerrada, que es el lado correcto en el que fallar.
-- La aserción 5 de §6 lo verifica en tiempo de migración.

-- La vista se recrea ANTES de los grants: `create or replace view` conserva la
-- ACL, así que el orden inverso perdería lo que aquí se otorga. El `select *` se
-- re-expande y suma `orden_ruta` AL FINAL de la lista — que es lo único que
-- `create or replace view` admite (agregar al final, nunca quitar ni reordenar).
create or replace view public.asignaciones_pedido
  with (security_invoker = true)
  as select * from operacion.asignaciones_pedido;

comment on view public.asignaciones_pedido is
  'Espejo de operacion.asignaciones_pedido para PostgREST.
   RLS: P1 + (P2 seller OR P3 conductor).
   orden_ruta es LEGIBLE por esta vista pero NO escribible: el privilegio de
   INSERT/UPDATE sobre esa columna está revocado a authenticated en la vista y en
   la tabla base. La secuencia se escribe solo por
   operacion.aplicar_secuencia_paradas.';

revoke insert, update on operacion.asignaciones_pedido from authenticated;
revoke insert, update on public.asignaciones_pedido    from authenticated;

grant insert (id, tenant_id, pedido_id, manifiesto_id, driver_id, seller_id,
              activa, asignado_por_usuario_id, asignado_en, desasignado_en),
      update (id, tenant_id, pedido_id, manifiesto_id, driver_id, seller_id,
              activa, asignado_por_usuario_id, asignado_en, desasignado_en)
  on operacion.asignaciones_pedido to authenticated;

grant insert (id, tenant_id, pedido_id, manifiesto_id, driver_id, seller_id,
              activa, asignado_por_usuario_id, asignado_en, desasignado_en),
      update (id, tenant_id, pedido_id, manifiesto_id, driver_id, seller_id,
              activa, asignado_por_usuario_id, asignado_en, desasignado_en)
  on public.asignaciones_pedido to authenticated;

-- service_role conserva todo (BYPASSRLS no reemplaza al GRANT). Se repone
-- explícitamente porque el `revoke` de arriba es por rol y no lo toca, pero
-- dejarlo escrito evita que una lectura apurada concluya lo contrario.
grant select, insert, update, delete on operacion.asignaciones_pedido to service_role;


-- =============================================================================
-- 6. Aserciones defensivas — la migración ABORTA si algo no quedó en pie
-- =============================================================================
-- No altera nada: inspecciona el catálogo y falla ruidosamente. Todo lo que
-- revisa fallaría tarde y en silencio — que es peor que fallar aquí.
do $$
declare
  v_fn constant text := 'operacion.aplicar_secuencia_paradas(uuid,uuid,uuid[],text,uuid)';
  v_col text;
begin
  -- 6.1 La función existe.
  if to_regprocedure(v_fn) is null then
    raise exception
      'No existe la función %. Sin ella la secuencia de paradas no tiene escritura transaccional y volveríamos al orden alfabético recalculado en cada render.', v_fn;
  end if;

  -- 6.2 SECURITY DEFINER. Sin él se evalúa con los privilegios del invocador:
  --     service_role seguiría funcionando (BYPASSRLS) y la divergencia pasaría
  --     inadvertida hasta que la llamara cualquier otro rol.
  if not exists (select 1 from pg_proc where oid = to_regprocedure(v_fn)::oid and prosecdef) then
    raise exception
      'La función % no es SECURITY DEFINER. Su contrato es escribir sin RLS con el aislamiento impuesto por p_tenant_id.', v_fn;
  end if;

  -- 6.3 Ningún rol de cliente conserva EXECUTE. Se mide con
  --     has_function_privilege (privilegio EFECTIVO, incluido el heredado por
  --     PUBLIC), no contando GRANTs.
  if has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception
      'authenticated conserva EXECUTE sobre %. Escribe sin RLS: bastaría pasar el uuid de otro courier para reordenarle la ruta del día.', v_fn;
  end if;

  if has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'anon conserva EXECUTE sobre %. Escribe sin RLS.', v_fn;
  end if;

  -- 6.4 Control positivo: el revoke no dejó la función inservible para quien sí
  --     debe llamarla. Sin esto, un revoke de más pasaría por "seguro" y la
  --     pantalla de ruteo quedaría muerta en producción.
  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception
      'service_role NO puede ejecutar %. El revoke se pasó de largo.', v_fn;
  end if;

  -- 6.5 EL PRIVILEGIO POR COLUMNA, en sus dos mitades.
  --     (a) Negativo: authenticated no escribe orden_ruta, ni por la tabla ni por
  --         la vista. Si esto se pierde, la función deja de ser la única puerta y
  --         cualquier interno reordena la ruta con un PATCH, sin bitácora.
  if has_column_privilege('authenticated', 'operacion.asignaciones_pedido', 'orden_ruta', 'UPDATE')
     or has_column_privilege('authenticated', 'operacion.asignaciones_pedido', 'orden_ruta', 'INSERT') then
    raise exception
      'authenticated conserva INSERT/UPDATE sobre operacion.asignaciones_pedido.orden_ruta. La secuencia se podría reescribir por PostgREST sin validación y sin un solo asiento de auditoría.';
  end if;

  if has_column_privilege('authenticated', 'public.asignaciones_pedido', 'orden_ruta', 'UPDATE')
     or has_column_privilege('authenticated', 'public.asignaciones_pedido', 'orden_ruta', 'INSERT') then
    raise exception
      'authenticated conserva INSERT/UPDATE sobre public.asignaciones_pedido.orden_ruta. La vista NO es barrera por sí sola: hace falta el grant por columna en las dos superficies.';
  end if;

  --     (b) Positivo: NINGUNA otra columna perdió la escritura. Un revoke de más
  --         rompería en silencio cualquier camino que todavía escriba con sesión
  --         de usuario, y el síntoma sería un 42501 en producción. Si una
  --         migración futura agrega una columna y re-aplica ésta, esta aserción
  --         es la que grita.
  for v_col in
    select a.attname
      from pg_attribute a
     where a.attrelid = 'operacion.asignaciones_pedido'::regclass
       and a.attnum > 0
       and not a.attisdropped
       and a.attname <> 'orden_ruta'
  loop
    if not has_column_privilege('authenticated', 'operacion.asignaciones_pedido', v_col, 'UPDATE') then
      raise exception
        'authenticated PERDIÓ el UPDATE sobre operacion.asignaciones_pedido.%. El revoke por columna se pasó de largo: solo orden_ruta debía quedar fuera.', v_col;
    end if;
  end loop;

  --     (c) Control de que la lectura sigue abierta. La secuencia no es un
  --         secreto y las tres pantallas la necesitan; cerrarla por error dejaría
  --         al conductor sin ruta.
  if not has_column_privilege('authenticated', 'operacion.asignaciones_pedido', 'orden_ruta', 'SELECT') then
    raise exception
      'authenticated no puede LEER orden_ruta. La secuencia tiene que ser legible: su confidencialidad la resuelve la RLS de la tabla, no la ausencia de grant.';
  end if;

  -- 6.6 El índice único parcial. Es la red que impide dos paradas en el mismo
  --     lugar. Se exige PARCIAL (indpred not null): uno TOTAL bloquearía el lugar
  --     con las filas históricas inactivas y la ruta siguiente fallaría contra un
  --     fantasma.
  if not exists (
    select 1 from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'operacion'
      and t.relname = 'asignaciones_pedido'
      and c.relname = 'idx_asignaciones_secuencia_manifiesto_uk'
      and i.indisunique
      and i.indpred is not null
  ) then
    raise exception
      'Falta el índice único PARCIAL idx_asignaciones_secuencia_manifiesto_uk sobre (manifiesto_id, orden_ruta) where activa. Sin él, dos paradas podrían ocupar el mismo lugar del manifiesto y el conductor vería una ruta con un número repetido y otro faltante.';
  end if;

  -- 6.7 El asiento de bitácora tiene que poder escribirse: la tabla es
  --     append-only con FORCE RLS y sin política de INSERT (20260101000004 §4 +
  --     20260811000001), así que el único camino es el privilegio del DEFINER
  --     (dueño) más BYPASSRLS. Si faltara una de las dos mitades, la operación
  --     entera fallaría en caliente, no aquí.
  if not has_table_privilege(current_user, 'identidad.bitacora_auditoria', 'INSERT') then
    raise exception
      'El dueño de aplicar_secuencia_paradas (%) no puede INSERTAR en identidad.bitacora_auditoria. El asiento fallaría y con él la aplicación de la secuencia.', current_user;
  end if;

  if not exists (select 1 from pg_roles where rolname = current_user and rolbypassrls) then
    raise exception
      'El dueño de aplicar_secuencia_paradas (%) no tiene BYPASSRLS. identidad.bitacora_auditoria tiene FORCE RLS y ninguna política de INSERT.', current_user;
  end if;
end $$;


-- =============================================================================
-- 7. Handoff (NO se implementa aquí — solo se documenta)
-- =============================================================================
--
--    `backend`
--      · Llamar SIEMPRE por RPC con service_role, vía el envoltorio
--        `src/modules/operacion/secuencia-paradas-rpc.ts`:
--          aplicarSecuenciaParadasRpc(cliente, { tenantId, manifiestoId,
--            pedidoIdsEnOrden, origen, actorUsuarioId })
--        La capacidad RBAC se valida ANTES, en la Server Action: la función no la
--        conoce ni debe conocerla.
--      · El motor (`operacion/ruteo/calcularRuta`) devuelve
--        `secuencia: {pedidoId, orden}[]` y `sinUbicar`. El envoltorio trae
--        `pedidoIdsDesdeSecuencia` para convertir lo primero en el arreglo
--        ordenado que espera esta función. Las de `sinUbicar` NO se mandan: su
--        sitio es quedarse en NULL.
--
--    `frontend` (pendiente — esta etapa es solo base de datos y escritura)
--      · La pantalla de reordenamiento manual manda la lista COMPLETA de paradas
--        del manifiesto en el orden final, no un delta. La función no acepta
--        parches parciales a propósito.
--      · `total_sin_secuencia` es lo que permite decir "27 secuenciadas · 3 sin
--        coordenada" en vez de dejar que el conductor lo descubra en la calle.
--      · P0001 significa "la asignación cambió mientras ordenabas": el mensaje
--        correcto es pedir recargar, no reintentar a ciegas.
--
--    `qa`
--      · La prueba vive en
--        supabase/tests/database/rls_aislamiento_secuencia_paradas.test.sql.
-- =============================================================================
