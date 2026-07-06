import { type NextRequest, NextResponse } from "next/server";
import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";

/**
 * POST /api/conductor/evidencias/upload-url
 *
 * Genera una URL firmada de subida (signedUploadUrl) para que la app Expo del
 * conductor pueda subir una foto directamente al bucket privado `pod-evidencias`
 * sin exponer la service_role key al cliente móvil.
 *
 * El path resultante sigue la convención:
 *   {tenantId}/{pedidoId}/evidencias/{evidenciaId}.jpg
 *
 * El cliente usa el upload URL para un PUT de la foto, y luego llama a
 * POST /api/conductor/evidencias con el objectPath devuelto aquí.
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

  let body: { pedidoId: string; evidenciaId: string };
  try {
    body = (await request.json()) as { pedidoId: string; evidenciaId: string };
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { pedidoId, evidenciaId } = body;
  if (!pedidoId || !evidenciaId) {
    return NextResponse.json({ error: "Falta pedidoId o evidenciaId" }, { status: 400 });
  }

  const objectPath = `${usuario.tenantId}/${pedidoId}/evidencias/${evidenciaId}.jpg`;

  try {
    const cliente = crearClienteServiceRole();
    const { data, error } = await cliente.storage
      .from("pod-evidencias")
      .createSignedUploadUrl(objectPath);

    if (error || !data) {
      return NextResponse.json({ error: "No se pudo crear URL de subida" }, { status: 500 });
    }

    return NextResponse.json({
      uploadUrl: data.signedUrl,
      objectPath,
      token: data.token,
    });
  } catch (err) {
    console.error(
      "[api/conductor/evidencias/upload-url]",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
