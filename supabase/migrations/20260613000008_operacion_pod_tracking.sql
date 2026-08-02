-- =============================================================================
-- Migración 0016 · POD + tracking del ciclo same-day propio (Bloque 2)
-- =============================================================================
-- Cimiento de datos del POD (prueba de entrega) y el tracking en vivo para el
-- ciclo same-day PROPIO del courier. Lo consumen `backend` (Server Actions
-- service_role que registran POD, calculan validez/geocerca y hacen UPSERT de la
-- última ubicación del conductor) y `frontend` (PWA conductor que captura POD;
-- (tenant) y portal/seller que consultan POD; tracking en vivo).
--
-- FRONTERA DURA (gobierna todo el módulo):
--   POD y tracking son EXCLUSIVOS de pedidos tipo_pedido = 'same_day'. En Flex
--   manda la app de Mercado Envíos Flex (obligatoria, no integrable — CLAUDE.md):
--   el software orquesta alrededor, NUNCA la reemplaza. Un POD contra un pedido
--   Flex se RECHAZA en la BD vía trigger BEFORE INSERT (barrera de último recurso
--   aunque el backend se equivoque). Ver §5.
--
-- Qué crea:
--   1. Enums nuevos en `operacion` (DO-blocks idempotentes):
--        pod_resultado, pod_otp_estado, pod_geocerca_resultado.
--   2. Tabla operacion.pruebas_entrega — el POD del same-day. RLS P1+P2+P3
--        (SELECT). Escritura SOLO service_role (como el resto de acciones del
--        conductor hoy). UNIQUE parcial: un solo POD 'entregado' por pedido
--        (idempotencia de sync). Trigger de consistencia denormalizada
--        (seller_id/conductor_id) + trigger de FRONTERA (rechaza Flex).
--   3. Tabla operacion.ubicacion_conductor — SOLO la última posición por
--        conductor (UPSERT, sin histórico/trail — minimización Ley 21.431).
--        RLS P1 interno + P3 conductor (su propia fila). EL SELLER NO ACCEDE.
--   4. Columna operacion.pedidos.tracking_token (nullable, solo same-day) +
--        índice único parcial. Re-emite public.pedidos.
--   5. Bucket privado de Storage `pod-evidencias` (insert idempotente en
--        storage.buckets; también declarado en config.toml). Acceso solo vía
--        URL firmada desde backend — sin políticas públicas de storage.
--
-- Idempotente: DO-blocks para tipos/constraints, create table/index if not
-- exists, add column if not exists, drop ... if exists + create, create or
-- replace view, insert ... on conflict do nothing.
--
-- Contrato de RLS (hereda de Fase A — funciones de claims ya existentes):
--   identidad.claim_tenant_id()    → uuid del tenant del JWT
--   identidad.claim_tipo_usuario() → 'interno' | 'seller' | 'conductor' | 'super_admin'
--   identidad.claim_seller_id()    → uuid del seller (NULL salvo tipo='seller')
--   identidad.claim_driver_id()    → uuid del conductor (NULL salvo tipo='conductor')
--   identidad.solo_interno_edita() → trigger de defensa en profundidad (42501)
--
-- NO toca: la máquina de estados de pedidos, manifiestos, asignación, incidencias
-- ni el motor entrega→dinero. otp_estado es un punto de extensión (sin lógica).
-- =============================================================================

-- =============================================================================
-- 0. Preparación idempotente: remover objetos dependientes en orden inverso
--    para que la migración pueda re-aplicarse sobre una base ya migrada.
-- =============================================================================
drop view if exists public.ubicacion_conductor cascade;
drop view if exists public.pruebas_entrega cascade;

drop table if exists operacion.ubicacion_conductor cascade;
drop table if exists operacion.pruebas_entrega cascade;

drop function if exists operacion.pruebas_entrega_validar_denormalizados() cascade;
drop function if exists operacion.pruebas_entrega_solo_same_day() cascade;

-- Enums al final (en orden inverso). Solo dropean si ya no hay tablas que los usen
-- (los DROP TABLE de arriba ya las quitaron). `if exists` por idempotencia.
drop type if exists operacion.pod_geocerca_resultado cascade;
drop type if exists operacion.pod_otp_estado cascade;
drop type if exists operacion.pod_resultado cascade;

