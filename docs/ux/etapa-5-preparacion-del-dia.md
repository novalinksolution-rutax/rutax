# Preparación del día — diseño de flujo (Etapa 5)

> Estado: diseño de UX, listo para `frontend`. Ruta: `(tenant)/preparacion` → `/preparacion`.
> Fuente de verdad del alcance: `docs/arquitectura/retiro-y-ruteo.md` §7, §2-§3.
> Plan de ejecución: `docs/arquitectura/retiro-y-ruteo-plan.md`, Etapa 5.
> Este documento NO altera esos dos: los operacionaliza en pantalla.

## 0. Propósito, en una frase

Hoy la mañana de retiro se coordina por WhatsApp ("jefe, retiré 20 al seller X"). Esta pantalla
reemplaza esos mensajes: el coordinador y el dueño abren `/preparacion` y ven, en vivo, qué
conductor está en qué bodega, cuánto lleva escaneado, y cómo se está acumulando la carga por
comuna — sin llamar a nadie.

## 1. El flujo, narrado un día completo

1. **07:00.** El coordinador abre `/preparacion` por primera vez. Nadie ha escaneado nada
   todavía. Ve el **estado vacío de arranque** (§5.4): un mensaje tranquilo, sin números en cero
   gritando por toda la pantalla.
2. **07:20.** El primer conductor abre una visita en la app y escanea su primer bulto. La señal
   en vivo dispara un refresco; aparece la primera tarjeta en "En bodega ahora".
3. **Durante la mañana.** Van apareciendo y cerrándose tarjetas de visita. La franja de resumen
   arriba crece (bultos retirados) y el bloque "Carga por comuna" se va poblando solo, sin que
   nadie tenga que pedirle nada a nadie.
4. **11:40.** Un conductor deja de escanear a media visita (se quedó sin batería, o el seller lo
   tiene esperando). Su tarjeta pasa de gris a ámbar sola, con el reloj del cliente corriendo —
   nadie tuvo que refrescar la página para que eso se note (§6). El coordinador lo ve y lo llama
   **por fuera del sistema**: esta pantalla no llama a nadie, solo avisa.
5. **13:00.** La mayoría ya volvió. "Carga por comuna" ya tiene números grandes y estables. El
   coordinador mira la fila de Ñuñoa (142 bultos, 56 sin asignar) y decide que ahí necesita dos
   conductores. Hace clic en "Ir a manifiestos" y continúa en el flujo de asignación que ya existe.
6. **15:30.** Todas las visitas están cerradas. La pantalla ya no tiene mucho que aportar por hoy
   — el trabajo se trasladó a Manifiestos y, después de las 16:00, a la Torre de control (que mira
   el reparto de la tarde, no el retiro de la mañana).

## 2. Quién la usa, cuándo, y cómo se llega

- **Audiencia:** dueño, supervisor, coordinador. **No** administración. RLS por sí sola no lo
  distingue —`identidad.claim_tipo_usuario() = 'interno'` cubre a los cuatro roles internos sin
  diferenciar, ver §7.1 de la migración `20260813000004`— así que el corte lo hace el gate de la
  app, igual que en Bodegas y en la Torre.

- **Capacidad: `ver_preparacion_dia`, propia** (decisión de la sesión principal, 2026-08-13).

  El diseño propuso reusar `asignar_y_reasignar_pedidos`, con el argumento de que la Etapa 6 va a
  traer escritura a esta misma pantalla y así se evita agregar un segundo chequeo después. El
  conjunto de roles resultante es **idéntico** por cualquiera de los dos caminos, así que la
  discusión es de nombre — y por eso mismo se resolvió a favor de la claridad: un gate llamado
  "asignar y reasignar pedidos" sobre una pantalla que hoy **no deja mover un solo pedido** miente
  sobre lo que concede. Cuando llegue la Etapa 6, la acción de asignar necesita su propio chequeo
  de todas formas (el propio diseño lo reconoce), así que no se ahorra nada.

  Descartada también la disyunción `esOperativo` que usa el layout para Pedidos y Manifiestos:
  esa expresión significa "es alguien de operación", no "puede ver esta pantalla", y cambia de
  sentido en silencio el día que alguna de sus tres capacidades se reparta distinto.
  `ver_torre_control` ya sentó el precedente de la pantalla de lectura con gate propio.

- **Navegación: primer ítem del grupo "Operación"**, antes de Pedidos.

  El diseño propuso subirla al grupo principal, sobre la Torre, porque cronológicamente el retiro
  precede al reparto. El argumento es bueno pero la línea divisoria es otra: el grupo principal
  son **consolas de monitoreo** (Dashboard, Torre) y Preparación es una pantalla de trabajo que en
  la Etapa 6 pasa a escribir. Va en Operación, y va primera dentro del grupo — que es el orden del
  día, no el alfabético.

