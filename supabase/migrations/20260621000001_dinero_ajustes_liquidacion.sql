-- =============================================================================
-- Migración · Dinero — F16 Ajustes manuales de liquidación (bono/penalización)
-- =============================================================================
-- Agrega tres columnas a dinero.liquidaciones para soportar ajustes manuales
-- (bonos por on-time y penalizaciones por fallo evitable) que el dueño ingresa
-- antes de emitir la liquidación al conductor.
--
-- Invariantes:
--   - bono_clp >= 0 (nunca negativo; el signo viene del concepto "bono")
--   - penalizacion_clp >= 0 (ídem; el descuento lo calcula el frontend)
--   - monto_total_clp sigue siendo la suma de lineas_liquidacion (job C4).
--     El monto final a pagar = monto_total_clp + bono_clp - penalizacion_clp
--     se calcula en presentación; no se persiste como columna derivada para
--     evitar que el job la sobreescriba sin querer.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- =============================================================================

alter table dinero.liquidaciones
  add column if not exists bono_clp integer not null default 0
    constraint liquidaciones_bono_no_negativo check (bono_clp >= 0);

alter table dinero.liquidaciones
  add column if not exists penalizacion_clp integer not null default 0
    constraint liquidaciones_penalizacion_no_negativa check (penalizacion_clp >= 0);

alter table dinero.liquidaciones
  add column if not exists nota_ajuste text;

comment on column dinero.liquidaciones.bono_clp is
  'Bono manual ingresado por el dueño antes de emitir (ej. bono on-time). CLP entero ≥ 0.';

comment on column dinero.liquidaciones.penalizacion_clp is
  'Penalización manual ingresada por el dueño antes de emitir (ej. fallo evitable). CLP entero ≥ 0.';

comment on column dinero.liquidaciones.nota_ajuste is
  'Contexto del ajuste (por qué se aplicó el bono o la penalización). Libre, nullable.';
