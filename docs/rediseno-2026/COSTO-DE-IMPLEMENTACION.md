# Rutax · Costo de implementación, componente por componente

**Versión 1.0 · 22 de agosto de 2026**

Este documento existe para presupuestar, no para recortar el diseño. Todo lo que está acá está diseñado; lo que declara es **cuánto cuesta llegar a ello desde lo que el producto ya tiene**.

## Punto de partida real

El producto está hecho con **Next.js, Tailwind y shadcn/ui**, y hoy tiene **30 componentes en uso en 84 pantallas**:

`alert` · `avatar` · `badge` · `badge-estado` · `button` · `card` · `chart` · `checkbox` · `data-table` · `dialog` · `dialog-confirmacion-dinero` · `dropdown-menu` · `empty-state` · `input` · `kpi-card` · `label` · `monto-clp` · `pagination` · `popover` · `progress` · `select` · `separator` · `sheet` · `skeleton` · `sonner` · `table` · `table-skeleton` · `tabs` · `textarea` · `tooltip`

## Los tres niveles de costo

| Nivel | Qué significa | Esfuerzo típico |
|---|---|---|
| **RE-ESTILO** | El componente existe y su comportamiento sirve. Se cambian tokens, espaciado y tipografía. No se toca la lógica. | horas |
| **EXTENDER** | El componente existe pero le falta comportamiento o variantes. Se conserva su base y se le agrega. | 1–3 días |
| **DE CERO** | No existe nada equivalente, o lo que existe resuelve otro problema. | 3 días a 2 semanas |

## Resumen

| Nivel | Componentes | % |
|---|---|---|
| **RE-ESTILO** | 31 | 31% |
| **EXTENDER** | 27 | 27% |
| **DE CERO** | 42 | 42% |
| **Total** | **100** | |

**Lectura del número:** el 58% del catálogo sale de lo que ya existe. El 42% de cero se concentra en tres frentes que hoy el producto no tiene: **el sistema de estado con sus 29 vocabularios**, **la trastienda de dinero** y **la app del conductor** (que además es nativa, no comparte código con la web).

---

# 1 · Primitivas y controles de formulario

| Componente | Costo | Contra qué existente | Pantallas que cubre |
|---|---|---|---|
| `botón` — 5 variantes × 7 estados | **RE-ESTILO** | `button` | Todas. 84 pantallas hoy, ~102 al terminar |
| `botón de peldaño 3` — variante con acto explícito | **EXTENDER** | `button` | P4, B2a, B2b, B3b, B6 · 14 pantallas |
| `campo de texto` | **RE-ESTILO** | `input` | Todos los formularios · 38 pantallas |
| `área de texto` | **RE-ESTILO** | `textarea` | Motivos, comentarios, reportes · 19 pantallas |
| `campo de monto CLP` | **EXTENDER** | `monto-clp` + `input` | Tarifas, ajustes, retiro, condonar · 11 pantallas |
| `campo numérico` | **RE-ESTILO** | `input` | Folios, minutos, capacidad · 9 pantallas |
| `selector` | **RE-ESTILO** | `select` | Todos los formularios · 34 pantallas |
| `selección múltiple` | **EXTENDER** | `select` + `popover` | Zonas y comunas, filtros, fuentes · 12 pantallas |
| `casilla` | **RE-ESTILO** | `checkbox` | Tablas con selección, consentimiento · 22 pantallas |
| `casilla táctil de 56 px` | **EXTENDER** | `checkbox` | P2 en tablet y teléfono, B5 · 6 pantallas |
| `interruptor` | **DE CERO** | — no existe `switch` | Banderas, disponibilidad, cobro automático, notificaciones · 14 pantallas |
| `etiqueta de campo` | **RE-ESTILO** | `label` | Todos los formularios |
| `ayuda de campo` | **RE-ESTILO** | `label` + `tooltip` | 26 pantallas |
| `error de validación en línea` | **EXTENDER** | `label` | Todos los formularios · 38 pantallas |
| `campo de búsqueda` | **EXTENDER** | `input` | Pedidos, sellers, conductores, portal, backstage · 16 pantallas |
| `selector de fecha` — día · rango · atajos, en un control | **DE CERO** | — hoy no existe ninguno | Pedidos, períodos, liquidaciones, bitácora, analítica · 17 pantallas |
| `credencial de una sola vez` | **DE CERO** | — | B3b Integraciones · 1 pantalla |
| `escala de texto de cuatro pasos` | **DE CERO** | — nativa | B5 Preferencias · toda la app |
| `selector de tema de tres estados` | **DE CERO** | — nativa | B5 Preferencias · toda la app |

