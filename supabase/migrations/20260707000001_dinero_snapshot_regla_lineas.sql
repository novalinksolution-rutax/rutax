-- =============================================================================
-- Migración 0033 · Dinero — Snapshot inmutable de la regla económica por línea
-- =============================================================================
-- Hallazgo P0 de auditoría externa de arquitectura: "Versionar y congelar las
-- reglas económicas". Cada línea financiera (cobro al seller / liquidación al
-- conductor) debe conservar un SNAPSHOT inmutable de todo lo que determinó su
-- valor (tarifa vigente, zona, recargos/descuentos, incidencia, elegibilidad),
-- para poder EXPLICAR un cobro o una liquidación meses después aunque la
-- configuración (tarifas, zonas, reglas) haya cambiado desde entonces.
--
-- Diseño (decidido por `arquitecto`, no re-abrir aquí):
--   A. Una columna `snapshot_regla jsonb not null default '{}'` POR CADA tabla
--      de línea (dinero.lineas_cobro y dinero.lineas_liquidacion). NO una tabla
--      satélite compartida: mezclar el snapshot de cobro (visible al seller) con
--      el de liquidación (visible al conductor) crearía un conflicto de
--      confidencialidad. Una columna por línea mantiene cada snapshot en el
--      dominio de RLS de su propia tabla (P1+P2 cobro / P1+P3 liquidación).
--
--   B. CONFIDENCIALIDAD — el punto más importante de esta migración. Las vistas
--      public.lineas_cobro (seller) y public.lineas_liquidacion (conductor) eran
--      `select *` (0006, re-emitidas en 0017). Con `select *`, en cuanto se
--      añade una columna a la tabla base la vista terminaría exponiéndola. El
--      snapshot contiene dato INTERNO del courier (motivo/regla, referencias,
--      folios internos) que NO está pactado con el seller ni con el conductor.
--      Por eso ambas vistas se REDEFINEN con lista EXPLÍCITA de columnas que
--      OMITE `snapshot_regla`. security_invoker = true se mantiene: la RLS de
--      FILA de la tabla base no cambia; solo se acota qué COLUMNAS ve la vista.
--
--   C. Backfill idempotente (parte obligatoria de esta migración): reconstruye
--      un snapshot best-effort para las líneas que YA existen (datos de
--      demo/staging del tenant único). Marcado `origen_snapshot =
--      'backfill_reconstruido'` como bandera general del envelope.
--
-- Lo que esta migración NO hace:
--   - NO toca la RLS de las tablas base (enable+force y políticas P1/P2/P3 ya
--     existen desde 0006). Solo redefine las dos vistas public.*.
--   - NO revoca column-level select de la tabla base: el límite de
--     confidencialidad hacia seller/conductor es que PostgREST solo expone el
--     schema `public` (las vistas), no `dinero`. Decisión de `arquitecto`.
--   - NO llena el contenido "vivo" del snapshot en generación nueva: eso es
--     trabajo de `backend` (el job del motor entrega→dinero), server-side.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE VIEW + UPDATE con
-- guard sobre snapshot_regla. Re-aplicable sobre una base ya migrada.
-- =============================================================================

-- =============================================================================
-- 1. dinero.lineas_cobro — columna de snapshot inmutable (solo lectura interna)
--    La escribe SOLO service_role (el job del motor corre server-side).
-- =============================================================================
alter table dinero.lineas_cobro
  add column if not exists snapshot_regla jsonb not null default '{}'::jsonb;

comment on column dinero.lineas_cobro.snapshot_regla is
  'Snapshot INMUTABLE (append-once) de la regla económica que determinó el valor
   de esta línea de cobro: tarifa vigente, zona, recargos/descuentos, fecha
   efectiva, estado del pedido, incidencia y elegibilidad. Congelado al generar
   la línea para poder explicar el cobro meses después aunque la configuración
   haya cambiado (hallazgo P0 de auditoría). DATO INTERNO DEL COURIER: NUNCA se
   expone al seller — por eso la vista public.lineas_cobro lo OMITE. Lo llena
   solo service_role (motor entrega→dinero). Estructura (envelope): version,
   origen_snapshot (generacion_original|backfill_reconstruido), generado_en,
   job_run_id, regla, tarifa, recargos_descuentos, zona, fecha_efectiva,
   estado_pedido, incidencia, elegibilidad.';

-- =============================================================================
-- 2. dinero.lineas_liquidacion — columna de snapshot inmutable
--    La escribe SOLO service_role.
-- =============================================================================
alter table dinero.lineas_liquidacion
  add column if not exists snapshot_regla jsonb not null default '{}'::jsonb;

comment on column dinero.lineas_liquidacion.snapshot_regla is
  'Snapshot INMUTABLE (append-once) de la regla económica que determinó el valor
   de esta línea de liquidación al conductor: tarifa/valor base, recargos,
   fecha efectiva, incidencia y elegibilidad. Congelado al generar la línea para
   poder explicar la liquidación meses después (hallazgo P0 de auditoría). DATO
   INTERNO DEL COURIER: NUNCA se expone al conductor — por eso la vista
   public.lineas_liquidacion lo OMITE. Lo llena solo service_role (motor
   entrega→dinero).';

