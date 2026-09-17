-- =============================================================================
-- alta_seller_autoservicio — el huérfano se REUSA, nunca se borra
-- =============================================================================
-- La versión de `20260917000003` reclamaba la ficha huérfana BORRÁNDOLA (hijos
-- + `delete from identidad.sellers`) y re-insertando una nueva. En producción
-- eso explotó con **23503** (violación de FK) en el alta de un seller cuyo RUT
-- tenía una ficha huérfana de un intento anterior.
--
-- POR QUÉ BORRAR LA FICHA NUNCA IBA A FUNCIONAR
-- -----------------------------------------------------------------------------
-- `identidad.sellers` es referenciada por ~15 tablas con FK `restrict` o NO
-- ACTION: `identidad.ventanas_corte`, `dinero.config_periodos`,
-- `dinero.periodos_cobro`, `dinero.lineas_cobro`, `dinero.documentos_dte`,
-- `dinero.pagos_recibidos`, `dinero.eventos_conciliacion`, `operacion.pedidos`,
-- `operacion.sesiones_retiro`, `operacion.bultos_retiro`,
-- `operacion.cierres_conductor`, `operacion.evidencias_entrega`,
-- `operacion.pruebas_entrega`, `operacion.incidencias`… Enumerarlas todas es
-- perseguir el mismo 23503 para siempre: basta que aparezca una tabla nueva
-- para que el alta vuelva a romperse. (Ojo: `identidad.tarifas` NO bloqueaba —
-- su FK compuesta es DEFERRABLE y la cascada de la simple la borra antes del
-- chequeo. Verificado contra Postgres, no supuesto.)
--
-- LA FICHA SE REUSA
-- -----------------------------------------------------------------------------
-- Si el `(tenant_id, rut)` ya tiene ficha y NO está reclamada por otra
-- identidad, se REUSA su `id`: se refrescan sus datos con los del wizard y se
-- la deja `activo`. No hay `delete from sellers`, así que ninguna FK puede
-- fallar — y de paso se preserva la configuración que el courier ya le había
-- puesto (tarifas, ventanas de corte, periodicidad de facturación), que el
-- borrado destruía.
--
-- Los hijos que el wizard vuelve a declarar se reemplazan de forma idempotente:
--   · `seller_bodegas`: NO se borran (pueden tener sesiones de retiro colgando,
--     FK restrict). Se desactivan y se les quita `es_principal` — que es lo
--     único que exigen los índices únicos `seller_bodegas_principal_uk`
--     (tenant,seller WHERE es_principal) y `seller_bodegas_nombre_activa_uk`
--     (tenant,seller,nombre WHERE activa) — y se inserta la nueva como
--     principal.
--   · `whatsapp_contactos`: upsert sobre el índice parcial
--     `(seller_id) WHERE origen='perfil_seller'`.
--   · `seller_fuentes_declaradas`: se borran las que ya no declaró y se
--     upsertan las nuevas sobre `(tenant_id, seller_id, fuente)`.
--   · `usuarios_perfil` ya NO se borra en el reclamo: el paso final lo crea o
--     lo reapunta, que es lo mismo y no pelea con el CHECK
--     `usuarios_perfil_seller_id_coherente`.
--
-- Idempotente: `create or replace function` + aserciones al final.
-- =============================================================================

