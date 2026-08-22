# Rutax — Inventario funcional del sistema completo

> **Qué es este documento.** El mapa exhaustivo de todo lo que Rutax hace hoy: módulo, pantalla, ventana, modal, control, lista, campo, acción y estado. Es la fusión de los dos inventarios previos del sistema en uno solo, y los reemplaza a ambos.
>
> **Contra qué está verificado.** Contra el código en producción del commit `d754316` (21-08-2026). No contra documentación de diseño, no contra decisiones declaradas en actas, no contra memoria. Donde las dos fuentes originales se contradecían, se abrió el archivo y ganó el código.
>
> **Qué NO es.** **No describe cómo se ve Rutax hoy ni hereda un solo texto de su interfaz actual.** Describe qué hace cada cosa, qué estados puede tener y qué tiene que quedar entendido en cada punto. La jerarquía visual, los componentes, el lenguaje gráfico, el tono y la redacción de cada mensaje se definen a partir de aquí; nada de eso se hereda.
>
> **Dónde está el detalle literal.** En la misma carpeta hay ocho anexos (`ANEXO-A` a `ANEXO-H`) con el inventario pantalla por pantalla: **4.703 textos citados con archivo y línea**, más los controles, las acciones de servidor y las brechas de cada superficie. Este documento es el nivel de sistema; los anexos son el nivel de pantalla. Se consultan cuando una pantalla concreta necesita ese detalle, no antes.
>
> | Anexo | Cubre |
> |---|---|
> | A | Backoffice del courier — operación |
> | B | Backoffice del courier — dinero y configuración |
> | C | Portal del seller |
> | D | App del conductor (repositorio nativo) |
> | E | Backstage de administración |
> | F | Páginas públicas y autenticación |
> | G | Transversal del sistema (marco, navegación, avisos, componentes) |
> | H | Correos |
>
> Los defectos puramente técnicos (fugas, errores tragados, deuda de infraestructura) **no están aquí**: viven en `HALLAZGOS-TECNICOS.md`. Este documento solo recoge lo que un rediseño de interfaz tiene que resolver.

---

## 0. Encargo

Rediseña el sistema de interfaz completo de Rutax a partir de este inventario.

El punto de partida no es lo que existe: es esta lista de funciones. Todo lo que hoy está construido en el frontend se considera desechable. Lo que no es negociable es la función, los estados posibles y las reglas duras de la sección 2.

Lo que necesito que produzcas:

1. **Un sistema de diseño único que cubra las cinco superficies** (backoffice del courier, portal del seller, app del conductor, backstage de administración, páginas públicas). Una sola gramática visual y de interacción: un estado se ve igual en la tabla del courier, en el portal del seller y en la pantalla del conductor; un modal de confirmación se comporta igual en toda la aplicación; una tabla se lee igual en los 30 lugares donde aparece.
2. **El catálogo de componentes** que el sistema necesita para cubrir el inventario, con todos sus estados y variantes: vacío, cargando, error, sin permiso, deshabilitado, con y sin datos.
3. **Los patrones de pantalla** recurrentes: listado con filtros, detalle con acciones, formulario de configuración, asistente por pasos, panel de monitoreo, confirmación de acción irreversible, bandeja de excepciones.
4. **El sistema de mensajes completo**: cada punto de la sección 8 necesita su texto — éxito, error, confirmación, estado vacío, ayuda de campo, advertencia previa a una acción irreversible. Escritos como los escribe una aplicación moderna: en el idioma del usuario, diciendo qué pasó y qué hacer, sin jerga técnica, sin culpar a quien la usa. Español de Chile.
5. **El sistema de etiquetas**: cómo se nombra cada concepto del dominio en la interfaz, de forma consistente en las cinco superficies.

Cubre la totalidad del inventario. Cada módulo, cada ventana, cada modal, cada opción y cada lista de este documento tiene que quedar contemplada por el sistema y converger en él.

---

## 1. El producto y sus superficies

Rutax es un SaaS multi-tenant para empresas de última milla (couriers) en Santiago de Chile. Centraliza los pedidos que llegan desde distintas fuentes, los despacha desde una sola app, y cierra la trastienda de dinero: cada entrega genera sola su cobro al seller y su pago al conductor.

**Quiénes lo usan.** Cinco audiencias distintas, con contexto de uso muy distinto:

| Superficie | Quién | Dónde y cómo | Naturaleza |
|---|---|---|---|
| **Backoffice del courier** | Dueño, supervisor, coordinador, administración | **Escritorio, tablet y teléfono**, según dónde esté esa persona en el día. Sesiones largas y alta densidad de datos en escritorio; sesiones de pie, cortas y de una mano en el piso de la bodega | Operar el día y cerrar el dinero |
| **Portal del seller** | La tienda que despacha | **Escritorio y teléfono**, visitas cortas y esporádicas | Consultar: mis pedidos, mis cobros, mis incidencias |
| **App del conductor** | Quien maneja la camioneta | Teléfono, en la calle, con una mano, sin buena señal | Ejecutar: retirar, entregar, registrar |
| **Backstage de Rutax** | Super-admin de la plataforma | Escritorio, uso interno | Administrar couriers, planes y salud del sistema |
| **Público** | Cualquiera, y el destinatario del paquete | Escritorio y teléfono, sin sesión | Conocer el producto y pedir una demostración, autenticarse, seguir un envío |

### 1.1 Los siete habitantes

Las superficies son cinco, pero las personas son siete, y el sistema tiene que servirlas a todas sin partirse en siete productos. Dentro del backoffice conviven cuatro perfiles con días completamente distintos: tratarlos como "el usuario interno" es el error más fácil de cometer acá.

**El coordinador.** No está sentado: se mueve. En la mañana está de pie en el piso de la bodega mientras entra la carga, con el aparato en una mano, mirando qué llegó y repartiéndolo; desde las 16:00 vuelve al escritorio a monitorear. Trabaja con tablas densas, filtros y selección masiva, contra un reloj que no perdona. Su enemigo es el clic de más. Su pregunta es "¿qué hay, de quién es, y a quién se lo doy?".

**El supervisor.** El puente entre el coordinador y el dueño, y el perfil más reactivo del producto: aparece cuando algo se rompió. Confirma y ajusta la operación, gestiona incidencias, reasigna cuando un conductor se cae. No toca configuración financiera ni usuarios. Sus pantallas naturales son las incidencias y la Torre de control, y llega a ellas **desde un aviso**, no navegando — así que casi siempre entra por el medio del producto, no por la puerta. Su pregunta es "¿qué se está atascando y quién lo resuelve?".

**Administración y contabilidad.** El perfil que más horas pasa en las pantallas de dinero y el que menos aparece en las conversaciones de producto. Cierra períodos, emite documentos tributarios, concilia lo que no cuadra, paga liquidaciones. Trabaja con el Servicio de Impuestos en frente: **un documento mal emitido no se borra.** Es meticulosa por oficio, revisa dos veces y desconfía de las cifras que no puede rastrear. ⚠️ **Su herramienta natural es la planilla de cálculo**, y ahí está la competencia real de estas pantallas: si no puede cuadrar un total y ver de dónde salió cada peso, exporta a Excel y el producto pierde. Su enemigo es la cifra que no explica su origen.

**El dueño.** Entra poco y decide mucho. Mira si el día cerró bien y si el mes cuadra, en ratos cortos y a veces desde el teléfono un domingo. Es quien firma: aprueba la facturación, y es también quien le paga la suscripción a Rutax. Su pregunta es "¿estoy ganando plata y hay algo roto que no me han contado?", y su miedo es enterarse tarde. Necesita que la pantalla le diga en cinco segundos si el día va bien, y una vía directa a lo que esté mal.

**El seller.** Es cliente del courier, no del courier. Entra poco y en autoservicio, casi siempre desde el teléfono y entre otras cosas, porque está atendiendo su propia tienda. No sabe de logística ni quiere saber: le importa si su pedido salió y si le están cobrando bien. Su único trayecto crítico es **arreglar solo una cuenta desconectada**, sin llamar a nadie. ⚠️ **Y el matiz que gobierna toda esta superficie: él no eligió Rutax, se lo impuso su courier.** Si la experiencia es mala, culpa al courier. El portal es la cara del courier ante su cliente, no la de Rutax.

**El conductor.** Teléfono, en la calle, moto o van, una mano ocupada, sol directo en la pantalla, a veces con guantes, señal intermitente y batería que no llega al final del turno. Escanea códigos en bodegas, cierra paradas, adjunta evidencia, navega su ruta. Cada segundo que la app le roba sale de sus ~12 minutos por parada. En pedidos Flex lleva además una segunda app obligatoria que Rutax no controla.

**El super-admin de Rutax.** Uso interno, alta densidad y acciones peligrosas, incluida la suplantación de la cuenta de un courier para dar soporte. ⚠️ **Es el único perfil que ve datos de varias empresas a la vez**, y eso lo convierte en el de mayor riesgo del producto: su pantalla no la ve ningún cliente, pero un error suyo se ve en todos.

**Y el octavo, que no tiene cuenta:** el comprador final. Recibe un enlace de seguimiento, llega desde el teléfono y es el único que ve Rutax sin ser usuario de nadie. Para él, esa única página es el producto entero.

---

**El backoffice del courier NO es una aplicación de escritorio.** Es la corrección más consecuente de este inventario. El coordinador no pasa el día sentado: en la mañana está en el piso de la bodega mientras entra la carga, con el aparato en la mano, mirando qué llegó y repartiéndolo. A partir de las 16:00 vuelve al escritorio a monitorear. Las mismas pantallas sirven a los dos momentos.

**Consecuencia dura, que hay que escribir en el sistema de diseño y no dejar como aspiración:** la **selección masiva y la asignación en bloque tienen que funcionar con el dedo**. Elegir 30 pedidos de una lista de 200, revisarlos y asignarlos a un conductor tiene que ser posible sin puntero, sin hover, sin `shift+clic` y sin menús contextuales. Todo patrón de la sección 10 que dependa de un puntero necesita su equivalente táctil documentado, no una degradación.

El portal del seller es igualmente multi-dispositivo: un seller que despacha 40 pedidos revisa su portal desde el teléfono tan seguido como desde el computador.

**El reloj que gobierna la operación.** El despacho arranca a las 16:00 y corta entre 21:00 y 22:00. Toda la mañana es retiro en bodegas. La asignación tiene que estar terminada a las 16:00 en punto. Son ~25-30 paradas por conductor en 5-6 horas: ~12 minutos por parada. Las pantallas de operación se usan contra ese reloj.

**Las tres fuentes de pedidos.** Mercado Libre Flex, same-day propio y Shopify. La diferencia visible para el usuario: en Flex la prueba de entrega la gobierna la app de Mercado Envíos y Rutax solo registra un cierre paralelo; en las demás la prueba de entrega de Rutax es la autoritativa y es la que dispara el dinero. El conductor usa dos apps para Flex y solo Rutax para el resto.

---

## 2. Reglas duras de contenido

No son preferencias. Rompen requisitos legales o de seguridad si se incumplen.

1. **Nunca se muestra la dirección ni el nombre del destinatario en la Torre de control.** Solo el código de envío. Volver a poner la dirección en el mapa exige una revisión de cumplimiento.
2. **El token de seguimiento (`tracking_token`) jamás aparece en una pantalla interna.** Es público y viaja en la URL que se comparte con el destinatario; mostrarlo en la operación filtraría el pedido a todo el que abra la pantalla.
3. **No se guarda ni se muestra el recorrido histórico del conductor.** Solo su última posición, una sola fila, sin línea de tiempo. Es un requisito de la Ley 21.431. Cualquier propuesta de rastro en el mapa reabre la revisión legal.
4. **Certificados digitales, tokens de integración y credenciales nunca se muestran, ni completos ni parciales, ni en pantalla, ni en una URL, ni en un correo, ni en un registro.** Se muestra su estado, su vencimiento y su origen; nunca su valor.
5. **Emitir una factura electrónica es irreversible ante el Servicio de Impuestos Internos**, y hoy el producto no tiene notas de crédito. Ninguna acción automática la dispara. Siempre exige una acción humana explícita con confirmación consciente. El diseño tiene que hacer sentir ese peso **sin volver pesadas** las otras cuarenta acciones que no lo tienen.
6. **Toda acción financiera y de acceso queda registrada con su autor.** La interfaz nunca debe permitir una acción de dinero sin que quede claro quién la ejecutó; si el diseño crea un atajo que ejecuta dinero, ese atajo necesita autor identificado.
7. **Un rol que no tiene una capacidad no ve la opción.** No se muestra deshabilitada ni con un candado: no existe en su navegación.
8. **Todo es en pesos chilenos, español de Chile y hora de Santiago.** Fechas y horas se muestran siempre en hora de Santiago, aunque el servidor corra en otro huso. No es cosmético: mostrar la hora sin huso ya produjo errores reales en producción.
9. **El aislamiento entre couriers, y del seller y del conductor, se impone en la base de datos.** El diseño no puede asumir que basta con no mostrarlo.
10. **La Torre de control es de solo lectura.** No escribe, no ejecuta, no tiene bitácora propia. Que la Torre actúe es una decisión nueva de producto, no un atajo de diseño.
11. **La app de Mercado Envíos es obligatoria en los pedidos Flex y no es integrable.** No se diseña nada que pretenda reemplazarla. La interfaz tiene que hacer convivir dos apps sin fricción, no pelear esa batalla.

---

## 3. Vocabulario canónico de estados

Todo estado que la interfaz puede mostrar, con su lista completa de valores tomada del código. Cada uno necesita su tratamiento visual y su nombre en el sistema de diseño. **Son ejes independientes: un mismo pedido puede tener a la vez un estado de ciclo, una situación de retiro y un estado de dirección, y son tres preguntas distintas.**

El rediseño **fija la etiqueta visible definitiva de cada valor**. Hoy conviven varias formas de decir lo mismo entre superficies, y cerrar eso es parte del encargo.

