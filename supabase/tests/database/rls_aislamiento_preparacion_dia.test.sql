-- =============================================================================
-- Pruebas de aislamiento — Preparación del día (etapa 5)
-- =============================================================================
-- Migraciones bajo prueba:
--   20260813000005_realtime_operacion_retiro.sql
--   20260813000006_operacion_preparacion_dia_agregados.sql
-- Diseño: docs/arquitectura/retiro-y-ruteo.md §7 · plan, etapa 5.
--
-- POR QUÉ ESTE ARCHIVO ES DISTINTO DEL RESTO DE LA SUITE RLS: las dos funciones
-- que prueba son SECURITY DEFINER y leen SIN RLS. Es decir, el aislamiento entre
-- couriers NO lo impone aquí ninguna política — lo impone el `p_tenant_id` que va
-- escrito en el texto de las consultas. Si ese filtro estuviera mal en un solo
-- join, la fuga sería total y silenciosa: la pantalla de un courier mostraría las
-- visitas y la carga del día de otro, sin ningún error en ninguna parte.
--
-- Por eso el BLOQUE 2 (aislamiento cruzado, en las DOS direcciones) es lo más
-- importante de este archivo, y por eso los dos tenants se siembran CON DATOS:
-- si el tenant B estuviera vacío, "A no ve nada de B" pasaría por ausencia y no
-- probaría absolutamente nada.
--
-- Lo demás que se demuestra:
--   · Ningún rol de cliente puede EJECUTARLAS (catálogo Y comportamiento: 42501
--     real desde una sesión `authenticated`). Si pudieran, bastaría pasar el uuid
--     de otro courier.
--   · Los contadores VIVOS cuentan los escaneos `posterior_al_cierre` y el ACTA
--     congelada NO los cuenta. Son dos cifras distintas y las dos tienen que
--     salir: el acta respalda el pago del retiro al conductor (etapa 8).
--   · `bultos_de_otro_seller` cuenta el bulto ajeno aparecido en una bodega —el
--     descuadre que el retiro existe para destapar— y NO se infla con los bultos
--     sin resolver de la misma visita, de los que no se sabe de quién son.
--   · La fila de comuna desconocida SALE y va AL FINAL, aunque tenga más bultos
--     que cualquier comuna real.
--   · Tres grafías de la misma comuna ("Maipu", "MAIPU", " maipu ") caen en UNA
--     sola fila. El camino Flex guarda la comuna cruda de ML
--     (ingesta-pedidos.ts:737/:803), así que un group by sin normalizar partiría
--     la cifra con la que se reparte la flota.
--   · `ultimo_escaneo_en` sale de `recibido_en` (reloj del servidor) y no de
--     `escaneado_en` (reloj del teléfono): hay un bulto sembrado con fecha 2030.
--   · `operacion.bultos_retiro_qr` NO está en la publicación `supabase_realtime`.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(50);

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
-- Fixtures — DOS couriers, los dos con operación del mismo día
--
-- Tenant A (eeeeeeee…), día 2026-08-13:
--   · sellers S_A1 / S_A2, una bodega cada uno
--   · conductores D_A1 / D_A2
--   · SES_A1  bodega A1 (del seller S_A1), D_A1, ABIERTA, abierta_en 08:00
--       BU1 → P_A1 (comuna 'Maipu',   CON conductor de reparto)
--       BU2 → P_A2 (comuna 'MAIPU')
--       BU3   sin resolver (flex_qr que la ingesta no reconoció)
--       BU4   sin resolver (ilegible) — escaneado_en en 2030: el teléfono con la
--             hora mal puesta que NO debe mover `ultimo_escaneo_en`
--       BU10 → P_A6, DE OTRO SELLER (S_A2) en la bodega de S_A1: el bulto ajeno
--             aparecido físicamente en una bodega, que es el descuadre que el
--             retiro existe para destapar. Convive con BU3/BU4 a propósito: los
--             sin resolver NO deben inflar ese contador.
--   · SES_A2  bodega A2, D_A2, abierta_en 09:30 → se CIERRA con la función real
--       BU5 → P_A3 (comuna 'Puente Alto')
--       BU6 → P_A4 (comuna ' maipu ' — la tercera grafía, con espacios)
--       BU7   sin resolver
--       …acta congelada 3/2/1, y DESPUÉS entra
--       BU8   sin resolver, posterior_al_cierre = true  ← vivos 4, acta 3
--   · SES_A3  AYER (2026-08-12), con BU9 → P_A5 (comuna 'Renca')
--             Existe para que el filtro de fecha tenga qué dejar fuera.
--
-- Tenant B (ffffffff…), MISMO día: una visita, un bulto resuelto a 'Vitacura'
--   (con conductor de reparto) y uno sin resolver.
--
-- Cifras esperadas para A / 2026-08-13:
--   visitas   → 2 filas: SES_A1 (abierta, primero) y SES_A2 (cerrada)
--   carga     → maipu 3 (1 asignado) · puente alto 2 · NULL 4 (4 sin resolver)
--               La fila NULL tiene MÁS bultos que cualquier comuna real: va última.
-- =============================================================================
do $$
declare
  t_ea uuid := 'eeeeeeee-0000-0000-0000-0000000000e1';
  t_fb uuid := 'ffffffff-0000-0000-0000-0000000000f1';

  s_ea1 uuid := 'eeeeeeee-1111-0000-0000-0000000000e1';
  s_ea2 uuid := 'eeeeeeee-1111-0000-0000-0000000000e2';
  s_fb1 uuid := 'ffffffff-1111-0000-0000-0000000000f1';

  d_ea1 uuid := 'eeeeeeee-2222-0000-0000-0000000000e1';
  d_ea2 uuid := 'eeeeeeee-2222-0000-0000-0000000000e2';
  d_fb1 uuid := 'ffffffff-2222-0000-0000-0000000000f1';

  u_interno_a uuid := 'eeeeeeee-3333-0000-0000-0000000000e1';

  sb_ea1 uuid := 'eeeeeeee-9999-0000-0000-0000000000e1';
  sb_ea2 uuid := 'eeeeeeee-9999-0000-0000-0000000000e2';
  sb_fb1 uuid := 'ffffffff-9999-0000-0000-0000000000f1';

  p_ea1 uuid := 'eeeeeeee-6666-0000-0000-0000000000e1';
  p_ea2 uuid := 'eeeeeeee-6666-0000-0000-0000000000e2';
  p_ea3 uuid := 'eeeeeeee-6666-0000-0000-0000000000e3';
  p_ea4 uuid := 'eeeeeeee-6666-0000-0000-0000000000e4';
  p_ea5 uuid := 'eeeeeeee-6666-0000-0000-0000000000e5';
  p_ea6 uuid := 'eeeeeeee-6666-0000-0000-0000000000e6';
  p_fb1 uuid := 'ffffffff-6666-0000-0000-0000000000f1';

  ses_ea1 uuid := 'eeeeeeee-7777-0000-0000-0000000000e1';
  ses_ea2 uuid := 'eeeeeeee-7777-0000-0000-0000000000e2';
  ses_ea3 uuid := 'eeeeeeee-7777-0000-0000-0000000000e3';
  ses_fb1 uuid := 'ffffffff-7777-0000-0000-0000000000f1';
