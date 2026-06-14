-- =============================================================================
-- Fix: service_role debe poder ESCRIBIR a través de las vistas públicas
-- =============================================================================
-- Complementa 20260613000001, que solo re-otorgó SELECT a service_role tras el
-- `revoke ... from PUBLIC` de la migración 0004. Las Server Actions escriben con
-- el cliente service_role a través de las vistas espejo de `public`
-- (p. ej. `.from("manifiestos" | "pedidos" | "incidencias" | "periodos_cobro" ...)`,
-- que resuelven al esquema `public` = vistas `security_invoker`). Con solo SELECT,
-- toda escritura interactiva (crear manifiesto, pedido same-day, actualizar
-- incidencia, cerrar período, etc.) fallaba con "permission denied for view ...".
--
-- Las vistas son `security_invoker = true` y auto-actualizables sobre una sola
-- tabla base; el INSERT/UPDATE/DELETE a través de la vista corre con los
-- privilegios de service_role sobre la tabla base (que ya existen). Solo falta
-- el privilegio DML sobre las VISTAS. `public` contiene únicamente estas vistas
-- espejo — las tablas base viven en identidad/operacion/dinero —, por lo que el
-- grant es acotado y seguro: service_role es server-only y ya hace bypass de RLS.
--
-- Idempotente: GRANT y ALTER DEFAULT PRIVILEGES son repetibles sin error.
-- =============================================================================

grant insert, update, delete on all tables in schema public to service_role;

alter default privileges in schema public
  grant insert, update, delete on tables to service_role;
