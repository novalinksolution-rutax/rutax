/**
 * Redacción de datos sensibles para observabilidad.
 * =====================================================================
 * Antes de que CUALQUIER contexto viaje a Sentry o al log estructurado, se
 * poda de secretos y datos personales. Es el requisito "Redacción automática
 * de secretos y datos sensibles" de la auditoría (§2.7) y la regla dura del
 * proyecto: certificados, tokens y credenciales NUNCA en logs.
 *
 * Estrategia:
 * - Por LLAVE: si el nombre de la propiedad calza con un patrón sensible
 *   (token, secret, clave, authorization, rut, email, teléfono, dirección,
 *   nombre del destinatario…), el VALOR se reemplaza por '[redactado]'.
 * - Por VALOR: strings con forma de JWT o de secreto largo se redactan aunque
 *   su llave sea inocua (defensa en profundidad).
 * - Recursivo con tope de profundidad y de largo — un contexto no puede
 *   convertir la observabilidad en un problema de memoria.
 *
 * NO se redactan identificadores de negocio (tenant_id, pedido_id, etc.): son
 * necesarios para triar y no son secretos ni PII directa.
 */

/** Llaves cuyo valor es secreto (jamás sale) o PII directa (minimización). */
const PATRON_LLAVE_SENSIBLE =
  /(pass(word)?|contrase|secret|secreto|token|bearer|authorization|api[_-]?key|apikey|clave|caf|certificad|cookie|firma|signature|link[_-]?token|refresh|access[_-]?token|dsn|\brut\b|\bdni\b|email|correo|e-mail|telefono|tel[eé]fono|celular|direccion|direcci[oó]n|nombre_destinatario|destinatario)/i;

/** Forma de JWT: tres segmentos base64url separados por punto. */
const PATRON_JWT = /^ey[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+$/;

const PROFUNDIDAD_MAX = 6;
const LARGO_STRING_MAX = 2048;
const ITEMS_ARRAY_MAX = 100;

export const MARCA_REDACTADO = '[redactado]';

function pareceSecretoPorValor(valor: string): boolean {
  if (PATRON_JWT.test(valor)) return true;
  // Base64/hex largo y sin espacios → probable credencial/hash.
  if (valor.length >= 40 && /^[A-Za-z0-9+/=_-]+$/.test(valor)) return true;
  return false;
}

/**
 * Devuelve una copia del valor con secretos y PII redactados. No muta el input.
 * Seguro ante ciclos (los corta por profundidad) y valores no serializables.
 */
export function redactarSensible(valor: unknown, profundidad = 0): unknown {
  if (valor === null || valor === undefined) return valor;

  if (typeof valor === 'string') {
    if (valor.length > LARGO_STRING_MAX) {
      return `${valor.slice(0, LARGO_STRING_MAX)}…[truncado ${valor.length}]`;
    }
    return pareceSecretoPorValor(valor) ? MARCA_REDACTADO : valor;
  }

  if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
  if (typeof valor === 'bigint') return valor.toString();

  if (profundidad >= PROFUNDIDAD_MAX) return '[profundidad máxima]';

  if (Array.isArray(valor)) {
    const recortado = valor.slice(0, ITEMS_ARRAY_MAX).map((v) => redactarSensible(v, profundidad + 1));
    if (valor.length > ITEMS_ARRAY_MAX) recortado.push(`…[${valor.length - ITEMS_ARRAY_MAX} más]`);
    return recortado;
  }

  if (valor instanceof Error) {
    return { name: valor.name, message: valor.message };
  }

  if (typeof valor === 'object') {
    const salida: Record<string, unknown> = {};
    for (const [llave, v] of Object.entries(valor as Record<string, unknown>)) {
      if (PATRON_LLAVE_SENSIBLE.test(llave)) {
        salida[llave] = MARCA_REDACTADO;
      } else {
        salida[llave] = redactarSensible(v, profundidad + 1);
      }
    }
    return salida;
  }

  // Funciones, símbolos, etc. — no se reportan.
  return `[${typeof valor}]`;
}
