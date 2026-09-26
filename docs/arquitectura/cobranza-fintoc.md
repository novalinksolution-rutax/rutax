# Cobranza courier→seller y suscripción del SaaS con Fintoc — diseño (propuesta)

**Estado:** **IMPLEMENTADO (flujo 1, cobranza)** — 12-jun-2026. Contrato Fintoc
investigado y validado en vivo (§5b); diseño ratificado por `arquitecto`; migración
`20260601000008` + RLS + pgTAP, adaptador aislado `integraciones/pagos/fintoc`,
eventos + webhook por-tenant + job de matching + cron de morosidad + acciones de
resolución manual, y pantallas (onboarding "conectar banco", bandeja de revisión,
estado de cobro en `(tenant)` y `portal`). QA halló y corrigió 2 bugs de doble
imputación. Verde: typecheck, 607 Vitest, 168 pgTAP. **Pendiente:** conectar el flujo 2 (suscripción). El
adaptador Fintoc NO emite cobros reales sin cuenta productiva (KYC) — sigue en
modo prueba.

**Actualización 2026-09-26 — el pendiente del webhook `transfer.inbound.succeeded`
está CERRADO, y cerrarlo destapó un bug que habría anulado la conciliación
automática en producción.** La FIRMA estaba bien (ahora anclada al vector oficial
del SDK de Fintoc, no a nuestra propia aritmética); la FORMA del payload estaba mal
leída. Detalle en §5c.

**Por qué Fintoc (y no Khipu):** un solo proveedor cubre los DOS flujos del
frente (conciliación de cobranza + suscripción recurrente), con un solo KYC y un
solo adaptador-relación. Sandbox por producto y webhooks firmados. Comisión API
~1% + IVA. Ver decisión en el hilo de la sesión.

---

## 1. Los dos flujos (NO se mezclan — puertos y datos distintos)

| | Flujo 1 — Cobranza | Flujo 2 — Suscripción |
| --- | --- | --- |
| Dirección del dinero | seller → courier | courier → fundador (SaaS) |
| Qué hace Fintoc | LEE la cuenta del courier y detecta la transferencia entrante del seller | COBRA al courier por mandato recurrente (PAC/tarjeta) |
| Objeto Fintoc | `Link` (cuenta conectada) + `Movement` | `Subscription` (+ `subscription_intent`) |
| Quién conecta | cada courier conecta SU banco (Link por tenant) | cada courier autoriza un mandato hacia la org del fundador |
| Cuenta Fintoc | una sola org (la del fundador), key compartida | la misma org |
| Prioridad | **primero** (cierra el diferenciador) | después (incluso facturación manual al inicio) |

Regla de negocio (skill `pagos-chile`): el **same-day NO es un cobro aparte** —
se suma a las entregas del período y se factura junto con los Flex en el cierre.

---

## 2. Contrato Fintoc verificado (fuente: docs.fintoc.com, jun-2026)

**Autenticación:** secret key por organización (`sk_test_…` / `sk_live_…`) +
public key. Cada cuenta conectada se identifica con un **`link_token`** (secreto
POR-TENANT → se cifra y guarda como los tokens de ML). Test mode con
`sk_test_`/`pk_test_`, disponible en el dashboard, **sin KYC** (el KYC es para
producción). Idempotencia soportada.

**Conexión de cuenta (Link):** el courier conecta su banco vía el widget de
Fintoc (`link.created` NO se escucha por webhook — se captura en el widget vía
exchange token). Se persiste el `link_token` cifrado por tenant.

**Movimientos (conciliación) — `GET` List Movements de una cuenta.** Objeto
`Movement`: `id`, `amount` (positivo = entra dinero), `currency`, `description`,
`comment`, `type` (`"transfer"` para transferencia), `post_date`,
`transaction_date`, `status`, `pending`, `reference_id`, `recipient_account`, y
`sender_account` con `holder_id` (**RUT del remitente**), `holder_name`,
`institution`, `number`. → Una transferencia entrante del seller se reconoce por
`type="transfer"`, `amount>0`, y se atribuye por `sender_account.holder_id`
(RUT del seller).

**Webhooks (eventos clave):**
- `transfer.inbound.succeeded` — **llegó una transferencia a la cuenta del
  courier** → dispara el matching de cobranza. ES el evento central del flujo 1.
- `account.refresh_intent.succeeded` — la cuenta se refrescó con los últimos
  movimientos (respaldo/polling de movimientos).
- Suscripción: `subscription_intent.succeeded` / `…rejected`,
  `subscription.activated`, `subscription.canceled`, y para cargos
  `payment_intent.succeeded` / `…failed`.

