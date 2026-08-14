-- =============================================================================
-- Preparación del día · etapa 5 — las dos agregaciones, en la BASE
-- =============================================================================
-- CONTEXTO: docs/arquitectura/retiro-y-ruteo.md §7 (el módulo "Preparación del
-- día": retiros en curso, acumulado por comuna creciendo solo, y la asignación
-- ahí mismo) y docs/arquitectura/retiro-y-ruteo-plan.md, etapa 5, donde
-- "agregación por comuna en la base" figura como arreglo obligatorio.
-- Predecesoras: 20260813000002 (bodegas), 20260813000004 (sesiones y bultos),
-- 20260813000005 (la publicación en vivo de esas dos tablas).
--
-- =============================================================================
-- POR QUÉ VAN EN LA BASE Y NO EN TypeScript
-- =============================================================================
-- Hoy en este repo TODA agregación de operación se cuenta en memoria: se traen
-- las filas y se suman en el proceso. Eso arrastra dos defectos que aquí serían
-- graves y que ninguna prueba de UI detecta:
--
--   1. PostgREST corta en 1.000 filas y TRUNCA EN SILENCIO (CLAUDE.md §gotchas).
--      Al volumen del piloto —~400 pedidos/día, con ráfagas de 130 bultos por
--      visita— el acumulado por comuna cruza ese techo dentro del día. El
--      resultado no es un error: es un número más chico que el real, con la misma
--      pinta de siempre. El coordinador manda menos conductores a Maipú porque la
--      pantalla dijo 22 en vez de 40.
--   2. Contar en memoria obliga a traer las filas, y traerlas obliga a decidir
--      qué columnas. Agregar aquí significa que la pantalla recibe cifras, no
--      pedidos: ni una dirección ni un nombre de destinatario cruzan la frontera
--      para dibujar un contador.
--
-- =============================================================================
-- EL TENANT VA POR PARÁMETRO, NUNCA POR CLAIM (molde identidad.resolver_zona)
-- =============================================================================
-- Las dos son SECURITY DEFINER: se ejecutan como el dueño (postgres, BYPASSRLS),
-- así que la RLS de sesiones_retiro / bultos_retiro / pedidos NO las filtra. El
-- aislamiento lo impone el parámetro `p_tenant_id`, que el llamador ya validó
-- contra la sesión — el mismo contrato que identidad.resolver_zona
-- (20260613000004:466-503).
--
-- Se hace así, y no leyendo `identidad.claim_tenant_id()`, por una razón concreta:
-- la Preparación del día también la van a consultar jobs de service_role (avisos
-- de "hace cuánto no reporta", el cierre del día de la etapa 10), y un job no
-- tiene claim. Una función que dependiera del claim devolvería CERO FILAS ahí, en
-- silencio, y el aviso nunca saldría.
--
-- ⚠️ CONSECUENCIA QUE OBLIGA A ESCRIBIR EL SQL CON DISCIPLINA: como no hay RLS
-- debajo, CADA join lleva su propio `tenant_id` aunque la FK compuesta ya lo
-- garantice. No es cinturón y tirantes decorativo: si mañana una FK se afloja al
-- refactorizar, la única barrera que queda es el texto de esta consulta.
--
-- EXECUTE revocado a public/anon/authenticated y concedido solo a service_role
-- (molde public.salud_jobs_resumen, 20260709000002:157-234). Ningún rol de
-- cliente puede llamarlas: si pudiera, le bastaría pasar el uuid de otro courier.
--
-- Idempotente (create or replace + revoke/grant reejecutables) y NO destructivo:
-- no toca ninguna tabla, no crea ni borra datos. Aserción defensiva al final.
-- Prueba: supabase/tests/database/rls_aislamiento_preparacion_dia.test.sql
-- =============================================================================


