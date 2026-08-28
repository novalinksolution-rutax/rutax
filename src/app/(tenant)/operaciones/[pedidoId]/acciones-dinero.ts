"use server";

/**
 * Server Actions de corrección manual del dinero de un pedido (B2 + B1).
 *
 * B2: anular cobro/liquidación manualmente.
 * B1: reclasificar tipo de incidencia + re-disparar C1 automáticamente.
 */

import { revalidatePath } from "next/cache";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import {
  anularLineaCobroPedido,
  anularLineaLiquidacionPedido,
} from "@/modules/dinero/acciones";
import { reclasificarIncidencia } from "@/modules/operacion/incidencias";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import {
  puedeEmitirFacturas,
  puedeGestionarLiquidacionesConductores,
} from "@/modules/identidad/capacidades";
import { inngest } from "@/lib/inngest/cliente";
import type { TipoIncidencia } from "@/modules/operacion/tipos";

export async function accionAnularCobroPedido(
  pedidoId: string,
  motivo: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) return { ok: false, mensaje: "Sin sesión." };
  try {
    await anularLineaCobroPedido(
      sesion.usuario.tenantId,
      pedidoId,
      motivo,
      sesion.usuario,
      sesion.usuarioId,
    );
    revalidatePath(`/operaciones/${pedidoId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Error al anular el cobro." };
  }
}

export async function accionAnularLiquidacionPedido(
  pedidoId: string,
  motivo: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) return { ok: false, mensaje: "Sin sesión." };
  try {
    await anularLineaLiquidacionPedido(
      sesion.usuario.tenantId,
      pedidoId,
      motivo,
      sesion.usuario,
      sesion.usuarioId,
    );
    revalidatePath(`/operaciones/${pedidoId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : "Error al anular la liquidación." };
  }
}

/**
 * B1: Reclasifica el tipo de una incidencia y re-dispara C1 para regenerar
 * las líneas de cobro/liquidación con los montos correctos.
 *
 * Flujo:
 * 1. `reclasificarIncidencia` actualiza la incidencia y anula las líneas mutables.
 * 2. Publicamos `dinero/pedido.estado_financiero_relevante` con el estado actual
 *    del pedido; C1 lo recibe y reactiva/crea las líneas nuevas.
 */
