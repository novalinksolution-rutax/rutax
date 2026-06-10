# Fase C · Motor entrega→dinero — Documento de Arquitectura

**Archivo:** `docs/arquitectura/fase-c-dinero.md`
**Fecha:** Junio 2026
**Estado previo:** Fase B completa y commiteada. Migraciones 0001–0005 activas. Módulos `identidad`, `operacion`, `integraciones/ml` con tests pasando.

---

## §1 Principios que rigen toda la Fase C

**1.1 Un solo dato de origen.** Las líneas de cobro y de liquidación nacen del estado del pedido en `operacion.pedidos`. Si el dato de origen es correcto, el dinero cuadra solo.

**1.2 Idempotencia estructural.** Re-ejecutar cualquier job produce exactamente el mismo resultado. El mecanismo es un `UNIQUE` constraint en la BD que absorbe el segundo intento con un conflicto silencioso — el job no necesita preguntar; Postgres se lo dice.

**1.3 El motor calcula; nunca emite ni paga.** `dinero` arma líneas y documentos. La emisión del DTE la ejecuta `integraciones/dte`. El pago al conductor lo hace el courier fuera del sistema.

---

## §2 Modelo de datos — schema `dinero`

### 2.1 Diagrama de entidades

```
identidad.tenants ──┬── identidad.sellers ──── operacion.pedidos ──┐
                    │                                               │
                    │            dinero.lineas_cobro ◄─────────────┘
                    │                    │ N:1
                    │            dinero.periodos_cobro ──► dinero.documentos_dte
                    │
                    └── identidad.conductores ── operacion.pedidos ──┐
                                                                     │
                                      dinero.lineas_liquidacion ◄───┘
                                               │ N:1
                                        dinero.liquidaciones

                    dinero.eventos_conciliacion  (log append-only de diferencias)
                    dinero.config_periodos       (configuración de cierre por tenant/seller)
```

Todas las tablas de `dinero` llevan `tenant_id`.

### 2.2 Tabla `dinero.lineas_cobro`

Una fila por pedido elegible. Monto que el courier cobra al seller.

| Columna | Tipo | Constraint | Nota |
|---|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() | |
| `tenant_id` | uuid | NOT NULL, FK → `identidad.tenants.id` RESTRICT | P1 |
| `seller_id` | uuid | NOT NULL, FK → `identidad.sellers.id` RESTRICT | P2 — RLS |
| `pedido_id` | uuid | NOT NULL, FK → `operacion.pedidos.id` RESTRICT, **UNIQUE** | Idempotencia |
| `periodo_cobro_id` | uuid | NULLABLE, FK → `dinero.periodos_cobro.id` | Asignado inline al generar |
| `tarifa_id` | uuid | NOT NULL, FK → `identidad.tarifas.id` RESTRICT | Tarifa vigente al momento de la entrega |
| `monto_base_clp` | NUMERIC(12,0) | NOT NULL, CHECK >= 0 | Nunca FLOAT |
| `ajuste_incidencia_clp` | NUMERIC(12,0) | NOT NULL, default 0 | Negativo si descuenta |
| `monto_final_clp` | NUMERIC(12,0) | NOT NULL, CHECK >= 0, GENERATED ALWAYS AS (monto_base_clp + ajuste_incidencia_clp) STORED | |
| `concepto` | text | NOT NULL | Descripción para el DTE |
| `tipo_pedido` | text | NOT NULL | `flex` / `same_day` |
| `fecha_entrega` | date | NOT NULL | Zona horaria America/Santiago |
| `incidencia_id` | uuid | NULLABLE, FK → `operacion.incidencias.id` | Si la incidencia ajustó el cobro |
| `origen_generacion` | text | NOT NULL, default `'motor_automatico'` | `motor_automatico` / `ajuste_manual` |
| `generado_por_usuario_id` | uuid | NULLABLE | Solo ajuste manual |
| `notas` | text | NULLABLE | |
| `creado_en` | timestamptz | NOT NULL, default now() | |
| `actualizado_en` | timestamptz | NOT NULL, default now() | |

**Índices:**
```sql
idx_lineas_cobro_tenant_id       ON lineas_cobro (tenant_id)
idx_lineas_cobro_seller_periodo  ON lineas_cobro (tenant_id, seller_id, periodo_cobro_id)
idx_lineas_cobro_sin_periodo     ON lineas_cobro (tenant_id, seller_id) WHERE periodo_cobro_id IS NULL
idx_lineas_cobro_fecha           ON lineas_cobro (tenant_id, fecha_entrega)
```

**RLS:** P1 + P2 (seller ve solo sus líneas). Conductores no acceden. Escritura: solo `service_role`.

