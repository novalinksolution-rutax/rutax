-- =============================================================================
-- dinero · conciliación: RESTITUIR `linea_liquidacion_sin_pedido_entregado`
-- (regresión de producción — el CHECK perdió un tipo al reponerse la lista)
-- =============================================================================
-- QUÉ PASÓ, verificado contra la base (2026-08-13):
--
--   · 20260811000002 agregó `linea_liquidacion_sin_pedido_entregado` y dejó el
--     CHECK `eventos_conciliacion_tipo_valido` con 16 valores.
--   · 20260812000001, al día siguiente, repuso la lista entera para agregar
--     `liquidacion_atribuida_a_conductor_incorrecto`… pero copió la versión
--     ANTERIOR al 11-ago. Quedaron 16 otra vez y el tipo del día anterior
--     DESAPARECIÓ del CHECK.
--
-- Nada falló al migrar: el CHECK quedó bien formado, solo que sin ese valor.
-- `pg_get_constraintdef` en producción y en local devuelve los 16 con
-- `liquidacion_atribuida_a_conductor_incorrecto` presente y
-- `linea_liquidacion_sin_pedido_entregado` ausente.
--
-- POR QUÉ ES GRAVE (no es cosmético):
-- `src/modules/dinero/jobs/generar-lineas.ts:616` emite ese tipo con
-- `bloquea_pago = true` cuando un pedido pasó a `cancelado`/`devuelto` y su línea
-- de liquidación NO se pudo anular porque la liquidación ya estaba `emitida` o
-- `pagada` — es decir, dinero que ya salió (o va a salir) hacia el conductor por
-- una entrega que no ocurrió. El writer `levantarExcepcionLineaNoAnulable`
-- (`:127`) hace `throw` si el INSERT falla, y corre dentro de un `step.run` de
-- Inngest: el INSERT choca con 23514 y el job de dinero se cae. Peor todavía: la
-- bitácora se escribe ANTES del INSERT, así que quedaba asiento de auditoría de
-- un evento de conciliación que nunca llegó a existir. El único mecanismo que
-- retiene ese pago para que un humano lo resuelva se caía justo cuando tenía que
-- actuar.
--
-- El tipo seguía vivo en TypeScript (`src/modules/dinero/tipos.ts:78`), en
-- `conciliacion-clasificacion.ts` (categoría `fuga_ingreso`, acción
-- `generar_ajuste_liquidacion`) y en la UI de la bandeja: SOLO la base lo
-- rechazaba. Por eso la regresión no se veía hasta la excepción real.
--
-- POR QUÉ UNA MIGRACIÓN NUEVA Y NO EDITAR 20260812000001:
-- esa migración ya está aplicada en producción. Editar su texto no cambia nada
-- en una base migrada; el estado solo se corrige hacia adelante.
--
-- ALCANCE: SOLO el CHECK y el enum vestigial. No toca columnas, RLS, políticas,
-- grants, vistas ni datos. `dinero.eventos_conciliacion` sigue siendo la
-- trastienda del courier: SELECT solo para `dueno`/`administracion` del MISMO
-- tenant (política `eventos_conciliacion_select`, RLS forzada), escritura solo
-- `service_role`. Un tipo de diferencia no abre ninguna rendija: es el dominio
-- de una columna, no un permiso. Lo prueban
-- `supabase/tests/database/rls_conciliacion_linea_liquidacion_sin_pedido.test.sql`
-- (bloque C: cross-tenant, seller, conductor y coordinador) y
-- `dinero_conciliacion_tipos_check.test.sql`.
--
-- REGLA PARA QUIEN VENGA DETRÁS (esta es la lección, y ya costó dos veces):
-- `tipo_diferencia` es `text` + CHECK, así que **cada migración que agrega un
-- tipo tiene que reponer la lista COMPLETA**. Copia la lista VIGENTE
-- (`select pg_get_constraintdef(oid) from pg_constraint where conname =
-- 'eventos_conciliacion_tipo_valido'`), NUNCA la de una migración anterior. Hay
-- tres redes que avisan si te equivocas: la aserción §3 de esta migración, el
-- pgTAP `dinero_conciliacion_tipos_check.test.sql` (fija la lista exacta) y la
-- prueba de Vitest que ata SQL con TypeScript.
--
-- IDEMPOTENTE: `add value if not exists` sobre el enum + DROP/ADD del CHECK
-- dentro de DO-blocks guardados por la existencia del objeto. Re-aplicable
-- tantas veces como se quiera. Mismo mecanismo que 20260613000010,
-- 20260708000002, 20260709000001, 20260805000001, 20260811000002 y
-- 20260812000001.
-- =============================================================================

