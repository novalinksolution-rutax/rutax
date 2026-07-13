-- =============================================================================
-- HALLAZGO QA (Ola 1, gate 2026-07-12) — bypass de la compuerta admin-only de
-- `identidad.courier_config_dte.emision_dte_real_habilitada`
-- =============================================================================
-- `establecerEmisionDteReal` (`src/modules/plataforma/acciones.ts`) documenta
-- -- y el comentario de `src/app/admin/suscripciones/acciones.ts` reafirma --
-- que esta escritura es "exclusiva del super-admin, no del courier": solo se
-- llega a ella vía `/admin` con `SUPER_ADMIN_SECRET` + sesión admin, y queda
-- en bitácora con `actorTipo:'super_admin'`.
--
-- Ese contrato NO está impuesto en la base de datos. La policy
-- `courier_config_dte_update_interno` (migración `20260101000003_dte_secretos.sql`)
-- permite a CUALQUIER usuario interno del courier (dueño, administración,
-- supervisor, coordinador -- la policy no distingue rol, solo
-- `tipo_usuario = 'interno'`) hacer UPDATE de CUALQUIER columna de su propia
-- fila en `identidad.courier_config_dte`, incluida `emision_dte_real_habilitada`
-- (agregada por la migración `20260601000007_dte_emision_opt_in.sql`, ANTERIOR
-- a "Ola 1" -- el gap ya existía, pero Ola 1 es la primera feature que
-- construye una UI/acción admin-only encima y documenta la invariante como si
-- estuviera garantizada por la BD). No hay REVOKE de columna ni trigger de
-- defensa en profundidad que la proteja -- a diferencia de, p. ej.,
-- `identidad.usuarios_perfil`, cuyas columnas `rol`/`tipo_usuario`/`tenant_id`
-- SÍ están protegidas por un trigger dedicado (migración 0001).
--
-- El schema `identidad` está expuesto a PostgREST (`supabase/config.toml`,
-- `schemas = [...,"identidad",...]`) -- este bypass es alcanzable por el mismo
-- patrón `.schema('identidad').from('courier_config_dte').update(...)` que ya
-- usa el resto de esta app (p. ej. `crearConductor`), no es una hipótesis.
--
-- Impacto: un interno del courier, con su sesión legítima, puede fijar
-- `emision_dte_real_habilitada = true` para SU PROPIO tenant sin pasar por
-- `SUPER_ADMIN_SECRET`, sin sesión admin y sin bitácora con
-- `actorTipo:'super_admin'`. Esto NO emite un DTE por sí solo (sigue
-- exigiendo `DTE_SANDBOX_MODE=false` a nivel de plataforma -- variable de
-- entorno, fuera del alcance del courier -- + la acción humana
-- `emitirFacturaPeriodo`), pero rompe la garantía documentada de "opt-in
-- controlado por Rutax, revisado por seguridad-cumplimiento ANTES de
-- habilitar cada courier" (CLAUDE.md, invariante DTE sandbox + opt-in real):
-- un courier podría auto-habilitarse por anticipado, sin que Rutax lo haya
-- revisado, quedando listo para emitir DTE real apenas la plataforma pase a
-- modo real (aunque ese cambio de entorno se pensara solo para OTRO courier
-- ya revisado).
--
-- Este archivo afirma el comportamiento CORRECTO esperado (`throws_ok('42501')`).
-- El hallazgo YA FUE CORREGIDO por la migración
-- `20260712000003_dte_opt_in_solo_service_role.sql` (doble barrera: trigger de
-- columna protegida análogo al de `usuarios_perfil` + REVOKE/GRANT de columna
-- para `authenticated`), así que este test PASA: un interno del courier recibe
-- 42501 al intentar auto-habilitar el flag, y el valor persiste en `false`.
-- Queda como test de regresión permanente del gate admin-only del ítem 8.
--
-- Ejecutar: npx supabase test db supabase/tests/database/rls_hallazgo_dte_opt_in_courier.test.sql
-- =============================================================================

begin;

select plan(2);

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

create or replace function test_cerrar_sesion() returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
end;
$$;

-- -----------------------------------------------------------------------------
-- Fixture: un tenant con su config DTE (opt-in real todavía en false) y un
-- usuario interno CUALQUIERA (aquí `administracion`, deliberadamente distinto
-- de `dueno` -- la policy no distingue rol, así que ni siquiera hace falta ser
-- el dueño para explotar el gap).
-- -----------------------------------------------------------------------------
insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
values ('eeeeeeee-0000-0000-0000-000000000001', 'Courier DTE QA', 'Courier DTE QA SpA', '76444444-4', 'activo')
on conflict (id) do nothing;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values ('eeeeeeee-3333-0000-0000-000000000001', 'interno.dteqa@hallazgo.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, rol, estado)
values ('eeeeeeee-3333-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'Interno DTE QA', 'interno', 'administracion', 'activo')
on conflict (id) do nothing;

insert into identidad.courier_config_dte (tenant_id, proveedor_dte, estado_certificacion, emision_dte_real_habilitada)
values ('eeeeeeee-0000-0000-0000-000000000001', 'simplefactura', 'activo', false)
on conflict (tenant_id) do nothing;

select test_iniciar_sesion(
  'eeeeeeee-3333-0000-0000-000000000001'::uuid,
  'eeeeeeee-0000-0000-0000-000000000001'::uuid,
  'interno', 'administracion'
);

-- CORREGIDO (migración 20260712000003): el interno del courier recibe 42501 al
-- intentar auto-habilitar emision_dte_real_habilitada — la compuerta admin-only
-- ya está impuesta en la BD (trigger de columna protegida + grant de columna).
select throws_ok(
  $$ update identidad.courier_config_dte set emision_dte_real_habilitada = true
       where tenant_id = 'eeeeeeee-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'Regresión ítem 8: un interno del courier (rol administracion, no super-admin) NO puede auto-habilitar emision_dte_real_habilitada — la escritura del opt-in DTE real es exclusiva de service_role (super-admin auditado).'
);

select test_cerrar_sesion();

-- Confirma el alcance real del bypass (vía postgres, bypass RLS): si el
-- assert de arriba falló (bypass sigue activo), esta fila quedó en `true`.
select results_eq(
  $$ select emision_dte_real_habilitada from identidad.courier_config_dte
       where tenant_id = 'eeeeeeee-0000-0000-0000-000000000001' $$,
  $$ values (false) $$,
  'Alcance del hallazgo: se espera false (sin bypass); si aparece true, confirma que el UPDATE del interno persistió sin autorización admin'
);

select * from finish();

rollback;
