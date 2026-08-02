-- =============================================================================
-- Pruebas de aislamiento — schema `plataforma` (backstage Rutax → courier)
-- =============================================================================
-- Demuestra, contra una base Postgres real (no mocks de aplicación), que el
-- schema `plataforma` sigue siendo DENY-ALL para el rol `authenticated`
-- (couriers, sellers y conductores) DESPUÉS de la migración aditiva
-- 20260710000001, que agregó columnas nuevas a plataforma.suscripciones
-- (periodicidad, auto_cobro_habilitado, mandato_estado, mandato_ref,
-- plan_anterior_id, cambio_efectivo_desde).
--
-- A diferencia del resto del repo, `plataforma` NO tiene políticas para
-- authenticated: RLS enable+force SIN políticas + grants revocados = deny-all.
-- El courier NUNCA descubre su plan/monto/mandato mirando la DB; solo ve lo que
-- el super-admin le muestra por la UI. Este archivo deja el aserto EXPLÍCITO,
-- incluyendo las columnas nuevas (un intento de leerlas cae en 42501 igual que
-- la tabla completa — el deny-all no depende de columnas).
--
-- Cobertura F2 "Ola 0" (migración 20260711000001): la tabla nueva
-- plataforma.super_admins (identidad real del backstage) también es deny-all para
-- authenticated — un interno del courier NO puede select/insert/update/delete, y
-- un seller tampoco. Así el courier no descubre ni la existencia del fundador.
--
-- Cobertura F2 "Ola 1" (migración 20260712000001, gap 6): la columna nueva
-- plataforma.suscripciones.caracteristicas_override (overrides de entitlements por
-- courier) también queda bajo el deny-all — un courier NO descubre qué features le
-- habilitamos mirando la DB. Se afirma explícitamente el 42501 sobre esa columna.
--
-- Cobertura F2 "Ola 2" (migración 20260712000004, facturación profunda): la columna
-- nueva plataforma.periodos_suscripcion.concepto (distingue el período regular
-- 'periodo' del ajuste de proración 'ajuste_proracion') también queda bajo el
-- deny-all — un courier/seller NO descubre sus períodos ni sus ajustes de proración
-- mirando la DB. Se afirma explícitamente el 42501 sobre esa columna, para el interno
-- y para el seller, más el contrato de esquema (has_column, col_type_is, CHECK).
--
-- Cobertura F2 "Ola 2" — fixes de dinero B-1 y ALTO (migraciones 20260712000005 y
-- 20260712000006):
--   · B-1 (20260712000005): el UNIQUE de periodos_suscripcion pasó de
--     (suscripcion_id, periodo_inicio) a (suscripcion_id, periodo_inicio, concepto),
--     para que un 'ajuste_proracion' con periodo_inicio=hoy conviva con el 'periodo'
--     regular del mismo día en vez de descartarse en silencio. Se prueba de forma
--     CONDUCTUAL (insertando como postgres) que: un ajuste convive con el período
--     regular del mismo periodo_inicio; un período regular duplicado sigue chocando
--     (idempotencia del cron); y un ajuste duplicado del mismo día sigue chocando.
--     Además se afirma que el UNIQUE viejo YA NO existe y el nuevo SÍ.
--   · ALTO (20260712000006): columna nueva
--     plataforma.suscripciones.periodicidad_pendiente (difiere un cambio de
--     periodicidad al próximo ciclo, sin prorratear cruzando unidades). Aditiva sobre
--     suscripciones (ya deny-all): se afirma el contrato de esquema (has_column,
--     col_type_is, CHECK mensual/anual) y el 42501 para interno y seller.
--
-- Cobertura F3 "gap 7" (migración 20260713000001): tabla nueva
-- plataforma.comunicaciones (comunicaciones de Rutax → courier, banner in-app).
-- Sigue el MISMO deny-all que el resto de plataforma: RLS enable+force SIN
-- políticas + grants revocados. El courier NUNCA la lee directo — el agregador
-- src/lib/avisos la proyecta courier-safe vía service_role. Se prueba su
-- existencia (has_table), su RLS enable+force y que un interno del courier
-- (authenticated) NO puede SELECT/INSERT/UPDATE/DELETE sobre ella (deny-all, 42501),
-- de modo que no descubre comunicaciones desactivadas, borradores ni las de otros.
--
-- Qué se prueba:
--   Contrato de esquema:
--     1-6.  Existen las 6 columnas nuevas en plataforma.suscripciones.
--     7-8.  periodicidad es text; mandato_ref es uuid.
--     9.    El enum identidad.tipo_secreto incluye 'mandato_suscripcion_fintoc'.
--     10.   plataforma.suscripciones tiene RLS enable + force.
--     11.   El CHECK de pagos_plataforma.metodo admite 'fintoc_recurrente'.
--     12.   Existe la tabla plataforma.super_admins.
--     13.   plataforma.super_admins tiene RLS enable + force.
--     14.   Existe la columna caracteristicas_override (gap 6, Ola 1).
--     15.   caracteristicas_override es jsonb.
--     16.   Existe la columna periodos_suscripcion.concepto (Ola 2).
--     17.   concepto es text.
--     18.   El CHECK de periodos_suscripcion.concepto admite 'periodo' y
--           'ajuste_proracion' (distinción para MRR/ARR y UI de cobros).
--     19.   Existe la columna suscripciones.periodicidad_pendiente (fix ALTO).
--     20.   periodicidad_pendiente es text.
--     21.   El CHECK de periodicidad_pendiente admite 'mensual' y 'anual'.
--     22.   El UNIQUE nuevo (suscripcion_id, periodo_inicio, concepto) existe (fix B-1).
--     23.   El UNIQUE viejo (…, periodo_inicio) YA NO existe (reemplazado por B-1).
--   Conducta del nuevo UNIQUE (fix B-1, insertando como postgres):
--     24.   Un 'periodo' regular con periodo_inicio=hoy inserta OK.
--     25.   Un 'ajuste_proracion' con el MISMO periodo_inicio inserta OK (convive —
--           el ajuste ya no se descarta en silencio).
--     26.   Un SEGUNDO 'periodo' con el mismo periodo_inicio choca → 23505
--           (idempotencia del cron generarPeriodos intacta).
--     27.   Un SEGUNDO 'ajuste_proracion' del mismo día choca → 23505 (sin duplicar
--           el cargo de proración).
--   Deny-all para el interno del courier (authenticated):
--     28.   SELECT * de suscripciones → 42501.
--     29.   SELECT de las columnas NUEVAS (incl. caracteristicas_override y
--           periodicidad_pendiente) → 42501 (el deny-all cubre lo agregado).
--     30.   SELECT SOLO de caracteristicas_override → 42501 (el courier no descubre
--           sus entitlements forzados mirando la DB).
--     31.   SELECT SOLO de periodicidad_pendiente → 42501 (el courier no descubre su
--           cambio de periodicidad pendiente mirando la DB).
--     32.   Cross-tenant / mismo-tenant: ni siquiera su propia fila es legible
--           (deny-all es más fuerte que el filtro por tenant) → 42501.
--     33.   SELECT * de planes → 42501.
--     34.   SELECT * de periodos_suscripcion → 42501.
--     35.   SELECT SOLO de concepto de periodos_suscripcion → 42501 (el deny-all
--           cubre la columna nueva de la Ola 2).
--     36.   SELECT * de pagos_plataforma → 42501.
--     37-40. super_admins: SELECT / INSERT / UPDATE / DELETE → 42501 (el courier
--           no lee ni escribe la identidad del backstage).
--   Deny-all para el seller (authenticated):
--     41.   SELECT de suscripciones (incl. caracteristicas_override,
--           periodicidad_pendiente) → 42501.
--     42.   SELECT SOLO de concepto de periodos_suscripcion → 42501 (el seller
--           tampoco descubre los ajustes de proración del courier).
--     43.   SELECT de super_admins → 42501.
--   Escritura del interno:
--     44.   INSERT en suscripciones como authenticated → 42501.
--   Cobertura F3 gap 7 — plataforma.comunicaciones (banner de Rutax al courier):
--     Contrato de esquema:
--     45.   Existe la tabla plataforma.comunicaciones.
--     46.   plataforma.comunicaciones tiene RLS enable + force.
--     Deny-all para el interno del courier (authenticated):
--     47.   SELECT * de comunicaciones → 42501 (no descubre borradores/desactivadas).
--     48.   INSERT en comunicaciones → 42501 (no publica comunicaciones en nombre de Rutax).
--     49.   UPDATE de comunicaciones → 42501 (no altera lo que Rutax le comunica).
--     50.   DELETE de comunicaciones → 42501 (no borra el rastro de la comunicación).
--
-- Mecanismo de sesión simulada: idéntico a rls_aislamiento_payouts.test.sql —
-- fijamos `request.jwt.claims` y conmutamos el rol a `authenticated`.
--
-- Ejecutar: npx supabase test db
-- =============================================================================

