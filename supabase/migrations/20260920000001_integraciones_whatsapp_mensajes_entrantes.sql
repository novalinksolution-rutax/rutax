-- =============================================================================
-- WhatsApp — mensajes ENTRANTES (consulta de estado del seller, etapa 1)
-- =============================================================================
-- Alcance: `docs/arquitectura/conversacion-whatsapp.md` (§9, §10, §6.1).
--
-- -----------------------------------------------------------------------------
-- POR QUÉ UNA TABLA HERMANA Y NO UNA COLUMNA `direccion` EN whatsapp_mensajes
-- -----------------------------------------------------------------------------
-- Mismo argumento con el que Shopify tiene su propia tabla de conexiones y no
-- reusa la de ML:
--
--  · El saliente tiene clave de idempotencia compuesta, plantilla, variables y
--    un estado MONÓTONO de acuses. El entrante no tiene nada de eso.
--  · El entrante guarda TEXTO LIBRE escrito por una persona, que a veces trae
--    un teléfono o una dirección adentro. Meterlo en la tabla cuyos GRANT están
--    afinados para lo saliente es exactamente cómo se filtra una columna sin
--    que nadie lo note (el patrón ya mordió dos veces en este repo).
--  · El texto se purga a los 90 días. Purgar una columna de una tabla que
--    también guarda evidencia de envíos que Meta audita hacia atrás obliga a
--    razonar dos retenciones distintas sobre las mismas filas.
--
-- -----------------------------------------------------------------------------
-- ⚠️ `tenant_id` ES NULLABLE, Y ESTO NO ES UN CARVE-OUT. LA HONESTIDAD PRIMERO.
-- -----------------------------------------------------------------------------
-- El mensaje ENTRA antes de saber de qué tenant es: llega un teléfono, y la
-- resolución de identidad (§5) puede terminar en «ningún contacto», «más de un
-- contacto» o «Meta mandó algo ilegible». Hay tres formas de modelar eso:
--
--  (a) `tenant_id not null` con un tenant centinela — miente, y un día alguien
--      va a hacer un `group by tenant_id` y va a contar ese centinela como
--      courier.
--  (b) Dos tablas (resueltos / no resueltos) — rompe la idempotencia, que es el
--      punto entero de esta tabla: la llave es UNA, el `wamid` de Meta, y con
--      dos tablas el mismo mensaje puede entrar en las dos.
--  (c) Nullable con un CHECK que ate el nulo a la ausencia total de datos de
--      negocio. Es lo que se hace acá.
--
-- Por qué (c) es aceptable y NO deja "una tabla de negocio sin tenant_id de
-- facto":
--
--  1. Una fila con `tenant_id is null` NO CONTIENE NINGÚN DATO DE NEGOCIO. El
--     CHECK `whatsapp_entrantes_sin_tenant_no_guarda_nada` lo impone: sin
--     tenant no hay `texto`, no hay `seller_id`, no hay `contacto_id`, no hay
--     clasificación del contenido. Queda el teléfono, la hora y el hecho de que
--     no se resolvió — que es literalmente lo que pide §10.
--  2. El aislamiento NO descansa en esta columna: la tabla es DENY-ALL. Ninguna
--     sesión de usuario la alcanza, ni por `public` (no hay vista espejo) ni
--     por el esquema directo. No hay política de RLS que un nulo pueda dejar
--     abierta, porque no hay políticas.
--  3. En cuanto se resuelve, `tenant_id` es obligatorio y además NO PUEDE
--     CONTRADECIR al del seller: FK compuesta `(tenant_id, seller_id)` contra
--     `identidad.sellers (tenant_id, id)`, la misma red que ya lleva
--     `whatsapp_contactos`.
--
-- El día que el courier tenga pantalla (no en la v1), la política se escribe
-- sobre `tenant_id is not null and tenant_id = claim` y las filas sin resolver
-- quedan fuera por construcción, que es lo correcto: no son de nadie.
--
-- -----------------------------------------------------------------------------
-- MINIMIZACIÓN: LO QUE ESTA TABLA NO GUARDA
-- -----------------------------------------------------------------------------
--  · El `hash_code` del QR de Flex (credencial-símil) ni ninguna otra parte del
--    payload del QR: el envoltorio de §6.1 descarta la credencial ANTES de
--    persistir. Por eso `texto` va acotado en largo por CHECK.
--  · El cuerpo de la RESPUESTA. Se arma con nuestras plantillas y no se
--    duplica acá.
--  · Cualquier dato del destinatario del pedido. Esta tabla no toca pedidos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La tabla
-- -----------------------------------------------------------------------------
create table if not exists integraciones.whatsapp_mensajes_entrantes (
  id                 uuid primary key default gen_random_uuid(),

  -- ---------------------------------------------------------------------------
  -- IDEMPOTENCIA — el webhook de Meta NO admite anti-replay
  -- ---------------------------------------------------------------------------
  -- Meta no firma un timestamp, reenvía ante cualquier no-2xx y nuestro propio
  -- webhook devuelve 200 SIEMPRE (si acumula 4xx, Meta DESACTIVA la suscripción
  -- y deja a todos los couriers sin acuses). Así que el mismo `wamid` llega más
  -- de una vez por diseño, no por accidente.
  --
  -- ⚠️ La unicidad es GLOBAL, sin `tenant_id` adentro: cuando la fila se
  -- reserva todavía no se sabe de qué tenant es, y una llave que incluyera el
  -- tenant dejaría entrar el mismo mensaje dos veces (una sin resolver y otra
  -- resuelta). Es la MISMA forma que `whatsapp_mensajes_meta_id_uk`.
  meta_message_id    text not null,

  -- Quién escribió. `null` solo cuando Meta mandó algo ilegible: la fila se
  -- guarda igual para que el reintento no la procese de nuevo.
  telefono_e164      text check (telefono_e164 ~ '^[1-9][0-9]{7,14}$'),

  -- ---------------------------------------------------------------------------
  -- RESOLUCIÓN DE IDENTIDAD (§5 y §5.1) — el "hecho de que no se resolvió"
  -- ---------------------------------------------------------------------------
  -- `ambiguo` es el que existe por §5.1: un teléfono que resuelve a más de un
  -- contacto (el multi-courier YA está desplegado). No se responde nada sobre
  -- ningún pedido, pero la anomalía queda CONTADA — es el mismo fallo silencioso
  -- que obligó a poner «N sellers no reciben avisos» en /admin/whatsapp.
  resolucion         text not null
                     check (resolucion in ('resuelto', 'sin_contacto', 'ambiguo', 'ilegible')),

  tenant_id          uuid references identidad.tenants (id) on delete cascade,
  seller_id          uuid,

  -- `set null` y no `cascade`: dar de baja un contacto no borra la evidencia de
  -- que consultó. Misma decisión que en los salientes.
  contacto_id        uuid references integraciones.whatsapp_contactos (id) on delete set null,

  -- ---------------------------------------------------------------------------
  -- EL TEXTO LIBRE — dato personal, vida útil 90 días
  -- ---------------------------------------------------------------------------
  -- Lo escribió una persona y a veces trae un teléfono o una dirección adentro.
  -- Solo se guarda cuando la identidad se resolvió (CHECK más abajo): de un
  -- número que no conocemos no se conserva una línea de su puño.
  texto              text check (texto is null or length(texto) <= 300),

  -- Lo que SOBREVIVE a la purga, para que la métrica no dependa del texto.
  texto_largo        integer check (texto_largo is null or texto_largo between 0 and 300),
  purgado_en         timestamptz,

  -- ---------------------------------------------------------------------------
  -- CLASIFICACIÓN (§6.1) — permite contar sin leer el texto
  -- ---------------------------------------------------------------------------
  -- La escribe el envoltorio de `conversacion` sobre `parsearCodigoBulto`, NUNCA
  -- el parser tal cual: el parser por contrato nunca dice que no.
  --
  -- ⚠️ `flex_manual` (la ristra de 6..64 dígitos que el seller copia de su panel
  -- de ML) se ACEPTA pero se cuenta APARTE, porque por este canal es una sonda
  -- de existencia de pedidos. N intentos numéricos SIN MATCH en una hora es
  -- señal de barrido y corta el canal para ese contacto. Un match fallido y uno
  -- exitoso no pesan igual, y por eso son dos columnas y no una.
  clasificacion      text
                     check (clasificacion is null or clasificacion in (
                       'codigo_interno', 'ml_shipment_id', 'flex_manual',
                       'intencion_retiro', 'sin_match')),

  -- ¿La consulta encontró algo? `null` cuando ni siquiera se consultó.
  hubo_match         boolean,

  -- Hora que declara Meta (no la nuestra): es la que ordena la ventana de abuso
  -- y la que manda para la purga de 90 días.
  recibido_en        timestamptz not null default now(),
  creado_en          timestamptz not null default now(),

  -- ---------------------------------------------------------------------------
  -- LAS TRES REDES QUE SOSTIENEN EL PÁRRAFO DEL ENCABEZADO
  -- ---------------------------------------------------------------------------

  -- (1) Sin tenant no hay NADA. Es lo que impide que esto sea "una tabla de
  --     negocio sin tenant_id de facto": una fila sin tenant no tiene contenido
  --     que aislar.
  constraint whatsapp_entrantes_sin_tenant_no_guarda_nada check (
    tenant_id is not null
    or (seller_id is null and contacto_id is null and texto is null
        and texto_largo is null and clasificacion is null and hubo_match is null)
  ),

  -- (2) El tenant y la resolución no pueden discrepar. `resuelto` sin tenant es
  --     una fila que el job trataría como consultable; un tenant en una fila
  --     `ambiguo` es justo el error irreversible de §5.1 (responder con datos
  --     del courier equivocado).
  constraint whatsapp_entrantes_tenant_segun_resolucion check (
    (resolucion = 'resuelto' and tenant_id is not null
       and seller_id is not null and contacto_id is not null)
    or (resolucion <> 'resuelto' and tenant_id is null)
  ),

  -- (3) El texto SOLO existe resuelto, y `texto_largo` es su acompañante
  --     obligatorio: si se escribiera el texto sin el largo, la purga dejaría la
  --     fila sin ninguna traza de que hubo contenido.
  constraint whatsapp_entrantes_texto_solo_si_resuelto check (
    texto is null or (resolucion = 'resuelto' and texto_largo is not null)
  ),

  -- (4) Purgada es purgada: `purgado_en` poblado y `texto` vivo a la vez
  --     significaría que la purga corrió y no purgó.
  constraint whatsapp_entrantes_purga_coherente check (
    purgado_en is null or texto is null
  )
);

