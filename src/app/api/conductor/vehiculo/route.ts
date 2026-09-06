import { type NextRequest, NextResponse } from "next/server";

import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  fijarVehiculoConductor,
  leerVehiculoConductor,
} from "@/modules/identidad/vehiculo-conductor";

/**
 * «Mi vehículo» — superficie para la app nativa.
 * =============================================================================
 * `GET | PUT /api/conductor/vehiculo`
 *
 * El vehículo (auto/moto) dejó de ser solo del coordinador (2026-09-05): ahora
 * el conductor lo elige en sus ajustes, porque el motor de ruta traza y estima
 * el tiempo según él (moto → `TWO_WHEELER`). El coordinador lo sigue viendo en
 * la nómina; última escritura gana. Ver `identidad/vehiculo-conductor.ts`.
 *
 * ## El conductor sale del JWT, nunca del cuerpo
 *
 * `usuario.driverId` y `usuario.tenantId` vienen del token verificado. **No hay
 * forma de nombrar a otro conductor acá**, y no debe agregarse: este dato ahora
 * gobierna cómo se traza la ruta de esa persona.
 */

function noAutorizado() {
  return NextResponse.json({ error: "No autorizado" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const usuario = await autenticarBearer(request.headers.get("authorization"));
  if (!usuario || usuario.tipoUsuario !== "conductor" || !usuario.driverId || !usuario.tenantId) {
    return noAutorizado();
  }
  if (usuario.estado !== "activo") {
    return NextResponse.json({ error: "Cuenta inactiva" }, { status: 403 });
  }

  try {
    const cliente = crearClienteServiceRole();
    const estado = await leerVehiculoConductor(cliente, {
      tenantId: usuario.tenantId,
      conductorId: usuario.driverId,
    });
    if (!estado) {
      return NextResponse.json({ error: "Conductor no encontrado" }, { status: 404 });
    }
    return NextResponse.json(estado);
  } catch (err) {
    console.error(
      "[api/conductor/vehiculo GET]",
      err instanceof Error ? err.message : "error desconocido",
    );
    return NextResponse.json({ error: "Error al leer tu vehículo" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const usuario = await autenticarBearer(request.headers.get("authorization"));
  if (!usuario || usuario.tipoUsuario !== "conductor" || !usuario.driverId || !usuario.tenantId) {
    return noAutorizado();
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

  const vehiculo = (cuerpo as { vehiculo?: unknown })?.vehiculo;
  if (vehiculo !== "moto" && vehiculo !== "auto") {
    return NextResponse.json({ error: "«vehiculo» tiene que ser «moto» o «auto»" }, { status: 400 });
  }

  try {
    const cliente = crearClienteServiceRole();
    const estado = await fijarVehiculoConductor(cliente, {
      tenantId: usuario.tenantId,
      conductorId: usuario.driverId,
      usuarioId: usuario.usuarioId,
      vehiculo,
    });
    return NextResponse.json(estado);
  } catch (err) {
    console.error(
      "[api/conductor/vehiculo PUT]",
      err instanceof Error ? err.message : "error desconocido",
    );
    return NextResponse.json({ error: "Error al guardar tu vehículo" }, { status: 500 });
  }
}
