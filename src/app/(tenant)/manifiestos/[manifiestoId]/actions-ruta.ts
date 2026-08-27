"use server";

/**
 * Server Actions de la RUTA del manifiesto — etapa 7 de "retiro en bodega +
 * ruteo" (`docs/arquitectura/retiro-y-ruteo.md` §4).
 *
 * Son el grifo que le faltaba a la plomería: hasta ahora el motor
 * (`modules/operacion/ruteo/`) y la escritura de la secuencia
 * (`aplicar_secuencia_paradas`) estaban construidos y **nadie los llamaba**.
 *
 * Dos acciones para el mismo hecho, que es como lo modela la base:
 *
 *   · `accionCalcularRuta`      — el motor propone una secuencia (`origen: motor`).
 *   · `accionGuardarOrdenManual` — el coordinador la corrige (`origen: manual`).
 *
 * =============================================================================
 * EL REORDENAMIENTO MANUAL NO ES OPCIONAL
 * =============================================================================
 * Las distancias del motor son en LÍNEA RECTA. En Santiago el Mapocho, la
 * Costanera y Vespucio producen saltos que sobre el plano real son absurdos, y
 * el motor no los disimula a propósito. Si el conductor ve uno de esos saltos en
 * su primera ruta, va a ignorar la secuencia para siempre — y con ella todo el
 * valor de la etapa. Por eso la corrección a mano es parte del producto, no un
 * extra: `accionGuardarOrdenManual` es tan de primera clase como el motor.
 *
 * =============================================================================
 * SIEMPRE LA LISTA COMPLETA, NUNCA UN DELTA
 * =============================================================================
 * `pedidoIdsEnOrden` es la secuencia FINAL del manifiesto y su posición es el
 * orden. No existe "mover la parada 5 al lugar 2" como operación: un delta
 * obliga a razonar sobre un estado previo que puede haber cambiado bajo los pies
 * del coordinador. Lo que no venga en la lista queda sin secuencia, que es el
 * estado correcto de una parada que el motor no pudo ubicar.
 *
 * =============================================================================
 * `requiereRecarga` — POR QUÉ ESE CAMPO EXISTE
 * =============================================================================
 * `P0001` significa "la asignación cambió mientras ordenabas". Reintentar con la
 * MISMA lista falla igual, así que el botón correcto es "recargar", no
 * "reintentar". Se distingue por TIPO (`ErrorSecuenciaDesincronizada`), nunca
 * por el texto del mensaje.
 *
 * =============================================================================
 * EL PUNTO DE TÉRMINO NO PASA POR AQUÍ
 * =============================================================================
 * El ancla del conductor entra en el cálculo dentro de
 * `calcularYAplicarRutaManifiesto` y no sale: no está en el resultado de estas
 * acciones, ni en las props de la pantalla, ni en un mensaje de error. Ver
 * `docs/seguridad/punto-de-termino-conductor.md` §4 y la cabecera de
 * `modules/operacion/ruta-manifiesto.ts`.
 */

import { revalidatePath } from "next/cache";

import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeAsignarYReasignarPedidos } from "@/modules/identidad/capacidades";
import {
  calcularYAplicarRutaManifiesto,
  ErrorSinBodegaOrigen,
} from "@/modules/operacion/ruta-manifiesto";
import {
  aplicarSecuenciaParadasRpc,
  ErrorSecuenciaDesincronizada,
} from "@/modules/operacion/secuencia-paradas-rpc";

// =============================================================================
// Contrato de respuesta
// =============================================================================

