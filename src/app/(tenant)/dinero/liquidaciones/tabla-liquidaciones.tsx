"use client";

/**
 * La tabla de liquidaciones, con la selección adentro.
 * =============================================================================
 *
 * Mismo esqueleto que la de períodos y por las mismas razones: había dos listas
 * del mismo dato —esta tabla, sin casillas, y el checklist del panel de
 * aprobación en lote— y la selección de una no tenía relación con la otra.
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

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { BarraCajones, type Cajon } from "@/components/ui/barra-cajones";
import { BarraSeleccion } from "@/components/ui/barra-seleccion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { formatearCLP, formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import {
  BADGE_ESTADO_LIQUIDACION,
  traducirEstadoLiquidacion,
} from "@/lib/ui/traduccion-estados";
import type { EstadoLiquidacion } from "@/modules/dinero/tipos";
import { CeremoniaLote, type ItemLoteUI } from "../_componentes/ceremonia-lote";
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
  /** Se puede pagar: emitida y sin payout en tránsito. */
  elegiblePago: boolean;
}

export interface ElegiblePago extends ItemLoteUI {
  entregas: number;
  visitas: number;
  conAjustes: boolean;
}

interface Props {
  filas: readonly FilaLiquidacionVista[];
  elegiblesDelFiltro: readonly ElegiblePago[];
  cajones: Cajon[];
  /** «Pago rechazado» cruza los estados: una rechazada sigue siendo `emitida`. */
  cajonTransversal: Cajon;
  cajonActivo: string | null;
  totalFiltrado: number;
  autorNombre: string;
  accionPreflight: (ids: string[]) => Promise<
    | { ok: true; resultado: import("@/modules/dinero/preflight-lote").ResultadoPreflightLote }
    | { ok: false; mensaje: string }
  >;
  accionEmitir: (ids: string[]) => Promise<
    | { ok: true; resultado: import("@/modules/dinero/acciones-lote").ResultadoLote }
    | { ok: false; mensaje: string }
  >;
}

export function TablaLiquidaciones({
  filas,
  elegiblesDelFiltro,
  cajones,
  cajonTransversal,
  cajonActivo,
  totalFiltrado,
  autorNombre,
  accionPreflight,
  accionEmitir,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [ceremoniaAbierta, setCeremoniaAbierta] = useState(false);

  const elegiblesPagina = useMemo(
    () => filas.filter((f) => f.elegiblePago).map((f) => f.id),
    [filas],
  );
  const paginaCompleta =
    elegiblesPagina.length > 0 && elegiblesPagina.every((id) => seleccion.has(id));
  const paginaParcial = !paginaCompleta && elegiblesPagina.some((id) => seleccion.has(id));

  const seleccionados = useMemo(
    () => elegiblesDelFiltro.filter((i) => seleccion.has(i.id)),
    [elegiblesDelFiltro, seleccion],
  );
  const fueraDeSeleccion = elegiblesDelFiltro.filter((i) => !seleccion.has(i.id)).length;

  function alternarFila(id: string) {
    setSeleccion((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  function alternarPagina() {
    setSeleccion((prev) => {
      const s = new Set(prev);
      if (paginaCompleta) elegiblesPagina.forEach((id) => s.delete(id));
      else elegiblesPagina.forEach((id) => s.add(id));
      return s;
    });
  }

  const totalEntregas = seleccionados.reduce((s, i) => s + i.entregas, 0);
  const totalVisitas = seleccionados.reduce((s, i) => s + i.visitas, 0);
  const conAjustes = seleccionados.filter((i) => i.conAjustes).length;
  const totalNeto = seleccionados.reduce((s, i) => s + i.montoClp, 0);

  return (
    <div className="space-y-4">
      <BarraCajones
        cajones={cajones}
        transversal={cajonTransversal}
        activo={cajonActivo}
        total={totalFiltrado}
        onSeleccionar={(clave) => {
          setSeleccion(new Set());
          const siguiente = new URLSearchParams(params.toString());
          if (clave) siguiente.set("estado", clave);
          else siguiente.delete("estado");
          const qs = siguiente.toString();
          router.push(qs ? `${pathname}?${qs}` : pathname);
        }}
      />

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
              <TableHead className="w-10 px-4">
                <Checkbox
                  checked={paginaCompleta ? true : paginaParcial ? "indeterminate" : false}
                  disabled={elegiblesPagina.length === 0}
                  onCheckedChange={alternarPagina}
                  aria-label="Seleccionar las liquidaciones pagables de esta página"
                />
              </TableHead>
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
                  className={seleccion.has(f.id) ? "bg-accent-bg/40" : undefined}
                >
                  <TableCell className="px-4">
                    <Checkbox
                      checked={seleccion.has(f.id)}
                      disabled={!f.elegiblePago}
                      onCheckedChange={() => alternarFila(f.id)}
                      aria-label={`Seleccionar ${f.conductorNombre} · ${f.periodoEtiqueta}`}
                    />
                  </TableCell>

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

      {paginaCompleta && fueraDeSeleccion > 0 ? (
        <p className="text-sm text-fg-muted">
          Están seleccionadas las {elegiblesPagina.length} de esta página.{" "}
          <button
            type="button"
            className="font-medium text-accent-text hover:underline"
            onClick={() => setSeleccion(new Set(elegiblesDelFiltro.map((i) => i.id)))}
          >
            Seleccionar las {elegiblesDelFiltro.length} del filtro completo
          </button>
        </p>
      ) : null}

      <BarraSeleccion
        cantidad={seleccionados.length}
        composicion={[
          { etiqueta: `${totalEntregas.toLocaleString("es-CL")} entregas` },
          // Las visitas solo si las hay: «0 visitas» es una parte de la
          // composición que no compone nada.
          ...(totalVisitas > 0
            ? [{ etiqueta: `${totalVisitas.toLocaleString("es-CL")} visitas` }]
            : []),
          // Las que llevan ajuste se marcan: es lo que uno quiere revisar antes
          // de mandar plata a la cuenta de alguien.
          ...(conAjustes > 0
            ? [{ etiqueta: `${conAjustes} con ajustes`, alerta: true }]
            : []),
          { etiqueta: `neto ${formatearCLP(totalNeto)}` },
        ]}
        onLimpiar={() => setSeleccion(new Set())}
      >
        <Button size="sm" onClick={() => setCeremoniaAbierta(true)}>
          Verificar y emitir{" "}
          {seleccionados.length === 1 ? "el pago" : `los ${seleccionados.length} pagos`}
        </Button>
      </BarraSeleccion>

      <CeremoniaLote
        abierto={ceremoniaAbierta}
        onCerrar={(hubo) => {
          setCeremoniaAbierta(false);
          if (hubo) setSeleccion(new Set());
        }}
        ids={seleccionados.map((i) => i.id)}
        items={seleccionados}
        tipo="pago"
        accionPreflight={accionPreflight}
        accionEmitir={accionEmitir}
      />

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
