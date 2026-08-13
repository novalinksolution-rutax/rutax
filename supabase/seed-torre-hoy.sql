-- =============================================================================
-- Carga del DÍA DE HOY para la Torre de control v2.
-- =============================================================================
--
-- POR QUÉ EXISTE ESTE ARCHIVO, Y NO SE AMPLIÓ `seed-demo-full.sql`.
--
-- Tres razones, y la tercera es la que decide:
--
--   1. **`seed-demo-full.sql` congela el día.** Ancla las fechas a `now()` pero
--      inserta con `on conflict (id) do nothing`, así que re-aplicarlo NO mueve
--      `fecha_compromiso`: un seed sembrado el martes deja la Torre vacía el
--      miércoles. El propio archivo ya conoce esta trampa —hace un `update`
--      correctivo para los estados de manifiesto «porque una corrida previa
--      dejaría estados viejos congelados»— pero no la aplicó a las fechas.
--
--   2. **Todos los pedidos de una comuna caen en la MISMA coordenada.** El seed
--      grande usa un centroide por comuna: 970 pedidos ubicados sobre 14 puntos
--      distintos. Con el colapso por ubicación (~20 m) de la Torre, cada comuna
--      se dibujaría como UN punto con «+59». Sin dispersión no hay burbujas que
--      agrupar, ni `+N` que probar, ni des-solape de previsualizaciones.
--
--   3. **Falta el caso que define la Torre.** El seed grande escribe
--      `cierres_conductor` solo para same-day y `evidencias_entrega` para Flex.
--      Pero la decisión central de la v2 (alcance §5.7) es que **un Flex cerrado
--      en la app de Rutax cuenta como entregado aunque Mercado Envíos todavía no
--      haya sincronizado**. Sin filas de cierre para Flex, esa divergencia
--      deliberada —la Torre diciendo 38 mientras `/operaciones` dice 45— no se
--      puede ver, y es justo lo que hay que poder demostrar para que nadie la
--      reporte como un descuadre.
--
-- Tocar el seed grande para arreglar esto habría movido fechas de pedidos que
-- ya tienen líneas de cobro y liquidación colgando. Este archivo, en cambio,
-- vive en su propio espacio de ids (`6d7c…`, `7d7c…`, `a77c…`, `857c…`, `877c…`,
-- `897c…`) y no toca una sola fila del otro.
--
-- IDEMPOTENTE POR BORRADO, no por `on conflict`. Se borra su propio bloque y lo
-- vuelve a sembrar, así que **se puede correr cualquier día** y siempre deja la
-- carga anclada a hoy. Es lo contrario de lo que hace el seed grande, y a
-- propósito: un fixture del día tiene que poder rehacerse.
--
-- USO
--   psql "$DATABASE_URL" -f supabase/seed-torre-hoy.sql
--   -- o, en local:
--   npx supabase db execute --file supabase/seed-torre-hoy.sql
--
-- Requiere `seed-demo-full.sql` aplicado antes: reutiliza su tenant, sus tres
-- sellers, sus doce conductores y sus tarifas.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Limpieza del bloque anterior (en orden de dependencia)
-- -----------------------------------------------------------------------------
-- Las FK de hijos a `pedidos` son `on delete cascade`, pero se borran explícito
-- igual: depender de un cascade obliga a recordar cuál tabla lo tiene y cuál no.
delete from operacion.cierres_conductor where id::text like '897c0000%';
delete from operacion.pruebas_entrega   where id::text like '877c0000%';
delete from operacion.incidencias       where id::text like '857c0000%';
delete from operacion.asignaciones_pedido where id::text like 'a77c0000%';
delete from operacion.pedidos           where id::text like '6d7c0000%';
delete from operacion.manifiestos       where id::text like '7d7c0000%';

-- Bodegas de ESTE bloque (§7). Prefijos propios: no tocan las de `seed.sql`
-- (7b0…/7c0…) ni las de `seed-demo-full.sql` (7b1…/7c1…).
--
-- ⚠️ CUANDO LLEGUE LA ETAPA 3: la sesión/visita de retiro va a referenciar
-- `seller_bodegas` por FK compuesta (tenant_id, bodega_id). Desde ese día, estos
-- dos DELETE fallan con 23503 si hay visitas colgando de estas bodegas, y hay
-- que borrarlas ANTES aquí mismo — igual que se hace arriba con los hijos de
-- `pedidos`. No es hipotético: el §5 de la migración 20260813000002 ya declara
-- esa FK como el motivo de existir de `seller_bodegas_tenant_id_id_uk`.
delete from identidad.seller_bodegas  where id::text like '7b7c0000%';
delete from identidad.courier_bodegas where id::text like '7c7c0000%';


