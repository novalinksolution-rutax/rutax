-- =============================================================================
-- Shopify entra como fuente · La conexión del seller con su tienda
-- =============================================================================
-- Crea `identidad.conexiones_seller_shopify`: una fila por tienda Shopify que un
-- seller conecta a este courier. Es la hermana de `identidad.conexiones_seller_ml`
-- (20260101000004:154-293), y de ahí sale TODO el molde de esta migración:
-- tenant_id denormalizado, trigger de consistencia de tenant, FK compuesta
-- (tenant_id, seller_id), vista espejo security_invoker, RLS enable+force,
-- guard `solo_interno_edita`, y el token viviendo en `secretos_cifrados` con
-- una referencia opaca aquí.
--
-- =============================================================================
-- POR QUÉ UNA TABLA HERMANA Y NO UNA TABLA GENÉRICA CON DISCRIMINADOR
-- =============================================================================
-- La tentación es obvia: "conexiones_seller" con una columna `proveedor`. Se
-- descarta, y por el MISMO criterio con el que 20260813000002 separó
-- `seller_bodegas` de `courier_bodegas`:
--
--   1. `conexiones_seller_ml` carga semántica de OAuth que Shopify NO tiene:
--      rotación de refresh token (`refresh_token_ref`), `token_expira_en`,
--      `ml_user_id`, `ml_nickname`, `desconectada_desde` y un tope de 10 cuentas
--      por seller impuesto por trigger. El Admin API token de Shopify es un
--      token de app instalada: no expira por reloj, no se refresca, y no hay una
--      "cuenta de usuario" detrás — hay un dominio de tienda.
--   2. Shopify trae lo que ML no tiene: `shop_domain` (la identidad de la
--      conexión), `scopes_otorgados` (lo que el merchant aprobó al instalar, que
--      cambia si la app pide permisos nuevos) y `filtro_etiqueta`.
--   3. Fundirlas obligaría a que ~8 columnas fueran nulables y a un CHECK
--      discriminador del tipo "si proveedor = 'ml' entonces ml_user_id not null".
--      Ese CHECK es exactamente la clase de condición que se rompe en silencio al
--      agregar un proveedor nuevo, y aquí lo que cuelga de la fila es un token de
--      escritura sobre la tienda de un tercero.
--   4. El tope por seller es una regla de ML (10 cuentas), no una regla del
--      concepto "conexión". En una tabla única, el trigger de tope tendría que
--      aprender a distinguir proveedores — o le empezaría a contar cupo de ML a
--      las tiendas Shopify.
--
-- Se paga en duplicación de RLS (dos juegos de políticas casi iguales). Se cobra
-- en que ninguna de las dos puede romper a la otra.
--
-- =============================================================================
-- AISLAMIENTO (la razón de ser de esta migración)
-- =============================================================================
--   · SELECT  → P1 tenant + P2 seller. El interno ve las conexiones de SU tenant;
--     el seller ve EXCLUSIVAMENTE las suyas. El conductor ve 0 filas.
--   · INSERT  → política para interno, pero SIN grant para `authenticated`: el
--     alta la hace el callback OAuth con service_role, porque la fila y su
--     `token_ref` nacen juntos. Una fila creada a mano sin token es inútil y
--     además OCUPA la unique (tenant_id, shop_domain), bloqueando el OAuth real.
--   · UPDATE  → política para interno + grant POR COLUMNA sobre las tres que un
--     humano edita (`alias`, `filtro_etiqueta`, `activa`). Todo lo demás
--     —token, cursor, salud, scopes— es service_role.
--   · DELETE  → revocado. La baja es `activa = false`: detrás de la fila cuelgan
--     los pedidos ya ingestados (`operacion.pedidos.fuente = 'shopify'`).
--
-- ⚠️ `token_ref` EXIGE GRANT POR COLUMNA, NO DE TABLA COMPLETA.
--    La vista `public.*` NO es barrera: `supabase/config.toml` expone el esquema
--    `identidad` directo por PostgREST, así que `Accept-Profile: identidad`
--    alcanza la tabla base sin pasar por `public`. Este repo ya fue mordido dos
--    veces por ese patrón exacto —`snapshot_regla` (20260707000002) y el token de
--    invitación (20260807000001)— y las dos veces la vista "protegía" una columna
--    que el grant de tabla entregaba igual. Aquí se aplica la receta del arreglo
--    del token de invitación: revoke del grant de tabla + grant sobre la lista
--    explícita de columnas + vista con lista explícita (nunca `select *`).
--    Está PROBADO, no solo escrito: rls_aislamiento_conexiones_shopify.test.sql.
--
-- IDEMPOTENTE: DO-block para el `create type`, `create table if not exists`,
-- `create index if not exists`, `create or replace function/view`, `drop policy
-- if exists` + create, `drop trigger if exists` + create. REVOKE/GRANT son
-- declarativos. Re-aplicable.
--
-- Prueba de aislamiento:
--   supabase/tests/database/rls_aislamiento_conexiones_shopify.test.sql
-- =============================================================================

