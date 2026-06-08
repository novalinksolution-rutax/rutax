# Levantamiento — SaaS última milla (couriers Flex) · Santiago

> Convertido a `docs/levantamiento.md` desde `Contexto/` (commit inicial) para que el `@`-referencing de `CLAUDE.md` funcione (`@docs/levantamiento.md`). Contenido idéntico al original, solo concatenado en orden de lectura; ver `Contexto/INDICE.md` para el mapa de archivos fuente.

---

# Levantamiento · SaaS última milla (couriers Flex) · Santiago

**DOCUMENTO DE LEVANTAMIENTO DE PROYECTO**

**SaaS de gestión operativo-financiera**

**para empresas de última milla (couriers Mercado Libre Flex)**

*Product Discovery y especificación de producto · Región Metropolitana de Santiago, Chile*

Consolidación de las Etapas 1 y 2 del levantamiento (comprensión, modelo, descubrimiento funcional, usuarios, procesos y especificación técnica).

| **Campo** | **Detalle** |
| --- | --- |
| Preparado para | Fundador/a que construirá el SaaS (perfil bootstrapped, desarrollo con asistencia de IA / vibecoding) |
| Tipo de producto | SaaS B2B vertical, neutral, multi-tenant — software para couriers; el fundador no opera entregas |
| Mercado objetivo | Santiago de Chile · Mercado Libre Flex como ancla + same-day ad-hoc desde la propia plataforma |
| Cliente que paga | PyME de última milla formal (emite factura), flota de 5–50 conductores (núcleo 8–20) |
| Modelo de ingresos | Suscripción recurrente como ingreso único (híbrido base + por conductor activo) |
| Método | Investigación de escritorio + razonamiento estructurado + iteración con el fundador. Sin entrevistas primarias (decisión del fundador) |
| Fecha | Junio de 2026 |

*Nota: las cifras de mercado y de dimensionamiento son estimaciones y supuestos; deben validarse con pilotos pagados antes de invertir fuerte. Tipo de cambio referencial ≈ CLP 950 por USD (fluctúa).*

# Contenido

*En Word: clic derecho sobre la tabla › Actualizar campos, para numerar las páginas.*


---

# 0. Alcance y método

Este documento consolida un levantamiento de producto realizado de forma consultiva: primero entender, luego preguntar, después diseñar. No es un encargo de ingeniería ni un plan de implementación; es la base estructurada para decidir qué construir y en qué orden.

**Naturaleza de la evidencia. **El levantamiento partió de un informe de mercado previo (investigación de escritorio sobre Mercado Libre Flex, e-commerce en Chile y competidores) y se refinó iterando con el fundador. Por decisión del fundador no se realizaron entrevistas primarias; en consecuencia, las hipótesis de dolor y disposición de pago se consideran no confirmadas y se recomienda validarlas con pilotos. Las afirmaciones sobre regulación chilena (Ley 21.431, facturación electrónica del SII), proveedores de pago/DTE y la API de Mercado Libre fueron verificadas contra fuentes públicas actuales (Anexo C).

**Decisión de partida (corrección clave del alcance). **El fundador construye y vende software neutral a couriers; no opera entregas, no tiene flota y no es courier. La función de “solicitar same-day” dentro de la plataforma es una capacidad para que el courier (y sus sellers) gestione entregas particulares, no una operación logística del fundador.


---

# 1. Resumen ejecutivo

**El dolor pagable no está en el ruteo, sino en la trastienda de dinero. **El ruteo, el tracking y el POD están commoditizados (SimpliRoute, Beetrack, Drivin) y existe un incumbente vertical en Flex+Falabella (E-Courier). Donde el courier sangra margen y pierde horas es en convertir cada entrega en su factura al seller y su liquidación al conductor, y en conciliar lo entregado contra lo facturado y lo pagado. Eso sigue ocurriendo en Excel, WhatsApp y llamadas.

