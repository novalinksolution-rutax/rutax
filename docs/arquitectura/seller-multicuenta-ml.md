# Arquitectura — Seller con múltiples cuentas de Mercado Libre (1:1 → 1:N)

**Estado:** diseño aprobado para implementar. **Fecha:** 2026-06-30.
**Decisión:** un `seller` (cliente del courier) puede conectar **hasta 3 cuentas ML**. El SaaS ingesta las ventas Flex de cada cuenta y las centraliza; en la UI el origen se muestra **solo si el seller tiene más de una cuenta**.

> Contexto de negocio y taxonomía de alcance: ver `CLAUDE.md` (secciones "Diferenciador y alcance" y "Alcance del proyecto"). Este documento es el "cómo".

---

## 0. Estado actual verificado (no re-derivar)

- `identidad.conexiones_seller_ml` (`supabase/migrations/20260101000004_...sql:154`) es **1:1**: `seller_id ... unique` + índice único `conexiones_seller_ml_seller_id_uk` + comentario "1:1". Campos por-fila: `ml_user_id`, `access_token_ref`/`refresh_token_ref` (refs a `secretos_cifrados`), `token_expira_en`, `estado_salud`, `desconectada_desde`, `ultimo_error`, `tenant_id` denormalizado (+ trigger `validar_tenant`).
- **Ya es "per-conexión" en parte**: `operacion.intentos_backfill` tiene FK `conexion_ml_id → conexiones_seller_ml(id)` (`operacion_base.sql:510`).
- **Ya desambigua por cuenta**: `procesar-shipment.ts:130-207` — el UNIQUE de pedidos es `(tenant_id, ml_shipment_id)` (no global) y se resuelve la fila correcta por `ml_user_id` del evento.
- **Puntos que SE ROMPEN con 1:N** (hoy asumen una conexión por seller):
  - `procesar-shipment.ts:~230`: `conexiones_seller_ml ... .eq("seller_id", ...).maybeSingle()` para sacar el token.
  - `polling-estados.ts:~110`: idéntico patrón; además agrupa pedidos **por seller** y usa un solo token.
- **RLS** de `conexiones_seller_ml` (`...0004.sql:242-293`): SELECT del seller = `seller_id = claim_seller_id()` (ya devuelve N filas, escala solo); INSERT/UPDATE solo `interno`; tokens/salud solo service_role.
- `operacion.pedidos` (`operacion_base.sql:153`): tiene `seller_id`, `ml_shipment_id`, unique `(tenant_id, ml_shipment_id)`. **NO** guarda de qué cuenta ML provino.

---

## 1. Esquema — `identidad.conexiones_seller_ml`

Nueva migración idempotente (no editar migraciones viejas):

1. **Quitar el 1:1**: soltar la constraint de columna (`..._seller_id_key`, nombre auto — resolver con `DO`/catálogo) **y** `drop index if exists identidad.conexiones_seller_ml_seller_id_uk`. Crear índice **no único** en `seller_id` (lookups).
2. **Evitar la misma cuenta dos veces**: índice único parcial `(seller_id, ml_user_id) where ml_user_id is not null` (permite filas "pendientes" sin `ml_user_id` durante el OAuth).
3. **Tope de 3**: trigger `BEFORE INSERT` que cuenta conexiones del `seller_id` y lanza si ya hay 3. (CHECK no puede contar filas.) Concurrencia: riesgo bajo (alta manual); opcional `pg_advisory_xact_lock(hashtext(seller_id))`. El "3" queda como constante documentada, fácil de subir o mover a límite por plan más adelante.
4. **Display**: agregar `alias text` (nullable, lo nombra el interno) y `ml_nickname text` (nullable, se captura de ML al conectar) para mostrar la cuenta de forma legible.
5. Se mantienen sin cambios: FK compuesta `(tenant_id, seller_id)`, trigger de tenant, y `estado_salud`/tokens/`desconectada_desde` (**ya son por-fila = por-conexión**).

## 2. Migración de datos

Nula en cuanto a movimiento: cada fila 1:1 existente es válida como **primera** conexión del seller. Solo se sueltan constraints y se agregan las nuevas. Idempotente.

## 3. RLS

- **SELECT del seller**: sin cambio estructural (el predicado `seller_id = claim` ya devuelve todas sus conexiones). Verificar en pgTAP que un seller con 3 conexiones ve exactamente las suyas y ninguna de otro seller/tenant.
- **INSERT/UPDATE**: siguen `interno`-only; el alta de una cuenta adicional es acción de interno (o server action), no self-insert del seller. Sin cambio.
- Agregar casos a la suite de aislamiento: seller con múltiples conexiones; que el tope 3 y la unicidad parcial se disparen con 42501/errores esperados.

## 4. Origen del pedido

Agregar a `operacion.pedidos` la cuenta de origen. **Recomendado: `ml_user_id text` (nullable)**, estampado en la ingesta.
- Por qué `ml_user_id` y no FK `conexion_ml_id`: es **estable ante desconexión/reconexión** de una cuenta, y es exactamente la clave con la que `procesar-shipment` ya desambigua. La resolución a la conexión viva (para token/alias) es `(seller_id, ml_user_id)`.
- Alternativa/complemento: FK `conexion_ml_id ... on delete set null` para joins directos. Decisión abierta (ver §7-D1). `same_day` deja ambas en NULL.

