# 7. Reclamos / Claims y mediaciones

Fecha de verificación: 2026-06-11 · Site: MLC

> Nota metodológica: las páginas de `developers.mercadolibre.com.ar` y `developers.mercadolibre.cl`
> devolvieron HTTP 403 al intento de fetch directo durante esta verificación (bloqueo del lado del
> sitio para el agente, no error de URL). La información de este documento se reconstruyó cruzando
> múltiples resultados de búsqueda que citan textualmente el contenido de esas páginas oficiales
> (incluida la versión `.cl` equivalente de "working-with-claims"). Las URLs están listadas y deben
> re-verificarse con un navegador autenticado/manual antes de construir sobre ellas en producción.
> Todo lo que no pudo confirmarse con un fragmento textual concreto se marca ❓.

## Tabla de capacidades

| Capacidad | Endpoint + método | Parámetros/campos clave | Scope | Estado MLC (✅/⚠️/❌/❓) | URL oficial |
|---|---|---|---|---|---|
| Detalle de un reclamo | `GET /post-purchase/v1/claims/$CLAIM_ID` | Devuelve `id`, `resource_id`, `resource` (`order`/`shipment`/etc.), `type`, `stage`, `status`, `reason_id`, `parent_id`, `fulfilled`, `quantity_type`, `players[]` (role: `complainant`/`respondent`/`mediator`, `user_id`, `available_actions`) | `read` (permiso "post-purchase": leer/enviar mensajes post-venta, gestionar reclamos y devoluciones) | ⚠️ (probable, no confirmado fetch directo en .cl) | https://developers.mercadolibre.com.ar/es_ar/working-with-claims · equivalente .cl: https://developers.mercadolibre.cl/en_us/working-with-claims |
| Búsqueda de reclamos | `GET /post-purchase/v1/claims/search` | Filtros reportados: `stage` (`claim`\|`dispute`\|`recontact`), `status` (`opened`\|`closed`, etc.), `site_id`, `players.role`, `players.user_id`, `parent_id`, `order_id`, `reason_id`, `date_created`, `last_updated` | `read` | ⚠️ (no confirmado el listado completo de filtros directamente en la doc; `order_id` aparece reportado como filtro funcional) | https://developers.mercadolibre.com.ar/es_ar/working-with-claims |
| Endpoint legacy (deprecado) | `GET /v1/claims/...` y `GET /v2/claims/$CLAIM_ID/returns` | — | — | ❌ Deprecado: convivencia desde 2024-03-21, deprecación plena 2024-05-06; "v1 claims" anterior se desactiva desde 2025-05-05 según una de las fuentes | https://developers.mercadolibre.com.ar/es_ar/working-with-claims |
| Devoluciones asociadas a un reclamo | `GET /post-purchase/v2/claims/$CLAIM_ID/returns` | Devuelve tipo de devolución (`claim` = iniciada por reclamo del comprador, `dispute` = resultado de una disputa/mediación), subtipos, estados, info de envíos asociados | `read` | ⚠️ (endpoint confirmado por múltiples fuentes con ejemplo `curl`, no confirmado contra .cl directo) | https://developers.mercadolibre.com.ar/gestionar-devoluciones / https://developers.mercadolibre.com.ar/es_ar/gestionar-devoluciones |
| Mensajes de un reclamo | `GET/POST /post-purchase/v1/claims/$CLAIM_ID/messages` (ruta exacta no confirmada con fetch) | Canal de comunicación entre comprador/vendedor/mediador dentro del reclamo | `read`/`write` (mismo permiso post-purchase) | ❓ (no se pudo confirmar la ruta exacta del recurso de mensajes) | https://developers.mercadolibre.com.ar/es_ar/gestionar-mensaje-de-un-reclamo |
| Resolución de reclamos | Recurso de "resoluciones" (ruta exacta no confirmada) | Permite, según fuentes secundarias (Global Selling), reconocer % y monto de devolución parcial, hacer reembolso total directo desde el reclamo, e identificar si un reclamo impacta la reputación del vendedor | `read`/`write` | ❓ (no confirmado endpoint exacto; descripción funcional sí aparece en doc Global Selling) | https://developers.mercadolibre.com.ar/gestionar-resolucion-de-reclamos · https://global-selling.mercadolibre.com/devsite/manage-claim-resolutions |
| Adjuntos / evidencias del reclamo | `GET /post-purchase/v1/claims/$CLAIM_ID/attachments/$ATTACHMENTS_ID` | Desde 2024-04-12, el campo `file_url` ya no está disponible en `/evidences`, hay que usar el recurso de `attachments` para descargar | `read` | ⚠️ | https://developers.mercadolibre.com.ar/es_ar/working-with-claims |
| Webhook tópico `post_purchase` | Notificaciones HTTP POST a callback URL configurado | `topic`: `post_purchase`; `actions`: `claims` (nuevo reclamo o cambio) y `claims_actions` (acción ejecutada sobre un reclamo); resource: `/post-purchase/v1/claims/$CLAIM_ID`; campos `user_id`, `application_id`, `attempts`, `sent`, `received`. Se configura en "Mis aplicaciones" → tópico "Post Purchase", marcando `claims` y/o `claims_actions` | — (configuración de la app, requiere callback URL) | ⚠️ | https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones |
| Filtro de reclamos por incompatibilidad | `GET /v1/claims/search?reason_id=$reason_id` (mencionado en una nota de novedades de .cl, posiblemente legacy) | `reason_id` específico para reclamos por incompatibilidad de producto | `read` | ❓ (aparece en "news" de .cl pero usa ruta `/v1/claims/` que la doc general marca como deprecada) | https://developers.mercadolibre.cl/devcenter/news/ |

