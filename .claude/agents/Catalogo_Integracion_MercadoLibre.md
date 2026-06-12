# Catálogo de integración con Mercado Libre — para ideación de funcionalidades

**Objetivo.** Mapa de *todo* lo que se puede hacer integrándose con las APIs de Mercado Libre, para analizar nuevas funcionalidades que tu SaaS de couriers podría ofrecer a futuro.

**Cómo leerlo.** Cada dominio trae: **qué expone la API** y **ideas de funcionalidades para el SaaS**, con una etiqueta de relevancia para tu producto (courier-side):
- 🟢 **Core** — directamente alineado con tu MVP / motor entrega→dinero.
- 🟡 **Apoyo** — suma valor al courier o al seller sin ser el núcleo.
- ⚪ **Periférico** — es seller-side puro; útil saber que existe, baja prioridad para ti.

**Advertencias.**
- La API de ML cambia. Este catálogo es un documento de trabajo: **verifica cada capacidad contra la documentación oficial vigente** (usa el agente `mercadolibre-docs`).
- Tu app accede a estos recursos **en nombre de cada seller, vía OAuth** (su cuenta principal). Lo que puedes leer/hacer depende de lo que el seller autorice.
- **Restricción dura permanente:** la app de escaneo/POD de Mercado Envíos Flex **no es integrable**. Nada de lo de abajo la reemplaza.

**Conceptos transversales.**
- **Site IDs:** MLC = Chile · MLA = Argentina · MLB = Brasil · MLM = México · MCO = Colombia · MPE = Perú · MLU = Uruguay · MEC = Ecuador. Muchos ejemplos de la doc usan MLA; hay que traducirlos a MLC y confirmar disponibilidad.
- **Formato JSON**, autenticación OAuth 2.0 (access_token + refresh_token), base `https://api.mercadolibre.com`.

---

## 1. Aplicación, autenticación y multi-cuenta — 🟢 Core
> Verificado 2026-06-11 → [docs/mercadolibre/01-autenticacion-multicuenta.md](../../docs/mercadolibre/01-autenticacion-multicuenta.md)

**Qué expone la API**
- ✅ OAuth 2.0 por seller: authorization code → access_token + refresh_token; refresco de tokens; flujo server-to-server. **MLC:** autorización por `https://auth.mercadolibre.cl/authorization`, token por `POST https://api.mercadolibre.com/oauth/token`. access_token dura **6 h**; refresh_token dura **6 meses**, es de **un solo uso** y exige scope `offline_access`.
- ✅ Gestión de la aplicación (application manager): scopes (`read`/`write`/`offline_access`, no granular), callback de notificaciones. ✅ Nivel de certificación de partner (DPP): existe en el portal .cl (Certified/Silver/Gold/Platinum), pero **no es un endpoint de API**.
- ✅ Usuarios de prueba: `POST /users/test_user` con `site_id=MLC`; **máx. 10**; NO hay sandbox separado, se prueba en producción.

**Ideas de funcionalidades**
- ⚠️ Conexión **multi-cuenta** de un mismo seller (un seller que opera varias cuentas/razones sociales ML bajo el mismo courier). **No hay recurso de "multi-cuenta":** el token está atado a 1 `user_id`. Se modela como N autorizaciones OAuth (un par token/refresh por `user_id`) bajo el mismo seller del courier.
- Panel de **salud de conexiones** por seller (ya en tu MVP): estado del token, vencimiento, reconexión self-service y backfill.
- **Onboarding guiado** que fuerza la autorización con la cuenta principal (evita el error de colaborador).

## 2. Usuarios y cuentas — 🟡 Apoyo
> Verificado 2026-06-11 → [docs/mercadolibre/02-usuarios-cuentas.md](../../docs/mercadolibre/02-usuarios-cuentas.md)

