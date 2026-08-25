/**
 * Qué tan buena es una contraseña, dicho en una palabra.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * PARA QUÉ SIRVE UN MEDIDOR, Y PARA QUÉ NO
 * -----------------------------------------------------------------------------
 * **No es una validación.** La regla de aceptación es una sola —mínimo 8
 * caracteres— y está en el servidor. Esto es otra cosa: le dice a quien está
 * escribiendo si lo que lleva es razonable, **mientras todavía puede cambiarlo
 * sin esfuerzo**. Enterarse después de enviar es enterarse tarde.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ POR QUÉ NO EXIGE SÍMBOLOS RAROS
 * -----------------------------------------------------------------------------
 * Porque las reglas de composición —«una mayúscula, un número y un símbolo»—
 * **empeoran las contraseñas en la práctica**: producen `Rutax2026!` en vez de
 * una frase larga, y esa es más fácil de adivinar que tres palabras seguidas.
 * Lo que de verdad mueve la aguja es el **largo**, y por eso pesa más que
 * cualquier otra cosa acá. El copy de la pantalla lo dice con todas las letras:
 * «no tiene que tener símbolos raros».
 *
 * -----------------------------------------------------------------------------
 * ⚠️ Y POR QUÉ NO SE USA UNA BIBLIOTECA
 * -----------------------------------------------------------------------------
 * La buena de verdad —`zxcvbn`— pesa del orden de **400 KB** por su diccionario.
 * Esto vive en una pantalla sin sesión, que es donde la velocidad se juzga
 * primero, y a cambio de esos 400 KB daría un matiz que nadie usa: la persona
 * solo necesita saber si va bien o le falta.
 */

export type NivelFuerza = "corta" | "debil" | "buena" | "excelente";

export interface LecturaFuerza {
  nivel: NivelFuerza;
  /** La palabra que se muestra. `null` cuando todavía no hay nada que decir. */
  etiqueta: string | null;
  /** De 0 a 4, para pintar la barra. */
  pasos: number;
}

/** El mínimo que acepta el servidor. Debajo de esto no hay nivel que dar. */
export const LARGO_MINIMO = 8;

const ETIQUETAS: Record<NivelFuerza, string> = {
  corta: "Muy corta",
  debil: "Débil",
  buena: "Buena",
  excelente: "Excelente",
};

/**
 * ⚠️ **El largo manda.** Una frase de 20 caracteres en minúsculas es mejor que
 * `Ab1!xY` y el medidor tiene que decirlo, o estaría empujando a la gente hacia
 * la contraseña peor.
 *
 * La variedad suma, pero solo después de que el largo alcanza: sirve para
 * separar «buena» de «excelente», nunca para rescatar una corta.
 */
export function medirFuerza(contrasena: string): LecturaFuerza {
  const clave = contrasena ?? "";

  if (clave.length === 0) return { nivel: "corta", etiqueta: null, pasos: 0 };
  if (clave.length < LARGO_MINIMO) return { nivel: "corta", etiqueta: ETIQUETAS.corta, pasos: 1 };

  // Cuántas clases distintas usa. No se exige ninguna: solo se cuenta.
  const clases = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(clave)).length;

  // ⚠️ Una contraseña de un solo carácter repetido —`aaaaaaaaaa`— pasa el largo
  // y no vale nada. Es el caso que un medidor ingenuo aprueba con entusiasmo.
  const distintos = new Set(clave).size;
  if (distintos <= 2) return { nivel: "debil", etiqueta: ETIQUETAS.debil, pasos: 1 };

  if (clave.length >= 16 || (clave.length >= 12 && clases >= 3)) {
    return { nivel: "excelente", etiqueta: ETIQUETAS.excelente, pasos: 4 };
  }
  if (clave.length >= 12 || clases >= 3) {
    return { nivel: "buena", etiqueta: ETIQUETAS.buena, pasos: 3 };
  }
  return { nivel: "debil", etiqueta: ETIQUETAS.debil, pasos: 2 };
}
