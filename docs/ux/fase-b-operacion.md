# Flujos de Operación — Fase B

## Documento de UX/UI para `frontend` · Panel multi-seller, Asignación/manifiestos, Vista del conductor, Dashboard del dueño

Basado en: `docs/arquitectura/fase-b-operacion.md` (§3 máquina de estados, §5 contratos, §6 jobs), `docs/levantamiento.md` (RF-015..RF-052), `docs/ux/fase-a-onboarding.md` (criterios transversales del Anexo), `src/modules/operacion/tipos.ts`, `src/modules/operacion/maquina-estados.ts`, `src/modules/operacion/index.ts`, `src/modules/identidad/capacidades.ts`.

Principio transversal (CLAUDE.md): reducir clics, llamadas, mensajes de WhatsApp, errores y tiempos de respuesta. Cada decisión de flujo está optimizada contra ese criterio.

---

## §0 Decisiones de secuencia y patrón de navegación

### Dónde viven estas rutas en la navegación existente

Fase A construyó la estructura `/app/(tenant)/` para el courier y `/app/portal/` para el seller. Fase B extiende esos dos árboles sin crear una nueva sección de navegación de nivel 0.

**Estructura de navegación del courier (roles internos):**

```
OPERACION
  ├── Dashboard           /app/(tenant)/dashboard
  ├── Pedidos             /app/(tenant)/operaciones
  └── Manifiestos         /app/(tenant)/manifiestos

CONFIGURACION
  ├── Sellers             /app/(tenant)/sellers        (ya existía en Fase A)
  ├── Equipo              /app/(tenant)/equipo         (ya existía en Fase A)
  └── ...
```

**Portal del seller (extensión de lo ya construido en Fase A):**

```
/app/portal/
  ├── inicio              (estado de conexión ML — ya existía en Fase A, Pantalla O)
  ├── pedidos             NUEVO Fase B
  └── incidencias         NUEVO Fase B
```

### Decisiones de patrón de navegación

**Panel de pedidos como vista principal de operación.** El coordinador y supervisor pasan la mayor parte del día en la lista de pedidos. URL `/operaciones` es el punto de entrada directo, primer nivel de navegación.

**Manifiestos como sección propia.** Crear y gestionar manifiestos es una tarea multi-paso. Merece página propia — no un modal que bloquea el panel de pedidos.

**Vista del conductor en dominio separado.** La PWA vive en `/conductor`. Es una aplicación distinta en experiencia (mobile-first, sin navegación lateral) aunque comparta el mismo repositorio.

**Dashboard como pantalla de inicio del dueño.** Al iniciar sesión, el `dueno` aterriza en `/dashboard`. El `supervisor` y `coordinador` aterrizan en `/operaciones`. La redirección se evalúa en el layout del área autenticada según `tipo_usuario` + `rol`.

---

## FLUJO 1 — Panel multi-seller / Operaciones (vista del courier interno)

RF-015..RF-017, RF-019, RF-020, RF-027, RF-028, RF-029.

### Mapa de pantallas (vista de pájaro)

```
/app/(tenant)/operaciones
   │
   ├── [barra de filtros: seller | estado | fecha_compromiso]
   ├── [contadores de estado arriba de la tabla]
   ├── [tabla paginada de pedidos]
   │      └── clic en fila ──────────────────────► /operaciones/[pedidoId]
   │                                                    ├── info del pedido
   │                                                    ├── historial de estados
   │                                                    ├── incidencias del pedido
   │                                                    ├── [Cambiar estado manualmente] (solo supervisor+)
   │                                                    ├── [Asignar a manifiesto] (coordinador+)
   │                                                    └── [Abrir incidencia]
   │
   └── [+ Nuevo pedido same-day] ──────────────────► modal o panel lateral
          └── formulario same-day
                └── confirmar ──────────────────► vuelve a la lista, nueva fila visible

/app/(tenant)/operaciones/incidencias
   ├── lista de incidencias abiertas del tenant
   └── clic en fila ──────────────────────────────► panel lateral de detalle + acciones
```

### Pantalla 1-A — Lista de pedidos (vista principal de operaciones)

