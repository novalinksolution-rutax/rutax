"use client";

/**
 * Panel de la RUTA del manifiesto — etapa 7 de "retiro en bodega + ruteo".
 * =============================================================================
 * Es la pantalla que le faltaba a la etapa: el motor y la escritura de la
 * secuencia estaban construidos y nadie los llamaba.
 *
 * =============================================================================
 * EL REORDENAMIENTO MANUAL ES LA MITAD IMPORTANTE
 * =============================================================================
 * El motor mide en LÍNEA RECTA. En Santiago el Mapocho, la Costanera y Vespucio
 * producen secuencias que sobre el plano real son absurdas, y el motor no lo
 * disimula a propósito. Si el conductor ve uno de esos saltos en su primera
 * ruta, va a ignorar la secuencia para siempre. Por eso aquí corregir a mano no
 * es un extra escondido tras un menú: está al lado de cada parada.
 *
 * Y por eso cada tramo muestra sus metros. En una lista de treinta direcciones
 * el salto absurdo no se ve; un "12,4 km" entre dos paradas seguidas sí. Los
 * tramos se recalculan **en el navegador** mientras el coordinador mueve
 * paradas, con la misma función pura que usa el servidor
 * (`modules/operacion/distancias-tramo.ts`), así que el número que ve mientras
 * arrastra es el mismo que quedará guardado.
 *
 * =============================================================================
 * SIEMPRE SE MANDA LA LISTA COMPLETA, NUNCA UN DELTA
 * =============================================================================
 * `accionGuardarOrdenManual` recibe la secuencia FINAL entera y su posición es
 * el orden. No existe "mover la 5 al lugar 2" como operación de red: un delta
 * obliga a razonar sobre un estado previo que puede haber cambiado bajo los pies
 * del coordinador.
 *
 * =============================================================================
 * `requiereRecarga` NO ES "REINTENTAR"
 * =============================================================================
 * Si la asignación cambió mientras el coordinador ordenaba, el servidor rechaza
 * el lote entero y **la misma lista va a fallar igual**. Un botón de "reintentar"
 * ahí es una trampa: se aprieta tres veces antes de entender que el problema no
 * es la red. Por eso ese caso ofrece RECARGAR y esconde el de guardar.
 *
 * =============================================================================
 * LO QUE NO ESTÁ AQUÍ, Y NO POR OLVIDO
 * =============================================================================
 * El punto de término del conductor. No llega en las props, no se pinta, no
 * entra en los tramos ni en el total, y no hay nada en esta pantalla que
 * permita saber si este conductor lo definió o no — la salida es idéntica en
 * los dos casos. Ver `docs/seguridad/punto-de-termino-conductor.md` §4: bajo
 * subordinación laboral el consentimiento del conductor solo es libre si
 * negarse no queda a la vista del jefe, así que esto es una condición legal,
 * no una cortesía.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  MapPin,
  RotateCcw,
  Route,
  Save,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import type { BadgeVariante } from "@/lib/ui/traduccion-estados";
import { Button } from "@/components/ui/button";
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

import { accionCalcularRuta, accionGuardarOrdenManual } from "./actions-ruta";
import { BotonQuitarPedido } from "./boton-quitar-pedido";

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
  /**
   * El conductor ya la cerró: entregada, fallida o devuelta.
   *
   * Se raya y **pierde sus controles**. Reordenar solo afecta a las pendientes:
   * mover una parada ya entregada no cambia nada en la calle y sí ensucia la
   * secuencia que el conductor está siguiendo.
   */
  cerrada: boolean;
  /** El seller no tiene tarifa vigente: esa entrega no se podría cobrar. */
  sinTarifa?: boolean;
}

interface Props {
  manifiestoId: string;
  /** Paradas YA en el orden en que las devolvió el servidor. */
  paradas: readonly ParadaVista[];
  /** Bodega desde la que arranca la ruta. `null` = ninguna configurada. */
  origen: { nombre: string; lat: number; long: number } | null;
  /** RBAC + el manifiesto no está cerrado. */
  puedeRutear: boolean;
  /** El manifiesto está en borrador y el usuario puede quitar paradas. */
  puedeQuitar: boolean;
}

type Aviso =
  | { tipo: "exito"; texto: string }
  | { tipo: "error"; texto: string; requiereRecarga: boolean };

// =============================================================================
// Componente
// =============================================================================

