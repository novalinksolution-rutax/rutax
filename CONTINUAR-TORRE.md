# Continuar la Torre de control — prompt de traspaso

> Pega el bloque de abajo como primer mensaje de la sesión nueva. Este archivo
> es andamiaje: bórralo cuando el módulo esté cerrado.

---

Continúa la implementación del módulo **Torre de control** en el repo saas-courier.
Vengo de dos sesiones previas: la vía de datos, toda la interfaz y el mapa ya están.

## Lectura obligatoria antes de tocar nada

1. `CLAUDE.md` — invariantes y módulos. La sección "Torre de control" del final tiene
   las decisiones que SE APARTAN de los documentos: si un documento dice lo contrario
   de eso, gana CLAUDE.md.
2. `design_handoff_torre_de_control/README.md` — la interfaz aprobada.
3. `docs/arquitectura/torre-de-control.md` — diseño técnico. **§4 tiene una corrección
   marcada al inicio: Open-Meteo quedó descartado.** §8 quedó superada en todo lo
   visual por el handoff, y además por la decisión de usar MapLibre.
4. `docs/torre-de-control/datos-dummy.ts` — contrato de tipos congelado.
5. `checklist-pruebas-funcionales-mvp.md` — busca los bloques "Torre de control".
   Los pasos B3, B5 y B6 son el registro de lo hecho, con sus bugs y decisiones.
6. `scripts/mapa/README.md` — el pipeline cartográfico y sus invariantes.

## Estado: nada está commiteado

Rama `feat/frontend-premium-rutax`, sobre el commit `d75d36a`. 46 entradas sin
commitear (92 archivos si se expanden los directorios nuevos). Lo nuevo sin trackear
es `src/app/(consola)/`, `src/modules/contexto/agregacion.ts` (+ su test),
`public/mapas/` y `scripts/mapa/`.

Verificación actual EN VERDE: `npm run typecheck` limpio · `npm run lint` **0 errores**
(153 warnings preexistentes, ninguno de estos módulos) · `npm test` **2342 passed /
5 skipped** en 144 archivos · `npx supabase test db` **476 tests pgTAP** en 25 archivos.
Además, smoke real: `GET /torre-de-control` responde 200 con el payload completo del
tenant demo contra Supabase local, y la consola se vio pintando en Chrome real.

### Ya construido y verificado

- **Vía de datos**: esquema `contexto` (11 tablas, migración `20260725000001`) con
  carve-out deny-all y 28 pruebas pgTAP · puertos de clima/aire/calendario · motor de
  riesgo determinístico (70 tests) · 5 jobs Inngest con fan-out real por tenant ·
  capacidad RBAC `ver_torre_control`.
- **Interfaz completa, las seis regiones**: R1, R2, R3 (mapa), R4/R6 (riel con nivel 2
  y 3), R5, los 6 estados de `EstadoPantalla`, vista móvil, paleta ⌘K y atajos.
- **La consola es full-bleed**: vive en `src/app/(consola)/torre-de-control/`, fuera del
  `AppShell`. `(consola)/layout.tsx` repite los mismos guards de sesión y tipo de
  usuario que `(tenant)/layout.tsx`.
- **R3, el mapa**: MapLibre + PMTiles, geometría comunal DPA 2023 real, basemap
  acromático mínimo, tramas de 45° generadas en canvas a DPR 2, los cuatro controles
  flotantes, atribución visible y des-solapado direccional de placas. **Verificado
  pintando en Chrome real**, con la jerarquía de tres niveles funcionando de punta a
  punta.
- **Motor de riesgo cerrado**: los seis factores entran con dato real
  (`src/modules/contexto/agregacion.ts`, módulo puro con 36 tests).
- **El composer**: la pantalla se alimenta de la base, con `<Suspense>` por región,
  `cache()` por request, los tres horizontes precalculados en un solo payload y
  validación zod. Verificado contra Supabase local y en Chrome real.
- **Los 5 jobs, ejecutados de verdad**: fan-out por tenant, idempotencia, reintentos
  aislados y degradación de fuente, todo comprobado contra el Inngest Dev Server. Las
  tablas de `contexto` ya no están vacías.
- **Fuentes externas migradas a OpenWeather** (clima y aire), con clave real y
  corriendo contra la API de verdad. Open-Meteo retirado del código.
- **La ola entrante (bloque C)**: catálogo sembrado, proyección con línea base del
  propio courier, y R2 + riel mostrándola.

## Lo que falta, en orden

### ~~1. El composer~~ — HECHO (paso B7)

