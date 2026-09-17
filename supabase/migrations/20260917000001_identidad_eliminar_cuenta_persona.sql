-- =============================================================================
-- identidad.eliminar_cuenta_persona — borrado duro TODO-O-NADA de una persona
-- =============================================================================
-- Backstage `/admin/cuentas` (`src/modules/plataforma/baja-cuentas.ts`): dar de
-- baja a un seller o conductor que NO tiene relación con pedidos ni dinero
-- (`tieneRelacionConPedidosODinero`) borra la cuenta entera en vez de
-- desactivarla.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ HACE FALTA UNA FUNCIÓN, Y NO EL DELETE POR PASOS DESDE TYPESCRIPT
-- -----------------------------------------------------------------------------
-- Cada `.delete()` de PostgREST es su PROPIA transacción. El borrado duro tenía
-- que tocar el perfil, después la ficha (`sellers`/`conductores`) y de paso sus
-- hijos con FK `restrict`/NO ACTION — y un fallo a mitad de camino dejaba
-- huérfanos: el perfil ya borrado, la ficha viva, `auth.users` borrado con la
-- ficha todavía colgando. Concretamente:
--   · `identidad.seller_bodegas.seller_id → sellers(id)` es `on delete
--     restrict`. **Todo seller de autoservicio tiene al menos una bodega** — el
--     wizard de alta la exige — así que el borrado duro por pasos SIEMPRE
--     chocaba acá.
--   · `identidad.conexiones_seller_ml`/`conexiones_seller_shopify` tienen,
--     ADEMÁS de su FK simple, una FK COMPUESTA `(tenant_id, seller_id) →
--     sellers(tenant_id, id)` declarada SIN `on delete cascade` → NO ACTION
--     (=restrict). Esa compuesta bloquea el `delete from sellers` aunque la FK
--     simple diga `on delete cascade`: Postgres evalúa TODAS las FK que
--     referencian la fila, y basta que UNA sea NO ACTION para que el DELETE
--     entero falle — la cascada de la otra no llega a aplicarse.
-- Con los deletes sueltos desde TypeScript, ese choque pasaba DESPUÉS de haber
-- borrado ya el perfil (`usuarios_perfil`) — y en la rama de purga multi-courier
-- (última membresía) el código igual llamaba `auth.admin.deleteUser` aunque el
-- `delete sellers` hubiera fallado: `auth.users` borrado + `sellers` colgada +
-- imposible reactivar limpio.
--
-- Esta función hace TODO el borrado —hijos con FK restrict, perfil, ficha— EN
-- UNA transacción SQL. Si cualquier paso lanza (incluida una FK que esta lista
-- no enumeró), Postgres hace ROLLBACK del bloque entero: nada se borró. El
-- llamador TypeScript solo debe llamar `auth.admin.deleteUser` DESPUÉS de que
-- esta función haya retornado sin error — nunca antes, y nunca si falló.
--
-- -----------------------------------------------------------------------------
-- QUÉ NO ENUMERA A PROPÓSITO, Y POR QUÉ ES SEGURO NO HACERLO
-- -----------------------------------------------------------------------------
-- No hace falta enumerar CADA fila que pudiera referenciar `sellers`/
-- `conductores`: la atomicidad es la que protege, no la exhaustividad. Si esta
-- función se olvidó de una tabla con FK restrict, el `delete` final sobre la
-- ficha simplemente lanza `23503` y TODO el bloque se deshace — el llamador ve
-- el error, no borra `auth.users`, y el flujo de TypeScript degrada a
-- desactivación (mismo criterio que ya regía antes de esta migración). Un
-- ejemplo real: `operacion.manifiestos.driver_id` es `restrict` y NO está en la
-- lista de abajo — pero un manifiesto sin ninguna fila en
-- `operacion.asignaciones_pedido` (que SÍ frena el borrado antes de llegar
-- aquí, vía el predicado `tieneRelacionConPedidosODinero`) no debería existir
-- nunca, así que en la práctica no hace falta, y si alguna vez existiera, el
-- rollback lo atrapa igual.
--
-- El `entidad_compartida` (dos cuentas para la misma ficha, ver
-- `/admin/cuentas`) también queda protegido SOLO. Si otra cuenta (otro
-- `auth_user_id`) todavía tiene `usuarios_perfil.seller_id`/`driver_id`
-- apuntando a esta ficha, el `delete from identidad.usuarios_perfil where id =
-- p_usuario_id` de acá abajo NO la toca (filtra por id, no por seller_id/
-- driver_id) — así que el `delete` final de la ficha choca con la FK restrict
-- de la OTRA fila y hace rollback completo, incluida la propia cuenta que se
-- quería borrar. Por eso `baja-cuentas.ts` comprueba `entidad_compartida` ANTES
-- de llamar a esta función y, si la ficha es compartida, ni siquiera la llama
-- — borra solo `usuarios_perfil` de la cuenta que se está dando de baja, sin
-- tocar la ficha ajena.
--
-- Idempotente: `create or replace function`, DO-block de aserciones al final.
-- =============================================================================

