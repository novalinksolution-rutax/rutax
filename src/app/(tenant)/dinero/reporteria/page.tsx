import { redirect } from "next/navigation";
import Link from "next/link";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  puedeEmitirFacturas,
  puedeGestionarLiquidacionesConductores,
} from "@/modules/identidad/capacidades";
import { obtenerReporteConsolidado } from "@/modules/dinero/reporteria/consolidado";
import { hoyEnSantiago } from "@/lib/fecha-santiago";
import { formatearCLP, formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import { formatearFechaCivilCorta } from "@/lib/formato-cl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

  const qs = new URLSearchParams({ desde, hasta });
  if (sellerId) qs.set("seller", sellerId);
  if (conductorId) qs.set("conductor", conductorId);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Reportería</h1>
        <p className="text-sm text-muted-foreground">
          El detalle de cada entrega con su cobro al seller y su pago al conductor, en la misma
          fila. Es lo que se necesita para facturar y transferir a mano.
        </p>
      </header>

      <Card>
        <CardContent className="pt-6">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor="desde" className="text-xs font-medium text-muted-foreground">
                Desde
              </label>
              <input
                id="desde"
                type="date"
                name="desde"
                defaultValue={desde}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="hasta" className="text-xs font-medium text-muted-foreground">
                Hasta
              </label>
              <input
                id="hasta"
                type="date"
                name="hasta"
                defaultValue={hasta}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <Button type="submit">Ver</Button>
            {etiquetaPeriodo ? (
              <Badge variant="secondary" className="ml-1">
                Período {etiquetaPeriodo}
              </Badge>
            ) : null}
            <div className="ml-auto">
              <Button asChild variant="outline">
                <a href={`/dinero/reporteria/exportar?${qs.toString()}`}>Exportar CSV</a>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {error || !reporte ? (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="font-medium">No se pudo armar el reporte</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No se alcanzaron a leer las líneas del rango. Vuelve a intentarlo; si sigue igual, es
              un problema de la base y no de tus fechas.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Resumen titulo="Se le cobra a los sellers" valor={formatearCLP(reporte.totalCobro)} />
            <Resumen
              titulo="Se le paga a los conductores"
              valor={formatearCLP(reporte.totalPago)}
            />
            <Resumen
              titulo="Diferencia"
              valor={formatearCLP(reporte.totalCobro - reporte.totalPago)}
              nota="Cobros menos pagos del rango. No es utilidad: no descuenta costos."
            />
            {/* 🔴 La cifra que hay que mirar. Un lado faltante es plata que se
                cobró y no se pagó, o al revés. */}
            <Resumen
              titulo="Filas incompletas"
              valor={String(reporte.conDiscrepancia)}
              destacar={reporte.conDiscrepancia > 0}
              nota={
                reporte.conDiscrepancia > 0
                  ? "Les falta el cobro o el pago. Revísalas antes de facturar."
                  : "Todas las entregas tienen sus dos líneas."
              }
            />
          </div>

          {reporte.porFuente.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Por fuente de los pedidos</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fuente</TableHead>
                      <TableHead className="text-right">Entregas</TableHead>
                      <TableHead className="text-right">Se cobra</TableHead>
                      <TableHead className="text-right">Se paga</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reporte.porFuente.map((f) => (
                      <TableRow key={f.fuente}>
                        <TableCell className="font-medium">{f.etiqueta}</TableCell>
                        <TableCell className="text-right tabular-nums">{f.entregas}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatearCLP(f.totalCobro)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatearCLP(f.totalPago)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Lo que se le factura a cada seller
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    abre su detalle imprimible
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reporte.porSeller.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin cobros en el rango.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Seller</TableHead>
                        <TableHead className="text-right">Entregas</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reporte.porSeller.map((s) => (
                        <TableRow key={s.sellerNombre}>
                          <TableCell className="font-medium">
                            {/* El nombre ES el enlace a su respaldo imprimible.
                                Un botón aparte por fila llenaría la tabla de
                                ruido para la acción más obvia que hay acá. */}
                            {s.sellerId ? (
                              <Link
                                href={`/dinero/reporteria/seller/${s.sellerId}?${qs.toString()}`}
                                className="hover:underline"
                              >
                                {s.sellerNombre}
                              </Link>
                            ) : (
                              s.sellerNombre
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{s.entregas}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatearCLP(s.totalCobro)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Lo que se le transfiere a cada conductor
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    abre su liquidación imprimible
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reporte.porConductor.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin pagos en el rango.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Conductor</TableHead>
                        <TableHead className="text-right">Entregas</TableHead>
                        {/* Las visitas a bodega se pagan aparte de las entregas
                            y por eso van en su propia columna: si se sumaran
                            calladas, el conductor no podría cuadrar su pago. */}
                        <TableHead className="text-right">Visitas</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reporte.porConductor.map((c) => (
                        <TableRow key={c.conductorNombre}>
                          <TableCell className="font-medium">
                            {c.conductorId ? (
                              <Link
                                href={`/dinero/reporteria/conductor/${c.conductorId}?${qs.toString()}`}
                                className="hover:underline"
                              >
                                {c.conductorNombre}
                              </Link>
                            ) : (
                              c.conductorNombre
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {c.entregas}
                            <span className="ml-1 text-xs text-muted-foreground">
                              {formatearCLP(c.totalEntregas)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {c.visitas}
                            <span className="ml-1 text-xs text-muted-foreground">
                              {formatearCLP(c.totalVisitas)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatearCLP(c.totalAPagar)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Detalle de entregas
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {reporte.filas.length} {reporte.filas.length === 1 ? "entrega" : "entregas"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {reporte.filas.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hay entregas en este rango. Prueba con otras fechas: la línea de dinero se
                  genera cuando el pedido queda entregado.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Código</TableHead>
                        <TableHead>Fuente</TableHead>
                        <TableHead>Seller</TableHead>
                        <TableHead>Comuna</TableHead>
                        <TableHead>Conductor</TableHead>
                        <TableHead className="text-right">Se cobra</TableHead>
                        <TableHead className="text-right">Se paga</TableHead>
                        <TableHead className="text-right">Diferencia</TableHead>
                        <TableHead>Nota</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reporte.filas.map((f, i) => (
                        <TableRow key={`${f.codigo}-${i}`}>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {f.fechaHecho ? formatearFechaCivilCorta(f.fechaHecho) : "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap font-medium">
                            {f.codigo}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {f.fuenteEtiqueta}
                          </TableCell>
                          <TableCell>{f.sellerNombre}</TableCell>
                          <TableCell className="text-muted-foreground">{f.comuna}</TableCell>
                          <TableCell>{f.conductorNombre ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatearCLPOGuion(f.cobroFinal)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatearCLPOGuion(f.pagoFinal)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatearCLPOGuion(f.margen)}
                          </TableCell>
                          <TableCell>
                            {/* La fila incompleta se MARCA, no se esconde: es el
                                hallazgo más caro que este reporte entrega. */}
                            {f.discrepancia === "sin_pago" ? (
                              <Badge variant="destructive">Falta el pago</Badge>
                            ) : f.discrepancia === "sin_cobro" ? (
                              <Badge variant="destructive">Falta el cobro</Badge>
                            ) : f.ajustadoAMano ? (
                              <Badge variant="secondary">Ajustado a mano</Badge>
                            ) : f.motivoAjuste ? (
                              <span className="text-xs text-muted-foreground">
                                {f.motivoAjuste}
                              </span>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {reporte.visitas.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Visitas a bodega
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    se le pagan al conductor y no se le cobran al seller
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Conductor</TableHead>
                      <TableHead>Concepto</TableHead>
                      <TableHead className="text-right">Se paga</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reporte.visitas.map((v, i) => (
                      <TableRow key={`${v.fechaHecho}-${i}`}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatearFechaCivilCorta(v.fechaHecho)}
                        </TableCell>
                        <TableCell>{v.conductorNombre}</TableCell>
                        <TableCell className="text-muted-foreground">{v.concepto}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatearCLP(v.montoFinal)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Se recalcula cada vez que entras: lo que ves es lo que hay en las líneas ahora mismo.{" "}
            <Link href="/dinero/conciliacion" className="underline underline-offset-2">
              Conciliación
            </Link>{" "}
            es donde se resuelven las diferencias.
          </p>
        </>
      )}
    </div>
  );
}

function Resumen({
  titulo,
  valor,
  nota,
  destacar,
}: {
  titulo: string;
  valor: string;
  nota?: string;
  destacar?: boolean;
}) {
  return (
    <Card className={destacar ? "border-destructive" : undefined}>
      <CardContent className="pt-6">
        <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
        <p
          className={`mt-1 text-2xl font-semibold tabular-nums ${destacar ? "text-destructive" : ""}`}
        >
          {valor}
        </p>
        {nota ? <p className="mt-1 text-xs text-muted-foreground">{nota}</p> : null}
      </CardContent>
    </Card>
  );
}
