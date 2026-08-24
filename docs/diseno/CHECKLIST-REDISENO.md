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

## ⚠️ Auditoría del 24-08-2026 — el checklist iba por detrás del código, otra vez

Se verificó **ítem por ítem contra el código**, no contra lo que este archivo declaraba. De los
pendientes de los bloques 4, 7 y 8, **once ya estaban hechos**. La cuenta real quedó así:

**Bloque 4 · Marco** — 3 de 5 pendientes eran falsos:
- ~~`configuracion/page.tsx` (hoy 404)~~ → **existe**, con siete secciones colgando.
- ~~#17: dos pantallas de «sin permiso» mandan a una ruta inexistente~~ → los cuatro destinos
  (`/`, `/dashboard`, `/onboarding`, `/preparacion`) **existen**.
- **Sigue vivo:** solo hay `error.tsx` en la raíz. Un error en cualquier pantalla **se lleva el
  `AppShell` entero** y el usuario pierde el sidebar justo cuando algo ya salió mal. Faltan
  boundaries por segmento.

**Bloque 7 · Sub-sistemas** — 3 de los declarados eran falsos:
- ~~`polígono de comuna` con rampa de carga~~ → **hecha**, con pruebas de los cuatro pasos en los
  cuatro temas, incluida la contraprueba de que la rampa sigue distinguiéndose atenuada.
- ~~`punto de entrega` con agrupación~~ → **hecha**, con el anillo del agrupado y su caso de
  «no existe cuando sí hay glifos».
- ~~«Los rebotes son invisibles»~~ → **`/equipo` sí muestra el estado de entrega** desde el 16-08,
  con prueba de regresión. Queda por revisar si otras superficies lo muestran.
- **Sigue vivo:** los glifos del basemap. `NEXT_PUBLIC_MAPA_GLIFOS_URL` está en `.env.example` y en
  `.env.local`, y el código ya la lee; falta confirmar que los cuatro PBF estén publicados al bucket
  y que la variable esté puesta en producción.

**Bloque 8 · Sin sesión y sitio** — la lista de «6 pantallas» estaba mal en las dos direcciones:
- **Ya adoptaron `PantallaSinSesion` (5):** `/login`, `/registro`, `/recuperar-contrasena`,
  `/invitacion/[token]`, `/tracking/[token]`.
- **Pendientes de verdad (8), y son más de las 6 declaradas:** `/registro/revisa-tu-correo`,
  `/activar-cuenta`, `/restablecer-contrasena`, `/offline`, `/portal/login` *(6 líneas: solo
  redirige)*, `/admin/login` *(el formulario lo renderiza el layout, no la página)*, y las dos
  legales `(legal)/terminos` y `(legal)/privacidad`, que tienen **marco propio** de 160 y 237 líneas.
- **El sitio comercial sí está como decía:** existen `/` y `(marketing)/agendar`; las cuatro páginas
  —`integraciones/mercado-libre-flex`, `integraciones/shopify`, `cobros-y-liquidaciones`, `precios`—
  **no existen**.

### La regla que sale de acá, y ya es la quinta vez

**Un ítem del checklist no es evidencia; es una hipótesis.** Antes de construir contra esta lista,
comprobar contra el código — un `ls`, un `grep` del componente que debería estar adoptado. Las tres
veces que se saltó ese paso se reconstruyó algo que ya existía o se dio por hecho algo que no.

Y el corolario para escribir ítems nuevos: **un pendiente debe decir cómo se comprueba**. «Falta la
adopción» no se verifica; «no importa `PantallaSinSesion`» sí, con un comando.

---

## Tablero de estado

| # | Bloque de construcción | Estado de la capa | Lo que falta | Bloqueado | Tablero que traer |
|---|---|---|---|---|---|
| **1** | Tokens y primitivas | **hecha** — tokens, puente, fuentes, 8 re-estilos, selector de fecha, `interruptor` | `credencial de una sola vez` | — | *(no hizo falta)* |
| **2** | Estado | **hecha** — 8 de 10 · 25 ejes · 33 correcciones con prueba mecánica | los 4 vocabularios que faltan viven en la app del conductor (bloque 6) | — | *(no hizo falta)* |
| **3** | Tablas | **hecha** — las 4 piezas nuevas | adopción: **0 pantallas reales**, solo `kitchen-sink` | — | *(no hizo falta)* |
| **0** | **Cola de 1–3** | **5 de 6 hechos** — interruptor, 33 correcciones, 55 sitios, 13 vocabularios absorbidos, lint | solo 0.2b, y su bloqueo **ya caducó**: entra con Pedidos | — | — |
| **4** | **Marco** | **6 de 8** · los 2 abiertos dependen de decisiones tuyas | índice propio de configuración (B3b) · buscador del backstage | #12 · #21 | `Rutax P1 Pedidos` ✅ traído |
| **5** | **Dinero** | **cerrado** — 16 componentes, 6 pantallas, 12 de 26 acciones | lo que queda del bloque está **bloqueado o fuera de alcance**: el interruptor de DTE real (decisión tuya), 4 acciones que no existen todavía, 2 que viven en la app del conductor, y `pedidos.cancelar*` en `operaciones` (trabajo en curso). Sigue pendiente el multi-período del atribuidor. | #7 a #11 | `P4` ✅ `B2a` ✅ `B2b` ✅ |
| **6** | **App del conductor** | **CERRADO el 24-08** — 6.0 a 6.5 completos, incluidas la casilla táctil de 56 px, el barrido vertical y la hoja inferior | la adopción de la hoja en el resto de los paneles va **por pantalla**, con su bloque. Y **nada se ha visto en un teléfono real** | #22 a #26 · #31 a #33 | `Rutax B5 App del conductor` ✅ · `B5b` ✅ · `P5` |
| **7** | **Sub-sistemas** | **12 de 26** — los 5 correos de dinero, la alerta de certificado, el CSV del seller, el atribuidor de ajustes, los grupos del mapa | cartografía (cruce de 200 ms, tramo del zoom, glifos del basemap) · rebotes invisibles · 6 cuerpos de correo por reescribir | #1 · #2 · #3 · #27 | `Rutax Subsistemas` · `B1a` · `B8` |
| **8** | **Sin sesión y sitio** | **15 de 33** — marco sin sesión, tarjeta 1200×630, `not-found`, `error`/`global-error`, `/login`, **portada + `/agendar` + secuencia del hero**, **`/tracking` con su línea de tiempo**, **`/invitacion` con sus 5 finales** | 6 pantallas sin sesión (activar, registro, recuperar, legales, offline, `admin/login`) · 4 páginas del sitio, ninguna dibujada · tablet y teléfono del sitio | #28 · #29 · #30 | `Rutax B7 Sin sesion` · `B7b` · `Sitio comercial` |
| **9** | *(no está en §10)* | 12 componentes sin bloque asignado | 12, repartidos en 9a–9d | #4 · #5 · #6 · #13 a #20 | `B1b` · `B3a` · `B3b` · `P7` |

**Los 33 marcados NUEVO están todos bloqueados por una decisión del usuario** (anexo A). Están
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

- [x] **0.2b · Las 5 llamadas de `operaciones/` — HECHAS (24-08).** Tres en el listado (pedido, geo,
      cobertura) y dos en el detalle (pedido, incidencia).
      **Lo que desbloqueó, y se vio en pantalla:** `Cancelado` pasa a `inert` **con su trama de
      135°**. Antes era el mismo gris que algo pendiente — es decir, un pedido fuera de juego se leía
      como trabajo por hacer. `(tenant)/operaciones/page.tsx` (3) y
      `(tenant)/operaciones/[pedidoId]/page.tsx` (2). Los ejes son `pedido`, `geo`, `cobertura` e
      `incidencia`, todos ya declarados.
      🔴 **EL BLOQUEO CADUCÓ Y NADIE LO MIRÓ (auditado el 24-08).** Decía «modificadas sin commitear
      por trabajo en curso ajeno al rediseño», y era cierto el 22-08. Ese trabajo **aterrizó**
      (`6b6f893`, el filtro de fecha) y la carpeta está limpia desde entonces.
      ⚠️ **Y no era el único: los cinco bloqueos por circunstancia apuntaban a `operaciones/` y
      caducaron todos a la vez** — estas 5 llamadas, el `Retorno` del detalle, la migración de
      `pedidos.cancelar*` a ceremonia de dinero, la `BarraCajones` y la `FranjaCambiosPendientes`.
      **Es la tercera vez que este documento va por detrás del código** (antes: el bloque 6 entero y
      el cartel de la PWA). El patrón: se escribe cuando algo se bloquea y no se revisa cuando se
      desbloquea. **Un bloqueo por circunstancia debería llevar de qué depende, para poder
      comprobarlo** — «cuando aterrice X» se comprueba en un comando; «trabajo en curso» no.

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
      ✅ **Las de `operaciones/` ya están (24-08):** el detalle del pedido tenía un enlace propio con
      sus clases a mano y **mandaba siempre al listado de fábrica**, perdiendo los filtros de origen.
      Ahora es el `Retorno` del sistema con `destinoRetorno`. **Verificado en el navegador las dos
      mitades:** con `?volver=/operaciones?estado=asignado` conserva el filtro, y con
      `?volver=//sitio-malo.cl/phishing` cae a `/operaciones`.
      ✅ **Y `conductores/[id]` ya lo tenía** (comprobado el 24-08; el checklist lo daba por
      pendiente). *Falta:*
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

- [x] **`BarraCajones` en `(tenant)/operaciones` — HECHA (24-08).** Eran seis botones con clases
      escritas a mano (`bg-warning-subtle`, `bg-info-subtle`, `bg-destructive-subtle`): colores del
      ADN anterior que no pasaban por ningún tono, y **sin declarar nunca que la suma no cuadra**.
      **La aritmética del tablero encajó sola, y es lo que confirma que el componente se diseñó para
      esta pantalla:** cinco cajones suman (128+96+34+18+8 = 284), «por revisar» **cruza** los cinco
      —sus filas ya están contadas— y «cancelado» queda **fuera** (7), total 291. Son exactamente los
      tres papeles de la API: `cajones` · `transversal` · `excluido`.
      🐞 **`cancelado` no se contaba**: `contarPedidosPorGrupo` hacía seis consultas y ninguna era la
      suya, así que no había cifra con la que declarar el total real. Ahora son siete.
      **Verificado en pantalla:** «12 en los grupos de arriba · 1 cancelados · 13 en total».
      ✅ **Y la mitad de `preparacion/asignar`, hecha el 24-08.** Ahí eran tres chips escritos a mano
      dentro de «Filtros» —Todos · Sin asignar · Asignados— **sin una sola cifra**. Y el estado no es
      un filtro más: es **la partición principal** de esa pantalla — el coordinador entra a ver qué
      falta por asignar, y esa es la primera pregunta que debería contestarse sin abrir nada.
      Sube a la barra con sus conteos, y el contador del botón «Filtros» deja de sumarlo.
      **Verificado en pantalla:** «Todos 6 · Sin asignar 0 · Asignados 6», y el cajón navega
      a `?estado=asignado` y queda marcado.
- [x] **`FranjaCambiosPendientes` en `operaciones` — CABLEADA (24-08), y ver el aviso de abajo.**
      La pantalla se refrescaba sola por Realtime, y en ésta eso no es una virtud: **la lista se
      reordena bajo el cursor sin avisar**. El coordinador leía la fila 12, entraba un pedido, y la
      fila 12 pasaba a ser otra — peor si iba a tocarla. Ahora los cambios se acumulan, la franja
      dice cuántos son, y la lista se reordena **solo cuando él lo pide**.
      El contador vive en un contexto porque se muestra en dos sitios lejanos del árbol —el indicador
      de la cabecera, que es quien escucha, y la franja bajo los filtros—, y así la página **no se
      vuelve de cliente**: los hijos de servidor pasan como ranura.
      ⚠️ **El seguro de la selección NO se construyó** *(decisión del usuario)*: el tablero pide que
      con una selección activa ni los cambios en sitio se apliquen, pero **Pedidos no tiene
      selección** — esa vive en la bandeja de asignar. Entra cuando exista una acción en bloque acá.
      ✅ **Verificada de punta a punta** tras arreglar la causa raíz: llega, se acumula, se
      incorpora al pedirlo y la franja desaparece. Al cablearla se destapó que **Realtime estaba roto
      para todo el proyecto** — ver el aviso al final del bloque.
      ✅ **Y la mitad de `preparacion/asignar`, hecha el 24-08.** Ahí el patrón **ya existía** —
      `AvisoNovedades`, con su propio `onSenal`— pero decía «Hay pedidos nuevos disponibles»:
      cierto y **sin peso**, porque uno y treinta se leen igual. Con la cifra el coordinador puede
      decidir: «llegaron 2» se pospone, «llegaron 30» no. Se retira el componente local.
- [x] **P1 Pedidos COMPLETA (24-08) — la pantalla entera contra su tablero, no solo sus mecánicas.**
      Se cerró antes «por mecánicas» —ejes del distintivo, aritmética de cajones, franja, táctil— sin
      comparar nunca la pantalla completa con el dibujo. La objeción fue correcta. Lo que entró:
      - **Refresco en sitio con marca de 8 s**, medida en el navegador: aparece, la fila **no se
        mueve**, y se retira a los 8,0 s exactos. La franja queda para lo que entraría nuevo, ahora
        con **dos cifras** —«llegaron 6 nuevos y 2 cambiaron de estado»—, porque con un solo número
        había que incorporar para saber cuál de los dos ocurrió.
      - **Caída de columnas en el orden del tablero** (procedencia → motivo → seller → fecha): siete
        columnas en escritorio, **tres a 1024** —estado, destinatario, conductor— y **ficha de tres
        líneas bajo `md`**. Verificado en los tres anchos.
      - **Columna MOTIVO arreglada**: mostraba solo los distintivos de geocodificación, así que las
        dos filas que el tablero dibuja con motivo —«Nadie recibió», «Seller canceló»— salían vacías.
        Ahora contesta la pregunta entera: cancelación › incidencia viva › problema de dirección.
      - **Los cinco estados**, con el copy real y cifras que no se inventan. El de «no hay
        direcciones por revisar» **dejaba de ser cierto de mañana** —decía «quedaron ubicadas»
        cuando ninguna se había geocodificado aún—; ahora dice cuántas siguen ubicándose.
      - **Los cajones no se ponen en cero ante una lectura fallida**: conservan su último valor y
        dicen de qué hora es, o muestran rayas. Probado cortando las dos consultas.
      - **Pie de truncamiento con sus dos salidas.** La segunda no existía: se construyó
        `GET /api/operaciones/exportar` (CSV con `;`, BOM, fórmulas neutralizadas, mismo saneo de
        filtros que la pantalla y bitácora antes de entregar el archivo).
      - **Vista previa lateral al tocar la fila** *(feature nuevo del tablero, traído el 24-08)*:
        430 px en escritorio, 380 en tablet, hoja inferior al 85 % arrastrable en teléfono; la lista
        se atenúa **sin velo** y tocar otra fila cambia el contenido sin cerrar. Sin acciones de
        consecuencia adentro, a propósito.
      ⚠️ **Lo que NO se hizo, y por qué:** la casilla de selección que el tablero dibuja en la ficha
      de teléfono. Pedidos **no tiene ninguna acción en bloque**, así que sería una casilla que
      selecciona y no lleva a ninguna parte.
      ⚠️ **El seller no reaparece en la línea monoespaciada** aunque la regla en prosa lo nombre: los
      dos dibujos lo omiten, y la razón lo sostiene — el seller es un **eje de filtro**, no un
      identificador de fila. La procedencia sí reaparece: son tres letras que cambian cómo se trata
      el pedido.

- [ ] Unificar la `BarraSeleccion` local de `preparacion/asignar/_componentes/` con la del sistema.

## 🐞 Cuatro defectos que P1 destapó y que valen para todo el producto (24-08)

**1 · El orden de la lista no era determinista.** `listarPedidos` ordenaba solo por `creado_en`, que
empata con facilidad —una ingesta escribe decenas de pedidos en la misma transacción—, y **con la
clave empatada Postgres no garantiza ningún orden**. Se veía como un fantasma: un pedido cambia de
estado, la pantalla se refresca y otras siete filas se mueven sin que nada les pasara. Con el
refresco en sitio, cuya regla entera es «la fila no se mueve», deja de ser fantasma. Desempate por
`id`. **También rompía la paginación**: dos filas empatadas podían salir en la página 1 y en la 2.

