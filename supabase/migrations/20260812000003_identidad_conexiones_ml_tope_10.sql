-- =============================================================================
-- identidad.conexiones_seller_ml — el tope de cuentas ML por seller sube de 3 a 10
-- =============================================================================
-- DECISIÓN DEL USUARIO (2026-08-12), registrada en CLAUDE.md §Alcance
-- (retiro en bodega + ruteo, bloqueador 2) y en docs/arquitectura/retiro-y-ruteo.md.
--
-- POR QUÉ CAMBIA: la realidad desmintió el 3. En la reunión con un courier real
-- apareció un seller con **4 cuentas de Mercado Libre** vinculadas, es decir una
-- cuenta que ya opera y que el tope de D5 (docs/arquitectura/seller-multicuenta-ml.md
-- §7-D5) dejaba fuera del sistema: sin poder conectarla, sus envíos Flex no se
-- ingestan y no llegan ni a la asignación ni al motor entrega→dinero. El 3 nunca
-- fue un límite técnico ni de plan — era una cota prudente puesta a ciegas. Sube
-- a 10, que es holgura sobre el peor caso observado sin volverse "sin límite"
-- (cada conexión son tokens que refrescar y un job más por ciclo del pipeline).
--
-- ALCANCE: SOLO la constante escalar. NO se tocan el trigger
-- `trg_conexiones_seller_ml_imponer_tope` ni su función
-- `identidad.conexiones_seller_ml_imponer_tope()`: esa función lee el tope en
-- cada INSERT (`tope int := identidad.conexiones_seller_ml_tope_por_seller()`),
-- así que reemplazar la constante basta y el `pg_advisory_xact_lock` que
-- serializa los INSERT concurrentes del mismo seller sigue intacto, igual que el
-- errcode `check_violation` (23514) que `src/modules/integraciones/ml/puerto.ts`
-- traduce a `ErrorTopeCuentasMlAlcanzado`.
--
-- AISLAMIENTO / RLS: sin cambios, y no los necesita. Subir el tope agrega filas
-- del MISMO seller dentro del MISMO tenant; las políticas de la migración 0004
-- son por-fila (`tenant_id = claim_tenant_id() and (interno or (seller and
-- seller_id = claim_seller_id()))`), de modo que un seller ve las suyas y solo
-- las suyas, sean 1, 4 o 10, y ninguna de otro seller ni de otro tenant. Tampoco
-- cambian la unicidad parcial `(seller_id, ml_user_id) where ml_user_id is not
-- null`, los grants ni la vista `public.conexiones_seller_ml`.
--
-- MIGRACIÓN DE DATOS: NULA. Se sube un máximo; ninguna fila existente lo viola.
-- Ojo para el futuro: bajar el tope NO es simétrico. El trigger es BEFORE INSERT,
-- así que un seller que ya esté por sobre un tope menor quedaría en infracción
-- silenciosa (nadie lo detecta hasta el siguiente INSERT). Bajarlo exigiría una
-- limpieza explícita, no solo cambiar este número.
--
-- IDEMPOTENTE: `create or replace function` y `comment on` son re-ejecutables sin
-- efecto acumulativo. La aserción del final falla ruidosamente si el reemplazo no
-- tomó efecto, en vez de dejar el tope viejo en pie sin avisar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La constante: 3 → 10.
--    `create or replace` conserva dueño y ACL de la función (no hay que
--    re-otorgar nada). Se re-declara `language sql immutable` completo a
--    propósito: `create or replace function` reemplaza la definición entera, así
--    que omitir la volatilidad la devolvería al default `volatile`.
-- -----------------------------------------------------------------------------
create or replace function identidad.conexiones_seller_ml_tope_por_seller() returns int
  language sql immutable
  as $$ select 10 $$;

comment on function identidad.conexiones_seller_ml_tope_por_seller() is
  'Tope de cuentas ML por seller (D5). Vale 10 desde 2026-08-12: era 3 y un '
  'courier real trajo un seller con 4 cuentas vinculadas, así que el tope '
  'anterior dejaba fuera del sistema operación que ya existía. Constante hoy; '
  'candidata a parametrizarse por plan más adelante. Cambiar aquí para '
  'subir/bajar el máximo — el trigger trg_conexiones_seller_ml_imponer_tope la '
  'lee en cada INSERT. Bajarla no basta por sí sola: el trigger es BEFORE '
  'INSERT y no revisa los sellers que ya estén por encima.';

-- -----------------------------------------------------------------------------
-- 2. Comentario de la tabla: decía "hasta 3 cuentas por seller" (20260630000002
--    §3) y quedaría mintiendo. `comment on` REEMPLAZA el texto completo, no
--    anexa, así que se re-emite entero con el resto del contenido intacto.
-- -----------------------------------------------------------------------------
comment on table identidad.conexiones_seller_ml is
  'Conexiones OAuth del seller con Mercado Libre (1:N — hasta 10 cuentas por '
  'seller desde 2026-08-12, antes 3; ver identidad.conexiones_seller_ml_tope_por_seller '
  'y el trigger de tope). Cada fila = una cuenta ML. tenant_id denormalizado a '
  'propósito para que la política de capa-tenant del seller no dependa de un '
  'join. Tokens cifrados en secretos_cifrados — aquí solo referencias opacas. '
  'Escritura de tokens/salud: solo jobs/service_role; el seller únicamente '
  'inicia reconexión vía acción de servidor (no edita la fila directo).';

-- -----------------------------------------------------------------------------
-- 3. Aserción: que la migración no pueda "pasar" dejando el tope viejo.
-- -----------------------------------------------------------------------------
do $$
declare
  tope int := identidad.conexiones_seller_ml_tope_por_seller();
begin
  if tope <> 10 then
    raise exception
      'identidad.conexiones_seller_ml_tope_por_seller() quedó en % y debía quedar en 10',
      tope;
  end if;
end $$;
