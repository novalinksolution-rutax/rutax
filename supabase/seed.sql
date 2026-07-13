-- =============================================================================
-- supabase/seed.sql — Demo local/staging: Despachos del Centro SpA
-- =============================================================================
-- NUNCA aplicar en producción.
-- Contraseña de todos los usuarios demo: Demo2026!
-- Tenant ficticio: Despachos del Centro SpA (RUT 76123456-7)
-- Un día de operación: 2026-06-09 (pedidos del 2–9 Jun 2026)
-- =============================================================================

-- Constantes locales (UUIDs fijos para reproducibilidad)
do $$
begin
  -- Solo informativo: los UUIDs están hardcodeados abajo para claridad
  raise notice 'Seed: cargando datos de demo de Despachos del Centro SpA…';
end $$;

-- =============================================================================
-- 1. Auth users — 6 roles, contraseña Demo2026!
-- NOTAS DE COMPATIBILIDAD GOTRUE v2:
--   • instance_id debe ser '00000000-...' (GoTrue filtra por este valor)
--   • auth.identities necesita provider_id = email (no UUID) para email provider
--   • auth.identities.email es columna GENERATED — no se incluye en INSERT
--   • auth.users.confirmed_at es columna GENERATED en GoTrue v2 (se calcula de
--     email_confirmed_at) — NO se incluye en el INSERT (si no, error 428C9).
-- =============================================================================
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token,
  is_sso_user, is_anonymous
) values
  ('20000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated',
   'dueno@despachos-centro.cl',
   crypt('Demo2026!', gen_salt('bf')),
   now(),
   '{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','',false,false),
  ('20000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated',
   'supervisor@despachos-centro.cl',
   crypt('Demo2026!', gen_salt('bf')),
   now(),
   '{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','',false,false),
  ('20000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated',
   'coordinador@despachos-centro.cl',
   crypt('Demo2026!', gen_salt('bf')),
   now(),
   '{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','',false,false),
  ('20000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated',
   'admin.financiero@despachos-centro.cl',
   crypt('Demo2026!', gen_salt('bf')),
   now(),
   '{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','',false,false),
  ('20000000-0000-0000-0000-000000000005',
   '00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated',
   'conductor.demo@despachos-centro.cl',
   crypt('Demo2026!', gen_salt('bf')),
   now(),
   '{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','',false,false),
  ('20000000-0000-0000-0000-000000000006',
   '00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated',
   'seller@falabellatech.cl',
   crypt('Demo2026!', gen_salt('bf')),
   now(),
   '{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','',false,false)
on conflict (id) do nothing;

-- Identidades de email (GoTrue las necesita para autenticar)
-- provider_id = email (no UUID), email es columna GENERATED (no se incluye)
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  ('dueno@despachos-centro.cl',
   '20000000-0000-0000-0000-000000000001',
   '{"sub":"20000000-0000-0000-0000-000000000001","email":"dueno@despachos-centro.cl","email_verified":true,"phone_verified":false}',
   'email', now(), now(), now()),
  ('supervisor@despachos-centro.cl',
   '20000000-0000-0000-0000-000000000002',
   '{"sub":"20000000-0000-0000-0000-000000000002","email":"supervisor@despachos-centro.cl","email_verified":true,"phone_verified":false}',
   'email', now(), now(), now()),
  ('coordinador@despachos-centro.cl',
   '20000000-0000-0000-0000-000000000003',
   '{"sub":"20000000-0000-0000-0000-000000000003","email":"coordinador@despachos-centro.cl","email_verified":true,"phone_verified":false}',
   'email', now(), now(), now()),
  ('admin.financiero@despachos-centro.cl',
   '20000000-0000-0000-0000-000000000004',
   '{"sub":"20000000-0000-0000-0000-000000000004","email":"admin.financiero@despachos-centro.cl","email_verified":true,"phone_verified":false}',
   'email', now(), now(), now()),
  ('conductor.demo@despachos-centro.cl',
   '20000000-0000-0000-0000-000000000005',
   '{"sub":"20000000-0000-0000-0000-000000000005","email":"conductor.demo@despachos-centro.cl","email_verified":true,"phone_verified":false}',
   'email', now(), now(), now()),
  ('seller@falabellatech.cl',
   '20000000-0000-0000-0000-000000000006',
   '{"sub":"20000000-0000-0000-0000-000000000006","email":"seller@falabellatech.cl","email_verified":true,"phone_verified":false}',
   'email', now(), now(), now())
on conflict (provider, provider_id) do nothing;

