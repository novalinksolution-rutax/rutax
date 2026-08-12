# Plan de acción — retiro en bodega + ruteo

> Documento de **ejecución**. El alcance y las decisiones de producto viven en
> `@docs/arquitectura/retiro-y-ruteo.md` — si algo se contradice, manda ese.
> Última revisión: 2026-08-12.

## Cómo leer este plan

**Son dos repos y una sola operación.**

| Repo | Qué aporta |
|---|---|
| `SaaS Courier Again` (este) | Base de datos, jobs, pantallas del courier y del seller, y **las rutas API que consume la app** |
| `Desktop/rutax-conductor` | La app nativa del conductor: retiro, escaneo, ruta |

**No son opcionales el uno para el otro.** El retiro *ocurre* en la app; el resto del sistema solo
lo consume. Cada etapa que toca la app se entrega junto con sus rutas API — se despliegan el mismo
día o no funciona ninguna de las dos mitades.

Cada etapa lleva: **qué incluye · qué se puede demostrar al terminarla · dónde · quién · esfuerzo ·
qué puede salir mal.** El esfuerzo es en días de trabajo enfocado, no en calendario.

## Punto de partida (2026-08-12)

Ya arreglado y verificado — 2.246 pruebas verdes:

- El backfill de Flex leía un campo inexistente e ingestaba **cero**. Corregido, con el extractor
  extraído a función exportada para que la prueba ejerza el código real y no una copia.
- El refresco de tokens de ML solo actuaba con el token **ya vencido**, lo que desvinculaba sellers
  en silencio. Corregido.
- Un filtro contra una columna inexistente **mataba tres detectores de conciliación**. Corregido.
- La línea de liquidación **nunca cambiaba de conductor**: entregaba uno y cobraba otro. Corregido
  con re-atribución condicionada (muta si la liquidación sigue en borrador; si ya se emitió, no toca
  nada y levanta excepción).

---

# Las etapas

## Etapa 0 · Apagar la auto-asignación

**Qué incluye.** Ocultar el botón de auto-asignación y desactivar su punto de entrada. No se borra
código todavía — se apaga.

**Por qué primero.** Barre todos los pedidos del día en `pendiente_asignacion` sin saber de retiros.
Cuando la ingesta empiece a traer los pedidos que despacha la competencia, los marcaría como
asignados, y desde ahí ML mismo reporta "en camino" y "entregado" → **cobro al seller por entregas
que hizo otro courier**. Es la mecha, y se apaga antes de encender la ingesta.

**Qué se demuestra.** Nada visible. Es una reja.

**Dónde.** `src/app/(tenant)/manifiestos/boton-auto-asignar.tsx`, y el registro del job en
`src/app/api/inngest/route.ts` si tiene cron.

**Quién.** `backend` · **Esfuerzo.** medio día.

**Qué puede salir mal.** Que alguien la use hoy y la extrañe. Confirmar con el usuario antes de
apagarla del todo; si hace falta, dejarla accesible con un aviso.

---

## Etapa 1 · Ingesta diaria + el campo propio de Rutax

**La etapa que sostiene todo lo demás.** Sin ella, un escaneo devuelve un número suelto.

**Qué incluye.**

1. **Verificación en vivo contra una cuenta ML real** — antes de escribir la ingesta. Tres cosas:
   el campo del envío en la orden, el formato en que responde la consulta de varios envíos a la vez,
   y si el filtro incremental *realmente* filtra. ⚠️ **ML ignora en silencio los parámetros que no
   conoce**, así que un filtro mal escrito parece funcionar y trae todo. La prueba de aceptación es
   comparar el total con y sin el filtro.
2. **El webhook pasa a crear pedidos.** Hoy, si el envío no está en la base, lo ignora en silencio
   (`procesar-shipment.ts:161-168`). Ese es el cambio de mayor rendimiento por línea escrita: el
   tópico de envíos ya avisa de los nuevos.
3. **Barrido de respaldo** cada 10–15 min por conexión sana, troceado por página (el backfill actual
   hace todo dentro de un solo paso: si expira, el reintento empieza de cero).
4. **Suscribir el tópico de órdenes**, porque la búsqueda de ventas **oculta las canceladas** y sin
   eso un pedido cancelado no se entera nunca.
