-- =============================================================================
-- Punto de término de ruta del conductor — etapa 7 (solo esquema y acceso)
-- =============================================================================
-- FUENTE DE VERDAD: docs/seguridad/punto-de-termino-conductor.md (revisión de
-- `seguridad-cumplimiento`, 2026-08-14, veredicto "SE PUEDE CONSTRUIR con seis
-- condiciones"). Ese documento MANDA sobre la etapa 7 en todo lo que toque el
-- punto de término; si el plan de ejecución dice otra cosa, gana el documento.
--
-- QUÉ ES: la ruta del conductor arranca en la bodega del courier y PUEDE
-- terminar en un punto que él define — su casa, o cerca de ella. Es opcional,
-- revocable y no cambia nada si no lo define (la ruta termina en la última
-- parada). Es un dato personal del trabajador bajo la Ley 21.431, y la base de
-- licitud es su consentimiento: por eso hay tabla propia, finalidad propia y
-- borrado real.
--
-- QUÉ CUBRE ESTA MIGRACIÓN (condiciones C1, C2, C4 y el esqueleto de C5):
--   1. `operacion.punto_termino_conductor` — una fila por conductor, coordenada
--      redondeada por trigger, SIN el texto de la dirección.
--   2. RLS solo-el-propio-conductor: sin rama `interno`, sin `super_admin`, sin
--      vista espejo en `public` y sin un solo `grant` a `authenticated`.
--   3. `finalidad` en `operacion.consentimientos_ubicacion`, para que el
--      consentimiento del punto de término NO sea el del rastreo en vivo.
--
-- QUÉ NO CUBRE, y no es olvido (C3 y C6 viven en TypeScript, no en SQL):
--   · La protección PRINCIPAL no está aquí. El motor de ruteo corre con
--     `service_role`, que bypasea RLS por diseño: lo que impide que el
--     coordinador vea el ancla es que NUNCA entra en el DTO de la ruta, ni en
--     la polilínea, ni en el encuadre del mapa, ni en los totales de km/ETA.
--     Los 15 canales de fuga están enumerados en §4.3 del documento.
--   · La exportación RNF-13 del courier (`TABLAS_A_EXPORTAR`) NO incluye esta
--     tabla, a propósito: ese JSON se lo lleva el dueño del courier.
--   · La tabla NO se publica en Realtime.
--
-- Molde estructural: `operacion.ubicacion_conductor` (20260613000008 §3 y §8).
-- Se copia la FORMA (PK por conductor, FK compuesta con tenant, enable+force
-- RLS, escritura exclusiva de service_role, comentario con la razón de la
-- minimización) y se descartan sus CUATRO defectos, que son justo por lo que esa
-- tabla se retiró el 2026-08-14 (ver su `comment on table` en 20260814000002,
-- que es su lápida): la rama `interno` de su política, la vista en `public` con
-- `grant select to authenticated`, el ciclo de vida colgado de que alguien
-- complete un manifiesto, y la ausencia de job de purga.
--
-- Idempotente: create table/index/trigger/policy con drop-if-exists o
-- if-not-exists, `add column if not exists`, `create or replace`. Re-aplicable
-- sobre una base ya migrada.
--
-- Prueba de aislamiento:
--   supabase/tests/database/rls_aislamiento_punto_termino.test.sql
-- =============================================================================

-- =============================================================================
-- 1. operacion.punto_termino_conductor
-- =============================================================================
-- UNA fila por conductor: la PK es `conductor_id`, así que el histórico es
-- INEXPRESABLE. No es una promesa del código, es el esquema — y es el rasgo más
-- valioso del molde. Un cambio de casa PISA el dato; no hay versión anterior
-- que conservar, ni columna `anterior`, ni "por si acaso".
--
-- NO SE GUARDA EL TEXTO DE LA DIRECCIÓN, en ninguna columna. La vía de captura
-- es un pin en el mapa: si no hay dirección escrita, no hay cadena que mandar a
-- un tercero ni que persistir. Y hay una razón que decide sola (§3 del
-- documento): `integraciones.geocoding_cache` es un caché GLOBAL, sin
-- `tenant_id`, que guarda `direccion_norm` EN CLARO y NO TIENE PURGA. Pasar el
-- domicilio de un conductor por `resolverCoordenadaConCache` —el atajo natural,
-- "reuso lo de bodegas"— dejaría la dirección escrita para siempre en una tabla
-- compartida entre couriers y haría FALSA la promesa de borrado. Está
-- prohibido, y no se arregla con RLS: es un problema de finalidad y retención.
create table if not exists operacion.punto_termino_conductor (
  -- PK = conductor_id. Una fila por conductor, sin histórico (ver arriba).
  conductor_id    uuid primary key references identidad.conductores (id) on delete cascade,

  -- P1: tenant obligatorio. La política no lo necesitaría (el conductor ya se
  -- identifica por driver_id), pero dar de alta un courier agrega filas aquí →
  -- es tabla de negocio, y el test mecánico de CLAUDE.md no admite discusión.
  tenant_id       uuid not null references identidad.tenants (id) on delete restrict,

  -- Redondeadas a 3 decimales (~110 m) POR TRIGGER, no por la aplicación (§2).
  -- 3 decimales identifican una manzana, no una casa: suficiente para sesgar la
  -- última parada, insuficiente para señalar un domicilio.
  lat             double precision not null,
  long            double precision not null,

  -- Se deriva de la coordenada (catálogo de comunas RM) y existe SOLO para que
  -- el conductor reconozca su propio punto. No se muestra a nadie más.
  comuna          text,

  definido_en     timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),

  -- El conductor referenciado debe pertenecer al mismo tenant. La FK simple de
  -- arriba garantiza que existe; esta garantiza que es de ESTE courier, sin
  -- confiar en la disciplina de inserción de la aplicación.
  constraint punto_termino_conductor_pertenece_al_tenant
    foreign key (tenant_id, conductor_id)
    references identidad.conductores (tenant_id, id)
    deferrable initially immediate,

  -- Cordura de coordenada. No acota a la RM a propósito: un courier fuera de
  -- Santiago no debe chocar con un CHECK geográfico, y el redondeo ya limita la
  -- precisión. Esto solo ataja el valor imposible (un cero de un bug, un swap
  -- lat/long que sale del rango).
  constraint punto_termino_conductor_lat_rango  check (lat  between -90  and 90),
  constraint punto_termino_conductor_long_rango check (long between -180 and 180)
);

