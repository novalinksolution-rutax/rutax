-- =============================================================================
-- 20260916000001 · Identidad — Alta de seller por autoservicio (multi-courier)
-- =============================================================================
-- Rediseña el alta de SELLERS: en vez de que el courier teclee la ficha e invite
-- por correo, el seller entra por un ENLACE PERMANENTE del courier, se identifica
-- con su Google (o el login que ya exista) y queda ACTIVO al instante. Y una MISMA
-- identidad (un mismo `auth.users`) puede pertenecer a VARIOS couriers a la vez,
-- eligiendo con cuál opera desde un selector estilo el del conductor (F4).
--
-- =============================================================================
-- LA RESTRICCIÓN RAÍZ QUE ESTA MIGRACIÓN NO TOCA
-- =============================================================================
-- `identidad.usuarios_perfil` SIGUE siendo 1:1 con `auth.users` y con UN solo
-- `tenant_id`/`seller_id`: los de la membresía ACTIVA. El `custom_access_token_hook`
-- (20260101000001 §6) inyecta ESE tenant_id al JWT y TODA la RLS de tres capas
-- depende de que sea uno solo. El multi-courier NO se resuelve volviendo
-- `usuarios_perfil` 1:N —eso rompería el hook y la RLS entera— sino con tablas de
-- MEMBRESÍA aparte (esta migración) + un switcher (backend) que reescribe la fila
-- activa de `usuarios_perfil` al conmutar de courier. Esta migración solo crea el
-- ESQUEMA; el switcher, la landing pública y las Server Actions los hace `backend`.
--
-- =============================================================================
-- LAS CUATRO TABLAS Y SU POSTURA DE AISLAMIENTO (lo que hay que entender antes)
-- =============================================================================
--   1. identidad.seller_identidades      — DENY-ALL. La empresa del propio seller,
--        COMPARTIDA entre couriers. Dato personal cross-tenant: si un courier
--        pudiera leerla, sabría que ese correo también opera con la competencia.
--        Solo service_role la lee/escribe; el seller la ve por Server Action.
--   2. identidad.seller_membresias       — DENY-ALL A COURIERS, self-read del
--        seller. Enumera las N membresías de una identidad. Un courier NO puede
--        listarlas (revelaría con qué otros couriers trabaja el seller); el propio
--        seller SÍ lee las suyas, para alimentar el selector. Escritura service_role.
--   3. identidad.enlaces_registro_seller — DENY-ALL. El enlace permanente por
--        courier. La landing pública resuelve token→tenant por service_role y solo
--        expone `nombre_fantasia`. Un enlace vivo por courier (unique parcial).
--   4. identidad.seller_fuentes_declaradas — RLS NORMAL, tenant-scoped. Qué fuentes
--        declaró el seller y su estado de conexión. El seller ve las suyas, el
--        courier las de su tenant. `tenant_id` NOT NULL. Aquí SÍ hay frontera.
--
-- DECISIONES DE PRODUCTO YA CERRADAS (usuario):
--   · Una identidad Google = N membresías. Selector estilo conductor F4.
--   · Una cuenta por empresa por courier: se mantiene `unique (tenant_id, rut)` en
--     identidad.sellers (20260101000002) — esta migración NO lo toca.
--   · SIN controles de abuso automáticos (nada de rate-limit ni tope por enlace).
--   · El seller nace ACTIVO (no `invitado`, no aprobación).
--
-- IDEMPOTENTE: DO-block para cada `create type`, `create table if not exists`,
-- `create index if not exists`, `create or replace function/view`, `drop policy
-- if exists` + create, `drop trigger if exists` + create. REVOKE/GRANT son
-- declarativos. Re-aplicable sobre una base ya migrada.
--
-- Prueba de aislamiento (obligatoria, invariante del proyecto):
--   supabase/tests/database/rls_aislamiento_alta_seller_autoservicio.test.sql
-- =============================================================================


