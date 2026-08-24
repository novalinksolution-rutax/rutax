/**
 * GET /dinero/periodos/[periodoId]/exportar — las líneas del período en CSV.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ EXISTE, Y NO ES «UNA FUNCIÓN MÁS»
 * -----------------------------------------------------------------------------
 * El tablero pone `Exportar` al lado de «Ver las 285 una por una», y el sistema
 * de diseño explica el motivo en el punto de no retorno: **«un total sin
 * composición es exactamente la cifra que Administración no puede rastrear — y
 * por la que exportaría a Excel»**. La exportación no es la derrota de esa
 * regla: es la salida legítima para cuando alguien necesita cruzar 285 líneas
 * con su propia contabilidad. Negarla no evita el Excel; evita que el Excel
 * salga de una fuente confiable.
 *
 * -----------------------------------------------------------------------------
 * MISMO GATING QUE LA PANTALLA, NO MENOS
 * -----------------------------------------------------------------------------
 * Un endpoint de descarga es una pantalla sin marco: si pide menos capacidad que
 * la vista equivalente, es una puerta lateral. Acá se exige `puedeEmitirFacturas`
 * —la misma que gobierna `/dinero/periodos/[id]`— y el período se lee **siempre
 * filtrando por `tenant_id`**, no solo por su id.
 *
 * -----------------------------------------------------------------------------
 * SEPARADOR `;` Y BOM, PORQUE EL DESTINO ES EXCEL EN ESPAÑOL
 * -----------------------------------------------------------------------------
 * Excel en configuración regional chilena parte por `;`, no por coma, y sin BOM
 * abre el archivo en la codificación del sistema: «Ñuñoa» sale roto. Las dos
 * cosas son deliberadas.
 */

import { NextResponse } from "next/server";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeEmitirFacturas } from "@/modules/identidad/capacidades";
import { obtenerPeriodoCobro } from "@/modules/dinero/index";
import { etiquetaPeriodo } from "@/modules/dinero/listado-periodos";

/** Escapa un valor para CSV: comillas dobladas y campo entre comillas. */
function campo(valor: string | number | null | undefined): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  return `"${texto.replace(/"/g, '""')}"`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ periodoId: string }> },
) {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }
  if (!puedeEmitirFacturas(sesion.usuario)) {
    return NextResponse.json({ error: "Sin permiso." }, { status: 403 });
  }

  const { periodoId } = await params;
  const cliente = crearClienteServiceRole();

  const periodo = await obtenerPeriodoCobro(cliente, sesion.usuario.tenantId, periodoId).catch(
    () => null,
  );
  if (!periodo) {
    return NextResponse.json({ error: "Período no encontrado." }, { status: 404 });
  }

  const lineas = periodo.lineas ?? [];

  const cabecera = [
    "pedido_id",
    "fecha_del_hecho",
    "tipo_pedido",
    "concepto",
    "monto_base_clp",
    "ajuste_incidencia_clp",
    "monto_final_clp",
    "anulada",
    "motivo_anulacion",
  ];

  const filas = lineas.map((l) =>
    [
      campo(l.pedidoId),
      campo(l.fechaHecho),
      campo(l.tipoPedido),
      campo(l.concepto),
      campo(l.montoBaseClp),
      campo(l.ajusteIncidenciaClp),
      campo(l.montoFinalClp),
      // ⚠️ El archivo trae las MISMAS líneas que la pantalla: solo las
      // vigentes. `listarLineasCobroPorPeriodo` excluye las anuladas —un pedido
      // fallido que después se devolvió—, así que esta columna sale siempre en
      // `no`. Se conserva igual: si algún día el export incluye las anuladas,
      // la columna ya está y la suma sigue explicándose sola.
      campo(l.anulada ? "si" : "no"),
      campo(l.motivoAnulacion),
    ].join(";"),
  );

  // El BOM va primero o Excel abre el archivo en la codificación del sistema.
  const csv = "﻿" + [cabecera.map(campo).join(";"), ...filas].join("\r\n");

  const nombre = `periodo-${etiquetaPeriodo(periodo.fechaInicio, periodo.fechaFin)
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "")}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      // Un período abierto sigue recibiendo líneas: el archivo de hace un minuto
      // ya no es el mismo.
      "Cache-Control": "no-store",
    },
  });
}
