# Runbook de despliegue a producción — Rutax

Guía paso a paso para dejar **un courier real** operando en producción, manteniendo Fintoc/DTE/Email en **sandbox** (sin costo variable) hasta que decidas encenderlos.

> **Regla de oro:** los flags de sandbox (`DTE_SANDBOX_MODE`, `EMAIL_SANDBOX_MODE`, `SUSCRIPCION_SANDBOX_MODE`, `SUSCRIPCION_RECURRENTE_SANDBOX_MODE`) se quedan en `true` para el piloto. Así corre toda la operación (pedidos, manifiestos, conductor, POD, motor entrega→dinero) con datos reales, pero **no se mueve plata ni se emiten DTE reales**.

---

## 0. Cuentas necesarias (todas con tier gratis para empezar, salvo lo indicado)
- **GitHub** — el repo ya está (`novalinksolution-rutax/rutax`).
- **Supabase** — proyecto de producción. **Pro ($25/mes)** recomendado por los backups diarios.
- **Vercel** — hosting. **Pro ($20/mes)** para uso comercial legítimo.
- **Inngest** — jobs en segundo plano. Free alcanza para 1 courier.
- (Opcional) **Sentry** — errores. Free.
- (Opcional, al encender correos) **Resend**.
- **Dominio** — p. ej. `app.rutax.cl` (~$12/año).

---

## 1. Supabase (producción)

### 1.1 Crear el proyecto
1. Crea un proyecto nuevo en supabase.com (región más cercana a Chile — p. ej. `sa-east-1` São Paulo).
2. Guarda de **Settings → API**: `Project URL`, `anon key`, `service_role key`.
3. Guarda de **Settings → Database**: la connection string / password.

### 1.2 ⚠️ Exponer los esquemas (crítico — si no, la app falla con PGRST106)
En **Settings → API → Exposed schemas**, agrega TODOS los esquemas del proyecto además de `public`:
```
public, graphql_public, operacion, identidad, dinero, integraciones, plataforma, contexto
```
> Esto es lo que en local vive en `supabase/config.toml` (`[api] schemas`). En el hosted se configura en el dashboard. **Sin esto, el backstage `/admin` y todo lo de `plataforma` fallan** (fue el bug del entorno local: "Invalid schema: plataforma"), y **los cinco jobs de la Torre de control fallan enteros** con "Invalid schema: contexto" — clima, aire, calendario, salud de fuentes y recálculo de riesgo.
>
> Exponer un esquema NO concede acceso: `plataforma` y `contexto` tienen RLS
> `enable`+`force` sin políticas y los grants revocados a `anon`/`authenticated`,
> así que solo `service_role` —que bypasea RLS— alcanza su contenido. Lo que el
> header `Accept-Profile` necesita es que el esquema esté en la lista; el
> aislamiento lo siguen imponiendo los grants y las políticas.

### 1.3 Habilitar MFA (TOTP)
En **Authentication → Providers / MFA**, habilita **TOTP** (enroll + verify). El login del backstage `/admin` lo exige. (En Supabase hosted, MFA puede requerir plan Pro.)

### 1.4 Aplicar las migraciones
Desde tu máquina, con el CLI de Supabase:
```bash
npx supabase link --project-ref <REF_DEL_PROYECTO>   # te pedirá el access token
npx supabase db push                                  # aplica supabase/migrations/* (idempotentes)
```
> **NO** corras `db reset` ni `db seed` en prod: `seed.sql` son datos DEMO. En prod solo van las migraciones.

### 1.5 Provisionar el bucket de Storage
El bucket `pod-evidencias` (evidencias de entrega) debe existir. En **Storage**, créalo con las mismas propiedades que `supabase/config.toml` (`[storage.buckets.pod-evidencias]`: privado, límite de tamaño de archivo). O aplica la config vía CLI si tu versión lo soporta.

### 1.6 Crear el super-admin real (el seed demo NO corre en prod)
1. En **Authentication → Users → Add user**: crea el usuario del fundador con su email real y una contraseña fuerte; marca el email como **confirmado**. Copia su **UUID**.
2. En **SQL Editor**, corre esto reemplazando `<UUID>`, `<EMAIL>`, `<NOMBRE>` (idempotente):
```sql
-- Perfil (para que el hook del JWT inyecte el claim super_admin)
insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, rol, estado)
values ('<UUID>', null, '<NOMBRE>', 'super_admin', 'super_admin', 'activo')
on conflict (id) do update set tipo_usuario='super_admin', rol='super_admin', estado='activo', tenant_id=null;

-- Registro de gobernanza del backstage
insert into plataforma.super_admins (usuario_id, email, nombre, rol_admin, activo)
values ('<UUID>', '<EMAIL>', '<NOMBRE>', 'admin_total', true)
on conflict (usuario_id) do update set activo=true, rol_admin='admin_total';
```
3. La primera vez que entres a `/admin` te pedirá enrolar el 2FA (TOTP).

