-- =============================================================================
-- Migración · Torre de control (F1) — schema `contexto`, RLS y bucket de mapas
-- =============================================================================
-- Cimiento de datos del módulo de anticipación operativa (Torre de control).
-- Diseño técnico: docs/arquitectura/torre-de-control.md (§5 modelo de datos,
-- §6 jobs, §7 motor de riesgo, §12 calendario comercial, §13 señales).
-- Contrato de salida congelado: docs/torre-de-control/datos-dummy.ts.
--
-- Crea 11 tablas en dos posturas de seguridad DISTINTAS y deliberadas:
--
--   A) 8 tablas GLOBALES (sin tenant_id) — DENY-ALL, calcado del schema `infra`:
--      clima_horario · aire_horario · eventos_ciudad · calendario ·
--      eventos_comerciales · restriccion_vehicular · senales · fuentes_estado
--      RLS enable+force SIN políticas · REVOKE ALL a public/anon/authenticated ·
--      GRANT solo a service_role · SIN vista espejo en `public`.
--
--   B) 3 tablas POR TENANT — tratamiento completo estilo `identidad.zonas`:
--      riesgo_zona · marcas_operativas · senales_tenant
--      tenant_id + RLS P1-interno (select/insert/update/delete) + vista espejo
--      en `public` con security_invoker + guard `solo_interno_edita` +
--      FK COMPUESTA (tenant_id, zona_id) → identidad.zonas (tenant_id, id).
--      Seller y conductor: 0 filas (configuración operativa interna del courier).
--
-- -----------------------------------------------------------------------------
-- EXCEPCIÓN DOCUMENTADA a "toda tabla de negocio lleva tenant_id" (CLAUDE.md)
-- -----------------------------------------------------------------------------
-- Las 8 tablas globales son datos de REFERENCIA PÚBLICA, no de negocio. El
-- carve-out se sostiene sobre TRES condiciones que se verifican tabla por tabla
-- (y que quedan escritas en el COMMENT ON TABLE de cada una):
--   (a) su contenido es público y NO contiene ni un dato de courier, seller,
--       conductor ni destinatario;
--   (b) su cardinalidad NO cambia al dar de alta un tenant (el clima de Santiago
--       es el mismo para todos los couriers);
--   (c) solo `service_role` escribe (los jobs de ingesta de §6).
-- Si una tabla futura de `contexto` rompe cualquiera de las tres, NO va aquí:
-- lleva tenant_id y RLS por tenant.
--
-- §5 del diseño proponía "SELECT para cualquier usuario autenticado" en las
-- globales. NO SE IMPLEMENTA ASÍ, a propósito y con criterio más estricto: en
-- este repo `authenticated` incluye seller y conductor
-- (identidad.claim_tipo_usuario() → interno|seller|conductor|super_admin), de
-- modo que una política "para authenticated" abriría `contexto.*` al portal del
-- seller vía PostgREST. Las globales van DENY-ALL. El composer del módulo lee
-- con crearClienteServiceRole(), que es lo que ya hace todo el camino de lectura
-- del producto.
--
-- Cuatro cerrojos INDEPENDIENTES protegen las globales (defensa en profundidad):
--   1. `contexto` NO se agrega a config.toml → PostgREST no puede direccionarlo
--      (ni siquiera con el header `Accept-Profile: contexto`).
--   2. CERO privilegios de tabla (y de columna) para public/anon/authenticated.
--   3. RLS enable + force SIN políticas → deny-by-default aunque alguien otorgue
--      un GRANT por descuido.
--   4. SIN vista espejo en `public` → nada de ellas es alcanzable por el schema
--      que sí está expuesto.
--
-- DESVIACIÓN CONSCIENTE respecto de `infra`: `infra` revoca hasta el USAGE de
-- schema a authenticated. Aquí NO se puede hacer lo mismo, porque las 3 tablas
-- POR TENANT viven en el mismo schema `contexto` y sus vistas espejo son
-- `security_invoker = true`: el invocador necesita USAGE sobre `contexto` para
-- que la vista resuelva la tabla base. Se otorga USAGE a `authenticated` y
-- `service_role` únicamente (nunca a `anon` ni a `public`). USAGE de schema no
-- concede lectura de nada: sin privilegio de tabla el SELECT falla igual con
-- 42501, y los cerrojos 1, 3 y 4 siguen intactos. La prueba pgTAP
-- `rls_aislamiento_torre_contexto.test.sql` lo verifica de forma explícita.
--
-- -----------------------------------------------------------------------------
-- ZONA HORARIA — el módulo entero es sensible a fecha
-- -----------------------------------------------------------------------------
--   · Toda columna `fecha` es `date` en CALENDARIO DE SANTIAGO (no UTC).
--   · Toda ventana/instante es `timestamptz`.
--   · NADA de `time without time zone` para las franjas: la franja es un enum
--     cerrado (manana 08–12 · tarde 12–17 · punta 17–21, hora local Santiago).
--   · Se publican dos helpers (contexto.fecha_santiago / contexto.franja_de)
--     para que nadie tenga que re-derivar la fecha local a mano. Sus equivalentes
--     de aplicación viven en src/lib/fecha-santiago.ts — nunca toISOString().
--
-- -----------------------------------------------------------------------------
-- TABLAS DIFERIDAS A PROPÓSITO (la omisión es deliberada, no un olvido)
-- -----------------------------------------------------------------------------
--   · contexto.transito_incidentes — F2 (capa de tránsito en vivo, TomTom).
--   · contexto.olas_historicas     — F3 (aprendizaje proyectado vs. real por
--                                    tenant; §12.5). Lleva tenant_id cuando se
--                                    cree: es dato del courier, NO global.
--
-- Idempotente: create schema/table/index if not exists, DO-blocks para tipos y
-- constraints, create or replace view/function, drop trigger if exists + create,
-- insert ... on conflict. Re-aplicable sobre una base ya migrada.
-- =============================================================================

-- =============================================================================
-- 1. Schema contexto
-- =============================================================================
create schema if not exists contexto;

comment on schema contexto is
  'Torre de control — señal externa (clima, aire, eventos, calendario, señales de
   prensa) y su cruce con la carga interna del courier. Contiene DOS clases de
   tabla: (a) globales sin tenant_id, deny-all, escritas solo por service_role —
   excepción documentada a "toda tabla de negocio lleva tenant_id" porque son
   datos de referencia pública cuya cardinalidad no depende de los tenants; y
   (b) tablas por tenant (riesgo_zona, marcas_operativas, senales_tenant) con RLS
   P1-interno y vista espejo en public. El schema NO se expone a PostgREST
   (config.toml): la superficie pública son solo las vistas de (b).';

-- =============================================================================
-- 2. Tipos enumerados
--    DO-blocks idempotentes (el repo no usa `create type if not exists`).
-- =============================================================================

-- contexto.nivel_aire → tipo `NivelAire` del contrato congelado.
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'nivel_aire' and n.nspname = 'contexto'
  ) then
    create type contexto.nivel_aire as enum (
      'bueno', 'regular', 'alerta', 'preemergencia', 'emergencia'
    );
  end if;
