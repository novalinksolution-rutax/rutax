-- =============================================================================
-- Operación · pedidos: situación de retiro (¿el bulto está en poder del courier?)
-- =============================================================================
-- CONTEXTO: docs/arquitectura/retiro-y-ruteo.md §2.1 (el escaneo define el día),
-- §6 (el dinero), §13bis-1.3 (la compuerta) y §13bis-Decisiones de cierre
-- (retención del `no procesado`). Plan de ejecución:
-- docs/arquitectura/retiro-y-ruteo-plan.md, etapa 1, punto 7.
--
-- =============================================================================
-- POR QUÉ EXISTE — es una reja de dinero, no un flag de conveniencia
-- =============================================================================
-- Un seller puede despachar con VARIOS couriers. Por lo tanto los pedidos que
-- Rutax ingesta desde la cuenta de Mercado Libre del seller **no son todos de
-- este courier**: la ingesta trae el universo de CANDIDATOS, y lo que decide
-- cuáles son suyos ese día es el ESCANEO del conductor en la bodega.
--
-- Sin este campo, la pantalla de asignación ofrece candidatos ajenos; desde
-- `asignado` la máquina de estados permite `en_ruta → entregado`, ML reporta
-- ambos eventos, y el motor entrega→dinero emite **cobro al seller con tarifa,
-- período y DTE por entregas que hizo otro courier**. Esa es la mecha que
-- describe §13bis-1.3 del alcance, y este campo es la compuerta.
--
-- =============================================================================
-- EJE PROPIO — separado de `estado` y de `estado_ml`, a propósito
-- =============================================================================
-- `estado` es la máquina de estados operativa de Rutax y `estado_ml` es el
-- espejo de lo que reporta Mercado Libre. En Flex el ciclo del envío lo gobierna
-- ML: meterle un valor propio a `operacion.estado_pedido` chocaría con la
-- sincronización (el polling y el webhook escriben ahí) y obligaría a enseñarle
-- el estado nuevo a `maquina-estados.ts`, al motor de dinero y a los detectores
-- de conciliación. `situacion_retiro` es una dimensión ORTOGONAL que convive con
-- las otras dos y no toca ninguna:
--
--   estado = 'pendiente_asignacion' + situacion_retiro = 'pendiente'   → candidato ajeno o aún no retirado
--   estado = 'pendiente_asignacion' + situacion_retiro = 'retirado'    → EN PODER DEL COURIER, asignable
--   estado = 'en_ruta'              + situacion_retiro = 'retirado'    → normal
--   estado = 'cancelado'            + situacion_retiro = 'retirado'    → ML canceló con el bulto en la van (§Decisión 6)
--
-- Los tres valores:
--   · pendiente     → ingestado, nadie lo tocó. Es el DEFAULT de toda fila nueva.
--   · retirado      → un conductor lo escaneó en una bodega; está en poder del courier.
--   · no_procesado  → pasaron los días y nunca se retiró (lo despachó otro courier).
--                     Se archiva a los 7 días y se despersonaliza a los 30 (etapa 10);
--                     esta migración solo declara el valor, no construye la retención.
--
-- Aplica a TODAS las fuentes, no solo a Flex. En same-day la etiqueta con QR la
-- genera Rutax (`codigo_interno`), pero el bulto igual está en la bodega del
-- seller y el conductor lo escanea en la misma visita (alcance §8: "todas las
-- fuentes por el mismo flujo"). Por eso NO hay excepción por `tipo_pedido`.
--
-- =============================================================================
-- ENUM NATIVO Y NO `text` + CHECK — el porqué
-- =============================================================================
-- Contra: agregar un cuarto valor exige `alter type ... add value` en su propia
-- migración (en PG 12+ corre dentro de transacción mientras el valor nuevo no se
-- use en la misma). A favor, y pesa más:
--   1. Consistencia: TODO eje cerrado del módulo `operacion` es enum nativo
--      (estado_pedido, tipo_pedido, origen_pedido, geo_estado, cobertura_estado).
--   2. El conjunto es cerrado por decisión de producto, no por comodidad:
--      "¿está el bulto en poder del courier?" solo admite sí / todavía no / ya no.
--   3. Un typo en `text` no falla: `where situacion_retiro = 'retiradO'` devuelve
--      cero filas y el coordinador ve una pantalla vacía SIN error. Este proyecto
--      ya se quemó varias veces con fallas mudas; el enum convierte esa clase de
--      error en un 22P02 ruidoso.
--   4. Del lado TypeScript habilita `Record<SituacionRetiro, …>`, que no compila
--      si a la traducción de interfaz le falta un caso.
--
-- =============================================================================
-- IDEMPOTENTE: DO-block para el tipo, `add column if not exists`,
-- `create index if not exists`, DO-block para el CHECK, `create or replace view`
-- y GRANT declarativo. Re-aplicable sobre una base ya migrada cuantas veces sea.
--
-- ALCANCE: SOLO esquema, más el espejo TypeScript de lectura. No crea la tabla de
-- sesiones de retiro ni la de escaneos (etapa 3), no toca la máquina de estados,
-- no toca el motor de dinero y NO crea ninguna política RLS nueva (§5).
-- =============================================================================

-- =============================================================================
-- 1. El tipo operacion.situacion_retiro
--    DO-block idempotente: el repo no usa `create type if not exists` (no existe).
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'situacion_retiro' and n.nspname = 'operacion'
  ) then
    create type operacion.situacion_retiro as enum (
      'pendiente',
      'retirado',
      'no_procesado'
    );
  end if;
