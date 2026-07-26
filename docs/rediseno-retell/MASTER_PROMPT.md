# PROMPT MAESTRO — Rediseño integral de Rutax con el ADN de Retell AI

> **Cómo usar este archivo:** cópialo a la raíz del repo de Rutax (`SaaS Courier Again`) y pégalo como primer mensaje en una sesión de Claude Code **Opus 4.8, esfuerzo alto**. Ejecuta **por fases**, deteniéndote en cada checkpoint para revisar. Opcional: copia también `retell-dna/design-system.md` a `docs/retell-dna.md` para tener el volcado completo de tokens (1029 light / 592 dark).

---

## 0. ROL Y MISIÓN

Eres el **UI Lead** del rediseño de **Rutax**, un SaaS B2B multi-tenant para couriers de última milla en Chile (operación Flex + same-day + trastienda de dinero). Tu misión: **reconstruir toda la capa visual del producto adoptando el ADN de diseño del dashboard de Retell AI** (`dashboard.retellai.com`), aplicado a la identidad de Rutax — sin copiar logo, nombre ni ilustraciones propietarias de Retell.

**Regla rectora:** esto NO es un reskin superficial. Es reemplazar el sistema de diseño `v1 provisional` actual (navy + Geist) por uno nuevo basado en el ADN de Retell (neutro cool + azul de acento + Inter), manteniendo intactas la arquitectura de información, el RBAC, las 3 superficies y los principios de negocio de Rutax.

**No-negociables de Rutax que NO se tocan** (solo cambia lo visual):
- Aislamiento por RLS, RBAC, gating de capacidades, gate humano de DTE, bitácora, jobs Inngest, localización Chile. El rediseño es **solo de presentación**: componentes, tokens, layout. Ninguna lógica de dominio, dato ni contrato cambia.

---

## 0.1 DECISIONES CONFIRMADAS Y MODELO OPERATIVO (2026-07-22)
- **Ejecución: en el repo.** Todo el trabajo (diseño + implementación) ocurre sobre `SaaS Courier Again`, **fase por fase**.
- **Validación visual con Claude in Chrome.** Al cerrar cada fase se levanta la app (`npm run dev` + entorno local de `docs/PRUEBA.md`) y se valida en el navegador contra el ADN (**light + dark + responsive**). Rutax tiene **data dummy** en todo el repo → **permiso total para probar**; solicita las credenciales/accesos demo cuando haga falta.
- **Cadencia: checkpoint por fase (🛑).** No avanzar sin aprobación explícita.
- **Acento = NAVY propio de Rutax** (no el azul de Retell). Ver §2.2/§2.4.
- **Superficie `admin` incluida** en el rediseño (completa).
- **Skills de apoyo** (`web-artifacts-builder`, `canvas-design`) bajo brief orquestado por Claude (§6).

---

## 1. CONTEXTO YA CONOCIDO DE RUTAX (no re-descubrir, verificar)

- **Stack:** Next.js 16 · React 19 · **Tailwind v4** (`@theme` en `src/app/globals.css`) · **shadcn/ui sobre Radix** · Lucide · sonner (toasts) · next-themes · Supabase. **Es el mismo stack base que Retell** → la migración es limpia.
- **4 superficies** (App Router groups):
  - `admin/` — **consola de plataforma del fundador** (super-admin): couriers/tenants, suscripciones, planes, métricas, salud, seguridad, bitácora, comunicaciones. *Densa, tipo consola.*
  - `(tenant)/` — backoffice del courier (denso). Personas: dueño · supervisor · coordinador · administración.
  - `portal/` — portal del seller (espaciado, tranquilizador).
  - `conductor/` — PWA del conductor (táctil, móvil-first).
  - (+ público/auth y **tracking** `/tracking/[token]` sin login.)
- **INSUMO OBLIGATORIO: `rutax-inventario-funcional.md`** — inventario **layout-agnóstico** de todas las capacidades (RF-001..RF-051) por persona. **Es la fuente de verdad del rediseño**, no las pantallas actuales.
- La navegación/agrupación/pantallas actuales son **solo evidencia de que la capacidad existe** — NO se preservan (ver principio rector §4).
- **Design system actual:** `DESIGN_SYSTEM.md` (raíz) + `src/app/globals.css` (tokens OKLCH light/dark, sistema de movimiento `--motion-*`/`--ease-*`, sombras). Fuente actual: **Geist**. Primary actual: **navy** `oklch(0.38 0.13 264)`.
- **Componentes base:** ~20 primitivas shadcn en `src/components/ui/`.

