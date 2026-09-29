-- =============================================================================
-- 20260928000003 — identidad.courier_config_operacion (puesta en marcha v2)
-- =============================================================================
-- Diseño: docs/ux/puesta-en-marcha-v2.md §0 (H2, H3, H6, H7, H8), §3.6, §6, §8.
--
-- Una fila por courier (1:1 con identidad.tenants), mismo molde que
-- identidad.courier_config_retiro (20260815000004): PK = tenant_id con FK a
-- tenants, RLS forzada, SELECT solo para internos del propio tenant, vista
-- espejo `public.*` de solo lectura con security_invoker.
--
-- Cubre tres huecos con UNA sola lectura por navegación:
--   · H2 — no existía horario de operación a nivel de courier (ventanas_corte
--     es por seller y durante la puesta en marcha todavía no hay sellers).
--   · H3 — no existía "qué servicios ofrece" el courier.
--   · §8 — el bloqueo duro del layout lee `puesta_en_marcha_completada_en`.
--
-- ⚠️ SEMÁNTICA DE LA FILA AUSENTE (decisión de esta migración):
--   Un courier NUEVO nace SIN fila. La ausencia de fila significa "puesta en
--   marcha no terminada" y el gate del layout debe FALLAR CERRADO ante ella
--   (sin fila ⇒ bloqueado). La fila se crea en el paso 3 ("Tu operación"),
--   que es el primer momento en que el dueño elige servicios y horario.
--   Por qué NO se crea en el alta (`provisionarTenantParaAuthUser`): §6 deriva
--   "paso 3 completo" de "existe fila con horas válidas". Si el alta la
--   creara con los defaults 16:00/21:00, el paso 3 aparecería completo sin
--   que nadie lo hubiera visto — el mismo vicio de `monto_conductor_clp
--   default 0` (una fila que existe no es una fila decidida).
--
-- ⚠️ ESCRITURA DESDE SESIÓN (a diferencia de courier_config_retiro, que solo
--   escribe service_role): INSERT/UPDATE para internos con rol dueño o
--   supervisor — el mismo corte que la capacidad RBAC `ajustar_operacion_diaria`
--   (src/modules/identidad/capacidades.ts), que es "confirmar/ajustar la
--   operación". Ninguna capacidad existente calza mejor: `gestionar_tarifas` y
--   `gestionar_perfil_empresa` le dan acceso a administración (rol financiero,
--   "sin reasignación operativa") y se lo niegan al supervisor. Si esa
--   capacidad se reparte distinto, esta política hay que cambiarla a mano: la
--   base no lee la matriz de TypeScript.
--   Sin DELETE: borrar la fila re-bloquearía al courier.
--
--   Marcar la puesta en marcha COMPLETADA es solo del dueño (§8: "otro rol
--   interno no puede completar por sí mismo"). Eso no se expresa con RLS por
--   fila, así que lo impone un trigger: desde una sesión `authenticated`,
--   cambiar `puesta_en_marcha_completada_*` exige rol dueño, deja el autor en
--   auth.uid() y el instante en el reloj del servidor, y no permite des-completar.
--   service_role (backstage/impersonación por servidor) y migraciones pasan.
--
-- Idempotente: create ... if not exists, drop ... if exists + create, create
-- or replace, on conflict do nothing.
-- =============================================================================

create table if not exists identidad.courier_config_operacion (
  tenant_id                         uuid primary key
    references identidad.tenants (id) on delete cascade,

  -- Servicios: los pedidos propios (fuente `rutax_manual`) siempre están y NO
  -- llevan columna. Flex y Shopify son opt-in explícito.
  ofrece_flex                       boolean not null default false,
  ofrece_shopify                    boolean not null default false,

  hora_salida_reparto               time not null default '16:00',
  hora_corte_reparto                time not null default '21:00',

  puesta_en_marcha_paso             smallint,
  puesta_en_marcha_completada_en    timestamptz,
  puesta_en_marcha_completada_por   uuid
    references auth.users (id) on delete set null,

  creado_en                         timestamptz not null default now(),
  actualizado_en                    timestamptz not null default now(),

  -- Mismo día: el reparto no cruza medianoche (corte 21:00–22:00, §3.6).
  constraint courier_config_operacion_corte_despues_de_salida
    check (hora_corte_reparto > hora_salida_reparto),

  constraint courier_config_operacion_paso_rango
    check (puesta_en_marcha_paso is null or puesta_en_marcha_paso between 0 and 4),

  -- Un autor sin instante no tiene sentido. Al revés sí: el backfill de esta
  -- migración marca completados a los couriers existentes SIN autor humano.
  constraint courier_config_operacion_autor_implica_instante
    check (puesta_en_marcha_completada_por is null
           or puesta_en_marcha_completada_en is not null)
);

comment on table identidad.courier_config_operacion is
  'Configuración operativa del courier (1:1 con tenants): qué fuentes ofrece,
   su horario de REPARTO y el estado de su puesta en marcha. Solo internos del
   tenant la ven; sellers y conductores no acceden. La AUSENCIA de fila
   significa "puesta en marcha no terminada": el gate del layout debe fallar
   cerrado. Un courier nuevo nace sin fila; la crea el paso 3 del asistente.';

comment on column identidad.courier_config_operacion.ofrece_flex is
  'El courier opera pedidos Mercado Libre Flex. Habilita la fila de tarifa Flex
   en el paso 4. Los pedidos propios (rutax_manual) no llevan columna: siempre
   están.';

comment on column identidad.courier_config_operacion.ofrece_shopify is
  'El courier opera pedidos Shopify. Hoy no cambia el cobro (Shopify se tarifa
   como same-day); se guarda para el paso 4 y los servicios del courier.';