-- =============================================================================
-- 0. Enums nuevos
-- =============================================================================
-- CREATE TYPE + usar el tipo en la MISMA transacción está permitido (precedente
-- literal: 20260816000005 crea estado_salud_conexion_shopify y lo usa como
-- default en el mismo archivo). Lo prohibido es `alter type ... add value` + uso
-- en la misma transacción (55P04) — aquí no se hace ningún add value.
do $$
begin
  -- Estado de la MEMBRESÍA identidad↔courier. Nace 'activa' (el seller no espera
  -- aprobación); 'bloqueada' es la palanca con la que el courier corta el acceso
  -- de un seller sin borrar la membresía (trazabilidad).
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'estado_membresia_seller' and n.nspname = 'identidad'
  ) then
    create type identidad.estado_membresia_seller as enum ('activa', 'bloqueada');
  end if;

  -- ESPEJO de operacion.fuente_pedido (ml_flex | rutax_manual | shopify), NO una
  -- referencia a ese tipo. Se duplica A PROPÓSITO, por el mismo criterio con el
  -- que 20260816000005 creó estado_salud_conexion_shopify en vez de reusar el de
  -- ML: `operacion` DEPENDE de `identidad`, nunca al revés. Declarar aquí una
  -- columna con el tipo `operacion.fuente_pedido` invertiría esa dependencia y
  -- ataría el esquema base al de operación. Los tres valores coinciden con
  -- operacion.fuente_pedido a propósito; si allá se agrega una fuente, aquí se
  -- agrega el mismo valor en su propia migración (el espejo se mantiene a mano,
  -- igual que el par podEsAutoritativoEnRutax/trg_pruebas_entrega_solo_same_day).
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'fuente_declarada' and n.nspname = 'identidad'
  ) then
    create type identidad.fuente_declarada as enum ('ml_flex', 'rutax_manual', 'shopify');
  end if;

  -- Estado de conexión de una fuente declarada. 'pendiente' = el seller la declaró
  -- pero todavía no hay conexión viva; 'conectada' = existe conexión activa (o no
  -- necesita token, como same-day); 'desvinculada' = estuvo conectada y se cayó
  -- (token vencido/revocado, app desinstalada). Es el semáforo de "qué falta
  -- conectar", NO la salud fina de la conexión (esa vive en conexiones_seller_ml /
  -- conexiones_seller_shopify).
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'estado_fuente_declarada' and n.nspname = 'identidad'
  ) then
    create type identidad.estado_fuente_declarada as enum ('pendiente', 'conectada', 'desvinculada');
  end if;
end $$;

comment on type identidad.estado_membresia_seller is
  'Estado del vínculo seller_membresias (identidad↔courier). activa = opera
   normalmente (nace así, sin aprobación); bloqueada = el courier cortó el acceso
   sin borrar la membresía. Ampliar la lista exige migración: usar CHECK repuesto
   no aplica (es enum nativo).';

comment on type identidad.fuente_declarada is
  'ESPEJO de operacion.fuente_pedido para seller_fuentes_declaradas. Se duplica en
   `identidad` en vez de referenciar operacion.fuente_pedido porque operacion
   depende de identidad y no al revés. Mantener sincronizado a mano si allá se
   agrega una fuente.';

comment on type identidad.estado_fuente_declarada is
  'Semáforo de "qué falta conectar" de una fuente declarada por el seller.
   pendiente = declarada, sin conexión viva; conectada = hay conexión activa o no
   necesita token (same-day); desvinculada = estuvo conectada y se cayó. NO es la
   salud fina de la conexión (esa vive en conexiones_seller_ml/_shopify).';


-- =============================================================================
-- 1. identidad.seller_identidades — la empresa del seller, COMPARTIDA (DENY-ALL)
-- =============================================================================
-- PK = auth_user_id: es 1:1 con la identidad de Auth, no con una membresía. Los
-- datos de la empresa (razón social, RUT, contacto) son del SELLER, no del
-- courier, y por eso viven una sola vez y se comparten entre las N membresías.
--
-- DENY-ALL porque es dato personal CROSS-TENANT: si el courier A pudiera leer
-- esta tabla, al buscar por RUT sabría que ese seller también trabaja con el
-- courier B. El propio seller la lee/escribe SIEMPRE por service_role en una
-- Server Action (no por RLS de cliente); authenticated no tiene ni grant ni
-- vista espejo. Es el mismo trato que secretos_cifrados: estructuralmente
-- inalcanzable para el cliente.
create table if not exists identidad.seller_identidades (
  auth_user_id            uuid primary key references auth.users (id) on delete cascade,

  razon_social            text not null,
  -- Mismo formato/constraint que identidad.sellers.rut (20260101000002:45).
  rut                     text not null,
  nombre_contacto         text,
  -- E.164 SIN «+», mismo CHECK que conductores/usuarios_perfil/whatsapp_contactos
  -- (la forma que quiere la Cloud API). Nullable.
  telefono                text,

  -- Consentimiento Ley 21.719 (protección de datos personales). Se deja la
  -- estructura lista aunque el TEXTO del consentimiento lo defina copywriter:
  -- marca temporal de cuándo consintió + versión del texto aceptado (para poder
  -- re-pedir consentimiento si el texto cambia). Nullable: una identidad puede
  -- existir antes de registrar el consentimiento; el flujo de alta lo puebla.
  consentimiento_datos_en timestamptz,
  consentimiento_version  text,

  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),

  constraint seller_identidades_rut_formato check (rut ~ '^[0-9]{1,8}-[0-9kK]$'),
  constraint seller_identidades_telefono_e164 check (
    telefono is null or telefono ~ '^[1-9][0-9]{7,14}$'
  ),
  -- Si hay versión de consentimiento, hay fecha, y viceversa: los dos campos van
  -- juntos o ninguno. Evita "consintió la versión X en fecha desconocida".
  constraint seller_identidades_consentimiento_par check (
    (consentimiento_datos_en is null) = (consentimiento_version is null)
  )
);

