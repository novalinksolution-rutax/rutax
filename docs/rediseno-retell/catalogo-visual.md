# Retell Dashboard — Catálogo visual (screen & component reference)

> Complementa `design-system.md` (tokens + core). Aquí: cada **pantalla, estado interactivo y componente** capturado en vivo del dashboard real (sesión logueada), con detalle suficiente para replicarlo. Las **imágenes viven en la conversación de Claude** que generó este archivo (revisar/guardar desde el chat); este texto es la especificación.
> Capturado: 2026‑07‑21/22.

---

## 1. Estados del shell / navegación

### 1.1 Sidebar expandido (260px)
Fondo lavanda `#f5f5fa`, sin borde derecho. De arriba a abajo:
- **Logo** Retell + botón **colapsar** (⊟) a la derecha.
- **Workspace switcher**: avatar cuadrado con gradiente azul→morado + label "Workspace" (xs, muted) + nombre + chevron.
- **Nav agrupada**: headers de grupo en `xs`, MAYÚSCULAS, `muted-foreground` (Home · BUILD · DEPLOY · DATA · MONITOR · SYSTEM). Ítems: ícono Lucide 16px + label `sm`. **Activo = pill blanca** (`shadow-xs`), ícono en azul; hover = lavanda ~5%.
- **Bloque inferior**: plan ("Free trial", con chevron para expandir) + **cuenta** (avatar + email + chevron).
- **Footer**: Help · Updates.

### 1.2 Sidebar colapsado (rail ~48px)
Solo íconos, centrados; sin labels ni headers de grupo. Orden idéntico. Logo colapsado arriba, avatar workspace, íconos de nav, y abajo plan + avatar cuenta. El contenido principal se ensancha. Toggle para expandir en el mismo punto (arriba).

### 1.3 Sidebar contextual anidado (Settings)
Al entrar a Settings el sidebar se **reemplaza**: "‹ GO BACK" arriba + sub‑ítems (Limits · Reliability · API Keys · Webhooks · Workspace). Mismo estilo de ítem activo.

### 1.4 Workspace switcher (abierto)
Popover: **buscador** ("Search…") arriba + lista de workspaces (avatar + nombre, **✓** en el activo) + separador + **"＋ Add another workspace"**. → en Rutax = selector de courier/tenant.

### 1.5 Menú de cuenta (abierto) + submenú de tema
Popover sobre el disparador: avatar + nombre + email → **"Light"** (ícono sol, con chevron →) → **submenú flyout de tema**: **Light** (sol, ✓) · **Dark** (luna) · **System** (monitor) → **Logout** (ícono, al pie). Mapea 1:1 a `next-themes`.

### 1.6 Panel de plan expandido
Card: "Free trial" + **Remaining: $7.42** + **Concurrency Used: 0/20** + botón oscuro **"Add Payment"**.

---

## 2. Plantillas de pantalla

### 2.1 Listado con folders (Agents)
Columna intermedia (All Agents + sección FOLDERS con "+" y carpetas) · header: título + **Search** + **Import** (outline) + **Create an Agent** (primary oscuro con **caret** → dropdown "Voice Agent / Chat Agent") · **tabla**: celda ancla con avatar/ícono, **badge** de tipo ("Single Prompt", "Conversation Flow"), voz (avatar+nombre), metadata muted (fecha·hora), **⋮** por fila · paginación centrada.

### 2.2 Tabla densa con toolbar (Call History / Chat History)
Toolbar: **Date Range** (calendario) · **Filter** (embudo) · iconos (columnas/gráfico) · **Actions** (primary oscuro). Tabla ancha con **scroll‑x propio**; encabezados muted; **puntos de color de estado** (`• agent hangup`, `• ended`, `• Neutral`, `• Successful` verde / `• Unsuccessful` rojo); IDs en mono; costos. **Hover de fila** revela acciones inline (copiar/ver). Footer: "Page 1 of 1 · Total Session: N" + paginación + **selector de tamaño** ("50 / page").