5. **`estado_ml` pasa a guardar el estado del envío**, no el de la orden. Viene en la misma respuesta
   que ya se pide: **costo de cuota cero**. Falta la cabecera de formato nuevo — ojo, con ella el
   bloque de dirección cambia de nombre y hay que ajustar el lector de coordenadas o se pierde el
   geocoding gratis de Flex.
6. **`destinatario_nombre` sale del envío**, no del título del producto. Hoy muestra *qué compró* el
   destinatario en el portal, en el manifiesto y en la app: es peor que el nombre, no mejor.
   El teléfono **no se trae** — ML lo entrega ofuscado.
7. **El campo `situacion_retiro`** en `operacion.pedidos`: `pendiente | retirado | no_procesado`.
   Campo **propio de Rutax, separado del estado del pedido** — en Flex el estado lo gobierna ML y
   meterle estados propios choca con la sincronización.
8. **Declarar `concurrency`/`throttle`** en los jobs de ML y de geocoding. Hoy ninguno lo declara: a
   1.000 pedidos se disparan 1.000 ejecuciones concurrentes contra Google. Y es plata: ~US$150/mes
   por courier si el caché no pega.
9. **Backfill de geocoding de los pedidos viejos**: hay que **resetear su estado a pendiente** antes,
   porque el job es no-op si ya está resuelto — y los anteriores al 11-ago guardan el centroide de la
   comuna marcado como resuelto. Si no, todas las paradas de Maipú caen en el mismo punto.

**Qué se demuestra.** El coordinador abre la pantalla a las 9:00 y **ve los pedidos de hoy**. Es la
primera vez que el número de Rutax coincide con la realidad. Se demuestra solo, sin nada más.

**Dónde.** `src/modules/integraciones/ml/jobs/` (nuevo job de ingesta + `procesar-shipment.ts` +
`ejecutar-backfill.ts`), `src/app/api/webhooks/ml/shipments/route.ts`, `src/lib/inngest/eventos.ts`,
y una migración para el campo nuevo.

**Quién.** `integraciones` (ingesta) + `base-datos-rls` (el campo) · **Esfuerzo.** 4–6 días. Lo caro
no es el código: es observar 48 h de corrida real antes de confiar en el conteo.

**Qué puede salir mal.**
- ⚠️ **El endpoint del webhook tiene 500 ms.** Si no responde a tiempo, ML **desactiva los tópicos
  suscritos** — todos, no solo el nuevo — y nadie se entera salvo por la ausencia de notificaciones.
  Medir el percentil 99 del endpoint **antes** de agregar tópicos, y jamás poner la ingesta dentro
  del handler.
- **Un envío puede cubrir varias órdenes** (carrito). El pedido se colapsa en uno — correcto para el
  retiro, 1 QR = 1 bulto — pero hay que decidirlo a propósito, no por efecto secundario.
- **La "conexión representativa"**: tres lugares caen a *cualquier* cuenta del seller cuando falta el
  identificador de cuenta. Con 3 cuentas aciertas 1 de 3; con 10, 1 de 10, y el token equivocado da
  error. Regla dura: **todo pedido Flex nace con su cuenta estampada**, y donde no la haya, fallar
  explícito en vez de adivinar.

---

## Etapa 2 · Las bodegas del seller

**Qué incluye.** Tabla `identidad.seller_bodegas` — un seller tiene **varias**. Con `tenant_id`, RLS,
y **clave foránea compuesta** `(tenant_id, seller_id)` para que un bug de app no pueda colgar una
bodega del seller de otro courier. Dirección, comuna y coordenada, geocodificadas reusando el puerto
que ya existe. Las carga **el courier** (que el seller las configure desde su portal queda para más
adelante). Pantalla de alta y edición.

**Qué se demuestra.** El courier ve sus bodegas en el mapa y puede corregir una dirección mal escrita.

**Dónde.** Migración nueva + `src/app/(tenant)/sellers/`.

**Quién.** `base-datos-rls` → `frontend` (flujo definido antes por `ux-ui`) · **Esfuerzo.** 2 días.

**Qué puede salir mal.** Poco. Es la etapa más tranquila del plan, y sin ella el retiro no tiene lugar
físico ni la ruta punto de partida.

**También aquí:** subir el tope de cuentas ML de 3 a 10 (trigger, validación, textos y pruebas), y
matar los fallbacks de conexión representativa del punto anterior.

---

## Etapa 3 · El retiro: base de datos y API

**Qué incluye.**