**Objetivo:** el coordinador y supervisor responden en menos de 10 segundos "cuántos pedidos hay pendientes de asignación y cuáles".

**Bloque 1 — Contadores de estado (siempre visibles, sin scroll):**

Cinco chips/tarjetas horizontales con conteo por estado para el día activo:

```
[Pendiente asig.: 12] [Asignados: 28] [En ruta: 34] [Entregados: 67] [Con problemas: 5]
```

"Con problemas" agrupa `fallido` + `fallido_manual` + `devuelto`.

**Tabla de traducción de estados (fuente única — usar en TODO el sistema):**

| Enum (backend) | Texto visible en UI |
|---|---|
| `pendiente_asignacion` | Pendiente de asignación |
| `asignado` | Asignado |
| `en_ruta` | En ruta |
| `entregado` | Entregado |
| `entregado_manual` | Entregado (corrección) |
| `fallido` | Fallido |
| `fallido_manual` | Fallido (corrección) |
| `cancelado` | Cancelado |
| `devuelto` | Devuelto |

**Bloque 2 — Barra de filtros:**

Tres filtros en línea, ninguno obligatorio (default: todos los pedidos del día de hoy):
- Seller: selector + "Todos los sellers".
- Estado: selector con lista traducida + "Todos los estados".
- Fecha de compromiso: date-picker, valor inicial = hoy. Al cambiar, los contadores del Bloque 1 también se actualizan.

Botón "Limpiar filtros" solo visible cuando hay algún filtro activo.

**Bloque 3 — Tabla de pedidos:**

Columnas: estado (badge con color), seller, destinatario (nombre + comuna), fecha compromiso, conductor asignado (o "Sin asignar"), tipo (Flex / Same-day), acciones (menú de 3 puntos).

Ordenamiento: `fecha_compromiso ASC`, luego `creado_en DESC`.

Paginación: 25 filas/página. Total visible arriba de la tabla ("146 pedidos").

**Acciones en la fila según rol:**

| Acción | Roles que la ven |
|---|---|
| Ver detalle | Todos los internos |
| Asignar a manifiesto | Coordinador, supervisor, dueño |
| Abrir incidencia | Supervisor, dueño |
| Cambiar estado (corrección manual) | Supervisor, dueño |

El menú se oculta completamente si el rol no tiene ninguna acción disponible.

**Estados de la pantalla:**

- Vacío (sin pedidos para la fecha): mensaje + CTA "Crear pedido same-day" si tiene `puedeAjustarOperacionDiaria`.
- Cargando: skeleton de la tabla, contadores muestran "—".
- Error de red: banner no bloqueante "No se pudo cargar la lista — Reintentar".
- Sin resultados con filtros: "No hay pedidos que coincidan. Prueba cambiando el seller o la fecha." + "Limpiar filtros".

### Pantalla 1-B — Detalle del pedido

**Objetivo:** supervisor responde en menos de 30 segundos: qué estado tiene, qué pasó antes, si tiene incidencias abiertas, qué puede hacer.

**Sección A — Encabezado:**
Nombre del destinatario (grande), dirección + comuna, tipo (badge Flex/Same-day), seller (con enlace interno), ID interno, `ml_shipment_id` (texto pequeño, para soporte).

**Sección B — Estado actual + historial de transiciones:**

Estado actual en badge grande y prominente.

Historial como línea de tiempo vertical compacta:
```
[Estado anterior] → [Estado actual]
Cambiado por: [nombre usuario] el [fecha hora]     ← solo si fue manual
Motivo: "..."                                       ← solo si fue manual

[Estado antes de eso] → [Estado anterior]
Sincronización automática · hace 2 horas
```

Diferencia visual entre cambio manual (quién + motivo) y cambio por sistema ("Sincronización automática").

**Sección C — Incidencias abiertas (solo si existen):**

Bloque destacado (borde amarillo o rojo según estado) con tipo traducido, estado, quién la abrió y cuándo.

**Tabla de traducción de tipos de incidencia:**

| Enum | Texto visible |
|---|---|
| `destinatario_ausente` | Destinatario ausente |
| `direccion_erronea` | Dirección incorrecta |
| `paquete_danado` | Paquete dañado |
| `rechazo_destinatario` | Rechazado por destinatario |
| `problema_acceso` | Problema de acceso |
| `reagendado` | Reagendado |
| `otro` | Otro |

