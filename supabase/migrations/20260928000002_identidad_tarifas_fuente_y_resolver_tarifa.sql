-- =============================================================================
-- Tarifas por fuente + zona de respaldo + resolución única de tarifa
-- =============================================================================
-- Contexto: docs/ux/puesta-en-marcha-v2.md §0 (H4, H5, H12) y §14.
--
-- H4: la tarifa por zona se guardaba pero NUNCA se usaba para cobrar.
--     `resolverTarifaVigente` (src/modules/operacion/tarifas.ts) filtra por
--     tenant, tipo_entrega, vigencia y seller, y no mira zona_id: con dos
--     tarifas same_day (Zona 1 y Zona 2) ganaba la más reciente para TODAS las
--     comunas. El "cobras $X por zona" era una promesa que el motor no cumplía.
-- H12: la ingesta ML no escribe tarifa_aplicable_id; la misma función la
--     resuelve para Flex.
-- §14 Q6 (decisión del usuario): una comuna sin zona se cobra como Periferia y
--     se avisa. Nunca una entrega sin cobrar.
--
-- Qué hace (todo idempotente, re-aplicable):
--   1. identidad.tarifas.fuente (operacion.fuente_pedido, NULL = toda fuente).
--      Reusa el enum: NO hay CHECK de lista que reponer (ver CLAUDE.md, trampa
--      del CHECK repuesto).
--   2. tipo_entrega pasa a NULLABLE. Queda SOLO para filas legadas; toda fila
--      nueva lo deja NULL y usa `fuente` (o nada = general).
--   3. CHECK: una fila es por fuente O por régimen legado, nunca ambas.
--   4. Aserción defensiva + índice único parcial NULLS NOT DISTINCT sobre la
--      clave de resolución (tenant, seller, fuente, régimen, zona, vigencia)
--      de las tarifas activas. Sin él, dos filas "igual de específicas" con la
--      misma vigencia hacen que el cobro dependa del orden físico del heap.
--   5. identidad.zonas.es_respaldo (a lo más UNA por tenant, activa): la zona
--      a la que cae una comuna sin mapear. Sin hardcodear "Periferia".
--   6. identidad.resolver_tarifa(...)            — por zona_id.
--      identidad.resolver_tarifa_por_comuna(...) — por comuna, con respaldo.
--      Ambas SECURITY INVOKER: respetan la RLS de tarifas/zonas.
--   7. Reemisión de public.tarifas y public.zonas con security_invoker
--      EXPLÍCITO (create or replace view reemplaza las opciones: si se omite
--      el WITH, la vista queda como definer y salta la RLS).
--
-- NO toca: resolverTarifaVigente ni ningún llamador TypeScript (eso es de
-- `backend`), las políticas RLS de tarifas/zonas (siguen P1 solo-interno, sin
-- P2: el seller NO ve montos pactados), ni la FK/columna `zona text` legada.
-- =============================================================================

-- =============================================================================
-- 1. Columna fuente
-- =============================================================================
alter table identidad.tarifas
  add column if not exists fuente operacion.fuente_pedido;

comment on column identidad.tarifas.fuente is
  'Plataforma a la que aplica la tarifa (operacion.fuente_pedido). NULL = todas
   las plataformas (tarifa general). Es el eje NUEVO: toda fila nueva deja
   tipo_entrega en NULL. Excluyente con tipo_entrega (CHECK
   tarifas_fuente_o_regimen_no_ambos). Precedencia en identidad.resolver_tarifa:
   fuente > régimen legado > general.';

-- =============================================================================
-- 2. tipo_entrega nullable (solo filas legadas)
-- =============================================================================
alter table identidad.tarifas
  alter column tipo_entrega drop not null;

comment on column identidad.tarifas.tipo_entrega is
  'LEGADO. Régimen (flex | same_day) de las tarifas creadas antes de 2026-09-28.
   Toda fila nueva lo deja NULL y usa `fuente` (o nada, = general). Se conserva
   porque las líneas de dinero históricas apuntan a estas filas por tarifa_id.
   Excluyente con `fuente`.';

-- =============================================================================
-- 3. CHECK: fuente o régimen, nunca ambos
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tarifas_fuente_o_regimen_no_ambos'
      and conrelid = 'identidad.tarifas'::regclass
  ) then
    alter table identidad.tarifas
      add constraint tarifas_fuente_o_regimen_no_ambos
      check (fuente is null or tipo_entrega is null);
  end if;
end $$;

