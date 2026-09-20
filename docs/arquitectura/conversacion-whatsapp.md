# Conversación por WhatsApp — consulta de estado del seller

> **Estado:** v1 construida y desplegada (2026-09-20), con el **canal apagado por courier**
> hasta que el copy pase por `copywriter`. Se enciende desde `/admin/whatsapp` (§15).
> **Fuente de verdad de este alcance.** Si otro documento dice lo contrario, gana este.

## 1. Qué es, en una frase

El seller le escribe al número de Rutax un código de pedido y recibe el estado; o pregunta
por el retiro del día y recibe qué se retiró en su bodega y qué faltó. Reemplaza las
decenas de consultas diarias que hoy llegan al WhatsApp personal del coordinador.

**No es un bot conversacional.** Es un buscador con tres respuestas fijas y un menú de
botones. Nada de lo que responde lo redacta un modelo de lenguaje.

## 2. Por qué esta feature, y no otra

- **No cuesta nada por mensaje.** Un mensaje entrante abre la ventana de servicio de 24 h,
  y dentro de esa ventana las respuestas no se cobran. No hay plantilla nueva que aprobar
  en Meta, así que tampoco hay espera de aprobación.
- **Mejora la reputación del número compartido en vez de gastarla.** Meta premia la
  interacción y la tasa de respuesta. Todas las features salientes de todos los couriers se
  benefician. Ver `CLAUDE.md`, sección WhatsApp: la calificación del número es compartida.
- **Le devuelve horas al coordinador**, que es el dolor diario del courier que paga.

## 3. Alcance de la v1

**Entra:**

1. **Consultar un pedido por código.** El seller manda `RX-XXXX-XXXX`, un `ml_shipment_id`
   o pega el JSON del QR de la etiqueta Flex.
2. **Retiro del día.** Hora, bodega, bultos cargados y **cuáles faltaron, con sus códigos**.
3. **Menú de botones** cuando el texto no calza con nada.
4. Tope de consultas por contacto, bitácora de acceso y purga del texto a los 90 días.
5. Ice-breakers en el perfil de empresa y botón «Consultar por WhatsApp» (`wa.me` con texto
   pre-llenado) en el portal del seller.

**Fuera de la v1, a propósito:**

- **Resumen del día** («¿cómo va hoy?»). Decisión del usuario, 2026-09-20. Pasa a la v2.
- **Desambiguación multi-courier** (preguntarle al seller por cuál courier consulta).
  Decisión del usuario: el esfuerzo rinde más en otra parte por ahora.
  ⚠️ **Corrección de la revisión (2026-09-20):** una versión anterior de este documento decía
  que un seller con dos couriers «es poco probable y está lejos». **Es falso.** El switcher
  multi-courier está **construido y desplegado** (`src/app/portal/seleccionar-courier/`,
  `identidad/seller-membresias.ts`), y el alta autoservicio de sellers —en producción desde
  el 16-sep— lo habilita a propósito. Lo que se difiere es la **pregunta** al seller, no el
  caso. Por eso §5.1 no es una precaución teórica: es el manejo de un estado que el producto
  ya soporta.
- **Escalada a un humano** con bandeja en el panel del courier. Ver §7.
- **Decisión de incidencia por botones.** Aprobada en concepto, pero es una etapa posterior
  (§9) porque toca la pantalla de incidencias y la bitácora.
- LLM (§8), WhatsApp Flows, consultas del conductor (tiene la app).

**No toca el motor entrega→dinero.** Solo lee.

## 4. El módulo `conversacion` y su cerca

La feature mezcla cuatro cosas que hoy no son de nadie: resolver quién escribe, entender qué
pidió, decidir si tiene derecho a esa respuesta, y armarla.

- Dejarlo en `integraciones/whatsapp` hace que el adaptador sepa qué es un pedido. Deja de
  ser un adaptador.
- Dejarlo en `operacion` hace que la operación sepa qué es un botón de WhatsApp y una
  ventana de 24 h.

Por eso vive en **`src/modules/conversacion/`**, con **la misma cerca dura que `contexto`**:

> `operacion`, `dinero` e `integraciones` **NO** pueden llamar a `conversacion`, nunca al
> revés.

Direcciones permitidas:

```
conversacion  →  operacion, dinero     (solo lectura, ver §6)
conversacion  →  integraciones         (puerto de WhatsApp, para responder)
integraciones →  conversacion          PROHIBIDO por import.
                                       El webhook PUBLICA un evento; conversacion lo consume.
```

