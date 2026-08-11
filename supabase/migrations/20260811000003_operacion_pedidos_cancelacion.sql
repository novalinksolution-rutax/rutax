-- =============================================================================
-- Operación · pedidos: proyección operativa de la cancelación (3 columnas)
-- =============================================================================
-- CONTEXTO: docs/arquitectura/edicion-y-cancelacion-de-pedidos.md §9 (modelo de
-- datos), §4 (RLS y capacidades), §6.2 (visibilidad del motivo).
--
-- Qué agrega: `cancelado_en`, `cancelado_por_usuario_id` y `motivo_cancelacion`
-- en operacion.pedidos. Es la MISMA figura que ya usa el módulo dinero para sus
-- documentos anulables (`dinero.periodos_cobro` y `dinero.lineas_*` llevan
-- `anulado_en` / `anulado_por_usuario_id` / `motivo_anulacion`): la bitácora
-- sigue siendo el registro legal —append-only, con `on delete restrict`— y estas
-- tres columnas son la PROYECCIÓN operativa, para que `/operaciones`, el portal
-- del seller y la reportería muestren "cancelado por el seller — dirección
-- duplicada" sin ir a buscarlo a `identidad.bitacora_auditoria`.
--
-- ALCANCE: SOLO esquema. Ni una línea de src/. La escritura de estas columnas
-- (`cancelarPedido`), la máquina de estados y la bitácora son de `backend`, en
-- tarea aparte. Esta migración solo deja las columnas DISPONIBLES.
--
-- La EDICIÓN de pedidos queda fuera de alcance (decisión del fundador, §10.0):
-- este archivo no prepara nada para ella.
--
-- =============================================================================
-- LO QUE **NO** SE HACE, Y POR QUÉ (léase antes de "mejorarlo")
-- =============================================================================
--
-- 1. NINGUNA política RLS nueva. En particular NO se crea
--    `pedidos_update_seller_propio` (§4.1). No es un olvido: sería un
--    RETROCESO. El `GRANT` sobre operacion.pedidos es de TABLA COMPLETA
--    (`grant select, insert, update on operacion.pedidos to authenticated`,
--    20260601000005 §14). Una política de UPDATE para el seller le abriría, vía
--    PostgREST, escritura sobre CUALQUIER columna de sus propias filas —
--    incluidos `estado`, `monto_cobro_clp`, `cobro_generado` y
--    `tarifa_aplicable_id`. Un `with check` no compara OLD vs NEW y no lo
--    impide. Acotarlo exigiría migrar a `GRANT UPDATE (col, …)` por columna, lo
--    que afectaría TAMBIÉN a los internos (mismo rol `authenticated`) y toca una
--    superficie mucho mayor que esta feature.
--    La pertenencia del pedido se resuelve leyendo con el cliente de la SESIÓN
--    (RLS decide, §4.2) y se escribe con `service_role` con `seller_id` en el
--    `WHERE`. Lo prueba supabase/tests/database/rls_pedidos_cancelacion.test.sql.
--
-- 2. NINGÚN `creado_por_usuario_id` en pedidos (§1.1): quedaría `null` en toda
--    la ingesta de ML, que no tiene autor humano. La autoría de creación no
--    existe en esta tabla y no se inventa aquí.
--
-- 3. NINGÚN `deleted_at` ni borrado físico. Cancelar ≠ borrar: la bitácora
--    referencia el pedido con `on delete restrict`, el pedido puede tener líneas
--    de dinero, y el `tracking_token` ya se compartió con el destinatario — la
--    página /tracking/[token] tiene que poder decir "Cancelado".
--
-- 4. NINGÚN índice nuevo. No hay consulta que filtre por estas columnas: quien
--    busca cancelados filtra por `estado = 'cancelado'`, que ya tiene
--    idx_pedidos_tenant_estado. Un índice sin lector es coste de escritura en la
--    tabla más caliente del sistema.
--
-- IDEMPOTENTE: `add column if not exists` + `create or replace view` + `grant`
-- (declarativo). Re-aplicable sobre una base ya migrada tantas veces como se
-- quiera.
-- =============================================================================

-- =============================================================================
-- 1. Las tres columnas
--    Nullable las tres, y sin CHECK que las ate entre sí: un pedido cancelado
--    por el sistema (ML reporta la cancelación) puede no tener usuario, y la
--    coherencia "si hay fecha hay motivo" la impone `cancelarPedido` en backend,
--    donde el motivo es obligatorio y >= 10 caracteres. Un CHECK aquí rompería
--    la sincronización de estados de ML, que escribe `cancelado` sin pasar por
--    la acción humana.
-- =============================================================================
alter table operacion.pedidos
  add column if not exists cancelado_en             timestamptz,
  add column if not exists cancelado_por_usuario_id uuid references auth.users (id),
  add column if not exists motivo_cancelacion       text;

