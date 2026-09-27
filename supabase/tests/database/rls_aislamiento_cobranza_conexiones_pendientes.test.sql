-- =============================================================================
-- Cobranza Fintoc — el nonce del webhook `link.created`: deny-all, uso único
-- =============================================================================
-- Migración probada:
--   20260926000001_identidad_cobranza_conexiones_pendientes.sql
--
-- Contexto: el webhook que trae el `link_token` llega SIN `Fintoc-Signature`
-- (verificado en producción), así que la ÚNICA barrera entre un POST anónimo y
-- la conexión bancaria del courier es este nonce. Lo que sigue prueba que la
-- barrera la impone la BASE y no el código de aplicación.
--
-- Qué fija este archivo, en orden de importancia:
--
--   1. DENY-ALL CON 42501 EXPLÍCITO. Ni el dueño del courier ni el seller ni
--      `anon` alcanzan la tabla. Se prueba con el CÓDIGO DE ERROR y no con «0
--      filas»: si el revoke se perdiera y quedara solo RLS sin políticas, un
--      SELECT devolvería cero filas y una prueba por conteo pasaría en verde
--      sin proteger nada. Leer esta tabla sería leer el ticket vivo de otro.
--
--   2. UN SOLO TICKET VIVO POR COURIER. El índice único parcial rechaza el
--      segundo `pendiente` del mismo tenant (23505) — dos nonces vigentes son
--      dos llaves, y el webhook no tendría con qué decidir cuál consumir.
--      Con su contraprueba: consumir/expirar el primero SÍ libera el hueco, y
--      OTRO courier puede tener el suyo al mismo tiempo.
--
--   3. EL CHECK DE `estado` RECHAZA DE VERDAD, con su aceptación al lado. Un
--      CHECK mal escrito que rechaza TODO pasaría en verde con solo la mitad
--      negativa (la lección del pgTAP que reponía el CHECK dentro del test).
--
--   4. EL VENCIMIENTO EXISTE SIN QUE NADIE LO CALCULE. Una fila insertada sin
--      tocar `expira_en` nace vencida a los 15 minutos, no eterna.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(34);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada (cada .test.sql corre en su propia transacción)
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

