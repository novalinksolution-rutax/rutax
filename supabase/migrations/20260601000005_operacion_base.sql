-- =============================================================================
-- Migración 0005 · Operación — módulo operacional de Fase B
-- =============================================================================
-- Crea: esquema `operacion`, 6 enums, 6 tablas de negocio (pedidos, manifiestos,
-- asignaciones_pedido, incidencias, evidencias_incidencia, intentos_backfill),
-- triggers de mantenimiento de `actualizado_en`, triggers de consistencia de
-- datos denormalizados, trigger que sincroniza `pedidos.driver_id_asignado`,
-- RLS P1/P2/P3 conforme §4 del doc fase-b-operacion.md, vistas en `public` con
-- security_invoker = true y grants para `authenticated`.
--
-- Idempotente: guards IF NOT EXISTS / OR REPLACE / DO-blocks en cada objeto.
--
-- Contrato de RLS (hereda de Fase A — funciones de claims ya existentes):
--   identidad.claim_tenant_id()   → uuid del tenant del JWT
--   identidad.claim_tipo_usuario() → 'interno' | 'seller' | 'conductor' | 'super_admin'
--   identidad.claim_seller_id()   → uuid del seller (NULL salvo tipo='seller')
--   identidad.claim_driver_id()   → uuid del conductor (NULL salvo tipo='conductor')
--   identidad.solo_interno_edita() → trigger de defensa en profundidad (42501)
-- =============================================================================

-- =============================================================================
-- 0. Preparación idempotente: remover objetos dependientes en orden inverso
--    para que la migración pueda re-aplicarse sobre una base ya migrada.
--    Los DROPs van ANTES de los CREATEs que los definen.
-- =============================================================================

-- Vistas públicas (primero, porque dependen de las tablas)
drop view if exists public.evidencias_incidencia cascade;
drop view if exists public.incidencias cascade;
drop view if exists public.asignaciones_pedido cascade;
drop view if exists public.manifiestos cascade;
drop view if exists public.pedidos cascade;

-- Tablas (en orden inverso de dependencias — las hojas primero)
drop table if exists operacion.intentos_backfill cascade;
drop table if exists operacion.evidencias_incidencia cascade;
drop table if exists operacion.incidencias cascade;
drop table if exists operacion.asignaciones_pedido cascade;
drop table if exists operacion.manifiestos cascade;
drop table if exists operacion.pedidos cascade;

-- Funciones de triggers del esquema operacion
drop function if exists operacion.set_actualizado_en() cascade;
drop function if exists operacion.asignaciones_pedido_validar_denormalizados() cascade;
drop function if exists operacion.sincronizar_driver_id_asignado() cascade;

-- Enums (en orden inverso por si hubiera dependencias)
drop type if exists operacion.estado_manifiesto cascade;
drop type if exists operacion.estado_incidencia cascade;
drop type if exists operacion.tipo_incidencia cascade;
drop type if exists operacion.origen_pedido cascade;
drop type if exists operacion.tipo_pedido cascade;
drop type if exists operacion.estado_pedido cascade;

-- Esquema al final (depende de que ya no tenga nada dentro)
-- NOTA: no se hace DROP SCHEMA CASCADE para no correr el riesgo de borrar
-- objetos de otros módulos si alguna vez comparten esquema. El DROP de
-- objetos individuales arriba es suficiente para la idempotencia.

-- =============================================================================
-- 1. Esquema
-- =============================================================================
create schema if not exists operacion;

comment on schema operacion is
  'Módulo de Fase B: pedidos, manifiestos, asignaciones, incidencias y backfill.
   Las vistas en public son la superficie expuesta a PostgREST.
   intentos_backfill es invisible para authenticated — solo service_role.';

-- =============================================================================
-- 2. Enums (en esquema operacion — no contaminan identidad ni public)
-- =============================================================================

-- estado_pedido: máquina de estados del pedido (§3 del doc de arquitectura).
-- Los estados terminales (entregado, entregado_manual, cancelado, devuelto) no
-- admiten más transiciones — el backend los valida, la BD los almacena.
create type operacion.estado_pedido as enum (
  'pendiente_asignacion',
  'asignado',
  'en_ruta',
  'entregado',
  'entregado_manual',
  'fallido',
  'fallido_manual',
  'cancelado',
  'devuelto'
);

create type operacion.tipo_pedido as enum (
  'flex',
  'same_day'
);

-- origen_pedido: cómo llegó el pedido al sistema.
-- 'ml_ingesta' = job de ingesta automática Flex (RF-018).
-- 'same_day_manual' = creado manualmente por un interno (RF ad-hoc).
-- 'backfill' = recuperado por el job de backfill (RF-017) tras reconexión ML.
create type operacion.origen_pedido as enum (
  'ml_ingesta',
  'same_day_manual',
  'backfill'
);

create type operacion.tipo_incidencia as enum (
  'destinatario_ausente',
  'direccion_erronea',
  'paquete_danado',
  'rechazo_destinatario',
  'problema_acceso',
  'reagendado',
  'otro'
);

