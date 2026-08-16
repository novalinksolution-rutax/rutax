-- =============================================================================
-- Shopify entra como fuente · PARTE 2 de 2 — la columna `fuente` en pedidos
-- =============================================================================
-- REQUIERE 20260816000003_operacion_fuente_valores_enum.sql aplicada ANTES, en
-- su propia transacción. El porqué está escrito allá: Postgres no deja usar un
-- valor de enum en la misma transacción que lo creó, y el backfill de esta
-- migración usa 'ml_flex' y 'rutax_manual'. No fusionar los dos archivos.
--
-- QUÉ HACE, en orden:
--   1. `operacion.pedidos.fuente` — nullable → backfill determinista → not null.
--      SIN DEFAULT, a propósito (§1).
--   2. `id_externo` y `referencia_externa` — el id y el nombre visible del
--      pedido en la fuente.
--   3. Índice único parcial de idempotencia por fuente. `pedidos_ml_shipment_uk`
--      NO se toca: Flex conserva su llave probada (§3).
--   4. Comentarios de columna.
--   5. Re-emisión de la vista `public.pedidos` (una vista NO hereda columnas
--      nuevas sola).
--   6. Grants — verificados: en pedidos son de TABLA COMPLETA, no por columna.
--   7. Reexpresión del trigger `trg_pruebas_entrega_solo_same_day`: la frontera
--      dura del POD pasa de `tipo_pedido = 'same_day'` a `fuente <> 'ml_flex'`
--      (§7). Sin esto, TODO POD de Shopify sería rechazado por la base.
--
-- IDEMPOTENTE: `add column if not exists`, backfill acotado a `fuente is null`,
-- `create unique index if not exists`, `create or replace view/function`,
-- `drop trigger if exists` + `create trigger`, grants declarativos.
-- Re-aplicable sobre una base ya migrada cuantas veces sea.
--
-- ALCANCE: SOLO esquema de `operacion.pedidos` y el trigger del POD. NO crea
-- ninguna política RLS nueva (§RLS), no toca la máquina de estados, no toca el
-- motor de dinero y no crea la tabla de conexiones Shopify.
-- =============================================================================

-- =============================================================================
-- 1. La columna `fuente`
-- =============================================================================
-- ⚠️ SIN DEFAULT, Y ESO ES LA DECISIÓN MÁS IMPORTANTE DEL ARCHIVO.
--
-- Un default aquí sería cómodo y estaría MAL. El orden de un despliegue no está
-- garantizado: la migración puede quedar aplicada minutos u horas antes de que
-- salga el código que escribe la columna. En esa ventana:
--
--   · CON default (p. ej. 'ml_flex'): cada pedido que ingesta el sistema queda
--     grabado con una procedencia INVENTADA. No falla nada, nadie se entera, y
--     la mentira es permanente — la fila queda escrita y ya no se sabe cuál era
--     su fuente real. Y la procedencia gobierna quién es dueño del POD y qué
--     tarifa aplica, así que el daño desemboca en dinero.
--
--   · SIN default: el INSERT muere con 23502 (not_null_violation) dentro de un
--     job de Inngest, que tiene reintentos y telemetría (`infra.ejecuciones_job`)
--     y deja el fallo a la vista con su mensaje. Ruidoso, reversible, y no
--     escribe ni una fila equivocada.
--
-- Este proyecto ya se quemó varias veces con fallas MUDAS (el backfill que
-- reportaba "completado, 0"; la columna de monto al conductor que nadie escribía
-- y liquidaba $0 en producción). Entre "falla ruidosa" y "dato equivocado en
-- silencio", acá se elige siempre la primera.
--
-- Consecuencia asumida y explícita: TODO escritor de operacion.pedidos debe
-- mandar `fuente`. Eso incluye los seeds (supabase/seed.sql, seed-demo-full.sql,
-- seed-torre-hoy.sql), que se actualizaron junto con esta migración.
alter table operacion.pedidos
  add column if not exists fuente operacion.fuente_pedido;

-- Defensa por si una re-aplicación anterior (o una mano suelta) le hubiera
-- puesto un default: se lo quita antes de seguir. `drop default` sobre una
-- columna sin default es un no-op.
alter table operacion.pedidos
  alter column fuente drop default;

