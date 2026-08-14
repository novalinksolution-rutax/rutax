-- =============================================================================
-- supabase/seed-demo-full.sql — Carga de demo COMPLETA (encima de seed.sql)
-- =============================================================================
-- NUNCA aplicar en producción. Solo datos: no crea ni altera objetos de esquema.
--
-- Objetivo: que ninguna pantalla del producto se vea vacía — dashboards con KPIs
-- y series temporales, tablas con filas, y secciones condicionales desbloqueadas.
--
-- Requisitos: `supabase/seed.sql` ya aplicado (tenant Despachos del Centro,
-- 3 sellers, 12 conductores, 4 tarifas, 6 usuarios demo, super-admin).
--
-- Aplicar:
--   docker exec -i supabase_db_SaaS_Courier_Again psql -U postgres -d postgres \
--     < supabase/seed-demo-full.sql
--
-- IDEMPOTENTE: todo inserta con ON CONFLICT DO NOTHING sobre PK o clave natural,
-- y los UPDATE son asignaciones absolutas (no incrementos). Re-ejecutable sin
-- duplicar. Los IDs se derivan del índice para ser estables entre corridas.
--
-- Consistencia del motor entrega→dinero (invariante del proyecto): cada pedido
-- entregado genera SU línea de cobro al seller y SU línea de liquidación al
-- conductor, ambas colgadas del período/liquidación que les corresponde por
-- fecha. Las excepciones de conciliación son POCAS y deliberadas (§13).
--
-- NOTA: `seed.sql` termina con un UPDATE que aplana `fecha_compromiso` de TODOS
-- los pedidos al día actual. Si vuelves a correr `supabase db seed`, re-aplica
-- este archivo después para recuperar la serie temporal.
--
-- ZONA HORARIA: "hoy" se ancla en `(now() at time zone 'America/Santiago')::date`,
-- NO en `current_date` (que en Postgres es UTC). Chile es UTC-4/-3, así que entre
-- las 20:00 y medianoche de Santiago el `current_date` de la BD ya es el día
-- siguiente: anclando por UTC, el demo quedaba un día adelantado respecto de lo
-- que la app pide y las pantallas del día salían vacías. La app calcula su "hoy"
-- con `fechaLocalEnSantiago()` (src/lib/fecha-santiago.ts) — este seed usa el
-- mismo calendario a propósito.
-- =============================================================================

\set ON_ERROR_STOP on

-- Prefijos de UUID usados aquí (para no chocar con seed.sql):
--   6d… pedidos      7d… manifiestos   a7… asignaciones   85… incidencias
--   a5… períodos     cd… líneas cobro  dd… líneas liq.    b5… liquidaciones
--   e5… DTE          f5… payouts       95… pagos recibidos c5… conciliación
--   11… zonas        12… ventanas      13… api/webhooks    14… tenants extra

do $$
begin
  raise notice 'seed-demo-full: cargando demo completa…';
end $$;


-- =============================================================================
-- 0. RE-ANCLAJE — mueve el demo al día de hoy si se aplicó otro día
-- =============================================================================
-- Los pedidos se insertan con ON CONFLICT DO NOTHING, así que re-aplicar el
-- archivo al día siguiente NO movía las fechas: el demo quedaba anclado al día
-- en que se cargó y las pantallas del día amanecían vacías.
--
-- Aquí se calcula el desfase entre "hoy" (calendario de Santiago) y el día más
-- reciente que tiene el lote sembrado, y se desplaza TODO el bloque —operación
-- y dinero— por esa misma cantidad de días. Al desplazar ambos lados juntos se
-- mantiene la invariante entrega→dinero: la línea de cobro y la de liquidación
-- siguen cayendo en la misma fecha que su entrega.
--
-- No hace nada si el desfase es 0 (mismo día) o si aún no hay datos sembrados.
do $$
declare
  v_tenant uuid := '10000000-0000-0000-0000-000000000001';
  v_hoy    date := (now() at time zone 'America/Santiago')::date;
  v_max    date;
  v_delta  int;
begin
  select max(fecha_compromiso) into v_max
  from operacion.pedidos
  where tenant_id = v_tenant and id::text like '6d000000%';

  if v_max is null then
    raise notice 're-anclaje: sin lote previo, nada que mover';
    return;
  end if;

  v_delta := v_hoy - v_max;
  if v_delta = 0 then
    raise notice 're-anclaje: el demo ya está en %', v_hoy;
    return;
  end if;

  raise notice 're-anclaje: desplazando el demo % día(s) (de % a %)', v_delta, v_max, v_hoy;

  update operacion.pedidos
  set fecha_compromiso      = fecha_compromiso + v_delta,
      fecha_compromiso_hora = fecha_compromiso_hora + make_interval(days => v_delta),
      creado_en             = creado_en + make_interval(days => v_delta),
      geocodificado_en      = geocodificado_en + make_interval(days => v_delta)
  where tenant_id = v_tenant and id::text like '6d000000%';

  -- El nombre lleva la fecha embebida ("Ruta Diego 24-07"): hay que reescribirlo
  -- al desplazar, si no la lista muestra un nombre y una fecha distintas.
  update operacion.manifiestos
  set fecha_operacion = fecha_operacion + v_delta,
      confirmado_en   = confirmado_en + make_interval(days => v_delta),
      completado_en   = completado_en + make_interval(days => v_delta),
      creado_en       = creado_en + make_interval(days => v_delta),
      nombre          = regexp_replace(nombre, '\d{2}-\d{2}$',
                          to_char(fecha_operacion + v_delta, 'DD-MM'))
  where tenant_id = v_tenant and id::text like '7d000000%';

  update operacion.asignaciones_pedido
  set asignado_en = asignado_en + make_interval(days => v_delta)
  where tenant_id = v_tenant and id::text like 'a7000000%';

  -- Dinero: se mueve con la operación para no romper el cruce entrega→dinero.
  update dinero.lineas_cobro
  set fecha_entrega = fecha_entrega + v_delta,
      creado_en     = creado_en + make_interval(days => v_delta)
  where tenant_id = v_tenant and id::text like 'cd000000%';

  update dinero.lineas_liquidacion
  set fecha_entrega = fecha_entrega + v_delta,
      creado_en     = creado_en + make_interval(days => v_delta)
  where tenant_id = v_tenant and id::text like 'dd000000%';

  -- Evidencias y cierres cuelgan de la fecha de su pedido.
  update operacion.pruebas_entrega   set capturado_en = capturado_en + make_interval(days => v_delta) where tenant_id = v_tenant;
  update operacion.evidencias_entrega set capturado_en = capturado_en + make_interval(days => v_delta),
                                          subido_en    = subido_en + make_interval(days => v_delta)   where tenant_id = v_tenant;
  update operacion.cierres_conductor  set cerrado_en   = cerrado_en + make_interval(days => v_delta)   where tenant_id = v_tenant;
end $$;

-- Los 16 pedidos de `seed.sql` quedan con `fecha_compromiso` aplanada al día en
-- que se corrió ese seed, mientras sus líneas de dinero conservan las fechas de
-- junio con que se escribieron: un pedido "de hoy" con su cobro de hace un mes.
-- Se alinea el pedido a la fecha de SU entrega (la del dinero manda, porque es
-- la que decide a qué período pertenece la línea).
update operacion.pedidos p
set fecha_compromiso = l.fecha_entrega
from dinero.lineas_cobro l
where l.pedido_id = p.id
  and p.tenant_id = '10000000-0000-0000-0000-000000000001'
  and p.fecha_compromiso is distinct from l.fecha_entrega;


-- =============================================================================
-- 1. Zonas de cobertura + comunas + ventanas de corte
-- =============================================================================
insert into identidad.zonas (id, tenant_id, nombre, activa) values
  ('11000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Centro',true),
  ('11000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Oriente',true),
  ('11000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Sur',true),
  ('11000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','Poniente y Norte',true),
  ('11000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','Periferia (sin cobertura)',false)
on conflict (id) do nothing;

insert into identidad.zona_comunas (tenant_id, zona_id, comuna)
select '10000000-0000-0000-0000-000000000001', z.zona::uuid, z.comuna
from (values
  ('11000000-0000-0000-0000-000000000001','Santiago'),
  ('11000000-0000-0000-0000-000000000001','Recoleta'),
  ('11000000-0000-0000-0000-000000000001','Providencia'),
  ('11000000-0000-0000-0000-000000000002','Las Condes'),
  ('11000000-0000-0000-0000-000000000002','La Reina'),
  ('11000000-0000-0000-0000-000000000002','Ñuñoa'),
  ('11000000-0000-0000-0000-000000000002','Peñalolén'),
  ('11000000-0000-0000-0000-000000000003','San Miguel'),
  ('11000000-0000-0000-0000-000000000003','La Cisterna'),
  ('11000000-0000-0000-0000-000000000003','La Florida'),
  ('11000000-0000-0000-0000-000000000003','Puente Alto'),
  ('11000000-0000-0000-0000-000000000004','Pudahuel'),
  ('11000000-0000-0000-0000-000000000004','Quilicura'),
  ('11000000-0000-0000-0000-000000000004','Maipú')
) as z(zona, comuna)
on conflict (tenant_id, comuna) do nothing;

-- Ventanas de corte por seller (fallback del tenant, zona_id null).
insert into identidad.ventanas_corte
  (id, tenant_id, seller_id, zona_id, tipo_entrega, hora_corte,
   minutos_preparacion, minutos_ruta_estimado, sla_objetivo_pct, activa)
values
  ('12000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001', null,'same_day','14:00',45,120,97.00,true),
  ('12000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000002', null,'same_day','15:30',30,150,95.00,true),
  ('12000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000003', null,'same_day','12:00',60,180,98.00,true)
on conflict (id) do nothing;

-- Conductores asignados a zonas (los 12, repartidos en las 4 zonas activas).
insert into identidad.conductor_zonas (tenant_id, conductor_id, zona_id)
select
  '10000000-0000-0000-0000-000000000001',
  ('40000000-0000-0000-0000-'||lpad(k::text,12,'0'))::uuid,
  ('11000000-0000-0000-0000-'||lpad((((k-1)%4)+1)::text,12,'0'))::uuid
from generate_series(1,12) as k
on conflict (tenant_id, conductor_id, zona_id) do nothing;

-- Disponibilidad y capacidad variadas (la UI de conductores las muestra).
update identidad.conductores c
set disponible      = (right(c.id::text,1)::text not in ('9','b')),
    capacidad_paradas = 25 + (abs(('x'||substr(md5(c.id::text),1,4))::bit(16)::int) % 4) * 5
where c.tenant_id = '10000000-0000-0000-0000-000000000001';

-- Un par de conductores inactivos (para el filtro de estado). Un conductor
-- inactivo NO puede quedar "disponible": si no, el encabezado dice cosas como
-- "10 activos · 11 disponibles hoy" y la ficha muestra Inactivo + Disponible.
update identidad.conductores
set estado = 'inactivo', disponible = false
where id in ('40000000-0000-0000-0000-000000000011',
             '40000000-0000-0000-0000-000000000012');


-- =============================================================================
-- 1b. Bodegas — el resto de la parrilla (seed.sql ya sembró las principales)
-- =============================================================================
-- `seed.sql` deja el caso base completo: 6 bodegas de seller (3 + 2 + 1, con una
-- inactiva y una sin geocodificar) y 1 del courier, todas las PRINCIPALES
-- incluidas. Este archivo agrega lo que le falta a una demo con volumen:
--
--   · los DOS estados de geocoding que no estaban — 'pendiente' (recién cargada,
--     el job todavía no pasó: nace así según la migración) y 'fuera_cobertura'
--     (la dirección se resolvió pero la comuna NO es de la RM, y por eso el
--     adaptador descarta la coordenada — ver google.ts:194-204). Con esto la
--     pantalla tiene los CUATRO valores del CHECK sembrados y ninguno se
--     descubre en producción;
--   · una segunda bodega del courier ACTIVA → el origen de ruta pasa a ser una
--     elección y no un dato único, que es lo que la etapa 7 va a necesitar;
--   · una tercera del courier DADA DE BAJA;
--   · más multi-bodega: FalabellaTech queda con 5, MercadoSur con 4 y TecnoHogar
--     con 3. Agrupar y ordenar bodegas se rompe con tres sellers desiguales,
--     no con tres sellers de una bodega cada uno;
--   · un contacto a medias en cada dirección (solo teléfono aquí; solo nombre en
--     seed.sql) — la tarjeta imprime el separador " · " únicamente cuando están
--     los dos, y ese camino hay que poder verlo roto y sano.
--
-- NINGUNA de estas es principal: la principal de cada seller y la del courier ya
-- las marcó `seed.sql`, y los índices parciales (seller_bodegas_principal_uk,
-- courier_bodegas_principal_uk) admiten como máximo una. Marcar otra aquí
-- abortaría el seed con 23505.
--
-- IDEMPOTENTE: ids fijos (prefijos 7b1…/7c1…, distintos de los 7b0…/7c0… de
-- seed.sql) + `on conflict (id) do nothing`. Sin componente de fecha en el id,
-- así que este bloque NO participa del bug abierto de ids con mes relativo.
insert into identidad.seller_bodegas (
  id, tenant_id, seller_id, nombre, direccion, comuna,
  instrucciones_acceso, contacto_nombre, contacto_telefono,
  es_principal, activa,
  lat, long, geo_estado, geo_confianza, geocodificado_en
) values
  -- FalabellaTech (+2 → 5 en total)
  -- Recién cargada: geo_estado 'pendiente' y sin coordenada. Es el estado con
  -- que NACE toda bodega, y mientras dure no puede ser origen de una ruta.
  ('7b100000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   'Bodega Colina','Ruta 5 Norte km 24, Lote 7','Colina',
   'Camino interior sin numeración: pasar el peaje y doblar en el letrero de la planta. Avisar por teléfono al llegar.',
   null, null,
   false, true,
   null, null, 'pendiente', null, null),

  -- Contacto a medias en la otra dirección: teléfono sin nombre.
  ('7b100000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   'Bodega Estación Central','Av. Ecuador 4650','Estación Central',
   null,
   null,'+56952330714',
   false, true,
   -33.4536, -70.6913, 'resuelto', 0.900, now() - interval '27 days'),

  -- MercadoSur (+2 → 4 en total)
  ('7b100000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000002',
   'Bodega Puente Alto','Av. Concha y Toro 2450','Puente Alto',
   'Retiro por el patio trasero. Hay una sola bahía: si está ocupada, esperar en la calle y no bloquear el acceso vecino.',
   'Ximena Bustos','+56977410352',
   false, true,
   -33.5901, -70.5872, 'resuelto', 0.890, now() - interval '22 days'),

  -- FUERA DE COBERTURA: la dirección existe, pero la comuna no es de la RM y el
  -- courier no opera ahí. El adaptador devuelve el estado SIN coordenada, así
  -- que lat/long y confianza van NULL aunque la dirección se haya resuelto.
  ('7b100000-0000-0000-0000-000000000004',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000002',
   'Bodega Valparaíso','Av. Argentina 1200','Valparaíso',
   'Fuera del radio de operación del courier. Se conserva para el traspaso de carga que hace el propio seller.',
   'Iván Escobar','+56942088531',
   false, true,
   null, null, 'fuera_cobertura', null, now() - interval '9 days'),

  -- TecnoHogar (+2 → 3 en total)
  ('7b100000-0000-0000-0000-000000000005',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000003',
   'Showroom Providencia','Av. Providencia 2124, local 3','Providencia',
   null,
   'Andrea Lillo','+56963275140',
   false, true,
   -33.4207, -70.6086, 'resuelto', 0.930, now() - interval '14 days'),

  -- Segunda bodega DADA DE BAJA de la demo, y en otro seller que la de seed.sql:
  -- la sección "Inactivas" no puede aparecer solo en una tarjeta del listado.
  ('7b100000-0000-0000-0000-000000000006',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000003',
   'Bodega Independencia','Av. Independencia 3210','Independencia',
   'Arriendo terminado en marzo. No mandar conductores.',
   'Rodrigo Alcaíno','+56986541209',
   false, false,
   -33.4028, -70.6638, 'resuelto', 0.860, now() - interval '210 days')
