/**
 * Direcciones de contacto de Rutax (el SaaS, no el courier).
 * =============================================================================
 * Existe porque el placeholder `soporte@plataforma.cl` —un dominio que nunca
 * existió— sobrevivió repartido en seis lugares entre el cuerpo de los correos
 * de suscripción y tres pantallas, y se descubrió recién al enrolar el correo
 * real (2026-08-16). Una constante compartida es lo único que impide que la
 * próxima vez vuelvan a divergir.
 *
 * NO confundir con el contacto del COURIER hacia SUS sellers: esto es Rutax
 * atendiendo al courier (backstage/`plataforma`), no el courier atendiendo a su
 * cliente.
 *
 * Cambiar estas direcciones exige que existan como buzón o alias en Zoho Mail:
 * una dirección de soporte que rebota es peor que no ofrecer ninguna.
 */

/**
 * Casilla de soporte que se le ofrece al courier.
 *
 * Es el buzón real de Zoho Mail, NO un alias: se decidió (2026-08-16) no crear
 * `soporte@` para no multiplicar direcciones que hay que mantener. Una casilla
 * que existe y alguien lee vale más que una bonita que rebota. El día que haya
 * equipo de soporte, esto cambia acá y en ningún otro lado.
 */
export const EMAIL_SOPORTE_RUTAX = 'admin@rutax.io';

/** `mailto:` listo para un `href`. */
export const MAILTO_SOPORTE_RUTAX = `mailto:${EMAIL_SOPORTE_RUTAX}`;
