-- =============================================================================
-- Migración 0017 · Consentimiento de ubicación + minimización del POD al seller
-- =============================================================================
-- Cierra dos hallazgos de seguridad del Bloque 2 (revisión seguridad-cumplimiento):
--
--   ALTO-2 — Tabla autoritativa de consentimiento de geolocalización.
--     Hoy el consentimiento del conductor para compartir su ubicación vive solo
--     en localStorage del cliente + una línea de bitácora (ver
--     src/app/conductor/manifiesto/[pedidoId]/actions.ts ::
--     actionRegistrarConsentimientoUbicacion). Eso NO es una fuente de verdad
--     auditable ni revocable. Se crea operacion.consentimientos_ubicacion como
--     registro autoritativo, con histórico otorgar/revocar (a diferencia de
--     ubicacion_conductor, aquí el histórico SÍ es deseable para cumplimiento —
--     Ley 21.431 / consentimiento del trabajador).
--
--   MEDIO-3 — El seller NO debe ver coordenadas GPS crudas del POD.
--     La política P2 de operacion.pruebas_entrega (migración 0016 §7) dejaba al
--     seller leer la fila COMPLETA, incluidas geo_lat / geo_long / geo_precision_m
--     / distancia_destino_m — coordenadas crudas que son un proxy de la dirección
--     del destinatario y de la posición del conductor. Eso excede la minimización.
--     RLS de Postgres es a nivel de FILA, no de columna, y el seller comparte el
--     rol `authenticated` con interno/conductor → no se puede ocultar columnas por
--     GRANT de rol. Solución (la más limpia y sin romper interno/conductor):
--       (a) QUITAR la rama P2 (seller) de la política SELECT de pruebas_entrega
--           → la política queda interno + conductor. El seller pasa a ver 0 filas
--             en la tabla/vista base (ya no toca las columnas geo).
--       (b) Crear una VISTA NUEVA public.pruebas_entrega_seller (security_invoker)
--           que expone SOLO columnas no sensibles (sin geo_*), con su propio filtro
--           para que el seller vea únicamente los POD de SUS pedidos.
--     Justificación de por qué vista y no otra cosa: una vista security_invoker
--     que NO proyecta las columnas geo es la única forma de hacer minimización por
--     columna cuando el rol es compartido — el seller nunca tiene una ruta SQL a
--     geo_lat/geo_long. geocerca_resultado (enum dentro/fuera/sin_referencia) SÍ
--     es seguro (no es una coordenada); distancia_destino_m se DEJA FUERA por
--     prudencia (distancia exacta sigue siendo un proxy geográfico fino).
--     NOTA: hoy NINGÚN código del seller lee pruebas_entrega (el visor de POD del
--     seller está diferido), así que quitar la rama P2 no rompe nada en producción;
--     el frontend futuro del seller usará public.pruebas_entrega_seller.
--
-- Idempotente: drop ... if exists + create, create table if not exists,
-- create index if not exists, create or replace view, drop policy if exists +
-- create policy. Re-aplicable sobre una base ya migrada.
--
-- Contrato de RLS (hereda de Fase A — funciones de claims ya existentes):
--   identidad.claim_tenant_id()    → uuid del tenant del JWT
--   identidad.claim_tipo_usuario() → 'interno' | 'seller' | 'conductor' | 'super_admin'
--   identidad.claim_seller_id()    → uuid del seller (NULL salvo tipo='seller')
--   identidad.claim_driver_id()    → uuid del conductor (NULL salvo tipo='conductor')
--
-- NO toca: pruebas_entrega.* (columnas/triggers/frontera same-day),
-- ubicacion_conductor, ni el acceso de interno/conductor al POD.
-- =============================================================================

-- =============================================================================
-- 0. Preparación idempotente (orden inverso de dependencias).
-- =============================================================================
drop view if exists public.pruebas_entrega_seller cascade;
drop view if exists public.consentimientos_ubicacion cascade;
drop table if exists operacion.consentimientos_ubicacion cascade;