- `operacion.retiros_bodega` (una visita: conductor, seller, bodega, apertura, cierre, observación) y
  `operacion.retiro_escaneos` (un bulto: código crudo, momento, resultado). Modeladas sobre
  `cierres_conductor` — **registro paralelo que NO mueve la máquina de estados de Flex**.
- **El string del QR**, con las dos barreras: **cifrado** con la primitiva que ya existe, y **permiso
  por columna**. La vista pública se declara con **lista explícita de columnas**, nunca `select *` —
  ese patrón ya filtró una columna nueva dos veces en este proyecto. Se guarda solo `hash_code` y
  `security_digit`; el resto ya está en el pedido. Y `hash_code`, `qr_payload` y `qr` entran a las dos
  listas negras de secretos.
- **Idempotencia doble**: por identificador de escaneo (cubre el reintento del lote) y por
  `(retiro, código)` (cubre el doble escaneo físico — cada disparo de la cámara genera un
  identificador nuevo, así que la primera llave no basta). **Un duplicado se fusiona, no da error.**
- **Endpoint de escaneos por lote**, hasta 50 por llamada, con **resultado por elemento**: un código
  desconocido no puede tumbar los otros 49. Responde por código si se reconoció, y con qué comuna y
  seller, para que la app corrija su pintado.
- **Un código que Rutax no puede procesar contra su ingesta se guarda igual.** Nunca se pierde un
  escaneo. Si el seller no tiene su cuenta conectada, ese listado queda respaldado para resolverlo
  después.
- **La resolución del código NO amplía la regla de acceso del conductor.** Va por endpoint con
  cliente de servicio que devuelve **lo mínimo**: pedido, seller, comuna y si es candidato. Nunca
  nombre, dirección ni teléfono del destinatario — el que retira no entrega, no los necesita.
  Ampliar la regla expondría los 400 destinatarios del día a cada conductor.
- **Al cerrar la visita**, el campo `situacion_retiro` de esos pedidos pasa a `retirado`.
- **Prueba de aislamiento por endpoint.** Las rutas Bearer del conductor usan cliente de servicio, que
  **salta las reglas de la base**: el aislamiento ahí es código, no base. Hace falta una prueba por
  endpoint que verifique el rechazo cruzado entre couriers, más las pruebas de base por tabla nueva.

**Qué se demuestra.** Con una llamada se registra una visita completa y el conteo aparece del lado
del courier. Todavía sin app.

**Dónde.** Migraciones + `src/app/api/conductor/retiros/`.

**Quién.** `arquitecto` (contratos) → `base-datos-rls` → `backend` → `qa` · **Esfuerzo.** 5–7 días.

**Qué puede salir mal.** Que se resuelva el aislamiento "en la app" y se descubra tarde. Por eso las
pruebas por endpoint van en esta etapa y no después.

---

## Etapa 4 · El retiro en la app del conductor

**Repo `Desktop/rutax-conductor`.** Se entrega junto con la etapa 3.

**Antes de construir, tres arreglos en la app** — no es refactor, es que hoy **se pierde información**:

1. Lo que el conductor escanea *mientras* se está subiendo lo anterior **se borra al guardar**.
2. Apretar **"Salir" borra la cola sin preguntar**, y el botón está en el encabezado de todas las
   pantallas.
3. Si la sesión venció sin señal, el primer intento de subida da 401, **ese 401 dispara el cierre de
   sesión, y eso borra todo**.

Con el retiro encima, esos tres significan **perder el registro de 130 bultos**. No se construye una
arquitectura sin conexión: se quitan las tres formas en que se borra sola.

**Qué incluye.**

- **"Carga del día"** — lista de bodegas del conductor. Entra por una tarjeta en la pantalla que ya
  es su aterrizaje; hoy el recolector ve "sin ruta asignada", que es exactamente el hueco.
- **La cámara en ráfaga** — visor casi a pantalla completa, **contador gigante**, franja de color, y
  feedback distinto para lectura buena, duplicado y desconocido. ⚠️ **El lector dispara varias veces
  por segundo** mientras el código está en cuadro: sin un registro de leídos más una espera corta, un
  paquete se cuenta cinco veces — y ese conteo es el número que el jefe mira.
- **Nunca depende de la red para aceptar un código.** Al abrir la bodega se descarga lo esperado; el
  escaneo se acepta contra eso, se pinta, y se encola. **En la bodega no se bloquea al conductor
  jamás** — el seller lo está apurando.
