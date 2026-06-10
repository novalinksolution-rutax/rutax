# Flujos de Dinero — Fase C

## Documento de UX/UI para `frontend` · Períodos de cobro, DTE, Liquidaciones, Conciliación, Alerta de folios

**Archivo:** `docs/ux/fase-c-dinero.md`
**Fecha:** Junio 2026
**Basado en:** `docs/arquitectura/fase-c-dinero.md`, `docs/ux/fase-b-operacion.md`, `docs/ux/fase-a-onboarding.md`

---

## §0 Estructura de navegación

### Extensión del árbol de rutas existente

Fase C extiende los tres árboles de rutas de Fase B (backoffice, portal seller, PWA conductor).

**Sección DINERO en el backoffice del courier:**

```
OPERACION
  ├── Dashboard           /(tenant)/dashboard      (se extiende con alerta D-5)
  ├── Pedidos             /(tenant)/operaciones
  └── Manifiestos         /(tenant)/manifiestos

DINERO  (nueva sección)
  ├── Períodos de cobro   /(tenant)/dinero/periodos
  ├── Liquidaciones       /(tenant)/dinero/liquidaciones
  └── Conciliación        /(tenant)/dinero/conciliacion     (badge con contador)
```

**Portal del seller — extensión:**

```
/portal/
  ├── pedidos             (Fase B)
  ├── incidencias         (Fase B)
  └── cobros              NUEVO Fase C
```

**PWA del conductor — extensión:**

```
/conductor/
  ├── manifiesto          (Fase B)
  └── liquidaciones       NUEVO Fase C
```

### Decisiones de estructura

**Conciliación tiene badge en navegación.** Contador de eventos `pendiente`. Aparece solo cuando hay eventos pendientes; desaparece cuando el contador es cero.

**Liquidaciones y períodos son secciones separadas.** Sus audiencias de gestión son distintas: períodos/DTE es una conversación con el seller (facturación); liquidaciones es con el conductor (pago).

**El cierre de período es siempre manual.** Aunque el job C2 cierra automáticamente por cron, el dueño puede cerrar antes a pedido del seller.

---

## §1 Tabla de traducción de enums

Estas tablas se añaden a `src/lib/ui/traduccion-estados.ts`, junto a las de Fase B.

### Estados de período de cobro

| Enum | Texto visible | Color badge |
|---|---|---|
| `abierto` | Abierto | Azul |
| `cerrado` | Cerrado | Gris |
| `facturado` | Facturado — Folio [N] | Verde |
| `anulado` | Anulado | Rojo |

Nota criterio C-7: el badge `facturado` incluye el folio cuando hay DTE emitido.

### Estados SII

| Enum | Texto visible | Color badge | Ícono |
|---|---|---|---|
| `pendiente` | Pendiente SII | Gris | Reloj |
| `aceptado` | Aceptado por SII | Verde | Check |
| `rechazado` | Rechazado por SII | Rojo | X |
| `aceptado_con_discrepancias` | Aceptado con observaciones | Amarillo | Advertencia (triángulo) |

Nota criterio C-5: `aceptado_con_discrepancias` usa badge AMARILLO con ícono de advertencia, nunca verde ni rojo.

### Estados de liquidación

| Enum | Texto visible | Color badge |
|---|---|---|
| `borrador` | Borrador | Gris |
| `emitida` | Emitida | Azul |
| `pagada` | Pagada | Verde |

### Estados de evento de conciliación

| Enum | Texto visible | Color badge |
|---|---|---|
| `pendiente` | Pendiente | Naranja |
| `revisado` | Revisado | Azul |
| `resuelto` | Resuelto | Verde |
| `ignorado` | Ignorado | Gris |

### Tipos de diferencia de conciliación

| Enum | Texto visible en UI |
|---|---|
| `pedido_entregado_sin_linea_cobro` | Pedido entregado sin línea de cobro |
| `pedido_entregado_sin_linea_liquidacion` | Pedido entregado sin línea de liquidación |
| `linea_cobro_sin_pedido_entregado` | Línea de cobro sin pedido entregado |
| `folio_consumido_sin_dte_persistido` | Folio consumido sin DTE registrado |
| `periodo_cerrado_con_lineas_sueltas` | Período cerrado con líneas sin asignar |
| `monto_dte_difiere_de_lineas` | Monto del DTE no coincide con líneas |

