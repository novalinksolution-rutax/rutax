# Proyecto: SaaS de gestión operativo-financiera para couriers (Mercado Libre Flex · Santiago)

## Qué es
SaaS B2B vertical, neutral y multi-tenant. Lo usan empresas de última milla (couriers) para operar entregas Flex + same-day y cerrar su trastienda de dinero (facturar a sellers, liquidar conductores, conciliar). El fundador NO opera entregas; solo provee el software.

## Diferenciador y alcance del producto (no perderlo de vista)
Rutax es una **capa de operación unificada** para couriers: centraliza pedidos de distintas fuentes y los despacha desde una sola app (la del conductor), y además cierra su trastienda de dinero.
- **Diferenciador (el foso):** el motor entrega→dinero — cada entrega genera, sola, su línea de cobro al seller y su línea de liquidación al conductor, conciliadas. Ahí va el esfuerzo de innovación.
- **Producto completo (no negociable):** el resto del servicio — operación, manifiestos, portales (seller, conductor) y reportería — debe ser **excelente como mesa**, no mínimo. Diferenciador ≠ producto completo: el foco de la innovación es el motor de dinero, pero la calidad del resto NO es opcional.
- **Ruteo:** no construimos un optimizador de rutas como diferenciador (está commoditizado, hay especialistas); sí orquestamos la operación. Un optimizador queda "Más adelante" (ver Alcance), no descartado de plano.
- **Multi-fuente:** la visión es centralizar pedidos de varias fuentes (hoy MELI/Flex + same-day; Shopify/WooCommerce y otras quedan "Más adelante"). El núcleo se diseña **agnóstico de la fuente**, aunque el refactor de generalización no se hace todavía.

## Restricción dura (POD por fuente)
Para pedidos **Flex**, la app de escaneo/POD de Mercado Envíos es obligatoria y NO es integrable: Rutax orquesta alrededor de ella y nunca la reemplaza; el POD de Flex es la verdad y la evidencia capturada en Rutax es informativa. Para las demás fuentes (same-day hoy; otras "Más adelante") NO hay app externa obligatoria, así que el POD capturado en Rutax es el **autoritativo** y es el que dispara la línea entrega→dinero. En consecuencia, el gatillo de "entregado" difiere por fuente. Para Flex el conductor usa dos apps; para el resto, solo Rutax.

