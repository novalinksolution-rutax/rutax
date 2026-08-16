-- =============================================================================
-- Etapa 8 · El dinero del retiro — el esquema
--
-- QUÉ HABILITA
-- El courier le paga al conductor POR VISITA A BODEGA (decisión de cierre del
-- alcance, 2026-08-12). Esa línea de liquidación NO cuelga de ningún pedido:
-- cuelga de la visita. Por construcción entonces, traspasar un pedido a otro
-- conductor no puede tocarla, y una cancelación tampoco — la visita ocurrió
-- igual. La regla "quien retiró conserva el pago del retiro" queda impuesta por
-- el modelo, no por la disciplina de quien escriba el código.
--
-- Hoy eso es IMPOSIBLE de guardar: `pedido_id` es `not null unique` en
-- dinero.lineas_liquidacion (20260601000006:523).
--
-- =============================================================================
-- TABLA ÚNICA CON DISCRIMINADOR, NO UNA TABLA APARTE
-- =============================================================================
-- El argumento a favor de una tabla separada era el aislamiento. No aplica: la
-- RLS de lineas_liquidacion (20260601000006:787-804) filtra por tenant y por
-- conductor, y NO menciona pedido_id. Una línea sin pedido queda correctamente
-- aislada sin tocar una sola política — verificado leyéndolas.
--
-- Sin ese argumento, una tabla aparte pagaría duplicar el ciclo de vida entero
-- (anulación, enganche a la liquidación, conciliación, payout, PDF) a cambio de
-- nada.
--
-- =============================================================================
-- LO QUE NO SE TOCA, Y POR QUÉ IMPORTA
-- =============================================================================
-- · `dinero.lineas_cobro` queda INTACTA. El retiro se le paga al conductor pero
--   TODAVÍA NO se le cobra al seller (alcance, 2026-08-12). Dejarla quieta
--   elimina de un plumazo el riesgo en integridad.ts (que reportaría cada línea
--   sin pedido como huérfana), en conciliar-periodo.ts (línea suelta sin
--   período) y en las dos pantallas de cobro que hacen `.slice()` sobre el
--   pedidoId.
--
-- · `fecha_entrega` NO se renombra a `fecha_hecho` en esta migración, aunque el
--   plan lo pida en el mismo movimiento. El nombre engaña —guardará la fecha de
--   una visita— y hay que corregirlo, pero renombrar una columna que se
--   referencia por STRING desde PostgREST (`.order('fecha_entrega')`,
--   `.gte(...)`, los mappers) tiene 14 puntos de rotura que el typecheck NO ve:
--   fallarían en ejecución, dentro de consultas de dinero. Dos cambios
--   riesgosos a la vez sobre la misma tabla, el mismo día, es cómo se pierde la
--   capacidad de saber cuál rompió. Va en migración propia y sola, donde la
--   revisión es trivial porque lo único que cambia es el nombre.
--
-- =============================================================================
-- ⚠️ EL `ON CONFLICT` QUE EL PLAN DABA POR ROTO: EN TYPESCRIPT NO EXISTE
-- =============================================================================
-- El plan advertía que volver el UNIQUE parcial rompería la idempotencia del
-- motor, porque PostgreSQL exige que el predicado del ON CONFLICT implique el
-- del índice. Verificado en el código: `generar-lineas.ts:857-877` hace un
-- `.insert()` PLANO y atrapa el 23505 leyendo el texto del error
-- (`error.message.includes('duplicate')`). El comentario de la migración
-- original que dice "ON CONFLICT (pedido_id) DO NOTHING" está desactualizado.
-- Un índice parcial sigue lanzando `duplicate key value violates unique
-- constraint`, así que el motor sobrevive intacto.
--
-- ⚠️ PERO la trampa queda armada para el futuro: PostgREST/supabase-js NO
-- pueden expresar `ON CONFLICT (col) WHERE …`. Si alguien "moderniza" ese
-- insert a `.upsert(…, { onConflict: 'pedido_id' })`, falla con 42P10 EN
-- EJECUCIÓN, no al migrar. Queda dicho en el comentario de la tabla.
--
-- Donde SÍ hay ON CONFLICT explícito es en SQL: los seeds y el script de
-- escala. Se corrigen en el mismo commit (no son migraciones, no van acá).
--
-- =============================================================================
-- ENUM NATIVO Y NO `text` + CHECK
-- =============================================================================
-- Es la convención vigente del repo para código nuevo, argumentada en
-- 20260812000002:52-66: un typo en `text` no falla, devuelve cero filas y una
-- pantalla vacía SIN error; el enum lo convierte en un 22P02 ruidoso. Además
-- este esquema ya pagó caro la otra vía: `eventos_conciliacion.tipo_diferencia`
-- es text+CHECK y perdió un valor en silencio el 2026-08-12.
--
-- IDEMPOTENTE Y NO DESTRUCTIVA: DO-blocks, `if not exists`, `create or replace`.
-- Prueba de aislamiento: supabase/tests/database/rls_aislamiento_linea_retiro.test.sql
-- =============================================================================

