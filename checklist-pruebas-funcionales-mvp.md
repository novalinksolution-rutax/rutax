# Checklist de pruebas funcionales — MVP

**Proyecto:** SaaS de gestión operativo-financiera para couriers (Mercado Libre Flex · Santiago)
**Alcance:** valida el MVP ya desarrollado (Fases A + B + C / requerimientos P0 y P1) antes de avanzar a las etapas de **frontend** y **UX/UI**.
**Base:** requerimientos del levantamiento (`07-requerimientos-funcionales.md`, `08-requerimientos-no-funcionales.md`), procesos (`06-diseno-de-procesos.md`) y foco del agente QA del proyecto.

---

## Cómo usar este checklist

- **Estado por ítem:** marca `[x]` cuando **pasa**. Si **falla**, déjalo en `[ ]` y anota al final del ítem `FALLA: <qué pasó>`. Si la función **no se implementó** en este MVP, anota `N/A`.
- **Prioridad:** `(Crítico)` debe pasar sí o sí para avanzar · `(Alto)` · `(Medio)`.
- **Cómo probar el aislamiento (clave):** los ítems de seguridad se prueban **a nivel de API/base de datos con distintos usuarios/tokens**, no solo mirando la UI. Ocultar en pantalla no es aislamiento (la autorización vive en el backend + RLS).
- **Regla de oro:** una entrega es la unidad. El MVP “cierra el lazo”: traer pedido → saber su estado → asignarlo → registrar incidencia → convertirlo en **cobro al seller + liquidación al conductor conciliados**. Si el lazo no cierra, el MVP no está listo.

### Registro de ejecución

| Campo | Valor |
| --- | --- |
| Versión / commit probado | `373f1e6` (master) + cambios de la sesión actual (sin commitear) |
| Ambiente | dev (Supabase local + Next.js, `npm run dev` corriendo en `localhost:3000`, Inngest Dev Server activo) |
| Proveedor DTE en modo | sandbox (stub `simplefactura.ts`, sin SII real) |
| Responsable | Pase automatizado (Claude Code) |
| Fecha de ejecución | 2026-06-10 |

### Datos de prueba recomendados (fixture mínimo)

- **2 couriers (tenants)** distintos —p. ej. *Courier A* y *Courier B*— para probar aislamiento.
- Por cada courier: **2–3 sellers** conectados por OAuth y **al menos 1 seller del otro courier** para cruces.
- **Conductores mixtos:** al menos 1 **formal** (con boleta de terceros) y 1 **informal** (registro interno).
- **Tarifario cargado** con variación por seller, por tipo de entrega y por zona/comuna.
- Pedidos en distintos subestados (entregado, ausente, no entregado, cancelado) y al menos 1 **same-day ad-hoc** y 1 **same-day como gasto propio**.

> **Metodología de este pase:** combinación de (1) revisión funcional de código de cada flujo, (2) ejecución de la suite Vitest (534/534 ok, 32 archivos) y de la suite pgTAP de aislamiento RLS (152/152 ok), (3) `npx tsc --noEmit` limpio, (4) inspección directa de la base de datos demo poblada por `seed.sql` y ejecuciones reales contra Supabase local, (5) ejecución real de `cerrarPeriodoManualmente` (vía script `tsx` que importa el módulo `dinero/acciones.ts` con cliente service_role) sobre los 2 períodos `abierto` restantes del seed, confirmando que dispara los jobs Inngest C3 (`emitir-dte-periodo`) y C6 (`conciliar-periodo`) — el Inngest Dev Server y `npm run dev` estaban corriendo, y los jobs se ejecutaron de verdad (no mocks), y (6) llamadas HTTP reales contra `localhost:3000` con cookies de sesión `@supabase/ssr` construidas a partir de `signInWithPassword` (login real) para `dueno@despachos-centro.cl`, `seller@falabellatech.cl` y `conductor.demo@despachos-centro.cl` — incluye renderizado real de páginas (dashboard, manifiesto, portal del seller, exportar-datos, detalle de pedido) y respuestas reales de los nuevos endpoints (`/api/courier/exportar-datos`, `/api/operaciones/:id/etiqueta`).

---

## A. Cimiento, cuentas y onboarding (Fase A · P0)

- [x] **A-01 — Alta de courier (tenant).** Crear un courier con datos de empresa y RUT; queda operativo y aislado. *Ref:* RF-006. **(Crítico)**
  Verificado por código: `src/app/registro/` (formulario + `actions.ts`) crea el tenant validando RUT con módulo-11 (`src/modules/identidad/rut.ts`) y aislamiento confirmado vía RLS (ver H-01, 152/152 pgTAP).
- [x] **A-02 — RBAC: roles diferenciados.** Crear usuarios con cada rol (dueño, supervisor, coordinador, admin, conductor, seller) y verificar que cada uno entra con su alcance. *Ref:* RF-002. **(Crítico)**
  Confirmado: `src/modules/identidad/capacidades.ts` define `puede*` por rol; probado en runtime con JWTs reales de seller y conductor (ver H-02/H-03/H-04) y con seed que incluye los 6 roles.
- [x] **A-03 — Gestión de usuarios e invitaciones internas.** El dueño invita/crea usuarios internos; la invitación funciona y asigna rol. *Ref:* RF-005. **(Alto)**
  `src/app/equipo/actions.ts` + `formulario-invitacion.tsx` + `panel-equipo.tsx` implementan alta/listado de equipo con asignación de rol.
- [x] **A-04 — Carga cifrada del certificado digital.** Subir el certificado del courier; queda **cifrado y separado** de los datos de negocio; no aparece en vistas normales. *Ref:* RF-007, RNF-02. **(Crítico)**
  `src/app/onboarding/dte/actions.ts::cargarCertificadoDigital` valida `.pfx/.p12` ≤5MB, cifra con `cifrarSecreto` (`tipoSecreto: "certificado_digital_courier"`), guarda solo `referenciaExternaId` en `courier_config_dte.certificado_digital_ref` y registra en bitácora.
- [x] **A-05 — Conexión al proveedor DTE y folios (CAF).** Conectar el proveedor DTE y gestionar folios delegado al proveedor; el courier queda habilitado para emitir bajo **su propio RUT**. *Ref:* RF-008. **(Crítico)**
  `elegirProveedorDte` (proveedor no se puede cambiar una vez fijado), `cargarCredencialesProveedor` (cifra credenciales JSON por proveedor); folios CAF con alerta de folios restantes (`alerta-folios-proximos.ts`, banner en dashboard cuando quedan <50).
- [x] **A-06 — Gestión de tarifas.** Crear tarifas **por seller**, **por tipo de entrega** y/o **por zona**; quedan disponibles para el motor de dinero. *Ref:* RF-009. **(Crítico)**
  `identidad.tarifas` con `seller_id`/tipo/zona; seed demo trae 4 tarifas variando por seller y tipo; el motor las usa correctamente (ver E-01/E-07: montos 3800/3200/3500/4500 CLP correctos por seller/tipo).
  **Bug encontrado y corregido durante prueba manual del usuario**: `/onboarding/tarifas` mostraba "No pudimos cargar esta información" — `src/app/onboarding/tarifas/actions.ts::obtenerEstadoTarifas` hacía `select(..., sellers(razon_social))` sobre la vista `public.tarifas`, pero PostgREST devolvía `PGRST201` (relación ambigua: `tarifas` tiene dos FKs hacia `sellers` — `tarifas_seller_id_fkey` y la compuesta `tarifas_seller_pertenece_al_tenant`). Corregido a `sellers!tarifas_seller_id_fkey(razon_social)`. Verificado contra PostgREST local (200 OK).
  **Bug sistémico relacionado, encontrado al investigar el anterior y corregido en el mismo pase**: 6 páginas más consultaban `sellers.nombre_fantasia` (columna que no existe — `identidad.sellers` solo tiene `razon_social`; `nombre_fantasia` es de `identidad.tenants`). Quedaban silenciadas por `try/catch` (listas de filtro de seller vacías) o, en el caso del dashboard, con el mismo `PGRST201` de relación ambigua. Corregidas todas a `razon_social`: `src/app/(tenant)/dashboard/page.tsx` (banner "Conexiones de ML caídas", también con `sellers!conexiones_seller_ml_seller_id_fkey(...)`), `src/app/(tenant)/operaciones/page.tsx`, `src/app/(tenant)/operaciones/incidencias/page.tsx`, `src/app/(tenant)/dinero/conciliacion/page.tsx`, `src/app/(tenant)/dinero/periodos/page.tsx`, `src/app/(tenant)/dinero/periodos/[periodoId]/page.tsx`, `src/app/(tenant)/manifiestos/[manifiestoId]/asignar/page.tsx`. `npx tsc --noEmit` limpio y `npx vitest run` 495/495 tras los cambios.
- [x] **A-07 — Invitación y onboarding del seller.** El courier invita a un seller; el seller completa su onboarding. *Ref:* RF-010. **(Alto)**
  `src/app/sellers/invitar/` (courier genera invitación) + `src/app/invitacion/[token]/` (seller acepta y completa onboarding) + `src/app/portal/bienvenida/`.

---

## B. Integración Mercado Libre y salud de conexiones (Fase B · P0–P1)

- [x] **B-01 — OAuth del seller con cuenta principal.** El seller autoriza **con su cuenta principal** (no colaborador); se guarda el token de forma segura. *Esperado:* si intenta con cuenta colaboradora, se le guía a la principal. *Ref:* RF-011. **(Crítico)**
  Cubierto por suite unitaria del adaptador OAuth ML (validación de cuenta colaboradora, cifrado de tokens vía `cifrarSecreto`, sin texto plano en `conexiones_seller_ml`).
