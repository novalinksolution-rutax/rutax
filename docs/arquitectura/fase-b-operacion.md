# Fase B · Operación — Documento de Arquitectura

**Destino sugerido:** `docs/arquitectura/fase-b-operacion.md`
**Fecha:** Junio 2026
**Estado de Fase A:** completa y commiteada (migraciones 0001–0004, módulos `identidad` e `integraciones`).

---

## §1 Decisiones de diseño que enmarcan toda la Fase B

### 1.1 Orquestador de jobs: recomendación Inngest

**Decisión: Inngest.**

Justificación directa contra los criterios del proyecto:

| Criterio | Inngest | Trigger.dev | Supabase cron |
|---|---|---|---|
| Poco que operar | Totalmente gestionado (SaaS) | Totalmente gestionado (SaaS) | Gestionado, pero limitado a cron puro — sin reintentos automáticos, sin pasos, sin estado |
| Reintentos con backoff | Nativo, configurable por función | Nativo | No — hay que implementarlos a mano dentro del `plpgsql` o del Edge Function |
| Idempotencia | Evento con `id` garantiza exactly-once processing | Evento con `id` | Hay que construirla a mano |
| TS-first | SDK TS de primera clase, autocompletado | SDK TS de primera clase | PL/pgSQL o Edge Functions (cambio de contexto de lenguaje) |
| Pasos encadenados (backfill, ingesta multi-paso) | `step.run()` nativo — el job puede tener pasos con reintentos independientes | `tasks.triggerAndWait()` equivalente | No — monolítico |
| Observabilidad built-in | Dashboard con historial, logs, reintentos visibles | Dashboard equivalente | Ninguna — hay que instrumentar manualmente |
| Integración con Next.js / Vercel | `serve()` en un route handler — un archivo | Equivalente | No aplica |
| Precio MVP | Free tier generoso (50k ejecuciones/mes) | Free tier equivalente | Incluido en Supabase |

Trigger.dev es técnicamente equivalente; la elección de Inngest es por su SDK más maduro en proyectos Next.js. Si el equipo tiene preferencia por Trigger.dev, es un swap de SDK sin impacto en el modelo de datos.

**Supabase cron queda para alertas periódicas simples** (p. ej. disparar un evento de Inngest cada 5 minutos desde `pg_cron`) cuando la única alternativa sería un job de Inngest auto-repetitivo.

### 1.2 Polling vs. webhook para estados ML

**Decisión: webhooks como canal primario + polling de respaldo activo, obligatoriamente combinados.**

ML ofrece un sistema de notificaciones HTTP (topic `shipments`) que dispara un POST al endpoint registrado cada vez que un envío cambia de estado. Para envíos Flex existe además el topic `flex-handshakes` para transferencias entre conductores. ML provee un endpoint de `missed_feeds` para recuperar notificaciones perdidas.

La skill `flex-ml` es explícita: "Combina webhooks/notificaciones con un sondeo periódico de respaldo: los eventos se pueden perder." La estrategia resultante:

1. **Webhook handler** (`POST /api/webhooks/ml/shipments`): recibe notificaciones en tiempo real, encola un job de Inngest `sincronizarEstadoPedido` con el `shipment_id`. El handler debe responder `200` en menos de 500ms (sin procesar — solo encolar).
2. **Job de polling de respaldo** (Inngest, cada 15 minutos): para cada tenant activo, consulta `/shipments?shipment_ids=...` (hasta 50 IDs por llamada) de los pedidos en estados intermedios (`en_ruta`, `asignado`). Cierra el hueco de eventos perdidos.
3. **Corrección manual** (RF-029): un supervisor puede cambiar el estado manualmente cuando la API no lo provee. La máquina de estados lo permite con auditoría obligatoria.

### 1.3 Esquema Postgres: esquema propio `operacion`

**Decisión: esquema `operacion` separado de `identidad`.**

Razones:
1. Los límites de módulos del proyecto son explícitos — el esquema SQL debe reflejar esos límites.
2. Evita colisión de nombres de tablas, tipos y funciones.
3. Las vistas en `public` siguen siendo la superficie expuesta a PostgREST.
4. Las FKs cruzadas entre esquemas son perfectamente válidas en Postgres.

---

## §2 Modelo de datos detallado

### 2.1 Enums nuevos (en esquema `operacion`)

