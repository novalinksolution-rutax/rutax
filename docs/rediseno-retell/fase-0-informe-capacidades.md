# FASE 0 — Informe de capacidades de Rutax (verificado contra el código)

> **Qué es esto.** El insumo del rediseño **desde la capacidad**, no desde el layout. Enumera **qué puede hacer cada persona**, agrupado por *job*, con su RBAC y sus acciones sensibles (fricción de dinero / secretos) marcadas. **NO es un plan de migración de pantallas** — el layout se re-arquitecta en la Fase IA.
> **Método.** Se contrastó `rutax-inventario-funcional.md` contra el código real: 63 `page.tsx`, los 4 `layout.tsx` de superficie, la matriz RBAC (`src/modules/identidad/capacidades.ts`) y los helpers de UI (`src/lib/ui/*`). Las divergencias inventario↔código se marcan con **⚠︎**.

Leyenda de sensibilidad: **$** = acción financiera irreversible o con fricción deliberada · **🔒** = maneja secretos/PII (cifrado, nunca en claro) · **📄** = genera/descarga documento (DTE, etiqueta, export) · **⧉** = acción masiva (selección múltiple).

---

## 0. Modelo de roles (RBAC) — el eje del "quién ve qué"

Roles cerrados (7), matriz en código (`capacidades.ts`), **no en tablas**. Es la fuente de verdad de qué capacidad aparece por persona.

| Rol | Superficie | Resumen de su "job" |
|---|---|---|
| `dueno` | `(tenant)` | Superconjunto interno: operación + dinero + config + usuarios + reportes + auditoría + **suscripción Rutax**. |
| `supervisor` | `(tenant)` | Operativo: asignar/reasignar, manifiestos, incidencias, ajuste diario. **Sin** dinero ni usuarios ni config. |
| `coordinador` | `(tenant)` | El más acotado interno: **solo** asignar/reasignar + generar manifiestos. |
| `administracion` | `(tenant)` | La capa de dinero: tarifas, config DTE, facturar, liquidar, cobrar, conciliar, bitácora. **Sin** reasignación operativa. |
| `seller` | `portal` | Solo lo suyo: conectar ML, same-day, ver/descargar sus DTE, seguir sus incidencias. |
| `conductor` | `conductor` | Solo lo suyo: ruta del día, evidencias internas, confirmar manifiesto, ver su liquidación. |
| `super_admin` | `admin` | Plataforma (fuera de tenant): couriers, planes, suscripciones, salud, soporte auditado. Gate real Supabase Auth **+ MFA/AAL2 obligatorio**. |

**Invariante de rediseño:** lo que un rol no puede hacer **no se muestra** (ni deshabilitado). El gating vive en servidor (layout/página); la UI solo pinta lo que recibe.

---

## A. Super-admin / plataforma (`admin`) — *consola densa*

Gate: `exigirSuperAdmin()` (sesión real + `super_admins` activo, releído por request) **+ AAL2**. Toda `/admin/*` exige MFA verificado en la sesión.

| Job | Capacidad | Sensib. | Evidencia |
|---|---|---|---|
| **Overview** | Panorama de plataforma (MRR, couriers, salud resumida) | — | `/admin` |
| **Couriers (tenants)** | Listar · ver detalle · crear · suspender | $ (suspender corta servicio) | `/admin/couriers`, `/[tenantId]` |
| | **Soporte / impersonación auditada** de un courier | 🔒 $ (queda en bitácora) | `/admin/couriers/[tenantId]/soporte` |
| **Suscripciones** | Listar · ver detalle (estado, dunning, método de pago) | $ | `/admin/suscripciones`, `/[id]` |
| **Planes** | Configurar planes (base + por conductor, cupos DTE) | $ | `/admin/planes` |
| **Métricas** | MRR, uso, adopción | — | `/admin/metricas` |
| **Salud** | Jobs Inngest, integraciones, watchdog | — | `/admin/salud` |
| **Seguridad** | Gestión de MFA propia (agregar/reconfigurar factor) | 🔒 | `/admin/seguridad` |
| **Bitácora** | Auditoría global de plataforma | 🔒 | `/admin/bitacora` |
| **Comunicaciones** | Anuncios / avisos a couriers | — | `/admin/comunicaciones` |
| Auth | Login admin | 🔒 | `/admin/login` |

