# Retell AI — Dashboard Design DNA

> Extraído en vivo del DOM de `https://dashboard.retellai.com/home` (sesión logueada), 2026-07-21.
> Fuente de verdad: CSS computado + variables de tema (`:root` = light con 1029 tokens, `.dark` con 592 tokens).

---

## 1. Stack tecnológico (confirmado)

| Capa | Tecnología | Evidencia |
|---|---|---|
| Framework | **Next.js + React** | `#__next`, `__NEXT_DATA__`, fuentes self-hosted vía `next/font` |
| CSS | **Tailwind CSS v3** | cientos de utilidades + variables `--tw-*` |
| Componentes base | **shadcn/ui** | tokens core en formato HSL: `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--chart-1..5`, `--radius` |
| Sistema de diseño | **AlignUI** | arquitectura de tokens `--base-*`, `--bg-*`, `--text-*`, `--icon-*`, `--stroke-*`, `--state-*`, `--comp-*` |
| Canvas flujo agentes | **React Flow (xyflow)** | tokens `--node-*`, `--node-and-tag-*`, handles/nodos (el constructor visual de agentes) |
| Alerts/modales | **SweetAlert2** | tokens `--swal2-*` |
| API playground/docs | **Fern** (probable) | tokens `--fr-colors-*`, `--fr-space-*`, `--fr-fontSizes-*` |
| Animación | **Framer Motion** (probable) | típico de este stack; sin confirmar por atributos |
| Tipografía | **Inter** (self-hosted) | `Inter, system-ui, sans-serif`, pesos 400/500/600/700 |

**Nota de licencias:** el APP usa **Inter (libre)**. Solo el sitio de marketing usa Untitled Sans/Denton (de pago). Para clonar el dashboard → usar Inter directamente.

---

## 2. Tipografía

- **Familia:** `Inter, system-ui, sans-serif`. Pesos cargados: **400, 500, 600, 700**.
- **Body:** 16px / line-height 24px / color `#0a0a0a`.
- **H2 real:** 20px / line-height 28px / weight **500** / color `#172131`.
- **Escala de tamaños** (de tokens `--fr-fontSizes` / `--text-*`):
  `xs 12 · sm 14 · md 16 · lg 18 · xl 20 · 2xl 24 · 3xl 30 · 4xl 36 · 5xl 48` px
- **Line-heights:** `xs 18 · sm 22 · md 24 · lg 26 · xl 30 · 2xl 38 · 3xl 46 · 4xl 60` px
- **Pesos semánticos:** regular 400 (texto), medium 500 (títulos/labels), demibold 600 (énfasis), bold 700 (fuerte).
- Letter-spacing: normal (headings), `0.02em` en un token de label.

---

## 3. Radios (border-radius)

`--radius-xs 4 · sm 6 · md 8 (default) · lg 10 · xl 12 · xxl 16 · full 9999` px
- **Botones** renderizan a **10px**. Cards/inputs a 8px. Pills/avatars full.

---

## 4. Sombras (elevación)

| Token | Valor |
|---|---|
| `--shadow-xs` | `0 1px 2px rgba(0,0,0,.05)` |
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,.1), 0 0 2px rgba(0,0,0,.1)` |
| `--shadow-md` / popover | `0 4px 6px rgba(0,0,0,.1), 0 2px 4px rgba(0,0,0,.1)` |
| `--shadow-lg` / dialog | `0 10px 15px rgba(0,0,0,.1), 0 4px 6px rgba(0,0,0,.1)` |
| `--shadow-dropdown` | `0 4px 8px rgba(31,35,41,.06), 0 6px 12px rgba(31,35,41,.04), 0 8px 24px rgba(31,35,41,.04)` |
| `--shadow-s1..s5` | capas muy sutiles con `neutral-alpha` (2–6%) — para cards flotantes |

Filosofía: sombras **muy suaves**, neutras, de baja opacidad. Nada dramático.

---

## 5. Layout / estructura del shell

- **Sidebar:** ancho **260px**, fondo `#f5f5fa` (lavender-gray-100), **sin borde derecho** (contraste por color), padding-right 16px.
- **Item de nav seleccionado:** pill **blanco** (`--fill-nav-selected: #fff`) sobre el fondo lavanda; hover = `rgba(57,70,91,0.05)`.
- **Contenido principal:** fondo **blanco** (`#fff`).
- **Panel secundario** (ej. "Conductor History"): columna lista entre sidebar y contenido.
- **Borde sidebar:** `#e5e5f2`.
- Estructura de secciones del sidebar (orden real):
  `Workspace switcher` → **Home** → **BUILD** (Agents, Knowledge Base) → **DEPLOY** (Phone Numbers, Batch Call) → **DATA** (Call History, Chat History, Contacts) → **MONITOR** (Analytics, Live Monitoring, AI Quality Assurance, Alerting) → **SYSTEM** (plan/Free trial, cuenta) → footer (Help · Updates).