create type operacion.estado_incidencia as enum (
  'abierta',
  'en_gestion',
  'resuelta',
  'cerrada'
);

create type operacion.estado_manifiesto as enum (
  'borrador',
  'confirmado',
  'en_ruta',
  'completado',
  'cancelado'
);

-- =============================================================================
-- 3. Función utilitaria de timestamps (análoga a identidad.set_actualizado_en)
-- =============================================================================
create or replace function operacion.set_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

comment on function operacion.set_actualizado_en() is
  'Trigger BEFORE UPDATE que actualiza actualizado_en a now() en cada modificación.
   Patrón replicado de identidad.set_actualizado_en() para mantener el esquema
   operacion independiente del identidad.';

-- =============================================================================
-- 4. Tabla operacion.pedidos (§2.2)
-- =============================================================================
-- Tabla central del módulo. Lleva columnas de Fase C (monto_cobro_clp,
-- monto_liquidacion_clp, cobro_generado, liquidacion_generada) desde el inicio
-- para no migrar dos veces cuando el motor entrega→dinero las necesite.
create table operacion.pedidos (
  id                       uuid primary key default gen_random_uuid(),

  -- P1: tenant obligatorio en toda tabla de negocio.
  tenant_id                uuid not null references identidad.tenants (id) on delete restrict,

  -- P2: seller dueño del pedido — denormalizado para la política RLS sin joins.
  seller_id                uuid not null references identidad.sellers (id) on delete restrict,

  tipo_pedido              operacion.tipo_pedido not null,
  origen                   operacion.origen_pedido not null,

  -- IDs de ML: nullable para pedidos same_day_manual que no pasan por ML.
  ml_order_id              text,
  ml_shipment_id           text,

  estado                   operacion.estado_pedido not null default 'pendiente_asignacion',

  -- Estado crudo que reporta ML — distinto del estado operativo del sistema.
  -- Fase B los ingesta tal cual; Fase C puede necesitar el subestado para
  -- determinar si una incidencia aplica a cobro/liquidación.
  estado_ml                text,
  subestado_ml             text,
  ultima_sync_ml_en        timestamptz,

  -- P3: denormalizado para que la política del conductor no requiera join
  -- a asignaciones_pedido. Actualizado por trigger (ver §7 de esta migración).
  -- NULL = pedido sin conductor asignado actualmente.
  driver_id_asignado       uuid references identidad.conductores (id),

  -- Datos del destinatario — minimización Ley 21.431.
  destinatario_nombre      text not null,
  destinatario_direccion   text not null,
  destinatario_comuna      text not null,
  destinatario_telefono    text,
  instrucciones_entrega    text,

  -- Fecha prometida de entrega (Flex la provee ML; same_day puede ser nula si
  -- es entrega en el momento sin fecha fija).
  fecha_compromiso         date,

  -- Tarifa fijada al ingresar el pedido — Fase C no necesita resolver
  -- retroactivamente qué tarifa aplicaba (columna lista desde Fase B).
  tarifa_aplicable_id      uuid references identidad.tarifas (id),

  -- Columnas de Fase C: existen desde Fase B para no migrar dos veces.
  -- El motor entrega→dinero las escribe; esta migración solo las declara.
  monto_cobro_clp          integer check (monto_cobro_clp >= 0),
  monto_liquidacion_clp    integer check (monto_liquidacion_clp >= 0),
  cobro_generado           boolean not null default false,
  liquidacion_generada     boolean not null default false,

  notas_internas           text,

  creado_en                timestamptz not null default now(),
  actualizado_en           timestamptz not null default now(),

  -- Idempotencia de ingesta: el job de ingesta ML hace UPSERT sobre
  -- (tenant_id, ml_shipment_id). Solo aplica cuando ml_shipment_id IS NOT NULL
  -- (los same_day_manual no tienen shipment_id de ML).
  constraint pedidos_ml_shipment_uk unique (tenant_id, ml_shipment_id),

  -- El seller referenciado debe pertenecer al mismo tenant que el pedido.
  -- FK compuesta sobre identidad.sellers (tenant_id, id) — requiere la constraint
  -- unique (tenant_id, id) en sellers, ya añadida en la migración 0004.
  constraint pedidos_seller_pertenece_al_tenant
    foreign key (tenant_id, seller_id)
    references identidad.sellers (tenant_id, id)
    deferrable initially immediate
);

comment on table operacion.pedidos is
  'Tabla central del módulo operacion. Cada fila es un pedido Flex o same-day.
   RLS P1 (tenant) + P2 (seller) + P3 (conductor via driver_id_asignado).
   Las columnas de Fase C (monto_*_clp, *_generado) existen desde Fase B para
   no migrar dos veces cuando el motor entrega→dinero las necesite.
   driver_id_asignado es denormalizado; se actualiza con trigger desde asignaciones_pedido.';

-- Índices de pedidos (copia exacta de §2.2 del doc de arquitectura)
create index if not exists idx_pedidos_tenant_id
  on operacion.pedidos (tenant_id);

