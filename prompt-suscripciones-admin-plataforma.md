# Prompt — Completar el módulo de Suscripciones + análisis de gaps de administración de plataforma

> Pégale esto a Claude Code en la raíz del proyecto. Está escrito para la **sesión principal**, que debe **delegar** siguiendo el mapa de orquestación de `CLAUDE.md` (`arquitecto` → `base-datos-rls` → `backend`/`integraciones` → `frontend` → `qa`), y respetar todos los invariantes del proyecto.

---

## Contexto y rol

Trabajas en **Rutax** (SaaS B2B multi-tenant para couriers). Lee primero `CLAUDE.md`. Este trabajo NO es el módulo `dinero` (facturación courier→seller); es el **backstage financiero de la plataforma misma** (Rutax→courier): el módulo `plataforma` y el área `/admin`. Es para **mí, el dueño de Rutax**.

**El cimiento ya está construido — construye SOBRE él, no lo dupliques.** Estado actual verificado:

- **Schema `plataforma`** (migración `20260621000015`), con RLS **deny-all para `authenticated`** (solo `service_role` accede; el courier nunca ve este schema): tablas `planes`, `suscripciones` (1:1 con tenant), `periodos_suscripcion`, `pagos_plataforma`.
- **Acciones del super-admin** (`src/modules/plataforma/acciones.ts`, todas con `verificarAdminSecret` + bitácora antes del efecto, actor `super_admin`): `asignarPlan`, `activarSuscripcion`, `suspenderSuscripcion`, `cancelarSuscripcion`, `registrarPagoManual`, `generarLinkCobroPeriodo` (Fintoc), `generarPeriodoManual`.
- **Consultas** (`src/modules/plataforma/consultas.ts`): planes activos, todas las suscripciones con plan+tenant, por tenant, períodos, períodos con pago, tenants sin suscripción.
- **Jobs Inngest** (`src/modules/plataforma/jobs/`): `generarPeriodos` (mensual día 1), `marcarMorosidad` (diario 08:00 — marca `vencido` + alerta, **suspensión siempre manual**), `verificarSalud` (watchdog horario: crons stale, backlog, líneas huérfanas).
- **Cobro por link Fintoc**: webhook `/api/webhooks/fintoc-suscripcion` + `cobro.ts::confirmarPagoSuscripcion` (idempotente). Adaptador checkout con gate sandbox (`SUSCRIPCION_SANDBOX_MODE`).
- **Área `/admin`**: sesión por cookie `httpOnly` con token HMAC derivado de `SUPER_ADMIN_SECRET` (nunca secreto en URL); nav **Suscripciones · Salud**; `/admin/suscripciones` (tabla + asignar plan + tenants sin suscripción), `/admin/suscripciones/[id]` (detalle + cobros/períodos), `/admin/salud` (telemetría de jobs + integridad del motor).

## Decisiones de negocio (ya tomadas por el dueño — NO re-preguntar)

1. **Modelo de contratación: HÍBRIDO.** El courier elige su **plan inicial** en un onboarding self-serve y tiene una vista **de solo lectura** de "Mi plan / Facturación". La **gestión y los cobros los opero yo** desde `/admin`. El aislamiento se mantiene: el courier **no** lee el schema `plataforma` directo — toda su lectura/escritura pasa por una superficie server-side acotada.
2. **Cobro: AUTO-COBRO RECURRENTE.** Integrar un **mandato recurrente** (PatPass Webpay/Transbank o suscripciones Fintoc — evalúalo en Fase 0) que cobra solo cada período. Los **links Fintoc manuales existentes quedan como respaldo**. Gate sandbox + opt-in real explícito, molde de los adaptadores DTE/checkout ya existentes.
3. **Administración de plataforma: IDENTIFICAR + PLAN POR FASES.** Además de completar suscripciones, entrega un **informe priorizado de gaps de administración de plataforma** con un plan por fases. **No** los implementes en este trabajo (salvo lo que se solape con suscripciones, ver más abajo); yo decido qué construir después.

---

## Fase 0 — Auditoría y arquitectura (delegar a `arquitecto`; secretos/tributario a `seguridad-cumplimiento`)

Antes de escribir código:

