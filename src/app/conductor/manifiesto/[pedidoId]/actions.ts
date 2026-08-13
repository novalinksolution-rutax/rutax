"use server";

/**
 * Server Actions del detalle de pedido para el conductor (Bloque 2 — same-day).
 *
 * FRONTERA DURA: todas las acciones de este archivo aplican SOLO a pedidos
 * tipo_pedido='same_day'. El backend (registrarPruebaEntrega, actualizarEstadoPedido)
 * verifica el tipo y lanza ErrorValidacion si se intenta con Flex — la UI
 * no permite llegar aquí con Flex, pero el backend es la fuente de verdad.
 *
 * Las coordenadas GPS y los paths de foto NUNCA se incluyen en logs.
 */

import { revalidatePath } from "next/cache";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarPruebaEntrega } from "@/modules/operacion/pruebas-entrega";
import { actualizarEstadoPedido } from "@/modules/operacion/pedidos";
import { obtenerUrlFirmadaPod } from "@/modules/operacion/pruebas-entrega";
import { actualizarUbicacionConductor, borrarUbicacionAlCerrarRuta } from "@/modules/operacion/ubicacion-conductor";
import {
  registrarConsentimientoUbicacion,
  revocarConsentimientoUbicacion,
  VERSION_TEXTO_CONSENTIMIENTO_UBICACION,
} from "@/modules/operacion/consentimiento-ubicacion";
import type { TipoIncidencia } from "@/modules/operacion/tipos";

// =============================================================================
// Tipos de resultado
// =============================================================================

export interface ResultadoAccionPod {
  exito?: boolean;
  esValido?: boolean;
  /** Cuando el POD se capturó pero está fuera de geocerca o sin foto suficiente. */
  avisoPendienteRevision?: boolean;
  error?: string;
}

// =============================================================================
// actionEntregarPedido
// =============================================================================

/**
 * El conductor registra entrega exitosa de un pedido same-day.
 *
 * Flujo:
 * 1. Recibe el archivo de foto como Blob en formData (ya comprimido client-side).
 * 2. Sube la foto al bucket privado pod-evidencias/{tenantId}/{pedidoId}/{uuid}.jpg.
 * 3. Llama a registrarPruebaEntrega con tipo_resultado='entregado'.
 * 4. Si es válida, llama a actualizarEstadoPedido a 'entregado'.
 * 5. Si no es válida (geocerca fuera), igual registra el POD pero devuelve avisoPendienteRevision.
 *
 * DATOS PERSONALES: foto y coordenadas GPS nunca se incluyen en logs.
 */
export async function actionEntregarPedido(formData: FormData): Promise<ResultadoAccionPod> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId || !sesion.usuario.driverId) {
    return { error: "Sin sesión de conductor." };
  }

  const pedidoId = formData.get("pedidoId") as string;
  const fotoBlob = formData.get("foto") as Blob | null;
  const latStr = formData.get("lat") as string | null;
  const longStr = formData.get("long") as string | null;
  const precisionStr = formData.get("precisionM") as string | null;

  if (!pedidoId) return { error: "Falta el ID del pedido." };

  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();

  try {
    // --- 1. Subir foto a Storage (si existe) ----------------------------------
    let fotoObjectPath: string | undefined;

    if (fotoBlob && fotoBlob.size > 0) {
      const archivoId = crypto.randomUUID();
      const rutaStorage = `${tenantId}/${pedidoId}/${archivoId}.jpg`;

      const { error: errorSubida } = await cliente.storage
        .from("pod-evidencias")
        .upload(rutaStorage, fotoBlob, {
          contentType: "image/jpeg",
          upsert: false,
        });

      if (errorSubida) {
        // No bloqueamos: registramos el POD sin foto y el backend lo marcará inválido.
        console.error("[actionEntregarPedido] Error subiendo foto al storage — continuando sin foto.");
      } else {
        fotoObjectPath = rutaStorage;
      }
    }

    // --- 2. Armar geo (sin loguearlo) ----------------------------------------
    const geo =
      latStr && longStr
        ? {
            lat: parseFloat(latStr),
            long: parseFloat(longStr),
            precisionM: precisionStr ? parseFloat(precisionStr) : undefined,
          }
        : undefined;

    // --- 3. Registrar POD (backend valida que sea same-day) ------------------
    const pod = await registrarPruebaEntrega(
      cliente,
      {
        pedidoId,
        tenantId,
        tipoResultado: "entregado",
        fotoObjectPath,
        geo,
      },
      { ...sesion.usuario, usuarioId: sesion.usuarioId },
    );

    // --- 4. Si el POD es válido, transicionar el estado ----------------------
    if (pod.esValido) {
      await actualizarEstadoPedido(
        cliente,
        {
          pedidoId,
          tenantId,
          estadoNuevo: "entregado",
          estadoEsperado: "en_ruta",
          ejecutor: "conductor",
          actuadoPorUsuarioId: sesion.usuarioId,
        },
        sesion.usuario,
      );
    }

    revalidatePath(`/conductor/manifiesto/${pedidoId}`);
    revalidatePath("/conductor/manifiesto");

    return {
      exito: true,
      esValido: pod.esValido,
      avisoPendienteRevision: !pod.esValido,
    };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error al registrar la entrega.";
    return { error: mensaje };
  }
}