La pantalla ya no lee la fixture: se alimenta de la base. Detalle completo en el
bloque «paso B7» del checklist. Lo que hay que saber para seguir:

- `src/modules/contexto/composer/` — `consultas` (I/O con `cache()` por request),
  `armado-zonas` / `armado-mapa` / `armado-riel` (puros, 61 tests), `esquema` (zod
  declarado `z.ZodType<TorreRespuesta>` para que no pueda divergir del tipo) e `index`
  (dos cargadores: `cargarCabecera` y `cargarTablero`).
- **Los tipos del contrato se movieron** a `src/modules/contexto/contrato-torre.ts`.
  `_fixture/estado-torre.ts` los reexporta, así que ningún componente cambió su import;
  la fixture conserva solo los DATOS (y sigue siendo la fuente de las variantes de
  `EstadoPantalla` y del catálogo de macro-zonas).
- **El `<Suspense>` es por región; el dato tiene dos puntos de llegada.** Partir el
  tablero más fino no se puede sin mentir: R5 dibuja los bloques de lluvia que salen de
  las celdas de R3, el control de capas necesita saber si hay lluvia, y R4 necesita las
  zonas que pinta R3. R1 sí llega por su cuenta y antes.
- **El composer NO recalcula el riesgo**: lee `contexto.riesgo_zona` tal cual, incluida
  la franja dominante que marcó el job. Cuando no hay fila (el job no ha corrido, o el
  courier no tiene zonas), los pendientes y el monto salen de un conteo EN VIVO con
  `cargaPorZona` — la misma función pura del job — y los seis factores dicen que
  todavía no hay cálculo.
- **`leerTodasLasFilas`** (`src/lib/supabase/`) existe porque PostgREST corta en
  `max_rows = 1000` sin avisar. Ya estaba mordiendo al job (30 días de pedidos cerrados
  y ~3.700 filas de pronóstico). Úsalo en toda consulta que después se agregue.

### ~~2. QA funcional con stack vivo~~ — HECHO (paso B8)

Los 5 jobs corrieron contra el Inngest Dev Server con datos de demo. Detalle en el
bloque «paso B8» del checklist. Resumen de lo que quedó probado: el fan-out despacha
un run por tenant no suspendido y **un tenant que falla no arrastra a los demás**
(reintenta solo el suyo, 2 veces, y muere ahí); la clave de idempotencia del evento
evita el doble recálculo dentro del mismo cuarto de hora; el upsert no duplica; y una
fuente caída degrada con copy para el usuario **conservando el dato viejo y su última
actualización exitosa**, sin reventar el job.

Lo que sigue abierto de este frente:
- **No existe un job que pueble `contexto.eventos_ciudad`** (§6 lo lista como
  `contexto/eventos.sincronizar`). Hoy la fila de frescura `eventos` la marca sana el
  job de **calendario y feriados**, que es otra cosa. Decidir si se desdobla la fuente
  o se renombra el slot del contrato.
- Vista móvil a 390 px, sin revisar desde el refactor de regiones.

### ~~3. Migrar las fuentes externas~~ — HECHO, con una corrección

Open-Meteo quedó **retirado del código** (su tier libre prohíbe uso comercial). Clima
**y aire** van ahora con **OpenWeather**: misma cuenta, tier gratuito sin tarjeta, uso
comercial permitido a cambio de atribución visible con el texto literal «Weather data
provided by OpenWeather». Los puertos no cambiaron de forma; solo los adaptadores.

**Lo que el traspaso decía mal:** «aire → MMA/SINCA». Se verificó el JSON de SINCA en
vivo y **publica observaciones por estación, no pronóstico** — el mismo defecto por el
que se había descartado la DMC para clima. La Torre anticipa a 24–72 h, así que aire
pasó a **OpenWeather Air Pollution** (horario, 4 días). SINCA sigue siendo la fuente
correcta para «qué mide la ciudad ahora»: sería un adaptador nuevo detrás del mismo
puerto, no un reemplazo.

Dos cosas que hay que tener presentes al leer el tablero:
- **El clima gratuito viene en pasos de 3 horas**, no hora a hora, y `rain.3h` es un
  acumulado: la intensidad queda como media del tramo y un chaparrón corto se lee más
  suave. Se emite una fila por punto real, sin rellenar las horas intermedias.
- **La grilla es de 14 puntos**, no 10 (`src/modules/integraciones/contexto/grilla-rm.ts`):
  k-centros sobre los centroides comunales reales, peor caso 12,6 km, que es la
  resolución del propio modelo. Un solo punto cubre las 25 comunas del casco urbano,
  así que clima y aire **no distinguen Centro de Oriente** — el modelo tampoco.

