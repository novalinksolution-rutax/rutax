-- =============================================================================
-- Pruebas de aislamiento RLS — línea de liquidación por VISITA A BODEGA
-- (etapa 8 de "retiro + ruteo", migraciones 20260815000004 / 20260815000005)
-- =============================================================================
-- La etapa 8 hizo `dinero.lineas_liquidacion.pedido_id` NULLABLE. El argumento
-- para no crear una tabla aparte fue que la RLS de esa tabla filtra por tenant y
-- por conductor y NO menciona `pedido_id`, así que una línea sin pedido queda
-- aislada sin tocar una sola política.
--
-- Ese argumento estaba RAZONADO leyendo las políticas, no PROBADO. Este archivo
-- lo prueba contra un Postgres real, que es la diferencia entre creer y saber:
--
--   1. Un courier NO ve las líneas de retiro de otro. En las DOS direcciones —
--      una política mal escrita aísla en un sentido y no en el otro.
--   2. Un conductor ve SOLO sus propias líneas de retiro, nunca las de un
--      colega del mismo courier. Es el caso que más importa: la línea de retiro
--      dice cuánto le pagaron a quién.
--   3. Un SELLER ve CERO líneas de liquidación, de cualquier tipo. Lo que el
--      courier le paga a sus conductores no es asunto suyo.
--   4. Nadie escribe desde una sesión de usuario: la tabla no tiene políticas
--      de escritura y el INSERT falla con 42501.
--   5. La columna `tipo_hecho` es LEGIBLE por `authenticated`. Los privilegios
--      de esta tabla son POR COLUMNA, no por tabla: una columna nueva sin su
--      `grant select (…)` rompe la vista `public.*` ENTERA con "permission
--      denied", en ejecución y no al migrar.
--   6. Los invariantes estructurales: el CHECK cruzado, el unique parcial por
--      visita, y que la FK compuesta impide pagarle la visita de un conductor
--      a otro.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(18);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada (cada .test.sql corre en su propia transacción y
-- no ve los helpers de los demás).
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
      'sub', p_user_id,
      'role', 'authenticated',
      'tenant_id', p_tenant_id,
      'tipo_usuario', p_tipo_usuario,
      'seller_id', p_seller_id,
      'driver_id', p_driver_id,
      'rol', p_rol
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
-- Fixtures. Dos couriers, cada uno con su seller, su bodega y sus conductores.
-- Tenant A tiene DOS conductores a propósito: sin el segundo no se puede probar
-- que un conductor no ve las líneas de su colega, que es la fuga más probable.
-- Se insertan como `postgres` (superusuario: bypassa RLS).
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-00000000ff01';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-00000000ff01';

  s_a uuid := 'aaaaaaaa-1111-0000-0000-00000000ff01';
  s_b uuid := 'bbbbbbbb-1111-0000-0000-00000000ff01';

  d_a1 uuid := 'aaaaaaaa-4444-0000-0000-00000000ff01';
  d_a2 uuid := 'aaaaaaaa-4444-0000-0000-00000000ff02';
  d_b1 uuid := 'bbbbbbbb-4444-0000-0000-00000000ff01';

  bod_a uuid := 'aaaaaaaa-9999-0000-0000-00000000ff01';
  bod_b uuid := 'bbbbbbbb-9999-0000-0000-00000000ff01';

  ses_a1 uuid := 'aaaaaaaa-7777-0000-0000-00000000ff01';
  ses_a2 uuid := 'aaaaaaaa-7777-0000-0000-00000000ff02';
  ses_b1 uuid := 'bbbbbbbb-7777-0000-0000-00000000ff01';
  -- Visita de A1 SIN linea generada: es la unica forma de probar la FK
  -- compuesta aislada. Con una visita que ya tiene linea salta primero el
  -- unique y la prueba pasa por el motivo equivocado (paso literalmente eso
  -- en la primera version de este archivo).
  ses_a3 uuid := 'aaaaaaaa-7777-0000-0000-00000000ff03';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values (t_a, 'Courier A', 'Courier A SpA', '76000001-1', 'activo'),
         (t_b, 'Courier B', 'Courier B SpA', '76000002-K', 'activo')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, estado)
  values (s_a, t_a, 'Seller A', '77000001-1', 'activo'),
         (s_b, t_b, 'Seller B', '77000002-K', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values (d_a1, t_a, 'Conductor A1', '11111111-1', 'dependiente', 'activo'),
         (d_a2, t_a, 'Conductor A2', '22222222-2', 'dependiente', 'activo'),
         (d_b1, t_b, 'Conductor B1', '33333333-3', 'dependiente', 'activo')
  on conflict (id) do nothing;

  insert into identidad.seller_bodegas (id, tenant_id, seller_id, nombre, direccion, comuna)
  values (bod_a, t_a, s_a, 'Bodega A', 'Av. Uno 100', 'Quilicura'),
         (bod_b, t_b, s_b, 'Bodega B', 'Av. Dos 200', 'Maipú')
  on conflict (id) do nothing;

  insert into operacion.sesiones_retiro
    (id, tenant_id, bodega_id, seller_id, conductor_id, fecha_operacion, estado, cerrada_en,
     bultos_total, bultos_resueltos, bultos_sin_resolver)
  values
    (ses_a1, t_a, bod_a, s_a, d_a1, current_date, 'cerrada', now(), 10, 10, 0),
    (ses_a2, t_a, bod_a, s_a, d_a2, current_date, 'cerrada', now(), 5, 5, 0),
    (ses_b1, t_b, bod_b, s_b, d_b1, current_date, 'cerrada', now(), 7, 7, 0),
    (ses_a3, t_a, bod_a, s_a, d_a1, current_date, 'cerrada', now(), 3, 3, 0)
  on conflict (id) do nothing;

  -- Una línea de retiro por conductor. `pedido_id` NULL — el caso nuevo.
  insert into dinero.lineas_liquidacion
    (tenant_id, driver_id, pedido_id, sesion_retiro_id, tipo_hecho,
     monto_base_clp, concepto, fecha_hecho)
  values
    (t_a, d_a1, null, ses_a1, 'retiro_bodega', 3000, 'Retiro bodega A · 10 bultos', current_date),
    (t_a, d_a2, null, ses_a2, 'retiro_bodega', 3000, 'Retiro bodega A · 5 bultos', current_date),
    (t_b, d_b1, null, ses_b1, 'retiro_bodega', 4000, 'Retiro bodega B · 7 bultos', current_date);
end $$;

-- =============================================================================
-- 1. Aislamiento entre couriers — EN LAS DOS DIRECCIONES
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-00000000ff01'::uuid,
  'aaaaaaaa-0000-0000-0000-00000000ff01'::uuid, 'interno', 'dueno');

