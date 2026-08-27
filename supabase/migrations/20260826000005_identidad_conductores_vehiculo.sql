-- =============================================================================
-- El vehículo del conductor: moto o auto
-- =============================================================================
--
-- Encargo del usuario (26-08-2026): «no está especificado si el conductor es de
-- moto o de auto». Hasta hoy la nómina no distinguía, y el coordinador que
-- reparte 25-30 paquetes a las 16:00 no tenía cómo saber a quién mandar qué.
--
-- -----------------------------------------------------------------------------
-- ALCANCE: INFORMATIVO. No gobierna nada, y eso se decidió.
-- -----------------------------------------------------------------------------
-- Decisión del usuario, sobre tres alternativas planteadas. El vehículo SE VE —en
-- la nómina, junto al cupo, y en el perfil del conductor— y nada más. NO se
-- filtra: con quince conductores en pantalla, un filtro de dos valores separa
-- menos de lo que cuesta, y mezclarlo en la barra de cajones —que hoy separa «en
-- nómina» de «fuera»— cruzaría dos ejes distintos. El coordinador decide con el
-- dato a la vista. NO toca:
--
--  · `capacidad_paradas` — que ya existe, ya es por conductor y **ya gobierna la
--    auto-asignación** (`auto-asignacion.ts`: el costo es la ocupación
--    `cargaActual / capacidadParadas`). El vehículo EXPLICA esa capacidad, no la
--    reemplaza ni la sugiere todavía.
--
--  · Los tiempos — `MINUTOS_POR_PARADA = 12` y `KMH_LINEA_RECTA = 15` siguen
--    siendo globales. Que una moto sea más rápida en hora punta es cierto y es
--    donde este dato rendiría más, pero cambiar esas constantes mueve la
--    estimación de «necesitas N conductores», la holgura y el cierre estimado,
--    que hoy tienen pruebas que los fijan. Es un alcance aparte.
--
-- ⚠️ Y lo que NO se puede hacer aunque parezca lo natural: bloquear «esto no va
-- en moto». No es computable — un pedido en este modelo es UNA ENTREGA, sin
-- tamaño ni peso. Haría falta modelar el bulto primero.
--
-- -----------------------------------------------------------------------------
-- 🔴 NULLABLE, Y NO ES PEREZA
-- -----------------------------------------------------------------------------
-- Sin default y aceptando `null`. Los conductores que ya existen NO tienen
-- vehículo declarado, y ponerles `auto` por omisión sería inventar un dato que
-- nadie afirmó — con el agravante de que se vería idéntico a uno declarado de
-- verdad. `null` significa «sin declarar», la nómina lo dice así, y el courier
-- ve a quién le falta.
--
-- Solo dos valores porque son los dos que el usuario declaró. Agregar `furgon`
-- después es barato en la base (`alter type … add value`) pero arrastra
-- traducción y distintivo, así que no se adelanta.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'vehiculo_conductor') then
    create type identidad.vehiculo_conductor as enum ('moto', 'auto');
  end if;
end $$;

alter table identidad.conductores
  add column if not exists vehiculo identidad.vehiculo_conductor;

comment on column identidad.conductores.vehiculo is
  'En qué anda el conductor. NULL = sin declarar, y se muestra así: poner un valor
   por omisión inventaría un dato indistinguible de uno declarado. Informativo —
   no gobierna la asignación ni los tiempos (ver la migración 20260826000005).';

-- -----------------------------------------------------------------------------
-- La vista espejo hay que reponerla, o la columna existe y NO SE VE
-- -----------------------------------------------------------------------------
-- `public.conductores` enumera sus columnas: una nueva en la tabla base queda
-- invisible para PostgREST, que es por donde consulta toda la aplicación.
--
-- 🔴 **Y hay que REPETIR el `with (security_invoker = true)`.** `create or
-- replace view` conserva los GRANT pero **reemplaza las opciones**. Perderlo
-- apaga la RLS de la tabla base a través de la vista, y eso abre la nómina entre
-- couriers sin dar un solo error — pasó exactamente hoy, al reponer esta misma
-- vista para el teléfono, y lo arregla la migración 20260826000004. No repetir
-- aquí el mismo error.
--
-- Las columnas nuevas van AL FINAL: `create or replace view` no admite
-- insertarlas en medio, de ahí que `vehiculo` no quede junto a
-- `capacidad_paradas`, que es donde encajaría por significado.
create or replace view public.conductores
  with (security_invoker = true)
  as select
    id,
    tenant_id,
    nombre_completo,
    rut,
    tipo_relacion,
    estado,
    creado_en,
    actualizado_en,
    disponible,
    capacidad_paradas,
    banco,
    tipo_cuenta,
    numero_cuenta,
    telefono,
    vehiculo
  from identidad.conductores;

-- ── Aserciones ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'identidad' and table_name = 'conductores'
      and column_name = 'vehiculo'
  ) then
    raise exception 'falta identidad.conductores.vehiculo';
  end if;

  -- La mitad que se olvida: la columna existe pero la vista no la muestra, y la
  -- pantalla enseña «Sin declarar» para siempre sin que nada falle.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'conductores'
      and column_name = 'vehiculo'
  ) then
    raise exception
      'vehiculo no llegó a public.conductores: la app consulta por la vista y no vería nunca el dato';
  end if;

  -- Y que reponer la vista no volvió a tirar la opción.
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'conductores'
      and array_to_string(c.reloptions, ',') like '%security_invoker=true%'
  ) then
    raise exception
      'public.conductores quedó SIN security_invoker: la RLS no se aplicaría y la nómina se filtraría entre couriers';
  end if;
end $$;
