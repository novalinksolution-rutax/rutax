-- =============================================================================
-- Pruebas de aislamiento RLS — ESCRITURA, roles sin sesión y claims forjados
-- =============================================================================
-- Complementa `rls_aislamiento.test.sql` (lectura/SELECT, 57 pruebas) con los
-- escenarios que ese archivo no cubre y que la sesión de QA de 2026-06 detectó
-- como punto ciego recurrente: el patrón "UPDATE silencioso" — Postgres
-- reporta "UPDATE 0" sin lanzar excepción cuando RLS filtra todas las filas
-- candidatas, en vez de un 42501 explícito y auditable.
--
-- Esta suite demuestra, contra Postgres real:
--   A. Regresión del patrón "UPDATE silencioso → 42501 explícito" en TODAS las
--      tablas donde un actor puede *ver* una fila (la suya) pero no editarla:
--      sellers, conductores, tarifas, courier_config_dte, folios_caf,
--      invitaciones, conexiones_seller_ml.
--   B. El caso simétrico correcto en `usuarios_perfil`: el self-update
--      LEGÍTIMO funciona, y el intento sobre la fila de OTRO usuario produce
--      "UPDATE 0" silencioso — y eso es CORRECTO aquí (no una fuga: ambos
--      "no existe" y "no es tuya" responden igual, sin oracle).
--   C. Acceso sin sesión (`anon` / sin JWT): `42501 permission denied`,
--      MÁS estricto que el filtrado RLS vacío — confirma que ni siquiera se
--      llega a evaluar políticas (falta GRANT a nivel de objeto).
--   D. Claims forjados: un usuario real de un tenant que presenta un
--      `tenant_id` de OTRO tenant en su JWT no ve nada (ni su propio perfil) —
--      RLS se evalúa contra el claim, no contra la "verdad" de la fila.
--   E. `tenants`: ningún usuario autenticado puede insertar/editar/borrar.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(32);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada (mismo mecanismo que rls_aislamiento.test.sql;
-- redefinidos aquí porque cada archivo .test.sql corre en su propia
-- transacción/rollback — no hay estado compartido entre archivos).
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

-- Variante: sesión `anon` — sin JWT (cliente sin token / token expirado y
-- descartado por el middleware antes de llegar a PostgREST).
create or replace function test_sesion_anonima() returns void
language plpgsql
as $$
begin
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Vuelve a `postgres` (bypass RLS) y limpia los claims.
create or replace function test_cerrar_sesion() returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
end;
$$;