---

## 6. Tokens core shadcn (HSL → hex aprox)

### Light (`:root`)
| Token | HSL | ≈ hex |
|---|---|---|
| background | `0 0% 100%` | `#ffffff` |
| foreground | `0 0% 3.9%` | `#0a0a0a` |
| primary | `0 0% 9%` | `#171717` (acción = casi negro) |
| primary-foreground | `0 0% 98%` | `#fafafa` |
| secondary / muted / accent | `0 0% 96.1%` | `#f5f5f5` |
| muted-foreground | `0 0% 45.1%` | `#737373` |
| border / input | `0 0% 89.8%` | `#e5e5e5` |
| ring | `0 0% 3.9%` | `#0a0a0a` |
| destructive | `0 72.2% 50.6%` | `#e5484d` |
| radius | — | `8px` |

### Dark (`.dark`)
| Token | HSL | ≈ hex |
|---|---|---|
| background | `0 0% 3.9%` | `#0a0a0a` |
| foreground | `0 0% 98%` | `#fafafa` |
| primary | `0 0% 98%` | casi blanco (se invierte) |
| card | `236 18.1% 16.3%` | `#23252f` |
| muted | `0 0% 14.9%` | `#262626` |
| muted-foreground | `0 0% 63.9%` | `#a3a3a3` |
| border | `0 0% 81.2% / .15` | blanco al 15% |

> **Importante:** el APP renderiza superficies usando sobre todo la **capa AlignUI** (sección 7), no solo shadcn crudo. Ej.: el fondo del shell es `#f5f5fa`, no blanco puro; los botones usan `--comp-primary-*`.

---

## 7. Tokens semánticos AlignUI (los que de verdad pintan la UI)

### Superficies (light)
- `--bg-base` (shell): `#f5f5fa`
- `--bg-body` / `--bg-float` / `--bg-card`: `#ffffff`
- `--bg-mask` (overlay): `rgba(0,0,0,.40)`

### Texto (light)
- `--text-primary`: `#172131` (neutral-900)
- `--text-secondary`: `#606a78` (neutral-650)
- `--text-placeholder`: `#8793a3` (neutral-500)
- `--text-disabled`: `#c3ccd9`

### Bordes (light)
- `--border-default`: `#d5d5e8` (lavender-gray-400)
- `--border-divider`: `rgba(57,70,91,.15)`
- `--border-hover`: `#bdbdd6`

### Botones / componentes (light)
- `--comp-primary-default`: `#2f3a4b` (neutral-800) · hover `#606a78` · pressed `#737f91`
- `--comp-outline-default`: `#ffffff` · hover `#f5f5fa` · pressed `#f0f0f8`
- `--comp-secondary-default`: `#f5f5fa` · hover `#f0f0f8`
- `--comp-danger-default`: `#f54a45`
- Alturas de botón: `sm 24 · md 32 · lg 40` px.

### Estados / status (consistentes)
| Rol | Base | Lighter (fondo) |
|---|---|---|
| success | `#1fc16b` | `#e0faec` |
| warning | `#ff8447` | `#fff3eb` |
| error / destructive | `#fb3748` | `#ffebec` |
| information | `#335cff` | `#ebf1ff` |
| feature (púrpura) | `#7d52f4` | `#efebff` |
| highlighted (rosa) | `#fb4ba3` | `#ffebf4` |
| verified (celeste) | `#47c2ff` | `#ebf8ff` |
| stable (turquesa) | `#22d3bb` | `#e4fbf8` |
| away (amarillo) | `#f6b51e` | `#fff4d6` |

### Acentos de marca
- Azul primario de marca: `--base-blue-500 #3370ff`, `--information-base/--primary-base #335cff`.
- `--copilot-accent: #4752e6` (el asistente "Conductor").
- Curiosidad: definen `--claude: #cc9b7a` (integran modelos Claude).