**19 componentes · 8 re-estilo · 6 extender · 5 de cero**

---

# 2 · Estado y etiquetado

Este bloque es el más caro en proporción y el que más valor sostiene: **29 vocabularios de estado con ~147 valores**. Hoy `badge-estado` resuelve un vocabulario con colores repartidos a ojo.

| Componente | Costo | Contra qué existente | Pantallas que cubre |
|---|---|---|---|
| `distintivo de estado` — 6 tonos × glifo × etiqueta | **DE CERO** | `badge-estado` no sirve: hay que rehacer su modelo de datos | 61 pantallas |
| `distintivo inerte con trama` | **DE CERO** | — | Cancelados, inactivos, descartados, suspendidos · 23 pantallas |
| `etiqueta de procedencia` — SD · FLEX · SHOP | **EXTENDER** | `badge` | P1, P2, P3, B4, B7, B8 · 12 pantallas |
| `glifo de estado de dirección` | **DE CERO** | — | P1, P2, B1a, B1c · 7 pantallas |
| `bandera de bloqueo` — COBRO/LIQ, FACT/PAGO | **DE CERO** | — | P6, B2a, B2b · 5 pantallas |
| `etiqueta` genérica | **RE-ESTILO** | `badge` | 44 pantallas |
| `distintivo de modo de pruebas` | **EXTENDER** | `badge` | P4, B2a, B3a, B6 · 6 pantallas |
| `contador de cajón` | **EXTENDER** | `badge` | P1, P2, P6, B2a, B2b, B4, B6 · 15 pantallas |
| `barra de cajones con excluido` | **DE CERO** | `tabs` resuelve otra cosa | P1, P2, P6, B2a, B2b, B4, B6 · 15 pantallas |
| `distintivo de acuse de escaneo` — 3 variantes | **DE CERO** | — nativa | B5 Retiro, traspaso · 3 pantallas |

**10 componentes · 1 re-estilo · 3 extender · 6 de cero**

---

# 3 · Tablas y listados

| Componente | Costo | Contra qué existente | Pantallas que cubre |
|---|---|---|---|
| `tabla` base con ordenamiento | **RE-ESTILO** | `table` + `data-table` | 47 pantallas |
| `tabla con selección múltiple` | **EXTENDER** | `data-table` | P1, P2, B2a, B2b, B3b · 11 pantallas |
| `selección táctil en tres niveles` — fila, columna, todo | **DE CERO** | — hoy solo hay clic y shift-clic | P2 en tablet y teléfono · 3 pantallas |
| `barra de selección con composición` | **DE CERO** | — | P2, B2a, B2b, B3b · 8 pantallas |
| `tabla de densidad 32` | **RE-ESTILO** | `data-table` | B6, las 13 del backstage |
| `tabla financiera` — subtotales, total, doble regla | **DE CERO** | `table` no tiene jerarquía de suma | B2a, B2b, B3b, B4, B8 · 14 pantallas |
| `bloque de composición` | **DE CERO** | — | B2a, B2b, B4, B5, B8 · 12 pantallas |
| `fila vigente / programada` | **EXTENDER** | `data-table` | B3b Tarifas, cortes, planes · 4 pantallas |
| `esqueleto de tabla` | **RE-ESTILO** | `table-skeleton` | 47 pantallas |
| `paginación` | **RE-ESTILO** | `pagination` | 31 pantallas |
| `aviso de truncamiento` | **EXTENDER** | `alert` | P1, P2, B6 · 7 pantallas |
| `franja de cambios pendientes` | **DE CERO** | — | P1, P2, B1a, B1b · 6 pantallas |
| `señal de cambio en sitio` | **DE CERO** | — | P1, P2, B1a · 5 pantallas |
| `fila de salud de conexión` | **EXTENDER** | `data-table` | B6 Salud de integraciones · 1 pantalla |

**14 componentes · 4 re-estilo · 4 extender · 6 de cero**

---

# 4 · Contenedores y superficies

