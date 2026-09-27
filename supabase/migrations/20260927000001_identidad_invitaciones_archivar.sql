-- =============================================================================
-- Identidad — ARCHIVAR invitaciones muertas (salen del listado, NO se borran)
-- =============================================================================
-- POR QUÉ. En `/equipo` las invitaciones se listan junto a las personas. Una vez
-- revocada o expirada, la fila ya no sirve para nada y se queda ahí para siempre
-- ensuciando la pantalla; el courier no tiene forma de quitarla.
--
-- NO se borra, y esa es la decisión de producto: una invitación es un registro de
-- ACCESO —alguien recibió una vía de entrada al tenant, con un rol concreto— y la
-- regla no-negociable del proyecto es que todo acceso queda auditado. Coherente
-- con la migración 0001, que dejó `invitaciones` deliberadamente SIN política ni
-- grant de DELETE («una invitación se revoca cambiando `estado`, no se borra»).
-- Esta migración NO abre ese permiso: archivar es sellar una fecha, un UPDATE.
--
-- ⚠️ EL CHECK ES LA PIEZA DE SEGURIDAD, no un adorno de coherencia. Esconder una
-- invitación `pendiente` sería esconder un TOKEN VIVO: la fila desaparece de la
-- única pantalla donde el courier la vigila, pero el enlace `/invitacion/<token>`
-- sigue canjeándose y quien lo tenga entra con ese rol (si es `dueno`, se vuelve
-- dueño del tenant — el mismo desenlace que cerró 20260807000001). Un archivado
-- que además revocara sería aceptable; un archivado que solo oculta, no. Así que
-- la base impone que solo se archive lo que ya está muerto, en vez de confiarlo a
-- la capa de aplicación. Efecto colateral bienvenido y simétrico: mientras la
-- fila esté archivada NO se le puede devolver el estado `pendiente` —el CHECK se
-- evalúa en ambos sentidos—, así que no existe forma de resucitar un token
-- escondido. Para revivir una invitación hay que desarchivarla primero (y con
-- ello volver a mostrarla), o crear una nueva, que es lo que hace «reinvitar».
--
-- El predicado es `estado <> 'pendiente'`, no `estado in ('revocada','expirada')`:
-- la base impone la propiedad de seguridad (nunca ocultar un token vivo) y deja a
-- la aplicación la regla de producto más estrecha (hoy solo se ofrece archivar
-- revocadas y expiradas). `aceptada` cae del lado permitido y está bien: su token
-- ya se consumió y la persona figura como miembro del equipo.
--
-- ⚠️ TRAMPA CONOCIDA, para la mitad de TypeScript: la expiración TIENE DOS CARAS.
-- `estado = 'expirada'` solo se escribe cuando el invitado abre el enlace tarde
-- (`aceptarInvitacion`); si nadie lo abre, la fila se queda `pendiente` con
-- `expira_en` en el pasado, y la interfaz la muestra como «Expirada» derivándolo
-- de la fecha. Ese caso —el más común de los que el courier querrá archivar— es
-- `pendiente` en base y el CHECK lo RECHAZA con 23514. Quien archive debe llevar
-- primero la fila a un estado terminal (`expirada`/`revocada`) en el mismo UPDATE
-- o antes, no confiar en lo que rotula la pantalla. No se resuelve aquí con un
-- `or expira_en < now()`: `now()` no es inmutable y un CHECK no puede usarla.
--
-- DECISIÓN — el CHECK va VALIDADO (sin `NOT VALID`), a diferencia del de
-- 20260915000001. Ahí el histórico violaba la regla nueva; aquí no puede: la
-- columna nace en esta misma migración, así que TODA fila preexistente queda con
-- `archivada_en IS NULL` y satisface el predicado por la primera rama. La
-- validación es un scan completo de una tabla de decenas de filas por tenant.
-- Un `NOT VALID` sin necesidad es deuda: deja el constraint sin validar para
-- siempre y le quita al planificador la garantía.
--
-- PERMISOS — se agrega `archivada_en` a la lista de SELECT POR COLUMNA. No es
-- opcional: la pantalla de equipo lista con el cliente de SESIÓN (rol
-- `authenticated`) filtrando `archivada_en is null`, y Postgres exige privilegio
-- de columna para CUALQUIER referencia en la consulta, WHERE incluido — sin este
-- grant el listado entero moriría con 42501 «permission denied for column
-- archivada_en». Es lectura de un dato de negocio (una fecha), no un secreto.
-- `token` sigue fuera, como en 20260807000001/2 y 20260915000001.
--
-- NO se agregan grants de ESCRITURA, y conviene dejarlo escrito porque es fácil
-- equivocarse leyendo solo la migración 0001: `authenticated` NO tiene UPDATE
-- sobre esta tabla. La 0001 §9 lo otorgaba, pero 20260807000001 §B lo REVOCÓ
-- junto con INSERT y nadie lo restituyó. Archivar es un UPDATE, así que corre por
-- `service_role`, igual que crear/revocar/reenviar. La política RLS
-- `invitaciones_update_interno` ya existe y no hace falta tocarla: queda como
-- guarda de FILA por si algún día se restituye un grant de escritura.
--
-- Idempotente: `add column if not exists`, el constraint por DO-block sobre
-- pg_constraint, REVOKE/GRANT declarativos, la vista por drop + create.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columna `archivada_en` — null = se lista; con fecha = archivada.
--    Guarda CUÁNDO, no un booleano: el «cuándo» es parte del registro de acceso
--    y un flag lo perdería sin ganar nada.
-- -----------------------------------------------------------------------------
alter table identidad.invitaciones
  add column if not exists archivada_en timestamptz;

