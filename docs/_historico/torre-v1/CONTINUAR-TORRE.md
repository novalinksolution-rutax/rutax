# Continuar la Torre de control — prompt de traspaso

> Pega el bloque de «Mensaje para la sesión nueva» como primer mensaje. Este
> archivo es andamiaje: bórralo cuando el módulo esté cerrado.
>
> **Reescrito tras la sesión de poda + cierre (agosto 2026).** El módulo quedó
> con todo el plan ejecutado salvo la verificación visual y tres extensiones
> declaradas. No queda deuda oculta.

---

## Mensaje para la sesión nueva

```
Continúa la Torre de control en el repo saas-courier, rama feat/frontend-premium-rutax.

Lee CONTINUAR-TORRE.md entero antes de tocar nada. El módulo viene de dos
sesiones de PODA y cierre: se retiró casi todo lo que prometía y no cumplía, y
lo que quedó está construido y verde. No re-agregues nada de la sección
"No va — decidido, no re-litigar".

Lo único bloqueante es la VERIFICACIÓN VISUAL: nadie ha mirado la pantalla desde
todos estos cambios. Empieza por ahí (punto 1 de "Lo que queda").
```

---

## Estado

Rama `feat/frontend-premium-rutax`, sobre `67de4af`. **40 entradas sin
commitear** — nada se ha commiteado en tres sesiones, por decisión del usuario.
Balance del árbol: **1.067 inserciones contra 1.711 borrados** en 34 archivos,
más 6 archivos nuevos y 2 borrados.

Verificación EN VERDE: `npm run typecheck` limpio · `npm run lint` **0 errores**
(154 warnings preexistentes) · `npm test` **2373 passed / 5 skipped** en 147
archivos.

**Archivos nuevos:**
`src/app/(consola)/torre-de-control/acciones.ts` ·
`.../_componentes/panel-marca.tsx` · `.../_lib/marcas.ts` ·
`src/app/(tenant)/dashboard/banda-torre.tsx` ·
`src/lib/fecha-santiago.guard.test.ts` ·
`src/modules/operacion/metricas-fechas.test.ts`

**Borrados:** `.../_componentes/paleta-comandos.tsx` y
`.../_componentes/riel/ficha-senal.tsx`

---

## Lectura obligatoria

1. `CLAUDE.md` — invariantes y módulos.
2. `docs/arquitectura/torre-de-control.md` — diseño técnico.
3. `design_handoff_torre_de_control/README.md` — la interfaz aprobada.
   **⚠️ DESACTUALIZADO**: describe 8 capas y 4 horizontes; hoy hay 6 y 3. Sus 7
   reglas de producto siguen vigentes salvo donde este archivo diga lo contrario.
4. `checklist-pruebas-funcionales-mvp.md` — bloques «Torre de control».
   **⚠️ No registra ni la flota en vivo ni estas dos sesiones.**

---

## Lo que queda, en orden

### 1. VERIFICACIÓN VISUAL — lo único bloqueante

**Nadie ha mirado la Torre desde todos estos cambios.** Es el hueco real, y el
propio repo avisa que ahí es donde aparecen los bugs que las cuatro
verificaciones no ven. En esta sesión eso se confirmó de la peor manera: la
Torre devolvía **500** por un error que typecheck, lint y 2367 tests dejaron
pasar (ver «El bug del `use server`» abajo).

Qué mirar, concretamente:

- **Vista móvil a 390 px** — se corrigieron dos bugs de layout a ciegas
  (`top-14` y `grid-cols-4`), verificados por estilos computados pero NO
  visualmente.
- **Ficha de excepción móvil** tras quitarle el botón Descartar y toda la
  maquinaria de confirmación.
- **Panel de marca operativa** (`panel-marca.tsx`): que quepa sin tapar
  contenido en pantalla baja, y que el flujo completo funcione (tecla `M` →
  clic en el mapa → nota → guardar → aparece en el mapa).
- **Puntos de pedido en el mapa** — capa nueva, nunca vista pintada.
- **Banda de la Torre en el dashboard** del dueño.

> 🛑 **No se pudo automatizar.** La página carga React pero **nunca hidrata**
> bajo CDP: se comprobó de forma concluyente despachando un `SubmitEvent` y
> viendo que React no hace `preventDefault`. El login queda inalcanzable por
> automatización. **Hay que entrar a mano** (`coordinador@despachos-centro.cl` /
> `Demo2026!`) y entonces sí se pueden tomar capturas.
>
> Dos gotchas de entorno ya resueltos, no los redescubras: el dev server
> escuchaba solo en `[::1]` y Chrome no llegaba —`.claude/launch.json` ya lleva
> `-H 0.0.0.0`—, y los procesos lanzados en segundo plano mueren con exit 127;
> hay que arrancarlo con el gestor de preview, que sí sobrevive.

