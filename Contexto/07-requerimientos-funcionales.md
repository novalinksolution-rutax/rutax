# 6. Requerimientos funcionales

**Prioridad: **P0 = cimiento del MVP · P1 = núcleo de valor del MVP · C = crecimiento (V2) · F = futura (V3).

### 6.1 Plataforma, seguridad base y cuentas

| **ID** | **Requerimiento** | **Usuario** | **Prio** |
| --- | --- | --- | --- |
| RF-001 | Multi-tenant con aislamiento lógico: ningún dato cruza entre couriers | Super-admin / dueño | P0 |
| RF-002 | RBAC: roles diferenciados (super-admin, dueño, supervisor, coordinador, admin, conductor, seller) | Dueño | P0 |
| RF-003 | Aislamiento del seller: solo accede a sus propios datos | Sistema | P0 |
| RF-004 | Registro de auditoría de acciones sensibles (financieras, de acceso, configuración) | Sistema / dueño | P0 |
| RF-005 | Gestión de usuarios e invitaciones internas | Dueño | P0 |
| RF-006 | Alta de courier (tenant): datos de empresa, RUT, configuración inicial | Super-admin / dueño | P0 |
| RF-007 | Carga cifrada del certificado digital del courier (para DTE) | Dueño / admin | P0 |
| RF-008 | Conexión al proveedor DTE y gestión de folios (CAF), delegada al proveedor | Dueño / admin | P0 |
| RF-009 | Gestión de tarifas: por seller, por tipo de entrega y/o zona | Dueño / admin | P0 |
| RF-010 | Invitación y onboarding del seller | Seller | P0 |

### 6.2 Integración Mercado Libre y salud de conexiones

| **ID** | **Requerimiento** | **Usuario** | **Prio** |
| --- | --- | --- | --- |
| RF-011 | OAuth del seller con ML (cuenta principal); guardado seguro de tokens | Seller | P0 |
| RF-012 | Refresco automático de tokens en segundo plano antes de expirar | Sistema | P0 |
| RF-013 | Monitoreo de salud de conexiones por seller (sana / atención / desvinculada / pendiente) + última sync | Courier | P1 |
| RF-014 | Alertas proactivas de desvinculación al courier (y opcional al seller) | Courier / seller | P1 |
| RF-015 | Re-vinculación self-service de un clic (guiando a cuenta principal) | Seller | P1 |
| RF-016 | Empujón de reconexión iniciado por el courier (enviar link al seller caído) | Courier | P1 |
| RF-017 | Backfill: recuperar pedidos generados durante la caída al reconectar | Sistema | P1 |

### 6.3 Pedidos: ingesta y same-day

| **ID** | **Requerimiento** | **Usuario** | **Prio** |
| --- | --- | --- | --- |
| RF-018 | Ingesta automática de pedidos Flex (eventos + sondeo de respaldo) | Sistema | P1 |
| RF-019 | Panel multi-seller consolidado de todos los pedidos | Supervisor / coordinador | P1 |
| RF-020 | Creación de same-day ad-hoc (seller o courier) con destino de facturación (seller o gasto propio) | Seller / courier | P1 |
| RF-021 | Obtención de etiquetas desde el sistema (vía API) | Supervisor | P1 |

### 6.4 Operación: asignación, estados e incidencias

| **ID** | **Requerimiento** | **Usuario** | **Prio** |
| --- | --- | --- | --- |
| RF-022 | Asignación de pedidos por zona/conductor | Coordinador | P1 |
| RF-023 | Reasignación ante falla de un conductor | Coordinador | P1 |
| RF-024 | Generación de manifiesto / hoja de ruta | Coordinador | P1 |
| RF-025 | Ruteo básico (orden sugerido); integración con ruteador externo | Coordinador | P1 / C |
| RF-026 | Sincronización de subestados desde API Flex (entregado, ausente, etc.) | Sistema | P1 |
| RF-027 | Registro y clasificación de incidencias (ausente, dirección, reagendo) | Supervisor / seller | P1 |
| RF-028 | Acciones de incidencia que protegen la reputación del seller | Supervisor | P1 |
| RF-029 | Corrección manual de estado cuando la API no lo provee (resiliencia) | Supervisor / admin | P1 |

### 6.5 Motor entrega→dinero

| **ID** | **Requerimiento** | **Usuario** | **Prio** |
| --- | --- | --- | --- |
| RF-030 | Línea de cobro al seller por cada entrega, según tarifa | Sistema / admin | P1 |
| RF-031 | Línea de liquidación al conductor por cada entrega | Sistema / admin | P1 |
| RF-032 | Reglas de incidencia (no cobrar reintentos dobles, no pagar devoluciones, etc.) | Sistema | P1 |
| RF-033 | Conciliación entregado-vs-facturado | Admin / dueño | P1 |
| RF-034 | Same-day como gasto propio del courier (sin facturar a seller) | Sistema | P1 |

### 6.6 Facturación (DTE) y liquidación de conductores

| **ID** | **Requerimiento** | **Usuario** | **Prio** |
| --- | --- | --- | --- |
| RF-035 | Factura del período por seller (consolida Flex + same-day) | Admin | P1 |
| RF-036 | Emisión del DTE vía proveedor, bajo el RUT del courier | Admin | P1 |
| RF-037 | Disponibilización y descarga del DTE para el seller | Admin / seller | P1 |
| RF-038 | Notas de crédito / ajustes | Admin | C |
| RF-039 | Cálculo de liquidación por conductor (formal e informal) | Admin | P1 |
| RF-040 | Boleta de terceros para conductores formales (vía proveedor) | Admin | C |
| RF-041 | Registro interno de liquidación para informales (sin documento) | Admin | P1 |
| RF-042 | Visibilidad de la liquidación para el propio conductor | Conductor | P1 |

### 6.7 Cobranza, conciliación y estados de cuenta

| **ID** | **Requerimiento** | **Usuario** | **Prio** |
| --- | --- | --- | --- |
| RF-043 | Estado de cuenta / cartola por seller | Admin / seller | P1 / C |
| RF-044 | Conciliación entregado-facturado-pagado (Fintoc/Khipu) | Admin | C |
| RF-045 | Alertas de morosidad | Admin / dueño | C |

### 6.8 Portales, dashboards, reportería y notificaciones

| **ID** | **Requerimiento** | **Usuario** | **Prio** |
| --- | --- | --- | --- |
| RF-046 | Dashboard operativo del dueño (comprometido vs entregado, conductores listos/activos, paquetes por comuna, rezagados de ayer, incidencias, salud de conexiones, alertas) | Dueño | P1 |
| RF-047 | Vista de conductor (ruta/manifiesto, instrucciones, su liquidación) | Conductor | P1 |
| RF-048 | Portal del seller básico (envíos, tracking, incidencias, estado de cuenta, solicitar same-day, reconectar) | Seller | P1 |
| RF-049 | Reportería ejecutiva avanzada (SLA, costo/ingreso, rendimiento por conductor/seller) | Dueño | C |
| RF-050 | Notificaciones internas (alertas operativas, incidencias, conexiones) | Courier | P1 |
| RF-051 | Notificaciones al consumidor final (link de tracking) | Consumidor | C |
