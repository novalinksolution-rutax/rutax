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
| **1** | Tokens y primitivas | **hecha** — tokens, puente, fuentes, 8 re-estilos, selector de fecha | `interruptor` · `credencial de una sola vez` | — | *(no hizo falta)* |
| **2** | Estado | **hecha** — 8 de 10 componentes | adopción: **0 pantallas** pasan `eje`+`valor` | — | *(no hizo falta)* |
| **3** | Tablas | **hecha** — las 4 piezas nuevas | adopción: **0 pantallas reales**, solo `kitchen-sink` | — | *(no hizo falta)* |
| **0** | **Cola de 1–3** | — | 4 ítems sistémicos | — | — |
| **4** | **Marco** | 8 componentes · **4 ya existen** | 4 nuevos + las brechas de los 4 que existen | #12 · #21 | `Rutax P1 Pedidos` |
| **5** | **Dinero** | 16 componentes · **0 hechos** *(el preflight tiene su lógica, no su forma)* | 16 + las 4 anulaciones | #7 a #11 | `Rutax P4 Emitir factura` · `B2a` · `B2b` |
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
- [ ] **`interruptor`** — DE CERO. **No se construyó.** Ver bloque 0.
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

**Desbloquea:** que las correcciones de tono del sistema **se vean** en producción. Hoy no se ven.

- [ ] **0.1 · Construir `interruptor`** — `src/components/ui/switch.tsx`. Es DE CERO: no existe
      `switch.tsx` ni un solo `role="switch"` en `src/`. El catálogo le pide los nueve estados y
      una **etiqueta de consecuencia**. Cubre 14 pantallas: banderas, disponibilidad del conductor,
      cobro automático, notificaciones.
      *Dependen de él:* `configuracion/plan/bloque-cobro-automatico.tsx`, conductores, preferencias
      de la app.

- [ ] **0.2 · Pasar `eje` + `valor` en las 32 llamadas de producto a `BadgeEstado`.**
      **Hoy son cero.** Los únicos 5 sitios que lo hacen viven en `/kitchen-sink`, y el sexto es el
      ejemplo del comentario de `badge-estado.tsx`. Sin esos dos datos la variante heredada ya
      perdió de qué eje venía, y las correcciones son por `eje:valor`: un `cancelado` y un
      `pendiente` llegan indistinguibles, los dos como `neutral`, **y solo el primero tiene que ir
      en `inert` con su trama**.

      | Superficie | Llamadas | Archivos |
      |---|---|---|
      | `(tenant)` | 21 | 15 |
      | `admin` | 5 | 3 |
      | `src/components` | 4 | 2 |
      | `portal` | 2 | 2 |
      | `conductor` (PWA) | 0 | — |

      Se puede hacer en tandas por superficie. Cada tanda es mecánica y verificable a ojo.

- [ ] **0.3 · Absorber los 10 envoltorios locales `BadgeEstadoXxx`.** Cada uno tiene su propia
      lógica de color, fuera del sistema, y ninguno pasa por `tonoDeEstado`:
      `BadgeEstadoMatch` (`dinero/cobranza/page.tsx:254`) · `BadgeEstadoSiiInline` y
      `BadgeEstadoCobro` (`dinero/periodos/page.tsx:335, 357`) · `BadgeEstadoSii`
      (`dinero/periodos/[periodoId]/page.tsx:485` y `portal/cobros/[periodoId]/page.tsx:341`) ·
      `BadgeEstadoSiiCompacto` (`portal/cobros/page.tsx:219`) · `BadgeEstadoInvitacion`
      (`equipo/panel-equipo.tsx:425`) · `BadgeEstadoConexion`
      (`onboarding/cobranza/formulario-conexion-cobranza.tsx:368`) · `BadgeEstadoCertificacion`
      (`onboarding/dte/formulario-configuracion-dte.tsx:429`) · `BadgeEstadoFolio`
      (`onboarding/folios/panel-folios-caf.tsx:367`).
      Cada uno es un vocabulario de estado que el registro ya define. Van a `tonos-estado.ts`.

- [ ] **0.4 · Cerrar los vocabularios de `traduccion-estados.ts` sin corrección declarada.**
      El diseño define **29 vocabularios con ~147 valores**; `tonos-estado.ts` trae hoy **10
      correcciones**. Revisar los ~14 mapas `BADGE_*` existentes contra
      `RUTAX-REGISTRO-DE-OBJETOS.md` (18 objetos, §.4 de cada uno) y declarar la corrección donde
      el sistema decida distinto — con su razón escrita, como las que ya están.

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

