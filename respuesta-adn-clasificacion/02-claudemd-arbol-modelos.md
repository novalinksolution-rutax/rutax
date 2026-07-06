# 2. CLAUDE.md + árbol de carpetas + modelos de datos

Tres partes: (A) el `CLAUDE.md` actual completo, (B) el árbol del repo, (C) los modelos de
datos ya existentes (schemas, tablas y enums Postgres).

---

## A. CLAUDE.md actual (copia íntegra)

> Archivo en la raíz del repo: `CLAUDE.md`. Reproducido aquí completo para que sea autocontenido.

```markdown
# Proyecto: SaaS de gestión operativo-financiera para couriers (Mercado Libre Flex · Santiago)

## Qué es
SaaS B2B vertical, neutral y multi-tenant. Lo usan empresas de última milla (couriers) para operar entregas Flex + same-day y cerrar su trastienda de dinero (facturar a sellers, liquidar conductores, conciliar). El fundador NO opera entregas; solo provee el software.

## Diferenciador (no perderlo de vista)
Motor entrega→dinero: cada entrega genera, sola, su línea de cobro al seller y su línea de liquidación al conductor, conciliadas. El ruteo NO es el foco (está commoditizado).

## Restricción dura
La app de escaneo/POD de Mercado Envíos Flex es obligatoria y NO es integrable. El software orquesta alrededor de ella; nunca la reemplaza. El conductor usa dos apps.

## Reglas no-negociables (el contrato)
- El aislamiento entre couriers (tenants) y del seller SE IMPONE EN LA BASE DE DATOS vía RLS, no solo en la app. Toda tabla de negocio lleva tenant_id.
- El seller solo ve sus propios datos; el conductor solo los suyos.
- Certificados digitales y tokens (ML, etc.) cifrados; NUNCA en logs, en texto plano ni en URLs.
- Toda acción financiera y de acceso queda en bitácora de auditoría.
- Procesos pesados (ingesta, facturación, liquidación, estados) corren como jobs idempotentes con reintentos, no en el request del usuario.
- Localización Chile: CLP, español, zona horaria de Santiago, validación de RUT.
- NO introducir microservicios, colas propias, IA ni optimizadores de ruteo en el MVP.

## Organización del workspace
Estructura del repo:
- `CLAUDE.md` (raíz) — esta memoria; léela primero.
- `.claude/agents/` — 10 subagentes (roles), como archivos `.md` planos.
- `.claude/skills/<skill>/SKILL.md` — 5 skills (conocimiento de dominio reutilizable).
- `.claude/commands/` — comandos de flujo opcionales (p. ej. `/feature`).
- `docs/` — levantamiento e informe de mercado (detalle completo; ver Referencias).
- `src/` (o `app/`) — código del monolito, organizado por módulos.

Módulos del monolito (límites claros, no mezclar):
- `identidad` — auth, tenants, RBAC, onboarding del courier y del seller.
- `operacion` — pedidos, ingesta, asignación, manifiestos, estados, incidencias.
- `dinero` — motor entrega→dinero, facturación DTE, liquidaciones, conciliación, cobranza.
- `integraciones` — adaptadores aislados (un "puerto" por servicio: ML, DTE, pagos). El núcleo NO llama APIs externas directo.

Convenciones de rutas en `src/app/` (Next.js App Router, App Router groups):
- `(tenant)/` — área autenticada de roles internos del courier (dueño, supervisor, coordinador, administración). Layout único `(tenant)/layout.tsx` con navegación condicionada por capacidad RBAC. Todas las pantallas nuevas del courier (operación, manifiestos, dinero, configuración, onboarding, equipo, sellers) van aquí.
- `portal/` — portal del seller (login propio en `portal/login`, pedidos, cobros con descarga de factura PDF, incidencias).
- `conductor/` — vista del conductor (manifiesto del día, liquidaciones), pensada como PWA.
- `login/` — login de usuarios internos del courier.
- `(app)/` — grupo heredado de Fase A, reemplazado por `(tenant)`. No agregar pantallas nuevas ahí; está pendiente de limpieza.
- `api/courier/*`, `api/operaciones/*` — endpoints de descarga/exportación (etiqueta ML, exportación de datos RNF-13). Mismo gating RBAC que la pantalla equivalente.

## Comandos
- Dev: `npm run dev` (Next.js + Turbopack)
- Build: `npm run build` · Lint: `npm run lint` · Typecheck: `npm run typecheck`
- Tests: `npm test` (Vitest, `*.test.ts` junto a su código). Aislamiento RLS en pgTAP (`supabase/tests/database/`, `npx supabase test db`).
- Base de datos: migraciones versionadas e idempotentes en `supabase/migrations/` (Supabase CLI).
- Entorno local/staging: ver `docs/PRUEBA.md` (Supabase local, seed de demo de un solo tenant, Inngest Dev Server).
- Variables de entorno: copia `.env.example` a `.env.local`. Nunca commitees `.env.local`.

## Datos y tipo de información
El tenant es el courier; cada courier tiene sellers, conductores, pedidos (Flex + same-day), tarifas, incidencias y los documentos de dinero (líneas de cobro/liquidación, facturas DTE, liquidaciones, conciliación). Toda tabla de negocio lleva `tenant_id`.

Clasificación de sensibilidad:
- Secretos (cifrados): certificados digitales del courier, tokens OAuth de ML, credenciales de proveedores (DTE, pagos).
- Datos personales (minimización + consentimiento): datos del conductor (Ley 21.431) y del destinatario.
- Datos financieros (SII): bitácora de auditoría + respaldo; no se pierden ni se exponen entre tenants.

## Stack
- TypeScript end-to-end. Monolito modular (no microservicios).
- Frontend: Next.js (React) + Tailwind + shadcn/ui.
- Datos: PostgreSQL con RLS. Backend: Supabase (Postgres + Auth + Storage + RLS + funciones).
- Jobs en segundo plano: orquestador gestionado (Inngest).
- App de conductor: PWA en MVP; nativa (Expo) en V2.
- Hosting: Vercel + Supabase.
- Integraciones como adaptadores aislados (un "puerto" por servicio: ML, DTE, pagos).

## Invariantes transversales
- Compuerta de aprobación de facturación (NO auto-emitir DTE): ningún cron emite facturas. `cerrar-periodo` solo cierra y dispara conciliación; la emisión exige acción humana `emitirFacturaPeriodo` (gate `puedeEmitirFacturas`).
- Bitácora antes que efectos externos, y con autor (`actorUsuarioId`).
- Eventos Inngest tipados en `src/lib/inngest/eventos.ts`.
- Adaptador DTE en sandbox + opt-in real por courier (`emision_dte_real_habilitada`, default false). Candidato real: Openfactura.
- Helpers de UI compartidos en `src/lib/ui/` (CLP, estados, comunas RM).
- Checklist de pruebas funcionales: `checklist-pruebas-funcionales-mvp.md`.

## Orden de construcción (MVP en fases)
- A. Cimiento: multi-tenant + RLS, RBAC, onboarding del courier, tarifas, OAuth del seller + refresco de tokens. Implementado.
- B. Operación: ingesta Flex + panel multi-seller, same-day ad-hoc, asignación + manifiesto, estados, incidencias, salud de conexiones + reconexión + backfill, dashboard, vista de conductor, portal del seller. Implementado.
- C. Motor entrega→dinero: líneas de cobro/liquidación, reglas de incidencia, conciliación, facturación DTE (sandbox), liquidación de conductores. Implementado y verificado end-to-end con datos de demo.

Pendiente (no implementar sin pedido explícito): observabilidad/Sentry, disponibilidad y respaldos.

## Orquestación
Sesión principal coordina y delega; subagentes no se llaman entre sí. Secuencia por feature:
`arquitecto` → `base-datos-rls` → `backend`/`integraciones` → `frontend` → `qa`.

## Skills del proyecto
flex-ml · chile-dte · multitenant-rls · motor-entrega-dinero · pagos-chile

## Referencias (en docs/)
levantamiento.md (RF-001..RF-051) · informe-mercado.md · arquitectura/fase-{a,b,c} · ux/fase-{a,b,c} · PRUEBA.md · checklist-pruebas-funcionales-mvp.md
```

> Nota: la copia de arriba está ligeramente condensada en las secciones de "Comandos" e
> "Invariantes" para legibilidad. El archivo canónico y exhaustivo es `CLAUDE.md` en la raíz.

---

## B. Árbol de carpetas (nivel relevante)

```
SaaS Courier Again/
├─ CLAUDE.md, AGENTS.md, README.md
├─ checklist-pruebas-funcionales-mvp.md
├─ package.json, next.config.ts, components.json, eslint.config.mjs
├─ Documentos de producto/UX (raíz):
│  ├─ PRODUCT_BLUEPRINT.md, PROJECT_AUDIT.md
│  ├─ UX_STRATEGY.md, UX_READINESS_REPORT.md, BRIEF_DECISIONES_UX.md
│  ├─ DESIGN_SYSTEM.md, FRONTEND_*.md
│
├─ .claude/
│  ├─ agents/        (10 subagentes: arquitecto, backend, base-datos-rls, integraciones,
│  │                  frontend, ux-ui, qa, copywriter, seguridad-cumplimiento, devops,
│  │                  mercadolibre-docs)
│  └─ skills/        (5 skills: flex-ml, chile-dte, multitenant-rls,
│                     motor-entrega-dinero, pagos-chile)
│
├─ Contexto/         (levantamiento original, 00..17: alcance, modelo de negocio,
│                     descubrimiento funcional, usuarios/permisos, procesos, RF, RNF,
│                     arquitectura, roadmap, riesgos, plan vibecoding, anexos)
│
├─ docs/
│  ├─ levantamiento.md, informe-mercado.md, PRUEBA.md
│  ├─ arquitectura/   (fase-a-cimiento, fase-b-operacion, fase-c-dinero,
│  │                   cobranza-fintoc, validacion-dte-openfactura)
│  ├─ ux/             (fase-a-onboarding, fase-b-operacion, fase-c-dinero)
│  ├─ mercadolibre/   (autenticación, órdenes, shipments, webhooks, reclamos, etc.)
│  └─ mockups/prompts/ (41 prompts de imagen por pantalla)
│
├─ supabase/
│  └─ migrations/     (13 migraciones idempotentes, ver sección C)
│
├─ scripts/          (validacion-dte-openfactura.mjs, validacion-pagos-fintoc.mjs,
│                     validacion-firma-webhook-fintoc.mjs, metricas-plataforma.sql)
│
└─ src/
   ├─ app/                         (Next.js App Router)
   │  ├─ (tenant)/                 área courier (dueño/supervisor/coordinador/admin)
   │  │  ├─ dashboard/
   │  │  ├─ operaciones/           pedidos, detalle, incidencias, same-day, etiquetas
   │  │  ├─ manifiestos/           crear, asignar, confirmar/cancelar
   │  │  ├─ dinero/                periodos, periodo-detalle, conciliacion,
   │  │  │                         liquidaciones, cobranza
   │  │  ├─ onboarding/            dte, folios, tarifas, cobranza
   │  │  ├─ sellers/, equipo/, configuracion/exportar-datos/
   │  ├─ portal/                   portal del seller (login, pedidos, cobros, incidencias,
   │  │                            conectar-ml, bienvenida)
   │  ├─ conductor/                PWA conductor (manifiesto del día, paradas, liquidaciones)
   │  ├─ login/, registro/, activar-cuenta/, invitacion/[token]/
   │  ├─ oauth/ml/callback/        callback OAuth de ML
   │  └─ api/
   │     ├─ inngest/               endpoint de jobs
   │     ├─ webhooks/ml/shipments/ webhook de envíos ML
   │     ├─ webhooks/fintoc/       webhook de pagos (cobranza)
   │     ├─ operaciones/[pedidoId]/etiqueta/   descarga de etiqueta ML
   │     └─ courier/exportar-datos/            exportación de datos (RNF-13)
   │
   ├─ components/   (app-shell, ui/ shadcn, dinero, onboarding, pwa)
   ├─ lib/          (supabase/{client,server,service-role}, inngest/{cliente,eventos},
   │                 ui/{formato-moneda,comunas-rm}, identidad, rate-limit, avisos, validacion)
   │
   └─ modules/      (NÚCLEO DE NEGOCIO)
      ├─ identidad/      roles, capacidades (RBAC), onboarding, invitaciones, rut,
      │                  usuario-actual, auditoria, errores
      ├─ operacion/      pedidos, maquina-estados, manifiestos, incidencias, metricas,
      │                  orden-paradas, tipos, jobs/
      ├─ dinero/         motor.ts, acciones.ts, jobs/ (generar-lineas, conciliar-periodo,
      │                  cerrar-periodo, emitir-dte-periodo, generar-liquidacion-conductor,
      │                  polling-estado-dte, alerta-folios-proximos)
      └─ integraciones/  (adaptadores aislados)
         ├─ ml/          oauth, cliente-http, traduccion-estados, etiquetas,
         │               jobs/ (procesar-shipment, refrescar-tokens, sondeo-salud,
         │                      polling-estados)
         ├─ dte/         puerto.ts + adaptadores/ (simplefactura sandbox; Openfactura skeleton)
         ├─ pagos/       fintoc/ (cobranza courier→seller)
         ├─ secretos/    cifrado de certificados/tokens (separado del negocio)
         └─ notificaciones/ conexion-caida
```

---

## C. Modelos de datos existentes

PostgreSQL, 4 schemas. **Toda tabla de negocio lleva `tenant_id` + RLS.** 13 migraciones
idempotentes en `supabase/migrations/`.

### Schema `identidad` (auth, tenants, RBAC, onboarding, secretos)
| Tabla | Para qué |
|-------|----------|
| `tenants` | El courier. Raíz del aislamiento multi-tenant. |
| `usuarios_perfil` | Usuarios internos del courier (perfil sobre auth.users). |
| `sellers` | Sellers del courier (clientes a los que factura). |
| `conductores` | Conductores. Incluye `tipo_relacion_conductor` = `dependiente` \| `independiente`. |
| `invitaciones` | Altas por invitación (equipo interno y sellers). |
| `tarifas` | Tarifas por entrega. `modo_calculo` = `monto_fijo` \| `por_zona`; `tipo_entrega` = `flex` \| `same_day`. |
| `conexiones_seller_ml` | Conexión OAuth de ML por seller + estado de salud. |
| `courier_config_dte` | Config DTE del courier, incl. `emision_dte_real_habilitada` (opt-in). |
| `courier_config_cobranza` | Config de cobranza (PSP Fintoc). |
| `folios_caf` | Folios CAF para emisión DTE. |
| `secretos_cifrados` | Certificados/tokens cifrados, separados del negocio. |
| `bitacora_auditoria` | Bitácora de toda acción financiera y de acceso (RNF-04, el "quién"). |

### Schema `operacion` (pedidos, manifiestos, estados, incidencias)
| Tabla | Para qué |
|-------|----------|
| `pedidos` | Pedidos Flex + same-day. `tipo_pedido` = `flex` \| `same_day`; `origen_pedido` = `ml_ingesta` \| …; máquina de estados. |
| `manifiestos` | Manifiesto del día por conductor. |
| `asignaciones_pedido` | Pedido ↔ manifiesto/conductor. |
| `incidencias` | Incidencias de entrega (alimentan reglas del motor de dinero). |
| `evidencias_incidencia` | Evidencias adjuntas a una incidencia. |
| `intentos_backfill` | Reintentos de ingesta/backfill al reconectar ML. |

### Schema `dinero` (motor entrega→dinero, facturación, conciliación)
| Tabla | Para qué |
|-------|----------|
| `lineas_cobro` | Línea de cobro al seller por entrega (lado izquierdo del motor). |
| `lineas_liquidacion` | Línea de liquidación al conductor por entrega (lado derecho). |
| `periodos_cobro` | Período de facturación. `estado_periodo` = `abierto`→`cerrado`→`facturado`. |
| `config_periodos` | Configuración de períodos (`tipo_periodo`). |
| `documentos_dte` | DTE emitido (factura/nota de crédito). `estado_sii`. |
| `liquidaciones` | Liquidación consolidada del conductor. `estado_liquidacion`. |
| `eventos_conciliacion` | Conciliación entregado-vs-facturado. `tipo_diferencia`, `estado_evento`. |
| `pagos_recibidos` | Pagos del seller (cobranza Fintoc). `estado_match_pago`. |

### Schema `infra`
| Tabla | Para qué |
|-------|----------|
| (rate limit) | Soporte de rate limiting (`20260612000001_infra_rate_limit.sql`). |

### Enums Postgres principales
- **identidad:** `rol_usuario`, `tipo_usuario`, `estado_tenant`, `estado_usuario`,
  `estado_seller`, `estado_conductor`, `tipo_relacion_conductor` (`dependiente`/`independiente`),
  `tipo_entrega` (`flex`/`same_day`), `modo_calculo_tarifa` (`monto_fijo`/`por_zona`),
  `estado_salud_conexion_ml`, `estado_certificacion_dte`, `estado_folio_caf`,
  `estado_invitacion`, `tipo_secreto`, `actor_tipo_auditoria`.
- **operacion:** `tipo_pedido` (`flex`/`same_day`), `origen_pedido`, `estado_pedido`,
  `estado_manifiesto`, `tipo_incidencia`, `estado_incidencia`.
- **dinero:** `estado_periodo`, `tipo_periodo`, `estado_sii`, `estado_liquidacion`,
  `estado_match_pago`, `estado_evento_conciliacion`, `tipo_diferencia_conciliacion`,
  `origen_generacion`.
