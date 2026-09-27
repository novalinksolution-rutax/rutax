-- =============================================================================
-- Operación — `anon` pierde el privilegio sobre pedidos (defensa en profundidad)
-- =============================================================================
-- POR QUÉ, y por qué va en una migración propia.
--
-- `20260816000004` §8.9 afirma que `anon` (la sesión NO autenticada) no tiene
-- SELECT sobre las columnas de `public.pedidos`. Cuando se escribió, eso se daba
-- por sentado. No lo era: Supabase trae
--
--     alter default privileges in schema public
--       grant all on tables to anon, authenticated, service_role;
--
-- así que TODA vista creada en `public` nace con el grant puesto. La afirmación
-- no describía una barrera, describía una creencia sobre los defaults del stack
-- local — y el stack se movió (el CI corre `supabase/setup-cli@v1` con
-- `version: latest`). Desde entonces esa migración ABORTA al aplicarse en una
-- base nueva, y con ella se cae el job entero de pgTAP: las pruebas de
-- aislamiento RLS llevaban semanas sin correr.
--
-- `20260816000004` ya lleva el `revoke` explícito, y eso arregla toda base que
-- se construya desde cero. Pero una base YA migrada —producción— no la vuelve a
-- ejecutar nunca, así que el privilegio seguiría ahí. Para eso existe este
-- archivo: es el mismo `revoke`, por la vía que sí alcanza a lo ya desplegado.
--
-- ⚠️ ESTO NO CIERRA UNA FUGA, y conviene decirlo con precisión para que nadie lo
-- lea como un parche de seguridad urgente. `operacion.pedidos` tiene RLS enable +
-- force y `anon` no tiene una sola política: una sesión anónima leía CERO filas,
-- grant o no grant. La barrera de confidencialidad es la RLS DE FILA. Lo que se
-- gana acá es que esa barrera deje de depender de que nadie escriba nunca, por
-- descuido, una política permisiva para `anon`.
--
-- Se revoca de las DOS superficies, no solo de la vista: `config.toml` expone el
-- esquema `operacion` directo por PostgREST (`Accept-Profile: operacion`), así
-- que quitarlo solo de `public.pedidos` dejaría la tabla base alcanzable — el
-- mismo patrón inverso que ya mordió dos veces (el snapshot de regla en
-- `dinero.lineas_*` y el token de invitación).
--
-- Idempotente: `revoke` sobre un privilegio que no está es un no-op silencioso.
-- =============================================================================

revoke all on public.pedidos    from anon;
revoke all on operacion.pedidos from anon;

-- -----------------------------------------------------------------------------
-- Verificación defensiva — mismo patrón que el §8 de 20260816000004: si el
-- revoke no tomó efecto, que falle acá con un mensaje legible y no más tarde,
-- en una prueba de aislamiento, con un mensaje que no dice qué pasó.
-- -----------------------------------------------------------------------------
do $$
begin
  if (
    select bool_or(has_column_privilege('anon', 'public.pedidos', col, 'SELECT'))
      from unnest(array['fuente', 'id_externo', 'referencia_externa']) as col
  ) then
    raise exception
      'anon conserva SELECT sobre public.pedidos tras el revoke. Revisa si algo volvió a otorgarlo (p. ej. un `grant ... to anon` posterior o un default privilege del esquema).';
  end if;

  if (
    select bool_or(has_column_privilege('anon', 'operacion.pedidos', col, 'SELECT'))
      from unnest(array['fuente', 'id_externo', 'referencia_externa']) as col
  ) then
    raise exception
      'anon conserva SELECT sobre operacion.pedidos tras el revoke. Esa es la superficie que PostgREST expone con Accept-Profile: operacion.';
  end if;
end $$;

-- PostgREST cachea privilegios junto con el esquema: sin esto seguiría creyendo
-- que `anon` puede leer la tabla hasta el próximo reinicio.
notify pgrst, 'reload schema';