```sql
estado_pedido:
  'pendiente_asignacion' | 'asignado' | 'en_ruta' | 'entregado' |
  'entregado_manual' | 'fallido' | 'fallido_manual' | 'cancelado' | 'devuelto'

tipo_pedido:
  'flex' | 'same_day'

origen_pedido:
  'ml_ingesta' | 'same_day_manual' | 'backfill'

tipo_incidencia:
  'destinatario_ausente' | 'direccion_erronea' | 'paquete_danado' |
  'rechazo_destinatario' | 'problema_acceso' | 'reagendado' | 'otro'

estado_incidencia:
  'abierta' | 'en_gestion' | 'resuelta' | 'cerrada'

estado_manifiesto:
  'borrador' | 'confirmado' | 'en_ruta' | 'completado' | 'cancelado'
```

### 2.2 Tabla `operacion.pedidos`

Tabla central. Contiene todo lo que necesita el módulo de operación **y** las columnas que el motor entrega→dinero de Fase C necesitará, para no migrar dos veces.

| Columna | Tipo | Constraint | Nota |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | |
| `tenant_id` | uuid | NOT NULL, FK → `identidad.tenants.id` ON DELETE RESTRICT | P1 — obligatoria en toda tabla de negocio |
| `seller_id` | uuid | NOT NULL, FK → `identidad.sellers.id` ON DELETE RESTRICT | P2 — seller dueño del pedido |
| `tipo_pedido` | `operacion.tipo_pedido` | NOT NULL | `flex` o `same_day` |
| `origen` | `operacion.origen_pedido` | NOT NULL | Cómo llegó el pedido al sistema |
| `ml_order_id` | text | NULLABLE | ID del pedido en ML (nulo para same_day_manual) |
| `ml_shipment_id` | text | NULLABLE | ID del envío en ML — distinto de `ml_order_id` |
| `estado` | `operacion.estado_pedido` | NOT NULL, default `'pendiente_asignacion'` | Máquina de estados propia |
| `estado_ml` | text | NULLABLE | Estado crudo que reporta ML — no es el estado operativo |
| `subestado_ml` | text | NULLABLE | Subestado crudo de ML |
| `ultima_sync_ml_en` | timestamptz | NULLABLE | Cuándo se recibió la última actualización de ML |
| `driver_id_asignado` | uuid | NULLABLE, FK → `identidad.conductores.id` | Denormalizado para P3 sin join; actualizado por trigger de asignación |
| `destinatario_nombre` | text | NOT NULL | Dato personal — minimización Ley 21.431 |
| `destinatario_direccion` | text | NOT NULL | |
| `destinatario_comuna` | text | NOT NULL | |
| `destinatario_telefono` | text | NULLABLE | |
| `instrucciones_entrega` | text | NULLABLE | |
| `fecha_compromiso` | date | NULLABLE | Fecha de entrega prometida (Flex la provee ML) |
| `tarifa_aplicable_id` | uuid | NULLABLE, FK → `identidad.tarifas.id` | Fijada al ingresar el pedido — Fase C no necesita resolver tarifa retroactivamente |
| `monto_cobro_clp` | integer | NULLABLE, CHECK >= 0 | Calculado por Fase C; columna existe desde Fase B |
| `monto_liquidacion_clp` | integer | NULLABLE, CHECK >= 0 | Calculado por Fase C |
| `cobro_generado` | boolean | NOT NULL, default false | Fase C lo activa al generar línea de cobro |
| `liquidacion_generada` | boolean | NOT NULL, default false | Fase C lo activa al generar línea de liquidación |
| `notas_internas` | text | NULLABLE | Uso del supervisor/coordinador |
| `creado_en` | timestamptz | NOT NULL, default now() | |
| `actualizado_en` | timestamptz | NOT NULL, default now() | |

**Índices:**

```
idx_pedidos_tenant_id              ON pedidos (tenant_id)
idx_pedidos_tenant_seller          ON pedidos (tenant_id, seller_id)
idx_pedidos_tenant_estado          ON pedidos (tenant_id, estado)
idx_pedidos_tenant_fecha           ON pedidos (tenant_id, fecha_compromiso)
idx_pedidos_ml_shipment_id         ON pedidos (ml_shipment_id) WHERE ml_shipment_id IS NOT NULL
idx_pedidos_ml_order_id            ON pedidos (ml_order_id) WHERE ml_order_id IS NOT NULL
idx_pedidos_cobro_pendiente        ON pedidos (tenant_id) WHERE cobro_generado = false AND estado = 'entregado'
```

**Unique constraint:** `(tenant_id, ml_shipment_id)` donde `ml_shipment_id IS NOT NULL` — idempotencia de ingesta.

**RLS:** P1 + P2 (seller ve solo sus pedidos) + P3 (conductor ve solo pedidos con `driver_id_asignado = claim_driver_id()`).

