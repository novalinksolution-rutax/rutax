# 7. Dinero: PSP / medios de pago / COD

## PSP / medios de pago — ya elegidos [REPO]
Según el repo y la skill **pagos-chile**, las decisiones de pago ya están tomadas y, en parte,
implementadas:

| Flujo | Medio elegido | Estado |
|-------|---------------|--------|
| **Cobranza courier → seller** | **Fintoc** (transferencia con conciliación automática); Khipu mencionado como alternativa | **Implementado**: adaptador `src/modules/integraciones/pagos/fintoc/`, webhooks, `pagos_recibidos`, matching automático. Doc: `docs/arquitectura/cobranza-fintoc.md`. |
| **Suscripción del SaaS → courier** | **Flow / Webpay PatPass** (cobro recurrente) | **NO construido — queda para V2.** Verificado en el repo: `src/modules/integraciones/pagos/` solo contiene el adaptador **Fintoc**; no hay adaptador PatPass/Webpay, ni tabla/migración de suscripción. El modelo de cobro (base + variable por conductor activo) está **decidido en los docs** pero **sin implementar**. |
| **Same-day** | NO es un cobro separado | Regla de negocio: el same-day se factura al seller o va como gasto propio del courier, no como pasarela aparte. |

> Conteo en el código: ~50 referencias a **Fintoc**, 1 a Khipu. Fintoc es el PSP de facto hoy.

## COD (contra reembolso / cash on delivery) [CONFIRMAR]
- **No encontré nada de COD en el repo ni en los docs.** No hay tabla, enum ni flujo de
  efectivo contra entrega.
- Mercado Libre Flex en Chile opera con pago anticipado en la plataforma, así que para el caso
  Flex puro **COD no aplica**.
- **A confirmar:** ¿manejas COD hoy en el same-day fuera de ML (tienda propia / otros canales)?
  Si sí, es un módulo nuevo (recaudación de efectivo del conductor, cuadratura de caja,
  liquidación neteada contra lo recaudado) — hoy **no existe** y habría que diseñarlo.

## Resuelto
- **Suscripción del SaaS:** **no construido, queda para V2.** Hoy el MVP entrega el motor
  operativo-financiero del courier, pero **el cobro de Rutax al courier no está implementado**
  (modelo definido en docs: base mensual + variable por conductor activo, vía Flow/Webpay PatPass).

## Sin responder (a tu pedido)
- **COD** y resto de medios de pago del seller → quedan abiertos por decisión tuya.