comment on table operacion.punto_termino_conductor is
  'Punto donde el conductor pide TERMINAR su ruta (su casa, o cerca). OPCIONAL y
   REVOCABLE. Dato personal del trabajador (Ley 21.431): la base de licitud es su
   consentimiento, registrado aparte en operacion.consentimientos_ubicacion con
   finalidad = ''punto_termino_ruta''.

   UNA FILA POR CONDUCTOR (PK = conductor_id): el histórico es inexpresable por
   esquema. Definir otro punto es un UPDATE de la misma fila, nunca una fila
   nueva. NO se guarda el texto de la dirección en ninguna columna, y la
   coordenada NUNCA puede pasar por resolverCoordenadaConCache: el caché de
   integraciones.geocoding_cache es global, sin tenant_id, guarda direccion_norm
   en claro y no tiene purga — meter el domicilio ahí haría falsa la promesa de
   borrado. lat/long se redondean a 3 decimales POR TRIGGER (~110 m: una
   manzana, no una casa).

   ⚠️ LA RLS DE ESTA TABLA **NO** ES LA PROTECCIÓN PRINCIPAL. LÉELO ANTES DE
   CONSTRUIR LA PANTALLA. El motor de ruteo corre con service_role, que bypasea
   RLS por diseño: nada impide, a nivel de base, que el servidor serialice esta
   coordenada en las props que viajan al navegador del coordinador. La barrera
   real es de MÓDULO: el ancla entra en el CÁLCULO de la ruta y jamás en el
   artefacto que sale — ni DTO, ni polilínea, ni encuadre del mapa (fitBounds),
   ni totales de km, ni ETA, ni PDF, ni CSV, ni exportación RNF-13, ni Realtime,
   ni contexto de Sentry. El tipo de la ruta NO debe tener un campo donde quepa
   una coordenada de término, y la función que resuelve el orden devuelve EL
   ORDEN, no los nodos.

   Y no es cortesía: bajo subordinación laboral el consentimiento solo es libre
   si negarse no queda a la vista del jefe. Si la interfaz del coordinador
   permite distinguir a un conductor que definió su punto de uno que no —por un
   badge, un campo vacío, un orden distinto o unos kilómetros totales
   diferentes— el consentimiento de TODOS los demás queda contaminado. "Nada
   delata quién no lo definió" no se cumple escondiendo un campo: se cumple
   haciendo que la salida sea IDÉNTICA en los dos casos.

   RLS: SOLO el propio conductor. Sin rama interno, sin super_admin, sin vista
   espejo en public y sin un solo grant a authenticated — la política queda
   escrita igual, inerte hoy y correcta el día que alguien agregue una vista sin
   pensar. Escritura exclusiva de service_role.

   Borrado REAL (no activa = false): al revocar, al desvincular al conductor y
   por inactividad (job operacion/purgarPuntoTermino). Aquí no cuelga plata, ni
   prueba, ni respaldo contable: no hay un solo motivo para conservar.

   Fuente de verdad: docs/seguridad/punto-de-termino-conductor.md.';

