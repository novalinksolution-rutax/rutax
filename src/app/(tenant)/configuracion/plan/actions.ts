"use server";

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
  crearSuscripcionInicial,
  iniciarEnrolamientoMandato,
  cancelarMandatoAutoCobro,
  cambiarPlanCourier,
  type ResultadoCambioPlan,
} from "@/modules/plataforma/superficie-courier";
import type { Periodicidad } from "@/modules/plataforma/tipos";

type ResultadoAccion = { ok: true; suscripcionId: string } | { ok: false; error: string };

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
// crearSuscripcionInicialAction
// =============================================================================

/**
 * Da de alta la suscripción del propio tenant (self-serve, estado inicial
 * `trial`). Idempotente: si el tenant ya tiene suscripción, la acción
 * subyacente devuelve la existente en vez de fallar.
 */
export async function crearSuscripcionInicialAction(planId: string): Promise<ResultadoAccion> {
  try {
    // Solo roles internos del courier (nunca seller/conductor/super_admin) —
    // el super_admin da de alta suscripciones vía `plataforma/acciones.ts`
    // (asignarPlan), no por esta puerta self-serve.
    const sesion = await exigirGestionSuscripcion();

    const resultado = await crearSuscripcionInicial({
      // `tenantId` sale del claim del JWT (mismo que impone RLS), nunca de un
      // parámetro del cliente — el courier no puede nombrar otro tenant.
      tenantId: sesion.usuario.tenantId!,
      planId,
      actorUsuarioId: sesion.usuarioId,
    });

    revalidatePath("/configuracion/plan");
    return { ok: true, suscripcionId: resultado.suscripcionId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error al crear la suscripción." };
  }
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

// =============================================================================
// solicitarCambioDePlanAction — cambio de plan self-serve con proración (F2)
// =============================================================================

type ResultadoCambioPlanAction = ResultadoCambioPlan | { ok: false; error: string };

/**
 * Solicita el cambio de plan (y, opcionalmente, la periodicidad) de la
 * suscripción del propio tenant. Self-serve, sin gate de aprobación humana
 * adicional (a diferencia de la emisión de DTE) — la decisión de negocio (ver
 * `superficie-courier.ts`, `cambiarPlanCourier`) es: un UPGRADE es inmediato y
 * genera un cargo de proración; un DOWNGRADE es diferido al fin del ciclo
 * vigente, sin cobro.
 */
export async function solicitarCambioDePlanAction(
  nuevoPlanId: string,
  nuevaPeriodicidad?: Periodicidad,
): Promise<ResultadoCambioPlanAction> {
  try {
    const sesion = await exigirGestionSuscripcion();

    const resultado = await cambiarPlanCourier({
      // `tenantId` sale del claim del JWT — nunca de un parámetro del cliente.
      tenantId: sesion.usuario.tenantId!,
      nuevoPlanId,
      nuevaPeriodicidad,
      actorUsuarioId: sesion.usuarioId,
    });

    revalidatePath("/configuracion/plan");
    return resultado;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error al cambiar de plan." };
  }
}
