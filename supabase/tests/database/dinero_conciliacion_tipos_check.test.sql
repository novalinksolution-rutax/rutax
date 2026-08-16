-- =============================================================================
-- Dinero · conciliación: la lista de tipos válidos del CHECK queda FIJADA
-- =============================================================================
-- POR QUÉ EXISTE ESTE ARCHIVO (regresión real, 12-ago-2026):
--
-- `dinero.eventos_conciliacion.tipo_diferencia` es `text` + CHECK
-- (`eventos_conciliacion_tipo_valido`), no un enum. La consecuencia práctica es
-- que **cada migración que agrega un tipo tiene que reponer la lista COMPLETA**,
-- y ahí está la trampa: se copia la lista anterior, se pega el tipo nuevo al
-- final, y si la copia venía de una versión vieja, un tipo desaparece sin que
-- nada avise. Pasó: 20260811000002 agregó `linea_liquidacion_sin_pedido_entregado`
-- y 20260812000001, al día siguiente, repuso la lista desde una copia anterior
-- al 11-ago y lo borró. La migración corrió limpia; lo que se rompió fue la
-- ejecución — `jobs/generar-lineas.ts` emite ese tipo cuando a un conductor se le
-- emitió o pagó la liquidación de una entrega que después se canceló, el INSERT
-- choca con 23514 dentro de un `step.run` y el job de dinero cae. Restituido por
-- 20260813000003.
--
-- QUÉ FIJA: el conjunto EXACTO de tipos que el CHECK admite. No un conteo (un
-- conteo se cumple igual cambiando un tipo por otro, que es justo lo que pasó:
-- 16 antes y 16 después). La próxima reposición que olvide uno pone este archivo
-- en rojo en `npx supabase test db`, en vez de descubrirse en producción cuando
-- el detector correspondiente intente escribir.
--
-- Es el hermano en base de datos de `src/modules/dinero/conciliacion-tipos-sql.test.ts`,
-- que ata la lista del SQL versionado con `TipoDiferenciaConciliacion` de
-- TypeScript. Éste comprueba lo que quedó APLICADO en Postgres, que es lo que
-- importa en tiempo de ejecución; aquél comprueba el texto de las migraciones.
--
-- Este archivo NO prueba aislamiento: `eventos_conciliacion` es la trastienda del
-- courier y su RLS (cross-tenant, seller, conductor y coordinador) la cubre
-- `rls_conciliacion_linea_liquidacion_sin_pedido.test.sql`. Aquí se prueba el
-- DOMINIO de la columna, que es una garantía distinta.
--
-- Ejecutar: npx supabase test db
-- =============================================================================

begin;

select plan(8);

-- -----------------------------------------------------------------------------
-- Fixture: un tenant propio de esta suite. Los INSERT de prueba son reales
-- (bloque B) porque un CHECK solo se prueba de verdad escribiendo contra él.
-- UUIDs con sufijo 8133, propios de este archivo.
-- -----------------------------------------------------------------------------
insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
values ('aaaaaaaa-0000-0000-0000-000000008133', 'Courier Tipos',
        'Courier Tipos SpA', '76813333-3', 'activo')
on conflict (id) do nothing;

-- =============================================================================
-- BLOQUE A · La lista, tal como quedó en el catálogo
-- =============================================================================

-- Test 1: existe UN solo eventos_conciliacion_tipo_valido. Si alguna reposición
-- dejara dos constraints con listas distintas, la columna quedaría gobernada por
-- la intersección y los síntomas serían idénticos a los de esta regresión.
select results_eq(
  $sql$ select count(*)::int from pg_constraint
        where conrelid = 'dinero.eventos_conciliacion'::regclass
          and conname  = 'eventos_conciliacion_tipo_valido' $sql$,
  $sql$ values (1) $sql$,
  'Hay exactamente UN constraint eventos_conciliacion_tipo_valido'
);

