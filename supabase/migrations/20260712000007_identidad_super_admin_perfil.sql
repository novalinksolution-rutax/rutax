-- =============================================================================
-- 20260712000007 · Identidad — perfil de dominio del super-admin (revierte "Ola 0")
-- =============================================================================
-- Migración ADITIVA e IDEMPOTENTE. F3-A del backstage `/admin`: identidad REAL
-- del super-admin.
--
-- CONTEXTO / POR QUÉ (revierte deliberadamente una decisión de la Ola 0):
--   La Ola 0 (migración 20260711000001 + seed) creó al fundador Rutax en
--   `auth.users` y en `plataforma.super_admins`, pero DELIBERADAMENTE NO le creó
--   fila en `identidad.usuarios_perfil`. Esa omisión fue correcta MIENTRAS el
--   gate del backstage era un secreto compartido (SUPER_ADMIN_SECRET + cookie
--   HMAC): el super-admin no necesitaba sesión Supabase real ni claims de JWT.
--
--   F3 cambia esa premisa: el backstage pasa a SESIÓN SUPABASE REAL. El
--   `identidad.custom_access_token_hook` (migración 20260101000001 §6) inyecta el
--   claim top-level `tipo_usuario` (y `tenant_id/rol/estado_usuario`) SOLO si
--   existe fila en `usuarios_perfil`. Sin esa fila, una sesión real del
--   super-admin NO trae `tipo_usuario='super_admin'` y `esSuperAdminDePlataforma`
--   no reconoce al usuario. Por eso ahora SÍ se aprovisiona el perfil, con
--   `tenant_id = null` (fuera de todo tenant).
--
-- POR QUÉ tenant_id = null NO viola ningún constraint de usuarios_perfil:
--   · usuarios_perfil_tenant_excepto_super_admin:
--       (tipo_usuario='super_admin' AND tenant_id IS NULL) OR (...) — la fila cae
--       en la PRIMERA rama (super_admin + tenant_id null). OK.
--   · usuarios_perfil_rol_coherente_con_tipo:
--       (tipo_usuario='super_admin' AND rol='super_admin') OR (...) — rama 1. OK.
--   · usuarios_perfil_seller_id_coherente / _driver_id_coherente:
--       tipo_usuario<>'seller'/<>'conductor' con seller_id/driver_id NULL. OK.
--   La columna de estado es `estado` (enum identidad.estado_usuario:
--   activo|invitado|suspendido); usamos 'activo'.
--
-- DÓNDE VIVE EL FUNDADOR (migración vs seed):
--   El fundador es DATO: su `auth.users` + `plataforma.super_admins` viven en
--   `supabase/seed.sql` (NO en migración). Su fila `usuarios_perfil` sigue el
--   MISMO patrón y se inserta explícitamente en `seed.sql`, porque:
--     (a) usuarios_perfil.id REFERENCES auth.users(id); hardcodear un INSERT del
--         uuid `ad000000-…` en esta migración rompería la FK en entornos reales,
--         donde ese auth.users solo existe si corrió el seed.
--     (b) `db reset` corre migraciones ANTES del seed, así que en un reset limpio
--         `plataforma.super_admins` está VACÍA cuando corre esta migración.
--   Esta migración aporta, en cambio, el MECANISMO DE APROVISIONAMIENTO genérico
--   para ENTORNOS REALES ya migrados: un backfill idempotente que garantiza que
--   TODO super-admin activo presente en `plataforma.super_admins` (cualquiera sea
--   su uuid real) tenga su perfil `usuarios_perfil` tenant-less. En un reset
--   limpio es un no-op (super_admins vacía); el seed cubre el caso demo.
--
-- Idempotente: INSERT … SELECT … ON CONFLICT (id) DO NOTHING. Re-aplicable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Backfill: sincroniza plataforma.super_admins → identidad.usuarios_perfil.
-- Para cada super-admin ACTIVO cuyo auth.users exista y que aún no tenga perfil,
-- crea la fila de dominio tenant-less. No pisa perfiles existentes (DO NOTHING).
-- -----------------------------------------------------------------------------
insert into identidad.usuarios_perfil
  (id, tenant_id, nombre_completo, tipo_usuario, rol, estado)
select
  sa.usuario_id,
  null::uuid,
  coalesce(nullif(btrim(sa.nombre), ''), 'Super Admin Rutax'),
  'super_admin'::identidad.tipo_usuario,
  'super_admin'::identidad.rol_usuario,
  'activo'::identidad.estado_usuario
from plataforma.super_admins sa
join auth.users u on u.id = sa.usuario_id
where sa.activo = true
on conflict (id) do nothing;

-- No hay grants/RLS que tocar: usuarios_perfil ya tiene RLS enable+force y la
-- política usuarios_perfil_select (migración 0001) filtra por
-- tenant_id = claim_tenant_id(). Con tenant_id=null la fila del super-admin NUNCA
-- calza el claim de un courier → no hay fuga del backstage hacia ningún tenant
-- (verificado en supabase/tests/database/rls_aislamiento.test.sql).