- **Icono:** clave `preparacion` → `Boxes` (lucide-react). Bultos apilados = la carga consolidada
  esperando en el piso de la bodega. No `Package` (ya es "pedidos") ni `Warehouse` (ya es el
  catálogo de bodegas en Configuración): la Preparación no es el lugar, es lo que se acumula
  dentro de él.

- **Ancho de página:** normal (`max-w-6xl`), **no** se agrega a `rutasAnchas`. A diferencia de la
  Torre, no hay mapa ni lienzo que necesite el viewport completo.
- **Metadata:** `title: "Preparación del día"`.

## 3. El contrato de datos, tal como llegó, y cómo lo leo

Dos fuentes:

**A. Visitas de hoy** — una fila por visita: conductor, bodega (nombre + comuna), seller, estado
(`abierta`/`cerrada`), hora de apertura y cierre, contadores vivos (total/resueltos/sin resolver),
hora del último escaneo, acta congelada (total/resueltos/sin resolver), y el conteo de bultos de
otro seller.

Leyendo la migración `20260813000004` con detalle, esto es exactamente lo siguiente en la base:

- Mientras `estado = 'abierta'`, las tres columnas del acta son **NULL a propósito** (comentario
  literal: *"un `not null default 0` mostraría '0 bultos' en una visita con 40 escaneados"*). Los
  "contadores vivos" de una visita abierta **no son una columna**: son un `COUNT(*)` sobre
  `operacion.bultos_retiro` agrupado por `sesion_retiro_id`, calculado en el momento.
- Al cerrar, `operacion.cerrar_sesion_retiro()` congela `bultos_total/resueltos/sin_resolver` en la
  fila de la sesión — **una sola vez**, dentro de una función `security definer`, precisamente
  para que no pueda quedar un acta a medias.
- Un bulto puede seguir llegando **después** del cierre (`posterior_al_cierre = true`, la cola sin
  conexión de la app drenando). Se guarda, pero el acta **no se recalcula nunca**. Por eso, para una
  visita cerrada, "vivos" puede ser mayor que "acta" — ver §7.

**B. Carga por comuna** — por comuna: total de bultos, cuántos ya con conductor asignado; fila
aparte "sin comuna conocida" (bultos no casados con ningún pedido).

Se agrupa por `pedidos.destinatario_comuna` — comuna de **destino**, no la de la bodega donde se
retiró. Los bultos con `pedido_id is null` (ilegibles y no procesados) van al cubo aparte; el
propio esquema ya los suma juntos: *"para el acta son lo mismo: bultos que subieron a la van sin
dueño conocido"*.

## 4. Jerarquía de información, y por qué en ese orden

De arriba hacia abajo, lo que responde cada bloque:

1. **Cabecera (H1 + una línea + indicador en vivo).** "¿Está viva esta pantalla?" — primero que
   nada, si el dato es de ahora o no.
2. **Franja de 4 magnitudes.** "¿Cómo va el día, de un vistazo?" — el read de 30 segundos. Sin
   esto, alguien tendría que contar tarjetas para saber si van 4 o 40 visitas.
3. **Visitas de hoy, con "En bodega ahora" primero.** "¿Hay algo que necesite que yo actúe *ahora*?"
   — es la única parte de la pantalla con algo parecido a una alarma (el reloj de inactividad), así
   que va antes que cualquier cosa puramente informativa. Dentro del bloque, "En bodega ahora" va
   antes que "De vuelta" porque lo que ya terminó no compite por atención con lo que sigue
   corriendo.
4. **Carga por comuna.** "¿Dónde estoy acumulando volumen?" — información de planificación, no de
   urgencia: importa, pero no compite con un conductor parado hace 20 minutos.
5. **Asignación (hueco).** "¿Qué hago con todo esto?" — el cierre natural del recorrido: mirar
   estado → mirar volumen → actuar. Va al final a propósito, y es donde entra la Etapa 6.

Este orden es el mismo en escritorio y en móvil — nunca diverge cuál bloque es "el primero" según
el ancho de pantalla: lo que cambia entre breakpoints es la maquetación, no la prioridad.

## 5. Los estados de la pantalla

Siete estados de primera clase, con el mismo criterio que ya usa `contexto/contrato-torre.ts`:
no son casos borde, son diseño.

### 5.1 `cargando`
Primera carga o navegación. Esqueleto con la forma final (§11) — nunca un spinner.

### 5.2 `sin_acceso`
**Copiar el bloque de `src/app/(tenant)/torre-de-control/page.tsx:43-58`** (mismo `ShieldAlert`,
mismo layout, mismo botón "Volver al inicio"), cambiando solo el texto:

- Título: `No tienes permiso para ver esta sección`
- Cuerpo: `Preparación del día es para el dueño, el supervisor y el coordinador de tráfico.`

