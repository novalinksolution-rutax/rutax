# 08 · Notificaciones / Webhooks (Marketplace)

Fecha de verificación: 2026-06-11 · Site: MLC

> Verificado contra la documentación oficial de Mercado Libre (developers.mercadolibre.com.ar).
> El sitio bloquea el fetch directo (HTTP 403), por lo que el contenido se confirmó vía los
> extractos indexados de las páginas oficiales. Donde solo hubo fuentes de terceros se marca ❓.

## Mecánica / capacidades

| Capacidad | Comportamiento verificado | Estado | URL |
|---|---|---|---|
| Entrega | El marketplace hace `POST` a la *Notifications Callback URL* configurada en el Application Manager. | ✅ | https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones |
| Formato del payload | JSON con los campos: `_id`, `resource`, `user_id`, `topic`, `application_id`, `attempts`, `sent`, `received`. (`resource` es la ruta del recurso a consultar; el payload NO trae el dato, hay que ir a la API a buscarlo.) | ✅ | https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones |
| ACK requerido | Responder **HTTP 200 dentro de 500 ms** de recibida la notificación. Si no se cumple, ML **desactiva** los tópicos suscritos y hay que volver a suscribirse. | ✅ | https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones |
| Reintentos | Si no se recibe un 200, el mensaje queda "no enviado" y se reintenta a intervalos exponenciales durante **1 hora** (hasta el **8º reintento**). Pasado ese período, el mensaje se descarta. | ✅ | https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones |
| Notificaciones perdidas | `GET /missed_feeds` devuelve el historial de notificaciones que tras el 8º reintento (1 h) no recibieron HTTP 200. Filtrable por `topic` con `limit`/`offset`. | ✅ | https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones |
| Firma / validación de origen (HMAC) | La página oficial del **marketplace** NO documenta ninguna firma (`x-signature`/HMAC) para validar las notificaciones del marketplace. El esquema de firma HMAC-SHA256 con `x-signature` pertenece a **Mercado Pago**, no al feed del marketplace de ML. | ⚠️ (no existe para marketplace) | Marketplace: https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones · Mercado Pago (donde SÍ existe): https://www.mercadopago.com.ar/developers/es/docs/checkout-api/additional-content/your-integrations/notifications/webhooks |
| Simulador de notificaciones | ML ofrece un simulador para probar/mapear escenarios de webhooks (mencionado en docs y guías). Ubicación exacta dentro del Application Manager no se pudo citar textual del sitio oficial. | ⚠️ | https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones |
| Suscripción a tópicos | En el **Application Manager** se configura la *Notifications Callback URL* (URL pública del dominio) y se seleccionan los **Topics** a escuchar. También existe `POST /applications/{app_id}/webhooks` (registro vía API) — el registro vía API se reporta en guías de terceros, confirmar en la app antes de depender de él. | ✅ (panel) / ❓ (endpoint API) | https://developers.mercadolibre.com.ar/es_ar/crea-una-aplicacion-en-mercado-libre |

## Tópicos

| Tópico | ¿Existe? | Aplica MLC | Estado | URL |
|---|---|---|---|---|
| `orders_v2` | Sí — creación y modificación de ventas confirmadas. | Sí (núcleo, transversal a sites) | ✅ | https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones |
| `created_orders` | No es el nombre del tópico de catálogo. El tópico oficial de órdenes es `orders_v2`. "created orders / marketplace orders" es una descripción, no un tópico aparte. | — | ❌ (usar `orders_v2`) | https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones |
| `shipments` | Sí — creación y cambios de envíos de ventas confirmadas. | Sí. Clave para Flex (MLC). | ✅ | https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones |
| `items` | Sí — cambios en publicaciones propias. | Sí | ✅ | https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones |
| `marketplace_items` | Sí — cambios en ítems del marketplace. Variante del feed de ítems (más común en contexto Global Selling / nomenclatura `marketplace_*`). | ❓ disponibilidad por site | ⚠️ | https://global-selling.mercadolibre.com/devsite/receive-notifications |
| `questions` | Sí — preguntas hechas o respondidas. | Sí | ✅ | https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones |
| `messages` | Sí — nuevos mensajes recibidos con el `user_id` como receptor (post-venta). | Sí | ✅ | https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones |
| `claims` | Sí — reclamos sobre las ventas. | Sí | ✅ | https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones |
| `payments` | Sí — creación y cambios de estado de pagos. | ❓ — en marketplace MLC el dinero del seller no pasa por el courier; relevancia para este SaaS es baja. Verificar si aplica al flujo MLC del seller. | ⚠️ | https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones |
| `invoices` | Sí — facturación automática generada por el generador de facturas de ML (p. ej. Full). | ❓ por site/operación; ligado a fiscalidad local. Confirmar para MLC. | ⚠️ | https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones |
| `fbm_stock_operations` / "Stock fulfillment" | Sí — operaciones sobre stock almacenado en bodegas FBM (Full). | No aplica a Flex/same-day (este SaaS descarta Full). | ⚠️ (fuera de alcance) | https://rollout.com/integration-guides/mercado-libre/api-essentials |
| `item_competition` | Sí — cambios de estado en publicaciones de catálogo en competencia. | Fuera del foco del SaaS. | ⚠️ (fuera de alcance) | https://rollout.com/integration-guides/mercado-libre/api-essentials |
| `orders_feedback` | Sí — creación y cambios en feedbacks de ventas confirmadas. (No estaba en el catálogo, pero existe.) | Sí | ✅ | https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones |
| `items_prices`, `public_offers`, `stock_locations`, `catalog_suggestions` | Existen en el listado general de tópicos. | ❓ disponibilidad por site; fuera del foco del SaaS. | ❓ | https://rollout.com/integration-guides/mercado-libre/api-essentials |