-- =============================================================================
-- 1. El enum vestigial dinero.tipo_diferencia_conciliacion
--
--    20260811000002 §1 lo declaró VESTIGIAL y tenía razón: ninguna columna ni
--    función lo usa, y el gate real de escritura es el CHECK de la sección 2.
--    Pero se mantiene sincronizado a propósito, para que un cast futuro
--    (`::dinero.tipo_diferencia_conciliacion` en un reporte o en otra migración)
--    no reviente con "invalid input value for enum" sobre datos perfectamente
--    válidos.
--
--    Y volvió a derivar: 20260812000001 amplió SOLO el CHECK, así que hoy el
--    enum tiene `linea_liquidacion_sin_pedido_entregado` (que al CHECK le falta)
--    y le falta `liquidacion_atribuida_a_conductor_incorrecto` (que el CHECK sí
--    tiene). Los dos quedan aquí: tras esta migración, enum y CHECK admiten
--    exactamente el mismo conjunto de 17.
--
--    ALTER TYPE ... ADD VALUE puede correr dentro de bloque transaccional en
--    PG12+ siempre que el valor nuevo no se USE en la misma transacción. Aquí
--    nunca se usa como literal-enum (el CHECK compara `text` y la aserción §4
--    lee el catálogo `pg_enum`), así que es seguro.
-- =============================================================================
do $$
begin
  if exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'dinero' and t.typname = 'tipo_diferencia_conciliacion'
  ) then
    -- El que faltaba en el enum (lo agregó al CHECK 20260812000001, sin tocar el tipo).
    alter type dinero.tipo_diferencia_conciliacion
      add value if not exists 'liquidacion_atribuida_a_conductor_incorrecto';
    -- Defensivos: ya deberían estar desde 20260811000002. `if not exists` los
    -- vuelve inertes, y cubren el caso de una base que se quedó a medio camino.
    alter type dinero.tipo_diferencia_conciliacion
      add value if not exists 'payout_estado_no_reconocido';
    alter type dinero.tipo_diferencia_conciliacion
      add value if not exists 'linea_cobro_sin_periodo';
    alter type dinero.tipo_diferencia_conciliacion
      add value if not exists 'linea_liquidacion_sin_pedido_entregado';
  end if;
end $$;

comment on type dinero.tipo_diferencia_conciliacion is
  'Tipo VESTIGIAL (17 etiquetas): ninguna columna ni función lo usa. La columna
   dinero.eventos_conciliacion.tipo_diferencia es text + CHECK
   (eventos_conciliacion_tipo_valido), y ESE es el gate real de escritura. Se
   mantiene sincronizado para que un cast futuro no reviente sobre datos
   válidos, pero si agregas un tipo de diferencia, lo que HAY QUE cambiar es el
   CHECK — y ojo: hay que reponer su lista ENTERA, copiando la VIGENTE de la
   base y no la de una migración anterior (así se perdió
   linea_liquidacion_sin_pedido_entregado entre el 11 y el 12 de agosto de 2026).';

-- =============================================================================
-- 2. Reponer eventos_conciliacion_tipo_valido con los 17 valores
--    = los 16 de 20260812000001 + `linea_liquidacion_sin_pedido_entregado`,
--    que es el que se perdió. Ningún valor se retira: la lista solo crece.
--    Espejo exacto de TipoDiferenciaConciliacion en src/modules/dinero/tipos.ts.
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
        -- 6 originales · C6, 2 fuentes (20260601000006)
        'pedido_entregado_sin_linea_cobro',
        'pedido_entregado_sin_linea_liquidacion',
        'linea_cobro_sin_pedido_entregado',
        'folio_consumido_sin_dte_persistido',
        'periodo_cerrado_con_lineas_sueltas',
        'monto_dte_difiere_de_lineas',
        -- 6 de C7 · F17, 3 fuentes (20260613000010)
        'pagado_conductor_sin_cobro_seller',
        'cobrado_seller_no_pagado_conductor',
        'reprogramacion_no_cobrada',
        'minimo_omitido',
        'pago_seller_faltante',
        'pago_conductor_faltante',
        -- webhook payout: confirmado y luego revertido (20260708000002)
        'payout_revertido_post_confirmacion',
        -- estado_externo de payout no reconocido (20260709000001)
        'payout_estado_no_reconocido',
        -- línea de cobro activa que quedó sin período (20260805000001)
        'linea_cobro_sin_periodo',
        -- RESTITUIDO: línea de LIQUIDACIÓN viva de un pedido cancelado/devuelto
        -- que C1 no pudo anular porque la liquidación ya estaba emitida o
        -- pagada. Es dinero que salió hacia el conductor por una entrega que no
        -- ocurrió; se levanta con bloquea_pago = true + motivo_bloqueo y el
        -- remedio es humano. Lo agregó 20260811000002 y lo perdió
        -- 20260812000001 al copiar una lista vieja.
        'linea_liquidacion_sin_pedido_entregado',
        -- línea de liquidación atribuida al conductor equivocado tras una
        -- reasignación — "Pedro entrega, Juan cobra" (20260812000001)
        'liquidacion_atribuida_a_conductor_incorrecto'
      ));
  end if;
end $$;