### 3.1 Pedido — estado del ciclo (9 valores)
`pendiente_asignacion` · `asignado` · `en_ruta` · `entregado` · `entregado_manual` (corrección humana) · `fallido` · `fallido_manual` (corrección humana) · `cancelado` · `devuelto`

Terminales: entregado, entregado_manual, cancelado, devuelto.

**Agrupación con que se navega el listado** (5 cajones + 1): pendiente de asignación · asignado · en ruta · entregado (agrupa entregado y entregado_manual) · con problemas (agrupa fallido, fallido_manual y devuelto) · por revisar (no es un estado: es la condición de dirección dudosa). Cancelado queda fuera de los cajones a propósito, así que **la suma de los cajones no da el total** — y eso hay que resolverlo en la interfaz, no esconderlo.

### 3.2 Pedido — situación de retiro (3 valores)
`pendiente` (por retirar) · `retirado` (en poder del courier) · `no_procesado` (nunca se retiró; lo despachó otro courier)

Ninguno es una alarma: que un candidato no se retire es el desenlace normal de la mitad del universo ingestado.

### 3.3 Pedido — procedencia (3 valores)
`ml_flex` (Flex) · `rutax_manual` (Same-day) · `shopify` (Shopify)

Advertencia: **la procedencia es este campo y ninguno otro.** El rótulo que ve el usuario sale de aquí. Rotular un pedido de Shopify como "Same-day" —que es lo que ocurre si se lee el eje 3.4— es un error de datos, no de estilo.

### 3.4 Pedido — régimen de entrega y tarifa (2 valores)
`flex` · `same_day`. Determina quién es dueño de la prueba de entrega y qué tarifa aplica, y **nada más**. Sus valores llevan nombre de marketplace por historia. Un pedido de Shopify es régimen `same_day`.

### 3.5 Dirección — geocodificación (4 valores)
`pendiente` (ubicando) · `resuelto` (ubicada) · `no_resuelto` (no se pudo ubicar) · `fuera_cobertura`

Con un matiz temporal: si lleva más de 15 minutos en pendiente, no está en curso — está atascado, y la interfaz debe ofrecer reintentar en vez de mostrar un indicador de carga eterno.

### 3.6 Dirección — cobertura tarifaria (4 valores)
`pendiente` (verificando) · `tarifada` · `sin_tarifa_zona` (comuna sin tarifa) · `requiere_revision`

### 3.7 Incidencia — tipo (7 valores)
`destinatario_ausente` · `direccion_erronea` · `paquete_danado` · `rechazo_destinatario` · `problema_acceso` · `reagendado` · `otro`

### 3.8 Incidencia — estado (4 valores)
`abierta` · `en_gestion` · `resuelta` · `cerrada`

Una incidencia abierta más de 4 horas sin pasar a gestión es "sin gestionar" y genera aviso.

### 3.9 Manifiesto (5 valores)
`borrador` · `confirmado` (listo para el conductor) · `en_ruta` · `completado` · `cancelado`

### 3.10 Seller — estado de cuenta (3 valores)
`invitado` (dado de alta, nunca entró al portal) · `activo` · `suspendido`

El estado solo se rotula cuando **no** es activo: el rótulo existe para explicar la excepción.

### 3.11 Período de cobro al seller (4 valores)
`abierto` · `cerrado` · `facturado` (lleva su número de folio) · `anulado`

La transición `cerrado` → `facturado` exige acción humana y es irreversible.

### 3.12 Factura electrónica — estado ante el SII (4 valores)
`pendiente` · `aceptado` · `rechazado` · `aceptado_con_discrepancias` (nunca se presenta como éxito ni como error: es su propia categoría)

### 3.13 Liquidación al conductor (3 valores)
`borrador` · `emitida` · `pagada`

### 3.14 Pago saliente al conductor (5 valores)
`pendiente` · `enviado` · `confirmado` · `rechazado` · `fallido`

### 3.15 Cobro recibido del seller — atribución (6 valores)
`sin_atribuir` · `atribuido` · `conciliado` · `parcial` · `sobrante` · `descartado`

### 3.16 Período — estado de cobro (4 valores)
`no_aplica` · `pendiente` (por cobrar) · `parcial` · `pagado`

### 3.17 Excepción de conciliación — estado (8 valores)
No terminales: `pendiente` · `en_analisis` · `esperando_info` · `requiere_ajuste`
Terminales: `resuelta_auto` · `resuelta_manual` · `aceptada_justificada` (revisada sin cambios) · `ignorada` (descartada)

Verificado en `src/modules/dinero/tipos.ts`: son exactamente 8. Con máquina de transiciones: no todo estado lleva a todo estado. La interfaz tiene que ofrecer solo los destinos válidos desde el estado actual, no la lista completa.

### 3.18 Excepción de conciliación — categoría de negocio (4 valores)
`cumplimiento_dte` · `fuga_ingreso` · `pagos_pendientes` · `integridad_datos`

### 3.19 Excepción de conciliación — tipo de diferencia (18 valores)
Verificado en `src/modules/dinero/tipos.ts` y en el CHECK vigente de la migración `20260815000005`: **son 18, no 19.** Las dos mitades, TypeScript y base de datos, coinciden exactamente.

Pedido entregado sin línea de cobro · Pedido entregado sin línea de liquidación · Línea de cobro sin pedido entregado · Folio consumido sin factura registrada · Período cerrado con líneas sin asignar · Monto de la factura no coincide con las líneas · Pagado al conductor sin cobro al seller · Cobrado al seller sin liquidar al conductor · Reprogramación no cobrada · Mínimo de facturación no aplicado · Pago del seller pendiente de recibir · Pago al conductor pendiente de emitir · Pago revertido tras confirmarse · Estado de pago no reconocido · Línea de cobro sin período · Línea de liquidación sin pedido entregado · Liquidación atribuida al conductor equivocado · Retiro sin monto configurado

Tres de ellos son fuga directa de ingreso y llevan tratamiento de alarma: pagado al conductor sin cobro al seller, reprogramación no cobrada, mínimo omitido.

Cada tipo tiene su **categoría** (de las 4 de 3.18) y su **acción sugerida** (de las 12 de 3.20) asignadas de forma fija en el código: son derivados del tipo, no campos libres. La interfaz los muestra como hechos — salvo la acción sugerida, que sí se puede cambiar a mano.

### 3.20 Excepción de conciliación — acción sugerida (12 valores)
Revisar tarifa aplicada · Confirmar con el seller · Confirmar con el conductor · Crear cobro manual · Crear ajuste de liquidación · Reasignar líneas al período · Reenviar o verificar la factura · Cobrar al seller · Gestionar el pago al conductor · Marcar como error del motor · Sin acción requerida · Revisar estado externo

Además, cada excepción lleva dos banderas independientes: **bloquea facturación** y **bloquea pago**. Son dos booleanos, no un enum de bloqueo, y se combinan: una excepción puede bloquear las dos cosas, una sola, o ninguna.

### 3.21 Suscripción del courier a Rutax (4 valores)
`trial` (prueba) · `activa` · `suspendida` · `cancelada`

### 3.22 Período y pago de la suscripción
Período: `pendiente` · `pagado` · `vencido`. Pago: `pendiente` · `confirmado` · `fallido`.

### 3.23 Mandato de cobro automático (5 valores)
`sin_mandato` · `pendiente` (confirmando con el banco) · `activo` · `cancelado` · `fallido`

### 3.24 Método de pago de la suscripción (4 valores)
Cobro automático (por enlace) · Cobro automático (recurrente) · Transferencia · Cortesía

### 3.25 Cumplimiento de SLA — semáforo (4 valores)
`Cumplido` (mayor o igual al objetivo) · `En riesgo` (hasta 5 puntos bajo el objetivo) · `Incumplido` · `Sin datos`. El objetivo es configurable por seller, por defecto 97%.

### 3.26 Salud de una conexión con una fuente (2 valores visibles)
Conectada · Desvinculada (los pedidos dejaron de llegar). Las tres causas posibles —token vencido, permiso revocado, fallo de descifrado— hoy son **indistinguibles para el usuario**, y eso es un problema conocido de comunicación a resolver en el rediseño: el seller tiene que poder arreglarlo solo, y hoy no se le dice qué pasó.

### 3.27 Urgencia de un aviso del sistema (3 valores)
`urgente` · `importante` · `informativo`

### 3.28 Conductor (2 ejes)
Estado en nómina: `activo` · `inactivo`. Disponibilidad del día: disponible / no disponible. **Son ejes distintos**: un conductor activo puede estar no disponible hoy.

### 3.29 Tono de un estado vacío (3 valores)
`arranque` (todavía no hay datos: explica qué aparecerá y ofrece la acción) · `buen-estado` (no hay nada porque todo está bien: transmite confianza, no ausencia) · `filtro` (la búsqueda no arrojó: ofrece limpiar)

Falta un cuarto y es una brecha real: hoy hay pantallas que muestran su estado vacío cuando en realidad la lectura falló. El sistema necesita distinguir "no hay nada" de "no pude saber si hay algo" (ver §13).

---

## 4. Roles y capacidades

Siete roles. La navegación de cada uno se arma filtrando por sus capacidades.

| Rol | Alcance |
|---|---|
| **Dueño** (`dueno`) | Todo dentro de su courier |
| **Supervisor** (`supervisor`) | Operación completa; sin configuración financiera ni usuarios |
| **Coordinador** (`coordinador`) | El más acotado de los internos: asignación, manifiestos, preparación, bodegas, torre |
| **Administración** (`administracion`) | Dinero: facturar, liquidar, cobrar, conciliar; sin reasignación operativa |
| **Conductor** (`conductor`) | Solo lo suyo: su ruta, sus evidencias, su manifiesto, su liquidación, traspasos hacia sí mismo |
| **Seller** (`seller`) | Solo lo suyo: sus conexiones, sus pedidos, sus documentos, sus incidencias |
| **Super-admin** (`super_admin`) | Plataforma; fuera de cualquier courier |

Cuatro tipos de usuario cruzan los siete roles: `interno` · `seller` · `conductor` · `super_admin`.

**Capacidades completas: son 33.** Verificadas una a una contra el catálogo cerrado de `src/modules/identidad/capacidades.ts`. Las dos fuentes previas decían 26 y ninguna coincidía con su propia lista.

Gestionar usuarios y roles · invitar usuarios internos · revocar invitaciones · gestionar tarifas · gestionar configuración de facturación electrónica · aprobar facturación · emitir facturas · ver conciliación · gestionar liquidaciones de conductores · gestionar cobranza · asignar y reasignar pedidos · generar manifiestos · gestionar incidencias · ajustar operación diaria · ver preparación del día · gestionar bodegas · sincronizar conexiones con las fuentes · ver torre de control · ver reportes ejecutivos · ver bitácora de auditoría · gestionar suscripción · gestionar conexión propia · solicitar same-day · ver documentos propios · ver incidencias propias · descargar etiqueta same-day · gestionar pedidos propios · ver ruta propia · confirmar manifiesto propio · marcar evidencias propias · ver liquidación propia · recibir traspaso propio · administrar plataforma.

Tres detalles que la interfaz tiene que respetar:

- **"Gestionar conexión propia" gobierna Mercado Libre y Shopify a la vez.** Es una sola capacidad para las dos fuentes; no hay permiso separado por fuente.
- **"Ver documentos propios" significa cosas distintas según quién la tenga**: para el seller son sus facturas; para el conductor, su liquidación. Es la misma capacidad con dos objetos.
- **Las capacidades de solo lectura tienen gate propio** (ver torre de control, ver preparación del día) y no se derivan de las operativas. Un rol puede ver una pantalla sin poder actuar en ella, y la pantalla tiene que verse completa igual, sin controles fantasma.

**Destino al iniciar sesión, según rol:** dueño → dashboard · supervisor y coordinador → pedidos · administración → puesta en marcha · conductor → su manifiesto · seller → su portal · super-admin → suscripciones del backstage.

---

## 5. El árbol

### 5.A — Backoffice del courier

Marco común a todas sus pantallas. **Todo lo que sigue tiene que funcionar en escritorio, en tablet y en teléfono**: no es un backoffice de escritorio con una versión móvil degradada, son dos momentos del mismo día de la misma persona.

- **Identidad de la empresa**, que además es un menú con accesos a configuración de la empresa, equipo y roles, y plan y facturación (cada uno según capacidad; sin ninguna, el bloque es estático).
- **Buscador global** con atajo de teclado: busca a la vez pedidos, sellers, conductores y liquidaciones; resultados agrupados por tipo; navegable enteramente por teclado (flechas, enter, escape); mínimo dos letras; sin resultados y cargando son estados propios. En teléfono el atajo de teclado no existe: el buscador necesita su propia puerta táctil.
- **Centro de avisos**, agregador de todo lo que exige atención sin entrar a cada pantalla, jerarquizado en tres niveles de urgencia. Cada aviso lleva su destino y su acción. Las fuentes de aviso son: conexiones caídas · folios por agotarse · corte de un seller próximo (activo desde 45 minutos antes, urgente desde 15) · incidencias sin gestionar más de 4 horas · discrepancias de conciliación sin revisar, con el monto en juego · excepciones asignadas a mí que vencen · consumo del plan al 80% y al 100% · comunicaciones de Rutax.
- **Navegación agrupada**: un grupo principal (Dashboard, Torre de control), Operación (Preparación del día, Pedidos, Manifiestos, Conductores, Incidencias), Dinero (Períodos, Liquidaciones, Conciliación, Cobranza), Clientes (Sellers). La configuración es una navegación anidada que reemplaza a la principal al entrar, con retorno explícito.
- **Bloque de plan** al pie, desplegable: resumen, cambiar de plan, historial de pagos, cobro automático.
- **Menú de usuario**: tema claro/oscuro y cerrar sesión.
- **Banner de puesta en marcha** mientras la configuración inicial esté incompleta, con progreso de pasos.
- La navegación **se puede colapsar a íconos** y la preferencia persiste.
- Una sola pantalla necesita ancho especial: la Torre de control.