### 2.3 Dashboard analítico (Analytics)
Tabs (Call/Chat Dashboard + "＋") · toolbar (Date Range · Filter · Breakdown · **Add Chart** · …) · **KPI cards** (número grande centrado en panel inset: `19`, `56s`, `1904ms`) · **line charts** (grid punteado, línea/puntos azul, ejes muted, leyenda con cuadrito) · **donut/gauge** (semicírculos azul/cyan: Call Successful, Disconnection Reason, Sentiment). Grid de cards.

### 2.4 Billing / plan
Header: título + **Change payment methods** (outline) + **Manage billing info** (primary) + … · **card de balance** (label + monto grande `$7.42` + **Buy credits** / **Auto recharge** con ícono) · tabs (Billing History / Usage) · tabla (Title/Amount/Details/Status) con **skeleton** al cargar.

### 2.5 Settings — setting rows
Header: título + acción secundaria (outline) arriba‑derecha. Cada ajuste = **card con borde**: label (medium) + **valor grande** (`20`, `32768`) + descripción muted + **control a la derecha** (botón outline "Adjust Limit"/"Adjust Concurrency" o **toggle switch**). Ej.: Limits (Concurrent Calls, Concurrency Burst con toggle ON azul, LLM Token Limit, Telnyx/Twilio CPS).

### 2.6 Config con card de progreso + KPIs (AI Quality Assurance)
Intro (título + párrafo muted + **chip info** "First 100 minutes free" + "Read the Docs") · tabs (Overview/Detailed) · Date Range · Configure · … · **card de progreso** ("Calls Analysed / Completed: 68 · Total: 240" + **barra de progreso verde**) · **KPI cards con area chart** (spline morado con relleno degradado: Average Score 87.00, Resolution 75.00%, gridlines, leyenda "Avg").

### 2.7 Página de conectores (Integrations)
Tabs (Connected / Available). Connected vacío → estado vacío ("Connect with apps" + ícono + **Add Integration**). Available → **grid de cards** (logo + nombre + descripción + **Connect** outline): Hubspot, Salesforce.

### 2.8 Lista de reglas/config (Alerting)
Intro (título + párrafo + **Create Alert** primary + "Read the Docs") · tabs (Alerting / Alert history) · **filas de regla**: ícono cuadrado de color + título (bold) + condición muted ("Number of Calls · Concurrency Exhausted") + **Edit** (outline con lápiz) + **⋮**.

### 2.9 Home / asistente (Conductor)
Sidebar + **panel de historial** ("Conductor History": Search chats + New chat) + área central: saludo ("Good evening, Jorge") + **input de chat** grande (placeholder, adjuntar "+", badge de créditos "30", enviar). *(No aplica directo a Rutax — su home = dashboard.)*

### 2.10 Estados vacíos (patrón)
Centrado: **ícono en cuadro redondeado sutil** + frase corta. Variantes: "You don't have any knowledge base / phone numbers / batch call", "No Ongoing Calls" (ícono audífono), Contacts (tabla vacía con headers + **banner** superior), Integrations ("Connect with apps"). Distinguir **vacío real** vs **filtrado sin resultados**.

### 2.11 Detalle / editor de recurso (Agent)
*(No capturado a fondo — es el editor de agente de voz con React Flow, específico de Retell y no aplicable a Rutax. Layout general: panel de config izquierda + preview/test derecha.)*

---

## 3. Componentes / acabados