-- -----------------------------------------------------------------------------
-- Fixtures: un tenant (A) completo + un segundo tenant (B) mínimo, suficientes
-- para ejercer cada escenario de escritura/forjado sin duplicar todo el set
-- de `rls_aislamiento.test.sql` (que ya cubre lectura exhaustivamente).
-- -----------------------------------------------------------------------------
do $$
declare
  t_a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  t_b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';

  s_a  uuid := 'aaaaaaaa-1111-0000-0000-000000000001';
  s_a2 uuid := 'aaaaaaaa-1111-0000-0000-000000000003';

  d_a  uuid := 'aaaaaaaa-2222-0000-0000-000000000001';

  u_interno_a   uuid := 'aaaaaaaa-3333-0000-0000-000000000001';
  u_seller_a    uuid := 'aaaaaaaa-3333-0000-0000-000000000003';
  u_seller_a2   uuid := 'aaaaaaaa-3333-0000-0000-000000000004';
  u_conductor_a uuid := 'aaaaaaaa-3333-0000-0000-000000000006';

  inv_id uuid := 'cccccccc-0000-0000-0000-000000000001';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_a, 'Courier A', 'Courier A SpA', '76111111-1', 'activo'),
    (t_b, 'Courier B', 'Courier B SpA', '76222222-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (u_interno_a,   'interno.a@escritura.test',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a,    'seller.a@escritura.test',    crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_seller_a2,   'seller.a2@escritura.test',   crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
    (u_conductor_a, 'conductor.a@escritura.test', crypt('x', gen_salt('bf')), now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_a,  t_a, 'Seller Uno A', '77111111-1', 'Contacto Uno A', 'uno.a@seller.test', 'activo'),
    (s_a2, t_a, 'Seller Dos A', '77222222-2', 'Contacto Dos A', 'dos.a@seller.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values (d_a, t_a, 'Conductor Uno A', '78111111-1', 'dependiente', 'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a,   t_a, 'Interno A',           'interno',   null, null, 'dueno',     'activo'),
    (u_seller_a,    t_a, 'Usuario Seller A',    'seller',    s_a,  null, 'seller',    'activo'),
    (u_seller_a2,   t_a, 'Usuario Seller A2',   'seller',    s_a2, null, 'seller',    'activo'),
    (u_conductor_a, t_a, 'Usuario Conductor A', 'conductor', null, d_a,  'conductor', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conexiones_seller_ml (tenant_id, seller_id, ml_user_id, estado_salud)
  values (t_a, s_a, 'ML-A-1', 'sana')
  on conflict (seller_id) do nothing;

  insert into identidad.tarifas (tenant_id, seller_id, tipo_entrega, modo_calculo, monto_clp, vigente_desde, estado)
  values
    (t_a, null, 'flex', 'monto_fijo', 1500, '2026-01-01', 'activa'),
    (t_a, s_a,  'flex', 'monto_fijo', 1800, '2026-01-01', 'activa')
  on conflict do nothing;

  insert into identidad.courier_config_dte (tenant_id, proveedor_dte, estado_certificacion)
  values (t_a, 'simplefactura', 'activo')
  on conflict (tenant_id) do nothing;

  insert into identidad.folios_caf (tenant_id, tipo_documento, folio_desde, folio_hasta, folio_actual, estado)
  values (t_a, 33, 1, 100, 1, 'vigente')
  on conflict do nothing;

  insert into identidad.invitaciones (id, tenant_id, email, tipo_usuario, rol, token, estado, expira_en)
  values (inv_id, t_a, 'pendiente@escritura.test', 'interno', 'supervisor', 'tok-escritura-1', 'pendiente', now() + interval '7 days')
  on conflict (id) do nothing;
end $$;

-- =============================================================================
-- BLOQUE A · Regresión "UPDATE silencioso → 42501 explícito"
-- Cada caso: el actor PUEDE VER la fila (vía SELECT, política de lectura se lo
-- permite) pero NO puede editarla (la escritura es de roles internos /
-- service_role). Sin el guard de defensa en profundidad, Postgres respondería
-- "UPDATE 0" sin excepción — indistinguible de éxito-sin-cambios para la app,
-- y no auditable. Se espera 42501 (insufficient_privilege) explícito.
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid -- s_a
);

-- Control: el seller efectivamente puede VER su propia fila...
select isnt_empty(
  $$ select 1 from public.sellers where id = 'aaaaaaaa-1111-0000-0000-000000000001' $$,
  'control: el seller A puede ver su propia fila en sellers (precondición del caso "UPDATE silencioso")'
);

-- ...pero intentar editarla debe lanzar 42501 explícito (regresión: bug
-- confirmado y corregido — faltaba `trg_sellers_solo_interno_edita`).
select throws_ok(
  $$ update public.sellers set nombre_contacto = 'HACKED' where id = 'aaaaaaaa-1111-0000-0000-000000000001' $$,
  '42501',
  null,
  'REGRESIÓN sellers: seller que intenta editar SU PROPIA fila visible recibe 42501 explícito (no "UPDATE 0" silencioso)'
);

-- tarifas: el seller no puede siquiera VER esta tabla (P1-only, sin P2) — el
-- caso es aún más flagrante: ni visibilidad ni escritura, y sin el guard
-- también habría sido "UPDATE 0" silencioso (regresión: faltaba
-- `trg_tarifas_solo_interno_edita`).
select is_empty(
  $$ select 1 from public.tarifas where seller_id = 'aaaaaaaa-1111-0000-0000-000000000001' $$,
  'control: el seller A no ve sus propias tarifas (tabla P1-only — confirma que el caso de abajo no es "fila visible pero no editable" sino "ni visible ni editable")'
);

select throws_ok(
  $$ update public.tarifas set monto_clp = 1 where seller_id = 'aaaaaaaa-1111-0000-0000-000000000001' $$,
  '42501',
  null,
  'REGRESIÓN tarifas: seller que intenta editar tarifas (ni visibles) recibe 42501 explícito (no "UPDATE 0" silencioso)'
);

select throws_ok(
  $$ update public.courier_config_dte set proveedor_dte = 'pirata' where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'REGRESIÓN courier_config_dte: seller que intenta editar config DTE (interna) recibe 42501 explícito'
);

select throws_ok(
  $$ update public.folios_caf set folio_actual = 99 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'REGRESIÓN folios_caf: seller que intenta editar folios CAF (interno/tributario) recibe 42501 explícito'
);

-- invitaciones: el seller no las ve (confirmado en rls_aislamiento.test.sql),
-- y el intento de UPDATE (p. ej. para autoaceptarse o sabotear una invitación)
-- debe ser 42501 explícito (regresión: faltaba `trg_invitaciones_solo_interno_edita`).
select throws_ok(
  $$ update public.invitaciones set estado = 'revocada' where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'REGRESIÓN invitaciones: seller que intenta revocar/aceptar una invitación recibe 42501 explícito (no "UPDATE 0" silencioso)'
);

-- conexiones_seller_ml: el seller SÍ ve su propia conexión (lectura, P2) pero
-- jamás debe poder editarla directamente (tokens/salud son de jobs/service_role).
-- Esta política YA estaba protegida (el bug que la sesión anterior corrigió fue
-- en `conexiones_seller_ml_select`, la negación `<> 'seller'` demasiado
-- permisiva) — se deja aquí como regresión explícita del UPDATE también.
select isnt_empty(
  $$ select 1 from public.conexiones_seller_ml where seller_id = 'aaaaaaaa-1111-0000-0000-000000000001' $$,
  'control: el seller A puede ver su propia conexión ML (precondición)'
);

select throws_ok(
  $$ update public.conexiones_seller_ml set estado_salud = 'sana' where seller_id = 'aaaaaaaa-1111-0000-0000-000000000001' $$,
  '42501',
  null,
  'REGRESIÓN conexiones_seller_ml: seller que intenta editar SU PROPIA conexión recibe 42501 explícito'
);

-- --- Mismo patrón para CONDUCTOR sobre su propia fila en `conductores` -------
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid -- d_a
);

