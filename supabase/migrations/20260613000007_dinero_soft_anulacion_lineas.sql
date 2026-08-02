-- =============================================================================
-- Migración 0017 · Dinero — Soft-anulación de líneas de cobro/liquidación
-- =============================================================================
-- Refinamiento del flujo `fallido → devuelto`. Cuando un pedido que YA generó
-- su línea de cobro (al seller) y su línea de liquidación (al conductor) pasa
-- de `fallido` a `devuelto`, el motor (backend, generar-lineas.ts) debe ANULAR
-- esas líneas SI su período / liquidación siguen `abierto`. La anulación es
-- SOFT (no DELETE): la fila se conserva para trazabilidad y para preservar la
-- unicidad por pedido (UNIQUE(pedido_id) intacto).
--
-- Diseño elegido (mínimo coherente con lo que YA existe en 0006):
--   dinero.lineas_cobro y dinero.lineas_liquidacion NO tienen columna `estado`
--   (enum) — solo montos (monto_base_clp, ajuste_incidencia_clp, monto_final_clp
--   GENERATED). Por eso NO se crea/extiende ningún enum. Se añaden a AMBAS tablas:
--     - anulada        boolean not null default false
--     - anulada_en     timestamptz                     (NULL salvo anulada=true)
--     - motivo_anulacion text                          (p.ej. 'devolucion')
--   Las tres son nullable o con default → no rompen filas ni la generación
--   existente. Mismo patrón de auditoría de anulación que periodos_cobro (0011:
--   motivo_anulacion / anulado_en / anulado_por_usuario_id).
--
-- Lo que esta migración NO hace (es responsabilidad de backend):
--   - NO pone monto_final_clp a 0. monto_final_clp es GENERATED (monto_base +
--     ajuste) y NO se toca aquí. La forma de "anular el efecto en dinero" la
--     decide backend: marcar anulada=true y/o setear ajuste_incidencia_clp para
--     llevar monto_final a 0; ambas viven en el job, no en el esquema. Esta
--     migración solo aporta las columnas de marca/trazabilidad.
--   - NO toca el UNIQUE(pedido_id) — la línea anulada se queda en su lugar.
--   - NO toca la lógica de generación ni los estados de operacion.pedidos.
--
-- RLS: SIN cambios de políticas. Las columnas nuevas heredan las políticas
-- existentes de 0006 (lineas_cobro: P1 tenant + P2 seller; lineas_liquidacion:
-- P1 tenant + P3 conductor). Las vistas public.lineas_cobro / public.lineas_liquidacion
-- son `select *` y se re-emiten para APPENDEAR las columnas nuevas (con
-- security_invoker = true → la RLS de la tabla base se evalúa con el rol que
-- consulta; sin bypass). Escritura sigue siendo exclusiva de service_role.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE VIEW. Re-aplicable
-- sobre una base ya migrada.
--
-- Validación: el stack local quedó en puertos reubicados (workaround WinNAT)
-- mientras config.toml apunta a 5432x, por lo que `supabase db reset` / `test db`
-- NO se ejecutaron — esta migración se validó ESTÁTICAMENTE contra el esquema
-- real de 0006/0011. La prueba pgTAP de aislamiento (qa) y la ejecución la
-- corren cuando el stack vuelva a alinearse.
-- =============================================================================

-- =============================================================================
-- 1. dinero.lineas_cobro — marca de soft-anulación
--    Las escribe SOLO service_role (el job del motor corre server-side).
-- =============================================================================
alter table dinero.lineas_cobro
  add column if not exists anulada boolean not null default false;

alter table dinero.lineas_cobro
  add column if not exists anulada_en timestamptz;

alter table dinero.lineas_cobro
  add column if not exists motivo_anulacion text;

comment on column dinero.lineas_cobro.anulada is
  'Soft-anulación: true si la línea fue anulada (pedido fallido→devuelto con su
   período aún abierto). La fila se conserva para trazabilidad; el UNIQUE(pedido_id)
   sigue vigente. Default false. La escribe solo service_role (motor entrega→dinero).';

