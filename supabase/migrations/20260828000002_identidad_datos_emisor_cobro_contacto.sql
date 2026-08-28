-- =============================================================================
-- Los datos del courier que el alta nunca pidió: emisor SII, cobro y contacto
-- =============================================================================
--
-- 🔴 QUÉ FALTABA, Y POR QUÉ SE NOTA TARDE
-- -----------------------------------------------------------------------------
-- `identidad.tenants` tenía SEIS columnas de negocio: nombre de fantasía, razón
-- social, RUT, estado, plan y zona horaria. El alta de empresa pide cinco datos
-- y la puesta en marcha otros cuatro pasos, y entre todo eso **nunca se pide**:
--
--   1. El **giro, la dirección, la comuna y la actividad económica** del
--      courier. Son parte obligatoria del bloque `Emisor` de una factura
--      electrónica (DTE 33) ante el SII. El adaptador manda hoy `RUTEmisor` y
--      `RznSoc` y nada más — ver `openfactura.ts`. Si el proveedor no los
--      rellena desde su propia configuración de cuenta, no hay de dónde
--      sacarlos.
--
--   2. **A qué cuenta le transfiere el seller.** No existía en ninguna tabla.
--      La factura sale, y el seller no tiene dónde leer a dónde pagar.
--
--   3. **Un teléfono y un correo de contacto.** La página pública de
--      seguimiento la firma el courier (`/tracking/[token]`) y solo muestra su
--      nombre de fantasía: quien espera un paquete no tiene a quién preguntar,
--      y termina llamando al seller — justo lo que el courier quiere evitar.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ EL EMISOR Y EL CONTACTO VAN EN `tenants` Y EL COBRO NO
-- -----------------------------------------------------------------------------
-- Giro, dirección, comuna y actividad económica son la MISMA cosa que
-- `razon_social` y `rut`: la identidad tributaria de la empresa, y juntas
-- forman el bloque `Emisor`. Partirlas entre dos tablas obligaría a un join
-- para armar un documento que es uno solo. El teléfono y el correo son
-- identidad pública de la empresa y viven al lado.
--
-- Los datos de cobro NO: tienen otro público. La cuenta bancaria es lo único
-- de acá que **el seller tiene que poder leer** —es a donde paga— y por eso va
-- en su propia tabla, con su propia política. Meterla en `tenants` obligaría a
-- abrirle esa fila entera al seller, incluido lo que no le corresponde.
--
-- 🔴 `public.tenants` HAY QUE REPONERLA, Y ESO NO ES OBVIO
-- -----------------------------------------------------------------------------
-- La vista espejo se creó como `select * from identidad.tenants` (migración
-- 0001), y la tentación es dar por hecho que una columna nueva «llega sola».
-- **No llega: Postgres EXPANDE el `select *` al crear la vista y guarda la
-- lista de columnas.** Agregar una columna a la tabla base no la agrega a la
-- vista, ni con `select *`.
--
-- Se comprobó en local, y falla del peor modo: la aplicación escribe el dato con
-- `service_role` sobre `identidad.tenants` —y queda guardado— pero lo LEE por la
-- vista con el cliente de sesión, así que la pantalla sigue diciendo «falta el
-- giro» con el giro ya escrito. Sin error, sin log.
--
-- ⚠️ Y al reponerla hay que repetir `with (security_invoker = true)`:
-- `create or replace view` conserva los GRANT pero **reemplaza las opciones**.
-- Perderlo haría que la vista corriera con los privilegios de su dueño y la RLS
-- de `identidad.tenants` dejaría de aplicarse a través de ella — el mismo fallo
-- de aislamiento que tuvo `public.conductores` en agosto.
--
-- Se aprovecha para reponer `seller_id_gasto_propio`, que arrastraba esta misma
-- omisión desde que se agregó. Hoy no rompe nada porque su único lector
-- (`dinero/jobs/generar-lineas.ts`) va por `.schema('identidad')` y esquiva la
-- vista — pero es la misma trampa esperando al próximo que use la vista.
--
-- -----------------------------------------------------------------------------
-- TODAS NULLABLE, Y NO ES DEJADEZ
-- -----------------------------------------------------------------------------
-- Hay couriers ya dados de alta. Una columna NOT NULL sin default rompería el
-- alta existente, y con default inventaría un dato tributario. La AUSENCIA es
-- el estado "sin configurar" y la pantalla de puesta en marcha lo dice con esas
-- palabras — el mismo criterio que `courier_config_retiro`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. identidad.tenants — el bloque Emisor completo y el contacto público
-- -----------------------------------------------------------------------------
alter table identidad.tenants
  add column if not exists giro                text,
  add column if not exists direccion           text,
  add column if not exists comuna              text,
  add column if not exists actividad_economica text,
  add column if not exists telefono_contacto   text,
  add column if not exists email_contacto      text;

