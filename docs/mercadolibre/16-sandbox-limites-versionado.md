# 16. Transversal: sandbox, límites y versionado

Fecha de verificación: 2026-06-11 · Site: MLC

> Verificación contra la documentación oficial de Mercado Libre (developers.mercadolibre.com.ar como referencia base, confirmando aplicabilidad en developers.mercadolibre.cl y, para algunos temas, en la doc de Global Selling). El portal `developers.mercadolibre.*` bloquea el fetch automatizado (HTTP 403), por lo que el contenido se confirmó vía búsqueda indexada de las mismas páginas oficiales. Las URLs citadas son las páginas oficiales que contienen cada afirmación.

## Tabla de capacidades

| Capacidad | Endpoint/recurso + método | Detalle clave | Estado MLC | URL oficial |
|---|---|---|---|---|
| Crear usuarios de prueba | `POST https://api.mercadolibre.com/users/test_user` (body `{"site_id":"MLC"}`, header `Authorization: Bearer $ACCESS_TOKEN`) | Devuelve `id`, `nickname`, `password`, `status`. Hay que guardar las credenciales: NO existe recurso para listar los test users creados ni recuperar su password. | ✅ | https://developers.mercadolibre.cl/es_cl/realiza-pruebas |
| Límite de usuarios de prueba | (mismo endpoint) | "Puedes crear hasta 10 usuarios de prueba con tu cuenta de Mercado Libre." Caducan tras un tiempo; al expirar puedes crear nuevos. Las operaciones de prueba se hacen entre test users; las compras requieren tarjetas de prueba. | ✅ | https://developers.mercadolibre.cl/es_cl/realiza-pruebas |
| ¿Sandbox real? | n/a | NO hay un entorno sandbox separado. Las pruebas se hacen en **producción** con usuarios de prueba (test users) y tarjetas de prueba. El "entorno de pruebas" = test users sobre la API real. | ✅ | https://developers.mercadolibre.cl/es_cl/realiza-pruebas |
| Rate limit (número público) | n/a (transversal) | ❓ NO hay un número de rate limit publicado en la doc por país (.ar/.cl). El único número oficial que aparece es en la doc de **Global Selling** para actualización de ítems: "1500 requests per minute per seller", tras lo cual la respuesta puede venir vacía. No está confirmado que ese número sea el límite global de toda la API ni que aplique idéntico a MLC. | ❓ | https://global-selling.mercadolibre.com/devsite/sync-and-modify-listings-gs |
| Código HTTP al exceder | n/a | `429 Too Many Requests` — "el usuario ha enviado demasiadas solicitudes en un período de tiempo determinado". Figura en la referencia de errores de la API. (Nota: la doc de Global Selling sugiere que en el caso de ítems la respuesta puede venir vacía en vez de 429; comportamiento a confirmar en runtime.) | ✅ | https://developers.mercadolibre.com.ve/es_ar/api-docs-es/errores |
| Referencia de errores HTTP/negocio | n/a (transversal) | Referencia de códigos de error de la API: 400 (Bad Request / validación), 401 (user not authorized), 403 (permisos/IP/scope/app), 429 (too many requests), 500. Errores específicos por recurso (p. ej. reclamos) en su propia sección. | ✅ | https://developers.mercadolibre.com.ve/es_ar/api-docs-es/errores |
| Validaciones (warning/error) | n/a | Las validaciones tienen dos valores: `warning` (no bloqueante, informativo) y `error` (bloqueante, requiere acción del vendedor). | ✅ | https://developers.mercadolibre.com.ar/es_ar/validaciones |
| Versionado de recursos (header) | `GET .../shipments/{id}` con header `x-format-new: true` | El versionado de recursos se hace por **header**, no por `/v1/` en la ruta. `x-format-new: true` devuelve el JSON nuevo del recurso shipments (p. ej. `destination.shipping_address`). Obligatorio para el formato nuevo de envíos. | ✅ | https://developers.mercadolibre.com.ar/es_ar/envios |
| Versionado por sufijo de recurso | p. ej. `orders` → tópico `orders_v2` | Algunos recursos versionan por nombre (sufijo `_v2`), no hay un `/v1/` global uniforme en las rutas. | ⚠️ | https://developers.mercadolibre.com.ar/es_ar/gestiona-ventas |
| Changelog / novedades de la API | n/a | Existe sección oficial de novedades (changelog) con fechas. Ej. de novedades recientes: bloqueo de edición de precio vía API con Automatización de precios (18-mar-2026); IDs de usuario pasan a Int64; rechazo de tokens enviados por query param (header obligatorio); nueva estructura de publicaciones desde julio (primero Argentina). | ✅ | https://developers.mercadolibre.cl/es_ar/conoce-las-novedades-que-reciben-los-vendedores |

