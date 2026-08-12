-- =============================================================================
-- Conciliación · tipo `linea_liquidacion_sin_pedido_entregado`
-- Disponibilidad del tipo + idempotencia de la migración + aislamiento intacto
-- =============================================================================
-- Cubre la migración 20260811000002. Demuestra, contra Postgres real (no mocks
-- de aplicación), tres cosas distintas:
--
--   A · DISPONIBILIDAD — el valor nuevo se puede escribir en
--       dinero.eventos_conciliacion con bloquea_pago = true, y el CHECK que lo
--       admite sigue rechazando lo que debe rechazar: un tipo inventado, y un
--       bloqueo de pago sin motivo.
--
--   B · IDEMPOTENCIA — re-ejecutar el DDL de la migración (ADD VALUE del enum +
--       DROP/ADD del CHECK) dentro de esta transacción no revienta, no duplica
--       el constraint y deja el valor igual de escribible. Es la prueba de que
--       la migración se puede aplicar dos veces.
--
--   C · AISLAMIENTO — el tipo nuevo NO abre una rendija. eventos_conciliacion
--       es la trastienda del courier: solo dueno/administracion del MISMO tenant.
--       Aquí se prueba que el tenant A no lee filas del B, que el seller no ve
--       datos internos del courier (ni los suyos referenciados por seller_id),
--       y —lo más delicado de este tipo— que el CONDUCTOR no ve la excepción que
--       dice que se le pagó de más, ni siquiera filtrando por su propio driver_id.
--
-- ESTE TEST FALLA SIN LA MIGRACIÓN: sin ella el CHECK
-- eventos_conciliacion_tipo_valido no admite el valor y el INSERT del test 1
-- rompe con 23514, arrastrando a los tests que dependen de esa fila.
--
-- El tipo existe porque C1 (`generar-lineas`) no siempre puede anular la línea
-- de liquidación de un pedido cancelado/devuelto: si la liquidación ya está
-- 'emitida' o 'pagada', el dinero ya salió hacia el conductor. Eso bloquea el
-- PAGO (bloquea_pago), no la facturación — por eso es un tipo propio y no el
-- prestado del lado del cobro.
--
-- Mecanismo de sesión: idéntico a rls_aislamiento_dinero.test.sql — se simula el
-- JWT fijando request.jwt.claims y conmutando el rol a authenticated.
--
-- Ejecutar: npx supabase test db
-- =============================================================================

begin;

select plan(18);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada (redefinidos — cada .test.sql corre aislado).
-- -----------------------------------------------------------------------------
create or replace function test_iniciar_sesion(
  p_user_id      uuid,
  p_tenant_id    uuid,
  p_tipo_usuario text,
  p_rol          text,
  p_seller_id    uuid default null,
  p_driver_id    uuid default null
) returns void
language plpgsql
as $$
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',          p_user_id,
      'role',         'authenticated',
      'tenant_id',    p_tenant_id,
      'tipo_usuario', p_tipo_usuario,
      'seller_id',    p_seller_id,
      'driver_id',    p_driver_id,
      'rol',          p_rol
    )::text,
    true
  );
end;
$$;

create or replace function test_cerrar_sesion() returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
end;
$$;

