-- =============================================================================
-- `fecha_entrega` → `fecha_hecho` en las dos tablas de líneas
--
-- Migración DELIBERADAMENTE SOLA: lo único que hace es cambiar un nombre. Se
-- separó de la etapa 8 (20260815000004) a propósito, porque estas columnas se
-- referencian por STRING desde PostgREST (`.order('fecha_entrega')`, `.gte(…)`,
-- las listas de `select`) y el typecheck NO ve un string mal escrito: un sitio
-- olvidado falla EN EJECUCIÓN, dentro de una consulta de dinero. Aislada, la
-- revisión es trivial y cualquier fallo tiene un solo sospechoso.
--
-- =============================================================================
-- POR QUÉ EL NOMBRE VIEJO MIENTE
-- =============================================================================
-- Desde la etapa 8, `dinero.lineas_liquidacion` guarda dos clases de hecho: una
-- entrega o una VISITA A BODEGA. Guardar la fecha de una visita en una columna
-- llamada "fecha de entrega" es exactamente la clase de nombre engañoso que este
-- proyecto ya pagó caro varias veces — el caso más reciente,
-- `estimated_delivery_limit` de Mercado Libre, que NO era la fecha límite de
-- entrega sino el plazo para que el comprador pidiera reembolso.
--
-- =============================================================================
-- SE RENOMBRAN LAS DOS TABLAS, Y ESA ES LA DECISIÓN QUE ABARATA TODO
-- =============================================================================
-- `lineas_cobro` no cambió en la etapa 8 y su columna todavía sería exacta (hoy
-- solo una entrega genera cobro). Renombrarla igual tiene dos razones:
--
-- 1. **Ejecución.** Las dos tablas comparten el nombre de columna, así que
--    renombrar una sola obligaría a clasificar ~30 sitios de TypeScript uno por
--    uno —"¿esta consulta es de cobro o de liquidación?"— y basta equivocarse en
--    uno para romper una consulta de dinero en producción. Renombrando ambas, el
--    cambio en el código es un reemplazo mecánico sin una sola decisión.
-- 2. **Futuro.** El alcance dice que cobrarle el retiro al seller queda "más
--    adelante". Cuando llegue, `lineas_cobro` tendrá el mismo segundo hecho y el
--    nombre ya estará bien.
--
-- =============================================================================
-- ⚠️ LAS VISTAS SE DROPEAN, NO SE REEMPLAZAN
-- =============================================================================
-- `CREATE OR REPLACE VIEW` **no puede renombrar una columna** ("cannot change
-- name of view column"). Hay que `drop` + `create`. Y al dropear una vista se
-- van SUS GRANTS, así que se re-emiten abajo — omitirlos deja la vista existente
-- y `authenticated` sin poder leerla, otra falla que aparece en ejecución.
--
-- Los privilegios POR COLUMNA de las tablas base (20260707000002) sí sobreviven
-- al rename: PostgreSQL los guarda por `attnum`, no por nombre. Se verifica con
-- `has_column_privilege` en la prueba pgTAP, en vez de darlo por sabido.
--
-- Los índices que usan la columna (`idx_lineas_liq_fecha`, `idx_lineas_cobro_
-- fecha`) siguen válidos por la misma razón; conservan su nombre viejo, que solo
-- es una etiqueta.
--
-- IDEMPOTENTE: el rename va en un DO-block que comprueba si la columna vieja
-- todavía existe.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. El rename, en las dos tablas
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'dinero' and table_name = 'lineas_cobro'
      and column_name = 'fecha_entrega'
  ) then
    alter table dinero.lineas_cobro rename column fecha_entrega to fecha_hecho;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'dinero' and table_name = 'lineas_liquidacion'
      and column_name = 'fecha_entrega'
  ) then
    alter table dinero.lineas_liquidacion rename column fecha_entrega to fecha_hecho;
  end if;
end $$;

comment on column dinero.lineas_liquidacion.fecha_hecho is
  'Fecha del HECHO que generó la línea: la de la entrega, o la de la visita a '
  'bodega. Se llamaba fecha_entrega y el nombre mentía desde que la tabla '
  'aprendió el segundo hecho generador (etapa 8).';

comment on column dinero.lineas_cobro.fecha_hecho is
  'Fecha del HECHO que generó la línea. Hoy siempre una entrega — el retiro no '
  'se le cobra al seller todavía. Se renombró junto con su hermana de '
  'liquidación para que las dos tablas nombren igual el mismo concepto.';

-- -----------------------------------------------------------------------------
-- 2. Las vistas espejo: drop + create (no se puede replace con rename)
--    Lista de columnas EXPLÍCITA — omiten `snapshot_regla`, que es confidencial
--    (20260707000001).
-- -----------------------------------------------------------------------------
drop view if exists public.lineas_cobro;

create view public.lineas_cobro
  with (security_invoker = true)
  as select
    id,
    tenant_id,
    seller_id,
    pedido_id,
    periodo_cobro_id,
    monto_base_clp,
    ajuste_incidencia_clp,
    monto_final_clp,
    concepto,
    tipo_pedido,
    fecha_hecho,
    incidencia_id,
    origen_generacion,
    generado_por_usuario_id,
    notas,
    creado_en,
    actualizado_en,
    anulada,
    anulada_en,
    motivo_anulacion
  from dinero.lineas_cobro;

comment on view public.lineas_cobro is
  'Espejo de dinero.lineas_cobro para PostgREST. RLS heredada: P1 tenant + P2
   seller. Lista de columnas EXPLÍCITA: OMITE snapshot_regla (confidencial).';

drop view if exists public.lineas_liquidacion;

create view public.lineas_liquidacion
  with (security_invoker = true)
  as select
    id,
    tenant_id,
    driver_id,
    pedido_id,
    liquidacion_id,
    monto_base_clp,
    ajuste_incidencia_clp,
    monto_final_clp,
    concepto,
    fecha_hecho,
    incidencia_id,
    origen_generacion,
    generado_por_usuario_id,
    notas,
    creado_en,
    actualizado_en,
    anulada,
    anulada_en,
    motivo_anulacion,
    tipo_hecho,
    sesion_retiro_id
  from dinero.lineas_liquidacion;

comment on view public.lineas_liquidacion is
  'Espejo de dinero.lineas_liquidacion para PostgREST. RLS heredada: P1 tenant +
   P3 conductor. Sellers no tienen acceso. Lista de columnas EXPLÍCITA: OMITE
   snapshot_regla (confidencial).';

-- -----------------------------------------------------------------------------
-- 3. Los GRANTS de las vistas, que el `drop view` se llevó
-- -----------------------------------------------------------------------------
grant select on public.lineas_cobro to authenticated;
grant select on public.lineas_liquidacion to authenticated;
grant all on public.lineas_cobro to service_role;
grant all on public.lineas_liquidacion to service_role;
