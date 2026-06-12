# 12. Reputación y métricas del vendedor

Fecha de verificación: 2026-06-11 · Site: MLC

> Nota metodológica: las URLs oficiales de `developers.mercadolibre.com.ar` y `developers.mercadolibre.cl` devuelven HTTP 403 al fetch automatizado (bloqueo anti-bot del sitio), incluida la propia API base `api.mercadolibre.com`. La información de esta ficha se reconstruyó a partir de múltiples resultados de búsqueda que citan/extraen literalmente el contenido de esas páginas oficiales (mismo título, misma estructura JSON de ejemplo, mismos nombres de campo). Donde no hay certeza absoluta del valor exacto, se marca ❓ y se recomienda verificación manual abriendo la URL en un navegador autenticado.

## Tabla resumen

| Capacidad | Endpoint + método | Campos/umbrales clave | Scope | Estado MLC (✅/⚠️/❌/❓) | URL oficial |
|---|---|---|---|---|---|
| Reputación del seller (objeto `seller_reputation`) | `GET /users/{user_id}` (incluye `seller_reputation` embebido en la respuesta) | `level_id` (ej. `"5_green"`, escala de "termómetro"), `power_seller_status` (`silver`/`gold`/`platinum`/`null`, indica si es Mercado Líder), `transactions` (`period`, `total`, `completed`, `canceled`, `ratings.positive/neutral/negative`) | `read` (requiere token del propio usuario para datos completos; datos públicos básicos no requieren auth) | ⚠️ — endpoint y forma del objeto consistentes entre sites, pero no se pudo abrir la doc .ar/.cl directamente para confirmar 100% para MLC | https://developers.mercadolibre.com.ar/es_ar/reputacion-de-vendedores · https://developers.mercadolibre.cl/es_ar/reputacion-de-vendedores |
| Métricas de calidad dentro de `seller_reputation.metrics` | Mismo `GET /users/{user_id}` | `metrics.sales` (`period`, `completed`), `metrics.claims` (`period`, `rate`, `value`, `excluded`), `metrics.delayed_handling_time` (`period`, `rate`, `value`, `excluded`), `metrics.cancellations` (`period`, `rate`, `value`, `excluded`) | `read` | ⚠️ — estructura confirmada por múltiples fuentes secundarias que citan la doc oficial; no verificada en la página .ar/.cl directamente | https://developers.mercadolibre.com.ar/es_ar/reputacion-de-vendedores |
| Endpoint específico de "calidad de envío" / "Despacho a tiempo" / "Llega gratis hoy" / Mercado Líder, separado de `seller_reputation` | ❓ No identificado como endpoint propio y documentado | `power_seller_status` dentro de `seller_reputation` indica si el seller es Mercado Líder (medalla), pero no hay evidencia de un endpoint dedicado tipo `/users/{id}/quality_metrics` o `/performance` documentado oficialmente para sellers ML "tradicional" (existe `/performance` para listings de Global Selling, contexto distinto) | ❓ | ❓ — no encontrado / no confirmado | https://global-selling.mercadolibre.com/devsite/seller-reputation-global-selling (contexto Global Selling, no necesariamente aplicable 1:1 a MLC) |
| Programa de recuperación de reputación | `GET /users/reputation/seller_recovery/status` (referencia encontrada en búsquedas, no verificada directamente) | Estado de recuperación tras período de "Despegue" | `read` | ❓ — endpoint mencionado en resultados de búsqueda pero no confirmado abriendo la doc | https://developers.mercadolibre.com.ar/en_us/reputation-recovery |
| Umbrales que activan la evaluación de métricas (volumen mínimo de ventas) | (parte del cálculo de `seller_reputation`, no es un endpoint aparte) | Umbral de "ventana de evaluación": 60 días si el seller supera el mínimo de ventas del país; si no, se evalúa con ventana de 365 días. Mínimos reportados por país: **MLA 50**, **MLB 60**, **MLC 40**, **MCO 60**, **MLM 40** ventas en 60 días para evaluar `delayed_handling_time` y métricas relacionadas. Para `claims`: se requiere un mínimo de 3 ventas con reclamo para que empiece a afectar la reputación (umbral general, no confirmado específico por país) | n/a | ⚠️ — cifra de 40 ventas/60 días para MLC proviene de fuente secundaria que cita la doc oficial; no verificada directamente en developers.mercadolibre.cl | https://developers.mercadolibre.com.ar/es_ar/reputacion-de-vendedores |
| Umbral de `delayed_handling_time` (handling time recomendado) | (parte del cálculo) | Política general: mantener `handling_time` ≤ 3 días por orden; superarlo "podría dañar la reputación". `delayed_handling_time` = % de ventas con despacho tardío sobre el total evaluado | n/a | ⚠️ — no confirmado el valor exacto/porcentaje gatillo de baja de nivel para MLC específicamente | https://developers.mercadolibre.com.ar/es_ar/reputacion-de-vendedores |
| Frecuencia de actualización de las métricas | n/a | Cálculo "rolling": ventana de 60 o 365 días contada hacia atrás desde la fecha actual; en la práctica se recalcula con frecuencia diaria (no hay confirmación de "tiempo real" por evento) | n/a | ❓ — "diaria" es lo más consistente entre fuentes, pero no se encontró una declaración explícita de "se actualiza cada X horas" en la doc oficial | https://developers.mercadolibre.com.ar/es_ar/reputacion-de-vendedores |

## Notas de aplicabilidad MLC

