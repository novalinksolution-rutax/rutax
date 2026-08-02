# Rutax — Inventario funcional (fuente de verdad del rediseño)

> **Propósito.** Enumerar **QUÉ debe poder hacer cada persona** (capacidades/features), NO cómo se ve hoy. Este documento es el insumo del rediseño **desde cero**: la nueva arquitectura de información, navegación, ubicación de opciones, listas y formularios se diseña **a partir de estas capacidades**, con libertad total para reubicar/reagrupar/fusionar/dividir — **jamás copiando el layout actual**.
> Fuentes: `docs/levantamiento.md` (RF-001..RF-051, roles, procesos) + barrido de todas las rutas `src/app/**/page.tsx`.
> ⚠️ Los paths listados son solo evidencia de que la capacidad existe hoy; **no obligan** a mantener esa ruta, agrupación ni pantalla en el rediseño.

---

## Personas (4 superficies) y su "trabajo"
1. **Super-admin / plataforma** (`/admin`) — el fundador: opera el SaaS (couriers, planes, soporte, salud). *Denso, tipo consola.*
2. **Courier backoffice** (`(tenant)`) — dueño · supervisor · coordinador · administración. *Denso y eficiente.*
3. **Seller** (`/portal`) — cliente del courier. *Espaciado, tranquilizador.*
4. **Conductor** (`/conductor`) — PWA móvil. *Táctil, mínimo, alto contraste.*
5. (+ **Público/auth** y **tracking** sin login.)

Cada persona ve **solo sus capacidades** (RBAC en servidor); lo no permitido no aparece (no se muestra deshabilitado).

---

## A. Super-admin / plataforma (`/admin`)  — *superficie nueva, no estaba en el mapa previo*
| Capacidad | Evidencia (ruta actual) | RF |
|---|---|---|
| Overview de plataforma | `/admin` | — |
| Gestión de couriers (tenants): listar, ver, crear/suspender | `/admin/couriers`, `/admin/couriers/[tenantId]` | RF-001, RF-006 |
| Soporte / impersonación auditada de un courier | `/admin/couriers/[tenantId]/soporte` | roles §4 |
| Suscripciones: listar y ver detalle | `/admin/suscripciones`, `/admin/suscripciones/[id]` | modelo ingresos §2.4 |
| Configurar **planes** (base + por conductor, cupos DTE) | `/admin/planes` | §2.4 |
| Métricas de plataforma (MRR, uso) | `/admin/metricas` | — |
| Salud del sistema (jobs, integraciones) | `/admin/salud` | RNF-10 |
| Seguridad | `/admin/seguridad` | RNF-02 |
| Bitácora de auditoría global | `/admin/bitacora` | RF-004 |
| Comunicaciones / anuncios | `/admin/comunicaciones` | — |
| Login admin | `/admin/login` | — |

## B. Courier backoffice (`(tenant)`)
| Capacidad | Evidencia | RF |
|---|---|---|
| **Dashboard operativo** (comprometido vs entregado, conductores listos/activos, paquetes por comuna, rezagados, incidencias, salud conexiones, alertas) | `/dashboard` | RF-046 |
| **Onboarding** (hub) + pasos | `/onboarding` | RF-006 |
| · Certificado digital (DTE) | `/onboarding/dte` | RF-007 |
| · Folios (CAF) / proveedor DTE | `/onboarding/folios` | RF-008 |
| · Tarifas iniciales | `/onboarding/tarifas` | RF-009 |
| · Cobranza (setup pagos) | `/onboarding/cobranza` | RF-043/044 |
| **Pedidos** (panel multi-seller consolidado) + detalle | `/operaciones`, `/operaciones/[pedidoId]` | RF-018/019 |
| **Incidencias** (registrar, clasificar, acciones de reputación) | `/operaciones/incidencias` | RF-027/028/029 |
| **Manifiestos**: listar, crear, ver, **asignar** conductores | `/manifiestos`, `/nuevo`, `/[id]`, `/[id]/asignar` | RF-022/023/024 |
| **Conductores**: listar + detalle | `/conductores`, `/conductores/[id]` | RF-039/042 |
| **Sellers**: listar + invitar | `/sellers`, `/sellers/invitar` | RF-010 |
| **Equipo** (usuarios internos, invitaciones, roles) | `/equipo` | RF-005/002 |
| **Dinero › Períodos** (facturar al seller, gate humano DTE) + detalle | `/dinero/periodos`, `/[periodoId]` | RF-035/036/037 |
| **Dinero › Liquidaciones** (conductores) + detalle | `/dinero/liquidaciones`, `/[liquidacionId]` | RF-039/041 |
| **Dinero › Conciliación** (entregado vs facturado) | `/dinero/conciliacion` | RF-033 |
| **Dinero › Cobranza / Pagos** (estado de cuenta, morosidad) | `/dinero/cobranza` | RF-043/044/045 |
| **Config › Mi plan** (suscripción del courier) | `/configuracion/plan` | §2.4 |
| **Config › Tarifas** | `/configuracion/tarifas` | RF-009 |
| **Config › API e integraciones** (salud ML, reconexión) | `/configuracion/api` | RF-013–017 |
| **Config › Zonas** (de reparto) | `/configuracion/zonas` | RF-022 |
| **Config › Exportar datos** (portabilidad) | `/configuracion/exportar-datos` | RNF-13 |