end $$;

comment on type operacion.situacion_retiro is
  'Eje PROPIO de Rutax sobre la tenencia física del bulto, independiente de
   operacion.estado_pedido (que en Flex lo gobierna Mercado Libre).
   pendiente = ingestado y sin tocar · retirado = escaneado por un conductor en
   una bodega, en poder del courier · no_procesado = nunca se retiró (lo despachó
   otro courier). Agregar un valor exige migración aparte (alter type add value).';

-- =============================================================================
-- 2. Las dos columnas — y el respaldo de las filas que ya existen
-- =============================================================================
-- ⚠️ LA DECISIÓN DELICADA DE ESTA MIGRACIÓN, argumentada:
--
-- Si las filas existentes quedaran en `pendiente`, DESAPARECERÍAN de la operación
-- en curso apenas la pantalla de asignación empiece a filtrar por este campo
-- (etapa 6: "solo se ofrece lo que está retirado"). Un courier con su día armado
-- abriría la pantalla y la vería vacía. Eso es una regresión inaceptable y pesa
-- más que cualquier elegancia.
--
-- Por eso: **todo lo que ya existe queda como `retirado`.** El argumento no es
-- pereza, es que esas filas PRECEDEN a la funcionalidad y venían operando bajo el
-- supuesto vigente hasta hoy —"todo lo ingestado es del courier"—, que además era
-- cierto en los hechos: hasta ahora el único ingestor real de pedidos han sido
-- `crearPedidoSameDay` (los crea el propio courier) y el backfill de ML, y el
-- courier los trabajó como suyos. Marcarlos `retirado` no inventa un hecho: lo
-- registra.
--
-- SE EVALUÓ AFINARLO POR ESTADO y se descartó, en los dos sentidos:
--   · "los `pendiente_asignacion` van a `pendiente`" es exactamente lo que rompe
--     la operación: esas son las filas que la pantalla de asignación muestra hoy.
--   · "solo los terminales van a `retirado`" deja fuera lo que está en curso, que
--     es lo único que de verdad duele perder.
-- Un pedido histórico marcado `retirado` de más no genera ningún cobro nuevo (el
-- cobro lo dispara la entrega, no el retiro; y la línea de retiro al conductor
-- colgará de la visita a bodega, que estas filas no tienen). El riesgo asimétrico
-- apunta claro hacia lo conservador.
--
-- CÓMO se implementa, y por qué así en vez de un UPDATE masivo:
--   (a) La columna se agrega con default 'retirado'. En PG 11+ eso NO reescribe la
--       tabla: el valor queda en `pg_attribute.attmissingval` y toda fila
--       preexistente lo lee sin tocar un solo bloque.
--   (b) Acto seguido el default pasa a 'pendiente', que es el que rige para las
--       filas NUEVAS: un pedido recién ingestado todavía no se retiró.
-- El resultado es exactamente "lo que existía al momento de crear la columna es
-- retirado; lo que nazca después es pendiente", sin depender de una fecha de corte
-- escrita a mano (que fallaría si la migración se aplica a producción días después
-- de escribirse) y sin un UPDATE de toda la tabla más caliente del sistema.
-- Y es idempotente de verdad: re-aplicarla no revive filas legítimamente
-- `pendiente`, porque `add column if not exists` no hace nada la segunda vez.
alter table operacion.pedidos
  add column if not exists situacion_retiro operacion.situacion_retiro
    not null default 'retirado';

alter table operacion.pedidos
  alter column situacion_retiro set default 'pendiente';