-- =============================================================================
-- 4. Unicidad de la clave de resolución (tarifas activas)
-- =============================================================================
-- 4a. Aserción defensiva: si ya hay duplicados, el índice fallaría con un
--     23505 opaco. Abortamos antes con un mensaje que dice QUÉ hay que limpiar.
--     El GROUP BY trata los NULL como iguales, que es exactamente la semántica
--     de NULLS NOT DISTINCT del índice.
do $$
declare
  v_detalle text;
  v_grupos  integer;
begin
  select count(*),
         string_agg(
           format('tenant=%s seller=%s fuente=%s tipo_entrega=%s zona_id=%s vigente_desde=%s filas=%s ids=%s',
                  tenant_id, coalesce(seller_id::text, 'NULL'),
                  coalesce(fuente::text, 'NULL'), coalesce(tipo_entrega::text, 'NULL'),
                  coalesce(zona_id::text, 'NULL'), vigente_desde, n, ids),
           E'\n')
    into v_grupos, v_detalle
  from (
    select tenant_id, seller_id, fuente, tipo_entrega, zona_id, vigente_desde,
           count(*) as n,
           string_agg(id::text, ',' order by id) as ids
    from identidad.tarifas
    where estado = 'activa'
    group by tenant_id, seller_id, fuente, tipo_entrega, zona_id, vigente_desde
    having count(*) > 1
  ) dup;

  if v_grupos > 0 then
    raise exception using
      message = format(
        '20260928000002: hay %s grupo(s) de tarifas ACTIVAS duplicadas en la clave '
        '(tenant, seller, fuente, tipo_entrega, zona_id, vigente_desde). Resuelve '
        'a mano (pasar a inactiva las sobrantes) antes de migrar:%s%s',
        v_grupos, E'\n', v_detalle),
      errcode = '23505';
  end if;
end $$;

-- 4b. El índice. NULLS NOT DISTINCT (PG15+): seller NULL, fuente NULL, zona
--     NULL cuentan como iguales, que es justo el caso a impedir (dos generales
--     del tenant con la misma vigencia).
create unique index if not exists tarifas_clave_resolucion_activa_uk
  on identidad.tarifas (tenant_id, seller_id, fuente, tipo_entrega, zona_id, vigente_desde)
  nulls not distinct
  where estado = 'activa';

comment on index identidad.tarifas_clave_resolucion_activa_uk is
  'Dos tarifas activas igual de específicas y con la misma vigencia harían que
   el cobro dependiera del orden físico de las filas. Ver 20260928000002.';

-- Índice de apoyo a la resolución (el de vigencia existente está encabezado
-- por tipo_entrega, que en filas nuevas es NULL).
create index if not exists tarifas_resolucion_idx
  on identidad.tarifas (tenant_id, vigente_desde)
  where estado = 'activa';

-- =============================================================================
-- 5. Zona de respaldo (Q6: comuna sin zona → Periferia, y se avisa)
-- =============================================================================
-- Se modela como una MARCA en la zona, no como un nombre: el courier puede
-- renombrar "Periferia" y la regla sigue funcionando. A lo más una por tenant
-- (índice único parcial) y siempre activa (CHECK): una zona de respaldo
-- inactiva dejaría sin cobrar justo lo que la regla existe para cobrar. Para
-- desactivarla hay que mover antes la marca.
alter table identidad.zonas
  add column if not exists es_respaldo boolean not null default false;

comment on column identidad.zonas.es_respaldo is
  'Zona a la que se cobra una comuna SIN mapear (decisión del usuario
   2026-09-28, Q6: "se cobra como Periferia y se avisa"). A lo más una por
   tenant; siempre activa. La usa identidad.resolver_tarifa_por_comuna, que
   además devuelve zona_por_respaldo = true para que el backend avise.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'zonas_respaldo_activa'
      and conrelid = 'identidad.zonas'::regclass
  ) then
    alter table identidad.zonas
      add constraint zonas_respaldo_activa
      check (not es_respaldo or activa);
  end if;
end $$;

create unique index if not exists zonas_una_respaldo_por_tenant_uk
  on identidad.zonas (tenant_id)
  where es_respaldo;

-- =============================================================================
-- 6. Vistas espejo — security_invoker EXPLÍCITO
-- =============================================================================
-- create or replace view conserva los GRANT pero REEMPLAZA las opciones: sin el
-- WITH la vista quedaría con privilegios del owner y saltaría la RLS. Las
-- columnas nuevas quedan al final (select * sobre la tabla), así que el
-- replace es válido.
create or replace view public.tarifas
  with (security_invoker = true)
  as select * from identidad.tarifas;

