"use server";

/**
 * Server Action del retiro registrado desde la web.
 * =============================================================================
 *
 * Molde exacto de `preparacion/asignar/actions.ts`: sesión → capacidad →
 * `service_role` → función de dominio → `revalidatePath`. Toda la lógica vive
 * en `modules/operacion/retiro/registro-web.ts`; esto es el gate y la
 * traducción a la respuesta de la pantalla.
 *
 * =============================================================================
 * POR QUÉ EL CONDUCTOR VIAJA EN EL CUERPO, AL REVÉS QUE EN LA APP
 * =============================================================================
 * En las rutas Bearer del conductor el receptor sale del token y **nunca** del
 * cuerpo — es la defensa que impide que un conductor le mueva trabajo, y por lo
 * tanto plata, a otro (`api/conductor/traspasos/route.ts`).
 *
 * Acá es al revés a propósito: **decir quién retiró ES la acción**. El
 * coordinador está registrando un hecho del que no fue protagonista. Lo que
 * sostiene la seguridad no es el token, es el gate RBAC —una capacidad que solo
 * tienen dueño, supervisor y coordinador— más el asiento de bitácora con su
 * autor que escribe la función de dominio antes de tocar nada.
 *
 * ⚠️ **Esto genera dinero.** Cerrar la visita le paga al conductor la visita y
 * le avisa al seller por WhatsApp. Es la decisión del usuario (2026-08-26):
 * ciclo idéntico al real, sin modo "solo marcar". La pantalla tiene que
 * decirlo antes de que el coordinador apriete.
 */

import { revalidatePath } from "next/cache";

import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeAsignarYReasignarPedidos } from "@/modules/identidad/capacidades";
import {
  registrarRetiroDesdeWeb,
  TOPE_PEDIDOS_RETIRO,
  type ResultadoRegistroWeb,
} from "@/modules/operacion/retiro/registro-web";

type RespuestaOk<T> = { ok: true; datos: T };
type RespuestaError = { ok: false; mensaje: string };
type Respuesta<T> = RespuestaOk<T> | RespuestaError;

/**
 * Registra un retiro completo: abre la visita, mete los bultos y la cierra.
 *
 * Devuelve el resultado íntegro —incluidos los pedidos que no se pudieron
 * registrar y su motivo— para que la pantalla pueda mostrar el parcial. Nunca
 * un booleano suelto: un retiro donde 3 de 40 bultos no entraron es información
 * que el coordinador necesita antes de mandar a nadie a la calle.
 */
export async function actionRegistrarRetiroDesdeWeb(
  conductorId: string,
  bodegaId: string,
  pedidoIds: string[],
): Promise<Respuesta<ResultadoRegistroWeb>> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, mensaje: "No hay sesión activa." };
  }

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para registrar retiros." };
  }

  if (!conductorId) {
    return { ok: false, mensaje: "Debes elegir quién retiró." };
  }
  if (!bodegaId) {
    return { ok: false, mensaje: "Debes elegir en qué bodega se retiró." };
  }
  if (!Array.isArray(pedidoIds) || pedidoIds.length === 0) {
    return { ok: false, mensaje: "Debes seleccionar al menos un pedido." };
  }
  if (pedidoIds.length > TOPE_PEDIDOS_RETIRO) {
    return {
      ok: false,
      mensaje: `Son demasiados pedidos de una vez (${pedidoIds.length}). Registra hasta ${TOPE_PEDIDOS_RETIRO} por tanda.`,
    };
  }

  try {
    const cliente = crearClienteServiceRole();
    const datos = await registrarRetiroDesdeWeb(cliente, {
      tenantId: sesion.usuario.tenantId,
      conductorId,
      bodegaId,
      pedidoIds,
      actorUsuarioId: sesion.usuarioId,
    });

    // Los pedidos pasan a `retirado`, así que aparecen en la bandeja de
    // asignación; y la Preparación del día muestra la visita recién cerrada.
    revalidatePath("/preparacion");
    revalidatePath("/preparacion/asignar");
    revalidatePath("/preparacion/registrar-retiro");
    revalidatePath("/operaciones");

    return { ok: true, datos };
  } catch (err) {
    // Sin adjuntar los ids: el mensaje va a pantalla.
    const mensaje =
      err instanceof Error ? err.message : "No se pudo registrar el retiro.";
    return { ok: false, mensaje };
  }
}
