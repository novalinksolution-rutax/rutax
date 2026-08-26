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
 * ⚠️ ACÁ HABÍA SELECCIÓN EN TRES NIVELES Y SE RETIRÓ (26-08-2026, decisión del usuario)
 * -----------------------------------------------------------------------------
 * Fila · página · conjunto filtrado, con su ceremonia de emisión en lote. No
 * estaba rota: estaba **cerrada por regla de negocio** —solo se habilitaba sobre
 * un período `cerrado` y sin excepciones bloqueantes—, así que en una cuenta sin
 * períodos cerrados **todas las casillas salían grises** y la función se leía
 * como muerta, sin que la pantalla dijera por qué.
 *
 * Se retiró junto con la misma pieza en Liquidaciones. Emitir sigue existiendo
 * **de a uno**, en el detalle del período (`DialogEmitirFactura`), que es donde
 * se ve de qué se está facturando cada caso — y donde ya vivía la ceremonia de
 * P4 para una acción irreversible ante el SII.
 *
 * El motor de lote (`acciones-lote`, `preflight-lote`, `CeremoniaLote`) queda en
 * el repo sin llamadores: sus únicos dos usos eran esta tabla y la de
 * liquidaciones.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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
import { formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import {
  BADGE_ESTADO_PERIODO,
  BADGE_ESTADO_SII,
  BADGE_ESTADO_COBRO_PERIODO,
  traducirEstadoPeriodoCobro,
  traducirEstadoSiiTexto,
  traducirEstadoCobroPeriodo,
} from "@/lib/ui/traduccion-estados";
import type { EstadoPeriodo, DocumentoDte, EstadoCobroPeriodo } from "@/modules/dinero/tipos";
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

interface Props {
  /** Las filas de ESTA página, ya ordenadas. */
  filas: readonly FilaPeriodoVista[];
  cajones: Cajon[];
  cajonExcluido: Cajon;
  /** El cajón que cruza los estados: «Con problemas». No suma con los demás. */
  cajonTransversal: Cajon;
  cajonActivo: string | null;
  totalFiltrado: number;
  puedeCerrar: boolean;
}

export function TablaPeriodos({
  filas,
  cajones,
  cajonExcluido,
  cajonTransversal,
  cajonActivo,
  totalFiltrado,
  puedeCerrar,
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
        excluido={cajonExcluido}
        transversal={cajonTransversal}
        activo={cajonActivo}
        total={totalFiltrado}
        onSeleccionar={(clave) => {
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

      {/* Atenuar, no tapar: con el panel abierto hay que poder seguir leyendo
          las filas de arriba y abajo, y tocar otra tiene que cambiar el panel. */}
      <ListaAtenuable>
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
              const bloqueado = f.excepcionesBloqueantes > 0;
              return (
                <TableRow
                  key={f.id}
                  // La fila entera abre la vista previa. El manejador se aparta
                  // cuando el clic cayó sobre un control: el enlace del seller y
                  // los botones de acción son suyos, y navegar además desde acá
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
                    // tabla ya está atenuada y un fondo teñido al 55 % no se
                    // distingue de nada.
                    vistaPrevia?.id === f.id &&
                      "[&>td:first-child]:border-l-2 [&>td:first-child]:border-l-brand",
                    /* La trama inerte marca lo que está fuera de juego: el
                       anulado, y el cerrado que no se puede emitir. Un abierto
                       con excepción NO va acá — está muy en juego, y todavía hay
                       tiempo de arreglarlo. */
                    (f.estado === "anulado" || (bloqueado && f.estado === "cerrado")) &&
                      "rx-inert-row",
                    "pointer-coarse:[&>td]:h-row-touch",
                  )}
                >
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
      </ListaAtenuable>

    </div>
  );
}
