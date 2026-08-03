# Torre de control v2 — prompt de traspaso a implementación

> Andamiaje. Bórralo cuando las tres vías estén hechas y el checklist de pruebas
> tenga sus entradas nuevas.

---

## Mensaje para pegar en la sesión nueva

```
Lee PROMPT-TORRE-V2-IMPLEMENTACION.md entero antes de tocar nada. El alcance ya
está aprobado en docs/torre-de-control/alcance-v2.md: no lo re-litigues, léelo y
ejecútalo. Dime con qué vía arranco (A, B o C) y por qué, y espera mi
confirmación antes de escribir código.
```

---

## 0. Qué es esto

El rediseño de la Torre de control ya pasó por su sesión de definición
(2026-08-03, commits `af33680`, `9668e2a`, `6b98473`). **El alcance está cerrado
y aprobado.** Lo que falta es construirlo.

**Lectura obligatoria, en este orden:**

1. `docs/torre-de-control/alcance-v2.md` — **la fuente de verdad.** Las 12
   funcionalidades, los 17 retiros, las 6 reglas de producto y las consecuencias
   técnicas tabla por tabla.
2. `docs/arquitectura/mapa-torre-v2.md` — la decisión de cartografía, con la
   medición de rendimiento que la sostiene.
3. `docs/arquitectura/torre-de-control.md` — diseño técnico. **Ojo: §4, §8 y §13
   están marcadas como superadas.** Lo vigente es el esquema `contexto`, los
   puertos, los jobs y el pipeline de cartografía.
4. La sección «Torre de control» de `CLAUDE.md`.

**Lo que NO es esto:** no es una sesión de definición. Si algo del alcance te
parece mal, dilo en una frase y sigue construyendo lo demás — no abras una
discusión de producto sin que el usuario la pida.

---

## 1. Lo decidido — no re-litigar

- **El handoff de diseño no manda.** Está archivado en `docs/_historico/torre-v1/`.
  Se conserva para entender por qué el código de hoy es como es, **no** para
  seguirlo. Lo mismo con `datos-dummy.ts`: el contrato de tipos **ya no está
  congelado**.
- **La unidad primaria es la COMUNA.** Zoom semántico: comuna → agrupaciones →
  punto de entrega individual. Las zonas del courier siguen existiendo detrás
  (corte, conductores, capacidad) pero no mandan el mapa.
- **La cifra es una magnitud, nunca un índice.** El puntaje 0–100 y sus seis
  factores se retiran enteros.
- **Clima y aire salen del producto.** No es «se ocultan»: se apagan.
- **Un solo horizonte: hoy.** La ola es lo único que mira adelante.
- **Solo lectura.** `ver_torre_control` no cambia y no hay bitácora nueva.
- **La Torre baja a `(tenant)`** y el grupo `(consola)` se retira entero.
- **En el punto se muestra el código de envío**, nunca la dirección.
- **El mapa se queda en MapLibre + PMTiles auto-hospedado.** No evalúes
  proveedores otra vez: está medido y documentado.

---

## 2. Las tres vías

```
Vía A (datos y backend)  ─┐
                          ├─→  Vía C (la pantalla)
Vía B (rediseño visual)  ─┘
```

**A y B son independientes entre sí.** C necesita las dos. El usuario elige por
dónde parte; si no lo dice, **recomienda A**: es la más grande, es demolición del
contrato (mientras más tarde, más código nuevo hay que rehacer encima) y al
terminar hay dato real por comuna aunque la pantalla siga fea.

Cada vía es su propia sesión y su propio commit. **No mezcles A con B.**

---

## 3. Vía A — datos y backend

**Objetivo:** que `cargarTablero` devuelva pendientes por comuna, en vivo, sin
puntaje de riesgo y sin clima ni aire. Al terminar, la pantalla vieja puede verse
rota — eso es esperable y se arregla en C.

### Orden de trabajo

1. **Contrato** (`arquitecto` → `src/modules/contexto/contrato-torre.ts`).
   Es un tipo **vivo**: reescríbelo. Cae `TorreRespuesta.horizontes`; la unidad
   pasa a comuna; entra el código de envío y el `+N` de agrupación por ubicación.
2. **Esquema** (`base-datos-rls`). Migración de retiro para las 7 tablas de
   §5.1: `clima_horario`, `aire_horario`, `eventos_ciudad`, `senales`,
   `senales_tenant`, `marcas_operativas`, `riesgo_zona`. Conservar `calendario`,
   `eventos_comerciales`, `fuentes_estado` y `restriccion_vehicular`.
   Actualizar los tests pgTAP de aislamiento en consecuencia.
