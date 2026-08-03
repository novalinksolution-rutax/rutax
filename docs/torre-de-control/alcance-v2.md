# Torre de control v2 — alcance

**Fuente de verdad del módulo.** Reemplaza al handoff de diseño
(`design_handoff_torre_de_control/`, archivado en `docs/_historico/torre-v1/`) y
al «contrato congelado» de tipos. Definido con el usuario el 2026-08-03.

Documentos hermanos: `docs/arquitectura/torre-de-control.md` (diseño técnico,
con sus secciones superadas ya marcadas) y `docs/arquitectura/mapa-torre-v2.md`
(qué tecnología cartográfica y por qué).

---

## 1. Para qué existe la Torre

El courier opera **same-day**: todo lo que entra tiene que entregarse el mismo
día, contra un corte de ~21:00–22:00. La Torre es la pantalla donde el **dueño y
el coordinador** entran varias veces al día, un par de minutos cada vez, para
responder una sola pregunta: **¿cuántos paquetes me faltan por entregar, en qué
comunas, y hay algo que se esté atascando?** El contador baja durante el día;
mirarlo es ver si el día va a cerrar. Y cuando una entrega falla, su punto se
enciende en rojo y la incidencia aparece en el panel — que es como se cachan el
conductor rezagado o el paquete olvidado **antes** del corte, no al día
siguiente.

La Torre **no ejecuta**: muestra y enlaza. Cada cosa que hay que resolver lleva a
la pantalla donde se resuelve, con el filtro ya puesto.

> **Cambio de eje respecto de la v1.** La v1 era una consola de *anticipación por
> riesgo*: cruzaba clima, aire y prensa con la carga interna y producía un puntaje
> 0–100 por zona. La v2 es una consola de **monitoreo del día en curso**, por
> comuna, en magnitudes que se leen solas. El puntaje sintético se retira entero.

---

## 2. Las funcionalidades que quedan

### F1 · Mapa por comuna, con el contador de pendientes
**Dato:** pedidos del día agrupados por comuna de destino (geocoding ya
existente) · geometría comunal DPA 2023 ya versionada.
**Decisión que soporta:** dónde está concentrado lo que falta.
La comuna es la unidad primaria y la primera vista. La cifra de cada comuna es
**cuántos faltan por entregar** — no un puntaje, no un porcentaje.

**Se muestra como fracción, no como número suelto: «38 de 120».** Un "38" pelado
obliga a recordar de cuánto partió la comuna; la fracción da el avance de un
vistazo sin necesidad de gráfico.

### F2 · Zoom semántico de tres niveles
**Dato:** los mismos pedidos, a distinta granularidad.
**Decisión que soporta:** pasar de «¿dónde duele?» a «¿cuál es exactamente?».

1. **Comuna** — la RM completa, cada comuna con su contador.
2. **Agrupaciones dentro de la comuna** — los paquetes se van desagrupando.
3. **Punto de entrega individual** — un pedido, un punto.

### F3 · Detalle del punto de entrega
**Dato:** código de envío · conductor asignado · pendientes de ese conductor.
**Decisión que soporta:** a quién llamar por este paquete, y con qué número en la
mano.
Al llegar al punto individual se ve el **código de envío**, el **nombre del
conductor** que lo lleva y **cuántos paquetes le faltan a ese conductor**. El
nombre, no el id: el coordinador va a llamar a una persona.

**Sin dirección y sin nombre del destinatario** (decisión del usuario,
2026-08-03). El identificador es el código, que es lo que el coordinador
necesita para buscarlo en `/operaciones` o para nombrárselo al conductor:

| Fuente | Campo | Formato |
|---|---|---|
| Flex | `operacion.pedidos.ml_shipment_id` | el número de envío de Mercado Envíos |
| Same-day | `operacion.pedidos.codigo_interno` | `RX-XXXX-XXXX` (base32 Crockford), el mismo que va en el QR de la etiqueta |

⚠️ **Nunca `tracking_token`.** Es el otro identificador del pedido y es
**público**: viaja en la URL `/tracking/[token]` que se comparte con el
destinatario. No es un identificador operativo y no va en la Torre.

**Agrupación en el mismo punto:** varios pedidos que caen en la misma ubicación
se colapsan en un punto con su cantidad (`+2`, `+5`). Un punto por dirección, no
un punto por paquete — si no, un edificio con seis entregas se ve como una mancha.

