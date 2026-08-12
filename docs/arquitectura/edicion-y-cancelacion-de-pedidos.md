# Edición y cancelación de pedidos same-day

**Estado:** decisión de arquitectura · 2026-08-11 · sobre decisiones ya tomadas por el fundador (cancelar ≠ borrar; el courier manda; edición solo en `pendiente_asignacion`).
**Alcance:** `operacion` (contrato), `dinero` (preflight + fidelidad de anulación), `identidad` (capacidad nueva), superficies `(tenant)/operaciones` y `portal/pedidos`.

---

## 0. Las cinco decisiones, en una línea cada una

1. **Dinero:** la afirmación "en `pendiente_asignacion` todavía no hay líneas" es **falsa** — hay un ciclo real que la rompe. Pero **no hay que construir nada nuevo**: el evento y la anulación pre-cierre ya existen y ya cubren `cancelado`. Falta fidelidad (motivo/bitácora dicen "devolución") y **tapar el punto ciego**: cuando la línea no se puede anular, hoy nadie se entera.
2. **Ventana:** cancelar se permite en `pendiente_asignacion`, `asignado`, `en_ruta` (y `fallido`, que **ya existe**). El seller llega solo hasta `asignado`. Cancelación humana **solo `same_day`**.
3. **RLS:** **no se agrega ninguna política de UPDATE para el seller** — sería un retroceso. La pertenencia se prueba con una **lectura hecha con el cliente de la sesión** (RLS decide) y se escribe con `service_role` con `seller_id` en el `WHERE`.
4. **Colaterales:** lo crítico es **desactivar la asignación** (si no, la parada sigue viva en la app del conductor) y **re-disparar geocoding sin el `id` determinista** (si no, Inngest lo deduplica contra la creación y la dirección nueva nunca se geocodifica).
5. **Auditoría:** una sola entrada por acto, con `service_role`, **antes** del efecto. La dirección anterior **no** entra completa en la bitácora sin visto bueno de `seguridad-cumplimiento`.

---

## 1. Hallazgos de código que cambian el planteamiento

### 1.1 `creadoPorUsuarioId` **no existe en el pedido**

`src/modules/operacion/tipos.ts:203` está dentro de la interfaz **`Manifiesto`** (líneas 195–208), no de `Pedido`. Confirmado en el esquema: `creado_por_usuario_id` aparece en `supabase/migrations/20260601000005_operacion_base.sql:302` (tabla `operacion.manifiestos`) y en ningún otro sitio de `supabase/`. `operacion.pedidos` **no tiene autoría de creación**.

**Consecuencia:** no se puede usar para nada, y **no hay que agregarla**. La pertenencia del pedido la define `seller_id` (que sí existe y sí está en RLS); el "quién hizo qué" lo cubre la bitácora. Agregar `creado_por_usuario_id` a `pedidos` sería una columna sin lector: la ingesta ML no tiene autor humano y quedaría `null` en la mayoría de las filas.

### 1.2 La máquina de estados ya permite cancelar desde `fallido`

`src/modules/operacion/maquina-estados.ts:80` — `fallido → cancelado` con ejecutor `interno` ya está en la tabla ("Sin reintento posible: cierre definitivo"). O sea: **ya existe un camino humano a `cancelado`**; lo que falta es el de un pedido vivo. `fallido_manual → cancelado` **no** existe (asimetría, ver §3).

### 1.3 El seller no es un ejecutor de la máquina de estados

`EjecutorTransicion = "sistema" | "interno" | "conductor"` (`tipos.ts:405`). No hay forma de expresar "esto lo hizo el seller" sin ampliarlo.

### 1.4 El seller no puede escribir en `pedidos`, ni por asomo

`operacion.pedidos` tiene `pedidos_update_interno` (solo `claim_tipo_usuario() = 'interno'`) **más** el trigger por sentencia `trg_pedidos_solo_interno_edita` → `identidad.solo_interno_edita()`, que lanza `42501` a cualquier autenticado no-interno *antes* de que RLS filtre filas (`20260601000005_operacion_base.sql:704-726`; función en `20260101000002_sellers_conductores.sql:248-262`). Esto es una barrera fuerte y **conviene conservarla intacta**.

### 1.5 El portal del seller escribe con `service_role` y filtra en la app

`src/app/portal/pedidos/nuevo/actions.ts:53` y `src/app/portal/pedidos/[pedidoId]/page.tsx:21` usan `crearClienteServiceRole()` con doble filtro `tenant_id`+`seller_id` escrito a mano. En creación no hay riesgo (el `sellerId` sale de la sesión). **En edición/cancelación sí lo hay: el `pedidoId` viene del formulario → IDOR.** Esto es lo que obliga a la regla de §4.

### 1.6 El seller (y el conductor) leen `notas_internas`

`public.pedidos` es `select *` con `grant select … to authenticated` y política P2 por `seller_id`. Es decir, **hoy el seller ya lee las notas internas de sus pedidos** y el conductor las de los suyos. No lo introduce esta feature, pero manda directamente sobre el diseño de `motivo_cancelacion` (§6.2) y es un hallazgo que hay que pasar a `seguridad-cumplimiento` por separado.

---

## 2. A · Dinero — la pregunta importante

### 2.1 Cuándo se generan las líneas (cadena completa, verificada)

| Paso | Dónde | Qué |
|---|---|---|
| 1 | `src/modules/operacion/pedidos.ts:509-535` | `actualizarEstadoPedido` publica `dinero/pedido.estado_financiero_relevante` **post-commit, best-effort**, solo si `estadoNuevo ∈ ESTADOS_FINANCIEROS` (`pedidos.ts:54-61`: `entregado`, `entregado_manual`, `fallido`, `fallido_manual`, `devuelto`, `cancelado`). |
| 2 | `src/modules/dinero/jobs/generar-lineas.ts:57-61` | El job C1 es el **único** productor de `dinero.lineas_cobro` / `lineas_liquidacion` por vía automática, y su único disparador es ese evento. |
| 3 | `src/modules/dinero/motor.ts:380-433` | `evaluarElegibilidad`: `devuelto` y `cancelado` → `generaCobro=false, generaLiquidacion=false`. `entregado*` → sí. `fallido*` → según `incidencias.afecta_cobro` / `afecta_liquidacion` (default en BD: `true`, `20260601000005:419`). |

