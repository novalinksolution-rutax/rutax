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
  - Copy de "10 minutos" y "sirve una sola vez" tomado literal de
    `src/app/restablecer-contrasena/formulario-restablecer.tsx` (estado de
    enlace inválido) — no se inventó un plazo. **Los diez minutos son el
    mismo `otp_expiry` que usa el código del conductor**: es un solo valor
    para todo el proyecto, así que el correo de recuperación y la app tienen
    que prometer lo mismo o uno de los dos miente.

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

**Las tres plantillas siguen el molde del bloque de correos, y el molde es
código.** Vive en `src/lib/email/plantilla-email.ts` y es lo que usan los
veinte y tantos correos que salen por Resend.

Su anatomía son **tres bandas, no una caja con márgenes** — la misma ficha por
secciones que la tarjeta de seguimiento público de B7:

```
┌──────────────────────────────────┐
│ Rutax                    18/700  │  1 · marca
├══════════════════════════════════┤  ← regla de 2 px, negro de marca
│ Un titular que dice el hecho     │  2 · cuerpo — titular 19/600
│ Un párrafo de contexto…          │      contexto 14 · gris de impresión
│ ┌──────────────────────────────┐ │
│ │ TU PEDIDO                    │ │      caja de datos: rótulo en
│ │ Código · RX-7K2M-9PQR        │ │      versalitas mono + líneas en mono
│ └──────────────────────────────┘ │
│ [ Una sola acción ]              │      botón de teal de relleno
│ Si el botón no funciona…         │      enlace de respaldo, en mono
├──────────────────────────────────┤
│ Recibes esto porque…             │  3 · pie, 11 px, fondo tenue
└──────────────────────────────────┘
```

⚠️ **La marca va en su propia banda y a tamaño de titular** (18 px, 700, en
negro de marca). Es la regla 2 de B7: el nombre en texto es la versión
canónica —no hay logo que poner— y por eso ocupa el lugar que ocuparía un
logo, no el de una etiqueta administrativa. Una versión anterior la ponía como
un rótulo de 13 px en versalitas grises dentro de la celda del cuerpo.

⚠️ **Acá el molde va transcrito a mano, porque Supabase no ejecuta nuestro
código**: el panel solo acepta HTML pegado. Si el molde cambia, estas tres
transcripciones NO se enteran. Es el precio de que estos correos los mande
Supabase y no nosotros — y es la razón de que solo sean tres.

Lo que fija el molde, y por qué:

- **El cuerpo usa el gris de IMPRESIÓN (`#3E4D53`, 7,4:1), no el de pantalla.**
  `rx-tokens.css` lo define solo dentro de `@media print` y lo llama «único
  gris de texto impreso». Un correo se parece más a un impreso que a una
  pantalla: no controlamos el brillo, ni el cliente, ni si se lee en la calle a
  mediodía. El gris de pantalla (6,2:1) queda para el pie.
- **Blanco puro y negro de marca, jamás casi-blanco ni casi-negro.** Los
  clientes de correo invierten los colores por su cuenta en modo oscuro y **no
  se puede impedir**. Un `#F1F6F6` invertido queda gris sucio y un `#0B1114`
  invertido queda gris claro: los dos ilegibles. `#FFFFFF` y `#0B1114`
  sobreviven la inversión porque son los extremos. Los `<meta name="color-
  scheme" content="light">` siguen puestos para pedirle a los clientes que
  respetan la señal (Apple Mail, Outlook.com) que no inviertan — pero se pide,
  no se exige, y por eso la paleta aguanta que no hagan caso.
- **Dos teales, y no son intercambiables.** El botón se RELLENA con
  `--rx-accent` (`#00B89A`) y su texto es `--rx-fg-on-accent` (`#04231E`), 6,6:1.
  El `#007D69` de `--rx-accent-text` es solo para texto: es el color del enlace
  de respaldo. Cruzarlos deja un botón más apagado que el del producto.
- **El botón declara su fondo dos veces** —en el `bgcolor` de la celda y en el
  `style`— por si el cliente descarta uno; y es una celda de tabla con
  `padding`, no un `<a>` con `display:inline-block`, que Outlook de escritorio
  ignora dejando un enlace sin caja.
- **Ningún correo depende de una imagen** (regla 61). El nombre va como texto:
  la mayoría de los clientes bloquea imágenes por defecto, y un correo cuya
  identidad es un logo bloqueado llega anónimo.
- **Quién firma.** El courier cuando el destinatario es su cliente (seller,
  conductor, comprador); **Rutax cuando nosotros somos la contraparte**. Las
  tres de acá firman Rutax: son la cuenta del courier en Rutax, la contraseña
  de la plataforma y el acceso a la app.
- **El enlace de respaldo va siempre**, aunque haya botón: es lo único que
  queda cuando el cliente degrada, y es lo que se puede copiar y pegar.
- **Móvil.** Una columna siempre; los 600 px bajan a 100% bajo 480 y el botón
  pasa a ancho completo. La media query es lo ÚNICO que va en `<style>`: si el
  cliente la descarta, queda la tabla de 600 px, que ya funciona.
- **Tablas, no `div`.** Outlook usa el motor de Word: no implementa `max-width`
  ni `flex`. La única caja que respeta es una `<table>` con `width` en
  atributo, no en CSS. Y todo el estilo va en línea, porque Gmail descarta
  `<style>` en muchos contextos.

*Histórico: hasta el 24-08-2026 estas tres plantillas estaban en el ADN
anterior —navy `#2a3ca0` sobre lavanda `#f5f5fa`, esquinas de 12 px y la marca
en blanco sobre una banda de color—, que ya no existe en ninguna parte del
producto.*

## Los dos ajustes del panel que esta plantilla necesita (además de pegarla)

El HTML no basta: hay dos valores que viven en otra parte del panel y que, si no
se tocan, dejan el flujo del conductor roto **sin ningún error visible**.

1. **Authentication → Providers → Email → «Email OTP Expiration» = 600.**
   El default de Supabase es una hora. `supabase/config.toml` ya lo fija en
   600, **pero eso solo aplica al stack local**: el hosted lo ignora.

   ⚠️ **Es UN solo valor y cuelgan de él dos promesas escritas**, en sitios que
   no se parecen: la pantalla del conductor dice, con esas palabras, «Son 6
   números y duran 10 minutos», y desde el 24-08-2026 también lo dicen el
   correo de recuperación y las tres pantallas del flujo
   (`src/app/recuperar-contrasena/`, `src/app/restablecer-contrasena/`). Si acá
   queda en 3600, las cuatro mienten a la vez.

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
