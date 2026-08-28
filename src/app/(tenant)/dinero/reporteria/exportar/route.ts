import { NextResponse } from "next/server";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  puedeEmitirFacturas,
  puedeGestionarLiquidacionesConductores,
} from "@/modules/identidad/capacidades";
import { obtenerReporteConsolidado } from "@/modules/dinero/reporteria/consolidado";
import { armarCsv } from "@/modules/dinero/reporteria/csv";
import { armarLibro } from "@/modules/dinero/reporteria/xlsx";
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
 *
 * -----------------------------------------------------------------------------
 * DOS FORMATOS, DOS USOS
 * -----------------------------------------------------------------------------
 * `?formato=xlsx` entrega la planilla con marca, formato de moneda, panel
 * congelado y autofiltro — para la PERSONA que factura. Sin el parámetro sale el
 * CSV, que es para MÁQUINAS: se importa a un contable y no se rompe nunca. El
 * mismo archivo no sirve para los dos usos, así que se conservan ambos.
 *
 * ⚠️ El CSV es el DEFECTO a propósito: si algún día el armado del XLSX falla por
 * una dependencia, el camino que no puede caerse sigue siendo el que responde
 * sin parámetros.
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
  const quiereXlsx = url.searchParams.get("formato") === "xlsx";
  let cuerpo: string | ArrayBuffer;
  let courierNombre = "";
  try {
    const [reporte, { data: courier }] = await Promise.all([
      obtenerReporteConsolidado(cliente, {
        tenantId: sesion.usuario.tenantId,
        desde,
        hasta,
        sellerId: url.searchParams.get("seller") || undefined,
        conductorId: url.searchParams.get("conductor") || undefined,
      }),
      cliente
        .schema("identidad")
        .from("tenants")
        .select("razon_social")
        .eq("id", sesion.usuario.tenantId)
        .maybeSingle(),
    ]);
    courierNombre = (courier?.razon_social as string) ?? "";
    cuerpo = quiereXlsx
      ? ((await armarLibro({ reporte, courierNombre, desde, hasta })) as ArrayBuffer)
      : armarCsv(reporte);
  } catch {
    // ⚠️ Se devuelve un ERROR, nunca un CSV vacío. Un archivo de cero filas se
    // lee como «no hubo entregas» y se archiva como respaldo de algo que no se
    // alcanzó a leer.
    return NextResponse.json(
      { error: "No se pudo armar el reporte. Vuelve a intentarlo." },
      { status: 500 },
    );
  }

  const nombre = `rutax-reporteria-${desde}-a-${hasta}.${quiereXlsx ? "xlsx" : "csv"}`;
  // Un reporte de dinero no se sirve desde caché: la vista es viva.
  const comunes = {
    "Content-Disposition": `attachment; filename="${nombre}"`,
    "Cache-Control": "no-store",
  };

  if (quiereXlsx) {
    return new NextResponse(cuerpo as ArrayBuffer, {
      headers: {
        ...comunes,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  }

  // El BOM va primero: sin él Excel abre el CSV en la codificación del sistema
  // y las comunas con Ñ salen rotas.
  return new NextResponse(`﻿${cuerpo as string}`, {
    headers: { ...comunes, "Content-Type": "text/csv; charset=utf-8" },
  });
}
