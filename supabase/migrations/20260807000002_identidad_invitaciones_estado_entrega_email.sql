-- =============================================================================
-- Identidad — Estado de ENTREGA del correo de invitación
-- =============================================================================
-- POR QUÉ. `crearInvitacion` ya manda el correo y guarda si el proveedor lo
-- ACEPTÓ. Pero aceptar no es entregar: Resend responde 200 con un id y el rebote
-- (dirección inexistente, buzón lleno, dominio caído) ocurre después, de forma
-- asincrónica. Probando en producción se invitó a un seller con la dirección mal
-- escrita: la pantalla confirmó el envío y nadie se enteró nunca de que el
-- correo no llegó. La invitación queda pendiente para siempre, el seller no
-- entra, y el courier no tiene una sola señal de por qué.
--
-- Estas columnas son el destino de los webhooks de Resend (`email.delivered`,
-- `email.bounced`, `email.complained`), que consume
-- `POST /api/webhooks/resend`.
--
-- `email_proveedor_id` es la CLAVE DE CORRELACIÓN: el webhook trae el id del
-- mensaje, no el de la invitación. Sin guardarlo al enviar no hay forma de
-- saber a qué invitación pertenece un rebote. NO es un secreto (es un
-- identificador de trazabilidad del proveedor, igual que `proveedorId` en
-- `ResultadoEnvioEmail`), así que sí va en la superficie de lectura.
--
-- `email_estado` es TEXT + CHECK y no un enum a propósito: el catálogo de
-- eventos del proveedor puede crecer, y ampliar un CHECK es una migración
-- trivial mientras que alterar un enum en uso no lo es.
--
-- GRANTS: se sigue la regla de la migración 20260807000001 — lista EXPLÍCITA de
-- columnas, nunca `grant select on <tabla>`. Estas cuatro son datos de negocio
-- (no secretos), así que se agregan a la superficie de `authenticated` para que
-- el panel de equipo pueda mostrar el rebote igual que /sellers. `token` sigue
-- fuera, como debe.
--
-- Idempotente: add column if not exists, DO-block para el constraint, REVOKE/
-- GRANT declarativos, vista por drop + create.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columnas
-- -----------------------------------------------------------------------------
alter table identidad.invitaciones
  add column if not exists email_proveedor_id text,
  add column if not exists email_estado       text,
  add column if not exists email_estado_en    timestamptz,
  add column if not exists email_motivo       text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invitaciones_email_estado_valido'
  ) then
    alter table identidad.invitaciones
      add constraint invitaciones_email_estado_valido check (
        email_estado is null or email_estado in (
          'enviado',      -- el proveedor aceptó la petición (aún no sabemos si llegó)
          'entregado',    -- email.delivered — llegó al buzón del destinatario
          'rebotado',     -- email.bounced — NO llegó y no va a llegar
          'marcado_spam'  -- email.complained — llegó, y lo marcaron como spam
        )
      );
  end if;
end $$;

-- Clave de correlación del webhook → invitación. Parcial (la mayoría de las
-- filas lo tienen null) y ÚNICA: el proveedor asigna un id por mensaje, así que
-- dos invitaciones no pueden compartirlo. La unicidad no es cosmética — el
-- handler resuelve la invitación con `.maybeSingle()`, que ante dos filas
-- devuelve error en vez de elegir una. Sin este índice esa garantía sería una
-- suposición del código; con él, la impone la base.
create unique index if not exists invitaciones_email_proveedor_id_uk
  on identidad.invitaciones (email_proveedor_id)
  where email_proveedor_id is not null;

comment on column identidad.invitaciones.email_proveedor_id is
  'Id del mensaje asignado por el proveedor de correo al aceptar el envío. Clave
   de correlación para los webhooks de entrega/rebote: el webhook trae este id,
   no el de la invitación. Trazabilidad, NO un secreto.';

comment on column identidad.invitaciones.email_estado is
  'Qué sabemos de la ENTREGA del correo de invitación. `enviado` = el proveedor
   lo aceptó, que NO es lo mismo que entregado. `rebotado` es el estado
   accionable: el correo no llegó ni va a llegar, y el courier debe usar
   "Copiar enlace" o corregir la dirección. null = invitación anterior a esta
   migración, o creada sin envío (sandbox / sin URL pública declarada).';

comment on column identidad.invitaciones.email_motivo is
  'Descripción SANEADA de por qué rebotó, tal como la reporta el proveedor
   (p. ej. "hard bounce"). Nunca lleva el cuerpo del correo ni secretos.';

-- -----------------------------------------------------------------------------
-- 2. Superficie de lectura — lista explícita, `token` sigue fuera.
-- -----------------------------------------------------------------------------
revoke select on identidad.invitaciones from authenticated;

grant select (
  id,
  tenant_id,
  email,
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
-- 3. Vista espejo — se recrea con las columnas nuevas. Sigue SIN `token`.
-- -----------------------------------------------------------------------------
drop view if exists public.invitaciones;

create view public.invitaciones
  with (security_invoker = true)
  as select
    id,
    tenant_id,
    email,
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
   `token` a propósito (ver comentario de esa columna). Si se agregan columnas a
   la tabla base, NO se re-emite esta vista con `select *`: la lista explícita es
   parte de la barrera.';
