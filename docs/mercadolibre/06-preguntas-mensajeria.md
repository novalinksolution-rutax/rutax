# 6. Preguntas y mensajería post-venta — verificación de catálogo

Fecha de verificación: 2026-06-11 · Site: MLC

> Nota metodológica: los dominios `developers.mercadolibre.com.ar` y `developers.mercadolibre.cl`
> devuelven HTTP 403 a fetch directo (bloqueo anti-bot del portal). La verificación se realizó
> mediante búsquedas que indexan y citan literalmente el contenido de esas páginas oficiales
> (incluye fragmentos textuales de las páginas `/questions`, `/manage-questions-and-answers`,
> `/preguntas-y-respuestas`, `/messaging-after-sale` y la versión `.cl`). No se pudo abrir el
> render completo de la página, por lo que algunos parámetros menores quedan marcados ❓ y deben
> confirmarse con un acceso autenticado/manual al portal antes de implementar.

## Tabla de capacidades

| Capacidad | Endpoint + método | Parámetros/restricciones clave | Scope | Estado MLC (✅/⚠️/❌/❓) | URL oficial |
|---|---|---|---|---|---|
| Buscar preguntas por vendedor | `GET /questions/search?seller_id={SELLER_ID}` | Filtros confirmados: `seller_id`, `item_id`, `from_id`. `sort_fields` acepta `item_id, seller_id, from_id, date_created` (orden con `sort_types=ASC|DESC`). Filtro `status` (UNANSWERED/ANSWERED/etc.) aparece en ejemplos de la doc .cl pero no se confirmó la lista completa de valores ni filtro por rango de `date_created` (`date_created_from/to`) — ❓ pendiente confirmación literal | `read` (lectura sobre recursos del vendedor autenticado) | ✅ confirmado para MLC: la doc `.cl` muestra ejemplos con `item_id` prefijo `MLC...` y nota "se actualiza una vez al día" | [Questions & Answers (.ar)](https://developers.mercadolibre.com.ar/en_us/questions), [Preguntas y Respuestas (.cl)](https://developers.mercadolibre.cl/es_ar/preguntas-y-respuestas) |
| Obtener detalle de una pregunta | `GET /questions/{QUESTION_ID}` | Incluye datos del comprador (email, teléfono, nombre) "por seguridad" según la doc; usar `api_version=4` para la nueva estructura JSON | `read` | ✅ (mismo recurso, sin diferencia documentada para MLC) | [Questions & Answers (.ar)](https://developers.mercadolibre.com.ar/en_us/questions) |
| Responder una pregunta | `POST /answers` | Body: `{ "question_id": <id>, "text": "<respuesta>" }`. Límite: máximo 2.000 caracteres tanto para preguntar como para responder | `write` (requiere token del vendedor) | ✅ confirmado, recurso global sin distinción por site | [Manage questions & answers (.ar)](https://developers.mercadolibre.com.ar/en_us/manage-questions-and-answers), [Gestiona preguntas y respuestas (.mx, mismo contenido)](https://developers.mercadolibre.com.mx/es_ar/gestiona-preguntas-respuestas) |
| Eliminar una pregunta | `DELETE /questions/{QUESTION_ID}` | Requiere `ACCESS_TOKEN` del usuario propietario del ítem | `write` | ✅ (documentado en .ar, sin nota de exclusión para MLC) | [Questions & Answers (.ar)](https://developers.mercadolibre.com.ar/en_us/questions) |
| Vencimiento de preguntas sin responder | — | "Las preguntas sin responder durante más de 7 meses se eliminan" (dato citado de la doc, no es un endpoint) | — | ❓ no se confirmó si el plazo de 7 meses aplica igual en MLC (no se vio nota específica de país) | [Preguntas y Respuestas (.ar)](https://developers.mercadolibre.com.ar/es_ar/preguntas-y-respuestas) |
| Mensajería post-venta — leer conversación de un pack | `GET /messages/packs/{PACK_ID}/sellers/{SELLER_ID}?tag=post_sale` | `pack_id` se obtiene del campo `pack_id` de `GET /orders/{ORDER_ID}`; si es `null`, usar el `order_id` como `pack_id`. Parámetro opcional `mark_as_read=false` para no marcar como leídos al consultar | `read` | ⚠️ aplicable conceptualmente a MLC (recurso `/messages/packs/...` es transversal a sites), pero no se encontró un ejemplo explícito con `pack_id`/`item_id` de Chile (MLC) — confirmar con datos reales | [Messaging after sale (.ar)](https://developers.mercadolibre.com.ar/en_us/messaging-after-sale) |
| Mensajería post-venta — enviar mensaje | `POST /messages/packs/{PACK_ID}/sellers/{SELLER_ID}?tag=post_sale` | Body con `text` y opcionalmente `attachments` (adjuntos hasta 25 MB, formatos JPG/PNG/PDF/TXT vía `form-data`) | `write` | ⚠️ mismo comentario que arriba (recurso transversal, no se vio ejemplo MLC explícito) | [Messaging after sale (.ar)](https://developers.mercadolibre.com.ar/en_us/messaging-after-sale), [Post-sale Messages (Global Selling, EN)](https://global-selling.mercadolibre.com/devsite/messaging-after-sale-global-selling) |
| Bloqueo de mensajería | — | Mensajería bloqueada en órdenes con status `cancelled` (todas las categorías); error `403` con código `blocked_conversation_send_message_forbidden`. También se bloquea tras 18 meses desde la fecha de compra | — | ✅ comportamiento global, no se documenta excepción para MLC | [Messaging after sale (.ar)](https://developers.mercadolibre.com.ar/en_us/messaging-after-sale), [Blocked messages (.ar)](https://developers.mercadolibre.com.ar/en_us/blocked-messages) |
| Moderación de contenido en mensajes | — | Los mensajes pasan por moderación automática: se filtran lenguaje inapropiado, links a redes sociales, links acortados, mensajes automáticos de integradores, datos personales, links de Mercado Pago/medios de pago externos, e intentos de evadir reclamos | — | ❓ no se confirmó la lista exhaustiva ni si hay diferencias regionales; se cita de forma general | [Messaging after sale (.ar)](https://developers.mercadolibre.com.ar/en_us/messaging-after-sale) |
| Recomendación de respuestas semi-automáticas | — | La doc oficial (sección de gestión de preguntas) recomienda explícitamente: cuando hay muchos artículos publicados y se reciben muchas preguntas, "se recomienda desarrollar un método para responder esas preguntas de forma semi-automática, en el que los operadores reciben respuestas sugeridas en base a palabras clave frecuentemente recibidas" | — | ✅ recomendación textual confirmada (vía resultados de búsqueda que citan la doc .ar) | [Manage questions & answers (.ar)](https://developers.mercadolibre.com.ar/en_us/manage-questions-and-answers), [Preguntas y Respuestas (.ar)](https://developers.mercadolibre.com.ar/es_ar/preguntas-y-respuestas) |

## Notas de aplicabilidad MLC

- **Preguntas (`/questions`)**: la documentación `.cl` (`developers.mercadolibre.cl/es_ar/preguntas-y-respuestas`) existe como espejo y muestra ejemplos con `item_id` de prefijo `MLC...`, lo que confirma que el recurso aplica a Chile sin cambios estructurales conocidos. El recurso de búsqueda (`/questions/search`) y de respuesta (`POST /answers`) son globales a la plataforma (no segmentados por site en la URL del endpoint; el site queda implícito en el `item_id`/`seller_id`).
- **Mensajería post-venta (`/messages/packs/...`)**: no se encontró documentación específica para `.cl` con ejemplos MLC; la doc base es `.ar` y la versión en inglés de Global Selling. Se considera aplicable porque el recurso depende de `pack_id`/`order_id`/`seller_id`, no de un dominio de site, pero se marca ⚠️ porque no se confirmó con un ejemplo real de una orden MLC.
- **Diferencias vs MLA**: no se detectaron diferencias funcionales documentadas entre MLA y MLC para `/questions`, `/answers` ni `/messages/packs`. La única diferencia observable es el prefijo de IDs (`MLA...` vs `MLC...`), que es estándar en toda la plataforma.
- **Scope/permiso**: la doc no detalla un "scope" granular tipo OAuth separado para preguntas vs mensajes (a diferencia de, por ejemplo, `shipping_options`). En la práctica, ambos recursos requieren un `access_token` válido del vendedor con permisos estándar de `read`/`write` otorgados en el flujo de autorización de la app (scopes `read` y `write` del seller). Esto debe confirmarse contra la página de "Authentication and Authorization" si se requiere precisión adicional — no se profundizó en este pase porque no era el foco.

## URLs citadas

- https://developers.mercadolibre.com.ar/en_us/questions
- https://developers.mercadolibre.com.ar/en_us/manage-questions-and-answers
- https://developers.mercadolibre.com.ar/es_ar/preguntas-y-respuestas
- https://developers.mercadolibre.cl/es_ar/preguntas-y-respuestas
- https://developers.mercadolibre.com.mx/es_ar/gestiona-preguntas-respuestas (mismo contenido que .ar, usado como respaldo de lectura)
- https://developers.mercadolibre.com.ar/en_us/messaging-after-sale
- https://developers.mercadolibre.com.ar/en_us/blocked-messages
- https://global-selling.mercadolibre.com/devsite/messaging-after-sale-global-selling
- https://global-selling.mercadolibre.com/devsite/manage-questions-answers-global-selling

## Viabilidad de la idea: bandeja semi-automática con auto-respuesta de estado de entrega

**Veredicto: técnicamente viable con lo confirmado, con un matiz importante en mensajería.**

1. **Bandeja de preguntas (pre-venta)**: totalmente viable. Se puede:
   - Listar preguntas pendientes con `GET /questions/search?seller_id={SELLER_ID}` (filtrando por `status=UNANSWERED` si ese valor se confirma, o filtrando en el lado de la app por el campo `status` de cada pregunta devuelta).
   - Mostrar cada pregunta en una UI interna del courier/seller con una respuesta sugerida (texto generado por reglas, no por la API — la API no genera sugerencias, solo lo recomienda como patrón de implementación propio).
   - Publicar la respuesta con `POST /answers` (`question_id` + `text`, máx. 2.000 caracteres).
   - Esto es exactamente el patrón que la doc oficial recomienda para alto volumen ("respuestas semi-automáticas... operadores reciben respuestas sugeridas en base a palabras clave").

2. **Auto-respuesta de "¿dónde va mi pedido?" vía preguntas (`/questions`)**: con matices. Las preguntas (`/questions`) son **pre-venta**, asociadas a un ítem (`item_id`), no a una orden/envío específico. Por su naturaleza, un comprador que ya compró normalmente no usa `/questions` para preguntar por el estado de SU envío — para eso existe la mensajería post-venta. Por lo tanto, la pregunta "¿dónde va mi pedido?" es más probable que llegue por **`/messages/packs/{pack_id}/sellers/{seller_id}`** (post-venta), no por `/questions`.

3. **Auto-respuesta de estado de entrega vía mensajería post-venta**: viable en términos de lectura/escritura (`GET`/`POST /messages/packs/{pack_id}/sellers/{seller_id}?tag=post_sale`), siempre que:
   - La app pueda mapear el `pack_id`/`order_id` de la conversación al `shipment_id` correspondiente (vía `GET /orders/{order_id}` → `shipping.id`), y desde ahí consultar el estado del shipment (`GET /shipments/{shipment_id}` con `x-format-new: true`, ya cubierto en otra sección del catálogo).
   - El mensaje de respuesta automática **no dispare la moderación de contenido** (evitar links externos, datos de contacto no solicitados, etc.) — el texto de estado de entrega en sí (p. ej. "tu pedido está en camino, fue despachado el [fecha]") debería ser seguro, pero conviene revisar la lista de moderación citada antes de definir las plantillas.
   - Se respete el bloqueo de 18 meses y el bloqueo por `cancelled` (no enviar auto-respuestas a conversaciones bloqueadas; manejar el `403 blocked_conversation_send_message_forbidden`).

4. **Punto abierto / riesgo**: no se confirmó con un ejemplo MLC real el flujo completo `orders → pack_id → messages/packs`. Antes de construir la feature, se recomienda una prueba end-to-end con una orden Flex real de Chile (en el entorno de sandbox/usuarios de prueba) para validar que el `pack_id` se resuelve correctamente y que el mensaje se entrega.

**Conclusión para roadmap**: la bandeja semi-automática de preguntas es de bajo riesgo y está alineada con la recomendación oficial. La auto-respuesta de estado de entrega es viable pero depende de la mensajería post-venta (no de `/questions`) y de encadenar 2-3 llamadas (`messages/packs` → `orders` → `shipments`); requiere una validación E2E con datos reales de MLC antes de comprometerse en el roadmap.
