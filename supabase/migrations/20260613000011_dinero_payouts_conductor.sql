-- =============================================================================
-- 0011 · F19 — Payouts a conductores (Bloque 3, dinero saliente)
-- =============================================================================
-- Primer eslabón de F19: el esquema. `integraciones` (puerto + adaptador
-- Fintoc/banca) y `backend` (acción humana + job idempotente) construyen sobre
-- esto.
--
-- Dinero SALIENTE: la idempotencia y el aislamiento son críticos.
--   - UNIQUE (tenant_id, liquidacion_id): una liquidación NO puede tener dos
--     payouts. Es la barrera de doble-pago — si el job se reintenta, el segundo
--     INSERT choca con 23505 en vez de transferir dos veces.
--   - opt-in explícito (courier_config_payout.payout_real_habilitado default
--     false): ningún courier transfiere de verdad hasta habilitarlo, igual que
--     emision_dte_real_habilitada para DTE.
--
-- Aislamiento:
--   - payouts_conductor: P1 (interno mismo tenant) + P3 (el conductor ve SU
--     payout — cierra el loop "ya te pagué"). Seller NUNCA. Escritura solo
--     service_role (jobs Inngest); authenticated solo SELECT.
--   - courier_config_payout: solo-interno (calca courier_config_dte). Seller y
--     conductor no la ven jamás.
--   - credenciales del adaptador saliente: cifradas en identidad.secretos_cifrados
--     vía el nuevo tipo_secreto 'credenciales_payout' — nunca en una tabla de
--     negocio, nunca en texto plano.
--
-- Migración IDEMPOTENTE: DO-blocks para enums, IF NOT EXISTS / OR REPLACE en el
-- resto, DROPs antes de los CREATEs que redefinen. Re-aplicable sobre una base
-- ya migrada.
--
-- Contrato de claims (heredado de Fase A / migración 0006):
--   identidad.claim_tenant_id()    → uuid del tenant del JWT
--   identidad.claim_tipo_usuario() → 'interno' | 'seller' | 'conductor' | …
--   identidad.claim_driver_id()    → uuid del conductor (NULL salvo conductor)
-- =============================================================================

-- =============================================================================
-- 0. Preparación idempotente: remover objetos dependientes en orden inverso
-- =============================================================================
drop view if exists public.payouts_conductor cascade;
drop view if exists public.courier_config_payout cascade;
drop table if exists dinero.payouts_conductor cascade;
-- courier_config_payout se crea con IF NOT EXISTS (es config 1:1, no se dropea
-- para no perder el opt-in del courier en re-aplicaciones).

-- =============================================================================
-- 1. Enum dinero.estado_payout — máquina de estados del payout saliente
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'estado_payout') then
    create type dinero.estado_payout as enum (
      'pendiente',   -- creado, aún no enviado al proveedor / banca
      'enviado',     -- instrucción de transferencia enviada al adaptador externo
      'confirmado',  -- el proveedor/banca confirmó la transferencia
      'rechazado',   -- el proveedor rechazó (cuenta inválida, fondos, etc.)
      'fallido'      -- error técnico/transitorio (reintentable por el job)
    );
  end if;
end $$;

-- =============================================================================
-- 2. Ampliar identidad.tipo_secreto con 'credenciales_payout'
--    Las credenciales del adaptador saliente (API key Fintoc payouts / banca)
--    se cifran en secretos_cifrados — mismo mecanismo que tokens ML/DTE.
--
--    NOTA TÉCNICA (ALTER TYPE ADD VALUE en transacción): Supabase corre cada
--    migración en una transacción. PG ≥12 permite ADD VALUE dentro de una
--    transacción siempre que el nuevo valor NO se use en la misma transacción.
--    Aquí solo lo añadimos al enum; ninguna columna referencia el literal nuevo
--    en este archivo (los *_ref son uuid, no el enum). Guard explícito sobre
--    pg_enum para idempotencia (mismo patrón que 0008).
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'tipo_secreto' and e.enumlabel = 'credenciales_payout'
  ) then
    alter type identidad.tipo_secreto add value 'credenciales_payout';
  end if;
end $$;

