-- =============================================================================
-- Origen de cuenta ML en el pedido (preparación para seller con 1:N cuentas ML)
-- =============================================================================
-- Aditivo y 100% compatible con el modelo 1:1 vigente: agrega
-- operacion.pedidos.ml_user_id para registrar de QUÉ cuenta de Mercado Libre
-- proviene cada pedido Flex. Es la clave estable (sobrevive desconexión/
-- reconexión) con la que el pipeline ya desambigua (procesar-shipment) y con la
-- que la UI mostrará el origen cuando el seller tenga más de una cuenta.
--
-- NO cambia comportamiento: hoy cada seller tiene una sola conexión, así que el
-- backfill deja el valor correcto para lo existente.
--
-- El flip 1:1 -> 1:N de identidad.conexiones_seller_ml (drop unique(seller_id),
-- unicidad parcial (seller_id, ml_user_id), tope 3, alias/nickname) va en una
-- migración posterior acoplada al refactor de pipeline/OAuth/UI y a sus tests.
-- Ver docs/arquitectura/seller-multicuenta-ml.md.
-- =============================================================================

alter table operacion.pedidos
  add column if not exists ml_user_id text;

comment on column operacion.pedidos.ml_user_id is
  'Cuenta de Mercado Libre (ml_user_id) de la que proviene el pedido Flex. NULL
   para same-day (sin cuenta ML). Clave estable de origen: la conexión viva se
   resuelve por (seller_id, ml_user_id) y sobrevive desconexión/reconexión.
   Prep. para seller con múltiples cuentas ML (docs/arquitectura/seller-multicuenta-ml.md).';

-- Backfill de lo existente: mientras el modelo es 1:1, cada seller tiene una sola
-- conexión, así que el origen es inequívoco. Solo pedidos Flex (con shipment) que
-- aún no tengan el dato.
update operacion.pedidos p
set ml_user_id = c.ml_user_id
from identidad.conexiones_seller_ml c
where c.seller_id = p.seller_id
  and c.ml_user_id is not null
  and p.ml_user_id is null
  and p.ml_shipment_id is not null;

-- Índice liviano para la resolución por (seller_id, ml_user_id) en el pipeline.
create index if not exists idx_pedidos_seller_ml_user
  on operacion.pedidos (seller_id, ml_user_id)
  where ml_user_id is not null;

-- Re-emitir la vista public.pedidos (select *) para heredar la columna nueva.
-- security_invoker = true se conserva; los grants existentes persisten.
create or replace view public.pedidos
  with (security_invoker = true)
  as select * from operacion.pedidos;

comment on view public.pedidos is
  'Espejo de operacion.pedidos para PostgREST. RLS heredada de la tabla base
   (security_invoker = true): P1 tenant + P2 seller + P3 conductor. Incluye
   ml_user_id (origen de cuenta ML del pedido Flex).';
