# 01 · Aplicación, autenticación y multi-cuenta

**Fecha de verificación: 2026-06-11 · Site: MLC (Chile)**

Verificado contra la documentación oficial de Mercado Libre Developers (.cl y .ar).
Base de la API: `https://api.mercadolibre.com`. Dominio de autorización para Chile: `https://auth.mercadolibre.cl`.

> Nota de método: las páginas de developers.mercadolibre.* devuelven 403 al fetch directo; el contenido se extrajo vía búsqueda del índice oficial de Mercado Libre. Los valores citados (endpoints, parámetros, duraciones, scopes) provienen de las páginas oficiales listadas en "URLs citadas".

## Tabla de capacidades

| Capacidad | Endpoint + método | Parámetros/scopes clave | Estado MLC | URL oficial |
|---|---|---|---|---|
| Autorización (authorization code) | `GET https://auth.mercadolibre.cl/authorization` | `response_type=code`, `client_id`, `redirect_uri`. Opcionales (si la app tiene PKCE): `code_challenge`, `code_challenge_method`. El `redirect_uri` debe coincidir EXACTO con el registrado. | ✅ | https://developers.mercadolibre.cl/es_ar/autenticacion-y-autorizacion |
| Intercambio code → token | `POST https://api.mercadolibre.com/oauth/token` | `grant_type=authorization_code`, `client_id`, `client_secret`, `code`, `redirect_uri`. Opcional PKCE: `code_verifier`. Headers: `Accept: application/json`, `Content-Type: application/x-www-form-urlencoded`. Parámetros por **body**, no query. | ✅ | https://developers.mercadolibre.cl/es_ar/recomendaciones-de-autorizacion-y-token |
| Refresco de token | `POST https://api.mercadolibre.com/oauth/token` | `grant_type=refresh_token`, `client_id`, `client_secret`, `refresh_token`. Requiere que la app tenga el scope **`offline_access`**. | ✅ | https://developers.mercadolibre.cl/es_ar/autenticacion-y-autorizacion |
| Scopes | (config de la app + en el token response) | Valores permitidos: `read`, `write`, `offline_access`. | ✅ | https://developers.mercadolibre.cl/es_ar/autenticacion-y-autorizacion |
| Usuarios de prueba (sandbox) | `POST https://api.mercadolibre.com/users/test_user` | Body JSON con `site_id` (= `MLC` para Chile) + access token del header. Devuelve `id`, `nickname`, `password`, `status`. Máx. 10 por cuenta. No hay entorno sandbox separado: se prueba en producción con test users. | ✅ | https://developers.mercadolibre.cl/es_ar/realiza-pruebas |
| DPP / certificación de partner | (sin endpoint API; programa + formulario) | Niveles: Certified, Silver, Gold, Platinum. Requiere estándares de calidad, Security Assessment ≥ 65%, mínimo de GMV por país, formulario. | ✅ (existe en .cl) | https://developers.mercadolibre.cl/es_ar/developer-partner-program |
| Multi-cuenta de un mismo seller | (no es un recurso de API) | El token está atado a **un `user_id`** por autorización. La doc NO describe que una app "fusione" varias cuentas bajo un token. La forma soportada es repetir el flujo OAuth por cada cuenta ML y guardar un par token/refresh por `user_id`. | ⚠️ (patrón, no recurso) | https://developers.mercadolibre.cl/es_ar/autenticacion-y-autorizacion |

## Detalle del flujo OAuth (verificado)

- **Authorization URL (Chile):** `https://auth.mercadolibre.cl/authorization?response_type=code&client_id=$APP_ID&redirect_uri=$YOUR_URL` (+ `code_challenge`/`code_challenge_method` si PKCE).
- **Token response** (intercambio y refresco) incluye: `access_token`, `token_type` (`Bearer`), `expires_in` (segundos), `scope`, `user_id`, `refresh_token`.
- **Valores de `grant_type` permitidos:** `authorization_code` o `refresh_token`. El error `invalid_grant` aparece si el code/refresh está inválido, revocado o expirado.

### Vida útil de los tokens (verificado en doc oficial)

- **access_token:** válido **6 horas** desde su generación.
- **refresh_token:** vigencia **6 meses**; al expirar hay que rehacer la autorización completa.
- **refresh_token de un solo uso:** SÍ. Solo se puede usar **una vez** y solo por el `client_id` asociado; tras usarse queda inválido. Solo el **último** refresh_token generado es válido para el intercambio. Cada refresco devuelve un nuevo `access_token` (6 h más) y un nuevo `refresh_token`.

### PKCE

`code_challenge`/`code_challenge_method` (en authorization) y `code_verifier` (en token) son **opcionales** y solo aplican si la app tiene habilitado el flujo PKCE.

## Notas de aplicabilidad MLC

- **Dominio de autorización Chile confirmado:** `auth.mercadolibre.cl`. La doc muestra el ejemplo con `.com.ar` e indica explícitamente cambiar el dominio del país; el portal .cl es el mismo flujo. Diferencia vs MLA: solo el dominio de autorización (`.cl` vs `.com.ar`); el endpoint de token es común: `api.mercadolibre.com/oauth/token`.
- **`site_id = MLC`** es el valor de Chile para crear usuarios de prueba y para recursos por sitio. Muchos ejemplos oficiales usan `MLA` (Argentina): tradúcelos a `MLC`.
- **No existe sandbox separado.** Se prueba en producción con usuarios de prueba (`/users/test_user`, máx. 10). Hay que guardar las credenciales al crearlos: no existe recurso que las liste después.
- **DPP existe en el portal .cl.** No es un endpoint de API sino un programa de certificación (Certified/Silver/Gold/Platinum) con Security Assessment y mínimos de GMV por país. Relevante para el roadmap comercial, no para el flujo técnico de OAuth.
- **Multi-cuenta:** ⚠️ La doc trata la autorización como 1 `user_id` por token. Para un seller con varias cuentas/razones sociales ML, el patrón soportado es **un flujo OAuth por cuenta** y persistir un par (access/refresh) por `user_id`. No hay un mecanismo documentado de "una autorización para varias cuentas". El proyecto ya asume esto (OAuth por seller con cuenta principal/manager).
- **Error de colaborador:** la doc no documenta un endpoint específico para forzar "cuenta principal"; el onboarding guiado debe instruir al usuario a autorizar con la cuenta administradora, ya que el token hereda los permisos del `user_id` que autoriza. (No documentado explícitamente → tratarlo como recomendación de UX, no como garantía de API.)

## URLs citadas

- Autenticación y Autorización (Chile): https://developers.mercadolibre.cl/es_ar/autenticacion-y-autorizacion
- Recomendaciones de Autorización y Token (Chile): https://developers.mercadolibre.cl/es_ar/recomendaciones-de-autorizacion-y-token
- Realiza pruebas / usuarios de test (Chile): https://developers.mercadolibre.cl/es_ar/realiza-pruebas
- Developer Partner Program (Chile): https://developers.mercadolibre.cl/es_ar/developer-partner-program
- Autenticación y Autorización (Argentina, referencia base): https://developers.mercadolibre.com.ar/es_ar/autenticacion-y-autorizacion
- Authentication and Authorization (inglés): https://developers.mercadolibre.com.ar/en_us/authentication-and-authorization