**Conclusión intermedia:** para que un pedido tenga línea, tiene que haber pasado por `entregado`/`entregado_manual` (terminales) o por `fallido`/`fallido_manual`.

### 2.2 ¿Puede un pedido en `pendiente_asignacion` tener líneas? **Sí. Demostración.**

En su **primer** paso por `pendiente_asignacion` es imposible: la única salida es `→ asignado` (`maquina-estados.ts:32-38`) y ninguna entrada a ese estado es financieramente relevante.

Pero `pendiente_asignacion` **no es un estado inicial**: es también el destino de la reasignación. Este ciclo está enteramente permitido por la tabla vigente:

```
pendiente_asignacion → asignado          (sistema)      maquina-estados.ts:36
asignado             → fallido_manual    (interno)      :52     ← genera líneas si la incidencia afecta
fallido_manual       → asignado          (interno)      :91
asignado             → pendiente_asignacion (interno)   :47     ← y aquí está, con línea viva
```

Variante idéntica por la vía normal: `en_ruta → fallido` (sistema/conductor, `:64`) `→ asignado` (`:78`) `→ pendiente_asignacion` (`:47`).

Además, `pedidos.cobro_generado` / `liquidacion_generada` **no sirven como "¿alguna vez tuvo línea?"**: `generar-lineas.ts:310-319` y `:393-402` los devuelven a `false` al anular. La verdad vive en la fila de `dinero.lineas_*` con `anulada=false`.

**Por tanto: el diseño no puede asumir que no hay líneas. Ni en `pendiente_asignacion`, ni en `asignado`, ni en `en_ruta`.**

### 2.3 Qué debe pasar con las líneas al cancelar: **casi nada nuevo, ya está construido**

`generar-lineas.ts:235-412` (paso `anular-lineas-si-devolucion`) se activa con la condición `!generaCobro && !generaLiquidacion` — que incluye `cancelado`, no solo `devuelto`. Ya hace exactamente lo correcto:

| Estado del contenedor | Qué hace hoy C1 |
|---|---|
| `lineas_cobro` sin `periodo_cobro_id` | anula (`:270-273`) |
| período `abierto` | anula (`:269`) |
| período `cerrado` / `facturado` / `anulado` | **no toca** y loguea (`:320-326`) |
| `lineas_liquidacion` sin `liquidacion_id` | anula (`:353-356`) |
| liquidación `borrador` | anula (`:352`) |
| liquidación `emitida` / `pagada` | **no toca** y loguea (`:403-408`) |

**Los tres huecos reales:**

- **H1 — la anulación miente en la auditoría.** `motivo_anulacion: 'devolucion'` está *hardcodeado* (`:301`, `:384`) y la acción de bitácora es `'dinero.lineas_anuladas_por_devolucion'` (`:281`, `:361`), aunque el `estadoNuevo` sea `cancelado`. El payload ya trae el dato; solo hay que derivarlo.
- **H2 — punto ciego cuando NO puede anular.** C1 solo escribe un `logger.info`. C6 (`conciliar-periodo`) se dispara con `dinero/periodo.cerrado`; si el período ya está `facturado`, C6 **ya corrió** y no vuelve. Resultado: **un pedido `cancelado` con línea viva dentro de un DTE emitido, y nadie enterado.** Esto es fuga de confianza en el foso del producto y hay que taparlo.
- **H3 — sin aviso previo al humano.** La persona cancela sin saber que ya facturó ese pedido.

### 2.4 Decisiones

**D-A1 · No se bloquea la cancelación por estado del dinero. Se bloquea la facturación.**
Impedir que el coordinador marque como cancelado un paquete que físicamente no se va a entregar, porque contabilidad ya cerró el período, es meter una mentira en la operación para tapar una en el dinero. La verdad operativa manda. El remedio del lado del dinero ya existe y es humano: nota de crédito (`emitirNotaCreditoPeriodo`, RF-038).

**D-A2 · C1 levanta excepción de conciliación cuando no puede anular** (tapa H2).
Al entrar por la rama "no puedo anular", C1 inserta en `dinero.eventos_conciliacion`:
- lado cobro → `tipo_diferencia = 'linea_cobro_sin_pedido_entregado'` (encaja literalmente: hay línea de cobro y el pedido no está entregado), con `bloquea_facturacion = true`, `pedido_id`, `periodo_cobro_id`, `seller_id`.
- lado liquidación → **reusar** el mismo tipo con `descripcion` explícita **o** agregar `linea_liquidacion_sin_pedido_entregado` con `bloquea_pago = true`. Agregar el tipo cuesta una migración (`ALTER TYPE … ADD VALUE IF NOT EXISTS` + reemplazo del CHECK de `eventos_conciliacion.tipo_diferencia`, patrón ya usado en `20260613000010_dinero_conciliacion_tres_fuentes.sql`) más dos mapeos en `src/modules/dinero/conciliacion-clasificacion.ts` y uno en `src/lib/ui/traduccion-estados.ts`. **Recomiendo agregarlo** — que a un conductor se le haya pagado una entrega que se canceló es fuga de dinero real y merece bloquear el pago, no quedarse como texto en una descripción.
- Idempotencia: mismo patrón `select … maybeSingle()` previo al `insert` que usan los cuatro checks de `conciliar-periodo.ts`, con clave `(tenant_id, pedido_id, tipo_diferencia)` en estado no terminal.

**D-A3 · Preflight informativo antes de confirmar** (tapa H3), en `dinero`, llamado desde la capa de aplicación — **nunca** desde `operacion` (que no importa `dinero`, `pedidos.ts:17`).

**D-A4 · Fidelidad de la anulación** (tapa H1): `motivo_anulacion` y acción de bitácora derivadas de `estadoNuevo` (`'cancelacion'` / `'devolucion'`). Sin cambio de contrato: `estadoNuevo` ya viaja en el evento.

---

## 3. B · Ventana de cancelación y máquina de transiciones

### 3.1 Ventana