## 5. Pipeline ML (todo "por conexión")

- **`procesar-shipment.ts`**: en "consultar-ml", resolver la conexión por `(seller_id, ml_user_id)` — usando el `ml_user_id` del evento (ya disponible) o el del pedido — en vez de `.eq("seller_id").maybeSingle()`. **Corrige el breaker.**
- **`polling-estados.ts`**: agrupar pedidos por `(seller_id, ml_user_id)` y pollear cada conexión con **su** token. **Corrige el breaker.**
- **Ingesta** (crea pedidos): estampar `ml_user_id` de la conexión ingestada en cada pedido. `intentos_backfill` ya conoce `conexion_ml_id` → derivar y estampar.
- **`refrescar-tokens.ts` / `sondeo-salud.ts`**: probablemente ya operan por-fila (tokens/salud son por-conexión); **verificar** que no usen `.maybeSingle()` por seller. Salud e `ultimo_error` quedan por conexión.
- Idempotencia y "no exponer token" se conservan tal cual.

## 6. UI

- Pantalla de conexiones (interno + portal seller): listar hasta 3, conectar otra hasta el tope, salud y `alias` por conexión; reconexión **por conexión** (ver §7-D3).
- Pedidos (lista/detalle) y manifiesto: mostrar el origen (alias/`ml_nickname`) **solo si el seller tiene >1 conexión**. Regla de presentación: contar conexiones del seller; si >1, badge de origen. Join por `(seller_id, ml_user_id)`.

## 7. Decisiones abiertas y riesgos

- **D1 — Columna de origen**: `ml_user_id` (recomendado) vs. `conexion_ml_id` FK vs. ambas. → *pendiente de confirmar antes de la migración.*
- **D2 — Unicidad de la cuenta**: hoy `procesar-shipment` ya contempla la **misma cuenta ML en 2 couriers**; por eso la unicidad se limita a `(seller_id, ml_user_id)`, **no** global. Confirmar que se permite la misma cuenta en distintos sellers/tenants. *(Recomendado: sí, permitir.)*
- **D3 — OAuth "agregar cuenta" vs "reconectar"**: el flujo/callback debe distinguir alta de cuenta adicional de reconexión de una existente; el `state` debe llevar el `seller_id` y (para reconexión) el `conexion_ml_id` objetivo. La server action de reconexión pasa de "la conexión del seller" a "esta conexión (por id)". → **integraciones**.
- **D4 — Sequencing crítico**: el fix de `procesar-shipment`/`polling` debe salir **junto** con el esquema. Si se habilita conectar una 2ª cuenta sin el fix, el token-fetch `.maybeSingle()` rompe la sincronización de estados del seller. No mergear el esquema sin el pipeline.
- **D5 — Tope 3**: constante por ahora; futura parametrización por plan.

## 8. Pasos siguientes (secuencia)

1. **base-datos-rls**: migración §1–§3 + columna de origen §4 (según D1) + tests pgTAP de aislamiento/tope/unicidad.
2. **integraciones**: fixes de pipeline §5 (por conexión) + OAuth "agregar cuenta"/reconexión por id §7-D3.
3. **frontend**: UI de conexiones (hasta 3) + origen en pedidos "solo si >1" §6 (flujo previo por `ux-ui`).
4. **qa**: aislamiento con seller multi-cuenta, tope 3, unicidad, y que estados/backfill funcionen por conexión.

## 9. Progreso

**Hecho (2026-06-30, sesión principal — aditivo, sin cambiar el comportamiento 1:1):**
- Migración `supabase/migrations/20260630000001_operacion_pedido_origen_ml_user.sql`: `operacion.pedidos.ml_user_id` (nullable) + backfill desde la conexión actual (inequívoco mientras es 1:1) + índice parcial `(seller_id, ml_user_id)` + re-emisión de la vista `public.pedidos`. **Escrita e idempotente; falta aplicarla en el entorno local (`npx supabase ...`) para verificarla en runtime.**
- `ejecutar-backfill.ts`: estampa `ml_user_id` en cada pedido ingestado (único ingreso Flex; el same-day de `operacion/pedidos.ts` lo deja `null`, correcto).
- Verificado: `tsc --noEmit` limpio; 42 tests de `ejecutar-backfill`/`procesar-shipment` en verde.

**Pendiente = el bundle acoplado del §7-D4** (no habilitar "agregar cuenta" hasta cerrarlo): flip de `conexiones_seller_ml` (drop `unique(seller_id)`, unicidad parcial `(seller_id, ml_user_id)`, tope 3, `alias`/`ml_nickname`) → **base-datos-rls**; `persistirTokens` onConflict + refactor de helpers "por seller" (token/etiqueta/portal) + `procesar-shipment`/`polling` por conexión + OAuth "agregar cuenta" → **integraciones**; UI de conexiones + badge de origen "solo si >1" → **frontend/ux-ui**; tests → **qa**.
