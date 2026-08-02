# FRONTEND_EXPERIENCE_AUDIT.md — Auditoría obsesiva de experiencia visual y consistencia

> **Qué es.** No es una auditoría funcional ni técnica. Es una revisión obsesiva de **experiencia visual y consistencia**, pantalla por pantalla, componente por componente, contra el estándar que el propio proyecto se fijó en [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), [UX_STRATEGY.md](UX_STRATEGY.md) y [FRONTEND_IMPLEMENTATION_PLAN.md](FRONTEND_IMPLEMENTATION_PLAN.md).
>
> **Referencias (principios extraídos, no copiados).** Linear (consistencia extrema, densidad), Stripe (calidad premium, confianza), Duolingo (motion, feedback, detalle), Notion (jerarquía, organización), Vercel (pulido, minimalismo).
>
> **Método.** Lectura directa del código: `globals.css`, las primitivas en `src/components/ui/`, los compuestos de dominio y una muestra representativa de las ~41 pantallas de las 3 superficies (backoffice, portal seller, PWA conductor). Los hallazgos transversales se cuantificaron con búsquedas sobre todo `src/`.
>
> **Fecha:** 2026-06-13 · **Rama:** feat/frontend-premium-rutax · **Commit base:** `23a2c13` (migración premium Fases 1–8).

---

## TL;DR — el veredicto en una línea

Rutax tiene **cimientos de nivel premium** (tokens OKLCH, navy de marca, color semántico, app-shell agrupado, estados de sistema reales) montados sobre una **última milla inconsistente**: la mayoría de las pantallas **bypassa los componentes del sistema** que se construyeron para ellas (badges hechos a mano en ~20 archivos, `<select>` nativo en 15, cards hand-rolled), el **centro de avisos no está conectado a datos**, los **tokens de motion están cableados pero no se usan**, y los **inputs no tienen estados de validación**. El motor visual es sólido; la carrocería está a medio pulir.