create index if not exists idx_pedidos_tenant_seller
  on operacion.pedidos (tenant_id, seller_id);

create index if not exists idx_pedidos_tenant_estado
  on operacion.pedidos (tenant_id, estado);

create index if not exists idx_pedidos_tenant_fecha
  on operacion.pedidos (tenant_id, fecha_compromiso);

-- Índices parciales: activos solo cuando el campo está presente —
-- los pedidos same_day_manual no tienen IDs de ML, así que el índice es
-- mucho más pequeño y no hay falsos positivos en el UNIQUE.
create index if not exists idx_pedidos_ml_shipment_id
  on operacion.pedidos (ml_shipment_id)
  where ml_shipment_id is not null;

create index if not exists idx_pedidos_ml_order_id
  on operacion.pedidos (ml_order_id)
  where ml_order_id is not null;

-- Índice parcial para el job de facturación de Fase C: encuentra rápidamente
-- las filas que todavía no tienen línea de cobro generada y ya están entregadas.
create index if not exists idx_pedidos_cobro_pendiente
  on operacion.pedidos (tenant_id)
  where cobro_generado = false and estado = 'entregado';

drop trigger if exists trg_pedidos_actualizado_en on operacion.pedidos;
create trigger trg_pedidos_actualizado_en
  before update on operacion.pedidos
  for each row execute function operacion.set_actualizado_en();

-- =============================================================================
-- 5. Tabla operacion.manifiestos (§2.3)
-- =============================================================================
-- Pre-requisito: la FK compuesta (tenant_id, driver_id) en manifiestos necesita
-- que conductores tenga un unique constraint sobre (tenant_id, id). Lo añadimos
-- idempotentemente ANTES de crear la tabla que la referencia.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'conductores_tenant_id_id_uk'
  ) then
    alter table identidad.conductores
      add constraint conductores_tenant_id_id_uk unique (tenant_id, id);
  end if;
end $$;

-- Un manifiesto agrupa pedidos para un conductor en un turno.
create table operacion.manifiestos (
  id                      uuid primary key default gen_random_uuid(),

  -- P1
  tenant_id               uuid not null references identidad.tenants (id) on delete restrict,

  -- P3: el conductor dueño del manifiesto.
  driver_id               uuid not null references identidad.conductores (id) on delete restrict,

  nombre                  text not null,

  -- fecha_operacion en zona horaria de Santiago (el valor date se almacena
  -- sin TZ; la app siempre opera en America/Santiago — CLAUDE.md).
  fecha_operacion         date not null,

  estado                  operacion.estado_manifiesto not null default 'borrador',
  notas                   text,

  -- Auditoría: quién creó el manifiesto (usuario_id de auth.users).
  creado_por_usuario_id   uuid references auth.users (id),

  confirmado_en           timestamptz,
  completado_en           timestamptz,

  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),

  -- El conductor debe pertenecer al mismo tenant del manifiesto.
  constraint manifiestos_driver_pertenece_al_tenant
    foreign key (tenant_id, driver_id)
    references identidad.conductores (tenant_id, id)
    deferrable initially immediate
);

comment on table operacion.manifiestos is
  'Agrupa pedidos para un conductor en un turno. RLS P1 (tenant) + P3 (conductor).
   Los internos ven todos los manifiestos del tenant; el conductor solo los suyos.
   No hay P2 (seller) porque el manifiesto es una entidad interna del courier,
   no relacionada directamente con un seller individual.';

create index if not exists idx_manifiestos_tenant_id
  on operacion.manifiestos (tenant_id);

create index if not exists idx_manifiestos_driver_fecha
  on operacion.manifiestos (tenant_id, driver_id, fecha_operacion);

create index if not exists idx_manifiestos_tenant_estado
  on operacion.manifiestos (tenant_id, estado);

drop trigger if exists trg_manifiestos_actualizado_en on operacion.manifiestos;
create trigger trg_manifiestos_actualizado_en
  before update on operacion.manifiestos
  for each row execute function operacion.set_actualizado_en();

-- =============================================================================
-- 6. Tabla operacion.asignaciones_pedido (§2.4)
-- =============================================================================
-- Relación pedido ↔ manifiesto con historial completo. Un pedido solo puede
-- estar en un manifiesto ACTIVO a la vez (índice partial unique abajo).
-- Los datos denormalizados driver_id y seller_id evitan joins en las políticas
-- RLS P2/P3 y se validan por trigger de consistencia (§8 de esta migración).
create table operacion.asignaciones_pedido (
  id                       uuid primary key default gen_random_uuid(),

  -- P1 — denormalizado para que la política de tenant no requiera join
  tenant_id                uuid not null references identidad.tenants (id) on delete restrict,

  pedido_id                uuid not null references operacion.pedidos (id) on delete cascade,
  manifiesto_id            uuid not null references operacion.manifiestos (id) on delete restrict,

  -- P3 — denormalizado desde manifiestos.driver_id; validado por trigger
  driver_id                uuid not null references identidad.conductores (id),

  -- P2 — denormalizado desde pedidos.seller_id; validado por trigger
  seller_id                uuid not null references identidad.sellers (id),

  -- Solo UNA fila con activa = true por pedido_id simultáneamente.
  -- Ver unique partial index abajo (el constraint está en el índice, no en la
  -- columna, para soportar múltiples filas históricas inactivas).
  activa                   boolean not null default true,

  -- Auditoría
  asignado_por_usuario_id  uuid references auth.users (id),
  asignado_en              timestamptz not null default now(),

  -- Se rellena cuando la asignación es superada por una reasignación.
  desasignado_en           timestamptz
);

