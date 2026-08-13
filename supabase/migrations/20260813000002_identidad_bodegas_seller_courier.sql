-- =============================================================================
-- Bodegas — etapas 2 y 2b del alcance "retiro en bodega + ruteo"
-- =============================================================================
-- Crea las DOS tablas de lugares físicos que el alcance necesita y que hoy no
-- existen en ningún esquema (verificado: ni `identidad.tenants` ni
-- `identidad.sellers` guardan una dirección):
--
--   1. identidad.seller_bodegas   — DÓNDE SE RETIRA. Un seller puede tener
--                                   varias (el courier real describió un
--                                   conductor visitando tres bodegas distintas
--                                   en una mañana: 30 + 30 + 70 bultos).
--   2. identidad.courier_bodegas  — DE DÓNDE SE SALE A REPARTIR. Es la bodega
--                                   del coordinador, el punto de consolidación
--                                   del cross-dock y el ORIGEN de toda ruta
--                                   (etapa 7). No es la del seller: son dos
--                                   lugares distintos del mismo día operativo.
--
-- POR QUÉ SON DOS TABLAS Y NO UNA CON `tipo`: no comparten dueño ni alcance de
-- lectura. La del seller la ve su seller (es su propia bodega); la del courier
-- es interna y el seller NO debe verla — saber desde qué galpón opera su
-- proveedor no es información suya. Fundir ambas en una tabla obligaría a que
-- la política de lectura del seller dependiera de una columna `tipo`, que es
-- justo la clase de condición que se rompe en silencio al agregar un tipo nuevo.
--
-- POR QUÉ NO SE AGREGA `direccion` A `identidad.sellers`: sería una segunda
-- verdad compitiendo con seller_bodegas. Un seller con tres bodegas no tiene
-- "una dirección", y la que quedara en la fila del seller se volvería el dato
-- que la gente copia sin saber cuál de las tres es.
--
-- AISLAMIENTO (la razón de ser de esta migración):
--   · seller_bodegas   → P1 tenant + P2 seller. Interno ve las de su tenant;
--                        el seller ve EXCLUSIVAMENTE las suyas. Conductor: 0.
--                        Escritura: solo interno (las carga el courier).
--   · courier_bodegas  → P1 tenant estricta, solo interno. Seller: 0 filas.
--                        Conductor: 0 filas por esta vía — la app del conductor
--                        recibe el punto de partida de su ruta por endpoint
--                        Bearer con service_role y DTO mínimo (etapa 7), no
--                        ampliando esta política.
--   · Ninguna de las dos admite DELETE desde sesión de usuario. La baja es
--     `activa = false`: una bodega borrada dejaría huérfanas las visitas de
--     retiro históricas (etapa 3) y las rutas ya ejecutadas (etapa 7).
--
-- Molde estructural: 20260613000004 (`identidad.zonas` / `ventanas_corte`) —
-- vista espejo security_invoker, RLS enable+force, guard solo_interno_edita,
-- FK compuesta (tenant_id, seller_id), grants directos sobre la tabla base.
-- El `revoke delete` sale de `bitacora_auditoria` (20260101000004:366-367,382),
-- y el guard cubriendo las TRES escrituras sale de 20260613000006:14-26.
--
-- Idempotente: create table/index if not exists, create or replace view,
-- drop trigger if exists + create, drop policy if exists + create.
-- Prueba de aislamiento: supabase/tests/database/rls_aislamiento_bodegas.test.sql
-- =============================================================================

