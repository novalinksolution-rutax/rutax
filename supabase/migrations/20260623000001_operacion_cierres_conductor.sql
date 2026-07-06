-- =============================================================================
-- Migración 0019 · Cierre operativo del conductor (registro propio del courier)
-- =============================================================================
-- Crea operacion.cierres_conductor: el conductor marca el RESULTADO de la entrega
-- (entregado / no_entregado) para SUS pedidos como REGISTRO OPERATIVO DEL COURIER.
--
-- DIFERENCIA con las otras dos capas de entrega:
--   - operacion.pruebas_entrega (0016): POD AUTORITATIVO del same-day PROPIO. Su foto
--     ES la confirmación y CAMBIA el estado del pedido (entregado/fallido). Amurallado
--     del Flex por frontera dura.
--   - operacion.evidencias_entrega (0018): archivo de fotos INFORMATIVO (varias por
--     pedido). No lleva resultado ni cambia estado.
--   - operacion.cierres_conductor (ESTA): el conductor declara el RESULTADO operativo
--     de la entrega (uno por pedido). NO cambia el estado del pedido. Para Flex, el
--     estado oficial lo sigue gobernando la app de Mercado Envíos Flex (obligatoria,
--     no integrable — CLAUDE.md): este cierre es el registro PARALELO del courier para
--     saber qué pasó con cada parada, sin reemplazar el POD de ML. Foto OPCIONAL.
--
-- Por qué uno por pedido (UNIQUE pedido_id): el cierre es la declaración final del
-- conductor sobre esa parada; si se corrige, se ACTUALIZA (upsert), no se acumula.
--
-- Qué crea:
--   1. Tabla operacion.cierres_conductor. resultado (entregado/no_entregado) +
--      motivo (tipo de incidencia cuando no_entregado) + foto OPCIONAL + geocerca.
--      Trigger de consistencia denormalizada (seller_id/conductor_id) calcado de
--      evidencias_entrega. SIN frontera de tipo (aplica a Flex y same-day).
--   2. RLS P1 (tenant) + interno + conductor (su propio cierre) en SELECT. SELLER NO
--      accede (geo_* sensible — criterio MEDIO-3). Escritura SOLO service_role.
--   3. Vista public.cierres_conductor (security_invoker) + grants.
--   4. Reusa el bucket privado `pod-evidencias` (no crea bucket) para la foto opcional.
--
-- Idempotente: drop if exists + create. Re-aplicable sobre una base ya migrada.
--
-- NO toca: pruebas_entrega, evidencias_entrega, la máquina de estados de pedidos ni
-- el motor entrega→dinero. El estado del pedido NO se modifica desde aquí.
-- =============================================================================

-- =============================================================================
-- 0. Preparación idempotente (orden inverso de dependencias).
-- =============================================================================
drop view if exists public.cierres_conductor cascade;
drop table if exists operacion.cierres_conductor cascade;
drop function if exists operacion.cierres_conductor_validar_denormalizados() cascade;

-- =============================================================================
-- 1. Tabla operacion.cierres_conductor
-- =============================================================================
create table if not exists operacion.cierres_conductor (
  -- PK provista por el cliente para idempotencia de sync offline.
  id                     uuid primary key default gen_random_uuid(),

  -- P1: tenant obligatorio.
  tenant_id              uuid not null references identidad.tenants (id) on delete restrict,

  -- UNIQUE: un cierre por pedido (la declaración final del conductor; se actualiza).
  pedido_id              uuid not null unique references operacion.pedidos (id) on delete cascade,

  -- P2/P3: denormalizados desde el pedido, validados por trigger (§2).
  seller_id              uuid not null references identidad.sellers (id) on delete restrict,
  conductor_id           uuid not null references identidad.conductores (id) on delete restrict,

  -- Resultado operativo declarado por el conductor.
  resultado              text not null check (resultado in ('entregado', 'no_entregado')),

  -- Motivo (tipo de incidencia) cuando resultado = 'no_entregado'. NULL si entregado.
  motivo                 text,

  -- Foto OPCIONAL en el bucket privado pod-evidencias. NUNCA una URL pública.
  foto_object_path       text,

  -- Geolocalización + validación de geocerca contra el destino. 'fuera' NO bloquea.
  geo_lat                double precision,
  geo_long               double precision,
  geo_precision_m        double precision,
  distancia_destino_m    double precision,
  geocerca_resultado     operacion.pod_geocerca_resultado not null default 'sin_referencia',

  cerrado_en             timestamptz not null default now(),
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now(),

  -- Coherencia: si no_entregado, exige motivo; si entregado, no lleva motivo.
  constraint cierres_conductor_motivo_coherente check (
    (resultado = 'no_entregado' and motivo is not null)
    or (resultado = 'entregado' and motivo is null)
  ),

  constraint cierres_conductor_seller_pertenece_al_tenant
    foreign key (tenant_id, seller_id)
    references identidad.sellers (tenant_id, id)
    deferrable initially immediate,

  constraint cierres_conductor_conductor_pertenece_al_tenant
    foreign key (tenant_id, conductor_id)
    references identidad.conductores (tenant_id, id)
    deferrable initially immediate
);