comment on column operacion.punto_termino_conductor.lat is
  'Latitud REDONDEADA a 3 decimales por trigger (~110 m). El redondeo se impone
   en la base, no en TypeScript, para que un escritor con un bug no pueda
   guardar la coordenada fina.';

comment on column operacion.punto_termino_conductor.long is
  'Longitud REDONDEADA a 3 decimales por trigger (~110 m). Ver lat.';

comment on column operacion.punto_termino_conductor.comuna is
  'Nombre de comuna DERIVADO de la coordenada (catálogo COMUNAS_RM). Existe solo
   para que el conductor reconozca su propio punto en su app. No se muestra a
   nadie más, y NO es el texto de una dirección.';

comment on column operacion.punto_termino_conductor.definido_en is
  'Cuándo se definió por primera vez. Un UPDATE del punto NO lo mueve (para eso
   está actualizado_en): no es histórico de coordenadas, no guarda ninguna.';

-- Índice por tenant: lo usa la purga (recorre por courier para su asiento de
-- bitácora) y el offboarding.
create index if not exists idx_punto_termino_conductor_tenant_id
  on operacion.punto_termino_conductor (tenant_id);

-- =============================================================================
-- 2. Trigger de redondeo a 3 decimales (~110 m)
-- =============================================================================
-- EL REDONDEO SE IMPONE EN LA BASE, no en TypeScript: así un escritor con un bug
-- —o un endpoint futuro que nadie revisó— no puede guardar la coordenada fina.
--
-- Por qué trigger y no CHECK: comparar `double precision` por igualdad después
-- de redondear es frágil (un CHECK `lat = round(lat,3)` rechaza valores que sí
-- vienen redondeados, por representación binaria).
-- Por qué double precision y no numeric(6,3): supabase-js devuelve `numeric`
-- como CADENA, y eso es un pie de banco para el solver, que hace aritmética.
create or replace function operacion.punto_termino_conductor_redondear()
returns trigger
language plpgsql
as $$
begin
  new.lat  := round(new.lat::numeric,  3)::double precision;
  new.long := round(new.long::numeric, 3)::double precision;

  -- Marca de última escritura. `definido_en` NO se toca: redefinir el punto es
  -- un UPDATE de la misma fila, y esa columna dice desde cuándo existe el dato,
  -- no cuántas veces cambió.
  if tg_op = 'UPDATE' then
    new.actualizado_en := now();
  end if;

  return new;
