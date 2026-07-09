-- =============================================================================
-- Migración 0037 (ts 20260708000002) · Dinero — Webhook de payout saliente
-- =============================================================================
-- Fase 1/4 (base-datos-rls) de la feature "confirmación instantánea de payouts a
-- conductores por webhook Fintoc (transfer.outbound.*)". Hoy los payouts solo se
-- confirman por polling horario; el webhook los confirma al instante. Esta
-- migración SOLO agrega el esquema + RLS; el puerto/adaptador (integraciones), la
-- lógica del handler (backend) y las pruebas E2E (qa) construyen encima.
--
-- Qué agrega:
--   1. Amplía dinero.tipo_diferencia_conciliacion con
--      'payout_revertido_post_confirmacion' (enum + CHECK de la columna) — para
--      que la conciliación C7 detecte un payout que fue confirmado y luego el
--      proveedor lo revirtió (transfer.outbound.returned/failed post-confirmación).
--   2. dinero.eventos_payout_externos — ledger append-only de eventos de webhook,
--      con UNIQUE(evento_externo_id) como barrera de idempotencia DURA (P0): el
--      mismo evt_... de Fintoc no se procesa dos veces aunque el webhook reintente.
--   3. Índice único parcial sobre dinero.payouts_conductor(payout_externo_id):
--      un transfer externo mapea a lo sumo a un payout (correlación 1:1 del
--      webhook con el payout que confirma).
--
-- Aislamiento (NO se relaja):
--   - eventos_payout_externos es 100% INTERNO. RLS enable+force + política solo
--     dueno/administracion del mismo tenant (calca dinero.eventos_conciliacion_historial).
--     Seller y conductor JAMÁS ven una fila; internos con otros roles (coordinador)
--     tampoco. Escritura exclusiva de service_role (jobs Inngest del webhook).
--   - payload_sanitizado: SOLO campos no sensibles (event id, transfer id, status,
--     currency, amount, return_reason, receipt_url). NUNCA datos bancarios del
--     conductor (counterparty), nunca secretos/tokens. El saneo lo impone el
--     backend; aquí solo se define la columna.
--
-- Idempotente: DO-blocks para enum/CHECK, CREATE TABLE/INDEX IF NOT EXISTS,
-- DROP POLICY IF EXISTS, CREATE OR REPLACE VIEW. Re-aplicable sobre base ya migrada.
--
-- Contrato de claims (Fase A / migración 0001 + 0006):
--   identidad.claim_tenant_id()    → uuid del tenant del JWT
--   identidad.claim_tipo_usuario() → 'interno' | 'seller' | 'conductor'
--   identidad.claim_rol()          → 'dueno' | 'administracion' | 'coordinador' | …
-- =============================================================================

-- =============================================================================
-- 1. Ampliar el enum dinero.tipo_diferencia_conciliacion
--    Patrón exacto de la migración 0013 (20260613000010): ADD VALUE IF NOT EXISTS
--    en un DO-block. El nuevo valor NO se usa como literal-enum en esta migración
--    (la columna eventos_conciliacion.tipo_diferencia es text + CHECK, no el tipo
--    enum directo), así que no viola la restricción de PG "no usar el valor nuevo
--    en la misma transacción que su ADD VALUE".
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_type where typname = 'tipo_diferencia_conciliacion') then
    alter type dinero.tipo_diferencia_conciliacion
      add value if not exists 'payout_revertido_post_confirmacion';
  end if;
end $$;