**La cuña diferenciadora es el “motor entrega→dinero”. **Es la capa que, ante cada cambio de estado de una entrega, genera automáticamente la línea de cobro al seller (según tarifa), la línea de liquidación al conductor, aplica las incidencias y deja todo conciliado, usando un único dato de origen (los estados de la API de Flex y del same-day propio).

**La restricción dura define el techo. **La app de Mercado Envíos Flex es obligatoria para escanear y completar entregas y no es integrable. El software orquesta alrededor de ella; nunca la reemplaza. El conductor convive con dos apps y eso debe minimizarse, no negarse.

**Veredicto: GO condicionado y angosto. **Es un negocio de nicho bootstrapped viable y defendible (defensibilidad vía costos de cambio en los datos de dinero, relevantes además para el SII). Alcanza escala de interés para un inversionista solo si se expande más allá de Santiago/Flex. La condición pendiente —por decisión del fundador, sin entrevistas— es validar con pilotos pagados que el dolor financiero-administrativo es agudo y pagable antes de invertir fuerte.


---

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


---

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


---

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


---

# 5. Diseño de procesos (AS-IS → TO-BE)

## 5.1 Los seis procesos clave

### 1. Ingesta / creación de pedidos

**AS-IS: **El seller avisa por WhatsApp; fotos de etiquetas; carga manual en Excel; el same-day se coordina por llamada.

**TO-BE: **Los Flex entran solos vía API (OAuth del seller); el same-day se crea en la plataforma (por seller o courier) con su destino de facturación definido.

### 2. Asignación a conductores

**AS-IS: **Mapa mental del coordinador + Excel + grupos de WhatsApp; conocimiento tácito, no transferible.

**TO-BE: **Asignación por zona/conductor en el sistema con manifiesto generado; las reglas quedan en la plataforma, no en una persona.

### 3. Ejecución, estados e incidencias

**AS-IS: **El conductor escanea/entrega en la app de Flex; las incidencias se reportan por WhatsApp/llamada/notas.

**TO-BE: **El escaneo/POD sigue en la app de Flex (obligatorio); la plataforma sincroniza el estado y captura/clasifica la incidencia con trazabilidad.

### 4. Facturación al seller

**AS-IS: **A fin de mes, Excel + sistema de boletas aparte; 6–16 h/mes; entregas que se escapan sin cobrar.

**TO-BE: **El motor arma las líneas según lo realmente entregado; el courier emite el DTE al seller desde la plataforma (vía proveedor, bajo su RUT).

### 5. Liquidación de conductores

**AS-IS: **Excel + WhatsApp; semanal/quincenal; disputas y errores; rotación si se paga mal.

**TO-BE: **Liquidación calculada por entrega (formal con boleta de terceros; informal con registro interno); el conductor la ve; el pago lo hace el courier por fuera.

### 6. Cobranza y conciliación

**AS-IS: **Excel, banco, correo; descuadres; morosidad que se descubre tarde.

**TO-BE: **MVP: conciliación entregado-vs-facturado. Crecimiento: cobranza por transferencia con conciliación automática del pagado (Fintoc/Khipu) y alertas de morosidad.

## 5.2 Cuellos de botella, riesgos y automatizaciones

- **Cuellos de botella: **dependencia de personas clave; cierre de mes manual; incidencias dispersas en WhatsApp; doble digitación de pedidos.

- **Riesgo de diseño principal: **la dependencia de la API de Flex (estados incompletos/tardíos y desvinculaciones). Mitigación: tratar el estado como dato que puede faltar, permitir corrección manual, no bloquear el cierre, y el monitor de salud de conexiones con reconexión y backfill.

- **Automatizaciones futuras: **normalización de direcciones, predicción de ausencias, sugerencia de asignación por carga/zona, alertas tempranas de seller en riesgo de reputación.


---

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


---

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


---

# 8. Arquitectura recomendada

