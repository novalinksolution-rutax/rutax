/**
 * Puerto de EMAIL — única puerta por la que el sistema envía correo al
 * courier (F2 "Ola 3", ítem M). Molde: `integraciones/pagos/payout/puerto-payout.ts`
 * (interfaz + fábrica con gate sandbox/real) y `integraciones/dte/adaptadores/
 * simplefactura.ts` (stub por defecto, real detrás de opt-in).
 * =============================================================================
 *
 * NO confundir con `integraciones/notificaciones/conexion-caida.ts` (un JOB que
 * hoy solo loguea/registra bitácora): este es el PUERTO que ese job — y los
 * nuevos jobs de `plataforma/notificaciones.ts` — deben usar en vez de llamar a
 * un proveedor de email directo desde la lógica de negocio.
 *
 * GARANTÍAS DEL CONTRATO:
 *  - **Sandbox por defecto**: salvo `EMAIL_SANDBOX_MODE=false` Y `RESEND_API_KEY`
 *    presente, NINGÚN adaptador envía correo real. La fábrica (`fabrica-email.ts`)
 *    resuelve el gate.
 *  - **Nunca lanza**: `enviarEmail` SIEMPRE devuelve un `ResultadoEnvioEmail`
 *    (nunca un `throw`) — el llamador (job Inngest) decide si un fallo de envío
 *    en modo real amerita reintento (lanzando dentro de su propio `step.run`).
 *    Esto evita que el correo se vuelva una dependencia dura del camino
 *    crítico: si el puerto falla, como mucho el job reintenta — nunca rompe el
 *    flujo de negocio que lo disparó (el pago/cobro/trial ya se procesó antes).
 *  - **Secretos fuera de todo**: la API key del proveedor NUNCA se loguea, ni
 *    aparece en errores ni en el `ResultadoEnvioEmail`.
 */

export interface EnviarEmailArgs {
  /** Dirección del destinatario. */
  para: string;
  asunto: string;
  /** Cuerpo HTML del correo. */
  html: string;
  /** Alternativa en texto plano (recomendada para deliverability). */
  texto?: string;
}

export interface ResultadoEnvioEmail {
  /** `true` solo si el proveedor REAL aceptó el envío. En modo stub, siempre `false`. */
  enviado: boolean;
  modo: 'stub' | 'real';
  /** ID del mensaje asignado por el proveedor (trazabilidad, no secreto). Solo si `enviado`. */
  proveedorId?: string;
  /** Descripción del error SANEADA (sin API keys). Presente cuando `enviado === false` y `modo === 'real'`. */
  errorDescripcion?: string;
}

/** Contrato que todo adaptador de email concreto debe cumplir. */
export interface PuertoEmail {
  enviarEmail(args: EnviarEmailArgs): Promise<ResultadoEnvioEmail>;
}