### 2.3 Tabla `dinero.lineas_liquidacion`

Una fila por pedido elegible. Monto que el courier paga al conductor.

| Columna | Tipo | Constraint | Nota |
|---|---|---|---|
| `id` | uuid | PK | |
| `tenant_id` | uuid | NOT NULL, FK → `identidad.tenants.id` RESTRICT | P1 |
| `driver_id` | uuid | NOT NULL, FK → `identidad.conductores.id` RESTRICT | P3 — RLS |
| `pedido_id` | uuid | NOT NULL, FK → `operacion.pedidos.id` RESTRICT, **UNIQUE** | Idempotencia |
| `liquidacion_id` | uuid | NULLABLE, FK → `dinero.liquidaciones.id` | Asignado al cerrar período |
| `monto_base_clp` | NUMERIC(12,0) | NOT NULL, CHECK >= 0 | |
| `ajuste_incidencia_clp` | NUMERIC(12,0) | NOT NULL, default 0 | |
| `monto_final_clp` | NUMERIC(12,0) | NOT NULL, CHECK >= 0, GENERATED ALWAYS AS (monto_base_clp + ajuste_incidencia_clp) STORED | |
| `concepto` | text | NOT NULL | |
| `fecha_entrega` | date | NOT NULL | |
| `incidencia_id` | uuid | NULLABLE | |
| `origen_generacion` | text | NOT NULL, default `'motor_automatico'` | |
| `generado_por_usuario_id` | uuid | NULLABLE | |
| `notas` | text | NULLABLE | |
| `creado_en` | timestamptz | NOT NULL, default now() | |
| `actualizado_en` | timestamptz | NOT NULL, default now() | |

**Índices:**
```sql
idx_lineas_liq_tenant_id          ON lineas_liquidacion (tenant_id)
idx_lineas_liq_driver_liquidacion ON lineas_liquidacion (tenant_id, driver_id, liquidacion_id)
idx_lineas_liq_sin_liquidacion    ON lineas_liquidacion (tenant_id, driver_id) WHERE liquidacion_id IS NULL
idx_lineas_liq_fecha              ON lineas_liquidacion (tenant_id, fecha_entrega)
```

**RLS:** P1 + P3 (conductor ve solo las suyas). Sellers no acceden. Escritura: solo `service_role`.

### 2.4 Tabla `dinero.periodos_cobro`

Agrupa líneas de cobro de un seller para un período. El cierre genera el DTE.

| Columna | Tipo | Constraint | Nota |
|---|---|---|---|
| `id` | uuid | PK | |
| `tenant_id` | uuid | NOT NULL, FK → `identidad.tenants.id` | P1 |
| `seller_id` | uuid | NOT NULL, FK → `identidad.sellers.id` | P2 |
| `fecha_inicio` | date | NOT NULL | |
| `fecha_fin` | date | NOT NULL | |
| `tipo_periodo` | text | NOT NULL | `semanal` / `quincenal` / `mensual` |
| `estado` | text | NOT NULL, default `'abierto'` | `abierto` / `cerrado` / `facturado` / `anulado` |
| `total_lineas` | integer | NOT NULL, default 0 | |
| `monto_total_clp` | NUMERIC(12,0) | NULLABLE | Calculado al cerrar |
| `documento_dte_id` | uuid | NULLABLE, FK → `dinero.documentos_dte.id` | |
| `cerrado_en` | timestamptz | NULLABLE | |
| `cerrado_por_usuario_id` | uuid | NULLABLE | |
| `creado_en` | timestamptz | NOT NULL, default now() | |
| `actualizado_en` | timestamptz | NOT NULL, default now() | |

**Idempotencia:** `UNIQUE (tenant_id, seller_id, fecha_inicio, fecha_fin)`

**Índices:**
```sql
idx_periodos_tenant_seller   ON periodos_cobro (tenant_id, seller_id)
idx_periodos_abiertos        ON periodos_cobro (tenant_id, seller_id) WHERE estado = 'abierto'
idx_periodos_estado          ON periodos_cobro (tenant_id, estado)
```

**RLS:** P1 + P2 (seller ve sus períodos). Escritura: solo `service_role`.

### 2.5 Tabla `dinero.documentos_dte`

Registro permanente de cada DTE emitido por el courier al seller.