create or replace view public.zonas
  with (security_invoker = true)
  as select * from identidad.zonas;

-- Idempotencia de grants (ya existían; se repiten sin efecto).
grant select, insert, update on public.tarifas to authenticated;
grant select, insert, update on public.zonas   to authenticated;

-- =============================================================================
-- 7. identidad.resolver_tarifa — la ÚNICA resolución de tarifa
-- =============================================================================
-- Candidatas: tenant, activa, vigente en p_fecha, y en cada eje la fila
-- coincide o es comodín (NULL):
--   seller_id    = p_seller      o NULL
--   fuente       = p_fuente      o NULL
--   tipo_entrega = p_tipo_pedido o NULL
--   zona_id      = p_zona_id     o NULL   (p_zona_id NULL → solo zona_id NULL,
--                                          porque NULL = NULL no es verdadero)
-- Precedencia LEXICOGRÁFICA (el ORDER BY, no el texto):
--   1. seller > tenant
--   2. fuente > régimen legado > general  (el CHECK garantiza que una fila es
--      exactamente una de las tres)
--   3. zona > sin zona
--   4. vigente_desde más reciente
--   5. id (desempate determinista; con el índice único no debería hacer falta)
-- Sin candidata → cero filas (el llamador lo lee como NULL).
--
-- SECURITY INVOKER a propósito: la RLS de tarifas es P1 solo-interno. Un
-- interno del tenant A que pase p_tenant = B no ve ninguna fila de B y recibe
-- NULL; un seller o conductor no ve ninguna tarifa (no ve montos pactados).
-- Los jobs corren como service_role (BYPASSRLS) y ahí p_tenant es el único
-- filtro, igual que en resolverTarifaVigente hoy. Contraste deliberado con
-- identidad.resolver_zona (SECURITY DEFINER), que devuelve el id de zona de
-- cualquier tenant a cualquier autenticado: aquí eso no se repite.
--
-- p_tipo_pedido es text (no el enum) para que PostgREST lo reciba tal cual
-- desde TypeScript; se compara contra tipo_entrega::text.
create or replace function identidad.resolver_tarifa(
  p_tenant      uuid,
  p_seller      uuid,
  p_fuente      operacion.fuente_pedido,
  p_tipo_pedido text,
  p_zona_id     uuid,
  p_fecha       date
) returns table (
  tarifa_id   uuid,
  por_seller  boolean,
  por_fuente  boolean,
  por_regimen boolean,
  por_zona    boolean
)
language sql
stable
security invoker
set search_path = identidad, pg_temp
as $$
  select t.id,
         t.seller_id    is not null,
         t.fuente       is not null,
         t.tipo_entrega is not null,
         t.zona_id      is not null
  from identidad.tarifas t
  where t.tenant_id = p_tenant
    and t.estado = 'activa'
    and t.vigente_desde <= p_fecha
    and (t.vigente_hasta is null or t.vigente_hasta >= p_fecha)
    and (t.seller_id    is null or t.seller_id    = p_seller)
    and (t.fuente       is null or t.fuente       = p_fuente)
    and (t.tipo_entrega is null or t.tipo_entrega::text = p_tipo_pedido)
    and (t.zona_id      is null or t.zona_id      = p_zona_id)
  order by (t.seller_id    is not null) desc,
           (t.fuente       is not null) desc,
           (t.tipo_entrega is not null) desc,
           (t.zona_id      is not null) desc,
           t.vigente_desde desc,
           t.id
  limit 1
$$;

comment on function identidad.resolver_tarifa(uuid, uuid, operacion.fuente_pedido, text, uuid, date) is
  'Tarifa aplicable a una entrega. Precedencia: seller > tenant; fuente >
   régimen legado (tipo_entrega) > general; zona > sin zona; vigente_desde desc;
   id. Devuelve 0 filas si no hay tarifa. Los booleanos dicen por qué ganó
   (trazabilidad del snapshot de la línea de dinero). SECURITY INVOKER: respeta
   la RLS P1 de tarifas. Ver 20260928000002.';