-- -----------------------------------------------------------------------------
-- 1. El plan del día — una fila por pedido, antes de tocar ninguna tabla
-- -----------------------------------------------------------------------------
-- Se materializa en una tabla temporal porque la consumen seis inserts y un CTE
-- no sobrevive al `;`. Repetirlo seis veces invitaría a que una copia divergiera.
create temporary table _torre_plan as
with hoy as (
  -- Fecha CIVIL de Santiago. Nunca `current_date`: la sesión de Postgres corre
  -- en UTC y a las 21:00 de Santiago ya es el día siguiente allá, así que el
  -- fixture sembraría mañana sin fallar.
  select (now() at time zone 'America/Santiago')::date as d
),
comunas(idx, nombre, lat, lng, radio_lat, radio_lng, volumen) as (
  -- `radio_lat` y `radio_lng` son el semiancho de dispersión en grados, y NO
  -- son decorativos: definen dónde caen los puntos del mapa.
  --
  -- ⚠️ **Son DOS radios y salen de medir el polígono, no de estimar a ojo.** La
  -- primera versión usaba un radio único por comuna, elegido a mano: el
  -- resultado fue que **134 de 1.008 pedidos (13 %) caían fuera de su propia
  -- comuna**, y Vitacura —larga y estrecha— llegaba al 54 %. En pantalla se veía
  -- como burbujas flotando fuera del límite dibujado, que es exactamente lo que
  -- se reportó.
  --
  -- Una caja cuadrada no respeta la forma de una comuna. Estos valores se
  -- calibraron encogiendo la caja envolvente de cada polígono DPA 2023 hasta que
  -- una rejilla de prueba quedara ≥97 % dentro, conservando su proporción. Por
  -- eso Vitacura pide 0,0019 × 0,0031 y Peñalolén 0,0120 × 0,0345: un solo
  -- número nunca iba a servir para las dos.
  --
  -- *Que quede un ~2 % fuera es deliberado y realista: el geocoding pone
  -- direcciones de calles limítrofes al otro lado del límite administrativo.*
  --
  -- Los centroides son los mismos de `src/lib/geo/centroides-rm.ts`, y los
  -- nombres los canónicos de `src/lib/ui/comunas-rm.ts`: si no coincidieran, la
  -- comuna no emparejaría contra la geometría DPA 2023 y no se pintaría.
  values
    (1,  'Santiago'::text,         -33.4489, -70.6693, 0.0076, 0.0097, 120),
    (2,  'Maipú',                  -33.5167, -70.7667, 0.0178, 0.0331,  88),
    (3,  'Puente Alto',            -33.6111, -70.5756, 0.0110, 0.0158,  82),
    (4,  'La Florida',             -33.5500, -70.5833, 0.0085, 0.0195,  78),
    (5,  'Las Condes',             -33.4089, -70.5683, 0.0092, 0.0137,  74),
    (6,  'Ñuñoa',                  -33.4564, -70.5969, 0.0107, 0.0158,  62),
    (7,  'Providencia',            -33.4314, -70.6111, 0.0123, 0.0162,  58),
    (8,  'Peñalolén',              -33.4889, -70.5417, 0.0120, 0.0345,  54),
    (9,  'Pudahuel',               -33.4417, -70.7583, 0.0105, 0.0170,  48),
    (10, 'Quilicura',              -33.3667, -70.7333, 0.0183, 0.0299,  44),
    (11, 'Recoleta',               -33.4000, -70.6417, 0.0133, 0.0108,  40),
    (12, 'Macul',                  -33.4894, -70.5986, 0.0123, 0.0140,  36),
    (13, 'San Miguel',             -33.4972, -70.6500, 0.0118, 0.0096,  34),
    (14, 'Estación Central',       -33.4597, -70.6981, 0.0055, 0.0090,  32),
    (15, 'La Reina',               -33.4444, -70.5375, 0.0110, 0.0295,  28),
    (16, 'Vitacura',               -33.3833, -70.6000, 0.0019, 0.0031,  26),
    (17, 'Renca',                  -33.4042, -70.7250, 0.0053, 0.0130,  24),
    (18, 'Cerrillos',              -33.4969, -70.7186, 0.0131, 0.0122,  22),
    (19, 'Independencia',          -33.4167, -70.6667, 0.0080, 0.0077,  20),
    (20, 'La Cisterna',            -33.5333, -70.6625, 0.0106, 0.0114,  18),
    (21, 'San Joaquín',            -33.4944, -70.6278, 0.0138, 0.0086,  16),
    (22, 'Conchalí',               -33.3833, -70.6750, 0.0112, 0.0131,  14),
    -- Colina entra a propósito aunque no sea del núcleo urbano: es **la comuna
    -- periférica** del set y prueba dos cosas que las 22 anteriores no podían.
    --   · Es la más grande de todas por lejos (0,42° × 0,40°, el doble de
    --     Maipú), así que ejercita el encuadre por caja envolvente en su
    --     extremo: con el zoom fijo que había antes, de Colina se habría visto
    --     una esquina.
    --   · Está muy al norte (-33,20 contra -33,45 del centro), así que verifica
    --     que el encuadre inicial de la RM alcance a mostrar carga periférica.
    -- Volumen bajo a propósito: un courier de same-day en Santiago reparte poco
    -- en Chicureo, y una cifra inflada mentiría sobre cómo se ve de verdad.
    (23, 'Colina',                 -33.2019, -70.6747, 0.0674, 0.0706,  30)
),
crudo as (
  select
    c.idx,
    c.nombre                                        as comuna,
    c.lat, c.lng, c.radio_lat, c.radio_lng,
    j,
    c.idx * 10000 + j                               as n,
    -- Edificios: de cada 11 pedidos, tres comparten portal. Es lo que produce el
    -- `+N` — un edificio con varias entregas tiene que ser UN punto con su
    -- cantidad, no una mancha de círculos encimados.
    case when j % 11 in (1, 2, 3) then j - (j % 11) + 1 else j end as bloque
  from comunas c
  cross join lateral generate_series(1, c.volumen) as j
)
select
  r.idx,
  r.comuna,
  r.n,
  r.j,
  (select d from hoy)                               as fecha,
  ('6d7c0000-0000-0000-0000-' || lpad(r.n::text, 12, '0'))::uuid as pedido_id,
  ('30000000-0000-0000-0000-' || lpad((((r.n - 1) % 3) + 1)::text, 12, '0'))::uuid as seller_id,
  ('40000000-0000-0000-0000-' || lpad((((r.n - 1) % 12) + 1)::text, 12, '0'))::uuid as driver_id,
  ('50000000-0000-0000-0000-' || lpad((((r.n - 1) % 4) + 1)::text, 12, '0'))::uuid  as tarifa_id,
  (((r.n - 1) % 12) + 1)                            as driver_k,
  case when r.n % 5 = 0 then 'same_day' else 'flex' end as tipo,
  -- El reparto del día. `j % 25` mantiene la misma mezcla dentro de cada comuna,
  -- así que la rampa de carga la produce el VOLUMEN y no un sesgo de estado.
  case
    when r.j % 25 < 2  then 'incidencia'   --  8 %
    when r.j % 25 < 12 then 'entregado'    -- 40 %
    when r.j % 25 < 17 then 'en_ruta'      -- 20 %
    when r.j % 25 < 22 then 'asignado'     -- 20 %
    else                    'pendiente'    -- 12 %
  end                                               as rol,
  -- Dispersión determinista dentro de la comuna. El hash va sobre el BLOQUE y no
  -- sobre el pedido: los tres del mismo portal tienen que caer en la coordenada
  -- idéntica o no colapsarían.
  --
  -- `(x % 2001 + 2001) % 2001 - 1000` y no `abs(x) % 2001`: el `abs()` de
  -- INT_MIN desborda en Postgres, y con mil filas por corrida esa lotería se
  -- termina ganando.
  r.lat + r.radio_lat * (
    ((('x' || substr(md5('tlat:' || r.idx || ':' || r.bloque), 1, 8))::bit(32)::int % 2001 + 2001) % 2001 - 1000
    )::float / 1000.0)                              as lat,
  r.lng + r.radio_lng * (
    ((('x' || substr(md5('tlng:' || r.idx || ':' || r.bloque), 1, 8))::bit(32)::int % 2001 + 2001) % 2001 - 1000
    )::float / 1000.0)                              as lng
