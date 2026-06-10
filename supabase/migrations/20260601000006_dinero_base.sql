-- =============================================================================
-- Migración 0006 · Dinero — Motor entrega→dinero (Fase C)
-- =============================================================================
-- Crea: schema `dinero`, 7 enums, 7 tablas de negocio (config_periodos,
-- periodos_cobro, documentos_dte, lineas_cobro, lineas_liquidacion,
-- liquidaciones, eventos_conciliacion), columnas en tablas existentes
-- (identidad.tarifas, identidad.tenants, operacion.pedidos),
-- función identidad.claim_rol(), RLS P1/P2/P3 conforme §3 del doc
-- fase-c-dinero.md, vistas en `public` con security_invoker = true y
-- grants para `authenticated`.
--
-- Idempotente: guards IF NOT EXISTS / OR REPLACE / DO-blocks en cada objeto.
-- Los DROPs van ANTES de los CREATEs que los redefinen para que la migración
-- pueda re-aplicarse sobre una base ya migrada.
--
-- Contrato de RLS (funciones de claims heredadas de Fase A):
--   identidad.claim_tenant_id()   → uuid del tenant del JWT
--   identidad.claim_tipo_usuario() → 'interno' | 'seller' | 'conductor' | 'super_admin'
--   identidad.claim_seller_id()   → uuid del seller (NULL salvo tipo='seller')
--   identidad.claim_driver_id()   → uuid del conductor (NULL salvo tipo='conductor')
--   identidad.claim_rol()         → text: 'dueno' | 'administracion' | … (NUEVA en esta migración)
-- =============================================================================

-- =============================================================================
-- 0. Preparación idempotente: remover objetos dependientes en orden inverso
-- =============================================================================

-- Vistas públicas
drop view if exists public.eventos_conciliacion cascade;
drop view if exists public.liquidaciones cascade;
drop view if exists public.lineas_liquidacion cascade;
drop view if exists public.documentos_dte cascade;
drop view if exists public.periodos_cobro cascade;
drop view if exists public.lineas_cobro cascade;
drop view if exists public.config_periodos cascade;

-- Tablas (en orden inverso de dependencias — hojas primero)
drop table if exists dinero.eventos_conciliacion cascade;
drop table if exists dinero.lineas_liquidacion cascade;
drop table if exists dinero.lineas_cobro cascade;
drop table if exists dinero.liquidaciones cascade;
drop table if exists dinero.documentos_dte cascade;
drop table if exists dinero.periodos_cobro cascade;
drop table if exists dinero.config_periodos cascade;

-- Enums (en orden inverso)
drop type if exists dinero.estado_evento_conciliacion cascade;
drop type if exists dinero.tipo_diferencia_conciliacion cascade;
drop type if exists dinero.origen_generacion cascade;
drop type if exists dinero.estado_liquidacion cascade;
drop type if exists dinero.estado_sii cascade;
drop type if exists dinero.tipo_periodo cascade;
drop type if exists dinero.estado_periodo cascade;

-- =============================================================================
-- 1. Columnas en tablas existentes
--    Todas con IF NOT EXISTS — idempotentes si ya existen.
-- =============================================================================

-- identidad.tarifas: monto que el courier paga al conductor por entrega.
-- Suficiente para el MVP; migrable a dinero.tarifas_conductor en V2.
alter table identidad.tarifas
  add column if not exists monto_conductor_clp numeric(12,0) not null default 0
    constraint tarifas_monto_conductor_no_negativo check (monto_conductor_clp >= 0);

-- identidad.tenants: seller de "gasto propio" — si el pedido pertenece a este
-- seller, el motor no genera línea de cobro (same-day como gasto del courier).
alter table identidad.tenants
  add column if not exists seller_id_gasto_propio uuid
    references identidad.sellers(id) on delete set null;

-- operacion.pedidos: flags que escribe el job C1 (motor entrega→dinero).
-- La migración 0005 ya declaró estas columnas como enteros; si existen,
-- IF NOT EXISTS los omite. Si la migración 0005 los declaró como integer
-- en lugar de NUMERIC(12,0), se conservan como están — compatible funcionalmente.
alter table operacion.pedidos
  add column if not exists cobro_generado boolean not null default false;

alter table operacion.pedidos
  add column if not exists monto_cobro_clp numeric(12,0)
    constraint pedidos_monto_cobro_no_negativo check (monto_cobro_clp >= 0);

alter table operacion.pedidos
  add column if not exists liquidacion_generada boolean not null default false;

alter table operacion.pedidos
  add column if not exists monto_liquidacion_clp numeric(12,0)
    constraint pedidos_monto_liquidacion_no_negativo check (monto_liquidacion_clp >= 0);

-- =============================================================================
-- 2. Schema y enums
-- =============================================================================
create schema if not exists dinero;