-- =============================================================================
-- 1. El tipo dinero.tipo_hecho_linea
--    DO-block idempotente: el repo no usa `create type if not exists`.
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'tipo_hecho_linea' and n.nspname = 'dinero'
  ) then
    create type dinero.tipo_hecho_linea as enum (
      'entrega',
      'retiro_bodega'
    );
  end if;
end $$;

comment on type dinero.tipo_hecho_linea is
  'Qué HECHO generó la línea de dinero. entrega = un pedido llegó a su
   destinatario (cuelga de operacion.pedidos). retiro_bodega = un conductor
   visitó la bodega de un seller y cargó bultos (cuelga de
   operacion.sesiones_retiro). Son dos hechos generadores distintos y el
   discriminador es lo que permite que convivan en la misma tabla sin que un
   detector confunda uno con otro.';

-- =============================================================================
-- 2. identidad.courier_config_retiro — cuánto vale una visita
--
-- Tabla propia y no una columna en courier_config_payout: esa tabla responde
-- CÓMO se paga (método, retención, opt-in de transferencia real), no CUÁNTO
-- vale una unidad de trabajo. Sigue el patrón establecido de una config por
-- dominio (courier_config_dte, _cobranza, _payout) y la etapa 10 le va a
-- agregar sus días de retención.
--
-- ⚠️ EL NOMBRE EVITA LA PALABRA "RETIRO" EN LA COLUMNA, A PROPÓSITO.
-- `courier_config_payout.minimo_retiro_clp` (20260707000003) es retiro de
-- FONDOS, no de paquetes — un falso amigo que ya está anotado como trampa del
-- proyecto. `monto_visita_bodega_clp` no se puede confundir con aquello.
--
-- ⚠️ SIN DEFAULT, Y ES LA LECCIÓN DEL 2026-08-15.
-- Ese día se descubrió que `identidad.tarifas.monto_conductor_clp` nació con
-- `default 0`, ningún formulario la escribía, y TODA liquidación de producción
-- se generó en $0 durante meses sin que nada fallara. Acá la columna es NOT
-- NULL sin default: una fila no puede existir a medias. Y la AUSENCIA de fila
-- significa "sin configurar", que el generador debe tratar como una excepción
-- ruidosa con bloqueo de pago — nunca escribiendo una línea de $0.
-- =============================================================================
create table if not exists identidad.courier_config_retiro (
  tenant_id                uuid primary key
    references identidad.tenants (id) on delete cascade,

  monto_visita_bodega_clp  numeric(12,0) not null
    constraint courier_config_retiro_monto_visita_positivo
      check (monto_visita_bodega_clp > 0),

  creado_en                timestamptz not null default now(),
  actualizado_en           timestamptz not null default now()
);

comment on table identidad.courier_config_retiro is
  'Configuración del retiro en bodega del courier (1:1 con tenants). Solo roles
   internos la ven; sellers y conductores no acceden jamás. La ausencia de fila
   significa "sin configurar" y el generador de la línea de retiro debe
   levantar excepción bloqueante en vez de escribir una línea de $0.';

comment on column identidad.courier_config_retiro.monto_visita_bodega_clp is
  'CLP que el courier le paga al conductor por CADA visita cerrada a una bodega '
  'de seller. Es el valor por defecto del tenant; identidad.seller_bodegas.'
  'monto_visita_clp lo sobrescribe para una bodega concreta. > 0 obligatorio: '
  'un cero acá sería el bug de monto_conductor_clp otra vez. OJO: no confundir '
  'con courier_config_payout.minimo_retiro_clp, que es retiro de FONDOS.';

drop trigger if exists trg_courier_config_retiro_actualizado_en on identidad.courier_config_retiro;
create trigger trg_courier_config_retiro_actualizado_en
  before update on identidad.courier_config_retiro
  for each row execute function identidad.set_actualizado_en();

alter table identidad.courier_config_retiro enable row level security;
alter table identidad.courier_config_retiro force row level security;

drop policy if exists courier_config_retiro_select on identidad.courier_config_retiro;
create policy courier_config_retiro_select on identidad.courier_config_retiro
  for select
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'interno'
  );

-- Sin políticas de escritura: la configura la app con service_role, igual que
-- courier_config_payout.
create or replace view public.courier_config_retiro
  with (security_invoker = true)
  as select
    tenant_id,
    monto_visita_bodega_clp,
    creado_en,
    actualizado_en
  from identidad.courier_config_retiro;