end;
$$;

comment on function operacion.punto_termino_conductor_redondear() is
  'BEFORE INSERT OR UPDATE en operacion.punto_termino_conductor: redondea lat y
   long a 3 decimales (~110 m) y sella actualizado_en en los UPDATE. El redondeo
   vive en la BD a propósito — es la única forma de que un escritor con un bug no
   pueda persistir la coordenada fina del domicilio de un trabajador.';

drop trigger if exists trg_punto_termino_conductor_redondear on operacion.punto_termino_conductor;
create trigger trg_punto_termino_conductor_redondear
  before insert or update on operacion.punto_termino_conductor
  for each row execute function operacion.punto_termino_conductor_redondear();

-- =============================================================================
-- 3. RLS — SOLO el propio conductor. Cuatro decisiones que no son de estilo.
-- =============================================================================
--   1. NO hay rama `interno`. Ni dueño, ni supervisor, ni coordinador, ni
--      administración. Es la diferencia con el molde: en ubicacion_conductor esa
--      rama era discutible; aquí es incompatible con el diseño (§4.2 del
--      documento: si el jefe puede ver quién declinó, el consentimiento de todos
--      los demás deja de ser libre).
--   2. NO hay rama `super_admin`. La impersonation auditada de `plataforma` no
--      abre esta puerta.
--   3. NO se crea vista en `public` NI se otorga nada a `authenticated`. Ningún
--      cliente consulta esta tabla por PostgREST: la app Expo entra por rutas
--      Bearer y la PWA por Server Actions, ambas con service_role. La política
--      se escribe igual — inerte hoy, correcta el día que alguien agregue una
--      vista sin pensar.
--      ⚠️ Ojo: el esquema `operacion` ESTÁ expuesto a PostgREST
--      (`api.schemas` en supabase/config.toml), así que "no hay vista en public"
--      no basta por sí solo: lo que cierra la puerta es el `revoke all` de abajo.
--   4. `tenant_id` va igual aunque la política no lo necesitara (ver §1).
alter table operacion.punto_termino_conductor enable  row level security;
alter table operacion.punto_termino_conductor force   row level security;

drop policy if exists punto_termino_conductor_select on operacion.punto_termino_conductor;
create policy punto_termino_conductor_select
  on operacion.punto_termino_conductor
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'conductor'
    and conductor_id = identidad.claim_driver_id()
  );

comment on policy punto_termino_conductor_select on operacion.punto_termino_conductor is
  'SELECT solo para el propio conductor (tenant + tipo_usuario=conductor +
   conductor_id = claim_driver_id). SIN rama interno y SIN rama super_admin, a
   propósito: ver docs/seguridad/punto-de-termino-conductor.md §6.1. Hoy es
   INERTE porque authenticated no tiene ningún privilegio sobre la tabla; existe
   para el día en que alguien agregue una vista o un grant sin pensar.';

-- Sin política de INSERT/UPDATE/DELETE: escribe SOLO service_role. Bajo `force
-- row level security`, una tabla sin política de escritura rechaza toda
-- escritura de cualquier rol no-BYPASSRLS, incluido el dueño.

-- -----------------------------------------------------------------------------
-- Privilegios. CERO para roles de cliente: ni SELECT.
-- -----------------------------------------------------------------------------
-- `revoke all` cubre los privilegios que las default ACL pudieran regalar según
-- QUÉ ROL crea la tabla (en `public` conviven dos juegos de pg_default_acl, el
-- de `postgres` y el de `supabase_admin`, y el segundo sí incluye DML — ver
-- 20260813000002 §3). Aquí la tabla vive en `operacion`, donde hoy no hay
-- default ACL para roles de cliente, pero el revoke hace que el resultado no
-- dependa de ese detalle ni de por qué vía se aplique el esquema.
revoke all on operacion.punto_termino_conductor from authenticated, anon, public;

