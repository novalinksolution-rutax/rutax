-- =============================================================================
-- Integridad de la bitácora de auditoría — quién puede escribirla y quién no
-- =============================================================================
-- Nace del bug de producción del 2026-08-11: el alta de conductores moría con
-- "permission denied for VIEW bitacora_auditoria" porque el flujo escribía la
-- bitácora con el cliente de la SESIÓN del usuario. La tentación era conceder
-- INSERT a `authenticated` para "destrabarlo". Este archivo existe para que esa
-- tentación falle ruidosamente: una bitácora que el usuario final puede
-- escribir se puede FABRICAR desde el navegador vía PostgREST y deja de ser
-- evidencia (RNF-04).
--
-- Qué demuestra, contra una base Postgres real:
--   1. Ningún rol de cliente inserta, actualiza ni borra la bitácora — ni por la
--      vista espejo de `public` ni golpeando `identidad` directo (Accept-Profile:
--      la vista NUNCA es la barrera, el privilegio de la tabla base sí).
--   2. `service_role` sigue pudiendo APPEND (si no, no hay auditoría posible)…
--   3. …pero ya NO puede UPDATE ni DELETE: append-only real para TODOS, no solo
--      para los roles de cliente (migración 20260811000001).
--   4. Aislamiento de lectura: el interno del tenant A ve solo lo suyo, y el
--      seller no ve nada de la bitácora del courier.
--
-- Complementa `rls_aislamiento.test.sql`, que ya cubría la lectura cross-tenant
-- y el INSERT denegado por la vista; lo nuevo aquí es la ruta directa al esquema
-- y todo el lado de `service_role`.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(19);

-- -----------------------------------------------------------------------------
-- Helper de sesión simulada (cada .test.sql corre en su propia transacción).
-- pgTAP corre como `postgres` (rolbypassrls = true): sin conmutar el rol, FORCE
-- RLS no aplica y todo pasaría por un falso positivo.
-- -----------------------------------------------------------------------------
create or replace function test_iniciar_sesion(
  p_user_id      uuid,
  p_tenant_id    uuid,
  p_tipo_usuario text,
  p_rol          text,
  p_seller_id    uuid default null
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
      'rol', p_rol
    )::text,
    true
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Fixture: dos couriers, una entrada de bitácora cada uno. `actor_usuario_id`
-- va NULL a propósito (actor_tipo='sistema'): la prueba es de privilegios, no
-- necesita usuarios de auth.
-- -----------------------------------------------------------------------------
insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
values
  ('cccccccc-0000-0000-0000-000000000001', 'Courier Bitácora A', 'Courier Bitácora A SpA', '76333333-3', 'activo'),
  ('cccccccc-0000-0000-0000-000000000002', 'Courier Bitácora B', 'Courier Bitácora B SpA', '76444444-4', 'activo');

insert into identidad.bitacora_auditoria
  (tenant_id, actor_usuario_id, actor_tipo, accion, entidad_tipo, entidad_id, detalle)
values
  ('cccccccc-0000-0000-0000-000000000001', null, 'sistema', 'conductor.alta', 'conductor',
   'cccccccc-2222-0000-0000-000000000001', '{"tipo_relacion":"independiente"}'::jsonb),
  ('cccccccc-0000-0000-0000-000000000002', null, 'sistema', 'conductor.alta', 'conductor',
   'cccccccc-2222-0000-0000-000000000002', '{"tipo_relacion":"dependiente"}'::jsonb);

-- =============================================================================
-- BLOQUE 1 · Privilegios declarados (lo que se rompe si alguien "destraba" el
--            bug con un GRANT en vez de con el cliente correcto).
-- =============================================================================
select ok(
  not has_table_privilege('authenticated', 'public.bitacora_auditoria', 'INSERT'),
  'authenticated NO tiene INSERT sobre la vista public.bitacora_auditoria'
);
select ok(
  not has_table_privilege('authenticated', 'identidad.bitacora_auditoria', 'INSERT'),
  'authenticated NO tiene INSERT sobre la tabla base identidad.bitacora_auditoria'
);
select ok(
  has_table_privilege('authenticated', 'public.bitacora_auditoria', 'SELECT'),
  'authenticated SÍ conserva SELECT (RLS lo acota a internos de su tenant)'
);
select ok(
  has_table_privilege('service_role', 'identidad.bitacora_auditoria', 'INSERT'),
  'service_role conserva INSERT en la tabla base — es la única puerta de escritura'
);
select ok(
  has_table_privilege('service_role', 'public.bitacora_auditoria', 'INSERT'),
  'service_role conserva INSERT en la vista espejo (registrarEnBitacora escribe por ahí)'
);
select ok(
  not has_table_privilege('service_role', 'identidad.bitacora_auditoria', 'UPDATE'),
  'service_role NO puede UPDATE la tabla base — append-only también para el backend'
);
select ok(
  not has_table_privilege('service_role', 'identidad.bitacora_auditoria', 'DELETE'),
  'service_role NO puede DELETE la tabla base — borrar auditoría exige migración explícita'
);
select ok(
  not has_table_privilege('service_role', 'public.bitacora_auditoria', 'UPDATE'),
  'service_role NO puede UPDATE por la vista espejo'
);
select ok(
  not has_table_privilege('service_role', 'public.bitacora_auditoria', 'DELETE'),
  'service_role NO puede DELETE por la vista espejo'
);