begin;

select plan(50);

-- -----------------------------------------------------------------------------
-- Helpers de sesión simulada (cada .test.sql corre en su propia transacción).
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
      'sub',          p_user_id,
      'role',         'authenticated',
      'tenant_id',    p_tenant_id,
      'tipo_usuario', p_tipo_usuario,
      'seller_id',    p_seller_id,
      'driver_id',    p_driver_id,
      'rol',          p_rol
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
-- Fixture (insertado como postgres, que bypasea RLS): un tenant con su
-- suscripción, usando un plan ya sembrado por la migración 0015. Sirve para
-- (a) validar que las columnas nuevas son escribibles y (b) demostrar que ni
-- siquiera la propia fila del tenant es legible por un authenticated de ESE
-- tenant (deny-all). No hace falta más — el 42501 salta en el chequeo de
-- permisos, antes de tocar filas.
-- -----------------------------------------------------------------------------
insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
values ('cccccccc-0000-0000-0000-000000000001', 'Courier Plat', 'Courier Plat SpA', '76999999-9', 'activo')
on conflict (id) do nothing;

insert into plataforma.suscripciones
  (tenant_id, plan_id, estado, periodicidad, periodicidad_pendiente, auto_cobro_habilitado,
   mandato_estado, caracteristicas_override)