comment on column identidad.tenants.giro is
  'Giro comercial del courier. Campo GiroEmis del bloque Emisor de un DTE 33. '
  'El SII lo trunca a 80 caracteres.';

comment on column identidad.tenants.direccion is
  'Dirección de la casa matriz. Campo DirOrigen del bloque Emisor de un DTE 33.';

comment on column identidad.tenants.comuna is
  'Comuna de la casa matriz. Campo CmnaOrigen del bloque Emisor de un DTE 33. '
  'OJO: no es una comuna de reparto — no tiene relación con identidad.zona_comunas.';

comment on column identidad.tenants.actividad_economica is
  'Código de actividad económica del SII (Acteco), 6 dígitos. El courier lo '
  'toma de su propia inscripción; Rutax no lo deduce del giro.';

comment on column identidad.tenants.telefono_contacto is
  'Teléfono público del courier, en E.164. Se muestra a quien espera un paquete '
  'en /tracking/[token], que hoy solo ve el nombre de fantasía.';

comment on column identidad.tenants.email_contacto is
  'Correo público de contacto del courier. Mismo uso que telefono_contacto.';

-- El Acteco del SII son 6 dígitos. Se valida el FORMATO y no la existencia:
-- Rutax no tiene el catálogo del SII y fingir que lo verifica sería peor que no
-- comprobar nada.
alter table identidad.tenants
  drop constraint if exists tenants_actividad_economica_formato;
alter table identidad.tenants
  add constraint tenants_actividad_economica_formato
    check (actividad_economica is null or actividad_economica ~ '^[0-9]{6}$');

-- E.164, el mismo CHECK que ya usa el teléfono del conductor (20260826000001):
-- una sola forma de guardar un número en todo el proyecto.
alter table identidad.tenants
  drop constraint if exists tenants_telefono_contacto_formato;
alter table identidad.tenants
  add constraint tenants_telefono_contacto_formato
    check (telefono_contacto is null or telefono_contacto ~ '^\+[1-9][0-9]{7,14}$');

alter table identidad.tenants
  drop constraint if exists tenants_email_contacto_formato;
