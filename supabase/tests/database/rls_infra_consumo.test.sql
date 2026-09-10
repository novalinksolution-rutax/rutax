-- =============================================================================
-- Pruebas de seguridad — módulo Consumo (infra.eventos_consumo / precios_consumo /
-- consumo_mensual + public.consumo_registrar y las RPCs de lectura)
-- =============================================================================
-- Demuestra, contra una base Postgres real:
--   1. Las tres tablas tienen RLS enable+force SIN políticas (deny-by-default).
--   2. authenticated/anon NO tienen SELECT sobre ninguna tabla (catálogo), y un
--      SELECT real como authenticated falla con 42501 (contraprueba de denegación).
--   3. authenticated/anon NO pueden EXECUTE las RPCs (catálogo + intento real 42501);
--      service_role SÍ.
--   4. service_role ejecuta consumo_registrar y el cálculo de costo funciona:
--      30 paradas de ruteo single_vehicle × 0.010 = 0.30.
--   5. Idempotencia: misma clave_idempotencia no inserta una segunda fila.
--
-- OJO (gotcha del repo): este test NO repone DDL — solo lee el esquema ya migrado.
-- Ejecutar: npx supabase test db
-- =============================================================================

begin;

select plan(20);

-- =============================================================================
-- BLOQUE 1 · Metadatos: RLS forzada sin políticas en las tres tablas
-- =============================================================================

-- Test 1-3 · RLS enable + force
select results_eq(
  $$ select c.relrowsecurity, c.relforcerowsecurity from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'infra' and c.relname = 'eventos_consumo' $$,
  $$ values (true, true) $$,
  'RLS enable + force sobre infra.eventos_consumo'
);
select results_eq(
  $$ select c.relrowsecurity, c.relforcerowsecurity from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'infra' and c.relname = 'precios_consumo' $$,
  $$ values (true, true) $$,
  'RLS enable + force sobre infra.precios_consumo'
);
select results_eq(
  $$ select c.relrowsecurity, c.relforcerowsecurity from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'infra' and c.relname = 'consumo_mensual' $$,
  $$ values (true, true) $$,
  'RLS enable + force sobre infra.consumo_mensual'
);

-- Test 4 · SIN políticas — deny-by-default real (ninguna de las tres)
select is_empty(
  $$ select 1 from pg_policies
     where schemaname = 'infra'
       and tablename in ('eventos_consumo','precios_consumo','consumo_mensual') $$,
  'Ninguna tabla del módulo Consumo tiene políticas RLS: deny-by-default'
);

-- =============================================================================
-- BLOQUE 2 · Privilegios declarados (catálogo)
-- =============================================================================

-- Test 5-7 · authenticated sin SELECT sobre las tablas
select ok(not has_table_privilege('authenticated', 'infra.eventos_consumo', 'SELECT'),
  'authenticated NO tiene SELECT sobre infra.eventos_consumo');
select ok(not has_table_privilege('authenticated', 'infra.precios_consumo', 'SELECT'),
  'authenticated NO tiene SELECT sobre infra.precios_consumo');
select ok(not has_table_privilege('authenticated', 'infra.consumo_mensual', 'SELECT'),
  'authenticated NO tiene SELECT sobre infra.consumo_mensual');

-- Test 8 · anon sin SELECT sobre el crudo
select ok(not has_table_privilege('anon', 'infra.eventos_consumo', 'SELECT'),
  'anon NO tiene SELECT sobre infra.eventos_consumo');

-- Test 9-11 · authenticated/anon sin EXECUTE; service_role sí (consumo_registrar)
select ok(not has_function_privilege('authenticated',
  'public.consumo_registrar(text, text, uuid, uuid, text, text, text, text, numeric, text, text, jsonb, text, timestamptz)', 'EXECUTE'),
  'authenticated NO puede EXECUTE public.consumo_registrar');
select ok(not has_function_privilege('anon',
  'public.consumo_registrar(text, text, uuid, uuid, text, text, text, text, numeric, text, text, jsonb, text, timestamptz)', 'EXECUTE'),
  'anon NO puede EXECUTE public.consumo_registrar');
