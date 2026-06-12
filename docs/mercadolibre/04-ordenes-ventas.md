# Catálogo ML — Sección 4: Órdenes / Ventas

> Fecha de verificación: 2026-06-11 · Site: MLC (Chile)
> Base API: `https://api.mercadolibre.com`
> Contexto: SaaS B2B couriers Flex; la app accede en nombre del seller vía OAuth.

## Resumen de capacidades

| Capacidad | Endpoint + método | Parámetros/campos clave | Scope | Estado MLC | URL oficial |
|---|---|---|---|---|---|
| Obtener una orden | `GET /orders/{id}` (con header `x-format-new: true` para estructura nueva) | `id`, `status`, `date_created`, `date_closed`, `buyer`, `seller`, `order_items`, `total_amount`, `payments[]`, `shipping`, `feedback` | `read` | ✅ | [.cl](https://developers.mercadolibre.cl/es_ar/gestiona-ventas) · [.ar](https://developers.mercadolibre.com.ar/es_ar/gestiona-ventas) |
| Buscar órdenes del seller | `GET /orders/search?seller={SELLER_ID}` | filtros: `seller=` (requerido al buscar como vendedor), `order.status`, `order.date_created.from`/`.to`, `tags` (p. ej. `mshops`); paginado `offset`+`limit`; `sort` ∈ {`date_asc`,`date_desc`,`updated_asc`,`updated_desc`,`closed_asc`,`closed_desc`} | `read` | ✅ | [.ar](https://developers.mercadolibre.com.ar/es_ar/gestiona-ventas) |
| Buscar órdenes como comprador | `GET /orders/search?buyer={BUYER_ID}` | `buyer=`; como comprador SÍ se ven órdenes `manually_cancelled` (como vendedor se filtran las canceladas) | `read` | ⚠️ (no aplica al caso courier — la app actúa como seller) | [.ar](https://developers.mercadolibre.com.ar/es_ar/gestiona-ventas) |
| shipment_id en la orden (estructura nueva) | campo `shipping` → `shipping.id` en el JSON de `GET /orders/{id}` con `x-format-new: true` | El detalle de envío YA NO viene embebido: solo el `id`. Se consulta luego `GET /shipments/{id}`. `shipping.id` puede ser `null` si el envío aún no se creó | `read` | ✅ | [.ar](https://developers.mercadolibre.com.ar/es_ar/envios) |
| Estado de la orden (`status`) | dentro de `GET /orders/{id}` / `/orders/search` | `confirmed`, `payment_required`, `payment_in_process`, `partially_paid`, `paid`, `partially_refunded`, `cancelled`/`manually_cancelled`, `invalid` (❓ confirmar lista cerrada) | `read` | ✅ | [.ar](https://developers.mercadolibre.com.ar/es_ar/gestiona-ventas) |
| Estado de pago (`payments[].status`) | array `payments[]` dentro de la orden | objetos de pago con `id`, `transaction_amount`, `currency_id`, `status` (p. ej. `approved`). Orden `paid` ⇔ pago `approved` | `read` | ✅ | [.ar](https://developers.mercadolibre.com.ar/en_us/payment-handling) |
| Leer feedback de la venta | `GET /orders/{id}/feedback` (o `GET /feedbacks/{feedback_id}` usando el id del objeto `feedback` de la orden) | objeto `feedback` con ids `purchase` y `sale` (pueden ser `null`) | `read` | ✅ | [.ar](https://developers.mercadolibre.com.ar/es_ar/feedback-sobre-venta) |
| Crear feedback de la venta | `POST /orders/{id}/feedback` | body: `fulfilled` (bool), `rating` (`positive`/`neutral`/`negative`), `message`, `reason` (p. ej. `OUT_OF_STOCK`), `restock_item` (bool). No se puede crear dos veces (400); no se puede enviar `not fulfilled` tras expirar la orden (400) | `write`/`offline_access` | ✅ | [.ar](https://developers.mercadolibre.com.ar/es_ar/feedback-sobre-venta) |
| Descuentos que impactaron la venta | `GET /orders/{id}/discounts` (recurso `/discounts`) | detalle de descuentos aplicados a la orden | `read` | ❓ (existe en .ar; no confirmado explícitamente para MLC) | [.ar](https://developers.mercadolibre.com.ar/es_ar/gestiona-ventas) |
| Límites de tasa (rate limit) | — | ❓ No documentado de forma numérica en la sección de órdenes | — | ❓ | — |

## Notas de aplicabilidad MLC

- **El recurso `/orders` aplica a Chile (MLC).** La página equivalente existe en el portal chileno (`developers.mercadolibre.cl/es_ar/gestiona-ventas`) y describe el mismo recurso, mismos campos (payments, feedback id, canales de venta) y el mismo criterio de scope: `read` si solo lees; `offline_access` si actúas en nombre del usuario fuera de línea (access_token + refresh_token). No se detectaron diferencias de comportamiento entre MLA y MLC para órdenes.
- **Estructura nueva confirmada.** Con `x-format-new: true` el JSON de la orden ya NO trae el envío embebido: solo `shipping.id`. El detalle se obtiene en `GET /shipments/{id}` (también con `x-format-new: true`). Esto valida directamente el flujo de conciliación venta↔envío del catálogo: leer la orden → tomar `shipping.id` → consultar el shipment.
- **`shipping.id` puede ser `null`.** Aunque exista la orden, el envío puede tardar en crearse. Para "órdenes pagadas sin envío" hay que tratar `shipping.id == null` como caso esperado y reintentar (sondeo de respaldo), consistente con la nota del proyecto de que los webhooks se pierden.
- **Búsqueda como seller filtra canceladas.** `GET /orders/search?seller=` NO devuelve órdenes canceladas/`manually_cancelled` (sí aparecen al buscar como `buyer`). Para reportes de volumen "reales" tener presente que las canceladas no salen por la búsqueda de vendedor.
- **Retención de datos.** Las órdenes se guardan/consultan hasta 12 meses hacia atrás (según doc .ar). Relevante para backfill histórico.
- **Tag `mshops`.** Permite distinguir ventas de Mercado Shops (`tags=mshops`); útil si un seller mezcla canales.
- **Pendiente de confirmar (❓):** lista cerrada exacta de valores de `status` (incluyendo `invalid`), aplicabilidad explícita de `/orders/{id}/discounts` en MLC, y cifras de rate limit. Las páginas `.ar`/`.cl` devuelven 403 a la extracción directa (anti-bot del portal); los datos anteriores provienen de los extractos indexados de esas mismas URLs oficiales.

## URLs citadas

- Obtener/gestionar una orden (Chile, MLC): https://developers.mercadolibre.cl/es_ar/gestiona-ventas
- Obtener/gestionar una orden (Argentina, MLA — referencia base): https://developers.mercadolibre.com.ar/es_ar/gestiona-ventas
- Envíos / estructura nueva y `x-format-new` (shipping.id en la orden): https://developers.mercadolibre.com.ar/es_ar/envios
- Feedback de una venta (GET/POST): https://developers.mercadolibre.com.ar/es_ar/feedback-sobre-venta
- Manejo de pagos (payments[].status): https://developers.mercadolibre.com.ar/en_us/payment-handling
- Order Management (EN, referencia): https://developers.mercadolibre.com.ar/en_us/order-management