select
  'cccccccc-0000-0000-0000-000000000001', p.id, 'activa', 'anual', 'mensual', true, 'activo',
  '{"api_publica": true, "conductores_max": 10}'::jsonb
from plataforma.planes p
where p.nombre = 'Starter'
on conflict (tenant_id) do nothing;

-- =============================================================================
-- BLOQUE 0 · Contrato de esquema: existen las columnas nuevas y sus tipos.
-- =============================================================================
select has_column('plataforma', 'suscripciones', 'periodicidad',
  'plataforma.suscripciones tiene la columna periodicidad');
select has_column('plataforma', 'suscripciones', 'auto_cobro_habilitado',
  'plataforma.suscripciones tiene la columna auto_cobro_habilitado');
select has_column('plataforma', 'suscripciones', 'mandato_estado',
  'plataforma.suscripciones tiene la columna mandato_estado');
select has_column('plataforma', 'suscripciones', 'mandato_ref',
  'plataforma.suscripciones tiene la columna mandato_ref');
select has_column('plataforma', 'suscripciones', 'plan_anterior_id',
  'plataforma.suscripciones tiene la columna plan_anterior_id');
select has_column('plataforma', 'suscripciones', 'cambio_efectivo_desde',
  'plataforma.suscripciones tiene la columna cambio_efectivo_desde');

select col_type_is('plataforma', 'suscripciones', 'periodicidad', 'text',
  'periodicidad es text');
select col_type_is('plataforma', 'suscripciones', 'mandato_ref', 'uuid',
  'mandato_ref es uuid (referencia opaca al secreto cifrado)');

select ok(
  exists(
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'tipo_secreto'
       and e.enumlabel = 'mandato_suscripcion_fintoc'
  ),
  'El enum identidad.tipo_secreto incluye mandato_suscripcion_fintoc'
);

-- RLS sigue enable + force en plataforma.suscripciones (el deny-all descansa
-- en RLS forzada + cero políticas para authenticated).
select results_eq(
  $$ select c.relrowsecurity and c.relforcerowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'plataforma' and c.relname = 'suscripciones' $$,
  $$ values (true) $$,
  'plataforma.suscripciones conserva RLS enable + force'
);