-- -----------------------------------------------------------------------------
-- Backfill determinista, sin ninguna heurística.
--
-- El mapa es exacto porque hasta hoy solo existían dos procedencias y cada una
-- tenía exactamente un `tipo_pedido`:
--     tipo_pedido = 'flex'     → fuente = 'ml_flex'      (vino de la API de ML)
--     tipo_pedido = 'same_day' → fuente = 'rutax_manual' (lo creó un interno)
--
-- Se evaluó derivar la fuente de `origen` (ml_ingesta/backfill vs.
-- same_day_manual) y se DESCARTÓ: `origen` nunca se comparó en código, así que
-- nadie garantiza que sea consistente en las filas históricas, mientras que
-- `tipo_pedido` sí gobierna lógica viva (tarifas, POD) y por lo tanto está
-- vigilado. Se backfillea desde la columna que la operación mantuvo honesta.
--
-- El `where fuente is null` es lo que lo hace idempotente y, además, seguro:
-- re-aplicar la migración cuando ya existan pedidos Shopify NO los reescribe.
-- Si tocara filas sin ese filtro, cada re-aplicación convertiría todo pedido
-- Shopify en 'rutax_manual' (porque su tipo_pedido es 'same_day') y le cambiaría
-- la procedencia a la operación en marcha.
update operacion.pedidos
   set fuente = case tipo_pedido
                  when 'flex'     then 'ml_flex'::operacion.fuente_pedido
                  when 'same_day' then 'rutax_manual'::operacion.fuente_pedido
                end
 where fuente is null;

-- Si `tipo_pedido` ganara un valor nuevo sin actualizar el CASE de arriba, el
-- backfill dejaría NULLs y este ALTER fallaría con 23502 al aplicar la
-- migración — que es exactamente el momento en que uno quiere enterarse.
alter table operacion.pedidos
  alter column fuente set not null;

-- =============================================================================
-- 2. Identificadores del pedido EN LA FUENTE
-- =============================================================================
-- Dos columnas y no una, porque son dos cosas distintas y confundirlas ya sería
-- un bug: el id con el que se habla con la API no es el número que el humano ve.
--
--   · id_externo         → la llave técnica en la fuente. En Shopify es el id
--                          numérico del order (p. ej. '5123456789012'). Es lo
--                          que hace idempotente la ingesta (§3).
--   · referencia_externa → el nombre VISIBLE, el que el seller y el courier
--                          leen y buscan. En Shopify es el `name` del order
--                          (p. ej. '#1001'). No es único entre tiendas y NO
--                          sirve como llave: es para mostrar y para buscar.
--
-- Ambas nullable: las filas históricas (Flex y same-day) no las tienen, y Flex
-- seguirá identificándose por `ml_shipment_id` (§3).
alter table operacion.pedidos
  add column if not exists id_externo text;

alter table operacion.pedidos
  add column if not exists referencia_externa text;

-- =============================================================================
-- 3. Idempotencia de ingesta por fuente — índice único PARCIAL
-- =============================================================================
-- La ingesta de cualquier fuente reintenta (jobs con reintentos, webhooks que se
-- repiten, barridos que se solapan). Sin una llave de idempotencia, el segundo
-- pase duplica el pedido — y un pedido duplicado en este sistema es una línea de
-- cobro duplicada al seller y una línea de liquidación duplicada al conductor.
--
-- `tenant_id` va primero: la unicidad es POR COURIER, nunca global. Dos couriers
-- distintos pueden perfectamente atender la misma tienda Shopify.
--
-- PARCIAL (`where id_externo is not null`) porque toda la historia previa tiene
-- la columna en NULL. En Postgres los NULL no chocan entre sí en un índice
-- único, así que el parcial no es estrictamente necesario para la corrección —
-- pero mantiene el índice del tamaño de lo que de verdad indexa (los pedidos de
-- fuentes con id externo) en vez de arrastrar cientos de miles de entradas
-- muertas en la tabla más caliente del sistema.
--
-- ⚠️ `pedidos_ml_shipment_uk` NO SE TOCA. Es la llave de idempotencia de Flex,
-- probada en producción con datos reales: el upsert del backfill y del cron van
-- por `(tenant_id, ml_shipment_id)`. Migrar a Flex a esta llave nueva sería
-- reescribir el camino de ingesta que hoy funciona, para no ganar nada. Las dos
-- llaves conviven: Flex por shipment, el resto por (fuente, id_externo).
create unique index if not exists pedidos_fuente_id_externo_uk
  on operacion.pedidos (tenant_id, fuente, id_externo)
  where id_externo is not null;