create or replace function identidad.alta_seller_autoservicio(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = identidad, integraciones, pg_temp
as $fn$
declare
  v_auth        uuid := (p_payload->>'auth_user_id')::uuid;
  v_tenant      uuid := (p_payload->>'tenant_id')::uuid;
  v_rut         text := p_payload->>'rut';
  v_razon       text := p_payload->>'razon_social';
  v_nombre_ct   text := p_payload->>'nombre_contacto';
  v_email       text := p_payload->>'email';
  v_tel_ct      text := nullif(p_payload->>'telefono_contacto', '');
  v_consent_en  timestamptz := (p_payload->>'consentimiento_datos_en')::timestamptz;
  v_consent_ver text := p_payload->>'consentimiento_version';
  v_whatsapp    text := p_payload->>'whatsapp_e164';
  v_existing    uuid;
  v_seller_id   uuid;
  v_perfil_tipo identidad.tipo_usuario;
  v_es_primera  boolean;
  v_fuente      text;
begin
  if v_auth is null or v_tenant is null or v_rut is null or v_rut = '' then
    raise exception 'alta_seller_autoservicio: auth_user_id, tenant_id y rut son obligatorios'
      using errcode = '22023';
  end if;

  -- 1) seller_identidades — empresa COMPARTIDA entre couriers (llave auth_user_id).
  insert into identidad.seller_identidades
    (auth_user_id, razon_social, rut, nombre_contacto, telefono,
     consentimiento_datos_en, consentimiento_version)
  values
    (v_auth, v_razon, v_rut, v_nombre_ct, v_tel_ct, v_consent_en, v_consent_ver)
  on conflict (auth_user_id) do update set
    razon_social            = excluded.razon_social,
    rut                     = excluded.rut,
    nombre_contacto         = excluded.nombre_contacto,
    telefono                = excluded.telefono,
    consentimiento_datos_en = excluded.consentimiento_datos_en,
    consentimiento_version  = excluded.consentimiento_version;

  -- 2) ¿Ya hay ficha para este (tenant, rut)? Reusarla o conflicto.
  select id into v_existing
    from identidad.sellers
   where tenant_id = v_tenant and rut = v_rut;

  if v_existing is not null then
    if exists (
      select 1 from identidad.usuarios_perfil
       where seller_id = v_existing and id <> v_auth
    ) or exists (
      select 1 from identidad.seller_membresias
       where seller_id = v_existing and auth_user_id <> v_auth
    ) then
      -- Reclamada por otra persona: es un seller real, no escombro.
      raise exception 'alta_seller_autoservicio: rut ocupado por otra identidad'
        using errcode = '23505';
    end if;

    -- REUSAR (ver cabecera: nunca borrar `sellers`).
    v_seller_id := v_existing;
    update identidad.sellers set
      razon_social    = v_razon,
      nombre_contacto = v_nombre_ct,
      email_contacto  = lower(trim(v_email)),
      estado          = 'activo'
    where id = v_seller_id;

    -- Las bodegas viejas salen de circulación sin borrarse (pueden tener
    -- retiros colgando). Liberan `es_principal` y el nombre-activo para la nueva.
    update identidad.seller_bodegas
       set activa = false, es_principal = false
     where seller_id = v_seller_id;
  else
    -- 3) Ficha nueva. Nace 'activo' (sin aprobación).
    insert into identidad.sellers
      (tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
    values
      (v_tenant, v_razon, v_rut, v_nombre_ct, lower(trim(v_email)), 'activo')
    returning id into v_seller_id;
  end if;

  -- 4) seller_bodegas — geocoding YA resuelto por el llamador (Server Action).
  insert into identidad.seller_bodegas
    (tenant_id, seller_id, nombre, direccion, comuna, instrucciones_acceso,
     contacto_nombre, contacto_telefono, es_principal, activa,
     lat, long, geo_estado, geo_confianza, geocodificado_en)
  values
    (v_tenant, v_seller_id,
     p_payload->'bodega'->>'nombre',
     p_payload->'bodega'->>'direccion',
     p_payload->'bodega'->>'comuna',
     nullif(p_payload->'bodega'->>'instrucciones_acceso', ''),
     nullif(p_payload->'bodega'->>'contacto_nombre', ''),
     nullif(p_payload->'bodega'->>'contacto_telefono', ''),
     true, true,
     (p_payload->'bodega'->>'lat')::double precision,
     (p_payload->'bodega'->>'long')::double precision,
     coalesce(p_payload->'bodega'->>'geo_estado', 'no_resuelto'),
     (p_payload->'bodega'->>'geo_confianza')::numeric,
     (p_payload->'bodega'->>'geocodificado_en')::timestamptz);

  -- 5) whatsapp_contactos — upsert sobre el índice parcial del número propio.
  insert into integraciones.whatsapp_contactos
    (tenant_id, seller_id, telefono_e164, origen, opt_in_estado, opt_in_en)
  values
    (v_tenant, v_seller_id, v_whatsapp, 'perfil_seller', 'otorgado', now())
  on conflict (seller_id) where origen = 'perfil_seller' do update set
    telefono_e164 = excluded.telefono_e164,
    opt_in_estado = 'otorgado',
    opt_in_en     = now();

  -- 6) seller_fuentes_declaradas — fuera las que ya no declaró, upsert del resto.
  delete from identidad.seller_fuentes_declaradas
   where tenant_id = v_tenant
     and seller_id = v_seller_id
     and fuente::text not in (
       select jsonb_array_elements_text(p_payload->'fuentes')
     );

  for v_fuente in select jsonb_array_elements_text(p_payload->'fuentes')
  loop
    insert into identidad.seller_fuentes_declaradas (tenant_id, seller_id, fuente, estado)
    values (
      v_tenant, v_seller_id, v_fuente::identidad.fuente_declarada,
      (case when v_fuente = 'rutax_manual' then 'conectada' else 'pendiente' end)::identidad.estado_fuente_declarada
    )
    on conflict (tenant_id, seller_id, fuente) do update set estado = excluded.estado;
  end loop;

  -- 7) seller_membresias — vínculo identidad<->courier, nace 'activa'.
  insert into identidad.seller_membresias (auth_user_id, tenant_id, seller_id, estado)
  values (v_auth, v_tenant, v_seller_id, 'activa')
  on conflict (auth_user_id, tenant_id) do update set
    seller_id = excluded.seller_id,
    estado    = 'activa';

  -- 8) usuarios_perfil — 1:1. Sin perfil: se CREA (primera membresía). Con
  --    perfil seller: se REAPUNTA a este courier.
  select tipo_usuario into v_perfil_tipo
    from identidad.usuarios_perfil where id = v_auth;

  if v_perfil_tipo is null then
    insert into identidad.usuarios_perfil
      (id, tenant_id, nombre_completo, tipo_usuario, seller_id, rol, estado)
    values
      (v_auth, v_tenant, v_nombre_ct, 'seller', v_seller_id, 'seller', 'activo');
    v_es_primera := true;
  elsif v_perfil_tipo <> 'seller' then
    raise exception 'alta_seller_autoservicio: la cuenta % no puede registrarse como seller', v_auth
      using errcode = 'P0001';
  else
    update identidad.usuarios_perfil
       set tenant_id = v_tenant, seller_id = v_seller_id, estado = 'activo'
     where id = v_auth;
    v_es_primera := false;
  end if;

  return jsonb_build_object('seller_id', v_seller_id, 'es_primera_membresia', v_es_primera);
