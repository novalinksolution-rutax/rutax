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

select plan(4);

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
     -- Dónde VIVE el conductor (punto de término de su ruta). Dato personal del
     -- trabajador bajo la Ley 21.431, con consentimiento como única base de
     -- licitud. Se nombra aquí porque su RLS es la más restrictiva del repo —
     -- solo el propio conductor, sin rama interno ni super_admin— y porque un
     -- `force` que se pierda no produce ningún síntoma visible.
     -- Ver docs/seguridad/punto-de-termino-conductor.md §6.3, aserción 8.
     'operacion.punto_termino_conductor',
     'dinero.lineas_cobro',
     'dinero.lineas_liquidacion',
     'dinero.documentos_dte',
     'dinero.pagos_recibidos',
     'dinero.payouts_conductor'
   )
$$, $$ values (true) $$,
  'Tablas críticas (secretos y dinero) con RLS enable + force'
);

-- ---------------------------------------------------------------------------
-- Test 4 · 🔴 La suposición del Test 1, convertida en aserción.
--
-- Arriba se lee: «`public` se excluye a propósito: ahí solo viven vistas
-- security_invoker, que heredan la RLS de la tabla base». Eso era una CREENCIA,
-- no una comprobación — y se rompió el 26-08-2026.
--
-- `public.conductores` perdió la opción al reponerla para agregarle una columna:
-- `create or replace view` conserva los GRANT pero **reemplaza las opciones**, y
-- quien la repuso no repitió el `WITH`. Sin `security_invoker` la vista corre con
-- los privilegios de su dueño, la RLS de la tabla base deja de aplicarse, y la
-- aplicación consulta SIEMPRE por la vista: un courier leía la nómina de otro.
--
-- No dio ningún síntoma. Con un solo tenant en la base el resultado es idéntico
-- al correcto; el fallo aparece recién cuando existe un segundo courier, que es
-- cuando ya es tarde. Por eso la red va acá, en el momento de migrar.
--
-- Se afirma sobre TODAS las vistas de `public` menos tres nombradas, y NO sobre
-- una lista blanca: una vista espejo nueva a la que se le olvide el `WITH` tiene
-- que caer acá. Las tres excepciones, con su motivo:
--
--  · `pg_all_foreign_keys` y `tap_funky` — no son nuestras. Las instala la
--    extensión pgTAP en `public`, y solo existen donde corren estas pruebas.
--
--  · `pruebas_entrega_seller` — su aislamiento NO vive en la RLS de una tabla
--    base: es una vista sobre `operacion.pruebas_entrega_del_seller()`, una
--    función SECURITY DEFINER que filtra ella misma por
--    `claim_tipo_usuario() = 'seller'`, `claim_tenant_id()` y
--    `claim_seller_id()`. Ahí `security_invoker` no es el mecanismo, y exigirlo
--    sería pedir lo que no aplica. Verificado leyendo el cuerpo de la función,
--    no suponiéndolo.
-- ---------------------------------------------------------------------------
select is_empty(
  $$
  select n.nspname || '.' || c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'v'
     and c.relname not in ('pg_all_foreign_keys', 'tap_funky', 'pruebas_entrega_seller')
     and coalesce(array_to_string(c.reloptions, ','), '')
         not like '%security_invoker=true%'
  $$,
  'Toda vista de public tiene security_invoker=true (sin él NO aplica la RLS de quien consulta)'
);

select * from finish();

rollback;
