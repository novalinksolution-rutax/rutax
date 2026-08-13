# Plan de acción — retiro en bodega + ruteo

> Documento de **ejecución**. El alcance y las decisiones de producto viven en
> `@docs/arquitectura/retiro-y-ruteo.md` — si algo se contradice, manda ese.
> Última revisión: **2026-08-13**.

> ## ✅ Estado al 2026-08-13 — la etapa 1 está HECHA y DESPLEGADA
>
> La sesión del 12→13 de agosto cerró **la etapa 0 y la etapa 1 completas**, más el tope de cuentas
> ML de la etapa 2. La ingesta Flex funciona en producción con datos reales por primera vez: **39
> pedidos ingestados de 110 órdenes**, todos con su fecha de compromiso.
>
> **Lo que queda pendiente de la etapa 1 son solo dos puntos**, ninguno bloqueante para seguir:
> el límite de concurrencia del job de **geocoding** (el de ML sí lo tiene) y el **backfill de
> geocoding de los pedidos viejos**. Detalle punto por punto en la etapa 1.
>
> **La siguiente etapa real es la 2** — las bodegas del seller —, cuya otra mitad (el tope 3→10)
> ya está hecha y desplegada.

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

## Punto de partida (2026-08-12) — histórico, ya superado

> Lo de abajo era el estado al escribir el plan. Al 2026-08-13 la suite va en **2.614 pruebas** y
> todo esto está desplegado, junto con la etapa 1 entera.

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

## Etapa 0 · Apagar la auto-asignación — ✅ HECHA (2026-08-12, desplegada)

> Commit `d0c08ab`. Ojo al detalle que apareció al hacerla: **había dos botones, no uno**. Sigue
> vigente la definición 5: se ELIMINA del todo cuando la asignación en bloque (etapa 6) esté en uso.

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

## Etapa 1 · Ingesta diaria + el campo propio de Rutax — ✅ HECHA salvo 2 puntos (2026-08-13, desplegada)

**La etapa que sostiene todo lo demás.** Sin ella, un escaneo devuelve un número suelto.

> **Verificado en producción con datos reales el 2026-08-13:** 39 pedidos ingestados de 110 órdenes
> en la ventana, `totalShipmentsIlegibles: 0` (ninguna consulta de envío falló), todos con
> `fecha_compromiso`. Antes de esto `operacion.pedidos` tenía **cero** pedidos Flex históricos.

**Qué incluye.**

1. ✅ **Verificación en vivo contra una cuenta ML real** — HECHA, y desmintió dos supuestos del plan.
   El campo del envío en la orden es `shipping.id` (se leía `shipping.shipment_id`, inexistente).
   **La consulta de varios envíos a la vez NO EXISTE**: `GET /shipments?ids=` devuelve 404 — el batch
   de 50 ids pertenece a `/shipment_labels`, otro recurso. Se resolvió con consultas individuales,
   concurrencia 6, por el cliente con reintentos. Lo que **no** se hizo es la prueba de aceptación del
   filtro incremental (comparar el total con y sin filtro): el cursor va con solapamiento de 1 h
   porque ML redondea los filtros de fecha a la hora, pero esa comparación sigue sin ejecutarse.
2. ✅ **El webhook pasa a crear pedidos.** HECHO. Y el razonamiento del comentario que había ahí
   estaba al revés: ML solo notifica cuentas que autorizaron la app, así que "no está en la base"
   significaba "nunca lo ingestamos", no "no es nuestro".
3. ✅ **Barrido de respaldo.** HECHO, `TZ=America/Santiago */30 6-22 * * *` (34 corridas, 06:00 a
   22:30). Cada 30 min y no 10–15: decisión del usuario, porque el webhook cubre lo inmediato. Dos
   fases: órdenes nuevas desde un cursor propio (`ingesta_ml_cursor_en`) y repaso por id de los no
   terminales de 7 días.
4. ❌ **Suscribir el tópico de órdenes — DESCARTADO** (decisión del usuario, 2026-08-13). El motivo
   del plan era detectar cancelaciones, y sigue siendo cierto que la búsqueda de ventas las oculta —
   por eso existe la fase B del barrido, que es la única vía posible. Lo que el tópico de órdenes
   agregaría es enterarse de una cancelación **anterior al envío**, y ese caso no aplica: Rutax
   ingesta por envío, así que un pedido sin envío nunca entró.
