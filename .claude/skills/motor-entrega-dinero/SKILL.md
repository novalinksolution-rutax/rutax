---
name: motor-entrega-dinero
description: Reglas de negocio del núcleo financiero — cómo cada entrega genera su línea de cobro al seller y su línea de liquidación al conductor, cómo se aplican las incidencias, cómo concilia entregado-vs-facturado, y cómo se maneja el same-day (facturado al seller o como gasto propio del courier). Úsala al implementar facturación, liquidación o conciliación.
---
# Motor entrega→dinero

## Idea central
Cada entrega es un evento que, al cambiar de estado, genera consecuencias de dinero, derivadas de un ÚNICO dato de origen (los estados reales del envío). Lo entregado, lo facturado y lo pagado salen del mismo dato y por eso cuadran.

## Por cada entrega
- Línea de cobro al seller: aplica la tarifa pactada con ese seller (por tipo de entrega y/o zona). Se acumula a la factura del período (semanal o mensual).
- Línea de liquidación al conductor: aplica lo que se paga al conductor que la realizó. Se acumula a su liquidación.

## Reglas de incidencia (críticas)
- Un reintento de una misma entrega NO se cobra dos veces.
- Una devolución / no entrega NO se le paga al conductor (o se paga según la regla configurada).
- Un reagendo ajusta, no duplica.
Estas reglas deben ser configurables y quedar trazadas.

## Same-day ad-hoc
Cada entrega same-day tiene un "destino de facturación":
- A un seller → genera línea de cobro a ese seller (se factura junto con sus Flex del período).
- Como gasto propio del courier (imprevisto) → NO se factura a nadie; se registra como costo interno.

## Conciliación
- Entregado-vs-facturado (MVP): el sistema cruza lo realmente entregado contra lo facturado.
- Entregado-facturado-pagado (crecimiento): suma la conciliación del pago (ver skill pagos-chile).

## Límites
- El motor NO emite la factura por su cuenta: arma las líneas y delega la emisión al proveedor DTE bajo el RUT del courier (ver skill chile-dte).
- El motor NO paga a los conductores: calcula y registra; el pago lo hace el courier por fuera (efectivo/transferencia), porque hay conductores informales.

## Pruebas
Cubre: cálculo correcto de tarifas, aplicación de cada regla de incidencia, manejo del same-day en ambos destinos, y que la conciliación cuadre. Son parte de la definición de hecho.