alter table identidad.tenants
  add constraint tenants_email_contacto_formato
    check (email_contacto is null or email_contacto ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

-- -----------------------------------------------------------------------------
-- 1b. La vista espejo, repuesta con las columnas nuevas
-- -----------------------------------------------------------------------------
-- `create or replace` permite AÑADIR columnas al final, no quitarlas ni
-- reordenarlas: las nueve originales van primero y en su mismo orden.
create or replace view public.tenants
  with (security_invoker = true)
  as select
    id,
    nombre_fantasia,
    razon_social,
    rut,
    estado,
    plan_id,
    zona_horaria,
    creado_en,
    actualizado_en,
    seller_id_gasto_propio,
    giro,
    direccion,
    comuna,
    actividad_economica,
    telefono_contacto,
    email_contacto
  from identidad.tenants;

comment on view public.tenants is
  'Espejo de identidad.tenants para exponer vía API. RLS se hereda de la tabla
   base gracias a security_invoker = true. ⚠️ ENUMERA sus columnas: agregar una
   a la tabla base NO la agrega acá (el select * original se expandió al crear la
   vista), y la app leería siempre vacío ese campo.';

-- -----------------------------------------------------------------------------
-- 2. identidad.courier_datos_cobro — a qué cuenta le transfiere el seller
-- -----------------------------------------------------------------------------
-- 1:1 con el tenant, como courier_config_retiro y courier_config_payout.
--
-- ⚠️ NO confundir con `identidad.courier_config_cobranza`: esa guarda la
-- CONEXIÓN con Fintoc (link token, secreto de webhook, estado) para conciliar
-- los pagos que entran. Ésta guarda lo que hay que IMPRIMIRLE al seller para
-- que el pago exista. Se conectan en la vida real —normalmente es la misma
-- cuenta— pero son dos hechos distintos y uno puede existir sin el otro: se
-- puede cobrar por transferencia sin haber conectado el banco nunca.
--
-- ⚠️ El número de cuenta NO es un secreto: va impreso en cada factura y el
-- seller tiene que verlo. Por eso vive en una tabla de negocio normal y no en
-- `secretos_cifrados` — cifrar un dato que se publica en un PDF no protege
-- nada y sí impide mostrarlo.
-- -----------------------------------------------------------------------------
create table if not exists identidad.courier_datos_cobro (
  tenant_id       uuid primary key
    references identidad.tenants (id) on delete cascade,

  banco           text not null,
  tipo_cuenta     text not null
    constraint courier_datos_cobro_tipo_cuenta_valido
      check (tipo_cuenta in ('corriente', 'vista', 'ahorro')),
  numero_cuenta   text not null,

  -- Titular: puede no ser el mismo RUT del courier (una SpA que cobra en la
  -- cuenta de su matriz). Se pide explícito en vez de deducirlo del tenant.
  rut_titular     text not null
    constraint courier_datos_cobro_rut_formato
      check (rut_titular ~ '^[0-9]{1,8}-[0-9kK]$'),
  nombre_titular  text not null,

  -- A dónde avisa el seller que ya transfirió. Opcional: hay couriers que solo
  -- quieren la conciliación automática y ningún correo.
  email_aviso     text
    constraint courier_datos_cobro_email_formato
      check (email_aviso is null or email_aviso ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),

  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

comment on table identidad.courier_datos_cobro is
  'A qué cuenta bancaria le transfiere el seller al courier (1:1 con tenants). '
  'La AUSENCIA de fila significa "sin configurar": la factura sale igual y el '
  'seller no sabe a dónde pagar. Distinta de courier_config_cobranza, que es la '
  'conexión Fintoc para conciliar lo que entra.';

drop trigger if exists trg_courier_datos_cobro_actualizado_en on identidad.courier_datos_cobro;
create trigger trg_courier_datos_cobro_actualizado_en
  before update on identidad.courier_datos_cobro
  for each row execute function identidad.set_actualizado_en();

alter table identidad.courier_datos_cobro enable row level security;
alter table identidad.courier_datos_cobro force row level security;

-- 🔴 El seller SÍ la lee, y es la razón de que esta tabla exista aparte.
-- Se acota a su propio tenant: un seller ve la cuenta del courier que le
-- factura, nunca la de otro courier. El conductor no tiene nada que hacer acá.
drop policy if exists courier_datos_cobro_select on identidad.courier_datos_cobro;
create policy courier_datos_cobro_select on identidad.courier_datos_cobro
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() in ('interno', 'seller')
  );

-- Sin políticas de escritura: la configura la app con service_role, igual que
-- courier_config_retiro y courier_config_payout.
create or replace view public.courier_datos_cobro
  with (security_invoker = true)
  as select
    tenant_id,
    banco,
    tipo_cuenta,
    numero_cuenta,
    rut_titular,
    nombre_titular,
    email_aviso,
    creado_en,
    actualizado_en
  from identidad.courier_datos_cobro;

comment on view public.courier_datos_cobro is
  'Espejo de identidad.courier_datos_cobro para PostgREST. RLS heredada: P1 '
  'tenant + interno o seller del mismo tenant.';

grant select on identidad.courier_datos_cobro to authenticated;
grant select on public.courier_datos_cobro to authenticated;
grant all on identidad.courier_datos_cobro to service_role;
grant all on public.courier_datos_cobro to service_role;