end $$;

-- contexto.tipo_evento_ciudad → `EventoCiudad.tipo`.
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'tipo_evento_ciudad' and n.nspname = 'contexto'
  ) then
    create type contexto.tipo_evento_ciudad as enum (
      'deportivo', 'masivo', 'civico', 'comercial'
    );
  end if;
end $$;

-- contexto.arquetipo_ola → `ArquetipoOla`. venta = la ola llega DESPUÉS (D+1..D+5);
-- regalo = la ola llega ANTES y el plazo es duro (§12.1).
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'arquetipo_ola' and n.nspname = 'contexto'
  ) then
    create type contexto.arquetipo_ola as enum ('venta', 'regalo');
  end if;
end $$;

-- contexto.tipo_restriccion → `RestriccionVehicular.tipo`.
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'tipo_restriccion' and n.nspname = 'contexto'
  ) then
    create type contexto.tipo_restriccion as enum (
      'permanente', 'preemergencia', 'emergencia'
    );
  end if;
end $$;

-- contexto.tipo_senal → `Senal.tipo`.
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'tipo_senal' and n.nspname = 'contexto'
  ) then
    create type contexto.tipo_senal as enum (
      'corte_transito', 'manifestacion', 'paro', 'emergencia', 'transporte', 'otro'
    );
  end if;
end $$;

-- contexto.severidad → `Severidad` del contrato (independiente del puntaje de zona).
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'severidad' and n.nspname = 'contexto'
  ) then
    create type contexto.severidad as enum (
      'critica', 'alta', 'media', 'informativa'
    );
  end if;
end $$;

-- contexto.clasificacion_estado → soporta la DEGRADACIÓN de §13.6: si el LLM
-- clasificador falla o no responde, la señal queda 'fallida' y la noticia cruda
-- vive en la lista secundaria "sin clasificar". El módulo nunca se cae por esto.
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'clasificacion_estado' and n.nspname = 'contexto'
  ) then
    create type contexto.clasificacion_estado as enum (
      'pendiente', 'clasificada', 'fallida'
    );
  end if;
end $$;

-- contexto.estado_fuente → `EstadoFuente` del contrato.
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'estado_fuente' and n.nspname = 'contexto'
  ) then
    create type contexto.estado_fuente as enum ('ok', 'atrasada', 'caida');
  end if;
end $$;

-- contexto.franja — franja horaria del motor de riesgo. ENUM CERRADO en hora
-- LOCAL de Santiago: manana 08–12 · tarde 12–17 · punta 17–21. Tres filas por
-- zona por día, NO una grilla horaria. Nunca `time without time zone`.
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'franja' and n.nspname = 'contexto'
  ) then
    create type contexto.franja as enum ('manana', 'tarde', 'punta');
  end if;
end $$;

-- contexto.marca_humana → `Senal.marcaHumana`. NULL (ausencia de valor) = sin marcar.
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'marca_humana' and n.nspname = 'contexto'
  ) then
    create type contexto.marca_humana as enum ('confirmada', 'descartada');
  end if;
end $$;

-- =============================================================================
-- 3. Helpers de fecha/franja en calendario de Santiago
-- -----------------------------------------------------------------------------
-- El módulo entero es sensible a fecha: el bug conocido del proyecto (usar
-- toISOString(), que es UTC) no vaciaría una tabla aquí — mostraría el clima del
-- día equivocado a partir de las 20:00. Estos helpers existen para que el
-- esquema NO obligue a nadie a re-derivar la fecha local a mano en SQL.
-- Equivalentes de aplicación: src/lib/fecha-santiago.ts.
-- =============================================================================
create or replace function contexto.fecha_santiago(p_instante timestamptz)
returns date
language sql
stable
as $$
  select (p_instante at time zone 'America/Santiago')::date
$$;

comment on function contexto.fecha_santiago(timestamptz) is
  'Fecha de CALENDARIO de Santiago para un instante. Es la conversión canónica
   para poblar/consultar las columnas `fecha` de contexto (date en calendario
   local, nunca UTC). Equivalente SQL de fechaLocalEnSantiago() en
   src/lib/fecha-santiago.ts.';

create or replace function contexto.franja_de(p_instante timestamptz)
returns contexto.franja
language sql
stable
as $$
  select case
    when extract(hour from (p_instante at time zone 'America/Santiago')) >= 17 then 'punta'
    when extract(hour from (p_instante at time zone 'America/Santiago')) >= 12 then 'tarde'
    else 'manana'
  end::contexto.franja
$$;

comment on function contexto.franja_de(timestamptz) is
  'Franja horaria del motor de riesgo para un instante, en hora LOCAL de Santiago:
   manana (<12) · tarde (12–16:59) · punta (>=17). Fuera del rango operativo
   08–21 la función sigue devolviendo la franja del extremo más cercano (antes de
   las 08 → manana; después de las 21 → punta): el llamador decide si esa hora
   cae dentro de su ventana de reparto.';

grant execute on function contexto.fecha_santiago(timestamptz) to authenticated, service_role;
grant execute on function contexto.franja_de(timestamptz)      to authenticated, service_role;

-- =============================================================================
-- =============================================================================
-- BLOQUE A · TABLAS GLOBALES (sin tenant_id) — DENY-ALL
-- =============================================================================
-- =============================================================================

-- =============================================================================
-- A.1 contexto.clima_horario — pronóstico horario por comuna
-- =============================================================================
create table if not exists contexto.clima_horario (
  -- Comuna de la RM. `text` y NO enum: el catálogo canónico vive en la app
  -- (src/lib/ui/comunas-rm.ts) — mismo criterio que identidad.zona_comunas.comuna.
  comuna              text        not null,

  -- Instante de la hora pronosticada (timestamptz, UTC en disco). Se interpreta
  -- en Santiago con `at time zone 'America/Santiago'` — nunca con toISOString().
  hora                timestamptz not null,

  precipitacion_mm    numeric(6,2) check (precipitacion_mm >= 0),
  prob_precipitacion  smallint     check (prob_precipitacion between 0 and 100),
  viento_kmh          numeric(6,2) check (viento_kmh >= 0),
  temp_c              numeric(5,2),

  actualizado_en      timestamptz not null default now(),

  constraint clima_horario_pk primary key (comuna, hora)
);

comment on table contexto.clima_horario is
  'Pronóstico horario de Open-Meteo por comuna de la RM (job contexto/clima.refrescar,
   cada 60 min). GLOBAL SIN tenant_id — excepción documentada que cumple las tres
   condiciones del carve-out: (a) contenido público, sin ni un dato de courier,
   seller, conductor ni destinatario; (b) su cardinalidad no cambia al dar de alta
   un tenant (el clima de Santiago es el mismo para todos los couriers); (c) solo
   service_role escribe. DENY-ALL: RLS enable+force SIN políticas + cero grants a
   public/anon/authenticated + SIN vista espejo en public. Se lee con
   crearClienteServiceRole() desde el composer del módulo.';

