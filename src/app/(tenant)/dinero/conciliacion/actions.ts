"use server";

/**
 * Server Actions para la bandeja de excepciones de conciliación (D-4, §1.1 P1).
 *
 * Capa delgada: cada función valida sesión y delega ÍNTEGRO en su función de
 * dominio homónima de `@/modules/dinero/acciones` (que ya hace RBAC vía
 * `exigirPermisoConciliacion`, bitácora y máquina de estados) — sin duplicar
 * reglas aquí. Siempre `{ ok: true }` o `{ ok: false; mensaje }`, mismo
 * contrato que el resto de `dinero` (ver `dialog-emitir-pago.tsx`).
 *
 * `accionTransicionarEvento` es GENÉRICA (recibe cualquier estado destino) a
 * propósito: el Sheet de detalle deriva los botones válidos de
 * `TRANSICIONES_VALIDAS`/`esTransicionValida` (nunca los hardcodea — esa fue
 * la causa raíz de un bug real ya corregido en el menú de 3 puntos), así que
 * necesita una sola acción capaz de aceptar cualquier destino legal; la
 * validación real de legalidad la hace igual `transicionarEventoConciliacion`
 * server-side.
 */

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeVerConciliacion } from "@/modules/identidad/capacidades";
import { TOPE_LOTE } from "./tipos-ui";
import {
  transicionarEventoConciliacion,
  reabrirEventoConciliacion,
  asignarEventoConciliacion,
  fijarFechaLimiteConciliacion,
  fijarBloqueosConciliacion,
  cambiarAccionSugeridaConciliacion,
  agregarComentarioConciliacion,
  listarHistorialEventoConciliacion,
} from "@/modules/dinero/index";
import type {
  EstadoEventoConciliacion,
  AccionSugeridaConciliacion,
  EventoConciliacionHistorial,
} from "@/modules/dinero/tipos";

export type ResultadoAccionConciliacion = { ok: true } | { ok: false; mensaje: string };

function mensajeDeError(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Transiciona una excepción a cualquier estado destino válido (el Sheet de
 * detalle y el menú rápido ya filtran las opciones a las legales antes de
 * llamar aquí). `comentario` es obligatorio server-side solo para ciertos
 * destinos/orígenes — ver `transicionarEventoConciliacion`.
 */
export async function accionTransicionarEvento(
  eventoId: string,
  nuevoEstado: EstadoEventoConciliacion,
  comentario?: string,
): Promise<ResultadoAccionConciliacion> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };

  try {
    await transicionarEventoConciliacion(
      sesion.usuario.tenantId,
      eventoId,
      nuevoEstado,
      sesion.usuario,
      sesion.usuarioId,
      { comentario },
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "Error al actualizar la excepción.") };
  }
}

/**
 * Reabre una excepción cerrada (estado terminal). Destino calculado por el
 * backend: `en_analisis` si tiene responsable asignado, si no `pendiente` —
 * un solo botón "Reabrir" en el Sheet, en vez de forzar a elegir entre dos
 * destinos técnicos.
 */
export async function accionReabrirEvento(
  eventoId: string,
  comentario: string,
): Promise<ResultadoAccionConciliacion> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };

  try {
    await reabrirEventoConciliacion(
      sesion.usuario.tenantId,
      eventoId,
      sesion.usuario,
      sesion.usuarioId,
      { comentario },
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "Error al reabrir la excepción.") };
  }
}

/** Asigna (o desasigna, con `null`) una excepción a un usuario interno del tenant. */
export async function accionAsignarEvento(
  eventoId: string,
  asignadoAUsuarioId: string | null,
): Promise<ResultadoAccionConciliacion> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };

  try {
    await asignarEventoConciliacion(
      sesion.usuario.tenantId,
      eventoId,
      asignadoAUsuarioId,
      sesion.usuario,
      sesion.usuarioId,
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "Error al asignar la excepción.") };
  }
}

/** Fija (o limpia, con `null`) la fecha límite (SLA) de una excepción. */
export async function accionFijarFechaLimite(
  eventoId: string,
  fechaLimite: string | null,
): Promise<ResultadoAccionConciliacion> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };

  try {
    await fijarFechaLimiteConciliacion(
      sesion.usuario.tenantId,
      eventoId,
      fechaLimite,
      sesion.usuario,
      sesion.usuarioId,
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "Error al fijar la fecha límite.") };
  }
}

/** Fija los flags de bloqueo de facturación/pago — exige `motivoBloqueo` si alguno queda en `true`. */
export async function accionFijarBloqueos(
  eventoId: string,
  opciones: { bloqueaFacturacion: boolean; bloqueaPago: boolean; motivoBloqueo: string | null },
): Promise<ResultadoAccionConciliacion> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };

  try {
    await fijarBloqueosConciliacion(
      sesion.usuario.tenantId,
      eventoId,
      opciones,
      sesion.usuario,
      sesion.usuarioId,
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "Error al fijar el bloqueo.") };
  }
}