| Estado | ¿Cancelable? | Por quién | Razón |
|---|---|---|---|
| `pendiente_asignacion` | **Sí** | `interno`, `seller` | Nadie lo tomó todavía. Caso central. |
| `asignado` | **Sí** | `interno`, `seller` (+ `sistema`, ya existía) | Está en un manifiesto pero no salió. Se puede sacar limpiamente desactivando la asignación. |
| `en_ruta` | **Sí** | `interno` (+ `sistema`, ya existía) | El conductor ya lo lleva. Alguien tiene que decírselo, y ese alguien es el courier, no el seller desde su portal. |
| `fallido` | **Sí (ya existe)** | `interno` | No se toca: `maquina-estados.ts:80`. |
| `fallido_manual` | **Sí (nuevo, por simetría)** | `interno` | Hoy falta y es una asimetría sin motivo: desde `fallido` se puede cerrar definitivamente y desde `fallido_manual` no. |
| `entregado`, `entregado_manual`, `devuelto`, `cancelado` | **No** | — | `ESTADOS_TERMINALES` (`tipos.ts:29-34`). `validarTransicion` los rechaza de raíz (`maquina-estados.ts:120-126`) y así se queda: cancelar algo entregado no es cancelar, es una nota de crédito. |

**Por qué el seller no llega a `en_ruta`:** el paquete ya va en el vehículo. Marcarlo `cancelado` no lo devuelve; el terminal correcto de un paquete que vuelve es `devuelto`, no `cancelado`. Y una cancelación unilateral a media ruta desincroniza la app del conductor sin que nadie lo llame. En `en_ruta` el portal muestra "ya salió a ruta — contacta al courier" y el interno decide. *(Decisión de negocio abierta: ver N-2.)*

### 3.2 Barrera por fuente: la cancelación humana es **solo `same_day`**

Para Flex, el envío vivo lo gobierna Mercado Envíos y Rutax no escribe de vuelta. Marcar `cancelado` un Flex vivo en Rutax produce un pedido terminal al que el job de ML seguirá intentando mover: `procesar-shipment.ts` captura `ErrorTransicionInvalida` y termina sin reintento (comportamiento correcto, no se rompe nada), pero el pedido queda congelado en una mentira y la sincronización queda muda para siempre. Es exactamente lo que la restricción dura del proyecto prohíbe.

**Regla:** las transiciones **nuevas** (`pendiente_asignacion|asignado|en_ruta → cancelado` con ejecutor `interno`/`seller`) exigen `tipo_pedido = 'same_day'`. Se impone en `cancelarPedido`, no en la función pura — mismo patrón que la barrera del conductor (`pedidos.ts:275-281`). `fallido → cancelado` (interno) queda **sin barrera**, como hoy: es la válvula de escape existente para un Flex atascado y quitarla sería una regresión.

### 3.3 Tabla de transiciones resultante (delta sobre `maquina-estados.ts`)

```
pendiente_asignacion → cancelado    ['interno', 'seller']            ← NUEVA entrada
asignado             → cancelado    ['sistema', 'interno', 'seller'] ← +interno, +seller
en_ruta              → cancelado    ['sistema', 'interno']           ← +interno
fallido              → cancelado    ['interno']                      ← sin cambios
fallido_manual       → cancelado    ['interno']                      ← NUEVA (simetría)
```

Y `EjecutorTransicion` pasa a `"sistema" | "interno" | "conductor" | "seller"`.

> **Cuidado (`qa`):** `maquina-estados.test.ts` fija la tabla completa. Ampliar el ejecutor obliga a revisar los tests que afirman "X no puede hacer Y" — hay que **añadir** casos negativos para `seller` (p. ej. `seller` no puede `en_ruta → cancelado`, no puede `→ entregado`), no solo relajar los existentes.

### 3.4 Edición

Ventana: **solo `pendiente_asignacion`** (decidido) y **solo `same_day`** (un Flex lo define ML; editarle la dirección en Rutax crea una discrepancia con la etiqueta que el conductor escanea).

| Campo | Editable | Nota |
|---|---|---|
| `destinatario_nombre`, `destinatario_direccion`, `destinatario_comuna`, `destinatario_telefono`, `instrucciones_entrega` | Sí | dirección/comuna disparan re-geocoding y recálculo de corte |
| `fecha_compromiso` | Sí | recalcula `fecha_compromiso_hora` |
| `notas_internas` | Sí, **solo `interno`** | ver §1.6 |
| `seller_id` | **No** | cambia el dueño del dinero y la tarifa; es otro pedido |
| `tipo_pedido`, `origen`, `estado`, `tarifa_aplicable_id`, `monto_*`, `*_generado`, `tracking_token`, `codigo_interno`, `ml_*` | **No** | |

**Re-resolución de tarifa:** al cambiar la comuna, `crearPedidoSameDay` habría elegido posiblemente otra tarifa. Regla que respeta el límite de módulo sin consultar a `dinero`: **re-resolver `tarifa_aplicable_id` solo si `cobro_generado = false AND liquidacion_generada = false`** — ambas columnas viven en `operacion.pedidos`. Si hay línea viva, `tarifa_aplicable_id` **no se toca** (la línea ya congeló su `snapshot_regla`, que es inmutable) y la bitácora deja constancia de que se editó con cobro vivo. Esto cubre precisamente el caso legítimo: `direccion_erronea` es un `tipo_incidencia` del catálogo (`tipos.ts:67`), o sea que "falló, corrijo la dirección y reintento" es flujo esperado.

**Concurrencia:** el `UPDATE` lleva `.eq('estado','pendiente_asignacion')` en el `WHERE`. Si el coordinador asignó el pedido entre el render y el submit, afecta 0 filas → `ErrorConflicto`, y la UI dice "el pedido ya fue asignado; no se puede editar". Entre dos ediciones simultáneas gana la última: aceptable, no es una operación financiera.

---

## 4. C · RLS y capacidades

### 4.1 Políticas: **no hace falta ninguna nueva, y agregarla sería peor**

