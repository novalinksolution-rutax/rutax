-- =============================================================================
-- Tablero de métricas de PLATAFORMA (read-only) — para el operador del SaaS
-- =============================================================================
-- Cómo usarlo:
--   1. Supabase Studio → proyecto cloud → SQL Editor.
--   2. Pega UNA consulta (un bloque entre "-- ===" y el siguiente) y ejecútala.
--   3. "Save snippet" con el nombre que sugiere cada bloque para tenerla a mano.
--      Supabase guarda los snippets por proyecto; quedan en el menú lateral.
--
-- Importante / seguridad:
--   - En el SQL Editor entras con un rol PRIVILEGIADO (bypassa RLS): por eso ves
--     TODOS los tenants. Esto es intencional para el operador, pero significa que
--     cualquiera con acceso al SQL Editor ve todo — limita quién tiene acceso al
--     proyecto Supabase. Este archivo NO debe ejecutarse desde la app del courier.
--   - Son consultas de SOLO LECTURA. Ninguna modifica datos. No hay DDL aquí, así
--     que no toca migraciones ni el esquema (regla "nada de DDL fuera de migraciones").
--   - Las tablas viven en los esquemas identidad / operacion / dinero. Los nombres
--     y enums están tomados del esquema real (migraciones 0001–0007).
--
-- Zona horaria: la app opera en America/Santiago. Donde un corte por "hoy/30 días"
-- importa, se convierte explícitamente con AT TIME ZONE 'America/Santiago'.
-- =============================================================================


-- =============================================================================
-- [P0] KPIs de la plataforma — una sola fila, vista de pájaro
--   Snippet sugerido: "Plataforma · KPIs"
-- =============================================================================
select
  (select count(*) from identidad.tenants)                                      as tenants_total,
  (select count(*) from identidad.tenants where estado = 'activo')              as tenants_activos,
  (select count(*) from identidad.tenants where estado = 'onboarding')          as tenants_en_onboarding,
  (select count(*) from identidad.tenants where estado = 'suspendido')          as tenants_suspendidos,
  (select count(*) from identidad.sellers)                                      as sellers_total,
  (select count(*) from identidad.conductores)                                  as conductores_total,
  (select count(*) from identidad.conexiones_seller_ml where estado_salud = 'sana')        as conexiones_ml_sanas,
  (select count(*) from identidad.conexiones_seller_ml where estado_salud in ('atencion','desvinculada')) as conexiones_ml_con_problema,
  (select count(*) from operacion.pedidos
     where creado_en >= (now() at time zone 'America/Santiago')::date - interval '30 days') as pedidos_ultimos_30d,
  (select count(*) from dinero.periodos_cobro where estado = 'cerrado')         as periodos_cerrados_sin_facturar,
  (select count(*) from dinero.eventos_conciliacion where estado = 'pendiente') as conciliacion_pendiente;


-- =============================================================================
-- [P1] Directorio de tenants — quién es quién, su dueño y su tamaño
--   Snippet sugerido: "Plataforma · Directorio de tenants"
--   Responde: qué couriers existen, a quién pertenecen (dueño + email) y su volumen.
-- =============================================================================
select
  t.nombre_fantasia,
  t.razon_social,
  t.rut,
  t.estado,
  t.plan_id,
  t.creado_en::date                                            as alta,
  dueno.nombre_completo                                        as dueno,
  au.email                                                     as dueno_email,
  (select count(*) from identidad.usuarios_perfil u
     where u.tenant_id = t.id and u.tipo_usuario = 'interno')  as usuarios_internos,
  (select count(*) from identidad.sellers s where s.tenant_id = t.id)      as sellers,
  (select count(*) from identidad.conductores c where c.tenant_id = t.id)  as conductores
from identidad.tenants t
left join lateral (
  select up.id, up.nombre_completo
  from identidad.usuarios_perfil up
  where up.tenant_id = t.id and up.rol = 'dueno'
  order by up.creado_en
  limit 1
) dueno on true
left join auth.users au on au.id = dueno.id
order by t.creado_en desc;


-- =============================================================================
-- [P2] Salud de conexiones Mercado Libre — global y por tenant
--   Snippet sugerido: "Plataforma · Salud conexiones ML"
--   'sana' = OK · 'atencion' = token por vencer/errores · 'desvinculada' = caída ·
--   'pendiente' = nunca conectó.
-- =============================================================================
select
  t.nombre_fantasia,
  count(*)                                                   as conexiones,
  count(*) filter (where cx.estado_salud = 'sana')           as sanas,
  count(*) filter (where cx.estado_salud = 'atencion')       as atencion,
  count(*) filter (where cx.estado_salud = 'desvinculada')   as desvinculadas,
  count(*) filter (where cx.estado_salud = 'pendiente')      as pendientes,
  max(cx.ultima_sync_exitosa_en)                             as ultima_sync_del_tenant
from identidad.conexiones_seller_ml cx
join identidad.tenants t on t.id = cx.tenant_id
group by t.nombre_fantasia
order by desvinculadas desc, atencion desc;