## Reglas no-negociables (el contrato)
- El aislamiento entre couriers (tenants) y del seller SE IMPONE EN LA BASE DE DATOS vía RLS, no solo en la app. Toda tabla **de negocio** lleva tenant_id. Existe un carve-out acotado para **datos de referencia** — esquemas `infra` y `contexto` — que deben cumplir las TRES condiciones: (a) su contenido es público o de infraestructura, sin un solo dato de courier, seller, conductor o destinatario; (b) su cardinalidad no cambia al dar de alta un tenant; (c) solo `service_role` las escribe. Esas tablas son **deny-all para sesiones de usuario**: RLS forzada sin políticas, sin vista espejo en `public`, `GRANT` solo a `service_role`. **Test mecánico para revisión: si dar de alta un courier agrega filas, la tabla es de negocio y lleva tenant_id. Sin discusión.** Ojo con el caso mixto: un tipo que mezcla un hecho público con cifras del courier (p. ej. una noticia y "cuántos pedidos tuyos toca") se desdobla en dos tablas, porque dejar la cifra en la fila global la filtra a todos los demás tenants.
- El seller solo ve sus propios datos; el conductor solo los suyos.
- Certificados digitales y tokens (ML, etc.) cifrados; NUNCA en logs, en texto plano ni en URLs.
- Toda acción financiera y de acceso queda en bitácora de auditoría.
- Procesos pesados (ingesta, facturación, liquidación, estados) corren como jobs idempotentes con reintentos, no en el request del usuario.
- Localización Chile: CLP, español, zona horaria de Santiago, validación de RUT.
- NO introducir microservicios ni colas propias (decisión arquitectónica permanente, no por fase). El optimizador de ruteo y las fuentes de pedidos adicionales NO se construyen ahora (están en "Más adelante", ver Alcance). La IA NO está prohibida: se evalúa caso a caso contra el gate de IA (ver Invariantes), nunca se descarta de plano.

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
- `operacion` — pedidos (con su fuente de origen — hoy Flex + same-day; más fuentes "Más adelante"), ingesta, asignación, manifiestos, estados, incidencias.
- `dinero` — motor entrega→dinero, facturación DTE, liquidaciones, conciliación, cobranza.
- `integraciones` — adaptadores aislados (un "puerto" por servicio). Hoy: ML/Flex, DTE, pagos, geocoding y contexto externo (clima, aire, calendario); el diseño admite más fuentes de pedidos "Más adelante" (incluida escritura de vuelta de estado/tracking cuando la fuente lo requiera). El núcleo NO llama APIs externas directo.
- `plataforma` — backstage de Rutax: suscripción del courier al SaaS, planes, cobro, dunning, impersonation auditada. Es Rutax cobrándole al courier, distinto del motor entrega→dinero (courier→seller).
- `contexto` — Torre de control: anticipación operativa. Motor de riesgo por zona, composer de la pantalla, calendario comercial y señales. **Límite duro: `operacion` y `dinero` NO pueden llamar a `contexto`, nunca al revés.** La capa de anticipación depende del núcleo operativo; si algún día un puntaje de riesgo quisiera alterar cómo se genera una línea de dinero, eso es una decisión nueva, no un atajo.

Convenciones de rutas en `src/app/` (Next.js App Router, App Router groups):
- `(tenant)/` — área autenticada de roles internos del courier (dueño, supervisor, coordinador, administración). Layout único `(tenant)/layout.tsx` con navegación condicionada por capacidad RBAC. Todas las pantallas nuevas del courier (operación, manifiestos, dinero, configuración, onboarding, equipo, sellers) van aquí.
- `portal/` — portal del seller (login propio en `portal/login`, pedidos, cobros con descarga de factura PDF, incidencias).
- `conductor/` — vista del conductor (manifiesto del día, liquidaciones); es la superficie operativa unificada del conductor para todas las fuentes. PWA aquí + app nativa Expo aparte (ver Stack).
- `login/` — login de usuarios internos del courier.
- `(app)/` — grupo heredado de Fase A, reemplazado por `(tenant)`. No agregar pantallas nuevas ahí; está pendiente de limpieza.
- `api/courier/*`, `api/operaciones/*` — endpoints de descarga/exportación (etiqueta ML, exportación de datos RNF-13). Mismo gating RBAC que la pantalla equivalente.

## Comandos
(Mantén esta sección al día — es la de mayor valor para el agente.)
- Dev: `npm run dev` (Next.js + Turbopack)
- Build: `npm run build`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Tests: `npm test` (Vitest — pruebas unitarias del lado servidor: RBAC, onboarding/invitaciones, cifrado de secretos, adaptador OAuth ML, reglas de dinero; conviven junto a su código fuente como `*.test.ts`, ver `vitest.config.ts`). `npm run test:watch` para modo watch. Las pruebas de aislamiento RLS viven aparte, en pgTAP (`supabase/tests/database/`, vía `npx supabase test db`).
- Base de datos: migraciones versionadas e idempotentes en `supabase/migrations/` (Supabase CLI). Nada de DDL crudo fuera de migraciones.
- Entorno local/staging: ver `docs/PRUEBA.md` para arranque completo (Supabase local, `npx supabase db seed` carga `supabase/seed.sql` con datos de demo de un solo tenant, Inngest Dev Server, credenciales de demo). Úsalo para QA funcional antes de marcar un ítem del checklist como hecho.
- Variables de entorno: copia `.env.example` a `.env.local` y completa las claves de Supabase (Settings > API). Nunca commitees `.env.local`.

