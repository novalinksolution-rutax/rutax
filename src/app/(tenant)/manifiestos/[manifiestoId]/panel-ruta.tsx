/**
 * Panel de la RUTA del manifiesto — de solo lectura desde el 2026-09-05.
 * =============================================================================
 * Hasta esa fecha esta pantalla dejaba calcular y reordenar la ruta a mano
 * (`accionCalcularRuta`, `accionGuardarOrdenManual`, ambas retiradas junto con
 * `actions-ruta.ts`). Se retiró a propósito, no por descuido:
 *
 *   · El recálculo dejó de depender de un clic del coordinador. Ahora se
 *     dispara solo en los momentos que de verdad invalidan una secuencia
 *     calculada: iniciar la ruta, agregar un pedido a un manifiesto que ya
 *     salió de `borrador`, y traspasar bultos entre conductores (ver
 *     `modules/operacion/ruta-manifiesto.ts#recalcularRutaTrasCambio`).
 *   · El reordenamiento manual —que SIGUE siendo necesario: el motor mide en
 *     línea recta y el Mapocho, la Costanera y Vespucio producen saltos
 *     absurdos— se mudó a la app del conductor (`api/conductor/manifiesto/ruta`,
 *     acción `mover`). Es quien está en la calle el que ve el salto que el
 *     motor no ve, y es él quien lo corrige, sin depender de avisarle al
 *     coordinador.
 *
 * Lo que queda acá es la lectura: la secuencia tal como la tiene el conductor
 * ahora mismo, sus tramos, y si el turno alcanza a cerrar antes del corte. Todo
 * se mide sobre el orden QUE MANDÓ EL SERVIDOR — no hay estado local que
 * pueda desincronizarse de lo que el conductor ve en su teléfono.
 *
 * `puedeQuitar` es lo único que sigue siendo una acción de esta pantalla:
 * quitar un pedido de un manifiesto en `borrador` es una decisión de
 * ASIGNACIÓN, no de ruta, y no le pertenece a lo que se retiró.
 */

"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { AlertTriangle, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import type { BadgeVariante } from "@/lib/ui/traduccion-estados";
import { DataTable } from "@/components/ui/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  distanciasPorTramo,
  formatearDistancia,
  puntoUsable,
  totalDistanciaM,
} from "@/modules/operacion/distancias-tramo";
import { etiquetaFechaCivilCorta } from "@/lib/ui/rango-fecha";
import {
  calcularHolguraRuta,
  formatearDuracionCorta,
  formatearHoraDeMinutos,
  HORA_CORTE,
  minutosSantiagoAhora,
} from "@/modules/operacion/holgura-ruta";

import { BotonQuitarPedido } from "./boton-quitar-pedido";

// =============================================================================
// El "ahora" de la holgura — hidratación segura (mismo idioma que
// `preparacion/_componentes/reloj-visita.tsx`)
// =============================================================================
//
// `useSyncExternalStore` y no `useState` + `useEffect` con un `setState`
// síncrono: evita a la vez (a) que `react-hooks/set-state-in-effect` marque
// error por llamar `setState` dentro del cuerpo del efecto, y (b) el
// mismatch de hidratación de leer el reloj directo en el render (servidor y
// cliente casi nunca coinciden al segundo). No hace falta re-suscribirse a
// nada: a diferencia del reloj de una visita en vivo, esta estimación no
// necesita actualizarse mientras la pantalla está abierta — una lectura al
// montar alcanza.

/** No hay nada a lo que re-suscribirse: una sola lectura, al hidratar. */
function suscribirNoOp(): () => void {
  return () => {};
}

function leerMinutosAhora(): number | null {
  return minutosSantiagoAhora();
}

/** Durante SSR (y el primer paint de cliente, antes de hidratar) no hay reloj de cliente que leer todavía. */
function leerMinutosEnServidor(): number | null {
  return null;
}

// =============================================================================
// Contrato con la página
// =============================================================================

export interface ParadaVista {
  pedidoId: string;
  asignacionId: string;
  destinatarioNombre: string;
  destinatarioComuna: string;
  destinatarioDireccion: string;
  fechaCompromiso: string | null;
  estadoTexto: string;
  estadoVariante: BadgeVariante;
  /** Coordenada del pedido. `null` = el motor no puede ubicarla. */
  lat: number | null;
  long: number | null;
  /** Si esta parada tiene número de orden guardado (`orden_ruta`). */
  ruteada: boolean;
  /** El conductor ya la cerró: entregada, fallida o devuelta. Se raya. */
  cerrada: boolean;
  /** El seller no tiene tarifa vigente: esa entrega no se podría cobrar. */
  sinTarifa?: boolean;
}