-- =============================================================================
-- 1b. Super-admin de plataforma (fundador Rutax) — FUERA DE TODO TENANT
-- =============================================================================
-- Identidad REAL del backstage `/admin`. Da un actor con nombre y UUID FIJO para
-- que la bitácora de plataforma pueda registrar actor_usuario_id real (cierra la
-- deuda de gobernanza #1). NO pertenece a ningún tenant (tenant_id = null), pero
-- SÍ tiene fila en identidad.usuarios_perfil desde F3-A (ver más abajo). Mismo
-- patrón GoTrue v2 que la sección 1 (instance_id cero + auth.identities con
-- provider_id = email).
--
-- UUID FIJO del fundador: ad000000-0000-0000-0000-000000000001  ("ad" = admin;
-- prefijo distinto del rango de demo del tenant). Lo referencia el backend/tests.
--
-- F3-A — POR QUÉ AHORA SÍ hay usuarios_perfil (revierte la decisión de "Ola 0"):
-- en Ola 0 el super-admin NO tenía perfil porque el gate del backstage era un
-- secreto compartido (SUPER_ADMIN_SECRET) y no hacía falta sesión Supabase real.
-- F3 pasa a sesión Supabase REAL: el custom_access_token_hook inyecta el claim
-- top-level `tipo_usuario='super_admin'` (que activa esSuperAdminDePlataforma)
-- SOLO si existe fila en usuarios_perfil. Por eso se aprovisiona más abajo, con
-- tenant_id=null. (raw_app_meta_data.tipo_usuario/rol quedan como metadato
-- informativo; el claim autoritativo del hook viene de usuarios_perfil.)
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token,
  is_sso_user, is_anonymous
) values
  ('ad000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated',
   'admin@rutax.cl',
   crypt('Demo2026!', gen_salt('bf')),
   now(),
   '{"provider":"email","providers":["email"],"tipo_usuario":"super_admin","rol":"super_admin"}',
   '{"nombre_completo":"Fundador Rutax"}',
   now(),now(),'','','','',false,false)
on conflict (id) do nothing;

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  ('admin@rutax.cl',
   'ad000000-0000-0000-0000-000000000001',
   '{"sub":"ad000000-0000-0000-0000-000000000001","email":"admin@rutax.cl","email_verified":true,"phone_verified":false}',
   'email', now(), now(), now())
on conflict (provider, provider_id) do nothing;

-- Mapeo del auth.users real → identidad de backstage (gobernanza).
insert into plataforma.super_admins (usuario_id, email, nombre, rol_admin, activo)
values
  ('ad000000-0000-0000-0000-000000000001',
   'admin@rutax.cl',
   'Fundador Rutax',
   'admin_total',
   true)
on conflict (usuario_id) do nothing;

-- Perfil de dominio del fundador (F3-A). tenant_id=null: fuera de todo tenant.
-- Constraints OK: usuarios_perfil_tenant_excepto_super_admin (super_admin +
-- tenant_id null) y usuarios_perfil_rol_coherente_con_tipo (super_admin/rol
-- super_admin); seller_id/driver_id null cumplen sus checks de coherencia.
-- Sin esta fila, una sesión Supabase real del super-admin NO trae el claim
-- top-level tipo_usuario='super_admin' (el hook lo deriva de usuarios_perfil).
-- Se inserta aquí — y no en la migración — porque usuarios_perfil.id referencia
-- auth.users(id): el uuid del fundador solo existe si corrió este seed (la
-- migración 20260712000007 hace el backfill genérico para entornos reales).
insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, rol, estado)
values
  ('ad000000-0000-0000-0000-000000000001',
   null,
   'Fundador Rutax',
   'super_admin',
   'super_admin',
   'activo')
on conflict (id) do nothing;

-- =============================================================================
-- 2. Tenant — Despachos del Centro SpA
-- =============================================================================
insert into identidad.tenants (id, nombre_fantasia, razon_social, rut, estado, plan_id, zona_horaria)
values (
  '10000000-0000-0000-0000-000000000001',
  'Despachos del Centro',
  'Despachos del Centro SpA',
  '76123456-7',
  'activo',
  'estandar',
  'America/Santiago'
)
on conflict (id) do nothing;

