# Rutax · Sistema de mensajes

**Versión 1.0 · 22 de agosto de 2026**
Todo el contenido escrito del producto, con su clave. Documento de trabajo: se busca, no se lee de corrido.

**Clave:** `módulo.acción.tipo` · tipos: `conf` · `exito` · `error` · `vacio` · `aviso` · `ayuda` · `push` · `mail`

**Tratamiento:** TÚ en todo el producto y en los correos. USTED solo en la factura electrónica, la liquidación del conductor, los términos y la política de privacidad. Si lo firma la empresa ante un tercero, es usted; si es una conversación con el usuario, es tú. **No se mezclan en una misma pieza.**

---

## Índice

1. Voz y reglas de redacción
2. Confirmaciones de acción irreversible (33)
3. Mensajes de éxito (142 · 100 escritos)
4. Errores · las seis familias (53)
5. Estados vacíos en tres tonos (44 · 40 escritos)
6. Advertencias que no son errores (12)
7. Ayuda contextual (8)
8. Notificaciones push del conductor (3 + 2 permisos)
9. Los correos (plantilla + 16)
10. Las siete reglas de contenido

---

# 1 · Voz y reglas de redacción

## 1.1 La voz

**Un compañero de trabajo competente que no te hace perder tiempo.** Dice qué pasó, qué significa y qué hacer. No celebra, no se disculpa de más, no explica su propia arquitectura.

Cuatro rasgos: **directo** (sujeto, verbo, objeto) · **específico** (números y nombres antes que adjetivos) · **honesto** (dice lo que no sabe y lo que no puede) · **respetuoso del oficio** (usa las palabras del dominio, no las traduce a jerga de software).

## 1.2 El tono por contexto

| Contexto | Tono |
|---|---|
| Operación normal | Neutro y breve. Una línea. |
| Confirmación irreversible | Grave y descriptivo. Nunca «¿estás seguro?»: describe la consecuencia. |
| Error nuestro | Se asume sin dramatizar: «fue un problema nuestro, no tuyo». |
| Error del usuario | **Nunca lo culpa.** Dice qué falta, no qué hizo mal. |
| Buena noticia | Afirmativa y con cifra. No festeja. |
| App del conductor | Más corto todavía, con el número primero. Se lee de reojo. |
| Portal del seller | Cero jerga. Explica lo que un no logístico no sabe. |
| Comprador final | Una frase, sin detalle interno. |
| Documentos tributarios y legales | USTED, formal, con plazos. |

## 1.3 Reglas duras

- **Títulos y botones en mayúscula solo inicial.** «Emitir la factura», no «Emitir La Factura» ni «EMITIR».
- **Las acciones se nombran con verbo y objeto:** «Anular el cobro», no «Anular». El botón que confirma dice lo que hace, y **con monto cuando hay dinero**.
- **El botón que cancela dice «Volver»**, nunca «Cancelar»: en este dominio cancelar es cancelar un pedido. Cuando existe una salida mejor, esa es el rótulo: «Revisar los 3 problemas», «Seguir escaneando», «Asignar solo los 22 libres».
- **Cifras:** miles con punto, sin decimales, `$ 812.600`. Negativos con signo menos real `−8.000`. Cifras comparables en Azeret Mono.
- **Fechas:** `21-08` en tabla · `21-08-2026` en documento · «21 de agosto» en prosa y correos. Horas en 24 h.
- **Jerga que se conserva** porque el usuario la usa: folio, manifiesto, bulto, seller, comuna, boleta de honorarios, SII.
- **Jerga que se traduce** porque solo la usa el sistema: *token* → credencial · *webhook* → aviso automático · *geocodificar* → ubicar la dirección · *sync* → sincronizar · *timeout* → no respondió. *Payload*, *endpoint* y *retry* no aparecen nunca.
- **Nunca:** decir solo «error» · culpar a quien lo usa · mostrar códigos, nombres de tabla o mensajes crudos de un proveedor · signos de exclamación en la interfaz.

---

# 2 · Confirmaciones de acción irreversible

**33 acciones.** Ninguna pregunta «¿estás seguro?»: todas describen la consecuencia.

**Patrón:** título = «Vas a *verbo* + objeto nombrado» · cuerpo = qué cambia, a quién afecta, **qué NO hace**, y si hay vuelta · acto explícito = escribir el nombre de la contraparte, el monto sin puntos, o una palabra clave de dos palabras máximo · botón que confirma = verbo + objeto + monto cuando hay plata · botón que cancela = «Volver», o la salida mejor si existe.

**Peldaño 2** pide motivo escrito. **Peldaño 3** pide además un acto explícito, y no se cierra con escape ni con clic fuera.

### `periodos.emitir.conf` · Emitir la factura de un período · **P3 · escribir**
> **Vas a emitir la factura de Vega Norte SpA**
> Se emite ante el Servicio de Impuestos Internos por $ 966.994 IVA incluido, consume el folio 1041 y no se puede deshacer: solo se corrige con una nota de crédito. El período 07-2026 queda cerrado con sus 271 líneas.
> *Escribe* **VEGA NORTE SPA** *para confirmar.*
> **Emitir la factura por $ 966.994** · Volver

### `periodos.emitirLote.conf` · Emitir facturas en lote · **P3 · escribir**
> **Vas a emitir 6 facturas por $ 4.128.400**
> Se emiten las seis al Servicio de Impuestos Internos y consumen los folios 1041 al 1046. Quedan 2 folios después de esto. Ninguna se puede deshacer.
> *Escribe* **EMITIR 6**.
> **Emitir las 6 facturas** · Volver

### `periodos.cerrar.conf` · Cerrar un período · **P2**
> **Vas a cerrar el período 08-2026 de Vega Norte**
> Después de cerrarlo, las entregas nuevas de este seller van al período siguiente. Todavía no se factura nada: eso es un paso aparte. Se puede reabrir mientras no esté facturado.
> **Cerrar el período** · Volver

### `liquidaciones.pagar.conf` · Emitir el pago de una liquidación · **P3 · escribir**
> **Vas a transferirle $ 323.400 a Carlos Vera**
> Sale de tu cuenta al Banco de Chile ···4821 y no se puede revertir desde acá: si te equivocas, hay que pedírselo de vuelta. Incluye una penalización de $ 8.000 y un bono de $ 12.000.
> *Escribe* **323400**.
> **Transferir $ 323.400** · Volver

### `liquidaciones.pagarLote.conf` · Pagos en lote · **P3 · escribir**
> **Vas a hacer 2 transferencias por $ 735.700**
> Salen de tu cuenta a las cuentas de R. Muñoz y C. Vera. Una de las dos incluye ajustes. Ninguna se puede revertir desde acá.
> *Escribe* **PAGAR 2**.
> **Transferir $ 735.700** · Volver

### `cobro.anular.conf` · Anular el cobro de un pedido · **P2 · motivo**
> **Vas a anular el cobro de $ 2.900 a Vega Norte**
> La línea sale del período 08-2026 y el seller deja de verla. Queda registrada como anulada con tu nombre y tu motivo, no se borra. Si el período ya estuviera facturado, esto no se puede hacer.
> *Motivo obligatorio, mínimo 10 caracteres.*
> **Anular el cobro** · Volver

### `liq.anularLinea.conf` · Anular una línea de liquidación · **P2 · motivo**
> **Vas a quitarle $ 1.450 a la liquidación de C. Vera**
> El conductor va a ver la línea anulada con tu motivo en su liquidación y en su PDF. Si ya le pagaste este período, esto no lo devuelve: hay que ajustarlo en el próximo.
> *Motivo obligatorio. Lo lee el conductor.*
> **Anular la línea** · Volver

### `liq.anularVisita.conf` · Anular el pago de una visita a bodega · **P2 · motivo**
> **Vas a anular el pago de $ 4.500 por la visita a Vega Norte Maipú**
> El acta de retiro del 21-08 sigue existiendo; lo que se anula es el pago. C. Vera va a ver el motivo en su liquidación.
> **Anular el pago de la visita** · Volver

### `pedidos.cancelar.conf` · Cancelar un pedido · **P2 · motivo**
> **Vas a cancelar el pedido RX-7K2M-9PQR**
> Sale de la ruta de R. Muñoz, no se le va a cobrar a Vega Norte y el seguimiento del comprador va a decir que se canceló. Si el bulto está en tu bodega, queda ahí: esto no organiza la devolución.
> **Cancelar el pedido** · Volver