on conflict (id) do nothing;

-- Bodegas del courier: una satélite activa (segundo origen posible de ruta) y
-- una antigua dada de baja. La principal sigue siendo 'Central Cerrillos', de
-- seed.sql. Ojo: courier_bodegas_tenant_nombre_uk NO es parcial por `activa` —
-- el nombre de un galpón del courier no se recicla ni después de darlo de baja.
insert into identidad.courier_bodegas (
  id, tenant_id, nombre, direccion, comuna,
  instrucciones_acceso, es_principal, activa,
  lat, long, geo_estado, geo_confianza, geocodificado_en
) values
  ('7c100000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   'Satélite Puente Alto','Av. Gabriela Oriente 1450','Puente Alto',
   'Bodega de apoyo para el sur. Solo se consolida acá cuando la carga de La Florida y Puente Alto pasa de 200 bultos.',
   false, true,
   -33.5975, -70.5788, 'resuelto', 0.910, now() - interval '38 days'),

  ('7c100000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001',
   'Antigua central Recoleta','Av. Dorsal 1980','Recoleta',
   null,
   false, false,
   -33.3941, -70.6487, 'resuelto', 0.880, now() - interval '300 days')
on conflict (id) do nothing;


-- =============================================================================
-- 2. Tarifas adicionales (por zona + recargos) — pantalla de tarifas
-- =============================================================================
insert into identidad.tarifas
  (id, tenant_id, seller_id, tipo_entrega, zona, zona_id, modo_calculo, monto_clp,
   monto_conductor_clp, vigente_desde, vigente_hasta, estado,
   minimo_facturacion_clp, recargo_reprogramacion_clp)
values
  ('50000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001',
   null,'flex','Oriente','11000000-0000-0000-0000-000000000002','por_zona',4200,2600,
   '2026-01-01', null,'activa',60000,900),
  ('50000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001',
   null,'flex','Sur','11000000-0000-0000-0000-000000000003','por_zona',3900,2400,
   '2026-01-01', null,'activa',60000,900),
  ('50000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000003','same_day',null,null,'monto_fijo',5200,3100,
   '2026-03-01', null,'activa',null,1200),
  -- Tarifa histórica ya vencida (para el filtro "inactiva")
  ('50000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001','flex',null,null,'monto_fijo',3400,2100,
   '2025-06-01','2025-12-31','inactiva',null,null)
on conflict (id) do nothing;

update identidad.tarifas
set minimo_facturacion_clp = coalesce(minimo_facturacion_clp, 50000),
    recargo_reprogramacion_clp = coalesce(recargo_reprogramacion_clp, 800)
where tenant_id = '10000000-0000-0000-0000-000000000001'
  and estado = 'activa';


-- =============================================================================
-- 3. Conexiones ML — multicuenta y los 3 estados de salud
-- =============================================================================
-- FalabellaTech con DOS cuentas (activa el badge de cuenta de origen en la UI,
-- que solo se muestra cuando el seller tiene más de una). TecnoHogar cae a
-- `desvinculada` para poblar el banner rojo del dashboard y el aviso in-app.
insert into identidad.conexiones_seller_ml
  (id, tenant_id, seller_id, ml_user_id, estado_salud, alias, ml_nickname,
   ultima_sync_exitosa_en, desconectada_desde, ultimo_error, token_expira_en)
values
  ('e1000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001','ML_USER_FT_98765','atencion',
   'Outlet FalabellaTech','FALABELLATECH_OUTLET',
   now() - interval '19 hours', null,'Refresco de token con reintentos', now() + interval '2 days'),
  ('e1000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000002','ML_USER_MS_22222','sana',
   'MercadoSur Premium','MERCADOSUR_PREMIUM',
   now() - interval '25 minutes', null, null, now() + interval '5 days')
on conflict (id) do nothing;

update identidad.conexiones_seller_ml
set alias = 'Tienda principal', ml_nickname = 'FALABELLATECH_CL',
    token_expira_en = now() + interval '4 days'
where id = 'e1000000-0000-0000-0000-000000000001';

update identidad.conexiones_seller_ml
set alias = 'Tienda MercadoSur', ml_nickname = 'MERCADOSUR_CL',
    token_expira_en = now() + interval '6 days'
where id = 'e1000000-0000-0000-0000-000000000002';

-- TecnoHogar: conexión caída de verdad (banner + aviso "Reconectar").
update identidad.conexiones_seller_ml
set estado_salud    = 'desvinculada',
    alias           = 'TecnoHogar Chile',
    ml_nickname     = 'TECNOHOGAR_CL',
    desconectada_desde = now() - interval '9 hours',
    ultimo_error    = 'refresh_token inválido — el seller debe reautorizar en su portal'
where id = 'e1000000-0000-0000-0000-000000000003';

-- Intentos de backfill (pantalla de salud de conexiones).
insert into operacion.intentos_backfill
  (id, tenant_id, conexion_ml_id, seller_id, desde, hasta, estado,
   pedidos_recuperados, error, iniciado_en, completado_en)
values
  ('13000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
   'e1000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000003',
   now() - interval '2 days', now() - interval '1 day','completado',14,null,
   now() - interval '1 day', now() - interval '23 hours'),
  ('13000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',
   'e1000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000003',
   now() - interval '10 hours', now(),'fallido',0,
   'La conexión sigue desvinculada: no se pudo renovar el token',
   now() - interval '9 hours', now() - interval '9 hours' + interval '40 seconds'),
  ('13000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001',
   'e1000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000001',
   now() - interval '20 hours', now() - interval '4 hours','pendiente',null,null,
   now() - interval '30 minutes', null)
on conflict (id) do nothing;


-- =============================================================================
-- 4. Pedidos — 960 filas sobre los últimos 75 días + refuerzo de HOY
-- =============================================================================
-- i = 1..900  → 12 pedidos/día durante 75 días (serie temporal para los charts)
-- i = 901..960 → 60 pedidos extra con fecha de HOY (para que el panel del día
--                y la asignación se vean con carga real)
--
-- Reparto: 3 sellers, 12 conductores, 14 comunas RM, ~20% same-day.
-- Estados: los días pasados quedan mayormente cerrados (tasa de entrega ~90%);
-- HOY queda con la mezcla viva (pendiente/asignado/en_ruta/entregado/fallido).
insert into operacion.pedidos (
  id, tenant_id, seller_id, tipo_pedido, origen,
  ml_order_id, ml_shipment_id, ml_user_id, codigo_interno,
  estado, estado_ml, subestado_ml, ultima_sync_ml_en,
  driver_id_asignado,
  destinatario_nombre, destinatario_direccion, destinatario_comuna,
  destinatario_telefono, instrucciones_entrega,
  fecha_compromiso, fecha_compromiso_hora,
  tarifa_aplicable_id,
  monto_cobro_clp, monto_liquidacion_clp, cobro_generado, liquidacion_generada,
  lat, long, geo_estado, geo_confianza, geocodificado_en, cobertura_estado,
  corte_riesgo, sla_cumplido, tracking_token,
  creado_en
)
select
  g.pid,
  '10000000-0000-0000-0000-000000000001',
  g.seller_id,
  g.tipo_pedido,
  case when g.tipo_pedido = 'same_day' then 'same_day_manual'::operacion.origen_pedido
       when g.i % 61 = 0 then 'backfill'::operacion.origen_pedido
       else 'ml_ingesta'::operacion.origen_pedido end,
  case when g.tipo_pedido = 'flex' then 'ML-ORD-'||to_char(g.fecha,'YYYYMMDD')||'-'||lpad(g.i::text,5,'0') end,
  case when g.tipo_pedido = 'flex' then 'FLEX-2026-'||lpad((500000 + g.i)::text,6,'0') end,
  case when g.tipo_pedido = 'flex' then g.ml_user_id end,
  case when g.tipo_pedido = 'same_day' then 'SD-'||lpad(g.i::text,5,'0') end,
  g.estado,
  case when g.tipo_pedido = 'flex' then
    case g.estado
      when 'entregado' then 'delivered'
      when 'entregado_manual' then 'delivered'
      when 'fallido' then 'not_delivered'
      when 'fallido_manual' then 'not_delivered'
      when 'devuelto' then 'not_delivered'
      when 'cancelado' then 'cancelled'
      when 'en_ruta' then 'shipped'
      when 'asignado' then 'ready_to_ship'
      else 'ready_to_ship' end
  end,
  case when g.tipo_pedido = 'flex' and g.estado in ('fallido','fallido_manual','devuelto')
       then 'receiver_absent' end,
  case when g.tipo_pedido = 'flex' then g.momento + interval '3 hours' end,
  g.driver_id,
  g.nombre,
  g.calle||' '||(120 + (g.i % 880))::text||
    case when g.i % 7 = 0 then ', Dpto '||(10 + g.i % 90)::text else '' end,
  g.comuna,
  '+569'||lpad(((g.i * 7919) % 100000000)::text, 8, '0'),
  case when g.i % 11 = 0 then 'Dejar en conserjería'
       when g.i % 13 = 0 then 'Llamar al llegar'
       when g.i % 17 = 0 then 'Portón negro, tocar el timbre 2 veces' end,
  g.fecha,
  g.momento,
  g.tarifa_id,
  case when g.entregado then g.monto_cobro end,
  case when g.entregado and g.driver_id is not null then g.monto_liq end,
  g.entregado,
  (g.entregado and g.driver_id is not null),
  case when g.geo_estado = 'resuelto' then g.lat end,
  case when g.geo_estado = 'resuelto' then g.long end,
  g.geo_estado::operacion.geo_estado,
  case when g.geo_estado = 'resuelto' then 0.50 + ((g.i % 45)::numeric / 100) end,
  case when g.geo_estado <> 'pendiente' then g.momento - interval '6 hours' end,
  g.cobertura_estado::operacion.cobertura_estado,
  (g.d = 0 and g.tipo_pedido = 'same_day' and g.i % 4 = 0),
  -- SLA = puntualidad de lo ENTREGADO. Un pedido fallido no es "fuera de plazo":
  -- ya lo castiga la tasa de entrega. Se deja null para no contarlo dos veces.
  -- Módulo distinto por seller → cada uno cae en un tramo distinto del semáforo.
  case when g.entregado then
    case ((g.i - 1) % 3) + 1
      when 1 then (g.i % 41 <> 0)
      when 2 then (g.i % 19 <> 0)
      else (g.i % 29 <> 0) end
  end,
  -- tracking_token: SOLO same-day, igual que producción (`crearPedidoSameDay` en
  -- operacion/pedidos.ts). En Flex el comprador hace seguimiento en Mercado Libre,
  -- y `/tracking/[token]` rechaza cualquier pedido que no sea same-day. Antes el
  -- seed se lo ponía a los ~1.600 Flex también, lo que contradecía el comentario
  -- de la columna y hacía que los datos de demo no representaran la invariante.
  --
  -- Sigue siendo un md5 determinista (y no `gen_random_uuid()`) porque el seed
  -- tiene que ser idempotente: re-aplicarlo debe producir los mismos valores. Es
  -- adivinable, y da igual en datos de demo — pero por eso mismo este seed NUNCA
  -- debe cargarse en un ambiente accesible desde internet.
  case when g.tipo_pedido = 'same_day'
       then substr(md5('rutax-track-'||g.i::text), 1, 24) end,
  g.momento - interval '14 hours'