**Sección D — Asignación actual:**
- Si null: "Sin conductor asignado — pendiente de asignación".
- Si tiene: nombre del conductor + nombre del manifiesto + fecha de operación.

**Sección E — Acciones disponibles (según rol):**

```
[Asignar a manifiesto]     ← si puedeAsignarYReasignarPedidos Y estado = pendiente_asignacion
[Reasignar conductor]      ← si puedeAsignarYReasignarPedidos Y ya tiene conductor asignado
[Abrir incidencia]         ← si puedeGestionarIncidencias Y estado no es terminal
[Cambiar estado]           ← si puedeAjustarOperacionDiaria (supervisor+)
```

No se muestran acciones deshabilitadas — directamente no aparecen si el usuario no tiene el permiso.

**Interacción "Cambiar estado" (acción destructiva — drawer con confirmación):**

1. Se abre un drawer (no un `alert` ni dialog de una línea).
2. El drawer muestra: estado actual (solo lectura), selector de "Nuevo estado" (construido dinámicamente con `esTransicionValida(estadoActual, candidato, 'interno')` — nunca una lista hardcodeada), campo de motivo obligatorio (textarea, mínimo 10 caracteres), advertencia: "Este cambio queda registrado en la bitácora de auditoría."
3. Botón "Confirmar cambio de estado" en color de alerta.
4. Si confirma: pantalla se actualiza in-place con nuevo estado e historial.

### Pantalla 1-C — Creación de pedido same-day (modal/panel lateral)

**Campos:**

Bloque "Destinatario": nombre, dirección (campo libre), comuna (selector o campo libre), teléfono (opcional).

Bloque "Entrega": instrucciones (opcional), fecha compromiso (date-picker, default hoy).

Bloque "Facturación": seller al que se factura. Si quien crea es el propio seller: campo fijo, no seleccionable.

Nota informativa: "Este pedido se agrega al panel y queda disponible para asignarlo a un manifiesto."

**Estados:**
- Validación inline: nombre, dirección y comuna son obligatorios.
- Enviando: botón deshabilitado + spinner.
- Éxito: panel/modal se cierra, toast "Pedido same-day creado" y nueva fila visible en la lista — sin recargar la página.

### Pantalla 1-D — Panel de incidencias (vista consolidada del tenant)

**Ruta:** `/app/(tenant)/operaciones/incidencias`

**Filtros:** seller, tipo de incidencia, estado (default: `abierta` + `en_gestion`), fecha de apertura.

**Tabla:** estado (badge), tipo (traducido), pedido (ID + link), seller, conductor del pedido, horas desde apertura (resaltado en rojo si supera umbral — ver Criterio B-6), quién abrió.

**Panel lateral al hacer clic (acciones según `puedeGestionarIncidencias`):**
- Cambiar a "En gestión" (desde "Abierta").
- Agregar nota de resolución.
- Cambiar a "Resuelta" (requiere nota de resolución no vacía).
- Cambiar a "Cerrada" (desde "Resuelta").

Un `coordinador` sin `puedeGestionarIncidencias` solo puede leer.

---

## FLUJO 2 — Asignación y manifiestos

RF-022, RF-023, RF-024.

### Mapa de pantallas

```
/app/(tenant)/manifiestos
   ├── lista de manifiestos (filtros: fecha / conductor / estado)
   └── [+ Nuevo manifiesto] ──────────────────────────────────► Pantalla 2-A

/app/(tenant)/manifiestos/nuevo               ← Pantalla 2-A (formulario)
   └── guardar ──────────────────────────────────────────────► Pantalla 2-B

/app/(tenant)/manifiestos/[manifiestoId]      ← Pantalla 2-B (vista del manifiesto)
   ├── info + lista de pedidos asignados
   ├── [Agregar pedidos] (si estado = 'borrador') ──────────► Pantalla 2-C
   │                                                            └── confirmar ──► vuelve a 2-B
   └── [Confirmar manifiesto] ──────────────────────────────► dialog ──► estado 'confirmado'
```