### `pedidos.cancelarLote.conf` · Cancelar pedidos en lote · **P2 · motivo**
> **Vas a cancelar 14 pedidos de 3 sellers**
> Salen de las rutas de 2 conductores y no se les va a cobrar. Los 3 sellers lo van a ver en su portal. **4 de los 14 ya salieron a ruta:** esos avísalos por teléfono, porque el conductor ya los tiene en la camioneta.
> *Motivo obligatorio, se aplica a los 14.*
> **Cancelar los 14 pedidos** · Volver

### `asignacion.reasignar.conf` · Reasignar pedidos de otro conductor · **P2**
> **8 de los 30 pedidos ya son de otro conductor**
> 6 son de R. Muñoz y 2 de J. Tapia. Si sigues, pasan a C. Vera y salen de sus rutas. Si ya tienen los bultos en la mano, hay que traspasarlos físicamente.
> **Reasignar los 8 a C. Vera** · *Asignar solo los 22 libres*

### `retiro.cerrarIncompleto.conf` · Cerrar un retiro con bultos sin escanear · **P2 · app**
> **Vas a cerrar con 4 bultos sin escanear**
> Esto casi nunca pasa: normalmente te llevas todo. Los 4 quedan como no retirados y tu coordinador los va a ver. Si están en la bodega, escanéalos antes de cerrar.
> **Cerrar con 38 de 42** · *Seguir escaneando*

### `integraciones.revocarClave.conf` · Revocar una clave de API · **P3 · escribir**
> **Vas a revocar «Integración con mi ERP»**
> Todo lo que use esta clave deja de funcionar al instante y no se puede reactivar: hay que crear otra y cambiarla donde esté puesta. Si no sabes qué la usa, revisa antes.
> *Escribe* **Integración con mi ERP**.
> **Revocar la clave** · Volver

### `cobranza.desconectarBanco.conf` · Desconectar el banco · **P3 · escribir**
> **Vas a desconectar el Banco de Chile**
> Dejas de recibir los movimientos, la conciliación queda a mano y no vas a poder pagar liquidaciones desde acá. Los 38 movimientos ya conciliados no se pierden. Para volver a conectarlo hay que autorizar de nuevo en el banco.
> *Escribe* **DESCONECTAR**.
> **Desconectar el banco** · Volver

### `cobranza.descartarMov.conf` · Descartar un movimiento bancario · **P2 · motivo**
> **Vas a descartar $ 45.000 del 19-08**
> Sale de los movimientos por atribuir y deja de aparecer. No se borra: queda descartado con tu motivo, y se puede recuperar desde el cajón «Descartados».
> **Descartar el movimiento** · Volver

### `bodegas.desactivarPrincipal.conf` · Desactivar la bodega principal · **P2**
> **Bodega Quilicura es tu bodega principal**
> Es el origen de todas tus rutas, así que necesitas elegir cuál pasa a ser la principal antes de desactivarla. Las actas de retiro que respaldan pagos se quedan como están.
> *Selector obligatorio: nueva bodega principal.*
> **Cambiar la principal y desactivar** · Volver

### `tarifas.desactivar.conf` · Desactivar una tarifa · **P2**
> **Vas a desactivar la tarifa de Casa Bonita · Flex · Sur**
> Las entregas nuevas de ese seller en esa zona van a usar tu tarifa por defecto, que es $ 2.900. Las entregas ya cobradas no cambian. Puedes reactivarla cuando quieras.
> **Desactivar la tarifa** · Volver

### `cortes.desactivar.conf` · Desactivar una ventana de corte · **P2**
> **Vas a desactivar la ventana de corte de Vega Norte**
> Los pedidos de ese seller dejan de tener hora de corte y su semáforo de cumplimiento deja de calcularse, porque no hay plazo contra el que medirlo. Puedes reactivarla cuando quieras.
> **Desactivar la ventana** · Volver

### `zonas.desactivar.conf` · Desactivar una zona · **P2**
> **Vas a desactivar la zona Norte**
> Sus 9 comunas quedan sin zona y las tarifas que dependen de ella dejan de aplicarse: esas entregas van a usar tu tarifa por defecto. Puedes reactivarla cuando quieras.
> **Desactivar la zona** · Volver

### `equipo.suspender.conf` · Suspender a alguien de tu equipo · **P2 · motivo**
> **Vas a suspender a R. Fuentes Miranda**
> Deja de poder entrar hoy mismo, incluso si tiene la sesión abierta. Todo lo que hizo sigue registrado a su nombre. Puedes reactivarla cuando quieras.
> **Suspender a R. Fuentes** · Volver

### `conductores.suspender.conf` · Suspender a un conductor · **P2 · motivo**
> **Vas a suspender a C. Vera Espinoza**
> No va a poder entrar a la app ni recibir asignaciones. **Hoy tiene 17 paradas abiertas:** reasígnalas antes o van a quedar sin conductor. Su liquidación de agosto se sigue calculando y se le paga igual.
> **Suspender al conductor** · Volver

### `portal.desconectarCuenta.conf` · Desconectar una cuenta de venta · seller · **P2**
> **Vas a desconectar «Vega Norte Oficial»**
> Andes Express deja de recibir los pedidos nuevos de esa cuenta. Los que ya están en camino se entregan igual. Puedes volver a conectarla cuando quieras.
> **Desconectar la cuenta** · Volver

### `app.borrarTermino.conf` · Borrar mi punto de término · conductor · **P2**
> **Vas a borrar tu punto de término**
> Se borra la dirección y tu autorización. Tus rutas se van a armar sin considerar dónde terminas. Puedes darla de nuevo cuando quieras.
> **Borrar mi punto de término** · Volver

### `liq.eliminarAjuste.conf` · Eliminar un ajuste ya aplicado · **P2 · motivo**
> **Vas a eliminar la penalización de $ 8.000 a C. Vera**
> Su neto sube de $ 323.400 a $ 331.400. Si él ya vio la liquidación, va a ver que el descuento desapareció y por qué.
> *Motivo obligatorio. Lo lee el conductor.*
> **Eliminar el ajuste** · Volver

### `liq.marcarPagadaManual.conf` · Marcar una liquidación como pagada a mano · **P2 · motivo**
> **Vas a marcar como pagada la liquidación de C. Vera**
> Esto **no transfiere plata**: solo registra que le pagaste por fuera. Si no le pagaste, va a quedar como pagada sin estarlo.
> *Motivo obligatorio: cómo y cuándo le pagaste.*
> **Marcar como pagada** · Volver

### `config.desactivarCobroAuto.conf` · Desactivar el cobro automático · **P2**
> **Vas a desactivar el cobro automático**
> Vas a tener que pagar tu plan a mano cada mes. Si se te pasa, Rutax se suspende y tus conductores y sellers dejan de poder entrar.
> **Desactivar el cobro automático** · Volver

### `excepciones.reabrir.conf` · Reabrir una excepción cerrada · **P2 · motivo**
> **Vas a reabrir una excepción cerrada el 14-08**
> Si bloqueaba facturación, vuelve a bloquearla: el período 08-2026 de Vega Norte no se va a poder facturar hasta resolverla de nuevo.
> **Reabrir la excepción** · Volver

### `excepciones.omitirVerif.conf` · Emitir omitiendo la verificación previa · **P3 · escribir**
> **La verificación encontró 3 problemas y vas a emitir igual**
> 2 pedidos sin prueba de entrega y 1 diferencia de $ 4.200 sin resolver. Si emites, la factura sale con esos datos y corregirla después necesita una nota de crédito. **Queda registrado que omitiste la verificación**, con tu nombre.
> *Escribe* **EMITIR IGUAL**.
> **Emitir igual por $ 966.994** · *Revisar los 3 problemas*

### `bs.suspenderCourier.conf` · Suspender un courier · backstage · **P3 · motivo**
> **Vas a suspender a Vía Central Ltda.**
> Sus 3 sellers y 2 conductores dejan de poder entrar hoy mismo. Los pedidos en ruta siguen su curso y sus períodos no se tocan. No borra datos, no cancela pedidos, no anula documentos ya emitidos y no libera folios consumidos. La suspensión se levanta desde acá.
> *Motivo obligatorio, queda en la bitácora a tu nombre.*
> **Suspender el courier** · Volver