-- El PK (comuna, hora) ya sirve el lookup por comuna. El índice por `hora` sirve
-- la lectura por VENTANA sobre las 52 comunas a la vez, que es lo que hace el
-- composer (una sola pasada Hoy/Mañana/72 h).
create index if not exists idx_clima_horario_hora on contexto.clima_horario (hora);

-- =============================================================================
-- A.2 contexto.aire_horario — calidad del aire horaria por comuna
-- =============================================================================
create table if not exists contexto.aire_horario (
  comuna          text        not null,
  hora            timestamptz not null,

  pm25            numeric(6,2) check (pm25 >= 0),
  pm10            numeric(6,2) check (pm10 >= 0),

  -- Nivel derivado del PM2.5 contra los umbrales del GEC. Es el tipo `NivelAire`
  -- del contrato congelado.
  nivel_estimado  contexto.nivel_aire not null,

  actualizado_en  timestamptz not null default now(),

  constraint aire_horario_pk primary key (comuna, hora)
);

comment on table contexto.aire_horario is
  'Pronóstico horario de calidad del aire (Open-Meteo Air Quality) por comuna
   (job contexto/aire.refrescar, cada 60 min). GLOBAL SIN tenant_id — cumple las
   tres condiciones del carve-out: (a) contenido público, sin dato de courier,
   seller, conductor ni destinatario; (b) cardinalidad independiente del alta de
   tenants; (c) solo service_role escribe. DENY-ALL (RLS force sin políticas +
   sin grants + sin vista en public). El tipo PronosticoAire del contrato
   (fecha, pm25Maximo, nivel, esProyeccion) se DERIVA agregando estas filas por
   fecha de Santiago — no se almacena.';

create index if not exists idx_aire_horario_hora on contexto.aire_horario (hora);

-- =============================================================================
-- A.3 contexto.eventos_ciudad — eventos masivos con radio de influencia
-- =============================================================================
create table if not exists contexto.eventos_ciudad (
  id                  uuid primary key default gen_random_uuid(),

  nombre              text not null,
  tipo                contexto.tipo_evento_ciudad not null,
  recinto             text not null,
  comuna              text not null,

  -- Punto del recinto. `EventoCiudad.posicion` del contrato = { lat, long }.
  lat                 double precision not null check (lat between -90 and 90),
  long                double precision not null check (long between -180 and 180),

  -- Radio de influencia en metros → `EventoCiudad.radioMetros`.
  radio_m             integer not null check (radio_m > 0),

  -- `EventoCiudad.ventana`. fin NULL = en curso / sin término conocido.
  ventana_inicio      timestamptz not null,
  ventana_fin         timestamptz,

  asistencia_estimada integer check (asistencia_estimada >= 0),
  fuente              text not null,

  actualizado_en      timestamptz not null default now(),
  creado_en           timestamptz not null default now(),

  constraint eventos_ciudad_ventana_coherente
    check (ventana_fin is null or ventana_fin >= ventana_inicio)
);

comment on table contexto.eventos_ciudad is
  'Eventos masivos de la ciudad (partidos, conciertos, actos) con su radio de
   influencia (job contexto/eventos.sincronizar, 1×/día 05:00). GLOBAL SIN
   tenant_id — cumple las tres condiciones del carve-out: (a) es agenda pública
   de la ciudad, sin dato de courier, seller, conductor ni destinatario;
   (b) su cardinalidad no cambia al dar de alta un tenant; (c) solo service_role
   escribe. DENY-ALL. `asistencia_estimada` es nullable a propósito: el contrato
   la declara `number | null`.';

-- Idempotencia del job diario SIN inventar una columna de dedup: el mismo evento
-- de la misma fuente en la misma ventana es una sola fila (on conflict do update).
create unique index if not exists idx_eventos_ciudad_dedup
  on contexto.eventos_ciudad (fuente, nombre, ventana_inicio);

-- Lectura por ventana (Hoy / Mañana / 72 h).
create index if not exists idx_eventos_ciudad_ventana
  on contexto.eventos_ciudad (ventana_inicio, ventana_fin);

-- =============================================================================
-- A.4 contexto.calendario — feriados y fechas cívicas
-- =============================================================================
create table if not exists contexto.calendario (
  -- Fecha en CALENDARIO DE SANTIAGO (date, nunca derivada de UTC).
  fecha          date    not null,
  nombre         text    not null,

  -- `tipo` es text SIN check a propósito: los valores los fija la fuente
  -- (api.boostr.cl devuelve "Civil" / "Religioso") y el calendario cívico
  -- estático del repo agrega los suyos. Un enum obligaría a migrar la BD cada
  -- vez que una fuente cambie una etiqueta. NOTA: `contexto.calendario` NO tiene
  -- contraparte en datos-dummy.ts — no hay contrato congelado que respetar aquí.
  tipo           text    not null,

  irrenunciable  boolean not null default false,

  actualizado_en timestamptz not null default now(),

  -- Una misma fecha puede tener más de una efeméride (feriado + fecha cívica).
  constraint calendario_pk primary key (fecha, nombre)
);

comment on table contexto.calendario is
  'Feriados y fechas cívicas de Chile (job contexto/calendario.sincronizar, 1×/mes;
   fuente api.boostr.cl + tabla cívica estática del repo). GLOBAL SIN tenant_id —
   cumple las tres condiciones del carve-out: (a) es calendario público del país,
   sin dato de courier, seller, conductor ni destinatario; (b) su cardinalidad no
   cambia al dar de alta un tenant; (c) solo service_role escribe. DENY-ALL.
   `fecha` es date en calendario de Santiago. `irrenunciable` marca el feriado
   irrenunciable (afecta si se puede repartir). El API oficial del Estado
   (apis.digital.gob.cl) está caído — no usarlo (§4).';

-- =============================================================================
-- A.5 contexto.eventos_comerciales — el calendario comercial chileno (§12)
-- =============================================================================
create table if not exists contexto.eventos_comerciales (
  -- Slug estable mantenido a mano en el repo ('cyberday-2026'). Es el `id` del
  -- tipo EventoComercial del contrato congelado, y el punto de upsert idempotente
  -- del catálogo. Las fechas Cyber las fija la CCS con pocas semanas de aviso: se
  -- revisan cada temporada a mano, sin scraper (§12.2).
  id                 text primary key,

  nombre             text not null,
  arquetipo          contexto.arquetipo_ola not null,
  organizador        text,

  -- Fechas del evento comercial en calendario de Santiago (date, no timestamptz:
  -- el contrato las expresa como '2026-06-01').
  inicio             date not null,
  fin                date not null,

  -- Multiplicador de volumen sobre la línea base del tenant.
  multiplicador_base numeric(5,2) not null check (multiplicador_base > 0),

  -- Distribución del rezago: { "1": 0.20, "2": 0.30, ... } para 'venta';
  -- offsets NEGATIVOS ({ "-3": 0.30, ... }) para 'regalo' (la ola llega antes).
  curva_rezago       jsonb not null default '{}'::jsonb
                       check (jsonb_typeof(curva_rezago) = 'object'),

  actualizado_en     timestamptz not null default now(),

  constraint eventos_comerciales_rango_coherente check (fin >= inicio)
);