select isnt_empty(
  $$ select 1 from public.conductores where id = 'aaaaaaaa-2222-0000-0000-000000000001' $$,
  'control: el conductor A puede ver su propia fila en conductores (precondición)'
);

select throws_ok(
  $$ update public.conductores set estado = 'inactivo' where id = 'aaaaaaaa-2222-0000-0000-000000000001' $$,
  '42501',
  null,
  'REGRESIÓN conductores: conductor que intenta editar SU PROPIA ficha recibe 42501 explícito (cubierto desde el origen por trg_conductores_solo_interno_edita)'
);

-- =============================================================================
-- BLOQUE B · `usuarios_perfil`: self-update legítimo vs. fila ajena
-- A diferencia del bloque A (donde NINGÚN actor no-interno puede escribir),
-- aquí el self-service SÍ es legítimo — la política exige `id = auth.uid()`.
-- Verificamos AMBOS lados: que lo propio funciona, y que lo ajeno no rompe
-- el aislamiento (RLS lo filtra; "UPDATE 0" sin oracle es CORRECTO aquí, no
-- una fuga — ver nota extensa en la migración 0001).
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid
);

-- Caso feliz: self-update de una columna no sensible debe funcionar y persistir.
select lives_ok(
  $$ update public.usuarios_perfil set nombre_completo = 'Nombre Actualizado Por Mí'
     where id = 'aaaaaaaa-3333-0000-0000-000000000003' $$,
  'usuarios_perfil: el usuario-seller PUEDE actualizar su propio nombre_completo (self-service legítimo, sin excepción)'
);

