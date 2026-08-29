-- =============================================================================
-- Rutax cobra por pedido efectivo, no por cuota fija
-- =============================================================================
--
-- QUÉ CAMBIA
-- -----------------------------------------------------------------------------
-- Hasta hoy `plataforma.planes` eran tres cuotas planas (Starter $49.000, Growth
-- $99.000, Enterprise $199.000) con tope de pedidos al mes. La modalidad nueva
-- —y única, por decisión del usuario— es una comisión: **una tarifa por cada
-- pedido que Rutax entregó**, con un mínimo mensual.
--
--   monto del mes = mayor(mínimo_mensual, entregas × tarifa_por_pedido)
--
-- El primer mes de un courier va SIN mínimo (decisión del usuario): solo
-- comisión, para no cobrarle un piso completo por los días que alcanzó a operar.
--
-- -----------------------------------------------------------------------------
-- 🔴 SE COBRA VENCIDO, Y ESO REORDENA EL CRON
-- -----------------------------------------------------------------------------
-- Una cuota fija se puede cobrar por adelantado: el día 1 ya se sabe cuánto. Una
-- comisión NO — el 1 de agosto nadie sabe cuántas entregas tendrá agosto. Así que
-- el cron del día 1 pasa a generar el período del mes que **acaba de cerrar**.
--
-- Consecuencia asumida: la primera boleta de un courier nuevo llega un mes más
-- tarde que con un plan plano.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ SE GUARDAN LAS ENTREGAS Y LA TARIFA EN EL PERÍODO
-- -----------------------------------------------------------------------------
-- `monto_clp` solo dice cuánto. Sin `pedidos_efectivos` y `tarifa_aplicada_clp`,
-- la pregunta «¿por qué me cobraste esto?» solo se puede responder recalculando
-- — y recalcular meses después da OTRO número, porque un pedido pudo cambiar de
-- estado desde entonces. Se guardan al cerrar, como el snapshot de regla que ya
-- hace el motor entrega→dinero con sus líneas.
--
-- Ambas NULLABLE: los períodos de cuota plana que ya existen no las tienen, y
-- rellenarlas con 0 diría que ese mes no hubo entregas, que es falso.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. plataforma.planes — la tarifa y el mínimo
-- -----------------------------------------------------------------------------
alter table plataforma.planes
  add column if not exists precio_por_pedido_clp int,
  add column if not exists minimo_mensual_clp    int;

comment on column plataforma.planes.precio_por_pedido_clp is
  'CLP que Rutax le cobra al courier por cada pedido efectivo (entregado y con '
  'asignación en Rutax). NULL en los planes de cuota plana, que quedan '
  'desactivados. Es el eje del cobro desde 2026-08-28.';

comment on column plataforma.planes.minimo_mensual_clp is
  'Piso mensual: el courier paga el mayor entre esto y entregas × tarifa. NULL '
  'o 0 = sin piso. NO se aplica en el primer mes del courier (decisión del '
  'usuario): ese mes es solo comisión.';

alter table plataforma.planes
  drop constraint if exists planes_comision_coherente;
alter table plataforma.planes
  add constraint planes_comision_coherente check (
    -- Un plan de comisión necesita su tarifa; un plan plano no la tiene. Lo que
    -- no puede existir es una tarifa negativa o un mínimo negativo.
    (precio_por_pedido_clp is null or precio_por_pedido_clp >= 0)
    and (minimo_mensual_clp is null or minimo_mensual_clp >= 0)
  );

-- -----------------------------------------------------------------------------
-- 2. Los tres planes planos se DESACTIVAN, no se borran
-- -----------------------------------------------------------------------------
-- Decisión del usuario. Borrarlos dejaría huérfana la suscripción que el courier
-- de producción tiene hoy y la bitácora sin a qué referirse: `suscripciones.
-- plan_id` y `plan_anterior_id` apuntan acá. `activo = false` los saca de la
-- oferta y de los conteos sin romper una sola referencia.
update plataforma.planes
   set activo = false
 where precio_por_pedido_clp is null
   and activo;

-- -----------------------------------------------------------------------------
-- 3. periodos_suscripcion — cómo se compuso el monto, y el ajuste por devolución
-- -----------------------------------------------------------------------------
alter table plataforma.periodos_suscripcion
  add column if not exists pedidos_efectivos    int,
  add column if not exists tarifa_aplicada_clp  int;

comment on column plataforma.periodos_suscripcion.pedidos_efectivos is
  'Cuántas entregas se contaron para este período. Se guarda al cerrar: '
  'recalcularlo después da otro número porque los pedidos cambian de estado.';

comment on column plataforma.periodos_suscripcion.tarifa_aplicada_clp is
  'La tarifa por pedido con la que se calculó. Es la VIGENTE AL CERRAR el mes '
  '(decisión del usuario): si Rutax la baja a mitad de mes, el mes entero se '
  'cobra a la nueva — una sola tarifa por boleta, y siempre a favor del courier.';

-- ⚠️ EL CHECK DE `concepto` SE REPONE ENTERO, COPIADO DE LA BASE.
-- Es una lista `text` + CHECK, y la lección del 2026-08-12 con
-- `dinero.eventos_conciliacion.tipo_diferencia` es que copiar la lista desde una
-- migración vieja borra un valor SIN QUE NADA FALLE al migrar: falla meses
-- después, en ejecución, con un 23514 dentro de un job. La lista vigente al
-- escribir esto es ('periodo', 'ajuste_proracion'); se le suma la nueva.
alter table plataforma.periodos_suscripcion
  drop constraint if exists periodos_suscripcion_concepto_check;
alter table plataforma.periodos_suscripcion
  add constraint periodos_suscripcion_concepto_check
    check (concepto in ('periodo', 'ajuste_proracion', 'ajuste_devoluciones'));

comment on column plataforma.periodos_suscripcion.concepto is
  'periodo = el cobro del mes · ajuste_proracion = diferencia por cambio de plan '
  '· ajuste_devoluciones = crédito por entregas ya cobradas que después se '
  'anularon o devolvieron. El período cerrado NUNCA se reabre: la corrección '
  'viaja al mes siguiente, igual que una nota de crédito.';