| Componente | Costo | Contra qué existente | Pantallas que cubre |
|---|---|---|---|
| `tarjeta` | **RE-ESTILO** | `card` | 52 pantallas |
| `mosaico de magnitudes` | **RE-ESTILO** | `kpi-card` | B1c Dashboard, B4 Inicio, B3b Mi plan, B6 Métricas · 6 pantallas |
| `panel lateral` | **RE-ESTILO** | `sheet` | 24 pantallas |
| `panel de detalle con zona de consecuencia` | **EXTENDER** | `sheet` | P3, P6, B1b, B2a, B2b · 12 pantallas |
| `hoja móvil` | **EXTENDER** | `sheet` | P1, P3, B4, B5 · 14 pantallas |
| `modal` | **RE-ESTILO** | `dialog` | 28 pantallas |
| `modal de acto explícito` | **EXTENDER** | `dialog-confirmacion-dinero` | P4, B2a, B2b, B3b, B6 · 16 pantallas |
| `popover` | **RE-ESTILO** | `popover` | 31 pantallas |
| `menú desplegable` | **RE-ESTILO** | `dropdown-menu` | 22 pantallas |
| `pestañas` | **RE-ESTILO** | `tabs` | B3b Bodegas, B1b, B2a · 7 pantallas |
| `separador` | **RE-ESTILO** | `separator` | Global |
| `tarjeta de trazabilidad` | **DE CERO** | — | P3, P4, B2a, B2b, B6 · 11 pantallas |
| `tarjeta de resultado en bloque` | **DE CERO** | — | P2, B2a, B2b · 6 pantallas |
| `bloque de capacidades` — pierde/gana/sigue sin tener | **DE CERO** | — | B3b Equipo, B6 Equipo · 2 pantallas |
| `panel de ajuste manual` | **DE CERO** | — | B2b · 1 pantalla |
| `atribuidor de pago` | **DE CERO** | — | B2b Cobranza · 1 pantalla |
| `indicador de folio disponible` | **DE CERO** | — | P4, B2a, B3a · 4 pantallas |

**17 componentes · 8 re-estilo · 3 extender · 6 de cero**

---

# 5 · Marco y navegación

| Componente | Costo | Contra qué existente | Pantallas que cubre |
|---|---|---|---|
| `navegación lateral colapsable` | **EXTENDER** | existe una nav propia, sin colapso | Todas las del courier · 46 pantallas |
| `navegación inferior móvil` — 4 destinos por rol | **DE CERO** | — | Courier y portal en 390 · 32 pantallas |
| `navegación anidada de configuración` | **DE CERO** | — | B3b, las 9 de configuración |
| `migas o retorno explícito` | **EXTENDER** | — parcial | 34 pantallas |
| `buscador global con teclado` | **DE CERO** | — hoy existe pero nunca encuentra nada | Courier y backstage · 2 superficies |
| `centro de avisos` | **DE CERO** | — | Global del courier |
| `banner de sesión suplantada` | **DE CERO** | — hoy existe y desaparece en el error | B6, las 13 del backstage |
| `aviso de configuración pendiente` | **EXTENDER** | `alert` | Global del courier hasta cerrar el asistente |

**8 componentes · 0 re-estilo · 3 extender · 5 de cero**

---

# 6 · Retroalimentación y estados de pantalla

| Componente | Costo | Contra qué existente | Pantallas que cubre |
|---|---|---|---|
| `aviso embebido` — 6 tonos | **EXTENDER** | `alert` | 58 pantallas |
| `notificación temporal` | **RE-ESTILO** | `sonner` | 61 pantallas |
| `estado vacío` — 3 tonos, con cifra y hora | **EXTENDER** | `empty-state` | 44 apariciones en 39 pantallas |
| `esqueleto de carga` | **RE-ESTILO** | `skeleton` | 61 pantallas |
| `barra de progreso` | **RE-ESTILO** | `progress` | B3a, B3b, B5, B1c · 9 pantallas |
| `progreso con pasos nombrados` | **DE CERO** | `progress` no nombra pasos | P5, B5 · 5 pantallas |
| `bloque registrado sin confirmar` | **DE CERO** | — nativa | P5, B5 · 6 pantallas |
| `tooltip` | **RE-ESTILO** | `tooltip` | 27 pantallas |
| `avatar` | **RE-ESTILO** | `avatar` | 18 pantallas |
| `verificación previa` | **DE CERO** | — | P4, B2a · 3 pantallas |
| `tarjeta de salud de conexión` | **DE CERO** | — | P7, B3b Sellers, B4, B6 · 6 pantallas |
| `bloque de falla externa` | **DE CERO** | `alert` no alcanza: tres causas indistinguibles | P7, B4 Inicio · 4 pantallas |