- [ ] **`navegación lateral colapsable`** · EXTENDER · **existe y ya colapsa** —
      `src/components/app-shell/app-shell.tsx:125-142` (preferencia en `localStorage`
      `"rutax:sidebar-colapsado"`, leída con `useSyncExternalStore`, SSR-safe) y `:586-597` (toggle,
      `lg:w-64` ↔ `lg:w-16`). El filtrado RBAC ocurre 100% en el servidor
      (`src/app/(tenant)/layout.tsx:76-207`): lo que no puedes, no aparece.
      *Falta:* re-estilo del rail al sistema nuevo, y que el colapso exista por debajo de `lg`
      (hoy `botonColapsar` devuelve `null` dentro del `Sheet`).

- [ ] **`navegación inferior móvil`** · DE CERO · 4 destinos por rol, 32 pantallas en 390 px.
      Hoy **solo existe en la PWA del conductor** (`app-shell/conductor-nav.tsx`, 3 tabs).
      `(tenant)` y `portal` en móvil tienen únicamente el header de 56 px con hamburguesa → `Sheet`.
      *Nota:* el tab «Inicio» del conductor apunta a `/conductor`, que redirige a
      `/conductor/manifiesto`, así que dos tabs llevan al mismo sitio y `aria-current` nunca cae en
      «Inicio». Se arregla o se retira con la PWA (bloque 6).

- [ ] **`navegación anidada de configuración`** · el costo dice DE CERO · **existe** — el «Patrón H»
      de `app-shell.tsx:465-467` y `:600-637` reemplaza el sidebar entero al entrar a configuración,
      con «← Volver» arriba. Cubre las 9 rutas de configuración.
      *Falta:* (a) **`/configuracion` a secas es 404** — no hay `page.tsx`; el hub de facto es
      `/onboarding`; (b) hay **tres vías distintas** a los mismos destinos (el ítem del sidebar, el
      dropdown del bloque de marca en `layout.tsx:192-201`, y la card de plan en `:179-186`);
      (c) `(tenant)/dinero/layout.tsx` usa **otro patrón** —tabs horizontales— que duplica los mismos
      ítems que ya están en el grupo «Dinero» del sidebar. Una sola regla, no dos.

- [ ] **`migas o retorno explícito`** · EXTENDER · 34 pantallas. **No hay componente compartido**:
      no existe `breadcrumb.tsx` y cada pantalla lo resuelve a mano. Hoy: 2 pantallas con migas
      reales (`dinero/periodos/[periodoId]:140`, `dinero/liquidaciones/[liquidacionId]:122`) y ~10
      con solo «← Volver». `liquidaciones/[liquidacionId]` tiene **las dos cosas apuntando al mismo
      sitio** (`:122` y `:132-137`). Y 31 archivos de `(tenant)` declaran su propio `<h1>`.

- [ ] **`buscador global con teclado`** · el costo dice DE CERO · **existe** —
      `app-shell/paleta-comando.tsx` (215 líneas, implementación propia sin `cmdk`): ⌘K/Ctrl+K,
      Esc, flechas, Enter, debounce 250 ms, `AbortController`, mínimo 2 letras. Backend real en
      `src/app/api/buscar/route.ts` (207 líneas) con scope por `tenant_id` y RBAC por tipo.
      *Falta:* (a) **apagarlo en el portal** — `mostrarBusqueda` viene `true` por defecto y
      `portal/layout.tsx` no lo desactiva, pero `/api/buscar` corta con
      `tipoUsuario !== "interno"`, así que **el seller siempre ve «Sin resultados»**; regla 35, una
      pantalla no promete una acción que la interfaz no ofrece; (b) **encenderlo en el backstage**
      (`admin/layout.tsx:112` pasa `mostrarBusqueda={false}`); (c) el tipo `liquidacion` está
      declarado en `src/lib/buscar/tipos.ts` y no implementado en el handler; (d) puerta táctil
      propia en 390 px; (e) el `<kbd>` del sidebar dice **«F»** y el atajo real es ⌘K.

