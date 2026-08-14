-- =============================================================================
-- Pruebas — Secuencia de paradas persistida (etapa 7)
-- =============================================================================
-- Migración bajo prueba: 20260814000004_operacion_secuencia_paradas.sql
-- Diseño: docs/arquitectura/retiro-y-ruteo.md §4/§4.1 · plan, etapa 7.
--
-- QUÉ SE DEMUESTRA, Y POR QUÉ CADA COSA:
--
--   · AISLAMIENTO CRUZADO EN LAS DOS DIRECCIONES, con los DOS couriers sembrados
--     y los dos con ruta escrita. Si el courier B estuviera vacío, "A no toca
--     nada de B" pasaría por ausencia y no probaría nada. La función es SECURITY
--     DEFINER y escribe saltándose RLS: lo ÚNICO que separa a un courier de otro
--     es el `p_tenant_id` escrito en el texto de la función, así que si ese
--     filtro faltara en un solo WHERE, un coordinador podría reordenarle la ruta
--     del día a la flota de otro — y el asiento de auditoría quedaría a nombre de
--     la víctima.
--   · LA ESCRITURA ES SOLO DE service_role, en sus DOS mitades: nadie más puede
--     EJECUTAR la función, y nadie más puede escribir la COLUMNA por PostgREST.
--     La segunda mitad es la que se olvida: `operacion.asignaciones_pedido` tiene
--     grant de tabla completa a `authenticated` y la vista `public.*` NO es
--     barrera (`Accept-Profile: operacion` alcanza la tabla base). Sin el grant
--     por columna, un PATCH reordenaría la ruta sin validación y sin bitácora.
--   · O SE APLICA LA SECUENCIA ENTERA O NO SE APLICA NINGUNA, con fallo inyectado
--     DESPUÉS de que la función ya apagó la secuencia vigente. Si la transacción
--     no fuera atómica, el manifiesto quedaría con las cinco paradas en NULL —
--     sin ruta y sin error visible.
--   · EL INTERCAMBIO DE DOS PARADAS FUNCIONA. Es la trampa de esta etapa: un
--     unique no diferido revienta a MITAD de la sentencia aunque el estado final
--     sea válido. Aquí no revienta porque la función apaga la secuencia antes de
--     escribir la nueva; esta prueba cae si alguien quita ese paso.
--   · UN PEDIDO DE OTRO MANIFIESTO NO SE CUELA — ni del mismo courier, ni de
--     otro, ni por una asignación ya superada. Y el rechazo es del lote entero:
--     una secuencia parcial que no es la que el coordinador vio es peor que
--     ninguna.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(56);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada (redefinidos aquí — cada .test.sql corre en su
-- propia transacción y no ve los helpers de los demás).
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

