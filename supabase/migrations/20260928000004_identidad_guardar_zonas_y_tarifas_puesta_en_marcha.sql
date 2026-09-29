-- =============================================================================
-- Paso 4 de la puesta en marcha: zonas + tarifas en UNA transacción
-- =============================================================================
-- Contexto: docs/ux/puesta-en-marcha-v2.md §3.7 y §14.
--
-- Guardar el paso 4 son cuatro escrituras que tienen que ser una sola: las dos
-- zonas, sus comunas, las tarifas (por zona, excepciones por plataforma y la
-- general) y el avance del paso. El cliente de Supabase no abre transacciones;
-- en viajes sueltos un fallo dejaba zonas sin tarifa, y una zona sin tarifa es
-- justo el hueco que hace cobrar mal en silencio.
--
-- QUÉ ESCRIBE
--   · 2 zonas del tenant (una es_respaldo = true) y el reemplazo COMPLETO de sus
--     comunas. Las comunas pasan por un delete-antes-que-insert para poder
--     mover una comuna de una zona a la otra sin chocar con
--     unique (tenant_id, comuna).
--   · Tarifas (seller NULL, tipo_entrega NULL siempre — el régimen legado ya no
--     se escribe):
--       - una por zona (fuente NULL, modo por_zona),
--       - excepciones por plataforma por zona (fuente = rutax_manual | ml_flex |
--         shopify), solo para las que el tenant ofrece según
--         courier_config_operacion,
--       - UNA general (zona NULL, fuente NULL, modo monto_fijo) con los montos de
--         la zona de respaldo. Es la red de seguridad de resolver_tarifa cuando
--         el tenant no tiene zona de respaldo activa; no es una fila que la
--         persona vea.
--   · puesta_en_marcha_paso = 4.
--
-- REGLA DE RE-GUARDADO (la parte que importa: editar una tarifa cambia plata ya
-- comprometida, y las líneas de dinero apuntan a estas filas por tarifa_id)
--   Una tarifa existente NUNCA se edita en sus montos. Para cada fila que se
--   quiere tener (clave zona + plataforma):
--     · misma clave y mismos montos  → no se toca.
--     · montos distintos, o la fila ya no se quiere → se RETIRA la vigente:
--         a) creada hoy o a futuro (vigente_desde >= hoy) y SIN referencias
--            (ningún pedido la usa como tarifa_aplicable_id, ninguna línea de
--            cobro como tarifa_id): pasa a 'inactiva'. Nadie la usó nunca, es el
--            propio borrador de esta puesta en marcha. Sin DELETE a propósito:
--            sesión y service_role conservan el rastro, y la bitácora ya cita
--            el id.
--         b) vigente_desde >= hoy pero YA referenciada: se cierra con
--            vigente_hasta = vigente_desde (rige hoy tal como se usó) y la nueva
--            empieza al día siguiente. No se reescribe lo ya cobrado.
--         c) vigente_desde < hoy: vigente_hasta = hoy - 1 y la nueva empieza hoy.
--       y, si sigue queriéndose, se inserta la nueva.
--   Así lo cobrado ayer se recalcula con lo de ayer, y el índice
--   tarifas_clave_resolucion_activa_uk nunca ve dos activas iguales.
--   «Ya no se quiere» cubre apagar «Diferenciar por plataforma» o desactivar Flex
--   / Shopify en el paso 3: sus excepciones se retiran, porque una excepción viva
--   le gana a la tarifa de la zona en resolver_tarifa (fuente > zona).
--
-- POR QUÉ service_role Y NO authenticated (desviación consciente)
--   El diseño pedía SECURITY INVOKER que respete RLS, y es INVOKER. Pero decidir
--   «¿alguien usó esta tarifa?» exige leer dinero.lineas_cobro, sobre la que
--   `authenticated` no tiene ni SELECT (verificado). Bajo una sesión de usuario
--   la función fallaría con 42501, o —peor— si se omitiera esa lectura, retiraría
--   como «sin uso» una tarifa que ya generó una línea de cobro. Se sigue el
--   precedente de guardar_zona_con_comunas: la llama la Server Action con
--   service_role tras exigir al dueño y dejar la bitácora; TODO filtro lleva
--   tenant_id explícito porque ahí no hay RLS que respalde.
--
-- NO escribe la bitácora: la escribe la aplicación ANTES de llamar acá
-- (invariante del proyecto: la auditoría queda completa aunque esto falle).
--
-- IDEMPOTENTE: create or replace function.
-- =============================================================================