No hay ciclo. Es el mismo patrón que ya usa la cancelación en ML: `integraciones` detecta y
publica, el otro módulo aplica.

⚠️ **La v1 no crea ninguna tabla en `conversacion`.** Sin desambiguación multi-courier no
hay sesión que recordar, y el tope de consultas se cuenta sobre los mensajes entrantes. Si
alguien va a agregar una tabla acá, que primero relea §5.1 y §7.

## 5. Resolución de identidad

Llega un teléfono. Hay que convertirlo en un par `(tenant_id, seller_id)`, y **ese par es el
único alcance de todo lo que se responde**. Se resuelve contra
`integraciones.whatsapp_contactos`, que ya ata teléfono → seller con su `origen` y su
consentimiento.

| Caso | Qué se hace |
| --- | --- |
| Un contacto con consentimiento vigente | Se responde. |
| Ninguno | **Nunca se confirma ni se niega nada sobre un pedido.** Una sola respuesta neutra por número cada 24 h: qué es este número y cómo pedirle al courier que lo registre. |
| Más de uno | **No se responde con datos de ningún pedido**, pero **sí se responde algo**. Ver §5.1. |
| El teléfono viene ilegible | Meta a veces manda algo que no normaliza: `MensajeEntrante.telefonoE164` es `string \| null`. La fila **se guarda igual** con resolución `ilegible`, para que el reintento de Meta no la reprocese. |
| El mensaje pide la baja | Gana sobre todo lo demás. Ya existe `esSolicitudDeBaja`. Nunca se le manda un menú a alguien que pidió que no le escriban. |

`origen = agregado_por_rutax` también puede consultar: es la pareja del seller o su jefe de
bodega, que es justamente quien pregunta.

### 5.1 ⚠️ El caso ambiguo falla cerrado, pero NO en silencio

Si un teléfono resuelve a **más de un contacto** (dos sellers, o el mismo seller en dos
couriers), no se responde nada sobre ningún pedido. El bot respondería con datos del courier
equivocado, y **ese error no se puede deshacer:** el dato ya salió.

Pero el silencio tampoco sirve. Como el multi-courier ya existe (§3), ese seller quedaría
**permanentemente sin canal y sin enterarse**, y el job de Inngest quedaría en verde: es
exactamente el fallo silencioso que ya obligó a poner el contador de «N sellers no reciben
avisos» en `/admin/whatsapp`. Entonces:

- Se responde **una línea neutra**, sin dato de ningún pedido, que lo manda al portal.
- La anomalía queda **contada en `/admin/whatsapp`**, junto al contador que ya existe.

Son unas pocas líneas y no son la feature multi-courier.

## 6. Superficie de lectura de `operacion`

`conversacion` **no arma SQL**. Cada módulo expone su superficie de lectura para terceros,
en `src/modules/operacion/consultas/seller.ts`:

- `estadoDePedidoParaSeller(tenantId, sellerId, identificador)`
- `retiroDelDiaParaSeller(tenantId, sellerId, fecha)`

Reglas que las gobiernan:

1. **El alcance `(tenantId, sellerId)` es obligatorio y va en un objeto `entrada`**, después
   del `cliente` — la convención de `obtenerExpectativaDelDia` y `listarEsperadosDeSeller`.
   El job corre con `service_role`, así que la RLS **no** lo protege: el alcance ES la
   barrera. Misma familia del `GRANT` de tabla completa, que ya mordió dos veces.
2. ⚠️ **El identificador es una unión discriminada, nunca un `string` suelto:**
   `{ tipo: "ml_shipment_id" | "codigo_interno"; valor: string }`. Con un `string`, la
   función tiene que adivinar contra qué columna buscar, y ahí reaparece el bug del eje: un
   `if (tipoPedido === 'flex')`. Con la unión, **la decisión ya la tomó el parser**. Además
   impide que un identificador vacío se convierta en un `select` sin filtro.
3. **Devuelven datos estructurados, nunca texto.** El texto se arma en `conversacion`.
4. **Devuelven `null`, no lanzan**, cuando no hay match o el pedido es de otro seller. El
   llamador no puede distinguir «no existe» de «no es tuyo», y esa indistinguibilidad es
   intencional (§5).
5. Son de solo lectura. No publican eventos ni escriben bitácora de negocio.

### 6.0 🔴 La mitad ya está escrita: `operacion/vista-previa-seller.ts`