---

#### A1 · Dashboard operativo
*Dueño. Lo que pasó y está pasando hoy.*

Indicadores del día, distribución de pedidos por estado, top de comunas del día, rezagados de ayer que siguen sin cerrar, incidencias abiertas, conexiones caídas, conductores activos y conductores listos hoy, tasa de entrega, SLA global.

Widgets propios: **SLA por seller** (con semáforo por seller y su objetivo pactado) · **analítica financiera** · **banda de la Torre** (resumen enlazado a la Torre de control).

Cada cifra enlaza al listado ya filtrado. Estado vacío propio para "todavía no hay operación hoy".

---

#### A2 · Torre de control
*Dueño, supervisor, coordinador. Solo lectura. La pantalla que se abre varias veces al día, dos minutos cada vez.*

Responde: cuántos paquetes faltan por entregar, en qué comunas, y si algo se está atascando. El contador baja durante el día.

- **Cifras principales**: magnitudes, nunca puntajes ni índices. "38 de 120 pendientes", no "73 de riesgo".
- **Mapa** con tres niveles de zoom semántico: comuna → agrupaciones → punto de entrega individual. La unidad primaria es la comuna, no la zona.
- **Ficha** del elemento seleccionado.
- **Lista de comunas** con su carga.
- **Panel lateral con dos pestañas**: Conductores (paradas por conductor) y Comunas.
- **Placas** de estado.
- **Banda de olas**: aviso anticipado de eventos comerciales que van a mover volumen. Es lo único de la pantalla que mira hacia adelante.
- **Botón de pantalla completa.**
- Estados propios: sin incidencias abiertas · nadie con paradas asignadas hoy · sin pedidos con compromiso para hoy · degradado (sin cartografía).
- Cuenta lo que declara la app del conductor, no el estado oficial del pedido. Consecuencia asumida: durante horas puede mostrar menos pendientes que el listado de pedidos, y eso hay que explicarlo en la pantalla, no dejarlo como discrepancia sin nombre.
- **El rojo está reservado a la incidencia abierta**: es lo único accionable de la pantalla.

---

#### A3 · Preparación del día
*Dueño, supervisor, coordinador. Toda la mañana, en vivo. Es la pantalla que más se mira desde un teléfono, de pie en la bodega.*

Muestra las visitas a bodega en curso y el acumulado por comuna de lo que va entrando, para decidir cuántos conductores por zona antes de las 16:00.

- **Franja de magnitudes**: el acumulado del día.
- **Lista de visitas** en curso, cada una como tarjeta con su **reloj** (cuánto lleva abierta).
- **Carga por comuna**: el desglose de lo que ya está en la bodega.
- Estado vacío: todavía no hay retiros hoy.

---

#### A4 · Asignar pedidos
*Quien puede asignar. La carrera contra las 16:00.*

Selección masiva por filtros, no reparto automático. El coordinador filtra, selecciona un bloque y lo asigna a un conductor.

**Restricción de contexto, no negociable: esto tiene que hacerse con el dedo.** Es la pantalla donde la corrección multi-dispositivo pesa más. Seleccionar 30 de 200 filas, revisarlas y asignarlas sin puntero, sin hover y sin selección por rango con teclado es el problema de diseño central de esta pantalla.

- **Bandeja** de pedidos retirados, con filtros en panel lateral: solo se ofrecen los pedidos en poder del courier.
- **Tabla** con: código · comuna · seller · estado. Selección múltiple.
- **Barra de selección** persistente con el conteo y la acción de asignar.
- **Panel lateral de pedidos seleccionados**, revisable antes de confirmar.
- **Aviso de truncamiento**: cuando hay más resultados de los que se muestran.
- **Aviso de novedades**: llegaron pedidos nuevos mientras trabajabas.
- **Confirmación de reasignación**: cuando la selección incluye pedidos que ya son de otro conductor.
- **Resultado de la asignación**: qué se asignó y qué no, con el motivo.
- Estados vacíos: todavía no hay pedidos para asignar · ningún pedido retirado coincide con estos filtros.
- **Tiene que funcionar de forma incremental durante toda la mañana**, por lotes parciales, no como un acto único a las 15:30. Volver a la pantalla no puede costar rehacer el filtro.

---

#### A5 · Pedidos
*La pantalla central de la operación.*

**Barra de cajones por grupo de estado** con su contador sobre el conjunto filtrado (no sobre la página): pendiente de asignación · asignado · en ruta · entregado · con problemas · por revisar.

**Filtros**: seller · conductor · comuna · procedencia · estado o grupo de estados · **fecha** (día exacto, rango con calendario, o atajos rápidos) · dirección por revisar. Persisten en la URL para poder enlazar y compartir.

**Columnas**: estado · destinatario · seller · fecha · procedencia · motivo (cuando aplica) · conductor.

**Acciones**: crear pedido same-day (formulario propio) · abrir el detalle · paginación.

**Actualización en vivo**: la tabla se refresca sola cuando cambia algo.

**Estados vacíos, tres distintos**: sin direcciones por revisar (buen estado) · ningún pedido coincide con el filtro · aún no hay pedidos para esta fecha.

##### A5.1 · Detalle del pedido
Toda la ficha del envío, su historial y su dinero. Acciones y ventanas:

- **Cambiar de estado** (panel lateral), con motivo obligatorio en las correcciones manuales.
- **Reasignar a otro conductor** (modal).
- **Abrir incidencia** (panel lateral) con su tipo y descripción.
- **Reclasificar una incidencia** (modal): tipo actual → nuevo tipo.
- **Cancelar el pedido** (modal en dos pasos: motivo obligatorio de al menos 10 caracteres, luego confirmación explícita).
- **Descargar la etiqueta** con elección de formato: térmica 10x15 o carta/A4.
- **Reubicar la dirección** cuando la ubicación quedó mal.
- **Visor de la prueba de entrega** y **visor de evidencias**, con acceso a archivos por enlace temporal.
- **Anular el cobro de este pedido** y **anular la liquidación de este pedido**: dos acciones de dinero, cada una con su modal, motivo obligatorio que queda en la bitácora, y advertencia de consecuencia.
- **Trazabilidad financiera**: el lazo pedido ↔ líneas de dinero, y la regla de tarifa que se aplicó en su momento.

##### A5.2 · Crear pedido same-day
Formulario: seller · destinatario · dirección · comuna · teléfono · instrucciones de entrega · fecha de compromiso · notas internas.

**Caso especial que necesita tratamiento propio**: si se crea pasada la hora de corte del seller, el pedido **se crea igual** pero con un aviso que dice la hora de corte y sugiere reagendar o confirmar de todos modos. No es un error.

---

#### A6 · Incidencias
*Supervisor y quien gestione incidencias.*

Listado filtrable por estado y tipo, con panel de gestión por incidencia: cambiar de estado, escribir notas de resolución, y las dos banderas de si afecta el cobro y si afecta la liquidación. Destaca las abiertas hace más de 4 horas.

Es la pantalla que absorbe todo lo que no se pudo entregar: en Rutax no hay flujo de devolución masiva como camino normal, así que la incidencia tiene que hacer el ruido suficiente para que el coordinador actúe el mismo día.

---

#### A7 · Manifiestos
*La hoja de ruta del conductor.*

**Listado**: estado · nombre · fecha · conductor. Filtros por fecha y conductor.

**Detalle del manifiesto**:
- **Panel de ruta** con las paradas: estado · destinatario · dirección · fecha de compromiso.
- **Calcular la ruta**: secuencia las paradas desde la bodega de origen hasta el punto de término del conductor.
- **Reordenar las paradas a mano** y guardar el orden manual.
- **Quitar un pedido** del manifiesto.
- **Confirmar el manifiesto** (queda listo para el conductor).
- **Cancelar el manifiesto.**
- **Marcar al conductor como no disponible y redistribuir**: acción de consecuencia grande, devuelve qué paradas se reasignaron, cuáles quedaron sin conductor y el impacto en el SLA de cada seller afectado.
- Estado vacío: este manifiesto no tiene pedidos todavía.

---

#### A8 · Conductores
**Listado** con panel de gestión por conductor:
- **Crear conductor**: nombre · RUT · tipo de relación (dependiente con contrato / independiente con boleta de honorarios).
- **Disponibilidad del día** (interruptor).
- **Capacidad de paradas** del turno.
- **Zonas preferentes** (selección múltiple).
- **Datos bancarios**: banco · tipo de cuenta (corriente / vista / ahorro) · número de cuenta.
- **Invitar a la app**: modal con el correo del conductor.

**Detalle del conductor**: su historial de entregas y pagos, con columnas fecha · destinatario · estado de pago · monto. Dos acciones de dinero con confirmación: anular la liquidación de una entrega · anular el pago de una visita a bodega.

---

#### A9 · Dinero

##### A9.1 · Períodos de cobro
**Listado**: seller · período · estado · monto. Filtros por seller y estado. Indicador visible de si la facturación corre en modo de pruebas o real.

**Acciones**: cerrar período (modal con el nombre del seller) · emitir factura · emitir nota de crédito · descargar el PDF y el XML del documento.

**Aprobación en lote**: cerrar y emitir varios períodos de una vez, con verificación previa que reporta qué está listo y qué no.

**Verificación previa obligatoria antes de emitir** ("preflight"): revisa que todo esté en orden y, si el usuario decide emitir igual, queda registrado que la omitió.

**La emisión es el punto irreversible del sistema**: exige confirmación consciente, describe la consecuencia ante el SII, y no se puede cerrar con escape ni haciendo clic fuera.

**Detalle del período**: sus líneas de cobro, el documento emitido, su estado ante el SII y su folio.

##### A9.2 · Liquidaciones de conductores
**Listado** con filtros. **Acciones**: marcar como pagada (confirmación) · emitir el pago (transferencia real) · pagos en lote con verificación previa · **ajuste manual** (bono, penalización, nota) · descargar el PDF de la liquidación.

**Detalle de la liquidación**: sus líneas, sus ajustes y su estado de pago. Las líneas son de dos clases distintas y hay que poder distinguirlas: **entregas** y **visitas a bodega** (el retiro se le paga al conductor por visita; al seller todavía no se le cobra).

##### A9.3 · Conciliación
*La bandeja de excepciones. Donde aparece el dinero que no cuadra.*

**Listado**: categoría y tipo · estado · vence · asignado a · diferencia · seller · pedido. Filtros por categoría, estado, asignación y bloqueo.

**Panel de detalle de la excepción**, con todas sus acciones:
- Transicionar de estado (con máquina de transiciones válidas).
- Reabrir una excepción cerrada.
- Asignar a una persona.
- Fijar fecha límite.
- Fijar si bloquea facturación y si bloquea pago.
- Cambiar la acción sugerida.
- Agregar comentario.
- Ver el historial completo del caso.

Estados vacíos: sin diferencias, todo cuadra (buen estado) · ninguna excepción coincide con el filtro.

##### A9.4 · Cobranza / revisión de pagos
**Listado de movimientos bancarios**: fecha · monto · contraparte · seller · estado de atribución.

**Acciones**: atribuir un pago a un período (con la lista de períodos impagos de ese seller) · descartar un pago.

---

#### A10 · Sellers
**Listado**: seller · RUT · cuenta · conexión con la fuente · sincronizar · invitación.

**Acciones**: invitar a un seller (razón social · RUT · nombre de contacto · correo de contacto) · copiar el enlace de invitación · forzar la sincronización de una cuenta con su estado en vivo.

Muestra la salud de cada conexión y el nombre visible de cada cuenta conectada (alias que le puso el seller, o su apodo en la plataforma, o los últimos dígitos de su identificador; nunca el identificador completo).

Estado vacío: todavía no tienes sellers.

---

#### A11 · Equipo
**Tabla**: persona · rol · estado · detalle · acciones.

**Invitar a una persona** (panel lateral): correo y rol. **Acciones por fila**: reenviar invitación · reinvitar · revocar invitación.

Dos estados vacíos: aún no has invitado a nadie · nada coincide con este filtro.

**Hueco conocido**: no existe forma de cambiarle el rol a una persona ya activa (ver §13).

---

#### A12 · Puesta en marcha
*Asistente de configuración inicial, con progreso visible desde el banner global.*

Pasos, cada uno con su propia pantalla y su estado (pendiente / completo / con problema):

1. **Facturación electrónica**: elegir proveedor · cargar el certificado digital (archivo .pfx o .p12, su contraseña y su fecha de vencimiento) · cargar las credenciales del proveedor (los campos varían según el proveedor elegido).
2. **Folios**: tipo de documento · folio inicial · folio final · archivo .xml. Tabla de folios cargados: tipo de documento · rango · consumo · estado. Bloqueado hasta que exista proveedor configurado, con explicación.
3. **Tarifas iniciales**: tarifa por defecto (tipo de entrega · monto por entrega · lo que se le paga al conductor · vigente desde) y tarifas específicas por seller y zona.
4. **Cobranza**: conectar el banco para recibir y conciliar los pagos de los sellers.
5. **Plan de Rutax**.

Tiene que poder abandonarse y retomarse sin perder el hilo, y en cada paso debe entenderse qué falta para poder operar. **Hoy el asistente no puede darse por terminado nunca** (ver §13): es la brecha más grave del producto y el rediseño tiene que asumir que va a existir un final.

---

#### A13 · Configuración
*Navegación anidada que reemplaza a la principal.*

##### Tarifas
Listado y modal de tarifa (crear / editar): seller · tipo de entrega (Flex / same-day propio) · modo de cálculo (monto fijo / por zona) · zona · **lo que le cobras al seller** · **lo que le pagas al conductor** · vigente desde · vigente hasta · mínimo de facturación · mínimo por retiro · recargo por reprogramación. Acción de inactivar.