-- Fix de correctitud (migración 20260710000002): el CHECK de
-- pagos_plataforma.metodo debe admitir 'fintoc_recurrente' (auto-cobro F1-E).
-- Sin esto, el job de auto-cobro insertaba un valor que el CHECK rechazaba (23514).
select ok(
  exists(
    select 1 from pg_constraint
     where conrelid = 'plataforma.pagos_plataforma'::regclass
       and conname = 'pagos_plataforma_metodo_check'
       and pg_get_constraintdef(oid) like '%fintoc_recurrente%'
  ),
  'El CHECK de plataforma.pagos_plataforma.metodo admite fintoc_recurrente (auto-cobro recurrente)'
);

-- Tabla nueva de la Ola 0 (migración 20260711000001): identidad real del backstage.
select has_table('plataforma', 'super_admins',
  'Existe la tabla plataforma.super_admins (identidad real del backstage /admin)');

-- RLS enable + force en super_admins: el deny-all descansa en RLS forzada + cero
-- políticas para authenticated, idéntico al resto de plataforma.
select results_eq(
  $$ select c.relrowsecurity and c.relforcerowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'plataforma' and c.relname = 'super_admins' $$,
  $$ values (true) $$,
  'plataforma.super_admins tiene RLS enable + force'
);

-- Columna nueva de la Ola 1 (migración 20260712000001, gap 6): override de
-- entitlements por courier. Aditiva sobre suscripciones (ya deny-all).
select has_column('plataforma', 'suscripciones', 'caracteristicas_override',
  'plataforma.suscripciones tiene la columna caracteristicas_override (gap 6, override por courier)');
select col_type_is('plataforma', 'suscripciones', 'caracteristicas_override', 'jsonb',
  'caracteristicas_override es jsonb');

-- Columna nueva de la Ola 2 (migración 20260712000004): concepto del período,
-- que distingue el cobro regular ('periodo') del ajuste de proración por upgrade
-- inmediato ('ajuste_proracion'). Aditiva sobre periodos_suscripcion (ya deny-all).
select has_column('plataforma', 'periodos_suscripcion', 'concepto',
  'plataforma.periodos_suscripcion tiene la columna concepto (Ola 2, período vs ajuste de proración)');
select col_type_is('plataforma', 'periodos_suscripcion', 'concepto', 'text',
  'concepto es text');

-- El CHECK de concepto admite AMBOS valores del contrato: 'periodo' (regular) y
-- 'ajuste_proracion' (cargo puntual por upgrade). Esta distinción es la que permite
-- al cálculo de MRR/ARR (item L) excluir los ajustes y a la UI de cobros mostrarlos
-- distinto — sin ella, los dos consumidores no podrían diferenciarlos.
select ok(
  exists(
    select 1 from pg_constraint
     where conrelid = 'plataforma.periodos_suscripcion'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%concepto%'
       and pg_get_constraintdef(oid) like '%periodo%'
       and pg_get_constraintdef(oid) like '%ajuste_proracion%'
  ),
  'El CHECK de plataforma.periodos_suscripcion.concepto admite periodo y ajuste_proracion'
);

-- Columna nueva del fix ALTO (migración 20260712000006): periodicidad DESTINO de un
-- cambio de periodicidad DIFERIDO. Aditiva sobre suscripciones (ya deny-all).
select has_column('plataforma', 'suscripciones', 'periodicidad_pendiente',
  'plataforma.suscripciones tiene la columna periodicidad_pendiente (fix ALTO, cambio de periodicidad diferido)');
select col_type_is('plataforma', 'suscripciones', 'periodicidad_pendiente', 'text',
  'periodicidad_pendiente es text');

-- El CHECK de periodicidad_pendiente admite el mismo dominio que `periodicidad`:
-- 'mensual' y 'anual' (la periodicidad destino solo puede ser una de esas dos).
select ok(
  exists(
    select 1 from pg_constraint
     where conrelid = 'plataforma.suscripciones'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%periodicidad_pendiente%'
       and pg_get_constraintdef(oid) like '%mensual%'
       and pg_get_constraintdef(oid) like '%anual%'
  ),
  'El CHECK de plataforma.suscripciones.periodicidad_pendiente admite mensual y anual'
);