- La estructura del objeto `seller_reputation` (campos `level_id`, `power_seller_status`, `transactions`, `metrics`) es la misma estructura de respuesta usada en la doc de Argentina y se replica en la URL espejo para Chile (`developers.mercadolibre.cl/es_ar/reputacion-de-vendedores`), lo que indica que el recurso aplica a MLC sin un endpoint distinto.
- La diferencia documentada y específica para MLC que sí pudimos rescatar es el **umbral de volumen de ventas para que se evalúe `delayed_handling_time` con ventana de 60 días: 40 ventas** (vs 50 en MLA, 60 en MLB/MCO). Si el seller no alcanza ese mínimo, se evalúa con ventana de 365 días.
- No encontramos un endpoint separado y documentado oficialmente como "métricas de calidad de envío" / "Despacho a tiempo" / "Llega gratis hoy" para sellers de Mercado Libre Chile (marketplace tradicional). El concepto de `power_seller_status` (Mercado Líder: silver/gold/platinum) sí vive dentro de `seller_reputation` y es el proxy más cercano disponible vía API a "exposición/beneficios por buena reputación".
- El recurso `/performance` aparece documentado en el contexto de **Global Selling** (vendedores cross-border) para calidad de publicaciones (`listings-quality-gs`), pero no se confirmó que sea el mismo recurso o que esté disponible para un seller doméstico de MLC vendiendo localmente con Flex.
- Dado el bloqueo 403 persistente al intentar leer las páginas oficiales directamente (tanto `.ar` como `.cl`, y también `api.mercadolibre.com`), se recomienda como siguiente paso que alguien con sesión de navegador (no fetch automatizado) abra y confirme manualmente:
  - https://developers.mercadolibre.cl/es_ar/reputacion-de-vendedores
  - https://developers.mercadolibre.com.ar/es_ar/reputacion-de-vendedores
  - https://developers.mercadolibre.com.ar/en_us/reputation-recovery

## URLs citadas

- https://developers.mercadolibre.com.ar/es_ar/reputacion-de-vendedores (no se pudo abrir directamente — 403; contenido reconstruido vía búsquedas que citan esta página)
- https://developers.mercadolibre.cl/es_ar/reputacion-de-vendedores (URL espejo para Chile, mismo bloqueo 403, encontrada en resultados de búsqueda)
- https://developers.mercadolibre.com.ar/en_us/sellers-reputation (versión en inglés del mismo recurso)
- https://developers.mercadolibre.com.ar/en_us/reputation-recovery (programa de recuperación de reputación / "Despegue")
- https://global-selling.mercadolibre.com/devsite/seller-reputation-global-selling (versión Global Selling, contexto distinto — verificar antes de asumir aplicabilidad a MLC doméstico)
- https://global-selling.mercadolibre.com/devsite/listings-limit-reputation (límites de publicación ligados a reputación, contexto Global Selling)
- https://global-selling.mercadolibre.com/devsite/listings-quality-gs (recurso `/performance`, contexto Global Selling)

## Viabilidad de la idea: alertas proactivas de reputación por incidencias de envío

**Veredicto: ⚠️ viable parcialmente, con datos disponibles pero validación pendiente.**

Lo que sí parece accesible vía API (sujeto a confirmación manual de la doc):
- `GET /users/{user_id}` con `seller_reputation` expone `level_id`, `power_seller_status` (Mercado Líder) y, dentro de `metrics`, las tasas (`rate`) de `claims`, `delayed_handling_time` y `cancellations` con su ventana de evaluación (`period`). Esto permitiría al SaaS:
  - Leer periódicamente (polling diario) la reputación del seller conectado.
  - Detectar si `power_seller_status` cambia (por ejemplo, pierde "platinum"/Mercado Líder) o si `level_id` baja de "verde" a un nivel inferior.
  - Monitorear las tasas (`rate`) de `delayed_handling_time` y `claims` y compararlas contra umbrales de referencia (3 días de handling time como buena práctica documentada; 40 ventas/60 días como ventana de evaluación para MLC).

Lo que NO está confirmado / es una limitación real para la idea:
- No hay evidencia de un **threshold numérico exacto y oficial** (p. ej. "si `cancellations.rate` > X% pierdes Mercado Líder") expuesto vía API o documentado públicamente con precisión. Los umbrales de "buena práctica" (3 días de handling time, 40 ventas/60 días) sirven como referencia aproximada, pero el algoritmo de "Llega gratis hoy" / cambio de `power_seller_status` parece ser interno de Mercado Libre y no está expuesto como regla calculable 1:1.
- No existe (o no se encontró) un endpoint específico de "salud de envío" separado de `seller_reputation`, lo que obliga a inferir el riesgo a partir de las tasas (`rate`) de `metrics.delayed_handling_time` y `metrics.cancellations`, no de un score directo de "Llega gratis hoy".
- La frecuencia de actualización no está confirmada como "tiempo real"; lo más razonable es asumir actualización diaria y hacer polling con esa cadencia (igual que el resto de la ingesta del SaaS, que ya combina webhooks + sondeo de respaldo según la skill `flex-ml`).

**Conclusión para el roadmap**: la funcionalidad "alertar cuando una racha de incidencias amenaza la métrica del seller" es construible como **score interno propio** del SaaS (calculado a partir de las incidencias de envío que el courier ya registra, correlacionadas con `seller_reputation.metrics` leído por polling diario), más que como un simple "leer un semáforo que ML ya calcula y expone". El SaaS puede dar valor agregado precisamente porque ML no expone una alerta proactiva ni un umbral exacto: el courier necesitaría que el SaaS infiera la tendencia (p. ej., `delayed_handling_time.rate` subiendo semana a semana) y dispare la alerta antes de que `power_seller_status` o `level_id` cambien. Antes de comprometer esto al roadmap, se requiere verificación manual (browser autenticado) de la página `reputacion-de-vendedores` para confirmar campos exactos y, si existe, cualquier umbral numérico oficial publicado.