comment on schema dinero is
  'Módulo de Fase C: motor entrega→dinero, facturación DTE, liquidaciones de
   conductores, conciliación. Toda tabla lleva tenant_id. La escritura es
   exclusiva de service_role (jobs Inngest). Las vistas en public son la
   superficie expuesta a PostgREST.';

-- Los enums de Postgres no soportan IF NOT EXISTS — usamos DO-block.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'estado_periodo') then
    create type dinero.estado_periodo as enum ('abierto', 'cerrado', 'facturado', 'anulado');
  end if;

  if not exists (select 1 from pg_type where typname = 'tipo_periodo') then
    create type dinero.tipo_periodo as enum ('semanal', 'quincenal', 'mensual');
  end if;

  if not exists (select 1 from pg_type where typname = 'estado_sii') then
    create type dinero.estado_sii as enum (
      'pendiente',
      'aceptado',
      'rechazado',
      'aceptado_con_discrepancias'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'estado_liquidacion') then
    create type dinero.estado_liquidacion as enum ('borrador', 'emitida', 'pagada');
  end if;

  if not exists (select 1 from pg_type where typname = 'origen_generacion') then
    create type dinero.origen_generacion as enum ('motor_automatico', 'ajuste_manual');
  end if;

  if not exists (select 1 from pg_type where typname = 'tipo_diferencia_conciliacion') then
    create type dinero.tipo_diferencia_conciliacion as enum (
      'pedido_entregado_sin_linea_cobro',
      'pedido_entregado_sin_linea_liquidacion',
      'linea_cobro_sin_pedido_entregado',
      'folio_consumido_sin_dte_persistido',
      'periodo_cerrado_con_lineas_sueltas',
      'monto_dte_difiere_de_lineas'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'estado_evento_conciliacion') then
    create type dinero.estado_evento_conciliacion as enum (
      'pendiente',
      'revisado',
      'resuelto',
      'ignorado'
    );
  end if;
end $$;

-- =============================================================================
-- 3. Tablas
--    Orden: config_periodos (sin FKs internas) → periodos_cobro (sin documento_dte_id)
--    → documentos_dte (FK a periodos_cobro) → ADD COLUMN documento_dte_id en
--    periodos_cobro → lineas_cobro → liquidaciones → lineas_liquidacion
--    → eventos_conciliacion.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 3.1 dinero.config_periodos — configuración de cierre por tenant/seller (§2.8)
--     Sin FKs a otras tablas de dinero — va primero.
-- -----------------------------------------------------------------------------
create table dinero.config_periodos (
  id          uuid primary key default gen_random_uuid(),

  -- P1: tenant obligatorio en toda tabla de negocio.
  tenant_id   uuid not null references identidad.tenants(id) on delete restrict,

  -- NULL = configuración por defecto del tenant; con valor = override del seller.
  seller_id   uuid references identidad.sellers(id) on delete restrict,

  tipo_periodo text not null
    constraint config_periodos_tipo_periodo_valido
      check (tipo_periodo in ('semanal', 'quincenal', 'mensual')),

  -- Semanal: 1=lunes…7=domingo; quincenal: 15; mensual: NULL (último día).
  dia_cierre  integer
    constraint config_periodos_dia_cierre_rango
      check (dia_cierre is null or (dia_cierre >= 1 and dia_cierre <= 31)),

  activa      boolean not null default true,

  creado_en   timestamptz not null default now()
);

comment on table dinero.config_periodos is
  'Configuración del tipo de período de facturación por tenant (NULL seller_id)
   o por seller específico. Solo una configuración activa por tenant/seller
   simultáneamente (partial unique index). Solo roles internos la ven; los
   sellers y conductores no tienen acceso.';

-- Idempotencia: solo una config activa por tenant/seller.
create unique index if not exists config_periodos_tenant_seller_activa_uk
  on dinero.config_periodos (tenant_id, seller_id)
  where activa = true;

create index if not exists idx_config_periodos_tenant_id
  on dinero.config_periodos (tenant_id);

