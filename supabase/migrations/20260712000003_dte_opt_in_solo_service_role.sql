-- =============================================================================
-- Migración · Opt-in de emisión DTE real = acción exclusiva de service_role
-- =============================================================================
-- Hallazgo de QA (Ola 1, gate 2026-07-12 · ítem 8 "backstage plataforma"),
-- verificado contra Postgres real:
--
--   `identidad.courier_config_dte.emision_dte_real_habilitada` era ESCRIBIBLE
--   por CUALQUIER usuario interno del courier (dueño, administración,
--   supervisor, coordinador — la policy `courier_config_dte_update_interno`
--   solo exige `tipo_usuario = 'interno'`, no distingue rol ni COLUMNA) vía
--   `UPDATE ... schema('identidad').from('courier_config_dte')`.
--
-- Ese flag es el opt-in explícito del courier para emitir DTE REAL al SII (no
-- sandbox). Por contrato (CLAUDE.md, invariante "DTE sandbox + opt-in real";
-- `establecerEmisionDteReal` en `src/modules/plataforma/acciones.ts`) su
-- escritura es EXCLUSIVA del super-admin de Rutax: solo se llega a ella vía
-- `/admin` con `SUPER_ADMIN_SECRET` + sesión admin, ejecutada por `service_role`
-- y registrada en `bitacora_auditoria` con `actorTipo:'super_admin'`. Es la
-- capa de revisión de `seguridad-cumplimiento` ANTES de habilitar cada courier.
--
-- El contrato NO estaba impuesto en la BD: no había ni REVOKE de columna ni
-- trigger de defensa que impidiera al courier auto-habilitarse. Esto NO permite
-- emitir un DTE por sí solo (sigue exigiendo `DTE_SANDBOX_MODE=false` a nivel de
-- plataforma + la acción humana `emitirFacturaPeriodo`), pero convierte el gate
-- en teatro: un courier podía quedar pre-habilitado sin que Rutax lo revisara.
--
-- Defensa en profundidad, DOS barreras (mismo espíritu que la doble barrera de
-- `dinero.snapshot_regla`, migración 20260707000002):
--
--   1. TRIGGER `before update` (espejo de
--      `identidad.usuarios_perfil_proteger_columnas_sensibles`, migración 0001):
--      si `emision_dte_real_habilitada` CAMBIA y el rol efectivo NO es
--      `service_role` (ni superusuario de mantención), lanza 42501 explícito y
--      auditable. Es la barrera PRIMARIA: explícita, imposible de saltar por
--      cualquier vía de escritura (vista `public`, schema `identidad` directo,
--      upsert), y deja claro EN LA BD el "quién puede".
--
--   2. Privilegio a nivel de COLUMNA: se revoca el UPDATE de tabla completa a
--      `authenticated` y se re-otorga UPDATE sobre TODAS las columnas MENOS
--      `emision_dte_real_habilitada`. Así el courier interno sigue pudiendo
--      escribir sus columnas de onboarding, pero el motor de Postgres deniega
--      (42501) cualquier UPDATE que TOQUE el flag, incluso antes del trigger.
--      `service_role` conserva su grant de tabla completa (migración 0006,
--      `grant ... on all tables in schema identidad to service_role`) — intacto.
--
-- IMPORTANTE — por qué el re-grant incluye `tenant_id` (la PK) y NO rompe el
-- onboarding: `elegirProveedorDte` (`onboarding/dte/actions.ts`) hace un UPSERT
-- (`on conflict (tenant_id) do update ...`); PostgREST puede incluir `tenant_id`
-- en el `DO UPDATE SET`. Re-otorgar UPDATE sobre `tenant_id` es inofensivo — la
-- policy `courier_config_dte_update_interno` (`with check tenant_id = claim`)
-- impide moverlo a otro tenant; a lo más se "actualiza" a su propio valor. Se
-- excluye ÚNICAMENTE `emision_dte_real_habilitada`.
--
-- Idempotente: `create or replace function`, `drop trigger if exists`, y
-- REVOKE/GRANT (declarativos, reaplicables). Nada destructivo de datos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Barrera PRIMARIA — trigger de columna protegida (espejo de usuarios_perfil)
-- -----------------------------------------------------------------------------
create or replace function identidad.courier_config_dte_proteger_opt_in_dte()
returns trigger
language plpgsql
as $$
begin
  -- Nada que proteger si el opt-in no cambia: cualquier rol interno sigue
  -- actualizando el resto de la fila (proveedor, estado, referencias de
  -- certificado/credenciales) sin fricción.
  if new.emision_dte_real_habilitada is not distinct from old.emision_dte_real_habilitada then
    return new;
  end if;

  -- El opt-in de emisión DTE real SOLO lo cambia `service_role` (la acción
  -- auditada del super-admin: SUPER_ADMIN_SECRET + bitácora `super_admin`).
  --   - `auth.role()` = 'service_role' cubre el cliente service_role real
  --     (PostgREST fija ese claim en el JWT del `crearClienteServiceRole()`).
  --   - `current_user in (...)` cubre el rol de Postgres efectivo tras
  --     `set role service_role` (así lo conmuta PostgREST) y los roles de
  --     mantención/migración (postgres, supabase_admin) — que además hacen
  --     bypass de RLS y de grants por ser superusuarios.
  -- Cualquier otro rol (authenticated = interno del courier, anon) → 42501.
  if auth.role() = 'service_role'
     or current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  raise exception using
    errcode = '42501',
    message = 'No autorizado: emision_dte_real_habilitada (opt-in de emisión DTE real al SII) '
              'solo se cambia vía service_role — acción auditada del super-admin de Rutax '
              '(SUPER_ADMIN_SECRET + sesión admin + bitácora super_admin). El courier no '
              'puede auto-habilitarla (ítem 8: opt-in DTE real revisado por Rutax ANTES).';
