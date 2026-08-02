-- =============================================================================
-- 20260712000001 · Plataforma — overrides de entitlements por courier
--                   (caracteristicas_override en plataforma.suscripciones)
-- =============================================================================
-- Migración ADITIVA e IDEMPOTENTE. "Ola 1" (monetización base) del backstage de
-- plataforma (F2), gap 6. Agrega la capacidad de habilitar/forzar features por
-- courier SIN cambiar de plan — p. ej. subirle temporalmente el tope de
-- conductores a un cliente puntual, o activarle `api_publica` en un piloto,
-- dejando su plan intacto. El override es por SUSCRIPCIÓN (1:1 con el courier),
-- no toca el catálogo global `plataforma.planes`.
--
-- CONTRATO DE MERGE (lo implementa el backend, NO la BD):
--   Las features efectivas de un courier = plataforma.planes.caracteristicas del
--   plan suscrito, MERGEADAS con plataforma.suscripciones.caracteristicas_override,
--   donde el OVERRIDE TIENE PRECEDENCIA (gana la llave del override si existe).
--   Ejemplo: plan Starter = {"api_publica": false, "conductores_max": 5};
--   override = {"api_publica": true, "conductores_max": 10} ⇒ efectivo =
--   {"api_publica": true, "conductores_max": 10}. Una llave ausente en el override
--   NO pisa la del plan. Default '{}' ⇒ sin override, el courier ve exactamente su
--   plan. La BD solo PERSISTE el override; el merge es responsabilidad del backend.
--
-- AISLAMIENTO — SIN CAMBIOS (crítico, prioridad #1):
--   NO se crea ninguna política RLS para `authenticated`/`anon`, ni grants a esos
--   roles, ni vistas en `public`. La columna nueva queda cubierta por el MISMO
--   deny-all de la tabla base (RLS enable+force SIN políticas + grants revocados a
--   authenticated/anon, migración base 0015 20260621000015). En Postgres, un GRANT
--   de TABLA (no de columna) alcanza automáticamente las columnas futuras, así que
--   los `grant select,insert,update,delete ... to service_role` de la 0015 YA
--   cubren esta columna. Un courier autenticado sigue sin poder leer NADA de este
--   schema — en particular, no descubre qué features le habilitamos (verificado en
--   rls_aislamiento_plataforma.test.sql, que afirma 42501 sobre caracteristicas_override).
--   Se reafirma el revoke a authenticated/anon como defensa en profundidad (idempotente).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS. Re-aplicable sobre una base ya migrada.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columna ADITIVA en plataforma.suscripciones
-- -----------------------------------------------------------------------------
alter table plataforma.suscripciones
  add column if not exists caracteristicas_override jsonb not null default '{}'::jsonb;

comment on column plataforma.suscripciones.caracteristicas_override is
  'Overrides de entitlements POR COURIER, sin cambiar de plan (gap 6, Ola 1 F2). '
  'jsonb de features forzadas, p. ej. {"api_publica": true, "conductores_max": 10}. '
  'El backend calcula las features efectivas mergeando plataforma.planes.caracteristicas '
  'del plan suscrito con este override, y el OVERRIDE TIENE PRECEDENCIA (gana la llave '
  'del override). Default {} = sin override (el courier ve exactamente su plan). '
  'No cambia el deny-all: sin políticas para authenticated — el courier no descubre '
  'qué features le habilitamos mirando la DB.';

-- -----------------------------------------------------------------------------
-- 2. Reafirmación del deny-all (defensa en profundidad, idempotente)
-- -----------------------------------------------------------------------------
-- Los grants a service_role de la migración 0015 (a nivel de TABLA) ya alcanzan la
-- columna nueva; NO se otorga nada nuevo a service_role aquí. Se reafirma el revoke
-- a authenticated/anon: no aporta acceso nuevo, solo blinda que la columna nueva NO
-- se filtre si algún grant heredado apareciera.
revoke all on plataforma.suscripciones from authenticated, anon;