from crudo r;

create index on _torre_plan (pedido_id);


-- -----------------------------------------------------------------------------
-- 2. Manifiestos de hoy — uno por conductor
-- -----------------------------------------------------------------------------
-- F13 (avance por conductor) lee las paradas del MANIFIESTO del día, no el
-- denormalizado `pedidos.driver_id_asignado`: una reasignación deja el
-- denormalizado apuntando al último conductor y las paradas del primero
-- desaparecerían de su cuenta.
insert into operacion.manifiestos
  (id, tenant_id, driver_id, nombre, fecha_operacion, estado,
   creado_por_usuario_id, confirmado_en, creado_en)
select
  ('7d7c0000-0000-0000-0000-' || lpad(k::text, 12, '0'))::uuid,
  '10000000-0000-0000-0000-000000000001',
  c.id,
  'Torre ' || split_part(c.nombre_completo, ' ', 1) || ' ' || to_char(h.d, 'DD-MM'),
  h.d,
  'en_ruta'::operacion.estado_manifiesto,
  '20000000-0000-0000-0000-000000000003',
  ((h.d + time '07:30') at time zone 'America/Santiago'),
  ((h.d + time '06:45') at time zone 'America/Santiago')
from generate_series(1, 12) as k
cross join (select (now() at time zone 'America/Santiago')::date as d) h
join identidad.conductores c
  on c.id = ('40000000-0000-0000-0000-' || lpad(k::text, 12, '0'))::uuid;


