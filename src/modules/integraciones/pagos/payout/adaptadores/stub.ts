/**
 * Adaptador STUB de payout (sandbox por defecto en dev/CI).
 * =============================================================================
 *
 * MOLDE: equivalente al `SimplefacturaAdapter` stub para DTE — permite que la
 * acción humana y el job idempotente de `dinero` (F19) sean 100% testeables en
 * Vitest SIN red, SIN credenciales y, sobre todo, SIN mover plata real.
 *
 * Determinista: el `payoutExternoId` se deriva de la `idempotencyKey`
 * determinística, así un reintento con la misma llave produce el MISMO id
 * simulado (refleja la idempotencia real sin proveedor).
 *
 * Es el adaptador que la fábrica devuelve siempre que el gate sandbox/opt-in NO
 * esté completo (`PAYOUT_SANDBOX_MODE` distinto de `false`, o el tenant sin
 * `payout_real_habilitado`). Cero costo, cero plata.
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

/** Prefijo del id simulado — distingue a simple vista que NO es un payout real. */
const PREFIJO_STUB = "SANDBOX-PAYOUT";

export class StubPayoutAdapter implements PuertoPayout {
  /**
   * Registra el payout sin transferir. Determinista: el id se deriva de la
   * `idempotencyKey` (que es `payout-${liquidacionId}`), de modo que reintentar
   * con la misma llave devuelve el mismo `payoutExternoId` — emula la
   * deduplicación del proveedor real.
   */
  async crearPayout(args: CrearPayoutArgs): Promise<ResultadoPayout> {
    return {
      estado: "enviado",
      payoutExternoId: `${PREFIJO_STUB}-${args.idempotencyKey}`,
    };
  }

  /**
   * En sandbox la transferencia es simulada e instantánea: el stub la reporta
   * `confirmado` para que el flujo de `dinero` (proyección a "liquidación
   * pagada") sea ejercitable end-to-end sin proveedor real.
   */
  async consultarPayout(args: ConsultarPayoutArgs): Promise<EstadoPayoutExterno> {
    return {
      payoutExternoId: args.payoutExternoId,
      estado: "confirmado",
      descripcion: "payout simulado (sandbox) — no se movió dinero real",
      comprobanteRef: null,
    };
  }

  /** El stub no procesa webhooks de proveedor: nunca valida una firma. */
  validarFirmaWebhook(_args: ValidarFirmaWebhookPayoutArgs): boolean {
    return false;
  }

  /** El stub no recibe webhooks de proveedor: nunca hay evento que normalizar. */
  normalizarEventoWebhookPayout(_payloadCrudo: unknown): EventoWebhookPayout | null {
    return null;
  }
}
