/**
 * Normalización de teléfonos chilenos a E.164.
 * =============================================================================
 * Lo que escribe una persona en un formulario es cualquier cosa —
 * `+56 9 4709 5571`, `9 4709 5571`, `(56) 9-4709-5571`, `0056947095571`— y lo
 * que hay que guardar es siempre lo mismo: `56947095571`.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ VIVE EN `lib` Y NO DENTRO DE WHATSAPP, QUE ES DONDE NACIÓ
 * -----------------------------------------------------------------------------
 * Nació en `integraciones/notificaciones/whatsapp` porque el primer campo de
 * teléfono del producto fue el del destinatario de avisos. Al aparecer el
 * segundo —el del conductor, que es de `identidad`— quedaban dos salidas malas:
 * duplicar la función (dos normalizaciones que se separan con el tiempo, y el
 * mismo número guardado de dos formas distintas), o que `identidad` importara
 * de un adaptador de integraciones, que es exactamente el acoplamiento que la
 * separación por módulos evita.
 *
 * Así que el mecanismo sube acá y WhatsApp lo consume. **Los textos de error se
 * quedan en cada llamador**: «no tiene un formato que WhatsApp reconozca» no
 * sirve en la ficha de un conductor.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ ES UNA BARRERA DE ENTRADA, NO UN FORMATO DE PRESENTACIÓN
 * -----------------------------------------------------------------------------
 * Un número mal formado **no falla ruidoso: desaparece**. Meta acepta cualquier
 * cosa y responde 200, y el mensaje no llega nunca. Un teléfono de conductor mal
 * guardado se descubre el día que hay que llamarlo y no contesta nadie. Por eso
 * se normaliza ANTES de escribir en la base, no al mostrar.
 *
 * ALCANCE: Chile por defecto (el producto es Chile-only), pero un número que ya
 * trae su código de país se respeta tal cual — no se le antepone 56 a la fuerza.
 *
 * REGLAS DE DEPENDENCIAS (hoja del grafo): no importa nada.
 */

/** Código de país de Chile. El producto es Chile-only (multi-país es "Más adelante"). */
const CODIGO_PAIS_CHILE = "56";

/**
 * Largo de un número chileno sin código de país: `9XXXXXXXX`.
 * Los fijos (`2XXXXXXXX`) miden lo mismo y también se aceptan.
 */
const LARGO_NACIONAL_CL = 9;

/** E.164 admite entre 8 y 15 dígitos en total, y nunca empieza en 0. */
export const PATRON_E164 = /^[1-9][0-9]{7,14}$/;

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
  // 56 a ciegas quedaría `5656912345678`, un número que se acepta y que no
  // existe.
  if (digitos.length === LARGO_NACIONAL_CL && !digitos.startsWith(CODIGO_PAIS_CHILE)) {
    digitos = `${CODIGO_PAIS_CHILE}${digitos}`;
  }

  if (digitos.length < 8) return { valido: false, motivo: "demasiado_corto" };
  if (digitos.length > 15) return { valido: false, motivo: "demasiado_largo" };
  if (!PATRON_E164.test(digitos)) return { valido: false, motivo: "formato" };

  return { valido: true, telefonoE164: digitos };
}

/**
 * Deja el número apto para MOSTRAR sin exponerlo entero:
 * `56947095571` → `+56 9 **** 5571`.
 *
 * No es cifrado ni pretende serlo: es minimización. Se usa donde basta con
 * reconocer de quién es el número, típicamente un listado.
 */
export function enmascararTelefono(telefonoE164: string): string {
  if (!PATRON_E164.test(telefonoE164)) return "número inválido";
  const ultimos = telefonoE164.slice(-4);
  if (telefonoE164.startsWith(CODIGO_PAIS_CHILE) && telefonoE164.length === 11) {
    return `+56 ${telefonoE164[2]} **** ${ultimos}`;
  }
  return `+${telefonoE164.slice(0, 2)} **** ${ultimos}`;
}

/**
 * El número entero, con separadores, para cuando SÍ hay que leerlo:
 * `56947095571` → `+56 9 4709 5571`.
 *
 * Existe porque enmascarar no siempre corresponde. A un coordinador que tiene
 * que llamar a su conductor, `+56 9 **** 5571` no le sirve de nada: la
 * minimización protege del vistazo ajeno, no de la persona cuyo trabajo es
 * justamente marcar ese número. Quién ve cuál lo decide el llamador.
 */
export function formatearTelefonoLegible(telefonoE164: string): string {
  if (!PATRON_E164.test(telefonoE164)) return telefonoE164;
  if (telefonoE164.startsWith(CODIGO_PAIS_CHILE) && telefonoE164.length === 11) {
    const nacional = telefonoE164.slice(2); // 9XXXXXXXX
    return `+56 ${nacional[0]} ${nacional.slice(1, 5)} ${nacional.slice(5)}`;
  }
  return `+${telefonoE164}`;
}

/** Para un `href="tel:…"`. E.164 con `+`, sin separadores. */
export function telefonoParaMarcar(telefonoE164: string): string {
  return `+${telefonoE164}`;
}
