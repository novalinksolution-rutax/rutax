-- =============================================================================
-- Migración 0018 · Evidencias de entrega INFORMATIVAS (capa paralela a ML Flex)
-- =============================================================================
-- Crea operacion.evidencias_entrega: archivo de evidencia (foto + geo) que el
-- conductor captura en Rutax para SUS pedidos, INDEPENDIENTE del estado del pedido.
--
-- DIFERENCIA CLAVE con operacion.pruebas_entrega (migración 0016):
--   - pruebas_entrega es el POD AUTORITATIVO del ciclo same-day PROPIO: su foto ES
--     la confirmación de entrega (es_valido, tipo_resultado entregado/fallido) y
--     está AMURALLADA del Flex por una frontera dura (trigger solo_same_day).
--   - evidencias_entrega es INFORMATIVA: NUNCA cambia el estado del pedido ni decide
--     validez. Existe para que el courier tenga su PROPIO archivo de evidencias —
--     útil en disputas, reclamos y auditorías internas. Por eso SÍ aplica a Flex:
--     en Flex el estado lo sigue gobernando la app de Mercado Envíos Flex
--     (obligatoria, no integrable — CLAUDE.md). Esta tabla NO la reemplaza: corre
--     en paralelo y solo guarda evidencia. También admite same-day como evidencia
--     SUPLEMENTARIA (el POD autoritativo de ese pedido sigue en pruebas_entrega).
--
-- Como es informativa y no autoritativa, NO lleva es_valido ni tipo_resultado, y
-- NO tiene frontera de tipo de pedido: cualquier pedido (Flex o same-day) asignado
-- al conductor puede llevar evidencia. La única barrera es de pertenencia (el
-- conductor solo evidencia pedidos asignados a él) e integridad denormalizada.
--
-- Qué crea:
--   1. Tabla operacion.evidencias_entrega. Reusa el enum operacion.pod_geocerca_resultado
--      (migración 0016) para el resultado de geocerca. VARIAS evidencias por pedido
--      (sin índice único — un conductor puede adjuntar varias fotos). Idempotencia
--      de sync offline por PK provista por el cliente (ON CONFLICT DO NOTHING).
--      Trigger de consistencia denormalizada (seller_id/conductor_id) calcado de
--      pruebas_entrega. SIN trigger de frontera (Flex es válido aquí).
--   2. RLS P1 (tenant) + interno + conductor (su propia evidencia) en SELECT.
--      EL SELLER NO ACCEDE en este MVP (las columnas geo son un proxy de la
--      dirección/posición — mismo criterio MEDIO-3 de la migración 0017). Un visor
--      de evidencias para el seller, si se decide, usará una vista MINIMIZADA sin
--      columnas geo (no esta tabla base). Escritura SOLO service_role.
--   3. Vista public.evidencias_entrega (security_invoker) + grants.
--   4. Reusa el bucket privado `pod-evidencias` (migración 0016 §11). NO crea bucket.
--      Convención de path (la impone el backend al subir):
--        {tenant_id}/{pedido_id}/evidencia/{evidencia_id}.<ext>
--
-- Idempotente: drop ... if exists + create, create table/index if not exists,
-- create or replace view/function. Re-aplicable sobre una base ya migrada.
--
-- Contrato de RLS (hereda de Fase A — funciones de claims ya existentes):
--   identidad.claim_tenant_id()    → uuid del tenant del JWT
--   identidad.claim_tipo_usuario() → 'interno' | 'seller' | 'conductor' | 'super_admin'
--   identidad.claim_driver_id()    → uuid del conductor (NULL salvo tipo='conductor')
--
-- NO toca: pruebas_entrega, ubicacion_conductor, consentimientos_ubicacion, la
-- máquina de estados de pedidos ni el motor entrega→dinero.
-- =============================================================================

-- =============================================================================
-- 0. Preparación idempotente (orden inverso de dependencias).
-- =============================================================================
drop view if exists public.evidencias_entrega cascade;
drop table if exists operacion.evidencias_entrega cascade;
drop function if exists operacion.evidencias_entrega_validar_denormalizados() cascade;

