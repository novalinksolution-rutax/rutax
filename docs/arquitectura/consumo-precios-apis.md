# Precios de APIs externas — catálogo de referencia del módulo Consumo

> Verificado contra documentación oficial el **2026-09-09**. Alimenta la tabla de
> precios unitarios configurables del módulo Consumo (`src/app/admin/consumo`).
> **Tres errores fáciles que este doc previene:** (1) tratar Route Optimization
> como "por llamada" cuando se cobra **por parada**; (2) heredar el crédito de
> US$200/mes que **ya no existe** (Google lo retiró el 1-mar-2025); (3) fijar el
> precio de Chile de WhatsApp desde un agregador en vez del rate card oficial.

## Tabla (USD, 2026)

| Proveedor | Producto / SKU | Unidad de cobro | Precio (primer tramo) | Tier gratuito/mes | Fuente |
|---|---|---|---|---|---|
| Google Maps Platform | Route Optimization — **Single Vehicle Routing** (2020-AA6E-7D49) | **por parada/shipment** (1 vehículo/request) | **$10.00 / 1.000** | **5.000** | developers.google.com/maps/billing-and-pricing/pricing |
| Google Maps Platform | Route Optimization — **Fleet Routing** (08E0-0D24-6C8E) | por parada (≥2 vehículos/request) | $30.00 / 1.000 | 1.000 | idem |
| Google Maps Platform | Routes API — **Compute Routes Essentials** | por request | **$5.00 / 1.000** | **10.000** | idem |
| Google Maps Platform | Compute Routes **Pro** (Advanced) | por request | $10.00 / 1.000 | 5.000 | idem |
| Google Maps Platform | Compute Routes **Enterprise** (Preferred) | por request | $15.00 / 1.000 | 1.000 | idem |
| Google Maps Platform | **Geocoding API** (BAC8-4E68-E261) | por request | **$5.00 / 1.000** | **10.000** | idem |
| Meta WhatsApp Cloud API | Plantilla **marketing** (Chile) | por mensaje entregado | **~$0.0604** ⚠️ | ventana 24h + entry points 72h | developers.facebook.com/docs/whatsapp/pricing |
| Meta WhatsApp Cloud API | Plantilla **utility** (Chile) — *el aviso de retiro* | por mensaje entregado | **~$0.0077** ⚠️ | gratis en ventana 24h **hasta 30-sep-2026** | idem |
| Meta WhatsApp Cloud API | Plantilla **authentication** (Chile) | por mensaje entregado | ~$0.0077 ⚠️ | — | idem |
| Meta WhatsApp Cloud API | **Service** (iniciada por usuario) | conversación | $0.00 en 24h (**cambia 1-oct-2026**) | gratis | idem |
| Resend | Email — Free | por email | $0 | **3.000/mes, tope 100/día** | resend.com/pricing |
| Resend | Email — Pro | plan | $20/mes (50.000) | — | idem |
| Mercado Libre | API REST | por llamada | **$0.00 (gratis)** | N/A — solo límite de tasa (~1.500 req/min/seller) | developer.mercadolibre |

## Matices que gobiernan el modelo de datos

- **Google, modelo por-SKU (confirmado 2026).** Desde el 1-mar-2025 no hay crédito común de US$200: cada SKU trae su propio umbral gratuito mensual (Essentials 10k, Pro/Single-Vehicle 5k, Enterprise/Fleet 1k). El "dentro de tier gratuito" es **por producto**, no un pozo común. → El flag de free-tier se evalúa por proveedor/SKU y por mes.
- **Route Optimization se cobra POR PARADA.** Para el flujo de Rutax (1 conductor, ~25-30 paradas por corrida) el SKU es **Single Vehicle Routing** ($10/1.000 paradas, 5k gratis). Requests fallidos, `VALIDATE_ONLY` o shipments infactibles **no se cobran**. → La unidad de costo de ruteo es "paradas optimizadas", no "llamadas".
- **WhatsApp per-message (1-jul-2025).** Se cobra por mensaje de plantilla entregado, por categoría + país. El aviso de retiro es **utility** iniciada por el negocio → se cobra por mensaje. ⚠️ El número exacto de Chile vive en el rate card CSV/PDF de Meta (Chile factura en CLP desde 1-abr-2026 y puede tener tarifa dedicada); el ~$0.0077 es "Rest of World" y hay que confirmarlo antes de fijarlo.
- **Resend: el gatillo es el tope diario de 100**, no el mensual de 3.000.
- **Mercado Libre no tiene costo.** Modelar como "sin costo, con cuota de tasa" — nunca precio 0, que se confunde con "no medido". Sirve para "quién consume la cuota", no para dinero.

## Recomendación para la columna configurable

Guardar junto a cada precio: **fecha de verificación**, **unidad exacta** (parada vs request vs mensaje entregado), **umbral gratuito** y **su granularidad** (por-SKU/mes). Los precios cambian; el catálogo debe poder actualizarse sin migración.