-- =============================================================================
-- [P3] Conexiones ML que requieren acción — lista accionable de soporte
--   Snippet sugerido: "Plataforma · ML a reconectar"
--   Muestra cada conexión caída/en atención, hace cuántos días, y su último error.
-- =============================================================================
select
  t.nombre_fantasia,
  s.razon_social                                             as seller,
  cx.estado_salud,
  cx.desconectada_desde,
  case when cx.desconectada_desde is not null
       then round(extract(epoch from now() - cx.desconectada_desde) / 86400.0, 1)
  end                                                        as dias_desconectada,
  cx.ultima_sync_exitosa_en,
  cx.token_expira_en,
  left(coalesce(cx.ultimo_error, ''), 140)                   as ultimo_error
from identidad.conexiones_seller_ml cx
join identidad.tenants t on t.id = cx.tenant_id
join identidad.sellers s on s.id = cx.seller_id
where cx.estado_salud in ('atencion', 'desvinculada')
order by cx.desconectada_desde nulls last;


-- =============================================================================
-- [P4] Actividad operativa por tenant — últimos 30 días
--   Snippet sugerido: "Plataforma · Actividad 30d"
--   Detecta tenants vivos vs. dormidos: pedidos ingresados, entregados, fallidos
--   e incidencias abiertas en la ventana.
-- =============================================================================
with corte as (
  select (now() at time zone 'America/Santiago')::date - interval '30 days' as desde
)
select
  t.nombre_fantasia,
  count(p.*)                                                          as pedidos_creados,
  count(p.*) filter (where p.estado in ('entregado','entregado_manual')) as entregados,
  count(p.*) filter (where p.estado = 'fallido')                      as fallidos,
  (select count(*) from operacion.incidencias i
     where i.tenant_id = t.id
       and i.estado in ('abierta','en_gestion')
       and i.creado_en >= (select desde from corte))                 as incidencias_abiertas,
  max(p.creado_en)                                                    as ultimo_pedido
from identidad.tenants t
left join operacion.pedidos p
  on p.tenant_id = t.id
 and p.creado_en >= (select desde from corte)
group by t.id, t.nombre_fantasia
order by pedidos_creados desc;


-- =============================================================================
-- [P5] Estado del motor entrega→dinero por tenant
--   Snippet sugerido: "Plataforma · Motor de dinero"
--   Períodos abiertos/cerrados/facturados, DTEs emitidos y conciliación pendiente.
-- =============================================================================
select
  t.nombre_fantasia,
  count(pc.*) filter (where pc.estado = 'abierto')      as periodos_abiertos,
  count(pc.*) filter (where pc.estado = 'cerrado')      as periodos_cerrados_sin_facturar,
  count(pc.*) filter (where pc.estado = 'facturado')    as periodos_facturados,
  (select count(*) from dinero.documentos_dte d
     where d.tenant_id = t.id and d.tipo_documento = 33)  as facturas_dte_emitidas,
  (select count(*) from dinero.documentos_dte d
     where d.tenant_id = t.id and d.estado_sii = 'rechazado') as dte_rechazados_sii,
  (select count(*) from dinero.eventos_conciliacion e
     where e.tenant_id = t.id and e.estado = 'pendiente') as conciliacion_pendiente,
  (select coalesce(sum(d.monto_total_clp), 0) from dinero.documentos_dte d
     where d.tenant_id = t.id and d.tipo_documento = 33)  as clp_facturado_total
from identidad.tenants t
left join dinero.periodos_cobro pc on pc.tenant_id = t.id
group by t.id, t.nombre_fantasia
order by clp_facturado_total desc;


-- =============================================================================
-- [P6] Alertas de dinero atascado — períodos cerrados sin facturar
--   Snippet sugerido: "Plataforma · Períodos atascados"
--   Un período 'cerrado' espera acción humana de emisión. Si lleva días así,
--   es plata sin facturar. Útil para soporte proactivo.
-- =============================================================================
select
  t.nombre_fantasia,
  s.razon_social                                            as seller,
  pc.fecha_inicio,
  pc.fecha_fin,
  pc.total_lineas,
  pc.monto_total_clp,
  pc.cerrado_en,
  round(extract(epoch from now() - pc.cerrado_en) / 86400.0, 1) as dias_cerrado_sin_facturar
from dinero.periodos_cobro pc
join identidad.tenants t on t.id = pc.tenant_id
join identidad.sellers s on s.id = pc.seller_id
where pc.estado = 'cerrado'
order by pc.cerrado_en;


-- =============================================================================
-- [P7] Conciliación pendiente — diferencias detectadas por el job C6
--   Snippet sugerido: "Plataforma · Conciliación pendiente"
--   El detective de solo lectura marca descalces entregado-vs-facturado, folios
--   sin DTE, montos que no cuadran, etc. Estas son las que esperan revisión.
-- =============================================================================
select
  t.nombre_fantasia,
  e.tipo_diferencia,
  e.descripcion,
  e.monto_diferencia_clp,
  e.creado_en,
  e.job_run_id