**No requiere revisión de `seguridad-cumplimiento`**: un código de envío es un
identificador operativo, no un dato personal del destinatario. Ver §5.6.

### F4 · Incidencias en vivo
**Dato:** incidencias abiertas del módulo `operacion`.
**Decisión que soporta:** cazar el problema mientras todavía hay día para
arreglarlo.
Una entrega que falló pinta su punto **en rojo** en el mapa y aparece como
incidencia en curso en el panel. Es lo único que usa rojo en la pantalla.

### F5 · Actualización automática
**Dato:** el propio flujo de estados de pedido.
**Decisión que soporta:** que el contador que miras sea el de ahora.
La pantalla se actualiza sola, sin recargar. Patrón: Supabase Realtime como
**señal** → `router.refresh()`, que es el que ya usa el tablero de operación (y
que ya está verificado como aislado por RLS, sin filtro de cliente).

### F6 · Frescura, callada
**Dato:** marca de tiempo del último dato incorporado.
**Decisión que soporta:** saber si puedes confiar en el número que estás viendo.
Un solo indicador global, no una marca por punto.

**Callado por defecto:** invisible mientras el dato está fresco, visible —y
molesto— solo cuando pasa el umbral. Es la regla de silencio por defecto (§4.1)
aplicada a la confianza en el dato.

Existe por la consecuencia asumida en §5.7: la Torre **no** distingue Flex de
same-day, y el dato de Flex llega con retraso porque su POD es de Mercado
Envíos. Sin esto, un job de polling atrasado deja la pantalla viéndose perfecta
mientras miente, y el coordinador persigue a un conductor que ya entregó.

### F7 · Proximidad al corte — cálculo interno, sin widget
**Dato:** ventana de corte del día.
**Decisión que soporta:** distinguir «38 pendientes» de «38 pendientes que no
van a alcanzar».

⚠️ **No se dibuja ninguna cuenta regresiva en pantalla** (decisión del usuario,
2026-08-03): el corte del same-day es uno solo y todo el courier lo sabe de
memoria, así que un reloj en la cabecera no informa nada.

Lo que sí queda es **el corte como criterio**: se calcula la proximidad y se usa
para **marcar los pendientes que están cerca de la hora de corte**, en el mapa y
en la lista. La urgencia vive pegada al dato, no en un widget aparte.

*Si algún día los cortes difieren por comuna o por seller, esto se reabre — ahí
ya no se puede saber de memoria y vuelve a necesitar superficie propia.*

### F8 · Contador de pedidos sin ubicar
**Dato:** pedidos sin geocodificar.
**Decisión que soporta:** saber que el mapa no te está mintiendo.
Un mapa que esconde lo que no pudo ubicar miente sobre la carga real. **Una sola
vez en pantalla** (hoy aparece cuatro veces).

### F9 · Olas entrantes (en plural)
**Dato:** `contexto.calendario` + `contexto.eventos_comerciales` (calendario
comercial chileno) y la brecha contra la capacidad configurada.
**Decisión que soporta:** contratar o reservar conductores con días de
anticipación.
Es lo **único** que mira hacia adelante en la v2. Banda de aviso, no región
permanente: si no hay ola dentro del horizonte, no ocupa espacio.

**Cambio respecto de la v1: son varias, no una.** Hoy el contrato tiene
`olaEntrante: OlaEntrante | null` — con CyberMonday y Navidad los dos en
horizonte, solo verías uno. Pasa a **las próximas 2 o 3**: la más cercana
desplegada, el resto como una línea cada una. Es lo que la convierte en
«calendario que me recuerda» en vez de «aviso suelto».

**Qué se muestra de cada ola** (el contrato trae 11 campos; no todos aportan):