1. **Confirma y amplía el inventario** de lo ya construido (arriba) leyendo el módulo `plataforma`, `/admin` y los webhooks.
2. **Decisión de arquitectura clave del modelo híbrido:** cómo permite el tenant **leer el catálogo público de planes** y **crear/leer su propia suscripción** sin abrir el schema `plataforma` (que es deny-all). Propón el mecanismo (server action con `service_role` que valida la sesión del courier y fuerza `tenant_id = el suyo`, vs. RPC `SECURITY DEFINER` acotada que expone SOLO el catálogo y la propia suscripción). Mantén el invariante: el courier nunca ve datos de otros tenants ni el resto del backstage.
3. **Decisión del mandato recurrente:** PatPass Webpay vs. suscripciones Fintoc — recomienda uno como adaptador aislado (nuevo "puerto" en `integraciones`), con almacenamiento **cifrado** del mandato/token (regla dura: secretos fuera de logs/URLs/texto plano), gate sandbox + opt-in real por courier.
4. **Decisión tributaria (con `seguridad-cumplimiento` + skill `chile-dte`):** ¿Rutax emite **boleta/factura** al courier por la suscripción SaaS (bajo el RUT de Rutax), o basta un comprobante de pago descargable por ahora? Respeta el gate: **ningún proceso automático emite un DTE irreversible**; la emisión real es opt-in explícito. Deja la emisión real de DTE como decisión marcada, no la actives.
5. **Entrega el informe de gaps de administración de plataforma** (ver sección "Entregable B").

Publica las decisiones (contratos, dónde vive cada cosa, eventos nuevos) antes de implementar.

---

## Alcance a IMPLEMENTAR (completar suscripciones)

Sigue la secuencia `arquitecto` → `base-datos-rls` → `backend`/`integraciones` → `frontend` (flujos por `ux-ui`, textos por `copywriter`) → `qa`. Carga las skills `pagos-chile`, `chile-dte` y `multitenant-rls` según corresponda.

**A. Onboarding self-serve del plan (courier, área `(tenant)`).** Pantalla donde el courier ve el catálogo de planes activos y elige su plan inicial → crea su suscripción en `trial`. Escritura server-side acotada (Fase 0 §2), validando que solo afecta su propio `tenant_id`. Bitácora con su `actorUsuarioId`.

**B. Vista "Mi plan / Facturación" (courier, solo lectura).** Plan actual, estado, período vigente, historial de pagos y comprobantes descargables. Todo intermediado server-side; nada del schema `plataforma` se expone a PostgREST del cliente. Copy por `copywriter`.

**C. Auto-cobro recurrente (adaptador aislado en `integraciones`).** Nuevo puerto `puerto-suscripcion-recurrente` (molde puerto checkout/DTE): registrar mandato, cobrar período, cancelar mandato. Gate sandbox (stub) + opt-in real. Mandato/token **cifrado**. Modifica el cron mensual: si hay mandato activo → cobra automático (idempotente, con reintentos); si no → cae al link manual actual. Webhook de confirmación (reusa el patrón `fintoc-suscripcion`). Manejo de **cobro fallido** → alimenta el dunning (F).

**D. CRUD de planes desde `/admin`.** Crear/editar (precio mensual/anual, `limite_pedidos_mes`, `caracteristicas` jsonb, activar/desactivar). Hoy están seedeados en SQL. Acciones con `verificarAdminSecret` + bitácora. Al desactivar un plan, no romper suscripciones existentes.

**E. Ciclo de vida del trial.** Hoy `trial_hasta` no dispara nada. Lógica/cron que transiciona `trial`→`activa` (al primer pago confirmado o al vencer el trial con mandato activo), y trial vencido **sin** pago → alerta al super-admin (suspensión **manual**, nunca automática). Evento tipado `plataforma/trial.por-vencer` para avisar antes.

**F. Dunning / cobranza de morosidad.** Extiende `marcarMorosidad`: secuencia de recordatorios al courier (email), reintento de auto-cobro, período de gracia, y **sugerencia** de suspensión al super-admin (no auto-suspensión). Emails por `copywriter`.

**G. Enforcement de límites y características del plan.** `limite_pedidos_mes` y `caracteristicas` (`conductores_max`, `api_publica`, `webhooks`) hoy no se aplican. Con `arquitecto`: define dónde se hace el gating (ingesta de pedidos, alta de conductores…), con **medición de uso por período** y comportamiento **blando** al llegar al tope (aviso + bloqueo suave, nunca un corte duro sorpresa). No degradar la operación en marcha.

**H. Comprobante/boleta Rutax→courier.** Según la decisión tributaria de Fase 0 §4: al menos comprobante de pago descargable por el courier; si se define emisión de documento, respeta el gate de DTE (opt-in, sin auto-emisión irreversible).

**I. Cambio de plan y proración.** Upgrade/downgrade a mitad de ciclo con proración (hoy `asignarPlan` solo hace upsert). Deja registro y bitácora.

**J. Facturación anual.** `precio_anual_clp` ya existe pero `generarPeriodos` solo hace mensual. Agrega **periodicidad** a la suscripción (mensual/anual) y respétala en la generación de períodos y el auto-cobro.

