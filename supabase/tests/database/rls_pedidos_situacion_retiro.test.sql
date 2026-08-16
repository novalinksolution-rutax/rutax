-- =============================================================================
-- Pruebas de aislamiento RLS — situacion_retiro / retirado_en en operacion.pedidos
-- =============================================================================
-- Migración bajo prueba: 20260812000002_operacion_pedido_situacion_retiro.sql
-- Diseño: docs/arquitectura/retiro-y-ruteo.md §2.1, §13bis-1.1, §13bis-1.3.
--
-- QUÉ SE DEMUESTRA, y por qué importa que sea contra una base Postgres real y no
-- contra mocks de aplicación: `situacion_retiro` es una REJA DE DINERO. Si un
-- tenant leyera o escribiera el campo de otro, o si un seller pudiera marcarse a
-- sí mismo "ya retirado", la consecuencia no es un dato feo en pantalla: es un
-- cobro con tarifa, período y DTE por entregas que hizo otro courier.
--
-- Cubre:
--   0. Contrato de esquema: el tipo con sus 3 valores en orden, las dos columnas,
--      el default `pendiente` de las filas nuevas, el CHECK de coherencia, el
--      índice parcial y que la vista public.pedidos se re-emitió (si no,
--      PostgREST seguiría sirviendo la lista de columnas vieja).
--   1. Comportamiento del default y del CHECK, ejercitado de verdad.
--   2. El GRANT de tabla completa, MEDIDO y no supuesto: sí cubre las columnas
--      nuevas. Se afirma el hecho y se prueba que la barrera real es la RLS de
--      fila, no el privilegio.
--   3. Cruce de TENANT, con fixtures NO VACÍOS en ambos lados — si el tenant B
--      estuviera vacío, "A no ve nada de B" pasaría por ausencia y no probaría
--      aislamiento.
--   4. Cruce de SELLER dentro del mismo tenant + el seller frente a datos
--      internos del courier + el seller intentando ESCRIBIR la reja.
--   5. Cruce de CONDUCTOR, incluido el cero deliberado de §13bis-1.1: en el
--      retiro todavía no hay asignación, así que la política P3 no le muestra el
--      bulto que va a escanear. Ese cero es el que obliga a resolver el código
--      por endpoint Bearer con service_role y DTO mínimo, en vez de ampliar la
--      política del conductor (lo que expondría nombre, dirección y teléfono de
--      los ~400 destinatarios del día a cada conductor).
--   6. Control positivo de fixtures: cierra la puerta al falso verde.
--
-- Mecanismo: idéntico al resto de la suite — se simula el JWT fijando
-- `request.jwt.claims` y conmutando a rol `authenticated` con `set local role`.
-- Los fixtures se insertan como `postgres` (bypassa RLS).
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(35);

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
-- Hace falta porque "0 filas" y "42501" son resultados DISTINTOS: el interno de
-- otro tenant PASA el guard (es interno) y lo detiene la RLS de fila → UPDATE 0,
-- sin excepción. El seller ni siquiera llega ahí: lo corta el guard con 42501.
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
-- Tenant A (eeeeeeee…) — el courier que sí opera:
--   · sellers S_A1 y S_A2      → cruce seller↔seller dentro del mismo tenant
--   · conductores D_A1 y D_A2  → cruce conductor↔conductor
--   · manifiesto M_A1          → dato interno del courier (el seller no lo ve)
--   · pedidos:
--       P_A1 (S_A1, RETIRADO con fecha, asignado a D_A1)
--       P_A2 (S_A1, RETIRADO con fecha, SIN conductor) ← el caso del retiro:
--             está en poder del courier y todavía no se asigna a nadie
--       P_A3 (S_A2, PENDIENTE, sin conductor)          ← candidato de otro courier
--       P_A4 (S_A2, NO_PROCESADO)                      ← nunca se retiró
--
-- Tenant B (ffffffff…):
--   · seller S_B1, conductor D_B1, pedido P_B1 RETIRADO con su propia fecha.
--
-- UUIDs con prefijo propio (eeeeeeee/ffffffff) para no chocar con los fixtures de
-- los otros archivos de la suite ni con el seed de demo.
-- =============================================================================
do $$
declare
  t_a uuid := 'eeeeeeee-0000-0000-0000-000000000001';
  t_b uuid := 'ffffffff-0000-0000-0000-000000000001';

  s_a1 uuid := 'eeeeeeee-1111-0000-0000-000000000001';
  s_a2 uuid := 'eeeeeeee-1111-0000-0000-000000000002';
  s_b1 uuid := 'ffffffff-1111-0000-0000-000000000001';

  d_a1 uuid := 'eeeeeeee-2222-0000-0000-000000000001';
  d_a2 uuid := 'eeeeeeee-2222-0000-0000-000000000002';
  d_b1 uuid := 'ffffffff-2222-0000-0000-000000000001';

  u_interno_a    uuid := 'eeeeeeee-3333-0000-0000-000000000001';
  u_seller_a1    uuid := 'eeeeeeee-3333-0000-0000-000000000002';
  u_seller_a2    uuid := 'eeeeeeee-3333-0000-0000-000000000003';
  u_conductor_a1 uuid := 'eeeeeeee-3333-0000-0000-000000000004';
  u_conductor_a2 uuid := 'eeeeeeee-3333-0000-0000-000000000005';
  u_interno_b    uuid := 'ffffffff-3333-0000-0000-000000000001';
  u_seller_b1    uuid := 'ffffffff-3333-0000-0000-000000000002';

  m_a1 uuid := 'eeeeeeee-5555-0000-0000-000000000001';

  p_a1 uuid := 'eeeeeeee-6666-0000-0000-000000000001';
  p_a2 uuid := 'eeeeeeee-6666-0000-0000-000000000002';
  p_a3 uuid := 'eeeeeeee-6666-0000-0000-000000000003';
  p_a4 uuid := 'eeeeeeee-6666-0000-0000-000000000004';
  p_b1 uuid := 'ffffffff-6666-0000-0000-000000000001';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier Retiro A', 'Courier Retiro A SpA', '76808081-1', 'activo'),
    (t_b, 'Courier Retiro B', 'Courier Retiro B SpA', '76808082-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          created_at, updated_at, raw_app_meta_data,
                          raw_user_meta_data, aud, role)
  values
    (u_interno_a,    'interno.a@retiro.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a1,    'seller.a1@retiro.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a2,    'seller.a2@retiro.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a1, 'conductor.a1@retiro.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a2, 'conductor.a2@retiro.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_interno_b,    'interno.b@retiro.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_b1,    'seller.b1@retiro.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a1, t_a, 'Seller Retiro A1', '77808081-1', 'Contacto A1', 'a1@seller.retiro.test', 'activo'),
    (s_a2, t_a, 'Seller Retiro A2', '77808082-2', 'Contacto A2', 'a2@seller.retiro.test', 'activo'),
    (s_b1, t_b, 'Seller Retiro B1', '77808083-3', 'Contacto B1', 'b1@seller.retiro.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values
    (d_a1, t_a, 'Conductor Retiro A1', '78808081-1', 'dependiente',   'activo'),
    (d_a2, t_a, 'Conductor Retiro A2', '78808082-2', 'independiente', 'activo'),
    (d_b1, t_b, 'Conductor Retiro B1', '78808083-3', 'dependiente',   'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a,    t_a, 'Interno Retiro A',     'interno',   null, null, 'dueno',     'activo'),
    (u_seller_a1,    t_a, 'Usuario Seller A1',    'seller',    s_a1, null, 'seller',    'activo'),
    (u_seller_a2,    t_a, 'Usuario Seller A2',    'seller',    s_a2, null, 'seller',    'activo'),
    (u_conductor_a1, t_a, 'Usuario Conductor A1', 'conductor', null, d_a1, 'conductor', 'activo'),
    (u_conductor_a2, t_a, 'Usuario Conductor A2', 'conductor', null, d_a2, 'conductor', 'activo'),
    (u_interno_b,    t_b, 'Interno Retiro B',     'interno',   null, null, 'dueno',     'activo'),
    (u_seller_b1,    t_b, 'Usuario Seller B1',    'seller',    s_b1, null, 'seller',    'activo')
  on conflict (id) do nothing;

  -- Dato interno del courier A: el seller NO debe verlo (manifiestos no tiene P2).
  insert into operacion.manifiestos (id, tenant_id, driver_id, nombre, fecha_operacion, estado)
  values (m_a1, t_a, d_a1, 'Ruta Retiro A1', '2026-08-12', 'confirmado')
  on conflict (id) do nothing;

  -- Pedidos. driver_id_asignado se escribe directo (es denormalizada; el trigger
  -- que la sincroniza vive en asignaciones_pedido y aquí no hace falta).
  insert into operacion.pedidos (
    id, tenant_id, seller_id, tipo_pedido, fuente, origen, ml_shipment_id, estado,
    driver_id_asignado, destinatario_nombre, destinatario_direccion,
    destinatario_comuna, situacion_retiro, retirado_en)
  values
    (p_a1, t_a, s_a1, 'flex', 'ml_flex', 'backfill', 'SHIP-RET-A1', 'en_ruta',
     d_a1, 'Destinatario A1', 'Calle Retiro A 1', 'Santiago',
     'retirado', timestamptz '2026-08-12 11:00:00-04'),
    -- El caso vivo del retiro: en poder del courier y sin asignar todavía.
    (p_a2, t_a, s_a1, 'flex', 'ml_flex', 'backfill', 'SHIP-RET-A2', 'pendiente_asignacion',
     null, 'Destinatario A2', 'Calle Retiro A 2', 'Providencia',
     'retirado', timestamptz '2026-08-12 12:30:00-04'),
    -- Candidato que este courier NO retiró: sigue en pendiente.
    (p_a3, t_a, s_a2, 'flex', 'ml_flex', 'backfill', 'SHIP-RET-A3', 'pendiente_asignacion',
     null, 'Destinatario A3', 'Calle Retiro A 3', 'Las Condes',
     'pendiente', null),
    (p_a4, t_a, s_a2, 'flex', 'ml_flex', 'backfill', 'SHIP-RET-A4', 'pendiente_asignacion',
     null, 'Destinatario A4', 'Calle Retiro A 4', 'Maipu',
     'no_procesado', null),
    (p_b1, t_b, s_b1, 'flex', 'ml_flex', 'backfill', 'SHIP-RET-B1', 'pendiente_asignacion',
     d_b1, 'Destinatario B1', 'Calle Retiro B 1', 'Vitacura',
     'retirado', timestamptz '2026-08-12 10:15:00-04')
  on conflict (id) do nothing;
end $$;

-- =============================================================================
-- BLOQUE 0 · Contrato de esquema (11 tests)
-- =============================================================================

select has_type('operacion', 'situacion_retiro',
  'esquema: existe el tipo enum operacion.situacion_retiro');

-- El ORDEN importa: `enum_range` fija el orden de comparación y el de un
-- `order by situacion_retiro`. pendiente → retirado es la progresión del día.
select results_eq(
  $$ select enum_range(null::operacion.situacion_retiro)::text[] $$,
  $$ values (array['pendiente', 'retirado', 'no_procesado']) $$,
  'esquema: el enum tiene exactamente los 3 valores, en orden (pendiente, retirado, no_procesado)'
);

select has_column('operacion', 'pedidos', 'situacion_retiro',
  'esquema: operacion.pedidos.situacion_retiro existe');

select col_not_null('operacion', 'pedidos', 'situacion_retiro',
  'esquema: situacion_retiro es NOT NULL (todo pedido tiene una situacion, aunque sea pendiente)');

-- El default es la compuerta. Si esta prueba falla, cada pedido ingestado nace
-- marcado como si estuviera en poder del courier y la reja queda abierta.
-- Se lee de pg_catalog y con `is()` (comparación escalar) en vez de
-- information_schema + results_eq: `column_default` es del dominio
-- `character_data` —results_eq lo rechaza por tipos dispares— y el resultado de
-- pg_get_expr no deriva colación de ningún argumento, así que la comparación por
-- cursor de results_eq muere con "could not determine which collation to use".
select is(
  (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d
     join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    where d.adrelid = 'operacion.pedidos'::regclass
      and a.attname = 'situacion_retiro'),
  '''pendiente''::operacion.situacion_retiro',
  'esquema: el DEFAULT de situacion_retiro es pendiente — un pedido recien ingestado no esta retirado'
);

select has_column('operacion', 'pedidos', 'retirado_en',
  'esquema: operacion.pedidos.retirado_en existe');

select col_type_is('operacion', 'pedidos', 'retirado_en', 'timestamp with time zone',
  'esquema: retirado_en es timestamptz (instante del escaneo, no fecha suelta)');

-- Nullable a propósito: las filas anteriores a la migracion quedaron en
-- `retirado` SIN fecha, porque el instante no se conoce y no se inventa.
select col_is_null('operacion', 'pedidos', 'retirado_en',
  'esquema: retirado_en es NULLABLE (las filas del respaldo quedaron retiradas sin fecha conocida)');

select results_eq(
  $$ select count(*)::int from pg_constraint
      where conrelid = 'operacion.pedidos'::regclass
        and conname  = 'pedidos_retirado_en_coherente'
        and contype  = 'c' $$,
  $$ values (1) $$,
  'esquema: existe el CHECK pedidos_retirado_en_coherente (no hay fecha de retiro sin retiro)'
);

select has_index('operacion', 'pedidos', 'idx_pedidos_retirados_por_asignar',
  'esquema: existe el indice parcial idx_pedidos_retirados_por_asignar (la bandeja del coordinador)');

-- La vista NO se actualiza sola al cambiar la tabla base: sin el
-- `create or replace view`, PostgREST seguiria sirviendo la lista de columnas
-- congelada y la pantalla de asignacion nunca veria el campo.
select results_eq(
  $$ select count(*)::int from information_schema.columns
      where table_schema = 'public' and table_name = 'pedidos'
        and column_name in ('situacion_retiro', 'retirado_en') $$,
  $$ values (2) $$,
  'esquema: la vista public.pedidos se re-emitio y expone las 2 columnas nuevas'
);

-- =============================================================================
-- BLOQUE 1 · Default y CHECK, ejercitados de verdad (3 tests)
-- =============================================================================

-- Un pedido nuevo que no menciona la columna nace `pendiente`. Es EL invariante
-- de la compuerta: la ingesta no escribe situacion_retiro, y no debe.
insert into operacion.pedidos (
  id, tenant_id, seller_id, tipo_pedido, fuente, origen, ml_shipment_id, estado,
  destinatario_nombre, destinatario_direccion, destinatario_comuna)
values (
  'eeeeeeee-6666-0000-0000-000000000009', 'eeeeeeee-0000-0000-0000-000000000001',
  'eeeeeeee-1111-0000-0000-000000000001', 'flex', 'ml_flex', 'ml_ingesta', 'SHIP-RET-A9',
  'pendiente_asignacion', 'Destinatario A9', 'Calle Retiro A 9', 'Nunoa');

select results_eq(
  $$ select situacion_retiro::text from operacion.pedidos
      where id = 'eeeeeeee-6666-0000-0000-000000000009' $$,
  $$ values ('pendiente') $$,
  'DEFAULT: un pedido ingestado sin mencionar la columna nace `pendiente` — la reja arranca cerrada'
);

-- Una fecha de retiro colgando en una fila que NO esta retirada es la
-- combinacion imposible: el CHECK la rechaza con 23514.
select throws_ok(
  $$ update operacion.pedidos set retirado_en = now()
      where id = 'eeeeeeee-6666-0000-0000-000000000009' $$,
  '23514',
  null,
  'CHECK: poner retirado_en dejando situacion_retiro en pendiente es rechazado (23514)'
);

-- La implicacion inversa NO se exige, y eso tambien es contrato: las filas del
-- respaldo de la migracion viven en `retirado` con retirado_en en NULL.
select lives_ok(
  $$ update operacion.pedidos set situacion_retiro = 'retirado'
      where id = 'eeeeeeee-6666-0000-0000-000000000009' $$,
  'CHECK: marcar `retirado` SIN fecha se acepta — es como quedaron las filas anteriores a la migracion'
);

-- La fila sonda se retira acá a propósito: acaba de quedar `retirado` +
-- `pendiente_asignacion`, que es justo la combinación que el bloque 3 cuenta como
-- bandeja del coordinador. Dejarla viva contaminaría esa cuenta con un pedido que
-- no representa nada del escenario de aislamiento.
delete from operacion.pedidos where id = 'eeeeeeee-6666-0000-0000-000000000009';

-- =============================================================================
-- BLOQUE 2 · El GRANT de tabla completa, medido (3 tests)
--
--   El patrón que ya mordió dos veces en este repo (dinero.lineas_*.snapshot_regla
--   y el token de invitación) es: `grant select on tabla` cubre TODA columna nueva,
--   y la vista public.* NO es barrera porque config.toml expone `operacion`
--   directamente por PostgREST (Accept-Profile: operacion).
--
--   Aquí se afirma el hecho en vez de disimularlo: sí, `authenticated` puede leer
--   y escribir las dos columnas a nivel de PRIVILEGIO. Y no es una fuga, porque
--   public.pedidos es `select *` y ninguna de las dos es un secreto. La barrera de
--   confidencialidad es la RLS de FILA (bloques 3–5) y la de escritura son
--   pedidos_update_interno + el guard 42501.
-- =============================================================================

select is(
  (select bool_and(has_column_privilege('authenticated', 'operacion.pedidos', col, 'SELECT'))
     from unnest(array['situacion_retiro', 'retirado_en']) as col),
  true,
  'GRANT (hecho declarado): authenticated SI tiene SELECT sobre las 2 columnas — el grant es de tabla completa y cubre las nuevas'
);

select is(
  has_column_privilege('authenticated', 'operacion.pedidos', 'situacion_retiro', 'UPDATE'),
  true,
  'GRANT (hecho declarado): authenticated SI tiene UPDATE sobre situacion_retiro — el privilegio NO es la barrera; lo son pedidos_update_interno y el guard 42501'
);

select is(
  (select bool_or(has_column_privilege('anon', 'public.pedidos', col, 'SELECT'))
     from unnest(array['situacion_retiro', 'retirado_en']) as col),
  false,
  'GRANT: anon (sesion NO autenticada) no tiene SELECT sobre ninguna de las 2 columnas'
);

-- =============================================================================
-- BLOQUE 3 · Cruce de TENANT — con datos reales en ambos lados (6 tests)
-- =============================================================================

select test_iniciar_sesion(
  'eeeeeeee-3333-0000-0000-000000000001'::uuid, -- u_interno_a
  'eeeeeeee-0000-0000-0000-000000000001'::uuid, -- t_a
  'interno', 'dueno'
);

-- CONTROL: el interno de A sí ve su propia bandeja de retirados sin asignar —
-- exactamente la consulta que va a mandar la pantalla de asignación (etapa 6).
select results_eq(
  $$ select count(*)::int from public.pedidos
      where situacion_retiro = 'retirado' and estado = 'pendiente_asignacion' $$,
  $$ values (1) $$,
  'CONTROL: el interno del tenant A ve 1 pedido retirado y sin asignar (P_A2) — la bandeja del coordinador no esta vacia'
);

select is_empty(
  $$ select 1 from public.pedidos
      where tenant_id = 'ffffffff-0000-0000-0000-000000000001' $$,
  'TENANT: el interno del tenant A NO ve ningun pedido del tenant B'
);

select test_iniciar_sesion(
  'ffffffff-3333-0000-0000-000000000001'::uuid, -- u_interno_b
  'ffffffff-0000-0000-0000-000000000001'::uuid, -- t_b
  'interno', 'dueno'
);

select isnt_empty(
  $$ select 1 from public.pedidos
      where id = 'ffffffff-6666-0000-0000-000000000001'
        and situacion_retiro = 'retirado' $$,
  'CONTROL: el interno del tenant B SI lee la situacion_retiro de SU pedido (el cruce no pasa por ausencia de datos)'
);

select is_empty(
  $$ select situacion_retiro from public.pedidos
      where id = 'eeeeeeee-6666-0000-0000-000000000002' $$,
  'TENANT: el interno del tenant B NO lee la situacion_retiro de un pedido del tenant A ⇒ 0 filas'
);

-- Escritura cruzada. El interno de B PASA el guard (es interno) y lo detiene la
-- RLS de fila → UPDATE 0, sin excepción: son dos mecanismos distintos y ambos
-- tienen que funcionar. Si esto afectara filas, el courier B podría empujar los
-- candidatos del courier A a la bandeja de asignación de A.
select is(
  test_filas_afectadas(
    $$ update public.pedidos
          set situacion_retiro = 'retirado', retirado_en = now()
        where id = 'eeeeeeee-6666-0000-0000-000000000003' $$ -- P_A3, del tenant A
  ),
  0,
  'TENANT: el UPDATE del interno del tenant B sobre la situacion_retiro de un pedido del tenant A afecta 0 filas'
);

select test_cerrar_sesion();

select results_eq(
  $$ select situacion_retiro::text from operacion.pedidos
      where id = 'eeeeeeee-6666-0000-0000-000000000003' $$,
  $$ values ('pendiente') $$,
  'TENANT: verificado como postgres, P_A3 sigue en `pendiente` tras el intento del tenant B'
);

-- =============================================================================
-- BLOQUE 4 · Cruce de SELLER dentro del mismo tenant (7 tests)
-- =============================================================================

select test_iniciar_sesion(
  'eeeeeeee-3333-0000-0000-000000000002'::uuid, -- u_seller_a1
  'eeeeeeee-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'eeeeeeee-1111-0000-0000-000000000001'::uuid -- s_a1
);

-- Visibilidad decidida: el seller SÍ ve si el courier ya retiró SU bulto. Es
-- información de su propio pedido, no dato interno del courier.
select results_eq(
  $$ select situacion_retiro::text from public.pedidos
      where id = 'eeeeeeee-6666-0000-0000-000000000002' $$,
  $$ values ('retirado') $$,
  'SELLER: el seller A1 SI ve la situacion_retiro de SU propio pedido (es su bulto)'
);

select is_empty(
  $$ select situacion_retiro from public.pedidos
      where id = 'eeeeeeee-6666-0000-0000-000000000003' $$, -- P_A3, del seller A2
  'SELLER: el seller A1 NO ve la situacion_retiro de un pedido de otro seller del MISMO tenant ⇒ 0 filas'
);

select results_eq(
  $$ select count(*)::int from public.pedidos $$,
  $$ values (2) $$,
  'SELLER: el seller A1 ve exactamente sus 2 pedidos (P2 filtra por seller_id, no por tenant: el tenant A tiene 4)'
);

-- El mismo cruce contra la TABLA BASE, no contra la vista: es el camino que abre
-- `Accept-Profile: operacion` en PostgREST. La RLS de fila lo cierra igual, que
-- es justo lo que el grant de tabla completa NO garantiza por si solo.
select is_empty(
  $$ select situacion_retiro from operacion.pedidos
      where id = 'eeeeeeee-6666-0000-0000-000000000004' $$, -- P_A4, del seller A2
  'SELLER: tampoco la lee golpeando la TABLA BASE operacion.pedidos (el bypass de la vista via Accept-Profile no sirve: manda la RLS de fila)'
);

-- "Ni datos internos del courier": manifiestos no tiene politica P2.
select is_empty(
  $$ select 1 from public.manifiestos $$,
  'SELLER: el seller no ve NINGUN manifiesto — dato interno del courier, sin politica para el'
);

-- LA PRUEBA QUE MAS IMPORTA DE ESTE BLOQUE. Si el seller pudiera escribir la
-- columna, se declararia "ya retirado" y su pedido entraria a la bandeja de
-- asignacion del courier sin que ningun conductor lo haya escaneado: cobro por
-- una entrega que este courier no hizo. El guard lo corta con 42501, antes de
-- que RLS filtre filas.
select throws_ok(
  $$ update public.pedidos
        set situacion_retiro = 'retirado', retirado_en = now()
      where id = 'eeeeeeee-6666-0000-0000-000000000001' $$,
  '42501',
  null,
  'SELLER: el UPDATE de situacion_retiro sobre SU PROPIO pedido recibe 42501 — el seller no puede declararse retirado a si mismo'
);

select is_empty(
  $$ select 1 from public.pedidos
      where tenant_id = 'ffffffff-0000-0000-0000-000000000001' $$,
  'SELLER: el seller del tenant A NO ve ningun pedido del tenant B'
);

-- =============================================================================
-- BLOQUE 5 · Cruce de CONDUCTOR (4 tests)
-- =============================================================================

select test_iniciar_sesion(
  'eeeeeeee-3333-0000-0000-000000000004'::uuid, -- u_conductor_a1
  'eeeeeeee-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'eeeeeeee-2222-0000-0000-000000000001'::uuid -- d_a1
);

select results_eq(
  $$ select count(*)::int from public.pedidos $$,
  $$ values (1) $$,
  'CONDUCTOR: el conductor A1 ve UN solo pedido, el asignado a el (P3 por driver_id_asignado)'
);

-- EL CERO DELIBERADO (§13bis-1.1). P_A2 esta `retirado` y sin asignar: es
-- exactamente el bulto que un conductor acaba de escanear en la bodega, y no lo
-- ve. Por eso la resolucion del codigo escaneado va por endpoint Bearer con
-- service_role y DTO minimo. Si alguien "arregla" esto ampliando la politica del
-- conductor a "los de su tenant", esta prueba falla — y ese es el punto: seria
-- exponer nombre, direccion y telefono de los ~400 destinatarios del dia a cada
-- conductor.
select is_empty(
  $$ select situacion_retiro from public.pedidos
      where id = 'eeeeeeee-6666-0000-0000-000000000002' $$,
  'CONDUCTOR §13bis-1.1: el conductor NO ve el pedido retirado y sin asignar ⇒ 0 filas. La resolucion del QR NO puede apoyarse en la RLS del conductor'
);

select throws_ok(
  $$ update public.pedidos
        set situacion_retiro = 'no_procesado'
      where id = 'eeeeeeee-6666-0000-0000-000000000001' $$,
  '42501',
  null,
  'CONDUCTOR: el UPDATE de situacion_retiro sobre el pedido que SI tiene asignado recibe 42501 — el escaneo entra por service_role, no por PostgREST'
);

select test_iniciar_sesion(
  'eeeeeeee-3333-0000-0000-000000000005'::uuid, -- u_conductor_a2
  'eeeeeeee-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'eeeeeeee-2222-0000-0000-000000000002'::uuid -- d_a2
);

select is_empty(
  $$ select 1 from public.pedidos
      where id = 'eeeeeeee-6666-0000-0000-000000000001' $$,
  'CONDUCTOR: el conductor A2 NO ve el pedido asignado al conductor A1 (mismo tenant, otro driver_id)'
);

-- =============================================================================
-- BLOQUE 6 · Control positivo de fixtures (1 test)
--   Cierra la puerta al falso verde: todo lo anterior seria trivialmente cierto
--   si las tablas estuvieran vacias.
-- =============================================================================

select test_cerrar_sesion();

select results_eq(
  $$ select count(*)::int from operacion.pedidos
      where tenant_id in ('eeeeeeee-0000-0000-0000-000000000001',
                          'ffffffff-0000-0000-0000-000000000001') $$,
  $$ values (5) $$,
  'control positivo: como postgres existen los 5 pedidos de fixture (4 del tenant A + 1 del tenant B)'
);

select * from finish();

rollback;