Los webhooks de Fintoc **van firmados** → validar la firma (a diferencia de ML
marketplace, que no firma; ver commit `68107e9`). NO repetir el bug de exigir
firma donde no la hay, ni el inverso de no validarla donde sí la hay.

---

## 3. Diseño — Flujo 1 (cobranza), el que se construye primero

### 3.1 Adaptador aislado `integraciones/pagos/fintoc`
Nuevo puerto `PuertoConciliacionPagos` (un "puerto" por servicio, el núcleo no
llama a Fintoc directo):
- `listarMovimientos(linkToken, desde) → Movimiento[]` (normaliza el `Movement`
  de Fintoc al tipo del dominio; nunca expone el `link_token`).
- `validarFirmaWebhook(payload, firma) → bool`.
- El `link_token` llega descifrado por la fábrica (patrón idéntico al adaptador
  ML / DTE). Reglas de dependencia: el adaptador solo importa de sus `tipos` /
  `errores` / `resiliencia`; es hoja del grafo.

### 3.2 Esquema nuevo (módulo `dinero`) — la capa "pagado"
- **`dinero.pagos_recibidos`** (toda fila con `tenant_id`):
  `id, tenant_id, seller_id (nullable hasta atribuir), periodo_cobro_id
  (nullable hasta conciliar), movimiento_externo_id (id de Fintoc, UNIQUE por
  tenant → idempotencia), monto_clp, fecha, contraparte_rut, contraparte_nombre,
  estado_match (sin_atribuir | atribuido | conciliado | parcial | sobrante),
  creado_en`.
- **Ciclo del período:** añadir `pagado` (y quizá `pago_parcial`) al enum
  `estado_periodo`, o derivar el estado de pago desde `pagos_recibidos` sin tocar
  el enum (decisión de `arquitecto`). El período hoy va
  `abierto→cerrado→facturado`; la cobranza agrega `facturado→pagado`.
- **RLS:** aislamiento por courier (P1) + el seller ve SOLO sus propios pagos
  (alcance seller, como en `portal/cobros`). El conductor no ve nada de esto.

### 3.3 Eventos Inngest (definir en `src/lib/inngest/eventos.ts` antes de emitir)
- `dinero/pago.recibido` — lo publica el endpoint de webhook tras validar firma y
  registrar en bitácora (bitácora ANTES del efecto, patrón del proyecto).
- `dinero/pago.conciliado` — lo publica el job de matching al cerrar un período.

### 3.4 Job de matching (idempotente, con reintentos)
Trigger `dinero/pago.recibido`:
1. Idempotencia por `movimiento_externo_id` (UNIQUE) — un reintento no duplica.
2. Atribuir el pago a un seller por `contraparte_rut` (= RUT del seller del
   tenant).
3. Buscar período `facturado` impago de ese seller cuyo `monto_total` ≈ `monto`
   (tolerancia configurable) → marcar `conciliado` y el período `pagado`.
4. Sin match exacto → `estado_match` = `sin_atribuir`/`parcial`/`sobrante` para
   revisión humana (no adivinar; la conciliación es detective).
- **Morosidad:** cron que marca períodos `facturado` vencidos sin pago → alerta
  (reusa el patrón de `alerta-folios-proximos` / incidencias sin gestión).

### 3.5 Onboarding del courier
Nuevo paso "Conectar banco para cobranza": widget Fintoc → exchange token →
guardar `link_token` cifrado. Mismo patrón de secreto que certificado DTE / token
ML (metadatos al cliente, secreto jamás vuelve).

---

## 4. Diseño — Flujo 2 (suscripción), después
Puerto `PuertoSuscripcion` sobre el producto Recurring Payments de Fintoc:
`crearSubscriptionIntent → subscription.activated → cargos`. Modela el cobro del
SaaS al courier (módulo de facturación/billing del SaaS, separado del motor
entrega→dinero del courier). Modelo de precio: **cupo incluido + excedente** (las
transacciones de cobranza del flujo 1 tienen costo, no asumir cero). Se puede
diferir: al inicio el fundador puede facturar al courier piloto a mano.

---

## 5. Qué necesita proveer/decidir el dueño
1. **Cuenta de desarrollador Fintoc (gratis) + `sk_test_…`** para validar el
   contrato en vivo (movimientos simulados + webhooks de prueba), igual que se
   hizo con ML/Openfactura. Las test keys NO requieren KYC.
2. **Decisión comercial** de pasar a producción (KYC de empresa, cuenta bancaria)
   — escala a relación con un tercero, la toma el dueño, no un agente.

## 5b. Validación en vivo del contrato Fintoc (12-jun-2026)

Ejecutada con `scripts/validacion-pagos-fintoc.mjs` contra la API real de Fintoc
en **modo prueba** (`sk_test_…`), con un Link de sandbox conectado (credenciales
ficticias `41614850-3` / `jonsnow`). Resultados:

- **Auth.** `GET /v1/links` con la secret key DIRECTA en el header `Authorization`
  (sin `Bearer`) → 200. Confirmado.
- **Cuenta.** El Link expone `accounts[]` al recuperarlo por su `link_token`
  (`GET /v1/links/{link_token}`); el objeto `Account` trae `id` (`acc_…`),
  `type`, `number`, `holder_id`, `currency`, `balance`.
- **`Movement` (shape confirmado en vivo):** `id`, `description`, `amount`
  (entero CLP, **positivo = entra**), `currency`, `post_date`,
  `transaction_date`, `type` (`"transfer"` | `"other"` | …), `sender_account`,
  `recipient_account`, `comment`, `reference_id`, `transfer_id`,
  `document_number`, `pending`, `status` (`"confirmed"`).
- **`sender_account` (cuando viene):** `holder_id` = **RUT SIN puntos ni guion**
  (p. ej. `"745931278"` = 74.593.127-8), `holder_name`, `number`, `institution`.

### ⚠️ Hallazgo que condiciona el matching
De 300 movimientos: 157 `transfer` + 143 `other`, pero **solo 81 traen
`sender_account` poblado**. → **NO toda transferencia entrante expone el RUT del
remitente.** El matching de cobranza, por tanto:
1. **Normaliza el RUT** (`holder_id` viene sin DV-formato) antes de comparar con
   el RUT del seller.
2. **No puede depender solo del RUT.** Estrategia en cascada:
   `sender_account.holder_id` (si está) → si no, `amount` ≈ `monto_total` del
   período facturado impago → si hay ambigüedad o falta, **`sin_atribuir` para
   revisión humana** (la conciliación es detective, no adivina).
3. Sandbox **no** puebla `reference_id` / `comment` / `transaction_date` /
   `transfer_id`; en producción la glosa (`comment`) PUEDE traer datos útiles
   pero **no es confiable** como llave única → solo señal auxiliar.

### Pendiente de validar (no observable en sandbox) — CERRADO el 2026-09-26, ver §5c
- ~~Forma del webhook `transfer.inbound.succeeded` y su **firma**~~ → resuelto en §5c.

## 5c. Cierre del pendiente del webhook `transfer.inbound.succeeded` (26-sep-2026)

Se cerró SIN necesidad de que Fintoc disparara el evento, usando fuentes
autoritativas descargables. Dos mitades con resultados opuestos.

### La FIRMA estaba correcta — y ahora está ANCLADA, no supuesta
Nuestro esquema (header `Fintoc-Signature`, `t=<ts>,v1=<hex>`, HMAC-SHA256 sobre
`"<timestamp>.<raw_body>"`, tolerancia 300 s, comparación de tiempo constante) se
verificó contra el **SDK oficial `fintoc@1.27.0`** (`lib/webhook.js`, clase
`WebhookSignature`): coincide campo por campo. Solo existe `v1`; no hay v2 ni
multi-secreto.

⚠️ **El harness anterior no probaba nada.** `scripts/validacion-firma-webhook-fintoc.mjs`
firmaba con un HMAC escrito dentro del propio script y lo verificaba con una
reimplementación del algoritmo en el mismo script. Un error compartido por ambos
lados habría pasado en verde con la integración rota — el mismo patrón de los tests
de `conciliar-periodo` que reimplementaban la lógica y del pgTAP que reponía el
CHECK que debía detectar. **Tercera aparición del mismo defecto en el proyecto.**
Los tests de firma de `adaptador.test.ts` tenían la misma debilidad (firmaban con su
propio `firmar()`).

La prueba real ahora es `src/modules/integraciones/pagos/vector-oficial-fintoc.test.ts`:
usa el **vector publicado por el SDK** (payload, secreto `whsec_test_secret`,
`t=1743890251`, firma `11b98dd8f5500109246aa4d9875fad2e97d462560b012a5f50ff924411de0b0f`).
Esa firma la produjo el código de Fintoc, no el nuestro. El vector se pasa por las
DOS implementaciones que tiene el repo (el helper compartido
`firma-webhook-fintoc.ts` que usan payout/suscripción, y el método propio del
`FintocAdapter` que usa cobranza), así que también prueba que no divergieron.

### La FORMA estaba MAL — bug real, silencioso, en el diferenciador
**El `data` de `transfer.inbound.succeeded` NO es un `Movement`: es un objeto
`Transfer`, y los campos clave tienen otro nombre.**