**K. Eventos Inngest tipados.** Define en `src/lib/inngest/eventos.ts` los eventos nuevos del ciclo (`plataforma/suscripcion.creada`, `plataforma/pago.confirmado`, `plataforma/cobro.fallido`, `plataforma/trial.por-vencer`, etc.) **antes** de emitirlos o consumirlos.

**L. Métricas de negocio del dueño (en `/admin`).** Tablero con **MRR, ARR, couriers por estado (activo/trial/suspendido), churn, ingresos del mes y morosidad total**. Hoy solo existe `scripts/metricas-plataforma.sql`. (Se solapa con los gaps de admin — impleméntalo aquí porque es núcleo para operar suscripciones.)

**M. Notificaciones al courier por email.** Pago recibido, pago por vencer, cobro fallido, trial por vencer, plan cambiado. Hoy las alertas van solo al super-admin vía Sentry. Copy por `copywriter`.

---

## Invariantes que NO puedes romper (del `CLAUDE.md`)

- **Aislamiento en la BD (RLS), no solo en la app.** El schema `plataforma` sigue **deny-all** para `authenticated`; toda superficie del courier es server-side y acotada a su propio `tenant_id`.
- **Bitácora antes que efectos externos, y con autor.** Toda acción financiera/de acceso se registra en `bitacora_auditoria` **antes** de publicar un evento Inngest o llamar a una integración; acciones del courier con su `actorUsuarioId`, acciones del backstage con actor `super_admin`, del webhook con actor `sistema`.
- **Secretos cifrados, nunca en logs/URLs/texto plano** (mandato recurrente, tokens de pago). No loguear `SUPER_ADMIN_SECRET` ni el `adminSecret`.
- **No auto-emitir DTE irreversible.** La emisión real es opt-in explícito por courier + revisión de `seguridad-cumplimiento`. Los adaptadores de pago/DTE nuevos corren en **sandbox** por defecto.
- **Jobs idempotentes con reintentos**, nunca en el request del usuario. El auto-cobro y las confirmaciones deben ser idempotentes ante reintentos y webhooks duplicados.
- **No introducir microservicios ni colas propias.** Usa Inngest (canónico).
- **Localización Chile:** CLP entero, español de Chile, zona horaria `America/Santiago`, RUT válido donde aplique.
- **Helpers de UI compartidos** (`src/lib/ui/`: moneda CLP, estados, comunas) — reúsalos, no dupliques presentación.

---

## Entregables

**Entregable A — Implementación** de A–M arriba, con la secuencia de agentes y los invariantes respetados.

**Entregable B — Informe de gaps de administración de plataforma** (`docs/` en Markdown), priorizado y por fases, cubriendo al menos:
1. **Gestión de couriers (tenants):** panel para ver todos los couriers, su estado, salud, y provisionar/suspender/offboard con soporte.
2. **Dashboard de negocio ampliado:** GMV procesado, pedidos, DTEs emitidos, conductores activos, además del MRR/ARR ya implementado en (L).
3. **Super-admins con identidad real:** hoy es un secreto compartido y `actorUsuarioId` queda `null` en las acciones del backstage; propón usuarios `super_admin` nombrados, roles del equipo de plataforma, 2FA y auditoría de "quién hizo qué" a nivel plataforma.
4. **Impersonation / soporte** para depurar la cuenta de un courier de forma auditada.
5. **Visor de bitácora de auditoría** a nivel plataforma.
6. **Feature flags / entitlements por courier** ligados al plan (se conecta con el enforcement de G).
7. **Comunicaciones a couriers** (mantención, novedades, avisos de plataforma).
8. **Gestión del opt-in de DTE real por courier** desde el admin.
9. **Observabilidad por-tenant** (drill-down): salud de conexiones ML, backlog y errores por courier.

Para cada gap: impacto, esfuerzo aproximado, dependencias y fase sugerida. **No los implementes** (salvo el solape ya cubierto en L); son para que yo decida.

---

## Definición de hecho / verificación

- `npm run typecheck` + `npm run lint` + `npm test` (Vitest) + `npm run build` en verde.
- Migraciones **versionadas e idempotentes** en `supabase/migrations/`; nada de DDL fuera de migraciones.
- **`qa`** prueba especialmente: (a) que el courier **no** puede leer/escribir datos de otro tenant ni el backstage (aislamiento RLS, incluyendo la nueva superficie híbrida), y (b) idempotencia del auto-cobro y las confirmaciones de webhook. Pruebas de aislamiento en pgTAP donde toque schema/RLS.
- **`seguridad-cumplimiento`** revisa: cifrado del mandato, ausencia de secretos en logs/URLs, y el gate de DTE.
- Actualiza `checklist-pruebas-funcionales-mvp.md` con cada RF/escenario probado.
- Verifica en el entorno local/staging (`docs/PRUEBA.md`) antes de marcar hecho.
```