begin
  insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado)
  values
    (t_ea, 'Courier Prep A', 'Courier Prep A SpA', '76808081-1', 'activo'),
    (t_fb, 'Courier Prep B', 'Courier Prep B SpA', '76808082-2', 'activo')
  on conflict (id) do nothing;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          created_at, updated_at, raw_app_meta_data,
                          raw_user_meta_data, aud, role)
  values
    (u_interno_a, 'interno.a@prep.test', crypt('x', gen_salt('bf')), now(), now(), now(),
     '{}', '{}', 'authenticated', 'authenticated')
  on conflict (id) do nothing;

  insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (s_ea1, t_ea, 'Seller Prep A1', '77808081-1', 'Contacto A1', 'a1@prep.test', 'activo'),
    (s_ea2, t_ea, 'Seller Prep A2', '77808082-2', 'Contacto A2', 'a2@prep.test', 'activo'),
    (s_fb1, t_fb, 'Seller Prep B1', '77808083-3', 'Contacto B1', 'b1@prep.test', 'activo')
  on conflict (id) do nothing;

  insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado)
  values
    (d_ea1, t_ea, 'Conductor Prep A1', '78808081-1', 'dependiente',   'activo'),
    (d_ea2, t_ea, 'Conductor Prep A2', '78808082-2', 'independiente', 'activo'),
    (d_fb1, t_fb, 'Conductor Prep B1', '78808083-3', 'dependiente',   'activo')
  on conflict (id) do nothing;

  insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, seller_id, driver_id, rol, estado)
  values
    (u_interno_a, t_ea, 'Interno Prep A', 'interno', null, null, 'dueno', 'activo')
  on conflict (id) do nothing;

  insert into identidad.seller_bodegas (id, tenant_id, seller_id, nombre, direccion, comuna, es_principal, activa)
  values
    (sb_ea1, t_ea, s_ea1, 'Bodega Prep A1', 'Av. Industrial 10', 'Quilicura', true, true),
    (sb_ea2, t_ea, s_ea2, 'Bodega Prep A2', 'Camino Lo Boza 20', 'Pudahuel',  true, true),
    (sb_fb1, t_fb, s_fb1, 'Bodega Prep B1', 'Camino Melipilla 30', 'Lampa',   true, true)
  on conflict (id) do nothing;

  -- Las TRES grafías de la misma comuna van a propósito en pedidos distintos:
  -- 'Maipu' (canónica), 'MAIPU' (mayúsculas) y ' maipu ' (con espacios). El
  -- camino Flex guarda lo que manda ML sin canonizar, así que esto no es un caso
  -- rebuscado: es el dato real.
  insert into operacion.pedidos (
    id, tenant_id, seller_id, tipo_pedido, origen, ml_shipment_id, estado,
    driver_id_asignado, destinatario_nombre, destinatario_direccion,
    destinatario_comuna, situacion_retiro)
  values
    (p_ea1, t_ea, s_ea1, 'flex', 'backfill', 'SHIPPREPA1', 'pendiente_asignacion',
     d_ea1, 'Destinatario A1', 'Calle Prep A 1', 'Maipu',       'pendiente'),
    (p_ea2, t_ea, s_ea1, 'flex', 'backfill', 'SHIPPREPA2', 'pendiente_asignacion',
     null,  'Destinatario A2', 'Calle Prep A 2', 'MAIPU',       'pendiente'),
    (p_ea3, t_ea, s_ea2, 'flex', 'backfill', 'SHIPPREPA3', 'pendiente_asignacion',
     null,  'Destinatario A3', 'Calle Prep A 3', 'Puente Alto', 'pendiente'),
    (p_ea4, t_ea, s_ea2, 'flex', 'backfill', 'SHIPPREPA4', 'pendiente_asignacion',
     null,  'Destinatario A4', 'Calle Prep A 4', ' maipu ',     'pendiente'),
    (p_ea5, t_ea, s_ea2, 'flex', 'backfill', 'SHIPPREPA5', 'pendiente_asignacion',
     null,  'Destinatario A5', 'Calle Prep A 5', 'Renca',       'pendiente'),
    -- Del seller S_A2, pero su bulto va a aparecer en la bodega de S_A1.
    (p_ea6, t_ea, s_ea2, 'flex', 'backfill', 'SHIPPREPA6', 'pendiente_asignacion',
     null,  'Destinatario A6', 'Calle Prep A 6', 'Puente Alto', 'pendiente'),
    (p_fb1, t_fb, s_fb1, 'flex', 'backfill', 'SHIPPREPB1', 'pendiente_asignacion',
     d_fb1, 'Destinatario B1', 'Calle Prep B 1', 'Vitacura',    'pendiente')
  on conflict (id) do nothing;

  -- Todas nacen ABIERTAS: el trigger prohíbe insertar un bulto normal en una
  -- sesión ya cerrada, así que el orden real de la operación es el único que la
  -- base acepta. `abierta_en` explícito para que el orden sea determinista — y a
  -- propósito la ABIERTA es la MÁS ANTIGUA, para que "abiertas primero" no pueda
  -- pasar por casualidad con un simple `abierta_en desc`.
  insert into operacion.sesiones_retiro
    (id, tenant_id, bodega_id, seller_id, conductor_id, fecha_operacion, estado, abierta_en)
  values
    (ses_ea1, t_ea, sb_ea1, s_ea1, d_ea1, date '2026-08-13', 'abierta', timestamptz '2026-08-13 08:00:00+00'),
    (ses_ea2, t_ea, sb_ea2, s_ea2, d_ea2, date '2026-08-13', 'abierta', timestamptz '2026-08-13 09:30:00+00'),
    (ses_ea3, t_ea, sb_ea2, s_ea2, d_ea1, date '2026-08-12', 'abierta', timestamptz '2026-08-12 08:00:00+00'),
    (ses_fb1, t_fb, sb_fb1, s_fb1, d_fb1, date '2026-08-13', 'abierta', timestamptz '2026-08-13 08:30:00+00')
  on conflict (id) do nothing;

  insert into operacion.bultos_retiro
    (tenant_id, sesion_retiro_id, conductor_id, escaneo_id, codigo_formato,
     codigo_normalizado, muestra_codigo, ml_shipment_id, pedido_id, seller_id,
     escaneado_en, recibido_en, resuelto_en)
  values
    -- SES_A1 — abierta. Los `recibido_en` van explícitos porque el máximo de esta
    -- columna es lo que la función devuelve como `ultimo_escaneo_en`.
    (t_ea, ses_ea1, d_ea1, 'eeeeeeee-4444-0000-0000-0000000000e1', 'flex_qr',
     'SHIPPREPA1', null, 'SHIPPREPA1', p_ea1, s_ea1,
     timestamptz '2026-08-13 10:00:00+00', timestamptz '2026-08-13 10:01:00+00', timestamptz '2026-08-13 10:01:00+00'),
    (t_ea, ses_ea1, d_ea1, 'eeeeeeee-4444-0000-0000-0000000000e2', 'flex_qr',
     'SHIPPREPA2', null, 'SHIPPREPA2', p_ea2, s_ea1,
     timestamptz '2026-08-13 10:05:00+00', timestamptz '2026-08-13 10:06:00+00', timestamptz '2026-08-13 10:06:00+00'),
    (t_ea, ses_ea1, d_ea1, 'eeeeeeee-4444-0000-0000-0000000000e3', 'flex_qr',
     'PREPA-SIN-PEDIDO', null, 'PREPA-SIN-PEDIDO', null, null,
     timestamptz '2026-08-13 10:10:00+00', timestamptz '2026-08-13 10:11:00+00', null),
    -- ⚠️ El teléfono con la hora mal puesta: `escaneado_en` en 2030. Si la función
    -- leyera esa columna, el aviso de "hace cuánto no reporta" quedaría mudo para
    -- siempre en esta visita.
    (t_ea, ses_ea1, d_ea1, 'eeeeeeee-4444-0000-0000-0000000000e4', 'desconocido',
     'PREPA-ILEGIBLE', 'PREPA-ILEG', null, null, null,
     timestamptz '2030-01-01 12:00:00+00', timestamptz '2026-08-13 10:20:00+00', null),
    -- EL BULTO AJENO: pedido del seller S_A2 escaneado en la bodega de S_A1. Su
    -- recibido_en va ANTES de las 10:20 para no mover `ultimo_escaneo_en`, que en
    -- esta visita tiene que seguir saliendo del ilegible con el reloj en 2030.
    (t_ea, ses_ea1, d_ea1, 'eeeeeeee-4444-0000-0000-0000000000ea', 'flex_qr',
     'SHIPPREPA6', null, 'SHIPPREPA6', p_ea6, s_ea2,
     timestamptz '2026-08-13 10:14:00+00', timestamptz '2026-08-13 10:15:00+00', timestamptz '2026-08-13 10:15:00+00'),

    -- SES_A2 — todavía abierta; se cierra más abajo con la función real.
    (t_ea, ses_ea2, d_ea2, 'eeeeeeee-4444-0000-0000-0000000000e5', 'flex_qr',
     'SHIPPREPA3', null, 'SHIPPREPA3', p_ea3, s_ea2,
     timestamptz '2026-08-13 11:00:00+00', timestamptz '2026-08-13 11:00:00+00', timestamptz '2026-08-13 11:00:00+00'),
    (t_ea, ses_ea2, d_ea2, 'eeeeeeee-4444-0000-0000-0000000000e6', 'flex_qr',
     'SHIPPREPA4', null, 'SHIPPREPA4', p_ea4, s_ea2,
     timestamptz '2026-08-13 11:05:00+00', timestamptz '2026-08-13 11:05:00+00', timestamptz '2026-08-13 11:05:00+00'),
    (t_ea, ses_ea2, d_ea2, 'eeeeeeee-4444-0000-0000-0000000000e7', 'flex_qr',
     'PREPA-SIN-PEDIDO-2', null, 'PREPA-SIN-PEDIDO-2', null, null,
     timestamptz '2026-08-13 11:10:00+00', timestamptz '2026-08-13 11:10:00+00', null),

    -- SES_A3 — AYER. Su comuna ('Renca') no debe aparecer en la carga de hoy.
    (t_ea, ses_ea3, d_ea1, 'eeeeeeee-4444-0000-0000-0000000000e9', 'flex_qr',
     'SHIPPREPA5', null, 'SHIPPREPA5', p_ea5, s_ea2,
     timestamptz '2026-08-12 10:00:00+00', timestamptz '2026-08-12 10:00:00+00', timestamptz '2026-08-12 10:00:00+00'),

    -- Tenant B, mismo día.
    (t_fb, ses_fb1, d_fb1, 'ffffffff-4444-0000-0000-0000000000f1', 'flex_qr',
     'SHIPPREPB1', null, 'SHIPPREPB1', p_fb1, s_fb1,
     timestamptz '2026-08-13 10:00:00+00', timestamptz '2026-08-13 10:00:00+00', timestamptz '2026-08-13 10:00:00+00'),
    (t_fb, ses_fb1, d_fb1, 'ffffffff-4444-0000-0000-0000000000f2', 'flex_qr',
     'PREPB-SIN-PEDIDO', null, 'PREPB-SIN-PEDIDO', null, null,
     timestamptz '2026-08-13 10:30:00+00', timestamptz '2026-08-13 10:30:00+00', null);

  -- El acta la congela la FUNCIÓN REAL, no un UPDATE a mano: así lo que después
  -- se compara contra los contadores vivos es el documento que de verdad produce
  -- el cierre (3 bultos, 2 resueltos, 1 sin resolver).
  perform * from operacion.cerrar_sesion_retiro(t_ea, ses_ea2, d_ea2);

  -- Y AHORA el escaneo tardío: la cola sin conexión drenando después del cierre.
  -- Sube los contadores VIVOS a 4 y NO toca el acta, que queda en 3.
  insert into operacion.bultos_retiro
    (tenant_id, sesion_retiro_id, conductor_id, escaneo_id, codigo_formato,
     codigo_normalizado, ml_shipment_id, escaneado_en, recibido_en, posterior_al_cierre)
  values
    (t_ea, ses_ea2, d_ea2, 'eeeeeeee-4444-0000-0000-0000000000e8', 'flex_qr',
     'PREPA-TARDIO', 'PREPA-TARDIO',
     timestamptz '2026-08-13 12:00:00+00', timestamptz '2026-08-13 12:00:00+00', true);