**12 componentes · 6 re-estilo · 2 extender · 4 de cero**

---

# 7 · Flujos y patrones compuestos

| Componente | Costo | Contra qué existente | Pantallas que cubre |
|---|---|---|---|
| `asistente por pasos` | **DE CERO** | existe pero no puede completarse | B3a · 1 pantalla, 5 pasos |
| `pantalla de cierre de asistente` | **DE CERO** | — | B3a · 1 pantalla |
| `formulario de configuración` | **EXTENDER** | `card` + `input` | B3b, las 9 de configuración |
| `formulario de alta con aviso en línea` | **EXTENDER** | `dialog` + `input` | B1c, B3b, B4, B6, B7 · 14 pantallas |
| `escalera de fricción` — 3 peldaños | **DE CERO** | `dialog-confirmacion-dinero` cubre un caso | Global · 33 acciones en 21 pantallas |
| `pantalla sin sesión` — 3 casos de marca | **DE CERO** | — | B7, las 12 sin sesión |
| `hoja de consentimiento` — 3 pasos | **DE CERO** | — nativa | B5 Punto de término · 1 pantalla |
| `verificación por escaneo` | **DE CERO** | — nativa | B5 Retiro, traspaso · 3 pantallas |
| `módulo de captura` — cámara + galería múltiple | **DE CERO** | — nativa | P5, B5 · 4 pantallas |
| `secuenciador de ruta` | **DE CERO** | — | B1b Manifiestos · 2 pantallas |
| `redistribución por conductor no disponible` | **DE CERO** | — | B1b · 1 pantalla |

**11 componentes · 0 re-estilo · 2 extender · 9 de cero**

---

# 8 · Sub-sistemas especializados

Cada uno es un frente propio. **La cartografía no hereda de los tokens**: la librería no lee CSS.

| Componente | Costo | Contra qué existente | Pantallas que cubre |
|---|---|---|---|
| `tema de mapa` claro y oscuro | **DE CERO** | — el mapa hoy usa el estilo por defecto | B1a Torre · 2 pantallas |
| `polígono de comuna` con rampa de carga | **DE CERO** | — | B1a · 2 pantallas |
| `punto de entrega` con agrupación | **DE CERO** | — | B1a · 2 pantallas |
| `marcador de conductor` | **DE CERO** | — | B1a · 2 pantallas |
| `mapa degradado` — sin cartografía | **DE CERO** | — hoy se trata como error | B1a · 2 pantallas |
| `gráfico de barras` | **RE-ESTILO** | `chart` | B1c, B2b, B6 · 5 pantallas |
| `gráfico de líneas` | **RE-ESTILO** | `chart` | B1c, B6 · 4 pantallas |
| `paleta categórica de 5 series` | **EXTENDER** | `chart` | 9 pantallas con gráficos |
| `semáforo de cumplimiento` | **DE CERO** | — | B1c, B4 Inicio, B3b Sellers · 4 pantallas |
| `vocabulario de sonido y vibración` — 4 señales | **DE CERO** | — no existe ninguno | B5 Retiro · toda la app |
| `notificación push` — 3 momentos | **DE CERO** | — no existe ni en la app ni en el servidor | B5 · toda la app |
| `solicitud de permiso con explicación previa` — 4 permisos | **DE CERO** | — | P5, B5 · 5 pantallas |
| `etiqueta térmica` 10×15 | **DE CERO** | — | B8 · 1 pieza, 2 formatos |
| `documento PDF carta` | **DE CERO** | — | B8 · 3 piezas |
| `tarjeta de enlace compartido` 1200×630 | **DE CERO** | — | B7 · 1 pieza |
| `línea de tiempo pública` | **DE CERO** | — | B7 Seguimiento · 1 pantalla |
| `plantilla de correo` | **DE CERO** | — | 16 correos |

**17 componentes · 2 re-estilo · 1 extender · 14 de cero**

---

# 9 · Los 30 existentes: qué pasa con cada uno

