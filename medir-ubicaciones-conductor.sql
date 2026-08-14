-- ¿HAY POSICIONES DE CONDUCTOR GUARDADAS SIN TURNO QUE LAS JUSTIFIQUE?
-- SOLO LECTURA. No muestra ni una coordenada: solo el conductor y desde cuándo.
-- Ejecutar en produccion (SQL Editor de Supabase).

-- 1) Cuantas filas hay en total, y cuan viejas son.
select count(*)                                      as filas,
       min(actualizado_en)                           as mas_antigua,
       max(actualizado_en)                           as mas_reciente
from operacion.ubicacion_conductor;

-- 2) LA QUE IMPORTA: filas sin manifiesto en ruta hoy que las justifique.
--    Toda fila devuelta es una posicion conservada despues del turno.
--    Si la mas antigua es de hace dias, es casi seguro un domicilio.
select u.conductor_id,
       u.actualizado_en,
       (now() - u.actualizado_en) as antiguedad
from operacion.ubicacion_conductor u
left join operacion.manifiestos m
  on  m.driver_id       = u.conductor_id
  and m.tenant_id       = u.tenant_id
  and m.estado          = 'en_ruta'
  and m.fecha_operacion = (now() at time zone 'America/Santiago')::date
where m.id is null
order by u.actualizado_en;

-- 3) Consentimientos de ubicacion vigentes (para saber a cuantos afecta).
select count(*) as consentimientos_vigentes
from operacion.consentimientos_ubicacion
where revocado_en is null;
