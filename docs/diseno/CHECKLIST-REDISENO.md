# Rutax · Checklist del rediseño

**Abierto el 22-08-2026.** Se trabaja contra este documento sesión tras sesión.

> **Qué es.** El rediseño está diseñado y cerrado: 6 documentos en esta carpeta y 31 tableros
> visuales en el proyecto de Claude Design `184f328b-adb3-4f5a-93f5-69bf43becdb6`. Esto es la
> bajada a código, bloque por bloque, con lo hecho marcado.

---

## Cómo se usa

- **Estado por ítem:** `[x]` cuando está hecho y verificado · `[ ]` pendiente · `N/A` si se
  descarta, con la razón. Anota la evidencia al final del ítem (archivo, o qué se probó).
- **El orden manda.** Es el de `RUTAX-COSTO-DE-IMPLEMENTACION.md` §10 — tokens → estado → tablas →
  marco → dinero → app → sub-sistemas → sitio. **No se reordena sin escribir por qué.**
- **La regla de trabajo que está funcionando:** se construye el componente nuevo y **el viejo
  delega en él**, para que las pantallas existentes hereden sin tocarlas. El molde es
  `src/components/ui/badge-estado.tsx` delegando en `DistintivoEstado`. Esto se monta sobre un
  producto en producción: lo nuevo y lo viejo conviven meses, y **ninguna decisión del catálogo
  exige que todo cambie el mismo día**.
- **Los tableros se traen de a uno.** Con `DesignSync` (`get_file`), y **solo desde la sesión
  principal — no funciona en subagentes**. Pesan entre 60 y 100 KB: se trae el del bloque que se
  está implementando, no todos.
- **Un bloque no se cierra sin su pasada de verificación** (anexo D).

### Dos avisos para no perder tiempo

**1 · Los ocho anexos y `HALLAZGOS-TECNICOS.md` no existen.** `docs/rediseno-2026/RUTAX-INVENTARIO.md`
los cita —`ANEXO-A` a `ANEXO-H`, «4.703 textos citados con archivo y línea», y 36 defectos
técnicos— pero **no están en el repo** (el commit `6b6b9f0` subió 10 archivos) **ni en el proyecto
de Claude Design** (`list_files` devuelve los 6 documentos, los 31 tableros y 2 uploads). No los
busques. El maestro alcanza: su §5 tiene el árbol completo de pantallas y su §13 las 35 brechas de
diseño con su evidencia. El texto literal de cada pantalla se lee del código cuando toque esa
pantalla.

**2 · La aritmética del documento de costo no cuadra.** Su resumen declara 100 componentes
(31 re-estilo / 27 extender / 42 de cero), pero **las ocho tablas por bloque suman 108**
(29 / 24 / 55), y `RUTAX-SISTEMA-DE-DISENO.md` §8 dice 92. Las tablas son la única lista
enumerada: **este checklist cuenta contra ellas**.

### Dos numeraciones distintas que se llaman igual

Es la confusión más fácil de este paquete y conviene tenerla clara:

| | Qué es | Dónde vive |
|---|---|---|
| **Bloques del catálogo 1–8** | Cómo se agrupan los 108 componentes (primitivas, estado, tablas, contenedores, marco, retroalimentación, flujos, sub-sistemas) | `RUTAX-COSTO-DE-IMPLEMENTACION.md` §1–§8 |
| **Bloques de construcción 1–8** | En qué orden se construyen, por dependencia técnica | `RUTAX-COSTO-DE-IMPLEMENTACION.md` §10 |
| **Bloques de diseño B1a–B8** | Cómo se agrupan las ~90 pantallas dibujadas | `RUTAX-FICHA-DE-CIERRE.md` §1, pasada 4 |

**Este checklist se organiza por los bloques de construcción.** Cuando dice «bloque 5» significa
Dinero, no «Marco y navegación» del catálogo.

---

## Tablero de estado

| # | Bloque de construcción | Estado de la capa | Lo que falta | Bloqueado | Tablero que traer |
|---|---|---|---|---|---|
| **1** | Tokens y primitivas | **hecha** — tokens, puente, fuentes, 8 re-estilos, selector de fecha, `interruptor` | `credencial de una sola vez` | — | *(no hizo falta)* |
| **2** | Estado | **hecha** — 8 de 10 · 25 ejes · 33 correcciones con prueba mecánica | los 4 vocabularios que faltan viven en la app del conductor (bloque 6) | — | *(no hizo falta)* |
| **3** | Tablas | **hecha** — las 4 piezas nuevas | adopción: **0 pantallas reales**, solo `kitchen-sink` | — | *(no hizo falta)* |
| **0** | **Cola de 1–3** | **5 de 6 hechos** — interruptor, 33 correcciones, 55 sitios, 13 vocabularios absorbidos, lint | solo 0.2b, bloqueada por trabajo en curso | — | — |
| **4** | **Marco** | **6 de 8** · los 2 abiertos dependen de decisiones tuyas | índice propio de configuración (B3b) · buscador del backstage | #12 · #21 | `Rutax P1 Pedidos` ✅ traído |
| **5** | **Dinero** | **5 de 16** | 11 componentes · 15 de 26 acciones · multi-período del atribuidor | #7 a #11 | `P4` ✅ `B2a` ✅ `B2b` ✅ |
| **6** | **App del conductor** | 15 componentes · **0 hechos** | 15 · **en el repo `rutax-conductor`** + el retiro de la PWA | #22 a #26 | `Rutax B5 App del conductor` · `P5` |
| **7** | **Sub-sistemas** | 12 componentes · **0 hechos** | cartografía 5 · gráficos 4 · impresos 2 · correos 1 | #1 · #2 · #3 · #27 | `Rutax Subsistemas` · `B1a` · `B8` |
| **8** | **Sin sesión y sitio** | 3 componentes · **0 hechos** | 3 + `not-found.tsx` + las 6 páginas del sitio | #28 · #29 · #30 | `Rutax B7 Sin sesion` · `B7b` · `Sitio comercial` |
| **9** | *(no está en §10)* | 12 componentes sin bloque asignado | 12, repartidos en 9a–9d | #4 · #5 · #6 · #13 a #20 | `B1b` · `B3a` · `B3b` · `P7` |

**Los 30 marcados NUEVO están todos bloqueados por una decisión del usuario** (anexo A). Están
diseñados y aislados: descartar cualquiera no obliga a rediseñar nada, así que **el resto de cada
bloque avanza igual**.

---

# Bloques 1 a 3 · lo que ya está en el código

Commit `da1c3ab`. **Se construyó la capa, no la adopción**: ninguna pantalla se reestructuró, a
propósito. Lo que falta de adopción está en el bloque 0 y repartido en los bloques 4 a 8.

## Bloque 1 · Tokens y primitivas

- [x] **`tokens.css` aplicado** — `src/app/rx-tokens.css` (691 líneas) con los cuatro temas:
      `dark` (base), `light`, `sun` y `night`. Más tipografía, espaciado, radio, movimiento, la
      excepción de tema del banner suplantado, el bloque `@media print` y `[data-rx-media="thermal"]`.
- [x] **El puente a shadcn** — `src/app/rx-puente.css` (226 líneas) repunta `--background`,
      `--primary` y compañía hacia los `--rx-*`. Usa `html:root` (0,0,1,1) en vez de `:root`
      (0,0,1,0) para ganar sin depender del orden de importación, que en Tailwind 4 no se puede
      controlar. **Esto es lo que hace que los 30 componentes existentes y las 74 pantallas se
      re-tiñan sin tocar un archivo de componente.** Se revierte borrando dos líneas de `globals.css`.
- [x] **El proveedor de tema escribe `class` Y `data-rx-theme`** — `src/components/theme-provider.tsx`.
      Los dos mecanismos tienen que moverse juntos: el `:root` del sistema nuevo es el tema OSCURO,
      y escribir solo la clase haría que el producto abriera oscuro para todos.
- [x] **Chivo y Azeret Mono** con sus pesos declarados (400/500/600/700 y 400/500/600).
      Subconjuntar de menos deja negrita sintética en una columna de números.
- [x] **`selector de fecha`** — `src/components/filtros/filtro-fecha.tsx`. Día exacto, rango con
      calendario y atajos en un mismo control. Lo construyó el trabajo de filtros (`d754316`),
      antes del rediseño; cumple el contrato del catálogo.
- [x] **Los 8 re-estilos de formulario** — heredados por el puente, sin tocar archivo.
- [x] **`interruptor`** — DE CERO. Construido en el bloque 0 como `src/components/ui/interruptor.tsx`.
- [ ] `credencial de una sola vez` — DE CERO. Sin bloque en §10, ver bloque 9.

## Bloque 2 · Estado

- [x] **`tonos-estado.ts`** — `src/lib/ui/tonos-estado.ts`. Los seis tonos (`balanced`, `progress`,
      `attention`, `fault`, `neutral`, `inert`), la traducción mecánica desde las seis variantes
      heredadas, y **la tabla de correcciones por `eje:valor` con la razón escrita de cada una**.
      Sin esa razón, la próxima persona la «arregla» de vuelta.
- [x] **`DistintivoEstado`** — `src/components/ui/distintivo-estado.tsx`. Tres señales: tono, glifo
      y etiqueta. `inert` agrega la cuarta, la trama, que es lo que distingue un cancelado de una
      celda vacía en monocromo.
- [x] **`distintivo inerte con trama`** — el tono `inert` con `rx-inert`.
- [x] **`EtiquetaProcedencia`** — `SD` · `FLEX` · `SHOP`, en mono, con borde y **sin color**.
- [x] **`GlifoDireccion`** — glifo solo, y **nada cuando la dirección está bien**: marcar lo normal
      gasta la señal.
- [x] **`BanderaBloqueo`** — COBRO/LIQ y FACT/PAGO, siempre con su rótulo visible, encendidas o
      apagadas.
- [x] **`badge-estado` delega** — ya no dibuja nada. Las 32 llamadas de producto heredan el sistema.
- [ ] **`distintivo de modo de pruebas`** — EXTENDER. Existe `BadgeModoDte`
      (`src/app/(tenant)/dinero/badge-modo-dte.tsx`, 38 líneas), sin re-expresar al sistema. Va en el bloque 5.
- [ ] `distintivo de acuse de escaneo` — DE CERO, 3 variantes. Va en el bloque 6.

## Bloque 3 · Tablas

- [x] **`BarraCajones`** — `src/components/ui/barra-cajones.tsx`. Con **el cajón que queda fuera de
      la suma a propósito** y la declaración de que no cuadra: sin esa línea alguien suma los
      cajones, no le da, y reporta un bug que no existe. Los contadores cuentan sobre el conjunto
      filtrado, nunca sobre la página.
- [x] **`contador de cajón`** — dentro del anterior.
- [x] **`BarraSeleccion`** — `src/components/ui/barra-seleccion.tsx`. Con **la composición** de lo
      seleccionado, no solo el conteo, y anclada abajo.
- [x] **`FranjaCambiosPendientes` + `MarcadorFilaActualizada`** — `src/components/ui/cambios-pendientes.tsx`.
      La regla mixta: lo que ya está en pantalla se actualiza en su lugar; lo que entraría nuevo se
      acumula y se anuncia, **no se inserta**. Porque si la lista se reordena mientras alguien
      selecciona treinta filas para asignar, pierde la selección o toca la equivocada.
- [ ] **Adopción: cero pantallas de producto.** Los cuatro solo se usan en `/kitchen-sink`.
      `preparacion/asignar` tiene su **propia** `BarraSeleccion` local
      (`_componentes/barra-seleccion.tsx`), sin relación con la nueva. Repartido en los bloques 4–8.
