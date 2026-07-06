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
}