### 5.3 `error_carga`
**No es un solo banner de página entera** — "Visitas de hoy" y "Carga por comuna" leen de
consultas distintas y pueden fallar por separado (mismo espíritu defensivo que `BandaTorre`: que un
módulo se caiga no debe tumbar el resto). Cada bloque maneja su propio error, con el patrón visual
de `manifiestos/page.tsx:131-135` (`role="alert"`, fondo `bg-destructive-subtle`):

- Bloque visitas: `No pudimos cargar las visitas de hoy. Intenta recargar la página.`
- Bloque comuna: `No pudimos cargar la carga por comuna. Intenta recargar la página.`

### 5.4 `arranque_vacio` — las 7 de la mañana
Cero visitas abiertas y cero cerradas. Es un **reemplazo completo** del contenido bajo la cabecera
(no se muestran franja de magnitudes en cero, ni "Carga por comuna" vacío, ni el hueco de
Asignación): cuatro ceros lado a lado se leen como "algo se rompió", no como "todavía no empezó el
día". Usa `<EmptyState>` (`src/components/ui/empty-state.tsx`), `tono="arranque"`, **sin acción**
— no hay nada que el coordinador pueda hacer desde aquí para "empezar" el retiro, lo abre el
conductor desde su app:

- Título: `Todavía no hay retiros hoy`
- Descripción: `Cuando un conductor abra una visita en la app, la vas a ver aquí, en vivo.`
- Subtítulo bajo el H1: `Ningún conductor ha abierto una visita todavía.`

### 5.5 `en_curso_tranquilo`
Hay al menos una visita abierta y ninguna pasó el umbral de inactividad (§6). Estado normal.

- Subtítulo: `{bultos} bultos retirados hasta ahora · {enBodega} conductores en bodega.`

### 5.6 `en_curso_con_avisos`
Igual, pero 1+ visitas abiertas superaron el umbral. Mismo mecanismo que `con_incidencias` en la
Torre: se nombra en la propia frase, sin alarmismo.

- Subtítulo: `{bultos} bultos retirados hasta ahora · {avisos} visitas sin novedades.`

### 5.7 `cierre_de_manana`
Cero visitas abiertas, 1+ cerradas — todos volvieron. "Carga por comuna" y "Asignación" siguen
mostrándose (de hecho ganan protagonismo: es el momento de asignar). Solo cambia el bloque "En
bodega ahora", que se retira y deja una sola línea:

- Subtítulo: `{bultos} bultos retirados en total · todos los conductores están de vuelta.`
- Línea en lugar de la lista de abiertas: `Todos los conductores ya volvieron.`

## 6. El reloj de inactividad

**El problema:** la pantalla se refresca por señal (cada escaneo dispara `router.refresh()`). Pero
un conductor que **dejó** de escanear no genera ningún evento, así que nada dispara un refresco, y
"hace 3 min" se queda literalmente congelado en 3 min para siempre si el cálculo se hace en el
servidor. El caso que más importa es justo el que menos señales produce.

**La solución: el reloj vive en el cliente, con su propio `setInterval`, independiente de
Realtime.** No es el mismo patrón que `frescura.edadMinutos` de la Torre (`cifras.tsx:105-109`) —
ese es un número que el servidor calcula una vez por render y se queda fijo hasta el próximo
refresco. Acá el problema es justamente que el próximo refresco puede no llegar nunca, así que
copiar ese patrón reproduciría el defecto.

**Diseño del componente** (leaf, mínimo de JS en cliente, mismo criterio que `IndicadorEnVivo` — el
resto de la tarjeta sigue siendo Server Component):

- Props: `ultimoEscaneoEn: string | null` (ISO), `abiertaEn: string` (ISO).
- Calcula `ultimaSenalEn = ultimoEscaneoEn ?? abiertaEn` — si todavía no hay ningún escaneo, la
  señal de vida es "cuándo llegó".
- Al montar, calcula y pinta inmediatamente (no espera el primer tick). Después recalcula cada
  **30 segundos**: ni cada segundo (ruido visual y de CPU sin necesidad, la unidad útil es el
  minuto) ni cada varios minutos (se sentiría atrasado).
- **Umbral: 10 minutos** desde `ultimaSenalEn`. El escaneo en bodega es en ráfaga (cooldown de
  ~800 ms por bulto); un conductor activo no genera silencios de varios minutos solo por acomodar
  cajas o hablar con el seller. Diez minutos es largo comparado con el ritmo real de escaneo y
  corto comparado con las ~5-6 horas de la ventana de retiro. Constante nombrada, mismo criterio
  que `UMBRAL_GEOCODING_RANCIO_MINUTOS = 15` y `UMBRAL_INCIDENCIA_SIN_GESTION_HORAS = 4` en
  `src/lib/ui/traduccion-estados.ts`: `UMBRAL_RETIRO_SIN_NOVEDADES_MINUTOS = 10`.