select ok(has_function_privilege('service_role',
  'public.consumo_registrar(text, text, uuid, uuid, text, text, text, text, numeric, text, text, jsonb, text, timestamptz)', 'EXECUTE'),
  'service_role SÍ puede EXECUTE public.consumo_registrar');

-- Test 12-14 · RPCs de lectura: authenticated sin EXECUTE, service_role con EXECUTE
select ok(not has_function_privilege('authenticated',
  'public.consumo_por_courier(timestamptz, timestamptz)', 'EXECUTE'),
  'authenticated NO puede EXECUTE public.consumo_por_courier');
select ok(not has_function_privilege('authenticated',
  'public.consumo_por_conductor(uuid, timestamptz, timestamptz)', 'EXECUTE'),
  'authenticated NO puede EXECUTE public.consumo_por_conductor');
select ok(not has_function_privilege('authenticated',
  'public.consumo_por_proveedor(timestamptz, timestamptz)', 'EXECUTE'),
  'authenticated NO puede EXECUTE public.consumo_por_proveedor');

-- =============================================================================
-- BLOQUE 3 · Denegación real como authenticated (no solo catálogo)
-- =============================================================================
set local role authenticated;

-- Test 15 · SELECT directo al crudo → 42501 (ni USAGE sobre el schema infra)
select throws_ok(
  $$ select * from infra.eventos_consumo $$,
  '42501', null,
  'SELECT en infra.eventos_consumo como authenticated falla con 42501'
);

-- Test 16 · Invocar la RPC de escritura → 42501
select throws_ok(
  $$ select public.consumo_registrar('pgtap', 'adaptador') $$,
  '42501', null,
  'EXECUTE de consumo_registrar como authenticated falla con 42501'
);

reset role;

-- =============================================================================
-- BLOQUE 4 · service_role registra y el cálculo de costo funciona
-- =============================================================================
set local role service_role;

-- Test 17 · Ruteo single_vehicle, 30 paradas → costo 30 × 0.010 = 0.30
select lives_ok(
  $$ select public.consumo_registrar(
       p_tipo_evento     => 'ruteo_optimizacion',
       p_superficie      => 'adaptador',
       p_tenant_id       => '11111111-1111-1111-1111-111111111111'::uuid,
       p_usuario_id      => '22222222-2222-2222-2222-222222222222'::uuid,
       p_proveedor_costo => 'google_route_optimization',
       p_sku             => 'single_vehicle',
       p_unidades        => 30,
       p_clave_idempotencia => 'pgtap:ruteo-1'
     ) $$,
  'service_role registra un evento de ruteo de 30 paradas'
);

-- Test 18 · costo_estimado_usd = 0.30 (30 × 0.010)
select results_eq(
  $$ select costo_estimado_usd from infra.eventos_consumo
     where clave_idempotencia = 'pgtap:ruteo-1' $$,
  $$ values (0.300000::numeric(12,6)) $$,
  'costo_estimado_usd = 30 × 0.010 = 0.30'
);

-- Test 19 · Idempotencia: reintento con la misma clave NO inserta otra fila
select lives_ok(
  $$ select public.consumo_registrar(
       p_tipo_evento     => 'ruteo_optimizacion',
       p_superficie      => 'adaptador',
       p_proveedor_costo => 'google_route_optimization',
       p_sku             => 'single_vehicle',
       p_unidades        => 30,
       p_clave_idempotencia => 'pgtap:ruteo-1'
     ) $$,
  'reintento con la misma clave_idempotencia no lanza'
);
select results_eq(
  $$ select count(*) from infra.eventos_consumo where clave_idempotencia = 'pgtap:ruteo-1' $$,
  $$ values (1::bigint) $$,
  'la clave_idempotencia repetida deja UNA sola fila (idempotente)'
);

-- Test 20 · La RPC de lectura por proveedor suma el costo esperado en la ventana
select results_eq(
  $$ select total_costo_usd from public.consumo_por_proveedor(now() - interval '1 hour', now() + interval '1 hour')
     where proveedor_costo = 'google_route_optimization' and sku = 'single_vehicle' $$,
  $$ values (0.300000::numeric) $$,
  'consumo_por_proveedor suma 0.30 para google_route_optimization/single_vehicle'
);

reset role;

select * from finish();

rollback;