| Componente | Detalle capturado |
|---|---|
| **Botón primary** | Neutro casi‑negro `#2f3a4b`, texto blanco, radius 10px, `sm` alto ~36px. Con **caret** cuando abre dropdown. |
| **Botón outline** | Borde `--border`, fondo blanco/transparente, texto oscuro (Import, Adjust Limit, Read the Docs). |
| **Botón ghost / icon** | Solo ícono o texto, sin fondo (⋮, iconos de toolbar). |
| **Badge de tipo** | Chip gris redondeado con texto (`Single Prompt`, `Webhook`). |
| **Badge "New"** | Chip azul en banners. |
| **Punto de estado** | `•` de color (verde éxito, rojo error, azul info) **antes** del texto — señal + texto siempre juntos. |
| **Dropdown menu (⋮)** | Card `shadow-dropdown`, radius 8px; ítems ícono+label; **destructivo (Delete) en rojo** al final. |
| **Dropdown de acción** | "Create an Agent" → Voice Agent / Chat Agent (íconos). |
| **Form modal** | Dialog centrado (radius ~12px, overlay dim), header título + **X**; secciones con label bold; inputs, **selects** (chevron), **segmented control** (tabs "Compare to certain value"), filas dinámicas "＋ Add", inputs con botón "Test"; footer **Cancel (ghost) + Save (primary)** derecha. |
| **Date range picker** | Popover: "Between" dropdown + **presets** (Today, Last 7 days, Last 4 weeks, Last 3 months, Week/Month/Year to date, All time) + **calendario doble mes** (hoy resaltado, fuera‑de‑mes muted) + inputs de hora + Cancel/Apply. |
| **Toggle / switch** | Riel `full`, círculo blanco; **ON = azul `--brand`**, OFF = gris. |
| **Tabs** | Subrayado del activo (indicador), inactivos muted (Billing History/Usage, Connected/Available, Overview/Detailed). |
| **KPI card** | Número grande centrado en panel inset sutil, label arriba‑izq. |
| **Progress card** | Título + "Completed: X · Total: Y" + **barra de progreso** (verde). |
| **Charts** | **Line** (grid punteado, línea+puntos azul), **donut/gauge** (semicírculo azul/cyan), **area/spline** (relleno degradado morado). Leyenda con cuadrito de color. Paleta = `--chart-*`. |
| **Card de conector** | Logo + nombre + descripción + Connect. |
| **Banner informativo** | Fondo azul sutil, **badge "New"** + texto + acción a la derecha ("Connect"). |
| **Skeleton** | Barras redondeadas con pulso, mismas columnas/alto que la data real. |
| **Loader de marca** | Círculo de 8 puntos con opacidad decreciente (evoca el logo). |
| **Selector tamaño de página** | "50 / page" con chevron, abajo‑derecha de tablas. |
| **Enmascarado de secreto** | Valor = `••••••••` en tabla; revelar/copiar vía ⋮. Badge de tipo ("Webhook"). |
| **Input de búsqueda** | Lupa + placeholder; global (Search…) y por sección (Search phone numbers). |
| **Search / ⌘K** | Disparador de comando (no desplegado aquí; existe en Rutax como PaletaComando). |

---

## 4. Dark mode (validado en vivo)
Fondo near‑black (`#0f1218`/`#161718`), sidebar `#16191f`, cards `#24272e`, texto `#f7f8fa`, borders blancos a baja opacidad. Charts azul/cyan sobre oscuro. Hover de fila = un punto más claro; acciones inline aparecen al hover. Confirma el bloque `.dark` de `design-system.md §2.4` / `MASTER_PROMPT §2.4`.

---

## 5. Índice de capturas de esta sesión
Home · Agents (+ ⋮ menu, + Create dropdown, + sidebar colapsado) · Knowledge Base (vacío) · Phone Numbers (vacío) · Batch Call (vacío) · Call History (datos, dark, Date Range picker, Filter popover, Actions dropdown, Column chooser) · Chat History (vacío) · Contacts (vacío + banner) · Analytics (light + dark) · Live Monitoring (vacío) · AI Quality Assurance (progreso + area charts) · Alerting (lista + Create Alert modal) · Integrations (vacío + Available cards) · Billing (+ skeleton) · Settings/Limits (setting rows + toggle) · Settings/API Keys (secretos) · Settings/Reliability · Settings/Webhooks · Settings/Workspace (General/Users/Roles) · Agent editor (3 paneles + accordion + dark) · Account menu + theme submenu · Workspace switcher · Plan panel · Toast · Loader.