- **Formato:** `< 1 min` → "hace instantes"; `1 min` → "hace 1 min"; `2-59 min` → "hace N min";
  `>= 60 min` → "hace H h" o "hace H h M min" si M > 0.
- **Dos plantillas de copy cruzadas con dos estados de color — nunca más de estas cuatro
  combinaciones:**

  | | Bajo el umbral (gris, neutral) | Sobre el umbral (ámbar) |
  |---|---|---|
  | **Ya hay escaneos** | `Último escaneo hace {t}` | `Sin escaneos hace {t}` |
  | **Sin escaneos todavía** | `En la bodega hace {t}` | `Sin escaneos hace {t}, desde que llegó` |

- **Tratamiento visual:** el mismo grafismo de punto-de-color-más-texto que ya usa
  `lista-comunas.tsx:59-65` (`<span class="size-1.5 rounded-full bg-warning" />` + texto en
  `text-warning-subtle-foreground`), **nunca** un ícono de alerta ni un cambio de fondo de toda la
  tarjeta. El color nunca es el único canal: la palabra "Sin escaneos" ya lo dice.
- **Rojo: no.** Por muy tarde que se ponga (30, 60, 90 min), el tono se queda en ámbar. El rojo
  está reservado a la incidencia abierta y esto no es una incidencia — es una inferencia de la
  pantalla, no un hecho que alguien registró.
- **Sin botón de "atendido"/descartar.** La Etapa 5 no escribe nada; la acción del coordinador
  (llamar al conductor) ocurre fuera del sistema.
- **Solo aplica a visitas abiertas.** Al cerrar, el reloj se reemplaza por `Cerrada a las {hora}` —
  no hay "inactividad" que medir en algo que ya terminó.
- **Hora fija formateada en zona horaria de Santiago explícitamente**
  (`Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' })`),
  nunca la zona del navegador — un dueño mirando desde el teléfono en otro huso no debe ver una
  hora corrida.
- **Accesibilidad:** sin `aria-live` en el texto que cambia cada 30 s (sería ruidoso para lector de
  pantalla, a diferencia de `IndicadorEnVivo`, que sí lo usa pero para un cambio de estado
  infrecuente). Sí un `title` con la hora exacta del último escaneo, para quien necesite precisión.

**Prerrequisito, ya resuelto (2026-08-13):** el debounce de `indicador-en-vivo.tsx` no tenía tope
máximo, así que bajo ráfaga sostenida de escaneos —el caso real de una visita activa— la pantalla
**completa** dejaba de refrescarse mientras el indicador seguía diciendo "En vivo". Se extrajo a
`src/components/tiempo-real/programador-refresco.ts` (techo de 4 s) y está cableado, con prueba de
ráfaga y su contraprueba.

## 7. Vivos vs. acta

- **Visita abierta:** se muestra **solo** "vivos". Nunca se usa la palabra "acta" para una visita
  abierta — no existe todavía (la columna es NULL por diseño). Texto: `{total} escaneados`, y
  debajo, **solo si `sinResolver > 0`**, `{N} sin pedido` en tono neutro.
- **Visita cerrada:** el acta como cifra principal: `Acta: {total} bultos`, y debajo, solo si
  aplica, `{N} sin pedido`. Más `Cerrada a las {hora}`.
- **Cuándo vivos ≠ acta:** si para una visita cerrada el conteo vivo es mayor que el acta congelada
  (llegó un escaneo tarde, cola sin conexión drenando), se agrega **una línea aparte, en tono
  neutro** — no ámbar, no rojo: esto es comportamiento esperado del sistema, no un problema:

  `+ {N} escaneados después de cerrar · no se suman al acta`

  El "no se suman al acta" va explícito en el texto y no solo en un tooltip: es lo que le quita a
  este número toda apariencia de descuadre. Nunca se reescribe el número del acta en pantalla ni se
  hace un total ad-hoc sumando vivos y acta — son dos hechos distintos y se presentan como tales.

## 8. El bulto de otro seller

Un bulto puede resolverse contra un pedido cuyo `seller_id` **no** coincide con el seller dueño de
la bodega visitada — exactamente el descuadre que el retiro existe para destapar.

- Una línea adicional en la tarjeta de la visita (abierta o cerrada), **solo si el conteo es mayor
  que cero** (silencio por defecto): `{N} bultos de otro seller`, en `text-muted-foreground`, sin
  color de alerta y sin ícono. No es una incidencia — es información operativa para que el
  coordinador la resuelva físicamente en el piso de la bodega.
- **Sin drill-down en la Etapa 5** (qué bultos exactos, de qué seller). El contrato es a nivel de
  visita; forzar el detalle por bulto solo para este caso sería sobre-construir.
- Un bulto **sin resolver** no cuenta como "de otro seller": de un código que no se pudo casar no
  se sabe de quién es, y contarlo sería una atribución inventada.

