-- =============================================================================
-- Traspaso entre conductores (etapa 9) — aislamiento y reja
-- =============================================================================
-- `operacion.traspasar_pedidos_a_conductor` corre con SECURITY DEFINER, o sea
-- SIN RLS debajo: el texto de la función ES la única barrera. Por eso lo que se
-- prueba acá no es una política, son los `.eq(tenant_id)` de cada JOIN.
--
-- Y hay un motivo por el que el canario habitual no basta: en el traspaso
-- intervienen DOS conductores. El de origen no lo elige quien llama, así que un
-- error de filtro no se manifiesta como "no veo mis datos" sino como "muevo los
-- de otro courier" — silencioso, y con plata detrás.
--
--   1. La función no toca pedidos de otro courier: los omite como `ajeno`, sin
--      confirmar jamás que ese id existe.
--   2. Un receptor de otro courier da P0002, indistinguible de "no existe".
--   3. La reja: solo `asignado`/`en_ruta` CON asignación activa de OTRO.
--   4. El re-escaneo (`ya_mio`) no es un fallo — viene de un escáner, donde
--      escanear dos veces es lo normal.
--   5. Queda exactamente UNA asignación activa por pedido, siempre.
--   6. El estado del pedido NO se toca.
--   7. `authenticated` no puede ejecutar la función ni conociendo la firma.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(14);

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
      'sub', p_user_id, 'role', 'authenticated', 'tenant_id', p_tenant_id,
      'tipo_usuario', p_tipo_usuario, 'seller_id', p_seller_id,
      'driver_id', p_driver_id, 'rol', p_rol
    )::text,
    true
  );
end;
$$;

create or replace function test_cerrar_sesion() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
end;
$$;

-- -----------------------------------------------------------------------------
-- Fixtures. Courier A con Juan y Pedro; courier B con su conductor y su pedido.
-- El pedido de B existe para que el cruce tenga algo REAL que no tocar: probar
-- con un uuid inventado no distingue "aisló bien" de "no encontró nada".
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-00000000e901';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-00000000e901';
  s_a uuid := 'aaaaaaaa-1111-0000-0000-00000000e901';
  s_b uuid := 'bbbbbbbb-1111-0000-0000-00000000e901';
  juan  uuid := 'aaaaaaaa-4444-0000-0000-00000000e901';
  pedro uuid := 'aaaaaaaa-4444-0000-0000-00000000e902';
  d_b   uuid := 'bbbbbbbb-4444-0000-0000-00000000e901';
  man_juan uuid := 'aaaaaaaa-5555-0000-0000-00000000e901';
  man_b    uuid := 'bbbbbbbb-5555-0000-0000-00000000e901';
  ped_1 uuid := 'aaaaaaaa-6666-0000-0000-00000000e901';  -- en_ruta, de Juan
  ped_2 uuid := 'aaaaaaaa-6666-0000-0000-00000000e902';  -- entregado, de Juan
  ped_3 uuid := 'aaaaaaaa-6666-0000-0000-00000000e903';  -- sin asignación
  ped_b uuid := 'bbbbbbbb-6666-0000-0000-00000000e901';  -- del courier B
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values (t_a,'Courier A','Courier A SpA','76900001-1','activo'),
         (t_b,'Courier B','Courier B SpA','76900002-K','activo')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, estado)
  values (s_a,t_a,'Seller A','77900001-1','activo'),
         (s_b,t_b,'Seller B','77900002-K','activo')
  on conflict (id) do nothing;

  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values (juan, t_a,'Juan Perez','19111111-1','dependiente','activo'),
         (pedro,t_a,'Pedro Soto','19222222-2','dependiente','activo'),
         (d_b,  t_b,'Conductor B','19333333-3','dependiente','activo')
  on conflict (id) do nothing;

  insert into operacion.manifiestos (id, tenant_id, driver_id, nombre, fecha_operacion, estado)
  values (man_juan, t_a, juan, 'Ruta Juan', current_date, 'en_ruta'),
         (man_b,    t_b, d_b,  'Ruta B',    current_date, 'en_ruta')
  on conflict (id) do nothing;

  insert into operacion.pedidos
    (id, tenant_id, seller_id, tipo_pedido, origen, estado, situacion_retiro,
     destinatario_nombre, destinatario_direccion, destinatario_comuna, fecha_compromiso)
  values
    (ped_1, t_a, s_a, 'same_day', 'same_day_manual', 'en_ruta',   'retirado', 'Dest 1','Calle 1','Maipú', current_date),
    (ped_2, t_a, s_a, 'same_day', 'same_day_manual', 'entregado', 'retirado', 'Dest 2','Calle 2','Maipú', current_date),
    (ped_3, t_a, s_a, 'same_day', 'same_day_manual', 'en_ruta',   'retirado', 'Dest 3','Calle 3','Maipú', current_date),
    (ped_b, t_b, s_b, 'same_day', 'same_day_manual', 'en_ruta',   'retirado', 'Dest B','Calle B','Maipú', current_date)
  on conflict (id) do nothing;

  -- ped_1 y ped_2 son de Juan; ped_3 queda SIN asignación a propósito.
  insert into operacion.asignaciones_pedido
    (tenant_id, pedido_id, manifiesto_id, driver_id, seller_id, activa, asignado_en)
  values (t_a, ped_1, man_juan, juan, s_a, true, now()),
         (t_a, ped_2, man_juan, juan, s_a, true, now()),
         (t_b, ped_b, man_b,    d_b,  s_b, true, now());
