# Auditoría de seguridad + correcciones IVA y B2 — jun 2026

Sesión completada en `feat/frontend-premium-rutax`. Verificación final:
`typecheck` ✅ · `npm test` → 1086 pasan / 5 skip (64 archivos) ✅ · `lint` → 0 errores ✅

---

## Resumen ejecutivo

Auditoría completa de los 11 módulos del monolito, todas las migraciones y todas las rutas.
Resultado: código de alta calidad (RLS real en BD, secretos cifrados, webhooks firmados,
motor entrega→dinero con gates humanos e idempotencia). Un único hallazgo 🔴 (admin) y
8 🟡 — todos corregidos. Además se cerró el contrato semántico del IVA (A2) y se añadió
la palanca de corrección manual de líneas (B2).

---

## Hallazgos y estado

| ID | Severidad | Descripción | Estado |
|----|-----------|-------------|--------|
| ADMIN | 🔴 CRÍTICO | Secreto admin en query param `?secret=` (visible en logs, referrer, caché) | ✅ Corregido |
| ML-REFRESH | 🟡 | Over-refresh: refrescaba tokens `sana` + `atencion` cada 30 min | ✅ Corregido |
| C7-COL | 🟡 | `conciliar-tres-fuentes` filtraba `.eq('activo', true)` — columna inexistente | ✅ Corregido |
| SSRF | 🟡 | Webhooks salientes sin validación de host; SSRF posible | ✅ Corregido |
| TIMING | 🟡 | `verificarAdminSecret` usaba `!==` (no-constant-time) | ✅ Corregido |
| A2-IVA | 🟡 | Semántica IVA ambigua: tarifa podía interpretarse como neto o bruto | ✅ Corregido |
| B2-LINEAS | 🟡 | Sin palanca manual para corregir líneas generadas por defecto por el motor | ✅ Corregido |
| LINT | 🟢 | `prefer-const` preexistente en `plataforma/consultas.ts` | ✅ Corregido |

---

## Correcciones implementadas

### 🔴 Admin auth (cookie httpOnly + HMAC)

**Problema**: el layout admin autenticaba con `?secret=SUPER_ADMIN_SECRET` en la URL.
El secreto en claro viajaba en los logs del servidor, cabecera `Referer` y caché del navegador.
Además, `tabla-suscripciones.tsx` lo pasaba al cliente como `<input type="hidden">`.

**Solución** (archivos nuevos/reescritos):
- `src/app/admin/sesion-admin.ts` — token derivado por HMAC-SHA256(secret, etiqueta);
  nunca el secreto crudo. Cookie `httpOnly; Secure; SameSite=Strict; Max-Age=8h`.
- `src/app/admin/acciones-sesion.ts` — Server Actions `iniciarSesionAdmin` /
  `cerrarSesionAdmin`; secreto validado con `timingSafeEqual` antes de setear cookie.
- `src/app/admin/formulario-login-admin.tsx` — login por POST, sin query params.
- `src/app/admin/layout.tsx` — reescrito: gate por `tieneSesionAdmin()` (cookie).
- `src/app/admin/login/page.tsx` — redirect si ya autenticado.
- `src/app/admin/suscripciones/acciones.ts` — reescrito; lee secreto desde `exigirSecretoAdmin()`.
- `src/app/admin/suscripciones/page.tsx` — eliminado `searchParams.secret`.
- `src/app/admin/suscripciones/tabla-suscripciones.tsx` — eliminados todos los
  `<input type="hidden" name="admin_secret">`.

### 🟡 ML over-refresh de tokens

**Archivo**: `src/modules/integraciones/ml/jobs/refrescar-tokens.ts`

Antes: `.or("token_expira_en.lt.now() + interval '2 hours',estado_salud.in.(atencion,sana)")`
Después: `.or("token_expira_en.lt.now() + interval '2 hours',estado_salud.eq.atencion")`

Solo refresca near-expiry o conexiones con problemas de salud (`atencion`).
Las conexiones `sana` con token vigente no se refrescan innecesariamente.

### 🟡 C7 columna inexistente

**Archivo**: `src/modules/dinero/jobs/conciliar-tres-fuentes.ts`

`identidad.tenants` usa `estado` (enum `activo|suspendido|onboarding`), no `activo` booleano.
Antes: `.eq('activo', true)` → falla silenciosa, C7 nunca corría.
Después: `.neq('estado', 'suspendido')` → incluye `activo` y `onboarding` (pueden tener pedidos).

### 🟡 SSRF en webhooks salientes

**Archivos nuevos/modificados**:
- `src/modules/integraciones/api-publica/url-webhook.ts` — validador: HTTPS only,
  sin credenciales en URL, bloquea loopback / IPv4 privadas / link-local /
  metadata (169.254.169.254) / IPv6 ULA / IPv4-mapped en hex.
- `src/modules/integraciones/api-publica/url-webhook.test.ts` — 9 tests, incluye
  bypass `::ffff:7f00:1` (forma hex que el parser WHATWG normaliza desde `::ffff:127.0.0.1`).
- `src/modules/integraciones/api-publica/jobs/entregar-webhook.ts` — validación SSRF
  antes de cada fetch (defensa en profundidad: creación + entrega).
- `src/app/(tenant)/configuracion/api/acciones.ts` — validación SSRF en alta de webhook.

### 🟡 Comparación no-constante

**Archivo**: `src/modules/plataforma/acciones.ts`

`verificarAdminSecret` ahora usa `crypto.timingSafeEqual`. Longitudes igualizadas antes de comparar.

### 🟡 A2 — Tarifa = neto + IVA

**Semántica fijada**: `monto_por_entrega_clp` es el neto; el bruto se calcula una vez
con `montosDesdeNeto(neto)` → `{netoClp, ivaClp: round(neto*0.19), totalClp}`.

