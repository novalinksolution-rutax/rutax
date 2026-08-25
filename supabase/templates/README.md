# Plantillas de correo de Supabase Auth — Rutax

Esta carpeta es la **copia canónica versionada** de las tres plantillas de correo
que dispara Supabase Auth directamente (no pasan por Resend ni por
`src/modules/integraciones/notificaciones/email/`):

| Archivo | Plantilla en el panel de Supabase | Cuándo se dispara |
|---|---|---|
| `reset-password.html` | **Reset Password** | El usuario pide "¿Olvidaste tu contraseña?" (`src/app/recuperar-contrasena/actions.ts`, vía `resetPasswordForEmail`). |
| `invite-user.html` | **Invite user** | Se da de alta un courier nuevo (`crearTenantConDueno` → `auth.admin.inviteUserByEmail`, `src/modules/identidad/onboarding.ts`), incluido el reenvío "¿no te llegó?" de `src/app/registro/actions.ts`. |
| `magic-link.html` | **Magic Link** | **El código de 6 dígitos con el que entra el conductor a la app nativa** (bloque B5b, regla 81). Lo dispara `pedirCodigo()` del repo `rutax-conductor` vía `signInWithOtp`. Ya no la dispara nada del repo web. |

## Lo más importante: Supabase NO lee estos archivos

El proyecto **hosted** (producción/staging en supabase.com) solo usa el HTML que
esté **pegado a mano** en el panel: **Authentication → Email Templates →
[nombre de la plantilla]**. Editar `reset-password.html` en este repo y hacer
`git push` **no cambia nada en producción** hasta que alguien copie el
contenido nuevo al panel.

`supabase/config.toml` tiene una sección (`[auth.email.template.invite]` con
`content_path = "./supabase/templates/invite.html"`, hoy comentada) que sí
permite apuntar a un archivo — pero **solo aplica al Supabase local**
(`npx supabase start`, el stack Docker de desarrollo). El hosted ignora
`config.toml` por completo. Si algún día se quiere que el entorno local use
estos mismos archivos automáticamente, hay que descomentar y completar esa
sección (con las tres plantillas: `invite`, `recovery`, `magic_link`) — no se
hizo en esta tarea para no tocar `config.toml` sin que sea el pedido explícito,
pero es la vía si se necesita.

**Consecuencia práctica: este archivo es la fuente de verdad y la memoria del
proyecto, pero pegar el HTML en el panel es un paso manual que hay que repetir
cada vez que se edite una plantilla.**

## Cómo pegar una plantilla en el panel

1. Entra a **Supabase Dashboard → tu proyecto → Authentication → Email Templates**.
2. Elige la plantilla (Reset Password / Invite user / Magic Link).
3. En **Subject heading**, pega el asunto sugerido (ver tabla más abajo — no
   está en el `.html`, Supabase lo pide en un campo aparte).
4. En **Message body (HTML)**, borra todo el contenido existente y pega el
   `.html` completo de esta carpeta **tal cual**, incluyendo el `<!DOCTYPE html>`
   y el comentario justo debajo del `<html ...>` (documenta la decisión de
   diseño; ningún cliente de correo lo muestra porque vive fuera de `<head>` y
   `<body>` — pero si prefieres un panel más limpio, puedes quitar ese bloque
   `<!-- ... -->` antes de pegar, el correo se ve idéntico sin él). El
   `<!DOCTYPE html>` sí debe quedar como la primera línea del documento.