end $$;


-- =============================================================================
-- BLOQUE 0 · Contrato de las dos funciones (6 tests)
-- =============================================================================
select has_function('operacion', 'preparacion_visitas_del_dia', array['uuid', 'date'],
  'contrato: existe operacion.preparacion_visitas_del_dia(uuid, date)');

select has_function('operacion', 'preparacion_carga_por_comuna', array['uuid', 'date'],
  'contrato: existe operacion.preparacion_carga_por_comuna(uuid, date)');

-- SECURITY DEFINER es parte del contrato, no un detalle: la función lee sin RLS y
-- el aislamiento lo impone p_tenant_id. Si se perdiera, un job de service_role
-- seguiría funcionando (BYPASSRLS) y la divergencia pasaría inadvertida.
select is(
  (select prosecdef from pg_proc where oid = 'operacion.preparacion_visitas_del_dia(uuid,date)'::regprocedure),
  true,
  'contrato: preparacion_visitas_del_dia es SECURITY DEFINER'
);

select is(
  (select prosecdef from pg_proc where oid = 'operacion.preparacion_carga_por_comuna(uuid,date)'::regprocedure),
  true,
  'contrato: preparacion_carga_por_comuna es SECURITY DEFINER'
);

select is(
  (select provolatile::text from pg_proc where oid = 'operacion.preparacion_visitas_del_dia(uuid,date)'::regprocedure),
  's',
  'contrato: preparacion_visitas_del_dia es STABLE (solo lectura)'
);