### 2.3 Tabla `operacion.manifiestos`

Un manifiesto agrupa pedidos para un conductor en un turno.

| Columna | Tipo | Constraint | Nota |
|---|---|---|---|
| `id` | uuid | PK | |
| `tenant_id` | uuid | NOT NULL, FK → `identidad.tenants.id` | P1 |
| `driver_id` | uuid | NOT NULL, FK → `identidad.conductores.id` | P3 |
| `nombre` | text | NOT NULL | P. ej. "Ruta Santiago Centro 2026-06-08 AM" |
| `fecha_operacion` | date | NOT NULL | Fecha de la ruta (zona horaria Santiago) |
| `estado` | `operacion.estado_manifiesto` | NOT NULL, default `'borrador'` | |
| `notas` | text | NULLABLE | |
| `creado_por_usuario_id` | uuid | NULLABLE, FK → `auth.users.id` | Auditoría |
| `confirmado_en` | timestamptz | NULLABLE | |
| `completado_en` | timestamptz | NULLABLE | |
| `creado_en` | timestamptz | NOT NULL, default now() | |
| `actualizado_en` | timestamptz | NOT NULL, default now() | |

**Índices:**

```
idx_manifiestos_tenant_id          ON manifiestos (tenant_id)
idx_manifiestos_driver_fecha       ON manifiestos (tenant_id, driver_id, fecha_operacion)
idx_manifiestos_tenant_estado      ON manifiestos (tenant_id, estado)
```

**RLS:** P1 + P3 (conductor ve solo sus manifiestos). Internos ven todos los del tenant.

### 2.4 Tabla `operacion.asignaciones_pedido`

Relación pedido↔manifiesto con historial. Un pedido solo puede estar en un manifiesto activo a la vez.

| Columna | Tipo | Constraint | Nota |
|---|---|---|---|
| `id` | uuid | PK | |
| `tenant_id` | uuid | NOT NULL, FK → `identidad.tenants.id` | P1 — denormalizado |
| `pedido_id` | uuid | NOT NULL, FK → `operacion.pedidos.id` ON DELETE CASCADE | |
| `manifiesto_id` | uuid | NOT NULL, FK → `operacion.manifiestos.id` ON DELETE RESTRICT | |
| `driver_id` | uuid | NOT NULL, FK → `identidad.conductores.id` | P3 — denormalizado; debe coincidir con `manifiestos.driver_id` |
| `seller_id` | uuid | NOT NULL, FK → `identidad.sellers.id` | P2 — denormalizado; debe coincidir con `pedidos.seller_id` |
| `activa` | boolean | NOT NULL, default true | Solo una fila con `activa = true` por `pedido_id` a la vez |
| `asignado_por_usuario_id` | uuid | NULLABLE, FK → `auth.users.id` | |
| `asignado_en` | timestamptz | NOT NULL, default now() | |
| `desasignado_en` | timestamptz | NULLABLE | Cuando se reasignó — la fila previa se marca `activa = false` |

**Unique constraint:** `(pedido_id) WHERE activa = true` — índice parcial único de Postgres.

**Índices:**

```
idx_asignaciones_tenant_id         ON asignaciones_pedido (tenant_id)
idx_asignaciones_pedido_activa     ON asignaciones_pedido (pedido_id) WHERE activa = true
idx_asignaciones_manifiesto        ON asignaciones_pedido (manifiesto_id, activa)
idx_asignaciones_driver_activa     ON asignaciones_pedido (driver_id, activa)
```

**RLS:** P1 + P2 OR P3 simultáneo:
```sql
tenant_id = claim_tenant_id()
AND (
  claim_tipo_usuario() = 'interno'
  OR (claim_tipo_usuario() = 'seller' AND seller_id = claim_seller_id())
  OR (claim_tipo_usuario() = 'conductor' AND driver_id = claim_driver_id())
)
```

### 2.5 Tabla `operacion.incidencias`

