import type { MetricaResumen } from "../../_fixture/estado-torre";
import { porcentajeTorre } from "../../_lib/formato";

/** Métricas del riel: grid 2×2 (README §4). */
export function Metricas({ metricas }: { metricas: MetricaResumen[] }) {
  return (
    <div className="grid shrink-0 grid-cols-2 border-b-2 border-tc-chasis">
      {metricas.map((m, i) => (
        <div
          key={m.id}
          className={[
            "flex flex-col gap-1 px-3.5 py-3",
            i % 2 === 0 ? "border-r border-tc-ink-300" : "",
            i < 2 ? "border-b border-tc-ink-300" : "",
          ].join(" ")}
        >
          <p className="text-[9px] font-extrabold tracking-[0.13em] text-tc-ink-600 uppercase">{m.etiqueta}</p>
          <p className="tc-num text-[22px] leading-none font-extrabold tracking-[-0.03em] whitespace-nowrap text-tc-tinta">
            {m.valor}
          </p>
          <Variacion valor={m.variacionPorcentual} />
          <p className="text-[10px] text-tc-ink-600">{m.detalle}</p>
        </div>
      ))}
    </div>
  );
}

function Variacion({ valor }: { valor: number | null }) {
  if (valor === null) {
    return <p className="tc-num text-[10.5px] font-bold text-tc-ink-500">—</p>;
  }
  const glifo = valor >= 0 ? "▲" : "▼";
  return (
    <p className="tc-num text-[10.5px] font-bold text-tc-tinta">
      <span aria-hidden="true">{glifo}</span> {porcentajeTorre(valor)}
    </p>
  );
}
