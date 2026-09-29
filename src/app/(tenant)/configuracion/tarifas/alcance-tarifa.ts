/**
 * Alcance de una tarifa nueva y mensajes de negocio de su creación.
 *
 * Vive fuera de `actions.ts` a propósito: un módulo `"use server"` solo puede
 * exportar funciones async (una constante o una función síncrona tumba el build
 * de producción sin que typecheck ni pruebas lo noten).
 */

import { FUENTES_PEDIDO } from "@/modules/operacion/tipos";

/**
 * Por plataforma (`fuente`), heredado por régimen
 * (`tipo_entrega`, LEGADO) o para todas ("todas" → ambas columnas NULL).
 * El CHECK `tarifas_fuente_o_regimen_no_ambos` impide combinarlos, así que se
 * rechaza acá con un mensaje en vez de dejar que llegue como error de base.
 */
export function resolverAlcanceTarifa(
  tipoEntrega: string | null,
  fuente: string | null,
):
  | { ok: true; tipoEntrega: "flex" | "same_day" | null; fuente: (typeof FUENTES_PEDIDO)[number] | null }
  | { ok: false; mensaje: string } {
  const tipo = tipoEntrega?.trim() || null;
  const fu = fuente?.trim() || null;
  if (tipo && fu && fu !== "todas") {
    return { ok: false, mensaje: "Una tarifa aplica por plataforma o por tipo de entrega, no por las dos." };
  }
  if (fu && fu !== "todas") {
    if (!(FUENTES_PEDIDO as readonly string[]).includes(fu)) {
      return { ok: false, mensaje: "Plataforma inválida." };
    }
    return { ok: true, tipoEntrega: null, fuente: fu as (typeof FUENTES_PEDIDO)[number] };
  }
  if (fu === "todas") return { ok: true, tipoEntrega: null, fuente: null };
  if (tipo !== "flex" && tipo !== "same_day") {
    return { ok: false, mensaje: "Tipo de entrega inválido." };
  }
  return { ok: true, tipoEntrega: tipo, fuente: null };
}

export const MENSAJE_TARIFA_DUPLICADA =
  "Ya hay una tarifa activa igual (mismo seller, plataforma, zona y fecha de inicio). Edítala o cambia la fecha de inicio.";