| Columna | Tipo | Constraint | Nota |
|---|---|---|---|
| `id` | uuid | PK | |
| `tenant_id` | uuid | NOT NULL, FK → `identidad.tenants.id` | P1 |
| `seller_id` | uuid | NOT NULL, FK → `identidad.sellers.id` | P2 |
| `periodo_cobro_id` | uuid | NOT NULL, FK → `dinero.periodos_cobro.id` | |
| `tipo_documento` | integer | NOT NULL | 33 = factura, 61 = nota de crédito |
| `folio` | integer | NOT NULL | Folio consumido del CAF |
| `fecha_emision` | date | NOT NULL | Zona Santiago |
| `monto_neto_clp` | NUMERIC(12,0) | NOT NULL | |
| `monto_iva_clp` | NUMERIC(12,0) | NOT NULL | |
| `monto_total_clp` | NUMERIC(12,0) | NOT NULL | |
| `xml_dte_ref` | text | NULLABLE | Referencia opaca a Storage — firmado, no inline |
| `pdf_ref` | text | NULLABLE | Referencia opaca a Storage |
| `proveedor_dte_id_externo` | text | NULLABLE | ID del proveedor DTE |
| `estado_sii` | text | NOT NULL, default `'pendiente'` | `pendiente` / `aceptado` / `rechazado` / `aceptado_con_discrepancias` |
| `estado_proveedor` | text | NOT NULL, default `'pendiente'` | |
| `error_descripcion` | text | NULLABLE | Sin secretos ni tokens |
| `dte_referencia_id` | uuid | NULLABLE, FK → `dinero.documentos_dte.id` | Para notas de crédito |
| `emitido_en` | timestamptz | NOT NULL, default now() | |
| `creado_en` | timestamptz | NOT NULL, default now() | |
| `actualizado_en` | timestamptz | NOT NULL, default now() | |

**Idempotencia:** `UNIQUE (tenant_id, tipo_documento, folio)` — protege contra doble-emisión en reintento.

**Índices:**
```sql
idx_dte_tenant_seller        ON documentos_dte (tenant_id, seller_id)
idx_dte_sii_pendiente        ON documentos_dte (tenant_id) WHERE estado_sii = 'pendiente'
idx_dte_periodo              ON documentos_dte (periodo_cobro_id)
```

**RLS:** P1 + P2 (seller ve y descarga sus DTE). XML y PDF entregados solo vía signed URL de Storage. Escritura: solo `service_role`.

### 2.6 Tabla `dinero.liquidaciones`

Documento de liquidación del courier al conductor por un período.

| Columna | Tipo | Constraint | Nota |
|---|---|---|---|
| `id` | uuid | PK | |
| `tenant_id` | uuid | NOT NULL, FK → `identidad.tenants.id` | P1 |
| `driver_id` | uuid | NOT NULL, FK → `identidad.conductores.id` | P3 |
| `fecha_inicio` | date | NOT NULL | |
| `fecha_fin` | date | NOT NULL | |
| `tipo_periodo` | text | NOT NULL | |
| `estado` | text | NOT NULL, default `'borrador'` | `borrador` / `emitida` / `pagada` |
| `total_entregas` | integer | NOT NULL, default 0 | |
| `monto_total_clp` | NUMERIC(12,0) | NULLABLE | |
| `tipo_relacion_conductor` | text | NOT NULL | `dependiente` / `independiente` — copiado de `conductores.tipo_relacion` al generar |
| `pdf_ref` | text | NULLABLE | Referencia opaca a Storage |
| `notas` | text | NULLABLE | |
| `generado_en` | timestamptz | NULLABLE | |
| `generado_por_usuario_id` | uuid | NULLABLE | |
| `creado_en` | timestamptz | NOT NULL, default now() | |
| `actualizado_en` | timestamptz | NOT NULL, default now() | |

**Idempotencia:** `UNIQUE (tenant_id, driver_id, fecha_inicio, fecha_fin)`

**RLS:** P1 + P3 (conductor ve solo las suyas). Sellers no acceden. Escritura: solo `service_role`.

### 2.7 Tabla `dinero.eventos_conciliacion`

Log append-only de diferencias detectadas. No es una tabla de estado mutable — registra hallazgos.

| Columna | Tipo | Constraint | Nota |
|---|---|---|---|
| `id` | uuid | PK | |
| `tenant_id` | uuid | NOT NULL, FK → `identidad.tenants.id` | P1 |
| `seller_id` | uuid | NULLABLE, FK → `identidad.sellers.id` | |
| `periodo_cobro_id` | uuid | NULLABLE, FK → `dinero.periodos_cobro.id` | |
| `tipo_diferencia` | text | NOT NULL | Ver valores abajo |
| `pedido_id` | uuid | NULLABLE, FK → `operacion.pedidos.id` | |
| `descripcion` | text | NOT NULL | |
| `monto_diferencia_clp` | NUMERIC(12,0) | NULLABLE | |
| `estado` | text | NOT NULL, default `'pendiente'` | `pendiente` / `revisado` / `resuelto` / `ignorado` |
| `resuelto_por_usuario_id` | uuid | NULLABLE | |
| `resuelto_en` | timestamptz | NULLABLE | |
| `job_run_id` | text | NULLABLE | ID del run de Inngest — trazabilidad |
| `creado_en` | timestamptz | NOT NULL, default now() | |