-- -----------------------------------------------------------------------------
-- 3. Pedidos
-- -----------------------------------------------------------------------------
-- ⚠️ **El estado de un Flex «entregado» NO es `entregado`.** La mitad de ellos
-- queda en `en_ruta` a propósito: su cierre en la app de Rutax existe (paso 6),
-- pero Mercado Envíos todavía no sincronizó. Eso reproduce la divergencia que la
-- Torre declara — ella los cuenta entregados y `/operaciones` no —, que es
-- comportamiento buscado y no un descuadre (alcance §5.7).
insert into operacion.pedidos (
  id, tenant_id, seller_id, tipo_pedido, origen,
  ml_order_id, ml_shipment_id, codigo_interno,
  estado, estado_ml, driver_id_asignado,
  destinatario_nombre, destinatario_direccion, destinatario_comuna,
  destinatario_telefono,
  fecha_compromiso, fecha_compromiso_hora, tarifa_aplicable_id,
  monto_cobro_clp, monto_liquidacion_clp, cobro_generado, liquidacion_generada,
  lat, long, geo_estado, geo_confianza, geocodificado_en, cobertura_estado,
  corte_riesgo, tracking_token, creado_en
)
select
  p.pedido_id,
  '10000000-0000-0000-0000-000000000001',
  p.seller_id,
  p.tipo::operacion.tipo_pedido,
  case when p.tipo = 'same_day' then 'same_day_manual'::operacion.origen_pedido
       else 'ml_ingesta'::operacion.origen_pedido end,
  case when p.tipo = 'flex' then 'ML-ORD-' || to_char(p.fecha, 'YYYYMMDD') || '-' || lpad(p.n::text, 6, '0') end,
  case when p.tipo = 'flex' then 'FLEX-2026-' || lpad((700000 + p.n)::text, 6, '0') end,
  -- Formato real de same-day: `RX-XXXX-XXXX` en alfabeto Crockford. El hex de
  -- md5 en mayúsculas ya cae entero dentro del alfabeto, así que no hay que
  -- traducir nada. El seed grande usa `SD-00042`, que NO valida contra
  -- `PATRON_CODIGO_INTERNO` — acá interesa el formato de verdad porque la ficha
  -- del punto muestra este código y su forma delata la fuente.
  case when p.tipo = 'same_day'
       then 'RX-' || upper(substr(md5('rx' || p.n::text), 1, 4))
                  || '-' || upper(substr(md5('rx' || p.n::text), 5, 4)) end,
  case
    when p.rol = 'incidencia' then 'fallido'
    when p.rol = 'entregado'  then
      -- Same-day: el POD es autoritativo y mueve el estado al instante.
      -- Flex: la mitad ya sincronizó con ML, la otra mitad todavía no.
      case when p.tipo = 'same_day' or p.n % 2 = 0 then 'entregado' else 'en_ruta' end
    when p.rol = 'en_ruta'    then 'en_ruta'
    when p.rol = 'asignado'   then 'asignado'
    else 'pendiente_asignacion'
  end::operacion.estado_pedido,
  case when p.tipo = 'flex' then
    case
      when p.rol = 'incidencia' then 'not_delivered'
      when p.rol = 'entregado' and p.n % 2 = 0 then 'delivered'
      when p.rol in ('entregado', 'en_ruta') then 'shipped'
      when p.rol = 'asignado' then 'ready_to_ship'
      else 'ready_to_ship' end
  end,
  case when p.rol <> 'pendiente' then p.driver_id end,
  -- Destinatario: nombre y dirección existen en la tabla porque el resto del
  -- producto los usa (etiqueta, manifiesto, portal). La Torre NO los selecciona
  -- nunca — su minimización empieza en el `select` de `consultas.ts`.
  (array['Ana María Torres','Roberto Díaz Pizarro','Marcela Fuentes Rojas',
         'Luis Alberto Campos','Sofía Guzmán Arenas','Carla Ortiz Muñoz',
         'Gustavo Herrera Lagos','Patricia Sánchez Leiva','Marco Peña Riquelme',
         'Isabel Núñez Carrasco'])[(p.n % 10) + 1],
  (array['Av. Providencia','Calle Los Aromos','Av. Irarrázaval','Gran Avenida',
         'Av. Vicuña Mackenna','Pasaje Los Boldos','Av. Las Condes','Calle Catedral',
         'Av. Tobalaba','Av. Grecia'])[(p.n % 10) + 1]
    || ' ' || (120 + (p.n % 880))::text,
  p.comuna,
  '+569' || lpad(((p.n * 7919) % 100000000)::text, 8, '0'),
  p.fecha,
  ((p.fecha + time '09:00' + ((p.n % 10) * interval '1 hour')) at time zone 'America/Santiago'),
  p.tarifa_id,
  case when p.rol = 'entregado' then 3500 + (p.n % 4) * 300 end,
  case when p.rol = 'entregado' then 2200 + (p.n % 4) * 200 end,
  (p.rol = 'entregado'),
  (p.rol = 'entregado'),
  p.lat,
  p.lng,
  'resuelto'::operacion.geo_estado,
  0.72 + ((p.n % 25)::numeric / 100),
  ((p.fecha + time '06:10') at time zone 'America/Santiago'),
  'tarifada'::operacion.cobertura_estado,
  false,
  substr(md5('rutax-torre-' || p.n::text), 1, 24),
  ((p.fecha + time '05:40') at time zone 'America/Santiago')