-- =============================================================================
-- 1. Enums nuevos en el esquema operacion
--    DO-blocks idempotentes (el repo no usa `create type if not exists`).
--    Nota: aunque §0 ya los dropeó, mantenemos los DO-blocks por robustez si la
--    migración se edita para no dropear (patrón calcado de la 0013).
-- =============================================================================

-- pod_resultado: desenlace de la prueba de entrega same-day.
--   entregado → el conductor entregó el paquete (POD positivo).
--   fallido   → no se pudo entregar (POD negativo; lleva tipo_incidencia).
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'pod_resultado' and n.nspname = 'operacion'
  ) then
    create type operacion.pod_resultado as enum (
      'entregado',
      'fallido'
    );
  end if;
end $$;

-- pod_otp_estado: punto de extensión para validación por código (OTP) en V2.
--   En el MVP el same-day NO exige OTP → default 'no_aplica'. Sin lógica aún:
--   esta migración solo declara el estado para no migrar dos veces.
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'pod_otp_estado' and n.nspname = 'operacion'
  ) then
    create type operacion.pod_otp_estado as enum (
      'no_aplica',
      'pendiente',
      'validado',
      'omitido'
    );
  end if;
end $$;

-- pod_geocerca_resultado: resultado de la validación de geocerca del POD.
--   dentro         → la captura cayó dentro del radio aceptable del destino.
--   fuera          → la captura cayó fuera del radio aceptable.
--   sin_referencia → no había lat/long de destino, o no se capturó geo (default).
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'pod_geocerca_resultado' and n.nspname = 'operacion'
  ) then
    create type operacion.pod_geocerca_resultado as enum (
      'dentro',
      'fuera',
      'sin_referencia'
    );
  end if;
end $$;

-- =============================================================================
-- 2. Tabla operacion.pruebas_entrega — el POD del same-day
-- =============================================================================
-- Cada fila es una prueba de entrega capturada por el conductor para un pedido
-- SAME-DAY (la frontera la impone el trigger de §5, no solo este comentario).
-- seller_id y conductor_id son DENORMALIZADOS (P2/P3 sin joins) y validados por
-- trigger de consistencia (§4). Las fotos/firmas viven en el bucket privado
-- `pod-evidencias`; aquí solo se guarda el object_path — NUNCA URL pública.
create table operacion.pruebas_entrega (
  id                     uuid primary key default gen_random_uuid(),

  -- P1: tenant obligatorio en toda tabla de negocio.
  tenant_id              uuid not null references identidad.tenants (id) on delete restrict,

  pedido_id              uuid not null references operacion.pedidos (id) on delete cascade,

  -- P2: seller dueño del pedido — denormalizado desde pedidos.seller_id.
  seller_id              uuid not null references identidad.sellers (id) on delete restrict,

  -- P3: conductor que capturó el POD — denormalizado (quién entregó).
  conductor_id           uuid not null references identidad.conductores (id) on delete restrict,

  tipo_resultado         operacion.pod_resultado not null,

  -- Evidencia: fotos/firma viven en el bucket privado pod-evidencias.
  -- *_object_path = ruta en el bucket, NUNCA una URL pública. Las URLs se generan
  -- como signed URLs de vida corta desde el backend.
  tiene_foto             boolean not null default false,
  foto_object_path       text,
  tiene_firma            boolean not null default false,
  firma_object_path      text,

  -- Punto de extensión OTP (sin lógica en el MVP — ver enum pod_otp_estado).
  otp_estado             operacion.pod_otp_estado not null default 'no_aplica',

  -- Geolocalización de la captura + validación de geocerca contra el destino.
  geo_lat                double precision,
  geo_long               double precision,
  geo_precision_m        double precision,
  distancia_destino_m    double precision,
  geocerca_resultado     operacion.pod_geocerca_resultado not null default 'sin_referencia',

  -- Validez del POD: la calcula el BACKEND (no la BD) a partir de foto/firma,
  -- geocerca y reglas del courier. Default false: nace inválido hasta evaluarse.
  es_valido              boolean not null default false,

  -- Si tipo_resultado = 'fallido', el motivo (reusa el enum de incidencias).
  tipo_incidencia        operacion.tipo_incidencia,

  capturado_en           timestamptz not null default now(),
  creado_en              timestamptz not null default now(),

  -- El seller referenciado debe pertenecer al mismo tenant que el POD.
  constraint pruebas_entrega_seller_pertenece_al_tenant
    foreign key (tenant_id, seller_id)
    references identidad.sellers (tenant_id, id)
    deferrable initially immediate,

  -- El conductor referenciado debe pertenecer al mismo tenant que el POD.
  constraint pruebas_entrega_conductor_pertenece_al_tenant
    foreign key (tenant_id, conductor_id)
    references identidad.conductores (tenant_id, id)
    deferrable initially immediate
);