La tentación es `pedidos_update_seller_propio`. **Rechazada**, por una razón concreta: el `GRANT` sobre `operacion.pedidos` es de **tabla completa** (`grant select, insert, update on operacion.pedidos to authenticated`, `20260601000005:1010`). Una política de UPDATE para el seller le abre, vía PostgREST, un camino directo a escribir **cualquier columna de sus propias filas** — incluidos `estado`, `monto_cobro_clp`, `cobro_generado`, `tarifa_aplicable_id`. Un `with check` no puede comparar OLD vs NEW y no lo impide. Para acotarlo habría que migrar a `GRANT UPDATE (col, col, …)` por columna, lo que **también afectaría a los internos** (mismo rol `authenticated`) y toca una superficie mucho mayor que esta feature. Es el mismo patrón que ya mordió dos veces en este repo (*"GRANT de tabla completa filtra columnas"*).

**Lo que se conserva, y hay que probar que se conserva:**
- `pedidos_select` (P1+P2+P3) — **esta es la política que impone el aislamiento en esta feature.**
- `pedidos_update_interno` y `trg_pedidos_solo_interno_edita` → el seller sigue recibiendo `42501` ante cualquier UPDATE directo.

### 4.2 La regla de pertenencia (esto es lo que sustituye a la política de UPDATE)

> **La pertenencia se prueba leyendo con el cliente de la SESIÓN — la base de datos decide. Se escribe con `service_role`, siempre con `tenant_id` (y `seller_id` si el ejecutor es `seller`) en el `WHERE`.**

En la Server Action:

1. `const clienteSesion = await createClient()` (`src/lib/supabase/server.ts`) → `obtenerPedido(clienteSesion, pedidoId, tenantId)`. Si el pedido es de otro seller, **RLS devuelve `null`**. La autorización no es un `if` de la app: es un hecho que devuelve Postgres. Se responde "Pedido no encontrado" (nunca "no autorizado": no se filtra la existencia de recursos ajenos).
2. Recién entonces `crearClienteServiceRole()` para mutar y auditar, con `seller_id` en el `WHERE` como guarda atómica contra la carrera entre lectura y escritura.

Esto convierte un filtro de aplicación en una decisión de base de datos sin ampliar un solo privilegio, y es un patrón que el resto del portal puede adoptar después (hoy usa `service_role` + doble filtro a mano, §1.5).

### 4.3 Capacidades RBAC

**Internos — alcanza con lo que hay.** Editar y cancelar van con **`ajustar_operacion_diaria`** (`capacidades.ts:78`), que es la misma que ya gobierna la corrección manual de estado (`pedidos.ts:225`). Hoy la tienen `dueno` y `supervisor`. **`coordinador` no la tiene** → no podría cancelar. Ver decisión abierta N-3.

**Seller — hace falta una capacidad nueva.** El seller solo tiene `solicitar_same_day` y las de lectura. Reusarla sería mentir en el nombre (solicitar ≠ cancelar) y ampliaría de golpe lo que el frontend puede mostrar.

```ts
// capacidades.ts — catálogo
// Gestión del propio envío same-day ya creado: corregir datos del destinatario
// mientras nadie lo tomó, y cancelarlo antes de que salga a ruta. Misma fila del
// levantamiento que "solicitar same-day" (RF-020/021): quien crea el envío es
// quien corrige su error. Acotada a lo propio, como todas las del seller —
// RLS (P2) lo refuerza en BD.
"gestionar_pedidos_propios",
```

Matriz: **solo `seller`**. Helper: `puedeGestionarPedidosPropios(usuario)`.

---

## 5. D · Efectos colaterales

| # | Qué se entera | Qué hay que hacer | Criticidad |
|---|---|---|---|
| **1** | **App del conductor** (`src/app/api/conductor/manifiesto/route.ts:53-60`) | La ruta filtra **solo** `asignaciones_pedido.activa = true`; **no mira el estado del pedido**. Si no se desactiva la asignación, la parada cancelada **sigue viva en la app Expo**, y peor: con cola offline puede cerrarse después. → `cancelarPedido` debe poner `activa=false, desasignado_en=now()` en la asignación activa. El trigger `trg_asignaciones_sincronizar_driver_id` (`20260601000005:656-659`) pone `driver_id_asignado = null` solo. **Además**, defensa en profundidad: la ruta debe excluir pedidos en `ESTADOS_TERMINALES`. | **Bloqueante** |
| **2** | **Orden de operaciones** | El evento financiero lleva `driverIdAsignado` (`pedidos.ts:523`). Leer el conductor **antes** de desactivar la asignación y publicar el valor original. Secuencia: bitácora → UPDATE estado → desactivar asignación → resolver incidencias → publicar evento (post-commit, best-effort). | Alta |
| **3** | **Torre de control** | **Nada que hacer, y es deliberado.** `ESTADOS_DE_CARGA` (`src/modules/contexto/composer/consultas.ts:90`) enumera los estados que *entran* y excluye `cancelado`/`devuelto` a propósito ("sumarlo al denominador de «38 de 120» inflaría el total con paquetes que nadie está esperando"). Al cancelar, el pedido sale solo del numerador y del denominador. **La Torre sigue siendo de solo lectura: este diseño no la hace escribir.** | Ninguna |
| **4** | **Geocoding** | Al cambiar dirección o comuna: `geo_estado='pendiente'`, `lat=null`, `long=null`, `geo_confianza=null`, `geocodificado_en=null`, `cobertura_estado='pendiente'`, y re-publicar `operacion/pedido.ingestado`. ⚠️ **Sin el campo `id`.** `crearPedidoSameDay` lo envía con `id: pedido-ingestado-${pedido.id}` (`pedidos.ts:720`); reutilizarlo hace que **Inngest deduplique el evento contra el de la creación** y la dirección nueva no se geocodifique nunca, en silencio. Referencia de cómo se hace bien: `actions-geocoding.ts:67-82`. | **Bloqueante** |
| **5** | **SLA / corte** | **Bug que esta feature destapa:** `actualizarEstadoPedido` mete `cancelado` en `ESTADOS_NO_EXITOSOS_TERMINALES` (`pedidos.ts:341`) y escribe `sla_cumplido=false` si hay `fecha_compromiso_hora`. Con cancelación masiva de sellers, el SLA del courier se hunde por entregas que nadie le pidió. → en `cancelado`, `sla_cumplido` debe quedar **`null`** (no evaluable), que es justo lo que lo saca del denominador (`slaGlobalPct` cuenta sobre `sla_cumplido IS NOT NULL`). Ojo: hoy la función **solo escribe** `sla_cumplido` cuando el valor no es `null` (`:402`), así que hay que forzar el `null` explícitamente. Al editar la comuna o `fecha_compromiso` hay que recalcular `fecha_compromiso_hora` y `corte_riesgo` con `resolverZona` + `resolverVentanaCorte` (misma lógica de `crearPedidoSameDay:594-660`; extraerla a un helper compartido en vez de duplicarla). | Alta |
| **6** | **Incidencias** | Un pedido cancelado desde `fallido` deja una incidencia abierta. → resolverla con `notasResolucion: 'Pedido cancelado'`, copiando el patrón de `devuelto` (`pedidos.ts:456-502`): bitácora **antes**, `try/catch` para el caso ya-resuelta (no-op). | Media |
| **7** | **Tracking público** | **Nada que hacer.** `src/app/tracking/[token]/page.tsx:77` ya renderiza "Cancelado". El `tracking_token` no cambia al editar → el enlace ya compartido sigue mostrando la verdad. **Es la razón operativa principal de cancelar en vez de borrar.** | Ninguna |
| **8** | **Manifiesto** | Un manifiesto puede quedar con menos paradas o vacío. `qa` debe verificar `api/conductor/manifiesto/completar` con un manifiesto cuyas paradas fueron todas canceladas. | Media |
| **9** | **Métricas del dueño** | `obtenerMetricasDelDia` (`metricas.ts`): revisar que `tasaEntrega` y `paquetesPorComuna` no cuenten cancelados en el denominador. | Media |
| **10** | **Realtime** | Sin cambios: el UPDATE sobre `pedidos` ya dispara la señal → `router.refresh()`. | Ninguna |
| **11** | **Etiqueta con QR** | El frontend debe ocultar/deshabilitar la descarga en pedidos terminales. `asegurarCodigoInterno` no se toca. | Baja |
| **12** | **ML / Flex** | Sin escritura de vuelta y sin cancelación humana de Flex (§3.2) → no hay conflicto. | Ninguna |

