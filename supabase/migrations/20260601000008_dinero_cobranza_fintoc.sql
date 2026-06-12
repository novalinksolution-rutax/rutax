-- =============================================================================
-- Migración 0008 · Dinero — Cobranza courier→seller con Fintoc (capa "pagado")
-- =============================================================================
-- Cierra el motor entrega→dinero con la capa de conciliación de pagos: los
-- movimientos bancarios que el courier recibe del seller (vía Fintoc Link +
-- Movements API) se ingieren en `dinero.pagos_recibidos`, se atribuyen a un
-- seller y se concilian contra un `periodos_cobro`. `periodos_cobro` gana una
-- proyección derivada (`estado_cobro`, `monto_pagado_clp`, `pagado_en`) que
-- escribe SOLO el job de matching (service_role); la fuente de verdad son las
-- filas de `pagos_recibidos`.
--
-- Secretos Fintoc (link token + secreto de webhook) viven cifrados en
-- `identidad.secretos_cifrados`; aquí solo se guardan referencias opacas
-- (`*_ref`, uuid sin FK física) en `identidad.courier_config_cobranza`,
-- simétrico a `courier_config_dte`. NUNCA el token en una tabla de negocio.
--
-- Contrato de RLS (claims heredados de Fase A; ver 0006):
--   identidad.claim_tenant_id()    → uuid del tenant del JWT
--   identidad.claim_tipo_usuario() → 'interno' | 'seller' | 'conductor' | 'super_admin'
--   identidad.claim_seller_id()    → uuid del seller (NULL salvo tipo='seller')
--
-- Idempotente: guards IF NOT EXISTS / OR REPLACE / DO-blocks en cada objeto,
-- mismos checks pg_type/pg_enum que 0006. Re-aplicable sobre base ya migrada.
--
-- NOTA TÉCNICA (ALTER TYPE ADD VALUE en transacción): las migraciones de
-- Supabase corren cada archivo en una transacción. Postgres ≥12 permite
-- `ALTER TYPE ... ADD VALUE` dentro de una transacción SIEMPRE QUE el nuevo
-- valor no se USE en la misma transacción. Aquí solo lo añadimos al enum
-- `identidad.tipo_secreto`; no se referencia ningún literal nuevo en este
-- archivo (las columnas `*_ref` son uuid, no el enum). Por eso es seguro.
-- =============================================================================

-- =============================================================================
-- 0. Preparación idempotente — vistas/tablas que esta migración (re)define
--    se remueven antes de recrearse, en orden inverso de dependencias.
-- =============================================================================
drop view if exists public.pagos_recibidos cascade;
drop view if exists public.courier_config_cobranza cascade;

drop table if exists dinero.pagos_recibidos cascade;
drop table if exists identidad.courier_config_cobranza cascade;

drop type if exists dinero.estado_match_pago cascade;

-- =============================================================================
-- 1. Enum dinero.estado_match_pago
--    Los enums no soportan IF NOT EXISTS — DO-block con guard pg_type.
--    (El DROP de arriba garantiza recreación limpia; el guard cubre el caso de
--    una base donde el tipo exista y el DROP haya sido bloqueado por una
--    dependencia inesperada — defensa en profundidad.)
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'estado_match_pago') then
    create type dinero.estado_match_pago as enum (
      'sin_atribuir',  -- ingerido, aún sin seller asignado
      'atribuido',     -- asociado a un seller, falta conciliar contra período
      'conciliado',    -- cuadra con un periodo_cobro (pago completo)
      'parcial',       -- abona parcialmente un período (falta saldo)
      'sobrante',      -- monto excede lo adeudado / no calza con ningún saldo
      'descartado'     -- no corresponde a cobranza (devolución, error, etc.)
    );
  end if;
end $$;

-- =============================================================================
-- 2. Ampliar enum identidad.tipo_secreto con los secretos de Fintoc
--    ADD VALUE IF NOT EXISTS existe en PG ≥10, pero usamos el patrón explícito
--    con guard en pg_enum para mantener simetría con el resto del repo y ser
--    robustos ante reordenamientos. Idempotente.
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'tipo_secreto' and e.enumlabel = 'token_link_fintoc'
  ) then
    alter type identidad.tipo_secreto add value 'token_link_fintoc';
  end if;

  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'tipo_secreto' and e.enumlabel = 'secreto_webhook_fintoc'
  ) then
    alter type identidad.tipo_secreto add value 'secreto_webhook_fintoc';
  end if;