-- =============================================================================
-- 3. Redefinir public.lineas_cobro con lista EXPLÍCITA de columnas (sin
--    snapshot_regla). security_invoker = true → la RLS de fila (P1 tenant +
--    P2 seller) de la tabla base se evalúa con el rol que consulta; sin bypass.
--
--    La lista replica exactamente el orden de columnas de la tabla base hasta
--    `motivo_anulacion` (lo que la vista `select *` ya exponía tras 0017) y
--    OMITE la nueva `snapshot_regla`. CREATE OR REPLACE VIEW lo permite porque
--    el conjunto de columnas resultante es idéntico al vigente (mismo nombre,
--    orden y tipo); no se elimina ni reordena ninguna columna previa.
-- =============================================================================
create or replace view public.lineas_cobro
  with (security_invoker = true)
  as select
    id,
    tenant_id,
    seller_id,
    pedido_id,
    periodo_cobro_id,
    tarifa_id,
    monto_base_clp,
    ajuste_incidencia_clp,
    monto_final_clp,
    concepto,
    tipo_pedido,
    fecha_entrega,
    incidencia_id,
    origen_generacion,
    generado_por_usuario_id,
    notas,
    creado_en,
    actualizado_en,
    anulada,
    anulada_en,
    motivo_anulacion
  from dinero.lineas_cobro;

comment on view public.lineas_cobro is
  'Espejo de dinero.lineas_cobro para PostgREST. RLS heredada: P1 + P2 seller.
   Conductores no tienen acceso. Lista de columnas EXPLÍCITA: OMITE
   snapshot_regla (dato interno del courier — nunca al seller). Incluye la marca
   de soft-anulación (0017).';

-- =============================================================================
-- 4. Redefinir public.lineas_liquidacion con lista EXPLÍCITA (sin snapshot_regla)
--    security_invoker = true → RLS P1 tenant + P3 conductor de la tabla base.
-- =============================================================================
create or replace view public.lineas_liquidacion
  with (security_invoker = true)
  as select
    id,
    tenant_id,
    driver_id,
    pedido_id,
    liquidacion_id,
    monto_base_clp,
    ajuste_incidencia_clp,
    monto_final_clp,
    concepto,
    fecha_entrega,
    incidencia_id,
    origen_generacion,
    generado_por_usuario_id,
    notas,
    creado_en,
    actualizado_en,
    anulada,
    anulada_en,
    motivo_anulacion
  from dinero.lineas_liquidacion;

comment on view public.lineas_liquidacion is
  'Espejo de dinero.lineas_liquidacion para PostgREST. RLS heredada: P1 + P3
   conductor. Sellers no tienen acceso. Lista de columnas EXPLÍCITA: OMITE
   snapshot_regla (dato interno del courier — nunca al conductor). Incluye la
   marca de soft-anulación (0017).';

-- =============================================================================
-- 5. Grants idempotentes (CREATE OR REPLACE los preserva; explícitos por
--    defensa en profundidad — mismo patrón que 0006/0017). La RLS de fila no
--    cambia; la escritura sigue siendo exclusiva de service_role.
-- =============================================================================
grant select on public.lineas_cobro       to authenticated;
grant select on public.lineas_liquidacion to authenticated;

revoke insert, update, delete on public.lineas_cobro       from authenticated, anon;
revoke insert, update, delete on public.lineas_liquidacion from authenticated, anon;

-- =============================================================================
-- 6. Backfill idempotente — reconstrucción best-effort de las líneas EXISTENTES
--
-- Guard de idempotencia (ambos UPDATEs): solo tocar filas cuyo snapshot sigue
-- vacío o sin bandera de origen. Re-ejecutar la migración no sobrescribe un
-- snapshot ya poblado (ni el 'generacion_original' que escriba backend después).
--
-- Campos que vienen de la PROPIA FILA (no de fuentes mutables → fieles):
--   tarifa.valor_base_clp                = monto_base_clp
--   recargos_descuentos.ajuste_inc_clp   = ajuste_incidencia_clp
--   fecha_efectiva.fecha_entrega_local   = fecha_entrega
--   estado_pedido.tipo_pedido            = tipo_pedido   (solo cobro)
--   incidencia.incidencia_id             = incidencia_id
--   elegibilidad.genera                  = not anulada
--
-- Campos reconstruidos best-effort desde el estado ACTUAL de identidad.tarifas
-- (zona, vigencia, tipo_entrega, modo_calculo, mínimos y recargo pactado).
-- Todo el envelope lleva origen_snapshot = 'backfill_reconstruido' como bandera
-- general, así que no se marca campo por campo. recargo_reprogramacion_clp,
-- minimo_retiro_clp y minimo_facturacion_clp SÍ existen en identidad.tarifas
-- (migración 20260613000010, F17) — se copian del estado actual de la tarifa
-- (reconstrucción best-effort, no el valor histórico). recargo_*_aplicado_clp
-- se deja en 0: motor.ts nunca ha conectado el recargo al cálculo real, así que
-- ninguna línea backfillable pudo haberlo aplicado.
-- =============================================================================

