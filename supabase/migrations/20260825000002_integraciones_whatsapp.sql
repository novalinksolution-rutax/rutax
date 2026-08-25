-- =============================================================================
-- WhatsApp Cloud API — contactos y bitácora de mensajes
-- =============================================================================
--
-- Rutax envía notificaciones desde UN SOLO número oficial (la WABA de Rutax) a
-- los contactos de TODOS los couriers: relación 1:N, decisión del usuario
-- (2026-08-25). Ningún courier conecta su propio WhatsApp — el emisor es
-- siempre nuestro y los tenants son solo destinatarios.
--
-- Eso hace que la CREDENCIAL sea de plataforma (variable de entorno, como la de
-- Resend o la de payouts) y que acá abajo no haya un solo token: esta migración
-- es el DIRECTORIO de a quién se le escribe y el REGISTRO de qué se le escribió.
--
-- ⚠️ CONSECUENCIA ASUMIDA DEL NÚMERO ÚNICO: la calificación de calidad que Meta
-- le pone al número es COMPARTIDA por todos los tenants. Si los destinatarios de
-- un courier bloquean o reportan, el límite diario baja para todos los demás.
-- RLS no cubre esto — no es aislamiento de datos, es de entregabilidad, y no
-- existe. La mitigación disponible es el opt-in estricto de más abajo.
--
-- -----------------------------------------------------------------------------
-- DOS TABLAS, Y POR QUÉ NO HAY UNA TERCERA PARA LAS PLANTILLAS
-- -----------------------------------------------------------------------------
-- `whatsapp_contactos` y `whatsapp_mensajes` crecen con cada courier (sus
-- sellers, sus bodegas, sus avisos), así que por el test mecánico del proyecto
-- —"si dar de alta un courier agrega filas, la tabla es de negocio"— llevan
-- `tenant_id` y RLS forzada, sin discusión.
--
-- El catálogo de plantillas NO es una tabla, y esa fue una decisión tomada
-- contra el diseño inicial. Vive en TypeScript
-- (`notificaciones/whatsapp/catalogo-plantillas.ts`) por dos razones:
--
--  1. **Es código, no datos.** El catálogo dice cuántas variables lleva cada
--     plantilla y en qué orden; eso está atado al sitio que las manda. En una
--     tabla, el código y la fila pueden discrepar y **la fila gana en tiempo de
--     ejecución**, mandando datos en el orden equivocado sin que nada falle.
--
--  2. **Un estado de aprobación guardado se vuelve un filtro obsoleto.** La
--     tentación era guardar `estado_meta` y no enviar salvo que diga
--     `aprobada`. Ese patrón ya mordió en este repo el 2026-08-25: la lista
--     blanca de estados de ML escondió el botón de etiqueta en 5 de 8 pedidos
--     que SÍ funcionaban. Los dos errores no cuestan lo mismo — bloquear un
--     aviso que Meta sí habría aceptado detiene la operación, mientras que
--     intentarlo y recibir un 400 cuesta una llamada que Meta **no cobra**
--     (solo se factura la conversación que se entrega). Así que la autoridad
--     sobre si una plantilla sirve es Meta, en el momento del envío.
--
-- -----------------------------------------------------------------------------
-- MINIMIZACIÓN: LO QUE ESTAS TABLAS NO GUARDAN
-- -----------------------------------------------------------------------------
-- La bitácora NO guarda el cuerpo renderizado ni el número de destino: guarda
-- las VARIABLES de la plantilla y un FK al contacto. Duplicar el teléfono en
-- cada fila multiplicaría el dato personal por cada aviso enviado sin agregar
-- nada que no se pueda reconstruir con un join. Tampoco guarda el token de la
-- Cloud API: ese vive en el entorno y jamás toca la base ni un log.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. integraciones.whatsapp_contactos — a quién se le puede escribir
-- -----------------------------------------------------------------------------
--
-- ⚠️ EL CONTACTO APUNTA A LA ENTIDAD QUE REPRESENTA, NO SOLO A SU "TIPO".
--
-- Con un `rol` de texto suelto —la forma obvia— la única consulta posible sería
-- «todos los contactos con rol seller de este courier», o sea TODOS sus
-- sellers. Y el aviso que motivó esta integración dice «retiramos N pedidos
-- desde TU bodega»: va a UN seller, el dueño de esa bodega. Sin el FK, el
-- destinatario correcto no se puede ni expresar.
--
-- Por eso van FKs reales y excluyentes. Es además el precedente de la casa:
-- `seller_bodegas` y `courier_bodegas` se partieron en dos tablas en vez de
-- usar un discriminador, exactamente por esto.
create table if not exists integraciones.whatsapp_contactos (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references identidad.tenants (id) on delete cascade,

  -- Qué papel juega este número. Decide QUÉ avisos recibe y, junto con el CHECK
  -- de abajo, cuál de los tres FKs tiene que venir poblado.
  rol            text not null check (rol in ('seller', 'courier', 'bodega')),

  -- A quién representa. Exactamente uno según el rol (ver CHECK). El rol
  -- `courier` no lleva ninguno: es un contacto del courier como empresa
  -- (el coordinador de turno, el grupo de operaciones).
  seller_id      uuid references identidad.sellers (id) on delete cascade,
  bodega_id      uuid references identidad.seller_bodegas (id) on delete cascade,

  -- E.164 SIN el `+`, que es como lo quiere la Cloud API en el campo `to`
  -- (`56912345678`). El CHECK es la última red: la normalización ocurre antes,
  -- en `normalizarTelefonoE164`.
  telefono_e164  text not null check (telefono_e164 ~ '^[1-9][0-9]{7,14}$'),

  -- Nombre para referirse al contacto en pantalla. NO viaja a Meta.
  etiqueta       text,

  -- -------------------------------------------------------------------------
  -- CONSENTIMIENTO: `pendiente` por defecto, y `pendiente` NO deja enviar
  -- -------------------------------------------------------------------------
  -- WhatsApp exige opt-in previo y lo audita: mandar sin él degrada la calidad
  -- del número y puede terminar en el bloqueo de la WABA entera — la de Rutax,
  -- que es una sola para todos los couriers. Por eso el default es el estado
  -- que NO deja enviar: dar de alta un contacto nunca es, por sí solo, permiso
  -- para escribirle.
  --
  -- El opt-in lo DECLARA el courier al dar de alta (decisión del usuario,
  -- 2026-08-25) y queda en `bitacora_auditoria` con autor y fecha. `revocado`
  -- lo escribe también el webhook cuando el destinatario responde BAJA/STOP.
  opt_in_estado  text not null default 'pendiente'
                 check (opt_in_estado in ('pendiente', 'otorgado', 'revocado')),
  opt_in_en      timestamptz,

  idioma         text not null default 'es_CL',
  zona_horaria   text not null default 'America/Santiago',

  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  -- Coherencia entre el estado y su fecha: `otorgado` sin fecha deja la
  -- auditoría de consentimiento sin el "cuándo", que es justo lo que habría que
  -- mostrar si Meta lo pregunta.
  constraint whatsapp_contactos_opt_in_fecha
    check (opt_in_estado <> 'otorgado' or opt_in_en is not null),

  -- El rol manda cuál FK viene. Sin esto, un contacto podría decir `bodega` y
  -- no traer bodega, y el envío se quedaría sin destinatario resoluble.
  constraint whatsapp_contactos_destino_segun_rol check (
    (rol = 'seller'  and seller_id is not null and bodega_id is null) or
    (rol = 'bodega'  and bodega_id is not null and seller_id is null) or
    (rol = 'courier' and seller_id is null     and bodega_id is null)
  )
);