select results_eq(
  $$ select nombre_completo from public.usuarios_perfil where id = 'aaaaaaaa-3333-0000-0000-000000000003' $$,
  $$ values ('Nombre Actualizado Por Mí'::text) $$,
  'usuarios_perfil: el self-update de nombre_completo se persistió correctamente'
);

-- Caso "fila ajena": el seller A intenta tocar la fila del seller A2 (mismo
-- tenant — visible para un interno, invisible para este seller). RLS la
-- excluye del `using` de `usuarios_perfil_update_propio` antes de llegar a
-- cualquier disparador por fila: "UPDATE 0" sin excepción. Documentamos esto
-- como comportamiento ESPERADO (no como bug): no hay oracle (misma respuesta
-- que apuntar a un id inexistente), y el alcance de filas afectadas es 0 —
-- ninguna fila ajena cambia. `results_eq … returning` confirma 0 filas.
select results_eq(
  $$ update public.usuarios_perfil set nombre_completo = 'HACKED'
     where id = 'aaaaaaaa-3333-0000-0000-000000000004' -- u_seller_a2, mismo tenant
     returning 1 $$,
  $$ select 1 where false $$,
  'usuarios_perfil: UPDATE del seller A sobre la fila de OTRO usuario afecta 0 filas (RLS using=id=auth.uid() la excluye; "UPDATE 0" sin oracle es correcto aquí, no una fuga)'
);

-- Confirma que la fila ajena NO cambió (aislamiento real, no solo "no error").
-- Verificación como `postgres` (bypass RLS): el propio seller A no puede SELECT
-- la fila del seller A2 (P2 lo oculta), así que `results_eq` contra su sesión
-- compararía "vacío vs. valor esperado" y fallaría por la razón equivocada
-- (visibilidad, no integridad). Confirmamos integridad desde una vista que sí
-- alcanza la fila, sin reabrir la sesión del actor bajo prueba.
select test_cerrar_sesion();

select results_eq(
  $$ select nombre_completo from identidad.usuarios_perfil where id = 'aaaaaaaa-3333-0000-0000-000000000004' $$,
  $$ values ('Usuario Seller A2'::text) $$,
  'usuarios_perfil: la fila del seller A2 permanece intacta tras el intento del seller A (verificado vía postgres -- aislamiento real, no solo ausencia de excepción)'
);

-- Retoma la sesión del seller A para continuar el bloque B con su contexto.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- t_a
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid
);

-- Auto-escalación de rol/tipo_usuario: el trigger de columnas sensibles debe
-- bloquearla con excepción explícita 42501 (columna protegida — distinto del
-- caso anterior, que es de VISIBILIDAD; aquí la fila SÍ es la propia).
select throws_ok(
  $$ update public.usuarios_perfil set rol = 'dueno', tipo_usuario = 'interno'
     where id = 'aaaaaaaa-3333-0000-0000-000000000003' $$,
  '42501',
  null,
  'usuarios_perfil: intento de auto-escalación de rol/tipo_usuario sobre la PROPIA fila lanza 42501 explícito (columnas protegidas — antes era P0001 genérico, ahora 42501 consistente con el resto de la suite)'
);

select throws_ok(
  $$ update public.usuarios_perfil set tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002'
     where id = 'aaaaaaaa-3333-0000-0000-000000000003' $$,
  '42501',
  null,
  'usuarios_perfil: intento de cambiar tenant_id de la propia fila (fuga a otro tenant) lanza 42501 explícito'
);

-- Conductor: mismo patrón self-update legítimo / fila ajena bloqueada.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000006'::uuid, -- u_conductor_a
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'conductor', 'conductor',
  p_driver_id => 'aaaaaaaa-2222-0000-0000-000000000001'::uuid
);