**Qué expone la API**
- ✅ Datos del usuario/seller (`GET /users/{id}`, `/users/me`): `seller_reputation`, `address`, `user_type`, `tags`, `status`. Sin diferencias MLC vs MLA. ✅ `GET /users/{id}?attributes=status` para detectar restricciones (`rejected_by_regulations`, etc.) — útil para onboarding.
- ⚠️ Preferencias de envío (`/users/{id}/shipping_preferences`): el endpoint existe (con página espejo en .cl), campos `optional_me1_allowed`/`optional_me2_allowed` y la regla "todos tienen `custom`/`not_specified` por defecto" — pero el JSON completo no se confirmó al pie (403 al fetch directo); falta probar con un seller MLC real. ❓ "Retiro en local" como preferencia independiente: no encontrado bajo `shipping_preferences` (probablemente es del `logistic_type` del shipment, no del seller).

**Ideas de funcionalidades**
- ⚠️ Detectar automáticamente **qué modos de envío** tiene activos cada seller (no asumir solo Flex) y adaptar la operación. **Aclaración:** `shipping_preferences` (config. de publicación del seller) y `logistic_type` (del shipment, ya cubierto en S5) son cosas distintas — para detección operacional de Flex vs otros, usar `logistic_type`.

## 3. Publicaciones / Items y stock — ⚪ Periférico (con usos puntuales 🟡)
**Qué expone la API**
- CRUD de publicaciones (`/items`), variaciones, fotos, categorías, atributos, estado (activo/pausado), calidad de la publicación.
- Tipos de listado y exposición; carrito de compras (disponible en AR, BR, MX, CL, CO).

**Ideas de funcionalidades**
- Enriquecer la **vista del paquete** con datos del ítem (qué producto va dentro, dimensiones/peso si están), para tarifar mejor o priorizar.
- Cruzar **stock vs. pedidos** para anticipar volumen (más bien seller-side).
- *No es tu negocio* gestionar publicaciones; útil solo como contexto del envío.

## 4. Órdenes / Ventas — 🟢 Core
> Verificado 2026-06-11 → [docs/mercadolibre/04-ordenes-ventas.md](../../docs/mercadolibre/04-ordenes-ventas.md)

**Qué expone la API**
- ✅ Lectura de órdenes: `GET /orders/{id}` y búsqueda `GET /orders/search?seller={id}` (filtros `order.status`, `order.date_created.from/.to`, paginado `offset`/`limit`, `sort`). Comprador, ítems, montos, `payments[].status`, y el **shipment_id** en `order.shipping.id`. **Ojo:** buscando como `seller`, las canceladas no aparecen; el backfill histórico está acotado a ~12 meses.
- ✅ Feedback / calificación post-venta: `GET`/`POST /orders/{id}/feedback` (POST no repetible). Scope `read` para leer.
- ✅ Nota confirmada: en la estructura nueva (`x-format-new: true`) el detalle de envío ya **no** viene embebido; solo `shipping.id` (puede ser `null` si el envío aún no se creó) → se consulta `GET /shipments/{id}`.

**Ideas de funcionalidades**
- **Conciliación venta↔envío↔dinero:** unir la orden (lo vendido) con el envío (lo entregado) y con tu factura al seller — refuerza el motor entrega→dinero.
- Detectar órdenes **pagadas que aún no generan envío** para alertar al seller.
- Reportes de **volumen por seller** basados en órdenes reales.

## 5. Mercado Envíos / Shipments — 🟢 Core (el corazón para ti)
> Verificado 2026-06-11 → [docs/mercadolibre/05-mercado-envios-shipments.md](../../docs/mercadolibre/05-mercado-envios-shipments.md)

