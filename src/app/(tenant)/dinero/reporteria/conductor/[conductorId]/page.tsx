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
 * El respaldo que se le entrega al CONDUCTOR: qué se le paga y por qué.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 LAS VISITAS A BODEGA VAN EN SU PROPIO BLOQUE
 * -----------------------------------------------------------------------------
 * Se pagan por visita y no por paquete, así que sumarlas calladas entre las
 * entregas deja al conductor con un total que no puede reproducir contando lo
 * que hizo. Y es exactamente el reclamo que uno quiere evitar: el conductor
 * cuenta sus entregas, no le da la cifra, y no tiene cómo saber si le faltan o
 * si el resto es otra cosa.
 *
 * -----------------------------------------------------------------------------
 * QUÉ NO VA
 * -----------------------------------------------------------------------------
 * Lo que se le cobró al seller. Es el margen del courier: no es información del
 * conductor y ponerla convierte cada liquidación en una negociación.
 *
 * El destinatario tampoco: el conductor ya lo entregó y el papel se guarda
 * meses. El código del pedido basta para reclamar una línea.
 */

export const dynamic = "force-dynamic";

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export default async function DocumentoConductor({
  params,
  searchParams,
}: {
  params: Promise<{ conductorId: string }>;
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

  const { conductorId } = await params;
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

  const [{ data: courier }, { data: conductor }] = await Promise.all([
    cliente
      .schema("identidad")
      .from("tenants")
      .select("razon_social, rut")
      .eq("id", tenantId)
      .maybeSingle(),
    cliente
      .schema("identidad")
      .from("conductores")
      .select("nombre_completo, rut")
      .eq("tenant_id", tenantId)
      .eq("id", conductorId)
      .maybeSingle(),
  ]);

  if (!courier || !conductor) notFound();

  const reporte = await obtenerReporteConsolidado(cliente, {
    tenantId,
    desde,
    hasta,
    conductorId,
  });

  const pagadas = reporte.filas.filter((f) => f.pagoFinal !== null);
  const totalEntregas = pagadas.reduce((s, f) => s + (f.pagoFinal ?? 0), 0);
  const totalVisitas = reporte.visitas.reduce((s, v) => s + v.montoFinal, 0);

  const qs = new URLSearchParams({ desde, hasta }).toString();

  return (
    <HojaDocumento
      titulo="Detalle de liquidación"
      emisor={{ nombre: courier.razon_social as string, rut: courier.rut as string }}
      receptor={{
        nombre: conductor.nombre_completo as string,
        rut: conductor.rut as string,
      }}
      etiquetaReceptor="Conductor"
      desde={desde}
      hasta={hasta}
      volverA={`/dinero/reporteria?${qs}`}
    >
      {pagadas.length === 0 && reporte.visitas.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay trabajo pagado en este rango.</p>
      ) : (
        <>
          {pagadas.length > 0 ? (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Entregas
              </h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Comuna</TableHead>
                    <TableHead className="text-right">Tarifa</TableHead>
                    <TableHead className="text-right">Ajuste</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagadas.map((f, i) => (
                    <TableRow key={`${f.codigo}-${i}`}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {f.fechaHecho ? formatearFechaCivilCorta(f.fechaHecho) : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-medium">{f.codigo}</TableCell>
                      <TableCell className="text-muted-foreground">{f.comuna}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatearCLP(f.pagoBase ?? 0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {f.pagoAjuste ? formatearCLP(f.pagoAjuste) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatearCLP(f.pagoFinal ?? 0)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-2 text-right text-sm text-muted-foreground">
                {pagadas.length} {pagadas.length === 1 ? "entrega" : "entregas"} ·{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {formatearCLP(totalEntregas)}
                </span>
              </p>
            </section>
          ) : null}

          {reporte.visitas.length > 0 ? (
            <section className="mt-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Visitas a bodega
              </h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Concepto</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reporte.visitas.map((v, i) => (
                    <TableRow key={`${v.fechaHecho}-${i}`}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatearFechaCivilCorta(v.fechaHecho)}
                      </TableCell>
                      <TableCell>{v.concepto}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatearCLP(v.montoFinal)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-2 text-right text-sm text-muted-foreground">
                {reporte.visitas.length} {reporte.visitas.length === 1 ? "visita" : "visitas"} ·{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {formatearCLP(totalVisitas)}
                </span>
              </p>
            </section>
          ) : null}

          <div className="mt-8 flex items-baseline justify-between border-t pt-4">
            <p className="text-sm font-medium">Total a pagar</p>
            <p className="text-xl font-semibold tabular-nums">
              {formatearCLP(totalEntregas + totalVisitas)}
            </p>
          </div>
        </>
      )}
    </HojaDocumento>
  );
}
