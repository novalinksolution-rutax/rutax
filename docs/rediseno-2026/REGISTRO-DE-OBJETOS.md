# Rutax · Registro de objetos de dominio compartidos

**Versión 1.1 · 22 de agosto de 2026 · última versión**

Este es el documento que impide que el producto se rompa. Los bloques de trabajo se dividen por módulo, pero los objetos cruzan las superficies: el mismo pedido lo ve el coordinador en una tabla, el seller en su portal, el conductor como parada en el teléfono, la Torre como un punto en un mapa, y el comprador final como un estado en una página pública. Si cada bloque lo resuelve por su cuenta, salen cinco pedidos distintos.

**Regla de uso:** ningún bloque de trabajo redefine un objeto. Se derivan variantes de su canónica y se declaran acá.

---

## Corrección de esta versión

El documento del sistema publica **15 objetos**. Este registro publica **18**, y la diferencia no es un descuido: son tres objetos que estaban tratados como campos de otro y tienen canónica, vocabulario y estados propios.

| Objeto agregado | Estaba tratado como | Por qué es un objeto |
|---|---|---|
| **suscripción y plan** | campo de `courier` | Tiene su propio ciclo de estados, su historial de pagos y su límite de consumo. Lo ven dos superficies con roles distintos: el dueño en Mi plan y el backstage en la ficha del courier. |
| **conexión de fuente** | campo de `seller` | Un seller tiene hasta 10 cuentas de Mercado Libre más sus tiendas Shopify, cada una con su nombre, su última sincronización y su propio estado de salud. |
| **movimiento bancario** | campo de `período` | Un movimiento puede atribuirse a varios períodos, quedar parcial, sobrar o descartarse. No pertenece a un período: se relaciona con ellos. |

**El sistema de diseño hay que corregirlo a 18 en su próxima versión.**

---

## Índice

**Operación:** 1 pedido · 2 bulto · 3 manifiesto · 4 parada · 5 retiro
**Personas y organizaciones:** 6 seller · 7 conductor · 8 courier · 9 usuario y rol
**Configuración:** 10 bodega · 11 zona y comuna · 12 conexión de fuente · 13 suscripción y plan
**Dinero:** 14 período de cobro · 15 liquidación · 16 línea de dinero · 17 excepción · 18 movimiento bancario

Convenciones de las tablas de rol:
**●** se muestra · **○** se oculta · **⛔** prohibido por regla legal o de privacidad, no por preferencia.

---

# 1 · PEDIDO

El objeto central del producto. Es el único que existe en las cinco superficies.

## 1.1 Canónica

| Orden | Campo | Vocabulario en la interfaz | Formato |
|---|---|---|---|
| 1 | destinatario | **Destinatario** | Inicial del nombre + dos apellidos: `M. Fuentes Aravena` |
| 2 | código de envío | **Código de envío** | `RX-7K2M-9PQR` en mono. Sin guiones cuando se digita |
| 3 | comuna | **Comuna** | Nombre completo: `Ñuñoa` |
| 4 | estado de ciclo | **Estado** | Distintivo con tono, glifo y etiqueta |
| 5 | seller | **Seller** | Nombre de fantasía: `Vega Norte` |
| 6 | fecha de compromiso | **Fecha** / **Llega** | `21-08` en tabla · `Hoy, 15:00–17:00` en prosa |
| 7 | procedencia | **Origen** | `SD` · `FLEX` · `SHOP` en mono, con borde, sin color |

**Campos secundarios,** en el orden en que aparecen cuando hay espacio: dirección · teléfono del destinatario · n.º de bultos · conductor asignado · motivo de no entrega · tarifa · línea de cobro · línea de liquidación.

**La jerarquía manda en el orden de caída:** las columnas caen en orden inverso a esta tabla. **Destinatario y código de envío nunca caen.**

## 1.2 Variantes por densidad

| Densidad | Qué muestra | Dónde |
|---|---|---|
| **fila de tabla** | Los 7 campos canónicos, una columna por campo | Pedidos, Asignar, Preparación del día |
| **tarjeta** | Destinatario · código · comuna · estado | Torre de control, panel de selección |
| **encabezado de detalle** | Destinatario en 22px + código en mono debajo; estado, fecha y origen como distintivos | Detalle del pedido |
| **punto en mapa** | **Solo el código de envío** + estado por color y forma | Torre de control ⛔ |
| **línea de correo** | Destinatario + estado en palabras | Correos al seller y al comprador |
| **elemento de lista móvil** | 3 líneas: destinatario + código · comuna + origen · estado | Pedidos en 390, portal en 390 |
| **parada** (app) | N.º de parada · dirección · comuna · n.º de bultos · estado | Manifiesto del conductor |
| **línea impresa** | Dirección · comuna · apellido · código · bultos | Manifiesto impreso |
| **etiqueta térmica** | Comuna 24px · destinatario 17px · dirección · teléfono · código 40px · bultos · origen. **Sin monto** | Etiqueta de envío |
| **vitrina** | Estado · destinatario · código · origen · conductor, **con datos de demostración** | Sitio comercial |

## 1.3 Variantes por rol