comment on view public.courier_config_retiro is
  'Espejo de identidad.courier_config_retiro para PostgREST. RLS heredada:
   P1 tenant + solo interno.';

grant select on identidad.courier_config_retiro to authenticated;
grant select on public.courier_config_retiro to authenticated;
grant all on identidad.courier_config_retiro to service_role;
grant all on public.courier_config_retiro to service_role;

-- =============================================================================
-- 3. identidad.seller_bodegas.monto_visita_clp — el override por bodega
--
-- NULLABLE a propósito, y la semántica es "hereda del tenant", no "cero".
-- Una bodega en Lampa no vale lo mismo que una en Providencia, pero la enorme
-- mayoría no necesita distinguirse: obligar a llenar el monto en cada bodega
-- convertiría "crear una bodega" en un trámite y dejaría bodegas nuevas
-- inutilizables hasta configurarlas.
-- =============================================================================
alter table identidad.seller_bodegas
  add column if not exists monto_visita_clp numeric(12,0);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'seller_bodegas_monto_visita_positivo'
  ) then
    alter table identidad.seller_bodegas
      add constraint seller_bodegas_monto_visita_positivo
        check (monto_visita_clp is null or monto_visita_clp > 0);
  end if;
end $$;

comment on column identidad.seller_bodegas.monto_visita_clp is
  'Sobrescribe identidad.courier_config_retiro.monto_visita_bodega_clp para '
  'ESTA bodega. NULL = hereda el del tenant (no significa cero). El CHECK '
  'prohíbe el 0 justamente para que "gratis" no se pueda expresar por '
  'accidente: si una bodega no debe pagarse, eso es una decisión que todavía '
  'no existe en el producto.';

-- =============================================================================
-- 4. dinero.lineas_liquidacion — el discriminador y el hecho alternativo
-- =============================================================================

-- 4.1 El discriminador. CON default 'entrega' a propósito: sin él, los INSERT
--     con lista explícita de columnas que ya existen (los tres seeds, las
--     pruebas pgTAP de aislamiento) fallarían con 23502. Toda fila existente ES
--     una entrega, así que el default también es la respuesta correcta para el
--     backfill.
alter table dinero.lineas_liquidacion
  add column if not exists tipo_hecho dinero.tipo_hecho_linea not null default 'entrega';

comment on column dinero.lineas_liquidacion.tipo_hecho is
  'Qué hecho generó esta línea. Determina cuál de pedido_id / sesion_retiro_id '
  'está poblado — ver el CHECK lineas_liq_hecho_coherente. Todo consumidor que '
  'cuente "entregas" DEBE filtrar por este campo: contar filas ya no es contar '
  'entregas.';

-- 4.2 La visita de la que cuelga la línea de retiro.
alter table dinero.lineas_liquidacion
  add column if not exists sesion_retiro_id uuid;

comment on column dinero.lineas_liquidacion.sesion_retiro_id is
  'La visita a bodega que generó esta línea. NULL en las líneas de entrega. '
  'La FK es COMPUESTA con tenant_id y driver_id: la base impone que el '
  'conductor al que se le paga la visita es EL QUE HIZO la visita.';

-- 4.3 pedido_id deja de ser obligatorio.
alter table dinero.lineas_liquidacion
  alter column pedido_id drop not null;

-- 4.4 El UNIQUE pasa a ser PARCIAL.
--     Un constraint UNIQUE de Postgres no puede ser parcial: hay que bajarlo y
--     crear un índice. El molde exacto está en 20260601000005:381-383
--     (idx_asignaciones_pedido_activa_uk … where activa = true).
--
--     El predicado es `where tipo_hecho = 'entrega'` y NO `where pedido_id is
--     not null`: si algún día una línea de retiro quisiera referenciar un
--     pedido como contexto, la segunda forma se lo prohibiría sin motivo.
alter table dinero.lineas_liquidacion
  drop constraint if exists lineas_liquidacion_pedido_id_key;

create unique index if not exists lineas_liq_pedido_entrega_uk
  on dinero.lineas_liquidacion (pedido_id)
  where tipo_hecho = 'entrega';

comment on index dinero.lineas_liq_pedido_entrega_uk is
  'Reemplaza al UNIQUE simple de pedido_id. Sostiene la idempotencia del motor '
  'C1, que NO usa ON CONFLICT: hace INSERT plano y atrapa el 23505 por texto '
  '(generar-lineas.ts:875). Un índice parcial lanza el mismo error, así que el '
  'motor no cambia. Pero un futuro .upsert({onConflict:"pedido_id"}) de '
  'PostgREST fallaría con 42P10 EN EJECUCIÓN: PostgREST no sabe expresar el '
  'WHERE que la inferencia del índice parcial exige.';