end $$;

-- =============================================================================
-- 3. dinero.pagos_recibidos — fuente de verdad de los pagos del seller al
--    courier (Fintoc Movements). Una fila por movimiento bancario ingerido.
-- =============================================================================
create table dinero.pagos_recibidos (
  id                        uuid primary key default gen_random_uuid(),

  -- P1: tenant obligatorio en toda tabla de negocio.
  tenant_id                 uuid not null references identidad.tenants(id) on delete restrict,

  -- P2: seller al que se atribuye el pago. NULL hasta que el job de matching lo
  -- resuelve. Mientras sea NULL el pago es invisible al seller (ver RLS §6).
  seller_id                 uuid references identidad.sellers(id) on delete restrict,

  -- Período que el pago concilia. NULL hasta conciliar.
  periodo_cobro_id          uuid references dinero.periodos_cobro(id) on delete restrict,

  -- Movement.id de Fintoc (string tipo 'mov_...'). Idempotencia de ingesta.
  movimiento_externo_id     text not null,

  -- Referencia opaca al secreto (link token) en identidad.secretos_cifrados,
  -- SIN FK física — mismo patrón que courier_config_dte.*_ref. NUNCA el token.
  link_token_ref            uuid,

  -- CLP entero (invariante del proyecto). Un pago siempre es positivo; los
  -- contracargos/devoluciones se modelan como 'descartado', no como negativos.
  monto_clp                 numeric(12,0) not null
    constraint pagos_recibidos_monto_positivo check (monto_clp > 0),

  fecha_movimiento          date not null,

  -- RUT de la contraparte SIN puntos ni guion (normalizado). NULLABLE: ~la
  -- mitad de los movimientos de Fintoc no traen identificación de contraparte.
  contraparte_rut_normalizado text,
  contraparte_nombre        text,

  estado_match              dinero.estado_match_pago not null default 'sin_atribuir',

  -- Quién atribuyó el pago manualmente. NULL si lo resolvió el motor.
  atribuido_por_usuario_id  uuid,
  atribuido_en              timestamptz,

  -- Payload crudo del movimiento (para auditoría y reproceso). No exponer
  -- secretos aquí — el webhook de Fintoc no firma con el link token.
  payload_crudo             jsonb not null default '{}'::jsonb,

  -- Run de Inngest que ingirió/atribuyó la fila — trazabilidad.
  job_run_id                text,

  creado_en                 timestamptz not null default now(),
  actualizado_en            timestamptz not null default now(),

  -- Idempotencia de ingesta: un movimiento de Fintoc se ingiere una sola vez
  -- por tenant (ON CONFLICT DO NOTHING en el job de ingesta).
  constraint pagos_recibidos_tenant_movimiento_uk
    unique (tenant_id, movimiento_externo_id)
);

comment on table dinero.pagos_recibidos is
  'Fuente de verdad de los pagos recibidos del seller (Fintoc Movements). Una
   fila por movimiento bancario. seller_id NULL = aún sin atribuir (invisible al
   seller por RLS, deseado). periodo_cobro_id NULL = aún sin conciliar.
   link_token_ref es referencia opaca a secretos_cifrados — nunca el token.
   RLS: P1 tenant + P2 seller. Conductores no acceden. Escritura: solo
   service_role (jobs Inngest de ingesta/matching).';

create index if not exists idx_pagos_recibidos_tenant_id
  on dinero.pagos_recibidos (tenant_id);

create index if not exists idx_pagos_recibidos_tenant_seller
  on dinero.pagos_recibidos (tenant_id, seller_id);

create index if not exists idx_pagos_recibidos_periodo
  on dinero.pagos_recibidos (periodo_cobro_id);

-- Cola de trabajo del job de matching: pagos que aún requieren atención.
create index if not exists idx_pagos_recibidos_pendientes_match
  on dinero.pagos_recibidos (tenant_id)
  where estado_match in ('sin_atribuir', 'sobrante', 'parcial');