---

## §2 Panel del dueño — sección `/(tenant)/dinero/`

### Pantalla D-1 — Dashboard de períodos de cobro

**Ruta:** `/(tenant)/dinero/periodos`
**Roles:** `dueno`, `administracion`

#### Jerarquía de información

**Bloque 0 — Chips de resumen (sin scroll):**

```
[Abiertos: 4]   [Cerrados: 2]   [Facturados: 18]   [Con problemas: 1]
```

"Con problemas" agrupa DTEs con `estado_sii = 'rechazado'` o `'aceptado_con_discrepancias'`. Al hacer clic en un chip aplica ese filtro; clic en el chip activo lo limpia.

**Bloque 1 — Filtros:**
- Seller: selector + "Todos los sellers"
- Estado: selector traducido + "Todos los estados"
- Período: date-picker de mes o rango
- Botón "Limpiar filtros" visible solo cuando hay filtro activo

**Bloque 2 — Tabla de períodos:**

Ordenamiento: `fecha_fin DESC`.

| Columna | Ancho | Notas |
|---|---|---|
| Seller | 20% | Nombre del seller |
| Período | 20% | dd/mm/aaaa – dd/mm/aaaa |
| Estado | 12% | Badge con folio si `facturado` |
| Líneas | 8% | Entero, alineado a derecha |
| Monto total | 15% | CLP `$ 1.234.567`, alineado a derecha |
| Estado SII | 12% | Badge, solo si hay DTE; vacío si no |
| Acciones | 13% | Según estado |

**Acciones por fila según estado:**

| Estado | Acciones |
|---|---|
| `abierto` | "Cerrar período" (botón primario, directo en la fila) |
| `cerrado` | "Ver detalle" |
| `facturado` | "Ver detalle" · "Ver PDF" · "Ver XML" |
| `anulado` | "Ver detalle" |

**Flujo "Cerrar período" desde la lista:**

1. Clic en "Cerrar período" en la fila.
2. `Dialog` de confirmación:
   - "Cerrar período de [nombre del seller]"
   - Fechas del período, total de líneas, monto total en tipografía grande.
   - "Una vez cerrado, este período se facturará automáticamente. Esta acción no se puede deshacer."
   - Botón primario "Confirmar cierre" (color alerta). Botón "Cancelar".
3. Al confirmar: dialog se cierra, fila actualiza en-place. Toast: "Período cerrado — el DTE se emitirá en los próximos minutos."
4. Si hay error: dialog permanece abierto, error inline bajo botones. El botón "Confirmar cierre" se rehabilita.

**Estado vacío:**
- Sin períodos: "Aún no hay períodos de cobro. Se crean automáticamente cuando el motor registra la primera entrega de un seller."
- Sin resultados por filtro: "No hay períodos que coincidan con los filtros aplicados." + "Limpiar filtros".

#### Wireframe conceptual D-1

```
┌─────────────────────────────────────────────────────────────────────┐
│  Períodos de cobro                                                   │
├─────────────────────────────────────────────────────────────────────┤
│  [Abiertos: 4]  [Cerrados: 2]  [Facturados: 18]  [Con problemas: 1]│
├─────────────────────────────────────────────────────────────────────┤
│  Seller [▼ Todos]   Estado [▼ Todos]   Período [📅 —]  [Limpiar]   │
├───────────────┬──────────────────┬───────────┬───────┬─────────────┤
│ Seller        │ Período          │ Estado    │Líneas │ Monto total │
├───────────────┼──────────────────┼───────────┼───────┼─────────────┤
│ TiendaX       │ 01/06 – 07/06   │ •Abierto  │    24 │ $ 1.240.000 │
│               │                  │           │       │ [Cerrar →]  │
├───────────────┼──────────────────┼───────────┼───────┼─────────────┤
│ TiendaX       │ 25/05 – 31/05   │ ✓Fact-33  │    31 │ $ 1.620.000 │
│               │                  │ ✓Aceptado │       │ [PDF][XML]  │
├───────────────┼──────────────────┼───────────┼───────┼─────────────┤
│ Modas Norte   │ 25/05 – 31/05   │ ✓Fact-32  │    15 │ $   720.000 │
│               │                  │ ⚠ Obs.    │       │ [PDF][XML]  │
└───────────────┴──────────────────┴───────────┴───────┴─────────────┘
  Mostrando 3 de 24 períodos    [< Anterior]  1  2  [Siguiente >]
```

