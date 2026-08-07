# Onboarding + suscripciones — prompt de traspaso

> **Estado:** borrador para revisión del dueño. Las decisiones de §3 están sin tomar; sin ellas el trabajo no arranca.
> **Fecha:** 2026-08-07 · **Rama:** `claude/onboarding-suscripciones-flujo-9682b9`

---

## Mensaje para pegar en la sesión nueva

> Trabajemos el flujo de onboarding + suscripción de punta a punta: desde que un courier se da de alta hasta que Rutax cobra y se entera. Lee `PROMPT-ONBOARDING-SUSCRIPCIONES.md` completo antes de tocar nada — §1 tiene el recorrido real verificado en código, §2 el diagnóstico, y §3 las decisiones de producto que ya tomé (marcadas). No re-litigues lo decidido. Empieza por el Bloque 1.

---

## 0. Qué es esto

El síntoma, en palabras del dueño:

> *"En el super admin siento que no puedo hacer mucho, no funcionan las suscripciones o no sé cómo sería el flujo pero no es intuitivo. Se supone que alguien se suscribe y en el super admin me sale el correo que pagó, ¿o algo así?"*

El diagnóstico corto: **las suscripciones sí funcionan mecánicamente — el problema es que el flujo está roto en los dos extremos.** Nadie está obligado a suscribirse, y cuando alguien lo hace, a Rutax no le llega nada. El backstage tiene todas las piezas (planes, períodos, cobro, mandato, dunning, métricas) pero ninguna te sale al encuentro: hay que ir a buscarlas.

Eso no es una impresión: es lo que dice el código. §1 lo demuestra.

---

## 1. El recorrido real, hoy — verificado en código

### Paso 1 · Alta pública `/registro`
[`src/app/registro/actions.ts:34`](src/app/registro/actions.ts:34) → `crearTenantConDueno` (service_role, actor `sistema`).
Crea tenant + invita al dueño por correo. **No pide plan. No crea suscripción. No arranca ningún reloj.**

### Paso 2 · Activación `/activar-cuenta`
El dueño pone contraseña y entra. Tenant plenamente funcional, con **cero suscripción**.

### Paso 3 · Panel de onboarding `(tenant)/onboarding`
Checklist de 5 pasos: DTE · Folios CAF · Tarifas · Cobranza · **"Tu plan de Rutax"**.
[`panel-onboarding.tsx:458`](src/app/(tenant)/onboarding/panel-onboarding.tsx:458) — botón *"Activar plan"* → `/configuracion/plan`.
El plan es **un ítem más de una lista**, al mismo nivel que "Tarifas iniciales". No es una puerta.

### Paso 4 · El courier elige plan (si quiere)
[`configuracion/plan/actions.ts:57`](src/app/(tenant)/configuracion/plan/actions.ts:57) → `crearSuscripcionInicial` ([`superficie-courier.ts:254`](src/modules/plataforma/superficie-courier.ts:254)).
Crea la suscripción en `estado: 'trial'`, `trial_hasta = hoy + 14` ([`TRIAL_DIAS = 14`](src/modules/plataforma/superficie-courier.ts:209)).
Publica `plataforma/suscripcion.creada` con `origen: 'self_serve'`.

### Paso 5 · Cobro
Dos caminos: link Fintoc a mano ([`acciones.ts:458`](src/modules/plataforma/acciones.ts:458) `generarLinkCobroPeriodo`) o auto-cobro con mandato ([`jobs/cobrar-periodo-auto.ts`](src/modules/plataforma/jobs/cobrar-periodo-auto.ts)).
Al confirmar → `plataforma/pago.confirmado` → correo **al courier**.

### Paso 6 · Rutax se entera
**No se entera.** Ver R3.

---

## 2. Diagnóstico — las seis roturas

### R1 · Suscribirse es opcional, y nadie lo pide
El alta no menciona planes. La suscripción aparece enterrada como paso 5 de un checklist que el courier puede ignorar para siempre. **El 100% del flujo de dinero de Rutax depende de que el usuario haga clic en un ítem opcional.**

### R2 · El enforcement es fail-open sobre `sin_suscripcion`
[`enforcement.ts:77-78`](src/modules/plataforma/enforcement.ts:77):
```
if (!entitlements.estadoSuscripcion)
  return { permitido: true, motivo: 'sin_suscripcion', limite: null, ... }
```
Un courier sin suscripción opera **ilimitado, indefinidamente**. Y como el trial de 14 días solo arranca cuando el courier activa el plan, **el que nunca lo activa nunca gasta trial**. El camino más barato para el courier es no suscribirse jamás.

El comentario del código lo asume a propósito ("courier recién creado"), pero asume también que existe un momento posterior en que deja de aplicar. Ese momento no existe.

### R3 · Rutax no recibe un solo correo
[`notificaciones.ts:48`](src/modules/plataforma/notificaciones.ts:48) — `resolverDestinatarioCourier` resuelve **siempre** al dueño del courier. Los siete jobs notificadores (`notificar-pago-confirmado`, `notificar-suscripcion-creada`, `notificar-cobro-fallido`, `notificar-trial-por-vencer`, `notificar-plan-cambiado`, `notificar-periodo-vencido`, `notificar-comunicacion`) usan ese mismo resolvedor. Todos van al courier.