- **Cierre de la bodega** con su resumen y observación.
- **Cola propia del retiro, hermana y no mezclada** con la de evidencias: aquí un escaneo **no se
  puede volver a capturar** (el bulto ya se fue), así que **nunca se descarta solo**; si agota
  reintentos pasa a "requiere atención", visible.
- **Reanudar una bodega a medias** si la app se cierra: la visita vive en el servidor, no en memoria.
- **Ingreso manual del código** para etiqueta ilegible.
- La batería importa: **desmontar la cámara entre bultos y entre visitas**, y restringir el lector
  solo a QR. Una hora de cámara abierta son ~20% de batería antes de salir a repartir.

**Qué se demuestra.** El día completo del retiro, de punta a punta, con paquetes reales.

**Quién.** `frontend` (con `ux-ui` antes) · **Esfuerzo.** 6–8 días, más terreno.

**Qué puede salir mal.**
- **El courier piloto no usa ninguna app hoy.** La adopción es obligatoria y no hay legado que
  preservar, pero la pantalla tiene que funcionar **sin capacitación**. Si el conductor duda, se
  perdió.
- Dependencias nuevas y permiso de cámara en la configuración de la app.
- Probar el escaneo en un **iPhone real**, no solo en Android ni en el entorno de desarrollo.

---

## Etapa 5 · Preparación del día

**Qué incluye.** Pantalla en vivo, en `(tenant)`, dentro de `operacion` — **no** en `contexto`: la
Torre es de solo lectura por regla dura y esta escribe.

1. **Retiros en curso** — quién, dónde, cuántos lleva, hace cuánto no reporta. Es lo que mira el jefe:
   reemplaza el WhatsApp sin pedirle a nadie que entre a buscar nada.
2. **Acumulado por comuna, creciendo solo** — para preparar el piso de la bodega y decidir cuántos
   conductores por zona **antes** de que llegue el primer camión.
3. **La asignación, ahí mismo** (etapa 6).

**Dos arreglos obligatorios acá:**

- ⚠️ **El componente de tiempo real no refresca bajo flujo continuo.** Es una espera que se reinicia
  con cada evento: con diez conductores vaciando colas, **la pantalla queda congelada minutos** justo
  cuando el coordinador la mira. Hay que ponerle un tope máximo de espera. Son ~6 líneas y **arregla
  las seis pantallas que ya lo usan**.
- **Agregar en la base, no en memoria.** Una función que devuelva ~50 filas por comuna, en vez de leer
  400–1.000 y contarlas. De paso elimina el truncamiento silencioso.
- Las tablas nuevas necesitan su **migración de publicación** para tiempo real, o el "en vivo" no
  emite nada y falla en silencio.

**Qué se demuestra.** El jefe deja de preguntar por WhatsApp.

**Quién.** `ux-ui` → `frontend` + `backend` · **Esfuerzo.** 4–5 días.

---

## Etapa 6 · Asignación en bloque

**Antes, deuda que hay que pagar:** la marca de asignación activa **nunca se apaga al entregar**, así
que la tabla crece sin fin y **toda consulta sobre ella se trunca en silencio**. La pantalla nueva se
construye sobre esa tabla. Además hoy ya hace que la ficha de dinero del conductor muestre montos
menores a los reales.

**Qué incluye.**

- Filtro de **comuna multi-selección** con chips (hoy es una sola comuna, y el caso real es
  "Vitacura + Lo Barnechea + Las Condes").
- **Solo se ofrece lo que está `retirado`.** Esa es la reja: los pedidos de la competencia entraron
  por la ingesta, se quedaron en `pendiente` y **no aparecen nunca**.
- Selección con casilla por fila, rango con mayúsculas+clic, y **"seleccionar los N del filtro"** —
  que manda un criterio, no 400 identificadores.
- **La selección sobrevive al cambio de filtro y de página.** Hoy se vacía.
- Barra fija con **contador vivo**, desglose por comuna, kilómetros estimados y aviso de capacidad
  configurable — **nunca un tope duro**: un lunes con lluvia son 20 y un viernes de campaña 40.
- **El manifiesto pasa a ser subproducto** de la asignación, no paso previo.
- Escritura **en bloque y transaccional**. Hoy es un bucle secuencial con hasta 3 viajes por pedido
  (400 pedidos ≈ 1.200 viajes) y **revienta por URL demasiado larga** al volumen del piloto.