end $$;

-- =============================================================================
-- 1. El cruce entre couriers — lo que esta función NO puede hacer
-- =============================================================================
select is(
  (select total_traspasados from operacion.traspasar_pedidos_a_conductor(
     'aaaaaaaa-0000-0000-0000-00000000e901'::uuid,
     'aaaaaaaa-4444-0000-0000-00000000e902'::uuid,
     current_date,
     array['bbbbbbbb-6666-0000-0000-00000000e901'::uuid],
     null)),
  0,
  'Pedro (courier A) NO puede traspasarse un pedido REAL del courier B'
);

select is(
  (select omitidos_ajenos from operacion.traspasar_pedidos_a_conductor(
     'aaaaaaaa-0000-0000-0000-00000000e901'::uuid,
     'aaaaaaaa-4444-0000-0000-00000000e902'::uuid,
     current_date,
     array['bbbbbbbb-6666-0000-0000-00000000e901'::uuid],
     null)),
  1,
  'Y se reporta como ajeno — el mismo motivo que un id inexistente, sin confirmar que existe'
);

select is(
  (select a.driver_id from operacion.asignaciones_pedido a
    where a.pedido_id = 'bbbbbbbb-6666-0000-0000-00000000e901'::uuid and a.activa),
  'bbbbbbbb-4444-0000-0000-00000000e901'::uuid,
  'La asignación del courier B quedó intacta tras el intento de cruce'
);

select throws_ok(
  $$select * from operacion.traspasar_pedidos_a_conductor(
      'aaaaaaaa-0000-0000-0000-00000000e901'::uuid,
      'bbbbbbbb-4444-0000-0000-00000000e901'::uuid,
      current_date,
      array['aaaaaaaa-6666-0000-0000-00000000e901'::uuid],
      null)$$,
  'P0002',
  null,
  'Un receptor de OTRO courier da P0002 — indistinguible de "no existe"'
);

-- =============================================================================
-- 2. La reja
-- =============================================================================
select is(
  (select omitidos_estado_no_traspasable from operacion.traspasar_pedidos_a_conductor(
     'aaaaaaaa-0000-0000-0000-00000000e901'::uuid,
     'aaaaaaaa-4444-0000-0000-00000000e902'::uuid,
     current_date,
     array['aaaaaaaa-6666-0000-0000-00000000e902'::uuid],
     null)),
  1,
  'Un pedido ENTREGADO no se traspasa: ya no está en la calle'
);

