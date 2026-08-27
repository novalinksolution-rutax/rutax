# Mapa de ruta del conductor — contexto lógico

> **26-08-2026.** Acompaña a `PROMPT-RUTA-MAPA-v2.md` (el brief de diseño, en el
> repo `rutax-conductor`). Aquel manda sobre **cómo se ve**; éste sobre **qué
> significa en el sistema**: qué ya existe, qué hay que construir, y qué choca
> con una regla del proyecto.
>
> Todo lo de acá está **verificado contra el código**, no contra documentos.

---

## 1 · Qué pasa al cerrar la app (requisito: no se pierde nada)

Hoy conviven **dos mecanismos distintos**, y por eso las dos versiones del brief
se contradijeron: cada una describió uno y lo generalizó al otro.

| Qué | Cómo viaja hoy | ¿Sobrevive cerrar la app? |
|---|---|---|
| **Evidencia de entrega** (foto, nota) | Cola en AsyncStorage — `offline-queue.ts` y sus dos hermanas | ✅ **Sí.** Disco, no memoria. |
| **Cierre de la parada** (`entregarPedido` / `noEntregarPedido`) | Llamada directa a la red | ❌ **No.** Si no hay señal, no ocurrió. |
| **Reordenamiento local** (arrastres sin guardar) | Estado de React | ❌ **No.** Se pierde al desmontar. |

Detalle de la cola que sí existe, porque define el molde a seguir:

- Clave `rutax:evidencias_pendientes_v1`. **5 reintentos automáticos**
  (`MAX_INTENTOS`), y después la evidencia pasa a «requiere atención»: sigue
  guardada, visible, esperando que el conductor decida. **Nunca se borra sin que
  él lo pida** — una evidencia no se puede volver a capturar tal como estaba.
- Se re-sincroniza al volver la app al primer plano, al recuperar señal, al
  montar la pantalla del manifiesto y al tirar para refrescar.
- Solo se vacía con un **«Descartar y salir»** explícito al cerrar sesión.

### ⚠️ Hay un mensaje falso en producción

`src/components/guardado-sin-confirmar.tsx:108` muestra:

> «Si cierras la app ahora, esto se pierde.»

**Es falso para la evidencia** —está en disco y se reenvía sola— y es falso en la
dirección cara: el conductor se queda parado esperando la palomita verde en vez
de seguir a la parada siguiente, que es exactamente lo contrario de lo que ese
mismo componente dice querer lograr.

### Qué hay que construir para cumplir «no se pierde nada»

1. **Extender la cola persistente al cierre de parada.** Mismo molde que la de
   evidencias: encolar, reintentar, y si se agotan los intentos, «requiere
   atención». Es el trabajo grueso de este punto.
2. **Persistir el orden local pendiente** (los arrastres que aún no llegaron al
   servidor), para que reabrir la app no devuelva al conductor a la secuencia
   vieja.
3. **Cambiar el texto.** Lo verdadero es: *la entrega está guardada en el
   teléfono y se está enviando sola; lo que necesita señal es confirmarla.*

**Idempotencia obligatoria.** Si el cierre se encola y se reintenta, hay que
llevar clave de idempotencia por parada: la cola reintenta y no puede producir
dos cierres. Es el mismo criterio que ya se aplicó en WhatsApp (reservar la fila
antes de llamar) y en el escaneo de retiro.

---

## 2 · «Añadir parada» — no agrega nada: es reordenar

> ⚠️ **Corrección del 26-08, decisión del usuario.** Una versión anterior de este
> documento —y el diseño que se estaba dibujando— entendieron que el conductor
> tomaba un pedido **ajeno o sin asignar** desde el mapa. **No es eso.**

**Siempre se trabaja con los pedidos que ya están en el manifiesto. Nunca entra
uno extra.**

El gesto real: el conductor ve en el mapa una parada **que ya es suya**, cercana a
donde está o hacia donde va, la toca, y con **Añadir parada** la manda al frente
de la cola — pasa a ser la siguiente, y el resto de la ruta se reordena alrededor
de ese cambio.

O sea: **«Añadir parada» es otro gesto para la misma operación del §4.** No es una
funcionalidad aparte. Comparte endpoint, comparte reglas y comparte el deshacer.

### Lo que esto elimina

Con la aclaración se caen los dos problemas graves que tenía la lectura anterior:

- **No hay exposición de datos nueva.** Todas las paradas del mapa ya son suyas;
  `ver_ruta_propia` alcanza. No se toca la regla «el conductor solo ve los suyos»
  y no hace falta revisión de `seguridad-cumplimiento`.
- **No se crea ninguna línea de cobro.** La asignación **ya existe** —es lo que
  puso el pedido en su manifiesto—, así que el motor de dinero no se entera de
  nada. No hay acción financiera, no hay capacidad nueva, no hay bitácora nueva.

### Lo único que queda: el nombre engaña

