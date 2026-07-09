/**
 * Puerto de PAYOUTS SALIENTES — única puerta por la que `dinero` instruye una
 * transferencia de dinero REAL del courier al conductor (F19, Bloque 3).
 * =============================================================================
 *
 * NO confundir con `pagos/puerto.ts` (`PuertoConciliacionPagos`): aquel LEE
 * movimientos entrantes (cobranza, no mueve plata). ESTE MUEVE plata saliente.
 * Por eso es el código de mayor riesgo del proyecto y va aislado tras este
 * puerto: el núcleo (`dinero`) depende solo de esta interfaz, nunca del
 * adaptador concreto (Fintoc / banca / manual).
 *
 * GARANTÍAS DEL CONTRATO (las imponen los adaptadores, no el llamador):
 *  - **Sandbox por defecto**: salvo `PAYOUT_SANDBOX_MODE=false` Y opt-in del
 *    tenant (`courier_config_payout.payout_real_habilitado=true`), NINGÚN
 *    adaptador transfiere dinero real. La fábrica resuelve el gate y entrega el
 *    adaptador correcto (stub en sandbox, real solo con ambos flags). Molde
 *    idéntico al de DTE (`DTE_SANDBOX_MODE` + `emision_dte_real_habilitada`).
 *  - **Idempotencia**: la `idempotencyKey` es DETERMINÍSTICA (`payout-${liquidacionId}`,
 *    la fija el llamador), NUNCA aleatoria. El adaptador real la pasa al header
 *    `Idempotency-Key` de Fintoc para que el proveedor deduplique del lado
 *    externo ante un reintento. Es la barrera anti-doble-pago de aplicación; la
 *    barrera DURA es el `UNIQUE (tenant_id, liquidacion_id)` de
 *    `dinero.payouts_conductor`.
 *  - **Secretos fuera de todo**: la credencial del proveedor (API key) NUNCA se
 *    loguea, ni aparece en errores, URLs ni en el `ResultadoPayout`. El núcleo
 *    jamás ve la forma cruda de Fintoc — solo los tipos normalizados de abajo.
 */

// ---------------------------------------------------------------------------
// Tipos normalizados del dominio (el núcleo NUNCA ve la forma cruda del proveedor)
// ---------------------------------------------------------------------------

/** Estado normalizado del resultado inmediato de instruir un payout. */
export type EstadoResultadoPayout =
  /** El proveedor aceptó la instrucción (o, en manual/stub, quedó registrada). */
  | "enviado"
  /** El proveedor rechazó por causa de negocio (cuenta inválida, etc.). NO reintentable. */
  | "rechazado"
  /** Error técnico/transitorio (timeout, red, 5xx). El job PUEDE reintentar. */
  | "fallido";

/**
 * Datos bancarios del destinatario (el conductor). Forma neutral del dominio;
 * cada adaptador la traduce a la del proveedor. El RUT viaja sin formato fijo;
 * el adaptador lo normaliza si el proveedor lo requiere.
 */
export interface DestinatarioPayout {
  /** RUT del titular de la cuenta (cuerpo + DV). */
  rut: string;
  /** Nombre del titular de la cuenta. */
  nombreCuenta: string;
  /** Banco/institución destino (nombre o código según el adaptador). */
  banco: string;
  /** Tipo de cuenta: `corriente` | `vista` | `ahorro` (el adaptador mapea al proveedor). */
  tipoCuenta: string;
  /** Número de cuenta destino. */
  numeroCuenta: string;
}

export interface CrearPayoutArgs {
  /**
   * Llave de idempotencia DETERMINÍSTICA: `payout-${liquidacionId}`. NUNCA
   * aleatoria — un reintento DEBE reusar exactamente la misma llave para que el
   * proveedor no genere una segunda transferencia. La fija el llamador (job de
   * `dinero`), no el adaptador.
   */
  idempotencyKey: string;
  /**
   * Monto LÍQUIDO en CLP entero que se transfiere — ya NETO de retención (boleta
   * de terceros, etc.). El cálculo de retención es responsabilidad de `dinero`
   * (no del adaptador): el puerto recibe el neto a mover, no el bruto.
   */
  montoLiquidoClp: number;
  /** Cuenta destino del conductor. */
  destinatario: DestinatarioPayout;
  /**
   * Glosa/referencia visible para el destinatario y de conciliación (p. ej.
   * `Liquidacion <periodo>`). NO debe contener datos sensibles.
   */
  referencia: string;
}

