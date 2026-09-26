# Checklist: dejar Fintoc listo en producción (flujo 1 — cobranza)

**Contexto:** el código del flujo 1 ya está desplegado y probado en sandbox
(`docs/arquitectura/cobranza-fintoc.md`). Lo que falta es contractual y de
configuración, no de código. Esta guía es la secuencia exacta para no dejar
nada a medias. Tú haces los pasos marcados **[TÚ]** (requieren tu identidad,
firma o login); yo hago los marcados **[YO]** si me pasas lo que piden.

⚠️ **Antes de tocar cualquier flag real, decide el tenant de prueba.** Ya
quedó dicho en el chat: `PAYOUT_SANDBOX_MODE=false` es una bandera de
PLATAFORMA, no por tenant — si tu base ya tiene couriers reales, apagar el
sandbox de payout los expone a todos, no solo a tu tenant de prueba. El flujo
1 (cobranza) no tiene ese mismo gate global (usa `sk_test_`/`sk_live_` por
prefijo de key), así que es más seguro de aislar, pero igual verifica el
tenant antes del paso 6.

---

## 1. [TÚ] Verificar si ya tienes cuenta en Fintoc

Entra a **https://dashboard.fintoc.com** con tu email de trabajo.
- Si te deja entrar (o "olvidé mi contraseña" te reconoce el email) → ya
  tienes cuenta, salta al paso 3.
- Si te pide crear cuenta → sigue al paso 2.

No hay forma de verificar esto desde el código o sin que tú entres: no hay
ningún rastro de una cuenta Fintoc real en este repo (ya lo confirmé).

## 2. [TÚ] Crear la organización en Fintoc

En dashboard.fintoc.com → "Crear cuenta" → datos de la empresa (RUT courier,
razón social, tu email). Esto te deja de inmediato con acceso a modo prueba
(`sk_test_...`), sin KYC.

## 3. [TÚ] Sacar las API keys de modo prueba primero

Dashboard → **Developers → API Keys**. Copia:
- `sk_test_...` (secret key)
- `pk_test_...` (public key)

Úsalas primero en un entorno de staging/preview de Vercel (nunca en local con
datos reales) para confirmar que el widget de conexión de banco funciona
antes de pedir KYC.

## 4. [TÚ] Completar KYC para pasar a modo productivo

Dashboard → sección de verificación de la organización. Vas a necesitar:
- Documentos de constitución de la empresa (RUT, escritura).
- Datos de la cuenta bancaria de destino (donde Fintoc te transferirá).
- Representante legal con firma/poder si aplica.

Fintoc revisa esto — puede tardar. **No hay forma de acelerarlo desde acá.**
Cuando lo aprueben, el dashboard te habilita `sk_live_...` / `pk_live_...`.

## 5. [TÚ] Crear el Webhook Endpoint de cobranza (por-tenant)

Dashboard → **Developers → Webhook Endpoints → Crear**.
- URL: `https://<tu-dominio-de-produccion>/api/webhooks/fintoc/<tenantId>`
  (el `<tenantId>` es el UUID de TU courier en `identidad.tenants` — te lo
  doy yo si me dices cuál es, o lo consultas en `/admin`).
- Eventos a suscribir: al menos `transfer.inbound.succeeded`. También puedes
  sumar `account.refresh_intent.succeeded` (respaldo de polling — ver el
  hallazgo abierto en el doc de arquitectura, sección 5c).
- Fintoc te muestra el **secreto del webhook** (`whsec_...`) UNA sola vez.
  Cópialo ahora — no se puede volver a ver, solo regenerar (lo que invalida
  el anterior).

⚠️ Este secreto es **por-tenant** en nuestro modelo (a diferencia de
`FINTOC_SECRET_KEY`, que es de organización). NO va como variable de entorno
de Vercel: se cifra y se guarda en `identidad.courier_config_cobranza` de tu
tenant, vía la pantalla `(tenant)/onboarding/cobranza` de la app — ese
formulario ya existe y hace el cifrado por ti.

## 6. [TÚ→YO] Pasarme las claves para cargar en Vercel

Cuando tengas `sk_test_...`/`sk_live_...` y `pk_test_...`/`pk_live_...`,
pégamelas (o mejor, pégalas directo en el comando de abajo tú mismo si
prefieres que no pasen por el chat) y yo corro:

```bash
# Producción — solo cuando decidas pasar de sandbox a real:
vercel env add FINTOC_SECRET_KEY production
vercel env add FINTOC_PUBLIC_KEY production
```

Estas SON de plataforma (una sola org para todos los tenants) — por eso sí
van en Vercel, a diferencia del secreto de webhook del paso 5.

**No toques `PAYOUT_SANDBOX_MODE` ni `SUSCRIPCION_SANDBOX_MODE` en este
paso** — son de otros flujos (payout a conductores, suscripción del SaaS) y
el pendiente de hoy es solo cobranza (flujo 1).

## 7. [YO] Verificar el endpoint desplegado con una firma real

Con el secreto del paso 5 y tu `tenantId`, corro contra tu URL de
producción (nunca contra datos de un courier ajeno):

```bash
node scripts/validacion-firma-webhook-fintoc.mjs \
  --url https://<tu-dominio> \
  --tenant <tu-tenant-uuid> \
  --secreto <el-whsec-del-paso-5> \
  --si-esto-es-produccion-lo-asumo
```

Esto crea una fila de prueba real en `dinero.pagos_recibidos` (con
`tr_PRUEBA_...` en el id, fácil de encontrar y borrar). Lo hacemos así,
firmado y contra el endpoint real, en vez de con dinero de verdad moviéndose
banco a banco — es la prueba que de verdad falta, sin arriesgar una
transferencia real todavía.

## 8. [TÚ] Recién ahí, la prueba con dinero real

Una vez que el paso 7 confirme 200 + evento emitido + fila conciliada:
conecta tu propio banco desde `(tenant)/onboarding/cobranza` con el widget
real (`pk_live_`), haz una transferencia pequeña desde otra cuenta tuya, y
verifica en `(tenant)/dinero/cobranza` que aparece y concilia.

---

## Resumen de qué bloquea qué

```
Paso 1-2 (cuenta Fintoc)  ──► Paso 3 (sk_test_)  ──► Paso 5 (webhook + secreto)
                                    │                        │
                                    ▼                        ▼
                          Paso 4 (KYC → sk_live_)   Paso 6 (env vars Vercel)
                                    │                        │
                                    └───────────┬────────────┘
                                                 ▼
                                    Paso 7 (verificación firmada)
                                                 │
                                                 ▼
                                    Paso 8 (dinero real, al final)
```

Nada del lado técnico (código, tests, ruta, firma) sigue pendiente — eso ya
se cerró. Todo lo que queda es este checklist.