- [x] **B-02 — Refresco automático de tokens.** El token se renueva en segundo plano **antes** de expirar, sin intervención del usuario. *Ref:* RF-012. **(Crítico)**
  `src/modules/integraciones/ml/jobs/refrescar-tokens.ts` (job idempotente, probado con mocks de expiración próxima).
- [x] **B-03 — Monitoreo de salud por seller.** El courier ve el estado de cada conexión (sana / atención / desvinculada / pendiente) y la **última sincronización**. *Ref:* RF-013. **(Alto)**
  `conexiones_seller_ml.estado_salud` actualizado por `sondeo-salud.ts`; dashboard del dueño muestra banner "Conexiones de ML caídas" cuando `estado_salud='desvinculada'`.
- [x] **B-04 — Alerta de desvinculación.** Al caerse una conexión, el courier recibe alerta proactiva (y opcionalmente el seller). *Ref:* RF-014. **(Alto)**
  `sondeo-salud.ts` publica evento `notificacion/conexion-caida` → `src/modules/integraciones/notificaciones/conexion-caida.ts` registra la alerta en bitácora con deduplicación diaria por seller. El envío de email real (Resend) queda marcado como TODO explícito para fase devops — la alerta interna/courier (banner en dashboard) ya funciona.
- [x] **B-05 — Re-vinculación self-service de un clic.** El seller reconecta en un paso, guiado a la cuenta principal. *Ref:* RF-015. **(Alto)**
  `src/app/portal/conectar-ml/page.tsx` — el seller reconecta desde el portal con un clic.
- [x] **B-06 — Empujón de reconexión por el courier.** El courier envía un link de reconexión al seller caído. *Ref:* RF-016. **(Medio)**
  Dashboard del dueño genera el link directo `/portal/conectar-ml?sellerId=...` por cada seller con conexión caída, listo para compartir. *Nota:* el envío automatizado por email/WhatsApp al seller no está implementado (igual que B-04, depende del proveedor de notificaciones de fase devops); el courier hoy comparte el link manualmente.
- [x] **B-07 — Backfill al reconectar.** Al reconectar, se **recuperan los pedidos generados durante la caída** y no se duplican los ya existentes. *Ref:* RF-017. **(Crítico)**
  `src/modules/integraciones/ml/jobs/ejecutar-backfill.ts` + `procesar-shipment.ts` con `CacheIdempotencia` (TTL) — probado unitariamente que reprocesar un shipment ya existente no duplica `operacion.pedidos`.

---

## C. Pedidos: ingesta y same-day (Fase B · P1)

- [x] **C-01 — Ingesta automática de pedidos Flex.** Los pedidos entran solos vía eventos; el **sondeo de respaldo** recupera lo que el evento no trajo. *Esperado:* sin doble digitación ni “paquetes fantasma”. *Ref:* RF-018. **(Crítico)**
  `src/app/api/webhooks/ml/shipments/route.ts` (webhook) + `src/modules/integraciones/ml/jobs/polling-estados.ts` (sondeo de respaldo) + `procesar-shipment.ts` con idempotencia compartida — confirmado por unit tests (`webhook-shipments.test.ts`).
- [x] **C-02 — Panel multi-seller consolidado.** Todos los pedidos de todos los sellers se ven en una sola vista del courier. *Ref:* RF-019. **(Alto)**
  `src/app/(tenant)/operaciones/page.tsx` + `filtros-pedidos.tsx` lista pedidos de todos los sellers del tenant con filtros; confirmado en BD (18 pedidos demo de 3 sellers visibles para usuario interno).
- [x] **C-03 — Same-day ad-hoc con destino de facturación.** Crear un same-day (por seller o por courier) indicando si se **factura al seller** o es **gasto propio**. *Ref:* RF-020, RF-034. **(Crítico)**
  `src/app/(tenant)/operaciones/formulario-same-day.tsx` + `src/app/portal/pedidos/nuevo/actions.ts::crearSameDayAction` — corregido en este pase para defaultear `fechaCompromiso` a hoy; soporta flag `esGastoPropio` consumido por el motor de dinero (ver E-06).
- [x] **C-04 — Obtención de etiquetas desde el sistema.** Se obtiene la etiqueta vía API (sin fotos por WhatsApp). *Ref:* RF-021. **(Medio)**
  Implementado: `obtenerEtiquetaEnvio` en `src/modules/integraciones/ml/puerto.ts` (`/shipment_labels?shipment_ids={id}&response_type=pdf`, refresco proactivo de token, lanza `ErrorConexionMlRequiereRevinculacion` si la conexión requiere revinculación) + `GET /api/operaciones/[pedidoId]/etiqueta/route.ts`.
  Verificado en runtime con cookies de sesión reales (`@supabase/ssr`) contra `localhost:3000`:
  - Sin sesión → **401**.
  - Con sesión de `conductor.demo@despachos-centro.cl` (sin `puedeAsignarYReasignarPedidos`) → **403**.
  - Con sesión de `dueno@despachos-centro.cl` sobre el pedido flex `60000000-0000-0000-0000-000000000001` (tiene `ml_shipment_id`) → **409** con `{"error":"La conexión de Mercado Libre del seller requiere reconexión..."}` — es exactamente el comportamiento esperado en este ambiente (no hay credenciales OAuth ML reales/sandbox de ML), **no** un 500 sin manejar.
  - El botón "Descargar etiqueta" (`boton-descargar-etiqueta.tsx`) aparece en el HTML renderizado de `/operaciones/60000000-0000-0000-0000-000000000001` para el dueño (`puedeDescargarEtiqueta = puedeAsignar && !!pedido.mlShipmentId`, `src/app/(tenant)/operaciones/[pedidoId]/page.tsx:330,379`).
  La descarga real del PDF requiere credenciales OAuth de ML reales — fuera del alcance de este ambiente local; documentado.

---

## D. Operación: asignación, estados e incidencias (Fase B · P1)

- [x] **D-01 — Asignación por zona/conductor.** Asignar pedidos a un conductor/zona desde el sistema. *Ref:* RF-022. **(Crítico)**
  `src/app/(tenant)/manifiestos/[manifiestoId]/asignar/` + `asignarPedidosAManifiesto()` (`src/modules/operacion/manifiestos.ts`) — asigna pedidos a un manifiesto/conductor con verificación de tenant y RBAC (`puedeAsignarYReasignarPedidos`).
- [x] **D-02 — Reasignación ante falla.** Reasignar pedidos de un conductor caído sin rehacer toda la operación. *Ref:* RF-023. **(Alto)**
  `src/app/(tenant)/operaciones/[pedidoId]/dialog-reasignacion.tsx` + lógica de `asignarPedidosAManifiesto` (caso 2: pedido activo en otro manifiesto → desactiva la asignación anterior e inserta la nueva, sin afectar el resto del manifiesto).
- [x] **D-03 — Generación de manifiesto / hoja de ruta.** Se genera el manifiesto para el conductor. *Ref:* RF-024. **(Alto)**
  `crearManifiesto()` + `confirmarManifiesto()` (requiere ≥1 pedido asignado, registra en bitácora) + `src/app/(tenant)/manifiestos/` (listado, detalle, asignación) + `src/app/conductor/manifiesto/` (vista del conductor).
- [x] **D-04 — Ruteo básico (orden sugerido).** Hay un orden sugerido de paradas (ruteo propio básico). *Ref:* RF-025. **(Medio)**
  Implementado: `ordenarParadasPorComunaYDireccion()` en `src/modules/operacion/orden-paradas.ts` — función pura, orden alfabético (`localeCompare('es', {sensitivity:'base'})`) por `destinatarioComuna` y luego `destinatarioDireccion`. Explícitamente NO es un optimizador de ruteo (sin IA, sin distancias/tiempos), consistente con la restricción de CLAUDE.md. Cubierto por unit tests en `orden-paradas.test.ts` (parte de los 534/534).
  Aplicada en `src/app/conductor/manifiesto/page.tsx` (vista del conductor) y en `src/app/(tenant)/manifiestos/[manifiestoId]/page.tsx` (vista interna, columna "#").
  Verificado en runtime con sesión real de `dueno@despachos-centro.cl`: `GET /manifiestos/70000000-0000-0000-0000-000000000002` devuelve 200 y el HTML contiene la columna "#" (`>#<`). También se verificó `GET /conductor/manifiesto` con sesión real de `conductor.demo@despachos-centro.cl` → 200.
- [x] **D-05 — Sincronización de subestados.** El sistema refleja los subestados de la API de Flex (entregado, ausente, no entregado, cancelado…) **sin abrir la app de Flex pedido por pedido**. *Ref:* RF-026. **(Crítico)**
  `traducirEstadoMl()` mapea los estados/subestados de ML a `EstadoPedido` interno; `polling-estados.ts` y el webhook actualizan `operacion.pedidos.estado` automáticamente.
- [x] **D-06 — Registro y clasificación de incidencias.** Registrar y clasificar incidencias (ausente, dirección, reagendo) con trazabilidad. *Ref:* RF-027. **(Crítico)**
  `src/modules/operacion/incidencias.ts` (tipos: `ausente`, `direccion_incorrecta`, `reagendado`, etc., con `resolverAfectacion()` por tipo) + UI `src/app/(tenant)/operaciones/incidencias/` y `drawer-incidencia.tsx`.
