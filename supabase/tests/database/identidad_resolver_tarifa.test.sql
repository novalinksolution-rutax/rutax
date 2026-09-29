-- =============================================================================
-- identidad.resolver_tarifa / resolver_tarifa_por_comuna (20260928000002)
-- =============================================================================
-- Demuestra contra Postgres real:
--   A. Precedencia: seller > fuente > régimen legado > general; zona > sin zona;
--      vigencia más reciente; vigente_hasta vencida no cuenta.
--   B. Comuna: mapeada → su zona; sin mapear / zona inactiva / NULL → zona de
--      respaldo con zona_por_respaldo = true; mapeada sin tarifa propia → cae a
--      la tarifa SIN zona (nunca a la de respaldo).
--   C. Sin fila → NULL.
--   D. Aislamiento: un interno del tenant A NO resuelve tarifas ni zonas de B;
--      seller y conductor (incluso de A) no resuelven nada (no ven montos
--      pactados); anon no puede ejecutar.
--   E. Restricciones: fuente+régimen a la vez, duplicado activo, segunda zona
--      de respaldo, respaldo inactiva.
--   F. EQUIVALENCIA: con filas legadas (tipo_entrega puesto, fuente/zona NULL)
--      el resultado es idéntico al de `resolverTarifaVigente`
--      (src/modules/operacion/tarifas.ts), traducido a SQL tal cual — misma
--      where, mismo `order seller_id desc nulls last, vigente_desde desc`.
--      ⚠️ La traducción del legado vive en este archivo porque pgTAP no puede
--      llamar a TypeScript; si resolverTarifaVigente cambia, esta consulta
--      tiene que cambiar con él. Para que no sea un espejo vacío, además de la
--      grilla hay aserciones puntuales con el id esperado escrito a mano.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(41);

create or replace function test_iniciar_sesion(
  p_user_id uuid, p_tenant_id uuid, p_tipo_usuario text, p_rol text,
  p_seller_id uuid default null, p_driver_id uuid default null
) returns void language plpgsql as $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user_id, 'role', 'authenticated', 'tenant_id', p_tenant_id,
    'tipo_usuario', p_tipo_usuario, 'seller_id', p_seller_id,
    'driver_id', p_driver_id, 'rol', p_rol)::text, true);
end $$;

create or replace function test_cerrar_sesion() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
end $$;

-- Atajos (como postgres; SECURITY INVOKER → postgres ve todo).
create or replace function t_rt(p_tenant uuid, p_seller uuid, p_fuente text, p_tipo text, p_zona uuid, p_fecha date)
returns uuid language sql as $$
  select tarifa_id from identidad.resolver_tarifa(p_tenant, p_seller, p_fuente::operacion.fuente_pedido, p_tipo, p_zona, p_fecha)
$$;

-- -----------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------
-- Tenant A: dos sellers, zonas Urbano (Providencia), Periferia de respaldo
-- (Buin), Maipú-sin-tarifa (Maipú), Inactiva (Pirque).
-- Tenant B: una zona con Providencia y una tarifa general.
-- Tenant E: SOLO filas legadas, para la equivalencia.
insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado) values
  ('a0000000-0000-0000-0000-00000000000a', 'Courier A', 'Courier A SpA', '76900111-5', 'activo'),
  ('b0000000-0000-0000-0000-00000000000b', 'Courier B', 'Courier B SpA', '76900222-7', 'activo'),
  ('e0000000-0000-0000-0000-00000000000e', 'Courier E', 'Courier E SpA', '76900333-9', 'activo');

insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'Seller A1', '77900111-3', 'C', 'a1@rt.test', 'activo'),
  ('a2000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'Seller A2', '77900222-5', 'C', 'a2@rt.test', 'activo'),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'Seller B1', '77900333-7', 'C', 'b1@rt.test', 'activo'),
  ('e1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000e', 'Seller E1', '77900444-9', 'C', 'e1@rt.test', 'activo'),
  ('e2000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-00000000000e', 'Seller E2', '77900555-0', 'C', 'e2@rt.test', 'activo');

insert into identidad.zonas (id, tenant_id, nombre, activa, es_respaldo) values
  ('a0000000-2000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'Urbano',    true,  false),
  ('a0000000-2000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'Periferia', true,  true),
  ('a0000000-2000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', 'Sin tarifa', true, false),
  ('a0000000-2000-0000-0000-000000000004', 'a0000000-0000-0000-0000-00000000000a', 'Inactiva',  false, false),
  ('b0000000-2000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'Urbano B',  true,  true);

insert into identidad.zona_comunas (tenant_id, zona_id, comuna) values
  ('a0000000-0000-0000-0000-00000000000a', 'a0000000-2000-0000-0000-000000000001', 'Providencia'),
  ('a0000000-0000-0000-0000-00000000000a', 'a0000000-2000-0000-0000-000000000002', 'Buin'),
  ('a0000000-0000-0000-0000-00000000000a', 'a0000000-2000-0000-0000-000000000003', 'Maipú'),
  ('a0000000-0000-0000-0000-00000000000a', 'a0000000-2000-0000-0000-000000000004', 'Pirque'),
  ('b0000000-0000-0000-0000-00000000000b', 'b0000000-2000-0000-0000-000000000001', 'Providencia');

-- Tarifas de A (ids a0000000-3000-…-0000000000NN). Filas NUEVAS: tipo_entrega NULL.
insert into identidad.tarifas (id, tenant_id, seller_id, fuente, tipo_entrega, zona_id, monto_clp, monto_conductor_clp, vigente_desde, vigente_hasta) values
  -- 01 general del tenant, sin zona
  ('a0000000-3000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', null, null, null, null, 3000, 2000, '2026-01-01', null),
  -- 02 general, zona Urbano
  ('a0000000-3000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', null, null, null, 'a0000000-2000-0000-0000-000000000001', 3500, 2400, '2026-01-01', null),
  -- 03 general, zona Periferia (respaldo)
  ('a0000000-3000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', null, null, null, 'a0000000-2000-0000-0000-000000000002', 4000, 2900, '2026-01-01', null),
  -- 04 régimen legado same_day, sin zona, vence el 2026-05-31
  ('a0000000-3000-0000-0000-000000000004', 'a0000000-0000-0000-0000-00000000000a', null, null, 'same_day', null, 3200, 2100, '2026-01-01', '2026-05-31'),
  -- 05 fuente shopify, sin zona
  ('a0000000-3000-0000-0000-000000000005', 'a0000000-0000-0000-0000-00000000000a', null, 'shopify', null, null, 3300, 2200, '2026-01-01', null),
  -- 06 seller A1, general, sin zona
  ('a0000000-3000-0000-0000-000000000006', 'a0000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001', null, null, null, 2800, 2000, '2026-01-01', null),
  -- 07 general sin zona, vigencia más reciente (desde 2026-06-01)
  ('a0000000-3000-0000-0000-000000000007', 'a0000000-0000-0000-0000-00000000000a', null, null, null, null, 3100, 2050, '2026-06-01', null),
  -- 08 fuente shopify INACTIVA con vigencia más reciente: no debe contar nunca
  ('a0000000-3000-0000-0000-000000000008', 'a0000000-0000-0000-0000-00000000000a', null, 'shopify', null, null, 9999, 9999, '2026-02-01', null);
update identidad.tarifas set estado = 'inactiva' where id = 'a0000000-3000-0000-0000-000000000008';

-- Tarifa de B.
insert into identidad.tarifas (id, tenant_id, seller_id, fuente, tipo_entrega, zona_id, monto_clp, monto_conductor_clp, vigente_desde) values
  ('b0000000-3000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', null, null, null, 'b0000000-2000-0000-0000-000000000001', 5000, 3000, '2026-01-01');

-- Tarifas LEGADAS de E (tipo_entrega puesto, fuente y zona NULL).
insert into identidad.tarifas (id, tenant_id, seller_id, tipo_entrega, monto_clp, monto_conductor_clp, vigente_desde, vigente_hasta) values
  ('e0000000-3000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000e', null, 'same_day', 3000, 2000, '2026-01-01', null),
  ('e0000000-3000-0000-0000-000000000002', 'e0000000-0000-0000-0000-00000000000e', null, 'same_day', 3400, 2300, '2026-04-01', null),
  ('e0000000-3000-0000-0000-000000000003', 'e0000000-0000-0000-0000-00000000000e', null, 'flex',     2500, 1800, '2026-01-01', '2026-03-31'),
  ('e0000000-3000-0000-0000-000000000004', 'e0000000-0000-0000-0000-00000000000e', 'e1000000-0000-0000-0000-000000000001', 'same_day', 2900, 2000, '2026-02-01', null),
  ('e0000000-3000-0000-0000-000000000005', 'e0000000-0000-0000-0000-00000000000e', 'e1000000-0000-0000-0000-000000000001', 'flex',     2400, 1700, '2026-05-01', null),
  ('e0000000-3000-0000-0000-000000000006', 'e0000000-0000-0000-0000-00000000000e', 'e2000000-0000-0000-0000-000000000002', 'flex',     2600, 1900, '2026-01-15', null),
  ('e0000000-3000-0000-0000-000000000007', 'e0000000-0000-0000-0000-00000000000e', null, 'flex',     9999, 9999, '2026-03-01', null);
update identidad.tarifas set estado = 'inactiva' where id = 'e0000000-3000-0000-0000-000000000007';

-- =============================================================================
-- A. Precedencia (fecha 2026-03-01 salvo indicación)
-- =============================================================================
select is(t_rt('a0000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001', 'shopify', 'same_day', 'a0000000-2000-0000-0000-000000000001', '2026-03-01'),
          'a0000000-3000-0000-0000-000000000006'::uuid,
          'seller gana a fuente, a régimen y a zona');

select is((select array[por_seller, por_fuente, por_regimen, por_zona]
           from identidad.resolver_tarifa('a0000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001', 'shopify', 'same_day', 'a0000000-2000-0000-0000-000000000001', '2026-03-01')),
          array[true, false, false, false],
          'los booleanos dicen por qué ganó (por_seller)');

select is(t_rt('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'shopify', 'same_day', 'a0000000-2000-0000-0000-000000000001', '2026-03-01'),
          'a0000000-3000-0000-0000-000000000005'::uuid,
          'fuente gana a régimen legado y a general-con-zona');

select is((select array[por_seller, por_fuente, por_regimen, por_zona]
           from identidad.resolver_tarifa('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'shopify', 'same_day', null, '2026-03-01')),
          array[false, true, false, false],
          'booleanos: por_fuente');

select is(t_rt('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'rutax_manual', 'same_day', 'a0000000-2000-0000-0000-000000000001', '2026-03-01'),
          'a0000000-3000-0000-0000-000000000004'::uuid,
          'régimen legado gana a general (aunque la general tenga zona)');

select is(t_rt('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'ml_flex', 'flex', 'a0000000-2000-0000-0000-000000000001', '2026-03-01'),
          'a0000000-3000-0000-0000-000000000002'::uuid,
          'zona gana a sin zona');

select is((select array[por_seller, por_fuente, por_regimen, por_zona]
           from identidad.resolver_tarifa('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'ml_flex', 'flex', 'a0000000-2000-0000-0000-000000000001', '2026-03-01')),
          array[false, false, false, true],
          'booleanos: por_zona');

select is(t_rt('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'ml_flex', 'flex', null, '2026-03-01'),
          'a0000000-3000-0000-0000-000000000001'::uuid,
          'sin zona: solo candidatas sin zona (la de Urbano no aplica)');

select is(t_rt('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'ml_flex', 'flex', null, '2026-07-01'),
          'a0000000-3000-0000-0000-000000000007'::uuid,
          'a igual especificidad gana la vigencia más reciente');

select is(t_rt('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'rutax_manual', 'same_day', null, '2026-07-01'),
          'a0000000-3000-0000-0000-000000000007'::uuid,
          'régimen legado vencido (vigente_hasta) deja de contar');

select is(t_rt('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'shopify', 'same_day', null, '2026-03-01'),
          'a0000000-3000-0000-0000-000000000005'::uuid,
          'tarifa inactiva no compite aunque sea más reciente');

select is(t_rt('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'ml_flex', 'flex', 'b0000000-2000-0000-0000-000000000001', '2026-03-01'),
          'a0000000-3000-0000-0000-000000000001'::uuid,
          'una zona de OTRO tenant no hace calzar ninguna tarifa con zona');

-- =============================================================================
-- B. Resolución por comuna y zona de respaldo
-- =============================================================================
select is((select array[tarifa_id::text, zona_id::text, zona_por_respaldo::text]
           from identidad.resolver_tarifa_por_comuna('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'ml_flex', 'flex', 'Providencia', '2026-03-01')),
          array['a0000000-3000-0000-0000-000000000002', 'a0000000-2000-0000-0000-000000000001', 'false'],
          'comuna mapeada → su zona y su tarifa, sin aviso');

select is((select array[tarifa_id::text, zona_id::text, zona_por_respaldo::text]
           from identidad.resolver_tarifa_por_comuna('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'ml_flex', 'flex', 'Lampa', '2026-03-01')),
          array['a0000000-3000-0000-0000-000000000003', 'a0000000-2000-0000-0000-000000000002', 'true'],
          'comuna sin mapear → se cobra como la zona de respaldo y avisa');

select is((select array[tarifa_id::text, zona_id::text, zona_por_respaldo::text]
           from identidad.resolver_tarifa_por_comuna('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'ml_flex', 'flex', 'Pirque', '2026-03-01')),
          array['a0000000-3000-0000-0000-000000000003', 'a0000000-2000-0000-0000-000000000002', 'true'],
          'comuna mapeada a zona INACTIVA → respaldo y avisa');

select is((select array[tarifa_id::text, zona_id::text, zona_por_respaldo::text]
           from identidad.resolver_tarifa_por_comuna('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'ml_flex', 'flex', null, '2026-03-01')),
          array['a0000000-3000-0000-0000-000000000003', 'a0000000-2000-0000-0000-000000000002', 'true'],
          'comuna NULL (ilegible) → respaldo y avisa');

select is((select array[tarifa_id::text, zona_id::text, zona_por_respaldo::text]
           from identidad.resolver_tarifa_por_comuna('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'ml_flex', 'flex', 'Maipú', '2026-03-01')),
          array['a0000000-3000-0000-0000-000000000001', 'a0000000-2000-0000-0000-000000000003', 'false'],
          'comuna mapeada a zona SIN tarifa → tarifa sin zona, nunca la de respaldo');

select is((select array[tarifa_id::text, zona_id::text, zona_por_respaldo::text]
           from identidad.resolver_tarifa_por_comuna('a0000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001', 'ml_flex', 'flex', 'Lampa', '2026-03-01')),
          array['a0000000-3000-0000-0000-000000000006', 'a0000000-2000-0000-0000-000000000002', 'true'],
          'respaldo con seller específico: gana el seller, el aviso se conserva');

-- Tenant sin zona de respaldo: comuna sin mapear → zona NULL, sin aviso,
-- tarifa sin zona (E solo tiene legadas).
select is((select array[tarifa_id::text, zona_id::text, zona_por_respaldo::text]
           from identidad.resolver_tarifa_por_comuna('e0000000-0000-0000-0000-00000000000e', 'e2000000-0000-0000-0000-000000000002', 'rutax_manual', 'same_day', 'Lampa', '2026-03-01')),
          array['e0000000-3000-0000-0000-000000000001', null, 'false'],
          'sin zona de respaldo → zona NULL, sin aviso, tarifa sin zona');

-- =============================================================================
-- C. Sin fila → NULL
-- =============================================================================
select is(t_rt('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'ml_flex', 'flex', null, '2025-12-31'),
          null::uuid,
          'antes de toda vigencia → NULL');

select is((select array[tarifa_id::text, zona_id::text, zona_por_respaldo::text]
           from identidad.resolver_tarifa_por_comuna('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'ml_flex', 'flex', 'Lampa', '2025-12-31')),
          array[null, 'a0000000-2000-0000-0000-000000000002', 'true'],
          'por comuna sin tarifa: devuelve fila con tarifa NULL y conserva zona y aviso');

select is(t_rt('e0000000-0000-0000-0000-00000000000e', 'e2000000-0000-0000-0000-000000000002', 'ml_flex', 'flex', null, '2025-06-01'),
          null::uuid,
          'tenant con solo legadas, fecha sin vigencia → NULL');

-- =============================================================================
-- D. Aislamiento
-- =============================================================================
-- Interno de A resolviendo A: funciona (la RLS deja ver lo propio).
select test_iniciar_sesion('a0000000-9000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'interno', 'dueno');
select is((select tarifa_id from identidad.resolver_tarifa('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'ml_flex', 'flex', 'a0000000-2000-0000-0000-000000000001', '2026-03-01')),
          'a0000000-3000-0000-0000-000000000002'::uuid,
          'interno A resuelve la tarifa de su tenant');
select is((select array[tarifa_id::text, zona_id::text, zona_por_respaldo::text]
           from identidad.resolver_tarifa_por_comuna('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'ml_flex', 'flex', 'Lampa', '2026-03-01')),
          array['a0000000-3000-0000-0000-000000000003', 'a0000000-2000-0000-0000-000000000002', 'true'],
          'interno A resuelve el respaldo de su tenant');

-- Interno de A pidiendo el tenant B: nada.
select is((select tarifa_id from identidad.resolver_tarifa('b0000000-0000-0000-0000-00000000000b', 'b1000000-0000-0000-0000-000000000001', 'ml_flex', 'flex', 'b0000000-2000-0000-0000-000000000001', '2026-03-01')),
          null::uuid,
          'interno A NO resuelve tarifa del tenant B');
select is((select array[tarifa_id::text, zona_id::text, zona_por_respaldo::text]
           from identidad.resolver_tarifa_por_comuna('b0000000-0000-0000-0000-00000000000b', 'b1000000-0000-0000-0000-000000000001', 'ml_flex', 'flex', 'Providencia', '2026-03-01')),
          array[null, null, 'false'],
          'interno A NO resuelve zona ni tarifa del tenant B por comuna');
select test_cerrar_sesion();

-- Interno de B resolviendo B: funciona (la negativa de arriba no es vacía).
select test_iniciar_sesion('b0000000-9000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'interno', 'dueno');
select is((select tarifa_id from identidad.resolver_tarifa_por_comuna('b0000000-0000-0000-0000-00000000000b', 'b1000000-0000-0000-0000-000000000001', 'ml_flex', 'flex', 'Providencia', '2026-03-01')),
          'b0000000-3000-0000-0000-000000000001'::uuid,
          'interno B sí resuelve la tarifa de B');
select is((select tarifa_id from identidad.resolver_tarifa('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'ml_flex', 'flex', null, '2026-03-01')),
          null::uuid,
          'interno B NO resuelve tarifa del tenant A');
select test_cerrar_sesion();

-- Seller de A: no ve montos pactados, ni siquiera los suyos.
select test_iniciar_sesion('a0000000-9000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'seller', 'seller', 'a1000000-0000-0000-0000-000000000001');
select is((select tarifa_id from identidad.resolver_tarifa('a0000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001', 'ml_flex', 'flex', null, '2026-03-01')),
          null::uuid,
          'seller NO resuelve ni su propia tarifa (dato interno del courier)');
select is((select array[tarifa_id::text, zona_id::text]
           from identidad.resolver_tarifa_por_comuna('a0000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001', 'ml_flex', 'flex', 'Providencia', '2026-03-01')),
          array[null, null]::text[],
          'seller NO ve zonas internas del courier');
select test_cerrar_sesion();

-- Conductor de A: igual.
select test_iniciar_sesion('a0000000-9000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', 'conductor', 'conductor', null, 'a0000000-8000-0000-0000-000000000001');
select is((select tarifa_id from identidad.resolver_tarifa('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'ml_flex', 'flex', null, '2026-03-01')),
          null::uuid,
          'conductor NO resuelve tarifas');
select test_cerrar_sesion();

-- anon: sin EXECUTE.
select is(has_function_privilege('anon', 'identidad.resolver_tarifa(uuid, uuid, operacion.fuente_pedido, text, uuid, date)', 'execute'),
          false, 'anon no puede ejecutar resolver_tarifa');
select is(has_function_privilege('anon', 'identidad.resolver_tarifa_por_comuna(uuid, uuid, operacion.fuente_pedido, text, text, date)', 'execute'),
          false, 'anon no puede ejecutar resolver_tarifa_por_comuna');

-- Las vistas espejo siguen siendo security_invoker (create or replace view
-- reemplaza opciones).
select is((select reloptions from pg_class where oid = 'public.tarifas'::regclass),
          array['security_invoker=true'], 'public.tarifas sigue con security_invoker');

-- =============================================================================
-- E. Restricciones
-- =============================================================================
select throws_ok(
  $$insert into identidad.tarifas (tenant_id, fuente, tipo_entrega, monto_clp, monto_conductor_clp, vigente_desde)
    values ('a0000000-0000-0000-0000-00000000000a', 'shopify', 'same_day', 1, 1, '2026-01-01')$$,
  '23514', null, 'fuente y régimen a la vez → CHECK');

select throws_ok(
  $$insert into identidad.tarifas (tenant_id, monto_clp, monto_conductor_clp, vigente_desde)
    values ('a0000000-0000-0000-0000-00000000000a', 1, 1, '2026-01-01')$$,
  '23505', null, 'segunda general activa con la misma vigencia (NULLs iguales) → único');

select throws_ok(
  $$insert into identidad.zonas (tenant_id, nombre, es_respaldo)
    values ('a0000000-0000-0000-0000-00000000000a', 'Otra periferia', true)$$,
  '23505', null, 'segunda zona de respaldo en el mismo tenant → único');

select throws_ok(
  $$update identidad.zonas set activa = false where id = 'a0000000-2000-0000-0000-000000000002'$$,
  '23514', null, 'la zona de respaldo no se puede desactivar');

-- =============================================================================
-- F. Equivalencia con resolverTarifaVigente sobre filas legadas
-- =============================================================================
-- Puntuales, con el id esperado escrito a mano (la grilla de abajo no puede
-- ser un espejo vacío).
select is(t_rt('e0000000-0000-0000-0000-00000000000e', 'e2000000-0000-0000-0000-000000000002', 'rutax_manual', 'same_day', null, '2026-05-01'),
          'e0000000-3000-0000-0000-000000000002'::uuid,
          'legado: sin override, gana la de vigencia más reciente');
select is(t_rt('e0000000-0000-0000-0000-00000000000e', 'e1000000-0000-0000-0000-000000000001', 'rutax_manual', 'same_day', null, '2026-05-01'),
          'e0000000-3000-0000-0000-000000000004'::uuid,
          'legado: override del seller gana aunque la del tenant sea más reciente');

-- Grilla: 2 sellers × 2 regímenes × 7 fechas × (con y sin zona), contra la
-- consulta de resolverTarifaVigente traducida a SQL. set_eq sobre el conjunto
-- exacto de tuplas (seller, régimen, fecha, zona?, tarifa).
select set_eq(
  $$
  select s.id as seller, r.tipo, f.fecha, z.zona, identidad_rt.tarifa_id
  from (values ('e1000000-0000-0000-0000-000000000001'::uuid), ('e2000000-0000-0000-0000-000000000002'::uuid)) s(id)
  cross join (values ('flex'), ('same_day')) r(tipo)
  cross join (values ('2025-12-31'::date), ('2026-01-01'), ('2026-01-20'), ('2026-02-15'), ('2026-03-31'), ('2026-04-01'), ('2026-06-01')) f(fecha)
  cross join (values (null::uuid), ('a0000000-2000-0000-0000-000000000001'::uuid)) z(zona)
  left join lateral identidad.resolver_tarifa(
    'e0000000-0000-0000-0000-00000000000e', s.id,
    case r.tipo when 'flex' then 'ml_flex' else 'rutax_manual' end::operacion.fuente_pedido,
    r.tipo, z.zona, f.fecha) identidad_rt on true
  $$,
  $$
  select s.id as seller, r.tipo, f.fecha, z.zona,
         (select t.id
          from identidad.tarifas t
          where t.tenant_id = 'e0000000-0000-0000-0000-00000000000e'
            and t.tipo_entrega::text = r.tipo
            and t.estado = 'activa'
            and t.vigente_desde <= f.fecha
            and (t.vigente_hasta is null or t.vigente_hasta >= f.fecha)
            and (t.seller_id = s.id or t.seller_id is null)
          order by t.seller_id desc nulls last, t.vigente_desde desc
          limit 1) as tarifa_id
  from (values ('e1000000-0000-0000-0000-000000000001'::uuid), ('e2000000-0000-0000-0000-000000000002'::uuid)) s(id)
  cross join (values ('flex'), ('same_day')) r(tipo)
  cross join (values ('2025-12-31'::date), ('2026-01-01'), ('2026-01-20'), ('2026-02-15'), ('2026-03-31'), ('2026-04-01'), ('2026-06-01')) f(fecha)
  cross join (values (null::uuid), ('a0000000-2000-0000-0000-000000000001'::uuid)) z(zona)
  $$,
  'equivalencia: con filas legadas, resolver_tarifa = resolverTarifaVigente en toda la grilla'
);

select * from finish();
rollback;
