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
(153 warnings preexistentes, ninguno de estos módulos) · `npm test` **2275 passed /
5 skipped** en 142 archivos · `npx supabase test db` **476 tests pgTAP** en 25 archivos.

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

## Lo que falta, en orden

### 1. El composer (lo siguiente)

Hoy la pantalla se alimenta de `_fixture/estado-torre.ts`. Falta exponer los datos
reales y cambiar la fixture por ellos.

- Server Components con `<Suspense>` **por región** y `cache()` de React por request
  (`zonas` la necesitan R3, R4 y R5).
- **Nada de `/api/torre/estado`** ni de `revalidatePath` (remonta el tablero y salta el
  scroll del riel, que el handoff prohíbe).
- Las consultas ya existen y están probadas: reutiliza `src/modules/contexto/agregacion.ts`
  y el patrón de `reunir-insumos` de `jobs/recalcular-riesgo.ts`. **No las dupliques** —
  si el composer agregara por su cuenta, el mapa y el desglose de nivel 2 podrían
  contradecirse, que es justo lo que la jerarquía de tres niveles no permite.
- `EstadoTorre` se envuelve en `TorreRespuesta { horizonteInicial, horizontes:
  Record<'hoy'|'manana'|'72h', EstadoTorre> }` (aditivo; el tipo congelado queda intacto).
  `olas` no va ahí: se compone en cliente.
- Valida el payload con zod contra los tipos del contrato congelado.

### 2. QA funcional con stack vivo

Los 5 jobs **nunca se han ejecutado** contra el Inngest Dev Server con datos de demo.
El **fan-out por tenant es patrón nuevo en el repo** (antes había cero `step.sendEvent`
y cero `concurrency` en todo `src/`): probarlo con ≥3 tenants, incluyendo reintentos.
Las tablas de `contexto` están vacías porque ningún job ha corrido. Arranque en
`docs/PRUEBA.md`.

### 3. Migrar las fuentes externas

Open-Meteo prohíbe uso comercial en su tier libre y Rutax cobra suscripción. Decidido:
aire → **MMA/SINCA** (es quien decreta los episodios), clima → **OpenWeather** (tier
gratuito permite SaaS comercial con atribución visible —ya está puesta en el mapa—,
tope 1.000 llamadas/día). Bajar el muestreo de 52 comunas a **~10 puntos de grilla**
sobre la RM, asignando a cada comuna su punto más cercano: el esquema no cambia y el
consumo baja a ~240/día. **Los puertos NO cambian de forma; solo los adaptadores
detrás.** Los adaptadores actuales se llaman `open-meteo.ts` y hay que reemplazarlos.

### 4. Bloque C — calendario comercial (olas)

§12 del diseño técnico: dos arquetipos (venta, las entregas llegan después; regalo,
llegan antes y el plazo es duro), curvas de rezago, proyección por día y zona, brecha
de capacidad y fecha límite de compra por zona.

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
3. **Acciones de las excepciones**: hoy completan el flujo de confirmación en el sitio
   pero no ejecutan nada real ("adelantar corte", "reasignar conductores"). Falta
   decidir si se cablean al backend en este módulo o se delegan a las pantallas
   operativas que ya existen.