### `bs.habilitarEmision.conf` · Habilitar la emisión real · backstage · **P3 · escribir + 2FA**
> **Vas a habilitar la emisión real de Rápido Sur Ltda.**
> Desde este momento sus facturas llegan al Servicio de Impuestos Internos con validez tributaria y consumen folios reales. No se puede volver a pruebas: los documentos emitidos quedan emitidos.
> *Escribe el RUT* **77.019.334-K** *y confirma con tu segundo factor.*
> **Habilitar la emisión real** · Volver

### `bs.condonar.conf` · Condonar un mes de suscripción · **P3 · motivo**
> **Vas a condonar $ 149.000 a Express Norte SpA**
> El período 07-2026 queda como pagado sin que entre plata, y su deuda baja a $ 0. Queda en la bitácora a tu nombre con el monto y el motivo.
> **Condonar $ 149.000** · Volver

### `bs.revocarEquipo.conf` · Revocar a alguien del equipo de Rutax · **P3 · escribir**
> **Vas a revocar el acceso de F. Aguirre**
> Podía entrar a las cuentas de 27 couriers. Sus sesiones abiertas se cierran al instante, incluida una sesión de soporte en curso en Rápido Sur. Su bitácora se conserva completa.
> *Escribe* **F. Aguirre**.
> **Revocar el acceso** · Volver

### `bs.cerrarSesionAjena.conf` · Cerrar la sesión de soporte de otra persona · **P2 · motivo**
> **Vas a cerrar la sesión de M. Toro en Andes Express**
> Lleva 12 minutos dentro y 3 acciones. Va a salir de la cuenta sin aviso previo. Lo que ya hizo queda registrado.
> **Cerrar la sesión** · Volver

---

# 3 · Mensajes de éxito

**142 claves · 100 escritas una por una.** Regla: **verbo en pasado + objeto nombrado + consecuencia cuando existe**. No dicen «exitosamente». Los que pueden deshacerse ofrecen deshacer en el mismo aviso. Una línea de 40 a 70 caracteres; **los de dinero hasta 90 y siempre con monto y contraparte** — «Listo» delante de una transferencia no le sirve a nadie.

## 3.1 Pedidos y asignación · 24 de 24

| Clave | Texto |
|---|---|
| `pedidos.crear.exito` | Pedido creado para M. Fuentes Aravena · **RX-7K2M-9PQR** |
| `pedidos.editar.exito` | Pedido actualizado |
| `pedidos.cancelar.exito` | Pedido RX-7K2M-9PQR cancelado |
| `pedidos.cancelarLote.exito` | 14 pedidos cancelados de 3 sellers |
| `pedidos.direccionCorregida.exito` | Dirección corregida y ubicada en Ñuñoa |
| `pedidos.direccionLote.exito` | 5 direcciones ubicadas · 1 sigue por revisar |
| `pedidos.etiqueta.exito` | Etiqueta lista · se está descargando |
| `pedidos.etiquetaLote.exito` | 42 etiquetas listas en un solo archivo |
| `pedidos.enlaceCopiado.exito` | Enlace de seguimiento copiado |
| `asignacion.asignar.exito` | **30 pedidos asignados a C. Vera** · 24 paradas en su ruta |
| `asignacion.parcial.exito` | 28 asignados a C. Vera · 2 no se pudieron |
| `asignacion.reasignar.exito` | 8 pedidos pasaron de R. Muñoz y J. Tapia a C. Vera |
| `asignacion.desasignar.exito` | 6 pedidos volvieron a sin asignar |
| `manifiesto.crear.exito` | Manifiesto creado para C. Vera · jueves 21 |
| `manifiesto.publicar.exito` | **Ruta enviada a C. Vera** · ya la puede ver en su app |
| `manifiesto.secuenciar.exito` | Ruta ordenada · 24 paradas, termina cerca de su punto de término |
| `manifiesto.imprimir.exito` | Manifiesto listo para imprimir · 3 páginas |
| `manifiesto.cerrar.exito` | Día cerrado · 22 entregadas, 2 no entregadas |
| `retiro.crear.exito` | Retiro creado en Vega Norte Maipú · 42 bultos pendientes |
| `retiro.asignar.exito` | Retiro asignado a C. Vera · ya le llegó el aviso |
| `retiro.cerrar.exito` | **Retiro cerrado · 42 de 42** |
| `retiro.cerrarParcial.exito` | Retiro cerrado con 38 de 42 · 4 quedaron sin retirar |
| `traspaso.enviar.exito` | Le pediste a J. Tapia que reciba 6 bultos · falta que acepte |
| `traspaso.aceptar.exito` | **Recibiste 6 bultos de R. Muñoz** · ya están en tu ruta |

## 3.2 Dinero · 38 de 38 · llevan monto y contraparte, sin excepción

| Clave | Texto |
|---|---|
| `periodos.cerrar.exito` | Período 08-2026 de Vega Norte cerrado · **$ 864.100 en 285 líneas** |
| `periodos.cerrarLote.exito` | **6 períodos cerrados por $ 4.128.400** · listos para facturar |
| `periodos.reabrir.exito` | Período 08-2026 reabierto · las entregas nuevas vuelven a entrar acá |
| `periodos.emitir.exito` | **Factura 1041 emitida a Vega Norte SpA por $ 966.994** · aceptada por el SII |
| `periodos.emitir.exitoObs` | **Factura 1041 emitida por $ 966.994 · el SII la aceptó con observaciones** · es válida, revisa el detalle |
| `periodos.emitir.enCurso` | Estamos emitiendo la factura de Vega Norte · te avisamos cuando el SII responda |
| `periodos.emitirLote.exito` | **6 facturas emitidas por $ 4.128.400** · folios 1041 al 1046 · quedan 2 folios |
| `periodos.emitirLote.parcial` | **5 de 6 facturas emitidas por $ 3.161.406** · 1 quedó pendiente, revisa cuál |
| `cobro.crear.exito` | Línea de cobro creada · **$ 2.900 a Vega Norte** en el período 08-2026 |
| `cobro.recargo.exito` | **Recargo de $ 1.200 agregado a Vega Norte** · reprogramación de RX-3H8P-5MKL |
| `cobro.anular.exito` | **Cobro de $ 2.900 anulado a Vega Norte** · el período bajó a $ 861.200 |
| `cobro.anularLote.exito` | **7 cobros anulados por $ 20.300** a Vega Norte · el período bajó a $ 843.800 |
| `liq.generar.exito` | **9 liquidaciones generadas por $ 2.847.300** · agosto 2026 |
| `liq.generarUna.exito` | Liquidación de C. Vera generada · **$ 323.400 en 200 servicios** |
| `liq.recalcular.exito` | Liquidación recalculada · **de $ 311.400 a $ 323.400** por 4 entregas nuevas |
| `liq.ajusteBono.exito` | **Bono de $ 12.000 agregado a C. Vera** · su neto quedó en $ 323.400 |
| `liq.ajustePenal.exito` | **Penalización de $ 8.000 aplicada a C. Vera** · va a ver tu motivo en su liquidación |
| `liq.anularLinea.exito` | **Línea de $ 1.450 anulada a C. Vera** · su neto quedó en $ 321.950 |
| `liq.anularVisita.exito` | **Pago de visita anulado · $ 4.500 a C. Vera** · el acta del 21-08 sigue existiendo |
| `liq.eliminarAjuste.exito` | **Penalización de $ 8.000 eliminada** · el neto de C. Vera subió a $ 331.400 |
| `liq.pagar.exito` | **Transferiste $ 323.400 a Carlos Vera** · Banco de Chile ···4821 |
| `liq.pagarLote.exito` | **2 transferencias enviadas por $ 735.700** · R. Muñoz y C. Vera |
| `liq.pagarLote.parcial` | **1 de 2 transferencias salió · $ 412.300 a R. Muñoz** · la de C. Vera la rechazó el banco |
| `liq.marcarPagada.exito` | Liquidación de C. Vera marcada como pagada · **$ 323.400 fuera de Rutax** |
| `visitas.pagar.exito` | **4 visitas a bodega pagadas por $ 17.200** · van en la liquidación de agosto |
| `cobranza.atribuir.exito` | **$ 812.600 atribuidos al período 07-2026 de Vega Norte** · queda en $ 0 por atribuir |
| `cobranza.parcial.exito` | **$ 300.000 atribuidos a Casa Bonita** · quedan $ 187.400 por pagar de ese período |
| `cobranza.excedente.exito` | **$ 310.000 atribuidos a Deco Vega** · $ 12.400 quedan a su favor para el próximo período |
| `cobranza.descartar.exito` | Movimiento de **$ 45.000** descartado · lo puedes recuperar desde «Descartados» |
| `cobranza.recuperar.exito` | Movimiento de **$ 45.000** recuperado · vuelve a estar por atribuir |
| `cobranza.sincronizar.exito` | Banco sincronizado · **3 movimientos nuevos por $ 1.184.300** |
| `excepciones.crear.exito` | Diferencia registrada · **$ 4.200 en el período 08-2026 de Vega Norte** |
| `excepciones.resolver.exito` | Diferencia de $ 4.200 resuelta · **el período de Vega Norte ya se puede facturar** |
| `excepciones.cerrar.exito` | Caso cerrado · **$ 4.200 quedaron resueltos** y el período se puede facturar |
| `excepciones.asignar.exito` | Caso asignado a M. Soto · vence el 25-08 |
| `excepciones.bloqueo.exito` | Esta diferencia ya **no bloquea la facturación** de Vega Norte |
| `folios.cargar.exito` | **50 folios cargados · del 1001 al 1050** |
| `plan.pagar.exito` | **Pagaste tu plan · $ 149.000** · tu cuenta queda al día |