export interface ResultadoAccionRuta {
  ok: boolean;
  mensaje?: string;
  /**
   * `true` cuando el error solo se arregla volviendo a cargar la pantalla. La
   * interfaz debe ofrecer RECARGAR y esconder el botón de guardar: reintentar
   * con la misma lista falla exactamente igual.
   */
  requiereRecarga?: boolean;
  /** Solo cuando la escritura tuvo éxito. Nunca lleva nada del punto de término. */
  resumen?: {
    totalParadas: number;
    totalSinSecuencia: number;
    /**
     * Metros de bodega a la última parada. **Solo lo trae el cálculo del
     * motor**; el reordenamiento manual lo deja `undefined` porque no vuelve a
     * llamar al motor y no tiene un número nuevo que dar. `undefined` es
     * "no se recalculó", que es distinto de "0 km" — mostrarlo como cero sería
     * mentir sobre una ruta que sí tiene largo.
     */
    distanciaTotalM?: number;
    /** Bodega desde la que se calculó. Solo en el cálculo del motor. */
    nombreOrigen?: string;
    /**
     * Quién resolvió la secuencia: `local` (motor propio, línea recta) o
     * `google` (Route Optimization, por calle y con tráfico).
     *
     * Viaja al navegador a propósito: la advertencia «esto es una propuesta en
     * línea recta» deja de ser cierta cuando la ruta vino por calle, y no se
     * puede decidir en tiempo de escritura cuál de las dos mostrar.
     */
    proveedor?: "local" | "google";
    /** Segundos de conducción estimados. `null` con motor local. */
    duracionTotalS?: number | null;
    /**
     * Geometría por calle de cada tramo, para dibujar la ruta en el mapa.
     * `null` con motor local.
     *
     * ⚠️ **Sale de aquí y es seguro, pero conviene saber por qué.** El
     * adaptador ya descartó el tramo final hacia el punto de término del
     * conductor (canal 3 del §4.3 de
     * `docs/seguridad/punto-de-termino-conductor.md`), así que hay tantos
     * tramos como paradas en secuencia, exista o no ancla — la respuesta es
     * idéntica en los dos casos. No hay un solo vértice del ancla acá dentro,
     * ni siquiera para encuadrar el mapa.
     */
    tramos?: readonly { distanciaM: number; duracionS: number; polilinea: string | null }[] | null;
  };
}

/**
 * Traduce cualquier fallo a la respuesta de la acción.
 *
 * `ErrorSinBodegaOrigen` y `ErrorSecuenciaDesincronizada` llevan mensajes
 * pensados para el coordinador y se dejan pasar tal cual; lo demás se resume,
 * porque un `message` crudo de PostgREST en pantalla no ayuda a nadie y puede
 * arrastrar detalle interno.
 */
function aRespuesta(err: unknown): ResultadoAccionRuta {
  if (err instanceof ErrorSecuenciaDesincronizada) {
    return { ok: false, mensaje: err.message, requiereRecarga: true };
  }
  if (err instanceof ErrorSinBodegaOrigen) {
    return { ok: false, mensaje: err.message };
  }
  return {
    ok: false,
    mensaje: err instanceof Error ? err.message : "No se pudo aplicar la ruta.",
  };
}

// =============================================================================
// Calcular la ruta (motor)
// =============================================================================

export async function accionCalcularRuta(
  manifiestoId: string,
): Promise<ResultadoAccionRuta> {
  const sesion = await exigirSesionActual();
  const tenantId = sesion.usuario.tenantId;
  if (!tenantId) return { ok: false, mensaje: "Sin sesión." };

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para calcular la ruta." };
  }
  if (!manifiestoId) return { ok: false, mensaje: "Falta el manifiesto." };

  try {
    const resumen = await calcularYAplicarRutaManifiesto(crearClienteServiceRole(), {
      tenantId,
      manifiestoId,
      // RNF-04: toda acción lleva su autor. La bitácora la escribe la función
      // SQL dentro de la misma transacción — aquí no se escribe un segundo asiento.
      actorUsuarioId: sesion.usuarioId,
    });

    revalidatePath(`/manifiestos/${manifiestoId}`);
    return { ok: true, resumen };
  } catch (err) {
    return aRespuesta(err);
  }
}

// =============================================================================
// Guardar el orden que fijó el coordinador a mano
// =============================================================================

export async function accionGuardarOrdenManual(
  manifiestoId: string,
  pedidoIdsEnOrden: string[],
): Promise<ResultadoAccionRuta> {
  const sesion = await exigirSesionActual();
  const tenantId = sesion.usuario.tenantId;
  if (!tenantId) return { ok: false, mensaje: "Sin sesión." };

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para reordenar la ruta." };
  }
  if (!manifiestoId) return { ok: false, mensaje: "Falta el manifiesto." };
  if (!Array.isArray(pedidoIdsEnOrden)) {
    return { ok: false, mensaje: "La lista de paradas no es válida." };
  }

  try {
    const resultado = await aplicarSecuenciaParadasRpc(crearClienteServiceRole(), {
      tenantId,
      manifiestoId,
      pedidoIdsEnOrden,
      origen: "manual",
      actorUsuarioId: sesion.usuarioId,
    });

    revalidatePath(`/manifiestos/${manifiestoId}`);
    return {
      ok: true,
      // Sin `distanciaTotalM` ni `nombreOrigen`: el reordenamiento manual no
      // vuelve a llamar al motor (no hace falta — el motor no guarda estado
      // entre corridas), así que no hay número nuevo que reportar.
      resumen: {
        totalParadas: resultado.totalParadas,
        totalSinSecuencia: resultado.totalSinSecuencia,
      },
    };
  } catch (err) {
    return aRespuesta(err);
  }
}