**«Añadir parada» viene de Circuit, donde el conductor sí agrega direcciones
sueltas que no estaban.** Acá no se agrega nada: se adelanta algo que ya estaba.
Un conductor que lea «Añadir» va a buscar cómo meter un pedido nuevo y no lo va a
encontrar.

Es trabajo de `copywriter`, pero conviene resolverlo antes de dibujar el botón:
lo que describe el gesto es **«Ir a esta ahora»** o **«Poner como siguiente»**.

### Un caso borde que sí hay que decidir

Si la parada elegida está **ya cerrada** (entregada, fallida), el gesto no aplica:
no se reordena algo que ya ocurrió. Mismo criterio que el resto del
reordenamiento.

---

## 3 · «Traspasar ruta a otro conductor» — va en dirección contraria a lo construido

| | Lo que existe hoy | Lo que propone el acceso rápido |
|---|---|---|
| Quién actúa | **El que recibe.** Pedro escanea los bultos que Juan le pasa | **El que entrega.** Juan aprieta un botón |
| De dónde sale el receptor | **Del token.** Nunca del cuerpo | Del cuerpo (a quién elijo) |
| Qué impide | Que un conductor le mueva trabajo y plata a otro | — |

El endpoint actual está construido a propósito para que un conductor **solo pueda
traerse cosas**, nunca empujárselas a otro. Un botón de «traspasar» invierte esa
propiedad.

**Recomendación, y no cuesta backend nuevo:** el botón **no traspasa** — inicia el
traspaso. Muestra lo que el otro conductor escanea (código o QR), y la
transferencia sigue ocurriendo por el gesto del receptor. Eso conserva las «dos
voluntades» que el propio brief pide en su §7.8, mantiene intacta la propiedad de
seguridad, y el trabajo se reduce a una pantalla.

Si en cambio se quiere el empuje de verdad, hay que construir un modelo de
solicitud–aceptación con estado propio. Es bastante más, y no lo haría en esta
versión.

---

## 4 · Reordenar por gesto, sin confirmación

Quitar el paso de confirmar tiene una consecuencia que hay que resolver en la
lógica:

- Hoy el guardado manda **la lista completa, nunca un delta**, y el servidor
  **rechaza el lote entero con `P0001`** si la asignación cambió mientras se
  ordenaba. Ese rechazo existe porque reintentar con la misma lista falla igual:
  hay que **recargar**, no reintentar.
- En la calle ese choque va a ocurrir de verdad: el coordinador puede estar
  reasignando desde la web mientras el conductor arrastra un pin.
- Sin pantalla de confirmación **no hay dónde contar eso**. Hace falta: orden
  local optimista, envío con debounce (no una escritura por frame de arrastre), y
  una reconciliación silenciosa cuando el servidor gana — con aviso, porque la
  secuencia le cambió bajo los dedos.

El endpoint tampoco existe todavía: **hoy reordenar solo se puede desde la web
del coordinador.** Hay que abrir la ruta Bearer equivalente.

**Ese mismo endpoint sirve los tres gestos**, y conviene construirlo sabiéndolo:
arrastrar en la lista, arrastrar un pin sobre la línea, y «Añadir parada» (§2),
que no es más que insertar una parada existente en la primera posición. Los tres
mandan la lista completa y ninguno necesita una ruta propia.

**Y una decisión de producto que queda cerrada por este cambio:** el conductor
puede pisar la secuencia que fijó el coordinador. Antes estaba abierta.

---

## 5 · Lo que no tiene implicancia de backend

- **La línea de tiempo del pie** (número + calle, próxima destacada, tramo
  recorrido). Usa datos que el manifiesto ya entrega.
- **Encuadrar el circuito.** Puro cliente.
- **Quitar el modal de re-optimizar.** Menos superficie, no más.

---

## 6 · Campos que el brief da por existentes y no existen

| Campo | Estado real |
|---|---|
| `codigoEnvio` | **La regla existe** (`ml_shipment_id` en Flex, `codigo_interno` en same-day, nunca `tracking_token`), pero **el endpoint del conductor no lo envía**. Agregarlo es trabajo chico. |
| `bultos` | **No existe.** `operacion.pedidos` no tiene esa columna; lo único que hay es `operacion.bultos_retiro`, que son bultos escaneados en la bodega por la mañana. Un diseño que ponga «3 bultos» en la ficha no se puede llenar hoy. |
| `confirmado` | Depende de resolver el §1. |

---

## 7 · Orden sugerido de construcción

1. **Persistencia al cerrar la app** (§1). Es requisito explícito y lo demás se
   apoya en ella.
2. **`codigoEnvio` en el endpoint del manifiesto** (§6). Chico, desbloquea el pin.
3. **Endpoint de reordenamiento del conductor** (§4). **Trae «Añadir parada»
   incluido** (§2): son el mismo endpoint con distinto gesto, así que no es una
   etapa aparte.
4. **Traspaso: pantalla de inicio sobre el flujo existente** (§3).

Ya no hay ninguna etapa que dependa de una revisión de privacidad o de una
decisión de dinero: la aclaración del §2 las eliminó a las dos.
