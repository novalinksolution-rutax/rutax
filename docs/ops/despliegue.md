# Runbook de despliegue a producción — Rutax

Guía paso a paso para dejar **un courier real** operando en producción, manteniendo Fintoc/DTE/Email en **sandbox** (sin costo variable) hasta que decidas encenderlos.

> **Regla de oro:** los flags de sandbox (`DTE_SANDBOX_MODE`, `EMAIL_SANDBOX_MODE`, `SUSCRIPCION_SANDBOX_MODE`, `SUSCRIPCION_RECURRENTE_SANDBOX_MODE`, `PAYOUT_SANDBOX_MODE`) se quedan en `true` para el piloto. Así corre toda la operación (pedidos, manifiestos, conductor, POD, motor entrega→dinero) con datos reales, pero **no se mueve plata ni se emiten DTE reales**.

---

## 0. Cuentas necesarias (todas con tier gratis para empezar, salvo lo indicado)
- **GitHub** — el repo ya está (`novalinksolution-rutax/rutax`).
- **Supabase** — proyecto de producción. **Pro ($25/mes)** recomendado por los backups diarios.
- **Vercel** — hosting. **Pro ($20/mes)** para uso comercial legítimo.
- **Inngest** — jobs en segundo plano. Free alcanza para 1 courier.
- (Opcional) **Sentry** — errores. Free.
- **Resend** — cuenta + dominio verificado. No es opcional aunque `EMAIL_SANDBOX_MODE` se quede en `true` durante el piloto: ese flag solo gobierna los correos propios de la app (invitación a sellers/equipo); el SMTP de Auth de Supabase (invite del dueño, recuperación de contraseña — §1.8) necesita Resend desde el día uno, porque el SMTP integrado de Supabase da 2 correos/hora y no está pensado para producción.
- **Dominio** — en producción es **`rutax.io`**, registrado en Porkbun y sirviendo la app desde el **apex** (no hay `app.rutax.io`). El buzón `Admin@rutax.io` es Zoho Mail. El enrolamiento concreto del correo —qué registros DNS hay puestos, cuáles faltan y en qué orden— vive en [`correo-rutax-io.md`](./correo-rutax-io.md); esta guía se queda en el procedimiento genérico.

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

### 1.5 Buckets de Storage — los crean las migraciones, NO a mano
Los cuatro buckets nacen solos al correr `db push` (§1.4): cada uno tiene un
`insert into storage.buckets (...) on conflict do ...` idempotente dentro de su
migración. **No los crees a mano en el dashboard** — declararlos solo en
`supabase/config.toml` los crea en local (`supabase start`) pero NO en el
proyecto hosted, que ignora ese archivo por completo; lo único que el hosted
aplica son migraciones (DDL) y ajustes del panel.

| Bucket | Público | Límite | MIME | Para qué | Migración que lo crea |
|---|---|---|---|---|---|
| `pod-evidencias` | no | 50 MiB | png, jpeg, webp | Fotos y firmas del POD same-day | `20260613000008_operacion_pod_tracking.sql` |
| `liquidaciones` | no | 10 MiB | pdf | PDF de liquidación del conductor | `20260806000001_storage_buckets_liquidaciones_documentos_dte.sql` |
| `documentos-dte` | no | 10 MiB | pdf | PDF de las facturas DTE | `20260806000001_storage_buckets_liquidaciones_documentos_dte.sql` |
| `contexto-mapas` | **sí** | 50 MiB | (sin allowlist) | Cartografía de la Torre: PMTiles, glyphs, sprites | `20260725000001_contexto_torre_de_control.sql` |

> **Verificación, no creación:** tras `db push`, entra a **Storage** en el
> dashboard y confirma que los 4 buckets aparecen con estas propiedades. Si
> falta alguno, el `db push` no llegó a esa migración — revisa su log; no lo
> crees a mano (una creación manual con propiedades distintas a las de la
> migración es una fuente de discrepancias silenciosa, aunque el `on conflict`
> no rompa nada).
>
> `contexto-mapas` es el único público, y solo de lectura: es cartografía OSM/DPA sin
> un dato de nadie, y PMTiles se sirve por rangos HTTP (una URL firmada por rango no
> funciona). Los otros tres son privados y se leen únicamente por URL firmada emitida
> desde el backend con `service_role`.
>
> **Si `liquidaciones` falta (p. ej. la migración no llegó a aplicarse), falla en
> silencio:** el job genera el PDF, el `upload` falla, el job traga el error a
> propósito para no perder la liquidación, y `pdf_ref` queda en `null`. El
> conductor no recibe su comprobante y no aparece ningún error. Esto ya ocurrió
> una vez en producción (2026-08-06) cuando estos dos buckets solo estaban
> declarados en `config.toml`; quedó cerrado con la migración de la tabla de
> arriba.

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