from _torre_plan p;

-- Pedidos SIN ubicar (F8). El contador de «sin ubicar» tiene que tener algo que
-- contar: un mapa que esconde lo que no pudo ubicar miente sobre la carga real,
-- y la regla 5 obliga a declararlo siempre. Se marcan siete de los pendientes
-- ya sembrados en vez de crear filas nuevas, para que el total no se mueva.
update operacion.pedidos
set geo_estado = 'no_resuelto'::operacion.geo_estado,
    lat = null,
    long = null,
    geo_confianza = null,
    geocodificado_en = null
where id in (
  select pedido_id from _torre_plan where rol = 'pendiente' and n % 11 = 0
);


-- -----------------------------------------------------------------------------
-- 4. Asignaciones al manifiesto del día
-- -----------------------------------------------------------------------------
-- Un trigger valida que `driver_id` coincida con el del manifiesto y que
-- `seller_id` coincida con el del pedido. Ambos salen del mismo plan, así que
-- cuadran por construcción.
insert into operacion.asignaciones_pedido
  (id, tenant_id, pedido_id, manifiesto_id, driver_id, seller_id, activa,
   asignado_por_usuario_id, asignado_en)
select
  ('a77c0000-0000-0000-0000-' || lpad(p.n::text, 12, '0'))::uuid,
  '10000000-0000-0000-0000-000000000001',
  p.pedido_id,
  ('7d7c0000-0000-0000-0000-' || lpad(p.driver_k::text, 12, '0'))::uuid,
  p.driver_id,
  p.seller_id,
  true,
  '20000000-0000-0000-0000-000000000003',
  ((p.fecha + time '07:40') at time zone 'America/Santiago')