## 3.3 Configuración y equipo · 21 escritos de 31

| Clave | Texto |
|---|---|
| `tarifas.crear.exito` | Tarifa creada · Vega Norte · same-day · Norte · cobras $ 3.400, pagas $ 1.700 |
| `tarifas.programar.exito` | Tarifa programada · empieza a regir el 01-09 |
| `tarifas.reactivar.exito` | Tarifa reactivada · vuelve a aplicarse desde ahora |
| `zonas.crear.exito` | Zona Norte creada con 9 comunas |
| `cortes.guardar.exito` | Ventana de corte guardada · 16:00, objetivo 97% |
| `bodegas.crear.exito` | Bodega Pudahuel creada y ubicada |
| `bodegas.principal.exito` | Bodega Pudahuel es tu nueva bodega principal |
| `retiroConfig.guardar.exito` | Pago por visita a bodega guardado · $ 4.500 |
| `integraciones.crearClave.exito` | Clave creada · **cópiala ahora, no la volvemos a mostrar** |
| `integraciones.copiarClave.exito` | Clave copiada |
| `exportar.pedir.exito` | Estamos preparando tu archivo · te avisamos cuando esté |
| `exportar.listo.exito` | Tu archivo está listo · 12 MB, disponible por 7 días |
| `plan.cambiar.exito` | Cambiaste al plan Flota · **$ 149.000 al mes desde el 01-09** |
| `equipo.invitar.exito` | Invitación enviada a jperez@andesexpress.cl · vence en 7 días |
| `equipo.cambiarRol.exito` | C. Rojas ahora es Supervisor · toma efecto en su próxima pantalla |
| `equipo.reactivar.exito` | R. Fuentes puede volver a entrar |
| `sellers.invitar.exito` | Invitación enviada a Vega Norte SpA · vence en 7 días |
| `conductores.crear.exito` | C. Vera Espinoza dado de alta · le mandamos cómo entrar a la app |
| `conductores.datosBanco.exito` | Datos bancarios guardados · Banco de Chile ···4821 |
| `puesta.pasoListo.exito` | Paso listo · te quedan 2 para poder operar |
| `puesta.completa.exito` | **Ya puedes operar** · los cinco pasos están listos |

## 3.4 App del conductor · 7 escritos de 19 · cortos, para leer de reojo

| Clave | Texto |
|---|---|
| `app.entrega.exito` | **Entrega registrada** · parada 8 de 24 lista |
| `app.noEntrega.exito` | Registrado: nadie recibió · tu coordinador lo va a ver |
| `app.pendiente.confirmado` | **Ya se confirmó** · la entrega de Av. Grecia 4120 quedó guardada |
| `app.escaneo.ok` | Bulto 38 · siga |
| `app.diaCerrado.exito` | **Terminaste tu día** · 22 entregadas, 2 no entregadas |
| `app.disponible.exito` | Quedaste disponible · tu coordinador ya te ve |
| `app.termino.exito` | Guardamos tu punto de término · tus rutas van a terminar cerca de ahí |

## 3.5 Portal del seller y backstage · 10 escritos de 30

| Clave | Texto |
|---|---|
| `portal.conectar.exito` | **«Vega Norte Oficial» conectada** · tus pedidos nuevos van a llegar solos |
| `portal.reconectar.exito` | **Listo, ya estamos recibiendo tus pedidos otra vez** |
| `portal.sincronizar.exito` | Sincronizado · 3 pedidos nuevos entraron |
| `portal.renombrar.exito` | Cuenta renombrada |
| `portal.reportar.exito` | **Listo, Andes Express ya la tiene** · te respondemos acá mismo en Mis incidencias |
| `bs.entrarCuenta.exito` | Estás dentro de Andes Express SpA · todo lo que hagas queda a tu nombre |
| `bs.salirCuenta.exito` | Saliste de Andes Express · la sesión duró 14 minutos |
| `bs.crearCourier.exito` | Andes Express SpA creado · le mandamos al dueño cómo empezar |
| `bs.habilitarEmision.exito` | **Rápido Sur ya emite documentos reales** · queda en la bitácora a tu nombre |
| `bs.aviso.exito` | Aviso publicado · lo van a ver 27 couriers |

**Los 42 restantes** —renombrar una zona, copiar un dato, marcar un favorito— son de un solo módulo cada uno y se derivan del molde sin ambigüedad.

**Los 5 asíncronos** —emitir, pagar en lote, exportar, etiquetas en lote, sincronizar— tienen dos textos: el de «quedó en curso» y el de «ya está», y el segundo llega por el centro de avisos si el usuario se fue de la pantalla.

---

# 4 · Errores · las seis familias

**53 mensajes.** Cada familia tiene su molde y su lugar. Ninguno dice «error». Ninguno muestra un código, un nombre de tabla ni el mensaje crudo de un proveedor.

## 4.1 Validación de campo · 14 · pegada al campo, al salir de él, nunca al escribir

| Clave | Texto |
|---|---|
| `val.rut` | Este RUT no es válido. Revisa el dígito verificador. |
| `val.rutRepetido` | Ya tienes un seller con este RUT: Vega Norte SpA. |
| `val.montoCero` | El monto tiene que ser mayor que $ 0. |
| `val.pagasMasQueCobras` | Le vas a pagar al conductor más de lo que le cobras al seller. Puedes guardarlo igual, pero revisa que sea a propósito. |
| `val.motivoCorto` | Escribe al menos 10 caracteres. Este motivo lo va a leer el conductor. |
| `val.telefono` | Escribe el teléfono con los 9 dígitos, sin el +56. |
| `val.correo` | Revisa el correo: le falta el @ o el dominio. |
| `val.folioRango` | El folio final tiene que ser mayor que el inicial. |
| `val.folioSolapado` | Ya tienes cargado el folio 1020. Revisa el rango en el sitio del SII. |
| `val.archivoTipo` | Este archivo no es el del SII. Tiene que ser un `.xml`, sin abrirlo ni editarlo antes. |
| `val.dominioShopify` | Pega el dominio completo, como `mitienda.myshopify.com`. |
| `val.contrasena` | Usa al menos 8 caracteres. No tiene que tener símbolos raros. |
| `val.fechaPasada` | Esta fecha ya pasó. Elige hoy o un día siguiente. |
| `val.comunaFalta` | Elige la comuna. Sin ella no podemos armar la ruta. |

## 4.2 Permiso · 7 · embebido, nunca un modal · dice qué falta y a quién pedírselo

| Clave | Texto |
|---|---|
| `perm.general` | Tu perfil no tiene acceso a esto. Si lo necesitas, pídeselo al dueño de tu empresa. |
| `perm.dinero` | Las pantallas de dinero las ve Administración y el dueño. Tú puedes ver los pedidos y su estado. |
| `perm.emitir` | Emitir documentos tributarios lo puede hacer Administración y el dueño. |
| `perm.usuarios` | Gestionar personas lo puede hacer solo el dueño. |
| `perm.otroSeller` | Este pedido es de otro seller. Solo puedes ver los tuyos. |
| `perm.suspendido` | Tu cuenta está suspendida. Habla con el dueño de tu empresa para volver a entrar. |
| `perm.2fa` | Esta acción necesita tu segundo factor, aunque ya hayas entrado. |

