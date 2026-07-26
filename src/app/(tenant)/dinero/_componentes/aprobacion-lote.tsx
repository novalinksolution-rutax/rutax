"use client";

/**
 * Aprobación por LOTES (§1.4 P1) — componente genérico reutilizado por facturas
 * (períodos) y pagos (liquidaciones).
 *
 * Flujo (selección múltiple ≠ aprobación automática):
 *  1. Selección: checklist de los elementos ELEGIBLES (períodos cerrados /
 *     liquidaciones emitidas).
 *  2. Revisión: corre el preflight consolidado del servidor y muestra el resumen
 *     por elemento (emitible/bloqueado + motivo) y el TOTAL de lo que se emitirá.
 *  3. Confirmación EXPLÍCITA: un botón "Confirmar" que solo emite los elementos
 *     sin bloqueos. Cada uno pasa por su acción individual (RBAC + bitácora +
 *     evento) en el servidor — el lote no salta ningún control.
 *  4. Resultados: éxito/fallo por elemento.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import type { ResultadoPreflightLote } from "@/modules/dinero/preflight-lote";
import type { ResultadoLote } from "@/modules/dinero/acciones-lote";

export interface ItemLoteUI {
  id: string;
  etiqueta: string;
  sub?: string;
  montoClp: number;
}

type RespPreflight = { ok: true; resultado: ResultadoPreflightLote } | { ok: false; mensaje: string };
type RespEmitir = { ok: true; resultado: ResultadoLote } | { ok: false; mensaje: string };

interface Props {
  items: ItemLoteUI[];
  tipo: "factura" | "pago";
  accionPreflight: (ids: string[]) => Promise<RespPreflight>;
  accionEmitir: (ids: string[]) => Promise<RespEmitir>;
}

const TEXTOS = {
  factura: {
    panel: "Facturar en lote",
    revisar: "Revisar y facturar",
    nombreSingular: "factura",
    nombrePlural: "facturas",
    confirmarVerbo: "Emitir",
  },
  pago: {
    panel: "Pagar en lote",
    revisar: "Revisar y pagar",
    nombreSingular: "pago",
    nombrePlural: "pagos",
    confirmarVerbo: "Solicitar",
  },
} as const;

export function AprobacionLote({ items, tipo, accionPreflight, accionEmitir }: Props) {
  const router = useRouter();
  const t = TEXTOS[tipo];

  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [abierto, setAbierto] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<ResultadoPreflightLote | null>(null);
  const [resultado, setResultado] = useState<ResultadoLote | null>(null);

  const mapaItems = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const todosSeleccionados = seleccion.size === items.length && items.length > 0;

  if (items.length === 0) return null;

  function toggle(id: string) {
    setSeleccion((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  function toggleTodos() {
    setSeleccion(todosSeleccionados ? new Set() : new Set(items.map((i) => i.id)));
  }

  function abrirRevision() {
    setError(null);
    setResultado(null);
    setPreflight(null);
    const ids = [...seleccion];
    startTransition(async () => {
      const r = await accionPreflight(ids);
      if (!r.ok) {
        setError(r.mensaje);
        setAbierto(true);
        return;
      }
      setPreflight(r.resultado);
      setAbierto(true);
    });
  }

  function confirmar() {
    if (!preflight) return;
    const idsEmitibles = preflight.items.filter((i) => i.emitible).map((i) => i.id);
    if (idsEmitibles.length === 0) return;
    setError(null);
    startTransition(async () => {
      const r = await accionEmitir(idsEmitibles);
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      setResultado(r.resultado);
      router.refresh();
    });
  }

  function cerrar() {
    setAbierto(false);
    setPreflight(null);
    setResultado(null);
    setError(null);
    if (resultado && resultado.exitosos > 0) setSeleccion(new Set());
  }

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{t.panel}</h2>
          <p className="text-xs text-muted-foreground">
            {items.length} elemento{items.length !== 1 ? "s" : ""} listo
            {items.length !== 1 ? "s" : ""} para aprobar. Selecciona y revisa el resumen antes de confirmar.
          </p>
        </div>
        <Button size="sm" disabled={seleccion.size === 0 || isPending} onClick={abrirRevision}>
          {isPending && !abierto ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          {t.revisar} ({seleccion.size})
        </Button>
      </div>

      <div className="mt-3 border-t pt-3">
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            checked={todosSeleccionados}
            onChange={toggleTodos}
          />
          Seleccionar todos
        </label>
        <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto">
          {items.map((item) => (
            <li key={item.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/40">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input"
                  checked={seleccion.has(item.id)}
                  onChange={() => toggle(item.id)}
                />
                <span className="min-w-0 flex-1 truncate">
                  {item.etiqueta}
                  {item.sub && <span className="ml-1 text-muted-foreground">· {item.sub}</span>}
                </span>
                <span className="tabular-nums font-medium">{formatearCLP(item.montoClp)}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <Dialog open={abierto} onOpenChange={(v) => (v ? setAbierto(true) : cerrar())}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {resultado
                ? "Resultado del lote"
                : `${t.revisar} — resumen consolidado`}
            </DialogTitle>
          </DialogHeader>

          {/* Estado de error del preflight/emisión */}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          {/* Fase RESULTADOS */}
          {resultado ? (
            <div className="space-y-3">
              <p className="text-sm">
                <span className="font-semibold text-success">
                  {resultado.exitosos} emitido{resultado.exitosos !== 1 ? "s" : ""}
                </span>
                {resultado.fallidos > 0 && (
                  <span className="text-destructive">
                    {" · "}
                    {resultado.fallidos} con error
                  </span>
                )}
              </p>
              <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">
                {resultado.resultados.map((r) => (
                  <li key={r.id} className="flex items-start gap-2 rounded-md px-2 py-1">
                    {r.ok ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="truncate">{mapaItems.get(r.id)?.etiqueta ?? r.id}</span>
                      {!r.ok && r.mensaje && (
                        <span className="block text-xs text-destructive">{r.mensaje}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : preflight ? (
            /* Fase REVISIÓN (resumen consolidado) */
            <div className="space-y-3">
              <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
                <span className="font-semibold">{preflight.emitibles}</span> de {preflight.totalItems} se{" "}
                {tipo === "factura" ? "emitirán" : "pagarán"}
                {preflight.bloqueados > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    ({preflight.bloqueados} bloqueado{preflight.bloqueados !== 1 ? "s" : ""})
                  </span>
                )}
                {" · "}
                Total:{" "}
                <span className="font-semibold tabular-nums">
                  {formatearCLP(preflight.totalMontoEmitibleClp)}
                </span>
              </div>
              <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">
                {preflight.items.map((it) => {
                  const meta = mapaItems.get(it.id);
                  const motivoBloqueo =
                    it.error ?? it.preflight?.bloqueos[0]?.titulo ?? null;
                  const advertencias = it.preflight?.advertencias.length ?? 0;
                  return (
                    <li key={it.id} className="flex items-start gap-2 rounded-md px-2 py-1">
                      {it.emitible ? (
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                      ) : (
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="truncate">{meta?.etiqueta ?? it.id}</span>
                        {it.emitible && advertencias > 0 && (
                          <span className="block text-xs text-warning">
                            {advertencias} advertencia{advertencias !== 1 ? "s" : ""} — revisa antes de confirmar
                          </span>
                        )}
                        {!it.emitible && motivoBloqueo && (
                          <span className="block text-xs text-destructive">{motivoBloqueo}</span>
                        )}
                      </span>
                      {it.emitible && (
                        <span className="tabular-nums text-muted-foreground">
                          {formatearCLP(it.montoClp)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {preflight.emitibles === 0 && (
                <p className="text-sm text-destructive">
                  Ningún elemento cumple las condiciones para {tipo === "factura" ? "facturar" : "pagar"}.
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            </div>
          )}

          <DialogFooter>
            {resultado ? (
              <Button onClick={cerrar}>Cerrar</Button>
            ) : (
              <>
                <Button variant="outline" onClick={cerrar} disabled={isPending}>
                  Cancelar
                </Button>
                <Button
                  onClick={confirmar}
                  disabled={isPending || !preflight || preflight.emitibles === 0}
                >
                  {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  {t.confirmarVerbo} {preflight?.emitibles ?? 0}{" "}
                  {(preflight?.emitibles ?? 0) === 1 ? t.nombreSingular : t.nombrePlural}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
