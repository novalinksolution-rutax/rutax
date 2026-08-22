# Rediseño de Rutax — prompts para Claude Design

⚠️ **Este archivo es el manual. No se pega ni se adjunta a Claude Design.** Contiene los prompts
—en bloques de código, para copiar— más las instrucciones que son para ti.

**Solo se adjuntan dos archivos en todo el proceso**: `RUTAX-INVENTARIO.md` en la pasada 1·B y
`REFERENCIAS-LANDING.md` en la pasada 5. Todo lo demás viaja en el hilo de la conversación. Los ocho `ANEXO-*.md` de esta carpeta son consulta
opcional: se adjuntan solo si un bloque concreto necesita el detalle literal de una pantalla.

---

## Empezar — los primeros veinte minutos

1. **Abre Claude Design y crea un proyecto en blanco.** No importes el sistema de diseño desde el
   repositorio y no conectes el repositorio. Lo que existe hoy en el frontend es justo lo que se
   está reemplazando.
2. **Modelo Opus 5, esfuerzo máximo.**
3. **Crea `FICHAS-DE-CIERRE.md`** en esta misma carpeta, vacío. Ahí vas pegando lo que devuelva cada
   pasada, una debajo de otra. Es tu única red si el hilo se corta.
4. **Copia el bloque de `▼ PASADA 1·A` y pégalo. Sin adjuntar nada.** Te va a devolver tres rutas de
   marca.
5. **Elige una.** No sigas sin elegir: todo el lenguaje visual cuelga de esa decisión. Antes de
   elegir, mira el favicon a 16 px, el ícono en la pantalla de inicio de un teléfono, y cómo se ve
   en monocromo — una marca que solo funciona grande no le sirve a este producto.
6. **En el mismo hilo**, copia `▼ PASADA 1·B`, adjunta `RUTAX-INVENTARIO.md`, y empieza el mensaje
   diciendo qué ruta elegiste. Ahí sale el sistema completo.
7. **Guarda la ficha de cierre** y sigue con la pasada 2, en el mismo hilo.

De ahí en adelante: pasada 2 (siete arquetipos), pasada 3 (ocho bloques, **un mensaje por bloque**),
pasada 4 (mensajes), pasada 5 (sitio, adjuntando `REFERENCIAS-LANDING.md`), pasada 6 (código, ya
fuera de Design).

### Los cinco errores que arruinan esto

1. **Abrir sesión nueva sin necesidad.** Es el más caro y el más fácil de cometer. Quédate en el
   mismo hilo mientras aguante; si tienes que cambiar, hazlo entre pasadas o entre bloques, nunca a
   mitad de uno, y usa el preámbulo de re-anclaje con todas las fichas.
2. **Pegar este archivo.** Es el manual, tiene notas que son para ti. Solo se pegan los bloques
   marcados `▼`.
3. **Saltarse la elección de marca** y dejar que avance con las tres abiertas.
4. **Mandar los ocho bloques de la pasada 3 en un mensaje.** Uno por uno.
5. **No guardar la ficha de cierre.** El día que se corte el hilo, es lo único que tienes.

---

## Las pasadas

| # | Qué produce | Esfuerzo | Adjuntar |
|---|---|---|---|
| **1·A** | Tres rutas de marca. **Eliges una antes de seguir.** | máximo | nada |
| **1·B** | El sistema: lenguaje visual, componentes, estados, objetos, voz, impresos | máximo | `RUTAX-INVENTARIO.md` |
| **2** | Siete pantallas arquetipo | máximo | nada nuevo |
| **3** | El resto de las pantallas, por bloques | alto | nada nuevo |
| **4** | El volumen del sistema de mensajes | alto | nada nuevo |
| **5** | El sitio público comercial | alto | `REFERENCIAS-LANDING.md` |
| **6** | Bajada al código | — | se hace en Claude Code. **No hay comando: el puente es manual** |

**Modelo: Opus 5 en todas.** La 1 y la 2 son tareas de criterio, no de ejecución. En la 3 el riesgo
no es dibujar mal una pantalla, es no darse cuenta de que la estructura heredada estaba mal
agrupada — que es precisamente el encargo.

---

## Lo más importante de todo: no cambies de sesión

Claude Design guarda el sistema de diseño en el proyecto, pero **las decisiones de cada pasada viven
en el hilo de la conversación**. Si abres un chat nuevo y pegas el prompt siguiente sin más, no sabe
qué se decidió antes y vuelve a inventar.

**Haz todas las pasadas en el mismo hilo mientras el hilo aguante.** La ficha de cierre es la red
para cuando no queda otra, no el camino normal: una ficha de una página siempre pierde detalle
contra la conversación completa. Si tienes que cambiar de sesión, hazlo **entre pasadas o entre
bloques, nunca a mitad de uno**.

### La ficha de cierre

Ya viene incluida al final de cada prompt. Guarda cada respuesta en un archivo acumulado —
`FICHAS-DE-CIERRE.md` — una debajo de otra, en orden. Ese archivo es tu única red de continuidad.

### El preámbulo de re-anclaje

Solo si abriste sesión nueva. Va **antes** del prompt de la pasada, con las fichas pegadas debajo:

```
Estamos rediseñando la interfaz completa de Rutax, un SaaS de última milla para Santiago de
Chile. Este trabajo viene de sesiones anteriores y NO empieza de cero.

Abajo van las fichas de cierre de todo lo que ya se hizo: la marca, el sistema de diseño, sus
componentes, el registro de objetos de dominio y las pantallas ya resueltas. Léelas como el
estado actual del proyecto, no como una sugerencia.

Reglas de continuidad, y son duras:
- Reutiliza los componentes y variantes que ya existen, con los mismos nombres.
- Los objetos de dominio del registro NO se rediseñan. Si esta pantalla necesita una variante
  nueva de un objeto que ya está en el registro, derívala de la canónica y decláralo.
- No rediseñes nada de lo que ya está resuelto, ni "de paso" ni para que combine.
- No inventes patrones nuevos. Si algo no existe todavía, dilo y propónmelo ANTES de usarlo.
- Ante cualquier duda de estilo o disposición, resuélvela como la resolvieron las pantallas
  anteriores, no como te parezca mejor ahora.

Si algo de las fichas te resulta ambiguo, pregúntame antes de diseñar. Prefiero responder una
pregunta a recibir una pantalla que no calza con el resto.

--- FICHAS DE LAS SESIONES ANTERIORES ---

[Pega aquí todas las fichas acumuladas, en orden]

--- FIN DE LAS FICHAS ---
```

### Antes de empezar

Crea un proyecto en blanco. **No importes el sistema de diseño desde el repositorio y no conectes
el repositorio.** El frontend actual de Rutax es exactamente lo que se está reemplazando, y esa
importación anclaría el resultado a lo que queremos botar.

---

# ▼ PASADA 1·A — La marca

> Sin adjuntos. Esfuerzo: **máximo**. **No sigas a la 1·B hasta haber elegido una ruta.**
> El lenguaje visual entero cuelga de esta decisión: la paleta, la tipografía y hasta la densidad
> se derivan de la marca, no al revés.

```
Vas a diseñar la identidad de marca de Rutax, un SaaS B2B vertical para empresas de última milla
—"couriers"— en Santiago de Chile. Después, en un mensaje aparte, construiremos sobre ella el
sistema de diseño de todo el producto. Ahora solo la marca.

QUÉ HACE EL PRODUCTO
El courier recibe pedidos desde varias fuentes (Mercado Libre Flex, Shopify y pedidos same-day
propios), los despacha con su flota, y cierra su trastienda de dinero: cada entrega genera sola su
línea de cobro al seller y su línea de liquidación al conductor, conciliadas entre sí. Es
multi-tenant: cada courier es un cliente, y dentro de él viven sellers y conductores que solo ven
lo suyo.

QUIÉN LA VA A VER
Siete perfiles en mundos distintos, y la marca tiene que servirlos a todos:
- El COORDINADOR, que reparte cientos de bultos de pie en una bodega contra un despacho que sale a
  las 16:00 en punto.
- El SUPERVISOR, que aparece cuando algo se rompió: incidencias, reasignaciones, apagar incendios.
- ADMINISTRACIÓN, que cierra el mes con el Servicio de Impuestos en frente y cuya herramienta
  natural es la planilla de cálculo.
- El DUEÑO, que entra poco, decide mucho y firma las facturas irreversibles.
- El SELLER, que es cliente del courier y no eligió este software: se lo impusieron. Si le parece
  malo, culpa a su courier.
- El CONDUCTOR, en la calle, con una mano ocupada y sol directo en la pantalla.
- El SUPER-ADMIN de Rutax, el único que ve datos de varias empresas a la vez.

Y un octavo que no tiene cuenta: el comprador final, que recibe un enlace de seguimiento con el
estado de su pedido. Es el único que llega a una pantalla de Rutax sin ser usuario de nadie.

⚠️ **Y esa pantalla NO lleva la marca de Rutax como protagonista.** Va marcada con la del COURIER
—es quien entrega y quien paga el software— y Rutax aparece abajo, como un discreto "powered by".
Eso le impone dos exigencias concretas al símbolo que diseñes:
1. **Tiene que funcionar pequeño, secundario y al lado de otra marca que no controlamos** — la de un
   courier cualquiera, que puede ser fea, del color que sea, o no existir. Un símbolo que solo se
   sostiene siendo protagonista no sirve acá.
2. Es el ÚNICO canal de Rutax hacia consumidores finales: cada entrega genera una impresión. Diseña
   ese "powered by" como pieza, no como una línea de pie olvidada.

Un dato de realidad que condiciona el diseño: hoy el sistema **no guarda ningún logo del courier** —
solo su nombre de fantasía en texto. Así que esa pantalla tiene que verse bien con solo un nombre,
y el logo del courier ser una mejora opcional, no el supuesto.

QUÉ TIENE QUE SENTIR EL DUEÑO DE UN COURIER — exactamente dos ideas, y estas:
1. INSTRUMENTO DE TRABAJO: preciso, sin adornos, una herramienta que aguanta el turno.
2. INFRAESTRUCTURA FINANCIERA: la plata cuadra, esto es serio ante el Servicio de Impuestos.
   Esa segunda es el foso del producto: el motor entrega→dinero es el centro, no un accesorio.

LO QUE LA MARCA NO ES:
- No es "control del reloj". Es cierto que este courier trabaja contra un horario, pero ese es un
  detalle operativo de UN cliente, no la identidad de un producto de categoría. Una marca construida
  sobre él caduca el día que ese courier cambie su hora de corte, y no le dice nada al siguiente.
- No es identidad nacional chilena. Hay techo: multi-país está declarado como dirección futura, y
  una marca folclórica no viaja.
- No se define por oposición a nadie. Rutax no compite contra una app de rutas ni contra Mercado
  Libre: reemplaza una forma de trabajar hecha de piezas sueltas — la planilla de cálculo, el
  WhatsApp del jefe, una app de rutas a la que hay que digitarle cada dirección a mano, y el
  cuaderno donde se anota a quién pagarle.

QUÉ QUIERO
Tres rutas de marca DISTINTAS entre sí — distintas en idea, no tres variaciones del mismo dibujo.
Para cada una:
- El símbolo y el logotipo, en sus versiones: completa, reducida y solo símbolo, con sus tamaños
  mínimos.
- Una línea que diga qué idea del negocio representa y contra cuál de las dos ideas de arriba
  responde.
- Su comportamiento sobre fondo claro, sobre fondo oscuro y en monocromo. El monocromo no es un
  extra: la etiqueta de envío se imprime en una térmica en blanco y negro y a baja resolución.
- Sus aplicaciones críticas, para poder juzgarla de verdad: favicon a 16 px, ícono de la app del
  conductor en la pantalla de inicio de un teléfono, encabezado del producto, firma de correo,
  imagen para compartir en mensajería, y la marca impresa en una etiqueta térmica de 10x15 cm.
- La dirección cromática y tipográfica que esa ruta implicaría para el producto entero — sin
  desarrollarla todavía, solo lo suficiente para que yo entienda a qué me estoy comprometiendo.

El nombre "Rutax" se conserva. Hoy no hay marca instalada que perder: los dos archivos de logo que
existen en el repositorio no los importa ni un solo archivo del producto.

Preséntalas para comparar, di cuál recomiendas y por qué, y espera mi elección antes de seguir.
```