comment on table operacion.cierres_conductor is
  'Cierre operativo del conductor: declara el resultado de la entrega (entregado/
   no_entregado) para sus pedidos como REGISTRO DEL COURIER. UNO por pedido (se
   actualiza). NO cambia el estado del pedido — para Flex el estado oficial lo sigue
   gobernando la app de Mercado Envíos Flex (no integrable). Foto OPCIONAL. RLS P1 +
   interno + conductor (su propio cierre). SELLER NO accede. Escritura solo service_role.';

create index if not exists idx_cierres_conductor_tenant_id
  on operacion.cierres_conductor (tenant_id);

create index if not exists idx_cierres_conductor_tenant_conductor
  on operacion.cierres_conductor (tenant_id, conductor_id);

-- =============================================================================
-- 2. Trigger de consistencia denormalizada (calcado de evidencias_entrega §2).
-- =============================================================================
create or replace function operacion.cierres_conductor_validar_denormalizados()
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
    raise exception 'pedido_id % no existe', new.pedido_id using errcode = '23503';
  end if;

  if new.seller_id is distinct from seller_del_pedido then
    raise exception
      'cierres_conductor: seller_id (%) no coincide con pedidos.seller_id (%)',
      new.seller_id, seller_del_pedido using errcode = '23514';
  end if;

  if driver_del_pedido is null then
    raise exception
      'cierres_conductor: el pedido % no tiene conductor asignado', new.pedido_id
      using errcode = '23514';
  end if;

  if new.conductor_id is distinct from driver_del_pedido then
    raise exception
      'cierres_conductor: conductor_id (%) no coincide con pedidos.driver_id_asignado (%)',
      new.conductor_id, driver_del_pedido using errcode = '23514';
  end if;

  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists trg_cierres_conductor_validar_denormalizados on operacion.cierres_conductor;
create trigger trg_cierres_conductor_validar_denormalizados
  before insert or update on operacion.cierres_conductor
  for each row execute function operacion.cierres_conductor_validar_denormalizados();

-- =============================================================================
-- 3. RLS (P1 + interno + conductor; SELLER NO accede). Escritura solo service_role.
-- =============================================================================
alter table operacion.cierres_conductor enable row level security;
alter table operacion.cierres_conductor force row level security;

drop policy if exists cierres_conductor_select on operacion.cierres_conductor;
create policy cierres_conductor_select
  on operacion.cierres_conductor
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or (identidad.claim_tipo_usuario() = 'conductor' and conductor_id = identidad.claim_driver_id())
    )
  );

-- =============================================================================
-- 4. Vista en public con security_invoker = true.
-- =============================================================================
create or replace view public.cierres_conductor
  with (security_invoker = true)
  as select * from operacion.cierres_conductor;

comment on view public.cierres_conductor is
  'Espejo de operacion.cierres_conductor para PostgREST. RLS heredada (security_invoker).
   Escritura exclusiva de service_role.';

-- =============================================================================
-- 5. Grants de API.
-- =============================================================================
grant usage on schema operacion to authenticated, anon;

revoke insert, update, delete on operacion.cierres_conductor from authenticated, anon, public;

grant select on operacion.cierres_conductor to authenticated;
grant select on public.cierres_conductor    to authenticated;

grant usage on schema operacion to service_role;
grant select, insert, update, delete on operacion.cierres_conductor to service_role;
grant select, insert, update, delete on public.cierres_conductor     to service_role;