| Campo | Coordinador | Supervisor | Administración | Dueño | Seller | Conductor | Comprador | Backstage |
|---|---|---|---|---|---|---|---|---|
| destinatario | ● | ● | ● | ● | ● | ● | ○ | ● |
| código de envío | ● | ● | ● | ● | ● | ● | ● | ● |
| comuna | ● | ● | ● | ● | ● | ● | ● | ● |
| estado de ciclo | ● | ● | ● | ● | ● traducido | ● | ● traducido | ● |
| seller | ● | ● | ● | ● | ○ (es él) | ● | ⛔ | ● |
| fecha de compromiso | ● | ● | ● | ● | ● | ● | ● ventana | ● |
| procedencia | ● | ● | ● | ● | ● | ● | ○ | ● |
| dirección | ● | ● | ● | ● | ● | ● solo su parada | ⛔ | ● |
| teléfono del destinatario | ● | ● | ○ | ● | ● | ● solo su parada | ⛔ | ● |
| conductor asignado | ● | ● | ● | ● | ⛔ | ○ (es él) | ⛔ | ● |
| motivo de no entrega | ● | ● | ● | ● | ● traducido | ● | ○ | ● |
| tarifa | ○ | ○ | ● | ● | ⛔ | ⛔ | ⛔ | ● |
| línea de cobro | ○ | ○ | ● | ● | ● la suya | ⛔ | ⛔ | ● |
| línea de liquidación | ○ | ○ | ● | ● | ⛔ | ● la suya | ⛔ | ● |
| empresa (courier) | — | — | — | — | — | — | — | ● siempre |

**Las cuatro reglas duras del pedido:**
1. En el mapa se muestra el **código de envío**, nunca la dirección ni el nombre del destinatario.
2. Al **seller** nunca se le muestra el conductor, la tarifa, ni lo que el courier le paga al conductor.
3. Al **comprador final** nunca se le muestra dirección, teléfono, nombre del destinatario, seller, conductor ni monto. Se identifica por su código de envío.
4. En el **seguimiento público** no va el nombre de quien recibió: la fórmula es «Lo recibió alguien en el domicilio».

## 1.4 Estados

**Eje 1 · Ciclo** — ¿dónde está el paquete? *Distintivo con color, primera columna.*

| Valor | Tono | Etiqueta interna | Etiqueta en el portal | Etiqueta pública |
|---|---|---|---|---|
| no procesado | `attention` | No procesado | — | — |
| sin asignar | `neutral` | Sin asignar | En preparación | Lo recibimos de la tienda |
| asignado | `neutral` | Asignado | En preparación | Lo recibimos de la tienda |
| en ruta | `progress` | En ruta | En camino | Va en camino |
| entregado | `balanced` | Entregado | Entregado | Llegó |
| no entregado | `fault` | No entregado | Nadie recibió | No había nadie, volvemos mañana |
| devuelto al seller | `neutral` | Devuelto | Devuelto | Lo devolvimos a la tienda |
| cancelado | `inert` + trama | Cancelado | Cancelado | Se canceló |

**Eje 2 · Situación de retiro** — ¿lo retiramos? *Texto en la columna de origen. Ninguna es alarma: que un paquete no se retire es el desenlace normal de la mitad de los casos.*

| Valor | Tono |
|---|---|
| pendiente de retiro | `neutral` |
| retirado | `neutral` — es lo esperado, no un logro |
| no retirado | `neutral` — **no es falla** |
| retiro parcial | `attention` — hay una diferencia que mirar |

**Eje 3 · Estado de dirección** — ¿sabemos dónde va? *Glifo solo, delante del destinatario, con leyenda en la cabecera.*

| Valor | Tono |
|---|---|
| ubicada | sin glifo |
| por revisar | `attention` |
| sin ubicar hace más de 2 días | `fault` |

**Eje 4 · Procedencia** — ¿de dónde entró? *Etiqueta mono con borde, sin color.*

`SD` same-day propio · `FLEX` Mercado Libre Flex · `SHOP` Shopify

**Regla de convivencia:** solo el eje 1 usa distintivo con color. Cuatro distintivos de color en una fila no se leen.

---

# 2 · BULTO

## 2.1 Canónica

| Orden | Campo | Vocabulario | Formato |
|---|---|---|---|
| 1 | código de bulto | **Código** | `RX-7K2M-9PQR` (comparte raíz con el pedido) |
| 2 | posición | **Bulto** | `1 / 2` en mono |
| 3 | pedido al que pertenece | **Pedido** | El código del pedido |

## 2.2 Densidades

| Densidad | Qué muestra |
|---|---|
| fila de registro de escaneo | Código · hora · marca de repetido |
| etiqueta térmica | Código 40px partido en dos líneas + `1 / 2` en 22px |
| contador | `38 escaneados · 42 pendientes · te quedan 4` |
| línea de acta de retiro | Código · si se retiró o no |

## 2.3 Roles

Solo lo ven **coordinador, supervisor, conductor y backstage**. El seller ve la cantidad de bultos de su pedido, nunca sus códigos individuales. El comprador final no sabe que existen.

## 2.4 Estados

