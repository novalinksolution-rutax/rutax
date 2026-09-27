"use client";

/**
 * El listado de períodos, agrupado por lo que pide (rediseño 2026-09-27).
 *
 * Mismo patrón que sellers: grupos en vez de barra de filtros, la fila muestra
 * información —seller, período, total— y las etiquetas solo cuando hay un
 * problema; las acciones van en un ⋯ por fila. En teléfono se dibujan tarjetas
 * y en escritorio la tabla, y CSS elige (el servidor no conoce el ancho).
 *
 * 🔴 «Total con IVA» y no «Neto»: `monto_total_clp` es neto + IVA. Se corrige
 * el rótulo, no la cifra (el desglose está en la ficha).
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { ListaAtenuable, useVistaPreviaLateral } from "@/components/ui/vista-previa-lateral";
import { formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import {
  BADGE_ESTADO_SII,
  BADGE_ESTADO_COBRO_PERIODO,
  traducirEstadoSiiTexto,
  traducirEstadoCobroPeriodo,
} from "@/lib/ui/traduccion-estados";
import { cn } from "@/lib/utils";
import type { DocumentoDte, EstadoCobroPeriodo, EstadoPeriodo } from "@/modules/dinero/tipos";

import { MenuPeriodo } from "./menu-periodo";

export interface FilaPeriodoVista {
  id: string;
  sellerId: string;
  sellerNombre: string;
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
  excepcionesBloqueantes: number;
}

export interface GrupoPeriodos {
  titulo: string;
  filas: FilaPeriodoVista[];
  /** Cuántos hay en total, aunque se muestre una página. */
  total: number;
  plegado?: boolean;
}

const SII_CON_PROBLEMA = new Set(["rechazado", "aceptado_con_discrepancias"]);

/** Solo lo que pide atención. Un período al día no lleva etiquetas. */
function Etiquetas({ f }: { f: FilaPeriodoVista }) {
  return (
    <>
      {f.excepcionesBloqueantes > 0 ? (
        <span className="border border-fault-line bg-fault-bg px-1.5 py-0.5 text-[11px] font-medium text-fault-fg">
          Bloqueado
        </span>
      ) : null}
      {f.estadoSii && SII_CON_PROBLEMA.has(f.estadoSii) ? (
        <BadgeEstado
          variante={BADGE_ESTADO_SII[f.estadoSii] ?? "neutral"}
          eje="sii"
          valor={f.estadoSii}
          texto={traducirEstadoSiiTexto(f.estadoSii)}
        />
      ) : null}
      {f.estado === "facturado" && f.estadoCobro !== "no_aplica" && f.estadoCobro !== "pagado" ? (
        <BadgeEstado
          variante={BADGE_ESTADO_COBRO_PERIODO[f.estadoCobro]}
          eje="cobro-periodo"
          valor={f.estadoCobro}
          texto={traducirEstadoCobroPeriodo(f.estadoCobro)}
        />
      ) : null}
    </>
  );
}

function Menu({ f }: { f: FilaPeriodoVista }) {
  return (
    <MenuPeriodo
      periodo={{
        id: f.id,
        sellerId: f.sellerId,
        sellerNombre: f.sellerNombre,
        estado: f.estado,
        fechaInicio: f.fechaInicio,
        fechaFin: f.fechaFin,
        totalLineas: f.totalLineas,
        montoTotalClp: f.montoTotalClp,
        excepcionesBloqueantes: f.excepcionesBloqueantes,
      }}
    />
  );
}

function Subtitulo({ f }: { f: FilaPeriodoVista }) {
  return (
    <span className="rx-num block truncate text-xs text-fg-muted">
      {f.periodoEtiqueta}
      {f.folio !== null ? ` · folio ${f.folio}` : ""}
    </span>
  );
}