**Fase 0 obligatoria antes de tocar nada** (ver §5).

---

## 2. EL ADN DE RETELL (fuente de verdad del nuevo diseño)

Extraído en vivo del DOM del dashboard real. Stack de Retell: Next.js + Tailwind + **shadcn/ui + AlignUI** + Inter + React Flow (su flow builder, no aplica a Rutax) + SweetAlert2/Fern.

### 2.1 Principios visuales (coinciden con los de Rutax — reforzarlos)
1. **Neutro cool que respira.** Shell en lavanda-gris `#f5f5fa`, contenido blanco, muchísimo aire, líneas divisorias mínimas.
2. **El color de acción es NEUTRO oscuro, no el azul.** Los botones primarios son casi-negros (`#2f3a4b`). El **acento es un azul NAVY propio de Rutax** (activo, enlaces, foco), recurso escaso — más profundo que el azul de Retell, para transmitir **confianza financiera**. El `--info` de estado sí es un azul más brillante.
3. **Sombras casi imperceptibles**, de baja opacidad y neutras.
4. **Tipografía Inter**, jerarquía restringida (pesos 400/500/600), títulos discretos (H2 = 20px/500).
5. **Estados de color semánticos** ricos (success/warning/error/info/feature/verified…) siempre con variante `subtle` para fondos de badge.
6. **Radios suaves** (8–10px), esquinas nunca pill salvo avatares/switches.

### 2.2 Tipografía
- **Familia: Inter** (self-hosted vía `next/font/google`), pesos **400 · 500 · 600 · 700**. Reemplaza Geist.
- Escala: `12 · 14 · 16 · 18 · 20 · 24 · 30 · 36 · 48`. Line-heights `18/22/24/26/28/38/46/60`.
- Números y dinero → mantener `--font-mono` con `tabular-nums` (regla de Rutax, compatible con Retell).

### 2.3 Radios · sombras · movimiento
- Radios: `xs 4 · sm 6 · md 8 (base) · lg 10 (botones) · xl 12 · 2xl 16 · full`.
- Sombras (portar tal cual): `xs 0 1px 2px rgba(0,0,0,.05)` · `sm 0 1px 3px + 0 0 2px rgba(0,0,0,.1)` · `md 0 4px 6px + 0 2px 4px rgba(0,0,0,.1)` · `dropdown 0 4px 8px/.06, 0 6px 12px/.04, 0 8px 24px/.04`.
- **Movimiento: conservar el sistema actual de Rutax** (`--motion-*`, `--ease-*`, reduced-motion) — es mejor que reinventarlo y coincide con la sobriedad de Retell.

### 2.4 Bloque de tokens nuevo para `globals.css` (reemplaza el `:root`/`.dark` actual)

> Valores derivados del ADN de Retell, expresados en el formato que ya usa Rutax. Mantén la estructura `@theme inline`/`@theme` existente; solo cambia los valores de `:root` y `.dark`. Puedes convertir a OKLCH si prefieres uniformidad perceptual; los hex de abajo son la referencia exacta.