## Notas de aplicabilidad MLC

- No se encontró ninguna señal de que el recurso `/post-purchase/v1/claims` o `/post-purchase/v2/claims/$CLAIM_ID/returns` esté restringido o tenga comportamiento distinto para el site `MLC`. La existencia de `https://developers.mercadolibre.cl/en_us/working-with-claims` como contraparte directa de la página `.ar` sugiere que el recurso es transversal a todos los sites (igual que `/orders` y `/shipments`).
- La nota de "news" de `.cl` que menciona `/v1/claims/search?reason_id=$reason_id` para "reclamos por incompatibilidad" usa una ruta que la documentación general (`.ar`) marca como **deprecada desde 2024-05-06** y **desactivada desde 2025-05-05**. Esto es una inconsistencia entre fuentes que **debe verificarse manualmente**: o bien la nota de `.cl` quedó desactualizada, o existe un caso de uso residual en `/v1/claims/` para ese `reason_id` específico que no migró. No usar esta ruta sin confirmarlo en vivo contra un claim real de MLC.
- No se confirmó si existen `reason_id` específicos de Chile distintos a los de Argentina (PNR, PDD, CS, etc. son genéricos de la plataforma, no por país).
- El permiso/scope exacto requerido para reclamos (¿es el mismo "Mensajería y Posventa" que habilita `/messages`, o es un permiso aparte?) no se confirmó con una cita textual de la matriz de permisos. Está reportado como parte del mismo bloque "post-purchase" (lectura/envío de Q&A, mensajes post-venta, gestión de reclamos y devoluciones), pero esto debe confirmarse en la pantalla de configuración de permisos de la app ("Mis aplicaciones" → permisos).

## Viabilidad de las ideas: alertas de reclamo ligadas a incidencia de envío y vinculación a liquidación/cobro

**¿Un claim trae `order_id` / `shipment_id`?**

- Confirmado (vía múltiples fuentes con ejemplo de campo): el claim trae **`resource`** (tipo de recurso, ej. `order`, `shipment`) y **`resource_id`** (el ID de ese recurso, ej. `"resource_id": 2000009106165734`).
- Para reclamos de tipo "shipment" (originados en el proceso de envío: demoras, daños, problemas logísticos), `resource = "shipment"` y `resource_id` sería el `shipment_id`. Para reclamos de tipo "order" (producto defectuoso, no coincide con la descripción, etc.), `resource = "order"` y `resource_id` sería el `order_id`.
- Además, la búsqueda (`/post-purchase/v1/claims/search`) acepta **`order_id`** como filtro directo: "es posible buscar por `order_id`, y al buscar por `order_id` se mostrarán todos los reclamos asociados a esa orden" — esto da una vía de cruce **order → claims** sin necesidad de iterar todo el listado.
- Para envíos Flex, el `shipment_id` puede obtenerse desde la orden (`/orders/$ORDER_ID` → `shipping.id`), por lo que el cruce **shipment_id → order_id → claims** es viable aunque el claim no traiga `shipment_id` de forma directa para reclamos tipo "order".

**Veredicto — Idea 1: alertas de reclamo ligadas a incidencia de envío**

