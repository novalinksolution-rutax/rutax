/**
 * Adaptador MANUAL de payout — reencuadra el pago "por fuera" existente.
 * =============================================================================
 *
 * El courier transfiere por su propio banco (app/web del banco) y luego REGISTRA
 * el comprobante en la plataforma. Este adaptador NO mueve plata ni llama a
 * ningún proveedor: solo modela ese flujo dentro del puerto, para que `dinero`
 * trate `manual`, `fintoc` y `stub` de forma uniforme.
 *
 * Semántica:
 *  - `crearPayout` devuelve `estado:'enviado'` con un id de seguimiento interno
 *    derivado de la `idempotencyKey` determinística. "enviado" aquí significa
 *    "registrado, a la espera de que un humano confirme la transferencia y suba
 *    el comprobante" — NO que el dinero ya se movió.
 *  - `consultarPayout` devuelve SIEMPRE `pendiente`: el método manual no puede
 *    auto-confirmar. La confirmación la hace la acción humana de `backend`
 *    (subir comprobante → estado `confirmado`), no este adaptador.
 *
 * Es el `metodo_default` de `courier_config_payout` (default 'manual' en la
 * migración): el courier que aún no conecta Fintoc paga manual y registra.
 *
 * REGLAS DE DEPENDENCIAS (adaptador = hoja del grafo): solo importa del puerto.
 */

import type {
  ConsultarPayoutArgs,
  CrearPayoutArgs,
  EstadoPayoutExterno,
  EventoWebhookPayout,
  PuertoPayout,
  ResultadoPayout,
  ValidarFirmaWebhookPayoutArgs,
} from "../puerto-payout";

/** Prefijo del id de seguimiento interno del pago manual. */
const PREFIJO_MANUAL = "MANUAL-PAYOUT";

export class ManualPayoutAdapter implements PuertoPayout {
  /**
   * Registra la intención de pago manual. NO transfiere. El id de seguimiento es
   * determinístico (deriva de `idempotencyKey`) para que un reintento no genere
   * un segundo registro de seguimiento distinto.
   */
  async crearPayout(args: CrearPayoutArgs): Promise<ResultadoPayout> {
    return {
      estado: "enviado",
      payoutExternoId: `${PREFIJO_MANUAL}-${args.idempotencyKey}`,
    };
  }

  /**
   * El pago manual NUNCA se auto-confirma: queda `pendiente` hasta que un humano
   * suba el comprobante (acción de `backend`). Reportarlo confirmado aquí sería
   * afirmar que el dinero se movió sin evidencia.
   */
  async consultarPayout(args: ConsultarPayoutArgs): Promise<EstadoPayoutExterno> {
    return {
      payoutExternoId: args.payoutExternoId,
      estado: "pendiente",
      descripcion: "pago manual a la espera de confirmación y comprobante del courier",
      comprobanteRef: null,
    };
  }

  /** El método manual no recibe webhooks de proveedor: nunca valida firma. */
  validarFirmaWebhook(_args: ValidarFirmaWebhookPayoutArgs): boolean {
    return false;
  }

  /** El método manual no recibe webhooks de proveedor: nada que normalizar. */
  normalizarEventoWebhookPayout(_payloadCrudo: unknown): EventoWebhookPayout | null {
    return null;
  }
}