```css
:root {
  /* Superficies (neutro cool de Retell) */
  --background: #ffffff;
  --foreground: #172131;          /* texto principal, azul-gris frío */
  --card: #ffffff;
  --card-foreground: #172131;
  --popover: #ffffff;
  --popover-foreground: #172131;

  /* Acción primaria = NEUTRO oscuro (firma de Retell), no el azul */
  --primary: #2f3a4b;
  --primary-foreground: #f6f8fb;

  --secondary: #f5f5fa;
  --secondary-foreground: #172131;
  --muted: #f5f5fa;
  --muted-foreground: #606a78;
  --accent: #eef0f6;              /* hover neutro sutil */
  --accent-foreground: #172131;

  /* Azul de marca/acento (info, enlaces, activo) — recurso escaso */
  --brand: #335cff;
  --brand-foreground: #ffffff;

  /* Bordes y foco */
  --border: #e6e6f3;
  --input: #e6e6f3;
  --ring: #335cff;

  /* Estado semántico: solid + foreground + subtle + subtle-foreground */
  --destructive: #fb3748;  --destructive-foreground:#ffffff;  --destructive-subtle:#ffebec;  --destructive-subtle-foreground:#681219;
  --success:     #1fc16b;  --success-foreground:#ffffff;      --success-subtle:#e0faec;      --success-subtle-foreground:#0b4627;
  --warning:     #ff8447;  --warning-foreground:#ffffff;      --warning-subtle:#fff3eb;      --warning-subtle-foreground:#683412;
  --info:        #335cff;  --info-foreground:#ffffff;         --info-subtle:#ebf1ff;         --info-subtle-foreground:#122368;

  /* Charts (paleta Retell) */
  --chart-1:#3370ff; --chart-2:#14c0ff; --chart-3:#7f3bf5; --chart-4:#ffc60a; --chart-5:#1fc16b;

  --radius: 0.625rem;             /* 10px = radio de botón; cards derivan a 8px */

  /* Sidebar (composición Retell) */
  --sidebar:#f5f5fa;
  --sidebar-foreground:#172131;
  --sidebar-primary:#2f3a4b;
  --sidebar-primary-foreground:#f6f8fb;
  --sidebar-accent:#ffffff;       /* pill del ítem activo = blanca */
  --sidebar-accent-foreground:#172131;
  --sidebar-border:#e5e5f2;
  --sidebar-ring:#335cff;
}

.dark {
  --background:#161718; --foreground:#f7f8fa;
  --card:#24272e; --card-foreground:#f7f8fa;
  --popover:#24272e; --popover-foreground:#f7f8fa;

  /* En dark, el primary de acción se invierte a casi-blanco (firma Retell) */
  --primary:#fcfcfe; --primary-foreground:#0a0d16;

  --secondary:#1f1f24; --secondary-foreground:#f7f8fa;
  --muted:#1f1f24; --muted-foreground:#9d9fa2;
  --accent:#222331; --accent-foreground:#f7f8fa;

  --brand:#5f69ed; --brand-foreground:#0a0d16;

  --border: rgba(255,255,255,.10);
  --input:  rgba(255,255,255,.15);
  --ring:#5f69ed;

  --destructive:#e93544; --destructive-foreground:#fff; --destructive-subtle:#3a1d1f; --destructive-subtle-foreground:#ff9c99;
  --success:#1daf61;      --success-foreground:#fff;     --success-subtle:#12241a;     --success-subtle-foreground:#3ee089;
  --warning:#e97135;      --warning-foreground:#fff;     --warning-subtle:#2a1f16;     --warning-subtle-foreground:#ffdc68;
  --info:#5f69ed;         --info-foreground:#fff;        --info-subtle:#1a1f45;        --info-subtle-foreground:#8fb4ff;

  --chart-1:#4c88ff; --chart-2:#42bdeb; --chart-3:#9762f5; --chart-4:#fac823; --chart-5:#54c248;

  --sidebar:#16191f; --sidebar-foreground:#f7f8fa;
  --sidebar-primary:#fcfcfe; --sidebar-primary-foreground:#0a0d16;
  --sidebar-accent:#24272e; --sidebar-accent-foreground:#f7f8fa;
  --sidebar-border: rgba(255,255,255,.08); --sidebar-ring:#5f69ed;
}
```

> **Acento NAVY (decisión 2026-07-22):** sustituye el azul de Retell por el navy de Rutax en `--brand` / `--ring` / `--sidebar-ring`: **`#2f43c4` (light)** y **`#7080f5` (dark)** en vez de `#335cff`/`#5f69ed`. `--info` (estado) **permanece** azul brillante (`#335cff`/`#5f69ed`). Calibra el navy exacto en **Fase 1 con validación visual** (referencia: navy actual de Rutax `oklch(0.38 0.13 264)`).
>
> Si añades tokens nuevos (`--brand`, `*-subtle`), **exponlos en `@theme inline`** (`--color-brand: var(--brand)`, etc.) para que existan como utilidades Tailwind. Valida contraste AA en ambos temas.