## 4.3 Estado · 10 · el dato cambió mientras mirabas

| Clave | Texto |
|---|---|
| `est.yaAsignado` | 2 de los 30 pedidos los asignó C. Rojas hace un momento. Los otros 28 se asignaron bien. |
| `est.yaEnRuta` | Este pedido ya salió a ruta con R. Muñoz, así que no se puede reasignar. Llámalo si hay que cambiarlo. |
| `est.periodoFacturado` | Este período ya se facturó con el folio 1041, así que sus líneas no se pueden cambiar. Para corregirlo se necesita una nota de crédito. |
| `est.periodoCerrado` | M. Soto cerró este período hace 3 minutos. Reábrelo si necesitas seguir agregando líneas. |
| `est.excepcionBloquea` | Hay una diferencia de $ 4.200 sin resolver que bloquea la facturación de este seller. Resuélvela y vuelve a intentar. |
| `est.liquidacionPagada` | Esta liquidación ya se pagó el 05-09, así que no se puede ajustar. Lo que corresponda va en la del próximo período. |
| `est.transicionInvalida` | Una excepción cerrada no puede volver a «en revisión». Reábrela primero. |
| `est.paradaCerrada` | Esta parada ya la cerraste a las 16:24. Si te equivocaste, avísale a tu coordinador. |
| `est.traspasoTomado` | J. Tapia ya aceptó estos bultos hace un momento. |
| `est.folioConsumido` | Otra factura tomó el folio 1041 mientras revisabas. Esta va a usar el 1042. |

## 4.4 Integración externa · 10 · nunca el mensaje del proveedor · siempre qué sigue funcionando

| Clave | Texto |
|---|---|
| `int.siiCaido` | El Servicio de Impuestos Internos no está respondiendo. **No se emitió nada y no se consumió ningún folio.** Vuelve a intentar en unos minutos. |
| `int.siiRechazo` | **El SII rechazó la factura y el folio 1041 quedó consumido.** Revisa el RUT y el giro del seller antes de emitir de nuevo con el folio siguiente. |
| `int.certificadoVencido` | Tu certificado digital venció el 14-08, así que no se puede emitir. Carga el nuevo en Configuración › Facturación. |
| `int.mlCaida` | Dejamos de recibir los pedidos de «Vega Norte Oficial». **Los pedidos que ya están en camino se entregan igual.** Se arregla volviendo a conectar la cuenta. |
| `int.mlLenta` | Mercado Libre está tardando más de lo normal. Los pedidos van a entrar solos cuando responda; no hagas nada. |
| `int.shopifyToken` | El token de mitienda.myshopify.com dejó de servir. Genera uno nuevo en tu panel de Shopify y pégalo acá. |
| `int.bancoCaido` | El banco no está respondiendo. **No salió ninguna transferencia.** Vuelve a intentar más tarde; si insiste, revisa tu banco en línea antes de repetir. |
| `int.bancoRechazo` | El banco rechazó la transferencia a C. Vera: **el RUT no coincide con la cuenta.** Corrige sus datos bancarios y vuelve a pagar. |
| `int.mapaCaido` | No pudimos cargar el mapa. Los pedidos y sus estados están bien: es solo el plano. |
| `int.geocodifica` | No pudimos ubicar esta dirección. Revísala o marca el punto a mano en el mapa. |

## 4.5 Límite de plan · 6 · dice el número, el plan que lo resuelve y qué sigue funcionando

| Clave | Texto |
|---|---|
| `plan.pedidos100` | Llegaste a los 5.000 pedidos de tu plan Flota este mes. **Los pedidos siguen entrando** y se cobran $ 30 cada uno sobre el límite. El plan Bodega Grande incluye 12.000. |
| `plan.conductores` | Tu plan Flota incluye 15 conductores y ya tienes 15. Para dar de alta a otro, cambia de plan. |
| `plan.cuentasML` | Llegaste al máximo de 10 cuentas de Mercado Libre. Si necesitas otra, desconecta una que no uses. |
| `plan.moroso` | Tu plan tiene un pago pendiente del 02-07. **Todo sigue funcionando por ahora**, pero a los 60 días la cuenta se suspende. Págalo en Mi plan. |
| `plan.suspendido` | Rutax está suspendido por falta de pago. Tus datos están todos acá. Paga en Mi plan y vuelve a operar al instante. |
| `plan.foliosAgotados` | **No te quedan folios y sin folios no se puede facturar.** Descarga un rango nuevo del sitio del SII y cárgalo en Configuración › Folios. |

## 4.6 Red y sistema · 6 · notificación temporal con reintento · nunca un código

| Clave | Texto |
|---|---|
| `sys.guardarFallo` | No pudimos guardar. Lo que escribiste sigue acá: vuelve a intentar. |
| `sys.lecturaFallo` | No pudimos cargar los pedidos. Esto no significa que no haya: significa que no los pudimos leer. |
| `sys.sesionVencida` | Tu sesión se cerró por seguridad. Entra de nuevo y sigues donde estabas. |
| `sys.pdfFallo` | No pudimos generar el PDF. **La factura sí está emitida y su folio es el 1041.** |
| `app.sinSenal` | Guardado, falta confirmar. Estamos reintentando solos: sigue con la siguiente parada. **Si cierras la app ahora, esto se pierde.** |
| `sys.general` | Algo se rompió de nuestro lado. Ya lo estamos revisando: vuelve a intentar en unos minutos. |

**Regla de lugar:** ningún error de dinero va en notificación temporal. Van embebidos y se quedan.

---

# 5 · Estados vacíos en tres tonos

**44 · 40 escritos.** Molde: **titular de 4 palabras máximo, cuerpo de 24**, y una acción solo si existe.

## 5.1 Tono arranque · 19 · todavía no hay datos porque recién empiezas

| Clave | Titular | Cuerpo · acción |
|---|---|---|
| `pedidos.vacio.arranque` | **Aún no hay pedidos para hoy** | Los pedidos de tus sellers llegan solos cuando ellos venden. También puedes crear uno same-day a mano. · *Crear pedido same-day* |
| `sellers.vacio.arranque` | **Todavía no tienes sellers** | Invita al primero y sus pedidos van a empezar a entrar solos. · *Invitar a un seller* |
| `conductores.vacio.arranque` | **Todavía no tienes conductores** | Sin conductores no se pueden armar rutas. Da de alta al primero con su nombre y su RUT. · *Dar de alta un conductor* |
| `tarifas.vacio.arranque` | **Todavía no tienes tarifas** | Sin una tarifa las entregas no se pueden cobrar ni liquidar. Crea al menos la tarifa por defecto. · *Crear tarifa* |
| `zonas.vacio.arranque` | **Todavía no tienes zonas** | Las zonas agrupan comunas para cobrar distinto según dónde entregas. Sin zonas, todo usa tu tarifa por defecto. · *Crear zona* |
| `bodegas.vacio.arranque` | **Todavía no tienes bodegas** | De tu bodega sale la flota: es el origen de toda ruta. Crea la primera con su dirección. · *Crear bodega* |
| `folios.vacio.arranque` | **Todavía no tienes folios** | Un folio es un número autorizado por el SII y cada factura consume uno. Descarga un rango de su sitio y cárgalo acá. · *Cargar folios* |
| `periodos.vacio.arranque` | **Todavía no hay períodos** | Cada entrega genera su línea de cobro y las agrupamos por mes. El primer período aparece con tu primera entrega. |
| `liq.vacio.arranque` | **Todavía no hay liquidaciones** | Se generan al cerrar el mes, con las entregas y las visitas a bodega de cada conductor. |
| `cobranza.vacio.arranque` | **Todavía no conectas el banco** | Conéctalo y vamos a leer los pagos de tus sellers para cuadrarlos solos. · *Conectar el banco* |
| `equipo.vacio.arranque` | **Estás solo en tu equipo** | Invita a tu coordinador o a quien lleve la administración, y cada uno va a ver lo que le toca. · *Invitar a una persona* |
| `manifiestos.vacio.arranque` | **Todavía no armas rutas** | Asigna pedidos a un conductor y su ruta del día aparece acá. · *Ir a asignar* |
| `app.manifiesto.borrador` | **Tu ruta se está armando** | Tu coordinador la está preparando. Te avisamos cuando esté lista y no tienes que hacer nada. |
| `app.retiros.vacio` | **Sin retiros este mes** | Acá quedan tus retiros cerrados, con lo que llevaste de cada bodega. |
| `portal.cuentas.vacio` | **Todavía no conectas ninguna cuenta** | Conecta tu cuenta de Mercado Libre o tu tienda Shopify, y tus pedidos van a llegar solos a Andes Express. · *Conectar una cuenta* |
| `portal.pedidos.vacio` | **Todavía no tienes pedidos** | Cuando vendas, tus pedidos van a aparecer acá y Andes Express los va a retirar. · *Crear pedido same-day* |
| `portal.bodegas.vacio` | **Sin bodegas registradas** | Andes Express todavía no registró dónde retirar tus pedidos. Escríbeles para coordinarlo. |
| `bs.couriers.vacio` | **Todavía no hay couriers** | El primero se crea desde acá con su razón social y su RUT. · *Crear un courier* |
| `bs.avisos.vacio` | **Sin avisos publicados** | Acá se escriben los avisos que ven los couriers en su producto. · *Escribir un aviso* |