-- =============================================================================
-- 1. [ALTO-2] Tabla operacion.consentimientos_ubicacion
-- =============================================================================
-- Registro AUTORITATIVO del consentimiento del conductor para compartir su
-- ubicación en vivo (same-day). Reemplaza el localStorage como fuente de verdad.
--
-- Modelo de "consentimiento VIGENTE": el registro más reciente del conductor con
-- acepto = true y revocado_en IS NULL. Se conserva el HISTÓRICO completo de
-- otorgar/revocar (a diferencia de ubicacion_conductor, que solo guarda la última
-- posición): para cumplimiento (Ley 21.431) interesa la trazabilidad de cuándo el
-- trabajador otorgó o revocó su consentimiento y bajo qué versión del texto.
create table if not exists operacion.consentimientos_ubicacion (
  id              uuid primary key default gen_random_uuid(),

  -- P1: tenant obligatorio en toda tabla de negocio.
  tenant_id       uuid not null references identidad.tenants (id) on delete restrict,

  -- P3: el conductor que otorga/revoca el consentimiento.
  conductor_id    uuid not null references identidad.conductores (id) on delete cascade,

  -- true = otorgó; false = registró un rechazo explícito (también histórico).
  acepto          boolean not null,

  -- Versión del texto de consentimiento aceptado (trazabilidad legal: a qué
  -- redacción dio su consentimiento el conductor). NULL si aún no versionado.
  version_texto   text,

  otorgado_en     timestamptz not null default now(),

  -- Se rellena si el conductor revoca DESPUÉS un consentimiento previamente
  -- otorgado. Un registro con acepto = true y revocado_en NOT NULL ya NO es vigente.
  revocado_en     timestamptz,

  creado_en       timestamptz not null default now(),

  -- El conductor referenciado debe pertenecer al mismo tenant que el consentimiento.
  constraint consentimientos_ubicacion_conductor_pertenece_al_tenant
    foreign key (tenant_id, conductor_id)
    references identidad.conductores (tenant_id, id)
    deferrable initially immediate
);

comment on table operacion.consentimientos_ubicacion is
  'Registro AUTORITATIVO del consentimiento del conductor para compartir su
   ubicación en vivo (same-day) — reemplaza el localStorage como fuente de verdad
   (cierra ALTO-2). Histórico de otorgar/revocar SÍ deseable (Ley 21.431,
   trazabilidad legal). Consentimiento VIGENTE = registro más reciente del
   conductor con acepto = true y revocado_en IS NULL. RLS: SELECT para interno
   (su nómina) y el propio conductor; el SELLER NO accede. Escritura SOLO
   service_role (Server Action de la PWA del conductor); sin política INSERT/UPDATE
   para authenticated.';

comment on column operacion.consentimientos_ubicacion.version_texto is
  'Versión del texto de consentimiento al que el conductor dio su aceptación —
   trazabilidad legal de la redacción vigente al momento del consentimiento.';

comment on column operacion.consentimientos_ubicacion.revocado_en is
  'Momento en que el conductor revocó un consentimiento previamente otorgado. Un
   registro con acepto = true y revocado_en NOT NULL ya no es vigente.';

-- Índice del modelo "vigente": el backend resuelve el consentimiento actual con
-- ORDER BY otorgado_en DESC LIMIT 1 sobre (tenant_id, conductor_id); el índice
-- DESC lo sirve sin sort.
create index if not exists idx_consentimientos_ubicacion_vigente
  on operacion.consentimientos_ubicacion (tenant_id, conductor_id, otorgado_en desc);

-- =============================================================================
-- 2. [ALTO-2] RLS de consentimientos_ubicacion (interno + conductor; SELLER NO)
-- =============================================================================
-- SELECT: interno (ve su nómina de conductores) OR el propio conductor
-- (conductor_id = claim_driver_id). El SELLER NO tiene rama → 0 filas. Escritura
-- SOLO service_role: sin política INSERT/UPDATE/DELETE para authenticated, y se
-- revoca cualquier privilegio de escritura heredado (defensa en profundidad).
alter table operacion.consentimientos_ubicacion enable row level security;
alter table operacion.consentimientos_ubicacion force row level security;

drop policy if exists consentimientos_ubicacion_select on operacion.consentimientos_ubicacion;
create policy consentimientos_ubicacion_select
  on operacion.consentimientos_ubicacion
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
-- registro/revocación de consentimiento (Server Action de la PWA del conductor).