-- =============================================================================
-- Cierre de las tarifas legadas del tenant (decisión del usuario, 2026-09-29)
-- =============================================================================
-- Cuando el courier guarda tarifas en el modelo nuevo, sus tarifas por régimen
-- (tipo_entrega flex | same_day) se cierran. Si no, resolver_tarifa (seller >
-- fuente > régimen legado > general; zona > sin zona) las prefiere a la tarifa
-- por zona y las zonas que el courier carga no tendrían efecto. NO se cambia la
-- precedencia de resolver_tarifa.
--
-- ALCANCE
--   · Solo filas del TENANT: seller_id IS NULL, tipo_entrega IS NOT NULL,
--     estado = 'activa', vigentes o futuras (vigente_hasta NULL o >= hoy). Las
--     legadas de un seller NO se tocan: el precio negociado con él manda igual.
--   · Solo si, en el momento de cerrar, existe una GENERAL del modelo nuevo
--     activa y vigente hoy (seller, fuente, tipo_entrega y zona NULL). Sin
--     general no se cierra nada: quedarían pedidos sin tarifa.
--   · Misma regla de plata comprometida que el guardado del paso 4:
--       vigente_desde <  hoy               -> vigente_hasta = hoy - 1
--       vigente_desde >= hoy, sin uso      -> estado = 'inactiva'
--       vigente_desde >= hoy, ya referenciada (pedido.tarifa_aplicable_id o
--         lineas_cobro.tarifa_id)          -> vigente_hasta = vigente_desde
--     Para la tercera, la opción conservadora: la legada rige hoy tal como se
--     usó y la general (que ya rige desde hoy) no la reemplaza ese día; no se
--     reescribe lo cobrado. Al día siguiente la legada ya no resuelve.
--   · Idempotente: una fila ya cerrada/inactiva no vuelve a entrar.
--
-- Una sola vía en SQL: la llaman el guardado del paso 4 (al final, misma
-- transacción) y /configuracion/tarifas al crear una tarifa del modelo nuevo.
-- SECURITY INVOKER pero solo service_role (decidir si una tarifa fue usada exige
-- leer dinero.lineas_cobro, vedada a authenticated): por eso tenant_id explícito
-- en TODOS los filtros. NO escribe bitácora: la escribe la app ANTES de llamar.
--
-- Decisión de archivo: se edita 20260928000004 (aún sin desplegar) en vez de
-- crear una 000005, para que la función exista junto a su primer llamador.
-- =============================================================================

-- Ids de las legadas del tenant que un cierre podría tocar (para la bitácora
-- previa). No mira si hay general: eso se decide al cerrar.
create or replace function identidad.tarifas_legadas_del_tenant(
  p_tenant uuid,
  p_hoy    date
) returns setof uuid
language sql
stable
security invoker
set search_path = identidad, pg_temp
as $$
  select t.id
  from identidad.tarifas t
  where t.tenant_id = p_tenant
    and t.seller_id is null
    and t.tipo_entrega is not null
    and t.estado = 'activa'
    and (t.vigente_hasta is null or t.vigente_hasta >= p_hoy)
  order by t.vigente_desde, t.id
$$;

create or replace function identidad.cerrar_tarifas_legadas_del_tenant(
  p_tenant uuid,
  p_hoy    date
) returns jsonb
language plpgsql
security invoker
set search_path = identidad, pg_temp
as $$
declare
  v_r            identidad.tarifas;
  v_referenciada boolean;
  v_cerradas     uuid[] := '{}';
  v_inactivadas  uuid[] := '{}';
