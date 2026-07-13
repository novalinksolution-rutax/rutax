/**
 * Puerto de AUTO-COBRO RECURRENTE de la suscripción SaaS (Rutax → courier).
 * =============================================================================
 * Nuevo "puerto" de `integraciones`: aísla a Fintoc Pagos Recurrentes tras una
 * interfaz de dominio. El núcleo (`plataforma`) instruye "registra el mandato" y
 * "cobra este período" contra esta interfaz — NUNCA ve la forma cruda de Fintoc
 * ni el adaptador concreto. La fábrica (`fabrica-suscripcion-recurrente.ts`)
 * resuelve el gate sandbox/opt-in y entrega el adaptador (stub o Fintoc real).
 *
 * MODELO ELEGIDO (por qué mandato + cobro explícito, y NO la auto-facturación de
 * Fintoc): Rutax debe DISPARAR el cobro cuando cierra el período (y con la
 * compuerta humana del negocio), no delegar el calendario a Fintoc. Por eso el
 * enrolamiento guarda un método de pago/mandato (checkout `flow=setup`) y cada
 * período se cobra de forma explícita e idempotente (`payment_intents`), con
 * llave determinística por período. Ver `adaptadores/fintoc.ts`.
 *
 * SEGURIDAD (CLAUDE.md): el `mandatoToken` se descifra en el punto de uso y JAMÁS
 * se loguea ni se devuelve. La metadata solo lleva uuids opacos de negocio
 * (tenant_id, suscripcion_id, periodo_id) — nunca PII ni secretos.
 */

/** Resultado de iniciar el enrolamiento de un mandato de auto-cobro. */
export interface ResultadoRegistrarMandato {
  /**
   * Id externo con el que correlacionar el enrolamiento (en Fintoc, el id de la
   * checkout session de `flow=setup`). El id DEFINITIVO del mandato (payment
   * method / subscription) llega luego en el webhook `checkout_session.finished`
   * y lo persiste `backend` cifrado; aquí es el puntero de correlación temporal.
   */
  mandatoExternoId: string;
  /** URL hospedada de Fintoc donde el courier autoriza el mandato (PAC/tarjeta). */
  urlEnrolamiento: string;
  /** Modo del enrolamiento: 'test' (sandbox) o 'live' (real). */
  modo: 'test' | 'live';
}

export interface RegistrarMandatoArgs {
  /** Tenant (courier) al que pertenece la suscripción. */
  tenantId: string;
  /** Email del courier para notificaciones de Fintoc (opcional). */
  emailCliente?: string | null;
  /**
   * Metadata que Fintoc conserva y devuelve en el webhook — clave para
   * correlacionar el mandato con la suscripción. Incluye `tenant_id` y
   * `suscripcion_id` (uuids opacos, SIN PII).
   */
  metadata: Record<string, string>;
}

/** Estado inmediato tras instruir el cobro de un período. */
export type EstadoCobroPeriodo =
  /** Fintoc aceptó el cargo (queda pendiente de confirmación por webhook). */
  | 'enviado'
  /** Fintoc rechazó por causa de negocio (mandato inválido, fondos, etc.). NO reintentable. */
  | 'rechazado'
  /** Error técnico/transitorio (timeout, red, 5xx). El job PUEDE reintentar. */
  | 'fallido';

export interface CobrarPeriodoArgs {
  /**
   * Llave de idempotencia DETERMINÍSTICA: `susc-cobro-${periodoId}`. NUNCA
   * aleatoria — un reintento DEBE reusar exactamente la misma llave para que
   * Fintoc no genere un segundo cargo. La fija el llamador (job de `plataforma`),
   * no el adaptador.
   */
  idempotencyKey: string;
  /**
   * Token/id del mandato YA ACTIVO, descifrado en el punto de uso. NUNCA se
   * loguea. Puede ser un id de payment method o un JSON compacto con el
   * payment method + subscription; el adaptador lo interpreta.
   */
  mandatoToken: string;
  /** Monto a cobrar en CLP (entero; CLP no tiene decimales → unidad mínima directa). */
  montoClp: number;
  /** Glosa/referencia visible y de conciliación. NO debe contener datos sensibles. */
  referencia: string;
  /**
   * Metadata que Fintoc conserva y devuelve en el webhook del cargo. Incluye
   * `periodo_id` y `tenant_id` (uuids opacos, SIN PII).
   */
  metadata: Record<string, string>;
}

export interface ResultadoCobrarPeriodo {
  estado: EstadoCobroPeriodo;
  /** Id del cargo/payment intent en Fintoc. Trazabilidad, NO secreto. Presente cuando `estado==='enviado'`. */
  cobroExternoId?: string;
  /** Descripción del error SANEADA (sin token, secret key ni credenciales). Presente en rechazado/fallido. */
  errorDescripcion?: string;
}

export interface CancelarMandatoArgs {
  /** Token/id del mandato a cancelar, descifrado en el punto de uso. NUNCA se loguea. */
  mandatoToken: string;
}

export interface ResultadoCancelarMandato {
  ok: boolean;
}

/**
 * Contrato del adaptador de auto-cobro recurrente. Lo resuelve
 * `fabrica-suscripcion-recurrente.ts` aplicando el gate sandbox + opt-in; el
 * núcleo (`plataforma`) nunca ve el adaptador concreto.
 */
export interface PuertoSuscripcionRecurrente {
  /**
   * Inicia el enrolamiento del mandato (PAC/tarjeta). El mandato NO queda activo
   * hasta el webhook de confirmación. Devuelve la URL hospedada donde el courier
   * autoriza. Resiliente a 429/5xx (reintenta con backoff). La secret key JAMÁS
   * se loguea ni se devuelve.
   */
  registrarMandato(args: RegistrarMandatoArgs): Promise<ResultadoRegistrarMandato>;

  /**
   * Cobra un período con un mandato YA activo. Idempotente vía `idempotencyKey`
   * determinística (el adaptador la pasa al header `Idempotency-Key` de Fintoc,
   * de modo que un reintento no genere un segundo cargo). Resiliente a 429/5xx.
   */
  cobrarPeriodo(args: CobrarPeriodoArgs): Promise<ResultadoCobrarPeriodo>;

  /**
   * Cancela el mandato en el proveedor (deja de poder cobrar). NUNCA lanza con el
   * token en el mensaje; ante error devuelve `{ ok: false }`.
   */
  cancelarMandato(args: CancelarMandatoArgs): Promise<ResultadoCancelarMandato>;
}
