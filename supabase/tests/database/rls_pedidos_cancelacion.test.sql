-- =============================================================================
-- Pruebas de aislamiento RLS — columnas de cancelación en operacion.pedidos
-- =============================================================================
-- Migración bajo prueba: 20260811000003_operacion_pedidos_cancelacion.sql
-- Diseño: docs/arquitectura/edicion-y-cancelacion-de-pedidos.md §4, §6.2, §9.
--
-- ESTAS SON PRUEBAS DE QUE **NADA SE ABRIÓ**, no de que algo nuevo funcione.
-- La migración agrega tres columnas a la tabla más leída del sistema —una que
-- el seller y el conductor SÍ consultan— sin tocar una sola política. Lo que hay
-- que demostrar es que después de agregarlas el aislamiento sigue exactamente
-- igual de cerrado, y que la única visibilidad nueva (motivo_cancelacion para el
-- seller dueño) es la que se decidió a propósito en §6.2.
--
-- Cubre:
--   0. Contrato de esquema: las 3 columnas, sus tipos, su nulabilidad, la FK a
--      auth.users y que la vista public.pedidos se re-emitió (si no, PostgREST
--      seguiría sirviendo la lista de columnas vieja).
--   1. El GOTCHA del repo, medido y no supuesto: el GRANT sobre pedidos es de
--      TABLA COMPLETA, así que cubre las columnas nuevas. Se afirma como HECHO
--      (no se finge lo contrario) y se prueba que la barrera real es la RLS de
--      fila, no el grant.
--   2. §4.1: NO existe ninguna política de UPDATE para el seller, y las dos
--      barreras de las que depende el diseño (pedidos_select y el guard
--      trg_pedidos_solo_interno_edita) siguen en pie.
--   3. Cruce de TENANT: el interno del tenant B no lee ni escribe una fila del
--      tenant A. Con fixtures NO VACÍOS en ambos lados — si el tenant B no
--      tuviera datos propios, la prueba pasaría por ausencia y no probaría nada.
--   4. Cruce de SELLER dentro del mismo tenant, y el seller frente a los datos
--      internos del courier (manifiestos).
--   5. Cruce de CONDUCTOR: solo ve lo asignado a él.
--
-- Mecanismo: idéntico al resto de la suite — se simula el JWT fijando
-- `request.jwt.claims` y conmutando a rol `authenticated` con `set local role`.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(37);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada (redefinidos aquí porque cada .test.sql corre en su
-- propia transacción y hace rollback).
-- -----------------------------------------------------------------------------
create or replace function test_iniciar_sesion(
  p_user_id      uuid,
  p_tenant_id    uuid,
  p_tipo_usuario text,
  p_rol          text,
  p_seller_id    uuid default null,
  p_driver_id    uuid default null
) returns void
language plpgsql
as $$
begin
  set local role authenticated;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_user_id,
      'role', 'authenticated',
      'tenant_id', p_tenant_id,
      'tipo_usuario', p_tipo_usuario,
      'seller_id', p_seller_id,
      'driver_id', p_driver_id,
      'rol', p_rol
    )::text,
    true
  );
end;
$$;

create or replace function test_cerrar_sesion() returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
end;
$$;

-- Ejecuta un DML y devuelve cuántas filas tocó. SECURITY INVOKER (el default):
-- corre con el rol vigente, así que la RLS del usuario simulado sí aplica.
-- Hace falta porque "0 filas" y "42501" son resultados DISTINTOS y esta suite
-- tiene que poder distinguirlos: el interno de otro tenant pasa el guard (es
-- interno) y lo detiene la RLS de fila → UPDATE 0, no excepción.
create or replace function test_filas_afectadas(p_sql text) returns int
language plpgsql
as $$
declare
  v_filas int;
begin
  execute p_sql;
  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