-- 6.1 dinero.lineas_cobro — join contra identidad.tarifas por tarifa_id.
--     tarifa_id es NOT NULL con FK on delete restrict → la tarifa siempre existe.
update dinero.lineas_cobro lc
set snapshot_regla = jsonb_build_object(
  'version',          1,
  'origen_snapshot',  'backfill_reconstruido',
  'generado_en',      to_jsonb(now()),
  'job_run_id',       null,
  'regla', jsonb_build_object(
    'motor_version', null,
    'regla_id',      null,
    'referencia',    'backfill_migracion_20260707000001'
  ),
  'tarifa', jsonb_build_object(
    'tarifa_id',      to_jsonb(lc.tarifa_id),
    'tipo_entrega',   to_jsonb(t.tipo_entrega),
    'modo_calculo',   to_jsonb(t.modo_calculo),
    'valor_base_clp', to_jsonb(lc.monto_base_clp),
    'vigente_desde',  to_jsonb(t.vigente_desde),
    'vigente_hasta',  to_jsonb(t.vigente_hasta),
    'estado',         to_jsonb(t.estado)
  ),
  'recargos_descuentos', jsonb_build_object(
    'ajuste_incidencia_clp',                to_jsonb(lc.ajuste_incidencia_clp),
    'recargo_reprogramacion_pactado_clp',   to_jsonb(t.recargo_reprogramacion_clp),
    'recargo_reprogramacion_aplicado_clp',  to_jsonb(0),
    'minimo_retiro_clp',                    to_jsonb(t.minimo_retiro_clp),
    'minimo_facturacion_clp',               to_jsonb(t.minimo_facturacion_clp)
  ),
  'zona', jsonb_build_object(
    'fuente',              'tarifa_actual_reconstruida',
    'zona_id',             null,
    'zona_texto',          to_jsonb(t.zona),
    'comuna_destinatario', null
  ),
  'fecha_efectiva', jsonb_build_object(
    'fecha_entrega_local', to_jsonb(lc.fecha_entrega)
  ),
  'estado_pedido', jsonb_build_object(
    'tipo_pedido', to_jsonb(lc.tipo_pedido)
  ),
  'incidencia', jsonb_build_object(
    'incidencia_id', to_jsonb(lc.incidencia_id)
  ),
  'elegibilidad', jsonb_build_object(
    'genera',        (not lc.anulada),
    'ajuste_clp',    to_jsonb(lc.ajuste_incidencia_clp),
    'motivo_codigo', 'RECONSTRUIDO_LINEA_EXISTENTE',
    'motivo_texto',  'Snapshot reconstruido por el backfill de la migración '
                     || '20260707000001. El motivo/regla económica original no '
                     || 'quedó registrado al generar esta línea; los campos '
                     || 'derivados de la propia fila son fieles, los tomados de '
                     || 'identidad.tarifas reflejan el estado actual.'
  )
)
from identidad.tarifas t
where lc.tarifa_id = t.id
  and (
    lc.snapshot_regla = '{}'::jsonb
    or lc.snapshot_regla->>'origen_snapshot' is null
  );

-- 6.2 dinero.lineas_liquidacion — sin tarifa_id ni tipo_pedido ni minimos.
--     Todo sale de la propia fila (no hay join a tarifas en el modelo actual).
update dinero.lineas_liquidacion ll
set snapshot_regla = jsonb_build_object(
  'version',          1,
  'origen_snapshot',  'backfill_reconstruido',
  'generado_en',      to_jsonb(now()),
  'job_run_id',       null,
  'regla', jsonb_build_object(
    'motor_version', null,
    'regla_id',      null,
    'referencia',    'backfill_migracion_20260707000001'
  ),
  'tarifa', jsonb_build_object(
    'tarifa_id',      null,
    'valor_base_clp', to_jsonb(ll.monto_base_clp)
  ),
  'recargos_descuentos', jsonb_build_object(
    'ajuste_incidencia_clp', to_jsonb(ll.ajuste_incidencia_clp)
  ),
  'zona',  null,
  'fecha_efectiva', jsonb_build_object(
    'fecha_entrega_local', to_jsonb(ll.fecha_entrega)
  ),
  'incidencia', jsonb_build_object(
    'incidencia_id', to_jsonb(ll.incidencia_id)
  ),
  'elegibilidad', jsonb_build_object(
    'genera',        (not ll.anulada),
    'ajuste_clp',    to_jsonb(ll.ajuste_incidencia_clp),
    'motivo_codigo', 'RECONSTRUIDO_LINEA_EXISTENTE',
    'motivo_texto',  'Snapshot reconstruido por el backfill de la migración '
                     || '20260707000001. El motivo/regla económica original no '
                     || 'quedó registrado al generar esta línea; los campos '
                     || 'derivados de la propia fila son fieles.'
  )
)
where (
  ll.snapshot_regla = '{}'::jsonb
  or ll.snapshot_regla->>'origen_snapshot' is null
);
