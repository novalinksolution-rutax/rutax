# Torre de control — módulo de anticipación operativa

Diseño del módulo para el dueño / coordinador del courier: una pantalla única con
el mapa de la Región Metropolitana que cruza **señal externa** (clima, aire,
tránsito, eventos) con la **carga interna** (pedidos, zonas, conductores, SLA) y
la traduce a **impacto en dinero**.

Escrito el 2026-07-25 como diseño de la v1. Implementado. **En rediseño v2 desde
el 2026-08-03.**

> ## Qué de este documento sigue mandando (2026-08-03)
>
> El módulo entró en rediseño. La fuente de verdad de **producto** es
> `docs/torre-de-control/alcance-v2.md`. Este documento sigue siendo la fuente de
> verdad **técnica**, pero solo en parte:
>
> **Vigente:**
> - §1–§3 — qué es el módulo, decisiones de encuadre y qué reutiliza del repo.
> - §5 — modelo de datos: esquema `contexto`, su carve-out deny-all y `tenant_id`
>   en las tablas de negocio (`riesgo_zona`, `marcas_operativas`).
> - §6 — adaptadores como puertos aislados, jobs y sus cadencias.
> - §7 — el motor de riesgo **como pieza de arquitectura** (dónde vive, cómo se
>   invoca, cómo persiste). ⚠️ Sus **pesos y factores** están en revisión: el
>   rediseño decide si clima y aire salen del puntaje (ver `alcance-v2.md`).
> - El pipeline de cartografía: `scripts/mapa/README.md` y
>   `public/mapas/comunas-rm.topojson.json`.
>
> **Superado — no lo sigas:**
> - **§4 (fuentes externas).** Corregido dos veces por la realidad. Lo cierto
>   está en las correcciones fechadas de la propia sección y en CLAUDE.md.
> - **§8 (pantalla) entera.** Regiones, capas del mapa, zoom semántico,
>   interacciones y estados de pantalla se redefinen en `alcance-v2.md`.
> - **§8.8 (SVG vs MapLibre): resuelto.** Ganó MapLibre + PMTiles. Y la elección
>   de motor cartográfico se vuelve a evaluar, con su propio entregable, en
>   `docs/arquitectura/mapa-torre-v2.md`.
> - **§13 (señales de prensa): pipeline muerto.** Sus fuentes están bloqueadas
>   por licencia o por falta de cobertura en Chile; las tablas
>   `contexto.eventos_ciudad`, `contexto.senales` y `contexto.senales_tenant`
>   tienen 0 filas y ningún escritor. Se conserva como registro de por qué no se
>   construyó.
>
> Nada de esto se borró: el documento es la memoria de por qué se descartaron
> cosas.

---

## 1. Qué es y qué no es

**Es** la capa de anticipación del motor entrega→dinero. Responde una sola
pregunta: *¿qué va a pasar hoy y mañana en mi operación, dónde, y cuánto me
cuesta si no hago nada?*

**No es** un dashboard con el clima al lado. La regla de oro de cada elemento de
la pantalla: si el dato no cambia una decisión del coordinador, no va.

| Mal (dato crudo) | Bien (dato traducido) |
| --- | --- |
| "Lluvia 12 mm a las 16:00" | "Lluvia 16–19 h sobre zona Oriente: 86 pedidos con corte 18:00, $1,9 M en cobro comprometido" |
| "PM2.5 = 82 µg/m³" | "Preemergencia probable mañana: restricción extraordinaria, revisa la flota" |
| "Incidente en Vespucio" | "Corte en Vespucio Sur: 3 conductores de zona Sur con ruta cruzando ahí" |

El valor compuesto — y lo defendible a mediano plazo — es el **histórico
propio**: con el tiempo Rutax sabe cuánto le cuesta la lluvia a *ese* courier en
*esa* zona. Eso no lo da ninguna API.

---

## 2. Decisiones tomadas

1. **Solo fuentes gratis / freemium.** Sin contratos de datos pagados. Se acepta
   el hueco resultante (cortes programados de UOCT, eventos de Puntoticket) y se
   cubre con marcado manual del coordinador.
2. **Anticipación primero, tiempo real después.** F1 entrega el horizonte
   Hoy / Mañana / 72 h. F2 agrega la capa en vivo sobre la misma pantalla.
3. **Zonas del tenant**, las que el courier ya configura en `identidad.zonas` +
   `identidad.zona_comunas`. Fallback a 5 macro-zonas fijas de la RM si el
   tenant no configuró ninguna.
4. **Alertas solo dentro del módulo.** Nada de correo, push ni WhatsApp en esta
   entrega.

---

## 3. Lo que ya existe en el repo (no rehacer)

| Pieza | Ubicación | Rol en el módulo |
| --- | --- | --- |
| Geocoding de pedidos (lat/long, `geo_estado`, cobertura) | `src/modules/integraciones/geocoding/` | Ubicar pedidos en el mapa |
| Zonas por tenant y mapeo comuna→zona | `src/modules/operacion/zonas.ts` | Unidad de agregación del mapa |
| Ventanas de corte por zona | `identidad.ventanas_corte` | Tiempo restante por zona |
| Conductores: disponibilidad + zonas preferentes | migración `..._conductor_disponibilidad_zonas` | Capacidad vs demanda |
| Ping de ubicación del conductor | `src/app/conductor/manifiesto/ping-ubicacion.tsx` | Flota en vivo (F2) |
| Catálogo `COMUNAS_RM` y `CENTROIDES_RM` | `src/lib/ui/comunas-rm.ts`, `.../geocoding/centroides-rm.ts` | Puntos de consulta meteorológica |
| SLA, incidencias, líneas de cobro | `operacion`, `dinero` | Dinero en riesgo |
| Inngest + crones | `src/lib/inngest/` | Ingesta externa fuera del request |
| Realtime como señal → `router.refresh` | patrón ya usado en tablero de operación | Auto-refresco (F2) |

---

## 4. Fuentes externas (verificadas 2026-07-25)