-- Fix B-1 (migración 20260712000005): el UNIQUE de periodos_suscripcion ahora
-- incluye `concepto`. Se afirma que el NUEVO existe y el VIEJO ya no.
select ok(
  exists(
    select 1 from pg_constraint
     where conrelid = 'plataforma.periodos_suscripcion'::regclass
       and conname = 'periodos_suscripcion_susc_periodo_concepto_uk'
       and contype = 'u'
       and pg_get_constraintdef(oid) like '%suscripcion_id, periodo_inicio, concepto%'
  ),
  'El UNIQUE (suscripcion_id, periodo_inicio, concepto) existe (fix B-1)'
);
select ok(
  not exists(
    select 1 from pg_constraint
     where conrelid = 'plataforma.periodos_suscripcion'::regclass
       and conname = 'periodos_suscripcion_suscripcion_periodo_uk'
  ),
  'El UNIQUE viejo (suscripcion_id, periodo_inicio) YA NO existe (reemplazado por B-1)'
);

-- Tabla nueva F3 gap 7 (migración 20260713000001): comunicaciones de Rutax al
-- courier (banner in-app). Mismo deny-all que el resto de plataforma.
select has_table('plataforma', 'comunicaciones',
  'Existe la tabla plataforma.comunicaciones (banner de Rutax al courier, F3 gap 7)');

-- RLS enable + force en comunicaciones: el deny-all descansa en RLS forzada + cero
-- políticas para authenticated, idéntico al resto de plataforma.
select results_eq(
  $$ select c.relrowsecurity and c.relforcerowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'plataforma' and c.relname = 'comunicaciones' $$,
  $$ values (true) $$,
  'plataforma.comunicaciones tiene RLS enable + force'
);

-- =============================================================================
-- BLOQUE 0-bis · Conducta del nuevo UNIQUE (fix B-1) — insertando como postgres
-- (superusuario, bypasea RLS). Demuestra directamente el fix: un ajuste de
-- proración con el mismo periodo_inicio que el período regular ya NO se descarta,
-- pero se sigue impidiendo duplicar el período regular y duplicar un ajuste.
-- =============================================================================
-- Período regular del ciclo vigente (concepto='periodo').
select lives_ok(
  $$ insert into plataforma.periodos_suscripcion
       (suscripcion_id, tenant_id, periodo_inicio, periodo_fin, monto_clp, estado, concepto)
     select s.id, s.tenant_id, date '2026-07-01', date '2026-07-31', 490000, 'pendiente', 'periodo'
       from plataforma.suscripciones s
      where s.tenant_id = 'cccccccc-0000-0000-0000-000000000001' $$,
  'Insertar el período regular (concepto=periodo, periodo_inicio=2026-07-01) funciona'
);

-- EL FIX B-1: un ajuste de proración con el MISMO periodo_inicio convive con el
-- período regular (distinto concepto) — antes chocaba y el cargo se perdía.
select lives_ok(
  $$ insert into plataforma.periodos_suscripcion
       (suscripcion_id, tenant_id, periodo_inicio, periodo_fin, monto_clp, estado, concepto)
     select s.id, s.tenant_id, date '2026-07-01', date '2026-07-31', 25000, 'pendiente', 'ajuste_proracion'
       from plataforma.suscripciones s
      where s.tenant_id = 'cccccccc-0000-0000-0000-000000000001' $$,
  'Un ajuste_proracion con el MISMO periodo_inicio que el período regular CONVIVE (fix B-1: ya no se descarta)'
);

-- Idempotencia del cron intacta: un SEGUNDO período regular del mismo ciclo choca.
select throws_ok(
  $$ insert into plataforma.periodos_suscripcion
       (suscripcion_id, tenant_id, periodo_inicio, periodo_fin, monto_clp, estado, concepto)
     select s.id, s.tenant_id, date '2026-07-01', date '2026-07-31', 490000, 'pendiente', 'periodo'
       from plataforma.suscripciones s
      where s.tenant_id = 'cccccccc-0000-0000-0000-000000000001' $$,
  '23505',
  null,
  'Un SEGUNDO período regular con el mismo periodo_inicio sigue chocando (23505 — idempotencia del cron)'
);

-- Sin duplicar el cargo: un SEGUNDO ajuste del mismo día también choca.
select throws_ok(
  $$ insert into plataforma.periodos_suscripcion
       (suscripcion_id, tenant_id, periodo_inicio, periodo_fin, monto_clp, estado, concepto)
     select s.id, s.tenant_id, date '2026-07-01', date '2026-07-31', 25000, 'pendiente', 'ajuste_proracion'
       from plataforma.suscripciones s
      where s.tenant_id = 'cccccccc-0000-0000-0000-000000000001' $$,
  '23505',
  null,
  'Un SEGUNDO ajuste_proracion del mismo día sigue chocando (23505 — sin duplicar el cargo)'
);

