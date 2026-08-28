import Link from "next/link";

import { formatearCLP, formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import { formatearFechaCivilCorta } from "@/lib/formato-cl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FichaFila390 } from "@/components/ui/ficha-fila-390";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ReporteConsolidado } from "@/modules/dinero/reporteria/consolidado";

/**
 * La VISTA de la Reportería, separada de la página que la alimenta.
 * =============================================================================
 *
 * La página hace tres cosas distintas —comprobar permisos, leer la base y
 * dibujar— y solo la tercera es la que se mira en un navegador. Separarla
 * permite montarla con datos de prueba y revisar cómo se comporta en un teléfono
 * sin tener que pasar por el login.
 *
 * No lleva `"use client"` ni lo necesita: es HTML y un formulario `GET`.
 */

export interface DatosVista {
  reporte: ReporteConsolidado | null;
  error: boolean;
  desde: string;
  hasta: string;
  etiquetaPeriodo: string | null;
  entregasCobradas: number;
  entregasPagadas: number;
  /** Los filtros ya serializados, para los enlaces de descarga. */
  qs: string;
}

/**
 * Qué compone el total que se le paga a los conductores.
 *
 * 🔴 El caso de CERO entregas pagadas tiene texto propio, y no es cosmética:
 * «0 entregas más 4 visitas» es la frase que salió en producción y se lee como
 * un error de plural, cuando en realidad está diciendo algo grave — que el total
 * es puro retiro y que **ninguna entrega llegó a tener su pago**. Un dato así no
 * puede depender de que alguien note el cero.
 */
function notaDelPago(entregas: number, visitas: number): string {
  const e = (n: number) => `${n} ${n === 1 ? "entrega" : "entregas"}`;
  const v = (n: number) => `${n} ${n === 1 ? "visita" : "visitas"} a bodega`;
  if (entregas === 0 && visitas === 0) return "Sin pagos en el rango.";
  if (entregas === 0) return `Solo ${v(visitas)}: ninguna entrega tiene su pago.`;
  if (visitas === 0) return `${e(entregas)}. Sin visitas a bodega en el rango.`;
  return `${e(entregas)} más ${v(visitas)}.`;
}

export function VistaReporteria({
  reporte,
  error,
  desde,
  hasta,
  etiquetaPeriodo,
  entregasCobradas,
  entregasPagadas,
  qs: qsTexto,
}: DatosVista) {
  const qs = new URLSearchParams(qsTexto);
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Reportería</h1>
        <p className="text-sm text-muted-foreground">
          El detalle de cada entrega con su cobro al seller y su pago al conductor, en la misma
          fila. Es lo que se necesita para facturar y transferir a mano.
        </p>
      </header>

      {/* 🔴 Sin `Card`. Envuelta en una tarjeta, esta fila era una caja de 90 px
          con tres controles a la izquierda, dos botones a la derecha y medio
          metro de blanco en medio: el recuadro prometía una sección y entregaba
          una barra de herramientas. Sin él, el mismo espacio se lee como lo que
          es —el borde inferior separa igual— y la pantalla arranca 40 px antes,
          que en un reporte es una fila más de datos visible sin desplazarse. */}
      {/* 🔴 La barra de rango, ordenada por lo que hace cada cosa y no por lo
          que cabe. Tres bloques —el rango, la acción que lo aplica, y las dos
          salidas— y en el teléfono cada uno toma su propia línea.

          En una fila corrida con `flex-wrap`, en 375 px los controles caían en
          el orden en que estaban escritos y quedaban tres anchos distintos y un
          botón colgando solo. Acá el rango se parte en DOS MITADES iguales
          —«desde» y «hasta» son un par y se leen comparándolos— y los botones
          de descarga comparten su línea al mismo ancho.

          De `sm` para arriba vuelve a ser una fila: rango y «Ver» a la
          izquierda, descargas a la derecha. */}
      <form method="get" className="space-y-3 border-b pb-4 sm:flex sm:flex-wrap sm:items-end sm:gap-3 sm:space-y-0">
        <div className="flex gap-2 sm:gap-3">
          <div className="flex-1 space-y-1 sm:flex-none">
            <label htmlFor="desde" className="text-xs font-medium text-muted-foreground">
              Desde
            </label>
            <input
              id="desde"
              type="date"
              name="desde"
              defaultValue={desde}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="flex-1 space-y-1 sm:flex-none">
            <label htmlFor="hasta" className="text-xs font-medium text-muted-foreground">
              Hasta
            </label>
            <input
              id="hasta"
              type="date"
              name="hasta"
              defaultValue={hasta}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
        </div>

        <Button type="submit" variant="secondary" className="w-full sm:w-auto">
          Ver
        </Button>

        {etiquetaPeriodo ? (
          <Badge variant="secondary" className="sm:mb-2">
            Período {etiquetaPeriodo}
          </Badge>
        ) : null}

        {/* Excel primero porque es el que abre la PERSONA que factura; el CSV
            queda al lado, en secundario, para quien lo importa a su contable.
            Son dos usos distintos y el mismo archivo no sirve para los dos. */}
        <div className="flex gap-2 sm:ml-auto">
          <Button asChild className="flex-1 sm:flex-none">
            <a href={`/dinero/reporteria/exportar?${qs.toString()}&formato=xlsx`}>
              Descargar Excel
            </a>
          </Button>
          <Button asChild variant="outline" className="flex-1 sm:flex-none">
            <a href={`/dinero/reporteria/exportar?${qs.toString()}`}>CSV</a>
          </Button>
        </div>
      </form>

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
          {/* 🔴 Las cuatro llevan nota, y no por simetría: dos la tenían y dos
              no, así que las dos primeras arrastraban 40 px de blanco para
              igualar altura con las otras. La salida no era quitar las notas
              —explican cifras que se malinterpretan— sino darle a las otras dos
              una que aporte: cuántas entregas hay DETRÁS del monto es lo primero
              que se pregunta quien va a facturar, y evita bajar a contar filas. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Resumen
              titulo="Se le cobra a los sellers"
              valor={formatearCLP(reporte.totalCobro)}
              nota={`${entregasCobradas} ${entregasCobradas === 1 ? "entrega facturable" : "entregas facturables"} en el rango.`}
            />
            <Resumen
              titulo="Se le paga a los conductores"
              valor={formatearCLP(reporte.totalPago)}
              nota={notaDelPago(entregasPagadas, reporte.visitas.length)}
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
                        <TableCell className="font-medium whitespace-normal">{f.etiqueta}</TableCell>
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
                          <TableCell className="font-medium whitespace-normal">
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
                          <TableCell className="font-medium whitespace-normal">
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
                <>
                  {/* 🔴 En el teléfono la fila NO es una tabla encogida. Regla
                      del arquetipo P1, ya escrita en `FichaFila390`: «el
                      teléfono no es una reducción; la fila se convierte en
                      ficha, y nada se esconde, se reacomoda». Medido acá: la
                      tabla son 1.354 px en una ventana de 310 — cuatro
                      pantallas de arrastre lateral para leer una entrega.

                      ⚠️ El corte va en `lg` y no en `sm`: medido en una tablet
                      de 768 px, la tabla seguía pidiendo 1,96× de arrastre. Diez
                      columnas de dinero necesitan un escritorio.
                      El código NUNCA cae (es lo que permite hablar de esta fila
                      con otro) y los montos van al costado, que es lo que se
                      vino a ver. */}
                  <div className="lg:hidden">
                    {reporte.filas.map((f, i) => (
                      <div
                        key={`m-${f.codigo}-${i}`}
                        className="flex items-center gap-3 border-b py-2 last:border-b-0"
                      >
                        <FichaFila390
                          className="flex-1"
                          estado={
                            f.discrepancia === "sin_pago" ? (
                              <Badge variant="destructive">Falta el pago</Badge>
                            ) : f.discrepancia === "sin_cobro" ? (
                              <Badge variant="destructive">Falta el cobro</Badge>
                            ) : f.ajustadoAMano ? (
                              <Badge variant="secondary">Ajustado a mano</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {f.fechaHecho ? formatearFechaCivilCorta(f.fechaHecho) : "—"}
                              </span>
                            )
                          }
                          clasificacion={f.fuenteEtiqueta}
                          titulo={f.codigo}
                          detalle={[f.sellerNombre, f.comuna, f.conductorNombre ?? "sin conductor"]
                            .filter(Boolean)
                            .join(" · ")}
                        />
                        <span className="shrink-0 text-right text-xs tabular-nums">
                          <span className="block font-medium text-foreground">
                            {formatearCLPOGuion(f.cobroFinal)}
                          </span>
                          <span className="block text-muted-foreground">
                            {formatearCLPOGuion(f.pagoFinal)}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>

                <div className="hidden overflow-x-auto lg:block">
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
                          {/* Sin `nowrap`: un nombre largo debe partirse en dos
                              líneas, no empujar la tabla a 1.354 px. */}
                          <TableCell className="whitespace-normal">{f.sellerNombre}</TableCell>
                          <TableCell className="text-muted-foreground">{f.comuna}</TableCell>
                          <TableCell className="whitespace-normal">
                            {f.conductorNombre ?? "—"}
                          </TableCell>
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
                </>
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
                        <TableCell className="whitespace-normal">{v.conductorNombre}</TableCell>
                        <TableCell className="whitespace-normal text-muted-foreground">{v.concepto}</TableCell>
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