> ⚠️ **SECCIÓN SUPERADA (2026-08-03).** Se equivocó dos veces y la realidad la
> corrigió las dos: Open-Meteo (prohíbe uso comercial → se migró a OpenWeather) y
> las fuentes de prensa (bloqueadas → §13). Lo cierto está en las correcciones
> fechadas de más abajo y en CLAUDE.md.
>
> Y encima queda pendiente de una decisión de producto: si clima y aire salen del
> puntaje de riesgo, se apagan los adaptadores de OpenWeather, la grilla de 14
> puntos y las tablas `clima_horario` / `aire_horario`, y el módulo `contexto`
> se queda sin contexto externo. Lo decide `docs/torre-de-control/alcance-v2.md`.

### Se usan

> ⚠️ **CORRECCIÓN (2026-07-26).** Este cuadro afirmaba que Open-Meteo era
> "gratis, uso comercial". **Es falso y se verificó contra sus términos.** Dicen
> literalmente *"You may only use the free API services for non-commercial
> purposes"* y listan como actividad comercial prohibida *"operating websites or
> apps that have subscriptions"*. Rutax cobra suscripción, así que su tier libre
> no es una opción para este producto. Los tiers de pago sí lo permiten, pero el
> precio no es público y contradicen la decisión 1 del §2.
>
> **Fuentes decididas en reemplazo:**
> - ~~**Aire → MMA / SINCA.**~~ **CORREGIDO OTRA VEZ (2026-07-27, al implementar):
>   SINCA no sirve como fuente del factor aire.** Se verificó su JSON en vivo
>   (`sinca.mma.gob.cl/index.php/json/listadomapa2k19/`) y publica
>   **observaciones horarias por estación, no pronóstico** — exactamente el mismo
>   defecto por el que dos párrafos más abajo se descarta la DMC para clima. La
>   Torre anticipa a 24–72 h; alimentarla con lo ya ocurrido le quita su razón de
>   ser. Es cierto que el MMA es quien decreta los episodios, pero el decreto
>   llega el día del episodio, no tres días antes.
>   **Aire pasa a OpenWeather Air Pollution API** (pronóstico horario a 4 días de
>   PM2.5/PM10, gratis, misma cuenta que el clima). La clasificación a niveles
>   chilenos sigue siendo nuestra, sobre la media móvil de 24 h del Plan
>   Operacional del MMA — no se usa el índice AQI del proveedor.
>   SINCA sigue siendo la fuente correcta para «qué está midiendo la ciudad ahora
>   mismo» y para contrastar el pronóstico contra la realidad: sería un adaptador
>   NUEVO detrás del mismo puerto, no un reemplazo.
> - **Clima → OpenWeather.** Su tier gratuito permite uso comercial y **no pide
>   tarjeta**, a cambio de **atribución visible en pantalla** con el texto
>   literal «Weather data provided by OpenWeather» y enlace al sitio (el handoff
>   no la tenía prevista: se le abrió una franja de 18 px al pie del mapa, junto
>   a la de OpenStreetMap). Cuota real verificada: **60 llamadas/minuto y
>   1.000.000/mes** — no las 1.000/día que decía este documento, que eran las de
>   One Call 3.0, un producto distinto que sí exige tarjeta.
>   El endpoint gratuito es `/data/2.5/forecast`: **paso de 3 horas**, no hora a
>   hora, y `rain.3h` es un ACUMULADO del tramo. Consecuencia aceptada: la
>   intensidad de lluvia queda como media del tramo y un chaparrón corto se lee
>   más suave de lo que fue.
> - **La DMC (Dirección Meteorológica de Chile) se evaluó y NO sirve para esto**:
>   publica observaciones de estaciones automáticas e histórico, no un pronóstico
>   horario por ubicación. El factor clima de la Torre es inherentemente
>   predicción ("lluvia 16–19 h sobre Oriente"), no medición. Su licencia sí es
>   abierta (acceso y uso público, citando la fuente) por si sirve para otra cosa.

| Fuente | Endpoint | Key | Verificado |
| --- | --- | --- | --- |
| Clima horario | OpenWeather (ver corrección arriba) | sí, gratuita | Uso comercial permitido con atribución visible |
| Calidad del aire | OpenWeather Air Pollution API (ver corrección arriba) | sí, misma que clima | Pronóstico horario a 4 días; SINCA descartada por ser observación, no pronóstico |
| Tránsito (F2) | TomTom Traffic API (`incidentDetails`) | sí, freemium | Sí — Chile con cobertura incidents + flow + flow detailed; 2.500 req/día gratis, uso comercial permitido |
| Feriados | `api.boostr.cl/holidays.json` | no | Sí — incluye marca de irrenunciable |
| Restricción / GEC | `airerm.mma.gob.cl` (feeds RSS por tag) + calendario fijo GEC 2026 | no | Sí |
| Eventos deportivos | API de fixtures de Primera División (tier gratis) | sí | Por confirmar en implementación |
| Calendario cívico y comercial | tabla estática mantenida en el repo | — | — |

Notas de precisión:

- **El API oficial de feriados del Estado (`apis.digital.gob.cl`) está caído** —
  el dominio ya no resuelve, aunque medio internet lo sigue citando. No usarlo.
- **Consultar las 52 comunas es sobre-muestrear, y encarece sin ganar nada.** La
  RM tiene ~80 km de lado y los modelos meteorológicos tienen resolución de
  kilómetros: una celda de lluvia sobre Santiago cubre decenas de comunas a la
  vez. El módulo necesita clima **por zona** (son 5), no por comuna. Se muestrean
  **~10 puntos de grilla** sobre la RM y a cada comuna se le asigna su punto más
  cercano: el esquema de `contexto.clima_horario (comuna, hora)` no cambia, el
  resultado es equivalente, y el consumo baja a ~240 llamadas/día. La
  granularidad comunal venía de reusar `CENTROIDES_RM` por comodidad, no de una
  necesidad meteorológica.
- `CENTROIDES_RM` vive ahora en `src/lib/geo/centroides-rm.ts` (se promovió desde
  `integraciones/geocoding/`, donde su encabezado lo declaraba "solo para el
  adaptador stub de dev/CI" — falso en cuanto el puerto de clima entrara a
  producción).
- **Calendario GEC 2026** (restricción permanente por dígito): lunes 8-9,
  martes 0-1, miércoles 2-3, jueves 4-5, viernes 6-7, desde el 4 de mayo. Es
  determinístico — se calcula, no se consulta. Solo la restricción
  *extraordinaria* por episodio requiere leer el feed del MMA.