- Se arregla de paso que la paginación **pierde los filtros** y que los contadores por estado se
  calculan sobre 25 filas.

**Qué se demuestra.** El coordinador filtra tres comunas, marca 30, elige conductor y asigna. Dos
gestos donde hoy son dos vueltas completas.

**Quién.** `ux-ui` → `frontend` + `backend` · **Esfuerzo.** 5–6 días.

---

## Etapa 7 · El ruteo

**Qué incluye.**

- Motor en **TypeScript puro** — vecino cercano + 2-opt + Or-opt sobre las coordenadas que ya
  existen. **US$0/mes.** Medido: **0,12 ms para 30 paradas** con evaluación por diferencia. No
  necesita job. ⚠️ La versión ingenua cuesta **82 ms con 100 nodos** contra 1,1 ms — la implementación
  importa, la ubicación no.
- Envuelto tras un **puerto** que imita al de geocoding, **asíncrono desde el día uno**, para que
  cambiar a distancias por calle sea una línea en una fábrica y no una reescritura.
- **Secuencia persistida** — hoy el orden es alfabético, se calcula al dibujar y no se guarda.
- **Reordenar a mano**, obligatorio: las distancias son en línea recta y en Santiago el Mapocho, la
  Costanera y Vespucio producen saltos visiblemente absurdos. Es el salvavidas de la función.
- **Inicio en la bodega, fin donde el conductor quiera terminar.** Él pone la dirección desde su app,
  **opcional y revocable**. Se guarda como coordenada redondeada (~110 m), en tabla propia con acceso
  solo para él, sin histórico, y se borra al desvincularlo. Si no la define, la ruta termina en la
  última parada y **nada en la pantalla del coordinador delata quién no la definió**.
- Pedidos sin coordenada: **decidir explícitamente** dónde quedan. Hoy la asignación no filtra por eso
  y el motor recibiría paradas sin ubicación.

**Qué se demuestra.** El conductor abre la app y ve sus 25–30 paradas ordenadas, sin haber digitado
nada. Es la demo que reemplaza a Circuit.

**Encuadre para la demo:** no le ganamos en calidad de ruta, le ganamos en que **no hay nada que
digitar**. Si el courier compara kilómetros, perdemos; si compara los 40 minutos diarios de teclado
contra cero, ganamos por goleada.

**Quién.** `arquitecto` (el puerto) → `backend` (motor) → `frontend` (las dos superficies) ·
**Esfuerzo.** 5–7 días.

---

## Etapa 8 · El dinero del retiro

**Qué incluye.**

- **Se paga por visita a bodega.** La línea de liquidación **no cuelga de ningún pedido**: cuelga de
  la visita. Por construcción, traspasar un pedido no puede tocarla, y una cancelación tampoco — la
  visita ocurrió igual.
- Eso obliga a abrir el modelo: hoy `pedido_id` es **obligatorio y único** en las dos tablas de
  líneas. Va un discriminador de hecho (`entrega` / `retiro`), `pedido_id` opcional y clave única
  parcial, con verificación cruzada contra la visita.
- **Cinco detectores hay que enseñarles a ignorar las líneas de retiro**, o van a marcar como fuga de
  ingreso exactamente lo que acabamos de diseñar.
- **Nueva tarifa** por visita. ⚠️ **No reutilizar `minimo_retiro_clp`**: está del lado del cobro al
  seller —justo lo que decidiste que no se cobra— y el código lo usa como piso del cobro por entrega.
  Y ojo con el otro falso amigo del mismo nombre, que es retiro de **fondos**.
- **El PDF de liquidación separa entregas de retiros.** Es el documento con el que el conductor
  discute su plata; si dice "entregas" y cuenta retiros, se pierde la confianza de una.

**Qué se demuestra.** El conductor abre su liquidación y ve sus retiros pagados, aparte de sus
entregas.

**Quién.** `arquitecto` → `base-datos-rls` → `backend` → `qa` · **Esfuerzo.** 5–6 días.

**Qué puede salir mal.** Es el módulo del diferenciador. Cada cambio acá se prueba dos veces.

---

## Etapa 9 · Traspaso entre conductores

**Qué incluye.** Desde el mismo módulo del retiro, **"recibir de otro conductor"**: Pedro escanea los
18 bultos y el sistema traspasa la atribución. Calza con cómo se comporta Flex, donde re-escanear
mueve el paquete solo, sin bloquear.

