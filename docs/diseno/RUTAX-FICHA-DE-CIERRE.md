# Rutax · Ficha de cierre consolidada

**Versión final · 22 de agosto de 2026**

> Artefacto importado desde Claude Design (proyecto `184f328b`).
> Es el documento de referencia del paquete: está escrito para que otra sesión pueda
> continuar sin tener la conversación original delante.
>
> ⚠️ **Lleva una corrección local**, marcada como tal en §4: los `NUEVO` son **30**, no 28.
> El resto se conserva idéntico al importado.

---

## Qué es Rutax

SaaS B2B vertical para empresas de última milla —*couriers*— en Santiago de Chile. El courier recibe pedidos desde varias fuentes (Mercado Libre Flex, Shopify y pedidos same-day propios), los despacha con su flota, y cierra su trastienda de dinero: **cada entrega genera sola su línea de cobro al seller y su línea de liquidación al conductor, conciliadas entre sí.**

**Ocho perfiles:** coordinador · supervisor · administración · dueño · seller · conductor · super-admin de Rutax · y el comprador final, que no tiene cuenta.

**Pila técnica:** Next.js, Tailwind, shadcn/ui. La app del conductor es **nativa** y no comparte código con la web. Se construye sobre un producto en producción con clientes reales: **lo nuevo y lo viejo van a convivir meses.**

---

## Los documentos del sistema

| Archivo | Qué contiene |
|---|---|
| `RUTAX-SISTEMA-DE-DISENO.md` | Las reglas del sistema completo |
| `tokens.css` | 4 temas, tipografía, espaciado, radio, elevación, movimiento, impreso, mapeo a Tailwind |
| `RUTAX-REGISTRO-DE-OBJETOS.md` | 18 objetos con canónica, densidades, roles, vocabulario y estados |
| `RUTAX-SISTEMA-DE-MENSAJES.md` | Voz, reglas de redacción, y todo el contenido escrito |
| `RUTAX-SITIO-COMERCIAL.md` | Mapa del sitio, copy, SEO, plan visual, animación, agendamiento |
| `RUTAX-COSTO-DE-IMPLEMENTACION.md` | 100 componentes con su costo y las pantallas que cubre |

**Tableros visuales** (`.dc.html`, en el proyecto de Claude Design): `Marca` · `Fundamentos` `Paleta` `Tipografia` `Estados` `Componentes` `Movimiento` `Objetos y Voz` `Subsistemas` `Mensajes` · los 7 arquetipos `P1`–`P7` · los bloques `B1a`–`B8` · `B7b Autenticacion` · `Sitio comercial`.

---

# 1 · Qué se diseñó en cada pasada

## Pasada 1 · La marca

Tres rutas distintas en idea. **Elegida: 1a · Cuadre**, con paleta *Señal* (teal eléctrico sobre grafito frío) y producto oscuro por defecto.

**El símbolo:** dos rectángulos macizos desfasados —la partida doble—. Representa que cada entrega deja dos líneas que cuadran. Responde a la idea de **infraestructura financiera**, que es el foso del producto.

**Por qué esos rectángulos y no un dibujo:** funcionan a 16 px de favicon, a 1,3 mm en una térmica de 203 ppp, en monocromo, y **al lado de la marca de un courier cualquiera que no controlamos**. El «powered by» del seguimiento público está diseñado como pieza, no como pie de página: es el único canal de Rutax hacia consumidores finales y genera una impresión por entrega.

**Tipografía:** Chivo (400/500/600/700) y Azeret Mono (400/500/600). Chivo tiene una `a` de doble piso con remate diagonal y una `g` de un solo piso que la distinguen de Inter a primera vista; Azeret Mono sostiene las columnas de cifras sin negrita sintética.

## Pasada 2 · El sistema

Color, tipografía, escala, espaciado, radio, elevación, iconografía, densidad y movimiento. **Cuatro temas de primera clase**, ninguno derivado del otro. Los 29 vocabularios de estado con sus ~147 valores. El registro de objetos. Los sub-sistemas: cartografía, visualización de datos, sonido y vibración, impresos. Las 8 plantillas de mensaje. El catálogo de 100 componentes con su costo.