---

### Pantalla D-2 — Detalle de período

**Ruta:** `/(tenant)/dinero/periodos/[periodoId]`
**Roles:** `dueno`, `administracion`

#### Jerarquía de información

**Sección A — Encabezado:**
- Seller (nombre, enlace a ficha)
- Fechas: "01/06/2026 – 07/06/2026"
- Badge de estado (con folio si `facturado`)
- Monto total en tipografía grande (dato de mayor valor)
- Botón "Cerrar período" a la derecha, solo si `estado = 'abierto'`

**Sección B — Bloque "Factura emitida" (solo si hay DTE):**

Condicional: aparece solo cuando `documento_dte_id` no es null.

- Folio (número grande), fecha de emisión
- Monto neto / IVA / total (tres cifras en fila, formato CLP)
- Badge `estado_sii` con ícono de advertencia si `aceptado_con_discrepancias`
- Si `rechazado`: texto de `error_descripcion` en tipografía monoespaciada gris, precedido de "Motivo del rechazo:". Sin tokens ni datos técnicos de infraestructura.
- Botones "Ver PDF" y "Ver XML" → Server Action que genera signed URL y redirige. Si falla: toast de error, nunca URL rota.

**Sección C — Tabla de líneas de cobro:**

Encabezado: "Líneas de cobro ([N] líneas)"

| Columna | Notas |
|---|---|
| Pedido | ID interno o referencia ML |
| Fecha entrega | dd/mm/aaaa |
| Tipo | Badge "Flex" / "Same-day" |
| Concepto | Texto del campo `concepto` |
| Monto base | CLP, alineado a derecha |
| Ajuste | CLP con signo. Rojo si negativo, verde si positivo. "—" si cero. |
| Monto final | CLP en negrita, alineado a derecha |
| Origen | Ícono: engranaje = motor automático; lápiz = ajuste manual. Tooltip con texto. |

Fila de totales sticky al pie: "Total: [N] líneas · $ [monto_total_clp]". Paginación de 50 líneas.

**Estado vacío:** "Este período no tiene líneas todavía. Se agregarán automáticamente a medida que se registren entregas."

---

### Pantalla D-3 — Liquidaciones de conductores

**Ruta:** `/(tenant)/dinero/liquidaciones`
**Roles:** `dueno`, `administracion`

#### Jerarquía de información

**Bloque 0 — Chips:**
```
[Borrador: 3]   [Emitidas: 6]   [Pagadas: 41]
```
"Emitidas" destaca porque representa trabajo pendiente de pago.

**Bloque 1 — Filtros:**
- Conductor: selector + "Todos"
- Estado: selector traducido + "Todos"
- Período: date-picker

**Bloque 2 — Tabla:**

Ordenamiento: `emitida` primero, luego `borrador`, luego `pagada`. Dentro de cada grupo: `fecha_fin DESC`.

| Columna | Ancho | Notas |
|---|---|---|
| Conductor | 22% | Nombre completo |
| Período | 18% | dd/mm – dd/mm/aaaa |
| Estado | 10% | Badge traducido |
| Entregas | 8% | Entero, alineado a derecha |
| Monto total | 15% | CLP, alineado a derecha |
| PDF | 8% | "Descargar" si hay PDF; "—" si no |
| Acciones | 19% | Según estado |

**Acciones por estado:**

| Estado | Acciones |
|---|---|
| `borrador` | "Ver detalle" |
| `emitida` | "Marcar como pagada" (botón primario) · "Ver detalle" |
| `pagada` | "Ver detalle" |

**Flujo "Marcar como pagada":**
1. Clic en "Marcar como pagada".
2. Dialog: nombre del conductor, período, monto total en tipografía grande. "Confirma que realizaste el pago de $ [monto] a [conductor]. Este cambio queda registrado en la bitácora."
3. Al confirmar: fila actualiza en-place a badge "Pagada". Toast: "Liquidación de [conductor] marcada como pagada."

**Estado vacío:** "Aún no hay liquidaciones. Se generan automáticamente cuando el motor registra la primera entrega de un conductor."

---

### Pantalla D-4 — Conciliación

