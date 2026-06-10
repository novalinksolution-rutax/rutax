# Guía de prueba local — MVP Despachos del Centro SpA

Recorrido completo (~15 min) que ejercita el lazo entero:  
pedidos entrantes → manifiesto → incidencia → período → factura DTE (sandbox) → liquidación → conciliación → dashboard.

---

## Prerequisitos

Instala Docker Desktop y WSL2 antes de continuar. Luego:

```bash
# 1. Instala dependencias Node
npm install

# 2. Levanta Supabase local (Postgres + Auth + Studio + Storage)
npx supabase start
# Imprime: API URL, anon key, service role key → cópialos a .env.local

# 3. Crea .env.local a partir del ejemplo
cp .env.example .env.local
# Edita .env.local y completa:
#   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key del paso anterior>
#   SUPABASE_SERVICE_ROLE_KEY=<service role key>
#   TZ=America/Santiago
#   SECRETOS_CLAVE_CIFRADO_B64=<genera con: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
#   SECRETOS_CIFRADO_KID=v1
#   # Las demás variables (ML, Inngest) pueden quedar vacías para el demo local

# 4. Aplica migraciones y carga datos de demo
npx supabase db push
npx supabase db seed

# 5. Arranca la app
npm run dev
# http://localhost:3000

# 6. (Opcional) Arranca Inngest Dev Server para ejecutar jobs
npx inngest-cli@latest dev
# http://localhost:8288
```

> **Supabase Studio** en http://localhost:54323 — útil para inspeccionar tablas durante la prueba.

---

## Credenciales de demo

| Rol | URL de entrada | Email | Contraseña |
|-----|---------------|-------|-----------|
| Dueño | http://localhost:3000/login | dueno@despachos-centro.cl | Demo2026! |
| Supervisor | http://localhost:3000/login | supervisor@despachos-centro.cl | Demo2026! |
| Coordinador | http://localhost:3000/login | coordinador@despachos-centro.cl | Demo2026! |
| Administración | http://localhost:3000/login | admin.financiero@despachos-centro.cl | Demo2026! |
| Conductor | http://localhost:3000/login | conductor.demo@despachos-centro.cl | Demo2026! |
| Seller | http://localhost:3000/portal/login | seller@falabellatech.cl | Demo2026! |

> El conductor demo corresponde a **Juan Pablo Pérez Rojas** (ligado a Conductor 1 internamente).  
> El seller demo corresponde a **FalabellaTech Ltda.** y solo ve sus propios pedidos y facturas.

---

## Datos del tenant demo

| Campo | Valor |
|-------|-------|
| Empresa | Despachos del Centro SpA |
| RUT | 76.123.456-7 |
| Sellers activos | FalabellaTech · MercadoSur · TecnoHogar |
| Conductores | 12 (conductores 1–12) |
| Pedidos cargados | 16 (12 entregados, 2 fallidos, 1 en ruta, 1 pendiente) |
| Motor ejecutado | Sí — 12 líneas de cobro + 12 de liquidación ya generadas |
| Períodos de cobro | 3 (todos abiertos — para cerrar durante la prueba) |
| Nota DTE | Adaptador en **sandbox stub** — no se emite DTE real al SII |

---

## Recorrido paso a paso

### Paso 1 — Ver pedidos entrantes (2 min)

1. Entra como **Coordinador** (`coordinador@despachos-centro.cl`).
2. Ve a **Pedidos** (`/operaciones`).
3. Observa el pedido **pendiente_asignacion** de MercadoSur (`FLEX-2026-200005`, Isabel Núñez, San Miguel).  
   Este es el pedido sin conductor asignado que llegó hoy.
4. Filtra por `en_ruta` para ver el pedido de FalabellaTech (Sofía Guzmán, Providencia) que ya está con Diego Flores.
5. Observa el detalle del pedido `fallido` de MercadoSur (`FLEX-2026-200004`) — tiene una incidencia de dirección errónea adjunta.

### Paso 2 — Asignar pedido y generar manifiesto (3 min)

1. Sigue como **Coordinador**.
2. Ve a **Manifiestos** (`/manifiestos`).
3. Crea un nuevo manifiesto para el conductor **Rodrigo Martínez** (conductor 4), fecha hoy.
4. Asigna el pedido `pendiente_asignacion` de MercadoSur al manifiesto.
5. Confirma el manifiesto → pasa a estado `confirmado`.  
   El pedido pasa a `asignado` y `driver_id_asignado` se actualiza automáticamente.
6. (Opcional) Simula marcar el manifiesto como `en_ruta` para ver el cambio de estado en el pedido.

### Paso 3 — Registrar una incidencia (1 min)

1. Abre el pedido de FalabellaTech `en_ruta` (Sofía Guzmán, Providencia).
2. Crea una nueva incidencia: tipo **reagendado**, descripción "Cliente pide reagendar para mañana 10–13 hrs".  
   El seed ya tiene esta incidencia en estado `abierta`; también puedes abrirla y ver su historial.
3. Observa que la incidencia aparece en el listado de `/operaciones?tab=incidencias` filtrada por estado `abierta`.

### Paso 4 — Cerrar un período de cobro (2 min)

1. Cierra sesión y entra como **Administración** (`admin.financiero@despachos-centro.cl`).
2. Ve a **Períodos** (`/dinero/periodos`).
3. Verás los 3 períodos de junio 2026 en estado `abierto`:
   - FalabellaTech · 3 líneas · $11.400
   - MercadoSur · 3 líneas · $9.600
   - TecnoHogar · 6 líneas · $22.000
4. Abre el período de **FalabellaTech** y ciérralo manualmente.
5. El período pasa a `cerrado`. Si el Inngest Dev Server está corriendo, el job C3 se dispara y genera el **DTE sandbox** (factura electrónica tipo 33, folio 1 del CAF demo).
6. Vuelve al listado: el período de FalabellaTech ahora muestra estado `facturado` con número de folio.