La superficie de lectura del seller **ya existe**, con la barrera puesta
(`if (!pedido || pedido.sellerId !== sellerId) return null`) y con la doctrina documentada:
no reusa la vista del courier porque aquélla trae conductor, parada y bitácora, y *«lo que el
seller no debe ver no se consulta»*.

Entonces `consultas/seller.ts` **no se escribe desde cero: se escribe al lado**, reusando la
barrera y `armarHitosSeller`, con un tipo de retorno propio y más pobre. **No se reusa
`armarVistaPreviaSeller` tal cual**, porque devuelve `destinatario` y `donde.direccion`, que
§7 prohíbe mandar por WhatsApp: un canal que se reenvía no puede consumir una función que
trae la dirección «y después filtra».

### 6.2 Qué reusar, exactamente

| Ya existe | Dónde | Para qué |
| --- | --- | --- |
| Barrera `pedido.sellerId !== sellerId` | `vista-previa-seller.ts` | Es la única barrera real. Se copia el patrón. |
| `armarHitosSeller` | `vista-previa-seller.ts` | Se importa tal cual; ya está saneado de nombres. |
| `listarEsperadosDeSeller` | `retiro/expectativa.ts` | **Es el denominador y la lista de faltantes de la consulta de retiro, ya escrita y ya acotada por `(tenantId, sellerId, fecha)`.** No duplicar: si dos sitios cuentan distinto, nadie sabe cuál creer. |
| `obtenerSesionRetiro`, `listarHistoricoDeRetiros` | `retiro/sesiones.ts` | Base del retiro. ⚠️ Están acotadas por conductor y tenant, **no por seller**: hay que agregar el filtro, no asumirlo. |
| `podLoGobiernaLaFuente` | `operacion/fuente.ts` | Decide si el `trackingToken` sirve. **Nunca ramificar por `tipo_pedido`.** |
| `ordenarParadasConSecuencia` | `operacion/orden-paradas.ts` | De ahí sale `parada N de M`. |
| Código visible (`ml_shipment_id ?? codigo_interno`) | `parser-codigo.ts`, `expectativa.ts` | Ya está en tres sitios con el mismo orden. **No agregar un cuarto.** |

Del portal no hay nada que extraer: ya es cáscara sobre `src/modules/operacion/`.

### 6.3 El compilador impone la identidad, no la disciplina

En vez de dos `string` sueltos —que se pueden pasar invertidos sin que nada falle— el alcance
es un **tipo nominal** con marca, producido por **una sola función**,
`resolverAlcanceDesdeContacto`, que es la que implementa §5 y §5.1:

```ts
declare const marca: unique symbol;
export type AlcanceSeller = { tenantId: string; sellerId: string; readonly [marca]: "resuelto" };
```

Consecuencia: **es imposible llamar a la superficie de lectura sin haber pasado por la
resolución de identidad**, y un `{ tenantId, sellerId }` armado a mano no compila. Convierte
la regla más importante de este documento en un error de tipos.

### 6.4 Pruebas de aislamiento exigidas

Una por función no alcanza. En `consultas/seller.test.ts`:

1. `sellerId` de **otro seller del mismo tenant** → `null`. Es el caso más probable, y la RLS
   tampoco lo habría atajado.
2. `sellerId` de **otro tenant** → `null`.
3. `tenantId` correcto e identificador que existe **en otro tenant** → `null`. Los
   `ml_shipment_id` **no son únicos globalmente** y la misma cuenta ML puede vivir en dos
   tenants. Ésta es la que nadie escribe.
4. **Contraprueba**: con el par correcto, devuelve la fila. Sin ella, una función que devuelve
   `null` siempre pasa las tres anteriores — la lección del pgTAP que reponía el CHECK dentro
   del propio test.
5. Retiro con el seller equivocado → `visitas: []` **y** `esperadosHoy: 0`. Los dos: un cero
   en uno y una cifra en el otro ya filtra volumen.
6. **Forma del retorno**: que no aparezcan `destinatario*`, `direccion` ni `conductor*`.
   Barata, y ataja el «le agrego un campito» de dentro de seis meses.

Y una prueba de barrido sobre `src/` —el patrón ya existe en el repo— que **falle si aparece
un import de `conversacion` dentro de `operacion`, `dinero` o `integraciones`**. Convierte la
cerca de §4 en una regla del build en vez de una convención.

### 6.1 Reutilizar, no reescribir

- **`operacion/retiro/parser-codigo.ts` → `parsearCodigoBulto`** reconoce el JSON del QR de
  Flex, el `RX-XXXX-XXXX` y el `ml_shipment_id`, y separa la credencial del identificador.
  **Sigue siendo la única autoridad de formato**: un segundo parser divergiría del que usa el
  conductor al escanear, y un código válido en la app sería inválido por WhatsApp.
