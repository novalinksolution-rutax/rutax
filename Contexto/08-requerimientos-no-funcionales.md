# 7. Requerimientos no funcionales

| **ID** | **Categoría** | **Requerimiento** |
| --- | --- | --- |
| RNF-01 | Multiempresa | Aislamiento entre couriers garantizado a nivel de base de datos (no solo de aplicación) |
| RNF-02 | Seguridad | Cifrado en tránsito y en reposo; certificados y tokens cifrados, acceso auditado, nunca en logs |
| RNF-03 | Multiusuario / RBAC | Permisos por rol verificados en el backend; seller y conductor solo acceden a lo propio |
| RNF-04 | Auditoría y trazabilidad | Bitácora inmutable de acciones financieras y de acceso (quién, qué, cuándo) |
| RNF-05 | Integraciones (resiliencia) | Reintentos con backoff, idempotencia, manejo de límites de tasa, webhooks + sondeo de respaldo |
| RNF-06 | Rendimiento | Dashboard y panel multi-seller cargan en pocos segundos con cientos de pedidos/día |
| RNF-07 | Escalabilidad | Crecer de decenas a cientos de couriers sin rediseño; procesos pesados como jobs |
| RNF-08 | Disponibilidad | Disponible en la ventana operativa (corte ~12–13 h; entregas ~15–21 h); degradación elegante |
| RNF-09 | Respaldo y recuperación | Respaldos automáticos; capacidad de restaurar; no perder datos financieros |
| RNF-10 | Observabilidad | Monitoreo de errores y salud de jobs e integraciones (incl. conexiones ML) con alertas |
| RNF-11 | Mobile y web | Oficina y portales en web responsive; conductor usable en móvil (PWA en MVP, nativa en V2) |
| RNF-12 | Localización | CLP, español, zona horaria de Chile, validación de RUT, formatos locales |
| RNF-13 | Protección y portabilidad de datos | Cumplir protección de datos personales (incl. datos de conductores, Ley 21.431); permitir exportar los datos del cliente |
