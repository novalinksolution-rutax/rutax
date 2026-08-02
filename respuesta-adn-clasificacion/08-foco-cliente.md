# 8. Foco de cliente

## Lo que el repo asume hoy [REPO]
- Cliente = **empresa de última milla (courier) en Santiago** que opera **Mercado Libre Flex +
  same-day**. El fundador **no opera entregas**, solo provee el software (SaaS neutral, B2B,
  multi-tenant).
- El producto soporta **dos tipos de pedido** desde el modelo de datos:
  - `flex` → ingestados vía ML (OAuth por seller, webhooks de shipments).
  - `same_day` → **ad-hoc**, creados a mano (por el courier o por el seller en el portal),
    **sin depender de ML**.
- O sea: **no es Flex puro**. El same-day fuera de ML ya está contemplado como pedido ad-hoc.

## Lo que NO está construido [REPO/limitación]
- **No hay integración con otros marketplaces** (Shopify, WooCommerce, Falabella, etc.) ni con
  tiendas propias. El same-day no-ML entra **manualmente**, no por integración.
- El único "puerto" de ingesta automática hoy es **Mercado Libre**.

## A confirmar contigo [CONFIRMAR]
1. ¿Tu cliente ideal es **courier Flex-first** (ML es el 80%+ de su volumen) o uno con mezcla
   real de canales (ML + tienda propia + otros marketplaces)?
2. Si hay same-day fuera de ML relevante: ¿necesitas **integraciones de ingesta** (Shopify/Woo/
   marketplaces) o basta con carga manual / CSV en el portal?
3. ¿El target es solo **Santiago/RM** o piensas en otras regiones (afecta catálogo de comunas,
   tarifas por zona)?
4. ¿Hay couriers que **no usan ML** en absoluto y que igual querrías como clientes? (cambiaría
   cuánto peso darle a la integración ML vs. al motor de dinero genérico).