### 2. Extensiones declaradas de la capa de pedidos

La capa ya funciona con las coordenadas que trae Mercado Libre. Falta:

- **Selector de punto al crear un same-day.** Que el coordinador clave el punto
  en un mapa al dar de alta el pedido: más preciso que geocodificar y sin
  llamadas externas.
- **Confirmar/corregir con la coordenada del POD** del conductor, que es la
  única verificada.
- **Google solo para el residuo.** El módulo `integraciones/geocoding` ya tiene
  adaptador Google + stub, y `operacion.pedidos` ya tiene `lat`, `long`,
  `geo_estado`, `geo_confianza` y `geocodificado_en`.
- **Nivel 3 del zoom semántico** (`NivelZoom = 'pedidos'`): la CAPA ya se
  enciende, pero el zoom semántico como tal no se cableó.

### 3. Revisión de `seguridad-cumplimiento`

Dos cosas la esperan, ninguna bloquea el desarrollo pero sí el release:

- **`contexto.marcas_operativas.nota`** es texto libre con posible PII.
- **La capa de pedidos**: aunque el payload ya está minimizado (ver abajo),
  mostrar la posición de cada domicilio es un salto respecto de los agregados
  por zona.

### 4. Documentación desactualizada

`checklist-pruebas-funcionales-mvp.md` y
`design_handoff_torre_de_control/README.md` — ver «Lectura obligatoria».

---

## Lo que se hizo (y por qué, que es lo que no se deduce del diff)

### El bug del `use server` — la lección más cara

```
Only async functions are allowed to be exported in a "use server" file.
```

Dos constantes exportadas desde `acciones.ts` dejaban el módulo **sin ningún
export** y `/torre-de-control` devolvía **500**. Ni typecheck, ni ESLint, ni
2367 tests lo vieron: lo cazó abrir la página. Las constantes viven ahora en
`_lib/marcas.ts`, con la explicación escrita ahí mismo.

**Moraleja operativa: una server action y sus constantes NO pueden compartir
archivo.**

### Bug de calibración del motor de riesgo

`eventos` conservaba 11,76 % de peso efectivo sin que nada poblara
`contexto.eventos_ciudad`: aportaba siempre cero y **las zonas se leían más
calmas de lo que estaban**. Ahora tránsito y eventos van los dos a peso 0 vía
`FACTORES_SIN_FUENTE`, y los cuatro con fuente se renormalizan sobre 0,75:

| Factor | Antes | Ahora |
|---|---|---|
| Presión operativa | 41,18 % | **46,67 %** |
| Clima | 23,53 % | **26,67 %** |
| Aire | 17,65 % | **20,00 %** |
| Histórico | 5,88 % | **6,67 %** |
| Tránsito · Eventos | 0 · 11,76 % | **0 · 0** |

⚠️ **Los puntajes ya guardados en `contexto.riesgo_zona` siguen con los pesos
viejos hasta que el cron vuelva a correr.**

### Bug de fechas UTC vs Santiago (fuera de la Torre)

Varios sitios derivaban el día civil en UTC: **desde las 20:00 de Santiago el
sistema creía que era mañana**. Corregidos: ventana del día del dashboard,
ventana «semana» del SLA (duraba 6 días en vez de 7), trial de 14 días que se
otorgaba de 15, filtro de incidencias, límites de mes de consumo y el offset
clavado de `contexto/olas.ts`.

El guard estático se **elevó a todo `src/`**
(`src/lib/fecha-santiago.guard.test.ts`) con un tercer patrón que faltaba: el
offset de Santiago clavado. `metricas-fechas.test.ts` fija el arreglo con reloj
a las 21:00 — y **se verificó que esos tests FALLAN contra el código viejo**,
reintroduciendo el bug a mano.

`dinero/periodos.ts` se reescribió pero **NO tenía bug**: el offset `-03:00`
quedaba absorbido por el `−1 ms` y el reformateo. Fue endurecimiento.

### Podas — 1.711 líneas fuera

- **Capas de eventos y tránsito**: fuera del contrato, composer, zod, estilo
  MapLibre, fixture y UI. También la E/S muerta. El mapa queda con **6 capas**.
- **Horizonte «Olas»**: fusionado con 72 h. La ola se calcula una vez y se
  muestra en los tres horizontes, así que era un cuarto modo que caía a «hoy».
  Teclas 1–3.
- **Botón Descartar** y `descartable`: solo mutaba estado local y prometía
  «calibrar umbrales» sin nada detrás.