**Qué expone la API**
- ✅ Detalle del envío: `GET /shipments/{id}` con header `x-format-new: true`; estado, subestado, dirección del receptor (teléfono **ofuscado**). ⚠️ `/marketplace/shipments/{id}` **NO es equivalente**: es el recurso de Global Selling/CBT (cross-border), no aplica al seller MLC nativo — usar siempre `/shipments/{id}`.
- ✅ **Estados:** pending, handling, ready_to_ship, shipped, delivered, not_delivered, cancelled. ✅ Subestados (ready_to_print, receiver_absent, etc.) confirmados, pero el conjunto **depende del `logistic_type`** y `substatus` puede venir `null` (no es lista cerrada).
- ⚠️ **Modos:** me1, me2, custom, not_specified (los 4 ✅). **logistic_type:** self_service (= Flex), drop_off, cross_docking, fulfillment (= FBM) ✅ — pero falta `xd_drop_off` en el catálogo.
- ✅ **Etiquetas:** `GET /shipment_labels?shipment_ids=...&response_type=pdf|zpl2` — `zpl2` devuelve un **ZIP** (PDF con PLP + TXT Zebra). Disponible en MLC. Límite ~50 `shipment_ids` por llamada (error 400 si se excede).
- ⚠️ **Tracking:** en Flex/ME2 es de **solo lectura** (ML emite el `tracking_number`); **no existe** endpoint para que el courier reporte tracking en Flex. La trazabilidad se construye leyendo `/shipments/{id}` + webhooks `shipments`. Cargar tracking solo aplica a ME1/custom.
- ✅ **Configuración Flex:** suscripciones (`/shipping/flex/sites/{site}/users/{id}/subscriptions/v1`, aplica a MLC); entrega/ventanas (`PUT .../configuration/delivery/custom/v3`); zonas (`GET .../coverage/zones/v1`, `PUT .../coverage/zone/v3`). ✅ `shipping_options`/costos como campos del envío. ❓ La ruta literal `/sites/{site}/shipping_methods` no se pudo confirmar al pie (recurso existe; ruta exacta sin verificar). **Límite duro: 1000 rpm en todos los recursos Flex.**

**Ideas de funcionalidades**
- **Etiquetas ZPL directas a impresora Zebra** en la operación del courier (más rápido que PDF/foto).
- Soportar **multi-modo** (couriers que mueven me2/custom además de Flex), no solo self_service.
- **Tracking white-label** unificado para el seller y el consumidor final dentro de tu plataforma (de **lectura**: `/shipments/{id}` + webhooks `shipments`; ML no permite reportar tracking en Flex).
- Lectura de **costos de envío** para análisis de rentabilidad por ruta/seller.
- Gestión de **ventanas y zonas Flex** desde tu panel (configuración de la suscripción).
- Tablero de **estados/subestados** en tiempo casi real como fuente del motor de dinero (ya en tu MVP).

## 6. Preguntas y mensajería post-venta — 🟡 Apoyo (protege reputación)
> Verificado 2026-06-11 → [docs/mercadolibre/06-preguntas-mensajeria.md](../../docs/mercadolibre/06-preguntas-mensajeria.md)

**Qué expone la API**
- ✅ Preguntas: `GET /questions/search?seller_id={id}` (filtros `item_id`, `from_id`, `sort_fields`/`sort_types`; ❓ lista exacta de valores de `status` no confirmada), `POST /answers` (`{question_id, text}`, máx. 2.000 caracteres), `DELETE /questions/{id}`. ❓ vencimiento de 7 meses sin responder, no confirmado para MLC.
- ⚠️ Mensajería post-venta: `GET/POST /messages/packs/{pack_id}/sellers/{seller_id}?tag=post_sale` (`mark_as_read`, adjuntos hasta 25MB) — confirmado en doc .ar/Global Selling, sin ejemplo MLC explícito. ✅ bloqueos de mensajería (18 meses, `cancelled`, moderación de contenido) confirmados de forma general.
- ✅ La doc oficial **recomienda explícitamente** respuestas semi-automáticas para alto volumen (citado en "Manage questions & answers").

**Ideas de funcionalidades**
- ✅ **Bandeja de preguntas** semi-automática: viable, baja complejidad, respaldada por la doc oficial (`/questions/search` + `POST /answers`).
- ⚠️ Auto-respuestas de **estado de entrega**: viable pero de mayor complejidad — son recursos distintos (preguntas pre-venta vs mensajería post-venta) y requiere encadenar `messages/packs/{pack_id}/sellers/{seller_id}` → `orders/{order_id}` → `shipments/{shipment_id}`. Pendiente validación E2E con datos MLC reales.

## 7. Reclamos / Claims y mediaciones — 🟡 Apoyo
> Verificado 2026-06-11 → [docs/mercadolibre/07-reclamos-claims.md](../../docs/mercadolibre/07-reclamos-claims.md)