select is(
  (select count(*)::int from public.lineas_liquidacion where tipo_hecho = 'retiro_bodega'),
  2,
  'Interno del courier A ve las 2 líneas de retiro de SU courier'
);

select is(
  (select count(*)::int from public.lineas_liquidacion
    where tenant_id = 'bbbbbbbb-0000-0000-0000-00000000ff01'::uuid),
  0,
  'Interno del courier A ve CERO líneas del courier B'
);

select test_cerrar_sesion();

select test_iniciar_sesion(
  'bbbbbbbb-3333-0000-0000-00000000ff01'::uuid,
  'bbbbbbbb-0000-0000-0000-00000000ff01'::uuid, 'interno', 'dueno');

select is(
  (select count(*)::int from public.lineas_liquidacion where tipo_hecho = 'retiro_bodega'),
  1,
  'Interno del courier B ve solo SU línea de retiro (dirección inversa)'
);

select is(
  (select count(*)::int from public.lineas_liquidacion
    where tenant_id = 'aaaaaaaa-0000-0000-0000-00000000ff01'::uuid),
  0,
  'Interno del courier B ve CERO del courier A — el aislamiento va en ambos sentidos'
);

select test_cerrar_sesion();

-- =============================================================================
-- 2. Conductor: solo lo suyo. La línea de retiro dice cuánto le pagaron a quién.
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-00000000ff02'::uuid,
  'aaaaaaaa-0000-0000-0000-00000000ff01'::uuid, 'conductor', 'conductor',
  null, 'aaaaaaaa-4444-0000-0000-00000000ff01'::uuid);

