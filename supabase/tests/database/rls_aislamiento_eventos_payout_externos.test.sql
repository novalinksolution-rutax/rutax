-- =============================================================================
-- Pruebas de aislamiento RLS — ledger de eventos de webhook de payout (Fintoc)
-- =============================================================================
-- Demuestra, contra una base Postgres real (no mocks de aplicación), que
-- dinero.eventos_payout_externos (ledger append-only del webhook transfer.outbound.*):
--
--   Contrato de esquema:
--     1. RLS enable + force activos (el meta-test lo exige; aquí se nombra la tabla).
--     2. evento_externo_id es UNIQUE (barrera de idempotencia dura, P0).
--     3. La columna payload_sanitizado existe y es jsonb.
--     4. La vista public.eventos_payout_externos existe (espejo PostgREST).
--
--   Aislamiento (la tabla es 100% INTERNA — no lleva seller_id):
--     5. dueno del tenant A SÍ ve sus 2 eventos, no los del tenant B.
--     6. Cross-tenant: dueno del tenant A NO ve NADA del tenant B (P1).
--     7. Interno con rol no privilegiado (coordinador) NO ve eventos.
--     8. Seller NO ve eventos vía la vista public (0 filas) — datos internos del courier.
--     9. Seller NO ve eventos golpeando el schema `dinero` DIRECTO (el ataque
--        Accept-Profile: dinero) — RLS bloquea toda fila, no solo la vista.
--    10. Conductor NO ve eventos vía la vista public (0 filas).
--    11. Conductor NO ve eventos vía schema `dinero` directo (Accept-Profile).
--
--   Escritura e integridad (independientes de la app):
--    12. INSERT desde authenticated → 42501 (escritura solo service_role).
--    13. UNIQUE(evento_externo_id): segundo evento con el mismo evt_... → 23505
--        (barrera de idempotencia dura, en la BASE).
--    14. estado_externo fuera del catálogo → 23514 (CHECK, no la app).
--    15. FK payout_id inexistente → 23503 (integridad referencial).
--
-- Mecanismo: idéntico a rls_aislamiento_payouts.test.sql — simulamos el JWT
-- fijando request.jwt.claims y conmutando el rol a authenticated. Las pruebas de
-- integridad se ejecutan como el rol por defecto (postgres, superuser del test):
-- bypass de RLS y GRANT, para aislar el constraint puro.
--
-- Ejecutar: npx supabase test db
-- =============================================================================

begin;

