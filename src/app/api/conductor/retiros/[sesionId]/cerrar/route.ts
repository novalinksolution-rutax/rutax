import { type NextRequest, NextResponse } from "next/server";
import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { cerrarSesionRetiro } from "@/modules/operacion/retiro/sesiones";

/**
 * POST /api/conductor/retiros/:sesionId/cerrar
 *
 * Cierra la visita: congela el acta (bultos_total/resueltos/sin_resolver) y
 * marca `retirado` los pedidos de los bultos escaneados — vía la única
 * función que escribe eso (`operacion.cerrar_sesion_retiro`, SECURITY
 * DEFINER). Idempotente: si ya estaba cerrada, devuelve el acta congelada tal
 * cual, sin error.
 *
 * Bitácora ANTES del efecto (`cerrarSesionRetiro`, `sesiones.ts`), con
 * `actorUsuarioId` = el id de AUTH.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sesionId: string }> },
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

  const { sesionId } = await params;

  try {
    const cliente = crearClienteServiceRole();

    // Canario de aislamiento: única consulta antes de escribir bitácora o
    // llamar al RPC. Un sesionId de otro tenant o de otro conductor -> 404.
    const { data: sesion } = await cliente
      .from("sesiones_retiro")
      .select("id")
      .eq("id", sesionId)
      .eq("tenant_id", usuario.tenantId)
      .eq("conductor_id", usuario.driverId)
      .maybeSingle();

    if (!sesion) {
      return NextResponse.json({ error: "Visita de retiro no encontrada" }, { status: 404 });
    }

    const resultado = await cerrarSesionRetiro(cliente, {
      tenantId: usuario.tenantId,
      sesionId: sesion.id as string,
      conductorId: usuario.driverId,
      actorUsuarioId: usuario.usuarioId,
    });

    return NextResponse.json(resultado);
  } catch (err) {
    console.error(
      "[api/conductor/retiros/:sesionId/cerrar]",
      err instanceof Error ? err.message : "error desconocido",
    );
    return NextResponse.json({ error: "Error al cerrar la visita de retiro" }, { status: 500 });
  }
}
