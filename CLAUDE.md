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

## Comandos
(Ajusta tras el scaffold; mantén esta sección al día — es la de mayor valor para el agente.)
- Dev: `npm run dev`
- Build: `npm run build`
- Lint / typecheck: `npm run lint`
- Tests: `npm test` — debe incluir pruebas de aislamiento (RLS) y de reglas de dinero
- Base de datos: migraciones versionadas e idempotentes (Supabase CLI o el flujo elegido). Nada de DDL crudo fuera de migraciones.

## Datos y tipo de información
Modelo de datos (alto nivel): el tenant es el courier; cada courier tiene sellers, conductores, pedidos (Flex + same-day), tarifas, incidencias y los documentos de dinero (líneas de cobro/liquidación, facturas DTE, liquidaciones, conciliación). Toda tabla de negocio lleva `tenant_id`.

Clasificación de sensibilidad (define cómo se trata cada dato):
- Secretos (cifrados, fuera de logs y URLs, separados del negocio): certificados digitales del courier, tokens OAuth de ML, credenciales de proveedores (DTE, pagos).
- Datos personales (minimización + consentimiento): datos del conductor (Ley 21.431) y del destinatario.
- Datos financieros (relevantes para el SII): bitácora de auditoría + respaldo; no se pierden ni se exponen entre tenants.

## Stack
- TypeScript end-to-end. Monolito modular (no microservicios).
- Frontend: Next.js (React) + Tailwind + shadcn/ui.
- Datos: PostgreSQL con Row-Level Security (RLS). Backend: Supabase (Postgres + Auth + Storage + RLS + funciones).
- Jobs en segundo plano: orquestador gestionado (Inngest/Trigger.dev o cron de Supabase).
- App de conductor: PWA en MVP; nativa (Expo) en V2.
- Hosting: Vercel + Supabase.
- Integraciones como adaptadores aislados (un "puerto" por servicio: ML, DTE, pagos).

## Orden de construcción (MVP en fases)
- A. Cimiento: multi-tenant + RLS, RBAC, onboarding del courier (certificado + proveedor DTE + folios), tarifas, OAuth del seller + refresco de tokens.
- B. Operación: ingesta Flex + panel multi-seller, same-day ad-hoc, asignación + manifiesto, estados, incidencias, salud de conexiones + reconexión + backfill, dashboard del dueño, vista de conductor, portal del seller.
- C. Motor entrega→dinero: líneas de cobro/liquidación, reglas de incidencia, conciliación, facturación DTE, liquidación de conductores.

## Orquestación (cómo enrutar el trabajo)
Esta sesión principal coordina y delega; los subagentes NO se llaman entre sí (delegación de un solo nivel). Antes de actuar, lee este mapa y delega al agente correcto:
- Decisión estructural, modelo de datos o contratos entre módulos → `arquitecto`
- Esquema, migraciones o políticas RLS → `base-datos-rls`
- Lógica de servidor, endpoints, jobs y motor entrega→dinero → `backend`
- Cualquier integración externa (ML, DTE, pagos) → `integraciones`
- Pantallas y componentes → `frontend` (los flujos los define antes `ux-ui`)
- Pruebas tras cada feature, sobre todo aislamiento y dinero → `qa`
- Textos de interfaz, alertas y correos → `copywriter`
- Auditoría de seguridad y cumplimiento antes de cada release → `seguridad-cumplimiento`
- Despliegue, variables de entorno, secretos y monitoreo → `devops`

Secuencia por feature: `arquitecto` → `base-datos-rls` → `backend`/`integraciones` → `frontend` → `qa`.
Respeta el orden de fases A → B → C de arriba; no saltes de fase sin cerrar la anterior.

## Skills del proyecto (aplícalas cuando corresponda)
flex-ml · chile-dte · multitenant-rls · motor-entrega-dinero · pagos-chile
Antes de tocar integraciones externas, dinero o esquema de BD, carga la skill correspondiente.

## Referencias (detalle completo — no pegar aquí)
Convierte estos documentos a Markdown en `docs/` para que el `@`-referencing funcione:
- `@docs/levantamiento.md` — especificación completa: RF-001..RF-051, requerimientos no funcionales, usuarios y permisos, procesos AS-IS→TO-BE, arquitectura, roadmap, riesgos y plan de agentes/skills.
- `@docs/informe-mercado.md` — contexto de mercado, competidores, modelo de negocio y TAM/SAM/SOM.