##### Zonas
Crear zona · activar/desactivar · asignar comunas a la zona (selección múltiple sobre el catálogo de comunas de la Región Metropolitana).

**Ventanas de corte por seller**: tipo de entrega · hora de corte (hora local) · minutos de preparación · minutos de ruta estimados · objetivo de SLA en porcentaje · override opcional por zona.

##### Bodegas
Dos secciones hermanas, que no son lo mismo:
- **Mis bodegas** (del courier): de donde sale la flota, origen de toda ruta.
- **Bodegas de mis sellers**: donde el conductor retira. Se navegan eligiendo el seller.

Modal de bodega (crear / editar): nombre · dirección · comuna · a quién llamar · teléfono de contacto · pago por visita a esta bodega · instrucciones de acceso.

Acciones: marcar como principal · **desactivar la principal** (modal propio: obliga a elegir cuál pasa a ser la nueva principal) · desactivar · reactivar · reintentar la ubicación cuando la dirección no se pudo geocodificar.

**No existe borrado**: la baja es desactivación, porque detrás cuelgan actas de retiro que respaldan pagos. La ubicación se resuelve al momento de guardar, con el usuario esperando: hay un estado de espera real que la interfaz tiene que sostener.

##### Retiro
Cuánto se le paga al conductor por visita a bodega.

##### Integraciones (API y webhooks)
- **API keys**: crear (con nombre), listar, revocar. La clave se muestra una sola vez.
- **Webhooks**: crear endpoint (URL), activar/desactivar, eliminar.

##### Exportar datos
Exportación completa de los datos del courier.

##### Mi plan
Resumen del plan y consumo · cambiar de plan · historial de pagos · **cobro automático** (activar / desactivar, con modal de confirmación al desactivar) · comprobantes descargables. Estados vacíos propios para "aún no tienes período de cobro" y "aún no hay pagos registrados".

---

### 5.B — Portal del seller

Marco propio: navegación más espaciada que la del courier, sin buscador global. **Multi-dispositivo**: un seller que despacha 40 pedidos revisa el portal desde el teléfono tan seguido como desde el computador.

El seller es cliente del courier, no empleado suyo. Entra poco, en autoservicio, y no sabe de logística. **Su único trayecto real es arreglar una conexión caída sin llamar a nadie**, y de eso depende que el courier reciba o no una llamada.

#### B1 · Inicio
Resumen del estado de sus despachos, su semáforo de SLA con el objetivo pactado, y su historial de cumplimiento.

#### B2 · Bienvenida
Pantalla de primer ingreso.

#### B3 · Mis pedidos
**Filtros** propios del seller. **Columnas**: estado · destinatario · dirección · fecha de compromiso.

**Detalle del pedido**: su ficha, su seguimiento, el visor de la prueba de entrega, **copiar el enlace de seguimiento** para dárselo al comprador, y **cancelar el pedido** (modal en dos pasos con motivo obligatorio; solo mientras no haya salido a ruta).

**Bloque de etiqueta**: descargar la etiqueta imprimible en térmica 10x15 o carta/A4.

Dos estados vacíos: ningún pedido coincide · todavía no tienes pedidos.

⚠️ El buscador de esta pantalla hoy nunca encuentra nada (ver §13).

#### B4 · Nuevo pedido same-day
Formulario de alta: destinatario · dirección · comuna · teléfono · instrucciones · fecha. Con el mismo aviso de hora de corte que el lado del courier.

#### B5 · Mis cobros
**Listado**: período · estado · factura · pago.

**Detalle del período**: pedido · fecha de entrega · concepto · monto, con el total. **Descargar la factura en PDF.**

Estado vacío: aún no tienes cobros.

#### B6 · Mis incidencias
**Columnas**: estado · tipo · pedido · abierta hace.
Dos estados vacíos: ninguna incidencia coincide · sin incidencias, todo va bien (buen estado).

#### B7 · Conectar mis cuentas de venta
Dos paneles hermanos:

**Mercado Libre** (hasta 10 cuentas por seller):
- Estado de salud de cada cuenta conectada, con su nombre visible y la fecha de su última sincronización correcta.
- Conectar una cuenta nueva · reconectar una caída · renombrar una cuenta (alias) · pedir sincronización ahora.
- **Advertencia previa obligatoria al agregar una segunda cuenta**: si el seller tiene sesión abierta en Mercado Libre, la plataforma no muestra el selector de cuenta y va a reconectar la misma. Hay que decírselo antes, con la salida (cerrar sesión allá o usar ventana privada). Es una limitación de la plataforma externa que no se puede resolver técnicamente: solo se comunica.
- Al alcanzar el tope de cuentas, el botón de agregar desaparece y se explica el límite.

**Shopify**:
- Conectar la tienda: dominio de la tienda (se valida el formato antes de intentar nada) y token de acceso de administración, que el seller pega desde su panel de Shopify.
- Reponer el token cuando caduca.
- Estado de salud y última sincronización.

#### B8 · Bodegas
Las bodegas que el courier registró para retirar en ellas. Estado vacío: tu courier todavía no registró ninguna bodega.

---

### 5.C — App del conductor

**Una sola superficie a diseñar: la app nativa.** Teléfono, en la calle, de pie, una mano ocupada, sol directo en la pantalla, a veces guantes, señal intermitente, batería que no llega al final del turno. Doce pantallas con ruta más la cámara a pantalla completa.

**La PWA web `/conductor` de este repositorio queda FUERA del alcance de diseño.** Existe, funciona y está marcada para retiro. Se documenta solo para detectar qué capacidades viven hoy únicamente ahí — y esas capacidades no se pierden: **se funden en la app nativa** (ver C9 y C10 más abajo, que hoy no existen en el repositorio nativo). ⚠️ **Lo que sí sigue vivo son sus rutas de API**: 18 archivos de ruta bajo `/api/conductor/*` que exponen 20 operaciones, y son las que consume la app nativa. Retirar la PWA no las toca.

Contrato de la superficie, más allá de las pantallas:
- **Sin roles internos**: toda pantalla está disponible para todo conductor autenticado. La autorización real vive en el servidor y la app la conoce como 401 o 403.
- **Sin barra de pestañas ni cajón lateral.** Todo cuelga del manifiesto del día.
- **Pantalla siempre encendida durante la ruta**, con preferencia para apagarlo. Orientación vertical fija.
- ⚠️ **NO hay trabajo sin conexión, y es una decisión tomada.** Las colas persistentes que hoy existen en el repositorio nativo **se retiran**: no habrá bandeja de pendientes, ni conteo de encolados, ni pantalla de "sin conexión". Lo que sí tiene que haber es **reintento automático en segundo plano con aviso**: el conductor registra, sigue avanzando, y ve que ese registro todavía no se confirma. Ese estado intermedio no puede leerse ni como éxito ni como error, y **si cierra la app se pierde** — hay que decírselo. Diseñar también el momento en que finalmente se confirma.
- **Objetivos táctiles grandes** y linterna disponible en las dos pantallas de escaneo.

#### C1 · Arranque e inicio de sesión
Pantalla de marca mientras resuelve la sesión, y el ingreso con correo y contraseña. Solo entran cuentas de tipo conductor y en estado activo; cualquier otra se rechaza y hay que decir por qué sin filtrar información de la cuenta.

#### C2 · Mi ruta del día (manifiesto)
Es el punto de entrada único al día del conductor y se bifurca según el estado del manifiesto:

| Situación | Qué tiene que ver |
|---|---|
| No hay manifiesto | La puerta al retiro en bodega y al traspaso |
| Manifiesto en borrador | Su ruta todavía no está lista. **Hoy es un callejón sin salida** y el rediseño tiene que darle salida |
| Confirmado / en ruta / completado | La ruta con filtros, lista de paradas, progreso y acciones |

La lista de paradas viene **ya secuenciada** y muestra su número de orden. Distingue los pedidos Flex —que obligan a abrir además la app de Mercado Envíos— de los demás. Estados propios: no se pudo cargar · no tienes ruta asignada para hoy · tu ruta todavía no está lista · manifiesto sin pedidos.

**Acciones**: *listo para salir* (confirmar recepción de bultos y arrancar la ruta) y *terminar ruta*. La segunda hoy pide confirmación y la primera no: las dos son de consecuencia y tienen que tratarse igual.

#### C3 · Detalle de la parada
Destinatario, dirección completa (aquí sí se muestra: la necesita para entregar), teléfono, instrucciones de entrega, y la navegación hacia el punto. Desde aquí salen las dos acciones que cierran la parada.

**Registrar entrega**: captura de ubicación, evidencia fotográfica, y estados de progreso con paso nombrado ("obteniendo ubicación", "registrando"). En Flex el registro **es informativo y la interfaz tiene que decirlo sin ambigüedad**: la prueba oficial la gobierna la otra app. Hoy el mismo botón dispara lo mismo en los dos regímenes y la diferencia se comunica solo con texto; el rediseño tiene que resolver esa convivencia.

**Registrar no entregado**: con el tipo de incidencia obligatorio, elegido de los 7 tipos, **y evidencia igualmente obligatoria**. Es el caso donde la evidencia más pesa: respalda el cobro, la incidencia y la conversación con el seller.

##### La regla de evidencia — decisión tomada, y hoy está a medias
- **La evidencia es obligatoria en las dos salidas**: al entregar y al no entregar. Sin evidencia no se cierra la parada.
- **El flujo arranca en la cámara**: el conductor toca la acción y la cámara ya está abierta, sin pantalla intermedia que le pida decidir.
- **Varias fotos por parada, no una.**
- ⚠️ **Dentro del mismo módulo de cámara tiene que existir la opción de adjuntar desde la galería**, con selección múltiple. El conductor necesita adjuntar capturas de pantalla de sus intentos de llamada, de una conversación o de un mensaje, y esas no se sacan con la cámara.

**Lo que hay hoy, verificado en el repositorio nativo, y por qué no alcanza:** son dos caminos con reglas distintas. En el flujo de entrega (`manifiesto/[pedidoId]/index.tsx`) van **1 foto de prueba + hasta 4 evidencias = 5**, con cámara propia y **sin ninguna entrada a la galería**. En la pantalla de evidencias aparte (`manifiesto/[pedidoId]/evidencia.tsx`) el máximo es **10** y ahí sí hay galería con selección múltiple (`ImagePicker`, `allowsMultipleSelection`). O sea: la galería existe, pero **no está donde el conductor la necesita** — al cerrar la parada. Además hoy el envío exige al menos una foto solo en esa pantalla aparte, no en el flujo de entrega. El rediseño unifica las dos entradas en un solo módulo de captura.

#### C4 · Agregar evidencia
Hasta 10 fotos más una nota, adjuntas a un pedido, con cámara propia a pantalla completa —sin la confirmación del sistema, para ahorrar un toque por parada— y adjuntar desde galería con selección múltiple. Las fotos se optimizan antes de subir porque el costo es en segundos, no en almacenamiento. Se pueden eliminar antes de enviar.

⚠️ **El rediseño tiene que decidir si esta pantalla sigue existiendo aparte.** Hoy es la única que ofrece galería, y por eso el conductor que necesita adjuntar una captura al cerrar la parada tiene que salirse del flujo. Lo natural es que el módulo de captura sea uno solo y sirva a las dos entradas.

#### C5 · Mis retiros
Las visitas de retiro del día y la puerta para abrir una bodega. Un conductor puede visitar varias bodegas de sellers distintos en la misma mañana.

#### C6 · Sesión de retiro en bodega
El conductor **escanea el código QR de cada bulto**, y el escaneo casa el bulto físico con el pedido que Rutax ya tiene. Es una **conciliación de bodega**: lo esperado contra lo efectivamente cargado, con las diferencias como excepción. Dos modos: sesión abierta (escaneando) y acta de la visita ya cerrada.

Ingreso manual del código como excepción, para la etiqueta rota o el QR borroso. Cierre de la visita con su resultado.

⚠️ **Hoy la pantalla solo cuenta lo escaneado y nunca muestra lo esperado** — no dice "te faltan N" ni desglosa por comuna. Eso convierte la conciliación en un contador, que es justo lo que no es. El rediseño tiene que mostrar las dos mitades.

#### C7 · Recibir bultos de otro conductor (traspaso)
Recibe por escaneo los bultos que otro conductor le pasa en la calle. **Es la primera vez que un conductor mueve atribución de dinero**: quien retiró conserva el pago del retiro y quien entrega cobra la entrega. Es acción financiera y queda en bitácora con su autor.

Hoy el traspaso es unilateral —no hay pantalla para el conductor que entrega— y los orígenes recibidos se pierden al salir de la pantalla.

#### C8 · Torre móvil — ⚠️ SALE DE LA APP DEL CONDUCTOR
Tres vistas: mapa de puntos con hoja de comunas, avance por conductor, e incidencias abiertas. Hoy
las tres son un prototipo rotulado como tal, con datos ficticios y sin una sola llamada de red.

**Decisión tomada: la Torre móvil es del COORDINADOR, no del conductor.** Es la Torre de control en
el teléfono, para cuando el coordinador está en la bodega o fuera de la oficina. Se diseña dentro de
la superficie del courier —que ya es multi-dispositivo— y **desaparece de la app del conductor**.

Dos razones, y ninguna es estética. La primera: la Torre está gobernada por una capacidad que el
conductor no tiene, así que su presencia en la app es un hueco de control de acceso — hoy le muestra
a cualquier conductor los nombres y el avance de todos sus colegas. La segunda: responde una pregunta
que no es la suya. El conductor necesita saber cómo va SU día; quién necesita ver la flota completa
es quien la coordina.

#### C9 · Mis liquidaciones *(no existe hoy en la app nativa)*
Listado de sus liquidaciones y descarga del documento. Es la única forma que tiene el conductor de ver cuánto le pagan. **Hoy vive únicamente en la PWA que se retira**, y no hay endpoint equivalente para la app: el rediseño la incorpora a la app nativa. Estados: no se pudieron cargar · aún no tienes liquidaciones.