**Valores de `tipo_diferencia`:**
- `pedido_entregado_sin_linea_cobro`
- `pedido_entregado_sin_linea_liquidacion`
- `linea_cobro_sin_pedido_entregado`
- `folio_consumido_sin_dte_persistido`
- `periodo_cerrado_con_lineas_sueltas`
- `monto_dte_difiere_de_lineas`

**Índices:**
```sql
idx_conciliacion_tenant_estado  ON eventos_conciliacion (tenant_id, estado)
idx_conciliacion_periodo        ON eventos_conciliacion (periodo_cobro_id)
idx_conciliacion_pedido         ON eventos_conciliacion (pedido_id)
```

**RLS:** P1 estricta, solo `dueno` y `administracion`. Sellers y conductores no acceden. Escritura: solo `service_role`.

### 2.8 Tabla `dinero.config_periodos`

Configuración del tipo de período de facturación por tenant o por seller.

| Columna | Tipo | Constraint | Nota |
|---|---|---|---|
| `id` | uuid | PK | |
| `tenant_id` | uuid | NOT NULL, FK → `identidad.tenants.id` | P1 |
| `seller_id` | uuid | NULLABLE, FK → `identidad.sellers.id` | NULL = default del tenant |
| `tipo_periodo` | text | NOT NULL | `semanal` / `quincenal` / `mensual` |
| `dia_cierre` | integer | NULLABLE | Semanal: 1=lunes..7=domingo; quincenal: 15; mensual: NULL (último día) |
| `activa` | boolean | NOT NULL, default true | |
| `creado_en` | timestamptz | NOT NULL, default now() | |

**Unique:** `(tenant_id, seller_id) WHERE activa = true`

**RLS:** P1 estricta, solo roles internos. Escritura: solo `service_role`.

### 2.9 Columnas añadidas a tablas existentes

**`identidad.tarifas`** — nueva columna:
```sql
monto_conductor_clp NUMERIC(12,0) NOT NULL DEFAULT 0 CHECK (monto_conductor_clp >= 0)
```
La tarifa del conductor (lo que el courier le paga) se añade a la tarifa ya existente del seller. Para el MVP un monto fijo por tipo de entrega es suficiente. Si la lógica crece, se migra a `dinero.tarifas_conductor` en V2 sin pérdida de datos.

**`identidad.tenants`** — nueva columna:
```sql
seller_id_gasto_propio uuid NULLABLE REFERENCES identidad.sellers(id)
```
Cuando `operacion.pedidos.seller_id = tenant.seller_id_gasto_propio`, el motor no genera línea de cobro (same-day como gasto propio del courier).

**`operacion.pedidos`** — nuevas columnas (actualizadas por el job C1):
```sql
cobro_generado       boolean NOT NULL DEFAULT false
monto_cobro_clp      NUMERIC(12,0) NULLABLE
liquidacion_generada boolean NOT NULL DEFAULT false
monto_liquidacion_clp NUMERIC(12,0) NULLABLE
```

---

## §3 RLS por tabla — resumen ejecutivo

Funciones disponibles desde Fase A: `identidad.claim_tenant_id()`, `identidad.claim_tipo_usuario()`, `identidad.claim_seller_id()`, `identidad.claim_driver_id()`.

Nueva función: `identidad.claim_rol()` — lee claim `rol` del JWT (análoga a `claim_tipo_usuario()`).

| Tabla | SELECT seller | SELECT conductor | SELECT interno | Escritura |
|---|---|---|---|---|
| `lineas_cobro` | Solo las suyas | No | Todas del tenant | service_role |
| `lineas_liquidacion` | No | Solo las suyas | Todas del tenant | service_role |
| `periodos_cobro` | Solo los suyos | No | Todos del tenant | service_role |
| `documentos_dte` | Solo los suyos | No | Todos del tenant | service_role |
| `liquidaciones` | No | Solo las suyas | Todas del tenant | service_role |
| `eventos_conciliacion` | No | No | Solo `dueno`/`administracion` | service_role |
| `config_periodos` | No | No | Todos del tenant | service_role |

**Política SELECT para `lineas_cobro`, `periodos_cobro`, `documentos_dte`:**
```sql
tenant_id = identidad.claim_tenant_id()
AND (
  identidad.claim_tipo_usuario() = 'interno'
  OR (identidad.claim_tipo_usuario() = 'seller'
      AND seller_id = identidad.claim_seller_id())
)
```