-- =============================================================================
-- 1. operacion.preparacion_visitas_del_dia — "¿quién está retirando ahora mismo?"
-- =============================================================================
-- Una fila por VISITA del día. Es el panel 1 del §7: qué conductor, en qué bodega,
-- de qué seller, cuántos lleva y hace cuánto no reporta.
--
-- ⚠️ SALEN LOS DOS JUEGOS DE CONTADORES, Y NO SE PUEDEN COLAPSAR:
--
--   · Los VIVOS (bultos_vivos / resueltos / sin_resolver) se cuentan sobre
--     bultos_retiro AHORA MISMO, e incluyen los `posterior_al_cierre`. Son lo que
--     está físicamente arriba de la van.
--   · El ACTA (acta_total / acta_resueltos / acta_sin_resolver) es el documento
--     CONGELADO al cerrar la visita. Un escaneo que llega tarde —la cola sin
--     conexión drenando al recuperar señal— NO la mueve, por diseño.
--
-- La pantalla necesita poder decir "el acta dice 40 y llegaron 2 escaneos
-- después". Colapsarlos en un solo par de cifras sería reescribir un documento
-- que respalda el pago del retiro al conductor (etapa 8): la diferencia entre los
-- dos no es un descuadre a esconder, es el hecho que hay que mostrar.
--
-- El acta viene NULL mientras la sesión está `abierta`, tal cual está en la tabla.
-- Es deliberado (20260813000004 §2): NULL significa "todavía no hay acta", que no
-- es lo mismo que "el acta dice cero". La pantalla NO debe pintar 0 ahí.
--
-- =============================================================================
-- `bultos_de_otro_seller` — el descuadre que el retiro EXISTE para destapar
-- =============================================================================
-- Cuenta los bultos RESUELTOS de la visita cuyo pedido es de un seller DISTINTO
-- del dueño de la bodega visitada. No es una curiosidad: la propia 20260813000004
-- lo dice en el comentario de `bultos_retiro.seller_id` — "el seller DEL PEDIDO,
-- que NO es necesariamente el seller de la bodega... es exactamente la clase de
-- descuadre que el retiro existe para destapar". Un bulto ajeno aparecido
-- físicamente en una bodega es el hallazgo, no el ruido.
--
-- Va aquí, en la fila de la visita, y no en una consulta aparte, porque el único
-- modo de obtenerlo sin este contador sería que la pantalla se trajera el detalle
-- bulto por bulto solo para poder contar — justo lo que estas funciones existen
-- para evitar (y a 130 bultos por visita, justo donde PostgREST trunca).
--
-- ⚠️ UN BULTO SIN RESOLVER NO CUENTA COMO "DE OTRO SELLER". De un código que no se
-- pudo casar con un pedido no se sabe de quién es, y contarlo sería una atribución
-- inventada — el mismo criterio del CHECK bultos_retiro_desconocido_sin_vinculo,
-- que le prohíbe a un ilegible tener pedido, shipment o cuenta. Por eso el filtro
-- exige `pedido_id is not null` de forma explícita.
create or replace function operacion.preparacion_visitas_del_dia(
  p_tenant_id uuid,
  p_fecha     date
)
returns table (
  sesion_id                 uuid,
  estado                    text,
  abierta_en                timestamptz,
  cerrada_en                timestamptz,
  bodega_id                 uuid,
  bodega_nombre             text,
  bodega_comuna             text,
  seller_id                 uuid,
  seller_nombre             text,
  conductor_id              uuid,
  conductor_nombre          text,
  bultos_vivos              bigint,
  bultos_resueltos_vivos    bigint,
  bultos_sin_resolver_vivos bigint,
  bultos_de_otro_seller     bigint,
  ultimo_escaneo_en         timestamptz,
  acta_total                integer,
  acta_resueltos            integer,
  acta_sin_resolver         integer
)
language sql
stable
security definer
set search_path = operacion, identidad, pg_temp
as $$
  select
    s.id,
    s.estado::text,
    s.abierta_en,
    s.cerrada_en,
    s.bodega_id,
    b.nombre,
    b.comuna,
    s.seller_id,
    sel.razon_social,
    s.conductor_id,
    c.nombre_completo,

    -- Contadores VIVOS. `coalesce` es redundante hoy (un agregado escalar sin
    -- group by devuelve 0, no NULL) y se deja igual: si alguien agrupa esa
    -- subconsulta en el futuro, la pantalla debe seguir viendo 0 y no un hueco.
    coalesce(v.bultos_vivos, 0),
    coalesce(v.bultos_resueltos_vivos, 0),
    coalesce(v.bultos_sin_resolver_vivos, 0),
    coalesce(v.bultos_de_otro_seller, 0),
    v.ultimo_escaneo_en,

    -- El ACTA, tal cual está en la tabla. NULL mientras la visita está abierta.
    s.bultos_total,
    s.bultos_resueltos,
    s.bultos_sin_resolver

  from operacion.sesiones_retiro s

  -- LEFT JOIN y no INNER, a propósito. Las tres FK compuestas de la sesión
  -- (bodega/seller/conductor pertenecen al tenant) hacen que estos joins no
  -- puedan perder filas hoy. Pero si alguna vez fallaran, un INNER JOIN haría
  -- DESAPARECER la visita de la pantalla: el coordinador dejaría de ver a un
  -- conductor que está en una bodega. Con LEFT JOIN se pierde la etiqueta, no el
  -- hecho. Para una pantalla de monitoreo ése es el modo de falla correcto.
  --
  -- El `and tenant_id = s.tenant_id` de cada join es la disciplina que reemplaza
  -- a la RLS ausente bajo SECURITY DEFINER (ver cabecera): si un identificador
  -- cruzara de courier, el join no lo trae — devuelve NULL, no el nombre ajeno.
  left join identidad.seller_bodegas b
    on b.id = s.bodega_id
   and b.tenant_id = s.tenant_id
   and b.tenant_id = p_tenant_id

  left join identidad.sellers sel
    on sel.id = s.seller_id
   and sel.tenant_id = s.tenant_id
   and sel.tenant_id = p_tenant_id

  left join identidad.conductores c
    on c.id = s.conductor_id
   and c.tenant_id = s.tenant_id
   and c.tenant_id = p_tenant_id

  left join lateral (
    select
      count(*)                                              as bultos_vivos,
      count(*) filter (where br.pedido_id is not null)       as bultos_resueltos_vivos,

      -- EL DESCUADRE: bulto RESUELTO cuyo pedido es de un seller distinto del
      -- dueño de la bodega visitada. `pedido_id is not null` va explícito y no
      -- sobra: sin él, un bulto sin resolver (seller_id NULL) entraría por el
      -- `is distinct from` y la pantalla acusaría un descuadre inventado sobre un
      -- código que nadie pudo leer.
      --
      -- Se compara contra `br.seller_id` —el denormalizado— y NO contra un join a
      -- operacion.pedidos, a propósito: el trigger
      -- bultos_retiro_validar_denormalizados obliga a que sea exactamente
      -- pedidos.seller_id (23514 si no coincide), así que las dos formas dan el
      -- MISMO resultado; ésta se ahorra un join a la tabla más caliente del
      -- sistema, dentro de un lateral que se ejecuta una vez por visita y en una
      -- pantalla que se refresca en vivo toda la mañana.
      count(*) filter (
        where br.pedido_id is not null
          and br.seller_id is distinct from s.seller_id
      )                                                      as bultos_de_otro_seller,

      count(*) filter (where br.pedido_id is null)           as bultos_sin_resolver_vivos,

      -- ⚠️ `recibido_en` (reloj del SERVIDOR) y NUNCA `escaneado_en` (reloj del
      -- dispositivo del conductor, que puede venir desfasado o incluso
      -- adelantado). Esta columna alimenta el aviso de "hace cuánto no reporta":
      -- con escaneado_en, un teléfono con la hora mal puesta dispararía una
      -- alarma falsa —o, peor, un teléfono adelantado la SILENCIARÍA— y una
      -- alarma que miente entrena al coordinador a ignorar la pantalla.
      max(br.recibido_en)                                    as ultimo_escaneo_en
    from operacion.bultos_retiro br
    where br.sesion_retiro_id = s.id
      and br.tenant_id        = s.tenant_id
      and br.tenant_id        = p_tenant_id
    -- Sin filtro por posterior_al_cierre: los tardíos SÍ entran en los vivos.
    -- Están arriba de la van, y eso es lo que este bloque cuenta.
  ) v on true

  where s.tenant_id       = p_tenant_id
    and s.fecha_operacion = p_fecha

  -- Las visitas abiertas primero: son las accionables (un conductor adentro de
  -- una bodega). Después, las cerradas de más reciente a más antigua.
  order by (s.estado = 'abierta') desc, s.abierta_en desc, s.id;
