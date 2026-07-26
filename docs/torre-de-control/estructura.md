# Torre de control — estructura de información

Compañero de [`datos-dummy.ts`](datos-dummy.ts).

**Este documento no decide nada visual.** No hay colores, tipografías, espaciados
ni layout. Define qué información existe, cómo se jerarquiza, qué estados hay que
resolver y qué debe hacer cada gesto. La interfaz se diseña aparte y con
libertad total.

> El lenguaje visual que había propuesto está en
> [`lenguaje-visual.md`](lenguaje-visual.md). Queda como una opción, no como una
> restricción.

---

## 1. Las tres preguntas

Todo lo que va en pantalla responde a una de estas tres, en orden. Si un elemento
no responde a ninguna, sobra.

| Nivel | Pregunta | Qué la responde |
| --- | --- | --- |
| 1 | **¿Dónde?** | El mapa, con las zonas y su puntaje de riesgo |
| 2 | **¿Por qué?** | El desglose de factores de la zona seleccionada |
| 3 | **¿Qué hago?** | La lista de pedidos afectados y la acción sugerida |

Nada del nivel 2 debe estar visible antes de que el usuario pida el nivel 2.

---

## 2. Regiones

Seis regiones. La disposición espacial es decisión del diseño; lo fijo es qué
contiene cada una y su prioridad.

### R1 — Identidad y control temporal
`ESTADO_TORRE.horizonte`, `ESTADO_TORRE.frescura`

- Nombre del módulo y del courier.
- **Selector de horizonte**: Hoy · Mañana · 72 h · Olas. Cambia toda la pantalla.
- **Frescura por fuente**: cada fuente con su edad en minutos y su estado
  (`ok` / `atrasada` / `caida`). Una fuente caída se marca con su motivo; nunca
  desaparece en silencio.
- Acceso a la paleta de comandos.

Prioridad: media. Es orientación, no contenido.

### R2 — Ola entrante (condicional)
`ESTADO_TORRE.olaEntrante`

Solo aparece si hay una ola dentro del horizonte de preparación. Contiene:

- Nombre del evento comercial y su fecha.
- **Arquetipo**, que cambia el significado de todo lo demás:
  - `venta` → las entregas llegan **después** (D+1 a D+5).
  - `regalo` → las entregas llegan **antes** y el plazo es duro.
- Ventana de entregas proyectada y día del peak.
- Variación esperada de volumen.
- **Brecha de conductores del día crítico** — el número accionable.
- La curva por día (`olaEntrante.curva`): proyectado vs. base vs. capacidad.

Si `olaEntrante` es `null`, la región no se renderiza. No dejar un hueco.

### R3 — Mapa
`zonas`, `capas`, `conductores`, `celdasClima`, `eventosCiudad`, `incidentesTransito`, `marcasOperativas`

La región dominante. Tres niveles de zoom semántico (`zoom`):

1. `zonas` — las zonas del courier, coloreadas por riesgo.
2. `comunas` — los límites y nombres comunales.
3. `pedidos` — puntos individuales agrupados.

Controles superpuestos: conmutador de capas, leyenda de la escala, zoom.

**Regla de producto:** máximo `MAX_CAPAS_ACTIVAS` (2) capas encendidas. Al llegar
al tope, el resto se deshabilita visiblemente en vez de fallar en silencio. Una
capa cuya fuente está caída aparece deshabilitada con su motivo, no oculta.

Prioridad: máxima.

### R4 — Riel de excepciones
`metricas`, `excepciones`, `zonaSeleccionada`

Tres bloques apilados:

1. **Métricas** (`metricas`) — cuatro cifras con su variación y su detalle.
2. **Excepciones** (`excepciones`) — ordenadas por severidad. Cada una lleva:
   título, cuerpo explicativo, zona, ventana, pedidos y monto afectados,
   **acciones sugeridas**, y —si viene de prensa— su nivel de confianza y las
   fuentes que la reportan.
3. **Desglose de zona** — reemplaza al listado cuando hay `zonaSeleccionada`.
   Muestra los seis factores con su valor, su peso y su explicación en prosa.

Una acción con `requiereConfirmacion: true` no se ejecuta al primer clic.

