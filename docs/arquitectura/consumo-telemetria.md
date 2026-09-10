# Módulo Consumo — telemetría de costo y uso por courier→usuario

> Observabilidad de PLATAFORMA (interna de Rutax), no una feature del courier.
> El courier **nunca** lee su consumo — exponerlo sería una decisión nueva que
> abre RLS, no un atajo. Diseño verificado contra el código el 2026-09-09.
> Precios en `consumo-precios-apis.md`.

## Ubicación y contrato

- **Captura (escritura):** `src/lib/consumo/` — helper transversal fire-and-forget,
  hermano de `src/lib/observabilidad/`. Es infraestructura (como logging), no un
  módulo de dominio. Lo invocan `integraciones`, las API routes del conductor y
  server actions de cualquier módulo.
- **Lectura/agregación:** `src/modules/plataforma/consumo/` — junto a
  `metricas-uso.ts`. Solo lo consume `src/app/admin/consumo/`.
- **Regla dura:** `consumo` es un **sumidero**, no una fuente. Ningún módulo de
  negocio importa de `consumo`. No viola `operacion`/`dinero` ↛ `contexto` porque
  no es `contexto` ni depende de él.

## Modelo de datos — esquema `infra`, deny-all

**Por qué deny-all y no tenant_id + RLS:** aunque dar de alta un courier agrega
filas (test mecánico de CLAUDE.md), esta telemetría cumple el carve-out completo,
igual que `infra.ejecuciones_job`: (1) solo el super-admin la lee, cross-tenant,
para decidir sobre costos de plataforma; (2) `tenant_id` es columna de **triaje**,
no frontera de aislamiento; (3) solo `service_role` escribe y lee — RLS forzada
sin políticas, sin vista espejo en `public`, grants solo a `service_role`.
Molde: `supabase/migrations/20260709000002_infra_telemetria_ejecuciones_job.sql`.

Tres tablas:
- **`infra.eventos_consumo`** — el crudo. `bigint identity` (no UUID, por volumen
  ~10⁴–10⁵ filas/día). Columnas: `ocurrido_en`, `tenant_id`, `usuario_id`,
  `tipo_usuario`, `tipo_evento`, `superficie` (api_route/server_action/adaptador/
  job/cron), `recurso`, `proveedor_costo`, `sku`, `unidades`, `costo_estimado_usd`,
  `dentro_free_tier`, `resultado`, `correlacion_id`, `metadata` (jsonb REDACTADO),
  `clave_idempotencia`. Retención: crudo 90 días, luego agregados mensuales.
- **`infra.precios_consumo`** — tarifario versionado por `vigente_desde`
  (`proveedor_costo`, `sku`, `precio_unitario_usd`, `unidad`, `free_tier_mensual`,
  `nota`). Seed desde `consumo-precios-apis.md`.
- **`infra.consumo_mensual`** — materialización mensual para tendencias (poblada
  por el cron antes de podar el crudo).

**Idempotencia:** eventos de jobs con reintento (WhatsApp, geocoding) pasan
`clave_idempotencia` con índice único parcial. Eventos del borde HTTP (reordenar,
refrescar) no la exigen.

**RPCs `security definer`, `EXECUTE` solo `service_role`** (molde `job_run_registrar`):
- `public.consumo_registrar(...)` — escritura idempotente, calcula
  `costo_estimado_usd` = `unidades × precio_vigente`, `dentro_free_tier`, prune
  oportunista (~1% de llamadas).
- `consumo_por_courier`, `consumo_por_conductor`, `consumo_por_proveedor` — lectura.

## Instrumentación (dos capas complementarias)

Helper `registrarConsumo(...)` — **nunca lanza, fire-and-forget, timeout corto,
redacta con `redactarSensible`**. Se invoca con `void` en el path crítico.