| Existente | Destino |
|---|---|
| `alert` | Base de `aviso embebido` · **EXTENDER** a 6 tonos |
| `avatar` | **RE-ESTILO** |
| `badge` | Base de `etiqueta`, `procedencia`, `contador` · **RE-ESTILO + EXTENDER** |
| `badge-estado` | **SE REEMPLAZA.** Su modelo de datos no soporta 29 vocabularios ni el eje múltiple |
| `button` | **RE-ESTILO** + variante de peldaño 3 |
| `card` | **RE-ESTILO** |
| `chart` | **RE-ESTILO** + paleta categórica nueva |
| `checkbox` | **RE-ESTILO** + variante táctil de 56 px |
| `data-table` | Base de todas las tablas · **EXTENDER** en selección y densidad |
| `dialog` | **RE-ESTILO** |
| `dialog-confirmacion-dinero` | Base de `modal de acto explícito` · **EXTENDER** a los 3 peldaños |
| `dropdown-menu` | **RE-ESTILO** |
| `empty-state` | **EXTENDER** a 3 tonos con cifra y hora |
| `input` | **RE-ESTILO** + variantes de monto, numérico y búsqueda |
| `kpi-card` | Base de `mosaico de magnitudes` · **RE-ESTILO** |
| `label` | **RE-ESTILO** |
| `monto-clp` | Base de `campo de monto` · **EXTENDER** |
| `pagination` | **RE-ESTILO** |
| `popover` | **RE-ESTILO** |
| `progress` | **RE-ESTILO** · el de pasos nombrados es aparte |
| `select` | **RE-ESTILO** + selección múltiple |
| `separator` | **RE-ESTILO** |
| `sheet` | Base de `panel lateral` y `hoja móvil` · **RE-ESTILO + EXTENDER** |
| `skeleton` | **RE-ESTILO** |
| `sonner` | **RE-ESTILO** · con la regla nueva: **ningún error de dinero va acá** |
| `table` | **RE-ESTILO** |
| `table-skeleton` | **RE-ESTILO** |
| `tabs` | **RE-ESTILO** · la barra de cajones es otro componente |
| `textarea` | **RE-ESTILO** |
| `tooltip` | **RE-ESTILO** |

**29 de los 30 sobreviven.** El único que se reemplaza es `badge-estado`, y es el correcto: es el componente que sostiene el sistema de estado entero.

---

# 10 · Orden de construcción sugerido

No es un plan de proyecto: es la dependencia técnica. Cada bloque desbloquea al siguiente.

| Orden | Bloque | Qué contiene | Desbloquea |
|---|---|---|---|
| **1** | **Tokens y primitivas** | `tokens.css` + los 8 re-estilos de formulario + `interruptor` | Todo |
| **2** | **Estado** | `distintivo de estado`, `inerte con trama`, `procedencia`, `glifo de dirección`, `banderas` | 61 pantallas. **Es la dependencia más ancha del proyecto** |
| **3** | **Tablas** | `selección múltiple`, `barra de cajones`, `selección táctil`, `barra de selección` | P1, P2 y los 7 listados de los bloques |
| **4** | **Marco** | `nav colapsable`, `nav inferior`, `centro de avisos`, `buscador global` | Todas las del courier |
| **5** | **Dinero** | `tabla financiera`, `bloque de composición`, `escalera de fricción`, `verificación previa`, `atribuidor` | Los 5 del bloque 2 y las 4 anulaciones |
| **6** | **App del conductor** | Los 3 temas, `módulo de captura`, `verificación por escaneo`, sonido y vibración, push | Las 12 de B5 y P5 |
| **7** | **Sub-sistemas** | Cartografía, gráficos, impresos, correos | B1a, B8 y los 16 correos |
| **8** | **Sin sesión y sitio** | `pantalla sin sesión`, `tarjeta de enlace`, el sitio comercial | B7 y las 6 páginas del sitio |

**Restricción de realidad que ordena todo esto:** se construye sobre un producto en producción con clientes reales, así que lo nuevo y lo viejo van a convivir meses. El bloque 1 —tokens sobre Tailwind, extendiendo el tema en vez de reemplazarlo— es lo que hace posible esa convivencia. **Ninguna decisión de este catálogo exige que todo cambie el mismo día.**

---

*Fin de la tabla de costo. 100 componentes · 31 re-estilo · 27 extender · 42 de cero.*
