# Catálogo de funcionalidades replicables — software de última milla que funciona

**Para qué sirve este documento.** Es el menú de funcionalidades probadas en los mejores productos comparables (Onfleet, Bringg, nuVizz, DispatchTrack, Routific, OptimoRoute, Track-POD, Tookan, FarEye, CourierManager, Enviame, 99minutos/Ruta99, Uber Direct, DoorDash Drive). Por cada una: **qué resuelve · quién lo hace bien y cómo lo hace (lo observable) · cómo lo replicas tú · dónde puedes superarlos**. La etiqueta `[Rutax]` indica si ya lo tienes (✅), parcial (🟡) o no (⛔), para que también te sirva de buscador de huecos.

**Cómo usarlo.** Lee por dominio. Lo marcado ⛔/🟡 es candidato de construcción; lo ✅ úsalo para comparar tu implementación contra "cómo lo hace el bueno" y subir el estándar. Cada bloque "Cómo lo replicas" está escrito para que puedas pegarlo a Claude Code y construir sin más contexto.

---

## Dominio 1 — Ingesta e integración

### F1 — Cola unificada multi-fuente `[Rutax: 🟡 ML + ad-hoc]`
- **Qué resuelve:** que el courier reciba pedidos de muchos canales/sellers en una sola bandeja, sin Excel ni copiar/pegar.
- **Quién lo hace bien y cómo:** Onfleet y 99minutos/Ruta99 ingieren por API + CSV + webhooks y normalizan todo a una "tarea/pedido" única con estado; Bringg orquesta órdenes de múltiples orígenes en una sola vista operativa.
- **Cómo lo replicas:** un **puerto de ingesta** con un adaptador por canal que traduce todo a tu tabla `pedidos` (`origen_pedido` por canal). El núcleo nunca conoce el canal: recibe un pedido normalizado (seller, dirección, ventana, peso, tipo). Cola idempotente (dedupe por `marketplace_ref`) con reintentos.
- **Dónde superarlos:** ata cada pedido, desde la ingesta, a su tarifa de cobro y a su esquema de pago al conductor (la mayoría separa operación de dinero).

### F2 — Conector de marketplace / Flex `[Rutax: ✅ Flex]`
- **Qué resuelve:** sincronía bidireccional de estados con el canal y respeto de sus reglas (SLA, código de retiro, etiquetas).
- **Quién lo hace bien y cómo:** los conectores Flex (Base, Zipnova, E-Courier) mantienen zonas, horario de corte y el código de retiro diario, y empujan estados de vuelta a ML para preservar el "Llega hoy". Falabella expone Seller Center API (motor Linio, auth `UserID`+`API Key`+`Signature` HMAC); Paris/Ripley corren sobre Mirakl.
- **Cómo lo replicas:** cliente por seller con token aislado; *reconciler* de estados (poll + push) para no perder transiciones; modela el **horario de corte y el SLA semanal** como entidades de primera clase, no como campos sueltos.
- **Dónde superarlos:** semáforo de SLA por seller (≥97%) como primer indicador que ve el operador.

### F3 — Multi-carrier / DaaS con cascada `[Rutax: ⛔]`
- **Qué resuelve:** cubrir picos o zonas sin flota propia, derivando a terceros y eligiendo el más barato/rápido.
- **Quién lo hace bien y cómo:** Enviame agrega 150+ couriers (40+ en Chile) con cotización comparada y webhooks; Bringg orquesta flota propia + 3PL + gig en una vista; Uber Direct y DoorDash Drive exponen *quote → create delivery → status → webhooks* (`delivery_status`, `courier_update`) con JWT/HMAC y sandbox; Ordering.co cascada por reglas (si un partner no puede, pasa al siguiente).
- **Cómo lo replicas:** un adaptador DaaS por proveedor detrás de un puerto común con tres métodos: `cotizar`, `crear_envío`, `estado`; motor de selección por reglas (costo, cobertura por comuna, SLA) con *fallback* en cascada.
- **Dónde superarlos:** integrar a los couriers chilenos reales (Chilexpress, Starken, Blue Express same-day) bajo el mismo puerto.

