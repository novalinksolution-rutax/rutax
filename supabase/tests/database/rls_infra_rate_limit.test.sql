-- =============================================================================
-- Pruebas de seguridad — infra.rate_limit_contadores + public.rate_limit_consumir
-- =============================================================================
-- Demuestra, contra una base Postgres real:
--   1. La tabla es UNLOGGED y tiene RLS enable+force SIN políticas (deny-by-default).
--   2. authenticated/anon NO tienen privilegio SELECT sobre la tabla, y un
--      SELECT real como authenticated falla con 42501.
--   3. authenticated/anon NO pueden EXECUTE la RPC (42501); service_role SÍ.
--   4. service_role ejecuta la RPC y el contador incrementa: misma llave y
--      ventana → 1 y luego 2; otra llave → contador independiente (1).
--   5. p_ventana_segundos <= 0 lanza 22023.
--
-- Nota: now() es constante dentro de la transacción de pgTAP, por lo que ambas
-- llamadas caen garantizadamente en la misma ventana (sin flakiness de borde).
-- Se usa ventana de 60s para que la limpieza oportunista (~1%, ventanas con
-- más de 1 hora) jamás pueda borrar la fila bajo prueba.
--
-- Ejecutar: npx supabase test db
-- =============================================================================

begin;

select plan(15);

-- =============================================================================
-- BLOQUE 1 · Metadatos: UNLOGGED + RLS forzada sin políticas
-- =============================================================================

-- Test 1 · UNLOGGED (relpersistence = 'u')
select results_eq(
  $$ select c.relpersistence::text
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'infra' and c.relname = 'rate_limit_contadores' $$,
  $$ values ('u'::text) $$,
  'infra.rate_limit_contadores es UNLOGGED (dato efímero, sin WAL)'
);

-- Test 2 · RLS enable + force
select results_eq(
  $$ select c.relrowsecurity, c.relforcerowsecurity
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'infra' and c.relname = 'rate_limit_contadores' $$,
  $$ values (true, true) $$,
  'RLS está enable + force sobre infra.rate_limit_contadores'
);

-- Test 3 · SIN políticas — deny-by-default real
select is_empty(
  $$ select 1 from pg_policies
     where schemaname = 'infra' and tablename = 'rate_limit_contadores' $$,
  'La tabla NO tiene políticas RLS: deny-by-default (nadie pasa salvo BYPASSRLS)'
);

-- =============================================================================
-- BLOQUE 2 · Privilegios declarados (catálogo)
-- =============================================================================

-- Test 4 · authenticated sin SELECT sobre la tabla
select ok(
  not has_table_privilege('authenticated', 'infra.rate_limit_contadores', 'SELECT'),
  'authenticated NO tiene privilegio SELECT sobre infra.rate_limit_contadores'
);

-- Test 5 · anon sin SELECT sobre la tabla
select ok(
  not has_table_privilege('anon', 'infra.rate_limit_contadores', 'SELECT'),
  'anon NO tiene privilegio SELECT sobre infra.rate_limit_contadores'
);

-- Test 6 · authenticated sin EXECUTE sobre la RPC
select ok(
  not has_function_privilege('authenticated', 'public.rate_limit_consumir(text, integer)', 'EXECUTE'),
  'authenticated NO puede EXECUTE public.rate_limit_consumir'
);

-- Test 7 · anon sin EXECUTE sobre la RPC
select ok(
  not has_function_privilege('anon', 'public.rate_limit_consumir(text, integer)', 'EXECUTE'),
  'anon NO puede EXECUTE public.rate_limit_consumir'
);

-- Test 8 · service_role SÍ puede EXECUTE
select ok(
  has_function_privilege('service_role', 'public.rate_limit_consumir(text, integer)', 'EXECUTE'),
  'service_role SÍ puede EXECUTE public.rate_limit_consumir'
);

-- =============================================================================
-- BLOQUE 3 · Denegación real como authenticated (no solo catálogo)
-- =============================================================================
set local role authenticated;

-- Test 9 · SELECT directo a la tabla → 42501 (ni USAGE sobre el schema infra)
select throws_ok(
  $$ select * from infra.rate_limit_contadores $$,
  '42501',
  null,
  'SELECT en infra.rate_limit_contadores como authenticated falla con 42501'
);

-- Test 10 · Invocar la RPC → 42501
select throws_ok(
  $$ select public.rate_limit_consumir('pgtap:bloqueado', 60) $$,
  '42501',
  null,
  'EXECUTE de rate_limit_consumir como authenticated falla con 42501'
);

reset role;

-- =============================================================================
-- BLOQUE 4 · service_role consume el límite y el contador incrementa
-- =============================================================================
set local role service_role;

-- Test 11 · Primera llamada de la ventana → 1
select results_eq(
  $$ select public.rate_limit_consumir('pgtap:llave-1', 60) $$,
  $$ values (1) $$,
  'Primera llamada (llave-1, ventana 60s) retorna contador = 1'
);

-- Test 12 · Segunda llamada, misma llave y ventana → 2
select results_eq(
  $$ select public.rate_limit_consumir('pgtap:llave-1', 60) $$,
  $$ values (2) $$,
  'Segunda llamada (misma llave/ventana) retorna contador = 2'
);

-- Test 13 · Otra llave → contador independiente = 1
select results_eq(
  $$ select public.rate_limit_consumir('pgtap:llave-2', 60) $$,
  $$ values (1) $$,
  'Otra llave en la misma ventana arranca su propio contador en 1'
);

-- Test 14 · p_ventana_segundos = 0 → 22023
select throws_ok(
  $$ select public.rate_limit_consumir('pgtap:invalida', 0) $$,
  '22023',
  null,
  'rate_limit_consumir con ventana 0 lanza 22023 (invalid_parameter_value)'
);

-- Test 15 · p_ventana_segundos negativo → 22023
select throws_ok(
  $$ select public.rate_limit_consumir('pgtap:invalida', -5) $$,
  '22023',
  null,
  'rate_limit_consumir con ventana negativa lanza 22023'
);

reset role;

-- =============================================================================
-- Cierre
-- =============================================================================
select * from finish();

rollback;