**2 · Una fecha civil formateada como instante retrocede un día.** `formatearFechaCorta("2026-08-24")`
hace `new Date(...)`, que la norma manda leer como **medianoche UTC**; en Santiago eso son las 20:00
del 23. La columna FECHA y el chip del filtro decían **23-08 con el filtro puesto en el 24**. Pasa
desapercibido porque el número se ve razonable. Helper nuevo `formatearFechaCivilCorta`, que **no
convierte**: parte la cadena. Red en `formato-cl.fecha-civil.test.ts`, con contraprueba.
Es el hermano del defecto que ya cubría `formato-cl.zona-horaria.test.ts`, y muerde justo cuando
aquél está bien resuelto.

**3 · Una utilidad de Tailwind que no existe no emite nada, y nada falla.** Mordió **tres veces en
una sesión**: `bg-fault-subtle`, `h-row` y `opacity-55`. La clase queda en el nodo, el estilo
calculado no cambia, y no hay error en consola ni en el build. `opacity-[0.55]` tampoco se generó.
**Solo se caza midiendo el estilo calculado en el navegador.** Donde importa, se declara la utilidad
en `rx-puente.css` en vez de confiar en que exista.

**4 · Un `loading.tsx` desmonta la página en cada `router.refresh()`.** Se llevaba por delante los
relojes de la marca —duraba un fotograma en vez de 8 s— y, peor y en silencio, **tiraba el canal de
Realtime y lo reunía de cero en cada cambio**, perdiendo lo que llegara en medio. Regla que sale de
acá: **el estado que debe sobrevivir a un refresco vive en el `layout`, no en la página.** Ahí están
ahora el proveedor de cambios en vivo, la vista previa y la memoria de los cajones.

## ✅ Realtime estaba roto para TODO el proyecto — causa raíz y arreglo (24-08)

Encontrado al cablear la franja de Pedidos, y **resuelto**. Se anota entero porque el modo de fallo
es de los que vuelven.

**El síntoma:** Realtime no entregaba un solo evento a nadie, y todas las pantallas seguían diciendo
**«En vivo»**. El canal sí estaba suscrito; lo que no llegaban eran los datos.

**La causa, en el log del contenedor:**

```
PoolingReplicationError: invalid input syntax for type uuid: "null"
  en realtime.apply_rls(jsonb, integer) → walrus_rls_stmt
```

Los claims que **Realtime** guarda en `realtime.subscription.claims` traen `"seller_id": "null"` y
`"driver_id": "null"` — el **texto** `null`, no un nulo. ⚠️ **No es nuestro hook**: se comprobó
llamándolo, y `jsonb_build_object` con un NULL produce un `null` de JSON correcto. La conversión a
texto la hace Realtime al persistir.

**Por qué no se notaba en ninguna otra parte.** La política de `operacion.pedidos` es
`tenant_id = claim_tenant_id() AND (tipo='interno' OR (tipo='seller' AND …claim_seller_id()) OR …)`.
En una consulta normal de un usuario interno la primera rama es verdadera y **Postgres nunca evalúa**
`claim_seller_id()`. `walrus` evalúa la expresión completa contra la fila, sin ese cortocircuito — de
ahí que fallara **solo** el tiempo real, que es justo donde nadie mira un log.

⚠️ **Y no fallaba una suscripción: fallaba el LOTE.** `apply_rls` procesa los cambios de todos los
suscriptores juntos, así que la excepción de uno **deja a todos sin eventos**.

**El arreglo** (`20260824000001`): las tres funciones de claim que devuelven uuid tratan `'null'` y
`'undefined'` como ausencia, igual que ya trataban `''`. No relaja ninguna barrera —el resultado
esperado era NULL y sigue siéndolo—; lo único que cambia es que se obtiene sin lanzar.
**Verificado:** con la migración puesta, la franja de Pedidos recibe, acumula, incorpora al pedirlo y
desaparece.

🔴 **PENDIENTE EN PRODUCCIÓN.** El hook, las políticas y Realtime son los mismos allá, así que **la
presunción es que producción está igual de rota** — desde siempre, y sin que nadie lo note porque el
indicador está en verde. No se pudo comprobar desde acá (haría falta una sesión real). **Aplicar la
migración es el arreglo; comprobarlo después es mirar el log de Realtime del proyecto hosted.**

**Y una barrera extra en el cliente** (`components/tiempo-real/filtro-tenant.ts`, 7 pruebas): el
indicador **no se suscribe** si el tenant no es un uuid. No era la causa de esto, pero es la otra
puerta al mismo desastre — `tenant_id=eq.${tenantId}` con un nulo interpola la cadena `"null"` en el
filtro y rompe `apply_rls` igual. Se valida la **forma**, no la ausencia: un `if (!tenantId)` deja
pasar `"null"` y `"undefined"`, que es exactamente lo que hay que atajar.

## Pantallas

- [ ] `src/components/app-shell/app-shell.tsx` — es el archivo del bloque (739 líneas).
- [ ] `src/app/(tenant)/layout.tsx` · `src/app/portal/layout.tsx` · `src/app/admin/layout.tsx`
- [x] `src/app/(tenant)/dinero/layout.tsx` — **resuelto: las pestañas se retiran** *(decisión del
      usuario, 22-08)*. Eran un **cuarto patrón de navegación** para tres destinos que ya están en
      el sidebar, **nunca marcaban el activo**, les faltaba Cobranza —que sí es ruta real— y
      llevaban la pastilla redondeada del ADN retirado. El tablero B2a no las dibuja.
      Lo que sí era real se conservó, y de hecho mejoró de sitio:
      · el **contador de excepciones pendientes** se mudó al destino «Conciliación» del sidebar, que
        es donde se ve **sin entrar a la sección** y desde cualquier pantalla. `ItemNav.contador` ya
        existía en el tipo y solo lo pintaba la barra del teléfono; ahora también el sidebar, y
        **colapsado se reduce a un punto** porque en el rail no cabe una cifra (la cantidad igual
        viaja al lector de pantalla).
      · el **modo de emisión** deja de ser un badge suelto y pasa a `FranjaModoPruebas`, el mismo
        componente que usa la ceremonia — con la trama del tono fuera de juego, no un color propio
        (decisión 5 de P4). Se muestra **solo a quien puede emitir**: a los demás no les dice nada.
      Cae `badge-modo-dte.tsx`, que se quedó sin un solo consumidor. **Verificado en pantalla**,
      expandido y colapsado.
- [ ] Las 32 de `(tenant)`, 11 de `portal` y 13 de `admin` heredan sin tocarse.
- [ ] **Falta `src/app/(tenant)/configuracion/page.tsx`** (hoy 404).
- [x] **Boundaries de error por área — HECHO (24-08).** `error.tsx` estaba solo en la raíz, y en el
      App Router un boundary **reemplaza todo lo que cuelga de su propio layout**: una falla en
      cualquier pantalla se llevaba el `AppShell` entero. El usuario se quedaba sin sidebar, sin
      avisos y **sin ninguna forma de ir a otra pantalla**, justo cuando más falta le hace: lo único
      que le quedaba era «Reintentar» sobre la pantalla que acababa de fallar.
      Ahora hay uno por área —`(tenant)`, `portal`, `admin`, `conductor`— y el marco sobrevive.
      **Verificado provocando una falla real en Manifiestos:** el panel sale en el contenido y los
      **11 destinos del sidebar siguen ahí**.
      El de la raíz **se conserva y no sobra**: un boundary no cubre a su propio layout, así que
      sigue siendo la red de lo que revienta en un `layout` de área y de todo lo que no cuelga de
      ninguna —`/login`, `/tracking`, `/invitacion`, las legales, el sitio—.
      El copy lo pone cada área, y no por adorno: contesta **qué NO pasó**, que es la pregunta que
      casi siempre queda sin respuesta. Al conductor —de pie en la calle, entre dos entregas— lo
      primero que le dice es que lo que acaba de marcar está guardado; sin eso, la reacción
      razonable es volver a marcarlo, que es justo lo que duplica registros.
- [x] **Las 404 por área — HECHO (24-08), y salió de mirar lo anterior.** Solo había
      `not-found.tsx` en la raíz, escrita —con cuidado— para **quien no tiene cuenta**: el
      destinatario cuyo enlace de seguimiento no calza. No afirma nada, no confirma ni niega que el
      envío exista (regla 45) y ofrece «Ir a Rutax».
      Esa misma pantalla le salía **al coordinador** que tecleó mal el id de un manifiesto: se le
      decía que fuera al sitio donde ya está, y se le preguntaba si estaba siguiendo un envío.
      ⚠️ **La vaguedad de la raíz no era un defecto: es correcta ahí**, porque ahí de verdad no se
      sabe quién mira. Dentro de un área con sesión sí se sabe, y entonces callar deja de ser
      prudencia y pasa a ser desorientación. Se comparte la forma (`PanelNoEncontrada`) y cada área
      pone su texto. En `(tenant)` se nombra la causa que **sí** se puede afirmar sin adivinar: lo
      que buscaba pudo existir y haber sido eliminado por plazo.
      **Verificadas las dos:** la de `(tenant)` con el sidebar intacto y sin la nota de seguimiento;
      la pública sin sidebar y con su texto original.

## Brechas del inventario que cierra

- [ ] **#17** — las pantallas de «sin permiso» son callejones sin salida, y dos mandan a una ruta
      inexistente.
- [x] **#27 — ya estaba resuelto** *(verificado 24-08)*. `centro-avisos.tsx` dejó de prometer un
      buzón: la cifra ya no dice «sin leer» sino cuántas cosas necesitan atención ahora. Y la
      corrección de fondo está escrita ahí — **un aviso no se lee, se RESUELVE**: desaparece cuando
      su causa deja de ser cierta. Marcarlo como leído con el problema vivo sería esconderlo.