-- -----------------------------------------------------------------------------
-- 3.2 dinero.periodos_cobro — agrupa líneas de cobro de un seller (§2.4)
--     Se crea SIN documento_dte_id (se agrega en §3.4 para romper el ciclo
--     periodos_cobro ↔ documentos_dte).
-- -----------------------------------------------------------------------------
create table dinero.periodos_cobro (
  id                       uuid primary key default gen_random_uuid(),

  -- P1
  tenant_id                uuid not null references identidad.tenants(id) on delete restrict,

  -- P2 — RLS: seller ve solo sus períodos.
  seller_id                uuid not null references identidad.sellers(id) on delete restrict,

  fecha_inicio             date not null,
  fecha_fin                date not null,

  tipo_periodo             text not null
    constraint periodos_cobro_tipo_valido
      check (tipo_periodo in ('semanal', 'quincenal', 'mensual')),

  estado                   text not null default 'abierto'
    constraint periodos_cobro_estado_valido
      check (estado in ('abierto', 'cerrado', 'facturado', 'anulado')),

  total_lineas             integer not null default 0,
  monto_total_clp          numeric(12,0),

  -- documento_dte_id: FK hacia documentos_dte — se añade después (§3.4) para
  -- romper el ciclo de dependencia de creación entre las dos tablas.

  cerrado_en               timestamptz,
  cerrado_por_usuario_id   uuid,

  creado_en                timestamptz not null default now(),
  actualizado_en           timestamptz not null default now(),

  -- Idempotencia: no puede haber dos períodos del mismo seller con el mismo rango.
  constraint periodos_cobro_tenant_seller_rango_uk
    unique (tenant_id, seller_id, fecha_inicio, fecha_fin),

  constraint periodos_cobro_fechas_validas
    check (fecha_fin >= fecha_inicio)
);

comment on table dinero.periodos_cobro is
  'Agrupa líneas de cobro de un seller para un período. El cierre (job C2) suma
   las líneas y emite el evento que dispara el DTE (job C3). documento_dte_id
   apunta al DTE emitido (columna añadida después para romper el ciclo de FK).
   RLS: P1 tenant + P2 seller. Escritura: solo service_role.';

create index if not exists idx_periodos_tenant_seller
  on dinero.periodos_cobro (tenant_id, seller_id);

create index if not exists idx_periodos_abiertos
  on dinero.periodos_cobro (tenant_id, seller_id)
  where estado = 'abierto';

create index if not exists idx_periodos_estado
  on dinero.periodos_cobro (tenant_id, estado);

drop trigger if exists trg_periodos_cobro_actualizado_en on dinero.periodos_cobro;
create trigger trg_periodos_cobro_actualizado_en
  before update on dinero.periodos_cobro
  for each row execute function identidad.set_actualizado_en();

-- -----------------------------------------------------------------------------
-- 3.3 dinero.documentos_dte — registro permanente de cada DTE emitido (§2.5)
--     FK a periodos_cobro ya existe (forward reference resuelta porque la tabla
--     fue creada arriba).
-- -----------------------------------------------------------------------------
create table dinero.documentos_dte (
  id                        uuid primary key default gen_random_uuid(),

  -- P1
  tenant_id                 uuid not null references identidad.tenants(id) on delete restrict,

  -- P2 — RLS: seller ve sus propios DTE.
  seller_id                 uuid not null references identidad.sellers(id) on delete restrict,

  -- Relación con el período que originó este DTE.
  periodo_cobro_id          uuid not null references dinero.periodos_cobro(id) on delete restrict,

  -- 33 = factura electrónica, 61 = nota de crédito electrónica (SII Chile).
  tipo_documento            integer not null
    constraint documentos_dte_tipo_valido check (tipo_documento in (33, 61)),

  -- Folio consumido del CAF. Unique por (tenant, tipo, folio) — previene doble emisión.
  folio                     integer not null,

  fecha_emision             date not null,

  monto_neto_clp            numeric(12,0) not null,
  monto_iva_clp             numeric(12,0) not null,
  monto_total_clp           numeric(12,0) not null,

  -- Referencias opacas a Supabase Storage — firmadas, nunca inline.
  -- xml_dte_ref y pdf_ref contienen paths, no URLs: las URLs se generan como
  -- signed URLs de vida corta en la capa de aplicación.
  xml_dte_ref               text,
  pdf_ref                   text,

  -- ID asignado por el proveedor DTE externo.
  proveedor_dte_id_externo  text,

  estado_sii                text not null default 'pendiente'
    constraint documentos_dte_estado_sii_valido
      check (estado_sii in ('pendiente', 'aceptado', 'rechazado', 'aceptado_con_discrepancias')),

  estado_proveedor          text not null default 'pendiente',

  -- Error descriptivo sin tokens ni credenciales.
  error_descripcion         text,

  -- Nota de crédito que referencia a la factura original.
  dte_referencia_id         uuid references dinero.documentos_dte(id) on delete restrict,

  emitido_en                timestamptz not null default now(),
  creado_en                 timestamptz not null default now(),
  actualizado_en            timestamptz not null default now(),

  -- Idempotencia: previene doble emisión del mismo folio en el mismo tenant y tipo.
  constraint documentos_dte_tenant_tipo_folio_uk
    unique (tenant_id, tipo_documento, folio)
);