-- service_role: BYPASSRLS salta las políticas pero NO reemplaza el GRANT SQL.
grant usage on schema operacion to service_role;
grant select, insert, update, delete on operacion.punto_termino_conductor to service_role;

-- =============================================================================
-- 4. `finalidad` en operacion.consentimientos_ubicacion
-- =============================================================================
-- SE REUSA LA TABLA, NO EL REGISTRO. Son dos tratamientos distintos —dónde
-- estás durante el turno / dónde vives— y mezclarlos rompe en las DOS
-- direcciones: revocar el rastreo apagaría el punto de término sin que nadie lo
-- pidiera, y tener vigente el del rastreo se leería como permiso para guardar la
-- casa.
--
-- El `default` backfilea correctamente las filas existentes: todas son
-- consentimientos del rastreo en vivo (finalidad que hoy no tiene escritor —el
-- ping se retiró el 2026-08-14— pero cuyo histórico se conserva por
-- trazabilidad legal, Ley 21.431).
alter table operacion.consentimientos_ubicacion
  add column if not exists finalidad text not null default 'rastreo_en_ruta';

comment on column operacion.consentimientos_ubicacion.finalidad is
  'PARA QUÉ se otorgó el consentimiento. ''rastreo_en_ruta'' = posición durante
   el turno (finalidad histórica; su escritor se retiró el 2026-08-14).
   ''punto_termino_ruta'' = dónde termina la ruta, o sea el domicilio.
   ⚠️ Un consentimiento de una finalidad NO autoriza la otra, y esa regla vive en
   DOS mitades: este CHECK y el parámetro OBLIGATORIO (sin default en
   TypeScript) de tieneConsentimientoVigente/registrar/revocar en
   src/modules/operacion/consentimiento-ubicacion.ts. Un parámetro opcional
   dejaría compilar las llamadas viejas y el error aparecería en producción.';

-- ⚠️ LISTA DE CHECK: se repone ENTERA en cada migración que la toque, y hay que
-- copiar la VIGENTE DE LA BASE, nunca la de otra migración. Es la lección del
-- 2026-08-12 (dinero.eventos_conciliacion.tipo_diferencia perdió un valor sin
-- que nada fallara al migrar). Valores vigentes: 2.
alter table operacion.consentimientos_ubicacion
  drop constraint if exists consentimientos_ubicacion_finalidad_valida;
alter table operacion.consentimientos_ubicacion
  add constraint consentimientos_ubicacion_finalidad_valida
  check (finalidad in ('rastreo_en_ruta', 'punto_termino_ruta'));

-- El modelo "vigente" pasa a resolverse POR FINALIDAD:
--   … where tenant_id = ? and conductor_id = ? and finalidad = ?
--   order by otorgado_en desc limit 1
create index if not exists idx_consentimientos_ubicacion_vigente_finalidad
  on operacion.consentimientos_ubicacion (tenant_id, conductor_id, finalidad, otorgado_en desc);

-- Re-emitir la vista espejo para que recoja la columna nueva. `create or replace
-- view ... select *` la incorpora al final; los grants existentes persisten y
-- security_invoker se conserva. `finalidad` no es sensible (es una etiqueta de
-- propósito, no un dato personal), así que se expone junto al resto.
create or replace view public.consentimientos_ubicacion
  with (security_invoker = true)
  as select * from operacion.consentimientos_ubicacion;

comment on view public.consentimientos_ubicacion is
  'Espejo de operacion.consentimientos_ubicacion para PostgREST. RLS heredada
   (security_invoker = true): interno (su nómina) + el propio conductor. El
   SELLER NO accede. Escritura exclusiva de service_role. Incluye `finalidad`
   (rastreo_en_ruta | punto_termino_ruta): un consentimiento de una finalidad NO
   autoriza la otra.';

