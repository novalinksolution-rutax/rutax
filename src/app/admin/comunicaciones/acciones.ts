"use server";

/**
 * Server Actions del backstage de comunicaciones (F3 · Gap 7 — comunicaciones
 * de Rutax a los couriers). Mismo patrón que `admin/planes/acciones.ts` /
 * `admin/suscripciones/acciones.ts`: el actor SIEMPRE se resuelve de la sesión
 * admin (`exigirActorAdmin`), nunca del `formData` que envía el navegador —
 * `modules/plataforma/comunicaciones.ts` NO valida sesión por sí solo (ver
 * cabecera de ese módulo): estas dos funciones son el único punto de entrada
 * autorizado hacia `crearComunicacion`/`activarDesactivarComunicacion`.
 */

import { revalidatePath } from "next/cache";
import {
  crearComunicacion,
  activarDesactivarComunicacion,
  type TipoComunicacion,
} from "@/modules/plataforma/comunicaciones";
import type { UrgenciaAviso } from "@/lib/avisos/obtener-avisos";
import { combinarFechaHoraSantiago } from "@/lib/fecha-santiago";
import { exigirActorAdmin } from "../sesion-admin";

const RUTA = "/admin/comunicaciones";

export async function accionCrearComunicacion(formData: FormData) {
  try {
    const { actorUsuarioId } = await exigirActorAdmin();

    // `vigente_hasta` viaja como <input type="date"> (YYYY-MM-DD) — se ancla
    // al fin del día en hora de Santiago (Chile-only), mismo criterio que los
    // filtros de fecha de `admin/bitacora/page.tsx`. Vacío = sin expiración.
    const vigenteHastaFecha = String(formData.get("vigente_hasta") ?? "").trim();
    const vigenteHasta = vigenteHastaFecha
      ? combinarFechaHoraSantiago(vigenteHastaFecha, "23:59:59").toISOString()
      : null;

    const resultado = await crearComunicacion({
      titulo: String(formData.get("titulo") ?? ""),
      cuerpo: String(formData.get("cuerpo") ?? ""),
      tipo: String(formData.get("tipo") ?? "") as TipoComunicacion,
      nivel: String(formData.get("nivel") ?? "") as UrgenciaAviso,
      vigenteHasta,
      enviarEmail: formData.get("enviar_email") === "on",
      actorUsuarioId,
    });
    revalidatePath(RUTA);
    return resultado;
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al crear la comunicación.",
    };
  }
}

export async function accionActivarDesactivar(id: string, activa: boolean) {
  try {
    const { actorUsuarioId } = await exigirActorAdmin();
    const resultado = await activarDesactivarComunicacion({ id, activa, actorUsuarioId });
    revalidatePath(RUTA);
    return resultado;
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al cambiar el estado de la comunicación.",
    };
  }
}