**Ruta:** `/(tenant)/dinero/conciliacion`
**Roles:** `dueno`, `administracion` (RLS lo impone — otros roles no llegan aquí)

#### Jerarquía de información

**Bloque 0 — Banner condicional (cuando pendienteCount === 0):**

Reemplaza a la tabla completa:
```
✓  Sin diferencias — todo cuadra.
Los últimos períodos cerrados no presentaron diferencias.
```
Banner verde celebratorio. No hay tabla vacía con filtros cuando no hay trabajo.

**Bloque 1 — Chips de resumen (cuando pendienteCount > 0):**
```
[Pendientes: 3]   [Revisados: 2]   [Resueltos: 18]   [Ignorados: 4]
```
El chip "Pendientes" tiene el mismo número que el badge en la navegación. Default del filtro: "Pendiente".

**Bloque 2 — Filtros:**
- Estado: default "Pendiente"
- Tipo: selector de tipos de diferencia traducidos
- Seller: selector

**Bloque 3 — Tabla de eventos:**

Ordenamiento: `pendiente` primero, luego `creado_en DESC`.

| Columna | Ancho | Notas |
|---|---|---|
| Tipo diferencia | 28% | Texto traducido |
| Seller | 14% | Nombre; "—" si null |
| Pedido | 12% | ID como enlace a `/operaciones/[id]`; "—" si null |
| Descripción | 28% | Texto de `descripcion`. Si > 120 chars: truncar con `...` + Tooltip completo |
| Estado | 8% | Badge traducido |
| Acciones | 10% | Menú 3 puntos |

**Acciones por estado:**

| Estado | Acciones en el menú |
|---|---|
| `pendiente` | "Marcar revisado" · "Marcar resuelto" · "Ignorar" |
| `revisado` | "Marcar resuelto" · "Ignorar" |
| `resuelto` | Solo lectura |
| `ignorado` | "Restaurar a pendiente" |

"Ignorar" pide confirmación mínima: "¿Ignorar esta diferencia? Quedará registrado en la bitácora." + botón "Sí, ignorar". Las demás acciones son de un clic sin confirmación adicional (son reversibles). Las filas se actualizan en-place. El badge de navegación se decrementa al sacar un evento del estado `pendiente`.

**Descripción criterio C-6:** el campo `descripcion` viene del backend con el texto ya generado. El frontend lo renderiza tal cual, sin reescribirlo. Truncar a 120 caracteres con Tooltip para el texto completo.

#### Wireframe conceptual D-4

```
┌─────────────────────────────────────────────────────────────────────┐
│  Conciliación                                                        │
├─────────────────────────────────────────────────────────────────────┤
│  [Pendientes: 3]  [Revisados: 2]  [Resueltos: 18]  [Ignorados: 4]  │
├─────────────────────────────────────────────────────────────────────┤
│  Estado [▼ Pendiente]   Tipo [▼ Todos]   Seller [▼ Todos]           │
├─────────────────────────┬────────────┬──────────┬───────────────────┤
│ Tipo diferencia         │ Seller     │ Pedido   │ Descripción    ⋮  │
├─────────────────────────┼────────────┼──────────┼───────────────────┤
│ Pedido entregado sin    │ TiendaX    │ #A-8821  │ Pedido A-8821     │
│ línea de cobro          │            │ [↗]      │ entregado 05/06   │
│                         │            │          │ sin línea cobro   │
│                         │            │          │         •Pend. ⋮  │
├─────────────────────────┼────────────┼──────────┼───────────────────┤
│ Monto DTE no coincide   │ Modas Norte│ —        │ DTE folio 33:     │
│ con líneas              │            │          │ $ 720.000 vs      │
│                         │            │          │ líneas $ 715.000  │
│                         │            │          │         •Pend. ⋮  │
└─────────────────────────┴────────────┴──────────┴───────────────────┘

 — — — cuando pendienteCount === 0 — — —

┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│              ✓  Sin diferencias — todo cuadra                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### Pantalla D-5 — Alerta de folios (extensión del dashboard)

**No es pantalla nueva.** Banner insertado en `/(tenant)/dashboard` como Bloque 0.5 — entre el banner de conexiones ML caídas y los KPIs del día.

**Condición:** `(folio_hasta - folio_actual) < 50` en cualquier CAF activo del tenant.

**Criterio C-4:** si el banner aparece aquí, NO se duplica en ninguna otra pantalla de la sesión.

**Contenido:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠  Folios CAF por agotarse — quedan [N] folios (vence [fecha])    │
│     Sube un nuevo archivo CAF para evitar interrupciones.          │
│                                                  [Subir CAF →]     │
└─────────────────────────────────────────────────────────────────────┘
```