-- =============================================================================
-- 1. identidad.seller_bodegas — dónde se retira (etapa 2)
-- =============================================================================
-- Cada fila es un punto físico de retiro de un seller. La carga el courier (no
-- el seller): es el courier quien coordina con el jefe de bodega y quien sufre
-- una dirección mal escrita. El seller la ve para verificar que es correcta.
--
-- Las columnas de geocoding (lat, long, geo_estado, geo_confianza,
-- geocodificado_en) espejan el contrato del puerto de `integraciones` para que
-- la bodega se resuelva con el MISMO adaptador que ya geocodifica los pedidos.
-- Sin coordenada la bodega no puede ser el primer punto de una ruta, así que
-- geocodificarla no es opcional — pero se hace asincrónicamente (job), por eso
-- lat/long nacen NULL y `geo_estado` nace 'pendiente'.
create table if not exists identidad.seller_bodegas (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references identidad.tenants (id) on delete cascade,
  seller_id            uuid not null references identidad.sellers (id) on delete restrict,

  nombre               text not null,
  direccion            text not null,
  comuna               text not null,

  instrucciones_acceso text,
  contacto_nombre      text,
  contacto_telefono    text,

  es_principal         boolean not null default false,
  activa               boolean not null default true,

  lat                  double precision,
  long                 double precision,
  geo_estado           text not null default 'pendiente',
  geo_confianza        numeric(4,3),
  geocodificado_en     timestamptz,

  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now(),

  -- El seller referenciado debe pertenecer al MISMO tenant. La FK simple de
  -- arriba garantiza que el seller existe; esta garantiza que es de este
  -- courier, sin confiar en la disciplina de inserción de la aplicación. La
  -- constraint que necesita del lado de sellers (sellers_tenant_id_id_uk) YA
  -- existe desde 20260101000004:49 — no hay que crearla.
  constraint seller_bodegas_seller_pertenece_al_tenant
    foreign key (tenant_id, seller_id)
    references identidad.sellers (tenant_id, id)
    deferrable initially immediate,

  -- Habilita las FK compuestas (tenant_id, bodega_id) que van a necesitar la
  -- sesión de retiro (etapa 3) y la parada de origen de la ruta (etapa 7).
  -- Se crea AHORA a propósito: el precedente literal es sellers_tenant_id_id_uk,
  -- que no existía y hubo que agregarla después con un DO-block. Sin ella, esas
  -- dos etapas obligan a re-migrar esta tabla.
  constraint seller_bodegas_tenant_id_id_uk unique (tenant_id, id),

  -- text + CHECK, NO enum, y es deliberado: estos cuatro valores son el
  -- contrato del puerto de geocoding de `integraciones`, y un enum en
  -- `identidad` invertiría la dirección de dependencia entre esquemas. El repo
  -- ya resolvió este mismo caso igual en integraciones.geocoding_cache.geo_estado
  -- (20260613000003:74-77). Los tres valores no-'pendiente' coinciden con
  -- EstadoGeocoding de src/modules/integraciones/geocoding/tipos.ts:25.
  constraint seller_bodegas_geo_estado_valido check (
    geo_estado in ('pendiente', 'resuelto', 'no_resuelto', 'fuera_cobertura')
  ),

  constraint seller_bodegas_geo_confianza_rango check (
    geo_confianza is null or (geo_confianza >= 0 and geo_confianza <= 1)
  ),

  -- Una bodega dada de baja no puede seguir siendo la principal del seller:
  -- si no, la ruta y el retiro seguirían apuntando a un galpón que ya no opera.
  constraint seller_bodegas_principal_debe_estar_activa check (
    not es_principal or activa
  )
);

comment on table identidad.seller_bodegas is
  'Puntos físicos de retiro de un seller (1:N — el courier real describió un
   conductor visitando tres bodegas de sellers distintos en una mañana). Las
   carga el courier; el seller las VE (P2) pero no las escribe. RLS: P1 tenant +
   P2 seller; el conductor ve 0 filas por esta vía. Sin DELETE para sesiones de
   usuario: la baja es activa = false, porque borrar la fila dejaría huérfanas
   las visitas de retiro históricas (etapa 3). unique (tenant_id, id) habilita
   las FK compuestas de las etapas 3 y 7.';

comment on column identidad.seller_bodegas.nombre is
  'Cómo la nombra el courier al coordinar ("Bodega Quilicura", "Local Centro").
   Único entre las ACTIVAS del mismo seller: dos bodegas vivas con el mismo
   nombre hacen imposible que el conductor sepa a cuál va. Al dar de baja una,
   el nombre queda libre para reutilizarse.';

comment on column identidad.seller_bodegas.instrucciones_acceso is
  'Texto libre operativo: portón, timbre, horario del jefe de bodega, dónde
   estacionar. Es lo que hoy viaja por WhatsApp y se pierde.';

comment on column identidad.seller_bodegas.contacto_telefono is
  'Teléfono del contacto EN LA BODEGA (dato de negocio del seller, no del
   destinatario). Se minimiza igual: no se expone en la app del conductor más
   allá de la bodega que le toca visitar hoy.';