| Columna | Tipo | Constraint | Nota |
|---|---|---|---|
| `id` | uuid | PK | |
| `tenant_id` | uuid | NOT NULL, FK → `identidad.tenants.id` | P1 |
| `pedido_id` | uuid | NOT NULL, FK → `operacion.pedidos.id` ON DELETE RESTRICT | |
| `seller_id` | uuid | NOT NULL, FK → `identidad.sellers.id` | P2 — denormalizado desde `pedidos.seller_id` |
| `tipo` | `operacion.tipo_incidencia` | NOT NULL | |
| `estado` | `operacion.estado_incidencia` | NOT NULL, default `'abierta'` | |
| `descripcion` | text | NULLABLE | |
| `notas_resolucion` | text | NULLABLE | |
| `afecta_cobro` | boolean | NOT NULL, default true | Fase C usa esto para aplicar regla de incidencia |
| `afecta_liquidacion` | boolean | NOT NULL, default true | Fase C |
| `abierta_por_usuario_id` | uuid | NULLABLE, FK → `auth.users.id` | |
| `resuelta_por_usuario_id` | uuid | NULLABLE, FK → `auth.users.id` | |
| `abierta_en` | timestamptz | NOT NULL, default now() | |
| `resuelta_en` | timestamptz | NULLABLE | |
| `creado_en` | timestamptz | NOT NULL, default now() | |
| `actualizado_en` | timestamptz | NOT NULL, default now() | |

**Índices:**

```
idx_incidencias_tenant_id          ON incidencias (tenant_id)
idx_incidencias_pedido_id          ON incidencias (pedido_id)
idx_incidencias_seller_estado      ON incidencias (tenant_id, seller_id, estado)
```

**RLS:** P1 + P2 (el seller ve incidencias de sus pedidos — RF-048 portal del seller). Conductores no ven incidencias. Internos ven todo el tenant.

**Nota de dominio:** `afecta_cobro` / `afecta_liquidacion` se fijan al abrir la incidencia según el tipo. Esta lógica vive en el backend como reglas explícitas. Fase C las consume pero Fase B las fija.

### 2.6 Tabla `operacion.evidencias_incidencia`

| Columna | Tipo | Constraint | Nota |
|---|---|---|---|
| `id` | uuid | PK | |
| `tenant_id` | uuid | NOT NULL, FK → `identidad.tenants.id` | P1 |
| `incidencia_id` | uuid | NOT NULL, FK → `operacion.incidencias.id` ON DELETE CASCADE | |
| `seller_id` | uuid | NOT NULL | P2 — denormalizado desde la incidencia |
| `tipo_archivo` | text | NOT NULL | `'imagen'` / `'documento'` |
| `storage_path` | text | NOT NULL | Path en Supabase Storage — signed URL en el request, no URL pública |
| `nombre_original` | text | NULLABLE | |
| `subido_por_usuario_id` | uuid | NULLABLE, FK → `auth.users.id` | |
| `creado_en` | timestamptz | NOT NULL, default now() | |

**Índices:**

```
idx_evidencias_incidencia_id       ON evidencias_incidencia (incidencia_id)
idx_evidencias_tenant_id           ON evidencias_incidencia (tenant_id)
```

**RLS:** P1 + P2. Escritura: solo roles internos o jobs via service_role.

**Storage:** bucket privado (no público). Path sugerido: `{tenant_id}/incidencias/{incidencia_id}/{archivo_id}`. Signed URLs con vida corta (5–15 min).

### 2.7 Tabla `operacion.intentos_backfill`

Para hacer el backfill idempotente y rastreable.

| Columna | Tipo | Constraint | Nota |
|---|---|---|---|
| `id` | uuid | PK | |
| `tenant_id` | uuid | NOT NULL, FK → `identidad.tenants.id` | P1 |
| `conexion_ml_id` | uuid | NOT NULL, FK → `identidad.conexiones_seller_ml.id` | |
| `seller_id` | uuid | NOT NULL | Denormalizado |
| `desde` | timestamptz | NOT NULL | `desconectada_desde` al momento de iniciar el backfill |
| `hasta` | timestamptz | NOT NULL | Momento en que se inició el backfill |
| `estado` | text | NOT NULL, default `'pendiente'` | `'pendiente'` / `'en_progreso'` / `'completado'` / `'fallido'` |
| `pedidos_recuperados` | integer | NULLABLE | Conteo final |
| `error` | text | NULLABLE | |
| `iniciado_en` | timestamptz | NOT NULL, default now() | |
| `completado_en` | timestamptz | NULLABLE | |

**Unique constraint:** `(conexion_ml_id, desde, hasta)` — evita dos backfills del mismo período.

**RLS:** P1 estricta, solo internos. Invisible para seller y conductor.

---

## §3 Máquina de estados del pedido

La máquina de estados es el contrato más crítico de Fase B. Las transiciones de estado Flex las inicia ML (via webhook o polling); las correcciones manuales las inicia un usuario interno.