-- Test 2: EL CANDADO. El conjunto de literales del CHECK aplicado es exactamente
-- éste. `set_eq` nombra los sobrantes y los faltantes, así que el fallo dice qué
-- tipo se perdió (o cuál se agregó sin actualizar esta lista ni TypeScript).
--
-- Si agregas un tipo de diferencia: (1) migración que repone el CHECK copiando
-- la lista VIGENTE de la base, (2) el tipo aquí, (3)
-- `TipoDiferenciaConciliacion` y los mapas de `conciliacion-clasificacion.ts`.
-- Los tres, o algo queda mintiendo.
select set_eq(
  $sql$
    select (m.captura)[1]
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    cross join lateral regexp_matches(
      pg_get_constraintdef(c.oid), '''([a-z0-9_]+)''', 'g'
    ) as m(captura)
    where n.nspname = 'dinero'
      and t.relname = 'eventos_conciliacion'
      and c.conname = 'eventos_conciliacion_tipo_valido'
  $sql$,
  $sql$
    values ('pedido_entregado_sin_linea_cobro'),
           ('pedido_entregado_sin_linea_liquidacion'),
           ('linea_cobro_sin_pedido_entregado'),
           ('folio_consumido_sin_dte_persistido'),
           ('periodo_cerrado_con_lineas_sueltas'),
           ('monto_dte_difiere_de_lineas'),
           ('pagado_conductor_sin_cobro_seller'),
           ('cobrado_seller_no_pagado_conductor'),
           ('reprogramacion_no_cobrada'),
           ('minimo_omitido'),
           ('pago_seller_faltante'),
           ('pago_conductor_faltante'),
           ('payout_revertido_post_confirmacion'),
           ('payout_estado_no_reconocido'),
           ('linea_cobro_sin_periodo'),
           ('linea_liquidacion_sin_pedido_entregado'),
           ('liquidacion_atribuida_a_conductor_incorrecto'),
           ('retiro_sin_monto_configurado')
  $sql$,
  'El CHECK admite EXACTAMENTE los 18 tipos de diferencia declarados (ni uno menos)'
);

-- =============================================================================
-- BLOQUE B · Comportamiento, no texto: los 18 se pueden escribir de verdad
-- =============================================================================

-- Test 3: los 18 entran en una sola sentencia. Es el escenario que se rompió:
-- un tipo ausente devuelve 23514 y aquí la sentencia entera falla nombrándolo.
select lives_ok(
  $sql$
    insert into dinero.eventos_conciliacion
      (tenant_id, tipo_diferencia, descripcion, estado, categoria_negocio, accion_sugerida)
    select 'aaaaaaaa-0000-0000-0000-000000008133', tipo,
           'Prueba de dominio del CHECK', 'pendiente', 'integridad_datos',
           'sin_accion_requerida'
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
      'liquidacion_atribuida_a_conductor_incorrecto',
      'retiro_sin_monto_configurado'
    ]) as tipo
  $sql$,
  'Los 18 tipos se escriben de verdad en dinero.eventos_conciliacion'
);

-- Test 4: y quedaron las 18 filas, una por tipo (la negativa no es vacua).
select results_eq(
  $sql$ select count(distinct tipo_diferencia)::int
        from dinero.eventos_conciliacion
        where tenant_id = 'aaaaaaaa-0000-0000-0000-000000008133' $sql$,
  $sql$ values (18) $sql$,
  'Quedaron 18 tipos distintos escritos: ninguno se coló por un CHECK relajado'
);

-- Test 5: la lista sigue CERRADA. Un dominio que acepta cualquier cosa no es un
-- dominio, y la bandeja de excepciones se llenaría de tipos que la UI no sabe
-- traducir ni clasificar.
select throws_ok(
  $sql$
    insert into dinero.eventos_conciliacion
      (tenant_id, tipo_diferencia, descripcion, estado, categoria_negocio)
    values ('aaaaaaaa-0000-0000-0000-000000008133',
            'tipo_que_no_existe_y_nunca_debe_entrar',
            'Tipo inventado', 'pendiente', 'integridad_datos')
  $sql$,
  '23514',
  null,
  'Un tipo_diferencia fuera de la lista se sigue rechazando (23514)'
);

