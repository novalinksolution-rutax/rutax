-- =============================================================================
-- Storage: crear los buckets `liquidaciones` y `documentos-dte` en entornos
-- desplegados
-- =============================================================================
-- El commit 99c321d los declaró en `supabase/config.toml`, lo que los crea en el
-- entorno LOCAL (`supabase start`) pero no en un proyecto hosted: allí
-- `config.toml` no se aplica y los buckets solo nacen si una migración los
-- inserta. `pod-evidencias` (20260613000008) y `contexto-mapas` (20260725000001)
-- ya siguen ese doble patrón —config.toml + migración—; estos dos quedaron solo
-- con la mitad.
--
-- Sin esto, el bug que 99c321d arregló en local vuelve a aparecer en producción,
-- y con la misma cara: `generar-liquidacion-conductor` genera el PDF, el
-- `upload` falla porque el bucket no existe, y el `catch` deliberado —puesto
-- para no perder la liquidación por culpa de un PDF— deja `pdf_ref` en null. El
-- conductor nunca recibe su comprobante y no aparece ningún error en ninguna
-- parte.
--
-- Propiedades idénticas a las de `config.toml`, para que local y desplegado no
-- diverjan.
--
-- Ambos PRIVADOS, y sin discusión: `liquidaciones` trae el detalle de entregas y
-- montos de UN conductor de UN tenant, y `documentos-dte` es el documento
-- tributario de un seller concreto bajo el RUT de un courier concreto. El
-- aislamiento lo imponen el service_role y la URL firmada de vida corta; NO se
-- crean políticas sobre storage.objects para authenticated/anon — ni el seller
-- ni el conductor leen los buckets directo, siempre pasan por el backend.
--
-- Convenciones de path (las impone el backend al subir):
--   liquidaciones:  {tenant_id}/liquidaciones/{liquidacion_id}/liquidacion.pdf
--   documentos-dte: {tenant_id}/dte/{documento_dte_id}/factura.pdf
--
-- Idempotente: `on conflict (id) do nothing` y la guarda de existencia de
-- storage.buckets, igual que las dos migraciones que ya crean buckets.
-- =============================================================================

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'liquidaciones',
      'liquidaciones',
      false,
      10485760, -- 10 MiB
      array['application/pdf']
    )
    on conflict (id) do nothing;

    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'documentos-dte',
      'documentos-dte',
      false,
      10485760, -- 10 MiB
      array['application/pdf']
    )
    on conflict (id) do nothing;
  end if;
end $$;
