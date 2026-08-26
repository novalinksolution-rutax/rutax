"use client";

/**
 * La tabla de excepciones, con selección múltiple y asignación en lote.
 * =============================================================================
 * Existe porque la bandeja dejó de ser usable de a una. Al cerrar su primer
 * período, un courier se encontró con 109 excepciones; con el volumen real —30
 * paradas por conductor, todos los días— eso solo empeora.
 *
 * -----------------------------------------------------------------------------
 * DOS FORMAS DE SELECCIONAR, Y LA DIFERENCIA IMPORTA
 * -----------------------------------------------------------------------------
 * La casilla del encabezado marca **lo que está en pantalla ahora**, que es lo
 * que la persona puede ver y comprobar. Fundir eso con un «marcar todas las
 * filtradas» hace que alguien actúe sobre doscientas creyendo que actuaba sobre
 * las diez de la pantalla.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EN LOTE SE ASIGNA. NO SE CIERRA. (decisión del usuario, 2026-08-25)
 * -----------------------------------------------------------------------------
 * Hubo una versión con «cerrar N» y se retiró a propósito. Asignar reparte
 * trabajo: si te equivocas, reasignas. Cerrar decide sobre DINERO —que no se
 * cobre una entrega, que se dé por buena una diferencia— y hacer cien de esas
 * con un clic es demasiada consecuencia para demasiado poca fricción.
 *
 * Cerrar sigue existiendo de a una, en el panel de detalle, que es donde se ve
 * de qué se está cerrando cada caso.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL LOTE VA EN TANDAS, Y ESO ES LO QUE HACE POSIBLE EL CONTADOR
 * -----------------------------------------------------------------------------
 * Asignar cien excepciones no es una llamada: son cien escrituras con su
 * bitácora, y toman su tiempo. Mandarlas en UNA Server Action deja al usuario
 * mirando un botón «Asignando…» sin saber si van diez o noventa, sin nada que
 * hacer salvo recargar para averiguarlo — y recargar a mitad de camino es
 * justamente lo que no queremos que haga.
 *
 * Así que el cliente parte la selección en tandas de `TAMANO_TANDA` y las manda
 * en serie. Cada tanda que vuelve mueve el contador. **El número que se muestra
 * es de filas ya escritas, no una estimación**: si la pestaña se cierra a la
 * mitad, lo que marcaba el contador quedó guardado igual.
 *
 * En serie y no en paralelo a propósito: son escrituras sobre el mismo tenant y
 * el orden de la bitácora importa más que ganar unos segundos.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { DataTable } from "@/components/ui/data-table";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarraSeleccion } from "@/components/ui/barra-seleccion";
import { PanelAccion } from "@/components/ui/panel-accion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { traducirTipoDiferencia } from "@/lib/ui/traduccion-estados";
import type { UsuarioInterno } from "@/modules/identidad/consultas";
import { FilaEventoConciliacion } from "./fila-evento-conciliacion";
import type { EventoConciliacionUI } from "./tipos-ui";
import { accionAsignarEnLote } from "./actions";


const SIN_ASIGNAR = "__sin_asignar__";

/**
 * Cuántas excepciones viajan por llamada.
 *
 * Es un equilibrio entre dos cosas malas: tandas muy chicas multiplican los
 * viajes de red y el contador se vuelve nervioso; tandas muy grandes tardan
 * tanto en volver que el contador se congela y estamos en el problema original.
 * Veinte deja el salto en unos pocos segundos, y queda muy por debajo del tope
 * duro por llamada de la Server Action.
 */
const TAMANO_TANDA = 20;

interface Progreso {
  total: number;
  hechos: number;
  fallidos: number;
  primerError: string | null;
  /** `true` cuando ya no queda nada por mandar: la franja pasa a mostrar el resultado. */
  terminado: boolean;
}