-- -----------------------------------------------------------------------------
-- Fixtures — dos tenants (A, B), cada uno con seller, conductor y liquidación.
-- Las liquidaciones van 'pagada': es el caso real que motiva el tipo (C1 ya no
-- puede anular la línea porque el conductor cobró).
--
-- Los eventos que se crean AQUÍ usan tipos que ya existían antes de la migración,
-- a propósito: así el bloque de fixtures nunca revienta y el fallo sin migración
-- queda acotado a los tests que lo prueban, no a una caída del archivo entero.
-- UUIDs con sufijo 8811, propios de esta suite.
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-000000008811';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-000000008812';

  s_a uuid := 'aaaaaaaa-1111-0000-0000-000000008811';
  s_b uuid := 'bbbbbbbb-1111-0000-0000-000000008812';

  d_a uuid := 'aaaaaaaa-2222-0000-0000-000000008811';
  d_b uuid := 'bbbbbbbb-2222-0000-0000-000000008812';

  u_dueno_a       uuid := 'aaaaaaaa-3333-0000-0000-000000008811';
  u_admin_a       uuid := 'aaaaaaaa-3333-0000-0000-000000008812';
  u_coordinador_a uuid := 'aaaaaaaa-3333-0000-0000-000000008813';
  u_seller_a      uuid := 'aaaaaaaa-3333-0000-0000-000000008814';
  u_conductor_a   uuid := 'aaaaaaaa-3333-0000-0000-000000008815';
  u_admin_b       uuid := 'bbbbbbbb-3333-0000-0000-000000008812';

  liq_a uuid := 'aaaaaaaa-ffff-8811-0000-000000000001';
  liq_b uuid := 'bbbbbbbb-ffff-8811-0000-000000000001';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier A', 'Courier A SpA', '76881111-1', 'activo'),
    (t_b, 'Courier B', 'Courier B SpA', '76882222-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_dueno_a,       'dueno.a@liqsinpedido.test',       crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_admin_a,       'admin.a@liqsinpedido.test',       crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_coordinador_a, 'coordinador.a@liqsinpedido.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,      'seller.a@liqsinpedido.test',      crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a,   'conductor.a@liqsinpedido.test',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_admin_b,       'admin.b@liqsinpedido.test',       crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a, t_a, 'Seller A', '77881111-1', 'Contacto A', 'a@liqsinpedido.test', 'activo'),
    (s_b, t_b, 'Seller B', '77882222-2', 'Contacto B', 'b@liqsinpedido.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values
    (d_a, t_a, 'Conductor A', '78881111-1', 'independiente', 'activo'),
    (d_b, t_b, 'Conductor B', '78882222-2', 'independiente', 'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_dueno_a,       t_a, 'Dueno A',       'interno',   null, null, 'dueno',          'activo'),
    (u_admin_a,       t_a, 'Admin A',       'interno',   null, null, 'administracion', 'activo'),
    (u_coordinador_a, t_a, 'Coordinador A', 'interno',   null, null, 'coordinador',    'activo'),
    (u_seller_a,      t_a, 'Seller A user', 'seller',    s_a,  null, 'seller',         'activo'),
    (u_conductor_a,   t_a, 'Cond A user',   'conductor', null, d_a,  'conductor',      'activo'),
    (u_admin_b,       t_b, 'Admin B',       'interno',   null, null, 'administracion', 'activo')
  on conflict (id) do nothing;

  -- Liquidaciones YA PAGADAS: el escenario que hace imposible la anulación.
  insert into dinero.liquidaciones (id, tenant_id, driver_id, fecha_inicio, fecha_fin,
    tipo_periodo, estado, tipo_relacion_conductor)
  values
    (liq_a, t_a, d_a, '2026-08-01', '2026-08-07', 'semanal', 'pagada', 'independiente'),
    (liq_b, t_b, d_b, '2026-08-01', '2026-08-07', 'semanal', 'pagada', 'independiente')
  on conflict (id) do nothing;

  -- Eventos con tipos preexistentes (no dependen de la migración).
  insert into dinero.eventos_conciliacion (id, tenant_id, seller_id, tipo_diferencia,
    descripcion, monto_diferencia_clp, estado, categoria_negocio, accion_sugerida)
  values
    ('aaaaaaaa-8811-0000-0000-00000000000f', t_a, s_a, 'monto_dte_difiere_de_lineas',
     'Fixture A: tipo preexistente', 1000, 'pendiente', 'cumplimiento_dte', 'reenviar_o_verificar_dte'),
    ('bbbbbbbb-8811-0000-0000-00000000000f', t_b, s_b, 'monto_dte_difiere_de_lineas',
     'Fixture B: tipo preexistente', 2000, 'pendiente', 'cumplimiento_dte', 'reenviar_o_verificar_dte')
  on conflict (id) do nothing;
end $$;

-- =============================================================================
-- BLOQUE A · Disponibilidad del tipo nuevo
-- =============================================================================

-- Test 1: el valor nuevo se inserta con bloquea_pago = true (+ motivo_bloqueo,
-- driver_id y liquidacion_id, que es lo que poblará C1). Una fila por tenant:
-- la del tenant B existe para que los cruces posteriores no sean vacuos.
select lives_ok(
  $sql$
    insert into dinero.eventos_conciliacion (id, tenant_id, seller_id, driver_id,
      liquidacion_id, tipo_diferencia, descripcion, monto_diferencia_clp, estado,
      categoria_negocio, accion_sugerida, bloquea_pago, motivo_bloqueo)
    values
      ('aaaaaaaa-8811-0000-0000-000000000001',
       'aaaaaaaa-0000-0000-0000-000000008811',
       'aaaaaaaa-1111-0000-0000-000000008811',
       'aaaaaaaa-2222-0000-0000-000000008811',
       'aaaaaaaa-ffff-8811-0000-000000000001',
       'linea_liquidacion_sin_pedido_entregado',
       'Pedido cancelado con linea de liquidacion viva en una liquidacion ya pagada',
       3500, 'pendiente', 'fuga_ingreso', 'generar_ajuste_liquidacion',
       true, 'Se retiene el pago al conductor hasta ajustar la entrega cancelada'),
      ('bbbbbbbb-8811-0000-0000-000000000001',
       'bbbbbbbb-0000-0000-0000-000000008812',
       'bbbbbbbb-1111-0000-0000-000000008812',
       'bbbbbbbb-2222-0000-0000-000000008812',
       'bbbbbbbb-ffff-8811-0000-000000000001',
       'linea_liquidacion_sin_pedido_entregado',
       'Mismo caso en el tenant B',
       900, 'pendiente', 'fuga_ingreso', 'generar_ajuste_liquidacion',
       true, 'Se retiene el pago al conductor hasta ajustar la entrega cancelada')
  $sql$,
  'Tipo nuevo: linea_liquidacion_sin_pedido_entregado se inserta con bloquea_pago = true'
);

-- Test 2: la fila quedó con el bloqueo en el lado correcto — bloquea el PAGO al
-- conductor y NO la facturación al seller (que es un documento distinto).
select results_eq(
  $sql$ select bloquea_pago, bloquea_facturacion, categoria_negocio, accion_sugerida
        from dinero.eventos_conciliacion
        where id = 'aaaaaaaa-8811-0000-0000-000000000001' $sql$,
  $sql$ values (true, false, 'fuga_ingreso', 'generar_ajuste_liquidacion') $sql$,
  'Tipo nuevo: bloquea el pago al conductor y NO la facturación al seller'
);

-- Test 3: bloquear el pago sin motivo sigue prohibido (23514). El dueño no puede
-- encontrarse una liquidación trabada sin saber por qué.
select throws_ok(
  $sql$
    insert into dinero.eventos_conciliacion (tenant_id, tipo_diferencia, descripcion,
      estado, categoria_negocio, accion_sugerida, bloquea_pago)
    values ('aaaaaaaa-0000-0000-0000-000000008811',
            'linea_liquidacion_sin_pedido_entregado',
            'Bloqueo sin motivo', 'pendiente', 'fuga_ingreso',
            'generar_ajuste_liquidacion', true)
  $sql$,
  '23514',
  null,
  'Tipo nuevo: bloquea_pago = true sin motivo_bloqueo sigue rechazado (23514)'
);

-- Test 4: el CHECK no se relajó de paso — un tipo inventado sigue rechazado.
select throws_ok(
  $sql$
    insert into dinero.eventos_conciliacion (tenant_id, tipo_diferencia, descripcion,
      estado, categoria_negocio)
    values ('aaaaaaaa-0000-0000-0000-000000008811', 'tipo_que_no_existe',
            'Tipo inventado', 'pendiente', 'integridad_datos')
  $sql$,
  '23514',
  null,
  'El CHECK sigue cerrado: un tipo_diferencia inventado se rechaza (23514)'
);

-- =============================================================================
-- BLOQUE B · Idempotencia de la migración
-- Se re-ejecuta aquí el DDL exacto de 20260811000002 (ADD VALUE + DROP/ADD del
-- CHECK). Si la migración no fuera re-aplicable, esto reventaría.
-- =============================================================================

-- Test 5: el DDL de la migración corre por segunda vez sin errores.
select lives_ok(
  $sql$
    do $blk$
    begin
      if exists (
        select 1 from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'dinero' and t.typname = 'tipo_diferencia_conciliacion'
      ) then
        alter type dinero.tipo_diferencia_conciliacion
          add value if not exists 'payout_estado_no_reconocido';
        alter type dinero.tipo_diferencia_conciliacion
          add value if not exists 'linea_cobro_sin_periodo';
        alter type dinero.tipo_diferencia_conciliacion
          add value if not exists 'linea_liquidacion_sin_pedido_entregado';
      end if;

      if exists (
        select 1 from information_schema.tables
        where table_schema = 'dinero' and table_name = 'eventos_conciliacion'
      ) then
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
            'linea_liquidacion_sin_pedido_entregado'
          ));
      end if;
    end
    $blk$;
  $sql$,
  'Idempotencia: el DDL de la migración se re-aplica sin error'
);

