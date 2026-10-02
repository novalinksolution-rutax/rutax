-- =============================================================================
-- 20261001000001 — identidad.courier_perfil_comercial (registro v2, «Tu empresa»)
-- =============================================================================
-- Decisión del usuario (1-oct-2026): al registrarse, el courier responde TRES
-- preguntas obligatorias de un toque — envíos al día, cuántos conductores y de
-- dónde vienen sus pedidos. Se usan SOLO para:
--   · priorizar la atención comercial de Rutax, y
--   · medir qué e-commerce conviene integrar.
-- NO prellenan configuración (servicios, tarifas, zonas): eso vive en
-- identidad.courier_config_operacion y lo decide el courier en la puesta en
-- marcha. Si alguien quiere derivar `ofrece_flex` de `fuentes_pedidos`, es una
-- decisión nueva, no un atajo.
--
-- Molde: identidad.courier_config_operacion (20260928000003). Una fila por
-- courier, PK = tenant_id, RLS forzada, SELECT para internos del tenant,
-- escritura por columna, vista espejo `public.*` de solo lectura con
-- security_invoker.
--
-- ⚠️ ESCRITURA: INSERT/UPDATE solo dueño y administración (decisión del
--   usuario). Coordinador y supervisor LEEN pero no escriben. Seller y
--   conductor: nada. Sin DELETE desde sesión. El backstage lee con service_role.
--   La base no lee la matriz RBAC de TypeScript: si el corte cambia, esta
--   política se cambia a mano.
--
-- ⚠️ `actualizado_por` lo fija un trigger a auth.uid() en sesiones
--   `authenticated` (no está en el grant: el cliente no elige su autor).
--
-- ⚠️ LISTAS CHECK (regla de CLAUDE.md): `envios_dia_rango`,
--   `conductores_rango` y `fuentes_pedidos` son text + CHECK de lista. Una
--   migración que agregue un valor debe reponer la lista ENTERA copiándola de
--   la base vigente (pg_get_constraintdef), nunca de otra migración: si se copia
--   una versión vieja, un valor desaparece sin que nada falle al migrar.
--
-- Backfill: NINGUNO. Los tenants existentes quedan sin fila; la UI lo trata
-- como "sin responder".
--
-- Idempotente: create ... if not exists, drop ... if exists + create, create
-- or replace.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: arreglo de texto sin elementos repetidos. Un CHECK no admite
-- subconsultas, así que la comparación va en una función IMMUTABLE.
-- -----------------------------------------------------------------------------
create or replace function identidad.arreglo_texto_sin_duplicados(p text[])
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(
    (select count(distinct x) = count(x) from unnest(p) as u(x)),
    true
  );
$$;

comment on function identidad.arreglo_texto_sin_duplicados(text[]) is
  'true si el arreglo no repite elementos (los NULL no cuentan). Para CHECKs
   sobre columnas text[], que no admiten subconsultas.';

create table if not exists identidad.courier_perfil_comercial (
  tenant_id            uuid primary key
    references identidad.tenants (id) on delete cascade,

  envios_dia_rango     text not null,
  conductores_rango    text not null,
  fuentes_pedidos      text[] not null,
  fuente_otra          text,

  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now(),
  actualizado_por      uuid
    references auth.users (id) on delete set null
);

-- CHECKs fuera del CREATE TABLE (drop + add) para que la migración sea
-- re-ejecutable y cada lista quede con nombre estable.
alter table identidad.courier_perfil_comercial
  drop constraint if exists courier_perfil_comercial_envios_dia_rango_valido;
alter table identidad.courier_perfil_comercial
  add constraint courier_perfil_comercial_envios_dia_rango_valido
  check (envios_dia_rango in ('aun_no_opera', 'menos_100', '100_300', '300_1000', 'mas_1000'));

alter table identidad.courier_perfil_comercial
  drop constraint if exists courier_perfil_comercial_conductores_rango_valido;
alter table identidad.courier_perfil_comercial
  add constraint courier_perfil_comercial_conductores_rango_valido
  check (conductores_rango in ('1_5', '6_15', '16_40', 'mas_40'));

alter table identidad.courier_perfil_comercial
  drop constraint if exists courier_perfil_comercial_fuentes_pedidos_validas;
alter table identidad.courier_perfil_comercial
  add constraint courier_perfil_comercial_fuentes_pedidos_validas
  check (
    cardinality(fuentes_pedidos) >= 1
    and array_ndims(fuentes_pedidos) = 1
    and array_position(fuentes_pedidos, null) is null
    and fuentes_pedidos <@ array[
      'mercado_libre_flex', 'falabella', 'paris', 'ripley', 'shopify',
      'woocommerce', 'jumpseller', 'vtex', 'venta_directa', 'otra'
    ]::text[]
    and identidad.arreglo_texto_sin_duplicados(fuentes_pedidos)
  );

-- 'otra' ⇔ texto: con 'otra' el texto es obligatorio (trim no vacío, ≤ 80);
-- sin 'otra' el texto debe ser NULL.
alter table identidad.courier_perfil_comercial
  drop constraint if exists courier_perfil_comercial_fuente_otra_coherente;
alter table identidad.courier_perfil_comercial
  add constraint courier_perfil_comercial_fuente_otra_coherente
  check (
    case
      when 'otra' = any (fuentes_pedidos) then
        fuente_otra is not null
        and length(btrim(fuente_otra)) > 0
        and char_length(fuente_otra) <= 80
      else
        fuente_otra is null
    end
  );