#### C10 · Punto de término *(no existe hoy en la app nativa)*
Dónde termina su ruta. El servidor ya lo soporta; la app no lo llama. Se incorpora a la app nativa con todo su aparato:

- **Flujo de consentimiento explícito, por pasos**, que explica qué se guarda, quién lo ve, que es opcional, que nadie sabe si dijo que no, qué pasa con el tiempo y cuánto dura. El consentimiento es versionado.
- Mapa para marcar el punto.
- Quitar el punto (confirmación).
- Recordatorio de volver a marcarlo si cambia de domicilio.
- **Es dato personal bajo la Ley 21.431**: el consentimiento no es un trámite, es el requisito.

#### C11 · Preferencias
App de mapas preferida, comportamiento durante la ruta (pantalla encendida) y manejo de fotos. La
puerta a la Torre móvil que hoy vive acá **se retira**: ver C8.

#### C12 · Estados de plataforma nativa
Registro enviado pero aún sin confirmar, mientras la app reintenta · permiso de cámara denegado · permiso de galería denegado · permiso de ubicación denegado · error de red con reintento · sesión caducada. Todos necesitan su tratamiento propio; ninguno puede caer en un genérico.

⚠️ Ya NO va: la pantalla de sin conexión, la bandeja de encolados y su conteo. El trabajo sin conexión se retiró del producto.

Dos huecos de navegación que hoy interrumpen el turno y el rediseño tiene que cerrar: **no hay pantalla para marcarse disponible** (el día del conductor empieza con esa marca en el sistema, pero la app arranca directo en el manifiesto), y **el manifiesto en borrador no ofrece salida**.

---

### 5.D — Backstage de Rutax (super-admin)

Marco distinto del resto: sin buscador global, sin centro de avisos, con su propia autenticación.

- **Acceso restringido**: correo y contraseña, más **verificación en dos pasos obligatoria** (enrolamiento con código QR y verificación de 6 dígitos; desafío en cada sesión). Es un muro propio, con su propia pantalla de "verificación requerida".
- **Panel principal**: estado general de la plataforma.
- **Couriers**: listado y detalle por courier. Dos estados vacíos: sin couriers con suscripción · ninguno coincide. En el detalle: su suscripción, sus alertas recientes, y el acceso al **modo soporte**.
- **Modo soporte (impersonation auditada)**: modal que **exige un motivo obligatorio** antes de entrar, y una vez dentro, un banner permanente que recuerda que se está viendo la cuenta de otro. Todo queda en bitácora.
- **Suscripciones**: listado filtrable por estado y detalle. Acciones: asignar plan a un courier (courier · plan · estado inicial · trial hasta · notas internas) · activar · suspender · cancelar · registrar pago manual · generar enlace de cobro · **habilitar la emisión real de facturas para ese courier** (interruptor de consecuencia máxima) · overrides de límites (máximo de conductores, API pública, webhooks, cada uno con "forzar sí / forzar no").
- **Planes**: catálogo. Crear y editar: nombre · descripción · precio mensual · precio anual · límite de pedidos por mes · máximo de conductores. Activar/desactivar.
- **Salud del sistema**: estado de los trabajos en segundo plano, del vigilante y de las integraciones.
- **Métricas de negocio.**
- **Bitácora de auditoría**: tabla con filtros. Es donde vive el "quién hizo qué".
- **Comunicaciones**: crear un anuncio para todos los couriers (título · mensaje · tipo · nivel · vigente hasta), activarlo o desactivarlo, y **confirmar el envío por correo** como paso aparte del anuncio en la aplicación.
- **Seguridad**: gestión del segundo factor.
- Indicador de **solo lectura** cuando corresponde.

⚠️ Es la superficie más atrasada del sistema en calidad de interacción: no tiene retroalimentación de acción de ningún tipo y confirma acciones financieras con los diálogos nativos del navegador (ver §13). Que sea de uso interno no la exime: aquí se habilita la emisión real de facturas de un courier.

---

### 5.E — Sitio público, autenticación y seguimiento

#### E1 · El sitio público comercial — se diseña completo, y no existe hoy

**No hay portada.** La raíz del sitio solo redirige al inicio de sesión según el tipo de usuario; no hay una sola página comercial construida. Esto no es una pantalla a rediseñar: es un sitio a diseñar entero, y **puede tener varias páginas**.

**Su único objetivo es que el visitante agende una demostración.** De ahí se derivan las reglas:

- **Sin precios y sin planes publicados.** Los planes existen en el producto, no en el sitio.
- **Sin prueba gratis** ni ninguna promesa de autoservicio.
- **No se promueve el registro autoservicio.** No hay botón de "crear cuenta" compitiendo con la demostración.
- Todo camino de la página termina en la misma acción: pedir una demostración.

Nota de contexto, no de diseño: **`/registro` existe y funciona de punta a punta —registro de empresa, correo de activación, alta del dueño— pero no tiene un solo enlace entrante en todo el repositorio.** Es una puerta funcional sin picaporte. El rediseño decide qué hacer con ella; lo que no puede es asumir que hoy hay un embudo, porque no lo hay.

#### E2 · Registro y activación de cuenta
- **Registro de empresa**: nombre de fantasía · razón social · RUT de la empresa · nombre completo del dueño · correo. Con validación de RUT chileno.
- **Revisa tu correo**, con reenvío del correo de activación.
- **Activar cuenta**: nombre completo · contraseña · confirmación.

#### E3 · Aceptar invitación
Por enlace con token. Dos caminos: persona nueva (nombre · contraseña · confirmación) y persona que ya tiene cuenta. **Cinco estados de error distintos, cada uno con su propia explicación y su propia salida**: enlace no válido · invitación ya utilizada · enlace vencido · invitación cancelada · no se pudo cargar.

#### E4 · Autenticación
- **Inicio de sesión del courier** e **inicio de sesión del seller**: dos puertas distintas.
- **Recuperar contraseña** y **restablecer contraseña** (nueva y confirmación).

#### E5 · Seguimiento público del envío (`/tracking/[token]`)
Lo ve el destinatario del paquete, sin sesión, casi siempre desde el teléfono. Muestra el estado del envío con su descripción, la comuna, una estimación de llegada mientras no se haya entregado, y una marca en el encabezado. **Nombre, teléfono ni dirección exacta, nunca; el detalle geográfico llega hasta la comuna.** Es la única pantalla del sistema que ve alguien que no es cliente de nadie, y hoy es la peor cuidada del producto en su presentación al mundo.

⚠️ **Precisión importante, porque se presta a confusión: lo que no aplica a Flex es ESTE ENLACE PÚBLICO, no el pedido.** Dentro de Rutax, el courier y el seller ven el estado de cualquier pedido abriendo su detalle, sea Flex, same-day o Shopify, sin excepción. Lo que no se genera para Flex es el enlace que se le manda al comprador final: ahí el comprador ya tiene el seguimiento de Mercado Libre y esta pantalla no tiene nada que aportar. Así que **el enlace público solo aplica a same-day y Shopify**. Evidencia: `src/app/tracking/[token]/page.tsx:120-123`.

El producto ya lo respeta en la interfaz: el bloque "Seguimiento en vivo" con el botón de copiar enlace solo se renderiza en el detalle del seller cuando el pedido es de régimen same-day (`portal/pedidos/[pedidoId]/page.tsx:363`). En Flex no se ofrece, así que nadie comparte un enlace que no funcionaría. ⚠️ Ojo al rediseñarlo: esa condición y la de la página usan **dos predicados distintos** para la misma pregunta —el régimen del pedido en un lado, el gobierno de la prueba de entrega en el otro—. Hoy coinciden; el sistema de diseño debería nombrar la regla una sola vez.

**De quién es esta página — decisión tomada, y hoy está al revés.** Hoy el encabezado muestra la **razón social del seller**, o sea está marcada blanca hacia él. Se decidió que lleve la marca del **COURIER** —es quien entrega y quien paga el software— más un discreto **"powered by Rutax"** al pie.

Dos consecuencias que hay que resolver en el diseño:
- ⚠️ **El sistema no guarda ningún logo del courier.** `identidad.tenants` tiene nombre de fantasía, razón social, RUT, estado, plan y zona horaria — nada de marca. Así que la pantalla tiene que verse bien **con solo un nombre en texto**, y el logo ser una mejora opcional. Habilitarlo de verdad exige columna nueva, almacenamiento y una pantalla donde cargarlo: es trabajo nuevo, no un ajuste.
- El "powered by Rutax" es **el único canal de Rutax hacia consumidores finales**: cada entrega genera una impresión de marca ante alguien que no es cliente de nadie. Merece tratarse como pieza de marca, no como una línea de pie.

#### E6 · Legales y estados de sistema
- **Términos y condiciones** y **Política de privacidad**.
- **Sin conexión.**
- **Error general.**

#### E7 · Hechos verificados que faltan y son trabajo de diseño

- **No existe ningún `not-found.tsx` en todo el proyecto.** Ninguna ruta inexistente tiene página propia: ni en el backoffice, ni en el portal, ni en el seguimiento público. Un enlace roto compartido por WhatsApp no aterriza en ninguna parte pensada.
- **No hay `robots.txt`, ni sitemap, ni metadata social (`openGraph`, tarjetas de Twitter), ni control de indexación en ninguna parte del proyecto.** Verificado por búsqueda en todo `src/`: cero coincidencias.
- La consecuencia más concreta de lo anterior está en el seguimiento: **la URL de seguimiento se comparte por WhatsApp y no tiene previsualización de ningún tipo**, y tampoco tiene una directiva que impida que un buscador la indexe. Es a la vez un problema de presentación y de exposición.

---

### 5.F — Las piezas impresas

No son pantallas, pero salen del producto y las recibe gente real. **Hoy ninguna tiene diseño
propio** y las cuatro entran al alcance.

- **Etiqueta de envío**, en dos formatos: **térmica 10x15 cm** y **carta/A4**. Se pega al paquete y
  la manipula el conductor con una mano. Es la pieza física de mayor volumen del producto. Medio
  hostil: monocroma, baja resolución, sin grises confiables. Tiene que resolver el código de envío
  legible a distancia, el código de barras o QR, el destinatario y la comuna.
  ⚠️ En pedidos de Mercado Libre Flex la etiqueta la genera Mercado Envíos, no Rutax: esta pieza
  aplica a same-day y Shopify.
- **Factura electrónica en PDF.** La descarga el seller y respalda lo que le cobran. Es la cara más
  formal del courier ante su cliente. Hoy la genera el proveedor de facturación sin ningún criterio
  de marca.
- **Liquidación del conductor en PDF.** Cuánto se le paga y por qué, con sus líneas y sus ajustes.
  La lee alguien que desconfía por defecto de un descuento que no entiende: su legibilidad es el
  problema de diseño, no su estética.
- **Manifiesto impreso.** La hoja de ruta en papel, como respaldo cuando el teléfono se queda sin
  batería a mitad de turno. Tiene que servir para trabajar, no para archivar.

---

## 6. Los recorridos

El inventario está organizado por pantalla, pero **el producto se vive en recorridos**. Rediseñar pantalla por pantalla produce pantallas buenas encadenadas en un flujo malo. Estos cinco son los que hay que resolver como trayecto, y cruzan superficies.

### 6.1 El día del coordinador — el más importante, y el único con reloj

Marca la asistencia del día → despacha conductores a retirar → **ve entrar los bultos en vivo mientras la mañana avanza** → clasifica lo que llega por comuna → asigna 25-30 pedidos por conductor, por lotes parciales, sin esperar a que llegue todo → cierra la asignación antes de las 16:00 → monitorea el reparto hasta el corte → resuelve las incidencias que aparecen en la calle.

**Atraviesa:** preparación del día → asignar pedidos → manifiestos → Torre de control → incidencias.

**La aritmética que gobierna todo:** ~5-6 horas para 25-30 paradas, en hora punta, saliendo toda la flota junta desde un mismo punto. **~12 minutos por parada.** Cuarenta minutos de retraso en la salida son ~12% de la ventana de reparto. Cada segundo que la interfaz le roba al coordinador o al conductor sale de ahí.

**Lo que hace o rompe el recorrido:** que la asignación funcione incremental durante toda la mañana; que el paso de "veo lo que llegó" a "lo reparto" no obligue a cambiar de pantalla ni a perder el filtro; y que todo eso se pueda hacer **con el dedo, de pie en la bodega**.

### 6.2 El cierre de dinero

Período abierto acumulando líneas → cierre → la conciliación levanta excepciones → resolverlas → emitir la factura (irreversible) → cobrar al seller → liquidar a los conductores → confirmar los pagos.

**Atraviesa:** períodos → conciliación → detalle del período → cobranza → liquidaciones.

**Lo que hace o rompe el recorrido:** que las excepciones bloqueantes se entiendan y se resuelvan sin salir del hilo, y que el punto de no retorno esté señalizado sin volver ceremoniosa cada pantalla anterior. La emisión es un acto irreversible ante el SII y hoy no hay notas de crédito: el peso tiene que estar exactamente ahí y en ningún otro lado.

### 6.3 La primera hora de un courier nuevo

Registro → verificación de correo → puesta en marcha por pasos (certificado digital, proveedor de facturación, folios, tarifas, cobranza) → invitar al equipo → dar de alta sellers → conectar la primera cuenta de Mercado Libre → ver entrar el primer pedido.

**Atraviesa:** sitio público → registro → puesta en marcha → equipo → sellers → portal del seller → pedidos.

**Lo que hace o rompe el recorrido:** que se pueda abandonar y retomar sin perder el hilo, y que en cada paso se entienda qué falta para poder operar. Es también el recorrido que el sitio comercial promete. Hoy **no tiene principio** (no hay sitio público ni enlace al registro) y **no tiene final** (el asistente no puede darse por completo). Las dos puntas hay que construirlas.

### 6.4 El turno del conductor