### 1.7 ⚠️ Checklist de post-provisionamiento — `config.toml` NO aplica al hosted

Esta es la advertencia más cara del proyecto, y ya mordió **tres veces el
2026-08-06** al levantar `rutax-prod`. `supabase/config.toml` describe el
entorno LOCAL (`supabase start`); en un proyecto hosted **no se lee en
absoluto**. Lo único que un proyecto hosted aplica automáticamente son las
migraciones (DDL, §1.4). Todo lo demás que `config.toml` declara hay que
replicarlo a mano en el dashboard — o, si es una tabla/bucket, con una
migración idempotente (como ya se hizo para los 4 buckets, §1.5).

La peor mordida: el hook `[auth.hook.custom_access_token]`. La función
`identidad.custom_access_token_hook` sí existía (la crea la migración
`20260101000001`), pero el hook estaba **sin registrar** en producción — la
página de Auth Hooks aparecía vacía. Esa función es la que inyecta `tenant_id`,
`tipo_usuario`, `seller_id`, `driver_id` y `rol` al JWT; sin ella, todas las
funciones `claim_*` que usan las políticas RLS devuelven `null`, y **RLS le
niega todo a todos los usuarios, en toda la app** — no solo en `/admin`. No
hay síntoma en el build ni en el deploy: se descubre porque cada pantalla
carga vacía o con "no autorizado".

Checklist explícito — repásalo entero en cualquier proyecto Supabase nuevo
(el de producción actual ya lo tiene resuelto; esto es para el próximo courier
que necesite un proyecto propio, o para volver a levantar `rutax-prod` desde
cero):

- [ ] **Esquemas expuestos** (Settings → API → Exposed schemas) — ver §1.2.
- [ ] **`extra_search_path`** (Settings → API → la misma pantalla, más abajo,
      o Database → search path según la versión del dashboard): igualar a
      `supabase/config.toml` → `public, operacion, identidad, dinero,
      integraciones, plataforma, extensions`. **`contexto` NO va en esta
      lista a propósito** (ver el comentario en `config.toml`): su acceso
      siempre se califica con `.schema('contexto')` y sus nombres de tabla
      genéricos (`calendario`, `senales`) podrían sombrear otra tabla si
      entraran al search_path de cada request. Producción venía con solo
      `public, extensions` — 25 de 31 funciones no fijan su propio
      `search_path`, así que sin este ajuste corren contra el path por
      defecto, no el del monolito.
- [ ] **Buckets de Storage** — ya NO requieren creación manual, ver §1.5
      (los 4 llevan migración idempotente). Solo verifica que aparezcan tras
      `db push`.
- [ ] **Hook de Auth `custom_access_token`** (Authentication → Hooks):
      registra `identidad.custom_access_token_hook` como el hook "Customize
      Access Token (JWT) Claims". **Crítico** — ver el incidente arriba.
- [ ] **`site_url` y `additional_redirect_urls`** (Authentication → URL
      Configuration): apunta al dominio real de producción (el mismo
      `APP_PUBLIC_URL` de §5), no al `http://127.0.0.1:3000` que trae
      `config.toml` por defecto.
- [ ] **Políticas de signup/confirmación de correo** (Authentication →
      Providers → Email): revisa `Confirm email` (afecta si el registro
      público por `/registro` requiere confirmar el correo antes de poder
      entrar) y `Enable email signup`. Decide el valor explícitamente — no
      asumas que coincide con lo que `config.toml` fija en local.
- [ ] **Plantillas de correo de Auth** (Authentication → Email Templates): el
      default de Supabase usa `{{ .ConfirmationURL }}`, que es el flujo
      *implícito* y entrega los tokens en el **fragmento** de la URL (`#`).
      La app usa `@supabase/ssr` y su ruta `/auth/confirm` lee `token_hash`
      del **query string** — con la plantilla default nunca se encuentran, y
      el usuario invitado aterriza en la raíz del sitio en vez de en
      `/activar-cuenta` (o pierde el flujo si ya tenía otra sesión abierta en
      ese navegador). En cada plantilla que uses, reemplaza el enlace por:
      `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<tipo>`
      (agrega `&next=/ruta-destino` cuando el destino no es el default).
      Aplica al menos a **Invite user**, **Magic link** y **Reset Password**.
- [ ] **SMTP de Auth** — ver §1.8. Sin esto, el correo de Auth (no el de la
      app, ese va por Resend vía API REST) sale por el SMTP integrado de
      Supabase, limitado a 2 correos/hora.

### 1.8 SMTP de Auth (Supabase → Resend)