---

## 6. E · Auditoría

### 6.1 Acciones de bitácora

Todas con `crearClienteServiceRole()`, **antes** del efecto, y con `actorUsuarioId = sesion.usuarioId`.

| Acción | Actor | `entidadTipo`/`Id` | `detalle` |
|---|---|---|---|
| `pedido.cancelado` | `usuario` | `pedido` / `pedidoId` | `estado_anterior`, `motivo`, `ejecutor` (`'interno'`\|`'seller'`), `tipo_pedido`, `driver_id_asignado`, `manifiesto_id`, `cobro_generado`, `liquidacion_generada` |
| `pedido.editado` | `usuario` | `pedido` / `pedidoId` | `campos_modificados: string[]`, `ejecutor`, `regeocodificado: boolean`, `tarifa_reresuelta: boolean`, `tenia_cobro_vivo: boolean` — **y ver §6.3 sobre valores** |
| `incidencia.resuelta_por_cancelacion` | `usuario` | `pedido` / `pedidoId` | `incidencia_id`, `estado_anterior` |
| `dinero.lineas_anuladas_por_cancelacion` | `sistema` | `pedido` / `pedidoId` | igual que la variante `_por_devolucion`, con `motivo: 'cancelacion'` |
| `dinero.linea_no_anulable_por_cancelacion` | `sistema` | `pedido` / `pedidoId` | `tipo_linea`, `linea_id`, `estado_periodo`\|`estado_liquidacion`, `evento_conciliacion_id` — **la que hoy no existe y deja el punto ciego H2** |

**Una entrada por acto, no dos.** `cancelarPedido` **no** debe registrar `pedido.cancelado` y además dejar que el camino interno emita `pedido.estado_corregido_manual`. La forma limpia: mantener `actualizarEstadoPedido` como **único** camino de escritura de estado (ahí viven optimistic locking, máquina de estados, incidencias y el evento financiero — no se duplican) y hacer que emita `pedido.cancelado` en lugar de `pedido.estado_corregido_manual` cuando `estadoNuevo === 'cancelado'`. `cancelarPedido` es la envoltura que valida ventana, tipo, RBAC, motivo y desactiva la asignación.

### 6.2 `motivo_cancelacion` es visible para el seller

Va en `operacion.pedidos`, que el seller lee entera (§1.6). El motivo escrito por un interno **lo leerá el seller**. Es deseable (transparencia) pero hay que decirlo: el `placeholder` del campo debe dejarlo explícito (trabajo de `copywriter`). Lo que **no** debe llevar es información comercial reservada; para eso está `notas_internas`… que también se filtra, y por eso el hallazgo de §1.6 va a `seguridad-cumplimiento` como ítem aparte.

### 6.3 La lección del commit `0164a56`, y el matiz de esta feature

`registrarEnBitacora` ya rechaza en tiempo de ejecución un cliente que no sea `service_role` (`auditoria.ts:101-155`) — la guarda existe porque el 11-ago el alta de conductores se rompió en producción pasando la sesión del usuario.

**El riesgo específico que esta feature introduce es nuevo:** por primera vez una acción maneja **dos clientes a la vez** — el de la sesión (para la lectura que decide la pertenencia, §4.2) y el `service_role` (para mutar y auditar). Regla explícita, que `qa` debe cubrir con un test:

> `clienteSesion` **solo** para el `obtenerPedido` de pertenencia. **Nunca** se pasa a `registrarEnBitacora`, ni a `actualizarEstadoPedido`, ni a `cancelarPedido`, ni a `editarPedidoSameDay`.

**PII en la bitácora (decisión abierta, ver N-4).** La dirección y el teléfono del destinatario son datos personales (Ley 21.431, minimización). La bitácora es *append-only* con `on delete restrict`: lo que entre ahí no sale nunca, y crea una segunda copia inmune a borrado y a la exportación RNF-13. **Recomendación:** guardar los **nombres** de los campos modificados siempre; el **valor anterior** solo para `destinatario_comuna` y `fecha_compromiso` (baja sensibilidad, alto valor operativo); para `destinatario_direccion`, `destinatario_nombre` y `destinatario_telefono`, solo `true`. Si el fundador quiere el valor anterior completo para resolver disputas, es una decisión legítima pero **requiere visto bueno de `seguridad-cumplimiento`**, no un `detalle` más ancho por comodidad.

