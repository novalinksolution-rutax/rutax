import { type NextRequest, NextResponse } from "next/server";
import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { abrirVisitaBodega } from "@/modules/operacion/retiro/bodegas";
import { ErrorNoEncontrado } from "@/modules/identidad/errores";

/**
 * POST /api/conductor/retiros
 *
 * Abre (o reutiliza, si ya existía la de hoy) la visita del conductor a una
 * bodega. Devuelve la dirección y el contacto SOLO de esa bodega — el
 * catálogo (`GET /api/conductor/retiros/bodegas`) no los trae.
 *
 * Body JSON: { bodegaId: string }
 */
export async function POST(request: NextRequest) {
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

  let body: { bodegaId?: string };
  try {
    body = (await request.json()) as { bodegaId?: string };
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (!body.bodegaId) {
    return NextResponse.json({ error: "Falta bodegaId" }, { status: 400 });
  }

  try {
    const cliente = crearClienteServiceRole();
    const resultado = await abrirVisitaBodega(cliente, {
      tenantId: usuario.tenantId,
      conductorId: usuario.driverId,
      bodegaId: body.bodegaId,
    });
    return NextResponse.json(resultado, { status: resultado.reutilizada ? 200 : 201 });
  } catch (err) {
    if (err instanceof ErrorNoEncontrado) {
      // bodegaId de otro tenant, inexistente o inactiva — mismo 404 que el
      // resto de las rutas del conductor ante un id que no es suyo.
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error("[api/conductor/retiros]", err instanceof Error ? err.message : "error desconocido");
    return NextResponse.json({ error: "Error al abrir la visita de retiro" }, { status: 500 });
  }
}