**Archivos**:
- `src/modules/dinero/montos.ts` — helper puro `montosDesdeNeto` + constante `TASA_IVA`.
- `src/modules/dinero/montos.test.ts` — 5 tests (0 neto, >1 CLP, redondeo, tabla periódica).
- `src/modules/dinero/jobs/cerrar-periodo.ts` (C2) — suma neto de líneas, calcula bruto.
  Evento `dinero/periodo.cerrado` lleva `montoTotalClp` en bruto (lo que coincide con DTE).
- `src/modules/dinero/acciones.ts` — `cerrarPeriodoManualmente` usa el mismo helper.
- `src/modules/dinero/jobs/emitir-dte-periodo.ts` (C3) — step `sumar-neto-periodo` suma
  neto directo de `lineas_cobro`; pasa neto al adaptador DTE. Sin back-computation.
- `src/app/(tenant)/onboarding/tarifas/panel-tarifas.tsx` — labels "neto, sin IVA".

**Garantía**: período.monto_total_clp = DTE.monto_total_clp (mismo `montosDesdeNeto`, sin deriva).

### 🟡 B2 — Corrección manual de líneas

**Palanca**: anular línea de cobro o de liquidación de un pedido cuando el motor las
generó conservadoramente (ej. un fallido que no era responsabilidad del seller/conductor),
sin depender del `tipo` de la incidencia.

**Archivos**:
- `src/modules/dinero/acciones.ts` — `anularLineaCobroPedido` / `anularLineaLiquidacionPedido`:
  RBAC financiero, bitácora-antes-del-efecto, guarda período `abierto` / liquidación `borrador`.
- `src/modules/dinero/acciones-anular-lineas.test.ts` — 14 tests (RBAC, estado, camino feliz).
- `src/app/(tenant)/operaciones/[pedidoId]/acciones-dinero.ts` — Server Actions.
- `src/app/(tenant)/operaciones/[pedidoId]/acciones-corregir-dinero.tsx` — Dialog UI.
- `src/app/(tenant)/operaciones/[pedidoId]/page.tsx` — muestra `AccionesCorregirDinero`
  con condición (período abierto / liquidación borrador + RBAC).

---

## Cobertura de internals — resultado final

Todos los módulos leídos directamente (sin ❓):

| Módulo | Archivos cubiertos |
|--------|-------------------|
| `identidad` | capacidades, auditoria, onboarding, invitaciones, usuario-actual |
| `operacion` | pedidos, maquina-estados, incidencias, manifiestos, metricas |
| `dinero` | motor, acciones, folios, matching-pago, aplicar-pago, periodos, montos; todos los jobs (C1–C7 + NC + payout + alertas) |
| `integraciones/ml` | puerto, cliente-http; todos los jobs (backfill, sondeo-salud, refrescar-tokens, polling-estados, procesar-shipment) |
| `integraciones/dte` | adaptador simplefactura, puerto |
| `integraciones/pagos/fintoc` | adaptador, validación HMAC |
| `integraciones/api-publica` | entregar-webhook, url-webhook (nuevo) |
| `plataforma` | acciones, consultas |
| `api/*` | webhooks ML/Fintoc, api-v1, exportar-datos, oauth/ml |
| `admin` | layout, sesion-admin (nuevo), acciones-sesion (nuevo) |

---

## Pendientes / sugeridos

### Funcionales (sin bloqueante)
- **A2 follow-up**: mostrar desglose neto+IVA en portal del seller. Confirmar tasa 19%
  con contador antes de producción.
- **B1 (evolución)**: reclasificar `tipo` de incidencia + re-correr C1 automáticamente,
  si se quiere que el dinero siga a la clasificación operativa (vs. corrección manual B2).
- **PDF de liquidación** (C4): stub `generarPdfLiquidacionStub` retorna Buffer vacío.
  Implementar con `@react-pdf/renderer` cuando se instale el paquete.

### Seguridad (no bloqueante para MVP)
- **Admin evolution**: migrar a sesión Supabase `super_admin` por usuario (requiere
  provisioning manual). Documentado en `src/app/admin/sesion-admin.ts`.
- **SSRF DNS-rebinding**: host público que resuelve a IP privada no está cubierto;
  requeriría resolver-y-fijar IP antes de cada fetch. Riesgo bajo en contexto B2B.

### Calidad
- **137 warnings de lint**: todos en `*.test.ts` (variables sin usar), preexistentes.
  Limpiarlos si se quiere lint 100% limpio.
- **D4 semántica mínimos**: `minimo_facturacion_clp` en tarifas se compara contra
  `monto_total_clp` (bruto) del período. Si los mínimos se ingresaron como neto,
  la comparación está desviada ~19%. Confirmar semántica antes de usar en producción.

### DevOps (fuera del MVP)
- Observabilidad / Sentry (ver checklist)
- Disponibilidad y respaldos

---

## Contratos que no deben romperse (recordatorio)

1. Ningún proceso automático emite DTE. Solo `emitirFacturaPeriodo` (gate humano).
2. `dinero/periodo.cerrado` → solo C6 (conciliación, detective). La emisión la dispara
   `dinero/periodo.emision-solicitada`.
3. `montosDesdeNeto(neto)` es la única fuente de IVA. No calcular IVA en otro lado.
4. Bitácora ANTES de efectos externos y siempre con `actorUsuarioId`.
5. Secretos (tokens ML, cert DTE) solo en `secretos_cifrados`, cifrados con AES-256-GCM.
6. Comparar secretos siempre con `timingSafeEqual`.
7. SUPER_ADMIN_SECRET nunca en URL, logs ni cliente.