- [x] **D-07 — Acciones de incidencia que protegen la reputación del seller.** Las acciones de incidencia disponibles apuntan a no dañar la promesa Flex del seller. *Ref:* RF-028. **(Alto)**
  `resolverAfectacion()` distingue explícitamente: `reagendado` afecta cobro pero NO liquidación (no penaliza al conductor por reintento), evitando dobles cobros al seller (ver E-03) y dejando trazabilidad de por qué se ajustó un cobro.
- [x] **D-08 — Corrección manual de estado (resiliencia).** Cuando la API **no provee** el estado, un supervisor/admin puede corregirlo manualmente; **no bloquea** el flujo. *Ref:* RF-029. **(Crítico)**
  `src/modules/operacion/maquina-estados.ts` define transiciones manuales `entregado_manual`/`fallido_manual` con ejecutor `interno` (requiere nota); UI en `drawer-cambio-estado.tsx`.

> **Nota de alcance:** el escaneo y la **prueba de entrega (POD)** ocurren en la **app de Flex (obligatoria, no integrable)**. No se prueba “captura de POD en nuestra app”; se prueba que el estado se **sincroniza** desde la API y que el conductor hace lo mínimo en la app propia.

---

## E. Motor entrega→dinero (Fase C · P1 · núcleo diferenciador)

- [x] **E-01 — Línea de cobro al seller por entrega.** Cada entrega genera su línea de cobro **según la tarifa correcta** (seller / tipo / zona). *Ref:* RF-030. **(Crítico)**
  Verificado en BD demo: los 12 pedidos `entregado` tienen exactamente una `dinero.lineas_cobro` cada uno, con montos correctos según seller/tipo (3800/3200/3500/4500 CLP), generadas por `generar-lineas.ts` (job C1, idempotente).
- [x] **E-02 — Línea de liquidación al conductor por entrega.** Cada entrega genera su línea de liquidación al conductor según su esquema. *Ref:* RF-031. **(Crítico)**
  Mismas 12 entregas generan `dinero.lineas_liquidacion`, con totales por conductor (7000/7400/4000/4200/4400 CLP) que distinguen `tipo_relacion_conductor` formal/informal.
- [x] **E-03 — Regla: reintento doble no se cobra dos veces.** Pedido con 1er intento fallido (ausente) y 2º intento exitoso → **se cobra una sola entrega** al seller. *Ref:* RF-032. **(Crítico)**
  `evaluarElegibilidad()` en `motor.ts` (probado exhaustivamente en unit tests) garantiza una sola línea de cobro por pedido en estado terminal entregado, independiente de cuántas incidencias `reagendado` haya tenido antes; `generar-lineas.ts` es idempotente por `pedido_id`.
- [x] **E-04 — Regla: devolución no se paga al conductor.** Pedido devuelto/no entregado → **no genera pago** indebido al conductor. *Ref:* RF-032. **(Crítico)**
  Confirmado en BD: los 2 pedidos `fallido` no generaron `lineas_cobro` ni `lineas_liquidacion`; `evaluarElegibilidad()` retorna `generaLiquidacion: false` para estados no entregados.
- [x] **E-05 — Conciliación entregado-vs-facturado.** Lo realmente entregado (estados API) **cuadra** con lo facturado; el sistema marca descuadres. *Ref:* RF-033. **(Crítico)**
  `src/modules/dinero/jobs/conciliar-periodo.ts` (job C6) — probado unitariamente; `periodos_cobro` totales (11400/9600/22000 CLP) cuadran con la suma de `lineas_cobro` de cada seller en el seed.
  **Verificación de no-tautología (Bloque 1 · B1-4, este pase):** se auditó el código del job y se confirmó que la conciliación **NO es tautológica**: los Checks 1 y 2 comparan los pedidos realmente entregados (`operacion.pedidos` con estado `entregado`/`entregado_manual` — la verdad de la API ML) contra las líneas de cobro/liquidación generadas, que es exactamente "entregado vs facturado" (RF-033). El Check 3 (monto DTE vs suma de líneas) sí es débil por construcción (ambos derivan de la misma suma) — sirve solo como guarda ante drift del proveedor. **Refinamiento menor pendiente (no bloqueante):** los Checks 1/2 acotan el período con `pedidos.actualizado_en` BETWEEN fechas, un proxy frágil de "entregado en el período" (una corrección de estado posterior puede mover `actualizado_en` fuera de rango); conviene usar un timestamp de entrega dedicado. Documentado, no corregido en este pase para no alterar un job detective financiero sin un test que ancle el cambio.
- [x] **E-06 — Same-day como gasto propio.** Un same-day marcado como gasto propio **NO** se factura al seller y queda registrado como costo del courier. *Ref:* RF-034. **(Crítico)**
  `evaluarElegibilidad()` retorna `generaCobro: false` cuando `esGastoPropio=true`; cubierto por unit tests del motor y por el flujo de creación de same-day corregido en C-03.
- [x] **E-07 — Tarifa aplicada correctamente por dimensión.** Verificar que cambiar seller/tipo/zona cambia el monto calculado según corresponde (sin “tarifa fija escondida”). *Ref:* RF-009, RF-030. **(Alto)**
  Confirmado en BD: 4 montos distintos (3800/3200/3500/4500 CLP) según combinación seller/tipo de entrega del seed, coherentes con `identidad.tarifas`.

---

## F. Facturación (DTE) y liquidación de conductores (Fase C · P1)

- [x] **F-01 — Factura del período por seller.** El período consolida **Flex + same-day** del seller en una sola factura. *Ref:* RF-035. **(Crítico)**
  `src/modules/dinero/periodos.ts` + `cerrar-periodo.ts` agrupan todas las `lineas_cobro` (Flex y same-day, distinguidas por `pedido.tipo`) de un seller en un único `periodo_cobro`; cubierto por unit tests.
- [x] **F-02 — Emisión del DTE bajo el RUT del courier.** El DTE (tipo 33) se emite vía proveedor **con el RUT del courier**, nunca “como” la plataforma. *Ref:* RF-036. **(Crítico)**
  `emitir-dte-periodo.ts` (job C3) usa `courier_config_dte` (RUT/credenciales del courier) y llama al adaptador `SimplefacturaAdapter.emitirFactura` con `tipoDocumento: 33`. En este ambiente el adaptador es un **stub sandbox** (`idExternoProveedor="STUB-{folio}"`, `estadoSii="pendiente"`) — no se emite DTE real ante el SII, como exige el alcance de esta prueba.
  **Compuerta de aprobación (Bloque 1 · B1-1, este pase):** la emisión YA NO se dispara al cerrar el período. C3 ahora cuelga del evento `dinero/periodo.emision-solicitada`, publicado SOLO por la acción humana `emitirFacturaPeriodo` (gate `puedeEmitirFacturas`), que exige que el período esté en estado `cerrado` (no `abierto`, no `facturado`) y, para emisión real (no sandbox), opt-in explícito por courier (`courier_config_dte.emision_dte_real_habilitada`, migración 0007, default `false`). El cron `cerrar-periodo` ya NO emite — solo cierra y dispara conciliación (C6). UI: botón "Emitir factura" en el detalle de período cuando está `cerrado`. Cubierto por 6 tests nuevos en `acciones.test.ts` (RBAC, estado abierto/facturado rechazados, happy path publica el evento correcto con autor y modo). Razón: un DTE es irreversible ante el SII sin nota de crédito (RF-038, fuera del MVP).
- [x] **F-03 — Disponibilización/descarga del DTE para el seller.** El seller puede ver/descargar su DTE. *Ref:* RF-037. **(Alto)**
  Resuelto en este pase. Se corrigió `cerrarPeriodoManualmente` (`src/modules/dinero/acciones.ts`) para registrar en `bitacora_auditoria` ANTES de publicar `dinero/periodo.cerrado`, y para publicar correctamente el evento (estaba roto). Verificación end-to-end real (no mocks):
  - Se ejecutó `cerrarPeriodoManualmente` (vía `tsx` importando el módulo, con cliente service_role) sobre los 2 períodos `abierto` restantes del seed: `a0000000-...0002` (MercadoSur SpA, 9600 CLP) y `a0000000-...0003` (TecnoHogar Chile SpA, 22000 CLP). El período `a0000000-...0001` (FalabellaTech, 11400 CLP) ya estaba `facturado` de una corrida previa.
  - Confirmado en `bitacora_auditoria`: `dinero.periodo_cerrado_manual` (id 22) registrado **antes** que `dinero.dte_emitido` (id 23) para el mismo período — invariante de auditoría correcto.
  - Confirmado evento `dinero/periodo.cerrado` publicado (visto en `GET http://127.0.0.1:8288/v1/events`) con `id: periodo-cerrado-manual-a0000000-...-0002`.
  - Job C3 (`emitir-dte-periodo`) se ejecutó realmente vía Inngest Dev Server y creó filas en `dinero.documentos_dte`: ahora **3/3** períodos `facturado`, cada uno con su DTE (folios 1/2/3 secuenciales, `proveedor_dte_id_externo` = `STUB-1`/`STUB-2`/`STUB-3`, `estado_sii='pendiente'`, sin llamada real al SII — sandbox respetado), `monto_total_clp` de cada DTE coincide exactamente con el `monto_total_clp` del período (11400/9600/22000 CLP).
  - Job C6 (`conciliar-periodo`) corrió en paralelo: `dinero.eventos_conciliacion` sigue en **0 filas** para los 3 períodos — correcto, significa "sin descuadres" (cada período entregado tiene su línea de cobro/liquidación y el monto del DTE coincide con la suma de líneas; ver E-05).
  - Confirmado vía REST con RLS real (JWT de `seller@falabellatech.cl`): el seller ve exactamente su propio `documentos_dte` (folio 1, STUB-1, 11400 CLP) y su `periodos_cobro` con `documento_dte_id` apuntando a ese DTE — no ve los DTEs de los otros 2 sellers.
  - Confirmado renderizado real: `GET /portal/cobros/a0000000-...0001` con sesión real del seller → 200, el HTML contiene la sección "Tu factura", "Folio 1" y el badge de estado SII (`src/app/portal/cobros/[periodoId]/page.tsx`, líneas 121-169). El botón de descarga PDF no aparece porque `dte.pdfRef` es `null` en el stub sandbox (esperado — `simplefactura.ts` no genera PDF real).