### Pantalla 2-A — Crear manifiesto

**Campos:**
1. Conductor: selector de conductores activos. Si ya tiene manifiesto activo para la misma fecha, aviso inline (no bloqueante): "Este conductor ya tiene un manifiesto para hoy."
2. Fecha de operación: date-picker, default = hoy.
3. Nombre: pre-rellenado con "Ruta [nombre conductor] — [fecha]", editable.
4. Notas: opcional.

Al confirmar: navega directo a la Pantalla 2-B del manifiesto recién creado.

### Pantalla 2-B — Vista del manifiesto

**Encabezado:** nombre, conductor asignado, fecha, estado del manifiesto en badge grande.

**Tabla de traducción de estados de manifiesto:**

| Enum | Texto visible |
|---|---|
| `borrador` | Borrador |
| `confirmado` | Confirmado (listo para el conductor) |
| `en_ruta` | En ruta |
| `completado` | Completado |
| `cancelado` | Cancelado |

**Lista de pedidos asignados:**
- En `borrador`: cada fila tiene botón de quitar (X). Total de pedidos visible.
- En `confirmado`, `en_ruta`, `completado`: solo lectura.

**Acciones según estado:**

```
Estado 'borrador':
  [Agregar pedidos]           ← abre Pantalla 2-C
  [Confirmar manifiesto]      ← activo solo si hay ≥1 pedido
  [Cancelar manifiesto]       ← con confirmación simple

Estado 'confirmado':
  (sin acciones de edición)
  [Ver como lo ve el conductor]  ← enlace de lectura
```

**"Confirmar manifiesto" — flujo:**

1. Dialog de confirmación: "Vas a confirmar este manifiesto para [nombre del conductor]. Una vez confirmado, no se podrán agregar ni quitar pedidos."
2. Botón "Confirmar" (primario) y "Cancelar".
3. Al confirmar: toast "Manifiesto confirmado — [nombre del conductor] ya puede verlo en su app."

**Estado vacío:** "Este manifiesto no tiene pedidos todavía." + botón "Agregar pedidos".

### Pantalla 2-C — Seleccionar pedidos para el manifiesto

**Filtros:** seller, comuna del destinatario.

**Lista:** pedidos con `estado = pendiente_asignacion`. Checkboxes en cada fila. Columnas: destinatario, dirección + comuna, seller, fecha compromiso.

**Barra sticky al fondo:** "X pedidos seleccionados" + "Agregar al manifiesto" (activo si ≥1 seleccionado) + "Cancelar".

**Flujo de reasignación — advertencia obligatoria:**

Si algún pedido seleccionado tiene `estado = asignado` (ya está en otro manifiesto), mostrar dialog antes de confirmar:

"El pedido [ID] ya está asignado al manifiesto '[nombre del manifiesto]' del conductor [nombre del conductor]. Si lo agregas aquí, se quitará de ese manifiesto."

Botón "Continuar de todos modos" y "Cancelar". El nombre del conductor y del manifiesto son obligatorios en el texto — no solo "ya está asignado".

**Estado vacío:** "No hay pedidos pendientes de asignación. Los pedidos se crean automáticamente desde Mercado Libre o puedes crear un pedido same-day."

---

## FLUJO 3 — Vista del conductor (PWA, mobile-first)

RF-047.

### Mapa de pantallas

```
/conductor                             ← punto de entrada
   └── /conductor/manifiesto           ← manifiesto activo del día
          ├── [banner permanente: usa la app de Flex para registrar entregas]
          ├── lista de cards de pedidos
          ├── cada card ──────────────► /conductor/manifiesto/[pedidoId]
          └── [Listo para salir]       ← confirmar recepción (solo si estado = 'confirmado')
```

### Principios de diseño de la PWA

- Pantalla de 375px de ancho como referencia.
- Altura mínima de elementos interactivos: 48px.
- Sin navegación lateral — stack de pantallas, botón "Atrás" explícito.
- Sin tablas — todo en cards.
- Tipografía grande: el conductor lee en movimiento o bajo el sol.
- Server Component para la pantalla del manifiesto — mínimo tiempo de primer renderizado útil.

### Pantalla 3-A — Manifiesto activo del día

