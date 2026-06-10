/**
 * GET /api/operaciones/:pedidoId/etiqueta — descarga la etiqueta de envío (PDF)
 * de Mercado Libre asociada a un pedido (RF-021, item C-04).
 *
 * Flujo:
 * 1. Requiere sesión activa (401 si no hay).
 * 2. Requiere la misma capacidad que protege las acciones operativas de
 *    asignación/reasignación en el detalle del pedido
 *    (`puedeAsignarYReasignarPedidos` — ver
 *    `src/app/(tenant)/operaciones/[pedidoId]/page.tsx`). 403 si no la tiene.
 * 3. Lee el pedido vía `service_role` filtrando por `id` Y `tenant_id` del
 *    usuario — aislamiento multi-tenant, nunca confiar en el `pedidoId` de la
 *    URL sin este filtro. 404 si no existe (incluye pedidos de otro tenant).
 * 4. Si el pedido no tiene `ml_shipment_id` (same-day manual u otro origen sin
 *    envío ML) → 400.
 * 5. Llama al adaptador ML (`obtenerEtiquetaEnvio`) — el único punto de
 *    contacto con la API externa.
 * 6. Éxito → responde el PDF inline y registra en bitácora de auditoría.
 * 7. `ErrorConexionMlRequiereRevinculacion` → 409.
 * 8. Cualquier otro error (incl. `ErrorHttpMl`) → 502, sin exponer detalles
 *    internos al cliente; se loguea en servidor (sin tokens).
 */

import { NextRequest, NextResponse } from "next/server";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeAsignarYReasignarPedidos } from "@/modules/identidad/capacidades";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import {
  obtenerEtiquetaEnvio,
  ErrorConexionMlRequiereRevinculacion,
} from "@/modules/integraciones/ml";

interface Params {
  params: Promise<{ pedidoId: string }>;
}

export async function GET(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const sesion = await obtenerSesionActual();
  if (!sesion) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  if (!sesion.usuario.tenantId) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  if (!puedeAsignarYReasignarPedidos(sesion.usuario)) {
    return NextResponse.json(
      { error: "No tienes permiso para descargar la etiqueta de este pedido." },
      { status: 403 },
    );
  }

  const { pedidoId } = await params;
  const tenantId = sesion.usuario.tenantId;

  const cliente = crearClienteServiceRole();
  const { data: pedido, error: errorLectura } = await cliente
    .from("pedidos")
    .select("id, seller_id, ml_shipment_id")
    .eq("id", pedidoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (errorLectura) {
    console.error("Error al leer pedido para etiqueta:", errorLectura.message);
    return NextResponse.json(
      { error: "No se pudo obtener la etiqueta desde Mercado Libre. Intenta nuevamente más tarde." },
      { status: 502 },
    );
  }

  if (!pedido) {
    return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });
  }

  if (!pedido.ml_shipment_id) {
    return NextResponse.json(
      { error: "Este pedido no tiene un envío de Mercado Libre asociado." },
      { status: 400 },
    );
  }

  try {
    const { contenido, contentType } = await obtenerEtiquetaEnvio({
      sellerId: pedido.seller_id,
      mlShipmentId: pedido.ml_shipment_id,
    });

    await registrarEnBitacora(cliente, {
      tenantId,
      actorUsuarioId: sesion.usuarioId,
      actorTipo: "usuario",
      accion: "operacion.etiqueta_descargada",
      entidadTipo: "pedido",
      entidadId: pedidoId,
      detalle: {
        ml_shipment_id: pedido.ml_shipment_id,
        seller_id: pedido.seller_id,
      },
    });

    return new NextResponse(contenido, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="etiqueta-${pedido.ml_shipment_id}.pdf"`,
      },
    });
  } catch (error) {
    if (error instanceof ErrorConexionMlRequiereRevinculacion) {
      return NextResponse.json(
        {
          error:
            "La conexión de Mercado Libre del seller requiere reconexión. No se puede obtener la etiqueta.",
        },
        { status: 409 },
      );
    }

    // No exponer detalles internos del error al cliente — pero sí loguearlos
    // en servidor (sin tokens; el cuerpo de ErrorHttpMl ya viene saneado).
    console.error("Error al obtener etiqueta de envío desde ML:", error);

    return NextResponse.json(
      { error: "No se pudo obtener la etiqueta desde Mercado Libre. Intenta nuevamente más tarde." },
      { status: 502 },
    );
  }
}