-- =============================================================================
-- 8. identidad.resolver_tarifa_por_comuna — variante con zona de respaldo
-- =============================================================================
-- Por qué existe (decisión documentada): ningún pedido guarda zona_id
-- (operacion.pedidos NO tiene esa columna; verificado en 20260725000001), así
-- que TODO llamador tiene la comuna, no la zona. Si la regla "comuna sin zona
-- → zona de respaldo" viviera en TypeScript, cada llamador (alta same-day,
-- ingesta Shopify, ingesta ML, generar-lineas, detectarPedidosSinTarifa) la
-- tendría que repetir y una divergencia cobra distinto el mismo pedido. Aquí se
-- escribe una vez.
--
-- Resolución de zona (INLINE, no llama a identidad.resolver_zona, que es
-- SECURITY DEFINER: se mantiene todo en invoker para no perforar la RLS):
--   1. zona activa a la que está mapeada la comuna (comparación exacta; la
--      comuna viene YA canónica, igual que en resolver_zona);
--   2. si no hay (comuna NULL, sin mapear, o su zona inactiva) → la zona
--      es_respaldo del tenant, y zona_por_respaldo = true para que el
--      backend AVISE al courier;
--   3. si tampoco hay zona de respaldo → zona_id NULL, zona_por_respaldo =
--      false, y se resuelve contra las tarifas sin zona (comportamiento
--      previo; la fila general obligatoria del asistente cubre este caso).
-- Si la zona se resolvió pero no tiene tarifa propia, resolver_tarifa cae a la
-- tarifa sin zona (candidatas zona_id NULL) — no se "salta" a la de respaldo:
-- una comuna mapeada a Zona 1 nunca se cobra como Periferia.
--
-- Devuelve SIEMPRE una fila (con tarifa_id NULL si no hay tarifa), porque la
-- zona resuelta y el aviso de respaldo son información útil aun sin tarifa.
create or replace function identidad.resolver_tarifa_por_comuna(
  p_tenant      uuid,
  p_seller      uuid,
  p_fuente      operacion.fuente_pedido,
  p_tipo_pedido text,
  p_comuna      text,
  p_fecha       date
) returns table (
  tarifa_id          uuid,
  zona_id            uuid,
  zona_por_respaldo  boolean,
  por_seller         boolean,
  por_fuente         boolean,
  por_regimen        boolean,
  por_zona           boolean
)
language sql
stable
security invoker
set search_path = identidad, pg_temp
as $$
  with mapeada as (
    select zc.zona_id
    from identidad.zona_comunas zc
    join identidad.zonas z
      on z.tenant_id = zc.tenant_id and z.id = zc.zona_id
    where zc.tenant_id = p_tenant
      and zc.comuna    = p_comuna
      and z.activa
    limit 1
  ),
  respaldo as (
    select z.id as zona_id
    from identidad.zonas z
    where z.tenant_id = p_tenant
      and z.es_respaldo
      and z.activa
    limit 1
  ),
  zona as (
    select coalesce((select m.zona_id from mapeada m), (select r.zona_id from respaldo r)) as zona_id,
           (not exists (select 1 from mapeada) and exists (select 1 from respaldo)) as por_respaldo
  )
  select rt.tarifa_id,
         zona.zona_id,
         zona.por_respaldo,
         rt.por_seller,
         rt.por_fuente,
         rt.por_regimen,
         rt.por_zona
  from zona
  left join lateral identidad.resolver_tarifa(
    p_tenant, p_seller, p_fuente, p_tipo_pedido, zona.zona_id, p_fecha
  ) rt on true
$$;

comment on function identidad.resolver_tarifa_por_comuna(uuid, uuid, operacion.fuente_pedido, text, text, date) is
  'Como resolver_tarifa, pero recibe la comuna (ya canónica). Comuna sin zona
   activa → zona es_respaldo del tenant, con zona_por_respaldo = true para
   avisar (Q6, 2026-09-28). Siempre devuelve una fila; tarifa_id NULL si no hay
   tarifa. SECURITY INVOKER. Ver 20260928000002.';

-- =============================================================================
-- 9. Grants de ejecución
-- =============================================================================
-- Las funciones nacen con EXECUTE para PUBLIC: se retira (anon no tiene nada
-- que resolver aquí) y se otorga a los dos roles que la usan. Aunque la RLS ya
-- vaciaría el resultado para anon, no se deja la puerta abierta.
revoke all on function identidad.resolver_tarifa(uuid, uuid, operacion.fuente_pedido, text, uuid, date) from public, anon;
revoke all on function identidad.resolver_tarifa_por_comuna(uuid, uuid, operacion.fuente_pedido, text, text, date) from public, anon;

grant execute on function identidad.resolver_tarifa(uuid, uuid, operacion.fuente_pedido, text, uuid, date)
  to authenticated, service_role;
grant execute on function identidad.resolver_tarifa_por_comuna(uuid, uuid, operacion.fuente_pedido, text, text, date)
  to authenticated, service_role;
