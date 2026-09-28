"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DistintivoEstado, EtiquetaProcedencia } from "@/components/ui/distintivo-estado";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { cn } from "@/lib/utils";

/**
 * La vitrina del hero: un pedido entra, se asigna, se entrega y deja escritas
 * sus dos líneas de dinero. Es el motor entrega→dinero en cuatro segundos.
 *
 * Corre UNA vez al entrar en pantalla y descansa en el estado final. El HTML del
 * servidor ya trae ese estado final, así que sin JS —o con movimiento reducido—
 * se ve el resultado completo, no una tabla a medio llenar.
 */

type Fase = "sin_asignar" | "en_ruta" | "entregado" | "cuadrado";

const ESTADO: Record<Exclude<Fase, "cuadrado">, { tono: "neutral" | "progress" | "balanced"; texto: string }> = {
  sin_asignar: { tono: "neutral", texto: "Sin asignar" },
  en_ruta: { tono: "progress", texto: "En ruta" },
  entregado: { tono: "balanced", texto: "Entregado" },
};

export function VitrinaPedidos() {
  const [fase, setFase] = useState<Fase>("cuadrado");
  const ref = useRef<HTMLElement>(null);
  const timers = useRef<number[]>([]);

  const correr = useCallback(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    timers.current.forEach(clearTimeout);
    setFase("sin_asignar");
    timers.current = [
      window.setTimeout(() => setFase("en_ruta"), 1400),
      window.setTimeout(() => setFase("entregado"), 2800),
      window.setTimeout(() => setFase("cuadrado"), 3600),
    ];
  }, []);

  useEffect(() => {
    const nodo = ref.current;
    if (!nodo || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          io.disconnect();
          correr();
        }
      },
      { threshold: 0.5 }
    );
    io.observe(nodo);
    const pendientes = timers.current;
    return () => {
      io.disconnect();
      pendientes.forEach(clearTimeout);
    };
  }, [correr]);

  const estado = ESTADO[fase === "cuadrado" ? "entregado" : fase];
  const asignado = fase !== "sin_asignar";
  const cuadrado = fase === "cuadrado";

  return (
    <figure
      ref={ref}
      aria-label="Ejemplo con datos de demostración: un pedido se entrega y genera su cobro y su pago"
      className="min-w-0 border border-line border-t-2 border-t-brand bg-bg-raised"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-4 py-3">
        <b className="text-sm font-semibold">Pedidos · hoy</b>
        <span className="font-mono text-[11px] font-medium tracking-[0.12em] text-fg-muted uppercase">
          Datos de demostración
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full sm:min-w-[380px] border-collapse text-[13.5px]">
          <thead>
            <tr className="bg-bg-inset">
              {["Código", "Origen", "Comuna", "Conductor", "Estado"].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className={cn(
                    "border-b border-line-subtle px-3 py-2.5 text-left font-mono text-[9.5px] font-medium tracking-[0.12em] text-fg-muted uppercase",
                    h === "Comuna" && "max-sm:hidden lg:max-xl:hidden",
                    h === "Origen" && "max-sm:hidden"
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="[&_td]:h-11 [&_td]:border-b [&_td]:border-line-subtle [&_td]:px-3 [&_td]:whitespace-nowrap [&_tr:last-child_td]:border-b-0">
            <tr className="bg-[color-mix(in_srgb,var(--rx-accent-deep)_55%,var(--rx-bg-raised))]">
              <td className="rx-num font-mono text-[12.5px]">45872019334</td>
              <td className="max-sm:hidden"><EtiquetaProcedencia procedencia="FLEX" /></td>
              <td className="max-sm:hidden lg:max-xl:hidden">Ñuñoa</td>
              <td className={asignado ? undefined : "text-fg-subtle"}>{asignado ? "R. Muñoz" : "—"}</td>
              <td aria-live="polite">
                <DistintivoEstado tono={estado.tono} etiqueta={estado.texto} />
              </td>
            </tr>
            <tr>
              <td className="font-mono text-[12.5px]">RX-7Q4M-2K9D</td>
              <td className="max-sm:hidden"><EtiquetaProcedencia procedencia="SHOP" /></td>
              <td className="max-sm:hidden lg:max-xl:hidden">Providencia</td>
              <td>C. Tapia</td>
              <td><DistintivoEstado tono="progress" etiqueta="En ruta" /></td>
            </tr>
            <tr>
              <td className="rx-num font-mono text-[12.5px]">45871955020</td>
              <td className="max-sm:hidden"><EtiquetaProcedencia procedencia="FLEX" /></td>
              <td className="max-sm:hidden lg:max-xl:hidden">Maipú</td>
              <td className="text-fg-subtle">—</td>
              <td><DistintivoEstado tono="neutral" etiqueta="Sin asignar" /></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className={cn(!cuadrado && "invisible")}>
        <div className="grid grid-cols-2 border-t border-line">
          <LineaDinero rotulo="Cobro al seller" monto={2900} detalle="Casa Nómade SpA" />
          <LineaDinero rotulo="Pago al conductor" monto={1450} detalle="R. Muñoz" className="border-l border-line-subtle" />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line-subtle bg-bg-sunken px-4 py-3 text-[13px] text-fg-muted">
          <DistintivoEstado tono="balanced" etiqueta="Cuadradas" />
          <button
            type="button"
            onClick={correr}
            className="cursor-pointer text-[13px] font-medium text-accent-text underline underline-offset-3"
          >
            Volver a ver
          </button>
        </div>
      </div>
    </figure>
  );
}

function LineaDinero({
  rotulo,
  monto,
  detalle,
  className,
}: {
  rotulo: string;
  monto: number;
  detalle: string;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1 px-4 py-4", className)}>
      <span className="font-mono text-[11px] font-medium tracking-[0.12em] text-fg-muted uppercase">
        {rotulo}
      </span>
      <span className="rx-num font-mono text-[26px] leading-none font-semibold tracking-tight">
        {formatearCLP(monto)}
      </span>
      <span className="text-[12.5px] text-fg-muted">{detalle}</span>
    </div>
  );
}