-- =============================================================================
-- 3. dinero.payouts_conductor — un payout por liquidación (idempotencia dura)
-- =============================================================================
create table dinero.payouts_conductor (
  id                        uuid primary key default gen_random_uuid(),

  -- P1
  tenant_id                 uuid not null references identidad.tenants(id) on delete restrict,

  -- P3 — RLS: el conductor ve SU payout.
  driver_id                 uuid not null references identidad.conductores(id) on delete restrict,

  -- La liquidación que este payout salda. UNIQUE con tenant_id abajo.
  liquidacion_id            uuid not null references dinero.liquidaciones(id) on delete restrict,

  -- Montos en CLP (sin decimales). bruto = lo devengado; retención = boleta de
  -- terceros u otra retención; líquido = lo que efectivamente se transfiere.
  monto_bruto_clp           numeric(12,0) not null
    constraint payouts_monto_bruto_no_negativo check (monto_bruto_clp >= 0),
  monto_retencion_clp       numeric(12,0) not null default 0
    constraint payouts_monto_retencion_no_negativo check (monto_retencion_clp >= 0),
  monto_liquido_clp         numeric(12,0) not null
    constraint payouts_monto_liquido_no_negativo check (monto_liquido_clp >= 0),

  -- Copiado de conductores.tipo_relacion al crear el payout (histórico).
  tipo_relacion_conductor   text not null
    constraint payouts_tipo_relacion_valido
      check (tipo_relacion_conductor in ('dependiente', 'independiente')),

  -- Método de pago saliente.
  metodo                    text not null
    constraint payouts_metodo_valido
      check (metodo in ('fintoc', 'manual', 'nomina')),

  estado                    dinero.estado_payout not null default 'pendiente',

  -- ID asignado por el proveedor saliente (Fintoc payout id / referencia banca).
  payout_externo_id         text,

  -- Referencia opaca al comprobante en Storage — signed URL de vida corta en la
  -- app; NUNCA path público ni URL inline.
  comprobante_ref           text,

  -- Error descriptivo SIN secretos (sin API keys, tokens ni credenciales).
  error_descripcion         text,

  -- Actor humano que solicitó el payout (RNF-04: el "quién"). NULL si lo genera
  -- un proceso, pero la acción humana de backend debe poblarlo.
  solicitado_por_usuario_id uuid,
  solicitado_en             timestamptz not null default now(),

  -- Momento en que el proveedor confirmó (estado → confirmado).
  confirmado_en             timestamptz,

  creado_en                 timestamptz not null default now(),
  actualizado_en            timestamptz not null default now(),

  -- IDEMPOTENCIA DE DINERO SALIENTE: una liquidación tiene a lo sumo un payout
  -- por tenant. El segundo INSERT para la misma liquidación choca con 23505.
  constraint payouts_tenant_liquidacion_uk
    unique (tenant_id, liquidacion_id),

  -- Coherencia aritmética: líquido = bruto − retención.
  constraint payouts_liquido_coherente
    check (monto_liquido_clp = monto_bruto_clp - monto_retencion_clp)
);

comment on table dinero.payouts_conductor is
  'Payout (transferencia saliente) del courier al conductor para saldar una
   liquidación. UNIQUE (tenant_id, liquidacion_id) es la barrera de doble-pago:
   una liquidación no puede tener dos payouts (idempotencia de dinero saliente).
   comprobante_ref es path en Storage — signed URLs de vida corta en la app,
   nunca público. error_descripcion sin secretos. RLS: P1 + P3 conductor
   (cierra el loop "ya te pagué"). Sellers NUNCA. Escritura: solo service_role.';

comment on column dinero.payouts_conductor.payout_externo_id is
  'ID del payout en el proveedor saliente (Fintoc / banca). Trazabilidad, no secreto.';
comment on column dinero.payouts_conductor.comprobante_ref is
  'Path en Storage al comprobante de transferencia. Signed URL en la app; nunca público.';
comment on column dinero.payouts_conductor.error_descripcion is
  'Descripción de error sin secretos (jamás API keys, tokens ni credenciales).';

create index if not exists idx_payouts_tenant_estado
  on dinero.payouts_conductor (tenant_id, estado);

create index if not exists idx_payouts_tenant_driver
  on dinero.payouts_conductor (tenant_id, driver_id);

drop trigger if exists trg_payouts_conductor_actualizado_en on dinero.payouts_conductor;
create trigger trg_payouts_conductor_actualizado_en
  before update on dinero.payouts_conductor
  for each row execute function identidad.set_actualizado_en();

-- =============================================================================
-- 4. identidad.courier_config_payout — 1:1 con tenants (calca courier_config_dte)
-- =============================================================================
create table if not exists identidad.courier_config_payout (
  tenant_id              uuid primary key references identidad.tenants(id) on delete cascade,

  -- Opt-in explícito para transferir de verdad (como emision_dte_real_habilitada).
  -- Default false: ningún courier paga real hasta habilitarlo deliberadamente.
  payout_real_habilitado boolean not null default false,

  metodo_default         text not null default 'manual'
    constraint courier_config_payout_metodo_valido
      check (metodo_default in ('fintoc', 'manual', 'nomina')),

  -- % de retención boleta de terceros (configurable por courier).
  porcentaje_retencion   numeric(5,2) not null default 0
    constraint courier_config_payout_porcentaje_rango
      check (porcentaje_retencion >= 0 and porcentaje_retencion <= 100),

  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now()
);