Por defecto, todo el correo que envía **Supabase Auth** (invitación de
usuario, recuperación de contraseña, magic link) sale por el SMTP integrado
de Supabase: 2 correos/hora y el propio panel lo marca como "not meant for
production use". Esto es una vía **distinta** de Resend-vía-API-REST que ya
usa la app para sus propios correos transaccionales (invitación a sellers,
notificaciones de plataforma — `src/modules/integraciones/notificaciones/email/adaptadores/resend.ts`):
esa integración NO alimenta el SMTP de Auth, hay que configurarlo aparte.

Pasos:
1. En el dashboard de Supabase: **Authentication → SMTP Settings**
   (`/auth/smtp`). Activa "Enable Custom SMTP".
2. **Host**: `smtp.resend.com`
3. **Puerto**: `587` (STARTTLS — el recomendado; Resend también acepta
   `465`/`2465` con TLS implícito y `25`/`2587`, pero `587` es el valor de
   ejemplo de la propia guía de Supabase para SMTP personalizado).
4. **Usuario**: `resend` (literal, no tu email).
5. **Contraseña**: la `RESEND_API_KEY` que ya está provisionada para el
   adaptador REST (mismo valor, dos usos).
6. **Sender email**: una dirección del dominio que ya verificaste en Resend
   (el mismo dominio de `EMAIL_FROM_ADDRESS`). En producción:
   `no-responder@rutax.io`.
7. Guarda y envía un correo de prueba (p. ej. dispara un "reset password"
   desde `/login`) para confirmar que llega.
8. **Sube el rate limit.** Con SMTP propio, Supabase pasa de 2 a **30
   correos/hora** — mejor, pero sigue siendo un techo bajo: una tanda de
   invitaciones se corta a la mitad **en silencio**. Súbelo en
   Authentication → Rate Limits.

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

> **La región de las funciones ya viene fijada en `vercel.json` (`gru1`, São Paulo)** y
> no hay que tocarla en el dashboard. Es deliberado: el default de Vercel es `iad1`
> (Washington), y con la base en `sa-east-1` cada consulta cruzaría el hemisferio dos
> veces — ~150 ms por consulta en vez de ~40. Vercel no tiene región en Santiago, así
> que `gru1` es lo más cerca que se llega de Chile. El razonamiento completo, con
> costos y la alternativa chilena evaluada, está en `docs/ops/latencia-y-region.md`.
3. **Environment Variables** (Production) — ver §5 (imprescindibles) y `.env.example` (la lista completa). **Clave:** `APP_PUBLIC_URL` = tu dominio real (`https://rutax.io`).
4. Deploy. Vercel te da una URL; conecta tu dominio en **Settings → Domains**.

---

## 4. OAuth de Mercado Libre (para que los sellers conecten)
En el DevCenter de ML, la **Redirect URI** registrada debe coincidir EXACTO con `APP_PUBLIC_URL` + la ruta del callback (`/oauth/ml/callback`). Si no coincide, la conexión de cuentas ML falla.

---

## 5. Variables de entorno (Vercel · Production)

**`.env.example` (raíz del repo) es la fuente de verdad de TODAS las
variables** que lee el código — su propósito, su default y qué pasa si falta.
No la dupliques aquí: el código hoy lee ~41 variables y una tabla paralela en
este runbook se desactualiza sola en cuanto se agrega una sin acordarse de
tocar dos archivos. Esta sección documenta solo lo que es específico del
**despliegue**: qué scope de Vercel usar, qué es imprescindible para arrancar,
y qué falla en silencio si falta.

### Scope
Carga todas las variables en el scope **Production** solamente — nunca
"Production and Preview". Con Preview activado, cualquier deploy de una rama
correría contra la base de datos de producción con datos reales. Si algún día
se quieren previews reales, la solución es un segundo proyecto Supabase;
nunca compartir el de producción.