-- =============================================================================
-- BLOQUE 1 · Deny-all para el interno del courier (authenticated)
-- =============================================================================
select test_iniciar_sesion(
  'cccccccc-3333-0000-0000-000000000001'::uuid,
  'cccccccc-0000-0000-0000-000000000001'::uuid,
  'interno', 'dueno'
);

-- Tabla completa: sin USAGE/SELECT → 42501 (permiso denegado).
select throws_ok(
  $$ select * from plataforma.suscripciones $$,
  '42501',
  null,
  'Interno del courier NO puede leer plataforma.suscripciones (deny-all, 42501)'
);

-- Aserto EXPLÍCITO sobre las columnas NUEVAS: el deny-all también las cubre
-- (incl. caracteristicas_override de la Ola 1 y periodicidad_pendiente del fix ALTO).
select throws_ok(
  $$ select periodicidad, auto_cobro_habilitado, mandato_estado, mandato_ref,
            plan_anterior_id, cambio_efectivo_desde, caracteristicas_override,
            periodicidad_pendiente
       from plataforma.suscripciones $$,
  '42501',
  null,
  'Interno del courier NO puede leer las columnas nuevas de suscripciones -- incl. caracteristicas_override y periodicidad_pendiente (deny-all cubre lo agregado, 42501)'
);

-- Aserto EXPLÍCITO y aislado sobre caracteristicas_override (gap 6): el courier no
-- descubre qué entitlements le forzamos mirando la DB — solo lo que la UI le muestra.
select throws_ok(
  $$ select caracteristicas_override from plataforma.suscripciones $$,
  '42501',
  null,
  'Interno del courier NO puede leer caracteristicas_override (no descubre sus entitlements forzados, deny-all, 42501)'
);

-- Aserto EXPLÍCITO y aislado sobre periodicidad_pendiente (fix ALTO): el courier no
-- descubre su cambio de periodicidad pendiente mirando la DB.
select throws_ok(
  $$ select periodicidad_pendiente from plataforma.suscripciones $$,
  '42501',
  null,
  'Interno del courier NO puede leer periodicidad_pendiente (no descubre su cambio de periodicidad diferido, deny-all, 42501)'
);

-- Ni siquiera SU PROPIA fila (filtrando por su tenant): el deny-all es más
-- fuerte que un filtro por tenant — no hay camino de lectura.
select throws_ok(
  $$ select 1 from plataforma.suscripciones
       where tenant_id = 'cccccccc-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'Interno del courier NO puede leer NI SU PROPIA suscripción (deny-all, 42501)'
);

-- Las otras tres tablas del schema, también deny-all.
select throws_ok(
  $$ select * from plataforma.planes $$,
  '42501', null,
  'Interno del courier NO puede leer plataforma.planes (deny-all, 42501)'
);
select throws_ok(
  $$ select * from plataforma.periodos_suscripcion $$,
  '42501', null,
  'Interno del courier NO puede leer plataforma.periodos_suscripcion (deny-all, 42501)'
);
-- Aserto EXPLÍCITO sobre la columna NUEVA de la Ola 2: el deny-all también la cubre.
-- El courier no descubre sus períodos ni si tuvo un ajuste de proración mirando la DB.
select throws_ok(
  $$ select concepto from plataforma.periodos_suscripcion $$,
  '42501', null,
  'Interno del courier NO puede leer la columna concepto de periodos_suscripcion (deny-all cubre lo agregado, 42501)'
);
select throws_ok(
  $$ select * from plataforma.pagos_plataforma $$,
  '42501', null,
  'Interno del courier NO puede leer plataforma.pagos_plataforma (deny-all, 42501)'
);