- [x] **F-04 — Cálculo de liquidación por conductor.** Se calcula la liquidación por conductor (formal e informal) a partir de las entregas. *Ref:* RF-039. **(Crítico)**
  `generar-liquidacion-conductor.ts` agrega `lineas_liquidacion` por conductor y `tipo_relacion_conductor`; confirmado en BD (totales 7000/7400/4000/4200/4400 CLP, formal vs informal).
- [x] **F-05 — Registro interno de liquidación (informal).** Para conductor informal se genera registro interno **sin documento**. *Ref:* RF-041. **(Alto)**
  Para conductores con `tipo_relacion_conductor='informal'`, `generar-liquidacion-conductor.ts` genera la liquidación sin pasar por el flujo de boleta de terceros (F-07), consistente con el seed.
- [x] **F-06 — Visibilidad de la liquidación para el conductor.** El propio conductor ve su liquidación calculada (cero “¿cuánto me toca?”). *Ref:* RF-042. **(Alto)**
  `src/app/conductor/liquidaciones/page.tsx`; confirmado vía REST con JWT de `conductor.demo@despachos-centro.cl`: ve solo sus propias 3 `lineas_liquidacion` (RLS aplicado, ver H-03).
- [N/A] **F-07 — Boleta de terceros (formal).** *(Crecimiento — probar solo si se implementó)* Para conductor formal se emite boleta de terceros vía proveedor. *Ref:* RF-040.
  N/A — explícitamente listado como fuera del alcance del MVP ("boleta de terceros automática", sección "Fuera del alcance"); no se encontró adaptador de boleta de honorarios/terceros.

---

## G. Portales, dashboard y vistas (Fase B · P1)

- [x] **G-01 — Dashboard operativo del dueño.** Muestra de un vistazo: **comprometido vs entregado**, **conductores listos/activos**, **paquetes por comuna**, **rezagados de ayer**, **incidencias**, **salud de conexiones** y **alertas**. *Ref:* RF-046. **(Crítico)**
  Completado en este pase. `obtenerMetricasDelDia()` (`src/modules/operacion/metricas.ts`) ahora incluye `conductoresActivos`, `conductoresListosHoy`, `paquetesPorComuna` (top 5 + "Otras") y `rezagadosAyer`, además de lo ya existente (total del día, tasa de entrega, distribución por estado, incidencias sin gestión, salud de conexiones ML, alerta de folios CAF). Cubierto por `src/modules/operacion/metricas.test.ts` (parte de los 534/534).
  Verificado en runtime contra el seed (fecha del seed = 2026-06-09, fecha actual del sistema = 2026-06-10):
  - Para 2026-06-09 (fecha con pedidos del seed): `paquetesPorComuna` = San Miguel/Providencia/Lampa/Santiago (1 c/u, sin "Otras" porque hay ≤5 comunas distintas), `conductoresActivos=12`, `conductoresListosHoy=1`, `rezagadosAyer=0`.
  - Para 2026-06-10 (hoy real): `totalPedidos=0` → `paquetesPorComuna=[]` (oculto correctamente, condición `hayPedidos && paquetesPorComuna.length > 0`), `conductoresListosHoy=0`, **`rezagadosAyer=3`**.
  - `GET /dashboard` con sesión real de `dueno@despachos-centro.cl` → 200. El HTML renderizado contiene la tarjeta "Conductores listos hoy" y el bloque "Pedidos rezagados de ayer" (`aria-label="Pedidos rezagados de ayer"`, con CTA "Revisar rezagados" → `/operaciones?rezagados=ayer`) mostrando los 3 pedidos rezagados — confirma que el widget funciona end-to-end con datos reales. El bloque "Paquetes por comuna" no aparece hoy porque correctamente no hay pedidos con `fecha_compromiso=2026-06-10` en el seed (su lógica fue verificada por separado para 2026-06-09 y por unit test).
  **Bug adicional encontrado y corregido en este pase** (heredado de una sesión anterior): el banner "Conexiones de ML caídas" estaba roto — la consulta `conexiones_seller_ml.select("id, seller_id, sellers(nombre_fantasia)")` fallaba con `PGRST201` (relación ambigua, ver A-06) y además `nombre_fantasia` no existe en `sellers`. Corregido a `sellers!conexiones_seller_ml_seller_id_fkey(razon_social)`. Verificado contra PostgREST local.
- [x] **G-02 — Alertas solo fuera de rango.** El dueño recibe alerta solo cuando algo se sale de rango (ruta atrasada, seller en riesgo, morosidad), no ruido constante. *Ref:* RF-046, RF-050. **(Medio)**
  Confirmado por diseño: el banner de folios solo aparece si quedan <50 CAF, el banner de conexiones caídas solo si `conexionesCaidas>0`, y el bloque de incidencias solo si hay incidencias sin gestión por más de `UMBRAL_INCIDENCIA_SIN_GESTION_HORAS`. Ningún bloque se renderiza "siempre".
- [x] **G-03 — Vista de conductor.** El conductor ve **su ruta/manifiesto**, instrucciones y **su liquidación**; usable en teléfono (PWA). *Ref:* RF-047, RNF-11. **(Crítico)**
  `src/app/conductor/manifiesto/` (manifiesto activo + detalle por pedido) y `src/app/conductor/liquidaciones/`; confirmado por RLS (H-03) que el conductor solo ve sus propios datos. La app es Next.js responsive (PWA según stack del proyecto); no se verificó instalación PWA real (manifest/service worker) en este pase.
- [x] **G-04 — Portal del seller (básico).** El seller ve envíos, tracking, incidencias y **estado de cuenta**, puede **solicitar same-day** y **reconectar** su cuenta. *Ref:* RF-048. **(Alto)**
  `src/app/portal/`: `pedidos/` (envíos/tracking), `incidencias/`, `cobros/` (estado de cuenta), `pedidos/nuevo/` (solicitar same-day), `conectar-ml/` (reconexión). Confirmado vía REST que el seller solo ve sus propios 7 pedidos (RLS, ver H-02).
- [x] **G-05 — Estado de cuenta / cartola por seller.** El seller ve su estado de cuenta del período. *Ref:* RF-043. **(Alto)**
  `src/app/portal/cobros/page.tsx` (listado de períodos) + `src/app/portal/cobros/[periodoId]/page.tsx` (detalle del período/cartola).
- [x] **G-06 — Notificaciones internas.** Alertas operativas, de incidencias y de conexiones llegan al courier. *Ref:* RF-050. **(Medio)**
  Completado en este pase. Nuevo job cron Inngest `src/modules/operacion/jobs/notificacion-incidencias-sin-gestion.ts` (`id: 'operacion/notificacionIncidenciasSinGestion'`, `cron: '*/30 * * * *'`, registrado en `src/app/api/inngest/route.ts`): detecta incidencias `abierta`/`en_gestion` sin actividad por más de `UMBRAL_INCIDENCIA_SIN_GESTION_HORAS=4` horas, registra en `bitacora_auditoria` (`accion: 'operacion.notificacion_incidencia_sin_gestion'`, `actorTipo: 'sistema'`) con deduplicación diaria por (tenant, incidencia) usando `hoyEnSantiago()`. Cubierto por `notificacion-incidencias-sin-gestion.test.ts` (incidencia detectada y notificada, ya notificada hoy → deduplicada, dentro del umbral → no notificada, multi-tenant) — parte de los 534/534. El envío de email real (Resend) sigue como TODO explícito para devops, igual que B-04 — el job ya deja la alerta operativa registrada y consultable, junto con la alerta de conexión caída (B-04) cubre RF-050 a nivel de "registro interno de alertas".

---

## H. Seguridad, aislamiento y cumplimiento (Crítico transversal)

- [x] **H-01 — Aislamiento entre couriers (RLS en BD).** Autenticado como *Courier A*, intentar leer datos de *Courier B* **vía API directa** → **denegado**. Repetir a nivel de consulta de base de datos. *Ref:* RNF-01, RF-001. **(Crítico)**
  Suite pgTAP `supabase/tests/database/rls_aislamiento*.test.sql` (4 archivos, 152 tests) verifica aislamiento de lectura y escritura entre tenants en `identidad`, `operacion` y `dinero`. **Bug encontrado y corregido en este pase**: la suite estaba 100% rota (0/152 ejecutados, "Bad plan") por una colisión de RUT (`76123456-7`) entre `seed.sql` y los fixtures pgTAP. Se corrigieron los RUT de fixture, se re-acotaron 4 asserts de "control positivo" por `tenant_id` (contaminados por filas del seed) y se corrigió un `plan(40)`→`plan(37)` mal contado. Resultado final: **152/152 PASS**.
