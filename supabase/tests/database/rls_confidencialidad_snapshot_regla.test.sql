-- =============================================================================
-- Pruebas de confidencialidad — snapshot_regla (hallazgo P0 "congelar reglas")
-- =============================================================================
-- Demuestra, contra una base Postgres real (no mocks de aplicación), la garantía
-- central de la migración 20260707000001: el snapshot inmutable de la regla
-- económica es DATO INTERNO DEL COURIER y NUNCA se expone al seller ni al
-- conductor.
--
--   1. La columna dinero.lineas_cobro.snapshot_regla existe, es jsonb y NOT NULL.
--   2. La columna dinero.lineas_liquidacion.snapshot_regla existe, es jsonb y NOT NULL.
--   3. La vista public.lineas_cobro (superficie del seller vía PostgREST) NO
--      expone snapshot_regla, pero SÍ sigue exponiendo las columnas de negocio.
--   4. La vista public.lineas_liquidacion (superficie del conductor) NO expone
--      snapshot_regla, pero SÍ sigue exponiendo las columnas de negocio.
--   5. Un seller autenticado que intente leer snapshot_regla a través de su vista
--      recibe 42703 (columna inexistente): no hay camino de lectura.
--   6. Un conductor autenticado idem sobre public.lineas_liquidacion.
--   7. Un seller/conductor autenticado que golpee el schema `dinero` DIRECTO
--      (bypass de la vista, p. ej. `Accept-Profile: dinero` en PostgREST)
--      TAMPOCO puede leer snapshot_regla (42501, permiso de columna denegado),
--      pero sigue pudiendo leer las columnas de negocio normales.
--
-- Corrección de una nota previa (ya no es cierta, no reintroducirla): el schema
-- `dinero` SÍ está expuesto directo por PostgREST (`supabase/config.toml`,
-- imprescindible para `crearClienteServiceRole().schema('dinero')`), y
-- `authenticated` tiene SELECT sobre las tablas base (requerido por las vistas
-- security_invoker=true). Por eso la confidencialidad de snapshot_regla NO podía
-- depender solo de la vista — hace falta además un grant de COLUMNA en la tabla
-- base (migración 20260707000002), que es lo que prueba el BLOQUE 3 más abajo.
-- La RLS de FILA (P1/P2/P3) de las tablas base ya la cubren las pruebas de
-- rls_aislamiento_dinero.test.sql; esta prueba añade la dimensión de COLUMNA.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(16);

-- -----------------------------------------------------------------------------
-- Helper de sesión simulada (redefinido aquí — cada .test.sql corre en su
-- propia transacción). Fija el JWT y conmuta a rol authenticated.
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

-- =============================================================================
-- BLOQUE 0 · Contrato de esquema: la columna existe en AMBAS tablas base,
--            es jsonb y NOT NULL (para poder llevar el default '{}').
-- =============================================================================
select has_column(
  'dinero', 'lineas_cobro', 'snapshot_regla',
  'dinero.lineas_cobro tiene la columna snapshot_regla'
);
select col_type_is(
  'dinero', 'lineas_cobro', 'snapshot_regla', 'jsonb',
  'snapshot_regla de lineas_cobro es jsonb'
);
select col_not_null(
  'dinero', 'lineas_cobro', 'snapshot_regla',
  'snapshot_regla de lineas_cobro es NOT NULL (default ''{}'')'
);

select has_column(
  'dinero', 'lineas_liquidacion', 'snapshot_regla',
  'dinero.lineas_liquidacion tiene la columna snapshot_regla'
);
select col_type_is(
  'dinero', 'lineas_liquidacion', 'snapshot_regla', 'jsonb',
  'snapshot_regla de lineas_liquidacion es jsonb'
);
select col_not_null(
  'dinero', 'lineas_liquidacion', 'snapshot_regla',
  'snapshot_regla de lineas_liquidacion es NOT NULL (default ''{}'')'
);