**Objetivo:** en menos de 5 segundos, el conductor sabe cuántos pedidos tiene, si el manifiesto está listo y si algún pedido tiene un problema.

**Encabezado fijo (no se va con el scroll):**
Nombre del manifiesto, fecha de operación, total de pedidos ("12 pedidos para hoy").

**Banner de instrucción permanente — no colapsable, no removible:**

```
Para registrar la entrega, usa la app de
Mercado Envíos Flex. Esta app es solo de referencia.
```

Fondo de color distinto al resto de la página (azul informativo). Sin botón de cerrar. Sin posibilidad de minimizar. Es parte permanente de la UI, no una alerta temporal. Si alguien lo quita en code review, es un error de producto.

**Lista de cards de pedidos:**

Cada card: número de orden en la ruta (numeral grande en esquina superior izquierda), nombre del destinatario (grande), dirección + comuna, instrucciones de entrega (si existen, en gris más pequeño), estado actual (badge, esquina superior derecha, con la misma tabla de traducción que el panel de operaciones).

Si el pedido tiene incidencia abierta: indicador visual en la card (ícono de alerta, borde de color) + tipo traducido. Solo informativo.

**Botón "Listo para salir" (confirmar recepción):**

Solo visible si el manifiesto está en estado `confirmado`. Ancho completo, altura mínima 56px, al fondo de la pantalla.

Al pulsar: dialog de confirmación: "¿Confirmas que recibiste los [N] paquetes de este manifiesto y estás listo para salir?"

Al confirmar: estado del manifiesto se actualiza, el botón desaparece y se reemplaza por "En ruta — saliste a las [hora]".

**Estados:**
- Sin manifiesto activo: "No tienes un manifiesto asignado para hoy. Si crees que es un error, contacta a tu coordinador."
- Manifiesto en `borrador`: "Tu manifiesto para hoy todavía no está listo. Vuelve a revisar cuando tu coordinador lo confirme." — sin lista de pedidos (evitar confusión si el manifiesto cambia antes de confirmarse).
- Manifiesto `completado`: "Ruta completada." — lista en modo lectura, sin botón de confirmar.
- Error de red: "No se pudo cargar tu manifiesto. Verifica tu conexión." + "Reintentar".

### Pantalla 3-B — Detalle del pedido (desde el manifiesto del conductor)

**Contenido (texto grande, legible en movimiento):**

- Destinatario: nombre completo.
- Dirección: calle + número + depto/casa, comuna. Enlace "Abrir en Google Maps" (parámetro de búsqueda con la dirección).
- Teléfono (si existe): enlace `tel:` para llamar directamente.
- Instrucciones de entrega: bloque destacado si existen.
- Estado actual: badge grande.
- Incidencia abierta (si existe): tipo traducido. Solo informativo: "Hay una incidencia abierta: [tipo]. Si tienes información nueva, comenta con tu coordinador."

**Sin acciones de cambio de estado.** Completamente de lectura para el conductor. Los cambios de estado ocurren en la app de ML Flex, no aquí.

---

## FLUJO 4 — Dashboard del dueño

RF-041..RF-046, RF-050.

### Mapa de pantallas

```
/app/(tenant)/dashboard
   ├── [banner conexiones ML caídas] (P0 — solo si conexionesCaidas > 0)
   ├── bloque de KPIs del día (4 tarjetas)
   ├── distribución de pedidos por estado
   ├── incidencias abiertas sin gestión > X horas (lista corta)
   └── accesos rápidos: Pedidos | Sellers | Equipo
```

### Pantalla 4-A — Dashboard del dueño

**Objetivo:** en 30 segundos saber si hay algo urgente y cómo va el día. Si todo va bien, no hay que hacer nada — solo leer.

**Principio "de 30 segundos":** el orden visual replica el orden de prioridad. Lo más urgente va arriba. Si no hay nada urgente, el dueño empieza directamente por los KPIs.

**Bloque 0 — Banner de conexiones ML caídas (solo si `conexionesCaidas > 0`):**

Este bloque NO existe en la página si `conexionesCaidas === 0`. Cuando existe: primer elemento visible, antes de cualquier otro contenido, fondo rojo, texto blanco.