$$;

comment on function operacion.preparacion_visitas_del_dia(uuid, date) is
  '¿QUIÉN ESTÁ RETIRANDO HOY, DÓNDE Y CÓMO VA? Una fila por visita a bodega del
   día operativo: bodega, seller, conductor, contadores VIVOS (contados ahora
   mismo sobre bultos_retiro, incluidos los escaneos posteriores al cierre) y el
   ACTA CONGELADA tal cual quedó al cerrar. Los dos juegos salen por separado y NO
   se pueden colapsar: la pantalla necesita decir "el acta dice 40 y llegaron 2
   escaneos después", y el acta respalda el pago del retiro al conductor (etapa 8).
   El acta es NULL mientras la visita está abierta ("todavía no hay acta", que no
   es "el acta dice cero").

   bultos_de_otro_seller cuenta los bultos RESUELTOS cuyo pedido es de un seller
   distinto del dueño de la bodega visitada: un bulto ajeno aparecido físicamente
   en una bodega es de las cosas que el retiro existe para destapar (ver el
   comentario de bultos_retiro.seller_id en 20260813000004). Un bulto SIN RESOLVER
   NO cuenta: de un código que no se pudo casar no se sabe de quién es, y contarlo
   sería una atribución inventada. Sale aquí para que la pantalla no tenga que
   traerse el detalle bulto por bulto solo para contar.

   ultimo_escaneo_en usa recibido_en (reloj del servidor),
   no escaneado_en (reloj del dispositivo), porque alimenta el aviso de "hace
   cuánto no reporta" y un teléfono con la hora mal puesta no puede disparar una
   alarma falsa. Orden: abiertas primero, luego por abierta_en desc. SECURITY
   DEFINER: el tenant va por parámetro y no por claim (así sirve también a jobs de
   service_role); EXECUTE solo para service_role.';