-- Test 6: la re-aplicación no duplicó el constraint (sigue habiendo exactamente 1).
select results_eq(
  $sql$ select count(*)::int from pg_constraint
        where conrelid = 'dinero.eventos_conciliacion'::regclass
          and conname  = 'eventos_conciliacion_tipo_valido' $sql$,
  $sql$ values (1) $sql$,
  'Idempotencia: tras re-aplicar sigue existiendo UN solo eventos_conciliacion_tipo_valido'
);

-- Test 7: tras la re-aplicación el valor nuevo se sigue pudiendo escribir.
select lives_ok(
  $sql$
    insert into dinero.eventos_conciliacion (id, tenant_id, driver_id, liquidacion_id,
      tipo_diferencia, descripcion, estado, categoria_negocio, accion_sugerida,
      bloquea_pago, motivo_bloqueo)
    values ('aaaaaaaa-8811-0000-0000-000000000002',
            'aaaaaaaa-0000-0000-0000-000000008811',
            'aaaaaaaa-2222-0000-0000-000000008811',
            'aaaaaaaa-ffff-8811-0000-000000000001',
            'linea_liquidacion_sin_pedido_entregado',
            'Segunda excepcion tras re-aplicar la migracion', 'pendiente',
            'fuga_ingreso', 'generar_ajuste_liquidacion',
            true, 'Se retiene el pago hasta ajustar')
  $sql$,
  'Idempotencia: tras re-aplicar, el tipo nuevo sigue siendo escribible'
);