```
[!] Conexiones de Mercado Libre caídas (N)

[Nombre del seller A]  [Reconectar →]
[Nombre del seller B]  [Reconectar →]
```

"Reconectar" lleva directamente al flujo OAuth del seller (Pantalla M de Fase A), parametrizado con el `sellerId`. Un clic — sin pasos intermedios.

Si hay más de 3 sellers caídos: mostrar los 3 primeros + "y N más" con enlace a la sección de Sellers.

**Por qué es P0:** una conexión caída significa que los pedidos de ese seller no están ingresando. Cada minuto son pedidos perdidos que generan fuga de margen y errores de facturación.

**Bloque 1 — KPIs del día (4 tarjetas):**

| Tarjeta | Valor | Fuente |
|---|---|---|
| Total del día | Número entero | `totalPedidos` |
| Tasa de entrega | Porcentaje (ej: "78%") | `tasaEntrega * 100` |
| En ruta ahora | Número entero | `porEstado['en_ruta'] ?? 0` |
| Pendientes de asignación | Número entero | `porEstado['pendiente_asignacion'] ?? 0` |

La tasa de entrega se colorea: verde ≥85%, amarillo 70–84%, rojo <70%.

La tarjeta "Pendientes de asignación" tiene CTA secundario discreto "Asignar ahora" → `/operaciones?estado=pendiente_asignacion`.

**Bloque 2 — Distribución por estado:**

No es un chart de torta. Es un desglose de barras simples con conteo por estado, calculado de `porEstado`. Solo se muestran estados con al menos 1 pedido.

```
Entregados      ████████████████████  67
En ruta         ████████████          34
Asignados       ████████              28
Pendientes      ████                  12
Fallidos          █                    3
Cancelados        █                    2
```

**Bloque 3 — Incidencias sin gestión:**

Lista de incidencias con `estado = 'abierta'` sin pasar a `en_gestion` en más de X horas (umbral sugerido: 4 horas). Máximo 5 visible. Si hay más: "Ver todas (N)" → `/operaciones/incidencias?estado=abierta`.

Por incidencia: tipo traducido, destinatario del pedido, seller, horas desde apertura.

Si no hay incidencias sin gestión: este bloque no aparece.

**Bloque 4 — Accesos rápidos:**

"Ver todos los pedidos", "Gestionar sellers", "Gestionar equipo". Siempre visibles.

**Estados:**
- Cargando: KPIs muestran "—". Banner de conexiones puede cargar independiente (dos consultas).
- Error al cargar métricas: banner no bloqueante debajo de los KPIs. El resto del dashboard sigue visible.
- Primer día sin pedidos: KPIs en cero, distribución no aparece, accesos rápidos sí.

### Ampliación del portal del seller — nuevas secciones de Fase B

**Sección "Mis pedidos" (`/app/portal/pedidos`):**

Lista de pedidos del seller. Columnas: estado (traducido), destinatario, dirección, fecha compromiso. Filtros: estado, fecha. Paginación.

El seller NO puede cambiar estados, asignar ni abrir incidencias. Solo lectura.

**Sección "Incidencias" (`/app/portal/incidencias`):**

Lista de incidencias de sus pedidos. Puede ver detalle pero no puede cambiar estado. Puede agregar nota informativa si el backend lo permite en `ActualizarIncidenciaEntrada`.

**Botón "Solicitar pedido same-day"** en el menú del portal. Abre el formulario de Pantalla 1-C parametrizado con el seller autenticado — campo de facturación fijo, no seleccionable.

---

## Sugerencias de rutas Next.js

```
Courier (roles internos):
  app/(tenant)/dashboard/page.tsx
  app/(tenant)/operaciones/page.tsx
  app/(tenant)/operaciones/[pedidoId]/page.tsx
  app/(tenant)/operaciones/incidencias/page.tsx
  app/(tenant)/manifiestos/page.tsx
  app/(tenant)/manifiestos/nuevo/page.tsx
  app/(tenant)/manifiestos/[manifiestoId]/page.tsx
  app/(tenant)/manifiestos/[manifiestoId]/asignar/page.tsx

Conductor (PWA mobile-first):
  app/conductor/page.tsx                       ← redirige a /conductor/manifiesto
  app/conductor/manifiesto/page.tsx
  app/conductor/manifiesto/[pedidoId]/page.tsx

Portal del seller (extensión de Fase A):
  app/portal/pedidos/page.tsx                  (NUEVO Fase B)
  app/portal/incidencias/page.tsx              (NUEVO Fase B)
  app/portal/same-day/page.tsx                 (NUEVO Fase B)
```

