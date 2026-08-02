-- =============================================================================
-- 0012 · Datos bancarios del conductor (destino del payout F19)
-- =============================================================================
-- Amplía identidad.conductores con el destino de la transferencia saliente
-- (banco + tipo y número de cuenta). Cierra el dato que el job de payout
-- (dinero.payouts_conductor, migración 0011) necesita para instruir la
-- transferencia al adaptador saliente.
--
-- SENSIBILIDAD (Ley 21.431 — dato personal financiero del conductor):
--   - Visible para el PROPIO conductor (su fila) y para los internos del tenant.
--     Un seller JAMÁS ve la nómina de conductores (ni sus datos bancarios) —
--     la política `conductores_select` (migración 0002) ya enumera solo los dos
--     casos permitidos (interno | conductor-su-propia-fila), de modo que estas
--     columnas heredan ese aislamiento sin cambios.
--   - ESCRITURA solo de internos: la política `conductores_update_interno` +
--     el guard por sentencia `trg_conductores_solo_interno_edita` (lanza 42501
--     a cualquier UPDATE de seller/conductor) ya cubren estas columnas. El
--     conductor puede VER su cuenta, pero no editarla: el dato bancario lo fija
--     coordinación/administración del courier (control antifraude).
--
-- No es un secreto cifrado (no es un certificado ni un token): no va en
-- identidad.secretos_cifrados. Es un dato personal financiero que vive junto a
-- la identidad del conductor, protegido por RLS y nunca expuesto a sellers ni a
-- otros tenants.
--
-- Columnas NULLABLE: las filas existentes aún no tienen cuenta; el job de
-- payout ya maneja el NULL con NonRetriableError ("conductor sin datos
-- bancarios"). No se fuerza backfill destructivo.
--
-- Migración IDEMPOTENTE: ADD COLUMN IF NOT EXISTS en las tres columnas y
-- DO-block guardado por pg_constraint para el CHECK. Re-aplicable sin error.
--
-- NO toca políticas RLS (las de 0002 ya cubren estas columnas).
-- NO toca la vista public.conductores (es `select *`: adopta las columnas
-- nuevas automáticamente).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columnas de datos bancarios
-- -----------------------------------------------------------------------------
-- banco: nombre del banco (texto libre; p. ej. 'Banco de Chile', 'BCI',
--        'Santander Chile', 'Banco Estado').
alter table identidad.conductores
  add column if not exists banco text;

-- tipo_cuenta: acotado por CHECK a corriente | vista | ahorro (abajo).
alter table identidad.conductores
  add column if not exists tipo_cuenta text;

-- numero_cuenta: texto — puede llevar ceros a la izquierda; se guarda tal cual.
alter table identidad.conductores
  add column if not exists numero_cuenta text;

-- -----------------------------------------------------------------------------
-- 2. CHECK sobre tipo_cuenta (idempotente vía pg_constraint)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'conductores_tipo_cuenta_valido'
  ) then
    alter table identidad.conductores
      add constraint conductores_tipo_cuenta_valido
      check (tipo_cuenta in ('corriente', 'vista', 'ahorro'));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Comentarios de sensibilidad
-- -----------------------------------------------------------------------------
comment on column identidad.conductores.banco is
  'Banco destino del payout. Dato personal financiero (Ley 21.431). Visible al
   propio conductor (su fila) y a internos del tenant; sellers nunca. Escritura
   solo interna (conductores_update_interno + trg_conductores_solo_interno_edita).';

comment on column identidad.conductores.tipo_cuenta is
  'Tipo de cuenta destino del payout: corriente | vista | ahorro. Dato personal
   financiero (Ley 21.431). Mismo aislamiento que banco.';

comment on column identidad.conductores.numero_cuenta is
  'Número de cuenta destino del payout (texto: conserva ceros a la izquierda).
   Dato personal financiero (Ley 21.431). Mismo aislamiento que banco.';

-- -----------------------------------------------------------------------------
-- 4. Recrear la vista public.conductores
-- -----------------------------------------------------------------------------
-- PostgreSQL no hereda automáticamente columnas nuevas en vistas con SELECT *.
-- Es necesario recrearla explícitamente para que banco/tipo_cuenta/numero_cuenta
-- sean visibles a través de la vista pública (usada por RLS + la app).
-- security_invoker = true: la RLS se evalúa con los privilegios del caller.
create or replace view public.conductores
  with (security_invoker = true)
  as select * from identidad.conductores;
