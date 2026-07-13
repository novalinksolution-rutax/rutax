-- =============================================================================
-- 20260710000001 · Plataforma — auto-cobro (mandato Fintoc), periodicidad y
--                   trazado de cambio de plan en plataforma.suscripciones
-- =============================================================================
-- Migración ADITIVA e IDEMPOTENTE. Parte de la Fase 1 de "completar
-- suscripciones" (backstage Rutax → courier). Extiende plataforma.suscripciones
-- para: (I) trazar cambios de plan con proración; (J) soportar facturación
-- anual; y habilitar el auto-cobro vía mandato Fintoc, guardando SOLO una
-- referencia opaca al secreto cifrado del mandato — nunca el token en claro.
--
-- AISLAMIENTO — SIN CAMBIOS (crítico, prioridad #1):
--   NO se crea ninguna política RLS para `authenticated`/`anon`, ni grants a
--   esos roles, ni vistas en `public`. Las columnas nuevas quedan cubiertas por
--   el MISMO deny-all de la tabla base (RLS enable+force SIN políticas + grants
--   revocados a authenticated/anon, migración 0015 20260621000015). En Postgres,
--   un GRANT de TABLA (no de columna) alcanza automáticamente las columnas
--   futuras, así que los `grant select,insert,update,delete ... to service_role`
--   de la migración 0015 YA cubren estas columnas. Un courier autenticado sigue
--   sin poder leer NADA de este schema (verificado en la prueba pgTAP
--   rls_aislamiento_plataforma.test.sql, que afirma 42501 incluyendo las
--   columnas nuevas). Se reafirma el revoke a authenticated/anon como defensa en
--   profundidad (idempotente).
--
-- DECISIÓN mandato_ref (referencia al secreto cifrado, NO el token en claro):
--   `mandato_ref` es una referencia OPACA (uuid) a
--   identidad.secretos_cifrados.referencia_externa_id — el MISMO patrón que usan
--   todas las tablas de negocio para apuntar a un secreto (courier_config_dte.
--   certificado_digital_ref, courier_config_payout.payout_credenciales_ref,
--   conexiones_seller_ml.*_ref, …) y el MISMO valor que devuelve la utilidad de
--   cifrado (`CifrarResultado.referenciaExternaId`, src/modules/integraciones/
--   secretos). Queda SIN FK física, por decisión, por dos razones:
--     (a) Convención del repo (migración 0003 §2): los `*_ref` a
--         secretos_cifrados van SIN FK a propósito, para mantener
--         secretos_cifrados desacoplada y no exponible vía joins.
--     (b) La app persiste `referencia_externa_id`, NO la PK `id`. Una FK a
--         secretos_cifrados(id) —como sugería el borrador— apuntaría a una
--         columna que la app nunca guarda aquí (la FK sería insatisfacible), y
--         `referencia_externa_id` solo tiene índice UNIQUE (no CONSTRAINT), que
--         Postgres no admite como destino de FK. Por eso: uuid opaco, sin FK.
--   El id/token del mandato Fintoc vive cifrado en secretos_cifrados
--   (tipo_secreto = 'mandato_suscripcion_fintoc'); aquí solo el puntero opaco.
--
-- Idempotente: ADD VALUE guardado contra pg_enum; ADD COLUMN IF NOT EXISTS en
-- cada columna (cada sub-cláusula se evalúa por separado). Re-aplicable sobre
-- una base ya migrada.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enum identidad.tipo_secreto += 'mandato_suscripcion_fintoc'
-- -----------------------------------------------------------------------------
-- Mismo patrón idempotente que las migraciones 0008 (Fintoc cobranza) y 0011
-- (payout) para AMPLIAR este mismo enum: guard contra pg_enum + `add value`.
-- `ALTER TYPE ... ADD VALUE` puede correr dentro de la transacción de la
-- migración (PG ≥12) SIEMPRE que el nuevo valor NO se use en la misma
-- transacción; aquí solo se agrega al enum (mandato_ref es uuid, no el enum),
-- así que es seguro. Idempotente: si el valor ya existe, no hace nada.
do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'tipo_secreto'
       and e.enumlabel = 'mandato_suscripcion_fintoc'
  ) then
    alter type identidad.tipo_secreto add value 'mandato_suscripcion_fintoc';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Columnas ADITIVAS en plataforma.suscripciones
-- -----------------------------------------------------------------------------
alter table plataforma.suscripciones
  add column if not exists periodicidad text not null default 'mensual'
    check (periodicidad in ('mensual','anual')),
  add column if not exists auto_cobro_habilitado boolean not null default false,
  add column if not exists mandato_estado text not null default 'sin_mandato'
    check (mandato_estado in ('sin_mandato','pendiente','activo','cancelado','fallido')),
  add column if not exists mandato_ref uuid,
  add column if not exists plan_anterior_id uuid references plataforma.planes(id),
  add column if not exists cambio_efectivo_desde date;

comment on column plataforma.suscripciones.periodicidad is
  'Periodicidad de cobro de la suscripción: mensual|anual (item J, facturación anual). '
  'Default mensual. No cambia el deny-all: sin políticas para authenticated.';
comment on column plataforma.suscripciones.auto_cobro_habilitado is
  'Si el courier habilitó el auto-cobro por mandato Fintoc. Default false (opt-in explícito). '
  'No cambia el deny-all: sin políticas para authenticated.';
comment on column plataforma.suscripciones.mandato_estado is
  'Estado del mandato de auto-cobro Fintoc: sin_mandato|pendiente|activo|cancelado|fallido. '
  'No cambia el deny-all: sin políticas para authenticated.';
comment on column plataforma.suscripciones.mandato_ref is
  'Referencia OPACA (referencia_externa_id) al secreto cifrado del mandato Fintoc en '
  'identidad.secretos_cifrados (tipo_secreto = mandato_suscripcion_fintoc). NUNCA el token '
  'en claro. Sin FK física a propósito (ver cabecera de la migración). No cambia el deny-all.';
comment on column plataforma.suscripciones.plan_anterior_id is
  'Plan previo al último cambio de plan (item I, proración): traza desde qué plan venía. '
  'FK a plataforma.planes(id). No cambia el deny-all: sin políticas para authenticated.';
comment on column plataforma.suscripciones.cambio_efectivo_desde is
  'Fecha desde la que el cambio de plan es efectivo (proración). Zona horaria America/Santiago. '
  'No cambia el deny-all: sin políticas para authenticated.';

-- -----------------------------------------------------------------------------
-- 3. Reafirmación del deny-all (defensa en profundidad, idempotente)
-- -----------------------------------------------------------------------------
-- Los grants a service_role de la migración 0015 (a nivel de TABLA) ya alcanzan
-- las columnas nuevas; NO se otorga nada nuevo a service_role aquí. Se reafirma
-- el revoke a authenticated/anon: no aporta acceso nuevo, solo blinda que las
-- columnas nuevas NO se filtren si algún grant heredado apareciera.
revoke all on plataforma.suscripciones from authenticated, anon;