export function PanelRuta({ manifiestoId, paradas, origen, puedeRutear, puedeQuitar }: Props) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [aviso, setAviso] = useState<Aviso | null>(null);
  /** Minutos desde medianoche en Santiago. Se captura al mover una parada. */
  const [ahoraMin, setAhoraMin] = useState<number | null>(null);

  const porId = useMemo(
    () => new Map(paradas.map((p) => [p.pedidoId, p] as const)),
    [paradas],
  );

  const idsServidor = useMemo(() => paradas.map((p) => p.pedidoId), [paradas]);
  // Clave estable del orden del servidor. Se compara por VALOR y no por
  // identidad del arreglo: `paradas` es una prop nueva en cada render del
  // servidor, y depender de su identidad reiniciaría el orden local en cada
  // `router.refresh()` aunque nada hubiera cambiado.
  const claveServidor = idsServidor.join("|");

  // El orden local se guarda JUNTO a la clave del servidor de la que salió.
  // Cuando el servidor cambia el conjunto o el orden de paradas (se ruteó, se
  // reasignó un pedido, alguien más lo movió), la verdad es la suya: se descarta
  // el orden local. Es deliberado — mostrar un orden que ya no corresponde a las
  // paradas reales es justo lo que produce el rechazo `P0001` al guardar.
  //
  // El ajuste va DURANTE EL RENDER y no en un `useEffect`: es el patrón que
  // React documenta para "estado que se reinicia cuando cambia una prop"
  // (https://react.dev/learn/you-might-not-need-an-effect). Con efecto, el
  // primer pintado usaría el orden viejo y encadenaría un render extra — y la
  // regla de lint del repo lo rechaza, con razón.
  const [estadoOrden, setEstadoOrden] = useState<{ clave: string; ids: string[] }>({
    clave: claveServidor,
    ids: idsServidor,
  });

  if (estadoOrden.clave !== claveServidor) {
    setEstadoOrden({ clave: claveServidor, ids: idsServidor });
  }

  const orden = estadoOrden.clave === claveServidor ? estadoOrden.ids : idsServidor;

  function setOrden(siguiente: string[] | ((actual: string[]) => string[])) {
    setEstadoOrden((previo) => ({
      clave: claveServidor,
      ids: typeof siguiente === "function" ? siguiente(previo.ids) : siguiente,
    }));
  }

  const sucio = orden.join("|") !== claveServidor;

  // --- Tramos, recalculados en vivo sobre el orden LOCAL --------------------
  const enOrden = useMemo(
    () => orden.map((id) => porId.get(id)).filter((p): p is ParadaVista => p !== undefined),
    [orden, porId],
  );

  const tramos = useMemo(
    () => (origen ? distanciasPorTramo(origen, enOrden) : enOrden.map(() => null)),
    [origen, enOrden],
  );

  const totalM = useMemo(() => (origen ? totalDistanciaM(tramos) : null), [origen, tramos]);

  // El orden GUARDADO, medido con la misma función. Es la mitad izquierda del
  // panel de recálculo: sin él, «198,7 km» es un número sin contra qué compararse
  // y el coordinador no puede saber si su cambio mejoró o empeoró la ruta.
  const totalGuardadoM = useMemo(() => {
    if (!origen) return null;
    const enOrdenServidor = idsServidor
      .map((id) => porId.get(id))
      .filter((p): p is ParadaVista => p !== undefined);
    return totalDistanciaM(distanciasPorTramo(origen, enOrdenServidor));
  }, [origen, idsServidor, porId]);

  const paradasAbiertas = useMemo(() => enOrden.filter((p) => !p.cerrada).length, [enOrden]);

  // Índice de la primera parada abierta: la que el conductor tiene por delante.
  // Se calcula sobre el orden LOCAL, así que se mueve mientras se reordena — que
  // es justo lo que hay que ver antes de guardar.
  const indiceSiguiente = useMemo(() => enOrden.findIndex((p) => !p.cerrada), [enOrden]);

  const holgura = useMemo(
    () =>
      ahoraMin === null
        ? null
        : calcularHolguraRuta({
            paradasAbiertas,
            metrosGuardados: totalGuardadoM,
            metrosPropuestos: totalM,
            ahoraMin,
          }),
    [ahoraMin, paradasAbiertas, totalGuardadoM, totalM],
  );

  // Solo las ABIERTAS: una parada ya entregada sin coordenada no es un problema
  // que resolver — el conductor llegó igual. Contarlas dejaría el aviso encendido
  // toda la tarde sobre paquetes que ya están en la puerta de su destinatario.
  const sinCoordenada = useMemo(
    () => enOrden.filter((p) => !p.cerrada && puntoUsable(p.lat, p.long) === null).length,
    [enOrden],
  );

  // --- Movimientos ----------------------------------------------------------

  function moverA(desde: number, hasta: number) {
    setAviso(null);
    // La hora se toma AL MOVER y no durante el render: leer el reloj mientras se
    // pinta hace que el servidor y el navegador dibujen cosas distintas, y acá
    // además es lo correcto de todos modos — cada movimiento re-estima contra el
    // reloj de ese momento.
    setAhoraMin(minutosSantiagoAhora());
    setOrden((actual) => {
      const destino = Math.max(0, Math.min(actual.length - 1, hasta));
      if (desde === destino || desde < 0 || desde >= actual.length) return actual;
      // Una parada cerrada no se mueve. La fila ya no dibuja controles, así que
      // esto es un cinturón: si alguna vez vuelve a haber un camino para
      // llamarlo (un atajo de teclado, un arrastre), sigue sin poder reescribir
      // una entrega que ya ocurrió.
      if (porId.get(actual[desde])?.cerrada) return actual;
      const copia = [...actual];
      const [movida] = copia.splice(desde, 1);
      copia.splice(destino, 0, movida);
      return copia;
    });
  }

  function descartar() {
    setAviso(null);
    setOrden(idsServidor);
  }

  // --- Acciones de servidor -------------------------------------------------

  function calcular() {
    setAviso(null);
    startTransition(async () => {
      const r = await accionCalcularRuta(manifiestoId);
      if (!r.ok) {
        setAviso({
          tipo: "error",
          texto: r.mensaje ?? "No se pudo calcular la ruta.",
          requiereRecarga: r.requiereRecarga === true,
        });
        return;
      }
      const s = r.resumen;
      setAviso({
        tipo: "exito",
        texto: s
          ? `Ruta calculada desde ${s.nombreOrigen}: ${s.totalParadas} parada${s.totalParadas === 1 ? "" : "s"} en secuencia` +
            (s.totalSinSecuencia > 0
              ? `, ${s.totalSinSecuencia} sin ubicar (van al final)`
              : "") +
            (s.distanciaTotalM !== undefined
              ? ` · ${formatearDistancia(s.distanciaTotalM)}`
              : "")
          : "Ruta calculada.",
      });
      router.refresh();
    });
  }

  function guardarOrden() {
    setAviso(null);
    startTransition(async () => {
      const r = await accionGuardarOrdenManual(manifiestoId, orden);
      if (!r.ok) {
        setAviso({
          tipo: "error",
          texto: r.mensaje ?? "No se pudo guardar el orden.",
          requiereRecarga: r.requiereRecarga === true,
        });
        return;
      }
      setAviso({ tipo: "exito", texto: "Orden guardado. El conductor ya lo ve así." });
      router.refresh();
    });
  }

  // --- Render ---------------------------------------------------------------

  const hayParadas = enOrden.length > 0;

  return (
    <section aria-labelledby="ruta-titulo" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="ruta-titulo" className="text-base font-semibold">
            Ruta del conductor{" "}
            <span className="font-normal text-muted-foreground">({enOrden.length})</span>
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

        {puedeRutear && (
          <div className="flex flex-wrap items-center gap-2">
            {sucio ? (
              <>
                <Button variant="ghost" size="sm" onClick={descartar} disabled={pendiente}>
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Descartar
                </Button>
                <Button size="sm" onClick={guardarOrden} disabled={pendiente}>
                  <Save className="size-4" aria-hidden="true" />
                  Guardar orden
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={calcular}
                disabled={pendiente || !hayParadas}
              >
                <Route className="size-4" aria-hidden="true" />
                Calcular ruta
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Aviso de resultado. El error de desincronización NO ofrece reintentar. */}
      {aviso && (
        <div
          role={aviso.tipo === "error" ? "alert" : "status"}
          className={
            aviso.tipo === "error"
              ? "flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              : "rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground"
          }
        >
          <span className="flex-1">{aviso.texto}</span>
          {aviso.tipo === "error" && aviso.requiereRecarga && (
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Recargar
            </Button>
          )}
        </div>
      )}

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
            conductor las ve al final. Ordénalas a mano si sabes por dónde caen.
          </p>
        </div>
      )}

      {/* El panel de recálculo: qué cambió, y si eso rompe el turno.
          ------------------------------------------------------------------
          Antes de esto la pantalla mostraba el total nuevo y nada mas. «198,7
          km» no dice si mejoró ni si el conductor alcanza — deja al coordinador
          haciendo de cabeza, a las 15:50, la única cuenta que importa. */}
      {sucio && (
        <div className="space-y-3 rounded-lg border border-line bg-surface-2 px-4 py-3">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="rx-num text-[10px] tracking-[0.12em] text-fg-muted uppercase">
                Orden actual
              </p>
              <p className="rx-num text-base text-fg-muted">
                {totalGuardadoM !== null ? formatearDistancia(totalGuardadoM) : "sin medir"}
              </p>
            </div>
            <div>
              <p className="rx-num text-[10px] tracking-[0.12em] text-fg-muted uppercase">
                Con tu cambio
              </p>
              <p className="rx-num text-base font-medium text-fg">
                {totalM !== null ? formatearDistancia(totalM) : "sin medir"}
                {/* El delta es lo que se lee de un vistazo, y lleva signo
                    siempre: «13,4» sin signo se puede leer como el total. */}
                {totalM !== null && totalGuardadoM !== null && (
                  <span
                    className={
                      totalM > totalGuardadoM
                        ? "ms-2 text-sm text-attention-fg"
                        : totalM < totalGuardadoM
                          ? "ms-2 text-sm text-balanced-fg"
                          : "ms-2 text-sm text-fg-muted"
                    }
                  >
                    {totalM === totalGuardadoM
                      ? "sin cambio"
                      : `${totalM > totalGuardadoM ? "+" : "−"}${formatearDistancia(Math.abs(totalM - totalGuardadoM))}`}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* La frase de holgura. Es lo único de este bloque que responde la
              pregunta real: no «cuántos kilómetros», sino «alcanza». */}
          {holgura && (
            <p className="text-sm leading-relaxed">
              {holgura.margenMin >= 0 ? (
                <>
                  Sigues cerrando antes de las {HORA_CORTE}:00, con{" "}
                  <span className="rx-num text-fg">
                    {formatearDuracionCorta(holgura.margenMin)}
                  </span>{" "}
                  de margen.
                </>
              ) : (
                <span className="text-fault-fg">
                  Con este orden cierras a las{" "}
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
                {holgura.minutosDelCambio !== null && holgura.minutosDelCambio !== 0 && (
                  <>
                    Tu cambio {holgura.minutosDelCambio > 0 ? "agrega" : "ahorra"}{" "}
                    {formatearDuracionCorta(holgura.minutosDelCambio)}.{" "}
                  </>
                )}
                {/* Los supuestos van al lado del número, siempre. Una estimación
                    con los supuestos escondidos se lee como una instrucción —
                    misma regla que el cálculo de conductores de Preparación. */}
                Estimado sobre {paradasAbiertas}{" "}
                {paradasAbiertas === 1 ? "parada abierta" : "paradas abiertas"} a{" "}
                {holgura.supuestos.minutosPorParada} min cada una y{" "}
                {holgura.supuestos.kmhLineaRecta} km/h, con distancias en línea recta.
              </span>
            </p>
          )}

          <p className="text-sm text-fg-muted">
            El conductor sigue viendo el orden anterior hasta que guardes.
          </p>
        </div>
      )}

      <DataTable
        toolbar={
          <span className="rx-num text-sm text-fg-muted">
            {enOrden.length} parada{enOrden.length === 1 ? "" : "s"}
            {/* Lo que se quiere saber mirando la tabla no es cuántas hay: es
                cuántas faltan. */}
            {paradasAbiertas < enOrden.length && (
              <> · {enOrden.length - paradasAbiertas} cerradas</>
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
              {/* `Tramo` se ve TAMBIÉN en móvil, a diferencia de `Dirección` y
                  `F. compromiso`: es el número que hace visible el salto absurdo
                  del ruteo en línea recta, o sea la razón por la que existe el
                  reordenamiento manual. Esconderlo en la pantalla chica dejaría
                  al coordinador reordenando a ciegas. */}
              <TableHead className="px-4 text-right" title="Distancia en línea recta desde la parada anterior">
                Tramo
              </TableHead>
              <TableHead className="px-4">Estado</TableHead>
              {/* DIRECCIÓN antes que DESTINATARIO, y visible siempre: es el
                  orden de la app del conductor, y el que usa quien lee esta
                  tabla para ir siguiendo la ruta. El nombre sirve al llegar; la
                  dirección, para saber a dónde. */}
              <TableHead className="px-4">Dirección</TableHead>
              <TableHead className="hidden px-4 sm:table-cell">Destinatario</TableHead>
              <TableHead className="hidden px-4 md:table-cell">F. compromiso</TableHead>
              {(puedeRutear || puedeQuitar) && (
                <TableHead className="px-4 text-right">
                  <span className="sr-only">Acciones</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {enOrden.map((parada, idx) => {
              const ubicada = puntoUsable(parada.lat, parada.long) !== null;
              // Una parada cerrada es historia: se raya y pierde sus controles.
              // Moverla no cambia nada en la calle y sí ensucia la secuencia que
              // el conductor está siguiendo en ese momento.
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
                      {/* «Siguiente» no es un estado del pedido y por eso no va
                          dentro del distintivo: es la posición en la ruta. Son
                          ejes independientes y mezclarlos produce un distintivo
                          que dice dos cosas a la vez (regla 4). */}
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
                      {/* El reparo va pegado a la comuna que lo provoca: es una
                          entrega que se va a hacer y no se va a poder cobrar. */}
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
                    {/* `fecha_compromiso` es una fecha CIVIL: se escribe con el
                        helper de fechas civiles y no con los de instante, que la
                        correrían un día (medianoche UTC del 24 es el 23 por la
                        tarde en Santiago). Antes salía el ISO crudo. */}
                    {parada.fechaCompromiso
                      ? etiquetaFechaCivilCorta(parada.fechaCompromiso)
                      : "—"}
                  </TableCell>
                  {(puedeRutear || puedeQuitar) && (
                    <TableCell className="px-4">
                      <div className="flex items-center justify-end gap-1">
                        {parada.cerrada && (
                          <span className="text-xs text-fg-muted">Cerrada</span>
                        )}
                        {puedeRutear && !parada.cerrada && (
                          <>
                            <button
                              type="button"
                              onClick={() => moverA(idx, idx - 1)}
                              disabled={pendiente || idx === 0}
                              aria-label={`Subir ${parada.destinatarioDireccion} en la ruta`}
                              className="inline-flex size-12 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 sm:size-9"
                            >
                              <ArrowUp className="size-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moverA(idx, idx + 1)}
                              disabled={pendiente || idx === enOrden.length - 1}
                              aria-label={`Bajar ${parada.destinatarioDireccion} en la ruta`}
                              className="inline-flex size-12 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 sm:size-9"
                            >
                              <ArrowDown className="size-4" aria-hidden="true" />
                            </button>
                            {/* Mover con ▲▼ una parada del lugar 28 al 2 son 26
                                toques. Con treinta paradas eso no es reordenar,
                                es castigar: el campo de posición es el camino
                                real y las flechas quedan para el ajuste fino. */}
                            <input
                              type="number"
                              min={1}
                              max={enOrden.length}
                              defaultValue={idx + 1}
                              key={`${parada.pedidoId}-${idx}`}
                              disabled={pendiente}
                              aria-label={`Posición de ${parada.destinatarioDireccion} en la ruta`}
                              onKeyDown={(e) => {
                                // Enter mueve DIRECTAMENTE, no delegando en un
                                // `blur()`. La versión con blur parece más corta
                                // y depende de que el campo tenga el foco de
                                // verdad, que es justo lo que falla dentro de un
                                // formulario o cuando el foco lo movió otra cosa.
                                if (e.key !== "Enter") return;
                                e.preventDefault();
                                const valor = Number.parseInt(e.currentTarget.value, 10);
                                if (Number.isFinite(valor)) moverA(idx, valor - 1);
                              }}
                              onBlur={(e) => {
                                const valor = Number.parseInt(e.currentTarget.value, 10);
                                if (Number.isFinite(valor)) {
                                  moverA(idx, valor - 1);
                                } else {
                                  // Campo vacío o basura: se repone la posición
                                  // actual. Dejarlo en blanco haría parecer que
                                  // esta parada perdió su lugar en la ruta.
                                  e.currentTarget.value = String(idx + 1);
                                }
                              }}
                              className="h-12 w-14 rounded-md border border-input bg-background px-2 text-center text-sm tabular-nums disabled:opacity-40 sm:h-9"
                            />
                          </>
                        )}
                        {puedeQuitar && !parada.cerrada && (
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

      {!algunaParadaRuteada(enOrden) && hayParadas && (
        <p className="text-sm text-muted-foreground">
          Este manifiesto todavía no tiene ruta calculada: el conductor lo ve ordenado
          alfabéticamente por comuna y dirección.
        </p>
      )}
    </section>
  );
}

/** ¿Hay al menos una parada con secuencia guardada? */
function algunaParadaRuteada(paradas: readonly ParadaVista[]): boolean {
  return paradas.some((p) => p.ruteada);
}