| Valor | Tono | Nota |
|---|---|---|
| pendiente | `neutral` | Lo que la plataforma tiene por retirar |
| escaneado | `balanced` | |
| repetido | `attention` | **Transitorio, solo acuse.** No es error |
| no corresponde a esta bodega | `fault` | Transitorio, solo acuse |
| no retirado | `neutral` | Quedó en la bodega del seller |
| en traspaso | `progress` | Sigue contando para quien entrega hasta que el otro acepte |
| entregado | `balanced` | |

---

# 3 · MANIFIESTO

## 3.1 Canónica

| Orden | Campo | Vocabulario | Formato |
|---|---|---|---|
| 1 | conductor | **Conductor** | `C. Vera` |
| 2 | fecha | **Fecha** | `jueves 21 de agosto` en la app, `21-08` en tabla |
| 3 | n.º de paradas | **Paradas** | `24` en mono |
| 4 | estado | **Estado** | Distintivo |

## 3.2 Densidades

| Densidad | Qué muestra |
|---|---|
| fila de tabla | Los 4 canónicos + n.º de bultos + comunas |
| encabezado de la app | `C. Vera · jueves 21 de agosto` + `7 de 24 cerradas` + barra de progreso |
| línea impresa | `Andes Express` + conductor + fecha + `24 PARADAS` |

## 3.3 Roles

| Campo | Coordinador | Supervisor | Administración | Conductor | Seller |
|---|---|---|---|---|---|
| todo | ● | ● | ○ | ● solo el suyo | ⛔ |

## 3.4 Estados

| Valor | Tono | Nota |
|---|---|---|
| borrador | `neutral` | El conductor lo ve como «Tu ruta se está armando», con explicación y sin acciones falsas |
| publicado | `progress` | Ya está en la app del conductor |
| en curso | `progress` | Tiene al menos una parada cerrada |
| cerrado | `balanced` | Se cierra solo al cerrar la última parada |

---

# 4 · PARADA

## 4.1 Canónica

| Orden | Campo | Vocabulario | Formato |
|---|---|---|---|
| 1 | n.º de parada | **N.º** | `8` en mono, 15px en la app |
| 2 | dirección | **Dirección** | `Av. Irarrázaval 2340, depto 91` |
| 3 | comuna | **Comuna** | `Ñuñoa` |
| 4 | n.º de bultos | **Bultos** | `2` en mono |
| 5 | estado | **Estado** | Distintivo |
| 6 | tipo | — | `ENTREGA` (implícito) · `RETIRO` (distintivo explícito) |

## 4.2 Densidades

| Densidad | Qué muestra |
|---|---|
| fila del manifiesto (app) | Los 6, con la dirección en 16px y el n.º en un cuadrado de 34px |
| hoja de detalle (app) | Dirección en grande + botón de navegar + bultos + destinatario al final |
| punto en mapa | **Solo el código de envío** del pedido ⛔ |
| línea impresa | Casilla · n.º · dirección + comuna + apellido · código · bultos · **espacio para escribir** |

## 4.3 Estados

| Valor | Tono |
|---|---|
| pendiente | `neutral` |
| en curso | `progress` |
| entregada | `balanced` |
| no entregada | `fault` |
| reagendada | `attention` |

**Motivos de no entrega, los siete:** nadie recibió · dirección equivocada · el cliente rechazó · zona sin acceso · bulto dañado · el cliente no contesta · fuera de horario.

---

# 5 · RETIRO

## 5.1 Canónica

| Orden | Campo | Vocabulario | Formato |
|---|---|---|---|
| 1 | bodega | **Bodega** | `Vega Norte Maipú` |
| 2 | seller | **Seller** | `Vega Norte` |
| 3 | fecha y hora | **Fecha** | `21-08 11:42` |
| 4 | escaneados de pendientes | **Escaneados / Pendientes** | `38 de 42` en mono |
| 5 | estado | **Estado** | Distintivo |

**Los «pendientes» son los pedidos que la plataforma ya tiene por retirar para ese seller.** El seller no declara una cantidad ni pide un retiro: solo necesita que el conductor pase a buscar lo que hay.

## 5.2 Densidades

| Densidad | Qué muestra |
|---|---|
| fila del histórico (app) | Bodega · fecha + `42 de 42` · distintivo `COMPLETO` o `4 SIN RETIRAR` |
| módulo de escaneo | Las tres cifras arriba: escaneados · pendientes · te quedan |
| acta | Bodega, seller, fecha, las dos cifras y los códigos de los faltantes |

## 5.3 Roles

| Campo | Coordinador | Administración | Conductor | Seller |
|---|---|---|---|---|
| retiro completo | ● | ● (respalda el pago por visita) | ● solo los suyos | ● los de su bodega, sin códigos de bulto |

## 5.4 Estados

| Valor | Tono |
|---|---|
| creado | `neutral` |
| asignado | `progress` |
| en curso | `progress` |
| cerrado completo | `balanced` |
| cerrado parcial | `attention` — los faltantes quedan como «no retirados» |

---

# 6 · SELLER

## 6.1 Canónica