-- =============================================================================
-- 3. Sellers (3)
-- =============================================================================
insert into identidad.sellers (id, tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
values
  ('30000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   'FalabellaTech Ltda.','76555111-2','Felipe Araya','faraya@falabellatech.cl','activo'),
  ('30000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001',
   'MercadoSur SpA','77222333-4','Claudia Pino','cpino@mercadosur.cl','activo'),
  ('30000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001',
   'TecnoHogar Chile SpA','76888999-0','Raúl Sepúlveda','rsepulveda@tecnohogar.cl','activo')
on conflict (id) do nothing;

-- =============================================================================
-- 4. Conductores (12)
-- =============================================================================
-- Conductores 001-005 llevan datos bancarios (tienen liquidaciones y entran al
-- flujo de payout F19). 006-012 quedan con banco/tipo_cuenta/numero_cuenta NULL.
insert into identidad.conductores (id, tenant_id, nombre_completo, rut, tipo_relacion, estado,
                                   banco, tipo_cuenta, numero_cuenta)
values
  ('40000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   'Juan Pablo Pérez Rojas','12345678-9','independiente','activo',
   'Banco de Chile','corriente','00123456789'),
  ('40000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001',
   'Carlos Andrés González Muñoz','13456789-0','independiente','activo',
   'BCI','corriente','00987654321'),
  ('40000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001',
   'Pedro José Soto Vargas','14567890-k','dependiente','activo',
   'Banco Estado','vista','12345678'),
  ('40000000-0000-0000-0000-000000000004',
   '10000000-0000-0000-0000-000000000001',
   'Rodrigo Alejandro Martínez','15678901-2','independiente','activo',
   'Santander Chile','corriente','00456789012'),
  ('40000000-0000-0000-0000-000000000005',
   '10000000-0000-0000-0000-000000000001',
   'Francisco Javier Castro López','16789012-3','independiente','activo',
   'BCI','ahorro','00345678901'),
  ('40000000-0000-0000-0000-000000000006',
   '10000000-0000-0000-0000-000000000001',
   'Matías Ignacio Díaz Herrera','17890123-4','dependiente','activo',
   null,null,null),
  ('40000000-0000-0000-0000-000000000007',
   '10000000-0000-0000-0000-000000000001',
   'Diego Alonso Flores Contreras','18901234-5','independiente','activo',
   null,null,null),
  ('40000000-0000-0000-0000-000000000008',
   '10000000-0000-0000-0000-000000000001',
   'Andrés Felipe Romero Silva','19012345-6','independiente','activo',
   null,null,null),
  ('40000000-0000-0000-0000-000000000009',
   '10000000-0000-0000-0000-000000000001',
   'José Miguel Vega Morales','20123456-7','dependiente','activo',
   null,null,null),
  ('40000000-0000-0000-0000-000000000010',
   '10000000-0000-0000-0000-000000000001',
   'Pablo Sebastián Torres Reyes','21234567-8','independiente','activo',
   null,null,null),
  ('40000000-0000-0000-0000-000000000011',
   '10000000-0000-0000-0000-000000000001',
   'Cristián Eduardo Navarro','22345678-9','independiente','activo',
   null,null,null),
  ('40000000-0000-0000-0000-000000000012',
   '10000000-0000-0000-0000-000000000001',
   'Nicolás Matías Araya Cabrera','23456789-k','independiente','activo',
   null,null,null)
on conflict (id) do nothing;

-- =============================================================================
-- 5. usuarios_perfil (6 — vincula auth.users con roles del dominio)
-- =============================================================================
insert into identidad.usuarios_perfil (id, tenant_id, nombre_completo, tipo_usuario, rol, estado, seller_id, driver_id)
values
  ('20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   'Sebastián Morales Fuentes','interno','dueno','activo', null, null),
  ('20000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001',
   'Camila Reyes Gutiérrez','interno','supervisor','activo', null, null),
  ('20000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001',
   'Ignacio Vargas Contreras','interno','coordinador','activo', null, null),
  ('20000000-0000-0000-0000-000000000004',
   '10000000-0000-0000-0000-000000000001',
   'Valentina Silva Herrera','interno','administracion','activo', null, null),
  ('20000000-0000-0000-0000-000000000005',
   '10000000-0000-0000-0000-000000000001',
   'Juan Pablo Pérez Rojas','conductor','conductor','activo',
   null,'40000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000006',
   '10000000-0000-0000-0000-000000000001',
   'Felipe Araya','seller','seller','activo',
   '30000000-0000-0000-0000-000000000001', null)
on conflict (id) do nothing;

-- =============================================================================
-- 6. Configuración DTE (sandbox — adaptador stub, sin credenciales reales)
-- =============================================================================
insert into identidad.courier_config_dte (tenant_id, proveedor_dte, estado_certificacion)
values (
  '10000000-0000-0000-0000-000000000001',
  'simplefactura',
  'activo'
)
on conflict (tenant_id) do nothing;

-- CAF de folios (sandbox: folios 1–100 para facturas electrónicas tipo 33)
insert into identidad.folios_caf (
  id, tenant_id, tipo_documento, folio_desde, folio_hasta, folio_actual, estado
) values (
  'f0000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  33, 1, 100, 1, 'vigente'
)
on conflict (id) do nothing;

-- =============================================================================
-- 7. Tarifas — vigentes desde 2026-01-01 (sin fecha de término)
--    monto_conductor_clp añadido por migración 0006
-- =============================================================================
insert into identidad.tarifas (id, tenant_id, seller_id, tipo_entrega, modo_calculo, monto_clp, monto_conductor_clp, vigente_desde, estado)
values
  -- Tarifa por defecto del tenant — flex
  ('50000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   null,'flex','monto_fijo',3500,2200,'2026-01-01','activa'),
  -- Tarifa por defecto del tenant — same-day
  ('50000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001',
   null,'same_day','monto_fijo',4500,2800,'2026-01-01','activa'),
  -- Tarifa específica FalabellaTech — flex
  ('50000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   'flex','monto_fijo',3800,2400,'2026-01-01','activa'),
  -- Tarifa específica MercadoSur — flex
  ('50000000-0000-0000-0000-000000000004',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000002',
   'flex','monto_fijo',3200,2000,'2026-01-01','activa')
on conflict (id) do nothing;

-- =============================================================================
-- 8. Conexiones ML
--    FalabellaTech = sana | MercadoSur = sana | TecnoHogar = atención (demo desconexión)
-- =============================================================================
insert into identidad.conexiones_seller_ml (
  id, tenant_id, seller_id, ml_user_id, estado_salud,
  ultima_sync_exitosa_en, desconectada_desde, ultimo_error
) values
  ('e1000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   'ML_USER_FT_12345','sana',
   now() - interval '3 hours', null, null),
  ('e1000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000002',
   'ML_USER_MS_67890','sana',
   now() - interval '1 hour', null, null),
  ('e1000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000003',
   'ML_USER_TH_11111','atencion',
   now() - interval '26 hours',
   now() - interval '2 hours',
   'Token expirado — requiere reconexión OAuth')
on conflict (id) do nothing;

-- =============================================================================
-- 9. Config períodos — mensual para el tenant
-- =============================================================================
insert into dinero.config_periodos (id, tenant_id, seller_id, tipo_periodo, activa)
values
  ('90000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   null,'mensual',true)
on conflict (id) do nothing;

-- =============================================================================
-- 10. Pedidos (16 total: 12 flex entregados, 2 fallidos, 1 en_ruta, 1 pendiente_asignacion,
--     1 same-day entregado)
-- =============================================================================

-- ── FalabellaTech (seller 1, tarifa 3800 CLP) ─────────────────────────────
insert into operacion.pedidos (
  id, tenant_id, seller_id, tipo_pedido, origen,
  ml_order_id, ml_shipment_id, estado, estado_ml,
  driver_id_asignado,
  destinatario_nombre, destinatario_direccion, destinatario_comuna,
  destinatario_telefono, fecha_compromiso,
  tarifa_aplicable_id,
  cobro_generado, monto_cobro_clp,
  liquidacion_generada, monto_liquidacion_clp,
  creado_en
) values
  ('60000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   'flex','ml_ingesta','ML-ORD-20260602-001','FLEX-2026-100001',
   'entregado','delivered',
   '40000000-0000-0000-0000-000000000001',
   'Ana María Torres','Av. Providencia 1234, Dpto 52','Providencia',
   '+56912345678','2026-06-02',
   '50000000-0000-0000-0000-000000000003',
   true,3800,true,2400,
   '2026-06-02 08:00:00-03'),

  ('60000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   'flex','ml_ingesta','ML-ORD-20260603-002','FLEX-2026-100002',
   'entregado','delivered',
   '40000000-0000-0000-0000-000000000001',
   'Roberto Díaz Pizarro','Calle Los Aromos 567','Ñuñoa',
   '+56998765432','2026-06-03',
   '50000000-0000-0000-0000-000000000003',
   true,3800,true,2400,
   '2026-06-03 09:00:00-03'),

  ('60000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   'flex','ml_ingesta','ML-ORD-20260604-003','FLEX-2026-100003',
   'entregado','delivered',
   '40000000-0000-0000-0000-000000000002',
   'Marcela Fuentes Rojas','Av. Irarrázaval 2345','Ñuñoa',
   '+56956789012','2026-06-04',
   '50000000-0000-0000-0000-000000000003',
   true,3800,true,2400,
   '2026-06-04 08:30:00-03'),

  -- Pedido fallido (incidencia: destinatario ausente)
  ('60000000-0000-0000-0000-000000000004',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   'flex','ml_ingesta','ML-ORD-20260605-004','FLEX-2026-100004',
   'fallido','not_delivered',
   '40000000-0000-0000-0000-000000000006',
   'Luis Alberto Campos','Av. Las Condes 8901, Of. 304','Las Condes',
   '+56934567890','2026-06-05',
   '50000000-0000-0000-0000-000000000003',
   false,null,false,null,
   '2026-06-05 10:00:00-03'),

  -- Pedido en ruta (incidencia: reagendado)
  ('60000000-0000-0000-0000-000000000005',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   'flex','ml_ingesta','ML-ORD-20260609-005','FLEX-2026-100005',
   'en_ruta','shipped',
   '40000000-0000-0000-0000-000000000007',
   'Sofía Guzmán Arenas','Pedro de Valdivia 432','Providencia',
   '+56978901234','2026-06-09',
   '50000000-0000-0000-0000-000000000003',
   false,null,false,null,
   '2026-06-09 07:00:00-03');

-- ── MercadoSur (seller 2, tarifa 3200 CLP) ────────────────────────────────
insert into operacion.pedidos (
  id, tenant_id, seller_id, tipo_pedido, origen,
  ml_order_id, ml_shipment_id, estado, estado_ml,
  driver_id_asignado,
  destinatario_nombre, destinatario_direccion, destinatario_comuna,
  destinatario_telefono, fecha_compromiso,
  tarifa_aplicable_id,
  cobro_generado, monto_cobro_clp,
  liquidacion_generada, monto_liquidacion_clp,
  creado_en
) values
  ('60000000-0000-0000-0000-000000000006',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000002',
   'flex','ml_ingesta','ML-ORD-20260603-006','FLEX-2026-200001',
   'entregado','delivered',
   '40000000-0000-0000-0000-000000000003',
   'Carla Ortiz Muñoz','Av. Vicuña Mackenna 3456','San Miguel',
   '+56945678901','2026-06-03',
   '50000000-0000-0000-0000-000000000004',
   true,3200,true,2000,
   '2026-06-03 08:00:00-03'),

  ('60000000-0000-0000-0000-000000000007',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000002',
   'flex','ml_ingesta','ML-ORD-20260605-007','FLEX-2026-200002',
   'entregado','delivered',
   '40000000-0000-0000-0000-000000000003',
   'Gustavo Herrera Lagos','Calle Walker Martínez 789','La Cisterna',
   '+56967890123','2026-06-05',
   '50000000-0000-0000-0000-000000000004',
   true,3200,true,2000,
   '2026-06-05 09:00:00-03'),

  ('60000000-0000-0000-0000-000000000008',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000002',
   'flex','ml_ingesta','ML-ORD-20260606-008','FLEX-2026-200003',
   'entregado','delivered',
   '40000000-0000-0000-0000-000000000004',
   'Patricia Sánchez Leiva','Av. Américo Vespucio 1234','Pudahuel',
   '+56989012345','2026-06-06',
   '50000000-0000-0000-0000-000000000004',
   true,3200,true,2000,
   '2026-06-06 08:30:00-03'),

  -- Pedido fallido (incidencia: dirección errónea)
  ('60000000-0000-0000-0000-000000000009',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000002',
   'flex','ml_ingesta','ML-ORD-20260607-009','FLEX-2026-200004',
   'fallido','not_delivered',
   '40000000-0000-0000-0000-000000000006',
   'Marco Peña Riquelme','Pasaje Los Boldos 45','La Florida',
   '+56912345679','2026-06-07',
   '50000000-0000-0000-0000-000000000004',
   false,null,false,null,
   '2026-06-07 10:00:00-03'),

  -- Pedido pendiente de asignación
  ('60000000-0000-0000-0000-000000000010',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000002',
   'flex','ml_ingesta','ML-ORD-20260609-010','FLEX-2026-200005',
   'pendiente_asignacion','ready_to_ship',
   null,
   'Isabel Núñez Carrasco','Gran Avenida 9012','San Miguel',
   '+56923456789','2026-06-09',
   '50000000-0000-0000-0000-000000000004',
   false,null,false,null,
   '2026-06-09 06:00:00-03');

-- ── TecnoHogar (seller 3, tarifa default 3500 CLP) ────────────────────────
insert into operacion.pedidos (
  id, tenant_id, seller_id, tipo_pedido, origen,
  ml_order_id, ml_shipment_id, estado, estado_ml,
  driver_id_asignado,
  destinatario_nombre, destinatario_direccion, destinatario_comuna,
  destinatario_telefono, fecha_compromiso,
  tarifa_aplicable_id,
  cobro_generado, monto_cobro_clp,
  liquidacion_generada, monto_liquidacion_clp,
  creado_en
) values
  ('60000000-0000-0000-0000-000000000011',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000003',
   'flex','ml_ingesta','ML-ORD-20260604-011','FLEX-2026-300001',
   'entregado','delivered',
   '40000000-0000-0000-0000-000000000004',
   'Rodrigo Espinoza Castro','Av. Tobalaba 5678','Peñalolén',
   '+56934567891','2026-06-04',
   '50000000-0000-0000-0000-000000000001',
   true,3500,true,2200,
   '2026-06-04 08:00:00-03'),

  ('60000000-0000-0000-0000-000000000012',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000003',
   'flex','ml_ingesta','ML-ORD-20260605-012','FLEX-2026-300002',
   'entregado','delivered',
   '40000000-0000-0000-0000-000000000005',
   'Ximena Bravo Navarro','Calle Antártica 234','Quilicura',
   '+56956789013','2026-06-05',
   '50000000-0000-0000-0000-000000000001',
   true,3500,true,2200,
   '2026-06-05 09:00:00-03'),

  ('60000000-0000-0000-0000-000000000013',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000003',
   'flex','ml_ingesta','ML-ORD-20260606-013','FLEX-2026-300003',
   'entregado','delivered',
   '40000000-0000-0000-0000-000000000005',
   'Daniela Mora Cisternas','Av. El Salto 1234','Recoleta',
   '+56978901235','2026-06-06',
   '50000000-0000-0000-0000-000000000001',
   true,3500,true,2200,
   '2026-06-06 08:30:00-03'),

  ('60000000-0000-0000-0000-000000000014',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000003',
   'flex','ml_ingesta','ML-ORD-20260607-014','FLEX-2026-300004',
   'entregado','delivered',
   '40000000-0000-0000-0000-000000000001',
   'Héctor Miranda Tapia','Av. Grecia 4567','Ñuñoa',
   '+56989012346','2026-06-07',
   '50000000-0000-0000-0000-000000000001',
   true,3500,true,2200,
   '2026-06-07 08:00:00-03'),

  -- Pedido same-day entregado (TecnoHogar, tarifa same_day)
  ('60000000-0000-0000-0000-000000000015',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000003',
   'same_day','same_day_manual',
   null,null,
   'entregado',null,
   '40000000-0000-0000-0000-000000000002',
   'Javiera Pizarro Soto','Calle Catedral 890','Santiago',
   '+56912345680','2026-06-08',
   '50000000-0000-0000-0000-000000000002',
   true,4500,true,2800,
   '2026-06-08 10:00:00-03'),

  ('60000000-0000-0000-0000-000000000016',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000003',
   'flex','ml_ingesta','ML-ORD-20260608-016','FLEX-2026-300005',
   'entregado','delivered',
   '40000000-0000-0000-0000-000000000002',
   'Fernando Valenzuela','Av. Libertador 2345','La Reina',
   '+56923456790','2026-06-08',
   '50000000-0000-0000-0000-000000000001',
   true,3500,true,2200,
   '2026-06-08 09:00:00-03')
on conflict (id) do nothing;

-- ── Geocoding de demo ─────────────────────────────────────────────────────
-- Los pedidos se insertan directo por SQL, así que NUNCA pasan por la tubería
-- de ingesta (crearPedidoSameDay / ML) que publica `operacion/pedido.ingestado`
-- y dispara el job de geocoding. Sin esto quedan en geo_estado='pendiente' para
-- siempre → spinner "Ubicando dirección…" eterno en la UI. Reproducimos aquí lo
-- que haría el StubGeocodingAdapter (dev/demo): centroide de la comuna, confianza
-- 0.5, geo_estado='resuelto', cobertura_estado='tarifada' (todos los pedidos de
-- demo están en comunas RM con tarifa vigente). Idempotente: solo toca filas del
-- tenant de demo que sigan 'pendiente'.
update operacion.pedidos p
set lat              = c.lat,
    long             = c.long,
    geo_estado       = 'resuelto',
    geo_confianza    = 0.5,
    geocodificado_en = p.creado_en,
    cobertura_estado = 'tarifada'
from (values
  ('Providencia', -33.4314, -70.6111),
  ('Ñuñoa',       -33.4564, -70.5969),
  ('Las Condes',  -33.4089, -70.5683),
  ('San Miguel',  -33.4972, -70.6500),
  ('La Cisterna', -33.5333, -70.6625),
  ('Pudahuel',    -33.4417, -70.7583),
  ('La Florida',  -33.5500, -70.5833),
  ('Peñalolén',   -33.4889, -70.5417),
  ('Quilicura',   -33.3667, -70.7333),
  ('Recoleta',    -33.4000, -70.6417),
  ('Santiago',    -33.4489, -70.6693),
  ('La Reina',    -33.4444, -70.5375)
) as c(comuna, lat, long)
where p.tenant_id = '10000000-0000-0000-0000-000000000001'
  and p.destinatario_comuna = c.comuna
  and p.geo_estado = 'pendiente';

-- =============================================================================
-- 11. Manifiestos + asignaciones
-- =============================================================================
insert into operacion.manifiestos (id, tenant_id, driver_id, nombre, fecha_operacion, estado, confirmado_en, completado_en)
values
  -- Manifiesto completado (conductor 1, 3 Jun 2026)
  ('70000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001',
   'Ruta JuanPablo 2026-06-03','2026-06-03','completado',
   '2026-06-03 07:30:00-03','2026-06-03 18:00:00-03'),
  -- Manifiesto en ruta (conductor 7, hoy)
  ('70000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000007',
   'Ruta Diego 2026-06-09','2026-06-09','en_ruta',
   '2026-06-09 07:30:00-03', null)
on conflict (id) do nothing;

-- Asignaciones activas del manifiesto en ruta
insert into operacion.asignaciones_pedido (
  id, tenant_id, pedido_id, manifiesto_id, driver_id, seller_id, activa
) values (
  'a1000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000005',
  '70000000-0000-0000-0000-000000000002',
  '40000000-0000-0000-0000-000000000007',
  '30000000-0000-0000-0000-000000000001',
  true
)
on conflict (id) do nothing;

-- =============================================================================
-- 12. Incidencias (3)
-- Columna del tipo: "tipo" (enum operacion.tipo_incidencia)
-- seller_id: NOT NULL, denormalizado desde pedidos.seller_id
-- Auditoría: abierta_por_usuario_id
-- =============================================================================
insert into operacion.incidencias (
  id, tenant_id, pedido_id, seller_id, tipo, estado,
  descripcion, abierta_por_usuario_id, abierta_en
) values
  ('80000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000004',
   '30000000-0000-0000-0000-000000000001',
   'destinatario_ausente','cerrada',
   'Destinatario no encontrado en domicilio tras 2 intentos. Paquete devuelto a bodega.',
   '20000000-0000-0000-0000-000000000003',
   '2026-06-05 14:00:00-03'),
  ('80000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000009',
   '30000000-0000-0000-0000-000000000002',
   'direccion_erronea','resuelta',
   'El número indicado no existe en Pasaje Los Boldos. Se coordinó nueva dirección con el comprador.',
   '20000000-0000-0000-0000-000000000003',
   '2026-06-07 11:30:00-03'),
  ('80000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000005',
   '30000000-0000-0000-0000-000000000001',
   'reagendado','abierta',
   'Cliente solicitó reagendar entrega para mañana entre 10–13 hrs.',
   '20000000-0000-0000-0000-000000000003',
   '2026-06-09 11:00:00-03')
on conflict (id) do nothing;

-- =============================================================================
-- 13. Períodos de cobro (3 — uno por seller con entregas, todos abiertos)
-- =============================================================================
insert into dinero.periodos_cobro (
  id, tenant_id, seller_id, fecha_inicio, fecha_fin,
  tipo_periodo, estado, total_lineas, monto_total_clp
) values
  ('a0000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   '2026-06-01','2026-06-30',
   'mensual','abierto',3,11400),
  ('a0000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000002',
   '2026-06-01','2026-06-30',
   'mensual','abierto',3,9600),
  ('a0000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000003',
   '2026-06-01','2026-06-30',
   'mensual','abierto',6,22000)
on conflict (id) do nothing;

-- =============================================================================
-- 14. Líneas de cobro (12 entregados — monto_final_clp es GENERATED)
-- =============================================================================
insert into dinero.lineas_cobro (
  id, tenant_id, seller_id, pedido_id, periodo_cobro_id, tarifa_id,
  monto_base_clp, ajuste_incidencia_clp,
  concepto, tipo_pedido, fecha_entrega, origen_generacion
) values
  -- FalabellaTech (3 líneas, período a1)
  ('c0000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000003',
   3800,0,'Entrega Flex – FalabellaTech Ltda.','flex','2026-06-02','motor_automatico'),

  ('c0000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000003',
   3800,0,'Entrega Flex – FalabellaTech Ltda.','flex','2026-06-03','motor_automatico'),

  ('c0000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000003',
   'a0000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000003',
   3800,0,'Entrega Flex – FalabellaTech Ltda.','flex','2026-06-04','motor_automatico'),

  -- MercadoSur (3 líneas, período a2)
  ('c0000000-0000-0000-0000-000000000004',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000002',
   '60000000-0000-0000-0000-000000000006',
   'a0000000-0000-0000-0000-000000000002',
   '50000000-0000-0000-0000-000000000004',
   3200,0,'Entrega Flex – MercadoSur SpA','flex','2026-06-03','motor_automatico'),

  ('c0000000-0000-0000-0000-000000000005',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000002',
   '60000000-0000-0000-0000-000000000007',
   'a0000000-0000-0000-0000-000000000002',
   '50000000-0000-0000-0000-000000000004',
   3200,0,'Entrega Flex – MercadoSur SpA','flex','2026-06-05','motor_automatico'),

  ('c0000000-0000-0000-0000-000000000006',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000002',
   '60000000-0000-0000-0000-000000000008',
   'a0000000-0000-0000-0000-000000000002',
   '50000000-0000-0000-0000-000000000004',
   3200,0,'Entrega Flex – MercadoSur SpA','flex','2026-06-06','motor_automatico'),

  -- TecnoHogar (6 líneas: 4 flex + 1 same_day + 1 flex, período a3)
  ('c0000000-0000-0000-0000-000000000007',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000003',
   '60000000-0000-0000-0000-000000000011',
   'a0000000-0000-0000-0000-000000000003',
   '50000000-0000-0000-0000-000000000001',
   3500,0,'Entrega Flex – TecnoHogar Chile SpA','flex','2026-06-04','motor_automatico'),

  ('c0000000-0000-0000-0000-000000000008',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000003',
   '60000000-0000-0000-0000-000000000012',
   'a0000000-0000-0000-0000-000000000003',
   '50000000-0000-0000-0000-000000000001',
   3500,0,'Entrega Flex – TecnoHogar Chile SpA','flex','2026-06-05','motor_automatico'),

  ('c0000000-0000-0000-0000-000000000009',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000003',
   '60000000-0000-0000-0000-000000000013',
   'a0000000-0000-0000-0000-000000000003',
   '50000000-0000-0000-0000-000000000001',
   3500,0,'Entrega Flex – TecnoHogar Chile SpA','flex','2026-06-06','motor_automatico'),

  ('c0000000-0000-0000-0000-000000000010',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000003',
   '60000000-0000-0000-0000-000000000014',
   'a0000000-0000-0000-0000-000000000003',
   '50000000-0000-0000-0000-000000000001',
   3500,0,'Entrega Flex – TecnoHogar Chile SpA','flex','2026-06-07','motor_automatico'),

  ('c0000000-0000-0000-0000-000000000011',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000003',
   '60000000-0000-0000-0000-000000000015',
   'a0000000-0000-0000-0000-000000000003',
   '50000000-0000-0000-0000-000000000002',
   4500,0,'Entrega Same-day – TecnoHogar Chile SpA','same_day','2026-06-08','motor_automatico'),

  ('c0000000-0000-0000-0000-000000000012',
   '10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000003',
   '60000000-0000-0000-0000-000000000016',
   'a0000000-0000-0000-0000-000000000003',
   '50000000-0000-0000-0000-000000000001',
   3500,0,'Entrega Flex – TecnoHogar Chile SpA','flex','2026-06-08','motor_automatico')

on conflict (pedido_id) do nothing;

-- =============================================================================
-- 15. Liquidaciones (5 conductores con entregas, todas en borrador)
-- =============================================================================
insert into dinero.liquidaciones (
  id, tenant_id, driver_id, fecha_inicio, fecha_fin,
  tipo_periodo, estado, total_entregas, monto_total_clp, tipo_relacion_conductor
) values
  ('b0000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001',
   '2026-06-01','2026-06-30','mensual','borrador',3,7000,'independiente'),
  ('b0000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000002',
   '2026-06-01','2026-06-30','mensual','borrador',3,7400,'independiente'),
  ('b0000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000003',
   '2026-06-01','2026-06-30','mensual','borrador',2,4000,'dependiente'),
  ('b0000000-0000-0000-0000-000000000004',
   '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000004',
   '2026-06-01','2026-06-30','mensual','borrador',2,4200,'independiente'),
  ('b0000000-0000-0000-0000-000000000005',
   '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000005',
   '2026-06-01','2026-06-30','mensual','borrador',2,4400,'independiente')
on conflict (id) do nothing;

-- =============================================================================
-- 16. Líneas de liquidación (12 — espejo de las líneas de cobro)
-- =============================================================================
insert into dinero.lineas_liquidacion (
  id, tenant_id, driver_id, pedido_id, liquidacion_id,
  monto_base_clp, ajuste_incidencia_clp,
  concepto, fecha_entrega, origen_generacion
) values
  -- Conductor 1 (liq b1): P01, P02, P14
  ('d0000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001',
   2400,0,'Entrega Flex – Providencia','2026-06-02','motor_automatico'),

  ('d0000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000001',
   2400,0,'Entrega Flex – Ñuñoa','2026-06-03','motor_automatico'),

  ('d0000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000014',
   'b0000000-0000-0000-0000-000000000001',
   2200,0,'Entrega Flex – Ñuñoa','2026-06-07','motor_automatico'),

  -- Conductor 2 (liq b2): P03, P15, P16
  ('d0000000-0000-0000-0000-000000000004',
   '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000002',
   '60000000-0000-0000-0000-000000000003',
   'b0000000-0000-0000-0000-000000000002',
   2400,0,'Entrega Flex – Ñuñoa','2026-06-04','motor_automatico'),

  ('d0000000-0000-0000-0000-000000000005',
   '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000002',
   '60000000-0000-0000-0000-000000000015',
   'b0000000-0000-0000-0000-000000000002',
   2800,0,'Entrega Same-day – Santiago','2026-06-08','motor_automatico'),

  ('d0000000-0000-0000-0000-000000000006',
   '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000002',
   '60000000-0000-0000-0000-000000000016',
   'b0000000-0000-0000-0000-000000000002',
   2200,0,'Entrega Flex – La Reina','2026-06-08','motor_automatico'),

  -- Conductor 3 (liq b3): P06, P07
  ('d0000000-0000-0000-0000-000000000007',
   '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000003',
   '60000000-0000-0000-0000-000000000006',
   'b0000000-0000-0000-0000-000000000003',
   2000,0,'Entrega Flex – San Miguel','2026-06-03','motor_automatico'),

  ('d0000000-0000-0000-0000-000000000008',
   '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000003',
   '60000000-0000-0000-0000-000000000007',
   'b0000000-0000-0000-0000-000000000003',
   2000,0,'Entrega Flex – La Cisterna','2026-06-05','motor_automatico'),

  -- Conductor 4 (liq b4): P08, P11
  ('d0000000-0000-0000-0000-000000000009',
   '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000004',
   '60000000-0000-0000-0000-000000000008',
   'b0000000-0000-0000-0000-000000000004',
   2000,0,'Entrega Flex – Pudahuel','2026-06-06','motor_automatico'),

  ('d0000000-0000-0000-0000-000000000010',
   '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000004',
   '60000000-0000-0000-0000-000000000011',
   'b0000000-0000-0000-0000-000000000004',
   2200,0,'Entrega Flex – Peñalolén','2026-06-04','motor_automatico'),

  -- Conductor 5 (liq b5): P12, P13
  ('d0000000-0000-0000-0000-000000000011',
   '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000005',
   '60000000-0000-0000-0000-000000000012',
   'b0000000-0000-0000-0000-000000000005',
   2200,0,'Entrega Flex – Quilicura','2026-06-05','motor_automatico'),

  ('d0000000-0000-0000-0000-000000000012',
   '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000005',
   '60000000-0000-0000-0000-000000000013',
   'b0000000-0000-0000-0000-000000000005',
   2200,0,'Entrega Flex – Recoleta','2026-06-06','motor_automatico')

on conflict (pedido_id) do nothing;

-- =============================================================================
-- Anclar el demo operativo a "hoy"
-- =============================================================================
-- El seed se construye con fechas fijas de junio 2026 (para mantener su
-- consistencia interna), pero el dashboard "HOY" filtra pedidos por
-- fecha_compromiso = current_date. Sin este ajuste, el panel del dueño aparece
-- vacío cualquier día distinto al de construcción del seed. Desplazamos las
-- fechas operativas a la fecha actual para que el demo siempre muestre datos.
-- Idempotente: re-ejecutable sin efectos secundarios.
update operacion.pedidos
  set fecha_compromiso = current_date
  where fecha_compromiso is not null;

update operacion.manifiestos
  set fecha_operacion = current_date;

-- =============================================================================
-- Fin del seed
-- =============================================================================
do $$
begin
  raise notice 'Seed completado. Tenant: Despachos del Centro SpA';
  raise notice '  Sellers: 3 | Conductores: 12 | Pedidos: 16';
  raise notice '  Entregas: 12 cobros + 12 liquidaciones generadas';
  raise notice '  Incidencias: 3 | Manifiestos: 2 (1 completado + 1 en ruta)';
  raise notice '  Períodos de cobro: 3 (todos abiertos — cierralos desde la app)';
  raise notice '  TecnoHogar en estado "atencion" — usa la alerta de reconexión';
end $$;
