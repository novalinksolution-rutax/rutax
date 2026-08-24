"use client";

/**
 * La tabla de períodos, con la selección adentro.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTO ES UN COMPONENTE DE CLIENTE Y ANTES NO HABÍA NINGUNO
 * -----------------------------------------------------------------------------
 * Hasta hoy la pantalla tenía **dos listas del mismo dato**: esta tabla, sin
 * casillas, y el checklist del panel `AprobacionLote` encima. La selección de
 * una no tenía relación con la otra — se podía filtrar la tabla a un seller y
 * facturar, desde el panel, períodos de otro. El tablero tiene una sola lista:
 * casillas en la fila y barra de selección al pie.
 *
 * -----------------------------------------------------------------------------
 * LA FILA BLOQUEADA NACE APAGADA
 * -----------------------------------------------------------------------------
 * Un período `cerrado` con una excepción de conciliación que bloquea la
 * facturación **no se puede emitir**, y hasta hoy eso se descubría recién en el
 * preflight: con la ceremonia abierta y el monto ya escrito en el título. Acá la
 * casilla nace deshabilitada, la fila va en trama inerte y la columna de folio
 * dice cuántas excepciones son, con su enlace.
 *
 * -----------------------------------------------------------------------------
 * DOS DISTINTIVOS Y NO UNO, A PROPÓSITO
 * -----------------------------------------------------------------------------
 * El tablero dibuja el estado de la fila como `Bloqueado`. Pero `bloqueado` no
 * es un estado del período: el período **está cerrado** y además tiene una
 * excepción encima. Son dos ejes independientes, y la regla 4 dice que no se
 * combinan en un distintivo. Así que van dos: `Cerrado` y, al lado, `Bloqueado`.
 * Fundirlos perdería justo el dato que hace falta para arreglarlo.
 *
 * -----------------------------------------------------------------------------
 * SELECCIÓN EN TRES NIVELES
 * -----------------------------------------------------------------------------
 * Fila · página · conjunto filtrado. El tercero importa: el courier factura «los
 * 34 cerrados de agosto», no «los 20 que caben en la página», y sin ese nivel
 * hay que paginar seleccionando de a veinte. La casilla de la cabecera cubre la
 * PÁGINA, y cuando la página está completa aparece la línea que ofrece el resto.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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
  BADGE_ESTADO_PERIODO,
  BADGE_ESTADO_SII,
  BADGE_ESTADO_COBRO_PERIODO,
  traducirEstadoPeriodoCobro,
  traducirEstadoSiiTexto,
  traducirEstadoCobroPeriodo,
} from "@/lib/ui/traduccion-estados";
import type { EstadoPeriodo, DocumentoDte, EstadoCobroPeriodo } from "@/modules/dinero/tipos";
import { CeremoniaLote, type ItemLoteUI } from "../_componentes/ceremonia-lote";
import { DialogCerrarPeriodo } from "./dialog-cerrar-periodo";

export interface FilaPeriodoVista {
  id: string;
  sellerNombre: string;
  /** Segunda línea de la primera columna, junto al período. */
  sellerRut: string | null;
  periodoEtiqueta: string;
  fechaInicio: string;
  fechaFin: string;
  estado: EstadoPeriodo;
  totalLineas: number;
  montoTotalClp: number | null;
  folio: number | null;
  estadoSii: DocumentoDte["estadoSii"] | null;
  estadoCobro: EstadoCobroPeriodo;
  montoPagadoClp: number | null;
  /** Excepciones abiertas que impiden emitir. > 0 apaga la casilla. */
  excepcionesBloqueantes: number;
  tienePdf: boolean;
  tieneXml: boolean;
}

/**
 * Un elegible del conjunto filtrado. Lleva sus líneas encima **a propósito**:
 * la barra declara «427 líneas», y si ese número saliera de las filas visibles,
 * seleccionar el filtro completo daría una composición que cuenta solo la página
 * — un número más chico que el real, justo antes de emitir facturas.
 */