-- =============================================================================
-- 4. Comentarios de columna
-- =============================================================================
comment on column operacion.pedidos.fuente is
  'DE DÓNDE VIENE el pedido — eje AUTORITATIVO de procedencia desde 2026-08-16.
   NO confundir con `tipo_pedido`, que desde este cambio significa SOLO régimen
   operativo y clave de tarifa (un pedido Shopify es tipo_pedido = same_day y
   fuente = shopify). NO confundir con `origen`, que es telemetría del modo de
   descubrimiento y no se compara en código.
   Gobierna quién es dueño del POD: con fuente = ml_flex el POD lo tiene la app
   de Mercado Envíos y la base RECHAZA un POD propio (trigger
   trg_pruebas_entrega_solo_same_day); con cualquier otra fuente el POD
   capturado en Rutax es el autoritativo.
   NOT NULL y SIN DEFAULT a propósito: si el código que la escribe no está
   desplegado, la ingesta debe fallar con 23502 dentro de un job con reintentos
   y telemetría, en vez de grabar una procedencia inventada en silencio.
   Backfill de esta migración: flex → ml_flex, same_day → rutax_manual.';

comment on column operacion.pedidos.id_externo is
  'Id del pedido EN LA FUENTE — llave técnica, la que se usa contra su API.
   En Shopify es el id numérico del order. Llave de idempotencia de la ingesta
   junto con (tenant_id, fuente): índice pedidos_fuente_id_externo_uk.
   NULL en Flex y en el same-day manual: Flex conserva su llave probada
   pedidos_ml_shipment_uk y el same-day manual no viene de ninguna fuente
   externa. No mostrar en interfaz — para el humano está referencia_externa.';

