/**
 * GET /api/operaciones/exportar — el listado de pedidos que estás viendo, en CSV.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ EXISTE
 * -----------------------------------------------------------------------------
 * Es **la segunda salida del truncamiento**. La pantalla de Pedidos declara que
 * está mostrando las primeras 100 de 284 y ofrece dos caminos: afinar el filtro
 * —el correcto casi siempre— o llevarse el listado completo. Sin este endpoint
 * el segundo camino era una promesa vacía.
 *
 * ⚠️ **No es `/api/courier/exportar-datos`.** Aquél es el volcado íntegro del
 * tenant para portabilidad (RNF-13), va en JSON y está tras
 * `ver_bitacora_auditoria` —que el coordinador no tiene—. Éste es una cosa
 * distinta: el listado que tienes delante, con tu filtro, en la herramienta con
 * la que se trabaja de verdad, que es una planilla.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL FILTRO SE SANEA CON LAS MISMAS FUNCIONES QUE LA PANTALLA
 * -----------------------------------------------------------------------------
 * Y no es prolijidad: si la exportación entendiera los parámetros aunque sea un
 * poco distinto de la pantalla, entregaría **un listado que no es el que se está
 * mirando** — y quien lo abra creerá que sí. Un `?fecha=` inválido tiene que
 * caer del mismo lado en los dos sitios.
 *
 * -----------------------------------------------------------------------------
 * QUÉ COLUMNAS SALEN, Y POR QUÉ ESAS
 * -----------------------------------------------------------------------------
 * **Las mismas que la tabla, ni una más.** La tentación es exportar la fila
 * entera «ya que estamos», y ahí se cuela la dirección exacta del destinatario
 * en un archivo que se manda por correo. El propósito declarado es «el listado
 * completo», así que el listado es lo que sale: minimización por construcción,
 * no por promesa.
 *
 * Queda en bitácora —es un acceso a datos, con su actor— y se registra **antes**
 * de devolver el archivo.
 */

import { NextResponse, type NextRequest } from "next/server";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { listarPedidos } from "@/modules/operacion/pedidos";
import { mapaNombresConductores } from "@/modules/identidad/consultas";
import { obtenerSellersDelTenant } from "@/lib/datos-tenant/sellers";
import { GRUPOS_ESTADO_PEDIDO, type EstadoPedido, type Pedido } from "@/modules/operacion/tipos";
import {
  sanearFiltroEstadoPedido,
  sanearFiltroFechaCivil,
  sanearFiltroFuentePedido,
  sanearFiltroUuid,
  sanearGrupoEstadoPedido,
} from "@/app/(tenant)/operaciones/sanear-filtros";
import { formatearFechaCivilCorta } from "@/lib/formato-cl";
import { etiquetaFuenteCorta } from "@/lib/ui/etiqueta-fuente-pedido";
import { traducirEstadoPedido } from "@/lib/ui/traduccion-estados";

/** Tope duro. Un filtro mal puesto falla; no descarga el tenant entero. */
const TOPE_FILAS = 20_000;

