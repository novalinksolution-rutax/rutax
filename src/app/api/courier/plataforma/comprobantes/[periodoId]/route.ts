/**
 * GET /api/courier/plataforma/comprobantes/:periodoId — descarga el
 * comprobante de pago (NO tributario) de un período de la suscripción del
 * propio courier a Rutax.
 *
 * Flujo:
 * 1. Requiere sesión activa (401 si no hay).
 * 2. Requiere la capacidad `gestionar_suscripcion` (`puedeGestionarSuscripcion`
 *    — solo dueño, mismo gate que la pantalla "Mi plan"). 403 si no la tiene.
 * 3. Resuelve el comprobante vía `obtenerComprobantePago` (la única puerta al
 *    backstage `plataforma` desde el courier) — SIEMPRE filtrado por el
 *    `tenantId` del claim, nunca por un tenant que mande el cliente.
 * 4. `null` → 404 (el período no existe, no es de este tenant, o no tiene un
 *    pago `confirmado` — el comprobante solo existe para pagos confirmados).
 * 5. Éxito → genera el PDF al vuelo (no se persiste en Storage) y responde
 *    inline con `Content-Disposition: attachment`.
 *
 * Convención `api/courier/*` (CLAUDE.md): mismo gating RBAC que la pantalla
 * equivalente (`configuracion/plan`).
 */

import { NextResponse } from "next/server";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarSuscripcion } from "@/modules/identidad/capacidades";
import { obtenerComprobantePago } from "@/modules/plataforma/superficie-courier";
import { generarPdfComprobantePago } from "@/modules/plataforma/comprobante-pago-pdf";

interface Params {
  params: Promise<{ periodoId: string }>;
}

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const sesion = await obtenerSesionActual();
  if (!sesion) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }
  if (!sesion.usuario.tenantId) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }
  if (!puedeGestionarSuscripcion(sesion.usuario)) {
    return NextResponse.json(
      { error: "No tienes permiso para descargar comprobantes de la suscripción." },
      { status: 403 },
    );
  }

  const { periodoId } = await params;
  const tenantId = sesion.usuario.tenantId;

  try {
    const comprobante = await obtenerComprobantePago({ tenantId, periodoId });
    if (!comprobante) {
      return NextResponse.json(
        { error: "No encontramos un pago confirmado para este período." },
        { status: 404 },
      );
    }

    const buffer = await generarPdfComprobantePago(comprobante);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="comprobante-pago-${periodoId.slice(0, 8)}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Error al generar comprobante de pago de suscripción:", error);
    return NextResponse.json(
      { error: "No se pudo generar el comprobante. Intenta nuevamente más tarde." },
      { status: 502 },
    );
  }
}