-- =============================================================================
-- 2. operacion.preparacion_carga_por_comuna — "de lo que entró, ¿cuánto va a dónde?"
-- =============================================================================
-- Panel 2 del §7: el acumulado por comuna creciendo solo. Es el insumo para
-- decidir CUÁNTOS CONDUCTORES POR ZONA antes de las 16:00, mientras los camiones
-- todavía están llegando a la bodega del coordinador.
--
-- Su valor es de reloj, no de reportería: al cerrar cada visita el courier ya
-- sabe "de estos 130, 22 van a Maipú y 18 a Puente Alto", y con eso prepara el
-- piso de la bodega ANTES de que llegue el camión. La asignación tiene que estar
-- terminada a las 16:00 en punto (docs/arquitectura/retiro-y-ruteo.md §2.2).
--
-- =============================================================================
-- ⚠️ LO QUE ESTA FUNCIÓN NO HACE, Y NO ES UN OLVIDO
-- =============================================================================
-- NO calcula "cuántos faltan por retirar". No hay, ni va a haber, una cifra de
-- faltantes contra lo esperado.
--
-- La migración 20260813000004 se niega explícitamente a modelar `bultos_esperados`
-- en la sesión de retiro, y el motivo aplica igual acá: UN SELLER DESPACHA CON
-- VARIOS COURIERS. La ingesta de Mercado Libre entrega CANDIDATOS —los envíos que
-- ese seller tiene abiertos—, no una lista comprometida con este courier. Un
-- "faltan 2" calculado contra candidatos que en realidad se llevó otro courier es
-- una alarma FALSA, y una alarma falsa recurrente entrena al coordinador a
-- ignorar la pantalla entera, incluidas las verdaderas.
--
-- Lo que sí es real y sí sale aquí: `bultos_sin_resolver`, que son bultos
-- FÍSICAMENTE ESCANEADOS que Rutax no pudo casar con un pedido. Ése es un hecho
-- observado (el bulto está arriba de la van), no una resta contra una expectativa
-- ajena. Si alguien viene a "completar" esta función con un faltante calculado,
-- esto es lo que hay que releer antes.
--
-- POBLACIÓN: los bultos de las visitas del tenant en `p_fecha` (la fecha manda la
-- SESIÓN, no el bulto: un escaneo tardío pertenece al día de su visita). Se unen
-- a operacion.pedidos por pedido_id para saber a qué comuna va cada uno.
--
-- =============================================================================
-- ⚠️ POR QUÉ NO SE AGRUPA POR `destinatario_comuna` CRUDO
-- =============================================================================
-- Esa columna NO está canonizada en el camino Flex, que es el 98% del volumen.
-- `src/modules/integraciones/ml/ingesta-pedidos.ts:737` guarda
-- `datos.destinatarioComuna ?? entrada.comunaRespaldo ?? "Santiago"` TAL CUAL
-- viene de Mercado Libre, y lo escribe crudo en la columna (:803 en el INSERT,
-- :921 en el UPDATE). `resolverComunaCanonica` existe en ese archivo pero se usa
-- SOLO para resolver la zona (:685) — nunca para normalizar lo que se persiste.
-- El camino same-day sí es canónico (el portal usa un <select> sobre COMUNAS_RM),
-- pero es la minoría.
--
-- Un `group by destinatario_comuna` crudo partiría UNA comuna en VARIAS filas por
-- mayúsculas o espacios: la pantalla mostraría "Maipú 22" y "MAIPU 18" como si
-- fueran dos zonas distintas. Y esa es justo la cifra con la que el coordinador
-- decide cuántos conductores manda a cada zona antes de las 16:00 — partirla por
-- la mitad es mandar la mitad de la flota.
--
-- Por eso la clave de agrupación es `lower(btrim(...))` y salen DOS columnas:
--   · `comuna_clave`    — la clave normalizada (minúsculas, sin espacios en los
--                          bordes). Es por lo que se agrupa y por lo que la capa
--                          de lectura debe unir.
--   · `comuna_etiqueta` — una de las grafías reales del grupo, para mostrar.
--
-- ⚠️ ESTO RESUELVE MAYÚSCULAS Y ESPACIOS, NO ACENTOS. "Maipú" y "Maipu" siguen
-- siendo dos filas. La unificación por acento la hace la capa de lectura en
-- TypeScript contra el catálogo `COMUNAS_RM` (src/lib/ui/comunas-rm.ts) con
-- `resolverComunaCanonica` (src/modules/integraciones/geocoding/normalizacion.ts,
-- que ya normaliza acentos): son ~30 filas por día, se fusionan exactas y sin
-- costo medible. NO se instala la extensión `unaccent` para esto — no está en el
-- proyecto (verificado en pg_extension) y meterla por 30 filas es desproporcionado.
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
  -- La clave se calcula UNA vez en este bloque y se agrupa por ella. Repetir la
  -- expresión en el select, el group by y el order by es la forma de que las tres
  -- se desincronicen algún día.
  with bultos_del_dia as (
    select
      b.pedido_id,
      p.driver_id_asignado,
      p.destinatario_comuna,

      -- `nullif(..., '')` incluido a propósito: `destinatario_comuna` es NOT NULL
      -- pero nada impide que llegue en blanco desde ML. Una comuna en blanco es
      -- "sin comuna conocida", no una zona llamada "" — así cae en la misma fila
      -- de excepción que los bultos sin pedido, en vez de abrir una fila fantasma
      -- con etiqueta vacía a la que nadie sabría mandar conductores.
      nullif(lower(btrim(p.destinatario_comuna)), '') as comuna_clave

    from operacion.bultos_retiro b

    -- La visita es la que fija el DÍA. Lleva su tenant_id aunque la FK compuesta
    -- bultos_retiro_sesion_pertenece_al_tenant_y_conductor ya lo garantice: bajo
    -- SECURITY DEFINER no hay RLS debajo y esta consulta es la única barrera.
    join operacion.sesiones_retiro s
      on s.id        = b.sesion_retiro_id
     and s.tenant_id = b.tenant_id

    -- LEFT JOIN, y es la pieza que hace que NADA SE DESCARTE: un bulto sin pedido
    -- entra igual y aterriza en la fila de clave NULL. Mismo criterio que
    -- src/modules/contexto/agregacion.ts:219-221 — la carga del día nunca se
    -- esconde. Descartarlos daría un total que no cuadra con lo que hay en el piso.
    left join operacion.pedidos p
      on p.id        = b.pedido_id
     and p.tenant_id = b.tenant_id
     and p.tenant_id = p_tenant_id

    where b.tenant_id       = p_tenant_id
      and s.tenant_id       = p_tenant_id
      and s.fecha_operacion = p_fecha
  )
  select
    d.comuna_clave,

    -- Una grafía REAL del grupo, para pintar en pantalla. El `filter` la deja en
    -- NULL para la fila de excepción: ahí conviven bultos sin pedido (comuna NULL)
    -- y comunas en blanco, y un `max` sin filtrar devolvería la cadena vacía, que
    -- en la pantalla se ve como una zona sin nombre en vez de como una excepción.
    max(d.destinatario_comuna) filter (where d.comuna_clave is not null),

    count(*),

    -- Ya tienen conductor de REPARTO. Ojo con el falso amigo: el conductor que
    -- retiró no es el que entrega (cross-dock), así que esto no habla del retiro
    -- sino de lo que ya salió de la bandeja de asignación.
    count(*) filter (where d.driver_id_asignado is not null),

    -- Bultos escaneados que NO quedaron casados con un pedido: los ilegibles y
    -- los que la ingesta no reconoció. Caen SIEMPRE en la fila de clave NULL,
    -- porque sin pedido no hay dirección de la que sacar la comuna. Se cuenta por
    -- grupo y no solo en esa fila a propósito: si algún día `destinatario_comuna`
    -- admitiera NULL, esta columna seguiría diciendo la verdad sin cambiarla.
    count(*) filter (where d.pedido_id is null)

  from bultos_del_dia d

  group by d.comuna_clave

  -- La fila de clave NULL va SIEMPRE AL FINAL, aunque tenga más bultos que
  -- cualquier comuna real: no es una zona a la que mandar conductores, es una
  -- EXCEPCIÓN a resolver. Ponerla arriba por volumen la disfrazaría de destino.
  -- `false` ordena antes que `true`, así que el `is null` asc hace exactamente eso.
  order by (d.comuna_clave is null), count(*) desc, d.comuna_clave;