- [ ] `tabla con selección múltiple`, `selección táctil en tres niveles`, `tabla de densidad 32`,
      `aviso de truncamiento`, `esqueleto de tabla`, `paginación` — pendientes, en sus bloques.

---

# Bloque 0 · La cola de los bloques 1 a 3

**Por qué existe.** Los bloques 1–3 construyeron la capa y la dejaron sin adoptar. Lo sistémico y
barato va junto acá, adelante del bloque 4; la adopción pantalla por pantalla se reparte en los
bloques 4–8, cuando cada pantalla se toque.

**Desbloquea:** que las correcciones de tono del sistema **se vean** en producción.

> **Corrección de conteo (22-08-2026).** La primera versión de este documento decía «41 llamadas
> directas, 32 de producto». El número real es **50 en total y 46 de producto**: la búsqueda que lo
> midió no veía los `<BadgeEstado` partidos en varias líneas. Los conteos de abajo son los buenos.

- [x] **0.1 · `interruptor` construido** — `src/components/ui/interruptor.tsx`, sobre
      `radix-ui`. **Se llama `interruptor`, no `switch`**: los nombres del catálogo se usan tal cual
      en el código, y este documento decía `switch.tsx` por inercia de shadcn.
      Trae lo que el catálogo le pide —los estados y la **etiqueta de consecuencia**— más
      `motivoDeshabilitado`, que es la versión de «deshabilitado con motivo» para un control que
      no se puede tocar. Sin sombras, riel en `--rx-radius-pill`, acento como relleno vía
      `bg-primary`, y la duración por `--rx-dur-quick`, que bajo `prefers-reduced-motion` ya vale
      `0ms` en `rx-tokens.css` — no hace falta una consulta de medios propia.
      **Verificado en el navegador**, seis variantes en `/kitchen-sink`: `role="switch"` y
      `aria-checked` correctos, `aria-describedby` colgando la consecuencia, `aria-busy` en el
      estado cargando, el pulgar viajando de 2 px a 18 px, cero sombra, y los **cuatro temas**
      respondiendo distinto (en `sun` el riel va en negro sólido pleno, regla 12).

- [x] **0.2 · `eje` + `valor` en las llamadas con vocabulario central** — **55 sitios en 33 archivos**, de 0 que había.
      El `eje` va **tipado contra `NombreEje`**, así que un nombre inventado no compila: era la
      única forma de que un typo no quedara como una corrección muerta en silencio.
      Además, 7 sitios que no tenían enum ninguno —booleanos y cadenas escritas a mano— pasaron a
      `DistintivoEstado` con su tono explícito, decidido por el registro de objetos. **Ahí es donde
      `inert` aparece por primera vez en producción**: cuenta de conductor suspendida (§7.4), usuario
      suspendido (§9.3), y plan y aviso inactivos (§11.3, mismo criterio). Antes eran el mismo gris
      que algo pendiente.

- [ ] **0.2b · Las 5 llamadas de `operaciones/` — BLOQUEADAS.**
      `(tenant)/operaciones/page.tsx` (3) y `(tenant)/operaciones/[pedidoId]/page.tsx` (2) están
      **modificadas sin commitear** por trabajo en curso ajeno al rediseño. Tocarlas mezcla dos
      cambios en un mismo diff. Se hacen cuando ese trabajo aterrice; los ejes son `pedido`, `geo`,
      `cobertura` e `incidencia`, todos ya declarados.

- [x] **0.3 · Los vocabularios que vivían fuera del sistema, absorbidos** — eran **13**, y ninguno
      pasaba por `tonoDeEstado`. Seis se movieron a `traduccion-estados.ts` como vocabularios de
      primera clase, con su tipo, su mapa, su texto y su `traducir*`: **salud de conexión de fuente**
      (§12.3), **invitación** (§9.3), **folio CAF**, **certificación DTE**, **conexión bancaria de
      cobranza** y **salud de jobs**. Más el **SII**, que ya estaba en el archivo pero con otra forma
      —devolvía `{texto, variante, icono}` con las variantes escritas `neutro`, no `neutral`— y por
      eso el sistema de tonos no lo veía; ahora se expone también como mapa.
      `EJE` pasó de 18 a **25 ejes** y las correcciones de 24 a **33**.
      Lo que cambia en pantalla: `invitacion:expirada` y `:revocada`, `folio:agotado` y `:vencido`,
      y `conexion-cobranza:revocado` y `:desconectado` **pasan a `inert`** — antes eran el mismo gris
      que algo pendiente, o rojo como si se hubieran roto. `invitacion:pendiente` deja el ámbar
      (tiene 7 días por delante) y `sii:pendiente` sube a `progress` (el documento ya salió).
      Los envoltorios ahora **delegan**: los cuatro que eran `switch` con clases de color a mano
      (`border-success-subtle text-success`, `variant="destructive"`) y los cuatro del SII, que
      repetían entre todos **dieciséis ramas de glifo** para conseguir lo que `DistintivoEstado` da
      solo. `EtiquetaEstado` de la trazabilidad también delega, con sus 6 usos.
      Y el `BadgeEstado` local de `admin/salud/page.tsx` —que **sombreaba al del sistema** con otra
      API, así que ninguna búsqueda por `<BadgeEstado` lo encontraba— se llama `EstadoJob` y delega.
      **Verificado en el navegador**: el distintivo `inert` renderiza con su
      `repeating-linear-gradient` a 135°, su glifo y su etiqueta.

- [x] **0.4 · Los vocabularios confrontados contra el registro de objetos** —
      `src/lib/ui/tonos-estado.ts` pasó de **10 correcciones a 24** (y a 33 con el 0.3), cada una con su razón escrita
      y agrupada por el criterio que la produce: lo que está fuera de juego va en `inert` · lo
      normal no se celebra · lo normal tampoco se alarma. Se revisaron los 18 mapas `VARIANTE_*`
      contra los §.4 de los 18 objetos.
      Se agregó `EJE`, el catálogo tipado de los 18 ejes, y **`tonos-estado.test.ts`** con 15
      pruebas que cierran las cuatro formas de que la tabla mienta en silencio: eje inexistente,
      valor inexistente, tono fuera de los seis, y **corrección que no cambia nada**.
      Esa última encontró algo en su primera corrida: `retiro:no_procesado`, de las 10 originales,
      **ya salía `neutral` por la vía mecánica** — parecía una decisión y no decidía nada. Su razón
      se movió al bloque de decisiones deliberadas, que es donde no miente.
      También quedaron escritas **tres decisiones que NO son correcciones** —`incidencia:abierta`
      se queda en `fault` porque es el único rojo de la Torre, `geo:pendiente` y `mandato:activo`—
      y **lo que la tabla no puede expresar**: el registro pide que una excepción abierta sea
      `fault` solo si es de las 3 categorías de fuga, y eso depende de dos ejes a la vez. Va con el
      bloque 5.

- [x] **0.5 · `npm run lint` vuelve a ser compuerta** — tenía **2 errores permanentes** de
      `docs/diseno/pantallas/support.js`, el runtime vendorizado que Claude Design exporta con los
      tableros (`ReactDOM.render` de React 17 y una asignación a `module`). Entraron con `6b6b9f0`.
      Se excluye `docs/diseno/pantallas/**` en `eslint.config.mjs`, con el mismo criterio y al lado
      de `docs/_historico/**`, que ya estaba excluido por exactamente lo mismo. **0 errores.**

---

# Bloque 4 · Marco

**Desbloquea:** todas las pantallas del courier (46 según el costo; 56 rutas reales entre
`(tenant)`, `portal` y `admin`).
**Tablero a traer:** `Rutax P1 Pedidos` (fija marco, cajones, filtros en URL y actualización mixta).
**Depende de:** bloques 1, 2 y 3.

> **Corrección al presupuesto.** El costo declara 5 de estos 8 componentes `DE CERO`. **Cuatro ya
> existen y funcionan.** El trabajo real no es construirlos: es re-expresarlos al sistema y cerrar
> sus brechas. Se anota aquí para que nadie los rehaga.

## Componentes

- [x] **`navegación lateral colapsable`** · EXTENDER · **re-estilada al sistema** —
      ya colapsaba a rail con la preferencia persistida; lo que faltaba era el aspecto. El ítem
      activo llevaba **pastilla redondeada con `shadow-sm` y un `ring`**, que es el ADN retirado y
      contradice la regla 4 («sin sombras: la elevación se construye con escalón de fondo + borde»).
      Ahora es lo que fija el tablero P1: **`bg-inset` + regla de acento de 2 px a la izquierda +
      peso 600**, sin sombra y sin redondeo. Las cabeceras de grupo pasan a mono de 9 px con
      tracking `.12em`, también del tablero.
      **Verificado contra los valores literales del tablero en oscuro**: fondo `#131C21`, borde
      `#00D6B4`, texto `#E9F2F3`, `box-shadow: none`. Y el colapso sigue: 256 → 64 px, con la regla
      de acento visible en el rail.
      La cabecera del archivo describía el «ADN de Retell» —lavanda, navy, pastilla con sombra—;
      queda corregida, porque era justo lo que advertía el commit del retiro.

- [x] **`navegación inferior móvil`** · DE CERO · **construida** —
      `src/components/app-shell/nav-inferior.tsx`, montada por el shell en `(tenant)` y `portal`.
      Cuatro destinos, y **derivados del rol por construcción**: `destinosMovil()` toma los primeros
      cuatro de su orden de preferencia **entre los que la persona ya puede ver**, así que sale del
      mismo gating RBAC que el sidebar y no de una lista aparte que se desincroniza. Quien coordina
      recibe los cuatro del tablero P1 —Pedidos · Preparación · Torre · Incidencias— y Administración,
      que no tiene ninguna capacidad de operación, recibe los de dinero. Sin ningún `if` por rol.
      El dashboard cede su lugar a propósito: es una pantalla de sentarse a mirar y en el teléfono
      pierde contra las cuatro que se abren en la bodega; sigue a un toque en el panel.
      Nueve pruebas en `nav-inferior.test.ts` fijan la derivación.
      **Verificado en el navegador a 375 px**: fija abajo, cuatro columnas iguales, **56 × 94 px de
      área táctil**, el activo en acento con su regla superior —el color solo no alcanza en `sun`—,
      el contador con su texto para lector de pantalla, y `display:none` a 1280 px.
      *Nota:* el tab «Inicio» del conductor apunta a `/conductor`, que redirige a
      `/conductor/manifiesto`, así que dos tabs llevan al mismo sitio y `aria-current` nunca cae en
      «Inicio». Se arregla o se retira con la PWA (bloque 6).

- [ ] **`navegación anidada de configuración`** · el costo dice DE CERO · **existe** — el «Patrón H»
      de `app-shell.tsx:465-467` y `:600-637` reemplaza el sidebar entero al entrar a configuración,
      con «← Volver» arriba. Cubre las 9 rutas de configuración.
      **Hecho:** `/configuracion` ya no es 404, y **la segunda puerta se cerró**. El menú del bloque
      de marca ofrecía «Configuración de la empresa», «Equipo y roles» y «Mi plan y facturación», y
      los tres destinos están, uno por uno, dentro de la navegación anidada — era una segunda vía al
      mismo sitio, contra la regla del tablero de que la configuración se entra por una. El bloque
      de marca queda estático y **no se pierde ningún destino**. La tarjeta de plan se queda: sus
      cuatro entradas son anclas dentro de una misma pantalla, no otra puerta.
      *Falta:* (a) el índice propio de configuración (B3b), que hoy se suple redirigiendo; (b) hay **tres vías distintas** a los mismos destinos (el ítem del sidebar, el
      dropdown del bloque de marca en `layout.tsx:192-201`, y la card de plan en `:179-186`);
      (c) `(tenant)/dinero/layout.tsx` usa **otro patrón** —tabs horizontales— que duplica los mismos
      ítems que ya están en el grupo «Dinero» del sidebar. Una sola regla, no dos.

