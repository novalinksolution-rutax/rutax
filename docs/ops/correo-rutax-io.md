# Enrolamiento del correo de `rutax.io`

Runbook **concreto** del dominio de producción. `docs/ops/despliegue.md` §0/§1.7/§1.8/§5
describe el procedimiento genérico; este documento dice qué hay puesto de verdad en
`rutax.io`, qué falta y en qué orden se cierra.

Dos vías **independientes**, y confundirlas es el error clásico:

| Vía | Qué manda | Cómo |
|---|---|---|
| **Buzón** — Zoho Mail | `Admin@rutax.io` y sus alias: correo que escribe y recibe una persona | MX hacia Zoho |
| **Transaccional** — Resend | invitaciones, suscripción/dunning, aviso de incidencia, y el correo de Supabase Auth | API REST desde la app + SMTP desde Supabase |

**Se decidió Resend y no ZeptoMail** (2026-08-16), aunque Zoho Mail sí quedó como buzón.
Al volumen de Rutax los dos son gratis o casi (Resend: US$0 hasta 3.000/mes con tope de
100/día; ZeptoMail: US$2,50 por 10.000 correos con créditos que vencen a los 6 meses,
≈US$5/año). El precio no distingue; el trabajo ya hecho sí — el puerto de email del repo
está construido y probado contra Resend, incluido el webhook de rebotes. ZeptoMail queda
contratado y sin usar; su primer crédito es gratis, así que no hay costo hundido.
**Si algún día se pasa de 100 correos/día**, la decisión se reabre: ahí Resend cuesta
US$20/mes y ZeptoMail sigue en centavos.

---

## 1. Estado del DNS (verificado 2026-08-16 contra `1.1.1.1`)

Nameservers en **Porkbun** (`*.ns.porkbun.com`).

| Registro | Valor | Estado |
|---|---|---|
| `A rutax.io` | `216.150.1.1` (Vercel) | ✅ la app vive en el **apex** — no hay `app.rutax.io` |
| `CNAME www` | `…vercel-dns-016.com` | ✅ |
| `MX rutax.io` | `mx`, `mx2`, `mx3.zoho.com` | ✅ |
| `TXT rutax.io` | `zoho-verification=zb46804603.zmverify.zoho.com` | ✅ |
| `TXT rutax.io` | `v=spf1 include:zohomail.com ~all` | ✅ SPF del buzón |
| `TXT zmail._domainkey` | `v=DKIM1; k=rsa; p=…` | ✅ DKIM del buzón, selector **`zmail`** |
| `TXT _dmarc` | — | ❌ **falta** |
| Registros de Resend | — | ❌ **faltan** |

Comando de comprobación (PowerShell):

```bash
foreach ($n in @('rutax.io','_dmarc.rutax.io','zmail._domainkey.rutax.io','send.rutax.io','resend._domainkey.rutax.io')) { foreach ($t in @('A','MX','TXT')) { Resolve-DnsName -Name $n -Type $t -Server 1.1.1.1 -ErrorAction SilentlyContinue | Where-Object { $_.QueryType -eq $t } } }
```

---

## 2. Lo que falta publicar en Porkbun

### 2.1 DMARC — se puede publicar ya, no depende de Resend

- Tipo `TXT`, host `_dmarc`, valor:
  `v=DMARC1; p=none`
- Arranca en `p=none` a propósito: **observa y no rechaza**. Es el modo seguro para montar
  el transaccional; con `reject` de entrada, el primer correo mal firmado desaparece sin
  dejar rastro.
- **Va SIN `rua=`, por decisión del usuario (2026-08-16).** El `rua` pide informes diarios
  —archivos XML comprimidos de Google, Microsoft y compañía— que habrían caído en la bandeja
  de `Admin@rutax.io`. El registro protege igual sin ellos: lo que se pierde es el ojo que
  avisa cuando algo se rompe o alguien falsifica el dominio.
- **Costo asumido:** sin informes, subir a `p=quarantine`/`p=reject` deja de ser una decisión
  informada y pasa a ser a ciegas. Si algún día se quiere endurecer, primero hay que
  reponer el `rua` y observar unas semanas.

### 2.2 Los tres registros de Resend

Los genera el panel de Resend al agregar el dominio (§3). Se copian **tal cual**, con su
región — no se transcriben de memoria. La forma es:

| Tipo | Host | Para qué |
|---|---|---|
| `MX` prio 10 | `send` | return-path / feedback de rebotes |
| `TXT` | `send` | SPF del return-path (`v=spf1 include:amazonses.com ~all`) |
| `TXT` | `resend._domainkey` | DKIM — firma con el dominio raíz |

> ⚠️ **El SPF de la raíz NO se toca.** Resend pone el suyo en `send.rutax.io` porque ese
> es el return-path; la raíz sigue siendo de Zoho Mail. **Solo puede haber un registro SPF
> por nombre**: meter `include:amazonses.com` en la raíz rompería el buzón sin avisar. El
> DKIM sí va en la raíz, y es lo que hace que `From: no-responder@rutax.io` alinee con DMARC.

---

## 3. Resend

1. Entrar a la cuenta y **mirar si ya hay un dominio cargado**. Hay una contradicción sin
   resolver en el repo: `docs/arquitectura/retiro-y-ruteo.md` dice que el correo está
   apagado en producción; una prueba en vivo del 7-ago-2026 dijo lo contrario. Se resuelve
   mirando, no suponiendo.
2. Agregar el dominio **`rutax.io`** (la raíz, no un subdominio: el remitente es
   `no-responder@rutax.io`). Publicar en Porkbun los tres registros de §2.2 y esperar la
   verificación.