comment on table operacion.asignaciones_pedido is
  'Relación pedido ↔ manifiesto con historial. Solo una fila activa por pedido
   a la vez (partial unique index). driver_id y seller_id son denormalizados y
   validados por trigger de consistencia (asignaciones_pedido_validar_denormalizados).
   RLS P1 + (P2 OR P3): cada actor ve solo las asignaciones que le competen.
   La escritura (INSERT/UPDATE) es exclusiva de roles internos y service_role.';

-- Índice partial único: la invariante de "un solo manifiesto activo por pedido"
-- se impone a nivel de BD, no solo en aplicación.
create unique index if not exists idx_asignaciones_pedido_activa_uk
  on operacion.asignaciones_pedido (pedido_id)
  where activa = true;

create index if not exists idx_asignaciones_tenant_id
  on operacion.asignaciones_pedido (tenant_id);

create index if not exists idx_asignaciones_pedido_activa
  on operacion.asignaciones_pedido (pedido_id)
  where activa = true;

create index if not exists idx_asignaciones_manifiesto
  on operacion.asignaciones_pedido (manifiesto_id, activa);

create index if not exists idx_asignaciones_driver_activa
  on operacion.asignaciones_pedido (driver_id, activa);

-- =============================================================================
-- 7. Tabla operacion.incidencias (§2.5)
-- =============================================================================
create table operacion.incidencias (
  id                        uuid primary key default gen_random_uuid(),

  -- P1
  tenant_id                 uuid not null references identidad.tenants (id) on delete restrict,

  pedido_id                 uuid not null references operacion.pedidos (id) on delete restrict,

  -- P2 — denormalizado desde pedidos.seller_id para la política RLS del seller.
  seller_id                 uuid not null references identidad.sellers (id),

  tipo                      operacion.tipo_incidencia not null,
  estado                    operacion.estado_incidencia not null default 'abierta',
  descripcion               text,
  notas_resolucion          text,

  -- Fase C usa estos flags para aplicar reglas de incidencia sobre cobro y
  -- liquidación. Se fijan al abrir la incidencia según el tipo (lógica en backend).
  afecta_cobro              boolean not null default true,
  afecta_liquidacion        boolean not null default true,

  -- Auditoría
  abierta_por_usuario_id    uuid references auth.users (id),
  resuelta_por_usuario_id   uuid references auth.users (id),
  abierta_en                timestamptz not null default now(),
  resuelta_en               timestamptz,

  creado_en                 timestamptz not null default now(),
  actualizado_en            timestamptz not null default now()
);

comment on table operacion.incidencias is
  'Incidencias asociadas a pedidos. seller_id denormalizado desde pedidos.seller_id
   para RLS P2 (el seller del portal puede ver sus propias incidencias — RF-048).
   Conductores no acceden a esta tabla. Fase C consume afecta_cobro / afecta_liquidacion.
   Escritura: solo roles internos y service_role.';

create index if not exists idx_incidencias_tenant_id
  on operacion.incidencias (tenant_id);

create index if not exists idx_incidencias_pedido_id
  on operacion.incidencias (pedido_id);

create index if not exists idx_incidencias_seller_estado
  on operacion.incidencias (tenant_id, seller_id, estado);

drop trigger if exists trg_incidencias_actualizado_en on operacion.incidencias;
create trigger trg_incidencias_actualizado_en
  before update on operacion.incidencias
  for each row execute function operacion.set_actualizado_en();

-- =============================================================================
-- 8. Tabla operacion.evidencias_incidencia (§2.6)
-- =============================================================================
-- Archivos adjuntos a una incidencia (fotos, documentos). El valor real del
-- archivo vive en Supabase Storage (bucket privado); esta tabla solo guarda el
-- path. Las URLs se generan como signed URLs de vida corta (5–15 min) en la
-- capa de aplicación — nunca URLs públicas permanentes.
create table operacion.evidencias_incidencia (
  id                       uuid primary key default gen_random_uuid(),

  -- P1
  tenant_id                uuid not null references identidad.tenants (id) on delete restrict,

  incidencia_id            uuid not null references operacion.incidencias (id) on delete cascade,

  -- P2 — denormalizado desde incidencias.seller_id
  seller_id                uuid not null references identidad.sellers (id),

  tipo_archivo             text not null
    check (tipo_archivo in ('imagen', 'documento')),

  -- Path en Supabase Storage. Sugerido: {tenant_id}/incidencias/{incidencia_id}/{id}
  -- NO almacenar URLs firmadas aquí — caducan y no son reproducibles.
  storage_path             text not null,

  nombre_original          text,

  subido_por_usuario_id    uuid references auth.users (id),

  creado_en                timestamptz not null default now()
);