| Campo | Destino |
|---|---|
| Nombre + **días para el evento** | **Queda.** Es el gancho: «CyberDay, en 6 días» |
| **Arquetipo** (`venta` / `regalo`) | **Queda — el más importante.** En `venta` las entregas llegan **después** (D+1 a D+5); en `regalo` llegan **antes** y el plazo es duro. Sin esto las fechas engañan |
| **Ventana de entregas** | **Queda.** Es la fecha que importa, distinta de la del evento |
| **Brecha de conductores** + **día crítico** | **Queda — LA cifra accionable.** «El 15 te faltan 4 conductores» |
| Variación esperada (%) | Queda. Orienta de un vistazo y es barato |
| Fuente de la proyección (`catalogo` / `historico_tenant`) | Queda, como letra chica. Señal de confianza: salir del histórico propio del courier se cree; salir de un catálogo genérico se toma con pinzas |
| **Curva** (proyectado vs base vs capacidad) | **Se retira.** Es un gráfico, y dice lo mismo que brecha + día crítico ocupando diez veces el espacio |
| Fecha límite de compra por zona | **Se retira de la Torre.** Le sirve al **seller** para su publicidad, no al courier para despachar |
| Hitos de preparación | **Pendiente de revisar en implementación.** Si son acciones con fecha («contrata refuerzo antes del 10») valen mucho; si son texto genérico, sobran |
| Organizador (Mercado Libre, etc.) | Queda pegado al nombre. Trivial |

**También va al dashboard, adaptada** (ver F12): el dueño entra ahí, no a la
Torre. Versión mínima: nombre + días + brecha de conductores, en una línea.

### F10 · Equivalente sin mapa
**Dato:** los mismos de F1.
**Decisión que soporta:** las mismas, sin depender del render.
Lista de comunas ordenada por cuántas faltan, navegable con teclado.

**Alcance reducido respecto de la v1.** Nació como el equivalente accesible **y**
la vista de celular; con el móvil fuera de este repo le queda solo el rol de
degradación (si no carga la geometría o el basemap) y de lectura rápida. Sigue
valiendo la pena, pero **no es una superficie co-igual** y no debe llevarse la
mitad del esfuerzo de la pantalla.

### F11 · Enlaces profundos a donde se actúa
**Dato:** n/a.
**Decisión que soporta:** todas — la Torre no ejecuta ninguna.
Cada comuna, incidencia, conductor y pedido lleva a la pantalla donde se
resuelve, **con el filtro ya aplicado**. Es la contrapartida de que la Torre sea
de solo lectura: si obliga a buscar de nuevo en la otra pantalla, no sirve.

**Solo módulos existentes — no se inventa ninguno.** Los destinos son
`/operaciones`, `/manifiestos`, `/conductores` y `/dinero`, que ya existen.

**Autorizado modificar la pantalla de destino si le falta el filtro** (decisión
del usuario, 2026-08-03). Si `/operaciones` no filtra por comuna, se le agrega:
es una adición acotada a una pantalla existente, no un módulo nuevo. Verificar
qué filtros faltan es parte del trabajo, no una sorpresa.

### F12 · Banda de la Torre en el dashboard
**Dato:** el mismo composer.
**Decisión que soporta:** enterarse sin entrar.
`(tenant)/dashboard/banda-torre.tsx` ya existe, está bien calibrada y muestra
tres líneas con un enlace **solo si hay algo que mirar** — si el día va bien no
ocupa espacio, y si la Torre falla desaparece en vez de romper el dashboard. Esa
mecánica se conserva tal cual.

**Se reescribe el contenido**, porque hoy habla de riesgo, zonas y cortes, y los
tres se retiran. En la v2 dice **comunas + pendientes + incidencias**.

**Y aloja la ola adaptada** (F9): el dueño entra al dashboard, no a la Torre, así
que es el lugar natural para el aviso de anticipación.

### F13 · Panel de conductores rezagados
**Dato:** entregas completadas vs asignadas por conductor, y tiempo desde la
última entrega registrada.
**Decisión que soporta:** a quién llamar **antes** del corte.
Es el objetivo declarado del módulo —cazar al conductor rezagado o el paquete
olvidado— y F1–F4 no lo cubrían: trabajan en **comuna**, y una comuna puede verse
bien en agregado mientras un conductor adentro está trabado.

> Pérez · 12 de 40 · **sin registrar entrega hace 1 h 20**

Esa última línea es el detector. **No necesita GPS** —decisión ya tomada, no se
guarda recorrido—: se calcula con marcas de tiempo de entregas, que ya existen.
Ordenado por riesgo de no terminar, no alfabético.

---

## 3. Lo que se retira