-- =============================================================================
-- 1. El enum de salud: tipo PROPIO, no se reusa el de ML
-- =============================================================================
-- DECISIÓN: se crea `identidad.estado_salud_conexion_shopify` con los MISMOS
-- cuatro valores que `identidad.estado_salud_conexion_ml`, en vez de reusar ese.
--
-- Por qué, siendo hoy idénticos:
--   a) Los modos de falla NO son los mismos y van a divergir. Los de ML son de
--      token (vencido, revocado, refresh rechazado). Los de Shopify son de app
--      instalada: el merchant desinstala la app (webhook `app/uninstalled`), o la
--      app pide un scope nuevo y la instalación queda a medias. Cuando haga falta
--      un valor propio, agregarlo a un enum COMPARTIDO ampliaría en silencio el
--      dominio de ML: cada `switch`/`Record<...>` del lado ML tendría que manejar
--      un estado que ML no puede producir nunca, y ese es el tipo de rama muerta
--      que después nadie se atreve a borrar.
--   b) El tipo compartido se llama literalmente `..._conexion_ml`. Una columna
--      Shopify declarada con ese tipo es un nombre que miente, y los nombres que
--      mienten son los que hacen que alguien "arregle" la tabla equivocada.
--   c) El costo de la decisión es hoy CERO y mañana no: un `create type` nuevo se
--      puede crear y usar en la misma transacción (precedente literal:
--      20260101000004 crea `estado_salud_conexion_ml` en su §1 y usa el literal
--      'pendiente' como default en su §3, mismo archivo). Lo que NO se puede es
--      `alter type ... add value` y usar el valor en la misma transacción — por
--      eso 20260816000003 tuvo que ser un archivo aparte. Duplicar el tipo hoy
--      compra el derecho a extenderlo mañana sin arrastrar a ML.
--
-- Se conservan los mismos cuatro valores a propósito: el portal del seller ya
-- tiene un mapa estado→copy/color para ML y así lo reutiliza tal cual.
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'estado_salud_conexion_shopify' and n.nspname = 'identidad'
  ) then
    create type identidad.estado_salud_conexion_shopify as enum (
      'sana',
      'atencion',
      'desvinculada',
      'pendiente'
    );
  end if;
end $$;

comment on type identidad.estado_salud_conexion_shopify is
  'Salud de una conexión Shopify. Tipo PROPIO (no se reusa estado_salud_conexion_ml)
   aunque hoy tenga los mismos cuatro valores: los modos de falla de una app
   instalada en Shopify (desinstalación por el merchant, scopes insuficientes) no
   son los de un OAuth con refresh token, y compartir el enum haría que un valor
   nuevo de Shopify ampliara en silencio el dominio de ML.
   pendiente = creada, sin token todavía (OAuth a medias).
   sana = el último sondeo/ingesta respondió bien.
   atencion = falla recuperable (rate limit, 5xx, scopes por debajo de lo pedido).
   desvinculada = el token ya no sirve; hace falta que el seller reinstale.';