comment on table contexto.eventos_comerciales is
  'Catálogo comercial chileno (CyberDay, Black Friday, Día de la Madre…) con su
   arquetipo y su curva de rezago (§12). GLOBAL SIN tenant_id — cumple las tres
   condiciones del carve-out: (a) son fechas comerciales públicas del país, sin
   dato de courier, seller, conductor ni destinatario; (b) su cardinalidad no
   cambia al dar de alta un tenant; (c) solo service_role escribe (catálogo
   mantenido a mano en el repo). DENY-ALL. El tipo OlaEntrante del contrato
   (curva, hitos, brechaConductores, fechaLimiteCompraPorZona) NO se almacena: se
   PROYECTA por tenant en el composer cruzando este catálogo con el volumen base
   del courier. El aprendizaje proyectado-vs-real (contexto.olas_historicas, §12.5)
   es F3 y llevará tenant_id.';

create index if not exists idx_eventos_comerciales_rango
  on contexto.eventos_comerciales (inicio, fin);

-- =============================================================================
-- A.6 contexto.restriccion_vehicular — restricción por dígito (GEC + episodios)
-- =============================================================================
create table if not exists contexto.restriccion_vehicular (
  -- Fecha en calendario de Santiago.
  fecha    date not null,
  tipo     contexto.tipo_restriccion not null,

  -- Dígitos restringidos. int[] (0–9). La restricción permanente del GEC es
  -- determinística (se calcula, no se consulta); la extraordinaria sale del feed
  -- del MMA (§4).
  digitos  integer[] not null default '{}'::integer[]
             check (digitos <@ array[0,1,2,3,4,5,6,7,8,9]),

  alcance  text not null,

  actualizado_en timestamptz not null default now(),

  constraint restriccion_vehicular_pk primary key (fecha, tipo)
);

comment on table contexto.restriccion_vehicular is
  'Restricción vehicular por dígito de patente: permanente (GEC, determinística)
   y extraordinaria por episodio (preemergencia/emergencia, feed del MMA).
   GLOBAL SIN tenant_id — cumple las tres condiciones del carve-out: (a) es un
   decreto público, sin dato de courier, seller, conductor ni destinatario; (b) su
   cardinalidad no cambia al dar de alta un tenant; (c) solo service_role escribe.
   DENY-ALL. NO existe columna `vehiculos_afectados`: el modelo de datos NO guarda
   patentes de la flota (§10 y §6 de estructura.md), por eso el contrato expone
   RestriccionVehicular.vehiculosAfectados como null. Cuando se agregue la entidad
   vehículo (F3), ese conteo será POR TENANT y NO puede vivir en esta tabla.';

-- =============================================================================
-- A.7 contexto.senales — parte GLOBAL del acontecimiento (radar de prensa, §13)
-- -----------------------------------------------------------------------------
-- DESDOBLAMIENTO DELIBERADO del tipo `Senal` del contrato. El tipo mezcla el
-- ACONTECIMIENTO (público: título, comunas, ventana, fuentes) con TRES campos que
-- son del courier: pedidosEnRango, zonasAfectadas y marcaHumana. Guardarlos aquí
-- dejaría el VOLUMEN DE PEDIDOS de un courier visible en una fila que leen todos
-- los demás — una fuga entre tenants. Esos tres campos viven en
-- contexto.senales_tenant (bloque B). El composer une ambas para producir `Senal`.
-- =============================================================================
create table if not exists contexto.senales (
  id                   uuid primary key default gen_random_uuid(),

  -- Título del ACONTECIMIENTO, no del artículo: una tarjeta por evento, nunca
  -- por medio (§13.4 paso 6).
  titulo               text not null,
  resumen              text not null,
  tipo                 contexto.tipo_senal not null,

  comunas              text[] not null default '{}'::text[],
  ejes_viales          text[] not null default '{}'::text[],

  -- `Senal.ventana` es `Ventana | null` → ambas columnas nullable.
  -- ventana_fin NULL con ventana_inicio presente = EN CURSO, sin término conocido
  -- (la UI lo resuelve como "desde las 08:05" en vez de un rango cerrado).
  ventana_inicio       timestamptz,
  ventana_fin          timestamptz,

  severidad            contexto.severidad not null,

  -- 0–1. Sube cuando varios medios independientes reportan lo mismo.
  confianza            numeric(3,2) not null default 0
                         check (confianza >= 0 and confianza <= 1),

  afecta_operacion     boolean not null default false,

  -- Array de FuenteSenal: [{ medio, titular, url, publicadoEn }, ...].
  fuentes              jsonb not null default '[]'::jsonb
                         check (jsonb_typeof(fuentes) = 'array'),

  -- Degradación de §13.6: si el clasificador LLM falla, la señal queda 'fallida'
  -- y la noticia cruda va a la lista secundaria "sin clasificar". Nunca se cae.
  clasificacion_estado contexto.clasificacion_estado not null default 'pendiente',

  -- Deduplicación EN LA BD (§13.4 paso 2: "sin este paso el riel es basura").
  -- Título normalizado + ventana temporal, hasheado por el job. El UNIQUE deja
  -- que el job de ingesta haga `on conflict (hash_dedup) do nothing/update`, que
  -- es lo que lo vuelve idempotente con reintentos.
  hash_dedup           text not null,

  detectada_en         timestamptz not null default now(),
  actualizado_en       timestamptz not null default now(),

  constraint senales_hash_dedup_uk unique (hash_dedup),
  constraint senales_ventana_coherente
    check (
      (ventana_inicio is not null or ventana_fin is null)
      and (ventana_fin is null or ventana_fin >= ventana_inicio)
    )
);

comment on table contexto.senales is
  'Parte GLOBAL del acontecimiento detectado en prensa (Google News RSS + GDELT +
   RSS oficiales; §13). Una fila por ACONTECIMIENTO, no por artículo. GLOBAL SIN
   tenant_id — cumple las tres condiciones del carve-out: (a) son noticias
   públicas, sin ni un dato de courier, seller, conductor ni destinatario (y por
   eso el gate de IA se cumple: al LLM nunca se le pasa un destinatario ni un
   token); (b) su cardinalidad no cambia al dar de alta un tenant; (c) solo
   service_role escribe. DENY-ALL.
   DESDOBLAMIENTO: el tipo `Senal` del contrato incluye pedidosEnRango,
   zonasAfectadas y marcaHumana, que son DEL COURIER — guardarlos aquí filtraría
   el volumen de pedidos de un tenant a todos los demás. Viven en
   contexto.senales_tenant. hash_dedup con UNIQUE: la deduplicación se impone en
   la BD para que el job de ingesta sea idempotente (on conflict).';

create index if not exists idx_senales_ventana on contexto.senales (ventana_inicio, ventana_fin);
create index if not exists idx_senales_detectada on contexto.senales (detectada_en desc);
-- Barrido del clasificador: lo que quedó pendiente o falló (degradación §13.6).
create index if not exists idx_senales_sin_clasificar
  on contexto.senales (detectada_en)
  where clasificacion_estado <> 'clasificada';
