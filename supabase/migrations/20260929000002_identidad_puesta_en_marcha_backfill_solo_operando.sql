-- =============================================================================
-- Puesta en marcha v2: el backfill marca solo a los couriers que ya operan
-- =============================================================================
--
-- QUÉ PASÓ
-- `20260928000003` marcó como COMPLETADA la puesta en marcha de todo tenant
-- creado antes del despliegue, para no bloquear a Novalink. El criterio era
-- «existía», y tenía que ser «ya estaba operando». En producción alcanzó a
-- cuatro couriers vacíos —Raptor, Raptor Flex, Courier Rutax y Despachos SpA,
-- sin bodega, sin tarifas, sin sellers, sin conductores y sin pedidos—, que
-- desde entonces entraban directo a un producto sin configurar y nunca veían la
-- puesta en marcha. Lo detectó el usuario el 2026-09-29 al volver a entrar con
-- un courier que había registrado el día anterior.
--
-- QUÉ HACE
-- 1. Redefine el backfill: solo marca a un tenant que ya opera, es decir, que
--    tiene una bodega propia activa, una tarifa activa o algún pedido.
-- 2. Deshace la marca mal puesta: borra la fila de configuración de los tenants
--    marcados por el backfill (sin autor) que no operan. Se BORRA la fila, no
--    solo la marca, porque un tenant nuevo nace sin fila a propósito: la fila
--    trae 16:00–21:00 por defecto y el paso 3 se daría por hecho sin que nadie
--    lo viera. Así esos couriers quedan exactamente como uno recién registrado,
--    y el bloqueo los manda al primer paso que les falte.
--
-- No toca una fila completada POR ALGUIEN (con autor): esa puesta en marcha la
-- terminó una persona. Ni a un tenant que opera (Novalink).
--
-- Corre como postgres: el trigger que impide deshacer la marca solo actúa sobre
-- sesiones `authenticated`. Idempotente: una segunda corrida no encuentra filas.
-- =============================================================================

create or replace function identidad.courier_config_operacion_marcar_existentes(
  p_creados_hasta timestamptz
)
returns integer
language sql
as $$
  with insertadas as (
    insert into identidad.courier_config_operacion (
      tenant_id, ofrece_flex, ofrece_shopify,
      puesta_en_marcha_completada_en, puesta_en_marcha_completada_por
    )
    select
      t.id,
      exists (select 1 from identidad.conexiones_seller_ml c where c.tenant_id = t.id)
        or exists (select 1 from operacion.pedidos p
                   where p.tenant_id = t.id and p.fuente = 'ml_flex'),
      exists (select 1 from identidad.conexiones_seller_shopify c where c.tenant_id = t.id)
        or exists (select 1 from operacion.pedidos p
                   where p.tenant_id = t.id and p.fuente = 'shopify'),
      now(),
      null
    from identidad.tenants t
    where t.creado_en <= p_creados_hasta
      -- Ya opera: si no, que haga la puesta en marcha como cualquier courier nuevo.
      and (
        exists (select 1 from identidad.courier_bodegas b
                 where b.tenant_id = t.id and b.activa)
        or exists (select 1 from identidad.tarifas ta
                    where ta.tenant_id = t.id and ta.estado = 'activa')
        or exists (select 1 from operacion.pedidos p where p.tenant_id = t.id)
      )
    on conflict (tenant_id) do nothing
    returning 1
  )
  select count(*)::integer from insertadas;
$$;

comment on function identidad.courier_config_operacion_marcar_existentes(timestamptz) is
  'Backfill de la puesta en marcha v2: marca COMPLETADA la puesta en marcha de
   los tenants creados hasta p_creados_hasta que YA OPERAN (bodega propia activa,
   tarifa activa o algún pedido) y no tengan fila. Un tenant vacío queda sin
   fila y hace la puesta en marcha. No pisa filas existentes. Solo postgres
   (migraciones, seed): NO llamar desde la app.';

-- `create or replace` no resetea la ACL, pero se repite el revoke por si acaso:
-- es una función que salta el asistente.
revoke all on function identidad.courier_config_operacion_marcar_existentes(timestamptz)
  from public, anon, authenticated, service_role;

-- Deshace la marca que el backfill de 20260928000003 puso a couriers vacíos.
delete from identidad.courier_config_operacion c
 where c.puesta_en_marcha_completada_por is null
   and not exists (select 1 from identidad.courier_bodegas b
                    where b.tenant_id = c.tenant_id and b.activa)
   and not exists (select 1 from identidad.tarifas ta
                    where ta.tenant_id = c.tenant_id and ta.estado = 'activa')
   and not exists (select 1 from operacion.pedidos p where p.tenant_id = c.tenant_id);