---

# ▼ PASADA 1·B — El sistema

> Adjunta `RUTAX-INVENTARIO.md`. Esfuerzo: **máximo**. Mismo hilo que la 1·A.

```
Elegí la ruta de marca [N]. Construye sobre esa.

Adjunto el inventario funcional completo de Rutax. Quiero rediseñar su interfaz completa desde
cero. Lo que existe hoy en el frontend se considera desechable: no lo tomes como referencia, no
está en el documento y no quiero que lo reconstruyas. Lo no negociable es la función, los estados
posibles y las reglas duras de la sección 2 del inventario.

## Encuadre — respondido por adelantado, no preguntes

- No conectes el repositorio y no lo pidas. El inventario ya destiló ese código.
- Idioma: español de Chile en todo el copy y en toda la documentación. Los nombres de tokens, en
  inglés, porque conviven con Tailwind.
- Tratamiento: TÚ en todo el producto, incluidos los correos. USTED solo en lo tributario y legal:
  la factura electrónica, la liquidación del conductor, los términos y la política de privacidad.
  La regla que separa: si lo firma la empresa ante un tercero, es usted; si es una conversación
  con el usuario, es tú. No se mezclan las dos formas en una misma pieza.
- En esta pasada NO diseñes pantallas todavía. Necesito el sistema que las va a sostener.

## 1. EL LENGUAJE VISUAL Y DE INTERACCIÓN

Propón el sistema completo derivado de la marca elegida: color, tipografía, escala, espaciado,
radio, elevación, iconografía, densidad y movimiento. Justifica cada decisión contra el contexto de
uso, que es muy distinto según la superficie:

- Backoffice del courier: NO es una aplicación de escritorio y NO tiene un solo usuario. Escritorio,
  tablet y teléfono, según dónde esté esa persona en el día. Y dentro conviven **cuatro perfiles con
  días completamente distintos** — tratarlos como "el usuario interno" es el error más fácil de
  cometer acá:
  · **Coordinador**: de pie en la bodega en la mañana, en el escritorio desde las 16:00. Tablas
    densas, filtros, selección masiva, contra un reloj. Su enemigo es el clic de más.
  · **Supervisor**: el más reactivo del producto, aparece cuando algo se rompió. Incidencias y
    monitoreo. ⚠️ **Casi siempre entra por un aviso, no navegando**, así que aterriza en el medio del
    producto y no por la puerta: cada pantalla tiene que poder explicarse sola.
  · **Administración**: el que más horas pasa en pantallas de dinero y el que menos aparece en las
    conversaciones de producto. Cierra períodos, emite documentos tributarios, concilia, paga.
    Meticuloso por oficio, revisa dos veces, desconfía de la cifra que no puede rastrear.
    ⚠️ **Su herramienta natural es la planilla de cálculo, y ahí está la competencia real de estas
    pantallas**: si no puede cuadrar un total y ver de dónde salió cada peso, exporta a Excel y el
    producto perdió. Diseña para que no necesite exportar.
  · **Dueño**: entra poco, decide mucho, a veces desde el teléfono un domingo. Necesita saber en
    cinco segundos si el día va bien, y una vía directa a lo que esté mal. Su miedo es enterarse
    tarde.
- Portal del seller: visitas cortas y esporádicas, casi siempre desde el teléfono y entre otras
  cosas, porque está atendiendo su propia tienda. No sabe de logística ni quiere saber. Su único
  trayecto crítico es arreglar solo una cuenta desconectada, sin llamar a nadie.
  ⚠️ **Y el matiz que gobierna esta superficie entera: él no eligió Rutax, se lo impuso su courier.**
  Si la experiencia es mala, culpa al courier. Este portal es la cara del courier ante su cliente,
  no la de Rutax.
- App nativa del conductor: teléfono, en la calle, una mano, sol directo, a veces con guantes,
  señal intermitente, batería baja, contra un reloj de ~12 minutos por parada. Hay UNA sola app del
  conductor y es nativa: no existe versión web. **No maneja trabajo sin conexión**: cuando no hay
  señal reintenta sola en segundo plano y se lo dice; si cierra la app, ese registro se pierde. Ese
  estado intermedio —"registrado, todavía sin confirmar"— necesita su tratamiento visual y no puede
  parecerse ni al éxito ni al error.
- Backstage de administración: uso interno del equipo de Rutax, alta densidad, acciones peligrosas
  —incluida la suplantación de la cuenta de un courier para dar soporte. ⚠️ **Es el único perfil que
  ve datos de varias empresas a la vez**, y eso lo convierte en el de mayor riesgo del producto: su
  pantalla no la ve ningún cliente, pero un error suyo se ve en todos.
- Sitio público y pantallas sin sesión: primera impresión, y el seguimiento de envío que ve el
  destinatario del paquete, que no es cliente de nadie.

Un solo sistema para las cinco. Que se note que es el mismo producto, y que cada superficie esté
afinada a su contexto.

### Modo claro y modo oscuro — los dos de primera clase, ninguno derivado del otro

No es una cortesía ni un extra: el conductor termina el turno de noche y el coordinador tiene el
monitor diez horas. **Resuelve los dos temas completos, en todas las superficies y en todas las
pantallas.** Un tema oscuro obtenido por inversión del claro se nota y se rompe justo donde importa.

Presta atención especial a **los colores de estado del dominio**, que son los que más sufren al
cambiar de tema: un distintivo de estado tiene que seguir significando lo mismo y seguir siendo
distinguible de sus vecinos en los dos. Y el color nunca puede ser el único portador de significado.

⚠️ **La superficie del conductor tiene una tensión que no se arregla con dos paletas, y hay que
resolverla explícitamente:** este usuario necesita cosas opuestas dentro del mismo turno. A las
16:00, con sol directo sobre la pantalla, necesita el máximo contraste posible. A las 21:30, en la
calle a oscuras, una pantalla brillante lo encandila y le arruina la visión nocturna. Verifica el
contraste bajo sol directo, y define **cómo se decide el tema ahí**: por preferencia, por hora, por
sensor de luz, o combinado — y qué pasa si entra a un subterráneo a las 17:00. Hoy esa app no tiene
tema oscuro de ninguna clase.

Incluye la escala para números: este producto muestra montos en pesos, cantidades de bultos y horas
todo el día, y las cifras se comparan en columna.

### El movimiento — está decidido, no lo replantees

La postura es **movimiento funcional, más una firma de marca acotada**. Funcional quiere decir que
se anima lo que comunica algo: un cambio de estado, una relación causa-efecto, un progreso real.
Nada decorativo. En una tabla de mil filas cualquier animación es un impuesto que paga alguien que
lleva diez horas ahí.

Sobre eso, y solo ahí, vive la firma: **cuatro momentos y ni uno más**. Si son más, deja de ser
firma y pasa a ser ruido.

1. **El resultado de la asignación en bloque.** Treinta pedidos pasan a un conductor a las 15:50.
   Es el momento de más alivio del día del coordinador y hoy termina en una lista seca.
2. **La apertura del panel de detalle.** El gesto más repetido del producto — un pedido, una
   excepción, una liquidación. Al repetirse cientos de veces al día es donde más se percibe el
   carácter, y donde más molesta si sobra. Presupuesto de movimiento mínimo, carácter máximo.
3. **El cierre de una parada en la app del conductor.** Su única pequeña recompensa en un turno de
   treinta paradas. Hoy no existe como momento.
4. **La confirmación irreversible.** Acá el movimiento no es deleite: sirve a la gravedad. Cómo
   aparece, cómo se cierra el paso atrás, y cómo se resuelve el "ya ocurrió y no hay vuelta".

**Preséntalos encadenados como un caso de uso real** —un día del courier de punta a punta— y no
como especímenes sueltos en una lámina. Quiero ver si el conjunto tiene un mismo carácter.

**Entrega también:** la escala de duraciones y curvas con sus nombres, como tokens consumibles por
código, igual que el color; la regla explícita de qué se anima y qué no; y el comportamiento
completo con "reducir movimiento" activado, que no es apagar todo sino sustituir el movimiento por
otra señal.

⚠️ **La app del conductor tiene su propio presupuesto**, porque el movimiento compite ahí contra la
batería, que no le llega al final del turno. Va: estados de progreso —obteniendo ubicación,
subiendo fotos, registrando—, el momento en que un envío pendiente por fin se confirma, el cierre de
parada, y **gestos con respuesta al dedo** (deslizar una parada, tirar para actualizar). Ojo con el
gesto accidental: el conductor a veces trae guantes.

**Y una equivalencia que hay que declarar:** el producto web y la app nativa no animan con la misma
tecnología. Para cada decisión de movimiento, di cómo se traduce a cada lado para que se sientan la
misma cosa sin ser el mismo código.

**Entrega los tokens en formato consumible por código** — variables CSS con sus nombres definitivos,
agrupadas por rol, con sus valores para tema claro y oscuro. La implementación arranca apenas se
apruebe el diseño, así que esto no es documentación: es el insumo.

### Iconografía y estados vacíos

Define la familia de íconos, su grosor, sus tamaños y —lo que casi nunca se escribe— **la regla de
cuándo un ícono va solo y cuándo necesita etiqueta**. En una tabla densa un ícono solo ahorra
espacio; en una acción de dinero, un ícono sin etiqueta es una ambigüedad que cuesta plata.

**Los estados vacíos se resuelven con ícono del sistema y texto. Sin ilustración: está decidido.**
Un dibujo genérico es lo que más rápido hace que un producto de trabajo se vea como plantilla, y en
una herramienta que se usa diez horas al día los dibujos cansan mucho antes que el texto.

Hay más de 40 estados vacíos y **se agrupan en tres tonos que significan cosas opuestas**. Se
distinguen por color, ícono y redacción, no por ilustración:
- **Arranque** — todavía no hay datos porque el courier recién parte. Explica qué va a aparecer ahí
  y ofrece la acción que lo llena.
- **Buena noticia** — no hay nada justamente porque todo está bien: sin incidencias, todo cuadra,
  sin diferencias. ⚠️ **Hoy estos se ven igual que un error, y son lo contrario.** Tienen que leerse
  como tranquilidad, no como ausencia.
- **Filtro sin resultados** — la búsqueda no arrojó nada. Ofrece limpiar.

## 2. EL CATÁLOGO DE COMPONENTES

Todos los que hacen falta para cubrir el inventario, cada uno con TODAS sus variantes y estados:
reposo, hover, foco visible, activo, deshabilitado, cargando, con error, vacío, solo lectura.

Como mínimo: botón, campo de texto, campo numérico con formato de moneda chilena, selector,
selector múltiple, casilla, interruptor, selector de fecha (día exacto, rango con calendario y
atajos rápidos, los tres en un mismo control), tabla con selección múltiple y ordenamiento,
paginación, tarjeta, indicador de estado, etiqueta, panel lateral, modal, menú desplegable,
popover, pestañas, aviso embebido, notificación temporal, barra de progreso, esqueleto de carga,
estado vacío, campo de búsqueda, migas o retorno, navegación lateral colapsable, navegación
inferior para móvil.

Diseña también los componentes que el inventario revela que faltan.

**Y para cada componente, declara su costo de implementación.** Diseña sin restricción — no te
limites por lo que existe — pero dime, componente por componente, si se logra re-estilando uno de
los que ya hay o si exige construirlo desde cero. El producto está hecho con Next.js, Tailwind y
shadcn/ui, y hoy tiene estos 30 componentes en uso en 84 pantallas:

alert · avatar · badge · badge-estado · button · card · chart · checkbox · data-table ·
dialog · dialog-confirmacion-dinero · dropdown-menu · empty-state · input · kpi-card · label ·
monto-clp · pagination · popover · progress · select · separator · sheet · skeleton · sonner
(notificaciones) · table · table-skeleton · tabs · textarea · tooltip

Necesito ese desglose para presupuestar la implementación, no para recortarte el diseño.

## 3. EL SISTEMA DE ESTADO — lo más importante de esta pasada

El inventario trae 29 vocabularios de estado con ~147 valores (sección 3). Resuélvelos TODOS. No
agrupes "y los demás igual". Necesito:

- Una gramática visual del estado que funcione para todos ellos, no una paleta repartida a ojo.
- Reglas explícitas para los casos difíciles:
  · "aceptado con observaciones" del Servicio de Impuestos, que no es éxito ni error y no puede
    leerse como ninguno de los dos.
  · Las tres situaciones de retiro, donde ninguna es una alarma: que un paquete no se retire es el
    desenlace normal de la mitad de los casos.
  · Los tres estados vacíos de "buen estado" (sin incidencias, todo cuadra, sin diferencias), que
    no son ausencia de datos sino una buena noticia.
  · El rojo, que en la Torre de control está reservado exclusivamente a la incidencia abierta y no
    puede usarse para nada decorativo.
- El color nunca puede ser el único portador de significado.
- Cómo conviven en una misma fila ejes de estado independientes: un pedido tiene a la vez estado de
  ciclo, situación de retiro, estado de dirección y procedencia, y son cuatro preguntas distintas
  que no se pueden mezclar en un mismo indicador.

## 4. EL REGISTRO DE OBJETOS DE DOMINIO — el mecanismo que impide que esto se rompa

El trabajo posterior se divide por bloques, pero los objetos del dominio cruzan las superficies: el
mismo pedido lo ve el coordinador en una tabla, el seller en su portal, el conductor como parada en
el teléfono, la Torre como un punto en un mapa, y el comprador final como un estado en una página
pública. Si cada bloque lo resuelve por su cuenta, salen cinco pedidos distintos. Ya pasó en un
intento anterior: es el fallo específico que hay que evitar.

El inventario trae la matriz de objetos compartidos (sección 7). Para CADA objeto de esa matriz,
resuelve aquí y de una sola vez:

- La representación canónica: qué campos lo identifican siempre, en qué orden, con qué jerarquía.
  Una sola definición.
- Las variantes por densidad: fila de tabla, tarjeta, encabezado de detalle, punto en mapa, línea
  de correo, elemento de lista en móvil, línea impresa. Todas derivadas de la canónica.
- Las variantes por rol: qué campos aparecen y cuáles se ocultan según quién mira. No es cosmético:
  hay reglas de privacidad duras (hay superficies donde la dirección del destinatario no puede
  mostrarse NUNCA, y ahí el objeto se identifica por su código de envío). Respétalas exactamente.
- El vocabulario: el nombre único del objeto y de cada campo, igual en las cinco superficies.

Entrégalo también como documento en tabla, para consultarlo sin interpretar láminas.

## 5. EL SISTEMA DE ETIQUETAS

Cómo se nombra cada concepto del dominio en la interfaz, igual en las cinco superficies: pedido,
manifiesto, parada, retiro, bulto, seller, conductor, período, línea de cobro, línea de
liquidación, conciliación, excepción, folio, ventana de corte, zona, comuna, bodega, punto de
término, fuente. Un concepto, un nombre.

## 6. VOZ, TONO Y PLANTILLAS DE MENSAJE

Esto va acá y no al final a propósito: si las pantallas se dibujan con texto de relleno, después el
copy real no cabe. Todavía NO escribas los cientos de mensajes del inventario — eso viene después.
Ahora define el molde:

- La VOZ del producto y su TONO por contexto. No se habla igual al confirmar una factura
  irreversible que al avisar que no hay pedidos hoy.
- Las reglas duras de redacción: mayúsculas en títulos y botones, cómo se nombran las acciones,
  cómo se escriben cifras y fechas en español de Chile, qué jerga del dominio se conserva porque el
  usuario la usa y cuál se traduce porque solo la usa el sistema.
- La PLANTILLA de cada tipo de mensaje, con su estructura y su longitud típica: éxito, error,
  advertencia que no es error, confirmación irreversible, estado vacío en sus tres tonos, ayuda de
  campo, error de validación. Tres ejemplos reales de cada una, sacados del inventario.
- Reglas de accesibilidad del texto: etiquetas, textos alternativos, anuncios para lector de
  pantalla.

Las reglas que sí te pido, porque son del producto y no estéticas: decir qué pasó y qué hacer
ahora, nunca solo "error" · nunca culpar a quien lo usa · nada de jerga técnica ni códigos de
sistema en la superficie · nunca revelar detalles internos como nombres de tabla o mensajes crudos
del proveedor externo, que hoy el producto filtra en varios sitios.

## 7. EL SISTEMA CARTOGRÁFICO

⚠️ **Esto es un frente propio y es el único lugar del producto donde el diseño NO puede heredar de
los tokens**: la librería cartográfica no lee CSS. Todo lo que se vea en el mapa hay que definirlo
aparte, y si no se hace, el mapa va a ser lo único del producto que no se parezca al producto.

La Torre de control es un mapa de Santiago que responde una pregunta: cuántos paquetes faltan por
entregar, en qué comunas, y si algo se está atascando. Define:

- **El tema del mapa en claro y en oscuro**: el plano de fondo, sus calles, sus etiquetas y su
  contraste. El plano tiene que retroceder — es el escenario, no el contenido.
- **Los tres niveles de zoom semántico** y el escalón entre ellos: comuna → agrupaciones → punto de
  entrega individual. Qué aparece y qué desaparece en cada salto, y cómo se entiende que se cambió
  de nivel.
- **El polígono de comuna**: cómo se pinta la carga, cómo se ve el que está seleccionado, y cómo se
  distingue del vecino sin convertir el mapa en un semáforo.
- **El punto de entrega y el marcador de conductor**, y cómo se comportan cuando hay cientos
  encimados.
- ⚠️ **En el punto de entrega se muestra el CÓDIGO DE ENVÍO, nunca la dirección ni el nombre del
  destinatario.** Es regla legal, no preferencia. Y del conductor solo existe su última posición: no
  hay recorrido histórico y no se puede dibujar uno.
- **El rojo está reservado a la incidencia abierta**, que es lo único accionable de la pantalla.
  Nada más en ese mapa puede usarlo.
- **Sus estados**: sin incidencias abiertas · nadie con paradas asignadas hoy · sin pedidos con
  compromiso para hoy · y el degradado, cuando la cartografía no carga y el mapa se queda sin plano.
  Ese último es un estado válido y hay que diseñarlo, no tratarlo como error.

## 8. EL SISTEMA DE VISUALIZACIÓN DE DATOS

Otro sub-sistema que se rompe distinto que el resto: una paleta de gráfico mal resuelta hace
ilegible una cifra de dinero. El producto tiene gráficos en el panel del dueño, en la analítica
financiera, en el semáforo de cumplimiento por seller y en las métricas del backstage.

- **Qué tipos de gráfico se permiten y cuándo se usa cada uno.** Una regla corta y cerrada: en un
  producto de trabajo, la variedad de gráficos es ruido, no riqueza.
- **La paleta categórica**, que es el problema difícil: tiene que funcionar en claro y en oscuro
  **sin cambiar de significado**, distinguirse entre series adyacentes, y no chocar con los colores
  de estado del dominio, que ya están tomados.
- **Ejes, rótulos y cifras**: montos en pesos chilenos, sin decimales, alineados y comparables.
- **Sus estados**: cargando, sin datos suficientes para graficar, y el rango donde el gráfico deja
  de ser legible.
- **El semáforo de cumplimiento** merece atención propia: es un juicio sobre el desempeño de un
  seller, tiene un objetivo pactado por contrato detrás, y el color no puede ser su único portador.

## 9. SONIDO, VIBRACIÓN Y NOTIFICACIONES — solo en la app del conductor

Hoy la app **no tiene ninguno de los tres**, verificado en su proyecto. Y hay un caso que los exige:
el conductor escanea hasta 130 bultos seguidos en una bodega y **no puede mirar la pantalla en cada
uno**. La confirmación tiene que entrar por el oído o por la mano.

**Diseña un vocabulario pequeño de sonido y vibración, con significados distintos y distinguibles
sin mirar:**
- Escaneado correcto — siga.
- Bulto repetido, ya escaneado — no es error, pero deténgase un segundo.
- Bulto que no corresponde a esta bodega — deténgase de verdad.
- Visita cerrada — terminó.

Que funcione con el teléfono en silencio (la vibración sola tiene que bastar), en una bodega ruidosa
(el sonido tiene que cortar), y sin agotar la batería.

**Notificaciones push**: tampoco existen hoy, ni en la app ni en el servidor. Diseña el patrón
completo —cuándo se piden los permisos, qué dice cada una, dónde aterriza al tocarla, y qué puede
apagar el conductor— para al menos los tres momentos que el día exige: tu ruta ya está lista, te
traspasaron bultos, y se te asignó un retiro. Hoy el conductor tiene que abrir la app a ver si ya le
toca.

⚠️ **Y el momento de PEDIR un permiso es diseño, no un trámite.** Cámara, ubicación, galería y
notificaciones: si se piden todos de golpe al abrir la app, el conductor los rechaza y después no
hay vuelta atrás fácil. Define cuándo se pide cada uno, con qué explicación previa, y qué se ve si
ya fue denegado.

## 10. EL SISTEMA IMPRESO

Hay piezas que salen del producto en papel o en PDF y hoy nadie las diseñó. Define sus reglas —
las piezas concretas se dibujan más adelante:

- Cómo se comporta la marca y la tipografía **en una térmica monocroma de baja resolución**, que es
  un medio hostil: sin color, sin grises confiables, con texto que tiene que leerse desde una
  camioneta.
- Cómo se comporta en un PDF de tamaño carta pensado para leerse en pantalla y para imprimirse.
- La jerarquía de una tabla financiera impresa, donde no hay hover ni tooltip para explicar nada.
- El tratamiento formal: estas piezas van en USTED.

## 11. ACCESIBILIDAD Y RENDIMIENTO

WCAG 2.2 AA como piso, no como aspiración: contraste, foco visible, navegación completa por teclado
(hay un buscador global que se opera solo con teclado), orden de tabulación, tamaño de objetivo
táctil para la app del conductor y para el uso de pie en bodega, y comportamiento con movimiento
reducido. El contexto lo exige por sí solo: sol directo en la calle y diez horas de monitor.

Rendimiento como restricción de diseño: hay tablas que llegan a mil filas, un mapa con cientos de
puntos y pantallas que se refrescan solas mientras el usuario mira. Un patrón que no aguante eso
está mal aunque se vea bien. Di cómo se comporta cada patrón denso al crecer.

Y una restricción de realidad: esto se construye sobre un producto en producción con clientes
reales, así que lo nuevo y lo viejo van a convivir meses. Evita decisiones que solo funcionen si
todo cambia el mismo día.

---

Entrégame el sistema documentado y una lámina con el catálogo completo y todos sus estados.
Todavía sin pantallas.

Al terminar, escribe la FICHA DE CIERRE de esta pasada, para poder retomar desde otra sesión.
Máximo dos páginas, en texto plano:
1. La ruta de marca elegida y los tokens fundamentales, con sus nombres definitivos.
2. Los nombres exactos de todos los componentes y variantes creados, y cuáles se re-estilan contra
   cuáles se construyen de cero.
3. El registro de objetos de dominio completo, en tabla.
3b. Los sub-sistemas especializados y sus reglas: cartografía, visualización de datos, sonido y
   vibración, e impresos.
4. La voz, el tratamiento y las plantillas de mensaje.
5. Las reglas de sistema que rigen de ahora en adelante.
6. Lo que quedó abierto y lo que todavía no se ha diseñado.
Escríbela para que otra sesión tuya pueda leerla y continuar sin desviarse.
```