- [x] **#30 — ya estaba resuelto** *(verificado 24-08)*. `portal/layout.tsx` pasa
      `mostrarBusqueda={false}`: `/api/buscar` corta por `tipoUsuario !== "interno"` y le devolvía
      vacío SIEMPRE, así que el botón prometía una acción que no existe (regla 35). Se enciende
      cuando exista el buscador del portal (NUEVO #21, bloqueado).

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
- [x] **`verificación previa`** · DE CERO — `src/components/ui/verificacion-previa.tsx`. La lógica
      ya existía y era buena (`modules/dinero/preflight.ts`, 906 líneas, 16 códigos); lo que
      faltaba era la **forma**, y era la primera de las seis decisiones que P4 fija para todo el
      producto: *la verificación es una pantalla, no una validación*.
      **Se de-duplicaron 288 líneas.** `SkeletonPreflight` / `BloquePreflightFallido` /
      `BandaItemsPreflight` estaban copiados **literalmente** en los tres cuadros de acciones
      irreversibles —emitir factura, nota de crédito y pago—, 96 líneas cada uno, diferenciándose
      **en una sola cadena** para lectores de pantalla («antes de emitir» / «anular» / «pagar»).
      Tres copias de la regla que decide si se emite un DTE son tres oportunidades de que una se
      quede atrás.
      **Y el desenlace del medio no existía**, que es justo lo que el tablero dice: con reparos
      —entregas sin tarifa, un mínimo de facturación no alcanzado— se emitía **sin fricción y sin
      que quedara nada anotado**. Ahora exige un acto explícito y queda en la bitácora **con los
      códigos de lo que se pasó por alto**: `registrarPreflightOmitido` distingue
      `preflight_fallido` de `reparos_ignorados`, porque la pregunta que se hace después no es «¿la
      omitió?» sino «¿qué decía?».
      El desenlace A dejó de ser un silencio: dice «la verificación no encontró reparos», porque un
      vacío no distingue *verificado y correcto* de *no se verificó nada*. El C ya estaba bien —
      deshabilitado con motivo, nunca oculto— y **ninguna casilla lo levanta**: un reparo se asume,
      un bloqueo se resuelve.
      10 pruebas sobre las dos decisiones (`actoBloqueadoPorVerificacion`,
      `laVerificacionQuedaOmitida`). **Verificado en pantalla** el desenlace A; el B y el C no se
      pudieron ejercitar: la semilla no tiene un período con reparos ni con bloqueos.
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
- [x] **`indicador de folio disponible`** · DE CERO — y de paso se cerró un cluster de bugs: **el
      mismo número se calculaba de tres formas distintas** y dos estaban mal.
      · El **dashboard** contaba `folio_hasta − folio_actual` **sin el `+1`**, así que decía
        «agotado» quedando un folio que la emisión real sí entrega (`reservarFolio` guarda contra
        `>`, no `>=`). Y leía «un CAF vigente cualquiera» **sin filtrar por tipo de documento**: con
        dos CAF cargados podía estar alertando sobre el de notas de crédito mientras el de facturas
        estaba lleno.
      · La **verificación previa** lo hacía bien. Su cálculo es ahora el canónico,
        `modules/dinero/folios-disponibles.ts`, con 8 pruebas y el mismo umbral que usa el correo
        de aviso — un tercer número volvería a partir la verdad en tres.
      · El **panel de onboarding** muestra folios *usados* con umbral de 85 %: es otra pregunta y
        está bien que difiera.
      **Y el indicador se montó en `/dinero/periodos`, que es la pantalla desde donde se factura** y
      donde no había ninguno: hasta ahora uno se enteraba por el dashboard —otra pantalla— o al
      abrir el modal, con la ceremonia ya empezada. Verificado en pantalla.
- [x] **`comprobante en sitio`** · DE CERO — la decisión 4 de P4: **el cuadro no se cierra, se
      convierte en comprobante**. Vive en `modal-acto-explicito.tsx` como prop `comprobante`:
      apaga la verificación, el motivo y la confirmación, cambia el filo superior al tono del
      desenlace y deja un solo botón, «Cerrar».
      Antes, la única acción irreversible del producto terminaba con la pantalla desapareciendo y
      un aviso temporal de 4 segundos. Es la regla 56 del otro lado: si un error de dinero no puede
      ir en un toast, un éxito de dinero que dice «se consumió un folio» tampoco.
      ⚠️ **Y se corrigió una frase que era falsa.** El aviso decía «el folio ya quedó consumido», y
      `emitirFacturaPeriodo` **no reserva folio**: lo toma el job C3 al generar el documento. En
      ese instante no se ha consumido ninguno. El comprobante dice lo que sí es cierto — «se asigna
      al generarse el documento».
      ⚠️ **Se aparta del tablero en un punto, y está en el anexo E:** P4 dibuja el comprobante con
      el folio ya adentro («1042 · quedan 7 después»), porque supone la emisión síncrona. Acá no lo
      es.
      Montado en emitir factura y en emitir pago. **Verificado en pantalla con Inngest corriendo**,
      de punta a punta: el cuadro queda abierto, el período pasa a `Facturado` detrás.
      *Un bug propio, encontrado al mirarlo:* el comprobante repetía seller y total, y las dos
      cifras **no eran la misma** —el resumen trae el neto del preflight y el período guarda el
      bruto—, así que quedaban $11.400 y $13.566 juntos sin que nada dijera cuál era cuál
      (regla 18). El comprobante ahora solo agrega lo que el resumen no dice.
- [x] **`bloque de trazabilidad`** · DE CERO — `src/components/ui/bloque-trazabilidad.tsx` más su
      lectura, `src/modules/identidad/trazabilidad.ts`. «Autor, fecha, motivo; por fila y por
      objeto», que es lo que pide la tabla del sistema.
      **El producto ya exigía motivo y ya lo registraba con autor — y eso no se veía en ninguna
      pantalla.** Para saber quién descontó $8.000 de la liquidación de un conductor había que ir a
      la bitácora: otra pantalla, otro permiso. Un motivo que nadie lee es un trámite, no un
      control. En el detalle de liquidación había literalmente **una cita suelta**, sin autor ni
      fecha (brecha E.2, ahora cerrada).
      *Lo que no se hizo, a propósito:* duplicar el autor en cada tabla de negocio. La bitácora es
      el registro y la tabla es el estado; una columna espejo se desincroniza del registro que la
      auditoría considera verdad. Y el motivo se guarda con **cuatro llaves distintas** según la
      acción (`motivo`, `nota_ajuste`, `motivo_bloqueo`, `motivo_anulacion`): se normalizan en un
      solo lugar en vez de en cada pantalla, y **no se reescriben en base** — retocar filas de
      auditoría para que queden prolijas es justo lo que una bitácora no debe permitir.
      ⚠️ **Red mecánica, y encontró seis.** El vocabulario de actos tenía **seis etiquetas para
      acciones que el dominio no emite** (`dinero.pago_emitido`, `dinero.liquidacion_pagada`,
      `dinero.nota_credito_solicitada`…), lo bastante parecidas a las reales como para no notarse
      leyendo. `bloque-trazabilidad.test.ts` lee `modules/dinero/acciones.ts` y compara; verificado
      por mutación, y con contraprueba para que un cambio de formato no deje el conjunto vacío.
- [x] **`tarjeta de resultado en bloque`** · DE CERO — `src/components/ui/tarjeta-resultado-bloque.tsx`,
      montada en la aprobación por lotes de facturas y pagos. «Qué se hizo, qué no y por qué», que
      es lo que pide la tabla del sistema, con la composición que describe la escena de las 15:50.
      Lo que salió bien va como **cifra** y no como lista: veinte líneas verdes idénticas entierran
      las tres rojas que importan. Lo que no se pudo **nunca se colapsa** — es la única parte
      accionable, y esconderla convierte un lote parcial en uno que parece completo.
      *Tres cosas que estaban mal en el resultado anterior:*
      · decía «N emitidos», en pasado, para una acción que **encola** trabajos (decisión 6 de P4,
        brecha #6 del inventario): quien lee «emitidas» va a buscar los folios y no están;
      · decía «emitidos» también para los **pagos**;
      · y **no llevaba el monto**, que es lo primero que se pregunta después de aprobar plata en
        bloque (regla 57). Ahora se calcula sobre los que efectivamente salieron, no sobre el total
        de la revisión — si dos de cinco fallan, ese total ya no describe lo que pasó.
      🐞 **Y apareció uno peor, en pantalla:** `router.refresh()` corría en el mismo instante en que
      llegaba el resultado. Como el panel solo se renderiza si quedan elementos elegibles, los
      recién aprobados dejaban de serlo, **el panel desaparecía y se llevaba el cuadro con él**.
      O sea: quien aprobaba cinco pagos y veía fallar dos **no se enteraba nunca de cuáles**. El
      refresco pasó a ejecutarse al cerrar. Verificado en pantalla las dos veces.
      De paso, «Cancelar» → «Volver» (regla 59) y fuera la X, que hacía lo mismo que un botón
      visible a diez centímetros.

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
- [x] **`dinero/conciliacion`** — **las siete acciones del panel avisaban su fallo con una
      notificación temporal.** En un panel que gobierna si un período se puede facturar y si a un
      conductor se le puede pagar, un aviso que se va en cuatro segundos deja al usuario creyendo
      que el bloqueo se levantó cuando no se levantó, y el control que va a mirar es el mismo que
      acaba de fallar con su valor viejo de vuelta. Ahora el error es embebido y **se queda hasta
      que algo salga bien** — cargar el historial no lo borra: que la lectura funcione no significa
      que la escritura se haya arreglado. El menú rápido de la fila se queda **abierto** con su
      error adentro por lo mismo.
      **De 13 `toast.error` en dinero quedan 1**, y es «asignarme una excepción», que no mueve ni
      bloquea plata: la regla 56 habla de errores de dinero, y forzarlo ahí sería cumplir el
      conteo, no la regla.
- [x] **`dinero/liquidaciones`** (listado) — **el único camino al detalle era el rango de fechas**
      de la columna «Período», que además es `hidden sm:table-cell`: en teléfono no existía, y en
      escritorio nadie lee «01/06 – 30/06» como «abrir esto». Ahí están las líneas agrupadas, los
      ajustes con su motivo y quién los aplicó — justo lo que se mira antes de pagarle a alguien.
      Ahora «Ver detalle» está en la columna de acciones, visible siempre. Y la cabecera del monto
      declara **neto** (regla 18).
- [x] **`dinero/cobranza`** — el cajón «Descartados» **y la vuelta atrás**, que el copy prometía
      desde el principio: «no se borra: queda descartado con tu motivo, y se puede recuperar desde
      el cajón "Descartados"». Verificado: **no había cajón y no había forma de recuperar nada**,
      así que descartar un movimiento era **irreversible de hecho** mientras la pantalla afirmaba
      lo contrario (regla 35). *Decisión del usuario: se construyen las dos cosas.*
      `recuperarPagoDescartado` con RBAC, motivo, bitácora antes del efecto y guarda de carrera en
      la BD. ⚠️ **Vuelve a `sin_atribuir`, nunca al estado anterior** aunque la bitácora lo guarde:
      un movimiento que estuvo `parcial` o `atribuido` y se descartó ya perdió su atribución, y
      restaurarla lo haría figurar imputado a un período sin nada que lo respalde.
      El cajón va en un `<details>` cerrado: es un archivo, no una bandeja de trabajo.
      Y el copy de descartar decía **cuándo usarlo**, no **qué pasa** — «úsalo si el movimiento no
      es una cobranza… quedará registrado en la bitácora»: sin monto, sin decir que sale de la
      bandeja y sin la vuelta atrás. Ahora entra el texto escrito, tal cual, porque ya es cierto.
      6 pruebas. **Verificado en pantalla de punta a punta**, con el movimiento volviendo a la
      bandeja.
- [x] **`conductores/[id]`** — la pantalla donde se ve lo que se le debe a un conductor y donde
      viven dos de las cuatro anulaciones. Sus tres tarjetas de resumen eran **superficies enteras
      de color** —gris, azul y verde a sangre—, con el color como **único portador** del
      significado: eso es la regla 5, y es lo que se pierde al imprimir o para quien no distingue
      esos dos tonos. Ahora la superficie es neutra y el estado va en un `DistintivoEstado`, que
      lleva glifo además de color. Fuera la sombra de la tabla (regla 4) y el monto declara
      **neto** en la cabecera y en cada tarjeta (regla 18).
      **Verificado en pantalla: cero elementos con sombra en toda la página.**
      *Queda fuera `operaciones/[pedidoId]`*, donde vive la tercera anulación: tiene trabajo en
      curso del usuario y no se toca.
- [x] **Un período abierto no tenía camino a su detalle** — `AccionesPeriodo` solo mostraba «Cerrar
      período», y «Ver detalle» aparecía recién con el período cerrado. La pantalla existía y era
      **inalcanzable**: lo que uno querría revisar *antes* de cerrar —las líneas, la tabla
      financiera, la composición del total— solo se podía ver *después*. Ahora el enlace está en
      los dos estados. **Verificado en pantalla.**

## Las 26 acciones irreversibles

`RUTAX-SISTEMA-DE-MENSAJES.md` §2 trae las 33 con su peldaño y su copy ya escritos.
**12 de 26 migradas**, todas verificadas en el navegador con datos reales:

- [x] `periodos.emitir` · **P3 · escribir** — el arquetipo.
- [x] `periodos.cerrar` · **P2** — estaba en `<Dialog>` genérico, con «Cancelar» y X.
      Su copy promete «se puede volver a abrir mientras no esté facturado», y **ahora es cierto**:
      la reapertura se construyó el 22-08 (ver el ítem siguiente), así que la frase del sistema de
      mensajes entró tal como estaba escrita.
- [x] `periodos.reabrir` · **P2 · motivo** — *la acción no existía*: el copy la prometía, el tablero
      B2a la dibujaba y el código no la tenía. `reabrirPeriodo` (`modules/dinero/acciones.ts`)
      devuelve las líneas al período en curso y **limpia los totales**, porque el monto viejo ya no
      corresponde a las líneas.
      ⚠️ **La guarda que no es obvia:** `emitirFacturaPeriodo` **no cambia el estado** —publica el
      evento y el período sigue `cerrado` hasta que el job C3 lo marca `facturado`—. Mirar solo el
      estado dejaría reabrir un período cuya factura ya va camino al SII, y el folio se consumiría
      igual contra un período otra vez abierto. Por eso además se consulta la bitácora por una
      `dinero.emision_dte_solicitada`, y el `UPDATE` lleva su propio `.eq('estado','cerrado')`.
      Nueve pruebas en `acciones-reabrir-periodo.test.ts`, con la guarda de carrera verificada por
      mutación.
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

- [x] **Y aparecieron dos más, fuera del backstage** (22-08): `window.confirm` en
      `(tenant)/configuracion/api/` para **revocar una API key** y **eliminar un endpoint de
      webhooks**. El conteo original de la brecha #21 decía «6 en `src/app/admin/`» y se quedó
      corto porque solo miró esa carpeta: eran **8**, y estos dos están en la configuración del
      propio courier, no en el backstage.
      Los dos son irreversibles y su `confirm()` no decía la consecuencia real. Revocar una key no
      es «se borra un registro»: **todo lo que la use empieza a recibir 401 sin aviso** y no se
      puede reactivar. Eliminar un endpoint no es lo mismo que desactivarlo —eso se revierte en un
      clic—, y el copy ahora lo dice para que nadie use el irreversible por error.
      Ambos pasan por `BotonConfirmado`, el mismo envoltorio del backstage. **Verificado en
      pantalla**, revocación ejecutada de punta a punta.
      **Con esto queda un solo `confirm()` en todo `src/app`**, y es el que está bloqueado a
      propósito.

⚠️ **La regla 38 sigue sin cumplirse en el backstage.** «Toda acción sobre la cuenta de un tercero
exige motivo escrito y queda a nombre de quien la hizo» — pero `suspenderSuscripcion` y
`cancelarSuscripcion` **no aceptan un motivo** en el dominio. Se pasó de `confirm()` a ceremonia
con consecuencia escrita, que es la regla 37; el motivo exige tocar `modules/plataforma`.

- [x] `periodos.emitirNC` · **P2 · motivo** — última usuaria de `DialogConfirmacionDinero` en
      dinero. Trae de paso el comprobante en sitio y el rótulo de modo de pruebas, que antes ponía
      un `BadgeModoDte` suelto dentro del cuerpo en vez del marco.
      El motivo declara **quién lo lee**: «queda en la bitácora y en la propia nota de crédito, que
      el seller recibe» (regla 24). No sube a peldaño 3 porque el acto ya nombra la factura por su
      folio: no hay «la factura equivocada de una lista de diez» que atajar.
      **Verificado en pantalla, y con él el desenlace C de la verificación previa**, que hasta
      ahora no se había podido ejercitar: sin CAF de tipo 61 el cuadro muestra la banda de bloqueo
      y deja el botón **visible y deshabilitado**, con el motivo al lado.

- [x] `periodos.emitirLote` · **P3 · escribir** · y `liquidaciones.pagarLote` · **P3 · escribir** —
      **acá no había ceremonia ninguna.** Aprobar seis facturas —el mayor monto por clic de todo
      el producto— era un `<Dialog>` genérico con un botón: sin escalera, sin nombrar la plata en
      el título y con «Cancelar» de salida. La acción individual ya era peldaño 3, así que **el
      lote pedía menos fricción que emitir una sola factura**.
      Ahora el título lleva el monto («Vas a emitir 6 facturas por $4.128.400»), la revisión
      consolidada es el cuerpo del cuadro, la frase es corta y en mayúsculas —«EMITIR 6», «PAGAR
      2»— porque acá **no hay una contraparte única que nombrar**, y el resultado es el
      comprobante en sitio. **Verificado de punta a punta en pantalla.**
- [x] `config.desactivarCobroAuto` · **P2** — última usuaria de `DialogConfirmacionDinero` en
      configuración. ⚠️ Su consecuencia decía la mitad: «deberás pagar tu plan manualmente cada
      período» **no dice qué pasa si se te pasa**, que es lo único que importa — Rutax se suspende
      y el equipo entero deja de poder entrar. El texto completo ya estaba escrito en el sistema
      de mensajes. *(No se pudo ejercitar en pantalla: la semilla local no tiene suscripción
      activa, así que el bloque no se renderiza.)*
- [x] `excepciones.reabrir` · **P2 · motivo**, y con él las demás transiciones de la bandeja —
      era un cuadro en línea que pedía el motivo y decía «Confirmar», **sin nombrar la
      consecuencia**. Y la de reabrir es la que hay que leer: si bloqueaba facturación, **vuelve a
      bloquearla**, y el período de ese seller deja de poder facturarse. La ceremonia ahora lo dice
      leyendo las banderas reales del evento.
      🐞 **Y para probarlo apareció uno peor:** el vacío «todo cuadra» de `/dinero/conciliacion`
      se disparaba mirando **solo** el conteo de no-terminales, ignorando los filtros. Filtrar por
      «Resuelta» devolvía «todo cuadra · no necesitas hacer nada» y **las excepciones resueltas
      quedaban inalcanzables** — con ellas el botón «Reabrir», que solo vive ahí. Dos errores en
      uno: escondía justo lo que se pidió ver, y afirmaba algo que no había comprobado. Misma
      familia que el vacío mentiroso de cobranza.
- [x] `integraciones.revocarClave` · **P3 · escribir** — *corrección de una decisión propia*: se
      había construido en peldaño 2 y el sistema de mensajes lo tiene en 3. No alcanza con 2: el
      error de este flujo no es «revocar sin querer», es **revocar la clave equivocada** de una
      lista donde todas se llaman parecido y solo se ven cuatro caracteres del prefijo.

**Quedan 8 acciones**, y de esas **4 no son migraciones sino construcción**: suspender a alguien
del equipo y suspender a un conductor no existen todavía, y dos viven en la app del conductor
(bloque 6).

✅ **`pedidos.cancelar` migrada el 24-08.** Estaba fuera por el trabajo en curso de `operaciones`,
que ya aterrizó. Preguntaba «¿estás seguro?» con una descripción genérica —«El pedido pasará a estado
Cancelado. No se puede revertir»— correcta y **inútil**: no decía a quién deja sin cobrar, de qué ruta
lo saca, ni qué NO hace.

Ahora es la ceremonia con el texto que `RUTAX-SISTEMA-DE-MENSAJES.md` ya tenía escrito
(`pedidos.cancelar.conf`, peldaño 2 con motivo), armado con datos reales:

> **Vas a cancelar el pedido RX-BARR-0008**
> Sale de la ruta de Francisco Javier Castro López, no se le va a cobrar a TecnoHogar Chile SpA y el
> seguimiento del comprador va a decir que se canceló. Si el bulto está en tu bodega, queda ahí:
> esto no organiza la devolución.

⚠️ **Cada mitad de la frase se calla si su dato no existe**, y una de esas verificaciones importa: en
**Flex el seguimiento lo gobierna Mercado Libre** y nuestra página ni responde a ese pedido, así que
prometer que «va a decir que se canceló» sería falso. Hoy `puedeCancelar` exige `same_day`, o sea la
rama de Flex no se alcanza — se deja igual, porque la barrera de arriba puede moverse y esta frase no
debería mentir el día que lo haga.

Se conserva el **preflight de dos pasos**: si hay líneas de dinero que no se anulan solas, el segundo
clic dice «Cancelar de todos modos» sobre las advertencias, embebidas y persistentes (regla 56).

**Verificado en pantalla:** el texto con datos reales, el botón bloqueado hasta los 10 caracteres de
motivo, y **Escape no cierra** — que es lo que la ceremonia exige de una acción irreversible.

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

> 🔴 **AUDITADO CONTRA EL CÓDIGO EL 24-08-2026, y estaba muy atrasado.** Casi todo lo que 6.0 a 6.3
> listaban como pendiente **ya estaba construido** en el repo hermano: los tres temas con su
> histéresis, las cuatro señales de sonido y vibración, el push, la escala de texto, el acuse de
> escaneo, la hoja de consentimiento de tres pasos, la galería en el cierre de parada, y el retiro
> de la PWA. Un checklist que declara pendiente lo hecho **hace reconstruir cosas que ya existen**,
> que es peor que no tenerlo. Las casillas de abajo son el estado real, con la ruta que lo prueba.

> ⚠️ **Este bloque se ejecuta casi entero en el repo hermano `C:\Users\jorge\Desktop\rutax-conductor`**
> (Expo SDK 54 + expo-router, 12 pantallas, ~6.860 líneas). Los repos están separados **a
> propósito**: los ciclos de release son incompatibles y el acoplamiento real es por HTTP, no por
> código. Lo que sí vive en este repo es el retiro de la PWA y las rutas de API que la app consume.

## 6.0 · Lo primero, y no es negociable: los dos sistemas de color

- [x] **Unificar `rutax-conductor/src/theme.ts` con `rx-tokens.css`.** — **hecho.** `src/theme.ts`
      quedó como puente hacia `src/tema/paletas.ts`, que transcribe los tres temas; `radius` es 3 px
      en todos sus escalones y `shadow` devuelve objetos vacíos. Lo vigila
      `src/tema/adopcion.test.ts`, que falla si algún archivo vuelve a leer `colors` como constante,
      usa `shadow.sm`, deja un hex suelto o pinta su propia barra de estado.
      *Texto original, que ya no describe la realidad:* El repo Expo tiene su propio
      sistema, llamado *«Light Pro»*: `primary #1E3A5F`, `accent #2563EB`, `danger #DC2626`, más su
      escala de `spacing`, `radius`, `font` y **`shadow`**. **No comparte un solo valor** con el
      sistema nuevo (teal `#00B89A`, radio 3 px, **cero sombras**). `src/torre/estilos.ts` se apoya
      en él. Mientras esto no se resuelva, todo lo demás del bloque se construye sobre el ADN viejo.

## 6.1 · Los tres temas · NUEVO #22

- [x] **`sun`, `dark` y `night` son alcanzables.** — `src/tema/TemaProvider.tsx` + `app/(main)/preferencias.tsx`.
      *Nota vieja, ya falsa:* Los tres están **declarados y completos** en
      `src/app/rx-tokens.css` (`:240` y `:310`) y **no los escribe ni los ofrece nada**: son tokens
      muertos. `src/components/app-shell/theme-switcher.tsx` ofrece exactamente tres opciones —
      claro, oscuro, sistema — y ninguna es `sun` ni `night`.
- [x] **Orden de autoridad del tema** (regla 9) — `src/tema/resolucion.ts`, con pruebas.: preferencia manual > sensor de luz con histéresis >
      hora. **La preferencia manual caduca al fin del turno.**
- [x] **Histéresis** (regla 10) — `LUX_ENTRA_SOL=8000`, `LUX_SALE_SOL=3000`, `PERMANENCIA_MINIMA_MS=90_000`, con 22 pruebas.
      *Sigue abierto lo único que no se puede resolver en pantalla:*: entra a Sol sobre 8.000 lux, sale bajo 3.000, con **90 s mínimos de
      permanencia**. Eso resuelve el subterráneo a las 17:00: baja a *Día*, no a *Noche*.
      *Decisión abierta:* los umbrales se ajustan **en la calle, con un teléfono real, a las 16:00 y
      a las 21:30**. No se ajustan en pantalla.
- [x] **Los tres comparten disposición, glifos y posiciones** (regla 11) — solo cambian valores. Solo cambian los valores
      de color y el pico de luminancia.
- [x] **Bajo sol, los distintivos van en sólido pleno** — `Paleta.distintivoSolido`, que viaja con la paleta para que ninguna pantalla pueda olvidarlo., nunca en fondo teñido (regla 12).
- [x] **`night` tiene DOS niveles de texto, no tres** — el tercer gris no cumple AA sobre `#05080A`.
- [x] `selector de tema de tres estados` · nativo — en `preferencias.tsx`.

## 6.2 · Componentes

- [x] **`módulo de captura`** · **hecho** — la galería **ya está en el cierre de parada**
      (`agregarFotos('camara' | 'galeria')`), que era el hueco. Base: `src/components/camara.tsx` +
      `src/lib/fotos.ts`.
      *Descripción del hueco, para entender qué se cerró:*
      en el flujo de entrega (`manifiesto/[pedidoId]/index.tsx`) van 1 foto de prueba + hasta 4
      evidencias = **5**, con cámara propia y **sin ninguna entrada a la galería**; en la pantalla
      de evidencias aparte (`evidencia.tsx`) el máximo es **10** y ahí sí hay galería con selección
      múltiple. O sea: la galería existe, pero no al cerrar la parada. El módulo unifica las dos.
      Base a conservar: `rutax-conductor/src/components/camara.tsx` (API imperativa `useCamara()`
      para evitar el «Usar foto / Repetir» de iOS) y `src/lib/fotos.ts`.
- [x] **`verificación por escaneo`** · **hecho** — `src/components/retiro/` + `src/lib/retiro-conciliacion.ts`, con el panel de registro y los repetidos marcados. **La base existe y
      es buena**: `expo-camera` con `CameraView` + `onBarcodeScanned`, `barcodeTypes: ['qr']`, con
      cooldown antirráfaga en `src/lib/retiro.ts`. Falta la forma del sistema: escaneados /
      pendientes / te quedan, **registro de escaneo con repetido marcado**, y cierre con faltantes.
      *(El panel inferior de registro con log de repetidos ya está aprobado e integrado.)*
- [x] **`distintivo de acuse de escaneo`** · **hecho** — `src/components/retiro/piezas.tsx`.
- [x] **`progreso con pasos nombrados`** · **hecho el 24-08** — `src/components/progreso-pasos.tsx`.
      **Era el único de 6.2 que faltaba de verdad.** Adoptado en la puerta (B5b) y en los dos cierres
      de parada, donde había una rueda muda y «Registrando…».
      **Por qué importa, y no es estético:** son dos esperas distintas que se veían iguales. El GPS
      tardando veinte segundos entre edificios es normal; la red caída no lo es. Con una sola rueda
      el conductor no puede distinguirlas, y **el que cierra la app creyendo que se colgó pierde la
      evidencia que no alcanzó a subir**.
      A los 8 s aparece «está tardando más de lo normal» **debajo del paso, sin quitarlo** — el aviso
      dice que va lento, el paso sigue diciendo qué pasa, y eso es lo que sirve para decidir. El reloj
      se reinicia con cada paso, o el tercero nacería ya avisando.
- [x] **`bloque registrado sin confirmar`** · **hecho** — `src/components/guardado-sin-confirmar.tsx` sobre la cola offline. Regla 17: **no hay
      trabajo sin conexión**; hay reintento automático con aviso, y la advertencia de que cerrar la
      app pierde lo no confirmado. *(La cola offline del repo Expo —`src/lib/offline-queue.ts`,
      `offline-queue-retiro.ts` y `offline-queue-traspaso.ts`— existe; el diseño la reexpresa como
      reintento con aviso, no como trabajo sin conexión.)*
- [x] **`hoja de consentimiento`** · **hecho** — `app/(main)/punto-termino.tsx`, con revocación de un toque. Regla 64: es dato
      personal bajo la Ley 21.431 — consentimiento en tres pasos, versionado, revocable, **y nada se
      guarda antes del último paso**.
- [x] **`vocabulario de sonido y vibración`** · **hecho** — `src/senales.ts` + `src/senales-vocabulario.ts`, cuatro patrones.
      *Diagnóstico original:* **no existía ninguno**: cero
      `Vibration`, `Haptics`, `expo-av` o `expo-haptics` en el repo Expo; cero `navigator.vibrate` o
      `new Audio()` en este. Regla 14: **toda confirmación que el conductor no puede mirar tiene
      señal de oído y de mano, y la vibración sola tiene que bastar.** · NUEVO #24
- [x] **`notificación push`** · **hecho** — `src/lib/notificaciones.ts` + el registro de aparato.
      ⚠️ *Solo 1 de los 3 momentos tiene disparador real*: el traspaso lo abre el receptor y los
      retiros los abre el conductor, así que nadie le empuja trabajo.
      *Diagnóstico original:* **no existía ni en la app ni en el servidor**:
      sin `expo-notifications`, y `public/sw.js` son 41 líneas sin `push` ni `notificationclick`. ·
      NUEVO #25
- [x] **`solicitud de permiso con explicación previa`** · **hecho** — `src/components/permisos.tsx`.
      Regla 13: **un permiso se pide en el momento en que se usa**, con una frase de para qué, y
      nunca al abrir la app.
- [x] **`escala de texto de cuatro pasos`** · **hecho** — `src/tema/escala.ts` (100/115/130/150), con `tactil()` para que los objetivos crezcan con ella. · NUEVO #23
- [x] **`casilla táctil de 56 px`** · **hecho en los dos lados** — en la app, `TACTIL_MINIMO = 56` y
      `tactil()`; en la web, `src/components/ui/casilla-tactil.tsx`, adoptada en P2 · asignar.
      🐞 **El hueco no era el teléfono: era la tablet.** La pantalla tenía dos ramas —tabla en
      escritorio, tarjetas en móvil— y parecía cubierta. **Un iPad en horizontal mide 1024 px**, así
      que cae en la rama de escritorio: filas de 40 px y casillas de 16, hechas para un puntero. Y esa
      es la situación real — el coordinador reparte 30 paquetes **de pie, con una tablet**, mientras
      el camión descarga.
      **Se decide por el dedo, no por el ancho:** el tamaño lo manda `@media (pointer: coarse)`, que
      pregunta con qué se está apuntando. Un punto de corte por ancho se equivoca en los dos sentidos
      —el iPad de 1024 con dedo y el portátil de 1024 con trackpad—.
      El cuadro visible **no crece**; crece el área que responde, con un `::after` invisible. Agrandar
      el dibujo desalinearía la columna sin que el dedo acertara mejor.
      **Medido en el navegador:** `56 × 56` bajo dedo, y el área de ratón intacta en `-8/-12 px`.
- [x] **`selección táctil en tres niveles`** · **hecho** — la fila y «todos los de esta página» ya
      estaban; entra el **barrido vertical** (`src/lib/ui/barrido-seleccion.ts` + el gancho de
      `casilla-tactil.tsx`). Es lo que convierte treinta toques en un gesto, y treinta toques de pie
      en la bodega son parte de por qué la flota sale 16:40 en vez de 16:00.
      **Tres decisiones que lo hacen funcionar, y ninguna es obvia:**
      · ⚠️ **El barrido arranca en la casilla, no en la fila.** Arrastrar hacia abajo **ya significa
        desplazar la lista**; si empezara en cualquier parte de la fila, seleccionar y hacer scroll
        serían el mismo gesto y la lista quedaría intocable. `touch-action: none` va **solo** en la
        banda de la casilla.
      · **El sentido lo fija la primera fila y no alterna.** Alternar sería lo «obvio» y es lo
        equivocado: el dedo pasa dos veces solo cuando tiembla o corrige el rumbo, y el coordinador
        perdería pedidos sin darse cuenta. Volver a pasar por encima **no hace nada**.
      · ⚠️ **Se rellena el tramo, porque el dedo va más rápido que los eventos.** El navegador emite
        un `pointerenter` cada varios píxeles y **se salta filas enteras**: sin esto, un barrido
        rápido deja huecos y el coordinador asigna 24 creyendo que asignó 30.
      Trabaja sobre la API que ya existía (`onAlternarUno`), sin una segunda fuente de verdad de la
      selección. 10 pruebas de la lógica pura.
      **Verificado contra el componente real en el navegador:** salto de la fila 0 a la 4 → 5
      marcadas; volver por encima → sigue en 5; rozar con el dedo levantado → no marca.
- [x] **`hoja móvil`** (la ficha la llama **`hoja inferior`**) · **hecha en los dos lados** — en la
      app, `Sheet` de `src/components/ui.tsx`; en la web, `src/components/ui/hoja-inferior.tsx`,
      adoptada en el panel de selección de P2.
      Los tres rasgos que pide la ficha —**media · completa · con arrastre · con pie fijo**— y lo que
      gana cada uno:
      · **Media deja ver lo de atrás.** El panel existe para revisar qué se lleva seleccionado, y
        revisar es comparar: a pantalla completa hay que cerrarlo para mirar la bandeja y volver a
        abrirlo para seguir.
      · **El arrastre es la salida que el pulgar alcanza.** La «X» vive arriba a la derecha; en un
        teléfono grande sostenido con una mano, ese punto está fuera de alcance.
      · **El pie fijo evita el peor error de esta familia:** «Vaciar toda la selección» vivía al final
        del contenido, y con treinta pedidos agrupados por comuna quedaba debajo del pliegue.
      **Dos decisiones que no son obvias:**
      · ⚠️ **En escritorio vuelve a ser panel lateral, y el cambio va por CSS.** Una hoja que sube
        desde abajo en una pantalla de 27 pulgadas es un gesto de teléfono fuera de lugar. Medir el
        ancho en el cliente daría un primer render distinto al del servidor — aviso de hidratación y
        parpadeo en cada apertura.
      · **El arrastre solo vive en el asa.** Igual que el barrido: si empezara en cualquier parte,
        desplazar el contenido y mover la hoja serían el mismo gesto.
      🐞 **Y una trampa medida, no supuesta:** los `lg:` pelados **no le ganaban** a los
      `data-[side=bottom]:` de la base — un selector de atributo pesa más que una consulta de medios,
      que no suma especificidad ninguna. La mitad de las reglas no hacía nada y el panel quedaba a
      medio pegar. Se arregló igualando el selector.
      **Medido en el navegador, en las dos ramas:** teléfono `0,58` de alto con asa y el pie dentro
      de la ventana, y `0,92` al expandir; escritorio `448 × 900` pegado arriba a la derecha, con
      borde solo izquierdo y el asa oculta. 15 pruebas de la lógica de puntos y arrastre.

## 6.3 · Reglas del bloque que se verifican en pantalla

- [x] **Regla 15** — **ya se cumple, y el tablero se equivocaba al describir el código.**
      `crearTraspaso(conductorReceptorId, codigos)` **lo inicia el receptor**, así que las dos
      voluntades ya están: quien entrega escanea y quien recibe confirma.
      ⚠️ **NUEVO #26 se descartó con razón** *(no por falta de tiempo)*: el tablero dibuja una
      aceptación del receptor **encima** de un flujo que el receptor ya inició. Construirlo
      agregaría el paso unilateral que la regla 15 prohíbe.
- [x] **Regla 16** — se cumple. El punto de término del conductor **nunca llega a la pantalla del
      coordinador**; es condición de validez del consentimiento, no una cortesía
      (`docs/seguridad/punto-de-termino-conductor.md` §4).
- [x] **Regla 68** — hecha en `src/components/parada/cabecera.tsx`: cuando la fuente del pedido
      gobierna parte del ciclo, la interfaz **lo dice y cruza** en vez de ofrecer una acción que no manda. En Flex el registro es informativo y la
      prueba oficial la gobierna Mercado Envíos: hoy el mismo botón dispara lo mismo en los dos
      regímenes y la diferencia se comunica solo con texto.

## 6.5 · B5b · La entrada del conductor

Tablero traído el 24-08. Tres pantallas, seis estados, tres marcados NUEVO (#31, #32, #33) y cuatro
reglas nuevas (81 a 84).

- [x] **La puerta** — correo y **PIN de 6 dígitos**, con **teclado dibujado en pantalla**.
- [x] **El candado** — la app pide el PIN tras 3 minutos sin usarse, y **se verifica sin red**.
- [x] **La entrada** — «Hola, Carlos / Tienes 24 paradas hoy», 1,4 s, con el símbolo de la marca
      armándose solo: la barra de arriba entra desde la izquierda, la de abajo desde la derecha con
      140 ms de desfase, y se traslapan. El traslape es el cuadre.
      Con «reducir movimiento» dura **2,2 s en vez de 1,4**: el tiempo que el movimiento usaba para
      contar lo usa la permanencia. No se salta — su nombre y sus paradas son información.
- [x] **Recuperación por correo** — «Olvidé mi PIN» → código de 6 dígitos → PIN nuevo, sin salir de
      la app.
- [x] **Los estados** — credencial equivocada, código malo o vencido, correo no registrado, sin
      señal, suspendido, y el **progreso con pasos nombrados** («Mandando el código…»), con «está
      tardando más de lo normal» a los 8 s **sin quitar el paso**.
- [x] **El PIN se elige en la invitación** (repo web) — el conductor deja de inventar una contraseña
      de 8 caracteres **que después no usaba nunca**. La barrera está en la Server Action, que lee el
      rol **de la invitación** y no del formulario.
- [x] **NUEVO #33** — la ayuda de campo del alta del conductor. Ahí nacía el error más probable del
      día uno: se pedía un correo sin decir para qué servía.
- [x] **NUEVO #32** — la sesión no vence por tiempo. Vence cuando el courier suspende al conductor,
      cuando él sale, o **cuando entra en otro teléfono** (decisión del usuario: un aparato a la vez;
      un teléfono perdido con la app abierta muestra direcciones de clientes).

### ⚠️ Dónde esto se aparta del tablero, y por qué

- **Regla 81 rota a propósito** *(decisión del usuario, 24-08-2026)*. El tablero dice «en la app del
  conductor no hay contraseñas: Google, o correo con código de un solo uso». Se cambia por un **PIN
  permanente** porque el código por correo depende de que el correo llegue, de que haya señal para
  recibirlo, y de un límite de envíos que a las 16:00 con ocho conductores entrando es un cuello
  real — y sobre todo porque **un PIN se puede verificar sin red**, que es lo que permite que la app
  se cierre sola sin dejar a nadie fuera de su ruta.
  El código por correo **no se tira**: queda como la única vía de recuperación.
- **NUEVO #31 (Google) no se construyó** *(decisión del usuario)*. Exige un proyecto en Google Cloud
  y el proveedor activado en Supabase, y **no se puede probar en Expo Go**: solo en un build de EAS.
  Entra después como un botón más arriba del correo, sin rediseñar la pantalla. Con él llegan dos
  piezas del tablero que hoy no tienen dónde ir: el estado «ese correo de Google no está registrado»
  (regla 83, muestra con qué cuenta entró y fuerza el selector) y el separador «o».
- **Sin bloqueo por intentos fallidos** *(decisión del usuario)*. Quien tenga el teléfono
  desbloqueado puede probar PIN tras PIN sin penalización. Queda escrito en el código, no escondido.

### Lo verificado contra el servidor, no leído en el código

```
PIN equivocado           → "Invalid login credentials"
correo inexistente       → "Invalid login credentials"   ← el MISMO (regla 45)
PIN bueno                → sesión: conductor · activo · tenant · "Carlos Vera"
olvidé mi PIN → código   → PIN nuevo → entra · el viejo deja de servir
código: pedir otro       → mata el anterior · un solo uso · 10 minutos
```

Y en el navegador, la invitación del conductor: el campo filtra a dígitos y corta en 6, `123456` se
rechaza con «Números seguidos es de los primeros que alguien probaría. Mézclalos», y `482619` crea la
cuenta con `tipo_usuario: conductor`.

⚠️ **Las dos pantallas de la app NO se han visto.** El bundle web de Expo no compila —
`react-native-maps` importa internos que no existen en navegador y expo-router empaqueta todas las
rutas para armar su árbol, así que una pantalla nativa tumba las veinte. Se intentaron dos rodeos y
se revirtieron. Hace falta Expo Go en un teléfono.

### El cabo suelto que este cambio abre

- [ ] **Dos listas de reglas de PIN, en dos repos, sin nada que las ate.**
      `src/modules/identidad/pin-conductor.ts` (web, la que manda) y
      `rutax-conductor/src/lib/pin-conductor.ts` (app, para el PIN nuevo tras olvidarlo). Las pruebas
      de los dos lados fijan los mismos casos exactos a propósito, pero **nada falla si alguien
      relaja una y no la otra**. Es el mismo patrón que ya mordió con el tope de cuentas de Mercado
      Libre.

## 6.4 · Retiro de la PWA `/conductor` de este repo · **HECHO**

De las cinco pantallas queda **un cartel** (`src/app/conductor/page.tsx`, 89 líneas) que dice «tu
trabajo está en la app». Existe para que un conductor que entre a la web no caiga en un 404 ni en un
bucle: `/` y el layout de `(tenant)` lo mandan ahí.

🐞 **Ese cartel afirmaba dos cosas que hoy son falsas**, y se corrigieron el 24-08: decía que
«mis liquidaciones» y «punto de término» **no existían todavía** en la app nativa. Existen las dos
—`app/(main)/liquidaciones/` y `app/(main)/punto-termino.tsx`, esta última con borrado— así que la
nota mandaba a buscar un hueco que ya estaba tapado.

Se conserva el botón de borrar el punto de término, que ahora es un **segundo camino** y no el único:
quitar una vía de revocación de un dato personal por ahorrar cien líneas se decide con
`docs/seguridad/punto-de-termino-conductor.md` delante, no se hace de paso.

*El inventario original la marcaba así:*

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

- [x] **NUEVO #31** · Entrar sin contraseña — **hecho, pero por otro camino**: PIN de 6 dígitos en
      vez de Google + código de un solo uso. Google queda pendiente (ver 6.5).
- [x] **NUEVO #32** · La sesión no vence por tiempo, y se cierra en los demás aparatos al entrar.
- [x] **NUEVO #33** · La ayuda de campo del alta del conductor.
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

- [x] **`tema de mapa` claro y oscuro** · DE CERO — **hecho el 23-08.** `paleta.ts` pintaba con el
      ADN retirado (navy `#2a3ca0`, periwinkle `#7080f5`, tierra `#f1f2f8` / `#131417`, rojo
      `#fb3748`) mientras **los 24 tokens `--rx-map-*` no tenían un solo consumidor en todo el
      repo**: estaban escritos y eran inalcanzables. El mapa era la superficie más visible del
      producto que seguía viéndose como el sistema anterior — y no por descuido: **MapLibre no lee
      CSS**, así que el puente de tokens no lo alcanza y los valores hay que transcribirlos.
      Cada línea del archivo lleva ahora anotado su token de origen.
      Tres decisiones que no salen de la tabla:
      · **La rampa de carga va SÓLIDA**, no con alfa embebido. El sistema la declara opaca porque
        a zoom de comuna **el polígono es el contenido** y el plano es escenario (§13.1 y §13.3).
      · **Tres escalones de vía, no cuatro.** El sistema declara `road-minor`, `road-major` y
        `highway`; la vía local comparte color con la secundaria y se separa por **ancho**, que es
        lo que `estilo.ts` ya hace. Inventar un cuarto color sería agregar un token que nadie
        definió.
      · **El punto entregado NO toma su tono de ciclo** (`balanced`) — ver anexo E.
      Las 29 pruebas de `estilo.test.ts` siguen verdes, y son las que validan la elección: el
      anillo ámbar mantiene su 3:1 sobre la tierra nueva, los cuatro pasos de la rampa se
      distinguen (ΔE > 6, y > 3 atenuados al 45 %), y **el rojo lo usa una sola capa**.
      🐞 De paso, su aplanador de color asumía siempre hex de 8 dígitos y con los sólidos devolvía
      `NaN` **en silencio**: la prueba fallaba con «expected NaN», que no dice nada de lo que se
      rompió.
      **Verificado en pantalla, claro y oscuro**, con el basemap y los glifos publicados al bucket
      local. Los temas `sun` y `night` no declaran mapa: la Torre es del coordinador.
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
- [x] **`marcador de conductor`** · DE CERO — **construido, y sin fuente que lo alimente.**
      `src/app/(tenant)/torre-de-control/_componentes/marcadores-conductor.tsx`: cuadrado de 12 px
      rotado 45° con la inicial, en HTML y no en una capa de MapLibre porque el estilo **no tiene
      sprite** —no hay un solo icono en el mapa— y un cuadrado rotado a tamaño fijo no se dibuja sin
      uno. Es **la única cosa del mapa que no es un círculo**: la forma lo distingue, no el color.
      El contrato gana `posicion: Coordenada | null` y la agregación sabe recibirla.
      🔒 **Y no se le conectó ninguna lectura, por una razón que apareció construyendo:** el rastreo
      en vivo del conductor **se apagó el 2026-08-14** tras una revisión de privacidad que lo marcó
      de **severidad ALTA** —alimentaba `operacion.ubicacion_conductor` cada 90 s sin que ninguna
      pantalla la leyera, sin purga y sin límite de tiempo, y esa última posición «muchas veces era
      el domicilio del conductor»—. La tabla existe con **cero filas**.
      La primera versión de este marcador **la leía, y el candado la atajó**:
      `ubicacion-conductor-retirado.test.ts` analiza todo `src/` y falla si algún archivo llama a
      `.from("ubicacion_conductor")`, para leerla o para escribirla. Su comentario dice que existe
      exactamente para esto: «quien la toque tendrá que leer este comentario primero».
      *Decisión del usuario, 23-08:* se retira la lectura y se conserva la pieza. La fuente legítima
      llega con la **etapa 7**, que crea `operacion.punto_termino_conductor` — **otra tabla**, con
      su propia finalidad y su propio consentimiento (`docs/seguridad/punto-de-termino-conductor.md`).
      Ahí se enchufa `posicion` y el marcador empieza a dibujar sin tocarse.
- [x] **`mapa degradado`** · DE CERO — **hecho** *(NUEVO #3, aprobado por el usuario el 23-08)*.
      El modo sin plano urbano ya era deliberado en el código; lo que faltaba era **decirlo**. Se
      anunciaba con un sufijo de once píxeles pegado a la atribución, abajo a la derecha, donde
      nadie mira: quien abría la Torre así no tenía forma de saber si el mapa estaba roto.
      Ahora es una franja al tope del mapa: «El plano urbano no cargó. Las comunas, los puntos y las
      cifras son reales; lo que falta es el mapa de calles de fondo.»
      Va en `attention` y **no** en `fault` porque nada se rompió y el dato operativo —que es lo que
      la pantalla existe para contar— está completo. **Verificado en pantalla** apagando el basemap:
      fondo `#33260A` y texto `#FFC53D`, los valores exactos de los tokens.
- [~] **Los tres niveles de zoom semántico** — el rótulo, corregido el 24-08.
      🐞 **En el nivel 2 el distintivo contaba PUNTOS y no grupos**, que es lo que está dibujado:
      decía «Nivel 2 · Agrupaciones · 112 en la comuna» mirando 34 burbujas. La cifra no
      correspondía a ningún objeto de la pantalla. Ahora cuenta con `celdaDe` —la misma función que
      arma las burbujas— y con el mismo filtro de pendiente, para que la cifra y la cantidad de
      burbujas no puedan separarse el día que alguien cambie el tamaño de celda.
      ⚠️ **No se pudo ver en pantalla en los niveles 2 y 3**: la base local no tiene pedidos con
      compromiso para hoy y `seed-torre-hoy.sql` falla contra este entorno (referencia un tenant que
      no existe acá). El nivel 1 sí se verificó.
      Quedan **el cruce de 200 ms al abrir un racimo** y **el control de zoom marcando el tramo**.
- [ ] **Encender las etiquetas del basemap.** La v2 las enciende (calle y comuna) porque la Torre
      muestra el código de envío y **no** la dirección, así que el nombre de calle del plano es lo
      único que ubica el punto. Requiere glifos: **4 archivos PBF (~410 KB)** de Noto Sans Regular y
      Medium del build público de Protomaps — no hay pipeline que construir. Falta publicarlos al
      bucket y poner `NEXT_PUBLIC_MAPA_GLIFOS_URL`. Sin ellos, `estilo.ts:508` degrada a un anillo
      en vez del `+N`.
- [x] **Las tramas de riesgo de 45° — verificado el 24-08: no existen.** Sin puntaje no hay escala
      que pintar, y el mapa nunca llegó a dibujarlas: no hay un solo `fill-pattern` ni sprite en
      `estilo.ts`. El ítem se cierra por ausencia comprobada, no por trabajo hecho.

> ⚠️ `maplibre-gl` está clavado en **`5.24.0` exacto — no subir a 6.x**: la 6.0.0 carga su Web
> Worker como archivo suelto y Turbopack no lo resuelve dentro de `node_modules`. Falla mudo:
> `getStyle()` devuelve `null` y el lienzo queda en blanco, sin un solo error en consola.

## 7.2 · Visualización de datos · 4 componentes

**Estado de partida: los gráficos existen solo en el escaparate.** `src/components/ui/chart.tsx`
define `GraficoLinea` y `GraficoDona`, y **el único archivo que los importa es `/kitchen-sink`**.
Ninguna pantalla de producto dibuja un gráfico: ni el dashboard, ni `admin/metricas` (que usa el
ícono `BarChart3` y no dibuja nada), ni dinero. Lo más cercano en producción es una barra de
distribución con clases Tailwind (`dashboard/page.tsx:96`).

- [x] **`gráfico de barras`** · **construido** — no existía. Horizontal por defecto, porque las
      categorías de este producto son **nombres** («Puente Alto», «Comercializadora Los Almendros
      SpA») y en vertical se cortan o se giran 45°, que es la forma más rápida de volver ilegible un
      gráfico. Radio 0: una barra es una magnitud medida desde el cero y una punta redondeada le
      quita exactitud justo donde se lee el valor. La rejilla va **solo en el eje de la magnitud** —
      en el de categorías no mide nada, y una línea entre dos nombres sugiere una escala que no
      existe.
      *Por qué barras y no líneas:* la línea afirma continuidad, dice que entre dos puntos hubo un
      camino. Entre dos comunas no hay camino.
- [x] **`paleta categórica de 5 series`** · EXTENDER — **el puente ya mapeaba `--chart-N` a
      `--rx-chart-N`, así que los colores eran los nuevos y nadie lo había notado.** Lo que estaba
      mal era lo de arriba:
      🐞 `ORDEN_CHART` **reordenaba** las series —1, 3, 5, 2, 4— con sus colores anotados como
      «azul · morado · verde · cian · amarillo». Los dos datos quedaron falsos al redefinirse la
      paleta: hoy la serie 1 es teal y no hay ni morado ni amarillo. Un comentario que miente sobre
      un color es peor que ninguno.
      Y la reordenación tampoco correspondía: la justificaba la paleta anterior, que el validador
      reprobó como set categórico. La nueva se eligió ya resuelta —**ninguna serie usa el matiz del
      rojo ni del ámbar**— y su regla es explícita, «la serie 1 es siempre la serie 1».
      La rejilla y el eje pasan a `--rx-chart-grid` y `--rx-chart-axis`, que antes eran `--border` y
      el gris del texto: la rejilla es más tenue a propósito, porque una que compite con la serie
      deja de ser referencia y pasa a ser ruido.
      **Verificado en pantalla**: serie 1 `#00D6B4`, serie 2 `#43C9FF`, los valores exactos.
- [x] **`semáforo de cumplimiento`** · DE CERO — `src/components/ui/semaforo-cumplimiento.tsx`,
      montado en el widget de SLA del dashboard.
      🐞 **«Sin datos» se pintaba de ámbar.** `semaforoSla` lo devolvía como `amarillo`, así que un
      seller que empezó ayer aparecía en advertencia por no tener mediciones todavía. No tener
      número no es un problema: es el estado normal de algo que aún no ocurre. Ahora es `neutral` —
      el mismo criterio que `CORRECCIONES_TONO` aplica en el resto del producto.
      🐞 **Y el objetivo no aparecía en ninguna parte.** «94 %» a secas **no se puede leer**: contra
      90 es holgado y contra 97 es incumplimiento. Ahora van los dos números juntos, con el
      veredicto en un distintivo que lleva glifo además de color — importa el doble acá, porque un
      semáforo es el patrón que más se apoya en el color.
      La barra opcional lleva la marca del objetivo **encima**, en `--rx-chart-target`: sin ella una
      barra al 94 % se lee como «casi lleno», que es la lectura contraria a la correcta.
      La fila del dashboard pierde además su punto de color suelto —repetía lo que el badge ya
      decía— y su `shadow-xs`.
- [x] **`gráfico de líneas`** · RE-ESTILO — hereda la paleta, la rejilla y el eje corregidos.
      ⚠️ **Los tres gráficos siguen viviendo solo en `/kitchen-sink`**, y eso no se cerró acá: dónde
      va cada uno lo fijan `B1c`, `B2b` y `B6`, que no se han traído. Inventar una ubicación sin el
      tablero es adivinar. El semáforo sí bajó a una pantalla real.

## 7.3 · Impresos · 2 componentes

**Librería única: `@react-pdf/renderer` 4.5.1, generación directa (componentes React →
`renderToBuffer`). Cero HTML→PDF, cero Puppeteer.** Los tres documentos usan
`StyleSheet.create` con `fontFamily: "Helvetica"` y hex sueltos: **no consumen un solo token**, y
los `--rx-thermal-*` y el bloque `@media print` de `rx-tokens.css` no tienen consumidor.

- [x] **`etiqueta térmica` 10×15** · DE CERO — **hecha.** Los tokens
      `[data-rx-media="thermal"]` no tenían un solo consumidor; ahora se transcriben con su nombre
      anotado al lado (`@react-pdf` tampoco lee CSS).
      Las cuatro reglas duras y qué rompía cada una:
      · **Cero grises** — había `#6b7280` en los rótulos y `#9ca3af` en el pie. Una térmica no tiene
        grises: los simula con una trama de puntos que a cuerpo 7 se vuelve una mancha.
      · **Ningún texto bajo 15** — los rótulos de campo estaban en **7**, y el pie también. Eso no se
        lee desde una camioneta, que es donde se lee una etiqueta.
      · **Cero tramas de fondo** — el encabezado era un rectángulo `#111827` **sólido** con texto
        blanco. En térmica el fondo lleno gasta cabezal, se corre con el calor y el texto invertido
        es lo primero que se pierde. Ahora la separación es una regla de 3 px.
      · **Reglas de 2 y 3, nunca de medio punto** — había bordes de `0.5`, que la impresora redondea
        a cero o a uno según la fila.
      **La comuna pasa al frente y más grande que el nombre** (24 contra 17): antes iba dentro de la
      dirección, en cuerpo 10, **después** del nombre — quien clasifica en el piso de la bodega
      tenía que leer una línea entera para saber a qué montón va el bulto.
      **El código aparece dos veces**: partido y en cuerpo 40 para leerlo de lejos, y corrido sin
      guiones para digitarlo. Un solo formato obliga a elegir entre dos lecturas que ocurren ambas
      todos los días. Y el QR baja de 140 a 100 con su **zona de silencio** de 4 px, sin la cual el
      lector engancha el texto vecino como parte del símbolo.
      🔒 **Las instrucciones de entrega se retiran del papel** *(decisión del usuario, 23-08)*. La
      etiqueta viaja pegada al bulto: «timbre 3B» o «dejar en conserjería» los lee el conserje, el
      vecino del pasillo y cualquiera que pase. La instrucción no se pierde — el conductor la ve en
      la app, que es donde solo la ve él.
      **7 pruebas mecánicas** sobre el objeto de estilo (a un PDF binario no se le puede preguntar
      si un color es gris), verificadas por mutación.
      ⚠️ Aplica a **same-day y Shopify**: en Flex la etiqueta la genera Mercado Envíos.
- [ ] **`documento PDF carta`** · DE CERO · 3 piezas:
      - [x] **Liquidación del conductor** — **hecha.** La lee alguien que **desconfía por defecto**
            de un descuento que no entiende, así que su legibilidad es el problema de diseño.
            🐞 **Tenía TRES grises de texto** —`#374151`, `#6b7280`, `#9ca3af`— y el más claro iba
            en el pie, justo donde están el folio y la fecha: **2,5:1 sobre blanco**, o sea se
            pierde en una impresora con poco tóner, que es la que hay. El sistema define **uno**,
            `#3E4D53`, medido en 7,4:1.
            Las reglas pasan de `0.5` —que muchas impresoras redondean a cero— a 2 y 3, y el gris de
            fondo deja de decorar la cabecera para quedar reservado al total, que es lo único que lo
            necesita. Fuera los `borderRadius`: en papel no aportan nada.
      - [x] **Factura al seller — resuelto el 24-08, y no como PDF.**
            *Decisión del usuario:* la factura oficial **sigue siendo la del proveedor DTE** —es el
            documento válido ante el SII y Rutax no compite con él ni lo re-genera— y se agrega
            **un detalle de entregas descargable**, que es lo que el seller reclama cuando el total
            no le calza: `GET /portal/cobros/[periodoId]/detalle`, en CSV.
            Es la misma respuesta que el backoffice le da a Administración con
            `/dinero/periodos/[id]/exportar`, del otro lado del mostrador.
            Las columnas están escritas **para el seller**: código de envío, destinatario, comuna —
            no `pedido_id`, que es un UUID que no le dice nada. El total va como última fila, porque
            abre esto para cuadrar contra un número. **Todas las cifras son neto**: el IVA lo declara
            el documento tributario, y calcularlo en dos lugares es cómo terminan discrepando.
            ⚠️ La barrera que importa es la segunda: `obtenerPeriodoCobro` filtra por tenant y **no
            por seller**, así que la ruta comprueba `periodo.sellerId` — sin eso, un seller con el id
            de otro se descarga sus entregas. **Verificado en el navegador**: el propio da 200 y el
            ajeno 404 (no 403, que permitiría enumerar ids).
      - [x] **Manifiesto impreso** — *decisión del usuario (24-08): no se construye.* El conductor
            que se queda sin batería llama al coordinador, como hoy. Queda como deuda escrita.
      - [x] Comprobante de pago de suscripción — **hecho**, mismo criterio: un solo gris, reglas de
            2, y el aviso legal pasa del beige propio `#fef9e7`/`#78350f` al ámbar del sistema con
            su barra lateral de 3 px.
- [ ] **La marca «REIMPRESA» con fecha y hora** en la etiqueta reimpresa · NUEVO #27.
      *Decisión del usuario (23-08): queda para la tanda de los 30 NUEVO, no se construye ahora.*
- [ ] **Regla 55** — el error de generación **distingue el archivo del hecho**: «el PDF falló, la
      factura está emitida y su folio es el 1041».

## 7.4 · Correos · 1 componente, 11 piezas

- [x] **`plantilla de correo`** · DE CERO — `src/lib/email/plantilla-email.ts`, y **los once
      correos pasan por ella**. El documento dice 16; en código hay 11.
      **Lo que estaba roto no era el estilo.** Cada constructor entregaba una cadena de `<p>`
      sueltos directo al proveedor: **sin `<!doctype>`, sin `<head>`, sin tabla contenedora y sin
      ancho declarado**. Un fragmento así lo renderiza cada cliente como quiere — Outlook lo estira
      al ancho de la ventana, con líneas de 200 caracteres — y sin `<head>` no hay dónde declarar el
      juego de caracteres, así que un «Ñuñoa» o un «$ 864.100» pueden llegar con caracteres rotos.
      Las decisiones que no son obvias, todas de §9.1:
      · **Tablas, no `div`.** Outlook usa el motor de Word: no implementa `max-width` ni `flex`. La
        única caja que respeta es una `<table>` con `width` en **atributo**.
      · **Blanco puro y negro de marca, nunca casi-blanco ni casi-negro.** Los clientes invierten
        por su cuenta en modo oscuro y no se puede impedir; `#F1F6F6` invertido queda gris sucio.
      · **El botón declara su fondo dos veces** —`bgcolor` y `style`— por lo mismo, y es una celda
        de tabla con `padding`, no un `<a>` con `display:inline-block`, que Outlook ignora dejando
        un enlace sin caja. Era justo lo que hacían los dos botones que existían.
      · **El enlace de respaldo va siempre**, aunque haya botón: es lo único que queda al degradar.
      · **Ningún correo depende de una imagen** (regla 61): la marca es texto.
      🐞 **Y un agujero que abrí yo y atajó una prueba que ya existía.** La primera versión insertaba
      `marca` y `titular` crudos, y `notificaciones-invitacion.test.ts` —«escapa el nombre del
      courier»— lo detectó. Ahora **escapa la plantilla, no el llamador**: todo campo es texto plano
      menos `cuerpoHtml`, que es el único declarado como HTML. Un llamador nuevo se olvida y nadie
      lo nota.
      14 pruebas sobre lo que de verdad rompe un correo. Se escribieron en tres módulos con tres
      criterios distintos y **nadie los ha revisado nunca como conjunto**.
      El navy viejo (`#1e3a5f`, `#1E3A5F`) se fue de los dos sitios donde estaba.
      **Los 7 de `plataforma/notificaciones.ts`** —los que el propio código rotulaba como
      *«placeholders funcionales (revisar con copywriter)»*— cambian tres cosas, de §9.1:
      · **El asunto lleva el hecho y su número, y NO el nombre del producto.** Los siete terminaban
        en «— Rutax», que es exactamente lo que el remitente ya dice: seis caracteres gastados de
        los ~45 que se ven en el teléfono. Y los de dinero **llevan el monto**, que es lo que decide
        si se abre ahora o después: «Pago recibido · $49.000», «No pudimos cobrar $49.000».
      · **La plata va en el bloque de datos**, en mono, no enterrada en un párrafo.
      · **Un botón**, que no tenían: mandaban al lector a navegar a mano hasta «Configuración > Plan
        y facturación». Si no hay dominio configurado no se inventa uno — sale sin botón y el pie
        dice dónde mirar.
      Se fue también el «Hola X … Saludos, Rutax»: el titular dice el hecho, y saludar por nombre en
      un correo de sistema no aporta.
      ⚠️ El cuerpo de `construirEmailComunicacion` **lo escribe un super-admin** y entra como HTML,
      así que se escapa en el llamador: es el único correo cuyo contenido no está en el código.
      **Verificado en el navegador** con la invitación del seller renderizada de verdad.

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

- [x] **Los correos de dinero — 5 de los 10, construidos y enchufados el 24-08.**
      *Decisión del usuario: los que cierran un hecho de dinero.* El criterio es que alguien esté
      esperando ese hecho, o que algo se rompa si nadie actúa.

      | Correo | Se dispara en | Va a | Por qué |
      |---|---|---|---|
      | `facturaEmitida` | `emitir-dte-periodo` | el seller | llamaba a preguntar por su factura |
      | `liqPagada` | `aplicar-actualizacion-payout` | el conductor | preguntaba por WhatsApp si le llegó |
      | `pagoRechazado` | idem | **el courier** | el conductor quedaba sin pagar y nadie lo sabía |
      | `foliosPorAgotarse` | `alerta-folios-proximos` | el courier | **deja de poder facturar** |
      | `certificadoPorVencer` | job **nuevo** | el courier | **deja de poder facturar** |

      Tres decisiones que no salen de la tabla:
      · **El rechazo va al COURIER, no al conductor.** Es quien puede arreglarlo —los datos
        bancarios están en la ficha— y avisarle a alguien de un problema que no puede resolver lo
        deja llamando sin nada que hacer. El correo lo dice: «él no recibió este aviso».
      · **La factura es el único correo del producto que nombra el IVA**, y no por excepción: la
        regla 22 dice que Rutax no muestra impuestos **en sus pantallas**; esto es el aviso de un
        documento del SII, y esconderlo haría que el total del correo no cuadrara con el papel.
      · **El aviso de certificado va a 30, 7 y 1 día, y solo esos días.** Un `<=` mandaría treinta
        correos seguidos, y treinta correos enseñan a archivar sin leer — que es justo lo que no
        puede pasar con el último. Renovar es un trámite con proveedor acreditado: un solo aviso a
        7 días llega tarde.
      🐞 **Y un bug que casi entra:** el correo del conductor se leía desde
      `identidad.conductores.usuario_id`, **una columna que no existe** — el vínculo va al revés
      (`usuarios_perfil.driver_id`), porque un conductor de la nómina puede no tener cuenta todavía.
      Habría devuelto `undefined` en silencio y ningún conductor habría recibido nunca su aviso.
      🐞 `diasHasta` lleva las dos fechas a **mediodía UTC** antes de restar: desde medianoche, 30
      días que cruzan el cambio de horario dan 29,96 y `Math.floor` devolvería 29 — el aviso del
      hito 30 no saldría nunca.
      **24 + 10 pruebas.** Los otros cinco —período cerrado, liquidación emitida, morosidad,
      excedente, seguimiento— avisan de algo que el portal ya muestra y que nadie está esperando en
      ese instante. **Quedan como decisión, no como olvido.**
- [ ] **Los 6 cuerpos que ya existen, reescritos al molde** (`…-MENSAJES.md` §9.3). Quedaron con
      asunto, acción y la regla que los cambia; los cuerpos completos están **pendientes de escribir**.
- [ ] **Los rebotes son invisibles.** Vuelven por `webhook-resend.ts` y no se muestran en ninguna
      parte. Una invitación que rebota es una invitación que nadie sabe que nunca llegó.
- [x] **El correo de conexión caída, que llevaba un año comentado** — hecho el 24-08.
      El job registraba la caída en bitácora, la escribía en el log y **ahí se quedaba**: el envío
      estaba comentado apuntando a una `plantillaConexionCaida` que nunca existió. Una conexión de
      ML se caía, los pedidos de ese seller dejaban de entrar, y nadie se enteraba hasta que alguien
      abría el panel.
      **Va al courier y no al seller**: el seller lo ve en su portal y puede reconectar, pero quien
      pierde plata mientras tanto es el courier — son entregas que no va a hacer.
      Dice **la consecuencia antes que el hecho** («dejaron de entrar los pedidos de X», no
      «conexión desvinculada») y **no promete un diagnóstico que el sistema no tiene**: token
      vencido, revocado y fallo de descifrado terminan los tres igual y no se distinguen desde acá.
      ⚠️ La deduplicación es por HECHO, no por envío: si el correo falla, la bitácora ya marcó el día
      como avisado y no se reintenta. Es el precio de no mandar el mismo aviso cinco veces con un
      proveedor intermitente.

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

- [x] **`pantalla sin sesión`** · DE CERO — `src/components/ui/pantalla-sin-sesion.tsx`, con sus
      tres casos de marca. **Las trece existían y cada una armaba su propio marco**: unas con
      `min-h-svh`, otras con `flex-1`, unas centradas y otras no, **ninguna con marca**. Trece
      marcos que se parecen no son un marco: son trece sitios donde arreglar lo mismo, y el que se
      queda atrás es el que ve alguien que no tiene cuenta.
      **Regla 42 — la marca la pone el dueño de la relación, no el del software.** El caso que
      importa es el tercero: `/login` es **neutra** porque por esa misma puerta entran el dueño del
      courier, el seller y el conductor, y no hay forma de saber cuál antes de que escriba su
      correo. Poner una marca ahí es afirmar una relación que todavía no existe.
      **Regla 43:** acepta un **nombre**, no una imagen — el texto es la versión canónica y el logo
      una mejora opcional.
      **Regla 44:** no se fuerza tema. El `ThemeProvider` ya corre con `defaultTheme="system"`, así
      que quien llega sin preferencia hereda la del sistema operativo; el componente **no** impone
      uno, que sería la forma de romperlo.
      Adoptado en `/login`, `/registro` y `/recuperar-contrasena`. Las otras diez van cuando se
      toque cada una: adoptarlas todas de golpe es un cambio que nadie puede revisar.
- [x] **`tarjeta de enlace compartido` 1200×630** · DE CERO — **hecha** para `/tracking/[token]`,
      que es donde importa: es el único canal de Rutax hacia consumidores finales.
      Al pegar el enlace en WhatsApp, el comprador veía **«Rutax — gestión operativo-financiera ·
      Plataforma para couriers de última milla»**: el título del layout raíz, copy escrito para el
      courier que contrata el software, mostrado a alguien que solo quiere saber dónde está su
      paquete y que no sabe qué es un courier de última milla.
      *El blocker del raster se resolvió sin comprar nada:* se genera con `ImageResponse` de
      `next/og` en la petición, así que **no hay archivo que versionar** ni que mantener
      sincronizado con los tokens. Todo tipografía sobre color plano — rinde en un teléfono con
      mala señal, que es donde se abre.
      ⚠️ **Regla 47, y las dos razones son duras:** WhatsApp **cachea** la previsualización, así que
      una tarjeta que dice «en ruta» sobre un pedido ya entregado no es información vieja, es
      **falsa**, y es lo primero que se ve. Y la previsualización **se ve sin abrir el enlace**:
      cualquiera con acceso a ese chat vería el estado sin entrar, que es justo lo que el token
      protege. Tampoco lleva nombre, comuna ni monto (regla 66).
      La página gana además `robots: noindex`: una URL con token no tiene por qué terminar en un
      buscador. **Verificado en el navegador**, renderizada a 1200×630.
      *(El «powered by» del seguimiento está diseñado como pieza: es el único canal de Rutax hacia
      consumidores finales y genera una impresión por entrega.)*
- [x] **`línea de tiempo pública`** · `/tracking/[token]` — **el tono ahora sale del sistema.**
      🐞 **Regla 46 rota, y de la forma que más confunde:** la traducción existía —otra redacción,
      otros iconos— pero el tono salía de una clase escrita a mano (`text-info`, `text-success`,
      `text-warning`, `text-muted-foreground`) que **no coincidía con ninguno de los seis del
      sistema**. El comprador y el coordinador miraban el mismo pedido y lo veían de colores
      distintos, que es exactamente lo que la regla viene a impedir: es una traducción, no un
      producto aparte.
      Ahora cada estado toma el tono real —`en_ruta` → `progress`, `entregado` → `balanced`,
      `fallido` → `attention`, y **`cancelado` → `inert`**, con su trama de 135°, igual que en el
      panel del courier. Fuera la sombra (regla 4).
      **Verificado en pantalla** con un pedido entregado: `data-tono="balanced"`, cero sombras.
      ⚠️ *Queda una tensión anotada, no resuelta:* la pantalla muestra el **nombre del seller** como
      marca, y la regla 66 lo lista entre lo que no se le muestra al comprador. Pero la regla 42
      dice que la marca la pone el dueño de la relación, y para el comprador esa es la tienda donde
      compró. No lo resolví por mi cuenta: es una decisión de producto.

## Pantallas sin sesión · 13

- [x] `/login` — **brecha #7 cerrada.** Mostraba **una sola frase para todo**: «Email o contraseña
      incorrectos». Daba igual que la cuenta estuviera suspendida, sin activar, bloqueada por
      intentos o que el servicio no respondiera.
      El daño no es de tono, es que **manda a la persona a arreglar lo único que no está mal**:
      · a quien tiene la cuenta **suspendida** se le dice que revise cómo escribe, para siempre —
        probará diez claves, usará «olvidé mi contraseña», la cambiará, y seguirá sin entrar;
      · a quien está **bloqueado por intentos** se le invita a intentar de nuevo, que es
        exactamente lo que alarga el bloqueo;
      · y si el **servicio está caído**, se le dice a alguien con la clave correcta que la tiene
        mal. Mucha gente la cambia. Ahora sí la tiene mal.
      ⚠️ **Distinguir causas sin volverse un oráculo (regla 45):** la credencial equivocada
      conserva **un solo mensaje**, idéntico exista o no el correo — probando correos no se
      averigua cuáles están registrados. Solo se distinguen estados que **ya exigieron la
      credencial correcta** (cuenta sin activar, suspendida) o que no hablan de la cuenta (429,
      5xx, sin red).
      🐞 **Y un caso que no se manejaba:** el cliente **lanza** cuando la petición no llega. La
      excepción subía sin capturar y el formulario quedaba en «Ingresando…» para siempre, sin decir
      nada. Ahora se atrapa y dice que no es la contraseña.
      El botón **se apaga** cuando reintentar no ayuda: dejarlo activo invita a lo que empeora la
      situación. 8 pruebas. **Verificado en pantalla** el caso de credencial.
      *Sigue pendiente:* **NUEVO #29** (semáforo del sistema) y **NUEVO #30** («lo último que
      cambió»), los dos bloqueados con el resto de los 30.
- [x] **`/portal/login` — resuelto por decisión, no construido (24-08).** El tablero dibuja un
      login propio con la marca del courier y **no se puede construir**: en esa URL no hay dato del
      que sacar de qué courier se trata, porque el producto vive en un solo dominio sin subdominio
      por courier. La regla 42 ya lo había resuelto por el otro lado —`neutra` es exactamente «no
      sabemos quién entra por esta puerta»—, así que el redirect a `/login` es correcto. El tablero
      se contradice consigo mismo y gana la regla, que es la que se puede cumplir. Queda escrito en
      el archivo, con la condición que lo reabriría: un subdominio o un enlace con el courier.
- [x] **`/admin/login` y su segundo paso — HECHO (24-08). Cierra las 13 pantallas sin sesión.**
      El formulario lo sigue renderizando `admin/layout.tsx` y no la página, y **está bien así**: la
      protección es uniforme para todo `/admin/*`, no de una ruta.
      · **Marca Rutax + distintivo `BACKSTAGE`** en ámbar con trama de 45°, el mismo recurso que el
        modo de pruebas. No adorna: avisa de que **acá se ven datos de varias empresas**, que es la
        única superficie del producto donde eso pasa. Va junto a la marca porque es una propiedad
        de la puerta, no del formulario. `PantallaSinSesion` gana una ranura `distintivo`.
      · **Columna centrada, sin lienzo**, como pide el tablero: el lienzo de marca es de la puerta
        que abre nuestro cliente; en la del backstage no le habla a nadie. Y se retira la sombra
        que tenían las dos pantallas (regla 4).
      · **El copy explica por qué, no que.** Antes: «Este panel requiere tu cuenta de super-admin
        (correo y contraseña + verificación en dos pasos)» — describe el mecanismo. Ahora dice lo
        que no se ve: que esta credencial abre la puerta de todos los couriers a la vez.
      · ⚠️ **La cifra del aviso se cuenta, no se copia.** El tablero dice «tu credencial vale por 27
        empresas»; 27 era el dato del día del dibujo. Un número a mano en una advertencia de
        seguridad envejece solo, y el día que deje de coincidir la advertencia pierde su peso. Se
        consulta; si falla, la frase va sin número y sigue siendo cierta. **Verificado: dice «1
        empresa», en singular, que es lo que hay en la base local.**
      ⚠️ **NO se ofrece «usa un código de respaldo», que es lo que dibuja el tablero: no existen.**
      Un enlace ahí sería un botón muerto en la pantalla donde alguien ya está bloqueado — el mismo
      defecto que se acaba de quitar de `revisa-tu-correo`. Se dice lo único cierto: que hay que
      pedirle a otro administrador total que reponga el factor.
      🔴 **Y eso es una brecha operativa real, no solo de copy: hoy un administrador que pierde su
      teléfono no tiene camino de vuelta por sí solo.** Con un único super-admin en la base, perder
      ese teléfono deja el backstage inaccesible sin tocar la base a mano. Los códigos de respaldo
      son trabajo pendiente de seguridad, no de esta pantalla.
- [x] **`/registro` — ya usaba el marco** *(verificado 24-08; el checklist lo daba por
      pendiente)*.
- [x] **`/registro/revisa-tu-correo` — HECHO (24-08), y tenía un enlace muerto.** Su única salida
      era «Contacta a soporte» → `/soporte`, **que no existe**: mandaba a un 404 justo a quien ya
      está atascado esperando un correo. Se retira; la acción de la pantalla es reenviar.
- [x] **`/activar-cuenta` — HECHO (24-08).** Al marco, marca Rutax en sus dos estados.
- [x] `/invitacion/[token]` — **los 5 finales, hechos**, y el trabajo no fue escribirlos: fue
      **darle a cada uno una salida distinta**. Los cinco casos estaban en el servidor desde antes
      —`resolverInvitacionPorToken` ya devolvía `invalida · expirada · revocada · ya_aceptada ·
      error`— pero en pantalla los cinco eran la misma tarjeta gris con un ícono y «contacta a quien
      te invitó».
      Ahora: **ya se usó** → `balanced` y un botón para entrar (no es un error: es el mejor final
      llegando tarde) · **venció** → `attention`, **sin botón a propósito**, porque la invitación la
      crea el courier y un «Solicitar una nueva» ahí sería un botón que no puede funcionar · **la
      canceló el courier** → `inert` con su trama · **enlace no válido** → `neutral`, y nombra la
      causa real (el correo que parte el enlace en dos líneas) · **falla nuestra** → `fault` y
      «Volver a intentar», el único donde reintentar arregla algo.
      ⚠️ **Regla 45 en el cuarto:** el texto habla del *enlace*, nunca de si esa invitación existió.
      «Esta invitación no existe» convierte la pantalla en un oráculo de tokens. Los otros cuatro sí
      pueden ser específicos: el token es correcto, y quien lo tiene es su destinatario.
      🐞 **Y un peso muerto que se llevó por delante:** las seis ramas vivían dentro del componente
      de cliente, así que **quien iba a ver tres líneas de texto se bajaba igual el formulario de
      contraseñas entero**, con sus tres campos y su medidor. Los finales pasan a
      `estados-finales.tsx`, servidor puro, y la página bifurca antes de mandar nada al navegador.
      El medidor de fortaleza, de paso, dejó de decir «Débil» —que manda a probar al azar— y ahora
      nombra el cambio concreto que sube el escalón.
      **Verificado en el navegador** los cinco: tonos `balanced · attention · inert · neutral` leídos
      del DOM, más el formulario válido con su medidor recorrido de «Corta» a «Fuerte».
- [x] **`/recuperar-contrasena` — ya usaba el marco** *(verificado 24-08)*.
- [x] **`/restablecer-contrasena` — HECHO (24-08).** Al marco. El enlace vencido conserva su
      pantalla propia con la salida de pedir otro, que es lo que el tablero pide.
- [x] `/tracking/[token]` — **hecha, y con la `línea de tiempo pública` que faltaba.**
      Tenía los estados; lo que no tenía era **recorrido**. Un distintivo suelto que dice «En camino»
      contesta *qué* pasa; quien abre esto desde WhatsApp, en la calle, quiere saber *dónde va en el
      trayecto*. Ahora son tres hitos —**Lo tenemos nosotros · En camino · Entregado**— con el trazo
      que se llena hasta donde está el pedido hoy.
      **El detalle que hace el trabajo:** cuando va en camino, el tramo que **sale** del hito actual
      se llena hasta el **45 %** y se detiene. Es la única forma de decir «ya salió, todavía no
      llega» sin una palabra. 🐞 Estaba escrito al revés —el parcial en el tramo que *llega*— y el
      dibujo decía que el pedido ni había salido; se vio midiendo el `scaleY` en el navegador, no
      mirando la pantalla.
      **Lo que se anima es el trazo, nunca un dato:** títulos, horas, código y distintivo están en el
      HTML desde el primer cuadro. Corre **una vez**, 1,4 s, y tiene versión estática con «reducir
      movimiento».
      ⚠️ **Y una trampa que era un bug de producto, no de QA:** `requestAnimationFrame` **no corre en
      una pestaña oculta**, y WhatsApp abre el enlace en segundo plano a cada rato. Sin red debajo,
      el trazo se quedaba en cero: un adorno que no aparece es un adorno, pero **una línea de tiempo
      vacía es información falsa**. Lleva un `setTimeout` de respaldo, que sí corre oculto.
      **Tres correcciones de honestidad que el dibujo obligó a mirar:**
      · el hito del medio **no lleva hora** — no existe columna de «salió a ruta»; lo más parecido es
        `asignado_en`, que puede ser tres horas antes de que la van se mueva. Va la ventana, que sí
        es un compromiso;
      · «**antes de** las 20:00», no «alrededor de las» — `fecha_compromiso_hora` es un límite (de él
        sale `sla_cumplido`), y «alrededor» prometía un punto medio que el dato no respalda;
      · un pedido **cancelado antes del retiro pierde los hitos que no ocurrieron** — dibujarlos
        cumplidos le dice al comprador que su paquete está con el courier cuando sigue en la tienda.
      **Y la tensión de marca quedó resuelta con la evidencia del propio diseño** (estaba anotada
      como «decisión de producto» sin resolver): firma **el courier** arriba y el **seller** va en la
      frase —«Tu pedido de Vega Norte»—, que es exactamente el reparto de `mail.seguimiento`. Antes
      el seller ocupaba el encabezado y el courier no aparecía en ninguna parte.
      Gana además el **código de envío**, que la matriz de exposición por rol siempre pidió («solo
      código, comuna, estado y ventana») y no estaba. Sigue sin ir el nombre de quien recibió:
      «Lo recibió alguien en el domicilio» (regla legal 3).
      **Verificado en el navegador los cinco estados**, con datos sembrados: tonos `neutral ·
      progress · balanced · attention · inert`, el trazo medido en `1 / 0,45` en camino y `1 / 1`
      entregado, y la hora de entrega saliendo del POD.
- [x] **`/terminos` y `/privacidad` — la PANTALLA hecha (24-08); el texto sigue siendo del abogado.**
      Tenían contenido real y layout propio —correcto: un documento legal no es una columna de
      460 px como las de formulario—. Faltaba lo estructural que el tablero sí pide:
      · **versión y fecha de vigencia arriba.** Había «Última actualización: 5 de agosto», que es
        información para el lector y **no sirve como llave**: dos redacciones pueden compartir
        fecha. Y hace falta una llave porque **hay consentimientos que citan el documento por
        versión** — un registro no puede decir «aceptó los términos», tiene que decir a qué
        redacción dijo que sí. Las versiones viven en `src/lib/legal/versiones.ts`, junto al
        patrón que ya existía para el consentimiento de ubicación.
      · **la medida de 62 caracteres.** Estaba en `max-w-3xl` = 768 px, del orden de **110
        caracteres por línea**. Medido después del cambio: **62 exactos**.
      ⚠️ Y una trampa al alinearlo: `ch` se resuelve contra la fuente **del propio elemento**, así
      que `max-w-[62ch]` daba 610 px en la cabecera, 534 en el cuerpo y 458 en el pie — los tres
      «62ch». Se ancla el tamaño de letra en el contenedor y el visible va en el contenido. Medido:
      los tres en 448–982.
- [x] **`/offline` — HECHO (24-08), y no tenía ninguna salida.** El tablero pide reintentar, y un
      «Reintentar» pulsado sin señal no hace nada visible: recarga, vuelve a fallar, muestra lo
      mismo. Quien lo pulsa tres veces concluye que la app está rota. Ahora el botón **dice el
      estado de la red antes de tocarlo** —desactivado y «Esperando señal…» sin conexión, activo y
      «Volver a cargar» cuando vuelve— y se activa solo. Verificado en los dos sentidos.
      ⚠️ Y lo primero que dice la pantalla es que **no se perdió nada**: la ve el conductor a mitad
      de ruta, y su pregunta no es qué pasó sino si tiene que volver a marcar la entrega. Sin eso,
      la reacción razonable duplica registros.
- [x] **`not-found.tsx`** — **hecha** *(NUEVO #28, aprobado por el usuario el 23-08)*. No existía
      ninguna: todo `notFound()` caía en «404 · This page could not be found», **la única pantalla
      del producto en inglés**.
      Y no la ve solo un interno que se equivocó de URL: la ve **el destinatario de un paquete**
      cuando el enlace de seguimiento no calza — token vencido, mal copiado, pedido purgado
      (brecha #10). Esa persona no tiene cuenta ni sabe qué es Rutax.
      Tres decisiones de copy:
      · **No dice qué falló**, porque no se sabe: una 404 no distingue un enlace mal copiado de uno
        vencido. Inventar una causa sería adivinar delante de alguien que no puede contradecirte.
      · **No confirma ni niega** (regla 45): decir «este envío no existe» convierte la 404 en un
        oráculo — probando tokens se averigua cuáles son válidos.
      · **La salida no es «volver al inicio»**: quien llegó desde un enlace de seguimiento no tiene
        inicio acá. Debajo va lo único que de verdad puede hacer — pedirle el enlace a quien se lo
        mandó. Sin ilustración: sería varios cientos de KB para alguien con mala señal.
      **Verificado en el navegador**: cero inglés.
- [x] `src/app/error.tsx` y `src/app/global-error.tsx` — **al sistema.**
      `global-error.tsx` reemplaza el `<html>` y el `<body>` del layout raíz —es lo que se ve cuando
      el propio layout reventó—, así que **no hay hoja de estilos cargada**: ni `globals.css`, ni el
      puente, ni las variables. Todo va en línea y con valores literales, como el mapa, los PDF y
      los correos.
      Los que había eran del ADN anterior (`#f8fafc`, `#0f172a`, `#e2e8f0`, `#64748b`, `#94a3b8`), y
      ese último daba **2,5:1 sobre blanco** justo en el **código de error** — lo único que sirve
      para que soporte encuentre nada.
      `error.tsx` pierde su `shadow-xs` (regla 4) y baja el radio a 3 px.
- [x] `/kitchen-sink` — **cerrada en producción** *(decisión del usuario, 23-08)*. Estaba servida
      sin ninguna protección —ni sesión, ni `NODE_ENV`, ni middleware—, devolviendo **200 a
      cualquiera** que adivinara la URL, y desplegada desde que se creó.
      No filtra datos —todo lo que muestra es inventado— pero enseña el producto por dentro: cada
      primitiva, cada estado y cada patrón **antes de que exista la pantalla que lo usa**.
      La puerta va en un `layout.tsx` y no en la página, porque la página es un Client Component:
      así la comprobación corre en el servidor y en producción el HTML **no se genera nunca**.

## Sitio comercial · 6 páginas, 2 construidas

**Existe `(marketing)`**, con la portada y `/agendar`. Las cuatro páginas de integración y de precio
siguen pendientes, y ninguna de ellas está dibujada. La especificación completa está en
`RUTAX-SITIO-COMERCIAL.md`.

- [x] **La portada** — **las 12 secciones, hechas**, y `src/app/page.tsx` deja de ser 31 líneas de
      enrutamiento: sin sesión renderiza el sitio; con sesión, el enrutamiento por tipo de usuario
      sigue igual.
      El titular es **«La operación y el dinero de tu courier, en un solo sistema»** — el arco
      completo, no un detalle operativo de un cliente («Si cierras a las 16 horas…» excluye al 95 %
      de los visitantes) ni una sola operación descrita como si fuera el producto. Son los dos
      errores que este trabajo ya había cometido una vez.
      **Sin precios**, por decisión del usuario: el modo de cobro va a cambiar, y una portada que
      promete un número que después se mueve es peor que una que no lo dice.
      Cumple las cinco reglas que se verifican solas: **74** las cifras están en el HTML desde el
      primer render · **75** nada corre en bucle · **76** hay versión estática diseñada · **77** no
      se lista ninguna integración que no exista · **79** cero imágenes arriba del pliegue.
      **Verificado en el navegador**: las 12 secciones y la secuencia recorrida beat por beat.
- [x] **La secuencia del hero** — *pieza no presupuestada, construida a pedido del usuario.* Cuatro
      beats en 8,2 s sobre **una sola fila que nunca se reemplaza**: entra sola con la dirección ya
      escrita → se asigna → se entrega → **bajan las dos líneas de dinero**. Contarlo con palabras
      exige que el visitante confíe; mostrarlo como cuatro escenas sueltas obliga a creer que es el
      mismo pedido. Una fila que el ojo sigue **es** la prueba.
      Arranca al entrar en pantalla, corre **una vez** y ofrece «Volver a ver». Con «reducir
      movimiento» muestra los cuatro beats a la vez, numerados.
- [ ] `/integraciones/mercado-libre-flex` — *definida en razón, estructura, H1, título y meta; no dibujada.*
- [ ] `/integraciones/shopify` — *no dibujada.*
- [ ] `/cobros-y-liquidaciones` — *no dibujada.*
- [ ] `/precios` — *no dibujada.* **Decisión abierta: el número del precio** y si hay mínimo mensual
      para couriers de 1 a 5 conductores. La unidad ya está decidida: por conductor al mes.
- [x] `/agendar` — **hecha**, con **seis campos y ni uno más**: nombre · courier · WhatsApp ·
      correo · cuántos conductores · de dónde llegan los pedidos. **WhatsApp además del correo**
      porque este comprador coordina por ahí y pedir solo correo alarga la coordinación tres días;
      **cuántos conductores** porque es el único campo que califica de verdad. **Sin fecha y hora**:
      el calendario incrustado es la fricción más cara del embudo — obliga a decidir una agenda antes
      de saber si vale la pena.
      **Los tres estados que se pierden si no se diseñan, diseñados:** error de validación pegado al
      campo y sin vaciar lo escrito · **falla de envío**, la pantalla más cara del sitio, con el
      teléfono directo apareciendo **solo ahí** (ponerlo siempre lo vuelve la salida fácil y nadie
      completa el formulario) · y **«si vuelve»**, que reconoce que ya escribió en vez del formulario
      en blanco que le hace pensar que su solicitud no llegó.
      ⚠️ **Si el correo no sale, la acción FALLA.** No devuelve un éxito falso: acá **el correo ES el
      hecho**, al revés que los correos de dinero, donde el hecho ya ocurrió y el aviso es
      secundario. La confirmación le devuelve lo que escribió —su nombre, su courier, su WhatsApp—
      para que detecte un dígito mal puesto mientras todavía puede avisar.
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

- [x] **#7** — el inicio de sesión presentaba toda causa de fallo como error de tipeo. Cerrada.
- [x] **#9** — **la mitad de la página de inicio, cerrada**: `/` sin sesión ya no redirige a
      `/login`, muestra el sitio.
      ⚠️ *La otra mitad no se cierra, y no es un olvido:* el registro sigue **sin un solo enlace
      entrante desde el sitio, a propósito** — `RUTAX-SITIO-COMERCIAL.md` lo fija en su primera línea
      («sin precios en la portada, sin prueba gratis, **sin registro autoservicio**») y la regla 80
      manda todo a un único destino. Que `/registro` no tenga puerta pública es la decisión; lo que
      queda por resolver es **desde dónde entra** quien sí debe registrarse.
- [x] **#10** — el destinatario del paquete veía el 404 en inglés del framework. Cerrada esa
      mitad; la página de seguimiento en sí es la `línea de tiempo pública`, que sigue pendiente.

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
| ✅ `credencial de una sola vez` | DE CERO | B3b Integraciones · 1 | **hecha el 23-08** — ver abajo |
| `formulario de alta con aviso en línea` | EXTENDER | B1c, B3b, B4, B6, B7 · 14 | 9b |
| ✅ `tarjeta de salud de conexión` | DE CERO | P7, B3b Sellers, B4, B6 · 6 | **hecha el 23-08** — ver abajo |
| ✅ `bloque de falla externa` | DE CERO | P7, B4 Inicio · 4 | **hecho el 23-08** — ver abajo |
| `fila de salud de conexión` | EXTENDER | B6 Salud · 1 | 9c |
| `secuenciador de ruta` | DE CERO | B1b Manifiestos · 2 | **9d · Operación**, después del bloque 4 |
| `redistribución por conductor no disponible` | DE CERO | B1b · 1 | 9d · **NUEVO #4** |

> **Por qué 9c importa más de lo que parece.** El sondeo de salud de ML no distingue causas: token
> vencido, revocado y fallo de descifrado terminan los tres en «desvinculada» con el mismo texto. El
> `bloque de falla externa` existe precisamente para eso, y **regla 60: un error de integración dice
> siempre qué sigue funcionando.**

## 9c · Lo hecho

- [x] **`bloque de falla externa`** · DE CERO — `src/components/ui/bloque-falla-externa.tsx`,
      montado en el panel de cuentas de Mercado Libre del portal del seller.
      **Un `alert` no alcanzaba, y el motivo es el que el propio checklist señalaba:** el sondeo de
      salud de ML **no distingue causas**. Token vencido, token revocado por el seller y fallo al
      descifrar el secreto terminan los tres en «desconectada», y desde afuera no hay forma de saber
      cuál fue. Decir «tu token expiró» sería elegir una de las tres al azar; decir solo
      «desconectada» deja a la persona sin saber qué se rompió ni qué sigue en pie.
      Ahora lo dice: «puede ser que caducara solo, que lo revocaras desde tu cuenta o que algo
      fallara de nuestro lado: **no podemos distinguir cuál de los tres**, y reconectar arregla los
      tres igual».
      ⚠️ **REGLA 60 · un error de integración dice SIEMPRE qué sigue funcionando**, y es la parte
      que faltaba y la que más calma. Cuando un seller lee «tu cuenta se desconectó», lo que se
      pregunta no es qué pasó: es **si perdió los pedidos que ya tenía y si le van a cobrar igual**.
      Sin esa respuesta llama por teléfono — y la llamada la contesta el courier, que tampoco sabe.
      Por eso `sigueFuncionando` **no es opcional** en el componente: si no se puede nombrar qué
      sobrevive, este no es el componente correcto.
      Y **no se muestra el mensaje del proveedor**: «invalid_grant» no le dice nada a nadie y sí
      dice de más sobre cómo está armado el sistema por dentro. Va en `attention` y no en `fault`
      porque nada se perdió y hay salida.
      **Verificado en pantalla** con una conexión caída real de la semilla.

- [x] **`tarjeta de salud de conexión`** · DE CERO — `src/components/ui/tarjeta-salud-conexion.tsx`,
      y con ella **el vocabulario unificado**.
      🐞 **Los mismos cuatro estados se llamaban de tres formas distintas**, en tres archivos:

      | estado | `traduccion-estados` | panel de ML | panel de Shopify |
      |---|---|---|---|
      | `sana` | Conectado | Conectada y sincronizando | Conectada |
      | `atencion` | Requiere atención | Necesita atención | **Con problemas** |
      | `desvinculada` | Desconectado | Desconectada — reconéctala… | Desconectada |
      | `pendiente` | Sin conectar | Configurando… | Sin sincronizar todavía |

      **Y el seller ve dos de ellos en la misma pantalla**: su cuenta de ML «necesita atención» y su
      tienda Shopify está «con problemas» — dos nombres para lo mismo, uno al lado del otro, y nada
      que le diga que son el mismo estado.
      Gana la redacción **accionable** y vive en `traduccion-estados.ts`, que es el único sitio del
      vocabulario. El componente **no tiene títulos propios** a propósito: tenerlos habría creado el
      cuarto.
      El tono sale de los seis del sistema, con su glifo — cada panel traía su propio mapa de
      colores con alfas sueltos (`bg-success/15`, `border-warning/30`, `variant="error"`).
      `pendiente` va en **neutro** y no en ámbar: una cuenta que todavía no sincronizó no es una
      advertencia, es el estado normal de algo que acaba de empezar.
      **Verificado en pantalla** en el portal del seller.

- [x] **`credencial de una sola vez`** · DE CERO — `src/components/ui/credencial-una-sola-vez.tsx`,
      en la creación de API keys. La regla 31 pide **«mostrada · copiada · advertencia previa»**; las
      dos primeras estaban y la tercera no, que es la que importa:
      🐞 **La advertencia llegaba DESPUÉS.** El aviso «copia esta clave ahora, no se mostrará de
      nuevo» aparecía junto a la clave **ya generada**. Quien apretó «Crear» no sabía que estaba
      abriendo una puerta de un solo sentido.
      🐞 **Y se podía cerrar sin copiar.** «Entendido» estaba habilitado desde el primer instante: un
      clic de más y la credencial se perdía para siempre, sin nada que lo impidiera. La única salida
      es revocarla y crear otra, y cambiarla en todo lo que la use.
      *Lo que NO se hizo, a propósito:* obligar a apretar «copiar». Sería hostil y además engañoso —
      mucha gente la anota en su gestor a mano o la pega directo en el servidor. Lo que se exige es
      **declarar que ya está guardada**, y copiar marca la casilla solo. Es el peldaño 2 aplicado a
      una puerta de un solo sentido.
      El valor va en un `<input readonly>` y no en un `<p>`: se selecciona con el teclado, el lector
      de pantalla lo anuncia como valor y el gestor de contraseñas lo reconoce.
      **Verificado en pantalla** la advertencia previa; *el revelado en sí no se pudo ejercitar en
      vivo* — la casilla de permisos del formulario no responde a interacción programática.

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

# Anexo A · Los 33 marcados NUEVO

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
- [ ] **#31** · Entrar con Google, y correo con código de un solo uso como respaldo. Sin contraseña.
      *(No necesita SMS: el envío de correo ya existe. Se lleva por delante el flujo de invitación
      del backoffice, que hoy dice «defina su contraseña».)*
- [ ] **#32** · La sesión del conductor no vence por tiempo: vence cuando el courier lo suspende o
      cuando él sale. *(Decisión de seguridad tanto como de diseño.)*
- [ ] **#33** · La ayuda de campo del alta del conductor dice que ese correo es el que usará para
      entrar a la app. *(Corrección al formulario de B1c, no una pantalla nueva. Evita el error más
      probable del día uno.)*

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

> ⚠️ **La ficha importada de Claude Design dice 28; son 33.** Dos tableros se agregaron después de
> la ficha: `B7b Autenticacion` trae los números 29 y 30, y `B5b Entrada del conductor` —traído el
> 24-08— trae el 31, el 32 y el 33. Si se vuelve a importar la ficha, **hay que reponer esa
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
| **37** | Ninguna acción se confirma con un diálogo nativo del navegador | ~~6 en `admin/`~~ → **eran 8**: el conteo original solo miró `src/app/admin/` y se le escaparon dos en la configuración del propio courier. **Quedan 1**, y es el bloqueado a propósito. | 4, 5 y 9 |
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

# Anexo E · Dónde el código se aparta del tablero, y por qué

Los tableros son la **autoridad visual**: sus valores exactos, su anatomía y su copy se siguen
literalmente, y después se verifican en el navegador contra esos mismos valores. Pero un tablero es
una maqueta con datos inventados, y hay cuatro clases de choque en las que **no se puede seguir al
pie de la letra**. Esta lista existe para que las revises de una sentada y digas cuáles quieres que
se fuercen igual.

**La regla que se aplicó en todas:** el tablero manda sobre *cómo se ve* y sobre *por qué*; el
código manda sobre *qué datos existen*. Cuando chocan, se dice — no se elige en silencio.

## E.1 · El tablero dibuja una acción que no existe en el código

- [x] **`B2a` · «Volver a abrir el período».** *Resuelto el 22-08: se construyó.* El tablero la
      dibujaba y el copy la prometía; el código no la tenía, y el cierre era irreversible **sin
      ninguna razón técnica que lo justificara**. Ahora existe `reabrirPeriodo` con su botón en el
      detalle del período, junto a emitir.
      *Lo que se descubrió al construirla:* la ventana en la que el período está `cerrado` pero su
      factura ya se encoló. Ver el detalle en «Las 26 acciones irreversibles».

## E.2 · El tablero muestra datos que el sistema no tiene

- [x] **`B2a` · la composición por concepto dentro del modal de emisión.**
      **RESUELTO (22-08-2026): se calcula en la pantalla.** La página del período ya carga todas las
      líneas y ya las agrupa con `agruparLineasCobro` para su tabla financiera; el modal recibe esa
      misma composición como prop. **No hay una segunda aritmética que se pueda desincronizar**, y
      no hizo falta tocar el preflight.
      Solo se pasa cuando hay ajustes: sin ellos el neto **es** el subtotal, y una composición de un
      término es ruido — la regla 21 pide composición para lo que no es una suma trivial.
- [x] **`B2b` · el autor del ajuste manual** («Aplicó M. Soto el 19-08»). `dinero.liquidaciones`
      guarda `nota_ajuste` pero **no quién lo aplicó**: el autor está en la bitácora, no en la fila.
      *Para cerrarlo:* una lectura extra contra la bitácora, o una columna.

- [x] **`P4` · el comprobante con el folio adentro** («1042 · quedan 7 después»). El tablero supone
      que emitir consume el folio en el acto; en Rutax **no**: `emitirFacturaPeriodo` publica el
      evento y el job C3 reserva el folio después. *Qué se hizo:* el comprobante dice «se asigna al
      generarse el documento», que es lo cierto. Prometer un folio que nadie tomó es justo lo que
      hace que Administración lo salga a buscar.

- [x] **`excepciones.omitirVerif.conf` está escrito como ceremonia APARTE, de peldaño 3** —
      «Escribe **EMITIR IGUAL**», con «Revisar los 3 problemas» como salida. Acá vive **dentro del
      mismo cuadro**, como acto marcado, porque en Rutax la verificación previa también vive
      adentro: el flujo del tablero (pantalla de verificación → botón «Emitir igual» → ceremonia)
      se colapsa en uno solo. *Qué se hizo:* se adoptaron sus **palabras** —«la verificación
      encontró N problemas y voy a emitir igual · queda registrado que omití la verificación, con
      mi nombre»— y la constancia en bitácora. Lo que no se duplicó es el segundo texto a escribir:
      emitir factura y emitir pago **ya son peldaño 3**, así que quien sigue con reparos ya está
      escribiendo el nombre de la contraparte. Pedir dos frases en el mismo cuadro gasta la
      fricción en vez de agregarla.

- [x] **`B1a` §13.4 · «el punto de entrega lleva el tono de su estado de ciclo».** Para *entregado*
      ese tono es `balanced`, que es **el mismo teal de la rampa de carga de comuna**: a las 21:00
      el mapa sería una mancha teal donde no se distingue una comuna cargada de un punto ya
      entregado. Y `inert`, que es lo semánticamente exacto para algo que ya no cuenta, **exige su
      trama de 135°** — imposible en un círculo de 8 px.
      *Qué se hizo:* el entregado toma el gris del propio plano (`--rx-map-label`). Un punto
      entregado en una consola de monitoreo es escenario, no contenido — que es justo lo que dice
      la regla 0 de la Torre. Pendiente y en ruta sí toman su tono (`neutral` y `progress`), igual
      que en el resto del producto.

## E.3 · El tablero permite algo que el dominio no soporta todavía

- [ ] **`B2b` · atribuir un movimiento a VARIOS períodos** («paga dos períodos con una
      transferencia»). `atribuirPagoManualmente` acepta **uno**.
      *Qué se hizo:* el calce como resta está, con sus dos casos raros nombrados. El reparto entre
      varios períodos, no.

## E.4 · El tablero se contradice con las reglas escritas

- [x] **`P4` · el modal lleva `box-shadow` y la regla 4 dice «sin sombras».**
      **RESUELTO (22-08-2026): se mantiene la sombra**, y queda como excepción declarada. La regla 4
      habla de cómo se eleva una **superficie** dentro de la página —escalón de fondo + borde—, y un
      modal flotando sobre un velo es otra cosa; el propio tablero lo dibuja así. La excepción está
      escrita en la cabecera de `dialog.tsx` para que no se relitigue.

## E.5 · Los documentos no concuerdan entre sí

- [ ] **La cuenta de componentes.** El resumen del costo dice **100** (31/27/42); sus ocho tablas
      suman **108** (29/24/55); `RUTAX-SISTEMA-DE-DISENO.md` §8 dice **92**. El checklist enumera
      contra las tablas, que son la única lista enumerada.
- [ ] **Los correos son 11, no 16.** El costo habla de «los 16 correos»; en código hay 9
      constructores que producen 11 correos distintos.
- [ ] **Cuatro componentes del marco que el costo declara `DE CERO` ya existían** y funcionan: nav
      colapsable, nav anidada de configuración, buscador global con backend real y centro de avisos.
      El presupuesto los cobra como nuevos.

## E.6 · Material citado que no existe

- [ ] **Los ocho anexos (`ANEXO-A`..`H`) y `HALLAZGOS-TECNICOS.md`** que cita
      `RUTAX-INVENTARIO.md` — «4.703 textos con archivo y línea», «36 defectos técnicos». No están
      en el repo **ni** en el proyecto de Claude Design. Decidido el 22-08: seguir sin ellos.

## E.7 · Una corrección a este mismo documento

- [x] Una versión anterior decía que el **aviso de configuración pendiente** siendo no-sticky era un
      defecto. **No lo es.** La regla 7 pide que no se oculte al hacer scroll **para el banner de
      sesión suplantada**, no para éste; hacerlo fijo le robaría alto vertical a todas las pantallas
      de forma permanente por un aviso que no es urgente al segundo.

---

# Anexo F · Cómo se cierra un bloque

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