-- Filtro de relevancia: solo entran al riel las que afectan la operación.
create index if not exists idx_senales_afecta_operacion
  on contexto.senales (ventana_inicio)
  where afecta_operacion = true;

-- =============================================================================
-- A.8 contexto.fuentes_estado — frescura y salud por fuente (`FrescuraFuente`)
-- =============================================================================
create table if not exists contexto.fuentes_estado (
  -- Las cinco fuentes del contrato congelado (FRESCURA_FUENTES).
  id               text primary key
                     check (id in ('clima', 'aire', 'transito', 'eventos', 'senales')),

  nombre           text not null,

  -- Última actualización EXITOSA. NULL mientras la fuente nunca haya corrido con
  -- éxito (ver nota de contrato en el COMMENT).
  actualizado_en   timestamptz,

  cadencia_minutos integer not null check (cadencia_minutos > 0),

  estado           contexto.estado_fuente not null default 'caida',

  -- Texto REDACTADO para el usuario final, no el error crudo del job. Presente
  -- solo si estado <> 'ok'.
  motivo           text,

  registrado_en    timestamptz not null default now(),

  constraint fuentes_estado_motivo_coherente
    check (estado = 'ok' or motivo is not null)
);

comment on table contexto.fuentes_estado is
  'Frescura y salud de cada fuente externa del módulo — alimenta FrescuraFuente
   del contrato (edadMinutos se DERIVA de now() - actualizado_en en el composer,
   no se almacena). GLOBAL SIN tenant_id — cumple las tres condiciones del
   carve-out: (a) es el estado de un feed público, sin dato de courier, seller,
   conductor ni destinatario; (b) su cardinalidad es fija (5 filas) y no cambia al
   dar de alta un tenant; (c) solo service_role escribe. DENY-ALL.
   NO se deriva de infra.ejecuciones_job a propósito, por dos razones: `infra` es
   deny-all de super-admin y este dato lo consume un COURIER; y `motivo` es texto
   redactado para el usuario final ("El proveedor respondió con error en los
   últimos 3 intentos."), no el error crudo del job.
   DESAJUSTE CONOCIDO con el contrato: FrescuraFuente.actualizadoEn es
   NON-NULLABLE, pero una fuente que nunca corrió no tiene última actualización
   exitosa. La columna es nullable y el composer decide cómo presentarlo.';

-- Semilla de las 5 fuentes: la pantalla siempre muestra las cinco, incluso antes
-- del primer ciclo de jobs (regla de producto: una fuente nunca desaparece en
-- silencio, se marca). Nombres y cadencias tomados literalmente del contrato
-- congelado (FRESCURA_FUENTES) y de la tabla de jobs de §6.
-- `motivo` es copy provisional: la redacción final es competencia de copywriter.
insert into contexto.fuentes_estado (id, nombre, actualizado_en, cadencia_minutos, estado, motivo)
values
  ('clima',    'Clima',                null,   60, 'caida', 'Todavía no se ejecuta la primera actualización.'),
  ('aire',     'Calidad del aire',     null,   60, 'caida', 'Todavía no se ejecuta la primera actualización.'),
  ('transito', 'Tránsito',             null,   10, 'caida', 'La capa de tránsito se habilita en una entrega posterior.'),
  ('eventos',  'Eventos de la ciudad', null, 1440, 'caida', 'Todavía no se ejecuta la primera actualización.'),
  ('senales',  'Señales de prensa',    null,   30, 'caida', 'Todavía no se ejecuta la primera actualización.')
on conflict (id) do nothing;

-- =============================================================================
-- A.9 SEGURIDAD DE LAS 8 GLOBALES — deny-all (calcado del schema `infra`)
-- -----------------------------------------------------------------------------
-- RLS enable + force SIN NINGUNA POLÍTICA. No se crean políticas a propósito:
-- deny-by-default real. Solo BYPASSRLS (service_role / definer) accede.
-- =============================================================================
alter table contexto.clima_horario         enable row level security;
alter table contexto.clima_horario         force  row level security;
alter table contexto.aire_horario          enable row level security;
alter table contexto.aire_horario          force  row level security;
alter table contexto.eventos_ciudad        enable row level security;
alter table contexto.eventos_ciudad        force  row level security;
alter table contexto.calendario            enable row level security;
alter table contexto.calendario            force  row level security;
alter table contexto.eventos_comerciales   enable row level security;
alter table contexto.eventos_comerciales   force  row level security;
alter table contexto.restriccion_vehicular enable row level security;
alter table contexto.restriccion_vehicular force  row level security;
alter table contexto.senales               enable row level security;
alter table contexto.senales               force  row level security;
alter table contexto.fuentes_estado        enable row level security;
alter table contexto.fuentes_estado        force  row level security;

-- Cero privilegios de tabla para los roles de PostgREST. `revoke all` cubre
-- también los privilegios de COLUMNA: el gotcha verificado del repo (un GRANT de
-- tabla completa filtró una columna nueva vía Accept-Profile pese a existir una
-- vista restringida) se cierra aquí de raíz — estas tablas no tienen NI vista NI
-- grant, y la prueba pgTAP lo verifica columna por columna.
revoke all on contexto.clima_horario         from public, anon, authenticated;
revoke all on contexto.aire_horario          from public, anon, authenticated;
revoke all on contexto.eventos_ciudad        from public, anon, authenticated;
revoke all on contexto.calendario            from public, anon, authenticated;
revoke all on contexto.eventos_comerciales   from public, anon, authenticated;
revoke all on contexto.restriccion_vehicular from public, anon, authenticated;
revoke all on contexto.senales               from public, anon, authenticated;
revoke all on contexto.fuentes_estado        from public, anon, authenticated;

grant select, insert, update, delete on contexto.clima_horario         to service_role;
grant select, insert, update, delete on contexto.aire_horario          to service_role;
grant select, insert, update, delete on contexto.eventos_ciudad        to service_role;
grant select, insert, update, delete on contexto.calendario            to service_role;
grant select, insert, update, delete on contexto.eventos_comerciales   to service_role;
grant select, insert, update, delete on contexto.restriccion_vehicular to service_role;
grant select, insert, update, delete on contexto.senales               to service_role;
grant select, insert, update, delete on contexto.fuentes_estado        to service_role;

-- =============================================================================
-- =============================================================================
-- BLOQUE B · TABLAS POR TENANT — RLS P1-interno (estilo identidad.zonas)
-- =============================================================================
-- =============================================================================

-- =============================================================================
-- B.1 contexto.riesgo_zona — puntaje del motor de riesgo por zona/día/franja
-- =============================================================================
create table if not exists contexto.riesgo_zona (
  -- P1: tenant obligatorio.
  tenant_id              uuid not null references identidad.tenants (id) on delete cascade,

  zona_id                uuid not null,

  -- Fecha en CALENDARIO DE SANTIAGO. Con toISOString() (UTC) el módulo mostraría
  -- el riesgo del día equivocado a partir de las 20:00 — usar
  -- contexto.fecha_santiago() / src/lib/fecha-santiago.ts.
  fecha                  date not null,

  -- Enum cerrado en hora local de Santiago (manana/tarde/punta). Tres filas por
  -- zona por día, no una grilla horaria.
  franja                 contexto.franja not null,

  -- 0–100. Suma ponderada de los factores (Zona.riesgo del contrato). El nivel
  -- (NivelRiesgo: calmo|bajo|medio|alto|critico) lo DERIVA la UI del puntaje.
  puntaje                smallint not null check (puntaje between 0 and 100),

  -- Los 6 factores con { valor, peso, explicacion } + franja_dominante. El motor
  -- es determinístico y EXPLICABLE: sin este desglose la UI no puede responder
  -- "¿por qué?" (nivel 2 del disclosure). Nada de caja negra.
  desglose               jsonb not null default '{}'::jsonb
                           check (jsonb_typeof(desglose) = 'object'),

  pedidos_pendientes     integer not null default 0 check (pedidos_pendientes >= 0),

  -- Suma AGREGADA de cobro asociado a los pedidos pendientes. `bigint` (no
  -- integer como las líneas de dinero) precisamente porque es una suma, no un
  -- documento de dinero. Se llama "comprometido", NO "pérdida esperada": es el
  -- monto expuesto, no una predicción (§7).
  monto_comprometido_clp bigint not null default 0 check (monto_comprometido_clp >= 0),

  calculado_en           timestamptz not null default now(),

  constraint riesgo_zona_pk primary key (tenant_id, zona_id, fecha, franja),

  -- FK COMPUESTA, no una FK simple a zonas(id): impide A NIVEL DE MOTOR que un
  -- tenant referencie la zona de otro. Requiere identidad.zonas
  -- unique (tenant_id, id) — constraint zonas_tenant_id_id_uk, migración 0014.
  constraint riesgo_zona_zona_pertenece_al_tenant
    foreign key (tenant_id, zona_id)
    references identidad.zonas (tenant_id, id)
    on delete cascade
);

comment on table contexto.riesgo_zona is
  'Puntaje 0–100 del motor de riesgo por (tenant, zona, fecha, franja). POR TENANT
   con RLS P1-interno: el seller y el conductor ven 0 filas (es configuración
   operativa interna del courier, mismo criterio que identidad.zonas). `fecha` es
   date en CALENDARIO DE SANTIAGO y `franja` un enum cerrado en hora local
   (manana 08–12 · tarde 12–17 · punta 17–21) — tres filas por zona por día, no
   una grilla horaria. `desglose` guarda los 6 factores con su valor, peso y
   explicación: el motor es determinístico y explicable, sin caja negra.
   `monto_comprometido_clp` es el monto EXPUESTO (suma agregada de cobro de los
   pedidos pendientes), NO una pérdida esperada. La FK compuesta
   (tenant_id, zona_id) impide referenciar la zona de otro tenant.';

-- El PK arranca en (tenant_id, zona_id): el composer consulta por (tenant, fecha)
-- para armar el horizonte completo, así que este índice sí hace falta.
create index if not exists idx_riesgo_zona_tenant_fecha
  on contexto.riesgo_zona (tenant_id, fecha);

-- =============================================================================
-- B.2 contexto.marcas_operativas — marcas manuales del coordinador
-- =============================================================================
create table if not exists contexto.marcas_operativas (
  id               uuid primary key default gen_random_uuid(),

  tenant_id        uuid not null references identidad.tenants (id) on delete cascade,

  lat              double precision not null check (lat between -90 and 90),
  long             double precision not null check (long between -180 and 180),
  radio_m          integer not null check (radio_m > 0),

  -- TEXTO LIBRE del coordinador. Ver la advertencia de PII en el COMMENT.
  nota             text not null,

  -- `MarcaOperativa.ventana`. fin NULL = vigente sin término conocido.
  vigencia_inicio  timestamptz not null,
  vigencia_fin     timestamptz,

  -- Quién la creó (RNF-04: el "quién" de toda acción). El contrato expone
  -- `autor` como NOMBRE: lo resuelve el composer contra
  -- identidad.usuarios_perfil.nombre_completo. Aquí se guarda el UUID.
  autor_usuario_id uuid references auth.users (id) on delete set null,

  creada_en        timestamptz not null default now(),

  constraint marcas_operativas_vigencia_coherente
    check (vigencia_fin is null or vigencia_fin >= vigencia_inicio)
);

comment on table contexto.marcas_operativas is
  'Marcas puestas a mano por el coordinador sobre el mapa (punto + radio +
   vigencia). Cubren lo que ninguna fuente entrega: marchas no autorizadas,
   convocatorias de último minuto, cortes de calle (§13.6). POR TENANT con RLS
   P1-interno: seller y conductor ven 0 filas.
   ⚠️ DATO PERSONAL: `nota` es TEXTO LIBRE de un coordinador y PUEDE CONTENER PII
   (direcciones, nombres de personas — el propio dummy del contrato dice "Corte de
   calle en Independencia por feria. Confirmado por Marcelo."). Consecuencias que
   NO se pueden pasar por alto: (1) GATE DE IA — si alguna vez se le pasa esta
   columna a un LLM, `seguridad-cumplimiento` debe validar la minimización antes;
   (2) EXPORTACIÓN RNF-13 — esta columna entra en el alcance de la exportación de
   datos del courier; (3) nunca debe salir en logs ni en URLs.';

create index if not exists idx_marcas_operativas_tenant_vigencia
  on contexto.marcas_operativas (tenant_id, vigencia_inicio, vigencia_fin);

-- =============================================================================
-- B.3 contexto.senales_tenant — la parte DEL COURIER de una señal
-- -----------------------------------------------------------------------------
-- Los tres campos del tipo `Senal` que NO son del acontecimiento sino del
-- courier. Separarlos es lo que impide que el volumen de pedidos de un courier
-- quede visible en una fila global que leen todos los demás.
-- =============================================================================
create table if not exists contexto.senales_tenant (
  tenant_id         uuid not null references identidad.tenants (id) on delete cascade,
  senal_id          uuid not null references contexto.senales (id) on delete cascade,

  -- Pedidos DEL COURIER que caen en la ventana y el área de la señal. Este es el
  -- dato que jamás puede vivir en contexto.senales.
  pedidos_en_rango  integer not null default 0 check (pedidos_en_rango >= 0),

  -- Zonas del tenant afectadas. uuid[] (no FK: Postgres no soporta FK por
  -- elemento de array) — la pertenencia al tenant la impone el trigger
  -- contexto.senales_tenant_validar_zonas(), no la disciplina de la app.
  zonas_afectadas   uuid[] not null default '{}'::uuid[],

  -- NULL = sin marcar. La marca del coordinador calibra el filtro (§13.4 paso 7).
  marca_humana      contexto.marca_humana,
  marcada_por       uuid references auth.users (id) on delete set null,
  marcada_en        timestamptz,

  calculado_en      timestamptz not null default now(),

  constraint senales_tenant_pk primary key (tenant_id, senal_id),

  -- RNF-04: si hay marca humana, hay quién y cuándo. Y viceversa.
  constraint senales_tenant_marca_coherente
    check (
      (marca_humana is null     and marcada_por is null     and marcada_en is null)
      or
      (marca_humana is not null and marcada_por is not null and marcada_en is not null)
    )
);

comment on table contexto.senales_tenant is
  'Parte DEL COURIER de una señal de prensa: cuántos pedidos suyos caen en rango,
   qué zonas suyas toca y si el coordinador la confirmó o descartó. Existe porque
   el tipo `Senal` del contrato mezcla el acontecimiento (público, global) con
   estos tres campos, que son del tenant: guardarlos en contexto.senales dejaría
   el VOLUMEN DE PEDIDOS de un courier visible en una fila que leen todos los
   demás. POR TENANT con RLS P1-interno: seller y conductor ven 0 filas.
   `zonas_afectadas` es uuid[] validado por trigger contra identidad.zonas del
   MISMO tenant (Postgres no admite FK por elemento de array).';

create index if not exists idx_senales_tenant_senal
  on contexto.senales_tenant (senal_id);
-- Filtro de relevancia del riel: las señales del tenant con impacto real.
create index if not exists idx_senales_tenant_con_impacto
  on contexto.senales_tenant (tenant_id)
  where pedidos_en_rango > 0;

-- -----------------------------------------------------------------------------
-- Guard de integridad: toda zona de `zonas_afectadas` debe ser del MISMO tenant.
-- Mismo espíritu que operacion.pruebas_entrega_validar_denormalizados(): la
-- integridad se defiende en la BD, no en la app.
-- -----------------------------------------------------------------------------
create or replace function contexto.senales_tenant_validar_zonas()
returns trigger
language plpgsql
as $$
declare
  zona_intrusa uuid;
begin
  if new.zonas_afectadas is null or array_length(new.zonas_afectadas, 1) is null then
    return new;
  end if;

  select z_id into zona_intrusa
  from unnest(new.zonas_afectadas) as z_id
  where not exists (
    select 1 from identidad.zonas z
    where z.id = z_id and z.tenant_id = new.tenant_id
  )
  limit 1;

  if zona_intrusa is not null then
    raise exception
      'senales_tenant: la zona % no pertenece al tenant % (zonas_afectadas solo admite zonas del propio tenant)',
      zona_intrusa, new.tenant_id
      using errcode = '23514'; -- check_violation
  end if;

  return new;
end;
$$;

comment on function contexto.senales_tenant_validar_zonas() is
  'Trigger BEFORE INSERT OR UPDATE en contexto.senales_tenant: rechaza con 23514
   cualquier uuid de `zonas_afectadas` que no sea una zona del propio tenant.
   Sustituye a la FK compuesta que Postgres no puede declarar sobre elementos de
   un array — el aislamiento no se confía a la capa de aplicación.';

drop trigger if exists trg_senales_tenant_validar_zonas on contexto.senales_tenant;
create trigger trg_senales_tenant_validar_zonas
  before insert or update on contexto.senales_tenant
  for each row execute function contexto.senales_tenant_validar_zonas();

-- =============================================================================
-- B.4 RLS de las 3 tablas por tenant — P1 ESTRICTA (solo interno)
-- -----------------------------------------------------------------------------
-- Sin P2 (seller) ni P3 (conductor): la Torre de control es configuración y
-- análisis operativo INTERNO del courier. El seller no ve el riesgo de las zonas
-- ni el monto comprometido; el conductor tampoco. Mismo criterio que
-- identidad.zonas / identidad.ventanas_corte.
-- =============================================================================
alter table contexto.riesgo_zona       enable row level security;
alter table contexto.riesgo_zona       force  row level security;
alter table contexto.marcas_operativas enable row level security;
alter table contexto.marcas_operativas force  row level security;
alter table contexto.senales_tenant    enable row level security;
alter table contexto.senales_tenant    force  row level security;

-- ---- riesgo_zona -----------------------------------------------------------
drop policy if exists riesgo_zona_select_interno on contexto.riesgo_zona;
create policy riesgo_zona_select_interno
  on contexto.riesgo_zona for select to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists riesgo_zona_insert_interno on contexto.riesgo_zona;
create policy riesgo_zona_insert_interno
  on contexto.riesgo_zona for insert to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists riesgo_zona_update_interno on contexto.riesgo_zona;
create policy riesgo_zona_update_interno
  on contexto.riesgo_zona for update to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  )
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists riesgo_zona_delete_interno on contexto.riesgo_zona;
create policy riesgo_zona_delete_interno
  on contexto.riesgo_zona for delete to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