-- Búsqueda por RUT de contraparte (atribución automática). Parcial porque ~la
-- mitad de las filas no traen RUT.
create index if not exists idx_pagos_recibidos_rut
  on dinero.pagos_recibidos (tenant_id, contraparte_rut_normalizado)
  where contraparte_rut_normalizado is not null;

drop trigger if exists trg_pagos_recibidos_actualizado_en on dinero.pagos_recibidos;
create trigger trg_pagos_recibidos_actualizado_en
  before update on dinero.pagos_recibidos
  for each row execute function identidad.set_actualizado_en();

-- =============================================================================
-- 4. ALTER dinero.periodos_cobro — proyección derivada del estado de pago.
--    Escribe SOLO el job de matching (service_role). La fuente de verdad son
--    las filas de pagos_recibidos; estas columnas son cache/proyección para
--    listados y filtros sin recalcular sumas en cada consulta.
--    Cada columna con IF NOT EXISTS — idempotente.
-- =============================================================================
alter table dinero.periodos_cobro
  add column if not exists estado_cobro text not null default 'no_aplica'
    constraint periodos_cobro_estado_cobro_valido
      check (estado_cobro in ('no_aplica', 'pendiente', 'parcial', 'pagado'));

alter table dinero.periodos_cobro
  add column if not exists monto_pagado_clp numeric(12,0) not null default 0
    constraint periodos_cobro_monto_pagado_no_negativo check (monto_pagado_clp >= 0);

alter table dinero.periodos_cobro
  add column if not exists pagado_en timestamptz;

comment on column dinero.periodos_cobro.estado_cobro is
  'Proyección derivada del estado de pago del período (no_aplica|pendiente|
   parcial|pagado). La escribe SOLO el job de matching (service_role); la fuente
   de verdad son las filas de dinero.pagos_recibidos conciliadas contra este
   período. Hereda la RLS P1+P2 de periodos_cobro (el seller la ve para su período).';

-- =============================================================================
-- 5. identidad.courier_config_cobranza — 1:1 con tenant, simétrica a
--    courier_config_dte. Solo referencias opacas a secretos; nunca el token.
-- =============================================================================
create table if not exists identidad.courier_config_cobranza (
  tenant_id           uuid primary key references identidad.tenants(id) on delete cascade,

  -- Referencias opacas a identidad.secretos_cifrados.referencia_externa_id —
  -- NUNCA el valor. Sin FK física (mantiene secretos_cifrados desacoplada).
  link_token_ref      uuid,
  secreto_webhook_ref uuid,

  -- Metadato NO sensible: alias legible de la cuenta bancaria conectada.
  cuenta_banco_alias  text,

  estado_conexion     text not null default 'desconectado'
    constraint courier_config_cobranza_estado_valido
      check (estado_conexion in ('desconectado', 'conectado', 'error', 'revocado')),

  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now()
);

comment on table identidad.courier_config_cobranza is
  'Configuración de cobranza Fintoc del courier (1:1 con tenants). Solo guarda
   referencias opacas a secretos_cifrados (link token + secreto de webhook) —
   nunca tokens en claro. Dato puramente interno: RLS P1 estricta, ningún seller
   ni conductor la ve jamás (simétrico a courier_config_dte).';

drop trigger if exists trg_courier_config_cobranza_actualizado_en on identidad.courier_config_cobranza;
create trigger trg_courier_config_cobranza_actualizado_en
  before update on identidad.courier_config_cobranza
  for each row execute function identidad.set_actualizado_en();

create or replace view public.courier_config_cobranza
  with (security_invoker = true)
  as select * from identidad.courier_config_cobranza;

comment on view public.courier_config_cobranza is
  'Espejo de identidad.courier_config_cobranza para PostgREST. RLS heredada: P1
   interno. Solo referencias opacas — nunca el token Fintoc.';

-- -----------------------------------------------------------------------------
-- 5.1 RLS de courier_config_cobranza — P1 estricta, SIN P2/P3 (patrón
--     courier_config_dte): solo usuarios internos del tenant.
-- -----------------------------------------------------------------------------
alter table identidad.courier_config_cobranza enable row level security;
alter table identidad.courier_config_cobranza force row level security;