**Qué expone la API**
- ⚠️ El recurso correcto es `/post-purchase/v1/claims` (sucesor de `/v1/claims`, deprecado desde 2024-05-06). `/post-purchase/v1/claims/search` con filtros `stage`, `status`, `order_id`, `players.user_id` — reportado por fuentes que citan la doc oficial, no confirmado con fetch directo (403 en .ar/.cl). Existe contraparte `.cl` de la página de claims, sugiriendo recurso transversal a sites.
- ⚠️ Devoluciones asociadas: `GET /post-purchase/v2/claims/$CLAIM_ID/returns` — confirmado por ejemplo curl citado por varias fuentes.
- ❓ Mensajes y resolución de reclamos: rutas exactas no confirmadas.
- ⚠️ Webhook tópico `post_purchase` (`claims`, `claims_actions`): existe, configurable en "Mis aplicaciones", formato no leído de fuente primaria.
- ⚠️ Posible inconsistencia: una nota `.cl` menciona `/v1/claims/search?reason_id=...` (ruta marcada deprecada en `.ar`) — verificar antes de usar.

**Ideas de funcionalidades**
- ✅ **Alertas de reclamos** ligadas a incidencia de envío: **viable** — el claim trae `resource`/`resource_id` (p. ej. `shipment`/`order` + ID) y `claims/search` acepta `order_id`, permitiendo cruzar pedido↔reclamo vía webhook `post_purchase` + sondeo de respaldo (mismo patrón que shipments).
- ⚠️ Vincular reclamos a **liquidación/cobro**: viable **solo como señal de "retener para revisión humana"**, no como anulación automática (consistente con la compuerta de aprobación de facturación). Falta confirmar si la respuesta del claim trae un campo estructurado de resultado (reembolso total/parcial) para automatizar el ajuste.

## 8. Notificaciones / Webhooks — 🟢 Core (tiempo real)
> Verificado 2026-06-11 → [docs/mercadolibre/08-notificaciones-webhooks.md](../../docs/mercadolibre/08-notificaciones-webhooks.md)

**Qué expone la API**
- ✅ Feed en tiempo real vía POST a tu callback URL (payload = solo `resource` + metadatos `_id, user_id, topic, application_id, attempts, sent`, **no** el dato real). ⚠️ **NO hay firma HMAC en el marketplace** — ese `x-signature` es de Mercado Pago; la decisión de producción de quitar el HMAC es **correcta**. La verdad se valida re-consultando el `resource` a la API con el token del seller. ✅ **ACK HTTP 200 dentro de ≤500 ms** o ML desactiva los tópicos; reintentos exponenciales hasta el 8º (~1 h) y luego `GET /missed_feeds`. ❓ Simulador: existe pero no se pudo citar su ubicación oficial al pie.
- **Tópicos verificados:** ✅ `orders_v2`, `shipments`, `items`, `questions`, `messages`, `claims`, `orders_feedback` (aplican MLC) · ❌ `created_orders` (no es tópico; usar `orders_v2`) · ⚠️ `marketplace_items`, `payments`, `invoices`, `fbm_stock_operations`, `item_competition` (existen pero fuera de foco o aplicabilidad MLC por confirmar).

**Ideas de funcionalidades**
- Operación **event-driven**: reaccionar al instante a un envío creado o a un cambio de estado, en vez de solo sondear.
- **Backfill + sondeo de respaldo** combinados (los eventos se pueden perder): patrón ya recomendado en tu skill `flex-ml`.
- Disparadores para **alertas del dashboard** (nuevo pedido, incidencia, reclamo).

## 9. Facturación / Invoices (de ML) — ⚪ Periférico
**Qué expone la API**
- Tópico/recurso de `invoices` cuando se trabaja con la **facturación automática** de ML (asociada a Mercado Envíos Full).

**Ideas de funcionalidades**
- Para tu modelo, la facturación al seller la hace **el courier vía proveedor DTE** (skill `chile-dte`). Este recurso es relevante solo si algún seller usa Full y quieres leer esos documentos como referencia. Baja prioridad.