comment on column dinero.lineas_cobro.anulada_en is
  'Momento de la anulación (NULL salvo anulada=true), zona horaria America/Santiago
   aplicada en la capa de aplicación.';

comment on column dinero.lineas_cobro.motivo_anulacion is
  'Motivo de la anulación (NULL salvo anulada=true), p.ej. ''devolucion''. Texto
   controlado por el motor — sin secretos ni datos de terceros.';

-- =============================================================================
-- 2. dinero.lineas_liquidacion — marca de soft-anulación
-- =============================================================================
alter table dinero.lineas_liquidacion
  add column if not exists anulada boolean not null default false;

alter table dinero.lineas_liquidacion
  add column if not exists anulada_en timestamptz;

alter table dinero.lineas_liquidacion
  add column if not exists motivo_anulacion text;

comment on column dinero.lineas_liquidacion.anulada is
  'Soft-anulación: true si la línea fue anulada (pedido fallido→devuelto con su
   liquidación aún abierta/borrador). La fila se conserva para trazabilidad; el
   UNIQUE(pedido_id) sigue vigente. Default false. La escribe solo service_role.';

comment on column dinero.lineas_liquidacion.anulada_en is
  'Momento de la anulación (NULL salvo anulada=true), zona horaria America/Santiago
   aplicada en la capa de aplicación.';

comment on column dinero.lineas_liquidacion.motivo_anulacion is
  'Motivo de la anulación (NULL salvo anulada=true), p.ej. ''devolucion''. Texto
   controlado por el motor — sin secretos ni datos de terceros.';

-- =============================================================================
-- 3. Índices parciales — acelerar el filtrado de líneas VIGENTES (no anuladas)
--    que es el caso de uso dominante (totalizar período / liquidación). Parciales
--    sobre anulada = true para listar/auditar lo anulado sin escanear todo.
-- =============================================================================
create index if not exists idx_lineas_cobro_anuladas
  on dinero.lineas_cobro (tenant_id, seller_id)
  where anulada = true;

create index if not exists idx_lineas_liq_anuladas
  on dinero.lineas_liquidacion (tenant_id, driver_id)
  where anulada = true;

-- =============================================================================
-- 4. Re-emitir las vistas public.* (security_invoker = true)
--
-- NOTA TÉCNICA (mismo problema real que 0011, no cambio de decisión): una vista
-- `select *` CONGELA su lista de columnas al crearse. Las vistas de 0006 no
-- incluyen las columnas de esta migración. CREATE OR REPLACE VIEW permite
-- APPENDEAR columnas al final (el prefijo existente coincide en nombre/orden/tipo),
-- preserva grants y re-expone el estado real de la tabla vía PostgREST. La RLS no
-- cambia: security_invoker = true evalúa las políticas P1+P2 / P1+P3 de la tabla
-- base con el rol que consulta.
-- =============================================================================
create or replace view public.lineas_cobro
  with (security_invoker = true)
  as select * from dinero.lineas_cobro;

comment on view public.lineas_cobro is
  'Espejo de dinero.lineas_cobro para PostgREST. RLS heredada: P1 + P2 seller.
   Conductores no tienen acceso. Incluye la marca de soft-anulación (0017).';

create or replace view public.lineas_liquidacion
  with (security_invoker = true)
  as select * from dinero.lineas_liquidacion;

comment on view public.lineas_liquidacion is
  'Espejo de dinero.lineas_liquidacion para PostgREST. RLS heredada: P1 + P3
   conductor. Sellers no tienen acceso. Incluye la marca de soft-anulación (0017).';

-- =============================================================================
-- 5. Grants idempotentes (CREATE OR REPLACE los preserva; explícitos por defensa
--    en profundidad — mismo patrón que 0006/0011).
-- =============================================================================
grant select on public.lineas_cobro       to authenticated;
grant select on public.lineas_liquidacion to authenticated;

revoke insert, update, delete on public.lineas_cobro       from authenticated, anon;
revoke insert, update, delete on public.lineas_liquidacion from authenticated, anon;
