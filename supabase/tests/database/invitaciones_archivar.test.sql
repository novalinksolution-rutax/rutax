-- =============================================================================
-- Pruebas — ARCHIVAR invitaciones muertas (migración 20260927000001)
-- =============================================================================
-- Demuestra, contra una base Postgres real, que el soft-hide del listado de
-- /equipo cumple su contrato SIN abrir la fuga del token:
--
--   (a) `archivada_en` existe, es timestamptz y admite null (null = se lista);
--   (b) el CHECK `invitaciones_archivada_solo_si_no_pendiente` RECHAZA archivar
--       una invitación `pendiente` —esconder un token vivo del único listado
--       donde el courier lo vigila sería una fuga— y ACEPTA archivar una
--       `revocada` y una `expirada`;
--   (c) el mismo CHECK impide RESUCITAR una invitación archivada devolviéndole
--       el estado `pendiente` (se evalúa en los dos sentidos);
--   (d) `archivada_en` entra a la superficie de lectura (vista espejo + grant por
--       columna, que el listado NECESITA porque filtra por esa columna con el
--       cliente de sesión) y `token` sigue fuera de ambas;
--   (e) `authenticated` sigue SIN UPDATE sobre la tabla: archivar corre por
--       `service_role`, como crear/revocar/reenviar.
--
-- Se siembra dentro de la transacción con el rol privilegiado del runner de
-- pgTAP y se hace rollback al final. El disparador por sentencia
-- `trg_invitaciones_solo_interno_edita` es un no-op aquí: sin `request.jwt.claims`
-- fijado, `auth.role()` devuelve null y su guard no dispara.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(20);

-- -----------------------------------------------------------------------------
-- Helper de sesión simulada (redefinido aquí — cada .test.sql corre en su
-- propia transacción). Fija el JWT y conmuta a rol authenticated.
-- -----------------------------------------------------------------------------
create or replace function test_iniciar_sesion(
  p_user_id      uuid,
  p_tenant_id    uuid,
  p_tipo_usuario text,
  p_rol          text
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
      'rol', p_rol
    )::text,
    true
  );
end;
$$;

-- =============================================================================
-- BLOQUE 0 · (a) Contrato de esquema de la columna nueva.
-- =============================================================================
select has_column(
  'identidad', 'invitaciones', 'archivada_en',
  'identidad.invitaciones tiene la columna archivada_en'
);
select col_type_is(
  'identidad', 'invitaciones', 'archivada_en', 'timestamp with time zone',
  'archivada_en es timestamptz (guarda CUÁNDO se archivó, no un booleano)'
);
select col_is_null(
  'identidad', 'invitaciones', 'archivada_en',
  'archivada_en admite null — null es el estado normal: la invitación se lista'
);

-- El CHECK quedó VALIDADO, no NOT VALID: la columna nace en la misma migración,
-- así que todo el histórico tiene archivada_en null y valida limpio. Un NOT VALID
-- innecesario sería deuda (constraint sin validar para siempre).
select ok(
  (select convalidated
     from pg_constraint
    where conname = 'invitaciones_archivada_solo_si_no_pendiente'
      and conrelid = 'identidad.invitaciones'::regclass),
  'invitaciones_archivada_solo_si_no_pendiente existe y está VALIDADO (no NOT VALID)'
);

-- =============================================================================
-- BLOQUE 1 · (d) Superficie de lectura: archivada_en dentro, token fuera.
-- =============================================================================
select has_column(
  'public', 'invitaciones', 'archivada_en',
  'public.invitaciones expone archivada_en'
);
select hasnt_column(
  'public', 'invitaciones', 'token',
  'public.invitaciones sigue SIN exponer token'
);

-- El grant por COLUMNA sobre la tabla base es el que de verdad manda: la vista es
-- security_invoker, y Postgres exige privilegio de columna incluso para un WHERE.
-- Los casts explícitos fijan la sobrecarga (user name, table text, column text,
-- privilege text) y evitan depender de la resolución de literales `unknown`.
select ok(
  has_column_privilege(
    'authenticated'::name, 'identidad.invitaciones'::text, 'archivada_en'::text, 'SELECT'::text
  ),
  'authenticated SÍ puede leer archivada_en en la tabla base (el listado filtra por ella)'
);
select ok(
  not has_column_privilege(
    'authenticated'::name, 'identidad.invitaciones'::text, 'token'::text, 'SELECT'::text
  ),
  'Contraprueba: authenticated sigue SIN privilegio SELECT sobre token'
);

-- =============================================================================
-- BLOQUE 2 · (e) Archivar es un UPDATE, y `authenticated` no lo tiene: la acción
--            corre por service_role. Esta migración NO abrió ese permiso.
-- =============================================================================
select ok(
  not has_table_privilege('authenticated'::name, 'identidad.invitaciones'::text, 'UPDATE'::text),
  'authenticated sigue SIN privilegio UPDATE: archivar pasa por service_role'
);
select ok(
  not has_table_privilege('authenticated'::name, 'identidad.invitaciones'::text, 'DELETE'::text),
  'authenticated sigue SIN privilegio DELETE: la fila de acceso nunca se borra'
);

-- -----------------------------------------------------------------------------
-- Fixtures mínimos: un courier y tres invitaciones internas, una por estado.
-- `tipo_usuario = 'interno'` exige email (invitaciones_contacto_por_tipo) y
-- seller_id/driver_id nulos (los *_coherente de la migración base).
-- -----------------------------------------------------------------------------
insert into identidad.tenants (id, nombre_fantasia, razon_social, rut)
  values ('aaaaaaaa-0000-0000-0000-0000000000a1'::uuid,
          'Courier Archivar', 'Courier Archivar SpA', '76000031-1');

