-- =============================================================================
-- identidad.conexiones_seller_ml — de 1:1 a 1:N (seller ↔ hasta 3 cuentas ML)
-- =============================================================================
-- Diseño aprobado: docs/arquitectura/seller-multicuenta-ml.md (§1 esquema, §3 RLS,
-- §7 decisiones D2/D5). Un `seller` puede conectar hasta 3 cuentas de Mercado
-- Libre; cada conexión es una fila (los tokens/salud/estado ya eran por-fila).
--
-- SOLO CAPA DE DATOS. Esta migración suelta `unique(seller_id)`, con lo que
-- ROMPE el `upsert onConflict: "seller_id"` de `persistirTokensYActualizarConexion`
-- en integraciones (puerto.ts). NO aplicar en entornos compartidos hasta que
-- `integraciones` publique el fix de código acoplado (§7-D4 del diseño).
--
-- Idempotente: `drop ... if exists`, `create ... if not exists`,
-- `create or replace`, `add column if not exists`.
--
-- Migración de datos: NULA. Cada fila 1:1 existente es válida como la PRIMERA
-- conexión del seller. Solo se sueltan constraints y se agregan columnas/índices.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Soltar el 1:1 (constraint de columna auto-nombrada + índice único explícito)
--    y crear un índice NO único en seller_id para los lookups del pipeline.
-- -----------------------------------------------------------------------------
-- La constraint de columna `seller_id ... unique` genera una UNIQUE constraint
-- con nombre por defecto `conexiones_seller_ml_seller_id_key`. `drop constraint
-- if exists` la suelta de forma idempotente (y su índice de respaldo con ella).
alter table identidad.conexiones_seller_ml
  drop constraint if exists conexiones_seller_ml_seller_id_key;

-- Índice único explícito adicional creado en 0004:187.
drop index if exists identidad.conexiones_seller_ml_seller_id_uk;

-- Índice NO único: el pipeline agrupa/consulta conexiones por seller
-- (procesar-shipment, polling, portal). Reemplaza al único borrado arriba.
create index if not exists conexiones_seller_ml_seller_id_idx
  on identidad.conexiones_seller_ml (seller_id);

-- -----------------------------------------------------------------------------
-- 2. Unicidad PARCIAL (D2): una misma cuenta ML no se repite dentro del mismo
--    seller, pero:
--      - se permiten filas "pendientes" sin ml_user_id (durante el OAuth), y
--      - se permite la MISMA cuenta ML en sellers/tenants distintos (el
--        pipeline ya lo contempla — NO unicidad global de ml_user_id).
-- -----------------------------------------------------------------------------
create unique index if not exists conexiones_seller_ml_seller_cuenta_uk
  on identidad.conexiones_seller_ml (seller_id, ml_user_id)
  where ml_user_id is not null;

-- -----------------------------------------------------------------------------
-- 3. Columnas de display por conexión (nombrar/identificar la cuenta en la UI).
--    `alias`      — lo nombra el interno (rótulo humano, p. ej. "Tienda oficial").
--    `ml_nickname`— nickname capturado de ML al conectar.
--    Ambas nullable; no son secretos (no van a secretos_cifrados).
-- -----------------------------------------------------------------------------
alter table identidad.conexiones_seller_ml
  add column if not exists alias       text,
  add column if not exists ml_nickname text;

comment on column identidad.conexiones_seller_ml.alias is
  'Rótulo humano que el interno asigna a la conexión (p. ej. "Tienda oficial"). '
  'Nullable. NO es secreto.';
comment on column identidad.conexiones_seller_ml.ml_nickname is
  'Nickname de la cuenta capturado desde Mercado Libre al conectar. Nullable. '
  'NO es secreto.';

-- Comentario de tabla actualizado (ya no es 1:1).
comment on table identidad.conexiones_seller_ml is
  'Conexiones OAuth del seller con Mercado Libre (1:N — hasta 3 cuentas por '
  'seller, ver trigger de tope). Cada fila = una cuenta ML. tenant_id '
  'denormalizado a propósito para que la política de capa-tenant del seller no '
  'dependa de un join. Tokens cifrados en secretos_cifrados — aquí solo '
  'referencias opacas. Escritura de tokens/salud: solo jobs/service_role; el '
  'seller únicamente inicia reconexión vía acción de servidor (no edita la fila '
  'directo).';

