-- =============================================================================
-- Shopify entra como fuente · PARTE 1 de 2 — SOLO VALORES DE ENUM
-- =============================================================================
-- ⚠️ POR QUÉ ESTE ARCHIVO EXISTE POR SEPARADO, Y NO SE PUEDE FUSIONAR CON EL
--    SIGUIENTE (20260816000004_operacion_pedido_fuente.sql)
--
-- Postgres NO permite USAR un valor de enum dentro de la misma transacción que
-- lo agregó o que creó el tipo. Desde PG 12 `alter type ... add value` sí corre
-- dentro de una transacción, pero el valor recién agregado queda invisible hasta
-- el COMMIT; cualquier `insert`, `update`, comparación o `default` que lo
-- mencione muere con:
--
--     55P04: unsafe use of new value "..." of enum type ...
--
-- Y el Supabase CLI envuelve CADA ARCHIVO de migración en su propia transacción.
-- Por lo tanto: la única forma de crear el tipo `operacion.fuente_pedido` y en
-- seguida hacer el backfill de `operacion.pedidos.fuente` es que sean DOS
-- archivos. Este declara los valores; el siguiente los usa.
--
-- NO fusionar estos dos archivos "para dejar una sola migración". Falla en el
-- momento de aplicar, no al escribir, y falla igual en local que en producción.
--
-- =============================================================================
-- QUÉ SE DECIDIÓ (decisión de arquitectura, 2026-08-16)
-- =============================================================================
-- La procedencia de un pedido pasa a tener columna propia: `fuente`.
--
-- Hasta hoy el eje de procedencia REAL del sistema era `tipo_pedido`
-- ('flex' | 'same_day'), sobrecargado con tres significados a la vez:
--   1. de dónde viene el pedido (Mercado Libre vs. creado en Rutax),
--   2. quién es dueño del POD (la app de Mercado Envíos vs. Rutax),
--   3. qué clave de tarifa aplica.
--
-- Con Shopify los tres dejan de coincidir: un pedido Shopify NO viene de ML,
-- su POD SÍ es autoritativo en Rutax, y su régimen operativo/tarifario es el
-- mismo del same-day. Un cuarto valor en `tipo_pedido` habría roto las tres
-- lecturas a la vez. Por eso:
--
--   · `fuente`      → DE DÓNDE VIENE. Eje autoritativo de procedencia.
--   · `tipo_pedido` → RÉGIMEN OPERATIVO Y CLAVE DE TARIFA, y nada más.
--
-- Un pedido Shopify nace con `tipo_pedido = 'same_day'` y `fuente = 'shopify'`.
--
-- =============================================================================
-- ⚠️ SOBRE `operacion.origen` — QUEDA COMO COLUMNA HEREDADA
-- =============================================================================
-- `operacion.pedidos.origen` (tipo `operacion.origen_pedido`) NO es el eje de
-- procedencia y no pasa a serlo. La exploración previa a este cambio lo dejó
-- demostrado: la columna SE ESCRIBE en toda la ingesta pero NUNCA SE COMPARA en
-- el código — no hay una sola rama de negocio que dependa de su valor.
--
-- Lo que `origen` significa, y lo único que seguirá significando, es el MODO DE
-- DESCUBRIMIENTO: por qué camino técnico entró esa fila al sistema
-- ('ml_ingesta' = barrido/webhook en línea, 'backfill' = recuperación tras
-- reconexión, 'same_day_manual' = lo tecleó un interno). Es telemetría de
-- ingesta, útil para depurar, y por eso se conserva.
--
-- DE AQUÍ EN ADELANTE:
--   · toda pregunta de negocio del tipo "¿de dónde viene este pedido?" se
--     responde con `fuente`, NUNCA con `origen`;
--   · `origen` no se lee para decidir tarifas, POD, cobros ni pantallas.
-- Si alguna vez alguien necesita ramificar por `origen`, eso es una decisión
-- nueva y hay que discutirla, no un atajo.
--
-- Se le agrega igual el valor 'shopify_ingesta' para que la telemetría siga
-- diciendo la verdad sobre el camino de entrada de la fila.
--
-- =============================================================================
-- ALCANCE: SOLO valores de enum. No crea columnas, no toca tablas, no toca RLS,
-- no toca triggers. Todo eso va en 20260816000004.
-- IDEMPOTENTE: DO-block para el `create type` (no admite `if not exists`) y
-- `add value if not exists` para los dos enums existentes. Re-aplicable.
-- =============================================================================