## Datos y tipo de información
Modelo de datos (alto nivel): el tenant es el courier; cada courier tiene sellers, conductores, pedidos (con su fuente de origen — hoy Flex + same-day), tarifas, incidencias y los documentos de dinero (líneas de cobro/liquidación, facturas DTE, liquidaciones, conciliación). Toda tabla de negocio lleva `tenant_id`. Un seller puede tener hasta 3 cuentas de Mercado Libre conectadas (el esquema actual es 1:1; su paso a 1:N es trabajo próximo — ver Alcance).

Clasificación de sensibilidad (define cómo se trata cada dato):
- Secretos (cifrados, fuera de logs y URLs, separados del negocio): certificados digitales del courier, tokens OAuth de ML, credenciales de proveedores (DTE, pagos).
- Datos personales (minimización + consentimiento): datos del conductor (Ley 21.431) y del destinatario.
- Datos financieros (relevantes para el SII): bitácora de auditoría + respaldo; no se pierden ni se exponen entre tenants.

## Stack
- TypeScript end-to-end. Monolito modular (no microservicios).
- Frontend: Next.js (React) + Tailwind + shadcn/ui.
- Datos: PostgreSQL con Row-Level Security (RLS). Backend: Supabase (Postgres + Auth + Storage + RLS + funciones).
- Jobs en segundo plano: orquestador gestionado — **Inngest** (canónico en el repo: ver `src/lib/inngest/` y `api/inngest`). No introducir colas propias.
- App de conductor: PWA + app nativa Expo (esta última ya existe, en `Desktop/rutax-conductor`, con API routes Bearer en Next.js); es la superficie operativa unificada del conductor para todas las fuentes.
- Hosting: Vercel + Supabase.
- Integraciones como adaptadores aislados (un "puerto" por servicio: ML/Flex, DTE, pagos; más fuentes "Más adelante").

## Invariantes y convenciones transversales (no perderlas al extender)
- **Compuerta de aprobación de facturación (NO auto-emitir DTE)**: emitir un DTE es irreversible ante el SII sin nota de crédito (RF-038, fuera del MVP). Ningún proceso automático (cron) emite facturas. El cron `cerrar-periodo` SOLO cierra (`abierto`→`cerrado`) y dispara `dinero/periodo.cerrado`, que activa únicamente la conciliación (C6, detective, de solo lectura). La emisión (`cerrado`→`facturado`) exige la acción humana `emitirFacturaPeriodo` (gate `puedeEmitirFacturas`), que publica `dinero/periodo.emision-solicitada` → C3. No re-acoplar la emisión al cierre.
- **Bitácora antes que efectos externos, y con autor**: cualquier acción financiera o de acceso se registra en `bitacora_auditoria` ANTES de publicar un evento Inngest o llamar a una integración externa, así la auditoría queda completa aunque el paso siguiente falle. Toda acción financiera de un usuario lleva su `actorUsuarioId` (`sesion.usuarioId`, el UUID de auth) — RNF-04 exige el "quién". Patrón de referencia: `emitirFacturaPeriodo`/`cerrarPeriodoManualmente` en `src/modules/dinero/acciones.ts`.
- **Eventos Inngest tipados**: los contratos de eventos del motor entrega→dinero viven en `src/lib/inngest/eventos.ts` (`dinero/periodo.cerrado` → solo conciliación; `dinero/periodo.emision-solicitada` → solo emisión DTE). Todo evento nuevo del motor se define ahí antes de emitirse o consumirse.
- **Adaptador DTE en modo sandbox + opt-in real**: `src/modules/integraciones/dte/adaptadores/simplefactura.ts` corre con `DTE_SANDBOX_MODE=true` y NO emite DTEs reales al SII. La emisión real exige, además, opt-in explícito por courier (`identidad.courier_config_dte.emision_dte_real_habilitada`, default `false`). No cambiar a modo real sin decisión explícita del usuario y revisión de `seguridad-cumplimiento`. El adaptador real candidato (Openfactura) tiene un esqueleto validado en `docs/arquitectura/validacion-dte-openfactura.md`.
- **Gate de IA (la IA se evalúa, no se prohíbe)**: una funcionalidad con IA se aprueba solo si cumple TODO — (1) resuelve un problema real de operación o dinero reduciendo errores/tiempo, con caso de uso concreto; (2) no es optimización/planificación de rutas (eso va por su vía, "Más adelante"); (3) no pone en piloto automático ninguna acción irreversible (emisión DTE, pagos) — la IA sugiere, un humano aprueba; (4) privacidad: si procesa datos personales (destinatario, conductor — Ley 21.431) o toca secretos/tokens, `seguridad-cumplimiento` valida qué datos salen al LLM (minimización; nunca secretos/tokens; PII solo lo imprescindible); (5) es asistencia vía API de LLM gestionada, no infraestructura (sin entrenamiento ni modelos propios servidos) ni dependencia dura del camino crítico. Evalúan `arquitecto` (¿se vuelve infra/dependencia?) y `seguridad-cumplimiento` (privacidad); aprueba la sesión principal.
- **Helpers de UI compartidos**: formato de moneda CLP, traducción/colores de estados y catálogo de comunas RM viven en `src/lib/ui/`. Reusarlos en vez de duplicar lógica de presentación entre `(tenant)`, `portal` y `conductor`.
- **Checklist de pruebas funcionales**: `checklist-pruebas-funcionales-mvp.md` (raíz) registra el estado de cada RF/escenario E2E. Actualízalo (`[x]`/`[ ]`/`N/A` + nota) después de implementar y probar cada feature — es la fuente de verdad de "qué falta".