comment on table identidad.seller_identidades is
  'Empresa del propio seller (razón social, RUT, contacto), COMPARTIDA entre los N
   couriers con los que trabaja. PK = auth_user_id (1:1 con auth.users), no por
   membresía. DENY-ALL: dato personal cross-tenant — si un courier la leyera,
   sabría con qué otros couriers opera el seller. RLS forzada sin políticas, grant
   solo service_role, sin vista espejo en public. El seller la ve por Server Action
   (service_role), nunca por RLS de cliente.';

comment on column identidad.seller_identidades.rut is
  'RUT de la empresa del seller (NNNNNNNN-DV). Mismo formato que identidad.sellers.rut.
   NO es unique aquí: la unicidad "una cuenta por empresa por courier" la impone
   sellers.sellers_tenant_rut_uk, no esta tabla (una misma empresa/RUT es la MISMA
   identidad en todos sus couriers).';

comment on column identidad.seller_identidades.consentimiento_version is
  'Versión del texto de consentimiento Ley 21.719 que el seller aceptó. El texto lo
   define copywriter; aquí solo se versiona para poder re-pedirlo si cambia. Va en
   par con consentimiento_datos_en (CHECK).';

drop trigger if exists trg_seller_identidades_actualizado_en on identidad.seller_identidades;
create trigger trg_seller_identidades_actualizado_en
  before update on identidad.seller_identidades
  for each row execute function identidad.set_actualizado_en();


-- =============================================================================
-- 2. identidad.seller_membresias — el vínculo identidad↔courier (DENY-ALL A COURIERS)
-- =============================================================================
-- LA tabla que enumera las N membresías de una identidad. Una fila = "este correo
-- es seller de este courier, encarnado en esta fila de identidad.sellers".
--
-- AISLAMIENTO ASIMÉTRICO, y es su razón de ser:
--   · El propio SELLER lee las SUYAS (auth_user_id = auth.uid()) — así el selector
--     sabe entre qué couriers elegir. Lee a través de TODOS sus couriers a la vez;
--     es el único punto del sistema donde una consulta de cliente cruza tenants, y
--     es correcto porque el filtro es "mi propia identidad", no "mi tenant".
--   · El COURIER no puede enumerarlas: no hay política que lo habilite por
--     tenant_id. Un interno que consulte esta tabla solo vería filas con
--     auth_user_id = su propio uid (típicamente ninguna, no es seller). Así un
--     courier NUNCA obtiene "todas las identidades que son sellers míos" desde
--     aquí — para su cartera usa identidad.sellers, que sí es tenant-scoped y no
--     revela nada de otros couriers.
--   · Escritura: solo service_role (el alta por enlace, el switcher, el bloqueo).
create table if not exists identidad.seller_membresias (
  id             uuid primary key default gen_random_uuid(),

  auth_user_id   uuid not null references auth.users (id) on delete cascade,
  tenant_id      uuid not null references identidad.tenants (id) on delete cascade,
  seller_id      uuid not null,

  estado         identidad.estado_membresia_seller not null default 'activa',

  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  -- Una identidad tiene UNA membresía por courier (la encarnación en un seller de
  -- ese courier es única). Reconectar/reactivar es UPDATE de esta fila, no otra.
  constraint seller_membresias_auth_tenant_uk unique (auth_user_id, tenant_id),

  -- El seller referenciado debe pertenecer al MISMO tenant de la membresía. La FK
  -- compuesta lo garantiza y a la vez cubre la existencia del seller (sellers_
  -- tenant_id_id_uk existe desde 20260101000004). No hace falta una FK simple
  -- extra a sellers(id): esta ya la implica.
  constraint seller_membresias_seller_pertenece_al_tenant
    foreign key (tenant_id, seller_id)
    references identidad.sellers (tenant_id, id) on delete cascade
);

comment on table identidad.seller_membresias is
  'Vínculo identidad↔courier: enumera las N membresías de una identidad Auth
   (multi-courier). DENY-ALL A COURIERS (no pueden listar membresías cruzadas —
   revelaría con qué otros couriers trabaja el seller), pero el propio seller SÍ
   lee las suyas (auth_user_id = auth.uid()) para alimentar el selector estilo
   conductor F4. Escritura solo service_role. NO reemplaza a usuarios_perfil, que
   sigue 1:1 y guarda la membresía ACTIVA; el switcher reescribe esa fila.';

