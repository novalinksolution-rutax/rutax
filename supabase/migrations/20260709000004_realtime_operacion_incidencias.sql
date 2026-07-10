-- =============================================================================
-- Realtime — señal de cambios en operacion.incidencias
-- =============================================================================
-- Agrega `operacion.incidencias` a la publicación `supabase_realtime` para que
-- el dashboard y la bandeja de incidencias se actualicen EN VIVO ante nuevas
-- incidencias o cambios de estado, sin recargar a mano.
--
-- Mismo modelo que pedidos (ver 20260709000003): Realtime es SOLO una señal
-- (el cliente refetch-ea en el servidor vía service-role, no lee el payload); la
-- RLS de incidencias ya filtra los eventos por tenant, y el grant SELECT a
-- `authenticated` sobre `operacion.incidencias` ya existe (operacion_base). Solo
-- INSERT/UPDATE; sin REPLICA IDENTITY FULL → costo de WAL nulo.
--
-- Idempotente.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'operacion'
        and tablename = 'incidencias'
    ) then
      alter publication supabase_realtime add table operacion.incidencias;
    end if;
  end if;
end $$;