| Estado origen | Estado destino | Ejecutor | Precondición |
|---|---|---|---|
| `pendiente_asignacion` | `asignado` | sistema (job de asignación) | Manifiesto activo; pedido sin asignación activa previa |
| `asignado` | `en_ruta` | sistema (webhook/polling ML) | ML reporta "shipped" o equivalente |
| `asignado` | `pendiente_asignacion` | interno (coordinador+) | Reasignación: desactivar asignación previa y crear nueva |
| `asignado` | `cancelado` | sistema (webhook/polling ML) | ML reporta cancelación antes de salir a ruta |
| `asignado` | `entregado_manual` | interno (supervisor+) | Corrección manual con nota obligatoria (RF-029) |
| `asignado` | `fallido_manual` | interno (supervisor+) | Corrección manual con nota obligatoria |
| `en_ruta` | `entregado` | sistema (webhook/polling ML) | ML reporta `delivered` |
| `en_ruta` | `fallido` | sistema (webhook/polling ML) | ML reporta `not_delivered` o equivalente |
| `en_ruta` | `cancelado` | sistema (webhook/polling ML) | Cancelación tardía |
| `en_ruta` | `entregado_manual` | interno (supervisor+) | Corrección manual con nota obligatoria |
| `en_ruta` | `fallido_manual` | interno (supervisor+) | Corrección manual con nota obligatoria |
| `en_ruta` | `devuelto` | sistema (webhook/polling ML) | ML reporta devolución al origen |
| `fallido` | `asignado` | interno (coordinador+) | Reintento: nueva asignación — incidencia previa queda abierta |
| `fallido` | `cancelado` | interno (supervisor+) | No hay reintento posible |
| `fallido_manual` | `asignado` | interno (coordinador+) | Igual que `fallido` |
| `entregado` | — | — | Terminal — no transición |
| `entregado_manual` | — | — | Terminal — no transición |
| `cancelado` | — | — | Terminal — no transición |
| `devuelto` | — | — | Terminal — no transición |

**Invariantes que debe respetar el backend:**

1. Un pedido no puede moverse a `asignado` si ya tiene una asignación activa en otro manifiesto — debe reasignarse (desactivar la anterior primero).
2. Las transiciones iniciadas por el sistema (ML) no requieren permisos de rol; las manuales requieren `puedeAjustarOperacionDiaria` como mínimo.
3. Toda transición manual escribe en `bitacora_auditoria` con `accion = 'pedido.estado_corregido_manual'` y el `detalle` debe incluir `estado_anterior`, `estado_nuevo`, `motivo`.
4. Al transicionar a `fallido` o `fallido_manual`, el sistema debe abrir automáticamente una `incidencia` si no hay una abierta ya para ese pedido.
5. Los estados terminales no admiten más transiciones. El backend rechaza cualquier intento con un error explícito.

---

## §4 Estrategia de RLS para las tablas nuevas

Las funciones de claims `identidad.claim_tenant_id()`, `identidad.claim_tipo_usuario()`, `identidad.claim_seller_id()` e `identidad.claim_driver_id()` ya existen.

### Mapa tabla → política

| Tabla | P1 (tenant) | P2 (seller) | P3 (conductor) | Escritura |
|---|---|---|---|---|
| `operacion.pedidos` | Sí | `seller_id = claim_seller_id()` | `driver_id_asignado = claim_driver_id()` | Solo internos + service_role |
| `operacion.manifiestos` | Sí | No aplica | `driver_id = claim_driver_id()` | Solo internos + service_role |
| `operacion.asignaciones_pedido` | Sí | `seller_id = claim_seller_id()` | `driver_id = claim_driver_id()` | Solo internos + service_role |
| `operacion.incidencias` | Sí | `seller_id = claim_seller_id()` | No aplica | Solo internos + service_role |
| `operacion.evidencias_incidencia` | Sí | `seller_id = claim_seller_id()` | No aplica | Solo internos + service_role |
| `operacion.intentos_backfill` | Sí | No aplica | No aplica | Solo service_role |

**Política SELECT para `pedidos` y `asignaciones_pedido`** (P2 + P3 simultáneo como OR):

```sql
tenant_id = identidad.claim_tenant_id()
AND (
  identidad.claim_tipo_usuario() = 'interno'
  OR (identidad.claim_tipo_usuario() = 'seller'   AND seller_id          = identidad.claim_seller_id())
  OR (identidad.claim_tipo_usuario() = 'conductor' AND driver_id_asignado = identidad.claim_driver_id())
)
```

**Guard `solo_interno_edita`:** la función `identidad.solo_interno_edita()` ya existe (migración 0002) y es reutilizable. Aplicar como trigger BEFORE STATEMENT en: `pedidos`, `manifiestos`, `asignaciones_pedido`, `incidencias`, `evidencias_incidencia`.

