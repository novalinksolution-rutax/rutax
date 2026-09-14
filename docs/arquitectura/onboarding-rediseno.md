# Rediseño del onboarding — Courier, Seller y Conductor

**Estado:** propuesta aprobada en decisiones clave (2026-09-14), pendiente de implementación.
**Alcance:** couriers **nuevos** solamente. Todos los usuarios actuales son de prueba (creados por el fundador) → **no hay migración ni convivencia**: se elimina el password de raíz.

---

## 1. Por qué rediseñamos

El onboarding actual pesa demasiado para el usuario. Cuatro dolores concretos, verificados en código:

1. **Email de ida y vuelta antes de aportar valor.** Los tres actores reciben un correo, lo buscan, clican un enlace y *recién ahí* crean credencial. Para el conductor —que quizá ni revisa email y que el coordinador tiene enfrente en la bodega— es una barrera absurda.
2. **Tres esquemas de credencial** que recordar y resetear: password 8-char (courier), password 8-char (seller), PIN 6-dígitos (conductor). Cada uno arrastra su flujo de "olvidé mi clave" y sus tickets de soporte.
3. **El wizard de 8 pasos es un muro.** El courier no hace *nada* hasta llenar 7 pasos obligatorios (`src/app/puesta-en-marcha/`), varios de los cuales —cobro bancario, DTE, retiro— no se necesitan sino días después, al facturar.
4. **El seller autentica dos veces:** crea password y *luego* hace OAuth de ML, cuando su única razón de existir es conectar ML.

## 2. El hallazgo que habilita el rediseño (bajo riesgo)

En el código, **autenticación y aprovisionamiento ya están desacoplados**. `identidad.custom_access_token_hook(event jsonb)` inyecta los claims (`tenant_id`, `tipo_usuario`, `seller_id`, `driver_id`, `rol`, `estado_usuario`) leyendo `identidad.usuarios_perfil` por el `id` del usuario Auth — **sin importar cómo la persona se autenticó**.

El verdadero trabajo del sistema de invitaciones no es el login: es **crear la fila de perfil** que el hook lee después. Por lo tanto:

> **Cambiar el método de login (Google, magic-link, teléfono) NO toca RLS, ni los claims, ni el motor entrega→dinero.** El riesgo del cambio vive casi todo en la UI y en el enganche invitación→perfil.

## 3. Decisiones cerradas

| # | Decisión | Detalle |
|---|----------|---------|
| 1 | **Login sin passwords** | Google (principal) + **magic-link por email** (fallback). El código/enlace *es* la autenticación; nadie define ni resetea claves. |
| 2 | **Conductor por teléfono** | **WhatsApp OTP** como método único de identidad. Se aprovecha la Cloud API de Meta ya desplegada. |
| 3 | **Sin QR presencial** | Resuelve el mismo problema que el OTP pero exige estar juntos y agrega un segundo sistema de credenciales (cámara, expiración, escaneo). No paga. Se puede añadir después como atajo si el tipeo del código molesta en terreno. |
| 4 | **Sin migración** | Usuarios actuales son de prueba. Se parte de cero; se elimina el signup por email/password. |
| 5 | **Onboarding progresivo (courier)** | Se rompe el muro de 8 pasos: arranque mínimo + configuración *just-in-time* atada a la acción que la necesita. |

## 4. Principio rector de producto: **just-in-time, no muro**

Se difiere todo lo que no se necesita para la *próxima* acción con valor. Cada pieza de configuración se pide en el momento en que se vuelve necesaria, con una **checklist de progreso** siempre visible pero que **nunca bloquea la entrada**.

---

## 5. Login unificado

Un solo `/login` (y `/registro` para courier nuevo) que ofrece:

- **Continuar con Google** — principal para courier y seller.
- **Enviar enlace/código por email** (magic-link OTP) — fallback sin password.
- El **conductor no pasa por aquí**: su identidad es el teléfono, en la app nativa.

**Configuración Supabase Auth:**
- Habilitar proveedor **Google** (OAuth).
- Habilitar **email OTP / magic-link**; **deshabilitar** signup y login por email+password.
- Habilitar **phone auth** con canal **WhatsApp** vía el *Send SMS hook* de Supabase, enrutado al adaptador existente (`src/modules/integraciones/notificaciones/whatsapp/`).
- Eliminar el hack `minimum_password_length = 6` (ya no hay password de conductor en el servidor — ver §8).

**Matching de identidad en la aceptación de invitaciones (seller/conductor):** la invitación sigue atada a una identidad (email o teléfono). Al autenticar, se exige que el **email verificado de Google** (o el email del magic-link, o el teléfono verificado del OTP) **calce** con el de la invitación. Si no calza → se bloquea con mensaje claro, reutilizando la lógica de la barrera `buscarCuentaPorEmail()` de hoy.