| Se retira | Por qué |
|---|---|
| **Puntaje de riesgo 0–100 y sus 6 factores** | La cifra que el usuario quiere es «cuántos faltan». Un puntaje sintético obliga a aprender una escala para decir menos. |
| **Clima como capa y como factor** | Decisión del usuario: eso se ve desde el teléfono del conductor y en terreno. |
| **Aire (PM2.5) como capa y como factor** | Igual que el clima. |
| **Señales de prensa (R6)** | Pipeline muerto: Google News RSS prohíbe uso comercial, GDELT no cubre Chile, SENAPRED solo desastres naturales. 0 filas y ningún escritor. |
| **Zona como unidad primaria del mapa** | El usuario reconoce comunas, no «Sur / Oriente». La zona sigue existiendo detrás (cortes, conductores, capacidad), pero no manda el mapa. |
| **Línea de tiempo (R5)** | Mezclaba lluvia, eventos y ventanas de reparto. Sin clima ni eventos, queda vacía. |
| **Cuenta regresiva al corte, como widget** | El corte del same-day es uno solo y todo el courier lo sabe de memoria. Sobrevive como **cálculo interno** que marca lo que está cerca del corte (F7), no como reloj en pantalla. |
| **La curva de la ola** (proyectado vs base vs capacidad) | Es un gráfico y dice lo mismo que brecha de conductores + día crítico, ocupando diez veces el espacio. |
| **Fecha límite de compra por zona** (ola arquetipo `regalo`) | Es información para que el **seller** planifique su publicidad, no para que el courier despache. |
| **Proyección de hora de cierre por comuna** | Se evaluó y el usuario la descartó (2026-08-03): sumaba una cifra derivada a una pantalla que quiere ser simple. |
| **Marcas operativas manuales** | 0 filas pese a estar construida entera. Y es una **escritura**, incompatible con una Torre de solo lectura. |
| **Variación contra la semana anterior** | Una cifra más en una pantalla que tiene que leerse en dos minutos. |
| **Tope de 2 capas activas** | Existía para que el mapa no se saturara de capas de ambiente. Sin esas capas, no hay nada que topear. |
| **Conmutador de capas** | Ídem. |
| **⌘K / paleta de comandos** | Nunca existió (estaba declarada con presupuesto de 120 ms y dos piezas del reducer construidas para servirla). Y una pantalla de dos minutos no se navega con paleta. |
| **Atajos de teclado (1–4, L, M)** | Se justificaban para quien vive 8 horas en la pantalla. No es el caso. |
| **Selector de horizonte (hoy / mañana / 72 h)** | Solo queda hoy. El de 72 h se veía casi vacío por diseño; en same-day estaría vacío siempre. |
| **Las tres franjas del día (mañana/tarde/punta)** | Eran cómo se colapsaba el riesgo. Sin riesgo, no hay franjas: hay un contador que baja continuo. |
| **Árbol de componentes móviles** | El móvil se resuelve fuera de este repo, en la app nativa. Hoy hay dos árboles paralelos en el mismo DOM; mantenerlos cuesta la mitad de los componentes del módulo. |
| **Fallback a 5 macro-zonas de la RM** | Con la comuna como unidad, no hace falta: las comunas de la RM existen siempre, configure o no el courier sus zonas. |
| **Los 3 contadores duplicados de «sin ubicar»** | Se consolidan en F8. |
| **Escala cromática / tramas de riesgo de 45°** | Sin puntaje no hay escala que pintar. El único color con significado pasa a ser el rojo de incidencia. |

---

## 4. Reglas de producto de la v2

Sobreviven dos de las siete del handoff, y se agregan cuatro.

1. **El silencio es el estado normal.** Un día que va bien se dice en una línea.
   No se llena la pantalla de tarjetas para justificar el módulo. *(sobrevive)*
2. **El color nunca es el único canal.** Todo lo que se distingue por color trae
   además su cifra o su palabra. *(sobrevive)*
3. **La cifra es una magnitud, nunca un índice.** «38 de 120 pendientes», no «73
   de riesgo». Si hace falta explicar la escala, la cifra está mal elegida.
   *(nueva)*
4. **El rojo está reservado a la incidencia abierta.** Es lo único accionable de
   la pantalla. Nada decorativo puede usarlo. *(nueva, hereda el espíritu del
   `#ec3013` reservado del handoff)*