-- El mismo número no se registra dos veces para el mismo destino dentro de un
-- courier: sin esto, un alta duplicada manda el aviso dos veces al mismo
-- teléfono y cada envío se cobra. `coalesce` porque un NULL no colisiona con
-- otro NULL en un índice único, y el rol `courier` los tiene ambos nulos.
create unique index if not exists whatsapp_contactos_uk
  on integraciones.whatsapp_contactos (
    tenant_id,
    rol,
    coalesce(seller_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(bodega_id, '00000000-0000-0000-0000-000000000000'::uuid),
    telefono_e164
  );

-- El lookup que manda: "los contactos de este courier con este papel que SÍ
-- consintieron". Es la consulta exacta que hace el servicio de envío.
create index if not exists idx_whatsapp_contactos_destinatarios
  on integraciones.whatsapp_contactos (tenant_id, rol)
  where opt_in_estado = 'otorgado';

-- Por acá entra el webhook cuando alguien responde BAJA: llega un teléfono y
-- hay que dar con sus contactos, sin saber de qué tenant son.
create index if not exists idx_whatsapp_contactos_telefono
  on integraciones.whatsapp_contactos (telefono_e164);

create index if not exists idx_whatsapp_contactos_seller
  on integraciones.whatsapp_contactos (tenant_id, seller_id)
  where seller_id is not null;

create index if not exists idx_whatsapp_contactos_bodega
  on integraciones.whatsapp_contactos (tenant_id, bodega_id)
  where bodega_id is not null;

comment on table integraciones.whatsapp_contactos is
  'Directorio de destinatarios de WhatsApp por courier. El emisor es siempre el
   numero oficial de Rutax (1:N); aca solo viven los destinos. Cada fila apunta
   a la entidad que representa (seller o bodega) via FK, no solo a su tipo.
   Solo se envia a filas con opt_in_estado otorgado.';

comment on column integraciones.whatsapp_contactos.telefono_e164 is
  'E.164 sin el signo +, como lo exige el campo `to` de la Cloud API. Dato
   personal: nunca en logs ni en URLs.';

drop trigger if exists trg_whatsapp_contactos_actualizado_en on integraciones.whatsapp_contactos;
create trigger trg_whatsapp_contactos_actualizado_en
  before update on integraciones.whatsapp_contactos
  for each row execute function identidad.set_actualizado_en();

-- -----------------------------------------------------------------------------
-- 2. integraciones.whatsapp_mensajes — qué se envió y qué pasó después
-- -----------------------------------------------------------------------------
create table if not exists integraciones.whatsapp_mensajes (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references identidad.tenants (id) on delete cascade,

  -- `set null` y no `cascade`: borrar un contacto no puede borrar la evidencia
  -- de que se le escribió. Meta audita el consentimiento hacia atrás.
  contacto_id       uuid references integraciones.whatsapp_contactos (id) on delete set null,

  clave_evento      text not null,
  nombre_plantilla  text not null,

  -- -------------------------------------------------------------------------
  -- IDEMPOTENCIA: sin esto, un reintento vuelve a enviar Y VUELVE A COBRAR
  -- -------------------------------------------------------------------------
  -- La Cloud API de Meta NO acepta idempotency key, y los jobs de este proyecto
  -- reintentan por diseño. Un timeout de red sobre una llamada que SÍ llegó
  -- mandaría el mensaje dos veces al mismo teléfono. La llave la arma el
  -- servicio como `<clave_evento>:<referencia>`, donde la referencia es la
  -- entidad que originó el aviso (la sesión de retiro, el manifiesto…).
  clave_idempotencia text not null,

  -- Las VARIABLES de la plantilla, no el cuerpo renderizado ni el destino.
  -- Alcanza para reconstruir qué decía el aviso sin duplicar el teléfono en
  -- cada fila.
  variables         jsonb not null default '[]'::jsonb,

  estado            text not null default 'encolado'
                    check (estado in ('encolado', 'enviado', 'entregado', 'leido', 'fallido')),

  -- El id que asigna Meta (`wamid.***`). Es la llave por la que el webhook
  -- encuentra esta fila cuando llega el acuse.
  meta_message_id   text,

  -- Descripción SANEADA del fallo. Nunca lleva el token ni el teléfono.
  error_motivo      text,

  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now()
);

-- La barrera de idempotencia. Va por contacto porque un mismo evento puede
-- tener varios destinatarios legítimos, y cada uno es un mensaje distinto.
create unique index if not exists whatsapp_mensajes_idempotencia_uk
  on integraciones.whatsapp_mensajes (tenant_id, contacto_id, clave_idempotencia);

-- Por acá entra el webhook de acuses: llega un `wamid` y hay que dar con la
-- fila. Único porque Meta no reusa el id, y si lo hiciera preferimos el error
-- ruidoso a pisar el acuse de otro mensaje.
create unique index if not exists whatsapp_mensajes_meta_id_uk
  on integraciones.whatsapp_mensajes (meta_message_id)
  where meta_message_id is not null;

create index if not exists idx_whatsapp_mensajes_tenant_fecha
  on integraciones.whatsapp_mensajes (tenant_id, creado_en desc);

comment on table integraciones.whatsapp_mensajes is
  'Bitacora de cada notificacion de WhatsApp: que plantilla, con que variables,
   a que contacto y en que estado quedo. No guarda el numero de destino (esta en
   el contacto) ni el cuerpo renderizado. Deny-all: la escriben el job de envio
   y el webhook de acuses, ambos con service_role.';

comment on column integraciones.whatsapp_mensajes.estado is
  'Avanza en un solo sentido: encolado < enviado < entregado < leido < fallido.
   Meta entrega los acuses DESORDENADOS (un `read` puede llegar antes que su
   `delivered`), asi que el writer compara rangos y nunca retrocede. El mismo
   bug ya mordio en el webhook de payout de Fintoc.';

drop trigger if exists trg_whatsapp_mensajes_actualizado_en on integraciones.whatsapp_mensajes;
create trigger trg_whatsapp_mensajes_actualizado_en
  before update on integraciones.whatsapp_mensajes
  for each row execute function identidad.set_actualizado_en();

-- =============================================================================
-- 3. RLS
-- =============================================================================
--
-- `whatsapp_contactos` es la ÚNICA de las tres que se expone a sesiones de
-- usuario, porque es la única que alguien va a administrar desde una pantalla.
-- Política P1 estricta, idéntica a `integraciones.api_keys`: el tenant propio y
-- solo usuarios internos del courier. Un seller NO ve ni edita este directorio
-- aunque su propio teléfono esté adentro — el alta y la declaración de
-- consentimiento las hace el courier.
-- -----------------------------------------------------------------------------

alter table integraciones.whatsapp_contactos enable row level security;
alter table integraciones.whatsapp_contactos force row level security;

drop policy if exists whatsapp_contactos_solo_interno_lee on integraciones.whatsapp_contactos;
create policy whatsapp_contactos_solo_interno_lee
  on integraciones.whatsapp_contactos
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists whatsapp_contactos_solo_interno_inserta on integraciones.whatsapp_contactos;
create policy whatsapp_contactos_solo_interno_inserta
  on integraciones.whatsapp_contactos
  for insert
  to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists whatsapp_contactos_solo_interno_actualiza on integraciones.whatsapp_contactos;
create policy whatsapp_contactos_solo_interno_actualiza
  on integraciones.whatsapp_contactos
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

drop policy if exists whatsapp_contactos_solo_interno_borra on integraciones.whatsapp_contactos;
create policy whatsapp_contactos_solo_interno_borra
  on integraciones.whatsapp_contactos
  for delete
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

-- La bitácora es deny-all, igual que `integraciones.webhook_outbox`: la escriben
-- el job de envío y el webhook de acuses, los dos con `service_role`. Si mañana
-- hay una pantalla de "avisos enviados", entra por una vista acotada, no
-- abriendo la tabla entera.
alter table integraciones.whatsapp_mensajes enable row level security;
alter table integraciones.whatsapp_mensajes force row level security;
revoke all on integraciones.whatsapp_mensajes from public, anon, authenticated;

-- =============================================================================
-- 4. Vista espejo en `public` (solo para contactos) y GRANTs
-- =============================================================================
--
-- PostgREST llega por `public` salvo que el cliente pida el esquema explícito.
-- Solo `whatsapp_contactos` la necesita: las otras dos no se leen nunca desde
-- una sesión de usuario.
--
-- ⚠️ El GRANT es POR COLUMNA a propósito. Un `grant select` de tabla completa
-- filtra cualquier columna nueva que se agregue mañana aunque la vista de hoy
-- no la liste — el patrón ya mordió dos veces en este repo (el snapshot de
-- reglas de dinero y el token de invitación). Acá igual se listan todas, pero
-- la forma queda puesta para el día en que aparezca una que no deba salir.
-- -----------------------------------------------------------------------------

create or replace view public.whatsapp_contactos
  with (security_invoker = true) as
  select id,
         tenant_id,
         rol,
         seller_id,
         bodega_id,
         telefono_e164,
         etiqueta,
         opt_in_estado,
         opt_in_en,
         idioma,
         zona_horaria,
         creado_en,
         actualizado_en
    from integraciones.whatsapp_contactos;

grant select (id, tenant_id, rol, seller_id, bodega_id, telefono_e164, etiqueta,
              opt_in_estado, opt_in_en, idioma, zona_horaria, creado_en,
              actualizado_en)
  on integraciones.whatsapp_contactos to authenticated;
grant insert (tenant_id, rol, seller_id, bodega_id, telefono_e164, etiqueta,
              opt_in_estado, opt_in_en, idioma, zona_horaria)
  on integraciones.whatsapp_contactos to authenticated;
grant update (rol, seller_id, bodega_id, telefono_e164, etiqueta, opt_in_estado,
              opt_in_en, idioma, zona_horaria)
  on integraciones.whatsapp_contactos to authenticated;
grant delete on integraciones.whatsapp_contactos to authenticated;

grant select, insert, update, delete on public.whatsapp_contactos to authenticated;

grant select, insert, update, delete on integraciones.whatsapp_contactos to service_role;
grant select, insert, update, delete on integraciones.whatsapp_mensajes  to service_role;
grant select, insert, update, delete on public.whatsapp_contactos        to service_role;