## Alcance del proyecto (taxonomía: Permanente · En alcance · Más adelante · No-va)
Proyecto **maduro**: la base está construida. Ya NO razonamos en "MVP/V2" sino con esta taxonomía. (El histórico de fases A→B→C queda abajo como referencia de lo ya hecho.)

**En alcance (activo / próximo):**
- Foco activo de innovación: precisión y robustez del motor entrega→dinero sobre **same-day + MELI/Flex**.
- Calidad de mesa del servicio completo: operación, manifiestos, portales y reportería deben ser excelentes (diferenciador ≠ producto completo).
- **Seller con hasta 3 cuentas ML** (próximo trabajo concreto): hoy el esquema `identidad.conexiones_seller_ml` es **1:1** (unique en `seller_id`); pasar a 1:N con tope 3, iterar el pipeline ML (refresco de tokens, polling, backfill, procesar-shipment) **por conexión**, registrar la cuenta de origen (`ml_user_id`) en el pedido y mostrarla en la UI **solo si el seller tiene más de una**. Evitar conectar dos veces la misma cuenta.
- **Prioritario** (deja de ser "pendiente opcional"): observabilidad/Sentry y disponibilidad/respaldos (devops) — ya es un pasivo con datos reales, no un "nice to have".

**Más adelante (dirección declarada, no ahora):**
- Fuentes de pedidos adicionales (Shopify, WooCommerce, otras) y la generalización source-neutral del núcleo.
- Secuenciación operativa de manifiestos multi-fuente y optimizador de rutas.
- Emisión real de DTE (opt-in por courier + revisión de seguridad) y notas de crédito (RF-038).
- Multi-país / multi-moneda (hoy Chile-only).

**No-va (permanente):**
- Microservicios, colas propias, reemplazar la app/POD de Flex, y auto-emitir DTE irreversible (la emisión siempre con gate humano).