comment on column operacion.pedidos.cancelado_en is
  'Momento en que el pedido pasó a estado `cancelado`. NULL mientras no lo esté.
   Proyección operativa: el registro legal del acto vive en
   identidad.bitacora_auditoria (acción pedido.cancelado). No confundir con
   actualizado_en, que se mueve con cualquier UPDATE. Lo escribe backend
   (cancelarPedido) con service_role; la BD no lo rellena por trigger a
   propósito, porque la cancelación por sincronización de ML entra por otro
   camino y no siempre tiene autor.';

comment on column operacion.pedidos.cancelado_por_usuario_id is
  'UUID de auth.users que canceló el pedido — el "quién" que exige RNF-04. NULL
   cuando la cancelación no la hizo una persona (sincronización de Mercado Libre)
   o cuando el pedido no está cancelado. Puede ser un interno del courier o el
   usuario del seller: el rol NO se deduce de aquí, va en la bitácora
   (detalle.ejecutor). Es un identificador OPACO para seller y conductor: ni
   auth.users ni las filas de otros usuarios en identidad.usuarios_perfil les son
   legibles (usuarios_perfil_select solo deja ver la fila propia a quien no es
   interno), así que ver el UUID no les revela nombre ni correo de nadie.';

comment on column operacion.pedidos.motivo_cancelacion is
  '⚠️ VISIBLE PARA EL SELLER. Decisión consciente de transparencia
   (docs/arquitectura/edicion-y-cancelacion-de-pedidos.md §6.2), no un descuido:
   public.pedidos es `select *` y la política pedidos_select (P2) deja al seller
   leer TODAS las columnas de SUS propias filas; el conductor lo mismo con las
   asignadas a él (P3). Es decir: el motivo que escriba un interno del courier lo
   leerá el seller dueño del pedido. Quien redacte aquí debe saberlo — nada de
   información comercial reservada, y el placeholder del formulario tiene que
   decirlo (trabajo de copywriter). Texto libre; la obligatoriedad y el mínimo de
   10 caracteres los impone backend, no la BD, porque la cancelación que llega
   por sincronización de ML no trae motivo humano.';

-- =============================================================================
-- 2. Re-emitir la vista public.pedidos para que herede las columnas nuevas.
--    Es `select *`, pero una vista NO se actualiza sola cuando cambia la tabla
--    base: sin este `create or replace`, PostgREST seguiría sirviendo la lista
--    de columnas congelada en la última emisión. Mismo patrón que 20260702000001
--    (codigo_interno) y 20260630000001 (ml_user_id).
--    security_invoker = true se conserva: sin él la vista sería un bypass de RLS
--    (la evaluaría el dueño, postgres, que tiene rolbypassrls).
-- =============================================================================
create or replace view public.pedidos
  with (security_invoker = true)
  as select * from operacion.pedidos;

comment on view public.pedidos is
  'Espejo de operacion.pedidos para PostgREST. RLS heredada de la tabla base
   (security_invoker = true): P1 tenant + P2 seller + P3 conductor. Incluye las
   columnas de cancelación (cancelado_en, cancelado_por_usuario_id,
   motivo_cancelacion) heredando esas mismas políticas — el seller ve las de SUS
   pedidos, el conductor las de los asignados a él, y motivo_cancelacion es
   visible para el seller a propósito (§6.2).';

-- =============================================================================
-- 3. Grants — se RE-AFIRMAN los existentes porque la vista se re-emitió.
--
--    ⚠️ EL GOTCHA DEL REPO, Y EL VEREDICTO DE ESTA MIGRACIÓN
--    ---------------------------------------------------------------------
--    "Un GRANT de tabla completa filtra las columnas nuevas" ya mordió dos veces
--    aquí (dinero.lineas_*.snapshot_regla → 20260707000002; el token de
--    invitación → 20260807000001). El patrón: `grant select on tabla` cubre
--    TODA columna presente y futura, y la vista public.* NO es una barrera —
--    config.toml expone `operacion` directamente por PostgREST, así que un
--    cliente autenticado puede pedir la tabla base con `Accept-Profile:
--    operacion` y saltarse la vista.
--
--    Aquí el grant ES de tabla completa (verificado contra la base local:
--    authenticated tiene SELECT/INSERT/UPDATE sobre operacion.pedidos sin
--    ninguna restricción de columna). Por tanto las tres columnas nuevas quedan
--    LEGIBLES para `authenticated` — y eso es CORRECTO, no una fuga, porque
--    public.pedidos es `select *`: las tres ya iban a ser visibles por la vista
--    de todos modos. No hay nada que la vista oculte y el grant delate; el
--    caso de snapshot_regla (vista restringida + grant ancho) no se reproduce.
--
--    Alcance real, columna por columna:
--      · motivo_cancelacion       → visible al seller dueño. INTENCIONAL (§6.2).
--      · cancelado_en             → visible al seller dueño. Hecho operativo de
--                                   su propio pedido, sin sensibilidad.
--      · cancelado_por_usuario_id → visible al seller dueño, pero OPACO: no
--                                   tiene con qué resolver el UUID (auth.users
--                                   no está expuesto ni tiene grants, y
--                                   usuarios_perfil solo le deja ver su fila).
--    En los tres casos la RLS de FILA (P1+P2/P3) sigue mandando: nadie ve la
--    columna de una fila que no le corresponde. Lo prueba
--    supabase/tests/database/rls_pedidos_cancelacion.test.sql.
--
--    Por eso NO se hace `revoke select` + `grant select (col, …)`: restringir por
--    columna aquí no ganaría confidencialidad (la vista las expone igual) y
--    congelaría la lista de columnas de la tabla más viva del sistema — cada
--    columna futura habría que acordarse de agregarla al grant o se rompería en
--    silencio.
--
--    Lo que este veredicto NO tapa, y va como hallazgo a seguridad-cumplimiento
--    (preexistente, no lo introduce esta feature): el mismo grant de tabla
--    completa da UPDATE a `authenticated` sobre todas las columnas, así que un
--    usuario INTERNO puede escribir `cancelado_en`/`motivo_cancelacion` —igual
--    que hoy puede escribir `estado` o `monto_cobro_clp`— por PostgREST directo,
--    sin pasar por cancelarPedido y sin bitácora. La barrera contra seller y
--    conductor sí es sólida (política pedidos_update_interno + trigger
--    trg_pedidos_solo_interno_edita, que lanza 42501); la de los internos entre
--    sí es RBAC de aplicación, no de BD. Es la postura vigente del proyecto para
--    esta tabla; cambiarla es una decisión aparte, no un efecto colateral de tres
--    columnas.
-- =============================================================================
grant select, insert, update on operacion.pedidos to authenticated;
grant select, insert, update on public.pedidos    to authenticated;