**Política SELECT para `lineas_liquidacion`, `liquidaciones`:**
```sql
tenant_id = identidad.claim_tenant_id()
AND (
  identidad.claim_tipo_usuario() = 'interno'
  OR (identidad.claim_tipo_usuario() = 'conductor'
      AND driver_id = identidad.claim_driver_id())
)
```

**Política SELECT para `eventos_conciliacion`:**
```sql
tenant_id = identidad.claim_tenant_id()
AND identidad.claim_tipo_usuario() = 'interno'
AND identidad.claim_rol() IN ('dueno', 'administracion')
```

---

## §4 Flujo paso a paso del motor entrega→dinero

### 4.1 Decisión de trigger: job Inngest, no trigger Postgres

**Descartado:** `AFTER UPDATE` trigger en `operacion.pedidos`.

Tres razones:
1. La lógica de elegibilidad es demasiado compleja para PL/pgSQL y no tiene tests naturales en ese entorno. En TypeScript es una función pura testeable sin BD.
2. Los triggers no tienen reintentos. Un fallo del motor sería silencioso.
3. Un trigger acopla la transacción de la transición de estado a la generación de la línea. El pedido está `entregado` independientemente del motor de dinero.

**Elegido:** `actualizarEstadoPedido()` publica el evento `dinero/pedido.estado_financiero_relevante` después del commit en BD. Mismo patrón ya establecido en Fase B.

### 4.2 Flujo completo

```
PASO 1 — Transición de estado (src/modules/operacion/pedidos.ts)
  actualizarEstadoPedido() hace COMMIT del nuevo estado en BD
  Si estado_nuevo IN ('entregado','entregado_manual','fallido',
                      'fallido_manual','devuelto','cancelado'):
    inngest.send({
      name: 'dinero/pedido.estado_financiero_relevante',
      data: { pedidoId, tenantId, sellerId, driverIdAsignado,
              estadoNuevo, fechaTransicion, tipoPedido, tarifaAplicableId }
    })

PASO 2 — Job C1: dinero/generarLineas (trigger: evento anterior)

  2a. Elegibilidad para COBRO al seller:
      - entregado / entregado_manual → siempre genera
      - fallido / fallido_manual: leer incidencia → afecta_cobro
      - devuelto / cancelado → no genera
      - same_day con seller_id = tenant.seller_id_gasto_propio → no genera

  2b. Si genera cobro:
      monto_base = tarifas.monto_clp WHERE id = tarifaAplicableId
      INSERT INTO dinero.lineas_cobro (pedido_id, ...)
        ON CONFLICT (pedido_id) DO NOTHING   ← idempotencia
      periodo_id = obtenerOCrearPeriodoAbierto(tenantId, sellerId, fechaEntrega)
      UPDATE lineas_cobro SET periodo_cobro_id = periodo_id
        WHERE pedido_id = X AND periodo_cobro_id IS NULL
      UPDATE operacion.pedidos
        SET cobro_generado = true, monto_cobro_clp = monto_final_clp

  2c. Elegibilidad para LIQUIDACIÓN al conductor:
      - entregado / entregado_manual → siempre genera (si driverIdAsignado != null)
      - fallido / fallido_manual: leer incidencia → afecta_liquidacion
      - devuelto / cancelado → no genera
      - driverIdAsignado = null → no genera

  2d. Si genera liquidación:
      monto_base = tarifas.monto_conductor_clp WHERE id = tarifaAplicableId
      INSERT INTO dinero.lineas_liquidacion (pedido_id, ...)
        ON CONFLICT (pedido_id) DO NOTHING
      liquidacion_id = obtenerOCrearLiquidacionAbierta(tenantId, driverId, fechaEntrega)
      UPDATE lineas_liquidacion SET liquidacion_id = liquidacion_id
        WHERE pedido_id = X AND liquidacion_id IS NULL
      UPDATE operacion.pedidos
        SET liquidacion_generada = true, monto_liquidacion_clp = monto_final_clp

  2e. registrarEnBitacora({ accion: 'dinero.lineas_generadas', ... })

PASO 3 — Job C2: dinero/cerrarPeriodo (cron 02:00 Santiago)
  Para cada periodos_cobro WHERE estado='abierto' AND fecha_fin < today():
    Sumar lineas_cobro, contar filas
    UPDATE periodos_cobro SET estado='cerrado', total_lineas=N, monto_total_clp=suma
    inngest.send({ name: 'dinero/periodo.cerrado', ... })

PASO 4 — Jobs C3 y C6 en paralelo (trigger: dinero/periodo.cerrado)
  C3 emite el DTE (ver §5.4)
  C6 concilia el período (ver §8)
```