-- Marca de CUÁNDO pasó a `retirado`. Nullable: nula mientras no se haya retirado,
-- y nula también en las filas del respaldo de arriba — no se conoce el instante y
-- rellenarlo con `creado_en` ensuciaría las métricas del día (hora de llegada a la
-- bodega, duración de la visita) con datos inventados. La escribe backend al
-- cerrar la visita de retiro; la BD no la rellena por trigger a propósito, porque
-- el traspaso entre conductores y las correcciones entran por otros caminos.
alter table operacion.pedidos
  add column if not exists retirado_en timestamptz;

comment on column operacion.pedidos.situacion_retiro is
  '¿Está el bulto en poder del courier? Eje PROPIO de Rutax, ORTOGONAL a `estado`
   y a `estado_ml`. pendiente (default de toda fila nueva) | retirado | no_procesado.
   Es la reja de la pantalla de asignación: un seller despacha con varios couriers,
   así que la ingesta trae CANDIDATOS y solo el escaneo en bodega dice cuáles son
   de este courier. Sin ella se generan cobros al seller por entregas ajenas
   (docs/arquitectura/retiro-y-ruteo.md §2.1 y §13bis-1.3).
   Las filas anteriores a esta migración quedaron en `retirado`: preceden a la
   funcionalidad y se operaban bajo el supuesto de que todo lo ingestado era del
   courier. Lo escribe backend con service_role al cerrar la visita de retiro.';

comment on column operacion.pedidos.retirado_en is
  'Momento en que el pedido pasó a situacion_retiro = retirado (el escaneo del
   conductor en la bodega). NULL mientras no se haya retirado, y NULL también en
   las filas del respaldo de esta migración: el instante no se conoce y no se
   inventa. No confundir con actualizado_en, que se mueve con cualquier UPDATE.
   El CHECK pedidos_retirado_en_coherente impide que quede una fecha de retiro
   colgando en una fila que no está retirada.';

-- =============================================================================
-- 3. Coherencia entre las dos columnas
-- =============================================================================
-- Solo se prohíbe la combinación imposible: una fecha de retiro en una fila que
-- NO está retirada. Así, si alguien corrige un escaneo equivocado y devuelve el
-- pedido a `pendiente`, el UPDATE falla con 23514 hasta que también limpie la
-- fecha — en vez de dejar un timestamp mintiendo sobre un retiro que no ocurrió.
--
-- Deliberadamente NO se exige la implicación inversa (`retirado` ⇒ retirado_en
-- not null): las filas del respaldo del §2 están en `retirado` con la fecha en
-- NULL porque el instante es desconocido. Un CHECK más estricto habría obligado a
-- inventar timestamps para toda la historia.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'operacion.pedidos'::regclass
       and conname  = 'pedidos_retirado_en_coherente'
  ) then
    alter table operacion.pedidos
      add constraint pedidos_retirado_en_coherente
      check (retirado_en is null or situacion_retiro = 'retirado');
  end if;
end $$;

-- =============================================================================
-- 4. Índice — el único que hoy tiene lector declarado
-- =============================================================================
-- La consulta que va a mandar es la de la pantalla de asignación (etapa 6):
-- "pedidos de este tenant, de hoy, que están retirados y sin asignar".
--
-- Parcial, y por eso vale la pena: el predicado deja fuera todo el universo de
-- candidatos ajenos (`pendiente`) y todo lo ya asignado o entregado, así que el
-- índice guarda solo la bandeja del coordinador — cientos de filas, no cientos de
-- miles. `tenant_id` va primero porque el aislamiento es la primera condición de
-- toda consulta del sistema, y `retirado_en desc` cubre a la vez el recorte "de
-- hoy" (rango sobre el instante del escaneo, que es lo que el alcance define como
-- "hoy": el día del retiro y del despacho) y el orden natural de la lista.
--
-- El costo de escritura es real pero mínimo, y conviene entenderlo: la fila NO
-- entra al índice al insertarse (nace `pendiente`); entra cuando se cierra su
-- visita de retiro y sale cuando se asigna. Dos mantenciones por pedido y por día
-- sobre un índice diminuto. Mismo patrón que idx_pedidos_cobro_pendiente y
-- idx_pedidos_geo_pendiente, que ya usan predicados sobre columnas mutables.
--
-- NO se crean todavía los índices de la retención (`no_procesado` con antigüedad)
-- ni el del barrido que marca `no_procesado`: esos jobs son de la etapa 10 y un
-- índice sin lector es solo costo de escritura en la tabla más caliente del
-- sistema — el mismo criterio con el que 20260811000003 §4 decidió no crear
-- ninguno.
create index if not exists idx_pedidos_retirados_por_asignar
  on operacion.pedidos (tenant_id, retirado_en desc)
  where situacion_retiro = 'retirado' and estado = 'pendiente_asignacion';