## Pasada 3 · Los siete arquetipos

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
| `B1a` `B1b` `B1c` | **Operación del courier** — Torre con sus 3 zooms y 4 estados, preparación del día, incidencias, manifiestos con secuenciación y redistribución, conductores, dashboard, crear pedido same-day | 10 |
| `B2a` `B2b` | **Dinero** — períodos con aprobación en lote y verificación previa, detalle, liquidaciones con ajuste manual y pagos en lote, cobranza | 5 |
| `B3a` `B3b` | **Configuración y puesta en marcha** — asistente de 5 pasos con su cierre, tarifas, zonas y cortes, bodegas, retiro, integraciones, exportar, mi plan, sellers, equipo | 10 |
| `B4` | **Portal del seller** — inicio, bienvenida, pedidos y detalle, nuevo pedido, cobros y detalle, cobro facturado, incidencias, bodegas, pedido Flex | 10 |
| `B5` | **App del conductor** — manifiesto, detalle de parada, parada de retiro, liquidaciones, punto de término (3 pasos), retiro con escaneo, histórico, traspaso, preferencias, permisos, guardado sin confirmar | 12 |
| `B6` | **Backstage de Rutax** — couriers, ficha, crear, suscripciones, planes, equipo, bitácora, sesiones de soporte, salud, métricas, estado del sistema, avisos, mi cuenta | 13 |
| `B7` | **Sin sesión** — registro, activación, invitación con 5 errores, dos inicios de sesión, recuperar, restablecer, seguimiento público con 5 estados, legales, sin conexión, error general, no encontrado, tarjeta de mensajería | 12 + 1 pieza |
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

**31 re-estilo · 27 extender · 42 de cero.** De los 30 componentes existentes, **29 sobreviven**. El único que se reemplaza es `badge-estado`: su modelo de datos no soporta 29 vocabularios ni ejes múltiples en una fila.

---

# 3 · Las decisiones de sistema que rigen

**Todas siguen vigentes.**

