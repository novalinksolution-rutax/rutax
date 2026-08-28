import { redirect } from "next/navigation";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  puedeEmitirFacturas,
  puedeGestionarLiquidacionesConductores,
} from "@/modules/identidad/capacidades";
import { obtenerReporteConsolidado } from "@/modules/dinero/reporteria/consolidado";
import { hoyEnSantiago } from "@/lib/fecha-santiago";
import { VistaReporteria } from "./_componentes/vista-reporteria";
import { formatearFechaCivilCorta } from "@/lib/formato-cl";

/**
 * `/dinero/reporteria` — el detalle con el que se cobra y se paga a mano.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTA PANTALLA EXISTE
 * -----------------------------------------------------------------------------
 * El piloto opera **sin DTE y sin pagos automáticos**. Alguien en el courier va
 * a facturarle a cada seller y a transferirle a cada conductor mirando algo, y
 * hasta ahora ese algo eran dos pantallas distintas y un CSV cuya primera
 * columna era el UUID del pedido.
 *
 * ⚠️ **No se retira cuando se enciendan la facturación y los pagos.** Es lo que
 * deja auditar al motor: el día que el DTE emita solo, «¿por qué me cobraron
 * esto?» se sigue respondiendo acá.
 *
 * -----------------------------------------------------------------------------
 * 🔴 EL GATE PIDE LAS DOS MITADES, Y NO ES `ver_reportes_ejecutivos`
 * -----------------------------------------------------------------------------
 * La pantalla cruza en la misma fila lo que se le cobra al seller —que gobierna
 * `emitir_facturas`, igual que `/dinero/periodos`— con lo que se le paga al
 * conductor —`gestionar_liquidaciones_conductores`, igual que
 * `/dinero/liquidaciones`—. Pedir una sola sería una **puerta lateral** hacia la
 * mitad que el usuario no puede ver por su camino normal.
 *
 * Y NO va por `ver_reportes_ejecutivos`, que parecía la capacidad natural: esa
 * la tiene **solo el dueño**, y dejaría fuera precisamente a `administracion`,
 * que es el rol para el que se construyó esto. Exigir las dos cae exacto en
 * {dueño, administración}.
 *
 * -----------------------------------------------------------------------------
 * RANGO LIBRE, Y TAMBIÉN ENTRADA DESDE EL PERÍODO
 * -----------------------------------------------------------------------------
 * Decisión del usuario: las dos cosas. Por defecto el mes en curso —que es la
 * unidad con la que se factura—, y `?periodo=<id>` llega desde la pantalla del
 * período con sus fechas ya puestas. El rango vive en la URL a propósito: así se
 * comparte por correo y se guarda en marcadores.
 *
 * -----------------------------------------------------------------------------
 * VISTA VIVA, NO FOTOGRAFÍA
 * -----------------------------------------------------------------------------
 * Se recalcula en cada carga. Un reporte congelado se vuelve una segunda verdad
 * que hay que explicar cuando difiere del motor; acá lo que se ve es lo que hay
 * en las líneas ahora mismo.
 */

export const dynamic = "force-dynamic";

interface SearchParams {
  desde?: string;
  hasta?: string;
  seller?: string;
  conductor?: string;
  periodo?: string;
}

/** Primer día del mes de `hoy`, en Santiago. */
function inicioDelMes(hoy: string): string {
  return `${hoy.slice(0, 7)}-01`;
}

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export default async function PaginaReporteria({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");
  // Las dos mitades. Ver la nota del encabezado: pedir una sola sería una
  // puerta lateral hacia la otra.
  if (
    !puedeEmitirFacturas(sesion.usuario) ||
    !puedeGestionarLiquidacionesConductores(sesion.usuario)
  ) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();
  const hoy = hoyEnSantiago();

  // --- Rango ---------------------------------------------------------------
  let desde = ES_FECHA.test(params.desde ?? "") ? (params.desde as string) : inicioDelMes(hoy);
  let hasta = ES_FECHA.test(params.hasta ?? "") ? (params.hasta as string) : hoy;
  let sellerFijo: string | null = null;
  let etiquetaPeriodo: string | null = null;

  // Entrada desde el período: sus fechas y su seller mandan sobre el rango
  // libre. Si el período no existe o es de otro tenant, se ignora y se cae al
  // rango por defecto — nunca se muestra el de otro courier.
  if (params.periodo) {
    const { data } = await cliente
      .schema("dinero")
      .from("periodos_cobro")
      .select("fecha_inicio, fecha_fin, seller_id")
      .eq("tenant_id", tenantId)
      .eq("id", params.periodo)
      .maybeSingle();
    if (data) {
      desde = data.fecha_inicio as string;
      hasta = data.fecha_fin as string;
      sellerFijo = data.seller_id as string;
      etiquetaPeriodo = `${formatearFechaCivilCorta(desde)} – ${formatearFechaCivilCorta(hasta)}`;
    }
  }

  // Un rango al revés no devuelve nada y parece que no hay datos. Se endereza.
  if (desde > hasta) {
    const intercambio = desde;
    desde = hasta;
    hasta = intercambio;
  }

  const sellerId = sellerFijo ?? (params.seller || undefined);
  const conductorId = params.conductor || undefined;

  let reporte: Awaited<ReturnType<typeof obtenerReporteConsolidado>> | null = null;
  let error = false;
  try {
    reporte = await obtenerReporteConsolidado(cliente, {
      tenantId,
      desde,
      hasta,
      sellerId,
      conductorId,
    });
  } catch {
    error = true;
  }

  // Cuántas entregas hay detrás de cada monto. Se calculan acá y no en el
  // módulo porque son de presentación: el reporte ya trae las filas.
  const entregasCobradas = reporte?.filas.filter((f) => f.cobroFinal !== null).length ?? 0;
  const entregasPagadas = reporte?.filas.filter((f) => f.pagoFinal !== null).length ?? 0;

  const qs = new URLSearchParams({ desde, hasta });
  if (sellerId) qs.set("seller", sellerId);
  if (conductorId) qs.set("conductor", conductorId);
  return (
    <VistaReporteria
      reporte={reporte}
      error={error}
      desde={desde}
      hasta={hasta}
      etiquetaPeriodo={etiquetaPeriodo}
      entregasCobradas={entregasCobradas}
      entregasPagadas={entregasPagadas}
      qs={qs.toString()}
    />
  );
}