- **Es acción de dinero**, no de operación: bitácora con autor **antes** de aplicarse.
- **Hoy el código no lo permite**: agregar pedidos a un manifiesto exige que esté en borrador, y a esa
  hora el de Pedro ya está confirmado. Necesita camino propio.
- **Quien retiró conserva el pago del retiro; quien entrega cobra la entrega.**
- **Secuencia:** si el receptor ya tiene ruta en curso, **se recalcula todo**; si no, continúa con la
  que se le traspasó.
- **Definición pendiente:** el conductor no puede ser el autor de una acción que mueve plata. O el
  escaneo genera una **solicitud** que el coordinador confirma, o se crea una capacidad acotada.
  Recomiendo lo primero.

**Quién.** `backend` + `frontend` (ambos repos) · **Esfuerzo.** 3–4 días.

---

## Etapa 10 · Cierre de jornada, cancelaciones y retención

**Qué incluye.**

- **Lista de cierre del día** para el coordinador: los no entregados, y su decisión — que es lo
  valioso. Sin eso, un pedido queda en `fallido` para siempre **con su línea de cobro viva**, y el
  watchdog de integridad **excluye los fallidos a propósito**, así que nadie lo levanta.
- **Cancelación después del retiro.** Ya se aplica sola y la parada desaparece de la ruta. Falta:
  aviso al coordinador con **qué conductor lo lleva encima**, y **rastro visible para el conductor** —
  si la parada se evapora, cree que la app perdió un pedido y llama. Una línea tachada: *"cancelado
  por el cliente, no lo entregues"*. El bulto físico queda marcado como *en poder del courier* y
  aparece en la misma lista de cierre.
- **Retención**: `no procesado` se **archiva a los 7 días** y se **despersonaliza a los 30** (nombre,
  dirección, teléfono, coordenadas y el string del QR). **La fila no se elimina** — cuatro claves
  foráneas lo impiden y hay respaldo contable que no se puede destruir.
- **El string del QR muere en estado terminal**, con gracia de 24–48 h, vía una columna de
  vencimiento escrita por quien marca el pedido terminal. Va como **paso propio** del job de purga que
  ya existe, **sin heredar** las retenciones por cobro impago — si las hereda, un período impago lo
  mantiene vivo meses.

**Quién.** `backend` + `frontend` + `seguridad-cumplimiento` · **Esfuerzo.** 4–5 días.

---

# Transversales

Cosas que no son una etapa pero hay que respetar en todas.

**Regeneración del QR.** El `hash_code` **no se puede calcular** — solo se obtiene leyendo el bulto, y
`shipment_labels` deja de servir apenas el envío sale de `ready_to_ship`. *(Corrige un levantamiento
anterior que decía que la continuidad no dependía del escaneo: sí depende.)* Va con cinco controles:
capacidad RBAC propia (dueño y coordinador, **no** conductor), motivo obligatorio de lista cerrada,
bitácora **antes** de mostrarlo, contador con alerta desde el segundo uso, y **sin descarga**.
Pendiente contractual: confirmar con ML si reproducir el código de etiqueta está permitido, antes de
exponerlo a un courier real.

**El POD de Flex no se toca.** El retiro es registro paralelo. Ningún paso reemplaza ni simula el
escaneo oficial.

**Nunca se dice "hacer el match".** Rutax **procesa lo que se retira contra lo que ya tiene
ingestado**. En código, interfaz y documentación.

**El tope de 1.000 filas** trunca **en silencio**. Hay helper en el repo; usarlo en todo lo nuevo.

**Pruebas por endpoint**, no solo de base: las rutas del conductor saltan las reglas de la base.

**Los ~400 escaneos diarios NO van a bitácora** — el escaneo ya es su propio registro. Sí van: cierre
de visita, traspaso, línea de retiro, marcar `no procesado`, asignación en bloque (**un asiento por
lote**), regeneración de QR, bodegas y punto de término.

**Deuda que conviene pagar en el camino:** la exportación de datos entrega truncado y lo registra como
completo; el cron de incidencias sin gestión no notifica más allá de la fila 1.000; falta el camino de
portabilidad del **conductor** (la ley da 15 días hábiles); y falta el mandato de tratamiento entre
Rutax y el courier. **La Ley 21.719 entra en vigencia el 1 de diciembre de 2026.**

---

# Definiciones — todas cerradas (2026-08-12)