-- -----------------------------------------------------------------------------
-- Fixtures — dos couriers, para poder probar que el tope de «un pendiente» es
-- POR TENANT y no global (un índice único sin la columna tenant_id dejaría al
-- segundo courier sin poder conectar su banco mientras el primero está a medias).
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-00000000f1a1';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-00000000f1b2';
  s_a uuid := 'aaaaaaaa-1111-0000-0000-00000000f1a1';
  u_interno_a uuid := 'aaaaaaaa-3333-0000-0000-00000000f1a1';
  u_seller_a  uuid := 'aaaaaaaa-3333-0000-0000-00000000f1a3';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier FIN A', 'Courier FIN A SpA', '76771111-1', 'activo'),
    (t_b, 'Courier FIN B', 'Courier FIN B SpA', '76772222-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_interno_a, 'interno.a@fintoc.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,  'seller.a@fintoc.test',  crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values (s_a, t_a, 'Seller FIN A', '77771111-1', 'Contacto A', 'a@fintoc.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a, t_a, 'Interno A', 'interno', null, null, 'dueno',  'activo'),
    (u_seller_a,  t_a, 'Seller A',  'seller',  s_a,  null, 'seller', 'activo')
  on conflict (id) do nothing;
end $$;

-- =============================================================================
-- BLOQUE 0 · Contrato de esquema
-- =============================================================================

select has_table('identidad', 'cobranza_conexiones_pendientes',
  'esquema: existe identidad.cobranza_conexiones_pendientes');

select hasnt_view('public', 'cobranza_conexiones_pendientes',
  'esquema: NO hay vista espejo en public — PostgREST no tiene por dónde entrar');

select col_not_null('identidad', 'cobranza_conexiones_pendientes', 'tenant_id',
  'esquema: tenant_id es NOT NULL — tabla de negocio, no hay ticket sin dueño');

select col_is_fk('identidad', 'cobranza_conexiones_pendientes', 'tenant_id',
  'esquema: tenant_id es FK a identidad.tenants');

select col_not_null('identidad', 'cobranza_conexiones_pendientes', 'nonce',
  'esquema: nonce es NOT NULL — un ticket sin llave no autoriza nada');

select col_not_null('identidad', 'cobranza_conexiones_pendientes', 'expira_en',
  'esquema: expira_en es NOT NULL — no existe el ticket eterno');

select col_is_null('identidad', 'cobranza_conexiones_pendientes', 'consumido_en',
  'esquema: consumido_en es nullable — el ticket recién creado no se ha usado');

select col_is_null('identidad', 'cobranza_conexiones_pendientes', 'actor_usuario_id',
  'esquema: actor_usuario_id es nullable — sobrevive a la baja de la cuenta');

-- El `link_token` NUNCA vive acá: va cifrado en secretos_cifrados y esta tabla
-- solo autoriza al webhook que lo trae. Si algún día aparece esta columna, es
-- que alguien guardó el secreto en la tabla equivocada.
select hasnt_column('identidad', 'cobranza_conexiones_pendientes', 'link_token',
  'esquema: NO existe columna link_token — el secreto va cifrado en secretos_cifrados');

-- =============================================================================
-- BLOQUE 1 · DENY-ALL (la barrera principal)
-- =============================================================================

select results_eq(
  $$ select c.relrowsecurity, c.relforcerowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'identidad'
        and c.relname = 'cobranza_conexiones_pendientes' $$,
  $$ values (true, true) $$,
  'deny-all: RLS está enable + force');

select is_empty(
  $$ select 1 from pg_policies
      where schemaname = 'identidad'
        and tablename = 'cobranza_conexiones_pendientes' $$,
  'deny-all: la tabla NO tiene políticas — nadie pasa salvo BYPASSRLS');

select ok(
  not has_table_privilege('authenticated', 'identidad.cobranza_conexiones_pendientes', 'SELECT'),
  'deny-all: authenticated NO tiene privilegio SELECT');

select ok(
  not has_table_privilege('authenticated', 'identidad.cobranza_conexiones_pendientes', 'INSERT'),
  'deny-all: authenticated NO tiene privilegio INSERT — no puede fabricarse un ticket');

select ok(
  not has_table_privilege('anon', 'identidad.cobranza_conexiones_pendientes', 'SELECT'),
  'deny-all: anon NO tiene privilegio SELECT');

-- ⚠️ CONTRAPRUEBA de las tres anteriores: las aserciones negativas no pueden
-- estar devolviendo `false` para todo el mundo.
select ok(
  has_table_privilege('service_role', 'identidad.cobranza_conexiones_pendientes', 'SELECT'),
  'contraprueba: service_role SÍ tiene SELECT — las negativas de arriba dicen algo');

select ok(
  has_table_privilege('service_role', 'identidad.cobranza_conexiones_pendientes', 'INSERT'),
  'contraprueba: service_role SÍ tiene INSERT — es quien crea el ticket');

-- Y ahora el intento REAL, con sesión simulada. Se exige 42501 y no «0 filas»:
-- el silencio de un RLS sin privilegios revocados pasaría una prueba por conteo.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-00000000f1a1'::uuid,
  'aaaaaaaa-0000-0000-0000-00000000f1a1'::uuid,
  'interno', 'dueno');

select throws_ok(
  'select 1 from identidad.cobranza_conexiones_pendientes',
  '42501',
  null,
  'deny-all: el DUEÑO del courier choca con 42501 al leer sus propios tickets');

select throws_ok(
  $$insert into identidad.cobranza_conexiones_pendientes (tenant_id)
    values ('aaaaaaaa-0000-0000-0000-00000000f1a1'::uuid)$$,
  '42501',
  null,
  'deny-all: el dueño NO puede fabricarse un nonce por su cuenta');

select test_cerrar_sesion();

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-00000000f1a3'::uuid,
  'aaaaaaaa-0000-0000-0000-00000000f1a1'::uuid,
  'seller', 'seller',
  'aaaaaaaa-1111-0000-0000-00000000f1a1'::uuid);

select throws_ok(
  'select 1 from identidad.cobranza_conexiones_pendientes',
  '42501',
  null,
  'deny-all: el seller choca con 42501 — la cobranza del courier no es asunto suyo');

select test_cerrar_sesion();

-- =============================================================================
-- BLOQUE 2 · UN SOLO TICKET VIVO POR COURIER
-- =============================================================================
-- De acá en adelante se trabaja como `service_role`, que es el único rol que
-- escribe esta tabla en producción (Server Action del widget + webhook). Con
-- `force row level security` y sin políticas, hacerlo como dueño de la tabla no
-- probaría el camino real.
set local role service_role;

select lives_ok(
  $$insert into identidad.cobranza_conexiones_pendientes (tenant_id, actor_usuario_id)
    values ('aaaaaaaa-0000-0000-0000-00000000f1a1'::uuid,
            'aaaaaaaa-3333-0000-0000-00000000f1a1'::uuid)$$,
  'uso único: el primer ticket pendiente del courier A entra');

select throws_ok(
  $$insert into identidad.cobranza_conexiones_pendientes (tenant_id)
    values ('aaaaaaaa-0000-0000-0000-00000000f1a1'::uuid)$$,
  '23505',
  null,
  'uso único: un SEGUNDO pendiente del mismo courier se rechaza — dos llaves vivas, no');

-- ⚠️ CONTRAPRUEBA (a): el índice es POR TENANT. Si le faltara tenant_id, el
-- courier B no podría conectar su banco mientras A está a medias.
select lives_ok(
  $$insert into identidad.cobranza_conexiones_pendientes (tenant_id)
    values ('bbbbbbbb-0000-0000-0000-00000000f1b2'::uuid)$$,
  'contraprueba: OTRO courier SÍ puede tener su pendiente al mismo tiempo');