---

# ▼ PASADA 2 — Las siete pantallas arquetipo

> Esfuerzo: **máximo**. Sin adjuntos nuevos.

```
Con el sistema que acabas de definir, diseña siete pantallas. Solo siete, y no al azar: son los
siete patrones de los que se deriva todo el resto del producto. Quiero resolverlos bien acá para que las
~90 pantallas restantes sean aplicación, no invención.

Usa el copy real de las plantillas que definiste, no texto de relleno: si un mensaje no cabe,
quiero saberlo ahora.

PANTALLA 1 — Listado con filtros: "Pedidos" del backoffice del courier
La pantalla central de la operación, la que está abierta todo el día.
- Barra de cajones por grupo de estado, cada uno con su contador: pendiente de asignación,
  asignado, en ruta, entregado, con problemas, por revisar. Los contadores cuentan sobre el
  conjunto filtrado, no sobre la página visible. Ojo: la suma de los cajones NO da el total, porque
  "cancelado" queda fuera a propósito. Que la interfaz no mienta sobre eso.
- Filtros: seller, conductor, comuna, procedencia, estado, fecha (día / rango / atajos) y
  "dirección por revisar". Persisten en la URL.
- Tabla: estado, destinatario, seller, fecha, procedencia, motivo, conductor.
- **La tabla se actualiza sola, y la regla ya está decidida: mixta según el tipo de cambio.** Lo que
  ya está en pantalla se actualiza en su lugar, con una señal breve de que cambió. Lo que entraría
  nuevo **NO se inserta solo**: se anuncia y el usuario decide cuándo incorporarlo. La razón es
  concreta — si está seleccionando treinta filas para asignar y la lista se reordena bajo el dedo,
  pierde la selección o toca la equivocada. Diseña las dos mitades: la señal del cambio en sitio y
  el aviso de lo que espera afuera, con su conteo.
- Tres estados vacíos distintos y hay que distinguirlos: no hay direcciones por revisar (buena
  noticia), ningún pedido coincide con el filtro, y aún no hay pedidos para esta fecha.
- Acción de crear un pedido same-day.

Resuélvela en los TRES tamaños —escritorio 1440, tablet 1024 y teléfono 390— y escribe la regla que
los une. El teléfono no es una reducción: es donde el coordinador trabaja de pie en la bodega.

PANTALLA 2 — Selección masiva con acción en bloque: "Asignar pedidos"
La carrera contra las 16:00, y el patrón que más plata mueve por minuto ahorrado.
- Bandeja de pedidos ya retirados, con filtros en panel lateral.
- Tabla con selección múltiple, barra de selección persistente con el conteo, y panel de revisión
  de lo seleccionado antes de confirmar.
- Aviso de truncamiento cuando hay más resultados de los que se muestran, y aviso de que llegaron
  pedidos nuevos mientras trabajabas.
- Confirmación de reasignación cuando la selección incluye pedidos que ya son de otro conductor.
- Resultado detallado: qué se asignó, qué no, y por qué. ⚠️ **Este resultado es uno de los cuatro
  momentos de firma del sistema**: es el mayor alivio del día del coordinador y hoy termina en una
  lista seca. Resuélvelo acá.
- CRÍTICO: esto tiene que funcionar CON EL DEDO en tablet y teléfono, no solo con puntero y
  teclado. Seleccionar 30 de 200 filas tocando, revisarlas y asignarlas es otro problema de
  interacción, no una tabla más angosta. Resuélvelo de verdad: sin hover, sin selección por rango
  con teclado, sin menú contextual.

PANTALLA 3 — Detalle con acciones de consecuencia: "Detalle del pedido"
Toda la ficha del envío, su historial, su prueba de entrega y su dinero. Conviven acciones inocuas
(descargar etiqueta) con acciones graves (anular el cobro, anular la liquidación, cancelar el
pedido). Resuelve la jerarquía para que nadie confunda unas con otras, y dónde vive el rastro de
auditoría: cada acción de dinero queda registrada con su autor, y eso el usuario tiene que
percibirlo antes de actuar, no después. Incluye el visor de la prueba de entrega y el lazo entre el
pedido y sus líneas de dinero.

⚠️ **La apertura de este panel es uno de los cuatro momentos de firma.** Es el gesto más repetido
del producto —se abre un pedido, una excepción, una liquidación cientos de veces al día— así que
tiene presupuesto de movimiento mínimo y carácter máximo. Resuélvelo acá y reúsalo en todo lo demás.

PANTALLA 4 — Confirmación irreversible: "Emitir factura del período"
El punto más delicado del producto. Emitir un documento tributario es irreversible ante el Servicio
de Impuestos Internos: solo se deshace con una nota de crédito.
- Tiene que describir la consecuencia en palabras, no preguntar "¿estás seguro?".
- Muestra qué se va a comprometer: seller, período, líneas, monto, folio que se va a consumir.
- Exige un acto explícito de confirmación.
- No se puede cerrar por accidente: ni con escape, ni haciendo clic fuera.
- Antes hay una verificación previa. Diseña también el caso en que encuentra problemas y el usuario
  decide emitir igual (queda registrado que la omitió), y el caso en que una excepción de
  conciliación bloquea la emisión y no hay forma de continuar.
- Y el estado de "modo de pruebas": hoy la facturación corre en simulación y el usuario tiene que
  saberlo de un vistazo, sin ambigüedad.

Deriva de acá la escalera de fricción completa del producto: tres peldaños —acción reversible,
destructiva reversible, e irreversible con consecuencia legal— y la regla que asigna cada acción a
su peldaño. Hoy ese criterio está al revés en el producto: hay acciones graves que se confirman con
menos ceremonia que las triviales.

PANTALLA 5 — Captura en terreno: "Registrar entrega" en la app nativa del conductor
Teléfono, en la calle, una mano, apurado, señal mala, sol directo. Es la pantalla de máxima
hostilidad de contexto del producto.

- **La evidencia es obligatoria, siempre**: tanto al entregar como al no entregar. Sin evidencia no
  se cierra la parada.
- **El flujo arranca en la cámara.** El conductor toca "entregar" y la cámara ya está abierta: no
  hay una pantalla intermedia que le pida decidir. Diseña ese arranque directo.
- **Varias fotos, no una.** Y dentro del mismo módulo de cámara tiene que haber la opción de
  **adjuntar desde la galería**, con selección múltiple. No es un detalle: el conductor necesita
  adjuntar capturas de pantalla de sus intentos de llamada, de una conversación o de un mensaje, y
  esas no se sacan con la cámara. Resuelve cómo conviven las dos entradas —disparar y adjuntar— en
  una interfaz que se opera con una mano y a pleno sol, sin que la de adjuntar quede escondida.
- Mostrar las fotos ya tomadas, poder **eliminar** una antes de enviar, y decir cuántas caben.
- Captura de ubicación y estados de progreso con paso nombrado ("obteniendo ubicación",
  "registrando entrega").
- La variante de no entrega, que exige elegir el motivo entre siete tipos **y adjuntar evidencia**:
  es el caso donde la evidencia realmente pesa, porque respalda el cobro, la incidencia y la
  conversación con el seller.
- Diferencia crítica que la interfaz tiene que dejar clarísima: en los pedidos de Mercado Libre
  Flex, lo que el conductor registra en Rutax es informativo — la prueba oficial la gobierna la app
  de Mercado Envíos y el conductor tiene que abrir esa otra app. En todos los demás, lo que registra
  en Rutax es la prueba autoritativa y es lo que dispara el pago. El conductor no puede equivocarse
  en esto. Diseña el punto de cruce hacia la otra app y la vuelta.
- **Sin señal: NO hay trabajo sin conexión.** La app reintenta sola en segundo plano y le muestra
  que el registro aún no se confirma, para que siga avanzando en vez de quedarse parado en la
  puerta. Ese estado intermedio no puede leerse ni como éxito ni como error, y si cierra la app se
  pierde: díselo. Diseña también el momento en que finalmente se confirma.
- Permiso de cámara, de galería o de ubicación denegado.
- ⚠️ **El cierre de la parada es uno de los cuatro momentos de firma del sistema.** Es la única
  pequeña recompensa del conductor en un turno de treinta paradas, y hoy no existe como momento.
  Resuélvelo acá, con el presupuesto de batería en mente: tiene que valer los milisegundos que
  cuesta.
- **Gestos con respuesta al dedo**: deslizar una parada, tirar para actualizar. Diséñalos con el
  seguro puesto contra el gesto accidental — el conductor a veces trae guantes.

PANTALLA 6 — Bandeja de excepciones: "Conciliación"
Donde aparece el dinero que no cuadra. No se parece a nada más del producto y por eso es arquetipo.
- Listado con categoría y tipo, estado, vencimiento, asignado a, diferencia, seller y pedido.
- Panel de detalle con todas sus acciones: transicionar de estado por una máquina de transiciones
  válidas, reabrir, asignar a una persona, fijar fecha límite, fijar si bloquea facturación y si
  bloquea pago, cambiar la acción sugerida, comentar, y ver el historial del caso.
- Tres de los 18 tipos de diferencia son fuga directa de ingreso y llevan tratamiento de alarma; el
  resto no. Que la bandeja no grite por todo.
- Estados vacíos: sin diferencias, todo cuadra (buen estado) · ninguna coincide con el filtro.

PANTALLA 7 — Autoservicio de reparación: "Conectar mis cuentas de venta" en el portal del seller
El único trayecto crítico del seller, y un patrón que no aparece en ninguna otra parte del producto:
una integración se cayó y él tiene que arreglarla solo, sin llamar a nadie. Si falla, los pedidos
dejan de entrar y el courier se entera tarde.

- Estado de salud de cada cuenta conectada, con su nombre visible y su última sincronización
  correcta. Hasta 10 cuentas de Mercado Libre por seller, más las tiendas Shopify.
- Conectar una cuenta nueva · reconectar una caída · renombrar · pedir sincronización ahora.
- ⚠️ **El problema de comunicación más difícil del producto está acá**: cuando una cuenta se cae, las
  tres causas posibles —permiso vencido, permiso revocado, fallo interno— hoy son indistinguibles
  para el seller y terminan las tres en el mismo texto. Diseña cómo se le dice a alguien que no sabe
  de logística que algo se rompió, sin poder decirle exactamente qué, **y aun así dejarlo capaz de
  arreglarlo**.
- **La advertencia previa obligatoria antes de agregar una segunda cuenta**: si el seller tiene
  sesión abierta en Mercado Libre, la plataforma externa no muestra el selector y va a reconectar la
  misma cuenta. No se puede resolver técnicamente —lo verificamos contra su documentación— así que
  la interfaz tiene que advertirlo ANTES, con la salida concreta (cerrar sesión allá, o ventana
  privada). Es un caso puro de diseño resolviendo lo que la ingeniería no puede.
- Shopify: pegar el dominio de la tienda y un token que el seller copia desde su propio panel.
  Diseña cómo se le pide a alguien no técnico que vaya a otra herramienta, encuentre una credencial
  y la traiga, sin que abandone a mitad de camino.
- Al llegar al tope de cuentas, el botón de agregar desaparece y se explica el límite.

Recuerda para quién es: **el seller no eligió este software, se lo impuso su courier.** Si esta
pantalla lo deja botado, el que queda mal es el courier.

---

Para cada una: pantalla ancha y pantalla angosta, modo claro y modo oscuro, y sus estados de carga
y error.

Las pantallas 1 y 5 muestran el MISMO objeto —un pedido— en las dos superficies más opuestas del
producto. Úsalas para demostrar que el registro de objetos funciona: se tienen que reconocer como
el mismo objeto sin ser la misma pantalla. Si no lo logras, el registro está mal y hay que
corregirlo ahora, no en la pasada 3.

Y dime qué decisión de sistema tomaste en cada una que después se va a reutilizar en el resto.

Al terminar, escribe la FICHA DE CIERRE: las siete pantallas y cómo quedó cada una, los componentes
o variantes nuevos con su nombre exacto y su costo de implementación, las reglas de disposición que
de ahora en adelante rigen para todas las pantallas del mismo patrón, las correcciones al registro
de objetos si las hubo, lo que quedó abierto y lo que falta por diseñar.
```