## C. Seller (`/portal`)
| Capacidad | Evidencia | RF |
|---|---|---|
| Home / resumen | `/portal` | RF-048 |
| Bienvenida / onboarding del seller | `/portal/bienvenida` | RF-010 |
| **Conectar ML (OAuth)** + reconexión | `/portal/conectar-ml` | RF-011/015 |
| **Pedidos** (listar, ver, **crear same-day**) | `/portal/pedidos`, `/[pedidoId]`, `/nuevo` | RF-020/048 |
| **Incidencias** (seguir las suyas) | `/portal/incidencias` | RF-027 |
| **Cobros / estado de cuenta** + detalle de período (descargar DTE) | `/portal/cobros`, `/[periodoId]` | RF-037/043 |
| Login seller | `/portal/login` | — |

## D. Conductor (`/conductor`) — PWA
| Capacidad | Evidencia | RF |
|---|---|---|
| Home | `/conductor` | RF-047 |
| **Manifiesto del día** (ruta) + **parada/pedido** (detalle, evidencia interna) | `/conductor/manifiesto`, `/[pedidoId]` | RF-047/026 |
| **Mis liquidaciones** | `/conductor/liquidaciones` | RF-042 |

## E. Público / auth / tracking
Landing `/` · `/login` · `/registro` (+ `/revisa-tu-correo`) · `/activar-cuenta` · `/invitacion/[token]` · **tracking público** `/tracking/[token]` (RF-051) · `/offline` (PWA) · `/portal/login` · `/admin/login`.

---

## Formularios y acciones con "fricción deliberada" (dinero — DESIGN §8)
Rediseñar como **flujos claros con confirmación** (no como pantallas sueltas):
- **Emitir factura del período (DTE)** — irreversible, gate humano: resumen ("vas a emitir N facturas por $X a M sellers") + confirmación explícita. (RF-035/036)
- **Cerrar período** / **generar liquidaciones** — resumen antes de confirmar. (RF-039)
- **Cargar certificado/secretos** (DTE, tokens ML) — campos marcados como sensibles, nunca muestran el valor, copy de "cifrado". (RF-007, RNF-02)
- **Onboarding wizard** (certificado → folios → tarifas → cobranza) — pasos con progreso. (RF-006–009)
- **Same-day nuevo** (seller/courier) con **destino de facturación**. (RF-020)
- **Asignar/reasignar** en manifiesto (selección múltiple + acción masiva). (RF-022/023)

## Componentes de dominio (reusar, no duplicar)
Badge de estado (pedido/DTE/incidencia — `lib/ui/traduccion-estados.ts`) · Monto CLP mono‑tabular · Selector de comuna RM · Estado de conexión ML (salud + reconectar) · Confirmación de dinero · BotónDescarga (factura/etiqueta/export) · Centro de avisos in‑app.

---

## Regla de rediseño (leer antes de diseñar cualquier pantalla)
**Diseña desde la capacidad, no desde la pantalla actual.** Está **permitido y esperado**:
- Reagrupar el sidebar y mover opciones entre secciones/menús.
- Fusionar pantallas (p. ej. detalle en un drawer en vez de página), o dividir una densa en tabs.
- Rediseñar formularios por completo (orden de campos, wizard vs una página, inline vs modal).
- Cambiar dónde vive una acción (toolbar, menú de fila, drawer, dialog).
- Reordenar la jerarquía de información de cada vista.
El **único** invariante es la **capacidad** (que el usuario pueda hacer X, con su RBAC y su fricción de dinero) — el **cómo/dónde se ve** se rediseña libremente con los patrones de Retell (`catalogo-visual.md`).
