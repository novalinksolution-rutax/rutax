import { type NextRequest, NextResponse } from "next/server";
import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEvidenciaEntrega } from "@/modules/operacion/evidencias-entrega";
import { ErrorValidacion } from "@/modules/identidad/errores";

/**
 * POST /api/conductor/evidencias
 *
 * Registra una evidencia informativa de entrega (Flex o same-day) ya subida al
 * bucket por el cliente. El conductor provee:
 *   - pedidoId, fotoObjectPath (ruta en pod-evidencias)
 *   - evidenciaId  (UUID generado por el cliente — idempotencia offline)
 *   - nota?, geo?  (opcionales)
 *
 * Delega en registrarEvidenciaEntrega (mismo flujo que la PWA).
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

  let body: {
    pedidoId: string;
    fotoObjectPath: string;
    evidenciaId?: string;
    nota?: string;
    geo?: { lat: number; long: number; precisionM?: number };
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (!body.pedidoId || !body.fotoObjectPath) {
    return NextResponse.json({ error: "Falta pedidoId o fotoObjectPath" }, { status: 400 });
  }

  try {
    const cliente = crearClienteServiceRole();
    const evidencia = await registrarEvidenciaEntrega(
      cliente,
      {
        pedidoId: body.pedidoId,
        tenantId: usuario.tenantId,
        fotoObjectPath: body.fotoObjectPath,
        evidenciaId: body.evidenciaId,
        nota: body.nota,
        geo: body.geo,
      },
      usuario,
    );
    return NextResponse.json(evidencia, { status: 201 });
  } catch (err) {
    const mensaje =
      err instanceof ErrorValidacion
        ? err.message
        : err instanceof Error
          ? err.message
          : "Error al registrar evidencia";
    const status = err instanceof ErrorValidacion ? 422 : 500;
    return NextResponse.json({ error: mensaje }, { status });
  }
}