from _torre_plan p
where p.rol <> 'pendiente';


-- -----------------------------------------------------------------------------
-- 5. Incidencias
-- -----------------------------------------------------------------------------
-- Abiertas: lo único rojo de la pantalla (regla 4). Van sobre los pedidos del
-- rol `incidencia`, que quedaron en estado `fallido`.
insert into operacion.incidencias
  (id, tenant_id, pedido_id, seller_id, tipo, estado, descripcion,
   afecta_cobro, afecta_liquidacion, abierta_por_usuario_id, abierta_en)
select
  ('857c0000-0000-0000-0000-' || lpad(p.n::text, 12, '0'))::uuid,
  '10000000-0000-0000-0000-000000000001',
  p.pedido_id,
  p.seller_id,
  x.tipo::operacion.tipo_incidencia,
  case when p.n % 3 = 0 then 'en_gestion' else 'abierta' end::operacion.estado_incidencia,
  x.descripcion,
  x.afecta_cobro,
  false,
  '20000000-0000-0000-0000-000000000003',
  now() - ((20 + (p.n % 260)) * interval '1 minute')
from _torre_plan p
join (values
  (0, 'destinatario_ausente'::text, 'Nadie responde en el domicilio tras dos intentos.', true),
  (1, 'problema_acceso',            'Portón cerrado, sin conserje en el horario de reparto.', false),
  (2, 'direccion_erronea',          'La numeración indicada no existe en la calle.', true),
  (3, 'rechazo_destinatario',       'El destinatario rechaza el paquete sin abrirlo.', true),
  (4, 'paquete_danado',             'Caja con daño visible al llegar al domicilio.', true)
) as x(slot, tipo, descripcion, afecta_cobro)
  on p.n % 5 = x.slot
where p.rol = 'incidencia';

-- Incidencias YA RESUELTAS sobre pedidos que hoy siguen pendientes: son los
-- reintentos. Es lo que alimenta la tercera línea de la ficha («2º intento»), y
-- es un caso que no existe en ningún otro dato de demo — un paquete que falló
-- ayer y se está reintentando hoy se ve idéntico a uno fresco.
insert into operacion.incidencias
  (id, tenant_id, pedido_id, seller_id, tipo, estado, descripcion,
   notas_resolucion, afecta_cobro, afecta_liquidacion,
   abierta_por_usuario_id, resuelta_por_usuario_id, abierta_en, resuelta_en)
select
  ('857c0000-0001-0000-0000-' || lpad(p.n::text, 12, '0'))::uuid,
  '10000000-0000-0000-0000-000000000001',
  p.pedido_id,
  p.seller_id,
  'destinatario_ausente'::operacion.tipo_incidencia,
  'resuelta'::operacion.estado_incidencia,
  'Domicilio cerrado en el intento anterior.',
  'Reprogramado para hoy con el seller.',
  false, false,
  '20000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000002',
  ((p.fecha - 1 + time '16:20') at time zone 'America/Santiago'),
  ((p.fecha - 1 + time '19:05') at time zone 'America/Santiago')
from _torre_plan p
where p.rol in ('pendiente', 'asignado', 'en_ruta')
  and p.n % 13 = 0;


-- -----------------------------------------------------------------------------
-- 6. Lo que el conductor declaró en la app de Rutax
-- -----------------------------------------------------------------------------
-- **Ésta es la mesa donde se juega la Torre.** Su contador no sale del estado
-- oficial del pedido: sale de estas dos tablas.
--
-- El instante más reciente queda a ~9 minutos de ahora para que F6 (frescura)
-- abra CALLADA, que es su estado normal. Para ver el chip ámbar de «sin cierres
-- hace N min» basta con envejecer estas marcas.

-- 6.a POD autoritativo del same-day. Un trigger de la tabla impone que solo
--     acepte pedidos same-day, así que el filtro no es opcional.
insert into operacion.pruebas_entrega
  (id, tenant_id, pedido_id, seller_id, conductor_id, tipo_resultado,
   tiene_foto, foto_object_path, tiene_firma, otp_estado,
   geo_lat, geo_long, geo_precision_m, distancia_destino_m, geocerca_resultado,
   es_valido, capturado_en)