-- =============================================================================
-- 2. La tabla
-- =============================================================================
create table if not exists identidad.conexiones_seller_shopify (
  id                      uuid primary key default gen_random_uuid(),

  -- tenant_id denormalizado deliberadamente desde sellers (mismo motivo que en
  -- conexiones_seller_ml, 20260101000004:156-158): toda tabla que el seller
  -- pueda leer necesita tenant_id directo, sin join, para que la política de
  -- capa-tenant no dependa de un subselect. La consistencia con el tenant real
  -- del seller la impone el trigger del §4, no la disciplina de la aplicación.
  tenant_id               uuid not null references identidad.tenants (id) on delete cascade,
  seller_id               uuid not null references identidad.sellers (id) on delete cascade,

  -- Identidad de la conexión: el `*.myshopify.com` de la tienda.
  shop_domain             text not null,

  -- Referencia OPACA al Admin API access token, que vive cifrado en
  -- identidad.secretos_cifrados con tipo_secreto = 'token_admin_shopify'
  -- (valor creado en 20260816000003). NUNCA el token aquí.
  -- Sin FK física, igual que el resto de los `*_ref` del repo
  -- (20260101000003:113-114): mantiene secretos_cifrados desacoplada de las
  -- tablas de negocio y evita que un JOIN accidental la arrastre a una vista.
  token_ref               uuid,

  -- Lo que el merchant aprobó al instalar la app. No es secreto: es justamente
  -- lo que hay que mostrarle al seller cuando falta un permiso.
  scopes_otorgados        text[],

  -- Tag de Shopify con el que el seller acota qué pedidos manda a Rutax.
  filtro_etiqueta         text,

  -- Cursor de la ingesta. Columna PROPIA — ver el comentario de columna.
  cursor_ingesta_en       timestamptz,

  estado_salud            identidad.estado_salud_conexion_shopify not null default 'pendiente',
  ultima_sync_exitosa_en  timestamptz,
  ultimo_error            text,

  alias                   text,
  nombre_tienda           text,

  activa                  boolean not null default true,

  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),

  -- El seller referenciado debe pertenecer al MISMO tenant. La FK simple de
  -- arriba garantiza que el seller existe; esta garantiza que es de ESTE
  -- courier. La constraint que necesita del lado de sellers
  -- (sellers_tenant_id_id_uk) YA existe desde 20260101000004:49.
  constraint conexiones_seller_shopify_seller_pertenece_al_tenant
    foreign key (tenant_id, seller_id)
    references identidad.sellers (tenant_id, id)
    deferrable initially immediate,

  -- Una tienda no se conecta dos veces al MISMO courier. NO es unicidad global:
  -- la misma tienda puede estar conectada a dos couriers distintos, igual que el
  -- índice parcial de ML permite la misma cuenta ML en dos tenants
  -- (20260630000002 §2). Quién decide eso es el merchant, no nosotros.
  --
  -- No es parcial por `activa` a propósito: reconectar una tienda dada de baja
  -- es un UPDATE de la fila existente (activa = true + token_ref nuevo), no una
  -- fila nueva. Así el cursor de ingesta y el histórico sobreviven a la
  -- reconexión en vez de reiniciarse en silencio.
  constraint conexiones_seller_shopify_tenant_shop_uk unique (tenant_id, shop_domain),

  -- Habilita FK compuestas (tenant_id, conexion_id) futuras sin re-migrar. Se
  -- crea AHORA por el precedente literal de 20260813000002:102-107 (las bodegas
  -- lo hicieron y lo agradecieron dos etapas después) y el contra-precedente de
  -- sellers_tenant_id_id_uk, que hubo que agregar a posteriori con un DO-block.
  constraint conexiones_seller_shopify_tenant_id_id_uk unique (tenant_id, id),

  -- shop_domain CANÓNICO. La app ya normaliza a minúsculas; esto lo impone.
  -- No es cosmético: la unique de arriba es case-sensitive, así que
  -- "Tienda.myshopify.com" y "tienda.myshopify.com" serían DOS conexiones a la
  -- misma tienda, con dos tokens y doble ingesta del mismo pedido.
  -- No se valida el sufijo .myshopify.com: lo que la unique necesita es forma
  -- canónica, y clavar el sufijo aquí es una regla de proveedor que no quiero
  -- tener que migrar el día que Shopify cambie de dominio administrativo.
  constraint conexiones_seller_shopify_shop_domain_canonico check (
    shop_domain <> ''
    and shop_domain = lower(shop_domain)
    and shop_domain !~ '[/[:space:]]'
  ),

  -- NULL = sin filtro por tag. Cadena vacía = ambigüedad pura: ¿es "sin filtro"
  -- o es "un tag llamado ''" que no matchea nada? El segundo caso deja al seller
  -- mirando cero pedidos sin un solo error en ninguna parte. Se prohíbe.
  constraint conexiones_seller_shopify_filtro_etiqueta_no_vacia check (
    filtro_etiqueta is null or btrim(filtro_etiqueta) <> ''
  )
);

comment on table identidad.conexiones_seller_shopify is
  'Conexiones del seller con sus tiendas Shopify (1:N — una fila por tienda).
   Hermana de conexiones_seller_ml y NO una tabla genérica con discriminador: la
   de ML carga semántica de OAuth que Shopify no tiene (refresh token,
   token_expira_en, ml_user_id, tope de 10 cuentas) y fundirlas obligaría a
   columnas nulables y a un CHECK discriminador — mismo criterio con el que
   20260813000002 separó seller_bodegas de courier_bodegas.
   RLS: P1 tenant + P2 seller (el seller ve SOLO las suyas; el conductor, 0).
   El Admin API token vive cifrado en secretos_cifrados; aquí solo token_ref, y
   esa columna NO tiene grant de SELECT para authenticated (grant por columna:
   la vista public no es barrera frente a Accept-Profile: identidad).
   Sin DELETE para sesiones de usuario: la baja es activa = false, porque detrás
   cuelgan los pedidos ya ingestados.';

comment on column identidad.conexiones_seller_shopify.shop_domain is
  'El *.myshopify.com de la tienda: la identidad de la conexión. Se guarda en
   forma canónica (minúsculas, sin espacios ni barras) y el CHECK lo impone —
   la unique (tenant_id, shop_domain) es case-sensitive, así que sin canonizar,
   dos mayúsculas distintas serían dos conexiones a la MISMA tienda y el mismo
   pedido entraría dos veces.';

comment on column identidad.conexiones_seller_shopify.token_ref is
  'Referencia OPACA al Admin API access token de Shopify, cifrado en
   identidad.secretos_cifrados (tipo_secreto = token_admin_shopify). NUNCA el
   token. Triple barrera, copiada del arreglo del token de invitación
   (20260807000001): (1) la vista public.conexiones_seller_shopify NO incluye
   esta columna, (2) `authenticated` NO tiene privilegio SELECT sobre ella en la
   tabla base — eso es lo que cierra el acceso directo por
   Accept-Profile: identidad, que la vista sola NO cierra, y (3) `authenticated`
   tampoco la puede escribir, así que no puede apuntarla a un secreto ajeno.
   Solo service_role la lee y la escribe. Jamás en bitácora, logs ni URLs.';