-- =============================================================================
-- 1. El tipo nuevo: operacion.fuente_pedido
-- =============================================================================
-- Enum nativo y no `text` + CHECK, por el mismo criterio que fijó
-- 20260812000002 §"ENUM NATIVO Y NO text + CHECK": todo eje cerrado de
-- `operacion` es enum nativo, el conjunto es cerrado por decisión de producto,
-- un typo en `text` no falla (devuelve cero filas y una pantalla vacía SIN
-- error) y del lado TypeScript habilita `Record<FuentePedido, …>`, que no
-- compila si a un `switch` le falta un caso.
--
-- Los tres valores de arranque:
--   · ml_flex       → llegó por la API de Mercado Libre (Flex). El POD lo
--                     gobierna la app de Mercado Envíos: NO es autoritativo en
--                     Rutax (restricción dura del producto).
--   · rutax_manual  → lo creó un interno del courier en Rutax (same-day ad-hoc).
--                     El POD capturado en Rutax ES el autoritativo.
--   · shopify       → llegó por la API de Shopify. El POD capturado en Rutax ES
--                     el autoritativo (no hay app externa obligatoria).
--
-- `create type` NO admite `if not exists`: por eso el DO-block. Mismo patrón que
-- 20260812000002 §1.
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'fuente_pedido' and n.nspname = 'operacion'
  ) then
    create type operacion.fuente_pedido as enum (
      'ml_flex',
      'rutax_manual',
      'shopify'
    );
  end if;
end $$;

comment on type operacion.fuente_pedido is
  'DE DÓNDE VIENE el pedido — eje AUTORITATIVO de procedencia desde 2026-08-16.
   Sustituye a `tipo_pedido` en ese rol (que queda significando solo régimen
   operativo y clave de tarifa) y NO se confunde con `origen`, que es telemetría
   del modo de descubrimiento y no se compara en código.
   ml_flex = API de Mercado Libre; el POD lo gobierna la app de Mercado Envíos.
   rutax_manual = lo creó un interno en Rutax; POD autoritativo en Rutax.
   shopify = API de Shopify; POD autoritativo en Rutax.
   Agregar un valor exige migración aparte (alter type add value no se puede
   usar en la misma transacción que lo agrega).';

-- =============================================================================
-- 2. operacion.origen_pedido += 'shopify_ingesta'
-- =============================================================================
-- Telemetría del modo de descubrimiento, NO procedencia (ver el bloque de arriba
-- sobre `origen` como columna heredada). Existe para que un pedido Shopify no
-- tenga que mentir declarándose 'same_day_manual' —que significa "lo tecleó un
-- humano"— cuando en realidad entró por un job.
alter type operacion.origen_pedido add value if not exists 'shopify_ingesta';

-- =============================================================================
-- 3. identidad.tipo_secreto += 'token_admin_shopify'
-- =============================================================================
-- El Admin API access token de Shopify es un SECRETO: da acceso de lectura y
-- escritura al catálogo y a los pedidos de la tienda del seller. Va donde van
-- todos los demás — `identidad.secretos_cifrados`, cifrado, con GRANT solo a
-- service_role y FUERA de las tablas de negocio — y nunca en logs, en texto
-- plano ni en URLs (regla no-negociable del proyecto).
--
-- Este valor NO crea la fila ni el flujo de conexión: solo abre el casillero
-- para que `integraciones` guarde el token donde corresponde en vez de
-- inventarle una columna en una tabla de negocio.
alter type identidad.tipo_secreto add value if not exists 'token_admin_shopify';

-- =============================================================================
-- 4. Handoff — lo que NO hace este archivo
-- =============================================================================
--   · La columna `operacion.pedidos.fuente`, su backfill, el índice de
--     idempotencia por fuente, la vista y el trigger del POD → 20260816000004.
--   · La tabla de conexiones Shopify por seller y su RLS → migración propia,
--     todavía no escrita.
--   · El espejo TypeScript (`FuentePedido`, `podEsAutoritativoEnRutax`) → lo
--     construye la sesión principal; esta migración no toca código.
-- =============================================================================