5. **El mapa nunca esconde carga.** Lo que no se pudo ubicar se declara (F8). Un
   contador que no cuadra con la operación real destruye la confianza en toda la
   pantalla. *(nueva, absorbe la regla 5 del handoff)*
6. **La Torre no ejecuta.** Solo lee y enlaza. Cualquier propuesta de acción
   desde la Torre reabre RBAC y bitácora de auditoría, y es una decisión nueva.
   *(nueva)*

---

## 5. Consecuencias técnicas

⚠️ **Nada de esto se implementa en esta pasada.** Es el inventario de lo que
queda sin uso, para la sesión de implementación.

### 5.1 Tablas del esquema `contexto` (11 hoy)

| Tabla | Destino |
|---|---|
| `clima_horario` | **Se retira** — clima apagado |
| `aire_horario` | **Se retira** — aire apagado |
| `eventos_ciudad` | **Se retira** — 0 filas, ningún escritor |
| `senales` | **Se retira** — pipeline de prensa muerto |
| `senales_tenant` | **Se retira** — ídem |
| `marcas_operativas` | **Se retira** — 0 filas; además es escritura |
| `riesgo_zona` | **Se retira** — no hay puntaje que persistir, y el contador se lee en vivo |
| `calendario` | **Se conserva** — alimenta F9 |
| `eventos_comerciales` | **Se conserva** — alimenta F9 |
| `fuentes_estado` | **Se conserva, reducida** — ver 5.4 |
| `restriccion_vehicular` | **Sin consumidor en la v2.** La alimenta el job de calendario, no OpenWeather. Se conserva la tabla (es barata y es un hecho de flota), pero deja de mostrarse. **Decisión abierta** para la implementación. |

### 5.2 Jobs (`src/modules/contexto/jobs/`)

- `refrescar-clima.ts` → **se retira**
- `refrescar-aire.ts` → **se retira**
- `recalcular-riesgo.ts` → **se retira.** Con lectura en vivo, el cron de 15
  minutos deja de tener sentido. *(Ojo: hay un cambio sin commitear en este
  archivo, ajeno a esta sesión — resolverlo antes de tocarlo.)*
- `sincronizar-calendario.ts` → **se conserva** (F9)
- `fuentes-estado.ts` → **se conserva, reducido**

### 5.3 Adaptadores (`src/modules/integraciones/contexto/`, ~35 archivos)

- `clima/`, `aire/`, `openweather-comun.ts`, `grilla-rm.ts` (los 14 puntos de
  grilla) → **se retiran**. Con ellos cae la dependencia de OpenWeather y su
  atribución en pantalla.
- `calendario/` → **se conserva**.
- `http.ts`, `resultado.ts`, `errores.ts`, `puertos.ts` → **se conservan**: son
  la infraestructura del puerto, no del proveedor.

### 5.4 El efecto secundario que se corrige de paso

Hoy `contexto.fuentes_estado` declara `senales` y `transito` **caídas de forma
permanente**, y por eso **la Torre abre siempre en estado `degradado`** — por dos
fuentes que se decidió no construir. Al retirarlas, la Torre pasa a abrir en su
estado real.

### 5.5 Módulo `contexto` y composer

- `motor-riesgo.ts` (+ ~70 tests) → **se retira entero**.
- `macro-zonas-rm.ts` → **se retira** (ver §3).
- `agregacion.ts` → **se reescribe**: agrega por **comuna**, no por zona.
- `olas.ts` → **se conserva** (F9).
- `contrato-torre.ts` → **se reescribe**. Ya no es contrato congelado: es un tipo
  vivo. Cae `TorreRespuesta.horizontes` (queda un solo horizonte). **`olaEntrante:
  OlaEntrante | null` pasa a una lista** de 2–3 (F9), y de `OlaEntrante` caen
  `curva` y `fechaLimiteCompraPorZona`.
- **Consulta nueva para F13** (conductores rezagados): entregas completadas vs
  asignadas por conductor + minutos desde la última entrega registrada. Sale de
  `operacion`, no necesita tabla nueva ni ping de ubicación.
- **Filtros en las pantallas de destino** (F11): verificar cuáles faltan —
  probablemente filtrar `/operaciones` por comuna y por conductor. Es una adición
  acotada a pantallas existentes, autorizada por el usuario, pero es trabajo real
  y hay que presupuestarlo.