Lo más parecido a un aviso a Rutax es [`vigilar-trials.ts:148`](src/modules/plataforma/jobs/vigilar-trials.ts:148): un `capturarMensaje` a **Sentry**. Es decir: la única señal a Rutax hoy vive en una herramienta de errores — y el DSN de Sentry todavía no está puesto en Vercel. En la práctica, **la señal no llega a ninguna parte**.

La respuesta a la pregunta del dueño es, entonces: **no, hoy no te llega ningún correo cuando alguien paga.**

### R4 · `/admin` no tiene dónde aterrizar
[`admin/page.tsx:11`](src/app/admin/page.tsx:11) redirige a `/admin/suscripciones`, que es una **tabla de estado actual** — no una bandeja de "qué pasó". No hay feed de eventos, ni "3 couriers nuevos esta semana", ni "2 cobros fallaron ayer". Las métricas (MRR/ARR) viven aparte en `/admin/metricas`.

Ese es literalmente el "no puedo hacer mucho" del dueño: el backstage no tiene una pantalla que responda *"¿qué pasó desde la última vez que entré, y qué requiere que yo haga algo?"*.

### R5 · Los dos caminos de alta no se cruzan
El evento distingue `origen: 'self_serve' | 'super_admin'` ([`eventos.ts:344`](src/lib/inngest/eventos.ts:344)) — self-serve por `crearSuscripcionInicial`, admin por `asignarPlan` ([`acciones.ts:117`](src/modules/plataforma/acciones.ts:117)). Pero el admin **no ve la cola de tenants sin suscripción** a los que podría asignarles plan, y el self-serve no le avisa al admin de que ocurrió. Son dos puertas al mismo cuarto, sin ventana entre ellas.

### R6 · El pago no es un evento visible en el backstage
Cuando un pago se confirma, en `/admin` eso solo se ve si entras a la suscripción específica y miras la tabla de períodos ([`cobros-periodos.tsx`](src/app/admin/suscripciones/[suscripcionId]/cobros-periodos.tsx)). Nada lo empuja hacia arriba.

### Lo que SÍ está construido y no hay que rehacer
Planes con CRUD · suscripciones con estados y transiciones auditadas · generación de períodos · cobro por link Fintoc · auto-cobro con mandato · dunning (`marcar-morosidad`, `reintentar-cobro-vencido`) · entitlements + overrides por tenant · métricas MRR/ARR · panel de couriers · observabilidad por tenant · bitácora consultable · impersonation auditada · identidad real de super-admins ([`plataforma.super_admins`](supabase/migrations/20260711000001_plataforma_super_admins.sql) con `usuario_id`, `rol_admin`, `activo`) + MFA.

**El cimiento está. Falta el recorrido.**

---

## 3. Decisiones de producto — a tomar antes de arrancar

> Marca tu opción. Cada una cambia materialmente el trabajo; no las decida el agente.

### D1 · ¿Cuándo se elige el plan?
| | Opción | Consecuencia |
|---|---|---|
| ☐ | **(a)** En `/registro`, como paso 2 del alta | Máxima claridad, peor conversión: pides compromiso antes de mostrar valor |
| ☐ | **(b)** Puerta al primer login — no entras al SaaS sin elegir plan *(recomendada)* | El trial arranca siempre, con reloj corriendo. Elimina el estado `sin_suscripcion` |
| ☐ | **(c)** Como hoy: ítem del checklist de onboarding | No se toca nada, y R1/R2 quedan tal cual |

**Por qué (b):** es la única que garantiza que todo courier tenga un reloj corriendo, sin pedir tarjeta ni compromiso antes de que vea el producto. El trial de 14 días ya existe y hoy se desperdicia.

### D2 · ¿Qué pasa cuando el trial vence sin pago?
| | Opción | Consecuencia |
|---|---|---|
| ☐ | **(a)** Sigue manual, pero la cola se ve en `/admin` *(recomendada)* | Coherente con el gate humano del proyecto. El problema no es que no suspenda: es que no te enteras |
| ☐ | **(b)** Degradar automático a solo-lectura | Requiere definir qué es "solo-lectura" en operación y dinero. Trabajo grande |
| ☐ | **(c)** Suspender automático | Contradice la doctrina de acción irreversible con gate humano |

### D3 · ¿Cómo se entera Rutax?
| | Opción | Consecuencia |
|---|---|---|
| ☐ | **(a)** Correo al super-admin en 4 eventos: alta de courier · primera suscripción · pago confirmado · cobro fallido | Te llega el "me pagaron" que pediste |
| ☐ | **(b)** Bandeja/feed en `/admin` con lo que pasó + lo que requiere acción | Resuelve el "no puedo hacer mucho" |
| ☐ | **(c)** Ambas: la bandeja es la fuente de verdad, el correo es el despertador *(recomendada)* | |