---

# ▼ PASADA 3 — El resto de las pantallas

> Esfuerzo: **alto**. **Un mensaje por bloque, no todos juntos.**
> Si sigues en el mismo hilo, pega directo. Si abriste sesión nueva, antepón el preámbulo de
> re-anclaje con todas las fichas.

```
Ahora derivemos el resto del producto aplicando el sistema y los siete arquetipos.

Reglas de esta pasada:
- Reutiliza componentes y variantes existentes, con sus nombres exactos.
- Los objetos del registro NO se rediseñan: se derivan variantes y se declara.
- Si una pantalla necesita un patrón que no existe, dilo y propónmelo ANTES de usarlo.
- Usa el copy real de las plantillas, no texto de relleno.
- El inventario cierra con 35 brechas conocidas: cosas que faltan o están a medias. Cuando el
  producto evidentemente la necesita, DISEÑA lo que falta y márcalo NUEVO, para que yo lo apruebe
  o lo descarte por separado. No inventes funcionalidad que nadie echó de menos.
- Las superficies del courier y del seller son multi-dispositivo. La del conductor es solo teléfono.

Vamos por bloques. Este es el bloque [N]:

[Pega aquí el bloque que corresponda]

Para cada pantalla: propósito, disposición, estados vacío/cargando/error/sin permiso, **modo claro y
modo oscuro**, y qué patrón de los arquetipos está aplicando. El modo oscuro no es opcional en
ninguna pantalla ni en ninguna superficie: si una decisión de disposición solo funciona en uno de
los dos, está mal resuelta.

Antes de empezar a diseñar, dime en dos líneas qué entendiste que ya existe y qué vas a reutilizar.
Si eso no calza, lo corrijo antes de que gastes la pasada.

Al terminar el bloque, escribe su FICHA DE CIERRE: qué pantallas quedaron, qué componentes o
variantes nuevos hubo que crear con su nombre exacto, qué se marcó NUEVO, qué reglas nuevas rigen
de ahora en adelante, qué quedó abierto y qué falta por diseñar.
```