comment on table dinero.documentos_dte is
  'Registro permanente de cada DTE emitido por el courier al seller. xml_dte_ref
   y pdf_ref son paths en Storage; las URLs se generan como signed URLs de vida
   corta en la app — nunca expuestas en texto plano aquí. RLS: P1 + P2 seller.
   UNIQUE (tenant_id, tipo_documento, folio) previene doble emisión en reintento.
   Escritura: solo service_role.';

create index if not exists idx_dte_tenant_seller
  on dinero.documentos_dte (tenant_id, seller_id);

create index if not exists idx_dte_sii_pendiente
  on dinero.documentos_dte (tenant_id)
  where estado_sii = 'pendiente';

create index if not exists idx_dte_periodo
  on dinero.documentos_dte (periodo_cobro_id);

drop trigger if exists trg_documentos_dte_actualizado_en on dinero.documentos_dte;
create trigger trg_documentos_dte_actualizado_en
  before update on dinero.documentos_dte
  for each row execute function identidad.set_actualizado_en();

-- -----------------------------------------------------------------------------
-- 3.4 Romper el ciclo: añadir documento_dte_id en periodos_cobro
--     Ahora que documentos_dte existe, se puede añadir la FK inversa.
-- -----------------------------------------------------------------------------
alter table dinero.periodos_cobro
  add column if not exists documento_dte_id uuid
    references dinero.documentos_dte(id) on delete set null;

-- -----------------------------------------------------------------------------
-- 3.5 dinero.lineas_cobro — una fila por pedido elegible (§2.2)
--     Monto que el courier cobra al seller.
-- -----------------------------------------------------------------------------
create table dinero.lineas_cobro (
  id                       uuid primary key default gen_random_uuid(),

  -- P1
  tenant_id                uuid not null references identidad.tenants(id) on delete restrict,

  -- P2 — RLS: seller ve solo sus líneas.
  seller_id                uuid not null references identidad.sellers(id) on delete restrict,

  -- UNIQUE: idempotencia del job C1 (ON CONFLICT DO NOTHING).
  pedido_id                uuid not null unique references operacion.pedidos(id) on delete restrict,

  -- Asignado inline al generar la línea.
  periodo_cobro_id         uuid references dinero.periodos_cobro(id) on delete restrict,

  -- Tarifa vigente al momento de la entrega — no usar la tarifa actual.
  tarifa_id                uuid not null references identidad.tarifas(id) on delete restrict,

  monto_base_clp           numeric(12,0) not null
    constraint lineas_cobro_monto_base_no_negativo check (monto_base_clp >= 0),

  -- Negativo si la incidencia descuenta; positivo si recarga.
  ajuste_incidencia_clp    numeric(12,0) not null default 0,

  -- Columna generada: monto_base + ajuste. El CHECK en columna generada
  -- debe expresarse como constraint de nombre en la tabla, no inline.
  monto_final_clp          numeric(12,0) generated always as
                             (monto_base_clp + ajuste_incidencia_clp) stored,

  constraint lineas_cobro_monto_final_positivo
    check (monto_base_clp + ajuste_incidencia_clp >= 0),

  -- Descripción para el DTE.
  concepto                 text not null,

  tipo_pedido              text not null
    constraint lineas_cobro_tipo_pedido_valido check (tipo_pedido in ('flex', 'same_day')),

  -- Fecha de la entrega en zona America/Santiago.
  fecha_entrega            date not null,

  -- Si una incidencia ajustó el cobro, se registra aquí.
  incidencia_id            uuid references operacion.incidencias(id) on delete restrict,

  origen_generacion        text not null default 'motor_automatico'
    constraint lineas_cobro_origen_valido
      check (origen_generacion in ('motor_automatico', 'ajuste_manual')),

  -- Solo para ajustes manuales.
  generado_por_usuario_id  uuid,

  notas                    text,

  creado_en                timestamptz not null default now(),
  actualizado_en           timestamptz not null default now()
);

comment on table dinero.lineas_cobro is
  'Una fila por pedido elegible: monto que el courier cobra al seller. UNIQUE en
   pedido_id garantiza idempotencia del job C1 (ON CONFLICT DO NOTHING). La
   columna monto_final_clp es GENERATED (monto_base + ajuste_incidencia).
   RLS: P1 tenant + P2 seller. Conductores no acceden. Escritura: solo service_role.';

create index if not exists idx_lineas_cobro_tenant_id
  on dinero.lineas_cobro (tenant_id);

create index if not exists idx_lineas_cobro_seller_periodo
  on dinero.lineas_cobro (tenant_id, seller_id, periodo_cobro_id);

create index if not exists idx_lineas_cobro_sin_periodo
  on dinero.lineas_cobro (tenant_id, seller_id)
  where periodo_cobro_id is null;

create index if not exists idx_lineas_cobro_fecha
  on dinero.lineas_cobro (tenant_id, fecha_entrega);