from (
  select
    s.i,
    s.d,
    s.fecha,
    (s.fecha + time '09:00' + (s.i % 9) * interval '1 hour')::timestamptz as momento,
    ('6d000000-0000-0000-0000-'||lpad(s.i::text,12,'0'))::uuid as pid,
    s.seller_id,
    s.tipo_pedido,
    s.estado,
    s.estado in ('entregado','entregado_manual') as entregado,
    case when s.estado = 'pendiente_asignacion' then null
         else ('40000000-0000-0000-0000-'||lpad((((s.i - 1) % 12) + 1)::text,12,'0'))::uuid end as driver_id,
    case
      when s.seller_id = '30000000-0000-0000-0000-000000000001'::uuid
        then (array['ML_USER_FT_12345','ML_USER_FT_98765'])[(s.i % 2) + 1]
      when s.seller_id = '30000000-0000-0000-0000-000000000002'::uuid
        then (array['ML_USER_MS_67890','ML_USER_MS_22222'])[(s.i % 2) + 1]
      else 'ML_USER_TH_11111' end as ml_user_id,
    s.tarifa_id,
    s.monto_cobro,
    s.monto_liq,
    (array['Providencia','Ñuñoa','Las Condes','San Miguel','La Cisterna','Pudahuel',
           'La Florida','Peñalolén','Quilicura','Recoleta','Santiago','La Reina',
           'Maipú','Puente Alto'])[(s.i % 14) + 1] as comuna,
    (array[-33.4314,-33.4564,-33.4089,-33.4972,-33.5333,-33.4417,
           -33.5500,-33.4889,-33.3667,-33.4000,-33.4489,-33.4444,
           -33.5167,-33.6167])[(s.i % 14) + 1] as lat,
    (array[-70.6111,-70.5969,-70.5683,-70.6500,-70.6625,-70.7583,
           -70.5833,-70.5417,-70.7333,-70.6417,-70.6693,-70.5375,
           -70.7667,-70.5833])[(s.i % 14) + 1] as long,
    (array['Av. Providencia','Calle Los Aromos','Av. Irarrázaval','Gran Avenida',
           'Av. Vicuña Mackenna','Pasaje Los Boldos','Av. Las Condes','Calle Catedral',
           'Av. Tobalaba','Calle Antártica','Av. El Salto','Av. Grecia',
           'Av. Pajaritos','Av. Concha y Toro'])[(s.i % 14) + 1] as calle,
    (array['Ana María Torres','Roberto Díaz Pizarro','Marcela Fuentes Rojas',
           'Luis Alberto Campos','Sofía Guzmán Arenas','Carla Ortiz Muñoz',
           'Gustavo Herrera Lagos','Patricia Sánchez Leiva','Marco Peña Riquelme',
           'Isabel Núñez Carrasco','Rodrigo Espinoza Castro','Ximena Bravo Navarro',
           'Daniela Mora Cisternas','Héctor Miranda Tapia','Javiera Pizarro Soto',
           'Fernando Valenzuela Rojas','Constanza Aguirre Lillo','Mauricio Salas Vera',
           'Paulina Cáceres Godoy','Tomás Barrientos Ruiz'])[(s.i % 20) + 1] as nombre,
    -- Anomalías de geocoding SOLO en pedidos no entregados y recientes: son las
    -- que la bandeja "Direcciones por revisar" debe mostrar como accionables.
    case
      when s.estado in ('entregado','entregado_manual') then 'resuelto'
      when s.d <= 2 and s.i % 19 = 0 then 'no_resuelto'
      when s.d <= 2 and s.i % 23 = 0 then 'fuera_cobertura'
      else 'resuelto' end as geo_estado,
    case
      when s.estado in ('entregado','entregado_manual') then 'tarifada'
      when s.d <= 2 and s.i % 23 = 0 then 'sin_tarifa_zona'
      when s.d <= 2 and s.i % 29 = 0 then 'requiere_revision'
      else 'tarifada' end as cobertura_estado
  from (
    select
      t.i,
      t.d,
      ((now() at time zone 'America/Santiago')::date - t.d)::date as fecha,
      ('30000000-0000-0000-0000-'||lpad((((t.i - 1) % 3) + 1)::text,12,'0'))::uuid as seller_id,
      (case when t.i % 5 = 0 then 'same_day' else 'flex' end)::operacion.tipo_pedido as tipo_pedido,
      case
        when t.d = 0 then
          case
            when t.i % 20 < 5  then 'pendiente_asignacion'
            when t.i % 20 < 9  then 'asignado'
            when t.i % 20 < 14 then 'en_ruta'
            when t.i % 20 < 18 then 'entregado'
            when t.i % 20 = 18 then 'fallido'
            else 'entregado_manual' end
        else
          case
            when t.i % 53 = 0 then 'cancelado'
            when t.i % 20 = 18 then 'fallido'
            when t.i % 20 = 19 then 'devuelto'
            when t.i % 20 = 17 then 'entregado_manual'
            when t.i % 20 = 16 and t.i % 3 = 0 then 'fallido_manual'
            else 'entregado' end
      end::operacion.estado_pedido as estado,
      case
        when t.i % 5 = 0 then '50000000-0000-0000-0000-000000000002'::uuid
        when ((t.i - 1) % 3) + 1 = 1 then '50000000-0000-0000-0000-000000000003'::uuid
        when ((t.i - 1) % 3) + 1 = 2 then '50000000-0000-0000-0000-000000000004'::uuid
        else '50000000-0000-0000-0000-000000000001'::uuid end as tarifa_id,
      case
        when t.i % 5 = 0 then 4500
        when ((t.i - 1) % 3) + 1 = 1 then 3800
        when ((t.i - 1) % 3) + 1 = 2 then 3200
        else 3500 end as monto_cobro,
      case
        when t.i % 5 = 0 then 2800
        when ((t.i - 1) % 3) + 1 = 1 then 2400
        when ((t.i - 1) % 3) + 1 = 2 then 2000
        else 2200 end as monto_liq
    from (
      select i, case when i <= 900 then ((i - 1) / 12) else 0 end as d
      from generate_series(1, 960) as i
    ) t
  ) s
) g
on conflict (id) do nothing;


-- =============================================================================
-- 5. Manifiestos (10 días × 12 conductores) + asignaciones
-- =============================================================================
insert into operacion.manifiestos
  (id, tenant_id, driver_id, nombre, fecha_operacion, estado, notas,
   creado_por_usuario_id, confirmado_en, completado_en, creado_en)
select
  ('7d000000-0000-0000-0000-'||lpad((m.d * 12 + m.k)::text,12,'0'))::uuid,
  '10000000-0000-0000-0000-000000000001',
  c.id,
  'Ruta '||split_part(c.nombre_completo, ' ', 1)||' '||to_char((now() at time zone 'America/Santiago')::date - m.d, 'DD-MM'),
  ((now() at time zone 'America/Santiago')::date - m.d)::date,
  m.estado::operacion.estado_manifiesto,
  case when m.estado = 'cancelado' then 'Conductor con licencia médica — ruta redistribuida' end,
  '20000000-0000-0000-0000-000000000003',
  case when m.estado <> 'borrador'
       then (((now() at time zone 'America/Santiago')::date - m.d) + time '07:30')::timestamptz end,
  case when m.estado = 'completado'
       then (((now() at time zone 'America/Santiago')::date - m.d) + time '18:20')::timestamptz end,
  (((now() at time zone 'America/Santiago')::date - m.d) + time '06:45')::timestamptz
from (
  select
    d, k,
    -- El conductor demo (conductor.demo@…) es el conductor 1: su manifiesto de
    -- HOY tiene que estar en ruta, si no la app del conductor abre vacía con
    -- "Tu ruta de hoy todavía no está lista".
    case
      when d = 0 then
        case
          when k <= 5 then 'en_ruta'
          when k <= 7 then 'confirmado'
          when k <= 9 then 'borrador'
          when k <= 11 then 'completado'
          else 'cancelado' end
      when (d * 12 + k) % 37 = 0 then 'cancelado'
      else 'completado' end as estado
  from generate_series(0, 9) as d, generate_series(1, 12) as k
) m
join identidad.conductores c
  on c.id = ('40000000-0000-0000-0000-'||lpad(m.k::text,12,'0'))::uuid
on conflict (id) do nothing;

-- El estado lo decide la fórmula, no quién creó la fila: con ON CONFLICT DO
-- NOTHING una corrida previa dejaría estados viejos congelados. `n` es el
-- índice codificado en el UUID (n = d*12 + k).
update operacion.manifiestos mf
set estado = x.estado::operacion.estado_manifiesto,
    confirmado_en = case when x.estado <> 'borrador'
                         then (mf.fecha_operacion + time '07:30')::timestamptz end,
    completado_en = case when x.estado = 'completado'
                         then (mf.fecha_operacion + time '18:20')::timestamptz end