- **`requiereConfirmacion`**: el composer emitía `false` en sus 3 sitios.
- **Todo el rastro de señales de prensa** (`ficha-senal.tsx`, `Senal`,
  `armarSenales`, `origen: 'senal'`, `confianza`…).
- **Paleta ⌘K**: sus 5 comandos ya eran un clic directo en la misma pantalla
  fija. Los atajos sueltos (1–3, L, M, Esc) se conservan.
- **`vehiculosAfectados`**: ver «No va».

### Marcas operativas — terminadas

`acciones.ts` (`crearMarcaOperativa` / `borrarMarcaOperativa`) + `panel-marca.tsx`.
Usa el cliente **autenticado**, no `service_role`: la tabla lleva `tenant_id` y
tiene RLS real. La hora de vigencia se interpreta en Santiago. El error del
motor **no se propaga** al usuario: puede citar la fila, y la fila trae la nota.

### Banda de la Torre en el dashboard del dueño

`banda-torre.tsx`. El dueño no es el usuario diario de un tablero de viewport
fijo con atajos de teclado — eso es de coordinador. Tres piezas y un enlace.
**Silencio por defecto**: sin riesgo medio o superior y sin excepciones, no
aparece. Y si la Torre falla, el `catch` devuelve `null` y el dashboard sigue.

> El límite de módulos se respeta: quien llama a `contexto` es la PANTALLA, no
> `operacion` ni `dinero`.

### Capa de pedidos — coordenadas baratas primero

La ingesta captura `receiver_address.latitude/longitude` del batch de shipments
que ML **ya consultaba** para filtrar Flex: cero llamadas nuevas. ML rellena esos
campos solo a veces; sin coordenada, el pedido sigue a la cola de geocoding.

**La minimización está en el contrato y en el SQL, no en el render:**
`PedidoEnMapa` lleva punto, estado, cerrado y zona — **sin dirección, sin
nombre, sin teléfono** — y el `select` de `obtenerPedidosUbicados` es igual de
corto. Hay un test que falla si alguien mete PII al payload.

El mapa pinta dos capas **sin etiqueta de texto**: abiertos en punto lleno,
cerrados en contorno gris.

> ✅ **Decisión de privacidad del usuario:** punto siempre visible, **dirección y
> nombre solo al abrir el pedido**.

---

## No va — decidido, no re-litigar

- **Tránsito (TomTom).** Fuera de alcance. API de pago, el conductor ya ve la
  congestión en Waze, y el coordinador no puede accionar sobre ella.
- **Eventos de ciudad.** Sin fuente sin Bloque D, y no la tendrá barata.
- **Bloque D — señales de prensa.** PARADO por decisión del usuario, que quiere
  evaluar si el gasto vale lo que aporta o buscar un objetivo de IA más valioso.
  No es bloqueo técnico. No hay tier gratuito de la API de Claude; con Batch API
  (−50 %) y ~60 eventos/día el costo iba de **~2,5 a ~12,5 USD/mes** según
  modelo. Las tablas `contexto.senales` y `senales_tenant` se dejaron en BD
  (vacías); la UI y el contrato ya no lo prometen.
- **Entidad `vehiculos` / dígito de patente.** `vehiculosAfectados` se quitó del
  contrato: la restricción **permanente** solo aplica a vehículos sin sello
  verde (una flota moderna daría 0 siempre) y la de **episodio** depende de un
  decreto con dígitos arbitrarios que el sistema deliberadamente no adivina. La
  restricción quedó como **línea de contexto**, no como alerta cuantificada.
  Razón del usuario para no construirla: *«con saber si un conductor tuvo un
  problema ya rastreamos los paquetes en riesgo»* — la unidad de preocupación es
  el conductor, no el vehículo.
- **Cuarto horizonte «Olas».** Fusionado con 72 h.
- **Paleta de comandos ⌘K.**
- **Cortar la vista móvil.** Se propuso y el usuario la quiso conservar.

---

## Decisiones vigentes

- **Mapa**: MapLibre + PMTiles, geometría comunal DPA 2023 real, basemap
  acromático. Atribución «Weather data provided by OpenWeather» al pie: quitarla
  incumple la licencia.
- **Viewport full-bleed sin shell**, en `(consola)`. La regla general no cambia:
  toda pantalla nueva del courier va a `(tenant)`.
- **Carve-out de `tenant_id`** en `contexto`, con deny-all real.
- **Horizontes precalculados**; a 72 h se cuentan solo pedidos ya ingestados.
- **`contexto` es el sexto módulo.** `operacion` y `dinero` NO pueden llamarlo.
- **Preferencias de usuario** (capas, horizonte, modo lista) en `localStorage`.
- **Umbrales PM2.5** (Plan Operacional GEC 2026): Alerta 80 · Preemergencia 110
  · Emergencia 170, sobre la media móvil de 24 h.
