# Retiro en bodega + ruteo del conductor

> Estado: **diseño cerrado, sin construir.** Alcance abierto por decisión del usuario el 2026-08-11
> tras una reunión con un courier real, y refinado el 2026-08-12.
> Este documento es la fuente de verdad del alcance. `CLAUDE.md` lleva el resumen.

## 1. Por qué entra al alcance

El ruteo estaba en "Más adelante" con la justificación de que está commoditizado. Esa frase era
correcta sobre el **ruteo genérico** — una app a la que hay que *escribirle* las direcciones. Lo que
se construye aquí es otra cosa: **ruteo que arranca con los pedidos ya adentro**.

El courier hoy retira ~60 paquetes y **digita a mano** cada dirección en Circuit (hoy Spoke: la
empresa se renombró en octubre de 2025 y `getcircuit.com` redirige a `spoke.com`). En Rutax esas
direcciones ya llegaron por la API de ML, geocodificadas. El valor no está en el algoritmo — ese sí
es commodity — sino en que **no hay nada que digitar**, y en que la ruta queda pegada al manifiesto,
a la asignación y al motor entrega→dinero.

**Encuadre para la demo:** no le ganamos a Spoke en calidad de ruta. Le ganamos en que no hay que
digitar. Si el courier lo evalúa comparando kilómetros, perdemos; si lo compara contra los 40 minutos
diarios de teclado, ganamos por goleada.

## 2. La operación real

Es un **cross-dock**. El conductor que retira **no** es el que entrega, y cuando se retira el
manifiesto todavía no existe.

| Hora | Paso | Quién | Dónde |
|---|---|---|---|
| Inicio | **Asistencia** — el conductor se marca disponible | Conductor | App |
| Mañana | **Retiro** — cada conductor visita las bodegas que le tocan y escanea cada bulto | Conductor | App, en bodega del seller |
| Mediodía | **Consolidación** — todos convergen y se descarga todo | Flota | Bodega del coordinador |
| Hasta 16:00 | **Asignación** — 25–30 paquetes por conductor | Coordinador | Web |
| **16:00 en punto** | **Carga y salida** — el conductor escanea sus asignados con la app de Flex | Conductor | Bodega del coordinador |
| 16:00–21/22:00 | **Reparto** — ruta ya secuenciada | Conductor | App |

**⏰ El reloj manda.** El despacho arranca a las 16:00 sin excepción y el corte es 21:00–22:00. Todo
lo anterior es *solo* retiro. Salen tarde a propósito: es same-day y cada hora que esperan captura
más pedidos del día. Consecuencia aritmética que gobierna el diseño: **~12 min por parada**, en hora
punta, saliendo toda la flota junta del mismo punto.

**El escaneo con la app de Flex ocurre al CARGAR, no en la bodega del seller.** Por lo tanto **no hay
doble escaneo en la bodega**: ahí solo escanea Rutax.

### 2.1 El escaneo define el día

Un seller puede despachar con **varios couriers**. Por lo tanto los pedidos que Rutax trae de su
cuenta de ML **no son todos del courier**: la ingesta da el universo de candidatos, y **el escaneo
selecciona cuáles son efectivamente suyos hoy**.

Consecuencias:

- La asignación opera sobre **retirados**, no sobre ingestados.
- **No existe la alerta "te faltaron 2".** Con multi-courier esos 2 probablemente son del otro
  courier. En pantalla se dice *"hasta 30 candidatos en esta bodega"*, nunca *"30 esperados"*.
- Lo que sí queda: conteo exacto, respaldo de códigos, acta y desglose por comuna.
- Si un seller confirma en su portal cuáles despacha con este courier, se recupera la conciliación
  real. Opcional por seller: el que lo hace gana la alerta, el que no se queda con el conteo.

### 2.2 Dónde se pierde tiempo hoy

1. **La asignación se concentra en la media hora previa a las 16:00.** Rutax conoce cada bulto en el
   instante en que se escanea, así que el coordinador puede repartir **por lotes durante toda la
   mañana**. El ahorro es salir a las 16:00 en punto en vez de a las 16:40 — con corte a las 22:00,
   esos 40 min son ~12% de la ventana de reparto.
2. **Nadie mide nada.** Cada escaneo lleva su hora, así que Rutax puede cronometrar el día completo
   sin trabajo extra: llegada a cada bodega, duración de cada visita, y cuánto pasa entre el último
   que llega y el primero que sale.
3. **La regla del punto de salida** (para educar al courier, no para construir): esperar captura más
   pedidos pero deja menos ventana. Salir 30 min más tarde cuesta ~2,5 paradas por conductor; con 10
   conductores son ~25 entregas de capacidad. Esperar media hora más solo conviene si trae más de 25
   pedidos nuevos. Hoy nadie sabe dónde está ese punto; con medición, en un mes se sabe.

**Descartado (el usuario lo corrigió):** "que el conductor no descargue lo que se queda con él".
Suena eficiente y no lo es: el coordinador clasifica por comuna en el piso, y sacar 18 bultos
específicos de una van cargada es más lento que bajar todo y ordenarlo. **Se descarga todo, siempre.**
Lo que sí aporta Rutax es adelantar el desglose: al cerrar cada visita ya sabe "de estos 130, 22 van
a Maipú y 18 a Puente Alto", y eso permite preparar el piso antes de que llegue el camión.

## 3. El QR de la etiqueta Flex

Payload real, obtenido escaneando una etiqueta con un lector genérico (2026-08-12):

```json
{"id":"44760788897","sender_id":2114191787,"hash_code":"fwH77GO2qbT3SrRS/UKb14MN2s5JA3AhWG4Pen/l6WY=","security_digit":"0"}
```

| Campo | Qué es | Uso |
|---|---|---|
| `id` | `shipment_id` | Match directo contra `operacion.pedidos.ml_shipment_id` |
| `sender_id` | `ml_user_id` del seller | Identifica **cuál** de las cuentas ML del seller |
| `hash_code` | 32 bytes en base64, firma de ML | **No es calculable.** Solo se obtiene leyendo el bulto |
| `security_digit` | acompaña la firma | — |

**Consecuencia dura: Rutax NO puede generar este QR desde datos que ya tiene.** El `hash_code` es una
firma con clave que no poseemos. Y `GET /shipment_labels` **exige `ready_to_ship`/`ready_to_print`**,
así que una vez retirado el bulto ML tampoco reimprime la etiqueta. **Si el string no se captura en el
escaneo, ese QR se pierde para siempre.**