comment on column identidad.courier_config_operacion.hora_salida_reparto is
  'Hora (Santiago) en que la flota SALE A REPARTIR desde la bodega del courier.
   Antes de esta hora es solo retiro. Es del courier entero, no de un seller.';

comment on column identidad.courier_config_operacion.hora_corte_reparto is
  'Hora (Santiago) en que TERMINA EL REPARTO del día: la ventana de entrega es
   [hora_salida_reparto, hora_corte_reparto]. NO ES lo mismo que
   identidad.ventanas_corte.hora_corte, que es POR SELLER (seller_id NOT NULL)
   y responde otra pregunta: hasta qué hora un pedido de ESE seller entra al
   reparto del mismo día (corte de INGRESO). No se mezclan ni se copian una en
   otra; si un resolvedor usa esta como respaldo cuando el seller no tiene
   ventana, esa es una decisión explícita del resolvedor (pregunta Q2 del
   diseño, abierta para arquitecto).';

comment on column identidad.courier_config_operacion.puesta_en_marcha_paso is
  'Último paso del asistente guardado (0–4), solo como pista para retomar. El
   estado autoritativo de cada paso se DERIVA de los datos (§6 del diseño), no
   de este contador.';

comment on column identidad.courier_config_operacion.puesta_en_marcha_completada_en is
  'Instante en que el dueño terminó la puesta en marcha. NULL (o fila ausente)
   = courier bloqueado por el gate del layout. Desde una sesión solo lo escribe
   el dueño, con el reloj del servidor, y no se puede volver a NULL.';

comment on column identidad.courier_config_operacion.puesta_en_marcha_completada_por is
  'auth.users.id de quien completó la puesta en marcha (el dueño). NULL con
   completada_en poblado = completado por migración/backfill o por servidor.';

drop trigger if exists trg_courier_config_operacion_actualizado_en
  on identidad.courier_config_operacion;
create trigger trg_courier_config_operacion_actualizado_en
  before update on identidad.courier_config_operacion
  for each row execute function identidad.set_actualizado_en();

