-- =============================================================================
-- El teléfono del conductor
-- =============================================================================
-- La ficha del conductor no mostraba «ni número ni correo» (encargo del usuario,
-- 2026-08-25). El correo sí existía —vive en `auth.users`, colgando del perfil—
-- pero el teléfono NO EXISTÍA EN NINGUNA PARTE: `identidad.conductores` tenía
-- nombre, RUT, relación, capacidad y datos bancarios, y ni una forma de llamar
-- a la persona.
--
-- Es una ausencia con consecuencia operativa concreta: el despacho arranca a las
-- 16:00 y el coordinador resuelve por teléfono lo que se tuerce en la calle. Ese
-- número hoy vive en la agenda personal de alguien.
--
-- -----------------------------------------------------------------------------
-- ⚠️ DATO PERSONAL DE UN TRABAJADOR (Ley 21.431)
-- -----------------------------------------------------------------------------
-- Se agrega a propósito y minimizado:
--   · UNA columna con el número VIGENTE. Sin histórico, sin tabla de versiones.
--     Un registro de «qué números tuvo este conductor» no le sirve a nadie de la
--     operación y sí es una acumulación de dato personal sin propósito.
--   · Finalidad acotada y legítima: contactar al conductor por el trabajo.
--   · Nunca en logs, nunca en URLs, nunca en el motivo de un error (ver
--     `src/lib/telefono-cl.ts`, que jamás devuelve el número en el motivo).
--
-- QUIÉN LO VE: nadie nuevo. La política `conductores_select` ya existente limita
-- la lectura a (a) usuarios `interno` del mismo tenant y (b) el propio conductor
-- sobre su fila. **Un seller no puede leer esta tabla**, así que la columna no
-- amplía la superficie de exposición: los mismos ojos que ya veían el RUT y la
-- cuenta bancaria ven ahora el teléfono.
--
-- Por eso NO hace falta grant por columna acá. El caso que sí lo exige es el
-- contrario —una tabla que lee alguien de fuera, como el `token_ref` de las
-- conexiones del seller—, y este no lo es. Si algún día un seller pudiera leer
-- `conductores`, esta decisión se cae y hay que rehacerla.
-- =============================================================================

alter table identidad.conductores
  add column if not exists telefono text;

comment on column identidad.conductores.telefono is
  'Teléfono de contacto del conductor en E.164 sin «+» (ej: 56947095571). '
  'Dato personal (Ley 21.431): solo el número vigente, sin histórico. '
  'Nunca en logs ni en URLs. Normalizado por src/lib/telefono-cl.ts antes de escribir.';

-- El formato se impone en la base y no solo en la aplicación, por la misma razón
-- de siempre: la aplicación no es el único escritor posible. Guardar
-- `+56 9 4709 5571` y `56947095571` como si fueran distintos es la forma
-- silenciosa de que un `where telefono = …` no encuentre a nadie.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'identidad.conductores'::regclass
      and conname = 'conductores_telefono_e164'
  ) then
    alter table identidad.conductores
      add constraint conductores_telefono_e164
      check (telefono is null or telefono ~ '^[1-9][0-9]{7,14}$');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- La vista espejo hay que reponerla, o la columna existe y NO SE VE
-- -----------------------------------------------------------------------------
-- ⚠️ `public.conductores` enumera sus columnas una por una; no es un `select *`.
-- Agregar la columna a la tabla base la deja invisible para toda la aplicación,
-- que consulta por la vista (PostgREST). Falla del peor modo: la migración pasa
-- en verde, el typecheck pasa, y la pantalla muestra el teléfono siempre vacío.
--
-- `create or replace view` conserva los GRANT existentes y admite columnas
-- nuevas SOLO AL FINAL — de ahí que `telefono` vaya último y no junto al RUT,
-- que es donde encajaría por significado.
create or replace view public.conductores as
  select
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
    telefono
  from identidad.conductores;