- **Privacidad: sin datos personales.** Ni nombre ni dirección. Escanear le gana a fotografiar.
- **Pero es credencial-símil:** quien tenga el string puede reconstruir un QR escaneable. Va con RBAC,
  nunca en una URL, y con **permiso por columna** — en este proyecto ya mordió dos veces que un
  `GRANT` de tabla completa filtrara una columna nueva pese a la vista restringida.
- **Solo aplica a códigos que Rutax no generó.** En same-day la etiqueta la emite Rutax, así que
  siempre puede regenerarla y no hay nada que almacenar.
- **Ciclo de vida:** el string **muere en estado terminal** del pedido (entregado, y también
  devuelto / cancelado / no procesado — si no, los que nunca llegan a entregado viven para siempre).
  Se recomienda una gracia de 24–48 h tras el estado terminal: no cuesta nada en privacidad (no hay
  dato personal) y cubre una marca de entrega equivocada. La purga se cuelga del job de retención que
  ya existe, no se inventa uno nuevo.
- **Pendiente:** contrastar con un segundo ejemplo antes de cerrar el formato del parser (el texto
  capturado traía comillas tipográficas del copiar-pegar).

## 4. Asignación y ruteo

**La asignación NO es clustering automático.** El coordinador sigue decidiendo, pero desde Rutax:
filtra el panel (p. ej. Vitacura + Lo Barnechea + Las Condes → 40 pedidos), **selecciona 30 y los
asigna en bloque** a un conductor, los 10 restantes a otro. La UI de filtrado y selección masiva es
la feature; el algoritmo no. El manifiesto pasa a ser **subproducto** de la asignación, no paso previo.

**El ruteo es por conductor**, sobre sus 25–30 paradas, sin digitar nada:

- Motor: **TypeScript puro** — vecino cercano + 2-opt + Or-opt sobre haversine, con las `lat`/`long`
  que ya existen. **US$0/mes.** Envuelto tras un `PuertoMatriz` en `integraciones`, imitando
  `PuertoGeocoding`, para que cambiar a una matriz por calle sea una línea en una fábrica.
- **Inicio en la bodega del coordinador, fin en la casa del conductor, ambos ajustables.**
  ⚠️ Obliga a guardar el **domicilio del conductor** — dato personal (Ley 21.431). Se minimiza
  (solo coordenada de fin de ruta, sin histórico) y pasa por `seguridad-cumplimiento`.
- **Reordenamiento manual** obligatorio: las distancias son en línea recta y en Santiago el Mapocho,
  la Costanera y Vespucio producen saltos visiblemente absurdos. El reordenamiento es el salvavidas.
- Hoy `operacion/orden-paradas.ts` ordena **alfabéticamente** por comuna y dirección, se aplica en
  render en tres lugares y **no se persiste**. Hay que agregar columna de secuencia.

### 4.1 Por qué no se compra

| Opción | 1 courier/mes | 20 couriers/mes |
|---|---|---|
| **TypeScript + haversine** | **US$0** | **US$0** |
| Google Route Matrix | US$2.872 | US$13.532 |
| Mapbox Matrix | US$1.348 | US$30.759 |
| Routific | US$600–1.200 | US$12.000–25.000 |

Y las cláusulas: **OSRM demo, Valhalla de FOSSGIS y el plan gratis de GraphHopper prohíben el uso
comercial**. La de OSRM es la más traicionera: el software es BSD y libre para uso comercial, pero la
política del *servidor de demostración* dice lo contrario. Séptima, octava y novena vez que este
proyecto se topa con el patrón.

## 5. Traspaso entre conductores

En Flex, re-escanear un paquete ya escaneado por otro conductor **lo mueve solo**: se borra de la app
del primero y pasa al segundo. No bloquea ni pide permiso. El diseño de Rutax calza con eso:

Desde el mismo módulo del retiro, opción **"recibir de otro conductor"** → Pedro escanea los 18 →
el backend traspasa la atribución.

- **Es una acción de dinero**, no de operación: mueve a quién se le paga. Bitácora con
  `actorUsuarioId` **antes** de aplicarse.
- **Hoy el código no lo permite:** agregar pedidos a un manifiesto exige estado `borrador`, y a esa
  hora el de Pedro ya está confirmado o en ruta. Necesita camino propio.
- **Reparto del pago:** Juan conserva el pago del **retiro**; Pedro cobra la **entrega**.

## 6. El dinero

**Asimetría confirmada:** el courier **le paga el retiro al conductor**, pero **todavía no se lo cobra
al seller** (cobrarlo queda para más adelante).

Por lo tanto el motor entrega→dinero pasa de tener **un** hecho generador a tener **dos**:

| Hecho | Línea de cobro al seller | Línea de liquidación al conductor |
|---|---|---|
| Retiro | — (por ahora) | **Sí** |
| Entrega efectiva | Sí | Sí |

- **Solo la entrega efectiva genera cobro.** Los pedidos no retirados no cuentan: se marcan
  **`no procesado`**, se archivan a los N días y se eliminan a los N siguientes.
- ⚠️ **Verificar** si hoy el motor se dispara por estado del pedido o por entrega efectiva. Si es por
  estado, hay un cobro fantasma esperando a que existan candidatos que nadie retira.
- **Falso amigo:** `identidad.courier_config_payout.minimo_retiro_clp` se refiere al retiro de
  **fondos** del conductor, no a retirar paquetes. `identidad.tarifas.minimo_retiro_clp` sí es
  "mínimo a cobrar por retiro/visita" — el modelo de dinero ya anticipaba una visita cobrable.
- **Abierto:** ¿el retiro se le paga al conductor por bulto, por visita a bodega, o por día?

## 7. Módulo "Preparación del día"

Pantalla en vivo, en `(tenant)`, dentro de `operacion` — **no** en `contexto`: la Torre de control es
de solo lectura por regla dura y esta pantalla escribe. Son primas, no la misma cosa.

1. **Retiros en curso** — qué conductor, en qué bodega, cuántos lleva, hace cuánto no reporta. Es
   también lo que mira el jefe: reemplaza el WhatsApp sin pedirle a nadie que entre a buscar nada.
2. **Acumulado por comuna, creciendo solo** — el insumo para decidir cuántos conductores por zona
   antes de que llegue el primer camión.
3. **La asignación, ahí mismo.**