| Orden | Campo | Vocabulario | Formato |
|---|---|---|---|
| 1 | nombre de fantasía | **Seller** | `Vega Norte SpA` |
| 2 | RUT | **RUT** | `77.204.118-6` en mono |
| 3 | estado de conexión | **Conexión** | Tarjeta de salud, ver objeto 12 |
| 4 | estado | **Estado** | Distintivo |

## 6.2 Densidades

| Densidad | Qué muestra |
|---|---|
| fila de tabla | Los 4 + n.º de pedidos del mes + período abierto |
| etiqueta en otra fila | Solo el nombre de fantasía |
| encabezado de ficha | Nombre en 22px + RUT en mono + estado |
| línea de factura | **Razón social completa** + RUT + giro + domicilio |

## 6.3 Roles

| Campo | Coordinador | Administración | Dueño | Conductor | Comprador | Backstage |
|---|---|---|---|---|---|---|
| nombre de fantasía | ● | ● | ● | ● | ⛔ | ● |
| RUT | ○ | ● | ● | ⛔ | ⛔ | ● |
| razón social y domicilio | ○ | ● | ● | ⛔ | ⛔ | ● |
| sus tarifas | ○ | ● | ● | ⛔ | ⛔ | ● |
| sus períodos | ○ | ● | ● | ⛔ | ⛔ | ● |
| empresa (courier) | — | — | — | — | — | ● siempre |

## 6.4 Estados

| Valor | Tono |
|---|---|
| activo | `neutral` |
| invitado | `neutral` — invitación pendiente, vence en 7 días |
| suspendido | `inert` + trama |

---

# 7 · CONDUCTOR

## 7.1 Canónica

| Orden | Campo | Vocabulario | Formato |
|---|---|---|---|
| 1 | nombre | **Conductor** | `C. Vera Espinoza` · `Carlos Vera Espinoza` en documentos |
| 2 | RUT | **RUT** | `17.203.556-2` |
| 3 | relación | — | `dependiente` · `independiente` |
| 4 | disponibilidad | **Estado** | Distintivo |

**Campos secundarios:** capacidad de bultos · datos bancarios · punto de término · teléfono.

## 7.2 Densidades

| Densidad | Qué muestra |
|---|---|
| fila de tabla | Los 4 + capacidad + paradas de hoy |
| etiqueta en otra fila | `R. Muñoz` — inicial + primer apellido |
| avatar en mapa | Cuadrado de 12px rotado 45° con la inicial |
| encabezado de liquidación | Nombre completo + RUT + relación + documento que emite |

## 7.3 Roles

| Campo | Coordinador | Supervisor | Administración | Seller | Comprador | Backstage |
|---|---|---|---|---|---|---|
| nombre | ● | ● | ● | ⛔ | ⛔ | ● |
| RUT | ○ | ○ | ● | ⛔ | ⛔ | ● |
| datos bancarios | ⛔ | ⛔ | ● | ⛔ | ⛔ | ○ |
| punto de término | ● solo si consintió | ○ | ○ | ⛔ | ⛔ | ○ |
| última posición | ● | ● | ○ | ⛔ | ⛔ | ○ |
| recorrido histórico | ⛔ **no existe** | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |

**Reglas duras del conductor:**
1. Del conductor **solo existe su última posición**. No hay recorrido histórico y no se puede dibujar uno.
2. El **punto de término** es dato personal bajo la Ley 21.431: consentimiento en tres pasos, versionado, revocable. Si no consintió, el coordinador ve «Sin punto de término declarado» en tono `inert` —no en falla— y el secuenciador no ofrece optimizar por cierre, con esa razón escrita. **No se muestra qué contestó ni cuándo se le preguntó.**
3. Al **seller** nunca se le muestra el conductor.

## 7.4 Estados

| Valor | Tono | Nota |
|---|---|---|
| disponible | `balanced` | Se marca él desde su app, o su coordinador |
| no disponible | `neutral` | No recibe asignaciones nuevas; las que tiene siguen siendo suyas |
| inactivo | `inert` + rayado | Fuera de la flota, sin borrar |
| suspendido | `inert` + trama | Deja de poder entrar a la app |

---

# 8 · COURIER

Objeto del backstage. El propio courier no se ve a sí mismo como objeto: se ve como «mi empresa».

## 8.1 Canónica

| Orden | Campo | Vocabulario | Formato |
|---|---|---|---|
| 1 | razón social | **Courier** | `Andes Express SpA` |
| 2 | RUT | **RUT** | `76.421.880-3` |
| 3 | plan | **Plan** | Ver objeto 13 |
| 4 | estado de emisión | **Emisión** | `Pruebas` · `Real` |
| 5 | estado | **Estado** | Distintivo |

## 8.2 Densidades

| Densidad | Qué muestra |
|---|---|
| fila de tabla (32px) | Razón social + RUT en 10px · plan · sellers · conductores · pedidos/mes · emisión · último pago · acción de soporte |
| encabezado de ficha | Razón social en 22px + RUT + fecha de alta + plan |
| en el portal del seller | **Solo el nombre de fantasía**, como marca de la superficie |
| en la etiqueta térmica | Nombre de fantasía en 20px |
| en la factura | Razón social + RUT + domicilio + teléfono, como emisor |