select plan(15);

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
-- Fixtures. Dos tenants (A, B). Tenant A: seller, conductor, liquidación,
-- payout y 2 eventos de webhook. Tenant B: conductor, liquidación, payout y 1
-- evento (para el cruce cross-tenant). Usuarios: dueno/admin/coordinador/seller/
-- conductor en A; dueno en B. Se insertan como `postgres` (bypassa RLS).
-- UUIDs con sufijo 9080/9081.
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-000000009080';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-000000009081';

  s_a uuid := 'aaaaaaaa-1111-0000-0000-000000009080';

  d_a uuid := 'aaaaaaaa-2222-0000-0000-000000009080';
  d_b uuid := 'bbbbbbbb-2222-0000-0000-000000009081';

  u_dueno_a       uuid := 'aaaaaaaa-3333-0000-0000-000000009080';
  u_admin_a       uuid := 'aaaaaaaa-3333-0000-0000-000000009088';
  u_coordinador_a uuid := 'aaaaaaaa-3333-0000-0000-000000009089';
  u_seller_a      uuid := 'aaaaaaaa-3333-0000-0000-000000009083';
  u_conductor_a   uuid := 'aaaaaaaa-3333-0000-0000-000000009086';
  u_dueno_b       uuid := 'bbbbbbbb-3333-0000-0000-000000009081';

  liq_a uuid := 'aaaaaaaa-ffff-eeee-0000-000000009080';
  liq_b uuid := 'bbbbbbbb-ffff-eeee-0000-000000009081';

  pay_a uuid := 'aaaaaaaa-7777-eeee-0000-000000009080';
  pay_b uuid := 'bbbbbbbb-7777-eeee-0000-000000009081';

  ev_a1 uuid := 'aaaaaaaa-9080-0000-0000-000000000001'; -- confirmado
  ev_a2 uuid := 'aaaaaaaa-9080-0000-0000-000000000002'; -- pendiente
  ev_b1 uuid := 'bbbbbbbb-9081-0000-0000-000000000001'; -- tenant B
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier A', 'Courier A SpA', '76908080-1', 'activo'),
    (t_b, 'Courier B', 'Courier B SpA', '76918181-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_dueno_a,       'dueno.a@evpayout.test',       crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_admin_a,       'admin.a@evpayout.test',       crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_coordinador_a, 'coordinador.a@evpayout.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,      'seller.a@evpayout.test',      crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a,   'conductor.a@evpayout.test',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_dueno_b,       'dueno.b@evpayout.test',       crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a, t_a, 'Seller A', '77908080-1', 'Contacto A', 'a@evpayout.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values
    (d_a, t_a, 'Conductor A', '78908080-1', 'dependiente', 'activo'),
    (d_b, t_b, 'Conductor B', '78918181-2', 'dependiente', 'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_dueno_a,       t_a, 'Dueno A',       'interno',   null, null, 'dueno',          'activo'),
    (u_admin_a,       t_a, 'Admin A',       'interno',   null, null, 'administracion', 'activo'),
    (u_coordinador_a, t_a, 'Coordinador A', 'interno',   null, null, 'coordinador',    'activo'),
    (u_seller_a,      t_a, 'Seller A user', 'seller',    s_a,  null, 'seller',         'activo'),
    (u_conductor_a,   t_a, 'Cond A user',   'conductor', null, d_a,  'conductor',      'activo'),
    (u_dueno_b,       t_b, 'Dueno B',       'interno',   null, null, 'dueno',          'activo')
  on conflict (id) do nothing;

  insert into dinero.liquidaciones (id, tenant_id, driver_id, fecha_inicio, fecha_fin,
    tipo_periodo, estado, tipo_relacion_conductor)
  values
    (liq_a, t_a, d_a, '2026-07-01', '2026-07-07', 'semanal', 'emitida', 'dependiente'),
    (liq_b, t_b, d_b, '2026-07-01', '2026-07-07', 'semanal', 'emitida', 'dependiente')
  on conflict (id) do nothing;

  insert into dinero.payouts_conductor (id, tenant_id, driver_id, liquidacion_id,
    monto_bruto_clp, monto_retencion_clp, monto_liquido_clp, tipo_relacion_conductor,
    metodo, estado, payout_externo_id, solicitado_por_usuario_id)
  values
    (pay_a, t_a, d_a, liq_a, 100000, 0, 100000, 'dependiente', 'fintoc', 'enviado', 'tr_aaaa_9080', u_dueno_a),
    (pay_b, t_b, d_b, liq_b, 100000, 0, 100000, 'dependiente', 'fintoc', 'enviado', 'tr_bbbb_9081', u_dueno_b)
  on conflict (id) do nothing;

  -- Eventos de webhook (ledger). payload_sanitizado sin datos sensibles.
  insert into dinero.eventos_payout_externos (id, tenant_id, payout_id, liquidacion_id,
    evento_externo_id, transfer_externo_id, estado_externo, motivo, payload_sanitizado)
  values
    (ev_a1, t_a, pay_a, liq_a, 'evt_aaaa_9080_1', 'tr_aaaa_9080', 'confirmado', null,
      '{"status":"succeeded","amount":100000,"currency":"CLP"}'::jsonb),
    (ev_a2, t_a, pay_a, liq_a, 'evt_aaaa_9080_2', 'tr_aaaa_9080', 'pendiente', null,
      '{"status":"in_progress"}'::jsonb),
    (ev_b1, t_b, pay_b, liq_b, 'evt_bbbb_9081_1', 'tr_bbbb_9081', 'confirmado', null,
      '{"status":"succeeded","amount":100000,"currency":"CLP"}'::jsonb)
  on conflict (id) do nothing;
end $$;

-- =============================================================================
-- BLOQUE 0 · Contrato de esquema (independiente de sesión)
-- =============================================================================
-- Test 1: RLS enable + force en la tabla base (el guardián del aislamiento).
select results_eq(
  $$ select relrowsecurity, relforcerowsecurity from pg_class
     where oid = 'dinero.eventos_payout_externos'::regclass $$,
  $$ values (true, true) $$,
  'RLS enable + force activos en dinero.eventos_payout_externos'
);

-- Test 2: evento_externo_id es UNIQUE (barrera de idempotencia dura, P0).
select col_is_unique(
  'dinero', 'eventos_payout_externos', 'evento_externo_id',
  'evento_externo_id es UNIQUE (barrera de idempotencia dura del webhook, P0)'
);

-- Test 3: payload_sanitizado existe y es jsonb.
select col_type_is(
  'dinero', 'eventos_payout_externos', 'payload_sanitizado', 'jsonb',
  'payload_sanitizado es jsonb'
);

-- Test 4: la vista espejo public existe (superficie PostgREST).
select has_column(
  'public', 'eventos_payout_externos', 'evento_externo_id',
  'public.eventos_payout_externos (espejo PostgREST) existe y expone evento_externo_id'
);

-- =============================================================================
-- BLOQUE 1 · dueno/administracion del tenant A SÍ ve sus eventos; cross-tenant no
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000009080'::uuid, -- u_dueno_a
  'aaaaaaaa-0000-0000-0000-000000009080'::uuid, -- t_a
  'interno', 'dueno'
);

-- Test 5: dueno A ve sus 2 eventos de webhook.
select results_eq(
  $$ select count(*)::int from public.eventos_payout_externos
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000009080' $$,
  $$ values (2) $$,
  'dueno A ve sus 2 eventos de webhook de payout'
);

-- Test 6: cross-tenant — dueno A NO ve NADA del tenant B (P1).
select is_empty(
  $$ select 1 from public.eventos_payout_externos
     where tenant_id = 'bbbbbbbb-0000-0000-0000-000000009081' $$,
  'P1: dueno del tenant A NO ve eventos del tenant B (aislamiento cross-tenant)'
);

-- =============================================================================
-- BLOQUE 2 · Interno con rol no privilegiado (coordinador) NO ve nada
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000009089'::uuid, -- u_coordinador_a
  'aaaaaaaa-0000-0000-0000-000000009080'::uuid, -- t_a
  'interno', 'coordinador'
);

