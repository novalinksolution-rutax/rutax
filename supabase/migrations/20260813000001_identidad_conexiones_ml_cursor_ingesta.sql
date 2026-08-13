-- =============================================================================
-- identidad.conexiones_seller_ml — cursor de la ingesta continua de pedidos Flex
-- =============================================================================
-- Contexto: hasta ahora la única vía de entrada de un pedido Flex era el
-- backfill, que solo corre al (re)conectar una cuenta. La ingesta continua
-- (`ml/ingestaPedidos`, cron cada 30 min de 06:00 a 23:00 Santiago) necesita
-- saber, POR CONEXIÓN, hasta qué instante ya listó órdenes.
--
-- POR QUÉ UNA COLUMNA NUEVA Y NO `ultima_sync_exitosa_en`
-- --------------------------------------------------------------------------
-- `ultima_sync_exitosa_en` es la marca de SALUD que ve el seller en su panel
-- («última sincronización exitosa»); hoy la escribe el intercambio OAuth. Si el
-- cursor de ingesta viviera ahí, cualquier escritura de salud —una reconexión,
-- un sondeo que mañana la refresque— empujaría el cursor hacia adelante sin
-- haber ingerido nada, y las órdenes de ese hueco se perderían EN SILENCIO y
-- para siempre. Son dos hechos distintos («la conexión responde» vs. «tenemos
-- las órdenes hasta T») y por eso van en dos columnas.
--
-- Escritura: SOLO el job de ingesta, vía service_role, después de recorrer con
-- éxito la ventana de esa conexión. Si la fase de órdenes falla, la excepción
-- sube y el cursor NO avanza: la próxima corrida vuelve a cubrir la ventana.
--
-- Lectura: el job (service_role). No se agrega a ninguna vista de `public` ni a
-- ninguna superficie del seller — es un detalle de operación, no información
-- del negocio del seller. Las políticas RLS existentes de la tabla no cambian:
-- una columna nueva queda cubierta por las mismas políticas de fila.
--
-- Compatibilidad: el job funciona ANTES de aplicar esta migración (detecta la
-- columna ausente y barre la ventana máxima de 7 días en cada corrida, más caro
-- pero nunca incorrecto). Aplicarla es lo que lo vuelve incremental.
--
-- IDEMPOTENTE: `add column if not exists` + `create index if not exists`.
-- =============================================================================

alter table identidad.conexiones_seller_ml
  add column if not exists ingesta_ml_cursor_en timestamptz;

comment on column identidad.conexiones_seller_ml.ingesta_ml_cursor_en is
  'Hasta qué instante la ingesta continua (job ml/ingestaPedidos) ya listó '
  'órdenes de ESTA conexión. Cursor incremental de `order.date_created`: la '
  'siguiente corrida arranca una hora antes de este valor (ML redondea los '
  'filtros de fecha a la hora, así que el solapamiento es explícito). NULL = '
  'nunca se ingirió por esta vía; el job barre la ventana máxima de 7 días. '
  'NO confundir con `ultima_sync_exitosa_en`, que es la marca de SALUD que ve '
  'el seller: mezclarlas haría que una escritura de salud saltara el cursor y '
  'se perdieran órdenes en silencio. Solo la escribe service_role.';

-- El cron recorre todas las conexiones activas ordenando por lo más rancio;
-- el índice parcial mantiene barato ese barrido a medida que crecen las filas.
create index if not exists conexiones_seller_ml_ingesta_cursor_idx
  on identidad.conexiones_seller_ml (ingesta_ml_cursor_en)
  where estado_salud <> 'desvinculada';
