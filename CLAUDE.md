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
- `(consola)/` — **EN RETIRO (2026-08-03).** Grupo de tableros a pantalla completa, fuera del `AppShell`. Su único ocupante era la Torre de control, que baja a `(tenant)` en el rediseño v2; con ella se retira el grupo entero. **No agregues nada aquí.** La regla no tiene excepciones: toda pantalla del courier va en `(tenant)`.
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
- ~~**Seller con hasta 3 cuentas ML**~~ — **HECHO** (verificado 2026-08-02). El esquema es 1:N con tope 3 impuesto por trigger, unicidad `(seller_id, ml_user_id)`, los cinco jobs del pipeline iteran por conexión, el pedido guarda su `ml_user_id` y la UI muestra la cuenta de origen solo si el seller tiene más de una. Detalle y evidencia en `docs/arquitectura/seller-multicuenta-ml.md` §9.
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

## Torre de control — rediseño v2 (alcance aprobado 2026-08-03)

El módulo **Torre de control** es la pantalla de monitoreo del día del courier. Hoy el código vive en `src/app/(consola)/torre-de-control/` (UI) y `src/modules/contexto/` (composer y agregación), con sus adaptadores en `src/modules/integraciones/contexto/`. **En la v2 la pantalla se muda a `(tenant)` y el grupo `(consola)` se retira entero** — ver abajo.

**Qué es en una frase:** el courier opera same-day contra un corte de ~21–22 h; el dueño y el coordinador entran un par de minutos, varias veces al día, a ver **cuántos paquetes faltan por entregar, en qué comunas, y si algo se está atascando**. El contador baja durante el día; una entrega fallida pinta su punto en rojo y aparece como incidencia. **La Torre no ejecuta: lee y enlaza.**

**Lee `@docs/torre-de-control/alcance-v2.md` antes de tocar este módulo.** Es la fuente de verdad: las 12 funcionalidades que quedan, lo que se retira y por qué, las 6 reglas de producto y las consecuencias técnicas.

**El handoff de diseño dejó de mandar** (2026-08-03). `design_handoff_torre_de_control/` era la interfaz aprobada y la referencia obligatoria: sus 7 reglas, sus 6 regiones, sus tokens y sus copys ya **no** son autoridad. Está archivado en `docs/_historico/torre-v1/` — se conserva porque explica por qué el código de hoy es como es, no para seguirlo. Con él cae el "contrato congelado" de tipos: `src/modules/contexto/contrato-torre.ts` es un tipo **vivo y editable**.

Cuatro decisiones de la v2 que se rompen fácil por descuido:
1. **La unidad primaria es la COMUNA, no la zona.** El zoom es semántico en tres niveles: comuna → agrupaciones → punto de entrega individual. Las zonas del courier siguen existiendo detrás (ventana de corte, conductores, capacidad), pero no mandan el mapa.
2. **La cifra es una magnitud, nunca un índice.** "38 de 120 pendientes", no "73 de riesgo". El puntaje 0–100 y sus seis factores se retiran enteros, y con ellos **clima y aire salen del producto**: se apagan jobs, adaptadores de OpenWeather, la grilla de 14 puntos, las tablas `clima_horario`/`aire_horario` y la atribución de OpenWeather.
3. **El rojo está reservado a la incidencia abierta.** Es lo único accionable de la pantalla; nada decorativo puede usarlo.
4. **La Torre es de solo lectura.** `ver_torre_control` sigue siendo capacidad de lectura y no hay bitácora nueva. Cualquier propuesta de que la Torre escriba reabre RBAC y auditoría: es una decisión nueva, no un atajo.

⚠️ **La v2 NO amplía la exposición de datos personales, y así se queda.** En el punto de entrega se muestra el **código de envío** —`ml_shipment_id` en Flex, `codigo_interno` (`RX-XXXX-XXXX`) en same-day—, nunca la dirección ni el nombre del destinatario. **Nunca `tracking_token`**: ese es público y viaja en la URL `/tracking/[token]` que se comparte con el destinatario. Y no se guarda recorrido del conductor: sigue habiendo una sola fila por conductor, la última posición, sin histórico (Ley 21.431). Volver a proponer la dirección en el mapa **sí** reabre la revisión de `seguridad-cumplimiento`.

Documentos técnicos:
- `@docs/arquitectura/torre-de-control.md` — esquema `contexto` con su carve-out deny-all, puertos, jobs y cadencias, pipeline de cartografía. Sus secciones de pantalla (§8), fuentes (§4) y señales de prensa (§13) están marcadas como superadas.
- `@docs/arquitectura/mapa-torre-v2.md` — qué tecnología cartográfica y por qué. **Resuelto: se conserva MapLibre + PMTiles auto-hospedado y el trabajo va en encender etiquetas y re-estilar.** Los cuatro proveedores de tiles alojados evaluados prohíben el uso comercial en su tier gratuito (la trampa de Open-Meteo, otra vez), y la medición demuestra que el mapa actual no es lento: es mudo.
- `docs/torre-de-control/README.md` — mapa de dónde quedó cada cosa.