---

## 8. Paleta base (AlignUI) — escalas 50→900

El neutro del sistema son DOS familias: **`neutral`** (gris azulado frío) y **`lavender-gray`** (gris lavanda, para fondos/sidebar).

**Neutral (light):** 0 `#fff` · 50 `#f6f8fb` · 100 `#f0f3f7` · 200 `#e6ebf2` · 300 `#d5dce7` · 400 `#a9b4c4` · 500 `#8793a3` · 600 `#737f91` · 650 `#606a78` · 700 `#4c5869` · 800 `#2f3a4b` · 900 `#172131` · 950 `#0a101a`

**Lavender-gray (light):** 25 `#fff` · 50 `#fcfcfe` · 100 `#f5f5fa` · 200 `#f0f0f8` · 300 `#e6e6f3` · 400 `#d5d5e8` · 500 `#bdbdd6` · 600 `#9c9eb8` · 700 `#757790` · 800 `#4e5063` · 900 `#343647` · 950 `#222331`

**Hues @500 (light):** blue `#3370ff` · indigo `#4954e6` · purple `#7f3bf5` · violet `#d136d1` · carmine `#f01d94` · red `#f54a45` · orange `#ff8800` · yellow `#ffc60a` · lime `#b3d600` · green `#34c724` · turquoise `#00d6b9` · wathet `#14c0ff`

> Cada hue tiene escala completa 50→900 (light) e invertida en dark. Regenerable en vivo desde el tab si se necesita el volcado exacto (1029/592 tokens).

**Chart colors:** `chart-color-1..12` → base-{blue, wathet, purple, yellow, red, orange, carmine, turquoise, violet, lime, indigo, green}-300.

---

## 9. Módulos del SaaS (arquitectura de información)

| Sección | Módulos | Propósito UI |
|---|---|---|
| — | **Home / Conductor** | Asistente IA (chat) con historial lateral, input con adjuntos + créditos |
| BUILD | **Agents**, **Knowledge Base** | Constructor visual (React Flow) + gestión de recursos |
| DEPLOY | **Phone Numbers**, **Batch Call** | Aprovisionamiento / acciones masivas |
| DATA | **Call History**, **Chat History**, **Contacts** | Listados con filtros + detalle |
| MONITOR | **Analytics**, **Live Monitoring**, **AI Quality Assurance**, **Alerting** | Dashboards, tablas, gráficos, reglas |
| SYSTEM | **Free trial / plan**, **cuenta**, Help, Updates | Billing/upgrade + settings + soporte |

---

## 10. Catálogo de patrones de pantalla (capturado en vivo)

Cada patrón se describe como plantilla reutilizable para mapear a Rutax (§ mapeo en el prompt maestro).

### A. Shell / navegación (todas las pantallas)
- **Sidebar 260px**, fondo `#f5f5fa`, sin borde derecho. Arriba: logo → **Workspace switcher** (avatar cuadrado con gradiente + nombre + chevron). Nav agrupada con encabezados en `xs`, mayúsculas, `muted-foreground` (BUILD/DEPLOY/DATA/MONITOR/SYSTEM). Ítem activo = **pill blanca** con ícono coloreado; hover = lavanda 5%. Íconos Lucide 16px a la izquierda.
- Abajo del sidebar: selector de **plan** ("Free trial" con ícono) + **cuenta** (avatar + email + chevron). Footer: Help · Updates.
- **Contenido**: fondo blanco, sin topbar con borde; el header de cada vista vive dentro del contenido.

### B. Listado con folders (Agents)
- Columna intermedia opcional: filtro/folders ("All Agents" + sección FOLDERS con "+").
- Header de vista: **título** + `Search` (input con lupa) + acción secundaria (`Import`, outline) + **acción primaria** (`Create an Agent`, botón oscuro con caret de dropdown).
- **Tabla**: columnas con avatar/ícono en la celda ancla, **badges** de tipo, celda con avatar+texto (voz), metadata en `muted` (fecha · hora), menú **⋮** por fila al hover. Paginación centrada abajo (‹ 1 ›).