-- 4.5 Una visita genera UNA línea. Es la idempotencia del lado del retiro.
create unique index if not exists lineas_liq_sesion_retiro_uk
  on dinero.lineas_liquidacion (sesion_retiro_id)
  where tipo_hecho = 'retiro_bodega';

-- 4.6 El CHECK cruzado: cada tipo de hecho puebla su columna y solo la suya.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lineas_liq_hecho_coherente'
  ) then
    alter table dinero.lineas_liquidacion
      add constraint lineas_liq_hecho_coherente check (
        (tipo_hecho = 'entrega'
          and pedido_id is not null
          and sesion_retiro_id is null)
        or
        (tipo_hecho = 'retiro_bodega'
          and sesion_retiro_id is not null
          and pedido_id is null)
      );
  end if;
end $$;

-- 4.7 La FK compuesta que impone "se le paga al que fue".
--     La llave del otro lado ya existe: 20260813000004:256 creó
--     `sesiones_retiro_tenant_id_conductor_uk unique (tenant_id, id,
--     conductor_id)` declarando en su comentario que era para esto.
--
--     Sin ella, un bug de atribución podría pagarle la visita de un conductor a
--     otro, y ese error es indetectable mirando la liquidación: los montos
--     cuadran, solo está mal el destinatario.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lineas_liq_sesion_del_mismo_conductor'
  ) then
    alter table dinero.lineas_liquidacion
      add constraint lineas_liq_sesion_del_mismo_conductor
        foreign key (tenant_id, sesion_retiro_id, driver_id)
        references operacion.sesiones_retiro (tenant_id, id, conductor_id)
        on delete restrict;
  end if;
end $$;

create index if not exists idx_lineas_liq_sesion_retiro
  on dinero.lineas_liquidacion (tenant_id, sesion_retiro_id)
  where sesion_retiro_id is not null;

comment on table dinero.lineas_liquidacion is
  'Monto que el courier paga al conductor. DOS hechos generadores, discriminados
   por tipo_hecho: una ENTREGA (cuelga de pedido_id) o una VISITA A BODEGA
   (cuelga de sesion_retiro_id). La columna monto_final_clp es GENERATED
   (monto_base + ajuste_incidencia). RLS: P1 tenant + P3 conductor — no depende
   de pedido_id, por eso la línea de retiro queda aislada sin políticas nuevas.
   Escritura: solo service_role.
   ⚠️ Contar filas NO es contar entregas: filtra por tipo_hecho.
   ⚠️ La idempotencia NO usa ON CONFLICT (ver el comentario del índice
   lineas_liq_pedido_entrega_uk antes de "modernizar" ese insert).';

-- =============================================================================
-- 5. Vista espejo y GRANTS POR COLUMNA
--
-- ⚠️ ESTE PASO NO ES OPCIONAL Y FALLA EN EJECUCIÓN SI SE OLVIDA.
-- Los privilegios de estas tablas son POR COLUMNA (20260707000002), no por
-- tabla. Una columna nueva NO queda legible por `authenticated`. Y como la
-- vista public.* es security_invoker, agregar tipo_hecho a la vista sin
-- re-emitir el grant rompe la VISTA ENTERA con "permission denied" — no solo la
-- columna nueva. Por eso van juntos y en este orden.
-- =============================================================================
create or replace view public.lineas_liquidacion
  with (security_invoker = true)
  as select
    id,
    tenant_id,
    driver_id,
    pedido_id,
    liquidacion_id,
    monto_base_clp,
    ajuste_incidencia_clp,
    monto_final_clp,
    concepto,
    fecha_entrega,
    incidencia_id,
    origen_generacion,
    generado_por_usuario_id,
    notas,
    creado_en,
    actualizado_en,
    anulada,
    anulada_en,
    motivo_anulacion,
    tipo_hecho,
    sesion_retiro_id
  from dinero.lineas_liquidacion;

comment on view public.lineas_liquidacion is
  'Espejo de dinero.lineas_liquidacion para PostgREST. RLS heredada: P1 + P3
   conductor. Sellers no tienen acceso. Lista de columnas EXPLÍCITA: OMITE
   snapshot_regla (confidencial). tipo_hecho y sesion_retiro_id agregados en la
   etapa 8 — al final, que es lo que create or replace view permite.';

revoke select on dinero.lineas_liquidacion from authenticated;

grant select (
  id,
  tenant_id,
  driver_id,
  pedido_id,
  liquidacion_id,
  monto_base_clp,
  ajuste_incidencia_clp,
  monto_final_clp,
  concepto,
  fecha_entrega,
  incidencia_id,
  origen_generacion,
  generado_por_usuario_id,
  notas,
  creado_en,
  actualizado_en,
  anulada,
  anulada_en,
  motivo_anulacion,
  tipo_hecho,
  sesion_retiro_id
) on dinero.lineas_liquidacion to authenticated;