from (
  select
    ('7d000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid as id,
    case
      when (n - 1) / 12 = 0 then
        case
          when n - 12 * ((n - 1) / 12) <= 5 then 'en_ruta'
          when n - 12 * ((n - 1) / 12) <= 7 then 'confirmado'
          when n - 12 * ((n - 1) / 12) <= 9 then 'borrador'
          when n - 12 * ((n - 1) / 12) <= 11 then 'completado'
          else 'cancelado' end
      when n % 37 = 0 then 'cancelado'
      else 'completado' end as estado
  from generate_series(1, 120) as n
) x
where mf.id = x.id;

-- Asignación activa de cada pedido con conductor al manifiesto de ese conductor
-- y esa fecha. Los denormalizados (driver_id, seller_id) los valida un trigger.
insert into operacion.asignaciones_pedido
  (id, tenant_id, pedido_id, manifiesto_id, driver_id, seller_id, activa,
   asignado_por_usuario_id, asignado_en)
select
  ('a7000000-0000-0000-0000-'||substr(md5(p.id::text), 1, 12))::uuid,
  p.tenant_id, p.id, mf.id, p.driver_id_asignado, p.seller_id, true,
  '20000000-0000-0000-0000-000000000003',
  (p.fecha_compromiso + time '07:40')::timestamptz
from operacion.pedidos p
join operacion.manifiestos mf
  on mf.tenant_id = p.tenant_id
 and mf.driver_id = p.driver_id_asignado
 and mf.fecha_operacion = p.fecha_compromiso
 and mf.estado <> 'cancelado'
where p.tenant_id = '10000000-0000-0000-0000-000000000001'
  and p.driver_id_asignado is not null
  and p.id::text like '6d000000%'
on conflict do nothing;


-- =============================================================================
-- 6. Incidencias — los 7 tipos × los 4 estados, con algunas sin gestión >4h
-- =============================================================================
insert into operacion.incidencias
  (id, tenant_id, pedido_id, seller_id, tipo, estado, descripcion,
   notas_resolucion, afecta_cobro, afecta_liquidacion,
   abierta_por_usuario_id, resuelta_por_usuario_id, abierta_en, resuelta_en)
select
  ('85000000-0000-0000-0000-'||substr(md5('inc-'||p.id::text), 1, 12))::uuid,
  p.tenant_id, p.id, p.seller_id,
  x.tipo::operacion.tipo_incidencia,
  x.estado::operacion.estado_incidencia,
  x.descripcion,
  case when x.estado in ('resuelta','cerrada') then x.resolucion end,
  x.afecta_cobro,
  x.afecta_liq,
  '20000000-0000-0000-0000-000000000003',
  case when x.estado in ('resuelta','cerrada') then '20000000-0000-0000-0000-000000000002'::uuid end,
  t.abierta_en,
  case when x.estado in ('resuelta','cerrada') then t.abierta_en + interval '5 hours' end
from (
  select
    p.*,
    row_number() over (order by p.fecha_compromiso desc, p.id) as rn
  from operacion.pedidos p
  where p.tenant_id = '10000000-0000-0000-0000-000000000001'
    and p.id::text like '6d000000%'
    and p.estado in ('fallido','fallido_manual','devuelto','en_ruta','entregado')
) p
join (
  values
    (1,'destinatario_ausente','abierta','Nadie responde en el domicilio tras dos intentos.','Se acordó nueva visita.',true,false),
    (2,'direccion_erronea','abierta','La numeración indicada no existe en la calle.','Dirección corregida con el seller.',true,true),
    (3,'paquete_danado','en_gestion','Caja con daño visible al recibir en bodega.','Se repone el producto.',true,false),
    (4,'rechazo_destinatario','en_gestion','El destinatario rechaza el paquete sin abrirlo.','Devuelto al seller.',true,false),
    (5,'problema_acceso','resuelta','Condominio no autoriza el ingreso del repartidor.','Entrega en portería.',false,false),
    (6,'reagendado','resuelta','Cliente pide reagendar para mañana entre 10 y 13 hrs.','Reprogramado y entregado.',false,false),
    (7,'otro','cerrada','Zona con corte de calle por evento municipal.','Ruta redirigida.',false,false),
    (8,'destinatario_ausente','cerrada','Sin moradores en tres intentos consecutivos.','Devuelto al seller.',true,true),
    (9,'reagendado','abierta','El comprador solicita cambio de dirección de entrega.','Pendiente de confirmar.',true,false),
    (10,'direccion_erronea','en_gestion','Comuna informada no coincide con la calle.','En verificación.',true,false),
    (11,'problema_acceso','abierta','Portón cerrado, sin conserje en el horario de reparto.','Reintento programado.',false,false),
    (12,'paquete_danado','resuelta','Embalaje mojado por lluvia durante el traslado.','Se emitió nota interna.',true,true)
) as x(slot, tipo, estado, descripcion, resolucion, afecta_cobro, afecta_liq)
  on ((p.rn - 1) % 12) + 1 = x.slot
join lateral (
  select case
    -- Las "abiertas" quedan con más de 4 horas para poblar el aviso
    -- "incidencias sin gestionar" y el bloque del dashboard.
    when x.estado = 'abierta' then now() - ((5 + (p.rn % 20)) * interval '1 hour')
    else (p.fecha_compromiso + time '13:00')::timestamptz
  end as abierta_en
) t on true
where p.rn <= 96
on conflict (id) do nothing;

-- Evidencias adjuntas a incidencias (paths de Storage, no URLs).
insert into operacion.evidencias_incidencia
  (id, tenant_id, incidencia_id, seller_id, tipo_archivo, storage_path,
   nombre_original, subido_por_usuario_id)
select
  ('86000000-0000-0000-0000-'||substr(md5('ev-'||i.id::text), 1, 12))::uuid,
  i.tenant_id, i.id, i.seller_id,
  case when row_number() over (order by i.id) % 3 = 0 then 'documento' else 'imagen' end,
  i.tenant_id||'/incidencias/'||i.id||'/evidencia-1',
  case when row_number() over (order by i.id) % 3 = 0 then 'acta-devolucion.pdf' else 'foto-paquete.jpg' end,
  '20000000-0000-0000-0000-000000000003'
from operacion.incidencias i
where i.tenant_id = '10000000-0000-0000-0000-000000000001'
  and i.tipo in ('paquete_danado','direccion_erronea','rechazo_destinatario')
on conflict (id) do nothing;


-- =============================================================================
-- 7. POD / evidencias de entrega / cierres de conductor
-- =============================================================================
-- POD autoritativo: solo same-day (lo impone un trigger de la tabla).
insert into operacion.pruebas_entrega
  (id, tenant_id, pedido_id, seller_id, conductor_id, tipo_resultado,
   tiene_foto, foto_object_path, tiene_firma, firma_object_path, otp_estado,
   geo_lat, geo_long, geo_precision_m, distancia_destino_m, geocerca_resultado,
   es_valido, capturado_en)
select
  ('87000000-0000-0000-0000-'||substr(md5('pod-'||p.id::text), 1, 12))::uuid,
  p.tenant_id, p.id, p.seller_id, p.driver_id_asignado,
  'entregado'::operacion.pod_resultado,
  true, p.tenant_id||'/pod/'||p.id||'/foto.jpg',
  true, p.tenant_id||'/pod/'||p.id||'/firma.png',
  'validado'::operacion.pod_otp_estado,
  p.lat, p.long, 12.5, 18.0,
  'dentro'::operacion.pod_geocerca_resultado,
  true,
  (p.fecha_compromiso + time '15:20')::timestamptz
from operacion.pedidos p
where p.tenant_id = '10000000-0000-0000-0000-000000000001'
  and p.id::text like '6d000000%'
  and p.tipo_pedido = 'same_day'
  and p.estado in ('entregado','entregado_manual')
  and p.driver_id_asignado is not null
  and p.lat is not null
on conflict do nothing;

-- Evidencia informativa de Flex (el POD autoritativo es el de la app de ML).
insert into operacion.evidencias_entrega
  (id, tenant_id, pedido_id, seller_id, conductor_id, foto_object_path, nota,
   geo_lat, geo_long, geo_precision_m, distancia_destino_m, geocerca_resultado,
   capturado_en, subido_en)
select
  ('88000000-0000-0000-0000-'||substr(md5('evt-'||p.id::text), 1, 12))::uuid,
  p.tenant_id, p.id, p.seller_id, p.driver_id_asignado,
  p.tenant_id||'/evidencias/'||p.id||'/entrega.jpg',
  case when p.id::text ~ '[02468]$' then 'Entregado en conserjería' end,
  p.lat, p.long, 15.0, 24.0,
  'dentro'::operacion.pod_geocerca_resultado,
  (p.fecha_compromiso + time '14:05')::timestamptz,
  (p.fecha_compromiso + time '14:07')::timestamptz
from operacion.pedidos p
where p.tenant_id = '10000000-0000-0000-0000-000000000001'
  and p.id::text like '6d000000%'
  and p.tipo_pedido = 'flex'
  and p.estado = 'entregado'
  and p.driver_id_asignado is not null
  and p.lat is not null
  and p.fecha_compromiso >= (now() at time zone 'America/Santiago')::date - 10
on conflict do nothing;

-- Cierres del conductor (same-day): entregado sin motivo, no_entregado con motivo.
insert into operacion.cierres_conductor
  (id, tenant_id, pedido_id, seller_id, conductor_id, resultado, motivo,
   foto_object_path, geo_lat, geo_long, geo_precision_m, distancia_destino_m,
   geocerca_resultado, cerrado_en)
select
  ('89000000-0000-0000-0000-'||substr(md5('cie-'||p.id::text), 1, 12))::uuid,
  p.tenant_id, p.id, p.seller_id, p.driver_id_asignado,
  case when p.estado in ('entregado','entregado_manual') then 'entregado' else 'no_entregado' end,
  case when p.estado not in ('entregado','entregado_manual')
       then 'Destinatario ausente en el horario comprometido' end,
  p.tenant_id||'/cierres/'||p.id||'/foto.jpg',
  p.lat, p.long, 14.0, 21.0,
  'dentro'::operacion.pod_geocerca_resultado,
  (p.fecha_compromiso + time '16:40')::timestamptz
from operacion.pedidos p
where p.tenant_id = '10000000-0000-0000-0000-000000000001'
  and p.id::text like '6d000000%'
  and p.tipo_pedido = 'same_day'
  and p.estado in ('entregado','entregado_manual','fallido','fallido_manual')
  and p.driver_id_asignado is not null
  and p.lat is not null
on conflict do nothing;

-- Consentimiento de ubicación (Ley 21.431) y última posición de los conductores.
insert into operacion.consentimientos_ubicacion
  (id, tenant_id, conductor_id, acepto, version_texto, otorgado_en)
select
  ('8a000000-0000-0000-0000-'||lpad(k::text,12,'0'))::uuid,
  '10000000-0000-0000-0000-000000000001',
  ('40000000-0000-0000-0000-'||lpad(k::text,12,'0'))::uuid,
  (k % 6 <> 0), 'v1-2026-01', now() - interval '40 days'
from generate_series(1,12) as k
on conflict (id) do nothing;

insert into operacion.ubicacion_conductor
  (conductor_id, tenant_id, lat, long, precision_m, actualizado_en)
select
  ('40000000-0000-0000-0000-'||lpad(k::text,12,'0'))::uuid,
  '10000000-0000-0000-0000-000000000001',
  -33.42 - (k::numeric / 100), -70.60 - (k::numeric / 200), 18.0,
  now() - (k * interval '3 minutes')
from generate_series(1,12) as k
on conflict (conductor_id) do nothing;


-- =============================================================================
-- 8. Períodos de cobro — abierto · cerrado · facturado · anulado
-- =============================================================================
-- M0 = mes en curso (abierto) · M1 = mes pasado · M2 = hace 2 meses ·
-- M3 = hace 3 meses (período anulado, sin líneas).
-- Los períodos de M1 pueden ya existir desde seed.sql: ON CONFLICT sobre la
-- clave natural (tenant, seller, rango) y después se ajusta el estado por UPDATE.
insert into dinero.periodos_cobro
  (id, tenant_id, seller_id, fecha_inicio, fecha_fin, tipo_periodo, estado)
select
  ('a5000000-0000-0000-0000-'||lpad((m.n * 10 + s.n)::text,12,'0'))::uuid,
  '10000000-0000-0000-0000-000000000001',
  ('30000000-0000-0000-0000-'||lpad(s.n::text,12,'0'))::uuid,
  m.inicio, m.fin, 'mensual', 'abierto'
from (
  select 0 as n,
         date_trunc('month', (now() at time zone 'America/Santiago')::date)::date as inicio,
         (date_trunc('month', (now() at time zone 'America/Santiago')::date) + interval '1 month - 1 day')::date as fin
  union all select 1,
         (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '1 month')::date,
         (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '1 day')::date
  union all select 2,
         (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '2 months')::date,
         (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '1 month 1 day')::date
  union all select 3,
         (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '3 months')::date,
         (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '2 months 1 day')::date
) m
cross join (select generate_series(1,3) as n) s
where not (m.n = 3 and s.n <> 1)   -- el período anulado es solo del seller 1
  and not (m.n = 0 and s.n = 1)    -- FalabellaTech factura quincenal (ver 8b)
on conflict (tenant_id, seller_id, fecha_inicio, fecha_fin) do nothing;

-- -----------------------------------------------------------------------------
-- 8b. FalabellaTech factura QUINCENAL — así el mes en curso no está todo abierto
-- -----------------------------------------------------------------------------
-- Sin esto, a mitad de mes el dashboard muestra "Cobrado $0": todos los períodos
-- del mes en curso serían `abierto` y nadie habría pagado nada todavía. Con un
-- seller quincenal, la primera quincena ya está facturada y cobrada y la segunda
-- sigue abierta — que es como se ve un courier real a mitad de mes.
insert into dinero.config_periodos (id, tenant_id, seller_id, tipo_periodo, dia_cierre, activa)
values
  ('90000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001','quincenal',15,true)
on conflict (id) do nothing;

insert into dinero.periodos_cobro
  (id, tenant_id, seller_id, fecha_inicio, fecha_fin, tipo_periodo, estado)
values
  ('a5000000-0000-0000-0000-000000000091','10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   date_trunc('month', (now() at time zone 'America/Santiago')::date)::date,
   (date_trunc('month', (now() at time zone 'America/Santiago')::date) + interval '14 days')::date,
   'quincenal','abierto'),
  ('a5000000-0000-0000-0000-000000000092','10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   (date_trunc('month', (now() at time zone 'America/Santiago')::date) + interval '15 days')::date,
   (date_trunc('month', (now() at time zone 'America/Santiago')::date) + interval '1 month - 1 day')::date,
   'quincenal','abierto')
on conflict (tenant_id, seller_id, fecha_inicio, fecha_fin) do nothing;

-- Si una corrida anterior dejó el período mensual de FalabellaTech, se le
-- reasignan las líneas a la quincena que les corresponde y se elimina.
update dinero.lineas_cobro lc
set periodo_cobro_id = q.id
from dinero.periodos_cobro men, dinero.periodos_cobro q
where men.tenant_id = '10000000-0000-0000-0000-000000000001'
  and men.seller_id = '30000000-0000-0000-0000-000000000001'
  and men.tipo_periodo = 'mensual'
  and men.fecha_inicio = date_trunc('month', (now() at time zone 'America/Santiago')::date)::date
  and lc.periodo_cobro_id = men.id
  and q.tenant_id = men.tenant_id
  and q.seller_id = men.seller_id
  and q.tipo_periodo = 'quincenal'
  and lc.fecha_entrega between q.fecha_inicio and q.fecha_fin;

delete from dinero.periodos_cobro men
where men.tenant_id = '10000000-0000-0000-0000-000000000001'
  and men.seller_id = '30000000-0000-0000-0000-000000000001'
  and men.tipo_periodo = 'mensual'
  and men.fecha_inicio = date_trunc('month', (now() at time zone 'America/Santiago')::date)::date
  and not exists (select 1 from dinero.lineas_cobro l where l.periodo_cobro_id = men.id)
  and not exists (select 1 from dinero.documentos_dte d where d.periodo_cobro_id = men.id);


-- =============================================================================
-- 9. Líneas de cobro y de liquidación — una por entrega, ambas conciliadas
-- =============================================================================
-- Invariante del motor: todo pedido entregado tiene su línea de cobro al seller
-- Y su línea de liquidación al conductor, con el mismo pedido_id de referencia.
insert into dinero.lineas_cobro
  (id, tenant_id, seller_id, pedido_id, periodo_cobro_id, tarifa_id,
   monto_base_clp, ajuste_incidencia_clp, concepto, tipo_pedido, fecha_entrega,
   origen_generacion, snapshot_regla, creado_en)
select
  ('cd000000-0000-0000-0000-'||substr(md5('lc-'||p.id::text), 1, 12))::uuid,
  p.tenant_id, p.seller_id, p.id, per.id, p.tarifa_aplicable_id,
  p.monto_cobro_clp, 0,
  'Entrega '||(case when p.tipo_pedido = 'flex' then 'Flex' else 'Same-day' end)||
    ' – '||sel.razon_social,
  p.tipo_pedido::text,
  p.fecha_compromiso,
  'motor_automatico',
  jsonb_build_object(
    'tarifa_id', p.tarifa_aplicable_id,
    'modo_calculo', 'monto_fijo',
    'monto_tarifa_clp', p.monto_cobro_clp,
    'tipo_entrega', p.tipo_pedido,
    'origen', 'seed-demo-full'
  ),
  (p.fecha_compromiso + time '23:10')::timestamptz
from operacion.pedidos p
join identidad.sellers sel on sel.id = p.seller_id
join dinero.periodos_cobro per
  on per.tenant_id = p.tenant_id
 and per.seller_id = p.seller_id
 and p.fecha_compromiso between per.fecha_inicio and per.fecha_fin
where p.tenant_id = '10000000-0000-0000-0000-000000000001'
  and p.id::text like '6d000000%'
  and p.estado in ('entregado','entregado_manual')
  and p.monto_cobro_clp is not null
on conflict (pedido_id) do nothing;

-- Liquidaciones (conductor × mes). Estados: mes en curso borrador, mes pasado
-- emitida, hace 2 meses pagada.
insert into dinero.liquidaciones
  (id, tenant_id, driver_id, fecha_inicio, fecha_fin, tipo_periodo, estado,
   tipo_relacion_conductor, generado_en, generado_por_usuario_id)
select
  ('b5000000-0000-0000-0000-'||lpad((m.n * 100 + k)::text,12,'0'))::uuid,
  '10000000-0000-0000-0000-000000000001',
  c.id, m.inicio, m.fin, 'mensual',
  case m.n when 0 then 'borrador' when 1 then 'emitida' else 'pagada' end,
  c.tipo_relacion::text,
  case when m.n > 0 then (m.fin + time '20:00')::timestamptz end,
  case when m.n > 0 then '20000000-0000-0000-0000-000000000004'::uuid end
from (
  select 0 as n,
         date_trunc('month', (now() at time zone 'America/Santiago')::date)::date as inicio,
         (date_trunc('month', (now() at time zone 'America/Santiago')::date) + interval '1 month - 1 day')::date as fin
  union all select 1,
         (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '1 month')::date,
         (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '1 day')::date
  union all select 2,
         (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '2 months')::date,
         (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '1 month 1 day')::date
) m
cross join generate_series(1,12) as k
join identidad.conductores c
  on c.id = ('40000000-0000-0000-0000-'||lpad(k::text,12,'0'))::uuid
on conflict (tenant_id, driver_id, fecha_inicio, fecha_fin) do nothing;

-- Las liquidaciones del mes pasado pueden venir de seed.sql en 'borrador'; el
-- estado lo fija el mes, no quién creó la fila (si no, el ON CONFLICT de arriba
-- dejaría medio set en borrador y no habría ninguna 'emitida'/'pagada').
update dinero.liquidaciones
set estado = case
      when fecha_inicio = date_trunc('month', (now() at time zone 'America/Santiago')::date)::date then 'borrador'
      when fecha_inicio = (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '1 month')::date then 'emitida'
      else 'pagada' end,
    generado_en = case
      when fecha_inicio = date_trunc('month', (now() at time zone 'America/Santiago')::date)::date then null
      else (fecha_fin + time '20:00')::timestamptz end,
    generado_por_usuario_id = case
      when fecha_inicio = date_trunc('month', (now() at time zone 'America/Santiago')::date)::date then null
      else '20000000-0000-0000-0000-000000000004'::uuid end
where tenant_id = '10000000-0000-0000-0000-000000000001';

insert into dinero.lineas_liquidacion
  (id, tenant_id, driver_id, pedido_id, liquidacion_id,
   monto_base_clp, ajuste_incidencia_clp, concepto, fecha_entrega,
   origen_generacion, snapshot_regla, creado_en)
select
  ('dd000000-0000-0000-0000-'||substr(md5('ll-'||p.id::text), 1, 12))::uuid,
  p.tenant_id, p.driver_id_asignado, p.id, liq.id,
  p.monto_liquidacion_clp, 0,
  'Entrega '||(case when p.tipo_pedido = 'flex' then 'Flex' else 'Same-day' end)||
    ' – '||p.destinatario_comuna,
  p.fecha_compromiso,
  'motor_automatico',
  jsonb_build_object(
    'tarifa_id', p.tarifa_aplicable_id,
    'monto_conductor_clp', p.monto_liquidacion_clp,
    'tipo_entrega', p.tipo_pedido,
    'origen', 'seed-demo-full'
  ),
  (p.fecha_compromiso + time '23:12')::timestamptz
from operacion.pedidos p
join dinero.liquidaciones liq
  on liq.tenant_id = p.tenant_id
 and liq.driver_id = p.driver_id_asignado
 and p.fecha_compromiso between liq.fecha_inicio and liq.fecha_fin
where p.tenant_id = '10000000-0000-0000-0000-000000000001'
  and p.id::text like '6d000000%'
  and p.estado in ('entregado','entregado_manual')
  and p.driver_id_asignado is not null
  and p.monto_liquidacion_clp is not null
on conflict (pedido_id) do nothing;

-- Re-apuntar líneas a su período / liquidación por FECHA. Necesario tras el
-- re-anclaje (§0): al desplazar el lote, una línea del día 1 o del último día
-- del mes puede cambiar de período, y el INSERT de arriba no la re-asigna
-- porque su ON CONFLICT la ignora por existir ya.
update dinero.lineas_cobro lc
set periodo_cobro_id = per.id
from dinero.periodos_cobro per
where per.tenant_id = lc.tenant_id
  and per.seller_id = lc.seller_id
  and lc.fecha_entrega between per.fecha_inicio and per.fecha_fin
  and per.estado <> 'anulado'
  and lc.tenant_id = '10000000-0000-0000-0000-000000000001'
  and lc.periodo_cobro_id is distinct from per.id;

update dinero.lineas_liquidacion ll
set liquidacion_id = liq.id
from dinero.liquidaciones liq
where liq.tenant_id = ll.tenant_id
  and liq.driver_id = ll.driver_id
  and ll.fecha_entrega between liq.fecha_inicio and liq.fecha_fin
  and ll.tenant_id = '10000000-0000-0000-0000-000000000001'
  and ll.liquidacion_id is distinct from liq.id;

-- ---------------------------------------------------------------------------
-- Reconciliación de flags: `cobro_generado` ⟺ existe línea de cobro.
-- ---------------------------------------------------------------------------
-- Los pedidos se insertan con `cobro_generado = entregado`, pero las líneas se
-- crean después con un JOIN contra `periodos_cobro` por rango de fecha: un
-- pedido entregado cuya `fecha_compromiso` no cae en ningún período generado se
-- queda sin línea y el flag ya había quedado en true. Resultado: ~80 pedidos que
-- dicen "ya generé cobro" sin nada detrás.
--
-- No es inocuo aunque sean datos de demo: el motor entrega→dinero usa esos flags
-- como guarda de idempotencia (`.eq('cobro_generado', false)`), así que un pedido
-- mal marcado se salta la generación de líneas para siempre — y eso hace que una
-- prueba sobre datos de demo mienta. Se detectó ejecutando N-E2E-1 el 2026-08-05.
--
-- El flag es derivado, así que se recalcula al final en vez de intentar predecir
-- el JOIN desde el insert de pedidos.
update operacion.pedidos p
set cobro_generado = exists (select 1 from dinero.lineas_cobro l where l.pedido_id = p.id),
    monto_cobro_clp = case
      when exists (select 1 from dinero.lineas_cobro l where l.pedido_id = p.id)
      then p.monto_cobro_clp end
where p.tenant_id = '10000000-0000-0000-0000-000000000001'
  and p.cobro_generado
  and not exists (select 1 from dinero.lineas_cobro l where l.pedido_id = p.id);

update operacion.pedidos p
set liquidacion_generada = false,
    monto_liquidacion_clp = null
where p.tenant_id = '10000000-0000-0000-0000-000000000001'
  and p.liquidacion_generada
  and not exists (select 1 from dinero.lineas_liquidacion l where l.pedido_id = p.id);

-- Un puñado de ajustes por incidencia (para que la columna no sea siempre 0).
update dinero.lineas_cobro lc
set ajuste_incidencia_clp = -800,
    incidencia_id = i.id,
    notas = 'Descuento por incidencia de entrega'
from operacion.incidencias i
where i.pedido_id = lc.pedido_id
  and i.afecta_cobro = true
  and i.estado in ('resuelta','cerrada')
  and lc.tenant_id = '10000000-0000-0000-0000-000000000001'
  and lc.ajuste_incidencia_clp = 0;

update dinero.lineas_liquidacion ll
set ajuste_incidencia_clp = -500,
    incidencia_id = i.id,
    notas = 'Descuento por incidencia atribuible a la ruta'
from operacion.incidencias i
where i.pedido_id = ll.pedido_id
  and i.afecta_liquidacion = true
  and i.estado in ('resuelta','cerrada')
  and ll.tenant_id = '10000000-0000-0000-0000-000000000001'
  and ll.ajuste_incidencia_clp = 0;

-- Dos líneas anuladas (soft-delete) para poblar el filtro de anuladas.
update dinero.lineas_cobro
set anulada = true,
    anulada_en = now() - interval '3 days',
    motivo_anulacion = 'Pedido facturado dos veces por reintento de ingesta'
where id in (
  select id from dinero.lineas_cobro
  where tenant_id = '10000000-0000-0000-0000-000000000001'
    and anulada = false
  order by fecha_entrega asc, id
  limit 2
);

-- Bono y penalización en algunas liquidaciones (ajustes manuales F19).
update dinero.liquidaciones
set bono_clp = 15000,
    nota_ajuste = 'Bono por cumplimiento de SLA sobre el 98%'
where tenant_id = '10000000-0000-0000-0000-000000000001'
  and estado = 'emitida'
  and driver_id in ('40000000-0000-0000-0000-000000000001',
                    '40000000-0000-0000-0000-000000000004');

update dinero.liquidaciones
set penalizacion_clp = 8000,
    nota_ajuste = 'Descuento por dos entregas fuera de ventana'
where tenant_id = '10000000-0000-0000-0000-000000000001'
  and estado = 'emitida'
  and driver_id = '40000000-0000-0000-0000-000000000006';

-- Totales consolidados de liquidaciones (lo que haría el job al cerrarlas).
update dinero.liquidaciones l
set total_entregas = coalesce(t.n, 0),
    monto_total_clp = coalesce(t.monto, 0) + l.bono_clp - l.penalizacion_clp
from (
  select liquidacion_id, count(*) as n, sum(monto_final_clp) as monto
  from dinero.lineas_liquidacion
  where tenant_id = '10000000-0000-0000-0000-000000000001'
    and anulada = false
    and liquidacion_id is not null
  group by liquidacion_id
) t
where t.liquidacion_id = l.id
  and l.tenant_id = '10000000-0000-0000-0000-000000000001';

-- Totales de los períodos de cobro.
update dinero.periodos_cobro p
set total_lineas = coalesce(t.n, 0),
    monto_total_clp = coalesce(t.monto, 0)
from (
  select periodo_cobro_id, count(*) as n, sum(monto_final_clp) as monto
  from dinero.lineas_cobro
  where tenant_id = '10000000-0000-0000-0000-000000000001'
    and anulada = false
    and periodo_cobro_id is not null
  group by periodo_cobro_id
) t
where t.periodo_cobro_id = p.id
  and p.tenant_id = '10000000-0000-0000-0000-000000000001';


-- =============================================================================
-- 10. Cierre y facturación de períodos + DTE (sandbox)
-- =============================================================================
-- Estados finales por período:
--   M0 (mes en curso) → abierto
--   M1 → seller 1 y 2 facturado (con DTE), seller 3 cerrado (sin emitir)
--   M2 → los 3 facturados (con DTE)
--   M3 → anulado
do $$
declare
  v_tenant uuid := '10000000-0000-0000-0000-000000000001';
  v_m0 date := date_trunc('month', (now() at time zone 'America/Santiago')::date)::date;
  v_m1 date := (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '1 month')::date;
  v_m2 date := (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '2 months')::date;
  v_m3 date := (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '3 months')::date;
begin
  -- Mes en curso: abierto (salvo la 1ª quincena de FalabellaTech, que ya cerró).
  update dinero.periodos_cobro
  set estado = 'abierto', estado_cobro = 'no_aplica',
      cerrado_en = null, cerrado_por_usuario_id = null
  where tenant_id = v_tenant
    and fecha_inicio >= v_m0
    and id <> 'a5000000-0000-0000-0000-000000000091';

  -- 1ª quincena del mes en curso: cerrada y lista para emitir.
  update dinero.periodos_cobro
  set estado = 'cerrado',
      cerrado_en = (fecha_fin + interval '1 day' + time '03:00')::timestamptz,
      cerrado_por_usuario_id = '20000000-0000-0000-0000-000000000004'
  where id = 'a5000000-0000-0000-0000-000000000091';

  -- Hace 3 meses: anulado (se creó por error, no llegó a tener líneas).
  update dinero.periodos_cobro
  set estado = 'anulado', estado_cobro = 'no_aplica',
      total_lineas = 0, monto_total_clp = 0,
      motivo_anulacion = 'Período duplicado por reintento del cron de cierre',
      anulado_en = (v_m3 + interval '35 days')::timestamptz,
      anulado_por_usuario_id = '20000000-0000-0000-0000-000000000004'
  where tenant_id = v_tenant and fecha_inicio = v_m3;

  -- Mes pasado y anteanterior: cerrados.
  update dinero.periodos_cobro
  set estado = 'cerrado',
      cerrado_en = (fecha_fin + interval '1 day' + time '03:00')::timestamptz,
      cerrado_por_usuario_id = '20000000-0000-0000-0000-000000000004'
  where tenant_id = v_tenant and fecha_inicio in (v_m1, v_m2);
end $$;

-- DTE de los períodos que sí se emitieron. Folios 57..61 del CAF vigente:
-- deja 38 folios disponibles de 100 → dispara la alerta de folios por agotarse.
insert into dinero.documentos_dte
  (id, tenant_id, seller_id, periodo_cobro_id, tipo_documento, folio,
   fecha_emision, monto_neto_clp, monto_iva_clp, monto_total_clp,
   xml_dte_ref, pdf_ref, proveedor_dte_id_externo, estado_sii, estado_proveedor,
   error_descripcion, emitido_en)
select
  ('e5000000-0000-0000-0000-'||lpad(x.folio::text,12,'0'))::uuid,
  per.tenant_id, per.seller_id, per.id, 33, x.folio,
  (per.fecha_fin + 1)::date,
  round(per.monto_total_clp / 1.19),
  per.monto_total_clp - round(per.monto_total_clp / 1.19),
  per.monto_total_clp,
  per.tenant_id||'/dte/'||x.folio||'.xml',
  per.tenant_id||'/dte/'||x.folio||'.pdf',
  'SF-SANDBOX-'||lpad(x.folio::text, 8, '0'),
  x.estado_sii, x.estado_proveedor,
  case when x.estado_sii = 'rechazado'
       then 'Rechazo SII: giro del receptor no coincide con el registrado' end,
  (per.fecha_fin + interval '1 day' + time '09:30')::timestamptz
from (values
  -- mes, seller, folio, estado_sii, estado_proveedor
  (2, 1, 57, 'aceptado',                   'aceptado'),
  (2, 2, 58, 'rechazado',                  'aceptado'),
  (2, 3, 59, 'pendiente',                  'enviado'),
  (1, 1, 60, 'aceptado',                   'aceptado'),
  (1, 2, 61, 'aceptado_con_discrepancias', 'aceptado')
) as x(mes, seller, folio, estado_sii, estado_proveedor)
join dinero.periodos_cobro per
  on per.tenant_id = '10000000-0000-0000-0000-000000000001'
 and per.seller_id = ('30000000-0000-0000-0000-'||lpad(x.seller::text,12,'0'))::uuid
 and per.fecha_inicio = (date_trunc('month', (now() at time zone 'America/Santiago')::date) - (x.mes || ' months')::interval)::date
where per.monto_total_clp > 0
on conflict (tenant_id, tipo_documento, folio) do nothing;

-- DTE de la 1ª quincena del mes en curso (FalabellaTech).
insert into dinero.documentos_dte
  (id, tenant_id, seller_id, periodo_cobro_id, tipo_documento, folio,
   fecha_emision, monto_neto_clp, monto_iva_clp, monto_total_clp,
   xml_dte_ref, pdf_ref, proveedor_dte_id_externo, estado_sii, estado_proveedor,
   emitido_en)
select
  'e5000000-0000-0000-0000-000000000062',
  per.tenant_id, per.seller_id, per.id, 33, 62,
  (per.fecha_fin + 1)::date,
  round(per.monto_total_clp / 1.19),
  per.monto_total_clp - round(per.monto_total_clp / 1.19),
  per.monto_total_clp,
  per.tenant_id||'/dte/62.xml', per.tenant_id||'/dte/62.pdf',
  'SF-SANDBOX-00000062','aceptado','aceptado',
  (per.fecha_fin + interval '1 day' + time '09:30')::timestamptz
from dinero.periodos_cobro per
where per.id = 'a5000000-0000-0000-0000-000000000091'
  and coalesce(per.monto_total_clp, 0) > 0
on conflict (tenant_id, tipo_documento, folio) do nothing;

-- Enlazar el DTE al período y marcarlo facturado.
update dinero.periodos_cobro p
set documento_dte_id = d.id,
    estado = 'facturado'
from dinero.documentos_dte d
where d.periodo_cobro_id = p.id
  and d.tipo_documento = 33
  and p.tenant_id = '10000000-0000-0000-0000-000000000001';

-- Folios consumidos: 63 emitidos de 1..100 → quedan 37 (alerta bajo el umbral 50).
update identidad.folios_caf
set folio_actual = 63, estado = 'vigente'
where id = 'f0000000-0000-0000-0000-000000000001';

-- Un CAF antiguo agotado (para el historial de folios).
insert into identidad.folios_caf
  (id, tenant_id, tipo_documento, folio_desde, folio_hasta, folio_actual, estado)
values
  ('f0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',
   33, 900, 999, 999, 'agotado')
on conflict (id) do nothing;


-- =============================================================================
-- 11. Cobranza — estado de pago de los períodos + pagos recibidos (Fintoc)
-- =============================================================================
do $$
declare
  v_tenant uuid := '10000000-0000-0000-0000-000000000001';
  v_m1 date := (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '1 month')::date;
  v_m2 date := (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '2 months')::date;
begin
  -- Hace 2 meses: seller 1 y 2 pagados, seller 3 parcial.
  update dinero.periodos_cobro
  set estado_cobro = 'pagado', monto_pagado_clp = monto_total_clp,
      pagado_en = (fecha_fin + interval '12 days')::timestamptz
  where tenant_id = v_tenant and fecha_inicio = v_m2 and estado = 'facturado'
    and seller_id in ('30000000-0000-0000-0000-000000000001',
                      '30000000-0000-0000-0000-000000000002');

  update dinero.periodos_cobro
  set estado_cobro = 'parcial', monto_pagado_clp = round(monto_total_clp * 0.55)
  where tenant_id = v_tenant and fecha_inicio = v_m2
    and seller_id = '30000000-0000-0000-0000-000000000003';

  -- Mes pasado: seller 1 moroso (pendiente), seller 2 parcial.
  update dinero.periodos_cobro
  set estado_cobro = 'pendiente', monto_pagado_clp = 0
  where tenant_id = v_tenant and fecha_inicio = v_m1
    and seller_id = '30000000-0000-0000-0000-000000000001';

  update dinero.periodos_cobro
  set estado_cobro = 'parcial', monto_pagado_clp = round(monto_total_clp * 0.40)
  where tenant_id = v_tenant and fecha_inicio = v_m1
    and seller_id = '30000000-0000-0000-0000-000000000002';

  -- 1ª quincena del mes en curso: facturada y ya cobrada.
  update dinero.periodos_cobro
  set estado_cobro = 'pagado', monto_pagado_clp = monto_total_clp,
      pagado_en = (fecha_fin + interval '4 days')::timestamptz
  where id = 'a5000000-0000-0000-0000-000000000091'
    and estado = 'facturado';
end $$;

-- Movimientos bancarios ingeridos: todos los estados de match.
insert into dinero.pagos_recibidos
  (id, tenant_id, seller_id, periodo_cobro_id, movimiento_externo_id, monto_clp,
   fecha_movimiento, contraparte_rut_normalizado, contraparte_nombre,
   estado_match, atribuido_por_usuario_id, atribuido_en, payload_crudo, job_run_id)
select
  ('95000000-0000-0000-0000-'||lpad(x.n::text,12,'0'))::uuid,
  '10000000-0000-0000-0000-000000000001',
  case when x.seller > 0
       then ('30000000-0000-0000-0000-'||lpad(x.seller::text,12,'0'))::uuid end,
  per.id,
  'FTC-MOV-'||lpad(x.n::text, 8, '0'),
  x.monto,
  ((now() at time zone 'America/Santiago')::date - x.dias_atras)::date,
  x.rut, x.nombre,
  x.estado::dinero.estado_match_pago,
  case when x.estado in ('atribuido','conciliado','parcial')
       then '20000000-0000-0000-0000-000000000004'::uuid end,
  case when x.estado in ('atribuido','conciliado','parcial')
       then ((now() at time zone 'America/Santiago')::date - x.dias_atras + 1)::timestamptz end,
  jsonb_build_object('proveedor','fintoc','tipo','transferencia',
                     'glosa', x.nombre, 'moneda','CLP'),
  'run-conciliar-pagos-'||lpad(x.n::text, 4, '0')
from (values
  -- El RUT va NORMALIZADO: solo dígitos + DV, sin puntos ni guion (la UI lo
  -- formatea al mostrarlo; con guion aquí saldría "76555111--2").
  (1, 1, 2, 'conciliado',   1482000, 40, '765551112','FALABELLATECH LTDA'),
  (2, 2, 2, 'conciliado',   1104000, 38, '772223334','MERCADOSUR SPA'),
  (3, 3, 2, 'parcial',       620000, 33, '768889990','TECNOHOGAR CHILE SPA'),
  (4, 2, 1, 'parcial',       410000, 12, '772223334','MERCADOSUR SPA'),
  (5, 0, 0, 'sin_atribuir',  298000,  6, null,        'TRANSF ELECTRONICA 4471'),
  (6, 0, 0, 'sin_atribuir',   87500,  3, null,        'DEPOSITO EN EFECTIVO'),
  (7, 1, 0, 'atribuido',     255000,  9, '765551112','FALABELLATECH LTDA'),
  (8, 3, 0, 'sobrante',       45000, 15, '768889990','TECNOHOGAR CHILE SPA'),
  (9, 0, 0, 'descartado',     12000, 21, null,        'COMISION MANTENCION CUENTA')
) as x(n, seller, mes_periodo, estado, monto, dias_atras, rut, nombre)
left join dinero.periodos_cobro per
  on x.mes_periodo > 0
 and per.tenant_id = '10000000-0000-0000-0000-000000000001'
 and per.seller_id = ('30000000-0000-0000-0000-'||lpad(x.seller::text,12,'0'))::uuid
 and per.fecha_inicio = (date_trunc('month', (now() at time zone 'America/Santiago')::date) - (x.mes_periodo || ' months')::interval)::date
on conflict (tenant_id, movimiento_externo_id) do nothing;

-- Config de cobranza y de payout del courier (pantallas de configuración).
insert into identidad.courier_config_cobranza
  (tenant_id, cuenta_banco_alias, estado_conexion)
values ('10000000-0000-0000-0000-000000000001','Cuenta corriente BCI ····4471','conectado')
on conflict (tenant_id) do update
  set cuenta_banco_alias = excluded.cuenta_banco_alias,
      estado_conexion = excluded.estado_conexion;

insert into identidad.courier_config_payout
  (tenant_id, payout_real_habilitado, metodo_default, porcentaje_retencion, minimo_retiro_clp)
values ('10000000-0000-0000-0000-000000000001', false, 'manual', 10.75, 30000)
on conflict (tenant_id) do update
  set metodo_default = excluded.metodo_default,
      porcentaje_retencion = excluded.porcentaje_retencion,
      minimo_retiro_clp = excluded.minimo_retiro_clp;


-- =============================================================================
-- 12. Payouts a conductor — todos los estados
-- =============================================================================
insert into dinero.payouts_conductor
  (id, tenant_id, driver_id, liquidacion_id, monto_bruto_clp, monto_retencion_clp,
   monto_liquido_clp, tipo_relacion_conductor, metodo, estado, payout_externo_id,
   comprobante_ref, error_descripcion, solicitado_por_usuario_id, solicitado_en,
   confirmado_en)
select
  ('f5000000-0000-0000-0000-'||substr(md5('po-'||l.id::text), 1, 12))::uuid,
  l.tenant_id, l.driver_id, l.id,
  l.monto_total_clp,
  case when l.tipo_relacion_conductor = 'independiente'
       then round(l.monto_total_clp * 0.1075) else 0 end,
  l.monto_total_clp - (case when l.tipo_relacion_conductor = 'independiente'
                            then round(l.monto_total_clp * 0.1075) else 0 end),
  l.tipo_relacion_conductor,
  case when l.tipo_relacion_conductor = 'dependiente' then 'nomina' else 'fintoc' end,
  e.estado::dinero.estado_payout,
  case when e.estado in ('enviado','confirmado','rechazado')
       then 'FTC-PAY-'||substr(md5(l.id::text), 1, 10) end,
  case when e.estado = 'confirmado'
       then l.tenant_id||'/payouts/'||l.id||'/comprobante.pdf' end,
  case when e.estado = 'rechazado' then 'Cuenta de destino no existe o está cerrada'
       when e.estado = 'fallido'   then 'Timeout del proveedor tras 3 reintentos' end,
  '20000000-0000-0000-0000-000000000004',
  (l.fecha_fin + interval '3 days' + time '11:00')::timestamptz,
  case when e.estado = 'confirmado'
       then (l.fecha_fin + interval '3 days' + time '11:40')::timestamptz end
from dinero.liquidaciones l
join lateral (
  select case
    when l.estado = 'pagada' then 'confirmado'
    when abs(('x'||substr(md5(l.id::text),1,4))::bit(16)::int) %7 = 0 then 'rechazado'
    when abs(('x'||substr(md5(l.id::text),1,4))::bit(16)::int) %11 = 0 then 'fallido'
    when abs(('x'||substr(md5(l.id::text),1,4))::bit(16)::int) %3 = 0 then 'enviado'
    else 'pendiente' end as estado
) e on true
where l.tenant_id = '10000000-0000-0000-0000-000000000001'
  and l.estado in ('emitida','pagada')
  and coalesce(l.monto_total_clp, 0) > 0
on conflict (tenant_id, liquidacion_id) do nothing;

-- Eventos de webhook del proveedor de payout (trazabilidad F19 / §2.3).
insert into dinero.eventos_payout_externos
  (id, tenant_id, payout_id, liquidacion_id, evento_externo_id,
   transfer_externo_id, estado_externo, motivo, payload_sanitizado, recibido_en)
select
  ('f6000000-0000-0000-0000-'||substr(md5('ev-'||po.id::text), 1, 12))::uuid,
  po.tenant_id, po.id, po.liquidacion_id,
  'evt_'||substr(md5(po.id::text), 1, 16),
  po.payout_externo_id,
  case po.estado::text when 'confirmado' then 'confirmado'
                       when 'rechazado' then 'rechazado'
                       when 'fallido' then 'fallido'
                       else 'pendiente' end,
  case when po.estado::text = 'rechazado' then 'Cuenta de destino cerrada (account_closed)' end,
  jsonb_build_object('object','transfer','currency','CLP',
                     'amount', po.monto_liquido_clp),
  coalesce(po.confirmado_en, po.solicitado_en) + interval '2 minutes'
from dinero.payouts_conductor po
where po.tenant_id = '10000000-0000-0000-0000-000000000001'
  and po.payout_externo_id is not null
on conflict (evento_externo_id) do nothing;


-- =============================================================================
-- 13. Conciliación — la mayoría cuadrada, unas pocas excepciones deliberadas
-- =============================================================================
-- El motor genera cobro Y liquidación por cada entrega (§9), así que el cruce
-- cuadra. Aquí se siembran SOLO las excepciones que deben poblar la bandeja:
-- 4 categorías de negocio, estados no terminales y terminales, y 2 bloqueantes.
insert into dinero.eventos_conciliacion
  (id, tenant_id, seller_id, driver_id, periodo_cobro_id, liquidacion_id,
   tipo_diferencia, pedido_id, descripcion, monto_diferencia_clp, estado,
   categoria_negocio, accion_sugerida, asignado_a_usuario_id, asignado_en,
   asignado_por_usuario_id, fecha_limite, bloquea_facturacion, bloquea_pago,
   motivo_bloqueo, fuentes_comparadas, job_run_id, creado_en, resuelto_en,
   resuelto_por_usuario_id)
select
  ('c5000000-0000-0000-0000-'||lpad(x.n::text,12,'0'))::uuid,
  '10000000-0000-0000-0000-000000000001',
  case when x.seller > 0 then ('30000000-0000-0000-0000-'||lpad(x.seller::text,12,'0'))::uuid end,
  case when x.driver > 0 then ('40000000-0000-0000-0000-'||lpad(x.driver::text,12,'0'))::uuid end,
  null, null,
  x.tipo, null, x.descripcion, x.monto, x.estado,
  x.categoria, x.accion,
  case when x.asignado then '20000000-0000-0000-0000-000000000004'::uuid end,
  case when x.asignado then now() - interval '2 days' end,
  case when x.asignado then '20000000-0000-0000-0000-000000000001'::uuid end,
  case when x.dias_limite is not null then (now() at time zone 'America/Santiago')::date + x.dias_limite end,
  x.bloq_fact, x.bloq_pago,
  case when x.bloq_fact or x.bloq_pago then x.motivo_bloqueo end,
  jsonb_build_object('operacion', true, 'dinero', true, 'externo', x.externo),
  'run-conciliar-tres-fuentes-'||lpad(x.n::text, 4, '0'),
  now() - (x.n * interval '9 hours'),
  case when x.estado in ('resuelta_auto','resuelta_manual','aceptada_justificada','ignorada')
       then now() - interval '1 day' end,
  case when x.estado in ('resuelta_manual','aceptada_justificada','ignorada')
       then '20000000-0000-0000-0000-000000000004'::uuid end
from (values
  (1, 1, 0, 'pedido_entregado_sin_linea_cobro',
   'Entrega confirmada por el seller sin línea de cobro generada por el motor.',
   3800, 'pendiente', 'fuga_ingreso', 'generar_cobro_manual',
   true, 2, false, false, null, true),
  (2, 0, 3, 'pedido_entregado_sin_linea_liquidacion',
   'El conductor cerró la entrega pero no se generó su línea de liquidación.',
   2000, 'en_analisis', 'pagos_pendientes', 'generar_ajuste_liquidacion',
   true, 1, false, true, 'No se puede pagar la liquidación hasta cuadrar la entrega', true),
  (3, 2, 0, 'monto_dte_difiere_de_lineas',
   'El total del DTE emitido no coincide con la suma de las líneas del período.',
   -4200, 'requiere_ajuste', 'cumplimiento_dte', 'reenviar_o_verificar_dte',
   true, 0, true, false, 'Diferencia de monto contra el SII sin resolver', false),
  (4, 3, 0, 'reprogramacion_no_cobrada',
   'Dos reprogramaciones sin el recargo de la tarifa aplicado.',
   1800, 'esperando_info', 'fuga_ingreso', 'confirmar_con_seller',
   true, 4, false, false, null, false),
  (5, 0, 7, 'cobrado_seller_no_pagado_conductor',
   'Entrega cobrada al seller que aún no aparece en ninguna liquidación.',
   2400, 'pendiente', 'pagos_pendientes', 'gestionar_pago_conductor',
   false, 5, false, false, null, true),
  (6, 1, 0, 'pago_seller_faltante',
   'Período facturado y vencido sin pago conciliado en la cartola.',
   1482000, 'pendiente', 'pagos_pendientes', 'gestionar_cobranza_seller',
   true, -3, false, false, null, true),
  (7, 0, 0, 'minimo_omitido',
   'Un período quedó bajo el mínimo de facturación pactado y no se ajustó.',
   -9500, 'aceptada_justificada', 'integridad_datos', 'sin_accion_requerida',
   false, null, false, false, null, false),
  (8, 2, 0, 'linea_cobro_sin_pedido_entregado',
   'Línea de cobro cuyo pedido terminó cancelado tras la generación.',
   -3200, 'resuelta_manual', 'integridad_datos', 'marcar_error_del_motor',
   false, null, false, false, null, false),
  (9, 0, 5, 'payout_revertido_post_confirmacion',
   'El banco revirtió una transferencia ya confirmada al conductor.',
   -78000, 'resuelta_auto', 'pagos_pendientes', 'gestionar_pago_conductor',
   false, null, false, false, null, true),
  (10, 3, 0, 'periodo_cerrado_con_lineas_sueltas',
   'Se detectaron líneas fuera del período al momento del cierre.',
   7000, 'ignorada', 'integridad_datos', 'reasignar_lineas_a_periodo',
   false, null, false, false, null, false)
) as x(n, seller, driver, tipo, descripcion, monto, estado, categoria, accion,
       asignado, dias_limite, bloq_fact, bloq_pago, motivo_bloqueo, externo)
on conflict (id) do nothing;

-- Historial de cada excepción (la bandeja muestra la traza de cambios).
insert into dinero.eventos_conciliacion_historial
  (id, tenant_id, evento_id, tipo_cambio, estado_anterior, estado_nuevo,
   comentario, datos, actor_usuario_id, actor_tipo, creado_en)
select
  ('c6000000-0000-0000-0000-'||substr(md5('h1-'||e.id::text), 1, 12))::uuid,
  e.tenant_id, e.id, 'deteccion', null, 'pendiente',
  'Detectada por el cruce automático de las tres fuentes.',
  jsonb_build_object('job', e.job_run_id), null, 'sistema', e.creado_en
from dinero.eventos_conciliacion e
where e.tenant_id = '10000000-0000-0000-0000-000000000001'
on conflict (id) do nothing;

insert into dinero.eventos_conciliacion_historial
  (id, tenant_id, evento_id, tipo_cambio, estado_anterior, estado_nuevo,
   comentario, datos, actor_usuario_id, actor_tipo, creado_en)
select
  ('c7000000-0000-0000-0000-'||substr(md5('h2-'||e.id::text), 1, 12))::uuid,
  e.tenant_id, e.id, 'cambio_estado', 'pendiente', e.estado,
  'Actualizada tras la revisión de Administración.',
  jsonb_build_object('monto_diferencia_clp', e.monto_diferencia_clp),
  '20000000-0000-0000-0000-000000000004', 'usuario',
  e.creado_en + interval '6 hours'
from dinero.eventos_conciliacion e
where e.tenant_id = '10000000-0000-0000-0000-000000000001'
  and e.estado <> 'pendiente'
on conflict (id) do nothing;


-- =============================================================================
-- 14. API pública — claves, webhooks y bandeja de salida
-- =============================================================================
insert into integraciones.api_keys
  (id, tenant_id, nombre, prefijo, hash_clave, permisos, estado,
   ultima_llamada_en, creada_en, revocada_en)
values
  ('14000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
   'Integración ERP','rtx_live_a1b2', encode(digest('demo-key-1','sha256'),'hex'),
   array['pedidos:leer','pedidos:crear','estados:leer'], 'activa',
   now() - interval '2 hours', now() - interval '120 days', null),
  ('14000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',
   'Panel de bodega','rtx_live_c3d4', encode(digest('demo-key-2','sha256'),'hex'),
   array['pedidos:leer'], 'activa',
   now() - interval '3 days', now() - interval '60 days', null),
  ('14000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001',
   'Prueba antigua','rtx_test_e5f6', encode(digest('demo-key-3','sha256'),'hex'),
   array['pedidos:leer'], 'revocada',
   now() - interval '200 days', now() - interval '210 days', now() - interval '150 days')
on conflict (id) do nothing;

insert into integraciones.webhook_endpoints
  (id, tenant_id, url, eventos, activo, reintentos_max)
values
  ('14100000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
   'https://erp.despachos-centro.cl/hooks/rutax',
   array['pedido.entregado','pedido.fallido','periodo.facturado'], true, 3),
  ('14100000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',
   'https://bodega.despachos-centro.cl/webhooks/estados',
   array['pedido.asignado','pedido.en_ruta'], true, 5),
  ('14100000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001',
   'https://legacy.despachos-centro.cl/hook', array['pedido.entregado'], false, 3)
on conflict (id) do nothing;

insert into integraciones.webhook_outbox
  (id, tenant_id, endpoint_id, evento_tipo, payload, estado, intento_num,
   proximo_intento_en, ultimo_error, creado_en, enviado_en)
select
  ('14200000-0000-0000-0000-'||lpad(x.n::text,12,'0'))::uuid,
  '10000000-0000-0000-0000-000000000001',
  ('14100000-0000-0000-0000-'||lpad(x.endpoint::text,12,'0'))::uuid,
  x.evento,
  jsonb_build_object('evento', x.evento, 'pedido_id', gen_random_uuid(), 'ts', now()),
  x.estado, x.intento,
  now() + (x.n * interval '4 minutes'),
  case when x.estado = 'fallido' then 'HTTP 503 desde el endpoint destino' end,
  now() - (x.n * interval '35 minutes'),
  case when x.estado = 'enviado' then now() - (x.n * interval '34 minutes') end
from (values
  (1,1,'pedido.entregado','enviado',1),
  (2,1,'pedido.entregado','enviado',1),
  (3,2,'pedido.en_ruta','enviado',1),
  (4,1,'periodo.facturado','enviado',2),
  (5,2,'pedido.asignado','pendiente',0),
  (6,1,'pedido.fallido','fallido',3),
  (7,2,'pedido.en_ruta','fallido',3),
  (8,1,'pedido.entregado','pendiente',0)
) as x(n, endpoint, evento, estado, intento)
on conflict (id) do nothing;


-- =============================================================================
-- 15. Suscripción del courier demo + historial de cobros de plataforma
-- =============================================================================
-- Plan Growth: 2000 pedidos/mes y 20 conductores — holgado para los 12
-- conductores y el volumen sembrado, así que no dispara topes artificiales.
insert into plataforma.suscripciones
  (id, tenant_id, plan_id, estado, trial_hasta, activa_desde, periodicidad,
   auto_cobro_habilitado, mandato_estado, notas)
select
  '15000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  pl.id, 'activa',
  ((now() at time zone 'America/Santiago')::date - 240), ((now() at time zone 'America/Santiago')::date - 225), 'mensual',
  true, 'activo',
  'Courier piloto. Migrado desde trial sin incidencias de pago.'
from plataforma.planes pl where pl.nombre = 'Growth'
on conflict (tenant_id) do update
  set plan_id = excluded.plan_id,
      estado = excluded.estado,
      trial_hasta = excluded.trial_hasta,
      activa_desde = excluded.activa_desde,
      auto_cobro_habilitado = excluded.auto_cobro_habilitado,
      mandato_estado = excluded.mandato_estado,
      notas = excluded.notas;

-- 9 períodos de suscripción hacia atrás + el del mes en curso.
insert into plataforma.periodos_suscripcion
  (id, suscripcion_id, tenant_id, periodo_inicio, periodo_fin, monto_clp,
   estado, generado_en, vence_en, concepto)
select
  ('15100000-0000-0000-0000-'||substr(md5('ps-'||s.id::text||m.n::text), 1, 12))::uuid,
  s.id, s.tenant_id,
  (date_trunc('month', (now() at time zone 'America/Santiago')::date) - (m.n || ' months')::interval)::date,
  (date_trunc('month', (now() at time zone 'America/Santiago')::date) - ((m.n - 1) || ' months')::interval - interval '1 day')::date,
  pl.precio_mensual_clp,
  case when m.n = 0 then 'pendiente' else 'pagado' end,
  (date_trunc('month', (now() at time zone 'America/Santiago')::date) - (m.n || ' months')::interval)::timestamptz,
  (date_trunc('month', (now() at time zone 'America/Santiago')::date) - (m.n || ' months')::interval + interval '5 days')::date,
  'periodo'
from plataforma.suscripciones s
join plataforma.planes pl on pl.id = s.plan_id
cross join generate_series(0, 8) as m(n)
where s.tenant_id = '10000000-0000-0000-0000-000000000001'
on conflict (suscripcion_id, periodo_inicio, concepto) do nothing;

insert into plataforma.pagos_plataforma
  (id, periodo_id, tenant_id, monto_clp, metodo, estado, pago_externo_id,
   pagado_en, registrado_en, notas)
select
  ('15200000-0000-0000-0000-'||substr(md5('pp-'||p.id::text), 1, 12))::uuid,
  p.id, p.tenant_id, p.monto_clp,
  case when p.periodo_inicio < (now() at time zone 'America/Santiago')::date - interval '5 months'
       then 'transferencia_manual' else 'fintoc_recurrente' end,
  case when p.estado = 'pagado' then 'confirmado' else 'pendiente' end,
  'ftc_'||substr(md5(p.id::text), 1, 14),
  case when p.estado = 'pagado' then (p.periodo_inicio + 3)::timestamptz end,
  p.generado_en,
  case when p.estado = 'pendiente' then 'Cobro automático programado' end
from plataforma.periodos_suscripcion p
where p.tenant_id = '10000000-0000-0000-0000-000000000001'
on conflict (id) do nothing;


-- =============================================================================
-- 16. Backstage Rutax — más couriers con distintos estados de suscripción
-- =============================================================================
-- Tenants adicionales para que el panel de plataforma (MRR, listado de couriers,
-- métricas) tenga cartera real. No tienen usuarios: no se puede iniciar sesión
-- en ellos; existen solo para el backstage.
insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado, plan_id)
values
  ('14000000-0000-0000-0000-000000000101','Andes Express','Andes Express SpA','77111222-3','activo','estandar'),
  ('14000000-0000-0000-0000-000000000102','LogiSur','LogiSur Transportes Ltda.','78222333-4','activo','estandar'),
  ('14000000-0000-0000-0000-000000000103','Rapidísimo','Rapidisimo Chile SpA','79333444-5','activo','estandar'),
  ('14000000-0000-0000-0000-000000000104','Entrega Norte','Entrega Norte SpA','77444555-6','suspendido','estandar'),
  ('14000000-0000-0000-0000-000000000105','Última Milla Austral','Ultima Milla Austral Ltda.','76555666-7','activo','estandar'),
  ('14000000-0000-0000-0000-000000000106','Courier Pacífico','Courier Pacifico SpA','78666777-8','onboarding','estandar')
