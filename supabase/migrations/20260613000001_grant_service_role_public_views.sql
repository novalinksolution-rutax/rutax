-- =============================================================================
-- Fix: service_role debe poder LEER las vistas públicas (no solo bitacora)
-- =============================================================================
-- Mismo bug latente que arregló 20260601000009 para `bitacora_auditoria`, pero
-- generalizado: la migración 0004 hizo `revoke ... from PUBLIC` sobre las vistas
-- `security_invoker` de `public`. Como `service_role` recibía esos privilegios a
-- través del pseudo-rol PUBLIC, el revoke se los quitó y solo se re-otorgaron
-- para `bitacora_auditoria`. El resto de las vistas (pedidos, manifiestos,
-- incidencias, sellers, conexiones_seller_ml, folios_caf, etc.) quedaron sin
-- SELECT para service_role → toda lectura del lado servidor con el cliente
-- service_role a través de esas vistas fallaba con
-- "permission denied for view ...". Esto rompía, entre otros, el dashboard del
-- dueño (métricas) y el panel de operaciones.
--
-- Las tablas base (esquemas identidad/operacion/dinero) ya conceden a
-- service_role; como las vistas son `security_invoker = true`, el SELECT a
-- través de la vista corre con los privilegios de service_role sobre la tabla
-- base (que ya existen). Solo falta el privilegio sobre las VISTAS.
--
-- Se otorga SELECT sobre todas las relaciones de `public` (que son únicamente
-- las vistas espejo — las tablas base viven en otros esquemas) y se fija el
-- privilegio por defecto para vistas futuras. Inofensivo: service_role es
-- server-only y ya hace bypass de RLS.
--
-- Idempotente: GRANT y ALTER DEFAULT PRIVILEGES son repetibles sin error.
-- =============================================================================

grant select on all tables in schema public to service_role;

alter default privileges in schema public
  grant select on tables to service_role;