La restricción que manda es que lo construye una persona con asistencia de IA (vibecoding). Cada decisión prioriza poco que operar, mucho respaldo en datos de entrenamiento de IA, y garantías fuertes donde el riesgo es alto (aislamiento y dinero).

- **Monolito modular, no microservicios. **Más rápido de construir y depurar para un solo dev; se parte más adelante si hace falta.

- **TypeScript end-to-end. **Un solo lenguaje; de lo mejor cubierto por la IA.

- **Frontend: Next.js (React) + Tailwind + shadcn/ui. **Stack mainstream; componentes listos aceleran dashboards y portales.

- **Base de datos: PostgreSQL con Row-Level Security (RLS). **Hace cumplir el aislamiento entre couriers y del seller a nivel de base de datos: la decisión arquitectónica más importante del proyecto.

- **Plataforma backend: Supabase **(Postgres gestionado + Auth + Storage + RLS + funciones), o alternativa Next.js + Postgres gestionado (Neon/Railway) + Auth.js. “Baterías incluidas” reduce lo que se construye y opera en solitario.

- **Jobs en segundo plano: orquestador gestionado **(Inngest o Trigger.dev, o cron de Supabase). El refresco de tokens, la ingesta, el sondeo de salud de conexiones y la generación de liquidaciones/facturas necesitan reintentos e idempotencia confiables (corazón de RNF-05).

- **Secretos/certificados: cifrado dedicado **(secrets manager o columna cifrada con clave gestionada), separado de los datos de negocio.

- **App de conductor: PWA/web responsive en MVP, **React Native/Expo (nativa) en V2.

- **Hosting: Vercel + Supabase. **Gestionados y vibecoding-friendly; cero servidores que administrar.

- **Integraciones como adaptadores aislados: **un “puerto” por servicio externo (ML, DTE, pagos), para cambiar proveedor —o construir el propio a futuro— sin reescribir el núcleo.

## 8.1 Servicios externos

| **Servicio** | **Recomendación / nota** |
| --- | --- |
| Mercado Libre API | OAuth por seller, /shipments (estados/subestados), asignación de transportista, etiquetas. La app de escaneo/POD NO es integrable. |
| Proveedor DTE (recomendado: integrar, no construir) | Candidato líder: SimpleFactura / SimpleAPI (Chilesystems) — API REST con SDKs, pensada para multiempresa (concentra varias razones sociales; puede gestionar la certificación). Alternativa fuerte: Openfactura (Haulmer), certificado por el SII con sandbox gratuito. Criterios: multiempresa real, costo por documento, delegación de certificación/folios, límites de tasa, sandbox. |
| Cobranza con conciliación | Fintoc o Khipu (transferencia + conciliación automática) — ataca directo el dolor de cuadre. (V2) |
| Suscripción del SaaS | Flow (suscripciones nativas) o Webpay PatPass. |
| Notificaciones / email | Servicio tipo Resend. |
| Observabilidad | Sentry + logs. |


---

# 9. Roadmap de desarrollo

Ordenado por impacto y por dependencia técnica, que aquí coincide con el orden correcto de go-to-market: entrar por la operación, retener con el dinero.

## 9.1 MVP (V1) — en tres fases secuenciadas

**Fase A · Cimiento (P0). **Multi-tenant + RLS, RBAC, onboarding del courier (certificado + proveedor DTE + folios), tarifas, OAuth del seller + refresco de tokens. Sin valor visible aún, pero todo se apoya aquí.

**Fase B · Operación y lazo de datos (P1). **Ingesta Flex + panel multi-seller, same-day ad-hoc, asignación + manifiesto, sincronización de estados, incidencias, salud de conexiones + reconexión + backfill, dashboard del dueño, vista de conductor, portal del seller básico. Aquí el courier ya corre su día en la plataforma (gana adopción y produce el dato).

