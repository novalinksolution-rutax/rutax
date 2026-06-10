-- =============================================================================
-- 0007 · Compuerta de emisión real de DTE (opt-in por courier) — B1-1
-- =============================================================================
-- Defensa en profundidad sobre la compuerta de aprobación de facturación.
--
-- La emisión de un DTE es irreversible ante el SII sin nota de crédito
-- (RF-038, fuera del MVP). Además de exigir una acción humana con capacidad
-- `emitir_facturas` (ver `dinero.acciones.emitirFacturaPeriodo`), la emisión
-- REAL (no sandbox) requiere que el courier la habilite EXPLÍCITAMENTE.
--
-- Por defecto `false`: ningún courier emite DTE real hasta optar por ello,
-- aunque el entorno tenga `DTE_SANDBOX_MODE=false`. En sandbox (stub) el flag
-- es irrelevante y la emisión de prueba fluye sin tocar el SII.
--
-- Migración ADITIVA e IDEMPOTENTE: solo agrega una columna con default seguro;
-- no cambia políticas RLS (la tabla ya está aislada por tenant).
-- =============================================================================

alter table identidad.courier_config_dte
  add column if not exists emision_dte_real_habilitada boolean not null default false;

comment on column identidad.courier_config_dte.emision_dte_real_habilitada is
  'Opt-in explícito del courier para emitir DTE REAL al SII (no sandbox). '
  'Default false: la emisión real exige habilitación deliberada, además de la '
  'capacidad emitir_facturas y la acción humana emitirFacturaPeriodo (B1-1).';