## 8.3 Roles

Solo el **backstage** ve el objeto courier completo, y **es la única superficie que ve varias empresas a la vez**. Dentro de un courier, el dueño ve su propia configuración pero no el objeto como tal.

**Regla dura del backstage:** todo objeto se muestra **con su empresa al lado**. Un objeto sin dueño visible ahí es un error de lectura esperando ocurrir.

## 8.4 Estados

| Valor | Tono |
|---|---|
| activo | `neutral` |
| en prueba | `attention` |
| con pago vencido | `fault` |
| suspendido | `inert` + trama |

**Eje independiente · emisión:** `Pruebas` (`attention`) · `Real` (`balanced`). Es distinto del plan en prueba: uno es la simulación ante el SII, el otro es el estado comercial.

---

# 9 · USUARIO Y ROL

## 9.1 Canónica

| Orden | Campo | Vocabulario | Formato |
|---|---|---|---|
| 1 | nombre | **Persona** | `C. Rojas Vidal` |
| 2 | correo | **Correo** | En mono |
| 3 | rol | **Rol** | Nombre del rol, no su lista de permisos |
| 4 | estado | **Estado** | Distintivo |

## 9.2 Los roles

| Superficie | Roles |
|---|---|
| **Courier** | dueño · coordinador · supervisor · administración |
| **Rutax** | soporte · super-admin |
| **Externos** | seller · conductor (no son roles configurables: son objetos) |

**33 capacidades** componen los roles. Un cambio de permisos **se explica con el catálogo de capacidades** —pierde / gana / sigue sin tener—, nunca con un texto escrito a mano.

## 9.3 Estados

| Valor | Tono |
|---|---|
| activa | `neutral` |
| invitada | `neutral` — vence en 7 días |
| suspendida | `inert` + trama |

**Los cinco errores de la invitación:** ya se usó · venció · la canceló el courier · el enlace no es válido · no pudimos abrirla (nuestro).

---

# 10 · BODEGA

**Dos objetos hermanos que no son lo mismo:** de **mis bodegas** sale la flota —son el origen de toda ruta—; en las **bodegas de mis sellers** el conductor retira.

## 10.1 Canónica

| Orden | Campo | Vocabulario | Formato |
|---|---|---|---|
| 1 | nombre | **Bodega** | `Bodega Quilicura` · `Vega Norte Maipú` |
| 2 | dirección | **Dirección** | Calle y número |
| 3 | comuna | **Comuna** | `Quilicura` |
| 4 | dueño | — | courier · seller |
| 5 | estado | **Estado** | Distintivo |

**Campos secundarios:** a quién llamar · instrucciones de acceso · pago por visita.

## 10.2 Roles

| Campo | Coordinador | Administración | Conductor | Seller |
|---|---|---|---|---|
| nombre y comuna | ● | ● | ● | ● las suyas |
| dirección | ● | ● | ● | ● las suyas |
| contacto e instrucciones | ● | ● | ● | ● solo lectura |
| pago por visita | ○ | ● | ⛔ | ⛔ |

**Regla dura:** las instrucciones de acceso a la bodega de un seller **nunca van en la etiqueta térmica**. El paquete pasa por manos ajenas.

## 10.3 Estados

| Valor | Tono |
|---|---|
| activa | `neutral` |
| principal | `balanced` — solo una por courier; desactivarla obliga a elegir la nueva |
| sin ubicar | `attention` — con reintento |
| inactiva | `inert` + trama — con reactivación |

---

# 11 · ZONA Y COMUNA

## 11.1 Canónica

| Objeto | Orden | Campo | Vocabulario |
|---|---|---|---|
| **zona** | 1 | nombre | **Zona** (`Norte`) |
| | 2 | n.º de comunas | **Comunas** (`9`) |
| | 3 | estado | **Estado** |
| **comuna** | 1 | nombre | **Comuna** (`Ñuñoa`) |
| | 2 | zona a la que pertenece | **Zona** |

Las 52 comunas de la Región Metropolitana son un catálogo fijo, no un objeto editable. La **zona** agrupa comunas para tarificar.

## 11.2 Densidades

| Densidad | Qué muestra |
|---|---|
| fila de tabla | Nombre · n.º de comunas · activa |
| polígono en mapa | Nombre + carga en la rampa de cuatro pasos |
| en tarifa | Nombre de la zona como campo |

## 11.3 Estados

| Valor | Tono |
|---|---|
| activa | `neutral` |
| inactiva | `inert` + trama — sus comunas quedan sin zona y usan la tarifa por defecto |

---

# 12 · CONEXIÓN DE FUENTE

**Objeto nuevo en esta versión.** Hasta 10 cuentas de Mercado Libre por seller, más sus tiendas Shopify.

## 12.1 Canónica

| Orden | Campo | Vocabulario | Formato |
|---|---|---|---|
| 1 | nombre visible | **Cuenta** | `Vega Norte Oficial` · `casabonita.myshopify.com` |
| 2 | fuente | **Fuente** | `Mercado Libre Flex` · `Shopify` |
| 3 | última sincronización correcta | **Última sincronización** | `hoy 15:58` |
| 4 | estado de salud | **Estado** | Distintivo |
| 5 | seller dueño | **Seller** | Solo en el backoffice y el backstage |