**Los bloques, en este orden:**

**Bloque 1 — Operación del courier.** Torre de control —aplicando el sistema cartográfico que ya definiste, con sus tres niveles de zoom y sus cuatro estados, más su versión en teléfono, que es la que abre el coordinador cuando está fuera de la oficina— · Preparación del día · Incidencias ·
Manifiestos y su detalle con secuenciación de ruta y redistribución por conductor no disponible ·
Conductores y su detalle · Dashboard operativo · Crear pedido same-day.
*(Pedidos, Asignar y Detalle del pedido ya están resueltos como arquetipos.)*

**Bloque 2 — Dinero.** Períodos de cobro con aprobación en lote y verificación previa · Detalle del
período · Liquidaciones de conductores con ajuste manual y pagos en lote · Detalle de la liquidación
· Cobranza y revisión de pagos.
*(Conciliación ya está resuelta como arquetipo.)*

**Bloque 3 — Configuración y puesta en marcha.** El asistente de 5 pasos con progreso persistente
—atención: hoy ese asistente no puede completarse nunca, y la brecha está documentada— · Tarifas ·
Zonas y ventanas de corte · Bodegas (las del courier y las de los sellers, que no son lo mismo) ·
Retiro · Integraciones: claves de API y webhooks · Exportar datos · Mi plan · Sellers · Equipo
—donde la gestión de roles hoy dice "próximamente" y hay que diseñarla.

**Bloque 4 — Portal del seller.** Sus pantallas restantes: inicio, bienvenida, mis pedidos y su
detalle, nuevo pedido same-day, mis cobros y su detalle, mis incidencias, y bodegas.
*(Conectar cuentas de venta ya está resuelta como arquetipo 7.)*
Recuerda para quién diseñas: alguien que **no eligió este software**, que entra desde el teléfono
entre otras cosas, y que si lo pasa mal culpa a su courier. Ojo: el buscador global de esta
superficie hoy siempre responde "sin resultados" — decide si se retira o se hace funcionar.

**Bloque 5 — App nativa del conductor.** Es la ÚNICA app del conductor y es nativa: no existe
versión web. Manifiesto del día · Detalle de parada · Mis liquidaciones · Punto de término con su
flujo de consentimiento por pasos (es dato personal bajo la Ley 21.431: el consentimiento no es un
trámite, es el requisito) · Retiro en bodega con escaneo de código QR bulto por bulto · Traspaso
entre conductores · Preferencias · Permisos denegados (cámara, galería, ubicación) · Y el estado de
"enviado pero sin confirmar" mientras la app reintenta sin señal.
⚠️ **No diseñes trabajo sin conexión**: se retiró del producto. No hay cola persistente, no hay
bandeja de pendientes y no hay pantalla de "sin conexión". Lo que hay es reintento automático con
aviso, y la advertencia de que cerrar la app pierde lo no confirmado.