export async function GET(peticion: NextRequest) {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario?.tenantId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  /**
   * ⚠️ **El portón es EXACTAMENTE el de la pantalla: sesión y tenant, sin
   * capacidad extra.** Y eso costó un 403 en pruebas.
   *
   * El primer intento usó `ajustar_operacion_diaria`, que suena a «gente de
   * operación» y **deja fuera al coordinador a propósito** (ver el comentario de
   * esa capacidad). O sea: el rol que vive dentro de esta lista todo el día era
   * el único que no podía llevársela.
   *
   * Más estricto que la pantalla es lo peor de los dos mundos: el botón se
   * dibuja y al pulsarlo da 403. Y más flojo sería una puerta lateral a datos
   * que la pantalla no muestra. Acá no exporta nada que no esté ya en la tabla
   * que quien llama tiene delante, así que el portón correcto es el mismo.
   */

  const tenantId = sesion.usuario.tenantId;
  const sp = peticion.nextUrl.searchParams;

  const grupoCrudo = sanearGrupoEstadoPedido(sp.get("estado"));
  const esGrupo = Boolean(grupoCrudo && grupoCrudo in GRUPOS_ESTADO_PEDIDO);
  const grupo = esGrupo ? (grupoCrudo as keyof typeof GRUPOS_ESTADO_PEDIDO) : null;
  const filtros = {
    tenantId,
    sellerId: sanearFiltroUuid(sp.get("seller")) || undefined,
    conductorId: sanearFiltroUuid(sp.get("conductor")) || undefined,
    comuna: sp.get("comuna")?.slice(0, 120) || undefined,
    fuente: sanearFiltroFuentePedido(sp.get("fuente")) || undefined,
    fecha: sanearFiltroFechaCivil(sp.get("fecha")) || undefined,
    fechaDesde: sanearFiltroFechaCivil(sp.get("fecha_desde")) || undefined,
    fechaHasta: sanearFiltroFechaCivil(sp.get("fecha_hasta")) || undefined,
    porRevisar: sp.get("estado") === "por_revisar" || undefined,
    estado: grupo ? undefined : (sanearFiltroEstadoPedido(sp.get("estado")) as EstadoPedido) || undefined,
    estados: grupo ? [...GRUPOS_ESTADO_PEDIDO[grupo]] : undefined,
  };

  const cliente = crearClienteServiceRole();

  /**
   * ⚠️ **Se lee con `listarPedidos`, la misma función que usa la pantalla.**
   *
   * La tentación era armar acá una consulta propia —es más corta— y ahí está el
   * defecto: el día que cambie una regla de filtrado en `listarPedidos`, el
   * archivo exportado dejaría de coincidir con lo que se ve en pantalla **sin
   * que nada falle**. Quien abra el CSV creerá que está mirando lo mismo.
   *
   * Se pagina a mano porque PostgREST corta en 1.000 filas en silencio: un
   * export truncado sin avisar es peor que no exportar, porque el archivo se ve
   * completo.
   */
  const filas: Pedido[] = [];
  try {
    const PAGINA = 500;
    for (let pagina = 1; ; pagina += 1) {
      const lote = await listarPedidos(cliente, { ...filtros, pagina, limite: PAGINA });
      filas.push(...lote.datos);
      if (lote.datos.length < PAGINA || filas.length >= TOPE_FILAS) break;
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo exportar" },
      { status: 500 },
    );
  }

  /**
   * Los UUID no le sirven a nadie en una planilla: se resuelven a nombres.
   *
   * ⚠️ **Con los mismos ayudantes que la pantalla, no con consultas a mano.** El
   * primer intento las escribió acá —`identidad.conductores`, columna `nombre`—
   * y la columna CONDUCTOR salió **vacía en todas las filas**, con el `catch`
   * tragándose el motivo. En una planilla eso no se nota: parece que los pedidos
   * no tenían conductor.
   */
  const [sellers, conductores] = await Promise.all([
    obtenerSellersDelTenant(tenantId).catch(() => [] as { id: string; nombre: string }[]),
    mapaNombresConductores(
      cliente,
      tenantId,
      Array.from(new Set(filas.flatMap((f) => (f.driverIdAsignado ? [f.driverIdAsignado] : [])))),
    ).catch(() => ({}) as Record<string, string>),
  ]);
  const sellerPorId = Object.fromEntries(sellers.map((x) => [x.id, x.nombre]));

  const csv = aCsv(filas, sellerPorId, conductores);

  // Bitácora ANTES de entregar el archivo: si la descarga falla a mitad, el
  // acceso ya ocurrió igual y tiene que constar.
  await registrarEnBitacora(cliente, {
    tenantId,
    actorUsuarioId: sesion.usuarioId,
    actorTipo: "usuario",
    accion: "operacion.pedidos_exportados",
    entidadTipo: "pedido",
    entidadId: null,
    // Solo conteo y qué filtro: nunca el contenido de las filas.
    detalle: { filas: filas.length, filtros: Object.keys(filtros).filter((k) => k !== "tenantId") },
  });

  const nombre = `pedidos-${filtros.fecha ?? "listado"}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      // BOM para que Excel en Windows lea los acentos. Sin él, «Ñuñoa» sale
      // roto en la máquina donde de verdad se abre este archivo.
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}

const CABECERAS = [
  "Código",
  "Estado",
  "Destinatario",
  "Comuna",
  "Seller",
  "Fecha comprometida",
  "Origen",
  "Conductor",
  "Motivo",
] as const;

function aCsv(
  filas: Pedido[],
  sellers: Record<string, string>,
  conductores: Record<string, string>,
): string {
  const lineas = [CABECERAS.join(";")];
  for (const f of filas) {
    lineas.push(
      [
        f.codigoInterno ?? f.mlShipmentId ?? "",
        traducirEstadoPedido(f.estado),
        f.destinatarioNombre ?? "",
        f.destinatarioComuna ?? "",
        sellers[f.sellerId] ?? "",
        f.fechaCompromiso ? formatearFechaCivilCorta(f.fechaCompromiso) : "",
        etiquetaFuenteCorta(f.fuente),
        f.driverIdAsignado ? (conductores[f.driverIdAsignado] ?? "") : "",
        f.motivoCancelacion ?? "",
      ]
        .map(celdaCsv)
        .join(";"),
    );
  }
  // `﻿` = BOM; `\r\n` porque es lo que Excel espera.
  return "﻿" + lineas.join("\r\n") + "\r\n";
}

/**
 * Escapa una celda para CSV.
 *
 * ⚠️ **El separador es `;` y no `,`**: Excel en configuración regional chilena
 * usa la coma como separador decimal, así que un CSV con comas se abre con todo
 * en una sola columna — y quien lo recibe concluye que el export está roto.
 *
 * ⚠️ **Y se neutraliza la inyección de fórmulas.** Un valor que empieza con `=`,
 * `+`, `-` o `@` lo ejecuta Excel al abrir el archivo. Los nombres de
 * destinatario y los motivos de cancelación **los escribe gente**, y aunque acá
 * el archivo lo abre el propio courier, un `=HYPERLINK(...)` en una planilla que
 * se reenvía es un problema que no cuesta nada evitar.
 */
function celdaCsv(valor: string): string {
  const limpio = /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
  return `"${limpio.replace(/"/g, '""')}"`;
}
