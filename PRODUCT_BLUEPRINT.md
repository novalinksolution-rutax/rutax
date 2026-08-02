# PRODUCT_BLUEPRINT.md — Manual maestro del producto

> **Qué es este documento.** El blueprint estratégico del producto: traduce la auditoría técnica ([PROJECT_AUDIT.md](PROJECT_AUDIT.md)) en un manual de producto único para alinear Producto, UX/UI, Frontend, Backend, QA, Marketing, Copywriting e IA Agents.
>
> **Fuente de verdad.** Todo lo aquí escrito se deriva de [PROJECT_AUDIT.md](PROJECT_AUDIT.md) (auditoría por exploración directa del repo, 2026-06-13) y [CLAUDE.md](CLAUDE.md). No se inventan funcionalidades. Lo que no puede verificarse en evidencia se marca `NO VERIFICABLE`.
>
> **Fecha.** 2026-06-13 · **Rama:** `master` · **Madurez global:** ~85/100.

---

## Índice

1. [Visión del producto](#1-visión-del-producto)
2. [Perfil de usuarios](#2-perfil-de-usuarios)
3. [Casos de uso](#3-casos-de-uso)
4. [Módulos del sistema](#4-módulos-del-sistema)
5. [Mapa funcional](#5-mapa-funcional)
6. [Flujos de negocio](#6-flujos-de-negocio)
7. [Customer journey](#7-customer-journey)
8. [Arquitectura de información](#8-arquitectura-de-información)
9. [Reglas de negocio](#9-reglas-de-negocio)
10. [Integraciones](#10-integraciones)
11. [KPIs del producto](#11-kpis-del-producto)
12. [Gaps detectados](#12-gaps-detectados)
13. [Roadmap recomendado](#13-roadmap-recomendado)
14. [Agent context](#14-agent-context)

---

## 1. VISIÓN DEL PRODUCTO

### Qué es
Un **SaaS B2B vertical, neutral y multi-tenant** para empresas de última milla (couriers) que operan **Mercado Libre Flex + same-day** en Santiago de Chile. Es una plataforma web (monolito modular Next.js + Supabase) con un **portal para el cliente del courier (seller)** y una **PWA para el conductor**. El fundador del SaaS **no opera entregas**: solo provee el software. Cada tenant es un courier independiente.

### Qué problema resuelve
Los couriers de última milla pierden el control de su **"trastienda de dinero"**: la brecha entre lo que entregan y lo que efectivamente cobran a los sellers y liquidan a los conductores. Hoy ese cierre se hace a mano (planillas, doble digitación, conciliación manual), lo que genera fugas de dinero, errores y fricción.

### Por qué existe
Porque el ruteo y la operación de entrega ya están **commoditizados** (la app de escaneo/POD de Mercado Envíos Flex es obligatoria y no integrable). El valor no capturado está en el dinero, no en el mapa. El producto existe para cerrar ese lazo de forma automática y auditable.

### Beneficio principal
**Cada entrega genera, sola, su línea de cobro al seller y su línea de liquidación al conductor, ambas conciliadas.** Se elimina la digitación manual del cierre financiero y se reduce la fuga de dinero entre lo entregado y lo facturado/liquidado.

### Propuesta de valor
> **"El motor entrega→dinero":** la única plataforma que convierte cada entrega de Flex en su cobro y su liquidación conciliados, sin reemplazar la app obligatoria de Mercado Libre, con aislamiento de datos garantizado en la base de datos y facturación electrónica chilena (DTE) bajo el RUT del courier.

**Diferenciadores verificados:**
- Motor entrega→dinero como núcleo (módulo `dinero`), no como add-on.
- Aislamiento multi-tenant impuesto **en la base de datos** (RLS de 3 capas), no solo en la app.
- **Compuerta humana de facturación**: ningún proceso automático emite un DTE irreversible ante el SII.
- Neutralidad: orquesta alrededor de la app de Flex, nunca la reemplaza.

---

## 2. PERFIL DE USUARIOS

El sistema tiene **4 tipos de usuario macro** (`tipo_usuario`) y **7 roles** (`rol`). Verificado en [src/modules/identidad/roles.ts](src/modules/identidad/roles.ts) y la matriz de capacidades [src/modules/identidad/capacidades.ts](src/modules/identidad/capacidades.ts).

| `tipo_usuario` | Roles que agrupa |
|---|---|
| `interno` | `dueno`, `supervisor`, `coordinador`, `administracion` |
| `seller` | `seller` |
| `conductor` | `conductor` |
| `super_admin` | `super_admin` (plataforma) |

### Courier — usuarios internos

#### Dueño (`dueno`)
- **Responsabilidad:** superconjunto interno. Controla usuarios, tarifas, configuración DTE, aprobación/emisión de facturación, conciliación, liquidaciones, cobranza, operación, reportes y bitácora.
- **Objetivos:** que el negocio cobre todo lo que entregó, pagar correctamente a sus conductores, ver el estado del día de un vistazo.
- **Necesidades:** visibilidad financiera y operativa consolidada; control sobre quién hace qué; confianza en que los números cuadran.
- **Frustraciones (que el producto ataca):** fuga de dinero, conciliación manual, no saber si una caída de conexión le hizo perder pedidos.
- **Acciones principales:** ver dashboard, aprobar y emitir facturas, revisar conciliación, gestionar equipo y tarifas.

#### Supervisor (`supervisor`)
- **Responsabilidad:** operación pura. Asignar/reasignar pedidos, generar manifiestos, gestionar incidencias, ajustar operación. **Sin** acceso a finanzas ni usuarios.
- **Objetivos:** que todos los pedidos del día salgan asignados y se resuelvan las incidencias a tiempo.
- **Necesidades:** panel multi-seller claro, asignación rápida, alerta de incidencias sin gestión.
- **Frustraciones:** pedidos sin asignar, incidencias que dañan la reputación del seller en ML.
- **Acciones principales:** crear/confirmar manifiestos, asignar conductores, resolver incidencias.

#### Coordinador (`coordinador`)
- **Responsabilidad:** el rol interno más acotado. Solo asignar/reasignar pedidos y generar manifiestos.
- **Objetivos:** ejecutar la asignación diaria.
- **Necesidades:** flujo de asignación simple y sin distracciones.
- **Acciones principales:** asignar pedidos a manifiestos.

#### Administración (`administracion`)
- **Responsabilidad:** finanzas. Tarifas, DTE, aprobar/emitir facturación, conciliación, liquidaciones, cobranza, bitácora. **Sin** reasignación operativa.
- **Objetivos:** facturar el período, liquidar conductores, conciliar pagos.
- **Necesidades:** períodos claros, conciliación legible, descarga de documentos.
- **Frustraciones:** descuadres no detectados, pagos no atribuidos.
- **Acciones principales:** cerrar período, emitir factura/NC, marcar liquidaciones pagadas, atribuir pagos.

### Seller (`seller`)
- **Responsabilidad:** es el **cliente del courier** (vendedor de Mercado Libre). Usa el portal.
- **Objetivos:** que sus envíos salgan, ver su tracking, entender cuánto le cobran y por qué.
- **Necesidades:** conexión simple de su cuenta ML, visibilidad de pedidos e incidencias, descarga de su factura.
- **Frustraciones:** no saber el estado de sus envíos, sorpresas en el cobro, conexión ML caída sin aviso.
- **Acciones principales:** conectar/reconectar ML, solicitar same-day, ver pedidos/incidencias, descargar factura PDF.
- **Restricción de visibilidad:** el seller **nunca ve montos pactados de tarifas** ni datos de otros sellers (RLS P2).

### Conductor (`conductor`)
- **Responsabilidad:** repartidor del courier. Puede ser **dependiente (formal)** o **independiente (informal)** — relevante para Ley 21.431. Usa la PWA.
- **Objetivos:** saber su ruta del día y cuánto le toca cobrar.
- **Necesidades:** manifiesto del día ordenado, visibilidad de su liquidación.
- **Frustraciones:** tener que usar dos apps (la de Flex obligatoria + esta); rutas desordenadas.
- **Acciones principales:** ver manifiesto, marcar "listo para salir", ver/descargar su liquidación.
- **Restricción dura:** usa la app de Flex para escanear/POD (no integrable). El producto **no** captura POD propio.

### Plataforma (`super_admin`)
- **Responsabilidad:** el fundador/operador del SaaS.
- **Particularidad verificada:** tiene **lista vacía de capacidades de tenant a propósito**. Las acciones de plataforma se ejecutan vía funciones `service_role` auditadas, no desde la UI de un tenant.

---

## 3. CASOS DE USO

### Casos de uso principales (el "lazo completo")

| Caso de Uso | Objetivo |
|---|---|
| Conectar cuenta de Mercado Libre (seller) | Habilitar ingesta automática de pedidos Flex vía OAuth |
| Ingesta automática de pedidos Flex | Recibir pedidos por webhook + sondeo de respaldo sin doble digitación |
| Asignar pedidos a conductores | Organizar la operación del día vía manifiestos |
| Sincronizar estados de entrega | Reflejar el estado real desde la API de ML |
| Registrar incidencias | Clasificar problemas (ausente, dirección, reagendado) y proteger reputación |
| Generar líneas de cobro y liquidación | Que cada entrega produzca su cobro al seller + liquidación al conductor |
| Cerrar período y conciliar | Agrupar líneas, detectar descuadres entregado-vs-facturado |
| Aprobar y emitir factura (DTE 33) | Facturar al seller bajo el RUT del courier, con control humano |
| Descargar factura (seller) | Que el seller acceda a su documento tributario |
| Liquidar al conductor | Calcular y comunicar cuánto se le paga |
| Conciliar cobranza (Fintoc) | Atribuir el pago del seller al período correspondiente |

### Casos de uso secundarios

| Caso de Uso | Objetivo |
|---|---|
| Solicitar same-day ad-hoc (seller) | Pedir una entrega fuera de Flex |
| Same-day como gasto propio del courier | Registrar entregas que no se cobran al seller |
| Reconexión de ML self-service | Que el seller restablezca su conexión caída |
| Backfill al reconectar | Recuperar pedidos perdidos durante una caída sin duplicar |
| Refresco automático de tokens OAuth | Mantener viva la conexión ML sin intervención |
| Emitir nota de crédito (DTE 61) | Anular totalmente una factura ya emitida |
| Anular período | Revertir un período con auditoría |
| Gestionar equipo e invitaciones | Dar de alta usuarios internos con rol |
| Invitar sellers / dar de alta conductores | Poblar el tenant |
| Gestionar tarifas (seller/tipo/zona) | Definir cuánto se cobra y cuánto se liquida |
| Exportar datos del courier (RNF-13) | Portabilidad de datos del tenant |
| Descargar etiqueta de envío ML | Imprimir etiqueta para el paquete |
| Ver dashboard operativo del día | Tomar decisiones de un vistazo |
| Alertas (folios bajos, morosidad, incidencias) | Avisar proactivamente (hoy en bitácora; envío real pendiente) |

---

## 4. MÓDULOS DEL SISTEMA

El sistema es un **monolito modular** con límites estrictos: cada módulo de dominio (`src/modules/`) mapea a un esquema Postgres. **El núcleo no llama APIs externas directo** — eso lo hacen los adaptadores de `integraciones`.

### identidad
- **Propósito:** auth, tenants, RBAC, onboarding del courier/seller/conductor, invitaciones, secretos cifrados, tarifas, conexiones ML, bitácora de auditoría.
- **Usuarios involucrados:** todos (es la raíz de identidad y permisos).
- **Funcionalidades:** registro de courier, login, claims JWT, matriz rol→capacidad, gestión de equipo, tarifas versionadas, configuración DTE/cobranza, folios CAF, cifrado de secretos.
- **Dependencias:** Supabase Auth; es base de todos los demás módulos (provee `tenant_id`, `seller_id`, `driver_id`, `rol` vía claims).
- **Estado:** ✅ Implementado (Fase A).

### operacion
- **Propósito:** ciclo de vida operativo del pedido.
- **Usuarios involucrados:** internos (supervisor, coordinador, dueño), conductor (lectura de lo suyo), seller (lectura de lo suyo).
- **Funcionalidades:** pedidos (Flex + same-day), ingesta, asignación, manifiestos, máquina de estados, incidencias, evidencias, backfill, métricas del dashboard.
- **Dependencias:** `identidad` (tenant, sellers, conductores, tarifas); `integraciones/ml` (ingesta, estados, etiquetas).
- **Estado:** ✅ Implementado (Fase B).

### dinero
- **Propósito:** el diferenciador. Motor entrega→dinero.
- **Usuarios involucrados:** administración, dueño (finanzas); seller (ve cobros); conductor (ve liquidación).
- **Funcionalidades:** líneas de cobro/liquidación, períodos, facturación DTE, liquidaciones de conductor, conciliación (detective), cobranza Fintoc, notas de crédito.
- **Dependencias:** `operacion` (eventos de estado de pedido + incidencias); `integraciones/dte` y `integraciones/pagos`; `identidad` (tarifas, config DTE).
- **Estado:** ✅ Implementado y verificado E2E con datos demo (Fase C).

### integraciones
- **Propósito:** adaptadores aislados (un "puerto" por servicio externo).
- **Usuarios involucrados:** indirecto (el sistema; el seller dispara OAuth ML).
- **Funcionalidades:** Mercado Libre (OAuth, shipments, etiquetas, salud, backfill), DTE (Simplefactura sandbox / Openfactura esqueleto), pagos (Fintoc), cifrado de secretos, resiliencia (backoff).
- **Dependencias:** `identidad.secretos_cifrados` (no tiene esquema propio).
- **Estado:** ✅ Implementado (ML, Fintoc, DTE sandbox).

### infra (transversal)
- **Propósito:** rate limiting (fixed-window counter).
- **Funcionalidades:** limitador fail-open vía RPC `rate_limit_consumir` para webhooks públicos.
- **Particularidad:** única excepción documentada a "toda tabla lleva `tenant_id`".
- **Estado:** ✅ Implementado.

---

## 5. MAPA FUNCIONAL

> Estado: ✅ Completa · 🟡 Parcial · ⛔ Incompleta · ⬜ Fuera del MVP · ❔ No verificable.

### Identidad y onboarding

| Funcionalidad | Módulo | Estado |
|---|---|---|
| Alta de courier / tenant (RF-006) | identidad | ✅ |
| RBAC — 7 roles diferenciados (RF-002) | identidad | ✅ |
| Gestión de usuarios e invitaciones internas (RF-005) | identidad | ✅ |
| Carga cifrada de certificado digital (RF-007) | identidad/integraciones | ✅ |
| Conexión proveedor DTE + folios CAF (RF-008) | identidad | ✅ |
| Gestión de tarifas seller/tipo/zona (RF-009) | identidad | ✅ |
| Onboarding del seller (RF-010) | identidad | ✅ |
| Recuperación de contraseña con UI propia | identidad | ❔ |

### Integración ML y operación

| Funcionalidad | Módulo | Estado |
|---|---|---|
| OAuth del seller — cuenta principal (RF-011) | integraciones | ✅ |
| Refresco automático de tokens (RF-012) | integraciones | ✅ |
| Monitoreo de salud de conexiones (RF-013) | integraciones | ✅ |
| Alerta de desvinculación (RF-014) | integraciones | 🟡 (alerta interna ok; email real pendiente) |
| Empujón de reconexión por el courier (RF-016) | integraciones | 🟡 (link manual; envío automático pendiente) |
| Reconexión self-service (RF-015) | integraciones | ✅ |
| Backfill al reconectar (RF-017) | operacion/integraciones | ✅ |
| Ingesta automática Flex + sondeo de respaldo (RF-018) | operacion | ✅ |
| Panel multi-seller (RF-019) | operacion | ✅ |
| Same-day ad-hoc (RF-020) | operacion | ✅ |
| Obtención de etiquetas (RF-021) | integraciones | ✅ (descarga real requiere OAuth real) |
| Asignación por zona/conductor (RF-022) | operacion | ✅ |
| Reasignación ante falla (RF-023) | operacion | ✅ |
| Generación de manifiesto (RF-024) | operacion | ✅ |
| Ruteo básico / orden de paradas (RF-025) | operacion | ✅ (no optimizador, por diseño) |
| Sincronización de subestados (RF-026) | operacion/integraciones | ✅ |
| Registro/clasificación de incidencias (RF-027) | operacion | ✅ |
| Acciones de incidencia que protegen reputación (RF-028) | operacion | ✅ |
| Corrección manual de estado (RF-029) | operacion | ✅ |

### Motor entrega→dinero

| Funcionalidad | Módulo | Estado |
|---|---|---|
| Línea de cobro por entrega (RF-030) | dinero | ✅ |
| Línea de liquidación por entrega (RF-031) | dinero | ✅ |
| Regla: reintento/devolución no dobla cobro/pago (RF-032) | dinero | ✅ |
| Conciliación entregado-vs-facturado (RF-033) | dinero | ✅ |
| Same-day como gasto propio (RF-034) | dinero | ✅ |
| Factura del período Flex+same-day (RF-035) | dinero | ✅ |
| Emisión DTE bajo RUT del courier (RF-036) | dinero/integraciones | ✅ (sandbox) |
| Descarga del DTE por el seller (RF-037) | dinero | ✅ |
| Nota de crédito — anulación total (RF-038) | dinero | ✅ (adelantado; era V2) |
| Cálculo de liquidación por conductor (RF-039) | dinero | ✅ |
| Boleta de terceros — conductor formal (RF-040) | dinero | ⬜ Fuera del MVP |
| Registro interno de liquidación — informal (RF-041) | dinero | ✅ |
| Visibilidad de liquidación para conductor (RF-042) | dinero | ✅ |
| Estado de cuenta / cartola por seller (RF-043) | dinero | ✅ |
| Cobranza + conciliación bancaria Fintoc (RF-044/045) | dinero/integraciones | ✅ (adelantado; era V2) |

### Visibilidad y plataforma

| Funcionalidad | Módulo | Estado |
|---|---|---|
| Dashboard operativo del dueño (RF-046) | operacion | ✅ |
| Vista de conductor PWA (RF-047) | operacion | ✅ (instalabilidad PWA ❔) |
| Portal del seller (RF-048) | varios | ✅ |
| Reportería ejecutiva avanzada (RF-049) | — | ⬜ Fuera del MVP |
| Notificaciones internas (RF-050) | — | 🟡 (registro en bitácora; envío real pendiente) |
| Notificaciones al consumidor final (RF-051) | — | ⬜ Fuera del MVP |
| Exportación de datos del courier (RNF-13) | identidad | ✅ |
| Rate limiting de webhooks | infra | ✅ |
| Observabilidad / Sentry (RNF-10) | — | ⛔ Pendiente (devops) |
| Disponibilidad / respaldos (RNF-08/09) | — | ⛔ Pendiente (devops) |
| Cobro de suscripción SaaS al courier | — | ❔ No verificable |

---

## 6. FLUJOS DE NEGOCIO

### Flujo principal — el lazo entrega→dinero

1. **Onboarding del courier.** El dueño se registra (`/registro`), configura proveedor DTE + certificado (`/onboarding/dte`), folios CAF (`/onboarding/folios`), tarifas (`/onboarding/tarifas`) y, opcionalmente, cobranza Fintoc (`/onboarding/cobranza`).
2. **Alta de sellers y conductores.** El courier invita sellers (`/sellers/invitar`) y da de alta conductores (registrando `tipo_relacion`, Ley 21.431).
3. **Conexión OAuth del seller.** El seller acepta la invitación, entra al portal y conecta su cuenta principal de Mercado Libre (`/portal/conectar-ml`). El token se cifra en `secretos_cifrados`.
4. **Ingesta de pedidos.** El webhook `/api/webhooks/ml/shipments` encola `ml/shipment.actualizado` → el job `procesar-shipment` crea/actualiza `pedidos` (idempotente). El job `polling-estados` (cada 15 min) recupera lo que el webhook no trajo.
5. **Asignación.** El courier crea un manifiesto, asigna pedidos a un conductor (`/manifiestos/.../asignar`) y lo confirma. El conductor ve su ruta en la PWA.
6. **Entrega.** El conductor usa la **app de Flex (no integrable)** para escanear/POD. El estado se sincroniza vía API ML (`traducirEstadoMl`).
7. **Incidencias.** Si hay problema (ausente, dirección, reagendado), se registra. `reagendado` afecta cobro pero **no** liquidación (no penaliza reintentos del conductor).
8. **Generación de líneas (job C1).** Al alcanzar un estado financiero relevante (ej. `entregado`), `pedidos.ts` publica `dinero/pedido.estado_financiero_relevante` → el job `generar-lineas` crea `lineas_cobro` (al seller, según tarifa) + `lineas_liquidacion` (al conductor). Gasto propio ⇒ sin línea de cobro.
9. **Cierre de período (cron C2).** El cron `cerrar-periodo` (02:00 diario) cierra períodos vencidos (`abierto`→`cerrado`), suma líneas y publica `dinero/periodo.cerrado` → **solo conciliación**.
10. **Conciliación (job C6, detective).** `conciliar-periodo` compara entregado vs facturado y registra descuadres en `eventos_conciliacion` (solo lectura).
11. **Aprobación y emisión humana.** Una persona con `emitir_facturas` revisa el período `cerrado` y ejecuta `emitirFacturaPeriodo` → publica `dinero/periodo.emision-solicitada` → el job C3 `emitir-dte-periodo` reserva folio + llama al adaptador DTE (tipo 33). **La bitácora se escribe ANTES del evento.**
12. **Visibilidad para el seller.** El seller ve/descarga su factura en `/portal/cobros/[periodoId]`.
13. **Liquidación del conductor (cron).** `generar-liquidacion-conductor` (02:00) agrega `lineas_liquidacion` por conductor; el conductor ve su liquidación en `/conductor/liquidaciones`.
14. **Cobranza (Fintoc).** El seller paga por transferencia; el webhook `/api/webhooks/fintoc/[tenantId]` encola `dinero/pago.recibido` → el job `conciliar-pago` atribuye y concilia contra el período (`estado_cobro`: pendiente/parcial/pagado).

### Flujos secundarios

- **Caída y reconexión de ML:** `sondeo-salud` (cada 15 min) detecta caídas → marca `estado_salud` → notifica → al reconectar (`ml/conexion.reconectada`) el job `ejecutar-backfill` recupera pedidos sin duplicar.
- **Refresco de tokens:** `refrescar-tokens` (cada 30 min) renueva tokens OAuth antes de expirar.
- **Nota de crédito (RF-038):** `emitirNotaCreditoPeriodo` (humano) → job `emitir-nota-credito` emite DTE 61, desimputa pagos y reimputa líneas a un período abierto.
- **Anulación de período:** estado `anulado` + auditoría.
- **Alertas:** `alerta-folios-proximos` (09:00, <50 folios), `alerta-morosidad` (09:00), `notificacion-incidencias-sin-gestion` (cada 30 min, >4h sin gestión). Hoy quedan en bitácora; el envío real (email/push) está pendiente.

---

## 7. CUSTOMER JOURNEY

### Courier (dueño)

| Etapa | Qué ocurre | Resultado esperado |
|---|---|---|
| **Entrada** | Se registra en `/registro`, crea su tenant, valida RUT | Cuenta activa, es `dueno` |
| **Activación** | Completa onboarding: DTE + certificado + folios + tarifas (+ cobranza), invita sellers, da de alta conductores | Tenant configurado y listo para operar |
| **Uso recurrente** | Revisa dashboard del día, supervisa asignación, cierra/aprueba/emite facturación, revisa conciliación y cobranza | Operación diaria controlada; el dinero cuadra |
| **Resultado esperado** | Cobra todo lo entregado, liquida bien a conductores, sin fuga ni doble digitación | Retención: el courier deja de usar planillas |

### Seller

| Etapa | Qué ocurre | Resultado esperado |
|---|---|---|
| **Entrada** | Recibe invitación del courier, activa su cuenta | Acceso al portal |
| **Activación** | Conecta su cuenta de Mercado Libre por OAuth (`/portal/conectar-ml`) | Conexión ML sana; ingesta automática activa |
| **Uso recurrente** | Ve sus pedidos/tracking, solicita same-day, sigue incidencias, descarga facturas | Visibilidad de envíos y cobros sin contactar al courier |
| **Resultado esperado** | Confianza en el courier; menos consultas; cobros claros | Retención indirecta (el seller no presiona al courier para cambiar) |

### Conductor

| Etapa | Qué ocurre | Resultado esperado |
|---|---|---|
| **Entrada** | Recibe alta/invitación del courier; abre la PWA | Acceso a su vista |
| **Activación** | Ve su primer manifiesto del día, marca "listo para salir" | Sabe su ruta; entrega con la app de Flex |
| **Uso recurrente** | Consulta manifiesto diario y orden de paradas; revisa su liquidación | Claridad operativa y de pago |
| **Resultado esperado** | Sabe exactamente cuánto le toca y por qué | Menos disputas de pago |

### Plataforma (super_admin)
- **Entrada/uso:** administra tenants vía funciones `service_role` auditadas (no UI de tenant). El detalle operativo de plataforma es `NO VERIFICABLE` en el código auditado más allá de la existencia del rol.

---

## 8. ARQUITECTURA DE INFORMACIÓN

Next.js App Router con **4 grupos de navegación** según audiencia. **No hay `middleware.ts`**: cada layout guarda su área vía sesión + capacidad RBAC, reforzado por RLS en BD.

### `(tenant)` — courier interno
Layout único con **navegación condicionada por capacidad RBAC** ([barra-superior.tsx](src/components/app-shell/barra-superior.tsx)). Agrupación jerárquica:

```
(tenant)
├── Dashboard                      → /dashboard
├── Operación
│   ├── Pedidos (panel multi-seller) → /operaciones
│   │   └── Detalle de pedido        → /operaciones/[pedidoId]
│   ├── Incidencias                  → /operaciones/incidencias
│   └── Manifiestos                  → /manifiestos
│       ├── Nuevo                    → /manifiestos/nuevo
│       └── Detalle / Asignar        → /manifiestos/[id] · /[id]/asignar
├── Dinero
│   ├── Períodos (cobro)             → /dinero/periodos · /[periodoId]
│   ├── Liquidaciones                → /dinero/liquidaciones
│   ├── Conciliación                 → /dinero/conciliacion   (solo dueño/admin)
│   └── Cobranza (Pagos)             → /dinero/cobranza
├── Configuración
│   ├── Onboarding                   → /onboarding
│   ├── DTE / Folios / Tarifas / Cobranza → /onboarding/*
│   ├── Equipo                       → /equipo
│   ├── Sellers                      → /sellers · /sellers/invitar
│   └── Exportar datos               → /configuracion/exportar-datos
```

> **Principio de navegación:** lo que un rol no puede hacer, **no debería verlo**. La barra superior ya filtra por capacidad — UX/UI debe mantener esa regla (no mostrar items sin permiso).

### `portal` — seller
```
portal
├── Home / Conexión ML   → /portal
├── Bienvenida           → /portal/bienvenida
├── Conectar ML          → /portal/conectar-ml
├── Pedidos              → /portal/pedidos · /pedidos/nuevo (same-day)
├── Incidencias          → /portal/incidencias
└── Cobros               → /portal/cobros · /cobros/[periodoId] (factura PDF)
```

### `conductor` — PWA
```
conductor
├── Home                 → /conductor
├── Manifiesto del día   → /conductor/manifiesto · /manifiesto/[pedidoId]
└── Liquidaciones        → /conductor/liquidaciones
```

### Público
`/` (landing/redirección) · `/login` (interno) · `/registro` · `/portal/login` (seller) · `/invitacion/[token]` · `/activar-cuenta` · `/auth/confirm` · `/oauth/ml/callback`.

> **Deuda de IA conocida:** existe un grupo `(app)/` **legado** reemplazado por `(tenant)`, pendiente de limpieza. No agregar pantallas nuevas ahí.

---

## 9. REGLAS DE NEGOCIO

### Reglas no-negociables (el contrato, de [CLAUDE.md](CLAUDE.md))

| Regla | Descripción |
|---|---|
| Aislamiento en la BD | El aislamiento entre couriers (tenants) y del seller/conductor se impone con **RLS en PostgreSQL**, no solo en la app. Toda tabla de negocio lleva `tenant_id`. |
| Alcance del seller | El seller solo ve sus propios datos (RLS P2). Nunca ve montos pactados de tarifas ni datos de otros sellers. |
| Alcance del conductor | El conductor solo ve lo suyo (RLS P3). |
| Secretos cifrados | Certificados digitales y tokens (ML, etc.) cifrados (AES-256); **nunca** en logs, texto plano ni URLs. Solo `service_role` accede. |
| Auditoría total | Toda acción financiera y de acceso queda en `bitacora_auditoria` (append-only). |
| Procesos pesados como jobs | Ingesta, facturación, liquidación y estados corren como **jobs idempotentes con reintentos**, no en el request del usuario. |
| Localización Chile | CLP, español, zona horaria de Santiago, validación de RUT (módulo-11). |
| Exclusiones del MVP | No microservicios, no colas propias, no IA, no optimizadores de ruteo. |

### Invariantes del motor entrega→dinero

| Regla | Descripción |
|---|---|
| Compuerta de aprobación de facturación | **Ningún cron emite un DTE.** El cron `cerrar-periodo` solo cierra (`abierto`→`cerrado`) y dispara conciliación. La emisión (`cerrado`→`facturado`) exige la acción humana `emitirFacturaPeriodo`. Razón: un DTE es irreversible ante el SII sin nota de crédito. |
| Bitácora antes que efecto externo, con autor | Toda acción financiera/de acceso se registra en `bitacora_auditoria` **antes** de publicar el evento Inngest o llamar a una integración. Lleva `actorUsuarioId` (RNF-04, el "quién"). |
| DTE en sandbox + opt-in real | El adaptador DTE corre en `DTE_SANDBOX_MODE=true` y no emite DTEs reales. La emisión real exige opt-in explícito por courier (`emision_dte_real_habilitada`, default `false`) + decisión del dueño + revisión de seguridad. |
| Idempotencia de jobs | Por `pedido_id` / `periodo_id` / `movimiento_externo_id` (ON CONFLICT DO NOTHING / upsert). |
| Una línea por pedido elegible | `lineas_cobro` y `lineas_liquidacion` tienen `pedido_id` único. Un reintento/devolución **no** dobla cobro ni pago (RF-032). |
| Reagendado protege al conductor | Una incidencia `reagendado` afecta el cobro al seller pero **no** la liquidación del conductor. |
| Gasto propio no se cobra | Un same-day marcado `esGastoPropio` genera liquidación al conductor pero **no** línea de cobro al seller (RF-034). |
| Escritura de dinero solo service_role | Toda escritura en tablas de `dinero` es exclusiva de los jobs (`service_role`). El cliente nunca escribe dinero. Guard `solo_interno_edita()` convierte un UPDATE silencioso en error `42501` auditable. |
| Nota de crédito = anulación total | La NC (DTE 61) anula totalmente la factura; motivo obligatorio; solo sobre período `facturado`; solo una NC activa por factura. |

### Reglas de identidad y acceso

| Regla | Descripción |
|---|---|
| Claims del JWT como fuente de RLS | `custom_access_token_hook` inyecta `tenant_id/tipo_usuario/seller_id/driver_id/rol/estado_usuario` al token. **Sin perfil ⇒ sin claims ⇒ RLS bloquea todo** (fail-closed). |
| RBAC en código, no en tabla | La matriz `rol→capacidades` vive en código ([capacidades.ts](src/modules/identidad/capacidades.ts)). Frontend y backend consumen las mismas funciones `puede*()`. |
| Usuario invitado/suspendido sin capacidades | No ejerce ninguna capacidad (RNF-03). |
| super_admin sin capacidades de tenant | A propósito; opera vía funciones de plataforma auditadas. |
| Invitación de un solo uso | Las invitaciones se resuelven por token único, fuera del flujo RLS normal. |

---

## 10. INTEGRACIONES

Patrón: **adaptadores aislados** (un "puerto" por servicio). El núcleo nunca llama APIs externas directo.

| Servicio | Tipo | Uso | Estado |
|---|---|---|---|
| **Mercado Libre (Flex)** | Marketplace / logística | OAuth por seller, refresco de tokens, lectura de pedidos/shipments, traducción de estados, etiquetas, salud de conexiones, backfill | ✅ Implementado (descarga/refresco real requiere OAuth real) |
| **Simplefactura** | Proveedor DTE | Adaptador **stub sandbox**. No emite DTEs reales. Default del MVP | ✅ Sandbox |
| **Openfactura** | Proveedor DTE | Adaptador **esqueleto**, no cableado. Candidato productivo | ⚠️ Esqueleto (no productivo) |
| **Fintoc** | Pagos / banca | Conciliación de pagos seller→courier vía Link + Movements API + webhook firmado | ✅ Implementado (capa "pagado") |
| **Inngest** | Orquestador de jobs | 17 funciones en segundo plano | ✅ Implementado |
| **Supabase** | Plataforma de datos | Postgres + Auth + Storage + RLS + RPC | ✅ Núcleo |
| **Resend** | Email | Notificaciones (reconexión, alertas) | ❌ TODO explícito — pendiente (devops) |
| **Sentry / observabilidad** | Monitoreo | Errores y salud de jobs | ❌ No integrado (devops) |
| **WhatsApp / SMS / push** | Notificaciones | Al seller / consumidor | ❌ No implementado (fuera del MVP) |
| **IA / LLM** | — | — | ❌ Excluido del MVP por diseño |
| **Pasarela de suscripción (Flow/Webpay PatPass)** | Pagos SaaS | Cobro de la suscripción al courier | ❔ NO VERIFICABLE (descrita en skill, sin implementación detectada) |

> **Nota sobre webhooks ML:** Mercado Libre **NO firma** sus notificaciones. La variable `WEBHOOKS_ML_SECRET` quedó **obsoleta**. La validación es por `application_id` + re-consulta del recurso con el token del seller + rate limiting.

---

## 11. KPIs DEL PRODUCTO

> KPIs **propuestos** según el SaaS detectado. La instrumentación real está pendiente (ver gap de observabilidad). Estos definen qué medir, no afirman que ya se mide.

### Activación
- **% de couriers que completan el onboarding** (DTE + folios + tarifas + ≥1 seller invitado) en los primeros 7 días.
- **Tiempo a la primera conexión ML de un seller** desde la invitación.
- **% de sellers invitados que conectan ML** (OAuth completado).
- **Tiempo al primer pedido ingestado** por tenant.
- **Tiempo al primer ciclo entrega→factura cerrado** (el momento "aha" del producto).

### Retención
- **Couriers activos semanales** (con ≥1 manifiesto confirmado).
- **Sellers con conexión ML sana** (no caída) sobre el total.
- **Tasa de reconexión exitosa** tras una caída de conexión.
- **Churn de couriers** (mensual).
- **Profundidad de uso:** % de tenants que usan el módulo de dinero (cierran/emiten), no solo operación.

### Operación
- **Pedidos ingestados por webhook vs recuperados por polling** (salud de la ingesta en tiempo real).
- **% de pedidos asignados** antes del inicio de ruta.
- **Tiempo de gestión de incidencias** (y % de incidencias >4h sin gestión).
- **Tasa de éxito de jobs Inngest** y reintentos (requiere observabilidad).
- **Latencia de sincronización de estados** desde ML.
- **% de períodos con descuadres de conciliación** (eventos_conciliacion abiertos).

### Negocio
- **GMV conciliado** por tenant (monto facturado vía DTE).
- **Monto cobrado vs facturado** (eficacia de cobranza Fintoc; `estado_cobro`).
- **Tasa de morosidad** de sellers por courier.
- **DTEs emitidos por período** y % de notas de crédito (proxy de errores de facturación).
- **MRR / suscripciones activas del SaaS** (depende de implementar el cobro de suscripción — hoy `NO VERIFICABLE`).
- **Liquidaciones pagadas a tiempo** por courier.

---

## 12. GAPS DETECTADOS

### Definiciones faltantes (requieren decisión del dueño)
1. **Credencial sandbox de Openfactura** para validación en vivo del adaptador real.
2. **Elección comercial del proveedor DTE definitivo** (Simplefactura vs Openfactura).
3. **Cuándo activar `emision_dte_real_habilitada`** por courier — punto de no retorno (compromete DTEs reales ante el SII).
4. **Proveedor de notificaciones** (Resend u otro) y de monitoreo (Sentry u otro).
5. **Modelo de cobro de la suscripción del SaaS** (Flow/Webpay PatPass) — no detectado en código.

### Funcionalidades ambiguas / parciales
- **Notificaciones (RF-014/016/050):** la lógica existe pero solo registra en bitácora; **no envía email/push real**. UX no debe prometer "te avisaremos por correo" hasta que Resend esté conectado.
- **PWA del conductor (RF-047):** es responsive (Tailwind) pero **no se verifica `manifest.json` ni service worker** — instalabilidad no confirmada.
- **Recuperación de contraseña:** Supabase Auth lo soporta nativamente, pero **no hay UI propia detectada**.
- **Cobro de suscripción al courier:** descrito en skill `pagos-chile` pero sin implementación verificable.

### Riesgos de producto
- **Dependencia de dominio no integrable:** la app de Flex es obligatoria → el conductor usa **dos apps**. Asumido por diseño, pero limita la experiencia. No diseñar POD propio.
- **Irreversibilidad del DTE:** la emisión real es un punto de no retorno; mitigado por la compuerta humana, pero exige proceso claro y copy inequívoco antes de emitir.
- **Multi-tenant:** un bug de RLS sería catastrófico (fuga entre couriers). Mitigado por la suite pgTAP (195/195), pero exige disciplina permanente al tocar esquema.

### Riesgos técnicos / deuda (de Fase 12 del audit)
| Hallazgo | Severidad |
|---|---|
| Sin observabilidad (Sentry) — jobs y errores no monitoreados | **Alta** |
| Sin respaldos verificados ni prueba de restauración | **Alta** |
| Notificaciones reales (email/push) sin implementar | Media |
| Adaptador DTE real no productivo (Openfactura esqueleto) | Media |
| Ventana de conciliación frágil (`actualizado_en` como proxy de fecha de entrega) | Media |
| `ml_user_id` sin UNIQUE (riesgo de colisión de cuentas ML entre couriers) | Baja-Media |
| Componentes de descarga duplicados (5 variantes `boton-descarga-*`) | Baja (deuda UI) |
| Grupo `(app)/` legado pendiente de limpieza | Baja |

---

## 13. ROADMAP RECOMENDADO

> Basado en los pendientes verificados del audit (Fase 15) y la deuda técnica. Prioriza lo que bloquea producción, luego el pulido, luego el crecimiento.

### Corto plazo (pre-producción — bloqueantes)
- **Observabilidad (Sentry)** — monitoreo de errores y salud de los 17 jobs. *Severidad alta.*
- **Respaldos + prueba de restauración** de la BD. *Severidad alta; crítico antes de operar dinero real.*
- **Notificaciones reales (Resend)** — conectar el envío de email para reconexión de ML, alertas de folios, morosidad e incidencias (hoy solo bitácora).
- **Decisión + activación del proveedor DTE real** — validar Openfactura en sandbox, decidir proveedor, definir el proceso de opt-in (`emision_dte_real_habilitada`) con revisión de seguridad.
- **Rotar el secret de ML** (anotado en memoria del proyecto).
- **Pulido UX/UI de las pantallas existentes** (siguiente fase declarada): dashboard, portal del seller y PWA del conductor.

### Mediano plazo (robustez y experiencia)
- **Verificar/implementar instalabilidad PWA** (manifest + service worker) para el conductor.
- **UI propia de recuperación de contraseña** (o decisión explícita de delegar a Supabase).
- **Timestamp de entrega dedicado** para robustecer la ventana de conciliación (hoy usa `actualizado_en`).
- **UNIQUE en `ml_user_id`** para evitar colisión de cuentas ML entre couriers.
- **Consolidar componentes de descarga** en un `BotonDescarga` parametrizable; limpiar grupo `(app)/` legado.
- **Pruebas E2E automatizadas de UI** (hoy hay 645 Vitest + 195 pgTAP, sin E2E de UI).
- **Cobro de la suscripción del SaaS al courier** (Flow/Webpay PatPass) — define el modelo de negocio del propio SaaS.

### Largo plazo (post-MVP / crecimiento)
- **Boleta de terceros para conductor formal (RF-040).**
- **Reportería ejecutiva avanzada (RF-049).**
- **Notificaciones al consumidor final (RF-051)** — WhatsApp/SMS/push.
- **App nativa del conductor (Expo)** — declarada para V2.
- **Pruebas de carga / rendimiento** con cientos de pedidos/día.
- **IA / optimizadores de ruteo** — explícitamente prohibidos en el MVP; cualquier propuesta es post-MVP y debe escalarse al dueño.

---

## 14. AGENT CONTEXT

> Sección de arranque para cualquier agente que participe en el desarrollo. Lee primero [CLAUDE.md](CLAUDE.md) (reglas no-negociables) y la sección relevante de [PROJECT_AUDIT.md](PROJECT_AUDIT.md). **Regla de oro: no introducir microservicios, colas propias, IA ni optimizadores de ruteo en el MVP.**

### Qué debe saber un agente UX
- **Inventario y jerarquía:** secciones [4](#4-módulos-del-sistema), [5](#5-mapa-funcional) y [8](#8-arquitectura-de-información). Wireframes conceptuales existentes en [docs/ux/](docs/ux/) (fase a/b/c).
- **Foco entrante:** el backend está firme y poblado. El trabajo es **pulir UX/UI** de dashboard, portal del seller y PWA del conductor — no agregar features.
- **Tres audiencias, tres lenguajes:** el courier interno (denso, operativo, multi-acción), el seller (tranquilizador, transaccional, "¿dónde está mi envío y cuánto pago?"), el conductor (mínimo, móvil, "mi ruta y mi pago").
- **Restricción dura:** el conductor usa **dos apps** (la de Flex es obligatoria y no integrable). **No diseñar captura de POD propia.**
- **Navegación por capacidad:** lo que un rol no puede hacer, no debe verlo. Respeta el filtrado por capacidad de la barra superior.
- **Localización:** CLP, español de Chile, zona Santiago. Reusar helpers de [src/lib/ui/](src/lib/ui/).

### Qué debe saber un agente Frontend
- **Stack:** Next.js 16 (App Router) + React 19 + Tailwind 4 + shadcn/ui (sobre Radix). Componentes base en [src/components/ui/](src/components/ui/).
- **Patrón obligado:** Server Component (`page.tsx`, carga datos con RLS) + componentes cliente (`"use client"`) + `actions.ts` (Server Actions). Componentes de negocio se colocan **junto a su ruta**, no en `src/components/`.
- **Autorización en UI:** usar las funciones `puede*()` de [capacidades.ts](src/modules/identidad/capacidades.ts) — **nunca replicar la matriz de permisos**.
- **No duplicar:** consolidar los 5 `boton-descarga-*` en un componente único. Reusar helpers de [src/lib/ui/](src/lib/ui/) (moneda, estados, comunas).
- **No agregar pantallas en el grupo legado `(app)/`** — usar `(tenant)`.

### Qué debe saber un agente Backend
- **Mapa:** sección [6 de flujos](#6-flujos-de-negocio) + Fase 6 del audit. Cuatro superficies: Server Actions, route handlers, jobs Inngest, lógica de dominio pura.
- **Invariantes que NO se rompen:** (1) ningún cron emite DTE — la emisión es acción humana; (2) bitácora **antes** del efecto externo, con `actorUsuarioId`; (3) eventos Inngest tipados en [src/lib/inngest/eventos.ts](src/lib/inngest/eventos.ts) como único contrato cross-módulo; (4) idempotencia de jobs; (5) escritura de dinero solo desde `service_role`.
- **Secuencia por feature:** `arquitecto → base-datos-rls → backend/integraciones → frontend → qa`. Respetar fases A→B→C.
- **Nunca:** acoplar la emisión DTE al cierre de período; llamar APIs externas desde el núcleo (usar adaptadores de `integraciones`); escribir secretos en logs/URLs.

### Qué debe saber un agente QA
- **Estado funcional:** sección [5](#5-mapa-funcional) + [checklist-pruebas-funcionales-mvp.md](checklist-pruebas-funcionales-mvp.md).
- **Prioridad #1:** aislamiento multi-tenant (pgTAP en [supabase/tests/database/](supabase/tests/database/)) — probar con **tokens de distintos tenants/sellers/conductores a nivel API/BD**, no solo UI. Un fallo aquí es fuga de datos entre clientes.
- **Prioridad #2:** reglas de dinero (Vitest) — idempotencia, "reintento no dobla cobro", reagendado no penaliza conductor, gasto propio no cobra, compuerta humana de facturación.
- **Comandos:** `npm test` (Vitest, 645/645), `npx supabase test db` (pgTAP, 195/195), `npm run typecheck`. CI tiene piso de cobertura.
- **Pendiente:** no hay E2E de UI automatizados — candidato a construir.

### Qué debe saber un agente Copywriter
- **Tono:** español de Chile, claro, sin jerga. CLP y formatos chilenos.
- **Zonas de microcopy críticas:** diálogos de **emisión/cierre de factura** (deben dejar claro que el DTE es irreversible antes de emitir), alertas de reconexión de ML, descripciones de roles ([equipo/descripciones-roles.ts](src/app/\(tenant\)/equipo/descripciones-roles.ts)), estados de pedido/cobro.
- **No prometer lo que no existe:** las notificaciones por email aún no se envían (solo bitácora). No escribir "te enviaremos un correo" hasta que Resend esté conectado.
- **Pendiente:** plantillas de email reales (cuando se conecte Resend).

### Qué debe saber un agente IA / Product
- **Restricción dura:** [CLAUDE.md](CLAUDE.md) **prohíbe IA y optimizadores de ruteo en el MVP**. Cualquier propuesta de IA es post-MVP y debe escalarse al dueño.
- **Diferenciador a no perder:** el motor entrega→dinero. El ruteo está commoditizado y no es el foco.
- **Decisiones que requieren al dueño:** proveedor DTE definitivo, activación de emisión DTE real, proveedor de notificaciones/monitoreo, modelo de cobro de suscripción (ver sección [12](#12-gaps-detectados)).
- **Stack de modelos (si en el futuro aplica):** el proyecto usa Claude; default a los modelos más capaces (Opus 4.8).

---

*Documento estratégico derivado de [PROJECT_AUDIT.md](PROJECT_AUDIT.md). Para detalle técnico verificado, consultar el audit y `docs/`. Mantener al día tras cambios estructurales o de roadmap.*