comment on table operacion.evidencias_incidencia is
  'Archivos adjuntos (fotos, documentos) de una incidencia. storage_path apunta
   al bucket privado de Supabase Storage — las URLs se generan como signed URLs
   de vida corta en la capa de aplicación, nunca expuestas aquí en texto plano.
   seller_id denormalizado desde incidencia para RLS P2. Sin timestamps de
   actualizado_en porque las evidencias son inmutables (append-only por diseño).';

create index if not exists idx_evidencias_incidencia_id
  on operacion.evidencias_incidencia (incidencia_id);

create index if not exists idx_evidencias_tenant_id
  on operacion.evidencias_incidencia (tenant_id);

-- =============================================================================
-- 9. Tabla operacion.intentos_backfill (§2.7)
-- =============================================================================
-- Hace el backfill idempotente: el job `ml/ejecutarBackfill` crea una fila aquí
-- antes de procesar. El unique constraint (conexion_ml_id, desde, hasta) evita
-- dos backfills del mismo período. INVISIBLE para authenticated — sin vista en
-- public, sin políticas para authenticated, solo service_role.
create table operacion.intentos_backfill (
  id                   uuid primary key default gen_random_uuid(),

  -- P1
  tenant_id            uuid not null references identidad.tenants (id) on delete restrict,

  conexion_ml_id       uuid not null references identidad.conexiones_seller_ml (id),

  -- Denormalizado desde conexiones_seller_ml para facilitar consultas del job.
  seller_id            uuid not null,

  -- Ventana de tiempo del backfill: desde = desconectada_desde al inicio del
  -- job, hasta = momento en que el job inició.
  desde                timestamptz not null,
  hasta                timestamptz not null,

  estado               text not null default 'pendiente'
    check (estado in ('pendiente', 'en_progreso', 'completado', 'fallido')),

  -- Conteo final de pedidos procesados (NULL hasta completarse o fallar).
  pedidos_recuperados  integer,

  -- Texto del error si estado = 'fallido'. Sin datos sensibles — solo código
  -- de error y mensaje de API (los tokens no pasan por aquí, ver secretos_cifrados).
  error                text,

  iniciado_en          timestamptz not null default now(),
  completado_en        timestamptz,

  -- Idempotencia: no se puede iniciar el mismo backfill dos veces.
  constraint intentos_backfill_periodo_uk unique (conexion_ml_id, desde, hasta)
);

comment on table operacion.intentos_backfill is
  'Registro de cada intento de backfill: garantiza idempotencia y trazabilidad.
   INVISIBLE para authenticated: sin políticas de RLS para ese rol y sin vista
   en public — solo service_role (jobs de Inngest) puede leer y escribir.
   La tabla tiene FORCE ROW LEVEL SECURITY sin política para authenticated,
   lo que produce cero filas visibles para cualquier cliente autenticado.';

-- =============================================================================
-- 10. Trigger de consistencia: asignaciones_pedido.driver_id debe coincidir
--     con manifiestos.driver_id, y seller_id debe coincidir con pedidos.seller_id.
--     Estas columnas son denormalizadas (§2.4) — el trigger garantiza que no
--     se desincronicen al insertar o actualizar (defensa de la integridad en BD).
-- =============================================================================
create or replace function operacion.asignaciones_pedido_validar_denormalizados()
returns trigger
language plpgsql
as $$
declare
  driver_del_manifiesto uuid;
  seller_del_pedido     uuid;
begin
  -- Solo validar filas activas: las filas históricas (activa = false) pueden
  -- tener datos del momento en que estaban activas y no deben revalidarse.
  if new.activa = false then
    return new;
  end if;

  -- Verificar que driver_id coincide con el conductor del manifiesto.
  select driver_id into driver_del_manifiesto
  from operacion.manifiestos
  where id = new.manifiesto_id;

  if driver_del_manifiesto is null then
    raise exception 'manifiesto_id % no existe', new.manifiesto_id
      using errcode = '23503'; -- foreign_key_violation (más informativo para el cliente)
  end if;

  if new.driver_id is distinct from driver_del_manifiesto then
    raise exception
      'asignaciones_pedido: driver_id denormalizado (%) no coincide con manifiestos.driver_id (%)',
      new.driver_id, driver_del_manifiesto
      using errcode = '23514'; -- check_violation, como especifica la tarea
  end if;

  -- Verificar que seller_id coincide con el seller del pedido.
  select seller_id into seller_del_pedido
  from operacion.pedidos
  where id = new.pedido_id;

  if seller_del_pedido is null then
    raise exception 'pedido_id % no existe', new.pedido_id
      using errcode = '23503';
  end if;

  if new.seller_id is distinct from seller_del_pedido then
    raise exception
      'asignaciones_pedido: seller_id denormalizado (%) no coincide con pedidos.seller_id (%)',
      new.seller_id, seller_del_pedido
      using errcode = '23514'; -- check_violation
  end if;

  return new;
