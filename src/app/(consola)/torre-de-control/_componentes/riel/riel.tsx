import type {
  Excepcion,
  EstadoPantalla,
  MetricaResumen,
  OlaEntrante,
  Zona,
} from "../../_fixture/estado-torre";
import { Metricas } from "./metricas";
import { FichaExcepcion } from "./ficha-excepcion";
import { DesgloseZona } from "./desglose-zona";
import { numeroTorre } from "../../_lib/formato";
import { fechaCortaSantiago } from "../../_lib/tiempo";

interface Props {
  estado: EstadoPantalla;
  metricas: MetricaResumen[];
  excepciones: Excepcion[];
  zonas: Zona[];
  zonaSeleccionada: string | null;
  factorAbierto: string | null;
  olaEntrante: OlaEntrante | null;
  ahoraIso: string;
  onSeleccionarZona: (zonaId: string) => void;
  onCerrarDesglose: () => void;
  onAbrirFactor: (factorId: string) => void;
}

/**
 * R4/R6 · Riel (README §4, 404 px, único scroll de toda la consola). Apila
 * métricas → excepciones (o el desglose de zona, nivel 2) → señales de
 * prensa. Rama por `estado` para los seis estados de `EstadoPantalla`
 * (§8): `sin_pedidos` reemplaza métricas+excepciones por la preparación de
 * la ola; `tranquilo` deja una sola línea, sin tarjetas de relleno.
 */
export function Riel(props: Props) {
  const {
    estado,
    metricas,
    excepciones,
    zonas,
    zonaSeleccionada,
    factorAbierto,
    olaEntrante,
    ahoraIso,
    onSeleccionarZona,
    onCerrarDesglose,
    onAbrirFactor,
  } = props;

  const zonaActiva = zonaSeleccionada ? zonas.find((z) => z.id === zonaSeleccionada) ?? null : null;

  if (estado === "sin_pedidos") {
    return (
      <div id="detalle" className="tc-rail flex h-full w-[var(--tc-w-riel)] shrink-0 flex-col overflow-y-auto bg-tc-papel">
        {olaEntrante ? (
          <PreparacionOla ola={olaEntrante} />
        ) : (
          /* El handoff da por hecho que en `sin_pedidos` siempre hay una ola que
             preparar. Con datos reales no la hay todavía (el calendario comercial
             es un bloque aparte), y el riel se quedaba en blanco: 300 px de nada,
             sin decir por qué. Nombrar lo que falta es parte del diseño. */
          <div className="p-3.5">
            <p className="text-[9px] font-extrabold tracking-[0.13em] text-tc-ink-600 uppercase">
              Sin nada que preparar
            </p>
            <p className="mt-2 text-[12px] leading-[1.5] text-tc-ink-700">
              No hay pedidos en este horizonte y todavía no hay una ola comercial
              a la vista. El mapa sigue mostrando tus zonas y el contexto de la
              ciudad.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div id="detalle" className="tc-rail flex h-full w-[var(--tc-w-riel)] shrink-0 flex-col overflow-y-auto bg-tc-papel">
      <Metricas metricas={metricas} />

      {zonaActiva ? (
        <DesgloseZona
          zona={zonaActiva}
          factorAbierto={factorAbierto}
          onCerrar={onCerrarDesglose}
          onAbrirFactor={onAbrirFactor}
        />
      ) : excepciones.length === 0 ? (
        <p className="px-3.5 py-4 text-[12px] text-tc-ink-700">
          Sin excepciones abiertas. El riel se queda vacío a propósito.
        </p>
      ) : (
        <div>
          <p className="px-3.5 pt-3 pb-1 text-[9px] font-extrabold tracking-[0.13em] text-tc-ink-600 uppercase">
            Excepciones · ordenadas por severidad
          </p>
          {excepciones.map((excepcion) => (
            <FichaExcepcion
              key={excepcion.id}
              excepcion={excepcion}
              zonaNombre={zonas.find((z) => z.id === excepcion.zonaId)?.nombre ?? null}
              ahoraIso={ahoraIso}
              onSeleccionarZona={onSeleccionarZona}
            />
          ))}
        </div>
      )}

    </div>
  );
}

/** Riel en `sin_pedidos` (README §8): hitos de preparación + tabla proyección/base/capacidad. */
function PreparacionOla({ ola }: { ola: OlaEntrante }) {
  const ETIQUETA_HITO: Record<string, string> = {
    pendiente: "Pendiente",
    hecho: "Hecho",
    vencido: "Vencido",
  };

  return (
    <div className="p-3.5">
      <p className="text-[9px] font-extrabold tracking-[0.13em] text-tc-ink-600 uppercase">
        Preparación de la ola · {ola.nombre}
      </p>

      <div className="mt-2">
        {ola.hitos.map((hito) => (
          <div key={hito.id} className="flex items-center gap-3 border-t border-tc-ink-300 py-2">
            <span
              className={[
                "shrink-0 px-1.5 py-0.5 text-[9px] font-extrabold tracking-[0.06em] uppercase",
                hito.estado === "vencido"
                  ? "bg-tc-senal text-tc-papel"
                  : hito.estado === "hecho"
                    ? "bg-tc-tinta text-tc-papel"
                    : "border border-tc-ink-300 text-tc-ink-600",
              ].join(" ")}
            >
              {ETIQUETA_HITO[hito.estado]}
            </span>
            <span className="flex-1 text-[12px] text-tc-tinta">{hito.titulo}</span>
            <span className="tc-num shrink-0 text-[10.5px] text-tc-ink-600">
              {fechaCortaSantiago(hito.fechaLimite)}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[9px] font-extrabold tracking-[0.13em] text-tc-ink-600 uppercase">
        Proyección por día
      </p>
      <table className="tc-num mt-2 w-full text-[11px]">
        <thead>
          <tr className="border-b border-tc-ink-300 text-left text-[9px] font-extrabold tracking-[0.08em] text-tc-ink-600 uppercase">
            <th className="py-1.5 font-extrabold">Día</th>
            <th className="py-1.5 text-right font-extrabold">Proy.</th>
            <th className="py-1.5 text-right font-extrabold">Base</th>
            <th className="py-1.5 text-right font-extrabold">Cap.</th>
          </tr>
        </thead>
        <tbody>
          {ola.curva.map((punto) => {
            const excede = punto.pedidosProyectados > punto.capacidadEstimada;
            return (
              <tr key={punto.fecha} className="border-b border-tc-ink-300">
                <td className="py-1.5 text-tc-tinta">{punto.etiquetaDia}</td>
                <td className="py-1.5 text-right font-extrabold text-tc-tinta">
                  {numeroTorre(punto.pedidosProyectados)}
                </td>
                <td className="py-1.5 text-right text-tc-ink-700">{numeroTorre(punto.pedidosBase)}</td>
                <td className={`py-1.5 text-right ${excede ? "font-extrabold text-tc-senal-text" : "text-tc-ink-700"}`}>
                  {numeroTorre(punto.capacidadEstimada)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
