"use client";

/**
 * La tabla de excepciones, con selección múltiple y acciones en lote.
 * =============================================================================
 * Existe porque la bandeja dejó de ser usable de a una. Al cerrar su primer
 * período, un courier se encontró con 109 excepciones; con el volumen real —30
 * paradas por conductor, todos los días— eso solo empeora.
 *
 * -----------------------------------------------------------------------------
 * DOS FORMAS DE SELECCIONAR, Y LA DIFERENCIA IMPORTA
 * -----------------------------------------------------------------------------
 * La casilla del encabezado marca **lo que está en pantalla ahora**, que es lo
 * que la persona puede ver y comprobar. El botón «seleccionar las N filtradas»
 * es otra decisión: marca cosas que no está mirando, así que se pide aparte y
 * dice cuántas son. Fundir las dos en una casilla hace que alguien cierre
 * doscientas excepciones creyendo que cerraba las diez de la pantalla.
 *
 * -----------------------------------------------------------------------------
 * LAS ACCIONES EN LOTE EXIGEN MOTIVO
 * -----------------------------------------------------------------------------
 * La acción individual solo pide comentario para ciertos destinos. En lote es
 * obligatorio siempre: cerrar cien excepciones sin decir por qué deja una
 * bitácora que no le explica nada a quien la lea en tres meses — y cada una de
 * esas cien es una decisión sobre dinero.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { UsuarioInterno } from "@/modules/identidad/consultas";
import type { EstadoEventoConciliacion } from "@/modules/dinero/tipos";
import { FilaEventoConciliacion } from "./fila-evento-conciliacion";
import type { EventoConciliacionUI } from "./tipos-ui";
import { accionTransicionarEnLote, accionAsignarEnLote } from "./actions";
import { TOPE_LOTE } from "./tipos-ui";

/**
 * Los destinos que se ofrecen en lote. NO son todos los legales.
 *
 * Solo los TERMINALES que decide una persona: son los que vacían la bandeja.
 * Mover cien excepciones a `en_analisis` no resuelve nada y llena la bitácora
 * de ruido. `resuelta_auto` queda fuera a propósito — ese lo escribe el sistema
 * cuando la diferencia desaparece sola, y ofrecerlo a mano sería mentir sobre
 * quién lo resolvió.
 *
 * Los tres dicen cosas distintas y el historial las conserva: no es lo mismo
 * «lo arreglé» que «está bien así» que «esto nunca debió estar acá».
 */
const DESTINOS_LOTE: Array<{ valor: EstadoEventoConciliacion; etiqueta: string; ayuda: string }> = [
  {
    valor: "ignorada",
    etiqueta: "Ignorar",
    ayuda: "No correspondía que estuvieran acá. El caso de los pedidos que Rutax nunca gestionó.",
  },
  {
    valor: "resuelta_manual",
    etiqueta: "Marcar como resueltas",
    ayuda: "La diferencia se corrigió: se generó el cobro, se ajustó la liquidación.",
  },
  {
    valor: "aceptada_justificada",
    etiqueta: "Aceptar la diferencia",
    ayuda: "La diferencia es real y está bien que exista. Queda cerrada con su motivo.",
  },
];

