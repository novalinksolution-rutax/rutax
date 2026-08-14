-- =============================================================================
-- Pruebas — Asignación en bloque (etapa 6)
-- =============================================================================
-- Migración bajo prueba: 20260814000001_operacion_asignacion_en_bloque.sql
-- Diseño: docs/arquitectura/retiro-y-ruteo.md §4 · plan, etapa 6.
--
-- POR QUÉ ESTE ARCHIVO NO ES UN pgTAP DE POLÍTICAS: la función bajo prueba es
-- SECURITY DEFINER y ESCRIBE saltándose RLS. Aquí no hay ninguna política que
-- separe a un courier de otro: lo único que los separa es el `p_tenant_id`
-- escrito en el texto de la función. Si ese filtro faltara en un solo join, un
-- coordinador podría reasignarle a su conductor los pedidos de otro courier —
-- sin un error en ninguna parte y con el asiento de auditoría a nombre de la
-- víctima. Por eso el aislamiento cruzado se prueba en LAS DOS DIRECCIONES y con
-- los dos tenants SEMBRADOS: si el tenant B estuviera vacío, "A no toca nada de
-- B" pasaría por ausencia y no probaría nada.
--
-- Lo demás que se demuestra:
--   · LA REJA DE LA ETAPA: un pedido que nadie escaneó en bodega
--     (`situacion_retiro = 'pendiente'`) NO se asigna. Es una reja de dinero: un
--     seller despacha con varios couriers, y asignar un candidato ajeno termina
--     en un DTE por una entrega que hizo otro.
--   · La reasignación apaga la asignación anterior y deja EXACTAMENTE UNA activa
--     (el unique parcial `idx_asignaciones_pedido_activa_uk` es la invariante).
--   · `pedidos.driver_id_asignado` lo mueve el TRIGGER, no la función.
--   · El manifiesto es subproducto Y el invariante "uno vivo por conductor y día"
--     se CONSERVA: se reutiliza el del día si sigue vivo (borrador, confirmado o
--     en_ruta, el más reciente) y solo se abre uno nuevo tras un completado. Si se
--     partiera en dos, las paradas del primero desaparecerían de la app del
--     conductor —route.ts:37-45 y page.tsx se quedan con UNO, el más reciente—, en
--     plena calle y sin aviso.
--   · ROLLBACK TOTAL ante un fallo a mitad de lote — con fallo inyectado DESPUÉS
--     de que la función ya creó el manifiesto y ya apagó una asignación previa.
--     Es el defecto exacto que esta migración vino a matar: en el camino
--     TypeScript, si el pedido 200 fallaba, los 199 anteriores quedaban
--     aplicados y sin un solo asiento de auditoría.
--   · El asiento de bitácora existe, DENTRO de la transacción, con su actor.
--   · Reenviar el mismo lote es idempotente: 0 asignados, 0 filas nuevas.
--   · Ningún rol de cliente puede ejecutarla (catálogo Y comportamiento).
--   · Las tres piezas ajenas de las que la función depende siguen en pie, incluida
--     la AUSENCIA de un unique (tenant_id, driver_id, fecha_operacion) — que no es
--     un descuido del esquema sino el permiso para abrir un segundo manifiesto del
--     día cuando el primero ya salió a la calle.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(58);

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
-- Fixtures — DOS couriers, los dos con operación del MISMO día (2026-08-14)
--
-- Tenant A (aaaaaaaa…):
--   conductores  D_A1 (destino del lote, SIN manifiesto — lo tiene que crear)
--                D_A2 (tiene M_A2 en BORRADOR, con P_A5 asignado)
--                D_A3 (tiene M_A3 CONFIRMADO — el que ya salió a la calle)
--                D_A4 (sin manifiesto — escenario de rollback)
--   pedidos      P_A1 retirado · pendiente_asignacion          → se asigna
--                P_A2 retirado · pendiente_asignacion          → se asigna
--                P_A3 PENDIENTE · pendiente_asignacion         → LA REJA: se omite
--                P_A4 retirado · en_ruta                       → estado no asignable
--                P_A5 retirado · asignado, activo en M_A2      → se REASIGNA
--                P_A6 retirado · entregado                     → estado no asignable
--                P_A7 retirado · pendiente_asignacion          → rollback / actor nulo
--                P_A8 retirado · pendiente_asignacion          → manifiesto confirmado
--
-- Tenant B (bbbbbbbb…): D_B1 y P_B1 (retirado, asignable). Sembrado a propósito
--   para que el aislamiento se pruebe contra datos reales, no contra el vacío.
--
-- Lote principal a D_A1: [P_A1 P_A2 P_A3 P_A4 P_A5 P_A6 P_B1] = 7 solicitados
--   → 2 asignados · 1 reasignado · 4 omitidos
--     (no_retirado 1 · estado_no_asignable 2 · ya_en_manifiesto 0 · ajenos 1)
-- =============================================================================
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-0000000000b1';

  s_a1 uuid := 'aaaaaaaa-1111-0000-0000-0000000000a1';
  s_b1 uuid := 'bbbbbbbb-1111-0000-0000-0000000000b1';

  d_a1 uuid := 'aaaaaaaa-2222-0000-0000-0000000000a1';
  d_a2 uuid := 'aaaaaaaa-2222-0000-0000-0000000000a2';
  d_a3 uuid := 'aaaaaaaa-2222-0000-0000-0000000000a3';
  d_a4 uuid := 'aaaaaaaa-2222-0000-0000-0000000000a4';
  d_a5 uuid := 'aaaaaaaa-2222-0000-0000-0000000000a5';
  d_a6 uuid := 'aaaaaaaa-2222-0000-0000-0000000000a6';
  d_b1 uuid := 'bbbbbbbb-2222-0000-0000-0000000000b1';

  u_a uuid := 'aaaaaaaa-3333-0000-0000-0000000000a1';

  m_a2 uuid := 'aaaaaaaa-7777-0000-0000-0000000000a2';
  m_a3 uuid := 'aaaaaaaa-7777-0000-0000-0000000000a3';
  m_a5 uuid := 'aaaaaaaa-7777-0000-0000-0000000000a5';
  m_a6_viejo uuid := 'aaaaaaaa-7777-0000-0000-0000000000a6';
  m_a6_nuevo uuid := 'aaaaaaaa-7777-0000-0000-0000000000a7';

  p_a1 uuid := 'aaaaaaaa-6666-0000-0000-0000000000a1';
  p_a2 uuid := 'aaaaaaaa-6666-0000-0000-0000000000a2';
  p_a3 uuid := 'aaaaaaaa-6666-0000-0000-0000000000a3';
  p_a4 uuid := 'aaaaaaaa-6666-0000-0000-0000000000a4';
  p_a5 uuid := 'aaaaaaaa-6666-0000-0000-0000000000a5';
  p_a6 uuid := 'aaaaaaaa-6666-0000-0000-0000000000a6';
  p_a7 uuid := 'aaaaaaaa-6666-0000-0000-0000000000a7';
  p_a8 uuid := 'aaaaaaaa-6666-0000-0000-0000000000a8';
  p_a9 uuid := 'aaaaaaaa-6666-0000-0000-0000000000a9';
  p_aa uuid := 'aaaaaaaa-6666-0000-0000-0000000000aa';
  p_b1 uuid := 'bbbbbbbb-6666-0000-0000-0000000000b1';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier Bloque A', 'Courier Bloque A SpA', '76818081-1', 'activo'),
    (t_b, 'Courier Bloque B', 'Courier Bloque B SpA', '76818082-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          created_at, updated_at, raw_app_meta_data,
                          raw_user_meta_data, aud, role)
  values
    (u_a, 'interno.a@bloque.test', crypt('x', gen_salt('bf')), now(), now(), now(),
     '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a1, t_a, 'Seller Bloque A1', '77818081-1', 'Contacto A1', 'a1@bloque.test', 'activo'),
    (s_b1, t_b, 'Seller Bloque B1', '77818082-2', 'Contacto B1', 'b1@bloque.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values
    (d_a1, t_a, 'Conductor Bloque A1', '78818081-1', 'dependiente',   'activo'),
    (d_a2, t_a, 'Conductor Bloque A2', '78818082-2', 'independiente', 'activo'),
    (d_a3, t_a, 'Conductor Bloque A3', '78818083-3', 'dependiente',   'activo'),
    (d_a4, t_a, 'Conductor Bloque A4', '78818084-4', 'dependiente',   'activo'),
    (d_a5, t_a, 'Conductor Bloque A5', '78818086-6', 'dependiente',   'activo'),
    (d_a6, t_a, 'Conductor Bloque A6', '78818087-7', 'dependiente',   'activo'),
    (d_b1, t_b, 'Conductor Bloque B1', '78818085-5', 'dependiente',   'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_a, t_a, 'Interno Bloque A', 'interno', null, null, 'dueno', 'activo')
  on conflict (id) do nothing;

  -- ⚠️ `retirado_en` NULL en P_A3 no es descuido: el CHECK
  -- pedidos_retirado_en_coherente prohíbe una fecha de retiro en una fila que no
  -- está retirada.
  insert into operacion.pedidos (
    id, tenant_id, seller_id, tipo_pedido, origen, ml_shipment_id, estado,
    destinatario_nombre, destinatario_direccion, destinatario_comuna,
    situacion_retiro, retirado_en)
  values
    (p_a1, t_a, s_a1, 'flex', 'backfill', 'SHIPBLQA1', 'pendiente_asignacion',
     'Destinatario A1', 'Calle Bloque A 1', 'Maipu', 'retirado',  now()),
    (p_a2, t_a, s_a1, 'flex', 'backfill', 'SHIPBLQA2', 'pendiente_asignacion',
     'Destinatario A2', 'Calle Bloque A 2', 'Maipu', 'retirado',  now()),
    -- LA REJA: ingestado desde la cuenta de ML del seller, pero nadie lo escaneó.
    -- Puede perfectamente ser de otro courier.
    (p_a3, t_a, s_a1, 'flex', 'backfill', 'SHIPBLQA3', 'pendiente_asignacion',
     'Destinatario A3', 'Calle Bloque A 3', 'Maipu', 'pendiente', null),
    (p_a4, t_a, s_a1, 'flex', 'backfill', 'SHIPBLQA4', 'en_ruta',
     'Destinatario A4', 'Calle Bloque A 4', 'Maipu', 'retirado',  now()),
    (p_a5, t_a, s_a1, 'flex', 'backfill', 'SHIPBLQA5', 'asignado',
     'Destinatario A5', 'Calle Bloque A 5', 'Maipu', 'retirado',  now()),
    (p_a6, t_a, s_a1, 'flex', 'backfill', 'SHIPBLQA6', 'entregado',
     'Destinatario A6', 'Calle Bloque A 6', 'Maipu', 'retirado',  now()),
    (p_a7, t_a, s_a1, 'flex', 'backfill', 'SHIPBLQA7', 'pendiente_asignacion',
     'Destinatario A7', 'Calle Bloque A 7', 'Maipu', 'retirado',  now()),
    (p_a8, t_a, s_a1, 'flex', 'backfill', 'SHIPBLQA8', 'pendiente_asignacion',
     'Destinatario A8', 'Calle Bloque A 8', 'Maipu', 'retirado',  now()),
    (p_a9, t_a, s_a1, 'flex', 'backfill', 'SHIPBLQA9', 'pendiente_asignacion',
     'Destinatario A9', 'Calle Bloque A 9', 'Maipu', 'retirado',  now()),
    (p_aa, t_a, s_a1, 'flex', 'backfill', 'SHIPBLQAA', 'pendiente_asignacion',
     'Destinatario AA', 'Calle Bloque A 10', 'Maipu', 'retirado', now()),
    (p_b1, t_b, s_b1, 'flex', 'backfill', 'SHIPBLQB1', 'pendiente_asignacion',
     'Destinatario B1', 'Calle Bloque B 1', 'Vitacura', 'retirado', now())
  on conflict (id) do nothing;

  -- ⚠️ `creado_en` EXPLÍCITO en los dos borradores de D_A6: el criterio de
  -- desempate de la función es `creado_en desc` —el mismo que usan las dos
  -- pantallas del conductor— y sin fechas fijas la prueba dependería del orden
  -- físico de inserción, que no garantiza nada.
  insert into operacion.manifiestos
    (id, tenant_id, driver_id, nombre, fecha_operacion, estado, creado_por_usuario_id,
     confirmado_en, completado_en, creado_en)
  values
    (m_a2, t_a, d_a2, 'Manifiesto previo A2', date '2026-08-14', 'borrador', u_a,
     null, null, now()),
    -- El que YA SALIÓ A LA CALLE: la asignación tardía tiene que caer AQUÍ, no en
    -- una lista paralela que el conductor no ve.
    (m_a3, t_a, d_a3, 'Manifiesto confirmado A3', date '2026-08-14', 'confirmado', u_a,
     now(), null, now()),
    -- La primera vuelta YA CERRADA. Aquí sí corresponde abrir uno nuevo.
    (m_a5, t_a, d_a5, 'Manifiesto completado A5', date '2026-08-14', 'completado', u_a,
     now(), now(), now()),
    -- Dato HEREDADO: dos borradores vivos el mismo día. Gana el más reciente,
    -- porque es el que la app del conductor muestra.
    (m_a6_viejo, t_a, d_a6, 'Manifiesto A6 viejo', date '2026-08-14', 'borrador', u_a,
     null, null, timestamptz '2026-08-14 08:00:00+00'),
    (m_a6_nuevo, t_a, d_a6, 'Manifiesto A6 nuevo', date '2026-08-14', 'borrador', u_a,
     null, null, timestamptz '2026-08-14 11:00:00+00')
  on conflict (id) do nothing;

  -- La asignación vigente de P_A5 en el manifiesto de D_A2. Al insertarla,
  -- trg_asignaciones_sincronizar_driver_id deja pedidos.driver_id_asignado = D_A2:
  -- eso es lo que después tiene que MOVERSE solo a D_A1.
  insert into operacion.asignaciones_pedido
    (tenant_id, pedido_id, manifiesto_id, driver_id, seller_id, activa, asignado_por_usuario_id)
  values
    (t_a, p_a5, m_a2, d_a2, s_a1, true, u_a);
end $$;


-- =============================================================================
-- BLOQUE 0 · Privilegios — ningún rol de cliente la alcanza (5 tests)
-- =============================================================================
-- Es SECURITY DEFINER y ESCRIBE sin RLS. Si `authenticated` pudiera ejecutarla,
-- bastaría pasar el uuid de otro courier para reasignarle su operación del día.
select ok(
  not has_function_privilege(
    'authenticated',
    'operacion.asignar_pedidos_en_bloque(uuid,uuid,date,uuid[],uuid)',
    'EXECUTE'),
  'privilegios: authenticated NO puede ejecutar asignar_pedidos_en_bloque'
);

select ok(
  not has_function_privilege(
    'anon',
    'operacion.asignar_pedidos_en_bloque(uuid,uuid,date,uuid[],uuid)',
    'EXECUTE'),
  'privilegios: anon NO puede ejecutar asignar_pedidos_en_bloque'
);

select ok(
  has_function_privilege(
    'service_role',
    'operacion.asignar_pedidos_en_bloque(uuid,uuid,date,uuid[],uuid)',
    'EXECUTE'),
  'privilegios: service_role SÍ puede ejecutarla (control positivo — sin esto, un revoke de más dejaría la pantalla muerta)'
);

select ok(
  (select p.prosecdef
     from pg_proc p
    where p.oid = to_regprocedure('operacion.asignar_pedidos_en_bloque(uuid,uuid,date,uuid[],uuid)')::oid),
  'privilegios: la función es SECURITY DEFINER (su contrato es escribir sin RLS con el tenant por parámetro)'
);

-- Comportamiento real: ni el DUEÑO del courier, con su sesión bien formada, la alcanza.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-0000000000a1'::uuid,
  'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid,
  'interno', 'dueno'
);

select throws_ok(
  $$ select * from operacion.asignar_pedidos_en_bloque(
       'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid,
       'aaaaaaaa-2222-0000-0000-0000000000a1'::uuid,
       date '2026-08-14',
       array['aaaaaaaa-6666-0000-0000-0000000000a1']::uuid[],
       'aaaaaaaa-3333-0000-0000-0000000000a1'::uuid) $$,
  '42501',
  null,
  'privilegios: el dueño del courier recibe 42501 desde su propia sesión (la llama el servidor con service_role, nunca el cliente)'
);

select test_cerrar_sesion();


-- =============================================================================
-- BLOQUE 1 · Las piezas ajenas de las que la función depende (3 tests)
-- =============================================================================
-- LA MÁS IMPORTANTE Y LA MENOS OBVIA: NO puede existir un unique
-- (tenant_id, driver_id, fecha_operacion) en operacion.manifiestos. La función
-- necesita poder abrir un SEGUNDO manifiesto del día cuando el primero ya está
-- confirmado — un manifiesto confirmado ya salió a la calle y no se le inyectan
-- paradas por detrás. Si alguien "arregla" el esquema añadiendo esa constraint,
-- la asignación de la tarde empezaría a fallar con 23505 en producción.
--
-- Un unique PARCIAL (p. ej. where estado = 'borrador') sí sería compatible, así
-- que la prueba exige `indpred is null` para no fallar por algo que no rompe nada.
select is_empty($$
  select c.relname
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'operacion'
     and t.relname = 'manifiestos'
     and i.indisunique
     and i.indpred is null
     and (select array_agg(a.attname::text order by a.attname::text)
            from unnest(i.indkey) as k(attnum)
            join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum)
         = array['driver_id', 'fecha_operacion', 'tenant_id']::text[]
$$, 'esquema: NO existe un unique total (tenant_id, driver_id, fecha_operacion) en manifiestos — la función necesita abrir un segundo manifiesto del día cuando el primero ya está confirmado');

select isnt_empty($$
  select c.relname
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'operacion'
     and t.relname = 'asignaciones_pedido'
     and c.relname = 'idx_asignaciones_pedido_activa_uk'
     and i.indisunique
     and i.indpred is not null
$$, 'esquema: sigue el unique PARCIAL (pedido_id) where activa — la invariante "una sola asignación vigente por pedido" en la que se apoya la reasignación');

select isnt_empty($$
  select tg.tgname
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'operacion'
     and c.relname = 'asignaciones_pedido'
     and tg.tgname = 'trg_asignaciones_sincronizar_driver_id'
     and not tg.tgisinternal
$$, 'esquema: sigue el trigger que sincroniza pedidos.driver_id_asignado — la función NO escribe esa columna a propósito, y sin el trigger el conductor no vería ni uno de sus pedidos');


-- =============================================================================
-- BLOQUE 2 · Parámetros que hacen abortar antes de tocar nada (3 tests)
-- =============================================================================
-- El lote vacío se LANZA en vez de devolver "0 de 0": la pantalla no deja
-- seleccionar cero pedidos, así que un lote vacío es un defecto del llamador
-- (identificadores perdidos al serializar). Devolver ceros en silencio haría leer
-- "no seleccionaste nada" cuando en realidad se seleccionaron 30. Y evita el
-- efecto colateral peor: crear un manifiesto vacío.
select throws_ok(
  $$ select * from operacion.asignar_pedidos_en_bloque(
       'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid,
       'aaaaaaaa-2222-0000-0000-0000000000a1'::uuid,
       date '2026-08-14',
       '{}'::uuid[],
       'aaaaaaaa-3333-0000-0000-0000000000a1'::uuid) $$,
  '22023',
  null,
  'parámetros: un lote VACÍO lanza 22023 y no crea un manifiesto fantasma'
);

select throws_ok(
  $$ select * from operacion.asignar_pedidos_en_bloque(
       'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid,
       'aaaaaaaa-2222-0000-0000-0000000000a1'::uuid,
       date '2026-08-14',
       array[null, null]::uuid[],
       'aaaaaaaa-3333-0000-0000-0000000000a1'::uuid) $$,
  '22023',
  null,
  'parámetros: un lote de solo nulos también lanza 22023 (se filtran antes de contar)'
);

-- AISLAMIENTO: el conductor del courier B no es alcanzable desde el courier A, y
-- el error es el mismo que si no existiera — distinguirlos confirmaría que existe.
select throws_ok(
  $$ select * from operacion.asignar_pedidos_en_bloque(
       'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid,
       'bbbbbbbb-2222-0000-0000-0000000000b1'::uuid,
       date '2026-08-14',
       array['aaaaaaaa-6666-0000-0000-0000000000a1']::uuid[],
       'aaaaaaaa-3333-0000-0000-0000000000a1'::uuid) $$,
  'P0002',
  null,
  'AISLAMIENTO: el courier A no puede asignarle a un conductor del courier B (mismo error que si no existiera — no se confirma su existencia)'
);


-- =============================================================================
-- LA LLAMADA PRINCIPAL — se ejecuta UNA vez y se guarda para poder afirmarla varias
-- =============================================================================
create temp table resultado_principal as
select * from operacion.asignar_pedidos_en_bloque(
  'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid,
  'aaaaaaaa-2222-0000-0000-0000000000a1'::uuid,
  date '2026-08-14',
  array['aaaaaaaa-6666-0000-0000-0000000000a1',   -- se asigna
        'aaaaaaaa-6666-0000-0000-0000000000a2',   -- se asigna
        'aaaaaaaa-6666-0000-0000-0000000000a3',   -- LA REJA: no retirado
        'aaaaaaaa-6666-0000-0000-0000000000a4',   -- en_ruta
        'aaaaaaaa-6666-0000-0000-0000000000a5',   -- reasignación
        'aaaaaaaa-6666-0000-0000-0000000000a6',   -- entregado
        'bbbbbbbb-6666-0000-0000-0000000000b1'    -- de OTRO courier
       ]::uuid[],
  'aaaaaaaa-3333-0000-0000-0000000000a1'::uuid
);


-- =============================================================================
-- BLOQUE 3 · Lo que la pantalla lee: cifras y desglose (5 tests)
-- =============================================================================
select results_eq(
  $$ select total_solicitados, total_asignados, total_reasignados, total_omitidos
       from resultado_principal $$,
  $$ values (7, 2, 1, 4) $$,
  'cifras: 7 solicitados → 2 asignados, 1 reasignado, 4 omitidos'
);

select results_eq(
  $$ select omitidos_no_retirado, omitidos_estado_no_asignable,
            omitidos_ya_en_manifiesto, omitidos_ajenos
       from resultado_principal $$,
  $$ values (1, 2, 0, 1) $$,
  'desglose: 1 no retirado · 2 con estado no asignable · 0 ya en el manifiesto · 1 ajeno — un "28 de 30" sin decir qué pasó con los otros 2 obliga al coordinador a buscarlos a mano'
);

select ok(
  (select manifiesto_creado from resultado_principal),
  'manifiesto: se creó como SUBPRODUCTO de la asignación (D_A1 no tenía ninguno) — el coordinador ya no lo crea a mano'
);

-- El desglose trae IDENTIFICADORES, no solo cifras: es lo que permite marcarlos
-- en la lista en vez de obligar a buscarlos.
select results_eq(
  $$ select e.value ->> 'motivo'
       from resultado_principal r,
            jsonb_array_elements(r.omitidos_detalle) as e
      where e.value ->> 'pedido_id' = 'aaaaaaaa-6666-0000-0000-0000000000a3' $$,
  $$ values ('no_retirado'::text) $$,
  'desglose: el pedido que nadie escaneó sale nombrado con motivo `no_retirado`'
);

select results_eq(
  $$ select e.value ->> 'motivo'
       from resultado_principal r,
            jsonb_array_elements(r.omitidos_detalle) as e
      where e.value ->> 'pedido_id' = 'bbbbbbbb-6666-0000-0000-0000000000b1' $$,
  $$ values ('ajeno'::text) $$,
  'desglose: el pedido del otro courier sale como `ajeno` — se omite, nunca se lanza (un error distinto confirmaría que existe)'
);


-- =============================================================================
-- BLOQUE 4 · AISLAMIENTO CRUZADO — lo más importante del archivo (6 tests)
-- =============================================================================
select is_empty($$
  select 1 from operacion.asignaciones_pedido a
   where a.pedido_id = 'bbbbbbbb-6666-0000-0000-0000000000b1'
$$, 'AISLAMIENTO: el pedido del courier B NO recibió ninguna asignación en la llamada del courier A');

select results_eq(
  $$ select p.estado::text, p.driver_id_asignado
       from operacion.pedidos p
      where p.id = 'bbbbbbbb-6666-0000-0000-0000000000b1' $$,
  $$ values ('pendiente_asignacion'::text, null::uuid) $$,
  'AISLAMIENTO: el pedido del courier B conserva su estado y sigue sin conductor — la llamada ajena no lo movió ni un milímetro'
);

select is_empty($$
  select 1
    from operacion.asignaciones_pedido a
    join operacion.pedidos p on p.id = a.pedido_id
   where a.manifiesto_id = (select manifiesto_id from resultado_principal)
     and p.tenant_id <> 'aaaaaaaa-0000-0000-0000-0000000000a1'
$$, 'AISLAMIENTO: ni una sola fila del manifiesto creado por A apunta a un pedido de otro tenant');

select is_empty($$
  select 1 from operacion.manifiestos m
   where m.id = (select manifiesto_id from resultado_principal)
     and m.tenant_id <> 'aaaaaaaa-0000-0000-0000-0000000000a1'
$$, 'AISLAMIENTO: el manifiesto creado quedó en el tenant que hizo la llamada');

-- EL ESPEJO. Una condición mal escrita puede aislar en un sentido y filtrar en el
-- otro, y solo esta mitad lo detecta. Va con actor NULL a propósito: es el camino
-- de un job de service_role sin sesión humana.
create temp table resultado_espejo as
select * from operacion.asignar_pedidos_en_bloque(
  'bbbbbbbb-0000-0000-0000-0000000000b1'::uuid,
  'bbbbbbbb-2222-0000-0000-0000000000b1'::uuid,
  date '2026-08-14',
  array['aaaaaaaa-6666-0000-0000-0000000000a1',   -- del courier A
        'bbbbbbbb-6666-0000-0000-0000000000b1'    -- suyo
       ]::uuid[],
  null
);

select results_eq(
  $$ select total_solicitados, total_asignados, total_omitidos, omitidos_ajenos
       from resultado_espejo $$,
  $$ values (2, 1, 1, 1) $$,
  'AISLAMIENTO (espejo): el courier B asigna solo el suyo y omite como ajeno el del courier A'
);

-- Y lo decisivo: el pedido de A NO cambió de manos.
select results_eq(
  $$ select a.manifiesto_id = (select manifiesto_id from resultado_principal),
            a.driver_id
       from operacion.asignaciones_pedido a
      where a.pedido_id = 'aaaaaaaa-6666-0000-0000-0000000000a1'
        and a.activa $$,
  $$ values (true, 'aaaaaaaa-2222-0000-0000-0000000000a1'::uuid) $$,
  'AISLAMIENTO (espejo): el pedido del courier A sigue en el manifiesto de A y con el conductor de A — la llamada del courier B no se lo llevó'
);


-- =============================================================================
-- BLOQUE 5 · LA REJA DE LA ETAPA: solo se asigna lo retirado (3 tests)
-- =============================================================================
-- Un seller despacha con VARIOS couriers: la ingesta de ML trae CANDIDATOS y solo
-- el escaneo en bodega dice cuáles son de este courier. Sin esta reja se emiten
-- cobros con DTE por entregas que hizo otro (20260812000002).
select is_empty($$
  select 1 from operacion.asignaciones_pedido a
   where a.pedido_id = 'aaaaaaaa-6666-0000-0000-0000000000a3'
$$, 'REJA: el pedido que nadie escaneó en bodega NO recibió asignación');

select results_eq(
  $$ select p.estado::text, p.driver_id_asignado, p.situacion_retiro::text
       from operacion.pedidos p
      where p.id = 'aaaaaaaa-6666-0000-0000-0000000000a3' $$,
  $$ values ('pendiente_asignacion'::text, null::uuid, 'pendiente'::text) $$,
  'REJA: y sigue intacto — pendiente_asignacion, sin conductor y sin retirar'
);

-- Los dos con estado fuera de la bandeja tampoco entraron.
select is_empty($$
  select 1 from operacion.asignaciones_pedido a
   where a.pedido_id in ('aaaaaaaa-6666-0000-0000-0000000000a4',
                         'aaaaaaaa-6666-0000-0000-0000000000a6')
$$, 'estado: ni el `en_ruta` ni el `entregado` recibieron asignación, aunque los dos estén retirados');


-- =============================================================================
-- BLOQUE 6 · Reasignación — la anterior se apaga y el unique parcial se respeta
--            (5 tests)
-- =============================================================================
select results_eq(
  $$ select count(*)::int from operacion.asignaciones_pedido a
      where a.pedido_id = 'aaaaaaaa-6666-0000-0000-0000000000a5'
        and a.activa $$,
  $$ values (1) $$,
  'REASIGNACIÓN: queda EXACTAMENTE UNA asignación activa para el pedido reasignado (el unique parcial es la invariante dura)'
);

select results_eq(
  $$ select a.manifiesto_id = (select manifiesto_id from resultado_principal), a.driver_id
       from operacion.asignaciones_pedido a
      where a.pedido_id = 'aaaaaaaa-6666-0000-0000-0000000000a5'
        and a.activa $$,
  $$ values (true, 'aaaaaaaa-2222-0000-0000-0000000000a1'::uuid) $$,
  'REASIGNACIÓN: la activa es la nueva — manifiesto nuevo y conductor nuevo'
);

select results_eq(
  $$ select a.activa, a.desasignado_en is not null
       from operacion.asignaciones_pedido a
      where a.pedido_id = 'aaaaaaaa-6666-0000-0000-0000000000a5'
        and a.manifiesto_id = 'aaaaaaaa-7777-0000-0000-0000000000a2' $$,
  $$ values (false, true) $$,
  'REASIGNACIÓN: la anterior quedó apagada CON su desasignado_en — el historial se conserva, no se borra'
);

-- Lo que NO escribe la función: driver_id_asignado. Lo mueve el trigger.
select results_eq(
  $$ select p.driver_id_asignado from operacion.pedidos p
      where p.id = 'aaaaaaaa-6666-0000-0000-0000000000a5' $$,
  $$ values ('aaaaaaaa-2222-0000-0000-0000000000a1'::uuid) $$,
  'REASIGNACIÓN: pedidos.driver_id_asignado pasó de D_A2 a D_A1 — lo movió el TRIGGER, no la función (que no toca esa columna)'
);

-- Los recién asignados suben de estado; el que ya estaba `asignado` no se toca.
select results_eq(
  $$ select p.id, p.estado::text
       from operacion.pedidos p
      where p.id in ('aaaaaaaa-6666-0000-0000-0000000000a1',
                     'aaaaaaaa-6666-0000-0000-0000000000a2',
                     'aaaaaaaa-6666-0000-0000-0000000000a5')
      order by p.id $$,
  $$ values ('aaaaaaaa-6666-0000-0000-0000000000a1'::uuid, 'asignado'::text),
            ('aaaaaaaa-6666-0000-0000-0000000000a2'::uuid, 'asignado'::text),
            ('aaaaaaaa-6666-0000-0000-0000000000a5'::uuid, 'asignado'::text) $$,
  'estado: los dos nuevos suben de pendiente_asignacion a asignado; el reasignado ya estaba asignado y ahí sigue'
);


-- =============================================================================
-- BLOQUE 7 · Idempotencia — reenviar el mismo lote no duplica ni recuenta
--            (3 tests)
-- =============================================================================
create temp table resultado_repetido as
select * from operacion.asignar_pedidos_en_bloque(
  'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid,
  'aaaaaaaa-2222-0000-0000-0000000000a1'::uuid,
  date '2026-08-14',
  array['aaaaaaaa-6666-0000-0000-0000000000a1',
        'aaaaaaaa-6666-0000-0000-0000000000a2',
        'aaaaaaaa-6666-0000-0000-0000000000a3',
        'aaaaaaaa-6666-0000-0000-0000000000a4',
        'aaaaaaaa-6666-0000-0000-0000000000a5',
        'aaaaaaaa-6666-0000-0000-0000000000a6',
        'bbbbbbbb-6666-0000-0000-0000000000b1'
       ]::uuid[],
  'aaaaaaaa-3333-0000-0000-0000000000a1'::uuid
);

select results_eq(
  $$ select total_asignados, total_reasignados, omitidos_ya_en_manifiesto, manifiesto_creado
       from resultado_repetido $$,
  $$ values (0, 0, 3, false) $$,
  'IDEMPOTENCIA: el mismo lote otra vez no asigna nada, no reasigna nada, y los 3 caen en `ya_en_manifiesto` sin crear otro manifiesto'
);

select results_eq(
  $$ select r.manifiesto_id = (select manifiesto_id from resultado_principal)
       from resultado_repetido r $$,
  $$ values (true) $$,
  'IDEMPOTENCIA: se reutiliza el MISMO manifiesto borrador del día, no se abre otro'
);

select results_eq(
  $$ select count(*)::int from operacion.asignaciones_pedido a
      where a.tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000a1'
        and a.activa $$,
  $$ values (3) $$,
  'IDEMPOTENCIA: siguen habiendo 3 asignaciones activas en el courier A — ni una fila duplicada'
);


-- =============================================================================
-- BLOQUE 8 · Búsqueda-o-creación del manifiesto del día (11 tests)
-- =============================================================================
-- LA REGLA, Y POR QUÉ ES ASÍ: se reutiliza el manifiesto del día si sigue VIVO
-- (borrador, confirmado o en_ruta) y solo se crea uno nuevo si no hay ninguno o si
-- el que hay ya está completado/cancelado.
--
-- El motivo está verificado en el código de producción, no es preferencia de
-- diseño: `src/app/api/conductor/manifiesto/route.ts:37-45` (la app nativa) y
-- `src/app/conductor/manifiesto/page.tsx` (la PWA) piden los manifiestos del día y
-- se quedan con UNO SOLO, el más reciente por `creado_en`. En cuanto existiera un
-- segundo manifiesto del día, LAS PARADAS DEL PRIMERO DESAPARECERÍAN DE LA APP DEL
-- CONDUCTOR, en plena calle y sin ningún aviso. Por eso la función conserva el
-- invariante "un manifiesto vivo por conductor y día" en vez de romperlo.

-- -----------------------------------------------------------------------------
-- 8.a · Manifiesto CONFIRMADO: se reutiliza. La asignación tardía es legítima —
--       el coordinador reparte por lotes toda la mañana y el corte es a las 16:00.
-- -----------------------------------------------------------------------------
create temp table resultado_confirmado as
select * from operacion.asignar_pedidos_en_bloque(
  'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid,
  'aaaaaaaa-2222-0000-0000-0000000000a3'::uuid,
  date '2026-08-14',
  array['aaaaaaaa-6666-0000-0000-0000000000a8']::uuid[],
  'aaaaaaaa-3333-0000-0000-0000000000a1'::uuid
);

select ok(
  not (select manifiesto_creado from resultado_confirmado),
  'manifiesto CONFIRMADO: se REUTILIZA, no se abre uno nuevo — un segundo manifiesto haría desaparecer de la app las paradas del primero'
);

select results_eq(
  $$ select manifiesto_id from resultado_confirmado $$,
  $$ values ('aaaaaaaa-7777-0000-0000-0000000000a3'::uuid) $$,
  'manifiesto CONFIRMADO: el manifiesto devuelto es exactamente el que ya estaba confirmado'
);

select results_eq(
  $$ select a.pedido_id, a.activa
       from operacion.asignaciones_pedido a
      where a.manifiesto_id = 'aaaaaaaa-7777-0000-0000-0000000000a3' $$,
  $$ values ('aaaaaaaa-6666-0000-0000-0000000000a8'::uuid, true) $$,
  'manifiesto CONFIRMADO: la parada tardía entró en la lista que el conductor YA tiene abierta'
);

select results_eq(
  $$ select count(*)::int from operacion.manifiestos m
      where m.tenant_id       = 'aaaaaaaa-0000-0000-0000-0000000000a1'
        and m.driver_id       = 'aaaaaaaa-2222-0000-0000-0000000000a3'
        and m.fecha_operacion = date '2026-08-14' $$,
  $$ values (1) $$,
  'manifiesto CONFIRMADO: el conductor sigue con UN SOLO manifiesto del día — el invariante que toda la lectura de aguas abajo ya asume queda conservado'
);

-- Reutilizarlo no lo devuelve a borrador: sigue siendo el documento confirmado.
select results_eq(
  $$ select m.estado::text, m.confirmado_en is not null
       from operacion.manifiestos m
      where m.id = 'aaaaaaaa-7777-0000-0000-0000000000a3' $$,
  $$ values ('confirmado'::text, true) $$,
  'manifiesto CONFIRMADO: agregarle una parada NO le cambia el estado ni le borra el confirmado_en'
);

-- -----------------------------------------------------------------------------
-- 8.b · Manifiesto COMPLETADO: la primera vuelta ya cerró, así que aquí SÍ se abre
--       uno nuevo. Es una segunda vuelta genuina y separarlas es lo correcto.
-- -----------------------------------------------------------------------------
create temp table resultado_completado as
select * from operacion.asignar_pedidos_en_bloque(
  'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid,
  'aaaaaaaa-2222-0000-0000-0000000000a5'::uuid,
  date '2026-08-14',
  array['aaaaaaaa-6666-0000-0000-0000000000a9']::uuid[],
  'aaaaaaaa-3333-0000-0000-0000000000a1'::uuid
);

select ok(
  (select manifiesto_creado from resultado_completado),
  'manifiesto COMPLETADO: se abre uno NUEVO — la primera vuelta ya cerró y mezclarlas falsearía el documento cerrado'
);

select results_eq(
  $$ select r.manifiesto_id <> 'aaaaaaaa-7777-0000-0000-0000000000a5'
       from resultado_completado r $$,
  $$ values (true) $$,
  'manifiesto COMPLETADO: el devuelto NO es el que ya estaba cerrado'
);

select is_empty($$
  select 1 from operacion.asignaciones_pedido a
   where a.manifiesto_id = 'aaaaaaaa-7777-0000-0000-0000000000a5'
$$, 'manifiesto COMPLETADO: al cerrado no se le agregó ni una parada');

select results_eq(
  $$ select count(*)::int from operacion.manifiestos m
      where m.tenant_id       = 'aaaaaaaa-0000-0000-0000-0000000000a1'
        and m.driver_id       = 'aaaaaaaa-2222-0000-0000-0000000000a5'
        and m.fecha_operacion = date '2026-08-14' $$,
  $$ values (2) $$,
  'manifiesto COMPLETADO: quedan dos manifiestos del día, y por eso NO puede existir un unique (tenant, driver, fecha) — la segunda vuelta lo necesita'
);

-- -----------------------------------------------------------------------------
-- 8.c · Dos manifiestos vivos heredados: gana el MÁS RECIENTE, que es justo el que
--       la app del conductor muestra. Si la función tomara el más antiguo, estaría
--       escribiendo en el que nadie mira.
-- -----------------------------------------------------------------------------
create temp table resultado_heredado as
select * from operacion.asignar_pedidos_en_bloque(
  'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid,
  'aaaaaaaa-2222-0000-0000-0000000000a6'::uuid,
  date '2026-08-14',
  array['aaaaaaaa-6666-0000-0000-0000000000aa']::uuid[],
  'aaaaaaaa-3333-0000-0000-0000000000a1'::uuid
);

select results_eq(
  $$ select manifiesto_id, manifiesto_creado from resultado_heredado $$,
  $$ values ('aaaaaaaa-7777-0000-0000-0000000000a7'::uuid, false) $$,
  'manifiesto HEREDADO: con dos borradores vivos gana el MÁS RECIENTE por creado_en — el mismo criterio que usan las dos pantallas del conductor, para que las dos mitades coincidan'
);

select results_eq(
  $$ select count(*)::int from operacion.manifiestos m
      where m.tenant_id       = 'aaaaaaaa-0000-0000-0000-0000000000a1'
        and m.driver_id       = 'aaaaaaaa-2222-0000-0000-0000000000a6'
        and m.fecha_operacion = date '2026-08-14' $$,
  $$ values (2) $$,
  'manifiesto HEREDADO: no se abrió un tercero — la función consolida sobre lo que ya existe'
);


-- =============================================================================
-- BLOQUE 9 · ROLLBACK TOTAL ante un fallo a mitad de lote (8 tests)
-- =============================================================================
-- ESTE ES EL BLOQUE POR EL QUE LA FUNCIÓN EXISTE. En el camino TypeScript, cada
-- pedido eran hasta 3 escrituras con su propio commit: si el 200 fallaba, los 199
-- anteriores quedaban aplicados y la bitácora —que se escribía DESPUÉS del bucle—
-- no dejaba ni un asiento de esa asignación partida a la mitad.
--
-- El fallo se INYECTA con un trigger de prueba que revienta al insertar la
-- asignación del último pedido del lote. Es fault injection, no re-aplicación del
-- DDL bajo prueba: el trigger no toca ni una línea de lo que se está probando, y
-- la única forma de que el fallo caiga DESPUÉS de que la función ya creó el
-- manifiesto y ya apagó una asignación previa.
create or replace function test_falla_inyectada() returns trigger
language plpgsql
as $$
begin
  if new.pedido_id = 'aaaaaaaa-6666-0000-0000-0000000000a7'::uuid then
    raise exception 'FALLO INYECTADO a mitad de lote' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_test_falla_inyectada
  before insert on operacion.asignaciones_pedido
  for each row execute function test_falla_inyectada();

-- El lote a D_A4 (que NO tiene manifiesto): P_A1 viene ACTIVO en el manifiesto de
-- D_A1, así que la función tiene que (1) crear manifiesto, (2) apagar la
-- asignación de P_A1 y (3) insertar las dos nuevas — y ahí revienta.
select throws_ok(
  $$ select * from operacion.asignar_pedidos_en_bloque(
       'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid,
       'aaaaaaaa-2222-0000-0000-0000000000a4'::uuid,
       date '2026-08-14',
       array['aaaaaaaa-6666-0000-0000-0000000000a1',
             'aaaaaaaa-6666-0000-0000-0000000000a7']::uuid[],
       'aaaaaaaa-3333-0000-0000-0000000000a1'::uuid) $$,
  'P0001',
  'FALLO INYECTADO a mitad de lote',
  'ROLLBACK: el fallo inyectado en la última fila del lote sale a la superficie (no se traga en silencio)'
);

drop trigger trg_test_falla_inyectada on operacion.asignaciones_pedido;

-- (1) El manifiesto creado por la llamada que falló NO existe.
select is_empty($$
  select 1 from operacion.manifiestos m
   where m.tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000a1'
     and m.driver_id = 'aaaaaaaa-2222-0000-0000-0000000000a4'
$$, 'ROLLBACK: no quedó ningún manifiesto fantasma del conductor cuyo lote falló — el subproducto también se deshace');

-- (2) LA PRUEBA DEL DEFECTO ORIGINAL: la asignación que la función YA HABÍA
--     APAGADO antes de reventar sigue viva. En el camino TypeScript, ese apagado
--     era un commit y quedaba aplicado para siempre.
select results_eq(
  $$ select a.activa, a.desasignado_en is null,
            a.manifiesto_id = (select manifiesto_id from resultado_principal)
       from operacion.asignaciones_pedido a
      where a.pedido_id = 'aaaaaaaa-6666-0000-0000-0000000000a1'
        and a.activa $$,
  $$ values (true, true, true) $$,
  'ROLLBACK: la asignación que la función ya había APAGADO antes de fallar sigue activa, sin desasignado_en y en su manifiesto original — esto es exactamente lo que el bucle sin transacción dejaba roto'
);

select results_eq(
  $$ select count(*)::int from operacion.asignaciones_pedido a
      where a.pedido_id = 'aaaaaaaa-6666-0000-0000-0000000000a1' $$,
  $$ values (1) $$,
  'ROLLBACK: y no quedó ninguna fila de asignación a medio escribir para ese pedido'
);

-- (3) El pedido que iba a estrenar asignación quedó como estaba.
select is_empty($$
  select 1 from operacion.asignaciones_pedido a
   where a.pedido_id = 'aaaaaaaa-6666-0000-0000-0000000000a7'
$$, 'ROLLBACK: el pedido nuevo del lote no quedó asignado');

select results_eq(
  $$ select p.estado::text, p.driver_id_asignado
       from operacion.pedidos p
      where p.id = 'aaaaaaaa-6666-0000-0000-0000000000a7' $$,
  $$ values ('pendiente_asignacion'::text, null::uuid) $$,
  'ROLLBACK: y su estado no se movió'
);

-- (4) Un actor que no existe en auth.users tumba el lote entero por FK, y también
--     se deshace todo. Es el caso real de un llamador que manda un uuid inventado:
--     una asignación sin autor rastreable no es una asignación auditable.
select throws_ok(
  $$ select * from operacion.asignar_pedidos_en_bloque(
       'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid,
       'aaaaaaaa-2222-0000-0000-0000000000a2'::uuid,
       date '2026-08-14',
       array['aaaaaaaa-6666-0000-0000-0000000000a1',
             'aaaaaaaa-6666-0000-0000-0000000000a7']::uuid[],
       '00000000-0000-0000-0000-0000000000ff'::uuid) $$,
  '23503',
  null,
  'ROLLBACK: un actor que no existe en auth.users hace fallar el lote entero por FK (no se asigna nada sin autor rastreable)'
);

select results_eq(
  $$ select a.activa, a.manifiesto_id = (select manifiesto_id from resultado_principal)
       from operacion.asignaciones_pedido a
      where a.pedido_id = 'aaaaaaaa-6666-0000-0000-0000000000a1'
        and a.activa $$,
  $$ values (true, true) $$,
  'ROLLBACK: tras el fallo por actor inexistente, el pedido sigue exactamente donde estaba'
);


-- =============================================================================
-- BLOQUE 10 · Bitácora — dentro de la transacción, un asiento por lote, con autor
--             (6 tests)
-- =============================================================================
-- Se aparta del patrón "bitácora ANTES del efecto" de CLAUDE.md a propósito: esa
-- regla protege de efectos externos IRREVERSIBLES (un evento Inngest, una llamada
-- a un tercero). Aquí todo es transaccional, así que la atomicidad da una garantía
-- más fuerte que el orden — y un asiento de una asignación que no ocurrió sería
-- peor que no tenerlo.
select results_eq(
  $$ select count(*)::int from identidad.bitacora_auditoria b
      where b.tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000a1'
        and b.accion    = 'manifiesto.pedidos_asignados_en_bloque' $$,
  $$ values (5) $$,
  'BITÁCORA: hay UN asiento por lote aplicado (principal, repetido, confirmado, completado y heredado) — ni uno por pedido, ni uno por los dos lotes que fallaron'
);

select results_eq(
  $$ select b.actor_usuario_id, b.actor_tipo::text, b.entidad_tipo
       from identidad.bitacora_auditoria b
      where b.tenant_id  = 'aaaaaaaa-0000-0000-0000-0000000000a1'
        and b.accion     = 'manifiesto.pedidos_asignados_en_bloque'
        and b.entidad_id = (select manifiesto_id from resultado_principal)
        and (b.detalle ->> 'total_asignados')::int = 2 $$,
  $$ values ('aaaaaaaa-3333-0000-0000-0000000000a1'::uuid, 'usuario'::text, 'manifiesto'::text) $$,
  'BITÁCORA: el asiento del lote principal lleva su actor (RNF-04 exige el "quién") y apunta al manifiesto'
);

select results_eq(
  $$ select (b.detalle ->> 'total_solicitados')::int,
            (b.detalle ->> 'total_asignados')::int,
            (b.detalle ->> 'total_reasignados')::int,
            (b.detalle ->> 'omitidos_no_retirado')::int,
            (b.detalle ->> 'omitidos_ajenos')::int,
            (b.detalle ->> 'manifiesto_creado')::boolean
       from identidad.bitacora_auditoria b
      where b.tenant_id  = 'aaaaaaaa-0000-0000-0000-0000000000a1'
        and b.accion     = 'manifiesto.pedidos_asignados_en_bloque'
        and b.entidad_id = (select manifiesto_id from resultado_principal)
        and (b.detalle ->> 'total_asignados')::int = 2 $$,
  $$ values (7, 2, 1, 1, 1, true) $$,
  'BITÁCORA: el detalle guarda las CIFRAS del lote, incluidas las de los omitidos — el rastro fino por pedido ya vive en asignaciones_pedido'
);

-- LA MITAD QUE PRUEBA LA ATOMICIDAD DE LA AUDITORÍA: los dos lotes que fallaron
-- no dejaron asiento. Un asiento de una asignación que no ocurrió contaminaría la
-- única evidencia que hay.
select is_empty($$
  select 1 from identidad.bitacora_auditoria b
   where b.tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000a1'
     and b.accion    = 'manifiesto.pedidos_asignados_en_bloque'
     and b.detalle ->> 'driver_id' in ('aaaaaaaa-2222-0000-0000-0000000000a4',
                                       'aaaaaaaa-2222-0000-0000-0000000000a2')
$$, 'BITÁCORA: los dos lotes que fallaron NO dejaron asiento — el asiento va dentro de la transacción, así que se deshace con todo lo demás');

-- El camino de un job sin sesión humana: actor NULL → actor_tipo `sistema`.
select results_eq(
  $$ select b.actor_usuario_id, b.actor_tipo::text
       from identidad.bitacora_auditoria b
      where b.tenant_id = 'bbbbbbbb-0000-0000-0000-0000000000b1'
        and b.accion    = 'manifiesto.pedidos_asignados_en_bloque' $$,
  $$ values (null::uuid, 'sistema'::text) $$,
  'BITÁCORA: un lote sin actor humano (job de service_role) queda como actor_tipo `sistema`, no como un usuario inventado'
);

-- Y el asiento del courier B es del courier B: la bitácora también se aísla.
select is_empty($$
  select 1 from identidad.bitacora_auditoria b
   where b.accion    = 'manifiesto.pedidos_asignados_en_bloque'
     and b.tenant_id = 'bbbbbbbb-0000-0000-0000-0000000000b1'
     and b.entidad_id in (select m.id from operacion.manifiestos m
                           where m.tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000a1')
$$, 'AISLAMIENTO de la bitácora: el asiento del courier B no apunta a ningún manifiesto del courier A');


select * from finish();

rollback;