function EncabezadoGrupo({ g, plegable = false }: { g: GrupoPeriodos; plegable?: boolean }) {
  return (
    <p
      className={cn(
        "rx-num flex items-baseline justify-between border-b border-line bg-bg-sunken/60 px-4 text-[10px] font-medium tracking-[0.08em] text-fg-muted uppercase",
        plegable ? "min-h-11 cursor-pointer items-center" : "py-1.5",
      )}
    >
      <span>{g.titulo}</span>
      <span>{plegable ? `${g.total} ›` : g.total}</span>
    </p>
  );
}

export function TablaPeriodos({ grupos }: { grupos: GrupoPeriodos[] }) {
  const vista = useVistaPreviaLateral();

  return (
    <div className="border border-line">
      {/* Teléfono: tarjetas. */}
      <div className="md:hidden">
        {grupos.map((g) => {
          const filas = (
            <ul className="divide-y divide-line-subtle">
              {g.filas.map((f) => (
                <li key={f.id} className="flex items-center gap-2 py-1.5 pr-1 pl-4">
                  <button
                    type="button"
                    onClick={() => vista?.abrir(f.id)}
                    className="flex min-h-11 min-w-0 flex-1 flex-col items-start text-left"
                  >
                    <span className="flex w-full items-baseline justify-between gap-2">
                      <span className="truncate font-medium text-fg">{f.sellerNombre}</span>
                      <span className="rx-num shrink-0 text-sm font-medium">
                        {formatearCLPOGuion(f.montoTotalClp)}
                      </span>
                    </span>
                    <Subtitulo f={f} />
                    <span className="mt-1 flex flex-wrap gap-1.5 empty:hidden">
                      <Etiquetas f={f} />
                    </span>
                  </button>
                  <Menu f={f} />
                </li>
              ))}
            </ul>
          );
          return g.plegado ? (
            <details key={g.titulo} className="group">
              <summary className="list-none [&::-webkit-details-marker]:hidden">
                <EncabezadoGrupo g={g} plegable />
              </summary>
              {filas}
            </details>
          ) : (
            <section key={g.titulo}>
              <EncabezadoGrupo g={g} />
              {filas}
            </section>
          );
        })}
      </div>

      {/* Escritorio: tabla. Atenuar, no tapar, con el panel abierto. */}
      <ListaAtenuable>
        <Table densidad="comfortable" aria-label="Períodos de cobro" className="hidden md:table">
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="px-4">Seller y período</TableHead>
              <TableHead className="px-4" />
              <TableHead className="px-4 text-right">Total con IVA</TableHead>
              <TableHead className="w-12 px-2" />
            </TableRow>
          </TableHeader>
          {grupos.map((g) => (
            <TableBody key={g.titulo}>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="!p-0">
                  <EncabezadoGrupo g={g} />
                </TableCell>
              </TableRow>
              {g.filas.map((f) => (
                <TableRow
                  key={f.id}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a,button,[role='menuitem']")) return;
                    vista?.abrir(f.id);
                  }}
                  className={cn(
                    vista && "cursor-pointer",
                    vista?.id === f.id &&
                      "[&>td:first-child]:border-l-2 [&>td:first-child]:border-l-brand",
                    f.estado === "anulado" && "rx-inert-row",
                    "pointer-coarse:[&>td]:h-row-touch",
                  )}
                >
                  <TableCell className="px-4">
                    <button
                      type="button"
                      onClick={() => vista?.abrir(f.id)}
                      className="text-left font-medium hover:underline"
                    >
                      {f.sellerNombre}
                    </button>
                    <Subtitulo f={f} />
                  </TableCell>
                  <TableCell className="px-4 whitespace-normal">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Etiquetas f={f} />
                    </span>
                  </TableCell>
                  <TableCell className="rx-num px-4 text-right font-medium">
                    {formatearCLPOGuion(f.montoTotalClp)}
                  </TableCell>
                  <TableCell className="px-2 text-right">
                    <Menu f={f} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          ))}
        </Table>
      </ListaAtenuable>
    </div>
  );
}