const SIN_ASIGNAR = "__sin_asignar__";

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
  const [pendiente, iniciar] = useTransition();
  const [resultado, setResultado] = useState<string | null>(null);

  const todasVisiblesMarcadas = eventos.length > 0 && eventos.every((e) => seleccion.has(e.id));

  const composicion = useMemo(() => {
    const porTipo = new Map<string, number>();
    for (const e of eventos) {
      if (!seleccion.has(e.id)) continue;
      porTipo.set(e.tipoDiferencia, (porTipo.get(e.tipoDiferencia) ?? 0) + 1);
    }
    return [...porTipo.entries()].map(([etiqueta, cantidad]) => ({ etiqueta, cantidad }));
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

  function terminar(r: { aplicados: number; fallidos: number; primerError: string | null }) {
    setSeleccion(new Set());
    setResultado(
      r.fallidos === 0
        ? `Listo: ${r.aplicados} ${r.aplicados === 1 ? "excepción" : "excepciones"}.`
        : `${r.aplicados} aplicadas, ${r.fallidos} no se pudieron. ${r.primerError ?? ""}`,
    );
    router.refresh();
  }

  const ids = [...seleccion];

  return (
    <div className="space-y-3">
      {resultado ? (
        <p className="rounded-md border border-border bg-bg-subtle p-3 text-sm">{resultado}</p>
      ) : null}

      <DataTable>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-10 px-4">
                <Checkbox
                  checked={todasVisiblesMarcadas}
                  onCheckedChange={alternarTodasVisibles}
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

      <BarraSeleccion
        cantidad={seleccion.size}
        composicion={composicion}
        onLimpiar={() => setSeleccion(new Set())}
      >
        <AsignarEnLote
          ids={ids}
          usuariosInternos={usuariosInternos}
          pendiente={pendiente}
          onAplicar={(fn) => iniciar(async () => terminar(await fn()))}
        />
        <CerrarEnLote
          ids={ids}
          pendiente={pendiente}
          onAplicar={(fn) => iniciar(async () => terminar(await fn()))}
        />
      </BarraSeleccion>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Cerrar en lote
// -----------------------------------------------------------------------------

function CerrarEnLote({
  ids,
  pendiente,
  onAplicar,
}: {
  ids: string[];
  pendiente: boolean;
  onAplicar: (fn: () => Promise<{ aplicados: number; fallidos: number; primerError: string | null }>) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [destino, setDestino] = useState<EstadoEventoConciliacion>("ignorada");
  const [motivo, setMotivo] = useState("");

  const elegido = DESTINOS_LOTE.find((d) => d.valor === destino);
  const excede = ids.length > TOPE_LOTE;

  return (
    <PanelAccion
      abierto={abierto}
      onOpenChange={setAbierto}
      disparador={<Button size="sm">Cerrar {ids.length}</Button>}
      titulo={`Cerrar ${ids.length} ${ids.length === 1 ? "excepción" : "excepciones"}`}
      subtitulo={elegido?.ayuda}
      pie={
        <Button
          disabled={pendiente || !motivo.trim()}
          onClick={() => {
            onAplicar(() => accionTransicionarEnLote(ids, destino, motivo));
            setAbierto(false);
            setMotivo("");
          }}
        >
          {pendiente ? "Aplicando…" : "Confirmar"}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="destino-lote">Qué hacer con ellas</Label>
          <Select value={destino} onValueChange={(v) => setDestino(v as EstadoEventoConciliacion)}>
            <SelectTrigger id="destino-lote">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DESTINOS_LOTE.map((d) => (
                <SelectItem key={d.valor} value={d.valor}>
                  {d.etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="motivo-lote">Motivo</Label>
          <Input
            id="motivo-lote"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Pedidos que Rutax no gestionó"
          />
          {/* Obligatorio en lote, a diferencia de la acción individual. Queda en
              la bitácora de cada una de las N, con tu nombre. */}
          <p className="text-sm text-fg-muted">
            Se guarda en el historial de cada una, a tu nombre. Sin esto, dentro de tres meses
            nadie va a saber por qué se cerraron.
          </p>
        </div>

        {excede ? (
          <p className="text-sm text-warning">
            Se van a aplicar las primeras {TOPE_LOTE}. Repite la operación para el resto.
          </p>
        ) : null}
      </div>
    </PanelAccion>
  );
}

// -----------------------------------------------------------------------------
// Asignar en lote
// -----------------------------------------------------------------------------

function AsignarEnLote({
  ids,
  usuariosInternos,
  pendiente,
  onAplicar,
}: {
  ids: string[];
  usuariosInternos: UsuarioInterno[];
  pendiente: boolean;
  onAplicar: (fn: () => Promise<{ aplicados: number; fallidos: number; primerError: string | null }>) => void;
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
          disabled={pendiente}
          onClick={() => {
            onAplicar(() =>
              accionAsignarEnLote(ids, responsable === SIN_ASIGNAR ? null : responsable),
            );
            setAbierto(false);
          }}
        >
          {pendiente ? "Asignando…" : "Confirmar"}
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