on conflict (id) do nothing;

-- Una bodega principal por cada courier extra. No es relleno: hasta ahora las
-- bodegas existían en UN solo tenant, y con un solo tenant poblado el
-- aislamiento no se puede ver fallar — cualquier consulta que se olvidara del
-- `tenant_id` devolvería exactamente lo mismo que la correcta. Con estas seis
-- filas, un filtro mal escrito en la pantalla de bodegas muestra galpones de
-- otro courier y salta a la vista en la demo, no en producción.
--
-- Estos tenants no tienen sellers ni usuarios (existen solo para el backstage),
-- así que NO llevan seller_bodegas: colgar una de un seller inexistente lo
-- rechazaría la FK compuesta (tenant_id, seller_id). ÚNICA EXCEPCIÓN: Andes
-- Express gana un seller/bodega/conductor headless en el §16b de más abajo,
-- para poder sembrar una visita de retiro en un tenant distinto del principal
-- (aislamiento) — ver el porqué ahí.
--
-- Cada una en su comuna y con su coordenada; el courier suspendido y el que está
-- en onboarding también tienen la suya (dar de baja la suscripción no borra el
-- galpón).
insert into identidad.courier_bodegas (
  id, tenant_id, nombre, direccion, comuna,
  instrucciones_acceso, es_principal, activa,
  lat, long, geo_estado, geo_confianza, geocodificado_en
) values
  ('7c100000-0000-0000-0000-000000000101','14000000-0000-0000-0000-000000000101',
   'Central Andes Express','Av. Américo Vespucio 2050','Huechuraba',
   null, true, true, -33.3712, -70.6612, 'resuelto', 0.920, now() - interval '180 days'),
  ('7c100000-0000-0000-0000-000000000102','14000000-0000-0000-0000-000000000102',
   'Central LogiSur','Gran Avenida José Miguel Carrera 8450','La Cisterna',
   null, true, true, -33.5301, -70.6619, 'resuelto', 0.900, now() - interval '95 days'),
  ('7c100000-0000-0000-0000-000000000103','14000000-0000-0000-0000-000000000103',
   'Central Rapidísimo','Camino Lo Boza 320','Pudahuel',
   null, true, true, -33.4130, -70.7900, 'resuelto', 0.930, now() - interval '320 days'),
  ('7c100000-0000-0000-0000-000000000104','14000000-0000-0000-0000-000000000104',
   'Central Entrega Norte','Av. Presidente Eduardo Frei Montalva 9200','Quilicura',
   null, true, true, -33.3745, -70.7092, 'resuelto', 0.890, now() - interval '60 days'),
  ('7c100000-0000-0000-0000-000000000105','14000000-0000-0000-0000-000000000105',
   'Central Última Milla','Av. Las Industrias 1450','San Bernardo',
   null, true, true, -33.5851, -70.7042, 'resuelto', 0.880, now() - interval '140 days'),
  ('7c100000-0000-0000-0000-000000000106','14000000-0000-0000-0000-000000000106',
   'Central Pacífico','Camino a Melipilla 9000','Maipú',
   null, true, true, -33.5052, -70.7712, 'resuelto', 0.910, now() - interval '3 days')