## 12.2 Densidades

| Densidad | Qué muestra |
|---|---|
| tarjeta de salud (portal) | Los 4 primeros + acciones: reconectar, renombrar, sincronizar ahora |
| fila de salud (backstage) | Empresa · cuenta · fuente · estado |
| columna en Sellers | Solo el estado agregado del seller |

## 12.3 Estados

| Valor | Tono | Qué se le dice al seller |
|---|---|---|
| sana | `balanced` | «Recibiendo pedidos» |
| vence pronto | `attention` | «Vence en 3 días» |
| caída | `fault` | «Dejamos de recibir los pedidos de esta cuenta» |
| desconectada | `inert` + trama | «Desconectada» |

**El problema de comunicación más difícil del producto:** cuando una cuenta se cae, las tres causas posibles —**permiso vencido**, **permiso revocado**, **fallo interno**— son indistinguibles para el sistema. Al seller se le dice **qué dejó de pasar y qué hacer**, no qué se rompió: «Dejamos de recibir los pedidos de "Vega Norte Oficial". Los que ya están en camino se entregan igual. Se arregla en menos de un minuto volviendo a conectar la cuenta.»

---

# 13 · SUSCRIPCIÓN Y PLAN

**Objeto nuevo en esta versión.**

## 13.1 Canónica

| Orden | Campo | Vocabulario | Formato |
|---|---|---|---|
| 1 | plan | **Plan** | `Flota` · `Bodega` |
| 2 | precio mensual | **Mensual** | `$ 149.000` en mono |
| 3 | consumo contra límite | **Pedidos del mes** / **Conductores** | `3.410 de 5.000` · `9 de 15` |
| 4 | estado | **Estado** | Distintivo |
| 5 | último pago | **Último pago** | `03-08 · 149.000` |

## 13.2 Densidades

| Densidad | Qué muestra |
|---|---|
| tarjeta Mi plan | Los 5 + barras de consumo + interruptor de cobro automático + historial |
| fila de tabla (backstage) | Plan · último pago · estado |
| aviso de límite | Solo el consumo y su umbral |

## 13.3 Roles

| Campo | Dueño | Administración | Coordinador | Backstage |
|---|---|---|---|---|
| plan y precio | ● | ● | ○ | ● |
| consumo | ● | ● | ○ | ● |
| historial de pagos | ● | ● | ⛔ | ● |
| condonar un mes | ⛔ | ⛔ | ⛔ | ● peldaño 3 |

## 13.4 Estados

| Valor | Tono |
|---|---|
| en prueba | `attention` |
| activa | `balanced` |
| con pago pendiente | `attention` — todo sigue funcionando |
| suspendida | `fault` — a los 60 días de mora |
| cancelada | `inert` + trama |

**Umbrales de consumo:** 80% avisa en el centro de avisos · 100% muestra aviso embebido con la acción de cambiar de plan. **Nunca un bloqueo silencioso.**

---

# 14 · PERÍODO DE COBRO

## 14.1 Canónica

| Orden | Campo | Vocabulario | Formato |
|---|---|---|---|
| 1 | seller | **Seller** | Nombre de fantasía |
| 2 | período | **Período** | `08-2026` en mono |
| 3 | estado | **Estado** | Distintivo |
| 4 | total neto | **Total neto** | `$ 864.100` en mono, alineado a la derecha |
| 5 | folio | **Folio** | `1041` — solo si está facturado |

**Campos secundarios:** n.º de líneas · n.º de entregas · fecha de cierre · fecha de emisión · excepciones que lo bloquean.

## 14.2 Densidades

| Densidad | Qué muestra |
|---|---|
| fila de tabla | Los 5 + n.º de líneas + composición |
| encabezado de detalle | `Vega Norte · 08-2026` + total en 34px + estado |
| tabla financiera | Agrupado por concepto con subtotal, total con regla de 2px, composición al pie |
| en el portal | Los mismos totales y las mismas líneas, **sin tarifas de otros sellers** |
| factura PDF | Emisor, receptor, líneas agrupadas, neto, **IVA**, total, folio, timbre |
| línea de correo | Período + total + folio si existe |

## 14.3 Roles

| Campo | Administración | Dueño | Seller | Coordinador | Backstage |
|---|---|---|---|---|---|
| todo el período | ● | ● | ● el suyo | ⛔ | ● |
| tarifa aplicada | ● | ● | ● la suya | ⛔ | ● |
| tarifas de otros sellers | ● | ● | ⛔ | ⛔ | ● |
| margen contra la liquidación | ● | ● | ⛔ | ⛔ | ● |

**Regla dura:** el seller ve **la misma tabla, las mismas líneas y el mismo neto** que Administración. Lo que no ve es el otro lado del margen.

## 14.4 Estados