-- =============================================================================
-- Fixtures — DOS couriers, los dos con manifiesto y paradas del MISMO día
--
-- Tenant A (aaaaaaaa…):
--   sellers      S_A1 (P_A1 P_A2 P_A3 P_A5) · S_A2 (P_A4) → para probar que un
--                seller no ve la parada de otro seller dentro del MISMO manifiesto
--   conductores  D_A1 (M_A1 borrador · M_A3 completado) · D_A2 (M_A2 borrador ·
--                M_A4 cancelado)
--   M_A1  5 paradas ACTIVAS: P_A1 P_A2 P_A3 P_A4 P_A5   ← el manifiesto que se rutea
--         + P_A8 con asignación INACTIVA (asignación superada)
--   M_A2  1 parada: P_A6                                 ← "no se movió nada más"
--   M_A3  completado, con P_A7                           ← reja 55000
--   M_A4  cancelado                                      ← reja 55000
--
-- Tenant B (bbbbbbbb…): M_B1 con P_B1 y P_B2, RUTEADO también. Sembrado con ruta
--   propia a propósito: el aislamiento se prueba contra datos reales, no contra
--   el vacío.
-- =============================================================================
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-0000000000d1';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-0000000000d1';

  s_a1 uuid := 'aaaaaaaa-1111-0000-0000-0000000000d1';
  s_a2 uuid := 'aaaaaaaa-1111-0000-0000-0000000000d2';
  s_b1 uuid := 'bbbbbbbb-1111-0000-0000-0000000000d1';

  d_a1 uuid := 'aaaaaaaa-2222-0000-0000-0000000000d1';
  d_a2 uuid := 'aaaaaaaa-2222-0000-0000-0000000000d2';
  d_b1 uuid := 'bbbbbbbb-2222-0000-0000-0000000000d1';

  u_a uuid := 'aaaaaaaa-3333-0000-0000-0000000000d1';
  u_b uuid := 'bbbbbbbb-3333-0000-0000-0000000000d1';

  m_a1 uuid := 'aaaaaaaa-7777-0000-0000-0000000000d1';
  m_a2 uuid := 'aaaaaaaa-7777-0000-0000-0000000000d2';
  m_a3 uuid := 'aaaaaaaa-7777-0000-0000-0000000000d3';
  m_a4 uuid := 'aaaaaaaa-7777-0000-0000-0000000000d4';
  m_b1 uuid := 'bbbbbbbb-7777-0000-0000-0000000000d1';

  p_a1 uuid := 'aaaaaaaa-6666-0000-0000-0000000000d1';
  p_a2 uuid := 'aaaaaaaa-6666-0000-0000-0000000000d2';
  p_a3 uuid := 'aaaaaaaa-6666-0000-0000-0000000000d3';
  p_a4 uuid := 'aaaaaaaa-6666-0000-0000-0000000000d4';
  p_a5 uuid := 'aaaaaaaa-6666-0000-0000-0000000000d5';
  p_a6 uuid := 'aaaaaaaa-6666-0000-0000-0000000000d6';
  p_a7 uuid := 'aaaaaaaa-6666-0000-0000-0000000000d7';
  p_a8 uuid := 'aaaaaaaa-6666-0000-0000-0000000000d8';
  p_b1 uuid := 'bbbbbbbb-6666-0000-0000-0000000000d1';
  p_b2 uuid := 'bbbbbbbb-6666-0000-0000-0000000000d2';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier Ruta A', 'Courier Ruta A SpA', '76818091-1', 'activo'),
    (t_b, 'Courier Ruta B', 'Courier Ruta B SpA', '76818092-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          created_at, updated_at, raw_app_meta_data,
                          raw_user_meta_data, aud, role)
  values
    (u_a, 'interno.a@ruta.test', crypt('x', gen_salt('bf')), now(), now(), now(),
     '{}', '{}', 'authenticated', 'authenticated'),
    (u_b, 'interno.b@ruta.test', crypt('x', gen_salt('bf')), now(), now(), now(),
     '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a1, t_a, 'Seller Ruta A1', '77818091-1', 'Contacto A1', 'a1@ruta.test', 'activo'),
    (s_a2, t_a, 'Seller Ruta A2', '77818093-3', 'Contacto A2', 'a2@ruta.test', 'activo'),
    (s_b1, t_b, 'Seller Ruta B1', '77818092-2', 'Contacto B1', 'b1@ruta.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values
    (d_a1, t_a, 'Conductor Ruta A1', '78818091-1', 'dependiente',   'activo'),
    (d_a2, t_a, 'Conductor Ruta A2', '78818093-3', 'independiente', 'activo'),
    (d_b1, t_b, 'Conductor Ruta B1', '78818092-2', 'dependiente',   'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_a, t_a, 'Interno Ruta A', 'interno', null, null, 'dueno', 'activo'),
    (u_b, t_b, 'Interno Ruta B', 'interno', null, null, 'dueno', 'activo')
  on conflict (id) do nothing;

  -- Las comunas y direcciones están elegidas para que el orden ALFABÉTICO sea
  -- distinto del orden en que se van a rutear: así, si el respaldo se colara
  -- donde manda la secuencia persistida, la prueba lo vería.
  insert into operacion.pedidos (
    id, tenant_id, seller_id, tipo_pedido, origen, ml_shipment_id, estado,
    destinatario_nombre, destinatario_direccion, destinatario_comuna,
    situacion_retiro, retirado_en)
  values
    (p_a1, t_a, s_a1, 'flex', 'backfill', 'SHRTA1', 'asignado',
     'Destinatario A1', 'Zapadores 1',  'Vitacura',  'retirado', now()),
    (p_a2, t_a, s_a1, 'flex', 'backfill', 'SHRTA2', 'asignado',
     'Destinatario A2', 'Yungay 2',     'Renca',     'retirado', now()),
    (p_a3, t_a, s_a1, 'flex', 'backfill', 'SHRTA3', 'asignado',
     'Destinatario A3', 'Xerox 3',      'Maipu',     'retirado', now()),
    (p_a4, t_a, s_a2, 'flex', 'backfill', 'SHRTA4', 'asignado',
     'Destinatario A4', 'Walker 4',     'La Florida','retirado', now()),
    (p_a5, t_a, s_a1, 'flex', 'backfill', 'SHRTA5', 'asignado',
     'Destinatario A5', 'Vergara 5',    'Cerrillos', 'retirado', now()),
    (p_a6, t_a, s_a1, 'flex', 'backfill', 'SHRTA6', 'asignado',
     'Destinatario A6', 'Ulises 6',     'Nunoa',     'retirado', now()),
    (p_a7, t_a, s_a1, 'flex', 'backfill', 'SHRTA7', 'entregado',
     'Destinatario A7', 'Tobalaba 7',   'Penalolen', 'retirado', now()),
    (p_a8, t_a, s_a1, 'flex', 'backfill', 'SHRTA8', 'pendiente_asignacion',
     'Destinatario A8', 'Simon 8',      'Quilicura', 'retirado', now()),
    (p_b1, t_b, s_b1, 'flex', 'backfill', 'SHRTB1', 'asignado',
     'Destinatario B1', 'Recoleta 1',   'Recoleta',  'retirado', now()),
    (p_b2, t_b, s_b1, 'flex', 'backfill', 'SHRTB2', 'asignado',
     'Destinatario B2', 'Providencia 2','Providencia','retirado', now())
  on conflict (id) do nothing;

  insert into operacion.manifiestos
    (id, tenant_id, driver_id, nombre, fecha_operacion, estado, creado_por_usuario_id,
     confirmado_en, completado_en)
  values
    (m_a1, t_a, d_a1, 'Ruta A1', date '2026-08-14', 'borrador',   u_a, null, null),
    (m_a2, t_a, d_a2, 'Ruta A2', date '2026-08-14', 'borrador',   u_a, null, null),
    (m_a3, t_a, d_a1, 'Ruta A3', date '2026-08-13', 'completado', u_a, now(), now()),
    (m_a4, t_a, d_a2, 'Ruta A4', date '2026-08-13', 'cancelado',  u_a, null, null),
    (m_b1, t_b, d_b1, 'Ruta B1', date '2026-08-14', 'borrador',   u_b, null, null)
  on conflict (id) do nothing;

  -- P_A8 entra con la asignación YA SUPERADA (activa = false). No es adorno: es
  -- el tercer camino por el que un pedido podría "colarse" en una secuencia —
  -- está en el manifiesto correcto y es del courier correcto, pero su asignación
  -- ya no es la vigente.
  insert into operacion.asignaciones_pedido
    (tenant_id, pedido_id, manifiesto_id, driver_id, seller_id, activa,
     asignado_por_usuario_id, desasignado_en)
  values
    (t_a, p_a1, m_a1, d_a1, s_a1, true,  u_a, null),
    (t_a, p_a2, m_a1, d_a1, s_a1, true,  u_a, null),
    (t_a, p_a3, m_a1, d_a1, s_a1, true,  u_a, null),
    (t_a, p_a4, m_a1, d_a1, s_a2, true,  u_a, null),
    (t_a, p_a5, m_a1, d_a1, s_a1, true,  u_a, null),
    (t_a, p_a6, m_a2, d_a2, s_a1, true,  u_a, null),
    (t_a, p_a7, m_a3, d_a1, s_a1, true,  u_a, null),
    (t_a, p_a8, m_a1, d_a1, s_a1, false, u_a, now()),
    (t_b, p_b1, m_b1, d_b1, s_b1, true,  u_b, null),
    (t_b, p_b2, m_b1, d_b1, s_b1, true,  u_b, null);
end $$;


-- =============================================================================
-- BLOQUE 0 · Privilegios de EJECUCIÓN — ningún rol de cliente (5 tests)
-- =============================================================================
select ok(
  not has_function_privilege(
    'authenticated',
    'operacion.aplicar_secuencia_paradas(uuid,uuid,uuid[],text,uuid)',
    'EXECUTE'),
  'privilegios: authenticated NO puede ejecutar aplicar_secuencia_paradas'
);

select ok(
  not has_function_privilege(
    'anon',
    'operacion.aplicar_secuencia_paradas(uuid,uuid,uuid[],text,uuid)',
    'EXECUTE'),
  'privilegios: anon NO puede ejecutar aplicar_secuencia_paradas'
);

select ok(
  has_function_privilege(
    'service_role',
    'operacion.aplicar_secuencia_paradas(uuid,uuid,uuid[],text,uuid)',
    'EXECUTE'),
  'privilegios: service_role SÍ puede ejecutarla (control positivo — un revoke de más dejaría el ruteo muerto)'
);

select ok(
  (select p.prosecdef
     from pg_proc p
    where p.oid = to_regprocedure('operacion.aplicar_secuencia_paradas(uuid,uuid,uuid[],text,uuid)')::oid),
  'privilegios: la función es SECURITY DEFINER (escribe sin RLS, con el tenant por parámetro)'
);

-- Comportamiento real: ni el DUEÑO del courier, con su sesión bien formada, la
-- alcanza. La llama el servidor con service_role, tras validar RBAC.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid,
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'interno', 'dueno'
);

select throws_ok(
  $$ select * from operacion.aplicar_secuencia_paradas(
       'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
       'aaaaaaaa-7777-0000-0000-0000000000d1'::uuid,
       array['aaaaaaaa-6666-0000-0000-0000000000d1']::uuid[],
       'manual',
       'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid) $$,
  '42501',
  null,
  'privilegios: el dueño del courier recibe 42501 desde su propia sesión'
);


-- =============================================================================
-- BLOQUE 1 · Privilegio POR COLUMNA — la otra mitad de "solo service_role"
--            (7 tests)
-- =============================================================================
-- Sin esto, la función SECURITY DEFINER sería irrelevante: cualquier usuario
-- interno del tenant podría reordenar la ruta con un PATCH a PostgREST, sin
-- validación, sin las rejas y SIN UN SOLO ASIENTO DE BITÁCORA. Es el patrón que
-- en este repo ya mordió dos veces (snapshot_regla y el token de invitación):
-- la vista `public.*` NO es barrera, porque `Accept-Profile: operacion` alcanza
-- la tabla base.
select ok(
  not has_column_privilege('authenticated', 'operacion.asignaciones_pedido', 'orden_ruta', 'UPDATE'),
  'columna: authenticated NO puede UPDATE orden_ruta en la tabla base'
);

select ok(
  not has_column_privilege('authenticated', 'operacion.asignaciones_pedido', 'orden_ruta', 'INSERT'),
  'columna: authenticated NO puede INSERT orden_ruta en la tabla base (una fila nueva tampoco puede nacer con lugar elegido a mano)'
);

select ok(
  not has_column_privilege('authenticated', 'public.asignaciones_pedido', 'orden_ruta', 'UPDATE'),
  'columna: authenticated tampoco puede UPDATE orden_ruta por la VISTA public (la vista no es barrera por sí sola, pero tampoco puede ser la puerta trasera)'
);

-- Control positivo de LECTURA: la secuencia no es un secreto. Su
-- confidencialidad la resuelve la RLS de la tabla (bloque 12), no la ausencia de
-- grant; cerrarla dejaría al conductor sin ruta.
select ok(
  has_column_privilege('authenticated', 'operacion.asignaciones_pedido', 'orden_ruta', 'SELECT'),
  'columna: authenticated SÍ puede LEER orden_ruta (la RLS de fila es la que aísla, no el grant)'
);

-- Control positivo del revoke: NINGUNA otra columna perdió la escritura. Un
-- revoke de más rompería en silencio cualquier camino que aún escriba con sesión
-- de usuario, y el síntoma sería un 42501 en producción.
select is_empty($$
  select a.attname
    from pg_attribute a
   where a.attrelid = 'operacion.asignaciones_pedido'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and a.attname <> 'orden_ruta'
     and not has_column_privilege('authenticated', 'operacion.asignaciones_pedido', a.attname, 'UPDATE')
$$, 'columna: ninguna columna DISTINTA de orden_ruta perdió el UPDATE — el revoke fue quirúrgico, no una amputación');

-- Y el comportamiento real, que es lo que importa: el dueño del courier, con su
-- sesión bien formada y con la fila perfectamente visible para él, NO puede
-- escribir la columna. Ni por el esquema ni por la vista.
select throws_ok(
  $$ update operacion.asignaciones_pedido
        set orden_ruta = 99
      where pedido_id = 'aaaaaaaa-6666-0000-0000-0000000000d1' $$,
  '42501',
  null,
  'columna: el dueño del courier recibe 42501 al intentar escribir orden_ruta por el esquema operacion'
);

select throws_ok(
  $$ update public.asignaciones_pedido
        set orden_ruta = 99
      where pedido_id = 'aaaaaaaa-6666-0000-0000-0000000000d1' $$,
  '42501',
  null,
  'columna: y también por la vista public — las dos superficies están cerradas'
);

select test_cerrar_sesion();


-- =============================================================================
-- BLOQUE 2 · Esquema — la red que sostiene la invariante (4 tests)
-- =============================================================================
select isnt_empty($$
  select c.relname
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'operacion'
     and t.relname = 'asignaciones_pedido'
     and c.relname = 'idx_asignaciones_secuencia_manifiesto_uk'
     and i.indisunique
     and i.indpred is not null
$$, 'esquema: existe el índice único PARCIAL (manifiesto_id, orden_ruta) where activa — dos paradas no pueden ocupar el mismo lugar');

-- LA MENOS OBVIA: el índice NO puede ser TOTAL. `asignaciones_pedido` guarda
-- historia, y una asignación superada conserva su manifiesto_id: con un unique
-- total, esa fila muerta bloquearía su lugar para siempre y la ruta siguiente
-- fallaría contra un fantasma. Si alguien "arregla" el esquema quitándole el
-- WHERE, esta prueba lo atrapa.
select is_empty($$
  select c.relname
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'operacion'
     and t.relname = 'asignaciones_pedido'
     and i.indisunique
     and i.indpred is null
     and (select array_agg(a.attname::text order by a.attname::text)
            from unnest(i.indkey) as k(attnum)
            join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum)
         = array['manifiesto_id', 'orden_ruta']::text[]
$$, 'esquema: NO existe un unique TOTAL (manifiesto_id, orden_ruta) — bloquearía el lugar con las asignaciones históricas inactivas');

select ok(
  (select not a.attnotnull
     from pg_attribute a
    where a.attrelid = 'operacion.asignaciones_pedido'::regclass
      and a.attname  = 'orden_ruta'),
  'esquema: orden_ruta es NULLABLE — "sin rutear" es un estado normal, no un defecto'
);

select throws_ok(
  $$ update operacion.asignaciones_pedido
        set orden_ruta = 0
      where pedido_id = 'aaaaaaaa-6666-0000-0000-0000000000d1' $$,
  '23514',
  null,
  'esquema: el CHECK de rango rechaza el 0 (la primera parada es 1 — un 0 sería un bug de índice base-cero)'
);


-- =============================================================================
-- BLOQUE 3 · Camino feliz — la secuencia se persiste (4 tests)
-- =============================================================================
-- El courier B rutea PRIMERO, para que todo lo que sigue se mida contra datos
-- reales del otro tenant y no contra el vacío.
create temporary table resultado_b as
select * from operacion.aplicar_secuencia_paradas(
  'bbbbbbbb-0000-0000-0000-0000000000d1'::uuid,
  'bbbbbbbb-7777-0000-0000-0000000000d1'::uuid,
  array['bbbbbbbb-6666-0000-0000-0000000000d2',
        'bbbbbbbb-6666-0000-0000-0000000000d1']::uuid[],
  'motor',
  'bbbbbbbb-3333-0000-0000-0000000000d1'::uuid);

select results_eq(
  $$ select * from operacion.aplicar_secuencia_paradas(
       'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
       'aaaaaaaa-7777-0000-0000-0000000000d1'::uuid,
       array['aaaaaaaa-6666-0000-0000-0000000000d1',
             'aaaaaaaa-6666-0000-0000-0000000000d2',
             'aaaaaaaa-6666-0000-0000-0000000000d3',
             'aaaaaaaa-6666-0000-0000-0000000000d4',
             'aaaaaaaa-6666-0000-0000-0000000000d5']::uuid[],
       'motor',
       'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid) $$,
  $$ values (5, 0, 0) $$,
  'SECUENCIA: 5 paradas ruteadas, 0 sin secuencia, 0 previas limpiadas (el manifiesto no estaba ruteado)'
);

-- La posición en el arreglo ES el orden. Nótese que el orden alfabético por
-- comuna sería otro (Cerrillos, La Florida, Maipú, Renca, Vitacura): si el
-- respaldo se colara donde manda la secuencia, esta prueba lo vería.
select results_eq(
  $$ select a.pedido_id, a.orden_ruta
       from operacion.asignaciones_pedido a
      where a.manifiesto_id = 'aaaaaaaa-7777-0000-0000-0000000000d1'
        and a.activa
      order by a.orden_ruta $$,
  $$ values ('aaaaaaaa-6666-0000-0000-0000000000d1'::uuid, 1),
            ('aaaaaaaa-6666-0000-0000-0000000000d2'::uuid, 2),
            ('aaaaaaaa-6666-0000-0000-0000000000d3'::uuid, 3),
            ('aaaaaaaa-6666-0000-0000-0000000000d4'::uuid, 4),
            ('aaaaaaaa-6666-0000-0000-0000000000d5'::uuid, 5) $$,
  'SECUENCIA: la posición en el arreglo es el orden, 1..N contiguo — no el orden alfabético'
);

-- La asignación SUPERADA de P_A8 sigue sin secuencia: está en el manifiesto
-- correcto, es del courier correcto, y aun así no entra.
select results_eq(
  $$ select a.orden_ruta
       from operacion.asignaciones_pedido a
      where a.pedido_id = 'aaaaaaaa-6666-0000-0000-0000000000d8' $$,
  $$ values (null::integer) $$,
  'SECUENCIA: la asignación ya superada (activa = false) NO recibe lugar en la ruta'
);

select results_eq(
  $$ select a.pedido_id, a.orden_ruta
       from operacion.asignaciones_pedido a
      where a.manifiesto_id = 'aaaaaaaa-7777-0000-0000-0000000000d2' $$,
  $$ values ('aaaaaaaa-6666-0000-0000-0000000000d6'::uuid, null::integer) $$,
  'SECUENCIA: rutear un manifiesto no toca los demás manifiestos del mismo courier'
);


-- =============================================================================
-- BLOQUE 4 · EL INTERCAMBIO — la trampa de esta etapa (3 tests)
-- =============================================================================
-- Reordenar a mano son permutaciones, y el caso mínimo es intercambiar dos
-- paradas. Contra un índice único NO diferido, `set orden_ruta = <nuevo>` en una
-- sola pasada revienta con 23505 en el estado intermedio aunque el estado final
-- sea impecable. Aquí no revienta porque la función APAGA la secuencia vigente
-- antes de escribir la nueva (todo a NULL, y los NULL no colisionan).
--
-- ⚠️ ESTA PRUEBA CAE si alguien quita ese paso "porque sobra", o si convierte el
-- índice parcial en una constraint no diferible.
select lives_ok(
  $$ select * from operacion.aplicar_secuencia_paradas(
       'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
       'aaaaaaaa-7777-0000-0000-0000000000d1'::uuid,
       array['aaaaaaaa-6666-0000-0000-0000000000d2',
             'aaaaaaaa-6666-0000-0000-0000000000d1',
             'aaaaaaaa-6666-0000-0000-0000000000d3',
             'aaaaaaaa-6666-0000-0000-0000000000d4',
             'aaaaaaaa-6666-0000-0000-0000000000d5']::uuid[],
       'manual',
       'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid) $$,
  'INTERCAMBIO: permutar las dos primeras paradas NO viola la unicidad (el apagado previo hace válido el estado intermedio)'
);

select results_eq(
  $$ select a.pedido_id, a.orden_ruta
       from operacion.asignaciones_pedido a
      where a.manifiesto_id = 'aaaaaaaa-7777-0000-0000-0000000000d1'
        and a.activa
      order by a.orden_ruta $$,
  $$ values ('aaaaaaaa-6666-0000-0000-0000000000d2'::uuid, 1),
            ('aaaaaaaa-6666-0000-0000-0000000000d1'::uuid, 2),
            ('aaaaaaaa-6666-0000-0000-0000000000d3'::uuid, 3),
            ('aaaaaaaa-6666-0000-0000-0000000000d4'::uuid, 4),
            ('aaaaaaaa-6666-0000-0000-0000000000d5'::uuid, 5) $$,
  'INTERCAMBIO: y el estado final es exactamente la permutación pedida'
);

select results_eq(
  $$ select count(*)::int, count(distinct a.orden_ruta)::int
       from operacion.asignaciones_pedido a
      where a.manifiesto_id = 'aaaaaaaa-7777-0000-0000-0000000000d1'
        and a.activa $$,
  $$ values (5, 5) $$,
  'INTERCAMBIO: siguen siendo 5 paradas con 5 lugares DISTINTOS — ni un duplicado, ni un hueco'
);


-- =============================================================================
-- BLOQUE 5 · Subconjunto y vacío (4 tests)
-- =============================================================================
-- Un subconjunto es el caso REAL del motor: las paradas sin coordenada usable
-- vuelven en `sinUbicar` y no se mandan. Lo que no viene en la lista queda sin
-- secuencia, que es exactamente el estado que corresponde. Actor NULL = job sin
-- sesión humana.
select results_eq(
  $$ select * from operacion.aplicar_secuencia_paradas(
       'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
       'aaaaaaaa-7777-0000-0000-0000000000d1'::uuid,
       array['aaaaaaaa-6666-0000-0000-0000000000d3',
             'aaaaaaaa-6666-0000-0000-0000000000d5',
             'aaaaaaaa-6666-0000-0000-0000000000d1']::uuid[],
       'motor',
       null::uuid) $$,
  $$ values (3, 2, 5) $$,
  'SUBCONJUNTO: 3 ruteadas, 2 quedaron sin secuencia, 5 previas limpiadas — el contador de "sin ubicar" es lo que la pantalla necesita para no mentir'
);

select results_eq(
  $$ select a.pedido_id
       from operacion.asignaciones_pedido a
      where a.manifiesto_id = 'aaaaaaaa-7777-0000-0000-0000000000d1'
        and a.activa
        and a.orden_ruta is null
      order by a.pedido_id $$,
  $$ values ('aaaaaaaa-6666-0000-0000-0000000000d2'::uuid),
            ('aaaaaaaa-6666-0000-0000-0000000000d4'::uuid) $$,
  'SUBCONJUNTO: las que no venían en la lista quedaron en NULL, no con su número viejo'
);

-- El arreglo VACÍO es válido y significa "este manifiesto queda sin secuencia".
-- Se aparta de asignar_pedidos_en_bloque (donde el lote vacío LANZA) a propósito:
-- allí no tiene significado y crearía un manifiesto fantasma; aquí es una
-- operación con sentido.
select results_eq(
  $$ select * from operacion.aplicar_secuencia_paradas(
       'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
       'aaaaaaaa-7777-0000-0000-0000000000d1'::uuid,
       '{}'::uuid[],
       'manual',
       'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid) $$,
  $$ values (0, 5, 3) $$,
  'VACÍO: un arreglo vacío limpia la secuencia entera y lo dice (0 ruteadas, 5 sin secuencia, 3 limpiadas)'
);

select is_empty($$
  select 1 from operacion.asignaciones_pedido a
   where a.manifiesto_id = 'aaaaaaaa-7777-0000-0000-0000000000d1'
     and a.orden_ruta is not null
$$, 'VACÍO: no quedó ni una parada con número');

-- Se repone la línea base 1..5 para los bloques siguientes.
create temporary table resultado_base as
select * from operacion.aplicar_secuencia_paradas(
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'aaaaaaaa-7777-0000-0000-0000000000d1'::uuid,
  array['aaaaaaaa-6666-0000-0000-0000000000d1',
        'aaaaaaaa-6666-0000-0000-0000000000d2',
        'aaaaaaaa-6666-0000-0000-0000000000d3',
        'aaaaaaaa-6666-0000-0000-0000000000d4',
        'aaaaaaaa-6666-0000-0000-0000000000d5']::uuid[],
  'motor',
  'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid);


-- =============================================================================
-- BLOQUE 6 · AISLAMIENTO CRUZADO entre couriers — en las dos direcciones
--            (6 tests)
-- =============================================================================
-- La función no tiene RLS debajo: el único filtro es `p_tenant_id`. Si faltara en
-- un solo WHERE, un courier reordenaría la ruta del día de otro.
select throws_ok(
  $$ select * from operacion.aplicar_secuencia_paradas(
       'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
       'bbbbbbbb-7777-0000-0000-0000000000d1'::uuid,
       array['bbbbbbbb-6666-0000-0000-0000000000d1',
             'bbbbbbbb-6666-0000-0000-0000000000d2']::uuid[],
       'manual',
       'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid) $$,
  'P0002',
  null,
  'AISLAMIENTO: el courier A NO puede rutear un manifiesto del courier B (mismo error que si no existiera — no se confirma su existencia)'
);

select results_eq(
  $$ select a.pedido_id, a.orden_ruta
       from operacion.asignaciones_pedido a
      where a.manifiesto_id = 'bbbbbbbb-7777-0000-0000-0000000000d1'
      order by a.orden_ruta $$,
  $$ values ('bbbbbbbb-6666-0000-0000-0000000000d2'::uuid, 1),
            ('bbbbbbbb-6666-0000-0000-0000000000d1'::uuid, 2) $$,
  'AISLAMIENTO: la ruta del courier B quedó EXACTAMENTE como estaba (se mide contra datos reales, no contra el vacío)'
);

select throws_ok(
  $$ select * from operacion.aplicar_secuencia_paradas(
       'bbbbbbbb-0000-0000-0000-0000000000d1'::uuid,
       'aaaaaaaa-7777-0000-0000-0000000000d1'::uuid,
       array['aaaaaaaa-6666-0000-0000-0000000000d1']::uuid[],
       'manual',
       'bbbbbbbb-3333-0000-0000-0000000000d1'::uuid) $$,
  'P0002',
  null,
  'AISLAMIENTO: y el courier B tampoco puede rutear un manifiesto del courier A — se prueba en las DOS direcciones'
);

-- El caso más sutil: manifiesto propio, pero con un pedido del OTRO courier
-- colado en la lista. No casa con ninguna fila → se rechaza el lote entero.
select throws_ok(
  $$ select * from operacion.aplicar_secuencia_paradas(
       'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
       'aaaaaaaa-7777-0000-0000-0000000000d1'::uuid,
       array['aaaaaaaa-6666-0000-0000-0000000000d1',
             'bbbbbbbb-6666-0000-0000-0000000000d1']::uuid[],
       'manual',
       'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid) $$,
  'P0001',
  null,
  'AISLAMIENTO: un pedido del courier B colado en un lote del courier A hace fallar la operación ENTERA'
);

select results_eq(
  $$ select a.pedido_id, a.orden_ruta
       from operacion.asignaciones_pedido a
      where a.manifiesto_id = 'aaaaaaaa-7777-0000-0000-0000000000d1'
        and a.activa
      order by a.orden_ruta $$,
  $$ values ('aaaaaaaa-6666-0000-0000-0000000000d1'::uuid, 1),
            ('aaaaaaaa-6666-0000-0000-0000000000d2'::uuid, 2),
            ('aaaaaaaa-6666-0000-0000-0000000000d3'::uuid, 3),
            ('aaaaaaaa-6666-0000-0000-0000000000d4'::uuid, 4),
            ('aaaaaaaa-6666-0000-0000-0000000000d5'::uuid, 5) $$,
  'AISLAMIENTO: tras ese intento la ruta de A quedó intacta — ni siquiera se aplicó la parte que sí calzaba'
);

select results_eq(
  $$ select a.orden_ruta
       from operacion.asignaciones_pedido a
      where a.pedido_id = 'bbbbbbbb-6666-0000-0000-0000000000d1' $$,
  $$ values (2) $$,
  'AISLAMIENTO: y el pedido del courier B conservó SU lugar, sin recibir el del lote ajeno'
);


-- =============================================================================
-- BLOQUE 7 · Un pedido de otro manifiesto no se cuela (4 tests)
-- =============================================================================
select throws_ok(
  $$ select * from operacion.aplicar_secuencia_paradas(
       'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
       'aaaaaaaa-7777-0000-0000-0000000000d1'::uuid,
       array['aaaaaaaa-6666-0000-0000-0000000000d1',
             'aaaaaaaa-6666-0000-0000-0000000000d6']::uuid[],
       'manual',
       'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid) $$,
  'P0001',
  null,
  'OTRO MANIFIESTO: un pedido del MISMO courier pero de otro manifiesto hace fallar la operación entera'
);

select results_eq(
  $$ select a.orden_ruta
       from operacion.asignaciones_pedido a
      where a.pedido_id = 'aaaaaaaa-6666-0000-0000-0000000000d6' $$,
  $$ values (null::integer) $$,
  'OTRO MANIFIESTO: el pedido ajeno al manifiesto no recibió lugar'
);

-- Asignación SUPERADA: el pedido está en el manifiesto correcto y es del courier
-- correcto, pero su asignación ya no es la vigente. Tampoco entra.
select throws_ok(
  $$ select * from operacion.aplicar_secuencia_paradas(
       'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
       'aaaaaaaa-7777-0000-0000-0000000000d1'::uuid,
       array['aaaaaaaa-6666-0000-0000-0000000000d1',
             'aaaaaaaa-6666-0000-0000-0000000000d8']::uuid[],
       'manual',
       'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid) $$,
  'P0001',
  null,
  'ASIGNACIÓN SUPERADA: un pedido cuya asignación está inactiva tampoco entra a la secuencia'
);

select throws_ok(
  $$ select * from operacion.aplicar_secuencia_paradas(
       'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
       'aaaaaaaa-7777-0000-0000-0000000000d1'::uuid,
       array['aaaaaaaa-6666-0000-0000-0000000000d1',
             '00000000-0000-0000-0000-0000000000ff']::uuid[],
       'manual',
       'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid) $$,
  'P0001',
  null,
  'INEXISTENTE: un identificador que no existe se trata igual que uno ajeno — mismo error, sin decir cuál de los dos es'
);


-- =============================================================================
-- BLOQUE 8 · Parámetros y estado del manifiesto (5 tests)
-- =============================================================================
-- Los repetidos NO se filtran, se rechazan: `update ... from unnest` con un id
-- repetido aplicaría UNO de los dos lugares de forma no determinista y dejaría un
-- hueco sin que nada fallara.
select throws_ok(
  $$ select * from operacion.aplicar_secuencia_paradas(
       'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
       'aaaaaaaa-7777-0000-0000-0000000000d1'::uuid,
       array['aaaaaaaa-6666-0000-0000-0000000000d1',
             'aaaaaaaa-6666-0000-0000-0000000000d1',
             'aaaaaaaa-6666-0000-0000-0000000000d2']::uuid[],
       'manual',
       'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid) $$,
  '22023',
  null,
  'PARÁMETROS: un pedido repetido en la lista lanza 22023 (no se deduplica en silencio)'
);

select throws_ok(
  $$ select * from operacion.aplicar_secuencia_paradas(
       'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
       'aaaaaaaa-7777-0000-0000-0000000000d1'::uuid,
       array['aaaaaaaa-6666-0000-0000-0000000000d1', null]::uuid[],
       'manual',
       'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid) $$,
  '22023',
  null,
  'PARÁMETROS: un NULL dentro del arreglo lanza 22023 — filtrarlo correría todas las posiciones siguientes'
);

select throws_ok(
  $$ select * from operacion.aplicar_secuencia_paradas(
       'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
       'aaaaaaaa-7777-0000-0000-0000000000d1'::uuid,
       array['aaaaaaaa-6666-0000-0000-0000000000d1']::uuid[],
       'inventado',
       'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid) $$,
  '22023',
  null,
  'PARÁMETROS: un origen fuera de (motor, manual) lanza 22023 — la bitácora no acepta texto libre en ese campo'
);

select throws_ok(
  $$ select * from operacion.aplicar_secuencia_paradas(
       'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
       'aaaaaaaa-7777-0000-0000-0000000000d3'::uuid,
       array['aaaaaaaa-6666-0000-0000-0000000000d7']::uuid[],
       'manual',
       'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid) $$,
  '55000',
  null,
  'ESTADO: un manifiesto COMPLETADO ya no se rutea (rutear un día cerrado reescribiría historia)'
);

select throws_ok(
  $$ select * from operacion.aplicar_secuencia_paradas(
       'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
       'aaaaaaaa-7777-0000-0000-0000000000d4'::uuid,
       '{}'::uuid[],
       'manual',
       'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid) $$,
  '55000',
  null,
  'ESTADO: y un manifiesto CANCELADO tampoco'
);


-- =============================================================================
-- BLOQUE 9 · O SE APLICA ENTERA O NO SE APLICA NINGUNA (4 tests)
-- =============================================================================
-- ESTE ES EL BLOQUE POR EL QUE LA FUNCIÓN EXISTE. Escribir parada por parada
-- desde TypeScript —supabase-js no tiene transacciones, cada escritura es su
-- propio commit— dejaría, ante un fallo en la parada 4, un manifiesto con media
-- ruta nueva y media vieja. Peor: la función APAGA la secuencia vigente antes de
-- escribir la nueva, así que un fallo no atómico dejaría las CINCO paradas en
-- NULL, o sea el manifiesto SIN ruta y sin un error a la vista.
--
-- El fallo se INYECTA con un trigger de prueba que revienta cuando se escribe el
-- lugar 4. Es fault injection, no re-aplicación del DDL bajo prueba: el trigger
-- no toca una sola línea de lo que se está probando. Nótese que el trigger NO se
-- dispara en la pasada de limpieza (ahí `new.orden_ruta` es NULL), justo para que
-- el fallo caiga DESPUÉS de que la función ya destruyó la secuencia anterior.
create or replace function test_falla_al_escribir_lugar_4() returns trigger
language plpgsql
as $$
begin
  if new.orden_ruta = 4 then
    raise exception 'FALLO INYECTADO al escribir el lugar 4' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_test_falla_lugar_4
  before update on operacion.asignaciones_pedido
  for each row execute function test_falla_al_escribir_lugar_4();

select throws_ok(
  $$ select * from operacion.aplicar_secuencia_paradas(
       'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
       'aaaaaaaa-7777-0000-0000-0000000000d1'::uuid,
       array['aaaaaaaa-6666-0000-0000-0000000000d5',
             'aaaaaaaa-6666-0000-0000-0000000000d4',
             'aaaaaaaa-6666-0000-0000-0000000000d3',
             'aaaaaaaa-6666-0000-0000-0000000000d2',
             'aaaaaaaa-6666-0000-0000-0000000000d1']::uuid[],
       'manual',
       'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid) $$,
  'P0001',
  'FALLO INYECTADO al escribir el lugar 4',
  'ATOMICIDAD: el fallo a mitad de la secuencia sale a la superficie (no se traga en silencio)'
);

drop trigger trg_test_falla_lugar_4 on operacion.asignaciones_pedido;

-- LA PRUEBA DEL DEFECTO QUE ESTA FUNCIÓN VINO A MATAR: la secuencia ANTERIOR
-- sigue entera. La función ya la había apagado cuando reventó; sin atomicidad,
-- las cinco paradas estarían en NULL.
select results_eq(
  $$ select a.pedido_id, a.orden_ruta
       from operacion.asignaciones_pedido a
      where a.manifiesto_id = 'aaaaaaaa-7777-0000-0000-0000000000d1'
        and a.activa
      order by a.orden_ruta $$,
  $$ values ('aaaaaaaa-6666-0000-0000-0000000000d1'::uuid, 1),
            ('aaaaaaaa-6666-0000-0000-0000000000d2'::uuid, 2),
            ('aaaaaaaa-6666-0000-0000-0000000000d3'::uuid, 3),
            ('aaaaaaaa-6666-0000-0000-0000000000d4'::uuid, 4),
            ('aaaaaaaa-6666-0000-0000-0000000000d5'::uuid, 5) $$,
  'ATOMICIDAD: la secuencia anterior quedó ENTERA — el apagado previo también se deshizo, que es lo que un bucle sin transacción no puede prometer'
);

select is_empty($$
  select 1 from operacion.asignaciones_pedido a
   where a.manifiesto_id = 'aaaaaaaa-7777-0000-0000-0000000000d1'
     and a.activa
     and a.orden_ruta is null
$$, 'ATOMICIDAD: ni una sola parada quedó sin número tras el fallo');

select is_empty($$
  select 1 from identidad.bitacora_auditoria b
   where b.tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000d1'
     and b.accion    = 'manifiesto.secuencia_paradas_aplicada'
     and b.detalle ->> 'origen' = 'manual'
     and (b.detalle -> 'secuencia' ->> 0) = 'aaaaaaaa-6666-0000-0000-0000000000d5'
$$, 'ATOMICIDAD: la operación que falló NO dejó asiento — un asiento de una ruta que no se aplicó contaminaría la única evidencia que hay');


-- =============================================================================
-- BLOQUE 10 · La red del índice, medida de verdad (1 test)
-- =============================================================================
-- Hasta aquí la unicidad la garantizó la función. Esto comprueba que ADEMÁS hay
-- red en la base: si algún día otro camino escribiera la columna, dos paradas en
-- el mismo lugar se rechazan en el acto.
select throws_ok(
  $$ update operacion.asignaciones_pedido
        set orden_ruta = 1
      where pedido_id = 'aaaaaaaa-6666-0000-0000-0000000000d2'
        and activa $$,
  '23505',
  null,
  'ÍNDICE: escribir a mano un lugar ya ocupado del mismo manifiesto choca con el unique parcial (la invariante no depende solo de la función)'
);


-- =============================================================================
-- BLOQUE 11 · Bitácora — un asiento por operación, con autor (5 tests)
-- =============================================================================
-- Se aparta del patrón "bitácora ANTES del efecto" a propósito: esa regla protege
-- de efectos externos IRREVERSIBLES. Aquí todo es transaccional, así que la
-- atomicidad da una garantía más fuerte que el orden.
select results_eq(
  $$ select count(*)::int from identidad.bitacora_auditoria b
      where b.tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000d1'
        and b.accion    = 'manifiesto.secuencia_paradas_aplicada' $$,
  $$ values (5) $$,
  'BITÁCORA: exactamente 5 asientos del courier A (inicial, intercambio, subconjunto, vacío y reposición) — ni uno por parada, ni uno de los siete intentos que fallaron'
);

select results_eq(
  $$ select b.actor_usuario_id, b.actor_tipo::text, b.entidad_tipo, b.entidad_id,
            b.detalle ->> 'origen'
       from identidad.bitacora_auditoria b
      where b.tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000d1'
        and b.accion    = 'manifiesto.secuencia_paradas_aplicada'
        and b.detalle ->> 'origen' = 'manual'
        and (b.detalle ->> 'total_paradas')::int = 5 $$,
  $$ values ('aaaaaaaa-3333-0000-0000-0000000000d1'::uuid, 'usuario'::text,
             'manifiesto'::text, 'aaaaaaaa-7777-0000-0000-0000000000d1'::uuid, 'manual'::text) $$,
  'BITÁCORA: el asiento del reordenamiento manual lleva su actor (RNF-04 exige el "quién"), apunta al manifiesto y dice que fue MANUAL, no del motor'
);

-- La lista de pedidos SÍ viaja en el detalle, a diferencia de la etapa 6: aquí la
-- secuencia anterior LA DESTRUYE la siguiente escritura, así que si el asiento no
-- la guardara, "en qué orden iba el conductor" sería irrecuperable.
select results_eq(
  $$ select b.detalle -> 'secuencia'
       from identidad.bitacora_auditoria b
      where b.tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000d1'
        and b.accion    = 'manifiesto.secuencia_paradas_aplicada'
        and b.detalle ->> 'origen' = 'manual'
        and (b.detalle ->> 'total_paradas')::int = 5 $$,
  $$ values ('["aaaaaaaa-6666-0000-0000-0000000000d2",
              "aaaaaaaa-6666-0000-0000-0000000000d1",
              "aaaaaaaa-6666-0000-0000-0000000000d3",
              "aaaaaaaa-6666-0000-0000-0000000000d4",
              "aaaaaaaa-6666-0000-0000-0000000000d5"]'::jsonb) $$,
  'BITÁCORA: el detalle guarda la secuencia EN ORDEN — es el único sitio donde sobrevive la ruta que la siguiente escritura pisa'
);

select results_eq(
  $$ select b.actor_usuario_id, b.actor_tipo::text
       from identidad.bitacora_auditoria b
      where b.tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000d1'
        and b.accion    = 'manifiesto.secuencia_paradas_aplicada'
        and (b.detalle ->> 'total_paradas')::int = 3 $$,
  $$ values (null::uuid, 'sistema'::text) $$,
  'BITÁCORA: una corrida sin actor humano (job de service_role) queda como actor_tipo `sistema`, no como un usuario inventado'
);

select is_empty($$
  select 1 from identidad.bitacora_auditoria b
   where b.accion    = 'manifiesto.secuencia_paradas_aplicada'
     and b.tenant_id = 'bbbbbbbb-0000-0000-0000-0000000000d1'
     and b.entidad_id in (select m.id from operacion.manifiestos m
                           where m.tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000d1')
$$, 'AISLAMIENTO de la bitácora: el asiento del courier B no apunta a ningún manifiesto del courier A');


-- =============================================================================
-- BLOQUE 12 · Aislamiento de LECTURA — la secuencia hereda la RLS de la fila
--             (4 tests)
-- =============================================================================
-- `orden_ruta` es legible por `authenticated`, así que quien decide qué ve cada
-- actor es la política `asignaciones_pedido_select`: P1 tenant + (P2 seller OR P3
-- conductor). Se comprueba con las filas ya ruteadas, no en el vacío.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid,
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'conductor', 'conductor', null,
  'aaaaaaaa-2222-0000-0000-0000000000d1'::uuid
);

select results_eq(
  $$ select count(*)::int, count(a.orden_ruta)::int
       from public.asignaciones_pedido a
      where a.manifiesto_id = 'aaaaaaaa-7777-0000-0000-0000000000d1'
        and a.activa $$,
  $$ values (5, 5) $$,
  'LECTURA: el conductor D_A1 SÍ ve las 5 paradas de SU manifiesto, con su número de orden (control positivo)'
);

select test_cerrar_sesion();

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid,
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'conductor', 'conductor', null,
  'aaaaaaaa-2222-0000-0000-0000000000d2'::uuid
);

select is_empty($$
  select 1 from public.asignaciones_pedido a
   where a.manifiesto_id = 'aaaaaaaa-7777-0000-0000-0000000000d1'
$$, 'LECTURA: el conductor D_A2 no ve NI UNA fila del manifiesto de D_A1 — la ruta de un conductor no es visible para otro');

select test_cerrar_sesion();

-- El seller ve las paradas de SUS pedidos y solo esas, aunque compartan
-- manifiesto con las de otro seller del mismo courier.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000d1'::uuid,
  'aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,
  'seller', 'seller',
  'aaaaaaaa-1111-0000-0000-0000000000d2'::uuid
);

select results_eq(
  $$ select a.pedido_id, a.orden_ruta
       from public.asignaciones_pedido a
      where a.manifiesto_id = 'aaaaaaaa-7777-0000-0000-0000000000d1' $$,
  $$ values ('aaaaaaaa-6666-0000-0000-0000000000d4'::uuid, 4) $$,
  'LECTURA: el seller S_A2 solo ve SU parada del manifiesto compartido — las cuatro del seller S_A1 no existen para él'
);

select test_cerrar_sesion();

select test_iniciar_sesion(
  'bbbbbbbb-3333-0000-0000-0000000000d1'::uuid,
  'bbbbbbbb-0000-0000-0000-0000000000d1'::uuid,
  'interno', 'dueno'
);

select is_empty($$
  select 1 from public.asignaciones_pedido a
   where a.tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000d1'
$$, 'LECTURA: el dueño del courier B no ve ni una asignación del courier A — la secuencia no abre una ventana nueva entre tenants');

select test_cerrar_sesion();


select * from finish();

rollback;