export async function accionReclasificarIncidencia(
  pedidoId: string,
  incidenciaId: string,
  nuevoTipo: TipoIncidencia,
): Promise<{ ok: boolean; mensaje?: string }> {
  const sesion = await exigirSesionActual();
  const tenantId = sesion.usuario.tenantId;
  if (!tenantId) return { ok: false, mensaje: "Sin sesión." };

  try {
    const supabase = crearClienteServiceRole();

    // Reclasificar y anular líneas mutables.
    await reclasificarIncidencia(
      supabase,
      { incidenciaId, tenantId, pedidoId, nuevoTipo, actorUsuarioId: sesion.usuarioId },
      sesion.usuario,
    );

    // Leer datos del pedido para armar el evento de re-disparo.
    const { data: pedido } = await supabase
      .schema("operacion")
      .from("pedidos")
      .select("estado, seller_id, tipo_pedido, tarifa_aplicable_id, actualizado_en")
      .eq("id", pedidoId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!pedido) return { ok: false, mensaje: "Pedido no encontrado." };

    // Solo re-disparar C1 si el estado del pedido genera líneas.
    const estadosQueGeneranLineas = [
      "entregado", "entregado_manual", "fallido", "fallido_manual",
    ] as const;
    type EstadoFinanciero = (typeof estadosQueGeneranLineas)[number];
    const estadoFinanciero = estadosQueGeneranLineas.includes(pedido.estado as EstadoFinanciero)
      ? (pedido.estado as EstadoFinanciero)
      : null;

    if (estadoFinanciero) {
      // Leer driver_id de la asignación activa.
      const { data: asignacion } = await supabase
        .from("asignaciones_pedido")
        .select("driver_id")
        .eq("pedido_id", pedidoId)
        .eq("tenant_id", tenantId)
        .eq("activa", true)
        .maybeSingle();

      await inngest.send({
        name: "dinero/pedido.estado_financiero_relevante",
        data: {
          pedidoId,
          tenantId,
          sellerId: pedido.seller_id as string,
          driverIdAsignado: (asignacion?.driver_id as string | null) ?? null,
          estadoNuevo: estadoFinanciero,
          estadoAnterior: estadoFinanciero,
          fechaTransicion: pedido.actualizado_en as string,
          tipoPedido: pedido.tipo_pedido as "flex" | "same_day",
          tarifaAplicableId: (pedido.tarifa_aplicable_id as string | null) ?? null,
        },
      });
    }

    revalidatePath(`/operaciones/${pedidoId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al reclasificar la incidencia.",
    };
  }
}

/**
 * Vuelve a pedirle al motor las líneas de dinero de un pedido.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ EXISTE (2026-08-28)
 * -----------------------------------------------------------------------------
 * Seis entregas de agosto quedaron con su cobro al seller y **sin** su línea de
 * liquidación: `asignar-periodo-cobro` vivía antes de la liquidación y falló de
 * forma legítima contra un período cerrado, llevándose por delante los pasos que
 * venían después (arreglado en `6444e49`). Ese arreglo impide que vuelva a
 * pasar; **no repone lo que ya faltaba**, y no había ninguna forma de reponerlo
 * desde el producto.
 *
 * La única acción que re-disparaba el motor era `accionReclasificarIncidencia`,
 * que primero **anula** las líneas mutables. Usarla acá habría destruido seis
 * cobros que estaban bien.
 *
 * -----------------------------------------------------------------------------
 * 🔴 ES SEGURA PORQUE EL MOTOR ES IDEMPOTENTE, NO PORQUE ACÁ SE COMPRUEBE NADA
 * -----------------------------------------------------------------------------
 * Las dos inserciones del job van con `ON CONFLICT (pedido_id) DO NOTHING`, así
 * que re-disparar **no puede duplicar** una línea existente: solo escribe la que
 * falta. Esa garantía vive en `generar-lineas.ts` y es lo que hace que esto no
 * necesite un candado propio. Si algún día se quitara ese `ON CONFLICT`, esta
 * acción se vuelve un generador de cobros duplicados.
 *
 * -----------------------------------------------------------------------------
 * SE NIEGA ANTES DE PROMETER
 * -----------------------------------------------------------------------------
 * Sin asignación activa el motor devuelve `null` **en silencio** (`if
 * (!elegibilidad.generaLiquidacion || !driverIdAsignado) return null`). Un botón
 * que dispara un job que no hace nada y no lo dice enseña a desconfiar de la
 * app, así que ese caso se rechaza acá con su motivo.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ NO CONFIRMA QUE LA LÍNEA EXISTA
 * -----------------------------------------------------------------------------
 * Publica un evento; el job corre después, en Inngest. Decir «listo, ya está» al
 * volver sería mentir sobre algo que todavía no ocurrió. El texto de vuelta dice
 * lo único cierto: que se pidió.
 */
export async function accionRegenerarLineasDinero(
  pedidoId: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const sesion = await exigirSesionActual();
  const tenantId = sesion.usuario.tenantId;
  if (!tenantId) return { ok: false, mensaje: "Sin sesión." };

  // Las DOS mitades: el motor puede escribir cobro y liquidación, así que pedir
  // una sola sería una puerta lateral hacia la otra. Mismo criterio que la
  // Reportería, y cae en {dueño, administración}.
  if (
    !puedeEmitirFacturas(sesion.usuario) ||
    !puedeGestionarLiquidacionesConductores(sesion.usuario)
  ) {
    return { ok: false, mensaje: "No tienes permiso para regenerar líneas de dinero." };
  }

  try {
    const supabase = crearClienteServiceRole();

    const { data: pedido } = await supabase
      .schema("operacion")
      .from("pedidos")
      .select("estado, seller_id, tipo_pedido, tarifa_aplicable_id, actualizado_en")
      .eq("id", pedidoId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!pedido) return { ok: false, mensaje: "Pedido no encontrado." };

    const ESTADOS_QUE_GENERAN = [
      "entregado",
      "entregado_manual",
      "fallido",
      "fallido_manual",
    ] as const;
    type EstadoFinanciero = (typeof ESTADOS_QUE_GENERAN)[number];
    if (!ESTADOS_QUE_GENERAN.includes(pedido.estado as EstadoFinanciero)) {
      return {
        ok: false,
        mensaje: `Un pedido en estado «${pedido.estado}» no genera líneas de dinero.`,
      };
    }
    const estadoFinanciero = pedido.estado as EstadoFinanciero;

    const { data: asignacion } = await supabase
      .from("asignaciones_pedido")
      .select("driver_id")
      .eq("pedido_id", pedidoId)
      .eq("tenant_id", tenantId)
      .eq("activa", true)
      .maybeSingle();

    const driverId = (asignacion?.driver_id as string | null) ?? null;
    if (!driverId) {
      return {
        ok: false,
        mensaje:
          "Este pedido no tiene un conductor asignado, así que no hay a quién liquidarle. " +
          "Asígnalo primero y vuelve a intentarlo.",
      };
    }

    // Bitácora ANTES del efecto y con autor: es una acción financiera (RNF-04).
    // Si la publicación del evento falla, la intención queda registrada igual.
    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "dinero.lineas_regeneradas_solicitadas",
      entidadTipo: "pedido",
      entidadId: pedidoId,
      detalle: { estado: estadoFinanciero, driverId },
    });

    await inngest.send({
      name: "dinero/pedido.estado_financiero_relevante",
      data: {
        pedidoId,
        tenantId,
        sellerId: pedido.seller_id as string,
        driverIdAsignado: driverId,
        estadoNuevo: estadoFinanciero,
        estadoAnterior: estadoFinanciero,
        fechaTransicion: pedido.actualizado_en as string,
        tipoPedido: pedido.tipo_pedido as "flex" | "same_day",
        tarifaAplicableId: (pedido.tarifa_aplicable_id as string | null) ?? null,
      },
    });

    revalidatePath(`/operaciones/${pedidoId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "No se pudo pedir la regeneración.",
    };
  }
}
