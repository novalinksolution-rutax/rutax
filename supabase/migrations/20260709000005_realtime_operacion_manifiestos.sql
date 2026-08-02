-- =============================================================================
-- Realtime — señal de cambios en operacion.manifiestos
-- =============================================================================
-- Agrega `operacion.manifiestos` a la publicación `supabase_realtime` para que
-- el listado de manifiestos se actualice EN VIVO ante altas y cambios de estado
-- (borrador → confirmado → en_ruta → completado), sin recargar a mano.
--
-- Mismo modelo señal-only que pedidos/incidencias (ver 20260709000003/4): el
-- cliente refetch-ea en el servidor vía service-role, no lee el payload; la RLS
-- de manifiestos (P1 tenant + P3 conductor) filtra los eventos por tenant y el
-- grant SELECT a `authenticated` ya existe (operacion_base). Solo INSERT/UPDATE;
-- sin REPLICA IDENTITY FULL → costo de WAL nulo. Idempotente.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'operacion'
        and tablename = 'manifiestos'
    ) then
      alter publication supabase_realtime add table operacion.manifiestos;
    end if;
  end if;
end $$;