begin
  if p_tenant is null or p_hoy is null then
    raise exception 'tenant y fecha son obligatorios' using errcode = '22004';
  end if;

  if not exists (
    select 1 from identidad.tarifas g
    where g.tenant_id = p_tenant
      and g.seller_id is null and g.fuente is null
      and g.tipo_entrega is null and g.zona_id is null
      and g.estado = 'activa'
      and g.vigente_desde <= p_hoy
      and (g.vigente_hasta is null or g.vigente_hasta >= p_hoy)
  ) then
    return jsonb_build_object('hay_general', false, 'cerradas', '[]'::jsonb, 'inactivadas', '[]'::jsonb);
  end if;

  for v_r in
    select * from identidad.tarifas t
    where t.tenant_id = p_tenant
      and t.seller_id is null
      and t.tipo_entrega is not null
      and t.estado = 'activa'
      and (t.vigente_hasta is null or t.vigente_hasta >= p_hoy)
    for update
  loop
    v_referenciada :=
      exists (select 1 from operacion.pedidos p
               where p.tenant_id = p_tenant and p.tarifa_aplicable_id = v_r.id)
      or exists (select 1 from dinero.lineas_cobro l
                  where l.tenant_id = p_tenant and l.tarifa_id = v_r.id);

    if v_r.vigente_desde >= p_hoy and not v_referenciada then
      update identidad.tarifas set estado = 'inactiva'
       where id = v_r.id and tenant_id = p_tenant;
      v_inactivadas := v_inactivadas || v_r.id;
    elsif v_r.vigente_desde >= p_hoy then
      update identidad.tarifas set vigente_hasta = v_r.vigente_desde
       where id = v_r.id and tenant_id = p_tenant;
      v_cerradas := v_cerradas || v_r.id;
    else
      update identidad.tarifas set vigente_hasta = p_hoy - 1
       where id = v_r.id and tenant_id = p_tenant;
      v_cerradas := v_cerradas || v_r.id;
    end if;
  end loop;

  return jsonb_build_object(
    'hay_general', true,
    'cerradas', to_jsonb(v_cerradas),
    'inactivadas', to_jsonb(v_inactivadas)
  );
end;
$$;

comment on function identidad.cerrar_tarifas_legadas_del_tenant(uuid, date) is
  'Cierra las tarifas legadas (tipo_entrega) del tenant, sin seller, solo si
   existe una general del modelo nuevo vigente hoy. Respeta la plata ya
   comprometida (vigente_hasta / inactiva). Solo service_role; la bitácora la
   escribe la app antes. Ver 20260928000004.';
comment on function identidad.tarifas_legadas_del_tenant(uuid, date) is
  'Ids de las legadas del tenant que cerrar_tarifas_legadas_del_tenant podría
   tocar. Para la bitácora previa. Solo service_role.';

revoke all on function identidad.cerrar_tarifas_legadas_del_tenant(uuid, date) from public, anon, authenticated;
grant execute on function identidad.cerrar_tarifas_legadas_del_tenant(uuid, date) to service_role;
revoke all on function identidad.tarifas_legadas_del_tenant(uuid, date) from public, anon, authenticated;
grant execute on function identidad.tarifas_legadas_del_tenant(uuid, date) to service_role;

