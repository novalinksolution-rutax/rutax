-- =============================================================================
-- Dinero · conciliación: tipo `linea_liquidacion_sin_pedido_entregado`
-- =============================================================================
-- CONTEXTO (docs/arquitectura/edicion-y-cancelacion-de-pedidos.md §2.3 H2 y
-- §2.4 D-A2; decisión del fundador N-1, 2026-08-11):
--
-- Cuando un pedido pasa a `cancelado` o `devuelto`, el job C1 (`generar-lineas`)
-- entra en el paso `anular-lineas-si-devolucion` e intenta anular sus líneas. Si
-- el contenedor ya se cerró —período `cerrado`/`facturado`, o liquidación
-- `emitida`/`pagada`— NO puede anularlas y hoy solo escribe un `logger.info`.
-- C6 (`conciliar-periodo`) se dispara con `dinero/periodo.cerrado`: si el período
-- ya está facturado, C6 ya corrió y no vuelve.
--
-- Resultado, y es el punto ciego que esta migración empieza a tapar: una línea de
-- cobro viva dentro de un DTE emitido, o un conductor ya pagado por una entrega
-- que se canceló, sin que nadie se entere.
--
-- El lado COBRO ya tiene tipo propio (`linea_cobro_sin_pedido_entregado`, encaja
-- literal: hay línea de cobro y el pedido no está entregado). El lado
-- LIQUIDACIÓN no lo tenía. La alternativa evaluada era reusar el tipo del cobro
-- con una `descripcion` explícita; se descartó: el bloqueo de la bandeja son DOS
-- booleanos independientes (`bloquea_facturacion` / `bloquea_pago`, migración
-- 20260708000001), y un conductor pagado por una entrega cancelada debe BLOQUEAR
-- EL PAGO, no quedar como texto en una descripción. Un tipo prestado no puede
-- llevar el bloqueo correcto sin bloquear también lo que no toca.
--
-- ALCANCE: SOLO esquema. Esta migración deja el valor DISPONIBLE; la inserción
-- del evento en las dos ramas "no puedo anular" de C1 es de `backend`, en tarea
-- aparte (ver §5, handoff). No toca src/, ni RLS, ni grants, ni columnas.
--
-- Qué NO cambia, y conviene decirlo:
--   · Ninguna política RLS. `dinero.eventos_conciliacion` sigue siendo P1
--     estricta solo-interna (dueno/administracion del mismo tenant); seller y
--     conductor JAMÁS ven una fila, ni con el tipo nuevo. Escritura solo
--     service_role. Lo prueba supabase/tests/database/
--     rls_conciliacion_linea_liquidacion_sin_pedido.test.sql.
--   · Ningún GRANT. No se agregan columnas, así que no aplica el patrón conocido
--     del repo ("un GRANT de tabla completa filtra la columna nueva"): no hay
--     columna nueva que filtrar. Tampoco hace falta re-emitir la vista
--     public.eventos_conciliacion (es `select *`; el conjunto de columnas es el
--     mismo).
--   · Ninguna categoría ni acción sugerida nueva: el caso se cubre con valores
--     que YA existen en sus CHECK (ver §4, verificación defensiva).
--
-- IDEMPOTENTE: `add value if not exists` sobre el enum + DROP/ADD del CHECK
-- dentro de DO-blocks guardados por la existencia del objeto. Re-aplicable sobre
-- una base ya migrada, tantas veces como se quiera. Mismo mecanismo que las
-- migraciones 20260613000010, 20260708000002, 20260709000001 y 20260805000001.
-- =============================================================================

-- =============================================================================
-- 1. El enum dinero.tipo_diferencia_conciliacion
--
--    DATO IMPORTANTE PARA QUIEN VENGA DETRÁS (verificado contra la base local,
--    2026-08-11): la columna `dinero.eventos_conciliacion.tipo_diferencia` es
--    `text` + CHECK (`eventos_conciliacion_tipo_valido`), NO el tipo enum. El
--    enum existe desde 20260601000006 pero está VESTIGIAL: ninguna columna y
--    ninguna función del esquema lo usan. El gate real de escritura es el CHECK
--    de la sección 2 — sin ese reemplazo, el valor nuevo NO se puede insertar,
--    por mucho que esté en el enum.
--
--    Además había DERIVA: el enum tenía 13 etiquetas y el CHECK 15, porque las
--    migraciones 20260709000001 y 20260805000001 ampliaron solo el CHECK (con
--    razón: el enum no gobierna nada). Un tipo que miente es una mina para el
--    primer `::dinero.tipo_diferencia_conciliacion` que alguien escriba en un
--    reporte o en una migración futura — reventaría con "invalid input value for
--    enum" sobre datos perfectamente válidos. Como `add value if not exists` es
--    inerte aquí (nadie lee el tipo), se aprovecha para dejarlo sincronizado:
--    las 2 etiquetas que faltaban + la nueva.
--
--    ALTER TYPE ... ADD VALUE puede correr dentro de bloque transaccional en
--    PG12+ siempre que el valor nuevo no se USE en la misma transacción. Aquí no
--    se usa como literal-enum (el CHECK compara text), así que es seguro.
-- =============================================================================
do $$
begin
  if exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'dinero' and t.typname = 'tipo_diferencia_conciliacion'
  ) then
    -- Puesta al día de la deriva (inerte: el tipo no gobierna ninguna columna).
    alter type dinero.tipo_diferencia_conciliacion
      add value if not exists 'payout_estado_no_reconocido';
    alter type dinero.tipo_diferencia_conciliacion
      add value if not exists 'linea_cobro_sin_periodo';
    -- El valor de esta migración.
    alter type dinero.tipo_diferencia_conciliacion
      add value if not exists 'linea_liquidacion_sin_pedido_entregado';
  end if;