comment on column identidad.seller_membresias.seller_id is
  'La fila de identidad.sellers de ESTE courier que encarna a esta identidad. Una
   identidad tiene un seller distinto por cada courier. FK compuesta con tenant_id
   → sellers(tenant_id, id): garantiza que el seller es de este mismo tenant.';

create index if not exists seller_membresias_auth_user_id_idx
  on identidad.seller_membresias (auth_user_id);
create index if not exists seller_membresias_tenant_seller_idx
  on identidad.seller_membresias (tenant_id, seller_id);

drop trigger if exists trg_seller_membresias_actualizado_en on identidad.seller_membresias;
create trigger trg_seller_membresias_actualizado_en
  before update on identidad.seller_membresias
  for each row execute function identidad.set_actualizado_en();

-- Vista espejo: security_invoker, para que la RLS se evalúe con los claims del
-- rol que consulta (el seller). Necesaria porque, a diferencia de las tablas
-- deny-all, aquí el cliente SÍ lee (sus propias filas) por PostgREST.
create or replace view public.seller_membresias
  with (security_invoker = true)
  as select
    id,
    auth_user_id,
    tenant_id,
    seller_id,
    estado,
    creado_en,
    actualizado_en
  from identidad.seller_membresias;

comment on view public.seller_membresias is
  'Espejo de identidad.seller_membresias para PostgREST. RLS heredada
   (security_invoker = true): el seller ve SOLO auth_user_id = auth.uid(); el
   courier no ve membresías cruzadas. Escritura solo service_role.';


-- =============================================================================
-- 3. identidad.enlaces_registro_seller — el enlace permanente por courier (DENY-ALL)
-- =============================================================================
-- Un courier tiene UN enlace vivo (unique parcial where activo). Regenerar = bajar
-- el vigente (activo=false, revocado_en=now()) e insertar otro: baja LÓGICA,
-- trazable, sin borrar el histórico de tokens que alguna vez circularon.
--
-- DENY-ALL: la landing es PÚBLICA (un seller sin sesión abre el enlace), así que
-- la resolución token→tenant NO puede pasar por RLS de cliente — la hace una
-- Server Action con service_role que expone SOLO `nombre_fantasia` del courier, ni
-- el token de otros ni la lista de enlaces. Sin grant a authenticated/anon, sin
-- vista espejo. El panel del courier gestiona SUS enlaces también por service_role
-- (backend), acotando por su propio tenant_id de sesión.
create table if not exists identidad.enlaces_registro_seller (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references identidad.tenants (id) on delete cascade,

  -- Token opaco que viaja en la URL pública /registro-seller/<token>. Único
  -- global. Lo genera backend (gen_random_uuid / bytes aleatorios); aquí solo se
  -- guarda y se exige unicidad.
  token       text not null,

  activo      boolean not null default true,

  -- Autor del alta del enlace (RNF-04: el "quién"). uuid de auth.users del interno
  -- que lo generó. Sin FK dura para no atar el enlace al ciclo de vida del usuario
  -- (si el interno se da de baja, el enlace y su trazabilidad siguen).
  creado_por  uuid,
  creado_en   timestamptz not null default now(),
  revocado_en timestamptz,

  constraint enlaces_registro_seller_token_no_vacio check (btrim(token) <> ''),
  -- Coherencia de la baja lógica: si está activo no tiene fecha de revocación, y
  -- si está inactivo la tiene. Evita "activo con revocado_en" y "inactivo sin saber cuándo".
  constraint enlaces_registro_seller_revocado_coherente check (
    (activo and revocado_en is null) or (not activo and revocado_en is not null)
  )
);

comment on table identidad.enlaces_registro_seller is
  'Enlace permanente de auto-registro de sellers, uno vivo por courier (unique
   parcial where activo). Regenerar = baja lógica del vigente + inserción de otro
   (trazable). DENY-ALL: la landing pública resuelve token→tenant por service_role
   exponiendo SOLO nombre_fantasia; sin grant a authenticated/anon ni vista espejo.
   SIN control de abuso automático (decisión del usuario): no hay tope por enlace
   ni rate-limit — eso queda para después.';

comment on column identidad.enlaces_registro_seller.token is
  'Token opaco en la URL pública. Es credencial-símil: da acceso a la landing de
   registro de un courier. NUNCA en logs. Se resuelve por service_role; la landing
   solo devuelve el nombre_fantasia del courier, no el token ni otros enlaces.';

-- UN enlace vivo por courier. Parcial where activo: los enlaces revocados conviven
-- sin chocar (histórico). Es el corazón de "regenerar = bajar + insertar".
create unique index if not exists enlaces_registro_seller_un_vivo_por_tenant_uk
  on identidad.enlaces_registro_seller (tenant_id)
  where activo;

-- Lookup público token→tenant (el que más va a pegar): unicidad global del token.
create unique index if not exists enlaces_registro_seller_token_uk
  on identidad.enlaces_registro_seller (token);