-- El tenant denormalizado no puede contradecir al del seller. Sin esta FK
-- compuesta, un tenant_id mal escrito rompe la separación entre couriers por la
-- puerta de atrás y nada se queja. Se agrega aparte del `create table` para que
-- la migración sea re-ejecutable sobre una tabla ya existente.
alter table integraciones.whatsapp_mensajes_entrantes
  drop constraint if exists whatsapp_entrantes_seller_pertenece_al_tenant;
alter table integraciones.whatsapp_mensajes_entrantes
  add constraint whatsapp_entrantes_seller_pertenece_al_tenant
  foreign key (tenant_id, seller_id)
  references identidad.sellers (tenant_id, id)
  on delete cascade;

-- -----------------------------------------------------------------------------
-- 2. Índices
-- -----------------------------------------------------------------------------

-- LA barrera de idempotencia. La fila se RESERVA antes de publicar el evento,
-- igual que en los salientes: al revés, el mensaje ya se respondió dos veces
-- cuando uno se entera.
create unique index if not exists whatsapp_entrantes_meta_id_uk
  on integraciones.whatsapp_mensajes_entrantes (meta_message_id);

-- ---------------------------------------------------------------------------
-- EL TOPE DE ABUSO SE CUENTA ACÁ, SIN TABLA DE CONTADORES
-- ---------------------------------------------------------------------------
-- ~20 consultas por contacto y por hora (§9). No es por costo —el entrante es
-- gratis y abre la ventana de servicio— sino para que un teléfono comprometido
-- no sirva para barrer códigos.
--
-- ⚠️ Se cuenta sobre ESTA tabla y NO sobre `infra.rate_limit_contadores` ni
-- sobre una tabla en `conversacion` (§4 dice que la v1 no crea ninguna). El
-- contador de `infra` es una ventana fija UNLOGGED que se borra sola: sirve para
-- frenar, no para AUDITAR, y acá la pregunta que hay que poder responder seis
-- meses después es «¿este número estuvo barriendo códigos?». Las filas ya
-- existen; un contador aparte sería un segundo lugar que puede discrepar.
--
-- La consulta es `count(*) where contacto_id = ? and recibido_en > now() - 1h`,
-- que este índice resuelve entero.
create index if not exists idx_whatsapp_entrantes_contacto_hora
  on integraciones.whatsapp_mensajes_entrantes (contacto_id, recibido_en desc)
  where contacto_id is not null;

