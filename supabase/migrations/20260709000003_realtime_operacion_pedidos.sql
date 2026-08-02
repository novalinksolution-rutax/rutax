-- =============================================================================
-- Realtime del tablero de operación — señal de cambios en operacion.pedidos
-- =============================================================================
-- Agrega `operacion.pedidos` a la publicación `supabase_realtime` para que la
-- vista de operación del courier se actualice EN VIVO ante altas y cambios de
-- estado de pedidos, sin recargar la página a mano.
--
-- Modelo (defensa en profundidad — Realtime NO expone datos al cliente):
--   * Realtime se usa solo como SEÑAL: el cliente se suscribe y, ante un cambio,
--     re-ejecuta el Server Component (`router.refresh`), que lee vía
--     service-role en el servidor. El cliente NO lee el payload del evento.
--   * La RLS existente `pedidos_select` (to authenticated, por
--     `identidad.claim_tenant_id()`) ya filtra los eventos de Realtime al tenant
--     del usuario: ningún courier recibe eventos de otro. El grant SELECT a
--     `authenticated` sobre `operacion.pedidos` ya existe (migración
--     operacion_base), requisito para que Realtime evalúe la RLS por suscriptor.
--   * Solo se consumen INSERT/UPDATE. NO se cambia REPLICA IDENTITY: para
--     recibir el registro `new` (altas y cambios de estado) NO se requiere
--     `full` — `full` solo agrega el registro `old` en UPDATE/DELETE, que no
--     usamos. Así el costo de WAL adicional es nulo en una tabla de alta
--     escritura como pedidos.
--
-- Idempotente: no falla si la publicación no existe (entorno sin Realtime) ni si
-- la tabla ya está publicada.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'operacion'
        and tablename = 'pedidos'
    ) then
      alter publication supabase_realtime add table operacion.pedidos;
    end if;
  end if;
end $$;
