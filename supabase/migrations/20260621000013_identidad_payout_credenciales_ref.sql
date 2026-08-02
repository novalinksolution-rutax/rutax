-- =============================================================================
-- 0013 · Columna credenciales_payout_ref en courier_config_payout (F19 B-1)
-- =============================================================================
-- La fábrica de payouts (`fabrica-payout.ts`) ya buscaba esta columna para
-- resolver las credenciales Fintoc (account_id + clave privada PEM de firma).
-- La auditoría de seguridad pre-release detectó que la columna no existía en
-- ninguna migración previa, haciendo que todo intento de payout real con el
-- adaptador Fintoc fallara con ErrorPayoutConfig (NonRetriableError).
--
-- Las credenciales se almacenan cifradas en identidad.secretos_cifrados bajo
-- tipo_secreto='credenciales_payout' (enum ya añadido en migración 0011).
-- Esta columna guarda SOLO la referencia opaca (UUID) al secreto cifrado.
-- Nunca se guarda el account_id ni la clave privada en texto plano aquí.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- RLS: la columna hereda las políticas de courier_config_payout ya definidas
-- en 0011 (solo-interno, trigger solo_interno_edita). Sin cambios adicionales.
-- =============================================================================

alter table identidad.courier_config_payout
  add column if not exists credenciales_payout_ref uuid
  references identidad.secretos_cifrados(id) on delete set null;

comment on column identidad.courier_config_payout.credenciales_payout_ref is
  'Referencia opaca al secreto cifrado que contiene {account_id, payout_clave_firma_privada}
   necesarios para que el adaptador Fintoc ejecute transferencias salientes. NULL = método no
   configurado (el job lanza NonRetriableError hasta que el courier configure sus credenciales).
   Escritura exclusiva de internos (courier_config_payout hereda RLS + trigger 0011).';

-- Recrear la vista pública para que incluya la nueva columna.
-- La vista courier_config_payout usa SELECT * → debe recrearse al agregar columnas.
create or replace view public.courier_config_payout
  with (security_invoker = true)
  as select * from identidad.courier_config_payout;
