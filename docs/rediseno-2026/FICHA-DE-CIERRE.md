# Rutax · Ficha de cierre consolidada

**Versión final · 22 de agosto de 2026**

Este documento reemplaza a `FICHA-DE-CIERRE.md` y `FICHA-DE-CIERRE-PASADA-2.md`. Está escrito para que **otra sesión pueda continuar sin tener la conversación original delante**.

---

## Qué es Rutax

SaaS B2B vertical para empresas de última milla —*couriers*— en Santiago de Chile. El courier recibe pedidos desde varias fuentes (Mercado Libre Flex, Shopify y pedidos same-day propios), los despacha con su flota, y cierra su trastienda de dinero: **cada entrega genera sola su línea de cobro al seller y su línea de liquidación al conductor, conciliadas entre sí.** Es multi-tenant: cada courier es un cliente, y dentro de él viven sellers y conductores que solo ven lo suyo.

**Ocho perfiles:** coordinador · supervisor · administración · dueño · seller · conductor · super-admin de Rutax · y el comprador final, que no tiene cuenta y llega a una pantalla pública de seguimiento.

**Pila técnica:** Next.js, Tailwind, shadcn/ui. La app del conductor es **nativa** y no comparte código con la web. Se construye sobre un producto en producción con clientes reales: **lo nuevo y lo viejo van a convivir meses.**

---

## Los documentos del sistema

Todo lo que sigue está escrito y es consultable sin esta conversación:

| Archivo | Qué contiene |
|---|---|
| `RUTAX-SISTEMA-DE-DISENO.md` | Las reglas del sistema completo |
| `tokens.css` | El insumo: 4 temas, tipografía, espaciado, radio, elevación, movimiento, impreso, mapeo a Tailwind |
| `RUTAX-REGISTRO-DE-OBJETOS.md` | 18 objetos con canónica, densidades, roles con restricciones legales, vocabulario y estados |
| `RUTAX-SISTEMA-DE-MENSAJES.md` | Voz, reglas de redacción, y todo el contenido escrito con su clave |
| `RUTAX-SITIO-COMERCIAL.md` | Mapa del sitio, copy completo, SEO, plan visual, animación, agendamiento |
| `RUTAX-COSTO-DE-IMPLEMENTACION.md` | 100 componentes con su costo y las pantallas que cubre |

**Tableros visuales** (`.dc.html`): `Marca` · `Fundamentos` `Paleta` `Tipografia` `Estados` `Componentes` `Movimiento` `Objetos y Voz` `Subsistemas` `Mensajes` · los 7 arquetipos `P1`–`P7` · los bloques `B1a`–`B8` · `Sitio comercial`.

---

# 1 · Qué se diseñó en cada pasada

## Pasada 1 · La marca

Tres rutas distintas en idea. **Elegida: 1a · Cuadre**, con paleta *Señal* (teal eléctrico sobre grafito frío) y producto oscuro por defecto.

**El símbolo:** dos rectángulos macizos desfasados —la partida doble—. Representa que cada entrega deja dos líneas que cuadran. Responde a la idea de **infraestructura financiera**, que es el foso del producto.

**Por qué esos rectángulos y no un dibujo:** funcionan a 16 px de favicon, a 1,3 mm en una térmica de 203 ppp, en monocromo, y **al lado de la marca de un courier cualquiera que no controlamos**. El «powered by» del seguimiento público está diseñado como pieza, no como pie de página: es el único canal de Rutax hacia consumidores finales y genera una impresión por entrega.

**Tipografía:** Chivo (400/500/600/700) y Azeret Mono (400/500/600). Elegidas contra la petición explícita de no parecer un proyecto genérico de IA: Chivo tiene una `a` de doble piso con remate diagonal y una `g` de un solo piso que la distinguen de Inter a primera vista; Azeret Mono sostiene las columnas de cifras sin negrita sintética.

## Pasada 2 · El sistema