-- =============================================================================
-- 4. identidad.seller_fuentes_declaradas — qué fuentes declaró el seller (RLS NORMAL)
-- =============================================================================
-- La ÚNICA de las cuatro que es tenant-scoped con frontera real: dice qué fuentes
-- (ML/Flex, Shopify, same-day) declaró un seller en un courier y su estado de
-- conexión, para que el courier y el seller vean "qué falta conectar". La conexión
-- REAL (el token) vive en conexiones_seller_ml / conexiones_seller_shopify; esto es
-- el semáforo, no la credencial. same-day nace 'conectada' (no necesita token).
--
-- RLS de tres capas, molde de identidad.sellers: interno ve las de su tenant, el
-- seller ve EXCLUSIVAMENTE las suyas, el conductor cero. tenant_id NOT NULL.
create table if not exists identidad.seller_fuentes_declaradas (
  id             uuid primary key default gen_random_uuid(),

  tenant_id      uuid not null references identidad.tenants (id) on delete cascade,
  seller_id      uuid not null,

  fuente         identidad.fuente_declarada not null,
  estado         identidad.estado_fuente_declarada not null default 'pendiente',

  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  -- Una declaración por fuente por seller (no dos filas "ml_flex" del mismo seller).
  constraint seller_fuentes_declaradas_seller_fuente_uk unique (tenant_id, seller_id, fuente),

  -- El seller es del MISMO tenant (FK compuesta, cubre existencia + pertenencia).
  constraint seller_fuentes_declaradas_seller_pertenece_al_tenant
    foreign key (tenant_id, seller_id)
    references identidad.sellers (tenant_id, id) on delete cascade
);

comment on table identidad.seller_fuentes_declaradas is
  'Fuentes que un seller declaró en un courier y su estado de conexión (semáforo de
   "qué falta conectar"). La conexión real (token) vive en conexiones_seller_ml/_shopify.
   same-day (rutax_manual) nace conectada (no necesita token). RLS tenant-scoped
   (P1 tenant + P2 seller): el seller ve las suyas, el interno las de su tenant, el
   conductor ninguna. Escritura reservada a interno/service_role.';

comment on column identidad.seller_fuentes_declaradas.fuente is
  'Fuente declarada, alineada con operacion.pedidos.fuente vía el enum espejo
   identidad.fuente_declarada. rutax_manual = same-day (nace conectada).';

create index if not exists seller_fuentes_declaradas_tenant_id_idx
  on identidad.seller_fuentes_declaradas (tenant_id);
create index if not exists seller_fuentes_declaradas_tenant_seller_idx
  on identidad.seller_fuentes_declaradas (tenant_id, seller_id);

drop trigger if exists trg_seller_fuentes_declaradas_actualizado_en on identidad.seller_fuentes_declaradas;
create trigger trg_seller_fuentes_declaradas_actualizado_en
  before update on identidad.seller_fuentes_declaradas
  for each row execute function identidad.set_actualizado_en();

-- Trigger de consistencia de tenant: la FK compuesta ya lo impone, pero su 23503
-- no dice cuál de los dos valores está mal. Este falla antes y nombra los dos
-- tenants. Molde: conexiones_seller_shopify_validar_tenant (20260816000005 §4).
create or replace function identidad.seller_fuentes_declaradas_validar_tenant()
returns trigger
language plpgsql
as $$
declare
  tenant_del_seller uuid;
begin
  select tenant_id into tenant_del_seller
  from identidad.sellers
  where id = new.seller_id;

  if tenant_del_seller is null then
    raise exception 'seller_id % no existe', new.seller_id;
  end if;

  if new.tenant_id is distinct from tenant_del_seller then
    raise exception 'tenant_id denormalizado (%) no coincide con el tenant del seller (%)',
      new.tenant_id, tenant_del_seller;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_seller_fuentes_declaradas_validar_tenant on identidad.seller_fuentes_declaradas;
create trigger trg_seller_fuentes_declaradas_validar_tenant
  before insert or update on identidad.seller_fuentes_declaradas
  for each row execute function identidad.seller_fuentes_declaradas_validar_tenant();

create or replace view public.seller_fuentes_declaradas
  with (security_invoker = true)
  as select
    id,
    tenant_id,
    seller_id,
    fuente,
    estado,
    creado_en,
    actualizado_en
  from identidad.seller_fuentes_declaradas;

comment on view public.seller_fuentes_declaradas is
  'Espejo de identidad.seller_fuentes_declaradas para PostgREST. RLS heredada
   (security_invoker = true): P1 tenant + P2 seller. Escritura por interno/service_role.';


-- =============================================================================
-- 5. RLS
-- =============================================================================