> **Sin Inngest Dev Server**: el período queda en `cerrado`. El DTE se generaría cuando el job C3 corra. Para el demo visual es suficiente ver el período cerrado y las líneas de cobro consolidadas.

### Paso 5 — Ver la factura al seller (portal seller) (2 min)

1. Cierra sesión y entra como **Seller** (`seller@falabellatech.cl`) en http://localhost:3000/portal/login.
2. Ve a **Mis cobros** (`/portal/cobros`).
3. Verás el período de junio cerrado/facturado con sus 3 entregas y el total de **$11.400 CLP**.
4. Si el job C3 corrió, hay un botón para descargar el PDF del DTE (sandbox — documento simulado).
5. Nota que el seller **no ve** los montos de tarifa pactados con el courier (solo ve su factura final).
6. Intenta acceder a `/operaciones` — recibirás "sin acceso" (RLS en acción).

### Paso 6 — Ver liquidación de conductores (2 min)

1. Cierra sesión y entra como **Dueño** (`dueno@despachos-centro.cl`).
2. Ve a **Liquidaciones** (`/dinero/liquidaciones`).
3. Verás las 5 liquidaciones en estado `borrador`:
   - Juan Pablo Pérez: 3 entregas · $7.000 CLP
   - Carlos González: 3 entregas · $7.400 CLP (incluye 1 same-day a $2.800)
   - Pedro Soto: 2 entregas · $4.000 CLP
   - Rodrigo Martínez: 2 entregas · $4.200 CLP
   - Francisco Castro: 2 entregas · $4.400 CLP
4. Emite la liquidación de **Juan Pablo Pérez** → pasa a `emitida`.
5. Si el job C7 corre, se genera el PDF de liquidación (stub en MVP — archivo vacío) y el conductor lo verá en su PWA.

### Paso 7 — Conductor en la PWA (1 min)

1. Entra como **Conductor** (`conductor.demo@despachos-centro.cl`) en http://localhost:3000/conductor.
2. Verás las 3 entregas de Juan Pablo del mes (P01, P02, P14) y el monto de su liquidación.
3. Cuando la liquidación esté emitida, aparece el botón de descarga del PDF.

### Paso 8 — Conciliación (1 min)

1. Entra como **Dueño** o **Administración**.
2. Ve a **Conciliación** (`/dinero/conciliacion`).
3. Verás el resumen del mes: 12 entregas entregadas, 12 líneas de cobro, 12 líneas de liquidación — sin diferencias.
4. Los pedidos `fallido` (P04 y P09) aparecen en el panel de **revisión manual** (sin cobro generado, con incidencia registrada).
5. El evento de conciliación muestra que los 2 fallidos fueron correctamente excluidos del cobro.

### Paso 9 — Desconexión de seller y reconexión (2 min)

> **TecnoHogar** está en estado `atencion` en el seed — su token expiró hace 2 horas.

1. Entra como **Dueño** (`dueno@despachos-centro.cl`).
2. Ve a **Sellers** (`/sellers`).
3. Verás la alerta de salud de conexión para TecnoHogar Chile SpA con estado `atencion`.
4. Haz clic en **Reconectar** → te redirige al flujo OAuth de ML (sandbox/mock).
5. Completa el flujo → la conexión vuelve a `sana`.
6. (En local sin ML real, el botón de reconexión mostrará la URL de autorización — el flujo no completa sin credenciales ML reales.)
7. El backfill automático (job B7) correría para recuperar los pedidos perdidos durante la desconexión.

### Paso 10 — Dashboard del dueño (1 min)

1. Sigue como **Dueño**, ve a **Dashboard** (`/dashboard`).
2. Verás el resumen ejecutivo:
   - Entregas del mes: 12 completadas / 16 totales
   - Ingresos proyectados: $43.000 CLP (11.400 + 9.600 + 22.000)
   - Conductores activos: 7 (los que tienen entregas o manifiestos)
   - Alertas: TecnoHogar desconectada · 1 incidencia abierta

---

## Estado de los tests

Al momento de generar esta guía, la suite Vitest reporta:

```
Test Files  26 passed (26)
Tests       495 passed (495)
```

Para correr los tests:

```bash
npm test              # todos los tests unitarios
npm run test:watch    # modo watch
npm run typecheck     # verificación de tipos TypeScript
npm run lint          # ESLint
```

Las pruebas de aislamiento RLS (pgTAP) requieren Supabase local corriendo:

```bash
npx supabase test db   # corre supabase/tests/database/
```

---

## Notas de arquitectura para el demo

| Componente | Estado en demo |
|-----------|---------------|
| DTE (facturación SII) | **Stub** — folio reservado, PDF/XML simulado. Reemplazar `simplefactura.ts` en producción |
| PDF liquidaciones | **Stub** — Buffer vacío. Implementar `@react-pdf/renderer` en producción |
| Emails (notificaciones) | **Stub** — configurar Resend en producción |
| OAuth Mercado Libre | Requiere app ML real para completar el flujo |
| Jobs Inngest | Requieren `npx inngest-cli dev` corriendo localmente |
| RLS multi-tenant | **Activa** — toda la demo vive en un solo tenant (76.123.456-7) |

---

## Comandos de referencia rápida

```bash
# Arrancar todo
npx supabase start && npm run dev &
npx inngest-cli@latest dev &

# Resetear la base de datos (borra todo y re-aplica migraciones + seed)
npx supabase db reset

# Ver logs de Supabase
npx supabase logs

# Abrir Supabase Studio
open http://localhost:54323

# Estado de los servicios locales
npx supabase status
```