from dinero.eventos_conciliacion e
join identidad.tenants t on t.id = e.tenant_id
where e.estado = 'pendiente'
order by e.creado_en desc
limit 200;


-- =============================================================================
-- [P8] Backfills de ML fallidos — recuperación de pedidos tras reconexión
--   Snippet sugerido: "Plataforma · Backfills fallidos"
-- =============================================================================
select
  t.nombre_fantasia,
  b.seller_id,
  b.desde,
  b.hasta,
  b.estado,
  b.pedidos_recuperados,
  left(coalesce(b.error, ''), 160)                          as error,
  b.iniciado_en,
  b.completado_en
from operacion.intentos_backfill b
join identidad.tenants t on t.id = b.tenant_id
where b.estado in ('fallido', 'en_progreso')
order by b.iniciado_en desc
limit 100;


-- =============================================================================
-- [P9] Onboarding incompleto — tenants que aún no pueden operar/facturar
--   Snippet sugerido: "Plataforma · Onboarding pendiente"
--   Cruza estado del tenant con config DTE, certificado, folios y conexiones ML.
-- =============================================================================
select
  t.nombre_fantasia,
  t.estado                                                  as estado_tenant,
  t.creado_en::date                                         as alta,
  cfg.proveedor_dte,
  cfg.estado_certificacion,
  cfg.certificado_vence_en,
  (cfg.certificado_digital_ref is not null)                 as tiene_certificado,
  (select count(*) from identidad.folios_caf f
     where f.tenant_id = t.id and f.estado = 'vigente')     as folios_vigentes,
  (select count(*) from identidad.conexiones_seller_ml cx
     where cx.tenant_id = t.id and cx.estado_salud = 'sana') as conexiones_ml_sanas,
  (select count(*) from identidad.tarifas ta where ta.tenant_id = t.id) as tarifas_cargadas
from identidad.tenants t
left join identidad.courier_config_dte cfg on cfg.tenant_id = t.id
where t.estado <> 'activo'
   or cfg.tenant_id is null
   or cfg.estado_certificacion <> 'activo'
order by t.creado_en desc;


-- =============================================================================
-- [P10] Certificados digitales por vencer — riesgo de corte de facturación
--   Snippet sugerido: "Plataforma · Certificados por vencer"
-- =============================================================================
select
  t.nombre_fantasia,
  cfg.proveedor_dte,
  cfg.estado_certificacion,
  cfg.certificado_vence_en,
  (cfg.certificado_vence_en - (now() at time zone 'America/Santiago')::date) as dias_para_vencer
from identidad.courier_config_dte cfg
join identidad.tenants t on t.id = cfg.tenant_id
where cfg.certificado_vence_en is not null
order by cfg.certificado_vence_en;


-- =============================================================================
-- [P11] Acciones de plataforma en la bitácora — alta/suspensión/soporte
--   Snippet sugerido: "Plataforma · Auditoría de plataforma"
--   tenant_id NULL o actor_tipo = 'super_admin' = acciones a nivel sistema.
-- =============================================================================
select
  b.creado_en,
  b.actor_tipo,
  au.email                                                  as actor_email,
  b.accion,
  b.entidad_tipo,
  b.entidad_id,
  t.nombre_fantasia                                         as tenant_afectado,
  b.detalle
from identidad.bitacora_auditoria b
left join auth.users au on au.id = b.actor_usuario_id
left join identidad.tenants t on t.id = b.tenant_id
where b.actor_tipo = 'super_admin' or b.tenant_id is null
order by b.creado_en desc
limit 200;


-- =============================================================================
-- [P12] Últimas acciones financieras/acceso (cualquier tenant)
--   Snippet sugerido: "Plataforma · Auditoría reciente"
--   Pulso general de actividad. Para auditar un tenant puntual, agrega
--   "and b.tenant_id = '<uuid>'" al WHERE.
-- =============================================================================
select
  b.creado_en,
  t.nombre_fantasia                                         as tenant,
  b.actor_tipo,
  au.email                                                  as actor_email,
  b.accion,
  b.entidad_tipo,
  b.entidad_id
from identidad.bitacora_auditoria b
left join auth.users au on au.id = b.actor_usuario_id
left join identidad.tenants t on t.id = b.tenant_id
order by b.creado_en desc
limit 100;


-- =============================================================================
-- [P13] Crecimiento — altas de tenants por mes
--   Snippet sugerido: "Plataforma · Crecimiento mensual"
-- =============================================================================
select
  to_char(date_trunc('month', creado_en at time zone 'America/Santiago'), 'YYYY-MM') as mes,
  count(*)                                                  as tenants_nuevos,
  sum(count(*)) over (
    order by date_trunc('month', creado_en at time zone 'America/Santiago')
  )                                                         as tenants_acumulados
from identidad.tenants
group by date_trunc('month', creado_en at time zone 'America/Santiago')
order by mes;