## 9. Wireframe conceptual — escritorio (>=1024px)

Dos columnas: izquierda más ancha (visitas, lo que pide atención), derecha angosta (carga +
asignación, lo que pide planificación) — mismo ritmo visual que la Torre, sin ser la misma pantalla.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Preparación del día                                            ● En vivo     │
│ 84 bultos retirados hasta ahora · 2 visitas sin novedades                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ Bultos retirados hoy   En bodega ahora   De vuelta      Sin novedades        │
│        84                    4               3               2              │
│                                                                              │
│ 6 bultos no se pudieron identificar todavía.                                 │
├─────────────────────────────────────────────────────┬────────────────────────┤
│ VISITAS DE HOY                                      │ CARGA POR COMUNA       │
│                                                     │                        │
│ En bodega ahora (4)                                 │ Ñuñoa            142   │
│ ┌────────────────────┐ ┌────────────────────┐       │  86 asignados ·        │
│ │ Pedro Soto         │ │ Juan Pérez         │       │  56 por asignar        │
│ │ Bodega Andes Norte │ │ Bodega Andes Sur   │       │ ─────────────────      │
│ │ · Renca            │ │ · Ñuñoa            │       │ Providencia       98   │
│ │ Comercial Andes    │ │ Comercial Andes    │       │  40 asignados ·        │
│ │                    │ │                    │       │  58 por asignar        │
│ │ 12 escaneados      │ │ 37 escaneados      │       │ ─────────────────      │
│ │ • Sin escaneos     │ │ Último escaneo     │       │ Renca             44   │
│ │   hace 14 min      │ │   hace 2 min       │       │  12 asignados ·        │
│ └────────────────────┘ └────────────────────┘       │  32 por asignar        │
│ ┌────────────────────┐ ┌────────────────────┐       │ ─────────────────      │
│ │ María Rojas        │ │ Diego Vera         │       │ Sin comuna         6   │
│ │ ...                │ │ ...                │       │ conocida               │
│ └────────────────────┘ └────────────────────┘       │  No se identificaron   │
│                                                     │  contra ningún pedido. │
│ De vuelta (3)                                       ├────────────────────────┤
│ ┌────────────────────┐ ┌────────────────────┐       │ ASIGNACIÓN             │
│ │ Ana Muñoz          │ │ ...                │       │                        │
│ │ Bodega Full Import │ │                    │       │ Cuando tengas          │
│ │ · Quilicura        │ │                    │       │ suficiente carga en    │
│ │ Full Import SpA    │ │                    │       │ una zona, arma la      │
│ │                    │ │                    │       │ asignación desde       │
│ │ Acta: 58 bultos    │ │                    │       │ Manifiestos.           │
│ │ 6 sin pedido       │ │                    │       │                        │
│ │ Cerrada a las 10:47│ │                    │       │  [ Ir a manifiestos ]  │
│ └────────────────────┘ └────────────────────┘       │                        │
└─────────────────────────────────────────────────────┴────────────────────────┘
```

## 10. Wireframe conceptual — móvil (<1024px, el que mira el dueño)

Una sola columna, mismo orden de arriba hacia abajo que en escritorio. La barra superior con
hamburguesa (`h-14`, sticky) ya la provee `AppShell` — nada nuevo que construir ahí.

```
┌───────────────────────────┐
│ ☰   Rutax                 │  ← AppShell, existente
├───────────────────────────┤
│ Preparación del día       │
│ 84 bultos retirados hasta │
│ ahora · 2 visitas sin     │
│ novedades        ● En vivo│
├───────────────────────────┤
│ Retirados hoy   En bodega │
│      84             4     │
│                           │
│ De vuelta   Sin novedades │
│      3            2       │
│                           │
│ 6 bultos no se pudieron   │
│ identificar todavía.      │
├───────────────────────────┤
│ VISITAS DE HOY            │
│                           │
│ En bodega ahora (4)       │
│ ┌───────────────────────┐ │
│ │ Pedro Soto            │ │
│ │ Bodega Andes Norte ·  │ │
│ │ Renca                 │ │
│ │ Comercial Andes       │ │
│ │                       │ │
│ │ 12 escaneados         │ │
│ │ • Sin escaneos hace   │ │
│ │   14 min              │ │
│ └───────────────────────┘ │
│ ┌───────────────────────┐ │
│ │ Juan Pérez  ...       │ │
│ └───────────────────────┘ │
│          ⋮ (scroll)       │
│                           │
│ De vuelta (3)             │
│ ┌───────────────────────┐ │
│ │ Ana Muñoz             │ │
│ │ Bodega Full Import ·  │ │
│ │ Quilicura             │ │
│ │ Full Import SpA       │ │
│ │                       │ │
│ │ Acta: 58 bultos       │ │
│ │ 6 sin pedido          │ │
│ │ Cerrada a las 10:47   │ │
│ └───────────────────────┘ │
│          ⋮ (scroll)       │
├───────────────────────────┤
│ CARGA POR COMUNA          │
│                           │
│ Ñuñoa                 142 │
│  86 asignados · 56 por    │
│  asignar                  │
│ ────────────────────────  │
│ Providencia            98 │
│  40 asignados · 58 por    │
│  asignar                  │
│          ⋮ (scroll)       │
│ Sin comuna conocida     6 │
│  No se identificaron      │
│  contra ningún pedido.    │
├───────────────────────────┤
│ ASIGNACIÓN                │
│                           │
│ Cuando tengas suficiente  │
│ carga en una zona, arma   │
│ la asignación desde       │
│ Manifiestos.              │
│                           │
│  [   Ir a manifiestos   ] │
└───────────────────────────┘
```

**Provisión de escala** (prevista, no construida en la Etapa 5): si "De vuelta" supera 8 tarjetas,
colapsarla por defecto a una línea `Ver las {N} visitas cerradas` — disclosure puramente de
cliente, sin fetch nuevo, los datos ya están cargados. Mantiene arriba lo que de verdad pide
atención, incluso con la flota completa de vuelta. **No aplica a "En bodega ahora"**: esa lista
nunca se colapsa, es la que hay que poder barrer entera de un vistazo.

## 11. `loading.tsx` — esqueleto con la forma final

Mismo principio que `torre-de-control/loading.tsx` y `operaciones/loading.tsx`: **nunca un
spinner**, la forma final con `<Skeleton>`.

```
[Skeleton h-6 w-56]                         título
[Skeleton h-4 w-80]                         subtítulo
──────────────────────────────────────────
[Skeleton x4, en fila, divide-x]            franja de magnitudes
──────────────────────────────────────────
┌─────────────────────────┬────────────────┐
│ [Skeleton h-5 w-32]     │ [Skeleton      │
│ [Skeleton card x4]      │  h-5 w-32]     │
│  (h-28 cada una,        │ [Skeleton      │
│   grid 2 columnas)      │  list row x5]  │
│                         │                │
│ [Skeleton h-5 w-24]     │ [Skeleton      │
│ [Skeleton card x2]      │  CTA block]    │
└─────────────────────────┴────────────────┘
```

## 12. Dónde entra la Asignación (el hueco de la Etapa 6)

**La Etapa 5 no escribe nada — este bloque hoy es un enlace de salida, no una funcionalidad.**

- Encabezado: `Asignación`
- Cuerpo: `Cuando tengas suficiente carga en una zona, arma la asignación desde Manifiestos.`
- Botón único: `Ir a manifiestos` → `/manifiestos`.

**Por qué el enlace es genérico y no un enlace profundo por comuna:** el flujo actual de asignación
es *conductor-primero* — se crea un manifiesto eligiendo un conductor (`/manifiestos/nuevo`, sin
campo de comuna) y **recién ahí** se filtran pedidos por comuna dentro de él. No existe hoy un
manifiesto "de la comuna X" al que enlazar directo, y podría haber cero, uno o varios borradores
abiertos a la vez. Inventar una heurística ("si hay exactamente un borrador de hoy, entra directo;
si no, cae a la lista") es justo el tipo de lógica frágil que la Etapa 6 va a reemplazar de raíz:
`retiro-y-ruteo.md` §4 ya dice que ahí "el manifiesto pasa a ser subproducto de la asignación, no
paso previo". Construir un puente inteligente ahora para tirarlo en semanas no vale el esfuerzo.

**Lo que queda listo para la Etapa 6:** el bloque "Asignación" ya tiene su lugar fijo (columna
derecha en escritorio, al final en móvil, justo después de "Carga por comuna"). Cuando llegue la
selección múltiple, este mismo espacio se convierte en la barra de selección con contador vivo —
no hace falta mover nada de la jerarquía, solo reemplazar el contenido del bloque.

## 13. Glosario de textos exactos

**Cabecera**

| Estado | Subtítulo |
|---|---|
| `arranque_vacio` | Ningún conductor ha abierto una visita todavía. |
| `en_curso_tranquilo` | {bultos} bultos retirados hasta ahora · {enBodega} conductores en bodega. |
| `en_curso_con_avisos` | {bultos} bultos retirados hasta ahora · {avisos} visitas sin novedades. |
| `cierre_de_manana` | {bultos} bultos retirados en total · todos los conductores están de vuelta. |
| `error_carga` | No pudimos cargar el estado de hoy. |

Pluralización explícita (mismo criterio que `cifras.tsx`): 1 → singular; 0 o >=2 → plural. Nunca un
`(s)` literal en pantalla. Ej.: `1 bulto retirado hasta ahora · 1 conductor en bodega.`

**Franja de magnitudes**
`Bultos retirados hoy` (destacada) · `En bodega ahora` · `De vuelta` · `Sin novedades` (en ámbar
solo si > 0, mismo tratamiento que "Cerca del corte" en `cifras.tsx:80-88`).

Nota condicional, solo si hay bultos sin pedido en el total del día:
`{N} bultos no se pudieron identificar todavía.`

**Visitas de hoy**
- Encabezado de sección: `Visitas de hoy`
- Subgrupos: `En bodega ahora ({N})` · `De vuelta ({N})`
- Línea de reemplazo cuando "En bodega ahora" queda vacío: `Todos los conductores ya volvieron.`
- Tarjeta abierta: `{total} escaneados` · condicional `{N} sin pedido` · reloj (§6) · condicional
  `{N} bultos de otro seller`
- Tarjeta cerrada: `Acta: {total} bultos` · condicional `{N} sin pedido` · `Cerrada a las {hora}` ·
  condicional `+ {N} escaneados después de cerrar · no se suman al acta` · condicional `{N} bultos
  de otro seller`

**Carga por comuna**
- Encabezado: `Carga por comuna`
- Descripción: `Bultos ya retirados, agrupados por comuna de destino.`
- Fila: `{comuna}` — `{total} bultos` / `{asignados} asignados · {porAsignar} por asignar`
- Fila especial (solo si > 0, siempre al final): `Sin comuna conocida` — `{total} bultos` / `No se
  identificaron contra ningún pedido.`
- Vacío de sección, sin ser `arranque_vacio` global (p. ej. hay visitas abiertas sin escaneos
  todavía): `Todavía no hay bultos retirados.`

**Asignación**
`Asignación` / `Cuando tengas suficiente carga en una zona, arma la asignación desde Manifiestos.`
/ botón `Ir a manifiestos`

**Sin acceso**
`No tienes permiso para ver esta sección` / `Preparación del día es para el dueño, el supervisor y
el coordinador de tráfico.` / botón `Volver al inicio`

**Errores de carga**
`No pudimos cargar las visitas de hoy. Intenta recargar la página.`
`No pudimos cargar la carga por comuna. Intenta recargar la página.`

**Arranque vacío**
`Todavía no hay retiros hoy` / `Cuando un conductor abra una visita en la app, la vas a ver aquí,
en vivo.`

## 14. Qué queda fuera, a propósito

- **Cualquier escritura desde esta pantalla** — abrir/cerrar visitas, resolver bultos a mano,
  regenerar QR. Todo eso vive en la app del conductor o en pantallas futuras con su propio RBAC.
- **La asignación en bloque interactiva** (Etapa 6) — solo el hueco, descrito en §12.
- **Traspaso entre conductores** (Etapa 9) y **cierre de jornada** (Etapa 10) — flujos propios.
- **"Cuántos faltan por retirar".** No se puede calcular sin mentir: un seller despacha con varios
  couriers, la ingesta de ML entrega **candidatos** y no una lista comprometida, y un faltante
  medido contra candidatos ajenos es una alarma falsa. Una alarma falsa recurrente entrena al
  coordinador a ignorar la pantalla. La pantalla cuenta **lo que entró**, nunca lo que "debería"
  haber entrado.
- **Mapa.** A diferencia de la Torre, no hay geometría que dibujar aquí. Es intencional, no un
  recorte por tiempo.
- **La "regla del punto de salida"** (cuánto conviene esperar antes de salir a repartir) —
  `retiro-y-ruteo.md` §2.2 la marca como "para educar al courier, no para construir".
- **Notificación push/SMS/WhatsApp cuando algo se estanca.** Esta pantalla es *pull* y no *push*,
  coherente con `retiro-y-ruteo.md` §9 ("No hay WhatsApp, SMS ni push. Cero"). El aviso vive
  únicamente en la tarjeta, en ámbar, cuando el coordinador mira.
- **Vista histórica** (visitas de días anteriores). Esta pantalla es exclusivamente "hoy".
- **El seller no ve nada de esto.** Ya impuesto por RLS: `sesiones_retiro_select` y
  `bultos_retiro_select` le devuelven cero filas por diseño. No hace falta filtro adicional.
- **Desglose por fuente (Flex vs. same-day) en "Carga por comuna".** Mismo criterio que el
  manifiesto multi-cuenta: mostrarlo solo si hay pluralidad real. Hoy el piloto no tiene ni un
  pedido same-day en producción, así que el desglose sería una columna de ceros.
- **Cuenta ML de origen por pedido.** La unidad de esta pantalla es la visita y la comuna, no el
  pedido individual — esa distinción ya vive en `/operaciones`.

## 15. Dónde el contrato de datos quedaba corto

Cuatro puntos que salieron del diseño. Los dos primeros ya están resueltos; los dos últimos son
trabajo aparte.

**A. "Bulto de otro seller" no estaba en el contrato.** ✅ **Resuelto:** se agregó
`bultos_de_otro_seller` a `operacion.preparacion_visitas_del_dia`. Sin esa columna la pantalla
tendría que traerse el detalle bulto por bulto solo para poder contar, que es justo lo que estas
funciones existen para evitar.

**B. El enlace `/manifiestos/[id]/asignar` no se puede armar sin un id.** ✅ **Resuelto** en §12:
se enlaza a `/manifiestos`. El enunciado original suponía conocer un `id` que hoy no hay forma
limpia de determinar desde esta pantalla, porque el flujo de creación de manifiesto es
conductor-primero y no acepta comuna como parámetro.

**C. ⚠️ Defecto real, confirmado en código (2026-08-13), no de diseño.** Un bulto que se resuelve
contra un pedido **después** de que su visita cerró queda guardado (`posterior_al_cierre = true`,
`pedido_id` puesto) — pero **nada llama a `operacion.resolver_bulto_retiro()`** para propagar eso a
`operacion.pedidos.situacion_retiro`. Esa función existe exactamente para este caso (su propio
comentario: *"un escaneo que se resuelve 20 minutos después del cierre... no pasa por
`cerrar_sesion_retiro` y su pedido se quedaría en `pendiente` para siempre"*) y su único llamador
en todo el repo es su propia prueba.

Consecuencia directa sobre esta pantalla y la siguiente: el bulto **sí** cuenta en "Carga por
comuna" (cuelga del bulto), pero su pedido **no** llega nunca a `retirado`, así que no aparecerá en
la bandeja de asignación de la Etapa 6, que se apoya en ese campo. Dos pantallas vecinas con
números que no cuadran, y el caso no es raro: la señal en bodega es mala y la cola drena cuando el
conductor sale. Se arregla en backend, no se disimula en el diseño.

**D. "Ya tiene conductor asignado" en Carga por comuna.** Resuelto usando
`pedidos.driver_id_asignado`, la columna denormalizada, y **no** `asignaciones_pedido.activa`, que
arrastra la deuda conocida de no apagarse nunca al entregar.

## 16. Criterios de aceptación para `frontend`

- [ ] Ruta `src/app/(tenant)/preparacion/page.tsx` + `loading.tsx`, dentro del `AppShell`,
      `max-w-6xl` normal (no en `rutasAnchas`).
- [ ] Gate de capacidad `puedeVerPreparacionDia` en la página **y** en el ítem de navegación de
      `(tenant)/layout.tsx`.
- [ ] `IndicadorEnVivo` con `tablas={[{schema:'operacion', tabla:'sesiones_retiro'}, {schema:
      'operacion', tabla:'bultos_retiro'}, {schema:'operacion', tabla:'pedidos'}]}`.
- [ ] "Carga por comuna" viene de la agregación **en la base**, nunca de un `reduce` en memoria
      sobre una consulta paginada — a volumen real (1.000+/día) una cuenta truncada en silencio
      rompería la confianza en la cifra más grande de la pantalla.
- [ ] Reloj de inactividad como componente cliente aislado (`'use client'` solo en esa hoja, igual
      que `IndicadorEnVivo`; el resto de la tarjeta se mantiene Server Component), con
      `setInterval` de 30 s, umbral `UMBRAL_RETIRO_SIN_NOVEDADES_MINUTOS = 10`, y limpieza en el
      cleanup del efecto.
- [ ] Hora de cierre formateada con `timeZone: 'America/Santiago'` explícito, nunca la zona horaria
      del navegador.
- [ ] Ningún dato personal del destinatario (`destinatario_nombre`/`_direccion`/`_telefono`) en
      ninguna tarjeta ni fila — solo comuna y código visible del bulto.
- [ ] Nunca mostrar el string crudo del QR ni nada de `bultos_retiro_qr` (tabla deny-all).
- [ ] Rojo reservado exclusivamente a la incidencia abierta — no hay ninguna en esta pantalla en la
      Etapa 5. El aviso de inactividad usa ámbar (`bg-warning`/`text-warning-subtle-foreground`),
      sin importar cuánto tiempo pase.
- [ ] "Sin pedido", "de otro seller" y "escaneado después de cerrar" en tono neutro
      (`text-muted-foreground`) — nunca ámbar ni rojo: son hechos normales de la operación, no
      alarmas.
- [ ] Números con `tabular-nums`, mismo criterio que toda cifra que se refresca en vivo (evita que
      el número salte de ancho en cada actualización).
- [ ] Pluralización explícita en todo texto con conteo.
- [ ] `loading.tsx` con `<Skeleton>` replicando la forma final de dos columnas (§11).
- [ ] Nombres resueltos por la propia función de agregación (vienen ya en el contrato): no volver a
      consultar conductor ni seller desde la pantalla.