> Nota oficial: "la disponibilidad de ciertos tópicos puede variar según el site de Mercado Libre".
> ML está migrando a una estructura de **subtópicos/filtros** para segmentar updates por
> acción/atributo dentro de un mismo tópico.

## Notas de aplicabilidad MLC

- **HALLAZGO CLAVE — el marketplace de ML NO firma sus webhooks.** La documentación oficial del
  marketplace (`productos-recibe-notificaciones`) no menciona ninguna firma `x-signature` ni HMAC
  para validar el origen de las notificaciones del marketplace. El esquema de firma secreta
  HMAC-SHA256 con header `x-signature` es de **Mercado Pago** (sus webhooks de pagos), un producto
  distinto. Las guías de terceros (rollout.com, dev.to) confunden ambos al decir "similar a
  Mercado Pago", que es justamente el error que ya se detectó en producción en este proyecto
  (la validación HMAC era de Mercado Pago y se quitó). **Confirmado: para el feed del marketplace
  no hay validación de firma.** La autenticidad debe asegurarse por otros medios (URL secreta,
  y sobre todo: tratar el payload como un simple "ping" y re-consultar el `resource` a la API con
  el access token del seller, donde la respuesta sí está autenticada).
- **No confiar en el payload del webhook como fuente de verdad.** El payload solo trae `resource`
  (la ruta) y metadatos; hay que hacer GET a la API para obtener el estado real. Esto refuerza el
  patrón del proyecto: **webhooks + sondeo de respaldo**, porque los eventos se pueden perder
  (de ahí `/missed_feeds`).
- **Tópicos relevantes para el SaaS (Flex/MLC):** `shipments` (creación/cambios de envío — núcleo),
  `orders_v2` (venta confirmada que origina el envío), y como apoyo `claims`, `questions`,
  `messages`. `payments`/`invoices` quedan a verificar para MLC; `fbm_stock_operations` e
  `item_competition` quedan fuera (el proyecto ingiere solo Flex `self_service`, descarta Full).
- **`created_orders` no es un tópico**: el catálogo lo lista como sinónimo, pero el tópico oficial
  de órdenes es `orders_v2`. Corregir en el catálogo.
- **MLA vs MLC:** la mecánica (500 ms, HTTP 200, 8 reintentos/1 h, `/missed_feeds`, ausencia de
  firma) es transversal a los sites; lo que varía es la **disponibilidad de tópicos por site**.
  No se halló una página `.cl` específica que contradiga lo de `.ar`; el sitio `.cl` devolvió 403
  al fetch directo, así que la confirmación MLC se basa en que la doc es común y en la regla
  oficial de "disponibilidad varía por site". Verificar en el Application Manager con una cuenta
  MLC qué tópicos aparecen seleccionables.

## URLs citadas

- Recibir notificaciones (marketplace, oficial AR): https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones
- Crear una aplicación (Application Manager, callback URL y tópicos): https://developers.mercadolibre.com.ar/es_ar/crea-una-aplicacion-en-mercado-libre
- Receive notifications (Global Selling, EN): https://global-selling.mercadolibre.com/devsite/receive-notifications
- Webhooks de Mercado Pago (HMAC `x-signature` — producto DISTINTO, NO aplica al marketplace): https://www.mercadopago.com.ar/developers/es/docs/checkout-api/additional-content/your-integrations/notifications/webhooks
- Guía de terceros (referencia secundaria, mezcla MP y ML — usar con cautela): https://rollout.com/integration-guides/mercado-libre/api-essentials