-- Test 7
select is_empty(
  $$ select 1 from public.eventos_payout_externos $$,
  'Interno coordinador NO ve eventos de payout (solo dueno/administracion)'
);

-- =============================================================================
-- BLOQUE 3 · Seller NO ve datos internos del courier — ni por la vista ni por el
--            schema `dinero` directo (ataque Accept-Profile: dinero)
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000009083'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000009080'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000009080'::uuid -- s_a
);

-- Test 8
select is_empty(
  $$ select 1 from public.eventos_payout_externos $$,
  'Seller NO ve NINGÚN evento de payout vía la vista public (datos internos del courier)'
);

-- Test 9: el ataque Accept-Profile — golpear dinero.* directo. RLS bloquea toda
-- fila (el seller tiene SELECT de tabla como el resto de dinero, pero la política
-- lo filtra a 0), no depende de que la vista lo oculte.
select is_empty(
  $$ select 1 from dinero.eventos_payout_externos $$,
  'Seller NO ve eventos golpeando dinero.eventos_payout_externos directo (RLS, no solo la vista)'
);

-- =============================================================================
-- BLOQUE 4 · Conductor NO ve nada — ni por la vista ni por el schema directo
-- =============================================================================
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000009086'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000009080'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000009080'::uuid -- d_a
);