Marcarse disponible → recibir sus bodegas de retiro → escanear bulto por bulto → cerrar cada visita → llegar a consolidación → recibir su manifiesto ya secuenciado → 25-30 paradas → cerrar cada una (con dos apps si es Flex) → reportar lo que falló → terminar la ruta → ver su liquidación.

**Atraviesa:** toda la app nativa.

**Lo que hace o rompe el recorrido:** los ~12 minutos por parada, y cuatro huecos que hoy lo interrumpen — no hay pantalla para marcarse disponible; el manifiesto en borrador es un callejón sin salida; la sesión de retiro no muestra lo que se esperaba retirar; y las liquidaciones no existen en la app.

### 6.5 El medio recorrido del seller

Es corto y esporádico a propósito: entra, mira si salió, y se va. **El único trayecto real es arreglar una conexión caída sin llamar a nadie**, y es el que decide si el courier recibe o no una llamada. Hoy ese trayecto está roto por partida doble: al usuario no se le dice cuál de las tres causas ocurrió, y cuando llega al tope de cuentas se le pide que desconecte una cuenta con una operación que el portal no ofrece.

---

## 7. Matriz de objetos de dominio compartidos

**Es el mecanismo que impide que el mismo pedido se diseñe de cinco formas distintas.**

El trabajo se divide por superficie, pero los objetos del dominio **cruzan** las superficies. El mismo pedido lo ve el coordinador como fila de tabla, el seller como su pedido, el conductor como parada en el teléfono, la Torre de control como punto en un mapa, y el comprador final como un estado en una página pública. Si cada superficie lo resuelve por su cuenta, salen cinco pedidos distintos.

Cada objeto de esta tabla se resuelve **una sola vez**, produciendo una representación canónica con variantes derivadas por densidad y por rol. Las variantes son derivaciones de la misma cosa, no diseños independientes.

| Objeto | Superficies donde aparece | Variantes de densidad que necesita |
|---|---|---|
| **Pedido** | Courier (tabla + detalle) · Preparación · Manifiesto · Torre (punto en mapa) · Portal del seller (tabla + detalle) · App del conductor (parada) · Seguimiento público | Fila de tabla · Tarjeta · Encabezado de detalle · Punto en mapa · Elemento de lista móvil · Línea de correo · Estado público |
| **Estado del pedido** | Las siete de arriba | Distintivo · Punto de color · Texto · Agrupador de filtro |
| **Incidencia** | Courier · Portal del seller · App del conductor (la abre) · Correo | Fila · Tarjeta · Formulario de apertura · Aviso |
| **Seller** | Courier (listado + detalle) · Portal (él mismo) · Backstage · Pedido (como campo) | Fila · Selector de filtro · Etiqueta dentro de otro objeto · Perfil |
| **Conductor** | Courier (listado + detalle) · Manifiesto · Liquidación · App (él mismo) · Torre | Fila · Selector · Etiqueta en pedido · Perfil · Marcador en mapa |
| **Manifiesto / ruta** | Courier (listado + detalle + reordenamiento) · App del conductor (su día) | Tabla de paradas · Lista secuenciada móvil · Mapa |
| **Bodega** | Configuración del courier · Portal del seller · App del conductor (sesión de retiro) | Fila · Formulario · Destino de retiro en móvil |
| **Período de cobro / factura** | Courier (listado + detalle + emisión) · Portal del seller (sus cobros) · Correo | Fila · Detalle con líneas · Ceremonia de emisión · Comprobante |
| **Liquidación** | Courier (listado + detalle) · App del conductor (las suyas) | Fila · Detalle con líneas · Lista móvil |
| **Monto en pesos** | Todas | Celda de tabla alineada · Cifra destacada · Total · Línea de correo |
| **Conexión de fuente (ML / Shopify)** | Portal del seller · Courier (salud) · Backstage | Tarjeta de estado · Fila de salud · Flujo de reconexión |
| **Zona y comuna** | Configuración · Torre · Filtros de todos los módulos · Preparación | Selector · Área en mapa · Agrupador |
| **Suscripción y plan** | Courier (su plan) · Backstage (todas) | Tarjeta · Fila · Flujo de cambio |
| **Usuario y rol** | Equipo del courier · Backstage · Invitaciones | Fila · Selector de rol · Correo de invitación |
| **Excepción de conciliación** | Courier (bandeja + detalle) · Centro de avisos | Fila con categoría y bloqueo · Panel de caso con historial · Aviso con monto en juego |

### 7.1 El mismo objeto muestra campos distintos según quién mira — y algunas omisiones son ley

Esto **no es una decisión de diseño y no se puede "mejorar"**. Está impuesto en el código y responde a la Ley 21.431 y a la protección de datos personales.

| Superficie | Qué identifica al pedido | Qué NO puede mostrar, nunca |
|---|---|---|
| **Torre de control** | El código de envío: el número de envío de Mercado Libre en Flex, el código interno en el resto | Nombre, dirección ni teléfono del destinatario. **Ni el token de seguimiento**, que es público y filtraría el pedido a toda la operación |
| **Seguimiento público** | El token que va en la URL | Nombre, teléfono ni dirección exacta. El detalle geográfico llega hasta la **comuna** |
| **App del conductor** | Dirección completa, que la necesita para entregar | — |
| **Portal del seller** | Sus propios pedidos y nada más | Cualquier dato de otro seller, y los costos internos del courier: **lo que el courier le paga al conductor no existe para el seller** |
| **Backoffice del courier** | Todo lo suyo | Nada de otro courier. El valor de un certificado o de un token, ni completo ni parcial |

**Además:** del conductor se guarda **una sola posición, la última, sin histórico**. No hay recorrido. Cualquier propuesta de línea de tiempo o rastro en el mapa reabre una revisión legal.

### 7.2 La consecuencia práctica

Antes de diseñar cualquier pantalla, el objeto que esa pantalla muestra ya tiene que estar resuelto: cómo se nombra, qué campo lo identifica, cómo se ve su estado, y qué campos se omiten en esa superficie. La pantalla decide la disposición; el objeto ya venía decidido.

---

## 8. Inventario de puntos de mensaje

Cada punto de esta lista necesita su texto escrito. Ninguno debe quedar en un genérico.

### 8.1 Confirmaciones de acción irreversible
Cada una tiene que decir la consecuencia en palabras, mostrar un resumen de lo que se compromete, y exigir un acto explícito de confirmación:

Emitir factura · emitir facturas en lote · emitir nota de crédito · cerrar período · cerrar períodos en lote · anular cobro de un pedido · anular liquidación de un pedido · anular línea de liquidación · anular pago de una visita a bodega · emitir pago a un conductor · emitir pagos en lote · marcar liquidación como pagada · ajustar liquidación · cancelar pedido (courier y seller) · cancelar manifiesto · quitar un pedido de un manifiesto · marcar conductor como no disponible y redistribuir · desactivar bodega principal · desactivar cobro automático · revocar API key · eliminar webhook · revocar invitación · quitar punto de término · entrar en modo soporte · suspender o cancelar una suscripción · habilitar la emisión real de facturas.

**Un mismo componente, un mismo comportamiento, en las cinco superficies.** Hoy el backstage usa los diálogos nativos del navegador para media docena de estas y la app del conductor usa alertas nativas para todo; eso desaparece.

### 8.2 Éxito
Cada una de las ~140 acciones de servidor devuelve un resultado que hay que comunicar. Las de mayor consecuencia —las de dinero— necesitan confirmar exactamente qué ocurrió, con su monto y su contraparte, no un "listo".

Dos precisiones que salen del levantamiento y son requisito, no matiz:
- **El tiempo verbal tiene que corresponder al hecho.** Emitir una factura hoy encola un trabajo: decir "factura emitida" cuando todavía no se emitió es mentir en el momento de mayor consecuencia del producto. Cuando la acción es asíncrona, el mensaje dice que quedó en curso y la pantalla tiene que ofrecer dónde ver el desenlace.
- **Una acción sin acuse de recibo no está terminada.** Hoy hay decenas de escrituras que terminan en silencio (ver §13).

### 8.3 Error, por familia
- **Validación de campo**: RUT inválido · correo inválido · contraseña débil · contraseñas que no coinciden · monto fuera de rango · fecha incoherente · rango de folios inválido · dominio de tienda con formato incorrecto · motivo demasiado corto · campo obligatorio vacío.
- **Permiso**: no tienes esta capacidad · sesión caducada · segundo factor requerido. **Toda pantalla de "sin permiso" necesita salida**: a dónde ir, y a quién pedirle el acceso, nombrando el rol correcto.
- **Estado**: el pedido ya cambió de estado mientras mirabas · el período ya está cerrado · el período está bloqueado por excepciones de conciliación · la liquidación ya fue pagada · no hay folios disponibles · no hay tarifa configurada para esta comuna · el manifiesto ya fue confirmado.
- **Integración externa**: la conexión con la fuente está caída · el proveedor de facturación no respondió · el banco no respondió · no se pudo ubicar la dirección · la plataforma externa devolvió un error que no sabemos interpretar.
- **Límite**: alcanzaste el máximo de conductores de tu plan · superaste el límite de pedidos del mes · alcanzaste el tope de cuentas conectadas.
- **Red y sistema**: sin conexión · error inesperado · archivo demasiado grande · formato de archivo no admitido.
- **Lectura fallida**: no se pudo cargar esta lista. **Es una familia propia y hoy no existe**: la ausencia de datos y la falla de lectura se ven idénticas en al menos siete pantallas.
- **Ruta inexistente**: no hay una sola página de "esto no existe" en todo el producto, y la necesitan las cinco superficies, incluida la pública.

### 8.4 Estados vacíos
Más de 40 puntos identificados, en sus tres tonos (arranque, buen estado, filtro sin resultados). Los de "buen estado" —sin incidencias, todo cuadra, sin diferencias— no son ausencia de datos: son una buena noticia y tienen que leerse como tal.

Un estado vacío **nunca puede afirmar un hecho que no comprobó**: decir "todos los pagos se conciliaron solos" cuando el banco jamás se conectó es peor que no decir nada.

### 8.5 Cargando y en progreso
Listados, detalles, acciones largas (calcular ruta, exportar datos, emitir en lote, geocodificar una dirección con el usuario esperando), y estados de progreso con paso nombrado en la app del conductor ("obteniendo ubicación", "registrando entrega").

### 8.6 Truncamiento
Cuando una lista muestra menos de lo que hay, **tiene que decirlo y ofrecer llegar al resto**. Hoy al menos seis listados cortan en silencio (100, 50, 15, 12, 10) y solo uno lo declara. El techo técnico de 1.000 filas de las consultas hace de esto un problema estructural, no una excepción.

### 8.7 Advertencias que no son errores
Pedido creado fuera de la hora de corte · agregar una segunda cuenta de Mercado Libre con sesión abierta · consumo del plan al 80% · excepción que bloquea la facturación · verificación previa omitida deliberadamente · el registro de entrega en Flex es informativo y no es la prueba oficial · una dirección lleva demasiado tiempo sin ubicarse · el correo está en modo de pruebas y no salió de verdad.

### 8.8 Ayuda contextual
Qué es un folio · qué es un certificado digital y por qué vence · qué es una ventana de corte · qué significa cada uno de los 18 tipos de diferencia de conciliación · por qué un pedido aparece como no procesado · por qué la Torre muestra menos pendientes que el listado · qué implica el consentimiento del punto de término · qué es exactamente el monto grande de un detalle de dinero (bruto o neto) y por qué difiere del pie de la tabla.

---

## 9. Correos y notificaciones

Todo aviso dentro de la aplicación es in-app; los correos son un canal aparte y acotado.

**Hay 14 correos definidos y 13 realmente disparables.** El decimocuarto —el enlace de acceso sin contraseña— está versionado, con diseño de marca y personalizado en el proveedor de autenticación, **para un flujo que el producto no implementa**: ningún archivo del código lo puede disparar.

| # | Correo | A quién | Qué pide |
|---|---|---|---|
| 1 | Invitación al portal | Seller | Entrar y conectar sus cuentas de venta |
| 2 | Invitación a la app | Conductor | Instalar y entrar. **Es el único correo que un conductor recibe en toda su vida en el sistema** |
| 3 | Invitación a Rutax | Usuario interno | Crear su contraseña y entrar |
| 4 | Incidencia sin gestionar | **Internos operativos del courier** (máximo 5 destinatarios) | Tomar una incidencia que lleva horas abierta. Lleva código de envío, comuna, tipo y horas, y un enlace directo a la ficha. **Nunca nombre, dirección ni teléfono del destinatario, ni el token público** |
| 5 | Activación de cuenta | Dueño que se registró | Confirmar su correo |
| 6 | Restablecer contraseña | Cualquiera con cuenta | Ponerse una nueva |
| 7 | Bienvenida / suscripción creada | Courier nuevo | Empezar la puesta en marcha |
| 8 | Prueba por vencer | Dueño | Elegir plan antes de que termine |
| 9 | Pago de suscripción confirmado | Dueño | Nada; es confirmación |
| 10 | Cobro de suscripción fallido | Dueño | Corregir el medio de pago |
| 11 | Período vencido (morosidad) | Dueño | Regularizar antes de la suspensión |
| 12 | Plan cambiado | Dueño | Nada; es confirmación |
| 13 | Comunicación de Rutax | Dueño de cada courier no suspendido | Depende del anuncio |
| 14 | Enlace de acceso sin contraseña | — | **Sin disparador.** Existe el contenido, no existe el flujo |

Cada uno necesita asunto, cuerpo y una sola llamada a la acción clara. Hoy se escribieron en tres módulos distintos con tres criterios distintos de estructura, y **nadie los ha revisado nunca como conjunto**: son un sistema, no catorce piezas sueltas.

### 9.1 Tres huecos que el rediseño tiene que ver antes de escribir un solo asunto

**a) Ningún evento de dinero envía un correo.** Ni uno. El motor entrega→dinero no le comunica nada por correo a ninguna de sus dos contrapartes:

