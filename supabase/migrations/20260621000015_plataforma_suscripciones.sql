-- =============================================================================
-- 0015 · Plataforma — Suscripciones de Rutax a los couriers (backstage financiero)
-- =============================================================================
-- Este schema maneja la facturación de la PLATAFORMA MISMA (Rutax → courier),
-- NO la facturación que los couriers hacen a sus sellers (eso vive en `dinero`).
-- Es el "backstage" financiero de Rutax: planes, suscripciones, períodos de cobro
-- mensual y pagos recibidos vía Fintoc.
--
-- AISLAMIENTO — CRÍTICO Y DISTINTO AL RESTO DEL SISTEMA:
--   Los couriers (tenants) NO deben ver NADA de este schema. A diferencia de las
--   tablas de negocio (`dinero`, `operacion`), aquí NO hay políticas para el rol
--   `authenticated`. RLS se activa SIN políticas = deny-all para usuarios normales.
--   Solo `service_role` (super-admin de Rutax + jobs Inngest), que bypasea RLS en
--   Supabase, lee/escribe. Esto es intencional: el courier no descubre qué plan
--   tiene mirando la DB — solo ve lo que le mostramos en la UI, intermediado por
--   el super-admin. No hay vistas en `public` para estas tablas por la misma razón.
--
-- NOTA SOBRE LA FK DEL TENANT:
--   La tabla del courier en este repo es `identidad.tenants` (no `identidad.couriers`).
--   El tenant ES el courier (ver CLAUDE.md). Se referencia `identidad.tenants(id)`.
--
-- Migración IDEMPOTENTE: CREATE SCHEMA / TABLE / INDEX IF NOT EXISTS; el seed con
-- ON CONFLICT DO NOTHING. Re-aplicable sobre una base ya migrada.
-- =============================================================================

create schema if not exists plataforma;

-- =============================================================================
-- 1. plataforma.planes — catálogo de planes de suscripción
-- =============================================================================
create table if not exists plataforma.planes (
  id                  uuid primary key default gen_random_uuid(),
  nombre              text not null unique,            -- "Starter", "Growth", "Enterprise"
  descripcion         text,
  precio_mensual_clp  int not null,                    -- CLP enteros
  precio_anual_clp    int not null,                    -- año completo (con descuento típico)
  limite_pedidos_mes  int,                             -- NULL = ilimitado
  caracteristicas     jsonb not null default '{}',     -- features: {"api_publica": true, ...}
  activo              boolean not null default true,
  creado_en           timestamptz not null default now()
);

comment on table plataforma.planes is
  'Catálogo de planes de suscripción de Rutax (Starter/Growth/Enterprise). '
  'Sin políticas RLS para authenticated: solo service_role accede.';
comment on column plataforma.planes.limite_pedidos_mes is
  'Tope de pedidos/mes del plan. NULL = ilimitado.';
comment on column plataforma.planes.caracteristicas is
  'Features del plan en jsonb (ej. {"api_publica": true, "conductores_max": 20}).';

create index if not exists idx_planes_activo
  on plataforma.planes (activo);

-- Seed inicial de planes (idempotente por nombre).
insert into plataforma.planes (nombre, precio_mensual_clp, precio_anual_clp, limite_pedidos_mes, caracteristicas) values
  ('Starter',    49000,   490000,  500,  '{"api_publica": false, "webhooks": false, "conductores_max": 5}'),
  ('Growth',     99000,   990000,  2000, '{"api_publica": true,  "webhooks": true,  "conductores_max": 20}'),
  ('Enterprise', 199000,  1990000, null, '{"api_publica": true,  "webhooks": true,  "conductores_max": null}')
on conflict (nombre) do nothing;

