-- =============================================================================
-- 0035 · Columna minimo_retiro_clp en courier_config_payout (fix schema faltante)
-- =============================================================================
-- El job REAL de payout a conductores (`src/modules/dinero/jobs/ejecutar-payout.ts`,
-- step `calcular-monto-liquido`) y el preflight de la acción humana
-- (`src/modules/dinero/preflight.ts`) YA leen esta columna:
--
--   .from('courier_config_payout')
--   .select('porcentaje_retencion, metodo_default, minimo_retiro_clp')
--
-- pero la columna NUNCA se creó en identidad.courier_config_payout. La tabla se
-- creó en 20260613000011 con `metodo_default` y `porcentaje_retencion`; una
-- columna homónima existe solo en identidad.tarifas (20260613000010, propósito
-- distinto: mínimo por línea de tarifa, no config de payout).
--
-- Consecuencia en un Postgres/PostgREST real: ese SELECT sobre una columna
-- inexistente devuelve 42703 (undefined_column); el código hace
-- `if (errConfig) throw ...` → TODO intento de pagar a un conductor
-- (emitirPagoLiquidacion → jobEjecutarPayout) fallaba siempre, en cualquier
-- tenant. Los tests unitarios no lo detectaban porque mockean la config en
-- memoria sin tocar el schema real.
--
-- Arreglo: columna aditiva, nullable, MISMO patrón que identidad.tarifas
-- .minimo_retiro_clp (mismo tipo numeric(12,0), mismo check `is null or >= 0`).
-- NULL por defecto = "sin mínimo configurado": comportamiento idéntico al de hoy
-- — el código ya trata NULL/ausente como 0 (`typeof … === 'number' ? … : 0`),
-- así que NO rompe ningún courier existente ni fuerza un mínimo no pactado.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE VIEW.
-- RLS: la columna hereda las políticas solo-interno de courier_config_payout ya
-- definidas en 0011 (P1 + claim_tipo_usuario()='interno', trigger
-- solo_interno_edita). Sin cambios de política.
-- Confidencialidad: courier_config_payout es solo-interno — sellers y conductores
-- no ven NINGUNA fila (RLS SELECT exige 'interno'). El GRANT de authenticated es
-- de TABLA COMPLETA (sin lista de columnas), así que la columna nueva se hereda
-- automáticamente y no reintroduce el patrón de fuga por Accept-Profile del
-- hallazgo snapshot_regla (20260707000002); ahí el problema era una columna que
-- NO debía verse — aquí minimo_retiro_clp es config interna que los internos SÍ
-- gestionan. Nada que restringir a nivel de columna.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columna aditiva (mismo patrón que identidad.tarifas.minimo_retiro_clp)
-- -----------------------------------------------------------------------------
alter table identidad.courier_config_payout
  add column if not exists minimo_retiro_clp numeric(12,0)
    constraint courier_config_payout_minimo_retiro_no_negativo
      check (minimo_retiro_clp is null or minimo_retiro_clp >= 0);

comment on column identidad.courier_config_payout.minimo_retiro_clp is
  'Monto líquido mínimo (CLP) para ejecutar un payout a conductor. NULL = sin
   mínimo configurado (el job y el preflight lo tratan como 0 — sin bloqueo).
   Dato interno del courier: solo internos lo ven (RLS solo-interno heredada de
   0011); sellers y conductores no acceden a courier_config_payout jamás.';

-- -----------------------------------------------------------------------------
-- 2. Recrear la vista pública para propagar la nueva columna.
--    La vista courier_config_payout usa SELECT * → debe recrearse al agregar
--    columnas (mismo patrón que 20260621000013).
-- -----------------------------------------------------------------------------
create or replace view public.courier_config_payout
  with (security_invoker = true)
  as select * from identidad.courier_config_payout;

-- CREATE OR REPLACE VIEW conserva privilegios; los re-emitimos por idempotencia.
-- Grants de TABLA COMPLETA (sin lista de columnas): la nueva columna se hereda.
grant select, insert, update on public.courier_config_payout to authenticated;
grant select, insert, update, delete on public.courier_config_payout to service_role;