| Dato | `Movement` (API de movimientos) | `Transfer` (webhook) |
| --- | --- | --- |
| Contraparte | `sender_account.holder_id` | **`counterparty.holder_id`** |
| Clase | `type: 'transfer' \| 'other'` | **`object: 'transfer'`** (no hay `type`) |
| Dirección | signo de `amount` | **`direction: 'inbound' \| 'outbound'`** |
| Formato del RUT | sin puntos ni guion (`745931278`) | **con guion** (`74.593.127-8`) |

`mapearMovimiento` solo leía los nombres del `Movement`. Consecuencia en
producción: **toda** transferencia real habría entrado con
`contraparteRutNormalizado: null` y `tipo: 'otro'` → el paso 2 del matching (atribuir
por RUT) nunca habría encontrado al seller → **el 100% de los pagos caía a
`sin_atribuir`**, dejando la conciliación automática —el diferenciador del
producto— convertida en triaje manual. Y sin fallar: el webhook responde 200, la
fila se escribe, ningún job se cae, ninguna alerta suena. Solo se habría notado
como "la conciliación automática no sirve".

Corregido en `fintoc/adaptador.ts`: la contraparte se lee de
`sender_account ?? counterparty`; la clase acepta `type === 'transfer'`,
`object === 'transfer'` o la presencia de `direction`; y `esEntrante` usa
`direction` como señal **autoritativa** cuando viene, cayendo al signo del monto
solo para los `Movement` (que no traen `direction`). **El monto se conserva tal cual
lo reporta el proveedor** — nunca se reescribe una cifra de dinero para que calce con
la dirección. `normalizarRut` ya toleraba ambos formatos de RUT: esa decisión
defensiva de junio es la que evitó un segundo bug aquí.

Regresión: 8 tests nuevos en `fintoc/adaptador.test.ts` (verificados fallando 3 con
el bug reintroducido a propósito, para no repetir el caso de las pruebas que pasan
en verde con el bug vivo) y 10 en
`src/app/api/webhooks/fintoc/[tenantId]/route.test.ts` — **la ruta de cobranza era el
único webhook de Fintoc sin pruebas de ruta**. Ese test, a diferencia del de payout,
NO mockea la firma: ejerce la cadena real (HMAC real → adaptador real → ruta real).

### El sandbox SÍ puede disparar el evento
La premisa de §5b ("el sandbox no lo dispara trivialmente") es falsa: Fintoc expone
un endpoint para **simular la recepción de una transferencia entrante**
(`docs.fintoc.com/reference/receive-an-inbound-transfer`, referenciado por el SDK de
Python). Es el camino para la validación en vivo antes de producción.

### Dos hallazgos NO corregidos (decisión pendiente del dueño)
1. **No hay respaldo si el webhook se pierde.** `listarMovimientos` —la única parte
   de este frente validada en vivo contra la API real en junio— **no tiene un solo
   llamador en el repositorio**. El webhook es la ÚNICA vía por la que un pago entra
   a `pagos_recibidos`. Si Fintoc no entrega un evento (caída del endpoint,
   despliegue, 5xx sostenido), ese pago **no se concilia nunca y nadie se entera**:
   el período queda impago, el cron de morosidad alerta al seller que sí pagó. El
   diseño original preveía `account.refresh_intent.succeeded` como respaldo de
   polling; nunca se cableó. Es el patrón de fallo silencioso que el proyecto ya
   corrigió dos veces (la ingesta de pedidos Flex que no existía, y el aviso de
   WhatsApp sin destinatarios que quedaba verde).
2. **La ruta exige `FINTOC_SECRET_KEY` para validar una firma que no la necesita.**
   `crearPuertoConciliacionPagos` llama a `leerSecretKeyOrg()`, que **lanza** si la
   variable falta, y en la ruta esa llamada está FUERA del `try`. Si la key no está
   cargada (o se rota mal), cada webhook responde 500 y Fintoc reintenta en bucle,
   en vez de degradar limpio. Validar la firma solo necesita el secreto por-tenant;
   el constructor del adaptador ya acepta `null` como secret key.

## 6. Próximos pasos (orden de construcción)
1. `arquitecto` ratifica el modelo de datos (¿`pagado` en el enum vs derivado?) y
   los contratos de los puertos.
2. `base-datos-rls`: migración de `dinero.pagos_recibidos` + RLS + pgTAP de
   aislamiento (tenant y seller).
3. `integraciones`: adaptador Fintoc (movimientos + firma de webhook) con su
   harness de validación en sandbox.
4. `backend`: endpoint de webhook + job de matching + morosidad + eventos.
5. `frontend`: paso de onboarding "conectar banco" + vista de estado de cobro en
   `(tenant)/dinero` y en `portal/cobros`.
6. `qa`: aislamiento + idempotencia del matching + reglas de dinero.