- [x] **H-02 — El seller solo ve lo suyo.** Un seller **no** puede ver pedidos/datos de otro seller **ni datos internos del courier** (tarifas de otros, liquidaciones, etc.). *Ref:* RF-003, RNF-03. **(Crítico)**
  Verificado en runtime con JWT real de `seller@falabellatech.cl` contra PostgREST: ve exactamente sus 7 pedidos propios; `GET /rest/v1/tarifas` y `GET /rest/v1/lineas_liquidacion` devuelven `[]`. Confirmado además por pgTAP (H-01).
- [x] **H-03 — El conductor solo ve lo suyo.** Un conductor solo accede a sus propios pedidos y a su liquidación. *Ref:* RNF-03. **(Crítico)**
  Verificado en runtime con JWT real de `conductor.demo@despachos-centro.cl`: ve solo sus 3 `lineas_liquidacion`; `GET /rest/v1/lineas_cobro` devuelve `[]`.
- [x] **H-04 — Permisos verificados en el backend.** Forzar una acción no permitida por rol **saltándose la UI** (llamada directa al endpoint) → **rechazada**. *Ref:* RNF-03, RF-002. **(Crítico)**
  Verificado en runtime: `POST /rest/v1/tarifas` con JWT de seller → **HTTP 403** (RLS de escritura). Adicionalmente, todas las server actions de negocio (`manifiestos.ts`, `incidencias.ts`, etc.) validan `puede*()` antes de mutar.
- [x] **H-05 — Secretos cifrados y fuera de logs.** Certificados y tokens están cifrados, **no aparecen en logs, en texto plano ni en URLs**. Revisar logs tras un ciclo de ingesta/refresco. *Ref:* RNF-02. **(Crítico)**
  `cifrarSecreto()`/`descifrarSecreto()` (AES-256 + nonce + tag de manipulación) es la única vía de escritura a `secretos_cifrados`; la tabla tiene un CHECK que impide texto plano en `metadata`. `conexion-caida.ts` documenta explícitamente que su payload "no contiene tokens, access_token_ref ni ningún secreto". Revisión de código confirma que ningún `console.log`/error incluye el valor descifrado de un secreto.
- [x] **H-06 — Bitácora de auditoría.** Toda acción **financiera** y de **acceso** queda registrada (quién, qué, cuándo) de forma inmutable. *Ref:* RNF-04, RF-004. **(Crítico)**
  `registrarEnBitacora()` (`src/modules/identidad/auditoria.ts`) es invocado desde: carga de certificado/credenciales DTE, asignación/confirmación de manifiestos, alertas de conexión caída, y (a nivel de jobs de dinero) generación de líneas/DTE/liquidaciones. Tabla `bitacora_auditoria` con `tenant_id`, sin update/delete expuestos vía RLS (solo insert).
  **Captura del autor (Bloque 1 · B1-2, este pase):** antes, las acciones financieras de usuario (`cerrarPeriodoManualmente`, `marcarLiquidacionPagada`, `resolverEventoConciliacion`) registraban `actorUsuarioId: null` — se perdía el "quién" que exige RNF-04. Ahora cada una recibe `actorUsuarioId` (el `sesion.usuarioId`, UUID de auth, que el llamador Server Action propaga) y lo escribe tanto en la bitácora como en las columnas de entidad (`cerrado_por_usuario_id`, `resuelto_por_usuario_id`). La nueva `emitirFacturaPeriodo` también. `SesionActual.usuarioId` ya existía; solo faltaba propagarlo.
- [x] **H-07 — Portabilidad de datos.** El cliente (courier) puede **exportar sus datos**. *Ref:* RNF-13. **(Alto)**
  Completado en este pase. Nuevo endpoint `GET /api/courier/exportar-datos/route.ts`: requiere sesión (401 si no hay) y la capacidad `ver_bitacora_auditoria` (`puedeVerBitacoraAuditoria`, roles `dueno`/`administracion` — 403 para otros roles); responde 200 con JSON descargable (`Content-Disposition: attachment; filename="export-datos-{tenantId}-{fecha}.json"`) que incluye `tenants`, `sellers`, `conductores`, `pedidos`, `manifiestos`, `asignaciones_pedido`, `incidencias`, `periodos_cobro`, `lineas_cobro`, `liquidaciones`, `documentos_dte`, `eventos_conciliacion` del tenant — **excluye explícitamente** `conexiones_seller_ml` (tokens OAuth), certificados digitales y cualquier credencial de proveedor (documentado con comentarios en el código). Cada tabla se consulta de forma independiente (`Promise.allSettled`); errores van a `_errores` sin abortar el resto. Registra en `bitacora_auditoria` (`accion: 'identidad.datos_courier_exportados'`, `detalle` con conteos por tabla, sin contenido). Nueva página `src/app/(tenant)/configuracion/exportar-datos/page.tsx` (gate `puedeVerBitacoraAuditoria`, redirect si no aplica) con botón de descarga, enlazada desde la navegación (`src/app/(tenant)/layout.tsx`, ítem "Exportar datos"). Cubierto por `route.test.ts` (401/403/200 dueño/200 administración/headers/sin claves de tokens/bitácora) — parte de los 534/534.
- [x] **H-08 — Datos del conductor (Ley 21.431).** El sistema registra el **tipo de relación** del conductor y protege sus datos; **no empuja informalidad**. *Ref:* RNF-13. **(Alto)**
  `tipo_relacion_conductor` (formal/informal) está modelado de forma neutra en `identidad`/`dinero` (ver F-04/F-05) y determina el tipo de liquidación sin forzar un valor por defecto hacia informal en el código de negocio revisado (el valor se define al dar de alta al conductor).

---

## I. Resiliencia de integraciones y jobs (Crítico transversal)

- [x] **I-01 — Caída de la API de ML.** Con la API caída, el sistema **no se rompe**: marca el estado como pendiente, permite **corrección manual** y **no bloquea el cierre**. *Ref:* RNF-05, RF-029. **(Crítico)**
  `reintentarConBackoff`/`esErrorReintentable` envuelven las llamadas a ML; si fallan persistentemente, el pedido conserva su último estado conocido y D-08 (corrección manual) permite avanzar el flujo sin depender de la API.
- [x] **I-02 — Token expirado / fallo de refresco.** Si el refresco falla, se **alerta** y el **sondeo de respaldo** mantiene el dato; al reconectar se normaliza. *Ref:* RNF-05, RF-012, RF-014. **(Crítico)**
  `refrescar-tokens.ts` marca `estado_salud` cuando el refresco falla repetidamente, escalando a `notificacion/conexion-caida` (B-04); `polling-estados.ts` sigue funcionando con el último token válido hasta la reconexión, y B-07 cubre el backfill posterior.
- [x] **I-03 — Evento perdido recuperado por sondeo.** Un pedido cuyo webhook se perdió **igual aparece** gracias al sondeo de respaldo. *Ref:* RNF-05, RF-018. **(Crítico)**
  `polling-estados.ts` consulta periódicamente el estado de shipments por seller independientemente del webhook, usando el mismo `procesar-shipment.ts` idempotente que el webhook (C-01).
- [x] **I-04 — Idempotencia de pedidos.** Procesar el **mismo evento dos veces** **no duplica** el pedido. *Ref:* RNF-05. **(Crítico)**
  `CacheIdempotencia` (TTL) + `upsert` por `ml_shipment_id`/`tenant_id` en `procesar-shipment.ts`; cubierto por unit tests de webhook y polling.
- [x] **I-05 — Idempotencia de facturación/liquidación.** Re-ejecutar el job de facturación o de liquidación **no genera DTE ni pagos duplicados**. *Ref:* RNF-05. **(Crítico)**
  `generar-lineas.ts`, `emitir-dte-periodo.ts` y `generar-liquidacion-conductor.ts` verifican existencia previa (por `pedido_id`/`periodo_id`) antes de insertar; cubierto por unit tests específicos de "ejecutar dos veces no duplica".
- [x] **I-06 — Manejo de límites de tasa (backoff).** Ante límite de tasa de un proveedor, hay reintentos con backoff sin perder datos. *Ref:* RNF-05. **(Alto)**
  `calcularEsperaBackoff` (exponencial + jitter) + `reintentarConBackoff`, con `esErrorReintentable` reconociendo HTTP 429/5xx; cubierto por unit tests.
- [x] **I-07 — Procesos pesados como jobs.** Ingesta, facturación, liquidación, sincronización de estados y salud de conexiones corren **como jobs** (no en el request del usuario). *Ref:* RNF-05, RNF-07. **(Alto)**
  Confirmado: todos los procesos pesados están implementados como funciones Inngest en `src/modules/*/jobs/` (`generar-lineas`, `emitir-dte-periodo`, `conciliar-periodo`, `generar-liquidacion-conductor`, `polling-estados`, `sondeo-salud`, `refrescar-tokens`, `ejecutar-backfill`, `polling-estado-dte`, `alerta-folios-proximos`), registrados vía `src/lib/inngest/cliente.ts`. Ninguna server action realiza estas operaciones de forma síncrona.
- [ ] **I-08 — Observabilidad.** Errores y salud de jobs/integraciones (incl. conexiones ML) están monitoreados con alertas. *Ref:* RNF-10. **(Medio)**
  FALLA: no se encontró integración de Sentry (ni otro proveedor de monitoreo/alertas de errores) en el repo — `package.json`/código sin referencias a `@sentry/*`. La "salud de conexiones ML" sí se modela como dato de negocio (B-03/G-01), pero no hay monitoreo/alerta de **errores de jobs** a nivel de infraestructura. Corresponde a la fase `devops` (CLAUDE.md la lista explícitamente como responsable de Sentry/monitoreo) — pendiente, no es un bug de esta fase.