- 🔴 **Pero NO se usa tal cual, y esto es lo que una versión anterior de este documento tenía
  mal.** El parser **por contrato nunca dice que no**: cualquier string resuelve a
  `formato: 'desconocido'` con éxito, porque existe para que el conductor no pierda un
  escaneo. Si `conversacion` usara «¿parseó?» como «¿trae código?», **el menú de botones de
  §8 no se ejecutaría jamás**. Hay dos trampas más: `intentarFlexManual` acepta **cualquier
  ristra de 6 a 64 dígitos** (un teléfono, un RUT, un monto), y `comoDesconocido` **preserva
  el mensaje crudo como credencial** — por este canal ese «crudo» es texto escrito por una
  persona, y así se persistiría fuera de la purga de §10.
- **La solución es un envoltorio en `conversacion`**, que es lo único nuevo: (1) tokeniza el
  mensaje, porque el parser recibe UN código y no una frase; (2) llama al parser por token;
  (3) **descarta `formato === 'desconocido'`** — ése es el «no» que el parser no da;
  (4) **descarta la `credencial` entera**, que nunca se persiste ni se repite; (5) mapea el
  resto a la unión discriminada `ml_shipment_id | codigo_interno`.
- ⚠️ **`flex_manual` (la ristra de dígitos) se acepta pero se cuenta aparte.** Es lo que el
  seller copia desde su panel de ML, así que rechazarlo mata el caso de uso principal; pero
  por este canal es una **sonda de existencia de pedidos**, y el tope de §9 solo la hace
  lenta. N intentos numéricos **sin match** en una hora es señal de barrido y **corta el canal
  para ese contacto**. Un match fallido y uno exitoso no pesan igual.
- ⚠️ El payload del QR trae `hash_code`, que es **credencial-símil**. Se usa el `id` y el
  resto **no se guarda con el mensaje ni se repite en la respuesta**. Lo mismo vale para el
  `codigo_crudo` del caso `desconocido`.
- El código visible de un pedido (`ml_shipment_id` si existe, si no `codigo_interno`) ya
  tiene forma en el repo (`codigoVisible`, `codigoVisibleDeBulto`). Se reusa esa regla.

## 7. Qué se responde, y qué no

Ejemplo de la respuesta de un pedido:

```
4476 0788 901 · En ruta
Retirado 11:20 en tu bodega Quilicura. Parada 12 de 27.
[Ver en el portal]
```

- **Sin dirección ni nombre del destinatario.** El seller los ve en el portal porque son sus
  pedidos, pero un chat se reenvía, queda en el respaldo del teléfono y se lee en una
  pantalla ajena. Por WhatsApp va el código, que es lo que identifica el bulto.
- 🔴 **Sin nombre del conductor.** Una versión anterior de este documento decía «Va con
  Marco». **Se cae.** `src/modules/operacion/vista-previa-seller.ts` ya decidió y documentó
  que al seller no se le nombra a nadie: *«Que el paquete avanzó le sirve; quién lo lleva es
  operación interna.»* Tener dos verdades sobre el mismo dato según el canal es peor que
  cualquiera de las dos. Y por WhatsApp es peor todavía: es el dato personal de un trabajador
  (Ley 21.431) saliendo por un canal que nadie controla.
- **`Parada 12 de 27` sí va**: no nombra a nadie y es la respuesta útil a «¿cuándo llega?».
  Sale de `asignaciones_pedido.orden_ruta` vía `ordenarParadasConSecuencia`.
- 🔴 **Sin hora estimada de entrega. Decisión del usuario, 2026-09-20.** Una versión anterior
  decía que «sale de la secuencia de la ruta, que Rutax ya calcula». **No existe:** el motor
  de ruteo calcula secuencia y distancia, no un reloj por parada; `eta-same-day.ts` la deriva
  de la ventana de corte, y en Flex la provee ML. Se evaluó derivarla de la hora de salida
  más `orden_ruta × MINUTOS_POR_PARADA` (la constante de 12 min ya vive en `holgura-ruta.ts`)
  y **se descartó para la v1**: suma trabajo a la etapa 1 y, sobre todo, **el seller le promete
  esa hora a su comprador**. Una hora mal derivada por nosotros hace el mismo daño que una
  hora inventada por un modelo, que es justo lo que §8 prohíbe. Se decide de nuevo cuando
  haya datos de cuántos sellers preguntan «¿a qué hora llega?».