-- -----------------------------------------------------------------------------
-- Guarda de la marca de completado (solo dueño, desde sesión).
-- -----------------------------------------------------------------------------
create or replace function identidad.courier_config_operacion_guardar_completado()
returns trigger
language plpgsql
as $$
declare
  v_cambia boolean;
begin
  -- Solo se vigila la sesión de usuario. service_role y postgres (migraciones,
  -- backstage por servidor) quedan fuera a propósito.
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_cambia := new.puesta_en_marcha_completada_en is not null
             or new.puesta_en_marcha_completada_por is not null;
  else
    v_cambia := new.puesta_en_marcha_completada_en is distinct from old.puesta_en_marcha_completada_en
             or new.puesta_en_marcha_completada_por is distinct from old.puesta_en_marcha_completada_por;
  end if;

  if not v_cambia then
    return new;
  end if;

  if identidad.claim_rol() <> 'dueno' then
    raise exception 'Solo el dueño completa la puesta en marcha'
      using errcode = '42501';
  end if;

  if new.puesta_en_marcha_completada_en is null then
    raise exception 'La puesta en marcha completada no se puede deshacer desde una sesión'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and old.puesta_en_marcha_completada_en is not null then
    -- Ya completada: la marca original (instante y autor) no se reescribe.
    raise exception 'La puesta en marcha ya estaba completada'
      using errcode = '42501';
  end if;

  new.puesta_en_marcha_completada_en := now();
  new.puesta_en_marcha_completada_por := auth.uid();
  return new;
end;
$$;

comment on function identidad.courier_config_operacion_guardar_completado() is
  'Trigger: desde una sesión authenticated, solo el dueño marca la puesta en
   marcha completada, una sola vez, con autor = auth.uid() e instante = now().';

drop trigger if exists trg_courier_config_operacion_guardar_completado
  on identidad.courier_config_operacion;
create trigger trg_courier_config_operacion_guardar_completado
  before insert or update on identidad.courier_config_operacion
  for each row execute function identidad.courier_config_operacion_guardar_completado();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table identidad.courier_config_operacion enable row level security;
alter table identidad.courier_config_operacion force row level security;

drop policy if exists courier_config_operacion_select on identidad.courier_config_operacion;
create policy courier_config_operacion_select on identidad.courier_config_operacion
  for select
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

-- Espejo SQL de `ajustar_operacion_diaria` (dueño, supervisor). Ver cabecera.
drop policy if exists courier_config_operacion_insert on identidad.courier_config_operacion;
create policy courier_config_operacion_insert on identidad.courier_config_operacion
  for insert
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
    and identidad.claim_rol() in ('dueno', 'supervisor')
  );

drop policy if exists courier_config_operacion_update on identidad.courier_config_operacion;
create policy courier_config_operacion_update on identidad.courier_config_operacion
  for update
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
    and identidad.claim_rol() in ('dueno', 'supervisor')
  )
  with check (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
    and identidad.claim_rol() in ('dueno', 'supervisor')
  );

-- Sin política de DELETE: borrar la fila re-bloquearía al courier.

-- -----------------------------------------------------------------------------
-- Vista espejo (solo lectura, como la de courier_config_retiro). La escritura
-- desde sesión va por `.schema("identidad")`, sujeta a las políticas de arriba.
-- -----------------------------------------------------------------------------
create or replace view public.courier_config_operacion
  with (security_invoker = true)
  as select
    tenant_id,
    ofrece_flex,
    ofrece_shopify,
    hora_salida_reparto,
    hora_corte_reparto,
    puesta_en_marcha_paso,
    puesta_en_marcha_completada_en,
    puesta_en_marcha_completada_por,
    creado_en,
    actualizado_en
  from identidad.courier_config_operacion;

-- `create or replace view` conserva el GRANT pero REEMPLAZA las opciones: se
-- reafirma security_invoker explícitamente (gotcha conocido del proyecto).
alter view public.courier_config_operacion set (security_invoker = true);

