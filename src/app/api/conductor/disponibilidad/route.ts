import { type NextRequest, NextResponse } from "next/server";

import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  leerDisponibilidad,
  marcarmeDisponible,
} from "@/modules/operacion/disponibilidad-conductor";

/**
 * «Marcarme disponible» — superficie para la app nativa.
 * =============================================================================
 * `GET | PUT /api/conductor/disponibilidad`
 *
 * ## De quién es este campo, desde hoy
 *
 * `conductores.disponible` decía quién trabaja hoy y **solo el coordinador podía
 * tocarlo**: la asistencia se definía por WhatsApp y alguien la transcribía. El
 * campo describía la creencia del coordinador, no un hecho.
 *
 * Por decisión del usuario (24-08-2026) pasa a ser **solo del conductor**, y esta
 * ruta es su única superficie. La acción del coordinador se retiró.
 *
 * ## El conductor sale del JWT, nunca del cuerpo
 *
 * `usuario.driverId` y `usuario.tenantId` vienen del token verificado. **No hay
 * forma de nombrar a otro conductor** en esta ruta, y no debe agregarse: si
 * apareciera un `conductorId` en el body, un conductor podría marcarle la
 * asistencia a otro — que es exactamente el control que se acaba de quitar del
 * lado del coordinador, reintroducido por la puerta de atrás.
 */
export async function GET(request: NextRequest) {
  const usuario = await autenticarBearer(request.headers.get("authorization"));
  if (!usuario || usuario.tipoUsuario !== "conductor" || !usuario.driverId || !usuario.tenantId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (usuario.estado !== "activo") {
    return NextResponse.json({ error: "Cuenta inactiva" }, { status: 403 });
  }

  try {
    const cliente = crearClienteServiceRole();
    const estado = await leerDisponibilidad(cliente, {
      tenantId: usuario.tenantId,
      conductorId: usuario.driverId,
    });
    if (!estado) {
      return NextResponse.json({ error: "Conductor no encontrado" }, { status: 404 });
    }
    return NextResponse.json(estado);
  } catch (err) {
    console.error(
      "[api/conductor/disponibilidad GET]",
      err instanceof Error ? err.message : "error desconocido",
    );
    return NextResponse.json({ error: "Error al leer tu disponibilidad" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const usuario = await autenticarBearer(request.headers.get("authorization"));
  if (!usuario || usuario.tipoUsuario !== "conductor" || !usuario.driverId || !usuario.tenantId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (usuario.estado !== "activo") {
    return NextResponse.json({ error: "Cuenta inactiva" }, { status: 403 });
  }

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const disponible = (cuerpo as { disponible?: unknown })?.disponible;
  if (typeof disponible !== "boolean") {
    return NextResponse.json({ error: "«disponible» tiene que ser true o false" }, { status: 400 });
  }

  try {
    const cliente = crearClienteServiceRole();
    const estado = await marcarmeDisponible(cliente, {
      tenantId: usuario.tenantId,
      conductorId: usuario.driverId,
      usuarioId: usuario.usuarioId,
      disponible,
    });
    return NextResponse.json(estado);
  } catch (err) {
    console.error(
      "[api/conductor/disponibilidad PUT]",
      err instanceof Error ? err.message : "error desconocido",
    );
    return NextResponse.json({ error: "Error al guardar tu disponibilidad" }, { status: 500 });
  }
}