-- =============================================================================
-- 3. [ALTO-2] Vista public.consentimientos_ubicacion (security_invoker)
-- =============================================================================
create or replace view public.consentimientos_ubicacion
  with (security_invoker = true)
  as select * from operacion.consentimientos_ubicacion;

comment on view public.consentimientos_ubicacion is
  'Espejo de operacion.consentimientos_ubicacion para PostgREST. RLS heredada
   (security_invoker = true): interno (su nómina) + el propio conductor. El SELLER
   NO accede. Escritura exclusiva de service_role.';

-- =============================================================================
-- 4. [MEDIO-3] Quitar la rama P2 (seller) de la política SELECT de pruebas_entrega
-- =============================================================================
-- La política pasa de (interno OR seller OR conductor) a (interno OR conductor).
-- El seller deja de ver filas en operacion.pruebas_entrega / public.pruebas_entrega
-- → ya no tiene ninguna ruta SQL a geo_lat/geo_long/geo_precision_m/distancia_destino_m.
-- El acceso de interno y conductor queda intacto (mismas dos ramas que antes).
drop policy if exists pruebas_entrega_select on operacion.pruebas_entrega;
create policy pruebas_entrega_select
  on operacion.pruebas_entrega
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or (identidad.claim_tipo_usuario() = 'conductor' and conductor_id = identidad.claim_driver_id())
    )
  );

comment on table operacion.pruebas_entrega is
  'Prueba de entrega (POD) del ciclo same-day PROPIO del courier. EXCLUSIVA de
   pedidos tipo_pedido = same_day — un POD contra un pedido Flex se RECHAZA por el
   trigger trg_pruebas_entrega_solo_same_day (frontera dura: Flex lo gobierna la app
   de ML). RLS SELECT: P1 (tenant) + interno + conductor (su propio POD). El SELLER
   YA NO accede a esta tabla (minimización MEDIO-3: las columnas geo_* son un proxy
   de la dirección del destinatario y de la posición del conductor) — el seller usa
   public.pruebas_entrega_seller, que omite las coordenadas. Escritura SOLO
   service_role. seller_id/conductor_id denormalizados y validados por trigger de
   consistencia. foto_object_path/firma_object_path apuntan al bucket privado
   pod-evidencias — las URLs se generan como signed URLs en la app, jamás expuestas
   aquí. es_valido lo calcula el backend. otp_estado es punto de extensión.';

-- =============================================================================
-- 5. [MEDIO-3] Vista public.pruebas_entrega_seller — POD minimizado para el seller
-- =============================================================================
-- Mecanismo: la TABLA base ya NO tiene rama P2 (§4), así que el seller no puede
-- leer pruebas_entrega por RLS (ni siquiera vía una vista security_invoker, que
-- evaluaría la RLS con el rol del seller → 0 filas). Para darle acceso por-COLUMNA
-- (sin geo_*) acotado a SUS pedidos, usamos una FUNCIÓN SECURITY DEFINER que:
--   - corre como su owner (postgres, bypassa RLS) pero se acota POR DENTRO al
--     claim del seller (tipo='seller', tenant_id, seller_id) → nunca filtra a otro
--     seller ni a otro tenant;
--   - proyecta SOLO columnas no sensibles (sin geo_lat/geo_long/geo_precision_m ni
--     distancia_destino_m) → el seller jamás tiene una ruta SQL a las coordenadas.
-- geocerca_resultado SÍ se expone (enum dentro/fuera/sin_referencia: es un
-- resultado, no una coordenada). La distancia exacta se OMITE por prudencia
-- (proxy geográfico fino). La vista pública (§5.2) es un envoltorio sobre la
-- función — la función es la frontera de seguridad real.