**Histórico — ya construido (Fases A→B→C, verificadas con datos de demo; DTE en sandbox, no real):**
- A. Cimiento: multi-tenant + RLS, RBAC, onboarding del courier (certificado + proveedor DTE + folios), tarifas, OAuth del seller + refresco de tokens.
- B. Operación: ingesta Flex + panel multi-seller, same-day ad-hoc, asignación + manifiesto, estados, incidencias, salud de conexiones + reconexión + backfill, dashboard del dueño, vista de conductor (PWA + Expo), portal del seller.
- C. Motor entrega→dinero: líneas de cobro/liquidación, reglas de incidencia, conciliación, facturación DTE (sandbox), liquidación de conductores.

## Orquestación (cómo enrutar el trabajo)
Esta sesión principal coordina y delega; los subagentes NO se llaman entre sí (delegación de un solo nivel). Antes de actuar, lee este mapa y delega al agente correcto:
- Decisión estructural, modelo de datos o contratos entre módulos → `arquitecto`
- Esquema, migraciones o políticas RLS → `base-datos-rls`
- Lógica de servidor, endpoints, jobs y motor entrega→dinero → `backend`
- Cualquier integración externa (fuentes de pedidos como ML/Flex, DTE, pagos) → `integraciones`
- Pantallas y componentes → `frontend` (los flujos los define antes `ux-ui`)
- Pruebas tras cada feature, sobre todo aislamiento y dinero → `qa`
- Textos de interfaz, alertas y correos → `copywriter`
- Auditoría de seguridad y cumplimiento antes de cada release → `seguridad-cumplimiento`
- Despliegue, variables de entorno, secretos y monitoreo → `devops`

Secuencia por feature: `arquitecto` → `base-datos-rls` → `backend`/`integraciones` → `frontend` → `qa`.
Las fases A→B→C ya están construidas (ver Alcance/Histórico); su orden fue disciplina de arranque, no una restricción que bloquee trabajo transversal de mejora del servicio.

## Skills del proyecto (aplícalas cuando corresponda)
flex-ml · chile-dte · multitenant-rls · motor-entrega-dinero · pagos-chile
Antes de tocar integraciones externas, dinero o esquema de BD, carga la skill correspondiente.

## Referencias (detalle completo — no pegar aquí)
Convierte estos documentos a Markdown en `docs/` para que el `@`-referencing funcione:
- `@docs/levantamiento.md` — especificación completa: RF-001..RF-051, requerimientos no funcionales, usuarios y permisos, procesos AS-IS→TO-BE, arquitectura, roadmap, riesgos y plan de agentes/skills.
- `@docs/informe-mercado.md` — contexto de mercado, competidores, modelo de negocio y TAM/SAM/SOM.
- `@docs/arquitectura/fase-a-cimiento.md`, `@docs/arquitectura/fase-b-operacion.md`, `@docs/arquitectura/fase-c-dinero.md` — decisiones de arquitectura por fase (modelo de datos, RLS, contratos entre módulos).
- `@docs/ux/fase-a-onboarding.md`, `@docs/ux/fase-b-operacion.md`, `@docs/ux/fase-c-dinero.md` — flujos y wireframes conceptuales por fase.
- `@docs/PRUEBA.md` — guía de arranque del entorno local/staging y datos de demo (un solo tenant).
- `@checklist-pruebas-funcionales-mvp.md` — checklist de pruebas funcionales del MVP; mantenerlo al día.

## Torre de control — el diseño ya existe, úsalo

El módulo **Torre de control** tiene una propuesta de interfaz completa y aprobada en `design_handoff_torre_de_control/`. **Antes de escribir una línea de UI de este módulo, lee `design_handoff_torre_de_control/README.md`.** No diseñes desde cero y no infieras el layout desde los tipos.