-- La SEGUNDA cuenta, la de §6.1: intentos numéricos SIN match. Índice parcial
-- para que la señal de barrido no se pague barriendo la tabla entera.
create index if not exists idx_whatsapp_entrantes_sondeo_numerico
  on integraciones.whatsapp_mensajes_entrantes (contacto_id, recibido_en desc)
  where clasificacion = 'flex_manual' and hubo_match = false;

-- Por acá entra el contador de anomalías de /admin/whatsapp (§5.1) y el sondeo
-- de números desconocidos, que no tienen contacto_id.
create index if not exists idx_whatsapp_entrantes_telefono_hora
  on integraciones.whatsapp_mensajes_entrantes (telefono_e164, recibido_en desc)
  where resolucion <> 'resuelto';

-- El barrido de la purga: solo las filas que TODAVÍA tienen texto.
create index if not exists idx_whatsapp_entrantes_pendientes_de_purga
  on integraciones.whatsapp_mensajes_entrantes (recibido_en)
  where texto is not null;

create index if not exists idx_whatsapp_entrantes_tenant_fecha
  on integraciones.whatsapp_mensajes_entrantes (tenant_id, recibido_en desc)
  where tenant_id is not null;

-- -----------------------------------------------------------------------------
-- 3. Comentarios
-- -----------------------------------------------------------------------------
comment on table integraciones.whatsapp_mensajes_entrantes is
  'Mensajes que los sellers le escriben al numero de Rutax. Tabla HERMANA de
   whatsapp_mensajes (no una columna direccion): el entrante guarda texto libre
   escrito por una persona y se purga a los 90 dias. tenant_id es NULLABLE a
   proposito — el mensaje entra antes de saber de quien es — y un CHECK impone
   que una fila sin tenant no contenga NINGUN dato de negocio. Deny-all: la
   escriben el webhook y el job de conversacion, ambos con service_role.';