Fondo amarillo, texto oscuro. El botón "Subir CAF" navega a la sección de configuración DTE del onboarding.

**Si `folios_restantes === 0`:** fondo rojo, texto "Sin folios CAF disponibles — la emisión de facturas está detenida. Sube un nuevo CAF inmediatamente."

**Jerarquía con otros banners:**
1. Banner conexiones ML caídas (rojo, P0 de Fase B) — si existe.
2. Banner folios por agotarse (amarillo/rojo) — si existe.
3. KPIs del día.

---

## §3 Portal del seller — `/portal/cobros/`

### Pantalla S-1 — Estado de cuenta del seller

**Ruta:** `/portal/cobros`
**Usuario:** seller autenticado. RLS garantiza aislamiento — solo ve sus propios períodos.

#### Jerarquía de información

**Bloque 0 — Chips:**
```
[Abiertos: 1]   [Facturados: 12]
```

**Bloque 1 — Lista de períodos:**

Ordenamiento: `fecha_fin DESC`.

| Columna | Ancho | Notas |
|---|---|---|
| Período | 22% | dd/mm/aaaa – dd/mm/aaaa |
| Estado | 18% | Badge con folio si `facturado` (criterio C-7) |
| Líneas | 10% | Número de entregas |
| Monto total | 20% | CLP `$ 1.234.567` |
| DTE | 30% | Badge estado SII + "Descargar factura (PDF)" si hay DTE |

Al hacer clic en la fila → S-2.

**El seller NUNCA ve:** monto de liquidaciones de conductores, tarifa base del conductor, datos de otros sellers, datos de conciliación.

**Estado vacío:** "Aún no tienes períodos de cobro. Aparecerán aquí cuando comencemos a registrar entregas."

---

### Pantalla S-2 — Detalle de período (vista seller)

**Ruta:** `/portal/cobros/[periodoId]`
**Usuario:** seller autenticado. Solo lectura.

#### Jerarquía de información

**Sección A — Encabezado:**
- Fechas del período
- Badge de estado (con folio si `facturado`, criterio C-7)
- Monto total en tipografía grande

**Sección B — Bloque "Factura" (solo si hay DTE):**
- Folio, fecha de emisión, monto total CLP
- Badge estado SII (ícono de advertencia si `aceptado_con_discrepancias`)
- Si `aceptado_con_discrepancias`: "Esta factura fue aceptada por el SII con observaciones. Si tienes dudas, contacta a [nombre del courier]."
- Si `rechazado`: "Esta factura fue rechazada por el SII. Tu empresa de despacho está trabajando en resolverlo." Sin detalles técnicos de `error_descripcion`.
- Botón "Descargar factura (PDF)" — un solo botón (el seller no necesita el XML). Llama a Server Action de signed URL.

**Sección C — Lista de líneas:**

| Columna | Notas |
|---|---|
| Pedido | Referencia o ID interno |
| Fecha entrega | dd/mm/aaaa |
| Concepto | Texto de `lineas_cobro.concepto` |
| Monto | CLP (`monto_final_clp`), alineado a derecha |

Sin columna de monto base ni ajuste por separado (el seller ve el monto final). Total al pie coincide con el encabezado. Sin acciones de modificación.

---

## §4 PWA del conductor — `/conductor/liquidaciones`

### Pantalla C-1 — Mis liquidaciones

**Ruta:** `/conductor/liquidaciones`
**Usuario:** conductor autenticado. RLS garantiza aislamiento.

#### Principios (mobile-first, coherentes con Fase B)
- Referencia: 375px de ancho.
- Cards verticales, sin tabla.
- Server Component para minimizar tiempo de primer renderizado.
- Sin navegación lateral. Botón "Atrás" explícito.
- Elementos táctiles mínimo 48px de altura.

#### Jerarquía de información

**Encabezado:** "Mis liquidaciones"

**Lista de cards** ordenadas `fecha_fin DESC`:

```
┌─────────────────────────────────────────────────┐
│  01/06/2026 – 07/06/2026        ● Emitida        │
│                                                  │
│  24 entregas                  $ 72.000           │
│                                                  │
│           [ Descargar liquidación ↓ ]            │
└─────────────────────────────────────────────────┘
```

- Línea superior: rango de fechas + badge de estado.
- Línea media: total entregas (izquierda) + monto total CLP en tipografía grande (derecha).
- Botón "Descargar liquidación": ancho completo, visible solo si `pdf_ref` no es null. Llama a Server Action de signed URL → abre en nueva pestaña.
- Si `pdf_ref` es null (borrador sin PDF): el botón NO aparece — se reemplaza por texto gris "PDF disponible cuando la liquidación sea emitida."

**El conductor NUNCA ve:** monto de cobro al seller, tarifas del seller, datos de `lineas_cobro`, `periodos_cobro`, `documentos_dte`.

**Estado vacío:** "Aún no tienes liquidaciones. Aparecerán aquí cuando tu empresa registre tus primeras entregas."

**Error de red:** "No se pudieron cargar tus liquidaciones. Verifica tu conexión." + botón "Reintentar" (ancho completo, 48px mínimo).

#### Wireframe conceptual C-1

```
┌──────────────────────────────┐
│  ← Mis liquidaciones         │
├──────────────────────────────┤
│  ┌────────────────────────┐  │
│  │ 01/06 – 07/06/2026     │  │
│  │                ●Emitida│  │
│  │ 24 entregas  $ 72.000  │  │
│  │  [ Descargar PDF  ↓ ]  │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ 25/05 – 31/05/2026     │  │
│  │                ●Pagada │  │
│  │ 31 entregas  $ 93.000  │  │
│  │  [ Descargar PDF  ↓ ]  │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │ 18/05 – 24/05/2026     │  │
│  │               ●Borrador│  │
│  │  8 entregas   $ —      │  │
│  │  PDF disponible cuando │  │
│  │  la liquidación se     │  │
│  │  emita.                │  │
│  └────────────────────────┘  │
└──────────────────────────────┘
```

---

## §5 Mapa de rutas Next.js — Fase C

```
Courier (roles internos):
  app/(tenant)/dinero/periodos/page.tsx                  D-1
  app/(tenant)/dinero/periodos/[periodoId]/page.tsx      D-2
  app/(tenant)/dinero/liquidaciones/page.tsx             D-3
  app/(tenant)/dinero/conciliacion/page.tsx              D-4
  (D-5 = extensión de app/(tenant)/dashboard/page.tsx)

Portal del seller:
  app/portal/cobros/page.tsx                             S-1
  app/portal/cobros/[periodoId]/page.tsx                 S-2

PWA del conductor:
  app/conductor/liquidaciones/page.tsx                   C-1

Server Actions:
  app/(tenant)/dinero/periodos/actions.ts                cerrar período, signed URL PDF/XML
  app/(tenant)/dinero/liquidaciones/actions.ts           marcar pagada, signed URL PDF
  app/(tenant)/dinero/conciliacion/actions.ts            actualizar estado evento
  app/portal/cobros/actions.ts                           signed URL PDF DTE (seller)
  app/conductor/liquidaciones/actions.ts                 signed URL PDF liquidación
```

---

## §6 Criterios obligatorios — checklist para `frontend`

**C-1. Formato CLP sin decimales, con punto como separador de miles.**
`$ 1.234.567`. Sin decimales. Sin coma. Sin sufijo "CLP". Implementar como `formatearCLP(monto: number): string` en `src/lib/ui/formato-moneda.ts`. Todas las pantallas de dinero importan esta función — cero duplicaciones.

**C-2. Separación estricta seller / conductor — nunca en la misma vista.**
El seller nunca ve datos de `lineas_liquidacion` ni `liquidaciones`. El conductor nunca ve datos de `lineas_cobro`, `periodos_cobro` ni `documentos_dte`. La separación es de datos (RLS); el frontend no agrega lógica de ocultación adicional sobre datos que no deberían llegar.

**C-3. PDFs y XMLs siempre vía Server Action con signed URL de vida corta (15 min).**
Los botones de descarga nunca exponen `pdf_ref`, `xml_dte_ref` ni referencias de Storage al cliente. Cada clic dispara un Server Action. Si el Server Action falla: toast de error. Nunca un enlace roto, nunca una URL pública permanente.