end;
$$;

comment on function operacion.asignaciones_pedido_validar_denormalizados() is
  'Trigger BEFORE INSERT OR UPDATE en asignaciones_pedido: verifica que driver_id
   coincida con manifiestos.driver_id y que seller_id coincida con pedidos.seller_id.
   Solo valida filas activas (activa = true) — las históricas quedan como registro
   del estado en el momento de la asignación. Lanza 23514 (check_violation) con
   mensaje descriptivo si hay inconsistencia.';

drop trigger if exists trg_asignaciones_validar_denormalizados on operacion.asignaciones_pedido;
create trigger trg_asignaciones_validar_denormalizados
  before insert or update on operacion.asignaciones_pedido
  for each row execute function operacion.asignaciones_pedido_validar_denormalizados();

-- =============================================================================
-- 11. Trigger que sincroniza pedidos.driver_id_asignado
--     Al activar una asignación → driver_id_asignado = driver_id de la asignación.
--     Al desactivar una asignación → driver_id_asignado = NULL.
--     Esto mantiene la denormalización P3 sin que la app tenga que orquestarla.
-- =============================================================================
create or replace function operacion.sincronizar_driver_id_asignado()
returns trigger
language plpgsql
as $$
begin
  if new.activa = true then
    -- Nueva asignación activa: actualizar el pedido con el conductor asignado.
    update operacion.pedidos
    set driver_id_asignado = new.driver_id,
        actualizado_en     = now()
    where id = new.pedido_id;

  elsif new.activa = false and (tg_op = 'UPDATE') then
    -- Asignación desactivada (reasignación o cancelación): limpiar el conductor
    -- del pedido SOLO si el driver_id_asignado actual coincide con esta
    -- asignación. Esto evita que una reasignación que puso otra asignación
    -- activa (y ya actualizó driver_id_asignado al nuevo conductor) sea
    -- sobreescrita accidentalmente con NULL al desactivarse la asignación vieja.
    update operacion.pedidos
    set driver_id_asignado = null,
        actualizado_en     = now()
    where id = new.pedido_id
      and driver_id_asignado = new.driver_id;
  end if;

  return new;
end;
$$;

comment on function operacion.sincronizar_driver_id_asignado() is
  'Trigger AFTER INSERT OR UPDATE en asignaciones_pedido: mantiene sincronizado
   pedidos.driver_id_asignado. Cuando activa = true, asigna el conductor al pedido.
   Cuando activa cambia a false (reasignación), limpia driver_id_asignado SOLO
   si todavía apunta al conductor de esta asignación (evita limpiar una reasignación
   ya activa si el trigger de la nueva asignación se ejecutó primero).';

drop trigger if exists trg_asignaciones_sincronizar_driver_id on operacion.asignaciones_pedido;
create trigger trg_asignaciones_sincronizar_driver_id
  after insert or update on operacion.asignaciones_pedido
  for each row execute function operacion.sincronizar_driver_id_asignado();

-- =============================================================================
-- 12. RLS — activar y aplicar políticas P1/P2/P3 (§4 del doc de arquitectura)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 12.1 operacion.pedidos — P1 + P2 + P3
-- -----------------------------------------------------------------------------
-- El seller ve sus propios pedidos (P2: seller_id = claim).
-- El conductor ve los pedidos donde él está asignado actualmente (P3:
--   driver_id_asignado = claim). Esta es la denormalización que evita el join
--   a asignaciones_pedido en la política RLS.
-- Los internos ven todos los pedidos del tenant.
-- Escritura: solo roles internos (guard de defensa en profundidad abajo).
alter table operacion.pedidos enable row level security;
alter table operacion.pedidos force row level security;

drop policy if exists pedidos_select on operacion.pedidos;
create policy pedidos_select
  on operacion.pedidos
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or (identidad.claim_tipo_usuario() = 'seller'    and seller_id         = identidad.claim_seller_id())
      or (identidad.claim_tipo_usuario() = 'conductor' and driver_id_asignado = identidad.claim_driver_id())
    )
  );

-- INSERT: solo internos. El job de ingesta ML corre como service_role (bypassa RLS).
drop policy if exists pedidos_insert_interno on operacion.pedidos;
create policy pedidos_insert_interno
  on operacion.pedidos
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

-- UPDATE: solo internos. Las transiciones de estado se ejecutan como funciones
-- de servidor con service_role o desde un usuario interno con capacidad RBAC.
drop policy if exists pedidos_update_interno on operacion.pedidos;
create policy pedidos_update_interno
  on operacion.pedidos
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

-- Guard de defensa en profundidad (patrón de Fase A: ver identidad.solo_interno_edita
-- en la migración 0002). Sin este trigger, un seller/conductor que puede VER
-- un pedido (vía P2/P3) y lanza un UPDATE recibiría "UPDATE 0" silencioso en
-- vez de un 42501 explícito y auditable. El trigger POR SENTENCIA se ejecuta
-- antes de que RLS filtre las filas candidatas (incluso con cero filas afectadas).
drop trigger if exists trg_pedidos_solo_interno_edita on operacion.pedidos;
create trigger trg_pedidos_solo_interno_edita
  before update on operacion.pedidos
  for each statement execute function identidad.solo_interno_edita();