-- ---- marcas_operativas -----------------------------------------------------
drop policy if exists marcas_operativas_select_interno on contexto.marcas_operativas;
create policy marcas_operativas_select_interno
  on contexto.marcas_operativas for select to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists marcas_operativas_insert_interno on contexto.marcas_operativas;
create policy marcas_operativas_insert_interno
  on contexto.marcas_operativas for insert to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists marcas_operativas_update_interno on contexto.marcas_operativas;
create policy marcas_operativas_update_interno
  on contexto.marcas_operativas for update to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  )
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists marcas_operativas_delete_interno on contexto.marcas_operativas;
create policy marcas_operativas_delete_interno
  on contexto.marcas_operativas for delete to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

-- ---- senales_tenant --------------------------------------------------------
drop policy if exists senales_tenant_select_interno on contexto.senales_tenant;
create policy senales_tenant_select_interno
  on contexto.senales_tenant for select to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists senales_tenant_insert_interno on contexto.senales_tenant;
create policy senales_tenant_insert_interno
  on contexto.senales_tenant for insert to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists senales_tenant_update_interno on contexto.senales_tenant;
create policy senales_tenant_update_interno
  on contexto.senales_tenant for update to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  )
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists senales_tenant_delete_interno on contexto.senales_tenant;
create policy senales_tenant_delete_interno
  on contexto.senales_tenant for delete to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