**⚠︎ Divergencias:** el nav actual (`admin/layout.tsx`) es una **barra horizontal** de 8 links y **omite** el Overview `/admin` y **no distingue** el rol `soporte` (solo lectura) del `admin_total` más que en un badge. En la Fase IA la consola pasa a **sidebar denso** con el Overview como raíz, y el nav se **gatea por `rolAdmin`** (soporte no ve acciones de escritura).

---

## B. Courier backoffice (`(tenant)`) — *denso y eficiente* · el caballo de batalla

Nav actual: `Dashboard` suelto + grupos **Operación · Dinero · Configuración**, filtrados por capacidad.

### Job: Ver el estado del negocio
| Capacidad | RBAC | Sensib. | Evidencia |
|---|---|---|---|
| Dashboard operativo (comprometido vs entregado, conductores listos/activos, paquetes por comuna, rezagados, incidencias, salud conexiones, alertas) | `ver_reportes_ejecutivos` (**solo `dueno`**) | — | `/dashboard` |

### Job: Operar las entregas del día
| Capacidad | RBAC | Sensib. | Evidencia |
|---|---|---|---|
| Pedidos consolidados multi-seller (Flex + same-day) + detalle | operativo¹ | — | `/operaciones`, `/[pedidoId]` |
| Geocodificar / reubicar destino de un pedido | operativo¹ | — | `/operaciones/[pedidoId]` (`boton-reubicar`, `actions-geocoding`) |
| Manifiestos: listar · crear · ver | `generar_manifiestos` | — | `/manifiestos`, `/nuevo`, `/[id]` |
| **Asignar/reasignar** conductores en manifiesto | `asignar_y_reasignar_pedidos` | ⧉ | `/manifiestos/[id]/asignar` |
| Conductores: listar + detalle | `asignar_y_reasignar_pedidos` | — | `/conductores`, `/[id]` |
| Incidencias: registrar, clasificar, acciones de reputación | `gestionar_incidencias` | — | `/operaciones/incidencias` |

¹ *operativo* = `asignar_y_reasignar_pedidos` ∨ `generar_manifiestos` ∨ `ajustar_operacion_diaria`.

### Job: Cerrar la trastienda de dinero (el foso)
| Capacidad | RBAC | Sensib. | Evidencia |
|---|---|---|---|
| Períodos: ver · cerrar período · **emitir factura DTE al seller** (gate humano) | `emitir_facturas` | **$ 📄** irreversible | `/dinero/periodos`, `/[periodoId]` |
| Liquidaciones de conductores: ver · **generar** | `gestionar_liquidaciones_conductores` | **$** | `/dinero/liquidaciones`, `/[id]` |
| Conciliación entregado-vs-facturado (bandeja de excepciones) | `ver_conciliacion` | — (solo lectura, detective) | `/dinero/conciliacion` |
| Cobranza / Pagos (estado de cuenta, morosidad, pago→conductor) | `ver_conciliacion` ∨ `gestionar_cobranza` | **$** | `/dinero/cobranza` |

### Job: Configurar el courier
| Capacidad | RBAC | Sensib. | Evidencia |
|---|---|---|---|
| Onboarding (hub) + pasos | `gestionar_configuracion_dte` | — | `/onboarding` |
| · Certificado digital (DTE) | idem | **🔒** cifrado, nunca visible | `/onboarding/dte` |
| · Folios (CAF) / proveedor DTE | idem | **🔒 📄** | `/onboarding/folios` |
| · Tarifas iniciales | `gestionar_tarifas` | — | `/onboarding/tarifas` |
| · Cobranza (setup pagos Fintoc) | idem | **🔒** | `/onboarding/cobranza` |
| Tarifas (config permanente) | `gestionar_tarifas` | — | `/configuracion/tarifas` |
| API e integraciones (salud ML, reconexión, backfill) | `gestionar_tarifas`² | **🔒** tokens ML | `/configuracion/api` |
| Zonas de reparto | operativo/config² | — | `/configuracion/zonas` |
| Equipo (usuarios internos, invitar, roles) | `gestionar_usuarios_y_roles` | 🔒 | `/equipo` |
| Sellers: listar + **invitar** | *(sin gate hoy)* ⚠︎ | 🔒 | `/sellers`, `/invitar` |
| Exportar datos (portabilidad RNF-13) | `ver_bitacora_auditoria` | 📄 | `/configuracion/exportar-datos` |
| **Mi plan** (suscripción del courier a Rutax) | `gestionar_suscripcion` (**solo `dueno`**) | **$** | `/configuracion/plan` |