---

## 7. Contratos

### 7.1 `operacion` — dos funciones nuevas

```ts
// src/modules/operacion/pedidos.ts  (exportar también desde index.ts)

export interface CancelarPedidoEntrada {
  pedidoId: string;
  tenantId: string;
  /** Optimistic locking: el estado que el llamador leyó. */
  estadoEsperado: EstadoPedido;
  /** 'sistema' sigue yendo por actualizarEstadoPedido (ML reporta la cancelación). */
  ejecutor: 'interno' | 'seller';
  /** UUID de auth. Obligatorio: RNF-04 exige el "quién". */
  actuadoPorUsuarioId: string;
  /** Obligatorio, >= 10 caracteres. Va a bitácora Y a pedidos.motivo_cancelacion. */
  motivo: string;
  /** Solo para ejecutor='seller': guarda atómica en el WHERE. */
  sellerId?: string;
}

/**
 * Cancela un pedido same-day vivo. `cliente` DEBE ser service_role.
 * Lanza: ErrorPedidoNoEncontrado · ErrorValidacion (RBAC, ventana, tipo_pedido,
 * motivo) · ErrorTransicionInvalida · ErrorConflicto (carrera).
 */
export async function cancelarPedido(
  cliente: SupabaseClient,
  entrada: CancelarPedidoEntrada,
  actor: UsuarioActual,
): Promise<Pedido>;
```

```ts
export interface CamposEditablesPedido {
  destinatarioNombre?: string;
  destinatarioDireccion?: string;
  destinatarioComuna?: string;
  destinatarioTelefono?: string | null;
  instruccionesEntrega?: string | null;
  fechaCompromiso?: string | null;
  /** Solo ejecutor='interno'. Con 'seller' → ErrorValidacion. */
  notasInternas?: string | null;
}

export interface EditarPedidoSameDayEntrada {
  pedidoId: string;
  tenantId: string;
  /** Debe ser 'pendiente_asignacion'; va en el WHERE del UPDATE. */
  estadoEsperado: EstadoPedido;
  ejecutor: 'interno' | 'seller';
  actuadoPorUsuarioId: string;
  sellerId?: string;
  cambios: CamposEditablesPedido;
}

export interface ResultadoEditarPedido {
  pedido: Pedido;
  /** Campos que efectivamente cambiaron (para UI y bitácora). */
  camposModificados: (keyof CamposEditablesPedido)[];
  /** true si cambió dirección o comuna → se re-publicó operacion/pedido.ingestado. */
  regeocodificado: boolean;
  /** true si se re-resolvió tarifa_aplicable_id (solo si no había línea viva). */
  tarifaReresuelta: boolean;
  /** Presente si el recálculo dejó el pedido fuera de la ventana de corte. */
  avisoCorte?: AvisoCorte;
}

export async function editarPedidoSameDay(
  cliente: SupabaseClient,
  entrada: EditarPedidoSameDayEntrada,
  actor: UsuarioActual,
): Promise<ResultadoEditarPedido>;
```

Y el helper que hoy vive incrustado en `crearPedidoSameDay:594-660`, extraído para no duplicarlo:

```ts
// src/modules/operacion/ventanas-corte.ts
export async function calcularCompromisoYCorte(
  cliente: SupabaseClient,
  args: { tenantId: string; sellerId: string; comuna: string; tipoEntrega: TipoPedido },
): Promise<{ fechaCompromisoHora: string | null; corteRiesgo: boolean; avisoCorte?: AvisoCorte; zonaId: string | null }>;
```

### 7.2 `dinero` — el preflight (llamado desde la app, nunca desde `operacion`)

```ts
// src/modules/dinero/preflight-cancelacion.ts  (nuevo)
import type { ItemPreflight } from './preflight';

export interface CtxPreflightCancelacion { tenantId: string; pedidoId: string; }

export interface ResultadoPreflightCancelacion {
  /** true si todas las líneas vivas se anularán solas (período abierto / liq. borrador / sin asignar). */
  anulacionAutomatica: boolean;
  /** No bloquean: informan. La cancelación operativa siempre procede (D-A1). */
  advertencias: ItemPreflight[];
}

export async function preflightCancelacionPedido(
  ctx: CtxPreflightCancelacion,
): Promise<ResultadoPreflightCancelacion>;
```

### 7.3 Capa de aplicación — el patrón, una vez

```
// portal/pedidos/[pedidoId]/actions.ts  ·  (tenant)/operaciones/[pedidoId]/actions-pedido.ts
1. exigirSesionActual()
2. gate RBAC: puedeGestionarPedidosPropios (seller) | puedeAjustarOperacionDiaria (interno)
3. clienteSesion = await createClient()
   pedido = await obtenerPedido(clienteSesion, pedidoId, tenantId)   ← RLS decide la pertenencia
   if (!pedido) return { error: 'Pedido no encontrado.' }
4. preflight = await preflightCancelacionPedido({ tenantId, pedidoId })   ← solo en cancelar
   (si !anulacionAutomatica y el form no trae confirmado=true → devolver advertencias, no ejecutar)
5. servicio = crearClienteServiceRole()
   await cancelarPedido(servicio, { …, estadoEsperado: pedido.estado, sellerId: … }, sesion.usuario)
6. revalidatePath(…)
```

---

## 8. Eventos Inngest

**No se define ningún evento nuevo.** Los dos implicados ya existen en `src/lib/inngest/eventos.ts`:

| Evento | Cambio |
|---|---|
| `dinero/pedido.estado_financiero_relevante` | **Sin cambio de contrato.** `'cancelado'` ya está en la unión de `estadoNuevo` (`eventos.ts:52`) y el `id` ya discrimina por estado (`pedido-financiero-${pedidoId}-${estadoNuevo}`, `pedidos.ts:518`). Lo que cambia es **dentro** del consumidor C1: derivar motivo/acción de bitácora y levantar la excepción de conciliación (D-A2/D-A4). |
| `operacion/pedido.ingestado` | **Sin cambio de contrato.** Se re-publica al editar dirección/comuna, **sin `id`** (§5, fila 4). El payload ya minimiza (solo dirección y comuna; nunca nombre ni teléfono — `eventos.ts:116-120`), y esa minimización se mantiene. |

