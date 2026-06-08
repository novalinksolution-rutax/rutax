# 3. Descubrimiento funcional

Construido desde los problemas. Prioridad: MVP (crítico), Crecimiento (importante) o Futura. El MVP cierra el lazo completo: traer entregas → saber su estado → asignarlas → registrar incidencias → convertirlas en factura y liquidación conciliadas.

## 3.1 Críticas (MVP)

| **Funcionalidad** | **Problema que resuelve** | **Usuario** | **Prioridad** |
| --- | --- | --- | --- |
| Multi-tenant (aislamiento) | Servir a muchos couriers sin que sus datos se crucen | Super-admin / dueño | MVP |
| Roles y permisos (RBAC) | Control diferenciado; aislamiento del seller | Dueño | MVP |
| Onboarding del courier | Arrancar sin fricción y dejar lo tributario listo (certificado + folios) | Dueño / admin | MVP |
| Gestión de tarifas | Tarifas “en la cabeza” o en Excel; alimenta el motor de dinero | Dueño / admin | MVP |
| OAuth del seller + onboarding del seller | Traer la data del seller sin carga manual | Seller | MVP |
| Ingesta Flex + panel multi-seller | Doble digitación, etiquetas por foto, paquetes fantasma | Supervisor / coordinador | MVP |
| Same-day ad-hoc (seller o courier) | Entregas particulares en el mismo flujo, con destino de facturación | Seller / courier | MVP |
| Asignación a conductores + manifiesto | Coordinación por WhatsApp; dependencia de personas clave | Coordinador | MVP |
| Salud de conexiones ML + reconexión + backfill | Desvinculaciones silenciosas que cortan ingesta y fugan margen | Courier / seller | MVP |
| Sincronización de estados (API Flex) | Revisar la app de Flex pedido por pedido | Supervisor / dueño | MVP |
| Gestión de incidencias | Incidencias dispersas; reintentos costosos; reputación del seller | Supervisor / seller | MVP |
| Motor entrega→dinero (núcleo) | Cuadre manual a fin de mes; fuga de margen | Administración / dueño | MVP |
| Facturación al seller (vía proveedor DTE) | Facturar a decenas de sellers a mano | Administración | MVP |
| Liquidación de conductores | Pagos errados, disputas, horas administrativas | Administración / conductor | MVP |
| Vista de conductor (web/PWA) | Que la asignación llegue sin WhatsApp | Conductor | MVP |
| Dashboard operativo del dueño | Decidir a ciegas | Dueño | MVP |
| Portal del seller (básico) | El seller llama/escribe por WhatsApp para todo | Seller | MVP |

## 3.2 Importantes (crecimiento)

| **Funcionalidad** | **Problema que resuelve** | **Usuario** | **Prioridad** |
| --- | --- | --- | --- |
| Cobranza + conciliación bancaria (Fintoc/Khipu) | Cobros perdidos, descuadres, morosidad no detectada | Administración | Crecim. |
| App de conductor nativa | Fricción operativa del conductor | Conductor | Crecim. |
| Reportería ejecutiva avanzada | El dueño depende de que “alguien le cuente” | Dueño | Crecim. |
| Protección proactiva de reputación del seller | El seller se va si fallas la promesa Flex | Seller / dueño | Crecim. |
| Integración de ruteo | Mejor uso de flota sin construir un ruteador | Coordinador | Crecim. |
| Notificaciones al consumidor final | Tiempo del equipo respondiendo “¿dónde está?” | Consumidor | Crecim. |
| Gestión de disponibilidad de conductores | Sobre/sub-dotación; rutas sin cubrir | Supervisor | Crecim. |
| Portal del seller avanzado | Reduce soporte del courier al seller | Seller | Crecim. |

## 3.3 Futuras (V3 / expansión)

- Multicanal: Falabella Directo + e-commerce propio (Shopify, Tiendanube, WooCommerce, VTEX) en la misma operación y cobranza.

- Expansión a otras ciudades de Chile y LATAM (Flex existe en muchas ciudades).

- Integración DTE propia, si el volumen lo justifica (reemplazar al proveedor por margen/control).

- IA donde reduzca trabajo real: normalizar direcciones, predecir ausencias, asignación inteligente.

**No incluido a propósito: **ruteador de optimización propio de clase mundial (integrar, no construir), reemplazo de la app de Flex (técnicamente imposible) y cualquier lógica de marketplace/comisión.