**Fase C · Motor entrega→dinero (P1, diferenciador). **Líneas de cobro/liquidación, reglas de incidencia, conciliación entregado-vs-facturado, facturación DTE al seller, liquidación de conductores. Monetiza el dato de la Fase B y crea los costos de cambio.

**El orden es forzado: **C necesita el dato de B y B necesita el aislamiento de A; además es la mejor secuencia comercial.

## 9.2 V2 — Crecimiento

Cobranza + conciliación bancaria (Fintoc/Khipu), app de conductor nativa, reportería ejecutiva avanzada, protección proactiva de reputación, integración de ruteo, notificaciones al consumidor, portal del seller avanzado. Sube ARPA y profundiza retención sobre una base ya adoptada.

## 9.3 V3 — Expansión

Multicanal (Falabella + e-commerce propio), otras ciudades/LATAM, evaluación de DTE propio si el volumen lo justifica, e IA donde reduzca trabajo real. Única vía a escala relevante y a reducir la dependencia de Flex-Santiago.


---

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


---

# 11. Plan de construcción con agentes de IA (vibecoding)

Para construir con asistencia de IA, conviene combinar tres mecanismos de Claude Code. No es “skill vs agente”: los roles van como subagentes, el conocimiento compartido como skills, y el contexto del proyecto en CLAUDE.md.

## 11.1 Los tres mecanismos

- **Subagente = trabajador especializado con su propio contexto. **Archivo Markdown con frontmatter YAML (name, description, tools opcionales) más un system prompt, en .claude/agents/ (proyecto) o ~/.claude/agents/ (usuario). Corre en su propia ventana de contexto, con sus propias herramientas y permisos. Es tu “mini-agente con un rol”.

- **Skill = manual reutilizable que cualquier agente carga cuando lo necesita. **Carpeta con un SKILL.md (frontmatter name + description) y, opcional, scripts/recursos, en .claude/skills/ (proyecto) o ~/.claude/skills/ (personal). Es conocimiento que se inyecta, no un trabajador.

- **CLAUDE.md = memoria del proyecto **que todos leen primero (decisiones de arquitectura, convenciones, reglas no-negociables). Corto (~20–30 líneas); no autogenerar con /init.

**Por qué un rol va como subagente y no como skill: **un rol necesita contexto aislado, un set acotado de herramientas y una persona persistente — justo lo que da el subagente.

## 11.2 Cómo crearlos

- Trabajar en Claude Code (CLI o app de escritorio): es la superficie donde existen los subagentes.

- Crear un CLAUDE.md raíz con el contexto (resumen de este levantamiento + stack + reglas duras: RLS obligatoria, nada de secretos en logs, etc.). Corto.

- Subagentes: usar el comando /agents (recomendado por Anthropic) en ámbito de proyecto y dejar que lo genere, o crearlos a mano en .claude/agents/<nombre>.md. Commitearlos al repo.

- Skills: crear .claude/skills/<nombre>/SKILL.md con su frontmatter e instrucciones (+ scripts opcionales). Commitearlas.

- Reiniciar la sesión para cargar subagentes o carpetas nuevas.

**Tip clave: **el único canal del agente principal al subagente es el texto del prompt; el subagente arranca con contexto fresco, así que pásale explícitamente rutas, decisiones y criterios de aceptación.

## 11.3 Redactar el prompt de cada agente (apoyado en skills)

Cada subagente debe crearse en pro de la elaboración del proyecto, no genérico. Al redactar su system prompt, apóyate de buenas prácticas de prompting (por ejemplo, la skill de optimización de prompts) para convertir las responsabilidades del rol —tomadas de este documento— en una instrucción tuneada. Cada prompt de agente debería incluir:

- Rol y objetivo claros (qué hace y qué NO hace).

- Contexto del proyecto (referencia a CLAUDE.md: stack, modelo de datos, reglas duras).

- Las skills que debe aplicar (p. ej. flex-ml, chile-dte, multitenant-rls).

