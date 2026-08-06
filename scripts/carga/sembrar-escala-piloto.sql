-- =============================================================================
-- Fixture de CARGA a escala del piloto — 10 sellers.
-- =============================================================================
-- El seed de demo (`seed-demo-full.sql`) sirve para mirar pantallas: 960 pedidos
-- en un puñado de comunas. NO sirve para saber si el producto aguanta, y esa
-- distinción ya costó caro — el detector de integridad llevaba meses muerto por
-- un `URI too long` que solo aparece pasadas las ~700 líneas de cobro, y a escala
-- de demo pasaba todos los tests.
--
-- Este fixture reproduce el ALCANCE DECIDIDO PARA EL PILOTO (2026-08-05):
-- 1 courier · 10 sellers · 15 conductores · ~650 pedidos/día · 30 días.
-- Da ~19.500 pedidos y ~15.000 líneas de cobro: entre 8× y 20× el demo, y por
-- encima de los dos techos de PostgREST que muerden en silencio (`max_rows`=1000
-- y el largo de URL de un `.in(...)`).
--
-- Todo cuelga del tenant de demo y lleva prefijos propios, así que se retira
-- entero con `retirar-escala-piloto.sql`. No toca ninguna fila del seed.
--
-- Uso:
--   docker exec -i supabase_db_<proyecto> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < scripts/carga/sembrar-escala-piloto.sql
--
-- ⚠️ El contenedor de Postgres corre en UTC: `current_date` es el día siguiente
-- al de Santiago a partir de las 21:00 locales. Acá se usa siempre
-- `(now() at time zone 'America/Santiago')::date`, que es lo que la app pregunta.
-- =============================================================================

\set tenant '''10000000-0000-0000-0000-000000000001'''
\set ON_ERROR_STOP on

begin;