## 10. Mercado Pago / Pagos y cobros — ⚪ Periférico (con potencial futuro 🟡)
**Qué expone la API**
- Pagos (`payments`), preferencias de cobro, estados de pago; notificaciones de `payments`.

**Ideas de funcionalidades**
- Leer el **estado de pago** de la orden para enriquecer la conciliación venta↔envío↔pago.
- *A futuro y con cuidado:* explorar cobros vía Mercado Pago como una de las opciones de la capa de pagos (hoy tu recomendación es Fintoc/Khipu + Flow; ver skill `pagos-chile`).

## 11. Promociones, precios y descuentos — ⚪ Periférico
**Qué expone la API**
- `seller-promotions` (candidatos a promoción, campañas), opciones de envío gratis, modificadores de exposición/ads.

**Ideas de funcionalidades**
- Es seller-side de venta; poco alineado con un SaaS de couriers. Útil solo si algún día ofreces analítica comercial al seller.

## 12. Reputación y métricas del vendedor — 🟡 Apoyo
> Verificado 2026-06-11 → [docs/mercadolibre/12-reputacion-metricas.md](../../docs/mercadolibre/12-reputacion-metricas.md)

**Qué expone la API**
- ⚠️ `GET /users/{user_id}` → `seller_reputation` (`level_id`, `power_seller_status`, `transactions`) y `metrics.{claims, delayed_handling_time, cancellations}` con `period`/`rate`/`value`/`excluded` — estructura consistente entre fuentes secundarias que citan la doc .ar, no confirmada abriendo la página directamente para MLC.
- ❓ Endpoint específico de "calidad de envío" / "Llega gratis hoy" / Mercado Líder separado de `seller_reputation`: no encontrado para sellers domésticos MLC; `power_seller_status` es el proxy más cercano.
- ❓ `/users/reputation/seller_recovery/status` (programa de recuperación): mencionado en búsquedas, no confirmado.
- ⚠️ Umbrales de evaluación: cifra de "40 ventas en 60 días" para MLC (vs 50 MLA, 60 MLB/MCO) de fuente secundaria, no verificada en developers.mercadolibre.cl directamente. ❓ Frecuencia de actualización (probablemente diaria sobre ventana rolling, sin confirmación explícita de "tiempo real").

**Ideas de funcionalidades**
- ⚠️ **Protección proactiva de reputación**: viabilidad **parcial** — los datos base (`seller_reputation.metrics`) estarían disponibles vía polling con scope `read`, pero **no hay thresholds oficiales expuestos** que disparen pérdida de "Mercado Líder"/"Llega gratis hoy" (algoritmo interno no transparente). La idea es viable solo como **score interno propio del SaaS**, correlacionando incidencias propias con `metrics` leídas por polling — no como lectura directa de un semáforo de ML. Pendiente confirmación manual de las páginas de reputación.

## 13. Catálogo, categorías, atributos y metadata — ⚪ Periférico (utilitario)
**Qué expone la API**
- Sitios (`/sites`), monedas, categorías, atributos, geografía (estados, ciudades, códigos postales), métodos de envío por sitio.

**Ideas de funcionalidades**
- Normalización de **direcciones/comunas** para tu vista "paquetes por comuna" y para ruteo.
- Catálogos de referencia (monedas, geografía) para localización.

## 14. Reportes y métricas de ventas — 🟡 Apoyo
> Verificado 2026-06-11 → [docs/mercadolibre/14-reportes-metricas-ventas.md](../../docs/mercadolibre/14-reportes-metricas-ventas.md)

**Qué expone la API**
- ⚠️ Billing Reports (`/billing/integration/...`: `/monthly/periods`, `/documents`, `/summary`, `/details`) — existen y MLC está entre los sites soportados, pero su propósito es **conciliación fiscal/facturación**, no analítica de ventas/operación.
- ⚠️ Reporte de facturación de Flex (`group=ML/flex/details` o `group=FLEX`) — confirmado disponible **solo para MLA, MLC y MCO**, pero es de **cargos de la logística Flex**, no de desempeño operativo (SLA, volumen, tiempos). ❓ Rutas exactas del flujo de 3 pasos (generar → estado → descargar) no confirmadas literalmente.
- ❌ Reporte de ventas/métricas operativas genérico ("Sales Report"): **no existe**; la doc descarta explícitamente usar Billing Reports como fuente primaria para gestión de ventas, tracking en tiempo real u operación.
- ❌ Reporte de envíos para desempeño (no facturación): no existe como recurso de descarga.

