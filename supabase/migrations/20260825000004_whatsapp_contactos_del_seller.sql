-- =============================================================================
-- WhatsApp — los destinatarios son del SELLER, y los administra Rutax
-- =============================================================================
--
-- Cambio de dueño, decidido el 2026-08-25 después de ver la primera versión
-- funcionando. El courier deja de administrar WhatsApp por completo: es un
-- asunto de Rutax, y el número lo pone el propio seller.
--
-- -----------------------------------------------------------------------------
-- QUÉ CAMBIA Y POR QUÉ
-- -----------------------------------------------------------------------------
-- La v1 tenía tres tipos de destinatario (`seller`, `bodega`, `courier`) y una
-- pantalla en la que el courier daba de alta teléfonos y **afirmaba** el
-- consentimiento de terceros. Eso último era lo incómodo: una empresa
-- declarando que otra empresa aceptó recibir mensajes.
--
-- Ahora:
--  · **Todo destinatario es de un seller.** Se van `rol` y `bodega_id`. La
--    bodega no desaparece del producto — sigue nombrada DENTRO del mensaje,
--    como variable, que es donde le sirve al que lo lee.
--  · **Aparece `origen`**, que dice quién puso ese número y, por lo tanto, qué
--    vale su consentimiento:
--      `perfil_seller`      — lo escribió el seller, en su activación o en su
--                             perfil del portal. Es él consintiendo por sí
--                             mismo: el respaldo más fuerte que existe ante Meta.
--      `agregado_por_rutax` — lo agregó Rutax desde el backstage (el caso real
--                             que lo motivó: que también le llegue a la pareja
--                             del seller). Rutax lo afirma, y queda con autor.
--  · **La tabla pasa a deny-all.** Ni el courier ni el seller la tocan por
--    PostgREST; se escribe solo por Server Actions con `service_role`, que son
--    las que comprueban quién es cada quien. El courier ya no tiene ninguna vía.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ SIGUE HABIENDO UNA TABLA Y NO UNA COLUMNA EN `sellers`
-- -----------------------------------------------------------------------------
-- La primera idea fue poner el teléfono en `identidad.sellers` y terminar. No
-- alcanza: **un seller puede tener varios destinatarios** (él y su pareja, él y
-- su jefe de bodega). Con una columna eso no se puede expresar, y la segunda
-- vez que hiciera falta habría que migrar de todas formas.
--
-- El riesgo que llevó a considerar la columna —que el teléfono se desincronice
-- de la ficha del seller— no aplica: **acá vive la única copia**. No hay dos
-- lugares que puedan discrepar, que era el problema real.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Limpiar lo que ya no puede existir
-- -----------------------------------------------------------------------------
-- Las filas de rol `courier` y `bodega` no tienen seller, y sin seller no hay
-- destinatario posible en el modelo nuevo. Son datos de prueba del mismo día;
-- se borran. La bitácora de mensajes NO se pierde: su FK es `on delete set
-- null`, así que la evidencia de lo enviado queda intacta aunque el contacto
-- desaparezca.
delete from integraciones.whatsapp_contactos where seller_id is null;

-- -----------------------------------------------------------------------------
-- 2. La vista espejo y los grants se retiran: nadie llega por PostgREST
-- -----------------------------------------------------------------------------
drop view if exists public.whatsapp_contactos;
revoke all on integraciones.whatsapp_contactos from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Reestructurar
-- -----------------------------------------------------------------------------
alter table integraciones.whatsapp_contactos
  drop constraint if exists whatsapp_contactos_destino_segun_rol;

drop index if exists integraciones.whatsapp_contactos_uk;
drop index if exists integraciones.idx_whatsapp_contactos_destinatarios;
drop index if exists integraciones.idx_whatsapp_contactos_seller;
drop index if exists integraciones.idx_whatsapp_contactos_bodega;

alter table integraciones.whatsapp_contactos drop column if exists rol;
alter table integraciones.whatsapp_contactos drop column if exists bodega_id;

alter table integraciones.whatsapp_contactos
  alter column seller_id set not null;

-- El origen decide quién puede tocar la fila y qué vale su consentimiento.
-- Sin default a propósito: toda fila nueva tiene que declarar de dónde salió, y
-- si alguien agrega un camino de escritura y se olvida, falla ruidosa con 23502
-- en vez de escribir en silencio una procedencia equivocada. Es la misma lección
-- que `operacion.pedidos.fuente`.
alter table integraciones.whatsapp_contactos
  add column if not exists origen text;

update integraciones.whatsapp_contactos set origen = 'perfil_seller' where origen is null;