-- Tabla nueva super_admins: deny-all COMPLETO (S/I/U/D). El courier no descubre ni
-- la existencia del fundador/equipo Rutax, ni puede escribir la identidad del
-- backstage. Cada operación falla en el chequeo de permisos (42501) antes de tocar
-- filas, así que no hace falta fixture.
select throws_ok(
  $$ select * from plataforma.super_admins $$,
  '42501', null,
  'Interno del courier NO puede leer plataforma.super_admins (deny-all, 42501)'
);
select throws_ok(
  $$ insert into plataforma.super_admins (usuario_id, email, nombre)
     values (gen_random_uuid(), 'intruso@courier.cl', 'Intruso') $$,
  '42501', null,
  'Interno del courier NO puede insertar en plataforma.super_admins (deny-all, 42501)'
);
select throws_ok(
  $$ update plataforma.super_admins set activo = false $$,
  '42501', null,
  'Interno del courier NO puede actualizar plataforma.super_admins (deny-all, 42501)'
);
select throws_ok(
  $$ delete from plataforma.super_admins $$,
  '42501', null,
  'Interno del courier NO puede borrar de plataforma.super_admins (deny-all, 42501)'
);

-- Tabla nueva comunicaciones (F3 gap 7): deny-all COMPLETO (S/I/U/D). Aunque la
-- comunicación esté DESTINADA al courier, éste NO la lee directo desde la DB — el
-- agregador src/lib/avisos la proyecta courier-safe vía service_role. Así el courier
-- no descubre borradores, comunicaciones desactivadas ni las dirigidas a otros, ni
-- puede publicar/alterar/borrar en nombre de Rutax. Cada operación falla en el
-- chequeo de permisos (42501) antes de tocar filas, así que no hace falta fixture.
select throws_ok(
  $$ select * from plataforma.comunicaciones $$,
  '42501', null,
  'Interno del courier NO puede leer plataforma.comunicaciones (deny-all, 42501)'
);
select throws_ok(
  $$ insert into plataforma.comunicaciones (titulo, cuerpo)
     values ('Intruso', 'Comunicación falsa en nombre de Rutax') $$,
  '42501', null,
  'Interno del courier NO puede insertar en plataforma.comunicaciones (deny-all, 42501)'
);
select throws_ok(
  $$ update plataforma.comunicaciones set activa = false $$,
  '42501', null,
  'Interno del courier NO puede actualizar plataforma.comunicaciones (deny-all, 42501)'
);
select throws_ok(
  $$ delete from plataforma.comunicaciones $$,
  '42501', null,
  'Interno del courier NO puede borrar de plataforma.comunicaciones (deny-all, 42501)'
);

-- =============================================================================
-- BLOQUE 2 · Deny-all para el seller (no ve backstage ni internos del courier)
-- =============================================================================
select test_iniciar_sesion(
  'cccccccc-3333-0000-0000-000000000003'::uuid,
  'cccccccc-0000-0000-0000-000000000001'::uuid,
  'seller', 'seller',
  p_seller_id => 'cccccccc-1111-0000-0000-000000000001'::uuid
);

select throws_ok(
  $$ select periodicidad, mandato_ref, caracteristicas_override, periodicidad_pendiente
       from plataforma.suscripciones $$,
  '42501',
  null,
  'Seller del courier NO puede leer plataforma.suscripciones ni sus columnas nuevas -- incl. caracteristicas_override y periodicidad_pendiente (deny-all, 42501)'
);

-- Ola 2: el seller tampoco descubre el concepto de los períodos (ni los ajustes de
-- proración del courier) — la columna nueva queda igual de tapada por el deny-all.
select throws_ok(
  $$ select concepto from plataforma.periodos_suscripcion $$,
  '42501',
  null,
  'Seller del courier NO puede leer la columna concepto de periodos_suscripcion (deny-all, 42501)'
);

select throws_ok(
  $$ select usuario_id, email, nombre from plataforma.super_admins $$,
  '42501',
  null,
  'Seller del courier NO puede leer plataforma.super_admins (no descubre al fundador, deny-all, 42501)'
);

-- =============================================================================
-- BLOQUE 3 · Escritura: authenticated NO inserta en el backstage (solo service_role)
-- =============================================================================
select throws_ok(
  $$ insert into plataforma.suscripciones (tenant_id, plan_id, periodicidad)
     values ('cccccccc-0000-0000-0000-000000000001', gen_random_uuid(), 'mensual') $$,
  '42501',
  null,
  'authenticated NO puede insertar en plataforma.suscripciones (deny-all de escritura, 42501)'
);

select test_cerrar_sesion();

select * from finish();

rollback;