create or replace function identidad.eliminar_cuenta_persona(
  p_usuario_id uuid,
  p_tipo       text,
  p_tenant_id  uuid,
  p_entidad_id uuid
)
returns void
language plpgsql
security definer
set search_path = identidad, integraciones, pg_temp
as $fn$
begin
  if p_usuario_id is null or p_tenant_id is null or p_entidad_id is null then
    raise exception
      'eliminar_cuenta_persona: p_usuario_id, p_tenant_id y p_entidad_id son obligatorios'
      using errcode = '22023';
  end if;

  if p_tipo = 'seller' then
    -- Comprobación positiva: el perfil, el tenant y el seller deben calzar
    -- ANTES de borrar nada. P0002 (no_data_found) si no — mismo código que el
    -- resto del repo usa para "no existe o no es tuyo" (ver
    -- asignar_pedidos_en_bloque).
    if not exists (
      select 1 from identidad.usuarios_perfil
       where id = p_usuario_id
         and tenant_id = p_tenant_id
         and seller_id = p_entidad_id
    ) then
      raise exception
        'eliminar_cuenta_persona: el usuario % no tiene perfil de seller % en el tenant %',
        p_usuario_id, p_entidad_id, p_tenant_id
        using errcode = 'P0002';
    end if;

    -- Hijos con FK restrict/NO ACTION hacia `sellers` — deben irse ANTES de la
    -- ficha. El orden entre ellos no importa (ninguno depende de otro).
    delete from identidad.seller_bodegas
     where tenant_id = p_tenant_id and seller_id = p_entidad_id;

    delete from identidad.conexiones_seller_ml
     where tenant_id = p_tenant_id and seller_id = p_entidad_id;

    delete from identidad.conexiones_seller_shopify
     where tenant_id = p_tenant_id and seller_id = p_entidad_id;

    -- Cascada automática (FK compuesta `on delete cascade`), pero se enumera
    -- igual: explícito > implícito, y no cuesta nada repetirlo.
    delete from integraciones.whatsapp_contactos
     where tenant_id = p_tenant_id and seller_id = p_entidad_id;

    delete from identidad.seller_fuentes_declaradas
     where tenant_id = p_tenant_id and seller_id = p_entidad_id;

    -- Solo la(s) membresía(s) de ESTE seller en ESTE tenant — nunca las de
    -- otros couriers de la misma identidad (esas no se tocan aquí).
    delete from identidad.seller_membresias
     where tenant_id = p_tenant_id and seller_id = p_entidad_id;

    -- El perfil PRIMERO, la ficha DESPUÉS —
    -- `usuarios_perfil.seller_id → sellers(id) on delete restrict` lo exige.
    delete from identidad.usuarios_perfil
     where id = p_usuario_id;

    delete from identidad.sellers
     where tenant_id = p_tenant_id and id = p_entidad_id;

  elsif p_tipo = 'conductor' then
    if not exists (
      select 1 from identidad.usuarios_perfil
       where id = p_usuario_id
         and tenant_id = p_tenant_id
         and driver_id = p_entidad_id
    ) then
      raise exception
        'eliminar_cuenta_persona: el usuario % no tiene perfil de conductor % en el tenant %',
        p_usuario_id, p_entidad_id, p_tenant_id
        using errcode = 'P0002';
    end if;

    -- Los hijos conocidos de `conductores` (zonas, punto de término,
    -- consentimiento POD, dispositivos) cascadean solos (`on delete cascade`
    -- en sus FK compuestas/simples) — no hace falta enumerarlos.
    delete from identidad.usuarios_perfil
     where id = p_usuario_id;

    delete from identidad.conductores
     where tenant_id = p_tenant_id and id = p_entidad_id;

  else
    raise exception
      'eliminar_cuenta_persona: p_tipo debe ser ''seller'' o ''conductor'', llegó %',
      p_tipo
      using errcode = '22023';
  end if;
end;
$fn$;

comment on function identidad.eliminar_cuenta_persona(uuid, text, uuid, uuid) is
  'Borrado duro TODO-O-NADA de una persona (seller o conductor) + su ficha, para
   el backstage /admin/cuentas. SECURITY DEFINER, ejecutable SOLO por
   service_role. Atómica: cualquier error (incluida una FK restrict no
   enumerada) hace rollback completo — el llamador degrada a desactivación en
   vez de dejar huérfanos. El predicado tieneRelacionConPedidosODinero
   (TypeScript) decide ANTES si tiene sentido intentarlo; esta función no
   repite esa comprobación.';

-- =============================================================================
-- Privilegios — ningún rol de cliente
-- =============================================================================
-- Molde `20260814000001` §2. Es SECURITY DEFINER y borra sin RLS: si
-- `authenticated` pudiera ejecutarla, bastaría pasar el uuid de otro courier
-- para borrarle un seller o un conductor. La llama el servidor con
-- service_role, después de `exigirActorAdmin()` (rol admin_total + AAL2) y de
-- resolver `tieneRelacionConPedidosODinero` y `entidad_compartida`.
revoke all on function identidad.eliminar_cuenta_persona(uuid, text, uuid, uuid)
  from public, anon, authenticated;

grant execute on function identidad.eliminar_cuenta_persona(uuid, text, uuid, uuid)
  to service_role;

-- =============================================================================
-- Aserciones defensivas — la migración ABORTA si algo no quedó en pie
-- =============================================================================
do $$
declare
  v_fn constant text := 'identidad.eliminar_cuenta_persona(uuid,text,uuid,uuid)';
begin
  if to_regprocedure(v_fn) is null then
    raise exception 'No existe la función %. El borrado duro de cuentas quedaría sin RPC.', v_fn;
  end if;

  if not exists (select 1 from pg_proc where oid = to_regprocedure(v_fn)::oid and prosecdef) then
    raise exception
      'La función % no es SECURITY DEFINER. Sin esto la divergencia entre roles pasaría inadvertida.', v_fn;
  end if;

  if has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception
      'authenticated conserva EXECUTE sobre %. Borra sin RLS: bastaría el uuid de otro courier.', v_fn;
  end if;

  if has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'anon conserva EXECUTE sobre %. Borra sin RLS.', v_fn;
  end if;

  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception
      'service_role NO puede ejecutar %. El revoke se pasó de largo y la baja de cuentas quedaría rota.', v_fn;
  end if;
end $$;