-- -----------------------------------------------------------------------------
-- 4. Tope de 3 conexiones por seller (D5).
--    CHECK no puede contar filas → trigger BEFORE INSERT. El "3" vive en una
--    constante SQL escalar fácil de cambiar (o mover a límite por plan luego).
--
--    Concurrencia: pg_advisory_xact_lock(hashtext(seller_id)) serializa los
--    INSERT concurrentes del MISMO seller (el lock se libera al fin de la
--    transacción). Costo despreciable — el alta de una cuenta es una acción
--    manual del interno, no un camino caliente — y elimina la carrera de dos
--    inserciones simultáneas que verían count()=2 y ambas pasarían a 4.
-- -----------------------------------------------------------------------------
create or replace function identidad.conexiones_seller_ml_tope_por_seller() returns int
  language sql immutable
  as $$ select 3 $$;

comment on function identidad.conexiones_seller_ml_tope_por_seller() is
  'Tope de cuentas ML por seller (D5). Constante hoy; candidata a parametrizarse '
  'por plan más adelante. Cambiar aquí para subir/bajar el máximo.';

create or replace function identidad.conexiones_seller_ml_imponer_tope()
returns trigger
language plpgsql
as $$
declare
  n_actual int;
  tope     int := identidad.conexiones_seller_ml_tope_por_seller();
begin
  -- Serializa inserciones concurrentes del mismo seller dentro de la tx.
  perform pg_advisory_xact_lock(hashtext(new.seller_id::text));

  select count(*) into n_actual
  from identidad.conexiones_seller_ml
  where seller_id = new.seller_id;

  if n_actual >= tope then
    raise exception
      'el seller % ya tiene el máximo de % conexiones ML permitidas',
      new.seller_id, tope
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_conexiones_seller_ml_imponer_tope on identidad.conexiones_seller_ml;
create trigger trg_conexiones_seller_ml_imponer_tope
  before insert on identidad.conexiones_seller_ml
  for each row execute function identidad.conexiones_seller_ml_imponer_tope();

-- -----------------------------------------------------------------------------
-- 5. Re-emitir la vista public.conexiones_seller_ml para heredar alias/ml_nickname.
--    `create or replace view` no permite cambiar la lista de columnas de un
--    `select *` materializado en el catálogo → se DROP + CREATE.
--    security_invoker = true: la vista aplica la RLS del usuario que consulta,
--    no la del creador. Se re-crea sin cambios de política (ver bloque 6).
-- -----------------------------------------------------------------------------
drop view if exists public.conexiones_seller_ml;
create view public.conexiones_seller_ml
  with (security_invoker = true)
  as select * from identidad.conexiones_seller_ml;

-- IMPORTANTE: `drop view` + `create view` REINICIA el ACL de la vista, así que
-- hay que RE-OTORGAR los grants que dio 0004 (si no, PostgREST/`authenticated`
-- recibe "permission denied for view conexiones_seller_ml" — rompe portal y
-- dashboard). El grant de la tabla base `identidad.conexiones_seller_ml`
-- persiste (la tabla no se dropeó); solo se re-emite el de la vista.
grant select, insert, update on public.conexiones_seller_ml to authenticated;

-- -----------------------------------------------------------------------------
-- 6. RLS — SIN cambios estructurales. Confirmado y documentado.
--
--    Las políticas de 0004:242-293 ya escalan a N filas por seller:
--      - SELECT: `tenant_id = claim_tenant_id() AND (interno OR (seller AND
--        seller_id = claim_seller_id()))`. El predicado por seller es por-fila,
--        de modo que un seller con 3 conexiones ve LAS 3 y solo las 3; un seller
--        de otro tenant/otro seller ve 0. No hay supuesto de "una fila".
--      - INSERT/UPDATE: `interno`-only (+ trigger `solo_interno_edita`); el alta
--        de una cuenta adicional es acción de interno/server action, no
--        self-insert del seller. El tope 3 y la unicidad parcial actúan bajo
--        estas mismas reglas.
--    Por eso esta migración NO redefine ninguna policy: reproducirlas sería
--    ruido y arriesgaría divergencia. Se dejan tal cual las creó 0004.
-- -----------------------------------------------------------------------------
-- (sin DDL de RLS aquí a propósito — ver comentario)