### Imprescindibles para arrancar
Sin estas, la app no sirve una sola página o el login no funciona:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SECRETOS_CLAVE_CIFRADO_B64`,
`SUPER_ADMIN_SECRET`, `APP_PUBLIC_URL`, `ML_APP_CLIENT_ID` /
`ML_APP_CLIENT_SECRET`, `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`.

### Flags de sandbox (piloto) — déjalos en `true`
`DTE_SANDBOX_MODE`, `EMAIL_SANDBOX_MODE`, `SUSCRIPCION_SANDBOX_MODE`,
`SUSCRIPCION_RECURRENTE_SANDBOX_MODE`, `PAYOUT_SANDBOX_MODE`. Los cinco
comparten la misma semántica de seguridad por defecto: ausente, vacío o
cualquier valor que no sea el literal `"false"` = sandbox. **NO** setees las
credenciales reales de Fintoc/DTE/Resend mientras los flags están en `true` —
no se usan, y dejarlas puestas es exposición innecesaria.

### Fallan en silencio si faltan (no rompen el build ni el request)
- `SENTRY_DSN` — sin ella, los errores quedan solo en el log de Vercel; ver
  nota debajo.
- `GEOCODING_PROVIDER` (default `stub`) — con `google` pero sin
  `GOOGLE_MAPS_API_KEY`, la geocodificación falla en cada intento; `stub` no
  tiene costo pero tampoco produce coordenadas reales.
- `RESEND_WEBHOOK_SECRET` — sin ella, `POST /api/webhooks/resend` rechaza
  todo con 401 (fail-closed a propósito): un correo de invitación rebotado se
  ve exactamente igual que uno entregado. Además de cargarla en Vercel, hay
  que suscribir el endpoint en el dashboard de Resend a los eventos
  `email.delivered`, `email.bounced` y `email.complained`.
- `NEXT_PUBLIC_MAPA_BASEMAP_URL` / `NEXT_PUBLIC_MAPA_GLIFOS_URL` — la Torre de
  control degrada a comunas sobre color de tierra, sin plano urbano ni
  etiquetas. Es un estado válido, pero probablemente no el que quieres.

### `TZ` — NO la setees, es imposible
`TZ` es un nombre **reservado** por el runtime de funciones de Vercel (junto a
variables de AWS Lambda como `AWS_LAMBDA_FUNCTION_NAME`). El formulario de
Environment Variables responde "Environment variable TZ is invalid" y el
botón **Deploy deja de responder sin mostrar ningún mensaje al pie** — parece
que la página se colgó, pero es el rechazo silencioso de esa variable. No
hace falta: ~40 archivos de `src/` pasan `timeZone: "America/Santiago"`
explícito en cada `Intl`/formateo de fecha (ver `src/lib/fecha-santiago.ts` y
sus usos), así que la zona horaria del proceso (las funciones de Vercel
corren en UTC) es irrelevante para la app.

### `SENTRY_DSN` — lo único que falta para tener observabilidad

El código está **completo y verificado**; falta solo pegar el valor. Sin la
variable, la app no se cae: `src/lib/observabilidad/index.ts` degrada a log
estructurado en stdout. Pero con datos reales en producción, quedarse en stdout
significa enterarse de los errores por el courier, no por la herramienta.

Pasos (5 minutos, requieren cuenta de Sentry):

1. En Sentry: **Projects → Create Project → Next.js**. Copia el DSN, con la forma
   `https://<clave>@o<org>.ingest.sentry.io/<id-proyecto>`.
2. En Vercel: **Settings → Environment Variables** → `SENTRY_DSN` = ese valor, en
   Production (y Preview si quieres separar ruido). **No** lleva prefijo
   `NEXT_PUBLIC_`: es de servidor y no debe viajar al cliente.
3. Redeploy (las variables no se aplican a un build ya hecho).
4. Comprobación: provoca un error de servidor y confirma que aparece en Sentry
   con el tag `tenant_id`.

Verificado el 2026-08-02 contra un receptor local, sin cuenta de Sentry: el
envelope sale bien formado (`/api/<id>/envelope/?sentry_key=…&sentry_version=7`,
`Content-Type: application/x-sentry-envelope`, cabecera + item + evento), con
`tenant_id` y `correlacion_id` como tags — y **los secretos salen redactados**:
`access_token` y `password` viajan como `[redactado]`, sin rastro del valor en el
cuerpo crudo.

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
1. **Correos:** contrata Resend, verifica el dominio de envío, setea `RESEND_API_KEY` + `EMAIL_FROM_ADDRESS`, y `EMAIL_SANDBOX_MODE=false`. De paso, si aún no lo hiciste (§1.7/§1.8): registra el webhook de Resend apuntando a `/api/webhooks/resend` suscrito a `email.delivered` / `email.bounced` / `email.complained`, carga su `RESEND_WEBHOOK_SECRET`, y configura el SMTP de Auth en Supabase.
2. **Cobros:** contrata Fintoc, setea sus claves + webhooks, y `SUSCRIPCION_SANDBOX_MODE=false` / `SUSCRIPCION_RECURRENTE_SANDBOX_MODE=false`.
3. **DTE real:** conecta el proveedor (Openfactura), configura certificado/folios, opt-in por courier desde `/admin`, y `DTE_SANDBOX_MODE=false`. **Irreversible ante el SII** — hazlo último y con doble revisión.

---

## Notas
- Backups: Supabase Pro trae backups diarios (retención 7 días). Para el piloto es suficiente; a futuro evaluar PITR.
- El super-admin de prod usa una cuenta real (no el `admin@rutax.cl` del demo).
- Runbook de respaldo/restauración: ver `docs/ops/restauracion.md`.
