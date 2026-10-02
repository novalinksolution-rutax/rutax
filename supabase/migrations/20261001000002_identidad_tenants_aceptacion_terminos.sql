-- =============================================================================
-- 20261001000002 — identidad.tenants: evidencia de aceptación de términos
-- =============================================================================
-- Registro v2 (1-oct-2026): la pantalla «Crea tu cuenta» no lleva casilla; el
-- aviso «Al continuar aceptas los términos y declaras haber leído la política
-- de privacidad» está junto a los botones. Sin casilla, la evidencia de que ese
-- aviso se mostró y a qué redacción corresponde no puede ser un booleano de la
-- pantalla: tiene que quedar en la base (hallazgo H1 de seguridad-cumplimiento).
--
-- Cuatro columnas, TODAS O NINGUNA (precedente: consentimiento_version /
-- consentimiento_datos_en en identidad.seller_identidades, 20260916000001):
--   · terminos_version            versión de los términos mostrada (p. ej. 'v1')
--   · terminos_aceptados_en       instante del clic en «Continuar con Google» /
--                                 «Enviar código» (o en «Continuar» de
--                                 «Tu empresa» si la cuenta volvió sin esa
--                                 intención — ver registro/empresa)
--   · terminos_aceptados_por      auth.users.id de quien aceptó (el dueño)
--   · privacidad_version_informada versión de la política de privacidad vigente
--                                 cuando se mostró. «Informada», no «aceptada»:
--                                 el aviso dice que se leyó, no que se aceptó.
--
-- ⚠️ `terminos_aceptados_por` NO lleva FK a auth.users. Con `on delete set null`
--   la baja de la cuenta rompería el CHECK todas-o-ninguna (y el DELETE fallaría);
--   con `on delete cascade/restrict` se borraría o bloquearía evidencia. Es un
--   uuid de evidencia: sobrevive a la persona, como las filas de bitácora.
--
-- ⚠️ GRANTS: `authenticated` solo tiene SELECT de tabla sobre identidad.tenants
--   (20260101000001) y ninguna escritura, así que estas columnas son escribibles
--   solo por service_role (el alta de tenant la hace el servidor). NO se agrega
--   ningún grant de tabla completa. La vista `public.tenants` enumera sus
--   columnas y NO se repone: estas no se exponen por ahí.
--
-- Sin backfill: los tenants existentes quedan con las cuatro en NULL («sin
-- evidencia»), que es la verdad — se registraron con la casilla anterior.
--
-- Idempotente: add column if not exists, drop constraint if exists + add.
-- =============================================================================

alter table identidad.tenants
  add column if not exists terminos_version text,
  add column if not exists terminos_aceptados_en timestamptz,
  add column if not exists terminos_aceptados_por uuid,
  add column if not exists privacidad_version_informada text;

alter table identidad.tenants
  drop constraint if exists tenants_aceptacion_terminos_completa;
alter table identidad.tenants
  add constraint tenants_aceptacion_terminos_completa
  check (
    num_nonnulls(
      terminos_version,
      terminos_aceptados_en,
      terminos_aceptados_por,
      privacidad_version_informada
    ) in (0, 4)
  );

alter table identidad.tenants
  drop constraint if exists tenants_aceptacion_terminos_versiones_no_vacias;
alter table identidad.tenants
  add constraint tenants_aceptacion_terminos_versiones_no_vacias
  check (
    (terminos_version is null or length(btrim(terminos_version)) > 0)
    and (privacidad_version_informada is null or length(btrim(privacidad_version_informada)) > 0)
  );

comment on column identidad.tenants.terminos_version is
  'Versión de los términos que se mostró al registrarse (src/lib/legal/versiones.ts).
   Va con terminos_aceptados_en, terminos_aceptados_por y privacidad_version_informada:
   las cuatro o ninguna (CHECK). NULL = sin evidencia (alta anterior o del backstage).';
comment on column identidad.tenants.terminos_aceptados_en is
  'Instante en que el dueño pulsó el botón bajo el aviso de términos.';
comment on column identidad.tenants.terminos_aceptados_por is
  'auth.users.id de quien aceptó. Sin FK a propósito: la evidencia sobrevive a la
   baja de la cuenta y un set null rompería el CHECK todas-o-ninguna.';
comment on column identidad.tenants.privacidad_version_informada is
  'Versión de la política de privacidad vigente cuando se mostró el aviso.
   «Informada»: el aviso declara que se leyó, no que se aceptó.';

notify pgrst, 'reload schema';
