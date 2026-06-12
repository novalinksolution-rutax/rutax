# 05 · Mercado Envíos / Shipments — verificación oficial
> Fecha de verificación: 2026-06-11 · Site objetivo: MLC (Chile) · Base API: `https://api.mercadolibre.com`

> Nota metodológica: los portales `developers.mercadolibre.com.ar/.cl` y `global-selling`
> devuelven HTTP 403 al fetch automatizado. La verificación se hizo sobre los extractos
> indexados de esas mismas páginas oficiales (mismo contenido, mismas URLs canónicas) y
> espejos regionales (`developers.mercadolivre.com.br`) que comparten el árbol de docs.
> Donde no se pudo confirmar el literal exacto, se marca explícitamente.

## Tabla de endpoints

| Capacidad | Endpoint + método | Headers/parámetros clave | Scope | Estado MLC | URL oficial |
|---|---|---|---|---|---|
| Detalle del envío (clásico) | `GET /shipments/{id}` | `x-format-new: true` (obligatorio) | `read` | ✅ verificada | [.ar shipment-handling](https://developers.mercadolibre.com.ar/en_us/shipment-handling) |
| Detalle del envío (Global Selling / marketplace) | `GET /marketplace/shipments/{id}` | `x-format-new: true` (obligatorio) | `read` | ⚠️ difiere (contexto CBT) | [global-selling manage-shipments](https://global-selling.mercadolibre.com/devsite/manage-shipments) |
| Ítems del envío | `GET /shipments/{id}/items` | `x-format-new: true` | `read` | ✅ verificada | [.ar shipment-handling](https://developers.mercadolibre.com.ar/en_us/shipment-handling) |
| Costos del envío | `GET /shipments/{id}/costs` (param `save`) | `x-format-new: true` | `read` | ✅ verificada | [.ar shipment-handling](https://developers.mercadolibre.com.ar/en_us/shipment-handling) |
| Lead time / plazos | `GET /shipments/{id}/lead_time` | `x-format-new: true` | `read` | ✅ verificada | [.ar shipment-handling](https://developers.mercadolibre.com.ar/en_us/shipment-handling) |
| Historial de estados | `GET /shipments/{id}/history` | `x-format-new: true` | `read` | ✅ verificada | [.ar shipment-handling](https://developers.mercadolibre.com.ar/en_us/shipment-handling) |
| Etiquetas (PDF / ZPL) | `GET /shipment_labels?shipment_ids=...&response_type=pdf\|zpl2` | `shipment_ids` (máx. ~50; >50 → 400), `response_type=pdf\|zpl2` | `read` | ✅ verificada | [.ar mercadoenvios-mode-2](https://developers.mercadolibre.com.ar/en_us/mercadoenvios-mode-2) |
| Tracking (número/método) | Campos `tracking_number` / `tracking_method` en `GET /shipments/{id}`; carga en ME1/custom vía recurso de envío | `x-format-new: true` | `read`/`write` | ⚠️ ver nota (ME1/custom) | [.ar me1-order-states](https://developers.mercadolibre.com.ar/en_us/me1-order-states) |
| Suscripciones Flex (consulta) | `GET /shipping/flex/sites/{site}/users/{id}/subscriptions/v1` | `site=MLC`, `user_id` | `read` | ✅ verificada | [.ar mercado-envios-flex](https://developers.mercadolibre.com.ar/en_us/mercado-envios-flex) |
| Config. de entrega Flex | `PUT /shipping/flex/sites/{site}/users/{id}/services/{service_id}/configuration/delivery/custom/v3` | `service_id`, `cut_off` (siempre requerido) | `write` | ✅ verificada | [.ar mercado-envios-flex](https://developers.mercadolibre.com.ar/en_us/mercado-envios-flex) |
| Zonas de cobertura Flex (consulta) | `GET /flex/sites/{site}/users/{id}/services/{service_id}/configurations/coverage/zones/v1` | `service_id` | `read` | ✅ verificada | [.cl api-docs/mercado-envios-flex](https://developers.mercadolibre.cl/en_us/api-docs/mercado-envios-flex) |
| Zonas de cobertura Flex (alta/baja) | `PUT /shipping/flex/sites/{site}/users/{id}/services/{service_id}/configuration/coverage/zone/v3` | lista de `zones[].selected` | `write` | ✅ verificada | [.cl api-docs/mercado-envios-flex](https://developers.mercadolibre.cl/en_us/api-docs/mercado-envios-flex) |
| Métodos de envío por site | `GET /sites/{site}/shipping_methods` | `site=MLC` | `read` | ❓ no encontrada (literal exacto) | [.ar ship-products](https://developers.mercadolibre.com.ar/en_us/ship-products/) |
| Shipping options / costos | `GET /shipments/{id}` (campos `shipping_option`, `shipping_options`) | `x-format-new: true` | `read` | ✅ verificada | [.ar shipment-handling](https://developers.mercadolibre.com.ar/en_us/shipment-handling) |

Estado: ✅ verificada · ⚠️ difiere/condicional en Chile · ❌ no disponible en MLC · ❓ no encontrada en doc oficial.

## Notas de aplicabilidad MLC (diferencias vs MLA, límites de tasa, observaciones)

### `/shipments/{id}` vs `/marketplace/shipments/{id}`
- Ambos existen y **ambos exigen el header `x-format-new: true`** en el GET.
- `/shipments/{id}` es el recurso clásico (un solo marketplace). `/marketplace/shipments/{id}`
  es el recurso del contexto **Global Selling (CBT)**, donde un seller cross-border gestiona de
  forma unificada órdenes que corresponden a marketplaces locales (México, Brasil y **Chile**).
- **Para tu caso (couriers de sellers locales chilenos en MLC):** el recurso pertinente es
  `/shipments/{id}`. `/marketplace/shipments/{id}` solo aplica si el seller opera bajo Global
  Selling/CBT; no es el camino por defecto para un seller MLC nativo. El catálogo los lista
  como equivalentes — **no lo son**: difieren en el contexto de cuenta.
- Fuentes: [.ar shipment-handling](https://developers.mercadolibre.com.ar/en_us/shipment-handling),
  [global-selling manage-shipments](https://global-selling.mercadolibre.com/devsite/manage-shipments).

### Estados y subestados (revisión vs el catálogo)
- Estados confirmados en la doc: `pending`, `handling`, `ready_to_ship`, `shipped`, `delivered`,
  `not_delivered`, `cancelled`. Los 7 del catálogo son correctos.
- Subestados confirmados (varían según `logistic_type`):
  - `pending`: `fraud`, `reviewed`, `fraudulent`, `waiting_for_payment`, `shipment_paid`,
    `creating_route`, `manufacturing`, `buffered`, `creating_shipping_order`.
  - `handling`: `regenerating`, `waiting_for_label_generation`, `invoice_pending`,
    `waiting_for_return_confirmation`, `return_confirmed`, `manufacturing`, `agency_unavailable`.
  - `ready_to_ship`: `ready_to_print`, `printed`, `picked_up`, etc.
  - `not_delivered`: `receiver_absent`, `first_visit`, `returning_to_sender`, etc.
- El catálogo cita `ready_to_print` y `receiver_absent` como ejemplos — **ambos confirmados**.
- **Observación:** la doc advierte que el conjunto de subestados **depende del `logistic_type`**;
  para `self_service` (Flex) no todos los subestados aplican. No tratar la lista como cerrada;
  manejar `substatus` defensivamente (puede venir `null`).
- Fuentes: [.ar shipment-handling](https://developers.mercadolibre.com.ar/en_us/shipment-handling),
  [.ar me1-order-states](https://developers.mercadolibre.com.ar/en_us/me1-order-states).

### Modos y logistic_type
- Modos confirmados: `me1`, `me2`, `custom`, `not_specified` (los 4 del catálogo). `custom` y
  `not_specified` vienen habilitados por defecto para todos los sellers.
- `logistic_type` para ME2 confirmados: `drop_off`, **`xd_drop_off`**, `cross_docking`,
  `self_service`, `fulfillment`. **El catálogo OMITE `xd_drop_off`** — conviene agregarlo.
- `self_service` = **Flex**; `fulfillment` = **FBM (Full)** — mapeo del catálogo correcto.
- **Aplicabilidad MLC:** la doc confirma explícitamente que **Mercado Envíos Flex (`self_service`)
  está disponible en MLA, MLB, MLC, MCO y MLU** (no en MLM ni MPE/MEC para Flex). Chile (MLC) ✅.
- Fuente: [.ar mercadoenvios-mode-2](https://developers.mercadolibre.com.ar/en_us/mercadoenvios-mode-2),
  [.cl mercado-envios-flex](https://developers.mercadolibre.cl/es_cl/envios-flex).

### Etiquetas — PDF y ZPL2
- `GET /shipment_labels?shipment_ids={ids}&response_type=pdf|zpl2`.
- `response_type=pdf` → PDF directo. `response_type=zpl2` → **ZIP que contiene un PDF con la PLP
  y un TXT** con el código ZPL para impresora Zebra (confirmado en doc oficial).
- Límite: se recomienda consultar **hasta 50 `shipment_ids`**; superar el máximo devuelve **error 400**.
- Reimpresión: mismo GET.
- **ZPL2 NO es específico de site** — es el formato de etiqueta del recurso `shipment_labels`,
  común a todos los sites incluido MLC. La pregunta "¿ZPL2 disponible en MLC?" → **Sí**, no hay
  restricción documentada por site para el formato; lo que cambia es el carrier/PLP local.
- Fuente: [.ar mercadoenvios-mode-2](https://developers.mercadolibre.com.ar/en_us/mercadoenvios-mode-2).

### Tracking
- En **ME2 / Flex (`self_service`)**, ML genera la etiqueta y el `tracking_number` con carrier
  predefinido; el seller/courier **no gestiona** el número. Se **lee** desde `GET /shipments/{id}`
  (`tracking_number`, `tracking_method`).
- En **ME1 / `custom`**, el seller **puede cargar** un `tracking_number`, pero en `custom` ML
  **no monitorea** ese código.
- **Para Flex (tu core): el tracking es de solo lectura.** No hay endpoint para que el courier
  "reporte" tracking en self_service — el número lo emite ML. Ajustar la frase del catálogo
  ("reportar/consultar número de seguimiento"): en Flex es **consultar**, no reportar.
- Fuente: [.ar me1-order-states](https://developers.mercadolibre.com.ar/en_us/me1-order-states).

### Configuración Flex (suscripciones, ventanas, zonas)
- `GET .../subscriptions/v1` confirmado: lista las suscripciones del user; cada una tiene un
  **`service_id`** único, llave para leer/editar la configuración.
- Configuración de **entrega/ventanas**: `PUT .../services/{service_id}/configuration/delivery/custom/v3`
  (el `cut_off` es siempre requerido al cambiar cualquier ajuste).
- **Zonas de cobertura**: `GET .../configurations/coverage/zones/v1` y
  `PUT .../configuration/coverage/zone/v3` (enviar lista de zonas con `selected`).
- **Límite de tasa documentado: 1000 rpm en TODAS las llamadas a recursos Flex.** Este es el
  único rate limit numérico explícito en la doc de shipments/Flex.
- Aplicabilidad MLC: la doc de Flex (`.cl`) confirma el árbol `/shipping/flex/...` para Chile.
- Fuentes: [.ar mercado-envios-flex](https://developers.mercadolibre.com.ar/en_us/mercado-envios-flex),
  [.cl api-docs/mercado-envios-flex](https://developers.mercadolibre.cl/en_us/api-docs/mercado-envios-flex).

### `/sites/{site}/shipping_methods` — ❓ no encontrada con literal exacto
- El recurso de **métodos de envío por site** se referencia en la doc de envíos (atributo
  `site_id` = site del método), pero **no pude confirmar la ruta literal exacta**
  `/sites/{site}/shipping_methods` en una página oficial indexada. Marcado ❓ hasta verificar
  el path exacto en el portal (probablemente correcto, pero no confirmado al literal).

### Scopes / OAuth
- La API usa tres scopes: **`read`** (GET), **`write`** (POST/PUT/DELETE), **`offline_access`**
  (refresh token). No hay scopes granulares por dominio: el permiso de gestión de ventas/envíos
  da acceso a `orders`, `shipments`, `claims`, `returns` en bloque.
- Lectura de shipments/etiquetas/tracking → `read`. Configuración Flex (PUT) → `write`.
- Como ya está en CLAUDE.md: OAuth por seller (cuenta principal/manager). El `receiver_phone`
  viene **ofuscado** en `/shipments/{id}` — confirmado por la doc de privacidad de envíos.
- Fuente: [global-selling auth](https://global-selling.mercadolibre.com/devsite/authentication-and-authorization-global-selling).

## URLs citadas (lista completa)
- https://developers.mercadolibre.com.ar/en_us/shipment-handling
- https://developers.mercadolibre.com.ar/en_us/mercadoenvios-mode-2
- https://developers.mercadolibre.com.ar/en_us/me1-order-states
- https://developers.mercadolibre.com.ar/en_us/mercado-envios-flex
- https://developers.mercadolibre.com.ar/en_us/ship-products/
- https://developers.mercadolibre.cl/es_cl/envios-flex
- https://developers.mercadolibre.cl/en_us/api-docs/mercado-envios-flex
- https://global-selling.mercadolibre.com/devsite/manage-shipments
- https://global-selling.mercadolibre.com/devsite/authentication-and-authorization-global-selling
- https://developers.mercadolivre.com.br/en_us/shipment-handling