**Ya corre contra la API real.** La clave del tier gratuito está en `.env.local` y los
dos puertos en `openweather`. Verificado en vivo: 1.248 filas de clima (52 comunas ×
24 puntos de 3 h) y 3.796 de aire, con el viento en km/h (0,04–23,62) y la lluvia ya
dividida (0–1,43 mm/h). El endpoint de histórico también es gratis, así que la siembra
de la ventana de 24 h funciona. Hay horas con PM2.5 de 135 µg/m³ clasificadas `bueno`:
es correcto — el nivel va sobre la media móvil de 24 h, no sobre la hora suelta.

### ~~4. Bloque C — calendario comercial (olas)~~ — HECHO (paso B10)

La ola entrante se proyecta y se muestra en R2 y en el riel. Detalle en el bloque
«paso B10» del checklist. Lo que hay que saber:

- **La fórmula de §12.3 está mal escrita en el documento.** `base × multiplicador ×
  curva_rezago` da MENOS que un día normal, porque la curva suma 1 (es un reparto, no
  un factor). Lo implementado: `extra = base × (multiplicador − 1) × días_del_evento`,
  repartido por la curva y sumado a la base de cada día. Ver `src/modules/contexto/olas.ts`.
- **Las cifras del dummy no se reproducen a propósito**: no salen de ninguna fórmula
  publicada, y calzarlas habría sido elegir la fórmula por su resultado.
- **El catálogo se siembra por migración** (`20260727000001`), con los 8 eventos que
  tienen multiplicador y curva verificados. Los otros seis de §12.2 no entran hasta
  tener multiplicador medido.
- **La fecha límite de compra se mide** (mediana de días ingreso→compromiso por zona)
  y una zona sin plazo medido NO aparece.

Lo que queda abierto de este frente:
- **El horizonte «Olas» (tecla 4) todavía cae a «hoy»**: no tiene vista propia.
- **La alerta compuesta de §12.4** (ola + lluvia el día del peak).
- **El aprendizaje de §12.5** (`contexto.olas_historicas`) es F3.

### 5. Bloque D — señales de prensa (F1.5)

§13. **Pasa por el gate de IA antes de escribir código**: `arquitecto` ya dio su lado
(no se vuelve infraestructura, con tres condiciones); falta `seguridad-cumplimiento`
por privacidad y la aprobación del usuario. Antes de fijar el modelo, armar un conjunto
de evaluación de ~100 noticias chilenas etiquetadas a mano y medir la precisión al
extraer comuna y ventana temporal — eso decide el modelo, no el precio por token.
Las tablas `contexto.senales` y `senales_tenant` YA existen. Sus dos eventos Inngest NO
están declarados a propósito: `eventos.contrato.test.ts` exige que todo evento tenga
productor real. Se definen junto con sus jobs. Su forma acordada está en §13.4.

### 6. Bloque E — tiempo real

Tránsito (TomTom, F2), flota en vivo sobre los pings existentes, auto-refresco vía
Realtime y marcas operativas manuales.

## Decisiones ya cerradas — NO re-litigar

- **Mapa**: MapLibre + PMTiles con geometría DPA 2023 real y basemap acromático mínimo.
- **Viewport full-bleed sin shell**, en el grupo de rutas `(consola)`. Decisión del
  usuario ("ignora el handoff, escoge la elección que se vea más premium"). **La regla
  general no cambia: toda pantalla nueva del courier sigue yendo a `(tenant)`.**
- **Geocoding**: producción corre con proveedor de respaldo, así que la capa `pedidos`
  y el nivel 3 geométrico quedan **apagados y declarados**, no fingidos. Se encienden
  por configuración (el motivo vive en `MOTIVO_PEDIDOS`, en `_componentes/r3-mapa.tsx`),
  no cambiando código.
- **Carve-out de `tenant_id`**: aceptado, con deny-all real. Test mecánico: si dar de
  alta un courier agrega filas, la tabla es de negocio y lleva `tenant_id`.
- **`Senal` desdoblada** en tabla global + `senales_tenant`.
- **Horizontes precalculados**; **a 72 h se cuentan solo pedidos ya ingestados, nunca
  una proyección** — se verá casi vacío y es correcto.
- **Módulo `contexto` es el sexto.** Límite duro: `operacion` y `dinero` NO pueden
  llamar a `contexto`, nunca al revés.
- **Preferencias de usuario** (capas, horizonte, modo lista) van en `localStorage`.
- **Umbrales PM2.5** (Plan Operacional GEC 2026 del MMA): Alerta 80 · Preemergencia 110
  · Emergencia 170, sobre la media móvil de 24 h. Los del `datos-dummy.ts` están mal:
  el dummy es contrato de TIPOS, no de valores.