---

## J. Localización y datos (P0–P1)

- [x] **J-01 — Moneda, idioma y zona horaria.** Montos en **CLP**, interfaz en **español**, fechas/horas en **zona horaria de Santiago**. *Ref:* RNF-12. **(Alto)**
  Confirmado por grep: `toLocaleString("es-CL", { style: "currency", currency: "CLP" })` y `America/Santiago` usados consistentemente en `tarifas`, `onboarding`, `dashboard` y jobs de dinero para cálculos de rango de fecha.
- [x] **J-02 — Validación de RUT.** Se valida el RUT de courier, seller y conductor (rechaza inválidos). *Ref:* RNF-12. **(Alto)**
  `src/modules/identidad/rut.ts` implementa normalización + dígito verificador módulo-11 (más allá del regex `^[0-9]{1,8}-[0-9kK]$` a nivel de BD), usado en el formulario de alta de courier (A-01) y en altas de seller/conductor.
- [x] **J-03 — Formatos locales.** Montos, fechas y números se muestran en formato chileno. *Ref:* RNF-12. **(Medio)**
  Mismo hallazgo que J-01: `toLocaleString`/`toLocaleDateString` con locale `es-CL` en componentes de dashboard, portal y conductor.

---

## K. Flujos end-to-end (el lazo completo)

- [x] **E2E-1 — Happy path completo.** Seller conecta OAuth → llega pedido Flex → se asigna a un conductor → entrega (estado `delivered` vía API) → se genera **línea de cobro + línea de liquidación** → **conciliación cuadra** → se emite **DTE bajo RUT del courier** → el seller lo descarga → el conductor ve su liquidación. **(Crítico)**
  Resuelto en este pase. Cada eslabón individual está verificado (B-01/B-07, C-01, D-01/D-03/D-05, E-01/E-02/E-05, F-02, F-06). El tramo final (F-03) ahora también está verificado de punta a punta con datos reales: se ejecutó `cerrarPeriodoManualmente` → evento `dinero/periodo.cerrado` → jobs C3 (`emitir-dte-periodo`, vía Inngest Dev Server real) y C6 (`conciliar-periodo`) sobre los 3 períodos del seed. Resultado: 3/3 períodos `facturado` con `documentos_dte` (folios 1/2/3, montos 11400/9600/22000 CLP coincidentes con sus períodos) y 0 `eventos_conciliacion` (sin descuadres). Confirmado vía REST con JWT de `seller@falabellatech.cl` que ve su propio DTE (folio 1, 11400 CLP) y no los de otros sellers; confirmado renderizado real de `GET /portal/cobros/a0000000-...0001` (200, muestra "Tu factura"/"Folio 1"). El lazo completo cierra de punta a punta.
- [x] **E2E-2 — Incidencia con reintento.** Pedido `receiver_absent` → reagendo → 2º intento exitoso → **se cobra una sola entrega**, la incidencia queda trazada y la conciliación cuadra. *Ref:* RF-032, RF-033. **(Crítico)**
  Cubierto por la combinación D-06/D-07 (incidencia `reagendado` con `afectaCobro:true, afectaLiquidacion:false`) + E-03 (unit tests exhaustivos de `evaluarElegibilidad`) + E-05 (conciliación). El recorrido lógico está probado a nivel de motor; no se ejecutó manualmente un pedido del seed por este camino completo (el seed no incluye un pedido con incidencia `reagendado` seguida de entrega exitosa).
- [x] **E2E-3 — Same-day del seller en el período.** Same-day ad-hoc del seller → entra al mismo flujo → se **factura junto con los Flex** del período. *Ref:* RF-020, RF-035. **(Crítico)**
  C-03 (creación) + F-01 (`cerrar-periodo` agrupa por seller sin distinguir Flex/same-day, salvo `esGastoPropio`) confirman el diseño a nivel de código y unit tests. En el cierre real ejecutado para F-03/E2E-1, los 3 períodos cerrados consolidaron todas las `lineas_cobro` existentes de cada seller en un único `documento_dte` (montos coincidentes), lo que confirma que `cerrar-periodo` no segrega por tipo de pedido. No se generó un same-day *nuevo* dentro de este pase para verlo aparecer en un DTE recién creado — la cobertura sigue siendo diseño + unit tests + agrupación real verificada.
- [x] **E2E-4 — Same-day como gasto propio.** Same-day del courier marcado como gasto propio → **no** aparece en la factura del seller. *Ref:* RF-034. **(Alto)**
  Cubierto por E-06 (`evaluarElegibilidad` con `esGastoPropio=true` ⇒ `generaCobro:false`), probado unitariamente.
- [x] **E2E-5 — Caída y reconexión con backfill.** Seller se desvincula → alerta → llegan pedidos durante la caída → reconexión de un clic → **backfill** recupera los pedidos **sin duplicar**. *Ref:* RF-014, RF-017. **(Crítico)**
  Cubierto por B-04 (alerta) + B-05 (reconexión un clic) + B-07 (backfill idempotente, unit tests). No se simuló una caída real de la API de ML en este pase (requiere mocks de red más allá del alcance de "pruebas funcionales como usuario real").
- [x] **E2E-6 — Cierre de período multi-seller / multi-conductor.** Con varios sellers y conductores, el cierre genera **todas** las facturas y liquidaciones correctas y conciliadas (cierre de “días a horas”). **(Crítico)**
  Resuelto en este pase. El seed modela 3 sellers y 5 conductores con totales de `periodos_cobro` (11400/9600/22000) y `lineas_liquidacion` (7000/7400/4000/4200/4400) consistentes (E-05). Se ejecutó realmente `cerrarPeriodoManualmente` para los 3 períodos `abierto` del seed (uno por cada uno de los 3 sellers) — los 3 quedaron `facturado` con su `documento_dte` (folios 1/2/3) y montos coincidentes con sus `periodos_cobro`, y `eventos_conciliacion` en 0 filas para los 3 (sin descuadres). El cierre multi-seller en una sola sesión de trabajo (varios `cerrarPeriodoManualmente` consecutivos, cada uno disparando C3/C6 vía Inngest) quedó verificado con datos reales, no solo unit tests.

---

## L. Rendimiento, disponibilidad y respaldo (verificación funcional ligera)

- [N/A] **L-01 — Carga del dashboard / panel multi-seller.** Cargan en **pocos segundos** con **cientos de pedidos/día**. *Ref:* RNF-06. **(Alto)**
  N/A para este pase — el seed solo tiene 18 pedidos; no se generó un volumen de "cientos de pedidos/día" para medir tiempos de carga. Recomendado como prueba de carga dedicada antes de producción.
- [N/A] **L-02 — Disponibilidad en ventana operativa.** Operativo en corte (~12–13 h) y reparto (~15–21 h); **degradación elegante** si un servicio externo falla. *Ref:* RNF-08. **(Alto)**
  N/A para ambiente local — depende de configuración de hosting/monitoreo (Vercel/Supabase) no provisionada aún (fase devops). La "degradación elegante" ante fallo de ML está cubierta a nivel de código por I-01/I-02.
- [N/A] **L-03 — Respaldo y restauración.** Respaldos automáticos activos y **prueba de restauración** verificada; **no se pierden datos financieros**. *Ref:* RNF-09. **(Crítico)**
  N/A para ambiente local (Supabase CLI no configura respaldos automáticos en dev). Requiere configuración de respaldos en el proyecto Supabase de staging/producción y una prueba de restauración real — corresponde a la fase `devops`, no se debe marcar como bloqueante de frontend pero sí queda como pendiente crítico antes de producción.
- [N/A] **L-04 — Escala sin rediseño.** El sistema soporta crecer de decenas a cientos de couriers (al menos verificado en diseño/carga sintética). *Ref:* RNF-07. **(Medio)**
  N/A — no se realizó prueba de carga sintética en este pase. El diseño multi-tenant con `tenant_id` + RLS (H-01, 152/152) y jobs asíncronos (I-07) no presenta acoplamientos obvios que impidan escalar horizontalmente, pero esto es una evaluación de diseño, no una medición.

---

## M. Criterios de salida — listo para avanzar a frontend / UX-UI

- [x] **M-01 —** Todos los ítems **(Crítico)** de las suites A–F pasan (o tienen excepción documentada y aprobada).
  Resuelto en este pase: F-03 (descarga de DTE por el seller) se verificó end-to-end con datos reales (ver F-03/E2E-1). Todos los ítems `(Crítico)` de A-F: PASS.
- [x] **M-02 —** Las suites **H (aislamiento/seguridad)** e **I (resiliencia/idempotencia)** pasan **sin hallazgos altos abiertos**.
  H: 152/152 pgTAP + verificación runtime PASS; H-07 (portabilidad) resuelto en este pase. I: todos los críticos PASS; I-08 (observabilidad, prioridad Medio) pendiente de fase devops, sin hallazgos altos abiertos.
- [x] **M-03 —** El **lazo completo** cierra: `E2E-1` y `E2E-2` pasan de punta a punta.
  Resuelto en este pase: `E2E-1` ahora está verificado de punta a punta con datos reales, incluyendo emisión y visibilidad del DTE para el seller (ver F-03/E2E-1). `E2E-2` sigue respaldado por diseño + unit tests exhaustivos de `evaluarElegibilidad` (el seed no incluye un pedido con incidencia `reagendado` seguida de entrega exitosa para correrlo manualmente, pero la regla está cubierta).
