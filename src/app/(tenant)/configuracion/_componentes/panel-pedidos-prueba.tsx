"use client";

/**
 * Panel TEMPORAL de QA — «Crear pedidos same-day de prueba».
 * =============================================================================
 *
 * Elige seller + comuna + cantidad y crea N pedidos same-day de relleno, para
 * tener volumen con que probar asignación, ruteo y el mapa del conductor sin
 * llenar el formulario de alta una y otra vez.
 *
 * El avance es real: la creación va por tandas contra la server action y el
 * contador «X de N» sube con cada pedido ya escrito en base, no con una
 * estimación. Si el seller no tiene tarifa same-day, la primera tanda falla y se
 * muestra el motivo tal cual lo devuelve el alta.
 *
 * Está marcado con borde punteado y rótulo de herramienta de prueba a propósito:
 * no es parte del producto y debe poder quitarse de un archivo.
 */

import { useState } from "react";
import { Loader2, FlaskConical, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { actionCrearSameDayPrueba } from "../acciones-prueba";

/** Igual que el tope por tanda del servidor. */
const TANDA = 5;
const MAX_CANTIDAD = 100;

export function PanelPedidosPrueba({
  sellers,
  comunas,
}: {
  sellers: { id: string; nombre: string }[];
  comunas: readonly string[];
}) {
  const [sellerId, setSellerId] = useState(sellers[0]?.id ?? "");
  const [comuna, setComuna] = useState(comunas[0] ?? "");
  const [cantidad, setCantidad] = useState(5);

  const [corriendo, setCorriendo] = useState(false);
  const [creados, setCreados] = useState(0);
  const [total, setTotal] = useState(0);
  const [resultado, setResultado] = useState<
    { tipo: "ok"; n: number } | { tipo: "error"; mensaje: string; n: number } | null
  >(null);

  const selectClase =
    "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

  async function crear() {
    const n = Math.min(Math.max(1, Math.floor(cantidad || 0)), MAX_CANTIDAD);
    setCorriendo(true);
    setResultado(null);
    setCreados(0);
    setTotal(n);

    let hechos = 0;
    while (hechos < n) {
      const pide = Math.min(TANDA, n - hechos);
      const r = await actionCrearSameDayPrueba(sellerId, comuna, pide);
      hechos += r.creados;
      setCreados(hechos);
      if (!r.ok) {
        setCorriendo(false);
        setResultado({ tipo: "error", mensaje: r.mensaje, n: hechos });
        return;
      }
    }

    setCorriendo(false);
    setResultado({ tipo: "ok", n: hechos });
  }

  const sinSellers = sellers.length === 0;

  return (
    <div className="rounded-lg border border-dashed border-line bg-bg-sunken/40 p-4">
      <div className="flex items-center gap-2">
        <FlaskConical className="size-4 text-fg-muted" aria-hidden="true" />
        <h2 className="font-medium text-fg">Herramienta de prueba · Pedidos same-day</h2>
      </div>
      <p className="mt-1 text-sm text-fg-muted">
        Crea pedidos de relleno para probar asignación, ruteo y el mapa. Temporal — no es parte
        del producto.
      </p>

      {sinSellers ? (
        <p className="mt-3 text-sm text-attention-fg">
          No hay sellers en este courier todavía. Invita uno para poder crear pedidos.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg-muted">Seller</span>
              <select
                className={selectClase}
                value={sellerId}
                onChange={(e) => setSellerId(e.target.value)}
                disabled={corriendo}
              >
                {sellers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg-muted">Comuna</span>
              <select
                className={selectClase}
                value={comuna}
                onChange={(e) => setComuna(e.target.value)}
                disabled={corriendo}
              >
                {comunas.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label className="block sm:w-24">
              <span className="mb-1 block text-xs font-medium text-fg-muted">Cantidad</span>
              <Input
                type="number"
                min={1}
                max={MAX_CANTIDAD}
                value={cantidad}
                onChange={(e) => setCantidad(Number(e.target.value))}
                disabled={corriendo}
              />
            </label>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={crear} disabled={corriendo || !sellerId}>
              {corriendo ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Creando… {creados} de {total}
                </>
              ) : (
                <>Crear pedidos de prueba</>
              )}
            </Button>

            {!corriendo && resultado?.tipo === "ok" ? (
              <span className="flex items-center gap-1.5 text-sm font-medium text-balanced-fg">
                <Check className="size-4" aria-hidden="true" />
                {resultado.n} {resultado.n === 1 ? "pedido creado" : "pedidos creados"} en {comuna}.
              </span>
            ) : null}
          </div>

          {resultado?.tipo === "error" ? (
            <p
              className={cn(
                "text-sm",
                resultado.n > 0 ? "text-attention-fg" : "text-fault-fg",
              )}
            >
              {resultado.n > 0
                ? `Se crearon ${resultado.n} y luego se detuvo: ${resultado.mensaje}`
                : resultado.mensaje}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