-- =============================================================================
-- 5. RLS — NO se agrega ninguna política, y eso es una decisión, no un olvido
-- =============================================================================
-- Las dos columnas viajan en la misma fila que el destinatario y quedan cubiertas
-- tal cual por `pedidos_select` (P1 tenant + P2 seller + P3 conductor) y por
-- `pedidos_update_interno` + el guard `trg_pedidos_solo_interno_edita`. Repaso
-- de a quién le queda visible qué, y por qué está bien:
--
--   · Interno del courier → ve y escribe las de SU tenant. Es su operación.
--   · Seller             → ve las de SUS pedidos (P2). Correcto y hasta deseable:
--                          es su propio bulto y saber si el courier ya lo retiró
--                          es información suya. NO puede escribirlas: el guard le
--                          responde 42501 antes de que RLS filtre filas, así que
--                          no puede declararse a sí mismo "ya retirado" y forzar
--                          la entrada de su pedido a la bandeja de asignación.
--   · Conductor          → solo las de los pedidos ASIGNADOS a él (P3). En el
--                          retiro todavía no hay asignación, así que por esta vía
--                          ve CERO. Es exactamente lo que exige §13bis-1.1 del
--                          alcance: la resolución del código escaneado NO puede
--                          resolverse ampliando la política del conductor —eso
--                          expondría nombre, dirección y teléfono de los ~400
--                          destinatarios del día a cada conductor—, sino por
--                          endpoint Bearer con service_role que devuelve un DTO
--                          mínimo. La prueba pgTAP que acompaña esta migración
--                          deja ese cero por escrito para que nadie lo "arregle".
--   · anon               → nada: no tiene grant sobre pedidos.
--
-- Sobre el GRANT: en operacion.pedidos es de TABLA COMPLETA
-- (20260601000005 §14), así que cubre estas dos columnas como cubre a todas las
-- demás. NO se reproduce aquí el gotcha del repo (vista restringida + grant
-- ancho, que ya mordió con dinero.lineas_*.snapshot_regla y con el token de
-- invitación): public.pedidos es `select *`, así que no hay nada que la vista
-- oculte y el grant delate. Y ninguna de las dos columnas es un secreto —
-- situacion_retiro es un hecho operativo del bulto, retirado_en una hora. El
-- string del QR de Flex, que SÍ es credencial-símil, NO va en esta tabla: va en
-- la tabla de escaneos de la etapa 3, cifrado y con GRANT por columna.
--
-- Lo que manda, entonces, es la RLS de FILA, y eso se prueba en
-- supabase/tests/database/rls_pedidos_situacion_retiro.test.sql.

-- =============================================================================
-- 6. Re-emitir la vista public.pedidos para que herede las columnas nuevas.
--    Es `select *`, pero una vista NO se actualiza sola cuando cambia la tabla
--    base: sin este `create or replace`, PostgREST seguiría sirviendo la lista de
--    columnas congelada en la última emisión y la pantalla de asignación nunca
--    vería el campo. Mismo patrón que 20260811000003, 20260702000001 y
--    20260630000001. `security_invoker = true` se conserva: sin él la vista sería
--    un bypass de RLS (la evaluaría postgres, que tiene rolbypassrls).
-- =============================================================================
create or replace view public.pedidos
  with (security_invoker = true)
  as select * from operacion.pedidos;

comment on view public.pedidos is
  'Espejo de operacion.pedidos para PostgREST. RLS heredada de la tabla base
   (security_invoker = true): P1 tenant + P2 seller + P3 conductor. Incluye
   situacion_retiro y retirado_en (¿está el bulto en poder del courier?)
   heredando esas mismas políticas: el seller las ve en SUS pedidos, el conductor
   solo en los asignados a él, y ninguno de los dos puede escribirlas.';

-- =============================================================================
-- 7. Grants — se RE-AFIRMAN los existentes porque la vista se re-emitió.
--    Mismo conjunto que 20260601000005 §14 / 20260811000003 §3. El veredicto de
--    por qué NO se pasa a grant por columna está en el §5 de esta migración.
-- =============================================================================
grant select, insert, update on operacion.pedidos to authenticated;
grant select, insert, update on public.pedidos    to authenticated;

grant select, insert, update, delete on operacion.pedidos to service_role;
grant select, insert, update, delete on public.pedidos    to service_role;