comment on column identidad.seller_bodegas.es_principal is
  'Bodega por defecto del seller. El índice parcial garantiza COMO MÁXIMO una
   principal por (tenant, seller) — no "exactamente una": un seller sin bodegas
   cargadas es un estado legítimo, y la regla "la primera que se crea nace
   principal" vive en la Server Action, no en la base.';

comment on column identidad.seller_bodegas.activa is
  'false = bodega dada de baja. Sustituye al DELETE (que está revocado): la
   fila se conserva para que el histórico de retiros siga siendo legible.';

comment on column identidad.seller_bodegas.geo_estado is
  'Estado de la geocodificación de esta bodega. text + CHECK (no enum) porque es
   el contrato del puerto de integraciones — mismo criterio que
   integraciones.geocoding_cache.geo_estado. Nace pendiente: la resuelve un job,
   no la escritura del formulario. Sin resolver, la bodega no puede ser el primer
   punto de una ruta.';

comment on column identidad.seller_bodegas.geo_confianza is
  'Confianza del proveedor (0.000–1.000). NULL mientras geo_estado <> resuelto.
   Una confianza baja es la señal de "verifica esta dirección a mano" antes de
   mandar a un conductor a buscar 70 bultos a la nada.';

-- Como máximo UNA principal por seller dentro del tenant. Índice parcial: solo
-- indexa las filas con es_principal = true, así que su tamaño es ~1 fila por
-- seller y no estorba al resto de la tabla.
create unique index if not exists seller_bodegas_principal_uk
  on identidad.seller_bodegas (tenant_id, seller_id) where es_principal = true;

-- Nombre único entre las bodegas VIVAS del seller. Parcial sobre activa = true
-- para que dar de baja "Bodega Quilicura" y volver a crearla no choque.
create unique index if not exists seller_bodegas_nombre_activa_uk
  on identidad.seller_bodegas (tenant_id, seller_id, nombre) where activa = true;

create index if not exists idx_seller_bodegas_tenant_id
  on identidad.seller_bodegas (tenant_id);

-- Lookup que va a mandar: "las bodegas vivas de este seller" (pantalla de alta,
-- selector de la sesión de retiro, origen de la coordinación del día).
create index if not exists idx_seller_bodegas_tenant_seller
  on identidad.seller_bodegas (tenant_id, seller_id) where activa = true;

drop trigger if exists trg_seller_bodegas_actualizado_en on identidad.seller_bodegas;
create trigger trg_seller_bodegas_actualizado_en
  before update on identidad.seller_bodegas
  for each row execute function identidad.set_actualizado_en();

create or replace view public.seller_bodegas
  with (security_invoker = true)
  as select * from identidad.seller_bodegas;

comment on view public.seller_bodegas is
  'Espejo de identidad.seller_bodegas para PostgREST. RLS heredada de la tabla
   base (security_invoker = true): P1 tenant + P2 seller. El seller ve SOLO sus
   bodegas; el conductor, ninguna. Sin DELETE (revocado): la baja es activa = false.';

alter table identidad.seller_bodegas enable row level security;
alter table identidad.seller_bodegas force row level security;

-- SELECT: P1 (tenant) + P2 (el seller ve las suyas).
--
-- OJO — LA FORMA ENUMERADA NO ES ESTILO, ES LA CORRECCIÓN DE UN BUG QUE ESTE
-- REPO YA COMETIÓ DOS VECES (20260101000002:132-140 y 20260101000004:236-241):
-- escribir esto como `claim_tipo_usuario() <> 'seller' or seller_id = ...`
-- deja pasar al CONDUCTOR, cuyo tipo_usuario tampoco es 'seller'. Eso le
-- entregaría a cada conductor el domicilio, el contacto y el teléfono de TODAS
-- las bodegas de TODOS los sellers del courier. Se enumeran los dos casos
-- permitidos y cualquier otro tipo_usuario queda fuera por construcción.
drop policy if exists seller_bodegas_select on identidad.seller_bodegas;
create policy seller_bodegas_select
  on identidad.seller_bodegas
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or (
        identidad.claim_tipo_usuario() = 'seller'
        and seller_id = identidad.claim_seller_id()
      )
    )
  );