comment on table operacion.pruebas_entrega is
  'Prueba de entrega (POD) del ciclo same-day PROPIO del courier. EXCLUSIVA de
   pedidos tipo_pedido = same_day — un POD contra un pedido Flex se RECHAZA por el
   trigger trg_pruebas_entrega_solo_same_day (frontera dura: Flex lo gobierna la app
   de ML). RLS P1 (tenant) + P2 (seller) + P3 (conductor) en SELECT. Escritura SOLO
   service_role (las acciones del conductor van por Server Action service_role).
   seller_id/conductor_id denormalizados y validados por trigger de consistencia.
   foto_object_path/firma_object_path apuntan al bucket privado pod-evidencias —
   las URLs se generan como signed URLs en la app, jamás expuestas aquí. es_valido lo
   calcula el backend. otp_estado es punto de extensión (sin lógica en el MVP).';

-- UNIQUE parcial: un solo POD 'entregado' por pedido (idempotencia de sync — un
-- reintento del registro de entrega no crea duplicados). Un 'fallido' SÍ puede
-- repetirse (varios intentos fallidos de entrega del mismo pedido same-day).
create unique index if not exists idx_pruebas_entrega_entregado_uk
  on operacion.pruebas_entrega (pedido_id)
  where tipo_resultado = 'entregado';

create index if not exists idx_pruebas_entrega_tenant_id
  on operacion.pruebas_entrega (tenant_id);

create index if not exists idx_pruebas_entrega_pedido_id
  on operacion.pruebas_entrega (pedido_id);

create index if not exists idx_pruebas_entrega_tenant_seller
  on operacion.pruebas_entrega (tenant_id, seller_id);

create index if not exists idx_pruebas_entrega_tenant_conductor
  on operacion.pruebas_entrega (tenant_id, conductor_id);

-- =============================================================================
-- 3. Tabla operacion.ubicacion_conductor — última posición (sin histórico)
-- =============================================================================
-- UNA fila por conductor (PK = conductor_id). El backend hace UPSERT con la
-- última posición conocida. SIN tabla de histórico/trail por minimización de
-- datos personales del trabajador (Ley 21.431): solo se conserva la última
-- ubicación, no el recorrido. EL SELLER NO ACCEDE a esta tabla (dato sensible
-- del trabajador) — su RLS solo contempla interno + el propio conductor.
create table operacion.ubicacion_conductor (
  -- PK = conductor_id: una sola fila por conductor (UPSERT, sin histórico).
  conductor_id    uuid primary key references identidad.conductores (id) on delete cascade,

  -- P1
  tenant_id       uuid not null references identidad.tenants (id) on delete restrict,

  lat             double precision,
  long            double precision,
  precision_m     double precision,

  actualizado_en  timestamptz not null default now(),

  -- El conductor referenciado debe pertenecer al mismo tenant.
  constraint ubicacion_conductor_pertenece_al_tenant
    foreign key (tenant_id, conductor_id)
    references identidad.conductores (tenant_id, id)
    deferrable initially immediate
);

comment on table operacion.ubicacion_conductor is
  'Última posición conocida del conductor (tracking en vivo del same-day). UNA fila
   por conductor (PK = conductor_id, UPSERT). SIN histórico/trail: minimización de
   datos personales del trabajador (Ley 21.431) — solo la última ubicación, no el
   recorrido. RLS P1 (tenant) + P3 (conductor ve SOLO su fila). EL SELLER NO ACCEDE
   (dato sensible del trabajador). Escritura SOLO service_role (Server Action de la
   PWA del conductor).';

