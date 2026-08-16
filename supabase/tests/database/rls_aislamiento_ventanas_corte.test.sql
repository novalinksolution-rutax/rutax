-- =============================================================================
-- Pruebas de aislamiento RLS — zonas, zona_comunas, ventanas_corte y SLA (F7, ítem 1.2)
-- =============================================================================
-- Demuestra, contra una base Postgres real (no mocks de aplicación):
--   1. Aislamiento cross-tenant: el interno del tenant A NO ve zonas / zona_comunas
--      / ventanas_corte del tenant B.
--   2. zonas / zona_comunas / ventanas_corte son INTERNAS: seller y conductor ven
--      0 filas en SELECT y reciben 42501 en INSERT/UPDATE.
--   3. Las columnas nuevas de pedidos (corte_riesgo, sla_cumplido,
--      fecha_compromiso_hora) respetan P2: el seller las ve SOLO de sus pedidos,
--      no de otro seller ni de pedidos de otro tenant.
--   4. identidad.resolver_zona() devuelve la zona correcta y NULL si la comuna no
--      está mapeada (o pertenece a otro tenant).
--
-- Mecanismo idéntico a rls_aislamiento_operacion.test.sql / _geocoding.test.sql:
-- simulamos el JWT fijando `request.jwt.claims` y conmutando el rol a `authenticated`.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(20);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada (redefinidos aquí — cada .test.sql corre en su
-- propia transacción).
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
-- Fixtures: dos tenants (A y B). Tenant A tiene 2 sellers, 2 zonas con comunas
-- mapeadas y ventanas de corte. Tenant B tiene 1 zona/comuna/ventana para probar
-- aislamiento cross-tenant. Se insertan como `postgres` (bypassa RLS).
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';

  s_a  uuid := 'aaaaaaaa-1111-0000-0000-000000000001';
  s_a2 uuid := 'aaaaaaaa-1111-0000-0000-000000000003';
  s_b  uuid := 'bbbbbbbb-1111-0000-0000-000000000002';

  u_interno_a uuid := 'aaaaaaaa-3333-0000-0000-000000000001';
  u_seller_a  uuid := 'aaaaaaaa-3333-0000-0000-000000000003';

  z_a_centro  uuid := 'aaaaaaaa-7777-0000-0000-000000000001';
  z_a_oriente uuid := 'aaaaaaaa-7777-0000-0000-000000000002';
  z_b_centro  uuid := 'bbbbbbbb-7777-0000-0000-000000000001';

  -- Pedidos para probar P2 sobre las columnas de SLA.
  pedido_a1 uuid := 'aaaaaaaa-6666-0000-0000-000000000001'; -- seller A
  pedido_a3 uuid := 'aaaaaaaa-6666-0000-0000-000000000003'; -- seller A2
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier A', 'Courier A SpA', '76111111-1', 'activo'),
    (t_b, 'Courier B', 'Courier B SpA', '76222222-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_interno_a, 'interno.a@ventanas.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,  'seller.a@ventanas.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a,  t_a, 'Seller Uno A', '77111111-1', 'Contacto Uno A', 'uno.a@seller.test', 'activo'),
    (s_a2, t_a, 'Seller Dos A', '77222222-2', 'Contacto Dos A', 'dos.a@seller.test', 'activo'),
    (s_b,  t_b, 'Seller Uno B', '77333333-3', 'Contacto Uno B', 'uno.b@seller.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a, t_a, 'Interno A',        'interno', null, null, 'dueno',  'activo'),
    (u_seller_a,  t_a, 'Usuario Seller A', 'seller',  s_a,  null, 'seller', 'activo')
  on conflict (id) do nothing;

  -- Zonas
  insert into identidad.zonas (id, tenant_id, nombre, activa)
  values
    (z_a_centro,  t_a, 'Centro',  true),
    (z_a_oriente, t_a, 'Oriente', true),
    (z_b_centro,  t_b, 'Centro',  true)
  on conflict (id) do nothing;

  -- Mapeo comuna→zona
  insert into identidad.zona_comunas (tenant_id, zona_id, comuna)
  values
    (t_a, z_a_centro,  'santiago'),
    (t_a, z_a_oriente, 'las condes'),
    (t_b, z_b_centro,  'santiago')   -- misma comuna, distinto tenant → distinta zona
  on conflict (tenant_id, comuna) do nothing;

  -- Ventanas de corte: default del seller A (zona NULL) + override de zona Centro.
  insert into identidad.ventanas_corte
    (tenant_id, seller_id, zona_id, tipo_entrega, hora_corte, minutos_preparacion, minutos_ruta_estimado, sla_objetivo_pct, activa)
  values
    (t_a, s_a, null,       'same_day', '14:00', 30, 90, 97.00, true),  -- default del seller A
    (t_a, s_a, z_a_centro, 'same_day', '15:30', 20, 60, 98.50, true),  -- override Centro
    (t_b, s_b, null,       'same_day', '12:00', 30, 90, 95.00, true)   -- tenant B
  on conflict do nothing;

  -- Pedidos con columnas de SLA pobladas (como postgres, bypassa RLS).
  insert into operacion.pedidos (id, tenant_id, seller_id, tipo_pedido, fuente, origen,
    ml_shipment_id, estado, destinatario_nombre, destinatario_direccion, destinatario_comuna,
    fecha_compromiso_hora, corte_riesgo, sla_cumplido)
  values
    (pedido_a1, t_a, s_a,  'same_day', 'rutax_manual', 'same_day_manual', null, 'pendiente_asignacion',
     'Destinatario A1', 'Calle A 1', 'Santiago',
     now() + interval '3 hours', true,  null),
    (pedido_a3, t_a, s_a2, 'same_day', 'rutax_manual', 'same_day_manual', null, 'pendiente_asignacion',
     'Destinatario A3', 'Calle A 3', 'Las Condes',
     now() + interval '2 hours', false, false)
  on conflict (id) do nothing;
end $$;

-- =============================================================================
-- BLOQUE 1 · Aislamiento cross-tenant (interno A NO ve datos del tenant B)
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- u_interno_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

select is_empty(
  $$ select 1 from public.zonas where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'P1 zonas: interno del tenant A NO ve zonas del tenant B'
);

select is_empty(
  $$ select 1 from public.zona_comunas where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'P1 zona_comunas: interno del tenant A NO ve mapeos del tenant B'
);

select is_empty(
  $$ select 1 from public.ventanas_corte where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002' $$,
  'P1 ventanas_corte: interno del tenant A NO ve ventanas del tenant B'
);

-- El interno SÍ ve sus propias zonas/ventanas.
select results_eq(
  $$ select count(*)::int from public.zonas $$,
  $$ values (2) $$,
  'P1 zonas: interno del tenant A ve exactamente sus 2 zonas (Centro, Oriente)'
);

select results_eq(
  $$ select count(*)::int from public.ventanas_corte $$,
  $$ values (2) $$,
  'P1 ventanas_corte: interno del tenant A ve exactamente sus 2 ventanas (default + Centro)'
);

-- =============================================================================
-- BLOQUE 2 · zonas/zona_comunas/ventanas_corte invisibles para el SELLER
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

select is_empty(
  $$ select 1 from public.zonas $$,
  'Aislamiento seller: el seller NO ve ninguna zona (interna del courier)'
);

select is_empty(
  $$ select 1 from public.zona_comunas $$,
  'Aislamiento seller: el seller NO ve ningún mapeo comuna→zona'
);

select is_empty(
  $$ select 1 from public.ventanas_corte $$,
  'Aislamiento seller: el seller NO ve su ventana de corte ni su SLA pactado (criterio §8.2)'
);

-- El seller NO puede INSERT/UPDATE estas tablas internas (42501 explícito).
select throws_ok(
  $$ insert into public.zonas (tenant_id, nombre)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'Hack Zona') $$,
  '42501',
  null,
  'Aislamiento seller: el seller NO puede INSERT en zonas (solo interno)'
);

select throws_ok(
  $$ update public.ventanas_corte set sla_objetivo_pct = 50.00
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'Aislamiento seller: el seller NO puede UPDATE ventanas_corte (guard solo_interno_edita)'
);

-- =============================================================================
-- BLOQUE 3 · zonas/ventanas_corte invisibles para el CONDUCTOR
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- reusamos un user válido
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000099'::uuid
);

