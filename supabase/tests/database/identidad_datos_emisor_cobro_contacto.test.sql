-- =============================================================================
-- Identidad · datos del emisor SII, cuenta de cobro y contacto público
-- =============================================================================
-- POR QUÉ EXISTE ESTE ARCHIVO
--
-- 🔴 LA VISTA ESPEJO. `public.tenants` se creó como `select *`, y la suposición
-- natural —«una columna nueva llega sola»— es FALSA: Postgres expande el
-- `select *` al crear la vista y guarda la lista. Agregar una columna a la tabla
-- base no la agrega a la vista.
--
-- Mordió mientras se construía esto, y de la peor forma: la app escribe con
-- `service_role` sobre `identidad.tenants` —el dato queda guardado— pero LEE por
-- la vista con el cliente de sesión. La pantalla decía «falta el giro» con el
-- giro escrito, y como la consulta pedía columnas inexistentes, **fallaba
-- entera**: hasta el nombre del courier salía como «tu courier». Sin error en
-- consola, sin log.
--
-- ⚠️ Y la vista se repone con `create or replace`, que **conserva los GRANT pero
-- reemplaza las opciones**: si alguien la vuelve a tocar sin repetir
-- `security_invoker = true`, la RLS de la tabla base deja de aplicarse a través
-- de ella y un courier lee los datos de otro. Por eso se asevera la opción, no
-- solo las columnas.
--
-- QUÉ FIJA:
--   1. Las columnas existen en la tabla base y LLEGAN A LA VISTA (lo que
--      importa: la app lee por ahí).
--   2. La vista conserva `security_invoker`.
--   3. Los CHECK de formato discriminan, con contraprueba — un CHECK que
--      rechaza todo también pasaría una prueba que solo compruebe el rechazo.
--   4. `courier_datos_cobro` la ve el seller del MISMO tenant (es a donde paga),
--      no la de otro courier, y no la ve el conductor.
-- =============================================================================

begin;
select plan(20);

-- -----------------------------------------------------------------------------
-- 1 · Las columnas del Emisor y del contacto, en la tabla y en la vista
-- -----------------------------------------------------------------------------
select has_column('identidad', 'tenants', 'giro', 'identidad.tenants tiene giro');
select has_column('identidad', 'tenants', 'actividad_economica',
  'identidad.tenants tiene actividad_economica');

select has_column('public', 'tenants', 'giro',
  'public.tenants expone giro — si falla, la app lo lee SIEMPRE vacío');
select has_column('public', 'tenants', 'direccion', 'public.tenants expone direccion');
select has_column('public', 'tenants', 'comuna', 'public.tenants expone comuna');
select has_column('public', 'tenants', 'actividad_economica',
  'public.tenants expone actividad_economica');
select has_column('public', 'tenants', 'telefono_contacto',
  'public.tenants expone telefono_contacto');
select has_column('public', 'tenants', 'email_contacto',
  'public.tenants expone email_contacto');

-- Arrastraba la misma omisión desde que se agregó a la tabla base. Hoy su único
-- lector va por `.schema('identidad')` y la esquiva, pero es la misma trampa
-- esperando al próximo que use la vista.
select has_column('public', 'tenants', 'seller_id_gasto_propio',
  'public.tenants expone seller_id_gasto_propio');

-- -----------------------------------------------------------------------------
-- 2 · La vista conserva security_invoker
-- -----------------------------------------------------------------------------
select ok(
  (select 'security_invoker=true' = any(c.reloptions)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'tenants'),
  'public.tenants conserva security_invoker: sin él la RLS no aplica a través de la vista');

-- -----------------------------------------------------------------------------
-- 3 · Los CHECK discriminan, con contraprueba
-- -----------------------------------------------------------------------------
insert into identidad.tenants (id, nombre_fantasia, razon_social, rut)
values ('eeeeeeee-0000-0000-0000-000000000001', 'Courier Datos', 'Courier Datos SpA', '77100001-8');

select lives_ok(
  $$ update identidad.tenants set actividad_economica = '492300'
      where id = 'eeeeeeee-0000-0000-0000-000000000001' $$,
  'un Acteco de 6 dígitos se acepta');

select throws_ok(
  $$ update identidad.tenants set actividad_economica = '4923'
      where id = 'eeeeeeee-0000-0000-0000-000000000001' $$,
  '23514', null,
  'un Acteco de menos de 6 dígitos se rechaza');

select lives_ok(
  $$ update identidad.tenants set telefono_contacto = '+56912345678'
      where id = 'eeeeeeee-0000-0000-0000-000000000001' $$,
  'un teléfono en E.164 se acepta');

select throws_ok(
  $$ update identidad.tenants set telefono_contacto = '912345678'
      where id = 'eeeeeeee-0000-0000-0000-000000000001' $$,
  '23514', null,
  'un teléfono sin prefijo internacional se rechaza — la app lo normaliza antes');

select lives_ok(
  $$ update identidad.tenants set telefono_contacto = null, email_contacto = null
      where id = 'eeeeeeee-0000-0000-0000-000000000001' $$,
  'NULL sigue siendo válido: un courier sin contacto cargado es un estado legítimo');

-- -----------------------------------------------------------------------------
-- 4 · courier_datos_cobro: forma y aislamiento
-- -----------------------------------------------------------------------------
select has_table('identidad', 'courier_datos_cobro', 'existe identidad.courier_datos_cobro');

select throws_ok(
  $$ insert into identidad.courier_datos_cobro
       (tenant_id, banco, tipo_cuenta, numero_cuenta, rut_titular, nombre_titular)
     values ('eeeeeeee-0000-0000-0000-000000000001', 'BCI', 'corriente', '123', '77100001', 'X') $$,
  '23514', null,
  'un RUT de titular sin dígito verificador se rechaza');

insert into identidad.courier_datos_cobro
  (tenant_id, banco, tipo_cuenta, numero_cuenta, rut_titular, nombre_titular)
values ('eeeeeeee-0000-0000-0000-000000000001', 'BCI', 'corriente', '00012345678',
        '77100001-8', 'Courier Datos SpA');

-- 🔴 El seller del MISMO tenant SÍ la lee: es la razón de que esta tabla exista
-- aparte de `tenants` en vez de dentro.
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a1","tenant_id":"eeeeeeee-0000-0000-0000-000000000001","tipo_usuario":"seller","seller_id":"eeeeeeee-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(
  (select count(*)::int from public.courier_datos_cobro),
  1,
  'el seller del mismo tenant VE la cuenta: es a donde tiene que transferir');

-- Contraprueba: otro tenant no ve nada. Sin esto, la aserción de arriba también
-- pasaría con una política que dejara ver todo.
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a2","tenant_id":"eeeeeeee-0000-0000-0000-0000000000ff","tipo_usuario":"seller","seller_id":"eeeeeeee-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is(
  (select count(*)::int from public.courier_datos_cobro),
  0,
  'un seller de OTRO courier no ve la cuenta bancaria');

-- El conductor no tiene nada que hacer acá.
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-0000000000a3","tenant_id":"eeeeeeee-0000-0000-0000-000000000001","tipo_usuario":"conductor","role":"authenticated"}';
select is(
  (select count(*)::int from public.courier_datos_cobro),
  0,
  'el conductor NO ve la cuenta bancaria del courier');

reset role;

select * from finish();
rollback;