end;
$$;

comment on function identidad.courier_config_dte_proteger_opt_in_dte() is
  'Guard de columna protegida (before update, for each row): rechaza con 42501
   cualquier cambio de emision_dte_real_habilitada hecho por un rol distinto de
   service_role (superadmin auditado). Espejo de
   usuarios_perfil_proteger_columnas_sensibles. Barrera PRIMARIA del opt-in DTE
   real (ítem 8); la barrera secundaria es el grant de columna más abajo.';

drop trigger if exists trg_courier_config_dte_proteger_opt_in on identidad.courier_config_dte;
create trigger trg_courier_config_dte_proteger_opt_in
  before update on identidad.courier_config_dte
  for each row execute function identidad.courier_config_dte_proteger_opt_in_dte();

-- -----------------------------------------------------------------------------
-- 2. Barrera SECUNDARIA — privilegio de COLUMNA (defensa en profundidad)
-- -----------------------------------------------------------------------------
-- De UPDATE de tabla completa (migración 0003) a UPDATE sobre la lista de
-- columnas SIN `emision_dte_real_habilitada`. Un UPDATE que toque el flag es
-- denegado (42501) por el motor de Postgres, aun antes del trigger, venga por
-- la vista `public.courier_config_dte` (security_invoker → chequea privilegios
-- del invocador sobre la tabla base) o por el schema `identidad` directo.
revoke update on identidad.courier_config_dte from authenticated;

grant update (
  tenant_id,                     -- incluido a propósito: upsert de onboarding (ver cabecera)
  proveedor_dte,
  proveedor_credenciales_ref,
  certificado_digital_ref,
  certificado_vence_en,
  estado_certificacion,
  creado_en,
  actualizado_en
) on identidad.courier_config_dte to authenticated;

-- La vista espejo `public.courier_config_dte` conserva su grant de UPDATE de
-- tabla (migración 0003): con security_invoker=true, el privilegio EFECTIVO que
-- decide qué columnas puede tocar el courier es el de la tabla base (arriba).
-- No hace falta tocar el grant de la vista.

comment on column identidad.courier_config_dte.emision_dte_real_habilitada is
  'Opt-in explícito del courier para emitir DTE REAL al SII (no sandbox).
   Default false. Doble barrera de escritura (solo service_role la cambia,
   ítem 8): (1) trigger courier_config_dte_proteger_opt_in_dte → 42501 si un rol
   no-service_role intenta cambiarla; (2) authenticated NO tiene privilegio
   UPDATE sobre esta columna (grant de columna, esta migración). La emisión real
   exige, ADEMÁS, DTE_SANDBOX_MODE=false a nivel de plataforma y la acción humana
   emitirFacturaPeriodo — este flag es solo UNA de las condiciones, nunca un atajo.';