Color, tipografía, escala, espaciado, radio, elevación, iconografía, densidad y movimiento. **Cuatro temas de primera clase**, ninguno derivado del otro. Los 29 vocabularios de estado con sus ~147 valores. El registro de objetos. Los sub-sistemas: cartografía, visualización de datos, sonido y vibración, impresos. Las 8 plantillas de mensaje. El catálogo de 100 componentes con su costo.

## Pasada 3 · Los siete arquetipos

Los siete patrones de los que se deriva todo el resto:

| Archivo | Pantalla | Patrón que fija |
|---|---|---|
| `P1 Pedidos` | Listado con filtros | Marco, cajones, filtros en URL, actualización mixta, los 5 estados obligatorios |
| `P2 Asignar` | Selección masiva con acción en bloque | Selección táctil, barra de selección, resultado en bloque |
| `P3 Detalle` | Detalle con acciones de consecuencia | Panel/página, zona de consecuencia, trazabilidad |
| `P4 Emitir factura` | Confirmación irreversible | La escalera de fricción de 3 peldaños, verificación previa |
| `P5 Registrar entrega` | Captura en terreno | Módulo de captura, progreso con pasos, registrado-sin-confirmar |
| `P6 Conciliacion` | Bandeja de excepciones | Máquina de transiciones, alarma selectiva |
| `P7 Conectar cuentas` | Autoservicio de reparación | Tarjeta de salud, bloque de falla externa, paso previo obligatorio |

## Pasada 4 · Los ocho bloques · ~90 pantallas

| Bloque | Contenido | Pantallas |
|---|---|---|
| `B1a` `B1b` `B1c` | **Operación del courier** — Torre de control con sus 3 zooms y 4 estados, preparación del día, incidencias, manifiestos con secuenciación y redistribución, conductores, dashboard, crear pedido same-day | 10 |
| `B2a` `B2b` | **Dinero** — períodos con aprobación en lote y verificación previa, detalle del período, liquidaciones con ajuste manual y pagos en lote, detalle de liquidación, cobranza | 5 |
| `B3a` `B3b` | **Configuración y puesta en marcha** — el asistente de 5 pasos con su pantalla de cierre, tarifas, zonas y cortes, bodegas, retiro, integraciones, exportar, mi plan, sellers, equipo | 10 |
| `B4` | **Portal del seller** — inicio, bienvenida, mis pedidos y detalle, nuevo pedido, mis cobros y detalle, cobro facturado, mis incidencias, bodegas, pedido Flex | 10 |
| `B5` | **App del conductor** — manifiesto, detalle de parada, parada de retiro, mis liquidaciones, punto de término (3 pasos), retiro con escaneo, histórico de retiros, traspaso, preferencias, permisos, guardado sin confirmar | 12 |
| `B6` | **Backstage de Rutax** — couriers, ficha, crear, suscripciones, planes, equipo, bitácora, sesiones de soporte, salud de integraciones, métricas, estado del sistema, avisos, mi cuenta | 13 |
| `B7` | **Sin sesión** — registro, activación, aceptar invitación con 5 errores, dos inicios de sesión, recuperar, restablecer, seguimiento público con 5 estados y 2 casos difíciles, legales, sin conexión, error general, no encontrado, tarjeta de mensajería | 12 + 1 pieza |
| `B8` | **Piezas impresas** — etiqueta térmica 10×15, etiqueta carta, factura PDF, liquidación PDF, manifiesto impreso | 5 |

## Pasada 5 · Contenido y sitio

Todo el sistema de mensajes escrito, y el sitio comercial completo.

---

# 2 · Componentes y variantes · los nombres exactos

100 componentes. Los nombres son los definitivos y **se usan tal cual en el código y en la conversación**.

## 2.1 Primitivas y controles · 19

`botón` · `botón de peldaño 3` · `campo de texto` · `área de texto` · `campo de monto CLP` · `campo numérico` · `selector` · `selección múltiple` · `casilla` · `casilla táctil de 56 px` · `interruptor` · `etiqueta de campo` · `ayuda de campo` · `error de validación en línea` · `campo de búsqueda` · `selector de fecha` · `credencial de una sola vez` · `escala de texto de cuatro pasos` · `selector de tema de tres estados`

## 2.2 Estado y etiquetado · 10