**C-4. Alerta de folios D-5 — una única ocurrencia por sesión de dashboard.**
El banner se renderiza SOLO en `/(tenant)/dashboard`. No se duplica en otras pantallas. La idempotencia de "máximo una vez por día" es responsabilidad del job C7 en backend.

**C-5. `aceptado_con_discrepancias` — badge AMARILLO con ícono de advertencia.**
Nunca verde, nunca rojo. El componente `BadgeEstadoSii` mapea explícitamente este valor a variante `advertencia` con ícono de triángulo. El ícono no es decorativo — es parte de la información.

**C-6. Descripción de `pedido_entregado_sin_linea_cobro` con número de pedido y fecha.**
El campo `descripcion` del evento viene del backend con el texto completo. El frontend lo renderiza tal cual. Si > 120 caracteres: truncar con `...` + Tooltip con texto completo al hover.

**C-7. Estado `facturado` muestra número de folio del DTE.**
`BadgeEstadoPeriodo` acepta `estado: EstadoPeriodoCobro` + `folio?: number`. Si `estado === 'facturado'` y `folio` está definido → "Facturado — Folio [folio]". Si `folio` es null por razón transitoria → "Facturado" sin folio, sin crashear. Aplica en D-1, D-2, S-1, S-2.

---

## §7 Patrones de componentes recomendados

**`BadgeEstadoPeriodo`:** acepta `estado` y `folio?`. Criterio C-7.

**`BadgeEstadoSii`:** acepta `estado`. Criterio C-5 para `aceptado_con_discrepancias`.

**`MontoClp`:** acepta `monto: number`. Siempre usa `formatearCLP`. Sin lógica de formato en componentes hoja.

**`BotonDescargaDocumento`:** acepta `tipo: 'pdf-dte' | 'xml-dte' | 'pdf-liquidacion'` + IDs necesarios. Llama al Server Action correspondiente. Muestra spinner mientras espera. Si falla: toast de error. Nunca expone referencia de Storage.

**`DialogConfirmacionCierre`:** reutilizable para "Cerrar período" (D-1, D-2) y "Marcar como pagada" (D-3). Acepta `titulo`, `resumen`, `advertencia`, `onConfirmar`. Es un dialog genérico — no asume el contexto financiero.

**`EventoConciliacionFila`:** fila de D-4. Acepta el evento completo y mapea acciones según `estado`. Actualiza en-place tras cada acción. Decrementa el badge de navegación si el evento sale de `pendiente`.

### Función de traducción con estructura para `traducirEstadoSii`

```typescript
traducirEstadoSii(estado: EstadoSii): {
  texto: string;
  variante: 'exito' | 'advertencia' | 'error' | 'neutro';
  icono?: string;
}
```

Devuelve un objeto estructurado (no solo string) para que `BadgeEstadoSii` extraiga la variante y el ícono sin hardcodear la lógica. Centraliza el criterio C-5.

---

## §8 Comportamientos de carga y error

**Carga inicial:** Server Components en todas las páginas de backoffice. Sin `useEffect` para la carga inicial. Primer renderizado útil incluye los datos.

**Estados de carga en operaciones mutativas:** botones de acción muestran spinner y se deshabilitan durante el Server Action. No se bloquea la pantalla completa.

**Error de operación mutativa:** el error aparece inline cerca del elemento accionado (dentro del dialog o en toast si el dialog ya se cerró). El mensaje distingue "acción que puedes reintentar" de "error que requiere contactar soporte".

**Error de carga de página:** banner no bloqueante bajo el encabezado. El resto de la navegación sigue accesible.

**PWA del conductor — offline:** si pierde conexión, el Service Worker sirve la última versión cacheada si existe. Si no hay caché: estado de error de red con botón "Reintentar" (ancho completo, 48px mínimo).

---

## Referencias

- `docs/arquitectura/fase-c-dinero.md` — modelo de datos, RLS, flujos del motor, jobs C1–C7
- `docs/ux/fase-b-operacion.md` — patrones de navegación, criterios B-1 a B-10
- `docs/ux/fase-a-onboarding.md` — criterios transversales 1–9
- `src/modules/dinero/index.ts` — funciones disponibles para Server Components
- `src/lib/ui/traduccion-estados.ts` — agregar enums de Fase C a este archivo
