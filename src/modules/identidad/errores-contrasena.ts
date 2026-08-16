/**
 * Traduce los errores de `auth.updateUser` que la PERSONA puede resolver.
 * =============================================================================
 * Existe por un caso real encontrado probando la recuperación de contraseña
 * (2026-08-16): quien reponía la misma clave que ya tenía veía
 * *"No pudimos guardar tu contraseña por un problema de nuestro sistema.
 * Intenta de nuevo en unos minutos."*
 *
 * Ese mensaje está mal por dos motivos a la vez, y el segundo es el grave:
 *   1. Culpa a Rutax de algo que hizo el usuario.
 *   2. **Le pide que espere, y esperar no lo arregla nunca.** Puede reintentar
 *      toda la tarde con la misma contraseña y va a fallar siempre igual.
 *
 * REGLA DE DISEÑO: solo se traducen los errores sobre los que la persona puede
 * actuar. Cualquier otro fallo de Auth (red, servicio caído, configuración)
 * sigue cayendo al mensaje genérico de sistema — inventarle una causa concreta
 * a un fallo que no entendemos manda al usuario a arreglar lo que no está roto.
 *
 * Se lee `code` y NO el texto del error: `message` viene en inglés desde
 * GoTrue y cambia entre versiones sin aviso. `code` es el contrato estable.
 */

/** Códigos de GoTrue que describen algo que el usuario puede corregir solo. */
const MENSAJES_ACCIONABLES: Record<string, string> = {
  // GoTrue responde 422 `same_password` cuando la clave nueva es igual a la vigente.
  same_password:
    'Esa es la contraseña que ya tenías. Elige una distinta para poder guardarla.',
  // El proyecto exige una fortaleza mínima que esta clave no alcanza.
  weak_password:
    'Esa contraseña es demasiado fácil de adivinar. Prueba una más larga, o mezcla mayúsculas, números y símbolos.',
};

/**
 * Devuelve el mensaje en español para el usuario, o `null` si el error no es
 * de los que la persona puede resolver (y entonces el llamador debe usar su
 * mensaje genérico de sistema).
 *
 * Acepta `unknown` a propósito: el tipo `AuthError` de supabase-js declara
 * `code` como opcional, y una versión vieja del cliente podría no traerlo.
 */
export function mensajeErrorContrasenaAccionable(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;

  const codigo = (error as { code?: unknown }).code;
  if (typeof codigo !== 'string') return null;

  return MENSAJES_ACCIONABLES[codigo] ?? null;
}