## 5.2 Tono buena noticia · 13 · no hay nada porque todo está bien

**Siempre con cifra y hora de última revisión.** Un número es lo que convierte «no hay nada» en «revisamos y está bien».

| Clave | Titular | Cuerpo |
|---|---|---|
| `direcciones.vacio.bueno` | **No hay direcciones por revisar** | Las 284 direcciones de hoy quedaron ubicadas. Si alguna falla, aparece acá y el pedido no sale a ruta sin avisarte. *Última revisión: hoy 16:04* |
| `incidencias.vacio.bueno` | **Sin incidencias abiertas** | Las 34 entregas de hoy van sin problemas. Cuando algo se rompa, aparece acá primero. *Última revisión: hoy 16:04* |
| `conciliacion.vacio.bueno` | **Todo cuadra** | Las 427 líneas del período calzan con sus entregas y con sus pagos. No hay nada que revisar. *Última revisión: hoy 16:04* |
| `excepciones.vacio.bueno` | **Sin diferencias** | Ninguna de las 18 clases de diferencia apareció este mes. Tu dinero está cuadrado. *Última revisión: hoy 16:04* |
| `torre.vacio.sinIncidencias` | **Nada atascado** | Los 34 pedidos en ruta van avanzando. Cuando uno se atasque, aparece acá en rojo. *Actualizado hace 30 segundos* |
| `pedidos.vacio.todoSalio` | **Todo salió hoy** | Los 284 pedidos de hoy están asignados y en ruta. No queda nada sin conductor. *Última revisión: hoy 16:04* |
| `cobranza.vacio.bueno` | **Sin pagos por atribuir** | Los 38 movimientos del banco están atribuidos a su período. *Sincronizado hoy 16:04* |
| `liq.vacio.todoPagado` | **Todos pagados** | Las 9 liquidaciones de agosto están pagadas por $ 2.847.300. *Último pago: 05-09* |
| `portal.incidencias.vacio.bueno` | **Sin problemas** | Tus 284 pedidos de este mes llegaron sin incidencias. *Última revisión: hoy 16:04* |
| `portal.cuentas.vacio.bueno` | **Tus cuentas están bien** | Las 4 cuentas conectadas están recibiendo pedidos. *Última sincronización: hoy 15:58* |
| `app.dia.terminado` | **Terminaste tu día** | Cerraste las 24 paradas. Nos vemos mañana. |
| `bs.integraciones.vacio.bueno` | **Ninguna conexión caída** | Las 312 conexiones de los 27 couriers están recibiendo pedidos. *Revisado hace 2 minutos* |
| `bs.cobros.vacio.bueno` | **Ningún pago vencido** | Los 27 couriers están al día. *Revisado hoy 16:04* |

## 5.3 Tono filtro sin resultados · 8 escritos de 12 · nombra el filtro y ofrece limpiarlo

| Clave | Titular | Cuerpo · acción |
|---|---|---|
| `pedidos.vacio.filtro` | **Ningún pedido coincide** | Estás filtrando por Vega Norte, Maipú y 21-08. Hay 284 pedidos hoy fuera de ese filtro. · *Limpiar los filtros* |
| `pedidos.busqueda.vacio` | **Sin resultados para «7K2M»** | Prueba con el código completo o con el nombre del destinatario. · *Limpiar la búsqueda* |
| `excepciones.vacio.filtro` | **Ninguna coincide con el filtro** | Estás viendo solo las que bloquean facturación y están vencidas. Hay 12 diferencias fuera de ese filtro. · *Limpiar los filtros* |
| `periodos.vacio.filtro` | **Ningún período coincide** | Estás filtrando por facturados y agosto. Hay 6 períodos abiertos este mes. · *Limpiar los filtros* |
| `liq.vacio.filtro` | **Ninguna liquidación coincide** | Estás filtrando por pagadas y julio. Hay 6 en borrador este mes. · *Limpiar los filtros* |
| `torre.vacio.filtroComuna` | **Sin pedidos en Maipú** | Hay 34 pedidos en ruta en otras 8 comunas. · *Ver todas las comunas* |
| `bitacora.vacio.filtro` | **Sin acciones con ese filtro** | Estás viendo solo las de M. Toro en Andes Express. Hay 1.284 acciones en los últimos 30 días. · *Limpiar los filtros* |
| `portal.pedidos.vacio.filtro` | **Ningún pedido coincide** | Estás viendo solo los entregados de agosto. Tienes 6 en camino. · *Limpiar los filtros* |

**Los tres tonos no comparten redacción ni glifo.** Arranque: círculo abierto, habla en futuro. Buena noticia: símbolo de la marca, presente afirmativo, siempre con número. Filtro: cuadrado tachado, nombra los filtros y dice cuántos hay afuera.

---

# 6 · Advertencias que no son errores

**12.** Van en tono `attention`, **nunca bloquean**, y su última frase siempre dice que se puede seguir. La diferencia con un error: acá el usuario tiene razón en hacer lo que está haciendo, y solo necesita saber algo antes.

| Clave | Texto |
|---|---|
| `aviso.fueraDeCorte` | **Estás creando este pedido después de la hora de corte** — La ventana de Vega Norte cierra a las 16:00 y ya son las 16:24. El pedido se crea igual y sale mañana en el primer despacho. *(Va pegada al campo de fecha, no arriba.)* |
| `aviso.segundaCuentaML` | **Antes de seguir: cierra tu sesión de Mercado Libre** — Si tienes la sesión abierta allá, Mercado Libre no te va a preguntar cuál cuenta quieres conectar y vas a terminar conectando la misma de nuevo. Ciérrala primero, o abre esto en una ventana privada. *(Única advertencia del producto que aparece antes de una acción y no durante. Es un paso previo obligatorio, no un aviso embebido.)* |
| `aviso.plan80` | **Vas en el 80% de los pedidos de tu plan** — 4.000 de 5.000 este mes, y quedan 9 días. Si te pasas, los pedidos siguen entrando y se cobran $ 30 cada uno. · *Ver planes* |
| `aviso.excepcionBloquea` | **Una diferencia está bloqueando esta facturación** — Hay $ 4.200 sin cuadrar en el período 08-2026 de Vega Norte. Mientras esté abierta, este período no se puede facturar. · *Ver la diferencia* |
| `aviso.verifOmitida` | **Emitiste sin revisar 3 problemas** — Queda registrado que omitiste la verificación previa, con tu nombre y la fecha. Los 3 problemas siguen ahí y conviene resolverlos antes del próximo período. *(Aparece después de emitir, en el comprobante.)* |
| `aviso.flexInformativo` | **Este pedido es de Mercado Libre Flex** — Lo que registres acá es solo para Andes Express. **La prueba oficial la tienes que hacer en la app de Mercado Envíos**, y es la que dispara tu pago. · *Abrir Mercado Envíos* *(Va en la app del conductor, arriba del botón de entregar, y no se puede saltar.)* |
| `aviso.direccionVieja` | **Esta dirección lleva 3 días sin poder ubicarse** — Mientras no se ubique, el pedido no entra a ninguna ruta. Corrígela a mano o marca el punto en el mapa. · *Corregir la dirección* |
| `aviso.foliosPocos` | **Te quedan 8 folios** — Con tu ritmo, te alcanzan para unos 6 días. Descarga un rango nuevo del sitio del SII antes de que se agoten. · *Cargar folios* |
| `aviso.certificadoPorVencer` | **Tu certificado digital vence en 21 días** — El 14-03-2027. Cuando venza no vas a poder emitir facturas. Renuévalo con tu proveedor y cárgalo acá. · *Ir a Facturación* |
| `aviso.modoPruebas` | **Sigues en modo de pruebas** — Nada de lo que emitas llega al SII todavía. Puedes operar y facturar en simulación mientras tanto; Rutax lo habilita cuando termines de probar. *(Distintivo permanente con trama en la cabecera de facturación.)* |
| `aviso.truncado` | **Se muestran 100 de 284 pedidos** — Afina el filtro para verlos todos, o expórtalos si necesitas la lista completa. · *Exportar los 284* |
| `aviso.cambiosEsperando` | **8 cambios esperando** *(390)* · **8 pedidos nuevos y 3 cambiaron de estado** *(escritorio)* — Se incorporan cuando toques. No se insertan solos para no moverte la selección. · *Ver los cambios* |