3. **API key con permiso de solo envío** → `RESEND_API_KEY`.
4. **Webhook**: URL `https://rutax.io/api/webhooks/resend`, eventos `email.delivered`,
   `email.bounced`, `email.complained`. El signing secret → `RESEND_WEBHOOK_SECRET`.
   `src/app/api/webhooks/resend/route.ts` es **fail-closed**: sin esa variable responde 401
   a todo. Sin el webhook, una dirección mal escrita se ve igual que una que llegó.

---

## 4. Zoho Mail (el buzón)

1. Confirmar en la consola que DKIM (selector `zmail`) está **habilitado**, no solo publicado.
2. **Un solo alias sobre `Admin@rutax.io`**: `no-responder@rutax.io`, nombre para mostrar
   `Rutax`. Recibe las respuestas que igual llegan pese al "no responder".
   ⚠️ Al crearlo, **no** marcar "Establecer como dirección de buzón de correo": esa casilla
   convierte el alias en la dirección **principal** de la cuenta.
   *Se descartaron `dmarc@` y `soporte@` (decisión del usuario, 2026-08-16) para no
   multiplicar direcciones que mantener. En consecuencia, el DMARC va sin `rua` (§2.1) y la
   dirección de contacto que la app le muestra al courier es el propio `admin@rutax.io`
   (`src/lib/contacto-rutax.ts`).*
3. Probar entrada y salida con una cuenta externa.

---

## 5. Variables en Vercel (proyecto `rutax`, scope **Production**)

| Variable | Valor |
|---|---|
| `EMAIL_SANDBOX_MODE` | `false` — literal exacto; cualquier otra cosa deja el stub |
| `RESEND_API_KEY` | la de §3.3 |
| `EMAIL_FROM_ADDRESS` | `Rutax <no-responder@rutax.io>` |
| `EMAIL_REPLY_TO` | `Admin@rutax.io` |
| `RESEND_WEBHOOK_SECRET` | el de §3.4 |
| `APP_PUBLIC_URL` | `https://rutax.io` — **verificar que no siga en `rutax-nine.vercel.app`** |

Gotchas ya documentados que aplican: `TZ` es nombre reservado en Vercel y bloquea el deploy
sin mensaje visible; y el tecleado automatizado pierde caracteres, así que estas variables
se pegan a mano y se releen.

**Redesplegar** después: las Server Actions quedan atadas al build.

`APP_PUBLIC_URL` gobierna el enlace de invitación, el `redirectTo` de activación, el de
recuperar contraseña y el `redirect_uri` de OAuth de ML. Si cambia, hay que actualizar la
Redirect URI en el DevCenter de ML o el OAuth del seller se cae.

---

## 6. Supabase Auth

`supabase/config.toml` **no aplica al proyecto hosted** — todo esto es panel.

**6.1 SMTP propio** (Authentication → SMTP Settings): host `smtp.resend.com`, puerto `587`,
usuario `resend` (literal), contraseña = la misma `RESEND_API_KEY`, sender
`no-responder@rutax.io`, nombre `Rutax`. Detalle en `despliegue.md` §1.8.
Tras configurarlo el límite queda en **30 correos/hora**: subirlo en Rate Limits, o una
tanda de invitaciones se corta a la mitad en silencio.

**6.2 URL Configuration**: `Site URL = https://rutax.io` y agregar `https://rutax.io/**` a
Redirect URLs. Es una fuente de dominio **independiente** de `APP_PUBLIC_URL` — las
plantillas de Auth usan `{{ .SiteURL }}`. Un `redirectTo` fuera de esa lista queda inerte
sin error visible.

**6.3 Plantillas**: pegar a mano el HTML de `supabase/templates/`. Usan
`{{ .SiteURL }}/auth/confirm?token_hash=…` en vez de `{{ .ConfirmationURL }}` a propósito
(ver el README de esa carpeta).

---

## 7. Verificación de punta a punta

En este orden; cada paso valida el anterior.

1. **DNS publicado** — los cuatro registros nuevos responden (comando de §1). Confirmar
   además que el SPF de Zoho en la raíz **sigue intacto**.
2. **Dominio verde en Resend.**
3. **Invitación real desde producción** a una casilla Gmail. En el original del mensaje:
   `SPF=pass`, `DKIM=pass` con `d=rutax.io`, `DMARC=pass`.
4. **Webhook vivo** — la fila de esa invitación en `identidad.invitaciones` pasa a
   `email_estado = 'entregado'` con `email_proveedor_id` poblado.
5. **Rebote controlado** — invitar a una dirección inexistente en un dominio real; la fila
   debe quedar `rebotado`.
6. **Supabase Auth** — "olvidé mi contraseña" con un usuario real: el correo llega desde
   `no-responder@rutax.io` (no desde el remitente de Supabase) y el enlace completa el cambio.
7. **Responder el correo** y confirmar que aparece en la bandeja de `Admin@rutax.io`.

---

## 8. Lo que envía correo hoy (para saber qué se enciende de golpe)

Tres consumidores del puerto (`obtenerPuertoEmail`), todos gobernados por el mismo gate:

- `src/modules/identidad/notificaciones-invitacion.ts` — invitación a seller, conductor y equipo.
- `src/modules/plataforma/notificaciones.ts` — los siete correos de suscripción y dunning.
- `src/modules/operacion/aviso-incidencia-envio.ts` — incidencia sin gestionar.

Más Supabase Auth por su propia vía (activación de cuenta y recuperación de contraseña).

**Sigue sin enviar correo, a propósito**: el aviso de conexión ML caída
(`src/modules/integraciones/notificaciones/conexion-caida.ts`), que solo deja log y
bitácora. Es una feature pendiente, no parte del enrolamiento.