comment on column operacion.pedidos.referencia_externa is
  'El nombre VISIBLE del pedido en su fuente, el que el seller y el courier leen
   y buscan (en Shopify, el `name` del order: #1001). Es de PRESENTACIÓN: no es
   único entre tiendas ni entre sellers y NO sirve como llave de idempotencia —
   esa es id_externo. NULL en Flex y en el same-day manual.';

-- =============================================================================
-- 5. Re-emitir la vista public.pedidos
-- =============================================================================
-- Es `select *`, pero una vista NO se actualiza sola cuando cambia la tabla
-- base: sin este `create or replace`, PostgREST seguiría sirviendo la lista de
-- columnas congelada en la última emisión y las tres columnas nuevas serían
-- invisibles para toda la aplicación. Mismo patrón que 20260812000002 §6,
-- 20260811000003, 20260702000001 y 20260630000001.
--
-- `security_invoker = true` se conserva: sin él la vista sería un bypass de RLS
-- (la evaluaría postgres, que tiene rolbypassrls).
create or replace view public.pedidos
  with (security_invoker = true)
  as select * from operacion.pedidos;

comment on view public.pedidos is
  'Espejo de operacion.pedidos para PostgREST. RLS heredada de la tabla base
   (security_invoker = true): P1 tenant + P2 seller + P3 conductor. Incluye
   fuente, id_externo y referencia_externa heredando esas mismas políticas: el
   seller las ve en SUS pedidos, el conductor solo en los asignados a él, y
   ninguno de los dos puede escribirlas (guard trg_pedidos_solo_interno_edita).';

-- =============================================================================
-- 6. GRANTS — verificado: en pedidos son de TABLA COMPLETA, no por columna
-- =============================================================================
-- Se revisó explícitamente antes de escribir esto, porque el repo ya fue mordido
-- DOS veces por el patrón inverso (dinero.lineas_*.snapshot_regla y el token de
-- invitación): una vista `public.*` restringida no es barrera cuando el GRANT
-- subyacente es de tabla completa, porque config.toml expone el esquema
-- `operacion` directamente por PostgREST (`Accept-Profile: operacion`).
--
-- Hallazgo: `operacion.pedidos` y `public.pedidos` NO tienen ningún grant por
-- columna. Todos los grants del historial (20260601000005 §14, 20260613000003,
-- 20260613000004, 20260613000008, 20260702000001, 20260811000003, 20260812000002)
-- son `grant select, insert, update on <tabla>`. Por lo tanto las tres columnas
-- nuevas quedan cubiertas automáticamente y NO hay que enumerarlas en ningún
-- lado. Enumerarlas sería el error en la otra dirección: convertir el grant en
-- una lista por columna significa que la PRÓXIMA columna que alguien agregue
-- nace invisible y falla en silencio.
--
-- ¿Y está bien que `authenticated` tenga privilegio de lectura sobre ellas?
-- Sí, y la razón importa: public.pedidos es `select *`, así que no hay nada que
-- la vista oculte y el grant delate; y ninguna de las tres es un secreto —
-- `fuente` es un hecho de procedencia, `id_externo` un id de order en la API del
-- seller y `referencia_externa` un número de pedido que el propio seller ya ve
-- en su tienda. Ninguna es credencial-símil (eso es el string del QR de Flex, que
-- vive en la tabla de escaneos con GRANT por columna, y el token Admin de
-- Shopify, que va cifrado en identidad.secretos_cifrados). La barrera de
-- confidencialidad acá es la RLS DE FILA, no el privilegio.
--
-- Los grants se RE-AFIRMAN porque la vista se re-emitió (un `create or replace
-- view` conserva la ACL, pero declararla es más barato que depender de eso).
grant select, insert, update on operacion.pedidos to authenticated;
grant select, insert, update on public.pedidos    to authenticated;

grant select, insert, update, delete on operacion.pedidos to service_role;
grant select, insert, update, delete on public.pedidos    to service_role;

-- =============================================================================
-- RLS — NO se agrega ninguna política, y es decisión, no olvido
-- =============================================================================
-- Las tres columnas viajan en la misma fila que el destinatario y quedan
-- cubiertas tal cual por `pedidos_select` (P1 tenant + P2 seller + P3 conductor)
-- y por `pedidos_update_interno` + el guard `trg_pedidos_solo_interno_edita`:
--   · Interno del courier → ve y escribe las de SU tenant. Es su operación.
--   · Seller              → ve las de SUS pedidos. Correcto: la fuente y el
--                           número visible son de su propio pedido. NO puede
--                           escribirlas (42501 del guard), así que no puede
--                           cambiarle la procedencia a un pedido y con ella el
--                           régimen de POD y de tarifa.
--   · Conductor           → solo las de los pedidos asignados a él.
--   · anon                → nada: no tiene grant sobre pedidos.
-- Se prueba en supabase/tests/database/rls_pedidos_fuente.test.sql.

-- =============================================================================
-- 7. FRONTERA DURA DEL POD — reexpresada sobre `fuente`
-- =============================================================================
-- La regla de producto NO cambia: "el POD capturado en Rutax solo es
-- autoritativo cuando NO hay una app externa obligatoria dueña de la prueba de
-- entrega". Lo que cambia es CÓMO se expresa, porque el predicado viejo dejó de
-- ser equivalente a la regla.
--
--   ANTES:  tipo_pedido = 'same_day'   (definido en 20260613000008 §5)
--   AHORA:  fuente     <> 'ml_flex'
--
-- Eran lo mismo mientras solo existían Flex y same-day. Con Shopify dejan de
-- serlo en la dirección que rompe: un pedido Shopify es `tipo_pedido =
-- 'same_day'`, así que el predicado viejo lo aceptaría... pero solo por
-- coincidencia, y cualquier fuente futura con régimen 'flex' quedaría bloqueada
-- sin motivo. Expresarlo sobre `fuente` lo ata a lo que la regla de verdad dice:
-- el dueño del POD depende de DE DÓNDE VIENE el pedido, no de su régimen
-- operativo ni de su tarifa.
--
-- ⚠️ ES LA MITAD EN BASE de la misma regla que en TypeScript se llama
-- `podEsAutoritativoEnRutax`. Las dos mitades tienen que decir lo mismo. Si esta
-- no se cambia, TODO POD de Shopify muere con 23514 y la app del conductor no
-- puede cerrar una sola parada de esa fuente.
--
-- Se conservan a propósito el NOMBRE de la función y el del trigger
-- (`pruebas_entrega_solo_same_day` / `trg_pruebas_entrega_solo_same_day`):
-- renombrarlos obligaría a tocar las pruebas pgTAP existentes que los nombran
-- (rls_aislamiento_pod_tracking, rls_aislamiento_pod_y_ubicacion) y a rastrear
-- referencias por todo el repo, sin ganar nada funcional. El nombre quedó
-- histórico; el comentario y el mensaje de error dicen la verdad.
create or replace function operacion.pruebas_entrega_solo_same_day()
returns trigger
language plpgsql
as $$
declare
  fuente_del_pedido operacion.fuente_pedido;
begin
  select fuente into fuente_del_pedido
  from operacion.pedidos
  where id = new.pedido_id;

  -- `fuente` es NOT NULL, así que "no encontrado" es la única forma de que
  -- quede nula. Se usa NOT FOUND para que el diagnóstico no dependa de eso.
  if not found then
    raise exception 'pruebas_entrega: pedido_id % no existe', new.pedido_id
      using errcode = '23503'; -- foreign_key_violation
  end if;

  if fuente_del_pedido = 'ml_flex' then
    raise exception
      'pruebas_entrega: el POD/tracking propio solo es autoritativo cuando la fuente NO es ml_flex; el pedido % tiene fuente % — en Mercado Libre Flex manda la app de Mercado Envíos (obligatoria, no integrable) y este software NUNCA la reemplaza',
      new.pedido_id, fuente_del_pedido
      using errcode = '23514'; -- check_violation
  end if;

  return new;
end;
$$;

comment on function operacion.pruebas_entrega_solo_same_day() is
  'FRONTERA DURA (nombre histórico: hoy la regla NO es sobre same_day). Trigger
   BEFORE INSERT OR UPDATE en pruebas_entrega que RECHAZA con 23514 cualquier POD
   contra un pedido con `fuente = ml_flex`. En Flex gobierna la app obligatoria
   de Mercado Envíos; Rutax orquesta alrededor y NUNCA la reemplaza. Para
   rutax_manual y shopify el POD capturado en Rutax SÍ es el autoritativo y es el
   que dispara la línea entrega→dinero.
   Es la mitad en base de `podEsAutoritativoEnRutax` en TypeScript: las dos
   mitades tienen que decir lo mismo. Barrera de último recurso aunque el backend
   se equivoque.';

drop trigger if exists trg_pruebas_entrega_solo_same_day on operacion.pruebas_entrega;
create trigger trg_pruebas_entrega_solo_same_day
  before insert or update on operacion.pruebas_entrega
  for each row execute function operacion.pruebas_entrega_solo_same_day();

-- =============================================================================
-- 8. Verificación defensiva: aborta con un error legible si algo quedó a medias
--    o si una barrera de la que depende esta feature ya no está en pie.
--    Mismo patrón que 20260812000002 §8, 20260811000002 §3–§4.
-- =============================================================================
do $$
declare
  v_default text;
begin
  -- 8.1 SIN DEFAULT. Es la mitad ruidosa de la decisión del §1: si alguien le
  --     pone un default "para que no falle el deploy", la ingesta empieza a
  --     grabar procedencias inventadas en silencio y no hay vuelta atrás.
  select pg_get_expr(d.adbin, d.adrelid) into v_default
    from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'operacion.pedidos'::regclass
     and a.attname = 'fuente';

  if v_default is not null then
    raise exception
      'operacion.pedidos.fuente quedó con DEFAULT (%). Debe NO tener default: si el código que la escribe no está desplegado, la ingesta tiene que fallar con 23502 en un job con reintentos, no grabar una procedencia inventada.', v_default;
  end if;

  -- 8.2 NOT NULL. Sin esto, una fila puede nacer sin procedencia y el motor de
  --     dinero no sabría de quién es el POD ni qué tarifa aplica.
  if not exists (
    select 1 from pg_attribute
     where attrelid = 'operacion.pedidos'::regclass
       and attname  = 'fuente'
       and attnotnull
  ) then
    raise exception 'operacion.pedidos.fuente no quedó NOT NULL.';
  end if;

  -- 8.3 El backfill no dejó ninguna fila sin procedencia. Redundante con el
  --     `set not null` de arriba, pero explícito: si esto falla, el mensaje dice
  --     QUÉ pasó en vez de un 23502 pelado.
  if exists (select 1 from operacion.pedidos where fuente is null) then
    raise exception 'El backfill de operacion.pedidos.fuente dejó filas en NULL.';
  end if;

  -- 8.4 La llave de idempotencia de Flex sigue en pie. Si desapareciera, la
  --     ingesta de ML duplicaría pedidos y con ellos las líneas de cobro.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'operacion.pedidos'::regclass
       and conname  = 'pedidos_ml_shipment_uk'
  ) then
    raise exception
      'Desapareció pedidos_ml_shipment_uk. Es la llave de idempotencia PROBADA de la ingesta Flex; sin ella el cron duplica pedidos y el motor duplica cobros.';
  end if;

  -- 8.5 El índice nuevo existe y es ÚNICO. Un índice no-único acá no protege de
  --     nada y el duplicado aparecería recién como cobro doble.
  if not exists (
    select 1 from pg_class c
     where c.relname = 'pedidos_fuente_id_externo_uk'
       and c.relkind = 'i'
       and exists (select 1 from pg_index i where i.indexrelid = c.oid and i.indisunique)
  ) then
    raise exception
      'Falta el índice ÚNICO pedidos_fuente_id_externo_uk. Es la idempotencia de la ingesta de fuentes con id externo.';
  end if;

  -- 8.6 El trigger del POD sigue instalado tras el drop/create del §7. Si
  --     faltara, la base aceptaría un POD propio contra un pedido Flex y Rutax
  --     estaría compitiendo con la app de Mercado Envíos por la verdad.
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'operacion' and c.relname = 'pruebas_entrega'
      and t.tgname = 'trg_pruebas_entrega_solo_same_day'
      and not t.tgisinternal
  ) then
    raise exception
      'Falta el trigger trg_pruebas_entrega_solo_same_day. Es la frontera dura del POD: sin él la base acepta un POD propio contra un pedido de Mercado Libre Flex.';
  end if;

  -- 8.7 RLS activa y FORZADA sigue en pie (force cubre también al dueño).
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'operacion' and c.relname = 'pedidos'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception
      'operacion.pedidos no tiene RLS enable + force. Sin RLS forzada no hay aislamiento que valga sobre las columnas nuevas.';
  end if;

  -- 8.8 El grant de tabla completa SÍ alcanzó a las tres columnas nuevas (§6).
  --     Es la comprobación que faltó las dos veces que este patrón mordió: se
  --     MIDE, no se supone.
  if not (
    select bool_and(has_column_privilege('authenticated', 'operacion.pedidos', col, 'SELECT'))
      from unnest(array['fuente', 'id_externo', 'referencia_externa']) as col
  ) then
    raise exception
      'authenticated no tiene SELECT sobre alguna de las columnas nuevas: el grant dejó de ser de tabla completa y la columna sería invisible por PostgREST sin decir por qué.';
  end if;

  -- 8.9 …y `anon` sigue SIN ver nada. La otra dirección del mismo chequeo.
  if (
    select bool_or(has_column_privilege('anon', 'public.pedidos', col, 'SELECT'))
      from unnest(array['fuente', 'id_externo', 'referencia_externa']) as col
  ) then
    raise exception
      'anon (sesión NO autenticada) tiene SELECT sobre alguna columna nueva de public.pedidos.';
  end if;
