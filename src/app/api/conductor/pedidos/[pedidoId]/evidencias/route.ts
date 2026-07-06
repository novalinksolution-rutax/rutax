import { type NextRequest, NextResponse } from "next/server";
import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { listarEvidenciasPorPedido } from "@/modules/operacion/evidencias-entrega";

/**
 * GET /api/conductor/pedidos/[pedidoId]/evidencias
 *
 * Devuelve las evidencias informativas que ESTE conductor capturó para el pedido.
 * Sirve para que la app nativa muestre un registro real de lo ya guardado
 * (cuántas fotos, cuándo, con miniatura), en vez de un indicador optimista.
 *
 * El conductor solo ve sus propias evidencias (filtro conductor_id === driverId).
 * Las miniaturas se entregan como URLs firmadas de 15 min (bucket privado).
 */
export async function GET(
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

  try {
    const cliente = crearClienteServiceRole();

    const todas = await listarEvidenciasPorPedido(cliente, pedidoId, usuario.tenantId);
    // El conductor solo ve las evidencias que él mismo capturó.
    const propias = todas.filter((e) => e.conductorId === usuario.driverId);

    // Miniaturas firmadas en lote (bucket privado, 15 min).
    const paths = propias.map((e) => e.fotoObjectPath);
    const urlPorPath = new Map<string, string>();
    if (paths.length > 0) {
      const { data: firmadas } = await cliente.storage
        .from("pod-evidencias")
        .createSignedUrls(paths, 900);
      (firmadas ?? []).forEach((f) => {
        if (f.signedUrl && f.path) urlPorPath.set(f.path, f.signedUrl);
      });
    }

    const evidencias = propias.map((e) => ({
      id: e.id,
      capturadoEn: e.capturadoEn,
      nota: e.nota,
      geocercaResultado: e.geocercaResultado,
      fotoUrl: urlPorPath.get(e.fotoObjectPath) ?? null,
    }));

    return NextResponse.json({ total: evidencias.length, evidencias });
  } catch (err) {
    console.error(
      "[api/conductor/pedidos/[pedidoId]/evidencias]",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: "Error al listar evidencias" }, { status: 500 });
  }
}