drop trigger if exists trg_lineas_cobro_actualizado_en on dinero.lineas_cobro;
create trigger trg_lineas_cobro_actualizado_en
  before update on dinero.lineas_cobro
  for each row execute function identidad.set_actualizado_en();

-- -----------------------------------------------------------------------------
-- 3.6 dinero.liquidaciones — documento de liquidación conductor por período (§2.6)
--     Se crea ANTES de lineas_liquidacion porque esta tabla la referencia.
-- -----------------------------------------------------------------------------
create table dinero.liquidaciones (
  id                        uuid primary key default gen_random_uuid(),

  -- P1
  tenant_id                 uuid not null references identidad.tenants(id) on delete restrict,

  -- P3 — RLS: conductor ve solo las suyas.
  driver_id                 uuid not null references identidad.conductores(id) on delete restrict,

  fecha_inicio              date not null,
  fecha_fin                 date not null,

  tipo_periodo              text not null
    constraint liquidaciones_tipo_periodo_valido
      check (tipo_periodo in ('semanal', 'quincenal', 'mensual')),

  estado                    text not null default 'borrador'
    constraint liquidaciones_estado_valido
      check (estado in ('borrador', 'emitida', 'pagada')),

  total_entregas            integer not null default 0,
  monto_total_clp           numeric(12,0),

  -- 'dependiente' o 'independiente' — copiado de conductores.tipo_relacion al
  -- generar la liquidación para preservar el valor histórico.
  tipo_relacion_conductor   text not null
    constraint liquidaciones_tipo_relacion_valido
      check (tipo_relacion_conductor in ('dependiente', 'independiente')),

  -- Referencia opaca al PDF en Storage — signed URLs en la capa de aplicación.
  pdf_ref                   text,

  notas                     text,

  generado_en               timestamptz,
  generado_por_usuario_id   uuid,

  creado_en                 timestamptz not null default now(),
  actualizado_en            timestamptz not null default now(),

  -- Idempotencia: no puede haber dos liquidaciones del mismo conductor y período.
  constraint liquidaciones_tenant_driver_rango_uk
    unique (tenant_id, driver_id, fecha_inicio, fecha_fin),

  constraint liquidaciones_fechas_validas
    check (fecha_fin >= fecha_inicio)
);

comment on table dinero.liquidaciones is
  'Documento de liquidación del courier al conductor por un período. pdf_ref es
   path en Storage — signed URLs de vida corta generadas en la app; nunca
   expuesto como URL pública. tipo_relacion_conductor copiado al generar (histórico).
   RLS: P1 + P3 conductor. Sellers no acceden. Escritura: solo service_role.';

create index if not exists idx_liquidaciones_tenant_driver
  on dinero.liquidaciones (tenant_id, driver_id);

create index if not exists idx_liquidaciones_estado
  on dinero.liquidaciones (tenant_id, estado);

drop trigger if exists trg_liquidaciones_actualizado_en on dinero.liquidaciones;
create trigger trg_liquidaciones_actualizado_en
  before update on dinero.liquidaciones
  for each row execute function identidad.set_actualizado_en();

-- -----------------------------------------------------------------------------
-- 3.7 dinero.lineas_liquidacion — una fila por pedido elegible (§2.3)
--     Monto que el courier paga al conductor.
-- -----------------------------------------------------------------------------
create table dinero.lineas_liquidacion (
  id                       uuid primary key default gen_random_uuid(),

  -- P1
  tenant_id                uuid not null references identidad.tenants(id) on delete restrict,

  -- P3 — RLS: conductor ve solo las suyas.
  driver_id                uuid not null references identidad.conductores(id) on delete restrict,

  -- UNIQUE: idempotencia del job C1 (ON CONFLICT DO NOTHING).
  pedido_id                uuid not null unique references operacion.pedidos(id) on delete restrict,

  -- Asignado al cerrar el período.
  liquidacion_id           uuid references dinero.liquidaciones(id) on delete restrict,

  monto_base_clp           numeric(12,0) not null
    constraint lineas_liq_monto_base_no_negativo check (monto_base_clp >= 0),

  ajuste_incidencia_clp    numeric(12,0) not null default 0,

  -- Columna generada.
  monto_final_clp          numeric(12,0) generated always as
                             (monto_base_clp + ajuste_incidencia_clp) stored,

  constraint lineas_liq_monto_final_positivo
    check (monto_base_clp + ajuste_incidencia_clp >= 0),

  concepto                 text not null,

  fecha_entrega            date not null,

  incidencia_id            uuid references operacion.incidencias(id) on delete restrict,

  origen_generacion        text not null default 'motor_automatico'
    constraint lineas_liq_origen_valido
      check (origen_generacion in ('motor_automatico', 'ajuste_manual')),

  generado_por_usuario_id  uuid,

  notas                    text,

  creado_en                timestamptz not null default now(),
  actualizado_en           timestamptz not null default now()
);