end $$;

comment on type dinero.tipo_diferencia_conciliacion is
  'Tipo VESTIGIAL: ninguna columna ni función lo usa. La columna
   dinero.eventos_conciliacion.tipo_diferencia es text + CHECK
   (eventos_conciliacion_tipo_valido), y ESE es el gate real. Se mantiene
   sincronizado para que un cast futuro no reviente sobre datos válidos, pero si
   agregas un tipo de diferencia, lo que HAY QUE cambiar es el CHECK.';

-- =============================================================================
-- 2. Reemplazar el CHECK de eventos_conciliacion.tipo_diferencia
--    Lista completa: 15 previos (migración 20260805000001) + 1 nuevo = 16.
--    La columna es text + CHECK, así que hay que reponer la lista entera.
-- =============================================================================
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'dinero' and table_name = 'eventos_conciliacion'
  ) then
    alter table dinero.eventos_conciliacion
      drop constraint if exists eventos_conciliacion_tipo_valido;

    alter table dinero.eventos_conciliacion
      add constraint eventos_conciliacion_tipo_valido
      check (tipo_diferencia in (
        -- 6 originales (C6 · 2 fuentes)
        'pedido_entregado_sin_linea_cobro',
        'pedido_entregado_sin_linea_liquidacion',
        'linea_cobro_sin_pedido_entregado',
        'folio_consumido_sin_dte_persistido',
        'periodo_cerrado_con_lineas_sueltas',
        'monto_dte_difiere_de_lineas',
        -- 6 de C7 (F17 · 3 fuentes)
        'pagado_conductor_sin_cobro_seller',
        'cobrado_seller_no_pagado_conductor',
        'reprogramacion_no_cobrada',
        'minimo_omitido',
        'pago_seller_faltante',
        'pago_conductor_faltante',
        -- webhook payout (20260708000002): confirmado y luego revertido
        'payout_revertido_post_confirmacion',
        -- estado_externo no reconocido (20260709000001)
        'payout_estado_no_reconocido',
        -- línea de cobro activa sin período (20260805000001)
        'linea_cobro_sin_periodo',
        -- NUEVO: línea de LIQUIDACIÓN viva de un pedido que ya no está entregado
        -- (se canceló o se devolvió) y que C1 no pudo anular porque su
        -- liquidación ya estaba 'emitida' o 'pagada'. Es dinero que salió —o va
        -- a salir— hacia el conductor por una entrega que no ocurrió. Se levanta
        -- con bloquea_pago = true (+ motivo_bloqueo, obligatorio por el CHECK
        -- eventos_conciliacion_bloqueo_motivo): el remedio es humano (ajuste o
        -- descuento en la liquidación siguiente), nunca automático.
        'linea_liquidacion_sin_pedido_entregado'
      ));
  end if;
end $$;

comment on constraint eventos_conciliacion_tipo_valido on dinero.eventos_conciliacion is
  'Tipos de diferencia válidos de la bandeja de excepciones (16). Espejo de '
  'TipoDiferenciaConciliacion en src/modules/dinero/tipos.ts — si cambia uno, cambia el otro. '
  'El par linea_cobro_sin_pedido_entregado / linea_liquidacion_sin_pedido_entregado cubre los '
  'dos lados del punto ciego de C1: el primero bloquea la facturación al seller, el segundo '
  'bloquea el pago al conductor. Son tipos distintos porque el bloqueo son dos booleanos '
  'independientes y un tipo prestado bloquearía el lado equivocado.';