### Descartadas y por qué

- **UOCT / Transporte Informa RM** — tiene la mejor data de cortes programados y
  desvíos de Santiago, pero no hay API pública: se vende por contrato
  (`ventas@uoct.cl`, Decreto Exento 41). Fuera por la decisión de solo-gratis.
- **Ticketmaster Discovery API** — cubre Chile parcialmente; gran parte del
  volumen de Santiago se vende por Puntoticket, que no tiene API. El fútbol
  (Estadio Nacional, Monumental, Claro Arena) cubre la mayoría de los cortes
  reales y se resuelve con fixtures.
- **Marchas y manifestaciones** — no existe fuente confiable. Se cubre con el
  calendario cívico estático (11 de septiembre, 1 de mayo, 8M, cuenta pública,
  18 de octubre) más marcado manual.
- **Zonas de riesgo de asalto** — no hay API decente. Se construye con las
  incidencias georreferenciadas propias del tenant + marcado del coordinador.
  Es dato propietario, más valioso que cualquier feed.

---

## 5. Modelo de datos

Esquema nuevo **`contexto`**. Decisión central: la señal externa **no es dato de
tenant** — el clima de Santiago es el mismo para todos los couriers. Guardarla
por tenant multiplicaría llamadas y almacenamiento sin ganar nada.

> **Excepción explícita a la regla "toda tabla de negocio lleva `tenant_id`"**
> (CLAUDE.md). Las tablas 1–6 son datos de referencia pública, no de negocio: no
> contienen ni un dato de ningún courier, seller, conductor o destinatario. RLS:
> `SELECT` para cualquier usuario autenticado, escritura solo `service_role`.
> Las tablas 7–8 sí son de negocio y llevan `tenant_id` + RLS por tenant.
> Requiere validación de `base-datos-rls` y `seguridad-cumplimiento`.

**Globales (sin `tenant_id`)**

1. `contexto.clima_horario` — `(comuna, hora)`: `precipitacion_mm`,
   `prob_precipitacion`, `viento_kmh`, `temp_c`, `actualizado_en`.
2. `contexto.aire_horario` — `(comuna, hora)`: `pm25`, `pm10`, `nivel_estimado`
   (`bueno | regular | alerta | preemergencia | emergencia`).
3. `contexto.transito_incidentes` — id externo, punto, `tipo`, `magnitud`,
   `descripcion`, `desde`, `hasta`, `vigente`. (F2)
4. `contexto.eventos_ciudad` — `nombre`, `tipo`
   (`deportivo | masivo | civico | comercial`), `inicio`, `fin`, punto,
   `radio_m`, `comuna`, `fuente`.
5. `contexto.calendario` — feriados y fechas cívicas: `fecha`, `tipo`,
   `irrenunciable`.
   `contexto.eventos_comerciales` — el calendario comercial (ver §12):
   `nombre`, `arquetipo` (`venta | regalo`), `inicio`, `fin`, `organizador`,
   `multiplicador_base`, `curva_rezago` JSONB.
6. `contexto.restriccion_vehicular` — `fecha`, `digitos[]`, `tipo`
   (`permanente | preemergencia | emergencia`), `alcance`.

**Por tenant (con `tenant_id` + RLS)**

7. `contexto.riesgo_zona` — `(tenant_id, zona_id, fecha, franja)`: `puntaje`
   0–100, `desglose` JSONB con cada factor y su aporte, `pedidos_pendientes`,
   `monto_comprometido_clp`.
8. `contexto.marcas_operativas` — eventos marcados a mano por el coordinador:
   punto, `radio_m`, `nota`, `vigencia`, autor. Alimenta el mapa y el histórico.

---

## 6. Adaptadores y jobs

Cada fuente externa es un **puerto aislado** en `src/modules/integraciones/`
(regla del CLAUDE.md: el núcleo no llama APIs externas directo):
`contexto/clima`, `contexto/aire`, `contexto/transito`, `contexto/eventos`,
`contexto/calendario`.

Todo puerto **degrada, nunca revienta**: si la fuente falla, la capa se marca
"sin datos" en la UI y el resto del módulo sigue funcionando.

| Job Inngest | Cron | Costo |
| --- | --- | --- |
| `contexto/clima.refrescar` | cada 60 min | 1 request (52 comunas) |
| `contexto/aire.refrescar` | cada 60 min | 1 request |
| `contexto/transito.refrescar` (F2) | cada 10 min | ~144 req/día — cabe en el tier gratis de TomTom |
| `contexto/eventos.sincronizar` | 1×/día 05:00 | — |
| `contexto/calendario.sincronizar` | 1×/mes | — |
| `contexto/riesgo.recalcular` | cada 15 min, fan-out por tenant activo | interno |

**Zona horaria:** el módulo entero es sensible a fecha y hora. Usar siempre los
helpers de Santiago — **nunca `toISOString()`**, que es el bug conocido que vacía
las pantallas del día a partir de las 20:00 (ver deuda pendiente del proyecto).
Aquí ese bug no vaciaría una tabla: mostraría el clima del día equivocado.

---

## 7. Motor de riesgo

Puntaje 0–100 por zona y franja horaria. **Determinístico y explicable** — cada
factor se guarda con su aporte en `desglose`, y la UI muestra el desglose al
hacer clic. Nada de caja negra.

| Factor | Peso | Cómo se calcula |
| --- | --- | --- |
| Presión operativa | 35 % | pedidos pendientes ÷ capacidad estimada de la zona (conductores disponibles × capacidad), ajustada por tiempo restante hasta la ventana de corte |
| Clima | 20 % | precipitación y viento pronosticados dentro de la ventana de reparto de la zona |
| Aire y restricción | 15 % | PM2.5 pronosticado vs umbral de preemergencia + restricción vigente |
| Tránsito | 15 % | incidentes dentro del polígono de la zona, ponderados por magnitud (F2; peso redistribuido en F1) |
| Eventos | 10 % | evento masivo cuyo radio intersecta la zona dentro de la ventana |
| Histórico propio | 5 % | tasa de fallidos de la zona en condiciones similares; 0 mientras no haya historia |