### 2.5 Catálogo de patrones de pantalla (plantillas)
Detalle completo en `retell-dna/design-system.md §10`. Resumen:
- **A. Shell/sidebar:** 260px, fondo lavanda, sin borde; workspace switcher arriba; nav agrupada con headers `xs` uppercase muted; **ítem activo = pill blanca** (con `shadow-xs`) + ícono coloreado; hover lavanda 5%; plan + cuenta abajo.
- **B. Listado con folders:** header (título + Search + acción secundaria outline + primaria oscura con caret) + tabla (avatar en celda ancla, badges, metadata muted, ⋮ por fila al hover) + paginación centrada.
- **C. Tabla densa + toolbar:** `Date Range · Filter · … · Actions`; tabla con scroll-x propio; **puntos de color de estado**; IDs mono; footer con total + paginación.
- **D. Dashboard analítico:** tabs + toolbar; **KPI cards** (número grande centrado en panel inset); line charts (grid punteado, línea azul, leyenda); donut/gauge (paleta chart).
- **E. Billing/plan:** header con acciones (outline + primary); **card de balance** (monto grande + acciones); tabs + tabla.
- **F. Estado de carga:** **skeleton rows** con el layout final (nunca spinner suelto); loader de marca en navegaciones pesadas.
- **G. Menús/dropdowns:** card con `shadow-dropdown`, ítems ícono+label, **acción destructiva en rojo** al final.
- **H. Settings:** **sidebar contextual anidado** ("‹ GO BACK" + sub-ítems) + **setting rows** (label + valor grande + descripción muted + control a la derecha: botón outline o **toggle**).
- **I. Toggle/switch:** ON = `--brand` azul, OFF = gris.

> **Dark mode validado en vivo:** el bloque `.dark` de §2.4 se contrastó contra el render real (fondo near-black, sidebar `#16191f`, cards `#24272e`, charts azul/cyan). Va afinado.

---

## 3. MATRIZ DE MAPEO (patrón Retell → pantalla Rutax)

El diseño debe **encajar** en las features de Rutax, no pegarse encima. Aplica cada patrón a su equivalente:

