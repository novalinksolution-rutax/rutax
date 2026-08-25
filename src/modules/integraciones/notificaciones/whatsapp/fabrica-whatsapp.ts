/**
 * Fábrica del puerto de WHATSAPP.
 * =============================================================================
 * Patrón idéntico a `obtenerPuertoEmail`/`obtenerPuertoPayout`/`obtenerPuertoDte`:
 * resuelve el gate sandbox/real desde variables de entorno y devuelve el
 * adaptador concreto. El resto del sistema trabaja solo contra `PuertoWhatsApp`.
 *
 * -----------------------------------------------------------------------------
 * GATE SANDBOX/REAL — y por qué acá es más estricto que en email
 * -----------------------------------------------------------------------------
 * Se devuelve el adaptador REAL solo si se cumple TODO:
 *   1. `WHATSAPP_SANDBOX_MODE=false` (literal — cualquier otro valor, incluida
 *      su ausencia, mantiene sandbox: seguridad por defecto).
 *   2. `WHATSAPP_ACCESS_TOKEN` presente.
 *   3. `WHATSAPP_PHONE_NUMBER_ID` presente.
 * Si falta CUALQUIERA → `StubWhatsAppAdapter`.
 *
 * Un correo de más es molesto; un WhatsApp de más **se cobra a la tarjeta que
 * Rutax tiene registrada en Meta** y, si el destinatario lo reporta, baja la
 * calificación de calidad del número — que es UNO SOLO para todos los couriers.
 * El default cerrado no es ceremonia.
 *
 * -----------------------------------------------------------------------------
 * ES CONFIG DE PLATAFORMA, NO OPT-IN POR TENANT
 * -----------------------------------------------------------------------------
 * A diferencia de DTE (`emision_dte_real_habilitada` por courier), acá el emisor
 * es Rutax: el courier no tiene nada que activar. La relación es 1:N — un número
 * oficial, N tenants como destinatarios (decisión del usuario, 2026-08-25).
 *
 * ⚠️ PUNTO DE EXTENSIÓN, A PROPÓSITO. Si algún día cada courier tiene su propio
 * número (modelo Tech Provider de Meta), el cambio entra AQUÍ —resolviendo la
 * credencial según el tenant— y no toca ni el puerto, ni el servicio de envío,
 * ni un solo llamador. Por eso la función acepta un `tenantId` opcional que hoy
 * no usa: es el hueco donde encajaría, y dejarlo puesto cuesta cero.
 */

import { StubWhatsAppAdapter } from "./adaptadores/stub";
import { CloudApiWhatsAppAdapter } from "./adaptadores/cloud-api";
import type { PuertoWhatsApp } from "./puerto-whatsapp";

/**
 * Versión de la Graph API por defecto.
 *
 * Meta mantiene cada versión unos dos años y luego la retira; una versión
 * caducada empieza a responder errores de golpe. Se puede fijar por entorno
 * (`WHATSAPP_API_VERSION`) para poder subirla sin desplegar código.
 */
const VERSION_API_DEFAULT = "v25.0";

/**
 * ¿El modo sandbox de WhatsApp está activo? Default SÍ. Solo el valor literal
 * `"false"` lo desactiva — ausente, vacío o cualquier otra cosa es sandbox.
 * Misma semántica que `emailSandboxActivo`/`payoutSandboxActivo`.
 */
export function whatsappSandboxActivo(): boolean {
  return process.env.WHATSAPP_SANDBOX_MODE !== "false";
}

/**
 * ¿Están las tres piezas necesarias para hablar con Meta?
 *
 * Se expone aparte del gate para que la ruta de diagnóstico pueda decir "falta
 * configuración" y no "estás en sandbox", que son problemas distintos.
 */
export function whatsappConfigurado(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/**
 * Devuelve el adaptador de WhatsApp aplicando el gate sandbox/real.
 *
 * @param _tenantId Reservado. Hoy no se usa (el emisor es único); existe para
 *   que un futuro modelo de número-por-courier no obligue a tocar llamadores.
 */
export function obtenerPuertoWhatsApp(_tenantId?: string): PuertoWhatsApp {
  const gateRealAbierto = !whatsappSandboxActivo() && whatsappConfigurado();

  if (!gateRealAbierto) {
    return new StubWhatsAppAdapter();
  }

  return new CloudApiWhatsAppAdapter({
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN as string,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID as string,
    version: process.env.WHATSAPP_API_VERSION?.trim() || VERSION_API_DEFAULT,
  });
}
