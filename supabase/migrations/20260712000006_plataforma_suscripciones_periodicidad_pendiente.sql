-- =============================================================================
-- 20260712000006 · Plataforma — periodicidad_pendiente para diferir el cambio de
--                   periodicidad al próximo ciclo (fix de dinero ALTO, Ola 2 F2)
-- =============================================================================
-- Migración ADITIVA e IDEMPOTENTE. Fix de CORRECTITUD del cambio de plan con
-- proración (`cambiarPlanCourier`, src/modules/plataforma/superficie-courier.ts).
--
-- PROBLEMA (bug ALTO de QA — comparación de precios cruzando unidades): hoy, al
-- cambiar el plan Y la periodicidad en la misma acción, la proración compara el
-- precio ACTUAL (en la unidad vieja, p. ej. mensual ~$49.000) contra el precio
-- NUEVO (en la unidad nueva, p. ej. anual ~$990.000). Ese delta gigante se trata
-- como "upgrade" y se prorratea un monto ANUAL sobre un ciclo MENSUAL — un cargo
-- sin sentido. Cruzar mensual↔anual en una sola resta de precios es el bug.
--
-- FIX (modelo): un cambio de PERIODICIDAD NO se prorratea; se DIFIERE al próximo
-- ciclo, igual que un downgrade de plan. Esta columna guarda la periodicidad
-- DESTINO mientras el cambio está pendiente, junto al mecanismo diferido que ya
-- existe (`plan_anterior_id` = plan destino pendiente, `cambio_efectivo_desde` =
-- fecha efectiva). El job `plataforma/aplicarCambiosPlan`
-- (src/modules/plataforma/jobs/aplicar-cambios-plan.ts), cuando
-- `cambio_efectivo_desde <= hoy`, aplica `periodicidad = periodicidad_pendiente`
-- en el MISMO UPDATE que hace el swap de plan (`plan_id = plan_anterior_id`) y
-- limpia los tres campos pendientes a NULL. Al diferir, cada ciclo se cobra
-- SIEMPRE en una sola unidad (la vigente hasta el corte, la nueva después): nunca
-- se restan precios de unidades distintas. Default NULL = sin cambio de
-- periodicidad pendiente (el caso normal).
--
-- AISLAMIENTO — SIN CAMBIOS (crítico, prioridad #1): NO se crea ninguna política
-- RLS para authenticated/anon, ni grants a esos roles, ni vistas en `public`. La
-- columna nueva queda cubierta por el MISMO deny-all de la tabla base (RLS
-- enable+force SIN políticas + grants revocados a authenticated/anon, migración
-- 0015 20260621000015). En Postgres, un GRANT de TABLA (no de columna) alcanza
-- automáticamente las columnas futuras, así que los `grant ... to service_role`
-- de la 0015 YA cubren esta columna. Un courier autenticado sigue sin poder leer
-- NADA de este schema — en particular, no descubre su cambio de periodicidad
-- pendiente mirando la DB (verificado en rls_aislamiento_plataforma.test.sql, que
-- afirma 42501 sobre esta columna para el interno y para el seller). Se reafirma
-- el revoke a authenticated/anon como defensa en profundidad (idempotente).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS. Re-aplicable sobre una base ya migrada.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columna ADITIVA en plataforma.suscripciones
-- -----------------------------------------------------------------------------
alter table plataforma.suscripciones
  add column if not exists periodicidad_pendiente text
    check (periodicidad_pendiente in ('mensual','anual'));

comment on column plataforma.suscripciones.periodicidad_pendiente is
  'Periodicidad DESTINO de un cambio de periodicidad DIFERIDO al próximo ciclo '
  '(fix de dinero ALTO, Ola 2 F2). NULL = sin cambio pendiente (caso normal). Se '
  'usa junto a plan_anterior_id/cambio_efectivo_desde: el job aplicar-cambios-plan '
  'aplica periodicidad = periodicidad_pendiente en cambio_efectivo_desde, en el '
  'mismo UPDATE que el swap de plan, y limpia los pendientes a NULL. Un cambio de '
  'periodicidad NO se prorratea (se difiere) — evita comparar precios cruzando '
  'unidades (mensual vs anual), que producía un cargo de proración sin sentido. No '
  'cambia el deny-all: sin políticas para authenticated.';

-- -----------------------------------------------------------------------------
-- 2. Reafirmación del deny-all (defensa en profundidad, idempotente)
-- -----------------------------------------------------------------------------
-- Los grants a service_role de la migración 0015 (a nivel de TABLA) ya alcanzan
-- la columna nueva; NO se otorga nada nuevo a service_role aquí. Se reafirma el
-- revoke a authenticated/anon: no aporta acceso nuevo, solo blinda que la columna
-- nueva NO se filtre si algún grant heredado apareciera.
revoke all on plataforma.suscripciones from authenticated, anon;