**`intentos_backfill`:** sin políticas para `authenticated` — acceso solo via `service_role`.

---

## §5 Contratos de módulo — interfaz pública de `operacion`

### 5.1 Qué expone `operacion` hacia otros módulos

```typescript
// src/modules/operacion/index.ts

// --- Pedidos ---
obtenerPedido(pedidoId: string, tenantId: string): Promise<Pedido | null>
listarPedidos(filtros: FiltrosPedidos): Promise<PaginadoPedidos>
  // FiltrosPedidos: { tenantId, sellerId?, conductorId?, estado?, fecha?, pagina, limite }

crearPedidoSameDay(entrada: CrearPedidoSameDayEntrada): Promise<Pedido>

actualizarEstadoPedido(entrada: ActualizarEstadoEntrada): Promise<Pedido>
  // entrada: { pedidoId, estadoNuevo, estadoEsperado, actuadoPor, motivo? }
  // estadoEsperado: optimistic locking — rechaza si el estado actual difiere

// --- Manifiestos ---
crearManifiesto(entrada: CrearManifiestoEntrada): Promise<Manifiesto>
asignarPedidosAManifiesto(manifiestoId: string, pedidoIds: string[]): Promise<void>
confirmarManifiesto(manifiestoId: string, conductorId: string): Promise<Manifiesto>
obtenerManifiestoActivo(conductorId: string, fecha: Date): Promise<Manifiesto | null>

// --- Incidencias ---
abrirIncidencia(entrada: AbrirIncidenciaEntrada): Promise<Incidencia>
actualizarIncidencia(entrada: ActualizarIncidenciaEntrada): Promise<Incidencia>
listarIncidenciasDePedido(pedidoId: string): Promise<Incidencia[]>

// --- Dashboard (consultas de métricas — solo lectura) ---
obtenerMetricasDelDia(tenantId: string, fecha: Date): Promise<MetricasOperativas>
  // MetricasOperativas: { totalPedidos, porEstado, tasaEntrega, incidenciasAbiertas, conexionesCaidas }
```

### 5.2 Qué NO expone `operacion`

- No expone acceso directo a las tablas — siempre a través de funciones con las precondiciones de la máquina de estados.
- No expone `tarifa_aplicable_id`, `monto_cobro_clp`, `monto_liquidacion_clp` — esas columnas existen en el esquema pero solo `dinero` (Fase C) las lee y escribe.
- No contiene lógica de generación de DTE, liquidaciones ni conciliación.
- No llama directamente a la API de ML — siempre a través del puerto en `integraciones`.

### 5.3 Qué consume `operacion`

| Módulo | Qué consume | Cómo |
|---|---|---|
| `identidad` | `puedeAsignarYReasignarPedidos`, `puedeGestionarIncidencias`, `puedeAjustarOperacionDiaria`, `estaActivo` | Import directo de `src/modules/identidad/capacidades` |
| `identidad` | `registrarEnBitacora` (para correcciones manuales de estado) | Import directo de `src/modules/identidad/auditoria` |
| `integraciones/ml` | `obtenerConexionPorSeller` | Para verificar estado de salud antes de desencadenar ingesta |

**Regla de límite fijada:** `operacion` nunca importa de `dinero` y viceversa en dirección operacion→dinero. `dinero` lee de `operacion` pero `operacion` no sabe nada de cobros ni liquidaciones.

---

## §6 Jobs de fondo de Fase B

Todos los jobs de Inngest son idempotentes. El mecanismo principal es el `eventId` de Inngest como clave de deduplicación + unique constraints en la base de datos que absorben los conflictos de upsert.

### Job 1: `ml/refrescarTokens` (pendiente de Fase A)

- **Cadencia:** cron cada 30 minutos.
- **Lógica:** leer `conexiones_seller_ml` donde `token_expira_en < now() + 2h` o `estado_salud IN ('atencion', 'sana')`. Por cada una, llamar `refrescarToken({ conexionId })` del puerto ML.
- **Idempotencia:** `refrescarToken` ya es idempotente. Dos ejecuciones concurrentes para la misma conexión son seguras.
- **Fallo:** si `requiere_revinculacion`, actualizar `estado_salud = 'desvinculada'` y registrar en bitácora. Error transitorio → Inngest reintenta con backoff. El error de una conexión no afecta las demás.

### Job 2: `ml/sondeoSaludConexiones` (RF-013/014)

