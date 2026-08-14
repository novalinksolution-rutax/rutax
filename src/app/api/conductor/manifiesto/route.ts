import { type NextRequest, NextResponse } from "next/server";
import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { ordenarParadasConSecuencia } from "@/modules/operacion/orden-paradas";
import { listarCierresPorPedidos } from "@/modules/operacion/cierre-conductor";
import { obtenerManifiestoVigenteDelConductor } from "@/modules/operacion/manifiesto-vigente";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import { ESTADOS_TERMINALES, type EstadoPedido } from "@/modules/operacion/tipos";

/**
 * GET /api/conductor/manifiesto
 *
 * Devuelve el manifiesto activo del día para el conductor autenticado.
 * Consumido por la app Expo (Bearer token) — misma lógica que la PWA Next.js
 * (`src/app/conductor/manifiesto/page.tsx`) pero como JSON para cliente móvil.
 */
export async function GET(request: NextRequest) {
  const usuario = await autenticarBearer(request.headers.get("authorization"));
  if (
    !usuario ||
    usuario.tipoUsuario !== "conductor" ||
    !usuario.driverId ||
    !usuario.tenantId
  ) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (usuario.estado !== "activo") {
    return NextResponse.json({ error: "Cuenta inactiva" }, { status: 403 });
  }

  const driverId = usuario.driverId;
  const tenantId = usuario.tenantId;
  const hoy = fechaLocalEnSantiago(new Date());

  try {
    const cliente = crearClienteServiceRole();

    // Punto único de resolución, compartido con la PWA: antes las dos pantallas
    // tenían esta consulta copiada con su `.limit(1)`, así que un segundo
    // manifiesto vivo escondía paradas en AMBAS y en silencio.
    const m = await obtenerManifiestoVigenteDelConductor(cliente, {
      tenantId,
      driverId,
      fecha: hoy,
    });

    if (!m) {
      return NextResponse.json({ manifiesto: null });
    }

    const manifiestoId = m.id;

    // `orden_ruta` es la secuencia persistida de la parada dentro del manifiesto
    // (etapa 7). Viaja en la MISMA consulta que ya se hacía: no hace falta un
    // viaje extra para saber en qué orden va la ruta.
    const { data: asignaciones } = await cliente
      .from("asignaciones_pedido")
      .select(
        "orden_ruta, pedidos(id, seller_id, tipo_pedido, origen, ml_order_id, ml_shipment_id, estado, estado_ml, subestado_ml, driver_id_asignado, destinatario_nombre, destinatario_direccion, destinatario_comuna, destinatario_telefono, instrucciones_entrega, fecha_compromiso, lat, long, geo_estado)",
      )
      .eq("manifiesto_id", manifiestoId)
      .eq("tenant_id", tenantId)
      .eq("activa", true);

    // pedido.id → orden_ruta. Las paradas sin secuencia (manifiesto sin rutear,
    // o parada que el motor no pudo ubicar) simplemente no entran al mapa.
    const ordenPorPedidoId = new Map<string, number | null>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((asignaciones ?? []) as Record<string, any>[]).forEach((a) => {
      const p = a.pedidos as Record<string, unknown> | null;
      if (!p?.id) return;
      ordenPorPedidoId.set(p.id as string, (a.orden_ruta as number | null) ?? null);
    });

    // Construir lista de pedidos con casts explícitos (igual que page.tsx conductor).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pedidosBase = ((asignaciones ?? []) as Record<string, any>[])
      .map((a) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = a.pedidos as Record<string, any> | null;
        if (!p) return null;
        return {
          id: p.id as string,
          tenantId,
          sellerId: p.seller_id as string,
          tipoPedido: p.tipo_pedido as string,
          origen: p.origen as string,
          mlOrderId: (p.ml_order_id as string | null) ?? null,
          mlShipmentId: (p.ml_shipment_id as string | null) ?? null,
          estado: p.estado as string,
          estadoMl: (p.estado_ml as string | null) ?? null,
          subestadoMl: (p.subestado_ml as string | null) ?? null,
          driverIdAsignado: (p.driver_id_asignado as string | null) ?? null,
          destinatarioNombre: p.destinatario_nombre as string,
          destinatarioDireccion: p.destinatario_direccion as string,
          destinatarioComuna: p.destinatario_comuna as string,
          destinatarioTelefono: (p.destinatario_telefono as string | null) ?? null,
          instruccionesEntrega: (p.instrucciones_entrega as string | null) ?? null,
          fechaCompromiso: (p.fecha_compromiso as string | null) ?? null,
          lat: (p.lat as number | null) ?? null,
          long: (p.long as number | null) ?? null,
          geoEstado: (p.geo_estado as string | null) ?? "pendiente",
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
      // Defensa en profundidad (docs/arquitectura/edicion-y-cancelacion-de-pedidos.md
      // §5 fila 1): la asignación activa la desactiva `cancelarPedido` en el mismo
      // acto de cancelar, así que en el camino normal esto nunca filtra nada. Pero
      // esta ruta filtra SOLO por `asignaciones_pedido.activa = true` y no mira el
      // estado del pedido — si por lo que sea una asignación quedara activa sobre
      // un pedido ya terminal (cancelado/devuelto/entregado*), la parada NO debe
      // seguir viva en la app del conductor.
      .filter((p) => !ESTADOS_TERMINALES.includes(p.estado as EstadoPedido));

    const pedidoIds = pedidosBase.map((p) => p.id);
    const incidenciasMap = new Map<string, { id: string; tipo: string; estado: string }>();

    if (pedidoIds.length > 0) {
      const { data: incidencias } = await cliente
        .from("incidencias")
        .select("id, pedido_id, tipo, estado")
        .in("pedido_id", pedidoIds)
        .eq("tenant_id", tenantId)
        .in("estado", ["abierta", "en_gestion"]);

      (incidencias ?? []).forEach((inc: Record<string, unknown>) => {
        incidenciasMap.set(inc.pedido_id as string, {
          id: inc.id as string,
          tipo: inc.tipo as string,
          estado: inc.estado as string,
        });
      });
    }

    // Cierres operativos del conductor (Flex/same-day) para marcar paradas ya cerradas.
    const cierresMap =
      pedidoIds.length > 0
        ? await listarCierresPorPedidos(cliente, pedidoIds, tenantId)
        : new Map();

    // La secuencia persistida manda; el alfabético queda de respaldo para el
    // manifiesto sin rutear y para las paradas que quedaron sin ubicar.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pedidosOrdenados = ordenarParadasConSecuencia(pedidosBase as any[], ordenPorPedidoId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paradas = pedidosOrdenados.map((pedido: any, idx: number) => {
      const cierre = cierresMap.get(pedido.id as string) ?? null;
      return {
        orden: idx + 1,
        pedido,
        incidenciaAbierta: incidenciasMap.get(pedido.id as string) ?? null,
        cierreConductor: cierre
          ? { resultado: cierre.resultado, motivo: cierre.motivo, cerradoEn: cierre.cerradoEn }
          : null,
      };
    });

    return NextResponse.json({
      manifiesto: {
        id: manifiestoId,
        nombre: m.nombre,
        fechaOperacion: m.fechaOperacion,
        estado: m.estado,
        paradas,
      },
    });
  } catch (err) {
    console.error("[api/conductor/manifiesto]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
