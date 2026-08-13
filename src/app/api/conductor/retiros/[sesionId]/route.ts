import { type NextRequest, NextResponse } from "next/server";
import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerSesionRetiro } from "@/modules/operacion/retiro/sesiones";

/**
 * GET /api/conductor/retiros/:sesionId
 *
 * Detalle de una visita de retiro (bodega + bultos escaneados + resolución
 * derivada de cada uno). `obtenerSesionRetiro` filtra por tenant Y por
 * conductor de una — un `sesionId` de otro courier o de otro conductor
 * devuelve `null` aquí, y esta ruta lo traduce a 404 (nunca 403): con
 * `service_role` saltando RLS, ese filtro ES el aislamiento.
 */
export async function GET(
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
    const detalle = await obtenerSesionRetiro(cliente, {
      tenantId: usuario.tenantId,
      conductorId: usuario.driverId,
      sesionId,
    });

    if (!detalle) {
      return NextResponse.json({ error: "Visita de retiro no encontrada" }, { status: 404 });
    }
    return NextResponse.json({ sesion: detalle });
  } catch (err) {
    console.error("[api/conductor/retiros/:sesionId]", err instanceof Error ? err.message : "error desconocido");
    return NextResponse.json({ error: "Error al obtener la visita de retiro" }, { status: 500 });
  }
}