-- =============================================================================
-- 5. Aserción defensiva — la migración ABORTA si alguna barrera no quedó puesta
-- =============================================================================
-- No altera nada: inspecciona el catálogo y falla ruidosamente. Mismo patrón que
-- 20260813000002 §4 y 20260812000003 §3. Existe porque TODAS las barreras de
-- esta tabla son silenciosas cuando faltan: una tabla sin FORCE RLS se lee
-- normal, un grant de más no produce ningún error, una vista en `public` que
-- alguien cree "para depurar" tampoco, y un trigger de redondeo ausente guarda
-- la coordenada fina sin avisar.
do $$
declare
  privilegio text;
  rol        text;
  tgtipo     smallint;
begin
  -- 5.1 RLS activa Y FORZADA. `force` cubre también al dueño de la tabla.
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'operacion' and c.relname = 'punto_termino_conductor'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception
      'operacion.punto_termino_conductor no quedó con RLS enable + force.';
  end if;

  -- 5.2 CERO privilegios para roles de cliente. Es la barrera REAL de acceso
  --     directo: el esquema `operacion` está expuesto a PostgREST, así que un
  --     SELECT de más aquí abre la tabla al mundo autenticado del tenant.
  foreach rol in array array['authenticated', 'anon'] loop
    foreach privilegio in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege(rol, 'operacion.punto_termino_conductor', privilegio) then
        raise exception
          'El rol % conserva % sobre operacion.punto_termino_conductor. Esta tabla no admite NINGÚN privilegio de cliente: la app Expo entra por rutas Bearer y la PWA por Server Actions, ambas con service_role.',
          rol, privilegio;
      end if;
    end loop;
  end loop;

  -- 5.3 NO existe relación espejo en `public`. Una vista ahí, aunque fuera
  --     security_invoker, reabriría el camino PostgREST que §6.1 cierra.
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'punto_termino_conductor'
  ) then
    raise exception
      'Existe public.punto_termino_conductor. El diseño NO lleva vista espejo: ningún cliente consulta esta tabla por PostgREST.';
  end if;

  -- 5.4 La política existe, es de SELECT y no menciona `interno` ni
  --     `super_admin`. Es una comprobación de TEXTO del `using`, a propósito:
  --     lo que hay que impedir es que alguien agregue esas ramas "para que el
  --     coordinador pueda ver el mapa completo".
  if not exists (
    select 1 from pg_policies
    where schemaname = 'operacion' and tablename = 'punto_termino_conductor'
      and policyname = 'punto_termino_conductor_select' and cmd = 'SELECT'
  ) then
    raise exception 'Falta la política punto_termino_conductor_select (SELECT).';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'operacion' and tablename = 'punto_termino_conductor'
      and (qual like '%interno%' or qual like '%super_admin%')
  ) then
    raise exception
      'La política de operacion.punto_termino_conductor menciona interno/super_admin. El punto de término lo ve SOLO su conductor: si el jefe puede ver quién declinó, el consentimiento de todos los demás deja de ser libre (Ley 21.431).';
  end if;

  -- 5.5 NO hay política de escritura. Sin esto, "escribe solo service_role" es
  --     una frase en un comentario.
  if exists (
    select 1 from pg_policies
    where schemaname = 'operacion' and tablename = 'punto_termino_conductor'
      and cmd <> 'SELECT'
  ) then
    raise exception
      'operacion.punto_termino_conductor tiene una política de escritura. La escritura es exclusiva de service_role.';
  end if;

  -- 5.6 El trigger de redondeo existe y cubre INSERT+UPDATE, BEFORE, POR FILA.
  --     Bits de pg_trigger.tgtype: 1=ROW, 2=BEFORE, 4=INSERT, 8=DELETE, 16=UPDATE.
  select t.tgtype into tgtipo
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'operacion' and c.relname = 'punto_termino_conductor'
     and t.tgname = 'trg_punto_termino_conductor_redondear'
     and not t.tgisinternal;

  if tgtipo is null then
    raise exception
      'Falta trg_punto_termino_conductor_redondear. Sin él se persiste la coordenada FINA del domicilio de un trabajador, y no falla nada: se nota el día que alguien mire la fila.';
  end if;
  if (tgtipo & 20) <> 20 or (tgtipo & 2) <> 2 or (tgtipo & 1) <> 1 then
    raise exception
      'trg_punto_termino_conductor_redondear no es BEFORE INSERT OR UPDATE FOR EACH ROW (tgtype=%). Un trigger solo-INSERT deja pasar la coordenada fina en cada redefinición del punto.', tgtipo;
  end if;

  -- 5.7 `finalidad` con su CHECK. Sin el CHECK, un typo crea una finalidad
  --     nueva que no autoriza nada y no falla en ninguna parte.
  if not exists (
    select 1 from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'operacion' and c.relname = 'consentimientos_ubicacion'
      and con.conname = 'consentimientos_ubicacion_finalidad_valida'
  ) then
    raise exception
      'Falta el CHECK consentimientos_ubicacion_finalidad_valida.';
  end if;

  -- 5.8 service_role sí puede escribir: es el único que escribe.
  foreach privilegio in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('service_role', 'operacion.punto_termino_conductor', privilegio) then
      raise exception
        'service_role no tiene % sobre operacion.punto_termino_conductor: los caminos de escritura (Server Action y ruta Bearer) quedarían muertos.',
        privilegio;
    end if;
  end loop;