on conflict (id) do nothing;

-- =============================================================================
-- 16b. Andes Express gana UN seller headless — para poder probar aislamiento
--      en el retiro en bodega (migración 20260813000004)
-- =============================================================================
-- Los seis tenants de arriba bastan para probar el aislamiento de
-- `courier_bodegas` (P1 estricta), pero el retiro en bodega cuelga de
-- `identidad.seller_bodegas`, que exige un SELLER real por FK compuesta
-- (seller_bodegas_seller_pertenece_al_tenant), y `operacion.sesiones_retiro`
-- exige además un CONDUCTOR real por su propia FK compuesta. Sin esas dos
-- filas no hay forma de sembrar una visita de retiro en un tenant distinto del
-- principal — y CLAUDE.md ya deja escrita la lección: con un solo tenant
-- poblado, una consulta que se olvide del `tenant_id` devuelve lo mismo que la
-- correcta.
--
-- Por eso Andes Express (y SOLO Andes Express, de los seis) gana un seller y
-- un conductor headless: SIN fila en `usuarios_perfil` ni en `auth.users`, así
-- que sigue sin poder iniciarse sesión en él — la afirmación de más arriba
-- ("no tienen sellers ni usuarios") sigue siendo cierta para los otros cinco.
--
-- La bodega nace `es_principal = true`: es la primera y única de este seller,
-- así que "principal" es un hecho y no una elección (mismo criterio que
-- `seed.sql` con las bodegas de Despachos del Centro).
--
-- La VISITA de retiro de HOY sobre esta bodega vive en `seed-torre-hoy.sql`
-- (id fijo, se re-siembra a diario); estas tres filas son infraestructura
-- ESTABLE del tenant, así que van aquí con el mismo `on conflict (id) do
-- nothing` que el resto de este archivo — no tendría sentido borrar y
-- recrear un seller cada vez que se refresca "hoy".
insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
values (
  '31000000-0000-0000-0000-000000000101',
  '14000000-0000-0000-0000-000000000101',
  'Ferretería Andina Ltda.','76901234-5','Osvaldo Lira','olira@ferreteriaandina.cl','activo'
)
on conflict (id) do nothing;