El patrón de tiempo real ya está resuelto y probado en el repo (señal → refresco, lectura
server-side, aislamiento por RLS verificado en vivo sin fugas).

## 8. Reglas de la app del conductor

- **El retiro vive en la app Expo, no en la PWA.** Safari en iOS trae el lector de códigos del
  navegador deshabilitado en todas las versiones: una PWA fallaría en silencio en cualquier iPhone.
  `expo-camera` ya está instalado y lee QR sin conexión (ML Kit en Android, AVFoundation en iOS).
- **El courier piloto no usa ninguna app hoy.** La adopción es obligatoria y sin legado que
  preservar, pero la pantalla debe ser **intuitiva, rápida y de uso diario sin capacitación**.
- **En la bodega nunca se bloquea al conductor.** El seller lo está apurando. Un bulto que no está en
  la lista se acepta igual y queda marcado; las excepciones se resuelven después, en la oficina.
- **El escaneo no puede ser opcional.** Un conteo declarado dice *cuántos* pero no *cuáles*, y sin
  saber cuáles no se puede asignar ni rutear. El escaneo puede **moverse** (escanear al llegar a la
  bodega del coordinador), no desaparecer. El respaldo ante falla es seleccionar de una lista, no
  teclear una cifra.
- **Gotcha de ráfaga:** `onBarcodeScanned` dispara varias veces por segundo mientras el código esté
  en cuadro. Sin un registro de códigos ya leídos + cooldown (~800 ms) + feedback distinto para
  duplicado, un paquete se cuenta cinco veces y el número que el jefe quiere sale mal.
- **Código desconocido:** va a pasar (pedidos que entraron a ML después de la última sincronización).
  Se resuelve contra ML en el momento (`GET /shipments/{id}`) o se encola si no hay señal. El retiro
  nunca se queda pegado por un desfase.
- **Todas las fuentes por el mismo flujo.** 40 Flex + 5 same-day + 2 Shopify + 4 Falabella en la misma
  bodega, todos escaneados igual. Pide un **resolvedor de códigos por formato**: hoy dos (el JSON de
  Flex y el `codigo_interno` crudo del QR same-day que Rutax ya genera), preparado para más.

## 9. Comprobante al seller

- **Canal: la campanita de avisos in-app**, no correo. Se deriva de las sesiones de retiro sin tabla
  nueva, siguiendo el patrón de `src/lib/avisos/obtener-avisos-seller.ts`.
- **El correo queda para después.** Hoy está apagado en producción por dos motivos independientes:
  `EMAIL_SANDBOX_MODE=true` (el runbook declara que se queda así para el piloto) y `RESEND_API_KEY`
  ausente en Vercel con el dominio `rutax.app` sin SPF/DKIM/DMARC. Un comprobante enviado hoy no
  llegaría a nadie. Desbloqueo: todo panel, cero código, más **redesplegar** (una variable nueva no
  entra en un despliegue ya hecho).
- **El puerto de correo no soporta adjuntos.** Mandar el acta en PDF exige extender puerto y
  adaptador; la alternativa sin tocar nada es enlace al portal.
- **No hay WhatsApp, SMS ni push. Cero.** Ni en la app Expo ni en la PWA. WhatsApp sería un proveedor
  nuevo y una decisión de arquitectura.
- **Lo que ML no puede dar, aunque mande su propio aviso:** no sabe qué empresa es el courier (el
  "transportista" en Flex es una identidad de app, no una razón social), razona por cuenta ML —un
  seller con 4 cuentas recibe hasta 4 avisos sueltos—, y sobre todo **al courier no le llega nada**,
  siendo el que paga Rutax.

## 10. Volumen y escala

Courier piloto: **~400 pedidos/día, ~10 sellers, ~10 conductores.** Debe existir plan de acción hacia
**1.000 pedidos/día de un solo cliente**, sin construir esa capacidad todavía, pero dejando paginación
y gestión preparadas desde ahora.

⚠️ **Tope técnico conocido:** las consultas cortan en **1.000 filas y truncan en silencio**. El
proyecto ya tiene helper para eso; usarlo en todo lo nuevo.

*A cuadrar: 400 pedidos entre 10 conductores da 40 cada uno, y el tope declarado es 25–30.*

## 11. Fuera de la v1, a propósito

- Ventanas horarias / hora comprometida de Flex.
- Optimización conjunta multi-conductor (repartir automáticamente entre N conductores).
- Orden de visita de las bodegas durante el retiro.
- Cobro del retiro al seller.
- Que el **seller** configure sus bodegas desde su portal (por ahora las carga el courier).
- Sugerencia de reparto pre-marcada que el coordinador solo ajusta.
- Retiro por afinidad de zona (que retire en la bodega quien reparte en esa zona).

## 12. Bloqueadores

### 🚨 Raíz: Rutax no ingesta los pedidos Flex del día

Verificado en código el 2026-08-12. Solo dos lugares insertan en `operacion.pedidos`:
`src/modules/operacion/pedidos.ts` (same-day) y
`src/modules/integraciones/ml/jobs/ejecutar-backfill.ts` (Flex). El backfill se dispara con **un
único evento**, `ml/conexion.reconectada`, publicado solo desde `puerto.ts:303` en el intercambio
OAuth, con ventana de 7 días.

- El webhook ignora en silencio el shipment que no está en BD (`procesar-shipment.ts:161-168`).
- El polling solo recorre pedidos ya existentes en `asignado`/`en_ruta`.
- Los tres crons de ML son refrescar tokens, sondeo de salud y polling. **Ninguno ingesta.**

**Un pedido Flex nuevo no entra al sistema.** Sin esto, el conductor escanea un QR y Rutax obtiene un
identificador que no significa nada: sin seller, sin comuna, sin dirección, sin nada que asignar.

Además: `estado_ml` guarda `order.status` y no el estado del envío (`ejecutar-backfill.ts:420`), así
que `ready_to_ship` no está en ninguna columna; y `destinatario_nombre` se llena con el **título del
producto** (`:422`).

### Otros

1. `identidad.sellers` **no tiene dirección ni bodegas**. Un seller puede tener varias.
2. El **tope de cuentas ML sube de 3 a 10** — trigger, validación TypeScript, tests y textos de UI.
3. `orden-paradas.ts` ordena alfabéticamente y no persiste.
4. Los pedidos anteriores al 2026-08-11 guardan el **centroide de su comuna** marcado como resuelto
   (el geocoding con Google se encendió ese día). Necesitan backfill antes de rutear sobre ellos, y
   hoy no hay botón de UI para reprocesarlos.