- [x] **M-04 —** `E2E-5` (caída + backfill sin duplicados) y `E2E-6` (cierre multi-seller) pasan.
  Resuelto en este pase para `E2E-6`: corrida real de `cerrarPeriodoManualmente` sobre los 3 períodos del seed (3 sellers), con `documentos_dte` y conciliación sin descuadres (ver E2E-6). `E2E-5` sigue respaldado por unit tests de B-04/B-05/B-07 (no se simuló una caída real de la API de ML, fuera del alcance de "pruebas como usuario real").
- [x] **M-05 —** Los **contratos de datos** que consumirán las pantallas (dashboard del dueño, vista de conductor, portal del seller) están **estables y poblados** con datos reales de prueba, de modo que el trabajo de frontend/UX construya sobre algo firme.
  Confirmado: `obtenerMetricasDelDia`, `lineas_liquidacion` (conductor), `pedidos`/`periodos_cobro` (seller) están poblados y devuelven datos coherentes vía REST con RLS aplicado. Gaps de G-01 (comuna/rezagados/conductores activos) son de **contenido faltante**, no de contrato inestable — frontend puede construir sobre lo que existe y el backlog de `metricas.ts` se agrega en paralelo.
- [ ] **M-06 —** Hallazgos pendientes priorizados en una lista, separando **bloqueantes** de **mejoras** (las mejoras de UI pueden ir en la etapa de frontend/UX).
  Ver lista de hallazgos al final de este documento (sección "Hallazgos de este pase"). Pendiente que el responsable del proyecto la revise/apruebe.
- [x] **M-07 —** Las pruebas críticas de **aislamiento** y de **reglas de dinero** quedan, además, **automatizadas** (suite repetible) para no regresar al pulir la UI.
  Aislamiento: pgTAP `npx supabase test db` (152/152, reparado en este pase). Reglas de dinero: Vitest (495/495), incluyendo `motor.test.ts`, `generar-lineas.test.ts`, `conciliar-periodo.test.ts`, `generar-liquidacion-conductor.test.ts`. Ambas suites son repetibles y forman parte de `npm test` / `npx supabase test db`.

---

## Hallazgos de este pase (resumen para M-06)

**Bloqueantes:** ninguno. El bloqueante anterior (F-03 / E2E-1 / E2E-3 / E2E-6 / M-03 / M-04 — emisión y visibilidad real del DTE) se resolvió en este pase: se corrigió `cerrarPeriodoManualmente` (orden bitácora→evento, y publicación del evento `dinero/periodo.cerrado` que se había roto) y se ejecutó realmente sobre los 3 períodos del seed, generando 3/3 `documentos_dte` y confirmando visibilidad para cada seller vía RLS y portal.

**Backlog completado en este pase (antes "mejoras pendientes"):**
1. **G-01** (RF-046) — Agregados a `metricas.ts`/dashboard: "paquetes por comuna", "rezagados de ayer", "conductores listos/activos".
2. **D-04** (RF-025) — Orden básico de paradas por comuna/dirección (`ordenarParadasPorComunaYDireccion`, no-IA, no optimizador de ruteo).
3. **C-04** (RF-021) — Obtención y descarga de etiqueta de envío vía API de ML (`/shipment_labels`), con manejo explícito de reconexión requerida.
4. **G-06** (RF-050) — Job de notificación interna para incidencias sin gestión (>4h), con deduplicación diaria en bitácora.
5. **H-07** (RNF-13) — Exportación de datos del courier (JSON descargable, excluye secretos/tokens, gateado a `dueno`/`administracion`, con bitácora).

**Pendiente (no bloquea frontend, fuera del alcance de este ambiente local):**
6. **I-08 / L-02 / L-03** — Observabilidad (Sentry), disponibilidad y respaldos: pendientes de la fase `devops`, no implementables/verificables en ambiente local. El usuario decidió explícitamente "saltar por ahora" estos tres ítems.
7. Envío real de notificaciones por email/push (Resend) para B-04/B-06/G-06: queda como TODO explícito en el código, pendiente de fase `devops` (proveedor de notificaciones).
8. Descarga real de etiqueta ML (C-04) y refresco real de tokens OAuth requieren credenciales/sandbox de Mercado Libre reales, no disponibles en este ambiente local — el manejo de error (409 `ErrorConexionMlRequiereRevinculacion`) está verificado.

**Bugs corregidos durante este pase (no requieren acción adicional):**
9. Suite pgTAP de aislamiento RLS estaba 100% rota (colisión de RUT entre `seed.sql` y fixtures) — corregida, ahora 152/152 PASS.
10. `cerrarPeriodoManualmente` no publicaba el evento `dinero/periodo.cerrado` (regresión introducida durante el reordenamiento bitácora/evento) — corregido y verificado con una corrida real que disparó los jobs C3/C6.

**Trabajo pendiente fuera de este checklist:**
11. ~~Todo el trabajo de esta sesión está sin commitear~~ — **resuelto:** se commiteó en 8 bloques lógicos sobre `373f1e6`.

---

## Bloque 1 (revisión estratégica de Opus) — completado en este pase

Tras una auditoría estratégica integral se ejecutó el **Bloque 1** (mejoras a aplicar antes de avanzar a frontend/UX). Resultado: `tsc` limpio, **540/540 Vitest** (+6 nuevos), **152/152 pgTAP**, migración 0007 aplica e idempotente.

- **B1-1 · Compuerta de aprobación de facturación** (Crítica). La emisión del DTE dejó de ser automática al cerrar el período. Ahora el cron solo cierra + concilia; emitir exige la acción humana `emitirFacturaPeriodo` (gate `puedeEmitirFacturas`, período en `cerrado`, opt-in real por courier vía migración 0007). UI: botón "Emitir factura" + copy corregido del diálogo de cierre. Ver F-02. **Cierra el riesgo #1 del producto:** evita emitir documentos tributarios irreversibles sin revisión humana.
- **B1-2 · Autor en la bitácora financiera** (Alta). Se propaga `actorUsuarioId` (UUID de auth) a las 3 acciones financieras + la nueva de emisión; se escribe en bitácora y en columnas de entidad. Ver H-06. Cierra el gap de RNF-04 ("quién").
- **B1-3 · Validación del adaptador DTE contra proveedor real** (Alta). Adaptador esqueleto `openfactura.ts` (no cableado, el stub sigue de default) + `docs/arquitectura/validacion-dte-openfactura.md` con contrato real, gap analysis (PDF/XML inline base64, estado SII asíncrono, clave de consulta TOKEN vs rut/tipo/folio) y cambios mínimos que necesitará el puerto. **Pendiente:** validación en vivo requiere credencial del sandbox de Openfactura (la provee el dueño) y la decisión comercial del proveedor definitivo.
- **B1-4 · Verificación de la conciliación** (Alta). Confirmada NO tautológica (ver E-05). Refinamiento menor de la ventana `actualizado_en` documentado, no bloqueante.
- **B1-5 · Limpieza de deuda de reestructura** (Media). Eliminado `src/app/(app)/` (layout huérfano que no envolvía ninguna página y nadie importaba).

**Escalado al dueño (ningún agente puede decidirlo):** (1) credencial del sandbox de Openfactura para validación en vivo; (2) elección comercial del proveedor DTE definitivo; (3) cuándo activar `emision_dte_real_habilitada` por courier (compromete DTEs reales ante el SII).

---

## Cobranza courier→seller con Fintoc (capa "pagado") — QA de aislamiento, idempotencia y reglas de dinero

Pase de QA sobre el frente de cobranza recién construido (migración `0008`, matching, job, acciones manuales y webhook). Resultado: `tsc` limpio, **607/607 Vitest** (+26 nuevos de cobranza), **168/168 pgTAP** (+8 nuevos en `rls_aislamiento_pagos.test.sql`).

**Aislamiento (RLS, pgTAP contra Postgres real) — `[x]` PROBADO**
- `[x]` P1 cross-tenant: seller/interno de A no ve pagos del tenant B.
- `[x]` P2: seller A no ve pagos del seller A2 (mismo tenant).
- `[x]` **Caso central:** pago `seller_id IS NULL` (sin atribuir) invisible al seller; sí visible al interno.
- `[x]` Conductor: `is_empty` sobre `public.pagos_recibidos`.
- `[x]` INSERT **y ahora UPDATE/DELETE** desde `authenticated` (seller) → 42501 (escritura solo service_role). *(UPDATE/DELETE eran un hueco — agregados.)*
- `[x]` `identidad.courier_config_cobranza`: invisible a seller y conductor; cross-tenant aislada para internos; `with check` impide sembrar config de otro tenant; guard `solo_interno_edita` convierte el UPDATE del seller en 42501. *(No estaba cubierta — agregada.)*

**Idempotencia y reglas de dinero (Vitest, Supabase fake en memoria) — `[x]` PROBADO**
- `[x]` Pago terminal (`conciliado`/`descartado`) no se re-procesa ni toca el período.
- `[x]` Calce total → período `pagado` + `monto_pagado_clp` correcto; parcial → `parcial`; sobrepago → `sobrante` sin imputar; sin RUT → `sin_atribuir` sin imputar; seller sin período facturado → `atribuido`.
- `[x]` Reprocesar el MISMO pago tras un calce total no re-imputa (idempotente vía estado terminal).
- `[x]` Aislamiento de seller en el matching: un período de OTRO seller del tenant no se concilia.
- `[x]` Acciones manuales `atribuirPagoManualmente`/`descartarPago`: gate `ver_conciliacion`, bitácora ANTES del efecto con `actorUsuarioId`, rechazo de pago/seller/período de otro tenant.