select is_empty(
  $$ select 1 from public.zonas $$,
  'Aislamiento conductor: el conductor NO ve ninguna zona'
);

select is_empty(
  $$ select 1 from public.ventanas_corte $$,
  'Aislamiento conductor: el conductor NO ve ninguna ventana de corte'
);

select throws_ok(
  $$ update public.zonas set nombre = 'Hack'
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'Aislamiento conductor: el conductor NO puede UPDATE zonas (guard solo_interno_edita)'
);

-- =============================================================================
-- BLOQUE 4 · Columnas de SLA en pedidos respetan P2 (seller)
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

-- El seller A ve corte_riesgo / fecha_compromiso_hora de SU pedido (pedido_a1).
select isnt_empty(
  $$ select corte_riesgo, fecha_compromiso_hora from public.pedidos
     where id = 'aaaaaaaa-6666-0000-0000-000000000001'
       and corte_riesgo = true $$,
  'P2 SLA: seller A SÍ ve corte_riesgo de su propio pedido (pedido_a1)'
);

-- El seller A NO ve el pedido de OTRO seller (pedido_a3, seller A2) ni su sla_cumplido.
select is_empty(
  $$ select sla_cumplido from public.pedidos
     where seller_id = 'aaaaaaaa-1111-0000-0000-000000000003' $$,  -- s_a2
  'P2 SLA: seller A NO ve sla_cumplido de un pedido del seller A2 (mismo tenant, otro seller)'
);

