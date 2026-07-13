/**
 * Tipos del módulo `plataforma`.
 *
 * Gestiona las suscripciones SaaS de Rutax (los couriers pagan a Rutax por
 * usar el software). Es el backstage financiero de la plataforma misma —
 * DISTINTO al módulo `dinero`, que maneja la facturación courier→seller.
 *
 * AISLAMIENTO: todas las tablas viven en el schema `plataforma`, con RLS
 * deny-all para `authenticated`. Solo `service_role` (super-admin + jobs)
 * accede. Los couriers NUNCA ven este schema directamente.
 */

export type EstadoSuscripcion = 'trial' | 'activa' | 'suspendida' | 'cancelada';
export type EstadoPeriodo = 'pendiente' | 'pagado' | 'vencido';
export type EstadoPago = 'pendiente' | 'confirmado' | 'fallido';
/**
 * `fintoc_recurrente` = cobro vía mandato de auto-cobro (migración
 * 20260710000001, job `cobrar-periodo-auto.ts`) — distinto de `fintoc_link`
 * (link de pago manual generado por el super-admin).
 *
 * NOTA (hallazgo de `frontend`, ago-2026; corregido por `base-datos-rls`): el
 * CHECK de `plataforma.pagos_plataforma.metodo` en la migración base
 * 20260621000015 SOLO admitía `('fintoc_link','transferencia_manual','cortesia')`
 * y omitía `fintoc_recurrente`, pese a que `cobrar-periodo-auto.ts`/`cobro.ts`
 * insertan ese valor → todo INSERT de auto-cobro real violaba el CHECK (23514).
 * Resuelto en la migración 20260710000002, que amplía el CHECK para incluir
 * `fintoc_recurrente`. Este tipo es el espejo TS del conjunto ya alineado.
 */
export type MetodoPago = 'fintoc_link' | 'fintoc_recurrente' | 'transferencia_manual' | 'cortesia';

/** Periodicidad de cobro de la suscripción (migración 20260710000001, item J). */
export type Periodicidad = 'mensual' | 'anual';

/**
 * Estado del mandato de auto-cobro Fintoc (migración 20260710000001). El
 * mandato en sí (token) vive cifrado en `identidad.secretos_cifrados`; aquí
 * solo el estado del ciclo de vida del mandato.
 */
export type EstadoMandato = 'sin_mandato' | 'pendiente' | 'activo' | 'cancelado' | 'fallido';

export interface Plan {
  id: string;
  nombre: string;
  descripcion: string | null;
  precioMensualClp: number;
  precioAnualClp: number;
  limitePedidosMes: number | null;
  caracteristicas: Record<string, unknown>;
  activo: boolean;
}

export interface Suscripcion {
  id: string;
  tenantId: string;
  planId: string;
  estado: EstadoSuscripcion;
  trialHasta: string | null;
  activaDesde: string | null;
  canceladaEn: string | null;
  notas: string | null;
  /** Mensual o anual (migración 20260710000001, item J). Default 'mensual'. */
  periodicidad: Periodicidad;
  /** Si el courier habilitó el auto-cobro por mandato Fintoc. Default false (opt-in). */
  autoCobroHabilitado: boolean;
  /** Estado del ciclo de vida del mandato de auto-cobro. Default 'sin_mandato'. */
  mandatoEstado: EstadoMandato;
  /**
   * Referencia OPACA (uuid) al secreto cifrado del mandato en
   * `identidad.secretos_cifrados` — NUNCA el token. `null` si no hay mandato.
   */
  mandatoRef: string | null;
  /**
   * Campo SOBRECARGADO deliberadamente (F2, item I — ver `cambiarPlanCourier`
   * en `superficie-courier.ts` para el razonamiento completo): su significado
   * depende de si hay un cambio de plan PENDIENTE (`cambioEfectivoDesde` no
   * nulo y en el futuro):
   *   - Con un downgrade PENDIENTE: contiene el plan DESTINO (a dónde va) —
   *     NO "el plan anterior" pese al nombre. `planId` sigue siendo, en todo
   *     momento, el plan REALMENTE facturado hoy (nunca se toca en la
   *     solicitud de downgrade) — así ningún otro lector de `planId`
   *     (`obtenerEntitlementsTenant`, el cron `generarPeriodos`,
   *     `obtenerMiPlan`) necesita resolver un "plan efectivo" distinto.
   *   - Sin cambio pendiente (`cambioEfectivoDesde` es `null`): vuelve a estar
   *     vacío (`null`) — este modelo NO conserva un histórico permanente de
   *     "de qué plan vino" (eso exigiría una tabla de historial aparte, fuera
   *     de alcance).
   * El job `plataforma/aplicarCambiosPlan` (`jobs/aplicar-cambios-plan.ts`)
   * es el ÚNICO que hace el swap real (`planId = planAnteriorId`) y limpia
   * ambos campos, cuando `cambioEfectivoDesde <= hoy`.
   * Elegido así (reusar columnas existentes) para NO requerir una migración
   * nueva (p. ej. `plan_pendiente_id`).
   */
  planAnteriorId: string | null;
  /**
   * Fecha desde la que el cambio de plan PENDIENTE (guardado en
   * `planAnteriorId`, ver su doc) es efectivo — `null` = sin cambio pendiente.
   * Zona horaria America/Santiago (fecha civil, sin hora).
   */
  cambioEfectivoDesde: string | null;
  /**
   * Overrides de entitlements POR COURIER (migración 20260712000001, gap 6,
   * "Ola 1" F2) — jsonb de features forzadas SIN cambiar de plan, p. ej.
   * `{"api_publica": true, "conductores_max": 10}`. TIENE PRECEDENCIA sobre
   * `plan.caracteristicas` en el merge que hace `obtenerEntitlementsTenant`
   * (`superficie-courier.ts`). Default `{}` = sin override, el courier ve
   * exactamente su plan.
   */
  caracteristicasOverride: Record<string, unknown>;
  creadaEn: string;
  actualizadoEn: string;
}

export interface SuscripcionConPlan extends Suscripcion {
  plan: Plan;
  nombreFantasiaTenant: string | null;
}

/**
 * Concepto del período: `periodo` = cobro regular (mensual/anual, generado
 * por el cron `generarPeriodos`); `ajuste_proracion` = cargo puntual, de una
 * sola vez, por un UPGRADE de plan inmediato a mitad de ciclo (F2, item I).
 * El cálculo de MRR/ARR (`metricas-negocio.ts`) EXCLUYE los `ajuste_proracion`
 * — no son ingreso recurrente. Migración 20260712000004.
 */
export type ConceptoPeriodo = 'periodo' | 'ajuste_proracion';

export interface PeriodoSuscripcion {
  id: string;
  suscripcionId: string;
  tenantId: string;
  periodoInicio: string;
  periodoFin: string;
  montoClp: number;
  estado: EstadoPeriodo;
  venceEn: string | null;
  generadoEn: string;
  concepto: ConceptoPeriodo;
}

export interface PagoPlataforma {
  id: string;
  periodoId: string;
  tenantId: string;
  montoClp: number;
  metodo: MetodoPago;
  estado: EstadoPago;
  pagoExternoId: string | null;
  linkPagoUrl: string | null;
  pagadoEn: string | null;
  registradoEn: string;
  notas: string | null;
}