-- =============================================================================
-- BLOQUE 1 · Confidencialidad a nivel de COLUMNA: las vistas public.* OMITEN
--            snapshot_regla pero conservan las columnas de negocio.
-- =============================================================================
select hasnt_column(
  'public', 'lineas_cobro', 'snapshot_regla',
  'public.lineas_cobro (superficie del seller) NO expone snapshot_regla'
);
select has_column(
  'public', 'lineas_cobro', 'monto_final_clp',
  'public.lineas_cobro sigue exponiendo las columnas de negocio (monto_final_clp)'
);

select hasnt_column(
  'public', 'lineas_liquidacion', 'snapshot_regla',
  'public.lineas_liquidacion (superficie del conductor) NO expone snapshot_regla'
);
select has_column(
  'public', 'lineas_liquidacion', 'monto_final_clp',
  'public.lineas_liquidacion sigue exponiendo las columnas de negocio (monto_final_clp)'
);

-- =============================================================================
-- BLOQUE 2 · Prueba de acceso: seller/conductor autenticados NO pueden leer
--            snapshot_regla por su vista → 42703 (columna inexistente).
-- =============================================================================
-- Seller
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid
);
select throws_ok(
  $$ select snapshot_regla from public.lineas_cobro $$,
  '42703',
  null,
  'Seller NO puede leer snapshot_regla vía public.lineas_cobro (columna inexistente en la vista)'
);
reset role;

-- Conductor
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid
);
select throws_ok(
  $$ select snapshot_regla from public.lineas_liquidacion $$,
  '42703',
  null,
  'Conductor NO puede leer snapshot_regla vía public.lineas_liquidacion (columna inexistente en la vista)'
);
reset role;

-- =============================================================================
-- BLOQUE 3 · Acceso DIRECTO al schema `dinero` (bypass de la vista public.*).
--
-- `supabase/config.toml` expone `dinero` directamente por PostgREST
-- (imprescindible para `crearClienteServiceRole().schema('dinero')`), y
-- `authenticated` necesita SELECT sobre las tablas base para que las vistas
-- security_invoker=true funcionen. Sin restricción de COLUMNA, un cliente
-- podía golpear la API con `Accept-Profile: dinero` y leer snapshot_regla
-- directo de `dinero.lineas_cobro`/`lineas_liquidacion`, saltándose la vista
-- por completo — verificado end-to-end contra PostgREST con un JWT de seller
-- real antes de esta migración (20260707000002). El error deja de ser 42703
-- (columna inexistente en una vista) y pasa a ser 42501 (permiso denegado a
-- nivel de columna en la tabla base) — es el mecanismo correcto de Postgres
-- para esto, no una vista.
--
-- Las pruebas `lives_ok` confirman que la restricción es de COLUMNA, no de
-- tabla completa: el seller/conductor sigue pudiendo leer columnas de negocio
-- directo del schema `dinero` (necesario porque el grant original no se quitó
-- por completo, solo se acotó) — si esto empezara a fallar sería una señal de
-- que alguien bloqueó la tabla entera en vez de solo la columna.
-- =============================================================================
-- Seller — dinero.lineas_cobro
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid
);
select throws_ok(
  $$ select snapshot_regla from dinero.lineas_cobro $$,
  '42501',
  null,
  'Seller NO puede leer snapshot_regla directo de dinero.lineas_cobro (bypass de la vista bloqueado por grant de columna)'
);
select lives_ok(
  $$ select id, monto_final_clp from dinero.lineas_cobro limit 1 $$,
  'Seller SÍ puede seguir leyendo columnas de negocio directo de dinero.lineas_cobro (la restricción es de columna, no de tabla)'
);
reset role;

-- Conductor — dinero.lineas_liquidacion
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid
);
select throws_ok(
  $$ select snapshot_regla from dinero.lineas_liquidacion $$,
  '42501',
  null,
  'Conductor NO puede leer snapshot_regla directo de dinero.lineas_liquidacion (bypass de la vista bloqueado por grant de columna)'
);
select lives_ok(
  $$ select id, monto_final_clp from dinero.lineas_liquidacion limit 1 $$,
  'Conductor SÍ puede seguir leyendo columnas de negocio directo de dinero.lineas_liquidacion (la restricción es de columna, no de tabla)'
);
reset role;

select * from finish();

rollback;