-- =============================================================================
-- 2. Reemplazar el CHECK de eventos_conciliacion.tipo_diferencia con la lista
--    completa (12 previos + 1 nuevo). La columna usa text + CHECK, así que el
--    enum ampliado por sí solo no habilita el valor nuevo en la tabla. Drop/add
--    idempotente (mismo mecanismo que 0013).
-- =============================================================================
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'dinero' and table_name = 'eventos_conciliacion'
  ) then
    alter table dinero.eventos_conciliacion
      drop constraint if exists eventos_conciliacion_tipo_valido;

    alter table dinero.eventos_conciliacion
      add constraint eventos_conciliacion_tipo_valido
      check (tipo_diferencia in (
        -- 6 originales (C6 · 2 fuentes)
        'pedido_entregado_sin_linea_cobro',
        'pedido_entregado_sin_linea_liquidacion',
        'linea_cobro_sin_pedido_entregado',
        'folio_consumido_sin_dte_persistido',
        'periodo_cerrado_con_lineas_sueltas',
        'monto_dte_difiere_de_lineas',
        -- 6 de C7 (F17 · 3 fuentes)
        'pagado_conductor_sin_cobro_seller',
        'cobrado_seller_no_pagado_conductor',
        'reprogramacion_no_cobrada',
        'minimo_omitido',
        'pago_seller_faltante',
        'pago_conductor_faltante',
        -- nuevo (webhook payout): confirmado y luego revertido por el proveedor
        'payout_revertido_post_confirmacion'
      ));
  end if;
end $$;

-- =============================================================================
-- 3. Índice único parcial en dinero.payouts_conductor(payout_externo_id)
--    Correlación 1:1 del webhook: un transfer/payout externo (Fintoc) mapea a lo
--    sumo a un payout. Sin CONCURRENTLY: la migración corre en transacción y el
--    resto del proyecto usa `create [unique] index if not exists` normal.
--    Parcial (WHERE ... is not null): los payouts aún no enviados no tienen id
--    externo y no deben chocar entre sí por múltiples NULLs.
-- =============================================================================
create unique index if not exists payouts_conductor_payout_externo_uk
  on dinero.payouts_conductor (payout_externo_id)
  where payout_externo_id is not null;

comment on index dinero.payouts_conductor_payout_externo_uk is
  'Único parcial: un payout_externo_id (transfer Fintoc) mapea a lo sumo a un
   payout. Habilita al webhook correlacionar el evento con SU payout sin ambigüedad.';

-- =============================================================================
-- 4. dinero.eventos_payout_externos — ledger append-only de eventos de webhook
--    UNIQUE(evento_externo_id) es la barrera de idempotencia DURA (P0): el mismo
--    evt_... reintentado por Fintoc choca con 23505 en vez de reconfirmar/revertir
--    dos veces un payout. FK a payouts_conductor + liquidaciones con on delete
--    restrict (preserva el rastro de auditoría; los payouts no se borran).
-- =============================================================================
create table if not exists dinero.eventos_payout_externos (
  id                  uuid primary key default gen_random_uuid(),

  -- P1
  tenant_id           uuid not null references identidad.tenants (id) on delete restrict,

  -- El payout que este evento confirma/rechaza/revierte.
  payout_id           uuid not null references dinero.payouts_conductor (id) on delete restrict,

  -- Siempre disponible: payouts_conductor.liquidacion_id es NOT NULL.
  liquidacion_id      uuid not null references dinero.liquidaciones (id) on delete restrict,

  -- Event id de Fintoc (evt_...). BARRERA DE IDEMPOTENCIA (UNIQUE abajo).
  evento_externo_id   text not null,

  -- Transfer id de Fintoc (tr_...). Correlaciona con payouts_conductor.payout_externo_id.
  transfer_externo_id text not null,

  -- Estado interno traducido del status externo del webhook.
  estado_externo      text not null
    constraint eventos_payout_ext_estado_valido
      check (estado_externo in (
        'confirmado',   -- transfer.outbound.succeeded
        'rechazado',    -- transfer.outbound.rejected
        'fallido',      -- transfer.outbound.failed
        'pendiente',    -- transfer.outbound.created / in_progress
        'desconocido'   -- status no mapeado (se registra para auditoría, no actúa)
      )),

  -- Motivo/return_reason saneado (sin datos sensibles). Nullable.
  motivo              text,

  -- SOLO campos no sensibles: event id, transfer id, status, currency, amount,
  -- return_reason, receipt_url. NUNCA counterparty (datos bancarios del conductor),
  -- nunca secretos/tokens. El saneo lo impone el backend. Nullable.
  payload_sanitizado  jsonb,

  recibido_en         timestamptz not null default now(),

  -- IDEMPOTENCIA DURA (P0): un evento de Fintoc se procesa una sola vez.
  constraint eventos_payout_ext_evento_uk unique (evento_externo_id)

  -- Append-only: sin actualizado_en. Las entradas del ledger no se modifican.
);