- Herramientas permitidas acotadas a su tarea.

- Definición de hecho (qué entrega y qué pruebas debe pasar).

**Advertencia: **no enchufes skills genéricas de internet sin leerlas; una skill genérica puede contradecir tus convenciones y bajar la calidad. Toma inspiración de las públicas y reescríbelas para tu repo.

## 11.4 Mapa de roles (subagentes) y conocimiento (skills)

**Subagentes (roles): **Arquitecto · BD/RLS · Backend · Integraciones · Frontend · QA · UX/UI · Seguridad/Cumplimiento · Copywriter · DevOps.

**Skills (conocimiento compartido — escríbelo una vez):**

- **flex-ml **— OAuth por seller, refresco de tokens, estados de envío, salud de conexiones, restricción de la app no integrable.

- **chile-dte **— emitir DTE vía proveedor bajo el RUT del courier, certificado/folios, notas de crédito, boleta de terceros.

- **multitenant-rls **— patrones de RLS en Postgres para aislar tenant + seller.

- **motor-entrega-dinero **— reglas de cobro/liquidación/conciliación e incidencias (lógica crítica, consistente entre agentes).

- **pagos-chile **— Fintoc/Khipu (conciliación) y Flow/Webpay (suscripción).

## 11.5 Ejemplo de subagente

Archivo .claude/agents/integraciones.md:

---

name: integraciones

description: Úsalo para toda integración externa — Mercado Libre

  (OAuth por seller, estados, etiquetas, refresco de tokens, salud

  de conexiones), proveedor DTE y pasarelas de pago.

tools: Read, Edit, Bash, WebFetch

---

Eres el especialista en integraciones del proyecto. Reglas:

- Cada servicio externo es un adaptador detrás de un "puerto";

  el núcleo no depende del proveedor.

- ML: OAuth con la cuenta principal del seller; refresco de tokens

  en jobs; webhooks + sondeo de respaldo; respeta límites de tasa.

- Aplica las skills flex-ml, chile-dte y pagos-chile.

- Nunca registres tokens ni certificados en logs.

Entrega: código + pruebas de resiliencia (reintentos, idempotencia)

+ notas.

**Nota de superficie: **todo esto vive en Claude Code; los subagentes son una función de Claude Code. Las skills también funcionan en claude.ai (se suben como zip en Configuración › Funciones, en planes con ejecución de código). Los “agent teams” (sesiones separadas que colaboran) consumen muchos más tokens; para un fundador solo, subagentes en una sola sesión es lo correcto.


---

# 12. Hallazgos de investigación clave

Estos hallazgos —verificados contra fuentes públicas (Anexo C)— sustentan decisiones del documento.

- **Ley 21.431 (plataformas digitales). **Define “empresa de plataforma digital de servicios” como la que gestiona un sistema que permite a un trabajador ejecutar reparto de bienes para usuarios en un territorio. Como el fundador NO opera entregas, el sujeto de esta ley sería el courier, no el fundador. El conductor es dependiente o independiente según el Art. 7; la ley protege sus datos y prohíbe discriminación por mecanismos automatizados. El software debe registrar el tipo de relación y proteger esos datos, sin empujar informalidad.

- **Facturación electrónica (DTE/SII). **La factura es un DTE tipo 33 (XML firmado), obligatorio en B2B. Construir el motor de emisión propio exige certificarse ante el SII (set de pruebas, gestión de folios/CAF, cuadratura, contingencias, recepción). Recomendación: integrar un proveedor certificado (cada courier emite bajo su propio RUT) y reservar el desarrollo propio para cuando el volumen lo justifique.

- **Pagos. **Para la cobranza courier→seller, la transferencia con conciliación automática (Fintoc/Khipu) ataca directo el dolor de cuadre. Para la suscripción del SaaS, Flow (suscripciones nativas) o Webpay PatPass. El same-day no es un cobro separado: se factura junto con los Flex del período.

