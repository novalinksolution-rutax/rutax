-- =============================================================================
-- Migración 0011 · Dinero — Notas de crédito (61) y anulación de períodos
-- =============================================================================
-- Soporte de datos para anular un período facturado vía nota de crédito
-- electrónica (DTE tipo 61, SII Chile):
--   1. `dinero.periodos_cobro` gana las columnas de auditoría de anulación
--      (motivo, cuándo, quién). El estado 'anulado' YA existe en el CHECK de
--      estado desde 0006 — no se toca.
--   2. `dinero.documentos_dte` gana dos invariantes de integridad:
--      - Índice único parcial: solo UNA NC (61) activa por factura (33).
--      - CHECK de coherencia: un 61 SIEMPRE referencia a su 33; un 33 NUNCA
--        lleva referencia.
--   3. NO se agrega estado 'anulado_por_nc' a documentos_dte: la condición
--      "factura anulada" se DERIVA de la existencia del 61 vinculado
--      (decisión B6 del arquitecto) — una sola fuente de verdad.
--
-- RLS: sin cambios de políticas. Las columnas nuevas de periodos_cobro y las
-- filas tipo 61 heredan las políticas existentes (P1 tenant + P2 seller de
-- 0006). Esto es DESEADO: el seller DEBE poder ver y descargar su nota de
-- crédito igual que su factura.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS y DO-block
-- con guard en pg_constraint. Re-aplicable sobre base ya migrada.
-- =============================================================================

-- =============================================================================
-- 1. dinero.periodos_cobro — auditoría de anulación
--    NULL salvo que el período esté 'anulado'. Las escribe SOLO service_role
--    (la acción de anulación corre server-side y registra bitácora antes).
-- =============================================================================
alter table dinero.periodos_cobro
  add column if not exists motivo_anulacion text;

alter table dinero.periodos_cobro
  add column if not exists anulado_en timestamptz;

alter table dinero.periodos_cobro
  add column if not exists anulado_por_usuario_id uuid;

comment on column dinero.periodos_cobro.motivo_anulacion is
  'Motivo de la anulación del período (NULL salvo estado=anulado). Texto del
   usuario interno que anuló — sin secretos ni datos de terceros. La emisión de
   la NC (61) que respalda la anulación queda en dinero.documentos_dte.';

comment on column dinero.periodos_cobro.anulado_en is
  'Momento de la anulación del período (NULL salvo estado=anulado).';

comment on column dinero.periodos_cobro.anulado_por_usuario_id is
  'UUID auth del usuario interno que anuló el período (RNF-04: el "quién").
   NULL salvo estado=anulado. Sin FK física a auth.users — mismo patrón que
   cerrado_por_usuario_id.';

-- =============================================================================
-- 2. dinero.documentos_dte — invariantes de NC
-- =============================================================================

-- 2.1 Solo UNA nota de crédito (61) activa por factura (33). Índice único
--     PARCIAL: no afecta a las facturas (tipo 33, dte_referencia_id NULL).
create unique index if not exists idx_dte_nc_unica_por_documento
  on dinero.documentos_dte (dte_referencia_id)
  where tipo_documento = 61;

comment on index dinero.idx_dte_nc_unica_por_documento is
  'Una sola NC (61) por factura (33): un segundo 61 apuntando al mismo
   documento es un error de doble anulación y se rechaza en la base.';

-- 2.2 CHECK de coherencia 61↔referencia: (tipo_documento = 61) si y solo si
--     (dte_referencia_id is not null). Los datos existentes (solo facturas 33
--     con referencia NULL) ya lo cumplen — el ALTER valida sin fallar.
--     DO-block con guard en pg_constraint (los CHECK no soportan IF NOT EXISTS).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname  = 'documentos_dte_referencia_coherente'
      and conrelid = 'dinero.documentos_dte'::regclass
  ) then
    alter table dinero.documentos_dte
      add constraint documentos_dte_referencia_coherente
        check ((tipo_documento = 61) = (dte_referencia_id is not null));
  end if;
end $$;

comment on constraint documentos_dte_referencia_coherente on dinero.documentos_dte is
  'Un 61 (NC) SIEMPRE referencia a su 33; un 33 (factura) NUNCA lleva
   dte_referencia_id. La condición "factura anulada" se deriva del 61 vinculado
   (decisión B6) — no existe columna de estado anulado_por_nc.';

-- =============================================================================
--- 3. Vista public.periodos_cobro — re-crear para exponer las columnas nuevas.
--
-- NOTA TÉCNICA (problema real, no cambio de decisión): una vista `select *`
-- CONGELA su lista de columnas al crearse. La vista de 0006 no incluye ni las
-- columnas de cobranza de 0008 (estado_cobro, monto_pagado_clp, pagado_en) ni
-- las de esta migración. CREATE OR REPLACE VIEW permite APPENDEAR columnas al
-- final (el prefijo existente coincide), preserva grants y re-expone el estado
-- real de la tabla vía PostgREST. La RLS no cambia: security_invoker = true
-- evalúa las políticas P1+P2 de la tabla base con el rol que consulta.
-- =============================================================================
create or replace view public.periodos_cobro
  with (security_invoker = true)
  as select * from dinero.periodos_cobro;

comment on view public.periodos_cobro is
  'Espejo de dinero.periodos_cobro para PostgREST. RLS heredada: P1 + P2 seller.
   Incluye la proyección de cobranza (0008) y la auditoría de anulación (0011).';

-- Grants idempotentes (CREATE OR REPLACE los preserva; explícitos por defensa
-- en profundidad — mismo patrón que 0006/0008).
grant select on public.periodos_cobro to authenticated;
revoke insert, update, delete on public.periodos_cobro from authenticated, anon;