² **⚠︎ Divergencias de gating** detectadas para la Fase IA a confirmar con `seguridad-cumplimiento`:
- **Sellers** se muestra a **todos** los roles internos (el ítem se agrega sin `if` de capacidad). Invitar seller maneja PII → conviene gatearlo.
- **API e integraciones** y **Zonas** cuelgan hoy del check `puedeGestionarTarifas` (agrupados bajo el mismo `if`), no de una capacidad propia. Semánticamente "salud ML/reconexión" es operación/config, no tarifas.
- El label del ítem `/onboarding` es **"Configuración"** (hub) — colisiona conceptualmente con el grupo "Configuración". La Fase IA lo resuelve.

---

## C. Seller (`portal`) — *espaciado, tranquilizador*

Rol único, **sin variantes RBAC** → navegación fija. Job central: "¿me cobraron bien y dónde están mis pedidos?".

| Job | Capacidad | Sensib. | Evidencia |
|---|---|---|---|
| Entrar / orientarse | Home / resumen · Bienvenida-onboarding | — | `/portal`, `/portal/bienvenida` |
| Conectar su fuente | **Conectar ML (OAuth)** + reconexión | 🔒 tokens | `/portal/conectar-ml` |
| Sus pedidos | Listar · ver · **crear same-day** (con destino de facturación) | $ (destino de cobro) | `/portal/pedidos`, `/[id]`, `/nuevo` |
| | Descargar etiqueta same-day | 📄 | (acción en pedido) |
| Sus incidencias | Seguir las suyas | — | `/portal/incidencias` |
| Su dinero | Estado de cuenta + detalle de período + **descargar DTE** | 📄 | `/portal/cobros`, `/[periodoId]` |
| Auth | Login seller | 🔒 | `/portal/login` |

**Nota de diseño:** el seller es 1:1 con ML hoy; el roadmap "seller hasta 3 cuentas ML" (1:N) impactará la vista de conexión y el badge de cuenta de origen en pedidos. **No** es alcance de este rediseño visual, pero el layout de `/portal/conectar-ml` debe **no estorbar** ese futuro (lista de conexiones, no una sola).

---

## D. Conductor (`conductor`) — *PWA táctil, alto contraste*

Rol único. Superficie operativa **unificada** (todas las fuentes). Job: "cerrar mis paradas hoy y ver qué me pagan".

| Job | Capacidad | Sensib. | Evidencia |
|---|---|---|---|
| Orientarse | Home | — | `/conductor` |
| Hacer la ruta | **Manifiesto del día** (paradas) + detalle de parada/pedido | ver_ruta_propia | `/conductor/manifiesto`, `/[pedidoId]` |
| Dejar evidencia | Evidencia interna de entrega (informativa; POD Flex sigue en la app de ML) | marcar_evidencias_propias | `/conductor/manifiesto/[pedidoId]` |
| Confirmar | Confirmar manifiesto propio | confirmar_manifiesto_propio | (acción en manifiesto) |
| Su dinero | Mis liquidaciones | ver_liquidacion_propia | `/conductor/liquidaciones` |

**⚠︎ Divergencia:** nav actual = header superior con 2 links. El rediseño pide **nav inferior táctil (≥44px)**. Existe además la **app nativa Expo** (`Desktop/rutax-conductor`) — este rediseño toca **solo la PWA**, pero debe mantener paridad conceptual de estados.

---

## E. Público / auth / tracking — *sin login*

| Capacidad | Sensib. | Evidencia |
|---|---|---|
| Landing | — | `/` |
| Login interno · Registro (+ revisa-tu-correo) · Activar cuenta · Invitación por token | 🔒 | `/login`, `/registro`, `/activar-cuenta`, `/invitacion/[token]` |
| **Tracking público del destinatario** (RF-051) | PII mínima | `/tracking/[token]` |
| Offline (PWA) | — | `/offline` |

---

## Acciones con "fricción deliberada" (transversal — DESIGN §8)

Estas **no** son pantallas: son **flujos con confirmación** que el rediseño trata con un patrón único (dialog de resumen + confirmación explícita, estilo Retell / comportamiento Rutax):

