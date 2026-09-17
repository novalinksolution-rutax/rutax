"use server";

/**
 * Server Actions — dar de baja / reactivar cuentas de personas, desde
 * `/admin/cuentas`. Cáscaras delgadas: la decisión (eliminar vs. desactivar,
 * qué se desengancha, la bitácora con autor) vive entera en
 * `modules/plataforma/baja-cuentas`. Cada escritura exige `exigirActorAdmin()`
 * primero — rol `admin_total` y MFA verificado en esta sesión — igual que el
 * resto de `/admin/*` (ver `acciones.ts` de whatsapp).
 */

import { revalidatePath } from "next/cache";
import { exigirActorAdmin } from "../sesion-admin";
import {
  previsualizarBajaCuenta,
  darDeBajaCuenta,
  reactivarCuenta,
  type AccionBaja,
  type PrevisualizacionBaja,
  type ResultadoBaja,
  type ResultadoReactivacion,
} from "@/modules/plataforma/baja-cuentas";

const RUTA = "/admin/cuentas";

const MOTIVO_SIN_PERMISO =
  "Necesitas rol admin y verificación de dos factores en esta sesión.";

/** Solo lee el veredicto (eliminar/desactivar/bloqueada). No revalida: no muta nada. */
export async function previsualizarBajaCuentaAction(usuarioId: string): Promise<PrevisualizacionBaja> {
  try {
    await exigirActorAdmin();
  } catch {
    return { ok: false, motivo: MOTIVO_SIN_PERMISO };
  }
  return previsualizarBajaCuenta(usuarioId);
}

/**
 * `accionEsperada` es lo que el diálogo YA mostró vía `previsualizarBajaCuentaAction`
 * (`preview.accionPrevista`). Se reenvía para que `darDeBajaCuenta` pueda
 * comprobar, al momento de escribir, que la situación no cambió entre el
 * preview y este clic — ver "TOCTOU" en `modules/plataforma/baja-cuentas.ts`.
 */
export async function darDeBajaCuentaAction(
  usuarioId: string,
  accionEsperada: AccionBaja,
): Promise<ResultadoBaja> {
  let actorUsuarioId: string;
  try {
    ({ actorUsuarioId } = await exigirActorAdmin());
  } catch {
    return { ok: false, motivo: MOTIVO_SIN_PERMISO };
  }

  const resultado = await darDeBajaCuenta({ actorUsuarioId, usuarioId, accionEsperada });
  if (resultado.ok) revalidatePath(RUTA);
  return resultado;
}

export async function reactivarCuentaAction(usuarioId: string): Promise<ResultadoReactivacion> {
  let actorUsuarioId: string;
  try {
    ({ actorUsuarioId } = await exigirActorAdmin());
  } catch {
    return { ok: false, motivo: MOTIVO_SIN_PERMISO, noReenganchado: [] };
  }

  const resultado = await reactivarCuenta({ actorUsuarioId, usuarioId });
  if (resultado.ok) revalidatePath(RUTA);
  return resultado;
}