---

# 7 · Ayuda contextual

**8.** Va en popover al lado del término, no en un centro de ayuda aparte. **Dos párrafos máximo:** qué es, y qué te toca hacer con eso. Ninguna define un término con otro término del sistema.

### `ayuda.folio` · ¿Qué es un folio?
Es un número que el Servicio de Impuestos Internos te autoriza a usar para facturar. Cada factura que emites consume uno y no se puede reutilizar.

Los descargas del sitio del SII como un archivo y los cargas acá. **Cuando se te acaban, no puedes facturar**, así que conviene cargar un rango nuevo antes de llegar al final.

### `ayuda.certificado` · ¿Qué es el certificado digital y por qué vence?
Es tu firma electrónica: con ella el SII sabe que la factura la emitiste tú. Se compra a un proveedor autorizado y dura entre uno y tres años.

Cuando vence, **dejas de poder emitir facturas hasta cargar el nuevo**. Te avisamos 21 días antes, y de nuevo el día que vence.

### `ayuda.ventanaCorte` · ¿Qué es una ventana de corte?
Es la hora hasta la que recibes pedidos de un seller para despacharlos el mismo día. Si su corte es a las 16:00, lo que entre a las 16:30 sale mañana.

Sirve para dos cosas: ordenar tu día, y **medir si cumpliste el plazo que le prometiste a ese seller**. Cada seller puede tener la suya.

### `ayuda.tipoDiferencia` · ¿Qué significa esta diferencia?
Cada clase de diferencia dice **dónde se rompió el calce** entre una entrega, su cobro y su pago. Ejemplo, «Entrega sin cobro»: el conductor entregó y nunca se generó la línea de cobro al seller, así que estás perdiendo esa plata.

Tres de las 18 son fuga directa de ingreso y llevan alarma: entrega sin cobro, cobro anulado sin motivo y pago duplicado. Las otras 15 son cosas que hay que revisar, no urgencias.

### `ayuda.noProcesado` · ¿Por qué este pedido dice «no procesado»?
Llegó desde la tienda del seller pero le falta algo para poder salir: casi siempre la dirección no se pudo ubicar, o el seller no indicó la comuna.

Está guardado y no se pierde. **Corrige lo que falta y entra a la operación normal.**

### `ayuda.torreVsListado` · ¿Por qué la Torre muestra menos pedidos que el listado?
La Torre muestra solo lo que está **en la calle con compromiso para hoy**: pedidos asignados, en ruta y con dirección ubicada.

El listado muestra todo: los de mañana, los sin asignar, los que están por revisar y los cancelados. Las dos cifras son correctas y cuentan cosas distintas.

### `ayuda.puntoTermino` · ¿Qué implica dar mi punto de término?
Es la dirección donde terminas tu jornada, y se usa solo para armar tu ruta con la última parada cerca de ahí. La ve tu coordinador; no la ven los sellers, ni los compradores, ni otros conductores.

Es opcional: si no la das, tu ruta se arma igual. **Puedes borrarla cuando quieras** desde Preferencias.

### `ayuda.aceptadoConObs` · ¿Qué es «aceptado con observaciones»?
El SII recibió tu factura y **es válida**: se puede cobrar y el seller la puede usar. Pero anotó algo que conviene corregir en las próximas, como un giro o un dato del receptor.

No hay que reemitir nada ni emitir una nota de crédito. Revisa la observación y ajusta el dato para el próximo período.

---

# 8 · Notificaciones push del conductor

Se leen en una pantalla bloqueada, de reojo. **Título ≤24 caracteres, cuerpo ≤60**: pasado eso el sistema corta con puntos suspensivos y el número —que es lo que importa— es lo primero que se pierde. Por eso **el número va al principio del cuerpo**.

| Clave | Título | Cuerpo | Chars | Aterriza en | ¿Se puede apagar? |
|---|---|---|---|---|---|
| `push.rutaLista` | Tu ruta está lista | 24 paradas para hoy. Empieza cuando quieras. | 18 · 44 | Manifiesto del día | Sí. Si la apaga, **no se le avisa al coordinador**: el manifiesto ya explica su estado |
| `push.traspaso` | Te pasaron bultos | 6 bultos de R. Muñoz. Revísalos y acepta. | 17 · 41 | Traspaso, con los bultos listados y el botón de aceptar | **No.** Sin ella el traspaso queda esperando y alguien carga bultos que no son suyos |
| `push.retiro` | Tienes un retiro | 42 bultos en Vega Norte Maipú. | 16 · 30 | Parada de retiro, con cómo entrar y el botón de escanear | Sí |

### `push.permiso.previo` · cómo se pide el permiso la primera vez

Se pide **justo después de que cierra su primera parada**, cuando ya entendió para qué sirve la app — no al abrirla. Pantalla propia antes del diálogo del sistema:

> **Te avisamos cuando tengas trabajo**
> Así no tienes que abrir la app a cada rato para ver si ya te toca. Te vamos a avisar tres cosas: cuando tu ruta esté lista, cuando te pasen bultos y cuando te asignen un retiro. Nada más.
> **Activar los avisos** · Después

### `push.permiso.denegado` · si ya lo rechazó

> **Los avisos están apagados**
> Vas a tener que abrir la app para ver si tienes ruta o un retiro nuevo. Puedes activarlos en Ajustes › Rutax › Notificaciones.
> **Abrir los ajustes**

El permiso del sistema **se pide una sola vez más** tras un rechazo; después solo queda el camino de los ajustes.

---

# 9 · Los correos

**16 piezas.** Todos en **TÚ**, todos con **una sola llamada a la acción**. **Diez no existen hoy:** ningún evento de dinero avisa a nadie, y el comprador final nunca recibe su enlace por una vía de Rutax.

## 9.1 La plantilla base

600 px, una columna:

1. **Marca** — del courier si el destinatario es su cliente (seller, conductor, comprador); de Rutax si nosotros somos la contraparte (folios, certificado, morosidad, plan).
2. **Titular con el hecho.**
3. **Párrafo de contexto** — qué pasó, cuándo, y qué significa para quien lee.
4. **Bloque de datos en mono** — donde va la plata y lo que se mira primero.
5. **Un botón.**
6. **Enlace de respaldo en texto.**
7. **Pie** — por qué lo recibe y cómo dejar de recibirlo.

**Móvil:** una columna siempre, 600 px que bajan a 100% bajo 480. Botón de 44 px de alto y ancho completo. Cuerpo 14 px, nunca menos: se lee en la calle.

**Modo oscuro:** los clientes de correo invierten por su cuenta y no se puede impedir. Así que la plantilla **no usa fondos casi blancos ni texto casi negro** —que al invertirse quedan ilegibles—, sino blanco puro sobre negro de marca, y el botón declara su color de fondo dos veces para que sobreviva la inversión.

**Cliente antiguo:** degrada a una columna de tabla con texto y un enlace subrayado. Sin Chivo cae a Helvetica; sin el botón, queda el enlace de respaldo que ya está en el cuerpo. **Ningún correo depende de una imagen:** el nombre del courier es texto, no un logo.

**Regla de asunto:** el hecho y su número, ≤45 caracteres, **sin el nombre del producto al principio** —el remitente ya lo dice— y sin exclamaciones. Los de dinero llevan el monto en el asunto: es lo que decide si se abre ahora o después.