-- -----------------------------------------------------------------------------
-- Guard `solo_interno_edita` en las tres, cubriendo INSERT/UPDATE/DELETE.
-- Sin él, un seller/conductor que intenta UPDATE o DELETE recibe "0 filas"
-- silencioso en vez de 42501 explícito y auditable (lección de la migración
-- 20260613000006: la USING de UPDATE/DELETE no lanza error por sí sola).
-- service_role no se ve afectado: el guard solo intercepta auth.role() =
-- 'authenticated'.
-- -----------------------------------------------------------------------------
drop trigger if exists trg_riesgo_zona_solo_interno_edita on contexto.riesgo_zona;
create trigger trg_riesgo_zona_solo_interno_edita
  before insert or update or delete on contexto.riesgo_zona
  for each statement execute function identidad.solo_interno_edita();

drop trigger if exists trg_marcas_operativas_solo_interno_edita on contexto.marcas_operativas;
create trigger trg_marcas_operativas_solo_interno_edita
  before insert or update or delete on contexto.marcas_operativas
  for each statement execute function identidad.solo_interno_edita();

drop trigger if exists trg_senales_tenant_solo_interno_edita on contexto.senales_tenant;
create trigger trg_senales_tenant_solo_interno_edita
  before insert or update or delete on contexto.senales_tenant
  for each statement execute function identidad.solo_interno_edita();