alter table integraciones.whatsapp_contactos
  alter column origen set not null;

alter table integraciones.whatsapp_contactos
  drop constraint if exists whatsapp_contactos_origen_valido;
alter table integraciones.whatsapp_contactos
  add constraint whatsapp_contactos_origen_valido
  check (origen in ('perfil_seller', 'agregado_por_rutax'));

-- Quién lo agregó, cuando lo agregó Rutax. `null` para `perfil_seller`: ahí el
-- autor es el seller y ya está implícito en el origen.
alter table integraciones.whatsapp_contactos
  add column if not exists creado_por_usuario_id uuid;

-- El tenant no puede contradecir al del seller. Misma red que en
-- `seller_bodegas`: sin esto, un tenant_id mal escrito rompe el aislamiento por
-- la puerta de atrás sin que nada se queje.
alter table integraciones.whatsapp_contactos
  drop constraint if exists whatsapp_contactos_seller_pertenece_al_tenant;
alter table integraciones.whatsapp_contactos
  add constraint whatsapp_contactos_seller_pertenece_al_tenant
  foreign key (tenant_id, seller_id)
  references identidad.sellers (tenant_id, id)
  on delete cascade;

-- -----------------------------------------------------------------------------
-- 4. Índices
-- -----------------------------------------------------------------------------

-- El mismo número no se registra dos veces para el mismo seller: sin esto, el
-- aviso sale duplicado al mismo teléfono y cada envío se cobra.
create unique index if not exists whatsapp_contactos_seller_telefono_uk
  on integraciones.whatsapp_contactos (seller_id, telefono_e164);

-- ⚠️ UN SOLO número propio por seller. El del perfil es *su* número, y tener
-- dos filas `perfil_seller` significaría que su propia pantalla no sabe cuál
-- editar. Los adicionales existen, pero son `agregado_por_rutax`.
create unique index if not exists whatsapp_contactos_uno_propio_por_seller
  on integraciones.whatsapp_contactos (seller_id)
  where origen = 'perfil_seller';

-- La consulta EXACTA del motor de envío.
create index if not exists idx_whatsapp_contactos_destinatarios
  on integraciones.whatsapp_contactos (tenant_id, seller_id)
  where opt_in_estado = 'otorgado';

-- Por acá entra el webhook cuando alguien responde BAJA: llega un teléfono y
-- hay que dar con sus contactos sin saber de qué tenant son.
create index if not exists idx_whatsapp_contactos_telefono
  on integraciones.whatsapp_contactos (telefono_e164);

-- El backstage lista por courier.
create index if not exists idx_whatsapp_contactos_tenant
  on integraciones.whatsapp_contactos (tenant_id);

-- -----------------------------------------------------------------------------
-- 5. RLS: deny-all
-- -----------------------------------------------------------------------------
-- El courier PERDIÓ el acceso, que es el punto de este cambio. El seller
-- tampoco llega por PostgREST: escribe su número por una Server Action que
-- comprueba su sesión. Y el backstage usa `service_role`.
--
-- Se comprueba con 42501 explícito en el pgTAP y no con "0 filas": si el
-- `revoke` se perdiera y solo quedara RLS sin políticas, un `select` devolvería
-- 0 filas y una prueba por conteo pasaría igual sin proteger nada.
alter table integraciones.whatsapp_contactos enable row level security;
alter table integraciones.whatsapp_contactos force row level security;

drop policy if exists whatsapp_contactos_solo_interno_lee on integraciones.whatsapp_contactos;
drop policy if exists whatsapp_contactos_solo_interno_inserta on integraciones.whatsapp_contactos;
drop policy if exists whatsapp_contactos_solo_interno_actualiza on integraciones.whatsapp_contactos;
drop policy if exists whatsapp_contactos_solo_interno_borra on integraciones.whatsapp_contactos;

grant select, insert, update, delete on integraciones.whatsapp_contactos to service_role;

comment on table integraciones.whatsapp_contactos is
  'A quien le escribe Rutax por WhatsApp, siempre en representacion de un seller.
   Lo administra RUTAX (backstage), no el courier. El numero propio del seller lo
   escribe el seller (origen perfil_seller); los adicionales los agrega Rutax
   (origen agregado_por_rutax). Deny-all: solo service_role, via Server Actions.';

comment on column integraciones.whatsapp_contactos.origen is
  'perfil_seller = lo escribio el seller y consintio por si mismo (el respaldo
   mas fuerte ante Meta). agregado_por_rutax = lo agrego Rutax y lo afirma, con
   autor en creado_por_usuario_id y en bitacora_auditoria.';