select lives_ok(
  $$ update public.usuarios_perfil set nombre_completo = 'Conductor Renombrado'
     where id = 'aaaaaaaa-3333-0000-0000-000000000006' $$,
  'usuarios_perfil: el usuario-conductor PUEDE actualizar su propio nombre_completo'
);

select results_eq(
  $$ update public.usuarios_perfil set nombre_completo = 'HACKED'
     where id = 'aaaaaaaa-3333-0000-0000-000000000001' -- u_interno_a, mismo tenant
     returning 1 $$,
  $$ select 1 where false $$,
  'usuarios_perfil: UPDATE del conductor sobre la fila del interno del tenant afecta 0 filas (mismo patrón "UPDATE 0" correcto sin oracle)'
);

-- =============================================================================
-- BLOQUE C · Acceso sin sesión / `anon`
-- Más estricto que "RLS vacío": sin GRANT a nivel de objeto para `anon`, el
-- error es 42501 "permission denied for table/view X" — no se llega siquiera
-- a evaluar políticas. Relevante para "tokens expirados" (el middleware debe
-- garantizar que un token vencido se trate como sesión anónima, nunca como
-- sesión con claims viejos/caducados).
-- =============================================================================

select test_sesion_anonima();

select throws_ok(
  $$ select 1 from public.tenants $$,
  '42501',
  null,
  'anon: SELECT sobre tenants -- permission denied (42501), más estricto que "0 filas")'
);

select throws_ok(
  $$ select 1 from public.sellers $$,
  '42501',
  null,
  'anon: SELECT sobre sellers -- permission denied (42501)'
);

select throws_ok(
  $$ select 1 from public.usuarios_perfil $$,
  '42501',
  null,
  'anon: SELECT sobre usuarios_perfil -- permission denied (42501)'
);

select throws_ok(
  $$ insert into public.sellers (tenant_id, razon_social, rut, estado)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'Pirata Anónimo', '79999999-9', 'activo') $$,
  '42501',
  null,
  'anon: INSERT sobre sellers -- permission denied (42501), ni siquiera intenta evaluar RLS'
);

select test_cerrar_sesion();

-- =============================================================================
-- BLOQUE D · Claims forjados: tenant_id que no corresponde al usuario real
-- Simula un JWT manipulado (o un bug de propagación de claims) donde un
-- usuario real del tenant A presenta `tenant_id` del tenant B. RLS se evalúa
-- contra el CLAIM, no contra una verdad externa — el resultado correcto es
-- "no veo nada" (ni mis propios datos), nunca "veo los datos del tenant ajeno
-- ni los míos bajo otra etiqueta".
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a (usuario real del tenant A)
  'bbbbbbbb-0000-0000-0000-000000000002'::uuid, -- ¡tenant_id FORJADO -- del tenant B!
  'seller', 'seller',
  p_seller_id => 'aaaaaaaa-1111-0000-0000-000000000001'::uuid
);

select is_empty(
  $$ select 1 from public.sellers $$,
  'claim forjado: usuario real del tenant A con tenant_id=B en el JWT no ve ningún seller (ni los de A -- claim no calza con su fila real -- ni los de B -- RLS exige fila.tenant_id = claim Y pertenencia real)'
);

select is_empty(
  $$ select 1 from public.usuarios_perfil $$,
  'claim forjado: tampoco ve su PROPIO perfil -- la política exige tenant_id de la fila = claim, y la fila real del usuario tiene tenant_id=A ≠ claim B'
);

select is_empty(
  $$ select 1 from public.usuarios_perfil where id = 'aaaaaaaa-3333-0000-0000-000000000003' $$,
  'claim forjado: ni siquiera consultando por su propio id ve su fila -- el filtro por tenant_id del claim la excluye'
);

