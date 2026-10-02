-- =============================================================================
-- Pruebas — identidad.courier_perfil_comercial (registro v2, «Tu empresa»)
-- Migración 20261001000001.
-- =============================================================================
-- Qué se demuestra contra un Postgres real:
--   1. Aislamiento A↔B en las DOS direcciones (tabla y vista espejo), con
--      contraprueba: cada dueño SÍ ve la suya.
--   2. Seller y conductor: cero filas, cero escritura.
--   3. Escritura por rol: dueño y administración sí; coordinador y supervisor
--      no; nadie en otro tenant; nadie borra; nadie mueve tenant_id; el autor
--      lo fija el servidor.
--   4. Cada CHECK: valor fuera de lista (los tres), arreglo vacío, duplicados,
--      'otra' sin texto / texto en blanco, texto sin 'otra', texto > 80; y los
--      casos límite válidos (80 caracteres, todas las fuentes).
--   5. Las listas CHECK vigentes son EXACTAMENTE las decididas (set_eq sobre el
--      conjunto, nunca un conteo).
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(41);

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
--   A y B: couriers con perfil respondido.
--   C:     courier sin perfil todavía ("sin responder"), para las escrituras.
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-0000000c0c01';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-0000000c0c01';
  t_c uuid := 'cccccccc-0000-0000-0000-0000000c0c01';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values (t_a, 'Courier A', 'Courier A SpA', '76000001-1', 'activo'),
         (t_b, 'Courier B', 'Courier B SpA', '76000002-K', 'activo'),
         (t_c, 'Courier C', null,            '76000003-8', 'onboarding')
  on conflict (id) do nothing;

  insert into identidad.courier_perfil_comercial
    (tenant_id, envios_dia_rango, conductores_rango, fuentes_pedidos, fuente_otra)
  values (t_a, '100_300', '6_15', array['mercado_libre_flex', 'shopify'], null),
         (t_b, 'menos_100', '1_5', array['otra'], 'Instagram');

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    ('cccccccc-2222-0000-0000-0000000c0c01', 'dueno.c@perfil-c.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    ('cccccccc-2222-0000-0000-0000000c0c04', 'admin.c@perfil-c.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated');
end $$;

-- =============================================================================
-- 1. Aislamiento A ↔ B (con contraprueba)
-- =============================================================================
select test_iniciar_sesion('aaaaaaaa-2222-0000-0000-0000000c0c01',
  'aaaaaaaa-0000-0000-0000-0000000c0c01', 'interno', 'dueno');
select results_eq(
  $$ select tenant_id from identidad.courier_perfil_comercial $$,
  $$ values ('aaaaaaaa-0000-0000-0000-0000000c0c01'::uuid) $$,
  'dueño A ve exactamente su fila (contraprueba: la ve)');
select is_empty(
  $$ select 1 from identidad.courier_perfil_comercial
      where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000c0c01' $$,
  'dueño A NO ve la fila de B, ni pidiéndola por id');
select results_eq(
  $$ select tenant_id from public.courier_perfil_comercial $$,
  $$ values ('aaaaaaaa-0000-0000-0000-0000000c0c01'::uuid) $$,
  'vista espejo: dueño A ve solo lo suyo');
select results_eq(
  $$ with u as (update identidad.courier_perfil_comercial set conductores_rango = 'mas_40'
                 where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000c0c01' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'dueño A: UPDATE sobre la fila de B alcanza 0 filas');
select test_cerrar_sesion();

select test_iniciar_sesion('bbbbbbbb-2222-0000-0000-0000000c0c01',
  'bbbbbbbb-0000-0000-0000-0000000c0c01', 'interno', 'dueno');
select results_eq(
  $$ select tenant_id from identidad.courier_perfil_comercial $$,
  $$ values ('bbbbbbbb-0000-0000-0000-0000000c0c01'::uuid) $$,
  'dueño B ve exactamente su fila (dirección inversa)');
select is_empty(
  $$ select 1 from public.courier_perfil_comercial
      where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0c01' $$,
  'dueño B NO ve la fila de A por la vista espejo');
select test_cerrar_sesion();

select results_eq(
  $$ select conductores_rango from identidad.courier_perfil_comercial
      where tenant_id = 'bbbbbbbb-0000-0000-0000-0000000c0c01' $$,
  $$ values ('1_5'::text) $$,
  'la fila de B sigue intacta tras el intento de A');

-- Coordinador y supervisor LEEN (interno), aunque no escriban.
select test_iniciar_sesion('aaaaaaaa-2222-0000-0000-0000000c0c03',
  'aaaaaaaa-0000-0000-0000-0000000c0c01', 'interno', 'coordinador');
select results_eq(
  $$ select count(*)::int from identidad.courier_perfil_comercial $$,
  $$ values (1) $$,
  'coordinador A lee la fila de su courier');
select test_cerrar_sesion();

select test_iniciar_sesion('aaaaaaaa-2222-0000-0000-0000000c0c02',
  'aaaaaaaa-0000-0000-0000-0000000c0c01', 'interno', 'supervisor');
select results_eq(
  $$ select count(*)::int from identidad.courier_perfil_comercial $$,
  $$ values (1) $$,
  'supervisor A lee la fila de su courier');
select results_eq(
  $$ with u as (update identidad.courier_perfil_comercial set conductores_rango = 'mas_40' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'supervisor A: UPDATE alcanza 0 filas');
select test_cerrar_sesion();

select test_iniciar_sesion('aaaaaaaa-2222-0000-0000-0000000c0c03',
  'aaaaaaaa-0000-0000-0000-0000000c0c01', 'interno', 'coordinador');
select results_eq(
  $$ with u as (update identidad.courier_perfil_comercial set conductores_rango = 'mas_40' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'coordinador A: UPDATE alcanza 0 filas');
select test_cerrar_sesion();

-- =============================================================================
-- 2. Seller y conductor: nada
-- =============================================================================
select test_iniciar_sesion('aaaaaaaa-3333-0000-0000-0000000c0c01',
  'aaaaaaaa-0000-0000-0000-0000000c0c01', 'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-0000000c0c01');
select is_empty($$ select 1 from identidad.courier_perfil_comercial $$,
  'seller A: cero filas en la tabla');
select is_empty($$ select 1 from public.courier_perfil_comercial $$,
  'seller A: cero filas en la vista espejo');
select results_eq(
  $$ with u as (update identidad.courier_perfil_comercial set conductores_rango = 'mas_40' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'seller A: UPDATE no alcanza ninguna fila');
select test_cerrar_sesion();

select test_iniciar_sesion('aaaaaaaa-4444-0000-0000-0000000c0c01',
  'aaaaaaaa-0000-0000-0000-0000000c0c01', 'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-5555-0000-0000-0000000c0c01');
select is_empty($$ select 1 from identidad.courier_perfil_comercial $$,
  'conductor A: cero filas en la tabla');
select is_empty($$ select 1 from public.courier_perfil_comercial $$,
  'conductor A: cero filas en la vista espejo');
select test_cerrar_sesion();

-- Escritura en C (sin fila) por quien no debe poder.
select test_iniciar_sesion('cccccccc-3333-0000-0000-0000000c0c01',
  'cccccccc-0000-0000-0000-0000000c0c01', 'seller', 'seller',
  p_seller_id => 'cccccccc-1111-0000-0000-0000000c0c01');
select throws_ok(
  $$ insert into identidad.courier_perfil_comercial (tenant_id, envios_dia_rango, conductores_rango, fuentes_pedidos)
     values ('cccccccc-0000-0000-0000-0000000c0c01', 'menos_100', '1_5', array['vtex']) $$,
  '42501', null, 'seller C no puede crear el perfil de su courier');
select test_cerrar_sesion();

select test_iniciar_sesion('cccccccc-4444-0000-0000-0000000c0c01',
  'cccccccc-0000-0000-0000-0000000c0c01', 'conductor', 'conductor',
  p_driver_id => 'cccccccc-5555-0000-0000-0000000c0c01');
select throws_ok(
  $$ insert into identidad.courier_perfil_comercial (tenant_id, envios_dia_rango, conductores_rango, fuentes_pedidos)
     values ('cccccccc-0000-0000-0000-0000000c0c01', 'menos_100', '1_5', array['vtex']) $$,
  '42501', null, 'conductor C no puede crear el perfil de su courier');
select test_cerrar_sesion();

-- =============================================================================
-- 3. Escritura por rol interno
-- =============================================================================
select test_iniciar_sesion('cccccccc-2222-0000-0000-0000000c0c03',
  'cccccccc-0000-0000-0000-0000000c0c01', 'interno', 'coordinador');
select throws_ok(
  $$ insert into identidad.courier_perfil_comercial (tenant_id, envios_dia_rango, conductores_rango, fuentes_pedidos)
     values ('cccccccc-0000-0000-0000-0000000c0c01', 'menos_100', '1_5', array['vtex']) $$,
  '42501', null, 'coordinador C no escribe');
select test_cerrar_sesion();

select test_iniciar_sesion('cccccccc-2222-0000-0000-0000000c0c02',
  'cccccccc-0000-0000-0000-0000000c0c01', 'interno', 'supervisor');
select throws_ok(
  $$ insert into identidad.courier_perfil_comercial (tenant_id, envios_dia_rango, conductores_rango, fuentes_pedidos)
     values ('cccccccc-0000-0000-0000-0000000c0c01', 'menos_100', '1_5', array['vtex']) $$,
  '42501', null, 'supervisor C no escribe');
select test_cerrar_sesion();

-- Cross-tenant: el dueño de A intenta crear el perfil de C.
select test_iniciar_sesion('aaaaaaaa-2222-0000-0000-0000000c0c01',
  'aaaaaaaa-0000-0000-0000-0000000c0c01', 'interno', 'dueno');
select throws_ok(
  $$ insert into identidad.courier_perfil_comercial (tenant_id, envios_dia_rango, conductores_rango, fuentes_pedidos)
     values ('cccccccc-0000-0000-0000-0000000c0c01', 'menos_100', '1_5', array['vtex']) $$,
  '42501', null, 'dueño A no puede crear el perfil de otro courier');
select test_cerrar_sesion();

-- Dueño C crea su perfil; el autor lo fija el servidor, no el cliente.
select test_iniciar_sesion('cccccccc-2222-0000-0000-0000000c0c01',
  'cccccccc-0000-0000-0000-0000000c0c01', 'interno', 'dueno');
select lives_ok(
  $$ insert into identidad.courier_perfil_comercial (tenant_id, envios_dia_rango, conductores_rango, fuentes_pedidos)
     values ('cccccccc-0000-0000-0000-0000000c0c01', 'aun_no_opera', '1_5', array['mercado_libre_flex']) $$,
  'dueño C crea el perfil de su courier');
select results_eq(
  $$ select actualizado_por from identidad.courier_perfil_comercial $$,
  $$ values ('cccccccc-2222-0000-0000-0000000c0c01'::uuid) $$,
  'actualizado_por = auth.uid() del dueño');
select throws_ok(
  $$ update identidad.courier_perfil_comercial set actualizado_por = 'cccccccc-2222-0000-0000-0000000c0c04' $$,
  '42501', null, 'actualizado_por no se escribe desde sesión (fuera del grant)');
select throws_ok(
  $$ update identidad.courier_perfil_comercial set tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0c01'
      where tenant_id = 'cccccccc-0000-0000-0000-0000000c0c01' $$,
  '42501', null, 'tenant_id no se puede mover (fuera del grant de UPDATE)');
select throws_ok(
  $$ delete from identidad.courier_perfil_comercial
      where tenant_id = 'cccccccc-0000-0000-0000-0000000c0c01' $$,
  '42501', null, 'nadie borra el perfil desde una sesión');
select test_cerrar_sesion();

-- Administración C actualiza.
select test_iniciar_sesion('cccccccc-2222-0000-0000-0000000c0c04',
  'cccccccc-0000-0000-0000-0000000c0c01', 'interno', 'administracion');
select results_eq(
  $$ with u as (update identidad.courier_perfil_comercial
                   set envios_dia_rango = '300_1000',
                       fuentes_pedidos = array['falabella', 'otra'],
                       fuente_otra = 'Tienda propia en Instagram'
                 where tenant_id = 'cccccccc-0000-0000-0000-0000000c0c01' returning 1)
     select count(*)::int from u $$,
  $$ values (1) $$,
  'administración C actualiza el perfil');
select test_cerrar_sesion();

select results_eq(
  $$ select envios_dia_rango, fuentes_pedidos, fuente_otra, actualizado_por
       from identidad.courier_perfil_comercial
      where tenant_id = 'cccccccc-0000-0000-0000-0000000c0c01' $$,
  $$ values ('300_1000'::text, array['falabella', 'otra']::text[],
             'Tienda propia en Instagram'::text, 'cccccccc-2222-0000-0000-0000000c0c04'::uuid) $$,
  'fila de C: cambios de administración, con su autor');

-- El grant por columna, mirado directo: la prueba de comportamiento de arriba
-- también pasaría solo por la RLS (WITH CHECK / SELECT sobre la fila nueva
-- lanzan 42501 igual), así que sin esto el grant podría ensancharse sin aviso.
select ok(
  not has_column_privilege('authenticated', 'identidad.courier_perfil_comercial', 'tenant_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'identidad.courier_perfil_comercial', 'actualizado_por', 'UPDATE')
  and not has_column_privilege('authenticated', 'identidad.courier_perfil_comercial', 'actualizado_por', 'INSERT')
  and not has_column_privilege('authenticated', 'identidad.courier_perfil_comercial', 'creado_en', 'INSERT')
  and not has_column_privilege('authenticated', 'identidad.courier_perfil_comercial', 'actualizado_en', 'UPDATE')
  and not has_table_privilege('authenticated', 'identidad.courier_perfil_comercial', 'DELETE')
  and not has_table_privilege('authenticated', 'public.courier_perfil_comercial', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('anon', 'identidad.courier_perfil_comercial', 'SELECT'),
  'grants: tenant_id, autor y marcas de tiempo fuera de la escritura; sin DELETE; vista de solo lectura; anon sin nada');

-- anon: nada.
set local role anon;
select throws_ok($$ select 1 from identidad.courier_perfil_comercial $$,
  '42501', null, 'anon no lee la tabla');
reset role;

-- =============================================================================
-- 4. CHECKs (como postgres: la restricción vale para todos)
-- =============================================================================
select throws_ok(
  $$ update identidad.courier_perfil_comercial set envios_dia_rango = 'mil'
      where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0c01' $$,
  '23514', null, 'CHECK: envios_dia_rango fuera de lista');
select throws_ok(
  $$ update identidad.courier_perfil_comercial set conductores_rango = '0'
      where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0c01' $$,
  '23514', null, 'CHECK: conductores_rango fuera de lista');
select throws_ok(
  $$ update identidad.courier_perfil_comercial set fuentes_pedidos = array['amazon']
      where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0c01' $$,
  '23514', null, 'CHECK: fuente fuera de lista');
select throws_ok(
  $$ update identidad.courier_perfil_comercial set fuentes_pedidos = array[]::text[]
      where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0c01' $$,
  '23514', null, 'CHECK: arreglo vacío');
select throws_ok(
  $$ update identidad.courier_perfil_comercial set fuentes_pedidos = array['shopify', 'shopify']
      where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0c01' $$,
  '23514', null, 'CHECK: fuentes duplicadas');
select throws_ok(
  $$ update identidad.courier_perfil_comercial set fuentes_pedidos = array['otra'], fuente_otra = null
      where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0c01' $$,
  '23514', null, 'CHECK: ''otra'' sin texto');
select throws_ok(
  $$ update identidad.courier_perfil_comercial set fuentes_pedidos = array['otra'], fuente_otra = '   '
      where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0c01' $$,
  '23514', null, 'CHECK: ''otra'' con texto en blanco');
select throws_ok(
  $$ update identidad.courier_perfil_comercial set fuentes_pedidos = array['vtex'], fuente_otra = 'Instagram'
      where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0c01' $$,
  '23514', null, 'CHECK: texto sin ''otra''');
select throws_ok(
  $$ update identidad.courier_perfil_comercial set fuentes_pedidos = array['otra'], fuente_otra = repeat('x', 81)
      where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0c01' $$,
  '23514', null, 'CHECK: texto de 81 caracteres');
select lives_ok(
  $$ update identidad.courier_perfil_comercial
        set fuentes_pedidos = array['mercado_libre_flex','falabella','paris','ripley','shopify',
                                    'woocommerce','jumpseller','vtex','venta_directa','otra'],
            fuente_otra = repeat('x', 80)
      where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0c01' $$,
  'límite válido: todas las fuentes + texto de exactamente 80 caracteres');

-- =============================================================================
-- 5. Las listas vigentes son exactamente las decididas (set_eq, nunca conteo)
-- =============================================================================
-- Se ejercita cada valor permitido de los rangos: si uno desaparece de la
-- lista, su UPDATE falla y la consulta de abajo no lo devuelve.
create temporary table _rangos_ok (col text, valor text);
do $$
declare v text;
begin
  foreach v in array array['aun_no_opera','menos_100','100_300','300_1000','mas_1000'] loop
    begin
      update identidad.courier_perfil_comercial set envios_dia_rango = v
       where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0c01';
      insert into _rangos_ok values ('envios', v);
    exception when check_violation then null;
    end;
  end loop;
  foreach v in array array['1_5','6_15','16_40','mas_40'] loop
    begin
      update identidad.courier_perfil_comercial set conductores_rango = v
       where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000c0c01';
      insert into _rangos_ok values ('conductores', v);
    exception when check_violation then null;
    end;
  end loop;
end $$;
select set_eq(
  $$ select col, valor from _rangos_ok $$,
  $$ values ('envios','aun_no_opera'),('envios','menos_100'),('envios','100_300'),
            ('envios','300_1000'),('envios','mas_1000'),
            ('conductores','1_5'),('conductores','6_15'),('conductores','16_40'),
            ('conductores','mas_40') $$,
  'todos los valores decididos de los rangos son aceptados');

select * from finish();
rollback;
