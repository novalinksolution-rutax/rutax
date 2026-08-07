-- =============================================================================
-- Identidad — Cierra la exposición del TOKEN de invitación a usuarios internos
-- =============================================================================
-- HALLAZGO. Tres hechos preexistentes, cada uno razonable por separado:
--
--   1. `grant select, insert, update on identidad.invitaciones to authenticated`
--      (migración 0001 §9) — a nivel de TABLA COMPLETA, incluida `token`.
--   2. `public.invitaciones` se creó como `select *` (0001 §5), así que la vista
--      también espeja `token`.
--   3. La política `invitaciones_select_interno` solo exige
--      `tipo_usuario = 'interno'`; NO mira el rol.
--
-- Combinados: CUALQUIER usuario interno del courier —incluidos `coordinador` y
-- `administracion`, que por RBAC explícitamente NO pueden invitar— puede pedir
-- `GET /rest/v1/invitaciones?estado=eq.pendiente&select=token,email,rol` y abrir
-- `/invitacion/<token>`, entrando como ese seller. Si hay una invitación
-- pendiente con `rol = 'dueno'`, la consume y se vuelve dueño del tenant.
--
-- Y no bastaba con arreglar la vista: `supabase/config.toml` expone el esquema
-- `identidad` DIRECTO por PostgREST, así que `Accept-Profile: identidad` alcanza
-- la tabla base sin pasar por `public`. Es EXACTAMENTE la misma forma del
-- hallazgo de `snapshot_regla` (migración 20260707000002) — segunda vez que un
-- grant de tabla completa filtra una columna que la vista creía proteger.
--
-- Con INSERT/UPDATE de tabla completa había además dos caminos de escritura:
-- reescribir el `token` de una invitación ajena a un valor conocido, o insertar
-- una invitación nueva con `rol = 'dueno'` y token elegido. Mismo desenlace.
--
-- ARREGLO (tres barreras):
--   A. SELECT por COLUMNA — se revoca el grant de tabla y se re-otorga sobre la
--      lista explícita SIN `token`. Es la barrera que de verdad cierra el
--      Accept-Profile directo.
--   B. Se revocan INSERT y UPDATE de `authenticated`. TODAS las escrituras de la
--      aplicación ya van por `service_role` (`crearInvitacion`,
--      `revocarInvitacion`, `aceptarInvitacion` y las acciones de /equipo y
--      /sellers); verificado call site por call site antes de escribir esto. Los
--      dos únicos lugares que usan el cliente de sesión son LECTURAS de
--      `(id, email, rol, estado, expira_en, creado_en)` en el panel de equipo,
--      que la barrera A conserva intactas.
--   C. `public.invitaciones` se recrea SIN `token` (no basta `create or replace`:
--      no puede eliminar una columna existente, hay que dropear y recrear).
--
-- Las políticas RLS de INSERT/UPDATE se dejan en pie a propósito: son la guarda
-- de FILA si alguna vez se restituye un grant de escritura. Hoy quedan inertes.
--
-- `service_role` NO se toca: su grant es independiente y el flujo de
-- invitaciones depende de él por completo.
--
-- Idempotente: REVOKE/GRANT son declarativos; la vista usa drop + create.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. SELECT de tabla completa → SELECT por columna, sin `token`.
-- -----------------------------------------------------------------------------
revoke select on identidad.invitaciones from authenticated;

grant select (
  id,
  tenant_id,
  email,
  tipo_usuario,
  rol,
  seller_id,
  driver_id,
  estado,
  expira_en,
  creado_en
) on identidad.invitaciones to authenticated;

-- -----------------------------------------------------------------------------
-- B. Sin escritura para `authenticated` — todo pasa por service_role.
-- -----------------------------------------------------------------------------
revoke insert, update on identidad.invitaciones from authenticated;

-- -----------------------------------------------------------------------------
-- C. Vista espejo sin `token`.
--    Sin CASCADE a propósito: si algo dependiera de esta vista, preferimos que
--    la migración falle ruidosamente a dropear el dependiente en silencio.
-- -----------------------------------------------------------------------------
drop view if exists public.invitaciones;

create view public.invitaciones
  with (security_invoker = true)
  as select
    id,
    tenant_id,
    email,
    tipo_usuario,
    rol,
    seller_id,
    driver_id,
    estado,
    expira_en,
    creado_en
  from identidad.invitaciones;

revoke all on public.invitaciones from authenticated, anon;
grant select on public.invitaciones to authenticated;

comment on column identidad.invitaciones.token is
  'Secreto de UN SOLO USO: quien lo tiene ENTRA como el invitado (seller,
   conductor o interno con su rol). Triple barrera de confidencialidad:
   (1) la vista public.invitaciones lo omite, (2) `authenticated` NO tiene
   privilegio SELECT sobre esta columna en la tabla base — cierra el acceso
   directo vía Accept-Profile: identidad, (3) `authenticated` no puede escribir
   la tabla, así que tampoco puede reescribirlo a un valor conocido. Solo
   `service_role` lo lee y lo escribe. NUNCA va a bitácora, logs ni URLs salvo
   la del canje. La entrega deliberada al courier pasa por la acción auditada
   `obtenerInvitacionPendienteSeller`, que exige `puedeInvitarUsuarios`.';

comment on view public.invitaciones is
  'Superficie PostgREST de identidad.invitaciones para roles internos. Omite
   `token` a propósito (ver comentario de esa columna). Si se agregan columnas a
   la tabla base, NO se re-emite esta vista con `select *`: la lista explícita es
   parte de la barrera.';