insert into identidad.invitaciones
  (id, tenant_id, email, tipo_usuario, rol, estado, token, expira_en)
values
  ('11111111-0000-0000-0000-000000000001'::uuid,
   'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, 'viva@example.com',
   'interno', 'coordinador', 'pendiente', 'tok-archivar-pendiente',
   now() + interval '7 days'),
  ('11111111-0000-0000-0000-000000000002'::uuid,
   'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, 'revocada@example.com',
   'interno', 'coordinador', 'revocada', 'tok-archivar-revocada',
   now() + interval '7 days'),
  ('11111111-0000-0000-0000-000000000003'::uuid,
   'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, 'expirada@example.com',
   'interno', 'coordinador', 'expirada', 'tok-archivar-expirada',
   now() - interval '1 day');

-- =============================================================================
-- BLOQUE 3 · (b) El CHECK rechaza archivar un token VIVO.
--            Es la prueba central: sin ella, «quitar de la lista» sería esconder
--            una vía de entrada al tenant en vez de limpiar la pantalla.
-- =============================================================================
select throws_ok(
  $$ update identidad.invitaciones
        set archivada_en = now()
      where id = '11111111-0000-0000-0000-000000000001'::uuid $$,
  '23514',
  null,
  'Archivar una invitación PENDIENTE viola invitaciones_archivada_solo_si_no_pendiente'
);

-- Misma barrera por la puerta del INSERT, no solo del UPDATE.
select throws_ok(
  $$ insert into identidad.invitaciones
       (tenant_id, email, tipo_usuario, rol, estado, token, expira_en, archivada_en)
     values
       ('aaaaaaaa-0000-0000-0000-0000000000a1'::uuid, 'nace-escondida@example.com',
        'interno', 'coordinador', 'pendiente', 'tok-archivar-nace-mal',
        now() + interval '7 days', now()) $$,
  '23514',
  null,
  'Tampoco se puede INSERTAR una invitación pendiente ya archivada'
);

-- Contraprueba de que el CHECK no estorba lo legítimo: la misma fila pendiente
-- se actualiza sin problemas mientras no se la archive.
select lives_ok(
  $$ update identidad.invitaciones
        set email_estado = 'entregado'
      where id = '11111111-0000-0000-0000-000000000001'::uuid $$,
  'Una invitación pendiente se sigue actualizando con normalidad (el CHECK solo mira archivada_en)'
);

-- =============================================================================
-- BLOQUE 4 · (b) El CHECK acepta archivar lo que ya está muerto.
-- =============================================================================
select lives_ok(
  $$ update identidad.invitaciones
        set archivada_en = now()
      where id = '11111111-0000-0000-0000-000000000002'::uuid $$,
  'Archivar una invitación REVOCADA: permitido'
);

select lives_ok(
  $$ update identidad.invitaciones
        set archivada_en = now()
      where id = '11111111-0000-0000-0000-000000000003'::uuid $$,
  'Archivar una invitación EXPIRADA: permitido'
);

select is(
  (select count(*)::int
     from identidad.invitaciones
    where tenant_id = 'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid
      and archivada_en is null),
  1,
  'Tras archivar dos de tres, el listado (archivada_en is null) deja una: la fila sobrevive, solo deja de listarse'
);

-- =============================================================================
-- BLOQUE 5 · (c) Una invitación archivada NO puede volver a `pendiente`.
--            Cierra el camino inverso: archivar + resucitar sería otra vez un
--            token vivo escondido del listado.
-- =============================================================================
select throws_ok(
  $$ update identidad.invitaciones
        set estado = 'pendiente'
      where id = '11111111-0000-0000-0000-000000000002'::uuid $$,
  '23514',
  null,
  'Devolver a `pendiente` una invitación ARCHIVADA viola el CHECK (no hay token vivo escondido)'
);

-- Desarchivar primero sí la libera: la regla es «no ambas cosas a la vez», no
-- «esta fila queda congelada para siempre».
select lives_ok(
  $$ update identidad.invitaciones
        set archivada_en = null, estado = 'pendiente'
      where id = '11111111-0000-0000-0000-000000000002'::uuid $$,
  'Desarchivar y reactivar en el MISMO update: permitido (la fila vuelve al listado)'
);

-- =============================================================================
-- BLOQUE 6 · (d) La consulta REAL del panel, con el cliente de sesión. El rol es
--            `coordinador` a propósito: es el interno con menos privilegios que
--            aun así lista el equipo. Sin el grant por columna esto daría 42501.
-- =============================================================================
select test_iniciar_sesion(
  'bbbbbbbb-0000-0000-0000-0000000000b1'::uuid,
  'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid,
  'interno', 'coordinador'
);

select lives_ok(
  $$ select id, email, rol, estado, expira_en, creado_en, archivada_en
       from public.invitaciones
      where archivada_en is null $$,
  'Coordinador lista invitaciones filtrando archivada_en is null vía public.invitaciones'
);

select throws_ok(
  $$ select token from public.invitaciones where archivada_en is null $$,
  '42703',
  null,
  'Contraprueba: token sigue siendo inalcanzable por la vista, también en la consulta nueva'
);

reset role;

select * from finish();
rollback;