drop policy if exists courier_config_cobranza_select_interno on identidad.courier_config_cobranza;
create policy courier_config_cobranza_select_interno
  on identidad.courier_config_cobranza
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists courier_config_cobranza_insert_interno on identidad.courier_config_cobranza;
create policy courier_config_cobranza_insert_interno
  on identidad.courier_config_cobranza
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists courier_config_cobranza_update_interno on identidad.courier_config_cobranza;
create policy courier_config_cobranza_update_interno
  on identidad.courier_config_cobranza
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

-- Guard de defensa en profundidad — mismo patrón que courier_config_dte:
-- convierte el "UPDATE 0" silencioso de un seller/conductor en un 42501
-- explícito y auditable (identidad.solo_interno_edita, migración 0002).
drop trigger if exists trg_courier_config_cobranza_solo_interno_edita on identidad.courier_config_cobranza;
create trigger trg_courier_config_cobranza_solo_interno_edita
  before update on identidad.courier_config_cobranza
  for each statement execute function identidad.solo_interno_edita();

-- =============================================================================
-- 6. RLS de dinero.pagos_recibidos — P1 + P2 (patrón lineas_cobro).
--    Solo SELECT para authenticated; toda escritura es de service_role.
-- =============================================================================
alter table dinero.pagos_recibidos enable row level security;
alter table dinero.pagos_recibidos force row level security;

drop policy if exists pagos_recibidos_select on dinero.pagos_recibidos;
create policy pagos_recibidos_select
  on dinero.pagos_recibidos
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or (
        identidad.claim_tipo_usuario() = 'seller'
        and seller_id = identidad.claim_seller_id()
      )
    )
  );

-- IMPORTANTE — NO "arreglar" esto: cuando seller_id IS NULL (pago aún sin
-- atribuir), la comparación `seller_id = identidad.claim_seller_id()` evalúa a
-- NULL, que en una cláusula USING se trata como FALSO. Resultado: el seller NO
-- ve los pagos sin atribuir. Esto es DESEADO y seguro — un pago sin atribuir
-- aún no es "del seller"; exponerlo filtraría información de conciliación
-- interna del courier (montos/contrapartes de otros). Los usuarios internos sí
-- los ven (rama 'interno' de la política).

-- =============================================================================
-- 7. Vista public.pagos_recibidos con security_invoker = true
--    Las políticas RLS se evalúan con los privilegios del rol que consulta
--    (authenticated), no con los del dueño de la vista.
-- =============================================================================
create or replace view public.pagos_recibidos
  with (security_invoker = true)
  as select * from dinero.pagos_recibidos;

comment on view public.pagos_recibidos is
  'Espejo de dinero.pagos_recibidos para PostgREST. RLS heredada: P1 + P2 seller.
   Pagos con seller_id NULL (sin atribuir) son invisibles al seller — deseado.
   Conductores no tienen acceso.';

-- =============================================================================
-- 8. Grants — patrón espejo de 0006: USAGE en schema, SELECT directo sobre la
--    tabla base (requerido por security_invoker = true) y sobre la vista,
--    REVOKE explícito de escritura (defensa en profundidad), grant a service_role.
-- =============================================================================

-- pagos_recibidos: tabla base + vista para authenticated (solo SELECT).
grant select on dinero.pagos_recibidos  to authenticated;
grant select on public.pagos_recibidos  to authenticated;

revoke insert, update, delete on dinero.pagos_recibidos  from authenticated, anon;
revoke insert, update, delete on public.pagos_recibidos  from authenticated, anon;

-- courier_config_cobranza: interno puede leer/escribir su config (patrón
-- courier_config_dte). DELETE no se otorga.
grant select, insert, update on identidad.courier_config_cobranza to authenticated;
grant select, insert, update on public.courier_config_cobranza     to authenticated;

revoke delete on identidad.courier_config_cobranza from authenticated, anon;
revoke delete on public.courier_config_cobranza     from authenticated, anon;

-- service_role: escritura completa (jobs Inngest de ingesta/matching). El
-- grant masivo `all tables in schema` de 0006 cubre tablas ya existentes; las
-- nuevas de esta migración requieren grant explícito.
grant select, insert, update, delete on dinero.pagos_recibidos           to service_role;
grant select, insert, update, delete on identidad.courier_config_cobranza to service_role;