`distintivo de estado` · `distintivo inerte con trama` · `etiqueta de procedencia` · `glifo de estado de dirección` · `bandera de bloqueo` · `etiqueta` · `distintivo de modo de pruebas` · `contador de cajón` · `barra de cajones con excluido` · `distintivo de acuse de escaneo`

## 2.3 Tablas y listados · 14

`tabla` · `tabla con selección múltiple` · `selección táctil en tres niveles` · `barra de selección con composición` · `tabla de densidad 32` · `tabla financiera` · `bloque de composición` · `fila vigente / programada` · `esqueleto de tabla` · `paginación` · `aviso de truncamiento` · `franja de cambios pendientes` · `señal de cambio en sitio` · `fila de salud de conexión`

## 2.4 Contenedores y superficies · 17

`tarjeta` · `mosaico de magnitudes` · `panel lateral` · `panel de detalle con zona de consecuencia` · `hoja móvil` · `modal` · `modal de acto explícito` · `popover` · `menú desplegable` · `pestañas` · `separador` · `tarjeta de trazabilidad` · `tarjeta de resultado en bloque` · `bloque de capacidades` · `panel de ajuste manual` · `atribuidor de pago` · `indicador de folio disponible`

## 2.5 Marco y navegación · 8

`navegación lateral colapsable` · `navegación inferior móvil` · `navegación anidada de configuración` · `migas o retorno explícito` · `buscador global con teclado` · `centro de avisos` · `banner de sesión suplantada` · `aviso de configuración pendiente`

## 2.6 Retroalimentación · 12

`aviso embebido` · `notificación temporal` · `estado vacío` · `esqueleto de carga` · `barra de progreso` · `progreso con pasos nombrados` · `bloque registrado sin confirmar` · `tooltip` · `avatar` · `verificación previa` · `tarjeta de salud de conexión` · `bloque de falla externa`

## 2.7 Flujos y patrones compuestos · 11

`asistente por pasos` · `pantalla de cierre de asistente` · `formulario de configuración` · `formulario de alta con aviso en línea` · `escalera de fricción` · `pantalla sin sesión` · `hoja de consentimiento` · `verificación por escaneo` · `módulo de captura` · `secuenciador de ruta` · `redistribución por conductor no disponible`

## 2.8 Sub-sistemas · 17

`tema de mapa` · `polígono de comuna` · `punto de entrega` · `marcador de conductor` · `mapa degradado` · `gráfico de barras` · `gráfico de líneas` · `paleta categórica de 5 series` · `semáforo de cumplimiento` · `vocabulario de sonido y vibración` · `notificación push` · `solicitud de permiso con explicación previa` · `etiqueta térmica` · `documento PDF carta` · `tarjeta de enlace compartido` · `línea de tiempo pública` · `plantilla de correo`

## 2.9 Costo

**31 re-estilo · 27 extender · 42 de cero.** El detalle por componente, con las pantallas que cubre cada uno, está en `RUTAX-COSTO-DE-IMPLEMENTACION.md`.

**De los 30 componentes existentes, 29 sobreviven.** El único que se reemplaza es `badge-estado`: su modelo de datos no soporta 29 vocabularios ni ejes múltiples en una fila.

---

# 3 · Las decisiones de sistema que rigen

Están agrupadas por origen. **Todas siguen vigentes.**

## 3.1 Color, tema y contraste