comment on column identidad.invitaciones.archivada_en is
  'Marca de archivado (soft-hide) del listado de /equipo. null = la invitación se
   lista; con fecha = el courier la quitó de la vista, y la fecha dice cuándo. La
   FILA NUNCA SE BORRA: es un registro de acceso y queda para auditoría (por eso
   la tabla sigue sin política ni grant de DELETE). El CHECK
   `invitaciones_archivada_solo_si_no_pendiente` impide archivar una invitación
   `pendiente`: esconder un token vivo del único listado donde se vigila sería
   una fuga, no una mejora de interfaz. Ojo: una invitación con `expira_en` en el
   pasado pero `estado` aún `pendiente` NO es archivable hasta que su estado pase
   a terminal, aunque la pantalla la rotule «Expirada».';

-- -----------------------------------------------------------------------------
-- 2. CHECK de coherencia — solo se archiva lo que ya está muerto.
--    VALIDADO a propósito (ver cabecera): no hay histórico que pueda violarlo.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'invitaciones_archivada_solo_si_no_pendiente'
  ) then
    alter table identidad.invitaciones
      add constraint invitaciones_archivada_solo_si_no_pendiente check (
        archivada_en is null or estado <> 'pendiente'
      );
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Superficie de lectura — se agrega `archivada_en` a la lista por columna.
--    Lista completa = la de 20260915000001 + archivada_en. `token` sigue fuera.
-- -----------------------------------------------------------------------------
revoke select on identidad.invitaciones from authenticated;

grant select (
  id,
  tenant_id,
  email,
  telefono,
  tipo_usuario,
  rol,
  seller_id,
  driver_id,
  estado,
  expira_en,
  creado_en,
  archivada_en,
  email_proveedor_id,
  email_estado,
  email_estado_en,
  email_motivo
) on identidad.invitaciones to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Vista espejo — se recrea con `archivada_en`. Sigue SIN `token`.
--    La lista es EXPLÍCITA, nunca `select *`: es parte de la barrera que saca
--    `token` de la superficie PostgREST (20260807000001 §C). Sin CASCADE a
--    propósito: si algo dependiera de esta vista, preferimos fallar ruidoso a
--    dropear el dependiente en silencio.
-- -----------------------------------------------------------------------------
drop view if exists public.invitaciones;

create view public.invitaciones
  with (security_invoker = true)
  as select
    id,
    tenant_id,
    email,
    telefono,
    tipo_usuario,
    rol,
    seller_id,
    driver_id,
    estado,
    expira_en,
    creado_en,
    archivada_en,
    email_proveedor_id,
    email_estado,
    email_estado_en,
    email_motivo
  from identidad.invitaciones;

revoke all on public.invitaciones from authenticated, anon;
grant select on public.invitaciones to authenticated;

comment on view public.invitaciones is
  'Superficie PostgREST de identidad.invitaciones para roles internos. Omite
   `token` a propósito (ver comentario de esa columna). Expone `telefono` (canal
   del conductor, dato de negocio) y `archivada_en` (soft-hide del listado de
   /equipo; el listado filtra `archivada_en is null`). Si se agregan columnas a
   la tabla base, NO se re-emite esta vista con `select *`: la lista explícita es
   parte de la barrera.';

-- -----------------------------------------------------------------------------
-- 5. Recarga del esquema de PostgREST — la columna nueva no existe para la API
--    hasta que recarga su caché. Sin esto, el primer `.is("archivada_en", null)`
--    del listado responde 42703 «column does not exist» aunque la migración haya
--    corrido bien. `notify` es idempotente y no falla si nadie escucha.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';