comment on column identidad.conexiones_seller_shopify.scopes_otorgados is
  'Scopes que el merchant aprobó al instalar la app. NO es secreto: es lo que hay
   que mostrarle al seller cuando la app empieza a pedir un permiso que su
   instalación no tiene. Lo escribe el callback OAuth (service_role).';

comment on column identidad.conexiones_seller_shopify.filtro_etiqueta is
  'Tag de Shopify con el que el seller acota qué pedidos manda a Rutax (p. ej.
   solo los marcados "despacho-rutax"). NULL = sin filtro: entra todo pedido de
   la tienda que cumpla el resto de las condiciones de ingesta. Cadena vacía
   prohibida por CHECK: sería indistinguible de "sin filtro" y dejaría al seller
   con cero pedidos y cero errores. Es de las tres columnas que un interno SÍ
   puede editar desde el panel.';

comment on column identidad.conexiones_seller_shopify.cursor_ingesta_en is
  'Hasta qué instante la ingesta ya listó pedidos de ESTA tienda. Cursor
   incremental; NULL = nunca se ingirió por esta vía.
   ⚠️ COLUMNA PROPIA, SEPARADA DE ultima_sync_exitosa_en, Y ES LA LECCIÓN
   LITERAL DE 20260813000001: ultima_sync_exitosa_en es la marca de SALUD que el
   seller ve en su portal, y si el cursor viviera ahí, cualquier escritura de
   salud —una reconexión, un sondeo— lo empujaría hacia adelante sin haber
   ingerido nada, y los pedidos de ese hueco se perderían EN SILENCIO y para
   siempre. Son dos hechos distintos ("la tienda responde" vs. "tenemos los
   pedidos hasta T") y por eso van en dos columnas.
   Solo service_role: ni la vista public la expone ni authenticated tiene
   privilegio de SELECT sobre ella. Es detalle de operación, no información del
   negocio del seller.';

comment on column identidad.conexiones_seller_shopify.ultima_sync_exitosa_en is
  'Marca de SALUD que ve el seller en su portal ("última sincronización
   exitosa"). NO es el cursor de ingesta (ver cursor_ingesta_en). Solo la escribe
   service_role.';

comment on column identidad.conexiones_seller_shopify.alias is
  'Rótulo humano que el interno asigna a la conexión ("Tienda oficial",
   "Outlet"). Nullable. NO es secreto. Editable por interno.';

comment on column identidad.conexiones_seller_shopify.nombre_tienda is
  'Nombre de la tienda tal como lo reporta Shopify al instalar. Lo escribe
   service_role; el alias de arriba es el que pone el humano.';

comment on column identidad.conexiones_seller_shopify.activa is
  'false = conexión dada de baja. Sustituye al DELETE (revocado): borrar la fila
   dejaría huérfanos los pedidos ya ingestados desde esta tienda. Reconectar es
   volver a poner true sobre la MISMA fila, no crear otra.';

-- -----------------------------------------------------------------------------
-- 3. Índices
-- -----------------------------------------------------------------------------
create index if not exists conexiones_seller_shopify_tenant_id_idx
  on identidad.conexiones_seller_shopify (tenant_id);

-- El lookup que va a mandar: "las conexiones vivas de este seller" (portal del
-- seller, panel del courier, pipeline de ingesta).
create index if not exists conexiones_seller_shopify_tenant_seller_idx
  on identidad.conexiones_seller_shopify (tenant_id, seller_id) where activa;

-- El cron de ingesta recorre las conexiones vivas ordenando por lo más rancio.
-- Parcial, para que el barrido no pague por las desvinculadas ni por las dadas
-- de baja. Molde: conexiones_seller_ml_ingesta_cursor_idx (20260813000001:50-52).
create index if not exists conexiones_seller_shopify_cursor_idx
  on identidad.conexiones_seller_shopify (cursor_ingesta_en)
  where activa and estado_salud <> 'desvinculada';

drop trigger if exists trg_conexiones_seller_shopify_actualizado_en on identidad.conexiones_seller_shopify;
create trigger trg_conexiones_seller_shopify_actualizado_en
  before update on identidad.conexiones_seller_shopify
  for each row execute function identidad.set_actualizado_en();

-- =============================================================================
-- 4. Trigger de consistencia de tenant
-- =============================================================================
-- El tenant_id denormalizado siempre debe coincidir con el tenant del seller
-- referenciado. La FK compuesta del §2 ya lo impone, pero el mensaje que produce
-- (23503, "viola la llave foránea ..._seller_pertenece_al_tenant") no dice cuál
-- de los dos valores está mal. Este trigger, copiado de
-- identidad.conexiones_seller_ml_validar_tenant (20260101000004:197-224), falla
-- ANTES y nombra los dos tenants en conflicto. Defensa en profundidad: no se
-- confía en la disciplina de inserción de la app.
create or replace function identidad.conexiones_seller_shopify_validar_tenant()
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