✅ **Viable en principio**, con dos caminos:
1. **Vía webhook**: suscribirse al tópico `post_purchase` (acciones `claims` y `claims_actions`). Cuando llega una notificación de un nuevo claim, el adaptador resuelve `resource`/`resource_id` con `GET /post-purchase/v1/claims/$CLAIM_ID`. Si `resource = "order"`, se busca el `order_id` en la base local (pedidos ya ingeridos) y se cruza con su `shipment_id`/incidencia registrada.
2. **Vía sondeo de respaldo** (consistente con la práctica ya establecida en el proyecto para webhooks de ML que se pierden): `GET /post-purchase/v1/claims/search?order_id=$ORDER_ID` para los pedidos que el courier marcó con incidencia de entrega (entrega fallida, rechazo, etc.), para detectar si derivaron en un reclamo.

Limitación real: esto depende de que la app tenga el permiso "post-purchase" habilitado en la configuración de la aplicación de ML (no confirmado el nombre exacto del scope/checkbox — debe revisarse en "Mis aplicaciones"). Si el seller no otorgó ese permiso al autorizar vía OAuth, el adaptador no podrá leer claims de ese seller.

**Veredicto — Idea 2: vincular reclamos a la liquidación/cobro (no cobrar un envío que terminó en reclamo por no entrega)**

✅ **Viable como señal de bloqueo/retención**, no como anulación automática:
- Dado que el claim trae `status` (`opened`/`closed`) y `stage` (`claim`/`dispute`/`recontact`), y se puede cruzar por `order_id` → `shipment_id` → línea de cobro/liquidación del courier, es técnicamente posible marcar una línea de cobro como "en disputa" mientras `status = opened`, y resolverla (cobrar normal, anular, o ajustar) cuando el claim cierre.
- **Lo que falta confirmar antes de implementar**: (a) el campo de "resolución" del claim — qué valores trae `fulfilled` y si hay un campo explícito de "resultado final" (reembolso total/parcial, a favor de quién) que permita decidir automáticamente si corresponde no cobrar; la doc de Global Selling menciona funcionalidad de "reembolso total directo desde el reclamo" y "% y monto de devolución parcial" pero no se confirmó el nombre exacto del campo en la respuesta de `/post-purchase/v1/claims/$CLAIM_ID`. (b) el endpoint exacto de "resolución de reclamos" (`gestionar-resolucion-de-reclamos`) no se pudo leer.
- Recomendación de diseño conservadora: tratar el claim como una **señal de "retener/marcar para revisión humana"** en el motor entrega→dinero (consistente con la "compuerta de aprobación de facturación" del proyecto — nada se anula automáticamente), no como un disparador de anulación automática de la línea de cobro.

## URLs citadas

- https://developers.mercadolibre.com.ar/es_ar/que-es-un-reclamo
- https://developers.mercadolibre.com.ar/es_ar/working-with-claims (y su variante en_us)
- https://developers.mercadolibre.cl/en_us/working-with-claims
- https://developers.mercadolibre.com.ar/es_ar/trabajar-con-reclamos
- https://developers.mercadolibre.com.ar/es_ar/gestionar-mensaje-de-un-reclamo
- https://developers.mercadolibre.com.ar/es_ar/gestionar-devoluciones
- https://developers.mercadolibre.com.ar/gestionar-devoluciones
- https://developers.mercadolibre.com.ar/gestionar-resolucion-de-reclamos
- https://global-selling.mercadolibre.com/devsite/manage-claims
- https://global-selling.mercadolibre.com/devsite/manage-claims-messages
- https://global-selling.mercadolibre.com/devsite/manage-claim-resolutions
- https://global-selling.mercadolibre.com/devsite/manage-returns
- https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones
- https://developers.mercadolibre.cl/devcenter/news/

## Pendiente de verificación manual (próxima sesión)

1. Confirmar contra una cuenta de prueba MLC el JSON real de `GET /post-purchase/v1/claims/$CLAIM_ID` para un reclamo originado en un envío Flex (`resource = "shipment"`), y ver si efectivamente trae `shipment_id`.
2. Confirmar el nombre exacto del permiso/scope a habilitar en "Mis aplicaciones" para leer claims (¿es el mismo permiso que habilita `/messages` post-venta?).
3. Confirmar si la ruta `/v1/claims/search?reason_id=...` mencionada en `developers.mercadolibre.cl/devcenter/news/` sigue activa o es residual/desactualizada.
4. Confirmar el endpoint y campos exactos de "resolución de reclamos" (`gestionar-resolucion-de-reclamos`) para saber si trae el resultado final (reembolso total/parcial) de forma estructurada.