⚠️ **Y el tema oscuro de esta app hay que construirlo entero: hoy no existe.** Verificado — sus
tokens son todos claros, la barra de estado está fija en un solo modo y no hay una sola lectura de
la preferencia del sistema. Es la superficie que MÁS lo necesita: reparte de 16:00 a 22:00 y termina
el turno de noche.

Y ahí hay un problema de diseño de verdad, que no se resuelve con dos paletas: **este usuario
necesita cosas opuestas en el mismo turno.** A las 16:00, con sol directo sobre la pantalla, necesita
el máximo contraste posible. A las 21:30, en la calle y a oscuras, una pantalla brillante lo
encandila y le arruina la visión nocturna. Resuelve cómo cambia —por preferencia, por hora, por
sensor de luz, o una combinación— y qué pasa si el conductor entra a un subterráneo a las 17:00.
Tampoco hay hoy escalado de tamaño de fuente, y el usuario lee de reojo.
*(Registrar entrega ya está resuelta como arquetipo.)*
**Las notificaciones push y el sonido y la vibración del escaneo se aplican acá**, con el vocabulario que definiste en el sistema. Ninguno de los tres existe hoy: es diseño nuevo, márcalo NUEVO.

Y tres huecos de navegación documentados que hay que resolver: no existe pantalla para marcarse
disponible, el manifiesto en borrador es un callejón sin salida, y la sesión de retiro nunca muestra
qué se esperaba retirar.
⚠️ **La Torre móvil NO va acá.** Se decidió que es del coordinador, no del conductor: es la Torre de
control en el teléfono, para cuando el coordinador está en la bodega o fuera de la oficina. Va en el
bloque 1, y en la app del conductor no existe.

**Bloque 6 — Backstage de Rutax.** Sus trece pantallas, **con un nivel de exigencia distinto: que
herede el sistema completo y que arregle lo que está objetivamente roto, sin invertir en refinamiento
visual.** Es uso interno del equipo de Rutax, no lo ve un cliente. Lo que sí hay que resolver bien:
las confirmaciones financieras —hoy usa diálogos nativos del navegador—, los estados de carga y
error —hoy no tiene ninguno—, y sobre todo el modo soporte, que exige motivo obligatorio para entrar
y deja un banner permanente mientras dura, porque se está viendo la cuenta de otra empresa. Hoy ese
banner desaparece justo en el estado de error, con la sesión viva.

**Bloque 7 — Pantallas sin sesión.** Registro · Activación · Aceptar invitación con sus cinco
estados de error distintos · Los dos inicios de sesión · Recuperar y restablecer contraseña ·
Seguimiento público del envío · Legales · Sin conexión · Error general · Y la pantalla de "no
encontrado", que hoy no existe en ninguna parte del proyecto.
*(El sitio comercial va aparte, en la pasada 5.)*

⚠️ **El seguimiento público merece atención propia dentro de este bloque.** Es la única pantalla que
ve alguien que no es cliente de nadie, llega casi siempre desde el teléfono por un enlace de
mensajería, y hoy es la peor cuidada del producto. Tres cosas que hay que resolver:
- **Lleva la marca del COURIER, no la de Rutax**, más un discreto "powered by Rutax" al pie. Y tiene
  que verse bien con **solo el nombre del courier en texto**: el sistema no guarda ningún logo suyo.
- **Este enlace público solo se genera para same-day y Shopify, no para Mercado Libre Flex** — ahí el
  comprador ya tiene el seguimiento de Mercado Libre. Ojo con no confundirlo: **dentro de Rutax el
  courier y el seller sí ven el estado de CUALQUIER pedido, de las tres fuentes, abriendo su
  detalle.** Lo que no aplica a Flex es el enlace que se le manda al comprador final, nada más.
  Diseña qué pasa si alguien llega igual con un enlace así — hoy cae en el 404 por defecto, en
  inglés.
- Se comparte por mensajería y **no tiene previsualización de ningún tipo**. Diseña la tarjeta que
  aparece cuando alguien pega ese enlace en WhatsApp: es la primera impresión, y hoy no existe.

**Bloque 8 — Las piezas impresas.** Con las reglas del sistema impreso ya definidas, diseña las
cuatro piezas concretas:
- **La etiqueta de envío**, en sus dos formatos: térmica 10x15 cm y carta/A4. Monocroma, baja
  resolución, se pega al paquete y la manipula el conductor con una mano. Es la pieza física de
  mayor volumen del producto. Tiene que resolver el código de envío legible a distancia, el código
  QR o de barras, el destinatario y la comuna.
- **La factura electrónica en PDF**, que el seller descarga y que respalda lo que le cobran. Es la
  cara más formal del courier ante su cliente. Va en usted.
- **La liquidación del conductor en PDF**: cuánto se le paga y por qué, con sus líneas y sus
  ajustes. La lee alguien que desconfía por defecto de un descuento que no entiende, así que su
  legibilidad es el problema de diseño. Va en usted.
- **El manifiesto impreso**: la hoja de ruta en papel, como respaldo cuando el teléfono se queda sin
  batería a mitad de turno. Tiene que servir para trabajar, no para archivar.

---

# ▼ PASADA 4 — El volumen del sistema de mensajes

> Esfuerzo: **alto**. La voz, el tono y las plantillas ya están definidos desde la pasada 1·B.
> Acá se escribe el volumen, aplicando ese molde.

```
Con la voz, el tratamiento y las plantillas ya definidos, escribe ahora todo el contenido del
sistema de mensajes. No redefinas el tono: aplícalo.

Recuerda el tratamiento: TÚ en todo el producto y en los correos; USTED solo en la factura, la
liquidación, los términos y la privacidad.

Cubriendo la sección 8 del inventario:

1. CONFIRMACIONES DE ACCIÓN IRREVERSIBLE (~25 acciones listadas)
   Cada una: título, consecuencia escrita, texto del botón que confirma y del que cancela. El botón
   de confirmar dice lo que hace, no "Aceptar".

2. MENSAJES DE ÉXITO
   Para ~140 acciones. Las de dinero tienen que confirmar exactamente qué ocurrió, con su monto y
   su contraparte — un "listo" ahí no sirve.

3. MENSAJES DE ERROR, por las seis familias
   Validación de campo, permiso, estado (el dato cambió mientras mirabas), integración externa
   caída, límite de plan alcanzado, y red o sistema.

4. ESTADOS VACÍOS (más de 40)
   En sus tres tonos: arranque, buena noticia y filtro sin resultados. Los de buena noticia —sin
   incidencias, todo cuadra, sin diferencias— no son ausencia de datos: son una buena noticia y
   tienen que leerse como tal.

5. ADVERTENCIAS QUE NO SON ERRORES
   Pedido creado fuera de la hora de corte, que se crea igual · agregar una segunda cuenta de
   Mercado Libre con sesión abierta · consumo del plan al 80% · una excepción que bloquea la
   facturación · la verificación previa omitida a propósito · el registro de entrega en Flex, que es
   informativo y no la prueba oficial · una dirección que lleva demasiado tiempo sin ubicarse.

6. AYUDA CONTEXTUAL
   Qué es un folio · qué es un certificado digital y por qué vence · qué es una ventana de corte ·
   qué significa cada tipo de diferencia de conciliación · por qué un pedido aparece como no
   procesado · por qué la Torre muestra menos pendientes que el listado de pedidos · qué implica el
   consentimiento del punto de término.

7. LAS NOTIFICACIONES PUSH del conductor
   Cada una: qué dice, en cuántos caracteres —se leen en una pantalla bloqueada, de reojo—, dónde aterriza al tocarla, y el texto con que se le pide el permiso la primera vez. Los tres momentos: tu ruta ya está lista, te traspasaron bultos, se te asignó un retiro.

8. LOS CORREOS
   La plantilla base —jerarquía, marca, comportamiento en móvil y en modo oscuro, y cómo degrada en
   un cliente antiguo— y después cada correo con su asunto, su cuerpo y una sola llamada a la
   acción. Van en tú.
   Incluye los que hoy NO existen y el inventario señala como faltantes: ningún evento de dinero
   avisa a nadie —período cerrado, factura emitida, liquidación pagada, pago al conductor, folios
   por agotarse, morosidad—, y el comprador final nunca recibe su enlace de seguimiento por una vía
   propia de Rutax.

Entrégalo como un documento de contenido reutilizable, organizado para poder buscarlo, no como
capturas de pantalla.

Al terminar, escribe la FICHA DE CIERRE: qué familias de mensaje quedaron escritas, cuáles no, y
qué mensajes obligaron a ajustar una pantalla ya diseñada porque no cabían.
```

---

# ▼ PASADA 5 — El sitio público comercial

> Adjunta `REFERENCIAS-LANDING.md`. Esfuerzo: **alto**. Va al final a propósito: para vender el
> producto hay que haberlo visto.