## Notas de aplicabilidad MLC

- **Test users (✅ MLC):** la página "Realiza pruebas" existe en .cl (`/es_cl/realiza-pruebas`) con el mismo contenido que .ar, incluido el límite de **10** usuarios de prueba. Para Chile, el `site_id` del body debe ser **`MLC`** (los ejemplos de la doc suelen usar `MLA`; hay que traducirlo). Comportamiento esperado idéntico a MLA salvo el `site_id`.
- **No hay sandbox separado:** se prueba en producción contra `https://api.mercadolibre.com` usando test users. Esto aplica por igual a MLC y MLA.
- **Rate limit (❓ no documentado por país):** ni .ar ni .cl publican un número de rate limit general. El único valor numérico oficial ("1500 requests/minute per seller") está en la doc de **Global Selling** y referido específicamente a la actualización de ítems (`items`), no como límite global de toda la API. No se debe asumir ese número como el límite para todos los recursos en MLC. Para Flex (shipments, orders, webhooks) la doc no publica número. **Diseñar para el 429, no para un número fijo.**
- **429 (✅):** el código está documentado en la referencia de errores común de la API (aplica transversalmente a todos los sites, MLC incluido). La página citada es la versión .ve del mismo doc común `api-docs-es/errores`; el contenido de errores es transversal a la API y no específico de un país.
- **Versionado (✅/⚠️):** Mercado Libre no usa `/v1/` uniforme en las rutas. Versiona por **header** (`x-format-new: true` en shipments — relevante para Flex) y por **sufijo de recurso/tópico** (`orders_v2`). Esto es transversal y aplica a MLC.
- **Changelog (✅):** la sección de novedades existe tanto en .cl como en .com/.ar. Conviene suscribirse y mantener un índice interno (ver roadmap), porque cambios como "token solo por header / rechazo de query param" y "edición de precio bloqueada con Automatización" impactan integraciones existentes.

## URLs citadas

- Realiza pruebas (test users) — Chile: https://developers.mercadolibre.cl/es_cl/realiza-pruebas
- Realiza pruebas (test users) — Argentina: https://developers.mercadolibre.com.ar/es_ar/realiza-pruebas
- Rate limit 1500 req/min por seller (Global Selling, actualización de ítems): https://global-selling.mercadolibre.com/devsite/sync-and-modify-listings-gs
- Referencia de errores de la API (incluye 429): https://developers.mercadolibre.com.ve/es_ar/api-docs-es/errores
- Validaciones (warning/error): https://developers.mercadolibre.com.ar/es_ar/validaciones
- Envíos / shipments (header `x-format-new`): https://developers.mercadolibre.com.ar/es_ar/envios
- Gestiona ventas / orders (versionado `orders_v2`): https://developers.mercadolibre.com.ar/es_ar/gestiona-ventas
- Novedades / changelog — Chile: https://developers.mercadolibre.cl/es_ar/conoce-las-novedades-que-reciben-los-vendedores
- Novedades / changelog — portal global: https://developers.mercadolibre.com/es_ar/novedades