select is(
  (select provolatile::text from pg_proc where oid = 'operacion.preparacion_carga_por_comuna(uuid,date)'::regprocedure),
  's',
  'contrato: preparacion_carga_por_comuna es STABLE (solo lectura)'
);


-- =============================================================================
-- BLOQUE 1 · Privilegios de ejecución (8 tests)
-- =============================================================================
-- Catálogo Y comportamiento. Lo primero mide el privilegio efectivo (incluido el
-- heredado vía PUBLIC); lo segundo demuestra que el motor de verdad corta.
select is(
  has_function_privilege('authenticated', 'operacion.preparacion_visitas_del_dia(uuid,date)', 'EXECUTE'),
  false,
  'privilegios: authenticated NO puede ejecutar preparacion_visitas_del_dia (lee sin RLS: bastaría pasar el uuid de otro courier)'
);

select is(
  has_function_privilege('anon', 'operacion.preparacion_visitas_del_dia(uuid,date)', 'EXECUTE'),
  false,
  'privilegios: anon NO puede ejecutar preparacion_visitas_del_dia'
);

select is(
  has_function_privilege('authenticated', 'operacion.preparacion_carga_por_comuna(uuid,date)', 'EXECUTE'),
  false,
  'privilegios: authenticated NO puede ejecutar preparacion_carga_por_comuna'
);

select is(
  has_function_privilege('anon', 'operacion.preparacion_carga_por_comuna(uuid,date)', 'EXECUTE'),
  false,
  'privilegios: anon NO puede ejecutar preparacion_carga_por_comuna'
);

-- Controles positivos: el revoke no dejó las funciones inservibles para quien sí
-- debe llamarlas. Sin esto, un revoke de más pasaría por "seguro".
select is(
  has_function_privilege('service_role', 'operacion.preparacion_visitas_del_dia(uuid,date)', 'EXECUTE'),
  true,
  'privilegios: service_role SÍ puede ejecutar preparacion_visitas_del_dia (control positivo)'
);

select is(
  has_function_privilege('service_role', 'operacion.preparacion_carga_por_comuna(uuid,date)', 'EXECUTE'),
  true,
  'privilegios: service_role SÍ puede ejecutar preparacion_carga_por_comuna (control positivo)'
);

-- Comportamiento real: ni siquiera el DUEÑO del courier, con su sesión bien
-- formada, alcanza las funciones.
select test_iniciar_sesion(
  'eeeeeeee-3333-0000-0000-0000000000e1'::uuid,
  'eeeeeeee-0000-0000-0000-0000000000e1'::uuid,
  'interno', 'dueno'
);

select throws_ok(
  $$ select * from operacion.preparacion_visitas_del_dia(
       'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13') $$,
  '42501',
  null,
  'privilegios: el dueño del courier recibe 42501 al llamar preparacion_visitas_del_dia desde su sesión (la llama el servidor con service_role, no el cliente)'
);

select throws_ok(
  $$ select * from operacion.preparacion_carga_por_comuna(
       'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13') $$,
  '42501',
  null,
  'privilegios: el dueño del courier recibe 42501 al llamar preparacion_carga_por_comuna desde su sesión'
);

select test_cerrar_sesion();