| Patrón Retell | Pantalla(s) de Rutax | Notas de encaje |
|---|---|---|
| **A. Shell/sidebar** | `AppShell` `(tenant)` + variantes ligeras para `portal` y `conductor` | (tenant) denso; portal espaciado; conductor = nav inferior táctil, no sidebar. Grupos ya existen (Operación/Dinero/Configuración). Workspace switcher = **selector de courier/tenant**; cuenta abajo = usuario + Cerrar sesión. Item "Mi plan" abajo (como "Free trial" de Retell). |
| **B. Listado con folders** | **Sellers**, **Conductores**, **Equipo** | La columna de folders → filtros/segmentos (activos, por estado ML, por rol). Acción primaria oscura: "Invitar seller/conductor". |
| **C. Tabla densa + toolbar** | **Pedidos**, **Manifiestos**, **Incidencias**, **Períodos**, **Liquidaciones**, **Conciliación**, **Pagos/Cobranza** | El caballo de batalla. Puntos de color = estados de pedido/DTE/incidencia (reusar `lib/ui/traduccion-estados.ts`). Montos CLP mono tabular a la derecha (regla Rutax). Fila → drawer de detalle (Sheet), no navegar fuera. Selección múltiple + barra de acciones masivas. |
| **D. Dashboard analítico** | **/dashboard** (dueño), reportería | KPI cards: entregas del día, $ por cobrar, $ por liquidar, incidencias abiertas. Charts con paleta chart semántica. |
| **E. Billing/plan** | **/configuracion/plan** (suscripción), **/portal/cobros** | Card de balance → estado de suscripción / saldo del período. Acciones: gestionar plan, método de pago (Fintoc). En portal: "¿me cobraron bien?" con descarga de factura PDF. |
| **F. Skeleton loading** | Todas las tablas y dashboards | Estándar en cada vista de datos (principio 7 de Rutax). |
| **Onboarding wizard** (Retell input/button DNA) | **/onboarding** (DTE, folios, tarifas) | Aplicar estilo de inputs/botones de Retell + filosofía de formularios de Rutax (una columna, label arriba, validación al blur, RUT/CLP). |
| **H. Settings (nav anidada + setting rows + toggle)** | **/onboarding, /configuracion/*** (Tarifas, API, Exportar, Equipo, Mi plan) | Sidebar contextual con "‹ Volver"; cada ajuste como fila (label + valor + descripción + botón/toggle). Toggles para opt-in (DTE real, alertas). |
| **G. Menú de fila (⋮) con acción destructiva** | Acciones por fila en todas las tablas | Duplicar/Exportar/… + **Eliminar/Anular en rojo**. Las acciones de dinero irreversibles pasan por confirmación (abajo). |
| **Confirmaciones (SweetAlert-like)** | **Emitir DTE / liquidar / anular** | Dialog irreversible con resumen + fricción deliberada (principio 8 de Rutax). Estilo Retell, comportamiento Rutax. |

**Calibración por superficie** (densidad, del DESIGN_SYSTEM de Rutax): `(tenant)` compacto · `portal` relajado (tablas → cards en móvil) · `conductor` táctil ≥44px, alto contraste, sin tablas.

---

## 4. PRINCIPIOS DE EJECUCIÓN (guardrails)

**0. PRINCIPIO RECTOR — Diseña desde la capacidad, NO desde el layout actual.** El rediseño es **greenfield en UX e información**: el insumo es `rutax-inventario-funcional.md` (qué puede hacer cada persona), no las pantallas de hoy. Está **permitido y esperado** reagrupar el sidebar y mover opciones entre menús, fusionar pantallas (detalle en drawer vs página) o dividir una densa en tabs, rediseñar formularios por completo (orden de campos, wizard vs página, inline vs modal), y cambiar dónde vive cada acción. El **único invariante es la capacidad** (que el usuario pueda hacer X, con su RBAC y su fricción de dinero); el **cómo/dónde se ve se rediseña libremente** con los patrones de Retell (`catalogo-visual.md`). Nunca "calques" la estructura existente por inercia — parte de la Arquitectura de Información nueva de la Fase IA.

1. **Tokens primero, componentes después, pantallas al final.** Nada de valores hardcodeados: todo sale de los tokens.
2. **Reutiliza, no dupliques.** Extiende las primitivas de `src/components/ui/`; centraliza patrones de dominio (badge de estado, monto CLP, confirmación de dinero) en un solo lugar.
3. **Cada vista de datos resuelve sus 4 estados:** vacío ≠ filtrado-sin-resultados, cargando (skeleton), error (reintentar), sin permiso (RBAC oculta).
4. **Accesibilidad AA no opcional** (software de dinero): contraste, foco visible `--ring`, teclado, `aria-*`, color nunca único portador de significado (estado = color **+** texto/ícono).
5. **Respeta el movimiento existente** (`--motion-*`, `--ease-*`, reduced-motion). No metas animaciones nuevas llamativas.
6. **No rompas dominio.** Cero cambios en lógica, datos, RLS, RBAC, jobs, contratos. Si una mejora visual requiere tocar lógica, **detente y pregunta**.
7. **Verifica al final de cada fase:** `npm run typecheck` + `npm run lint` + `npm run build` en verde; revisa en `npm run dev` (light **y** dark).
8. **Actualiza `DESIGN_SYSTEM.md`** para que refleje el nuevo ADN (no lo dejes describiendo el sistema navy viejo).

---

## 5. PLAN POR FASES (con checkpoints — detente en cada uno)

### FASE 0 — Inventario de capacidades (no escribir código aún)
- Parte de **`rutax-inventario-funcional.md`** (fuente de verdad). Verifícalo contra el código: enumera **capacidades por persona** (admin · courier · seller · conductor + público), sus acciones y su fricción de dinero.
- Escanea `src/components/ui/*` y el sistema de movimiento de `globals.css` **solo** para saber con qué primitivas/tokens cuentas (inventario técnico), **no** para preservar layouts.
- Entrega un **informe de capacidades** (no de pantallas): qué debe poder hacer cada rol, agrupado por *job*, con RBAC y acciones sensibles marcadas.
- 🛑 **Checkpoint 0:** apruebas el inventario de capacidades. *(Explícitamente NO se hace "plan de migración de pantallas" — el layout se rediseña en la Fase IA.)*

### FASE IA — Rediseño de la Arquitectura de Información (desde cero)
> El corazón del principio rector §4·0. Aquí se **re-arquitecta la UX**, sin mirar el layout actual.
- Para **cada superficie**, diseña **desde cero**: la **navegación** (qué grupos, qué ítems, en qué orden, qué colapsa), el **mapa de pantallas** (qué es página, qué es drawer, qué es tab, qué se fusiona/divide), y la **composición** de cada vista (jerarquía, dónde vive cada acción) — eligiendo el **patrón de Retell** adecuado por vista (listado, tabla densa, dashboard, settings-rows, wizard, form modal, etc. de `catalogo-visual.md`).
- Mapea **capacidad → patrón**, no pantalla-vieja → pantalla-nueva. Cuestiona toda agrupación heredada; propón la mejor, aunque difiera del sidebar actual.
- Resuelve por adelantado los **4 estados** (vacío/carga/error/permiso) y las **densidades** por persona (admin/courier densos, portal relajado, conductor táctil).
- Entrega un **IA Blueprint** por superficie: árbol de navegación nuevo + tabla capacidad→pantalla→patrón + wireframes conceptuales (pueden ser en texto/ASCII o low-fi).
- 🛑 **Checkpoint IA:** apruebas la nueva arquitectura ANTES de construir. Aquí es donde decides reubicaciones, fusiones y reagrupaciones.

### FASE 1 — Tokens & tema
- Reemplaza `:root`/`.dark` en `globals.css` con el bloque de §2.4. Añade tokens nuevos a `@theme inline`. Verifica contraste AA (light/dark).
- Asegura `ThemeProvider` de `next-themes` en el layout raíz (montar sin flash; `suppressHydrationWarning`).
- 🛑 **Checkpoint 1:** captura de una pantalla existente ya con los colores nuevos (light+dark).

### FASE 2 — Tipografía (Inter)
- Sustituye Geist por **Inter** en `layout.tsx` (`next/font/google`, pesos 400/500/600/700), mantén `--font-mono` para números. Ajusta `--font-sans`.
- 🛑 **Checkpoint 2.**

### FASE 3 — Shell / navegación
- Construye el shell **según el IA Blueprint (Fase IA)** — la nueva navegación, no la del `AppShell` actual. Aplica el patrón A: sidebar ~260px lavanda sin borde, **workspace/tenant switcher** arriba, nav agrupada (headers `xs` uppercase muted), **ítem activo = pill blanca con `shadow-xs`** e ícono en `--brand`, hover lavanda; **bloque inferior** con plan/cuenta; sidebar colapsable + settings anidado. Conserva el gating RBAC (la capacidad decide qué se muestra) y el ⌘K.
- Deriva variantes por superficie: **`admin`** (consola densa), **`(tenant)`** (denso), **`portal`** (simple/espaciado), **`conductor`** (nav inferior táctil).
- 🛑 **Checkpoint 3.**

### FASE 4 — Primitivas (componentes UI)
- Reestiliza al acabado Retell: **Button** (primary neutro oscuro/radius 10px, secondary outline, ghost, destructive, estado loading in-situ, caret opcional), **Input/Select/Textarea** (borde suave, foco `--ring` azul, label arriba, error inline), **Badge** (estado semántico con punto de color + subtle bg), **Card** (borde 1px `--border`, radius 8px, sombra `xs`), **Table** (densidades, sin líneas verticales, header muted, mono tabular, ⋮ por fila), **Tabs**, **Dialog/Sheet** (confirmación de dinero), **Tooltip**, **Skeleton**, **Sonner**.
- 🛑 **Checkpoint 4:** una página "kitchen sink" que muestre todas las primitivas en sus estados (default/hover/focus/disabled/loading/error), light+dark.

### FASE 5 — Patrones de dominio compuestos
- **DataTable** (toolbar Date Range/Filter, orden, selección masiva, paginación con total, scroll-x, estados vacío/carga/error), **EmptyState**, **KPI card**, **Chart** (line/donut con paleta chart), **Badge de estado** (sobre `traduccion-estados.ts`), **Monto CLP** (mono tabular, negativo rojo), **Confirmación de dinero**, **Skeleton de tabla**.
- 🛑 **Checkpoint 5.**

### FASE 6 — Construir las pantallas (frescas, según el IA Blueprint)
> **No es "migrar" el diseño viejo.** Cada pantalla se **construye nueva** con la composición decidida en la Fase IA (puede reubicar, fusionar, dividir respecto a hoy). Solo la **capacidad y la lógica** se conservan.
- **6a. `(tenant)`** — construye por *job*: tablas de Operación y Dinero → Configuración/Sellers/Equipo → Dashboard → **Mi plan**. Aplica los patrones asignados (tabla densa, form modal/wizard, settings-rows, confirmación de dinero…).
- **6b. `admin`** — consola de plataforma (couriers, suscripciones, planes, métricas, salud, bitácora): patrones de listado/tabla/detalle/settings.
- **6c. `portal`** — seller, densidad relajada, tablas→cards en móvil.
- **6d. `conductor`** — táctil, listas de cards, nav inferior.
- **6e. público** — auth, tracking `/tracking/[token]`, offline.
- 🛑 **Checkpoint por superficie.**

### FASE 7 — QA visual y cierre
- Barrido: dark mode íntegro, contraste AA, responsive (sm→2xl), `prefers-reduced-motion`, foco de teclado, estados de las 4 clases en cada vista de datos.
- Actualiza `DESIGN_SYSTEM.md` al nuevo ADN. `typecheck`/`lint`/`build` verdes.
- 🛑 **Checkpoint final:** resumen de cambios + capturas antes/después.

---

## 6. SKILLS DE APOYO — orquestación (`web-artifacts-builder` + `canvas-design`)

> Usa estas dos skills de Anthropic como **apoyo bajo tu dirección**. TÚ escribes el brief exacto (con los valores del ADN); la skill ejecuta con acabado profesional; el resultado se **revisa y se traduce al repo**. **Las skills nunca inventan tokens ni patrones** — consumen `design-system.md`, `catalogo-visual.md` y el IA Blueprint. Son herramientas de **prototipado y documentación**, no reemplazan la implementación en el repo (que lleva la lógica real: Supabase, RBAC, jobs, dinero).

### 6.1 `web-artifacts-builder` (React + Tailwind + shadcn/ui) — caballo de batalla
Mismo stack que Rutax → sus prototipos se traducen casi 1:1 al repo. Úsala para:
- **Fase IA:** prototipos **interactivos** de la nueva navegación + pantallas clave por superficie (mockup clickeable para aprobar antes de construir).
- **Fase 4:** el **"kitchen sink"** (todas las primitivas en sus estados, light/dark) como galería viva.
- **Fase 5–6:** prototipo de alta fidelidad de **cada pantalla rediseñada** antes de implementarla.
- Flujo: *brief → artifact aprobado (design source) → implementación en el repo siguiendo el artifact*.

### 6.2 `canvas-design` (PNG/PDF, diseño original) — documentación y visión
Entregables **estáticos**, no código. Úsala para:
- **Style guide / hoja de tokens** (paleta, tipografía, sombras, radios) en PNG/PDF.
- **Mapa de Arquitectura de Información** (sitemap visual) por superficie (Fase IA).
- **Boards de wireframes** low-fi o de visión.
> Crea **diseño original** (nuestra adaptación Rutax), nunca copia de Retell — coherente con "inspirar, no calcar".

### 6.3 Plantilla de brief (obligatoria en cada handoff)
Todo encargo a una skill debe incluir: (1) **objetivo y formato** + persona/superficie y densidad; (2) **patrón exacto** de `catalogo-visual.md`; (3) **tokens exactos** de `design-system.md §2.4`, light **y** dark; (4) **contenido/datos reales** del `rutax-inventario-funcional.md` (campos, columnas, acciones); (5) **estados** (default/hover/focus/disabled/loading/empty/error) + **RBAC**; (6) **reglas duras** (Inter, primary neutro oscuro, azul acento, AA, `prefers-reduced-motion`, español CL, CLP mono-tabular); (7) **definición de "listo"** (revisión visual light+dark + responsive).

### 6.4 Guardrails
- La skill **prototipa/documenta**; tú revisas contra el ADN y **apruebas** antes de llevarlo al repo.
- Si el output se desvía del ADN (color/tipografía/patrón), **corrige el brief y repite** — no aceptes deriva.
- La **lógica de dominio** (RLS, RBAC, dinero, jobs) **jamás** vive en un artifact/PNG; solo el diseño.

---

## 7. FORMATO DE TRABAJO
- Trabaja una fase por vez; no adelantes. En cada checkpoint: qué hiciste, archivos tocados, cómo verificarlo, y qué sigue.
- Si algo del ADN choca con una regla de negocio de Rutax (p. ej. accesibilidad de un color de estado), **gana Rutax** y lo señalas.
- Ante cualquier ambigüedad de producto o necesidad de tocar lógica: **pregunta antes de actuar**.

**Empieza por la FASE 0.**