-- --- 5.1 seller_identidades — DENY-ALL total (molde: infra.eventos_consumo) ----
alter table identidad.seller_identidades enable row level security;
alter table identidad.seller_identidades force  row level security;
-- SIN políticas. Nadie más que BYPASSRLS (service_role) accede.

-- --- 5.2 seller_membresias — self-read del seller, deny-all a couriers ----------
alter table identidad.seller_membresias enable row level security;
alter table identidad.seller_membresias force  row level security;

-- SELECT: SOLO las filas de mi propia identidad. Deliberadamente NO hay rama por
-- tenant_id: un courier no debe poder enumerar membresías. El filtro es la
-- identidad Auth (auth.uid()), no el claim de tenant — por eso una misma consulta
-- de un seller cruza sus N couriers, que es exactamente lo que el selector necesita.
drop policy if exists seller_membresias_select_propias on identidad.seller_membresias;
create policy seller_membresias_select_propias
  on identidad.seller_membresias
  for select
  to authenticated
  using (auth_user_id = auth.uid());

-- Sin políticas de INSERT/UPDATE/DELETE: la escritura (alta por enlace, switcher,
-- bloqueo) es service_role. authenticated tampoco tendrá el privilegio (§6), así
-- que un intento de escritura da 42501 explícito, no "0 filas" silencioso.

-- --- 5.3 enlaces_registro_seller — DENY-ALL total -------------------------------
alter table identidad.enlaces_registro_seller enable row level security;
alter table identidad.enlaces_registro_seller force  row level security;
-- SIN políticas. La landing pública y el panel del courier operan por service_role.

-- --- 5.4 seller_fuentes_declaradas — P1 tenant + P2 seller ----------------------
alter table identidad.seller_fuentes_declaradas enable row level security;
alter table identidad.seller_fuentes_declaradas force  row level security;

-- SELECT: interno ve su tenant; el seller ve EXCLUSIVAMENTE las suyas; el
-- conductor, cero. LA FORMA ENUMERADA NO ES ESTILO: escribirlo como
-- `tipo_usuario <> 'seller' or seller_id = ...` dejaría pasar al conductor (su
-- tipo tampoco es 'seller'). Se enumeran los dos casos permitidos (bug que el
-- repo ya cometió: 20260101000002:132-140, documentado en 20260813000002:214-220).
drop policy if exists seller_fuentes_declaradas_select on identidad.seller_fuentes_declaradas;
create policy seller_fuentes_declaradas_select
  on identidad.seller_fuentes_declaradas
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

-- INSERT/UPDATE: solo interno (el courier gestiona el semáforo de su tenant). El
-- seller declara sus fuentes durante el alta por service_role, no por esta vía.
drop policy if exists seller_fuentes_declaradas_insert_interno on identidad.seller_fuentes_declaradas;
create policy seller_fuentes_declaradas_insert_interno
  on identidad.seller_fuentes_declaradas
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists seller_fuentes_declaradas_update_interno on identidad.seller_fuentes_declaradas;
create policy seller_fuentes_declaradas_update_interno
  on identidad.seller_fuentes_declaradas
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

-- Guard de defensa en profundidad (reusa identidad.solo_interno_edita de
-- 20260101000002): el seller SÍ ve sus filas (P2), así que un UPDATE suyo caería
-- en "0 filas" silencioso sin este disparador. Con él es 42501 explícito. POR
-- SENTENCIA, cubre las tres escrituras.
drop trigger if exists trg_seller_fuentes_declaradas_solo_interno_edita on identidad.seller_fuentes_declaradas;
create trigger trg_seller_fuentes_declaradas_solo_interno_edita
  before insert or update or delete on identidad.seller_fuentes_declaradas
  for each statement execute function identidad.solo_interno_edita();


-- =============================================================================
-- 6. Grants
-- =============================================================================
-- Se parte revocando TODO lo que las default privileges de Supabase puedan haber
-- regalado (los privilegios se SUMAN; un grant selectivo no quita lo anterior).

-- 6.1 seller_identidades: deny-all — SOLO service_role. Ni USAGE extra hace falta
--     (identidad ya tiene USAGE para authenticated desde 0001, pero sin privilegio
--     de tabla no alcanza nada), ni vista espejo. Estructuralmente inalcanzable.
revoke all on identidad.seller_identidades from authenticated, anon, public;
grant  select, insert, update, delete on identidad.seller_identidades to service_role;

-- 6.2 seller_membresias: el seller lee (por RLS self-only); nadie del cliente
--     escribe. SELECT a authenticated en tabla base (security_invoker lo exige) +
--     vista; escritura solo service_role.
revoke all on identidad.seller_membresias from authenticated, anon, public;
revoke all on public.seller_membresias    from authenticated, anon, public;
grant  select on identidad.seller_membresias to authenticated;
grant  select on public.seller_membresias    to authenticated;
grant  select, insert, update, delete on identidad.seller_membresias to service_role;
grant  select, insert, update, delete on public.seller_membresias    to service_role;