-- =============================================================================
-- Fixtures — DOS tenants, ambos CON DATOS PROPIOS
--
-- Tenant A (cccccccc…):
--   · sellers  S_A1 y S_A2  → probar el cruce seller↔seller dentro del tenant
--   · conductores D_A1 y D_A2 → probar el cruce conductor↔conductor
--   · manifiesto M_A1 (dato interno del courier: el seller no debe verlo)
--   · pedidos: P_A1 (S_A1, CANCELADO, asignado a D_A1, con las 3 columnas
--              pobladas), P_A2 (S_A1, vivo, sin conductor), P_A3 (S_A2, CANCELADO
--              con motivo propio → el seller A1 no debe leerlo)
--
-- Tenant B (dddddddd…):
--   · seller S_B1, conductor D_B1, pedido P_B1 CANCELADO con su propio motivo.
--     Esto es lo que hace que el cruce de tenant pruebe algo: si el tenant B
--     estuviera vacío, "el interno de B no ve nada de A" sería trivialmente
--     cierto y no distinguiría aislamiento de ausencia de datos.
--
-- Se insertan como `postgres` (bypassa RLS), igual que el resto de la suite.
-- UUIDs con prefijo propio (cccccccc/dddddddd) para no chocar con los fixtures
-- de los otros archivos ni con el seed de demo.
-- =============================================================================
do $$
declare
  t_a uuid := 'cccccccc-0000-0000-0000-000000000001';
  t_b uuid := 'dddddddd-0000-0000-0000-000000000001';

  s_a1 uuid := 'cccccccc-1111-0000-0000-000000000001';
  s_a2 uuid := 'cccccccc-1111-0000-0000-000000000002';
  s_b1 uuid := 'dddddddd-1111-0000-0000-000000000001';

  d_a1 uuid := 'cccccccc-2222-0000-0000-000000000001';
  d_a2 uuid := 'cccccccc-2222-0000-0000-000000000002';
  d_b1 uuid := 'dddddddd-2222-0000-0000-000000000001';

  u_interno_a   uuid := 'cccccccc-3333-0000-0000-000000000001';
  u_seller_a1   uuid := 'cccccccc-3333-0000-0000-000000000002';
  u_seller_a2   uuid := 'cccccccc-3333-0000-0000-000000000003';
  u_conductor_a1 uuid := 'cccccccc-3333-0000-0000-000000000004';
  u_conductor_a2 uuid := 'cccccccc-3333-0000-0000-000000000005';
  u_interno_b   uuid := 'dddddddd-3333-0000-0000-000000000001';
  u_seller_b1   uuid := 'dddddddd-3333-0000-0000-000000000002';
  u_conductor_b1 uuid := 'dddddddd-3333-0000-0000-000000000003';

  m_a1 uuid := 'cccccccc-5555-0000-0000-000000000001';

  p_a1 uuid := 'cccccccc-6666-0000-0000-000000000001';
  p_a2 uuid := 'cccccccc-6666-0000-0000-000000000002';
  p_a3 uuid := 'cccccccc-6666-0000-0000-000000000003';
  p_b1 uuid := 'dddddddd-6666-0000-0000-000000000001';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier Cancel A', 'Courier Cancel A SpA', '76909091-1', 'activo'),
    (t_b, 'Courier Cancel B', 'Courier Cancel B SpA', '76909092-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          created_at, updated_at, raw_app_meta_data,
                          raw_user_meta_data, aud, role)
  values
    (u_interno_a,    'interno.a@cancelacion.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a1,    'seller.a1@cancelacion.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a2,    'seller.a2@cancelacion.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a1, 'conductor.a1@cancelacion.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a2, 'conductor.a2@cancelacion.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_interno_b,    'interno.b@cancelacion.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_b1,    'seller.b1@cancelacion.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_b1, 'conductor.b1@cancelacion.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a1, t_a, 'Seller Cancel A1', '77909091-1', 'Contacto A1', 'a1@seller.cancelacion.test', 'activo'),
    (s_a2, t_a, 'Seller Cancel A2', '77909092-2', 'Contacto A2', 'a2@seller.cancelacion.test', 'activo'),
    (s_b1, t_b, 'Seller Cancel B1', '77909093-3', 'Contacto B1', 'b1@seller.cancelacion.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values
    (d_a1, t_a, 'Conductor Cancel A1', '78909091-1', 'dependiente',   'activo'),
    (d_a2, t_a, 'Conductor Cancel A2', '78909092-2', 'independiente', 'activo'),
    (d_b1, t_b, 'Conductor Cancel B1', '78909093-3', 'dependiente',   'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a,    t_a, 'Interno Cancel A',    'interno',   null, null, 'dueno',     'activo'),
    (u_seller_a1,    t_a, 'Usuario Seller A1',   'seller',    s_a1, null, 'seller',    'activo'),
    (u_seller_a2,    t_a, 'Usuario Seller A2',   'seller',    s_a2, null, 'seller',    'activo'),
    (u_conductor_a1, t_a, 'Usuario Conductor A1','conductor', null, d_a1, 'conductor', 'activo'),
    (u_conductor_a2, t_a, 'Usuario Conductor A2','conductor', null, d_a2, 'conductor', 'activo'),
    (u_interno_b,    t_b, 'Interno Cancel B',    'interno',   null, null, 'dueno',     'activo'),
    (u_seller_b1,    t_b, 'Usuario Seller B1',   'seller',    s_b1, null, 'seller',    'activo'),
    (u_conductor_b1, t_b, 'Usuario Conductor B1','conductor', null, d_b1, 'conductor', 'activo')
  on conflict (id) do nothing;

  -- Dato interno del courier A: el seller NO debe verlo (manifiestos no tiene P2).
  insert into operacion.manifiestos (id, tenant_id, driver_id, nombre, fecha_operacion, estado)
  values (m_a1, t_a, d_a1, 'Ruta Cancel A1', '2026-08-11', 'confirmado')
  on conflict (id) do nothing;

  -- Pedidos. driver_id_asignado se escribe directo (la columna es denormalizada;
  -- el trigger que la sincroniza vive en asignaciones_pedido y aquí no hace falta).
  insert into operacion.pedidos (
    id, tenant_id, seller_id, tipo_pedido, origen, ml_shipment_id, estado,
    driver_id_asignado, destinatario_nombre, destinatario_direccion,
    destinatario_comuna, cancelado_en, cancelado_por_usuario_id, motivo_cancelacion)
  values
    (p_a1, t_a, s_a1, 'same_day', 'same_day_manual', null, 'cancelado',
     d_a1, 'Destinatario A1', 'Calle Cancel A 1', 'Santiago',
     now(), u_interno_a, 'MOTIVO-A1: el seller pidio anular, direccion duplicada'),
    (p_a2, t_a, s_a1, 'same_day', 'same_day_manual', null, 'pendiente_asignacion',
     null, 'Destinatario A2', 'Calle Cancel A 2', 'Providencia',
     null, null, null),
    (p_a3, t_a, s_a2, 'same_day', 'same_day_manual', null, 'cancelado',
     null, 'Destinatario A3', 'Calle Cancel A 3', 'Las Condes',
     now(), u_interno_a, 'MOTIVO-A3: secreto del seller A2, el seller A1 no debe leerlo'),
    (p_b1, t_b, s_b1, 'same_day', 'same_day_manual', null, 'cancelado',
     d_b1, 'Destinatario B1', 'Calle Cancel B 1', 'Vitacura',
     now(), u_interno_b, 'MOTIVO-B1: secreto del courier B, el courier A no debe leerlo')
  on conflict (id) do nothing;
end $$;

-- =============================================================================
-- BLOQUE 0 · Contrato de esquema (9 tests)
--   Sin la migración aplicada, los 9 fallan (y de hecho el archivo ni siquiera
--   llega hasta aquí: los fixtures revientan al insertar columnas inexistentes).
-- =============================================================================

select has_column('operacion', 'pedidos', 'cancelado_en',
  'esquema: operacion.pedidos.cancelado_en existe');

select col_type_is('operacion', 'pedidos', 'cancelado_en', 'timestamp with time zone',
  'esquema: cancelado_en es timestamptz (momento del acto, no fecha suelta)');

select has_column('operacion', 'pedidos', 'cancelado_por_usuario_id',
  'esquema: operacion.pedidos.cancelado_por_usuario_id existe');

select col_type_is('operacion', 'pedidos', 'cancelado_por_usuario_id', 'uuid',
  'esquema: cancelado_por_usuario_id es uuid (el "quien" de RNF-04)');

select has_column('operacion', 'pedidos', 'motivo_cancelacion',
  'esquema: operacion.pedidos.motivo_cancelacion existe');

select col_type_is('operacion', 'pedidos', 'motivo_cancelacion', 'text',
  'esquema: motivo_cancelacion es text libre (el minimo de 10 caracteres lo impone backend)');

-- La FK es la que impide que quede un autor fantasma apuntando a un usuario
-- inexistente. Sin cláusula ON DELETE, igual que el resto de columnas de autoría
-- del esquema operacion (manifiestos.creado_por_usuario_id, incidencias.*).
select results_eq(
  $$ select count(*)::int from pg_constraint
      where conrelid = 'operacion.pedidos'::regclass
        and contype = 'f'
        and pg_get_constraintdef(oid)
            = 'FOREIGN KEY (cancelado_por_usuario_id) REFERENCES auth.users(id)' $$,
  $$ values (1) $$,
  'esquema: cancelado_por_usuario_id tiene FK a auth.users(id)'
);

-- Nullable las tres: un pedido vivo no está cancelado, y la cancelación que
-- llega por sincronización de ML no tiene autor humano ni motivo redactado.
select results_eq(
  $$ select count(*)::int from information_schema.columns
      where table_schema = 'operacion' and table_name = 'pedidos'
        and column_name in ('cancelado_en', 'cancelado_por_usuario_id', 'motivo_cancelacion')
        and is_nullable = 'YES' $$,
  $$ values (3) $$,
  'esquema: las 3 columnas son NULLABLE (todo pedido vivo las tiene en null)'
);

-- La vista NO se actualiza sola al cambiar la tabla base: si la migración se
-- olvidara del `create or replace view`, PostgREST seguiría sirviendo la lista
-- de columnas congelada y el portal nunca vería el motivo.
select results_eq(
  $$ select count(*)::int from information_schema.columns
      where table_schema = 'public' and table_name = 'pedidos'
        and column_name in ('cancelado_en', 'cancelado_por_usuario_id', 'motivo_cancelacion') $$,
  $$ values (3) $$,
  'esquema: la vista public.pedidos se re-emitio y expone las 3 columnas nuevas'
);

-- =============================================================================
-- BLOQUE 1 · El GRANT de tabla completa, medido (4 tests)
--
--   El patrón que ya mordió dos veces en este repo (snapshot_regla, token de
--   invitación) es: `grant select on tabla` cubre TODA columna nueva, y la vista
--   public.* NO es barrera porque config.toml expone `operacion` directamente
--   por PostgREST (Accept-Profile: operacion).
--
--   Aquí se afirma el hecho en vez de disimularlo: sí, `authenticated` puede
--   leer y escribir las tres columnas a nivel de privilegio. Y NO es una fuga,
--   porque public.pedidos es `select *` — no hay nada que la vista oculte y el
--   grant delate. La barrera de confidencialidad es la RLS de FILA (P1+P2+P3),
--   que los bloques 3–5 prueban, y la de escritura son la política
--   pedidos_update_interno + el guard 42501.
-- =============================================================================

select is(
  has_column_privilege('authenticated', 'operacion.pedidos', 'motivo_cancelacion', 'SELECT'),
  true,
  'GRANT (hecho declarado): authenticated SI tiene SELECT sobre operacion.pedidos.motivo_cancelacion — el grant es de tabla completa y cubre las columnas nuevas'
);

select is(
  (select bool_and(has_column_privilege('authenticated', 'public.pedidos', col, 'SELECT'))
     from unnest(array['cancelado_en', 'cancelado_por_usuario_id', 'motivo_cancelacion']) as col),
  true,
  'GRANT (hecho declarado): authenticated SI tiene SELECT sobre las 3 columnas en la vista public.pedidos'
);

select is(
  has_column_privilege('authenticated', 'operacion.pedidos', 'motivo_cancelacion', 'UPDATE'),
  true,
  'GRANT (hecho declarado): authenticated SI tiene UPDATE sobre motivo_cancelacion — el privilegio NO es la barrera; lo son pedidos_update_interno y el guard 42501 (bloques 4 y 5)'
);

select is(
  (select bool_or(has_column_privilege('anon', 'public.pedidos', col, 'SELECT'))
     from unnest(array['cancelado_en', 'cancelado_por_usuario_id', 'motivo_cancelacion']) as col),
  false,
  'GRANT: anon (sesion NO autenticada) no tiene SELECT sobre ninguna de las 3 columnas'
);

-- =============================================================================
-- BLOQUE 2 · §4.1 — no se agrego ninguna politica, y las barreras siguen (3 tests)
-- =============================================================================

-- La tentación rechazada en §4.1: `pedidos_update_seller_propio`. Si alguien la
-- agrega, este test falla y el documento §4.1 es la razón por la que no debe ir:
-- con GRANT de tabla completa, esa política le abriría al seller escritura sobre
-- `estado`, `monto_cobro_clp`, `cobro_generado` y `tarifa_aplicable_id`, y un
-- `with check` no puede comparar OLD vs NEW para impedirlo.
select is_empty(
  $$ select policyname from pg_policies
      where schemaname = 'operacion' and tablename = 'pedidos'
        and cmd = 'UPDATE' and policyname <> 'pedidos_update_interno' $$,
  'RLS §4.1: pedidos_update_interno sigue siendo la UNICA politica de UPDATE (no se creo pedidos_update_seller_propio)'
);

select isnt_empty(
  $$ select 1 from pg_policies
      where schemaname = 'operacion' and tablename = 'pedidos'
        and policyname = 'pedidos_select' $$,
  'RLS: pedidos_select (P1 tenant + P2 seller + P3 conductor) sigue existiendo — es la politica que impone el aislamiento de estas columnas'
);

select isnt_empty(
  $$ select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'operacion' and c.relname = 'pedidos'
       and t.tgname = 'trg_pedidos_solo_interno_edita'
       and not t.tgisinternal $$,
  'GUARD: trg_pedidos_solo_interno_edita sigue en pie (convierte el UPDATE 0 silencioso de un seller en 42501 explicito)'
);

-- =============================================================================
-- BLOQUE 3 · Cruce de TENANT — con datos reales en ambos lados (6 tests)
-- =============================================================================

select test_iniciar_sesion(
  'cccccccc-3333-0000-0000-000000000001'::uuid, -- u_interno_a
  'cccccccc-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

select isnt_empty(
  $$ select 1 from public.pedidos
      where id = 'cccccccc-6666-0000-0000-000000000001'
        and motivo_cancelacion like 'MOTIVO-A1%' $$,
  'CONTROL: el interno del tenant A SI lee el motivo_cancelacion de su propio pedido (el fixture no esta vacio)'
);

select is_empty(
  $$ select 1 from public.pedidos
      where tenant_id = 'dddddddd-0000-0000-0000-000000000001' $$,
  'TENANT: el interno del tenant A NO ve ningun pedido del tenant B'
);

select test_iniciar_sesion(
  'dddddddd-3333-0000-0000-000000000001'::uuid, -- u_interno_b
  'dddddddd-0000-0000-0000-000000000001'::uuid, -- t_b
  'interno', 'dueno'
);

select isnt_empty(
  $$ select 1 from public.pedidos
      where id = 'dddddddd-6666-0000-0000-000000000001'
        and motivo_cancelacion like 'MOTIVO-B1%' $$,
  'CONTROL: el interno del tenant B SI lee su propio pedido cancelado (el cruce de tenant no pasa por ausencia de datos)'
);

select is_empty(
  $$ select motivo_cancelacion from public.pedidos
      where id = 'cccccccc-6666-0000-0000-000000000001' $$,
  'TENANT: el interno del tenant B NO lee el motivo_cancelacion de un pedido del tenant A ⇒ 0 filas'
);

-- Escritura cruzada: el interno de B PASA el guard (es interno) y lo detiene la
-- RLS de fila → UPDATE 0, sin excepción. Por eso se cuenta la fila afectada en
-- vez de esperar un 42501: son dos mecanismos distintos y ambos deben funcionar.
select is(
  test_filas_afectadas(
    $$ update public.pedidos
          set motivo_cancelacion = 'INTRUSION DEL TENANT B'
        where id = 'cccccccc-6666-0000-0000-000000000001' $$
  ),
  0,
  'TENANT: el UPDATE del interno del tenant B sobre un pedido del tenant A afecta 0 filas'
);

select test_cerrar_sesion();

select results_eq(
  $$ select motivo_cancelacion from operacion.pedidos
      where id = 'cccccccc-6666-0000-0000-000000000001' $$,
  $$ values ('MOTIVO-A1: el seller pidio anular, direccion duplicada') $$,
  'TENANT: verificado como postgres, el motivo del pedido del tenant A quedo intacto tras el intento del tenant B'
);

-- =============================================================================
-- BLOQUE 4 · Cruce de SELLER dentro del mismo tenant (8 tests)
-- =============================================================================

select test_iniciar_sesion(
  'cccccccc-3333-0000-0000-000000000002'::uuid, -- u_seller_a1
  'cccccccc-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'cccccccc-1111-0000-0000-000000000001'::uuid -- s_a1
);

-- §6.2: decisión CONSCIENTE de transparencia. El motivo lo escribe un interno
-- del courier y lo lee el seller dueño del pedido. Se prueba explícitamente para
-- que quede documentado en la suite, no como efecto colateral de `select *`.
select results_eq(
  $$ select motivo_cancelacion from public.pedidos
      where id = 'cccccccc-6666-0000-0000-000000000001' $$,
  $$ values ('MOTIVO-A1: el seller pidio anular, direccion duplicada') $$,
  '§6.2: el seller dueno SI lee motivo_cancelacion de SU pedido (transparencia decidida a proposito)'
);

select is_empty(
  $$ select motivo_cancelacion from public.pedidos
      where id = 'cccccccc-6666-0000-0000-000000000003' $$, -- p_a3, del seller A2
  'SELLER: el seller A1 NO lee el motivo_cancelacion del pedido de otro seller del MISMO tenant ⇒ 0 filas'
);

select results_eq(
  $$ select count(*)::int from public.pedidos $$,
  $$ values (2) $$,
  'SELLER: el seller A1 ve exactamente sus 2 pedidos (P2 filtra por seller_id, no por tenant)'
);

-- El mismo cruce contra la TABLA BASE, no contra la vista: es el camino que
-- abriría `Accept-Profile: operacion` en PostgREST. La RLS de fila lo cierra
-- igual, que es justo lo que el grant de tabla completa NO garantiza por sí solo.
select is_empty(
  $$ select motivo_cancelacion from operacion.pedidos
      where id = 'cccccccc-6666-0000-0000-000000000003' $$,
  'SELLER: tampoco lo lee golpeando la TABLA BASE operacion.pedidos (el bypass de la vista via Accept-Profile no sirve: manda la RLS de fila)'
);

select is_empty(
  $$ select 1 from public.pedidos
      where tenant_id = 'dddddddd-0000-0000-0000-000000000001' $$,
  'SELLER: el seller del tenant A NO ve ningun pedido del tenant B'
);

-- "Ni datos internos del courier": manifiestos no tiene política P2.
select is_empty(
  $$ select 1 from public.manifiestos $$,
  'SELLER: el seller no ve NINGUN manifiesto — dato interno del courier, sin politica para el'
);

-- Escritura: el seller no llega ni a la RLS. El guard por sentencia lo corta
-- antes, con 42501 explícito y auditable. Esta es la barrera que §4.1 decide
-- CONSERVAR intacta en vez de darle una política de UPDATE.
select throws_ok(
  $$ update public.pedidos
        set motivo_cancelacion = 'me cancelo yo mismo'
      where id = 'cccccccc-6666-0000-0000-000000000001' $$,
  '42501',
  null,
  'SELLER: el UPDATE de motivo_cancelacion sobre SU PROPIO pedido recibe 42501 (no hay escritura del seller, ni siquiera en la columna nueva)'
);

select throws_ok(
  $$ update public.pedidos
        set estado = 'cancelado', cancelado_en = now()
      where id = 'cccccccc-6666-0000-0000-000000000002' $$,
  '42501',
  null,
  'SELLER: el atajo tentador —mover el estado a cancelado por PostgREST— tambien recibe 42501; la cancelacion pasa por service_role o no pasa'
);

-- =============================================================================
-- BLOQUE 5 · Cruce de CONDUCTOR (5 tests)
-- =============================================================================

select test_iniciar_sesion(
  'cccccccc-3333-0000-0000-000000000004'::uuid, -- u_conductor_a1
  'cccccccc-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'cccccccc-2222-0000-0000-000000000001'::uuid -- d_a1
);

select isnt_empty(
  $$ select 1 from public.pedidos
      where id = 'cccccccc-6666-0000-0000-000000000001' $$,
  'CONTROL: el conductor A1 SI ve el pedido asignado a el (P3 por driver_id_asignado)'
);

select results_eq(
  $$ select count(*)::int from public.pedidos $$,
  $$ values (1) $$,
  'CONDUCTOR: el conductor A1 ve UN solo pedido — los otros dos del mismo tenant no le estan asignados'
);

select is_empty(
  $$ select motivo_cancelacion from public.pedidos
      where id = 'cccccccc-6666-0000-0000-000000000003' $$, -- p_a3, de otro seller, sin conductor
  'CONDUCTOR: el conductor A1 NO lee el motivo_cancelacion de un pedido que no tiene asignado ⇒ 0 filas'
);

select throws_ok(
  $$ update public.pedidos
        set motivo_cancelacion = 'lo cancelo yo, el conductor'
      where id = 'cccccccc-6666-0000-0000-000000000001' $$,
  '42501',
  null,
  'CONDUCTOR: el UPDATE de motivo_cancelacion sobre el pedido que SI tiene asignado recibe 42501'
);

select test_iniciar_sesion(
  'cccccccc-3333-0000-0000-000000000005'::uuid, -- u_conductor_a2
  'cccccccc-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'cccccccc-2222-0000-0000-000000000002'::uuid -- d_a2
);

select is_empty(
  $$ select 1 from public.pedidos
      where id = 'cccccccc-6666-0000-0000-000000000001' $$,
  'CONDUCTOR: el conductor A2 NO ve el pedido asignado al conductor A1 (mismo tenant, otro driver_id)'
);

-- =============================================================================
-- BLOQUE 6 · Control positivo de fixtures (2 tests)
--   Cierra la puerta al falso verde: todo lo anterior seria trivialmente cierto
--   si las tablas estuvieran vacias.
-- =============================================================================

select test_cerrar_sesion();

select results_eq(
  $$ select count(*)::int from operacion.pedidos
      where tenant_id in ('cccccccc-0000-0000-0000-000000000001',
                          'dddddddd-0000-0000-0000-000000000001') $$,
  $$ values (4) $$,
  'control positivo: como postgres existen los 4 pedidos de fixture (3 del tenant A + 1 del tenant B)'
);

select results_eq(
  $$ select count(*)::int from operacion.pedidos
      where tenant_id in ('cccccccc-0000-0000-0000-000000000001',
                          'dddddddd-0000-0000-0000-000000000001')
        and motivo_cancelacion is not null $$,
  $$ values (3) $$,
  'control positivo: 3 de esos 4 pedidos tienen motivo_cancelacion poblado (uno por cada alcance que se prueba)'
);

select * from finish();

rollback;
