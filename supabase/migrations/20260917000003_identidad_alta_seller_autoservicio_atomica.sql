-- =============================================================================
-- identidad.alta_seller_autoservicio — alta de seller por autoservicio, ATÓMICA
-- =============================================================================
-- Reemplaza la secuencia de `.insert()` sueltos de PostgREST de
-- `commitAltaSellerAutoservicio` (TypeScript) por UNA transacción SQL.
--
-- POR QUÉ
-- -----------------------------------------------------------------------------
-- El commit del alta escribía en 7 tablas con llamadas PostgREST independientes
-- —cada una su propia transacción— y una compensación best-effort
-- (`deshacerAltaSeller`) que, si fallaba, dejaba una fila `sellers` HUÉRFANA:
-- con su `(tenant_id, rut)` ya ocupado pero sin perfil ni membresía. Esa fila es
-- INVISIBLE en el backstage `/admin/cuentas` (que lista `usuarios_perfil`/
-- `auth.users`, no `sellers` sueltas), así que no se podía borrar desde la UI, y
-- el re-intento del alta chocaba para siempre con el unique `sellers_tenant_rut_uk`
-- («Esa empresa ya tiene una cuenta con este courier»). Con el geocoding de
-- Google intermitente, la probabilidad de un commit a medias subía.
--
-- Esta función hace TODO el alta en una transacción: si cualquier paso lanza,
-- Postgres hace ROLLBACK completo — nunca queda un huérfano. Además RECLAMA un
-- huérfano preexistente (ver abajo), para que un re-intento se auto-cure sin
-- cirugía manual en la base.
--
-- RECLAMO DE HUÉRFANO vs. CONFLICTO LEGÍTIMO
-- -----------------------------------------------------------------------------
-- Si ya existe una fila `sellers` con este `(tenant_id, rut)`:
--   · Si está RECLAMADA por OTRA identidad (hay un `usuarios_perfil` con
--     `id <> auth` o una `seller_membresias` con `auth_user_id <> auth`
--     apuntándola) → es un seller real de otra persona → se lanza conflicto
--     (23505), igual que antes.
--   · Si NO (es escombro sin dueño, o solo de ESTA misma persona por un intento
--     fallido anterior) → se BORRA el escombro (hijos + la fila) y se sigue con
--     el alta fresca. Todo dentro de la misma transacción.
--
-- Validación y bitácora siguen en TypeScript: `validarEntrada` corre ANTES (esta
-- función recibe datos ya validados) y la bitácora se escribe DESPUÉS con el
-- `es_primera_membresia` que esta función devuelve.
--
-- Idempotente: `create or replace function` + DO-block de aserciones al final.
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

  -- 2) ¿Choque de RUT en este courier? Distinguir huérfano (reclamar) de
  --    seller legítimo de otra identidad (conflicto).
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

    -- Escombro (sin dueño, o solo de esta misma persona): reclamarlo.
    -- El orden respeta las FK restrict: hijos antes que la ficha. La referencia
    -- del perfil de esta persona (usuarios_perfil.seller_id -> sellers es
    -- restrict) se SUELTA borrando el perfil, no poniéndolo en null: un perfil
    -- tipo 'seller' con seller_id null viola el CHECK
    -- `usuarios_perfil_seller_id_coherente`. Solo puede ser el perfil de v_auth
    -- (un perfil de OTRA identidad apuntando aquí ya habría lanzado conflicto
    -- arriba); si existe, el paso 8 lo re-crea apuntando al seller nuevo.
    delete from identidad.seller_bodegas          where seller_id = v_existing;
    delete from identidad.conexiones_seller_ml     where seller_id = v_existing;
    delete from identidad.conexiones_seller_shopify where seller_id = v_existing;
    delete from integraciones.whatsapp_contactos   where seller_id = v_existing;
    delete from identidad.seller_fuentes_declaradas where seller_id = v_existing;
    delete from identidad.seller_membresias         where seller_id = v_existing;
    delete from identidad.usuarios_perfil where seller_id = v_existing and id = v_auth;
    delete from identidad.sellers where id = v_existing;
  end if;

  -- 3) identidad.sellers — la fila de ESTE courier. Nace 'activo' (sin aprobación).
  insert into identidad.sellers
    (tenant_id, razon_social, rut, nombre_contacto, email_contacto, estado)
  values
    (v_tenant, v_razon, v_rut, v_nombre_ct, lower(trim(v_email)), 'activo')
  returning id into v_seller_id;

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

  -- 5) whatsapp_contactos — origen 'perfil_seller', opt-in otorgado.
  insert into integraciones.whatsapp_contactos
    (tenant_id, seller_id, telefono_e164, origen, opt_in_estado, opt_in_en)
  values
    (v_tenant, v_seller_id, v_whatsapp, 'perfil_seller', 'otorgado', now());

  -- 6) seller_fuentes_declaradas — rutax_manual nace 'conectada'; resto 'pendiente'.
  for v_fuente in select jsonb_array_elements_text(p_payload->'fuentes')
  loop
    insert into identidad.seller_fuentes_declaradas (tenant_id, seller_id, fuente, estado)
    values (
      v_tenant, v_seller_id, v_fuente::identidad.fuente_declarada,
      (case when v_fuente = 'rutax_manual' then 'conectada' else 'pendiente' end)::identidad.estado_fuente_declarada
    );
  end loop;

  -- 7) seller_membresias — vínculo identidad<->courier, nace 'activa'. Upsert por
  --    (auth_user_id, tenant_id): si esta persona ya tenía una membresía en este
  --    tenant (intento previo), se reapunta al seller nuevo en vez de chocar.
  insert into identidad.seller_membresias (auth_user_id, tenant_id, seller_id, estado)
  values (v_auth, v_tenant, v_seller_id, 'activa')
  on conflict (auth_user_id, tenant_id) do update set
    seller_id = excluded.seller_id,
    estado    = 'activa';

  -- 8) usuarios_perfil — 1:1. Sin perfil: se CREA (primera membresía). Con perfil
  --    seller (ya era seller de otro courier): se REAPUNTA a este courier.
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
       set tenant_id = v_tenant, seller_id = v_seller_id
     where id = v_auth;
    v_es_primera := false;
  end if;

  return jsonb_build_object('seller_id', v_seller_id, 'es_primera_membresia', v_es_primera);