create index if not exists idx_ubicacion_conductor_tenant_id
  on operacion.ubicacion_conductor (tenant_id);

-- =============================================================================
-- 4. Trigger de consistencia: seller_id/conductor_id denormalizados del POD
--    deben coincidir con los del pedido (patrón de asignaciones_pedido §10 de
--    la migración 0005). Defiende la integridad en la BD, no solo en la app.
-- =============================================================================
create or replace function operacion.pruebas_entrega_validar_denormalizados()
returns trigger
language plpgsql
as $$
declare
  seller_del_pedido   uuid;
  driver_del_pedido   uuid;
begin
  -- seller_id del POD debe coincidir con pedidos.seller_id.
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
      'pruebas_entrega: seller_id denormalizado (%) no coincide con pedidos.seller_id (%)',
      new.seller_id, seller_del_pedido
      using errcode = '23514'; -- check_violation
  end if;

  -- conductor_id del POD debe coincidir con el conductor asignado al pedido
  -- (driver_id_asignado). Si el pedido no tiene conductor asignado, no se puede
  -- capturar un POD: la entrega same-day la hace el conductor asignado.
  if driver_del_pedido is null then
    raise exception
      'pruebas_entrega: el pedido % no tiene conductor asignado (driver_id_asignado IS NULL)',
      new.pedido_id
      using errcode = '23514';
  end if;

  if new.conductor_id is distinct from driver_del_pedido then
    raise exception
      'pruebas_entrega: conductor_id denormalizado (%) no coincide con pedidos.driver_id_asignado (%)',
      new.conductor_id, driver_del_pedido
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function operacion.pruebas_entrega_validar_denormalizados() is
  'Trigger BEFORE INSERT OR UPDATE en pruebas_entrega: verifica que seller_id
   coincida con pedidos.seller_id y conductor_id con pedidos.driver_id_asignado.
   Lanza 23514 (check_violation) si hay inconsistencia o si el pedido no tiene
   conductor asignado. Mantiene la denormalización P2/P3 íntegra en la BD.';

drop trigger if exists trg_pruebas_entrega_validar_denormalizados on operacion.pruebas_entrega;
create trigger trg_pruebas_entrega_validar_denormalizados
  before insert or update on operacion.pruebas_entrega
  for each row execute function operacion.pruebas_entrega_validar_denormalizados();

-- =============================================================================
-- 5. [FRONTERA DURA] Trigger que rechaza POD contra pedidos que NO sean same_day
--    Barrera de último recurso: aunque el backend se equivoque, la BD NO acepta
--    un POD contra un pedido Flex. En Flex manda la app de Mercado Envíos Flex
--    (obligatoria, no integrable). Este software NUNCA la reemplaza.
-- =============================================================================
create or replace function operacion.pruebas_entrega_solo_same_day()
returns trigger
language plpgsql
as $$
declare
  tipo_del_pedido operacion.tipo_pedido;
begin
  select tipo_pedido into tipo_del_pedido
  from operacion.pedidos
  where id = new.pedido_id;

  if tipo_del_pedido is null then
    raise exception 'pruebas_entrega: pedido_id % no existe', new.pedido_id
      using errcode = '23503'; -- foreign_key_violation
  end if;

  if tipo_del_pedido <> 'same_day' then
    raise exception
      'pruebas_entrega: el POD/tracking propio es EXCLUSIVO de pedidos same_day; el pedido % es % — en Flex manda la app de Mercado Envíos Flex (no integrable)',
      new.pedido_id, tipo_del_pedido
      using errcode = '23514'; -- check_violation
  end if;

  return new;
end;
$$;

comment on function operacion.pruebas_entrega_solo_same_day() is
  'FRONTERA DURA: trigger BEFORE INSERT OR UPDATE en pruebas_entrega que RECHAZA
   (23514) cualquier POD contra un pedido cuyo tipo_pedido <> same_day. En Flex
   gobierna la app obligatoria de Mercado Envíos Flex; este software orquesta
   alrededor y NUNCA la reemplaza. Es la barrera de último recurso aunque el
   backend se equivoque.';

