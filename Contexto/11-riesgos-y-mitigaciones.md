# 10. Riesgos y mitigaciones

| **Tipo** | **Riesgo** | **Mitigación** |
| --- | --- | --- |
| Técnico | API de ML: estados incompletos o conexiones que se caen | Diseño resiliente + monitor de salud de conexiones + reconexión asistida + backfill (RF-013–017) |
| Técnico | Fallo del refresco de tokens deja sellers sin sincronizar | Jobs gestionados con reintentos + alertas tempranas + sondeo de respaldo |
| Técnico | Manejo de certificados y secretos de terceros | Cifrado dedicado, acceso auditado, fuera de logs (RNF-02) |
| Técnico | Brecha de aislamiento entre couriers | RLS a nivel de base de datos + tests automáticos de aislamiento |
| Técnico | Dependencia del proveedor DTE | Patrón adaptador: migrar de proveedor o construir propio sin tocar el núcleo |
| Técnico | Alcance del MVP grande para un solo dev | Roadmap fásico (A→B→C), comprar la cañería (DTE), agentes de IA (cap. 11) |
| Operativo | Fricción de las dos apps (conductor) | Minimizar lo que el conductor hace en la app propia; el valor está en oficina |
| Operativo | Tarifas/datos mal cargados por el courier | Validaciones, valores por defecto y previsualización antes de facturar |
| Comercial | Incumbente E-Courier (Flex+Falabella) | Diferenciar en la capa de dinero y en simplicidad/precio; no clonar el ruteo |
| Comercial | Sustituto gratis (Excel/WhatsApp) | ROI evidente + onboarding sin fricción; no apuntar a los más informales |
| Comercial | PyME frágil, churn alto, concentración | Costos de cambio sanos (datos financieros/SII), planes accesibles, diversificar |
| Comercial | Mercado Santiago-Flex pequeño | Roadmap de expansión multicanal/multiciudad (V3) |
| Regulatorio | Ley 21.431 (conductores de plataforma) | El software registra tipo de relación y protege datos del conductor; no empuja informalidad |
| Regulatorio | Protección de datos personales | Consentimiento, minimización, cifrado, portabilidad (RNF-13) |
| Regulatorio | Cada courier debe ser emisor DTE autorizado por el SII | Onboarding que lo asegura + proveedor certificado bajo el RUT del courier |
| Financiero | Construir sin validación por entrevistas (decisión del fundador) | Validar con pilotos pagados antes de invertir fuerte; roadmap fásico limita el gasto inicial |
| Financiero | El costo de servir (DTE/transacciones) se come el margen | Modelo de cupo incluido + excedente; calibrar con datos de pilotos |
| Financiero | CAC alto en venta consultiva + caja de bootstrap | Referidos/comunidad de couriers; plan anual con descuento |
