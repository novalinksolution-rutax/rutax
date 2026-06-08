# 2. Modelo de negocio (dirección estratégica)

## 2.1 Qué tipo de producto

La mejor descripción es un SaaS B2B vertical: una “plataforma de gestión operativo-financiera para couriers de última milla”, multi-tenant (muchos couriers aislados entre sí) y multi-rol (dashboard del dueño + portal del seller + app del conductor). Toma funciones operativas tipo TMS (ingesta, asignación, tracking, incidencias) como mesa de entrada, pero el diferenciador es el núcleo financiero (motor entrega→dinero), de ADN ERP pero vertical y angosto.

**No es: **marketplace (no hay matching por comisión ni monetización de transacciones), ni CRM, ni WMS, ni “otro ruteador” (commoditizado; integrar, no competir), ni un ERP general.

## 2.2 Propuesta de valor

Una sola plataforma que conecta la operación del courier con su dinero: cada entrega se convierte, sola, en su línea de factura al seller y su línea de liquidación al conductor, con conciliación.

- **Qué resuelve: **reemplaza Excel + WhatsApp + llamadas + revisar la app de Flex pedido por pedido; ingesta automática (Flex vía OAuth del seller + same-day ad-hoc), asignación, incidencias y cierre financiero automático.

- **Para quién: **PyMEs de última milla formales de Santiago que agregan sellers de ML Flex; el dueño está metido en el día a día gestionando flota, envíos y contratiempos.

- **Beneficio principal: **cierra la fuga de margen (entregas no cobradas, liquidaciones mal calculadas) y recupera horas administrativas (cierre de mes de días a horas). La defensibilidad nace de los costos de cambio en los datos de dinero.

## 2.3 Segmentos de cliente

- **Cliente pagador: **el courier (firma la suscripción).

- **Administrador / decisor de compra: **dueño/gerente del courier (usuario principal del dashboard).

- **Operadores (uso diario): **supervisor, coordinador de tráfico, administración/contabilidad.

- **Conductores: **usuarios de la app móvil del courier.

- **Usuario final (cliente del courier): **el seller —principalmente de ML Flex— que conecta su cuenta por OAuth, ve tracking, incidencias y su estado de cuenta, y solicita same-day ad-hoc.

- **Consumidor/destinatario: **no paga ni gestiona; a lo más recibe notificaciones/tracking. No es un segmento de cliente.

## 2.4 Modelo de ingresos

Ingreso único por suscripción recurrente. El same-day ad-hoc no es un pago aparte: se suma a las entregas del período y lo factura el courier al seller junto con sus Flex (cierre semanal o mensual). El fundador no cobra comisión por entrega.

**Estructura acordada:**

- **Base + variable por conductor activo. **Un piso mensual por cuenta más un valor por cada conductor que tuvo al menos una entrega asignada/procesada en el período (“activo” anclado a datos reales, difícil de inflar a la baja). Captura el crecimiento por la vía sana, sin “impuesto al volumen” de paquetes.

- **Planes por funcionalidad. **El plan de entrada lleva lo operativo (ingesta, asignación, tracking, incidencias) para ganarle a “Excel + ruteador barato”; el motor entrega→dinero + conciliación + reportería va en el plan superior (land-and-expand).

- **Costos variables como cupo incluido + excedente. **Cada plan trae una bolsa de documentos DTE y transacciones de cobranza; sobre eso, un excedente que cubra el costo con margen modesto. Es la única pieza que escala con volumen, pero legítima (se cobra por un servicio efectivamente prestado).

- **Plan anual con descuento **para mejorar caja y reducir churn.

- **Fee por entrega: reservado **solo como posible ajuste futuro si los pilotos muestran couriers con igual número de conductores pero volúmenes muy distintos.

**Nota: **los montos exactos de cada plan se calibran con disposición de pago real (pilotos) y con el costo de servir. Referencias de mercado para orden de magnitud: SimpliRoute ≈ US$40/vehículo/mes; E-Courier por conductor o mensualidad fija.