interface Props {
  manifiestoId: string;
  /** Paradas en el orden en que las tiene el conductor ahora mismo. */
  paradas: readonly ParadaVista[];
  /** Bodega desde la que arranca la ruta. `null` = ninguna configurada. */
  origen: { nombre: string; lat: number; long: number } | null;
  /** El manifiesto está en borrador y el usuario puede quitar paradas. */
  puedeQuitar: boolean;
}

// =============================================================================
// Componente
// =============================================================================

export function PanelRuta({ manifiestoId, paradas, origen, puedeQuitar }: Props) {
  // `null` hasta que la hidratación termine es un estado válido: la frase de
  // holgura simplemente no aparece todavía.
  const ahoraMin = useSyncExternalStore(suscribirNoOp, leerMinutosAhora, leerMinutosEnServidor);

  const tramos = useMemo(
    () => (origen ? distanciasPorTramo(origen, paradas) : paradas.map(() => null)),
    [origen, paradas],
  );

  const totalM = useMemo(() => (origen ? totalDistanciaM(tramos) : null), [origen, tramos]);

  const paradasAbiertas = useMemo(() => paradas.filter((p) => !p.cerrada).length, [paradas]);

  // Índice de la primera parada abierta: la que el conductor tiene por delante.
  const indiceSiguiente = useMemo(() => paradas.findIndex((p) => !p.cerrada), [paradas]);

  // Sin "orden propuesto" que comparar, guardado y propuesto son el mismo
  // número: `calcularHolguraRuta` da `minutosDelCambio = 0` en ese caso, y la
  // frase de "tu cambio agrega/ahorra" no se pinta (ver más abajo).
  const holgura = useMemo(
    () =>
      ahoraMin === null
        ? null
        : calcularHolguraRuta({
            paradasAbiertas,
            metrosGuardados: totalM,
            metrosPropuestos: totalM,
            ahoraMin,
          }),
    [ahoraMin, paradasAbiertas, totalM],
  );

  // Solo las ABIERTAS: una parada ya entregada sin coordenada no es un problema
  // que resolver — el conductor llegó igual.
  const sinCoordenada = useMemo(
    () => paradas.filter((p) => !p.cerrada && puntoUsable(p.lat, p.long) === null).length,
    [paradas],
  );

  const hayParadas = paradas.length > 0;

  return (
    <section aria-labelledby="ruta-titulo" className="space-y-3">
      <div>
        <h2 id="ruta-titulo" className="text-base font-semibold">
          Ruta del conductor{" "}
          <span className="font-normal text-muted-foreground">({paradas.length})</span>
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {origen ? (
            <>
              Sale desde <span className="text-foreground">{origen.nombre}</span>
              {totalM !== null && (
                <>
                  {" · "}
                  <span className="tabular-nums text-foreground">
                    {formatearDistancia(totalM)}
                  </span>{" "}
                  en línea recta
                </>
              )}
            </>
          ) : (
            "Sin bodega de origen configurada."
          )}
        </p>
      </div>

      {/* La advertencia de las paradas sin coordenada. No se esconden ni se
          descartan: siguen siendo paquetes que hay que entregar, y perderlas de
          vista aquí es perder un paquete en silencio. */}
      {sinCoordenada > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-muted-foreground">
            {sinCoordenada === 1
              ? "1 parada no tiene ubicación resuelta"
              : `${sinCoordenada} paradas no tienen ubicación resuelta`}
            : el motor no las puede ordenar, así que quedan sin número de ruta y el
            conductor las ve al final.
          </p>
        </div>
      )}

      {/* La frase de holgura: no "cuántos kilómetros", sino "alcanza". */}
      {holgura && hayParadas && (
        <div className="space-y-1 rounded-lg border border-line bg-surface-2 px-4 py-3">
          <p className="text-sm leading-relaxed">
            {holgura.margenMin >= 0 ? (
              <>
                Sigue cerrando antes de las {HORA_CORTE}:00, con{" "}
                <span className="rx-num text-fg">
                  {formatearDuracionCorta(holgura.margenMin)}
                </span>{" "}
                de margen.
              </>
            ) : (
              <span className="text-fault-fg">
                Con este orden cierra a las{" "}
                <span className="rx-num">
                  {formatearHoraDeMinutos(holgura.cierreEstimadoMin).hora}
                </span>
                {formatearHoraDeMinutos(holgura.cierreEstimadoMin).cruzaMedianoche
                  ? " de mañana"
                  : ""}
                , {formatearDuracionCorta(holgura.margenMin)} después del corte.
              </span>
            )}{" "}
            <span className="text-fg-muted">
              Estimado sobre {paradasAbiertas}{" "}
              {paradasAbiertas === 1 ? "parada abierta" : "paradas abiertas"} a{" "}
              {holgura.supuestos.minutosPorParada} min cada una y{" "}
              {holgura.supuestos.kmhLineaRecta} km/h, con distancias en línea recta.
            </span>
          </p>
        </div>
      )}

      <DataTable
        toolbar={
          <span className="rx-num text-sm text-fg-muted">
            {paradas.length} parada{paradas.length === 1 ? "" : "s"}
            {paradasAbiertas < paradas.length && (
              <> · {paradas.length - paradasAbiertas} cerradas</>
            )}
          </span>
        }
      >
        <Table densidad="comfortable" aria-label="Paradas del manifiesto, en orden de ruta">
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="px-4 text-center" title="Orden de visita">
                #
              </TableHead>
              <TableHead className="px-4 text-right" title="Distancia en línea recta desde la parada anterior">
                Tramo
              </TableHead>
              <TableHead className="px-4">Estado</TableHead>
              <TableHead className="px-4">Dirección</TableHead>
              <TableHead className="hidden px-4 sm:table-cell">Destinatario</TableHead>
              <TableHead className="hidden px-4 md:table-cell">F. compromiso</TableHead>
              {puedeQuitar && (
                <TableHead className="px-4 text-right">
                  <span className="sr-only">Acciones</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paradas.map((parada, idx) => {
              const ubicada = puntoUsable(parada.lat, parada.long) !== null;
              const esSiguiente = idx === indiceSiguiente && !parada.cerrada;
              return (
                <TableRow
                  key={parada.pedidoId}
                  className={parada.cerrada ? "rx-inert-row text-fg-muted" : undefined}
                >
                  <TableCell className="px-4 text-center font-semibold tabular-nums text-muted-foreground">
                    {idx + 1}
                  </TableCell>
                  <TableCell className="px-4 text-right tabular-nums text-muted-foreground">
                    {formatearDistancia(tramos[idx] ?? null)}
                  </TableCell>
                  <TableCell className="px-4">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <BadgeEstado variante={parada.estadoVariante} texto={parada.estadoTexto} />
                      {esSiguiente && (
                        <span className="rx-num rounded-sm bg-progress-bg px-1.5 py-0.5 text-[10px] leading-none tracking-[0.1em] text-progress-fg uppercase">
                          Siguiente
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="px-4">
                    <Link
                      href={`/operaciones/${parada.pedidoId}`}
                      className={
                        parada.cerrada
                          ? "font-medium line-through decoration-1 hover:underline"
                          : "font-medium hover:underline"
                      }
                    >
                      {parada.destinatarioDireccion}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {parada.destinatarioComuna}
                      {parada.sinTarifa ? (
                        <span className="text-attention-fg"> · sin tarifa</span>
                      ) : null}
                    </span>
                    {!ubicada && (
                      <Badge variant="outline" className="mt-1 gap-1 align-middle text-xs">
                        <MapPin className="size-3" aria-hidden="true" />
                        Sin ubicación
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden px-4 text-muted-foreground sm:table-cell">
                    {parada.destinatarioNombre}
                  </TableCell>
                  <TableCell className="rx-num hidden px-4 text-muted-foreground md:table-cell">
                    {parada.fechaCompromiso
                      ? etiquetaFechaCivilCorta(parada.fechaCompromiso)
                      : "—"}
                  </TableCell>
                  {puedeQuitar && (
                    <TableCell className="px-4">
                      <div className="flex items-center justify-end gap-1">
                        {parada.cerrada ? (
                          <span className="text-xs text-fg-muted">Cerrada</span>
                        ) : (
                          <BotonQuitarPedido
                            asignacionId={parada.asignacionId}
                            manifiestoId={manifiestoId}
                            nombreDestinatario={parada.destinatarioNombre}
                            direccion={parada.destinatarioDireccion}
                          />
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DataTable>

      {!algunaParadaRuteada(paradas) && hayParadas && (
        <p className="text-sm text-muted-foreground">
          Este manifiesto todavía no tiene ruta calculada: el conductor lo ve ordenado
          alfabéticamente por comuna y dirección hasta que algo la dispare (iniciar la
          ruta, sumarle un pedido, o un traspaso).
        </p>
      )}
    </section>
  );
}

/** ¿Hay al menos una parada con secuencia guardada? */
function algunaParadaRuteada(paradas: readonly ParadaVista[]): boolean {
  return paradas.some((p) => p.ruteada);
}