drop trigger if exists trg_conexiones_seller_shopify_validar_tenant on identidad.conexiones_seller_shopify;
create trigger trg_conexiones_seller_shopify_validar_tenant
  before insert or update on identidad.conexiones_seller_shopify
  for each row execute function identidad.conexiones_seller_shopify_validar_tenant();

-- =============================================================================
-- 5. Vista espejo — LISTA EXPLÍCITA DE COLUMNAS, nunca `select *`
-- =============================================================================
-- Omite `token_ref` y `cursor_ingesta_en`. La lista explícita es parte de la
-- barrera: si mañana se agrega una columna sensible a la tabla base, NO aparece
-- sola en la superficie de PostgREST. Es la misma forma que quedó en
-- public.invitaciones tras 20260807000001 §C.
--
-- `drop view` + `create` en vez de `create or replace`: replace no puede quitar
-- una columna existente, así que si alguna vez esta vista salió con `select *`,
-- solo el drop la arregla. Sin CASCADE a propósito: si algo dependiera de ella,
-- preferimos que la migración falle ruidosamente a dropear el dependiente en
-- silencio.
drop view if exists public.conexiones_seller_shopify;

create view public.conexiones_seller_shopify
  with (security_invoker = true)
  as select
    id,
    tenant_id,
    seller_id,
    shop_domain,
    scopes_otorgados,
    filtro_etiqueta,
    estado_salud,
    ultima_sync_exitosa_en,
    ultimo_error,
    alias,
    nombre_tienda,
    activa,
    creado_en,
    actualizado_en
  from identidad.conexiones_seller_shopify;

comment on view public.conexiones_seller_shopify is
  'Espejo de identidad.conexiones_seller_shopify para PostgREST. RLS heredada de
   la tabla base (security_invoker = true): P1 tenant + P2 seller.
   Omite `token_ref` y `cursor_ingesta_en` A PROPÓSITO. Si se agregan columnas a
   la tabla base, NO se re-emite esta vista con `select *`: la lista explícita es
   parte de la barrera. Y OJO: la vista NO es la barrera principal — el esquema
   `identidad` está expuesto por PostgREST, así que lo que de verdad cierra el
   token es el grant POR COLUMNA sobre la tabla base (§7).';

-- =============================================================================
-- 6. RLS
-- =============================================================================
alter table identidad.conexiones_seller_shopify enable row level security;
alter table identidad.conexiones_seller_shopify force row level security;

-- SELECT: P1 (tenant) + P2 (el seller ve las suyas).
--
-- OJO — LA FORMA ENUMERADA NO ES ESTILO. Escribir esto como
-- `claim_tipo_usuario() <> 'seller' or seller_id = claim_seller_id()` deja pasar
-- también al CONDUCTOR, cuyo tipo_usuario tampoco es 'seller'. Este repo ya
-- cometió ese bug (20260101000002:132-140, 20260101000004:236-241) y lo dejó
-- documentado en 20260813000002:214-220. Se enumeran los DOS casos permitidos y
-- cualquier otro tipo_usuario queda fuera por construcción.
drop policy if exists conexiones_seller_shopify_select on identidad.conexiones_seller_shopify;
create policy conexiones_seller_shopify_select
  on identidad.conexiones_seller_shopify
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

-- INSERT: solo interno. Hoy la política queda INERTE porque `authenticated` no
-- tiene privilegio de INSERT (§7) — el alta la hace el callback OAuth con
-- service_role, que es el único que puede escribir la fila y su token_ref en la
-- misma transacción. Se deja escrita a propósito, como guarda de FILA si algún
-- día se restituye el grant: mismo criterio que 20260807000001:43-44.
drop policy if exists conexiones_seller_shopify_insert_interno on identidad.conexiones_seller_shopify;
create policy conexiones_seller_shopify_insert_interno
  on identidad.conexiones_seller_shopify
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

-- UPDATE: solo interno, y solo sobre las tres columnas que el §7 le concede
-- (alias, filtro_etiqueta, activa). Esta política SÍ está viva.
drop policy if exists conexiones_seller_shopify_update_interno on identidad.conexiones_seller_shopify;
create policy conexiones_seller_shopify_update_interno
  on identidad.conexiones_seller_shopify
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

-- Sin política de DELETE, y además el privilegio revocado en el §7.

-- Guard de defensa en profundidad, cubriendo LAS TRES escrituras. El motivo está
-- escrito en 20260101000002:236-247 y 20260813000002:267-274: en INSERT, una
-- WITH CHECK incumplida ya lanza 42501 sola, pero en UPDATE/DELETE un USING que
-- no matchea solo reduce el conjunto a cero filas, SIN error. Y aquí eso importa
-- de verdad: el seller SÍ ve sus propias conexiones (P2), así que su UPDATE no
-- cae en "no existe la fila" — cae en "UPDATE 0" silencioso y la interfaz le
-- diría "guardado" sin haber guardado nada. El disparador POR SENTENCIA convierte
-- ese silencio en un 42501 explícito y auditable.
drop trigger if exists trg_conexiones_seller_shopify_solo_interno_edita on identidad.conexiones_seller_shopify;
create trigger trg_conexiones_seller_shopify_solo_interno_edita
  before insert or update or delete on identidad.conexiones_seller_shopify
  for each statement execute function identidad.solo_interno_edita();

