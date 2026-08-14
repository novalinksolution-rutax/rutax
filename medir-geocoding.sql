-- MEDICION DEL BACKFILL DE GEOCODING - SOLO LECTURA, no modifica nada.
-- Ejecutar en produccion (SQL Editor de Supabase).

-- 1) Cuantos pedidos hay y en que estado geografico.
select geo_estado, count(*) as pedidos, count(lat) as con_coordenada,
       min(geo_confianza) as conf_min, max(geo_confianza) as conf_max
from operacion.pedidos group by geo_estado order by 1;

-- 2) LA CIFRA QUE DECIDE TODO: cuantos tienen firma de CENTROIDE.
--    Dos firmas independientes; si no coinciden, averiguar por que antes de seguir.
select count(*) filter (where geo_confianza = 0.500) as por_confianza_stub,
       count(*) filter (where (lat, long) in ((-34.0289,-71.1019),(-33.7333,-70.7417),(-33.6394,-70.7686),(-33.4969,-70.7186),(-33.4233,-70.7406),(-33.2019,-70.6747),(-33.3833,-70.6750),(-33.4083,-71.1417),(-33.5625,-70.6750),(-33.6792,-70.9833),(-33.4597,-70.6981),(-33.3667,-70.6417),(-33.4167,-70.6667),(-33.7500,-70.8972),(-33.5333,-70.6625),(-33.5500,-70.5833),(-33.5417,-70.6250),(-33.5833,-70.6333),(-33.4444,-70.5375),(-33.2833,-70.8833),(-33.4089,-70.5683),(-33.3500,-70.5167),(-33.5236,-70.6889),(-33.4444,-70.7250),(-33.4894,-70.5986),(-33.5167,-70.7667),(-33.5167,-71.1333),(-33.6889,-71.2153),(-33.4564,-70.5969),(-33.5667,-70.8000),(-33.8083,-70.7417),(-33.4869,-70.6733),(-33.6097,-70.8769),(-33.4889,-70.5417),(-33.6389,-70.5917),(-33.4314,-70.6111),(-33.4417,-70.7583),(-33.6111,-70.5756),(-33.3667,-70.7333),(-33.4278,-70.7000),(-33.4000,-70.6417),(-33.4042,-70.7250),(-33.5933,-70.7000),(-33.4944,-70.6278),(-33.6417,-70.3528),(-33.4972,-70.6500),(-33.8917,-71.4583),(-33.5389,-70.6444),(-33.4489,-70.6693),(-33.6639,-70.9278),(-33.0833,-70.9333),(-33.3833,-70.6000))) as por_coordenada_exacta,
       count(*) filter (where geo_confianza = 1) as coordenada_de_ml,
       count(*) as total_resueltos
from operacion.pedidos where geo_estado = 'resuelto';

-- 3) Desglose de los sospechosos, para saber a quien afecta.
select origen, tipo_pedido, destinatario_comuna, count(*) as pedidos
from operacion.pedidos
where geo_estado = 'resuelto'
  and (geo_confianza = 0.500 or (lat, long) in ((-34.0289,-71.1019),(-33.7333,-70.7417),(-33.6394,-70.7686),(-33.4969,-70.7186),(-33.4233,-70.7406),(-33.2019,-70.6747),(-33.3833,-70.6750),(-33.4083,-71.1417),(-33.5625,-70.6750),(-33.6792,-70.9833),(-33.4597,-70.6981),(-33.3667,-70.6417),(-33.4167,-70.6667),(-33.7500,-70.8972),(-33.5333,-70.6625),(-33.5500,-70.5833),(-33.5417,-70.6250),(-33.5833,-70.6333),(-33.4444,-70.5375),(-33.2833,-70.8833),(-33.4089,-70.5683),(-33.3500,-70.5167),(-33.5236,-70.6889),(-33.4444,-70.7250),(-33.4894,-70.5986),(-33.5167,-70.7667),(-33.5167,-71.1333),(-33.6889,-71.2153),(-33.4564,-70.5969),(-33.5667,-70.8000),(-33.8083,-70.7417),(-33.4869,-70.6733),(-33.6097,-70.8769),(-33.4889,-70.5417),(-33.6389,-70.5917),(-33.4314,-70.6111),(-33.4417,-70.7583),(-33.6111,-70.5756),(-33.3667,-70.7333),(-33.4278,-70.7000),(-33.4000,-70.6417),(-33.4042,-70.7250),(-33.5933,-70.7000),(-33.4944,-70.6278),(-33.6417,-70.3528),(-33.4972,-70.6500),(-33.8917,-71.4583),(-33.5389,-70.6444),(-33.4489,-70.6693),(-33.6639,-70.9278),(-33.0833,-70.9333),(-33.3833,-70.6000)))
group by 1,2,3 order by 4 desc limit 20;

-- 4) EL CACHE: si hay filas del stub, resetear pedidos NO sirve - el reintento
--    devuelve el mismo centroide desde aca. Esas filas hay que borrarlas.
select proveedor, geo_estado, count(*) as filas
from integraciones.geocoding_cache group by 1,2 order by 1,2;

-- 5) Pedidos atascados sin coordenada (otro frente del mismo tema).
select geo_estado, count(*) from operacion.pedidos where lat is null group by 1;
