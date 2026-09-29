-- =============================================================================
-- codigo_interno único en TODO Rutax, no solo dentro de cada courier
-- =============================================================================
--
-- Hasta hoy la unicidad era por tenant (`idx_pedidos_codigo_interno_uk` sobre
-- `(tenant_id, codigo_interno)`): dos couriers podían tener el mismo
-- `RX-9DXF-KWV0`. Decisión del usuario (2026-09-29): el código identifica al
-- pedido en todo Rutax. Desde que un seller puede trabajar con varios couriers
-- (alta multi-courier, 16-sep) y el backstage busca pedidos por código, un
-- código repetido entre couriers es un pedido ambiguo.
--
-- Por qué no cuesta nada: el código son 8 símbolos Crockford al azar (32^8 ≈
-- 1,1 billones). Las tres rutas que lo generan (`crearPedidoSameDay`,
-- `asegurarCodigoInterno` e `insertarPedidoShopify`) ya reintentan ante 23505,
-- así que una colisión, ahora global, se resuelve igual que antes: se genera
-- otro código.
--
-- ⚠️ El aislamiento entre couriers NO depende de esto: lo impone la RLS de fila.
-- Esto es identidad del pedido, no confidencialidad.

do $$
declare
  v_repetidos int;
begin
  select count(*) into v_repetidos
  from (
    select codigo_interno
    from operacion.pedidos
    where codigo_interno is not null
    group by codigo_interno
    having count(*) > 1
  ) d;

  if v_repetidos > 0 then
    raise exception
      'Hay % codigo_interno repetidos entre couriers: el índice global no se puede crear. Regenera los duplicados antes de aplicar esta migración.',
      v_repetidos;
  end if;
end $$;

create unique index if not exists idx_pedidos_codigo_interno_global_uk
  on operacion.pedidos (codigo_interno)
  where codigo_interno is not null;

-- El índice por tenant queda de más: el global es más estricto y también sirve
-- las búsquedas por código. Mantener los dos solo duplica el costo de escritura.
drop index if exists operacion.idx_pedidos_codigo_interno_uk;

comment on column operacion.pedidos.codigo_interno is
  'Identificador OPERATIVO del pedido same-day que el backend imprime como QR en la
   etiqueta (formato RX-XXXX-XXXX, base32 Crockford — lo genera el backend, no la BD).
   Nullable: solo se pobla en pedidos same_day. ÚNICO EN TODO RUTAX cuando no es
   NULL (índice parcial idx_pedidos_codigo_interno_global_uk, 2026-09-29; antes
   era por tenant). Distinto de tracking_token, que es PÚBLICO (va en la URL
   /tracking/[token]); codigo_interno es interno, no una URL.';