comment on column integraciones.whatsapp_mensajes_entrantes.texto is
  'Dato personal en crudo: a veces trae un telefono o una direccion adentro.
   Solo existe si la identidad se resolvio, va acotado a 300 caracteres y lo
   borra la purga de 90 dias. NUNCA incluye el hash_code del QR de Flex (eso lo
   descarta el envoltorio del parser antes de persistir). Fuera de todo GRANT
   que no sea service_role.';

comment on column integraciones.whatsapp_mensajes_entrantes.resolucion is
  'resuelto | sin_contacto | ambiguo | ilegible. `ambiguo` = el telefono resolvio
   a mas de un contacto (multi-courier, §5.1): no se responde nada de ningun
   pedido, pero la anomalia queda CONTADA. El silencio seria un seller
   permanentemente sin canal y sin enterarse.';

comment on column integraciones.whatsapp_mensajes_entrantes.clasificacion is
  'Que se entendio del mensaje, para contar sin leer el texto. flex_manual (la
   ristra de digitos) se acepta pero se cuenta APARTE: por este canal es una
   sonda de existencia de pedidos. N de esos SIN match en una hora es barrido.';

comment on column integraciones.whatsapp_mensajes_entrantes.texto_largo is
  'Sobrevive a la purga. Sin el, una fila purgada no distingue "no trajo texto"
   de "traia texto y se borro".';

-- -----------------------------------------------------------------------------
-- 4. Purga del texto a los 90 días — la DISPARA un job de Inngest
-- -----------------------------------------------------------------------------
-- ⚠️ NO es un cron de base (`pg_cron`) a propósito: el proyecto tiene UN
-- orquestador de trabajos y es Inngest. Un cron en Postgres sería un segundo
-- planificador invisible desde la telemetría de jobs, sin reintentos y sin
-- traza en `infra.ejecuciones_job`. Acá abajo solo vive el VERBO; el CUÁNDO es
-- del job.
--
-- Va en tandas (`p_tope`) por la misma razón que la asignación en bloque: una
-- sola sentencia sobre 90 días de mensajes es un lock largo y un run opaco. El
-- job la llama en bucle hasta que devuelva 0.
--
-- QUÉ QUEDA DESPUÉS DE PURGAR: la fila entera menos el texto — meta_message_id,
-- telefono, tenant/seller/contacto, `clasificacion`, `hubo_match`, `texto_largo`
-- y `recibido_en`. O sea: cuántas consultas hubo, de quién, de qué tipo y si
-- encontraron algo. Minimización sin perder el agregado (§10).
create or replace function public.whatsapp_entrantes_purgar_texto(
  p_dias integer default 90,
  p_tope integer default 2000
) returns integer
language plpgsql
security definer
set search_path = public, integraciones, pg_temp
as $$
declare
  v_purgadas integer;