**Dinero comprometido** = suma del cobro asociado a los pedidos pendientes en
zonas de riesgo alto. Se nombra "comprometido", no "pérdida esperada": es el
monto expuesto, no una predicción de pérdida. No inventar proyecciones
financieras que el motor no puede sostener.

**Sobre IA:** el motor es determinístico a propósito. Si más adelante se quiere
IA, el único uso que pasa el gate del proyecto es redactar el resumen en lenguaje
natural a partir del desglose ya calculado — sugiere, el humano decide, sin datos
personales al modelo.

---

## 8. Pantalla

Ruta: `src/app/(tenant)/torre-de-control/`. Botón fijo en la navegación del
layout `(tenant)`, condicionado por capacidad. RBAC: capacidad nueva
`ver_torre_control` para dueño, supervisor y coordinador.

> ⚠️ **SUPERADA ENTERA (2026-08-03).** Esta sección ya había quedado superada por
> el handoff de diseño; ahora el handoff también dejó de mandar y está archivado
> en `docs/_historico/torre-v1/`. Regiones, capas, zoom semántico, color,
> movimiento, interacciones y estados de pantalla se redefinen desde cero en
> `docs/torre-de-control/alcance-v2.md`, sobre una decisión de producto nueva:
> **el mapa es exclusivamente operativo** (zonas, conductores, pedidos, carga),
> sin capas de ambiente.
>
> Se conserva como registro. Dos cosas de aquí siguen siendo candidatas y el
> alcance v2 decide si sobreviven: 8.3 (disclosure de tres niveles) y 8.6
> (silencio por defecto).
>
> La ruta de 8.1 también cambió: la pantalla NO vive en `(tenant)` sino en
> `src/app/(consola)/torre-de-control/`.

### 8.1 Estructura

No es una grilla de widgets. Es **lienzo + riel**:

- **Encabezado** — selector de horizonte (Hoy / Mañana / 72 h) e indicador de
  frescura ("actualizado hace 3 min"). En un producto de dinero la frescura del
  dato es un elemento de confianza, no un detalle.
- **Mapa** (~60–65 % del ancho) — el lienzo.
- **Riel derecho** (~360 px) — alertas priorizadas, cada una con su acción
  sugerida (adelantar corte, reasignar conductor, avisar al seller).
- **Línea de tiempo** al pie, ancho completo — ventanas de reparto contra eventos
  externos, con marcador de "ahora".

Comportamiento del mapa:

- zoom bajo → **zonas** del tenant (unión de sus comunas), coloreadas por riesgo
- zoom medio → **comunas**
- zoom alto → **pedidos** individuales en clúster
- la unión comuna→zona se hace en el cliente. Sin PostGIS, sin migración pesada.

**Capas conmutables**: carga, clima, aire, tránsito, eventos, conductores.
Máximo **2 capas activas** a la vez — con más, el mapa deja de leerse de un
vistazo y el módulo pierde su razón de ser.

### 8.2 El conflicto de color, y cómo se resuelve

Un mapa coroplético es color en toda la pantalla. El principio 2 del sistema dice
que el color de marca es un recurso escaso y que el lienzo es neutro. Se resuelve
así, y no se negocia:

- **El basemap es casi invisible**: comunas en el neutro cool del sistema, ejes
  viales principales en un gris de contraste muy bajo, etiquetas de comuna solo a
  partir de cierto zoom. El mapa no compite: es el fondo sobre el que se lee el
  estado.
- **El navy de marca NO se usa en el mapa.** Se reserva para lo de siempre:
  selección activa, foco de teclado y enlaces. Si el navy pintara zonas, dejaría
  de significar "acción confiable".
- **El color del mapa es exclusivamente estado semántico de riesgo.**
- **Escala secuencial de un solo tono, no semáforo verde→rojo.** El semáforo
  falla en daltonismo y grita cuando no hay que gritar. El rojo semántico aparece
  solo al cruzar el umbral crítico — así el rojo conserva su peso.
- **Codificación secundaria siempre** (regla del sistema, validada con la skill
  `dataviz`): el puntaje numérico va visible en la etiqueta de cada zona. El
  color nunca es el único canal.

### 8.3 Progressive disclosure en tres niveles

El patrón dominante en tableros 2026, y el que evita que esto se vuelva una sopa
de datos. Calmo al abrir, profundo al hacer clic:

1. **Mapa** → *¿dónde?* Zonas coloreadas y nada más.
2. **Clic en zona** → *¿por qué?* El riel muestra el desglose de factores del
   puntaje, con el aporte de cada uno. Nada de caja negra.
3. **Clic en factor** → *¿qué hago?* Lista de los pedidos afectados, con la
   acción sugerida.

Los tooltips orientan; no cuentan la historia completa.

### 8.4 Presupuesto de velocidad

La sensación de calidad aquí es sobre todo **latencia**. Metas explícitas:

| Momento | Meta | Cómo |
| --- | --- | --- |
| Primer contenido útil | < 1 s | Server component entrega estado + geometrías; el mapa hidrata después |
| Hover / selección de zona | < 100 ms | `feature-state` de MapLibre — **nunca** re-setear el GeoJSON de la fuente |
| Drill zona → comuna | 320 ms | `easeTo` con `--ease-standard`, sin vuelo cinematográfico |
| Cambio de horizonte | < 300 ms | Los tres horizontes vienen precalculados; es cambio de estado, no fetch |

Reglas técnicas que sostienen esas metas:

- **La pantalla nunca llama a una API externa en el render.** Todo viene
  precalculado por los jobs. Esto es lo que hace que se sienta instantáneo.
- **Streaming RSC con Suspense por panel**: mapa, alertas y timeline llegan
  independientes y ninguno bloquea al otro. Sin spinner de página completa; los
  skeletons calzan con la forma final (pulso de 1500 ms, ya en el sistema).
- **Sin markers DOM.** Los pedidos van como `circle`/`symbol` layer sobre una
  fuente GeoJSON — la doc de MapLibre es explícita: los markers DOM son la
  primera causa de mapas lentos. En GPU, 100 k puntos rinden igual que 1 k.
- **GeoJSON como archivo estático cacheable** (`immutable`), simplificado y con
  coordenadas a 5–6 decimales. Nunca embebido en el bundle JS.