- [ ] **`centro de avisos`** · el costo dice DE CERO · **existe** — `app-shell/centro-avisos.tsx`
      (96 líneas) sobre `src/lib/avisos/obtener-avisos.ts` (447 líneas), con las 8 fuentes que pide
      el inventario: conexiones caídas, folios por agotarse, corte de seller próximo, incidencias
      sin gestionar, discrepancias de conciliación, excepciones vencidas, consumo de plan al
      80/100 %, comunicaciones de Rutax.
      *Falta:* (a) **el estado leído no existe** — `sinLeer = avisos.length`, o sea el badge cuenta
      cuántos calculó el servidor y nada se puede descartar (brecha #27); (b) la jerarquía de tres
      urgencias, visible pero sin escalón real; (c) no existe en `admin` (apagado explícito) ni en
      el conductor.

- [ ] **`banner de sesión suplantada`** · DE CERO · las 13 del backstage. Hoy existe como **modo
      soporte de solo lectura** (no impersonation real): `admin/couriers/[tenantId]/soporte/banner-soporte.tsx`
      (116 líneas) con motivo obligatorio, contador `mm:ss` y expulsión al llegar a 0.
      *Falta, y es lo importante:* **vive dentro de la página, no en el layout** — el propio
      comentario dice que es porque `admin/layout.tsx` no expone un slot full-bleed. Consecuencia:
      desaparece en su propia rama de error (`soporte/page.tsx:72-89` retorna el bloque de error
      **sin el banner**) y en cualquier excepción que escale a `src/app/error.tsx`. La regla 7 del
      sistema es explícita: **vive en el marco, no se colapsa, no se oculta al hacer scroll**.
      Los tokens ya están: `--rx-impersonation-*` en `rx-tokens.css` §5, **hoy sin consumidor**.

- [ ] **`aviso de configuración pendiente`** · EXTENDER · existe —
      `src/components/onboarding/banner-onboarding.tsx` (43 líneas), montado por el slot `banner`
      del AppShell (`(tenant)/layout.tsx:245-252`).
      *Falta:* (a) es full-bleed y **no sticky**: desaparece al hacer scroll; (b) el conteo es
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
- [ ] `src/app/(tenant)/dinero/layout.tsx` — resolver el segundo patrón de nav anidada.
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

**Desbloquea:** las 5 pantallas de dinero del bloque de diseño B2 y las 4 anulaciones.
**Tableros a traer:** `Rutax P4 Emitir factura` (fija la escalera de fricción) · `Rutax B2a Periodos` ·
`Rutax B2b Liquidaciones y cobranza`.
**Depende de:** bloques 1, 2, 3 y 4.

> **El estado de partida, medido.** De las **19 acciones** exportadas por
> `src/modules/dinero/acciones.ts`, **solo 3 usan el diálogo canónico de fricción**. No existe
> ningún subtotal por concepto en ninguna pantalla. `MontoCLP` y `KpiCard` existen y **no se usan
> en una sola pantalla de `/dinero`**. Y hay **15 `toast.error`** en `(tenant)/dinero/`, contra la
> regla 56.

## Componentes

- [ ] **`escalera de fricción`** · DE CERO · **33 acciones en 21 pantallas**. Es el componente
      central del bloque. Hoy `src/components/ui/dialog-confirmacion-dinero.tsx` (157 líneas)
      soporta **2 peldaños**: un checkbox de confirmación explícita (`:68, 79-82, 119-133`) y un
      gate externo del padre (`confirmDeshabilitado`, `:81`); más cierre duro —Esc, clic fuera y X
      deshabilitados (`:86-92`)—. **No soporta el peldaño 3: escribir para confirmar.**
      *Los 33 textos ya están escritos* en `RUTAX-SISTEMA-DE-MENSAJES.md` §2, cada uno con su
      peldaño (P2/P3) y si lleva motivo o 2FA. No hay que redactar nada.
      **Los 6 llamadores de hoy:** `dialog-emitir-factura.tsx:146`, `dialog-emitir-nota-credito.tsx:157`,
      `dialog-emitir-pago.tsx:149`, `configuracion/plan/cambiar-plan.tsx:244`,
      `configuracion/plan/bloque-cobro-automatico.tsx:119`, `admin/comunicaciones/tabla-comunicaciones.tsx:270`.
      **Las 16 acciones que hoy NO pasan por él** están en el anexo D.

- [ ] **`verificación previa`** · DE CERO · **existe y está bien hecha** —
      `src/modules/dinero/preflight.ts` (906 líneas, 100 % de lectura por contrato), con 16 códigos
      en tres categorías (`bloquea` / `advierte` / `informativo`), el resumen verificado
      (`ResumenCobro`, `ResumenPago`), y el escape con registro (`registrarPreflightOmitido`).
      Más `preflight-lote.ts` y `preflight-cancelacion.ts`.
      *Falta:* la parte visual. `SkeletonPreflight`, `BloquePreflightFallido` y `BandaItemsPreflight`
      están **triplicados literalmente** (~100 líneas idénticas en cada uno de los tres diálogos).
      Extraer a un componente del sistema y darle su forma.

- [ ] **`tabla financiera`** · DE CERO · 14 pantallas. Subtotales por concepto, total con regla de
      2 px, negativo con signo menos real y su causa en la misma fila, variante impresa.
      *Hoy:* solo total general en el pie, calculado en cliente con `.reduce()`
      (`periodos/[periodoId]/page.tsx:428-444`, `liquidaciones/[liquidacionId]/page.tsx:276-286`).
      **Cero agrupación por concepto.** Regla 19: las tablas de dinero se agrupan por concepto con
      subtotal, no línea por línea.

- [ ] **Rótulo bruto/neto en cabecera y pie** · regla 18 · **NUEVO #8**. Hoy hay **tres
      vocabularios distintos**: Neto/IVA/Total (bloque DTE), Monto bruto/Retención/Monto líquido
      (bloque payout), y Monto base/Ajuste/Monto final (tablas de líneas). Uno solo.

- [ ] **`bloque de composición`** · DE CERO · 12 pantallas. Regla 21: **obligatorio** junto a
      cualquier cifra que no sea la suma trivial de una columna. Lo más cercano hoy es el texto
      "base +bono −penalización" de `liquidaciones/page.tsx:375-381` y el preview del diálogo de
      ajuste.

- [ ] **`atribuidor de pago`** · DE CERO · `dinero/cobranza`. La lógica automática existe y es buena
      (`src/modules/dinero/matching-pago.ts`, 168 líneas: calce total con tolerancia de 1 CLP,
      luego abono parcial, luego sobrante, y **nunca adivina** con 0 o más de 1 candidato). Lo que
      falta es la interfaz de calce manual: hoy es un popover artesanal en
      `cobranza/menu-acciones-pago.tsx:196-286`, sin `Popover` del sistema, sin previsualización del
      saldo resultante, y termina en `window.location.reload()` (`:113`).

- [ ] **`panel de ajuste manual`** · DE CERO · existe como
      `dinero/liquidaciones/dialog-ajustar.tsx` (176 líneas): bono, penalización, nota, con preview
      en vivo. *Falta:* no es un panel de líneas —no permite ajustar una línea ni elegir concepto—,
      no tiene fricción ni preflight, y **el motivo no viaja al PDF del conductor** (NUEVO #11).

- [ ] **`indicador de folio disponible`** · DE CERO · P4, B2a, B3a. **Existe en 3 lugares con 3
      cálculos distintos y ninguno está en `/dinero/periodos`, que es desde donde se factura:**

      | Dónde | Cálculo | Umbral |
      |---|---|---|
      | `dashboard/page.tsx:109-128` | exclusivo, **sin filtrar por `tipo_documento`** | 50 hardcodeado |
      | `onboarding/folios/panel-folios-caf.tsx:333-365` | muestra **usados**, no restantes | 85 % |
      | `preflight.ts:137-210` | inclusivo, `hasta − actual + 1`, filtra 33 vs 61 | `UMBRAL_FOLIOS` |

      El de `preflight.ts` es el correcto y tiene el comentario que explica por qué un cálculo
      exclusivo produce un falso bloqueo. Los otros dos se alinean con él.

- [ ] **`modal de acto explícito`** · EXTENDER sobre `dialog-confirmacion-dinero` · 16 pantallas.
- [ ] **`botón de peldaño 3`** · EXTENDER sobre `button` · 14 pantallas.
- [ ] **`campo de monto CLP`** · EXTENDER sobre `monto-clp` + `input` · 11 pantallas.
      `src/components/ui/monto-clp.tsx` existe (47 líneas) y **se usa en 2 archivos**: `kitchen-sink`
      y `dashboard`. Ninguna pantalla de `/dinero` lo usa: todas llaman `formatearCLP` directo y
      repiten `tabular-nums` a mano.
- [ ] **`tarjeta de trazabilidad`** · DE CERO · 11 pantallas. Base parcial:
      `src/components/dinero/panel-trazabilidad-financiera.tsx`, `popover-snapshot-regla.tsx`,
      `trazador-lazo.tsx`.
- [ ] **`tarjeta de resultado en bloque`** · DE CERO · 6 pantallas. Base:
      `preparacion/asignar/_componentes/dialogo-resultado.tsx` y `_lib/resultado.ts`.
- [ ] **`mosaico de magnitudes`** · RE-ESTILO sobre `kpi-card` · 6 pantallas. `kpi-card.tsx` existe
      y se usa en 2 archivos; **cero uso en `/dinero`** (los chips de resumen son enlaces y divs
      artesanales en cada pantalla).
- [ ] **`panel de detalle con zona de consecuencia`** · EXTENDER sobre `sheet` · 12 pantallas.
      Base: `dinero/conciliacion/panel-detalle-excepcion.tsx` (805 líneas).
- [ ] **`distintivo de modo de pruebas`** · EXTENDER · existe `BadgeModoDte` (38 líneas), sin
      re-expresar al sistema. Aplica también al correo, que corre en sandbox y casi nunca lo dice.

## Pantallas

- [ ] `(tenant)/dinero/periodos` (490 líneas) — 5 chips, tabla cruda de 8 columnas,
      panel `AprobacionLote`. **NUEVO #9: el cajón «Con problemas» tiene que filtrar de verdad.**
- [ ] `(tenant)/dinero/periodos/[periodoId]` (567) — es la pantalla de la ceremonia de emisión.
- [ ] `(tenant)/dinero/liquidaciones` (442) — 3 chips, **sin paginación**. **NUEVO #10: los chips
      tienen que navegar, como los de los otros dos módulos.**
- [ ] `(tenant)/dinero/liquidaciones/[liquidacionId]` (345) — 100 % lectura.
- [ ] `(tenant)/dinero/conciliacion` (413) — bandeja de excepciones; **la única de dinero que usa
      `DataTable`**. Es el arquetipo P6.
- [ ] `(tenant)/dinero/cobranza` (258) — **ruta huérfana: no está en la nav de dinero.**
- [ ] `(tenant)/operaciones/[pedidoId]` — anulaciones 2 y 3.
- [ ] `(tenant)/conductores/[id]` — anulaciones 3 y 4.
- [ ] `portal/cobros` y `portal/cobros/[periodoId]` — **NUEVO #7: se retira el «IVA 19 %»**, que era
      el residuo entre total y líneas. Regla 22: la factura PDF es el único lugar del producto con IVA.

## Las cuatro anulaciones

Existen las cuatro y **ninguna usa el diálogo canónico**. Tres comparten un `DialogAnular` genérico
(`operaciones/[pedidoId]/acciones-corregir-dinero.tsx:22-90`), sin preflight y sin checkbox.
Los cuatro textos ya están escritos en `RUTAX-SISTEMA-DE-MENSAJES.md` §2.

- [ ] **Anular factura** (nota de crédito DTE 61) — `acciones.ts:328`, UI
      `dialog-emitir-nota-credito.tsx`. La única con preflight. Solo anulación total (CodRef=1).
- [ ] **Anular línea de cobro por pedido** — `acciones.ts:1594`, UI `acciones-corregir-dinero.tsx:111-119`.
- [ ] **Anular línea de liquidación por pedido** — `acciones.ts:1691`, UI `:120-128` y
      `conductores/[id]/page.tsx:353-360`.
- [ ] **Anular línea de liquidación por `lineaId`** — `acciones.ts:1797`, UI
      `conductores/[id]/page.tsx:361-373`. Existe porque las líneas de retiro no tienen `pedidoId`.

## Brechas del inventario que cierra

- [ ] **#3** — Cobranza afirma que todo se concilió solo aunque el banco nunca se conectó.
- [ ] **#4** — las cifras de dinero no dicen qué son, y una de ellas no es lo que su rótulo afirma.
- [ ] **#6** — el aviso dice «factura emitida» cuando solo se encoló el trabajo.
- [ ] **#22** — diecinueve acciones del courier no confirman nada al terminar.
- [ ] **#31** — los chips del módulo de dinero se comportan de tres formas distintas, y uno no filtra nada.
- [ ] **#33** — desde el detalle del pedido no hay forma de anular una línea de dinero, aunque los
      botones existen.

## Bloqueado

- [ ] **NUEVO #7** · Se retira el «IVA 19 %» del portal.
- [ ] **NUEVO #8** · Rótulo bruto/neto obligatorio en cabecera y pie de toda tabla financiera.
- [ ] **NUEVO #9** · El cajón «Con problemas» filtra de verdad.
- [ ] **NUEVO #10** · Los chips de liquidaciones navegan.
- [ ] **NUEVO #11** · El motivo del ajuste manual viaja al PDF del conductor.
- [ ] *Decisión abierta:* **el unitario de la factura** — agrupado por comuna con unitario
      redondeado y total exacto, o por tarifa real. La toma quien revise con el SII.

---

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
