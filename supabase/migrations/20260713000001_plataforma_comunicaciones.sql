-- =============================================================================
-- 20260713000001 · Plataforma — comunicaciones de Rutax a los couriers (banner in-app)
-- =============================================================================
-- Migración ADITIVA e IDEMPOTENTE. F3 · Gap 7 (comunicaciones a couriers) del
-- backstage. Rutax (super-admin) publica COMUNICACIONES a los couriers
-- (mantención, novedades, avisos) que se muestran como banner in-app en el área
-- `(tenant)` del courier y, opcionalmente, por email. Es el canal "one-to-many"
-- de Rutax hacia sus clientes, distinto de los avisos operativos que el courier
-- se genera solo (conexiones caídas, folios bajos, etc. — src/lib/avisos).
--
-- AISLAMIENTO — MISMO deny-all que el resto de `plataforma` (crítico, prio #1):
--   El schema `plataforma` es DENY-ALL para `authenticated`/`anon` (RLS
--   enable+force SIN políticas + grants revocados, migración base 0015
--   20260621000015). Esta tabla sigue EXACTAMENTE ese patrón: RLS enable+force,
--   NINGUNA política para authenticated/anon (deny-all por ausencia de política),
--   grants SOLO a service_role (SIN delete), y revoke a authenticated/anon/public
--   como defensa en profundidad.
--
--   EL COURIER NUNCA LEE ESTA TABLA DIRECTO. Aunque la comunicación esté DESTINADA
--   al courier, éste NO la consulta vía PostgREST: el agregador de avisos
--   server-side (`src/lib/avisos`) la leerá vía service_role y proyectará banners
--   "courier-safe" — el MISMO modelo híbrido A que el resto de `plataforma`
--   (service_role lee el backstage y expone en la UI solo lo pertinente). Así la
--   comunicación se muestra sin que el courier tenga acceso de lectura a la tabla,
--   ni pueda descubrir borradores/comunicaciones desactivadas o de otros tenants.
--
--   PROHIBICIÓN: NO se crea ninguna vista public.* sobre esta tabla — una vista en
--   `public` la expondría vía PostgREST y eludiría el deny-all del schema.
--
-- ALINEACIÓN CON `Aviso` (src/lib/avisos/obtener-avisos.ts):
--   El campo `nivel` ('informativo' | 'importante' | 'urgente') reusa EXACTAMENTE
--   el dominio del tipo `UrgenciaAviso` de la app, para que el agregador pueda
--   mapear la comunicación a un `Aviso` (que jerarquiza y colorea el banner) sin
--   traducción de valores. `tipo` es la categoría editorial de Rutax (info /
--   mantencion / novedad / alerta) — ortogonal al color/urgencia del banner.
--
-- ALCANCE — GLOBAL por ahora (a TODOS los couriers):
--   Esta primera versión NO tiene segmentación por tenant: cada comunicación
--   activa y vigente aplica a todos los couriers. NO se agrega `tenant_id` todavía
--   (mantener el esquema honesto: sin columnas que hoy serían siempre NULL).
--   EXTENSIÓN FUTURA (cuando se necesite targeting): añadir un `tenant_id uuid`
--   NULLABLE (null = global, valor = dirigida a ese courier) con su FK a
--   identidad.tenants e índice, y que el agregador filtre por
--   `tenant_id is null or tenant_id = <tenant del courier>`. No se hace ahora.
--
-- DECISIONES de modelado:
--   • creado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL: el super-admin
--     que la creó (RNF-04, el "quién"). SET NULL — igual que
--     identidad.bitacora_auditoria.actor_usuario_id — para no borrar la
--     comunicación si se elimina el auth user; se conserva el rastro con autor nulo.
--   • Sin DELETE en los grants: desactivar una comunicación es `activa = false`,
--     no un DELETE que borre el rastro (misma política append-ish que super_admins).
--   • vigente_desde / vigente_hasta: ventana de vigencia. vigente_hasta NULL = sin
--     expiración. El banner se muestra si `activa AND now() >= vigente_desde AND
--     (vigente_hasta IS NULL OR now() < vigente_hasta)`.
--   • Trigger de actualizado_en reusa plataforma.set_actualizado_en() (creada en la
--     migración 20260712000002 para el CRUD de planes) — no se duplica la utilidad.
--
-- Idempotente: create schema/table/index IF NOT EXISTS; enable/force RLS, grants,
-- revokes, DROP TRIGGER IF EXISTS + CREATE TRIGGER y comments son re-aplicables.
-- Re-ejecutable sobre una base ya migrada. Nada de DDL crudo fuera de migraciones.
-- =============================================================================

-- El schema ya existe (migración 0015); create defensivo e idempotente.
create schema if not exists plataforma;

-- -----------------------------------------------------------------------------
-- 1. plataforma.comunicaciones — comunicaciones de Rutax al courier (banner in-app)
-- -----------------------------------------------------------------------------
create table if not exists plataforma.comunicaciones (
  id             uuid primary key default gen_random_uuid(),

  titulo         text not null,
  cuerpo         text not null,

  -- Categoría editorial de Rutax (ortogonal al color/urgencia del banner).
  tipo           text not null default 'info'
                   check (tipo in ('info','mantencion','novedad','alerta')),

  -- Urgencia = color del banner. Reusa el dominio de UrgenciaAviso (src/lib/avisos)
  -- para mapear sin traducción a un `Aviso` del agregador server-side.
  nivel          text not null default 'informativo'
                   check (nivel in ('informativo','importante','urgente')),

  -- Baja lógica: desactivar = activa=false (nunca DELETE — sin grant de delete).
  activa         boolean not null default true,

  -- Ventana de vigencia. vigente_hasta NULL = sin expiración.
  vigente_desde  timestamptz not null default now(),
  vigente_hasta  timestamptz,

  -- Si además se manda por correo (el envío en sí es trabajo del backend/job).
  enviar_email   boolean not null default false,

  -- El super-admin que la creó (RNF-04, el "quién"). SET NULL al borrar el auth
  -- user: se conserva la comunicación con autor nulo (igual que la bitácora).
  creado_por     uuid references auth.users(id) on delete set null,

  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table plataforma.comunicaciones is
  'Comunicaciones de Rutax (super-admin) a los couriers: banner in-app en el área '
  '(tenant) y, opcional, email. GLOBAL por ahora (a todos los couriers; sin '
  'targeting por tenant todavía). El courier NUNCA lee esta tabla directo: el '
  'agregador src/lib/avisos la lee vía service_role y proyecta banners courier-safe '
  '(modelo híbrido A). Sin políticas RLS para authenticated: solo service_role.';
comment on column plataforma.comunicaciones.tipo is
  'Categoría editorial de Rutax: info | mantencion | novedad | alerta. Ortogonal a nivel.';
comment on column plataforma.comunicaciones.nivel is
  'Urgencia/color del banner. Dominio alineado con UrgenciaAviso de src/lib/avisos '
  '(informativo | importante | urgente) para mapear a un Aviso sin traducir valores.';
comment on column plataforma.comunicaciones.activa is
  'Baja lógica. Desactivar = activa=false; nunca DELETE (sin grant de delete, sin rastro perdido).';
comment on column plataforma.comunicaciones.vigente_hasta is
  'Fin de la ventana de vigencia. NULL = sin expiración.';
comment on column plataforma.comunicaciones.enviar_email is
  'Si la comunicación además se envía por correo. El envío lo ejecuta el backend/job.';
comment on column plataforma.comunicaciones.creado_por is
  'auth.users(id) del super-admin que la creó (RNF-04, el "quién"). ON DELETE SET NULL.';

-- Índice para el query del banner: comunicaciones activas ordenadas/filtradas por
-- inicio de vigencia. El agregador filtra por activa=true y la ventana de vigencia.
create index if not exists idx_comunicaciones_activa_vigente
  on plataforma.comunicaciones (activa, vigente_desde);

-- -----------------------------------------------------------------------------
-- 2. Trigger de actualizado_en — reusa plataforma.set_actualizado_en() (0015-planes)
-- -----------------------------------------------------------------------------
-- La función ya existe (migración 20260712000002). No se redefine; solo se ata el
-- trigger a esta tabla. DROP IF EXISTS + CREATE = idempotente.
drop trigger if exists trg_comunicaciones_actualizado_en on plataforma.comunicaciones;
create trigger trg_comunicaciones_actualizado_en
  before update on plataforma.comunicaciones
  for each row execute function plataforma.set_actualizado_en();

-- -----------------------------------------------------------------------------
-- 3. RLS — DENY-ALL para authenticated/anon (idéntico al resto de `plataforma`)
-- -----------------------------------------------------------------------------
-- RLS habilitada + forzada SIN ninguna política = deny-all para roles sujetos a
-- RLS. service_role bypasea RLS en Supabase, así que el super-admin/jobs sí operan.
alter table plataforma.comunicaciones enable row level security;
alter table plataforma.comunicaciones force  row level security;

-- -----------------------------------------------------------------------------
-- 4. Grants — solo service_role, SIN delete. Nada para authenticated/anon.
-- -----------------------------------------------------------------------------
-- usage on schema ya otorgado en 0015; re-afirmado por idempotencia/higiene.
grant usage on schema plataforma to service_role;

-- Sin DELETE a propósito: la baja es lógica (activa=false), no se borra el rastro.
grant select, insert, update on plataforma.comunicaciones to service_role;

-- Defensa en profundidad: aunque RLS ya niega, revocamos cualquier grant heredado
-- a authenticated/anon/public sobre la tabla nueva.
revoke all on plataforma.comunicaciones from authenticated, anon, public;
