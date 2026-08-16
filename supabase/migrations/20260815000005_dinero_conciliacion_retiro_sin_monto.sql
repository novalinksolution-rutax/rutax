-- =============================================================================
-- Etapa 8 · La excepción que impide pagar $0 por una visita
--
-- QUÉ AGREGA
--   1. `dinero.eventos_conciliacion.sesion_retiro_id` — la visita a la que
--      apunta el hallazgo. Sin ella, una excepción de retiro solo podría
--      referenciar al conductor, y dos visitas del mismo conductor el mismo día
--      serían indistinguibles (tanto para el humano como para la idempotencia).
--   2. El tipo `retiro_sin_monto_configurado` en el CHECK de `tipo_diferencia`.
--
-- POR QUÉ EXISTE ESTE TIPO
-- El job C8 (`dinero/jobs/generar-linea-retiro.ts`) se niega a escribir una
-- línea de $0 cuando el courier no configuró cuánto vale una visita. En vez de
-- eso levanta esta excepción con `bloquea_pago = true`. Es la lección del
-- 2026-08-15 convertida en mecanismo: ese día se descubrió que
-- `identidad.tarifas.monto_conductor_clp` había nacido con `default 0`, que
-- ningún formulario la escribía, y que TODA liquidación de producción se generó
-- en $0 durante meses sin que nada fallara. Un cero silencioso es peor que un
-- error ruidoso.
--
-- =============================================================================
-- ⚠️ EL CHECK SE REPONE ENTERO, Y ESTA LISTA SE COPIÓ DE LA BASE
-- =============================================================================
-- `tipo_diferencia` es `text` + CHECK con lista de valores, así que cada
-- migración que agrega uno tiene que reponer la lista COMPLETA. Ahí está la
-- trampa que ya mordió: el 2026-08-12 la migración 20260812000001 copió la
-- lista desde una versión anterior y BORRÓ `linea_liquidacion_sin_pedido_
-- entregado` sin que nada fallara al migrar. Quedaron 16 valores antes y 16
-- después — distinta lista. Falló en EJECUCIÓN, dentro de un `step.run`,
-- tumbando el job de dinero justo cuando debía impedir pagarle a un conductor
-- una entrega cancelada.
--
-- Los 17 valores de abajo se leyeron de la base local con
-- `pg_get_constraintdef` el 2026-08-15, NO de otra migración. El 18 es el nuevo.
-- La red en TypeScript es `src/modules/dinero/conciliacion-tipos-sql.test.ts`,
-- que compara esta lista contra la del código y usa `set_eq`, nunca un conteo.
--
-- ⚠️ Las MITADES DERIVADAS se actualizan en el mismo commit, porque un tipo que
-- existe en el CHECK y no en el mapa de clasificación entra a la bandeja sin
-- categoría ni acción sugerida:
--   · src/modules/dinero/conciliacion-clasificacion.ts (categoría + acción)
--   · src/modules/dinero/tipos.ts (el tipo TS)
--   · src/lib/ui/traduccion-estados.ts (el texto que ve el humano)
--
-- IDEMPOTENTE: `add column if not exists`, `drop constraint if exists` + add.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La visita a la que apunta el hallazgo
-- -----------------------------------------------------------------------------
alter table dinero.eventos_conciliacion
  add column if not exists sesion_retiro_id uuid
    references operacion.sesiones_retiro (id) on delete restrict;

comment on column dinero.eventos_conciliacion.sesion_retiro_id is
  'La visita a bodega a la que apunta el hallazgo. NULL en todos los tipos que '
  'no son de retiro. FK simple y no compuesta a propósito: acá no hay plata '
  'colgando de la fila (es un hallazgo, no una línea), así que no hace falta '
  'que la base imponga el conductor — eso lo impone la línea de liquidación.';

create index if not exists idx_eventos_conciliacion_sesion_retiro
  on dinero.eventos_conciliacion (tenant_id, sesion_retiro_id)
  where sesion_retiro_id is not null;

-- -----------------------------------------------------------------------------
-- 2. El CHECK de tipo_diferencia — LISTA COMPLETA, leída de la base
-- -----------------------------------------------------------------------------
alter table dinero.eventos_conciliacion
  drop constraint if exists eventos_conciliacion_tipo_valido;

alter table dinero.eventos_conciliacion
  add constraint eventos_conciliacion_tipo_valido check (
    tipo_diferencia in (
      -- ── Los 17 que ya existían (leídos de pg_get_constraintdef) ──────────
      'pedido_entregado_sin_linea_cobro',
      'pedido_entregado_sin_linea_liquidacion',
      'linea_cobro_sin_pedido_entregado',
      'folio_consumido_sin_dte_persistido',
      'periodo_cerrado_con_lineas_sueltas',
      'monto_dte_difiere_de_lineas',
      'pagado_conductor_sin_cobro_seller',
      'cobrado_seller_no_pagado_conductor',
      'reprogramacion_no_cobrada',
      'minimo_omitido',
      'pago_seller_faltante',
      'pago_conductor_faltante',
      'payout_revertido_post_confirmacion',
      'payout_estado_no_reconocido',
      'linea_cobro_sin_periodo',
      'linea_liquidacion_sin_pedido_entregado',
      'liquidacion_atribuida_a_conductor_incorrecto',
      -- ── Nuevo en la etapa 8 ───────────────────────────────────────────────
      'retiro_sin_monto_configurado'
    )
  );

comment on constraint eventos_conciliacion_tipo_valido on dinero.eventos_conciliacion is
  'Lista COMPLETA de tipos de diferencia (18). Toda migración que agregue uno '
  'DEBE reponer la lista entera leyéndola de la base (pg_get_constraintdef), '
  'nunca de otra migración: copiar una versión vieja borra valores sin que nada '
  'falle al migrar, y el fallo aparece después en ejecución dentro de un job de '
  'dinero. Ya pasó el 2026-08-12.';

-- -----------------------------------------------------------------------------
-- 3. El ENUM VESTIGIAL — la mitad derivada que ya se rompió una vez
-- -----------------------------------------------------------------------------
-- El tipo `dinero.tipo_diferencia_conciliacion` se creó en 20260601000006:130-137
-- y NINGUNA columna lo usa: la tabla guarda `tipo_diferencia` como `text` con
-- CHECK. Es un vestigio.
--
-- Pero NO se puede ignorar, y no por prolijidad: la prueba
-- `dinero_conciliacion_tipos_check.test.sql` afirma con `set_eq` que el enum y
-- el CHECK admiten EXACTAMENTE el mismo conjunto. Esa prueba existe porque el
-- 2026-08-12 el CHECK perdió un valor en silencio y el enum quedó roto EN
-- ESPEJO; es la red que atrapa justo esta clase de deriva. Al agregar el tipo
-- solo al CHECK, la prueba falló — hizo su trabajo, y por eso está esta parte.
--
-- `add value if not exists` es idempotente. En PostgreSQL 12+ se puede ejecutar
-- dentro de una transacción mientras el valor nuevo no se USE en la misma
-- transacción, que es el caso: acá solo se declara.
alter type dinero.tipo_diferencia_conciliacion
  add value if not exists 'retiro_sin_monto_configurado';