export function TablaConciliacion({
  eventos,
  usuariosInternos,
  usuarioActualId,
  filtroEventoId,
  queryStringFiltros,
}: {
  eventos: EventoConciliacionUI[];
  usuariosInternos: UsuarioInterno[];
  usuarioActualId: string;
  filtroEventoId: string | null;
  queryStringFiltros: string;
}) {
  const router = useRouter();
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [progreso, setProgreso] = useState<Progreso | null>(null);

  const corriendo = progreso !== null && !progreso.terminado;
  const todasVisiblesMarcadas = eventos.length > 0 && eventos.every((e) => seleccion.has(e.id));

  const composicion = useMemo(() => {
    const porTipo = new Map<EventoConciliacionUI["tipoDiferencia"], number>();
    for (const e of eventos) {
      if (!seleccion.has(e.id)) continue;
      porTipo.set(e.tipoDiferencia, (porTipo.get(e.tipoDiferencia) ?? 0) + 1);
    }
    return [...porTipo.entries()].map(([tipo, cantidad]) => ({
      etiqueta: `${cantidad} · ${traducirTipoDiferencia(tipo)}`,
    }));
  }, [eventos, seleccion]);

  function alternar(id: string) {
    setSeleccion((previa) => {
      const nueva = new Set(previa);
      if (nueva.has(id)) nueva.delete(id);
      else nueva.add(id);
      return nueva;
    });
  }

  function alternarTodasVisibles() {
    setSeleccion(todasVisiblesMarcadas ? new Set() : new Set(eventos.map((e) => e.id)));
  }

  /**
   * Manda la selección en tandas y va moviendo el contador con lo que ya se
   * escribió. Además **descuenta de la selección cada tanda que vuelve**: la
   * barra de arriba baja al mismo ritmo, así que hay dos señales de avance y no
   * una — y si algo se cuelga, lo que quedó marcado es exactamente lo que falta.
   */
  async function asignarEnTandas(ids: string[], asignadoA: string | null) {
    let hechos = 0;
    let fallidos = 0;
    let primerError: string | null = null;

    setProgreso({ total: ids.length, hechos: 0, fallidos: 0, primerError: null, terminado: false });

    for (let i = 0; i < ids.length; i += TAMANO_TANDA) {
      const tanda = ids.slice(i, i + TAMANO_TANDA);
      const r = await accionAsignarEnLote(tanda, asignadoA);

      hechos += r.aplicados;
      fallidos += r.fallidos;
      primerError ??= r.primerError;

      setProgreso({ total: ids.length, hechos, fallidos, primerError, terminado: false });
      setSeleccion((previa) => {
        const nueva = new Set(previa);
        for (const id of tanda) nueva.delete(id);
        return nueva;
      });
    }

    setProgreso({ total: ids.length, hechos, fallidos, primerError, terminado: true });
    // Un solo refresco, al final. A mitad de camino desmontaría la tabla y se
    // llevaría el contador consigo.
    router.refresh();
  }

  const ids = [...seleccion];

  return (
    <div className="space-y-3">
      <DataTable>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-10 px-4">
                <Checkbox
                  checked={todasVisiblesMarcadas}
                  onCheckedChange={alternarTodasVisibles}
                  disabled={corriendo}
                  aria-label="Seleccionar todas las de esta pantalla"
                />
              </TableHead>
              <TableHead className="px-4">Categoría / Tipo</TableHead>
              <TableHead className="hidden px-4 sm:table-cell">Estado</TableHead>
              <TableHead className="hidden px-4 md:table-cell">Vence</TableHead>
              <TableHead className="hidden px-4 lg:table-cell">Asignado</TableHead>
              <TableHead className="hidden px-4 xl:table-cell text-right">Diferencia</TableHead>
              <TableHead className="hidden px-4 2xl:table-cell">Seller</TableHead>
              <TableHead className="hidden px-4 2xl:table-cell">Pedido</TableHead>
              <TableHead className="px-4 text-right">
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {eventos.map((evento) => (
              <FilaEventoConciliacion
                key={evento.id}
                evento={evento}
                usuariosInternos={usuariosInternos}
                usuarioActualId={usuarioActualId}
                abrirInicial={filtroEventoId === evento.id}
                queryStringFiltros={queryStringFiltros}
                seleccionada={seleccion.has(evento.id)}
                onAlternarSeleccion={() => alternar(evento.id)}
              />
            ))}
          </TableBody>
        </Table>
      </DataTable>

      {/*
        La franja de avance MANDA sobre la barra de selección mientras hay algo
        corriendo. Las dos son `sticky bottom-0`: apiladas se taparían, y la que
        importa en ese momento es la que dice cuánto falta.
      */}
      {progreso ? (
        <FranjaProgreso progreso={progreso} onCerrar={() => setProgreso(null)} />
      ) : (
        <BarraSeleccion
          cantidad={seleccion.size}
          composicion={composicion}
          onLimpiar={() => setSeleccion(new Set())}
        >
          <AsignarEnLote
            ids={ids}
            usuariosInternos={usuariosInternos}
            onConfirmar={(asignadoA) => void asignarEnTandas(ids, asignadoA)}
          />
        </BarraSeleccion>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// La franja de avance
// -----------------------------------------------------------------------------

/**
 * Vive abajo y pegada, igual que la barra de selección, por la misma razón: en
 * una tabla de cien filas el usuario está scrolleado, y un aviso arriba del todo
 * es un aviso que no se ve.
 *
 * `aria-live="polite"` para que el lector de pantalla anuncie el avance sin
 * interrumpir; sin eso, la operación larga es literalmente muda.
 */
function FranjaProgreso({ progreso, onCerrar }: { progreso: Progreso; onCerrar: () => void }) {
  const { total, hechos, fallidos, primerError, terminado } = progreso;
  const procesadas = hechos + fallidos;
  const porcentaje = total === 0 ? 100 : Math.round((procesadas / total) * 100);

  return (
    <div
      role="region"
      aria-label="Avance de la asignación"
      className="sticky bottom-0 z-20 space-y-2 border border-b-0 border-line border-t-2 border-t-[var(--rx-accent)] bg-bg-raised px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <p aria-live="polite" className="min-w-0 flex-1 text-[13.5px] text-fg">
          {terminado ? (
            <>
              <span className="font-semibold">
                Listo: {hechos.toLocaleString("es-CL")}{" "}
                {hechos === 1 ? "excepción asignada" : "excepciones asignadas"}.
              </span>
              {fallidos > 0 ? (
                <span className="text-attention-fg">
                  {" "}
                  {fallidos.toLocaleString("es-CL")} no se pudieron
                  {primerError ? `: ${primerError}` : "."}
                </span>
              ) : null}
            </>
          ) : (
            <>
              <span className="rx-num font-semibold tabular-nums">
                {procesadas.toLocaleString("es-CL")} de {total.toLocaleString("es-CL")}
              </span>{" "}
              <span className="text-fg-muted">
                asignadas. Puedes quedarte acá: esto avanza solo y lo que ya lleva quedó guardado.
              </span>
              {fallidos > 0 ? (
                <span className="text-attention-fg"> {fallidos} con problema.</span>
              ) : null}
            </>
          )}
        </p>

        {terminado ? (
          <button
            type="button"
            onClick={onCerrar}
            className="inline-flex min-h-target-min shrink-0 items-center gap-1.5 rounded-ctrl px-3 text-[13.5px] text-fg-muted transition-colors duration-quick hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--rx-focus)]"
          >
            <X className="size-4" aria-hidden="true" />
            Cerrar
          </button>
        ) : null}
      </div>

      <Progress value={porcentaje} aria-label={`${porcentaje}% completado`} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Asignar en lote
// -----------------------------------------------------------------------------

function AsignarEnLote({
  ids,
  usuariosInternos,
  onConfirmar,
}: {
  ids: string[];
  usuariosInternos: UsuarioInterno[];
  onConfirmar: (asignadoA: string | null) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [responsable, setResponsable] = useState<string>(SIN_ASIGNAR);

  return (
    <PanelAccion
      abierto={abierto}
      onOpenChange={setAbierto}
      disparador={
        <Button size="sm" variant="outline">
          Asignar
        </Button>
      }
      titulo={`Asignar ${ids.length} ${ids.length === 1 ? "excepción" : "excepciones"}`}
      subtitulo="Quién se hace cargo de resolverlas."
      pie={
        <Button
          onClick={() => {
            onConfirmar(responsable === SIN_ASIGNAR ? null : responsable);
            setAbierto(false);
          }}
        >
          Confirmar
        </Button>
      }
    >
      <div className="space-y-2">
        <Label htmlFor="responsable-lote">Responsable</Label>
        <Select value={responsable} onValueChange={setResponsable}>
          <SelectTrigger id="responsable-lote">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SIN_ASIGNAR}>Sin asignar</SelectItem>
            {usuariosInternos.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.nombreCompleto}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </PanelAccion>
  );
}