select is(
  (select count(*)::int from public.lineas_liquidacion),
  1,
  'Conductor A1 ve exactamente 1 línea: la suya'
);

select is(
  (select driver_id from public.lineas_liquidacion limit 1),
  'aaaaaaaa-4444-0000-0000-00000000ff01'::uuid,
  'Y esa línea es efectivamente la de A1, no la de su colega'
);

select is(
  (select count(*)::int from public.lineas_liquidacion
    where driver_id = 'aaaaaaaa-4444-0000-0000-00000000ff02'::uuid),
  0,
  'Conductor A1 ve CERO líneas de retiro de su colega A2 del mismo courier'
);

select test_cerrar_sesion();

-- =============================================================================
-- 3. Seller: cero. Lo que el courier le paga a sus conductores no es suyo.
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-00000000ff03'::uuid,
  'aaaaaaaa-0000-0000-0000-00000000ff01'::uuid, 'seller', 'seller',
  'aaaaaaaa-1111-0000-0000-00000000ff01'::uuid);

select is(
  (select count(*)::int from public.lineas_liquidacion),
  0,
  'El seller ve CERO líneas de liquidación, aunque las visitas sean a SU bodega'
);

select test_cerrar_sesion();

-- =============================================================================
-- 4. Escritura: nadie, desde una sesión de usuario
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-00000000ff01'::uuid,
  'aaaaaaaa-0000-0000-0000-00000000ff01'::uuid, 'interno', 'dueno');

select throws_ok(
  $$insert into public.lineas_liquidacion
      (tenant_id, driver_id, pedido_id, sesion_retiro_id, tipo_hecho,
       monto_base_clp, concepto, fecha_hecho)
    values ('aaaaaaaa-0000-0000-0000-00000000ff01'::uuid,
            'aaaaaaaa-4444-0000-0000-00000000ff01'::uuid, null,
            'aaaaaaaa-7777-0000-0000-00000000ff01'::uuid, 'retiro_bodega',
            9999, 'inyectada', current_date)$$,
  '42501',
  null,
  'Ni el dueño puede INSERTAR una línea de retiro: la escritura es solo de service_role'
);

select test_cerrar_sesion();

-- =============================================================================
-- 5. `tipo_hecho` legible por `authenticated` — los grants son POR COLUMNA
-- =============================================================================
-- Sin su `grant select (tipo_hecho)` la vista public.* entera devolvería
-- "permission denied", en ejecución y no al migrar. El SELECT explícito de las
-- dos columnas nuevas es la prueba directa.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-00000000ff01'::uuid,
  'aaaaaaaa-0000-0000-0000-00000000ff01'::uuid, 'interno', 'dueno');

select lives_ok(
  $$select tipo_hecho, sesion_retiro_id from public.lineas_liquidacion$$,
  'tipo_hecho y sesion_retiro_id son legibles por authenticated (grant por columna al día)'
);

select test_cerrar_sesion();