-- -----------------------------------------------------------------------------
-- 12.2 operacion.manifiestos — P1 + P3
-- -----------------------------------------------------------------------------
-- El conductor ve solo sus propios manifiestos (driver_id = claim).
-- Los internos ven todos los manifiestos del tenant.
-- El seller NO tiene acceso a manifiestos (tabla interna del courier).
alter table operacion.manifiestos enable row level security;
alter table operacion.manifiestos force row level security;

drop policy if exists manifiestos_select on operacion.manifiestos;
create policy manifiestos_select
  on operacion.manifiestos
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or (identidad.claim_tipo_usuario() = 'conductor' and driver_id = identidad.claim_driver_id())
    )
  );

drop policy if exists manifiestos_insert_interno on operacion.manifiestos;
create policy manifiestos_insert_interno
  on operacion.manifiestos
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists manifiestos_update_interno on operacion.manifiestos;
create policy manifiestos_update_interno
  on operacion.manifiestos
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

drop trigger if exists trg_manifiestos_solo_interno_edita on operacion.manifiestos;
create trigger trg_manifiestos_solo_interno_edita
  before update on operacion.manifiestos
  for each statement execute function identidad.solo_interno_edita();

-- -----------------------------------------------------------------------------
-- 12.3 operacion.asignaciones_pedido — P1 + P2 OR P3 (§4)
-- -----------------------------------------------------------------------------
-- El seller ve asignaciones de sus pedidos (P2: seller_id = claim).
-- El conductor ve las asignaciones donde él está implicado (P3: driver_id = claim).
-- Los internos ven todo el tenant.
-- OBS: la política es un OR explícito de P2 y P3 — un seller no ve asignaciones
-- de otro seller aunque sea del mismo tenant, y un conductor no ve asignaciones
-- de otro conductor.
alter table operacion.asignaciones_pedido enable row level security;
alter table operacion.asignaciones_pedido force row level security;

drop policy if exists asignaciones_pedido_select on operacion.asignaciones_pedido;
create policy asignaciones_pedido_select
  on operacion.asignaciones_pedido
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or (identidad.claim_tipo_usuario() = 'seller'    and seller_id = identidad.claim_seller_id())
      or (identidad.claim_tipo_usuario() = 'conductor' and driver_id = identidad.claim_driver_id())
    )
  );

drop policy if exists asignaciones_pedido_insert_interno on operacion.asignaciones_pedido;
create policy asignaciones_pedido_insert_interno
  on operacion.asignaciones_pedido
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists asignaciones_pedido_update_interno on operacion.asignaciones_pedido;
create policy asignaciones_pedido_update_interno
  on operacion.asignaciones_pedido
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

drop trigger if exists trg_asignaciones_solo_interno_edita on operacion.asignaciones_pedido;
create trigger trg_asignaciones_solo_interno_edita
  before update on operacion.asignaciones_pedido
  for each statement execute function identidad.solo_interno_edita();

-- -----------------------------------------------------------------------------
-- 12.4 operacion.incidencias — P1 + P2
-- -----------------------------------------------------------------------------
-- El seller ve incidencias de SUS pedidos (P2: seller_id = claim — RF-048
-- portal del seller). El conductor no tiene acceso a incidencias. Los internos
-- ven todas las incidencias del tenant.
alter table operacion.incidencias enable row level security;
alter table operacion.incidencias force row level security;

drop policy if exists incidencias_select on operacion.incidencias;
create policy incidencias_select
  on operacion.incidencias
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or (identidad.claim_tipo_usuario() = 'seller' and seller_id = identidad.claim_seller_id())
    )
  );

drop policy if exists incidencias_insert_interno on operacion.incidencias;
create policy incidencias_insert_interno
  on operacion.incidencias
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists incidencias_update_interno on operacion.incidencias;
create policy incidencias_update_interno
  on operacion.incidencias
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

drop trigger if exists trg_incidencias_solo_interno_edita on operacion.incidencias;
create trigger trg_incidencias_solo_interno_edita
  before update on operacion.incidencias
  for each statement execute function identidad.solo_interno_edita();

-- -----------------------------------------------------------------------------
-- 12.5 operacion.evidencias_incidencia — P1 + P2
-- -----------------------------------------------------------------------------
alter table operacion.evidencias_incidencia enable row level security;
alter table operacion.evidencias_incidencia force row level security;

drop policy if exists evidencias_incidencia_select on operacion.evidencias_incidencia;
create policy evidencias_incidencia_select
  on operacion.evidencias_incidencia
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or (identidad.claim_tipo_usuario() = 'seller' and seller_id = identidad.claim_seller_id())
    )
  );

drop policy if exists evidencias_incidencia_insert_interno on operacion.evidencias_incidencia;
create policy evidencias_incidencia_insert_interno
  on operacion.evidencias_incidencia
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists evidencias_incidencia_update_interno on operacion.evidencias_incidencia;
create policy evidencias_incidencia_update_interno
  on operacion.evidencias_incidencia
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