- Período cerrado · factura emitida · nota de crédito · liquidación emitida · liquidación pagada · pago enviado al conductor · folios por agotarse · morosidad del seller: **los ocho quedan solo en la bitácora**.
- El seller no se entera por correo de que le facturaron. El conductor no se entera de que le pagaron.

Es una decisión de producto que el rediseño puede mantener o cambiar, pero **no puede ignorar**: hoy el diferenciador del producto es mudo hacia afuera.

**b) El comprador final nunca recibe su enlace de seguimiento por una vía propia de Rutax.** Solo hay dos caminos, y ninguno es de Rutax:
- Un botón de "copiar enlace" que el seller usa **a mano, pedido por pedido**, desde su portal.
- El correo nativo de Shopify, que es de Shopify y no de Rutax.

El destinatario del paquete es el único habitante del sistema que ve Rutax sin tener cuenta, y hoy llega a la pantalla de seguimiento por casualidad.

**c) Los rebotes son invisibles.** Vuelven por un webhook del proveedor y no se muestran en ninguna parte. Un correo de invitación que rebota es una invitación que nadie sabe que nunca llegó. Además, el sistema de correo corre por defecto en modo de pruebas y la interfaz casi nunca lo dice: los correos que salen desde trabajos en segundo plano no tienen ninguna superficie donde reportar que no se enviaron.

---

## 10. Patrones de interfaz que el sistema tiene que resolver

Derivados del inventario, no del código actual. **Cada uno necesita su versión táctil documentada, no una degradación** (ver §1).

- **Listado con filtros persistentes en la URL**, contadores por grupo sobre el conjunto filtrado, paginación, actualización en vivo y **declaración explícita del truncamiento**. Aparece ~15 veces.
- **Filtro de fecha** con tres modos: día exacto, rango con calendario, atajos rápidos. Compartido por todos los módulos.
- **Selección múltiple con acción en bloque**: barra persistente con el conteo, panel de revisión de lo seleccionado, y resultado detallado de qué se pudo y qué no. **Es el patrón con más consecuencia económica del producto** y el que tiene que funcionar con el dedo.
- **Detalle en panel lateral vs. página completa**: el sistema usa ambos y necesita una regla clara de cuándo cada uno.
- **Confirmación de acción irreversible**: con consecuencia escrita, previsualización y acto explícito; no se cierra por accidente. Uno solo, para las cinco superficies.
- **Verificación previa antes de una acción de dinero**, con la posibilidad de omitirla dejando registro.
- **Asistente por pasos** con progreso persistente y estado por paso, retomable en cualquier momento, y **con un final alcanzable**.
- **Bandeja de excepciones** con estado, asignación, fecha límite, banderas de bloqueo, comentarios e historial.
- **Panel de monitoreo en vivo** con mapa, cifras y jerarquía de zoom semántico.
- **Captura en terreno**: un solo módulo que combine cámara y galería con selección múltiple, escaneo de código, ubicación, y reintento automático con aviso de que algo aún no se confirma. Sin colas persistentes.
- **Centro de avisos** jerarquizado por urgencia, con destino y acción por aviso, y un criterio real de qué significa "leído".
- **Buscador global** multi-entidad navegable por teclado, con puerta táctil propia, y que **no se ofrezca donde no funciona**.
- **Tabla financiera** con montos alineados y legibles en columna, y con una sola definición de qué cifra es la de la cabecera y qué cifra es la del pie.
- **Descarga de documento** con elección de formato.
- **Indicador de modo de pruebas** para todo lo tributario y para el correo.
- **Retroalimentación de acción unificada**: un mismo mecanismo de acuse de recibo en las cinco superficies. Hoy hay tres criterios distintos y dos superficies sin ninguno.
- **Distinción entre vacío y fallo de lectura** como patrón, no como caso particular.
- **Tema claro y oscuro** en las cinco superficies. La app del conductor hoy no tiene tema oscuro, y trabaja hasta las 22:00.

---

## 11. Escala y datos reales

Diseñar una tabla para 20 filas cuando en producción hay 500 es un error estructural, no cosmético. Y un artboard poblado con "Empresa Ejemplo S.A." no permite juzgar nada.

### 11.1 Escala del sistema

Conteo verificado en el levantamiento, contando **pantalla** como ruta con página propia:

| Superficie | Pantallas |
|---|---|
| Backoffice del courier — operación | 9 |
| Backoffice del courier — dinero, configuración y personas | 23 |
| Portal del seller | 11 |
| App nativa del conductor | 13 (12 con ruta + la cámara a pantalla completa) |
| Backstage de Rutax | 14 |
| Públicas y autenticación | 14 |
| **Total** | **84** |

Encima de esas 84: **más de 30 modales y paneles laterales**, ~140 acciones de servidor, **29 vocabularios de estado con ~150 valores distintos** y 14 correos. El sitio público comercial no está en el conteo porque **no existe**: es trabajo nuevo, y puede tener varias páginas.

La PWA web del conductor queda fuera del alcance de diseño; sus 18 archivos de ruta de API, que exponen 20 operaciones, siguen vivos porque los consume la app nativa.

**Todo eso tiene que verse como un solo producto.**

### 11.2 Volúmenes reales

- **Pedidos por día por courier:** cientos. Un conductor lleva **25-30 paradas**; una flota de 10 conductores mueve ~300 pedidos diarios.
- **Un retiro real medido:** 130 bultos entre tres bodegas (30 + 30 + 70), un solo conductor, una mañana.
- **Ruta medida con 87 paradas reales:** 390,1 km en orden alfabético contra 185,3 km ya ruteada.
- **Conductores por courier:** entre 5 y 40.
- **Sellers por courier:** ~10 en el piloto. Un seller puede tener hasta **10 cuentas de Mercado Libre** conectadas; hay uno real con 4.
- **Comunas:** 52 en la Región Metropolitana.
- **Techo técnico: las consultas cortan en 1.000 filas.** Una tabla que pretenda mostrar más ya está mintiendo, y hay que decidir qué hace la interfaz cuando el conjunto real supera ese techo.

### 11.3 Cómo se ven los datos de verdad

- **Código de envío same-day:** `RX-7K2M-9PQR` — prefijo `RX-` y dos bloques de cuatro caracteres.
- **Código de envío Flex:** el número de envío de Mercado Libre, numérico y largo.
- **Comunas reales para poblar:** Maipú, Puente Alto, La Florida, Las Condes, Vitacura, Lo Barnechea, Ñuñoa, Providencia, Estación Central, Cerro Navia, La Pintana, Colina.
- **Montos:** pesos chilenos sin decimales. Una tarifa por entrega vive en los miles; un período de cobro a un seller, en los cientos de miles a millones; una liquidación de conductor, en los cientos de miles.
- **Nombres:** personas y empresas chilenas plausibles. RUT con formato chileno y dígito verificador.
- **Horas:** las que importan son las 16:00 (salida) y las 21:00-22:00 (corte). Un artboard con el reloj en las 10:00 está mostrando una operación que todavía no empieza.

---

## 12. Restricciones transversales

No son deseos. Son condiciones de contorno que el diseño tiene que satisfacer, y ninguna se resuelve al final.

### 12.1 Accesibilidad: WCAG 2.2 AA es el piso, no la meta

Contraste, foco visible, navegación completa por teclado, objetivos táctiles con tamaño mínimo, texto que escala, estados que no se comunican solo por color, y etiquetas que describen lo que hay y no lo que se quisiera que hubiera.

Dos contextos lo vuelven concreto en este producto: el conductor trabaja **con sol directo sobre la pantalla, con guantes y con una mano ocupada**, y el coordinador usa la pantalla de asignación **de pie, en un piso de bodega**. La accesibilidad y la usabilidad en terreno son el mismo requisito aquí.

### 12.2 Rendimiento como restricción de diseño

El reloj de las 16:00 convierte cada segundo en costo operativo. Un diseño que necesita tres cargas para asignar 30 pedidos no es un diseño lento: es un diseño caro.

- Las tablas de la operación se recorren cientos de filas a la vez y se refrescan en vivo.
- El teléfono del conductor tiene señal intermitente, batería que no llega al final del turno, y sube fotos por datos móviles con el conductor parado en la puerta. El costo de una imagen se mide en **segundos**, no en megabytes.
- El mapa de la Torre y el de la app son la parte más pesada del producto y se abren varias veces al día por dos minutos.

### 12.3 Convivencia de lo nuevo con lo viejo durante meses

El rediseño no aterriza de una vez. Habrá un período largo en que pantallas nuevas y pantallas viejas conviven en la misma sesión del mismo usuario, y a veces en la misma pantalla.

El sistema tiene que soportar esa convivencia sin verse roto: componentes que puedan reemplazarse de a uno, tokens que puedan coexistir, y una regla clara de qué pasa cuando un patrón nuevo se abre desde una pantalla vieja. **Un plan de migración que exija apagar todo el producto un lunes no es un plan.**

### 12.4 La app de Mercado Envíos es una vecina obligatoria, no una competidora

En los pedidos Flex el conductor lleva **dos aplicaciones abiertas**, y la de Mercado Envíos no es integrable ni reemplazable: su prueba de entrega es la verdad y la de Rutax es informativa.

Las dos apps compiten por los mismos ~12 minutos por parada. El diseño no puede pelear esa batalla: tiene que hacer que el paso de una a otra cueste lo mínimo, que el conductor sepa en todo momento cuál está usando y para qué, y que Rutax nunca dé a entender que su registro reemplaza al oficial. Hoy la diferencia se comunica solo con texto y el mismo botón hace lo mismo en los dos regímenes.

### 12.5 Lo declarado pero no construido: no se diseña, pero no se hace imposible

Cuatro cosas están decididas como dirección del producto y no existen todavía. **No entran en este rediseño**, y tampoco se puede dejar el sistema en un estado que las vuelva imposibles de acomodar:

- **Notas de crédito.** Hoy la emisión de factura es irreversible y no hay reverso. Cuando exista, la ceremonia de emisión tendrá una contraparte.
- **Cobrarle el retiro al seller.** Hoy el retiro genera pago al conductor y **no** genera cobro al seller. El modelo de dinero tiene un lado poblado y el otro vacío a propósito.
- **Ventanas horarias y hora comprometida de Flex.** Hoy el compromiso es el día, no la hora.
- **Más fuentes de pedidos.** Hoy son tres. La procedencia ya es un eje propio y extensible; toda pantalla que muestre procedencia tiene que soportar un cuarto valor sin rediseñarse.

Regla práctica: donde hoy hay dos valores, el diseño no puede asumir que siempre serán dos.

---

## 13. Brechas conocidas

Los ocho anexos cierran cada uno con su sección de brechas: **más de 400 en total** (51 en operación del courier, 110 en dinero y configuración, 28 en el portal, 45 en la app del conductor, 76 en el backstage, 20 en las públicas, 72 transversales y 14 de correos), cada una con evidencia `archivo:línea`. Lo que sigue son las **35 que le importan al diseño** — las que significan que una pantalla miente, que un flujo se corta, que un mensaje no existe, o que una promesa de interfaz no tiene nada detrás.

No están aquí los defectos puramente técnicos (fugas, errores tragados, deuda de infraestructura, rendimiento de consultas): esos viven en `HALLAZGOS-TECNICOS.md` y su arreglo no depende de cómo termine viéndose el producto.

**Para qué sirve esta sección.** No es una lista de errores a corregir dentro del rediseño. Es la lista de sitios donde **la interfaz actual no puede tomarse como evidencia de cómo funciona el sistema**. Si un anexo cita una pantalla que hace algo, y esa pantalla está acá, lo que hace no es lo que dice.

### 13.1 La pantalla miente

**1 · Siete pantallas muestran su estado vacío cuando en realidad falló la lectura.**
Ninguna comprueba el error antes de dibujar: una consulta caída se presenta como "no hay tarifas configuradas", "todavía no tienes sellers", "sin API keys" o un aviso de configuración pendiente. El usuario concluye que tiene que crear algo que ya existe. *Afecta a tarifas, sellers, API, detalle de conductor, retiro y bodegas.* Evidencia: `src/app/(tenant)/configuracion/tarifas/page.tsx:63-83` · `sellers/page.tsx:124` · `configuracion/api/page.tsx:36-49` · `conductores/[id]/page.tsx:167-209` · `configuracion/retiro/page.tsx:67-72` · `configuracion/bodegas/page.tsx:35-39`

**2 · Un manifiesto con pedidos puede decir que no tiene ninguno.**
La carga devuelve una lista vacía ante cualquier error y la pantalla pinta el estado vacío como si el manifiesto estuviera realmente vacío. Es la hoja de ruta de un conductor. Evidencia: `src/app/(tenant)/manifiestos/[manifiestoId]/page.tsx:103`

**3 · Cobranza afirma que todo se concilió solo aunque el banco nunca se conectó.**
El estado vacío da por hecho un éxito que no comprobó, y no enlaza al paso de configuración que falta. Evidencia: `src/app/(tenant)/dinero/cobranza/page.tsx:129`

**4 · Las cifras de dinero no dicen qué son, y una de ellas no es lo que su rótulo afirma.**
En el detalle del período, el monto grande es bruto y el pie de la tabla es neto; en el de la liquidación, la cabecera incluye bono y penalización y el pie no. Nada en pantalla dice cuál es cuál. Y en el portal, el "IVA 19%" que ve el seller **no es IVA**: es el residuo entre el total y la suma de líneas, y con el período abierto el total todavía no existe, así que puede salir negativo. Es una cifra tributaria mostrada a un cliente. Evidencia: `dinero/periodos/[periodoId]/page.tsx:171` vs `:437-439` · `dinero/liquidaciones/[liquidacionId]/page.tsx:115-118` vs `:282` · `src/app/portal/cobros/[periodoId]/page.tsx:294-298` y `:311`