---

## 6. Flujo rediseñado — COURIER (dueño)

### Antes
`/registro` (form) → email → clic → `/activar-cuenta` (define password) → `/puesta-en-marcha` (8 pasos, 7 obligatorios).

### Después
1. `/registro` → botón **"Continuar con Google"**. Crea `auth.users` + dispara `crearTenantConDueno()`. **Sin correo, sin password.** Entra al tiro.
2. **Arranque mínimo:** solo se pide **nombre de la empresa + RUT** (validado módulo 11). Nada más bloquea.
3. **Configuración progresiva:** el resto del antiguo wizard pasa a una **checklist / centro de configuración** persistente. Nada bloquea el ingreso; cada ítem se completa *just-in-time*, gatillado por la acción que lo necesita:

| Config (tabla) | Se pide cuando… |
|---|---|
| Zonas de cobertura (`identidad.zonas`, `zona_comunas`) | vas a operar / invitar al primer conductor |
| Tarifas (`dinero.tarifas`) | vas a asignar el primer pedido (el motor de dinero las necesita) |
| Periodicidad (`courier_config_periodos`) | antes del primer cierre de período (días después) |
| Datos de cobro bancarios (`courier_datos_cobro`) | antes de la primera facturación |
| Costo de visita a bodega (`courier_config_retiro`) | antes de pagar el primer retiro a un conductor |
| Contacto (`identidad.tenants`) | opcional, baja fricción; puede quedar en la checklist |

**Consecuencia:** el dueño ve valor en ~30 segundos (login Google + nombre/RUT), no tras 8 pasos. `puesta_en_marcha_completada_en` deja de ser una compuerta dura; se reinterpreta como "checklist mínima completa" o se retira.

**Lo que se conserva:** `crearTenantConDueno()` con su compensación transaccional (tenant + perfil + `plataforma.areas_habilitadas`), la bitácora `tenant.alta`, las 5 áreas encendidas al nacer.

---

## 7. Flujo rediseñado — SELLER

### Antes
Courier invita → email token → `/invitacion/[token]` → define password (8 chars) → `/portal/bienvenida` → conectar ML (OAuth, paso aparte).

### Después
1. Courier invita (razón social, RUT, nombre, email) → se crea `identidad.sellers` (`invitado`) + invitación en `identidad.invitaciones` (token, atado al email). **Igual que hoy.**
2. Seller recibe el enlace → **"Continuar con Google"** (verifica que el email de Google calce con el invitado; si no hay Google, magic-link al email invitado). **Sin password.**
3. **Aterriza directo en "Conecta tu Mercado Libre"** — se funden aceptar-invitación y conectar-ML en un solo tramo. La conexión ML es lo único que le da valor.
4. OAuth ML (`iniciarConexionMl` → `/oauth/ml/callback`) sin cambios; tokens cifrados en `identidad.secretos_cifrados`.

**Lo que se conserva:** `aceptarInvitacion()` (upsert en `usuarios_perfil`, doble candado `.eq("estado","pendiente")`), captura opcional de WhatsApp con consentimiento (`integraciones.whatsapp_contactos`), toda la maquinaria OAuth.

---

## 8. Flujo rediseñado — CONDUCTOR

### Antes
Courier crea conductor → invita desde `/equipo` → **email** token → `/invitacion/[token]` → define **PIN 6-díg** (= password Supabase) → app nativa.

### Después — **sin email, identidad por teléfono**
1. Coordinador crea el conductor (`actionCrearConductor`): nombre, RUT, `tipo_relacion`, y **teléfono ahora OBLIGATORIO** (hoy es opcional). Se crea una invitación **atada al teléfono** (tenant_id, driver_id, phone, `pendiente`).
2. El conductor abre la **app nativa** → ingresa su número → recibe **código por WhatsApp** → lo tipea → dentro.
3. **Resolución de tenant por teléfono:** tras verificar el OTP, se busca una invitación `pendiente` cuyo teléfono calce con el número verificado → se aprovisiona `usuarios_perfil` (`tipo_usuario='conductor'`, `driver_id`, `rol='conductor'`, `estado='activo'`) y se marca la invitación `aceptada`. **Adiós al email del conductor por completo** — se elimina el peor ida-y-vuelta de los tres.
4. La app pide crear un **PIN de desbloqueo diario**.