- **`monto_comprometido_clp` sale de `identidad.tarifas` vía `pedidos.tarifa_aplicable_id`**,
  NO de `dinero.lineas_cobro` — esas nacen con la entrega y aquí darían siempre cero.
- **`marcaProv` guarda `{long, lat}`**, no `{x, y}`: con MapLibre no hay `viewBox`, hay
  terreno.

## Gotchas verificados — caros de redescubrir

1. **`maplibre-gl` está clavado en `5.24.0` (versión EXACTA). NO subir a 6.x.** La 6.0.0
   dejó de empaquetar su Web Worker y lo carga como archivo suelto con
   `new Worker(new URL(…, import.meta.url), {type:'module'})`; Turbopack no resuelve ese
   patrón dentro de `node_modules` y **MapLibre queda mudo**: ni un evento (`error`,
   `render`, `style.load`), `getStyle()` → `null`, lienzo en blanco, cero errores en
   consola. Para aislarlo: crear un mapa mínimo de cinco líneas en la propia página; si
   ese también falla, es la librería. `@maplibre/maplibre-gl-style-spec` debe seguir a
   la versión que pide maplibre-gl (hoy `^24.10.0`).
2. **Esquema nuevo = hay que exponerlo a PostgREST.** `supabase.schema('X')` responde
   `Invalid schema: X` si `X` no está en `[api] schemas` de `supabase/config.toml` (y en
   el hosted, en Settings → API → Exposed schemas + `docs/ops/despliegue.md`). Ya pasó
   con `plataforma` y con `contexto`. Exponer NO concede acceso: con RLS force sin
   políticas y grants revocados, `anon` recibe 42501 igual (verificado en vivo).
3. **Tailwind 4 hace tree-shaking de las variables de `@theme`** que ninguna utilidad
   referencia. Si usas `var(--token)` en CSS crudo, la variable puede desaparecer y la
   propiedad queda inválida **en silencio**. Ya pasó con `--font-tc`.
4. **CSS de terceros sin capa gana SIEMPRE al CSS en capa** (donde vive todo Tailwind),
   sin importar la especificidad. `maplibre-gl.css` se importa sin capa: cualquier nodo
   que MapLibre marque con sus clases hay que posicionarlo con estilos EN LÍNEA.
5. **`outline-none` + `outline-2` en Tailwind 4 NO dibuja nada.** Hay que añadir
   `focus-visible:outline-solid`. Ver `_lib/estilos.ts`.
6. **Si tocas `@theme` en `globals.css`, reinicia el dev server** — Turbopack sirve CSS
   rancio.
7. **Las fechas civiles desnudas (`YYYY-MM-DD`) no son instantes.** Usa
   `src/lib/fecha-santiago.ts`. Hay un guard permanente que barre `src/modules/contexto/`
   buscando los dos patrones que sí son bugs — y que también aplica a los archivos de
   test de ese directorio.
8. **Lo que devuelve un `step.run` de Inngest pasa por JSON**: los `Date` llegan al
   llamador serializados como string.
9. **UN solo `BaseMiddleware` de Inngest.** Registrar un segundo colapsa el tipo de
   `step.run` a `{}`.
10. **En MapLibre, engancha el cableado de datos a `style.load`, NO a `load`.** `load`
    exige además «el primer renderizado visualmente completo», que lo cumple el
    compositor: en una pestaña de fondo no llega nunca.
11. **Los subagentes se han caído repetidamente por límite de sesión.** Para trabajo
    largo, hacerlo en la sesión principal o en trozos chicos.
12. **PostgREST corta en `max_rows = 1000` SIN AVISAR.** No es un error que se pueda
    capturar: son filas que faltan. Mortal en todo lo que después se agrega (un conteo
    por zona, una suma de dinero, un pronóstico por comuna): el resultado sale plausible
    y equivocado. Usa `leerTodasLasFilas` de `src/lib/supabase/`, o resuelve el conteo
    en Postgres con `count: 'exact', head: true`.
13. **El panel de navegador embebido nunca resuelve los `<Suspense>` de la Torre** — se
    queda en los esqueletos aunque el HTML del servidor traiga todo. En Chrome real
    tampoco resuelve con la pestaña en SEGUNDO PLANO. Para verificar la consola hace
    falta la pestaña en primer plano (un `screenshot` de Claude in Chrome la activa).
    Antes de dar por rota una región, comprueba con `fetch('/torre-de-control')` si el
    contenido está en el HTML: si está, es el entorno, no el código.