select
  ('877c0000-0000-0000-0000-' || lpad(p.n::text, 12, '0'))::uuid,
  '10000000-0000-0000-0000-000000000001',
  p.pedido_id, p.seller_id, p.driver_id,
  'entregado'::operacion.pod_resultado,
  true, '10000000-0000-0000-0000-000000000001/pod/' || p.pedido_id || '/foto.jpg',
  false,
  'validado'::operacion.pod_otp_estado,
  p.lat, p.lng, 11.0, 16.0,
  'dentro'::operacion.pod_geocerca_resultado,
  true,
  greatest(
    ((p.fecha + time '08:40') at time zone 'America/Santiago'),
    now() - ((9 + (p.n % 420)) * interval '1 minute')
  )
from _torre_plan p
where p.rol = 'entregado' and p.tipo = 'same_day';

-- 6.b Cierre operativo del conductor. **Acá van los Flex**, y es lo que el seed
--     grande nunca sembró: sin estas filas, la mitad de los Flex entregados hoy
--     se vería como pendiente en la Torre y la decisión §5.7 quedaría sin
--     representar. La tabla no tiene frontera de tipo, a diferencia del POD.
insert into operacion.cierres_conductor
  (id, tenant_id, pedido_id, seller_id, conductor_id, resultado, motivo,
   geo_lat, geo_long, geo_precision_m, distancia_destino_m,
   geocerca_resultado, cerrado_en)
select
  ('897c0000-0000-0000-0000-' || lpad(p.n::text, 12, '0'))::uuid,
  '10000000-0000-0000-0000-000000000001',
  p.pedido_id, p.seller_id, p.driver_id,
  case when p.rol = 'entregado' then 'entregado' else 'no_entregado' end,
  case when p.rol <> 'entregado'
       then 'Destinatario ausente en el horario comprometido' end,
  p.lat, p.lng, 13.0, 19.0,
  'dentro'::operacion.pod_geocerca_resultado,
  greatest(
    ((p.fecha + time '08:40') at time zone 'America/Santiago'),
    now() - ((9 + (p.n % 420)) * interval '1 minute')
  )
from _torre_plan p
where p.tipo = 'flex'
  and p.rol in ('entregado', 'incidencia');


-- -----------------------------------------------------------------------------
-- 7. Bodegas de HOY
-- -----------------------------------------------------------------------------
-- La Torre NO muestra bodegas y no las va a mostrar: es de solo lectura y su
-- unidad es la comuna. Estas filas están acá por la otra propiedad de este
-- archivo, la que ningún otro seed tiene — **es el único que se puede correr
-- cualquier día y deja la carga anclada a HOY**.
--
-- Qué gana la demo con eso, en concreto:
--   · `geocodificado_en` de esta mañana. Las bodegas de `seed.sql` y
--     `seed-demo-full.sql` entran con `on conflict do nothing`, así que su fecha
--     de geocodificación se congela en la primera corrida y meses después la
--     pantalla dice "resuelta hace 4 meses" en TODAS. Sin una sola fila fresca,
--     el caso "recién geocodificada" no existe en la demo ningún día.
--   · Están en las tres comunas de mayor carga del día (Santiago 120, Maipú 88,
--     Puente Alto 82). La jornada que describió el courier real —un conductor
--     retirando en tres bodegas de sellers distintos, 30 + 30 + 70 bultos— se
--     demuestra con bodegas donde de verdad hay pedidos hoy, no en cualquier
--     comuna.
--
-- NINGUNA es principal, y no es una preferencia: la principal de cada seller y
-- la del courier las marca `seed.sql`, y `seller_bodegas_principal_uk` /
-- `courier_bodegas_principal_uk` admiten como máximo UNA. Marcar una aquí
-- abortaría la transacción entera con 23505 — y este archivo se corre a diario.
--
-- Los nombres tampoco se repiten con los de los otros dos seeds dentro del mismo
-- seller: `seller_bodegas_nombre_activa_uk` es único entre las ACTIVAS.
insert into identidad.seller_bodegas (
  id, tenant_id, seller_id, nombre, direccion, comuna,
  instrucciones_acceso, contacto_nombre, contacto_telefono,
  es_principal, activa,
  lat, long, geo_estado, geo_confianza, geocodificado_en
)
select
  b.id::uuid,
  '10000000-0000-0000-0000-000000000001',
  b.seller_id::uuid,
  b.nombre, b.direccion, b.comuna,
  b.instrucciones, b.contacto_nombre, b.contacto_telefono,
  false, true,
  b.lat, b.lng, 'resuelto', b.confianza,
  -- Las 06:20 de HOY en Santiago; nunca en el futuro si el seed se corre de
  -- madrugada. Mismo criterio de reloj que el resto del archivo: la fecha civil
  -- de Santiago, no `current_date` (que en la sesión de Postgres es UTC).
  least(
    ((h.d + time '06:20') at time zone 'America/Santiago'),
    now() - interval '5 minutes'
  )