comment on view public.courier_config_operacion is
  'Espejo de identidad.courier_config_operacion para PostgREST. RLS heredada:
   tenant + solo interno. Solo lectura.';

-- -----------------------------------------------------------------------------
-- Grants. Escritura por columna: una sesión no puede tocar creado_en ni
-- actualizado_en, ni mover la fila de tenant (tenant_id fuera del UPDATE).
-- -----------------------------------------------------------------------------
revoke all on identidad.courier_config_operacion from anon, authenticated;
revoke all on public.courier_config_operacion from anon, authenticated;

grant select on identidad.courier_config_operacion to authenticated;
grant insert (tenant_id, ofrece_flex, ofrece_shopify, hora_salida_reparto,
              hora_corte_reparto, puesta_en_marcha_paso,
              puesta_en_marcha_completada_en, puesta_en_marcha_completada_por)
  on identidad.courier_config_operacion to authenticated;
grant update (ofrece_flex, ofrece_shopify, hora_salida_reparto,
              hora_corte_reparto, puesta_en_marcha_paso,
              puesta_en_marcha_completada_en, puesta_en_marcha_completada_por)
  on identidad.courier_config_operacion to authenticated;
grant select on public.courier_config_operacion to authenticated;

grant all on identidad.courier_config_operacion to service_role;
grant all on public.courier_config_operacion to service_role;

-- -----------------------------------------------------------------------------
-- Backfill: los couriers que YA existen no se bloquean (§8).
-- -----------------------------------------------------------------------------
-- En función y no en un INSERT suelto por dos motivos:
--   1. El pgTAP la ejercita tal cual (sin re-aplicar DDL dentro de la prueba).
--   2. `supabase db reset` aplica las migraciones ANTES del seed, así que el
--      tenant de demo nace después del backfill; seed.sql la llama al final.
-- `p_creados_hasta` acota a los tenants creados hasta ese instante: llamarla
-- tarde nunca marca completado a un courier nuevo que esté a mitad del
-- asistente, porque además `on conflict do nothing` no pisa una fila existente.
--
-- ofrece_flex = true si el courier tiene alguna conexión ML (de cualquier
-- seller, viva o no) o algún pedido fuente = 'ml_flex'. Misma regla para
-- Shopify, por simetría: un courier que ya ingirió Shopify lo ofrece.
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
    on conflict (tenant_id) do nothing
    returning 1
  )
  select count(*)::integer from insertadas;
$$;

comment on function identidad.courier_config_operacion_marcar_existentes(timestamptz) is
  'Backfill de la puesta en marcha v2: marca COMPLETADA la puesta en marcha de
   los tenants creados hasta p_creados_hasta que no tengan fila. No pisa filas
   existentes. Solo postgres (migraciones, seed): NO llamar desde la app — con
   un p_creados_hasta tardío saltaría el asistente de un courier nuevo.';

-- `create or replace` no resetea la ACL: se revoca explícitamente cada vez.
revoke all on function identidad.courier_config_operacion_marcar_existentes(timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function identidad.courier_config_operacion_guardar_completado()
  from public, anon, authenticated, service_role;

select identidad.courier_config_operacion_marcar_existentes(now());

-- -----------------------------------------------------------------------------
-- Bodega principal (§3.5): sin cambio de esquema. `courier_bodegas_principal_uk`
-- (20260813000002) ya garantiza COMO MÁXIMO una principal por tenant, y
-- `crearBodegaInterno` (configuracion/bodegas/actions.ts) ya fuerza
-- es_principal = true en la PRIMERA bodega. El "exactamente una" que exige el
-- paso 2 lo evalúa el gate (§6: fila activa + es_principal + geo 'resuelto').
-- -----------------------------------------------------------------------------

notify pgrst, 'reload schema';