5. ✅ **`estado_ml` guarda el estado del envío.** HECHO, con `subestado_ml` de paso. Y la cabecera de
   formato nuevo también: la advertencia del plan era correcta y se cumplió al pie — con ella el
   bloque de dirección cambia de `receiver_address` a `destination.shipping_address` y `lead_time`
   reemplaza a `shipping_option`. Sin ajustar el lector, **todo** pedido habría entrado con
   "Dirección pendiente"/"Santiago" y sin coordenadas.
6. ✅ **`destinatario_nombre` sale del envío.** HECHO (`destination.receiver_name`). El teléfono no se
   trae, como estaba previsto.
7. ✅ **El campo `situacion_retiro`.** HECHO (migración `20260812000002`), con los tres valores y como
   campo propio separado del estado del pedido.
8. ⚠️ **`concurrency`/`throttle`: HECHO a medias.** Los jobs de ML sí lo declaran (`concurrency:
   {limit: 1}` en el cron, y por `conexionId` en la sincronización manual). **El job de geocoding
   sigue sin declararlo** — `geocoding/geocodificarPedido` solo tiene `idempotency`, así que el riesgo
   del plan sigue vivo: a 1.000 pedidos, 1.000 ejecuciones concurrentes contra Google.
9. ⏳ **Backfill de geocoding de los pedidos viejos: PENDIENTE.** Sin cambios respecto del plan, y
   ahora más urgente: los 38 pedidos Flex nuevos entraron con coordenada de ML (bien), pero los
   anteriores al 11-ago siguen con el centroide de su comuna marcado como resuelto. Sigue haciendo
   falta **resetear su estado a pendiente** antes de correr el job, o es no-op.

**Lo que el plan no anticipaba y hubo que arreglar igual** (todo desplegado):

- **El upsert reseteaba la operación del día.** Mandaba `estado: 'pendiente_asignacion'` en el payload
  y PostgREST escribe todas las columnas del payload también en el UPDATE: cada re-pasada devolvía a
  la bandeja cualquier pedido ya `asignado`/`en_ruta`. Inofensivo con un backfill que corre una vez;
  **catastrófico con un barrido cada 30 min**. Es la regla más reutilizable que dejó esta etapa.
- **La ingesta no traducía el estado.** Insertaba todo como `pendiente_asignacion` aunque ML dijera
  `delivered`, la máquina de estados no permitía el reflejo, y **el motor entrega→dinero nunca
  generaba la línea de cobro**: entregas reales sin facturar. Cerrado, con la regla de que un pedido
  entregado o fallido **sin conductor asignado en Rutax** refleja el estado pero no cobra solo.
- **`fecha_compromiso` no se escribía nunca en Flex**, y `/operaciones` filtra siempre por esa
  columna: un pedido podía estar en la base y no verse jamás en el panel.
- **Cancelaciones**: detectadas en el barrido y aplicadas por un único camino
  (`operacion/pedido.cancelado-en-ml`), con incidencia si el bulto ya iba en la van.
- **Botón "Sincronizar ahora"** en el portal del seller y en el panel del courier — no existía forma
  de pedir la ingesta desde el producto.

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
  ✅ **Confirmado en la corrida real**: 39 órdenes procesadas dejaron 38 filas. Es el carrito, y el
  colapso por `(tenant_id, ml_shipment_id)` es deliberado.
- **La "conexión representativa"**: tres lugares caen a *cualquier* cuenta del seller cuando falta el
  identificador de cuenta. Con 3 cuentas aciertas 1 de 3; con 10, 1 de 10, y el token equivocado da
  error. Regla dura: **todo pedido Flex nace con su cuenta estampada**, y donde no la haya, fallar
  explícito en vez de adivinar.
  ⏳ **SIGUE VIVO, y ahora pesa más porque el tope subió a 10.** Lo que sí quedó cerrado es el camino
  de ingesta: backfill, webhook y cron resuelven la conexión **concreta** (por el id del evento o por
  el `user_id` que notifica ML), nunca por "la más saludable". Los otros usos de
  `obtenerConexionPorSeller` (singular) no se auditaron — es trabajo de la etapa 2.

**⚠️ Riesgo NUEVO que dejó esta etapa, y que no estaba en el plan.** ML documenta que si el endpoint
del webhook falla repetidamente **desactiva el tópico entero, en silencio**, y lo perdido durante ese
tiempo no se recupera: hay que volver a suscribirse a mano. El barrido de respaldo lo mitiga, pero
nadie se entera de la desactivación salvo por la ausencia de notificaciones. **Falta una alerta de
"hace N horas que no llega ningún aviso de ML"** — hoy no existe.

