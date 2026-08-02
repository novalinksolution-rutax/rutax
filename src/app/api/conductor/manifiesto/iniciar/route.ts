import { type NextRequest, NextResponse } from "next/server";
import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeConfirmarManifiestoPropio } from "@/modules/identidad/capacidades";
import { transicionarPedidosSameDayAEnRuta } from "@/modules/operacion/manifiestos-same-day";

/**
 * POST /api/conductor/manifiesto/iniciar
 *
 * El conductor inicia su ruta del día desde la app Expo: pasa su manifiesto
 * 'confirmado' → 'en_ruta'. Espejo de la Server Action `actionConductorListoParaSalir`
 * de la PWA (src/app/conductor/manifiesto/actions.ts).
 *
 * Efecto same-day (Bloque 2): transiciona en lote los pedidos same-day del
 * manifiesto que estén en 'asignado' → 'en_ruta'. Los pedidos Flex NO se tocan
 * (sus estados vienen de ML — app de Mercado Envíos Flex obligatoria, CLAUDE.md).
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
  if (!puedeConfirmarManifiestoPropio(usuario)) {
    return NextResponse.json({ error: "No tienes permiso para iniciar la ruta" }, { status: 403 });
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

  const tenantId = usuario.tenantId;
  const driverId = usuario.driverId;

  try {
    const cliente = crearClienteServiceRole();

    // El manifiesto debe pertenecer al conductor y estar 'confirmado'.
    const { data: manifiesto } = await cliente
      .from("manifiestos")
      .select("estado, driver_id")
      .eq("id", body.manifiestoId)
      .eq("tenant_id", tenantId)
      .eq("driver_id", driverId)
      .maybeSingle();

    if (!manifiesto) {
      return NextResponse.json({ error: "Manifiesto no encontrado" }, { status: 404 });
    }
    if (manifiesto.estado !== "confirmado") {
      return NextResponse.json(
        { error: "El manifiesto no está listo para iniciar (debe estar confirmado)." },
        { status: 409 },
      );
    }

    const { error } = await cliente
      .from("manifiestos")
      .update({ estado: "en_ruta" })
      .eq("id", body.manifiestoId)
      .eq("tenant_id", tenantId);

    if (error) throw error;

    // Efecto same-day: asignado → en_ruta (idempotente). Flex no se toca.
    await transicionarPedidosSameDayAEnRuta(
      cliente,
      body.manifiestoId,
      tenantId,
      driverId,
      usuario,
    );

    return NextResponse.json({ exito: true });
  } catch (err) {
    console.error("[api/conductor/manifiesto/iniciar]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Error al iniciar la ruta" }, { status: 500 });
  }
}
