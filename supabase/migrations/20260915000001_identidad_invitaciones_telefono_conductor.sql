-- =============================================================================
-- Identidad — La invitación del CONDUCTOR pasa a ser por TELÉFONO (F4.a)
-- =============================================================================
-- POR QUÉ. Hoy toda invitación es por CORREO: el invitado abre `/invitacion/<token>`
-- y, si es conductor, fija un PIN que termina siendo su contraseña de Supabase.
-- F4 cambia SOLO al conductor: se le invita por su TELÉFONO y entra por WhatsApp
-- OTP, sin correo y sin PIN-contraseña. El resto —seller, dueño, supervisor,
-- coordinador, administración— sigue entrando por correo, intacto.
--
-- Esta migración prepara la TABLA para llevar el teléfono; el flujo de canje por
-- teléfono (`aceptarInvitacionPorTelefono`) es backend y vive en otra tarea. Aquí
-- no se toca ni una línea de TypeScript.
--
-- El discriminador sigue siendo `tipo_usuario`: `'conductor'` viaja por teléfono,
-- todo lo demás por correo. Para que una invitación no pueda quedar a medio camino
-- (correo Y teléfono, o ninguno de los dos) se impone un CHECK de coherencia
-- contacto↔tipo, espejo de los `*_coherente` que ya existen para seller_id/driver_id.
--
-- ⚠️ DECISIÓN SOBRE EL CHECK — se agrega `NOT VALID`. Antes de esta migración
-- TODAS las filas son por correo (email NOT NULL, telefono NULL), incluidas las
-- invitaciones de conductor viejas. La nueva regla exige que un conductor tenga
-- `telefono NOT NULL AND email IS NULL`, así que CUALQUIER invitación de conductor
-- preexistente violaría el CHECK y abortaría la migración. No se borran datos ni se
-- reescriben filas: en producción el conductor real entra por PIN y las invitaciones
-- de conductor pendientes por correo son residuales (a lo sumo caducan solas por
-- `expira_en`). `NOT VALID` hace que el CHECK gobierne desde ya toda fila NUEVA o
-- MODIFICADA, sin validar el histórico. Alternativa considerada y descartada:
-- marcar `revocada` las invitaciones de conductor pendientes con correo — es una
-- mutación de datos que esta migración de esquema no debe hacer a ciegas; si el
-- equipo la quiere, va como acción de backend auditada, no aquí.
--
-- El teléfono es dato personal de trabajador (Ley 21.431): se minimiza (solo el
-- número vigente, sin histórico), se guarda en E.164 SIN «+» con el MISMO CHECK de
-- formato que `identidad.conductores.telefono`, y NUNCA va a logs ni URLs. Es dato
-- de negocio (no un secreto como `token`), así que lo ven los mismos ojos internos
-- que ya ven el correo: entra a la lista de grant por columna y a la vista espejo.
-- `token` sigue fuera de ambas, como en 20260807000001/2.
--
-- Idempotente: alter ... drop not null y add column if not exists son repetibles;
-- los constraints van por DO-block sobre pg_constraint; índices con if not exists;
-- REVOKE/GRANT declarativos; la vista por drop + create.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. `email` deja de ser obligatorio — el conductor no lo lleva.
--    (No se agrega CHECK de formato de email: no existe hoy, no se inventa.)
-- -----------------------------------------------------------------------------
alter table identidad.invitaciones
  alter column email drop not null;

-- -----------------------------------------------------------------------------
-- 2. Columna `telefono` — E.164 sin «+», mismo formato que conductores.telefono.
-- -----------------------------------------------------------------------------
alter table identidad.invitaciones
  add column if not exists telefono text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invitaciones_telefono_e164'
  ) then
    alter table identidad.invitaciones
      add constraint invitaciones_telefono_e164 check (
        telefono is null or telefono ~ '^[1-9][0-9]{7,14}$'
      );
  end if;
end $$;

comment on column identidad.invitaciones.telefono is
  'Teléfono del CONDUCTOR invitado, en E.164 sin «+» (mismo formato y CHECK que
   identidad.conductores.telefono). Es el canal de la invitación por WhatsApp OTP
   que reemplaza al correo para el conductor. Dato personal de trabajador
   (Ley 21.431): minimizado (solo el número vigente, sin histórico) y NUNCA en
   logs ni URLs. Es dato de negocio, no un secreto: lo ven los mismos roles
   internos que ya ven `email`.';

-- -----------------------------------------------------------------------------
-- 3. Coherencia contacto↔tipo — el conductor por teléfono, el resto por correo.
--    NOT VALID a propósito (ver cabecera): gobierna filas nuevas/modificadas sin
--    validar el histórico, que es 100% correo.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invitaciones_contacto_por_tipo'
  ) then
    alter table identidad.invitaciones
      add constraint invitaciones_contacto_por_tipo check (
        case
          when tipo_usuario = 'conductor'
            then telefono is not null and email is null
          else email is not null and telefono is null
        end
      ) not valid;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Unicidad de invitación viva por teléfono, ACOTADA al tenant y al conductor
--    pendiente. Permite que el mismo número tenga una invitación pendiente en
--    couriers DISTINTOS (un conductor sirve a más de un courier — decisión §11.1),
--    pero no dos vivas en el mismo tenant.
-- -----------------------------------------------------------------------------
create unique index if not exists invitaciones_telefono_pendiente_conductor_uk
  on identidad.invitaciones (tenant_id, telefono)
  where estado = 'pendiente' and tipo_usuario = 'conductor';

-- Índice de ayuda para la resolución por teléfono tras el OTP. Barato y parcial.
create index if not exists invitaciones_telefono_idx
  on identidad.invitaciones (telefono)
  where telefono is not null;

-- -----------------------------------------------------------------------------
-- 5. Superficie de lectura — se agrega `telefono` a la lista por columna.
--    `token` sigue fuera. Lista completa = la de 20260807000002 + telefono.
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
  email_proveedor_id,
  email_estado,
  email_estado_en,
  email_motivo
) on identidad.invitaciones to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Vista espejo — se recrea con `telefono`. Sigue SIN `token`.
--    Sin CASCADE a propósito (igual que 20260807000001): si algo dependiera de
--    esta vista, preferimos fallar ruidoso a dropear el dependiente en silencio.
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
   del conductor, dato de negocio). Si se agregan columnas a la tabla base, NO se
   re-emite esta vista con `select *`: la lista explícita es parte de la barrera.';