/** Cambia la acción sugerida (una de las 11 opciones) de una excepción. */
export async function accionCambiarAccionSugerida(
  eventoId: string,
  accionSugerida: AccionSugeridaConciliacion,
): Promise<ResultadoAccionConciliacion> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };

  try {
    await cambiarAccionSugeridaConciliacion(
      sesion.usuario.tenantId,
      eventoId,
      accionSugerida,
      sesion.usuario,
      sesion.usuarioId,
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "Error al cambiar la acción sugerida.") };
  }
}

/** Agrega un comentario libre al historial, sin exigir cambio de estado. */
export async function accionAgregarComentario(
  eventoId: string,
  comentario: string,
): Promise<ResultadoAccionConciliacion> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };

  try {
    await agregarComentarioConciliacion(
      sesion.usuario.tenantId,
      eventoId,
      comentario,
      sesion.usuario,
      sesion.usuarioId,
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "Error al agregar el comentario.") };
  }
}

/** Lista el historial cronológico de una excepción — usado por el timeline del Sheet. */
export async function accionListarHistorialEvento(
  eventoId: string,
): Promise<{ ok: true; historial: EventoConciliacionHistorial[] } | { ok: false; mensaje: string }> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) return { ok: false, mensaje: "No autenticado." };
  if (!puedeVerConciliacion(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para ver este historial." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const historial = await listarHistorialEventoConciliacion(cliente, sesion.usuario.tenantId, eventoId);
    return { ok: true, historial };
  } catch (err) {
    return { ok: false, mensaje: mensajeDeError(err, "Error al cargar el historial de la excepción.") };
  }
}

// =============================================================================
// Acciones EN LOTE
// =============================================================================
//
// Nacen de un caso concreto: al cerrar su primer período, un courier se
// encontró con 109 excepciones que no correspondían. Resolverlas de a una es
// media hora de clics, y con el volumen real —30 paradas × N conductores × día—
// la bandeja deja de ser usable a mano.
//
// -----------------------------------------------------------------------------
// ⚠️ EL LOTE ITERA, NO HACE UN `UPDATE ... IN (...)`
// -----------------------------------------------------------------------------
// Cada ítem pasa por la MISMA función de dominio que la acción individual, así
// que conserva su comprobación de transición válida, su gate de capacidad y
// **su propia entrada en la bitácora, con su autor**. Un `update ... in (...)`
// sería una línea y convertiría cien decisiones de dinero en un solo hecho
// anónimo — exactamente lo que la regla de auditoría del proyecto prohíbe.
//
// El precio es la latencia, y se acota con `TOPE_LOTE`.
//
// -----------------------------------------------------------------------------
// EL FALLO PARCIAL ES NORMAL, Y SE INFORMA
// -----------------------------------------------------------------------------
// En una selección de cien, algunas transiciones pueden ser ilegales para su
// estado de origen. Eso NO aborta el lote: se aplica lo que se puede y se
// devuelve la cuenta de los dos lados. Abortar entero por una dejaría al
// usuario sin saber cuáles alcanzaron a moverse.

export interface ResultadoLote {
  aplicados: number;
  fallidos: number;
  /** El primer motivo de fallo, para no llenar la pantalla de cien iguales. */
  primerError: string | null;
}

async function aplicarEnLote(
  eventoIds: string[],
  accion: (eventoId: string) => Promise<ResultadoAccionConciliacion>,
): Promise<ResultadoLote> {
  let aplicados = 0;
  let fallidos = 0;
  let primerError: string | null = null;

  for (const id of eventoIds.slice(0, TOPE_LOTE)) {
    const r = await accion(id);
    if (r.ok) {
      aplicados += 1;
    } else {
      fallidos += 1;
      primerError ??= r.mensaje;
    }
  }

  return { aplicados, fallidos, primerError };
}

/** Mueve un lote de excepciones al mismo estado destino. */
export async function accionTransicionarEnLote(
  eventoIds: string[],
  nuevoEstado: EstadoEventoConciliacion,
  comentario: string,
): Promise<ResultadoLote> {
  // El comentario es obligatorio en lote aunque la acción individual lo exija
  // solo en ciertos destinos: cerrar cien excepciones de una vez sin decir por
  // qué deja una bitácora que no explica nada al que la lea en tres meses.
  if (!comentario.trim()) {
    return { aplicados: 0, fallidos: eventoIds.length, primerError: "Escribe el motivo del cambio." };
  }
  return aplicarEnLote(eventoIds, (id) => accionTransicionarEvento(id, nuevoEstado, comentario));
}

/** Asigna (o desasigna, con `null`) un lote de excepciones a la misma persona. */
export async function accionAsignarEnLote(
  eventoIds: string[],
  asignadoAUsuarioId: string | null,
): Promise<ResultadoLote> {
  return aplicarEnLote(eventoIds, (id) => accionAsignarEvento(id, asignadoAUsuarioId));
}
