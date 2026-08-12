-- =============================================================================
-- bitacora_auditoria: fijar el privilegio "solo service_role INSERTA, nadie
-- ACTUALIZA ni BORRA" — append-only real, también para service_role
-- =============================================================================
-- CONTEXTO (bug de producción 2026-08-11): el alta de conductores fallaba con
-- "permission denied for VIEW bitacora_auditoria" porque `crearConductor`
-- escribía la bitácora con el cliente de la SESIÓN del usuario en vez de con
-- `service_role`. La base de datos hizo exactamente lo que debía: negar. El
-- arreglo fue de aplicación (traer el cliente correcto), NO conceder INSERT a
-- `authenticated` — una bitácora que el usuario final puede escribir se puede
-- fabricar desde el navegador vía PostgREST y deja de ser evidencia (RNF-04).
--
-- Esta migración no cambia ese veredicto: lo deja escrito en los privilegios y
-- cierra el hueco que quedaba del OTRO lado. Hasta hoy:
--   • `authenticated`/`anon`: sin INSERT/UPDATE/DELETE, ni en la tabla base ni
--     en la vista espejo (migración 0004 §5). Correcto — se re-afirma aquí para
--     que este archivo sea el enunciado completo del invariante.
--   • `service_role`: además de INSERT tenía UPDATE y DELETE, heredados de dos
--     grants "en bloque" —`grant ... on all tables in schema identidad`
--     (20260601000006) y `grant insert, update, delete on all tables in schema
--     public` (20260613000002)—, que barrieron también la bitácora. O sea, el
--     "append-only real, sin UPDATE/DELETE para NADIE" que documenta la 0004 era
--     cierto solo para los roles de cliente: cualquier función de servidor podía
--     reescribir o borrar una entrada ya registrada, y ese es justamente el rol
--     que usa todo el backend. Se revoca.
--
-- Por qué privilegios y no un trigger que prohíba UPDATE/DELETE: la columna
-- `actor_usuario_id` tiene FK a `auth.users` con ON DELETE SET NULL, y esa
-- acción referencial ejecuta un UPDATE interno sobre esta tabla al borrar un
-- usuario. Un trigger tendría que distinguir ese caso y sería frágil; el
-- chequeo de privilegios, en cambio, NO se aplica a las acciones referenciales
-- (corren con los permisos del dueño de la tabla), así que borrar un usuario
-- sigue funcionando y la fila conserva su rastro con autor nulo.
--
-- Consecuencia deliberada: si algún día se necesita purgar la bitácora por
-- retención, hará falta una migración explícita que conceda DELETE. Eso es el
-- punto: que borrar auditoría exija una decisión revisada, no un `.delete()`.
--
-- Idempotente: GRANT/REVOKE/COMMENT son re-aplicables sin error.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Roles de cliente: ni escribir, ni corregir, ni borrar. Solo leer lo suyo
--    (la policy `bitacora_auditoria_select_interno` de la 0004 acota a internos
--    del propio tenant; el seller y el conductor no ven nada).
-- -----------------------------------------------------------------------------
revoke insert, update, delete on identidad.bitacora_auditoria from authenticated, anon, public;
revoke insert, update, delete on public.bitacora_auditoria    from authenticated, anon, public;

grant select on identidad.bitacora_auditoria to authenticated;
grant select on public.bitacora_auditoria    to authenticated;

-- -----------------------------------------------------------------------------
-- 2. service_role: única puerta de escritura, y solo para APPEND.
--    El REVOKE va antes del GRANT a propósito: `revoke update, delete` no toca
--    el INSERT, y el grant posterior lo deja afirmado explícitamente (no
--    heredado de un grant en bloque que un revoke futuro sobre PUBLIC pueda
--    volver a barrer — el tropiezo exacto de la migración 20260601000009).
-- -----------------------------------------------------------------------------
revoke update, delete on identidad.bitacora_auditoria from service_role;
revoke update, delete on public.bitacora_auditoria    from service_role;

grant select, insert on identidad.bitacora_auditoria to service_role;
grant select, insert on public.bitacora_auditoria    to service_role;

-- -----------------------------------------------------------------------------
-- 3. Dejar el contrato escrito donde se lee el esquema.
-- -----------------------------------------------------------------------------
comment on view public.bitacora_auditoria is
  'Vista espejo (security_invoker) de identidad.bitacora_auditoria. Append-only:
   INSERT solo para service_role (funciones de servidor y jobs); UPDATE/DELETE
   para NADIE, ni siquiera service_role. Los roles de cliente solo tienen SELECT,
   acotado por RLS a los internos de su propio tenant. Si un flujo necesita
   auditar, trae un cliente service_role (crearClienteServiceRole) — no se
   concede INSERT a authenticated.';