-- =============================================================================
-- 7. Grants — POR COLUMNA. Esta sección es la barrera de verdad.
-- =============================================================================
-- Se parte revocando TODO lo que las default privileges de Supabase puedan haber
-- regalado, en la tabla base y en la vista. Sin este revoke previo, un grant por
-- columna no quita nada: los privilegios se SUMAN.
revoke all on identidad.conexiones_seller_shopify from authenticated, anon, public;
revoke all on public.conexiones_seller_shopify    from authenticated, anon, public;

-- SELECT sobre la lista explícita: TODO menos `token_ref` y `cursor_ingesta_en`.
-- Esta es la línea que cierra el `Accept-Profile: identidad`, y es la que las dos
-- veces anteriores (snapshot_regla, token de invitación) faltaba.
grant select (
  id,
  tenant_id,
  seller_id,
  shop_domain,
  scopes_otorgados,
  filtro_etiqueta,
  estado_salud,
  ultima_sync_exitosa_en,
  ultimo_error,
  alias,
  nombre_tienda,
  activa,
  creado_en,
  actualizado_en
) on identidad.conexiones_seller_shopify to authenticated;

-- UPDATE sobre las TRES columnas que edita un humano desde el panel del courier.
-- El resto —token_ref, cursor_ingesta_en, estado_salud, ultima_sync_exitosa_en,
-- ultimo_error, scopes_otorgados, shop_domain, seller_id, tenant_id— es
-- service_role: son hechos que produce un job o el callback OAuth, no una
-- opinión de un usuario. Que un interno pudiera escribir `estado_salud = 'sana'`
-- a mano es exactamente cómo una conexión rota deja de avisar que está rota.
grant update (alias, filtro_etiqueta, activa)
  on identidad.conexiones_seller_shopify to authenticated;

-- Sin INSERT y sin DELETE para `authenticated`, a ningún nivel de columna:
--   · INSERT → la fila y su token nacen juntos, en el callback OAuth
--     (service_role). Una fila a mano sin token es inútil y OCUPA la unique
--     (tenant_id, shop_domain), bloqueando el OAuth real de esa tienda.
--   · DELETE → la baja es lógica (activa = false): borrar la fila dejaría
--     huérfanos los pedidos ya ingestados desde esa tienda. Sin el revoke, un
--     DELETE quedaría frenado solo por la ausencia de política, es decir "cero
--     filas" en silencio — el modo de falla que este proyecto no acepta. Con el
--     revoke es 42501 explícito. Molde: 20260813000002:438-458.
-- (Ambos ya quedaron fuera por el `revoke all` de arriba; se documenta para que
--  nadie los "reponga por simetría" con conexiones_seller_ml.)

-- La vista: mismas reglas. Es auto-actualizable (simple, sobre una sola tabla),
-- así que el UPDATE por PostgREST necesita el privilegio en AMBOS lugares.
grant select on public.conexiones_seller_shopify to authenticated;
grant update (alias, filtro_etiqueta, activa)
  on public.conexiones_seller_shopify to authenticated;

-- service_role: todo. BYPASSRLS salta las políticas pero NO reemplaza el GRANT.
grant select, insert, update, delete on identidad.conexiones_seller_shopify to service_role;
grant select, insert, update, delete on public.conexiones_seller_shopify    to service_role;

-- =============================================================================
-- 8. Aserción defensiva — la migración ABORTA si una barrera no quedó puesta
-- =============================================================================
-- No altera nada: inspecciona el catálogo y falla ruidosamente. Mismo patrón que
-- 20260813000002 §4 y 20260816000004 §8. Existe porque TODAS las piezas de abajo
-- son silenciosas cuando faltan: una tabla sin FORCE RLS se lee normal, un guard
-- ausente devuelve "0 filas" en vez de 42501, y un grant de tabla completa
-- entrega el token sin que nada se queje.
do $$
declare
  tgtipo smallint;
