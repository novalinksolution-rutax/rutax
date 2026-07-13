-- =============================================================================
-- 20260711000001 · Plataforma — super_admins (identidad real del backstage `/admin`)
-- =============================================================================
-- Migración ADITIVA e IDEMPOTENTE. "Ola 0" del trabajo de suscripciones de
-- plataforma (F2). Cierra la DEUDA DE GOBERNANZA #1 (gap 3, F2-mínimo): hoy el
-- backstage `/admin` autentica con un secreto compartido (SUPER_ADMIN_SECRET,
-- cookie HMAC) y NO tiene una identidad Supabase real, así que toda acción del
-- super-admin se registra en identidad.bitacora_auditoria con actor_usuario_id =
-- NULL. Esta tabla mapea un `auth.users` REAL (el fundador / equipo Rutax) a su
-- identidad de backstage, para que el backend pueda alimentar un `actorUsuarioId`
-- real y trazable en la bitácora de plataforma.
--
-- RESTRICCIÓN DURA — la FK de la bitácora:
--   identidad.bitacora_auditoria.actor_usuario_id es
--     `uuid references auth.users(id) on delete set null`
--   (migración 20260101000004). En consecuencia, el id que se escriba ahí DEBE
--   ser un id real de auth.users o NULL — un uuid sintético rompería la FK. Por
--   eso `usuario_id` REFERENCIA auth.users(id): garantiza que el actor de la
--   bitácora exista de verdad. Esta migración NO toca la app; solo provee el
--   sustrato de datos. El cableado (leer super_admins → actorUsuarioId) es trabajo
--   posterior del backend.
--
-- AISLAMIENTO — MISMO deny-all que el resto de `plataforma` (crítico, prio #1):
--   El schema `plataforma` es DENY-ALL para `authenticated`/`anon` (RLS
--   enable+force SIN políticas + grants revocados, migración base 0015
--   20260621000015). Esta tabla sigue EXACTAMENTE ese patrón: RLS enable+force,
--   NINGUNA política para authenticated/anon (deny-all por ausencia de política),
--   grants SOLO a service_role, y revoke a authenticated/anon/public como defensa
--   en profundidad. Un courier autenticado no puede leer NI la existencia del
--   fundador/equipo Rutax. (Verificado en rls_aislamiento_plataforma.test.sql.)
--
--   PROHIBICIÓN: NO se crea ninguna vista public.* sobre esta tabla — una vista
--   en `public` la expondría vía PostgREST y eludiría el deny-all del schema.
--
-- DECISIONES de modelado:
--   • usuario_id PK + FK a auth.users con ON DELETE RESTRICT (no cascade, no set
--     null): borrar el auth user NO debe borrar silenciosamente el registro de
--     gobernanza. Como es PK no puede ser NULL, así que RESTRICT es lo correcto —
--     obliga a desactivar/limpiar explícitamente antes de borrar el auth user.
--   • rol_admin con CHECK ('admin_total','soporte_lectura'): deja preparado el rol
--     fino para F3. En F2 solo se usa 'admin_total' (default).
--   • Sin DELETE en los grants (gobernanza append-ish): desactivar un super-admin
--     es `activo = false`, no un DELETE que borre el rastro.
--
-- Idempotente: create table/index IF NOT EXISTS; enable/force RLS, grants,
-- revokes y comments son re-aplicables. Re-ejecutable sobre una base ya migrada.
-- =============================================================================

-- El schema ya existe (migración 0015); create defensivo e idempotente.
create schema if not exists plataforma;

-- -----------------------------------------------------------------------------
-- 1. plataforma.super_admins — auth.users real → identidad de backstage
-- -----------------------------------------------------------------------------
create table if not exists plataforma.super_admins (
  -- PK = el id del usuario en auth.users. FK con RESTRICT: no se puede borrar el
  -- auth user mientras exista este registro de gobernanza (ver cabecera).
  usuario_id  uuid primary key references auth.users(id) on delete restrict,

  email       text not null unique,
  nombre      text not null,

  -- Rol fino preparado para F3; en F2 solo 'admin_total'.
  rol_admin   text not null default 'admin_total'
                check (rol_admin in ('admin_total','soporte_lectura')),

  -- Desactivar = activo=false (nunca DELETE — sin grant de delete a service_role).
  activo      boolean not null default true,

  creado_en   timestamptz not null default now()
);

comment on table plataforma.super_admins is
  'Mapea un auth.users REAL (fundador / equipo Rutax) a su identidad de backstage '
  '`/admin`. Alimenta el actorUsuarioId REAL de la bitácora de plataforma — cierra '
  'la deuda de gobernanza #1 (hoy el backstage escribe actor_usuario_id=NULL). '
  'Fuera de todo tenant (no es courier ni pertenece a uno). Sin políticas RLS para '
  'authenticated: solo service_role accede (mismo deny-all que el resto de plataforma).';
comment on column plataforma.super_admins.usuario_id is
  'Id en auth.users (FK ON DELETE RESTRICT). Es el valor que va a '
  'identidad.bitacora_auditoria.actor_usuario_id para el super-admin.';
comment on column plataforma.super_admins.rol_admin is
  'admin_total (default, F2) | soporte_lectura (preparado para F3, aún sin uso).';
comment on column plataforma.super_admins.activo is
  'Baja lógica del super-admin. Desactivar = activo=false; nunca DELETE (sin rastro).';

-- Índice para filtrar super-admins vigentes (activo=true) al resolver el actor.
create index if not exists idx_super_admins_activo
  on plataforma.super_admins (activo);

-- -----------------------------------------------------------------------------
-- 2. RLS — DENY-ALL para authenticated/anon (idéntico al resto de `plataforma`)
-- -----------------------------------------------------------------------------
-- RLS habilitada + forzada SIN ninguna política = deny-all para roles sujetos a
-- RLS. service_role bypasea RLS en Supabase, así que el super-admin/jobs sí operan.
alter table plataforma.super_admins enable row level security;
alter table plataforma.super_admins force  row level security;

-- -----------------------------------------------------------------------------
-- 3. Grants — solo service_role, SIN delete. Nada para authenticated/anon.
-- -----------------------------------------------------------------------------
-- usage on schema ya otorgado en 0015; re-afirmado por idempotencia/higiene.
grant usage on schema plataforma to service_role;

-- Sin DELETE a propósito: la baja es lógica (activo=false), no se borra el rastro.
grant select, insert, update on plataforma.super_admins to service_role;

-- Defensa en profundidad: aunque RLS ya niega, revocamos cualquier grant heredado
-- a authenticated/anon/public sobre la tabla nueva.
revoke all on plataforma.super_admins from authenticated, anon, public;
