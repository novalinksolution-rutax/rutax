# PROJECT_AUDIT.md — Auditoría maestra del sistema

> **Propósito.** Documento único de verdad (Single Source of Truth) generado por exploración directa del repositorio. Pensado para que agentes posteriores (UX/UI, Frontend, Backend, QA, Product, Copywriting, IA) trabajen sobre una base verificada.
>
> **Método.** Todo lo aquí escrito se verificó leyendo código, migraciones, configuración y documentación del repo. Lo que **no** puede confirmarse desde el código se marca explícitamente como `NO VERIFICABLE`.
>
> **Fecha de auditoría.** 2026-06-13 · **Rama:** `master` · **Commit base de referencia del checklist:** `373f1e6` (+ commits posteriores hasta `996b80e`).
>
> **Convención de enlaces.** Las rutas son relativas a la raíz del workspace y clicables.

---

## FASE 1 — IDENTIFICACIÓN GENERAL

### Resumen ejecutivo

**Producto:** SaaS B2B vertical para empresas de última milla (couriers) que operan **Mercado Libre Flex + same-day** en Santiago de Chile.

**Tipo de producto:** Plataforma web multi-tenant (monolito modular Next.js + Supabase) con portal de cliente (seller) y PWA de conductor.

**Tipo de SaaS:** B2B vertical, neutral, multi-tenant. El fundador **no opera entregas**; solo provee el software. Cada tenant es un courier independiente.

**Problema que resuelve:** los couriers de última milla pierden la "trastienda de dinero" entre lo que entregan y lo que cobran/liquidan. El sistema cierra el lazo **entrega → dinero**: cada entrega genera, automáticamente, su línea de cobro al seller y su línea de liquidación al conductor, ambas conciliadas. El ruteo está commoditizado y **NO es el foco**.

**Diferenciador central (verificado en código):** el **motor entrega→dinero** (módulo [src/modules/dinero/](src/modules/dinero/)). Una entrega es la unidad atómica que produce cobro + liquidación + conciliación.

**Restricción dura del dominio:** la app de escaneo/POD de Mercado Envíos Flex es **obligatoria y no integrable**. El software orquesta alrededor de ella; el conductor usa **dos apps**. Documentado en [CLAUDE.md](CLAUDE.md) y reflejado en que no existe captura de POD propia (ver checklist sección D nota de alcance).

### Público objetivo

| Actor | Descripción |
|---|---|
| **Courier (tenant)** | Empresa de última milla. Cliente que paga la suscripción del SaaS. |
| **Seller** | Cliente del courier (vendedor de Mercado Libre). Usa el portal. |
| **Conductor** | Repartidor del courier (formal/dependiente o informal/independiente). Usa la PWA. |
| **Plataforma (super_admin)** | El fundador/operador del SaaS. |

### Roles existentes (verificado en [src/modules/identidad/roles.ts](src/modules/identidad/roles.ts) y enum `identidad.rol_usuario`)

`super_admin`, `dueno`, `supervisor`, `coordinador`, `administracion`, `conductor`, `seller`.

El `tipo_usuario` (categoría macro) es: `interno` | `seller` | `conductor` | `super_admin`. Los roles `dueno/supervisor/coordinador/administracion` son todos `tipo_usuario = interno`.

### Casos de uso principales (el "lazo completo", verificado en checklist sección K)

1. Seller conecta su cuenta de Mercado Libre por OAuth.
2. Llegan pedidos Flex por webhook + sondeo de respaldo (sin doble digitación).
3. El courier asigna pedidos a conductores vía manifiestos.
4. Los estados de entrega se sincronizan desde la API de ML.
5. Se registran incidencias (ausente, dirección errónea, reagendado…).
6. Cada entrega genera **línea de cobro (al seller) + línea de liquidación (al conductor)**.
7. Se cierra el período → se concilia → una persona **aprueba y emite** el DTE (factura tipo 33) bajo el RUT del courier.
8. El seller ve/descarga su factura; el conductor ve su liquidación.
9. La cobranza (pago del seller al courier vía transferencia) se concilia con Fintoc.

---

## FASE 2 — MAPA COMPLETO DEL SISTEMA

El sistema es un **monolito modular**. Hay dos planos: **módulos de dominio** (`src/modules/`) y **esquemas Postgres** (uno por módulo de negocio). Límites estrictos: el núcleo no llama APIs externas directo (lo hacen los adaptadores de `integraciones`).