| Valor | Tono | Nota |
|---|---|---|
| abierto | `progress` | Las entregas nuevas entran acá |
| cerrado | `neutral` | Reabrible mientras no esté facturado |
| bloqueado por excepción | `fault` | No se puede facturar hasta resolverla |
| en emisión | `progress` | Asíncrono: «quedó en curso» |
| facturado | `balanced` | Solo lectura, sin composición |
| pagado | `balanced` | |

**Eje independiente · respuesta del SII:**

| Valor | Tono | Nota |
|---|---|---|
| enviado | `progress` | |
| aceptado | `balanced` | |
| **aceptado con observaciones** | `attention` | **No es éxito ni error.** Es válida, se puede cobrar, y hay algo que corregir para la próxima. Nunca en `fault`: una factura válida en rojo hace que alguien la reemita y consuma otro folio |
| rechazado | `fault` | **El folio queda consumido** y hay que decirlo |

---

# 15 · LIQUIDACIÓN

## 15.1 Canónica

| Orden | Campo | Vocabulario | Formato |
|---|---|---|---|
| 1 | conductor | **Conductor** | `C. Vera Espinoza` |
| 2 | período | **Período** | `08-2026` |
| 3 | estado | **Estado** | Distintivo |
| 4 | neto a pagar | **Neto a pagar** | `$ 323.400` |

**Campos secundarios:** composición (`196 entregas · 4 visitas`) · ajustes con su motivo y su autor · relación (dependiente/independiente) · datos bancarios · fecha de pago.

## 15.2 Densidades

| Densidad | Qué muestra |
|---|---|
| fila de tabla | Los 4 + composición + **ajustes (neto)** |
| encabezado de detalle | Nombre + RUT + relación + neto en 34px |
| tabla financiera | **Dos clases de línea con su subtotal** —entregas y visitas a bodega— + ajustes con motivo + total + composición |
| en la app del conductor | La misma tabla en 390, con los motivos completos |
| PDF | En **USTED**, con el motivo de cada ajuste, su autor, su fecha y qué hacer si no está de acuerdo |

## 15.3 Roles

| Campo | Administración | Dueño | Conductor | Coordinador | Seller |
|---|---|---|---|---|---|
| liquidación completa | ● | ● | ● solo la suya | ⛔ | ⛔ |
| motivo de un ajuste | ● | ● | ● **lo lee él** | ⛔ | ⛔ |
| autor del ajuste | ● | ● | ● | ⛔ | ⛔ |
| datos bancarios | ● | ● | ● los suyos | ⛔ | ⛔ |

**Regla dura:** un motivo escrito por un interno que el conductor va a leer **se declara como tal en el formulario donde se escribe**. Viaja a su liquidación y a su PDF; no es una nota interna.

## 15.4 Estados

| Valor | Tono |
|---|---|
| borrador | `neutral` |
| emitida | `progress` |
| pagada | `balanced` |
| pago rechazado por el banco | `fault` — con el motivo traducido, nunca el código del banco |
| pagada fuera de Rutax | `neutral` — registrada a mano, con motivo |

---

# 16 · LÍNEA DE DINERO

El objeto que hace que el motor funcione: **cada entrega genera dos**, conciliadas entre sí.

## 16.1 Canónica

| Orden | Campo | Vocabulario | Formato |
|---|---|---|---|
| 1 | concepto | **Concepto** | `Entrega same-day · Ñuñoa` |
| 2 | cantidad | **Cantidad** | En mono |
| 3 | unitario | **Unitario** | En mono, sin `$` repetido |
| 4 | monto | **Monto** | En mono, con signo menos real si resta |
| 5 | clase | — | **línea de cobro** · **línea de liquidación** |

## 16.2 Densidades

| Densidad | Qué muestra |
|---|---|
| fila de tabla financiera | Los 4, con el negativo en `fault` y **su causa en la misma fila** |
| subtotal | Concepto agrupado + cantidad + monto, con fondo tenue |
| tarjeta de vitrina | Solo el monto con su rótulo de contraparte |
| línea de factura | Concepto + cantidad + unitario + total |

## 16.3 Tipos

| Tipo | Clase | Nota |
|---|---|---|
| entrega | cobro y liquidación | La línea base. Se paga por tarifa |
| visita a bodega | solo liquidación | Se paga por bodega, esté vacía o no. **Al seller todavía no se le cobra el retiro**: ese lado del modelo está vacío a propósito |
| recargo | solo cobro | Reprogramación, por ejemplo |
| ajuste · bono | solo liquidación | Suma. Motivo obligatorio |
| ajuste · penalización | solo liquidación | Resta. Motivo obligatorio, lo lee el conductor |
| ajuste · nota | solo liquidación | Ni suma ni resta: queda escrita |

## 16.4 Estados

| Valor | Tono |
|---|---|
| vigente | sin distintivo |
| anulada | `inert` + trama — **no se borra**: queda con su autor y su motivo |

---

# 17 · EXCEPCIÓN

El dinero que no cuadra. 18 clases de diferencia, de las cuales **tres son fuga directa de ingreso** y llevan tratamiento de alarma: entrega sin cobro · cobro anulado sin motivo · pago duplicado. **Las otras 15 no**: que la bandeja no grite por todo.

