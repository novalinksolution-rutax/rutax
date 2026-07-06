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
export type MetodoPago = 'fintoc_link' | 'transferencia_manual' | 'cortesia';

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
  creadaEn: string;
  actualizadoEn: string;
}

export interface SuscripcionConPlan extends Suscripcion {
  plan: Plan;
  nombreFantasiaTenant: string | null;
}

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