- **MapLibre se carga solo en esta ruta** (`dynamic`, sin SSR) — ~200 KB gzip que
  no deben penalizar el resto del producto.
- Versión de referencia: MapLibre GL JS v5.24 (abril 2026), última de la línea 5;
  v6 está en camino, no adoptar hasta que estabilice.

### 8.5 Movimiento

Todo sale de los tokens ya definidos en la Sección 3 del design system. Nada
nuevo:

| Interacción | Duración | Curva |
| --- | --- | --- |
| Hover de zona (opacidad de relleno) | `instant` | `standard` |
| Drill de cámara zona→comuna | `slow` | `standard` |
| Panel lateral (drawer derecho) | `slow` | `out` / `in` |
| Alerta nueva en el riel | `base` | `out` (fade + 8 px) |
| Marcador de "ahora" en la timeline | continuo, suave | — |

**Prohibido explícitamente**: pulsos o latidos permanentes en los pines, glow,
partículas, contadores que suben solos, tilt 3D y vista globo. Son lo que se ve
espectacular en la demo y estorba al tercer día — y una animación infinita en un
tablero que vive abierto todo el día quema GPU sin aportar nada. Única excepción:
un resalte **breve y por una vez** cuando entra una alerta crítica en vivo (F2).

`prefers-reduced-motion` es obligatorio (ya está resuelto en el sistema).

### 8.6 Silencio por defecto

El módulo se abre **calmo**. Si no hay riesgo, lo dice en una línea y se calla —
no llena la pantalla de tarjetas verdes para justificar su existencia. La
densidad aparece cuando hay algo que mirar. Un tablero que alarma todos los días
deja de leerse al mes.

### 8.7 Estados de sistema (primera clase, principio 7)

- **Sin riesgos** → "Todo tranquilo" y el detalle disponible a un clic.
- **Fuente caída** → la capa se marca degradada con su motivo; no desaparece en
  silencio ni bloquea la pantalla.
- **Pedidos sin geocodificar** → contador explícito ("N pedidos sin ubicar"). Un
  mapa que los esconde miente sobre la carga real.
- **Tenant sin zonas** → fallback a macro-zonas + invitación a configurarlas.

### 8.8 Construcción del mapa — RESUELTA

> ✅ **Resuelta (2026-07-26): ganó la Opción 2, MapLibre + PMTiles**, por
> orientación urbana, con geometría comunal DPA 2023 real y basemap acromático
> mínimo. Lo que sigue es el registro del trade-off.
>
> ⚠️ **Y se vuelve a abrir, con otro encuadre (2026-08-03).** Al quitarle al mapa
> las capas de ambiente, el mapa cambia de trabajo, y el usuario pidió replantear
> la herramienta. Esa evaluación —opciones, licencias, costo y medición de
> rendimiento— tiene su propio entregable: `docs/arquitectura/mapa-torre-v2.md`.
> No decidas motor de mapa desde aquí.
>
> **Opción 1 — la del handoff (SVG + TopoJSON).** El diseño aprobado dibuja el
> mapa como SVG geométrico con una capa HTML de etiquetas encima, sin basemap,
> sin tiles y sin relieve: retícula de coordenadas y celdas de zona sobre papel,
> estética de plano técnico. En producción los paths de placeholder se
> reemplazan por los polígonos DPA 2023 disueltos por zona, servidos como
> TopoJSON y proyectados con la función lineal que el handoff documenta. El
> "zoom" (zonas / comunas / pedidos) es un cambio de nivel de detalle, no zoom
> cartográfico.
>
> *A favor:* coherente con la estética aprobada, sin dependencias de mapa, sin
> pipeline de tiles ni alojamiento, bundle mínimo, control total. Elimina días
> de trabajo de infraestructura.
> *En contra:* sin calles, sin hitos urbanos, sin pan/zoom real. La orientación
> depende solo de la forma de las zonas.
>
> **Opción 2 — la de esta sección (MapLibre + PMTiles).** Cartografía real con
> basemap propio y relieve de la cordillera.
>
> *A favor:* orientación inmediata, pan/zoom real, escala a pedidos individuales.
> *En contra:* **un basemap con calles y relieve pelea de frente con la estética
> papel/grafito del diseño aprobado**, y exige el pipeline de Planetiler,
> alojamiento de tiles y glyphs auto-hospedados.
>
> Recomendación: **opción 1 para F1**. El diseño ya está aprobado con ella, es
> mucho menos trabajo y la capa HTML de etiquetas no cambia si más adelante se
> migra. La opción 2 queda disponible si en uso real la falta de referencias
> urbanas resulta un problema de orientación.
>
> Lo que sigue documenta la opción 2. Si se elige la 1, esta parte no aplica.

**MapLibre GL JS + PMTiles auto-hospedado + relieve + geometría oficial.**

| Pieza | Elección | Nota |
| --- | --- | --- |
| Motor | MapLibre GL JS v5.24 | BSD, sin API key. Mapbox GL JS v2+ dejó de ser open source en dic-2020 y cobra por *map load* |
| Basemap | OSM → **Planetiler** → `.pmtiles` recortado a la RM | Un archivo estático; sin servidor de tiles, sin base de datos, sin API key |
| Alojamiento | **Supabase Storage** vía HTTP Range | Ya está en el stack; Supabase publicó la guía oficial de este patrón exacto |
| Relieve | AWS Terrain Tiles (`elevation-tiles-prod/terrarium`) o Mapterhorn PMTiles | Gratis, sin key. **Gotcha:** encoding `terrarium`, no `mapbox` — declararlo mal da elevaciones silenciosamente incorrectas |
| Geometría comunal | DPA 2023 (IDE Chile / SUBDERE) | Shapefile oficial → mapshaper → GeoJSON simplificado |
| Fuentes y sprites | Glyph PBFs auto-hospedados | `basemaps-assets` de Protomaps, o generados con fontnik |
| Capas de datos pesadas | deck.gl vía `MapboxOverlay` interleaved | Solo si aparece necesidad real (estelas de conductores, heatmap). No de entrada |

Costo recurrente: **$0**. El trabajo está en el montaje, no en la factura.

No adoptar todavía: el formato **MLT (MapLibre Tile)**, anunciado en enero de
2026 — es el futuro del 2.5D pero aún no está maduro para producción.