-- =============================================================================
-- 2. plataforma.suscripciones — una suscripción por courier (1:1)
-- =============================================================================
create table if not exists plataforma.suscripciones (
  id             uuid primary key default gen_random_uuid(),

  -- UNIQUE: un courier, una suscripción. ON DELETE CASCADE: si se borra el
  -- tenant, se va su suscripción.
  tenant_id      uuid not null unique
                   references identidad.tenants(id) on delete cascade,

  plan_id        uuid not null references plataforma.planes(id),

  estado         text not null default 'trial'
                   check (estado in ('trial','activa','suspendida','cancelada')),

  trial_hasta    date,           -- fin del trial (NULL si no tiene)
  activa_desde   date,           -- cuándo pasó de trial a activa
  cancelada_en   timestamptz,
  notas          text,           -- notas internas del super-admin

  creada_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table plataforma.suscripciones is
  'Suscripción de un courier a Rutax (1:1 con tenants vía tenant_id UNIQUE). '
  'Sin políticas RLS para authenticated: solo service_role (super-admin/jobs).';
comment on column plataforma.suscripciones.notas is
  'Notas internas del super-admin. Nunca expuestas al courier.';

create index if not exists idx_suscripciones_tenant
  on plataforma.suscripciones (tenant_id);
create index if not exists idx_suscripciones_estado
  on plataforma.suscripciones (estado);
create index if not exists idx_suscripciones_plan
  on plataforma.suscripciones (plan_id);

-- =============================================================================
-- 3. plataforma.periodos_suscripcion — un período de cobro mensual por suscripción
-- =============================================================================
create table if not exists plataforma.periodos_suscripcion (
  id              uuid primary key default gen_random_uuid(),
  suscripcion_id  uuid not null
                    references plataforma.suscripciones(id) on delete cascade,
  tenant_id       uuid not null,                 -- desnormalizado para queries rápidas
  periodo_inicio  date not null,
  periodo_fin     date not null,
  monto_clp       int not null,
  estado          text not null default 'pendiente'
                    check (estado in ('pendiente','pagado','vencido')),
  generado_en     timestamptz not null default now(),
  vence_en        date,                          -- típicamente periodo_fin + 5 días

  -- Un período por mes y suscripción (idempotencia del cron mensual).
  constraint periodos_suscripcion_suscripcion_periodo_uk
    unique (suscripcion_id, periodo_inicio)
);

comment on table plataforma.periodos_suscripcion is
  'Período de cobro mensual de una suscripción (el cron genera uno por mes). '
  'UNIQUE (suscripcion_id, periodo_inicio) = idempotencia del cron mensual. '
  'Sin políticas RLS para authenticated: solo service_role.';
comment on column plataforma.periodos_suscripcion.tenant_id is
  'Desnormalizado desde la suscripción para queries rápidas del super-admin.';

create index if not exists idx_periodos_suscripcion
  on plataforma.periodos_suscripcion (suscripcion_id);
create index if not exists idx_periodos_tenant
  on plataforma.periodos_suscripcion (tenant_id);
create index if not exists idx_periodos_estado
  on plataforma.periodos_suscripcion (estado);
-- Para detectar períodos vencidos eficientemente.
create index if not exists idx_periodos_estado_vence
  on plataforma.periodos_suscripcion (estado, vence_en);

-- =============================================================================
-- 4. plataforma.pagos_plataforma — cada pago recibido por un período
-- =============================================================================
create table if not exists plataforma.pagos_plataforma (
  id             uuid primary key default gen_random_uuid(),
  periodo_id     uuid not null
                   references plataforma.periodos_suscripcion(id),
  tenant_id      uuid not null,
  monto_clp      int not null,
  metodo         text not null default 'fintoc_link'
                   check (metodo in ('fintoc_link','transferencia_manual','cortesia')),
  estado         text not null default 'pendiente'
                   check (estado in ('pendiente','confirmado','fallido')),
  pago_externo_id text,          -- ID del pago en Fintoc (trazabilidad, no secreto)
  link_pago_url  text,           -- URL del link de cobro Fintoc (caduca)
  pagado_en      timestamptz,
  registrado_en  timestamptz not null default now(),
  notas          text
);

comment on table plataforma.pagos_plataforma is
  'Pago recibido por un período de suscripción (Fintoc / transferencia / cortesía). '
  'Sin políticas RLS para authenticated: solo service_role.';
comment on column plataforma.pagos_plataforma.pago_externo_id is
  'ID del pago en Fintoc. Trazabilidad, no secreto.';
comment on column plataforma.pagos_plataforma.link_pago_url is
  'URL del link de cobro Fintoc (caduca). No es secreto persistente.';

create index if not exists idx_pagos_plataforma_periodo
  on plataforma.pagos_plataforma (periodo_id);
create index if not exists idx_pagos_plataforma_tenant
  on plataforma.pagos_plataforma (tenant_id);
create index if not exists idx_pagos_plataforma_estado
  on plataforma.pagos_plataforma (estado);

-- =============================================================================
-- 5. RLS — DENY-ALL para authenticated (intencional)
-- -----------------------------------------------------------------------------
-- Se activa RLS en las cuatro tablas SIN crear ninguna política para el rol
-- `authenticated`. En Postgres, una tabla con RLS habilitada y sin políticas
-- aplicables niega TODO acceso al rol sujeto a RLS. El `service_role` de Supabase
-- bypasea RLS, así que el super-admin de Rutax y los jobs Inngest sí operan.
--
-- Por qué NO hay políticas para authenticated (a diferencia del resto del repo):
-- este es el backstage de Rutax. Un courier autenticado NUNCA debe poder leer su
-- plan, su monto, sus períodos ni sus pagos directamente desde la DB; solo ve lo
-- que la UI le muestra, intermediado por el super-admin. Tampoco hay vistas en
-- `public` para estas tablas — no se exponen vía PostgREST a clientes normales.
-- =============================================================================
alter table plataforma.planes                enable row level security;
alter table plataforma.suscripciones         enable row level security;
alter table plataforma.periodos_suscripcion  enable row level security;
alter table plataforma.pagos_plataforma      enable row level security;

-- force: las políticas (ninguna para authenticated) también aplican al owner de
-- las tablas en queries normales; service_role sigue bypaseando RLS.
alter table plataforma.planes                force row level security;
alter table plataforma.suscripciones         force row level security;
alter table plataforma.periodos_suscripcion  force row level security;
alter table plataforma.pagos_plataforma      force row level security;

-- =============================================================================
-- 6. Grants — solo service_role. Nada para authenticated/anon.
-- =============================================================================
grant usage on schema plataforma to service_role;

grant select, insert, update, delete on plataforma.planes               to service_role;
grant select, insert, update, delete on plataforma.suscripciones        to service_role;
grant select, insert, update, delete on plataforma.periodos_suscripcion to service_role;
grant select, insert, update, delete on plataforma.pagos_plataforma     to service_role;

-- Defensa en profundidad: aunque RLS ya niega, revocamos cualquier grant heredado
-- a authenticated/anon sobre el schema y sus tablas.
revoke all on schema plataforma from authenticated, anon;
revoke all on all tables in schema plataforma from authenticated, anon;
