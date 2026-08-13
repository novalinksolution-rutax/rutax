-- =============================================================================
-- Meta-prueba de cobertura RLS — guardián del aislamiento multi-tenant
-- =============================================================================
-- Falla si CUALQUIER tabla de un schema de negocio queda sin RLS enable+force.
-- Es el control "migraciones/pruebas que fallen cuando una tabla multi-tenant
-- no tenga RLS" de la auditoría (§4.2): convierte el invariante del proyecto
-- "toda tabla de negocio lleva tenant_id y RLS" en una prueba automática que
-- atrapa la tabla NUEVA a la que se le olvidó activar RLS — el modo más común
-- de romper el aislamiento sin darse cuenta.
--
-- A diferencia de las demás pruebas RLS (que verifican políticas concretas por
-- tabla), esta es de COBERTURA: no mira políticas, solo que RLS esté activa y
-- forzada en todas las tablas. Las dos capas se complementan.
--
-- Estado a jun 2026: las 47 tablas de negocio tienen enable+force → verde.
-- Cuando agregues una tabla: o le activas RLS con el patrón enable+force (como
-- el resto), o —si legítimamente NO la necesita (catálogo global sin tenant, o
-- tabla service-role-only con deny-by-default)— la agregas al allowlist del
-- Test 2 CON su justificación.
--
-- Ejecutar: npx supabase test db
-- =============================================================================

begin;

select plan(3);

-- Schemas de negocio cubiertos. `public` se excluye a propósito: ahí solo viven
-- vistas security_invoker (relkind 'v'), que heredan la RLS de la tabla base.
-- Los schemas de Supabase (auth, storage, extensions…) no son nuestros.

-- ---------------------------------------------------------------------------
-- Test 1 · Sanidad: existe un universo real de tablas que auditar.
--   Evita el falso verde de un is_empty sobre cero filas (p. ej. si un schema
--   se renombró y la consulta dejó de ver tablas).
-- ---------------------------------------------------------------------------
select cmp_ok(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('identidad', 'operacion', 'dinero', 'integraciones', 'plataforma', 'infra')
      and c.relkind = 'r'),
  '>=', 40,
  'Hay al menos 40 tablas de negocio en los schemas cubiertos (universo no vacío)'
);

-- ---------------------------------------------------------------------------
-- Test 2 · EL GUARDIÁN: ninguna tabla de negocio sin RLS enable + force.
--   relrowsecurity       = RLS activa para roles normales (authenticated).
--   relforcerowsecurity  = RLS aplica también al dueño de la tabla (defensa en
--   profundidad). El proyecto exige AMBAS en toda tabla de negocio.
--   La consulta devuelve el nombre de cada tabla infractora → si falla, el
--   diagnóstico dice exactamente cuál table quedó sin RLS.
-- ---------------------------------------------------------------------------
select is_empty($$
  select n.nspname || '.' || c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('identidad', 'operacion', 'dinero', 'integraciones', 'plataforma', 'infra')
     and c.relkind = 'r'
     and not (c.relrowsecurity and c.relforcerowsecurity)
     -- Allowlist de excepciones documentadas. VACÍA hoy: toda tabla de negocio
     -- tiene RLS. Para exceptuar una tabla que legítimamente no la necesita,
     -- añade una condición, p. ej.:
     --   and (n.nspname || '.' || c.relname) <> 'schema.tabla'  -- motivo
$$, 'Toda tabla de negocio tiene RLS enable + force (ninguna huérfana de RLS)');

-- ---------------------------------------------------------------------------
-- Test 3 · Guardia nominal sobre las tablas más sensibles (secretos y dinero).
--   Redundante con el Test 2, pero un fallo aquí nombra la tabla crítica sin
--   ambigüedad. bool_and sobre 0 filas = NULL (≠ true) → también atrapa un
--   typo que dejara la lista sin match.
-- ---------------------------------------------------------------------------
select results_eq($$
  select bool_and(c.relrowsecurity and c.relforcerowsecurity)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where (n.nspname || '.' || c.relname) in (
     'identidad.secretos_cifrados',
     -- Deny-all como secretos_cifrados: guarda el string del QR de la etiqueta
     -- (credencial-símil e IRRECUPERABLE — hash_code es una firma de ML que no se
     -- puede recalcular y la etiqueta no se reimprime una vez retirado el bulto).
     -- Alcance §1.7 la nombra explícitamente para este Test 3.
     'operacion.bultos_retiro_qr',
     'dinero.lineas_cobro',
     'dinero.lineas_liquidacion',
     'dinero.documentos_dte',
     'dinero.pagos_recibidos',
     'dinero.payouts_conductor'
   )
$$, $$ values (true) $$,
  'Tablas críticas (secretos y dinero) con RLS enable + force'
);

select * from finish();

rollback;