- **El copy ES el producto.** No hay pantalla: hay tres líneas. Pasa por el gate de
  `copywriter` con la regla de menos texto aplicada en duro. Nada de «Gracias por contactar
  a Rutax 😊».
- ⚠️ **Sin escalada, el callejón sin salida lo resuelve el copy.** Cuando el bot no puede
  ayudar, la salida es una línea que diga que escriba a su coordinador. Lo que **no** puede
  decir es nada que insinúe que alguien leyó el mensaje: un «lo estamos revisando» cuando
  nadie lo está revisando es peor que no tener el canal.

## 8. Interpretación del mensaje — sin IA, a propósito

Orden de reglas, todas deterministas:

1. ¿Es una baja? **`conversacion` no la evalúa: no recibe el evento.** El webhook ya corre
   `esSolicitudDeBaja`, ya revoca el consentimiento, y **publica `whatsapp/mensaje.recibido`
   solo si `pideBaja === false`**. Así la regla «nunca se le manda un menú a quien pidió la
   baja» la impone la ausencia del evento, no un `if` en el consumidor.
2. ¿Trae uno o más códigos? → el envoltorio de §6.1 sobre `parsearCodigoBulto`.
3. ¿Calza con una intención conocida? → «retiro», normalizado igual que la baja
   (mayúsculas, sin tildes, sin puntuación).
4. Nada calza → menú de botones. El fallo nunca es un «no te entendí» a secas.

Esto cubre la gran mayoría de los mensajes sin una línea de IA.

**Dónde podría entrar un LLM (v2, opcional):** clasificar en una intención conocida el texto
que no calzó, antes de mostrar el menú. Pasa el gate de IA del proyecto: sugiere, no ejecuta,
y si falla o tarda aparece el menú de siempre, así que no está en el camino crítico.
Por minimización, al modelo le llegaría el texto del mensaje y nada más: sin teléfono, sin
nombre del seller, sin códigos.

⚠️ **Lo que un LLM nunca hace: redactar la respuesta con los datos.** Estados, horas y
códigos salen de la base y se arman con nuestras plantillas de texto. Un modelo que redacta
el estado de un pedido termina inventando una hora de entrega, y esa hora el seller se la
promete a su comprador.

## 9. Arquitectura de ejecución

```
Meta → POST /api/webhooks/whatsapp   (normaliza, guarda, 200 SIEMPRE)
          └─ publica  whatsapp/mensaje.recibido
                └─ job de `conversacion`  → operacion/consultas/seller.ts
                                          → puerto de WhatsApp (responde)
```

- **El webhook no responde.** Sigue siendo lo que ya es. Resolver una consulta puede tardar
  y puede fallar, y un 4xx acumulado hace que **Meta desactive la suscripción**, dejando a
  todos los couriers sin acuses.
- **Idempotencia:** `id` determinístico `consulta-whatsapp-${metaMessageId}` en el evento,
  como todos los eventos del repo. El webhook de Meta **no admite anti-replay** (Meta no
  firma un timestamp), así que la deduplicación de Inngest es la única barrera contra
  responder dos veces. La fila del entrante se reserva **antes** de publicar, igual que en
  los salientes.
- **El evento no lleva `tenantId`**, y es el único del archivo en esa situación: en ese punto
  todavía no se sabe cuál es. Hay que comentarlo en `src/lib/inngest/eventos.ts` o el próximo
  que lo lea lo va a corregir creyendo que es un olvido.
- ⚠️ **El `texto` del payload es dato personal en crudo** y queda en el log de eventos de
  Inngest. Por eso va acotado en largo y por eso la fila se purga a los 90 días. **Nunca se
  agrega el `hash_code` del QR a ese payload.**
- **Tope de abuso:** del orden de 20 consultas por contacto y por hora. No es por costo
  —es cero— sino para que un teléfono comprometido no sirva para barrer códigos.
- **Bitácora:** una consulta es un acceso a datos por un canal fuera del portal. Va a
  `bitacora_auditoria` **ANTES** de llamar a Meta, no después ni en paralelo: es la regla de
  orden del proyecto, y así la auditoría queda completa aunque el envío falle.
  ⚠️ **El «autor» aquí no es un `actorUsuarioId` de auth**, es un contacto de WhatsApp. Eso
  no calza con RNF-04 tal como está escrito y **necesita decisión explícita**. Propuesta:
  `actor = 'sistema'` con el `contacto_id` en los metadatos, y **nunca el teléfono en crudo**
  en un campo de auditoría que se consulta ampliamente. (Verificado: el enum
  `identidad.actor_tipo_auditoria` ya tiene `'sistema'`; no hay nada que migrar.)