-- =============================================================================
-- BLOQUE 2 · El dueño del courier (interno, el rol que disparó el bug): lee lo
--            suyo y nada más; no escribe por ningún camino.
-- =============================================================================
select test_iniciar_sesion(
  'cccccccc-3333-0000-0000-000000000001'::uuid,
  'cccccccc-0000-0000-0000-000000000001'::uuid,
  'interno', 'dueno'
);

select results_eq(
  $$ select count(*)::int from public.bitacora_auditoria $$,
  $$ values (1) $$,
  'Dueño del tenant A ve exactamente su entrada (la del tenant B no existe para él)'
);

select is_empty(
  $$ select 1 from public.bitacora_auditoria
     where tenant_id = 'cccccccc-0000-0000-0000-000000000002' $$,
  'Dueño del tenant A NO lee ni una fila de la bitácora del tenant B'
);

-- Este es el INSERT que el alta de conductores intentaba en producción con la
-- sesión del usuario: 42501 "permission denied for view". La BD hace lo correcto.
select throws_ok(
  $$ insert into public.bitacora_auditoria
       (tenant_id, actor_tipo, accion, entidad_tipo, detalle)
     values ('cccccccc-0000-0000-0000-000000000001', 'usuario', 'conductor.alta', 'conductor', '{}'::jsonb) $$,
  '42501',
  null,
  'Dueño NO puede insertar en la bitácora por la vista (este era el error de producción, y es el comportamiento correcto)'
);

-- La vista NO es la barrera: `identidad` está expuesto a PostgREST, así que el
-- mismo INSERT viaja con Content-Profile: identidad. Lo que corta es el
-- privilegio sobre la tabla base.
select throws_ok(
  $$ insert into identidad.bitacora_auditoria
       (tenant_id, actor_tipo, accion, entidad_tipo, detalle)
     values ('cccccccc-0000-0000-0000-000000000001', 'usuario', 'conductor.alta', 'conductor', '{}'::jsonb) $$,
  '42501',
  null,
  'Dueño NO puede insertar golpeando identidad.bitacora_auditoria directo (Accept-Profile no rodea el privilegio)'
);

select throws_ok(
  $$ update public.bitacora_auditoria set detalle = '{}'::jsonb $$,
  '42501',
  null,
  'Dueño NO puede reescribir una entrada ya registrada'
);

select throws_ok(
  $$ delete from public.bitacora_auditoria $$,
  '42501',
  null,
  'Dueño NO puede borrar entradas de la bitácora'
);

reset role;

-- =============================================================================
-- BLOQUE 3 · El seller no ve la trastienda del courier.
-- =============================================================================
select test_iniciar_sesion(
  'cccccccc-3333-0000-0000-000000000002'::uuid,
  'cccccccc-0000-0000-0000-000000000001'::uuid,
  'seller', 'seller',
  'cccccccc-1111-0000-0000-000000000001'::uuid
);

select is_empty(
  $$ select 1 from public.bitacora_auditoria $$,
  'El seller NO ve ninguna entrada de la bitácora del courier (ni suya ni interna)'
);

reset role;

-- =============================================================================
-- BLOQUE 4 · service_role: puede APPEND, no puede corregir ni borrar.
--            Sin la migración 20260811000001 estos dos últimos PASABAN — es
--            decir, cualquier función de servidor podía reescribir la auditoría.
-- =============================================================================
set local role service_role;

select lives_ok(
  $$ insert into identidad.bitacora_auditoria
       (tenant_id, actor_tipo, accion, entidad_tipo, detalle)
     values ('cccccccc-0000-0000-0000-000000000001', 'usuario', 'conductor.alta', 'conductor',
             '{"tipo_relacion":"independiente"}'::jsonb) $$,
  'service_role SÍ puede registrar una entrada nueva (si no, no habría auditoría)'
);

select throws_ok(
  $$ update identidad.bitacora_auditoria set detalle = '{"limpio":true}'::jsonb $$,
  '42501',
  null,
  'service_role NO puede reescribir la bitácora (append-only real, no solo para el cliente)'
);

select throws_ok(
  $$ delete from identidad.bitacora_auditoria $$,
  '42501',
  null,
  'service_role NO puede borrar la bitácora (purgar por retención exigiría una migración explícita)'
);

reset role;

select * from finish();
rollback;