| Módulo | Esquema BD | Descripción | Estado |
|---|---|---|---|
| **identidad** | `identidad` | Auth, tenants, RBAC (capacidades en código), onboarding de courier/seller/conductor, invitaciones, secretos cifrados, tarifas, conexiones ML, bitácora de auditoría. | ✅ Implementado (Fase A) |
| **operacion** | `operacion` | Pedidos (Flex + same-day), ingesta, asignación, manifiestos, máquina de estados, incidencias, evidencias, backfill, métricas del dashboard. | ✅ Implementado (Fase B) |
| **dinero** | `dinero` | Motor entrega→dinero: líneas de cobro/liquidación, períodos, facturación DTE, liquidaciones de conductor, conciliación (detective), cobranza Fintoc, notas de crédito. | ✅ Implementado y verificado E2E con datos demo (Fase C) |
| **integraciones** | — (usa `identidad.secretos_cifrados`) | Adaptadores aislados: Mercado Libre (OAuth, shipments, etiquetas, salud), DTE (Simplefactura stub / Openfactura esqueleto), pagos (Fintoc), cifrado de secretos, resiliencia (backoff). | ✅ Implementado (ML, Fintoc, DTE sandbox) |
| **infra** (transversal) | `infra` | Rate limiting (fixed-window counter). Excepción documentada a "toda tabla lleva tenant_id". | ✅ Implementado (#7) |

### Submódulos / áreas funcionales detectadas

- **Administración / Configuración del courier (onboarding):** [src/app/(tenant)/onboarding/](src/app/(tenant)/onboarding/) — DTE, folios CAF, tarifas, cobranza.
- **Usuarios / Equipo:** [src/app/(tenant)/equipo/](src/app/(tenant)/equipo/) + invitaciones.
- **Dashboard:** [src/app/(tenant)/dashboard/page.tsx](src/app/(tenant)/dashboard/page.tsx).
- **Workflow operativo principal:** [src/app/(tenant)/operaciones/](src/app/(tenant)/operaciones/) + [manifiestos/](src/app/(tenant)/manifiestos/).
- **Facturación / Dinero:** [src/app/(tenant)/dinero/](src/app/(tenant)/dinero/) — períodos, liquidaciones, conciliación, cobranza.
- **Integraciones:** OAuth ML ([src/app/oauth/ml/callback/](src/app/oauth/ml/callback/)), webhooks ([src/app/api/webhooks/](src/app/api/webhooks/)).
- **Portal del seller:** [src/app/portal/](src/app/portal/).
- **PWA del conductor:** [src/app/conductor/](src/app/conductor/).
- **Reportes:** parcial — métricas del dashboard ([src/modules/operacion/metricas.ts](src/modules/operacion/metricas.ts)) y exportación de datos (RNF-13). Reportería ejecutiva avanzada (RF-049) está fuera del MVP.

---

## FASE 3 — MAPA DE RUTAS

Next.js App Router. **No hay `middleware.ts`** (verificado: glob sin resultados). La protección de rutas se hace en cada **layout** y **server action** vía `obtenerSesionActual()` ([src/lib/identidad/usuario-actual-servidor.ts](src/lib/identidad/usuario-actual-servidor.ts)) + capacidades RBAC, reforzado en BD por RLS. Los grupos de App Router: `(tenant)` (courier interno), `portal` (seller), `conductor` (PWA), público (login/registro/invitación).

### Rutas de página (UI)

| Ruta | Propósito | Protección | Estado |
|---|---|---|---|
| `/` | Landing / redirección inicial ([src/app/page.tsx](src/app/page.tsx)) | Pública | ✅ |
| `/login` | Login de usuarios internos del courier | Pública | ✅ |
| `/registro` | Alta de empresa courier (crea tenant, RF-006) | Pública | ✅ |
| `/registro/revisa-tu-correo` | Confirmación de correo post-registro | Pública | ✅ |
| `/activar-cuenta` | Activación de cuenta invitada | Sesión (estado `invitado`) | ✅ |
| `/invitacion/[token]` | Aceptar invitación (interno/seller/conductor) | Token (fuera de RLS normal) | ✅ |
| `/auth/confirm` | Confirmación de email (route handler Supabase) | Pública (token) | ✅ |
| `/oauth/ml/callback` | Callback OAuth de Mercado Libre | Sesión seller | ✅ |
| **(tenant) — courier interno** | | Layout [(tenant)/layout.tsx](src/app/(tenant)/layout.tsx): exige sesión, no-invitado, tenant; redirige conductor→/conductor, seller→/portal | |
| `/dashboard` | Dashboard operativo del dueño (RF-046) | Role-based (`ver_reportes_ejecutivos`) | ✅ |
| `/operaciones` | Panel multi-seller de pedidos (RF-019) | Role-based (operativo) | ✅ |
| `/operaciones/[pedidoId]` | Detalle de pedido: estado, incidencia, reasignación, etiqueta | Role-based | ✅ |
| `/operaciones/incidencias` | Gestión de incidencias | Role-based (`gestionar_incidencias`) | ✅ |
| `/manifiestos` | Listado de manifiestos | Role-based (operativo) | ✅ |
| `/manifiestos/nuevo` | Crear manifiesto | Role-based (`generar_manifiestos`) | ✅ |
| `/manifiestos/[manifiestoId]` | Detalle de manifiesto (con orden de paradas) | Role-based | ✅ |
| `/manifiestos/[manifiestoId]/asignar` | Asignar pedidos al manifiesto | Role-based (`asignar_y_reasignar_pedidos`) | ✅ |
| `/dinero/periodos` | Períodos de cobro por seller | Role-based (`emitir_facturas`) | ✅ |
| `/dinero/periodos/[periodoId]` | Detalle período: cerrar, emitir factura, emitir NC | Role-based | ✅ |
| `/dinero/liquidaciones` | Liquidaciones de conductores | Role-based (`gestionar_liquidaciones_conductores`) | ✅ |
| `/dinero/conciliacion` | Eventos de conciliación (descuadres) | Role-based (`ver_conciliacion`) | ✅ |
| `/dinero/cobranza` | Pagos recibidos (Fintoc) | Role-based (`ver_conciliacion`) | ✅ |
| `/onboarding` | Panel de onboarding del courier | Sesión interna | ✅ |
| `/onboarding/dte` | Certificado digital + proveedor DTE (RF-007/008) | Role-based (`gestionar_configuracion_dte`) | ✅ |
| `/onboarding/folios` | Folios CAF | Role-based | ✅ |
| `/onboarding/tarifas` | Gestión de tarifas (RF-009) | Role-based (`gestionar_tarifas`) | ✅ |
| `/onboarding/cobranza` | Conexión de cobranza Fintoc | Role-based | ✅ |
| `/equipo` | Gestión de usuarios internos e invitaciones (RF-005) | Role-based (`gestionar_usuarios_y_roles`) | ✅ |
| `/sellers` | Listado de sellers del courier | Sesión interna | ✅ |
| `/sellers/invitar` | Invitar seller (RF-010) | Role-based | ✅ |
| `/configuracion/exportar-datos` | Exportar datos del courier (RNF-13) | Role-based (`ver_bitacora_auditoria`) | ✅ |
| **portal — seller** | | Layout [portal/layout.tsx](src/app/portal/layout.tsx) | |
| `/portal/login` | Login del seller | Pública | ✅ |
| `/portal` | Home del portal (panel conexión ML) | Sesión seller | ✅ |
| `/portal/bienvenida` | Onboarding del seller | Sesión seller | ✅ |
| `/portal/conectar-ml` | Conectar/reconectar Mercado Libre (RF-015) | Sesión seller | ✅ |
| `/portal/pedidos` | Envíos/tracking del seller | Sesión seller (P2 RLS) | ✅ |
| `/portal/pedidos/nuevo` | Solicitar same-day (RF-020) | Sesión seller (`solicitar_same_day`) | ✅ |
| `/portal/incidencias` | Incidencias propias (RF-048) | Sesión seller | ✅ |
| `/portal/cobros` | Estado de cuenta / cartola (RF-043) | Sesión seller | ✅ |
| `/portal/cobros/[periodoId]` | Detalle de cobro + descarga factura PDF (RF-037) | Sesión seller | ✅ |
| **conductor — PWA** | | Layout [conductor/layout.tsx](src/app/conductor/layout.tsx) | |
| `/conductor` | Home del conductor | Sesión conductor | ✅ |
| `/conductor/manifiesto` | Manifiesto del día + orden de paradas (RF-047) | Sesión conductor (P3 RLS) | ✅ |
| `/conductor/manifiesto/[pedidoId]` | Detalle de pedido en ruta | Sesión conductor | ✅ |
| `/conductor/liquidaciones` | Liquidación propia (RF-042) | Sesión conductor | ✅ |

### Rutas de API (route handlers)

| Ruta | Método | Propósito | Protección | Estado |
|---|---|---|---|---|
| `/api/inngest` | GET/POST/PUT | Endpoint del orquestador Inngest (registro/ejecución de jobs) | Firma Inngest (`INNGEST_SIGNING_KEY`) | ✅ |
| `/api/webhooks/ml/shipments` | POST | Webhook de notificaciones de envíos de Mercado Libre | Validación por `application_id` + rate limit + consulta con token del seller | ✅ |
| `/api/webhooks/fintoc/[tenantId]` | POST | Webhook de pagos Fintoc por tenant | Firma `Fintoc-Signature` con secreto del tenant + rate limit | ✅ |
| `/api/webhooks/fintoc` | POST | Endpoint legado/genérico de Fintoc | (ver `route.ts`) | ✅ |
| `/api/courier/exportar-datos` | GET | Exportación JSON de datos del courier (RNF-13) | Sesión + `ver_bitacora_auditoria` (401/403/200) | ✅ |
| `/api/operaciones/[pedidoId]/etiqueta` | GET | Descarga de etiqueta de envío ML (PDF) | Sesión + `asignar_y_reasignar_pedidos` | ✅ |

> **Nota ML webhooks:** ML marketplace **NO firma** sus notificaciones (verificado en vivo, sin header `x-signature`). La variable `WEBHOOKS_ML_SECRET` quedó **obsoleta** (ver [.env.example](.env.example) líneas 60-65). La validación es por `application_id` + re-consulta del recurso con el token del seller.

---

## FASE 4 — MAPA DE PANTALLAS

> Convención: cada pantalla es un `page.tsx` (Server Component que carga datos con RLS) + componentes cliente (`*.tsx` con `"use client"`) + `actions.ts` (Server Actions). Patrón consistente en todo el repo.

### Área courier interno `(tenant)`

| Pantalla | Objetivo | Componentes clave | Datos consumidos | Estado |
|---|---|---|---|---|
| **Dashboard** | Vista de un vistazo del día: comprometido vs entregado, conductores listos/activos, paquetes por comuna, rezagados de ayer, incidencias, salud de conexiones, alertas (folios) | `BannerOnboarding`, `BarraSuperior`, tarjetas | `obtenerMetricasDelDia()` ([metricas.ts](src/modules/operacion/metricas.ts)) | ✅ Completo |
| **Pedidos (operaciones)** | Panel multi-seller con filtros | `filtros-pedidos.tsx`, `formulario-same-day.tsx` | `public.pedidos` (RLS P1) | ✅ |
| **Detalle de pedido** | Cambio de estado, incidencia, reasignación, descarga de etiqueta | `drawer-cambio-estado.tsx`, `drawer-incidencia.tsx`, `dialog-reasignacion.tsx`, `boton-descargar-etiqueta.tsx` | pedido + incidencias + asignaciones | ✅ |
| **Incidencias** | Listado y gestión de incidencias | `panel-incidencia.tsx` | `public.incidencias` | ✅ |
| **Manifiestos** | Listado / crear / asignar / confirmar | `formulario.tsx`, `selector-pedidos-manifiesto.tsx`, botones confirmar/cancelar/quitar | `public.manifiestos`, `asignaciones_pedido` | ✅ |
| **Períodos (dinero)** | Cerrar período, emitir factura/NC | `dialog-cerrar-periodo.tsx`, `dialog-emitir-factura.tsx`, `dialog-emitir-nota-credito.tsx`, `boton-descarga-documento.tsx` | `periodos_cobro`, `documentos_dte` | ✅ |
| **Liquidaciones** | Ver y marcar pagadas; descargar PDF | `dialog-marcar-pagada.tsx`, `boton-descarga-pdf-liquidacion.tsx` | `liquidaciones` | ✅ |
| **Conciliación** | Revisar descuadres detectados | `menu-acciones-conciliacion.tsx` | `eventos_conciliacion` (solo dueño/admin) | ✅ |
| **Cobranza (Pagos)** | Pagos Fintoc; atribuir/descartar | `menu-acciones-pago.tsx` | `pagos_recibidos` | ✅ |
| **Onboarding** | Pasos de configuración del courier | `panel-onboarding.tsx`, `panel-folios-caf.tsx`, `panel-tarifas.tsx`, `formulario-configuracion-dte.tsx`, `formulario-conexion-cobranza.tsx` | `courier_config_dte`, `folios_caf`, `tarifas`, `courier_config_cobranza` | ✅ |
| **Equipo** | Invitar/gestionar usuarios internos | `formulario-invitacion.tsx`, `panel-equipo.tsx`, `descripciones-roles.ts` | `usuarios_perfil`, `invitaciones` | ✅ |
| **Sellers** | Listado e invitación de sellers | `formulario-invitar-seller.tsx` | `sellers` | ✅ |
| **Exportar datos** | Descarga JSON del tenant | botón → `/api/courier/exportar-datos` | múltiples tablas (excluye secretos) | ✅ |

### Portal del seller

| Pantalla | Objetivo | Datos | Estado |
|---|---|---|---|
| **Home / Conexión ML** | Estado de conexión, reconexión | `panel-conexion-ml.tsx`, `pantalla-conexion-ml.tsx` | `conexiones_seller_ml` (P2) | ✅ |
| **Pedidos** | Envíos y tracking propios | `pedidos` (P2) | ✅ |
| **Nuevo same-day** | Solicitar entrega same-day | `formulario-nuevo-pedido.tsx` | ✅ |
| **Incidencias** | Seguimiento de incidencias propias | `incidencias` (P2) | ✅ |
| **Cobros** | Estado de cuenta + descarga factura PDF | `boton-descarga-factura-pdf.tsx` | `periodos_cobro`, `documentos_dte` (P2) | ✅ |

### PWA del conductor

| Pantalla | Objetivo | Datos | Estado |
|---|---|---|---|
| **Manifiesto del día** | Ruta/paradas ordenadas, "listo para salir" | `boton-listo-para-salir.tsx`, `ordenarParadasPorComunaYDireccion()` | `manifiestos`, `pedidos` (P3) | ✅ |
| **Detalle de parada** | Info del pedido en ruta | `pedidos` (P3) | ✅ |
| **Liquidaciones** | Cuánto le toca | `boton-descarga-liquidacion.tsx` | `liquidaciones`, `lineas_liquidacion` (P3) | ✅ |

> **PWA:** el stack declara PWA para MVP, pero **NO VERIFICABLE** que exista `manifest.json` o service worker configurado (no aparece en el listado de archivos; el checklist G-03 confirma que no se verificó instalación PWA real). Es responsive (Tailwind).

---

## FASE 5 — MAPA DE COMPONENTES

### Componentes UI (Design System base — shadcn/ui sobre Radix)

Ubicación: [src/components/ui/](src/components/ui/). Configurado vía [components.json](components.json) (shadcn). Inventario verificado:

`alert`, `avatar`, `badge`, `button`, `card`, `checkbox`, `dialog`, `dropdown-menu`, `input`, `label`, `progress`, `select`, `separator`, `sheet`, `skeleton`, `sonner` (toasts), `table`, `tabs`, `textarea`, `tooltip`.

Estos son la **base del Design System**. Consistentes (todos generados por shadcn, mismo patrón `class-variance-authority` + `tailwind-merge`).

### Componentes de aplicación (app-shell / onboarding)

- [src/components/app-shell/barra-superior.tsx](src/components/app-shell/barra-superior.tsx) — navegación condicionada por capacidad RBAC.
- [src/components/onboarding/banner-onboarding.tsx](src/components/onboarding/banner-onboarding.tsx) — barra de progreso de onboarding.
- [src/components/onboarding/estado-pantalla.tsx](src/components/onboarding/estado-pantalla.tsx).

### Componentes de negocio (colocados junto a su ruta)

El proyecto **NO centraliza** los componentes de negocio en `src/components/`; los coloca junto a su `page.tsx` (patrón App Router). Ejemplos: diálogos (`dialog-emitir-factura.tsx`, `dialog-cerrar-periodo.tsx`, `dialog-marcar-pagada.tsx`), drawers (`drawer-cambio-estado.tsx`, `drawer-incidencia.tsx`), formularios (`formulario-same-day.tsx`, `formulario-invitacion.tsx`), botones de descarga (varios `boton-descarga-*.tsx`).

### Helpers de UI compartidos (evitar duplicación — regla de [CLAUDE.md](CLAUDE.md))

- [src/lib/ui/formato-moneda.ts](src/lib/ui/formato-moneda.ts) — formato CLP.
- [src/lib/ui/traduccion-estados.ts](src/lib/ui/traduccion-estados.ts) — traducción/colores de estados.
- [src/lib/ui/comunas-rm.ts](src/lib/ui/comunas-rm.ts) — catálogo de comunas de la Región Metropolitana.
- [src/lib/formato-cl.ts](src/lib/formato-cl.ts) — formatos chilenos.
- [src/lib/utils.ts](src/lib/utils.ts) — `cn()` (clsx + tailwind-merge).

### Detección de duplicación / candidatos a Design System

- **Botones de descarga:** existen al menos 4 variantes (`boton-descarga-documento.tsx`, `boton-descarga-pdf-liquidacion.tsx`, `boton-descarga-factura-pdf.tsx`, `boton-descarga-liquidacion.tsx`, `boton-descargar-etiqueta.tsx`). **Candidato a componente único** `BotonDescarga` parametrizable. **Deuda: Baja.**
- **Paneles de conexión ML:** `panel-conexion-ml.tsx` (portal home) y `pantalla-conexion-ml.tsx` (conectar-ml) + `compartido.ts` — ya hay extracción parcial; revisar consolidación. **Deuda: Baja.**
- **Helpers de presentación** (moneda/estados) ya están centralizados — buena práctica a mantener.

> No se detectaron componentes UI **inconsistentes** (todo deriva de shadcn). El riesgo es la dispersión de componentes de negocio, mitigada por la convención App Router.

---

## FASE 6 — MAPA DE BACKEND

El backend tiene cuatro superficies: **(a) Server Actions** (`actions.ts` por ruta), **(b) route handlers** (`/api/*`), **(c) jobs Inngest** (`src/modules/*/jobs/`), **(d) lógica de dominio pura** (módulos). Las reglas de negocio viven en los módulos; las actions y jobs orquestan.

### Acciones de negocio núcleo (Server Actions / funciones de dominio)

| Función / Acción | Módulo | Reglas de negocio | Gating |
|---|---|---|---|
| `crearSameDayAction` | portal/operaciones | Crea pedido same-day; flag `esGastoPropio` | `solicitar_same_day` |
| `asignarPedidosAManifiesto` | [operacion/manifiestos.ts](src/modules/operacion/manifiestos.ts) | Asignación/reasignación, una asignación activa por pedido | `asignar_y_reasignar_pedidos` |
| `crearManifiesto` / `confirmarManifiesto` | operacion/manifiestos.ts | Manifiesto requiere ≥1 pedido; registra bitácora | `generar_manifiestos` |
| `actualizarEstadoPedido` | [operacion/pedidos.ts](src/modules/operacion/pedidos.ts) | Máquina de estados; publica evento financiero post-commit | interno |
| `resolverAfectacion` (incidencias) | [operacion/incidencias.ts](src/modules/operacion/incidencias.ts) | `reagendado` afecta cobro pero NO liquidación | `gestionar_incidencias` |
| `evaluarElegibilidad` | [dinero/motor.ts](src/modules/dinero/motor.ts) | Núcleo: decide si una entrega genera cobro/liquidación; gasto propio ⇒ sin cobro | (motor, service_role) |
| `cerrarPeriodoManualmente` | [dinero/acciones.ts](src/modules/dinero/acciones.ts) | Cierra período; bitácora ANTES del evento; con `actorUsuarioId` | `emitir_facturas`/`aprobar_facturacion` |
| `emitirFacturaPeriodo` | dinero/acciones.ts | **Compuerta humana**: período debe estar `cerrado`; emisión real exige opt-in | `puedeEmitirFacturas` |
| `emitirNotaCreditoPeriodo` | dinero/acciones.ts | Anulación total (DTE 61); motivo obligatorio; solo período `facturado` | `puedeEmitirFacturas` |
| `marcarLiquidacionPagada` | dinero | Estado `emitida`→`pagada`; con autor | `gestionar_liquidaciones_conductores` |
| `atribuirPagoManualmente` / `descartarPago` | [dinero/aplicar-pago.ts](src/modules/dinero/aplicar-pago.ts) | Conciliación manual; reversa imputación previa | `ver_conciliacion` |
| `resolverEventoConciliacion` | dinero | Marca evento resuelto/ignorado; con autor | `ver_conciliacion` |

### Endpoints (route handlers)

| Endpoint | Método | Función |
|---|---|---|
| `/api/inngest` | GET/POST/PUT | Registro y ejecución de los 17 jobs Inngest |
| `/api/webhooks/ml/shipments` | POST | Ingesta de notificaciones de envíos ML → encola `ml/shipment.actualizado` |
| `/api/webhooks/fintoc/[tenantId]` | POST | Recepción de pagos → bitácora → encola `dinero/pago.recibido` |
| `/api/courier/exportar-datos` | GET | Exporta JSON del tenant (excluye secretos) |
| `/api/operaciones/[pedidoId]/etiqueta` | GET | Proxy a `/shipment_labels` de ML |

### Reglas de negocio invariantes (verificadas en [CLAUDE.md](CLAUDE.md) + código)

1. **Compuerta de aprobación de facturación:** ningún cron emite DTE. El cron `cerrar-periodo` solo cierra y dispara conciliación. La emisión exige acción humana (`emitirFacturaPeriodo`).
2. **Bitácora antes que efectos externos, y con autor** (`actorUsuarioId` = `sesion.usuarioId`, RNF-04).
3. **Eventos Inngest tipados** en [src/lib/inngest/eventos.ts](src/lib/inngest/eventos.ts) (contratos entre módulos).
4. **Adaptador DTE en sandbox + opt-in real** (`DTE_SANDBOX_MODE=true` + `emision_dte_real_habilitada` por courier).
5. **Idempotencia de jobs** por `pedido_id`/`periodo_id`/`movimiento_externo_id` (ON CONFLICT DO NOTHING / upsert).

### Servicios de infraestructura

- [src/lib/supabase/server.ts](src/lib/supabase/server.ts) — cliente SSR (RLS del usuario).
- [src/lib/supabase/client.ts](src/lib/supabase/client.ts) — cliente browser.
- [src/lib/supabase/service-role.ts](src/lib/supabase/service-role.ts) — cliente con RLS bypass (solo jobs/servidor).
- [src/lib/rate-limit/index.ts](src/lib/rate-limit/index.ts) — limitador fail-open vía RPC `rate_limit_consumir`.
- [src/lib/validacion/esquemas.ts](src/lib/validacion/esquemas.ts) — validación Zod en bordes no confiables.
- [src/modules/integraciones/resiliencia.ts](src/modules/integraciones/resiliencia.ts) — `reintentarConBackoff`, `esErrorReintentable`.

---

## FASE 7 — MAPA DE BASE DE DATOS

**Motor:** PostgreSQL (Supabase). **Seguridad:** Row-Level Security (RLS) en toda tabla de negocio. **Esquemas:** `identidad`, `operacion`, `dinero`, `infra` + vistas espejo en `public` (con `security_invoker = true`) para exposición vía PostgREST. Migraciones versionadas e idempotentes en [supabase/migrations/](supabase/migrations/).

### Esquema `identidad`

| Tabla | Campos relevantes | Notas |
|---|---|---|
| **tenants** | `id`, `nombre_fantasia`, `razon_social`, `rut` (check módulo-11), `estado` (activo/suspendido/onboarding), `plan_id`, `zona_horaria`, `seller_id_gasto_propio` | Raíz. **Sin `tenant_id`** (es la raíz). |
| **usuarios_perfil** | `id` (=auth.users.id), `tenant_id`, `nombre_completo`, `tipo_usuario`, `seller_id`, `driver_id`, `rol`, `estado` | 1:1 con `auth.users`. Fuente de los claims JWT. Columnas sensibles protegidas por trigger. |
| **invitaciones** | `tenant_id`, `email`, `tipo_usuario`, `rol`, `seller_id`, `driver_id`, `token` (uk), `estado`, `expira_en` | Un solo uso; se resuelve por token (service_role). |
| **sellers** | `tenant_id`, `razon_social`, `rut`, `nombre_contacto`, `email_contacto`, `estado` | uk `(tenant_id, rut)`. |
| **conductores** | `tenant_id`, `nombre_completo`, `rut`, `tipo_relacion` (dependiente/independiente — Ley 21.431), `estado` | uk `(tenant_id, rut)`. |
| **secretos_cifrados** | `tenant_id`, `tipo_secreto`, `valor_cifrado` (bytea), `metadata` (jsonb, check sin secretos), `referencia_externa_id` (uk), `vence_en` | **Tabla más restrictiva**: sin vista en `public`, sin grants a authenticated. Solo service_role. |
| **courier_config_dte** | `tenant_id` (pk), `proveedor_dte`, `proveedor_credenciales_ref`, `certificado_digital_ref`, `certificado_vence_en`, `estado_certificacion`, `emision_dte_real_habilitada` | 1:1 con tenant. Solo referencias opacas a secretos. |
| **folios_caf** | `tenant_id`, `tipo_documento`, `folio_desde/hasta/actual`, `archivo_caf_ref`, `estado` | Folios SII. |
| **courier_config_cobranza** | `tenant_id` (pk), `link_token_ref`, `secreto_webhook_ref`, `cuenta_banco_alias`, `estado_conexion` | 1:1 con tenant (Fintoc). Solo refs opacas. |
| **tarifas** | `tenant_id`, `seller_id` (null=default), `tipo_entrega`, `zona`, `modo_calculo`, `monto_clp`, `monto_conductor_clp`, `vigente_desde/hasta`, `estado` | Versionadas por vigencia. El seller NO ve montos pactados. |
| **conexiones_seller_ml** | `tenant_id`, `seller_id` (uk), `ml_user_id`, `access_token_ref`, `refresh_token_ref`, `token_expira_en`, `estado_salud`, `ultima_sync_exitosa_en`, `desconectada_desde`, `ultimo_error` | OAuth 1:1 del seller. Tokens solo como refs opacas. |
| **bitacora_auditoria** | `id` (bigint identity), `tenant_id`, `actor_usuario_id`, `actor_tipo`, `accion`, `entidad_tipo`, `entidad_id`, `detalle` (jsonb, check sin secretos), `creado_en` | **Append-only** (sin UPDATE/DELETE). RNF-04. |

### Esquema `operacion`

| Tabla | Campos relevantes | Notas |
|---|---|---|
| **pedidos** | `tenant_id`, `seller_id`, `tipo_pedido` (flex/same_day), `origen` (ml_ingesta/same_day_manual/backfill), `ml_order_id`, `ml_shipment_id` (uk con tenant), `estado` (9 estados), `estado_ml`, `subestado_ml`, `driver_id_asignado` (denorm., trigger), datos destinatario, `fecha_compromiso`, `tarifa_aplicable_id`, `monto_cobro_clp`, `monto_liquidacion_clp`, `cobro_generado`, `liquidacion_generada` | Tabla central. Columnas de Fase C desde el inicio. |
| **manifiestos** | `tenant_id`, `driver_id`, `nombre`, `fecha_operacion`, `estado` (borrador→confirmado→en_ruta→completado/cancelado), `creado_por_usuario_id`, `confirmado_en`, `completado_en` | Agrupa pedidos por conductor/turno. |
| **asignaciones_pedido** | `tenant_id`, `pedido_id`, `manifiesto_id`, `driver_id` (denorm.), `seller_id` (denorm.), `activa`, auditoría | Una activa por pedido (unique parcial). Triggers de consistencia. |
| **incidencias** | `tenant_id`, `pedido_id`, `seller_id` (denorm.), `tipo` (7 tipos), `estado`, `afecta_cobro`, `afecta_liquidacion`, auditoría | Fase C consume `afecta_*`. |
| **evidencias_incidencia** | `tenant_id`, `incidencia_id`, `seller_id`, `tipo_archivo`, `storage_path`, `nombre_original` | Append-only. Path en Storage privado (signed URLs en app). |
| **intentos_backfill** | `tenant_id`, `conexion_ml_id`, `seller_id`, `desde`, `hasta`, `estado`, `pedidos_recuperados`, `error` | **Invisible a authenticated** (solo service_role). Idempotencia de backfill. |

### Esquema `dinero`

| Tabla | Campos relevantes | Notas |
|---|---|---|
| **config_periodos** | `tenant_id`, `seller_id` (null=default), `tipo_periodo` (semanal/quincenal/mensual), `dia_cierre`, `activa` | Solo internos. |
| **periodos_cobro** | `tenant_id`, `seller_id`, `fecha_inicio/fin`, `tipo_periodo`, `estado` (abierto/cerrado/facturado/anulado), `total_lineas`, `monto_total_clp`, `documento_dte_id`, `estado_cobro` (no_aplica/pendiente/parcial/pagado), `monto_pagado_clp`, `pagado_en`, anulación (`motivo`, `anulado_en`, `anulado_por_usuario_id`) | Agrupa líneas de cobro. P1+P2. |
| **documentos_dte** | `tenant_id`, `seller_id`, `periodo_cobro_id`, `tipo_documento` (33=factura/61=NC), `folio`, `fecha_emision`, `monto_neto/iva/total_clp`, `xml_dte_ref`, `pdf_ref`, `proveedor_dte_id_externo`, `estado_sii`, `estado_proveedor`, `dte_referencia_id` (NC→factura) | uk `(tenant, tipo, folio)`. Solo una NC activa por factura. |
| **lineas_cobro** | `tenant_id`, `seller_id`, `pedido_id` (uk), `periodo_cobro_id`, `tarifa_id`, `monto_base_clp`, `ajuste_incidencia_clp`, `monto_final_clp` (GENERATED), `concepto`, `tipo_pedido`, `fecha_entrega`, `incidencia_id`, `origen_generacion` | Una por pedido elegible. Lo que cobra al seller. |
| **liquidaciones** | `tenant_id`, `driver_id`, `fecha_inicio/fin`, `tipo_periodo`, `estado` (borrador/emitida/pagada), `total_entregas`, `monto_total_clp`, `tipo_relacion_conductor` (histórico), `pdf_ref` | Documento al conductor. P1+P3. |
| **lineas_liquidacion** | `tenant_id`, `driver_id`, `pedido_id` (uk), `liquidacion_id`, `monto_base_clp`, `ajuste_incidencia_clp`, `monto_final_clp` (GENERATED), `concepto`, `fecha_entrega`, `incidencia_id` | Una por pedido elegible. Lo que paga al conductor. |
| **eventos_conciliacion** | `tenant_id`, `seller_id`, `periodo_cobro_id`, `tipo_diferencia` (6 tipos), `pedido_id`, `descripcion`, `monto_diferencia_clp`, `estado`, `job_run_id` | Append-only. **Solo dueño/administración.** |
| **pagos_recibidos** | `tenant_id`, `seller_id` (null=sin atribuir), `periodo_cobro_id`, `movimiento_externo_id`, `link_token_ref`, `monto_clp`, `fecha_movimiento`, `contraparte_rut_normalizado`, `estado_match` (sin_atribuir/atribuido/conciliado/parcial/sobrante/descartado), `payload_crudo` | Fuente de verdad de cobranza Fintoc. uk `(tenant, movimiento_externo_id)`. |

### Esquema `infra`

| Tabla | Campos | Notas |
|---|---|---|
| **rate_limit_contadores** | `llave`, `ventana_inicio`, `contador` (pk compuesta) | UNLOGGED (efímero). Sin vista pública. Solo vía RPC `rate_limit_consumir`. Excepción documentada a "tenant_id en toda tabla". |

### Diagrama lógico (Markdown)

```
                    ┌──────────────┐
                    │   tenants    │ (raíz — courier)
                    └──────┬───────┘
        ┌──────────────────┼──────────────────┬─────────────────┐
        │                  │                  │                 │
  ┌─────▼─────┐     ┌──────▼──────┐    ┌──────▼──────┐   ┌──────▼────────┐
  │ usuarios_ │     │   sellers   │    │ conductores │   │ courier_config│
  │  perfil   │     └──┬───────┬──┘    └──────┬──────┘   │ _dte/cobranza │
  └─────┬─────┘        │       │              │          └───────────────┘
        │              │       │              │
   (auth.users)   ┌────▼───┐ ┌─▼──────────┐  │          ┌───────────────┐
                  │tarifas │ │conexiones_ │  │          │secretos_      │
                  └────┬───┘ │seller_ml   │  │          │cifrados (ref) │
                       │     └────────────┘  │          └───────────────┘
        ┌──────────────┼─────────────────────┼────────────────┐
        │              │                      │                │
  ┌─────▼──────────────▼──┐            ┌──────▼──────┐   ┌──────▼──────┐
  │      pedidos          │◄───────────┤asignaciones │──►│ manifiestos │
  │ (operacion)           │            │  _pedido    │   └─────────────┘
  └──┬─────────┬──────────┘            └─────────────┘
     │         │                       ┌─────────────┐
     │         └──────────────────────►│ incidencias │──► evidencias_incidencia
     │                                 └─────────────┘
     │  ── MOTOR ENTREGA→DINERO ──
  ┌──▼──────────┐         ┌──────────────────┐
  │ lineas_cobro│────────►│  periodos_cobro  │──► documentos_dte (33/61)
  └─────────────┘         └────────┬─────────┘        ▲
  ┌─────────────┐                  │                  │ (NC referencia factura)
  │  lineas_    │                  ▼                  │
  │liquidacion  │──► liquidaciones │           pagos_recibidos (Fintoc)
  └─────────────┘                  │                  │
                          eventos_conciliacion ◄──────┘ (detective)
```

### Modelo de RLS (3 capas) — verificado en migraciones

Toda política deriva de los **claims del JWT** inyectados por `identidad.custom_access_token_hook` (migración 0001):
`tenant_id`, `tipo_usuario`, `seller_id`, `driver_id`, `rol`, `estado_usuario`.

- **P1 (tenant):** `tenant_id = claim_tenant_id()` — en toda tabla.
- **P2 (seller):** seller ve solo lo suyo (`seller_id = claim_seller_id()`).
- **P3 (conductor):** conductor ve solo lo suyo (`driver_id = claim_driver_id()`).
- **Escritura de cliente:** restringida a roles internos; toda escritura de dinero es **exclusiva de service_role** (jobs). Guard de defensa `solo_interno_edita()` convierte "UPDATE 0 silencioso" en `42501` explícito y auditable.

Pruebas de aislamiento: **pgTAP** en [supabase/tests/database/](supabase/tests/database/) (195/195 según último pase del checklist).

---

## FASE 8 — AUTENTICACIÓN Y AUTORIZACIÓN

### Autenticación

- **Proveedor:** Supabase Auth (`auth.users`). Clientes: `@supabase/ssr` (servidor) + `@supabase/supabase-js`.
- **Login interno:** [/login](src/app/login/page.tsx) (`signInWithPassword`). **Login seller:** [/portal/login](src/app/portal/login/page.tsx). Conductor: vía mismo Auth, redirigido a `/conductor`.
- **Registro de courier:** [/registro](src/app/registro/) crea el tenant + usuario dueño, valida RUT módulo-11 ([rut.ts](src/modules/identidad/rut.ts)).
- **Confirmación de email:** [/auth/confirm](src/app/auth/confirm/route.ts) + [/registro/revisa-tu-correo](src/app/registro/revisa-tu-correo/).
- **Recuperación de contraseña:** **NO VERIFICABLE** — no se encontró una ruta dedicada de "olvidé mi contraseña" en el listado de archivos. Supabase Auth lo soporta nativamente, pero no hay UI propia detectada.
- **Activación de invitados:** [/invitacion/[token]](src/app/invitacion/[token]/) + [/activar-cuenta](src/app/activar-cuenta/).

### Mecanismo de claims (corazón del sistema)

`identidad.custom_access_token_hook(event jsonb)` (SECURITY DEFINER) lee `usuarios_perfil` y agrega `tenant_id/tipo_usuario/seller_id/driver_id/rol/estado_usuario` al JWT **antes** de emitirlo. Las políticas RLS leen estos claims directamente (sin subselects por fila). Fail-closed: sin perfil ⇒ sin claims de negocio ⇒ RLS bloquea todo.

### Autorización — dos capas que deben coincidir

1. **RBAC en código** ([src/modules/identidad/capacidades.ts](src/modules/identidad/capacidades.ts)): matriz cerrada `rol → capacidades`. **No hay tabla de permisos** — viven en código. Funciones `puede*()` que consume frontend/backend. Un usuario `invitado`/`suspendido` no ejerce ninguna capacidad (RNF-03).
2. **RLS en BD** (impone el aislamiento real, no-negociable).

### Matriz rol → capacidades (resumen verificado)

| Rol | Capacidades clave |
|---|---|
| **dueno** | Superconjunto interno: usuarios, tarifas, DTE, aprobar/emitir facturación, conciliación, liquidaciones, cobranza, operación, reportes, bitácora. |
| **supervisor** | Operación: asignar/reasignar, manifiestos, incidencias, ajustar operación. **Sin** finanzas ni usuarios. |
| **coordinador** | Solo asignar/reasignar + manifiestos (el más acotado de los internos operativos). |
| **administracion** | Finanzas: tarifas, DTE, aprobar/emitir facturación, conciliación, liquidaciones, cobranza, bitácora. **Sin** reasignación operativa. |
| **conductor** | Solo lo propio: ruta, evidencias, confirmar manifiesto, ver liquidación. |
| **seller** | Solo lo propio: conexión ML, solicitar same-day, ver documentos, ver incidencias. |
| **super_admin** | **Lista vacía de capacidades de tenant** (a propósito). Acciones de plataforma vía funciones service_role auditadas. |

### Guards / middlewares

- **No hay `middleware.ts`.** Cada layout guarda su área: [(tenant)/layout.tsx](src/app/(tenant)/layout.tsx) redirige por rol (conductor→/conductor, seller→/portal, invitado→/activar-cuenta, sin tenant→/login).
- **Server Actions** verifican `puede*()` antes de mutar (verificado en checklist H-04).
- **Route handlers** verifican sesión + capacidad (401/403).

---

## FASE 9 — INTEGRACIONES EXTERNAS

Patrón: **adaptadores aislados** (un "puerto" por servicio). El núcleo nunca llama APIs externas directo. Skills de dominio en [.claude/skills/](.claude/skills/): `flex-ml`, `chile-dte`, `pagos-chile`.

| Servicio | Uso | Estado |
|---|---|---|
| **Mercado Libre (Flex)** | OAuth por seller, refresco de tokens, lectura de pedidos/shipments, traducción de estados, etiquetas (`/shipment_labels`), salud de conexiones, backfill. Puerto: [src/modules/integraciones/ml/puerto.ts](src/modules/integraciones/ml/puerto.ts). | ✅ Implementado. Refresco/descarga real requiere credenciales OAuth reales (no disponibles en ambiente local). |
| **Proveedor DTE — Simplefactura** | Adaptador **stub sandbox** ([simplefactura.ts](src/modules/integraciones/dte/adaptadores/simplefactura.ts)). `DTE_SANDBOX_MODE=true`. No emite DTEs reales al SII. Default del MVP. | ✅ Sandbox |
| **Proveedor DTE — Openfactura** | Adaptador **esqueleto** ([openfactura.ts](src/modules/integraciones/dte/adaptadores/openfactura.ts)), no cableado. Validación documentada en [docs/arquitectura/validacion-dte-openfactura.md](docs/arquitectura/validacion-dte-openfactura.md). | ⚠️ Esqueleto (no productivo) |
| **Fintoc (cobranza)** | Conciliación de pagos seller→courier vía Link + Movements API + webhook firmado. Adaptador: [src/modules/integraciones/pagos/fintoc/adaptador.ts](src/modules/integraciones/pagos/fintoc/adaptador.ts). | ✅ Implementado (capa "pagado") |
| **Inngest** | Orquestador de jobs en segundo plano (17 funciones). Endpoint [/api/inngest](src/app/api/inngest/route.ts). | ✅ Implementado |
| **Supabase** | Postgres + Auth + Storage + RLS + RPC. | ✅ Núcleo |
| **Resend (email)** | Notificaciones por email (reconexión, alertas). | ❌ **TODO explícito** en código — pendiente fase devops. |
| **Sentry / observabilidad** | Monitoreo de errores/salud de jobs. | ❌ No integrado (checklist I-08, fase devops). |
| **WhatsApp / SMS / push** | Notificaciones al seller/consumidor. | ❌ No implementado (fuera del MVP / devops). |
| **IA / LLM** | — | ❌ Explícitamente excluido del MVP ([CLAUDE.md](CLAUDE.md): "NO introducir IA"). |
| **Pasarela de suscripción (Flow/Webpay PatPass)** | Cobro de la suscripción del SaaS al courier. | NO VERIFICABLE — descrita en skill `pagos-chile` pero no se detectó implementación. |

---

## FASE 10 — FLUJOS DE NEGOCIO

### Flujo principal: el lazo entrega→dinero (paso a paso)

1. **Onboarding del courier.** El dueño se registra (`/registro`), configura proveedor DTE + certificado (`/onboarding/dte`), folios CAF (`/onboarding/folios`), tarifas (`/onboarding/tarifas`) y, opcionalmente, cobranza Fintoc (`/onboarding/cobranza`).
2. **Alta de sellers y conductores.** El courier invita sellers (`/sellers/invitar`) y da de alta conductores (registrando `tipo_relacion`, Ley 21.431).
3. **Conexión OAuth del seller.** El seller acepta la invitación, entra al portal y conecta su cuenta principal de Mercado Libre (`/portal/conectar-ml`). El token se cifra en `secretos_cifrados`.
4. **Ingesta de pedidos.** Webhook `/api/webhooks/ml/shipments` encola `ml/shipment.actualizado` → job `procesar-shipment` crea/actualiza `pedidos` (idempotente). El job `polling-estados` (cada 15 min) recupera lo que el webhook no trajo.
5. **Asignación.** El courier crea un manifiesto, asigna pedidos a un conductor (`/manifiestos/.../asignar`) y lo confirma. El conductor ve su ruta en la PWA.
6. **Entrega.** El conductor usa la app de Flex (no integrable) para escanear/POD. El estado se sincroniza vía API ML (`traducirEstadoMl`).
7. **Incidencias.** Si hay problema (ausente, dirección, reagendado), se registra. `reagendado` afecta cobro pero no liquidación (no penaliza reintentos).
8. **Generación de líneas (job C1).** Al alcanzar un estado financiero relevante (`entregado`, etc.), `pedidos.ts` publica `dinero/pedido.estado_financiero_relevante` → job `generar-lineas` crea `lineas_cobro` (al seller, según tarifa) + `lineas_liquidacion` (al conductor). Gasto propio ⇒ sin línea de cobro.
9. **Cierre de período (cron C2).** El cron `cerrar-periodo` (02:00 diario) cierra períodos vencidos (`abierto`→`cerrado`), suma líneas, y publica `dinero/periodo.cerrado` → **solo conciliación** (C6).
10. **Conciliación (job C6, detective).** `conciliar-periodo` compara entregado vs facturado y registra descuadres en `eventos_conciliacion` (solo lectura).
11. **Aprobación y emisión humana.** Una persona con `emitir_facturas` revisa el período `cerrado` y ejecuta `emitirFacturaPeriodo` → publica `dinero/periodo.emision-solicitada` → job C3 `emitir-dte-periodo` reserva folio + llama al adaptador DTE (tipo 33). Bitácora ANTES del evento.
12. **Visibilidad para el seller.** El seller ve/descarga su factura en `/portal/cobros/[periodoId]`.
13. **Liquidación del conductor (cron).** `generar-liquidacion-conductor` (02:00) agrega `lineas_liquidacion` por conductor; el conductor ve su liquidación en `/conductor/liquidaciones`.
14. **Cobranza (Fintoc).** El seller paga por transferencia; el webhook `/api/webhooks/fintoc/[tenantId]` encola `dinero/pago.recibido` → job `conciliar-pago` atribuye y concilia contra el período (`estado_cobro`: pendiente/parcial/pagado).

### Flujos secundarios

- **Caída y reconexión de ML:** `sondeo-salud` (cada 15 min) detecta caídas → marca `estado_salud` → notifica → al reconectar (`ml/conexion.reconectada`) el job `ejecutar-backfill` recupera pedidos sin duplicar.
- **Refresco de tokens:** `refrescar-tokens` (cada 30 min) renueva tokens OAuth antes de expirar.
- **Nota de crédito (RF-038):** `emitirNotaCreditoPeriodo` (humano) → job `emitir-nota-credito` emite DTE 61, desimputa pagos y reimputa líneas a un período abierto.
- **Anulación de período:** estado `anulado` + auditoría.
- **Alertas:** `alerta-folios-proximos` (09:00, <50 folios), `alerta-morosidad` (09:00), `notificacion-incidencias-sin-gestion` (cada 30 min, >4h sin gestión).

---

## FASE 11 — VARIABLES DE ENTORNO

Verificado en [.env.example](.env.example). **No se muestran secretos** (el archivo de ejemplo está vacío de valores por diseño).

| Variable | Propósito | Dependencia |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase | Supabase (cliente + servidor) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave pública anónima | Supabase Auth/PostgREST con RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave service_role (bypass RLS) | **Solo servidor/jobs** — nunca al cliente |
| `TZ` | Zona horaria de la app (`America/Santiago`) | Cálculos de fechas/períodos |
| `SECRETOS_CLAVE_CIFRADO_B64` | Clave maestra AES-256 (base64) para cifrar secretos | Módulo `integraciones/secretos` |
| `SECRETOS_CIFRADO_KID` | Identificador de la clave activa (rotación), default "v1" | Cifrado de secretos |
| `APP_PUBLIC_URL` | URL pública canónica (redirect_uri OAuth) | OAuth ML — debe coincidir con DevCenter |
| `ML_APP_CLIENT_ID` | Client ID de la app de Mercado Libre | OAuth ML (una app sirve a todos) |
| `ML_APP_CLIENT_SECRET` | Client Secret de ML | OAuth ML |
| `INNGEST_EVENT_KEY` | Clave para publicar eventos a Inngest | Jobs (opcional en dev local) |
| `INNGEST_SIGNING_KEY` | Clave para validar peticiones de Inngest | Endpoint `/api/inngest` |
| `DTE_SANDBOX_BASE_URL` | URL base del sandbox del proveedor DTE | DTE (solo documentación) |
| `DTE_SANDBOX_RUT_EMISOR` | RUT del emisor (courier) en el proveedor | DTE |
| `DTE_SANDBOX_API_KEY` | Credencial del proveedor DTE en sandbox | DTE |
| `DTE_SANDBOX_MODE` | `"true"` evita emitir DTEs reales | DTE — **clave de seguridad** |
| `WEBHOOKS_ML_SECRET` | **OBSOLETO / NO USAR** (ML no firma sus webhooks) | — |

> **NO VERIFICABLE:** variables de Fintoc y de Resend no aparecen en `.env.example` (Fintoc usa secretos cifrados por tenant en BD; Resend está como TODO). El proveedor de hosting (Vercel/Supabase) gestiona los secretos de producción.

---

## FASE 12 — DEUDA TÉCNICA

| # | Hallazgo | Categoría | Severidad |
|---|---|---|---|
| 1 | **Sin observabilidad (Sentry).** No hay monitoreo de errores/salud de jobs a nivel de infra (checklist I-08). | Riesgo operacional | **Alta** |
| 2 | **Sin respaldos verificados ni prueba de restauración** (checklist L-03, crítico antes de producción). | Riesgo de datos | **Alta** |
| 3 | **Notificaciones reales (email/push) sin implementar** — Resend es un TODO; alertas solo quedan en bitácora (B-04, B-06, G-06). | Funcional incompleto | Media |
| 4 | **Adaptador DTE real no productivo** — Openfactura es esqueleto; solo Simplefactura stub funciona. La emisión real requiere decisión comercial + credenciales. | Bloqueante de producción | Media |
| 5 | **Ventana de conciliación frágil** — Checks 1/2 de `conciliar-periodo` acotan por `pedidos.actualizado_en` (proxy frágil de "entregado en el período"); conviene un timestamp de entrega dedicado (B1-4). | Mantenibilidad | Media |
| 6 | **`ml_user_id` sin UNIQUE** en `conexiones_seller_ml` — dos couriers podrían conectar la misma cuenta ML; riesgo de falso negativo en webhooks (mitigado por polling C5). | Integridad | Baja-Media |
| 7 | **Componentes de descarga duplicados** (5 variantes `boton-descarga-*`). Candidato a componente único. | Duplicación UI | Baja |
| 8 | **Grupo `(app)/` legado** — reemplazado por `(tenant)`, pendiente de limpieza (CLAUDE.md menciona; B1-5 eliminó el layout huérfano). | Limpieza | Baja |
| 9 | **Sin recuperación de contraseña con UI propia** (NO VERIFICABLE si se delega 100% a Supabase). | Funcional | Baja |
| 10 | **PWA sin manifest/service worker verificable** — es responsive pero no se confirma instalabilidad. | Funcional | Baja |

**Acoplamiento / escalabilidad (evaluación de diseño):** el diseño multi-tenant con `tenant_id` + RLS + jobs asíncronos idempotentes **no presenta acoplamientos obvios** que impidan escalar horizontalmente. Los módulos respetan límites estrictos (eventos Inngest tipados como único contrato cross-módulo; el núcleo no llama APIs externas directo). El monolito modular es apropiado para la etapa (el propio CLAUDE.md prohíbe microservicios en el MVP).

---

## FASE 13 — MATRIZ DE FUNCIONALIDADES

> Basado en el checklist de pruebas funcionales (última ejecución verificada). Leyenda: ✅ Completa · 🟡 Parcial · ⛔ Incompleta · ⬜ No iniciada · ❔ No verificable.

| Funcionalidad | RF | Estado |
|---|---|---|
| Alta de courier (tenant) | RF-006 | ✅ |
| RBAC (7 roles diferenciados) | RF-002 | ✅ |
| Gestión de usuarios/invitaciones internas | RF-005 | ✅ |
| Carga cifrada de certificado digital | RF-007 | ✅ |
| Conexión proveedor DTE + folios CAF | RF-008 | ✅ |
| Gestión de tarifas (seller/tipo/zona) | RF-009 | ✅ |
| Onboarding del seller | RF-010 | ✅ |
| OAuth del seller (cuenta principal) | RF-011 | ✅ |
| Refresco automático de tokens | RF-012 | ✅ |
| Monitoreo de salud de conexiones | RF-013 | ✅ |
| Alerta de desvinculación | RF-014 | 🟡 (alerta interna ok; email real pendiente) |
| Reconexión self-service | RF-015 | ✅ |
| Empujón de reconexión por el courier | RF-016 | 🟡 (link manual; envío automático pendiente) |
| Backfill al reconectar | RF-017 | ✅ |
| Ingesta automática Flex + sondeo de respaldo | RF-018 | ✅ |
| Panel multi-seller | RF-019 | ✅ |
| Same-day ad-hoc | RF-020 | ✅ |
| Obtención de etiquetas | RF-021 | ✅ (descarga real requiere OAuth real) |
| Asignación por zona/conductor | RF-022 | ✅ |
| Reasignación ante falla | RF-023 | ✅ |
| Generación de manifiesto | RF-024 | ✅ |
| Ruteo básico (orden de paradas) | RF-025 | ✅ (no optimizador, por diseño) |
| Sincronización de subestados | RF-026 | ✅ |
| Registro/clasificación de incidencias | RF-027 | ✅ |
| Acciones de incidencia que protegen reputación | RF-028 | ✅ |
| Corrección manual de estado | RF-029 | ✅ |
| Línea de cobro por entrega | RF-030 | ✅ |
| Línea de liquidación por entrega | RF-031 | ✅ |
| Regla: reintento/devolución no dobla cobro/pago | RF-032 | ✅ |
| Conciliación entregado-vs-facturado | RF-033 | ✅ |
| Same-day como gasto propio | RF-034 | ✅ |
| Factura del período (Flex+same-day) | RF-035 | ✅ |
| Emisión DTE bajo RUT del courier | RF-036 | ✅ (sandbox) |
| Descarga del DTE por el seller | RF-037 | ✅ |
| Nota de crédito (anulación total) | RF-038 | ✅ (adelantado; era V2) |
| Cálculo de liquidación por conductor | RF-039 | ✅ |
| Boleta de terceros (formal) | RF-040 | ⬜ Fuera del MVP |
| Registro interno de liquidación (informal) | RF-041 | ✅ |
| Visibilidad de liquidación para conductor | RF-042 | ✅ |
| Estado de cuenta / cartola por seller | RF-043 | ✅ |
| Cobranza + conciliación bancaria (Fintoc) | RF-044/045 | ✅ (adelantado; era V2) |
| Dashboard operativo del dueño | RF-046 | ✅ |
| Vista de conductor (PWA) | RF-047 | ✅ (instalabilidad PWA ❔) |
| Portal del seller | RF-048 | ✅ |
| Reportería ejecutiva avanzada | RF-049 | ⬜ Fuera del MVP |
| Notificaciones internas | RF-050 | 🟡 (registro en bitácora; envío real pendiente) |
| Notificaciones al consumidor final | RF-051 | ⬜ Fuera del MVP |
| Exportación de datos del courier | RNF-13 | ✅ |
| Rate limiting de webhooks | — | ✅ |
| Observabilidad (Sentry) | RNF-10 | ⛔ Pendiente (devops) |
| Disponibilidad / respaldos | RNF-08/09 | ⛔ Pendiente (devops) |
| Cobro de suscripción SaaS al courier | — | ❔ No verificable |

---

## FASE 14 — ANÁLISIS DE MADUREZ

| Área | Score /100 | Justificación |
|---|---|---|
| **Producto** | 85 | MVP completo y verificado E2E (lazo entrega→dinero cierra). Diferenciador implementado. Falta solo lo de V2/devops. Funcionalidades de crecimiento (NC, cobranza Fintoc) ya adelantadas. |
| **Backend** | 90 | Arquitectura modular limpia, reglas de negocio bien encapsuladas, jobs idempotentes, eventos tipados, compuerta de aprobación de facturación. Lógica de dinero robusta y probada. |
| **Frontend** | 70 | Todas las pantallas del MVP existen y funcionan, basadas en shadcn/ui. Pero el foco hasta ahora fue backend; falta pulido UX/UI (es la siguiente fase). Componentes de descarga duplicados. |
| **Arquitectura** | 92 | Monolito modular con límites estrictos, contratos explícitos (eventos Inngest), separación de secretos, decisiones documentadas por fase en `docs/arquitectura/`. Excelente disciplina. |
| **Seguridad** | 88 | RLS de 3 capas impuesta en BD (no solo app), secretos cifrados AES-256 fuera de logs/URLs, bitácora append-only con autor, guards de defensa en profundidad, rate limiting. Pendiente: rotar secret de ML (memoria), auditoría formal pre-release. |
| **Escalabilidad** | 78 | Diseño multi-tenant + jobs asíncronos escala bien en teoría. Sin pruebas de carga reales (L-01/L-04 N/A). UNLOGGED para rate-limit es pragmático. |
| **Mantenibilidad** | 85 | Código muy comentado (a veces en exceso), nombres en español consistentes, convenciones claras, migraciones idempotentes. Deuda menor de duplicación UI. |
| **Testing** | 88 | 645/645 Vitest (unitarias de RBAC, motor, dinero, idempotencia, cobranza, NC) + 195/195 pgTAP (aislamiento RLS). CI con piso de cobertura. Faltan tests E2E automatizados de UI. |
| **Documentación** | 95 | Excepcional: CLAUDE.md, docs de levantamiento/mercado, arquitectura y UX por fase, skills de dominio, checklist exhaustivo, READMEs por módulo, comentarios en migraciones. |

**Madurez global estimada: ~85/100.** Producto sólido en backend/arquitectura/seguridad/docs; la brecha está en pulido frontend/UX (fase entrante), observabilidad/respaldos (devops) y la activación de la emisión DTE real.

---

## FASE 15 — GAPS DETECTADOS

### Funcionalidades faltantes (bloqueantes de producción, no del MVP)

- **Observabilidad (Sentry):** errores y salud de jobs no monitoreados (RNF-10).
- **Respaldos + prueba de restauración** (RNF-08/09) — crítico antes de producción.
- **Envío real de notificaciones** (email/push vía Resend) — hoy solo bitácora.
- **Emisión DTE real** — requiere adaptador Openfactura productivo + opt-in por courier + decisión comercial.
- **Cobro de la suscripción del SaaS al courier** (Flow/Webpay PatPass) — no detectado en código.

### Definiciones faltantes (requieren decisión del dueño — del checklist)

1. Credencial del sandbox de Openfactura para validación en vivo.
2. Elección comercial del proveedor DTE definitivo.
3. Cuándo activar `emision_dte_real_habilitada` por courier (compromete DTEs reales ante el SII).
4. Proveedor de notificaciones (Resend u otro) y de monitoreo.

### Riesgos técnicos

- **Ventana de conciliación frágil** (`actualizado_en` como proxy de fecha de entrega).
- **`ml_user_id` sin UNIQUE** (riesgo de colisión de cuentas ML entre couriers).
- **Secret de ML pendiente de rotar** (anotado en memoria del proyecto: `estado_proyecto_jun2026`).
- **PWA sin instalabilidad verificada.**
- **Sin pruebas de carga** (rendimiento con cientos de pedidos/día no medido).

### Riesgos de producto

- Dependencia de un dominio no integrable (app de Flex obligatoria) — asumido por diseño, pero limita la experiencia del conductor (dos apps).
- La emisión DTE es irreversible ante el SII — mitigado por la compuerta humana, pero el opt-in real es un punto de no retorno que exige proceso.
- Multi-tenant: un bug de RLS sería catastrófico (fuga entre couriers) — mitigado por la suite pgTAP, pero requiere disciplina permanente al tocar esquema.

---

## FASE 16 — GUÍA DE USO POR AGENTE (cómo consumir este documento)

> Este documento es la fuente única de verdad. Cada agente debe leer su sección antes de actuar y respetar las reglas no-negociables de [CLAUDE.md](CLAUDE.md).

### Para **UX/UI Agents**
- **Inventario de pantallas:** Fase 4. Flujos: Fase 10. Wireframes conceptuales existentes: [docs/ux/](docs/ux/) (fase-a/b/c).
- **Foco entrante:** el backend está firme y poblado (checklist M-05). Pulir UX de dashboard, portal del seller y PWA del conductor.
- **Restricción dura:** el conductor usa dos apps (Flex no integrable). No diseñar captura de POD propia.
- **Localización:** CLP, español de Chile, zona Santiago. Reusar helpers de [src/lib/ui/](src/lib/ui/).

### Para **Frontend Agents**
- **Componentes base:** shadcn/ui en [src/components/ui/](src/components/ui/). No duplicar — consolidar botones de descarga (deuda #7).
- **Patrón:** Server Component (`page.tsx`, carga con RLS) + componentes cliente + `actions.ts`. Navegación condicionada por capacidad ([barra-superior.tsx](src/components/app-shell/barra-superior.tsx)).
- **Autorización en UI:** usar `puede*()` de [capacidades.ts](src/modules/identidad/capacidades.ts) (nunca replicar la matriz).

### Para **Backend Agents**
- **Mapa:** Fase 6. Reglas invariantes: respetar la compuerta de facturación, bitácora-antes-de-efecto, eventos Inngest tipados, idempotencia.
- **Secuencia por feature** (CLAUDE.md): `arquitecto → base-datos-rls → backend/integraciones → frontend → qa`.
- **Nunca:** acoplar la emisión DTE al cierre; escribir tablas de dinero desde cliente (solo service_role).

### Para **QA Agents**
- **Estado funcional:** Fase 13 + [checklist-pruebas-funcionales-mvp.md](checklist-pruebas-funcionales-mvp.md).
- **Prioridad:** aislamiento multi-tenant (pgTAP en [supabase/tests/database/](supabase/tests/database/)) y reglas de dinero (Vitest). Probar a nivel API/BD con tokens distintos, no solo UI.
- **Comandos:** `npm test` (Vitest), `npx supabase test db` (pgTAP), `npm run typecheck`.

### Para **Product Agents**
- **Identidad/mercado:** Fase 1 + [docs/levantamiento.md](docs/levantamiento.md) + [docs/informe-mercado.md](docs/informe-mercado.md).
- **Roadmap:** Fases A/B/C completas. Pendientes priorizados: Fase 15. Decisiones que requieren al dueño: Fase 15 "Definiciones faltantes".

### Para **Copywriting Agents**
- **Tono:** español de Chile, claro, sin jerga. Microcopy de alertas, correos (reconexión), estados.
- **Textos existentes a revisar:** mensajes de onboarding, diálogos de emisión/cierre, descripciones de roles ([equipo/descripciones-roles.ts](src/app/(tenant)/equipo/descripciones-roles.ts)).
- **Pendiente:** plantillas de email reales (cuando se conecte Resend).

### Para **AI Agents**
- **Restricción dura:** [CLAUDE.md](CLAUDE.md) prohíbe IA/optimizadores de ruteo en el MVP. Cualquier propuesta de IA es **post-MVP** y debe escalarse al dueño.
- **Stack de modelos** (si aplica en futuro): el proyecto usa Claude; defaults a los modelos más capaces (Opus 4.8).

---

## Anexo A — Stack técnico (verificado en [package.json](package.json))

- **Lenguaje:** TypeScript end-to-end.
- **Framework:** Next.js 16.2.9 (App Router, React 19.2.4).
- **UI:** Tailwind CSS 4 + shadcn/ui (sobre Radix UI) + lucide-react + sonner + next-themes.
- **Validación:** Zod 4.
- **Datos:** Supabase (`@supabase/ssr`, `@supabase/supabase-js`) — Postgres + Auth + Storage + RLS.
- **Jobs:** Inngest 4.5.
- **Testing:** Vitest 4 + `@vitest/coverage-v8`. pgTAP para RLS.
- **Lint:** ESLint 9 + eslint-config-next.
- **Hosting (declarado):** Vercel + Supabase.

## Anexo B — Comandos

| Comando | Acción |
|---|---|
| `npm run dev` | Next.js dev (Turbopack) |
| `npm run build` | Build de producción |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (unitarias servidor) |
| `npm run test:watch` | Vitest watch |
| `npm run coverage` | Vitest + cobertura (piso en CI) |
| `npx supabase test db` | pgTAP (aislamiento RLS) |
| `npx supabase db push` | Aplicar migraciones |
| `npx supabase db seed` | Cargar datos demo ([supabase/seed.sql](supabase/seed.sql)) |
| `npx inngest-cli dev` | Inngest Dev Server |

> Arranque completo del entorno local/staging: [docs/PRUEBA.md](docs/PRUEBA.md).

## Anexo C — Inventario de jobs Inngest (verificado)

| Job | Disparador | Función |
|---|---|---|
| `jobRefrescarTokens` | cron `*/30 * * * *` | Renueva tokens OAuth ML |
| `jobSondeoSaludConexiones` | cron `*/15 * * * *` | Detecta caídas de conexión ML |
| `jobPollingEstadosPedidos` | cron `*/15 * * * *` | Sondeo de respaldo de estados |
| `jobProcesarShipmentActualizado` | evento `ml/shipment.actualizado` | Crea/actualiza pedido (idempotente) |
| `jobEjecutarBackfill` | evento `ml/conexion.reconectada` | Recupera pedidos tras caída |
| `jobNotificacionConexionCaida` | evento `notificacion/conexion-caida` | Registra alerta (email = TODO) |
| `jobNotificacionIncidenciasSinGestion` | cron `*/30 * * * *` | Alerta incidencias >4h |
| `jobGenerarLineas` (C1) | evento `dinero/pedido.estado_financiero_relevante` | Genera líneas cobro/liquidación |
| `jobCerrarPeriodo` (C2) | cron `0 2 * * *` | Cierra período → conciliación |
| `jobEmitirDtePeriodo` (C3) | evento `dinero/periodo.emision-solicitada` | Emite DTE 33 (humano-disparado) |
| `jobConciliarPeriodo` (C6) | evento `dinero/periodo.cerrado` | Detecta descuadres (detective) |
| `jobGenerarLiquidacionConductor` | cron `0 2 * * *` | Agrega liquidación por conductor |
| `jobPollingEstadoDte` (C5) | cron `0 */6 * * *` | Consulta estado SII del DTE |
| `jobAlertaFoliosProximos` | cron `0 9 * * *` | Alerta folios CAF <50 |
| `jobAlertaMorosidad` | cron `0 9 * * *` | Alerta morosidad de cobranza |
| `jobConciliarPago` | evento `dinero/pago.recibido` | Concilia pago Fintoc |
| `jobEmitirNotaCredito` (C-NC) | evento `dinero/nc.emision-solicitada` | Emite DTE 61 (humano-disparado) |

---

*Documento generado por auditoría de código. Para detalle de cada decisión, ver `docs/arquitectura/` y los comentarios inline de las migraciones en `supabase/migrations/`. Mantener este documento al día tras cambios estructurales.*