- ⚠️ **«Bitácora de todo acceso» NO incluye los mensajes no resueltos**, y no es una omisión:
  `bitacora_auditoria` tiene un CHECK que exige `tenant_id` salvo para `super_admin`, y un
  mensaje ambiguo o de un número desconocido no tiene tenant. Tampoco es un acceso a datos:
  no se le respondió nada. Intentar insertarlo igual se come un 23514. **Esos casos se cuentan
  en la columna `resolucion` de la tabla de entrantes**, no en la bitácora.

## 10. Migraciones

**Una sola tabla nueva: `integraciones.whatsapp_mensajes_entrantes`.**

⚠️ **Tabla hermana, no una columna `direccion` en `whatsapp_mensajes`.** Mismo argumento con
el que Shopify tiene su propia tabla de conexiones y no reusa la de ML:

- El saliente tiene clave de idempotencia, plantilla, contacto y estado monótono. El
  entrante no tiene nada de eso.
- **El entrante guarda texto libre escrito por una persona**, que a veces trae un teléfono o
  una dirección dentro. Meterlo en la tabla cuyos `GRANT` están afinados para lo saliente es
  exactamente cómo se filtra una columna sin que nadie lo note.
- Consecuencia: **el texto se purga a los 90 días** y queda la métrica de cuántas consultas
  hubo. Minimización sin perder el dato agregado.

**La regla del `tenant_id`:** el mensaje entra antes de saber de qué tenant es, así que
`tenant_id` **es nullable**, y eso se sostiene porque lo acotan tres cosas **en la base**, no
en la aplicación:

- Un CHECK que impide que una fila sin tenant guarde `texto`, `seller_id`, `contacto_id` ni
  clasificación. Queda teléfono, hora y la resolución: exactamente lo que pide este párrafo.
- Un CHECK que ata resolución y tenant: `resuelto` ⟺ hay tenant, seller y contacto; `ambiguo`,
  `sin_contacto` e `ilegible` ⟹ tenant nulo. **El error irreversible de §5.1 se vuelve un
  23514**, no una respuesta al seller equivocado.
- FK compuesta `(tenant_id, seller_id) → identidad.sellers (tenant_id, id)`: el tenant
  denormalizado no puede contradecir al del seller.

Y el aislamiento no descansa en esa columna: **la tabla es deny-all**, sin vista espejo en
`public` y con `GRANT` por columna, así que no hay política que un nulo pueda dejar abierta.
Se descartaron las dos alternativas: un tenant centinela miente en cualquier `group by`, y
partir en dos tablas **rompe la idempotencia**, que es el punto entero —la llave es una sola,
el `wamid`, y el mismo mensaje entraría en las dos.

⚠️ **La tabla lleva `clasificacion` y `hubo_match`, y el envoltorio del parser (§6.1) tiene
que escribirlas.** Sin esas dos columnas la señal de barrido de §6.1 no existe, y nadie se
va a dar cuenta hasta que alguien esté sondeando códigos.

**La purga** es una función `SECURITY DEFINER` que solo `service_role` puede ejecutar, en
tandas, llamada por un **job de Inngest** hasta que devuelva 0. No hay `pg_cron`. Después de
purgar queda la fila entera menos el texto, con `texto_largo` para que una fila purgada no se
confunda con una que nunca trajo texto.

## 11. Etapas

| # | Qué | Esfuerzo |
| --- | --- | --- |
| 1 | Módulo `conversacion` con su cerca, tabla de entrantes, resolución de identidad (§5, incluido el fallo cerrado de §5.1) y **estado de un pedido por código**. | M |
| 2 | **Retiro del día**, menú de botones, ice-breakers y botón `wa.me` en el portal. | S |
| 3 (v2) | Decisión de incidencia por botones: registra la instrucción del seller con autor en bitácora; **el coordinador la aplica**. Toca la pantalla de incidencias, así que pasa por `copywriter`. | M |

⚠️ **La «M» de la etapa 1 está subestimada** (revisión, 2026-09-20). No cubre el envoltorio
del parser (§6.1), el tipo nominal de alcance (§6.3), las seis pruebas (§6.4) ni la migración
con su pgTAP. Sigue siendo del orden de una semana, pero no con el alcance que la tabla
insinúa. La ETA ya no la arrastra: quedó fuera de la v1 (§7).

