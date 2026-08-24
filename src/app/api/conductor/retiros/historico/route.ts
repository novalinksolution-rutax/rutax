import { type NextRequest, NextResponse } from "next/server";

import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { listarHistoricoDeRetiros } from "@/modules/operacion/retiro/sesiones";
import { hoyEnSantiago } from "@/lib/fecha-santiago";

/**
 * `GET /api/conductor/retiros/historico?mes=YYYY-MM`
 *
 * Las actas CERRADAS del conductor, por mes. Es distinto de `/hoy`, que
 * responde «qué me falta»: esto es **el respaldo de su pago por visita**, y es lo
 * que compara contra su liquidación cuando el número no le calza. Por eso va en
 * su app y no solo en el backoffice.
 *
 * El mes se acota en el servidor: sin tope, un `?mes=` inventado podría pedir
 * diez años de una vez.
 */
export async function GET(request: NextRequest) {
  const usuario = await autenticarBearer(request.headers.get("authorization"));
  if (!usuario || usuario.tipoUsuario !== "conductor" || !usuario.driverId || !usuario.tenantId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (usuario.estado !== "activo") {
    return NextResponse.json({ error: "Cuenta inactiva" }, { status: 403 });
  }

  // `YYYY-MM`, y si no viene o viene mal, el mes en curso de Santiago. Las
  // fechas se arman como CADENA: pasar por `Date` para calcular el último día
  // interpretaría el mes en UTC y en Santiago sería el mes anterior por cuatro
  // horas al filo del cambio.
  const pedido = request.nextUrl.searchParams.get("mes") ?? "";
  const mes = /^\d{4}-\d{2}$/.test(pedido) ? pedido : hoyEnSantiago().slice(0, 7);
  const [anio, mm] = mes.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(anio, mm, 0)).getUTCDate();
  const desde = `${mes}-01`;
  const hasta = `${mes}-${String(ultimoDia).padStart(2, "0")}`;

  try {
    const cliente = crearClienteServiceRole();
    const sesiones = await listarHistoricoDeRetiros(cliente, {
      tenantId: usuario.tenantId,
      conductorId: usuario.driverId,
      desde,
      hasta,
    });
    return NextResponse.json({ mes, sesiones });
  } catch (err) {
    console.error(
      "[api/conductor/retiros/historico]",
      err instanceof Error ? err.message : "error desconocido",
    );
    return NextResponse.json({ error: "Error al listar tus retiros" }, { status: 500 });
  }
}