drop trigger if exists trg_pruebas_entrega_solo_same_day on operacion.pruebas_entrega;
create trigger trg_pruebas_entrega_solo_same_day
  before insert or update on operacion.pruebas_entrega
  for each row execute function operacion.pruebas_entrega_solo_same_day();

-- =============================================================================
-- 6. Columna operacion.pedidos.tracking_token (solo same-day)
-- =============================================================================
-- Token opaco para el tracking en vivo del same-day. Nullable: solo se poblará
-- para pedidos same-day (el backend lo genera al iniciar el tracking). No es un
-- secreto cifrado: es un identificador no adivinable para el enlace de tracking.
alter table operacion.pedidos
  add column if not exists tracking_token text;

comment on column operacion.pedidos.tracking_token is
  'Token opaco no adivinable para el enlace de tracking en vivo del same-day.
   Nullable: solo se pobla para pedidos same_day (lo genera el backend). Único
   cuando NO es NULL (índice parcial). No es un secreto cifrado.';

-- Índice único parcial: el token es único entre los pedidos que lo tienen.
create unique index if not exists idx_pedidos_tracking_token_uk
  on operacion.pedidos (tracking_token)
  where tracking_token is not null;

-- =============================================================================
-- 7. RLS — pruebas_entrega (P1 + P2 + P3 en SELECT; escritura solo service_role)
-- =============================================================================
-- SELECT: interno (todo su tenant) OR seller (sus POD) OR conductor (los que
-- capturó). Escritura: NO hay política de INSERT/UPDATE para authenticated — la
-- escritura va por Server Action service_role (igual que el resto de acciones del
-- conductor hoy). FORCE RLS + cero políticas de escritura → ningún authenticated
-- escribe; solo service_role (BYPASSRLS).
alter table operacion.pruebas_entrega enable row level security;
alter table operacion.pruebas_entrega force row level security;

drop policy if exists pruebas_entrega_select on operacion.pruebas_entrega;
create policy pruebas_entrega_select
  on operacion.pruebas_entrega
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or (identidad.claim_tipo_usuario() = 'seller'    and seller_id    = identidad.claim_seller_id())
      or (identidad.claim_tipo_usuario() = 'conductor' and conductor_id = identidad.claim_driver_id())
    )
  );

-- Sin política de INSERT/UPDATE/DELETE para authenticated: la escritura del POD
-- es exclusiva de service_role (Server Action de la PWA del conductor). Se revoca
-- explícitamente cualquier privilegio de escritura heredado a roles de cliente
-- en §10 (solo se otorga SELECT).

-- =============================================================================
-- 8. RLS — ubicacion_conductor (P1 interno + P3 conductor; SELLER NO ACCEDE)
-- =============================================================================
-- SELECT: interno (ve sus conductores) OR el propio conductor (conductor_id =
-- claim_driver_id). El SELLER NO tiene rama en la política → 0 filas (dato
-- sensible del trabajador, Ley 21.431). Escritura solo service_role.
alter table operacion.ubicacion_conductor enable row level security;
alter table operacion.ubicacion_conductor force row level security;

drop policy if exists ubicacion_conductor_select on operacion.ubicacion_conductor;
create policy ubicacion_conductor_select
  on operacion.ubicacion_conductor
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or (identidad.claim_tipo_usuario() = 'conductor' and conductor_id = identidad.claim_driver_id())
    )
  );

-- Sin política de escritura para authenticated → solo service_role escribe el
-- UPSERT de la última posición (Server Action de la PWA del conductor).

-- =============================================================================
-- 9. Vistas en public con security_invoker = true
--    Superficie expuesta a PostgREST. RLS evaluada con el rol que consulta.
-- =============================================================================
create or replace view public.pruebas_entrega
  with (security_invoker = true)
  as select * from operacion.pruebas_entrega;

comment on view public.pruebas_entrega is
  'Espejo de operacion.pruebas_entrega para PostgREST. RLS heredada de la tabla
   base (security_invoker = true): P1 tenant + P2 seller + P3 conductor en SELECT.
   La escritura del POD es exclusiva de service_role (no hay grant de escritura a
   authenticated). foto_object_path/firma_object_path son rutas del bucket privado;
   las URLs firmadas se generan en la app.';

