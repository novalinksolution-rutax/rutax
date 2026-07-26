"use server";

/**
 * Server Action · Reintentar la ubicación (geocoding) de un pedido.
 *
 * El geocoding solo corre cuando el pedido pasa por la tubería de ingesta
 * (same-day o ML), que publica `operacion/pedido.ingestado` y dispara el job
 * `integraciones/geocoding/jobs/geocodificar-pedido`. Un pedido cuyo job nunca
 * corrió (Inngest caído, o data sembrada fuera de la tubería) queda atascado en
 * `geo_estado='pendiente'` para siempre. Esta acción re-publica ese mismo evento
 * a demanda, para desatascar la ubicación sin re-ingerir el pedido.
 *
 * Gate RBAC: `puedeAjustarOperacionDiaria` — el mismo que muestra el botón. La
 * comprobación se impone también aquí porque la Server Action es invocable
 * directamente.
 */

import { revalidatePath } from "next/cache";
import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { inngest } from "@/lib/inngest/cliente";
import { puedeAjustarOperacionDiaria } from "@/modules/identidad/capacidades";

export async function accionReubicarPedido(
  pedidoId: string,
): Promise<{ ok: boolean; mensaje?: string }> {
  const sesion = await exigirSesionActual();
  const tenantId = sesion.usuario.tenantId;
  if (!tenantId) return { ok: false, mensaje: "Sin sesión." };

  if (!puedeAjustarOperacionDiaria(sesion.usuario)) {
    return { ok: false, mensaje: "No tienes permiso para reintentar la ubicación." };
  }

  try {
    const supabase = crearClienteServiceRole();

    // Leer con filtro de tenant — aislamiento multi-courier.
    const { data: pedido, error } = await supabase
      .schema("operacion")
      .from("pedidos")
      .select(
        "id, seller_id, tipo_pedido, destinatario_direccion, destinatario_comuna, geo_estado",
      )
      .eq("id", pedidoId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) return { ok: false, mensaje: `No se pudo leer el pedido: ${error.message}` };
    if (!pedido) return { ok: false, mensaje: "Pedido no encontrado." };

    // El job no-opea si `geo_estado != 'pendiente'`. Para permitir reintentar
    // sobre un pedido ya resuelto/no_resuelto lo devolvemos a 'pendiente' antes
    // de re-publicar el evento.
    if (pedido.geo_estado !== "pendiente") {
      const { error: resetError } = await supabase
        .schema("operacion")
        .from("pedidos")
        .update({ geo_estado: "pendiente", geocodificado_en: null })
        .eq("id", pedidoId)
        .eq("tenant_id", tenantId);
      if (resetError) {
        return { ok: false, mensaje: `No se pudo reiniciar el geocoding: ${resetError.message}` };
      }
    }

    // Re-publica el mismo evento que emite la ingesta. Sin `id` de dedupe: es un
    // reintento explícito y queremos que el evento se entregue. (El job conserva
    // su `idempotency: event.data.pedidoId`, que evita runs duplicados dentro de
    // la ventana de Inngest; el caso común aquí —pendiente que nunca corrió— no
    // tiene run previo, así que se ejecuta.)
    await inngest.send({
      name: "operacion/pedido.ingestado",
      data: {
        pedidoId: pedido.id as string,
        tenantId,
        sellerId: pedido.seller_id as string,
        direccion: pedido.destinatario_direccion as string,
        comuna: (pedido.destinatario_comuna as string | null) ?? "",
        tipoPedido: pedido.tipo_pedido as "flex" | "same_day",
      },
    });

    revalidatePath(`/operaciones/${pedidoId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      mensaje: err instanceof Error ? err.message : "Error al reintentar la ubicación.",
    };
  }
}