**El producto se siente: BUENO** (no "Muy bueno", lejos de "Premium"). Justificación brutal en la [Fase 6](#fase-6--score-global).

---

# FASE 1 — Inventario completo

Escala 1–10. **UX** = claridad, flujo, jerarquía, estados de sistema. **UI** = consistencia visual, uso correcto de tokens/componentes. **Modernidad** = motion, densidad, sensación premium (Linear/Stripe/Vercel).

> Nota de honestidad: las pantallas marcadas **[leída]** se auditaron línea a línea. Las marcadas **[patrón]** se puntúan por inferencia a partir de los patrones transversales verificados con búsqueda (mismo uso de `COLOR_ESTADO_*` hand-rolled, mismo `<select>` nativo, misma estructura Server Component). Donde infiero, la incertidumbre es de ±1.

### Backoffice del courier `(tenant)` — denso

| Pantalla | UX | UI | Modernidad |
|---|---|---|---|
| Dashboard del dueño **[leída]** | 8 | 7 | 6 |
| Operaciones · lista de pedidos **[leída]** | 8 | 7 | 6 |
| Operaciones · detalle de pedido **[patrón]** | 7 | 6 | 5 |
| Operaciones · incidencias (lista) **[patrón]** | 7 | 6 | 5 |
| Incidencias · panel/registro **[patrón]** | 7 | 6 | 6 |
| Manifiestos · lista **[patrón]** | 7 | 6 | 5 |
| Manifiestos · nuevo (form) **[patrón]** | 7 | 6 | 5 |
| Manifiestos · detalle + asignar **[patrón]** | 7 | 6 | 6 |
| Dinero · períodos (lista) **[patrón]** | 7 | 6 | 5 |
| Dinero · período detalle (emisión DTE) **[patrón]** | 8 | 7 | 7 |
| Dinero · liquidaciones **[patrón]** | 7 | 6 | 5 |
| Dinero · conciliación **[leída]** | 8 | 7 | 6 |
| Dinero · cobranza **[patrón]** | 7 | 6 | 5 |
| Onboarding · panel/secuencia **[patrón]** | 8 | 7 | 6 |
| Onboarding · DTE / folios / tarifas / cobranza (forms) **[patrón]** | 7 | 7 | 6 |
| Equipo **[patrón]** | 6 | 6 | 5 |
| Sellers (lista + invitar) **[patrón]** | 6 | 6 | 5 |
| Configuración · exportar datos **[patrón]** | 6 | 6 | 5 |

### Portal del seller `portal/` — tranquilizador

| Pantalla | UX | UI | Modernidad |
|---|---|---|---|
| Inicio + conexión ML **[patrón]** | 7 | 6 | 6 |
| Pedidos (tracking) **[patrón]** | 7 | 6 | 5 |
| Incidencias **[patrón]** | 7 | 6 | 5 |
| Cobros · lista (estado de cuenta) **[leída]** | 8 | 7 | 6 |
| Cobros · detalle período **[patrón]** | 8 | 7 | 6 |
| Pedidos · nuevo same-day **[patrón]** | 6 | 6 | 5 |
| Bienvenida / conectar-ml **[patrón]** | 7 | 6 | 6 |
| Login seller **[patrón]** | 6 | 6 | 5 |

### PWA del conductor `conductor/` — mínimo, táctil

| Pantalla | UX | UI | Modernidad |
|---|---|---|---|
| Manifiesto del día **[leída]** | 8 | 7 | 6 |
| Manifiesto · detalle de parada **[patrón]** | 7 | 6 | 6 |
| Liquidaciones **[patrón]** | 7 | 6 | 5 |
| Layout/nav PWA **[leída]** | 7 | 6 | 5 |
| Offline **[patrón]** | 7 | 6 | 6 |

### Auth / públicas

| Pantalla | UX | UI | Modernidad |
|---|---|---|---|
| Login interno **[patrón]** | 6 | 6 | 5 |
| Registro (alta empresa) **[patrón]** | 6 | 6 | 5 |
| Revisa tu correo / reenviar **[patrón]** | 6 | 6 | 5 |
| Invitación · aceptar **[patrón]** | 6 | 6 | 5 |
| Activar cuenta **[patrón]** | 6 | 6 | 5 |

**Promedio aproximado:** UX **7.0** · UI **6.3** · Modernidad **5.5**.

La señal del inventario es nítida: **UX bien resuelta, UI consistente solo a medias, Modernidad floja**. La caída de UX→UI→Modernidad mide exactamente la brecha entre "diseñamos buenos componentes" y "los usamos en todas partes / les pusimos vida".

---

# FASE 2 — Detección de lo que no alcanza el estándar

## 2.1 Componentes obsoletos / patrones visuales antiguos

| # | Hallazgo | Evidencia | Severidad |
|---|---|---|---|
| **D-1** | **Sistema de badges DOBLE.** Existe `Badge` con variantes semánticas (`success/warning/info/error/neutral`) **y** un sistema paralelo `COLOR_ESTADO_*` + `CLASES_BADGE_VARIANTE` que se pinta como `<span>` hecho a mano. **~20 pantallas usan el `<span>` hand-rolled, no el componente.** Misma información de color, dos implementaciones. | `traduccion-estados.ts` (`CLASES_BADGE_VARIANTE`) vs `badge.tsx`; `<span className="inline-flex rounded-full px-2 py-0.5 …">` en `operaciones/page.tsx:296`, `portal/cobros/page.tsx:189`, `conductor/manifiesto/page.tsx:291`, `trazador-lazo.tsx:37`, conciliación, liquidaciones, períodos… | **Alta** |
| **D-2** | **`<select>` nativo del navegador en 15 pantallas** mientras el `Select` de Radix (estilado, animado) solo se usa en 3 forms de onboarding. El filtro de operaciones, conciliación, dinero, manifiestos, portal usan `<select className="h-9 rounded-md border …">` nativo: estética y comportamiento distintos (popover del SO, sin animación, foco distinto). | `<select>` en `conciliacion/page.tsx:229`, `filtros-pedidos.tsx`, `dinero/*`, `manifiestos/page.tsx`, `portal/*` (15 archivos). `Select` solo en `onboarding/{dte,tarifas,folios}`. | **Alta** |
| **D-3** | **`Card` primitivo divergente y subutilizado.** El componente `Card` usa `ring-1 ring-foreground/10` **sin sombra**; las pantallas densas hand-rollean `rounded-xl border border-border bg-card shadow-xs` como `<article>`/`<div>`. Resultado: **una "card" se ve distinta** (anillo vs borde, con sombra vs sin sombra) según la pantalla. | `card.tsx:15` (`ring-1`, sin shadow) vs `dashboard/page.tsx:171,437`, `data-table.tsx:29`, `trazador-lazo.tsx:95` (`border` + `shadow-xs`). 14 archivos importan `Card`; las pantallas-héroe no. | **Media** |
| **D-4** | **Controles hand-rolled que saltan la primitiva `Button`.** El botón "Reintentar" del conductor es un `<button className="rounded-lg bg-primary px-6 py-3 …">` crudo, no `<Button>`. | `conductor/manifiesto/page.tsx:191-197` | **Media** |
| **D-5** | **`Input` sin estados de validación.** El plan (UI-8) prometió error/success visibles + ✓ de RUT; `input.tsx` sigue siendo la base shadcn con solo `aria-invalid`. No hay variante de éxito ni patrón de error inline reutilizable; cada form resuelve sus errores a mano. | `input.tsx` (19 líneas, sin estados); contradice `FRONTEND_IMPLEMENTATION_PLAN.md` Fase 2 ("Input con error/success ✅"). | **Media** |
| **D-6** | **Estados de sistema del conductor hand-rolled**, sin usar `EmptyState`. Los "sin manifiesto / borrador / error" del conductor son `<div className="py-12 text-center">` sueltos; el resto de la app usa `EmptyState`. Inconsistencia de los estados vacíos entre audiencias. | `conductor/manifiesto/page.tsx:185-233` vs `EmptyState` en operaciones/conciliación/cobros. | **Media** |

## 2.2 Layouts anticuados / jerarquías pobres

| # | Hallazgo | Evidencia | Severidad |
|---|---|---|---|
| **L-1** | **El "héroe es el dinero" se afirma pero el dashboard lo entierra.** UX-2/P1 exige que el estado financiero sea omnipresente y co-protagonista. En el dashboard el bloque "Dinero del mes" va **debajo** de KPIs operativos, rezagados y distribución, y **solo aparece si `periodosTotal > 0`**. La narrativa visual sigue siendo operación-primero. | `dashboard/page.tsx:421` (bloque 1.2, tras KPIs y rezagados) | **Media** |
| **L-2** | **Anchos de tabla con `style={{ width: "22%" }}` inline** en lugar de utilidades/tokens. Mezcla estilos inline con Tailwind; rompe la regla "nada de valores mágicos". | `portal/cobros/page.tsx:141-150`, `conciliacion/page.tsx:324-339` | Baja |
| **L-3** | **Jerarquía por caja, no por espacio (contra DESIGN principio 6).** Abundan los contenedores `rounded-xl border … p-4` anidados con divisores; poco aprovechamiento de espacio en blanco + peso tipográfico como separador. El dashboard apila 7 secciones encajonadas casi idénticas. | dashboard (7 bloques `border`), trazador, cobros | Baja |
| **L-4** | **PWA conductor sin nav inferior de pulgar.** DESIGN §7 pide navegación inferior fija (pulgar) para el conductor; el layout usa una nav **superior** con dos links de texto. Funciona, pero no es el patrón táctil prometido. | `conductor/layout.tsx:46-64` | Baja |

## 2.3 Formularios / tablas / modales básicos

- **Formularios:** sin patrón `Form` (RHF+Zod) materializado en componente reutilizable; validación de RUT/CLP no tiene feedback inline estandarizado (✓/✗ junto al campo). El estado "Guardando… → Guardado · 14:32" (S-5) no se observa.
- **Tablas:** el sistema `DataTable` + densidades **sí** se aplicó (bien). Pero les falta lo que DESIGN §5 promete y aún no existe: **ordenamiento por columna**, **selección múltiple con barra de acciones masivas**, **fila clickeable que abre drawer** (hoy navega a página), y **"1–50 de 1.240"** (la toolbar muestra solo "N pedidos", sin rango).
- **Modales:** el `DialogConfirmacionDinero` es **excelente** (consecuencia escrita, checkbox, `Esc` deshabilitado) — el mejor componente del repo. Los drawers operativos (cambio de estado, incidencia, reasignación) están tokenizados pero sin la riqueza de previsualización del de dinero.
- **Dashboards:** KPIs como tarjetas + barras de distribución con color semántico (bien), pero **sin un solo gráfico real** pese a tener `--chart-1..5` con color cableado. La "visualización" es una barra de progreso CSS.

---

# FASE 3 — Oportunidades de mejora (clasificadas)

## 3.1 Quick Wins (alto ROI, bajo esfuerzo — horas/1 día)

| # | Acción | Por qué |
|---|---|---|
| **QW-1** | **Reemplazar los `<span>` de estado hand-rolled por `<Badge variant=…>`** y derivar la variante desde un único `estadoAVarianteBadge(estado)`. Borra `CLASES_BADGE_VARIANTE` como string suelto. | Mata D-1: una sola fuente y un solo render de badge en las 41 pantallas. Consistencia extrema (Linear) de un golpe. |
| **QW-2** | **Migrar los 15 `<select>` nativos al `Select` de Radix** ya existente. | Mata D-2: dropdowns idénticos, animados y accesibles en toda la app. |
| **QW-3** | **Cambiar el `<button>` crudo del conductor por `<Button>`** y los estados sueltos por `EmptyState`. | Cierra D-4/D-6; el conductor deja de ser la oveja negra de consistencia. |
| **QW-4** | **Mostrar rango total en la toolbar de tablas** ("1–25 de 312"). | DESIGN §5; el dato ya está (`total`, `pagina`, `limite`). |
| **QW-5** | **Unificar el "card": decidir border+shadow O ring**, y aplicarlo en `Card` y en el patrón hand-rolled (o reemplazar hand-rolled por `Card`). | Mata D-3; una textura de superficie única. |

## 3.2 High Impact (mueven la percepción — días)

| # | Acción | Por qué |
|---|---|---|
| **HI-1** | **Conectar el `CentroAvisos` a datos reales** (folios bajos, conexiones ML caídas, incidencias >4h, morosidad). Hoy es un placeholder con `const avisos = []`: la campana **siempre** dice "Sin avisos" aunque el dashboard muestre banners rojos. | Es UX-5/§A5 marcado "Alto impacto / ✅" pero **a medio construir**. Rompe la confianza: el usuario ve la alerta en una pantalla y no en el lugar diseñado para alertas. |
| **HI-2** | **Aplicar el motion cableado.** Los tokens `--motion-*`/`ease-*` existen pero **solo `sheet.tsx` los usa**. Implementar el catálogo de DESIGN §3/§4: fila nueva (fade+8px), microinteracción de cambio de estado, overshoot `emphasis` en éxito de dinero, escala de dropdown/modal. | Es el 90% de la sensación "premium/Duolingo" que hoy falta. Modernidad sube de 5.5 a ~7. |
| **HI-3** | **Dar al `Input` estados error/success + validación inline de RUT/CLP** y un `Field` (label+ayuda+error+`aria-describedby`) reutilizable. | Cierra D-5 y DESIGN §6; sube la confianza en los forms críticos (onboarding, altas). |
| **HI-4** | **Selección múltiple + barra de acciones masivas + UI optimista** en la lista de pedidos. | UX-7/§A4: el flujo más repetido del día sigue siendo de a uno. Velocidad percibida (Linear). |
| **HI-5** | **Subir "Dinero del mes" arriba en el dashboard** (junto a KPIs, no tras 4 bloques) y mostrarlo aunque esté en cero ("aún sin períodos este mes"). | UX-2/P1: que el dinero **se sienta** como héroe, no como pie de página. |

## 3.3 Transformacional (redefinen la experiencia — semanas)

| # | Acción | Por qué |
|---|---|---|
| **TR-1** | **Gráficos reales en el dashboard** (línea de cobrado vs comprometido del mes, dona de distribución por estado) con `--chart-*`. | Convierte el dashboard de "tablero de texto" en "panel ejecutivo" (Stripe/Notion). |
| **TR-2** | **Fila clickeable → drawer de detalle** en las tablas densas (pedido, período, liquidación) en vez de navegar a página completa. | DESIGN §5; mantiene contexto, acelera el escaneo-acción (Linear). |
| **TR-3** | **Command palette (⌘K)** para saltar a pedido/seller/período y acciones frecuentes. | Poder-usuario interno; cierra la promesa "atajos" de §2.2 UX_STRATEGY. |
| **TR-4** | **Trazador del lazo bidireccional embebido** (desde factura→entregas y desde pago→liquidaciones), no solo entrega→dinero. | UX-1/§A6 es *la* prueba de confianza; hoy es de una sola dirección. |

---

# FASE 4 — Propuestas específicas (no genéricas)

> Por exigencia del encargo: nada de "mejorar el dashboard". Cada propuesta dice **qué** reemplazar por **qué**.

1. **Badge de estado.** Reemplazar las ~20 ocurrencias de
   `<span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${COLOR_ESTADO_X[estado]}">`
   por `<Badge variant={varianteDeEstado(estado)}>{texto}</Badge>`, exponiendo `varianteDeEstado()` desde `traduccion-estados.ts` y **eliminando** `CLASES_BADGE_VARIANTE`/`COLOR_ESTADO_*` como strings. Un solo componente, una sola altura (`h-5`), un solo radio, mismos bordes — en las 3 superficies.

2. **Filtros.** Reemplazar el `<form method="get">` con `<select>` nativos de `conciliacion/page.tsx`, `filtros-pedidos.tsx` y dinero por una **barra de filtros con `Select` de Radix + chips activos removibles + persistencia en URL** (que ya existe) y un `Popover` "Filtros" en `md-`. Mismo patrón en todas las tablas.

3. **Dashboard.** Reordenar a: (1) banda de alertas accionables (folios/conexiones) → (2) **fila "Dinero del mes" con mini-gráfico de cobrado vs por-cobrar** → (3) KPIs operativos → (4) distribución/comunas. Y alimentar esos mismos avisos al `CentroAvisos` desde una función `obtenerAvisos(tenantId)` única.

4. **Centro de avisos.** Reemplazar `const avisos: […] = []` por una carga server-side (`obtenerAvisos`) que devuelva `{ id, tipo, urgencia, texto, href, accion }[]`, ordene por urgencia, pinte el badge de conteo real sobre la campana y liste avisos con su botón de acción ("Reconectar", "Cargar folios", "Ver incidencia"). Sin tocar copy que prometa email (P6).

5. **Tablas.** Reemplazar la `toolbar={<span>{total} pedidos</span>}` por `toolbar={<ToolbarTabla total={total} rango={[desde, hasta]} seleccion={…} acciones={…}/>}` con conteo "desde–hasta de total", checkbox maestro y barra de acciones masivas que aparece al seleccionar.

6. **Inputs.** Reemplazar los inputs sueltos + mensajes de error ad-hoc por `<Field label ayuda error>` con `<Input aria-invalid>` + ✓ verde cuando el RUT valida en blur, reutilizando el validador de RUT existente.

7. **Conductor.** Reemplazar la nav superior de texto por **nav inferior fija de 2 destinos con ícono+label y target ≥44px**, y el `<button>` "Reintentar" por `<Button>`; estados por `EmptyState` con `tono` adecuado.

---

# FASE 5 — Oportunidades por patrón moderno

| Patrón | ¿Hoy? | Oportunidad concreta |
|---|---|---|
| **Visualizaciones / gráficos** | ❌ (barras CSS) | Dona de distribución por estado + línea cobrado/comprometido (charts con `--chart-*`). |
| **KPIs** | 🟡 (tarjetas de texto) | KPIs con sparkline y delta vs ayer/mes anterior. |
| **Timeline view** | 🟡 (TrazadorLazo es casi un timeline) | Generalizar el `Nodo`/línea del trazador a un componente `Timeline` reusable (historial de pedido, de período). |
| **Kanban view** | ❌ | Pedidos por estado como columnas arrastrables para asignación visual (opcional; cuidado con scope MVP). |
| **Command palette (⌘K)** | ❌ | Saltar a pedido/seller/período; acciones frecuentes. |
| **Context panels (drawer)** | 🟡 (drawers existen) | Fila→drawer de detalle sin abandonar la lista. |
| **Smart filters** | 🟡 (URL params) | Chips activos removibles + filtros guardados ("mi recorte del día"). |
| **Bulk actions** | ❌ | Selección múltiple → asignar conductor/manifiesto/exportar. |
| **Empty states** | ✅ (buenos) | Falta solo unificar el conductor al componente. |
| **Progressive disclosure** | 🟡 | Desglose de monto (tarifa + ajuste incidencia) en popover/expand — UX-8 aún pendiente. |
| **Motion / microinteracciones** | ❌ (tokens sin uso) | Todo el catálogo DESIGN §3/§4 — el mayor déficit de modernidad. |

---

# FASE 6 — Score global

## ¿El producto se siente Básico / Correcto / Bueno / Muy bueno / Premium?

### **BUENO** — con cimientos de Muy bueno y una ejecución de Correcto.

### Justificación brutal

**Lo que está a nivel premium (no regalado — ganado):**
- La **base tokenizada** es de primera: OKLCH light/dark, navy de marca como recurso escaso aplicado bien, familia semántica completa (`success/warning/info/destructive` con `-subtle` y `-foreground`), elevación y motion definidos como tokens. Esto es mejor que el 90% de los SaaS B2B.
- El **app-shell agrupado** (Operación/Dinero/Configuración, filtrado por capacidad, responsive a Sheet) es correcto y limpio.
- El **`DialogConfirmacionDinero`** es ejemplar: consecuencia escrita, checkbox, `Esc`/click-fuera bloqueados. Stripe estaría conforme.
- Los **estados de sistema** (EmptyState con 3 tonos, "0 descuadres = todo cuadra" como confianza, errores no bloqueantes) están pensados como sistema, no caso a caso.
- El **TrazadorLazo** hace *sentir* el diferenciador entrega→dinero.

**Por qué NO es "Muy bueno" todavía — la verdad sin anestesia:**
1. **El producto construyó componentes premium y luego no los usó.** El pecado capital de una auditoría de *consistencia*: hay un `Badge`, pero 20 pantallas pintan badges a mano; hay un `Select`, pero 15 usan `<select>` nativo; hay un `Card`, pero las pantallas-héroe lo ignoran y además se ve distinto. Linear se trata de que **un botón se vea igual en las 41 pantallas** — aquí un *badge* no se ve igual ni en dos. Eso es exactamente lo que esta auditoría debía cazar.
2. **El centro de avisos es decorado, no función.** Una campana que siempre dice "sin avisos" mientras el dashboard grita en rojo es peor que no tener campana: erosiona la confianza que el producto entero persigue.
3. **Cero movimiento.** Se cableó un sistema de motion completo y no se conectó. Sin él, la app es competente pero inerte — le falta el "está vivo" de Duolingo y el pulido de Vercel. La modernidad vive aquí, y aquí está vacío.
4. **Los inputs no validan visiblemente.** En un producto de dinero, un form sin ✓/✗ inline junto al campo es una promesa de confianza incumplida (DESIGN §6).

**Por qué tampoco es "Correcto" (es mejor que eso):** la arquitectura visual es coherente, los estados existen, el color es semántico y accesible (color + texto), y el flujo crítico (DTE) está a prueba de errores. Un "Correcto" no tendría nada de eso.

### Veredicto numérico

| Eje | Score | Lectura |
|---|---|---|
| Fundaciones (tokens/sistema) | **8.5/10** | Premium. |
| Consistencia de componentes | **5.5/10** | El talón de Aquiles. |
| Estados de sistema | **8/10** | Sólido, falta unificar conductor. |
| Motion / vida | **2/10** | Cableado, sin usar. |
| Jerarquía / densidad | **7/10** | Buena, mejorable (dinero-héroe). |
| Accesibilidad base | **7.5/10** | Color+texto, focus, skip-link; falta verificación de contraste. |
| **Global** | **≈ 6.5/10 — "Bueno"** | A 1.5 puntos de "Muy bueno", a 3 de "Premium". |

### La buena noticia

La distancia a "Muy bueno" es corta y **barata**, porque el trabajo difícil ya está hecho. Los 5 Quick Wins + HI-1 (avisos) + HI-2 (motion) — todo aditivo, sin tocar backend — llevarían el global de **6.5 a ~8** y la sensación de **Bueno a Muy bueno**. El producto no necesita rediseño; necesita **terminar de usar lo que ya construyó** y **encenderle el movimiento**.

---

## Apéndice — Top 10 acciones, en orden de impacto/esfuerzo

1. `QW-1` Unificar badges → `Badge` (mata la inconsistencia #1).
2. `HI-1` Conectar el Centro de Avisos a datos.
3. `HI-2` Aplicar el motion ya cableado.
4. `QW-2` `<select>` nativo → `Select` de Radix.
5. `HI-3` `Input` con validación inline + `Field`.
6. `QW-5` Unificar la textura de "card".
7. `HI-5` Dinero-héroe arriba en el dashboard.
8. `QW-3` Conductor: `Button` + `EmptyState`.
9. `HI-4` Selección múltiple + acciones masivas en pedidos.
10. `TR-1` Gráficos reales en el dashboard.

---

*Auditoría derivada de la lectura directa del código en `feat/frontend-premium-rutax` contra [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), [UX_STRATEGY.md](UX_STRATEGY.md), [PRODUCT_BLUEPRINT.md](PRODUCT_BLUEPRINT.md) y [FRONTEND_IMPLEMENTATION_PLAN.md](FRONTEND_IMPLEMENTATION_PLAN.md). Hallazgos transversales cuantificados con búsqueda sobre `src/`. Foco: experiencia visual y consistencia — no funcionalidad ni arquitectura.*