- **Cadencia:** cron cada 15 minutos.
- **Lógica:** para cada `conexion_seller_ml` activa, verificar con un request liviano a ML (p. ej. `GET /users/me`). Si falla con 401: marcar `estado_salud = 'atencion'`. Si ya era `atencion` y vuelve a fallar: escalar a `desvinculada` y disparar evento `notificacion/conexionCaida`.
- **Idempotencia:** la transición de estado es idempotente.

### Job 3: `ml/procesarWebhookShipment` (RF-025/026)

- **Trigger:** evento de Inngest publicado por el webhook handler HTTP.
- **Lógica:** con el `ml_shipment_id`, llamar `GET /shipments/{id}` via el puerto ML. Traducir `status`/`substatus` al `estado_pedido` propio. Llamar `operacion.actualizarEstadoPedido`. Si el nuevo estado es `fallido`, llamar `operacion.abrirIncidencia` si no hay una abierta.
- **Idempotencia:** si el pedido ya está en ese estado, el update no produce cambio y no abre incidencia duplicada.
- **Fallo:** si `actualizarEstadoPedido` rechaza por `estadoEsperado` distinto (condición de carrera resuelta), loguear y terminar sin reintento.

### Job 4: `ml/pollingEstadosPedidos` (respaldo de RF-025/026)

- **Cadencia:** cron cada 15 minutos.
- **Lógica:** leer pedidos con `estado IN ('asignado', 'en_ruta')` agrupados por `seller_id`. Por seller, batches de hasta 50 `ml_shipment_id` → `GET /shipments?shipment_ids=...`. Si el estado difiere, disparar el mismo handler de job 3.
- **Fallo:** si el token del seller está caído, registrar y continuar con el siguiente seller.

### Job 5: `ml/ejecutarBackfill` (RF-017)

- **Trigger:** evento `conexion_ml.reconectada` publicado cuando `intercambiarCodigoPorTokens` es exitoso.
- **Lógica:** crear fila en `operacion.intentos_backfill`. Paginar sobre pedidos ML del seller en el período desconectado. Por cada pedido: si no existe, ingestar; si existe con estado distinto, actualizar. Marcar `estado = 'completado'`.
- **Idempotencia:** unique constraint `(conexion_ml_id, desde, hasta)` + upsert sobre `(tenant_id, ml_shipment_id)`.
- **Límite:** si `desconectada_desde` > 7 días, acotar el backfill y documentarlo en la UI. `integraciones` verifica el límite real de la API.

### Job 6: `ml/ingestarPedidosFlex` (RF-018)

- **Cadencia:** cron cada 10 minutos.
- **Lógica:** para cada seller con `estado_salud = 'sana'`, consultar pedidos Flex nuevos desde `ultima_sync_exitosa_en`. Crear filas en `operacion.pedidos` con `origen = 'ml_ingesta'`. Actualizar `ultima_sync_exitosa_en`.
- **Idempotencia:** unique constraint `(tenant_id, ml_shipment_id)` absorbe duplicados con upsert.

### Job 7: `notificacion/conexionCaida` (RF-014/050)

- **Trigger:** evento publicado por `sondeoSaludConexiones` cuando escala a `desvinculada`.
- **Lógica:** enviar notificación (Resend o equivalente) al `dueno` y opcionalmente al seller. Sin tokens ni datos sensibles — solo nombre del seller y link para reconectar.
- **Idempotencia:** deduplicar por `(seller_id, fecha)` — máximo una notificación por seller por día.

---

## §7 Pasos concretos para los agentes

Secuencia estricta: `base-datos-rls` → `backend` + `integraciones` (paralelo) → `frontend` → `qa`. No abrir el siguiente paso hasta que el anterior tenga sus pruebas pasando.

**Paso 1 — `base-datos-rls`:** Crear `20260601000005_operacion_base.sql`. Crear esquema `operacion`. Enums de §2.1. Tablas `pedidos`, `manifiestos`, `asignaciones_pedido`, `incidencias`, `evidencias_incidencia`, `intentos_backfill` con columnas, constraints e índices de §2. Activar RLS y políticas P1/P2/P3 de §4. Vistas en `public` con `security_invoker = true`. Grants para `authenticated`. Trigger de consistencia de `driver_id`/`seller_id` denormalizados en `asignaciones_pedido`. Trigger que actualiza `pedidos.driver_id_asignado` cuando cambia la asignación activa.

**Paso 2 — `base-datos-rls`:** Escribir pruebas pgTAP de aislamiento para las tablas nuevas: tenant cruzado en `pedidos`, seller viendo pedidos ajenos, conductor viendo pedidos no asignados a él, seller intentando UPDATE (debe lanzar 42501), `intentos_backfill` invisible para `authenticated`.

