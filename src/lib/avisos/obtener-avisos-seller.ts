/**
 * Centro de avisos in-app del PORTAL DEL SELLER — análogo a `obtener-avisos.ts`
 * (backoffice del courier) pero con la única señal relevante para el seller:
 * sus propias conexiones de Mercado Libre que necesitan atención o están
 * desconectadas. Reutiliza el mismo tipo `Aviso` para que `CentroAvisos`
 * (componente compartido del app-shell) funcione sin cambios.
 *
 * Decisión (coherente con P6 del backoffice): todo es in-app, nunca correo.
 */

import { obtenerConexionesPorSeller } from "@/modules/integraciones/ml";
import type { Aviso } from "./obtener-avisos";

/** Nombre visible de la cuenta: alias → nickname de ML → últimos 4 del user_id. */
function etiquetaCuenta(c: { alias: string | null; mlNickname: string | null; mlUserId: string | null }): string {
  if (c.alias && c.alias.trim().length > 0) return c.alias;
  if (c.mlNickname && c.mlNickname.trim().length > 0) return c.mlNickname;
  if (c.mlUserId && c.mlUserId.length >= 4) return `Cuenta ···${c.mlUserId.slice(-4)}`;
  return "Cuenta de Mercado Libre";
}

/**
 * Avisos del seller autenticado. Best-effort: si falla la lectura, devuelve
 * lista vacía — nunca debe romper el render del portal.
 */
export async function obtenerAvisosSeller(sellerId: string): Promise<Aviso[]> {
  try {
    const conexiones = await obtenerConexionesPorSeller(sellerId);
    const avisos: Aviso[] = [];

    for (const c of conexiones) {
      // 🔴 La que apagó el propio seller NO es un aviso. Desconectar deja la
      // cuenta en `desvinculada` —es el estado que corta la ingesta— así que sin
      // esto, apretar «Desconectar» le encendía un aviso URGENTE que le pedía
      // reconectar lo que acababa de apagar. Un centro de avisos que reclama por
      // una decisión deliberada enseña a ignorarlo entero.
      if (c.desconectadaPorPersona) continue;

      if (c.estadoSalud === "desvinculada") {
        avisos.push({
          id: `ml-desvinculada-${c.id}`,
          urgencia: "urgente",
          titulo: `${etiquetaCuenta(c)} está desconectada`,
          descripcion: "Reconéctala para seguir recibiendo tus pedidos.",
          href: "/portal",
          accion: "Reconectar cuenta",
        });
      } else if (c.estadoSalud === "atencion") {
        avisos.push({
          id: `ml-atencion-${c.id}`,
          urgencia: "importante",
          titulo: `${etiquetaCuenta(c)} necesita atención`,
          descripcion: "Si persiste, reconéctala.",
          href: "/portal",
          accion: "Ver estado de la cuenta",
        });
      }
    }

    return avisos;
  } catch {
    return [];
  }
}