### C. Tabla densa con toolbar (Call History)
- Toolbar: `Date Range` (ícono calendario) · `Filter` (embudo) · a la derecha iconos (columnas/exportar) + `Actions` (primary oscuro).
- **Tabla ancha con scroll horizontal propio**; encabezados `muted`. Celdas: **puntos de color de estado** (`• agent hangup`, `• ended`, `• Neutral`), IDs en `mono`, montos. Footer: "Page 1 of 1 · Total Session: 19" + paginación.

### D. Dashboard analítico (Analytics)
- **Tabs** de dashboard (Call/Chat) + `+`. Toolbar: `Date Range` · `Filter` · `Breakdown` · `Add Chart` · `…`.
- **KPI cards**: número grande centrado (`19`, `56s`, `1904ms`) sobre panel inset sutil, con label arriba a la izquierda.
- **Line charts**: grid punteado, línea/puntos azul, ejes `muted`, leyenda abajo-izq con cuadrito de color.
- **Donut/gauge charts**: semicírculos azul/cyan (Call Successful, Disconnection Reason, Sentiment). Grid de cards.

### E. Billing / suscripción (Billing)
- Header: título + `Change payment methods` (outline) + `Manage billing info` (primary oscuro) + `…`.
- **Card de balance**: label + monto grande (`$7.42`) + acciones a la derecha (`Buy credits`, `Auto recharge`, con ícono).
- Tabs (`Billing History` / `Usage`) + tabla (Title/Amount/Details/Status).

### F. Estado de carga (capturado en Billing)
- **Skeleton rows**: barras grises redondeadas con pulso, mismo alto y columnas que la tabla real (no spinner suelto). ← coincide con el principio 7 de Rutax.
- **Loader de marca** (navegación de página pesada): círculo de 8 puntos con opacidad decreciente (evoca el logo de Retell), centrado sobre fondo neutro.

### G. Menús / dropdowns (menú ⋮ de fila)
- Card blanca, `radius 8px`, `shadow-dropdown`, aparece anclada al disparador. Ítems: **ícono Lucide (16px) + label**, padding ~8px 12px, hover con fondo sutil. La acción destructiva (**Delete**) va en **rojo**, con su ícono, típicamente al final y separada. Mismo patrón para menús de contexto, "Actions" y switchers.

### H. Settings (patrón de configuración)
- **Sidebar contextual anidado:** al entrar a Settings el sidebar principal se reemplaza por sub-navegación con **"‹ GO BACK"** arriba + ítems (Limits · Reliability · API Keys · Webhooks · Workspace). El estado activo usa el mismo pill/acento.
- **Filas de ajuste (setting rows):** cada opción es una card con borde 1px: `label` (peso medio) + **valor grande** (`20`, `32768`) + descripción `muted` + **control a la derecha** — botón outline (`Adjust Limit`, `Adjust Concurrency`) o **toggle switch** (azul `--brand` cuando ON, gris cuando OFF). Header de la vista: título + acción secundaria arriba-derecha.

### I. Toggle / Switch
- Riel redondeado (`full`), círculo blanco; **ON = fondo `--brand` azul**, OFF = gris neutro. Transición corta.

### J. Switchers y menú de cuenta / tema
- **Menú de cuenta** (abajo-izq, sobre el disparador): card con avatar + nombre + email arriba, luego ítems con ícono: **Tema** ("Light", ícono sol, con chevron → **submenú flyout**) y **Logout** (ícono, al pie).
- **Theme switcher (submenú):** 3 opciones con ícono — **Light** (sol), **Dark** (luna), **System** (monitor) — con **checkmark** en la activa. → mapea 1:1 a `next-themes` (`setTheme('light'|'dark'|'system')`).
- **Workspace switcher** (arriba): disparador con avatar cuadrado (gradiente) + label "Workspace" + nombre + chevron; al abrir → **buscador** + lista de workspaces (✓ en el activo) + **"＋ Add another workspace"**. → en Rutax = **selector de courier/tenant**.
- **Colapsar sidebar:** botón ⊟ junto al logo; colapsa a modo íconos (rail estrecho).

### Inventario de componentes/acabados a reproducir
Botones (primary oscuro `#2f3a4b`/radius 10px, outline, ghost, con caret) · inputs con lupa · badges de estado con punto de color · avatares cuadrados con gradiente · tabla (avatar-cell, mono, ⋮) · tabs · KPI card · line/donut charts (paleta chart) · skeleton · workspace/account switchers · paginación · toolbar de filtros.
