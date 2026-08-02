import { type NextRequest, NextResponse } from "next/server";
import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerUrlFirmadaEvidencia } from "@/modules/operacion/evidencias-entrega";

interface Props {
  params: Promise<{ evidenciaId: string }>;
}

/**
 * GET /api/conductor/evidencias/:evidenciaId/url
 *
 * Devuelve una URL firmada (15 min) para que el conductor vea la foto de una
 * evidencia que él mismo capturó. El acceso se verifica en
 * obtenerUrlFirmadaEvidencia: el conductor solo accede a sus propias evidencias.
 */
export async function GET(request: NextRequest, { params }: Props) {
  const usuario = await autenticarBearer(request.headers.get("authorization"));
  if (
    !usuario ||
    usuario.tipoUsuario !== "conductor" ||
    !usuario.driverId ||
    !usuario.tenantId
  ) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { evidenciaId } = await params;

  try {
    const cliente = crearClienteServiceRole();
    const url = await obtenerUrlFirmadaEvidencia(cliente, evidenciaId, usuario);
    return NextResponse.json({ url });
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "Error al obtener URL";
    return NextResponse.json({ error: mensaje }, { status: 403 });
  }
}