- [x] **`migas o retorno explícito`** · EXTENDER · **unificado** —
      `src/components/app-shell/retorno.tsx` (`Retorno`, `Migas`, `destinoRetorno`) y
      `enlace-detalle.tsx`. Había **tres tratamientos** conviviendo: migas reales en las dos
      pantallas de dinero, «‹ Volver» suelto en diez, y en `liquidaciones/[liquidacionId]`
      **las dos cosas al mismo destino**. Con dos niveles de jerarquía las migas no agregan nada,
      así que las cinco pantallas de detalle quedan con **una sola salida nombrada**.
      **La regla del tablero P1 —«volver de un detalle nunca pierde el filtro»— está puesta.** El
      listado cuelga su URL en `?volver=` (`EnlaceDetalle`, que la lee de `usePathname` +
      `useSearchParams` para no tener que enhebrar una prop por cada `FilaX`) y el detalle la usa
      como destino.
      ⚠️ **`volver` viene de la URL, así que es una redirección abierta si se usa tal cual.**
      `destinoRetorno` solo acepta una barra inicial: `//evil.cl`, `/\evil.cl`, `https://…` y
      `javascript:` caen al destino interno. Once pruebas lo fijan, y **se verificó en vivo**:
      con `?volver=//sitio-malo.cl/phishing` el botón apunta a `/manifiestos`.
      *Falta:* las de `operaciones/` (bloqueadas por el trabajo en curso) y `conductores/[id]`,
      que aún no cuelga el retorno desde su listado. Y los 31 `<h1>` propios de `(tenant)` siguen
      sin encabezado compartido.

- [ ] **`buscador global con teclado`** · el costo dice DE CERO · **existe** —
      `app-shell/paleta-comando.tsx` (215 líneas, implementación propia sin `cmdk`): ⌘K/Ctrl+K,
      Esc, flechas, Enter, debounce 250 ms, `AbortController`, mínimo 2 letras. Backend real en
      `src/app/api/buscar/route.ts` (207 líneas) con scope por `tenant_id` y RBAC por tipo.
      **Hecho:** apagado en el portal. `mostrarBusqueda` viene `true` por defecto y
      `portal/layout.tsx` no lo desactivaba, pero `/api/buscar` corta con
      `tipoUsuario !== "interno"` — **el seller veía el botón, abría ⌘K y siempre le decía «Sin
      resultados»**. Regla 35: una pantalla no promete una acción que la interfaz no ofrece. Entra
      el buscador local del portal con NUEVO #21.
      *Falta:* (a) **el backstage** — se deja apagado a propósito: encenderlo sin backend propio
      repite el mismo error, porque el super-admin tampoco es `interno`. Necesita búsqueda por
      courier, y va con el bloque 9; (b) el tipo `liquidacion` está declarado en
      `src/lib/buscar/tipos.ts` y no implementado en el handler; (c) puerta táctil propia en 390 px;
      (d) el `<kbd>` del sidebar dice **«F»** y el atajo real es ⌘K.

