-- =============================================================================
-- El teléfono de una persona del equipo interno
-- =============================================================================
--
-- Existe porque hasta hoy `identidad.usuarios_perfil` guardaba el nombre y nada
-- más: quien entra a «Mi perfil» no tenía un solo dato propio que corregir. El
-- conductor tiene su teléfono en `identidad.conductores` y el seller su contacto
-- en `identidad.sellers`; el equipo interno no tenía dónde.
--
-- -----------------------------------------------------------------------------
-- MISMO CRITERIO QUE EL DEL CONDUCTOR, A PROPÓSITO
-- -----------------------------------------------------------------------------
-- E.164 sin el `+`, con el mismo CHECK que `conductores_telefono_e164`. Dos
-- formatos de teléfono en la misma base es lo que obliga a escribir dos
-- normalizadores y a que el segundo se olvide. En TypeScript lo impone
-- `normalizarTelefonoE164` de `src/lib/telefono-cl.ts`, que ya existía.
--
-- -----------------------------------------------------------------------------
-- ⚠️ NO SE AGREGA A LA VISTA `public.usuarios_perfil`, Y NO ES UN OLVIDO
-- -----------------------------------------------------------------------------
-- Esa vista enumera sus columnas una por una, así que una columna nueva **no se
-- expone sola** — que es justo la propiedad que hace segura esta migración.
--
-- El teléfono de una persona es dato personal y nada del producto lo necesita
-- del lado del cliente: la pantalla de perfil es un componente de servidor y lo
-- lee con `service_role`. Dejarlo fuera de la vista es minimización, no una
-- omisión: si algún día una superficie de cliente lo necesita, se agrega ahí con
-- su grant por columna y su prueba, no antes.
--
-- Es la contracara del defecto que ya mordió dos veces en este repo (el
-- snapshot de regla y el token de invitación): un `GRANT` de tabla completa
-- filtra la columna nueva aunque la vista parezca restringida.
-- =============================================================================

alter table identidad.usuarios_perfil
  add column if not exists telefono text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'identidad.usuarios_perfil'::regclass
      and conname = 'usuarios_perfil_telefono_e164'
  ) then
    alter table identidad.usuarios_perfil
      add constraint usuarios_perfil_telefono_e164
      check (telefono is null or telefono ~ '^[1-9][0-9]{7,14}$');
  end if;
end $$;

comment on column identidad.usuarios_perfil.telefono is
  'Teléfono de contacto en E.164 sin «+» (mismo formato que identidad.conductores.telefono). Dato personal: NO se expone en la vista public.usuarios_perfil.';

-- Aserción defensiva: si la columna no quedó, la migración falla acá y no en la
-- primera pantalla que intente escribirla.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'identidad'
      and table_name = 'usuarios_perfil'
      and column_name = 'telefono'
  ) then
    raise exception 'identidad.usuarios_perfil.telefono no quedó creada';
  end if;

  -- Y la contraprueba de la decisión de arriba: que NO esté en la vista.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'usuarios_perfil'
      and column_name = 'telefono'
  ) then
    raise exception
      'telefono quedó expuesta en public.usuarios_perfil: es dato personal y la vista debe seguir enumerando sus columnas';
  end if;
end $$;
