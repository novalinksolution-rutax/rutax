/**
 * Normalización de `searchParams` de `/preparacion/asignar` — lógica PURA
 * (§5 del documento). Next entrega `string | string[] | undefined` para un
 * parámetro que puede repetirse en la URL (el caso de `comuna`, multi-
 * selección): estas funciones son el único lugar que sabe traducir eso a
 * algo que el resto de la pantalla puede usar sin volver a pensarlo.
 *
 * Vive en `_lib/` (no en `page.tsx`) por el motivo de siempre: es donde se
 * cuela el bug — un enlace profundo `?comuna=X` (§2.2) que llega como string
 * suelto en vez de arreglo, o un `?estado=` con un valor que no es ninguno de
 * los dos reales del enum — y Vitest no puede probar nada dentro de un
 * Server Component.
 */

import type { EstadoAsignable } from "@/modules/operacion/asignacion";

/** Lo que Next entrega para un parámetro de la URL: ausente, uno, o repetido. */
export type ValorSearchParam = string | string[] | undefined;

/**
 * Normaliza `comuna` a un arreglo sin vacíos ni duplicados. Cubre los tres
 * casos: sin parámetro (`[]`), un enlace profundo `?comuna=X` (string suelto
 * — §2.2, "Carga por comuna" y el botón "Agregar pedidos" del manifiesto), y
 * la multi-selección real del Popover (`?comuna=A&comuna=B`, que Next ya
 * entrega como arreglo).
 */
export function normalizarComunas(valor: ValorSearchParam): string[] {
  const lista = valor === undefined ? [] : Array.isArray(valor) ? valor : [valor];
  return [...new Set(lista.map((c) => c.trim()).filter((c) => c !== ""))];
}

/**
 * Sanea el chip de estado: solo los dos valores reales del enum
 * (`ESTADOS_ASIGNABLES`), o `null` ("Todos"). Cualquier otro texto —querido
 * a mano en la URL, o un valor viejo de un enlace guardado— cae a "Todos" en
 * vez de reventar el filtro con un valor que la capa de lectura no reconoce.
 */
export function normalizarEstado(valor: ValorSearchParam): EstadoAsignable | null {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  return texto === "pendiente_asignacion" || texto === "asignado" ? texto : null;
}

/** Página normalizada: entero >= 1: cualquier valor inválido cae a 1, nunca revienta. */
export function normalizarPagina(valor: ValorSearchParam): number {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  if (!texto) return 1;
  const n = Number.parseInt(texto, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Texto libre normalizado: `undefined`/vacío se homologan a `null` ("sin búsqueda"). */
export function normalizarTexto(valor: ValorSearchParam): string | null {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  const limpio = texto?.trim();
  return limpio ? limpio : null;
}

/** `true` si hay algún filtro (comuna/seller/texto/estado) activo — gobierna "Limpiar filtros". */
export function hayFiltrosActivos(entrada: {
  comunas: readonly string[];
  sellerId: string | null;
  texto: string | null;
  estado: EstadoAsignable | null;
}): boolean {
  return entrada.comunas.length > 0 || entrada.sellerId !== null || entrada.texto !== null || entrada.estado !== null;
}
