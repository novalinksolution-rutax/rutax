-- =============================================================================
-- 20260712000004 · Plataforma — concepto del período de suscripción
--                   (distingue período regular de ajuste de proración)
-- =============================================================================
-- Migración ADITIVA e IDEMPOTENTE. "Ola 2" (facturación profunda, F2) del
-- backstage de plataforma (Rutax → courier). Agrega
-- plataforma.periodos_suscripcion.concepto para DISTINGUIR el período de cobro
-- regular ('periodo') del período de AJUSTE de proración generado por un upgrade
-- de plan inmediato a mitad de ciclo ('ajuste_proracion').
--
-- POR QUÉ (dos consumidores):
--   (a) Cálculo de MRR/ARR (item L): el ingreso recurrente NO debe contar los
--       ajustes de proración — son cargos puntuales, de una sola vez, por el
--       cambio de plan a mitad de ciclo, no un ingreso mensual/anual recurrente.
--       Al marcarlos con concepto='ajuste_proracion', el cálculo de MRR/ARR los
--       EXCLUYE y no infla la métrica.
--   (b) UI de cobros: el super-admin ve el ajuste de proración presentado
--       DISTINTO del período regular (etiqueta/estilo), no como un cobro más.
--   Default 'periodo': todo período existente y todo período que genera el cron
--   mensual es regular, salvo que el backend lo marque explícitamente como ajuste.
--
-- AISLAMIENTO — SIN CAMBIOS (crítico, prioridad #1):
--   NO se crea ninguna política RLS para `authenticated`/`anon`, ni grants a esos
--   roles, ni vistas en `public`. La columna nueva queda cubierta por el MISMO
--   deny-all de la tabla base (RLS enable+force SIN políticas + grants revocados a
--   authenticated/anon, migración base 0015 20260621000015). En Postgres, un GRANT
--   de TABLA (no de columna) alcanza automáticamente las columnas futuras, así que
--   los `grant select,insert,update,delete ... to service_role` de la 0015 YA
--   cubren esta columna. Un courier autenticado sigue sin poder leer NADA de este
--   schema — en particular, no descubre sus períodos ni sus ajustes de proración
--   (verificado en rls_aislamiento_plataforma.test.sql, que afirma 42501 sobre la
--   columna concepto para el interno y para el seller). Se reafirma el revoke a
--   authenticated/anon como defensa en profundidad (idempotente).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS. Re-aplicable sobre una base ya migrada.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columna ADITIVA en plataforma.periodos_suscripcion
-- -----------------------------------------------------------------------------
alter table plataforma.periodos_suscripcion
  add column if not exists concepto text not null default 'periodo'
    check (concepto in ('periodo','ajuste_proracion'));

comment on column plataforma.periodos_suscripcion.concepto is
  'Concepto del período: periodo|ajuste_proracion (Ola 2 F2). "periodo" = cobro '
  'regular (mensual/anual) generado por el cron; "ajuste_proracion" = cargo puntual, '
  'de una sola vez, por un upgrade de plan inmediato a mitad de ciclo. El cálculo de '
  'MRR/ARR (item L) EXCLUYE los ajuste_proracion (no son ingreso recurrente) y la UI '
  'de cobros los muestra distinto. Default "periodo". No cambia el deny-all: sin '
  'políticas para authenticated — el courier no descubre sus períodos mirando la DB.';

-- -----------------------------------------------------------------------------
-- 2. Reafirmación del deny-all (defensa en profundidad, idempotente)
-- -----------------------------------------------------------------------------
-- Los grants a service_role de la migración 0015 (a nivel de TABLA) ya alcanzan la
-- columna nueva; NO se otorga nada nuevo a service_role aquí. Se reafirma el revoke
-- a authenticated/anon: no aporta acceso nuevo, solo blinda que la columna nueva NO
-- se filtre si algún grant heredado apareciera.
revoke all on plataforma.periodos_suscripcion from authenticated, anon;