-- 6.3 enlaces_registro_seller: deny-all — SOLO service_role. Sin vista espejo.
revoke all on identidad.enlaces_registro_seller from authenticated, anon, public;
grant  select, insert, update, delete on identidad.enlaces_registro_seller to service_role;

-- 6.4 seller_fuentes_declaradas: RLS normal. El seller lee (P2), el interno
--     lee/escribe (RLS lo filtra por tenant). SELECT/INSERT/UPDATE a authenticated;
--     sin DELETE (baja lógica vía estado si algún día hace falta).
revoke all on identidad.seller_fuentes_declaradas from authenticated, anon, public;
revoke all on public.seller_fuentes_declaradas    from authenticated, anon, public;
grant  select, insert, update on identidad.seller_fuentes_declaradas to authenticated;
grant  select, insert, update on public.seller_fuentes_declaradas    to authenticated;
grant  select, insert, update, delete on identidad.seller_fuentes_declaradas to service_role;
grant  select, insert, update, delete on public.seller_fuentes_declaradas    to service_role;


-- =============================================================================
-- 7. Aserción defensiva — la migración ABORTA si una barrera no quedó puesta
-- =============================================================================
-- No altera nada: inspecciona el catálogo y falla ruidosamente. Todas las piezas
-- de abajo son SILENCIOSAS cuando faltan (una tabla sin FORCE RLS se lee normal,
-- un grant de tabla completa entrega datos personales sin quejarse), así que se
-- MIDEN contra el catálogo, no se suponen. Molde: 20260816000005 §8.
do $$
begin
  -- 7.1 Las cuatro tablas con RLS enable + force.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'identidad'
      and c.relname in ('seller_identidades', 'seller_membresias',
                        'enlaces_registro_seller', 'seller_fuentes_declaradas')
      and not (c.relrowsecurity and c.relforcerowsecurity)
  ) then
    raise exception 'Alguna tabla del alta de seller quedó sin RLS enable + force: sin RLS forzada no hay aislamiento entre couriers.';
  end if;

  -- 7.2 DENY-ALL efectivo: authenticated y anon NO tienen NINGÚN privilegio sobre
  --     las tres tablas deny-all. Es la barrera central de la migración.
  if has_any_column_privilege('authenticated', 'identidad.seller_identidades', 'SELECT')
     or has_any_column_privilege('anon', 'identidad.seller_identidades', 'SELECT')
     or has_table_privilege('authenticated', 'identidad.seller_identidades', 'INSERT')
     or has_table_privilege('authenticated', 'identidad.seller_identidades', 'UPDATE')
     or has_table_privilege('authenticated', 'identidad.seller_identidades', 'DELETE') then
    raise exception 'seller_identidades NO es deny-all: authenticated/anon conservan algún privilegio. Es dato personal cross-tenant; solo service_role.';
  end if;

  if has_any_column_privilege('authenticated', 'identidad.enlaces_registro_seller', 'SELECT')
     or has_any_column_privilege('anon', 'identidad.enlaces_registro_seller', 'SELECT')
     or has_table_privilege('authenticated', 'identidad.enlaces_registro_seller', 'INSERT')
     or has_table_privilege('authenticated', 'identidad.enlaces_registro_seller', 'UPDATE')
     or has_table_privilege('authenticated', 'identidad.enlaces_registro_seller', 'DELETE') then
    raise exception 'enlaces_registro_seller NO es deny-all: la resolución token→tenant debe ir por service_role, no por RLS de cliente.';
  end if;

  -- 7.3 seller_identidades y enlaces_registro_seller NO tienen vista espejo en public.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('seller_identidades', 'enlaces_registro_seller')
      and c.relkind = 'v'
  ) then
    raise exception 'seller_identidades o enlaces_registro_seller tiene vista espejo en public: las tablas deny-all no la llevan.';
  end if;

  -- 7.4 seller_membresias: el cliente puede LEER (self-only por RLS) pero NO escribir.
  if not has_table_privilege('authenticated', 'identidad.seller_membresias', 'SELECT') then
    raise exception 'authenticated perdió SELECT sobre seller_membresias: el seller no podría alimentar su selector de couriers.';
  end if;
  if has_table_privilege('authenticated', 'identidad.seller_membresias', 'INSERT')
     or has_table_privilege('authenticated', 'identidad.seller_membresias', 'UPDATE')
     or has_table_privilege('authenticated', 'identidad.seller_membresias', 'DELETE') then
    raise exception 'authenticated puede ESCRIBIR seller_membresias: el alta/switcher/bloqueo son service_role. Un seller podría auto-agregarse a un courier.';
  end if;

  -- 7.5 seller_membresias NO tiene política que la exponga por tenant (deny-all a
  --     couriers): la única política de SELECT es la self-only.
  if exists (
    select 1 from pg_policies
    where schemaname = 'identidad' and tablename = 'seller_membresias'
      and cmd = 'SELECT' and policyname <> 'seller_membresias_select_propias'
  ) then
    raise exception 'seller_membresias tiene una política de SELECT extra además de la self-only: podría exponer membresías cruzadas a un courier.';
  end if;

  -- 7.6 El unique parcial "un enlace vivo por courier" existe.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'identidad' and tablename = 'enlaces_registro_seller'
      and indexname = 'enlaces_registro_seller_un_vivo_por_tenant_uk'
  ) then
    raise exception 'Falta el unique parcial de un enlace vivo por courier: podrían convivir dos enlaces activos del mismo tenant.';
  end if;

  -- 7.7 seller_fuentes_declaradas: el guard solo_interno_edita está y es POR SENTENCIA.
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'identidad' and c.relname = 'seller_fuentes_declaradas'
      and t.tgname = 'trg_seller_fuentes_declaradas_solo_interno_edita'
      and not t.tgisinternal
  ) then
    raise exception 'Falta el guard solo_interno_edita en seller_fuentes_declaradas: un UPDATE de seller caería en "0 filas" silencioso en vez de 42501.';
  end if;

  -- 7.8 Las vistas espejo que SÍ existen son security_invoker (si no, las evalúa
  --     su dueño postgres/BYPASSRLS y exponen todos los tenants).
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('seller_membresias', 'seller_fuentes_declaradas')
      and c.relkind = 'v'
      and not (c.reloptions @> array['security_invoker=true'])
  ) then
    raise exception 'Una vista espejo del alta de seller no es security_invoker = true: la RLS se evaluaría como el dueño y expondría todos los tenants.';
  end if;