-- =============================================================================
-- 6. Invariantes estructurales
-- =============================================================================
select throws_ok(
  $$insert into dinero.lineas_liquidacion
      (tenant_id, driver_id, pedido_id, sesion_retiro_id, tipo_hecho,
       monto_base_clp, concepto, fecha_hecho)
    values ('aaaaaaaa-0000-0000-0000-00000000ff01'::uuid,
            'aaaaaaaa-4444-0000-0000-00000000ff01'::uuid, null, null, 'entrega',
            3000, 'entrega sin pedido', current_date)$$,
  '23514',
  null,
  'Una línea de ENTREGA sin pedido es imposible (CHECK cruzado)'
);

select throws_ok(
  $$insert into dinero.lineas_liquidacion
      (tenant_id, driver_id, pedido_id, sesion_retiro_id, tipo_hecho,
       monto_base_clp, concepto, fecha_hecho)
    values ('aaaaaaaa-0000-0000-0000-00000000ff01'::uuid,
            'aaaaaaaa-4444-0000-0000-00000000ff01'::uuid, null,
            'aaaaaaaa-7777-0000-0000-00000000ff01'::uuid, 'retiro_bodega',
            3000, 'segunda linea de la misma visita', current_date)$$,
  '23505',
  null,
  'Una visita no puede generar DOS líneas (unique parcial por sesion_retiro_id)'
);

-- La FK compuesta: pagarle la visita de A1 al conductor A2.
select throws_ok(
  $$insert into dinero.lineas_liquidacion
      (tenant_id, driver_id, pedido_id, sesion_retiro_id, tipo_hecho,
       monto_base_clp, concepto, fecha_hecho)
    values ('aaaaaaaa-0000-0000-0000-00000000ff01'::uuid,
            'aaaaaaaa-4444-0000-0000-00000000ff02'::uuid, null,
            'aaaaaaaa-7777-0000-0000-00000000ff03'::uuid, 'retiro_bodega',
            3000, 'visita ajena', current_date)$$,
  '23503',
  null,
  'No se le puede pagar a un conductor la visita que hizo OTRO (FK compuesta)'
);

-- =============================================================================
-- 7. La forma del índice: que sea PARCIAL, no solo que exista
-- =============================================================================
-- Un unique simple sobre `pedido_id` haría imposible una segunda línea de
-- retiro (todas tienen pedido_id NULL... que en Postgres no colisiona), pero
-- sobre todo dejaría de proteger lo que debe. Se afirma el predicado.
select is(
  (select count(*)::int from pg_index i
     join pg_class c on c.oid = i.indexrelid
    where c.relname = 'lineas_liq_pedido_entrega_uk'
      and i.indisunique and i.indpred is not null),
  1,
  'lineas_liq_pedido_entrega_uk existe, es único y es PARCIAL'
);

select ok(
  (select indexdef ilike '%tipo_hecho = ''entrega''%'
     from pg_indexes where indexname = 'lineas_liq_pedido_entrega_uk'),
  'Su predicado es tipo_hecho = ''entrega'' (no "pedido_id is not null")'
);

-- =============================================================================
-- 8. Los montos: cero prohibido en las dos capas de configuración
-- =============================================================================
-- Es la lección del 2026-08-15 (monto_conductor_clp con default 0 liquidando
-- $0 en silencio durante meses) convertida en constraint.
select throws_ok(
  $$insert into identidad.courier_config_retiro (tenant_id, monto_visita_bodega_clp)
    values ('aaaaaaaa-0000-0000-0000-00000000ff01'::uuid, 0)$$,
  '23514',
  null,
  'El monto por visita del courier no puede ser 0'
);

select throws_ok(
  $$update identidad.seller_bodegas set monto_visita_clp = 0
     where id = 'aaaaaaaa-9999-0000-0000-00000000ff01'::uuid$$,
  '23514',
  null,
  'El override por bodega tampoco puede ser 0'
);

select lives_ok(
  $$update identidad.seller_bodegas set monto_visita_clp = null
     where id = 'aaaaaaaa-9999-0000-0000-00000000ff01'::uuid$$,
  'Pero NULL sí se permite: significa "hereda del courier", no "gratis"'
);

select * from finish();
rollback;