-- Escritura: SOLO interno. Las bodegas las carga el courier — es él quien
-- coordina el retiro y quien manda un conductor a la dirección. Que el seller
-- pudiera editarlas significaría que puede mover el punto de retiro sin que el
-- courier se entere, el día en que hay 130 bultos que buscar.
drop policy if exists seller_bodegas_insert_interno on identidad.seller_bodegas;
create policy seller_bodegas_insert_interno
  on identidad.seller_bodegas
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists seller_bodegas_update_interno on identidad.seller_bodegas;
create policy seller_bodegas_update_interno
  on identidad.seller_bodegas
  for update
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  )
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

-- Sin política de DELETE, y además el privilegio revocado más abajo.

-- Guard de defensa en profundidad, cubriendo LAS TRES escrituras. El motivo de
-- que no baste `before update` está escrito en 20260613000006:14-26: en INSERT,
-- una WITH CHECK incumplida SÍ lanza 42501 por sí sola, pero en UPDATE/DELETE
-- un USING que no matchea solo reduce el conjunto a cero filas, SIN error. Aquí
-- eso importa de verdad: el seller SÍ ve sus propias bodegas (P2), así que su
-- UPDATE no cae en "no existe la fila" — cae en "UPDATE 0" silencioso, y la
-- interfaz le diría "guardado" sin haber guardado nada. El disparador por
-- sentencia convierte ese silencio en un 42501 explícito y auditable.
drop trigger if exists trg_seller_bodegas_solo_interno_edita on identidad.seller_bodegas;
create trigger trg_seller_bodegas_solo_interno_edita
  before insert or update or delete on identidad.seller_bodegas
  for each statement execute function identidad.solo_interno_edita();

-- =============================================================================
-- 2. identidad.courier_bodegas — de dónde se sale a repartir (etapa 2b)
-- =============================================================================
-- El punto de consolidación del cross-dock y el ORIGEN de toda ruta. "Puede
-- haber más de una si el courier crece", de ahí que sea tabla y no columnas en
-- `identidad.tenants`. Sin coordenada resuelta, la etapa 7 no tiene desde dónde
-- arrancar la secuencia aunque el motor de ruteo sea perfecto.
--
-- NO lleva seller_id: no pertenece a ningún seller. Es infraestructura del
-- courier, y por eso su RLS es P1 estricta sin P2.
create table if not exists identidad.courier_bodegas (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references identidad.tenants (id) on delete cascade,

  nombre               text not null,
  direccion            text not null,
  comuna               text not null,

  instrucciones_acceso text,

  es_principal         boolean not null default false,
  activa               boolean not null default true,

  lat                  double precision,
  long                 double precision,
  geo_estado           text not null default 'pendiente',
  geo_confianza        numeric(4,3),
  geocodificado_en     timestamptz,

  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now(),

  -- Mismo motivo que en seller_bodegas: la parada de origen de la ruta (etapa 7)
  -- va a referenciar (tenant_id, bodega_id). Crearla ahora evita re-migrar.
  constraint courier_bodegas_tenant_id_id_uk unique (tenant_id, id),

  -- Nombre único por tenant (aquí NO es parcial por `activa`: son pocas filas y
  -- el nombre del galpón principal es un identificador estable que conviene no
  -- reciclar — a diferencia de las bodegas de sellers, que rotan).
  constraint courier_bodegas_tenant_nombre_uk unique (tenant_id, nombre),

  constraint courier_bodegas_geo_estado_valido check (
    geo_estado in ('pendiente', 'resuelto', 'no_resuelto', 'fuera_cobertura')
  ),

  constraint courier_bodegas_geo_confianza_rango check (
    geo_confianza is null or (geo_confianza >= 0 and geo_confianza <= 1)
  ),

  constraint courier_bodegas_principal_debe_estar_activa check (
    not es_principal or activa
  )
);

comment on table identidad.courier_bodegas is
  'Bodegas del courier: el punto de consolidación del cross-dock y el ORIGEN de
   toda ruta (etapa 7). NO es la bodega del seller — son dos lugares distintos
   del mismo día operativo, y por eso son dos tablas. Interna: RLS P1 estricta,
   solo roles internos. El seller ve 0 filas (desde qué galpón opera su proveedor
   no es información suya) y el conductor también 0 por esta vía — la app le
   entrega su punto de partida por endpoint Bearer con DTO mínimo, no ampliando
   esta política. Sin DELETE para sesiones de usuario: la baja es activa = false.';

comment on column identidad.courier_bodegas.es_principal is
  'Bodega desde la que sale la flota por defecto. Índice parcial: COMO MÁXIMO
   una principal por tenant, no "exactamente una" (un courier recién dado de
   alta todavía no cargó ninguna).';