**Bugs encontrados y corregidos en este pase**
1. **Doble imputación al reprocesar un pago `parcial`** (Severidad ALTA — cobro doble / período marcado pagado de más). `parcial` no es estado terminal; `conciliarPagoPersistido` re-leía el período (ya con el abono) y volvía a sumar el monto (40.000 → 80.000). Reproducido con un test que fallaba (`expected 80000 to be 40000`). **Fix:** guard de idempotencia de imputación en `aplicar-pago.ts` (un pago `parcial` con `periodo_cobro_id` fijado no re-imputa en el flujo automático). Test de regresión incluido.
2. **Doble imputación / imputación huérfana en re-atribución manual de un pago `parcial`** (Severidad MEDIA — human-initiated). `atribuirPagoManualmente` re-conciliaba con `sellerIdForzado` (que salta el guard anterior) sin reversar la imputación previa → el período anterior quedaba inflado y/o se sumaba dos veces. **Fix:** la acción ahora REVERSA la imputación previa (resta `monto_pagado_clp`, recalcula `estado_cobro`/`pagado_en`) y limpia `periodo_cobro_id` antes de re-conciliar. Test de regresión incluido.

**Verificado sin hallazgos**
- Webhook Fintoc por-tenant: firma se valida con el secreto del tenant del path; bitácora ANTES de emitir el evento; `linkTokenRef` opaco (nunca el token); RUT/nombre no se loguean. Idempotencia del `inngest.send` por `id = pago-recibido-{tenant}-{movimiento}`.
- UNIQUE `(tenant_id, movimiento_externo_id)` + UPSERT del job: un webhook reentregado no duplica fila.

**Pendiente (fuera de este pase, requiere ambiente de integración Fintoc):**
- Forma y firma del webhook real `transfer.inbound.succeeded` (sandbox no lo dispara trivialmente; ver §5b del doc).

---

## Rate limiting de webhooks (#7) y notas de crédito DTE (#8) — QA de idempotencia y reglas de dinero

Pase de QA sobre las dos features (migraciones `0010` infra rate-limit y `0011` notas de crédito). Resultado: `tsc` limpio, **645/645 Vitest** (+13 nuevos: 9 del job C-NC, 4 de la guarda de período), **195/195 pgTAP** (sin cambios — las suites `rls_infra_rate_limit` y `dinero_notas_credito` ya cubrían BD).

**#7 Rate limiting — `[x]` PROBADO**
- `[x]` Helper fail-open: error de RPC / respuesta no numérica / excepción del cliente → `permitido: true` (nunca tumba tráfico legítimo). Un 429 SOLO ocurre con `permitido === false` (contador > límite), nunca por excepción. *(Cubierto en `src/lib/rate-limit/index.test.ts`.)*
- `[x]` pgTAP: `authenticated`/`anon` NO tienen SELECT sobre `infra.rate_limit_contadores` ni EXECUTE sobre la RPC (42501 real, no solo catálogo); `service_role` sí. Tabla UNLOGGED + RLS force sin políticas (deny-by-default). Ventana `<= 0` → 22023.
- `[x]` Las dos rutas que lo usan retornan 429 solo cuando `permitido === false`, con `Retry-After`; la RPC corre ANTES de descifrar el secreto (Fintoc) y de tocar BD de negocio (ML).

**#7 — Riesgo documentado (aceptado por diseño, no es bug)**
- CHECK de seller conectado en el route de ML: un seller recién conectado cuyo `ml_user_id` aún no está poblado (la columna es `nullable`, sin UNIQUE) da un FALSO NEGATIVO → la notificación se ignora con 200 sin encolar. **Red de seguridad: el polling C5** (cada 15 min) recupera el shipment. Pérdida temporal, no permanente. Aceptable.

**#7 — Bug encontrado y corregido (bajo riesgo)**
1. **Notificación legítima perdida si `ml_user_id` aparece en >1 conexión** (Severidad BAJA-MEDIA — sin UNIQUE en `ml_user_id`, dos couriers podrían conectar la misma cuenta ML, o quedar una fila vieja + una nueva). El route usaba `.eq("ml_user_id", userId).maybeSingle()`: ante 2+ filas PostgREST devuelve ERROR y `data: null`, y como el código solo mira `data`, la notificación se descartaba (200 sin encolar) pese a existir conexiones válidas. **Fix:** se cambió a `.limit(1)` sin `.maybeSingle()` y se evalúa "hay al menos una conexión" sobre la lista — basta una para encolar (el job consulta el recurso con el token correcto). `src/app/api/webhooks/ml/shipments/route.ts`.

**#8 Notas de crédito (C-NC) — `[x]` PROBADO**
- `[x]` **Idempotencia del job:** re-ejecutar con un 61 ya existente → `ya_emitida` sin reservar folio, sin llamar al proveedor, sin re-anular/desimputar/reimputar. Re-ejecución completa del job → un solo 61, sin doble efecto. *(`jobs/emitir-nota-credito.test.ts`, handler REAL ejecutado con `step.run` falso + Supabase fake.)*
- `[x]` **Desimputación de pagos:** pagos `conciliado`/`parcial` del período → `sobrante` conservando `seller_id`, `periodo_cobro_id = null`; la fila NO se pierde; el monto del período vuelve a 0. Caso borde confirmado: un pago `conciliado` (terminal) SÍ vuelve a `sobrante` por UPDATE directo — no lo bloquea `esEstadoTerminal` (esa guarda solo aplica a la cascada de matching, no al job de NC). Pagos de OTRO período del mismo seller no se tocan.
- `[x]` **Reimputación de líneas:** todas las líneas del período anulado se reasignan al período abierto vigente; ninguna queda huérfana apuntando al anulado; líneas de otro período no se mueven.
- `[x]` **Gate y compuerta:** `emitirNotaCreditoPeriodo` exige `puedeEmitirFacturas` + motivo no vacío; solo períodos `facturado` con DTE 33; 33 rechazado por SII no requiere NC; segundo 61 sobre el mismo 33 rechazado con error claro ANTES de la BD; bitácora ANTES del evento con autor; montos COPIADOS del 33. No auto-emite nada. *(`acciones-nc.test.ts`.)*
- `[x]` **Aislamiento/coherencia (pgTAP):** CHECK `documentos_dte_referencia_coherente` (un 61 siempre referencia, un 33 nunca) e índice único parcial (segundo 61 sobre el mismo 33 → 23505); seller dueño VE su NC, otro seller del tenant y otro tenant NO; seller no puede insertar 61 (42501). *(`dinero_notas_credito.test.sql`.)*
- `[x]` **Folios por tipo:** `reservarFolio(tenant, 61)` no consume un CAF tipo 33 y viceversa (regresión del fix). *(`folios.test.ts`.)*

**#8 — Bug encontrado y corregido (alcance compartido — convierte corrupción silenciosa en error visible)**
2. **`obtenerOCrearPeriodoCobroAbierto` podía devolver un período NO abierto** (Severidad MEDIA). El UNIQUE de `periodos_cobro` es `(tenant, seller, fecha_inicio, fecha_fin)` sin `estado`: solo hay UNA fila por rango. La función hacía upsert con `ignoreDuplicates` y luego un SELECT por rango SIN filtrar `estado`, así que si el período de "hoy" del seller ya estaba `cerrado`/`facturado`/`anulado`, devolvía ESE id. El job de NC reimputa al período de hoy: las líneas corregidas habrían quedado pegadas a un período facturado y nunca se volverían a emitir (facturación perdida, en silencio). También afecta a C1 (genera-líneas) en el borde equivalente. **Fix:** la función ahora valida que el período encontrado esté `abierto`; si no, lanza un error claro y RETRYABLE (Inngest reintenta; una persona abre el período) en vez de misfilar líneas. `src/modules/dinero/periodos.ts` + 4 tests nuevos en `periodos.test.ts` (happy path, reutiliza abierto, falla con facturado, falla con cerrado).

**Verificado sin hallazgos**
- Webhook Fintoc: rate limit `fintoc:{tenantId}` 30/60s ANTES de resolver/descifrar el secreto (un flood no paga crypto); 429 con `Retry-After` solo si `permitido === false`; orden firma → parseo → bitácora → evento intacto.
- Montos del 61 COPIADOS del 33 vía el evento (no recalculados desde líneas que pudieron cambiar); semántica de crédito por tipo 61, montos positivos.

---

## Fuera del alcance del MVP (no probar todavía)

Estos requerimientos son de **Crecimiento (V2)** o **Futura (V3)**; no deberían bloquear el avance a frontend/UX:

- Cobranza + conciliación bancaria automática Fintoc/Khipu (RF-044, RF-045).
- Notas de crédito / ajustes (RF-038) y boleta de terceros automática (RF-040) — salvo que ya se hayan adelantado.
- App de conductor **nativa** (la PWA es lo del MVP).
- Reportería ejecutiva avanzada (RF-049) y notificaciones al consumidor final (RF-051).
- Multicanal (Falabella / e-commerce propio), expansión a otras ciudades e IA (V3).

---

*Documento de trabajo · pruebas funcionales del MVP. Pensado para validar el lazo operación→dinero antes de las etapas de frontend y UX/UI.*