3. **Jobs y adaptadores** (`backend` + `integraciones`). Retirar
   `refrescar-clima.ts`, `refrescar-aire.ts`, `recalcular-riesgo.ts` y sus crones;
   retirar `integraciones/contexto/clima/`, `aire/`, `openweather-comun.ts`,
   `grilla-rm.ts`. Conservar `calendario/`, `http.ts`, `resultado.ts`,
   `errores.ts`. Retirar `motor-riesgo.ts` y sus ~70 tests, y `macro-zonas-rm.ts`.
4. **Composer** (`backend`). Reescribir `agregacion.ts` para agregar por comuna y
   `composer/armado-*.ts` contra el contrato nuevo. `olas.ts` se conserva.
5. **Realtime** (F5). **Ya está resuelto y es casi gratis**: reutiliza
   `src/components/tiempo-real/indicador-en-vivo.tsx`, que ya se suscribe por
   defecto a `operacion.pedidos`, agrupa eventos con debounce de 800 ms y dispara
   `router.refresh()`. Solo hay que pasarle también la tabla de incidencias y
   verificar que esté en la publicación `supabase_realtime`.
6. **`qa`**: aislamiento multi-tenant y conteos.

### Lo que hay que migrar junto, o se rompe

**`src/app/(tenant)/dashboard/banda-torre.tsx` consume `cargarTablero`.** Es la
pieza mejor calibrada del módulo (muestra tres líneas solo si hay algo que
mirar). Migra en el mismo cambio. **No la rompas.**

---

## 4. Vía B — rediseño visual

**Objetivo:** el lenguaje visual de la Torre v2. Es lo único que esta pasada
decide; no toca datos.

- **Qué decide:** paleta, tipografía, retícula, densidad, y cómo se ve el escalón
  entre los tres niveles de zoom (comuna → agrupaciones → punto).
- **Tema claro y oscuro**, siguiendo el tema del sistema. Decisión ya tomada.
- **Referencia de «premium»: Uber / Rappi**, y específicamente la **calidad
  cartográfica y tipográfica del plano** — no 3D, no cámara inclinada.
- **Los 12 tokens `--tc-*` de `src/app/globals.css`** vienen del handoff
  retirado. Esta vía decide su destino: se quedan, se ajustan o se absorben en
  `DESIGN_SYSTEM.md`. **Es la única sesión autorizada a tocarlos.**
- **Regla que sobrevive y hay que respetar:** el **rojo está reservado a la
  incidencia abierta**. Es lo único accionable de la pantalla; nada decorativo
  puede usarlo.
- **Dos estilos de mapa** (claro y oscuro) sobre las mismas tiles. Es un segundo
  objeto de estilo, no un segundo basemap.

Empieza con `ux-ui` (flujos y jerarquía) antes de que `frontend` toque nada.

---

## 5. Vía C — la pantalla

Necesita A y B hechas.

- **Mudanza a `(tenant)`.** Retirar el grupo `(consola)` entero, incluida la
  duplicación de guards de su `layout.tsx`.
- **El ancho ya tiene mecanismo.** `src/components/app-shell/app-shell.tsx:539`
  ya conmuta `max-w-5xl`/`max-w-6xl` con una prop `relajado`. Añadir ahí una
  variante ancha (o `full`) es la solución limpia: **no le quites el `max-w` a
  todas las pantallas**.
- **Pantalla completa** con la Fullscreen API sobre el contenedor del mapa. No es
  una ruta nueva ni un layout nuevo: es estado local.
- **Retirar el árbol móvil** (`_componentes/movil/`). El móvil se hace fuera de
  este repo, en la app nativa.
- **Retirar el andamiaje**: `_fixture/estado-torre.ts`, `_fixture/variantes.ts` y
  el `?estado=`. Los importan ~20 componentes, así que va al final.
- **Corregir de paso** (`alcance-v2.md` §7 del doc de mapa): `_lib/mapa/config.ts`
  cita `scripts/mapa/publicar-cartografia.mjs`; el archivo real es
  `publicar-basemap.mjs`. Y los comentarios que aún citan
  `docs/torre-de-control/datos-dummy.ts` como «contrato congelado» — es ruta
  muerta.
- **Trabajo de cartografía** (`docs/arquitectura/mapa-torre-v2.md` §5): publicar
  glifos → encender etiquetas en tres niveles → jerarquía vial → dos temas.

---

## 6. Minas conocidas

Estas ya explotaron una vez en este repo. Todas aplican a este módulo.

- **`maplibre-gl` clavado en `5.24.0` exacto. NO subir a 6.x.** La 6.0.0 carga su
  Web Worker como archivo suelto y Turbopack no resuelve ese patrón dentro de
  `node_modules`. **Falla mudo:** ni un evento, `getStyle()` devuelve `null`, el
  lienzo queda en blanco y la consola limpia.
- **PostgREST corta en 1.000 filas por defecto, en silencio.** Mata cualquier
  consulta que después se agregue — y contar pedidos por comuna es exactamente
  ese patrón. Usa `leerTodasLasFilas` (`src/lib/supabase/leer-paginado.ts`, ya en
  uso en `composer/consultas.ts`) o `count: 'exact'`. **Ya mordió al job de
  riesgo una vez.**