/**
 * Resultado inmediato de instruir un payout. NORMALIZADO: el núcleo nunca ve la
 * respuesta cruda del proveedor. NUNCA incluye la credencial del proveedor.
 */
export interface ResultadoPayout {
  estado: EstadoResultadoPayout;
  /**
   * ID del payout/transfer asignado por el proveedor (Fintoc transfer id /
   * referencia banca / id simulado del stub). Trazabilidad, NO secreto. Presente
   * cuando `estado === 'enviado'`.
   */
  payoutExternoId?: string;
  /**
   * Referencia al comprobante (path en Storage / id externo), cuando exista en
   * este punto. En manual/stub suele venir luego, vía confirmación.
   */
  comprobanteRef?: string;
  /**
   * Descripción del error SANEADA (sin API keys, tokens ni credenciales).
   * Presente cuando `estado === 'rechazado' | 'fallido'`.
   */
  errorDescripcion?: string;
}

/** Estado del payout en el proveedor, consultado de forma diferida. */
export type EstadoExternoPayout =
  /** El proveedor confirmó la transferencia (dinero efectivamente movido). */
  | "confirmado"
  /** Aún en proceso / a la espera de confirmación (incluye espera de confirmación manual). */
  | "pendiente"
  /** El proveedor rechazó la transferencia. */
  | "rechazado";

export interface ConsultarPayoutArgs {
  /** ID del payout en el proveedor (el `payoutExternoId` devuelto por `crearPayout`). */
  payoutExternoId: string;
}

export interface EstadoPayoutExterno {
  payoutExternoId: string;
  estado: EstadoExternoPayout;
  /** Descripción del estado SANEADA (sin secretos), o `null`. */
  descripcion: string | null;
  /** Path/ref del comprobante si el proveedor lo expone, o `null`. */
  comprobanteRef: string | null;
}

export interface ValidarFirmaWebhookPayoutArgs {
  /**
   * Cuerpo CRUDO de la request (bytes tal cual llegaron, como string UTF-8). La
   * firma se calcula sobre el raw body — NO sobre el JSON re-serializado.
   */
  cuerpo: string;
  /** Valor del header de firma del proveedor (formato `t=<ts>,v1=<hex>` en Fintoc). */
  firma: string;
  /** Secreto del Webhook Endpoint, YA DESCIFRADO. NUNCA se loguea ni va en errores. */
  secreto: string;
}

// ---------------------------------------------------------------------------
// Evento de webhook de payout SALIENTE (confirmación instantánea, Fintoc
// `transfer.outbound.*`). El núcleo NUNCA ve la forma cruda de Fintoc: el
// adaptador la traduce a este tipo de dominio.
// ---------------------------------------------------------------------------

/**
 * Estado interno del payout tras un evento de webhook. Es un SUPERCONJUNTO de
 * `EstadoExternoPayout` (el de `consultarPayout`, que solo distingue
 * confirmado/pendiente/rechazado en el sondeo): el webhook además diferencia
 * `fallido` (nunca llegó a destino) de `rechazado` (declinado/revertido) y
 * `desconocido` (status no mapeado — se registra para auditoría, no actúa).
 *
 * Los cinco valores calzan EXACTAMENTE con el CHECK de
 * `dinero.eventos_payout_externos.estado_externo` (migración 0037), para que el
 * backend (fase 3) persista el valor sin re-mapear.
 */