comment on constraint eventos_conciliacion_tipo_valido on dinero.eventos_conciliacion is
  'Tipos de diferencia válidos de la bandeja de excepciones (17). Espejo de '
  'TipoDiferenciaConciliacion en src/modules/dinero/tipos.ts — si cambia uno, cambia el otro. '
  'REPONER ESTA LISTA COPIANDO LA VIGENTE DE LA BASE (pg_get_constraintdef), NUNCA la de una '
  'migración anterior: así se perdió linea_liquidacion_sin_pedido_entregado el 12-ago-2026 y el '
  'job de dinero se caía con 23514 al levantar la excepción que retiene el pago al conductor. '
  'El par linea_cobro_sin_pedido_entregado / linea_liquidacion_sin_pedido_entregado cubre los dos '
  'lados del punto ciego de C1: el primero bloquea la facturación al seller, el segundo bloquea '
  'el pago al conductor (son dos booleanos independientes, por eso son tipos distintos).';

-- =============================================================================
-- 3. Aserción defensiva del CHECK — SEMÁNTICA, no por conteo de caracteres
--
--    Se copia la expresión REAL del constraint a una tabla temporal con una sola
--    columna `tipo_diferencia text` y se intenta insertar cada uno de los 17
--    valores esperados. Lo que se prueba es el comportamiento del CHECK tal como
--    quedó en el catálogo, sin depender del texto de esta migración, sin tocar
--    `dinero.eventos_conciliacion` (que exige tenant y FKs) y sin escribir una
--    sola fila de negocio.
--
--    Se comprueban las DOS direcciones: que admita los 17 (si falta uno, aborta
--    nombrándolo) y que siga cerrado (un tipo inventado tiene que seguir
--    rechazándose; una lista que acepta cualquier cosa no es una lista).
-- =============================================================================
do $$
declare
  v_def        text;
  v_tipo       text;
  v_rechazados text[] := array[]::text[];
  v_esperados  text[] := array[
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
    'liquidacion_atribuida_a_conductor_incorrecto'
  ];
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'dinero' and table_name = 'eventos_conciliacion'
  ) then
    return;
  end if;

  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'dinero'
    and t.relname = 'eventos_conciliacion'
    and c.conname = 'eventos_conciliacion_tipo_valido';

  if v_def is null then
    raise exception
      'eventos_conciliacion_tipo_valido no existe tras aplicar esta migración: el DROP/ADD de la sección 2 no tomó efecto y tipo_diferencia quedaría sin dominio.';
  end if;

  drop table if exists _verificacion_tipo_diferencia;
  create temp table _verificacion_tipo_diferencia (tipo_diferencia text) on commit drop;
  execute 'alter table _verificacion_tipo_diferencia add constraint _verificacion_tipo ' || v_def;

  foreach v_tipo in array v_esperados loop
    begin
      execute 'insert into _verificacion_tipo_diferencia (tipo_diferencia) values ($1)' using v_tipo;
    exception when check_violation then
      v_rechazados := v_rechazados || v_tipo;
    end;
  end loop;

  if array_length(v_rechazados, 1) is not null then
    raise exception
      'El CHECK eventos_conciliacion_tipo_valido rechaza % de los 17 tipos que el motor de dinero emite: %. Un tipo ausente tumba el job de dinero con 23514 dentro de un step.run — revisa que la sección 2 no haya copiado una lista vieja.',
      array_length(v_rechazados, 1), array_to_string(v_rechazados, ', ');
  end if;

  begin
    execute 'insert into _verificacion_tipo_diferencia (tipo_diferencia) values ($1)'
      using 'tipo_que_no_existe_y_nunca_debe_entrar';
    raise exception
      'El CHECK eventos_conciliacion_tipo_valido acepta un tipo inventado: dejó de ser una lista cerrada y cualquier basura entraría a la bandeja de excepciones.';
  exception when check_violation then
    null; -- correcto: el dominio sigue cerrado
  end;

  drop table if exists _verificacion_tipo_diferencia;
end $$;

-- =============================================================================
-- 4. Aserción defensiva del enum vestigial
--    Se lee el catálogo (nunca un cast: el valor agregado en §1 no se puede USAR
--    en esta misma transacción). Si falta alguna etiqueta, aborta nombrándola.
-- =============================================================================
do $$
declare
  v_faltantes text[];
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'dinero' and t.typname = 'tipo_diferencia_conciliacion'
  ) then
    return;
  end if;

  select coalesce(array_agg(esperado order by esperado), array[]::text[])
    into v_faltantes
  from unnest(array[
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
    'liquidacion_atribuida_a_conductor_incorrecto'
  ]) as esperado
  where not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'dinero'
      and t.typname = 'tipo_diferencia_conciliacion'
      and e.enumlabel = esperado
  );

  if array_length(v_faltantes, 1) is not null then
    raise exception
      'Al enum vestigial dinero.tipo_diferencia_conciliacion le faltan etiquetas: %. No gobierna ninguna columna, pero un tipo que miente revienta el primer cast que alguien escriba sobre datos válidos.',
      array_to_string(v_faltantes, ', ');
  end if;
end $$;