La etapa 1 prueba si el seller adopta el canal. Si no lo adopta, no se construye la 2.

⚠️ **Condición del gate de IA (§8):** si algún día se retira el menú de botones «porque el
LLM ya clasifica bien», el LLM pasó a ser dependencia dura del camino crítico y **el gate se
reabre**. El menú es lo que lo mantiene fuera de él.

## 12. El límite que no se cruza

Va escrito acá porque es el que alguien va a querer cruzar con toda la buena intención:

> **Un botón de WhatsApp no cierra una incidencia, no anula una línea de cobro y no aprueba
> un pago.** Registra la instrucción del seller, con autor y en bitácora. La aplica un
> humano desde la web.

## 13. Riesgos

- **Suplantación:** quien tenga el teléfono del seller consulta como él. Mitigación: solo
  contactos registrados con consentimiento, tope de consultas, sin datos personales del
  destinatario en la respuesta, y bitácora de todo acceso.
- **Phishing inverso:** el seller se acostumbra a que Rutax le escriba por WhatsApp. Todos
  los enlaces van a `rutax.io` y **nunca se pide una credencial por el canal**.
- **Reputación del número compartido:** el tráfico entrante no la gasta. Lo que la gastaría
  son las features hacia el destinatario, y esas son las que obligan a pasar a un número por
  courier. El hueco para ese cambio ya está en `fabrica-whatsapp.ts`.

## 14. Referencias

- `CLAUDE.md`, sección **WhatsApp (Cloud API de Meta)** — decisiones que costaría re-derivar:
  número único 1:N, calidad compartida, `es` y no `es_CL`, acuses desordenados, el webhook
  sin anti-replay y siempre 200.
- `src/modules/integraciones/notificaciones/whatsapp/webhook-eventos.ts` — el normalizador y
  `MensajeEntrante`, ya construidos.
- `src/modules/operacion/retiro/parser-codigo.ts` — `parsearCodigoBulto`.
- `docs/arquitectura/retiro-y-ruteo.md` — la sesión de retiro, que es lo que responde la
  consulta de retiro.

## 15. Control desde el backstage (submódulo de `/admin/whatsapp`)

El canal lo controla **Rutax**, no el courier, como el resto de WhatsApp. Vive como una
sección dentro de `/admin/whatsapp`, no como pantalla aparte.

- **`integraciones.whatsapp_canal_consulta_config`**: una fila por courier (`tenant_id` es PK
  y FK, así que no existe fila global). Guarda `canal_activo` y los dos topes.
- ⚠️ **`canal_activo` nace en `false`, y ése es el punto.** La feature se desplegó antes de
  que el copy pasara por `copywriter`: el canal existe apagado y se enciende a mano.
- ⚠️ **La ausencia de fila NO es `false` por sí sola**: un `select` sin fila devuelve cero
  filas, que en TypeScript es `null`. Por eso se lee con
  `public.whatsapp_canal_consulta_config(p_tenant_id)`, que **siempre devuelve una fila** —
  apagada y con los topes por defecto— más un `configurado` que distingue «apagado a mano»
  de «nunca configurado». **Nunca un select crudo a la tabla.**
- **Los topes viven solo en la base.** Las constantes que estaban en `abuso.ts` se borraron:
  dos fuentes con el mismo número y nada que las ate es la trampa del tope de cuentas ML.
- Un CHECK ata los dos topes: el corte por barrido no puede ser mayor que el tope general,
  o el general cortaría siempre primero y la protección contra sondeo sería una protección
  muerta que la pantalla mostraría como viva.

### 15.1 Por qué el motivo de corte es columna propia

`integraciones.whatsapp_mensajes_entrantes.motivo_no_respondido` (migración `20260920000003`)
con seis valores: `respondido`, `canal_apagado`, `tope_consultas`, `barrido_codigos`,
`sin_alcance`, `aviso_neutro_omitido`.

⚠️ **No es un valor más de `clasificacion`, y no por gusto: meterlo ahí rompe el detector de
barrido.** El corte se decide contando `clasificacion = 'flex_manual' and hubo_match = false`
de la última hora, y la fila que corta es ella misma uno de los intentos contados. Escribirle
`barrido_codigos` a `clasificacion` **borraría el `flex_manual` que el detector cuenta**: el
corte se auto-invisibiliza para el mensaje siguiente. Son dos ejes — `clasificacion` dice qué
trajo el mensaje, el motivo dice por qué no se respondió.