-- Test 8: el enum vestigial quedó sincronizado (no gobierna nada, pero deja de
-- mentir: un cast futuro no reventará sobre un dato válido).
select results_eq(
  $sql$ select exists (
          select 1 from pg_enum e
          join pg_type t on t.oid = e.enumtypid
          join pg_namespace n on n.oid = t.typnamespace
          where n.nspname = 'dinero'
            and t.typname = 'tipo_diferencia_conciliacion'
            and e.enumlabel = 'linea_liquidacion_sin_pedido_entregado'
        ) $sql$,
  $sql$ values (true) $sql$,
  'El enum vestigial dinero.tipo_diferencia_conciliacion incluye el valor nuevo'
);

-- =============================================================================
-- BLOQUE C · Aislamiento — el tipo nuevo no abre ninguna rendija
-- =============================================================================

-- --- C.1 · Quien SÍ debe ver: dueno y administracion del propio tenant --------
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000008811'::uuid, -- u_dueno_a
  'aaaaaaaa-0000-0000-0000-000000008811'::uuid, -- t_a
  'interno', 'dueno'
);

-- Test 9: el dueño del tenant A ve SUS dos excepciones del tipo nuevo.
select results_eq(
  $sql$ select count(*)::int from public.eventos_conciliacion
        where tipo_diferencia = 'linea_liquidacion_sin_pedido_entregado' $sql$,
  $sql$ values (2) $sql$,
  'Aislamiento: el dueno del tenant A ve sus 2 excepciones del tipo nuevo (y ninguna del B)'
);

-- Test 10: y ve el bloqueo con su conductor y su liquidación, que es lo que
-- vuelve accionable la excepción.
select results_eq(
  $sql$ select bloquea_pago, driver_id, liquidacion_id from public.eventos_conciliacion
        where id = 'aaaaaaaa-8811-0000-0000-000000000001' $sql$,
  $sql$ values (true,
                'aaaaaaaa-2222-0000-0000-000000008811'::uuid,
                'aaaaaaaa-ffff-8811-0000-000000000001'::uuid) $sql$,
  'Aislamiento: el dueno ve bloquea_pago + driver_id + liquidacion_id de su excepción'
);

-- Test 11: administracion del tenant A también (es el rol que gestiona la bandeja).
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000008812'::uuid, -- u_admin_a
  'aaaaaaaa-0000-0000-0000-000000008811'::uuid, -- t_a
  'interno', 'administracion'
);
select isnt_empty(
  $sql$ select 1 from public.eventos_conciliacion
        where tipo_diferencia = 'linea_liquidacion_sin_pedido_entregado' $sql$,
  'Aislamiento: administracion del tenant A ve las excepciones del tipo nuevo'
);

