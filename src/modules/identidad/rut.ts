/**
 * Validación de RUT chileno (módulo 11) — utilidad compartida de `identidad`.
 *
 * Las migraciones ya validan el FORMATO en BD (`constraint *_rut_formato check
 * (rut ~ '^[0-9]{1,8}-[0-9kK]$')` en `tenants`/`sellers`/`conductores`), pero
 * ese regex no valida el DÍGITO VERIFICADOR — un RUT con formato correcto pero
 * DV inválido pasaría la BD. CLAUDE.md exige "validación de RUT" como regla de
 * localización Chile; esta utilidad cierra esa brecha en la capa de aplicación,
 * antes de que el dato llegue a la base.
 *
 * Formato esperado de entrada/salida: `NNNNNNNN-DV` (sin puntos, DV en
 * mayúscula si es K) — el mismo que exige el constraint SQL.
 */

/** Normaliza: quita puntos/espacios, pasa el DV a mayúscula. No valida — solo da forma. */
export function normalizarRut(rut: string): string {
  return rut.trim().replace(/\./g, "").toUpperCase();
}

/** Calcula el dígito verificador (módulo 11) para el cuerpo numérico del RUT. */
function calcularDigitoVerificador(cuerpo: string): string {
  let suma = 0;
  let multiplicador = 2;

  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }

  const resto = 11 - (suma % 11);
  if (resto === 11) return "0";
  if (resto === 10) return "K";
  return String(resto);
}

/**
 * Verdadero si `rut` tiene formato `NNNNNNNN-DV` (1 a 8 dígitos + DV) Y el
 * dígito verificador es matemáticamente correcto (módulo 11).
 */
export function esRutValido(rut: string): boolean {
  const normalizado = normalizarRut(rut);
  const coincidencia = /^([0-9]{1,8})-([0-9K])$/.exec(normalizado);
  if (!coincidencia) return false;

  const [, cuerpo, dv] = coincidencia;
  return calcularDigitoVerificador(cuerpo) === dv;
}

/**
 * Normaliza y valida en un solo paso. Devuelve el RUT normalizado si es
 * válido, o `null` si no lo es — pensado para usar en funciones de alta
 * (`crearTenantConDueno`, etc.) donde se necesita la forma canónica para
 * persistir y un chequeo explícito antes de tocar la base de datos.
 */
export function normalizarYValidarRut(rut: string): string | null {
  const normalizado = normalizarRut(rut);
  return esRutValido(normalizado) ? normalizado : null;
}