**1 · El traspaso entre conductores es LIBRE.** No lo autoriza nadie. Ocurre en terreno, con apuro, y
no puede tener ni un segundo de fricción: es gestión interna del courier. Esto **no** contradice la
regla de auditoría, porque esa regla exige saber **quién**, no exige aprobación: como Pedro escanea
con su sesión, **Pedro es el autor** y queda registrado sin pedirle permiso a nadie.

**2 · Ningún pedido puede quedar sin coordenada.** Si ocurre, se resuelve **en la bodega del courier,
antes de asignar**: sale marcado en la pantalla de Preparación, el coordinador corrige la dirección en
el momento y sigue el curso. No se asigna un pedido sin ubicación y después se ve.

**3 · El canal de avisos de ML que reporta el primer escaneo: se prueba en la etapa 1.** Se marca el
canal, se deja el handler actual (que ya responde OK e ignora lo que no reconoce) y se registra un día
real. Si llega, es un respaldo gratis del retiro; si no llega, no se perdió nada. **El diseño no
depende de esto.**

**4 · La regeneración del QR se construye, sin consultar a ML.** La duda era contractual, no técnica:
ML cerró la reimpresión de etiquetas tras el retiro y eso pudo ser deliberado. Pero el uso es
**continuidad operativa sobre los propios paquetes del courier**, en casos muy raros, para poder
seguir trabajando cuando algo falló — no es un mecanismo para saltarse nada. Los cinco controles
(acceso limitado, motivo obligatorio, bitácora, contador con alerta, sin descarga) cumplen doble
función: evitan el mal uso **y** son la evidencia de que el uso fue legítimo. Pedir permiso formal
para algo que se usa tres veces al año invita a un "no" innecesario.

**5 · La auto-asignación SE ELIMINA.** No se conserva apagada. Es un botón que reparte por su cuenta
—mira afinidad de zona y ocupación, y distribuye sin preguntar—, y la metodología decidida es la
opuesta: **el coordinador elige**. Se apaga en la etapa 0 y se borra cuando la asignación en bloque
esté en uso, dejando un camino de vuelta mientras tanto.

El flujo confirmado por el usuario, textual, es el de las etapas 6 y 7:

> Ves el listado de 300 pedidos → seleccionas 30 → botón asignar → aparecen los conductores
> disponibles hoy → eliges a Juan → se le asignan y **el manifiesto se genera solo** → Juan abre su
> app, **confirma** que le llegaron 30 → ve su ruta armada → carga sus paquetes y sale.

"Los conductores disponibles hoy" es la **asistencia**: cada conductor se marca disponible desde su
app en la mañana. El campo ya existe en la base.

---

# Riesgos que hay que aceptar

**El más grande no es técnico: es la adopción.** El courier piloto no usa ninguna aplicación hoy. Todo
este plan depende de que diez conductores abran una app y escaneen. Si la pantalla de escaneo no es
obvia en treinta segundos, el resto no importa.

**El segundo es que las distancias son en línea recta.** Va a haber saltos raros. El reordenamiento
manual no es un lujo.

**El tercero es la ingesta.** Es la única pieza que depende de un tercero que puede cambiar sin avisar,
que no publica límites claros, y que castiga con desactivar tópicos si el endpoint tarda. Hay que
observarla, no darla por buena.

---

# Orden y dependencias

```
0 Apagar auto-asignación
      │
1 Ingesta diaria + campo situación_retiro  ← verificación en vivo con cuenta ML real
      │
2 Bodegas del seller (+ tope 3→10)
      │
3 Retiro: base de datos y API ──────┐
      │                             │
4 Retiro en la app  ← 3 arreglos previos de la app
      │
5 Preparación del día (en vivo)
      │
6 Asignación en bloque  ← deuda: la marca de asignación que no se apaga
      │
7 Ruteo
      │
8 Dinero del retiro
      │
9 Traspaso entre conductores
      │
10 Cierre de jornada, cancelaciones y retención
```

**Primer día útil para el courier:** al terminar la etapa 7 ya tiene el ciclo completo — retira
escaneando, el coordinador asigna desde Rutax, y el conductor sale con su ruta ordenada sin digitar
nada. Las etapas 8 a 10 cierran el dinero y los bordes.

**Esfuerzo total estimado:** 40–55 días de trabajo enfocado, sin contar terreno ni la observación de la
ingesta.
