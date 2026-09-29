-- =============================================================================
-- Escritura de tarifas, zonas y comunas de zona: solo quien gestiona tarifas
-- =============================================================================
--
-- QUÉ ARREGLA
-- Las políticas de escritura de `identidad.tarifas`, `identidad.zonas` e
-- `identidad.zona_comunas` solo pedían «interno del mismo tenant». El permiso
-- real —capacidad `gestionar_tarifas`— vivía únicamente en TypeScript, así que
-- un coordinador o un supervisor podía cambiar `monto_clp` o
-- `monto_conductor_clp` con un PATCH directo a PostgREST, sin pasar por la
-- pantalla, sin su gate y sin bitácora. Es dinero: la regla del proyecto es que
-- el permiso se impone en la base (CLAUDE.md, «Reglas no-negociables»).
-- Encontrado por QA el 2026-09-29.
--
-- ⚠️ ESTA POLÍTICA DEBE SEGUIR A LA MATRIZ DE TYPESCRIPT
-- Los roles de abajo son exactamente los que tienen `gestionar_tarifas` en
-- `MATRIZ_ROL_CAPACIDADES` (`src/modules/identidad/capacidades.ts`): hoy
-- `dueno` y `administracion` (RF-009: «Dueño / admin»). Si la matriz cambia,
-- esta política se cambia a mano en una migración nueva. La red que lo avisa es
-- `src/modules/identidad/rls-gestionar-tarifas-sql.test.ts`, que compara esta
-- lista con la matriz y falla si divergen.
--
-- QUÉ NO ROMPE
-- - Ninguna Server Action escribe estas tablas con la sesión del usuario: todas
--   usan service_role tras validar `puedeGestionarTarifas`
--   (`configuracion/tarifas/actions.ts`, `configuracion/zonas/actions.ts`,
--   `modules/operacion/zonas.ts`). service_role no pasa por RLS.
-- - Las RPC (`guardar_zona_con_comunas`,
--   `guardar_zonas_y_tarifas_puesta_en_marcha`,
--   `cerrar_tarifas_legadas_del_tenant`) corren como service_role.
-- - La LECTURA no cambia: cualquier interno del tenant sigue viendo tarifas y
--   zonas (las pantallas de operación y preparación las necesitan).
--
-- Idempotente: cada política se borra y se vuelve a crear.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- identidad.tarifas
-- -----------------------------------------------------------------------------
drop policy if exists tarifas_insert_interno on identidad.tarifas;
create policy tarifas_insert_interno on identidad.tarifas
  for insert to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
    and identidad.claim_rol() in ('dueno', 'administracion')
  );

drop policy if exists tarifas_update_interno on identidad.tarifas;
create policy tarifas_update_interno on identidad.tarifas
  for update to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
    and identidad.claim_rol() in ('dueno', 'administracion')
  )
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
    and identidad.claim_rol() in ('dueno', 'administracion')
  );

-- -----------------------------------------------------------------------------
-- identidad.zonas
-- -----------------------------------------------------------------------------
drop policy if exists zonas_insert_interno on identidad.zonas;
create policy zonas_insert_interno on identidad.zonas
  for insert to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
    and identidad.claim_rol() in ('dueno', 'administracion')
  );

drop policy if exists zonas_update_interno on identidad.zonas;
create policy zonas_update_interno on identidad.zonas
  for update to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
    and identidad.claim_rol() in ('dueno', 'administracion')
  )
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
    and identidad.claim_rol() in ('dueno', 'administracion')
  );

-- -----------------------------------------------------------------------------
-- identidad.zona_comunas (mover una comuna de zona cambia qué tarifa se cobra)
-- -----------------------------------------------------------------------------
drop policy if exists zona_comunas_insert_interno on identidad.zona_comunas;
create policy zona_comunas_insert_interno on identidad.zona_comunas
  for insert to authenticated
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
    and identidad.claim_rol() in ('dueno', 'administracion')
  );

drop policy if exists zona_comunas_update_interno on identidad.zona_comunas;
create policy zona_comunas_update_interno on identidad.zona_comunas
  for update to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
    and identidad.claim_rol() in ('dueno', 'administracion')
  )
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
    and identidad.claim_rol() in ('dueno', 'administracion')
  );

drop policy if exists zona_comunas_delete_interno on identidad.zona_comunas;
create policy zona_comunas_delete_interno on identidad.zona_comunas
  for delete to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
    and identidad.claim_rol() in ('dueno', 'administracion')
  );
