-- =============================================================================
-- Pruebas — identidad.courier_config_operacion (puesta en marcha v2)
-- Migración 20260928000003. Diseño: docs/ux/puesta-en-marcha-v2.md §3.6, §6, §8.
-- =============================================================================
-- Qué se demuestra contra un Postgres real:
--   1. Backfill: la MISMA función que corrió la migración marca completados a
--      los couriers existentes (con ofrece_flex derivado de sus conexiones ML),
--      no toca a un courier creado después del corte y no pisa filas.
--   2. Aislamiento A↔B en las DOS direcciones (tabla y vista espejo), con
--      contraprueba: cada dueño SÍ ve la suya.
--   3. Seller y conductor: cero filas, cero escritura.
--   4. Escritura por rol: dueño y supervisor sí; coordinador y administración
--      no; nadie en otro tenant; nadie borra; nadie mueve tenant_id.
--   5. Completar la puesta en marcha es solo del dueño, con autor = auth.uid()
--      y reloj del servidor, y no se deshace.
--   6. CHECK de horas (corte > salida) y rango del paso.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(39);

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
-- Fixtures (como postgres, bypass RLS).
--   A y B: couriers "existentes" (creados hace dos días) que YA OPERAN: cada uno
--          tiene una tarifa activa (el backfill solo marca a quien opera,
--          20260929000002). A además tiene una conexión ML; B no.
--   D:     courier "existente" pero VACÍO (sin bodega, tarifa ni pedidos): el
--          caso de producción que el primer backfill marcó por error.
--   C:     courier "nuevo" (creado ahora), a mitad de su puesta en marcha.
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-0000000c0f01';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-0000000c0f01';
  t_c uuid := 'cccccccc-0000-0000-0000-0000000c0f01';
  t_d uuid := 'dddddddd-0000-0000-0000-0000000c0f01';
  s_a uuid := 'aaaaaaaa-1111-0000-0000-0000000c0f01';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado, creado_en)
  values (t_a, 'Courier A', 'Courier A SpA', '76000001-1', 'activo',     now() - interval '2 days'),
         (t_b, 'Courier B', 'Courier B SpA', '76000002-K', 'activo',     now() - interval '2 days'),
         (t_c, 'Courier C', null,            '76000003-8', 'onboarding', now()),
         (t_d, 'Courier D', null,            '76000004-6', 'onboarding', now() - interval '2 days')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, estado)
  values (s_a, t_a, 'Seller A', '77000001-1', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conexiones_seller_ml (tenant_id, seller_id, ml_user_id)
  values (t_a, s_a, 990000001);

  -- A y B operan: una tarifa activa cada uno. D no tiene nada.
  insert into identidad.tarifas (tenant_id, tipo_entrega, monto_clp, monto_conductor_clp, vigente_desde)
  values (t_a, 'same_day', 3000, 2000, '2026-01-01'),
         (t_b, 'same_day', 3000, 2000, '2026-01-01');

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    ('cccccccc-2222-0000-0000-0000000c0f01', 'dueno.c@courier-c.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    ('cccccccc-2222-0000-0000-0000000c0f02', 'super.c@courier-c.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated');
end $$;

-- =============================================================================
-- 1. Backfill (misma función que usó la migración)
-- =============================================================================
select identidad.courier_config_operacion_marcar_existentes(now() - interval '1 hour');

select isnt(
  (select puesta_en_marcha_completada_en from identidad.courier_config_operacion
    where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0f01'),
  null,
  'backfill: courier existente A queda con la puesta en marcha completada'
);

select is(
  (select puesta_en_marcha_completada_por from identidad.courier_config_operacion
    where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0f01'),
  null,
  'backfill: sin autor humano (lo marcó la migración)'
);

select is(
  (select ofrece_flex from identidad.courier_config_operacion
    where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0f01'),
  true,
  'backfill: A tiene conexión ML ⇒ ofrece_flex = true'
);

select is(
  (select ofrece_flex from identidad.courier_config_operacion
    where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000c0f01'),
  false,
  'backfill: B sin conexión ML ni pedidos Flex ⇒ ofrece_flex = false'
);

select isnt(
  (select puesta_en_marcha_completada_en from identidad.courier_config_operacion
    where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000c0f01'),
  null,
  'backfill: courier existente B también queda completado'
);

select is_empty(
  $$ select 1 from identidad.courier_config_operacion
      where tenant_id = 'cccccccc-0000-0000-0000-0000000c0f01' $$,
  'backfill: el courier NUEVO (creado después del corte) no recibe fila ⇒ sigue bloqueado'
);

select is_empty(
  $$ select 1 from identidad.courier_config_operacion
      where tenant_id = 'dddddddd-0000-0000-0000-0000000c0f01' $$,
  'backfill: un courier EXISTENTE pero vacío (sin bodega, tarifa ni pedidos) no recibe fila ⇒ hace la puesta en marcha'
);

-- No pisa filas: se altera A a mano y se re-ejecuta el backfill.
update identidad.courier_config_operacion
   set ofrece_flex = false, hora_salida_reparto = '15:00'
 where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0f01';
select identidad.courier_config_operacion_marcar_existentes(now());
select results_eq(
  $$ select ofrece_flex, hora_salida_reparto from identidad.courier_config_operacion
      where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0f01' $$,
  $$ values (false, '15:00'::time) $$,
  'backfill re-ejecutado: no pisa una fila existente'
);
-- Se deja C sin fila para las pruebas de escritura: el segundo backfill (corte
-- = now(), y C se creó con now() en esta misma transacción) sí la habría creado.
delete from identidad.courier_config_operacion
 where tenant_id = 'cccccccc-0000-0000-0000-0000000c0f01';

-- Nadie fuera de postgres ejecuta el backfill.
select ok(
  not has_function_privilege('authenticated',
    'identidad.courier_config_operacion_marcar_existentes(timestamptz)', 'execute')
  and not has_function_privilege('service_role',
    'identidad.courier_config_operacion_marcar_existentes(timestamptz)', 'execute')
  and not has_function_privilege('anon',
    'identidad.courier_config_operacion_marcar_existentes(timestamptz)', 'execute'),
  'backfill: ni authenticated, ni anon, ni service_role pueden ejecutarlo'
);

-- =============================================================================
-- 2. Aislamiento A ↔ B (con contraprueba)
-- =============================================================================
select test_iniciar_sesion('aaaaaaaa-2222-0000-0000-0000000c0f01',
  'aaaaaaaa-0000-0000-0000-0000000c0f01', 'interno', 'dueno');

select results_eq(
  $$ select tenant_id from identidad.courier_config_operacion $$,
  $$ values ('aaaaaaaa-0000-0000-0000-0000000c0f01'::uuid) $$,
  'dueño A ve exactamente su fila (contraprueba: la ve)'
);
select is_empty(
  $$ select 1 from identidad.courier_config_operacion
      where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000c0f01' $$,
  'dueño A NO ve la fila de B, ni pidiéndola por id'
);
select results_eq(
  $$ select tenant_id from public.courier_config_operacion $$,
  $$ values ('aaaaaaaa-0000-0000-0000-0000000c0f01'::uuid) $$,
  'vista espejo: dueño A ve solo lo suyo'
);
select test_cerrar_sesion();

select test_iniciar_sesion('bbbbbbbb-2222-0000-0000-0000000c0f01',
  'bbbbbbbb-0000-0000-0000-0000000c0f01', 'interno', 'dueno');
select results_eq(
  $$ select tenant_id from identidad.courier_config_operacion $$,
  $$ values ('bbbbbbbb-0000-0000-0000-0000000c0f01'::uuid) $$,
  'dueño B ve exactamente su fila (dirección inversa)'
);
select is_empty(
  $$ select 1 from public.courier_config_operacion
      where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0f01' $$,
  'dueño B NO ve la fila de A por la vista espejo'
);
select test_cerrar_sesion();

-- Coordinador y administración LEEN (interno), aunque no escriban.
select test_iniciar_sesion('aaaaaaaa-2222-0000-0000-0000000c0f03',
  'aaaaaaaa-0000-0000-0000-0000000c0f01', 'interno', 'coordinador');
select results_eq(
  $$ select count(*)::int from identidad.courier_config_operacion $$,
  $$ values (1) $$,
  'coordinador A lee la fila de su courier'
);
select test_cerrar_sesion();

-- =============================================================================
-- 3. Seller y conductor: nada
-- =============================================================================
select test_iniciar_sesion('aaaaaaaa-3333-0000-0000-0000000c0f01',
  'aaaaaaaa-0000-0000-0000-0000000c0f01', 'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-0000000c0f01');
select is_empty($$ select 1 from identidad.courier_config_operacion $$,
  'seller A: cero filas en la tabla');
select is_empty($$ select 1 from public.courier_config_operacion $$,
  'seller A: cero filas en la vista espejo');
select results_eq(
  $$ with u as (update identidad.courier_config_operacion set ofrece_flex = true returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'seller A: UPDATE no alcanza ninguna fila'
);
select test_cerrar_sesion();

select test_iniciar_sesion('aaaaaaaa-4444-0000-0000-0000000c0f01',
  'aaaaaaaa-0000-0000-0000-0000000c0f01', 'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-5555-0000-0000-0000000c0f01');
select is_empty($$ select 1 from identidad.courier_config_operacion $$,
  'conductor A: cero filas');
select test_cerrar_sesion();

-- Escritura en C (sin fila todavía) por roles que no deben poder.
select test_iniciar_sesion('cccccccc-3333-0000-0000-0000000c0f01',
  'cccccccc-0000-0000-0000-0000000c0f01', 'seller', 'seller',
  p_seller_id => 'cccccccc-1111-0000-0000-0000000c0f01');
select throws_ok(
  $$ insert into identidad.courier_config_operacion (tenant_id) values ('cccccccc-0000-0000-0000-0000000c0f01') $$,
  '42501', null, 'seller C no puede crear la fila de su courier');
select test_cerrar_sesion();

select test_iniciar_sesion('cccccccc-4444-0000-0000-0000000c0f01',
  'cccccccc-0000-0000-0000-0000000c0f01', 'conductor', 'conductor',
  p_driver_id => 'cccccccc-5555-0000-0000-0000000c0f01');
select throws_ok(
  $$ insert into identidad.courier_config_operacion (tenant_id) values ('cccccccc-0000-0000-0000-0000000c0f01') $$,
  '42501', null, 'conductor C no puede crear la fila de su courier');
select test_cerrar_sesion();

-- =============================================================================
-- 4. Escritura por rol interno
-- =============================================================================
select test_iniciar_sesion('cccccccc-2222-0000-0000-0000000c0f03',
  'cccccccc-0000-0000-0000-0000000c0f01', 'interno', 'coordinador');
select throws_ok(
  $$ insert into identidad.courier_config_operacion (tenant_id) values ('cccccccc-0000-0000-0000-0000000c0f01') $$,
  '42501', null, 'coordinador C no escribe');
select test_cerrar_sesion();

select test_iniciar_sesion('cccccccc-2222-0000-0000-0000000c0f04',
  'cccccccc-0000-0000-0000-0000000c0f01', 'interno', 'administracion');
select throws_ok(
  $$ insert into identidad.courier_config_operacion (tenant_id) values ('cccccccc-0000-0000-0000-0000000c0f01') $$,
  '42501', null, 'administración C no escribe');
select test_cerrar_sesion();

-- Cross-tenant: el dueño de A intenta crear la fila de C.
select test_iniciar_sesion('aaaaaaaa-2222-0000-0000-0000000c0f01',
  'aaaaaaaa-0000-0000-0000-0000000c0f01', 'interno', 'dueno');
select throws_ok(
  $$ insert into identidad.courier_config_operacion (tenant_id) values ('cccccccc-0000-0000-0000-0000000c0f01') $$,
  '42501', null, 'dueño A no puede crear la fila de otro courier');
select test_cerrar_sesion();

-- Supervisor C crea la fila (paso 3) y ajusta el horario.
select test_iniciar_sesion('cccccccc-2222-0000-0000-0000000c0f02',
  'cccccccc-0000-0000-0000-0000000c0f01', 'interno', 'supervisor');
select lives_ok(
  $$ insert into identidad.courier_config_operacion (tenant_id, ofrece_flex, puesta_en_marcha_paso)
     values ('cccccccc-0000-0000-0000-0000000c0f01', true, 3) $$,
  'supervisor C crea la fila de su courier');
select results_eq(
  $$ with u as (update identidad.courier_config_operacion
                   set hora_salida_reparto = '16:30', hora_corte_reparto = '22:00'
                 where tenant_id = 'cccccccc-0000-0000-0000-0000000c0f01' returning 1)
     select count(*)::int from u $$,
  $$ values (1) $$,
  'supervisor C ajusta el horario de reparto');
select throws_ok(
  $$ update identidad.courier_config_operacion set puesta_en_marcha_completada_en = now()
      where tenant_id = 'cccccccc-0000-0000-0000-0000000c0f01' $$,
  '42501', null, 'supervisor C NO puede marcar la puesta en marcha completada');
select test_cerrar_sesion();

-- Coordinador C: UPDATE no alcanza la fila (RLS), y el valor no cambia.
select test_iniciar_sesion('cccccccc-2222-0000-0000-0000000c0f03',
  'cccccccc-0000-0000-0000-0000000c0f01', 'interno', 'coordinador');
select results_eq(
  $$ with u as (update identidad.courier_config_operacion set ofrece_shopify = true returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'coordinador C: UPDATE alcanza 0 filas');
select test_cerrar_sesion();

-- Dueño A intenta modificar la fila de C: 0 filas.
select test_iniciar_sesion('aaaaaaaa-2222-0000-0000-0000000c0f01',
  'aaaaaaaa-0000-0000-0000-0000000c0f01', 'interno', 'dueno');
select results_eq(
  $$ with u as (update identidad.courier_config_operacion set ofrece_shopify = true
                 where tenant_id = 'cccccccc-0000-0000-0000-0000000c0f01' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'dueño A: UPDATE sobre la fila de C alcanza 0 filas');
select test_cerrar_sesion();

select results_eq(
  $$ select ofrece_shopify, hora_salida_reparto, hora_corte_reparto
       from identidad.courier_config_operacion
      where tenant_id = 'cccccccc-0000-0000-0000-0000000c0f01' $$,
  $$ values (false, '16:30'::time, '22:00'::time) $$,
  'fila de C: solo quedaron los cambios del supervisor');

-- =============================================================================
-- 5. Completar: solo el dueño, autor y reloj del servidor, sin deshacer
-- =============================================================================
select test_iniciar_sesion('cccccccc-2222-0000-0000-0000000c0f01',
  'cccccccc-0000-0000-0000-0000000c0f01', 'interno', 'dueno');
select lives_ok(
  $$ update identidad.courier_config_operacion
        set puesta_en_marcha_completada_en = '2000-01-01',
            puesta_en_marcha_completada_por = 'cccccccc-2222-0000-0000-0000000c0f02',
            puesta_en_marcha_paso = 4
      where tenant_id = 'cccccccc-0000-0000-0000-0000000c0f01' $$,
  'dueño C completa la puesta en marcha');
select results_eq(
  $$ select puesta_en_marcha_completada_en, puesta_en_marcha_completada_por
       from identidad.courier_config_operacion
      where tenant_id = 'cccccccc-0000-0000-0000-0000000c0f01' $$,
  $$ values (now(), 'cccccccc-2222-0000-0000-0000000c0f01'::uuid) $$,
  'el autor es auth.uid() y el instante es del servidor, no los que mandó el cliente');
select throws_ok(
  $$ update identidad.courier_config_operacion set puesta_en_marcha_completada_en = null,
            puesta_en_marcha_completada_por = null
      where tenant_id = 'cccccccc-0000-0000-0000-0000000c0f01' $$,
  '42501', null, 'la puesta en marcha completada no se deshace desde una sesión');
select throws_ok(
  $$ delete from identidad.courier_config_operacion
      where tenant_id = 'cccccccc-0000-0000-0000-0000000c0f01' $$,
  '42501', null, 'nadie borra la fila desde una sesión (re-bloquearía al courier)');
select throws_ok(
  $$ update identidad.courier_config_operacion set tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0f01'
      where tenant_id = 'cccccccc-0000-0000-0000-0000000c0f01' $$,
  '42501', null, 'tenant_id no se puede mover (fuera del grant de UPDATE)');
select test_cerrar_sesion();

-- anon: nada.
set local role anon;
select throws_ok($$ select 1 from identidad.courier_config_operacion $$,
  '42501', null, 'anon no lee la tabla');
reset role;

-- =============================================================================
-- 6. CHECKs (como postgres: la restricción vale para todos, service_role incluido)
-- =============================================================================
select throws_ok(
  $$ update identidad.courier_config_operacion set hora_corte_reparto = hora_salida_reparto
      where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000c0f01' $$,
  '23514', null, 'CHECK: corte igual a la salida se rechaza');
select throws_ok(
  $$ update identidad.courier_config_operacion
        set hora_salida_reparto = '16:00', hora_corte_reparto = '06:00'
      where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000c0f01' $$,
  '23514', null, 'CHECK: corte antes de la salida se rechaza');
select throws_ok(
  $$ update identidad.courier_config_operacion set puesta_en_marcha_paso = 5
      where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000c0f01' $$,
  '23514', null, 'CHECK: paso fuera de 0–4 se rechaza');

select * from finish();
rollback;
