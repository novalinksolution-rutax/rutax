-- Retira la columna identidad.tenants.puesta_en_marcha_completada_en.
--
-- La creó 20260912000001 para el wizard obligatorio de onboarding (F2),
-- que ya se retiró (se restauró el onboarding progresivo, sin muro).
-- Ningún código TypeScript ni pgTAP la referencia; se limpia el esquema.
--
-- Idempotente por IF EXISTS: re-aplicar no falla si la columna ya no está.

alter table identidad.tenants
  drop column if exists puesta_en_marcha_completada_en;
