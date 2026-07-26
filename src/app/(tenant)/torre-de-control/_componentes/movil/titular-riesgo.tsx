import type { Zona } from "../../_fixture/estado-torre";
import { esRiesgoCritico, palabraDeRiesgo } from "../../_lib/riesgo";
import { numeroTorre } from "../../_lib/formato";

/**
 * Titular de riesgo móvil (README §5, punto 2): una sola zona, la peor.
 * Puntaje en Señal solo si es crítica (el rojo nunca es decorativo).
 */
export function TitularRiesgo({ zona }: { zona: Zona }) {
  const critico = esRiesgoCritico(zona.riesgo);
  const palabra = palabraDeRiesgo(zona.riesgo);

  return (
    <div className="border-b-2 border-tc-chasis bg-tc-papel px-4 py-4">
      <p className="text-[9px] font-extrabold tracking-[0.14em] text-tc-ink-600 uppercase">
        Lo que hay que resolver
      </p>
      <div className="mt-1.5 flex items-start gap-3">
        <span
          className={`tc-num text-[42px] leading-[0.9] font-extrabold tracking-[-0.03em] ${critico ? "text-tc-senal-text" : "text-tc-tinta"}`}
        >
          {zona.riesgo}
        </span>
        <p className="mt-1.5 text-[15px] leading-[1.3] text-tc-tinta">
          <span className="font-extrabold">{zona.nombre}</span> en riesgo {palabra}.
          <br />
          <span className="tc-num text-tc-ink-700">
            {numeroTorre(zona.pedidosPendientes)} pedidos · corte {zona.ventanaCorte.hora}
          </span>
        </p>
      </div>
    </div>
  );
}