$$;

comment on function operacion.preparacion_carga_por_comuna(uuid, date) is
  'DE LO QUE ENTRÓ HOY A LA BODEGA, ¿CUÁNTO VA A CADA COMUNA? Agrega los bultos de
   las visitas del día (la fecha la fija la SESIÓN, no el bulto). Es el insumo para
   decidir cuántos conductores por zona antes de las 16:00.

   AGRUPA POR `lower(btrim(destinatario_comuna))`, no por la columna cruda: el
   camino Flex (98% del volumen) guarda la comuna TAL CUAL viene de Mercado Libre
   —ingesta-pedidos.ts:737 y :803, sin canonizar; resolverComunaCanonica solo se
   usa ahí para resolver la zona (:685)—, así que un group by crudo mostraría
   "Maipú 22" y "MAIPU 18" como dos zonas distintas, y esa es justo la cifra con la
   que se reparte la flota. Devuelve comuna_clave (la clave normalizada, por la que
   hay que unir) y comuna_etiqueta (una grafía real del grupo, para mostrar).

   ⚠️ RESUELVE MAYÚSCULAS Y ESPACIOS, NO ACENTOS: "Maipú" y "Maipu" siguen siendo
   dos filas. La unificación por acento la hace la capa de lectura en TypeScript
   contra el catálogo COMUNAS_RM (src/lib/ui/comunas-rm.ts) con
   resolverComunaCanonica (integraciones/geocoding/normalizacion.ts) — son ~30
   filas, se fusionan exactas y sin costo. NO se instala la extensión `unaccent`
   para esto: no está en el proyecto y sería desproporcionado.

   La fila de comuna_clave NULL = "sin comuna conocida" (bultos sin pedido, o
   comuna en blanco) SE DEVUELVE SIEMPRE y va al final aunque tenga más bultos: es
   una excepción, no una zona. NO CALCULA "cuántos faltan por retirar", y no es un
   olvido: un seller despacha con varios couriers, la ingesta de ML da CANDIDATOS y
   no una lista comprometida, así que un faltante calculado contra candidatos
   ajenos es una alarma falsa —y una alarma falsa recurrente entrena al coordinador
   a ignorar la pantalla—. Por eso 20260813000004 se niega a modelar
   bultos_esperados. Lo que sí sale es bultos_sin_resolver: bultos físicamente
   escaneados que no se casaron con un pedido. SECURITY DEFINER con el tenant por
   parámetro (no por claim, para servir también a jobs de service_role); EXECUTE
   solo para service_role.';