-- -----------------------------------------------------------------------------
-- 1. Sellers (10) y conductores (15)
-- -----------------------------------------------------------------------------
insert into identidad.sellers (id, tenant_id, razon_social, rut, estado)
select
  ('c0000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
  :tenant::uuid,
  'Carga Seller '||lpad(i::text,2,'0')||' SpA',
  (76200000 + i)::text||'-'||((i % 9) + 1)::text,
  'activo'
from generate_series(1,10) i
on conflict (id) do nothing;

insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
select
  ('c1000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
  :tenant::uuid,
  'Conductor Carga '||lpad(i::text,2,'0'),
  (17300000 + i)::text||'-'||((i % 9) + 1)::text,
  (case when i % 3 = 0 then 'independiente' else 'dependiente' end)::identidad.tipo_relacion_conductor,
  'activo'
from generate_series(1,15) i
on conflict (id) do nothing;

-- Una tarifa por seller (monto fijo, suficiente para que el motor tenga qué aplicar).
insert into identidad.tarifas (id, tenant_id, seller_id, tipo_entrega, monto_clp, vigente_desde)
select
  ('c3000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
  :tenant::uuid,
  ('c0000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
  'same_day'::identidad.tipo_entrega,
  3200 + (i * 100),
  (now() at time zone 'America/Santiago')::date - 60
from generate_series(1,10) i
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Períodos de cobro quincenales por seller, cubriendo los 30 días
-- -----------------------------------------------------------------------------
insert into dinero.periodos_cobro (
  id, tenant_id, seller_id, fecha_inicio, fecha_fin, tipo_periodo, estado, monto_total_clp
)
select
  ('c4000000-0000-0000-0000-'||lpad((i*10 + q)::text,12,'0'))::uuid,
  :tenant::uuid,
  ('c0000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
  d.inicio, d.fin, 'quincenal'::dinero.tipo_periodo,
  -- La quincena en curso queda abierta; las anteriores, cerradas.
  (case when d.fin >= (now() at time zone 'America/Santiago')::date then 'abierto' else 'cerrado' end)::dinero.estado_periodo,
  0
from generate_series(1,10) i
cross join lateral (
  select q, inicio, inicio + 14 as fin
  from (values
    (0, (now() at time zone 'America/Santiago')::date - 30),
    (1, (now() at time zone 'America/Santiago')::date - 15)
  ) as v(q, inicio)
) d
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 3. Pedidos — 30 días × ~650/día
-- -----------------------------------------------------------------------------
-- La distribución importa: si todos cayeran en la misma comuna o el mismo día, el
-- fixture no ejercitaría los agrupamientos ni los índices. Se reparte por comuna
-- (23), por seller (10), por conductor (15) y por estado con proporciones
-- parecidas a una operación real (mayoría entregada, algo fallido, poco devuelto).
insert into operacion.pedidos (
  id, tenant_id, seller_id, tipo_pedido, origen, estado, driver_id_asignado,
  destinatario_nombre, destinatario_direccion, destinatario_comuna, destinatario_telefono,
  fecha_compromiso, tarifa_aplicable_id,
  lat, long, geo_estado, cobertura_estado, codigo_interno, creado_en
)
select
  ('c2000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
  :tenant::uuid,
  ('c0000000-0000-0000-0000-'||lpad(((n % 10) + 1)::text,12,'0'))::uuid,
  'same_day',
  'same_day_manual',
  (case
     when dia = 0 and n % 5 < 3 then 'en_ruta'
     when n % 20 = 0 then 'fallido'
     when n % 97 = 0 then 'devuelto'
     else 'entregado'
   end)::operacion.estado_pedido,
  ('c1000000-0000-0000-0000-'||lpad(((n % 15) + 1)::text,12,'0'))::uuid,
  'Destinatario '||n,
  'Calle Carga '||(100 + (n % 900))||', depto '||(1 + (n % 40)),
  (array['Santiago','Providencia','Las Condes','Ñuñoa','Maipú','La Florida','Puente Alto',
         'Recoleta','Independencia','Quilicura','Renca','Cerrillos','Macul','Peñalolén',
         'La Reina','Vitacura','Conchalí','Estación Central','San Miguel','San Joaquín',
         'La Cisterna','Pudahuel','Colina'])[1 + (n % 23)],
  '+569'||lpad(((n * 7919) % 100000000)::text, 8, '0'),
  (now() at time zone 'America/Santiago')::date - dia,
  ('c3000000-0000-0000-0000-'||lpad(((n % 10) + 1)::text,12,'0'))::uuid,
  -33.38 - ((n % 250)::numeric / 1000),
  -70.52 - ((n % 320)::numeric / 1000),
  'resuelto'::operacion.geo_estado,
  'tarifada'::operacion.cobertura_estado,
  'CG-'||lpad(n::text,6,'0'),
  ((now() at time zone 'America/Santiago')::date - dia)::timestamptz + interval '9 hours'
from generate_series(0,29) dia
cross join lateral generate_series(dia * 650 + 1, dia * 650 + 650) n
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 4. Líneas de cobro y de liquidación para lo entregado
-- -----------------------------------------------------------------------------
insert into dinero.lineas_cobro (
  id, tenant_id, seller_id, pedido_id, periodo_cobro_id, tarifa_id,
  monto_base_clp, ajuste_incidencia_clp, concepto, tipo_pedido, fecha_entrega, origen_generacion
)
select
  ('c5000000-0000-0000-0000-'||substr(md5('lc-carga-'||p.id::text),1,12))::uuid,
  p.tenant_id, p.seller_id, p.id, per.id, p.tarifa_aplicable_id,
  t.monto_clp, 0,
  'Entrega same-day (carga)', 'same_day', p.fecha_compromiso, 'motor_automatico'
from operacion.pedidos p
join identidad.tarifas t on t.id = p.tarifa_aplicable_id
join dinero.periodos_cobro per
  on per.seller_id = p.seller_id
 and p.fecha_compromiso between per.fecha_inicio and per.fecha_fin
 and per.id::text like 'c4000000%'
where p.id::text like 'c2000000%'
  and p.estado in ('entregado','entregado_manual')
on conflict (pedido_id) do nothing;

insert into dinero.lineas_liquidacion (
  id, tenant_id, driver_id, pedido_id, monto_base_clp, ajuste_incidencia_clp,
  concepto, fecha_entrega, origen_generacion
)
select
  ('c6000000-0000-0000-0000-'||substr(md5('ll-carga-'||p.id::text),1,12))::uuid,
  p.tenant_id, p.driver_id_asignado, p.id,
  round(t.monto_clp * 0.62), 0,
  'Reparto same-day (carga)', p.fecha_compromiso, 'motor_automatico'
from operacion.pedidos p
join identidad.tarifas t on t.id = p.tarifa_aplicable_id
where p.id::text like 'c2000000%'
  and p.estado in ('entregado','entregado_manual')
  and p.driver_id_asignado is not null
on conflict (pedido_id) do nothing;

-- Flags coherentes con las líneas creadas (la lección del seed de demo).
update operacion.pedidos p
set cobro_generado = exists (select 1 from dinero.lineas_cobro l where l.pedido_id = p.id),
    liquidacion_generada = exists (select 1 from dinero.lineas_liquidacion l where l.pedido_id = p.id),
    monto_cobro_clp = (select l.monto_final_clp from dinero.lineas_cobro l where l.pedido_id = p.id),
    monto_liquidacion_clp = (select l.monto_final_clp from dinero.lineas_liquidacion l where l.pedido_id = p.id)
where p.id::text like 'c2000000%';

commit;

select
  (select count(*) from operacion.pedidos where id::text like 'c2000000%') as pedidos,
  (select count(*) from dinero.lineas_cobro where id::text like 'c5000000%') as lineas_cobro,
  (select count(*) from dinero.lineas_liquidacion where id::text like 'c6000000%') as lineas_liquidacion,
  (select count(*) from operacion.pedidos where id::text like 'c2000000%'
     and fecha_compromiso = (now() at time zone 'America/Santiago')::date) as pedidos_hoy;