### F4 — Normalización y geocoding de direcciones `[Rutax: 🟡 comunas RM]`
- **Qué resuelve:** direcciones sucias rompen ruteo, tarifa por zona y SLA.
- **Quién lo hace bien y cómo:** todos los serios geocodifican (Google Maps / HERE) y validan cobertura; Shipit modela la cobertura **por comuna** (`couriers_availables` por comuna).
- **Cómo lo replicas:** en Chile la unidad es la **comuna** (no hay CP confiable): valida comuna + geocodifica a lat/long; marca direcciones no resueltas para revisión antes de rutear. Cachea geocoding por dirección.
- **Dónde superarlos:** validación de comuna contra tu catálogo de zonas tarifadas en el momento de ingesta (rechaza/avisa si la comuna no está tarifada para ese seller).

---

## Dominio 2 — Ruteo y despacho

### F5 — Optimización de rutas `[Rutax: 🚫 excluido por diseño]`
- **Qué resuelve:** minimizar km/tiempo/costo respetando ventanas, capacidad y corte.
- **Quién lo hace bien y cómo:** Routific y OptimoRoute resuelven VRP con ventanas de tiempo y capacidad multi-restricción, multi-depósito, rutas listas en minutos; Onfleet suma auto-assign on-demand.
- **Cómo lo replicas (si algún día sales del "excluido"):** no construyas solver propio; usa una librería/servicio (VRPTW). Lo barato y valioso es que cada parada ya "sepa" su tarifa y su costo de conductor.
- **Dónde superarlos:** ruteo "legible para humanos" (sin cruces) — el conductor desconfía de rutas raras y deja de usar la app. Como tú lo excluiste, tu diferencia está en otro lado; ten esto solo como referencia.

### F6 — Despacho + auto-assign + re-optimización en vivo `[Rutax: 🟡 asignación/manifiesto]`
- **Qué resuelve:** asignar y reasignar ante caídas de conductor o atrasos, en ventanas cortas.
- **Quién lo hace bien y cómo:** Onfleet asigna automáticamente por proximidad/carga y reordena el día; DispatchTrack reasigna y recalcula al vuelo.
- **Cómo lo replicas:** reglas de asignación (zona del conductor, carga, disponibilidad) + acción manual de reasignar; cuando un conductor cae, redistribuye sus paradas abiertas por costo mínimo. Sin solver: heurística simple basta para el MVP.
- **Dónde superarlos:** reasignación que muestra el impacto en el SLA del seller afectado.

### F7 — Zonas, ventanas y horario de corte SLA-aware `[Rutax: 🟡 tarifas por_zona]`
- **Qué resuelve:** el corte es la columna vertebral del same-day; pasarse mata la promesa.
- **Quién lo hace bien y cómo:** Base y Administrado modelan zonas, cortes por seller y estadísticas de cumplimiento.
- **Cómo lo replicas:** entidad "ventana operativa" = f(hora_corte, tiempo_preparación, tiempo_ruta_estimado); regla dura: si `hora_actual > corte` el pedido no es same-day del día (next-day o alerta). Tablero con cortes próximos a vencer.
- **Dónde superarlos:** alerta proactiva "te quedan N minutos para cumplir el corte de TiendaA".

---

## Dominio 3 — Ejecución (conductor)

### F8 — App de conductor (manifiesto, escaneo, offline) `[Rutax: ✅ PWA]`
- **Qué resuelve:** ejecutar la ruta y capturar datos en terreno, incluso sin señal.
- **Quién lo hace bien y cómo:** Onfleet y Track-POD: lista de paradas, navegación nativa, **escaneo de código de barras**, captura en 2 toques, sync offline (store-and-forward), métricas para nómina.
- **Cómo lo replicas:** app **offline-first** (cola local + sync idempotente). Pantallas mínimas: manifiesto del día → parada → entregar/falló. Escaneo de paquete que hace match con el pedido.
- **Dónde superarlos:** el conductor ve **su liquidación estimada del día** en la misma app (retención de conductores = cuello de botella real de la última milla).