Nada de esto abre una cola propia ni un servicio: es el orquestador gestionado que ya está.

---

## 9. Modelo de datos

Una migración, tres columnas, ningún índice nuevo. `public.pedidos` es `create or replace view … as select *`, así que las hereda sola (con la consecuencia de visibilidad de §6.2, que es intencional).

```sql
alter table operacion.pedidos
  add column if not exists cancelado_en             timestamptz,
  add column if not exists cancelado_por_usuario_id uuid references auth.users (id),
  add column if not exists motivo_cancelacion       text;
```

**Por qué columnas y no solo bitácora:** es el mismo patrón que `dinero.periodos_cobro` y `dinero.lineas_*` (`anulado_en` / `motivo_anulacion` / `anulado_por_usuario_id`). Permite que `/operaciones` y el portal muestren "cancelado por el seller — dirección duplicada" sin ir a buscarlo a la bitácora, y que la reportería lo agrupe. La bitácora sigue siendo el registro legal; esto es la proyección operativa.

**Lo que NO se agrega:**
- `creado_por_usuario_id` en `pedidos` (§1.1) — quedaría `null` en toda la ingesta ML.
- Ningún `deleted_at` ni borrado físico: la bitácora tiene `on delete restrict`, el pedido puede tener líneas de dinero y el `tracking_token` ya se compartió.
- Ninguna política de UPDATE nueva (§4.1).

---

## 10. Decisiones de negocio

### 10.0 Resueltas por el fundador (2026-08-11)

- **Alcance: solo los dos bugs, por ahora.** No se construye editar/cancelar todavía. Se
  implementan únicamente los arreglos que valen por sí solos y son independientes de la
  feature: el `sla_cumplido` que se hunde con las cancelaciones (§5 fila 5) y la excepción
  de conciliación que tapa el punto ciego H2 (§2.4 D-A2). El resto de este documento queda
  como plan para después del piloto.
- **N-3 → NO.** El coordinador **no** puede cancelar ni editar. Se mantiene el gate actual
  (`ajustar_operacion_diaria`: solo dueño y supervisor). No se crea `cancelar_pedidos`.
- **N-1 → SÍ.** Se agrega `linea_liquidacion_sin_pedido_entregado` como `tipo_diferencia`
  propio, con `bloquea_pago = true`. Un conductor pagado por una entrega cancelada es fuga
  de dinero real y merece bloquear el pago, no quedar como texto en una descripción.

Siguen abiertas: **N-2** (seller cancelando en ruta), **N-4** (PII en la bitácora de
edición), **N-5** (válvula para Flex), **N-6** (cancelar con período facturado — el
arquitecto recomienda sí, pero solo aplica cuando se construya la feature).

### 10.1 Las que siguen abiertas

| # | Pregunta | Recomendación del arquitecto | Coste de cambiar después |
|---|---|---|---|
| **N-1** | ¿Se agrega `linea_liquidacion_sin_pedido_entregado` como `tipo_diferencia`, o se reusa `linea_cobro_sin_pedido_entregado` para ambos lados? | **Agregarlo.** Un conductor pagado por una entrega cancelada es fuga real y necesita `bloquea_pago`. Coste: 1 migración + 3 mapeos. | Bajo (aditivo) |
| **N-2** | ¿El seller puede cancelar un pedido **`en_ruta`**? | **No.** El paquete ya va en el vehículo; el terminal correcto de un paquete que vuelve es `devuelto`. Si el fundador dice que sí, es solo agregar `'seller'` a esa fila de la tabla — pero entonces hay que definir **qué ve el conductor** cuando la parada desaparece a mitad de ruta, y eso es diseño de la app Expo. | Bajo en código, alto en UX |
| **N-3** | ¿El **coordinador** puede cancelar y editar? Hoy no tiene `ajustar_operacion_diaria` (solo dueño y supervisor). | **Que no lo tenga** (mantener el gate actual). Pero es el rol que más vive en `/operaciones` y el que atiende el teléfono a las 18:00. Alternativa: capacidad propia `cancelar_pedidos` para dueño+supervisor+coordinador. **Esta pregunta hay que hacérsela al fundador antes de implementar**, porque cambia la matriz RBAC y `qa` prueba contra ella. | Medio |
| **N-4** | ¿La bitácora guarda la **dirección anterior** completa al editar? | **No por defecto** (minimización). Solo nombres de campo + valor anterior de comuna y fecha. Si se quiere el valor completo para disputas, exige revisión de `seguridad-cumplimiento`. | Alto si se guarda y luego hay que borrarlo: la bitácora es append-only |
| **N-5** | ¿Existe alguna vía humana para cancelar un **Flex** vivo? | **No** (solo la existente `fallido → cancelado`). Rutax orquesta alrededor de la app de Flex, no la reemplaza. Si el fundador quiere una válvula de escape para Flex atascados, el camino correcto es `fallido_manual → devuelto`, no `cancelado`. | Bajo |
| **N-6** | ¿Se puede **cancelar** un pedido cuyo período ya está `facturado`? | **Sí, y se levanta excepción bloqueante de facturación** (D-A1/D-A2). La alternativa —bloquear la cancelación— mete una mentira en la operación para tapar una en el dinero. | Medio |

---

## 11. Tareas de implementación, por agente

