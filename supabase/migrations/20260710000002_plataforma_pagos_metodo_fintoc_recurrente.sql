-- =============================================================================
-- 20260710000002 · Plataforma — CHECK de pagos_plataforma.metodo += 'fintoc_recurrente'
-- =============================================================================
-- Fix de CORRECTITUD. El auto-cobro recurrente (F1-E, job `cobrar-periodo-auto.ts`
-- / `cobro.ts`) inserta pagos con `metodo = 'fintoc_recurrente'` en
-- plataforma.pagos_plataforma, pero el CHECK de esa columna (migración base
-- 20260621000015) solo admitía ('fintoc_link','transferencia_manual','cortesia').
-- Resultado: cualquier auto-cobro REAL fallaba en BD con 23514 (los tests no lo
-- pillaban porque mockean el cliente Supabase). Esta migración amplía el CHECK.
--
-- Postgres NO permite modificar un CHECK en sitio: se elimina y se recrea. El
-- CHECK de la migración base era inline sin nombre explícito → Postgres lo nombró
-- de forma determinista `pagos_plataforma_metodo_check` (mismo patrón que los
-- CHECK inline de plataforma.suscripciones: `suscripciones_periodicidad_check`,
-- etc.). El DROP va con IF EXISTS para idempotencia; el nuevo CHECK es un
-- SUPERCONJUNTO del anterior, así que ninguna fila existente lo viola.
--
-- AISLAMIENTO — SIN CAMBIOS: NO se tocan políticas RLS, grants ni vistas. El
-- schema `plataforma` sigue deny-all para authenticated/anon (RLS enable+force
-- sin políticas + grants revocados, migración 0015). Solo se ajusta un CHECK.
--
-- Idempotente: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT con nombre fijo. En un
-- re-apply, el DROP elimina el CHECK y el ADD lo vuelve a crear (estado final
-- idéntico). Re-aplicable sobre una base ya migrada.
-- =============================================================================

alter table plataforma.pagos_plataforma
  drop constraint if exists pagos_plataforma_metodo_check;

alter table plataforma.pagos_plataforma
  add constraint pagos_plataforma_metodo_check
  check (metodo in ('fintoc_link','fintoc_recurrente','transferencia_manual','cortesia'));

comment on constraint pagos_plataforma_metodo_check on plataforma.pagos_plataforma is
  'Métodos de pago admitidos para un pago de plataforma: fintoc_link (link manual '
  'del super-admin), fintoc_recurrente (auto-cobro por mandato, F1-E), '
  'transferencia_manual, cortesia. Ampliado en 20260710000002 para incluir '
  'fintoc_recurrente (el CHECK base 20260621000015 lo omitía y rompía el auto-cobro).';