---

## 2. Inngest (jobs en segundo plano)
1. Crea una app en app.inngest.com y obtén **Event Key** y **Signing Key**.
2. En Vercel (paso 3) setea `INNGEST_EVENT_KEY` e `INNGEST_SIGNING_KEY`.
3. Tras el primer deploy, en Inngest conecta el endpoint: `https://<tu-dominio>/api/inngest` (Inngest lo descubre y registra las ~16 funciones/crons automáticamente).
4. Verifica que aparezcan los crons (generar-períodos mensual, cobros, morosidad, trials, salud, etc.).

---

## 3. Vercel (hosting)
1. **Add New Project** → importa el repo de GitHub → rama `master` (o la que mergees).
2. Framework: Next.js (autodetectado). Build: `npm run build` (por defecto).
3. **Environment Variables** (Production) — ver la tabla de la sección 5. **Clave:** `APP_PUBLIC_URL` = tu dominio real (`https://app.rutax.cl`).
4. Deploy. Vercel te da una URL; conecta tu dominio en **Settings → Domains**.

---

## 4. OAuth de Mercado Libre (para que los sellers conecten)
En el DevCenter de ML, la **Redirect URI** registrada debe coincidir EXACTO con `APP_PUBLIC_URL` + la ruta del callback (`/oauth/ml/callback`). Si no coincide, la conexión de cuentas ML falla.

---

## 5. Variables de entorno (Vercel · Production)

| Variable | Qué poner en el piloto |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase prod |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key de Supabase prod |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key (⚠️ secreto, nunca al cliente) |
| `APP_PUBLIC_URL` | `https://app.rutax.cl` (tu dominio real) |
| `SECRETOS_CLAVE_CIFRADO_B64` | genera: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `SUPER_ADMIN_SECRET` | genera otro valor con el mismo comando (firma cookie de soporte + defensa) |
| `ML_APP_CLIENT_ID` / `ML_APP_CLIENT_SECRET` | credenciales de tu app de ML |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | de Inngest |
| `TZ` | `America/Santiago` |
| `DTE_SANDBOX_MODE` | `true` (piloto) |
| `EMAIL_SANDBOX_MODE` | `true` (piloto) |
| `SUSCRIPCION_SANDBOX_MODE` | `true` (piloto) |
| `SUSCRIPCION_RECURRENTE_SANDBOX_MODE` | `true` (piloto) |
| `SENTRY_DSN` | (opcional) DSN de Sentry, o vacío |
| `GEOCODING_PROVIDER` | `stub` (piloto, $0) |

> **NO** setees las credenciales reales de Fintoc/DTE/Resend en el piloto — mientras los flags están en `true`, no se usan.

---

## 6. Verificación post-deploy (smoke test)
1. Abre `https://<tu-dominio>/admin` → login del fundador + enrolar 2FA → entra al backstage.
2. Recorre **Suscripciones, Planes, Couriers, Métricas, Bitácora** (confirma que cargan → los esquemas están bien expuestos).
3. Onboarda el courier real: crea su tenant, sus tarifas, invita a su dueño/equipo.
4. Conecta una cuenta de ML de un seller (valida el OAuth + `APP_PUBLIC_URL`).
5. Ingesta un pedido, ármalo en manifiesto, entrégalo desde la app del conductor → confirma que el motor entrega→dinero genera las líneas (en sandbox, sin cobrar/facturar de verdad).
6. En Inngest, confirma que los crons quedaron registrados.

---

## 7. Cuando decidas encender lo "real" (después del piloto)
Un flag a la vez, con revisión de `seguridad-cumplimiento`:
1. **Correos:** contrata Resend, verifica el dominio de envío, setea `RESEND_API_KEY` + `EMAIL_FROM_ADDRESS`, y `EMAIL_SANDBOX_MODE=false`.
2. **Cobros:** contrata Fintoc, setea sus claves + webhooks, y `SUSCRIPCION_SANDBOX_MODE=false` / `SUSCRIPCION_RECURRENTE_SANDBOX_MODE=false`.
3. **DTE real:** conecta el proveedor (Openfactura), configura certificado/folios, opt-in por courier desde `/admin`, y `DTE_SANDBOX_MODE=false`. **Irreversible ante el SII** — hazlo último y con doble revisión.

---

## Notas
- Backups: Supabase Pro trae backups diarios (retención 7 días). Para el piloto es suficiente; a futuro evaluar PITR.
- El super-admin de prod usa una cuenta real (no el `admin@rutax.cl` del demo).
- Runbook de respaldo/restauración: ver `docs/ops/restauracion.md`.