- `composer/armado-mapa.ts`, `armado-riel.ts`, `armado-zonas.ts` → **se
  reescriben** contra el contrato nuevo.
- ⚠️ **`(tenant)/dashboard/banda-torre.tsx` consume `cargarTablero`.** Migra en
  el mismo cambio. No se rompe.

**¿Sigue justificándose `contexto` como módulo aparte?** Sí — se conserva. Pierde
el contexto externo, pero conserva un dominio propio (el calendario comercial y
la proyección de olas) y la agregación de anticipación. El límite de importación
en un solo sentido —`operacion` y `dinero` **no** pueden importar `contexto`—
sigue siendo valioso y no cuesta nada mantenerlo; y la Torre leyendo en vivo de
`operacion` va en la dirección permitida. Absorberlo en `operacion` sería un
refactor sin premio. Lo que sí cambia es su descripción: de «contexto externo» a
**anticipación y agregación operativa**.

### 5.6 Datos personales — la v2 NO amplía la exposición

**Resuelto el 2026-08-03: la Torre v2 no muestra ni dirección ni nombre del
destinatario.** F3 se resolvió con el **código de envío**, que es un
identificador operativo del paquete y no un dato personal de nadie. En
consecuencia **no hay gate de `seguridad-cumplimiento`** para este módulo: la v2
no expone nada que el producto no exponga ya en `/operaciones`.

Las dos minimizaciones vigentes se mantienen intactas:

- **Destinatario:** el mapa sigue llevando solo punto, estado y ahora código. Sin
  dirección, sin nombre, sin teléfono.
- **Conductor (Ley 21.431):** **no se guarda recorrido.** El usuario fue
  explícito («no digo que tenga que ver el conductor con GPS»). El modelo sigue
  con una sola fila por conductor —la última posición, sin histórico— y F1–F12 no
  la tocan.

Si alguna vez se propone volver a poner la dirección en el mapa, **eso sí reabre
la revisión**. Queda dicho para que nadie lo cuele como un detalle.

### 5.7 Riesgo asumido: la Torre no distingue la fuente del pedido

Decisión del usuario, tomada con la consecuencia sobre la mesa: **Flex y same-day
se cuentan juntos, sin distinguir.** En same-day el POD es de Rutax y la entrega
aparece al instante; en Flex la verdad la tiene la app de Mercado Envíos y Rutax
se entera con retraso. El contador de una comuna con carga Flex, por lo tanto,
va atrasado respecto de la realidad.

Mitigación acordada, que no contradice la decisión: **F6, el indicador global de
frescura**. Un solo dato en la cabecera, para que el contador nunca mienta en
silencio, sin ensuciar la lectura punto a punto.

*Matiz sin consecuencia de diseño:* el **código de envío de F3 delata su origen**
por el formato (un id de Mercado Envíos no se parece a un `RX-XXXX-XXXX`). No
contradice la decisión — nadie agrupa ni cuenta por fuente; simplemente el
identificador es el que es.

### 5.8 La Torre baja a `(tenant)` y `(consola)` se retira

**Decisión del usuario (2026-08-03), que revierte la de la v1.** La Torre deja de
ser una consola de viewport fijo y pasa a ser **un módulo más del SaaS**: dentro
de `(tenant)`, con el `AppShell`, el mismo sidebar y la misma navegación que
cualquier otra pantalla. El mapa va **grande, pero acotado** —una altura
definida, no el viewport entero— y con un **botón de pantalla completa** para
cuando se quiera mirar en serio.

Consecuencias:

- **El grupo de rutas `src/app/(consola)/` se retira entero.** La Torre era su
  único ocupante; `src/app/` vuelve a tener cinco destinos. Con él se va la
  duplicación de guards de `(consola)/layout.tsx`, que repetía los de
  `(tenant)/layout.tsx`.
- **La regla general del repo deja de tener excepción**: *toda* pantalla del
  courier vive en `(tenant)`. Esto simplifica CLAUDE.md, no solo el código.
- **El `max-w-6xl` del `<main>` es el punto a resolver** en la implementación: el
  mapa necesita más ancho que el resto del backoffice. Se resuelve dejando que
  esta pantalla se salga del `max-w` (no quitándoselo a todas), y es un detalle de
  layout, no de arquitectura.