comment on table identidad.courier_config_payout is
  'Configuración de payouts del courier (1:1 con tenants). payout_real_habilitado
   default false: la transferencia real exige opt-in explícito, igual que
   emision_dte_real_habilitada para DTE. Solo roles internos la ven; sellers y
   conductores no acceden jamás.';

comment on column identidad.courier_config_payout.payout_real_habilitado is
  'Opt-in explícito del courier para ejecutar payouts REALES (no simulados). '
  'Default false: la transferencia real exige habilitación deliberada.';

drop trigger if exists trg_courier_config_payout_actualizado_en on identidad.courier_config_payout;
create trigger trg_courier_config_payout_actualizado_en
  before update on identidad.courier_config_payout
  for each row execute function identidad.set_actualizado_en();

-- =============================================================================
-- 5. RLS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 5.1 dinero.payouts_conductor — P1 + P3 (conductor ve SU payout); seller NUNCA
--     Solo SELECT para authenticated. Escritura exclusiva de service_role.
-- -----------------------------------------------------------------------------
alter table dinero.payouts_conductor enable row level security;
alter table dinero.payouts_conductor force row level security;

drop policy if exists payouts_conductor_select on dinero.payouts_conductor;
create policy payouts_conductor_select
  on dinero.payouts_conductor
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or (
        identidad.claim_tipo_usuario() = 'conductor'
        and driver_id = identidad.claim_driver_id()
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 5.2 identidad.courier_config_payout — P1 estricta, solo internos (como DTE)
--     INSERT/UPDATE permitidos a internos (la pantalla de config los usa);
--     guard solo_interno_edita convierte un UPDATE de seller/conductor en 42501.
-- -----------------------------------------------------------------------------
alter table identidad.courier_config_payout enable row level security;
alter table identidad.courier_config_payout force row level security;

drop policy if exists courier_config_payout_select_interno on identidad.courier_config_payout;
create policy courier_config_payout_select_interno
  on identidad.courier_config_payout
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists courier_config_payout_insert_interno on identidad.courier_config_payout;
create policy courier_config_payout_insert_interno
  on identidad.courier_config_payout
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists courier_config_payout_update_interno on identidad.courier_config_payout;
create policy courier_config_payout_update_interno
  on identidad.courier_config_payout
  for update
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  )
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop trigger if exists trg_courier_config_payout_solo_interno_edita on identidad.courier_config_payout;
create trigger trg_courier_config_payout_solo_interno_edita
  before update on identidad.courier_config_payout
  for each statement execute function identidad.solo_interno_edita();

-- =============================================================================
-- 6. Vistas en public con security_invoker = true
-- =============================================================================
create or replace view public.payouts_conductor
  with (security_invoker = true)
  as select * from dinero.payouts_conductor;

comment on view public.payouts_conductor is
  'Espejo de dinero.payouts_conductor para PostgREST. RLS heredada: P1 + P3
   conductor (ve su payout). Sellers no acceden. comprobante_ref es path en
   Storage — signed URLs en la app, nunca público.';

create or replace view public.courier_config_payout
  with (security_invoker = true)
  as select * from identidad.courier_config_payout;

comment on view public.courier_config_payout is
  'Espejo de identidad.courier_config_payout para PostgREST. RLS heredada: P1
   solo interno. Sellers y conductores no acceden.';

-- =============================================================================
-- 7. Grants
-- =============================================================================

-- payouts_conductor: SELECT directo (requerido por security_invoker) + revoke DML.
grant select on dinero.payouts_conductor to authenticated;
revoke insert, update, delete on dinero.payouts_conductor from authenticated, anon;

grant select on public.payouts_conductor to authenticated;
revoke insert, update, delete on public.payouts_conductor from authenticated, anon;

-- courier_config_payout: internos pueden SELECT/INSERT/UPDATE (pantalla de config);
-- las políticas RLS + guard acotan el alcance. No DELETE.
grant select, insert, update on identidad.courier_config_payout to authenticated;
revoke delete on identidad.courier_config_payout from authenticated, anon;

grant select, insert, update on public.courier_config_payout to authenticated;
revoke delete on public.courier_config_payout from authenticated, anon;

-- service_role: escritura plena sobre el nuevo objeto de dinero y la config.
grant select, insert, update, delete on dinero.payouts_conductor      to service_role;
grant select, insert, update, delete on identidad.courier_config_payout to service_role;
