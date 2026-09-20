/**
 * Resolución de identidad — §5 y §5.1 de
 * `docs/arquitectura/conversacion-whatsapp.md`.
 * =============================================================================
 * Llega un teléfono. Hay que convertirlo en un par `(tenantId, sellerId)`, y
 * ESE PAR ES EL ÚNICO ALCANCE DE TODO LO QUE SE RESPONDE.
 *
 * `resolverAlcanceDesdeContacto` es la ÚNICA función de todo el repo que
 * produce el tipo nominal `AlcanceSeller` (§6.3): un `{ tenantId, sellerId }`
 * armado a mano en cualquier otro sitio no compila contra la superficie de
 * lectura de `operacion` — así la regla más importante de este documento se
 * vuelve un error de tipos, no una convención que alguien puede olvidar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlcanceSeller } from "../operacion/consultas/seller";

/**
 * `AlcanceSeller` NACE en `operacion/consultas/seller.ts`, no acá — la cerca
 * del módulo (§4) es de una sola vía (`conversacion → operacion`, nunca al
 * revés), así que el tipo que ambos comparten tiene que vivir en el lado que
 * `conversacion` sí puede importar. Se re-exporta para que el resto de este
 * módulo lo use sin acordarse de dónde nació.
 */
export type { AlcanceSeller };

export type ResolucionAlcance =
  | { resolucion: "resuelto"; alcance: AlcanceSeller; contactoId: string }
  /** Ningún contacto con consentimiento vigente para este teléfono. */
  | { resolucion: "sin_contacto" }
  /**
   * Más de un contacto — dos sellers, o el mismo seller en dos couriers (el
   * switcher multi-courier YA está desplegado). NO se responde nada sobre
   * ningún pedido: el bot respondería con datos del courier equivocado, y ese
   * error no se puede deshacer.
   */
  | { resolucion: "ambiguo"; contactos: number }
  /** Meta mandó algo que no normaliza a un E.164 legible. */
  | { resolucion: "ilegible" };

interface FilaContacto {
  id: string;
  tenant_id: string;
  seller_id: string;
}

/**
 * Resuelve el alcance de una consulta a partir del teléfono que escribió.
 *
 * Implementa la tabla de §5 completa:
 *  - Un contacto con consentimiento vigente (`opt_in_estado = 'otorgado'`,
 *    cualquier `origen`: `agregado_por_rutax` también puede consultar) →
 *    `resuelto`.
 *  - Ninguno → `sin_contacto`. Nunca se confirma ni se niega nada sobre un
 *    pedido a un número que Rutax no reconoce.
 *  - Más de uno → `ambiguo`. Falla cerrado, pero NO en silencio (§5.1): el
 *    llamador tiene que responder una línea neutra y contar la anomalía —esta
 *    función solo entrega el hecho, no decide la respuesta.
 *  - `telefonoE164` es `null` (Meta mandó algo ilegible) → `ilegible`, sin
 *    tocar la base: no hay nada contra qué buscar.
 */
export async function resolverAlcanceDesdeContacto(
  cliente: SupabaseClient,
  telefonoE164: string | null,
): Promise<ResolucionAlcance> {
  if (!telefonoE164) return { resolucion: "ilegible" };

  const { data, error } = await cliente
    .schema("integraciones")
    .from("whatsapp_contactos")
    .select("id, tenant_id, seller_id")
    .eq("telefono_e164", telefonoE164)
    .eq("opt_in_estado", "otorgado");

  if (error) {
    throw new Error(`No se pudo resolver el contacto de WhatsApp: ${error.message}`);
  }

  const contactos = (data ?? []) as FilaContacto[];

  if (contactos.length === 0) return { resolucion: "sin_contacto" };
  if (contactos.length > 1) return { resolucion: "ambiguo", contactos: contactos.length };

  const fila = contactos[0];
  return {
    resolucion: "resuelto",
    contactoId: fila.id,
    // Único punto del repo que fabrica un `AlcanceSeller`: acá SÍ está
    // permitido el cast (doble, a propósito — ver el tipo) porque este es
    // justamente el resultado de haber resuelto la identidad.
    alcance: { tenantId: fila.tenant_id, sellerId: fila.seller_id } as unknown as AlcanceSeller,
  };
}