begin
  -- 8.1 RLS activa Y FORZADA. `force` es la que cubre también al dueño de la
  --     tabla: sin ella, cualquier conexión con el rol propietario lee todos los
  --     tenants y el aislamiento es papel mojado.
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'identidad' and c.relname = 'conexiones_seller_shopify'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception
      'identidad.conexiones_seller_shopify no quedó con RLS enable + force. Sin RLS forzada no hay aislamiento entre couriers en esta tabla.';
  end if;

  -- 8.2 EL TOKEN NO ES LEGIBLE POR `authenticated`. La aserción central: es la
  --     que faltó las dos veces que este patrón mordió (snapshot_regla y el
  --     token de invitación). Se MIDE contra el catálogo, no se supone.
  if has_column_privilege('authenticated', 'identidad.conexiones_seller_shopify', 'token_ref', 'SELECT') then
    raise exception
      'authenticated conserva SELECT sobre identidad.conexiones_seller_shopify.token_ref. El grant volvió a ser de tabla completa: la vista public NO protege nada frente a Accept-Profile: identidad.';
  end if;
  if has_column_privilege('authenticated', 'identidad.conexiones_seller_shopify', 'token_ref', 'UPDATE') then
    raise exception
      'authenticated puede ESCRIBIR token_ref: podría apuntar la conexión a otro secreto. Solo service_role escribe esa columna.';
  end if;

  -- 8.3 El cursor tampoco: es detalle de operación (service_role), y mezclarlo
  --     con la marca de salud es la lección de 20260813000001.
  if has_column_privilege('authenticated', 'identidad.conexiones_seller_shopify', 'cursor_ingesta_en', 'SELECT') then
    raise exception
      'authenticated conserva SELECT sobre cursor_ingesta_en. Es cursor de ingesta (service_role), no información del seller.';
  end if;

  -- 8.4 …y la otra dirección: el grant por columna NO dejó ciega a la tabla.
  --     Sin esto, "cerrar el token" podría haber cerrado todo y la pantalla del
  --     seller mostraría vacío sin decir por qué.
  if not (
    select bool_and(has_column_privilege('authenticated', 'identidad.conexiones_seller_shopify', col, 'SELECT'))
      from unnest(array['id', 'tenant_id', 'seller_id', 'shop_domain', 'estado_salud',
                        'ultima_sync_exitosa_en', 'filtro_etiqueta', 'activa']) as col
  ) then
    raise exception
      'authenticated perdió SELECT sobre alguna columna de negocio: el grant por columna se quedó corto y el portal del seller quedaría vacío sin error.';
  end if;

  -- 8.5 Salud y scopes son de service_role: un interno no los reescribe a mano.
  if (
    select bool_or(has_column_privilege('authenticated', 'identidad.conexiones_seller_shopify', col, 'UPDATE'))
      from unnest(array['estado_salud', 'ultima_sync_exitosa_en', 'ultimo_error',
                        'scopes_otorgados', 'cursor_ingesta_en', 'shop_domain']) as col
  ) then
    raise exception
      'authenticated puede escribir alguna columna de salud/cursor/identidad de la conexión. Esas las produce un job, no un usuario: una conexión rota dejaría de avisar que está rota.';
  end if;

  -- 8.6 …y sí puede editar las tres del panel.
  if not (
    select bool_and(has_column_privilege('authenticated', 'identidad.conexiones_seller_shopify', col, 'UPDATE'))
      from unnest(array['alias', 'filtro_etiqueta', 'activa']) as col
  ) then
    raise exception
      'authenticated no puede editar alias/filtro_etiqueta/activa: el panel del courier no podría renombrar ni dar de baja una conexión.';
  end if;

  -- 8.7 Sin INSERT ni DELETE para el rol de cliente, en tabla base y vista.
  if has_any_column_privilege('authenticated', 'identidad.conexiones_seller_shopify', 'INSERT') then
    raise exception
      'authenticated conserva INSERT sobre la tabla base. El alta va por el callback OAuth (service_role): una fila sin token ocupa la unique (tenant_id, shop_domain) y bloquea la conexión real.';
  end if;
  if has_table_privilege('authenticated', 'identidad.conexiones_seller_shopify', 'DELETE') then
    raise exception
      'authenticated conserva DELETE sobre la tabla base. La baja es lógica (activa = false): borrar deja huérfanos los pedidos ya ingestados.';
  end if;
  if has_table_privilege('authenticated', 'public.conexiones_seller_shopify', 'DELETE') then
    raise exception
      'authenticated conserva DELETE sobre la vista. Supabase otorga ALL por default privileges en public según qué rol crea el objeto: el revoke no tomó efecto.';
  end if;

  -- 8.8 `anon` (sesión NO autenticada) no ve absolutamente nada.
  if has_any_column_privilege('anon', 'identidad.conexiones_seller_shopify', 'SELECT')
     or has_any_column_privilege('anon', 'public.conexiones_seller_shopify', 'SELECT') then
    raise exception
      'anon tiene SELECT sobre las conexiones Shopify. Ninguna política lo alcanza, pero el privilegio no debe existir.';
  end if;

  -- 8.9 La vista NO expone token_ref ni cursor_ingesta_en.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'conexiones_seller_shopify'
      and column_name in ('token_ref', 'cursor_ingesta_en')
  ) then
    raise exception
      'La vista public.conexiones_seller_shopify volvió a exponer token_ref o cursor_ingesta_en. Alguien la re-emitió con `select *`.';
  end if;

  -- 8.10 La vista debe ser security_invoker. Sin esa opción la evalúa su dueño
  --      (postgres, BYPASSRLS) y se vuelve un agujero que expone TODOS los
  --      tenants por PostgREST.
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'conexiones_seller_shopify' and c.relkind = 'v'
      and c.reloptions @> array['security_invoker=true']
  ) then
    raise exception
      'La vista public.conexiones_seller_shopify no tiene security_invoker = true. Sin ella la RLS se evalúa como el dueño de la vista y expone todos los tenants.';
  end if;

  -- 8.11 El guard existe y cubre LAS TRES escrituras, BEFORE y POR SENTENCIA.
  --      Bits de pg_trigger.tgtype: 1=ROW, 2=BEFORE, 4=INSERT, 8=DELETE, 16=UPDATE.
  select t.tgtype into tgtipo
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'identidad' and c.relname = 'conexiones_seller_shopify'
     and t.tgname = 'trg_conexiones_seller_shopify_solo_interno_edita'
     and not t.tgisinternal;

  if tgtipo is null then
    raise exception
      'Falta el guard trg_conexiones_seller_shopify_solo_interno_edita: es lo que convierte el "0 filas" silencioso de un seller en un 42501 explícito.';
  end if;
  if (tgtipo & 28) <> 28 or (tgtipo & 1) <> 0 or (tgtipo & 2) <> 2 then
    raise exception
      'El guard de identidad.conexiones_seller_shopify no es BEFORE INSERT/UPDATE/DELETE FOR EACH STATEMENT (tgtype=%). Por fila no se dispara cuando RLS ya filtró a cero, que es justo el caso que hay que atrapar.', tgtipo;
  end if;

  -- 8.12 El trigger de consistencia de tenant existe (por fila, BEFORE
  --      INSERT+UPDATE). Sin él, un tenant_id mal puesto solo lo atraparía la FK
  --      compuesta, con un mensaje que no dice cuál de los dos valores está mal.
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'identidad' and c.relname = 'conexiones_seller_shopify'
      and t.tgname = 'trg_conexiones_seller_shopify_validar_tenant'
      and not t.tgisinternal
  ) then
    raise exception
      'Falta trg_conexiones_seller_shopify_validar_tenant: el tenant_id denormalizado podría dejar de corresponder al del seller.';
  end if;

  -- 8.13 Las dos unique. Se comprueban por COLUMNAS, no por nombre: importa que
  --      la garantía exista, no cómo se llame.
  if not exists (
    select 1 from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'identidad' and c.relname = 'conexiones_seller_shopify'
      and con.contype = 'u'
      and (
        select array_agg(a.attname::text order by a.attname)
          from unnest(con.conkey) as k(attnum)
          join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
      ) = array['shop_domain', 'tenant_id']
  ) then
    raise exception
      'Falta unique (tenant_id, shop_domain). Sin ella, la misma tienda se conecta dos veces al mismo courier y cada pedido entra duplicado.';
  end if;

  if not exists (
    select 1 from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'identidad' and c.relname = 'conexiones_seller_shopify'
      and con.contype = 'u'
      and (
        select array_agg(a.attname::text order by a.attname)
          from unnest(con.conkey) as k(attnum)
          join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
      ) = array['id', 'tenant_id']
  ) then
    raise exception
      'Falta unique (tenant_id, id). Sin ella, la primera FK compuesta que necesite esta tabla obliga a re-migrarla (precedente: sellers_tenant_id_id_uk).';
  end if;
