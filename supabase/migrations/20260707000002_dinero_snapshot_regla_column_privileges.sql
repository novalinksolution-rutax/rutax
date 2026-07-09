-- =============================================================================
-- Migración 0034 · Dinero — Cierra fuga de snapshot_regla vía Accept-Profile
-- =============================================================================
-- Hallazgo de QA sobre la migración 20260707000001 (snapshot inmutable de la
-- regla económica, hallazgo P0 de auditoría): la confidencialidad de
-- `snapshot_regla` se diseñó como "la vista public.* la omite" — pero
-- `supabase/config.toml` expone el schema `dinero` DIRECTAMENTE por PostgREST
-- (`schemas = [..., "dinero"]`, imprescindible para que el código server-side
-- con `crearClienteServiceRole().schema('dinero')` funcione), y la migración
-- 0006 otorga `grant select on dinero.lineas_cobro/lineas_liquidacion to
-- authenticated` (a nivel de TABLA COMPLETA) para que las vistas
-- security_invoker=true puedan leer la tabla base.
--
-- Combinados, esos dos hechos preexistentes permiten que un seller o conductor
-- autenticado, golpeando la API REST directamente con el header
-- `Accept-Profile: dinero` (en vez del `public` por defecto), LEA
-- `dinero.lineas_cobro`/`dinero.lineas_liquidacion` sin pasar por la vista —
-- y como el grant es de tabla completa, obtiene `snapshot_regla` igual.
-- Verificado end-to-end con un JWT de seller real contra el Supabase local:
-- `curl .../rest/v1/lineas_cobro?select=snapshot_regla -H "Accept-Profile: dinero"`
-- devolvía el snapshot. La RLS de FILA (P1+P2/P1+P3) seguía correcta — el
-- seller solo veía SUS filas — pero la columna igual se filtraba.
--
-- Antes de esta migración, exponer `dinero` sin restricción de columna era
-- inofensivo: la tabla base no tenía ninguna columna que la vista `public` no
-- espejara ya. `snapshot_regla` es la PRIMERA columna que debía quedar fuera
-- del alcance de authenticated — por eso la fuga solo se vuelve real ahora.
--
-- Arreglo: privilegios de columna de Postgres. GRANT SELECT a nivel de TABLA
-- permite leer cualquier columna sin importar qué exponga una vista externa;
-- solo revocando el grant de tabla y re-otorgando SELECT sobre la lista
-- explícita de columnas (la misma que ya expone la vista public.*) se cierra
-- el camino directo. service_role no se toca: su grant (tabla completa) es
-- independiente del de `authenticated` y sigue intacto — el job del motor
-- entrega→dinero sigue pudiendo leer/escribir snapshot_regla sin cambios.
--
-- Idempotente: REVOKE + GRANT son operaciones declarativas, reaplicables.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. dinero.lineas_cobro — de SELECT de tabla completa a SELECT por columna
--    (mismas columnas que expone public.lineas_cobro, sin snapshot_regla).
-- -----------------------------------------------------------------------------
revoke select on dinero.lineas_cobro from authenticated;

grant select (
  id,
  tenant_id,
  seller_id,
  pedido_id,
  periodo_cobro_id,
  tarifa_id,
  monto_base_clp,
  ajuste_incidencia_clp,
  monto_final_clp,
  concepto,
  tipo_pedido,
  fecha_entrega,
  incidencia_id,
  origen_generacion,
  generado_por_usuario_id,
  notas,
  creado_en,
  actualizado_en,
  anulada,
  anulada_en,
  motivo_anulacion
) on dinero.lineas_cobro to authenticated;

-- -----------------------------------------------------------------------------
-- 2. dinero.lineas_liquidacion — idéntico patrón.
-- -----------------------------------------------------------------------------
revoke select on dinero.lineas_liquidacion from authenticated;

grant select (
  id,
  tenant_id,
  driver_id,
  pedido_id,
  liquidacion_id,
  monto_base_clp,
  ajuste_incidencia_clp,
  monto_final_clp,
  concepto,
  fecha_entrega,
  incidencia_id,
  origen_generacion,
  generado_por_usuario_id,
  notas,
  creado_en,
  actualizado_en,
  anulada,
  anulada_en,
  motivo_anulacion
) on dinero.lineas_liquidacion to authenticated;

comment on column dinero.lineas_cobro.snapshot_regla is
  'Snapshot INMUTABLE (append-once) de la regla económica que determinó el valor
   de esta línea de cobro. DATO INTERNO DEL COURIER: NUNCA se expone al seller.
   Doble barrera de confidencialidad: (1) la vista public.lineas_cobro omite la
   columna, (2) `authenticated` NO tiene privilegio SELECT sobre esta columna en
   la tabla base dinero.lineas_cobro (grant de columna, migración
   20260707000002) — cierra el acceso directo vía Accept-Profile: dinero. Lo
   llena y lee solo service_role (motor entrega→dinero).';

comment on column dinero.lineas_liquidacion.snapshot_regla is
  'Snapshot INMUTABLE (append-once) de la regla económica que determinó el valor
   de esta línea de liquidación. DATO INTERNO DEL COURIER: NUNCA se expone al
   conductor. Doble barrera de confidencialidad: (1) la vista
   public.lineas_liquidacion omite la columna, (2) `authenticated` NO tiene
   privilegio SELECT sobre esta columna en la tabla base
   dinero.lineas_liquidacion (grant de columna, migración 20260707000002) —
   cierra el acceso directo vía Accept-Profile: dinero. Lo llena y lee solo
   service_role (motor entrega→dinero).';