1. **Emitir factura del período (DTE)** — irreversible ante el SII, gate humano. Resumen "vas a emitir N facturas por $X a M sellers" + confirmación. `emitirFacturaPeriodo` (`puedeEmitirFacturas`). **$ 📄**
2. **Cerrar período** — `cerrado` dispara solo conciliación; la emisión es un paso humano aparte. **$**
3. **Generar liquidaciones** de conductores — resumen antes de confirmar. **$**
4. **Pago a conductor** (Fintoc) — confirmación + webhook. **$**
5. **Cargar certificado / secretos** (DTE, tokens ML) — campos marcados sensibles, **nunca** muestran el valor, copy de "cifrado". **🔒**
6. **Same-day nuevo** con **destino de facturación**. **$**
7. **Asignar/reasignar** en manifiesto — selección múltiple + acción masiva. **⧉**
8. **Suspender courier** / **impersonar** (admin) — auditado, con confirmación. **$ 🔒**

**Regla de auditoría (no se toca):** bitácora **antes** del efecto externo, con `actorUsuarioId`. El rediseño solo cambia la **presentación** de estos flujos.

---

## Componentes de dominio a centralizar (reusar, no duplicar)

Ya existen helpers que el rediseño debe **respetar y envolver**, no reinventar:
- `src/lib/ui/traduccion-estados.ts` — traducción + colores de estados (pedido/DTE/incidencia) → base del **Badge de estado** con punto de color.
- `src/lib/ui/formato-moneda.ts` — CLP → base del **Monto CLP** mono-tabular.
- `src/lib/ui/comunas-rm.ts` — catálogo de comunas RM → **selector de comuna**.
- `src/lib/ui/semaforo-sla.ts`, `mapas.ts` — SLA y mapas.
- Dominio ya componentizado: `dialog-confirmacion-dinero.tsx`, `data-table.tsx`, `empty-state.tsx`, `CentroAvisos`, `PaletaComando` (⌘K).

---

## Inventario técnico (con qué primitivas cuento — no para preservar layouts)

**Primitivas shadcn (`src/components/ui/`, 24):** label, alert, separator, tabs, select, skeleton, textarea, dropdown-menu, sonner, progress, tooltip, avatar, checkbox, badge, button, card, **data-table**, **dialog-confirmacion-dinero**, dialog, **empty-state**, input, pagination, popover, sheet, table.
→ Cubren casi todos los patrones de Retell. **Faltan** para el ADN: `switch/toggle`, `slider`, `command`/⌘K formal (hoy `PaletaComando`), `date-range-picker`, `chart` (line/donut/area), `segmented-control`, `breadcrumb`/nav anidada de settings, `kbd`.

**Tokens y movimiento (`globals.css`):** sistema OKLCH light/dark con estados semánticos ya en el formato `solid + foreground + subtle + subtle-foreground` (¡ya coincide con el ADN de Retell!). Movimiento con `--motion-*` (instant/fast/base/slow/page), `--ease-*` (standard/out/in/emphasis), sombras `xs/sm/md`, y `prefers-reduced-motion` **ya resuelto**. Primary actual = **navy** `oklch(0.38 0.13 264)`, fuente **Geist**.
→ La migración de la Fase 1/2 es **de valores**, no de estructura: cambian colores y fuente; el andamiaje `@theme inline` + motion **se conserva**.

---

## Conclusiones de la Fase 0 (para decidir en la Fase IA)

1. **Cobertura:** las 4 superficies + público están completas en código y coinciden con el inventario. No hay capacidad "huérfana" ni faltante.
2. **La estructura de tokens ya es compatible con Retell** (estados subtle, motion, sombras). El salto es de valores + fuente + shell, no de arquitectura CSS.
3. **Decisiones de IA que quedan abiertas** (se resuelven en Fase IA, no ahora): (a) reagrupar el sidebar `(tenant)` — el hub `/onboarding` etiquetado "Configuración" colisiona; (b) `admin` pasa de barra horizontal a **sidebar denso** con Overview raíz y gating por `rolAdmin`; (c) conductor pasa a **nav inferior**; (d) cerrar los **⚠︎ de gating** (Sellers sin gate, API/Zonas colgando de `tarifas`) — esto **toca lógica de RBAC**, así que por §4·6 del prompt **se pregunta antes de cambiarlo**, no se toca en el rediseño visual salvo aprobación.

---

🛑 **CHECKPOINT 0** — Este es el inventario de capacidades (no un plan de pantallas). Al aprobarlo, paso a la **Fase IA** (re-arquitectura de la información desde cero por superficie). Antes de avanzar necesito tu decisión sobre los **⚠︎ de gating** del bloque B (ver pregunta).