Prioridad: alta. Es donde el usuario actúa.

### R5 — Línea de tiempo
`timeline`, `rangoTimeline`, `ahora`

Franja temporal del horizonte activo. Bloques de cinco tipos
(`ventana_reparto`, `clima`, `evento`, `corte_en_riesgo`, `restriccion`) que
pueden solaparse — cada uno trae un `carril` sugerido. El marcador de `ahora` se
desplaza de forma continua.

Prioridad: media. Responde "cuándo", no "qué hacer".

### R6 — Señales de prensa
`senales`

Acontecimientos detectados en medios. **Una tarjeta por acontecimiento, nunca
por artículo**: varios medios reportando lo mismo son una sola señal con mayor
confianza. Cada señal trae sus fuentes con medio, titular y enlace.

Solo entran las que tienen `afectaOperacion: true` y `pedidosEnRango > 0`. El
resto vive en una lista secundaria a la que se entra a propósito.

Cada señal se puede confirmar o descartar (`marcaHumana`); eso calibra el filtro.

Prioridad: baja-media. Es contexto, no urgencia.

---

## 3. Estados obligatorios

`EstadoPantalla` y `MENSAJES_ESTADO`. No son casos borde: son estados de primera
clase y cada uno necesita su propio tratamiento.

| Estado | Qué debe pasar |
| --- | --- |
| `con_excepciones` | El caso completo. Todas las regiones con datos. |
| `tranquilo` | **Se dice en una línea y la pantalla se calla.** No llenar de tarjetas para justificar el módulo. |
| `cargando` | Cada región llega por separado; ninguna bloquea a otra. Sin spinner de página completa. |
| `degradado` | Una o más fuentes caídas. Se marca la capa afectada con su motivo; el resto sigue operando. |
| `sin_zonas` | Fallback a las cinco macro-zonas de la RM + invitación explícita a configurar. |
| `sin_pedidos` | Sin operación hoy. Se ofrece la ola entrante como siguiente foco. |

Además, siempre visible: **`pedidosSinGeocodificar`**. Un mapa que esconde los
pedidos que no pudo ubicar miente sobre la carga real.

---

## 4. Interacciones

`INTERACCIONES` en el archivo de datos trae las diez con su presupuesto de
respuesta en milisegundos. Los presupuestos son de **latencia percibida**, no de
animación: cuánto puede tardar el usuario en ver que algo pasó.

Las tres que definen el módulo:

- **Seleccionar zona** → las demás se atenúan y el riel cambia al desglose.
- **Clic en un factor** → lista de pedidos afectados por ese factor.
- **Cambiar horizonte** → todo el tablero cambia. Los tres horizontes vienen
  precalculados, así que es cambio de estado, no una consulta nueva.

Hay atajos de teclado definidos para horizonte (`1`–`4`), paleta (`Cmd+K`),
marcar evento (`M`) y vista de lista (`L`). Quien vive en esta pantalla no quiere
buscar botones.

---

## 5. Accesibilidad y pantallas chicas

- **Equivalente sin mapa obligatorio**: lista de zonas ordenada por riesgo,
  navegable con teclado, sobre exactamente los mismos datos. No es un premio de
  consuelo — es también la vista de celular.
- El color nunca puede ser el único canal. Toda escala cromática va acompañada
  del valor numérico.
- En móvil el mapa **cede el protagonismo**: el coordinador en el celular quiere
  la lista de excepciones. No hay que meter el mapa completo en 390 px.

---

## 6. Datos que no están y por qué

- **Geometría de las zonas y comunas**: no va en el dataset. Son polígonos
  oficiales (DPA 2023 de IDE Chile / SUBDERE) que se cargan como GeoJSON aparte.
  El dataset solo trae el `centro` de cada zona, para etiquetas y encuadre.
- **Puntos de pedidos individuales**: se generan del lado servidor a partir del
  geocoding real. En el dummy solo están los agregados por zona.
- **Patentes de la flota**: el modelo de datos todavía no las guarda, por eso
  `RestriccionVehicular.vehiculosAfectados` es `null`. Cuando exista el campo, la
  alerta pasa de genérica ("hoy restringe 6 y 7") a específica ("3 de tus
  conductores quedan fuera").