**5 · Un pedido de Shopify se rotula "Same-day" en la app del conductor.**
En la lista, en el filtro y en el detalle. El dato correcto llega del servidor y la app no lo usa: decide por el eje equivocado, en nueve puntos. Evidencia: `rutax-conductor/src/types/index.ts:1-21` · `app/(main)/manifiesto/index.tsx:244, 616, 665, 683`

**6 · El aviso dice "factura emitida" cuando solo se encoló el trabajo.**
Es el punto irreversible del producto y es donde el tiempo verbal importa más. El diálogo hermano de nota de crédito sí usa el tiempo correcto, así que la inconsistencia es interna. Evidencia: `dinero/periodos/[periodoId]/dialog-emitir-factura.tsx:116` vs `src/modules/dinero/acciones.ts:292`

**7 · El inicio de sesión presenta toda causa de fallo como error de tipeo.**
Una caída del servicio, un problema de red o una cuenta suspendida se ven exactamente igual que una contraseña mal escrita. Evidencia: `src/app/login/formulario-login.tsx:29-33`

### 13.2 El flujo se corta

**8 · La puesta en marcha no puede completarse nunca.**
Nada en el código ni en las migraciones escribe el estado que la cierra: los dos únicos escritores dejan valores intermedios. El banner de configuración pendiente **no desaparece jamás**, y dos de los estados de la tarjeta de facturación son inalcanzables. Es la brecha más grave del producto: el recorrido de estreno de un courier no tiene final. Evidencia: `src/app/(tenant)/onboarding/dte/actions.ts:132` y `:254` · `onboarding/estado.ts:153-155` · `src/components/onboarding/banner-onboarding.tsx:33`

Además, mientras dura, **el indicador dice "2 pasos" y la pantalla muestra 5 tarjetas**: el banner del marco y el asistente cuentan universos distintos. Evidencia: `onboarding/estado.ts:168` vs `onboarding/panel-onboarding.tsx:100-104`

**9 · No hay página de inicio, y el registro no tiene un solo enlace entrante.**
La raíz es una redirección sin nada visible. El alta autoservicio existe, funciona de punta a punta, y ninguna superficie la ofrece. Evidencia: `src/app/page.tsx:1-30`

**10 · El destinatario del paquete ve el 404 en inglés del framework, y la página de seguimiento no tiene ni salidas ni marca.**
No existe `not-found.tsx` en ningún nivel del proyecto. La pantalla de seguimiento no tiene enlaces, no nombra al courier, y ante un fallo cae en una pantalla de error escrita en lenguaje de aplicación interna. Es la única superficie que ve alguien que no es cliente. Y hay dos pantallas de registro que enlazan a una ruta de soporte que no existe: los dos enlaces terminan en 404. Evidencia: `src/app/tracking/[token]/page.tsx:108-135` y `:148` · `registro/formulario-alta-empresa.tsx:274` · `registro/revisa-tu-correo/page.tsx:41`

**11 · El portal promete reportar incidencias y no tiene por dónde.**
La bienvenida lo ofrece explícitamente; la sección de incidencias no tiene formulario, ni botón, ni acción, y el detalle del pedido tampoco permite abrir una. Evidencia: `src/app/portal/bienvenida/page.tsx:77` vs `src/app/portal/incidencias/page.tsx:4`

**12 · Las incidencias del seller no llevan a ninguna parte, y una resuelta no dice qué se resolvió.**
La fila no es clicable, no hay pantalla de detalle, la descripción se recorta sin poder expandirse, y las notas de resolución, la fecha de cierre y el efecto sobre el cobro se cargan pero no se dibujan. Evidencia: `src/app/portal/incidencias/page.tsx:114-120` y `:247-256`

**13 · No se puede desconectar una cuenta de Mercado Libre, y un mensaje le pide al seller que lo haga.**
Al llegar al tope de 10, el texto le indica desconectar una desde su portal. Esa operación no existe en el portal. Evidencia: `src/app/portal/conectar-ml/pantalla-conexion-ml.tsx:313`

**14 · "Asignar a manifiesto" pierde el pedido en el camino.**
El detalle enlaza pasando el pedido por la URL y la pantalla de destino no lee ese parámetro: el usuario aterriza en la lista general sin contexto. Mismo patrón en el banner de rezagados del dashboard. Evidencia: `operaciones/[pedidoId]/page.tsx:777` vs `manifiestos/page.tsx:34-40` · `dashboard/page.tsx:644`

**15 · El listado de sellers es terminal: no existe ficha de seller.**
Desde ahí no se llega a sus pedidos, sus bodegas, sus tarifas, sus períodos ni sus conexiones. El seller es uno de los objetos centrales del dominio y no tiene página propia. Evidencia: `src/app/(tenant)/sellers/page.tsx:262`

**16 · Cinco estados no tienen retorno.**
Conductor suspendido, ventana de corte inactiva, tarifa inactivada, zona (no se renombra ni se elimina) y banco conectado (no se desconecta): la interfaz sabe pintar el estado y no ofrece ninguna acción para salir de él. Evidencia: `conductores/[id]/acceso-app-conductor.tsx:83` · `configuracion/zonas/panel-zonas.tsx:557-560` · `configuracion/tarifas/page.tsx:290-311` · `onboarding/cobranza/formulario-conexion-cobranza.tsx:286-295`

**17 · Las pantallas de "sin permiso" son callejones sin salida, y dos mandan a una ruta inexistente.**
Cuatro no tienen botón de escape; dos enlazan a una ruta que no pertenece al área. Y dos nombran como responsable a un rol que **no tiene** la capacidad que hay que pedir. Evidencia: `configuracion/tarifas/page.tsx:46-58` · `torre-de-control/page.tsx:54` · `preparacion/page.tsx:68` · `equipo/page.tsx:68`

**18 · En la app del conductor, el manifiesto en borrador es un callejón sin salida.**
Estado vacío sin un solo botón: ni el retiro, ni el traspaso, ni las preferencias son alcanzables desde ahí. Y el retiro en bodega solo tiene puerta en dos de los cinco estados del manifiesto. Evidencia: `rutax-conductor/app/(main)/manifiesto/index.tsx:369`, `:419`, `:605`

**19 · La app del conductor no tiene liquidaciones ni marca de asistencia.**
Cero archivos que mencionen una u otra en todo el repositorio nativo. El día del conductor empieza marcándose disponible, y la única superficie donde ve cuánto le pagan es la PWA que se retira.

**20 · La sesión de retiro solo cuenta lo escaneado y nunca muestra lo esperado.**
No dice cuántos faltan ni desglosa el cargamento por comuna. Convierte una conciliación de bodega en un contador, que es exactamente lo que no es, y le quita al coordinador el dato que necesita para preparar el piso antes de que llegue el camión. Evidencia: `rutax-conductor/app/(main)/retiro/[sesionId].tsx:515-517`, `:637`, `:670`

### 13.3 El mensaje no existe

**21 · El backstage no tiene un solo aviso de acción, y confirma dinero con los diálogos nativos del navegador.**
Cero avisos de resultado en toda la superficie. Seis de sus siete confirmaciones son diálogos del navegador, incluidas suspender una suscripción, cancelarla, marcar un pago recibido y **habilitar la emisión real de facturas de un courier**. El producto ya tiene un componente de confirmación de dinero y el backstage lo usa una sola vez. Evidencia: `admin/suscripciones/tabla-suscripciones.tsx:239` y `:260` · `suscripciones/[suscripcionId]/cobros-periodos.tsx:49` · `entitlements-overrides.tsx:199` · `planes/tabla-planes.tsx:241`

**22 · Diecinueve acciones del courier no confirman nada al terminar.**
Ajustar una liquidación, marcarla pagada, atribuir o descartar un pago, crear, editar o inactivar una tarifa, y todas las de bodegas, terminan en silencio. Además tres acciones destructivas recargan sin leer el resultado, así que **sus mensajes de error son inalcanzables por construcción**. Evidencia: `dinero/liquidaciones/dialog-ajustar.tsx:70-71` · `configuracion/api/panel-api-keys.tsx:197` · `configuracion/api/panel-webhooks.tsx:157` y `:165`

**23 · Quitar un pedido de un manifiesto se ejecuta al primer clic.**
Desactiva la asignación, devuelve el pedido a la bandeja sin asignar y recarga. Sin diálogo, sin confirmación, sin deshacer, a las 15:50. Evidencia: `manifiestos/[manifiestoId]/boton-quitar-pedido.tsx:22-36`

**24 · La app del conductor cierra sesión en silencio.**
El mensaje de sesión expirada existe y las cuatro pantallas que capturan el error cierran sesión sin mostrarlo. El conductor aterriza en el login, en la calle, sin saber por qué. Evidencia: `rutax-conductor/src/lib/api.ts:43` · `app/(main)/manifiesto/index.tsx:107`

**25 · Ningún aviso propio en toda la app del conductor: 17 alertas nativas.**
Un éxito solo se percibe porque la pantalla cambia. (Las tres colas offline que hoy existen se retiran del producto: ver 5.C.)

**26 · Conectar o reconectar una tienda Shopify no confirma nada.**
El diálogo se cierra y aparece una fila nueva. Es la única escritura del portal del seller sin acuse de recibo, y ocurre justo en el trayecto que decide si el courier recibe una llamada. Evidencia: `src/app/portal/acciones-shopify.ts:156` y `:195`

**27 · El centro de avisos cuenta "sin leer" y el estado leído no existe en ninguna parte.**
El contador, el distintivo numérico y su etiqueta accesible describen un estado que no vive en ningún dato. Su texto vacío nombra 3 de las 8 fuentes de aviso, y en el portal le habla al seller de folios e incidencias que él no gestiona. Evidencia: `src/components/.../centro-avisos.tsx:29` y `:60-64`

**28 · Seis listados se truncan en silencio.**
Incidencias en 100, manifiestos en 50, conciliados recientes en 10, períodos de suscripción en 12, alertas de courier en 15, modo soporte en 10 pedidos. Ninguno lo dice ni ofrece ver el resto. Solo la pantalla de asignación lo declara. Evidencia: `operaciones/incidencias/page.tsx:50` · `manifiestos/page.tsx:73` · `dinero/cobranza/page.tsx:34` · `src/modules/plataforma/vista-soporte.ts:48`

### 13.4 La promesa no tiene nada detrás

**29 · `/equipo` dice que la gestión de rol está "próximamente".**
Es literal, en la celda de acciones de cada usuario activo, y el estado vacío promete poder ajustar el rol cuando se quiera. El estado "suspendido" se dibuja sin que exista ninguna transición que lleve a él. Encima, es la única superficie donde el sistema explica qué hace cada rol, y sus cuatro descripciones omiten capacidades reales. Evidencia: `src/app/(tenant)/equipo/panel-equipo.tsx:276`, `:144`, `:267` · `equipo/descripciones-roles.ts:14-31`

**30 · La búsqueda del portal del seller siempre responde "sin resultados".**
El marco monta el buscador por defecto y el portal no lo apaga; el servidor corta antes de consultar nada porque el seller no es usuario interno, y devuelve una respuesta vacía con código de éxito: ni error de permiso, ni aviso, ni nada. Y el texto de ayuda del campo ofrece buscar sellers y conductores, que son entidades del courier. Evidencia: `src/app/api/buscar/route.ts:48-52` · `src/components/app-shell/app-shell.tsx:451` · `src/app/portal/layout.tsx:66-74`

**31 · Los chips del módulo de dinero se comportan de tres formas distintas, y uno no filtra nada.**
El de "con problemas" en períodos cuenta pero al pulsarlo limpia los filtros, y no existe ninguna forma de listar esos períodos. Los de liquidaciones parecen filtros y no son enlaces, mientras los de períodos y conciliación sí navegan. Y el "Ver PDF" del listado está envuelto en un formulario que no hace nada, porque el parámetro de descarga que envía no lo lee la pantalla de destino. Evidencia: `dinero/periodos/page.tsx:185`, `:200-206`, `:462-478` · `dinero/periodos/[periodoId]/page.tsx:50` · `dinero/liquidaciones/page.tsx:224-232`

**32 · El botón dice "agregar / editar ventana de corte" y no edita.**
El formulario arranca siempre en los valores por defecto, sin precargar la ventana existente. Evidencia: `configuracion/zonas/panel-zonas.tsx:571` y `:601-607`

**33 · Desde el detalle del pedido no hay forma de anular una línea de dinero, aunque los botones existen.**
El componente con las dos acciones y sus diálogos está escrito, y las dos acciones de servidor funcionan. Nadie lo monta en la pantalla. Evidencia: `operaciones/[pedidoId]/acciones-corregir-dinero.tsx:97-131`

**34 · La banda de confirmación de pedido creado del portal es inalcanzable.**
La pantalla la dibuja al ver un parámetro que ningún archivo del proyecto escribe. El flujo real terminó confirmando de otra forma y el banner quedó en pie. Evidencia: `src/app/portal/pedidos/page.tsx:59, 74, 211-215`

**35 · La Torre de control móvil es un prototipo con datos falsos, en producción, y la secuencia de ruta no se puede alterar.**
Todo sale de un archivo de datos ficticios, cero llamadas de red, el botón de llamar marca un número fijo, y un selector de escenarios de desarrollo queda visible para el conductor. En paralelo, el número de orden de cada parada se dibuja pero no hay reordenar, ni saltar, ni "vuelvo después", y el enlace de navegación recibe una sola dirección, así que no existe ruta multiparada. Evidencia: `rutax-conductor/src/torre/fixture.ts:470` · `app/(main)/torre/incidencias.tsx:60` · `src/types/index.ts:49` · `src/lib/navegacion.ts:17`

---

## Cierre

Este documento define **qué** tiene que resolver el rediseño. No define cómo se ve, y no hereda un solo texto de la interfaz actual.

Cuando una pantalla concreta necesite el detalle literal —cada control, cada texto vigente, cada acción de servidor, cada estado declarado— está en los ocho anexos de esta misma carpeta, con archivo y línea. Todo texto que ahí aparezca citado es **material a reemplazar**, nunca una referencia a seguir.