-- 5.1 Función security definer que devuelve los POD del seller autenticado con
--     SOLO las columnas no sensibles. SECURITY DEFINER (owner postgres, bypassa
--     RLS) pero acotada por dentro al seller del claim → no filtra a otros sellers
--     ni a otros tenants, y NUNCA proyecta columnas geo. Es la forma de dar al
--     seller acceso por-columna sin reintroducir una rama RLS que exponga la fila
--     completa.
create or replace function operacion.pruebas_entrega_del_seller()
returns table (
  id                  uuid,
  pedido_id           uuid,
  seller_id           uuid,
  tenant_id           uuid,
  tipo_resultado      operacion.pod_resultado,
  tiene_foto          boolean,
  tiene_firma         boolean,
  es_valido           boolean,
  geocerca_resultado  operacion.pod_geocerca_resultado,
  tipo_incidencia     operacion.tipo_incidencia,
  capturado_en        timestamptz
)
language sql
stable
security definer
set search_path = operacion, identidad, public
as $$
  select
    pe.id,
    pe.pedido_id,
    pe.seller_id,
    pe.tenant_id,
    pe.tipo_resultado,
    pe.tiene_foto,
    pe.tiene_firma,
    pe.es_valido,
    pe.geocerca_resultado,
    pe.tipo_incidencia,
    pe.capturado_en
  from operacion.pruebas_entrega pe
  where identidad.claim_tipo_usuario() = 'seller'
    and pe.tenant_id = identidad.claim_tenant_id()
    and pe.seller_id = identidad.claim_seller_id();
$$;

comment on function operacion.pruebas_entrega_del_seller() is
  'Devuelve los POD del seller autenticado con SOLO las columnas no sensibles
   (sin geo_lat/geo_long/geo_precision_m ni distancia_destino_m). SECURITY DEFINER
   acotada por dentro al claim del seller (tipo=seller, tenant, seller_id) → no
   filtra a otros sellers/tenants. Es el mecanismo de minimización por columna
   (MEDIO-3) dado que el seller comparte el rol authenticated y RLS no oculta
   columnas. La consume la vista public.pruebas_entrega_seller.';

-- Solo el seller (vía authenticated) y service_role ejecutan la función.
revoke all on function operacion.pruebas_entrega_del_seller() from public;
grant execute on function operacion.pruebas_entrega_del_seller() to authenticated, service_role;

-- 5.2 Vista pública sobre la función. Sin geo_*. El seller la consulta; interno y
--     conductor obtienen 0 filas (la función exige tipo='seller').
create or replace view public.pruebas_entrega_seller
  as select * from operacion.pruebas_entrega_del_seller();

comment on view public.pruebas_entrega_seller is
  'POD same-day visible al SELLER, MINIMIZADO (cierra MEDIO-3): expone solo
   columnas no sensibles (id, pedido_id, seller_id, tenant_id, tipo_resultado,
   tiene_foto, tiene_firma, es_valido, geocerca_resultado, tipo_incidencia,
   capturado_en). NUNCA geo_lat/geo_long/geo_precision_m ni distancia_destino_m
   (coordenadas crudas = proxy de la dirección del destinatario/posición del
   conductor). Filtrada al seller autenticado por la función security definer
   operacion.pruebas_entrega_del_seller. La foto se sirve aparte vía URL firmada
   generada en el backend. El frontend del seller (visor de POD, diferido) usa
   esta vista, NO public.pruebas_entrega.';

-- =============================================================================
-- 6. Grants de API
-- =============================================================================
grant usage on schema operacion to authenticated, anon;

-- consentimientos_ubicacion: SOLO SELECT a authenticated (escritura de service_role).
-- Revocar explícitamente cualquier privilegio de escritura heredado.
revoke insert, update, delete on operacion.consentimientos_ubicacion from authenticated, anon, public;
grant select on operacion.consentimientos_ubicacion to authenticated;
grant select on public.consentimientos_ubicacion    to authenticated;

-- pruebas_entrega_seller: SELECT sobre la vista. La función SECURITY DEFINER ya
-- acota las filas; no se requiere grant directo del seller sobre la tabla base
-- (la función corre como su owner). El grant de SELECT sobre operacion.pruebas_entrega
-- a authenticated (migración 0016 §10) se mantiene para interno/conductor.
grant select on public.pruebas_entrega_seller to authenticated;

-- service_role: BYPASSRLS no reemplaza GRANT SQL. Privilegios completos para que
-- las Server Actions registren/revoquen consentimiento.
grant usage on schema operacion to service_role;
grant select, insert, update, delete on operacion.consentimientos_ubicacion to service_role;
grant select, insert, update, delete on public.consentimientos_ubicacion     to service_role;
grant select on public.pruebas_entrega_seller to service_role;