## 13bis. Revisión previa a construir (2026-08-12)

Cinco revisiones en paralelo contra el código real: flujo operativo, reglas y datos personales,
motor de dinero, integración ML, y escala. Resultado que cambia el encuadre: **no era una revisión
de lo que falta construir — hay cosas rotas hoy, en producción, al volumen actual del piloto.**

### Bloque 0 · Roto hoy, antes de tocar nada de este alcance

**0.1 🚨 El backfill de Flex ingesta CERO, siempre.** `ejecutar-backfill.ts:70` declara
`shipping?: { shipment_id?: … }` y `:352`/`:360-364` leen `order.shipping?.shipment_id`. **Ese campo
no existe**: es `order.shipping.id`. Lo dice la propia documentación del repo
(`docs/mercadolibre/04-ordenes-ventas.md:14,25`: *"El detalle de envío YA NO viene embebido: solo el
`id`"*). Consecuencia: `continue` en el 100% de las órdenes, `pedidos_recuperados: 0`, e intento
marcado `completado`. **Falla muda y "exitosa".** El test no lo atrapa porque **reimplementa** el
extractor en vez de importarlo (`ejecutar-backfill.test.ts:169-215` mockea `shipment_id`, o sea
valida el supuesto contra sí mismo). Sumado al §12 (el backfill es el único ingestor), la conclusión
es que **Rutax hoy no puede ingestar un pedido Flex por ninguna vía**.

**0.2 🚨 El refresco de tokens solo actúa cuando el token YA venció.** `refrescar-tokens.ts:61-64`
usa `.or("token_expira_en.lt.now() + interval '2 hours',…")`. **PostgREST descarta en silencio el
`+ interval '2 hours'` dentro de `or()`** (verificado empíricamente contra Postgres local: el mismo
filtro fuera de `or()` da error 22007; dentro, evalúa `< now()` a secas). Con TTL de 6 h y cron cada
30 min, hay hasta **30 minutos de ventana muerta** en que toda llamada da 401. En esa ventana corre
`sondeo-salud` (cada 15 min) que marca `sana → atencion` y, al segundo fallo, **`desvinculada` +
notificación al courier**. Y una conexión `desvinculada` queda excluida del polling y del webhook:
**un seller desvinculado a las 8:00 = cero pedidos suyos ese día.** Arreglo: calcular el instante en
TypeScript y pasar un ISO literal.

**0.3 `/shipments?ids=` no está documentado y el parser asume la forma equivocada.**
`ejecutar-backfill.ts:147-167` parsea la respuesta como arreglo plano; el multiget oficial de ML
responde en formato *verb* (`{code, body}`). El propio repo ya declaró ese parámetro como suposición
no verificada en `polling-estados.ts:14-29` y **corrigió el polling a `/shipments/{id}` individual,
pero dejó el backfill con el batch**. Contradicción viva dentro del mismo módulo.

**0.4 `asignaciones_pedido.activa` nunca se apaga al entregar.** Solo se cierra si una reasignación
la reemplaza (`manifiestos.ts:217`). Acumula una fila activa por pedido para siempre: a 400/día cruza
las 1.000 filas **al día 2,5**. De ahí cuelgan cuatro fallas ya activas:
- `auto-asignacion.ts:351-357` — la carga por conductor se trunca ⇒ **carga ≈ 0 para todos** ⇒ la
  auto-asignación vuelca todo sobre el primer conductor elegible. El comentario dice "pedidos del
  día" y la consulta no tiene filtro de fecha.
- `auto-asignacion.ts:573-579`→`:620-626` — la redistribución por caída de conductor mete ~1.000
  UUID en un `.in()` ⇒ **`URI too long` (414), falla entera**, en el peor momento posible.
- `metricas.ts:331-339` — **el SLA por seller que ve el courier hoy ya es un número equivocado.**
- `conductores/[id]/page.tsx:91,111` — montos de dinero del conductor subdeclarados + `URI too long`.

**0.5 La exportación de datos (RNF-13) entrega truncado y lo audita como completo.**
`exportar-datos/route.ts:268-274` sin `range` ni `limit`; `:341` escribe `filas.length` como conteo y
`:363` lo manda a bitácora. Portabilidad incompleta registrada como completa.

**0.6 `notificacion-incidencias-sin-gestion.ts:110-113`** es global, sin tenant y sin fecha: las
incidencias más allá de la fila 1.000 **nunca se notifican** y el job reporta su conteo como total.

**0.7 La cola sin conexión de la app pierde escaneos.** `offline-queue.ts:86↔125` — lo que se encola
*durante* la sincronización se pierde al guardar. Sin mutex, y con dos disparadores que se activan
juntos al volver de background. `useAuth.tsx:83` — **`signOut()` borra la cola**, y
`manifiesto/index.tsx:98` llama a `signOut()` ante un 401: si el token venció sin señal, el primer
request al recuperar señal **borra los 130 escaneos sin confirmación**. Y no hay `NetInfo`, así que
con la app en primer plano la cola no se vacía sola.

**0.8 El "en vivo" no refresca bajo flujo continuo.** `indicador-en-vivo.tsx:58-61` es un debounce
trailing puro **sin `maxWait`**: cada evento reprograma. Con diez conductores vaciando colas, la
pantalla **queda congelada minutos** justo cuando el coordinador la mira. Afecta a las seis pantallas
que ya usan el componente. Arreglo: ~6 líneas.

**0.9 Reportado, sin verificar:** la política `conductores_select` permitiría a cualquier usuario
`interno` leer la fila completa —incluido `numero_cuenta`— por la capa REST, porque
`public.conductores` es `select *` y el RBAC de la app no es barrera ahí.

### Bloque 1 · Condiciones de entrada (antes de la primera migración)

**1.1 La resolución del QR NO puede pasar por ampliar la política del conductor.** Hoy P3 de
`operacion.pedidos` deja al conductor ver **los asignados a él**; en el retiro no hay asignación, así
que devolvería cero. Ampliarla a "ve los de su tenant" expondría `destinatario_nombre`,
`_direccion` y `_telefono` de los ~400 pedidos del día a cada conductor — la peor regresión de
privacidad posible. **No se toca la política.** La resolución va por endpoint Bearer con
`service_role` que devuelve un **DTO mínimo**: pedido, seller, comuna y si es candidato. Precedente:
`operacion.pruebas_entrega_del_seller()`.

**1.2 El motor de dinero no tiene gancho para el retiro, y el modelo de líneas no lo acepta.**
`evaluarElegibilidad` (`motor.ts:380-433`) solo dispara sobre estados terminales del pedido, y
`retirado` no es una transición de la máquina. Además `pedido_id` es **`NOT NULL UNIQUE`** en
`lineas_cobro` y `lineas_liquidacion` (`dinero_base.sql:369,523`): una línea por visita es
inexpresable, y ni "por bulto" cabe (Juan retiró + Pedro entregó = dos filas con el mismo pedido).
**Diseño recomendado:** una sola tabla con `tipo_hecho ('entrega'|'retiro')`, `pedido_id` nullable,
unique **parcial**, y CHECK cruzado contra `sesion_retiro_id`. Así el camino que paga plata
(`calculo-payout`, `liquidacion-pdf`, `periodos`) no se toca; lo que se rompe son detectores de solo
lectura, que fallan ruidoso donde no duele. Hay que enseñar a filtrar `tipo_hecho <> 'retiro'` en
cinco sitios: `conciliar-tres-fuentes.ts:241-258` y `:405-419`, `conciliar-periodo.ts:182-194`,
`generar-lineas.ts:330-336` y `generar-liquidacion-conductor.ts:181`.

**1.3 ⚠️ La ingesta arreglada enciende una mecha: hay que cerrar la compuerta ANTES.**
Hoy no hay cobros fantasma **por accidente**: el pedido que nadie retira se queda en
`pendiente_asignacion` y la máquina rechaza el salto a `entregado`. Pero
`autoAsignarPendientesDelDia` (`auto-asignacion.ts:200,239`) barre **todos** los pedidos del día en
`pendiente_asignacion` sin saber de retiros: moverá los candidatos de la competencia a `asignado`, y
desde ahí `asignado → en_ruta → entregado` **es válido** y ML manda ambos eventos. Resultado:
**cobro completo al seller, con tarifa, período y DTE, por entregas que hizo otro courier.**
Invariante a escribir y defender: **un pedido Flex no puede salir de `pendiente_asignacion` sin un
escaneo de retiro que lo respalde.**

**1.4 El domicilio del conductor se modela como `punto_termino_ruta`, no como domicilio.** El
domicilio particular no es necesario para ejecutar el transporte (art. 152 quinquies D: los datos del
trabajador solo se usan "en el contexto de los servicios que presta"); si se guarda como domicilio,
la base de licitud pasa a consentimiento, y el consentimiento bajo subordinación laboral es frágil.
Va en **tabla propia** `operacion.punto_termino_conductor` con PK = `conductor_id` (una fila, sin
histórico, calcada de `ubicacion_conductor`), RLS de SELECT **solo el propio conductor**, coordenada
redondeada a **3 decimales (~110 m)**, consentimiento revocable reusando
`operacion.consentimientos_ubicacion`, y **borrado al desvincular**. Regla de producto: si el
conductor no lo define, la ruta termina en la última parada y **nada en la pantalla del coordinador
puede delatar quién no lo definió**. NO ponerlo como columna en `identidad.conductores`: esa política
deja a cualquier interno leer la fila completa.

**1.5 El `hash_code`: cifrado + GRANT por columna, y guardar solo lo necesario.** Guardar únicamente
`hash_code` y `security_digit` (el `id` y el `sender_id` ya están en `pedidos`). Cifrar con la
primitiva AES-256-GCM que ya existe, con AAD `tenant_id||pedido_id`, **pero NO en
`identidad.secretos_cifrados`** (esa tabla es para O(tenants) filas de material de larga vida, no
para 400/día). Receta de GRANT por columna, calcada de
`20260707000002_dinero_snapshot_regla_column_privileges.sql`: vista `public` con **lista explícita de
columnas** (nunca `select *`), `revoke select` de tabla, `grant select (…)` sin la columna del QR,
`service_role` intacto, `comment on column` + prueba pgTAP que espere error de permiso con JWT de
conductor y de seller. **En v1 ningún rol de cliente lee esa columna.** Y agregar `hash_code`,
`qr_payload` y `qr` a `CLAVES_PROHIBIDAS` (`identidad/auditoria.ts`) y al CHECK
`bitacora_auditoria_detalle_sin_secretos`.

**1.6 Los cinco controles de la regeneración de QR.** Capacidad RBAC nueva `puedeRegenerarCodigoBulto`
(dueño y coordinador; **no** conductor, **no** administración, y **no** reusar
`puedeAsignarYReasignarPedidos`); motivo obligatorio de lista cerrada; bitácora **antes** de renderizar,
con `actorUsuarioId` y sin el payload en el detalle; contador por bulto con alerta desde el segundo
uso; y **sin descarga** — se muestra en pantalla con `no-store`. Pendiente contractual: confirmar con
ML si reproducir el código de etiqueta está permitido, antes de exponerlo a un courier real.

**1.7 Las rutas Bearer del conductor bypasean RLS** (`autenticarBearer` + `crearClienteServiceRole`,
que tiene `BYPASSRLS`). Toda la superficie del retiro vive ahí y la suite pgTAP prueba la BD, no los
endpoints. Exigencias: RLS completa igual en las tablas nuevas, un test Vitest por endpoint que
verifique el rechazo cruzado entre tenants, un pgTAP por tabla nueva, y sumar la tabla del QR al Test 3
de `rls_cobertura_meta.test.sql`.

### Bloque 2 · Dentro del alcance

**2.1 Antes de escribir la ingesta, verificar en vivo con una cuenta real** (una sesión de curl):
`shipping.id` vs `shipping.shipment_id`; si `/shipments?ids=` existe y en qué formato responde; y si
`order.date_last_updated.from` filtra de verdad. **ML ignora en silencio los parámetros que no
conoce**, así que un filtro mal escrito parece funcionar y trae todo: la prueba de aceptación es
comparar `paging.total` con y sin el filtro.

**2.2 La ingesta correcta es webhook primero, barrido de respaldo después.** El tópico `shipments`
ya notifica la creación de envíos; basta cambiar el `return null` de `procesar-shipment.ts:161-168`
por "crear el pedido". `/orders/search` queda como barrido cada 10-15 min. Detalles: `estado_ml` debe
guardar el estado del **envío** (viene en la misma respuesta que el backfill ya pide — costo de cuota
**cero**), falta el header `x-format-new: true` en el backfill (ojo: con él `receiver_address` pasa a
`destination.shipping_address`, hay que tocar `coordenadasDeReceiver` o se pierden las coordenadas
gratis), y `destinatario_nombre` debe salir de `receiver_address.receiver_name` del shipment — el
título del producto es un **bug**, no minimización, y de hecho empeora la privacidad porque expone
qué compró el destinatario. El teléfono **no traerlo**: ML lo ofusca.

**2.3 `/orders/search?seller=` NO devuelve canceladas.** Un pedido cancelado tras ingestarse solo se
cierra por webhook, y el polling de respaldo **no lo cubre** porque filtra `asignado|en_ruta` mientras
el candidato del día está en `pendiente_asignacion`. Hay que ampliar el sondeo. Sin eso, el conductor
va a retirar un bulto que ya no existe.

**2.4 El endpoint de escaneos va en lote, con resultado por elemento y doble llave de idempotencia:**
`unique (tenant_id, escaneo_id)` para el reintento del lote, y `unique (sesion_retiro_id,
ml_shipment_id)` para el doble escaneo físico (el cooldown del cliente no basta: cada disparo genera
UUID nuevo). Tope 50 por request. Un código desconocido no puede tumbar los otros 49.

**2.5 El motor de ruta no necesita job. Medido:** 0,12 ms para 30 paradas con evaluación por delta
(1,84 ms con la versión ingenua; a 100 nodos son 1,1 ms vs **82 ms**). Va en la Server Action. Lo que
sí obliga a un job es el día que el `PuertoMatriz` deje de ser haversine local — por eso la interfaz
del puerto debe ser **asíncrona desde el día uno**.

**2.6 ~~El código de autorización de colecta~~ — SIN EFECTO (2026-08-12).** La operación real
desmintió esta inferencia: el courier escanea en su bodega y nadie le pide código. Ver Decisiones de
cierre. Se conserva el análisis por si la fricción aparece más adelante.
Verificado en fuente oficial: si el transportista escanea **en el domicilio** del vendedor y toca
"Empezar a repartir", no necesita código; **fuera del domicilio, sí**. En este cross-dock el escaneo
con la app de Flex ocurre a las 16:00 **en la bodega del coordinador** — o sea, siempre fuera. Son
**10 códigos distintos, todos los días**, que hoy viajan por WhatsApp a las 15:50. No hay API para
obtenerlo, pero sí se puede: campo por seller donde él lo pega desde su portal, campanita
recordándoselo en la mañana, visible para el conductor junto a los pedidos de ese seller, y marcado
como caduco al cambiar el día. Es una caja de texto y un aviso. **Es credencial operativa: RBAC,
fuera de URLs y de logs.**

**2.7 Lo que falta en la pantalla de asignación.** Hoy `asignar/page.tsx:84` hace `.limit(100)` sin
`count` ni aviso: con 400 pedidos el coordinador ve 100 y **nada se lo dice**. La selección no
sobrevive al cambio de filtro (`router.push` re-renderiza y el `Set` se vacía); "seleccionar todos"
toma lo cargado, no el filtro; los chips por estado se calculan sobre 25 filas; el filtro de comuna
es de una sola comuna (el caso "Vitacura + Lo Barnechea + Las Condes" no se puede expresar); y
`hrefPagina` (`operaciones/page.tsx:259-271`) **pierde `comuna` y `conductor` al paginar**. Además
`asignarPedidosAManifiesto` mete todos los ids en un `.in()` sin lotear (**revienta con ~400 ids**) y
recorre un bucle secuencial de hasta 3 viajes por pedido, sin transacción ni rollback.

**2.8 No guardar el PDF de la etiqueta.** Trae nombre y dirección del destinatario. El string del QR
no trae ningún dato personal y permite regenerar el código. Si alguna vez hace falta el PDF, se pide
a ML mientras el envío siga `ready_to_ship`, en lotes de 50. Sí conviene guardar el `status`/
`substatus` del momento del escaneo: si el bulto ya venía en `shipped`, alguien lo escaneó antes — es
excepción, no ruido.

**2.9 Los ~400 escaneos diarios NO van a bitácora.** El escaneo ya es su propio registro (conductor,
sesión, pedido, hora), con mejor estructura consultable que un `jsonb`. 400/día × 20 couriers ≈ **2,9
millones de asientos al año** que enterrarían los que sí importan. Sí van: cierre de visita, traspaso
entre conductores (con **ambos** conductores en el detalle), generación de la línea de retiro, marcar
`no procesado`, asignación en bloque (**un asiento por lote**), regeneración de QR, alta/edición de
bodegas y definición del punto de término. El código desconocido aceptado va a la **bandeja de
excepciones** que ya existe, no a bitácora.

**2.10 Tópicos de ML que hoy no se escuchan y deberían:** `orders_v2` (la venta existe antes que el
envío, y avisa de las cancelaciones que `/orders/search` oculta), `flex-handshakes` (retiro y
traspaso entre conductores — confirmado que notifica *"cuando se escanea por primera vez"*), y
`claims`. Y **`/missed_feeds`**, que devuelve las notificaciones que nunca recibieron 200: es la red
de seguridad más barata que existe y **no se usa en ninguna parte**. ⚠️ Riesgo asimétrico: si el
handler no responde 200 en **500 ms**, ML **desactiva los tópicos suscritos** — todos, no solo el
nuevo. Hoy el handler hace RPC de rate-limit + select + `inngest.send` antes de responder; medir el
p99 antes de agregar tópicos, y jamás poner la ingesta dentro del handler.

**2.11 Multi-cuenta 3→10: el tope es lo fácil.** El trigger está en
`20260630000002_identidad_conexiones_seller_ml_multicuenta.sql:87-89` (una línea), más
`panel-conexion-ml.tsx:28,223`, comentarios en `portal/actions.ts:61` y
`conectar-ml/compartido.ts:53`, y `multicuenta.test.ts`. Lo que **sí** se rompe es la "conexión
representativa": tres lugares caen a *cualquier* conexión del seller cuando falta `ml_user_id`
(`procesar-shipment.ts:236-241`, `polling-estados.ts:134-139`, `puerto.ts:661-663`). Con 3 cuentas
aciertas 1 de 3; con 10, 1 de 10 — y el token equivocado da 401/404. **Regla dura: todo pedido Flex
nace con `ml_user_id` estampado**, y donde no lo haya, fallar explícito en vez de adivinar.

**2.12 Ningún job Inngest declara `concurrency`, `throttle` ni `rateLimit`** (grep vacío en todo
`src/`), y `api/inngest/route.ts` no exporta `maxDuration`. A 1.000 pedidos ingestados en la mañana
se disparan 1.000 runs concurrentes de geocoding contra Google, compitiendo con los jobs de dinero.
Y es plata: **~US$150/mes por courier** a 1.000/día si el caché no pega — más que varias de las
alternativas de ruteo que se descartaron por caras. El único límite numérico oficial de ML que
aplica es **1.000 rpm en recursos Flex**; el problema no es el total diario sino la **ráfaga**, porque
los tres crons disparan todas las conexiones en el mismo segundo.

**2.13 El backfill de geocoding de los pedidos viejos no se dispara solo.**
`geocodificar-pedido.ts:178` es no-op si `geo_estado !== 'pendiente'`, y los pedidos anteriores al
11-ago tienen el centroide de comuna marcado como `resuelto`. Reenviar el evento no hace nada: hay que
**resetear `geo_estado` a `'pendiente'`** primero.

**2.14 Falta portabilidad del conductor.** El art. 152 quinquies D exige que el trabajador pueda
pedir **sus** datos en formato estructurado dentro de **15 días hábiles**; hoy el único camino de
exportación es el del courier. Y `TABLAS_A_EXPORTAR` tiene una nota de mantenimiento incumplida: le
faltan al menos `evidencias_entrega`, `cierres_conductor`, `consentimientos_ubicacion`,
`payouts_conductor`, `ajustes_liquidacion` y `lineas_liquidacion`. **La Ley 21.719 entra en vigencia
el 1 de diciembre de 2026.** También falta el mandato de tratamiento Rutax↔courier (Rutax es
encargado, el courier es responsable) y el registro de actividades de tratamiento.

**2.15 Un shipment puede cubrir varias órdenes** (packs/carrito). El upsert por
`(tenant_id, ml_shipment_id)` colapsa dos órdenes en un pedido — correcto para el retiro (1 QR = 1
bulto), pero `ml_order_id` guarda solo la última. Decidirlo a propósito, no por efecto secundario del
`onConflict`.

**2.16 Huecos de flujo sin dueño:** nadie decide qué bodegas le tocan a cada conductor (el paso 0 del
día no está modelado); nadie cierra el estado terminal del pedido no entregado y el watchdog de
integridad **excluye `fallido` a propósito**, así que nadie lo levanta; no hay traspaso de una **carga
completa** cuando el conductor de retiro no vuelve (el mecanismo existente opera sobre
`asignaciones_pedido`, que en el retiro todavía no existen); un pedido cancelado por ML mientras va en
el vehículo no genera **ninguna** alerta; y la foto de excepción no tiene destino definido.

**2.17 La aritmética de 1.000/día no cierra con 10 conductores:** serían 100 paradas cada uno, ~20 h
contra una ventana de 6. Un courier de ese volumen necesita ~33 conductores, y eso cambia la pantalla
de asignación más que cualquier algoritmo. Cerrar antes de dibujarla.

**2.18 Bug vivo de atribución de pago:** `generar-lineas.ts:668-690` — cuando la línea ya existe, se
devuelve **sin actualizar `driver_id`**, ni siquiera en la rama que la reactiva. Camino disponible
hoy: pedido `fallido` (línea a nombre de Juan) → `asignado` → reasignado a Pedro → Pedro entrega →
**cobra Juan**. Con el traspaso explícito pasa de rareza a rutina.

**2.19 Bug vivo que mata tres detectores:** `conciliar-tres-fuentes.ts:636` filtra
`.eq('activa', true)` sobre `identidad.tarifas`, que tiene `estado identidad.estado_tarifa`
(`20260101000004_tarifas_conexiones_bitacora.sql:26,65`) y **ninguna columna `activa`**. PostgREST
responde 42703 → `throw` → **cae el `step.run` completo: D5 y D6 tampoco corren** → tras 3 reintentos
falla C7. Se dispara con un solo período `cerrado`. Verificar en producción desde cuándo.

**2.20 "Eliminar a los N días" no es viable.** Cuatro FK `on delete restrict` (`lineas_cobro`,
`lineas_liquidacion`, `eventos_conciliacion`, `incidencias`) y la anulación es soft-delete: la fila
queda. Más la retención tributaria del respaldo de un DTE emitido. Lo correcto es **archivar y
despersonalizar**: purgar `destinatario_nombre`/`_direccion`/`_telefono`, `lat`/`long` y el QR;
conservar la fila, el `ml_shipment_id`, la comuna y el estado; marcar `archivado_en` y sacarlo de las
consultas calientes. La gracia de 24-48 h del QR necesita una columna `qr_vence_en` escrita por quien
marca el pedido terminal — inferirlo de `actualizado_en` es frágil. Y la purga va como **paso propio**
de `purgar-evidencias.ts`, **sin** heredar las retenciones por cobro impago: si las hereda, un período
impago mantiene vivo el `hash_code` meses.

### Decisiones del usuario sobre los huecos de flujo (2026-08-12)

**Terminología:** no se usa la expresión "hacer el match" en código, interfaz ni documentación. Lo que
ocurre es que **Rutax procesa lo que retira contra lo que ya tiene ingestado**. Decirlo así.

| # | Hueco | Decisión |
|---|---|---|
| 1 | Qué bodegas le tocan a cada conductor | **No se modela.** Juan va a las 3 bodegas que le tocaba, escanea, y en Rutax aparecen **3 retiros de Juan**. Sin hoja de ruta previa, sin planificación en el sistema. La sesión de retiro la abre el conductor al llegar. |
| 2 | Quién cierra el pedido no entregado | **El coordinador, al cierre del día.** Su criterio es lo valioso; el sistema le presenta la lista y él decide. |
| 3 | El conductor que retira y no vuelve | **No se modela.** Es gestión del coordinador con sus conductores; meterse ahí les quita dinámica. Rutax no pone flujo. |
| 4 | Doble escaneo del mismo bulto | **Da igual: se fusionan en uno.** Idempotencia por código, sin error ni fricción para el conductor. |
| 5 | Qué es "hoy" | **El día del retiro y del despacho** — los bultos escaneados ese día para salir ese día. Nada que ver con la fecha de compra. |
| 6 | Pedido cancelado por ML tras el retiro | Ver diseño abajo. |
| 7 | Seller sin cuenta ML conectada | **No puede operar: la conexión es obligatoria.** Pero **no es stopper**: si el conductor escanea bultos que Rutax no puede procesar contra su ingesta, **el listado de códigos escaneados queda igualmente guardado y respaldado**. Nunca se pierde un escaneo. |
| 8 | Secuencia al traspasar paradas | **Si el receptor ya tiene ruta en curso, se recalcula todo.** Si no la tiene, continúa con la que se le traspasó. |
| 9 | Foto de excepción de la etiqueta | **Se elimina del alcance.** No se construye. Si alguna vez vuelve, será decisión nueva. |
| 10 | La visita en cero | **No se considera.** Es problema del coordinador. |

#### Diseño del punto 6 — cancelación después del retiro

Reusa todo lo que ya existe; lo único nuevo es el aviso.

1. **La cancelación se aplica sola.** La máquina de estados ya permite `asignado → cancelado` y
   `en_ruta → cancelado` con ejecutor `sistema`, y el webhook la aplica. El pedido **desaparece de la
   ruta del conductor** automáticamente. Para que sea confiable hay que escuchar **`orders_v2`**
   además de `shipments`: `/orders/search?seller=` oculta las canceladas (§2.3 del bloque 2).
2. **Aviso al coordinador** por la campanita: qué pedido, qué seller, y **qué conductor lo lleva
   encima**.
3. **Rastro visible para el conductor**, y esto no es cosmético: si la parada simplemente se
   evapora, el conductor cree que la app perdió un pedido y llama por teléfono. Debe quedar una línea
   tachada al final de su lista — *"cancelado por el cliente, no lo entregues"*. Así se entera solo,
   sin que nadie tenga que explicárselo.
4. **El bulto físico sigue en la van.** Es lo único que el software no resuelve. Queda marcado como
   *en poder del courier* y aparece en la misma lista de cierre del día donde el coordinador resuelve
   los no entregados (decisión 2). Sin flujo nuevo.
5. **Dinero:** `cancelado` no genera cobro al seller — ya es así y no se toca. Y si el retiro se paga
   **por visita**, el pago del retiro **no se ve afectado**: la visita ocurrió. Es otra ventaja de esa
   unidad frente a pagar por bulto.

#### Decisiones de cierre (2026-08-12) — estas mandan

- **El retiro se le paga al conductor POR VISITA A BODEGA.** Confirmado. La línea de liquidación de
  retiro **no cuelga de ningún pedido**: cuelga de la visita. Por construcción, traspasar un pedido a
  otro conductor no puede tocarla, y una cancelación tampoco — la visita ocurrió igual. La regla
  "quien retiró conserva el pago del retiro" queda impuesta por el modelo, no por disciplina.
- **Punto de término de ruta:** confirmado. **El conductor pone la dirección donde quiere terminar**,
  desde su app. Es opcional y revocable; si no la define, la ruta termina en su última parada. Se
  guarda como coordenada redondeada (~110 m), en tabla propia con RLS de solo-el-propio-conductor, sin
  histórico y con borrado al desvincular. Nada en la pantalla del coordinador delata quién no la
  definió.
- **Retención del pedido `no procesado`:** se **archiva a los 7 días** (sale de las consultas
  calientes y del panel de asignación) y se **despersonaliza a los 30** (se purgan
  `destinatario_nombre`, `_direccion`, `_telefono`, `lat`/`long` y el string del QR; se conservan la
  fila, el `ml_shipment_id`, la comuna y el estado). Razonamiento: la operación es same-day, así que
  un candidato no retirado en 7 días no se retira nunca; y 30 días cubre cualquier disputa de
  facturación siendo mucho más estricto que los 90 días de la evidencia real, que sí tiene valor
  probatorio. **No se elimina la fila** — hay respaldo contable que no se puede destruir.
- ❌ **El código de autorización de colecta NO entra al alcance.** La documentación oficial dice que
  se exige al escanear fuera del domicilio del vendedor, pero **la operación real lo desmiente**: el
  courier se lleva los paquetes a su bodega y sus conductores escanean sin que nadie les pida código.
  La experiencia en terreno gana sobre la lectura de la documentación. Si algún día aparece la
  fricción, se retoma. Corrige el §2.6 del bloque 2, que queda sin efecto.
- **La aritmética conductores/paradas queda sin cerrar a propósito.** Los ~400 pedidos, ~10 sellers y
  ~10 conductores son un orden de magnitud del piloto, no un dimensionamiento. Se diseña con
  paginación y gestión preparadas, sin ajustar nada a esos números.

### Orden de trabajo que se desprende

1. **Verificación en vivo contra una cuenta ML real** (0.1, 0.3, 2.1). Sin esto todo lo demás cuenta aire.
2. **Arreglar el filtro de refresco de tokens** (0.2) — una línea, y hoy está desvinculando sellers.
3. **Arreglar los dos bugs vivos de dinero** (2.18, 2.19) y medir desde cuándo están.
4. **Cerrar `asignaciones_pedido.activa` + las cuatro consultas** (0.4), y la exportación (0.5).
5. **Arreglar la cola offline** (0.7) antes de apoyar el retiro encima.
6. **Cerrar la compuerta de auto-asignación** (1.3) — **antes** de arreglar la ingesta, no después.
7. **Recién ahí: la ingesta diaria** (2.2), con el estado del envío y el destinatario correctos.
8. Migraciones del alcance (1.2, 1.4, 1.5), asignación en bloque (2.7), retiro, ruteo.

## 13. Preguntas abiertas

1. ¿El retiro se le paga al conductor por bulto, por visita o por día?
2. ¿Hoy el motor de dinero se dispara por estado del pedido o por entrega efectiva?
3. ¿La bodega donde retiran es la dirección registrada del seller en ML? Si no lo es, ¿están pidiendo
   el **código de autorización diario** de Flex en cada visita? (En Flex, escanear en la dirección
   registrada y tocar "Empezar a repartir" evita el código; en otra dirección, se exige.)
4. ¿Vale la pena perseguir si Rutax puede suscribirse al tópico `flex-handshakes` con las cuentas ya
   conectadas —notifica el primer escaneo del paquete, justo el retiro— o exige registrarse como
   "Mensajería" ante ML con app integradora propia?
5. Cuadrar el volumen: 400 pedidos / 10 conductores vs. tope de 25–30 por conductor.
6. Confirmar el formato del QR con un segundo ejemplo.
