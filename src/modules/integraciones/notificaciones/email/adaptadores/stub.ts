/**
 * Adaptador STUB de email (sandbox por defecto en dev/CI).
 * =============================================================================
 * MOLDE: equivalente a `StubPayoutAdapter`/`SimplefacturaAdapter` — permite que
 * los jobs de notificación sean 100% testeables en Vitest sin red, sin
 * credenciales y, sobre todo, sin enviar correo real a nadie.
 *
 * Log estructurado, SIN volcar el `html`/`texto` completos (podrían llevar
 * datos operativos del courier) ni más PII que el destinatario mismo — que es
 * el dato mínimo indispensable para poder depurar en dev/staging qué se habría
 * enviado y a quién.
 *
 * REGLAS DE DEPENDENCIAS (adaptador = hoja del grafo): solo importa del puerto.
 */

import type { EnviarEmailArgs, PuertoEmail, ResultadoEnvioEmail } from '../puerto-email';

export class StubEmailAdapter implements PuertoEmail {
  async enviarEmail(args: EnviarEmailArgs): Promise<ResultadoEnvioEmail> {
    // Log estructurado intencional del stub (mismo patrón que conexion-caida.ts).
    console.info(
      '[email:stub] envío simulado (sandbox) — no se envió correo real',
      JSON.stringify({ para: args.para, asunto: args.asunto }),
    );
    return { enviado: false, modo: 'stub' };
  }
}