### F9 — Prueba de entrega (foto + firma + geo + OTP) `[Rutax: 🟡 Flex vía ML; same-day propio ⛔]`
- **Qué resuelve:** probar la entrega, bajar disputas y habilitar liquidación atada a evidencia.
- **Quién lo hace bien y cómo:** Track-POD es el referente (foto, firma, escaneo, sello de tiempo, geo); Onfleet adjunta POD consultable.
- **Cómo lo replicas (para tu same-day no-ML; en Flex el POD es de la app de ML, no lo toques):** captura foto + firma/OTP + geo; **geocerca** del destino (si el POD cae fuera del radio → marca para revisión, anti-fraude); el pedido no cierra como "entregado" sin POD válido.
- **Dónde superarlos:** liquidación que **no paga** la parada si el POD no es válido (cierra el fraude y el sobrepago).

### F10 — Incidencias estandarizadas `[Rutax: ✅]`
- **Qué resuelve:** estandarizar lo que sale mal (ausente, dirección, daño, reprogramación) y su costo.
- **Quién lo hace bien y cómo:** DispatchTrack y Bringg: motivos tipificados + evidencia + acción (reintento/retorno) y su efecto en costo/SLA.
- **Cómo lo replicas:** enum de motivos + evidencia adjunta + regla de costo (¿lo paga el seller o el courier?) que alimenta el motor de dinero. (Ya lo tienes — compáralo contra esta lista de motivos.)
- **Dónde superarlos:** que cada incidencia con costo genere automáticamente su línea de cobro/ajuste.

---

## Dominio 4 — Visibilidad y experiencia

### F11 — Tracking en tiempo real + ETA dinámico `[Rutax: ⛔ propio]`
- **Qué resuelve:** visibilidad para dispatcher y comprador; menos llamadas.
- **Quién lo hace bien y cómo:** Onfleet (mapa en vivo, ETA que se actualiza) y FarEye (visibilidad predictiva).
- **Cómo lo replicas (solo para same-day no-ML; en Flex el comprador ya ve a ML):** posición del conductor + ETA por histórico/tráfico; página de seguimiento por pedido.
- **Dónde superarlos:** ETA honesto con margen (prometer de más quema confianza).

### F12 — Notificaciones + página white-label `[Rutax: ⛔]`
- **Qué resuelve:** reducir consultas postventa y dar marca del seller.
- **Quién lo hace bien y cómo:** Scurri y Parcel Perform: notificaciones de estado branded + página de tracking self-service.
- **Cómo lo replicas:** plantillas por estado; **WhatsApp Business API como canal primario en Chile** (sobre SMS/email); página de seguimiento con la marca del seller.
- **Dónde superarlos:** notificación que incluye el link de la página y reduce tickets medibles.

### F13 — Portal del cliente/seller `[Rutax: ✅]`
- **Qué resuelve:** que el seller vea sus pedidos, SLA, cobros y facturas sin llamar al courier.
- **Quién lo hace bien y cómo:** DispatchTrack y nuVizz: dashboard self-service con estados, reportes y documentos.
- **Cómo lo replicas:** ya lo tienes; compáralo: ¿el seller descarga su factura PDF, ve su SLA y sus incidencias? ¿conecta su ML solo?
- **Dónde superarlos:** que el seller vea su **cumplimiento de SLA** (lo que más le importa para no perder "Llega hoy").

---

## Dominio 5 — Trastienda de dinero (donde casi nadie es bueno = tu foso)

### F14 — Tarifario configurable / rate cards `[Rutax: ✅]`
- **Qué resuelve:** modelar exactamente lo que el courier cobra a cada seller.
- **Quién lo hace bien y cómo:** nuVizz y DispatchTrack: rate cards por contrato (por zona, peso, volumen, pieza, **mínimos**, recargos, escalones por volumen); reglas distintas por cliente.
- **Cómo lo replicas:** reglas como **datos versionados** (no código), por seller, con vigencia. Cobro por paquete/comuna + mínimo por retiro + recargo por reprogramación. (Ya lo tienes — verifica que cubra mínimos y recargos.)
- **Dónde superarlos:** que la rate card alimente a la vez el cobro al seller y el cálculo del costo, sobre el mismo motor.