insert into identidad.seller_bodegas (
  id, tenant_id, seller_id, nombre, direccion, comuna,
  instrucciones_acceso, contacto_nombre, contacto_telefono,
  es_principal, activa,
  lat, long, geo_estado, geo_confianza, geocodificado_en
) values (
  '7b100000-0000-0000-0000-000000000101',
  '14000000-0000-0000-0000-000000000101',
  '31000000-0000-0000-0000-000000000101',
  'Bodega Huechuraba','Av. El Salto 3200','Huechuraba',
  'Timbre en la reja verde; el guardia avisa por radio.',
  'Osvaldo Lira','+56977213340',
  true, true,
  -33.3689, -70.6580, 'resuelto', 0.900, now() - interval '8 days'
)
on conflict (id) do nothing;

insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
values (
  '41000000-0000-0000-0000-000000000101',
  '14000000-0000-0000-0000-000000000101',
  'Renato Ibáñez Cortés','24567890-1','independiente','activo'
)
on conflict (id) do nothing;


insert into plataforma.suscripciones
  (id, tenant_id, plan_id, estado, trial_hasta, activa_desde, cancelada_en,
   periodicidad, auto_cobro_habilitado, mandato_estado, notas)
select
  ('15000000-0000-0000-0000-'||lpad((100 + x.n)::text,12,'0'))::uuid,
  ('14000000-0000-0000-0000-'||lpad((100 + x.n)::text,12,'0'))::uuid,
  pl.id, x.estado,
  case when x.estado = 'trial' then (now() at time zone 'America/Santiago')::date + 8 end,
  case when x.estado <> 'trial' then ((now() at time zone 'America/Santiago')::date - x.dias_activa)::date end,
  case when x.estado = 'cancelada' then (now() - interval '22 days') end,
  x.periodicidad, x.auto_cobro, x.mandato, x.notas