- **OAuth de Mercado Libre. **El seller autoriza con su cuenta principal (no colaborador) y la app obtiene un access token con refresco. Los tokens caducan y hay eventos que obligan a re-vincular manualmente — de ahí la criticidad del monitor de salud de conexiones. La app de escaneo/POD no es integrable.


---

# 13. Próximos pasos

- Validar con 3–5 pilotos pagados que el dolor financiero-administrativo es agudo y pagable (suple la decisión de no hacer entrevistas). Si nadie compromete pago: NO-GO o pivote.

- Definir el proveedor DTE (comparar SimpleFactura/SimpleAPI vs Openfactura por multiempresa, costo por documento y certificación).

- Montar el esqueleto: CLAUDE.md + subagentes + skills (cap. 11) y construir la Fase A del MVP.

- Calibrar precios de planes con la disposición de pago observada en los pilotos.


---

# Anexo A — Glosario

| **Término** | **Significado** |
| --- | --- |
| Flex / Mercado Envíos Flex | Servicio de Mercado Libre para entrega same-day/next-day gestionada por el vendedor con su courier. |
| POD | Prueba de entrega (foto, firma, escaneo). En Flex vive en la app de Mercado Libre. |
| DTE / boleta de terceros | Documento Tributario Electrónico; la boleta de terceros la emite la empresa por el prestador de servicios. |
| RLS (Row-Level Security) | Reglas en la base de datos que limitan qué filas ve cada usuario/tenant. |
| Multi-tenant | Una sola instalación que sirve a muchos clientes (couriers) con datos aislados. |
| Motor entrega→dinero | Capa que convierte cada entrega en su línea de factura al seller y de liquidación al conductor, conciliadas. |
| MRR / ARR / ARPA | Ingreso recurrente mensual / anual / promedio por cuenta. |
| Subagente / Skill / CLAUDE.md | Mecanismos de Claude Code: rol con contexto propio / conocimiento reutilizable / memoria del proyecto. |


---

# Anexo B — Supuestos a validar

- Dolor financiero-administrativo agudo y pagable (hipótesis #1).

- Disposición de pago y unidad de cobro preferida (conductor, fijo, por envío).

- Que la fricción de las dos apps y el ruteo no sean el problema #1.

- Que el incumbente deje un flanco real en conciliación/cobranza/liquidación.

- Número aproximado de couriers Flex formales en Santiago (para TAM/SAM/SOM).

- Calidad, completitud y latencia de los estados de la API de Flex visibles para el courier.


---

# Anexo C — Fuentes consultadas

Selección de fuentes públicas verificadas (junio de 2026):

- Mercado Libre Developers — Envíos Flex, autenticación/autorización OAuth, estados y asignación de transportista, restricción de la app: developers.mercadolibre.cl / .com.ar.

- SII (Servicio de Impuestos Internos) — facturación electrónica, proceso de certificación de software propio o de mercado, folios (CAF): sii.cl, chileatiende.gob.cl.

- Proveedores DTE — Chilesystems (SimpleAPI/SimpleFactura), Haulmer (Openfactura), BaseAPI, Bsale.

- Pagos — Fintoc (open banking/conciliación), Khipu, Flow, Transbank (Webpay/PatPass), Mercado Pago.

- Ley 21.431 — Modifica el Código del Trabajo regulando a trabajadores de plataformas digitales: vlex.cl, isl.gob.cl, achs.cl.

- Claude Code — documentación oficial de subagentes y de skills: code.claude.com/docs.

- Informe de mercado previo del proyecto (SaaS última milla Flex · Santiago), como base de contexto.

*Advertencia: las cifras de mercado y las estimaciones de número de empresas y de disposición de pago son supuestos y deben validarse con investigación primaria (pilotos).*

	Documento de trabajo · Junio 2026	Página


---