---

## 6. Componentes / pantallas adicionales (2ª ronda)

### Pantallas
- **Settings › Reliability:** ajuste único (Opt in Stable Server, con ⓘ y $) + descripción + **toggle** (OFF).
- **Settings › Webhooks:** descripción con **enlace inline** + input URL + "Timeout: 5s" editable + **Test** (disabled hasta URL válida).
- **Settings › Workspace › General:** **tercer nivel de nav** (General/Users/Roles) + Workspace Name (input) + Workspace ID (read-only mono) + **Save**.
- **Settings › Workspace › Users:** tabla Email (+ badge "You") · Role (**badge de rol** "Admin" + ⓘ) · ⋮ + "Invite a member". → **Equipo** de Rutax.
- **Settings › Workspace › Roles:** tabla Role Name · Description · Role Type ("System"); Admin/Developer/Member + "Add Role". → **roles/capacidades** de Rutax.
- **Editor de recurso (Agent):** **layout de 3 paneles** — top bar (back + nombre + badge "Environment" + segmented "Create/Simulation" + … + share + **V1** version + Conductor + **Publish** primary) · **izq** = editor (selector modelo/voz/idioma + **textarea** de prompt + Welcome Message) · **medio** = **accordion** de config (Functions, Knowledge Base, Speech Settings, Call Settings, Webhook, MCPs…) · **der** = **preview/test** (Test Audio/LLM + Run Test). Validado también en **dark**.

### Componentes nuevos
- **Toast (sonner):** card abajo-derecha, título bold + subtítulo muted, sombra sutil. El botón que lo dispara pasa a loading→disabled.
- **Filter popover:** **tabs de categoría** (Base · Post Call Analysis · Metadata · Dynamic Variables) + lista de campos con **⊕** para añadir condición.
- **Actions dropdown:** ítems con ícono (Export · Export records · Backfill · Custom attributes).
- **Column chooser:** popover con **checkbox por columna** + Load more + Cancel/Save.
- **Slider:** riel + thumb + **valor numérico** a la derecha (0.65 / 0.8).
- **Checkbox:** cuadrado con check azul.
- **Chip editable:** valor + iconos editar/eliminar + "＋ Add".
- **Accordion:** secciones colapsables (ícono + chevron); contenido = label + descripción muted + control.
- **Segmented control:** pill activo con fondo ("Create/Simulation", "Test Audio/LLM", "Compare to certain value/last cycle").
- **Badge de versión + Publish** en top bar de editor.

## 7. Wishlist de video ([🎥] — animaciones que una captura no transmite)
Grabar clip corto (o replicar con los tokens de movimiento de Rutax `--motion-*`/`--ease-*`, que coinciden con la sobriedad de Retell):
- Apertura/cierre de **dropdowns/popovers** (escala 0.98→1 + fade desde el ancla).
- **Modal**: overlay fade + contenido escala 0.96→1; cierre acelerado.
- **Toast**: entrada deslizada + auto-dismiss.
- **Sidebar** colapsar↔expandir (ancho animado + fade de labels).
- **Submenú de tema** flyout + **transición light↔dark** de toda la UI.
- **Skeleton** pulso + **loader de marca** giro.
- **Charts**: entrada/dibujo de líneas y donas.
- **Hover de fila** (aparición de acciones inline).
- **Slider/toggle**: transición del thumb.
- **Tabs/segmented**: deslizamiento del indicador.
- **Accordion**: expandir/colapsar (altura + fade).

> ⚠️ Estas herramientas **no graban video**. Si quieres los clips, grábalos tú (uno corto por interacción) y los anexamos; o —recomendado— replicamos las animaciones con el sistema de movimiento ya definido en `globals.css` de Rutax, que es suficiente y coherente con el acabado de Retell.