// =============================================================================
// actionNoEntregarPedido
// =============================================================================

/**
 * El conductor registra un fallo de entrega (no entregado) para un pedido same-day.
 *
 * Flujo:
 * 1. Recibe el tipo de incidencia y, opcionalmente, foto + GPS.
 * 2. Sube la foto si viene.
 * 3. Llama a registrarPruebaEntrega con tipo_resultado='fallido'.
 * 4. Llama a actualizarEstadoPedido a 'fallido' con tipoIncidenciaConductor.
 *
 * DATOS PERSONALES: foto y coordenadas GPS nunca se incluyen en logs.
 */
export async function actionNoEntregarPedido(formData: FormData): Promise<ResultadoAccionPod> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId || !sesion.usuario.driverId) {
    return { error: "Sin sesión de conductor." };
  }

  const pedidoId = formData.get("pedidoId") as string;
  const tipoIncidencia = formData.get("tipoIncidencia") as TipoIncidencia | null;
  const fotoBlob = formData.get("foto") as Blob | null;
  const latStr = formData.get("lat") as string | null;
  const longStr = formData.get("long") as string | null;
  const precisionStr = formData.get("precisionM") as string | null;

  if (!pedidoId) return { error: "Falta el ID del pedido." };
  if (!tipoIncidencia) return { error: "Debes seleccionar el motivo de no entrega." };

  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();

  try {
    // --- 1. Subir foto si viene (opcional para fallido) ----------------------
    let fotoObjectPath: string | undefined;

    if (fotoBlob && fotoBlob.size > 0) {
      const archivoId = crypto.randomUUID();
      const rutaStorage = `${tenantId}/${pedidoId}/${archivoId}.jpg`;

      const { error: errorSubida } = await cliente.storage
        .from("pod-evidencias")
        .upload(rutaStorage, fotoBlob, {
          contentType: "image/jpeg",
          upsert: false,
        });

      if (!errorSubida) {
        fotoObjectPath = rutaStorage;
      }
    }

    // --- 2. Armar geo (sin loguearlo) ----------------------------------------
    const geo =
      latStr && longStr
        ? {
            lat: parseFloat(latStr),
            long: parseFloat(longStr),
            precisionM: precisionStr ? parseFloat(precisionStr) : undefined,
          }
        : undefined;

    // --- 3. Registrar POD fallido -------------------------------------------
    await registrarPruebaEntrega(
      cliente,
      {
        pedidoId,
        tenantId,
        tipoResultado: "fallido",
        tipoIncidencia,
        fotoObjectPath,
        geo,
      },
      { ...sesion.usuario, usuarioId: sesion.usuarioId },
    );

    // --- 4. Transicionar estado a 'fallido' ---------------------------------
    await actualizarEstadoPedido(
      cliente,
      {
        pedidoId,
        tenantId,
        estadoNuevo: "fallido",
        estadoEsperado: "en_ruta",
        ejecutor: "conductor",
        tipoIncidenciaConductor: tipoIncidencia,
        actuadoPorUsuarioId: sesion.usuarioId,
      },
      sesion.usuario,
    );

    revalidatePath(`/conductor/manifiesto/${pedidoId}`);
    revalidatePath("/conductor/manifiesto");

    return { exito: true, esValido: true };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error al registrar el no entregado.";
    return { error: mensaje };
  }
}

// =============================================================================
// actionPingUbicacion
// =============================================================================

/**
 * El conductor envía su posición GPS periódicamente mientras está en ruta.
 * DATOS PERSONALES: lat/long nunca en logs del servidor.
 * No devuelve la ubicación al cliente — solo confirma el éxito.
 */
export async function actionPingUbicacion(formData: FormData): Promise<{ exito?: boolean; error?: string }> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId || !sesion.usuario.driverId) {
    return { error: "Sin sesión de conductor." };
  }

  const latStr = formData.get("lat") as string | null;
  const longStr = formData.get("long") as string | null;
  const precisionStr = formData.get("precisionM") as string | null;

  if (!latStr || !longStr) return { error: "Coordenadas inválidas." };

  const lat = parseFloat(latStr);
  const long = parseFloat(longStr);
  if (isNaN(lat) || isNaN(long)) return { error: "Coordenadas inválidas." };

  try {
    const cliente = crearClienteServiceRole();
    await actualizarUbicacionConductor(
      cliente,
      sesion.usuario.driverId,
      sesion.usuario.tenantId,
      {
        lat,
        long,
        precisionM: precisionStr ? parseFloat(precisionStr) : undefined,
      },
    );
    return { exito: true };
  } catch (err) {
    // Ping no crítico: no bloqueamos la UX si falla.
    const mensaje = err instanceof Error ? err.message : "Error al actualizar ubicación.";
    return { error: mensaje };
  }
}