end;
$fn$;

comment on function identidad.alta_seller_autoservicio(jsonb) is
  'Alta de seller por autoservicio, ATÓMICA (una transacción SQL). Si el
   (tenant,rut) ya tiene ficha y no está reclamada por otra identidad, la REUSA
   (nunca la borra: sellers es referenciada por ~15 tablas con FK restrict y
   borrarla daba 23503; reusarla además preserva tarifas/ventanas/periodicidad).
   Conflicto 23505 si la ficha es de otra identidad. SECURITY DEFINER, solo
   service_role. Validación (antes) y bitácora (después) siguen en TypeScript.';

revoke all on function identidad.alta_seller_autoservicio(jsonb) from public, anon, authenticated;
grant execute on function identidad.alta_seller_autoservicio(jsonb) to service_role;

notify pgrst, 'reload schema';

do $$
declare
  v_fn constant text := 'identidad.alta_seller_autoservicio(jsonb)';
begin
  if to_regprocedure(v_fn) is null then
    raise exception 'No existe la función %.', v_fn;
  end if;
  if not exists (select 1 from pg_proc where oid = to_regprocedure(v_fn)::oid and prosecdef) then
    raise exception 'La función % no es SECURITY DEFINER.', v_fn;
  end if;
  if has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'Un rol de cliente conserva EXECUTE sobre %. Escribe sin RLS.', v_fn;
  end if;
  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'service_role NO puede ejecutar %.', v_fn;
  end if;
end $$;
