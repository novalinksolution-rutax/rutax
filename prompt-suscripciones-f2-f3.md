# Prompt — Suscripciones de plataforma: Fases 2 y 3 (continúa F1)

> Pégale esto a Claude Code en la raíz del proyecto. Es para la **sesión principal**, que **delega** por el mapa de orquestación de `CLAUDE.md` (`arquitecto` → `base-datos-rls` → `backend`/`integraciones` → `frontend` → `qa`) y respeta todos los invariantes.

## Contexto

Trabajas en **Rutax** (SaaS B2B multi-tenant para couriers, Chile). Lee primero `CLAUDE.md`. Este trabajo continúa el **backstage financiero de la plataforma** (módulo `plataforma` + área `/admin`, Rutax→courier — NO el módulo `dinero`, que es courier→seller). La **Fase 1 ya está construida y verde**; ahora vienen **F2 y F3**.

Antes de nada, lee:
- La memoria `suscripciones_plataforma_f1` (qué se hizo en F1, decisiones cerradas).
- `docs/plataforma/informe-gaps-administracion-plataforma.md` (los 9 gaps priorizados por fases — es el mapa de F2/F3).

**Decisiones ya tomadas por el dueño (NO re-preguntar):** comprobante de pago **no tributario** (la Factura 33 la emite Rutax por fuera; DTE in-app marcado, no activado) · modelo **híbrido opción A** (superficie server-side `superficie-courier.ts` que fuerza `tenant_id` del claim; `plataforma` sigue **deny-all**) · mandato **Fintoc recurrente** (adaptador aislado en `integraciones`, sandbox + opt-in) · enforcement de límites **blando** (avisa, no corta la operación en marcha).

**Ya existe de F1 (construye SOBRE esto):** `superficie-courier.ts` (catálogo, Mi plan, alta self-serve, `obtenerEntitlementsTenant`) · eventos Inngest del ciclo (`plataforma/suscripcion.creada|periodo-generado|pago.confirmado|cobro.fallido|trial.por-vencer`) · capacidad RBAC `gestionar_suscripcion` · job `cobrar-periodo-auto` + webhook `fintoc-suscripcion-recurrente` · adaptador `integraciones/pagos/suscripcion-recurrente/` · pantallas `(tenant)/configuracion/plan` · comprobante `api/courier/plataforma/comprobantes/[periodoId]` · columnas `periodicidad`/`auto_cobro_habilitado`/`mandato_estado`/`mandato_ref`/`plan_anterior_id`/`cambio_efectivo_desde`.

## Cómo empezar (Fase 0 corta, con checkpoint)

1. Confirma el estado real leyendo el módulo `plataforma`, `/admin` y lo listado arriba (no lo re-construyas).
2. Delega a `arquitecto` las decisiones estructurales nuevas (dónde se hace el enforcement, modelo de proración, identidad real de super-admins).
3. **Propón un orden de implementación por fases y pídeme visto bueno antes de construir** (igual que en F1). Yo decido qué bloque arrancar.

## Alcance F2 — operar el backstage + monetizar

- **Enforcement de límites/features (item G):** `limite_pedidos_mes` con aviso al 80/100% **sin cortar**, `conductores_max` con bloqueo preventivo al crear el N+1, flags `api_publica`/`webhooks` — todo sobre `obtenerEntitlementsTenant`, con medición de uso por período. No degradar la operación en marcha.
- **Cambio de plan + proración (item I)** y **facturación anual (item J):** respeta `periodicidad` en `generar-periodos` y el auto-cobro; upgrade inmediato prorrateado, downgrade diferido; registro + bitácora (columnas de trazado ya existen).
- **CRUD de planes en `/admin` (item D):** crear/editar/activar-desactivar, con `verificarAdminSecret` + bitácora; no romper suscripciones existentes al desactivar.
- **Ciclo de trial (item E):** transición trial→activa (primer pago / vencimiento con mandato); trial vencido sin pago → alerta (suspensión **manual**); productor del evento `plataforma/trial.por-vencer` (ya definido, sin productor aún).
- **Dunning / morosidad (item F):** extiende `marcar-morosidad` con recordatorios al courier, reintento de auto-cobro, período de gracia y **sugerencia** de suspensión (no auto-suspensión).
- **Métricas de negocio en `/admin` (item L, gap 2):** MRR, ARR, couriers por estado, churn, ingresos del mes, morosidad total (alimentado por `plataforma/pago.confirmado`).
- **Notificaciones al courier por email (item M):** pago recibido, por vencer, cobro fallido, trial por vencer, plan cambiado. Copy por `copywriter`.
- **Gaps rápidos de admin:** visor de bitácora a nivel plataforma (gap 5) · opt-in de DTE real por courier desde admin, auditado (gap 8) · panel de couriers/tenants con estado+salud+offboard (gap 1) · entitlements con overrides por courier (gap 6) · observabilidad por-tenant / drill-down (gap 9).

## Alcance F3 — madurez y gobernanza

- **Super-admins con identidad real (gap 3) — la deuda #1:** hoy `/admin` es un secreto compartido y la bitácora del backstage queda con `actorUsuarioId=null`. Migrar a usuarios `super_admin` nombrados (Supabase Auth), roles del equipo, 2FA, y "quién hizo qué" real. Empezar dándole **nombre al actor** cuanto antes.
- **Impersonation / soporte auditado (gap 4).**
- **Comunicaciones a couriers (gap 7).**
- **Dashboard de negocio ampliado (gap 2):** GMV procesado, pedidos, DTEs emitidos, conductores activos (agregados cross-schema, sin romper aislamiento).

## Invariantes que NO puedes romper (de `CLAUDE.md`)

- `plataforma` sigue **deny-all** para `authenticated`; toda superficie del courier es server-side acotada a su `tenant_id`.
- Bitácora **antes** de efectos externos y **con autor** (courier→su `actorUsuarioId`; backstage→`super_admin`; webhook→`sistema`).
- Secretos cifrados, nunca en logs/URLs/texto plano. No loguear `SUPER_ADMIN_SECRET`/`adminSecret`.
- **No auto-emitir DTE irreversible** (emisión real opt-in por courier + revisión de `seguridad-cumplimiento`).
- Jobs idempotentes con reintentos, nunca en el request. Inngest canónico (sin colas propias).
- CLP entero, español de Chile, `America/Santiago`, RUT donde aplique. Reusa helpers de `src/lib/ui/`.

## Definición de hecho

- `npm run typecheck` + `npm run lint` + `npm test` + `npm run build` en verde. Migraciones versionadas e idempotentes.
- `qa` prueba aislamiento (pgTAP `npx supabase test db`) e idempotencia; `seguridad-cumplimiento` revisa secretos y el gate de DTE.
- Actualiza `checklist-pruebas-funcionales-mvp.md` por cada escenario probado.
