import { redirect, notFound } from "next/navigation";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  puedeVerPeriodosCobro,
  puedeVerLiquidaciones,
} from "@/modules/identidad/capacidades";
import { obtenerReporteConsolidado } from "@/modules/dinero/reporteria/consolidado";
import { hoyEnSantiago } from "@/lib/fecha-santiago";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { formatearFechaCivilCorta } from "@/lib/formato-cl";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HojaDocumento } from "../../_componentes/hoja-documento";

/**
 * El respaldo que se le entrega al SELLER: qué se le cobra y por qué.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 EL CONDUCTOR NO APARECE ACÁ, Y ES A PROPÓSITO
 * -----------------------------------------------------------------------------
 * La pantalla interna cruza las dos mitades porque quien paga necesita verlas
 * juntas. Este papel sale del courier y **se entrega a un tercero**, así que
 * lleva solo lo que ese tercero necesita para cuadrar su cobro: qué se entregó,
 * dónde, cuándo y cuánto.
 *
 * Quién manejó la moto es dato de una persona identificada (Ley 21.431) y no le
 * hace falta al seller para pagar. Tampoco va lo que se le pagó al conductor:
 * es el margen del courier y no es asunto de su cliente.
 *
 * Lo que sí va es el destinatario y la comuna — el seller ya los conoce, son
 * datos de SU venta, y sin ellos no puede cruzar la línea con su propio pedido.
 */

export const dynamic = "force-dynamic";

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export default async function DocumentoSeller({
  params,
  searchParams,
}: {
  params: Promise<{ sellerId: string }>;
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");
  if (
    !puedeVerPeriodosCobro(sesion.usuario) ||
    !puedeVerLiquidaciones(sesion.usuario)
  ) {
    redirect("/dashboard");
  }

  const { sellerId } = await params;
  const sp = await searchParams;
  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();
  const hoy = hoyEnSantiago();

  let desde = ES_FECHA.test(sp.desde ?? "") ? (sp.desde as string) : `${hoy.slice(0, 7)}-01`;
  let hasta = ES_FECHA.test(sp.hasta ?? "") ? (sp.hasta as string) : hoy;
  if (desde > hasta) {
    const intercambio = desde;
    desde = hasta;
    hasta = intercambio;
  }

  // Las dos partes. El seller se lee SIEMPRE filtrando por `tenant_id`: sin eso,
  // un id adivinado imprimiría el documento de otro courier.
  const [{ data: courier }, { data: seller }] = await Promise.all([
    cliente
      .schema("identidad")
      .from("tenants")
      .select("razon_social, rut")
      .eq("id", tenantId)
      .maybeSingle(),
    cliente
      .schema("identidad")
      .from("sellers")
      .select("razon_social, rut")
      .eq("tenant_id", tenantId)
      .eq("id", sellerId)
      .maybeSingle(),
  ]);

  if (!courier || !seller) notFound();

  const reporte = await obtenerReporteConsolidado(cliente, {
    tenantId,
    desde,
    hasta,
    sellerId,
  });

  // Solo lo que tiene cobro. Una entrega sin línea de cobro es un problema
  // interno del courier —y la pantalla de reportería lo marca— pero no se le
  // cobra al seller, así que no puede aparecer en su documento.
  const cobradas = reporte.filas.filter((f) => f.cobroFinal !== null);
  const total = cobradas.reduce((s, f) => s + (f.cobroFinal ?? 0), 0);

  const qs = new URLSearchParams({ desde, hasta }).toString();

  return (
    <HojaDocumento
      titulo="Detalle de servicios de despacho"
      emisor={{ nombre: courier.razon_social as string, rut: courier.rut as string }}
      receptor={{ nombre: seller.razon_social as string, rut: seller.rut as string }}
      etiquetaReceptor="Seller"
      desde={desde}
      hasta={hasta}
      volverA={`/dinero/reporteria?${qs}`}
    >
      {cobradas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay entregas cobrables en este rango.
        </p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Pedido</TableHead>
                <TableHead>Fuente</TableHead>
                <TableHead>Destinatario</TableHead>
                <TableHead>Comuna</TableHead>
                <TableHead className="text-right">Tarifa</TableHead>
                <TableHead className="text-right">Ajuste</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cobradas.map((f, i) => (
                <TableRow key={`${f.codigo}-${i}`}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {f.fechaHecho ? formatearFechaCivilCorta(f.fechaHecho) : "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-medium">{f.codigo}</TableCell>
                  <TableCell className="text-muted-foreground">{f.fuenteEtiqueta}</TableCell>
                  <TableCell>{f.destinatario}</TableCell>
                  <TableCell className="text-muted-foreground">{f.comuna}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatearCLP(f.cobroBase ?? 0)}
                  </TableCell>
                  {/* El ajuste va en su propia columna y no fundido en el total:
                      es la única línea que el seller va a querer preguntar, y
                      esconderla dentro de la cifra final obliga a llamar. */}
                  <TableCell className="text-right tabular-nums">
                    {f.cobroAjuste ? formatearCLP(f.cobroAjuste) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatearCLP(f.cobroFinal ?? 0)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-6 flex items-baseline justify-between border-t pt-4">
            <p className="text-sm text-muted-foreground">
              {cobradas.length} {cobradas.length === 1 ? "entrega" : "entregas"} en el período
            </p>
            <p className="text-xl font-semibold tabular-nums">{formatearCLP(total)}</p>
          </div>
        </>
      )}
    </HojaDocumento>
  );
}