**Lo que separa un mapa caro de uno barato** (en orden de impacto):

1. **Geometría real.** Polígonos inventados siempre se ven inventados.
2. **Basemap debajo.** Sin calles, agua y áreas verdes, el coroplético flota en
   el vacío. El Mapocho y el Parque Metropolitano dan escala y orientación.
3. **Hillshade.** Santiago es una cuenca rodeada por la cordillera: un relieve
   sutil (exageración 0.3–0.6) hace el mapa inconfundible y agrega la
   profundidad que se lee como "caro". Es gratis y es el mayor salto de calidad.
4. **Relleno translúcido, no sólido.** Las zonas al 55–70 % de opacidad dejan ver
   la trama de calles; el sólido opaco es lo que da aspecto de infografía.
5. **Tipografía en el mapa.** Halo, colisión de etiquetas y `letter-spacing` en
   nombres de lugar. Y renderizar a DPR 2.

**Por qué no Mapbox Standard**, que es el basemap más vistoso del mercado: su
estilo 3D con iluminación dinámica es *suyo*, se ve como cualquier otra app
Mapbox y **pelea de frente con la tesis del diseño** — necesitamos un basemap
acromático que se calle para que el dato tenga el color. Pagar compraría un look
que después habría que domar.

### 8.9 Accesibilidad y responsive

- **Equivalente no visual del mapa**: lista de zonas ordenada por riesgo,
  navegable por teclado, alimentada por la misma fuente de datos. No es un
  premio de consuelo — es también la vista compacta en pantallas chicas.
- Foco visible en cada zona seleccionable; el color nunca es el único canal.
- **En móvil el mapa cede el protagonismo**: el coordinador en el celular quiere
  la lista de alertas. Mapa reducido a una tira superior, alertas debajo. No se
  intenta meter el mapa completo en 390 px.
- Modo oscuro desde el día uno (los tokens ya se invierten); el wallboard de F3
  lo fuerza.

---

## 9. Entrega por fases

**F1 — Anticipación**
Esquema `contexto`; puertos clima, aire, calendario/restricción y eventos; motor
de riesgo; mapa por zonas con Hoy/Mañana/72 h; panel de alertas; línea de tiempo.

**F2 — Tiempo real**
Tránsito TomTom; flota en vivo sobre los pings existentes; progreso del
manifiesto; auto-refresco vía Realtime; marcas operativas manuales.

**F3 — Más adelante**
Correlación histórica clima↔fallidos por zona; cruce de restricción con patentes
de la flota; modo pantalla mural para la sala de operaciones; brief matinal por
correo.

---

## 10. Prerrequisitos y huecos conocidos

- **No existe `patente` ni entidad de vehículo** en el modelo de conductores.
  Sin eso, la alerta de restricción es genérica ("hoy restringe dígitos 4-5") en
  vez de específica ("3 de tus conductores no pueden circular"). Agregar el campo
  es requisito de F3, no de F1.
- **`CENTROIDES_RM` está documentado como "solo para el adaptador stub"**. Usarlo
  para consultar clima por comuna es legítimo, pero hay que promoverlo a un
  módulo geográfico compartido para que no quede un uso de producción colgando de
  un archivo declarado como de dev/CI.
- **Geometrías comunales**: obtener los límites oficiales de las 52 comunas de la
  RM, simplificar (objetivo < 200 KB) y versionar en el repo.
- **Tenants sin zonas configuradas**: el fallback a macro-zonas debe existir
  desde el día uno, o el módulo aparece vacío en el primer login.

## 11. Riesgos de producto

| Riesgo | Mitigación |
| --- | --- |
| Sobrecarga visual: se vuelve bonito e inútil | Máximo 2 capas activas; toda alerta lleva acción sugerida |
| Falsos positivos: el coordinador deja de mirar | Umbrales configurables por tenant + descartar alerta |
| Dependencia externa caída | Degradar por capa, marcar "sin datos", nunca bloquear la pantalla |
| Fatiga de alertas en día normal | Si no hay riesgo, la pantalla lo dice en una línea y se calla |

---

## 12. Ola entrante — el calendario comercial chileno

### 12.1 La idea

**Un courier no entrega el día del CyberDay: entrega la ola que ese CyberDay
generó.** Marcar la fecha en un calendario no sirve de nada; lo que da valor es
modelar el **desfase entre la venta y la entrega**, y ahí hay dos arquetipos con
comportamiento opuesto:

- **Evento de venta** (CyberDay, CyberMonday, Black Friday, fechas dobles de
  Mercado Libre): la compra ocurre en una ventana corta y **la ola de entregas
  llega después**, entre D+1 y D+5 con peak en D+2. Lo que entrega el módulo:
  curva de volumen proyectado por día y por zona, brecha de conductores y
  refuerzo necesario.
- **Fecha regalo** (Día de la Madre, del Padre, del Niño, Fiestas Patrias,
  Navidad): el regalo tiene que llegar **antes** de la fecha. La ola llega
  primero y el plazo es duro. Lo que entrega el módulo: la **fecha límite de
  compra por zona**, calculada con los tiempos reales del courier — un dato que
  el seller agradece y que hoy nadie le da.

### 12.2 Calendario 2026 (verificado 2026-07-25)

| Fecha | Evento | Organizador | Arquetipo |
| --- | --- | --- | --- |
| 1–3 jun | CyberDay | Cámara de Comercio de Santiago | venta |
| 5–7 oct | CyberMonday | Cámara de Comercio de Santiago | venta |
| 27–30 nov | Black Friday | Wide Latam | venta |
| 1.1 … 12.12 | Fechas dobles de Mercado Libre | Mercado Libre | venta |
| ene · jul · nov | Rebajas estacionales | — | venta |
| 14 feb | Día del Amor | — | regalo |
| feb–mar | Campaña escolar | — | venta |
| 8 mar | Día de la Mujer | — | regalo |
| 10 may | Día de la Madre | — | regalo |
| 21 jun | Día del Padre | — | regalo |
| 9 ago | Día del Niño | — | regalo |
| 18–19 sep | Fiestas Patrias | — | regalo |
| 31 oct | Halloween | — | regalo |
| 25 dic | Navidad | — | regalo |