-- =============================================================================
-- B.5 Vistas espejo en `public` (security_invoker = true)
-- -----------------------------------------------------------------------------
-- Superficie expuesta a PostgREST SOLO para las 3 tablas por tenant. Las 8
-- globales NO tienen vista espejo, a propósito (deny-all).
-- Son `select *`: no ocultan ninguna columna, así que no hay riesgo del gotcha
-- "vista restringida + GRANT de tabla completa" — pero si alguien añade una vista
-- restringida más adelante, debe usar GRANT por COLUMNA, no por tabla.
-- =============================================================================
create or replace view public.riesgo_zona
  with (security_invoker = true)
  as select * from contexto.riesgo_zona;

comment on view public.riesgo_zona is
  'Espejo de contexto.riesgo_zona para PostgREST. RLS P1-interno heredada de la
   tabla base (security_invoker = true). Seller/conductor: 0 filas.';

create or replace view public.marcas_operativas
  with (security_invoker = true)
  as select * from contexto.marcas_operativas;

comment on view public.marcas_operativas is
  'Espejo de contexto.marcas_operativas para PostgREST. RLS P1-interno heredada
   (security_invoker = true). Seller/conductor: 0 filas. `nota` puede contener
   PII (texto libre del coordinador) — no exponerla fuera de roles internos.';

create or replace view public.senales_tenant
  with (security_invoker = true)
  as select * from contexto.senales_tenant;

comment on view public.senales_tenant is
  'Espejo de contexto.senales_tenant para PostgREST. RLS P1-interno heredada
   (security_invoker = true). Seller/conductor: 0 filas. La parte GLOBAL de la
   señal (contexto.senales) NO tiene vista: es deny-all y se lee con service_role.';

-- =============================================================================
-- B.6 Grants de las 3 tablas por tenant
-- -----------------------------------------------------------------------------
-- USAGE sobre el schema: `authenticated` lo necesita para que las vistas
-- security_invoker resuelvan la tabla base. `anon` y `public` NO lo reciben.
-- USAGE por sí solo no concede lectura: sin privilegio de tabla, el SELECT sobre
-- las 8 globales sigue fallando con 42501 (verificado en pgTAP).
-- =============================================================================
revoke all on schema contexto from public, anon;
grant usage on schema contexto to authenticated, service_role;

-- Tablas base (requerido por las vistas security_invoker = true).
grant select, insert, update, delete on contexto.riesgo_zona       to authenticated;
grant select, insert, update, delete on contexto.marcas_operativas to authenticated;
grant select, insert, update, delete on contexto.senales_tenant    to authenticated;

-- Vistas en public.
grant select, insert, update, delete on public.riesgo_zona       to authenticated;
grant select, insert, update, delete on public.marcas_operativas to authenticated;
grant select, insert, update, delete on public.senales_tenant    to authenticated;

-- service_role: BYPASSRLS salta las políticas pero NO reemplaza el GRANT SQL.
grant select, insert, update, delete on contexto.riesgo_zona       to service_role;
grant select, insert, update, delete on contexto.marcas_operativas to service_role;
grant select, insert, update, delete on contexto.senales_tenant    to service_role;
grant select, insert, update, delete on public.riesgo_zona         to service_role;
grant select, insert, update, delete on public.marcas_operativas   to service_role;
grant select, insert, update, delete on public.senales_tenant      to service_role;

-- =============================================================================
-- 4. Índices en `operacion` que el composer de la Torre necesita
-- =============================================================================

-- 4.1 Contador `pedidosSinGeocodificar` — la regla 5 del handoff obliga a
--     mostrarlo SIEMPRE ("un mapa que esconde los pedidos que no pudo ubicar
--     miente sobre la carga real"). Cubre los tres estados no resueltos
--     (pendiente | no_resuelto | fuera_cobertura) en un solo índice parcial; los
--     índices existentes (idx_pedidos_geo_pendiente / idx_pedidos_geo_revision)
--     los cubren por separado y no sirven para el conteo único.
create index if not exists idx_pedidos_sin_geocodificar
  on operacion.pedidos (tenant_id)
  where geo_estado <> 'resuelto';

-- 4.2 Agregación del mapa: pedidos del día agrupados por comuna, que después se
--     unen a identidad.zona_comunas para obtener la zona.
--     VERIFICADO: operacion.pedidos NO tiene zona_id — la relación comuna→zona es
--     un join (o, como dice §8.1, se resuelve fuera de la BD).
--     ⚠️ El join directo `pedidos.destinatario_comuna = zona_comunas.comuna` NO es
--     una igualdad válida: `destinatario_comuna` guarda el texto CRUDO ('Las
--     Condes', 'Ñuñoa') y `zona_comunas.comuna` guarda la forma normalizada por
--     el backend (resolverComunaCanonica / normalizarTexto: sin acentos,
--     minúsculas). Por eso el índice es sobre la columna cruda: sirve el GROUP BY
--     por comuna, y el mapeo comuna→zona lo hace la aplicación con el mismo
--     helper de normalización que usó al escribir zona_comunas.
--     El lado zona_comunas ya está indexado (idx_zona_comunas_lookup).
create index if not exists idx_pedidos_agregacion_comuna
  on operacion.pedidos (tenant_id, fecha_compromiso, destinatario_comuna);

-- =============================================================================
-- 5. Storage: bucket PÚBLICO `contexto-mapas`
-- -----------------------------------------------------------------------------
-- Cartografía del basemap: PMTiles recortado a la RM, glyph PBFs y sprites.
-- PÚBLICO (public = true) a diferencia de `pod-evidencias`, y con razón:
--   · es cartografía OSM/DPA — no hay ni un dato de courier, seller, conductor ni
--     destinatario que proteger;
--   · PMTiles se sirve por HTTP Range desde el CDN, y una URL firmada por rango
--     no funciona: firmar cada request de tile mataría el rendimiento del mapa.
-- `public = true` solo habilita LECTURA anónima. La ESCRITURA sigue cerrada: no
-- se crean políticas sobre storage.objects, de modo que solo service_role sube.
--
-- Convención de path (la impone quien publica los assets):
--   basemap/<version>/rm.pmtiles · glyphs/<fuente>/<rango>.pbf · sprites/<nombre>.{png,json}
--
-- Sin `allowed_mime_types`: el bucket sirve al menos cuatro tipos distintos
-- (pmtiles como octet-stream, pbf, png, json) y una allowlist frágil rompería la
-- publicación sin ganar seguridad — el bucket es de solo lectura pública.
-- También declarado en supabase/config.toml para el entorno local.
-- =============================================================================
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('contexto-mapas', 'contexto-mapas', true, 52428800, null)
    on conflict (id) do update set public = true;
  end if;
end $$;
