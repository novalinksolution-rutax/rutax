/**
 * Normalización de teléfonos a E.164 para la Cloud API de WhatsApp.
 * =============================================================================
 *
 * La Cloud API quiere el número en el campo `to` **sin el signo `+`** y sin
 * separadores: `56947095571`. Lo que escribe una persona en un formulario es
 * cualquier otra cosa — `+56 9 4709 5571`, `9 4709 5571`, `(56) 9-4709-5571`.
 *
 * ⚠️ POR QUÉ IMPORTA MÁS DE LO QUE PARECE: Meta **acepta** un número mal
 * formado y responde 200. El mensaje simplemente nunca llega, y el acuse de
 * `failed` puede tardar o no venir nunca. Un número sin normalizar no falla
 * ruidoso: desaparece. Por eso la normalización es una barrera de entrada
 * (antes de guardar el contacto) y no una conveniencia de presentación.
 *
 * ALCANCE: Chile por defecto (el producto es Chile-only), pero un número que ya
 * trae su código de país se respeta tal cual — no se le antepone 56 a la fuerza.
 *
 * REGLAS DE DEPENDENCIAS (hoja del grafo): no importa nada.
 */

/** Código de país de Chile. El producto es Chile-only (multi-país es "Más adelante"). */
const CODIGO_PAIS_CHILE = "56";

/**
 * Largo de un móvil chileno sin código de país: `9XXXXXXXX`.
 * Los fijos (`2XXXXXXXX`) tienen el mismo largo y también se aceptan — WhatsApp
 * corre en fijos con la app Business, y una bodega puede tener uno.
 */
const LARGO_NACIONAL_CL = 9;

/** E.164 admite entre 8 y 15 dígitos en total, y nunca empieza en 0. */
const E164 = /^[1-9][0-9]{7,14}$/;

export type MotivoTelefonoInvalido =
  | "vacio"
  | "sin_digitos"
  | "demasiado_corto"
  | "demasiado_largo"
  | "formato";

export type ResultadoNormalizacion =
  | { valido: true; telefonoE164: string }
  | { valido: false; motivo: MotivoTelefonoInvalido };

/**
 * Lleva lo que sea que haya escrito una persona a E.164 sin `+`.
 *
 * Nunca lanza y **nunca devuelve el número en el motivo del error**: el
 * teléfono es dato personal y el motivo termina en logs y en respuestas HTTP.
 */
export function normalizarTelefonoE164(entrada: string | null | undefined): ResultadoNormalizacion {
  if (typeof entrada !== "string" || entrada.trim().length === 0) {
    return { valido: false, motivo: "vacio" };
  }

  // Fuera todo lo que no sea dígito: espacios, guiones, paréntesis, el `+`.
  let digitos = entrada.replace(/\D/g, "");
  if (digitos.length === 0) {
    return { valido: false, motivo: "sin_digitos" };
  }

  // `0056…` y `056…` son formas de marcar internacional. El `00` es el prefijo
  // de salida internacional y el `0` suelto el de larga distancia nacional;
  // ninguno de los dos va en E.164.
  digitos = digitos.replace(/^0+/, "");
  if (digitos.length === 0) {
    return { valido: false, motivo: "formato" };
  }

  // Un número nacional chileno (`9XXXXXXXX`) recibe su código de país.
  //
  // ⚠️ El orden importa: se comprueba PRIMERO si ya viene con código. Un
  // `56912345678` mide 11 y no entra acá, que es lo correcto; si se antepusiera
  // 56 a ciegas quedaría `5656912345678`, un número que Meta acepta y que no
  // existe.
  if (digitos.length === LARGO_NACIONAL_CL && !digitos.startsWith(CODIGO_PAIS_CHILE)) {
    digitos = `${CODIGO_PAIS_CHILE}${digitos}`;
  }

  if (digitos.length < 8) return { valido: false, motivo: "demasiado_corto" };
  if (digitos.length > 15) return { valido: false, motivo: "demasiado_largo" };
  if (!E164.test(digitos)) return { valido: false, motivo: "formato" };

  return { valido: true, telefonoE164: digitos };
}

/** Texto en castellano para mostrarle a quien dio de alta el contacto. */
export const MENSAJE_TELEFONO_INVALIDO: Record<MotivoTelefonoInvalido, string> = {
  vacio: "Escribe un número de teléfono.",
  sin_digitos: "El teléfono no tiene ningún número.",
  demasiado_corto: "El teléfono tiene menos dígitos de los que corresponde.",
  demasiado_largo: "El teléfono tiene más dígitos de los que corresponde.",
  formato: "Revisa el teléfono: no tiene un formato que WhatsApp reconozca.",
};

/**
 * Deja el número apto para MOSTRAR en pantalla sin exponerlo entero:
 * `56947095571` → `+56 9 **** 5571`.
 *
 * Se usa en confirmaciones y listados. No es cifrado ni pretende serlo: es
 * minimización — el courier necesita reconocer cuál de sus contactos es, no
 * leer el número completo cada vez.
 */
export function enmascararTelefono(telefonoE164: string): string {
  if (!E164.test(telefonoE164)) return "número inválido";
  const ultimos = telefonoE164.slice(-4);
  if (telefonoE164.startsWith(CODIGO_PAIS_CHILE) && telefonoE164.length === 11) {
    return `+56 ${telefonoE164[2]} **** ${ultimos}`;
  }
  return `+${telefonoE164.slice(0, 2)} **** ${ultimos}`;
}