---

## Anexo — Criterios transversales específicos de Fase B para `frontend`

Los 9 criterios del Anexo de `docs/ux/fase-a-onboarding.md` aplican íntegros. Se agregan:

**B-1. Traducción de enums obligatoria y centralizada.**
Los enums de `EstadoPedido`, `TipoIncidencia`, `EstadoManifiesto` nunca se muestran en bruto. La tabla de traducción definida en este documento es la única fuente de verdad. Se implementa en `src/lib/ui/traduccion-estados.ts`, importado por todos los componentes que necesiten mostrar estados. Sin traducciones duplicadas ni distintas en diferentes partes del código.

**B-2. La PWA del conductor es de solo lectura — explícitamente.**
Toda la sección `/conductor` es de solo lectura. Los componentes no reciben handlers de cambio de estado, no llaman a `actualizarEstadoPedido`. Si se reutiliza una card de pedido del panel de operaciones, debe usarse una variante `readonly` o no renderizar las acciones. La separación debe ser explícita en el código, no depender de que "los botones quedan deshabilitados".

**B-3. Banner "usa la app de Flex" no es opcional ni colapsable.**
Es parte permanente de la pantalla del manifiesto activo. Sin botón de cerrar, sin forma de minimizarlo. Si alguien lo quita en code review, es un error de producto.

**B-4. Cambio de estado manual = drawer con confirmación y motivo obligatorio.**
No `window.confirm`, no `alert`, no dialog de una línea. Es un drawer con: estado actual (lectura), selector de estado nuevo (construido con `esTransicionValida(estadoActual, candidato, 'interno')`), textarea de motivo (mínimo 10 caracteres), advertencia de bitácora. El botón de confirmar se habilita solo cuando el motivo tiene la longitud mínima.

**B-5. Reasignación = dialog de advertencia con nombre explícito.**
Si el coordinador intenta asignar un pedido que ya tiene conductor asignado, el texto del dialog incluye el nombre del conductor actual y el nombre del manifiesto actual. "Ya está asignado" sin el nombre no es información suficiente para decidir.

**B-6. Incidencias sin gestión > X horas = indicador visual diferenciado.**
En la lista de incidencias y en el dashboard, una incidencia abierta que supere el umbral de horas muestra un indicador visual distinto (badge "Sin gestión: Nhrs" en rojo). Umbral sugerido: 4 horas.

**B-7. El dashboard no muestra bloques vacíos.**
Si `conexionesCaidas === 0`, el banner no aparece. Si no hay incidencias sin gestión, ese bloque no aparece. Si no hay pedidos, la distribución no aparece. La ausencia de problema no es información — no rellenar la pantalla con ceros y etiquetas vacías.

**B-8. `esTransicionValida` es la fuente del selector de estado.**
El selector de "nuevo estado" en el drawer de corrección manual no tiene lista hardcodeada. Usa `esTransicionValida(estadoActual, candidato, 'interno')` importando la función pura de `src/modules/operacion/maquina-estados.ts`. Si la máquina de estados se extiende en el futuro, el frontend hereda las nuevas opciones sin cambios.

**B-9. Datos del destinatario — minimización.**
Nombre, teléfono y dirección del destinatario se muestran donde son necesarios para la operación (detalle del pedido, card del conductor). No aparecen en listados consolidados donde no aportan valor operativo (el dashboard del dueño no incluye nombres de destinatarios). Coherente con Ley 21.431 y CLAUDE.md.

**B-10. Carga de datos del conductor — Server Component.**
`/conductor/manifiesto` se implementa como Server Component. El conductor puede tener conexión móvil lenta; el primer renderizado útil debe ser mínimo. Los datos del manifiesto se obtienen en el servidor, no con `useEffect` desde el cliente.