### F15 — Facturación al cliente / DTE `[Rutax: ✅ sandbox]`
- **Qué resuelve:** cobrar correcto, a tiempo y compliant, sin fuga.
- **Quién lo hace bien y cómo:** nuVizz factura con surcharges/combustible y reportes audit-ready; CourierManager liga shipment→invoice. En Chile, facturar = **DTE obligatorio**: se integra un proveedor certificado (OpenFactura/Haulmer, LibreDTE, SimpleAPI) — nadie construye el SII desde cero.
- **Cómo lo replicas:** ya lo tienes (SimpleFactura sandbox + Openfactura skeleton, compuerta humana, notas de crédito, polling SII, alerta de folios). Para producción: endurecer el opt-in real, manejo de errores SII, casos límite. Documentos relevantes: Factura (33), Boleta (39), Nota de Crédito (61), y **Guía de Despacho Electrónica (52)** para transporte.
- **Dónde superarlos:** facturación electrónica nativa chilena ata todo el ciclo; los referentes globales no lo tienen.

### F16 — Motor de liquidación de conductores (multi-esquema) `[Rutax: ✅]`
- **Qué resuelve:** pagar al conductor lo justo, auditable y a tiempo (dolor #1 del back-office).
- **Quién lo hace bien y cómo:** **nuVizz Driver Pay** es el referente: esquemas por stop, por ruta, por peso/volumen, por pieza, por hora, **% de revenue** y por tier, con bonos/penalizaciones, anticipos y deducciones; settlement audit-ready. PCS hace lo mismo para flota pesada.
- **Cómo lo replicas:** ya lo tienes; compáralo contra esa **variedad de esquemas** (¿soportas bonos por on-time y penalizaciones por fallo evitable? ¿anticipos/deducciones?). En Chile suma **boleta de honorarios + retención** para independientes.
- **Dónde superarlos:** liquidación atada a POD válido (no pagas entregas no probadas) + transparencia total hacia el conductor.

### F17 — Conciliación / settlement automatizado `[Rutax: 🟡 entregado-vs-facturado]`
- **Qué resuelve:** detectar diferencias entre lo entregado, lo facturado y lo pagado, antes de perder plata.
- **Quién lo hace bien y cómo:** nuVizz automatiza el settlement contra rate cards/contratos y **recupera 2–5% de fuga de ingresos**; CourierManager liga shipment-to-settlement con COD.
- **Cómo lo replicas:** tienes la conciliación entregado-vs-facturado (detective, read-only) + matching Fintoc. Para completarla: cruza también `lineas_liquidacion` (costo del conductor) y marca diferencias nuevas (`pago_faltante`, etc.). Detective, idempotente, no muta dinero.
- **Dónde superarlos:** conciliación de **3 fuentes** (facturado / pagado / pagado-al-conductor) que detecta reprogramaciones no cobradas y mínimos omitidos — nadie en LATAM lo productiza.

### F18 — COD / rendición de efectivo `[Rutax: ⛔ — N/A en Flex]`
- **Qué resuelve:** cobrar contra entrega y cuadrar la caja del conductor.
- **Quién lo hace bien y cómo:** CourierManager automatiza el settlement de COD e invoicing.
- **Cómo lo replicas (solo si haces same-day con efectivo):** registro de COD cobrado vs rendido por conductor, cuadre de caja con partida doble, liquidación **neteada** contra lo recaudado; faltantes retenidos.
- **Dónde superarlos:** N/A para Flex (prepago en ML); constrúyelo solo si aparece demanda real.

### F19 — Payouts a conductores `[Rutax: ⛔]`
- **Qué resuelve:** cerrar el loop: de "cuánto le debo" a "ya le pagué".
- **Quién lo hace bien y cómo:** Openforce paga a contratistas (onboarding, seguros, pagos); los TMS de flota pagan vía AP integrada.
- **Cómo lo replicas:** adaptador de pago **saliente** (Fintoc payouts / transferencia bancaria) bajo tu puerto de pagos; compuerta humana (ningún cron paga); para independientes, netea retención y asocia boleta de terceros. Un payout por liquidación (idempotente).
- **Dónde superarlos:** liquidación→retención→boleta de terceros→transferencia en un solo flujo chileno.

---

## Dominio 6 — Plataforma

### F20 — Multi-tenant + RBAC + auditoría `[Rutax: ✅ RLS]`
- **Qué resuelve:** aislar datos por courier y por seller; trazabilidad financiera.
- **Quién lo hace bien y cómo:** SaaS B2B maduro impone aislamiento + roles + bitácora inmutable.
- **Cómo lo replicas:** ya lo tienes y bien (RLS en la base, probado con pgTAP, RBAC por capacidades). Es tu base de confianza para manejar dinero ajeno.
- **Dónde superarlos:** RLS en la base (no solo en la app) ya te pone por delante de muchos.

### F21 — Torre de control + KPIs `[Rutax: ✅ dashboard]`
- **Qué resuelve:** comando del día en una pantalla.
- **Quién lo hace bien y cómo:** Onfleet y Bringg: estados en vivo, "en riesgo", on-time, productividad.
- **Cómo lo replicas:** ya tienes dashboard; sube el estándar con el **semáforo de SLA** (cumplimiento Flex por seller) y "pedidos en riesgo de corte" como primeros widgets.
- **Dónde superarlos:** unir KPIs operativos con financieros (costo por entrega) en la misma vista.
- **Nota (2026-08-03):** además del dashboard existe el módulo Torre de control, que **entra en rediseño v2**: mapa exclusivamente operativo, sin capas de ambiente. Alcance en `docs/torre-de-control/alcance-v2.md`.

### F22 — Analítica / BI (costo, productividad, fuga) `[Rutax: 🟡]`
- **Qué resuelve:** decidir con datos y tener argumento de venta.
- **Quién lo hace bien y cómo:** nuVizz reporta fuga de ingresos recuperada y costo por entrega.
- **Cómo lo replicas:** sobre lo que ya mides, agrega costo por entrega y por conductor; la "fuga" sale de F17.
- **Dónde superarlos:** benchmarking anonimizado entre tus tenants (costo/entrega, on-time) como inteligencia de mercado.

### F23 — API + webhooks `[Rutax: 🟡 webhooks ML/Fintoc]`
- **Qué resuelve:** que terceros (sellers, integradores) se conecten a tu sistema.
- **Quién lo hace bien y cómo:** **Uber Direct y DoorDash Drive** son la plantilla: *quote → create delivery → status*, webhooks (`delivery_status`, `courier_update`), JWT, **firma HMAC**, sandbox separado, idempotencia.
- **Cómo lo replicas:** API REST versionada, `Idempotency-Key` en POST de dinero, webhooks firmados (HMAC) con reintentos + dead-letter, sandbox. Emite: `order.status_changed`, `order.delivered/failed`, `pod.created`, `settlement.ready`, `invoice.issued`.
- **Dónde superarlos:** familiaridad — copia el patrón que los integradores ya conocen de Uber/DoorDash.

---

## Cómo priorizar lo que sale de este catálogo (para Rutax, Flex-first)

1. **Lo ✅:** úsalo como checklist de calidad — compara tu implementación contra "cómo lo hace el bueno" en cada ficha (sobre todo F14, F16: ¿cubres mínimos, recargos, bonos/penalizaciones, anticipos?).
2. **Lo 🟡 de mayor valor:** completar F17 (conciliación de 3 fuentes) y F23 (API/webhooks como Uber/DoorDash).
3. **Lo ⛔ que importa para Flex-first:** F19 (payouts) y F11/F12 (tracking + WhatsApp) solo si crece el same-day no-ML.
4. **Ignora por ahora:** F3 multi-carrier, F5 ruteo, F18 COD (no son tu juego hoy).