drop trigger if exists trg_evidencias_solo_interno_edita on operacion.evidencias_incidencia;
create trigger trg_evidencias_solo_interno_edita
  before update on operacion.evidencias_incidencia
  for each statement execute function identidad.solo_interno_edita();

-- -----------------------------------------------------------------------------
-- 12.6 operacion.intentos_backfill — P1 estricta, SOLO service_role
-- -----------------------------------------------------------------------------
-- Sin políticas de SELECT/INSERT/UPDATE para `authenticated`: con FORCE RLS y
-- cero políticas de cliente, ningún usuario autenticado puede ver ni una fila.
-- Solo service_role (que bypassa RLS por diseño de Postgres/Supabase) accede.
-- NO se crea vista en public ni se otorgan privilegios a authenticated/anon.
alter table operacion.intentos_backfill enable row level security;
alter table operacion.intentos_backfill force row level security;

-- Revocar explícitamente cualquier privilegio heredado a roles de cliente.
revoke all on operacion.intentos_backfill from authenticated, anon, public;

-- =============================================================================
-- 13. Vistas en public con security_invoker = true
--     Las vistas son la superficie expuesta a PostgREST. Con security_invoker
--     = true, las políticas RLS se evalúan con los privilegios del ROL QUE
--     CONSULTA (authenticated), no con los del dueño de la vista (postgres,
--     que tiene rolbypassrls = true). Sin esto, la vista sería un bypass de RLS.
--     intentos_backfill NO se expone (solo service_role).
-- =============================================================================
create or replace view public.pedidos
  with (security_invoker = true)
  as select * from operacion.pedidos;

comment on view public.pedidos is
  'Espejo de operacion.pedidos para PostgREST. RLS heredada de la tabla base
   (security_invoker = true): P1 tenant + P2 seller + P3 conductor.';

create or replace view public.manifiestos
  with (security_invoker = true)
  as select * from operacion.manifiestos;

comment on view public.manifiestos is
  'Espejo de operacion.manifiestos para PostgREST. RLS: P1 + P3 conductor.
   El seller no tiene acceso a manifiestos.';

create or replace view public.asignaciones_pedido
  with (security_invoker = true)
  as select * from operacion.asignaciones_pedido;

comment on view public.asignaciones_pedido is
  'Espejo de operacion.asignaciones_pedido para PostgREST.
   RLS: P1 + (P2 seller OR P3 conductor).';

create or replace view public.incidencias
  with (security_invoker = true)
  as select * from operacion.incidencias;

comment on view public.incidencias is
  'Espejo de operacion.incidencias para PostgREST. RLS: P1 + P2 seller.
   El conductor no tiene acceso a incidencias.';

create or replace view public.evidencias_incidencia
  with (security_invoker = true)
  as select * from operacion.evidencias_incidencia;

comment on view public.evidencias_incidencia is
  'Espejo de operacion.evidencias_incidencia para PostgREST. RLS: P1 + P2 seller.
   storage_path es el path en Storage; las URLs firmadas se generan en la app.';

-- =============================================================================
-- 14. Grants de API
--     Las vistas security_invoker = true requieren que el rol que consulta
--     tenga privilegios DIRECTOS sobre las tablas base en `operacion` (no solo
--     sobre las vistas en `public`). Sin esto, PostgREST/la vista reciben
--     "permission denied for schema operacion" o "permission denied for table".
--     Patrón idéntico al de la migración 0001 §9.
--
--     SIN DELETE para authenticated: las eliminaciones son soft-delete (estado
--     = 'cancelado'/'cerrado') o solo vía service_role.
--     intentos_backfill: deliberadamente excluido de todo grant a authenticated.
-- =============================================================================
grant usage on schema operacion to authenticated, anon;

-- Privilegios directos sobre tablas base (requeridos por las vistas
-- security_invoker = true — mismo patrón que identidad en migración 0001).
grant select, insert, update on operacion.pedidos            to authenticated;
grant select, insert, update on operacion.manifiestos        to authenticated;
grant select, insert, update on operacion.asignaciones_pedido to authenticated;
grant select, insert, update on operacion.incidencias        to authenticated;
grant select, insert, update on operacion.evidencias_incidencia to authenticated;

-- Privilegios sobre las vistas en public
grant select, insert, update on public.pedidos               to authenticated;
grant select, insert, update on public.manifiestos           to authenticated;
grant select, insert, update on public.asignaciones_pedido   to authenticated;
grant select, insert, update on public.incidencias           to authenticated;
grant select, insert, update on public.evidencias_incidencia to authenticated;

-- service_role: BYPASSRLS salta políticas pero NO reemplaza GRANT SQL.
-- Necesita USAGE en el schema y privilegios en tablas para que las vistas
-- security_invoker=true funcionen cuando las consultan Server Components.
grant usage on schema operacion to service_role;
grant select, insert, update, delete on all tables in schema operacion to service_role;
