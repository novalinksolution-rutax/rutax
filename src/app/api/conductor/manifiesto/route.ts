import { type NextRequest, NextResponse } from "next/server";
import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { ordenarParadasConSecuencia } from "@/modules/operacion/orden-paradas";
import { listarCierresPorPedidos } from "@/modules/operacion/cierre-conductor";
import { obtenerManifiestoVigenteDelConductor } from "@/modules/operacion/manifiesto-vigente";
import { obtenerOrigenRutaDelCourier } from "@/modules/operacion/ruta-manifiesto";
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
        "orden_ruta, orden_fijado, tramo_polilinea, tramo_distancia_m, tramo_duracion_s, pedidos(id, seller_id, tipo_pedido, fuente, origen, ml_order_id, ml_shipment_id, codigo_interno, id_externo, referencia_externa, estado, estado_ml, subestado_ml, driver_id_asignado, destinatario_nombre, destinatario_direccion, destinatario_comuna, destinatario_telefono, instrucciones_entrega, fecha_compromiso, lat, long, geo_estado)",
      )
      .eq("manifiesto_id", manifiestoId)
      .eq("tenant_id", tenantId)
      .eq("activa", true);

    // pedido.id → orden_ruta. Las paradas sin secuencia (manifiesto sin rutear,
    // o parada que el motor no pudo ubicar) simplemente no entran al mapa.
    const ordenPorPedidoId = new Map<string, number | null>();
    /**
     * Lo que el mapa necesita además del orden: si la parada está fijada por el
     * conductor y la geometría del tramo que LLEGA a ella.
     *
     * ⚠️ La polilínea se sirve tal cual la guardó el cálculo. **Nunca contiene
     * el tramo hacia el punto de término del conductor** — lo descarta el
     * adaptador antes de persistirse (canal 3 de
     * `docs/seguridad/punto-de-termino-conductor.md`).
     */
    const rutaPorPedidoId = new Map<
      string,
      {
        fijado: boolean;
        polilinea: string | null;
        distanciaM: number | null;
        duracionS: number | null;
      }
    >();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((asignaciones ?? []) as Record<string, any>[]).forEach((a) => {
      const p = a.pedidos as Record<string, unknown> | null;
      if (!p?.id) return;
      const pedidoId = p.id as string;
      ordenPorPedidoId.set(pedidoId, (a.orden_ruta as number | null) ?? null);
      rutaPorPedidoId.set(pedidoId, {
        fijado: a.orden_fijado === true,
        polilinea: (a.tramo_polilinea as string | null) ?? null,
        distanciaM: (a.tramo_distancia_m as number | null) ?? null,
        duracionS: (a.tramo_duracion_s as number | null) ?? null,
      });
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
          // Procedencia. Se AGREGA sin quitar `tipoPedido`: la app nativa del
          // repo `rutax-conductor` todavía decide por ese campo, y el contrato
          // no puede romperse desde este lado — la app se despliega por EAS y
          // tienda, no en minutos como el backend.
          fuente: p.fuente as string,
          origen: p.origen as string,
          mlOrderId: (p.ml_order_id as string | null) ?? null,
          mlShipmentId: (p.ml_shipment_id as string | null) ?? null,
          codigoInterno: (p.codigo_interno as string | null) ?? null,
          idExterno: (p.id_externo as string | null) ?? null,
          referenciaExterna: (p.referencia_externa as string | null) ?? null,
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
    // Cuántos BULTOS trae cada parada.
    //
    // ⚠️ No existe `pedidos.bultos`: un pedido no declara su cantidad de bultos
    // en ninguna columna. Lo que sí existe es lo que se ESCANEÓ al retirarlo,
    // que además es el dato honesto — le dice al conductor cuántos paquetes va
    // a bajar de la van, no cuántos dijo el seller que había.
    //
    // Un pedido sin bultos escaneados (retiro registrado a mano, o el bulto que
    // no se resolvió) devuelve `null`, no `0`: «no lo sabemos» y «no trae
    // ninguno» son cosas distintas, y un 0 en la ficha sería una afirmación
    // falsa.
    const bultosPorPedido = new Map<string, number>();
    if (pedidoIds.length > 0) {
      const { data: bultos } = await cliente
        .from("bultos_retiro")
        .select("pedido_id")
        .eq("tenant_id", tenantId)
        .in("pedido_id", pedidoIds);

      (bultos ?? []).forEach((b: Record<string, unknown>) => {
        const id = b.pedido_id as string | null;
        if (!id) return;
        bultosPorPedido.set(id, (bultosPorPedido.get(id) ?? 0) + 1);
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pedidosOrdenados = ordenarParadasConSecuencia(pedidosBase as any[], ordenPorPedidoId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paradas = pedidosOrdenados.map((pedido: any, idx: number) => {
      const pedidoId = pedido.id as string;
      const cierre = cierresMap.get(pedidoId) ?? null;
      const ruta = rutaPorPedidoId.get(pedidoId) ?? null;
      return {
        orden: idx + 1,
        pedido: {
          ...pedido,
          // El identificador que va en el PIN del mapa. Misma regla que la Torre
          // de control: `ml_shipment_id` en Flex, `codigo_interno` en el resto,
          // y NUNCA `tracking_token` — ese es público y viaja en la URL que se
          // le comparte al destinatario.
          codigoEnvio: (pedido.mlShipmentId as string | null) ?? (pedido.codigoInterno as string | null) ?? null,
          bultos: bultosPorPedido.get(pedidoId) ?? null,
        },
        incidenciaAbierta: incidenciasMap.get(pedidoId) ?? null,
        cierreConductor: cierre
          ? { resultado: cierre.resultado, motivo: cierre.motivo, cerradoEn: cierre.cerradoEn }
          : null,
        /** El conductor fijó esta parada a mano: el motor no la mueve. */
        fijada: ruta?.fijado === true,
        /**
         * Geometría del tramo que LLEGA a esta parada, por calle. `null` cuando
         * la ruta la calculó el motor local (líneas rectas, sin trazado).
         */
        tramo:
          ruta && ruta.polilinea !== null
            ? {
                polilinea: ruta.polilinea,
                distanciaM: ruta.distanciaM,
                duracionS: ruta.duracionS,
              }
            : null,
      };
    });

    // De dónde sale la ruta: la bodega del courier.
    //
    // ⚠️ **No es dato personal de nadie** —es el galpón desde el que opera la
    // empresa— así que viaja sin reparos, a diferencia del punto de término del
    // conductor, que NO sale nunca por acá.
    //
    // Best-effort: si el courier no configuró bodega, el mapa dibuja el circuito
    // sin punto de partida en vez de fallar. Una ruta sin marca de salida se
    // entiende igual; una pantalla en blanco a las 16:00, no.
    let origen: { nombre: string; lat: number; long: number } | null = null;
    try {
      const bodega = await obtenerOrigenRutaDelCourier(cliente, tenantId);
      if (bodega) {
        origen = { nombre: bodega.nombre, lat: bodega.lat, long: bodega.long };
      }
    } catch (e) {
      console.error(
        "[api/conductor/manifiesto] no se pudo leer la bodega de origen:",
        e instanceof Error ? e.message : "error desconocido",
      );
    }

    return NextResponse.json({
      manifiesto: {
        id: manifiestoId,
        nombre: m.nombre,
        fechaOperacion: m.fechaOperacion,
        estado: m.estado,
        origen,
        paradas,
      },
    });
  } catch (err) {
    console.error("[api/conductor/manifiesto]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