-- =============================================================================
-- 3. Privilegios de ejecución — ningún rol de cliente
-- =============================================================================
-- Molde public.salud_jobs_resumen (20260709000002:228-234). Son SECURITY DEFINER
-- y leen SIN RLS: el aislamiento entero descansa en `p_tenant_id`. Si
-- `authenticated` pudiera ejecutarlas, a cualquier usuario le bastaría pasar el
-- uuid de otro courier para leer su operación del día — la fuga sería trivial y
-- no dejaría rastro. Las llama el servidor con service_role, después de resolver
-- el tenant desde la sesión.
revoke execute on function operacion.preparacion_visitas_del_dia(uuid, date)  from public, anon, authenticated;
revoke execute on function operacion.preparacion_carga_por_comuna(uuid, date) from public, anon, authenticated;

grant execute on function operacion.preparacion_visitas_del_dia(uuid, date)  to service_role;
grant execute on function operacion.preparacion_carga_por_comuna(uuid, date) to service_role;


-- =============================================================================
-- 4. Aserción defensiva — la migración ABORTA si algo no quedó como se declara
-- =============================================================================
-- No altera nada: inspecciona el catálogo y falla ruidosamente. Mismo patrón que
-- 20260813000004 §8 y 20260813000002 §4. Existe porque las tres cosas que revisa
-- fallan EN SILENCIO: una función que perdió el SECURITY DEFINER simplemente
-- devuelve cero filas cuando la llama un rol sin acceso, y un EXECUTE que quedó
-- para `authenticated` no se nota hasta que alguien pasa el uuid de otro courier.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'operacion.preparacion_visitas_del_dia(uuid,date)',
    'operacion.preparacion_carga_por_comuna(uuid,date)'
  ]
  loop
    -- 4.1 Existe. `to_regprocedure` devuelve NULL en vez de reventar si no.
    if to_regprocedure(fn) is null then
      raise exception
        'No existe la función %. La pantalla de Preparación del día se queda sin su agregación y volvería a contar en memoria, con el truncamiento silencioso de las 1.000 filas.', fn;
    end if;

    -- 4.2 SECURITY DEFINER. Sin él la función se evalúa con los privilegios del
    --     invocador: un job de service_role seguiría funcionando (BYPASSRLS) y la
    --     divergencia pasaría inadvertida hasta que la llame otro rol.
    if not exists (
      select 1 from pg_proc where oid = to_regprocedure(fn)::oid and prosecdef
    ) then
      raise exception
        'La función % no es SECURITY DEFINER. El contrato es explícito: lee sin RLS y el aislamiento lo impone p_tenant_id.', fn;
    end if;

    -- 4.3 STABLE. No es cosmético: una función VOLATILE no se puede usar donde el
    --     planificador exige estabilidad y, sobre todo, declara una intención
    --     equivocada — estas dos SOLO LEEN.
    if not exists (
      select 1 from pg_proc where oid = to_regprocedure(fn)::oid and provolatile = 's'
    ) then
      raise exception
        'La función % no quedó declarada STABLE. Son de solo lectura y así deben declararse.', fn;
    end if;

    -- 4.4 Ningún rol de cliente conserva EXECUTE. Se mide con
    --     has_function_privilege y no contando GRANTs: lo que importa es el
    --     privilegio EFECTIVO, incluido el que se hereda vía PUBLIC.
    if has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception
        'authenticated conserva EXECUTE sobre %. Es SECURITY DEFINER y lee sin RLS: bastaría pasar el uuid de otro courier para leer su operación del día.', fn;
    end if;

    if has_function_privilege('anon', fn, 'EXECUTE') then
      raise exception
        'anon conserva EXECUTE sobre %. Es SECURITY DEFINER y lee sin RLS.', fn;
    end if;

    -- 4.5 Control positivo: el revoke no dejó las funciones inservibles para
    --     quien sí debe llamarlas. Sin esto, un revoke de más pasaría por "seguro"
    --     y la pantalla quedaría vacía en producción.
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception
        'service_role NO puede ejecutar %. El revoke se pasó de largo y la Preparación del día se quedaría sin datos.', fn;
    end if;
  end loop;
end $$;
