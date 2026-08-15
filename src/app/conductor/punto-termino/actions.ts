"use server";

/**
 * Server Actions del punto de término de ruta del conductor.
 * =============================================================================
 * Fuente de verdad: `docs/seguridad/punto-de-termino-conductor.md`. Este
 * archivo es una fachada delgada sobre `punto-termino-conductor.ts` y
 * `consentimiento-ubicacion.ts` — la lógica de negocio (bitácora, orden de
 * escritura, redondeo, borrado) vive ahí y no se repite acá.
 *
 * Igual que el resto de la superficie del conductor, todo pasa por
 * `service_role`: la tabla no tiene un solo `grant` para `authenticated`
 * (§6.3 del documento — "cómo llega el conductor a su propio punto de
 * término"). El filtro por conductor lo pone este código, no una política.
 *
 * NUNCA aceptan una dirección en texto: solo dos números (lat, long), y ambos
 * se validan como coordenada antes de tocar la base — la validación real vive
 * en `definirPuntoTermino` (falla cerrado con `ErrorCoordenadaPuntoTerminoInvalida`).
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  definirPuntoTermino,
  revocarPuntoTermino,
  ErrorCoordenadaPuntoTerminoInvalida,
  ErrorSinConsentimientoPuntoTermino,
  FINALIDAD_PUNTO_TERMINO,
  type PuntoTerminoConductor,
} from "@/modules/operacion/punto-termino-conductor";
import {
  registrarConsentimientoUbicacion,
  tieneConsentimientoVigente,
  VERSION_TEXTO_CONSENTIMIENTO_PUNTO_TERMINO,
} from "@/modules/operacion/consentimiento-ubicacion";

// =============================================================================
// Guardia común — misma forma que el resto de las Server Actions del conductor
// (ver `liquidaciones/actions.ts`, `manifiesto/[pedidoId]/actions.ts`).
// =============================================================================

interface SesionConductor {
  usuarioId: string;
  tenantId: string;
  driverId: string;
}

async function exigirSesionConductor(): Promise<SesionConductor> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "conductor") redirect("/conductor/manifiesto");
  if (!sesion.usuario.driverId) redirect("/login");

  return {
    usuarioId: sesion.usuarioId,
    tenantId: sesion.usuario.tenantId,
    driverId: sesion.usuario.driverId,
  };
}

/** Revalida la página propia y el layout del conductor (donde vive el estado corto del menú). */
function revalidarPuntoTermino() {
  revalidatePath("/conductor/punto-termino");
  revalidatePath("/conductor", "layout");
}

// =============================================================================
// accionGuardarPuntoTermino
// =============================================================================

export interface ResultadoGuardarPuntoTermino {
  ok: boolean;
  mensaje?: string;
  /** Lo que quedó GUARDADO (redondeado por el trigger), no lo que se marcó. */
  punto?: PuntoTerminoConductor;
}

/**
 * Define (o redefine) el punto de término del conductor autenticado.
 *
 * Orden fijado por el documento y por `definirPuntoTermino`: primero se
 * registra el consentimiento de ESTA finalidad (si no hay uno vigente, la
 * escritura del punto fallaría a propósito — `definirPuntoTermino` falla
 * cerrado), y solo entonces se guarda la coordenada.
 */
export async function accionGuardarPuntoTermino(
  lat: number,
  long: number,
): Promise<ResultadoGuardarPuntoTermino> {
  const sesion = await exigirSesionConductor();

  if (typeof lat !== "number" || typeof long !== "number" || !Number.isFinite(lat) || !Number.isFinite(long)) {
    return { ok: false, mensaje: "No pudimos leer el punto que marcaste en el mapa." };
  }

  const cliente = crearClienteServiceRole();

  try {
    // Se otorga SOLO si no hay uno vigente, y esto no es una micro-optimización.
    //
    // `registrarConsentimientoUbicacion` siempre INSERTA (es un historial de
    // eventos), así que grabar en cada guardado deja una fila abierta —
    // `acepto = true, revocado_en = null`— por cada vez que el conductor mueve
    // su pin. Al revocar, `revocarConsentimientoUbicacion` cierra **la más
    // reciente**, y las anteriores quedan abiertas para siempre.
    //
    // Hoy eso no rompe nada: `tieneConsentimientoVigente` mira solo la última
    // fila, que sí queda revocada. Pero deja puesta la trampa para el primero
    // que escriba la consulta natural —`where acepto and revocado_en is null`,
    // en un job de purga o en un reporte de cumplimiento— y le cuente como
    // consintiendo a alguien que revocó. Se cierra no creando el duplicado.
    //
    // Y de paso ahorra un asiento de bitácora "consintió" por cada pin movido,
    // que además sería falso: consintió una vez, después solo cambió de casa.
    const yaConsintio = await tieneConsentimientoVigente(
      cliente,
      sesion.tenantId,
      sesion.driverId,
      FINALIDAD_PUNTO_TERMINO,
    );

    if (!yaConsintio) {
      await registrarConsentimientoUbicacion(cliente, {
        tenantId: sesion.tenantId,
        conductorId: sesion.driverId,
        actorUsuarioId: sesion.usuarioId,
        acepto: true,
        versionTexto: VERSION_TEXTO_CONSENTIMIENTO_PUNTO_TERMINO,
        finalidad: FINALIDAD_PUNTO_TERMINO,
      });
    }

    const punto = await definirPuntoTermino(cliente, {
      tenantId: sesion.tenantId,
      conductorId: sesion.driverId,
      actorUsuarioId: sesion.usuarioId,
      lat,
      long,
    });

    revalidarPuntoTermino();
    return { ok: true, punto };
  } catch (err) {
    if (err instanceof ErrorCoordenadaPuntoTerminoInvalida) {
      return { ok: false, mensaje: "Ese punto no es válido. Vuelve a marcarlo en el mapa." };
    }
    if (err instanceof ErrorSinConsentimientoPuntoTermino) {
      // No debería ocurrir (se registra arriba en la misma llamada), pero si
      // la base lo rechaza igual, fallamos con un mensaje honesto.
      return { ok: false, mensaje: "No pudimos confirmar tu autorización. Inténtalo de nuevo." };
    }
    return { ok: false, mensaje: "No pudimos guardar tu punto de término. Inténtalo de nuevo." };
  }
}

// =============================================================================
// accionQuitarPuntoTermino
// =============================================================================

export interface ResultadoQuitarPuntoTermino {
  ok: boolean;
  mensaje?: string;
}

/**
 * El conductor retira su punto de término. Idempotente y de un toque: sin
 * confirmación en cadena de parte del servidor (la confirmación visual ya
 * ocurrió en el diálogo del cliente antes de llamar acá).
 */
export async function accionQuitarPuntoTermino(): Promise<ResultadoQuitarPuntoTermino> {
  const sesion = await exigirSesionConductor();
  const cliente = crearClienteServiceRole();

  try {
    await revocarPuntoTermino(cliente, {
      tenantId: sesion.tenantId,
      conductorId: sesion.driverId,
      actorUsuarioId: sesion.usuarioId,
    });

    revalidarPuntoTermino();
    return { ok: true };
  } catch {
    return { ok: false, mensaje: "No pudimos quitar tu punto de término. Inténtalo de nuevo." };
  }
}
