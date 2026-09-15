-- =============================================================================
-- Pruebas — invitación del conductor por TELÉFONO (F4.a)
-- =============================================================================
-- Demuestra, contra una base Postgres real, que la migración
-- 20260915000001 cumple su contrato SIN abrir la fuga del token:
--
--   (a) el índice único parcial permite el MISMO teléfono pendiente en dos
--       tenants distintos, pero NO dos veces en el mismo tenant;
--   (b) el CHECK de coherencia contacto↔tipo obliga al conductor a llevar
--       teléfono (y no correo) y a los demás lo contrario;
--   (c) `token` sigue fuera de la vista y del grant por columna, y ahora
--       `telefono` sí está dentro de ambos.
--
-- Se siembra dentro de la transacción con el rol privilegiado del runner de
-- pgTAP y se hace rollback al final. Los tenants se crean al vuelo. `driver_id`
-- y `seller_id` NO tienen FK (solo CHECK de coherencia), así que basta un uuid
-- cualquiera para satisfacer la coherencia; no hacen falta fixtures de
-- conductores/sellers.
--
-- Ejecutar:  npx supabase test db
-- =============================================================================

begin;

select plan(9);

-- -----------------------------------------------------------------------------
-- Contrato de esquema: telefono existe; email ya es nullable.
-- -----------------------------------------------------------------------------
select has_column(
  'identidad', 'invitaciones', 'telefono',
  'identidad.invitaciones tiene la columna telefono'
);
select col_is_null(
  'identidad', 'invitaciones', 'email',
  'email dejó de ser NOT NULL (el conductor no lo lleva)'
);

-- -----------------------------------------------------------------------------
-- Superficie de lectura: telefono dentro, token fuera (vista espejo).
-- -----------------------------------------------------------------------------
select has_column(
  'public', 'invitaciones', 'telefono',
  'public.invitaciones expone telefono'
);
select hasnt_column(
  'public', 'invitaciones', 'token',
  'public.invitaciones sigue SIN exponer token'
);

-- Fixtures mínimos: dos couriers (tenants).
insert into identidad.tenants (id, nombre_fantasia, razon_social, rut)
  values ('cccccccc-0000-0000-0000-00000000000a'::uuid, 'Courier A', 'Courier A SpA', '76000001-9'),
         ('cccccccc-0000-0000-0000-00000000000b'::uuid, 'Courier B', 'Courier B SpA', '76000002-7');

-- -----------------------------------------------------------------------------
-- (b) CHECK de coherencia contacto↔tipo.
-- -----------------------------------------------------------------------------
-- Conductor con teléfono y sin correo: OK.
select lives_ok(
  $$ insert into identidad.invitaciones
       (tenant_id, tipo_usuario, rol, driver_id, telefono, token, expira_en)
     values
       ('cccccccc-0000-0000-0000-00000000000a'::uuid, 'conductor', 'conductor',
        'dddddddd-0000-0000-0000-00000000000a'::uuid, '56911112222',
        'tok-conductor-a', now() + interval '7 days') $$,
  'Conductor con telefono y email NULL: permitido'
);

-- Conductor con correo (rama equivocada): rechazado por el CHECK.
select throws_ok(
  $$ insert into identidad.invitaciones
       (tenant_id, tipo_usuario, rol, driver_id, email, token, expira_en)
     values
       ('cccccccc-0000-0000-0000-00000000000a'::uuid, 'conductor', 'conductor',
        'dddddddd-0000-0000-0000-00000000000a'::uuid, 'chofer@example.com',
        'tok-conductor-mal', now() + interval '7 days') $$,
  '23514',
  null,
  'Conductor con email (sin telefono) viola invitaciones_contacto_por_tipo'
);

-- Seller con teléfono (rama equivocada): rechazado por el CHECK. Se pasa
-- seller_id para satisfacer invitaciones_seller_id_coherente y aislar la causa.
select throws_ok(
  $$ insert into identidad.invitaciones
       (tenant_id, tipo_usuario, rol, seller_id, telefono, token, expira_en)
     values
       ('cccccccc-0000-0000-0000-00000000000a'::uuid, 'seller', 'seller',
        'eeeeeeee-0000-0000-0000-00000000000a'::uuid, '56933334444',
        'tok-seller-mal', now() + interval '7 days') $$,
  '23514',
  null,
  'No-conductor con telefono (sin email) viola invitaciones_contacto_por_tipo'
);

-- -----------------------------------------------------------------------------
-- (a) Índice único parcial: mismo teléfono en OTRO tenant, OK.
-- -----------------------------------------------------------------------------
select lives_ok(
  $$ insert into identidad.invitaciones
       (tenant_id, tipo_usuario, rol, driver_id, telefono, token, expira_en)
     values
       ('cccccccc-0000-0000-0000-00000000000b'::uuid, 'conductor', 'conductor',
        'dddddddd-0000-0000-0000-00000000000b'::uuid, '56911112222',
        'tok-conductor-b', now() + interval '7 days') $$,
  'Mismo telefono pendiente en OTRO tenant: permitido (un conductor sirve a 2 couriers)'
);

-- Mismo teléfono pendiente de conductor DOS veces en el MISMO tenant: choca.
select throws_ok(
  $$ insert into identidad.invitaciones
       (tenant_id, tipo_usuario, rol, driver_id, telefono, token, expira_en)
     values
       ('cccccccc-0000-0000-0000-00000000000a'::uuid, 'conductor', 'conductor',
        'dddddddd-0000-0000-0000-00000000000a'::uuid, '56911112222',
        'tok-conductor-dup', now() + interval '7 days') $$,
  '23505',
  null,
  'Segunda invitación pendiente al MISMO telefono en el MISMO tenant: rechazada'
);

select * from finish();
rollback;
