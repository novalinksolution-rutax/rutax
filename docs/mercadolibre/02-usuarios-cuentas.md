# 2. Usuarios y cuentas — Verificación contra documentación oficial

Fecha de verificación: 2026-06-11 · Site: MLC

> Nota metodológica: la documentación oficial de developers.mercadolibre.com.ar y
> developers.mercadolibre.cl bloquea el acceso directo de fetch automatizado (HTTP 403),
> por lo que la verificación se hizo vía búsquedas indexadas que citan y resumen el
> contenido vigente de esas páginas. Las URLs citadas son las páginas oficiales reales
> (existen versiones espejo `.ar` y `.cl` para varias de ellas). Donde no fue posible
> confirmar un detalle exacto (p. ej. el listado completo y literal de campos del
> JSON de respuesta), se marca ❓ y se recomienda confirmar con una llamada real
> autenticada (sandbox o cuenta de prueba) antes de construir sobre ese supuesto.

## Tabla de verificación

| Capacidad | Endpoint + método | Campos/parámetros clave | Scope | Estado MLC | URL oficial |
|---|---|---|---|---|---|
| Datos del usuario/seller | `GET /users/{User_id}` y `GET /users/me` | `id`, `nickname`, `registration_date`, `first_name`, `last_name`, `country_id`, `email`, `identification`, `address` (dirección/ubicación), `phone`, `user_type`, `tags`, `seller_reputation`, `buyer_reputation`, `status` (cuenta activa/bloqueada). El recurso puede devolver **206 Partial Content** si falla la obtención de algún subdato (p. ej. la reputación), indicando respuesta incompleta | `read` (datos propios sin token; datos privados de terceros requieren token del usuario) | ✅ — el recurso `/users` es genérico y multi-país; aplica a MLC | [Consulta Usuarios (AR)](https://developers.mercadolibre.com.ar/es_ar/servicios-consulta-usuarios) · [Consulta Usuarios (CL)](https://developers.mercadolibre.cl/servicios-consulta-usuarios) |
| Reputación del vendedor | Incluida dentro de `GET /users/{User_id}` → objeto `seller_reputation` | `level_id`, `power_seller_status`, `transactions` (`completed`, `canceled`, `period`, `ratings`) | `read` | ✅ — campo estándar del recurso `/users`, no específico de un país | [Consulta Usuarios (AR)](https://developers.mercadolibre.com.ar/es_ar/servicios-consulta-usuarios) |
| Validar estado/datos del seller (onboarding) | `GET /users/{User_id}?attributes=status` | Parámetro `attributes=status`; respuesta incluye `status.list` con flags `allow`/`codes` (p. ej. `rejected_by_regulations`) que indican si el seller puede publicar/vender/cobrar | `read` (token del propio usuario o de la app autorizada) | ✅ — recurso `/users` genérico; aplica a MLC. La validación de identidad puede tardar hasta 3 días hábiles según la doc | [Validar datos de vendedores (AR)](https://developers.mercadolibre.com.ar/es_ar/validar-datos-de-vendedores) · [Validar datos de vendedores (CL)](https://developers.mercadolibre.cl/es_ar/validar-datos-de-vendedores) |
| Preferencias de envío del usuario (modos habilitados) | `GET /users/{User_id}/shipping_preferences` | Atributos clave confirmados: `optional_me1_allowed`, `optional_me2_allowed`. Doc indica que **todos los sellers tienen `custom` y `not_specified` habilitados por defecto**; configuración por defecto de un usuario con ME1+ME2 activos es `optional_me1_allowed` (ME1 opcional, ME2 obligatorio) | `read` (requiere token del seller — dato privado de configuración) | ⚠️ — el endpoint **sí existe** y se documenta junto a Mercado Envíos 2 (recurso genérico de la plataforma). No se encontró una página específica `.cl` que liste el detalle completo del JSON de respuesta; se confirma la existencia y los campos clave vía la doc de "Mercado Envíos 2" (AR/CL), pero el listado exhaustivo de campos (p. ej. si incluye explícitamente flags de "retiro en local"/`pickup`) no pudo verificarse línea por línea — ❓ recomendable probar con una llamada real | [Mercado Envíos 2 (AR)](https://developers.mercadolibre.com.ar/es_ar/mercadoenvios-modo-2) · [Mercado Envíos 2 (CL)](https://developers.mercadolibre.cl/es_cl/mercadoenvios-modo-2) |
| Preferencias de envío por categoría (complemento) | `GET /categories/{Category_id}/shipping_preferences` | Permite pre-identificar qué modos de envío aplican a una categoría (relevante para validar publicaciones, no para el seller en sí) | `read` (público para datos de categoría) | ✅ — recurso genérico de categorías, aplica a MLC | [Mercado Envíos 2 (AR)](https://developers.mercadolibre.com.ar/es_ar/mercadoenvios-modo-2) |
| Retiro en local (pickup/local pickup) como modo de envío | No se identificó un campo dedicado y documentado de forma independiente bajo `/users/{id}/shipping_preferences` en las fuentes consultadas | — | — | ❓ — no encontrado de forma explícita en esta pasada; el "retiro en el local del vendedor" en ME suele asociarse al `logistic_type` del shipment (`xd_drop_off`/`self_service`/etc.) más que a una preferencia de usuario aislada. Requiere verificación adicional dedicada (no cubierta en este alcance) | — |

## Notas de aplicabilidad MLC

1. **`/users/{id}` y `/users/me` son recursos transversales de la plataforma** (no dependen del site_id en la URL, aunque el contenido de `address`/`country_id` reflejará MLC para un seller chileno). No se detectaron diferencias funcionales entre MLA y MLC para este recurso: la doc en `.ar` y `.cl` apunta al mismo recurso `/users`.

2. **`shipping_preferences` existe y aplica a MLC** porque está documentado dentro de "Mercado Envíos 2", que tiene página espejo en `developers.mercadolibre.cl/es_cl/mercadoenvios-modo-2`. Sin embargo, los modos `me1`/`me2`/`custom`/`not_specified` y su disponibilidad real pueden variar según el site (algunos sites no tienen ME1 habilitado o tienen reglas distintas de logística). **Antes de construir la lógica de "detectar modos activos del seller", se recomienda hacer una llamada real autenticada con un seller chileno de prueba** (`GET https://api.mercadolibre.com/users/{USER_ID}/shipping_preferences` con `Authorization: Bearer $ACCESS_TOKEN`) y registrar el JSON exacto de respuesta para MLC, ya que no se pudo confirmar el esquema completo línea por línea contra la doc bloqueada por 403.

3. **Para el caso de uso del courier (Flex)**: el dato más relevante operacionalmente — el **modo y `logistic_type` del envío** (Flex = `self_service`, drop_off, cross_docking, fulfillment) — **no se obtiene de `shipping_preferences`**, sino del recurso `/shipments/{id}` (ver sección de Mercado Envíos del catálogo, ya cubierta en otra entrega). `shipping_preferences` es información de **configuración del seller** (qué modos tiene habilitados para publicar), útil para detección temprana en onboarding, pero no reemplaza la lectura de `logistic_type` por orden/envío.

4. **Validación de datos del seller en el alta**: el flujo `GET /users/{id}?attributes=status` está documentado de forma genérica y replicado en `.cl`, por lo que es aplicable a MLC sin diferencias detectadas. Es la vía recomendada para detectar sellers con cuentas bloqueadas/incompletas antes de habilitar la integración.

5. **Scope**: todas las llamadas anteriores requieren un `access_token` válido obtenido vía OAuth del seller con scope `read` (y típicamente `offline_access` para refresh token, que ya está implementado en el adaptador OAuth ML del proyecto). No se requiere scope `write` para ninguna de estas consultas.

## URLs citadas

- [Consulta Usuarios — AR](https://developers.mercadolibre.com.ar/es_ar/servicios-consulta-usuarios)
- [Consulta Usuarios — CL](https://developers.mercadolibre.cl/servicios-consulta-usuarios)
- [Producto Consulta Usuarios — CL](https://developers.mercadolibre.cl/es_ar/producto-consulta-usuarios)
- [Validar datos de vendedores — AR](https://developers.mercadolibre.com.ar/es_ar/validar-datos-de-vendedores)
- [Validar datos de vendedores — CL](https://developers.mercadolibre.cl/es_ar/validar-datos-de-vendedores)
- [Mercado Envíos 2 (Modo 2) — AR](https://developers.mercadolibre.com.ar/es_ar/mercadoenvios-modo-2)
- [Mercado Envíos 2 (Modo 2) — CL](https://developers.mercadolibre.cl/es_cl/mercadoenvios-modo-2)
- [Autenticación y Autorización — AR](https://developers.mercadolibre.com.ar/es_ar/autenticacion-y-autorizacion)
- [Autenticación y Autorización — CL](https://developers.mercadolibre.cl/es_ar/autenticacion-y-autorizacion)

## Pendiente de verificación dedicada (fuera de este alcance)

- Esquema completo (JSON literal) de `GET /users/{id}/shipping_preferences` para un seller MLC real.
- Campo o mecanismo exacto para "retiro en local" como preferencia del seller (vs. `logistic_type` del shipment).
