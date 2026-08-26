-- =============================================================================
-- Identidad · el teléfono del conductor: columna, formato y vista espejo
-- =============================================================================
-- POR QUÉ EXISTE ESTE ARCHIVO
--
-- `public.conductores` NO es un `select *`: enumera sus columnas una por una.
-- Eso significa que agregar una columna a `identidad.conductores` la deja
-- **invisible para toda la aplicación**, que consulta por la vista vía
-- PostgREST. Y falla del peor modo posible: la migración corre en verde, el
-- typecheck pasa, las pruebas de TypeScript pasan, y lo único que ocurre es que
-- la pantalla muestra el teléfono siempre vacío. Nadie se entera hasta que
-- alguien necesita llamar a un conductor.
--
-- Cualquier migración futura que reponga esa vista —para agregar otra columna,
-- para cambiar un tipo— puede dejar `telefono` afuera al copiar una definición
-- vieja. Es el mismo patrón que ya mordió con el CHECK de tipos de conciliación:
-- una lista que hay que reponer entera y de la que se cae un elemento en
-- silencio. Este archivo lo pone en rojo.
--
-- QUÉ FIJA:
--   1. La columna existe en la tabla base.
--   2. La columna LLEGA A LA VISTA. Es la aserción que de verdad importa.
--   3. El CHECK de E.164 rechaza lo que no está normalizado, y con contraprueba
--      (acepta lo que sí lo está) — un CHECK que rechaza todo también pasaría
--      una prueba que solo compruebe el rechazo.
--   4. `NULL` sigue siendo válido: un conductor sin teléfono cargado es un
--      estado legítimo, no un error.
-- =============================================================================

begin;
select plan(7);

-- 1 · La columna existe donde se guarda.
select has_column('identidad', 'conductores', 'telefono',
  'identidad.conductores tiene la columna telefono');

select col_is_null('identidad', 'conductores', 'telefono',
  'el teléfono es opcional: un conductor sin número cargado es válido');

-- 2 · Y llega a la vista, que es por donde lo lee la aplicación.
select has_column('public', 'conductores', 'telefono',
  'public.conductores expone telefono — si esto falla, la app lo verá SIEMPRE vacío');

-- 3 · El CHECK existe y discrimina.
select has_check('identidad', 'conductores',
  'identidad.conductores tiene un CHECK sobre el formato del teléfono');

-- Contraprueba primero: lo normalizado ENTRA. Sin esto, un CHECK roto que
-- rechazara todo pasaría igual las dos aserciones siguientes.
select lives_ok($$
  insert into identidad.conductores
    (id, tenant_id, nombre_completo, rut, tipo_relacion, estado, telefono)
  values (
    '99999999-9999-9999-9999-999999999901',
    (select id from identidad.tenants limit 1),
    'Prueba Teléfono Válido', '11111111-1', 'dependiente', 'activo',
    '56947095571'
  )
$$, 'un teléfono ya normalizado a E.164 se acepta');

-- Y ahora el rechazo: lo que escribiría una persona, sin pasar por
-- `normalizarTelefonoE164`, NO debe poder guardarse.
select throws_ok($$
  insert into identidad.conductores
    (id, tenant_id, nombre_completo, rut, tipo_relacion, estado, telefono)
  values (
    '99999999-9999-9999-9999-999999999902',
    (select id from identidad.tenants limit 1),
    'Prueba Teléfono Crudo', '11111111-1', 'dependiente', 'activo',
    '+56 9 4709 5571'
  )
$$, '23514', null,
  'un teléfono con + y espacios se rechaza: guardarlo así rompe toda búsqueda por igualdad');

select throws_ok($$
  insert into identidad.conductores
    (id, tenant_id, nombre_completo, rut, tipo_relacion, estado, telefono)
  values (
    '99999999-9999-9999-9999-999999999903',
    (select id from identidad.tenants limit 1),
    'Prueba Teléfono Con Cero', '11111111-1', 'dependiente', 'activo',
    '0056947095571'
  )
$$, '23514', null,
  'un teléfono con prefijo de salida internacional se rechaza: E.164 nunca empieza en 0');

select * from finish();
rollback;
