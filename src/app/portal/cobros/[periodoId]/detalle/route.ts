import { NextResponse } from "next/server";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeVerDocumentosPropios } from "@/modules/identidad/capacidades";
import { obtenerPeriodoCobro } from "@/modules/dinero/index";
import { etiquetaPeriodo } from "@/modules/dinero/listado-periodos";

/**
 * `GET /portal/cobros/[periodoId]/detalle` — las entregas del período, en CSV.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ ES Y QUÉ NO ES
 * -----------------------------------------------------------------------------
 * **No es una factura.** El documento tributario lo emite el proveedor DTE y el
 * seller lo descarga aparte; Rutax no compite con él ni lo re-genera. Decisión
 * del usuario (24-08-2026): la factura oficial sigue siendo la del SII, y esto
 * es **el detalle de entregas que el seller reclama cuando no entiende el
 * total**.
 *
 * Es la misma respuesta que el backoffice le da a Administración con
 * `/dinero/periodos/[id]/exportar`, del otro lado del mostrador: la exportación
 * no es la derrota de la regla de composición, es la salida legítima para quien
 * necesita cruzar 285 líneas con su propia contabilidad. Negarla no evita el
 * Excel — evita que el Excel salga de una fuente confiable.
 *
 * -----------------------------------------------------------------------------
 * DOS BARRERAS, Y LA SEGUNDA ES LA QUE IMPORTA
 * -----------------------------------------------------------------------------
 * 1. Sesión de seller con `ver_documentos_propios` — la misma capacidad que
 *    gobierna la pantalla del período. Un endpoint de descarga es una pantalla
 *    sin marco: si pidiera menos, sería una puerta lateral.
 * 2. **El período es suyo.** `obtenerPeriodoCobro` filtra por tenant y **no por
 *    seller**, porque del lado del courier se usa para ver el de cualquiera. Sin
 *    esta comprobación, un seller con el id de otro se descarga sus entregas.
 *
 * -----------------------------------------------------------------------------
 * SIN IVA, Y ESO NO ES UNA OMISIÓN
 * -----------------------------------------------------------------------------
 * Todas las cifras son **neto** (regla 22). El IVA vive en el documento
 * tributario, que es el que lo declara; ponerlo acá crearía un segundo lugar
 * donde el impuesto se calcula, y dos cálculos del mismo impuesto terminan
 * discrepando.
 */

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
  if (!sesion?.usuario.tenantId || sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }
  if (!puedeVerDocumentosPropios(sesion.usuario)) {
    return NextResponse.json({ error: "Sin permiso." }, { status: 403 });
  }

  const { periodoId } = await params;
  const cliente = crearClienteServiceRole();

  const periodo = await obtenerPeriodoCobro(cliente, sesion.usuario.tenantId, periodoId).catch(
    () => null,
  );
  // 404 y no 403 cuando es de otro seller: sin el 404 se puede averiguar qué
  // ids existen, que es la mitad de un enumerado.
  if (!periodo || periodo.sellerId !== sesion.usuario.sellerId) {
    return NextResponse.json({ error: "Período no encontrado." }, { status: 404 });
  }

  const lineas = periodo.lineas ?? [];

  // El nombre del propio seller, para PODARLO del concepto — igual que en la
  // pantalla. El motor escribe «Entrega Flex – FalabellaTech Ltda.», que es
  // correcto del lado del courier —un período junta varios sellers— y acá
  // repite el nombre del que descarga en cada una de sus 285 filas.
  const { data: sellerFila } = await cliente
    .from("sellers")
    .select("razon_social")
    .eq("id", sesion.usuario.sellerId)
    .maybeSingle();
  const nombreSeller = ((sellerFila?.razon_social as string | null) ?? "").trim();
  const podar = (concepto: string): string => {
    if (!nombreSeller) return concepto;
    for (const guion of [" – ", " - ", " — "]) {
      const sufijo = `${guion}${nombreSeller}`;
      if (concepto.endsWith(sufijo)) return concepto.slice(0, -sufijo.length);
    }
    return concepto;
  };

  // El pedido, para poder escribir las columnas en el idioma del seller.
  // ---------------------------------------------------------------------------
  // `LineaCobro` solo trae `pedidoId`, que es un UUID y no le dice nada. Lo que
  // él reconoce es el código de su envío, a quién iba y a qué comuna — que es
  // como busca en su propia planilla.
  //
  // Los ids van en tandas de 100: un `.in()` con mil UUID revienta con
  // `URI too long`, y un período de un seller grande los tiene.
  const pedidos = new Map<
    string,
    { codigo: string; destinatario: string; comuna: string }
  >();
  const ids = [...new Set(lineas.map((l) => l.pedidoId))];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await cliente
      .from("pedidos")
      .select("id, codigo_interno, ml_shipment_id, destinatario_nombre, destinatario_comuna")
      .eq("tenant_id", sesion.usuario.tenantId)
      // El seller SIEMPRE en el filtro, aunque los ids salgan de sus propias
      // líneas: con `service_role` bypaseando RLS, el filtro explícito ES el
      // aislamiento.
      .eq("seller_id", sesion.usuario.sellerId)
      .in("id", ids.slice(i, i + 100));

    for (const p of (data ?? []) as Record<string, unknown>[]) {
      pedidos.set(p.id as string, {
        codigo: ((p.codigo_interno as string | null) ?? (p.ml_shipment_id as string | null)) ?? "",
        destinatario: (p.destinatario_nombre as string | null) ?? "",
        comuna: (p.destinatario_comuna as string | null) ?? "",
      });
    }
  }

  // Las columnas están escritas para el SELLER, no para el motor. `pedido_id`
  // es un UUID que no le dice nada; lo que él reconoce es el código de su
  // envío, a quién iba y a qué comuna — que es como busca en su propia planilla.
  const cabecera = [
    "codigo_envio",
    "destinatario",
    "comuna",
    "fecha_entrega",
    "concepto",
    "monto_neto_clp",
  ];

  const filas = lineas.map((l) =>
    [
      // Si el pedido no se pudo leer, cae al id: es feo pero verdadero, y una
      // celda vacía haría creer que esa entrega no existió.
      campo(pedidos.get(l.pedidoId)?.codigo || l.pedidoId),
      campo(pedidos.get(l.pedidoId)?.destinatario ?? ""),
      campo(pedidos.get(l.pedidoId)?.comuna ?? ""),
      campo(l.fechaHecho),
      campo(podar(l.concepto)),
      campo(l.montoFinalClp),
    ].join(";"),
  );

  // El total va como última fila y no en una hoja aparte: el seller abre esto
  // para cuadrar contra un número, y ese número tiene que estar acá.
  const total = lineas.reduce((acc, l) => acc + (l.montoFinalClp ?? 0), 0);
  const filaTotal = [
    campo(`TOTAL · ${lineas.length} ${lineas.length === 1 ? "entrega" : "entregas"}`),
    campo(""),
    campo(""),
    campo(""),
    campo("Neto, sin IVA"),
    campo(total),
  ].join(";");

  // El BOM va primero o Excel abre el archivo en la codificación del sistema y
  // «Ñuñoa» sale roto. El separador es `;` porque Excel en configuración
  // chilena no parte por coma.
  const csv =
    "﻿" + [cabecera.map(campo).join(";"), ...filas, filaTotal].join("\r\n");

  const nombre = `entregas-${etiquetaPeriodo(periodo.fechaInicio, periodo.fechaFin)
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "")}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      // Un período abierto sigue recibiendo entregas: el archivo de hace un
      // minuto ya no es el mismo.
      "Cache-Control": "no-store",
    },
  });
}