-- `tenants` es la única tabla cuya política de lectura depende
-- EXCLUSIVAMENTE de `claim_tenant_id()` (`using (id = claim_tenant_id())`),
-- sin verificar that el usuario realmente pertenezca a ese tenant -- por
-- diseño: es la "tarjeta de identidad" pública del courier (nombre_fantasia,
-- razón social, RUT, estado), sin datos de negocio cruzables. Por construcción,
-- el claim forjado SÍ revela esa fila puntual (la de B) -- documentamos esto
-- como comportamiento ACEPTADO (no una fuga: cero datos de seller/dinero/
-- operación), y confirmamos el límite exacto: ve B, jamás A.
select results_eq(
  $$ select id::text from public.tenants $$,
  $$ values ('bbbbbbbb-0000-0000-0000-000000000002') $$,
  'claim forjado: ve EXCLUSIVAMENTE la fila de tenants del tenant_id forjado (B) -- `tenants` depende solo del claim por diseño (registro sin datos de negocio); jamás ve la fila de su tenant real (A)'
);

select is_empty(
  $$ select 1 from public.tenants where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'claim forjado: NO ve la fila de tenants de su tenant REAL (A) -- el claim manda, no la pertenencia real; el límite del "daño" del forjado es exactamente una fila de registro sin datos de negocio'
);

-- También se prueba el forjado "interno": un usuario-seller real que se
-- presenta con tipo_usuario='interno' pero tenant_id correcto -- el claim
-- "miente" sobre el rol, no sobre el tenant.
select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000003'::uuid, -- u_seller_a (es 'seller' en la BD)
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid, -- tenant_id correcto
  'interno', 'dueno',                            -- ¡tipo_usuario/rol FORJADOS!
  p_seller_id => null
);

-- Con tipo_usuario='interno' forjado, las políticas de lectura SÍ lo dejarían
-- ver "todo su tenant" -- pero esto es exactamente la superficie que el
-- Custom Access Token Hook (no este JWT simulado) debe impedir generar: el
-- hook deriva tipo_usuario/rol desde `usuarios_perfil` en el servidor, nunca
-- desde un claim que el cliente pueda fijar. Esta prueba documenta POR QUÉ
-- el hook (y no un claim arbitrario) es la única fuente de verdad -- si
-- alguna vez se reemplaza el hook por algo que confíe en claims del cliente,
-- esta prueba es la que debe alertar (quedaría "pasando" con datos ajenos).
select isnt_empty(
  $$ select 1 from public.sellers $$,
  'documenta superficie: con tipo_usuario=interno FORJADO (y tenant_id real), las políticas SÍ muestran todo el tenant -- por eso el hook (no el cliente) debe ser la única fuente de tipo_usuario/rol; ver custom_access_token_hook'
);

select test_cerrar_sesion();

-- =============================================================================
-- BLOQUE E · `tenants`: ningún usuario autenticado escribe (alta es
-- responsabilidad de `crearTenantConDueno`, vía service_role/función auditada)
-- =============================================================================

select test_iniciar_sesion(
  'aaaaaaaa-3333-0000-0000-000000000001'::uuid, -- u_interno_a (¡el dueño!, el rol con más privilegios de cliente)
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'interno', 'dueno'
);

select throws_ok(
  $$ insert into public.tenants (nombre_fantasia, razon_social, rut, estado)
     values ('Pirata SpA', 'Pirata SpA', '11111111-1', 'activo') $$,
  '42501',
  null,
  'tenants: ni siquiera el dueño/interno autenticado puede INSERTAR un tenant (alta vía función service_role auditada -- crearTenantConDueno)'
);

select throws_ok(
  $$ update public.tenants set estado = 'suspendido' where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'tenants: ni siquiera el dueño/interno autenticado puede EDITAR su propio tenant (cambios de estado vía proceso interno auditado)'
);

select throws_ok(
  $$ delete from public.tenants where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'tenants: ningún usuario autenticado puede BORRAR un tenant (sin política DELETE -- ni el propio dueño)'
);

select test_cerrar_sesion();

select * from finish();
rollback;