begin
  if p_dias is null or p_dias < 1 then
    raise exception 'whatsapp_entrantes_purgar_texto: p_dias debe ser >= 1 (recibido: %)', p_dias;
  end if;
  if p_tope is null or p_tope < 1 then
    raise exception 'whatsapp_entrantes_purgar_texto: p_tope debe ser >= 1 (recibido: %)', p_tope;
  end if;

  with objetivo as (
    select id
      from integraciones.whatsapp_mensajes_entrantes
     where texto is not null
       and recibido_en < now() - make_interval(days => p_dias)
     order by recibido_en
     limit p_tope
     for update skip locked
  )
  update integraciones.whatsapp_mensajes_entrantes m
     set texto = null,
         purgado_en = now()
    from objetivo o
   where m.id = o.id;

  get diagnostics v_purgadas = row_count;
  return v_purgadas;
end;
$$;

comment on function public.whatsapp_entrantes_purgar_texto(integer, integer) is
  'Borra el texto libre de los mensajes entrantes mas viejos que p_dias (90 por
   defecto) y marca purgado_en, en tandas de p_tope. La llama un job de Inngest
   en bucle hasta que devuelva 0 — NO hay cron en la base. Conserva la metrica:
   cuantas consultas hubo, de que tipo y si encontraron algo.';

-- `create or replace function` NO resetea la ACL: si la función ya existía con
-- un grant viejo, el revoke de abajo es lo único que lo quita. Gotcha conocido
-- del repo.
revoke all on function public.whatsapp_entrantes_purgar_texto(integer, integer)
  from public, anon, authenticated;
grant execute on function public.whatsapp_entrantes_purgar_texto(integer, integer)
  to service_role;

-- =============================================================================
-- 5. RLS y GRANT — DENY-ALL
-- =============================================================================
-- El documento de alcance NO le da pantalla al courier en la v1, así que la
-- tabla es deny-all como el resto de WhatsApp, que administra Rutax. Cuando
-- exista la pantalla (no en la v1), entra por una VISTA ACOTADA que no liste
-- `texto`, no abriendo la tabla.
--
-- Se comprueba con 42501 explícito en el pgTAP y no con "0 filas": si el
-- `revoke` se perdiera y solo quedara RLS sin políticas, un `select` devolvería
-- 0 filas y una prueba por conteo pasaría igual sin proteger nada.
--
-- ⚠️ NO HAY VISTA ESPEJO EN `public`. PostgREST llega por `public` salvo que el
-- cliente pida el esquema explícito; sin vista y sin grant, no hay ninguna de
-- las dos puertas.
alter table integraciones.whatsapp_mensajes_entrantes enable row level security;
alter table integraciones.whatsapp_mensajes_entrantes force row level security;

drop view if exists public.whatsapp_mensajes_entrantes;
revoke all on integraciones.whatsapp_mensajes_entrantes from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- El GRANT es POR COLUMNA, aunque hoy el único destinatario sea service_role
-- -----------------------------------------------------------------------------
-- Un `grant` de TABLA COMPLETA filtra cualquier columna nueva que se agregue
-- mañana; el patrón ya mordió dos veces en este repo (el snapshot de reglas de
-- dinero y el token de invitación), las dos porque la columna sensible nació
-- DESPUÉS del grant.
--
-- Acá la forma queda enumerada a propósito: el día que alguien construya la
-- pantalla del courier, va a copiar esta lista para el grant a `authenticated`,
-- y `texto` NO está en la mitad legible de ninguna lista que no sea la de
-- service_role. El pgTAP lo prueba con contraprueba.
grant select (id, meta_message_id, telefono_e164, resolucion, tenant_id,
              seller_id, contacto_id, texto, texto_largo, purgado_en,
              clasificacion, hubo_match, recibido_en, creado_en)
  on integraciones.whatsapp_mensajes_entrantes to service_role;

grant insert (id, meta_message_id, telefono_e164, resolucion, tenant_id,
              seller_id, contacto_id, texto, texto_largo, purgado_en,
              clasificacion, hubo_match, recibido_en)
  on integraciones.whatsapp_mensajes_entrantes to service_role;

-- UPDATE acotado: una fila entrante NO se reescribe. Lo único que muta es (a)
-- la resolución de identidad, que ocurre después de reservar la fila, y (b) la
-- purga. `meta_message_id`, `telefono_e164` y `recibido_en` quedan FUERA: son
-- el hecho tal como llegó, y reescribirlos borraría la evidencia del abuso que
-- esta tabla existe para contar.
grant update (resolucion, tenant_id, seller_id, contacto_id, texto, texto_largo,
              purgado_en, clasificacion, hubo_match)
  on integraciones.whatsapp_mensajes_entrantes to service_role;

grant delete on integraciones.whatsapp_mensajes_entrantes to service_role;