Qué hay ahí:
- `README.md` — especificación completa: tokens exactos, las 7 reglas de producto, layout de las 6 regiones, geometría del mapa con su proyección, los 6 estados de `EstadoPantalla` con sus copys literales, atajos de teclado, forma del estado y estados de los controles.
- `tokens.css` — los tokens listos para pegar como capa `@theme` de Tailwind 4.
- `capturas/` — cómo se ve cada pantalla. Referencia visual rápida.
- `Torre de control.dc.html` — el prototipo **interactivo**. Ábrelo en el navegador para ver el comportamiento real (selección de zona, tope de capas, ⌘K, teclas). Los HTML son **referencias de diseño**, no código para copiar: hay que recrearlos en Next + Tailwind + shadcn.

Tres cosas que no se negocian y que se rompen fácil por descuido:
1. **Este módulo tiene lenguaje visual propio.** Fue diseñado con instrucción explícita de **no** usar `DESIGN_SYSTEM.md` ni `docs/torre-de-control/lenguaje-visual.md`. Los tokens que manda son los de `tokens.css`. Radio 0 en todo. El rojo `#ec3013` está **reservado** para lo crítico y accionable — nunca decorativo.
2. **Los datos salen solo de `docs/torre-de-control/estructura.md` y `datos-dummy.ts`.** Sus tipos son el contrato del endpoint. No inventes campos ni datos de relleno.
3. **Las 7 reglas de producto del README** (jerarquía de tres niveles, tope de 2 capas, silencio por defecto, el color nunca solo, contador de sin ubicar, cifras tabulares, equivalente sin mapa) son de producto, no estéticas. Están en §2 del README.

Diseño técnico del módulo (esquema `contexto`, adaptadores, jobs, motor de riesgo, calendario comercial y señales de prensa): `@docs/arquitectura/torre-de-control.md`.

### Decisiones de implementación que se apartan de los documentos (2026-07-26)
Los documentos siguen mandando salvo en estos puntos, donde el usuario decidió otra cosa o la realidad los desmintió. Si un documento te dice lo contrario de lo que sigue, esto gana:

- **Mapa: MapLibre + PMTiles**, no el SVG geométrico del handoff (§8.8 del diseño técnico planteaba ambas; el usuario eligió MapLibre por orientación urbana). Geometría comunal **DPA 2023 real**, no el placeholder Voronoi. **Basemap acromático mínimo**: agua, áreas verdes y ejes principales en gris de contraste muy bajo, sin etiquetas de lugar ni relieve. Consecuencia: R3 no es pixel-perfect al handoff, y las tramas de riesgo de 45° van como **sprites a DPR 2** — las capas `fill` de MapLibre no aceptan `<pattern>` SVG.
- **§4 del diseño técnico se equivocaba con las fuentes.** Open-Meteo **no sirve**: su tier libre prohíbe uso comercial y define como comercial "apps con suscripciones". Se reemplazó por **MMA/SINCA para aire** (es quien decreta los episodios) y **OpenWeather para clima** (permite SaaS comercial a cambio de **atribución visible en pantalla**, que el handoff no previó). La DMC se evaluó y no sirve: publica observaciones, no pronóstico. Muestrear las 52 comunas es sobre-muestrear: van ~10 puntos de grilla y cada comuna toma el más cercano.
- **Umbrales PM2.5 reales** (Plan Operacional GEC 2026 del MMA): Alerta 80 · Preemergencia 110 · Emergencia 170, sobre la **media móvil de 24 h**, no sobre la hora suelta. Los del `datos-dummy.ts` están mal — **el dummy es contrato de tipos, no de valores.**
- **`EstadoTorre` se envuelve** en `TorreRespuesta { horizonteInicial, horizontes: Record<'hoy'|'manana'|'72h', EstadoTorre> }` (aditivo, el tipo congelado queda intacto). `olas` no va ahí. **A 72 h se cuentan solo pedidos ya ingestados, nunca una proyección**: se verá casi vacío, y es correcto.
- **RBAC**: capacidad `ver_torre_control` (dueño, supervisor, coordinador — no administración). Es de lectura: no habilita ninguna acción irreversible.