comment on column identidad.courier_bodegas.activa is
  'false = bodega dada de baja. Sustituye al DELETE (revocado): borrarla dejaría
   sin origen legible a las rutas ya ejecutadas.';

comment on column identidad.courier_bodegas.geo_estado is
  'Estado de la geocodificación. text + CHECK (no enum) por el mismo motivo que
   en seller_bodegas: es el contrato del puerto de integraciones. Mientras no
   esté resuelto, esta bodega no puede ser el punto de partida de una ruta.';

-- Como máximo UNA principal por tenant.
create unique index if not exists courier_bodegas_principal_uk
  on identidad.courier_bodegas (tenant_id) where es_principal = true;

create index if not exists idx_courier_bodegas_tenant_id
  on identidad.courier_bodegas (tenant_id);

drop trigger if exists trg_courier_bodegas_actualizado_en on identidad.courier_bodegas;
create trigger trg_courier_bodegas_actualizado_en
  before update on identidad.courier_bodegas
  for each row execute function identidad.set_actualizado_en();

create or replace view public.courier_bodegas
  with (security_invoker = true)
  as select * from identidad.courier_bodegas;

comment on view public.courier_bodegas is
  'Espejo de identidad.courier_bodegas para PostgREST. RLS solo-interno (P1)
   heredada de la tabla base (security_invoker = true). Seller y conductor:
   0 filas. Sin DELETE (revocado): la baja es activa = false.';

alter table identidad.courier_bodegas enable row level security;
alter table identidad.courier_bodegas force row level security;

-- P1 estricta, sin P2 ni P3. Mismo criterio que identidad.zonas
-- (20260613000004:90-122): configuración interna del courier.
drop policy if exists courier_bodegas_select_interno on identidad.courier_bodegas;
create policy courier_bodegas_select_interno
  on identidad.courier_bodegas
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists courier_bodegas_insert_interno on identidad.courier_bodegas;
create policy courier_bodegas_insert_interno
  on identidad.courier_bodegas
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists courier_bodegas_update_interno on identidad.courier_bodegas;
create policy courier_bodegas_update_interno
  on identidad.courier_bodegas
  for update
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  )
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

-- Sin política de DELETE, y el privilegio revocado más abajo.

-- Mismo guard, cubriendo las tres escrituras (20260613000006:14-26).
drop trigger if exists trg_courier_bodegas_solo_interno_edita on identidad.courier_bodegas;
create trigger trg_courier_bodegas_solo_interno_edita
  before insert or update or delete on identidad.courier_bodegas
  for each statement execute function identidad.solo_interno_edita();

-- =============================================================================
-- 3. Grants de API
-- =============================================================================
-- Privilegios DIRECTOS sobre las tablas base en `identidad`: las vistas de
-- `public` son security_invoker = true, así que PostgREST evalúa el acceso con
-- los privilegios del rol que consulta y necesita el grant en ambos lugares.
-- Patrón de 20260613000004 §7.
grant select, insert, update on identidad.seller_bodegas  to authenticated;
grant select, insert, update on identidad.courier_bodegas to authenticated;

grant select, insert, update on public.seller_bodegas  to authenticated;
grant select, insert, update on public.courier_bodegas to authenticated;

-- REVOKE DELETE — la baja de una bodega es LÓGICA (activa = false), nunca
-- física: borrar la fila dejaría huérfano el histórico de retiros (etapa 3) y
-- el origen de las rutas ya ejecutadas (etapa 7). Sin el revoke, un DELETE de
-- un seller quedaría frenado solo por la ausencia de política de DELETE, es
-- decir "cero filas" en silencio — el modo de falla que este proyecto no acepta.
-- Con el revoke, es 42501 explícito.
--
-- Y hay un motivo de fondo que se midió en el catálogo, no se supuso: en
-- `public` conviven DOS juegos de default privileges para tablas/vistas
-- (pg_default_acl). El de `postgres` —el rol con el que corren estas
-- migraciones— otorga a anon/authenticated solo `Dxtm` (truncate, references,
-- trigger, maintain), sin DML. Pero el de `supabase_admin` otorga `arwdDxtm`,
-- que SÍ incluye DELETE. O sea: qué privilegios nace teniendo la vista depende
-- de QUÉ ROL la creó. Este revoke es lo que hace que el resultado no dependa de
-- ese detalle, hoy ni cuando alguien aplique el esquema por otra vía. La
-- aserción del §4 lo comprueba en cada corrida.
-- Molde: bitacora_auditoria (20260101000004:366-367,382).
revoke delete on identidad.seller_bodegas  from authenticated, anon, public;
revoke delete on identidad.courier_bodegas from authenticated, anon, public;
revoke delete on public.seller_bodegas     from authenticated, anon, public;
revoke delete on public.courier_bodegas    from authenticated, anon, public;