grant select, insert, update, delete on operacion.pedidos to service_role;
grant select, insert, update, delete on public.pedidos    to service_role;

-- =============================================================================
-- 4. Verificación defensiva: las barreras de las que depende esta feature
--    siguen en pie. No se altera nada: se inspecciona y se aborta con un error
--    legible si falta algo. (Mismo patrón que 20260811000002 §3–§4.)
--
--    Por qué aquí: §4.2 sustituye la política de UPDATE del seller por "leer con
--    el cliente de la sesión y escribir con service_role". Ese diseño se apoya
--    en dos objetos concretos. Si alguien los borra "limpiando", la feature deja
--    de tener aislamiento y nada avisaría hasta la auditoría.
-- =============================================================================
do $$
begin
  -- 4.1 La política de SELECT (P1+P2+P3) es LA que impone el aislamiento aquí.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'operacion' and tablename = 'pedidos'
      and policyname = 'pedidos_select'
  ) then
    raise exception
      'Falta la política pedidos_select en operacion.pedidos: es la que impone P1 (tenant) + P2 (seller) + P3 (conductor). Sin ella, motivo_cancelacion sería legible fuera de su alcance.';
  end if;

  -- 4.2 El guard por sentencia: convierte el "UPDATE 0" silencioso de un seller
  --     o un conductor en un 42501 explícito y auditable, ANTES de que RLS
  --     filtre filas.
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'operacion' and c.relname = 'pedidos'
      and t.tgname = 'trg_pedidos_solo_interno_edita'
      and not t.tgisinternal
  ) then
    raise exception
      'Falta el trigger trg_pedidos_solo_interno_edita en operacion.pedidos: es el guard que rechaza con 42501 el UPDATE de un seller/conductor. Esta migración agrega columnas a una tabla que ambos LEEN; sin el guard, la escritura quedaría en un UPDATE 0 silencioso.';
  end if;

  -- 4.3 RLS activa y FORZADA (force cubre también al dueño de la tabla).
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'operacion' and c.relname = 'pedidos'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception
      'operacion.pedidos no tiene RLS enable + force. Las tres columnas de cancelación viajan en la misma fila que el destinatario; sin RLS forzada no hay aislamiento que valga.';
  end if;
end $$;

-- =============================================================================
-- 5. Handoff (NO se implementa aquí — solo se documenta)
--
--    `backend`
--      · Pedido/filaAPedido: canceladoEn, canceladoPorUsuarioId, motivoCancelacion.
--      · cancelarPedido escribe las tres en el MISMO UPDATE que mueve el estado
--        a 'cancelado', con service_role, y con `estado` esperado + tenant_id (y
--        seller_id si el ejecutor es 'seller') en el WHERE. Bitácora ANTES.
--      · La coherencia (motivo obligatorio >= 10 caracteres) es suya: la BD no la
--        impone, ver §1 de esta migración.
--
--    `copywriter`
--      · El placeholder del campo motivo debe decir que el seller lo lee (§6.2).
--
--    `seguridad-cumplimiento`
--      · Revisar la visibilidad de motivo_cancelacion para el seller (§6.2), y el
--        hallazgo preexistente y separado de §3 de esta migración: notas_internas
--        también es legible hoy por seller y conductor vía public.pedidos.
-- =============================================================================