-- Test 10
select is_empty(
  $$ select 1 from public.eventos_payout_externos $$,
  'Conductor NO ve NINGÚN evento de payout vía la vista public'
);

-- Test 11
select is_empty(
  $$ select 1 from dinero.eventos_payout_externos $$,
  'Conductor NO ve eventos golpeando dinero.eventos_payout_externos directo (RLS)'
);

-- =============================================================================
-- BLOQUE 5 · Escritura: authenticated NO inserta (solo service_role)
-- =============================================================================
-- Test 12: (sesión: conductor A) — INSERT falla con 42501 (revoke + sin política de escritura).
select throws_ok(
  $$ insert into dinero.eventos_payout_externos
       (tenant_id, payout_id, liquidacion_id, evento_externo_id, transfer_externo_id, estado_externo)
     values (
       'aaaaaaaa-0000-0000-0000-000000009080',
       'aaaaaaaa-7777-eeee-0000-000000009080',
       'aaaaaaaa-ffff-eeee-0000-000000009080',
       'evt_intruso', 'tr_intruso', 'confirmado'
     ) $$,
  '42501',
  null,
  'INSERT como authenticated falla con 42501 (escritura del ledger solo service_role)'
);

-- =============================================================================
-- BLOQUE 6 · Constraints de datos (como postgres: bypass RLS/GRANT, CHECK puro)
-- =============================================================================
select test_cerrar_sesion();

-- Test 13: UNIQUE(evento_externo_id) — segundo evento con el mismo evt_... → 23505.
select throws_ok(
  $$ insert into dinero.eventos_payout_externos
       (tenant_id, payout_id, liquidacion_id, evento_externo_id, transfer_externo_id, estado_externo)
     values (
       'aaaaaaaa-0000-0000-0000-000000009080',
       'aaaaaaaa-7777-eeee-0000-000000009080',
       'aaaaaaaa-ffff-eeee-0000-000000009080',
       'evt_aaaa_9080_1', 'tr_aaaa_9080', 'rechazado'
     ) $$,
  '23505',
  null,
  'Idempotencia dura: reinsertar el mismo evento_externo_id → 23505 (barrera en la BASE, no en la app)'
);

-- Test 14: estado_externo fuera del catálogo → 23514 (CHECK).
select throws_ok(
  $$ insert into dinero.eventos_payout_externos
       (tenant_id, payout_id, liquidacion_id, evento_externo_id, transfer_externo_id, estado_externo)
     values (
       'aaaaaaaa-0000-0000-0000-000000009080',
       'aaaaaaaa-7777-eeee-0000-000000009080',
       'aaaaaaaa-ffff-eeee-0000-000000009080',
       'evt_estado_malo', 'tr_aaaa_9080', 'reembolsado'
     ) $$,
  '23514',
  null,
  'estado_externo fuera del catálogo viola eventos_payout_ext_estado_valido (23514)'
);

-- Test 15: FK payout_id inexistente → 23503 (integridad referencial).
select throws_ok(
  $$ insert into dinero.eventos_payout_externos
       (tenant_id, payout_id, liquidacion_id, evento_externo_id, transfer_externo_id, estado_externo)
     values (
       'aaaaaaaa-0000-0000-0000-000000009080',
       'aaaaaaaa-7777-eeee-0000-000000000000',
       'aaaaaaaa-ffff-eeee-0000-000000009080',
       'evt_fk_malo', 'tr_aaaa_9080', 'confirmado'
     ) $$,
  '23503',
  null,
  'payout_id inexistente viola la FK a dinero.payouts_conductor (23503)'
);

-- =============================================================================
-- Cierre
-- =============================================================================
select * from finish();

rollback;