end $$;

-- =============================================================================
-- 9. Handoff (NO se implementa aquí — solo se documenta)
--
--    `backend` / `integraciones`
--      · TODO escritor de operacion.pedidos debe mandar `fuente`: no hay
--        default y el INSERT falla con 23502. Es intencional (§1).
--      · La mitad TypeScript de la frontera del POD se llama
--        `podEsAutoritativoEnRutax` y debe decir exactamente `fuente !==
--        'ml_flex'`, igual que el trigger del §7. Si las dos mitades divergen,
--        el síntoma es un 23514 desde un job y nadie sabrá por qué.
--      · La ingesta Shopify hace upsert por `(tenant_id, fuente, id_externo)`.
--        ⚠️ Regla del repo: en un upsert de PostgREST, TODA columna del payload
--        es también una escritura en el UPDATE. `estado`, `origen`, `fuente` y
--        `situacion_retiro` NO deben viajar en el payload de un re-pase, o el
--        barrido devuelve a la bandeja pedidos que ya están en ruta.
--      · El token Admin de Shopify va cifrado en identidad.secretos_cifrados con
--        tipo_secreto = 'token_admin_shopify' (valor creado en 20260816000003).
--        Nunca en una tabla de negocio, nunca en logs, nunca en una URL.
--
--    `frontend`
--      · Lo que se muestra al humano es `referencia_externa` (#1001), no
--        `id_externo`.
--
--    `qa`
--      · La prueba de esquema y aislamiento es
--        supabase/tests/database/rls_pedidos_fuente.test.sql.
--      · Los tres seeds ya escriben `fuente`; si alguien agrega un seed nuevo y
--        lo olvida, el `db reset` falla con 23502 y el mensaje lo dice.
-- =============================================================================