---

## Etapa 2 · Las bodegas del seller — ⏳ PENDIENTE (su otra mitad, el tope 3→10, ya está hecha)

> **Es la siguiente etapa real.** El tope de cuentas ML subió a 10 el 2026-08-12 y está desplegado
> (migración `20260812000003`, función SQL `identidad.conexiones_seller_ml_tope_por_seller()`),
> así que de este bloque solo quedan las bodegas y la auditoría de los fallbacks de conexión.

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

**También aquí:** ~~subir el tope de cuentas ML de 3 a 10~~ — ✅ **HECHO y desplegado el 2026-08-12**
(trigger, textos y 21/21 pgTAP). Dato que ahorra búsquedas: **el tope nunca existió en TypeScript**,
vive solo en la función SQL y en textos de interfaz. Sigue pendiente **matar los fallbacks de conexión
representativa** del punto anterior — el camino de ingesta ya no los usa, pero el resto sí.

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
  ⚠️ **Desde el 2026-08-13 esto ya no es hipotético: la ingesta está viva y trayendo pedidos.** Un
  pedido que despacha otro courier ahora entra y, si ML lo reporta entregado, **aparece como
  "Entregado" en el panel** — no como pendiente. No genera cobro (la regla de "sin conductor asignado
  no se factura solo" lo cubre), pero sí ensucia el conteo del día. La reja de `situacion_retiro`
  sigue siendo la respuesta correcta; solo que ahora hay que construirla con datos reales encima.
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
- **Cancelación después del retiro.** ⚠️ **Parcialmente adelantado el 2026-08-13** al construir el
  barrido. Ya está: la **detección** desde ML (fase B del cron, única vía posible porque la búsqueda
  de ventas oculta las canceladas), un **único camino** que lleva el pedido a `cancelado`
  (`operacion/pedido.cancelado-en-ml`), la desactivación de la parada activa para que no quede viva en
  la app, la **incidencia automática si el bulto ya iba en la van**, y el dinero — se anulan las
  líneas si el período sigue abierto, y si ya está cerrado no se toca nada y va a la bandeja de
  excepciones. **Sigue faltando lo de la experiencia**: el aviso al coordinador diciendo *qué
  conductor lo lleva encima*, y el rastro visible para el conductor (la línea tachada *"cancelado por
  el cliente, no lo entregues"*, en vez de que la parada se evapore y crea que la app perdió un
  pedido). Y el bulto marcado como *en poder del courier* en la lista de cierre.
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

> **Actualización 2026-08-13: este riesgo se materializó antes de escribir una línea de cron, y peor
> de lo previsto.** La ingesta llevaba meses trayendo **cero** pedidos sin que nadie lo notara: eran
> cinco bugs encadenados, y cada uno tapaba al siguiente, así que arreglar el primero solo movía el
> punto de falla. La documentación de ML resultó ser parte del problema — se contradice consigo misma
> sobre dónde vive `logistic_type`, y un endpoint que el código usaba (`/shipments?ids=`) sencillamente
> no existe. **Lo que queda como método, no como anécdota:** cuando algo no llega y nadie se queja,
> asumir cadena de bugs y no bug único; y no dar por buena la ingesta por un "completado" en verde —
> mirar el conteo. Los tres números que aún nadie ha visto en un día real están instrumentados: el
> contador de 404 al consultar envíos, el peso real de la fase B, y si el envío trae el id de la orden
> con el formato nuevo.

---

# Orden y dependencias

```
0 Apagar auto-asignación                                    ✅ HECHA (12-ago, desplegada)
      │
1 Ingesta diaria + campo situación_retiro                   ✅ HECHA (13-ago, desplegada)
      │                                                        ⏳ quedan 2 puntos: concurrency de
      │                                                           geocoding + backfill de geocoding
2 Bodegas del seller (+ tope 3→10)                          ⏳ SIGUIENTE · el tope ya está hecho
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

> **Restante al 2026-08-13:** descontadas la etapa 0 y la etapa 1 (que el plan estimaba en 4–6 días y
> costó más, por los cinco bugs encadenados que nadie había visto), quedan **~34–48 días**. El camino
> al "primer día útil para el courier" sigue siendo el mismo: etapas 2 → 7.
