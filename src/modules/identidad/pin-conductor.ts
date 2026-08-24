/**
 * El PIN del conductor — las reglas, del lado del servidor.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ ES
 * -----------------------------------------------------------------------------
 * Seis dígitos que el conductor elige **una vez**, al aceptar la invitación de su
 * courier, y que después usa para entrar a la app y para desbloquearla.
 *
 * ⚠️ **El PIN ES la contraseña de Supabase.** No hay credencial paralela ni tabla
 * nueva: `minimum_password_length` está en 6 y `password_requirements` vacío, así
 * que seis dígitos son una contraseña válida. Todo lo que el producto ya sabe
 * hacer con contraseñas sigue funcionando igual.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ ESTE ARCHIVO TIENE UN GEMELO EN EL OTRO REPO, Y LOS DOS TIENEN QUE MOVERSE JUNTOS
 * -----------------------------------------------------------------------------
 * `Desktop/rutax-conductor/src/lib/pin-conductor.ts` aplica **las mismas reglas**
 * en la pantalla donde el conductor elige un PIN nuevo tras olvidarlo. No se
 * pueden compartir: son dos repos separados a propósito, y el acoplamiento real
 * entre ellos es por HTTP, no por código.
 *
 * La consecuencia es concreta y hay que tenerla presente: **si acá se relaja una
 * regla y allá no, el conductor puede elegir en la app un PIN que la web habría
 * rechazado, y al revés.** Las pruebas de los dos lados fijan los mismos casos
 * exactos —`000000`, `123456`, `121212`, `123123`— justamente para que un cambio
 * en uno solo se vea en rojo.
 *
 * Es el mismo patrón que ya mordió con el tope de cuentas de Mercado Libre, que
 * vivía en una función SQL **y** en una constante de TypeScript sin nada que las
 * atara.
 *
 * -----------------------------------------------------------------------------
 * ESTA ES LA MITAD QUE MANDA
 * -----------------------------------------------------------------------------
 * El PIN se **fija** acá (al aceptar la invitación) y en la app solo se cambia
 * por el camino de recuperación. Si alguna vez las dos listas divergen, la buena
 * es esta: es la que corre en el servidor, donde el formulario no se puede
 * saltar.
 */

/** Seis, y coincide con `minimum_password_length` de Supabase. Cambiar uno es cambiar el otro. */
export const LARGO_PIN = 6;

/** Deja solo dígitos y corta en seis. */
export function soloDigitosPin(valor: string): string {
  return valor.replace(/\D/g, "").slice(0, LARGO_PIN);
}

export type RechazoPin = "corto" | "todos_iguales" | "seguidos" | "patron_repetido";

/**
 * ⚠️ **Esta lista es corta a propósito, y tiene que quedarse corta.**
 *
 * Rechaza las tres familias que la gente elige sin pensar y que un atacante
 * prueba primero: `000000`, `123456` / `654321`, y `121212` / `123123`. Son
 * **1.100 de un millón** — o sea, prohibirlas no le quita nada al espacio de
 * búsqueda, pero saca de circulación las que se aciertan a la primera.
 *
 * **Lo que NO se hace, y es deliberado:** nada de exigir «que no sea tu año de
 * nacimiento» ni listas largas de PIN comunes. Cada regla extra empuja al
 * conductor a anotarlo en un papel dentro de la van, que es peor que cualquier
 * PIN débil.
 */
export function rechazarPin(valor: string): RechazoPin | null {
  const pin = soloDigitosPin(valor);
  if (pin.length < LARGO_PIN) return "corto";

  if (/^(\d)\1{5}$/.test(pin)) return "todos_iguales";

  const digitos = [...pin].map(Number);
  const sube = digitos.every((d, i) => i === 0 || d === digitos[i - 1] + 1);
  const baja = digitos.every((d, i) => i === 0 || d === digitos[i - 1] - 1);
  if (sube || baja) return "seguidos";

  if (pin.slice(0, 2).repeat(3) === pin) return "patron_repetido";
  if (pin.slice(0, 3).repeat(2) === pin) return "patron_repetido";

  return null;
}

/**
 * Los textos, y el criterio: **cada uno dice qué hacer**, no solo qué está mal.
 * «PIN inválido» deja a alguien probando al azar en la pantalla donde define la
 * credencial que va a usar todos los días.
 */
export const TEXTO_RECHAZO: Record<RechazoPin, string> = {
  corto: "Tienen que ser 6 números.",
  todos_iguales: "Todos iguales es de los primeros que alguien probaría. Cambia alguno.",
  seguidos: "Números seguidos es de los primeros que alguien probaría. Mézclalos.",
  patron_repetido: "Ese patrón se repite y se adivina fácil. Cámbialo.",
};

/** ¿El valor que llegó es un PIN aceptable? Atajo para las barreras del servidor. */
export function esPinValido(valor: string): boolean {
  return rechazarPin(valor) === null;
}