- **Pantalla completa** con la Fullscreen API sobre el contenedor del mapa. No es
  una ruta nueva ni un layout nuevo: es estado local de la pantalla.
- Sin cambio de RBAC ni de guards: `(tenant)/layout.tsx` ya impone los mismos que
  imponía `(consola)`, y `ver_torre_control` sigue gateando la pantalla.

*Nota honesta: la recomendación de esta sesión había sido quedarse en
`(consola)`. La decisión del usuario es además la que deja el repo más simple —
elimina un grupo de rutas y una duplicación de guards a cambio de un ajuste de
ancho.*

### 5.9 Lo que NO cambia

- **RBAC:** `ver_torre_control` (dueño, supervisor, coordinador) sigue igual, de
  lectura. Al no escribir, no hay capacidad nueva ni bitácora de auditoría.
- **Aislamiento:** las tablas de referencia de `contexto` siguen siendo deny-all
  para sesiones de usuario; toda tabla que crezca al dar de alta un courier
  lleva `tenant_id`.
- **Cartografía:** `scripts/mapa/`, el bucket `contexto-mapas` y
  `public/mapas/comunas-rm.topojson.json` se conservan. MapLibre sigue clavado en
  **5.24.0** exacto. Detalle en `docs/arquitectura/mapa-torre-v2.md`.
- **Atribuciones:** `© OpenStreetMap` y `Límites DPA 2023 · SUBDERE/INE` se
  quedan (condición de licencia). **La de OpenWeather se retira**, pero solo
  cuando no quede ningún dato de OpenWeather en el producto.

### 5.10 Andamiaje a retirar

`_fixture/estado-torre.ts` y `_fixture/variantes.ts` (la copia del contrato
congelado más el `?estado=` para revisar las capturas del handoff) los importan
~20 componentes. Se retiran en la pasada de implementación, no antes.

---

## 6. Lo que queda abierto

**Para la sesión de rediseño visual:**
- Paleta, tipografía y retícula. Los 12 tokens `--tc-*` de `src/app/globals.css`
  vienen del handoff retirado: su destino lo decide esa sesión, no ésta.
- **Tema claro y oscuro**, siguiendo el tema del sistema (decisión ya tomada).
- Cómo se ve el escalón entre los tres niveles de zoom de F2.
- Referencia declarada de «premium»: **Uber / Rappi**, y específicamente la
  calidad cartográfica y tipográfica del plano — no 3D ni cámara inclinada.

**Para la sesión de implementación:**
- Cómo se resuelve el ancho: la pantalla tiene que salirse del `max-w-6xl` del
  `<main>` de `(tenant)` sin quitárselo al resto del backoffice (§5.8).
- A qué altura queda el mapa «grande pero no tanto», y el comportamiento del
  botón de pantalla completa.
- Cuándo colapsar los puntos que comparten ubicación en el `+N` de F3 — por
  coordenada exacta o por radio.
- **Los hitos de preparación de la ola** (`HitoPreparacion[]`): mirar qué traen.
  Si son acciones con fecha, se quedan; si es texto genérico, caen (§F9).
- Umbral de F6: a partir de cuántos minutos el indicador de frescura deja de
  estar callado y molesta.
- Umbral de F13: cuántos minutos sin registrar entrega marcan a un conductor
  como rezagado. Debe salir de datos reales, no de una corazonada.
- Destino de `contexto.restriccion_vehicular` (§5.1).
- El cambio sin commitear en `jobs/recalcular-riesgo.ts` (§5.2) — el usuario
  decidió seguir sin resolverlo por ahora; resolverlo al retirar el job.
- Orden del trabajo sugerido: `arquitecto` (contrato nuevo comuna-first) →
  `base-datos-rls` (retiro de tablas) → `backend` (composer + realtime) →
  `frontend` (pantalla) → `qa`.

**Ya no está abierto:**
- ~~`(consola)` vs `(tenant)`~~ → resuelto: baja a `(tenant)` y `(consola)` se
  retira (§5.8).
- ~~Gate de `seguridad-cumplimiento` por la dirección del destinatario~~ →
  resuelto: no se muestra dirección, se muestra código de envío (§5.6).