### 4.3 Tabla completa de elegibilidad

| Estado pedido | afecta_cobro | afecta_liquidacion | Genera cobro | Genera liquidación |
|---|---|---|---|---|
| `entregado` / `entregado_manual` | n/a | n/a | Sí | Sí (si hay conductor) |
| `fallido` / `fallido_manual` | true | true | Sí | Sí |
| `fallido` / `fallido_manual` | true | false | Sí | No |
| `fallido` / `fallido_manual` | false | true | No | Sí |
| `fallido` / `fallido_manual` | false | false | No | No |
| `devuelto` | n/a | n/a | No | No |
| `cancelado` | n/a | n/a | No | No |
| `same_day` gasto propio | n/a | n/a | No | Sí (si hay conductor) |

Esta tabla es exactamente el conjunto de casos de prueba de `src/modules/dinero/motor.ts`.

---

## §5 Interfaz TypeScript del adaptador DTE

### 5.1 `src/modules/integraciones/dte/tipos.ts`

```typescript
export type ProveedorDte = 'simplefactura' | 'openfactura';
export type TipoDocumentoDte = 33 | 61; // 33 = factura, 61 = nota de crédito

export interface LineaDetalleDte {
  nombre: string;
  cantidad: number;
  precioUnitarioNetoCLP: number;
  descuentoCLP?: number;
}

export interface EmitirFacturaEntrada {
  rutEmisor: string;
  razonSocialEmisor: string;
  rutReceptor: string;
  razonSocialReceptor: string;
  emailReceptor: string;
  fechaEmision: string;           // ISO date, zona Santiago
  folio: number;                  // Reservado antes de llamar al proveedor
  lineas: LineaDetalleDte[];
  folioDocumentoReferencia?: number;
  tipoDocumentoReferencia?: TipoDocumentoDte;
}

export interface EmitirFacturaResultado {
  idExternoProveedor: string;
  folio: number;
  tipoDocumento: TipoDocumentoDte;
  montoNetoCLP: number;
  montoIvaCLP: number;
  montoTotalCLP: number;
  xmlUrl: string | null;
  pdfUrl: string | null;
  estadoSii: 'pendiente' | 'aceptado' | 'rechazado' | 'aceptado_con_discrepancias';
}

export interface ConsultarEstadoDteResultado {
  idExternoProveedor: string;
  estadoSii: 'pendiente' | 'aceptado' | 'rechazado' | 'aceptado_con_discrepancias';
  descripcionSii: string | null;
}
```

### 5.2 `src/modules/integraciones/dte/errores.ts`

```typescript
export class ErrorDte extends Error { ... }
export class ErrorDteProveedor extends ErrorDte { ... }
export class ErrorFolioAgotado extends ErrorDte { ... }
export class ErrorConfigDteInvalida extends ErrorDte { ... }
```

### 5.3 `src/modules/integraciones/dte/puerto.ts`

```typescript
export interface PuertoDte {
  emitirFactura(tenantId: string, entrada: EmitirFacturaEntrada): Promise<EmitirFacturaResultado>;
  consultarEstadoDte(tenantId: string, idExternoProveedor: string): Promise<ConsultarEstadoDteResultado>;
  descargarXmlDte(tenantId: string, idExternoProveedor: string): Promise<string>;
  descargarPdfDte(tenantId: string, idExternoProveedor: string): Promise<string>;
}

export async function obtenerPuertoDte(tenantId: string): Promise<PuertoDte> {
  // Lee courier_config_dte, descifra credenciales, devuelve adaptador concreto
}
```

### 5.4 Protocolo de resiliencia para el folio CAF

El folio se reserva en el job (transaccional) ANTES de llamar al proveedor (HTTP). Si el proveedor falla, el job puede reintentar consultando si el proveedor ya lo recibió.

```
step 1 — 'verificar-dte-existente':
  Si documentos_dte WHERE periodo_cobro_id = X existe → terminar (idempotencia)

step 2 — 'reservar-folio':
  BEGIN TRANSACTION:
    SELECT folio_actual FOR UPDATE
    Si folio_actual > folio_hasta → ErrorFolioAgotado (no reintenta; alerta)
    folio_reservado = folio_actual
    UPDATE SET folio_actual = folio_actual + 1
  COMMIT

step 3 — 'llamar-proveedor-dte':
  puerto.emitirFactura(tenantId, { folio: folio_reservado, ... })
  Si falla por red → Inngest reintenta este step

step 4 — 'persistir-dte':
  INSERT INTO dinero.documentos_dte (folio = folio_reservado, ...)
    ON CONFLICT (tenant_id, tipo_documento, folio) DO NOTHING
  UPDATE dinero.periodos_cobro SET estado = 'facturado', documento_dte_id = nuevo_id
  registrarEnBitacora({ accion: 'dinero.dte_emitido', ... })
```