create or replace function identidad.guardar_zonas_y_tarifas_puesta_en_marcha(
  p_tenant_id uuid,
  p_hoy       date,
  -- [{ id: uuid|null, nombre, es_respaldo, comunas: [text], cobro_clp, pago_clp,
  --    excepciones: [{ fuente, cobro_clp, pago_clp }] }, ...]  — exactamente 2.
  p_zonas     jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = identidad, pg_temp
as $$
declare
  v_ofrece_flex     boolean;
  v_ofrece_shopify  boolean;
  v_z               jsonb;
  v_e               jsonb;
  v_zona_id         uuid;
  v_ids             uuid[] := '{}';
  v_respaldo_cobro  numeric;
  v_respaldo_pago   numeric;
  v_n_respaldo      integer;
  v_pendientes      jsonb := '[]'::jsonb;
  v_d               jsonb;
  v_ex              identidad.tarifas;
  v_r               identidad.tarifas;
  v_tocadas         uuid[] := '{}';
  v_referenciada    boolean;
  v_desde           date;
  v_fuente          operacion.fuente_pedido;
  v_zona_tarifa     uuid;
  v_creadas         integer := 0;
  v_inactivadas     integer := 0;
  v_cerradas        integer := 0;
  v_sin_cambio      integer := 0;
  v_i               integer;
  v_legadas         jsonb;
begin
  if p_tenant_id is null or p_hoy is null then
    raise exception 'tenant y fecha son obligatorios' using errcode = '22004';
  end if;
  if p_zonas is null or jsonb_typeof(p_zonas) <> 'array' or jsonb_array_length(p_zonas) <> 2 then
    raise exception 'Se esperan exactamente dos zonas' using errcode = '22023';
  end if;

  select count(*) into v_n_respaldo
  from jsonb_array_elements(p_zonas) z
  where (z->>'es_respaldo')::boolean is true;
  if v_n_respaldo <> 1 then
    raise exception 'Exactamente una zona debe ser la de respaldo' using errcode = '22023';
  end if;

  -- Montos: enteros CLP positivos y acotados. El conductor en 0 fue el bug que
  -- dejó toda liquidación en $0; se rechaza también acá, no solo en la pantalla.
  if exists (
    select 1
    from (
      select jsonb_path_query(p_zonas, '$[*].cobro_clp') as v
      union all select jsonb_path_query(p_zonas, '$[*].pago_clp')
      union all select jsonb_path_query(p_zonas, '$[*].excepciones[*].cobro_clp')
      union all select jsonb_path_query(p_zonas, '$[*].excepciones[*].pago_clp')
    ) m
    where jsonb_typeof(m.v) <> 'number'
       or (m.v #>> '{}')::numeric <= 0
       or (m.v #>> '{}')::numeric > 10000000
       or (m.v #>> '{}')::numeric <> trunc((m.v #>> '{}')::numeric)
  ) then
    raise exception 'Los montos deben ser enteros CLP mayores a cero' using errcode = '23514';
  end if;

  -- Plataformas ofrecidas: las deriva la función de la base, no las confía al
  -- cliente. Sin fila de configuración el paso 3 no ocurrió.
  select c.ofrece_flex, c.ofrece_shopify
    into v_ofrece_flex, v_ofrece_shopify
  from identidad.courier_config_operacion c
  where c.tenant_id = p_tenant_id;
  if not found then
    raise exception 'El tenant no tiene configuración de operación' using errcode = 'P0002';
  end if;

  -- La marca de respaldo se libera antes de asignarla: a lo más una por tenant.
  update identidad.zonas set es_respaldo = false
   where tenant_id = p_tenant_id and es_respaldo;

  -- ---- 1. Zonas ------------------------------------------------------------
  for v_z in select * from jsonb_array_elements(p_zonas) loop
    if btrim(coalesce(v_z->>'nombre', '')) = '' then
      raise exception 'El nombre de la zona no puede ir vacío' using errcode = '23514';
    end if;
    if v_z->'comunas' is null or jsonb_typeof(v_z->'comunas') <> 'array'
       or jsonb_array_length(v_z->'comunas') = 0 then
      raise exception 'Cada zona necesita al menos una comuna' using errcode = '23514';
    end if;

    if nullif(v_z->>'id', '') is null then
      insert into identidad.zonas (tenant_id, nombre, activa, es_respaldo)
      values (p_tenant_id, btrim(v_z->>'nombre'), true, (v_z->>'es_respaldo')::boolean)
      returning id into v_zona_id;
    else
      -- tenant_id en el WHERE: acá corre service_role, sin RLS que respalde.
      update identidad.zonas
         set nombre = btrim(v_z->>'nombre'),
             activa = true,
             es_respaldo = (v_z->>'es_respaldo')::boolean
       where id = (v_z->>'id')::uuid and tenant_id = p_tenant_id
      returning id into v_zona_id;
      if v_zona_id is null then
        raise exception 'La zona no existe en este courier' using errcode = 'P0002';
      end if;
    end if;
    v_ids := v_ids || v_zona_id;
  end loop;

  -- ---- 2. Comunas: reemplazo completo de las dos zonas ---------------------
  delete from identidad.zona_comunas
   where tenant_id = p_tenant_id and zona_id = any(v_ids);

  for v_i in 1..2 loop
    insert into identidad.zona_comunas (tenant_id, zona_id, comuna)
    select p_tenant_id, v_ids[v_i], c
    from jsonb_array_elements_text(p_zonas->(v_i - 1)->'comunas') as c;
  end loop;

  -- ---- 3. Tarifas deseadas -------------------------------------------------
  for v_i in 1..2 loop
    v_z := p_zonas->(v_i - 1);
    if (v_z->>'es_respaldo')::boolean then
      v_respaldo_cobro := (v_z->>'cobro_clp')::numeric;
      v_respaldo_pago  := (v_z->>'pago_clp')::numeric;
    end if;

    v_pendientes := v_pendientes || jsonb_build_object(
      'zona_id', v_ids[v_i], 'fuente', null,
      'cobro', (v_z->>'cobro_clp')::numeric, 'pago', (v_z->>'pago_clp')::numeric,
      'modo', 'por_zona');

    for v_e in select * from jsonb_array_elements(coalesce(v_z->'excepciones', '[]'::jsonb)) loop
      if not (
        (v_e->>'fuente') = 'rutax_manual'
        or ((v_e->>'fuente') = 'ml_flex' and v_ofrece_flex)
        or ((v_e->>'fuente') = 'shopify' and v_ofrece_shopify)
      ) then
        raise exception 'Plataforma no ofrecida por este courier: %', v_e->>'fuente'
          using errcode = '23514';
      end if;
      v_pendientes := v_pendientes || jsonb_build_object(
        'zona_id', v_ids[v_i], 'fuente', v_e->>'fuente',
        'cobro', (v_e->>'cobro_clp')::numeric, 'pago', (v_e->>'pago_clp')::numeric,
        'modo', 'por_zona');
    end loop;
  end loop;

  -- La general: red de seguridad con los montos de la zona de respaldo.
  v_pendientes := v_pendientes || jsonb_build_object(
    'zona_id', null, 'fuente', null,
    'cobro', v_respaldo_cobro, 'pago', v_respaldo_pago, 'modo', 'monto_fijo');

  -- 3a. Las que ya existen idénticas no se tocan; el resto queda pendiente.
  declare
    v_restantes jsonb := '[]'::jsonb;
  begin
    for v_d in select * from jsonb_array_elements(v_pendientes) loop
      v_zona_tarifa := nullif(v_d->>'zona_id', '')::uuid;
      v_fuente := nullif(v_d->>'fuente', '')::operacion.fuente_pedido;

      select * into v_ex
      from identidad.tarifas t
      where t.tenant_id = p_tenant_id
        and t.seller_id is null
        and t.tipo_entrega is null
        and t.estado = 'activa'
        and t.vigente_hasta is null
        and t.zona_id is not distinct from v_zona_tarifa
        and t.fuente  is not distinct from v_fuente
      order by t.vigente_desde desc
      limit 1;

      if found
         and v_ex.monto_clp = (v_d->>'cobro')::numeric
         and v_ex.monto_conductor_clp = (v_d->>'pago')::numeric then
        v_tocadas := v_tocadas || v_ex.id;
        v_sin_cambio := v_sin_cambio + 1;
      else
        v_restantes := v_restantes || v_d;
      end if;
    end loop;
    v_pendientes := v_restantes;
  end;

  -- ---- 4. Retiro de lo que ya no se quiere o cambió de monto ---------------
  for v_r in
    select * from identidad.tarifas t
    where t.tenant_id = p_tenant_id
      and t.seller_id is null
      and t.tipo_entrega is null
      and t.estado = 'activa'
      and t.vigente_hasta is null
      and (t.zona_id is null or t.zona_id = any(v_ids))
      and t.id <> all(v_tocadas)
    for update
  loop
    v_referenciada :=
      exists (select 1 from operacion.pedidos p
               where p.tenant_id = p_tenant_id and p.tarifa_aplicable_id = v_r.id)
      or exists (select 1 from dinero.lineas_cobro l
                  where l.tenant_id = p_tenant_id and l.tarifa_id = v_r.id);

    if v_r.vigente_desde >= p_hoy and not v_referenciada then
      update identidad.tarifas set estado = 'inactiva' where id = v_r.id;
      v_inactivadas := v_inactivadas + 1;
    elsif v_r.vigente_desde >= p_hoy then
      update identidad.tarifas set vigente_hasta = v_r.vigente_desde where id = v_r.id;
      v_cerradas := v_cerradas + 1;
    else
      update identidad.tarifas set vigente_hasta = p_hoy - 1 where id = v_r.id;
      v_cerradas := v_cerradas + 1;
    end if;
  end loop;

  -- ---- 5. Altas ------------------------------------------------------------
  for v_d in select * from jsonb_array_elements(v_pendientes) loop
    v_zona_tarifa := nullif(v_d->>'zona_id', '')::uuid;
    v_fuente := nullif(v_d->>'fuente', '')::operacion.fuente_pedido;

    -- Si la anterior de esta clave se cerró por estar ya usada y rige hasta hoy
    -- o más, la nueva empieza el día siguiente (caso b de la cabecera).
    select coalesce(max(t.vigente_hasta) + 1, p_hoy) into v_desde
    from identidad.tarifas t
    where t.tenant_id = p_tenant_id
      and t.seller_id is null
      and t.tipo_entrega is null
      and t.estado = 'activa'
      and t.vigente_hasta >= p_hoy
      and t.zona_id is not distinct from v_zona_tarifa
      and t.fuente  is not distinct from v_fuente;
    v_desde := greatest(v_desde, p_hoy);

    insert into identidad.tarifas (
      tenant_id, seller_id, tipo_entrega, fuente, zona_id, modo_calculo,
      monto_clp, monto_conductor_clp, vigente_desde, estado
    ) values (
      p_tenant_id, null, null, v_fuente, v_zona_tarifa,
      (v_d->>'modo')::identidad.modo_calculo_tarifa,
      (v_d->>'cobro')::integer, (v_d->>'pago')::numeric, v_desde, 'activa'
    );
    v_creadas := v_creadas + 1;
  end loop;

  -- ---- 5b. Las tarifas legadas del tenant dejan de ganarle a la zona ------
  -- (solo si ya hay general; ver cerrar_tarifas_legadas_del_tenant)
  v_legadas := identidad.cerrar_tarifas_legadas_del_tenant(p_tenant_id, p_hoy);

  -- ---- 6. Avance del paso (nunca retrocede; el tope es 4) ------------------
  update identidad.courier_config_operacion
     set puesta_en_marcha_paso = 4
   where tenant_id = p_tenant_id
     and coalesce(puesta_en_marcha_paso, 0) < 4;

  return jsonb_build_object(
    'zonas', to_jsonb(v_ids),
    'tarifas_creadas', v_creadas,
    'tarifas_inactivadas', v_inactivadas,
    'tarifas_cerradas', v_cerradas,
    'tarifas_sin_cambio', v_sin_cambio,
    'legadas_cerradas', v_legadas
  );
end;
$$;

comment on function identidad.guardar_zonas_y_tarifas_puesta_en_marcha(uuid, date, jsonb) is
  'Paso 4 de la puesta en marcha: dos zonas, sus comunas, las tarifas (zona,
   excepciones por plataforma y general) y el avance del paso, en una
   transacción. Nunca edita montos de una tarifa existente: la retira (inactiva
   si nadie la usó y es de hoy; cierra vigente_hasta si ya rigió o se usó) y crea
   la nueva. SECURITY INVOKER pero solo service_role: decidir si una tarifa fue
   usada exige leer dinero.lineas_cobro, vedada a authenticated. La bitácora la
   escribe la aplicación antes de llamar. Ver 20260928000004.';

revoke all on function identidad.guardar_zonas_y_tarifas_puesta_en_marcha(uuid, date, jsonb) from public;
revoke all on function identidad.guardar_zonas_y_tarifas_puesta_en_marcha(uuid, date, jsonb) from anon;
revoke all on function identidad.guardar_zonas_y_tarifas_puesta_en_marcha(uuid, date, jsonb) from authenticated;
grant execute on function identidad.guardar_zonas_y_tarifas_puesta_en_marcha(uuid, date, jsonb) to service_role;
