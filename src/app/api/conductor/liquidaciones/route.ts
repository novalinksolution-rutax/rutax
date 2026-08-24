import { type NextRequest, NextResponse } from "next/server";

import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { listarLiquidaciones, obtenerLiquidacion } from "@/modules/dinero/consultas";
import { agruparLiquidacion } from "@/modules/dinero/agrupacion-liquidacion";
import { resolverAutorDeAjuste } from "@/modules/dinero/autor-ajuste";

/**
 * «Mis liquidaciones» — la deuda que dejó el retiro de la PWA.
 * =============================================================================
 * `GET /api/conductor/liquidaciones` · `GET ?id=<uuid>` para el detalle
 *
 * ## Por qué existe
 *
 * Hasta el 24-08-2026 el conductor veía sus liquidaciones en la PWA
 * `/conductor/liquidaciones`. Se retiró con el resto de la PWA, y la app nativa
 * **no tenía la pantalla** (brecha #19): el conductor volvió a preguntar por
 * WhatsApp cuánto le tocaba. Esta ruta es su mitad de servidor.
 *
 * ## El filtro por conductor ES el aislamiento
 *
 * `listarLiquidaciones` acepta `driverId` como argumento **opcional**: sin él
 * devuelve las de TODO el tenant. Acá va siempre, y sale del token — nunca de
 * la query. Con `service_role` bypaseando RLS, olvidar ese argumento le mostraría
 * a un conductor lo que gana cada uno de sus compañeros.
 *
 * El detalle repite la comprobación sobre la fila ya leída: `obtenerLiquidacion`
 * filtra por tenant pero **no por conductor**, porque el coordinador la usa para
 * ver las de cualquiera.
 *
 * ## Qué se devuelve, y qué no
 *
 * El listado va **plano**: período, estado y neto. El detalle agrupa con
 * `agruparLiquidacion` —la misma función del backoffice, para que las dos
 * pantallas no sumen por caminos distintos— y agrega **el autor de cada ajuste**,
 * que vive en la bitácora y no en la fila.
 */
export async function GET(request: NextRequest) {
  const usuario = await autenticarBearer(request.headers.get("authorization"));
  if (!usuario || usuario.tipoUsuario !== "conductor" || !usuario.driverId || !usuario.tenantId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (usuario.estado !== "activo") {
    return NextResponse.json({ error: "Cuenta inactiva" }, { status: 403 });
  }

  const { tenantId, driverId } = { tenantId: usuario.tenantId, driverId: usuario.driverId };
  const id = request.nextUrl.searchParams.get("id");
  const cliente = crearClienteServiceRole();

  try {
    if (!id) {
      const liquidaciones = await listarLiquidaciones(cliente, tenantId, driverId);
      return NextResponse.json({
        liquidaciones: liquidaciones.map((l) => ({
          id: l.id,
          fechaInicio: l.fechaInicio,
          fechaFin: l.fechaFin,
          estado: l.estado,
          // El neto se CALCULA con la misma fórmula del motor —total + bono
          // − penalización— y no se lee de una columna, porque no existe: la
          // fila guarda los tres números por separado. Si acá se mostrara solo
          // `montoTotalClp`, el conductor vería una cifra distinta de la que le
          // llega al banco cada vez que hubo un ajuste.
          netoClp: (l.montoTotalClp ?? 0) + l.bonoClp - l.penalizacionClp,
        })),
      });
    }

    const liquidacion = await obtenerLiquidacion(cliente, tenantId, id);
    // Un `id` de otro conductor devuelve 404 y no 403: sin el 404 se puede
    // averiguar cuáles ids existen, que es la mitad de un enumerado.
    if (!liquidacion || liquidacion.driverId !== driverId) {
      return NextResponse.json({ error: "Liquidación no encontrada" }, { status: 404 });
    }

    const agrupacion = agruparLiquidacion(liquidacion.lineas, {
      bonoClp: liquidacion.bonoClp,
      penalizacionClp: liquidacion.penalizacionClp,
      notaAjuste: liquidacion.notaAjuste,
    });

    // El autor del ajuste vive en la bitácora, no en la fila. Se lee solo si hay
    // ajuste: sin ajuste no hay a quién atribuir y sería una consulta de más en
    // el 95 % de las liquidaciones.
    const autor =
      agrupacion.ajustes.length > 0
        ? await resolverAutorDeAjuste(cliente, { tenantId, liquidacionId: id })
        : null;

    return NextResponse.json({
      liquidacion: {
        id: liquidacion.id,
        fechaInicio: liquidacion.fechaInicio,
        fechaFin: liquidacion.fechaFin,
        estado: liquidacion.estado,
        agrupacion,
        autorAjuste: autor,
      },
    });
  } catch (err) {
    console.error(
      "[api/conductor/liquidaciones]",
      err instanceof Error ? err.message : "error desconocido",
    );
    return NextResponse.json({ error: "Error al cargar tus liquidaciones" }, { status: 500 });
  }
}