export type EstadoExternoEventoPayout =
  /** El proveedor confirmó la transferencia (`succeeded`). Dinero movido. */
  | "confirmado"
  /** Aún en proceso / reversión en curso (`pending` | `return_pending`). */
  | "pendiente"
  /** No llegó al destino (`failed`). Técnicamente no se completó. */
  | "fallido"
  /** Declinado por la institución o revertido (`rejected` | `returned`). */
  | "rechazado"
  /** Status no reconocido (p. ej. `reject_failed`): se registra, no dispara acción. */
  | "desconocido";

/**
 * Evento de webhook de payout saliente ya NORMALIZADO. El adaptador es el único
 * que conoce la forma cruda de Fintoc; el núcleo trabaja solo con este tipo.
 */
export interface EventoWebhookPayout {
  /**
   * ID del EVENTO en el proveedor (Fintoc `evt_...`). Es la BARRERA DE
   * IDEMPOTENCIA (UNIQUE en `dinero.eventos_payout_externos.evento_externo_id`):
   * el mismo evento reentregado por el proveedor no se procesa dos veces.
   */
  eventoExternoId: string;
  /**
   * ID del TRANSFER en el proveedor (Fintoc `tr_...`). Correlaciona con
   * `dinero.payouts_conductor.payout_externo_id` para hallar el payout que este
   * evento confirma/rechaza/revierte.
   */
  transferExternoId: string;
  /** Estado interno traducido del `status` del transfer (no del `type` del evento). */
  estadoExterno: EstadoExternoEventoPayout;
  /** Motivo de rechazo/reversión SANEADO (Fintoc `return_reason`), o `null`. */
  motivo: string | null;
  /** Referencia al comprobante (Fintoc `receipt_url`), o `null`. */
  comprobanteRef: string | null;
  /**
   * Subconjunto MÍNIMO y NO SENSIBLE del payload, listo para persistir en
   * `dinero.eventos_payout_externos.payload_sanitizado`. SOLO campos de negocio
   * (ids, status, currency, amount, return_reason, receipt_url) — NUNCA
   * `counterparty` (datos bancarios del conductor) ni tokens/secretos. El backend
   * lo guarda tal cual, sin volver a tocar la forma cruda de Fintoc.
   */
  payloadSanitizado: Record<string, unknown>;
}

/**
 * Contrato que todo adaptador de payout saliente concreto debe cumplir.
 */
export interface PuertoPayout {
  /**
   * Instruye una transferencia saliente del courier al conductor. Idempotente
   * vía `idempotencyKey` determinística. En sandbox (stub) NO mueve plata real.
   * Resiliente: el adaptador real reintenta 429/5xx con backoff; los errores
   * transitorios afloran como `estado:'fallido'` (reintentable por el job).
   */
  crearPayout(args: CrearPayoutArgs): Promise<ResultadoPayout>;

  /**
   * Consulta el estado del payout en el proveedor. Para el método manual, queda
   * `pendiente` hasta que un humano confirme/suba el comprobante.
   */
  consultarPayout(args: ConsultarPayoutArgs): Promise<EstadoPayoutExterno>;

  /**
   * Valida la firma del webhook del proveedor contra el `cuerpo` crudo y el
   * `secreto`. Comparación de tiempo constante; tolerancia anti-replay. NUNCA
   * lanza con el secreto en el mensaje. Los métodos sin firma de proveedor
   * (stub, manual) devuelven `false` siempre (no procesan webhooks).
   */
  validarFirmaWebhook(args: ValidarFirmaWebhookPayoutArgs): boolean;

  /**
   * Normaliza el payload CRUDO de un evento de webhook de payout saliente
   * (`transfer.outbound.*`) al `EventoWebhookPayout` del dominio. Quien llama
   * DEBE haber validado la firma antes; este método NO valida firma, solo traduce
   * forma. Devuelve `null` si el payload no tiene la forma esperada de un evento
   * de transferencia saliente (el caller decide: típicamente ignorar con 200).
   *
   * Los métodos sin webhook de proveedor (stub, manual) devuelven `null` siempre.
   */
  normalizarEventoWebhookPayout(payloadCrudo: unknown): EventoWebhookPayout | null;
}