**(A) Borde de las API routes del conductor** (tras `autenticarBearer`, que ya da
tenant/usuario/tipo) — captura **comportamiento** sin tocar el repo Expo:
`manifiesto/ruta` (optimizar/mover/ir-a-esta-ahora), `manifiesto/*`, `pedidos/*/
entregar|no-entregar`, `retiros/*`, `traspasos`, `evidencias/*`, `disponibilidad`,
`vehiculo`, `punto-termino`.

**(B) Adaptadores/puertos de costo** — captura **costo real con SKU**:
- Ruteo optimización (`ruta-manifiesto.ts`): `google_route_optimization`,
  `unidades = nº paradas` (cobra por PARADA), `sku='single_vehicle'`. Fallback
  local haversine → `proveedor_costo=null, unidades=0`.
- Ruteo trazado (Compute Routes): `google_compute_routes`, `unidades = nº peticiones`
  (cobra por REQUEST; una ruta de 30 paradas se parte en tramos de 25).
- Geocoding (`resolver-coordenada.ts`): `google_geocoding`, solo si hubo llamada
  real (no cache hit).
- WhatsApp (`envio.ts`/`jobs/enviar-whatsapp.ts`): `whatsapp_cloud`, tras reservar
  la fila y llamar a Meta, reusando `clave_idempotencia`.
- Email (`resend.ts`): `resend`.
- ML (`peticionMl`): `ml`, `costo=0` — se cuenta para vigilar la cuota, no el gasto.

**Regla dura:** la `metadata` JAMÁS lleva coordenadas, direcciones, nombres,
domicilio del conductor ni tokens. Solo conteos, SKUs, códigos de estado.

## KPIs

**Costos:** costo de ruteo por conductor/mes; costo por entrega efectiva; % dentro
de free tier por proveedor; top-N couriers y conductores por costo; tendencia
mensual; % de cuota ML consumida.
**Uso:** reoptimizaciones por conductor/día (el "refresca de más", cada una cuesta
nº-paradas); reordenamientos manuales; adopción de funcionalidades por tipo de
usuario; ratio motor-local vs proveedor de pago.

## TODO — pendientes conocidos (anotados, no bloqueantes para v1)

- **Cron de compactación mensual** (`infra.consumo_mensual`): NO construido. Los
  tableros v1 leen las tres RPCs de tiempo real sobre el crudo (retención ~90
  días), suficiente para lo que hoy se necesita. Cuando se quiera tendencia de
  más de 3 meses, hace falta el cron que puebla `consumo_mensual` antes del
  prune del crudo.
- **Instrumentación de borde pendiente** (superficie `api_route`, prioridad
  baja — cubiertas `manifiesto/ruta`, `entregar`/`no-entregar`,
  `manifiesto/iniciar`/`completar`, `retiros/*/cerrar`, `traspasos`):
  `evidencias/*`, `disponibilidad`, `vehiculo`, `punto-termino`. No miden costo
  (no llaman a un proveedor de pago), solo comportamiento — agregar
  `void registrarConsumo(...)` tras `autenticarBearer` cuando se necesite ese
  dato.
- **Módulo de agregación**: por colisión de nombre con
  `src/modules/plataforma/consumo.ts` (consumo del TENANT contra los límites
  de su plan — concepto distinto), la lectura vive en
  `src/modules/plataforma/consumo-agregado.ts` en vez del directorio
  `consumo/` que proponía este documento.

## UI — `src/app/admin/consumo/`

Ítem en `GRUPOS_ADMIN` (grupo "Plataforma"). Gate super-admin AAL2 del layout +
`export const dynamic = "force-dynamic"`. Dos pestañas: **Costos** (`/admin/consumo`)
y **Uso** (`/admin/consumo/uso`), más drill-down `/admin/consumo/[tenantId]`.
Reusa `TarjetaKPI`/`SerieFacturado`/`EmptyState`/`BadgeEstado` de `metricas/page.tsx`.
Sin librería de charts (divs, como métricas).