-- `anon` no tiene nada que hacer en estas tablas: no hay política que lo
-- alcance (todas son `to authenticated`), pero se le retiran también los
-- privilegios de escritura que las default privileges de Supabase le regalan.
revoke insert, update on identidad.seller_bodegas  from anon;
revoke insert, update on identidad.courier_bodegas from anon;
revoke insert, update on public.seller_bodegas     from anon;
revoke insert, update on public.courier_bodegas    from anon;

-- service_role (jobs de geocoding, backfill, offboarding de un tenant) sí
-- conserva DELETE: BYPASSRLS salta las políticas pero NO reemplaza el GRANT SQL.
-- La regla "la baja es lógica" gobierna a las sesiones de usuario; el proceso de
-- servidor necesita poder borrar de verdad cuando se da de baja un courier.
grant select, insert, update, delete on identidad.seller_bodegas  to service_role;
grant select, insert, update, delete on identidad.courier_bodegas to service_role;
grant select, insert, update, delete on public.seller_bodegas     to service_role;
grant select, insert, update, delete on public.courier_bodegas    to service_role;

-- =============================================================================
-- 4. Aserción defensiva — la migración ABORTA si alguna barrera no quedó puesta
-- =============================================================================
-- No altera nada: inspecciona el catálogo y falla ruidosamente. Mismo patrón que
-- 20260812000002 §8 y 20260812000003 §3. Existe porque las tres piezas de abajo
-- son silenciosas cuando faltan: una tabla sin FORCE RLS se lee normal, un guard
-- ausente devuelve "0 filas" en vez de 42501, y una unique faltante solo se nota
-- dos etapas después, cuando ya hay que re-migrar.
do $$
declare
  tabla   text;
  guard   text;
  tgtipo  smallint;
