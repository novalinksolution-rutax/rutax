-- =============================================================================
-- El courier puede nacer sin razón social ni RUT: los pone su dueño después
-- =============================================================================
--
-- QUÉ CAMBIA Y POR QUÉ
-- -----------------------------------------------------------------------------
-- Decisión del usuario (2026-08-30): el alta desde el backstage es SOLO el
-- correo del dueño. Rutax no teclea los datos de la empresa; los pone el propio
-- dueño cuando acepta la invitación y hace su puesta en marcha.
--
-- Pero `identidad.tenants` exigía `razon_social` y `rut` NOT NULL al crear la
-- fila, y un dueño no puede «entrar a la puesta en marcha» sin estar logueado,
-- y no puede estar logueado sin un tenant (su perfil exige `tenant_id`). O sea:
-- el tenant tiene que existir ANTES de que el dueño escriba su razón social y su
-- RUT. La única forma de que esos dos datos los ponga él es permitir que el
-- tenant nazca sin ellos.
--
-- Se relajan a NULLABLE. La puesta en marcha los vuelve obligatorios por otra
-- vía —un bloqueo operativo: sin razón social ni RUT el courier no puede operar
-- (ver `resolverBloqueoOperativo`)— así que el dato sigue siendo requerido para
-- funcionar; lo que cambia es CUÁNDO y QUIÉN lo pone.
--
-- `nombre_fantasia` NO se toca: sigue NOT NULL. El alta siempre le pone un
-- nombre provisional (derivado del correo) para que el courier sea reconocible
-- en el backstage desde el minuto cero; el dueño lo corrige en su puesta en
-- marcha.
--
-- -----------------------------------------------------------------------------
-- EL RUT ÚNICO SIGUE PROTEGIENDO CONTRA DUPLICADOS
-- -----------------------------------------------------------------------------
-- `tenants_rut_uk` es UNIQUE, y Postgres trata cada NULL como distinto: varios
-- couriers a medio nacer pueden convivir con `rut IS NULL` sin chocar. Cuando el
-- dueño escribe su RUT en la puesta en marcha, el UPDATE recién ahí choca con la
-- unicidad si ese RUT ya pertenece a otro courier — y ese caso se maneja con un
-- mensaje claro en la acción, no con un 500. La protección no se pierde: se
-- corre al momento en que el RUT existe de verdad.
--
-- El CHECK de formato del RUT ya toleraba NULL (`null ~ patrón` es NULL, y un
-- CHECK solo falla con FALSE), pero se reescribe explícito para que quede dicho.
-- =============================================================================

alter table identidad.tenants alter column razon_social drop not null;
alter table identidad.tenants alter column rut          drop not null;

-- CHECK de formato explícito sobre NULL (documenta la intención; el anterior ya
-- dejaba pasar NULL por la semántica de CHECK, pero mejor decirlo).
alter table identidad.tenants drop constraint if exists tenants_rut_formato;
alter table identidad.tenants add constraint tenants_rut_formato
  check (rut is null or rut ~ '^[0-9]{1,8}-[0-9kK]$');

comment on column identidad.tenants.razon_social is
  'Razón social del courier. NULLABLE desde 2026-08-30: el alta por correo la '
  'deja en NULL y el dueño la completa en su puesta en marcha, que la vuelve '
  'obligatoria vía bloqueo operativo. Va impresa en cada DTE, cuya emisión ya '
  'está detrás de la puesta en marcha completa.';

comment on column identidad.tenants.rut is
  'RUT del courier (NNNNNNNN-DV). NULLABLE desde 2026-08-30, misma razón que '
  'razon_social. `tenants_rut_uk` (UNIQUE) sigue impidiendo duplicados: varios '
  'NULL conviven, y el choque real se detecta al escribir el RUT en la puesta '
  'en marcha.';

-- -----------------------------------------------------------------------------
-- Verificación defensiva (mismo patrón que otras migraciones §8): si algo quedó
-- a medias, aborta con un mensaje legible en vez de fallar raro después.
-- -----------------------------------------------------------------------------
do $$
begin
  -- Las dos columnas quedaron NULLABLE.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'identidad' and table_name = 'tenants'
      and column_name in ('razon_social', 'rut') and is_nullable = 'NO'
  ) then
    raise exception 'razon_social o rut siguen NOT NULL: el alta por correo no podría crear el tenant.';
  end if;

  -- nombre_fantasia NO se relajó: es la única identidad visible del courier
  -- recién invitado en el backstage.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'identidad' and table_name = 'tenants'
      and column_name = 'nombre_fantasia' and is_nullable = 'YES'
  ) then
    raise exception 'nombre_fantasia quedó NULLABLE y no debía: el courier invitado quedaría sin nombre en el panel.';
  end if;

  -- La llave anti-duplicado sigue en pie. Es un ÍNDICE único (no un constraint),
  -- así que se busca en pg_indexes; un índice UNIQUE también trata cada NULL
  -- como distinto, que es justo lo que permite varios couriers a medio nacer.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'identidad' and tablename = 'tenants' and indexname = 'tenants_rut_uk'
  ) then
    raise exception 'Desapareció tenants_rut_uk: sin ella dos couriers podrían compartir RUT.';
  end if;
end $$;
