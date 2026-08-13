import { type NextRequest, NextResponse } from "next/server";
import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { listarBodegasParaConductor } from "@/modules/operacion/retiro/bodegas";

/**
 * GET /api/conductor/retiros/bodegas
 *
 * Catálogo de bodegas ACTIVAS del tenant para que el conductor elija a dónde
 * va a retirar. SIN dirección ni contacto (docs/arquitectura/
 * retiro-y-ruteo.md §1.5/§13bis-1.1): esos datos solo se entregan de la
 * bodega que efectivamente se abre (`POST /api/conductor/retiros`).
 *
 * El conductor no tiene acceso propio a `identidad.seller_bodegas` (RLS P1
 * tenant + P2 seller — no es ninguno de los dos, ve CERO filas por diseño).
 * Por eso esta ruta corre con `service_role` y devuelve el DTO mínimo.
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
    const bodegas = await listarBodegasParaConductor(cliente, usuario.tenantId);
    return NextResponse.json({ bodegas });
  } catch (err) {
    console.error("[api/conductor/retiros/bodegas]", err instanceof Error ? err.message : "error desconocido");
    return NextResponse.json({ error: "Error al listar bodegas" }, { status: 500 });
  }
}
