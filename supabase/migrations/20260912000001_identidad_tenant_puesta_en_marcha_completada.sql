-- =============================================================================
-- Marca explícita de "puesta en marcha completada" en el tenant
-- =============================================================================
--
-- QUÉ CAMBIA Y POR QUÉ
-- -----------------------------------------------------------------------------
-- Decisión del usuario (2026-09-12): la puesta en marcha deja de ser un checklist
-- sugerente (banner "te falta X") y pasa a ser un WIZARD OBLIGATORIO. Sin
-- terminarlo, el courier no entra al backoffice — el layout lo redirige al
-- wizard. Ver `docs`/concepto de rediseño del onboarding.
--
-- Hasta hoy, "¿está listo para operar?" se DERIVABA de los datos (razón social,
-- sellers, conductores, tarifas, DTE) en `resolverBloqueoOperativo`. Derivarlo es
-- frágil: un filtro por un valor de enum inexistente (`'inactivo'`) hacía caer el
-- conteo a 0 en silencio y "no tienes sellers" con tres cargados. El wizard es un
-- evento con inicio y fin, así que su completitud se guarda EXPLÍCITA en una
-- columna, no se recalcula en cada carga de página.
--
-- `NULL`  = no ha terminado la puesta en marcha (va al wizard).
-- fecha   = la terminó en ese instante (entra normal al backoffice).
--
-- -----------------------------------------------------------------------------
-- BACKFILL: NO ATRAPAR A QUIEN YA OPERA
-- -----------------------------------------------------------------------------
-- Si la columna naciera toda en NULL, TODOS los couriers en producción —incluidos
-- los que ya operan hace semanas— caerían al wizard nuevo y se les bloquearía el
-- backoffice de golpe. El wizard obligatorio es para couriers NUEVOS.
--
-- Criterio de backfill: un tenant con `razon_social` Y `rut` ya tecleados es un
-- courier que YA pasó por su puesta en marcha (esos dos nacen NULL con el alta
-- por correo y solo se llenan durante el onboarding). Se marca completado con la
-- fecha de la migración. Los que están a medio nacer (razón social NULL) quedan
-- en NULL y sí van al wizard, que es lo correcto.
-- =============================================================================

alter table identidad.tenants
  add column if not exists puesta_en_marcha_completada_en timestamptz;

comment on column identidad.tenants.puesta_en_marcha_completada_en is
  'Instante en que el courier terminó el wizard obligatorio de puesta en marcha '
  '(2026-09-12). NULL = no lo terminó: el layout (tenant) lo redirige al wizard '
  'y le bloquea el backoffice. Se escribe por service-role al cerrar el último '
  'paso; se lee con el cliente de sesión (RLS de tenants ya lo permite para el '
  'propio tenant). Reemplaza al derivado `resolverBloqueoOperativo`.';

-- Backfill idempotente: solo toca filas que aún no tienen la marca y que ya
-- tienen identidad completa. Re-ejecutar no mueve una fecha ya puesta.
update identidad.tenants
   set puesta_en_marcha_completada_en = now()
 where puesta_en_marcha_completada_en is null
   and razon_social is not null
   and rut is not null;

-- -----------------------------------------------------------------------------
-- Verificación defensiva (mismo patrón que otras migraciones): si algo quedó a
-- medias, aborta con un mensaje legible en vez de fallar raro después.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'identidad' and table_name = 'tenants'
      and column_name = 'puesta_en_marcha_completada_en'
  ) then
    raise exception 'No se creó puesta_en_marcha_completada_en: el gate del wizard no tendría de dónde leer.';
  end if;

  -- Nadie con identidad completa debería haber quedado sin marcar: sería un
  -- courier operativo redirigido al wizard.
  if exists (
    select 1 from identidad.tenants
    where razon_social is not null and rut is not null
      and puesta_en_marcha_completada_en is null
  ) then
    raise exception 'Quedaron tenants con razón social y RUT sin marcar completados: el backfill no corrió.';
  end if;
end $$;
