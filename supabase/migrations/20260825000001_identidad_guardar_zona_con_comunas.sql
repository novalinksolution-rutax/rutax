-- =============================================================================
-- Guardar una zona y sus comunas en UNA transacción
-- =============================================================================
--
-- 🔴 QUÉ ESTABA ROTO, Y ERAN DOS COSAS
-- -----------------------------------------------------------------------------
-- Guardar una zona son tres escrituras: crear (o renombrar) la zona, borrar sus
-- comunas actuales, e insertar las nuevas. El cliente de Supabase no abre
-- transacciones, así que iban en tres viajes sueltos y cualquiera podía fallar
-- dejando el estado a medias:
--
--   1. **Crear + asignar.** Si la asignación fallaba, la zona quedaba creada y
--      vacía. Al reintentar se creaba una segunda zona con el mismo nombre.
--
--   2. **Reasignar.** Peor y más viejo: el `delete` de las comunas actuales
--      corría antes del `insert`. Si el insert fallaba —bastaba que una comuna
--      ya fuera de otra zona, que es el `unique (tenant_id, comuna)`— la zona
--      **se quedaba sin ninguna comuna**. Y eso no falla ruidosamente en
--      ninguna parte: las comunas huérfanas caen en la tarifa por defecto del
--      courier y se cobran igual, en silencio, hasta el cierre del período.
--      El comentario del módulo decía «operación atómica» y no lo era.
--
-- Esta función hace las tres cosas en un solo cuerpo, o sea en una sola
-- transacción: si algo falla, no queda nada a medias.
--
-- ⚠️ **NO escribe la bitácora.** Eso sigue en la aplicación y ANTES de llamar
-- acá, que es el invariante del proyecto: la auditoría queda completa aunque el
-- paso siguiente falle. La contrapartida asumida es la de siempre — puede haber
-- una línea de bitácora de un guardado que no ocurrió, y eso es preferible a un
-- guardado sin línea.
--
-- ⚠️ `security invoker` (el default), no `definer`: la llama `service_role`, que
-- ya pasa por encima de RLS. Una función `definer` acá sería privilegio que
-- nadie necesita.
--
-- IDEMPOTENTE: `create or replace function`.
-- =============================================================================

create or replace function identidad.guardar_zona_con_comunas(
  p_tenant_id uuid,
  -- `null` = crear una zona nueva.
  p_zona_id   uuid,
  p_nombre    text,
  p_comunas   text[]
)
returns identidad.zonas
language plpgsql
set search_path = identidad, pg_temp
as $$
declare
  v_zona identidad.zonas;
begin
  if p_nombre is null or btrim(p_nombre) = '' then
    raise exception 'El nombre de la zona no puede ir vacío'
      using errcode = '23514';
  end if;

  if p_zona_id is null then
    insert into identidad.zonas (tenant_id, nombre, activa)
    values (p_tenant_id, btrim(p_nombre), true)
    returning * into v_zona;
  else
    -- El `tenant_id` va en el WHERE y no se confía del `p_zona_id` solo: es el
    -- aislamiento multi-tenant, y acá corre `service_role` sin RLS que lo
    -- respalde.
    update identidad.zonas
       set nombre = btrim(p_nombre),
           actualizado_en = now()
     where id = p_zona_id
       and tenant_id = p_tenant_id
    returning * into v_zona;

    if v_zona.id is null then
      raise exception 'La zona no existe en este courier'
        using errcode = 'P0002';
    end if;
  end if;

  -- Reemplazo completo de las comunas de ESTA zona. El `delete` y el `insert`
  -- comparten transacción con todo lo de arriba: si el insert choca con el
  -- `unique (tenant_id, comuna)` porque una comuna ya es de otra zona, se
  -- deshace también el borrado — y la zona conserva las que tenía.
  delete from identidad.zona_comunas
   where tenant_id = p_tenant_id
     and zona_id = v_zona.id;

  if p_comunas is not null and array_length(p_comunas, 1) > 0 then
    insert into identidad.zona_comunas (tenant_id, zona_id, comuna)
    select p_tenant_id, v_zona.id, c
      from unnest(p_comunas) as c;
  end if;

  return v_zona;
end;
$$;

comment on function identidad.guardar_zona_con_comunas(uuid, uuid, text, text[]) is
  'Crea o renombra una zona y reemplaza sus comunas, todo en una transacción. '
  'Sin esto, un fallo al insertar comunas dejaba la zona VACÍA y sus comunas '
  'caían en la tarifa por defecto del courier en silencio. La bitácora la '
  'escribe la aplicación antes de llamar acá (invariante del proyecto).';

-- Solo `service_role`: la llaman las Server Actions, nunca el navegador.
revoke all on function identidad.guardar_zona_con_comunas(uuid, uuid, text, text[]) from public;
revoke all on function identidad.guardar_zona_con_comunas(uuid, uuid, text, text[]) from authenticated;
revoke all on function identidad.guardar_zona_con_comunas(uuid, uuid, text, text[]) from anon;
grant execute on function identidad.guardar_zona_con_comunas(uuid, uuid, text, text[]) to service_role;