-- =============================================================================
-- 3. Verificación defensiva: el CHECK de bloqueo sigue exigiendo motivo
--    El valor nuevo nace para usarse con bloquea_pago = true. Si alguien hubiera
--    relajado eventos_conciliacion_bloqueo_motivo, un bloqueo de pago podría
--    entrar sin justificación y el dueño vería su liquidación trabada sin saber
--    por qué. No se altera el constraint: solo se inspecciona y se aborta con un
--    error legible si falta. (Mismo patrón de 20260709000001 §3.)
-- =============================================================================
do $$
declare
  v_def text;
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'dinero' and table_name = 'eventos_conciliacion'
  ) then
    select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'dinero'
      and t.relname = 'eventos_conciliacion'
      and c.conname = 'eventos_conciliacion_bloqueo_motivo';

    if v_def is null then
      raise exception
        'Falta eventos_conciliacion_bloqueo_motivo: la migración 20260708000001 (bandeja de excepciones) debe correr antes que ésta. Sin ese CHECK, bloquea_pago podría quedar sin motivo.';
    end if;

    if position('bloquea_pago' in v_def) = 0 then
      raise exception
        'eventos_conciliacion_bloqueo_motivo ya no cubre bloquea_pago; linea_liquidacion_sin_pedido_entregado depende de que el bloqueo de pago exija motivo.';
    end if;
  end if;
end $$;

-- =============================================================================
-- 4. Verificación defensiva: categoría y acción sugerida ya existen
--    El tipo nuevo NO necesita categoría ni acción nuevas. La clasificación
--    recomendada al backend es:
--      categoria_negocio = 'fuga_ingreso'          (SLA 3 días)
--      accion_sugerida   = 'generar_ajuste_liquidacion'
--    Por qué 'fuga_ingreso' y no 'integridad_datos' (donde cae su hermano del
--    cobro): en el lado del cobro la línea viva es un dato feo que un humano
--    corrige antes de facturar; en el lado de la liquidación el dinero ya salió
--    o está por salir del bolsillo del courier. Es fuga real y merece los 3 días,
--    no los 7. La decisión final del mapeo es de `backend` (§5); aquí solo se
--    comprueba que los dos valores existen para que no se caiga en su fase.
-- =============================================================================
do $$
declare
  v_cat text;
  v_acc text;
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'dinero' and table_name = 'eventos_conciliacion'
  ) then
    select pg_get_constraintdef(c.oid) into v_cat
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'dinero' and t.relname = 'eventos_conciliacion'
      and c.conname = 'eventos_conciliacion_categoria_valida';

    select pg_get_constraintdef(c.oid) into v_acc
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'dinero' and t.relname = 'eventos_conciliacion'
      and c.conname = 'eventos_conciliacion_accion_valida';

    if v_cat is null or position('fuga_ingreso' in v_cat) = 0 then
      raise exception
        'La categoría fuga_ingreso no está disponible en eventos_conciliacion_categoria_valida; linea_liquidacion_sin_pedido_entregado la necesita.';
    end if;

    if v_acc is null or position('generar_ajuste_liquidacion' in v_acc) = 0 then
      raise exception
        'La acción generar_ajuste_liquidacion no está disponible en eventos_conciliacion_accion_valida; linea_liquidacion_sin_pedido_entregado la necesita.';
    end if;
  end if;
end $$;

-- =============================================================================
-- 5. Handoff a `backend` (NO se implementa aquí — solo se documenta)
--
--    src/modules/dinero/tipos.ts
--      · TipoDiferenciaConciliacion += 'linea_liquidacion_sin_pedido_entregado'
--    src/modules/dinero/conciliacion-clasificacion.ts (espejo del backfill SQL)
--      · CATEGORIA_POR_TIPO['linea_liquidacion_sin_pedido_entregado'] = 'fuga_ingreso'
--      · ACCION_POR_TIPO['linea_liquidacion_sin_pedido_entregado']    = 'generar_ajuste_liquidacion'
--    src/lib/ui/traduccion-estados.ts
--      · etiqueta legible del tipo nuevo para la bandeja.
--    src/modules/dinero/jobs/generar-lineas.ts (D-A2)
--      · rama "no puedo anular" del COBRO       → 'linea_cobro_sin_pedido_entregado'
--        con bloquea_facturacion = true.
--      · rama "no puedo anular" de la LIQUIDACIÓN → 'linea_liquidacion_sin_pedido_entregado'
--        con bloquea_pago = true.
--      · AMBAS exigen motivo_bloqueo no vacío (CHECK eventos_conciliacion_bloqueo_motivo)
--        y driver_id / liquidacion_id pobladas (columnas de 20260613000010) — son
--        lo que permite atar la excepción al conductor y a la liquidación tocada.
--      · Idempotencia: `select … maybeSingle()` previo al insert con clave
--        (tenant_id, pedido_id, tipo_diferencia) en estado no terminal, igual que
--        los cuatro checks de conciliar-periodo.ts. C1 reintenta.
-- =============================================================================