comment on table dinero.eventos_payout_externos is
  'Ledger append-only de eventos de webhook de payout saliente (Fintoc
   transfer.outbound.*). UNIQUE(evento_externo_id) es la barrera de idempotencia
   dura: el mismo evt_... reintentado no reconfirma/revierte dos veces. RLS P1 +
   solo dueno/administracion; seller y conductor JAMÁS. Escritura: solo service_role.
   payload_sanitizado SOLO campos no sensibles (nunca counterparty ni secretos).';

comment on column dinero.eventos_payout_externos.evento_externo_id is
  'Event id de Fintoc (evt_...). UNIQUE: barrera de idempotencia dura del webhook.';
comment on column dinero.eventos_payout_externos.transfer_externo_id is
  'Transfer id de Fintoc (tr_...). Correlaciona con payouts_conductor.payout_externo_id.';
comment on column dinero.eventos_payout_externos.payload_sanitizado is
  'jsonb con SOLO campos no sensibles del evento (event id, transfer id, status,
   currency, amount, return_reason, receipt_url). NUNCA datos bancarios del
   conductor (counterparty), nunca secretos/tokens — el saneo lo impone el backend.';

create index if not exists idx_eventos_payout_ext_payout
  on dinero.eventos_payout_externos (payout_id);

create index if not exists idx_eventos_payout_ext_tenant
  on dinero.eventos_payout_externos (tenant_id);

-- =============================================================================
-- 5. RLS enable + force (el meta-test rls_cobertura_meta exige ambas).
--    Política P1 estricta solo dueno/administracion — calca
--    dinero.eventos_conciliacion_historial. Seller/conductor: 0 filas (no son
--    'interno'); coordinador: 0 filas (rol no privilegiado). Escritura: nadie por
--    authenticated (sin política de INSERT/UPDATE/DELETE + revoke) → solo service_role.
-- =============================================================================
alter table dinero.eventos_payout_externos enable row level security;
alter table dinero.eventos_payout_externos force row level security;

drop policy if exists eventos_payout_ext_select on dinero.eventos_payout_externos;
create policy eventos_payout_ext_select
  on dinero.eventos_payout_externos
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
    and identidad.claim_rol() in ('dueno', 'administracion')
  );

-- =============================================================================
-- 6. Vista espejo en public (security_invoker → hereda la RLS de la tabla base).
-- =============================================================================
create or replace view public.eventos_payout_externos
  with (security_invoker = true)
  as select * from dinero.eventos_payout_externos;

comment on view public.eventos_payout_externos is
  'Espejo de dinero.eventos_payout_externos para PostgREST. RLS heredada: P1 +
   solo dueno/administracion. Sellers y conductores no acceden jamás.';

-- =============================================================================
-- 7. Grants — mismo patrón que dinero.eventos_conciliacion_historial:
--    SELECT directo sobre la tabla base (requerido por security_invoker) y la
--    vista; REVOKE explícito de DML para authenticated/anon (escritura solo
--    service_role). El grant de service_role sobre la tabla base es explícito (el
--    `grant ... on all tables in schema dinero` de 0006 fue un snapshot; las
--    tablas nuevas no lo heredan). La vista public sí queda cubierta por
--    `alter default privileges in schema public` de 0013001/0013002 (service_role).
-- =============================================================================
grant select on dinero.eventos_payout_externos to authenticated;
revoke insert, update, delete on dinero.eventos_payout_externos from authenticated, anon;

grant select on public.eventos_payout_externos to authenticated;
revoke insert, update, delete on public.eventos_payout_externos from authenticated, anon;

grant select, insert, update, delete on dinero.eventos_payout_externos to service_role;