export interface ElegiblePeriodo extends ItemLoteUI {
  lineas: number;
}

interface Props {
  /** Las filas de ESTA página, ya ordenadas. */
  filas: readonly FilaPeriodoVista[];
  /** Todos los elegibles del conjunto filtrado, no solo los de la página. */
  elegiblesDelFiltro: readonly ElegiblePeriodo[];
  cajones: Cajon[];
  cajonExcluido: Cajon;
  /** El cajón que cruza los estados: «Con problemas». No suma con los demás. */
  cajonTransversal: Cajon;
  cajonActivo: string | null;
  totalFiltrado: number;
  puedeCerrar: boolean;
  accionPreflight: (ids: string[]) => Promise<
    { ok: true; resultado: import("@/modules/dinero/preflight-lote").ResultadoPreflightLote } | { ok: false; mensaje: string }
  >;
  accionEmitir: (ids: string[]) => Promise<
    { ok: true; resultado: import("@/modules/dinero/acciones-lote").ResultadoLote } | { ok: false; mensaje: string }
  >;
}

/** Un período se puede facturar si está cerrado y nada lo bloquea. */
function esElegible(f: FilaPeriodoVista): boolean {
  return f.estado === "cerrado" && f.excepcionesBloqueantes === 0;
}

export function TablaPeriodos({
  filas,
  elegiblesDelFiltro,
  cajones,
  cajonExcluido,
  cajonTransversal,
  cajonActivo,
  totalFiltrado,
  puedeCerrar,
  accionPreflight,
  accionEmitir,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [ceremoniaAbierta, setCeremoniaAbierta] = useState(false);

  const elegiblesPagina = useMemo(() => filas.filter(esElegible).map((f) => f.id), [filas]);

  const paginaCompleta =
    elegiblesPagina.length > 0 && elegiblesPagina.every((id) => seleccion.has(id));
  const paginaParcial = !paginaCompleta && elegiblesPagina.some((id) => seleccion.has(id));

  // Cuántos elegibles del filtro quedan fuera de la selección. Es lo que hace
  // posible el tercer nivel: «hay 14 más allá de esta página».
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

  const seleccionados = useMemo(
    () => elegiblesDelFiltro.filter((i) => seleccion.has(i.id)),
    [elegiblesDelFiltro, seleccion],
  );

  // La composición del tablero: «427 líneas · neto $ 1.285.900 · 2 folios».
  const totalLineas = seleccionados.reduce((s, i) => s + i.lineas, 0);
  const totalNeto = seleccionados.reduce((s, i) => s + i.montoClp, 0);

  return (
    <div className="space-y-4">
      <BarraCajones
        cajones={cajones}
        excluido={cajonExcluido}
        transversal={cajonTransversal}
        activo={cajonActivo}
        total={totalFiltrado}
        onSeleccionar={(clave) => {
          // La selección se descarta al cambiar de cajón: los ids elegibles son
          // otros, y arrastrar una selección invisible hacia una ceremonia que
          // nombra montos es exactamente lo que no puede pasar acá.
          setSeleccion(new Set());
          // Se conserva el resto de la URL —el filtro de seller— y se vuelve a
          // la página 1: el cajón cambia el conjunto, así que la página 3 del
          // anterior no significa nada en el nuevo.
          const siguiente = new URLSearchParams(params.toString());
          if (clave) siguiente.set("estado", clave);
          else siguiente.delete("estado");
          siguiente.delete("pagina");
          const qs = siguiente.toString();
          router.push(qs ? `${pathname}?${qs}` : pathname);
        }}
      />

      <DataTable
        toolbar={
          <span className="rx-num text-sm text-fg-muted">
            {filas.length} de {totalFiltrado} período{totalFiltrado === 1 ? "" : "s"}
          </span>
        }
      >
        <Table densidad="comfortable" aria-label="Períodos de cobro">
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-10 px-4">
                <Checkbox
                  checked={paginaCompleta ? true : paginaParcial ? "indeterminate" : false}
                  disabled={elegiblesPagina.length === 0}
                  onCheckedChange={alternarPagina}
                  aria-label="Seleccionar los períodos facturables de esta página"
                />
              </TableHead>
              <TableHead className="px-4">Seller y período</TableHead>
              <TableHead className="px-4">Estado</TableHead>
              <TableHead className="hidden px-4 text-right md:table-cell">Líneas</TableHead>
              {/* Rótulo obligatorio: la cifra es NETA, y sin decirlo alguien
                  la puede leer como el total con impuestos (regla 18). */}
              <TableHead className="px-4 text-right">Neto</TableHead>
              <TableHead className="hidden px-4 lg:table-cell">Folio / SII</TableHead>
              <TableHead className="px-4 text-right">
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filas.map((f) => {
              const elegible = esElegible(f);
              const bloqueado = f.excepcionesBloqueantes > 0;
              return (
                <TableRow
                  key={f.id}
                  data-seleccionada={seleccion.has(f.id) ? "" : undefined}
                  /* La trama inerte marca lo que está fuera de juego: el
                     anulado, y el cerrado que no se puede emitir. Un abierto con
                     excepción NO va acá — está muy en juego, y todavía hay
                     tiempo de arreglarlo. */
                  className={
                    f.estado === "anulado" || (bloqueado && f.estado === "cerrado")
                      ? "rx-inert-row"
                      : seleccion.has(f.id)
                        ? "bg-accent-bg/40"
                        : undefined
                  }
                >
                  <TableCell className="px-4">
                    <Checkbox
                      checked={seleccion.has(f.id)}
                      disabled={!elegible}
                      onCheckedChange={() => alternarFila(f.id)}
                      aria-label={`Seleccionar ${f.sellerNombre} · ${f.periodoEtiqueta}`}
                    />
                  </TableCell>

                  {/* Seller y período en una sola columna: es la identidad de la
                      fila, y separarlos obligaba a leer dos celdas para saber de
                      quién es. El RUT abajo, que es lo que va en la factura. */}
                  <TableCell className="px-4">
                    <EnlaceDetalle
                      href={`/dinero/periodos/${f.id}`}
                      className="font-medium hover:underline"
                    >
                      {f.sellerNombre}
                    </EnlaceDetalle>
                    <span className="rx-num block text-xs text-fg-muted">
                      {f.periodoEtiqueta}
                      {f.sellerRut ? ` · ${f.sellerRut}` : ""}
                    </span>
                  </TableCell>

                  <TableCell className="px-4">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <BadgeEstado
                        variante={BADGE_ESTADO_PERIODO[f.estado]}
                        eje="periodo"
                        valor={f.estado}
                        texto={traducirEstadoPeriodoCobro(f.estado)}
                      />
                      {/* El distintivo de bloqueo aparece donde CAMBIA lo que se
                          puede hacer: en un período cerrado, que es el que se
                          iba a facturar. En uno abierto la excepción existe
                          igual y se ve en la columna de folio — pero gritarlo en
                          seis filas de un seller, cuando todavía no hay nada que
                          emitir, apaga la señal justo donde sí importa. */}
                      {bloqueado && f.estado === "cerrado" ? (
                        <span className="rx-num border border-fault-line bg-fault-bg px-1.5 py-0.5 text-[10px] leading-none tracking-[0.1em] text-fault-fg uppercase">
                          Bloqueado
                        </span>
                      ) : null}
                      {f.estadoCobro !== "no_aplica" ? (
                        <BadgeEstado
                          variante={BADGE_ESTADO_COBRO_PERIODO[f.estadoCobro]}
                          eje="cobro-periodo"
                          valor={f.estadoCobro}
                          texto={traducirEstadoCobroPeriodo(f.estadoCobro)}
                        />
                      ) : null}
                    </span>
                  </TableCell>

                  <TableCell className="rx-num hidden px-4 text-right text-fg-muted md:table-cell">
                    {f.totalLineas}
                  </TableCell>

                  <TableCell className="rx-num px-4 text-right font-medium">
                    {formatearCLPOGuion(f.montoTotalClp)}
                  </TableCell>

                  {/* Folio / SII, y cuando hay bloqueo esta celda dice por qué:
                      es la columna donde uno mira para saber si la factura salió,
                      así que es donde tiene que estar el motivo de que no salga. */}
                  <TableCell className="hidden px-4 lg:table-cell">
                    <span className="flex flex-col items-start gap-1">
                      {f.folio !== null ? (
                        <>
                          <span className="rx-num text-sm">Folio {f.folio}</span>
                          {f.estadoSii ? (
                            <BadgeEstado
                              variante={BADGE_ESTADO_SII[f.estadoSii] ?? "neutral"}
                              eje="sii"
                              valor={f.estadoSii}
                              texto={traducirEstadoSiiTexto(f.estadoSii)}
                            />
                          ) : null}
                        </>
                      ) : !bloqueado ? (
                        <span className="text-fg-muted">—</span>
                      ) : null}
                      {/* La excepción va acá SIEMPRE que exista, tenga folio o
                          no: esta es la columna donde uno mira para saber si la
                          factura salió, así que es donde tiene que estar el
                          motivo de que no salga — o de que haya salido mal. */}
                      {bloqueado ? (
                        <Link
                          href="/dinero/conciliacion?bloqueo=si"
                          className="text-xs font-medium text-fault-fg hover:underline"
                        >
                          {f.excepcionesBloqueantes}{" "}
                          {f.excepcionesBloqueantes === 1 ? "excepción" : "excepciones"} ›
                        </Link>
                      ) : null}
                    </span>
                  </TableCell>

                  <TableCell className="px-4 text-right">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {f.estado === "abierto" && puedeCerrar ? (
                        <DialogCerrarPeriodo
                          periodoId={f.id}
                          sellerNombre={f.sellerNombre}
                          fechaInicio={f.fechaInicio}
                          fechaFin={f.fechaFin}
                          totalLineas={f.totalLineas}
                          montoTotalClp={f.montoTotalClp}
                        />
                      ) : null}
                      {f.tienePdf ? (
                        <Link
                          href={`/dinero/periodos/${f.id}?descargar=pdf`}
                          className="text-xs font-medium text-fg-muted hover:text-fg hover:underline"
                        >
                          PDF
                        </Link>
                      ) : null}
                      {f.tieneXml ? (
                        <Link
                          href={`/dinero/periodos/${f.id}?descargar=xml`}
                          className="text-xs font-medium text-fg-muted hover:text-fg hover:underline"
                        >
                          XML
                        </Link>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DataTable>

      {/* El tercer nivel de selección. Aparece solo cuando la página está
          completa y hay más allá de ella: ofrecerlo antes sería ruido. */}
      {paginaCompleta && fueraDeSeleccion > 0 ? (
        <p className="text-sm text-fg-muted">
          Están seleccionados los {elegiblesPagina.length} de esta página.{" "}
          <button
            type="button"
            className="font-medium text-accent-text hover:underline"
            onClick={() => setSeleccion(new Set(elegiblesDelFiltro.map((i) => i.id)))}
          >
            Seleccionar los {elegiblesDelFiltro.length} del filtro completo
          </button>
        </p>
      ) : null}

      <BarraSeleccion
        cantidad={seleccionados.length}
        composicion={[
          { etiqueta: `${totalLineas.toLocaleString("es-CL")} líneas` },
          { etiqueta: `neto ${formatearCLP(totalNeto)}` },
          {
            etiqueta: `${seleccionados.length} ${seleccionados.length === 1 ? "folio" : "folios"}`,
          },
        ]}
        onLimpiar={() => setSeleccion(new Set())}
      >
        <Button size="sm" onClick={() => setCeremoniaAbierta(true)}>
          Verificar y emitir {seleccionados.length === 1 ? "la factura" : `las ${seleccionados.length}`}
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
        tipo="factura"
        accionPreflight={accionPreflight}
        accionEmitir={accionEmitir}
      />
    </div>
  );
}
