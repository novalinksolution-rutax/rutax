-- =============================================================================
-- Pruebas de confidencialidad — token de invitación
-- =============================================================================
-- Demuestra, contra una base Postgres real, que el TOKEN de invitación no es
-- alcanzable por un usuario `authenticated`, ni por la vista ni por la tabla
-- base, ni de lectura ni de escritura.
--
-- POR QUÉ IMPORTA: quien tiene el token ENTRA como el invitado. Antes de la
-- migración 20260807000001, cualquier usuario interno del courier —incluidos
-- `coordinador` y `administracion`, que por RBAC NO pueden invitar— podía leer
-- los tokens pendientes de su tenant y consumir la invitación. Con una pendiente
-- de `rol = 'dueno'`, eso era volverse dueño del tenant.
--
-- El rol elegido para las pruebas es `coordinador` A PROPÓSITO: es el caso que
-- más duele, porque `puedeInvitarUsuarios` se lo niega en la capa de aplicación
-- y aun así la base se lo entregaba.
--
-- No hace falta sembrar filas: los privilegios de columna y la resolución de
-- nombres se evalúan al PLANIFICAR la consulta, antes de mirar datos. Una tabla
-- vacía prueba exactamente lo mismo y no arrastra fixtures.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(10);

-- -----------------------------------------------------------------------------
-- Helper de sesión simulada (redefinido aquí — cada .test.sql corre en su
-- propia transacción). Fija el JWT y conmuta a rol authenticated.
-- -----------------------------------------------------------------------------
create or replace function test_iniciar_sesion(
  p_user_id      uuid,
  p_tenant_id    uuid,
  p_tipo_usuario text,
  p_rol          text
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
      'rol', p_rol
    )::text,
    true
  );
end;
$$;

-- =============================================================================
-- BLOQUE 0 · Contrato de esquema: el token sigue existiendo en la tabla base
--            (la confidencialidad se logra con privilegios, no borrándolo).
-- =============================================================================
select has_column(
  'identidad', 'invitaciones', 'token',
  'identidad.invitaciones conserva la columna token'
);

-- =============================================================================
-- BLOQUE 1 · La vista espejo omite el token pero conserva lo de negocio.
-- =============================================================================
select hasnt_column(
  'public', 'invitaciones', 'token',
  'public.invitaciones NO expone token'
);
select has_column(
  'public', 'invitaciones', 'email',
  'public.invitaciones sigue exponiendo email (el panel de equipo lo lista)'
);
select has_column(
  'public', 'invitaciones', 'rol',
  'public.invitaciones sigue exponiendo rol'
);

-- =============================================================================
-- BLOQUE 2 · Un interno sin capacidad de invitar (coordinador) NO llega al
--            token por la vista, pero sí a las columnas que su panel necesita.
-- =============================================================================
select test_iniciar_sesion(
  'bbbbbbbb-3333-0000-0000-000000000001'::uuid,
  'bbbbbbbb-0000-0000-0000-000000000001'::uuid,
  'interno', 'coordinador'
);

select throws_ok(
  $$ select token from public.invitaciones $$,
  '42703',
  null,
  'Coordinador NO puede leer token vía public.invitaciones (columna inexistente en la vista)'
);

select lives_ok(
  $$ select id, email, rol, estado, expira_en, creado_en from public.invitaciones $$,
  'Coordinador SÍ puede leer las columnas de negocio vía public.invitaciones'
);

-- =============================================================================
-- BLOQUE 3 · El camino directo al esquema (Accept-Profile: identidad) tampoco
--            entrega el token — esta es la barrera que la vista NO daba.
-- =============================================================================
select throws_ok(
  $$ select token from identidad.invitaciones $$,
  '42501',
  null,
  'Coordinador NO puede leer token golpeando identidad.invitaciones directo (privilegio de columna denegado)'
);

select lives_ok(
  $$ select id, email, rol from identidad.invitaciones $$,
  'Coordinador SÍ puede leer las columnas de negocio en la tabla base'
);

-- =============================================================================
-- BLOQUE 4 · Sin escritura: ni reescribir el token de una invitación ajena a un
--            valor conocido, ni fabricar una invitación con el rol que se le
--            antoje. Ambas rutas llevaban al mismo desenlace que leerlo.
-- =============================================================================
select throws_ok(
  $$ update identidad.invitaciones set token = 'token-elegido-por-el-atacante' $$,
  '42501',
  null,
  'Coordinador NO puede reescribir el token (sin privilegio UPDATE)'
);

select throws_ok(
  $$ insert into identidad.invitaciones
       (tenant_id, email, tipo_usuario, rol, token, expira_en)
     values
       ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, 'atacante@example.com',
        'interno', 'dueno', 'token-elegido-por-el-atacante', now() + interval '7 days') $$,
  '42501',
  null,
  'Coordinador NO puede fabricar una invitación de dueño con token conocido (sin privilegio INSERT)'
);

reset role;

select * from finish();
rollback;