-- El seller A ve exactamente 1 pedido (el suyo).
select results_eq(
  $$ select count(*)::int from public.pedidos $$,
  $$ values (1) $$,
  'P2 SLA: seller A ve exactamente 1 pedido (el suyo), no el de otro seller ni datos internos'
);

-- =============================================================================
-- BLOQUE 5 · identidad.resolver_zona() — correcta + NULL si no mapeada
-- =============================================================================
-- Se ejecuta como postgres (SECURITY DEFINER acota por el parámetro p_tenant_id).
select test_cerrar_sesion();

select is(
  identidad.resolver_zona(
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'santiago'),
  'aaaaaaaa-7777-0000-0000-000000000001'::uuid,  -- z_a_centro
  'resolver_zona: comuna "santiago" del tenant A → zona Centro (correcta)'
);

select is(
  identidad.resolver_zona(
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'las condes'),
  'aaaaaaaa-7777-0000-0000-000000000002'::uuid,  -- z_a_oriente
  'resolver_zona: comuna "las condes" del tenant A → zona Oriente (correcta)'
);

-- Comuna no mapeada → NULL.
select is(
  identidad.resolver_zona(
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'puente alto'),
  null,
  'resolver_zona: comuna no mapeada ("puente alto") → NULL'
);

-- Aislamiento cross-tenant dentro de la función: la MISMA comuna ("santiago")
-- resuelve a la zona del tenant B, no a la del tenant A.
select is(
  identidad.resolver_zona(
    'bbbbbbbb-0000-0000-0000-000000000002'::uuid, 'santiago'),
  'bbbbbbbb-7777-0000-0000-000000000001'::uuid,  -- z_b_centro
  'resolver_zona: "santiago" del tenant B → zona Centro del tenant B (no la del tenant A)'
);

select * from finish();

rollback;