**Destinatario:** existe `plataforma.super_admins` con `activo` y `rol_admin` — el correo va a los admins activos, no a una casilla en una variable de entorno. Confirmar si el rol de *soporte* también recibe o solo el rol total.

### D4 · ¿Se queda el fail-open?
Si D1 = **(b)**, `sin_suscripcion` deja de ser alcanzable y el fail-open se vuelve un salvavidas muerto. Recomendación: **conservarlo como defensa** (no romper a nadie ante un bug), pero **alertar** cuando se dispare, porque a partir de D1(b) significa que algo falló.

---

## 4. Alcance propuesto — cuatro bloques

Cada bloque entrega valor solo; se pueden parar entre uno y otro.

### Bloque 1 — Cerrar la puerta *(depende de D1)*
La suscripción deja de ser opcional. Si D1 = (b): guard en el layout de `(tenant)` que desvía a la elección de plan mientras no exista suscripción; pantalla de bienvenida con los planes y el trial de 14 días explicado; el paso "Tu plan de Rutax" sale del checklist de onboarding porque ya está resuelto antes de llegar ahí.
**Toca:** `(tenant)/layout.tsx`, `configuracion/plan/*`, `(tenant)/onboarding/panel-onboarding.tsx`.

### Bloque 2 — Que Rutax se entere *(depende de D3)*
Resolvedor de destinatario **Rutax** (hermano de `resolverDestinatarioCourier`, leyendo `plataforma.super_admins`). Cuatro correos nuevos con su copy. Deduplicación por bitácora, igual patrón que los existentes.
**Toca:** `plataforma/notificaciones.ts`, jobs nuevos o extensión de los existentes, `lib/inngest/eventos.ts` si falta el evento de alta de courier (hoy **no** existe: `crearTenantConDueno` no publica nada).

### Bloque 3 — Home de `/admin`
Pantalla de aterrizaje real, en `/admin`, que reemplaza el redirect. Dos mitades: **qué pasó** (feed derivado de bitácora + períodos + suscripciones) y **qué requiere que yo actúe** (trials vencidos, cobros fallidos, morosos, tenants sin suscripción). MRR/ARR arriba, traído de `metricas-negocio.ts`.
**Toca:** `admin/page.tsx` (deja de redirigir), `plataforma/consultas.ts`.

### Bloque 4 — Colas accionables *(depende de D2)*
Que cada fila de "requiere acción" tenga su acción a un clic, auditada y con confirmación: suspender, generar link de cobro, asignar plan al tenant sin suscripción.
**Toca:** `admin/suscripciones/acciones.ts` (ya existen las acciones; falta la superficie).

---

## 5. Invariantes que no se negocian

- **Deny-all de `plataforma` intacto.** Ninguna vista `public.*` sobre tablas de `plataforma` — eludiría el carve-out vía PostgREST. Lectura solo `service_role`.
- **Bitácora antes que efecto externo, y con autor real.** Toda acción de plataforma lleva el `usuario_id` del super-admin (ya existe la identidad real; no volver a `actorUsuarioId: null`).
- **Nada irreversible en automático.** Suspender sigue siendo humano. El agente no "mejora" esto.
- **`plataforma` ≠ `dinero`.** Rutax→courier vs courier→seller. No mezclar tablas, ni jobs, ni pantallas.
- **El comprobante de pago de suscripción es no-tributario.** Decisión ya tomada en F1; no convertirlo en DTE.
- **Correo por el puerto existente** (`src/lib/avisos/`). No introducir proveedor nuevo.
- **Sin colas propias ni microservicios.** Los jobs nuevos son funciones Inngest.

---

## 6. Verificación

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Y QA funcional real siguiendo `docs/PRUEBA.md` — **el recorrido completo de un courier nuevo**, no pantallas sueltas:

1. Alta en `/registro` con RUT y correo nuevos.
2. Activar cuenta desde el correo.
3. Primer login → ¿aparece la puerta del plan? (D1)
4. Elegir plan → verificar `estado='trial'` y `trial_hasta` a 14 días.
5. Verificar que **llegó el correo a Rutax** de courier nuevo + suscripción creada.
6. Generar período y cobrar → verificar el correo de pago confirmado **a Rutax**.
7. Entrar a `/admin` → los cuatro eventos anteriores deben estar en el feed, sin buscarlos.

Actualizar `checklist-pruebas-funcionales-mvp.md` al cerrar.

---

## 7. Delegación sugerida

`ux-ui` (el recorrido y la puerta del plan, antes que nada) → `arquitecto` (solo si D3 mueve el modelo de destinatario o hace falta evento de alta de courier) → `base-datos-rls` (si hay columnas nuevas) → `backend` (resolvedor Rutax, jobs, consultas del feed) → `frontend` (puerta del plan, home de `/admin`) → `copywriter` (los cuatro correos y el copy de la puerta) → `qa` (recorrido de §6 completo).

**Skill a cargar antes de tocar cobro:** `pagos-chile`.