Las fechas de los eventos Cyber las fija la CCS cada año y **se anuncian con
pocas semanas de anticipación**: la tabla se mantiene a mano en el repo y se
revisa cada temporada. No inventar un scraper para tres fechas al año.

### 12.3 Cómo se proyecta

```
volumen_proyectado(dia, zona) =
    volumen_base(dia_semana, zona)          -- media móvil del tenant
  × multiplicador_evento                    -- del catálogo, ajustado por historial
  × curva_rezago(dia - fecha_evento)        -- distribución D+n o D−n según arquetipo
```

- `curva_rezago` por defecto para **venta**: D+1 20 %, D+2 30 %, D+3 25 %,
  D+4 15 %, D+5 10 %.
- Para **regalo** la curva es espejo y termina en la víspera: el peak cae 2 a 4
  días antes, y el día de la fecha el volumen colapsa.
- Sin historial del tenant se usa el multiplicador del catálogo. Con historial,
  el del tenant manda.

### 12.4 Qué muestra la Torre

- **Banda de ola entrante** en el encabezado: evento, peak proyectado, variación
  esperada y **brecha de conductores del día crítico** ("−2 el jueves 6").
- **Horizonte "Olas"** como cuarta pestaña junto a Hoy / Mañana / 72 h.
- **Cuenta regresiva accionable** con hitos: T−21 confirmar sellers
  participantes · T−14 reforzar flota · T−7 validar tarifas y ventanas de corte ·
  T−3 congelar cambios de configuración.
- **Fecha límite de compra** por zona en las fechas regalo, exportable al portal
  del seller.
- **Alerta compuesta**, que es lo que ningún dato aislado da: *ola comercial +
  pronóstico de lluvia el día del peak*. Es el escenario que rompe una operación
  y solo se ve cruzando ambas fuentes.

### 12.5 El aprendizaje (lo que lo hace mejorar solo)

Al cerrar cada ola, un job compara proyectado contra real —volumen, fallidos,
SLA, dinero— y guarda el resultado en `contexto.olas_historicas` (por tenant).
Ese registro ajusta el multiplicador y la curva de rezago del evento **para ese
courier**.

Las **fechas dobles mensuales de Mercado Libre son el activo silencioso** del
diseño: doce eventos chicos al año que calibran el modelo, en vez de esperar tres
grandes. Al segundo año, la proyección de CyberDay ya no es un supuesto de
catálogo.

### 12.6 Conexión con el motor entrega→dinero (calendario)

La ola no es solo operación: es plata. Volumen proyectado × tarifa promedio de la
zona = ingreso esperado del período, y un volumen anómalo es también una señal
para el cierre y la facturación. Es la misma cadena de siempre, mirada hacia
adelante en vez de hacia atrás.

---

## 13. Señales — radar de acontecimientos

> ⚠️ **PIPELINE MUERTO (2026-08-03). No lo construyas.** Las fuentes están
> bloqueadas: Google News RSS prohíbe el uso comercial, GDELT no cubre Chile y
> SENAPRED solo publica desastres naturales (detalle en la corrección de §13.2).
> Las tablas `contexto.eventos_ciudad`, `contexto.senales` y
> `contexto.senales_tenant` existen con **0 filas y ningún escritor**, y
> `obtenerSenalesDelTenant` se importa en el composer pero nunca se llama.
> Efecto colateral: la fuente `senales` está declarada caída de forma permanente
> en `contexto.fuentes_estado`, y por eso la Torre abre siempre en estado
> `degradado`.
>
> Se conserva como registro de la investigación y de por qué no se construyó. Su
> retiro se decide en `docs/torre-de-control/alcance-v2.md`.

Investigado 2026-07-25. Objetivo: detectar acontecimientos (cortes, marchas,
paros, emergencias, fallas del Metro) que afecten la operación, antes de que el
coordinador los descubra en la calle.

### 13.1 La trampa

Un feed de noticias crudo es **ruido puro**. 300 artículos diarios de los que
tres importan, y el coordinador deja de mirarlo la primera semana. El valor no
está en la ingesta: está en el **filtro de relevancia operativa**. Por eso el
módulo se construye de atrás hacia adelante — primero la pregunta "¿esto toca
alguno de mis pedidos de hoy o mañana?", después las fuentes.

### 13.2 Fuentes (verificadas en vivo)

