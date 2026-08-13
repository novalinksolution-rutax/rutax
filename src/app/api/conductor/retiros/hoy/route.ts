import { type NextRequest, NextResponse } from "next/server";
import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { listarSesionesDeHoyDelConductor } from "@/modules/operacion/retiro/sesiones";

/**
 * GET /api/conductor/retiros/hoy
 *
 * Las visitas de retiro de HOY del conductor autenticado (día operativo,
 * fecha local de Santiago). Alimenta la tarjeta "carga del día" de la app.
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

  try {
    const cliente = crearClienteServiceRole();
    const sesiones = await listarSesionesDeHoyDelConductor(cliente, {
      tenantId: usuario.tenantId,
      conductorId: usuario.driverId,
    });
    return NextResponse.json({ sesiones });
  } catch (err) {
    console.error("[api/conductor/retiros/hoy]", err instanceof Error ? err.message : "error desconocido");
    return NextResponse.json({ error: "Error al listar las visitas de hoy" }, { status: 500 });
  }
}
