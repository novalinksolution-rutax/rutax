/**
 * Teléfono chileno del paso 1: 9 dígitos (móvil o fijo con código de área), con
 * o sin +56. Devuelve E.164 (+56912345678) —lo que impone el CHECK de la
 * columna— o `null`.
 */
export function validarTelefonoCl(crudo: string): string | null {
  let d = String(crudo ?? "").replace(/[^\d]/g, "");
  if (d.startsWith("56") && d.length === 11) d = d.slice(2);
  return /^[2-9]\d{8}$/.test(d) ? `+56${d}` : null;
}

/** "+56912345678" -> "9 1234 5678" (lo que ve el campo, tras el chip +56). */
export function telefonoParaCampo(e164: string | null | undefined): string {
  if (!e164) return "";
  const d = e164.replace(/^\+56/, "").replace(/\D/g, "");
  return d.length === 9 ? `${d[0]} ${d.slice(1, 5)} ${d.slice(5)}` : d;
}

/** Máscara al escribir: solo dígitos, máximo 9, agrupados "9 1234 5678". */
export function enmascararTelefono(valor: string): string {
  const d = valor.replace(/\D/g, "").slice(0, 9);
  if (d.length <= 1) return d;
  if (d.length <= 5) return `${d[0]} ${d.slice(1)}`;
  return `${d[0]} ${d.slice(1, 5)} ${d.slice(5)}`;
}