**Ideas de funcionalidades**
- ❌ Depender de un "reporte de ML" para la reportería ejecutiva V2: descartado. **Alternativa confirmada y viable:** agregación propia sobre `/orders/search` + `/shipments/{id}` (ya cubiertos en secciones 4 y 5), guardando histórico en la BD del SaaS — mismo patrón que la ingesta Flex.
- ℹ️ El grupo `FLEX` de Billing Reports podría ser útil a futuro para el módulo `dinero` (conciliar el cobro que ML hace al seller por Flex), pero requiere permiso "Billing" adicional y autorización por un usuario **manager** (riesgo `invalid_operator_user_id` si no se cumple). No es para reportería de desempeño.

## 15. Fulfillment (Mercado Envíos Full) y stock — ⚪ Periférico
**Qué expone la API**
- Stock en fulfillment (FBM), operaciones y movimientos; notificaciones `fbm_stock_operations`.

**Ideas de funcionalidades**
- Solo relevante si atiendes sellers que combinan Full + Flex; permite distinguir qué se opera por cada vía.

## 16. Transversal: sandbox, límites y versionado — 🟢 Core (operación sana)
> Verificado 2026-06-11 → [docs/mercadolibre/16-sandbox-limites-versionado.md](../../docs/mercadolibre/16-sandbox-limites-versionado.md)

**Qué expone la API**
- ✅ Usuarios de prueba: `POST /users/test_user` (`{"site_id":"MLC"}`), máx. 10, **sin sandbox separado** (se prueba en producción). ❓ **Rate limits: NO hay número público** por país para shipments/orders/webhooks (el único valor oficial, "1500 req/min por seller", es de Global Selling y solo para actualización de ítems). Diseñar backoff ante **429** + idempotencia, no un cupo fijo. ✅ Códigos de error en `api-docs-es/errores` (400/401/403/429/500). ✅/⚠️ Versionado **por header** (`x-format-new`) y sufijo de recurso (`orders_v2`), **no** `/v1/` uniforme. ✅ Changelog/novedades oficial con fechas.

**Ideas de funcionalidades**
- **Manejo robusto** de límites de tasa, reintentos e idempotencia (ya en tus RNF).
- Suscribirse a las **novedades de la API** y mantener un índice interno (que el agente `mercadolibre-docs` actualice).

---

## Shortlist de funcionalidades futuras más prometedoras (más allá del MVP)
> Viabilidad técnica verificada 2026-06-11 contra la doc oficial (detalle en los archivos de `docs/mercadolibre/` enlazados en cada dominio).

Priorizadas por encaje con tu producto y por diferenciación:

