"use client";

/**
 * La tabla de liquidaciones.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * ⚠️ ACÁ HABÍA SELECCIÓN MÚLTIPLE Y SE RETIRÓ (26-08-2026, decisión del usuario)
 * -----------------------------------------------------------------------------
 * No estaba rota: estaba **cerrada por regla de negocio**. La casilla solo se
 * habilitaba sobre una liquidación `emitida` y sin payout en curso, así que en
 * una cuenta donde todas están en borrador **todas salían grises** y la función
 * se leía como muerta, sin que la pantalla dijera por qué.
 *
 * Se retiró en vez de explicarla, junto con la misma pieza en Períodos. Pagar
 * sigue existiendo **de a una**, en el detalle: `DialogEmitirPago` y
 * `DialogMarcarPagada`. Ahí se ve de qué se está pagando cada caso, que es lo
 * que una decisión de dinero necesita tener delante.
 *
 * El motor de lote (`acciones-lote`, `preflight-lote`, `CeremoniaLote`) **se
 * eliminó** junto con esto: sus únicos dos usos eran esta tabla y la de
 * períodos. Está en el historial si alguna vez vuelve a hacer falta.
 *
 * -----------------------------------------------------------------------------
 * LO QUE ES PROPIO DE ESTA PANTALLA
 * -----------------------------------------------------------------------------
 * **La fila se organiza alrededor de la composición y los ajustes.** Una
 * liquidación tiene DOS clases de línea —entregas y visitas a bodega— y el
 * listado mostraba solo el conteo de entregas, sobre una cifra que además pagaba
 * las visitas. Y el bono/penalización viajaban como una segunda línea gris
 * dentro de la celda del monto, donde no se pueden comparar entre filas: si uno
 * entra a esta pantalla es justo para ver a quién se le ajustó algo.
 *
 * **`Rechazado por el banco` es una fila, no una nota al margen.** Antes el
 * rechazo del pago era un párrafo rojo suelto dentro de la celda de acciones,
 * con el texto crudo del proveedor. Ahora tiene su cajón, su distintivo, y el
 * motivo ocupa la columna de composición — que es donde se lee.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { BarraCajones, type Cajon } from "@/components/ui/barra-cajones";
import { DataTable } from "@/components/ui/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EnlaceDetalle } from "@/components/app-shell/enlace-detalle";
import {
  ListaAtenuable,
  useVistaPreviaLateral,
} from "@/components/ui/vista-previa-lateral";
import { cn } from "@/lib/utils";
import { formatearCLP, formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import {
  BADGE_ESTADO_LIQUIDACION,
  traducirEstadoLiquidacion,
} from "@/lib/ui/traduccion-estados";
import type { EstadoLiquidacion } from "@/modules/dinero/tipos";
import { DialogAjustarLiquidacion } from "./dialog-ajustar";
import { DialogEmitirPago } from "./dialog-emitir-pago";
import { DialogMarcarPagada } from "./dialog-marcar-pagada";
import { BotonDescargaPdfLiquidacion } from "./boton-descarga-pdf-liquidacion";

export interface FilaLiquidacionVista {
  id: string;
  driverId: string;
  conductorNombre: string;
  /** `dependiente` / `independiente`: decide si hay retención y qué documento va. */
  tipoRelacion: string | null;
  periodoEtiqueta: string;
  fechaInicio: string;
  fechaFin: string;
  estado: EstadoLiquidacion;
  entregas: number;
  visitas: number;
  montoBaseClp: number | null;
  bonoClp: number;
  penalizacionClp: number;
  notaAjuste: string | null;
  netoClp: number;
  pdfRef: string | null;
  /** Estado del payout más reciente, si hay uno vivo. */
  payoutEstado: string | null;
  /** Frase ya armada del rechazo — el texto crudo del banco, enmarcado. */
  rechazoTexto: string | null;
  /**
      * Se puede pagar: emitida y sin payout en tránsito.
      *
      * Ya no gobierna ninguna casilla —la selección múltiple se retiró— pero
      * sigue decidiendo qué acciones ofrece la fila, que es de donde salió.
      */
  elegiblePago: boolean;
}