### Cambio de modelo del PIN (simplificación + seguridad)
Hoy el PIN **es** la contraseña Supabase del conductor (`minimum_password_length=6`). Con identidad por teléfono, el **PIN deja de ser credencial de servidor** y pasa a ser un **gate local del dispositivo**: la app guarda el refresh token tras el OTP y el PIN solo desbloquea el acceso local a esa sesión (patrón de app bancaria — teléfono = identidad, PIN = acceso rápido en terreno con apuro/guantes).

- Se conserva la validación de PIN (`src/modules/identidad/pin-conductor.ts`: 6 dígitos, rechaza triviales) como regla del **cliente nativo**.
- ⚠️ **Trabajo en el repo `rutax-conductor` (nativo):** este cambio toca la app. La pantalla de login pasa de PIN-como-password a teléfono+OTP; el PIN se vuelve unlock local. Sincronizar contrato con este repo.

---

## 9. Qué NO cambia (para tranquilidad)

- **RLS** y todo el aislamiento multi-tenant / seller / conductor.
- **`identidad.custom_access_token_hook`** y los helpers de claims (`claim_tenant_id`, `claim_seller_id`, `claim_driver_id`).
- **Motor entrega→dinero**, facturación, liquidación, conciliación.
- **Invitaciones como aprovisionamiento:** `identidad.invitaciones` (schema privado, token fuera de la vista pública), estados `pendiente→aceptada|expirada|revocada`, acceso vía `.schema("identidad")`. Solo cambia a qué identidad se atan (email o teléfono) y el método con que se canjean.

## 10. Cambios técnicos por capa

**Supabase / infra**
- Habilitar Google OAuth + email OTP; deshabilitar email+password.
- Phone auth con Send-SMS-hook → WhatsApp Cloud API (adaptador existente).
- Quitar `minimum_password_length`.
- ⚠️ Meta: el OTP requiere una plantilla de categoría **authentication** (distinta de la `notificacion_retiro_pedidos` utility ya aprobada). Hay que crear y aprobar esa plantilla.

**Base de datos (migraciones)**
- Invitación de conductor atada a **teléfono** (columna/uso), no email.
- Teléfono del conductor **NOT NULL** al invitar (revisar `identidad.conductores`).
- Evaluar unicidad de teléfono para la resolución de tenant (ver §11).

**Backend / app web**
- `/registro` y `/login` reescritos a Google + magic-link.
- Retirar `/activar-cuenta` (password) del courier; retirar definición de password del seller en `/invitacion/[token]`.
- Onboarding progresivo del courier: checklist + gates *just-in-time* (reemplaza el wizard bloqueante de `src/app/puesta-en-marcha/`).
- Aceptación de invitación seller: rama Google/magic-link con matching de email.
- Endpoint de canje de invitación por teléfono para el conductor (consumido por la app nativa vía Bearer).

**App nativa (`rutax-conductor`)**
- Login teléfono + WhatsApp OTP; PIN como unlock local.

## 11. Riesgos y puntos abiertos

1. **Teléfono duplicado entre tenants (conductor).** Si un conductor trabaja para dos couriers con el mismo número, la resolución de tenant por teléfono es ambigua. Mitigación propuesta: si hay >1 invitación `pendiente` para el mismo teléfono, la app muestra un selector de courier tras el OTP. Confirmar si el caso es real en el negocio.
2. **Calidad del número WhatsApp compartido.** El fundador confirmó que el número operativo de Rutax es 1:N a propósito y no hay problema. El OTP suma volumen de mensajes; vigilar la calificación de calidad de Meta (ya anotada en CLAUDE.md como aislamiento de *entregabilidad*, no de datos).
3. **Mismatch de email en Google.** Seller que entra con un Google distinto al email invitado → bloqueo con mensaje claro + opción de magic-link al email correcto.
4. **`puesta_en_marcha_completada_en`.** Decidir si se reinterpreta como "mínimo completo" o se retira; hoy el layout redirige al wizard mientras es NULL.

## 12. Plan por fases (propuesto)

- **F1 — Login sin password (courier).** Google + magic-link en `/registro` y `/login`; retirar `/activar-cuenta`. Supabase config. Valor: el dueño entra sin password ni correo de vuelta.
- **F2 — Onboarding progresivo (courier).** Checklist + gates just-in-time; desarmar el muro de 8 pasos.
- **F3 — Seller sin password + ML fundido.** Google/magic-link en la invitación; aterrizaje directo en conectar-ML.
- **F4 — Conductor por WhatsApp OTP.** Plantilla authentication en Meta; phone auth en Supabase; invitación por teléfono; canje; cambios en `rutax-conductor`; PIN como unlock local.

Cada fase es desplegable de forma independiente y deja el sistema en estado consistente.
