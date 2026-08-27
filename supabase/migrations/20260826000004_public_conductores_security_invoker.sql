-- =============================================================================
-- 🔴 `public.conductores` perdió `security_invoker` y filtraba entre couriers
-- =============================================================================
--
-- Introducido HOY por la migración `20260826000001` (el teléfono del conductor).
-- Esa migración tuvo que reponer la vista espejo —agregar una columna a la tabla
-- base la deja invisible para PostgREST— y la repuso así:
--
--     create or replace view public.conductores as select … from identidad.conductores;
--
-- La original decía `create or replace view public.conductores WITH
-- (security_invoker = true) as …`. **`create or replace view` reemplaza las
-- opciones de la vista**: al no repetir el `WITH`, `security_invoker` se perdió.
--
-- -----------------------------------------------------------------------------
-- QUÉ ROMPIÓ, EXACTAMENTE
-- -----------------------------------------------------------------------------
-- Sin `security_invoker`, la vista se ejecuta con los privilegios del DUEÑO de
-- la vista, no de quien consulta. La RLS de `identidad.conductores` —«interno ve
-- toda SU nómina; conductor ve SOLO su propia fila»— deja de aplicarse a través
-- de la vista, y la aplicación consulta SIEMPRE por la vista.
--
-- Comprobado en local antes de escribir esto, con dos tenants sembrados y una
-- sesión `authenticated` con los claims del tenant A:
--
--   · `select … from public.conductores`      → «Conductor de A | Conductor de B»
--   · `select … from identidad.conductores`   → «Conductor de A»
--
-- O sea: la RLS estaba bien. La vista la esquivaba. Un courier podía leer la
-- nómina de otro — la regla que el proyecto declara no negociable.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ NO SE NOTÓ
-- -----------------------------------------------------------------------------
-- Falla del peor modo posible: no hay error, no hay lentitud, y con un solo
-- tenant en la base —que es el caso de local y el de producción hoy— **el
-- resultado es idéntico al correcto**. Solo aparece cuando existe un segundo
-- courier, que es justo cuando ya es tarde.
--
-- ⚠️ La lección, para la próxima vez que haya que reponer una vista espejo:
-- `create or replace view` **conserva los GRANT pero NO las opciones**. Si la
-- vista tenía `WITH (security_invoker = true)`, hay que repetirlo. Las otras
-- tres vistas de este tipo (`sellers`, `usuarios_perfil`, `conexiones_seller_ml`)
-- lo conservaron porque nadie las tocó.
-- =============================================================================

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
    telefono
  from identidad.conductores;

comment on view public.conductores is
  'Espejo de identidad.conductores para PostgREST. RLS heredada de la tabla base
   (security_invoker = true): interno ve toda su nómina; conductor ve SOLO su
   propia fila. ⚠️ Al reponer esta vista hay que REPETIR el `with
   (security_invoker = true)`: create or replace conserva los GRANT pero NO las
   opciones, y perderlo abre la nómina entre couriers sin dar ningún error.';

-- ── Aserción ────────────────────────────────────────────────────────────────
--
-- No comprueba que la columna exista: comprueba **la opción**, que es lo que se
-- perdió. Falla al migrar y no en la primera consulta de un segundo courier.
--
-- Se recorren las CUATRO vistas espejo de una vez. Si mañana alguien repone
-- cualquiera de ellas y se le olvida el `WITH`, esto lo detiene acá.
do $$
declare
  v_sin_invoker text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into v_sin_invoker
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and c.relname in ('conductores', 'sellers', 'usuarios_perfil', 'conexiones_seller_ml')
    and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=true%';

  if v_sin_invoker is not null then
    raise exception
      'Estas vistas espejo NO tienen security_invoker=true y por tanto NO aplican la RLS de quien consulta: %. Reponlas con «with (security_invoker = true)».',
      v_sin_invoker;
  end if;
end $$;