begin
  foreach tabla in array array['seller_bodegas', 'courier_bodegas']
  loop
    guard := 'trg_' || tabla || '_solo_interno_edita';

    -- 4.1 RLS activa Y FORZADA. `force` es la que cubre también al dueño de la
    --     tabla: sin ella, cualquier conexión que use el rol propietario lee
    --     todos los tenants y el aislamiento es papel mojado.
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'identidad' and c.relname = tabla
        and c.relrowsecurity and c.relforcerowsecurity
    ) then
      raise exception
        'identidad.% no quedó con RLS enable + force. Sin RLS forzada no hay aislamiento entre couriers en esta tabla.', tabla;
    end if;

    -- 4.2 El guard existe.
    select t.tgtype into tgtipo
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'identidad' and c.relname = tabla
       and t.tgname = guard
       and not t.tgisinternal;

    if tgtipo is null then
      raise exception
        'Falta el trigger % en identidad.%: es el guard que convierte el "0 filas" silencioso de un seller/conductor en un 42501 explícito.', guard, tabla;
    end if;

    -- 4.3 …y cubre LAS TRES escrituras, por sentencia y BEFORE. Es la lección
    --     literal de 20260613000006:14-26: un guard solo-UPDATE deja UPDATE y
    --     DELETE del no-interno cayendo en cero filas sin error. Bits de
    --     pg_trigger.tgtype: 1=ROW, 2=BEFORE, 4=INSERT, 8=DELETE, 16=UPDATE.
    if (tgtipo & 28) <> 28 then
      raise exception
        'El guard % de identidad.% no cubre INSERT+UPDATE+DELETE (tgtype=%). Un guard parcial deja escrituras cayendo en "0 filas" sin lanzar 42501.', guard, tabla, tgtipo;
    end if;
    if (tgtipo & 1) <> 0 or (tgtipo & 2) <> 2 then
      raise exception
        'El guard % de identidad.% no es BEFORE ... FOR EACH STATEMENT (tgtype=%). Por fila no se dispara cuando RLS ya filtró a cero, que es justo el caso que hay que atrapar.', guard, tabla, tgtipo;
    end if;

    -- 4.4 La unique (tenant_id, id): es la que habilita las FK compuestas de
    --     las etapas 3 (sesión de retiro) y 7 (parada de origen de la ruta).
    --     Se comprueba por COLUMNAS, no por nombre: lo que importa es que la
    --     garantía exista, no cómo se llame. El precedente de por qué se exige
    --     ahora es sellers_tenant_id_id_uk, que no existía y hubo que agregarla
    --     después con un DO-block (20260101000004:41-52).
    if not exists (
      select 1
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'identidad' and c.relname = tabla
         and con.contype = 'u'
         and (
           select array_agg(a.attname::text order by a.attname)
             from unnest(con.conkey) as k(attnum)
             join pg_attribute a
               on a.attrelid = con.conrelid and a.attnum = k.attnum
         ) = array['id', 'tenant_id']
    ) then
      raise exception
        'Falta unique (tenant_id, id) en identidad.%. Sin ella, las etapas 3 y 7 no pueden declarar su FK compuesta y hay que re-migrar esta tabla.', tabla;
    end if;

    -- 4.5 DELETE efectivamente revocado para el rol de cliente, en tabla base Y
    --     vista. Lo que nace teniendo la vista depende del rol que la crea (ver
    --     §3: el default ACL de supabase_admin sí incluye DELETE); si el revoke
    --     no tomó, la baja física queda abierta y nadie lo nota hasta que falte
    --     una fila del histórico de retiros.
    if has_table_privilege('authenticated', 'identidad.' || tabla, 'DELETE') then
      raise exception
        'authenticated conserva DELETE sobre identidad.%. La baja de una bodega es lógica (activa = false): borrarla deja huérfano el histórico de retiros y rutas.', tabla;
    end if;
    if has_table_privilege('authenticated', 'public.' || tabla, 'DELETE') then
      raise exception
        'authenticated conserva DELETE sobre public.% (la vista). Supabase otorga ALL por default privileges en el schema public: el revoke de esta migración no tomó efecto.', tabla;
    end if;

    -- 4.6 La vista espejo debe ser security_invoker. Sin esa opción la evalúa su
    --     dueño (postgres, que es BYPASSRLS) y la vista se vuelve un agujero que
    --     expone TODOS los tenants por PostgREST.
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = tabla and c.relkind = 'v'
        and c.reloptions @> array['security_invoker=true']
    ) then
      raise exception
        'La vista public.% no tiene security_invoker = true. Sin ella la RLS se evalúa como el dueño de la vista y expone todos los tenants.', tabla;
    end if;
  end loop;
end $$;

-- =============================================================================
-- 5. Handoff (NO se implementa aquí — solo se documenta)
--
--    `integraciones` / `backend` (geocoding)
--      · Ambas tablas nacen con geo_estado = 'pendiente' y lat/long NULL. Hace
--        falta enganchar el puerto de geocoding existente para resolverlas; sin
--        coordenada, ni el retiro tiene punto en el mapa ni la ruta tiene origen.
--      · Ojo con el límite de concurrencia: el job de geocoding hoy no declara
--        uno (pendiente de la etapa 1). Son pocas filas, pero el patrón importa.
--
--    `frontend` (etapas 2 y 2b)
--      · "La primera bodega que se crea nace principal" es regla de la Server
--        Action, NO de la base: el índice parcial garantiza como máximo una, no
--        exactamente una. Marcar otra como principal exige desmarcar la anterior
--        en la MISMA transacción, o el índice rechaza el segundo INSERT/UPDATE
--        con 23505.
--      · La baja es `activa = false`. El DELETE está revocado a nivel de
--        privilegio: un intento devuelve 42501, no "0 filas".
--
--    `backend` (etapas 3 y 7)
--      · Las FK compuestas ya tienen a qué agarrarse: (tenant_id, bodega_id)
--        contra seller_bodegas_tenant_id_id_uk / courier_bodegas_tenant_id_id_uk.
--      · El conductor NO debe ganar acceso a estas tablas ampliando la política.
--        Su punto de retiro y su origen de ruta viajan por endpoint Bearer con
--        service_role y DTO mínimo — mismo criterio que 20260812000002 §5.
-- =============================================================================