14. **Docker Desktop 4.56 encadena dos sockets huérfanos tras un cierre sucio**:
    primero `AppData\Local\Docker\run\dockerInference`, después
    `AppData\Local\docker-secrets-engine\engine.sock`. Hay que renombrar LAS DOS
    carpetas (no se pueden borrar) y arrancar una sola vez; si arranca y vuelve a
    caer, deja un socket nuevo y hay que repetir. **Nunca «Reset to factory
    defaults»**: borra los volúmenes, incluida la base local con los datos de demo.
    Y si tocas `settings-store.json` desde PowerShell 5.1, escríbelo **sin BOM**
    (`[System.IO.File]::WriteAllText` con `UTF8Encoding($false)`): `Out-File -Encoding
    utf8` mete BOM y el parser de Go de Docker lo rechaza con «invalid character 'ï'».

## Cómo trabajar

- Sigue la secuencia de orquestación de `CLAUDE.md`. `qa` entra después de cada bloque,
  no al final. `seguridad-cumplimiento` todavía debe firmar el carve-out de `contexto`
  y el tratamiento de `marcas_operativas.nota` como texto libre con posible PII.
- Carga las skills del proyecto cuando corresponda.
- Verificación estándar antes de dar algo por hecho: `npm run typecheck`,
  `npm run lint`, `npm test` y `npx supabase test db`.
- **Y míralo en el navegador.** Los seis bugs de interfaz de estas sesiones —el
  off-by-one de fechas, el tree-shaking de `--font-tc`, el foco invisible, el
  contenedor del mapa a 0 px de alto, el centroide espejado al hemisferio opuesto y
  MapLibre mudo— no los habría cazado ninguna de esas cuatro verificaciones. Los seis
  salieron de mirar la pantalla.
  - Para código con BD, además un **smoke test de las consultas contra Supabase local**:
    es lo único que caza una columna mal escrita. Ni el typecheck ni vitest la ven.
- Mantén al día `checklist-pruebas-funcionales-mvp.md`.
- Si algo del handoff choca con un invariante del proyecto, dilo en vez de resolverlo
  por tu cuenta.

## Entorno local

- Arranque completo en `docs/PRUEBA.md` (Supabase local, seed de demo, Inngest Dev
  Server, credenciales). El tenant de demo es "Despachos del Centro".
- El basemap PMTiles **no está en el repo** (19 MB, gitignored en `.artefactos/`).
  Si falta: `node scripts/mapa/construir-basemap.mjs` y luego
  `node scripts/mapa/publicar-basemap.mjs`, que imprime la URL para
  `NEXT_PUBLIC_MAPA_BASEMAP_URL`. **Sin esa variable el mapa sigue funcionando**: pinta
  las zonas sobre Papel, sin plano urbano debajo, y eso es un estado válido.
- El panel de navegador del entorno de Claude Code **no compone frames**
  (`visibilityState: hidden`, rAF no dispara), así que MapLibre no arranca ahí y las
  capturas fallan. Sirve igual para `read_page`, estilos computados y DOM. Para ver el
  mapa hay que usar Claude in Chrome **con la pestaña en primer plano**.

## Decisiones abiertas que hay que cerrar con el usuario

1. **`RestriccionVehicular.vehiculosAfectados` es `null`** porque el modelo no guarda
   patentes. La alerta de preemergencia es genérica hasta que exista el campo (F3).
2. **Estrategia de refresco en cliente** respetando las cadencias por fuente (clima 60
   min, tránsito 10 min, eventos 1440 min, prensa 30 min), sin que salte la posición de
   scroll del riel.
3. **Acciones de las excepciones**: el composer YA NO EMITE las que requieren
   confirmación ("adelantar corte", "reasignar conductores"), porque completan el flujo
   y no ejecutan nada — un botón que confirma y no hace nada es peor que su ausencia.
   Solo emite "Ver los N pedidos" (enlace real) y "Ver flota expuesta" (revelación
   honesta in-situ). Falta decidir si esas dos acciones se cablean al backend en este
   módulo o se delegan a las pantallas operativas que ya existen; cuando se decida, se
   agregan en `composer/armado-riel.ts`.
4. **La ventana de reparto de R5 termina en el corte MÁS TARDÍO del courier.** Con el
   tenant demo todos los cortes son a las 12:00, así que la franja dibuja 08:00–12:00 y
   se ve corta. Es fiel al modelo (el corte es "hasta cuándo se puede seguir
   despachando"), pero conviene confirmar con el usuario que esa es la lectura correcta
   y no "hasta cuándo se reparte".