end;
$fn$;

comment on function identidad.alta_seller_autoservicio(jsonb) is
  'Alta de seller por autoservicio, ATÓMICA (una transacción SQL). Reemplaza la
   secuencia de inserts PostgREST de commitAltaSellerAutoservicio: si algo falla,
   rollback completo — cero huérfanos. Reclama un sellers huérfano preexistente
   del mismo (tenant,rut) si no tiene dueño; conflicto 23505 si es de otra
   identidad. SECURITY DEFINER, solo service_role. Validación (antes) y bitácora
   (después) siguen en TypeScript.';

-- =============================================================================
-- Privilegios — ningún rol de cliente (molde 20260917000001 §2)
-- =============================================================================
revoke all on function identidad.alta_seller_autoservicio(jsonb) from public, anon, authenticated;
grant execute on function identidad.alta_seller_autoservicio(jsonb) to service_role;

-- PostgREST debe publicar la función en su caché de esquema al toque: si no, el
-- primer `.rpc()` da PGRST202 y el llamador lo trata como fallo (misma trampa que
-- la RPC de borrado, 20260917000002).
notify pgrst, 'reload schema';

-- =============================================================================
-- Aserciones defensivas — la migración ABORTA si algo no quedó en pie
-- =============================================================================
do $$
declare
  v_fn constant text := 'identidad.alta_seller_autoservicio(jsonb)';
begin
  if to_regprocedure(v_fn) is null then
    raise exception 'No existe la función %. El alta de seller quedaría sin RPC.', v_fn;
  end if;
  if not exists (select 1 from pg_proc where oid = to_regprocedure(v_fn)::oid and prosecdef) then
    raise exception 'La función % no es SECURITY DEFINER.', v_fn;
  end if;
  if has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'authenticated conserva EXECUTE sobre %. Escribe sin RLS.', v_fn;
  end if;
  if has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'anon conserva EXECUTE sobre %.', v_fn;
  end if;
  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'service_role NO puede ejecutar %.', v_fn;
  end if;
end $$;