⚠️ **`null` no significa «se respondió»**: significa que el job todavía no tocó la fila, que
es un estado real porque el webhook la reserva antes de publicar el evento. Si el caso normal
fuera el nulo, un job caído a la mitad y una respuesta exitosa serían la misma fila. De ahí
sale el contador de **pendientes**.

### 15.2 El contador que no puede faltar

⚠️ **`cortadasPorCanalApagado` alto es el fallo silencioso de este canal**: el seller escribe,
nadie le responde, y nada falla — el job termina en verde. Va arriba y en ámbar, igual que el
contador de contactos ambiguos (§5.1) y que el de «N sellers no reciben avisos» que ya existía
en esa pantalla.

⚠️ **El contador de ambiguos NO puede ser por courier**, y no es una limitación de la
pantalla: un contacto ambiguo no tiene tenant por definición, y el CHECK de la base lo impone.
Va como contador global.

## 16. ⚠️ La WABA tiene que estar suscrita a la app (2026-09-20)

**Síntoma:** el canal encendido, el webhook configurado, `messages` suscrito, y aun así un
mensaje real del seller **nunca llegaba**. Ni un POST en los registros del servidor. El
botón «Probar» de Meta sí funcionaba de punta a punta, lo que hacía ver el problema como si
fuera del código.

**Causa:** configurar el webhook en el panel de la app **NO** hace que la cuenta de WhatsApp
(WABA) le entregue el tráfico. Es un paso aparte, solo por API:

```
POST /{WABA_ID}/subscribed_apps      → {"success": true}
GET  /{WABA_ID}/subscribed_apps      → verifica quién está suscrito
```

⚠️ **El botón «Probar» del panel no pasa por la WABA**, así que pasa aunque la suscripción
falte. No sirve para descartar esto; al contrario, engaña.

Es el mismo patrón del `POST /{phone-number-id}/register` con el PIN: estar en la WABA no
habilita el uso por API. **Con cada número o cuenta nueva hay que repetirlo.**

**Lo que había suscrito:** una app de Meta llamada **«Business Agent»** (id
`1143680903703001`, `link: whatsapp.com`), que Meta engancha sola a la WABA. Es el **Meta
Business Agent**, su agente de IA que contesta 24/7; para nuestro número está en «Empezar»,
o sea **no activado**. No la creamos nosotros y no aparece en las apps del desarrollador
(ahí solo está Rutax API).

⚠️ **No encender el Meta Business Agent.** Contestaría los mensajes de los sellers con una IA
genérica, en paralelo a nuestro bot determinista, sin saber nada de pedidos ni de retiros —
y choca de frente con §8 y con el gate de IA del proyecto.

**Y para que no se repita la confusión:** el aviso de retiro que llega al seller lo manda
**Rutax API**, la misma app. No existe ni existió una app aparte para eso.

## 17. Ice-breakers y comandos del número (2026-09-20)

El canal se explica solo con lo que Meta ofrece en el propio número, **sin gastar mensajes
ni plantillas**. Configurado por API sobre el `phone-number-id`:

```
POST /{phone-number-id}/conversational_automation
GET  /{phone-number-id}?fields=conversational_automation      (verifica)
```

Lo que quedó puesto:
- **prompts (ice-breakers):** «Retiro de hoy» y «Consultar un pedido». Se muestran **antes**
  de que la persona escriba, y **solo en una conversación nueva**: quien ya tiene hilo
  abierto con el número no los ve.
- **commands:** `/retiro` y `/pedido`, que aparecen al escribir `/`.
- `enable_welcome_message: false`. Activarlo hace que Meta avise cuando alguien abre el chat
  sin escribir, y eso es maquinaria nueva (otro evento que atender) para poco.

⚠️ **Los comandos no son un eje nuevo: llegan como texto normal.** `/retiro` cae en el
normalizador de §8 —que borra la puntuación— y resuelve a `RETIRO`, la intención que ya
existe. `/pedido` resuelve a `PEDIDO`, que no es intención conocida y **cae al menú a
propósito**: el menú es justamente el que enseña a mandar un código. No hay que agregarle
una rama al enrutador.

**Descartado (y por qué):** un enlace `wa.me` con el código pre-llenado desde el portal.
Suena útil hasta que se nota que **el seller que está en el portal ya ve el estado ahí
mismo** (decisión del usuario, 2026-09-20). Solo tendría sentido fuera del portal —un
correo, por ejemplo—, y eso es otro caso, más chico.