---

## §6 Jobs Inngest para Fase C

| Job | Trigger | Responsabilidad | Idempotencia |
|---|---|---|---|
| **C1** `dinero/generarLineas` | Evento `dinero/pedido.estado_financiero_relevante` | Generar `lineas_cobro` y `lineas_liquidacion`. Asignar a período. Flags en `operacion.pedidos`. | `UNIQUE (pedido_id)` + `ON CONFLICT DO NOTHING`. EventId = `pedidoId`. |
| **C2** `dinero/cerrarPeriodo` | Cron `0 2 * * *` Santiago | Detectar períodos cuyo `fecha_fin < today()`. Calcular totales. Estado → `cerrado`. Publicar `dinero/periodo.cerrado`. | Transición `abierto → cerrado` es idempotente. |
| **C3** `dinero/emitirDtePeriodo` | Evento `dinero/periodo.cerrado` | Reservar folio CAF. Llamar a `integraciones/dte`. Persistir `documentos_dte`. Marcar `facturado`. | Verificar DTE existente en step 1. `UNIQUE (tenant_id, tipo_documento, folio)`. |
| **C4** `dinero/generarLiquidacionConductor` | Cron `0 2 * * *` Santiago | Crear `liquidaciones`. Generar PDF. | `UNIQUE (tenant_id, driver_id, fecha_inicio, fecha_fin)`. |
| **C5** `dinero/pollingEstadoDte` | Cron `0 */6 * * *` | Actualizar `estado_sii` en DTEs pendientes. Si rechazado → evento de conciliación. | UPDATE es idempotente. |
| **C6** `dinero/conciliarPeriodo` | Evento `dinero/periodo.cerrado` (paralelo con C3) | Detectar diferencias entregado-vs-facturado. Insertar `eventos_conciliacion`. | Verificar eventos previos antes de insertar. |
| **C7** `dinero/alertaFoliosProximos` | Cron `0 9 * * *` Santiago | Alertar cuando `(folio_hasta - folio_actual) < 50`. | Máx. 1 alerta/tenant/día. |

---

## §7 Contratos entre módulos

### 7.1 `src/lib/inngest/eventos.ts`

```typescript
export interface EventoPedidoEstadoFinanciero {
  name: 'dinero/pedido.estado_financiero_relevante';
  data: {
    pedidoId: string;
    tenantId: string;
    sellerId: string;
    driverIdAsignado: string | null;
    estadoNuevo: 'entregado' | 'entregado_manual' | 'fallido' | 'fallido_manual' | 'devuelto' | 'cancelado';
    estadoAnterior: string;
    fechaTransicion: string;       // ISO timestamptz zona Santiago
    tipoPedido: 'flex' | 'same_day';
    tarifaAplicableId: string | null;
  };
}

export interface EventoPeriodoCerrado {
  name: 'dinero/periodo.cerrado';
  data: {
    periodoCobroidId: string;
    tenantId: string;
    sellerId: string;
    fechaInicio: string;
    fechaFin: string;
    montoTotalClp: number;
  };
}
```

### 7.2 Reglas de importación

| Acción | Permitido | Mecanismo |
|---|---|---|
| `dinero` lee `operacion.pedidos` | Sí | Query directa a BD con `service_role` |
| `dinero` importa tipos puros de `operacion/tipos.ts` | Sí | `EstadoPedido`, `TipoPedido` no arrastran lógica |
| `dinero` importa funciones de `operacion/` | No | Crear funciones de lectura propias en `dinero/consultas-operacion.ts` |
| `dinero` llama a `actualizarEstadoPedido` | No | `dinero` nunca cambia estados de pedidos |
| `dinero` escribe en `operacion.pedidos` | Sí, acotado | Solo `cobro_generado`, `monto_cobro_clp`, `liquidacion_generada`, `monto_liquidacion_clp` |
| `dinero` llama al proveedor DTE directamente | No | Solo a través de `integraciones/dte/puerto.ts` |
| `dinero` registra en bitácora | Sí | A través de `identidad/auditoria.ts` |

### 7.3 Superficie pública del módulo `dinero`

```typescript
// src/modules/dinero/index.ts
export type { LineaCobro, LineaLiquidacion, PeriodoCobro, DocumentoDte, Liquidacion, EventoConciliacion } from './tipos';
export { listarLineasCobroPorPeriodo, listarPeriodosCobro, obtenerPeriodoCobro,
         listarDocumentosDtePorSeller, listarLiquidacionesConductor, obtenerLiquidacion,
         listarEventosConciliacion } from './consultas';
export { cerrarPeriodoManualmente, marcarLiquidacionPagada, resolverEventoConciliacion } from './acciones';
```