end $$;

-- =============================================================================
-- 6. Handoff — lo que esta migración NO puede imponer y hay que sostener arriba
-- =============================================================================
--   `backend` / quien construya el ruteo (etapa 7):
--     · UN SOLO LECTOR del ancla: obtenerAnclaFinRuta() en
--       src/modules/operacion/punto-termino-conductor.ts. El solver la recibe
--       como PARÁMETRO y devuelve EL ORDEN de las paradas, no los nodos.
--     · El tipo de la ruta que sale hacia app/** no debe tener un campo donde
--       quepa una coordenada de término. Si lo tiene, la fuga es cuestión de
--       tiempo: el solver corre con service_role y RLS no lo detiene.
--     · Totales de distancia/duración y ETA: de bodega a ÚLTIMA PARADA. Incluir
--       el tramo a casa es una fuga silenciosa y ARITMÉTICA — comparar dos
--       conductores con las mismas paradas revela quién tiene ancla y a qué
--       distancia.
--
--   `frontend` (cuando exista la pantalla):
--     · El coordinador no ve NADA: ni coordenada, ni comuna, ni un indicio de
--       que exista. Ni badge, ni campo vacío, ni tooltip, ni orden distinto.
--     · La polilínea termina en la última parada; el fitBounds se calcula SOLO
--       sobre las paradas (un encuadre que incluya el ancla delata el sector
--       aunque el punto no se pinte).
--     · La app del conductor SÍ muestra su punto: es suyo, y es el único lugar.
--     · Revocar: un control visible, UN TOQUE, sin confirmación en cadena y sin
--       preguntar por qué. Un consentimiento que no se puede retirar no es
--       consentimiento (fue el hallazgo H-3 del rastreo retirado).
--     · NO se ofrece "usar mi última ubicación conocida": eso convierte el
--       rastreo del turno en captura de domicilio.
--
--   `copywriter`:
--     · Texto de consentimiento propio, y hay que SUBIR
--       VERSION_TEXTO_CONSENTIMIENTO_UBICACION. Contenido obligatorio en §5.2
--       del documento, incluido el residuo del §4.4 dicho con todas sus letras:
--       "Tu jefe no va a ver tu dirección ni el punto que marcaste. Lo que sí va
--       a notar, con el tiempo, es que tus rutas tienden a terminar por tu
--       sector."
-- =============================================================================
