import { type NextRequest, NextResponse } from "next/server";
import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { completarManifiesto } from "@/modules/operacion/manifiestos";
import { ErrorConflicto } from "@/modules/identidad/errores";

/**
 * POST /api/conductor/manifiesto/completar
 *
 * El conductor termina su ruta del día desde la app Expo: pasa su manifiesto
 * 'en_ruta' → 'completado'. Espejo de la Server Action `actionConductorTerminarRuta`.
 *
 * ALTO-1 (Ley 21.431): `completarManifiesto` borra la ubicación GPS del conductor
 * como efecto de minimización de datos. Garantizar el cierre desde la app nativa
 * asegura que el GPS se purgue aunque el conductor solo use el teléfono.
 *
 * Body JSON: { manifiestoId: string }
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

  let body: { manifiestoId?: string };
  try {
    body = (await request.json()) as { manifiestoId?: string };
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (!body.manifiestoId) {
    return NextResponse.json({ error: "Falta el ID del manifiesto" }, { status: 400 });
  }

  try {
    const cliente = crearClienteServiceRole();
    await completarManifiesto(
      cliente,
      body.manifiestoId,
      usuario.tenantId,
      usuario.driverId,
      usuario,
      usuario.usuarioId,
    );
    return NextResponse.json({ exito: true });
  } catch (err) {
    if (err instanceof ErrorConflicto) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[api/conductor/manifiesto/completar]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Error al completar la ruta" }, { status: 500 });
  }
}