- [ ] **`centro de avisos`** · el costo dice DE CERO · **existe** — `app-shell/centro-avisos.tsx`
      (96 líneas) sobre `src/lib/avisos/obtener-avisos.ts` (447 líneas), con las 8 fuentes que pide
      el inventario: conexiones caídas, folios por agotarse, corte de seller próximo, incidencias
      sin gestionar, discrepancias de conciliación, excepciones vencidas, consumo de plan al
      80/100 %, comunicaciones de Rutax.
      **Hecho (brecha #27):** el rótulo decía «N sin leer» y **no existía ningún estado leído** —
      ni forma de marcar un aviso ni tabla donde guardarlo—, así que todos eran «sin leer» siempre
      y la campana prometía un buzón que no hay. La corrección **no es construir el buzón**: es que
      la cifra nunca fue de mensajes sin abrir. Un aviso no se lee, **se resuelve** — desaparece
      solo cuando su causa deja de ser cierta. Ahora dice lo que de verdad cuenta: «N necesitan tu
      atención».
      *Decisión pendiente tuya:* si además un aviso debe poder **posponerse** —que es otra cosa que
      «leerlo»—, eso sí necesita dónde guardarse. Los ids ya son estables (`conexiones-caidas`,
      `corte-proximo-<seller>`), así que la mesa está puesta.
      *Falta:* (a) la jerarquía de tres urgencias, visible pero sin escalón real; (b) no existe en
      `admin` (apagado explícito) ni en el conductor.

- [x] **`banner de sesión suplantada`** · DE CERO · **movido al marco** —
      `src/components/app-shell/banner-suplantacion.tsx`, pintado por `admin/layout.tsx` para **todas**
      las pantallas del backstage mientras la ventana de soporte esté abierta, no solo para la de
      soporte. Antes vivía dentro de `soporte/page.tsx` porque el layout no exponía un slot, y eso
      tenía dos agujeros: **la propia rama de error de esa página retornaba sin el banner** —con la
      ventana todavía viva, sin contador y sin botón de salir— y cualquier excepción que escalara a
      `src/app/error.tsx` lo borraba igual.
      Ahora consume los **`--rx-impersonation-*`**, que `rx-tokens.css` declara fuera de los cuatro
      temas a propósito y que hasta ahora no tenía un solo consumidor: si el equipo trabaja de noche
      y el banner se atenuara, dejaría de gritar justo cuando más cansado está quien lo mira.
      Lo alimenta `leerSoporteActivo()`, una lectura **pasiva** nueva en `modules/plataforma/soporte.ts`
      que —a diferencia de `exigirSoporteActivo`— **no escribe bitácora ni borra la cookie**: corre en
      cada render de cada pantalla del backstage, y un registro de auditoría por render escondería los
      hechos reales bajo el ruido.

- [ ] **`aviso de configuración pendiente`** · EXTENDER · existe —
      `src/components/onboarding/banner-onboarding.tsx` (43 líneas), montado por el slot `banner`
      del AppShell (`(tenant)/layout.tsx:245-252`).
      *Corrección a este documento:* la versión anterior decía que ser **no sticky** era un defecto.
      No lo es. La regla 7 pide que no se oculte al hacer scroll **para el banner de sesión
      suplantada**, no para éste; hacerlo fijo le robaría alto vertical a todas las pantallas de
      forma permanente por un aviso que no es urgente al segundo.
      *Falta:* (a) el conteo es
      `totalPasos: 2` hardcodeado en `(tenant)/onboarding/estado.ts:155-168` (solo DTE + tarifas),
      mientras el panel muestra cinco tarjetas — **NUEVO #12 pide un solo conteo del que lean el
      banner y el asistente**; (c) solo lo ve quien tiene `puedeGestionarConfiguracionDte`.

## Adopción de los bloques 1–3 que entra acá

- [ ] `BarraCajones` en `(tenant)/operaciones` (los 6 cajones que pide el inventario, con
      `cancelado` como excluido) y en `preparacion/asignar`.
- [ ] `FranjaCambiosPendientes` en `operaciones` y `preparacion/asignar`, que ya se refrescan solas
      vía Realtime (`src/components/tiempo-real/`).
- [ ] Unificar la `BarraSeleccion` local de `preparacion/asignar/_componentes/` con la del sistema.

## Pantallas

- [ ] `src/components/app-shell/app-shell.tsx` — es el archivo del bloque (739 líneas).
- [ ] `src/app/(tenant)/layout.tsx` · `src/app/portal/layout.tsx` · `src/app/admin/layout.tsx`
- [ ] `src/app/(tenant)/dinero/layout.tsx` — **pasa al bloque 5.** Sus pestañas horizontales son un
      cuarto patrón de navegación para destinos que ya están en el sidebar, pero cargan el contador
      de conciliación y el `BadgeModoDte`, que sí son reales. Resolverlo sin el tablero `B2a` sería
      adivinar; va con el bloque de dinero.
- [ ] Las 32 de `(tenant)`, 11 de `portal` y 13 de `admin` heredan sin tocarse.
- [ ] **Falta `src/app/(tenant)/configuracion/page.tsx`** (hoy 404).
- [ ] `src/app/error.tsx` — es raíz y **reemplaza el AppShell entero**: en un error el usuario
      pierde sidebar, avisos y toda forma de navegar. Necesita boundary por segmento.

## Brechas del inventario que cierra

- [ ] **#17** — las pantallas de «sin permiso» son callejones sin salida, y dos mandan a una ruta
      inexistente.
- [ ] **#27** — el centro de avisos cuenta «sin leer» y el estado leído no existe en ninguna parte.
- [ ] **#30** — la búsqueda del portal del seller siempre responde «sin resultados».

## Bloqueado

- [ ] **NUEVO #12** · Un solo conteo del que leen el banner y el asistente. *(decisión del usuario)*

---

# Bloque 5 · Dinero

**Tableros traídos:** `P4 Emitir factura` ✅ · `B2a Periodos` ✅ · `B2b Liquidaciones y cobranza` ✅ — el bloque 2 completo.

**Las seis decisiones que P4 fija para todo el producto**, y que valen más allá de dinero:
1. **La verificación previa es una pantalla, no una validación** — tres desenlaces con tratamiento
   propio, y el del medio («hay reparos, sigues dejando registro») es el que hoy no existe como tal.
2. **Bloqueado se muestra deshabilitado CON MOTIVO, nunca oculto.** Un botón que desaparece hace
   pensar que la pantalla está incompleta.
3. **El acto explícito nombra a la contraparte** — escribir, no marcar. Solo en el peldaño 3.
4. **El modal no se cierra: se convierte en comprobante.**
5. **El modo de pruebas usa la trama, no un color** — sería un séptimo tono. Aparece en el marco
   **y dentro del botón**.
6. **Toda acción asíncrona dice «quedó en curso»** — corrige el tiempo verbal en ~140 acciones.

## Componentes

- [x] **`escalera de fricción` · 3 peldaños** · DE CERO — `src/components/ui/modal-acto-explicito.tsx`.
      El anterior soportaba dos peldaños; faltaba el tercero. Ahora: 1 consecuencia · 2 + motivo ·
      3 + **escribir el nombre de la contraparte**.
      El peldaño 3 es escribir y no una casilla porque es lo único que obliga a leer **a quién**:
      *el error real de este flujo no es emitir sin querer, es emitirle al seller equivocado en una
      lista de diez.*
      **Verificado en el navegador con sesión real**, sobre un período cerrado: sin X, escape y clic
      fuera no cierran, «Volver» y no «Cancelar» (regla 59), el foco entra en el campo, y el botón
      está deshabilitado **y fuera de la tabulación** (`tabIndex −1`) hasta que la frase calza —
      tolerante con espacios de sobra, estricta con un seller equivocado.
- [x] **`bloque de composición`** · DE CERO — `src/components/ui/bloque-composicion.tsx`, en mono,
      con signo menos real y **sin símbolo por sumando** (`formatearMiles`, nuevo en
      `formato-moneda.ts`): un `$` en cada término compite con la resta, que es lo que hay que leer.
      *Falta el dato:* el preflight devuelve `netoClp`/`ivaClp`/`totalClp` pero **no el desglose por
      concepto**, así que el modal aún no puede mostrar la resta real. Es trabajo de backend.
- [ ] **`verificación previa`** — la lógica existe y es buena (`modules/dinero/preflight.ts`, 906
      líneas, 16 códigos). Lo que falta es la **forma**: los tres desenlaces como pantalla, y
      de-duplicar `SkeletonPreflight` / `BloquePreflightFallido` / `BandaItemsPreflight`, que están
      **triplicados literalmente** (~100 líneas cada uno) en los tres diálogos.
- [x] **`tabla financiera`** · DE CERO — `src/components/ui/tabla-financiera.tsx`. Agrupada por
      concepto y no línea por línea, porque **285 filas no se auditan**: tres conceptos con
      subtotal, los ajustes con su origen enlazado, y «ver las N una por una» para cuando hace
      falta. Es lo que permite cuadrar sin exportar — y exportar a Excel es el momento en que el
      producto deja de ser la fuente de verdad.
      `rotulo` («neto» | «bruto») **no tiene valor por defecto**: la regla 18 lo exige en cabecera y
      pie, y hoy en el detalle de período la cifra grande es bruto, el pie es neto y nada lo dice.
      Los negativos van con signo menos real (U+2212), tono `fault` y su causa enlazada en la misma
      fila — nunca un paréntesis, que no lo lee quien no es contador, ni solo color, que se pierde
      al imprimir.
      **Verificada en el navegador** con los datos del tablero.
      **Montada en el detalle de período**, y sin consulta nueva: una versión anterior de este
      documento decía que hacía falta una agregación en backend, y era **falso** —
      `listarLineasCobroPorPeriodo` ya trae *todas* las líneas con `leerTodasLasFilas`, y la
      paginación de 50 es solo del render. La agrupación es
      `src/modules/dinero/agrupacion-lineas.ts`, con **9 pruebas** que fijan la invariante que
      sostiene todo: **subtotal + Σ ajustes = total = Σ `montoFinalClp`**, verificada también a
      escala de 285 líneas. Si no cuadra, la tabla miente, y quien la revisa se va a Excel.
      La tarifa unitaria se muestra **solo si todas las líneas del concepto comparten monto base**:
      un promedio sería un número que no existe en ninguna línea.
      La vista línea por línea no se perdió: pasa a estar detrás de «ver las N una por una», como
      pide el tablero.
- [x] **`panel de ajuste manual`** · DE CERO — el formulario existía; lo que faltaba era la regla.
      **El motivo era «Nota (opcional)» y la Server Action no lo validaba en absoluto**, así que se
      podía aplicar una penalización de $8.000 sin escribir una palabra y el conductor veía un
      descuento sin razón en su liquidación y en su PDF.
      Ahora es obligatorio con mínimo de 10 caracteres —«error» no llega— **validado en el
      servidor**, que es donde manda, y declarado en el formulario: «el conductor lee esto en su
      liquidación y en su PDF. No es una nota interna» (regla 24). Con los dos ajustes en cero no se
      exige: eso es limpiar un ajuste anterior, no aplicar uno.
      6 pruebas para la regla del servidor. **Verificado en pantalla** en sus cuatro estados.
- [x] **`atribuidor de pago` · su mitad nueva: el calce como RESTA** —
      `src/components/ui/calce-pago.tsx`. Hoy la pantalla elige un período de una lista y aprieta
      «Atribuir» **a ciegas**: si el monto no calza, uno se entera después por el estado que quedó.
      Ahora se ve la resta —cuánto entró, cuánto se imputa, cuánto queda— y **los dos casos raros
      llevan su nombre y su consecuencia escrita**: «pago parcial» deja el resto disponible para
      otro período, «pagó de más» deja el excedente a favor del seller y visible en el próximo.
      6 pruebas para la aritmética, incluida la que impide que resto y falta sean ambos > 0.
      ⚠️ **Falta la otra mitad:** el tablero permite atribuir un movimiento a **varios períodos**
      («paga dos períodos con una transferencia») y `atribuirPagoManualmente` acepta **uno**.
      Es trabajo de dominio.
      ⚠️ **No se pudo ejercitar en pantalla:** la semilla no tiene pagos por revisar.
- [x] **El vacío de cobranza dejó de mentir** (brecha #3) — decía «todos los pagos recibidos se
      atribuyeron y conciliaron solos», una afirmación que el producto **no había comprobado**: con
      el banco sin conectar no llega ni un movimiento, así que la bandeja está vacía por la razón
      contraria. El tablero B2b lo nombra explícitamente. Ahora distingue los dos casos y, sin
      banco, ofrece conectarlo. **Verificado en pantalla.**
- [ ] `indicador de folio disponible` · `tarjeta de trazabilidad` · `tarjeta de resultado en bloque`.

## Pantallas

- [x] **`dinero/periodos/[periodoId]` · emitir factura** — migrada al modal nuevo. Tres correcciones
      de fondo, no de forma:
      · **Mostraba `totalClp`, que incluye IVA**, bajo el rótulo «Monto total». La regla 22 dice que
        Rutax no muestra impuestos —la factura PDF es el único lugar del producto con IVA— y el
        tablero pide «Total neto». Ahora muestra `netoClp` con su rótulo. Es la brecha #4.
      · **El aviso decía «Factura emitida» cuando solo se había encolado el trabajo** (brecha #6).
        Ahora dice «La emisión quedó en curso» y qué pasó con el folio.
      · **El fallo salía en notificación temporal**, contra la regla 56. Ahora es un aviso embebido
        que se queda dentro del modal, con el modal abierto para reintentar. Verificado en vivo:
        cero toasts. Quedan **14** `toast.error` en dinero.
      *Pendiente en esta pantalla:* el mensaje del proveedor se filtra crudo al aviso («fetch
      failed»). Un error de integración nunca muestra el texto del proveedor y siempre dice qué
      sigue funcionando — se arregla en la Server Action, no acá.
- [x] **`dinero/liquidaciones/[liquidacionId]`** — la tabla financiera con **las dos clases de
      línea separadas y su subtotal**: una entrega se paga por tarifa y una visita a bodega por
      bodega, así que el conductor que reclama pregunta por una de las dos y un solo subtotal lo
      obliga a rehacer la suma. Y cada ajuste con **su motivo en la fila**, no en un tooltip.
      `agrupacion-liquidacion.ts` con 8 pruebas, incluida la invariante a escala de 200 líneas.
      ⚠️ El tablero también muestra **el autor del ajuste** («Aplicó M. Soto el 19-08») y
      `dinero.liquidaciones` guarda la nota pero **no quién la aplicó**: el autor está en la
      bitácora, no en la fila. No se inventa; mostrarlo exige una lectura extra.
- [ ] Las otras 5 de `dinero/` y las 4 anulaciones.
- [ ] `dinero/layout.tsx` — sus pestañas son un cuarto patrón de navegación (viene del bloque 4).
      Necesita `B2a`.
- [ ] **Un período abierto no tiene camino a su detalle**: `AccionesPeriodo` solo muestra «Cerrar
      período» y el enlace «Ver detalle» aparece recién cuando está cerrado. La pantalla existe y es
      inalcanzable. Encontrado al verificar; va con `B2a`.

## Las 26 acciones irreversibles

`RUTAX-SISTEMA-DE-MENSAJES.md` §2 trae las 33 con su peldaño y su copy ya escritos.
**5 de 26 migradas**, todas verificadas en el navegador con datos reales:

- [x] `periodos.emitir` · **P3 · escribir** — el arquetipo.
- [x] `periodos.cerrar` · **P2** — estaba en `<Dialog>` genérico, con «Cancelar» y X.
      ⚠️ **Su copy del sistema de mensajes promete algo que no existe:** «se puede reabrir mientras
      no esté facturado». **No hay ninguna acción de reapertura de período en el código** —solo
      `reabrirEventoConciliacion`, que es de conciliación y otra cosa—. El tablero B2a la dibuja
      como acción de peldaño 2, así que es una **brecha de producto**. Mientras no exista, la
      pantalla no la promete (regla 35).
- [x] `cobro.anular` · **P2 · motivo**
- [x] `liq.anularLinea` · **P2 · motivo** — en el detalle del pedido y en el del conductor.
- [x] `liq.anularVisita` · **P2 · motivo**
      Las tres anulaciones declaran **quién lee el motivo**: «lo lee el conductor, en su liquidación
      y en su PDF» (regla 24). Y exigen 10 caracteres — «error» no llega, y verifiqué que el botón
      sigue deshabilitado y fuera de la tabulación hasta que el motivo dice algo.

- [x] `liquidaciones.pagar` · **P3 · escribir** — la única acción del producto que **saca plata del
      banco y no vuelve**, y tenía una casilla. La frase que hay que escribir es **el monto sin
      formato** (`323400`), porque obliga a leer la cifra: el error real no es transferir sin
      querer, es transferir otra cantidad. Su fallo pasa de notificación temporal a aviso embebido,
      y el éxito dice «quedó en curso», que es lo que de verdad pasó.
      ⚠️ **No se pudo ver en pantalla:** las 10 liquidaciones de la semilla están en borrador y el
      botón de pago solo aparece en las emitidas. Verificada por typecheck, lint y pruebas, y por
      compartir el mismo modal ya verificado en vivo en otras dos pantallas — pero no la vi.

- [x] `liq.marcarPagadaManual` · **P2 · motivo** — el motivo **no existía en toda la cadena**: la
      acción de dominio no lo pedía, la Server Action no lo pasaba y el diálogo no lo tenía. Ahora
      es obligatorio y validado en el servidor, porque esta acción **no mueve un peso**: solo
      AFIRMA que alguien pagó. Sin el cómo y el cuándo, la afirmación no se puede comprobar después
      y queda una liquidación marcada como pagada que nadie sabe si se pagó. La consecuencia ahora
      se dice: «si no le pagaste, va a quedar como pagada sin estarlo».
      De paso muere su `window.location.reload()`, que perdía el aviso y remontaba la aplicación
      entera para refrescar una fila.
- [x] **5 de los 6 `confirm()` nativos del backstage** (regla 37) — suspender y cancelar
      suscripción, marcar período pagado, desactivar aviso y desactivar plan.
      Un `confirm()` **no puede decir la consecuencia**: cabe una pregunta y nada más, así que
      «¿Suspender la suscripción?» se llevaba puesto todo lo que había que explicar. Sus botones
      además dicen «Aceptar» y «Cancelar» en el idioma del sistema operativo, y acá «Cancelar»
      significa otra cosa. El copy sale del sistema de mensajes §2, que ya lo tenía escrito.
      Sale `BotonConfirmado`, un envoltorio delgado sobre la misma ceremonia de dinero — no una
      versión de segunda por ser uso interno.
      Los dos de desactivar solo piden ceremonia **al apagar**: encender es reversible en un clic,
      y pedir confirmación para eso gasta la fricción.
- [ ] **El sexto NO se tocó, a propósito:** el interruptor de **emisión DTE real**
      (`entitlements-overrides.tsx`). El sistema de mensajes lo marca **P3 · escribir el RUT + 2FA**,
      y `CLAUDE.md` es explícito en que no se cambia el modo real sin decisión tuya y revisión de
      `seguridad-cumplimiento`. Bajarle o subirle la fricción de pasada sería justamente lo que esa
      regla prohíbe.

⚠️ **La regla 38 sigue sin cumplirse en el backstage.** «Toda acción sobre la cuenta de un tercero
exige motivo escrito y queda a nombre de quien la hizo» — pero `suspenderSuscripcion` y
`cancelarSuscripcion` **no aceptan un motivo** en el dominio. Se pasó de `confirm()` a ceremonia
con consecuencia escrita, que es la regla 37; el motivo exige tocar `modules/plataforma`.

**Quedan 15 acciones.**

### ⚠️ Un agujero del propio modal, encontrado al migrar el pago

El gate daba por lista la confirmación cuando el peldaño era 3 **pero no venía la frase**:
`!confirmacion` devolvía `true` y el botón quedaba habilitado sin escribir nada.

No era hipotético. El pago arma su frase con el monto líquido, y ese monto **puede venir nulo
mientras la verificación previa responde** — o sea, la ceremonia más cara del producto se saltaba
sola justo en la ventana en que todavía no se sabe cuánto se va a transferir. Una frase en blanco
tenía el mismo efecto, porque se normalizaba a `""` y calzaba con el campo vacío.

Ahora **falla cerrado**: si alguien pide peldaño 3, tiene que dar una frase no vacía. 8 pruebas.

# Bloque 6 · App del conductor

**Desbloquea:** las 12 pantallas de B5 y el arquetipo P5.
**Tableros a traer:** `Rutax B5 App del conductor` · `Rutax P5 Registrar entrega`.
**Depende de:** bloques 1 y 2 (los tonos y el distintivo).

> ⚠️ **Este bloque se ejecuta casi entero en el repo hermano `C:\Users\jorge\Desktop\rutax-conductor`**
> (Expo SDK 54 + expo-router, 12 pantallas, ~6.860 líneas). Los repos están separados **a
> propósito**: los ciclos de release son incompatibles y el acoplamiento real es por HTTP, no por
> código. Lo que sí vive en este repo es el retiro de la PWA y las rutas de API que la app consume.

## 6.0 · Lo primero, y no es negociable: los dos sistemas de color

- [ ] **Unificar `rutax-conductor/src/theme.ts` con `rx-tokens.css`.** El repo Expo tiene su propio
      sistema, llamado *«Light Pro»*: `primary #1E3A5F`, `accent #2563EB`, `danger #DC2626`, más su
      escala de `spacing`, `radius`, `font` y **`shadow`**. **No comparte un solo valor** con el
      sistema nuevo (teal `#00B89A`, radio 3 px, **cero sombras**). `src/torre/estilos.ts` se apoya
      en él. Mientras esto no se resuelva, todo lo demás del bloque se construye sobre el ADN viejo.

## 6.1 · Los tres temas · NUEVO #22

- [ ] **`sun`, `dark` y `night` son alcanzables.** Los tres están **declarados y completos** en
      `src/app/rx-tokens.css` (`:240` y `:310`) y **no los escribe ni los ofrece nada**: son tokens
      muertos. `src/components/app-shell/theme-switcher.tsx` ofrece exactamente tres opciones —
      claro, oscuro, sistema — y ninguna es `sun` ni `night`.
- [ ] **Orden de autoridad del tema** (regla 9): preferencia manual > sensor de luz con histéresis >
      hora. **La preferencia manual caduca al fin del turno.**
- [ ] **Histéresis** (regla 10): entra a Sol sobre 8.000 lux, sale bajo 3.000, con **90 s mínimos de
      permanencia**. Eso resuelve el subterráneo a las 17:00: baja a *Día*, no a *Noche*.
      *Decisión abierta:* los umbrales se ajustan **en la calle, con un teléfono real, a las 16:00 y
      a las 21:30**. No se ajustan en pantalla.
- [ ] **Los tres comparten disposición, glifos y posiciones** (regla 11). Solo cambian los valores
      de color y el pico de luminancia.
- [ ] **Bajo sol, los distintivos van en sólido pleno**, nunca en fondo teñido (regla 12).
- [ ] **`night` tiene DOS niveles de texto, no tres** — el tercer gris no cumple AA sobre `#05080A`.
- [ ] `selector de tema de tres estados` · DE CERO · nativo.

## 6.2 · Componentes

- [ ] **`módulo de captura`** · DE CERO · cámara + galería múltiple · P5, B5 · 4 pantallas.
      *Hoy son dos caminos con reglas distintas y la galería no está donde se necesita:*
      en el flujo de entrega (`manifiesto/[pedidoId]/index.tsx`) van 1 foto de prueba + hasta 4
      evidencias = **5**, con cámara propia y **sin ninguna entrada a la galería**; en la pantalla
      de evidencias aparte (`evidencia.tsx`) el máximo es **10** y ahí sí hay galería con selección
      múltiple. O sea: la galería existe, pero no al cerrar la parada. El módulo unifica las dos.
      Base a conservar: `rutax-conductor/src/components/camara.tsx` (API imperativa `useCamara()`
      para evitar el «Usar foto / Repetir» de iOS) y `src/lib/fotos.ts`.
- [ ] **`verificación por escaneo`** · DE CERO · retiro y traspaso · 3 pantallas. **La base existe y
      es buena**: `expo-camera` con `CameraView` + `onBarcodeScanned`, `barcodeTypes: ['qr']`, con
      cooldown antirráfaga en `src/lib/retiro.ts`. Falta la forma del sistema: escaneados /
      pendientes / te quedan, **registro de escaneo con repetido marcado**, y cierre con faltantes.
      *(El panel inferior de registro con log de repetidos ya está aprobado e integrado.)*
- [ ] **`distintivo de acuse de escaneo`** · DE CERO · 3 variantes.
- [ ] **`progreso con pasos nombrados`** · DE CERO · P5, B5 · 5 pantallas. `progress` no nombra pasos.
- [ ] **`bloque registrado sin confirmar`** · DE CERO · P5, B5 · 6 pantallas. Regla 17: **no hay
      trabajo sin conexión**; hay reintento automático con aviso, y la advertencia de que cerrar la
      app pierde lo no confirmado. *(La cola offline del repo Expo —`src/lib/offline-queue.ts`,
      `offline-queue-retiro.ts` y `offline-queue-traspaso.ts`— existe; el diseño la reexpresa como
      reintento con aviso, no como trabajo sin conexión.)*
- [ ] **`hoja de consentimiento`** · DE CERO · 3 pasos · punto de término. Regla 64: es dato
      personal bajo la Ley 21.431 — consentimiento en tres pasos, versionado, revocable, **y nada se
      guarda antes del último paso**.
- [ ] **`vocabulario de sonido y vibración`** · DE CERO · 4 señales · **no existe ninguno**: cero
      `Vibration`, `Haptics`, `expo-av` o `expo-haptics` en el repo Expo; cero `navigator.vibrate` o
      `new Audio()` en este. Regla 14: **toda confirmación que el conductor no puede mirar tiene
      señal de oído y de mano, y la vibración sola tiene que bastar.** · NUEVO #24
- [ ] **`notificación push`** · DE CERO · 3 momentos · **no existe ni en la app ni en el servidor**:
      sin `expo-notifications`, y `public/sw.js` son 41 líneas sin `push` ni `notificationclick`. ·
      NUEVO #25
- [ ] **`solicitud de permiso con explicación previa`** · DE CERO · 4 permisos · P5, B5 · 5 pantallas.
      Regla 13: **un permiso se pide en el momento en que se usa**, con una frase de para qué, y
      nunca al abrir la app.
- [ ] **`escala de texto de cuatro pasos`** · DE CERO · nativa · toda la app · NUEVO #23
- [ ] **`casilla táctil de 56 px`** · EXTENDER · P2 en tablet y teléfono, B5 · 6 pantallas.
- [ ] **`selección táctil en tres niveles`** · DE CERO · fila, cabecera de grupo, barrido vertical ·
      P2 en tablet y teléfono · 3 pantallas. Hoy solo hay clic y shift-clic.
- [ ] **`hoja móvil`** · EXTENDER sobre `sheet` · P1, P3, B4, B5 · 14 pantallas.

## 6.3 · Reglas del bloque que se verifican en pantalla

- [ ] **Regla 15** — un traspaso entre personas necesita **las dos voluntades**. Hoy es unilateral
      (`rutax-conductor/app/(main)/traspaso/index.tsx`, 612 líneas). · NUEVO #26
- [ ] **Regla 16** — una preferencia del conductor **no se reporta a su coordinador**.
- [ ] **Regla 68** — cuando la fuente del pedido gobierna parte del ciclo, la interfaz **lo dice y
      cruza** en vez de ofrecer una acción que no manda. En Flex el registro es informativo y la
      prueba oficial la gobierna Mercado Envíos: hoy el mismo botón dispara lo mismo en los dos
      regímenes y la diferencia se comunica solo con texto.

## 6.4 · Retiro de la PWA `/conductor` de este repo

El inventario la marca para retiro: sus capacidades **se funden en la app nativa**, no se pierden.

- [ ] `src/app/conductor/page.tsx` (10) — solo redirige a `/conductor/manifiesto`.
- [ ] `src/app/conductor/manifiesto/page.tsx` (416)
- [ ] `src/app/conductor/manifiesto/[pedidoId]/page.tsx` (299) + `acciones-same-day.tsx` (601)
- [ ] `src/app/conductor/liquidaciones/page.tsx` (174) — **existe solo acá**: la app nativa no tiene
      liquidaciones (brecha #19). Fundir antes de retirar.
- [ ] `src/app/conductor/punto-termino/` (65 + 346 + 319) — **existe solo acá**. Fundir antes de retirar.
- [ ] `src/app/conductor/layout.tsx` (103) + `src/components/app-shell/conductor-nav.tsx` (56)
- [ ] `src/app/manifest.ts` y `public/sw.js` — decidir si la PWA sobrevive como envoltorio. Ojo:
      `manifest.ts` tiene `theme_color: "#1e3a8a"`, navy viejo.

> ⚠️ **Las 18 rutas de API bajo `/api/conductor/*` (20 operaciones) NO se tocan.** Son las que
> consume la app nativa. Retirar la PWA no las afecta.

## Brechas del inventario que cierra

- [ ] **#5** — un pedido de Shopify se rotula «Same-day» en la app del conductor.
- [ ] **#18** — el manifiesto en borrador es un callejón sin salida.
- [ ] **#19** — la app del conductor no tiene liquidaciones ni marca de asistencia.
- [ ] **#20** — la sesión de retiro solo cuenta lo escaneado y nunca muestra lo esperado.
- [ ] **#24** — la app cierra sesión en silencio.
- [ ] **#25** — ningún aviso propio en toda la app: **17 alertas nativas**.

## Bloqueado

- [ ] **NUEVO #22** · Los tres temas de la app del conductor.
- [ ] **NUEVO #23** · Escala de tamaño de texto en la app.
- [ ] **NUEVO #24** · Sonido y vibración: cuatro señales.
- [ ] **NUEVO #25** · Notificaciones push: tres momentos.
- [ ] **NUEVO #26** · Aceptación del receptor en el traspaso, hoy unilateral.
- [ ] *Decisión abierta:* **umbrales de lux (8.000/3.000) y permanencia (90 s)** — se ajustan en
      terreno, no en pantalla.

---

# Bloque 7 · Sub-sistemas

**Desbloquea:** B1a (la Torre), B8 (las piezas impresas) y los correos.
**Tableros a traer:** `Rutax Subsistemas` · `Rutax B1a Monitoreo` · `Rutax B8 Piezas impresas`.
**Depende de:** bloques 1 y 2.

> **Cada uno es un frente propio, y ninguno hereda de los tokens por sí solo.** La cartografía
> porque la librería no lee CSS; los PDF porque `@react-pdf/renderer` tampoco; los correos porque
> el HTML de correo no soporta variables CSS. En los tres hay que **pasar los valores a mano**, y
> los tres tienen hoy el ADN viejo hardcodeado.

## 7.1 · Cartografía · 5 componentes

**El estado de partida:** es lo más maduro del bloque —dos temas, degradación declarada, jerarquía
vial, tres niveles de zoom— pero **pinta desde el sistema anterior**. Todo el estilo vive en
`src/app/(tenant)/torre-de-control/_lib/mapa/`: `paleta.ts` (~330 líneas, los colores),
`estilo.ts` (798), `config.ts` (~80).

- [ ] **`tema de mapa` claro y oscuro** · DE CERO · B1a · 2 pantallas.
      `paleta.ts` define dos temas con **colores literales del ADN Retell viejo** (navy `#2a3ca0`,
      periwinkle `#7080f5`, tierra `#f1f2f8` / `#131417`), mientras
      **los 24 tokens `--rx-map-*` de `rx-tokens.css` (`:118-133` en oscuro, `:213-226` en claro) no
      tienen un solo consumidor en todo el repo.** La tabla de destino está en
      `RUTAX-SISTEMA-DE-DISENO.md` §13.1. Los temas `sun` y `night` no declaran mapa: la Torre es
      del coordinador, no del conductor.
- [ ] **`polígono de comuna` con rampa de carga** · DE CERO · rampa de **cuatro pasos del acento**,
      sin escala de semáforo: `--rx-map-comuna-1..4`. **Cuando la celda lleva rótulo la rampa corta
      en `comuna-3`** y el texto va en `--rx-fg`; ningún gris sobre `comuna-4`. Seleccionado: borde
      de 2 px en `--rx-fg` y el relleno sube un paso — **nunca cambia de matiz**, porque eso haría
      creer que cambió la carga. Hoy: capas `tc-comuna-carga` / `-borde` / `-borde-activa` / `tc-velo`
      con hex de 8 dígitos y alfa embebido.
- [ ] **`punto de entrega` con agrupación** · DE CERO · círculo de 8 px del tono de su estado de
      ciclo, borde de 1,5 px del color de fondo. **Muestra el código de envío, nunca la dirección ni
      el nombre** (regla 62, legal). **Incidencia abierta:** mismo círculo en `fault` con anillo de
      2 px — **lo único rojo del mapa** (regla 67). Sobre zoom 14 los que caen a menos de 12 px se
      apilan con un contador; **nunca se dispersan artificialmente**. Hoy existen las capas
      `tc-punto-*` con el rojo en `#fb3748`.
- [ ] **`marcador de conductor`** · DE CERO · **no existe**: no hay capa ni fuente de conductor en
      `IDS_CAPAS` / `IDS_FUENTES`; `derivar.ts` solo lleva el conductor como **texto** en la ficha.
      Cuadrado de 12 px rotado 45°, con la inicial, y **solo su última posición** — no hay recorrido
      histórico y no se puede dibujar uno (reglas 63 y 205 de la Ley 21.431).
- [ ] **`mapa degradado`** · DE CERO · **existe y es deliberado** — `config.ts` lo documenta y
      `estilo.ts:178` dice literalmente que es «para que el modo degradado se vea deliberado y no
      roto». *Falta la forma:* hoy se declara con un sufijo de texto en la atribución
      (`torre.tsx:405`, «· sin plano urbano») y el diseño pide una **franja `attention`** con el
      mensaje completo. Es un **estado válido, no un error** · NUEVO #3.
- [ ] **Los tres niveles de zoom semántico** se entienden de tres maneras a la vez: el rótulo del
      nivel cambia («9 comunas» → «34 grupos» → «112 entregas»), los racimos se abren con un cruce
      de 200 ms, y el control de zoom marca el tramo. **Sin las tres, el salto se lee como que el
      mapa perdió datos.**
- [ ] **Encender las etiquetas del basemap.** La v2 las enciende (calle y comuna) porque la Torre
      muestra el código de envío y **no** la dirección, así que el nombre de calle del plano es lo
      único que ubica el punto. Requiere glifos: **4 archivos PBF (~410 KB)** de Noto Sans Regular y
      Medium del build público de Protomaps — no hay pipeline que construir. Falta publicarlos al
      bucket y poner `NEXT_PUBLIC_MAPA_GLIFOS_URL`. Sin ellos, `estilo.ts:508` degrada a un anillo
      en vez del `+N`.
- [ ] **Se retiran las tramas de riesgo de 45°** — sin puntaje no hay escala que pintar.

> ⚠️ `maplibre-gl` está clavado en **`5.24.0` exacto — no subir a 6.x**: la 6.0.0 carga su Web
> Worker como archivo suelto y Turbopack no lo resuelve dentro de `node_modules`. Falla mudo:
> `getStyle()` devuelve `null` y el lienzo queda en blanco, sin un solo error en consola.

## 7.2 · Visualización de datos · 4 componentes

**Estado de partida: los gráficos existen solo en el escaparate.** `src/components/ui/chart.tsx`
define `GraficoLinea` y `GraficoDona`, y **el único archivo que los importa es `/kitchen-sink`**.
Ninguna pantalla de producto dibuja un gráfico: ni el dashboard, ni `admin/metricas` (que usa el
ícono `BarChart3` y no dibuja nada), ni dinero. Lo más cercano en producción es una barra de
distribución con clases Tailwind (`dashboard/page.tsx:96`).

- [ ] **`gráfico de barras`** · RE-ESTILO · B1c, B2b, B6 · 5 pantallas.
- [ ] **`gráfico de líneas`** · RE-ESTILO · B1c, B6 · 4 pantallas.
- [ ] **`paleta categórica de 5 series`** · EXTENDER · 9 pantallas. Los tokens ya están:
      `--rx-chart-1..5`, `--rx-chart-grid`, `--rx-chart-axis`, `--rx-chart-target`. **Ninguna serie
      usa el matiz del rojo ni del ámbar**, para no chocar con los tonos de estado. Hoy `chart.tsx`
      lee los `--chart-*` de shadcn (azul, morado, verde, cian, amarillo).
- [ ] **`semáforo de cumplimiento`** · DE CERO · B1c, B4 Inicio, B3b Sellers · 4 pantallas. Base:
      `src/lib/ui/semaforo-sla.ts`.

## 7.3 · Impresos · 2 componentes

**Librería única: `@react-pdf/renderer` 4.5.1, generación directa (componentes React →
`renderToBuffer`). Cero HTML→PDF, cero Puppeteer.** Los tres documentos usan
`StyleSheet.create` con `fontFamily: "Helvetica"` y hex sueltos: **no consumen un solo token**, y
los `--rx-thermal-*` y el bloque `@media print` de `rx-tokens.css` no tienen consumidor.

- [ ] **`etiqueta térmica` 10×15** · DE CERO · `src/modules/operacion/etiqueta-same-day-pdf.tsx`
      (288 líneas), con `FormatoEtiqueta = "termica" | "carta"` y 283,5 × 425,2 pt.
      Reglas duras: **cero grises, cero tramas de fondo, ningún peso bajo 400, ningún texto bajo
      15 px** · **todo código impreso aparece dos veces**, legible a distancia y en su forma
      digitable sin guiones · **la comuna es más grande que el nombre** (`--rx-thermal-comuna: 24px`
      contra `--rx-thermal-name: 17px`) · **una etiqueta no lleva montos, ni datos del conductor, ni
      instrucciones de acceso**.
      ⚠️ Aplica a **same-day y Shopify**: en Flex la etiqueta la genera Mercado Envíos.
- [ ] **`documento PDF carta`** · DE CERO · 3 piezas:
      - [ ] **Liquidación del conductor** — `src/modules/dinero/liquidacion-pdf.tsx` (231 líneas).
            La lee alguien que desconfía por defecto de un descuento que no entiende: **su
            legibilidad es el problema de diseño, no su estética.** Regla 53: toda pieza impresa con
            un total lleva su composición impresa al lado.
      - [ ] **Factura al seller** — **Rutax no la genera**: el PDF del DTE lo emite el proveedor
            externo y `portal/cobros` solo lo descarga. Es el **único lugar del producto con IVA**
            (regla 22). Decidir si se re-genera o se acepta la del proveedor.
      - [ ] **Manifiesto impreso** — **NO EXISTE.** `(tenant)/manifiestos/` es solo pantalla. Es la
            hoja de ruta en papel para cuando el teléfono se queda sin batería a mitad de turno:
            **tiene que servir para trabajar**, con dónde escribir y la hora en que se imprimió
            (regla 54). Va en TÚ *(decisión cerrada, no reabrir)*.
      - [ ] Comprobante de pago de suscripción — `src/modules/plataforma/comprobante-pago-pdf.tsx`.
- [ ] **La marca «REIMPRESA» con fecha y hora** en la etiqueta reimpresa · NUEVO #27.
- [ ] **Regla 55** — el error de generación **distingue el archivo del hecho**: «el PDF falló, la
      factura está emitida y su folio es el 1041».

## 7.4 · Correos · 1 componente, 11 piezas

- [ ] **`plantilla de correo`** · DE CERO · el documento dice 16 correos; **en código hay 11**, y
      todos son **strings HTML inline concatenados**: sin React Email, sin MJML, **sin layout
      compartido, sin `<head>` y sin tabla contenedora**. Se escribieron en tres módulos con tres
      criterios distintos y **nadie los ha revisado nunca como conjunto**.
      Y llevan el navy viejo hardcodeado: `#1e3a5f` en `identidad/notificaciones-invitacion.ts:82`,
      `#1E3A5F` en `operacion/aviso-incidencia-email.ts:91`. Los 7 de `plataforma/notificaciones.ts`
      están rotulados en el propio código como *«placeholders funcionales (revisar con copywriter)»*
      y no tienen ni botón: son párrafos pelados.
      **Regla 61: ningún correo depende de una imagen.**

      | Constructor | Archivo |
      |---|---|
      | `construirEmailInvitacion` (3 variantes) | `src/modules/identidad/notificaciones-invitacion.ts:70` |
      | `construirAvisoIncidencia` | `src/modules/operacion/aviso-incidencia-email.ts:58` |
      | `construirEmailPagoConfirmado` | `src/modules/plataforma/notificaciones.ts:199` |
      | `construirEmailCobroFallido` | `…:221` |
      | `construirEmailTrialPorVencer` | `…:248` |
      | `construirEmailSuscripcionCreada` | `…:270` |
      | `construirEmailPlanCambiado` | `…:290` |
      | `construirEmailComunicacion` | `…:326` |
      | `construirEmailPeriodoVencido` | `…:347` |

- [ ] **Los 10 correos que el diseño escribió y no existen** (`RUTAX-SISTEMA-DE-MENSAJES.md` §9.2):
      `mail.periodoCerrado` · `mail.facturaEmitida` · `mail.liqEmitida` · `mail.liqPagada` ·
      `mail.pagoRechazado` · `mail.foliosPorAgotarse` · `mail.certificadoPorVencer` ·
      `mail.morosidad` · `mail.excedente` · `mail.seguimiento`.
      **Ningún evento de dinero envía hoy un correo. Ni uno.** El seller no se entera por correo de
      que le facturaron; el conductor no se entera de que le pagaron. Es una decisión de producto
      que el rediseño puede mantener o cambiar, **pero no puede ignorar**.
- [ ] **Los 6 cuerpos que ya existen, reescritos al molde** (`…-MENSAJES.md` §9.3). Quedaron con
      asunto, acción y la regla que los cambia; los cuerpos completos están **pendientes de escribir**.
- [ ] **Los rebotes son invisibles.** Vuelven por `webhook-resend.ts` y no se muestran en ninguna
      parte. Una invitación que rebota es una invitación que nadie sabe que nunca llegó.
- [ ] `src/modules/integraciones/notificaciones/conexion-caida.ts:159-160` tiene un envío de correo
      **comentado**: `plantillaConexionCaida` no existe.

## Brechas del inventario que cierra

- [ ] **#35** — la Torre de control móvil es un prototipo con datos falsos, en producción.

## Bloqueado

- [ ] **NUEVO #1** · La Torre muestra su hora de última actualización y su alcance.
- [ ] **NUEVO #2** · «Nada atascado» como vacío de buena noticia, no como ausencia.
- [ ] **NUEVO #3** · El mapa degradado como estado válido, no como error.
- [ ] **NUEVO #27** · La marca «REIMPRESA» con fecha y hora en la etiqueta reimpresa.
- [ ] *Decisión abierta:* **guardar el logo del courier** — la tarjeta de enlace y la etiqueta ya
      están diseñadas para recibirlo. Brecha chica con efecto en cada entrega.

---

# Bloque 8 · Sin sesión y sitio comercial

**Desbloquea:** las 12 pantallas de B7 y las 6 páginas del sitio.
**Tableros a traer:** `Rutax B7 Sin sesion` · `Rutax B7b Autenticacion` *(ya está local en
`pantallas/`)* · `Rutax Sitio comercial`.
**Depende de:** bloques 1 y 2.

> **Las 13 pantallas sin sesión existen, pero cada una arma su propio marco**: no hay componente de
> `pantalla sin sesión`. Y la tarjeta de enlace compartido está en **cero absoluto**.

## Componentes

- [ ] **`pantalla sin sesión`** · DE CERO · 3 casos de marca · las 12 de B7.
      **Regla 42: la marca la decide el dueño de la relación** — Rutax cuando el visitante es
      nuestro cliente, el courier cuando es cliente del courier, **neutra cuando no lo sabemos**.
      **Regla 43:** el nombre del courier en texto es la versión canónica; su logo es una mejora
      opcional. **Regla 44:** sin sesión, el tema lo decide el sistema operativo.
      **Regla 45:** una pantalla pública **nunca confirma ni niega la existencia** de un correo, de
      un envío ajeno o de una cuenta.
- [ ] **`tarjeta de enlace compartido` 1200×630** · DE CERO · **cero absoluto**: no hay un solo
      `openGraph`, `generateMetadata`, `opengraph-image` ni `twitter:` en todo `src/`, y **no existe
      un solo raster en `public/`** (solo `icon.svg`, `logo-rutax.svg`, `logo-rutax-wordmark.svg`),
      y `og:image` exige raster. Hoy, al pegar el enlace de seguimiento en WhatsApp, el comprador ve
      el título genérico del layout raíz — copy dirigido al courier, no al destinatario del paquete.
      **Regla 47: una previsualización de enlace no dice estados.**
      *(El «powered by» del seguimiento está diseñado como pieza: es el único canal de Rutax hacia
      consumidores finales y genera una impresión por entrega.)*
- [ ] **`línea de tiempo pública`** · DE CERO · `/tracking/[token]` · 1 pantalla.
      **Regla 46: el estado que ve el comprador es una traducción, no un renombre** — mismo tono y
      glifo, otra redacción. **Regla 66: al comprador final nunca se le muestra** dirección,
      teléfono, nombre del destinatario, seller, conductor ni monto.

## Pantallas sin sesión · 13

- [ ] `/login` (`src/app/login/page.tsx` + `formulario-login.tsx`) — **login único de todo el
      producto**: courier, seller y conductor entran por acá. **NUEVO #29: el semáforo del sistema.**
      **NUEVO #30: «lo último que cambió», con su pantalla de origen.**
- [ ] `/portal/login` — 6 líneas, solo `redirect("/login")`. No hay login propio del portal.
- [ ] `/admin/login` — el formulario lo renderiza `admin/layout.tsx`, no la página. Con MFA/TOTP.
- [ ] `/registro` + `/registro/revisa-tu-correo`
- [ ] `/activar-cuenta`
- [ ] `/invitacion/[token]` — el diseño trae **5 estados de error** de la invitación.
- [ ] `/recuperar-contrasena` + `/restablecer-contrasena`
- [ ] `/tracking/[token]` — seguimiento público, **con sus 5 estados**.
- [ ] `/terminos` y `/privacidad` (`(legal)/layout.tsx` propio) — **la pantalla está diseñada; el
      texto lo escribe un abogado**, en USTED, con su versión y su fecha de vigencia.
- [ ] `/offline`
- [ ] **`not-found.tsx` — NO EXISTE en ninguna parte del repo.** Todos los `notFound()` caen en la
      404 por defecto de Next, **en inglés y sin marca**. La ve el destinatario del paquete
      (brecha #10) · NUEVO #28.
- [ ] `src/app/error.tsx` y `src/app/global-error.tsx` — existen. `global-error.tsx` renderiza su
      propio `html`/`body` con estilos **en línea**, así que **no ve ningún token**: hay que pasarle
      los valores a mano, como al mapa y a los PDF.
- [ ] `/kitchen-sink` — decidir. Hoy no está protegida ni por sesión ni por `NODE_ENV`.

## Sitio comercial · 6 páginas, ninguna construida

**No existe.** `src/app/page.tsx` son 31 líneas de puro enrutamiento por tipo de usuario. No hay
`(marketing)`, ni `/precios`, ni `/agendar`. La especificación completa está en
`RUTAX-SITIO-COMERCIAL.md`.

- [ ] **La portada** — 12 secciones, dibujada en el tablero.
- [ ] `/integraciones/mercado-libre-flex` — *definida en razón, estructura, H1, título y meta; no dibujada.*
- [ ] `/integraciones/shopify` — *no dibujada.*
- [ ] `/cobros-y-liquidaciones` — *no dibujada.*
- [ ] `/precios` — *no dibujada.* **Decisión abierta: el número del precio** y si hay mínimo mensual
      para couriers de 1 a 5 conductores. La unidad ya está decidida: por conductor al mes.
- [ ] `/agendar` — **regla 80: un solo destino**, todas las páginas llevan acá.
- [ ] **Tablet y teléfono** — especificado, **no maquetado**.
- [ ] **Las dos fotografías** — especificadas con su criterio; **son una compra**.

**Las cinco reglas del sitio que se verifican solas:**
`74` ninguna cifra aparece por animación · `75` ninguna animación se repite en bucle ·
`76` toda pieza animada tiene su versión estática diseñada · `77` no se lista una integración que
no existe, y cada una lleva su estado real · `78` las maquetas salen del producto rediseñado ·
`79` **cero imágenes arriba del pliegue** — la velocidad es parte del argumento.

**Y los tres errores que este trabajo ya cometió y no hay que repetir:** el titular sobre un detalle
operativo de un cliente («Si cierras a las 16 horas…» excluye al 95 % de los visitantes) · la
sección que describe *una* operación en vez del arco · suponer que el seller declara cuántos bultos
retirar.

## Brechas del inventario que cierra

- [ ] **#7** — el inicio de sesión presenta toda causa de fallo como error de tipeo.
- [ ] **#9** — no hay página de inicio, y el registro no tiene un solo enlace entrante.
- [ ] **#10** — el destinatario del paquete ve el 404 en inglés del framework, y la página de
      seguimiento no tiene ni salidas ni marca.

## Bloqueado

- [ ] **NUEVO #28** · La pantalla de «no encontrado» y el caso del enlace de Flex.
- [ ] **NUEVO #29** · El semáforo del sistema en el login. *El dato ya se mide en el backstage; lo
      que no existe es exponerlo ahí. Ahorra una llamada cada vez que el SII se cae.*
- [ ] **NUEVO #30** · «Lo último que cambió», con su pantalla de origen. *Necesita que el backstage
      tenga dónde escribirlo —tres campos, fecha y texto—, junto a «Avisos a couriers». Sin eso el
      panel se queda viejo en dos meses y pasa a ser prueba en contra.*
- [ ] *Decisión abierta:* **el número del precio** y el mínimo mensual.
- [ ] *Decisión abierta:* **términos y política de privacidad** — los escribe un abogado.

---

# Bloque 9 · Los 12 componentes que §10 no asigna

**Esto no reordena nada: lo declara.** El orden de construcción de
`RUTAX-COSTO-DE-IMPLEMENTACION.md` §10 tiene ocho filas y **no nombra los bloques de diseño B1b
(incidencias y manifiestos), B1c (conductores y dashboard), B3a (puesta en marcha), B3b
(configuración), B4 (portal) ni B6 (backstage)**. Esas pantallas heredan del marco y del estado,
pero **sus componentes propios se quedan sin lugar en el orden**. Son estos doce.

**Propuesta de ubicación** — si va en otro lado, se cambia acá y se dice por qué:

| Componente | Costo | Pantallas | Propuesta |
|---|---|---|---|
| `asistente por pasos` | DE CERO | B3a · 1 pantalla, 5 pasos | **9a · Puesta en marcha**, después del bloque 4 |
| `pantalla de cierre de asistente` | DE CERO | B3a · 1 | 9a · **NUEVO #13** |
| `formulario de configuración` | EXTENDER | B3b · las 9 de configuración | **9b · Configuración**, con el bloque 4 |
| `fila vigente / programada` | EXTENDER | tarifas, cortes, planes · 4 | 9b · regla 28 |
| `bloque de capacidades` | DE CERO | B3b Equipo, B6 Equipo · 2 | 9b · **NUEVO #14** · regla 30 |
| `credencial de una sola vez` | DE CERO | B3b Integraciones · 1 | 9b · regla 31 |
| `formulario de alta con aviso en línea` | EXTENDER | B1c, B3b, B4, B6, B7 · 14 | 9b |
| `tarjeta de salud de conexión` | DE CERO | P7, B3b Sellers, B4, B6 · 6 | **9c · Conectar cuentas (P7)** |
| `bloque de falla externa` | DE CERO | P7, B4 Inicio · 4 | 9c · `alert` no alcanza: **tres causas indistinguibles** |
| `fila de salud de conexión` | EXTENDER | B6 Salud · 1 | 9c |
| `secuenciador de ruta` | DE CERO | B1b Manifiestos · 2 | **9d · Operación**, después del bloque 4 |
| `redistribución por conductor no disponible` | DE CERO | B1b · 1 | 9d · **NUEVO #4** |

> **Por qué 9c importa más de lo que parece.** El sondeo de salud de ML no distingue causas: token
> vencido, revocado y fallo de descifrado terminan los tres en «desvinculada» con el mismo texto. El
> `bloque de falla externa` existe precisamente para eso, y **regla 60: un error de integración dice
> siempre qué sigue funcionando.**

## Reglas de configuración que se verifican acá

- [ ] **Regla 25** — no hay autoguardado: guardado explícito por sección, con acuse.
- [ ] **Regla 26** — todo formulario de edición llega **precargado con el valor vigente**. Hoy el
      botón dice «agregar / editar ventana de corte» y **no edita** (brecha #32) · NUEVO #16.
- [ ] **Regla 27** — **nada se borra: se desactiva.** Y todo lo desactivado **tiene cajón y vuelta**.
      Hoy cinco estados no tienen retorno (brecha #16) · NUEVO #17.
- [ ] **Regla 28** — lo vigente y lo programado conviven en la misma tabla.
- [ ] **Regla 29** — **un asistente sin pantalla de cierre no está terminado.** Hoy la puesta en
      marcha **no puede completarse nunca** (brecha #8) · NUEVO #13.
- [ ] **Regla 30** — un cambio de permisos se explica con el catálogo de capacidades: pierde / gana /
      sigue sin tener. Hoy `/equipo` dice que la gestión de rol está «próximamente» (brechas #29 y
      #14) · NUEVO #14.

---

# Anexo A · Los 30 marcados NUEVO

**Ninguno está aprobado ni descartado.** La ficha de cierre es explícita: aprobarlos o descartarlos
**es lo único que bloquea**. Están todos diseñados y **aislados**: descartar cualquiera no obliga a
rediseñar lo demás, así que el resto de su bloque avanza igual.

Marca cada uno `[x]` si entra o `N/A` si se descarta, con una línea de razón.

## Van en el bloque 4 · Marco

- [ ] **#12** · Un solo conteo del que leen el banner y el asistente.
- [ ] **#21** · Se retira el buscador global del portal; entra el local. *(Hoy el seller ve el botón
      y la paleta ⌘K, y `/api/buscar` siempre le devuelve vacío.)*

## Van en el bloque 5 · Dinero

- [ ] **#7** · Se retira el «IVA 19 %» del portal: era el residuo entre total y líneas.
- [ ] **#8** · Rótulo bruto/neto obligatorio en cabecera y pie de toda tabla financiera.
- [ ] **#9** · El cajón «Con problemas» filtra de verdad.
- [ ] **#10** · Los chips de liquidaciones navegan, como los de los otros dos módulos.
- [ ] **#11** · El motivo del ajuste manual viaja al PDF del conductor.

## Van en el bloque 6 · App del conductor

- [ ] **#22** · Los tres temas de la app del conductor.
- [ ] **#23** · Escala de tamaño de texto en la app.
- [ ] **#24** · Sonido y vibración: cuatro señales.
- [ ] **#25** · Notificaciones push: tres momentos.
- [ ] **#26** · Aceptación del receptor en el traspaso, hoy unilateral.

## Van en el bloque 7 · Sub-sistemas

- [ ] **#1** · La Torre muestra su hora de última actualización y su alcance.
- [ ] **#2** · «Nada atascado» como vacío de buena noticia, no como ausencia.
- [ ] **#3** · El mapa degradado como estado válido, no como error.
- [ ] **#27** · La marca «REIMPRESA» con fecha y hora en la etiqueta reimpresa.

## Van en el bloque 8 · Sin sesión y sitio

- [ ] **#28** · La pantalla de «no encontrado» y el caso del enlace de Flex.
- [ ] **#29** · El semáforo del sistema en el login.
- [ ] **#30** · «Lo último que cambió», con su pantalla de origen.

## Van en el bloque 9 · Lo que §10 no asigna

- [ ] **#4** · Redistribución por conductor no disponible, con su modal de reparto. *(9d)*
- [ ] **#5** · Secuenciación con la razón escrita cuando no puede optimizar por cierre. *(9d)*
- [ ] **#6** · Marca de disponibilidad del conductor visible para el coordinador. *(9d)*
- [ ] **#13** · La pantalla de cierre del asistente. *(9a)*
- [ ] **#14** · Cambiar el rol de una persona activa, con su bloque de capacidades. *(9b)*
- [ ] **#15** · Suspender y reactivar con su transición real. *(9b)*
- [ ] **#16** · La ventana de corte precargada con el valor vigente. *(9b)*
- [ ] **#17** · Cajón «Inactivas» con reactivación: los cinco estados sin salida. *(9b)*
- [ ] **#18** · Ficha de seller: hoy el listado es terminal. *(9b)*
- [ ] **#19** · Reportar un problema desde el portal del seller. *(portal)*
- [ ] **#20** · Detalle de la incidencia con sus notas y su efecto en el cobro. *(portal)*

> ⚠️ **La ficha importada de Claude Design dice 28; son 30.** El tablero `B7b Autenticacion` se
> agregó después y trae los números 29 y 30. Si se vuelve a importar la ficha, **hay que reponer esa
> corrección**.
>
> **Ya aprobado e integrado:** el panel inferior de registro de escaneo con log de repetidos (B5).

---

# Anexo B · Las decisiones abiertas que no son de diseño

| Qué | Quién decide | Nota | Bloque que espera |
|---|---|---|---|
| **El número del precio** y si hay mínimo mensual para couriers de 1 a 5 conductores | Negocio | Unidad decidida: por conductor al mes | 8 |
| **Umbrales de lux (8.000/3.000) y permanencia (90 s)** | Terreno | Ajustarlos **en la calle con un teléfono real**, a las 16:00 y a las 21:30 | 6 |
| **Si el courier ve que alguien de Rutax entró a su cuenta** | Negocio | Hoy no se le dice. Hay argumento de confianza para decírselo | 4 |
| **Los 30 min de vencimiento de la sesión de soporte** | Operación | Si la mitad de los tickets la extiende, el número está mal | 4 |
| **Los 7 días de vigencia de la invitación** | Operación | Medirlo contra cuántas vencen | 9b |
| **Guardar el logo del courier** | Producto | Brecha chica con efecto en cada entrega | 7 y 8 |
| **El unitario de la factura** | Contabilidad / SII | Agrupado por comuna con unitario redondeado y total exacto, o por tarifa real | 5 y 7 |
| **Webhooks** | Ingeniería | Formulario simple. Si crece, van a necesitar registro de entregas fallidas | 9b |
| **La nota de crédito** | Producto | La ceremonia de emisión ya tiene el lugar donde iría | 5 |
| **Términos y política de privacidad** | Legal | Lo escribe un abogado. **La pantalla ya está diseñada** | 8 |

**Cerradas, no reabrir:** el manifiesto impreso va en TÚ · la notificación «tu ruta está lista» se
puede apagar y no se avisa al coordinador · no se manda correo al resolver una incidencia del
seller · el acta de retiro no se imprime.

---

# Anexo C · Lo que no se diseñó

## Pantallas pendientes · 5

- [ ] **Las cuatro anulaciones** — *una pasada corta.* Cuatro peldaños 2 con la misma anatomía.
      **Los textos ya están escritos.** *(bloque 5)*
- [ ] **Historial de entregas y pagos del conductor** — *media pasada.* Es la `tabla financiera`
      filtrada por persona. *(bloque 5)*
- [ ] **Detalle de bodega** completo — *media pasada.* Aplicación directa del
      `formulario de configuración`. *(bloque 9b)*
- [ ] **Ficha de seller** desplegada — *media pasada.* NUEVO #18. *(bloque 9b)*
- [ ] **Torre de control en móvil** — *media pasada.* Es del **coordinador**, no del conductor.
      *(bloque 7; hoy es un prototipo con datos falsos en producción, brecha #35)*

## Contenido pendiente

- [ ] Los **42 mensajes de éxito de módulo único**. El molde los resuelve sin ambigüedad.
- [ ] Los **cuerpos completos de los 6 correos que ya existen**. Quedaron con asunto, acción y la
      regla que los cambia.
- [ ] **Términos y política de privacidad.** Lo escribe un abogado; la pantalla ya está diseñada.

## Sitio comercial pendiente

- [ ] Las **cuatro páginas secundarias** en detalle (definidas en razón, estructura, H1, título y
      meta; **no dibujadas**).
- [ ] Las **dos fotografías** (especificadas con su criterio; **son una compra**).
- [ ] El **sitio en tablet y teléfono** (especificado, no maquetado).

## Lo que se decidió NO diseñar

| Qué | Por qué |
|---|---|
| **Trabajo sin conexión** en la app | Se retiró del producto |
| **Acta de retiro impresa** | Nadie la echó de menos |
| **Recorrido histórico del conductor** | No existe el dato |
| **Blog del sitio** | No se abre hasta que exista quien lo escriba |
| **Refinamiento visual del backstage** | Uso interno: hereda el sistema y arregla lo roto |

---

# Anexo D · Deuda contra las 80 reglas, medida

Esto es lo que hace el checklist **verificable en vez de opinable**. Los números se recalculan, no
se copian — los comandos están abajo.

| Regla | Qué dice | Deuda hoy | Bloque |
|---|---|---|---|
| **56** | Ningún error de dinero va en notificación temporal. Van embebidos y se quedan | **15 `toast.error`** en `(tenant)/dinero/` | 5 |
| **37** | Ninguna acción se confirma con un diálogo nativo del navegador | **6 `confirm()`** en `src/app/admin/` (brecha #21) | 4 y 9 |
| **—** | La escalera de fricción es una, para las cinco superficies | **15 de 19 acciones** de `dinero/acciones.ts` no usan el diálogo canónico, más los 2 de lote sin checkbox | 5 |
| **69** | Solo el eje de ciclo usa distintivo con color | **32 llamadas** a `BadgeEstado` sin `eje`+`valor`, más **10 envoltorios locales** con color propio | 0 |
| **4** | Sin sombras: la elevación es escalón de fondo + borde | `rutax-conductor/src/theme.ts` define una escala de `shadow` | 6 |
| **70** | El vocabulario es uno: un concepto, un nombre, igual en las cinco superficies | **3 vocabularios** para bruto/neto en dinero | 5 |
| **—** | Una vista no se refresca sola recargando la página | **7 `window.location.reload()`** | 4, 5 |
| **35** | Una pantalla no promete una acción que la interfaz no ofrece | buscador del portal siempre vacío · `/equipo` dice «próximamente» · botones de anular sin camino | 4, 9 |
| **58** | Todo vacío de buena noticia lleva una cifra y la hora de la última revisión | 7 pantallas muestran su vacío cuando en realidad **falló la lectura** (brecha #1) | todos |

### Las 15 acciones de dinero que hoy no pasan por el diálogo canónico

`cerrarPeriodoManualmente` *(Dialog genérico, sin checkbox, Esc y clic-fuera activos)* ·
`marcarLiquidacionPagada` *(Dialog genérico + `window.location.reload()`)* ·
`ajustarLiquidacion` *(formulario, sin confirmación)* ·
`transicionarEventoConciliacion` y `reabrirEventoConciliacion` *(bloque inline)* ·
`asignarEventoConciliacion` · `fijarFechaLimiteConciliacion` ·
**`fijarBloqueosConciliacion`** *(sin confirmación, y decide si sale plata)* ·
`cambiarAccionSugeridaConciliacion` · `agregarComentarioConciliacion` ·
`atribuirPagoManualmente` y `descartarPago` *(popover artesanal + reload)* ·
`anularLineaCobroPedido`, `anularLineaLiquidacionPedido` y `anularLineaLiquidacion`
*(`DialogAnular` genérico, sin preflight)*.
Más `emitirFacturasLote` y `emitirPagosLoteLiquidaciones`, que tienen preflight consolidado pero
**no tienen checkbox de fricción**.

### Cómo se recalculan

```bash
grep -rnE "<BadgeEstado[ />]" src/ --include=*.tsx | grep -vE "<BadgeEstado[A-Za-z]" | wc -l
```

```bash
grep -rn "eje=" src/ --include=*.tsx | wc -l
```

```bash
grep -rn "toast.error" "src/app/(tenant)/dinero/" | wc -l
```

```bash
grep -rn "confirm(" src/app/admin --include=*.tsx | wc -l
```

```bash
grep -rn "window.location.reload" src/ | wc -l
```

---

# Anexo E · Cómo se cierra un bloque

1. **Typecheck y lint limpios**, y la suite verde.
2. **Verificación en el navegador contra estilos computados**, no contra capturas — es como se
   verificaron los bloques 1 a 3. Ojo: en Chrome real las capturas salen rotas y no reflowa al
   redimensionar; para 390 px hay que usar el panel embebido.
3. **Los cuatro temas**, no dos: `dark`, `light` y —donde aplique— `sun` y `night`.
4. **Modales y hojas en viewport bajo**: ¿cabe? ¿se alcanzan el encabezado y el pie? «Hay scroll» no
   es «está bien».
5. **Volumen real de datos.** Sembrar a escala antes de dar una pantalla por buena: 60 pedidos
   esconden bugs que 1.000 destapan.
6. **Marcar los ítems del bloque en este documento**, con su evidencia.
7. **Actualizar `checklist-pruebas-funcionales-mvp.md`** si el bloque cambió el comportamiento de
   un RF, no solo su aspecto.

---

*Abierto el 22-08-2026 · 108 componentes del catálogo · ~102 pantallas · 30 NUEVO sin decidir.*