interface Props {
  filas: readonly FilaLiquidacionVista[];
  cajones: Cajon[];
  /** «Pago rechazado» cruza los estados: una rechazada sigue siendo `emitida`. */
  cajonTransversal: Cajon;
  cajonActivo: string | null;
  totalFiltrado: number;
  autorNombre: string;
}

export function TablaLiquidaciones({
  filas,
  cajones,
  cajonTransversal,
  cajonActivo,
  totalFiltrado,
  autorNombre,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // `null` si nadie montó el proveedor: la tabla no revienta, solo deja de
  // previsualizar.
  const vistaPrevia = useVistaPreviaLateral();

  return (
    <div className="space-y-4">
      <BarraCajones
        cajones={cajones}
        transversal={cajonTransversal}
        activo={cajonActivo}
        total={totalFiltrado}
        onSeleccionar={(clave) => {
          const siguiente = new URLSearchParams(params.toString());
          if (clave) siguiente.set("estado", clave);
          else siguiente.delete("estado");
          const qs = siguiente.toString();
          router.push(qs ? `${pathname}?${qs}` : pathname);
        }}
      />

      {/* Atenuar, no tapar: con el panel abierto hay que poder seguir leyendo
          las filas de arriba y abajo, y tocar otra tiene que cambiar el panel. */}
      <ListaAtenuable>
      <DataTable
        toolbar={
          <span className="rx-num text-sm text-fg-muted">
            {filas.length} liquidaci{filas.length === 1 ? "ón" : "ones"}
          </span>
        }
      >
        <Table densidad="comfortable" aria-label="Liquidaciones de conductores">
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="px-4">Conductor y período</TableHead>
              <TableHead className="px-4">Estado</TableHead>
              <TableHead className="hidden px-4 md:table-cell">Composición</TableHead>
              <TableHead className="hidden px-4 text-right lg:table-cell">Ajustes (neto)</TableHead>
              {/* Regla 18: la cifra declara qué es. Acá es neto — una
                  liquidación de conductor no lleva IVA. */}
              <TableHead className="px-4 text-right">Neto a pagar</TableHead>
              <TableHead className="px-4 text-right">
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filas.map((f) => {
              const ajusteNeto = f.bonoClp - f.penalizacionClp;
              return (
                <TableRow
                  key={f.id}
                  // La fila entera abre la vista previa. El manejador se aparta
                  // cuando el clic cayó sobre un control: el enlace del conductor
                  // y los botones de acción son suyos, y navegar además desde acá
                  // rompería el clic medio.
                  onClick={(evento) => {
                    if (
                      (evento.target as HTMLElement).closest(
                        "a,button,input,select,[role='button'],[role='menuitem']",
                      )
                    ) {
                      return;
                    }
                    vistaPrevia?.abrir(f.id);
                  }}
                  className={cn(
                    vistaPrevia && "cursor-pointer",
                    // La fila abierta se marca en el borde, no con fondo: la
                    // tabla ya está atenuada y un fondo teñido no se distingue.
                    vistaPrevia?.id === f.id &&
                      "[&>td:first-child]:border-l-2 [&>td:first-child]:border-l-brand",
                    "pointer-coarse:[&>td]:h-row-touch",
                  )}
                >
                  <TableCell className="px-4">
                    <EnlaceDetalle
                      href={`/dinero/liquidaciones/${f.id}`}
                      className="font-medium hover:underline"
                    >
                      {f.conductorNombre}
                    </EnlaceDetalle>
                    <span className="rx-num block text-xs text-fg-muted">
                      {f.periodoEtiqueta}
                      {/* El régimen decide si hay retención y qué documento
                          respalda el pago: se ve acá o hay que abrir la ficha. */}
                      {f.tipoRelacion ? ` · ${f.tipoRelacion}` : ""}
                    </span>
                  </TableCell>

                  <TableCell className="px-4">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <BadgeEstado
                        variante={BADGE_ESTADO_LIQUIDACION[f.estado]}
                        eje="liquidacion"
                        valor={f.estado}
                        texto={traducirEstadoLiquidacion(f.estado)}
                      />
                      {f.rechazoTexto ? (
                        <span className="rx-num border border-fault-line bg-fault-bg px-1.5 py-0.5 text-[10px] leading-none tracking-[0.1em] text-fault-fg uppercase">
                          Rechazado por el banco
                        </span>
                      ) : f.payoutEstado === "pendiente" || f.payoutEstado === "enviado" ? (
                        <Badge variant="info">Pago en proceso</Badge>
                      ) : null}
                    </span>
                  </TableCell>

                  {/* Composición — o el motivo del rechazo, que la reemplaza:
                      cuando una transferencia no salió, cuántas entregas trae la
                      liquidación deja de ser lo que hay que leer. */}
                  <TableCell className="hidden px-4 md:table-cell">
                    {f.rechazoTexto ? (
                      <span className="text-xs leading-snug text-fault-fg">{f.rechazoTexto}</span>
                    ) : (
                      <span className="rx-num text-sm text-fg-muted">
                        {f.entregas} {f.entregas === 1 ? "entrega" : "entregas"}
                        {f.visitas > 0 ? (
                          <> · {f.visitas} {f.visitas === 1 ? "visita" : "visitas"}</>
                        ) : null}
                      </span>
                    )}
                  </TableCell>

                  {/* Ajustes en columna propia: dentro de la celda del monto no
                      se comparan entre filas, y comparar es a lo que se viene. */}
                  <TableCell className="hidden px-4 text-right lg:table-cell">
                    {ajusteNeto === 0 ? (
                      <span className="text-fg-muted">—</span>
                    ) : (
                      <span
                        className={
                          ajusteNeto > 0
                            ? "rx-num text-sm text-balanced-fg"
                            : "rx-num text-sm text-attention-fg"
                        }
                        title={f.notaAjuste ?? undefined}
                      >
                        {ajusteNeto > 0 ? "+" : "−"}
                        {formatearCLP(Math.abs(ajusteNeto))}
                      </span>
                    )}
                  </TableCell>

                  <TableCell className="rx-num px-4 text-right font-medium">
                    {f.montoBaseClp === null ? (
                      <span className="text-fg-muted">—</span>
                    ) : (
                      formatearCLPOGuion(f.netoClp)
                    )}
                  </TableCell>

                  <TableCell className="px-4 text-right">
                    <div className="flex flex-col items-end gap-1.5">
                      {f.estado === "borrador" ? (
                        <DialogAjustarLiquidacion
                          liquidacionId={f.id}
                          montoBaseClp={f.montoBaseClp ?? 0}
                          bonoActual={f.bonoClp}
                          penalizacionActual={f.penalizacionClp}
                          notaActual={f.notaAjuste}
                        />
                      ) : null}
                      {f.estado === "emitida" && f.elegiblePago ? (
                        <>
                          <DialogEmitirPago
                            autorNombre={autorNombre}
                            liquidacionId={f.id}
                            conductorNombre={f.conductorNombre}
                            fechaInicio={f.fechaInicio}
                            fechaFin={f.fechaFin}
                            montoTotalClp={f.montoBaseClp}
                          />
                          <DialogMarcarPagada
                            liquidacionId={f.id}
                            conductorNombre={f.conductorNombre}
                            fechaInicio={f.fechaInicio}
                            fechaFin={f.fechaFin}
                            montoTotalClp={f.montoBaseClp}
                          />
                        </>
                      ) : null}
                      {f.payoutEstado === "confirmado" ? (
                        <Badge variant="success">Pago confirmado</Badge>
                      ) : null}
                      {f.pdfRef ? <BotonDescargaPdfLiquidacion pdfRef={f.pdfRef} /> : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DataTable>
      </ListaAtenuable>

      {filas.length === 0 ? (
        <div className="border border-line bg-bg-sunken px-6 py-12 text-center">
          <p className="text-fg-muted">Ninguna liquidación cae en este cajón.</p>
          <Link
            href="/dinero/liquidaciones"
            className="mt-3 inline-block text-sm font-medium text-accent-text hover:underline"
          >
            Ver todas
          </Link>
        </div>
      ) : null}
    </div>
  );
}