-- =============================================================================
-- BLOQUE C · El enum vestigial no puede volver a derivar
-- =============================================================================

-- Test 6: `dinero.tipo_diferencia_conciliacion` no gobierna ninguna columna (el
-- gate real es el CHECK), pero si miente revienta el primer cast que alguien
-- escriba en un reporte o en una migración, sobre datos perfectamente válidos.
-- Ya derivó dos veces: 20260709000001/20260805000001 ampliaron solo el CHECK, y
-- 20260812000001 volvió a hacerlo. Mismo conjunto que el CHECK, exacto.
select set_eq(
  $sql$
    select e.enumlabel::text
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'dinero' and t.typname = 'tipo_diferencia_conciliacion'
  $sql$,
  $sql$
    select (m.captura)[1]
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    cross join lateral regexp_matches(
      pg_get_constraintdef(c.oid), '''([a-z0-9_]+)''', 'g'
    ) as m(captura)
    where n.nspname = 'dinero'
      and t.relname = 'eventos_conciliacion'
      and c.conname = 'eventos_conciliacion_tipo_valido'
  $sql$,
  'El enum vestigial y el CHECK admiten el MISMO conjunto de tipos'
);

-- =============================================================================
-- BLOQUE D · Re-aplicar la migración vigente no encoge la lista
-- Reproduce el DDL de 20260813000003 (la cabeza de este constraint). Es la
-- prueba de que la migración es re-aplicable Y de que su lista es la completa:
-- si alguien la editara copiando una versión anterior, el test 8 lo caza.
-- =============================================================================

-- Test 7: el DDL vigente corre por segunda vez sin error.
select lives_ok(
  $sql$
    do $blk$
    begin
      alter table dinero.eventos_conciliacion
        drop constraint if exists eventos_conciliacion_tipo_valido;
      alter table dinero.eventos_conciliacion
        add constraint eventos_conciliacion_tipo_valido
        check (tipo_diferencia in (
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
          'retiro_sin_monto_configurado'
        ));
    end
    $blk$;
  $sql$,
  'Idempotencia: el DDL vigente del CHECK se re-aplica sin error'
);

-- Test 8: y tras re-aplicarlo el conjunto sigue siendo el mismo — la re-creación
-- del constraint no perdió ni ganó tipos, que es exactamente lo que falló entre
-- el 11 y el 12 de agosto.
select set_eq(
  $sql$
    select (m.captura)[1]
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    cross join lateral regexp_matches(
      pg_get_constraintdef(c.oid), '''([a-z0-9_]+)''', 'g'
    ) as m(captura)
    where n.nspname = 'dinero'
      and t.relname = 'eventos_conciliacion'
      and c.conname = 'eventos_conciliacion_tipo_valido'
  $sql$,
  $sql$
    values ('pedido_entregado_sin_linea_cobro'),
           ('pedido_entregado_sin_linea_liquidacion'),
           ('linea_cobro_sin_pedido_entregado'),
           ('folio_consumido_sin_dte_persistido'),
           ('periodo_cerrado_con_lineas_sueltas'),
           ('monto_dte_difiere_de_lineas'),
           ('pagado_conductor_sin_cobro_seller'),
           ('cobrado_seller_no_pagado_conductor'),
           ('reprogramacion_no_cobrada'),
           ('minimo_omitido'),
           ('pago_seller_faltante'),
           ('pago_conductor_faltante'),
           ('payout_revertido_post_confirmacion'),
           ('payout_estado_no_reconocido'),
           ('linea_cobro_sin_periodo'),
           ('linea_liquidacion_sin_pedido_entregado'),
           ('liquidacion_atribuida_a_conductor_incorrecto'),
           ('retiro_sin_monto_configurado')
  $sql$,
  'Tras re-aplicar el DDL vigente, el CHECK sigue admitiendo los mismos 18 tipos'
);

-- =============================================================================
-- Cierre
-- =============================================================================
select * from finish();

rollback;