end $$;

-- =============================================================================
-- 8. Handoff (NO se implementa aquí — solo se documenta)
--
--   `backend`
--     · usuarios_perfil SIGUE 1:1 y guarda la membresía ACTIVA. El SWITCHER
--       reescribe usuarios_perfil.{tenant_id, seller_id} de la fila del usuario a
--       partir de una fila de seller_membresias (estado='activa'), por
--       service_role, y fuerza refresh del JWT para que el hook reinyecte el nuevo
--       tenant_id. seller_membresias NO alimenta el hook: es el catálogo de a
--       cuáles PUEDE cambiar.
--     · Alta por enlace: resolver token → tenant por service_role (la tabla es
--       deny-all); exponer a la landing SOLO tenants.nombre_fantasia. Al registrar:
--       (a) upsert de seller_identidades por auth_user_id; (b) crear/encontrar la
--       fila de identidad.sellers de ese tenant (respeta unique (tenant_id, rut) —
--       "una cuenta por empresa por courier"); (c) insertar seller_membresias
--       (estado 'activa'); (d) si es su primera membresía, crear usuarios_perfil
--       (tipo_usuario='seller', seller_id, tenant_id); si ya existe, dejar la
--       activa donde estaba o apuntarla a la nueva (decisión de UX). El seller nace
--       ACTIVO: sellers.estado='activo', no 'invitado'.
--     · Poblar seller_fuentes_declaradas al declarar fuentes: same-day
--       (rutax_manual) nace estado='conectada'; ml_flex/shopify nacen 'pendiente' y
--       pasan a 'conectada' cuando exista conexión viva en conexiones_seller_ml/_shopify
--       (y a 'desvinculada' cuando se caiga). ESTA tabla es el semáforo, NO la
--       fuente de verdad de la conexión: no dupliques el token acá.
--     · Bloqueo del seller por el courier: seller_membresias.estado='bloqueada'
--       (service_role, con bitácora — es acción de acceso, RNF-04). El switcher no
--       debe ofrecer membresías bloqueadas.
--     · El selector muestra nombres de courier: seller_membresias NO los trae. El
--       seller solo puede leer identidad.tenants de su tenant ACTIVO (RLS), así que
--       resuelve los nombres de los OTROS couriers por service_role.
--
--   `seguridad-cumplimiento`
--     · seller_identidades es dato personal CROSS-TENANT (Ley 21.719): deny-all a
--       propósito. Cualquier propuesta de que un courier la lea reabre la revisión.
--     · consentimiento_datos_en / consentimiento_version quedan listos; el TEXTO lo
--       define copywriter y su versión se registra aquí para poder re-pedirlo.
--     · El `token` del enlace es credencial-símil: nunca en logs ni analítica.
--     · La resolución pública token→tenant solo debe devolver nombre_fantasia; que
--       la Server Action no filtre RUT, correos ni la lista de enlaces.
--
--   `qa`
--     · supabase/tests/database/rls_aislamiento_alta_seller_autoservicio.test.sql
-- =============================================================================