-- =============================================================================
-- 8. Verificación defensiva: las barreras de las que depende esta feature siguen
--    en pie. No altera nada — inspecciona y aborta con un error legible si falta
--    algo. Mismo patrón que 20260811000002 §3–§4 y 20260811000003 §4.
-- =============================================================================
do $$
begin
  -- 8.1 La política de SELECT es LA que impone el aislamiento de estas columnas.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'operacion' and tablename = 'pedidos'
      and policyname = 'pedidos_select'
  ) then
    raise exception
      'Falta la política pedidos_select en operacion.pedidos: es la que impone P1 (tenant) + P2 (seller) + P3 (conductor). Sin ella, situacion_retiro sería legible fuera de su alcance.';
  end if;

  -- 8.2 El guard por sentencia: convierte el "UPDATE 0" silencioso de un seller o
  --     un conductor en un 42501 explícito y auditable, ANTES de que RLS filtre
  --     filas. Es lo único que impide que un seller se declare "ya retirado" a sí
  --     mismo por PostgREST y se cuele a la bandeja de asignación del courier.
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'operacion' and c.relname = 'pedidos'
      and t.tgname = 'trg_pedidos_solo_interno_edita'
      and not t.tgisinternal
  ) then
    raise exception
      'Falta el trigger trg_pedidos_solo_interno_edita en operacion.pedidos: es el guard que rechaza con 42501 el UPDATE de un seller/conductor. situacion_retiro es una reja de dinero; sin el guard, un seller podría escribirla.';
  end if;

  -- 8.3 RLS activa y FORZADA (force cubre también al dueño de la tabla).
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'operacion' and c.relname = 'pedidos'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception
      'operacion.pedidos no tiene RLS enable + force. Sin RLS forzada no hay aislamiento que valga sobre las columnas nuevas.';
  end if;

  -- 8.4 El default DEBE ser 'pendiente' para las filas nuevas. Si el §2 quedara a
  --     medias (columna creada con 'retirado' y sin el segundo ALTER), cada pedido
  --     ingestado nacería marcado como si estuviera en poder del courier: la reja
  --     quedaría abierta de par en par y nadie se enteraría.
  if (
    select column_default from information_schema.columns
     where table_schema = 'operacion' and table_name = 'pedidos'
       and column_name = 'situacion_retiro'
  ) is distinct from '''pendiente''::operacion.situacion_retiro' then
    raise exception
      'operacion.pedidos.situacion_retiro no quedó con default pendiente. Toda fila nueva nacería como retirada y la compuerta de asignación quedaría abierta.';
  end if;
end $$;

-- =============================================================================
-- 9. Handoff (NO se implementa aquí — solo se documenta)
--
--    `integraciones` (etapa 1, ingesta diaria)
--      · La ingesta y el backfill NO deben escribir situacion_retiro: el default
--        'pendiente' es correcto y es la compuerta. Ojo con el upsert de
--        ejecutar-backfill.ts: PostgREST solo actualiza las columnas presentes en
--        el payload, así que re-ingestar un pedido ya retirado NO lo devuelve a
--        'pendiente'. Si algún día se agrega situacion_retiro al payload del
--        upsert, ese día se rompe el retiro del día.
--
--    `backend` (etapa 3, cierre de la visita de retiro)
--      · Al cerrar la visita, los pedidos escaneados pasan a 'retirado' con
--        retirado_en = now(), en el MISMO UPDATE, con service_role y tenant_id en
--        el WHERE. El CHECK obliga a limpiar retirado_en si alguna vez se revierte.
--      · El barrido que marca 'no_procesado' (etapa 10) es acción financiera:
--        bitácora con actorUsuarioId ANTES de aplicarse.
--
--    `frontend` (etapa 6, asignación en bloque)
--      · El filtro es `situacion_retiro = 'retirado'`. Es la reja: los candidatos
--        de la competencia entraron por la ingesta, se quedaron en 'pendiente' y
--        no deben aparecer nunca.
--
--    `qa` / entorno de demo
--      · Los seeds (supabase/seed.sql, seed-demo-full.sql, seed-torre-hoy.sql)
--        insertan pedidos SIN esta columna, así que tras un `db reset` nacen
--        'pendiente' y la pantalla de asignación de la demo se verá vacía cuando
--        la etapa 6 aplique el filtro. Hay que sembrarla explícitamente (y dejar
--        algunos en 'pendiente' a propósito, para poder demostrar la reja).
--        Hoy no rompe nada porque todavía nadie filtra por el campo.
--
--    `copywriter`
--      · Los tres textos de interfaz están en src/lib/ui/traduccion-estados.ts
--        (TEXTO_SITUACION_RETIRO). "No procesado" es el término del documento de
--        alcance; conviene revisar si es lo que el coordinador entiende al verlo
--        en un badge.
-- =============================================================================