---

## §8 Conciliación

El job C6 detecta en cada período cerrado:

1. **`pedido_entregado_sin_linea_cobro`** — pedidos entregados del período sin línea de cobro generada
2. **`pedido_entregado_sin_linea_liquidacion`** — análogo para liquidación del conductor
3. **`monto_dte_difiere_de_lineas`** — `documentos_dte.monto_total_clp` ≠ `SUM(lineas_cobro.monto_final_clp)`
4. **`periodo_cerrado_con_lineas_sueltas`** — líneas con `periodo_cobro_id IS NULL` dentro del rango

C6 corre en paralelo con C3, permitiendo revisar diferencias antes de que el DTE se emita.

---

## §9 Liquidación de conductores

Documento interno (PDF). RF-041 (P1). RF-040 (DTE para formales) es prioridad C, fuera del MVP.

**PDF generado con `@react-pdf/renderer`.** Almacenado en Storage privado en:
`{tenant_id}/liquidaciones/{liquidacion_id}/liquidacion.pdf`

El conductor accede vía signed URL (15 min) generada por Server Action. El PDF nunca pasa por el servidor Next.js.

---

## §10 Secuencia de implementación

| Paso | Agente | Tarea |
|---|---|---|
| 1 | `base-datos-rls` | Migración `20260601000006_dinero_base.sql`: schema `dinero`, 7 tablas, columnas en tablas existentes, `claim_rol()`, RLS, vistas, grants |
| 2 | `base-datos-rls` | Tests pgTAP: aislamiento seller/conductor, invisibilidad de conciliación, ningún INSERT desde `authenticated` |
| 3 | `qa` | Suite completa post-migración — confirmar que Fases A y B siguen pasando |
| 4 | `integraciones` | `src/modules/integraciones/dte/`: tipos, errores, puerto, adaptador concreto, tests con mock HTTP |
| 5 | `backend` | `src/lib/inngest/eventos.ts`. Modificar `actualizarEstadoPedido` para publicar evento post-commit |
| 6 | `backend` | `src/modules/dinero/`: tipos, `motor.ts` (función pura, 8 casos), periodos, consultas, acciones, index |
| 7 | `backend` | Jobs C1–C7 en `src/modules/dinero/jobs/`. Registrar en route.ts de Inngest |
| 8 | `ux-ui` | `docs/ux/fase-c-dinero.md`: flujos de períodos, DTE, liquidaciones, conciliación, alerta folios |
| 9 | `frontend` | Server Components para las pantallas de Fase C |
| 10 | `qa` | Suite Fase C: aislamiento, motor (8 casos), idempotencia C1/C3, PDF, conciliación |
| 11 | `seguridad-cumplimiento` | Auditoría de cierre: signed URLs, logs sin credenciales, bitácora completa |

---

## §11 Decisiones de trade-off

**Job Inngest vs. trigger Postgres:** Job Inngest. Lógica compleja en TS > PL/pgSQL, reintentos nativos, no acoplamiento de transacciones.

**Tarifa del conductor en `identidad.tarifas` vs. tabla propia:** Columna adicional. Suficiente para el MVP; migrable a `dinero.tarifas_conductor` en V2 sin pérdida de datos.

**Liquidación como documento interno vs. DTE:** Documento interno (PDF). RF-040 (DTE para formales) es prioridad C. `tipo_relacion_conductor` preparado para extensión en V2.

**Cierre separado de emisión DTE:** Dos eventos separados (C2 cierra → C3 emite). Permite revisar conciliación antes de emitir el DTE — control financiero estándar.

---

## Referencias

- `docs/arquitectura/fase-b-operacion.md` — columnas `cobro_generado`/`liquidacion_generada`, `afecta_cobro`/`afecta_liquidacion`, máquina de estados
- `src/modules/operacion/tipos.ts` — `Pedido`, `Incidencia`, `EstadoPedido`
- `src/modules/operacion/pedidos.ts` — `actualizarEstadoPedido` (punto de publicación del evento)
- `src/modules/identidad/capacidades.ts` — `puedeEmitirFacturas`, `puedeGestionarLiquidacionesConductores`, `puedeVerConciliacion`
- `src/modules/identidad/auditoria.ts` — `registrarEnBitacora`
- `src/lib/inngest/cliente.ts` — instancia Inngest compartida
- `.claude/skills/motor-entrega-dinero/SKILL.md`
- `.claude/skills/chile-dte/SKILL.md`
- `.claude/skills/multitenant-rls/SKILL.md`