-- Test 12: CROSS-TENANT — administracion de A NO ve la fila del tenant B, que
-- existe (test 1 la creó): la negativa no es vacua.
select is_empty(
  $sql$ select 1 from public.eventos_conciliacion
        where tenant_id = 'bbbbbbbb-0000-0000-0000-000000008812' $sql$,
  'Aislamiento P1: administracion del tenant A NO lee la excepción del tenant B'
);

-- Test 13: CROSS-TENANT en el otro sentido — administracion de B no ve la de A.
select test_iniciar_sesion(
  'bbbbbbbb-3333-0000-0000-000000008812'::uuid, -- u_admin_b
  'bbbbbbbb-0000-0000-0000-000000008812'::uuid, -- t_b
  'interno', 'administracion'
);
select is_empty(
  $sql$ select 1 from public.eventos_conciliacion
        where tenant_id = 'aaaaaaaa-0000-0000-0000-000000008811' $sql$,
  'Aislamiento P1: administracion del tenant B NO lee la excepción del tenant A'
);

-- --- C.2 · Interno con rol no privilegiado -----------------------------------
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000008813'::uuid, -- u_coordinador_a
  'aaaaaaaa-0000-0000-0000-000000008811'::uuid, -- t_a
  'interno', 'coordinador'
);

-- Test 14: el coordinador es interno del MISMO tenant y aun así no ve la bandeja.
select is_empty(
  $sql$ select 1 from public.eventos_conciliacion $sql$,
  'Aislamiento: el coordinador (interno del tenant A) NO ve conciliación, ni con el tipo nuevo'
);

-- --- C.3 · Seller: nada de la trastienda del courier --------------------------
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000008814'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000008811'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000008811'::uuid -- s_a
);

-- Test 15: 0 filas en la vista, aunque la excepción lleve SU seller_id.
select is_empty(
  $sql$ select 1 from public.eventos_conciliacion
        where seller_id = 'aaaaaaaa-1111-0000-0000-000000008811' $sql$,
  'Aislamiento: el seller A NO ve la excepción del tipo nuevo pese a llevar su seller_id'
);

-- Test 16: tampoco por la tabla base (authenticated tiene SELECT sobre ella; la
-- barrera es la RLS, no la vista).
select is_empty(
  $sql$ select 1 from dinero.eventos_conciliacion $sql$,
  'Aislamiento: el seller A NO ve nada consultando dinero.eventos_conciliacion directo'
);

-- --- C.4 · Conductor: no ve la excepción que habla de su propio pago ----------
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000008815'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000008811'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000008811'::uuid -- d_a
);

-- Test 17: 0 filas filtrando por SU driver_id — la excepción dice que se le pagó
-- una entrega que no ocurrió y que su pago queda retenido; es material interno
-- del courier y el conductor no lo lee.
select is_empty(
  $sql$ select 1 from public.eventos_conciliacion
        where driver_id = 'aaaaaaaa-2222-0000-0000-000000008811' $sql$,
  'Aislamiento: el conductor A NO ve la excepción del tipo nuevo que apunta a su driver_id'
);

-- --- C.5 · Nadie autenticado escribe la bandeja ------------------------------
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000008811'::uuid, -- u_dueno_a (el rol MÁS privilegiado)
  'aaaaaaaa-0000-0000-0000-000000008811'::uuid, -- t_a
  'interno', 'dueno'
);

-- Test 18: ni siquiera el dueño puede levantar a mano una excepción del tipo
-- nuevo (ni, por el mismo REVOKE, quitarse el bloqueo de pago): la bandeja la
-- escribe solo service_role, desde los jobs.
select throws_ok(
  $sql$
    insert into dinero.eventos_conciliacion (tenant_id, driver_id, tipo_diferencia,
      descripcion, estado, categoria_negocio, accion_sugerida, bloquea_pago, motivo_bloqueo)
    values ('aaaaaaaa-0000-0000-0000-000000008811',
            'aaaaaaaa-2222-0000-0000-000000008811',
            'linea_liquidacion_sin_pedido_entregado',
            'FAKE inyectado por un usuario autenticado', 'pendiente',
            'fuga_ingreso', 'generar_ajuste_liquidacion', true, 'motivo cualquiera')
  $sql$,
  '42501',
  null,
  'Aislamiento: INSERT del tipo nuevo como authenticated falla con 42501 (solo service_role escribe)'
);

-- =============================================================================
-- Cierre
-- =============================================================================
select * from finish();

rollback;