## 17.1 Canónica

| Orden | Campo | Vocabulario | Formato |
|---|---|---|---|
| 1 | categoría y tipo | **Categoría** / **Tipo** | `Cobro · Entrega sin cobro` |
| 2 | diferencia | **Diferencia** | `$ 4.200` en mono |
| 3 | estado | **Estado** | Distintivo |
| 4 | vencimiento | **Vence** | `25-08`, con `attention` si está cerca y `fault` si pasó |
| 5 | asignado a | **Asignado a** | `M. Soto` |
| 6 | seller y pedido | **Seller** / **Pedido** | Enlaces al objeto |

## 17.2 Densidades

| Densidad | Qué muestra |
|---|---|
| fila de bandeja | Los 6 + las dos banderas de bloqueo |
| panel de detalle | Todo + acción sugerida + comentarios + historial del caso |
| aviso en el período | Solo la diferencia y el enlace |

## 17.3 Roles

| Campo | Administración | Dueño | Supervisor | Seller | Backstage |
|---|---|---|---|---|---|
| excepción completa | ● | ● | ○ | ⛔ | ● |
| que su período está bloqueado | ● | ● | ○ | ○ | ● |

El seller **nunca ve** una excepción: ve que su período todavía no se facturó, sin el motivo interno.

## 17.4 Estados

| Valor | Tono |
|---|---|
| abierta | `fault` si es de las 3 de fuga · `attention` si es de las otras 15 |
| en revisión | `progress` |
| esperando a un tercero | `neutral` |
| resuelta | `balanced` |
| cerrada | `neutral` |
| reabierta | `attention` — vuelve a bloquear si bloqueaba |

**Dos banderas independientes:** `bloquea facturación` · `bloquea pago`. Encendidas en `flag-on`, apagadas en `--rx-flag-off`, **siempre con su rótulo visible**.

---

# 18 · MOVIMIENTO BANCARIO

**Objeto nuevo en esta versión.**

## 18.1 Canónica

| Orden | Campo | Vocabulario | Formato |
|---|---|---|---|
| 1 | fecha | **Fecha** | `21-08` en mono |
| 2 | contraparte | **Contraparte** | `VEGA NORTE SPA` tal como lo entrega el banco |
| 3 | monto | **Monto** | `$ 812.600` |
| 4 | atribución | **Atribución** | Distintivo |

## 18.2 Densidades

| Densidad | Qué muestra |
|---|---|
| fila de tabla | Los 4 |
| panel de atribución | El movimiento + los períodos impagos del seller + **el calce como resta** |

## 18.3 Roles

Solo **Administración**, el **dueño** y el **backstage**. El seller no ve los movimientos: ve que su período quedó pagado o con saldo.

## 18.4 Estados

| Valor | Tono | Nota |
|---|---|---|
| sin atribuir | `neutral` | |
| pago parcial | `attention` | El resto sigue disponible para otro período |
| pagó de más | `attention` | El excedente queda a favor del seller y visible en su próximo período |
| conciliado | `balanced` | |
| descartado | `inert` + trama | Recuperable desde su cajón |

---

# Anexo A · Objetos que NO están en este registro, y por qué

| Cosa | Por qué no es un objeto compartido |
|---|---|
| **tarifa** | Es configuración de un par seller-zona, no un objeto que cruce superficies. Solo lo ven Administración y el dueño. |
| **ventana de corte** | Configuración de un seller. Su efecto se ve en los pedidos, no ella misma. |
| **folio** | Es un número consumible, no un objeto con estados propios más allá de disponible/consumido. |
| **incidencia** | Es una vista del pedido con su motivo de no entrega, no un objeto aparte. En el portal del seller sí tiene ficha propia con notas de resolución. |
| **comuna** | Catálogo fijo de 52 valores. No se crea ni se edita. |
| **acta de retiro** | Es la representación cerrada del objeto `retiro`, no un objeto distinto. |
| **nota de crédito** | **No existe todavía.** Cuando exista será un objeto hermano de la factura, y la ceremonia de emisión ya tiene el lugar donde iría su contraparte. |

---

# Anexo B · Cómo verificar que el registro funciona

La prueba es la que se corrió con las pantallas 1 y 5 del primer bloque: **el mismo pedido en las dos superficies más opuestas del producto** —la tabla del coordinador y la pantalla de registro de entrega del conductor— tiene que reconocerse como el mismo objeto sin ser la misma pantalla.

Se reconoce por tres cosas y no por su forma:
1. **El identificador es el mismo y está en el mismo orden:** destinatario primero, código de envío inmediatamente debajo, en mono.
2. **El estado usa el mismo tono y el mismo glifo**, aunque la etiqueta cambie de idioma según la superficie.
3. **La procedencia se muestra igual** —`FLEX`, mono, con borde, sin color— porque es la que decide si lo que el conductor registra es la prueba autoritativa o solo informativo.

**Si una pantalla nueva no puede identificar su objeto con esos tres elementos, la pantalla está mal, no el registro.**

---

*Fin del registro. Versión 1.1 · 18 objetos · corrige la cuenta de 15 del documento del sistema.*