comment on table identidad.courier_perfil_comercial is
  'Perfil comercial del courier (1:1 con tenants): las 3 preguntas del registro
   («Tu empresa»). PROPÓSITO ÚNICO: priorizar la atención comercial de Rutax y
   medir qué e-commerce conviene integrar. NO prellena configuración (servicios,
   tarifas, zonas). Fila ausente = "sin responder". Leen los internos del
   tenant; escriben dueño y administración; el backstage lee con service_role.
   ⚠️ Las listas CHECK se reponen ENTERAS copiando la vigente de la base.';

comment on column identidad.courier_perfil_comercial.envios_dia_rango is
  'Rango declarado de envíos al día. Solo para priorizar atención comercial.
   Lista CHECK: aun_no_opera, menos_100, 100_300, 300_1000, mas_1000 — se repone
   ENTERA desde la base al agregar un valor.';

comment on column identidad.courier_perfil_comercial.conductores_rango is
  'Rango declarado de conductores. Solo para priorizar atención comercial.
   Lista CHECK: 1_5, 6_15, 16_40, mas_40 — se repone ENTERA desde la base.';

comment on column identidad.courier_perfil_comercial.fuentes_pedidos is
  'De dónde vienen los pedidos del courier (declarado, multi, ≥1, sin repetir).
   Métrica de qué e-commerce integrar. NO es `operacion.pedidos.fuente` ni
   habilita servicios. Lista CHECK: mercado_libre_flex, falabella, paris,
   ripley, shopify, woocommerce, jumpseller, vtex, venta_directa, otra — se
   repone ENTERA desde la base.';

comment on column identidad.courier_perfil_comercial.fuente_otra is
  'Texto libre cuando fuentes_pedidos incluye ''otra'' (obligatorio, ≤ 80
   caracteres, no vacío). NULL en cualquier otro caso.';

comment on column identidad.courier_perfil_comercial.actualizado_por is
  'auth.users.id de quien escribió por última vez. Desde una sesión lo fija un
   trigger a auth.uid(); NULL si lo escribió el servidor/backstage.';

drop trigger if exists trg_courier_perfil_comercial_actualizado_en
  on identidad.courier_perfil_comercial;
create trigger trg_courier_perfil_comercial_actualizado_en
  before update on identidad.courier_perfil_comercial
  for each row execute function identidad.set_actualizado_en();

-- -----------------------------------------------------------------------------
-- Autor de la última escritura (solo sesiones de usuario).
-- -----------------------------------------------------------------------------
create or replace function identidad.courier_perfil_comercial_fijar_autor()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated' then
    new.actualizado_por := auth.uid();
  end if;
  return new;
end;
$$;

comment on function identidad.courier_perfil_comercial_fijar_autor() is
  'Trigger: en sesiones authenticated, actualizado_por = auth.uid(). El cliente
   no elige su autor.';

drop trigger if exists trg_courier_perfil_comercial_fijar_autor
  on identidad.courier_perfil_comercial;
create trigger trg_courier_perfil_comercial_fijar_autor
  before insert or update on identidad.courier_perfil_comercial
  for each row execute function identidad.courier_perfil_comercial_fijar_autor();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table identidad.courier_perfil_comercial enable row level security;
alter table identidad.courier_perfil_comercial force row level security;

drop policy if exists courier_perfil_comercial_select on identidad.courier_perfil_comercial;
create policy courier_perfil_comercial_select on identidad.courier_perfil_comercial
  for select
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

drop policy if exists courier_perfil_comercial_insert on identidad.courier_perfil_comercial;
create policy courier_perfil_comercial_insert on identidad.courier_perfil_comercial
  for insert
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
    and identidad.claim_rol() in ('dueno', 'administracion')
  );

drop policy if exists courier_perfil_comercial_update on identidad.courier_perfil_comercial;
create policy courier_perfil_comercial_update on identidad.courier_perfil_comercial
  for update
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

-- Sin política de DELETE.

-- -----------------------------------------------------------------------------
-- Vista espejo (solo lectura).
-- -----------------------------------------------------------------------------
create or replace view public.courier_perfil_comercial
  with (security_invoker = true)
  as select
    tenant_id,
    envios_dia_rango,
    conductores_rango,
    fuentes_pedidos,
    fuente_otra,
    creado_en,
    actualizado_en,
    actualizado_por
  from identidad.courier_perfil_comercial;

-- `create or replace view` reemplaza las opciones: se reafirma.
alter view public.courier_perfil_comercial set (security_invoker = true);

comment on view public.courier_perfil_comercial is
  'Espejo de identidad.courier_perfil_comercial para PostgREST. RLS heredada:
   tenant + solo interno. Solo lectura.';

-- -----------------------------------------------------------------------------
-- Grants. Escritura por columna: tenant_id fuera del UPDATE; creado_en,
-- actualizado_en y actualizado_por fuera de todo grant de escritura.
-- -----------------------------------------------------------------------------
revoke all on identidad.courier_perfil_comercial from anon, authenticated;
revoke all on public.courier_perfil_comercial from anon, authenticated;

grant select on identidad.courier_perfil_comercial to authenticated;
grant insert (tenant_id, envios_dia_rango, conductores_rango, fuentes_pedidos, fuente_otra)
  on identidad.courier_perfil_comercial to authenticated;
grant update (envios_dia_rango, conductores_rango, fuentes_pedidos, fuente_otra)
  on identidad.courier_perfil_comercial to authenticated;
grant select on public.courier_perfil_comercial to authenticated;

grant all on identidad.courier_perfil_comercial to service_role;
grant all on public.courier_perfil_comercial to service_role;

-- `create or replace` no resetea la ACL: se revoca explícitamente.
revoke all on function identidad.courier_perfil_comercial_fijar_autor()
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
