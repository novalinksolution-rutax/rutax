import { NextResponse } from "next/server";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  puedeEmitirFacturas,
  puedeGestionarLiquidacionesConductores,
} from "@/modules/identidad/capacidades";
import { obtenerReporteConsolidado } from "@/modules/dinero/reporteria/consolidado";
import { armarCsv } from "@/modules/dinero/reporteria/csv";
import { hoyEnSantiago } from "@/lib/fecha-santiago";

/**
 * `GET /dinero/reporteria/exportar` — el reporte consolidado en CSV.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * MISMO GATE QUE LA PANTALLA, NO MENOS
 * -----------------------------------------------------------------------------
 * Un endpoint de descarga es una pantalla sin marco: si pide menos capacidad que
 * la vista equivalente, es una puerta lateral. Acá se exigen las **dos** mitades
 * —`emitir_facturas` y `gestionar_liquidaciones_conductores`— igual que en
 * `/dinero/reporteria`, y el rango se lee **siempre** filtrando por `tenant_id`.
 *
 * El armado del archivo vive en `@/modules/dinero/reporteria/csv` y no acá, para
 * que la regla dura —«ni un UUID en la salida»— se pueda probar sin sesión.
 */

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (
    !puedeEmitirFacturas(sesion.usuario) ||
    !puedeGestionarLiquidacionesConductores(sesion.usuario)
  ) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const url = new URL(request.url);
  const hoy = hoyEnSantiago();
  const crudoDesde = url.searchParams.get("desde") ?? "";
  const crudoHasta = url.searchParams.get("hasta") ?? "";
  let desde = ES_FECHA.test(crudoDesde) ? crudoDesde : `${hoy.slice(0, 7)}-01`;
  let hasta = ES_FECHA.test(crudoHasta) ? crudoHasta : hoy;
  if (desde > hasta) {
    const intercambio = desde;
    desde = hasta;
    hasta = intercambio;
  }

  const cliente = crearClienteServiceRole();
  let cuerpo: string;
  try {
    const reporte = await obtenerReporteConsolidado(cliente, {
      tenantId: sesion.usuario.tenantId,
      desde,
      hasta,
      sellerId: url.searchParams.get("seller") || undefined,
      conductorId: url.searchParams.get("conductor") || undefined,
    });
    cuerpo = armarCsv(reporte);
  } catch {
    // ⚠️ Se devuelve un ERROR, nunca un CSV vacío. Un archivo de cero filas se
    // lee como «no hubo entregas» y se archiva como respaldo de algo que no se
    // alcanzó a leer.
    return NextResponse.json(
      { error: "No se pudo armar el reporte. Vuelve a intentarlo." },
      { status: 500 },
    );
  }

  const nombre = `rutax-reporteria-${desde}-a-${hasta}.csv`;
  // El BOM va primero: sin él Excel abre el archivo en la codificación del
  // sistema y las comunas con Ñ salen rotas.
  return new NextResponse(`﻿${cuerpo}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      // Un reporte de dinero no se sirve desde caché: la vista es viva.
      "Cache-Control": "no-store",
    },
  });
}