5. Guarda. Envíate un correo de prueba desde el flujo real (no hay "enviar de
   prueba" nativo en el panel de Supabase) para confirmar que el botón cae
   en la pantalla correcta.
6. Repite para las otras dos plantillas.

⚠️ **«Cambia», no «Restablece».** El molde de mensajes (§9.3) usa el verbo que
describe lo que la persona va a hacer, no el nombre técnico de la operación:
«restablecer» es como se llama el flujo por dentro, y en una bandeja de entrada
se lee como jerga. Si cambias el asunto acá, cámbialo también en el panel de
Supabase — este archivo no lo aplica solo.

| Plantilla | Subject heading sugerido |
|---|---|
| Reset Password | `Cambia tu contraseña de Rutax` |
| Invite user | `Activa tu cuenta de Rutax` |
| Magic Link | `Tu código para entrar` |

## Por qué el default de Supabase rompe el flujo (no resetear "a ciegas")

La plantilla por defecto de Supabase usa `{{ .ConfirmationURL }}`, que apunta
al endpoint de verificación **propio de Supabase**
(`.../auth/v1/verify?token=...&type=...&redirect_to=...`) y, según cómo esté
configurado el flujo de Auth del proyecto, puede entregar el resultado por el
**flujo implícito**: los tokens de sesión viajan en el **fragmento** de la URL
(después del `#`), que nunca llega al servidor.

Esta app usa `@supabase/ssr` del lado del servidor: `src/app/auth/confirm/
route.ts` (el "puente" que canjea el enlace del correo por una sesión) lee
`token_hash` y `type` del **query string** (`request.url` en un Route Handler),
no del fragmento. Con `{{ .ConfirmationURL }}` de fábrica, el usuario aterriza
en la raíz del sitio (o donde Supabase redirija) sin `token_hash` en la URL que
el servidor pueda leer — **sin ningún error visible**, ni para el usuario ni en
los logs. El riesgo ya estaba anotado en dos lugares del propio código antes de
que existiera esta carpeta — el comentario de `resolverRedirectToActivacionCuenta()`
en `src/modules/identidad/onboarding.ts` ("si alguien resetea las plantillas al
default de Supabase... el alta se rompe en silencio") y el ítem "Plantillas de
correo de Auth" del checklist de `docs/ops/despliegue.md` — pero hasta ahora
ninguna plantilla real vivía versionada en el repo: dependían por completo de
que nadie tocara el panel. Esta carpeta es lo que faltaba para que un reseteo
accidental tenga una copia de la que recuperarse.

La forma correcta, usada en las tres plantillas de esta carpeta:

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<tipo>[&next=<ruta>]
```

`{{ .SiteURL }}` debe ser igual a `APP_PUBLIC_URL` — se configura en
**Authentication → URL Configuration → Site URL** en el mismo panel, no aquí.

## La URL exacta de cada plantilla, y contra qué se verificó

- **`reset-password.html`**
  ```
  {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/restablecer-contrasena
  ```
  `next=/restablecer-contrasena` es obligatorio (sin él cae al default de
  `/auth/confirm`, que es `/activar-cuenta` — la pantalla equivocada). Verificado
  contra:
  - `src/app/auth/confirm/route.ts` (lee `token_hash`, `type`, `next` del query
    string; sin ellos redirige a `/activar-cuenta?error=enlace_invalido`).
  - `src/app/restablecer-contrasena/page.tsx` (existe; es el paso 2 de este
    flujo — confirmado que acaba de entrar a `master`).
  - `src/app/recuperar-contrasena/actions.ts` (comentario propio del código:
    *"el enlace entra por `/auth/confirm?type=recovery&next=/restablecer-contrasena`
    — el mismo puente que ya usa la activación del dueño"*).
  - Copy de "1 hora" y "sirve una sola vez" tomado literal de
    `src/app/restablecer-contrasena/formulario-restablecer.tsx` (estado de
    enlace inválido) — no se inventó un plazo.

- **`invite-user.html`**
  ```
  {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/activar-cuenta
  ```
  Verificado contra `src/app/activar-cuenta/page.tsx` (existe; pantalla "Define
  tu contraseña" del dueño recién dado de alta) y contra el comentario de
  `src/app/auth/confirm/route.ts` (documenta explícitamente que
  `inviteUserByEmail` entrega el control a `/activar-cuenta`).

  **Decisión deliberada:** no se usa `{{ .RedirectTo }}` (la variable que
  Supabase llenaría con el `redirectTo` absoluto que ya manda
  `resolverRedirectToActivacionCuenta()` en `onboarding.ts`, algo como
  `https://tu-dominio.cl/activar-cuenta`) como valor de `next`. Si se hiciera,
  `/auth/confirm/route.ts` construye el destino final como `${origin}${next}` —
  con una URL absoluta en `next` el resultado sería una URL duplicada y rota
  (`https://tu-dominio.clhttps://tu-dominio.cl/activar-cuenta`). `next` debe
  ser siempre una **ruta relativa**; escribir `/activar-cuenta` a mano logra el
  mismo destino sin ese riesgo.

  Copy de "vence en 7 días" tomado literal de
  `src/app/registro/revisa-tu-correo/page.tsx`.

  El saludo usa `{{ if .Data.nombre_completo }}Hola, {{ .Data.nombre_completo }}.{{ else }}Hola,{{ end }}`:
  `nombre_completo` viaja en `user_metadata` porque `onboarding.ts` llama
  `inviteUserByEmail(email, { data: { nombre_completo }, redirectTo })`. El
  condicional evita un saludo roto en el reenvío de
  `src/app/registro/actions.ts` (`reenviarCorreoActivacion`), que no vuelve a
  pasar `data` — no se pudo verificar en vivo si Supabase conserva el
  `user_metadata` original del usuario `invited` al reenviar (es lo esperable,
  pero no hay un test de este repo que lo confirme); el condicional hace que,
  si no lo conserva, el correo diga simplemente "Hola," en vez de "Hola, ." con
  un espacio vacío.

- **`magic-link.html`** — **no lleva URL. Lleva `{{ .Token }}`, el código de
  6 dígitos**, y eso es un cambio deliberado del 24-08-2026.

  Cuando se escribió esta carpeta la plantilla no la disparaba nadie y era un
  botón «Iniciar sesión». Ahora tiene un consumidor y es uno solo: **la app del
  conductor**, que desde el bloque B5b entra sin contraseña (regla 81).

  **Por qué se le quitó el enlace, y por qué no hay que reponerlo:**
  · **No lleva a ninguna parte útil.** No hay deep link hacia la app nativa, así
    que tocarlo desde el correo del teléfono abre el **navegador**, cae en
    `/auth/confirm` sin `next`, y de ahí a `/activar-cuenta` → `/onboarding`:
    pantallas del courier, no del conductor. Un callejón que además parece que
    funcionó.
  · **El código se escribe con guantes**, que es la situación real — 16:00, en
    la bodega, con el teléfono en una mano.
  · **Y se puede dictar por teléfono** si el conductor llama a su coordinador.
    Un enlace de 200 caracteres, no.

  ⚠️ El preheader **no lleva el código**: se ve en la bandeja y en la pantalla de
  bloqueo sin abrir el correo.

  ⚠️ **Si algún día la web necesita entrar sin contraseña**, esto no le sirve tal
  cual: necesita su propio `next` explícito, y probablemente su propia plantilla.
  No agregues el botón «por si acaso» — volvería a mandar conductores a
  `/onboarding`.

## Diseño y tono

- Reconstruido a partir del diseño real ya en uso en `src/modules/identidad/
  notificaciones-invitacion.ts` y `src/modules/plataforma/notificaciones.ts`
  (los correos que sí salen por Resend): mismo tono (español de Chile, "tú",
  sin jerga técnica — nunca aparecen palabras como "token" u "OTP"), mismo
  color de botón de acción y mismo patrón de "si el botón no funciona, copia y
  pega este enlace".
- El navy de marca (`#2a3ca0`) es el token `--brand` vigente hoy en
  `src/app/globals.css` (decisión de marca 2026-07-22, "confianza
  financiera"), no el `#1e3a5f` más antiguo que quedó hardcodeado en
  `notificaciones-invitacion.ts`. Se preferió el token vigente porque es el
  que el usuario ve hoy en el resto de la app (botones, foco, sidebar); vale la
  pena homologar ese archivo más adelante si se retoca el correo de
  invitaciones de equipo.
- Sin logo como imagen: no existe ningún logo de Rutax alojado en una URL
  pública (el único activo de marca en el repo es `public/icon.svg`, un SVG
  local que no se puede referenciar por URL en un correo, y los clientes de
  correo bloquean imágenes remotas por defecto de todos modos). Se usa un
  wordmark de texto ("Rutax", blanco/bold sobre la barra navy) — es lo mismo
  que hacen hoy los correos de Resend (ningún `<img>` en ellos tampoco).
- HTML de correo, no de web: todo el layout es con `<table>`, ancho fijo
  (600px, con `max-width` para que se angoste en móvil), estilos en línea,
  sin Tailwind, sin clases externas ni `<script>`. El botón usa el patrón
  "bulletproof button" (tabla + celda con color de fondo) en vez de un `<a>`
  con `border-radius` suelto, para que Outlook de escritorio (que no interpreta
  bien el CSS de un enlace) lo siga mostrando como botón.
- No depende de `prefers-color-scheme` ni de variables CSS: los tres correos
  se ven bien en modo claro puro, que es el único que se garantiza. Se declaró
  `<meta name="color-scheme" content="light">` y
  `<meta name="supported-color-schemes" content="light">` para pedirle a los
  clientes que sí soportan dark-mode automático (Apple Mail, Outlook.com) que
  no le apliquen una inversión de color automática al HTML (que rompería el
  contraste calculado a mano).

## Los dos ajustes del panel que esta plantilla necesita (además de pegarla)

El HTML no basta: hay dos valores que viven en otra parte del panel y que, si no
se tocan, dejan el flujo del conductor roto **sin ningún error visible**.

1. **Authentication → Providers → Email → «Email OTP Expiration» = 600.**
   La pantalla del conductor dice, con esas palabras, «Son 6 números y duran 10
   minutos». El default de Supabase es una hora. `supabase/config.toml` ya lo
   fija en 600, **pero eso solo aplica al stack local**: el hosted lo ignora.
   Si acá queda en 3600, la app miente.

2. **Authentication → Providers → Email → confirmar que el proveedor de correo
   sale por SMTP propio.** Con el SMTP de fábrica de Supabase el envío está
   limitado a unos pocos correos por hora, compartidos entre TODO el proyecto —
   o sea entre invitaciones, recuperaciones y códigos de conductor. El día que
   ocho conductores entren a las 16:00 en un teléfono nuevo, los últimos no
   reciben nada y la app solo puede decir «no pudimos conectarnos».

## Si cambias una ruta de destino

Estas plantillas apuntan a rutas hardcodeadas (`/restablecer-contrasena`,
`/activar-cuenta`). Si alguna vez se renombra esa ruta en `src/app/`, hay que:
1. Actualizar el `.html` correspondiente en esta carpeta.
2. Volver a pegar el HTML actualizado en el panel de Supabase (paso manual,
   ver arriba — nada de esto se sincroniza solo).
