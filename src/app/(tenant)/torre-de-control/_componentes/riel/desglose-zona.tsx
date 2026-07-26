import type { Zona } from "../../_fixture/estado-torre";
import { esRiesgoCritico, palabraDeRiesgo } from "../../_lib/riesgo";
import { clpTorre, numeroConSigno, numeroTorre, unDecimalTorre } from "../../_lib/formato";
import { BarraRiesgo } from "../trama-riesgo";
import { FOCO_ANILLO } from "../../_lib/estilos";

interface Props {
  zona: Zona;
  factorAbierto: string | null;
  onCerrar: () => void;
  onAbrirFactor: (factorId: string) => void;
}

/**
 * Desglose de zona — nivel 2 (README §4). Reemplaza POR COMPLETO la lista de
 * excepciones cuando hay zona seleccionada (regla de producto 1: sin zona
 * seleccionada esto no existe en el DOM — lo garantiza el padre, `Riel`, que
 * ni siquiera monta este componente si no hay `zonaSeleccionada`).
 */
export function DesgloseZona({ zona, factorAbierto, onCerrar, onAbrirFactor }: Props) {
  const critico = esRiesgoCritico(zona.riesgo);
  const palabra = palabraDeRiesgo(zona.riesgo);
  const holgura = zona.capacidadEstimada - zona.pedidosPendientes;

  return (
    <div>
      <div className="flex items-center justify-between bg-tc-tinta px-4 py-2">
        <span className="text-[8.5px] font-extrabold tracking-[0.16em] text-tc-papel uppercase">
          Nivel 2 · por qué
        </span>
        <button
          type="button"
          onClick={onCerrar}
          className={`border border-tc-papel/40 px-2 py-1 text-[10px] font-semibold text-tc-papel hover:border-tc-papel ${FOCO_ANILLO}`}
        >
          Cerrar desglose
        </button>
      </div>

      <div className="flex items-baseline gap-3 px-4 pt-3">
        <span
          className={`tc-num text-[46px] leading-[0.9] font-extrabold tracking-[-0.03em] ${critico ? "text-tc-senal-text" : "text-tc-tinta"}`}
        >
          {zona.riesgo}
        </span>
        <div>
          <p className="text-[18px] font-extrabold text-tc-tinta">{zona.nombre}</p>
          <p className="text-[10px] font-semibold tracking-[0.12em] text-tc-ink-600 uppercase">
            riesgo {palabra}
          </p>
        </div>
      </div>
      <p className="px-4 pt-1 text-[10px] leading-[1.5] text-tc-ink-700">{zona.comunas.join(" · ")}</p>

      <div className="mt-3 grid grid-cols-3 divide-x divide-tc-ink-300 border-y border-tc-ink-300 px-4">
        <CeldaNivel2 etiqueta="Holgura" valor={numeroConSigno(holgura)} senal={holgura < 0} />
        <CeldaNivel2 etiqueta="Corte" valor={zona.ventanaCorte.hora} />
        <CeldaNivel2 etiqueta="Conductores" valor={`${zona.conductoresDisponibles} de ${zona.conductoresAsignados}`} />
      </div>
      <p className="tc-num px-4 py-2 text-[10.5px] text-tc-ink-700">
        {numeroTorre(zona.pedidosPendientes)} pendientes · {numeroTorre(zona.pedidosEntregados)} entregados · capacidad{" "}
        {numeroTorre(zona.capacidadEstimada)} · {clpTorre(zona.montoComprometidoClp)} comprometidos
      </p>

      <p className="px-4 pt-3 pb-1 text-[9px] font-extrabold tracking-[0.13em] text-tc-ink-600 uppercase">
        Seis factores · valor × peso
      </p>
      <div>
        {zona.factores.map((factor) => {
          const abierto = factorAbierto === factor.id;
          const aporte = factor.valor * factor.peso;
          return (
            <div key={factor.id} className="border-t border-tc-ink-300">
              <button
                type="button"
                onClick={() => onAbrirFactor(factor.id)}
                aria-expanded={abierto}
                className={`w-full px-4 py-2.5 text-left hover:bg-tc-inserto ${FOCO_ANILLO}`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="flex items-baseline gap-2">
                    <span className="text-[12px] font-semibold text-tc-tinta">{factor.etiqueta}</span>
                    <span className="text-[9.5px] text-tc-ink-600">
                      peso {Math.round(factor.peso * 100)} %
                    </span>
                  </span>
                  <span className="tc-num w-[30px] shrink-0 text-right text-[16px] font-extrabold text-tc-tinta">
                    {factor.valor}
                  </span>
                </span>
                <span className="mt-1.5 block">
                  <BarraRiesgo valor={factor.valor} alturaPx={7} />
                </span>
                <span className="mt-1 block text-[9.5px] text-tc-ink-600">
                  aporta {unDecimalTorre(aporte)} puntos al total
                </span>
              </button>
              {abierto ? (
                <div className="bg-tc-inserto px-4 py-3">
                  <p className="text-[11px] font-extrabold tracking-wide text-tc-tinta uppercase">
                    {factor.etiqueta} · aporta {unDecimalTorre(aporte)} puntos
                  </p>
                  <p className="mt-1 text-[12px] text-tc-ink-700">{factor.explicacion}</p>
                  <p className="mt-2 text-[10.5px] text-tc-ink-600">
                    El detalle por pedido lo entrega el servidor a partir del geocoding real; hoy el
                    dataset de diseño solo trae este agregado por factor.
                  </p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CeldaNivel2({ etiqueta, valor, senal }: { etiqueta: string; valor: string; senal?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 first:pl-0 last:pr-0">
      <span className="text-[9px] font-bold tracking-[0.08em] text-tc-ink-600 uppercase">{etiqueta}</span>
      <span className={`tc-num text-[16px] font-extrabold ${senal ? "text-tc-senal-text" : "text-tc-tinta"}`}>
        {valor}
      </span>
    </div>
  );
}