> ⚠️ **CORRECCIÓN (2026-08-02). Las tres filas del cuadro están mal, y la
> primera repite el error de Open-Meteo.** Se verificó cada una en vivo:
>
> 1. **Google News RSS NO se puede usar.** El propio feed devuelve, en su
>    `<copyright>`: *"This XML feed is made available solely for the purpose of
>    rendering Google News results within a personal feed reader for **personal,
>    non-commercial use**. Any other use of the feed is expressly prohibited."*
>    Rutax es un SaaS de pago. "Verificado, funciona" comprobó que **responde**,
>    no que **se pueda usar** — exactamente la distinción que ya nos costó
>    Open-Meteo en §4. No es la columna vertebral: no es una opción.
> 2. **GDELT sí permite uso comercial** (*"available for unlimited and
>    unrestricted use for any academic, commercial, or governmental use of any
>    kind without fee"*, con cita y enlace al redistribuir), pero **no está
>    probado como columna vertebral**: en un sondeo espaciado a 12 s (su límite
>    declarado es 1 req/5 s), 4 de 5 consultas devolvieron 429 y la única que
>    pasó devolvió **0 artículos** para Chile. Antes de apoyarse en él hay que
>    resolver cobertura chilena y cadencia real desde el servidor.
> 3. **Los dos endpoints "RSS oficiales" del cuadro no existen como RSS.**
>    `senapred.gob.cl/feed/` devuelve HTML y `airerm.mma.gob.cl/rss` no resuelve.
>    **Pero SENAPRED sí publica sus alertas de forma programática**, en
>    FeatureServers ArcGIS públicos (p. ej.
>    `services3.arcgis.com/CNzkI2T3GmfwkaAR/…/METEOROLOGICAS_ROJA/FeatureServer/0`,
>    descubiertos desde el dashboard oficial). Devuelven datos **estructurados y
>    vigentes** —151 alertas activas al 2026-08-02— con `CUT_COM`, el código
>    único territorial de comuna, además de `TIPO_ALERT`, `CAUSALIDAD` y
>    `FECHA_INI`.
>
> **Consecuencia sobre §13.5, que es lo importante:** para las alertas de
> emergencia **no hace falta LLM**. El dato llega ya estructurado y con el código
> de comuna, así que "extraer la comuna de la prosa" es un problema que esa mitad
> del módulo no tiene — y una extracción por LLM sería menos fiable que el campo
> oficial. La IA solo aporta valor en la prosa periodística sobre cortes y
> marchas… que es justamente la mitad cuya única fuente probada es la prohibida.
> Por eso el conjunto de evaluación de ~100 noticias **está bloqueado**: no se
> puede medir la extracción sobre un corpus que no se podrá usar en producción.

| Fuente | Estado | Rol |
| --- | --- | --- |
| **Google News RSS** (`news.google.com/rss/search?q=…&hl=es-419&gl=CL`) | ~~Verificado, funciona~~ · **PROHIBIDO uso comercial** | Descartada. Ver corrección |
| **GDELT 2.0 DOC API** | Uso comercial permitido; 429 persistente y 0 artículos para Chile en el sondeo | Candidata, **sin validar** |
| RSS oficiales (SENAPRED, `airerm.mma.gob.cl`) | Los endpoints RSS no existen | Reemplazados por FeatureServers ArcGIS de SENAPRED (estructurados, con `CUT_COM`) |

La consulta de prueba `Santiago corte de transito OR manifestacion` devolvió
exactamente lo que se necesita: *"Maratón de Santiago: cortes de tránsito"*,
*"Carabineros reporta cortes en el centro por manifestaciones"*, *"8M: desvíos y
cortes en Santiago"* — **y una de las fuentes agregadas era Transporte Informa
RM**, la cuenta oficial de la UOCT. Es decir: el contenido de la cuenta que no
podíamos consultar por API llega gratis vía Google News.

Consultas operativas a mantener (una por tema, no una genérica): cortes de
tránsito · manifestación/marcha · paro (camioneros, transporte) · accidente en
Vespucio / Costanera Norte / Ruta 5 · corte masivo de luz o agua · Metro de
Santiago (fallas) · alerta meteorológica · emergencia SENAPRED.

### 13.3 X (Twitter): no es la columna vertebral

**Desde el 6 de febrero de 2026 X pasó a cobro por uso** y cerró los planes
Basic ($200/mes) y Pro ($5.000/mes) a nuevas cuentas. Tarifas: **US$0,005 por
post leído** y **US$0,010 por recurso ligado a usuario — incluidas las
tendencias**.

Monitorear ~10 cuentas oficiales cada 15 minutos sale del orden de **US$250+ al
mes**, para obtener contenido que Google News ya entrega gratis y agregado. Para
un piloto de un courier, no se justifica. Queda como **complemento opcional**
(tendencias 1×/hora ≈ US$7/mes) si más adelante aparece un caso que lo pida.

**Scrapear X está prohibido por sus términos** — no es una alternativa.

**Bluesky** tiene API gratis y abierta, pero las cuentas chilenas que importan
(SENAPRED, UOCT, Carabineros) no están ahí. No sirve para este caso.

### 13.4 Pipeline

1. **Ingesta** — job Inngest cada 15–30 min: N consultas de Google News RSS +
   GDELT + RSS oficiales. Adaptador aislado en `integraciones/contexto/noticias`.
2. **Deduplicación** — la misma noticia llega por cinco medios. Agrupar por
   título normalizado + ventana temporal. **Sin este paso el riel es basura.**
3. **Clasificación (LLM)** — texto libre en español chileno →
   `{ afecta_operacion, tipo, comunas[], ejes_viales[], inicio, fin, severidad, confianza }`.
4. **Geolocalización** — comunas mencionadas → zonas del tenant, reusando
   `resolverComunaCanonica`.
5. **Filtro de relevancia** — entra al riel solo si `afecta_operacion` **y** hay
   pedidos del tenant en esa zona dentro de esa ventana. **Este filtro es el
   producto.**
6. **Presentación** — una tarjeta por **acontecimiento**, no por artículo: qué,
   dónde (zona), cuándo, cuántos pedidos tuyos caen dentro, y las fuentes que lo
   reportan. Varias fuentes independientes = más confianza.
7. **Marcado humano** — el coordinador confirma o descarta; eso calibra umbrales
   y queda en el histórico.

### 13.5 Por qué acá sí corresponde IA

Un motor de reglas por palabras clave no distingue *"corte de tránsito mañana en
Providencia por la maratón"* de *"corte de luz en Antofagasta"*. Extraer comuna,
ventana temporal y severidad de prosa periodística chilena es exactamente lo que
un LLM hace bien y las reglas hacen mal.

Cumple el gate de IA del proyecto: resuelve un problema real de operación; no es
ruteo; **no automatiza nada irreversible** — sugiere y el coordinador decide; no
procesa datos personales (son noticias públicas, nunca se le pasa un destinatario
ni un token); y es asistencia vía API gestionada, no infraestructura propia.

Implementación: **structured outputs** (`output_config.format` con `json_schema`)
para que la salida sea siempre JSON válido, **prompt caching** sobre el prompt de
sistema estable, y **Batch API** (50 % de descuento) porque el trabajo es un
cron, no una petición interactiva. Modelo por defecto `claude-opus-5`.

Volumen estimado: ~300 artículos/día que dedupean a ~60 eventos; con Batch API el
costo es marginal a esa escala. **Antes de fijar el modelo, evaluar con un
conjunto real de ~100 noticias chilenas etiquetadas a mano**: lo que importa es
la precisión al extraer comuna y ventana temporal, no el precio por token. Bajar
de modelo es un cambio de una línea si la evaluación lo respalda — pero medirlo
después de meses de clasificaciones silenciosamente malas sale mucho más caro que
el ahorro.

**Degradación**: si la clasificación falla o la API no responde, las noticias
crudas quedan en una lista secundaria marcada "sin clasificar". El módulo nunca
se cae por esto.

### 13.6 Lo que no se puede cubrir

Marchas no autorizadas y convocatorias de último minuto no tienen fuente
confiable. Se cubren con el calendario cívico estático y el marcado manual del
coordinador — y conviene decirlo en la interfaz en vez de fingir cobertura total.