### `base-datos-rls` (primero)
1. Migración `2026XXXX_operacion_pedidos_cancelacion.sql`: las 3 columnas de §9, idempotente, con `comment on column` (incluida la nota de que `motivo_cancelacion` es visible para el seller).
2. Migración `2026XXXX_dinero_tipo_diferencia_liquidacion_sin_pedido.sql` (si N-1 = sí): `ALTER TYPE dinero.tipo_diferencia_conciliacion ADD VALUE IF NOT EXISTS 'linea_liquidacion_sin_pedido_entregado'` + reemplazo idempotente del CHECK de `eventos_conciliacion.tipo_diferencia`. Patrón exacto en `20260613000010_dinero_conciliacion_tres_fuentes.sql`.
3. pgTAP `supabase/tests/database/rls_pedidos_edicion_cancelacion.test.sql` — **son pruebas de que nada se abrió**:
   - seller autenticado → `UPDATE operacion.pedidos` sobre **su propio** pedido ⇒ `42501`.
   - seller autenticado → `SELECT` de un pedido de otro seller del mismo tenant ⇒ 0 filas.
   - conductor → `SELECT` de un pedido no asignado a él ⇒ 0 filas.
   - interno del tenant B → `SELECT`/`UPDATE` de un pedido del tenant A ⇒ 0 filas.
   - `motivo_cancelacion` es legible por el seller dueño (documenta la decisión de §6.2).
4. **No crear** `pedidos_update_seller_propio`. Si alguien lo propone, este documento §4.1 es la razón.

### `backend`
5. `tipos.ts`: `EjecutorTransicion` + `'seller'`; `CancelarPedidoEntrada`, `EditarPedidoSameDayEntrada`, `CamposEditablesPedido`, `ResultadoEditarPedido`; `Pedido` + `canceladoEn`/`canceladoPorUsuarioId`/`motivoCancelacion` y su mapeo en `filaAPedido`.
6. `maquina-estados.ts`: las 5 filas del delta de §3.3.
7. `pedidos.ts`:
   - `cancelarPedido` y `editarPedidoSameDay` (§7.1), exportadas en `index.ts`.
   - En `actualizarEstadoPedido`: acción de bitácora `pedido.cancelado` cuando `estadoNuevo==='cancelado'`; `sla_cumplido` **forzado a `null`** en `cancelado` (§5 fila 5); resolución de incidencias abiertas al cancelar (§5 fila 6).
   - Extraer `calcularCompromisoYCorte` a `ventanas-corte.ts` y reusarla desde `crearPedidoSameDay` (no duplicar).
8. `generar-lineas.ts`: derivar `motivo_anulacion` y la acción de bitácora de `estadoNuevo` (H1); insertar el evento de conciliación idempotente en las dos ramas "no puedo anular" (H2), con `bloquea_facturacion`/`bloquea_pago`.
9. `dinero/preflight-cancelacion.ts` (§7.2).
10. `capacidades.ts`: `gestionar_pedidos_propios` + `puedeGestionarPedidosPropios`, solo para `seller`, con el comentario de respaldo RF-020/021.
11. Server Actions siguiendo el patrón de §7.3, en `(tenant)/operaciones/[pedidoId]/` y `portal/pedidos/[pedidoId]/`.
12. `api/conductor/manifiesto/route.ts`: excluir `ESTADOS_TERMINALES` (defensa en profundidad sobre la desactivación de la asignación).

### `frontend` (flujos previos de `ux-ui`; textos de `copywriter`)
13. `(tenant)/operaciones/[pedidoId]`: acción "Editar datos de entrega" (visible solo si `same_day` + `pendiente_asignacion` + capacidad) y "Cancelar pedido" (visible según la ventana de §3.1), con motivo obligatorio ≥10 caracteres.
14. Diálogo de confirmación de cancelación en dos tiempos cuando el preflight devuelve `anulacionAutomatica=false`: mostrar las advertencias ("este pedido ya está facturado; anular el cobro exige nota de crédito") y exigir confirmación explícita.
15. `portal/pedidos/[pedidoId]`: mismas dos acciones, acotadas a la ventana del seller; en `en_ruta`, mensaje "ya salió a ruta — contacta al courier" sin botón.
16. Mostrar `motivo_cancelacion` y quién canceló en ambas superficies. Ocultar la descarga de etiqueta en estados terminales.
17. Reusar `BadgeEstado` / `traducirEstadoPedido` (ya cubren `cancelado`). Probar los modales en viewport bajo.

### `qa`
18. Vitest — máquina de estados: los 5 casos nuevos **en positivo** y, sobre todo, los negativos (`seller` no puede `en_ruta→cancelado`, ni `→entregado`, ni tocar un Flex).
19. Vitest — **el caso que demuestra §2.2**: `pendiente_asignacion → asignado → fallido_manual` (con incidencia que afecta cobro) `→ asignado → pendiente_asignacion` ⇒ existe línea viva; cancelar desde ahí ⇒ la línea queda `anulada=true` con `motivo_anulacion='cancelacion'`.
20. Vitest — período `facturado`: cancelar ⇒ el pedido queda `cancelado`, la línea **no** se toca, y aparece el evento de conciliación con `bloquea_facturacion=true`.
21. Vitest — **regresión del bug `0164a56`**: `cancelarPedido`/`editarPedidoSameDay` con un cliente que no es `service_role` ⇒ error explícito, no fallo en runtime del usuario.
22. Vitest — edición: cambiar comuna ⇒ `geo_estado='pendiente'` + evento `operacion/pedido.ingestado` **sin `id`**; con `cobro_generado=true` ⇒ `tarifaReresuelta=false`.
23. Vitest — `sla_cumplido` queda `null` tras cancelar (y `slaGlobalPct` no se mueve).
24. E2E manual con `supabase/seed-torre-hoy.sql`: cancelar un pedido `asignado` ⇒ desaparece de la app del conductor (Expo, incluida la cola offline), desaparece del contador de la Torre, sigue visible en `/tracking/[token]` como "Cancelado".
25. **Aislamiento**: seller A intenta cancelar/editar un `pedidoId` del seller B por Server Action ⇒ "Pedido no encontrado", sin efecto y sin filtrar existencia.
26. Actualizar `checklist-pruebas-funcionales-mvp.md`.

### `seguridad-cumplimiento` (antes del release)
27. Resolver **N-4** (valores de PII en la bitácora de edición).
28. Revisar la visibilidad de `motivo_cancelacion` para el seller (§6.2).
29. **Hallazgo separado, no introducido por esta feature:** `notas_internas` es legible hoy por el seller (sus pedidos) y por el conductor (los asignados) vía `public.pedidos` con `GRANT` de tabla completa. Mismo patrón que ya mordió dos veces en el repo.