comment on table dinero.lineas_liquidacion is
  'Una fila por pedido elegible: monto que el courier paga al conductor. UNIQUE en
   pedido_id garantiza idempotencia del job C1 (ON CONFLICT DO NOTHING). La
   columna monto_final_clp es GENERATED (monto_base + ajuste_incidencia).
   RLS: P1 tenant + P3 conductor. Sellers no acceden. Escritura: solo service_role.';

create index if not exists idx_lineas_liq_tenant_id
  on dinero.lineas_liquidacion (tenant_id);

create index if not exists idx_lineas_liq_driver_liquidacion
  on dinero.lineas_liquidacion (tenant_id, driver_id, liquidacion_id);

create index if not exists idx_lineas_liq_sin_liquidacion
  on dinero.lineas_liquidacion (tenant_id, driver_id)
  where liquidacion_id is null;

create index if not exists idx_lineas_liq_fecha
  on dinero.lineas_liquidacion (tenant_id, fecha_entrega);

drop trigger if exists trg_lineas_liq_actualizado_en on dinero.lineas_liquidacion;
create trigger trg_lineas_liq_actualizado_en
  before update on dinero.lineas_liquidacion
  for each row execute function identidad.set_actualizado_en();

-- -----------------------------------------------------------------------------
-- 3.8 dinero.eventos_conciliacion — log append-only de diferencias (§2.7)
--     Solo internos con rol 'dueno' o 'administracion'. Sellers y conductores
--     no acceden.
-- -----------------------------------------------------------------------------
create table dinero.eventos_conciliacion (
  id                       uuid primary key default gen_random_uuid(),

  -- P1
  tenant_id                uuid not null references identidad.tenants(id) on delete restrict,

  -- Referencia opcional al seller afectado.
  seller_id                uuid references identidad.sellers(id) on delete restrict,

  -- Referencia opcional al período donde se detectó la diferencia.
  periodo_cobro_id         uuid references dinero.periodos_cobro(id) on delete restrict,

  tipo_diferencia          text not null
    constraint eventos_conciliacion_tipo_valido
      check (tipo_diferencia in (
        'pedido_entregado_sin_linea_cobro',
        'pedido_entregado_sin_linea_liquidacion',
        'linea_cobro_sin_pedido_entregado',
        'folio_consumido_sin_dte_persistido',
        'periodo_cerrado_con_lineas_sueltas',
        'monto_dte_difiere_de_lineas'
      )),

  -- Pedido relacionado con la diferencia.
  pedido_id                uuid references operacion.pedidos(id) on delete restrict,

  descripcion              text not null,

  monto_diferencia_clp     numeric(12,0),

  estado                   text not null default 'pendiente'
    constraint eventos_conciliacion_estado_valido
      check (estado in ('pendiente', 'revisado', 'resuelto', 'ignorado')),

  resuelto_por_usuario_id  uuid,
  resuelto_en              timestamptz,

  -- ID del run de Inngest — trazabilidad del job que lo generó.
  job_run_id               text,

  creado_en                timestamptz not null default now()

  -- Sin actualizado_en: tabla append-only. Los eventos no se modifican;
  -- el estado de resolución es la única excepción (tolerable; si se quiere
  -- inmutabilidad estricta, se usa un evento nuevo de tipo 'resuelto').
);

comment on table dinero.eventos_conciliacion is
  'Log append-only de diferencias detectadas por el job C6. No es una tabla de
   estado mutable — registra hallazgos. RLS P1 + solo dueno/administracion.
   Sellers y conductores no acceden jamás. Escritura: solo service_role.';

create index if not exists idx_conciliacion_tenant_estado
  on dinero.eventos_conciliacion (tenant_id, estado);

create index if not exists idx_conciliacion_periodo
  on dinero.eventos_conciliacion (periodo_cobro_id);

create index if not exists idx_conciliacion_pedido
  on dinero.eventos_conciliacion (pedido_id);

-- =============================================================================
-- 4. Función identidad.claim_rol()
--    Lee el claim 'rol' del JWT (análoga a claim_tipo_usuario()). Usada en la
--    política de eventos_conciliacion para verificar 'dueno'/'administracion'.
-- =============================================================================
create or replace function identidad.claim_rol()
returns text
language sql
stable
parallel safe
as $$
  select coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'rol',
    ''
  )
$$;

comment on function identidad.claim_rol() is
  'Lee el claim "rol" del JWT (inyectado por el custom access token hook):
   dueno | supervisor | coordinador | administracion | conductor | seller.
   Retorna string vacío si no hay claims (sin sesión). Usada en la política
   RLS de dinero.eventos_conciliacion.';

grant execute on function identidad.claim_rol() to authenticated, anon;

