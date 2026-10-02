-- =============================================================================
-- identidad.auth_usuario_id_por_email: buscar una cuenta de Auth por su correo
-- =============================================================================
--
-- QUÉ REEMPLAZA
-- `src/modules/identidad/cuenta-por-email.ts` buscaba al usuario recorriendo
-- `auth.admin.listUsers` página por página (hasta 25 llamadas por consulta) y,
-- ante cualquier error de esa API, respondía «no existe». En local esa API
-- responde 500 «Database error finding users» (usuarios sembrados por SQL), así
-- que el registro de courier dejaba pasar correos que YA eran cuenta de Rutax
-- —incluido el dueño de demo— y les mandaba el código. Lo detectó el QA del
-- 2026-10-02. En producción la API suele responder, pero fallar abierto ante un
-- error cualquiera es justo lo que esta comprobación no puede hacer.
--
-- QUÉ ES
-- Una consulta directa, por índice, a `auth.users`. SECURITY DEFINER porque
-- `auth.users` no es legible para ningún rol de aplicación; por eso mismo solo
-- `service_role` puede ejecutarla: revelaría si un correo tiene cuenta.
--
-- Idempotente.
-- =============================================================================

create or replace function identidad.auth_usuario_id_por_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, auth
as $$
  select u.id
    from auth.users u
   where lower(u.email) = lower(trim(p_email))
   order by u.created_at
   limit 1;
$$;

comment on function identidad.auth_usuario_id_por_email(text) is
  'Id de la cuenta de Auth con ese correo (sin distinguir mayúsculas), o NULL.
   Solo service_role: responde si un correo tiene cuenta en Rutax. Reemplaza el
   recorrido de auth.admin.listUsers, que fallaba abierto (20261002000001).';

-- `create or replace` no resetea la ACL: se revoca explícitamente.
revoke all on function identidad.auth_usuario_id_por_email(text) from public, anon, authenticated;
grant execute on function identidad.auth_usuario_id_por_email(text) to service_role;

notify pgrst, 'reload schema';
