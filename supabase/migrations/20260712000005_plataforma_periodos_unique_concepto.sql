-- =============================================================================
-- 20260712000005 · Plataforma — relajar el UNIQUE de periodos_suscripcion para
--                   incluir `concepto` (fix de dinero B-1, Ola 2 F2)
-- =============================================================================
-- Fix de CORRECTITUD. Hallazgo B-1 de seguridad/QA sobre la proración de
-- suscripción (backstage Rutax → courier).
--
-- PROBLEMA (B-1): la migración base 20260621000015 creó
--   constraint periodos_suscripcion_suscripcion_periodo_uk
--     unique (suscripcion_id, periodo_inicio)
-- pensada como idempotencia del cron mensual `generarPeriodos` (un período por
-- ciclo). Pero la Ola 2 (20260712000004) agregó `concepto` con dos valores:
-- 'periodo' (cobro regular del cron) y 'ajuste_proracion' (cargo puntual por un
-- upgrade inmediato a mitad de ciclo, generado por `cambiarPlanCourier` en
-- src/modules/plataforma/superficie-courier.ts). Ese ajuste se inserta con
-- `periodo_inicio = hoy`. Cuando "hoy" coincide con el `periodo_inicio` del
-- período REGULAR del mismo día (p. ej. un upgrade el día 1 del mes, después de
-- que el cron ya generó el período mensual con periodo_inicio = día 1), el
-- INSERT del ajuste choca con el UNIQUE viejo (mismo suscripcion_id +
-- periodo_inicio, aunque distinto concepto) → 23505. El backend interpreta ese
-- 23505 como "período ya existente", recupera la fila del período REGULAR y NO
-- cobra la proración: el cargo se descarta EN SILENCIO. Ese es el hallazgo B-1.
--
-- FIX: cambiar la llave a (suscripcion_id, periodo_inicio, concepto). Así:
--   - Un 'ajuste_proracion' PUEDE convivir con el 'periodo' regular del mismo
--     `periodo_inicio` (distinto `concepto`) — la proración deja de perderse.
--   - Se SIGUE evitando duplicar el período regular: el cron `generarPeriodos`
--     inserta SIEMPRE `concepto='periodo'` (default de la columna), así que un
--     segundo intento del mismo ciclo choca en (…, 'periodo') → 23505, que el
--     job captura como "omitido" (idempotencia intacta — ver
--     src/modules/plataforma/jobs/generar-periodos.ts, `.insert(...).select()
--     .maybeSingle()` + guard 23505).
--   - Se SIGUE evitando duplicar un ajuste del mismo día: un doble submit del
--     mismo upgrade choca en (…, hoy, 'ajuste_proracion') → 23505, que
--     `cambiarPlanCourier` recupera en vez de duplicar el cargo.
--
-- DATOS EXISTENTES: el nuevo UNIQUE es estrictamente MÁS LAXO que el viejo
-- (agrega una columna a la llave, nunca la quita). Toda fila que satisfacía
-- (suscripcion_id, periodo_inicio) satisface también (suscripcion_id,
-- periodo_inicio, concepto) — es imposible que datos existentes lo violen. El
-- estado/seed actual solo tiene `concepto='periodo'` (el seed no inserta
-- periodos_suscripcion), así que no hay choques al aplicar.
--
-- AISLAMIENTO — SIN CAMBIOS (crítico, prioridad #1): NO se tocan políticas RLS,
-- grants ni vistas. El schema `plataforma` sigue deny-all para authenticated/anon
-- (RLS enable+force sin políticas + grants revocados, migración 0015). Solo se
-- reemplaza un constraint UNIQUE. Se reafirma el revoke como defensa en
-- profundidad (idempotente, no aporta acceso nuevo).
--
-- IDEMPOTENTE: DROP CONSTRAINT IF EXISTS del nombre VIEJO y del nombre NUEVO,
-- luego ADD CONSTRAINT del nuevo. En un re-apply, el drop del nuevo lo elimina y
-- el add lo recrea (estado final idéntico). Mismo molde que 20260710000002
-- (drop+add de un CHECK con nombre fijo). Re-aplicable sobre una base ya migrada.
-- =============================================================================

-- 1. Quitar el UNIQUE viejo (nombre de la migración base 0015).
alter table plataforma.periodos_suscripcion
  drop constraint if exists periodos_suscripcion_suscripcion_periodo_uk;

-- 2. Quitar el UNIQUE nuevo si ya existiera (idempotencia en re-apply).
alter table plataforma.periodos_suscripcion
  drop constraint if exists periodos_suscripcion_susc_periodo_concepto_uk;

-- 3. Crear el UNIQUE nuevo, ahora incluyendo `concepto`.
alter table plataforma.periodos_suscripcion
  add constraint periodos_suscripcion_susc_periodo_concepto_uk
  unique (suscripcion_id, periodo_inicio, concepto);

comment on constraint periodos_suscripcion_susc_periodo_concepto_uk
  on plataforma.periodos_suscripcion is
  'Idempotencia del cron mensual y del ajuste de proración. Reemplaza el UNIQUE '
  '(suscripcion_id, periodo_inicio) de la migración base 0015, que descartaba en '
  'silencio la proración (hallazgo B-1): un ajuste_proracion con periodo_inicio=hoy '
  'chocaba con el período regular del mismo día. Con concepto en la llave, un '
  'ajuste_proracion convive con el periodo regular del mismo periodo_inicio, pero se '
  'sigue impidiendo duplicar el período regular (cron inserta concepto=periodo) y '
  'duplicar un ajuste del mismo día.';

-- 4. Reafirmación del deny-all (defensa en profundidad, idempotente). No otorga
--    nada nuevo a service_role (sus grants de tabla de la 0015 ya cubren todo);
--    solo blinda que authenticated/anon no tengan acceso heredado.
revoke all on plataforma.periodos_suscripcion from authenticated, anon;
