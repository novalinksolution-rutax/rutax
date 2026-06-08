# 4. Usuarios y permisos

| **Rol** | **Responsabilidades e información** | **Acciones** | **Permisos** |
| --- | --- | --- | --- |
| Super-admin de plataforma (fundador) | Operar la plataforma, alta de tenants, soporte, salud del sistema | Crear/suspender couriers, configurar planes, soporte | Globales; acceso a datos de negocio del courier limitado y auditado |
| Dueño/Gerente del courier | Máximo control de su empresa; decide la compra; ve todo su tenant | Configurar tarifas, gestionar usuarios y roles, ver reportes, aprobar facturación | Totales dentro de su tenant |
| Supervisor operacional | Armar y vigilar la operación del día | Confirmar/ajustar operación, gestionar incidencias, reasignar | Operativos; sin config financiera ni usuarios |
| Coordinador de tráfico | Asignar y reasignar; rutas | Asignar/reasignar, generar manifiestos | Solo asignación operativa |
| Administración / Contabilidad | La capa de dinero | Emitir facturas (vía proveedor), generar liquidaciones, gestionar cobranza | Financieros; sin reasignación operativa |
| Conductor | Ejecutar entregas; su ruta y su liquidación | Ver ruta, marcar evidencias internas, confirmar manifiesto | Solo sus propios datos |
| Seller (cliente del courier) | Gestionar sus envíos como cliente | Conectar OAuth, solicitar same-day, ver/descargar DTE, seguir incidencias | Estrictamente acotado a sus datos |
| Consumidor final (destinatario) | Ver el estado de su entrega | Recibir notificaciones / tracking | Sin login ni permisos |

**Principios transversales: **aislamiento duro entre couriers; el seller solo ve lo suyo; el conductor solo ve lo suyo; traza de auditoría en acciones sensibles, reforzada por la protección de datos del conductor que exige la Ley 21.431.