-- =============================================================================
-- 1. Tabla operacion.evidencias_entrega — evidencia informativa de entrega
-- =============================================================================
-- Cada fila es UNA evidencia (foto) capturada por el conductor para un pedido
-- asignado a él. NO es autoritativa: no cambia el estado del pedido. seller_id y
-- conductor_id son DENORMALIZADOS (P2/P3 sin joins) y validados por trigger (§2).
-- La foto vive en el bucket privado `pod-evidencias`; aquí solo se guarda el
-- object_path — NUNCA una URL pública.
create table if not exists operacion.evidencias_entrega (
  -- PK provista por el cliente para idempotencia de sync offline: un reintento de
  -- subida con el mismo id NO crea un duplicado (ON CONFLICT DO NOTHING).
  id                     uuid primary key default gen_random_uuid(),

  -- P1: tenant obligatorio en toda tabla de negocio.
  tenant_id              uuid not null references identidad.tenants (id) on delete restrict,

  pedido_id              uuid not null references operacion.pedidos (id) on delete cascade,

  -- P2: seller dueño del pedido — denormalizado desde pedidos.seller_id.
  seller_id              uuid not null references identidad.sellers (id) on delete restrict,

  -- P3: conductor que capturó la evidencia — denormalizado (quién evidenció).
  conductor_id           uuid not null references identidad.conductores (id) on delete restrict,

  -- Evidencia: la foto vive en el bucket privado pod-evidencias.
  -- foto_object_path = ruta en el bucket, NUNCA una URL pública. Las URLs se
  -- generan como signed URLs de vida corta desde el backend. NOT NULL: una
  -- evidencia sin foto no tiene sentido en este MVP (solo-foto).
  foto_object_path       text not null,

  -- Nota/caption opcional del conductor (ej: "dejado con conserje"). Punto de
  -- extensión barato; el MVP de captura es solo-foto, pero la columna ya existe.
  nota                   text,

  -- Geolocalización de la captura + validación de geocerca contra el destino.
  -- geocerca_resultado reusa el enum de la migración 0016. 'fuera' NO bloquea: la
  -- evidencia se guarda igual y el coordinador la revisa (decisión de producto).
  geo_lat                double precision,
  geo_long               double precision,
  geo_precision_m        double precision,
  distancia_destino_m    double precision,
  geocerca_resultado     operacion.pod_geocerca_resultado not null default 'sin_referencia',

  -- Hora del dispositivo al capturar (puede ser anterior a subido_en si fue offline).
  capturado_en           timestamptz not null default now(),
  -- Hora del servidor al sincronizar (el momento en que llegó a la BD).
  subido_en              timestamptz not null default now(),
  creado_en              timestamptz not null default now(),

  -- El seller referenciado debe pertenecer al mismo tenant que la evidencia.
  constraint evidencias_entrega_seller_pertenece_al_tenant
    foreign key (tenant_id, seller_id)
    references identidad.sellers (tenant_id, id)
    deferrable initially immediate,

  -- El conductor referenciado debe pertenecer al mismo tenant que la evidencia.
  constraint evidencias_entrega_conductor_pertenece_al_tenant
    foreign key (tenant_id, conductor_id)
    references identidad.conductores (tenant_id, id)
    deferrable initially immediate
);

comment on table operacion.evidencias_entrega is
  'Evidencia de entrega INFORMATIVA (foto + geo) que el conductor captura en Rutax
   para sus pedidos. NO es autoritativa: NUNCA cambia el estado del pedido ni decide
   validez (a diferencia de pruebas_entrega, el POD autoritativo same-day). Por eso
   SÍ aplica a Flex: el estado del Flex lo sigue gobernando la app de Mercado Envíos
   Flex (obligatoria, no integrable) — esta tabla corre en PARALELO y solo guarda el
   archivo de evidencia del courier (disputas/reclamos/auditoría). Admite también
   same-day como evidencia suplementaria. VARIAS por pedido. RLS P1 (tenant) +
   interno + conductor (su propia evidencia). EL SELLER NO accede en este MVP (geo_*
   es un proxy de dirección/posición — criterio MEDIO-3). Escritura SOLO service_role.
   foto_object_path apunta al bucket privado pod-evidencias — URL firmada en la app.';

create index if not exists idx_evidencias_entrega_tenant_id
  on operacion.evidencias_entrega (tenant_id);

create index if not exists idx_evidencias_entrega_pedido_id
  on operacion.evidencias_entrega (pedido_id);

create index if not exists idx_evidencias_entrega_tenant_conductor
  on operacion.evidencias_entrega (tenant_id, conductor_id);

-- =============================================================================
-- 2. Trigger de consistencia: seller_id/conductor_id denormalizados deben
--    coincidir con los del pedido. Calcado de pruebas_entrega (migración 0016 §4):
--    defiende la integridad P2/P3 en la BD, no solo en la app.
-- =============================================================================
create or replace function operacion.evidencias_entrega_validar_denormalizados()
returns trigger
language plpgsql
as $$
declare
  seller_del_pedido   uuid;
  driver_del_pedido   uuid;