end $$;

-- =============================================================================
-- 9. Handoff (NO se implementa aquí — solo se documenta)
--
--    `integraciones` / `backend`
--      · El alta de una conexión y toda escritura de token_ref, scopes_otorgados,
--        estado_salud, ultima_sync_exitosa_en, ultimo_error, nombre_tienda y
--        cursor_ingesta_en van por SERVICE_ROLE. Con el cliente de sesión fallan
--        con 42501 (privilegio de columna), no con "0 filas": el error es
--        explícito y eso es a propósito.
--      · Lo ÚNICO que un interno puede escribir con el cliente de sesión es
--        `alias`, `filtro_etiqueta` y `activa`.
--      · `cursor_ingesta_en` NO se toca al reconectar ni al sondear salud. Esa
--        columna solo avanza cuando efectivamente se ingirieron pedidos hasta
--        ese instante (lección de 20260813000001).
--      · Reconectar una tienda dada de baja es UPDATE de la fila existente, no
--        INSERT: la unique (tenant_id, shop_domain) no es parcial por `activa`.
--      · `shop_domain` se normaliza a minúsculas ANTES de escribir; el CHECK
--        rechaza mayúsculas, espacios y barras (23514).
--      · El token va cifrado en identidad.secretos_cifrados con
--        tipo_secreto = 'token_admin_shopify' (20260816000003 §3). Aquí solo la
--        referencia opaca, nunca el valor, nunca en logs ni en URLs.
--
--    `frontend`
--      · La superficie por PostgREST es public.conexiones_seller_shopify, que NO
--        trae token_ref ni cursor_ingesta_en. Pedirlos devuelve 42703 por la
--        vista y 42501 por la tabla base.
--      · La baja es `activa = false`. DELETE está revocado: devuelve 42501.
--
--    `qa`
--      · supabase/tests/database/rls_aislamiento_conexiones_shopify.test.sql.
-- =============================================================================
