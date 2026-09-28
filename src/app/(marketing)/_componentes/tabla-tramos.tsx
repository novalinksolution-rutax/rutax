import { formatearCLP, formatearMiles } from "@/lib/ui/formato-moneda";
import { cn } from "@/lib/utils";

import { MINIMO_MENSUAL_CLP, TRAMOS } from "../_lib/precio";

/** Los tramos de precio, el mínimo mensual y la regla de las entregas efectivas. */
export function TablaTramos({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-ctrl border border-line border-t-2 border-t-brand bg-bg-raised", className)}>
      <table className="w-full border-collapse text-[15px]">
        <caption className="sr-only">Precio por entrega según las entregas del mes</caption>
        <thead>
          <tr className="bg-bg-inset">
            <th scope="col" className="border-b border-line-subtle px-5 py-3 text-left font-mono text-[10.5px] font-medium tracking-[0.12em] text-fg-muted uppercase">
              Entregas del mes
            </th>
            <th scope="col" className="border-b border-line-subtle px-5 py-3 text-right font-mono text-[10.5px] font-medium tracking-[0.12em] text-fg-muted uppercase">
              Por entrega, + IVA
            </th>
          </tr>
        </thead>
        <tbody>
          {TRAMOS.map((t) => (
            <tr key={t.desde} className="border-b border-line-subtle last:border-b-0">
              <td className="h-14 px-5">
                {t.hasta === null
                  ? `${formatearMiles(t.desde)} o más`
                  : `${formatearMiles(t.desde)} a ${formatearMiles(t.hasta)}`}
              </td>
              <td className="h-14 px-5 text-right">
                <span className="rx-num font-mono text-[20px] font-semibold">{formatearCLP(t.precio)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-t-2 border-line-strong px-5 py-4 font-semibold">
        <span>Mínimo mensual</span>
        <span className="rx-num font-mono text-[20px]">{formatearCLP(MINIMO_MENSUAL_CLP)}</span>
      </div>
      <p className="border-t border-line-subtle px-5 py-3.5 text-[13.5px] text-fg-muted">
        Solo se cobran las entregas efectivas. Cada entrega paga el precio de su tramo.
      </p>
    </div>
  );
}
