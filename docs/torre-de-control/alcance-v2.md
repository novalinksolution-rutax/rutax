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

### F2 · Zoom semántico de tres niveles
**Dato:** los mismos pedidos, a distinta granularidad.
**Decisión que soporta:** pasar de «¿dónde duele?» a «¿cuál es exactamente?».

1. **Comuna** — la RM completa, cada comuna con su contador.
2. **Agrupaciones dentro de la comuna** — los paquetes se van desagrupando.
3. **Punto de entrega individual** — un pedido, un punto.

### F3 · Detalle del punto de entrega
**Dato:** dirección del pedido · conductor asignado · pendientes de ese conductor.
**Decisión que soporta:** a quién llamar por este paquete.
Al llegar al punto individual se ve **la dirección de la entrega**, **qué
conductor la lleva** y **cuántos paquetes le faltan a ese conductor**.
⚠️ **Bloqueado por revisión previa** — ver §5.6: mostrar la dirección del
destinatario amplía lo que el producto expone de datos personales y tiene que
pasar por `seguridad-cumplimiento` antes de construirse.

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

### F6 · Indicador global de frescura
**Dato:** marca de tiempo del último dato incorporado.
**Decisión que soporta:** saber si puedes confiar en el número que estás viendo.
Un solo indicador en la cabecera («al día hace 2 min»), no una marca por punto.
Existe por la consecuencia asumida en §5.5: la Torre **no** distingue Flex de
same-day, y el dato de Flex llega con retraso.

### F7 · Cuenta regresiva al corte
**Dato:** ventana de corte del día.
**Decisión que soporta:** convertir un número en urgencia. 38 pendientes a las
15:00 es normal; a las 20:30 es una emergencia.
Va en la **cabecera**, una sola vez para todo el día — no por comuna.

### F8 · Contador de pedidos sin ubicar
**Dato:** pedidos sin geocodificar.
**Decisión que soporta:** saber que el mapa no te está mintiendo.
Un mapa que esconde lo que no pudo ubicar miente sobre la carga real. **Una sola
vez en pantalla** (hoy aparece cuatro veces).

### F9 · Ola entrante
**Dato:** `contexto.calendario` + `contexto.eventos_comerciales` (calendario
comercial chileno) y la brecha contra la capacidad configurada.
**Decisión que soporta:** contratar o reservar conductores con días de
anticipación.
Es lo **único** que mira hacia adelante en la v2, y por eso se conserva: «en 6
días llega el peak de CyberDay, te faltan N conductores». Banda de aviso, no
región permanente: si no hay ola dentro del horizonte, no ocupa espacio.

### F10 · Equivalente sin mapa
**Dato:** los mismos de F1.
**Decisión que soporta:** las mismas, sin depender del render.
Lista de comunas ordenada por cuántas faltan, navegable con teclado. No es un
premio de consuelo: es el modo de degradación cuando la geometría o el basemap
no cargan, y es también lo que se lee más rápido.

### F11 · Enlaces profundos a donde se actúa
**Dato:** n/a.
**Decisión que soporta:** todas — la Torre no ejecuta ninguna.
Cada comuna, incidencia y pedido lleva a `/operaciones` con el filtro ya
aplicado. Es la contrapartida de que la Torre sea de solo lectura: si obliga a
buscar de nuevo en la otra pantalla, no sirve.

### F12 · Banda de la Torre en el dashboard
**Dato:** el mismo composer.
**Decisión que soporta:** enterarse sin entrar.
`(tenant)/dashboard/banda-torre.tsx` ya existe, está bien calibrada y muestra
tres líneas solo si hay algo que mirar. **Se conserva y se migra junto con el
composer** — no se rompe.

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
  vivo. Cae `TorreRespuesta.horizontes` (queda un solo horizonte).
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

### 5.6 Datos personales — gate obligatorio

**F3 (dirección del destinatario en el punto del mapa) no se construye sin la
revisión de `seguridad-cumplimiento`.** Hoy el mapa lleva a propósito solo punto
y estado, sin dirección ni nombre, por minimización de PII. F3 amplía eso y es
exactamente el caso que la regla del proyecto obliga a revisar antes.

Lo que **no** cambia y conviene dejar dicho: **no se guarda recorrido del
conductor.** El usuario fue explícito («no digo que tenga que ver el conductor
con GPS»). El modelo sigue con una sola fila por conductor, la última posición,
sin histórico — minimización bajo la Ley 21.431. Esa decisión se mantiene y F1–F12
no la tocan.

### 5.7 Riesgo asumido: la Torre no distingue la fuente del pedido

Decisión del usuario, tomada con la consecuencia sobre la mesa: **Flex y same-day
se cuentan juntos, sin distinguir.** En same-day el POD es de Rutax y la entrega
aparece al instante; en Flex la verdad la tiene la app de Mercado Envíos y Rutax
se entera con retraso. El contador de una comuna con carga Flex, por lo tanto,
va atrasado respecto de la realidad.

Mitigación acordada, que no contradice la decisión: **F6, el indicador global de
frescura**. Un solo dato en la cabecera, para que el contador nunca mienta en
silencio, sin ensuciar la lectura punto a punto.

### 5.8 Lo que NO cambia

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

### 5.9 Andamiaje a retirar

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
- ¿La Torre se queda en `(consola)` o baja a `(tenant)`? Vivía en `(consola)` por
  fidelidad al handoff. El uso real —dos minutos, varias veces al día— apuntaría
  a `(tenant)`; pero el usuario pidió expresamente «el mapa en grande», y eso es
  incompatible con el `AppShell` (`max-w-6xl` + scroll de página).
  **Recomendación: quedarse en `(consola)`**, retirando lo que se justificaba
  solo para quien vive en la pantalla (atajos, ⌘K, tope de capas).
- Destino de `contexto.restriccion_vehicular` (§5.1).
- El cambio sin commitear en `jobs/recalcular-riesgo.ts` (§5.2).
- Orden del trabajo sugerido: `arquitecto` (contrato nuevo comuna-first) →
  `base-datos-rls` (retiro de tablas) → `backend` (composer + realtime) →
  `frontend` (pantalla) → `qa`. Y `seguridad-cumplimiento` **antes** de F3.
