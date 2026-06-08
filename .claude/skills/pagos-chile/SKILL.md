---
name: pagos-chile
description: Flujos de pago del proyecto en Chile — cobranza courier→seller por transferencia con conciliación automática (Fintoc/Khipu), suscripción del SaaS al courier (Flow/Webpay PatPass) y la regla de que el same-day no es un cobro separado. Úsala al construir cobranza, conciliación o el cobro de la suscripción.
---
# Pagos (Chile)

## Verifica lo volátil
Comisiones, tiempos de abono y capacidades cambian. Confirma contra la fuente oficial de cada proveedor antes de decidir.

## Tres flujos distintos (no mezclar)
1. Cobranza courier → seller (el dolor de conciliación): transferencia con confirmación y conciliación automática. Candidatos: Fintoc (open banking, conciliación en tiempo real, PAC) o Khipu. Es lo que elimina el cuadre manual.
2. Suscripción del SaaS, cobro al courier (recurrente): Flow (suscripciones nativas) o Webpay PatPass.
3. (Opcional) checkout puntual: Webpay/Flow/Mercado Pago.

## Regla de negocio clave
El same-day NO es un cobro separado al seller. Se SUMA a las entregas del período y se factura junto con los Flex en el cierre (semanal o mensual). El fundador no cobra comisión por entrega.

## Conciliación
La conciliación del pago alimenta la capa entregado-facturado-pagado del motor entrega→dinero (ver skill motor-entrega-dinero) y dispara alertas de morosidad.

## Costos como parte del modelo
Las transacciones de cobranza tienen costo; en el modelo de negocio se pasan como cupo incluido + excedente. No asumas costo cero al diseñar.