```
Cierra el rediseño con la superficie que le habla a quien todavía no es cliente. Se aplica el mismo
sistema ya establecido —el sitio y el producto tienen que reconocerse como la misma cosa—, pero con
la libertad expresiva que una página comercial exige y una aplicación no.

Hoy no existe: la raíz del sitio solo redirige al inicio de sesión.

Adjunto un análisis de 17 páginas reales de este rubro —chilenas y globales— leídas una por una:
sus titulares literales, cómo nombra cada una su categoría, qué estructura usan, qué prueba
muestran y qué errores cometen. TRABAJA DESDE AHÍ, no desde tu intuición de lo que debería ser una
landing. Ese documento es el que impide que esto salga genérico.

QUIÉN LO LEE: el dueño de un courier pyme en Santiago, entre 5 y 40 conductores. Hoy opera con
planillas de cálculo, mensajes de WhatsApp y una app de rutas a la que le digita a mano cada
dirección. Es escéptico, tiene poco tiempo, y ya lo decepcionó algún software.

EL OBJETIVO, Y ES UNO SOLO: que agende una demostración. Sin precios, sin planes, sin prueba
gratis, sin promover el registro autoservicio. Existe un modelo de suscripción construido, pero es
conversación de la demo, no de la página. Esto coincide con el rubro: 16 de las 17 páginas
analizadas no muestran precio en su portada.

## EL TITULAR — donde falló el intento anterior, y por qué

Un intento previo produjo un titular construido sobre un detalle operativo de un cliente ("si
cierras a las 16 horas…"). NINGUNA de las 17 páginas del rubro hace eso. El detalle operativo es
material excelente para la sección de producto o para el bloque de "cómo funciona" — como prueba de
que entendemos la operación — pero jamás para el titular.

Lo que sí hace el rubro, y es el patrón dominante entre las páginas que le hablan a un comprador
comparable: reclamo de categoría con el destinatario nombrado. "[Categoría] para [quién]".

Tres reglas duras que salen del análisis:

1. LA PRUEBA DEL TAPADO. Tapa el nombre "Rutax" y pregunta si el titular sigue identificando a
   alguien. Si se puede borrar "courier" y "entrega" y la frase sigue en pie, está mal. El titular
   tiene que contener el sujeto (courier), el objeto (entregas, pedidos) o ambos.
2. NO INVENTES CATEGORÍA. Un comprador escéptico no puede buscar en Google una categoría que no
   existe, y una palabra inventada le suena exactamente igual que el software que ya lo decepcionó.
   El rubro nombra su categoría con "última milla", "software de gestión de entregas", "software
   logístico" o "plataforma de entregas". Usa lenguaje que este comprador ya reconoce.
3. NADA DE MODA TECNOLÓGICA NI DE ABSOLUTOS. Cuatro de las 17 dicen "IA" en el titular y ninguna
   dice a quién le sirve: la moda ocupa el lugar del destinatario. Y el rubro evita los absolutos
   ("cero errores", "100%") porque a un comprador ya decepcionado un absoluto le confirma la
   sospecha.

EL ACTIVO DE POSICIONAMIENTO MÁS GRANDE, y sale del análisis: de las 17 páginas, ninguna promete que
el software te cobre a tus clientes y te liquide a tus conductores. Ese silencio no es casual —el
dinero es local, contable y feo, y para un producto global es un pozo sin fondo— y Rutax sí lo hace.
Es territorio libre.

Tres formulaciones validadas contra el análisis, para que partas de ahí:
- "Un solo sistema para toda la operación de tu courier" — categoría pura, la más segura.
- "La operación y el dinero de tu courier, en un solo sistema" — LA RECOMENDADA: es la única que
  dice algo que ninguna de las 17 dice, y lo dice a nivel de categoría, no de detalle.
- "Centraliza tus pedidos, despacha con tu flota, cierra el mes cuadrado" — capacidad en ritmo de
  tres.

No estás obligado a usarlas tal cual: refínalas o propón una mejor. Pero la que entregues tiene que
pasar las tres reglas de arriba, y me tienes que decir contra qué patrón del análisis la escribiste.

Y NO LO POSICIONES COMO UNA APP DE OPTIMIZACIÓN DE RUTAS. El análisis lo confirma: ninguna empresa
de peso del rubro se llama a sí misma "optimizador de rutas" en su titular — el ruteo aparece como
función, nunca como identidad. En Rutax además el ruteo fue lo último que entró al alcance y cuelga
del motor de dinero.

## LA ESTRUCTURA

El análisis trae el esqueleto modal de las 17 páginas con su frecuencia y las reglas que se derivan.
Dos son obligatorias acá:

- EL HERO NO VENDE: UBICA. Ninguna de las buenas intenta cerrar la venta arriba. Arriba se responde
  "¿qué es esto y es para mí?".
- LA PRUEBA VIENE ANTES QUE LA FUNCIÓN. En 15 de 17, los logos o las cifras van entre el hero y el
  primer bloque de producto. El visitante necesita permiso para seguir leyendo antes de que le
  expliquen nada.

Y una tercera que aplica directamente: el bloque de "cómo funciona" en pasos es lo que separa a las
páginas que le venden a pymes de las que le venden a corporaciones. Las seis que lo tienen son todas
las que le hablan a alguien que hace la implementación él mismo. Rutax cae exactamente ahí, así que
ese bloque va sí o sí.

SÉ HONESTO CON LA PRUEBA. El análisis muestra que 15 de 17 abren con logos de clientes y 16 traen
testimonios. Rutax hoy no tiene esa munición: está en piloto. Diseña esos bloques, pero dime cuáles
el negocio puede sostener HOY y cuáles quedan como espacio reservado, en vez de rellenarlos con
nombres inventados. Un logo falso en una página que este comprador va a verificar es peor que no
tener logos.

## NO ES UNA SOLA PÁGINA si no conviene que lo sea

Decide tú la arquitectura del sitio, con estas reglas:
- Cada página se gana su existencia por una de estas tres razones, y lo declaras: responde a una
  intención de búsqueda distinta, atiende un momento distinto del embudo, o desarma una objeción
  distinta. Si no hace ninguna de las tres, es una sección de otra página.
- Todas conducen al mismo destino: agendar. Un sitio con varios destinos no es un embudo.
- Sin canibalizarse: dos páginas que compiten por la misma búsqueda se hunden las dos.
- Pocas y densas antes que muchas y flacas.

## QUÉ MÁS QUIERO QUE RESUELVAS

- El mapa del sitio con su navegación —encabezado, pie, enlaces cruzados— y el argumento de por qué
  esa arquitectura y no otra.
- La estructura y el flujo de lectura de cada página, sección por sección, con el argumento de por
  qué cada una va donde va y qué hace avanzar al lector.
- Copy persuasivo entero, escrito, no descrito. Titular, subtítulo, cada sección, cada llamada a la
  acción, preguntas frecuentes, pie. Concreto y verificable: cifras y hechos por sobre adjetivos.
- LAS INTEGRACIONES SON EL ÁNGULO DEL MENSAJE, y el análisis trae los cuatro tratamientos que usa el
  rubro, de menor a mayor compromiso. Elige uno y justifícalo. Usa solo las integraciones que el
  inventario declara como reales, con su estado: esto se le vende a alguien que va a probarlo la
  semana siguiente.
- SEO: título y meta descripción por página, jerarquía de encabezados, palabras clave reales que
  este comprador buscaría en Chile, datos estructurados, textos alternativos, y qué necesita para
  cargar rápido. Hoy el proyecto no tiene NADA de esto: ni metadata social, ni robots, ni sitemap.
- El plan visual, pieza por pieza. Para cada imagen: qué muestra, de dónde sale y por qué esa. Dos
  fuentes: maquetas del producto rediseñado —las que tú mismo acabas de diseñar, no capturas de lo
  que existe hoy, que es justo lo que estamos reemplazando— y fotografía real de logística (indica
  qué buscar y con qué criterio se elige).
## EL MOVIMIENTO DEL SITIO — decidido, y va en contra de la norma del rubro a propósito

Acá el sitio se aparta del producto: **movimiento alto, con la parte superior animada y piezas de
producto en movimiento a lo largo de la página.** El análisis muestra que casi ninguna de las 17
predomina con eso —la mayoría usa capturas estáticas— así que es una apuesta deliberada. Y por eso
mismo tiene una condición: **esa animación tiene que DEMOSTRAR algo, no decorar.** Una animación
alta y vacía es exactamente lo que hace que una página se lea como software genérico, que es el
riesgo que estamos aceptando.

**Qué muestra la animación de arriba — está decidido: del pedido al dinero, en una sola secuencia
continua.** Un pedido entra solo desde Mercado Libre, ya con su dirección y su coordenada; se asigna
a un conductor; el conductor lo entrega; y aparecen sus dos líneas — el cobro al seller y el pago al
conductor, cuadrados. En ocho segundos demuestra exactamente lo que promete el titular, y enseña el
foso: el análisis confirmó que **ninguna de las 17 páginas promete cerrar el dinero**.

Resuélvela con el detalle de una pieza de producto, no de un guion: qué se ve en cada beat, cuánto
dura cada uno, dónde descansa la vista, qué pasa si el visitante llega a mitad de ciclo, si vuelve
a empezar o se queda en el estado final, y **qué se ve mientras carga** — un primer cuadro estático
que ya comunique, nunca un hueco.

Las piezas que se mueven son **maquetas del producto rediseñado**, las que tú mismo acabas de
diseñar. Fieles: si en el sitio aparece una tabla de pedidos, es la que diseñaste en la pasada 2.

**Las tres condiciones que tiene que cumplir el movimiento alto:**
1. **La velocidad de carga es señal de calidad para este comprador.** Declara el peso de cada pieza
   y qué se carga primero. Si la página pesa como una página de software genérico, ya perdiste el
   argumento antes del primer párrafo.
2. **Nada se rompe si el movimiento no corre.** Si usas cifras animadas, el valor final va en el
   HTML y la animación es un adorno encima: en el análisis hay una empresa cuya prueba social se lee
   "0% más rápido" y "0 hrs ahorradas" cuando su contador no arranca. Su evidencia de que el
   producto sirve se convirtió en la evidencia contraria.
3. **"Reducir movimiento" no es apagar la página.** Con esa preferencia activada, cada pieza animada
   tiene una versión estática que comunica lo mismo. Diséñala, no la dejes como ausencia.

Y aparte de la de arriba, define dónde más va movimiento —demostraciones cortas de uso real— con
qué muestra cada una y cuánto dura. Una demostración de que las direcciones entran solas, sin
digitar, vale más que cualquier párrafo.
- EL FLUJO DE AGENDAMIENTO COMPLETO, y trátalo como lo que es: el punto donde se decide todo. Qué se
  le pide al visitante y qué no —cada campo de más cuesta conversión, cada campo de menos entrega una
  reunión sin calificar—, qué ve al enviar, qué recibe por correo, qué pasa si vuelve, y el estado de
  error del formulario, que en un embudo de un solo destino es la pantalla más cara del sitio. Sin
  precio visible, el peso de calificar se traslada al texto y al formulario. Resuelve esa tensión.
- Escritorio, tablet y teléfono; modo claro y oscuro.

Al terminar, escribe la FICHA DE CIERRE del sitio y el registro de objetos actualizado por última
vez. Ese registro es el documento que el equipo se lleva a la construcción.
```

---

# ▼ PASADA 6 — Bajada al código

Esto ya no se hace en Claude Design sino en Claude Code, sobre el repositorio.

⚠️ **No existe un comando que baje tu diseño al repo.** Comprobado: la herramienta de sincronización
de Claude Design va en el sentido contrario —sube una biblioteca de componentes local hacia un
proyecto de tipo sistema de diseño— y los lienzos donde hiciste este trabajo no son de ese tipo. El
puente es manual, y es más simple de lo que suena: **lo que produjo Design es texto e imágenes, y
ambos se guardan como archivos.**

## Paso 1 — Sacar los artefactos de Claude Design

⚠️ **Claude Design produce lienzos, no archivos de texto.** El sistema, los tokens, el registro de
objetos y todo el copy volvieron como mensajes de chat. No hay ningún `.md` que descargar, y no
tienes que copiarlos scrolleando la conversación.

**Vuelve al mismo hilo donde hiciste el trabajo y pídele que te los emita.** El contexto sigue ahí,
así que regenerarlos es barato. Pega estos encargos **uno por mensaje** —si los pides todos juntos
la respuesta sale truncada— y guarda cada respuesta en su archivo dentro de `docs/diseno/`.

