/**
 * Consumo — captura de telemetría de costo y uso de plataforma.
 * =====================================================================
 * Único punto por el que se registra un evento de consumo (una llamada a una
 * API de pago, o un gesto del conductor que cuesta plata o que interesa medir).
 * Alimenta el módulo backstage `src/app/admin/consumo/` — observabilidad INTERNA
 * de Rutax, que el courier nunca ve (ver docs/arquitectura/consumo-telemetria.md).
 *
 * Invariantes (idénticos a `src/lib/observabilidad`):
 * - NUNCA lanza: la telemetría jamás puede tumbar el flujo que observa. Se
 *   invoca con `void registrarConsumo(...)` en el path crítico.
 * - Fire-and-forget con timeout corto: no bloquea el request ni el job.
 * - Toda la `metadata` pasa por `redactarSensible` antes de salir del proceso —
 *   jamás coordenadas, direcciones, nombres de destinatario, domicilio del
 *   conductor ni tokens. Solo conteos, SKUs y códigos de estado.
 *
 * La escritura va por la RPC `public.consumo_registrar` (security definer,
 * service_role), que calcula el costo estimado con el precio vigente y hace
 * prune oportunista. Este helper solo arma el payload y lo dispara.
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { redactarSensible } from "@/lib/observabilidad/redaccion";

export type SuperficieConsumo =
  | "api_route"
  | "server_action"
  | "adaptador"
  | "job"
  | "cron";

export type ResultadoConsumo = "ok" | "error" | "omitido" | "degradado";

/**
 * Proveedores con costo asociado. `ml` va incluido aunque su costo sea 0: se
 * cuenta para vigilar la CUOTA de tasa, no el gasto. `null`/ausente = evento de
 * comportamiento sin proveedor de pago (p. ej. reordenar la ruta a mano, o una
 * optimización que cayó al motor local haversine).
 */
export type ProveedorCosto =
  | "google_route_optimization"
  | "google_compute_routes"
  | "google_geocoding"
  | "whatsapp_cloud"
  | "resend"
  | "ml";

export interface EventoConsumo {
  /** 'ruta.optimizar' | 'ruta.reordenar' | 'geocoding.resolver' | 'whatsapp.enviar'… */
  tipoEvento: string;
  superficie: SuperficieConsumo;
  /** Courier afectado (triaje, no frontera). */
  tenantId?: string;
  /** auth.users id del actor. */
  usuarioId?: string;
  /** 'conductor' | 'interno' | 'seller' | 'super_admin' | 'sistema'. */
  tipoUsuario?: string;
  /** Endpoint/recurso: '/api/conductor/manifiesto/ruta', 'routeoptimization:optimizeTours'. */
  recurso?: string;
  proveedorCosto?: ProveedorCosto;
  /** SKU fino del proveedor (p. ej. 'single_vehicle', 'essentials', 'utility'). */
  sku?: string;
  /** Unidades facturables: nº de paradas, de requests, de mensajes, de emails. Default 1. */
  unidades?: number;
  resultado?: ResultadoConsumo;
  /** runId / request id, para cruzar con `infra.ejecuciones_job` y Sentry. */
  correlacionId?: string;
  /** Idempotencia para eventos disparados por jobs con reintento (WhatsApp, geocoding). */
  claveIdempotencia?: string;
  /** Extra libre — se REDACTA antes de salir. Solo conteos/SKUs/estados, nunca PII. */
  metadata?: Record<string, unknown>;
}

const TIMEOUT_ENVIO_MS = 2000;

/**
 * Registra un evento de consumo. Nunca lanza. Aplica redacción a la metadata.
 * Dispara y olvida: el llamador no debe `await` en el path crítico.
 */
export async function registrarConsumo(evento: EventoConsumo): Promise<void> {
  try {
    const metadata =
      evento.metadata !== undefined
        ? ((redactarSensible(evento.metadata) ?? {}) as Record<string, unknown>)
        : null;

    const cliente = crearClienteServiceRole();

    // Los nombres de los argumentos deben calzar EXACTO con los parámetros de la
    // RPC `public.consumo_registrar` (migración `20260909…_infra_consumo_*`).
    const rpc = cliente.rpc("consumo_registrar", {
      p_tipo_evento: evento.tipoEvento,
      p_superficie: evento.superficie,
      p_tenant_id: evento.tenantId ?? null,
      p_usuario_id: evento.usuarioId ?? null,
      p_tipo_usuario: evento.tipoUsuario ?? null,
      p_recurso: evento.recurso ?? null,
      p_proveedor_costo: evento.proveedorCosto ?? null,
      p_sku: evento.sku ?? null,
      p_unidades: evento.unidades ?? 1,
      p_resultado: evento.resultado ?? null,
      p_correlacion_id: evento.correlacionId ?? null,
      p_clave_idempotencia: evento.claveIdempotencia ?? null,
      p_metadata: metadata,
    });

    // Tope de espera: la telemetría no puede colgar el flujo observado.
    await Promise.race([
      rpc,
      new Promise((resolve) => setTimeout(resolve, TIMEOUT_ENVIO_MS)),
    ]);
  } catch {
    // La telemetría JAMÁS propaga su propio fallo.
  }
}