1. `--rx-accent` sirve para **fondo, borde y glifo**. Nunca para texto en tema claro; el teal como texto es `--rx-accent-text` (#007D69).
2. `--rx-fg-subtle` solo se usa **sobre `--rx-bg`**. Sobre `bg-raised`, `bg-sunken` o cualquier rampa de mapa baja de 4,5:1 y ahí va `--rx-fg-muted`.
3. **El tema `night` tiene dos niveles de texto, no tres.** El tercer gris no cumple AA sobre #05080A, así que no existe.
4. **Sin sombras.** La elevación se construye con escalón de fondo + borde + regla de acento de 2 px arriba.
5. **El color nunca es el único portador de significado.** Todo distintivo lleva tono, glifo y etiqueta.
6. **Las pantallas de dinero abren en tema claro**; la preferencia se guarda por usuario, no por pantalla.
7. **El banner de sesión suplantada es el único elemento que no cambia entre temas.** Vive en el marco, no en la pantalla; no se colapsa, no se oculta al hacer scroll, no se vuelve ícono.

## 3.2 La app del conductor

8. **Tres temas, no dos:** `sun` (extremos puros, 21:1, distintivos en sólido pleno), `dark` (el base del sistema) y `night` (blanco tope #B9C6C4, −38% de pico de luminancia).
9. **Orden de autoridad del tema:** preferencia manual > sensor de luz con histéresis > hora. La **preferencia manual caduca al fin del turno**: un ajuste que se olvida encendido es peor que no tenerlo.
10. **Histéresis:** dos umbrales separados (entra a Sol sobre 8.000 lux, sale bajo 3.000) y **90 s mínimos de permanencia**. Eso resuelve el subterráneo a las 17:00: baja a *Día*, no a *Noche*, y al salir vuelve a Sol sin parpadeo.
11. Los tres temas comparten **disposición, glifos y posiciones**. Solo cambian los valores de color y el pico de luminancia.
12. **Bajo sol, los distintivos van en sólido pleno**, nunca en fondo teñido.
13. **Un permiso se pide en el momento en que se usa**, con una frase de para qué, y nunca al abrir la app.
14. **Toda confirmación que el conductor no puede mirar tiene señal de oído y de mano**, distinguible sin ver la pantalla, y la vibración sola tiene que bastar.
15. **Un traspaso entre personas necesita las dos voluntades.** Nada entra al trabajo de alguien sin que lo acepte.
16. **Una preferencia del conductor no se reporta a su coordinador.** Si apagarla lo deja sin información, la información tiene que estar disponible por otra vía —no vigilada.
17. **No hay trabajo sin conexión.** No hay cola persistente, ni bandeja de pendientes, ni pantalla de «sin conexión». Hay reintento automático con aviso, y la advertencia de que cerrar la app pierde lo no confirmado.

## 3.3 Dinero

18. **Toda cifra de una tabla financiera lleva su rótulo** —bruto o neto— en la cabecera y en el pie.
19. **Las tablas de dinero se agrupan por concepto con subtotal**, no línea por línea; el detalle completo es un enlace.
20. **Todo negativo lleva signo menos real, tono falla y su causa en la misma fila**, enlazada al objeto que la originó.
21. **El `bloque de composición` es obligatorio** junto a cualquier cifra que no sea la suma trivial de una columna.
22. **Rutax no muestra impuestos:** los calcula y los muestra el documento tributario. La factura PDF es el único lugar del producto con IVA.
23. **Un período cerrado va en solo lectura, sin composición:** lo que ya no se mueve no se explica, se documenta.
24. **Un motivo escrito por un interno que un externo va a leer** —conductor o seller— **se declara como tal en el formulario**.

## 3.4 Configuración

25. **No hay autoguardado** en configuración: guardado explícito por sección, con acuse.
26. **Todo formulario de edición llega precargado con el valor vigente.** Un formulario de edición que arranca en blanco es un formulario de creación disfrazado.
27. **Nada se borra: se desactiva.** Y **todo lo desactivado tiene cajón y vuelta**. Un estado sin transición de salida no se dibuja.
28. **Lo vigente y lo programado conviven en la misma tabla** cuando el cambio tiene fecha de vigencia.
29. **Un asistente sin pantalla de cierre no está terminado**, y el estado que la dispara es el mismo que apaga el aviso del marco.
30. **Un cambio de permisos se explica con el catálogo de capacidades** —pierde / gana / sigue sin tener—, nunca con texto escrito a mano.
31. **Una credencial que se muestra una sola vez lo advierte antes de generarla**, y ofrece copiarla en el mismo bloque.

## 3.5 Portal del seller

32. **El portal no gana densidad al crecer el ancho: gana aire.** Ninguna pantalla del seller agrega columnas en escritorio.
33. **Un mismo valor de estado puede tener etiqueta visible distinta en el portal** —«En camino», «Nadie recibió»— siempre que conserve tono y glifo, y quede declarado. **Es la única superficie con este permiso.**
34. **Toda pantalla del portal tiene una salida al courier**, y el pie con «powered by Rutax» es el único lugar donde aparece nuestra marca.
35. **Una pantalla no promete una acción que la interfaz no ofrece:** o se construye o se retira el texto.
36. **El seller elige su tema.** Es su portal, aunque la marca sea del courier.

## 3.6 Backstage

37. **Ninguna acción se confirma con un diálogo nativo del navegador.** Si es peldaño 2 o 3, es `modal de acto explícito`.
38. **Toda acción sobre la cuenta de un tercero exige motivo escrito** y queda a nombre de quien la hizo.
39. **El segundo factor se vuelve a pedir por acción**, no por sesión, cuando la acción cruza la frontera de una empresa.
40. **Una bitácora de auditoría es de solo lectura para todos los roles.** Si alguien puede borrar una línea, no es una bitácora.
41. **Todo objeto se muestra con su empresa al lado.** Un objeto sin dueño visible ahí es un error de lectura esperando ocurrir.

## 3.7 Sin sesión

42. **La marca la decide el dueño de la relación:** Rutax cuando el visitante es nuestro cliente, el courier cuando es cliente del courier, neutra cuando no lo sabemos.
43. **El nombre del courier en texto es la versión canónica**; su logo es una mejora opcional. Ninguna pieza puede verse incompleta sin él.
44. **Sin sesión, el tema lo decide el sistema operativo.** No hay selector donde no hay usuario.
45. **Una pantalla pública nunca confirma ni niega la existencia** de un correo, de un envío ajeno o de una cuenta.
46. **El estado que ve el comprador es una traducción, no un renombre:** mismo tono y glifo, otra redacción. Y nunca lleva el motivo de una falla.
47. **Una previsualización de enlace no dice estados:** se genera una vez y el enlace se reenvía días después.
48. **Un problema nuestro no le llena el teléfono al courier:** la falla de lectura no ofrece su contacto.

## 3.8 Impreso

49. **El papel tiene una sola versión.** Lo que tiene claro y oscuro son los controles que lo generan y el visor.
50. **En térmica** no hay grises, ni tramas de fondo, ni pesos bajo 400, ni texto bajo 15 px. La separación se hace con reglas de 2 y 3 px.
51. **Todo código impreso aparece dos veces:** legible a distancia y en su forma digitable sin guiones bajo el código de barras.
52. **Una etiqueta no lleva montos, ni datos del conductor, ni instrucciones de acceso.** El paquete pasa por manos ajenas.
53. **Toda pieza impresa con un total lleva su composición impresa al lado.** En papel no hay hover que explique una cifra.
54. **Una pieza impresa que se usa para trabajar lleva dónde escribir y la hora en que se imprimió**, con la advertencia de que lo posterior no aparece.
55. **El error de generación distingue el archivo del hecho:** «el PDF falló, la factura está emitida y su folio es el 1041».

## 3.9 Contenido

56. **Ningún error de dinero va en notificación temporal.** Van embebidos y se quedan.
57. **Todo mensaje de éxito de dinero lleva monto y contraparte.** «Listo» está prohibido ahí.
58. **Todo vacío de buena noticia lleva una cifra y la hora de la última revisión.**
59. **El botón que cancela dice «Volver»**, nunca «Cancelar»: en este dominio, cancelar es cancelar un pedido.
60. **Un error de integración dice siempre qué sigue funcionando**, y nunca repite el mensaje del proveedor.
61. **Ningún correo depende de una imagen:** el nombre del courier es texto.

## 3.10 Registro de objetos y transversales

62. **En el mapa se muestra el código de envío**, nunca la dirección ni el nombre del destinatario. Regla legal.
63. **Del conductor solo existe su última posición.** No hay recorrido histórico y no se puede dibujar uno.
64. **El punto de término es dato personal** bajo la Ley 21.431: consentimiento en tres pasos, versionado, revocable, **y nada se guarda antes del último paso**.
65. **Al seller nunca se le muestra el conductor, la tarifa, ni lo que el courier le paga al conductor.**
66. **Al comprador final nunca se le muestra** dirección, teléfono, nombre del destinatario, seller, conductor ni monto.
67. **El rojo en la Torre de control está reservado a la incidencia abierta.** Nada más en ese mapa lo usa.
68. **Cuando la fuente del pedido gobierna una parte del ciclo, la interfaz lo dice y cruza** en vez de ofrecer una acción que no manda. Vale para Flex en las cinco superficies.
69. **Solo el eje de ciclo usa distintivo con color.** Cuatro distintivos de color en una fila no se leen.
70. **El vocabulario es uno.** Un concepto, un nombre, igual en las cinco superficies.

## 3.11 Movimiento

71. **Movimiento funcional, más una firma de cuatro momentos y ni uno más:** el resultado de la asignación en bloque · la apertura del panel de detalle · el cierre de una parada en la app · la confirmación irreversible.
72. **Ninguna curva tiene rebote.** Un rebote en una confirmación de dinero es una falta de respeto al momento.
73. **«Reducir movimiento» no apaga: sustituye.** Cada patrón que dependía del movimiento activa su señal alternativa (borde permanente, salto de foco, fondo sostenido 3 s, anuncio para lector de pantalla, y **pausa de 600 ms antes de habilitar un peldaño 3**).

## 3.12 Sitio comercial

74. **Ninguna cifra aparece por animación:** el valor final va en el HTML y el movimiento es un adorno encima.
75. **Ninguna animación se repite en bucle.** Corre una vez al entrar en pantalla y descansa en su estado final.
76. **Toda pieza animada tiene su versión estática diseñada**, y es la que se usa en el correo y al compartir.
77. **No se lista una integración que no existe**, y cada una lleva su estado real.
78. **Las maquetas salen del producto rediseñado**, nunca del que estamos reemplazando.
79. **Cero imágenes arriba del pliegue.** La velocidad es parte del argumento.
80. **Un solo destino:** todas las páginas llevan a agendar.

---

# 4 · Lo que se marcó NUEVO

**28 cosas.** Todas están diseñadas y aisladas: **descartar cualquiera no obliga a rediseñar lo demás.** Ninguna ha sido aprobada ni descartada todavía.

| # | Qué | Bloque |
|---|---|---|
| 1 | La Torre de control muestra su hora de última actualización y su alcance | B1a |
| 2 | «Nada atascado» como vacío de buena noticia en la Torre, no como ausencia | B1a |
| 3 | El mapa degradado como estado válido, no como error | B1a |
| 4 | Redistribución por conductor no disponible, con su modal de reparto | B1b |
| 5 | Secuenciación de ruta con la razón escrita cuando no puede optimizar por cierre | B1b |
| 6 | Marca de disponibilidad del conductor visible para el coordinador | B1c |
| 7 | Se retira el «IVA 19%» del portal: no era IVA, era el residuo entre total y líneas | B2 |
| 8 | Rótulo bruto/neto obligatorio en cabecera y pie de toda tabla financiera | B2 |
| 9 | El cajón «Con problemas» filtra de verdad | B2 |
| 10 | Los chips de liquidaciones navegan, como los de los otros dos módulos | B2 |
| 11 | El motivo del ajuste manual viaja al PDF del conductor | B2 |
| 12 | Un solo conteo del que leen el banner y el asistente | B3a |
| 13 | La pantalla de cierre del asistente | B3a |
| 14 | Cambiar el rol de una persona activa, con su bloque de capacidades | B3b |
| 15 | Suspender y reactivar con su transición real | B3b |
| 16 | La ventana de corte precargada con el valor vigente | B3b |
| 17 | Cajón «Inactivas» con reactivación: los cinco estados sin salida | B3b |
| 18 | Ficha de seller: hoy el listado es terminal | B3b |
| 19 | Reportar un problema desde el portal del seller | B4 |
| 20 | Detalle de la incidencia con sus notas de resolución y su efecto en el cobro | B4 |
| 21 | Se retira el buscador global del portal; entra el local por código y destinatario | B4 |
| 22 | Los tres temas de la app del conductor | B5 |
| 23 | Escala de tamaño de texto en la app | B5 |
| 24 | Sonido y vibración: cuatro señales | B5 |
| 25 | Notificaciones push: tres momentos | B5 |
| 26 | Aceptación del receptor en el traspaso, hoy unilateral | B5 |
| 27 | La marca «REIMPRESA» con fecha y hora en la etiqueta reimpresa | B8 |
| 28 | La pantalla de «no encontrado» y el caso del enlace de Flex, que hoy caen en el 404 en inglés | B7 |

**Además, aprobado y ya integrado:** el panel inferior de registro de escaneo con log de repetidos (B5), pedido por el usuario durante la pasada 4.

---

# 5 · Lo que quedó abierto

Decisiones que **no son de diseño** y las toma el negocio o la ingeniería:

| Qué | Quién decide | Nota |
|---|---|---|
| **El número del precio** y si hay mínimo mensual para couriers de 1 a 5 conductores | Negocio | La página está diseñada y la unidad decidida: por conductor al mes. El precio por conductor se cae abajo de 5 |
| **Umbrales de lux (8.000/3.000) y permanencia mínima (90 s)** del tema de la app | Terreno | Son un punto de partida. Hay que ajustarlos **en la calle con un teléfono real**, a las 16:00 y a las 21:30 |
| **Si el courier ve que alguien de Rutax entró a su cuenta** | Negocio | Hoy no se le dice. Hay un argumento de confianza para decírselo |
| **Los 30 min de vencimiento de la sesión de soporte** | Operación | Si la mitad de los tickets necesita extenderla, el número está mal |
| **Los 7 días de vigencia de la invitación** | Operación | Vale medirlo contra cuántas vencen |
| **Guardar el logo del courier** | Producto | La tarjeta de mensajería ya está diseñada para recibirlo. Es una brecha chica con efecto en cada entrega |
| **El unitario de la factura** | Contabilidad / SII | Queda agrupado por comuna con unitario redondeado y total exacto. Si el SII exige que cada línea cuadre al peso, la salida es agrupar por tarifa real — no cambia el diseño |
| **Webhooks** | Ingeniería | Quedaron como formulario simple. Si el producto crece, van a necesitar registro de entregas fallidas |
| **La nota de crédito** | Producto | No existe. Cuando exista será un objeto hermano de la factura, y la ceremonia de emisión ya tiene el lugar donde iría su contraparte |

**Decisiones ya cerradas que no hay que reabrir:** el manifiesto impreso va en TÚ · la notificación «tu ruta está lista» se puede apagar y no se avisa al coordinador · no se manda correo al resolver una incidencia del seller · el acta de retiro no se imprime.

---

# 6 · Lo que NO se diseñó

## 6.1 Pantallas pendientes · 5

| Qué | Cuánto cuesta | Nota |
|---|---|---|
| **Las cuatro anulaciones** —cobro de un pedido, liquidación de un pedido, línea de liquidación, pago de una visita | Una pasada corta | Son cuatro peldaños 2 con la misma anatomía. **Los cuatro textos de confirmación ya están escritos** en el sistema de mensajes |
| **Historial de entregas y pagos del conductor** (backoffice) | Media pasada | Es la `tabla financiera` filtrada por persona |
| **Detalle de bodega** completo | Media pasada | Modal con contacto, instrucciones y pago por visita. Aplicación directa del `formulario de configuración` |
| **Ficha de seller** desplegada | Media pasada | Marcada NUEVO #18. Sus pedidos, bodegas, tarifas, períodos y conexiones |
| **Torre de control en móvil** | Media pasada | Es del **coordinador**, no del conductor: para cuando está en la bodega o fuera de la oficina. Va en el bloque 1 |

## 6.2 Contenido pendiente

- **Los 42 mensajes de éxito de módulo único** —renombrar una zona, copiar un dato—. El molde los resuelve sin ambigüedad; escribirlos sería inventar variedad donde no hay decisión.
- **Los cuerpos completos de los 6 correos que ya existen.** Quedaron con asunto, acción y la regla que los cambia; sus párrafos se derivan de la plantilla.
- **Términos y política de privacidad.** Texto legal en USTED: lo escribe un abogado, no el diseño. **La pantalla que los muestra ya está diseñada**, con su versión y su fecha de vigencia.

## 6.3 Sitio comercial pendiente

- **Las cuatro páginas secundarias en detalle.** Están definidas en su razón, su estructura sección por sección, su H1, su título y su meta — pero no dibujadas.
- **Las dos fotografías.** Especificadas con su criterio de elección, pero son una compra, no un diseño.
- **El sitio en tablet y teléfono.** Especificado en la animación y en el marco, no maquetado.

## 6.4 Lo que se decidió NO diseñar

| Qué | Por qué |
|---|---|
| **Trabajo sin conexión** en la app | Se retiró del producto. No hay cola persistente, ni bandeja de pendientes, ni pantalla de «sin conexión» |
| **Acta de retiro impresa** | Nadie la echó de menos: vive en pantalla y en la app |
| **Recorrido histórico del conductor** | No existe el dato y no se puede dibujar uno |
| **Blog del sitio** | No se abre hasta que exista quien lo escriba semanalmente |
| **Refinamiento visual del backstage** | Uso interno: hereda el sistema y arregla lo roto, nada más |

---

# 7 · Cómo continuar

## 7.1 Orden sugerido

1. **Aprobar o descartar los 28 NUEVO.** Es lo único que bloquea: están aislados, y descartar uno no obliga a rediseñar el resto.
2. **Cerrar las 5 pantallas pendientes** (§6.1). Dos pasadas cortas.
3. **Maquetar el sitio en tablet y teléfono** y dibujar las cuatro páginas secundarias.
4. **Arrancar la implementación por el orden de dependencia** de `RUTAX-COSTO-DE-IMPLEMENTACION.md` §10: tokens → estado → tablas → marco → dinero → app → sub-sistemas → sitio.

## 7.2 La prueba que verifica que el sistema funciona

**Las pantallas 1 y 5 muestran el mismo objeto —un pedido— en las dos superficies más opuestas del producto.** Tienen que reconocerse como el mismo objeto sin ser la misma pantalla. Se reconoce por tres cosas y no por su forma:

1. **El identificador es el mismo y en el mismo orden:** destinatario primero, código de envío inmediatamente debajo, en mono.
2. **El estado usa el mismo tono y el mismo glifo**, aunque la etiqueta cambie según la superficie.
3. **La procedencia se muestra igual** —`FLEX`, mono, con borde, sin color— porque es la que decide si lo que el conductor registra es la prueba autoritativa o solo informativo.

**Si una pantalla nueva no puede identificar su objeto con esos tres elementos, la pantalla está mal, no el registro.**

## 7.3 Los errores que este trabajo ya cometió y no hay que repetir

- **El titular sobre un detalle operativo de un cliente.** «Si cierras a las 16 horas…» excluye al 95% de los visitantes y no dice qué es el producto. Corregido: el detalle operativo va en la sección de producto, en forma de pregunta.
- **La sección que describe *una* operación en vez del arco.** Mismo error a nivel de sección: se corrigió a «cuatro cosas que hace todo courier, trabajes como trabajes».
- **Suponer que el seller declara cuántos bultos retirar.** No pasa: el seller está ocupado en otra cosa y solo necesita que el conductor pase a buscar lo que hay. Los «pendientes» son lo que la plataforma tiene por retirar.
- **Contar mal los objetos.** El sistema decía 15; son 18. `suscripción y plan`, `conexión de fuente` y `movimiento bancario` estaban tratados como campos de otro objeto.
- **Publicar un contraste que no es el real.** Pasó tres veces con `fg-subtle` y con el teal como texto. La regla de uso por fondo está ahora en `tokens.css`, no solo en la documentación.

---

*Fin de la ficha consolidada. ~102 pantallas · 100 componentes · 18 objetos · 4 temas · 6 documentos.*