1. 🟢 **Tracking white-label unificado** (shipments + notificaciones) para seller y consumidor final, dentro de tu plataforma. — ⚠️ **Viable solo de lectura**: `GET /shipments/{id}` (`x-format-new: true`) + webhook `shipments`. ML **no** ofrece endpoint para que el courier "reporte" tracking en Flex/ME2 — el catálogo original lo planteaba como bidireccional; corregido. Ver [05](../../docs/mercadolibre/05-mercado-envios-shipments.md).
2. 🟢 **Etiquetas ZPL a impresora Zebra** integradas a la operación del courier. — ✅ **Viable**: `GET /shipment_labels?shipment_ids=...&response_type=zpl2` confirmado y disponible en MLC (devuelve un ZIP con PDF+PLP y TXT Zebra). Límite ~50 `shipment_ids` por llamada. Ver [05](../../docs/mercadolibre/05-mercado-envios-shipments.md).
3. 🟢 **Multi-modo de envío** (me2 / custom además de Flex): abre el SaaS a couriers que mueven más que Flex. — ✅ **Viable**: los 4 modos (me1/me2/custom/not_specified) y los `logistic_type` (incluye `xd_drop_off`, antes faltante) están confirmados en `/shipments/{id}`. Falta solo confirmar al pie la ruta `/sites/{site}/shipping_methods` (❓). Ver [05](../../docs/mercadolibre/05-mercado-envios-shipments.md).
4. 🟡 **Bandeja semi-automática de preguntas/mensajes** con respuestas de estado de entrega (protege reputación del seller). — ✅/⚠️ **Viable en dos partes**: (a) bandeja de preguntas pre-venta (`/questions/search` + `POST /answers`) es de baja complejidad y la doc oficial recomienda automatizarla; (b) auto-respuesta de estado de entrega vía mensajería post-venta requiere encadenar `messages/packs/{pack_id}/sellers/{seller_id}` → `orders/{order_id}` → `shipments/{shipment_id}`, mayor complejidad y pendiente validación E2E con datos MLC. Ver [06](../../docs/mercadolibre/06-preguntas-mensajeria.md).
5. 🟡 **Alertas de reputación y de reclamos** ligadas a incidencias de envío (refuerza la promesa Flex). — Desglosado: **reclamos ✅ viable** (`/post-purchase/v1/claims/search?order_id=...` + webhook `post_purchase`, mismo patrón que shipments); **reputación ⚠️ parcial** — datos base (`seller_reputation.metrics`) disponibles por polling, pero **sin thresholds oficiales expuestos** que disparen pérdida de "Mercado Líder"/"Llega gratis hoy"; viable solo como score interno propio del SaaS, no como semáforo directo de ML. Ver [07](../../docs/mercadolibre/07-reclamos-claims.md) y [12](../../docs/mercadolibre/12-reputacion-metricas.md).
6. 🟡 **Conexión multi-cuenta** por seller (varias cuentas/razones sociales ML bajo un courier). — ⚠️ **Viable, pero no es un recurso nativo**: el token OAuth está atado a 1 `user_id` (1:1). Se modela como N autorizaciones independientes (un par access/refresh token por `user_id` ML) bajo el mismo seller del courier — más trabajo de modelado de datos del esperado, pero sin bloqueo técnico. Ver [01](../../docs/mercadolibre/01-autenticacion-multicuenta.md).
7. 🟢 **Operación event-driven** completa (webhooks para todo, con sondeo de respaldo y backfill). — ✅ **Viable y reforzada**: confirmado que el marketplace de ML **no firma** los webhooks (correcto haber quitado el HMAC); el payload es solo un "ping" (`resource` + metadatos) — el patrón obligado es ACK 200 en ≤500 ms → re-consultar el `resource` con el token del seller. `GET /missed_feeds` cubre lo perdido tras 8 reintentos (~1 h). Tópico `created_orders` del catálogo no existe; usar `orders_v2`. Ver [08](../../docs/mercadolibre/08-notificaciones-webhooks.md).
8. 🟡 **Analítica de costos de envío** (shipping_options) para rentabilidad por ruta/seller. — ✅ **Viable**: `shipping_options`/costos están disponibles como campos del envío en `/shipments/{id}`. **No** existe un "reporte de ventas/desempeño" descargable de ML (descartado explícitamente por la doc); la analítica debe construirse agregando internamente sobre `/orders/search` + `/shipments/{id}` ya ingeridos. Ver [05](../../docs/mercadolibre/05-mercado-envios-shipments.md) y [14](../../docs/mercadolibre/14-reportes-metricas-ventas.md).

## Qué de esto ya está en tu roadmap (para no duplicar)
- Ingesta de pedidos, estados/subestados, etiquetas, asignación, incidencias, salud de conexiones → **MVP** (Fases A–B).
- Conciliación venta↔envío↔dinero, facturación, liquidación → **MVP** (Fase C, motor entrega→dinero).
- Cobranza/conciliación bancaria, reportería avanzada, protección de reputación, notificaciones al consumidor → **V2**.
- Multicanal (más allá de ML) → **V3**.

> Documento de trabajo. Verifica cada capacidad y endpoint contra la documentación oficial vigente con el agente `mercadolibre-docs` antes de comprometer una funcionalidad.