- **Tailwind 4 y CSS de terceros:** `maplibre-gl.css` se importa **sin capa**, y
  el CSS sin capa gana SIEMPRE al CSS en capa (donde vive todo Tailwind), sin
  importar la especificidad. Cualquier nodo que MapLibre marque con sus clases se
  posiciona con **estilos en línea**, no con utilidades.
- **No promuevas los pedidos a anclas HTML.** Medido: 600 anclas HTML cuestan
  31,77 ms/frame (≈31 fps). Hoy van por la fuente GeoJSON de MapLibre y ahí se
  quedan. Si alguna vez hay que subir el número de anclas, el 91 % del costo es
  **layout thrash** (`offsetWidth` intercalado con escrituras de `transform`): la
  corrección barata es **cachear las medidas**, no rediseñar el des-solapado.
- **Guard de zona horaria en `src/modules/contexto/`:** hay un test que barre el
  directorio y falla si truncas un instante UTC a fecha civil, o si le pegas una
  hora UTC a una fecha civil chilena. No lo esquives: son bugs reales.
- **Inngest:** dos `BaseMiddleware` rompen los tipos de `step.run`. Si tocas
  crones, cuidado ahí.
- **`tracking_token` NO va en la Torre.** Es público y viaja en la URL
  `/tracking/[token]` que se comparte con el destinatario. El identificador
  operativo es `ml_shipment_id` (Flex) o `codigo_interno` (same-day).
- **El seed de demo tiene un bug abierto de idempotencia al cruzar de mes** (ids
  con mes relativo revientan la PK al re-aplicarlo). Si el arranque local falla
  por PK duplicada, es eso y no tu código.
- **Hay un cambio sin commitear en `src/modules/contexto/jobs/recalcular-riesgo.ts`**
  (quita `eventos` del payload). El usuario decidió dejarlo. Ese job se retira en
  la Vía A: resuélvelo ahí.

---

## 7. Invariantes que no se negocian

- **Aislamiento por RLS en la base.** Toda tabla que crezca al dar de alta un
  courier lleva `tenant_id`. Las tablas de referencia de `contexto` son
  **deny-all** para sesiones de usuario: RLS enable+force sin políticas, sin vista
  espejo en `public`, grants solo a `service_role`. Ojo: en este repo
  `authenticated` incluye seller y conductor.
- **`operacion` y `dinero` NO pueden importar `contexto`.** La dependencia va en
  un solo sentido. La Torre leyendo en vivo de `operacion` va en la dirección
  permitida.
- **Minimización de datos personales.** Sin dirección ni nombre del destinatario.
  Sin recorrido del conductor: una sola fila, la última posición, sin histórico
  (Ley 21.431). Reintroducir cualquiera de las dos pasa por
  `seguridad-cumplimiento` **antes** de construirse.
- **Atribuciones por licencia:** `© OpenStreetMap` y `Límites DPA 2023 ·
  SUBDERE/INE` se quedan mientras exista el basemap. La de **OpenWeather se
  retira**, pero solo cuando no quede ningún dato de OpenWeather en el producto
  (o sea, al final de la Vía A).
- **Cartografía:** `scripts/mapa/`, el bucket `contexto-mapas` y
  `public/mapas/comunas-rm.topojson.json` **se conservan**. La geometría es
  **comunal, nunca disuelta por zona** — el disuelto lo hace el cliente.
- **No microservicios, no colas propias.** Jobs por Inngest.

---

## 8. Verificación

Estándar del repo, y va completo antes de decir que algo está hecho:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

- `npm run lint` debe dar **0 errores** (hay ~154 warnings preexistentes; no son
  tuyos, no los cuentes como regresión).
- `npm test` — la suite ronda las 2.000 pruebas. Si retiras el motor de riesgo,
  el conteo **baja** ~70: eso es correcto, no una regresión.
- Aislamiento: `npx supabase test db` (pgTAP).
- Funcional en vivo: `docs/PRUEBA.md` para levantar el stack, y
  `torre_de_control_arranque_local` para el orden exacto de los jobs de contexto.
- **En el navegador, de verdad.** Usa el Browser pane. Ojo: si otra sesión ya
  tiene un dev server en esta carpeta, choca por `.next` — `autoPort` lo resuelve.
- Al terminar, agrega las entradas nuevas al `checklist-pruebas-funcionales-mvp.md`
  (las de la v1 están marcadas como registro histórico, no las reescribas).

---

## 9. Delegación sugerida

`arquitecto` (contrato comuna-first) → `base-datos-rls` (retiro de tablas) →
`backend` / `integraciones` (jobs, composer, realtime) → `ux-ui` (Vía B) →
`frontend` (Vía C) → `qa`.

Los subagentes **no se llaman entre sí**: la sesión principal coordina.