-- =============================================================================
-- 5. RLS — activar y aplicar políticas para cada tabla de dinero
--
-- Regla: solo SELECT para `authenticated` (NUNCA INSERT/UPDATE/DELETE).
-- Toda escritura es exclusiva de service_role (jobs Inngest).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 5.1 dinero.config_periodos — P1 estricta, solo roles internos
-- -----------------------------------------------------------------------------
alter table dinero.config_periodos enable row level security;
alter table dinero.config_periodos force row level security;

drop policy if exists config_periodos_select on dinero.config_periodos;
create policy config_periodos_select
  on dinero.config_periodos
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

-- -----------------------------------------------------------------------------
-- 5.2 dinero.periodos_cobro — P1 + P2 (seller ve sus períodos)
-- -----------------------------------------------------------------------------
alter table dinero.periodos_cobro enable row level security;
alter table dinero.periodos_cobro force row level security;

drop policy if exists periodos_cobro_select on dinero.periodos_cobro;
create policy periodos_cobro_select
  on dinero.periodos_cobro
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

-- -----------------------------------------------------------------------------
-- 5.3 dinero.documentos_dte — P1 + P2 (seller ve y descarga sus DTE)
-- -----------------------------------------------------------------------------
alter table dinero.documentos_dte enable row level security;
alter table dinero.documentos_dte force row level security;

drop policy if exists documentos_dte_select on dinero.documentos_dte;
create policy documentos_dte_select
  on dinero.documentos_dte
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

-- -----------------------------------------------------------------------------
-- 5.4 dinero.lineas_cobro — P1 + P2 (seller ve solo sus líneas)
-- -----------------------------------------------------------------------------
alter table dinero.lineas_cobro enable row level security;
alter table dinero.lineas_cobro force row level security;

drop policy if exists lineas_cobro_select on dinero.lineas_cobro;
create policy lineas_cobro_select
  on dinero.lineas_cobro
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

-- -----------------------------------------------------------------------------
-- 5.5 dinero.liquidaciones — P1 + P3 (conductor ve solo las suyas)
-- -----------------------------------------------------------------------------
alter table dinero.liquidaciones enable row level security;
alter table dinero.liquidaciones force row level security;