-- =============================================================================
-- BLOQUE 2 · AISLAMIENTO CRUZADO — lo más importante del archivo (12 tests)
-- =============================================================================
-- Las funciones son SECURITY DEFINER: aquí NO hay ninguna política debajo. Lo
-- único que separa a un courier de otro es el `p_tenant_id` escrito en el SQL, y
-- eso es exactamente lo que se prueba — en las DOS direcciones, porque un filtro
-- mal puesto puede aislar en un sentido y filtrar en el otro.

select results_eq(
  $$ select count(*)::int from operacion.preparacion_visitas_del_dia(
       'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13') $$,
  $$ values (2) $$,
  'AISLAMIENTO visitas: el courier A ve exactamente SUS 2 visitas de hoy (ni la del courier B, ni la suya de ayer)'
);

select is_empty(
  $$ select 1 from operacion.preparacion_visitas_del_dia(
       'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
      where sesion_id = 'ffffffff-7777-0000-0000-0000000000f1' $$,
  'AISLAMIENTO visitas: la visita del courier B NO aparece en la consulta del courier A'
);

-- No basta con que no venga el id: tampoco puede filtrarse una etiqueta ajena por
-- un join que se olvidó del tenant.
select is_empty(
  $$ select 1 from operacion.preparacion_visitas_del_dia(
       'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
      where bodega_nombre    like '%Prep B%'
         or seller_nombre    like '%Prep B%'
         or conductor_nombre like '%Prep B%' $$,
  'AISLAMIENTO visitas: ni la bodega, ni el seller, ni el conductor del courier B se filtran por los joins (todos llevan su tenant_id)'
);

-- El espejo. Una condición mal escrita puede aislar en un sentido y filtrar en el
-- otro, y solo esta mitad lo detecta.
select results_eq(
  $$ select sesion_id from operacion.preparacion_visitas_del_dia(
       'ffffffff-0000-0000-0000-0000000000f1'::uuid, date '2026-08-13') $$,
  $$ values ('ffffffff-7777-0000-0000-0000000000f1'::uuid) $$,
  'AISLAMIENTO visitas (espejo): el courier B ve exactamente su única visita, y es la suya'
);

select is_empty(
  $$ select 1 from operacion.preparacion_visitas_del_dia(
       'ffffffff-0000-0000-0000-0000000000f1'::uuid, date '2026-08-13')
      where bodega_nombre    like '%Prep A%'
         or seller_nombre    like '%Prep A%'
         or conductor_nombre like '%Prep A%' $$,
  'AISLAMIENTO visitas (espejo): el courier B no ve ninguna pieza del courier A'
);

-- El filtro de fecha, con datos que dejar fuera: SES_A3 es de ayer.
select is_empty(
  $$ select 1 from operacion.preparacion_visitas_del_dia(
       'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
      where sesion_id = 'eeeeeeee-7777-0000-0000-0000000000e3' $$,
  'visitas: la visita de AYER no entra en la consulta de hoy (el día lo fija fecha_operacion, y ayer tiene datos)'
);

select results_eq(
  $$ select sum(bultos_total)::int from operacion.preparacion_carga_por_comuna(
       'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13') $$,
  $$ values (9) $$,
  'AISLAMIENTO carga: el courier A suma exactamente SUS 9 bultos de hoy (con los del courier B serían 11; con los de ayer, 10)'
);

select is_empty(
  $$ select 1 from operacion.preparacion_carga_por_comuna(
       'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
      where comuna_clave = 'vitacura' $$,
  'AISLAMIENTO carga: la comuna que solo existe en el courier B (Vitacura) NO aparece en la carga del courier A'
);

select is_empty(
  $$ select 1 from operacion.preparacion_carga_por_comuna(
       'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
      where comuna_clave = 'renca' $$,
  'carga: la comuna que solo aparece en la visita de AYER (Renca) no entra en la carga de hoy'
);

select results_eq(
  $$ select sum(bultos_total)::int from operacion.preparacion_carga_por_comuna(
       'ffffffff-0000-0000-0000-0000000000f1'::uuid, date '2026-08-13') $$,
  $$ values (2) $$,
  'AISLAMIENTO carga (espejo): el courier B suma exactamente sus 2 bultos'
);

select is_empty(
  $$ select 1 from operacion.preparacion_carga_por_comuna(
       'ffffffff-0000-0000-0000-0000000000f1'::uuid, date '2026-08-13')
      where comuna_clave in ('maipu', 'puente alto', 'renca') $$,
  'AISLAMIENTO carga (espejo): ninguna comuna del courier A aparece en la carga del courier B'
);

select results_eq(
  $$ select comuna_clave, bultos_total, bultos_asignados, bultos_sin_resolver
       from operacion.preparacion_carga_por_comuna(
              'ffffffff-0000-0000-0000-0000000000f1'::uuid, date '2026-08-13') $$,
  $$ values ('vitacura'::text, 1::bigint, 1::bigint, 0::bigint),
            (null,             1::bigint, 0::bigint, 1::bigint) $$,
  'AISLAMIENTO carga (espejo): el detalle completo del courier B es solo suyo — 1 a Vitacura (ya con conductor) y 1 sin resolver'
);


-- =============================================================================
-- BLOQUE 3 · Comuna: normalización, fila desconocida y orden (6 tests)
-- =============================================================================
-- Un solo results_eq cubre valores Y orden: pgTAP compara fila por fila en el
-- orden en que la función las entrega.
select results_eq(
  $$ select comuna_clave, bultos_total, bultos_asignados, bultos_sin_resolver
       from operacion.preparacion_carga_por_comuna(
              'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13') $$,
  $$ values ('maipu'::text,  3::bigint, 1::bigint, 0::bigint),
            ('puente alto',  2::bigint, 0::bigint, 0::bigint),
            (null,           4::bigint, 0::bigint, 4::bigint) $$,
  'carga: el set completo y EN ORDEN — maipu 3 (1 con conductor), puente alto 2, y la fila desconocida al final con sus 4'
);

-- LA PRUEBA DE LA NORMALIZACIÓN: 'Maipu' + 'MAIPU' + ' maipu ' son UNA comuna.
-- Sin lower(btrim(...)) esto daría tres filas y la pantalla repartiría la flota
-- sobre un tercio de la carga real.
select results_eq(
  $$ select count(*)::int from operacion.preparacion_carga_por_comuna(
       'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
      where comuna_clave = 'maipu' $$,
  $$ values (1) $$,
  'carga: tres grafías de la misma comuna ("Maipu", "MAIPU", " maipu ") caen en UNA sola fila — el camino Flex guarda la comuna cruda de ML'
);

-- La etiqueta es una grafía REAL del grupo (cuál gana depende de la colación de
-- la base, y da lo mismo: lo que importa es que sea del grupo y que haya una).
select results_eq(
  $$ select lower(btrim(comuna_etiqueta)) from operacion.preparacion_carga_por_comuna(
       'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
      where comuna_clave = 'maipu' $$,
  $$ values ('maipu'::text) $$,
  'carga: comuna_etiqueta trae una grafía real del grupo para mostrar en pantalla'
);

select isnt_empty(
  $$ select 1 from operacion.preparacion_carga_por_comuna(
       'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
      where comuna_clave is null $$,
  'carga: la fila de comuna desconocida SE DEVUELVE, nunca se descarta (los bultos están arriba de la van igual)'
);

-- Su etiqueta es NULL y no la cadena vacía: en la pantalla eso es "excepción", no
-- "zona sin nombre".
select is(
  (select comuna_etiqueta from operacion.preparacion_carga_por_comuna(
     'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
    where comuna_clave is null),
  null::text,
  'carga: la fila desconocida no trae etiqueta (NULL, no cadena vacía — es una excepción, no una zona sin nombre)'
);

-- Y va ÚLTIMA aunque tenga 4 bultos y la primera comuna real tenga 3.
select results_eq(
  $$ with o as (
       select row_number() over () as n, comuna_clave, bultos_total
         from operacion.preparacion_carga_por_comuna(
                'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
     )
     select comuna_clave, bultos_total from o where n = (select max(n) from o) $$,
  $$ values (null::text, 4::bigint) $$,
  'carga: la fila desconocida va AL FINAL aunque tenga MÁS bultos (4) que cualquier comuna real (3) — es una excepción, no un destino'
);


-- =============================================================================
-- BLOQUE 4 · Contadores VIVOS vs. ACTA congelada (6 tests)
-- =============================================================================
-- SES_A2 se cerró con 3 bultos (acta 3/2/1) y DESPUÉS entró uno tardío. Los vivos
-- deben decir 4 y el acta seguir diciendo 3. Colapsar las dos cifras sería
-- reescribir el documento que respalda el pago del retiro al conductor.
select results_eq(
  $$ select bultos_vivos, bultos_resueltos_vivos, bultos_sin_resolver_vivos,
            acta_total, acta_resueltos, acta_sin_resolver
       from operacion.preparacion_visitas_del_dia(
              'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
      where sesion_id = 'eeeeeeee-7777-0000-0000-0000000000e2' $$,
  $$ values (4::bigint, 2::bigint, 2::bigint, 3, 2, 1) $$,
  'vivos vs acta: la visita cerrada muestra 4 bultos VIVOS (el escaneo tardío cuenta) y un ACTA que sigue diciendo 3 — las dos cifras salen y no se pisan'
);

select is(
  (select acta_total from operacion.preparacion_visitas_del_dia(
     'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
    where sesion_id = 'eeeeeeee-7777-0000-0000-0000000000e1'),
  null::integer,
  'acta: la visita ABIERTA trae acta_total NULL — "todavía no hay acta", que no es lo mismo que "el acta dice cero"'
);

select results_eq(
  $$ select acta_total, acta_resueltos, acta_sin_resolver
       from operacion.preparacion_visitas_del_dia(
              'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
      where sesion_id = 'eeeeeeee-7777-0000-0000-0000000000e1' $$,
  $$ values (null::integer, null::integer, null::integer) $$,
  'acta: los TRES contadores del acta vienen NULL mientras la visita está abierta (la pantalla no debe pintar 0)'
);

select results_eq(
  $$ select bultos_vivos, bultos_resueltos_vivos, bultos_sin_resolver_vivos
       from operacion.preparacion_visitas_del_dia(
              'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
      where sesion_id = 'eeeeeeee-7777-0000-0000-0000000000e1' $$,
  $$ values (5::bigint, 3::bigint, 2::bigint) $$,
  'vivos: la visita abierta sí muestra sus contadores en vivo (5 escaneados, 3 casados con pedido, 2 sin resolver)'
);

-- EL DESCUADRE QUE EL RETIRO EXISTE PARA DESTAPAR. En SES_A1 (bodega del seller
-- A1) hay un bulto cuyo pedido es del seller A2. Y en la MISMA visita hay 2
-- bultos sin resolver: de esos no se sabe de quién son, así que no pueden entrar
-- en la cuenta — un descuadre inventado sobre un código ilegible mandaría al
-- coordinador a buscar un problema que no existe.
select results_eq(
  $$ select bultos_de_otro_seller, bultos_sin_resolver_vivos
       from operacion.preparacion_visitas_del_dia(
              'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
      where sesion_id = 'eeeeeeee-7777-0000-0000-0000000000e1' $$,
  $$ values (1::bigint, 2::bigint) $$,
  'otro seller: la visita cuenta 1 bulto AJENO (pedido del seller A2 en la bodega del seller A1) y sus 2 bultos sin resolver NO lo inflan — de un código que no se pudo casar no se sabe de quién es'
);

-- Control negativo: en la otra visita todos los bultos resueltos son del dueño de
-- la bodega. Sin este control, un contador roto que devolviera siempre >0 pasaría
-- el test de arriba.
select results_eq(
  $$ select bultos_de_otro_seller
       from operacion.preparacion_visitas_del_dia(
              'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
      where sesion_id = 'eeeeeeee-7777-0000-0000-0000000000e2' $$,
  $$ values (0::bigint) $$,
  'otro seller: la visita cuyos bultos son todos del dueño de la bodega cuenta 0 (control negativo)'
);

-- Orden: la ABIERTA va primero AUNQUE su abierta_en sea más antigua (08:00 vs
-- 09:30). Un simple `abierta_en desc` habría puesto la cerrada arriba.
select results_eq(
  $$ with o as (
       select row_number() over () as n, sesion_id, estado
         from operacion.preparacion_visitas_del_dia(
                'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
     )
     select sesion_id, estado from o where n = 1 $$,
  $$ values ('eeeeeeee-7777-0000-0000-0000000000e1'::uuid, 'abierta'::text) $$,
  'orden: la visita ABIERTA va primero aunque se haya abierto ANTES que la cerrada (es la accionable: hay un conductor adentro de una bodega)'
);

-- Control positivo de los tres joins: las etiquetas son las que corresponden.
-- Sin esto, los is_empty del bloque 2 podrían estar pasando por NULLs.
select results_eq(
  $$ select bodega_nombre, bodega_comuna, seller_nombre, conductor_nombre
       from operacion.preparacion_visitas_del_dia(
              'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
      where sesion_id = 'eeeeeeee-7777-0000-0000-0000000000e1' $$,
  $$ values ('Bodega Prep A1'::text, 'Quilicura'::text, 'Seller Prep A1'::text, 'Conductor Prep A1'::text) $$,
  'control positivo: bodega, comuna, seller y conductor salen resueltos — los ceros del bloque 2 son del filtro por tenant, no de joins rotos'
);


-- =============================================================================
-- BLOQUE 5 · `ultimo_escaneo_en` sale del reloj del SERVIDOR (2 tests)
-- =============================================================================
-- BU4 se sembró con escaneado_en en 2030 (teléfono con la hora mal puesta) y
-- recibido_en a las 10:20. La función debe devolver 10:20.
select is(
  (select ultimo_escaneo_en from operacion.preparacion_visitas_del_dia(
     'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
    where sesion_id = 'eeeeeeee-7777-0000-0000-0000000000e1'),
  timestamptz '2026-08-13 10:20:00+00',
  'ultimo_escaneo_en: es el MÁXIMO de recibido_en (reloj del servidor), no de escaneado_en'
);

select cmp_ok(
  (select ultimo_escaneo_en from operacion.preparacion_visitas_del_dia(
     'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
    where sesion_id = 'eeeeeeee-7777-0000-0000-0000000000e1'),
  '<',
  timestamptz '2027-01-01 00:00:00+00',
  'ultimo_escaneo_en: un teléfono con la hora en 2030 NO silencia el aviso de "hace cuánto no reporta" (si leyera escaneado_en, esta visita nunca volvería a parecer atrasada)'
);


-- =============================================================================
-- BLOQUE 6 · Publicación en vivo (4 tests)
-- =============================================================================
-- Sanidad primero: si la publicación no existiera, los tres tests siguientes
-- pasarían o fallarían por el entorno y no por la migración.
select isnt_empty(
  $$ select 1 from pg_publication where pubname = 'supabase_realtime' $$,
  'realtime: existe la publicación supabase_realtime (sanidad del entorno — sin ella los tres tests siguientes no medirían nada)'
);

select isnt_empty(
  $$ select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'operacion' and tablename = 'sesiones_retiro' $$,
  'realtime: operacion.sesiones_retiro está publicada — sin esto el canal se suscribe y NUNCA emite, sin un solo error en ninguna parte'
);

select isnt_empty(
  $$ select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'operacion' and tablename = 'bultos_retiro' $$,
  'realtime: operacion.bultos_retiro está publicada — es la tabla que crece en ráfagas durante el retiro'
);

-- LA QUE NO SE PUEDE ROMPER NUNCA.
select is_empty(
  $$ select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'operacion' and tablename = 'bultos_retiro_qr' $$,
  'realtime: operacion.bultos_retiro_qr NO está publicada — es deny-all y guarda el string del QR cifrado; la réplica lógica no pregunta por GRANTs y sacaría el criptograma por el WAL'
);

-- =============================================================================
-- La carga por comuna cuenta SOLO lo que queda por repartir
-- =============================================================================
-- Medido en producción por el usuario (2026-08-15): entregó un same-day y el
-- pedido seguía contando como carga pendiente en la Preparación del día. La
-- bandeja de asignación lo excluía bien (`estado in
-- ('pendiente_asignacion','asignado')`), pero esta función no tenía filtro de
-- estado: "Lampa · 5 bultos" contra 4 pedidos reales en la bandeja.
--
-- Este panel decide cuántos conductores mandar a cada zona; un pedido cerrado
-- no es trabajo pendiente. El respaldo de lo retirado NO se toca: eso es el
-- acta de la visita (`sesiones_retiro.bultos_total`).
do $$
declare
  -- Mismos ids del bloque de fixtures de arriba. No se re-declaran "parecidos":
  -- un uuid mal copiado acá crearía datos huérfanos y la prueba pasaría por
  -- ausencia, que es la peor forma de pasar.
  t_ea    uuid := 'eeeeeeee-0000-0000-0000-0000000000e1';
  s_ea1   uuid := 'eeeeeeee-1111-0000-0000-0000000000e1';
  d_ea1   uuid := 'eeeeeeee-2222-0000-0000-0000000000e1';
  ses_ea1 uuid := 'eeeeeeee-7777-0000-0000-0000000000e1';
  p_entregado uuid := 'eeeeeeee-6666-0000-0000-0000000000ff';
begin
  -- Un pedido a una comuna que NINGÚN otro caso usa, para que su desaparición
  -- del resultado sea inequívoca y no se confunda con otra fila.
  insert into operacion.pedidos (
    id, tenant_id, seller_id, tipo_pedido, origen, ml_shipment_id, estado,
    driver_id_asignado, destinatario_nombre, destinatario_direccion,
    destinatario_comuna, situacion_retiro)
  values
    (p_entregado, t_ea, s_ea1, 'same_day', 'same_day_manual', null, 'entregado',
     d_ea1, 'Destinatario Entregado', 'Calle Entregada 1', 'Lampa', 'retirado');

  -- Su bulto SÍ se escaneó hoy y su acta lo conserva: lo que cambia es que deja
  -- de figurar como carga por repartir.
  insert into operacion.bultos_retiro
    (tenant_id, sesion_retiro_id, conductor_id, escaneo_id, codigo_formato,
     codigo_normalizado, pedido_id, seller_id, escaneado_en, recibido_en, resuelto_en)
  values
    (t_ea, ses_ea1, d_ea1, 'eeeeeeee-4444-0000-0000-0000000000ff', 'rutax_interno',
     'RX-ENTREGADO-1', p_entregado, s_ea1,
     timestamptz '2026-08-13 10:00:00+00', timestamptz '2026-08-13 10:00:00+00',
     timestamptz '2026-08-13 10:00:00+00');
end $$;

select is_empty(
  $$ select 1 from operacion.preparacion_carga_por_comuna(
       'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
      where comuna_clave = 'lampa' $$,
  'carga: un pedido ENTREGADO no cuenta como carga por repartir — su comuna ni siquiera aparece'
);

-- La otra mitad, y la que impide "arreglarlo" con un INNER JOIN: los bultos sin
-- pedido resuelto siguen contando. Son la excepción que el retiro existe para
-- destapar, y esconderlos daría un total que no cuadra con el piso de la bodega.
select isnt_empty(
  $$ select 1 from operacion.preparacion_carga_por_comuna(
       'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
      where comuna_clave is null and bultos_sin_resolver > 0 $$,
  'carga: los bultos SIN pedido siguen contando en la fila de excepción (el filtro de estado no los barre)'
);

-- =============================================================================
-- Un bulto YA DESPACHADO deja de ser carga (manifiesto confirmado)
-- =============================================================================
-- Observado en producción por el usuario (2026-08-15): cuatro bultos de Lampa ya
-- asignados —algunos en ruta— seguían apareciendo como carga por repartir. Este
-- panel decide cuántos conductores mandar a cada zona; una vez que el bulto
-- tiene conductor y el manifiesto está cerrado, esa decisión ya se tomó.
--
-- El corte es el manifiesto CONFIRMADO y no la simple asignación: mientras sigue
-- en `borrador`, el coordinador todavía puede mover el pedido de conductor y por
-- lo tanto sigue siendo parte de la decisión. Las dos mitades se prueban.
do $$
declare
  t_ea  uuid := 'eeeeeeee-0000-0000-0000-0000000000e1';
  s_ea1 uuid := 'eeeeeeee-1111-0000-0000-0000000000e1';
  d_ea1 uuid := 'eeeeeeee-2222-0000-0000-0000000000e1';
  ses_ea1 uuid := 'eeeeeeee-7777-0000-0000-0000000000e1';

  p_borrador  uuid := 'eeeeeeee-6666-0000-0000-0000000000b1';
  p_confirmado uuid := 'eeeeeeee-6666-0000-0000-0000000000c1';
  m_borrador  uuid := 'eeeeeeee-aaaa-0000-0000-0000000000b1';
  m_confirmado uuid := 'eeeeeeee-aaaa-0000-0000-0000000000c1';
begin
  -- Dos pedidos ASIGNADOS, a comunas propias para que su presencia/ausencia sea
  -- inequívoca. Lo único que los distingue es el estado de su manifiesto.
  insert into operacion.pedidos (
    id, tenant_id, seller_id, tipo_pedido, origen, ml_shipment_id, estado,
    driver_id_asignado, destinatario_nombre, destinatario_direccion,
    destinatario_comuna, situacion_retiro)
  values
    (p_borrador, t_ea, s_ea1, 'same_day', 'same_day_manual', null, 'asignado',
     d_ea1, 'Dest Borrador', 'Calle B 1', 'Cerrillos', 'retirado'),
    (p_confirmado, t_ea, s_ea1, 'same_day', 'same_day_manual', null, 'asignado',
     d_ea1, 'Dest Confirmado', 'Calle C 1', 'Quilicura', 'retirado');

  insert into operacion.manifiestos (id, tenant_id, driver_id, nombre, fecha_operacion, estado)
  values
    (m_borrador,   t_ea, d_ea1, 'Manifiesto borrador',   date '2026-08-13', 'borrador'),
    (m_confirmado, t_ea, d_ea1, 'Manifiesto confirmado', date '2026-08-13', 'confirmado');

  -- `seller_id` va explícito: un trigger valida que el denormalizado coincida
  -- con `pedidos.seller_id` y rechaza el NULL.
  insert into operacion.asignaciones_pedido
    (tenant_id, pedido_id, manifiesto_id, driver_id, seller_id, activa)
  values
    (t_ea, p_borrador,   m_borrador,   d_ea1, s_ea1, true),
    (t_ea, p_confirmado, m_confirmado, d_ea1, s_ea1, true);

  insert into operacion.bultos_retiro
    (tenant_id, sesion_retiro_id, conductor_id, escaneo_id, codigo_formato,
     codigo_normalizado, pedido_id, seller_id, escaneado_en, recibido_en, resuelto_en)
  values
    (t_ea, ses_ea1, d_ea1, 'eeeeeeee-4444-0000-0000-0000000000b1', 'rutax_interno',
     'RX-BORRADOR-1', p_borrador, s_ea1,
     timestamptz '2026-08-13 10:30:00+00', timestamptz '2026-08-13 10:30:00+00',
     timestamptz '2026-08-13 10:30:00+00'),
    (t_ea, ses_ea1, d_ea1, 'eeeeeeee-4444-0000-0000-0000000000c1', 'rutax_interno',
     'RX-CONFIRMADO-1', p_confirmado, s_ea1,
     timestamptz '2026-08-13 10:31:00+00', timestamptz '2026-08-13 10:31:00+00',
     timestamptz '2026-08-13 10:31:00+00');
end $$;

select isnt_empty(
  $$ select 1 from operacion.preparacion_carga_por_comuna(
       'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
      where comuna_clave = 'cerrillos' $$,
  'carga: asignado con manifiesto en BORRADOR sigue contando — el coordinador todavía puede moverlo'
);

select is_empty(
  $$ select 1 from operacion.preparacion_carga_por_comuna(
       'eeeeeeee-0000-0000-0000-0000000000e1'::uuid, date '2026-08-13')
      where comuna_clave = 'quilicura' $$,
  'carga: asignado con manifiesto CONFIRMADO deja de contar — esa decisión ya se tomó'
);

select * from finish();

rollback;