// =============================================================================
// actionBorrarUbicacion
// =============================================================================

/**
 * Borra la ubicación del conductor al cerrar la ruta o cerrar sesión.
 * Minimización de datos (Ley 21.431).
 */
export async function actionBorrarUbicacion(): Promise<{ exito?: boolean; error?: string }> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId || !sesion.usuario.driverId) {
    return { error: "Sin sesión de conductor." };
  }

  try {
    const cliente = crearClienteServiceRole();
    await borrarUbicacionAlCerrarRuta(
      cliente,
      sesion.usuario.driverId,
      sesion.usuario.tenantId,
    );
    return { exito: true };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error al borrar ubicación.";
    return { error: mensaje };
  }
}

// =============================================================================
// actionObtenerUrlPod
// =============================================================================

/**
 * Genera una URL firmada de 15 minutos para la foto del POD.
 * El conductor solo puede ver sus propios PODs (verificado en obtenerUrlFirmadaPod).
 */
export async function actionObtenerUrlPod(podId: string): Promise<{ url?: string; error?: string }> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { error: "Sin sesión." };
  }

  try {
    const cliente = crearClienteServiceRole();
    const url = await obtenerUrlFirmadaPod(cliente, podId, sesion.usuario);
    return { url };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "No se pudo obtener el enlace de la foto.";
    return { error: mensaje };
  }
}

// =============================================================================
// actionRegistrarConsentimientoUbicacion
// =============================================================================

/**
 * Registra el consentimiento (o rechazo) del conductor para compartir su
 * ubicación en vivo.
 *
 * Flujo (dentro del módulo `consentimiento-ubicacion`):
 *   1. Bitácora ANTES del efecto (acción _otorgado / _rechazado).
 *   2. INSERT en `operacion.consentimientos_ubicacion` (tabla autoritativa).
 *
 * La versión del texto se fija en VERSION_TEXTO_CONSENTIMIENTO_UBICACION.
 * El copywriter define el texto y bumpeará la versión cuando lo cambie.
 *
 * @param acepto true si el conductor otorga consentimiento; false si lo rechaza.
 * @param versionTexto Opcional — permite al frontend pasar una versión diferente
 *   si el texto fue bumpeado. Por defecto usa VERSION_TEXTO_CONSENTIMIENTO_UBICACION.
 */
export async function actionRegistrarConsentimientoUbicacion(
  acepto: boolean,
  versionTexto: string = VERSION_TEXTO_CONSENTIMIENTO_UBICACION,
): Promise<{ exito?: boolean; error?: string }> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId || !sesion.usuario.driverId) {
    return { error: "Sin sesión de conductor." };
  }

  try {
    const cliente = crearClienteServiceRole();
    await registrarConsentimientoUbicacion(cliente, {
      tenantId: sesion.usuario.tenantId,
      conductorId: sesion.usuario.driverId,
      actorUsuarioId: sesion.usuarioId,
      acepto,
      versionTexto,
    });
    return { exito: true };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error al registrar consentimiento.";
    return { error: mensaje };
  }
}

// =============================================================================
// actionRevocarConsentimientoUbicacion
// =============================================================================

/**
 * Revoca el consentimiento de ubicación del conductor.
 *
 * Flujo (dentro del módulo `consentimiento-ubicacion`):
 *   1. Bitácora ANTES del efecto (acción conductor.ubicacion.consentimiento_revocado).
 *   2. Marca `revocado_en = now()` en el último consentimiento otorgado vigente.
 *   3. Borra la ubicación vigente inmediatamente (minimización — Ley 21.431).
 *
 * Es idempotente: si no hay consentimiento vigente, no lanza error.
 */
export async function actionRevocarConsentimientoUbicacion(): Promise<{
  exito?: boolean;
  error?: string;
}> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId || !sesion.usuario.driverId) {
    return { error: "Sin sesión de conductor." };
  }

  try {
    const cliente = crearClienteServiceRole();
    await revocarConsentimientoUbicacion(cliente, {
      tenantId: sesion.usuario.tenantId,
      conductorId: sesion.usuario.driverId,
      actorUsuarioId: sesion.usuarioId,
    });
    return { exito: true };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error al revocar consentimiento.";
    return { error: mensaje };
  }
}