from (values
  (1,'Growth',     'activa',     180,'mensual', true,  'activo',      'Cliente estable. Sube volumen cada mes.'),
  (2,'Starter',    'activa',      95,'mensual', true,  'activo',      'Courier pequeño, dos sellers.'),
  (3,'Enterprise', 'activa',     320,'anual',   true,  'activo',      'Contrato anual con descuento negociado.'),
  (4,'Growth',     'suspendida',  60,'mensual', false, 'fallido',     'Suspendida por dos períodos impagos.'),
  (5,'Starter',    'cancelada',  140,'mensual', false, 'cancelado',   'Cerró operaciones en abril.'),
  (6,'Starter',    'trial',        0,'mensual', false, 'sin_mandato', 'En trial, aún sin método de pago.')
) as x(n, plan, estado, dias_activa, periodicidad, auto_cobro, mandato, notas)
join plataforma.planes pl on pl.nombre = x.plan
on conflict (tenant_id) do nothing;

-- Períodos + pagos de los couriers extra (serie de MRR de los últimos 9 meses).
insert into plataforma.periodos_suscripcion
  (id, suscripcion_id, tenant_id, periodo_inicio, periodo_fin, monto_clp,
   estado, generado_en, vence_en, concepto)
select
  ('15100000-0000-0000-0000-'||substr(md5('ps2-'||s.id::text||m.n::text), 1, 12))::uuid,
  s.id, s.tenant_id,
  (date_trunc('month', (now() at time zone 'America/Santiago')::date) - (m.n || ' months')::interval)::date,
  (date_trunc('month', (now() at time zone 'America/Santiago')::date) - ((m.n - 1) || ' months')::interval - interval '1 day')::date,
  case when s.periodicidad = 'anual' then round(pl.precio_anual_clp / 12.0)
       else pl.precio_mensual_clp end,
  case
    when s.estado = 'suspendida' and m.n <= 2 then 'vencido'
    when s.estado = 'cancelada'  and m.n <= 1 then 'vencido'
    when m.n = 0 then 'pendiente'
    else 'pagado' end,
  (date_trunc('month', (now() at time zone 'America/Santiago')::date) - (m.n || ' months')::interval)::timestamptz,
  (date_trunc('month', (now() at time zone 'America/Santiago')::date) - (m.n || ' months')::interval + interval '5 days')::date,
  'periodo'
from plataforma.suscripciones s
join plataforma.planes pl on pl.id = s.plan_id
cross join generate_series(0, 8) as m(n)
where s.tenant_id::text like '14000000-0000-0000-0000-0000000001%'
  and s.estado <> 'trial'
  and (s.activa_desde is null
       or (date_trunc('month', (now() at time zone 'America/Santiago')::date) - (m.n || ' months')::interval)::date >= date_trunc('month', s.activa_desde)::date)
on conflict (suscripcion_id, periodo_inicio, concepto) do nothing;

-- Un ajuste de prorrateo (cambio de plan a mitad de mes).
insert into plataforma.periodos_suscripcion
  (id, suscripcion_id, tenant_id, periodo_inicio, periodo_fin, monto_clp,
   estado, generado_en, vence_en, concepto)
select
  '15100000-0000-0000-0000-0000000009a1',
  s.id, s.tenant_id,
  (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '1 month')::date,
  (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '1 day')::date,
  24500, 'pagado',
  (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '1 month')::timestamptz,
  (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '1 month' + interval '5 days')::date,
  'ajuste_proracion'
from plataforma.suscripciones s
where s.tenant_id = '14000000-0000-0000-0000-000000000101'
on conflict (suscripcion_id, periodo_inicio, concepto) do nothing;

insert into plataforma.pagos_plataforma
  (id, periodo_id, tenant_id, monto_clp, metodo, estado, pago_externo_id,
   pagado_en, registrado_en, notas)
select
  ('15200000-0000-0000-0000-'||substr(md5('pp2-'||p.id::text), 1, 12))::uuid,
  p.id, p.tenant_id, p.monto_clp,
  case when p.tenant_id = '14000000-0000-0000-0000-000000000103'
       then 'fintoc_link' else 'fintoc_recurrente' end,
  case p.estado when 'pagado' then 'confirmado'
                when 'vencido' then 'fallido'
                else 'pendiente' end,
  'ftc_'||substr(md5(p.id::text), 1, 14),
  case when p.estado = 'pagado' then (p.periodo_inicio + 3)::timestamptz end,
  p.generado_en,
  case when p.estado = 'vencido' then 'Cargo rechazado por el banco emisor' end
from plataforma.periodos_suscripcion p
where p.tenant_id::text like '14000000-0000-0000-0000-0000000001%'
on conflict (id) do nothing;

-- Una cortesía (mes gratis) para que el método 'cortesia' aparezca.
insert into plataforma.pagos_plataforma
  (id, periodo_id, tenant_id, monto_clp, metodo, estado, pagado_en, notas)
select
  '15200000-0000-0000-0000-0000000000c1',
  p.id, p.tenant_id, 0, 'cortesia', 'confirmado',
  (p.periodo_inicio + 1)::timestamptz,
  'Mes de cortesía por la caída del proveedor DTE'
from plataforma.periodos_suscripcion p
where p.tenant_id = '14000000-0000-0000-0000-000000000102'
  and p.periodo_inicio = (date_trunc('month', (now() at time zone 'America/Santiago')::date) - interval '2 months')::date
  and p.concepto = 'periodo'
on conflict (id) do nothing;


-- =============================================================================
-- 17. Comunicaciones de Rutax a los couriers (banner in-app)
-- =============================================================================
insert into plataforma.comunicaciones
  (id, titulo, cuerpo, tipo, nivel, activa, vigente_desde, vigente_hasta,
   enviar_email, creado_por)
values
  ('16000000-0000-0000-0000-000000000001',
   'Mantención programada el domingo',
   'El domingo entre 03:00 y 05:00 la plataforma estará en mantención. La app del conductor sigue funcionando sin conexión y sincroniza al volver.',
   'mantencion','importante', true, now() - interval '1 day', now() + interval '4 days',
   false,'ad000000-0000-0000-0000-000000000001'),
  ('16000000-0000-0000-0000-000000000002',
   'Ya puedes conectar hasta 10 cuentas de Mercado Libre por seller',
   'Si un seller vende con más de una cuenta, ahora puedes conectarlas todas y ver de cuál viene cada pedido.',
   'novedad','informativo', true, now() - interval '6 days', now() + interval '20 days',
   false,'ad000000-0000-0000-0000-000000000001'),
  ('16000000-0000-0000-0000-000000000003',
   'Cambio en el horario de corte de Mercado Envíos',
   'Mercado Libre adelantó el corte de colecta a las 16:00 en la Región Metropolitana.',
   'alerta','urgente', false, now() - interval '30 days', now() - interval '10 days',
   true,'ad000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;


-- =============================================================================
-- 18. Telemetría de jobs (tablero de salud del backstage)
-- =============================================================================
insert into infra.ejecuciones_job
  (run_id, job_id, evento, tenant_id, estado, intento, iniciado_en,
   finalizado_en, duracion_ms, resumen, error)
select
  'run-'||lpad(x.n::text, 6, '0')||'-'||substr(md5(x.n::text), 1, 6),
  j.job_id, j.evento,
  case when x.n % 4 = 0 then null
       else '10000000-0000-0000-0000-000000000001'::uuid end,
  e.estado, e.intento,
  now() - (x.n * interval '47 minutes'),
  case when e.estado <> 'ejecutando'
       then now() - (x.n * interval '47 minutes') + (e.dur || ' milliseconds')::interval end,
  case when e.estado <> 'ejecutando' then e.dur end,
  case when e.estado = 'ok'
       then jsonb_build_object('procesados', 10 + (x.n % 40), 'omitidos', x.n % 3) end,
  case when e.estado = 'error'
       then 'Timeout al llamar al adaptador externo tras 30s' end
from generate_series(1, 90) as x(n)
join lateral (
  select
    (array['dinero/generar-lineas','dinero/cerrar-periodo','dinero/emitir-dte',
           'dinero/conciliar-tres-fuentes','operacion/ingesta-ml',
           'operacion/geocodificar','integraciones/refrescar-tokens-ml',
           'integraciones/despachar-webhooks','plataforma/generar-periodos'])[(x.n % 9) + 1] as job_id,
    (array['dinero/pedido.entregado','dinero/periodo.cerrado','dinero/periodo.emision-solicitada',
           'dinero/periodo.cerrado','operacion/pedido.ingestado',
           'operacion/pedido.ingestado','integraciones/token.por-vencer',
           'integraciones/webhook.pendiente','plataforma/cron.mensual'])[(x.n % 9) + 1] as evento
) j on true
join lateral (
  select
    case when x.n % 17 = 0 then 'error'
         when x.n <= 2 then 'ejecutando'
         else 'ok' end as estado,
    case when x.n % 17 = 0 then 2 else 1 end as intento,
    120 + (x.n * 37) % 4200 as dur
) e on true
on conflict (run_id) do nothing;


-- =============================================================================
-- 19. Bitácora de auditoría (RNF-04: toda acción financiera y de acceso)
-- =============================================================================
insert into identidad.bitacora_auditoria
  (tenant_id, actor_usuario_id, actor_tipo, accion, entidad_tipo, entidad_id,
   detalle, creado_en)
select
  -- tenant_id solo puede ir nulo cuando el actor es el super-admin de plataforma
  -- (lo impone bitacora_auditoria_tenant_nulo_solo_plataforma).
  case when a.actor_tipo = 'super_admin' and x.n % 2 = 0 then null
       else '10000000-0000-0000-0000-000000000001'::uuid end,
  a.actor_id, a.actor_tipo, b.accion, b.entidad_tipo,
  gen_random_uuid(),
  jsonb_build_object('origen','seed-demo-full','ip','200.72.'||(x.n % 250)||'.'||((x.n * 7) % 250)),
  now() - (x.n * interval '2 hours 20 minutes')
from generate_series(1, 120) as x(n)
join lateral (
  select
    (array['emitir_factura_periodo','cerrar_periodo_manual','marcar_liquidacion_pagada',
           'solicitar_payout_conductor','aprobar_lote_liquidaciones','iniciar_sesion',
           'crear_conductor','revocar_api_key','asignar_pedido','resolver_incidencia',
           'anular_linea_cobro','exportar_datos'])[(x.n % 12) + 1] as accion,
    (array['periodo_cobro','periodo_cobro','liquidacion','payout_conductor',
           'liquidacion','sesion','conductor','api_key','pedido','incidencia',
           'linea_cobro','exportacion'])[(x.n % 12) + 1] as entidad_tipo
) b on true
join lateral (
  select
    case when x.n % 13 = 0 then 'ad000000-0000-0000-0000-000000000001'::uuid
         else ('20000000-0000-0000-0000-'||lpad(((x.n % 4) + 1)::text,12,'0'))::uuid end as actor_id,
    case when x.n % 13 = 0 then 'super_admin'::identidad.actor_tipo_auditoria
         when x.n % 7 = 0 then 'sistema'::identidad.actor_tipo_auditoria
         else 'usuario'::identidad.actor_tipo_auditoria end as actor_tipo
) a on true
where not exists (
  select 1 from identidad.bitacora_auditoria ba
  where ba.detalle->>'origen' = 'seed-demo-full'
);


-- =============================================================================
-- 20. Invitaciones pendientes (pantalla de equipo)
-- =============================================================================
insert into identidad.invitaciones
  (id, tenant_id, email, tipo_usuario, rol, seller_id, driver_id, token, estado, expira_en)
values
  ('17000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
   'nueva.coordinadora@despachos-centro.cl','interno','coordinador',null,null,
   'inv-tok-demo-0001','pendiente', now() + interval '5 days'),
  ('17000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',
   'contacto@mercadosur.cl','seller','seller','30000000-0000-0000-0000-000000000002',null,
   'inv-tok-demo-0002','pendiente', now() + interval '3 days'),
  ('17000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001',
   'pedro.soto@despachos-centro.cl','conductor','conductor',null,'40000000-0000-0000-0000-000000000003',
   'inv-tok-demo-0003','aceptada', now() - interval '20 days'),
  ('17000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001',
   'temporal@despachos-centro.cl','interno','supervisor',null,null,
   'inv-tok-demo-0004','expirada', now() - interval '2 days'),
  ('17000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001',
   'revocado@despachos-centro.cl','interno','administracion',null,null,
   'inv-tok-demo-0005','revocada', now() + interval '10 days')
on conflict (id) do nothing;


-- =============================================================================
-- 21. Sincronización final de denormalizados
-- =============================================================================
-- El estado del pedido y el del manifiesto deben ser coherentes entre sí:
-- un manifiesto completado no puede llevar pedidos en ruta.
update operacion.pedidos p
set estado = 'entregado'
from operacion.asignaciones_pedido a
join operacion.manifiestos m on m.id = a.manifiesto_id
where a.pedido_id = p.id
  and a.activa = true
  and m.estado = 'completado'
  and p.estado in ('asignado','en_ruta')
  and p.fecha_compromiso < (now() at time zone 'America/Santiago')::date;

do $$
declare
  v_pedidos bigint;
  v_lc bigint;
  v_ll bigint;
  v_sb bigint;
  v_cb bigint;
begin
  select count(*) into v_pedidos from operacion.pedidos
   where tenant_id = '10000000-0000-0000-0000-000000000001';
  select count(*) into v_lc from dinero.lineas_cobro
   where tenant_id = '10000000-0000-0000-0000-000000000001';
  select count(*) into v_ll from dinero.lineas_liquidacion
   where tenant_id = '10000000-0000-0000-0000-000000000001';
  select count(*) into v_sb from identidad.seller_bodegas
   where tenant_id = '10000000-0000-0000-0000-000000000001';
  select count(*) into v_cb from identidad.courier_bodegas;
  raise notice 'seed-demo-full listo — pedidos=% líneas_cobro=% líneas_liquidación=%',
    v_pedidos, v_lc, v_ll;
  raise notice '  bodegas: % de seller (tenant demo) · % del courier (todos los tenants)',
    v_sb, v_cb;
end $$;