-- ⚠️ CONTRAPRUEBA (b): el índice es PARCIAL. Consumir el ticket libera el hueco;
-- si no, el courier quedaría sin poder reconectar nunca su banco.
select lives_ok(
  $$update identidad.cobranza_conexiones_pendientes
       set estado = 'consumido', consumido_en = now()
     where tenant_id = 'aaaaaaaa-0000-0000-0000-00000000f1a1'::uuid
       and estado = 'pendiente'$$,
  'contraprueba: el ticket de A se marca consumido');

select lives_ok(
  $$insert into identidad.cobranza_conexiones_pendientes (tenant_id)
    values ('aaaaaaaa-0000-0000-0000-00000000f1a1'::uuid)$$,
  'contraprueba: con el anterior consumido, A puede abrir un ticket nuevo');

select results_eq(
  $$select count(*)::int from identidad.cobranza_conexiones_pendientes
     where tenant_id = 'aaaaaaaa-0000-0000-0000-00000000f1a1'::uuid$$,
  $$values (2)$$,
  'uso único: el histórico se conserva (2 filas) — lo único acotado es el vigente');

-- El nonce es único GLOBAL, no por tenant: así un nonce jamás puede servirle a
-- otro courier, sin depender de que el WHERE del webhook incluya el tenant.
select throws_ok(
  $$insert into identidad.cobranza_conexiones_pendientes (tenant_id, nonce)
    values ('bbbbbbbb-0000-0000-0000-00000000f1b2'::uuid,
            (select nonce from identidad.cobranza_conexiones_pendientes
              where tenant_id = 'aaaaaaaa-0000-0000-0000-00000000f1a1'::uuid
              limit 1))$$,
  '23505',
  null,
  'uso único: un nonce ya existente no se puede repetir en otro courier');

-- =============================================================================
-- BLOQUE 3 · El CHECK de estado, cada rechazo con su aceptación
-- =============================================================================

select throws_ok(
  $$insert into identidad.cobranza_conexiones_pendientes (tenant_id, estado)
    values ('bbbbbbbb-0000-0000-0000-00000000f1b2'::uuid, 'usado')$$,
  '23514',
  null,
  'estado: un valor fuera de la lista se rechaza (23514)');

select throws_ok(
  $$insert into identidad.cobranza_conexiones_pendientes (tenant_id, estado)
    values ('bbbbbbbb-0000-0000-0000-00000000f1b2'::uuid, '')$$,
  '23514',
  null,
  'estado: la cadena vacía se rechaza — no es un estado');

-- Estado imposible: consumido sin marca de tiempo. La bitácora del momento en
-- que se conecta un banco no puede quedar sin hora.
select throws_ok(
  $$insert into identidad.cobranza_conexiones_pendientes (tenant_id, estado)
    values ('bbbbbbbb-0000-0000-0000-00000000f1b2'::uuid, 'consumido')$$,
  '23514',
  null,
  'coherencia: "consumido" sin consumido_en se rechaza');

-- ⚠️ CONTRAPRUEBA: el CHECK no rechaza TODO.
select lives_ok(
  $$insert into identidad.cobranza_conexiones_pendientes
      (tenant_id, estado, consumido_en)
    values ('bbbbbbbb-0000-0000-0000-00000000f1b2'::uuid, 'consumido', now())$$,
  'contraprueba: "consumido" con su hora SÍ entra — el CHECK no rechaza todo');

select lives_ok(
  $$insert into identidad.cobranza_conexiones_pendientes (tenant_id, estado)
    values ('bbbbbbbb-0000-0000-0000-00000000f1b2'::uuid, 'expirado')$$,
  'contraprueba: "expirado" es un estado válido — es a lo que pasa el vencido');

-- =============================================================================
-- BLOQUE 4 · El vencimiento existe aunque nadie lo calcule
-- =============================================================================

select col_has_default('identidad', 'cobranza_conexiones_pendientes', 'expira_en',
  'vencimiento: expira_en tiene DEFAULT — una inserción distraída no crea un ticket eterno');

-- Y el default de verdad, sobre una fila real: ~15 minutos, no horas ni días.
-- (now() es constante dentro de la transacción de pgTAP: sin flakiness.)
select results_eq(
  $$select (expira_en - creado_en) = interval '15 minutes'
      from identidad.cobranza_conexiones_pendientes
     where tenant_id = 'aaaaaaaa-0000-0000-0000-00000000f1a1'::uuid
       and estado = 'pendiente'$$,
  $$values (true)$$,
  'vencimiento: una fila creada sin tocar expira_en vive 15 minutos');

select throws_ok(
  $$insert into identidad.cobranza_conexiones_pendientes (tenant_id, expira_en)
    values ('bbbbbbbb-0000-0000-0000-00000000f1b2'::uuid, now() - interval '1 hour')$$,
  '23514',
  null,
  'vencimiento: un ticket que nace vencido se rechaza — sería un error de cálculo silencioso');

reset role;

select * from finish();

rollback;
