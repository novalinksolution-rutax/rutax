import { type NextRequest, NextResponse } from "next/server";
import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarPruebaEntrega } from "@/modules/operacion/pruebas-entrega";
import { registrarCierreConductor } from "@/modules/operacion/cierre-conductor";
import { actualizarEstadoPedido } from "@/modules/operacion/pedidos";
import { ErrorValidacion } from "@/modules/identidad/errores";

/**
 * POST /api/conductor/pedidos/[pedidoId]/entregar
 *
 * Registra la entrega exitosa de un pedido desde la app Expo. El comportamiento
 * depende del tipo de pedido:
 *
 *   - same_day: POD AUTORITATIVO (registrarPruebaEntrega) que CAMBIA el estado del
 *     pedido a 'entregado' si la geocerca valida.
 *   - flex: CIERRE OPERATIVO (registrarCierreConductor) — registro propio del courier
 *     que NO cambia el estado. El estado oficial del Flex lo sigue gobernando la app
 *     de Mercado Envíos Flex (obligatoria, no integrable — CLAUDE.md). Foto opcional.
 *
 * Body JSON: { fotoObjectPath?, lat?, long?, precisionM? }
 * Responde:  { exito, esValido, avisoPendienteRevision? }
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

  let body: { fotoObjectPath?: string; lat?: number; long?: number; precisionM?: number } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // body vacío es válido (sin foto ni geo)
  }

  const geo =
    body.lat !== undefined && body.long !== undefined
      ? { lat: body.lat, long: body.long, precisionM: body.precisionM }
      : undefined;

  try {
    const cliente = crearClienteServiceRole();

    // Determinar el tipo para enrutar POD autoritativo vs cierre operativo.
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
      const cierre = await registrarCierreConductor(
        cliente,
        { pedidoId, tenantId: usuario.tenantId, resultado: "entregado", fotoObjectPath: body.fotoObjectPath, geo },
        usuario,
      );
      return NextResponse.json({
        exito: true,
        esValido: true,
        avisoPendienteRevision: cierre.geocercaResultado === "fuera",
      });
    }

    // --- same-day: POD autoritativo (cambia el estado) ----------------------
    const pod = await registrarPruebaEntrega(
      cliente,
      { pedidoId, tenantId: usuario.tenantId, tipoResultado: "entregado", fotoObjectPath: body.fotoObjectPath, geo },
      usuario,
    );

    if (pod.esValido) {
      await actualizarEstadoPedido(
        cliente,
        {
          pedidoId,
          tenantId: usuario.tenantId,
          estadoNuevo: "entregado",
          estadoEsperado: "en_ruta",
          ejecutor: "conductor",
          actuadoPorUsuarioId: usuario.usuarioId,
        },
        usuario,
      );
    }

    return NextResponse.json({
      exito: true,
      esValido: pod.esValido,
      avisoPendienteRevision: !pod.esValido,
    });
  } catch (err) {
    const mensaje =
      err instanceof ErrorValidacion
        ? err.message
        : err instanceof Error
          ? err.message
          : "Error al registrar la entrega";
    const status = err instanceof ErrorValidacion ? 422 : 500;
    return NextResponse.json({ error: mensaje }, { status });
  }
}