from (values
  ('7b7c0000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   'Bodega Matucana'::text, 'Av. Matucana 1030'::text, 'Santiago'::text,
   'Carga por el pasaje lateral. Hay inspección municipal en la vereda: no dejar bultos en el suelo.'::text,
   'Sandra Meneses'::text, '+56995620418'::text,
   -33.4407::double precision, -70.6825::double precision, 0.930::numeric),
  ('7b7c0000-0000-0000-0000-000000000002',
   '30000000-0000-0000-0000-000000000002',
   'Bodega Los Pajaritos', 'Av. Los Pajaritos 3195', 'Maipú',
   null, null, '+56941780256',
   -33.4886, -70.7449, 0.900),
  ('7b7c0000-0000-0000-0000-000000000003',
   '30000000-0000-0000-0000-000000000003',
   'Bodega Camilo Henríquez', 'Av. Camilo Henríquez 3600', 'Puente Alto',
   'Retiro solo antes de las 12:00; después ocupan el andén para recepción.',
   null, null,
   -33.5757, -70.5744, 0.880)
) as b(id, seller_id, nombre, direccion, comuna, instrucciones,
       contacto_nombre, contacto_telefono, lat, lng, confianza)
cross join (select (now() at time zone 'America/Santiago')::date as d) h;

-- Anexo del courier abierto para la carga de hoy. Activo y NO principal: es un
-- segundo origen de ruta posible, que es lo que la etapa 7 tiene que poder
-- elegir. La principal sigue siendo 'Central Cerrillos', de `seed.sql`.
insert into identidad.courier_bodegas (
  id, tenant_id, nombre, direccion, comuna,
  instrucciones_acceso, es_principal, activa,
  lat, long, geo_estado, geo_confianza, geocodificado_en
)
select
  '7c7c0000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Anexo Estación Central','Av. 5 de Abril 4120','Estación Central',
  'Anexo de temporada. Se abre cuando la carga del día pasa de 900 bultos y se cierra al terminar la ola.',
  false, true,
  -33.4650, -70.7000, 'resuelto', 0.910,
  least(
    ((h.d + time '06:20') at time zone 'America/Santiago'),
    now() - interval '5 minutes'
  )
from (select (now() at time zone 'America/Santiago')::date as d) h;


drop table _torre_plan;

commit;


-- =============================================================================
-- Qué queda sembrado (para leerlo de un vistazo)
-- =============================================================================
--   1.048 pedidos con compromiso de HOY, en 23 comunas de la RM (22 urbanas + Colina)
--     · volumen por comuna de 14 a 120 → la rampa de carga tiene sus cuatro
--       cuartiles de verdad, en vez de cuatro comunas indistinguibles
--     · coordenadas dispersas dentro de cada comuna, con edificios de 3
--       entregas que colapsan en un punto `+3`
--     · ~8 % con incidencia abierta · ~40 % entregado · ~52 % en curso
--     · 7 pedidos sin geocodificar, para el contador de «sin ubicar» (F8)
--     · algunos pendientes arrastran una incidencia RESUELTA de ayer → «2º intento»
--   12 manifiestos en ruta, uno por conductor, con sus asignaciones activas
--   Cierres de Rutax para los Flex entregados, la mitad de ellos con el pedido
--     todavía en `en_ruta` → la Torre va por delante de `/operaciones`, a propósito
--   4 bodegas geocodificadas HOY (3 de seller, en las comunas de mayor carga del
--     día, + 1 anexo del courier). Ninguna principal: esas las marca `seed.sql`
--
-- Cruza 1.000 filas A PROPÓSITO: es el tope en que PostgREST trunca sin avisar,
-- y contar pedidos por comuna es exactamente el patrón que ese tope arruina. Si
-- `leerTodasLasFilas` se rompiera, las cifras saldrían plausibles y equivocadas
-- en vez de fallar — este fixture lo destapa en la primera corrida.
-- =============================================================================
