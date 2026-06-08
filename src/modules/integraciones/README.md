# integraciones

Adaptadores aislados (un "puerto" por servicio: Mercado Libre, DTE, pagos). El núcleo no llama APIs externas directo — regla de límite §11.2 del documento de arquitectura (`docs/arquitectura/fase-a-cimiento.md`).

## Estructura

- `secretos/` — mecanismo central de cifrado/descifrado de secretos (certificados, credenciales DTE, tokens OAuth ML). Persiste en `identidad.secretos_cifrados` vía `service_role` y devuelve solo `referencia_externa_id` (el `*_ref` opaco). Ver `secretos/cifrado.ts` para la decisión de mecanismo de clave (documentada in-line).
- `ml/` — puerto OAuth de Mercado Libre. Único punto de contacto con `https://api.mercadolibre.com`. Aplica skill `flex-ml`.
- `dte/` — (pendiente del adaptador completo, otra iteración). `NOTAS-FOLIOS.md` documenta el hallazgo sobre gestión de folios CAF del proveedor candidato (SimpleFactura/SimpleAPI).
- `resiliencia.ts` — backoff exponencial con jitter + caché de idempotencia en memoria, compartidos por todos los adaptadores (la skill `flex-ml` exige esto para ML; el adaptador DTE lo necesitará igual).

## Reglas de este módulo (no negociables)

1. **Nadie fuera de `integraciones` llama a la API de ML, del proveedor DTE o
   de pagos, ni descifra un secreto por su cuenta.** Siempre a través del
   adaptador/puerto correspondiente (`ml/index.ts`, futuro `dte/index.ts`,
   futuro `pagos/index.ts`).
2. **El valor descifrado de un secreto JAMÁS se loguea, ni se incluye en
   `bitacora_auditoria.detalle`, ni en una URL, ni en `metadata` de
   `secretos_cifrados`.** `cifrado.ts` valida esto en aplicación además del
   CHECK de BD (defensa en profundidad).
3. **Solo `service_role`** accede a `secretos_cifrados` y escribe
   tokens/salud en `conexiones_seller_ml` — nunca con sesión de usuario. Usa
   `crearClienteServiceRole()` de `@/lib/supabase/service-role`.
4. **Resiliencia obligatoria**: cualquier llamada a un proveedor externo pasa
   por `reintentarConBackoff` (o equivalente) y respeta las señales de límite
   de tasa que el proveedor manda (`Retry-After`, 429). No se hardcodean
   números de cuota — son volátiles (la skill `flex-ml` lo advierte
   explícitamente).
5. **Verifica siempre lo volátil** (endpoints, TTL de tokens, límites de
   tasa, costos) contra la documentación oficial vigente antes de
   implementar o modificar un adaptador — no confíes en supuestos
   hardcodeados ni en este comentario indefinidamente.

## Variables de entorno que este módulo consume

Ver `.env.example` para la lista completa y comentada. Resumen:

- `SUPABASE_SERVICE_ROLE_KEY` — ya existía; lo usa `crearClienteServiceRole`.
- `SECRETOS_CLAVE_CIFRADO_B64` (+ `SECRETOS_CLAVE_CIFRADO_B64_<kid>` para
  rotación) — clave maestra AES-256 (32 bytes, base64) del mecanismo de
  cifrado. Gestionada por `devops` vía el secret manager del despliegue —
  NUNCA en el repo.
- `ML_APP_CLIENT_ID` / `ML_APP_CLIENT_SECRET` — credenciales de la app de
  Mercado Libre (de plataforma, no por-tenant).

## Lo que NO vive aquí (todavía)

- El job de refresco de tokens (RF-012) y el sondeo de salud (RF-013) son de
  **Fase B** — `ml/puerto.ts` deja lista la función `refrescarToken` que ese
  job invocará, pero el cron/orquestación es responsabilidad de esa fase.
- El adaptador DTE completo (emisión de facturas, notas de crédito) es
  trabajo de otra iteración — `dte/NOTAS-FOLIOS.md` solo documenta la
  investigación previa sobre gestión de folios.
- El adaptador de pagos (Fintoc/Khipu/Flow) — aún no llega su fase.