begin
  select seller_id, driver_id_asignado
    into seller_del_pedido, driver_del_pedido
  from operacion.pedidos
  where id = new.pedido_id;

  if seller_del_pedido is null then
    raise exception 'pedido_id % no existe', new.pedido_id
      using errcode = '23503'; -- foreign_key_violation
  end if;

  if new.seller_id is distinct from seller_del_pedido then
    raise exception
      'evidencias_entrega: seller_id denormalizado (%) no coincide con pedidos.seller_id (%)',
      new.seller_id, seller_del_pedido
      using errcode = '23514'; -- check_violation
  end if;

  -- Solo el conductor ASIGNADO evidencia el pedido. Si no tiene conductor asignado,
  -- no puede haber evidencia (nadie está a cargo de la entrega todavía).
  if driver_del_pedido is null then
    raise exception
      'evidencias_entrega: el pedido % no tiene conductor asignado (driver_id_asignado IS NULL)',
      new.pedido_id
      using errcode = '23514';
  end if;

  if new.conductor_id is distinct from driver_del_pedido then
    raise exception
      'evidencias_entrega: conductor_id denormalizado (%) no coincide con pedidos.driver_id_asignado (%)',
      new.conductor_id, driver_del_pedido
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function operacion.evidencias_entrega_validar_denormalizados() is
  'Trigger BEFORE INSERT OR UPDATE en evidencias_entrega: verifica que seller_id
   coincida con pedidos.seller_id y conductor_id con pedidos.driver_id_asignado.
   Lanza 23514 si hay inconsistencia o si el pedido no tiene conductor asignado.
   Mantiene la denormalización P2/P3 íntegra en la BD. NO valida tipo_pedido: la
   evidencia informativa aplica tanto a Flex como a same-day.';

drop trigger if exists trg_evidencias_entrega_validar_denormalizados on operacion.evidencias_entrega;
create trigger trg_evidencias_entrega_validar_denormalizados
  before insert or update on operacion.evidencias_entrega
  for each row execute function operacion.evidencias_entrega_validar_denormalizados();

-- =============================================================================
-- 3. RLS — evidencias_entrega (P1 + interno + conductor; SELLER NO accede)
-- =============================================================================
-- SELECT: interno (todo su tenant) OR conductor (sus propias evidencias). El
-- SELLER NO tiene rama → 0 filas (geo_* es sensible — criterio MEDIO-3 de 0017).
-- Escritura: NO hay política de INSERT/UPDATE/DELETE para authenticated — la
-- escritura va por Server Action service_role (igual que pruebas_entrega).
alter table operacion.evidencias_entrega enable row level security;
alter table operacion.evidencias_entrega force row level security;

drop policy if exists evidencias_entrega_select on operacion.evidencias_entrega;
create policy evidencias_entrega_select
  on operacion.evidencias_entrega
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or (identidad.claim_tipo_usuario() = 'conductor' and conductor_id = identidad.claim_driver_id())
    )
  );

-- Sin política de INSERT/UPDATE/DELETE para authenticated: la escritura de la
-- evidencia es exclusiva de service_role (Server Action de la app del conductor).

-- =============================================================================
-- 4. Vista en public con security_invoker = true
-- =============================================================================
create or replace view public.evidencias_entrega
  with (security_invoker = true)
  as select * from operacion.evidencias_entrega;

comment on view public.evidencias_entrega is
  'Espejo de operacion.evidencias_entrega para PostgREST. RLS heredada de la tabla
   base (security_invoker = true): P1 tenant + interno + conductor (su propia
   evidencia). EL SELLER NO accede en este MVP. La escritura es exclusiva de
   service_role. foto_object_path apunta al bucket privado pod-evidencias; las URLs
   firmadas se generan en la app.';

-- =============================================================================
-- 5. Grants de API
--    Vistas security_invoker = true requieren privilegios DIRECTOS sobre la tabla
--    base en `operacion` para el rol que consulta. SOLO SELECT a authenticated
--    (la escritura es de service_role). Se revoca cualquier escritura heredada.
-- =============================================================================
grant usage on schema operacion to authenticated, anon;

revoke insert, update, delete on operacion.evidencias_entrega from authenticated, anon, public;

grant select on operacion.evidencias_entrega to authenticated;
grant select on public.evidencias_entrega    to authenticated;

-- service_role: BYPASSRLS salta políticas pero NO reemplaza GRANT SQL. Necesita
-- privilegios completos para que las Server Actions registren evidencia.
grant usage on schema operacion to service_role;
grant select, insert, update, delete on operacion.evidencias_entrega to service_role;
grant select, insert, update, delete on public.evidencias_entrega     to service_role;