- **`monto_comprometido_clp` sale de `identidad.tarifas`**, no de
  `dinero.lineas_cobro`.
- **Clima y aire con OpenWeather.** Clima en pasos de 3 h (`rain.3h` acumulado).
  Grilla de 14 puntos, no 52 comunas.

---

## Gotchas verificados — caros de redescubrir

1. **Una server action y sus constantes NO comparten archivo.** Un `export const`
   en un módulo `"use server"` lo deja sin ningún export y tumba la página con
   un 500. Ver `_lib/marcas.ts`.
2. **`maplibre-gl` clavado en `5.24.0` (EXACTA). NO subir a 6.x.** La 6.0.0 dejó
   de empaquetar su Web Worker; Turbopack no resuelve ese patrón y **MapLibre
   queda mudo**: ni un evento, `getStyle()` → `null`, lienzo en blanco, cero
   errores en consola.
3. **Esquema nuevo = exponerlo a PostgREST** en `[api] schemas` de
   `supabase/config.toml`. Exponer NO concede acceso.
4. **Tailwind 4 hace tree-shaking de las variables de `@theme`** que ninguna
   utilidad referencia; `var(--token)` en CSS crudo puede quedar inválido EN
   SILENCIO.
5. **CSS de terceros sin capa gana SIEMPRE al CSS en capa.** `maplibre-gl.css`
   se importa sin capa: posicionar sus nodos con estilos EN LÍNEA.
6. **`outline-none` + `outline-2` en Tailwind 4 NO dibuja nada.** Falta
   `focus-visible:outline-solid`.
7. **Si tocas `@theme` en `globals.css`, reinicia el dev server.**
8. **Las fechas civiles (`YYYY-MM-DD`) no son instantes.** Usa
   `src/lib/fecha-santiago.ts`. El guard de `fecha-santiago.guard.test.ts` barre
   todo `src/`; su única exención es el propio `fecha-santiago.ts`.
9. **Lo que devuelve un `step.run` de Inngest pasa por JSON**: los `Date` llegan
   serializados como string.
10. **UN solo `BaseMiddleware` de Inngest.** Un segundo colapsa el tipo de
    `step.run` a `{}`.
11. **En MapLibre, engancha el cableado de datos a `style.load`, NO a `load`.**
12. **PostgREST corta en `max_rows = 1000` SIN AVISAR.** Usa `leerTodasLasFilas`
    o `count: 'exact', head: true`.
13. **La Torre no se puede verificar por CDP.** El panel embebido no compone
    frames (`visibilityState: hidden`) y en Chrome real la página no hidrata bajo
    control remoto — el submit del login no pasa por React. Hay que entrar a
    mano.
14. **El dev server debe arrancar con `-H 0.0.0.0`** (ya está en
    `.claude/launch.json`): con el bind por defecto escucha solo en `[::1]` y
    Chrome no llega. Y **los procesos en segundo plano mueren con exit 127**:
    hay que usar el gestor de preview.
15. **Windows: no reescribas archivos con Python sin preservar CRLF.** Lee y
    escribe con `newline=''`. Pasó: 4 archivos con diffs de ~3.000 líneas de
    puro cambio de fin de línea.
16. **Cuidado con `sed`/regex anchos.** En estas sesiones un
    `toBe(99)→toBe(100)` global tocó un test no relacionado; un
    `{ id: 'transito',` borró 10 filas de FACTORES además de las 2 de capas; y
    un regex de bloque se llevó el cierre de un `describe` entero y su helper.
    Acota siempre por contexto y revisa el diff.
17. **Docker Desktop encadena sockets huérfanos tras un cierre sucio.** Renombrar
    las carpetas, **nunca «Reset to factory defaults»** (borra los volúmenes,
    incluida la base local con los datos de demo).

---

## Cómo trabajar

- Secuencia de orquestación de `CLAUDE.md`. `qa` entra después de cada bloque.
- Verificación estándar: `npm run typecheck`, `npm run lint`, `npm test` y
  `npx supabase test db`.
- **Y míralo en el navegador.** En estas sesiones el bug más grave —la Torre
  devolviendo 500— pasó las cuatro verificaciones y solo lo cazó abrir la
  página. El resto los cazaron tests que escribí a propósito para el borde, y
  uno lo cazó ESLint (`useEffect` sin `pedidos` en dependencias: el mapa no
  repintaba).
- Para código con BD, además un **smoke test contra Supabase local**.
- Arranque del entorno en `docs/PRUEBA.md`. Tenant de demo: «Despachos del
  Centro». Credenciales en su tabla de credenciales.
- Si algo del handoff choca con un invariante, dilo en vez de resolverlo por tu
  cuenta.