## 3.1 Color, tema y contraste
1. `--rx-accent` sirve para **fondo, borde y glifo**. Nunca para texto en tema claro; el teal como texto es `--rx-accent-text` (#007D69).
2. `--rx-fg-subtle` solo se usa **sobre `--rx-bg`**. Sobre `bg-raised`, `bg-sunken` o cualquier rampa de mapa baja de 4,5:1 y ahí va `--rx-fg-muted`.
3. **El tema `night` tiene dos niveles de texto, no tres.** El tercer gris no cumple AA sobre #05080A.
4. **Sin sombras.** La elevación se construye con escalón de fondo + borde + regla de acento de 2 px arriba.
5. **El color nunca es el único portador de significado.** Todo distintivo lleva tono, glifo y etiqueta.
6. **Las pantallas de dinero abren en tema claro**; la preferencia se guarda por usuario, no por pantalla.
7. **El banner de sesión suplantada es el único elemento que no cambia entre temas.** Vive en el marco; no se colapsa, no se oculta al hacer scroll, no se vuelve ícono.

## 3.2 La app del conductor
8. **Tres temas, no dos:** `sun` (21:1, distintivos en sólido pleno), `dark` (el base) y `night` (blanco tope #B9C6C4, −38% de pico de luminancia).
9. **Orden de autoridad del tema:** preferencia manual > sensor de luz con histéresis > hora. La **preferencia manual caduca al fin del turno**.
10. **Histéresis:** entra a Sol sobre 8.000 lux, sale bajo 3.000, con **90 s mínimos de permanencia**. Eso resuelve el subterráneo a las 17:00: baja a *Día*, no a *Noche*.
11. Los tres temas comparten **disposición, glifos y posiciones**. Solo cambian los valores de color y el pico de luminancia.
12. **Bajo sol, los distintivos van en sólido pleno**, nunca en fondo teñido.
13. **Un permiso se pide en el momento en que se usa**, con una frase de para qué, y nunca al abrir la app.
14. **Toda confirmación que el conductor no puede mirar tiene señal de oído y de mano**, y la vibración sola tiene que bastar.
15. **Un traspaso entre personas necesita las dos voluntades.**
16. **Una preferencia del conductor no se reporta a su coordinador.**
17. **No hay trabajo sin conexión.** Hay reintento automático con aviso, y la advertencia de que cerrar la app pierde lo no confirmado.

## 3.3 Dinero
18. **Toda cifra de una tabla financiera lleva su rótulo** —bruto o neto— en la cabecera y en el pie.
19. **Las tablas de dinero se agrupan por concepto con subtotal**, no línea por línea.
20. **Todo negativo lleva signo menos real, tono falla y su causa en la misma fila**, enlazada al objeto que la originó.
21. **El `bloque de composición` es obligatorio** junto a cualquier cifra que no sea la suma trivial de una columna.
22. **Rutax no muestra impuestos:** la factura PDF es el único lugar del producto con IVA.
23. **Un período cerrado va en solo lectura, sin composición.**
24. **Un motivo escrito por un interno que un externo va a leer se declara como tal en el formulario.**

## 3.4 Configuración
25. **No hay autoguardado:** guardado explícito por sección, con acuse.
26. **Todo formulario de edición llega precargado con el valor vigente.**
27. **Nada se borra: se desactiva.** Y **todo lo desactivado tiene cajón y vuelta**.
28. **Lo vigente y lo programado conviven en la misma tabla.**
29. **Un asistente sin pantalla de cierre no está terminado.**
30. **Un cambio de permisos se explica con el catálogo de capacidades** —pierde / gana / sigue sin tener.
31. **Una credencial que se muestra una sola vez lo advierte antes de generarla.**

## 3.5 Portal del seller
32. **El portal no gana densidad al crecer el ancho: gana aire.**
33. **Un mismo valor de estado puede tener etiqueta visible distinta en el portal**, siempre que conserve tono y glifo. **Es la única superficie con este permiso.**
34. **Toda pantalla del portal tiene una salida al courier**, y el pie con «powered by Rutax» es el único lugar donde aparece nuestra marca.
35. **Una pantalla no promete una acción que la interfaz no ofrece.**
36. **El seller elige su tema.**

## 3.6 Backstage
37. **Ninguna acción se confirma con un diálogo nativo del navegador.**
38. **Toda acción sobre la cuenta de un tercero exige motivo escrito** y queda a nombre de quien la hizo.
39. **El segundo factor se vuelve a pedir por acción**, no por sesión, cuando cruza la frontera de una empresa.
40. **Una bitácora de auditoría es de solo lectura para todos los roles.**
41. **Todo objeto se muestra con su empresa al lado.**

## 3.7 Sin sesión
42. **La marca la decide el dueño de la relación:** Rutax cuando el visitante es nuestro cliente, el courier cuando es cliente del courier, neutra cuando no lo sabemos.
43. **El nombre del courier en texto es la versión canónica**; su logo es una mejora opcional.
44. **Sin sesión, el tema lo decide el sistema operativo.**
45. **Una pantalla pública nunca confirma ni niega la existencia** de un correo, de un envío ajeno o de una cuenta.
46. **El estado que ve el comprador es una traducción, no un renombre:** mismo tono y glifo, otra redacción.
47. **Una previsualización de enlace no dice estados.**
48. **Un problema nuestro no le llena el teléfono al courier.**

## 3.8 Impreso
49. **El papel tiene una sola versión.**
50. **En térmica** no hay grises, ni tramas de fondo, ni pesos bajo 400, ni texto bajo 15 px.
51. **Todo código impreso aparece dos veces:** legible a distancia y en su forma digitable sin guiones.
52. **Una etiqueta no lleva montos, ni datos del conductor, ni instrucciones de acceso.**
53. **Toda pieza impresa con un total lleva su composición impresa al lado.**
54. **Una pieza impresa que se usa para trabajar lleva dónde escribir y la hora en que se imprimió.**
55. **El error de generación distingue el archivo del hecho:** «el PDF falló, la factura está emitida y su folio es el 1041».

## 3.9 Contenido
56. **Ningún error de dinero va en notificación temporal.** Van embebidos y se quedan.
57. **Todo mensaje de éxito de dinero lleva monto y contraparte.** «Listo» está prohibido ahí.
58. **Todo vacío de buena noticia lleva una cifra y la hora de la última revisión.**
59. **El botón que cancela dice «Volver»**, nunca «Cancelar»: en este dominio, cancelar es cancelar un pedido.
60. **Un error de integración dice siempre qué sigue funcionando.**
61. **Ningún correo depende de una imagen.**

## 3.10 Registro de objetos y transversales
62. **En el mapa se muestra el código de envío**, nunca la dirección ni el nombre del destinatario. Regla legal.
63. **Del conductor solo existe su última posición.**
64. **El punto de término es dato personal** bajo la Ley 21.431: consentimiento en tres pasos, versionado, revocable, **y nada se guarda antes del último paso**.
65. **Al seller nunca se le muestra el conductor, la tarifa, ni lo que el courier le paga al conductor.**
66. **Al comprador final nunca se le muestra** dirección, teléfono, nombre del destinatario, seller, conductor ni monto.
67. **El rojo en la Torre de control está reservado a la incidencia abierta.**
68. **Cuando la fuente del pedido gobierna una parte del ciclo, la interfaz lo dice y cruza** en vez de ofrecer una acción que no manda.
69. **Solo el eje de ciclo usa distintivo con color.** Cuatro distintivos de color en una fila no se leen.
70. **El vocabulario es uno.** Un concepto, un nombre, igual en las cinco superficies.

## 3.11 Movimiento
71. **Movimiento funcional, más una firma de cuatro momentos:** el resultado de la asignación en bloque · la apertura del panel de detalle · el cierre de una parada en la app · la confirmación irreversible.
72. **Ninguna curva tiene rebote.**
73. **«Reducir movimiento» no apaga: sustituye.** Borde permanente, salto de foco, fondo sostenido 3 s, anuncio para lector de pantalla, y **pausa de 600 ms antes de habilitar un peldaño 3**.

## 3.12 Sitio comercial
74. **Ninguna cifra aparece por animación.**
75. **Ninguna animación se repite en bucle.**
76. **Toda pieza animada tiene su versión estática diseñada.**
77. **No se lista una integración que no existe**, y cada una lleva su estado real.
78. **Las maquetas salen del producto rediseñado.**
79. **Cero imágenes arriba del pliegue.** La velocidad es parte del argumento.
80. **Un solo destino:** todas las páginas llevan a agendar.

---

# 4 · Lo que se marcó NUEVO

**30 cosas.** Todas diseñadas y aisladas: **descartar cualquiera no obliga a rediseñar lo demás.** Ninguna aprobada ni descartada todavía.

> ⚠️ **Corrección local (2026-08-22).** El artefacto importado decía 28. El tablero
> `B7b Autenticacion`, agregado después de esta ficha, trae dos más: **29 y 30**. Están al
> final de la tabla y marcados como tal. Si se vuelve a importar la ficha desde Claude Design,
> hay que reponer esta corrección.

| # | Qué | Bloque |
|---|---|---|
| 1 | La Torre muestra su hora de última actualización y su alcance | B1a |
| 2 | «Nada atascado» como vacío de buena noticia, no como ausencia | B1a |
| 3 | El mapa degradado como estado válido, no como error | B1a |
| 4 | Redistribución por conductor no disponible, con su modal de reparto | B1b |
| 5 | Secuenciación con la razón escrita cuando no puede optimizar por cierre | B1b |
| 6 | Marca de disponibilidad del conductor visible para el coordinador | B1c |
| 7 | Se retira el «IVA 19%» del portal: era el residuo entre total y líneas | B2 |
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
| 20 | Detalle de la incidencia con sus notas y su efecto en el cobro | B4 |
| 21 | Se retira el buscador global del portal; entra el local | B4 |
| 22 | Los tres temas de la app del conductor | B5 |
| 23 | Escala de tamaño de texto en la app | B5 |
| 24 | Sonido y vibración: cuatro señales | B5 |
| 25 | Notificaciones push: tres momentos | B5 |
| 26 | Aceptación del receptor en el traspaso, hoy unilateral | B5 |
| 27 | La marca «REIMPRESA» con fecha y hora en la etiqueta reimpresa | B8 |
| 28 | La pantalla de «no encontrado» y el caso del enlace de Flex | B7 |
| **29** | **El semáforo del sistema en el login.** El dato ya se mide en el backstage; lo que no existe es exponerlo ahí. Ahorra una llamada cada vez que el SII se cae | B7b |
| **30** | **«Lo último que cambió», con su pantalla de origen.** Necesita que el backstage tenga dónde escribirlo —tres campos, fecha y texto—, junto a «Avisos a couriers». Sin eso el panel se queda viejo en dos meses y pasa a ser prueba en contra | B7b |

**Además, aprobado y ya integrado:** el panel inferior de registro de escaneo con log de repetidos (B5).

---

# 5 · Lo que quedó abierto

Decisiones que **no son de diseño**:

| Qué | Quién decide | Nota |
|---|---|---|
| **El número del precio** y si hay mínimo mensual para couriers de 1 a 5 conductores | Negocio | Unidad decidida: por conductor al mes |
| **Umbrales de lux (8.000/3.000) y permanencia (90 s)** | Terreno | Ajustarlos **en la calle con un teléfono real**, a las 16:00 y a las 21:30 |
| **Si el courier ve que alguien de Rutax entró a su cuenta** | Negocio | Hoy no se le dice. Hay argumento de confianza para decírselo |
| **Los 30 min de vencimiento de la sesión de soporte** | Operación | Si la mitad de los tickets la extiende, el número está mal |
| **Los 7 días de vigencia de la invitación** | Operación | Medirlo contra cuántas vencen |
| **Guardar el logo del courier** | Producto | Brecha chica con efecto en cada entrega |
| **El unitario de la factura** | Contabilidad / SII | Agrupado por comuna con unitario redondeado y total exacto |
| **Webhooks** | Ingeniería | Formulario simple. Si crece, van a necesitar registro de entregas fallidas |
| **La nota de crédito** | Producto | No existe. La ceremonia de emisión ya tiene el lugar donde iría |

**Cerradas, no reabrir:** el manifiesto impreso va en TÚ · la notificación «tu ruta está lista» se puede apagar y no se avisa al coordinador · no se manda correo al resolver una incidencia del seller · el acta de retiro no se imprime.

---

# 6 · Lo que NO se diseñó

## 6.1 Pantallas pendientes · 5

| Qué | Cuánto cuesta | Nota |
|---|---|---|
| **Las cuatro anulaciones** | Una pasada corta | Cuatro peldaños 2 con la misma anatomía. **Los textos ya están escritos** |
| **Historial de entregas y pagos del conductor** | Media pasada | Es la `tabla financiera` filtrada por persona |
| **Detalle de bodega** completo | Media pasada | Aplicación directa del `formulario de configuración` |
| **Ficha de seller** desplegada | Media pasada | Marcada NUEVO #18 |
| **Torre de control en móvil** | Media pasada | Es del **coordinador**, no del conductor |

## 6.2 Contenido pendiente
- Los **42 mensajes de éxito de módulo único**. El molde los resuelve sin ambigüedad.
- Los **cuerpos completos de los 6 correos que ya existen**. Quedaron con asunto, acción y la regla que los cambia.
- **Términos y política de privacidad.** Lo escribe un abogado. **La pantalla ya está diseñada.**

## 6.3 Sitio comercial pendiente
- Las **cuatro páginas secundarias** en detalle (definidas en razón, estructura, H1, título y meta; no dibujadas).
- Las **dos fotografías** (especificadas con su criterio; son una compra).
- El **sitio en tablet y teléfono** (especificado, no maquetado).

## 6.4 Lo que se decidió NO diseñar

| Qué | Por qué |
|---|---|
| **Trabajo sin conexión** en la app | Se retiró del producto |
| **Acta de retiro impresa** | Nadie la echó de menos |
| **Recorrido histórico del conductor** | No existe el dato |
| **Blog del sitio** | No se abre hasta que exista quien lo escriba |
| **Refinamiento visual del backstage** | Uso interno: hereda el sistema y arregla lo roto |

---

# 7 · Cómo continuar

## 7.1 Orden sugerido
1. **Aprobar o descartar los 30 NUEVO.** Es lo único que bloquea.
2. **Cerrar las 5 pantallas pendientes** (§6.1). Dos pasadas cortas.
3. **Maquetar el sitio en tablet y teléfono** y dibujar las cuatro secundarias.
4. **Implementar por el orden de dependencia** de `RUTAX-COSTO-DE-IMPLEMENTACION.md` §10: tokens → estado → tablas → marco → dinero → app → sub-sistemas → sitio.

## 7.2 La prueba que verifica que el sistema funciona

**Las pantallas 1 y 5 muestran el mismo objeto en las dos superficies más opuestas.** Se reconoce por tres cosas y no por su forma:
1. **El identificador es el mismo y en el mismo orden:** destinatario primero, código de envío debajo, en mono.
2. **El estado usa el mismo tono y el mismo glifo**, aunque la etiqueta cambie.
3. **La procedencia se muestra igual** —`FLEX`, mono, con borde, sin color.

**Si una pantalla nueva no puede identificar su objeto con esos tres elementos, la pantalla está mal, no el registro.**

## 7.3 Los errores que este trabajo ya cometió y no hay que repetir

- **El titular sobre un detalle operativo de un cliente.** «Si cierras a las 16 horas…» excluye al 95% de los visitantes.
- **La sección que describe *una* operación en vez del arco.** Se corrigió a «cuatro cosas que hace todo courier, trabajes como trabajes».
- **Suponer que el seller declara cuántos bultos retirar.** No pasa: los «pendientes» son lo que la plataforma tiene por retirar.
- **Contar mal los objetos.** El sistema decía 15; son 18.
- **Publicar un contraste que no es el real.** Pasó tres veces. La regla de uso por fondo está ahora en `tokens.css`, no solo en la documentación.

---

*Fin de la ficha consolidada. ~102 pantallas · 100 componentes · 18 objetos · 4 temas · 6 documentos.*