select is(
  (select omitidos_sin_asignacion from operacion.traspasar_pedidos_a_conductor(
     'aaaaaaaa-0000-0000-0000-00000000e901'::uuid,
     'aaaaaaaa-4444-0000-0000-00000000e902'::uuid,
     current_date,
     array['aaaaaaaa-6666-0000-0000-00000000e903'::uuid],
     null)),
  1,
  'Un pedido SIN asignación activa se omite: no hay de quién recibirlo'
);

select is(
  (select a.id from operacion.asignaciones_pedido a
    where a.pedido_id = 'aaaaaaaa-6666-0000-0000-00000000e903'::uuid and a.activa),
  null,
  'Y NO se le asignó por la puerta de atrás: sigue sin asignación activa'
);

-- =============================================================================
-- 3. El camino feliz, y sus consecuencias exactas
-- =============================================================================
select is(
  (select total_traspasados from operacion.traspasar_pedidos_a_conductor(
     'aaaaaaaa-0000-0000-0000-00000000e901'::uuid,
     'aaaaaaaa-4444-0000-0000-00000000e902'::uuid,
     current_date,
     array['aaaaaaaa-6666-0000-0000-00000000e901'::uuid],
     null)),
  1,
  'Pedro recibe el pedido en_ruta que tenía Juan'
);

select is(
  (select count(*)::int from operacion.asignaciones_pedido a
    where a.pedido_id = 'aaaaaaaa-6666-0000-0000-00000000e901'::uuid and a.activa),
  1,
  'Queda EXACTAMENTE una asignación activa — el unique parcial no se puede violar'
);

select is(
  (select a.driver_id from operacion.asignaciones_pedido a
    where a.pedido_id = 'aaaaaaaa-6666-0000-0000-00000000e901'::uuid and a.activa),
  'aaaaaaaa-4444-0000-0000-00000000e902'::uuid,
  'Y es de Pedro'
);

-- Lo que sostiene TODO el dinero: el trigger de asignaciones movió la columna
-- de la que el evento financiero saca a quién pagarle.
select is(
  (select p.driver_id_asignado from operacion.pedidos p
    where p.id = 'aaaaaaaa-6666-0000-0000-00000000e901'::uuid),
  'aaaaaaaa-4444-0000-0000-00000000e902'::uuid,
  'pedidos.driver_id_asignado siguió al traspaso — de esto depende a quién se le paga'
);

select is(
  (select p.estado::text from operacion.pedidos p
    where p.id = 'aaaaaaaa-6666-0000-0000-00000000e901'::uuid),
  'en_ruta',
  'El estado del pedido NO se tocó: el bulto sigue en la calle, solo cambió de manos'
);

-- Re-escaneo. Viene de un escáner: escanear dos veces es lo normal, no la excepción.
select is(
  (select omitidos_ya_mio from operacion.traspasar_pedidos_a_conductor(
     'aaaaaaaa-0000-0000-0000-00000000e901'::uuid,
     'aaaaaaaa-4444-0000-0000-00000000e902'::uuid,
     current_date,
     array['aaaaaaaa-6666-0000-0000-00000000e901'::uuid],
     null)),
  1,
  'Re-escanear el mismo bulto responde ya_mio, sin fallar ni duplicar'
);

-- =============================================================================
-- 4. `authenticated` no puede invocarla ni conociendo la firma
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-00000000e901'::uuid,
  'aaaaaaaa-0000-0000-0000-00000000e901'::uuid, 'conductor', 'conductor',
  null, 'aaaaaaaa-4444-0000-0000-00000000e902'::uuid);

select throws_ok(
  $$select * from operacion.traspasar_pedidos_a_conductor(
      'aaaaaaaa-0000-0000-0000-00000000e901'::uuid,
      'aaaaaaaa-4444-0000-0000-00000000e902'::uuid,
      current_date,
      array['aaaaaaaa-6666-0000-0000-00000000e901'::uuid],
      null)$$,
  '42501',
  null,
  'Un conductor autenticado NO puede ejecutar la función: solo service_role'
);

select test_cerrar_sesion();

select * from finish();
rollback;