create or replace view public.ubicacion_conductor
  with (security_invoker = true)
  as select * from operacion.ubicacion_conductor;

comment on view public.ubicacion_conductor is
  'Espejo de operacion.ubicacion_conductor para PostgREST. RLS: P1 interno + P3
   conductor (su propia fila). El SELLER NO accede (dato sensible del trabajador,
   Ley 21.431). Escritura exclusiva de service_role.';

-- Re-emitir public.pedidos para heredar la columna tracking_token.
-- create or replace view ... select * → la vista recoge la columna nueva.
-- security_invoker = true se conserva; los grants existentes persisten.
create or replace view public.pedidos
  with (security_invoker = true)
  as select * from operacion.pedidos;

comment on view public.pedidos is
  'Espejo de operacion.pedidos para PostgREST. RLS heredada de la tabla base
   (security_invoker = true): P1 tenant + P2 seller + P3 conductor. Incluye
   tracking_token (solo poblado en same-day) heredando las mismas políticas.';

-- =============================================================================
-- 10. Grants de API
--     Vistas security_invoker = true requieren privilegios DIRECTOS sobre las
--     tablas base en `operacion` para el rol que consulta.
--
--     pruebas_entrega / ubicacion_conductor: SOLO SELECT a authenticated (la
--     escritura es de service_role). Se revoca cualquier insert/update/delete
--     heredado por defensa en profundidad.
-- =============================================================================
grant usage on schema operacion to authenticated, anon;

-- Revocar explícitamente cualquier privilegio de escritura heredado: estas tablas
-- son de escritura exclusiva de service_role.
revoke insert, update, delete on operacion.pruebas_entrega   from authenticated, anon, public;
revoke insert, update, delete on operacion.ubicacion_conductor from authenticated, anon, public;

-- SELECT directo sobre tablas base (requerido por las vistas security_invoker).
grant select on operacion.pruebas_entrega    to authenticated;
grant select on operacion.ubicacion_conductor to authenticated;

-- SELECT sobre las vistas en public.
grant select on public.pruebas_entrega    to authenticated;
grant select on public.ubicacion_conductor to authenticated;

-- pedidos: re-afirmar grants existentes (la vista se re-emitió). Mismo conjunto
-- que la migración 0005 §14 / 0013 §5.
grant select, insert, update on operacion.pedidos to authenticated;
grant select, insert, update on public.pedidos    to authenticated;

-- service_role: BYPASSRLS salta políticas pero NO reemplaza GRANT SQL. Necesita
-- privilegios completos para que las Server Actions registren POD/ubicación.
grant usage on schema operacion to service_role;
grant select, insert, update, delete on operacion.pruebas_entrega    to service_role;
grant select, insert, update, delete on operacion.ubicacion_conductor to service_role;
grant select, insert, update, delete on public.pruebas_entrega        to service_role;
grant select, insert, update, delete on public.ubicacion_conductor    to service_role;
grant select, insert, update, delete on operacion.pedidos             to service_role;
grant select, insert, update, delete on public.pedidos                to service_role;

-- =============================================================================
-- 11. Storage: bucket privado pod-evidencias
-- =============================================================================
-- Bucket PRIVADO (public = false) para fotos/firmas del POD same-day. También se
-- declara en supabase/config.toml ([storage.buckets.pod-evidencias]) para el
-- entorno local. Aquí se crea idempotentemente para entornos desplegados.
--
-- Convención de path (la impone el backend al subir):
--   {tenant_id}/{pedido_id}/{pod_id}/{foto|firma}.<ext>
--
-- Acceso SOLO vía URL firmada generada desde el backend (service_role). NO se
-- crean políticas públicas de storage.objects para authenticated/anon: ni el
-- seller ni el conductor leen el bucket directo — siempre pasan por el backend.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'pod-evidencias',
      'pod-evidencias',
      false,
      52428800, -- 50 MiB
      array['image/png', 'image/jpeg', 'image/webp']
    )
    on conflict (id) do nothing;
  end if;
end $$;