**Paso 3 — `qa`:** Ejecutar suite de aislamiento (`npx supabase test db`). Bloqueante.

**Paso 4 — `integraciones`:** Implementar job `ml/refrescarTokens` en Inngest. Configurar cron en `inngest.config.ts`. Pruebas con mock del puerto ML: refrescado, requiere_revinculacion, error_transitorio.

**Paso 5 — `integraciones`:** Webhook handler `POST /api/webhooks/ml/shipments`. Validar firma ML. Publicar evento Inngest `ml/shipment.updated`. Responder 200 en < 500ms. Job `ml/procesarWebhookShipment`. Pruebas: handler responde 200 con firma válida; rechaza con 401 con firma inválida; job actualiza estado correcto.

**Paso 6 — `backend`:** Módulo `src/modules/operacion/` con contrato de §5.1. Empezar por `actualizarEstadoPedido` (la usa el job 5) y `obtenerPedido`/`listarPedidos` (la usa el frontend). Función pura `validarTransicion(estadoActual, estadoNuevo)` testeable sin BD. Pruebas unitarias de `validarTransicion` con todos los casos de §3.

**Paso 7 — `backend`:** `crearPedidoSameDay`, `crearManifiesto`, `asignarPedidosAManifiesto`, `abrirIncidencia`. Validar capacidades RBAC. Registrar en bitácora correcciones manuales y apertura de incidencias. Pruebas unitarias.

**Paso 8 — `integraciones`:** Jobs `ml/sondeoSaludConexiones`, `ml/pollingEstadosPedidos`, `ml/ingestarPedidosFlex`. Verificar que el fallo de una conexión no propaga al loop completo.

**Paso 9 — `integraciones`:** Job `ml/ejecutarBackfill`. Pequeño cambio en `puerto.ts` para publicar evento `conexion_ml.reconectada` cuando `intercambiarCodigoPorTokens` es exitoso. Prueba de idempotencia ante reintentos.

**Paso 10 — `ux-ui`:** Definir flujos para: panel multi-seller, vista del conductor, portal del seller ampliado, dashboard del dueño. Documento destino: `docs/ux/fase-b-operacion.md`.

**Paso 11 — `frontend`:** Panel multi-seller (RF-019): tabla de pedidos con filtros por seller/estado/fecha, contadores por estado, paginación. Server Component de Next.js. Verificar que usuario-seller solo ve sus pedidos.

**Paso 12 — `frontend`:** Vista del conductor (RF-047): lista del manifiesto activo, detalle de dirección/destinatario. PWA-first (funciona en móvil). El conductor no ve pedidos de otros conductores.

**Paso 13 — `frontend`:** Portal del seller ampliado (RF-048): estado de conexión ML, lista de pedidos, incidencias. "Reconectar" llama al flujo OAuth ya construido en Fase A.

**Paso 14 — `frontend`:** Dashboard del dueño (RF-046): métricas del día via `obtenerMetricasDelDia`, alertas de conexiones caídas, acceso rápido a incidencias abiertas.

**Paso 15 — `qa`:** Suite completa Fase B: aislamiento (paso 3), máquina de estados (todas las transiciones válidas e inválidas), idempotencia de jobs (mismo evento dos veces no genera pedido duplicado ni incidencia duplicada), RLS del conductor y del seller.

**Paso 16 — `seguridad-cumplimiento`:** Auditoría de cierre antes de abrir Fase C: (a) ningún endpoint expone `tenant_id` de otro tenant; (b) evidencias usan signed URLs; (c) logs de jobs sin datos personales del destinatario; (d) bitácora registra correcciones manuales de estado; (e) webhook handler valida firma ML.

---

## Referencias

- `docs/levantamiento.md` — RF-011..RF-051, §4 Usuarios y permisos, §5 Procesos AS-IS→TO-BE.
- `docs/arquitectura/fase-a-cimiento.md` — modelo de datos Fase A, patrones RLS, contratos de módulo.
- `supabase/migrations/20260101000001..0004_*.sql` — esquema exacto ya migrado.
- `src/modules/integraciones/ml/puerto.ts` y `tipos.ts` — adaptador ML ya construido.
- `src/modules/identidad/capacidades.ts` — `puedeAsignarYReasignarPedidos`, `puedeGestionarIncidencias`, `puedeAjustarOperacionDiaria`.
- `CLAUDE.md` — restricciones no-negociables.
