-- =============================================================================
-- Código interno operativo del pedido same-day (QR de etiqueta)
-- =============================================================================
-- Agrega operacion.pedidos.codigo_interno: identificador OPERATIVO del pedido
-- same-day que el backend imprime como QR en la etiqueta. Es análogo a
-- tracking_token (nullable, solo se pobla en same-day) pero con un propósito
-- distinto y por eso NO se reutiliza tracking_token:
--   - tracking_token es PÚBLICO: viaja en la URL /tracking/[token] que se comparte
--     con el destinatario. No debe usarse como identificador operativo interno.
--   - codigo_interno es un identificador operativo separado (formato RX-XXXX-XXXX,
--     base32 Crockford) que el conductor/operación escanea; NO es una URL pública.
--
-- Formato y generación: los produce el BACKEND (RX-XXXX-XXXX, base32 Crockford).
-- En la BD es solo `text`; la BD no valida ni genera el formato.
--
-- Unicidad POR TENANT: índice único parcial (tenant_id, codigo_interno) WHERE
-- codigo_interno IS NOT NULL — dos couriers pueden coincidir en el código, pero
-- dentro de un mismo tenant el código es único cuando existe.
--
-- Idempotente: add column if not exists, create unique index if not exists,
-- create or replace view.
--
-- NO toca: la máquina de estados de pedidos, otras columnas, RLS existente ni la
-- tabla verificaciones_carga (Fase 2, fuera de alcance). La RLS de public.pedidos
-- (P1 tenant + P2 seller + P3 conductor) se hereda intacta de la tabla base.
-- =============================================================================

-- =============================================================================
-- 1. Columna operacion.pedidos.codigo_interno (solo same-day)
-- =============================================================================
alter table operacion.pedidos
  add column if not exists codigo_interno text;

comment on column operacion.pedidos.codigo_interno is
  'Identificador OPERATIVO del pedido same-day que el backend imprime como QR en la
   etiqueta (formato RX-XXXX-XXXX, base32 Crockford — lo genera el backend, no la BD).
   Nullable: solo se pobla en pedidos same_day. Único POR TENANT cuando NO es NULL
   (índice parcial idx_pedidos_codigo_interno_uk). Distinto de tracking_token, que es
   PÚBLICO (va en la URL /tracking/[token]); codigo_interno es interno, no una URL.';

-- =============================================================================
-- 2. Índice único parcial: único por tenant entre los pedidos que lo tienen.
-- =============================================================================
-- Se indexa (tenant_id, codigo_interno) — la unicidad es POR TENANT, no global:
-- dos couriers distintos pueden tener el mismo código sin colisionar.
create unique index if not exists idx_pedidos_codigo_interno_uk
  on operacion.pedidos (tenant_id, codigo_interno)
  where codigo_interno is not null;

-- =============================================================================
-- 3. Re-emitir la vista public.pedidos (select *) para heredar la columna nueva.
--    security_invoker = true se conserva; los grants existentes persisten. Mismo
--    patrón que la migración 0016 (tracking_token) y 20260630000001 (ml_user_id).
-- =============================================================================
create or replace view public.pedidos
  with (security_invoker = true)
  as select * from operacion.pedidos;

comment on view public.pedidos is
  'Espejo de operacion.pedidos para PostgREST. RLS heredada de la tabla base
   (security_invoker = true): P1 tenant + P2 seller + P3 conductor. Incluye
   codigo_interno (identificador operativo del QR de etiqueta same-day, único por
   tenant) heredando las mismas políticas.';

-- =============================================================================
-- 4. Grants — re-afirmar los grants existentes de la vista (se re-emitió).
--    Mismo conjunto que la migración 0016 §10 / 20260630000001.
-- =============================================================================
grant select, insert, update on operacion.pedidos to authenticated;
grant select, insert, update on public.pedidos    to authenticated;

grant select, insert, update, delete on operacion.pedidos to service_role;
grant select, insert, update, delete on public.pedidos    to service_role;