drop policy if exists liquidaciones_select on dinero.liquidaciones;
create policy liquidaciones_select
  on dinero.liquidaciones
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or (
        identidad.claim_tipo_usuario() = 'conductor'
        and driver_id = identidad.claim_driver_id()
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 5.6 dinero.lineas_liquidacion — P1 + P3 (conductor ve solo las suyas)
-- -----------------------------------------------------------------------------
alter table dinero.lineas_liquidacion enable row level security;
alter table dinero.lineas_liquidacion force row level security;

drop policy if exists lineas_liquidacion_select on dinero.lineas_liquidacion;
create policy lineas_liquidacion_select
  on dinero.lineas_liquidacion
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and (
      identidad.claim_tipo_usuario() = 'interno'
      or (
        identidad.claim_tipo_usuario() = 'conductor'
        and driver_id = identidad.claim_driver_id()
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 5.7 dinero.eventos_conciliacion — P1 restringida: solo dueno/administracion
--     Sellers y conductores no acceden. Internos con otros roles tampoco.
-- -----------------------------------------------------------------------------
alter table dinero.eventos_conciliacion enable row level security;
alter table dinero.eventos_conciliacion force row level security;

drop policy if exists eventos_conciliacion_select on dinero.eventos_conciliacion;
create policy eventos_conciliacion_select
  on dinero.eventos_conciliacion
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
    and identidad.claim_rol() in ('dueno', 'administracion')
  );

-- =============================================================================
-- 6. Vistas en schema public con security_invoker = true
--    Las políticas RLS se evalúan con los privilegios del ROL QUE CONSULTA
--    (authenticated), no con los del dueño de la vista. Sin esto, la vista
--    sería un bypass de RLS de facto.
-- =============================================================================
create or replace view public.config_periodos
  with (security_invoker = true)
  as select * from dinero.config_periodos;

comment on view public.config_periodos is
  'Espejo de dinero.config_periodos para PostgREST. RLS heredada: P1 interno.';

create or replace view public.periodos_cobro
  with (security_invoker = true)
  as select * from dinero.periodos_cobro;

comment on view public.periodos_cobro is
  'Espejo de dinero.periodos_cobro para PostgREST. RLS heredada: P1 + P2 seller.';

create or replace view public.documentos_dte
  with (security_invoker = true)
  as select * from dinero.documentos_dte;

comment on view public.documentos_dte is
  'Espejo de dinero.documentos_dte para PostgREST. RLS heredada: P1 + P2 seller.
   xml_dte_ref y pdf_ref son paths en Storage; las URLs se generan como signed
   URLs de vida corta en la app, nunca expuestas directamente.';

create or replace view public.lineas_cobro
  with (security_invoker = true)
  as select * from dinero.lineas_cobro;

comment on view public.lineas_cobro is
  'Espejo de dinero.lineas_cobro para PostgREST. RLS heredada: P1 + P2 seller.
   Conductores no tienen acceso.';

create or replace view public.liquidaciones
  with (security_invoker = true)
  as select * from dinero.liquidaciones;

comment on view public.liquidaciones is
  'Espejo de dinero.liquidaciones para PostgREST. RLS heredada: P1 + P3 conductor.
   Sellers no tienen acceso.';

create or replace view public.lineas_liquidacion
  with (security_invoker = true)
  as select * from dinero.lineas_liquidacion;

comment on view public.lineas_liquidacion is
  'Espejo de dinero.lineas_liquidacion para PostgREST. RLS heredada: P1 + P3 conductor.
   Sellers no tienen acceso.';

create or replace view public.eventos_conciliacion
  with (security_invoker = true)
  as select * from dinero.eventos_conciliacion;

comment on view public.eventos_conciliacion is
  'Espejo de dinero.eventos_conciliacion para PostgREST. RLS heredada: P1 + solo
   roles internos dueno/administracion. Sellers y conductores no acceden.';

-- =============================================================================
-- 7. Grants
--    Patrón idéntico a las migraciones anteriores: USAGE en el schema,
--    SELECT directo sobre las tablas base (requerido por security_invoker = true),
--    y REVOKE explícito de INSERT/UPDATE/DELETE — defensa en profundidad.
-- =============================================================================
grant usage on schema dinero to authenticated, anon;

-- Privilegios SELECT directos sobre tablas base (requeridos por las vistas
-- security_invoker = true; sin esto PostgREST/la vista reciben permission denied).
grant select on dinero.config_periodos       to authenticated;
grant select on dinero.periodos_cobro        to authenticated;
grant select on dinero.documentos_dte        to authenticated;
grant select on dinero.lineas_cobro          to authenticated;
grant select on dinero.liquidaciones         to authenticated;
grant select on dinero.lineas_liquidacion    to authenticated;
grant select on dinero.eventos_conciliacion  to authenticated;

-- Revocar explícitamente INSERT/UPDATE/DELETE para authenticated.
-- Con FORCE ROW LEVEL SECURITY y sin políticas de escritura esto ya es efectivo,
-- pero la revocación explícita es defensa en profundidad adicional.
revoke insert, update, delete on dinero.config_periodos       from authenticated, anon;
revoke insert, update, delete on dinero.periodos_cobro        from authenticated, anon;
revoke insert, update, delete on dinero.documentos_dte        from authenticated, anon;
revoke insert, update, delete on dinero.lineas_cobro          from authenticated, anon;
revoke insert, update, delete on dinero.liquidaciones         from authenticated, anon;
revoke insert, update, delete on dinero.lineas_liquidacion    from authenticated, anon;
revoke insert, update, delete on dinero.eventos_conciliacion  from authenticated, anon;

-- Privilegios SELECT sobre las vistas en public.
grant select on public.config_periodos       to authenticated;
grant select on public.periodos_cobro        to authenticated;
grant select on public.documentos_dte        to authenticated;
grant select on public.lineas_cobro          to authenticated;
grant select on public.liquidaciones         to authenticated;
grant select on public.lineas_liquidacion    to authenticated;
grant select on public.eventos_conciliacion  to authenticated;

-- Revocar INSERT/UPDATE/DELETE en vistas también.
revoke insert, update, delete on public.config_periodos       from authenticated, anon;
revoke insert, update, delete on public.periodos_cobro        from authenticated, anon;
revoke insert, update, delete on public.documentos_dte        from authenticated, anon;
revoke insert, update, delete on public.lineas_cobro          from authenticated, anon;
revoke insert, update, delete on public.liquidaciones         from authenticated, anon;
revoke insert, update, delete on public.lineas_liquidacion    from authenticated, anon;
revoke insert, update, delete on public.eventos_conciliacion  from authenticated, anon;

-- =============================================================================
-- service_role: grants en schemas custom
-- BYPASSRLS salta políticas RLS pero NO reemplaza GRANT SQL. Los Server
-- Components que usan crearClienteServiceRole() necesitan USAGE en el schema
-- y privilegios en las tablas base (las vistas security_invoker=true los
-- heredan del caller).
-- Nota: operacion ya se granteó en la migración 0005. Aquí dinero + identidad.
-- =============================================================================
grant usage on schema identidad to service_role;
grant usage on schema dinero    to service_role;
grant select, insert, update, delete on all tables in schema identidad to service_role;
grant select, insert, update, delete on all tables in schema dinero    to service_role;
