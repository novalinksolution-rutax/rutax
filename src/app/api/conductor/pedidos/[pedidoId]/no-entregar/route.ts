import { type NextRequest, NextResponse } from "next/server";
import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarPruebaEntrega } from "@/modules/operacion/pruebas-entrega";
import { registrarCierreConductor } from "@/modules/operacion/cierre-conductor";
import { actualizarEstadoPedido } from "@/modules/operacion/pedidos";
import { ErrorValidacion } from "@/modules/identidad/errores";
import type { TipoIncidencia } from "@/modules/operacion/tipos";

/**
 * POST /api/conductor/pedidos/[pedidoId]/no-entregar
 *
 * Registra un fallo de entrega. El comportamiento depende del tipo de pedido:
 *
 *   - same_day: POD AUTORITATIVO que CAMBIA el estado del pedido a 'fallido'.
 *   - flex: CIERRE OPERATIVO (registro propio del courier) que NO cambia el estado.
 *     El estado oficial del Flex lo gobierna la app de Mercado Envíos Flex. Foto opcional.
 *
 * Body JSON: { tipoIncidencia, fotoObjectPath?, lat?, long?, precisionM? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pedidoId: string }> },
) {
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

  const { pedidoId } = await params;

  let body: {
    tipoIncidencia: TipoIncidencia;
    fotoObjectPath?: string;
    lat?: number;
    long?: number;
    precisionM?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (!body.tipoIncidencia) {
    return NextResponse.json({ error: "Falta el tipo de incidencia" }, { status: 400 });
  }

  const geo =
    body.lat !== undefined && body.long !== undefined
      ? { lat: body.lat, long: body.long, precisionM: body.precisionM }
      : undefined;

  try {
    const cliente = crearClienteServiceRole();

    const { data: pedido } = await cliente
      .from("pedidos")
      .select("tipo_pedido")
      .eq("id", pedidoId)
      .eq("tenant_id", usuario.tenantId)
      .maybeSingle();

    if (!pedido) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
    }

    // --- Flex: cierre operativo (no cambia el estado) -----------------------
    if (pedido.tipo_pedido === "flex") {
      await registrarCierreConductor(
        cliente,
        {
          pedidoId,
          tenantId: usuario.tenantId,
          resultado: "no_entregado",
          motivo: body.tipoIncidencia,
          fotoObjectPath: body.fotoObjectPath,
          geo,
        },
        usuario,
      );
      return NextResponse.json({ exito: true });
    }

    // --- same-day: POD autoritativo (cambia el estado) ----------------------
    await registrarPruebaEntrega(
      cliente,
      {
        pedidoId,
        tenantId: usuario.tenantId,
        tipoResultado: "fallido",
        tipoIncidencia: body.tipoIncidencia,
        fotoObjectPath: body.fotoObjectPath,
        geo,
      },
      usuario,
    );

    await actualizarEstadoPedido(
      cliente,
      {
        pedidoId,
        tenantId: usuario.tenantId,
        estadoNuevo: "fallido",
        estadoEsperado: "en_ruta",
        ejecutor: "conductor",
        tipoIncidenciaConductor: body.tipoIncidencia,
        actuadoPorUsuarioId: usuario.usuarioId,
      },
      usuario,
    );

    return NextResponse.json({ exito: true });
  } catch (err) {
    const mensaje =
      err instanceof ErrorValidacion
        ? err.message
        : err instanceof Error
          ? err.message
          : "Error al registrar el no entregado";
    const status = err instanceof ErrorValidacion ? 422 : 500;
    return NextResponse.json({ error: mensaje }, { status });
  }
}
