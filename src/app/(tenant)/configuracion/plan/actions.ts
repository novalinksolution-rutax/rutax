"use server";

/**
 * ⚠️ Acá vivían `crearSuscripcionInicialAction` (alta self-serve) y
 * `solicitarCambioDePlanAction` (cambio de plan con proración). Se retiraron el
 * 2026-08-28 con la cuota plana: con una sola modalidad el courier no tiene
 * entre qué elegir, y su tarifa la fija Rutax desde el backstage.
 *
 * Lo que queda es el cobro automático, que sigue siendo una decisión del courier.
 *
 * ⚠️ La capa de dominio NO se tocó: `cambiarPlanCourier`, el evento
 * `plataforma/plan.cambiado`, el job `aplicar-cambios-plan` y su notificación
 * siguen existiendo, ahora sin ningún llamador desde la app. Retirarlos es una
 * limpieza aparte — se anota en vez de hacerse a la carrera, porque toca el
 * borde del motor de cobro.
 */

/**
 * Server Actions · "Mi plan" — suscripción del courier a Rutax (F1, backstage
 * `plataforma`). RBAC: `gestionar_suscripcion` (solo dueño — ver `capacidades.ts`).
 *
 * Estas acciones son la ÚNICA forma en que `frontend` toca el módulo
 * `plataforma`: delegan siempre en `superficie-courier.ts` (nunca consultan
 * `plataforma` directo ni reusan `modules/plataforma/acciones.ts`, que exige
 * `adminSecret` de super-admin y el courier no lo tiene).
 */

import { revalidatePath } from "next/cache";
import { exigirSesionActual, type SesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarSuscripcion } from "@/modules/identidad/capacidades";
import {
  iniciarEnrolamientoMandato,
  cancelarMandatoAutoCobro,
} from "@/modules/plataforma/superficie-courier";


/**
 * Preámbulo común a las acciones de esta pantalla: exige sesión, exige rol
 * `interno` (nunca seller/conductor/super_admin) y exige la capacidad
 * `gestionar_suscripcion` (solo dueño). Devuelve la sesión ya validada — el
 * `tenantId` que de ahí en más se usa SIEMPRE sale del claim, nunca de un
 * parámetro del cliente.
 */
async function exigirGestionSuscripcion(): Promise<SesionActual> {
  const sesion = await exigirSesionActual();
  if (sesion.usuario.tipoUsuario !== "interno") {
    throw new Error("No autorizado.");
  }
  if (!puedeGestionarSuscripcion(sesion.usuario)) {
    throw new Error("No autorizado.");
  }
  if (!sesion.usuario.tenantId) {
    throw new Error("No autorizado.");
  }
  return sesion;
}

// =============================================================================
// activarAutoCobroAction / desactivarAutoCobroAction — auto-cobro (F1-E)
// =============================================================================

/**
 * Inicia el enrolamiento del mandato de auto-cobro (PAC/tarjeta vía Fintoc).
 * Devuelve `urlEnrolamiento` para que `frontend` redirija al courier a la
 * página hospedada de Fintoc donde autoriza el mandato. El mandato queda
 * `mandato_estado='pendiente'` hasta que el webhook de confirmación
 * (`api/webhooks/fintoc-suscripcion-recurrente`) lo active.
 */
export async function activarAutoCobroAction(): Promise<
  { ok: true; urlEnrolamiento: string } | { ok: false; error: string }
> {
  try {
    const sesion = await exigirGestionSuscripcion();

    const resultado = await iniciarEnrolamientoMandato({
      tenantId: sesion.usuario.tenantId!,
      actorUsuarioId: sesion.usuarioId,
    });

    revalidatePath("/configuracion/plan");
    return { ok: true, urlEnrolamiento: resultado.urlEnrolamiento };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error al iniciar el enrolamiento de auto-cobro.",
    };
  }
}

/**
 * Desactiva el auto-cobro: cancela el mandato en el proveedor (si existe uno
 * activo/pendiente) y apaga `auto_cobro_habilitado`. El período abierto que
 * quede pendiente vuelve a cobrarse por el link manual (super-admin).
 */
export async function desactivarAutoCobroAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sesion = await exigirGestionSuscripcion();

    await cancelarMandatoAutoCobro({
      tenantId: sesion.usuario.tenantId!,
      actorUsuarioId: sesion.usuarioId,
    });

    revalidatePath("/configuracion/plan");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error al desactivar el auto-cobro." };
  }
}


