-- =============================================================================
-- 20260712000002 · Plataforma — trazabilidad de edición del catálogo de planes
--                   (actualizado_en + trigger en plataforma.planes)
-- =============================================================================
-- Migración ADITIVA e IDEMPOTENTE. "Ola 1" (monetización base) del backstage de
-- plataforma (F2), habilita el CRUD de planes del super-admin. El CRUD en sí son
-- writes por service_role (no requiere schema nuevo — planes ya tiene id, nombre,
-- descripcion, precio_mensual_clp, precio_anual_clp, limite_pedidos_mes,
-- caracteristicas, activo, creado_en). Lo ÚNICO que falta para trazar las
-- ediciones es `actualizado_en`: la tabla nació (0015) solo con `creado_en`, así
-- que un UPDATE del super-admin sobre un plan (subir precio, activar/desactivar)
-- no dejaba rastro de "cuándo se tocó por última vez". Esta migración lo agrega.
--
-- DECISIÓN — trigger, no solo columna:
--   plataforma.suscripciones tiene `actualizado_en` sin trigger (el service_role lo
--   fija a mano en cada write). Para el catálogo de planes, que es una tabla de
--   CRUD editada a mano desde `/admin`, preferimos un trigger BEFORE UPDATE que
--   bumpea `actualizado_en = now()` en TODA edición — así la trazabilidad no
--   depende de que cada ruta del backend recuerde setearlo. Se crea una función de
--   trigger propia del schema (`plataforma.set_actualizado_en`), sin acoplar
--   plataforma a `identidad.set_actualizado_en`.
--
-- AISLAMIENTO — SIN CAMBIOS (crítico, prioridad #1):
--   NO se crea ninguna política RLS para authenticated/anon, ni grants a esos
--   roles, ni vistas en `public`. La columna y el trigger nuevos quedan cubiertos
--   por el MISMO deny-all de la tabla base (RLS enable+force SIN políticas + grants
--   revocados, migración 0015). El GRANT de TABLA a service_role de la 0015 ya
--   alcanza la columna nueva. Un courier autenticado sigue sin poder leer NADA de
--   plataforma.planes (verificado en rls_aislamiento_plataforma.test.sql). Se
--   reafirma el revoke a authenticated/anon como defensa en profundidad (idempotente).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS; CREATE OR REPLACE FUNCTION; DROP TRIGGER
-- IF EXISTS + CREATE TRIGGER. Re-aplicable sobre una base ya migrada.
-- =============================================================================

-- El schema ya existe (migración 0015); create defensivo e idempotente.
create schema if not exists plataforma;

-- -----------------------------------------------------------------------------
-- 1. Columna ADITIVA actualizado_en (creado_en ya existía en la 0015)
-- -----------------------------------------------------------------------------
-- NOT NULL default now(): las filas existentes (planes sembrados) reciben now() al
-- aplicar la migración; no es dato histórico real, pero marca el punto de partida
-- de la trazabilidad. A partir de aquí, cada UPDATE lo refresca vía trigger.
alter table plataforma.planes
  add column if not exists actualizado_en timestamptz not null default now();

comment on column plataforma.planes.actualizado_en is
  'Marca de la última edición del plan (CRUD del super-admin). Bumpeada por el '
  'trigger trg_planes_actualizado_en en cada UPDATE. Trazabilidad del catálogo. '
  'No cambia el deny-all: sin políticas para authenticated.';

-- -----------------------------------------------------------------------------
-- 2. Función de trigger propia del schema plataforma
-- -----------------------------------------------------------------------------
-- Espeja identidad.set_actualizado_en pero vive en `plataforma` para no acoplar
-- este schema a `identidad` por una utilidad trivial. Idempotente (or replace).
create or replace function plataforma.set_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

comment on function plataforma.set_actualizado_en() is
  'Trigger BEFORE UPDATE: fija actualizado_en = now(). Trazabilidad de ediciones '
  'en tablas de CRUD del schema plataforma (hoy: planes).';

-- -----------------------------------------------------------------------------
-- 3. Trigger en plataforma.planes
-- -----------------------------------------------------------------------------
drop trigger if exists trg_planes_actualizado_en on plataforma.planes;
create trigger trg_planes_actualizado_en
  before update on plataforma.planes
  for each row execute function plataforma.set_actualizado_en();

-- -----------------------------------------------------------------------------
-- 4. Reafirmación del deny-all (defensa en profundidad, idempotente)
-- -----------------------------------------------------------------------------
-- El grant a service_role de la 0015 (a nivel de TABLA) ya alcanza la columna nueva;
-- NO se otorga nada nuevo. Se reafirma el revoke a authenticated/anon.
revoke all on plataforma.planes from authenticated, anon;