### Los siete encargos de extracción

**1 → `SISTEMA-DISENO.md`**
```
Emite el sistema de diseño completo y consolidado en UN solo bloque de markdown, listo para guardar
como archivo. Incluye todo lo que definimos: la ruta de marca elegida y su sistema de identidad, la
tipografía con su escala, el color y los dos temas, espaciado y densidad, elevación y radios,
iconografía, el movimiento con sus cuatro momentos de firma, el catálogo de componentes con sus
variantes y estados, el sistema de estado del dominio, el sistema de etiquetas, la voz y las
plantillas de mensaje, los cuatro sub-sistemas —cartografía, visualización de datos, sonido y
vibración, impresos— y las reglas de accesibilidad y rendimiento. Sin resumir: es el documento que
va a usar quien lo construya, y no va a tener esta conversación delante.
```

**2 → `tokens.css`**
```
Emite ahora solo los tokens, como un bloque de CSS real y pegable —no una tabla ni una descripción—
con los nombres definitivos, agrupados por rol y comentados. Incluye los valores para tema claro y
para tema oscuro, y los tokens de tipografía, espaciado, radio, elevación y movimiento, no solo los
de color.
```

**3 → `REGISTRO-OBJETOS.md`**
```
Emite el registro de objetos de dominio compartidos completo y en su última versión, en tablas.
Para cada objeto: su representación canónica, sus variantes por densidad, sus variantes por rol con
las restricciones de privacidad marcadas, el vocabulario de sus campos, y sus estados.
```

**4 → `SISTEMA-MENSAJES.md`**
```
Emite el sistema de mensajes completo en un solo bloque: la voz y las reglas de redacción, y después
todo el contenido — confirmaciones irreversibles, éxitos, las seis familias de error, los estados
vacíos en sus tres tonos, las advertencias que no son errores, la ayuda contextual, las
notificaciones push y los correos con su asunto y su cuerpo. Organizado para poder buscarlo.
```

**5 → `SITIO-COMERCIAL.md`**
```
Emite todo el sitio comercial en un solo bloque: el mapa del sitio con su argumento, la estructura
de cada página sección por sección, el copy completo escrito, el SEO por página, el plan visual
pieza por pieza, la especificación de la animación de la parte superior, y el flujo de agendamiento
con todos sus estados.
```

**6 → `COSTO-COMPONENTES.md`**
```
Emite la tabla de costo de implementación: componente por componente, si se logra re-estilando uno
de los que ya existen en el producto o si hay que construirlo desde cero, y qué pantallas cubre
cada uno.
```

**7 → `FICHAS-DE-CIERRE.md`**
```
Emite una ficha de cierre única y consolidada de todo el trabajo: qué se diseñó en cada pasada, los
nombres exactos de todos los componentes y variantes, las decisiones de sistema que rigen, lo que se
marcó NUEVO, lo que quedó abierto y lo que no se diseñó. Escríbela para que otra sesión pueda
continuar sin tener esta conversación.
```

### Y las pantallas

Exporta las láminas desde el lienzo en PNG o PDF y déjalas en `docs/diseno/pantallas/`, con nombre
por pantalla. Nadie las va a leer programáticamente, pero sin ellas la implementación se hace de
memoria y deriva.

### Si el hilo ya no da más

Si la conversación está muy cargada y las respuestas salen cortas o vagas, abre una sesión nueva,
pega el preámbulo de re-anclaje con lo que sí tengas, y pide los que falten de a uno. Es peor que
hacerlo en el hilo original, pero funciona.

## Paso 2 — Verificar antes de tocar código

Estas siete cosas ya están resueltas en el código actual y **no se pueden perder** en el reemplazo.
Si alguna no está en lo que bajaste, vuelve a Design a pedirla antes de empezar:

1. Los ~147 valores de estado del inventario, cada uno con su tratamiento — no una regla genérica.
2. Modo claro y oscuro completos en las cinco superficies.
3. Los tres tonos de estado vacío, distinguibles entre sí.
4. El modal de confirmación irreversible con su acto explícito y sin cierre accidental.
5. La tabla financiera con montos alineados y legibles en columna.
6. La selección masiva funcionando con el dedo, no solo con puntero.
7. Los tokens como variables CSS con nombres definitivos, listos para consumir.

Y los cuatro sub-sistemas que no heredan de los tokens: **cartografía, visualización de datos,
sonido y vibración, e impresos.** El del mapa es el que más se salta.

## Paso 3 — El orden de implementación

Sale del desglose de costo que pediste en la pasada 1·B, y el orden importa porque esto se construye
sobre un producto en producción con clientes reales:

1. **Los tokens primero.** Es un solo archivo y lo cambia todo de golpe. Si el sistema está bien
   hecho, buena parte del producto se re-tiñe sin tocar una pantalla.
2. **Los componentes que se re-estilan**, que cubren muchas pantallas por poco trabajo.
3. **Los componentes que hay que construir de cero.**
4. **Las pantallas, superficie por superficie**, empezando por las siete arquetipo: son las que
   fijan el patrón que las demás copian.
5. **Los sub-sistemas especializados**, que son trabajo aparte y no bloquean lo anterior.
6. **El sitio comercial**, que no depende del producto salvo por las maquetas que muestra.

⚠️ **Lo nuevo y lo viejo van a convivir meses.** Por eso el sistema pedía explícitamente evitar
decisiones que solo funcionen si todo cambia el mismo día. Al implementar, verifica que se cumpla:
una pantalla ya migrada y una sin migrar tienen que poder verse una al lado de la otra sin que
parezcan dos productos.

## Paso 4 — Arrancar

Con `docs/diseno/` poblado, abre una sesión de Claude Code en el repositorio y pide la primera
tajada. Una sugerencia de primer encargo, que es el que valida todo lo demás:

> Lee `docs/diseno/SISTEMA-DISENO.md` y `docs/diseno/tokens.css`. Reemplaza los tokens actuales de
> `src/app/globals.css` por los nuevos, mapeando cada token viejo al que le corresponde, y dime qué
> quedó sin equivalente en cada dirección. No toques ninguna pantalla todavía: quiero ver qué pasa
> con el producto entero solo cambiando la capa de color, tipografía y espaciado.

Eso te dice en una sola tajada si el sistema aguanta el producto real, antes de invertir en
ochenta y cuatro pantallas.

---

# Cómo juzgar cada pasada

No hace falta ser diseñador. Si algo de esto falla, se corrige **antes** de la pasada siguiente:
arrastrarlo multiplica el error.

**Después de la 1·A**
1. ¿Las tres rutas son distintas en IDEA, o son tres dibujos del mismo concepto?
2. Mira el favicon a 16 px y el ícono en la pantalla de inicio del teléfono. Una marca que solo
   funciona grande no sirve para este producto.
3. ¿Aguanta el monocromo de una térmica? Si no, la etiqueta de envío va a quedar sin marca.

**Después de la 1·B**
4. ¿Puedes explicarle a otra persona por qué esa paleta y esa tipografía? Si la justificación no
   menciona ni al coordinador ni al conductor, el sistema es genérico.
5. ¿El registro de objetos fija UN nombre por concepto y por campo? Hoy el bulto es pedido, envío,
   paquete y bulto según la pantalla.
6. ¿Hay una regla escrita de qué se anima y qué no, y los cuatro momentos de firma se presentaron
   **encadenados como un caso de uso real** y no como especímenes sueltos? ¿Tienen todos el mismo
   carácter, o parecen de cuatro productos distintos?
6b. ¿Llegó la equivalencia de movimiento entre la web y la app nativa? Sin eso las dos superficies
   se van a sentir distintas por más que compartan los colores.
7. ¿Están resueltos TODOS los valores de estado, o hay un "y los demás igual"?
7b. ¿Llegaron los cuatro sub-sistemas especializados —mapa, gráficos, sonido y vibración, impresos—
   o se despacharon en una línea? El del mapa es el que más se salta, porque es el único que no
   hereda de los tokens: si no está, el mapa va a ser lo único del producto que no se parezca al
   producto.
7c. La paleta de gráficos, ¿funciona en claro y en oscuro sin chocar con los colores de estado del
   dominio, que ya están tomados?
8. ¿Llegó el desglose de qué componente se re-estiliza y cuál se construye de cero? Sin eso no
   puedes presupuestar la implementación.

**Después de la 2**
9. Pon lado a lado la pantalla 1 y la 5. ¿Se reconocen como el mismo objeto? Si no, el registro
   está mal y hay que corregirlo ahora.
10. ¿La emisión de factura se siente más pesada que las demás, y las cuarenta acciones ordinarias
    siguen siendo livianas? Ese contraste es el encargo.
11. ¿Operarías la pantalla del conductor con una mano y con guantes?
11b. **La prueba de los siete perfiles.** Recorre los siete arquetipos y pregúntate, en cada uno,
    para quién está diseñado. Si más de tres apuntan al mismo perfil, el sistema se afinó contra un
    solo usuario y los otros van a heredar lo que sobre. Especialmente: ¿la pantalla de conciliación
    se siente hecha para alguien meticuloso que hoy usa Excel, o es una tabla más? ¿La del seller se
    siente hecha para alguien que no sabe de logística?
12. ¿La selección masiva funciona con el dedo, o solo encogieron la tabla?
12b. La tabla viva: ¿lo que entra nuevo se anuncia sin insertarse solo? Ponte mentalmente a
    seleccionar treinta filas y pregunta si algo se te movió debajo.

**Después de cada bloque de la 3**
13. Toma tres capacidades al azar del inventario y búscalas en el diseño. Si no las encuentras, se
    perdieron.
14. ¿Las adiciones están marcadas NUEVO? Si no distingues lo rediseñado de lo inventado, no puedes
    aprobar por partes.
15. ¿Está el estado vacío, el de carga, el de error y el de sin permiso? Son los que faltan hoy.
15b. ¿Cada pantalla llegó en modo claro Y en modo oscuro? Es lo primero que se cae cuando el volumen
    aprieta, y después nadie vuelve a hacerlo.
16. ¿Entregó su ficha de cierre?

**Después de la 4**
17. ¿Los mensajes de error dicen qué pasó y qué hacer? Si el rediseño produce más "Error al …" con
    mejor tipografía, no sirvió.
18. ¿Se respetó el límite del tratamiento, o hay un "usted" suelto dentro de la aplicación?

**Al cerrar**
19. Pon lado a lado la tabla del courier, el portal del seller y la app del conductor. ¿Parecen el
    mismo producto hecho por el mismo equipo? Esa es la prueba final, y es la que falló antes.