### Decisiones de implementación que se apartan de los documentos (revisadas 2026-08-03)
Los documentos siguen mandando salvo en estos puntos, donde el usuario decidió otra cosa o la realidad los desmintió. Si un documento te dice lo contrario de lo que sigue, esto gana:

- **Mapa: MapLibre + PMTiles.** Geometría comunal **DPA 2023 real**. Sigue vigente y **ratificado** por `mapa-torre-v2.md`: no se cambia de proveedor. Lo que cambia con la v2 es el estilo — el basemap acromático **sin etiquetas** era una imposición del handoff («el basemap no es el mapa») y se revierte: la v2 **enciende etiquetas** (calle y comuna) porque hay que llegar hasta el punto de entrega y leer su dirección. Requiere publicar glifos, que hoy no existen. Las tramas de riesgo de 45° (que iban como sprites a DPR 2, porque las capas `fill` de MapLibre no aceptan `<pattern>` SVG) **se retiran**: sin puntaje no hay escala que pintar.
- ~~**Clima y aire con OpenWeather**~~ — **SE APAGAN ENTEROS (2026-08-03).** Decisión del usuario: el mapa es solo operativo, y clima/aire salen también del puntaje. Caen los jobs, los adaptadores de OpenWeather, la grilla de 14 puntos, las tablas `clima_horario`/`aire_horario` y la atribución «Weather data provided by OpenWeather». *Se conserva como memoria: Open-Meteo se descartó porque su tier libre prohíbe uso comercial y define como comercial "apps con suscripciones" — el mismo patrón que después se encontró en MapTiler, Stadia y Jawg (ver `mapa-torre-v2.md` §3). MMA/SINCA se había descartado por publicar observaciones y no pronóstico.*
- ~~**Umbrales PM2.5**~~ — sin objeto: el factor aire se retira. *(Eran Alerta 80 · Preemergencia 110 · Emergencia 170 sobre la media móvil de 24 h, del Plan Operacional GEC 2026 del MMA. Anotado por si alguna vez vuelve el tema de restricción vehicular por episodio.)*
- **Un solo horizonte: HOY.** Cae el envoltorio `TorreRespuesta.horizontes` con `'hoy'|'manana'|'72h'` y cae el selector de horizonte. Una consola que monitorea el día en vivo no tiene qué mostrar de mañana, y en same-day el de 72 h estaría vacío siempre. Lo único que mira hacia adelante es la **ola** (calendario comercial), como banda de aviso.
- **RBAC**: capacidad `ver_torre_control` (dueño, supervisor, coordinador — no administración). Es de lectura: no habilita ninguna acción irreversible. **Sigue igual en la v2** — la Torre no escribe.
- ~~**La Torre vive en `src/app/(consola)/`**~~ — **REVERTIDO (2026-08-03): la Torre baja a `(tenant)` y el grupo `(consola)` se retira entero.** Decisión del usuario: la Torre es un módulo más del SaaS, con el `AppShell`, el mismo sidebar y la misma navegación que cualquier otra pantalla; el mapa va **grande pero acotado** (altura definida, no viewport completo) más un **botón de pantalla completa** (Fullscreen API sobre el contenedor, no una ruta nueva). Consecuencias: `src/app/` vuelve a **cinco** destinos, desaparece la duplicación de guards de `(consola)/layout.tsx`, y **la regla general deja de tener excepción: toda pantalla del courier vive en `(tenant)`**. Lo único a resolver en la implementación es que esta pantalla se salga del `max-w-6xl` del `<main>` sin quitárselo a las demás.
- **Cartografía**: la geometría comunal DPA 2023 (113 KB) se versiona en `public/mapas/comunas-rm.topojson.json` y es **comunal, nunca disuelta por zona** — el disuelto comuna→zona lo hace el cliente. El basemap PMTiles de la RM (~19 MB) NO se versiona: se recorta del build público de Protomaps y se publica al bucket `contexto-mapas`. Pipeline completo y sus invariantes en `scripts/mapa/README.md`. Sin `NEXT_PUBLIC_MAPA_BASEMAP_URL` el mapa degrada a zonas sobre Papel, sin plano urbano — y eso es un estado válido.
- **Gotcha de Tailwind 4 con CSS de terceros**: `maplibre-gl.css` se importa **sin capa**, y el CSS sin capa gana SIEMPRE al CSS en capa (donde vive todo Tailwind), sin importar la especificidad. Cualquier nodo que MapLibre marque con sus clases hay que posicionarlo con estilos en línea, no con utilidades.
- **`maplibre-gl` está clavado en `5.24.0` (versión exacta) — NO subir a 6.x.** La 6.0.0 dejó de empaquetar su Web Worker y lo carga como archivo suelto con `new Worker(new URL(…, import.meta.url), {type:'module'})`, patrón que Turbopack no resuelve dentro de `node_modules`. Falla mudo: MapLibre no emite un solo evento, `getStyle()` devuelve `null` y el lienzo queda en blanco, sin errores en consola. `@maplibre/maplibre-gl-style-spec` debe seguir a la versión que pide maplibre-gl (hoy `^24.10.0`).