## 9.2 Los diez que hoy no existen

### `mail.periodoCerrado` → al seller
**Asunto:** Tu período de agosto quedó cerrado · $ 864.100
**Cuerpo:** Cerramos tu período de agosto con 285 entregas. Todavía no es una factura: cuando la emitamos te llega el documento con su folio. Si ves algo raro, dinos ahora que se puede corregir.
**Datos:** 285 entregas · 3 recargos · 1 ajuste · Total neto $ 864.100
**Acción:** Ver el detalle

### `mail.facturaEmitida` → al seller
**Asunto:** Factura 1041 de Andes Express · $ 966.994
**Cuerpo:** Te adjuntamos la factura de tu período de julio. La emitimos hoy ante el Servicio de Impuestos Internos.
**Datos:** Folio 1041 · Período 07-2026 · Neto $ 812.600 · IVA $ 154.394 · Total $ 966.994
**Acción:** Descargar la factura · *PDF adjunto, además del enlace*

### `mail.liqEmitida` → al conductor
**Asunto:** Tu liquidación de agosto · $ 323.400
**Cuerpo:** Esta es tu liquidación de agosto. Incluye 196 entregas y 4 visitas a bodega, más los ajustes que verás en el detalle. Se paga el 5 de septiembre.
**Datos:** Entregas $ 302.200 · Visitas $ 17.200 · Ajustes +$ 4.000 · **Total $ 323.400**
**Acción:** Ver mi liquidación · *el PDF va en usted; el correo, en tú*

### `mail.liqPagada` → al conductor
**Asunto:** Te pagamos $ 323.400
**Cuerpo:** Transferimos tu liquidación de agosto a tu cuenta del Banco de Chile ···4821. Debería estar hoy o mañana según tu banco.
**Datos:** Agosto 2026 · 200 servicios · $ 323.400
**Acción:** Ver el detalle

### `mail.pagoRechazado` → a Administración
**Asunto:** El banco rechazó el pago a C. Vera
**Cuerpo:** No se pudo transferir $ 323.400 a Carlos Vera porque el RUT no coincide con la cuenta. Él no recibió nada y sigue pendiente de pago.
**Datos:** C. Vera Espinoza · Banco de Chile ···4821 · $ 323.400
**Acción:** Corregir sus datos bancarios

### `mail.foliosPorAgotarse` → al courier · marca Rutax
**Asunto:** Te quedan 8 folios
**Cuerpo:** Con el ritmo de este mes te alcanzan para unos 6 días. Cuando se acaben no vas a poder facturar. Descarga un rango nuevo del sitio del SII y cárgalo en Rutax.
**Datos:** Folio 1043 al 1050 · 42 usados de 50 este mes
**Acción:** Cargar folios

### `mail.certificadoPorVencer` → al courier · marca Rutax
**Asunto:** Tu certificado digital vence en 21 días
**Cuerpo:** El 14 de marzo dejas de poder emitir facturas hasta cargar uno nuevo. Renuévalo con tu proveedor y súbelo a Rutax; toma dos minutos.
**Datos:** Vence el 14-03-2027
**Acción:** Ir a Facturación

### `mail.morosidad` → al courier · marca Rutax
**Asunto:** Tu pago de Rutax está pendiente
**Cuerpo:** No pudimos cobrar tu plan del 2 de julio. Todo sigue funcionando por ahora, pero a los 60 días la cuenta se suspende y tus conductores y sellers dejan de poder entrar.
**Datos:** Plan Flota · $ 149.000 · vencido hace 50 días
**Acción:** Pagar ahora

### `mail.excedente` → al seller
**Asunto:** Te quedaron $ 12.400 a favor
**Cuerpo:** Tu transferencia del 20 de agosto cubrió más de lo que debías. Dejamos los $ 12.400 a tu favor y se descuentan solos de tu próximo período.
**Datos:** Pagaste $ 310.000 · Período 07-2026 $ 297.600 · A favor $ 12.400
**Acción:** Ver mis cobros

### `mail.seguimiento` → al comprador final
**Asunto:** Tu pedido de Vega Norte va en camino
**Cuerpo:** Andes Express lo está entregando hoy entre las 15:00 y las 17:00. Puedes ver dónde va con este enlace.
**Datos:** Código RX-7K2M-9PQR · Ñuñoa
**Acción:** Seguir mi pedido
*Sin dirección y sin nombre en el cuerpo: solo el código y la comuna. Se manda una vez al salir a ruta y una segunda al entregar. **Nunca en Flex.***

## 9.3 Los seis que ya existen, reescritos al molde

| Clave | Asunto | Nota |
|---|---|---|
| `mail.invitaSeller` | Andes Express te invitó a su plataforma de despacho | Acción: «Crear mi contraseña». El enlace vence en 7 días y el correo lo dice |
| `mail.invitaEquipo` | Te sumaron al equipo de Andes Express | Dice el rol y qué va a poder hacer. Acción: «Crear mi contraseña» |
| `mail.bienvenidaConductor` | Descarga la app de Andes Express | Dos enlaces de tienda y su usuario. Acción: «Descargar la app» |
| `mail.recuperar` | Cambia tu contraseña de Rutax | «Si no fuiste tú, ignora este correo: tu contraseña sigue igual.» El enlace dura 1 hora y lo dice |
| `mail.cuentaCaida` | Dejamos de recibir los pedidos de «Vega Norte Oficial» | Dice que se arregla en menos de un minuto. Acción: «Volver a conectar» |
| `mail.exportListo` | Tu archivo está listo | Dice el peso y que el enlace dura 7 días. Acción: «Descargar» |

**Decisión cerrada:** **no se manda correo al resolver una incidencia del seller.** El acuse del formulario lo declara —«te respondemos acá mismo en Mis incidencias, no te vamos a escribir por correo»— y la sección de incidencias es el único canal.

---

# 10 · Las siete reglas de contenido

1. **Ningún error de dinero va en notificación temporal.** Van embebidos y se quedan.
2. **Todo mensaje de éxito de dinero lleva monto y contraparte.** «Listo» está prohibido ahí.
3. **Todo vacío de buena noticia lleva una cifra y la hora de la última revisión.**
4. **El botón que cancela dice «Volver»**, nunca «Cancelar» — en este dominio, cancelar es cancelar un pedido.
5. **Un error de integración dice siempre qué *sigue* funcionando**, y nunca repite el mensaje del proveedor.
6. **Un motivo que va a leer un externo se declara como tal** en el formulario donde se escribe.
7. **Ningún correo depende de una imagen:** el nombre del courier es texto.

---

# Anexo · Los siete mensajes que obligaron a cambiar una pantalla

Escribir el copy antes de dibujar el resto de las pantallas sirvió exactamente para esto.

1. **La confirmación de cancelar en lote no cabía.** El modal tenía una línea de consecuencia; este mensaje necesita tres afirmaciones y una advertencia aparte («4 de los 14 ya salieron a ruta»). El modal gana un **bloque de excepción interno**, visible solo cuando la selección es mixta.
2. **«El SII rechazó la factura y el folio quedó consumido» no cabe en una notificación temporal.** Pasa a **aviso embebido persistente** en la cabecera del período, con el folio perdido a la vista. De ahí sale la regla 1.
3. **Los vacíos de buena noticia necesitaban un número.** Los 13 pasan a llevar cifra y hora, y eso agrega una línea al componente `estado vacío`.
4. **El aviso de segunda cuenta de Mercado Libre no es un aviso: es una pantalla.** Sus dos salidas —cerrar sesión allá o ventana privada— no caben embebidas. Pasa a **paso previo obligatorio**.
5. **La franja de cambios pendientes necesita dos largos:** corto en 390, largo en escritorio.
6. **El nombre del receptor salió del seguimiento público.** Al escribir el mensaje quedó claro que no se puede publicar: «Lo recibió alguien en el domicilio».
7. **El correo del comprador obligó a una regla nueva:** se manda al salir a ruta y al entregar, **nunca en Flex**, y su cuerpo no lleva dirección ni nombre — solo código y comuna.

---

*Fin del sistema de mensajes. Lo que no está escrito acá: los 42 éxitos de módulo único (el molde los resuelve), los cuerpos completos de los 6 correos existentes, y los términos y la política de privacidad — texto legal en USTED que escribe un abogado.*
