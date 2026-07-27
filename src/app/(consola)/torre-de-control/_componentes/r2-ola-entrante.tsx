import type { OlaEntrante } from "../_fixture/estado-torre";
import { numeroConSigno, numeroTorre, porcentajeTorre } from "../_lib/formato";
import { diaYMesCorto, fechaCortaSantiago, rangoFechasCorto } from "../_lib/tiempo";

/** 640 = techo fijo de la escala (README §4). Recalcular si el dataset cambia de magnitud. */
const TECHO_ESCALA = 640;
const ALTO_PISTA = 66;

function altoBarra(valor: number): number {
  return Math.max(0, Math.min(valor, TECHO_ESCALA)) / TECHO_ESCALA * ALTO_PISTA;
}

interface Props {
  ola: OlaEntrante | null;
}

/**
 * R2 · Ola entrante (README §4, 132 px). Si `olaEntrante` es `null`, la
 * región no se renderiza — no se deja un hueco (regla de la estructura de
 * información §2).
 */
export function R2OlaEntrante({ ola }: Props) {
  if (!ola) return null;

  const hitoVencido = ola.hitos.find((h) => h.estado === "vencido");
  const explicacionArquetipo =
    ola.arquetipo === "regalo"
      ? "Las entregas llegan antes del evento y el plazo es duro: la fecha es el deadline, no el inicio."
      : "Las entregas llegan después del evento, entre el día 1 y el día 5 (D+1 a D+5).";

  return (
    <section
      id="olas"
      aria-label="Ola entrante"
      className="grid shrink-0 bg-tc-papel"
      style={{
        height: "var(--tc-h-ola)",
        gridTemplateColumns: "352px 1px 244px 1px 1fr",
      }}
    >
      {/* Identidad */}
      <div className="flex flex-col gap-1.5 overflow-hidden px-4 py-3">
        <p className="text-[8.5px] font-extrabold tracking-[0.16em] text-tc-ink-600 uppercase">
          Ola entrante · arquetipo {ola.arquetipo}
        </p>
        <p className="text-[22px] font-extrabold tracking-[-0.02em] text-tc-tinta">{ola.nombre}</p>
        <p className="text-[11px] text-tc-ink-700">
          {fechaCortaSantiago(ola.fechaEvento.inicio)} · en {ola.diasParaEvento} días
        </p>
        <p className="text-[12.5px] leading-[1.45] text-tc-ink-700">{explicacionArquetipo}</p>
        {hitoVencido ? (
          <span className="mt-auto inline-flex w-fit items-center gap-1.5 border border-tc-tinta px-2 py-1 text-[9.5px] font-extrabold tracking-[0.04em] text-tc-tinta uppercase">
            Hito vencido · {hitoVencido.titulo} · {diaYMesCorto(hitoVencido.fechaLimite).dia} {diaYMesCorto(hitoVencido.fechaLimite).mes}
          </span>
        ) : null}
      </div>

      <div className="bg-tc-ink-300" aria-hidden="true" />

      {/* Cifras */}
      <div className="flex flex-col divide-y divide-tc-ink-300 px-4 py-1">
        <FilaCifra etiqueta="Ventana de entregas" valor={rangoFechasCorto(ola.ventanaEntregas.inicio, ola.ventanaEntregas.fin ?? ola.ventanaEntregas.inicio)} />
        <FilaCifra etiqueta="Variación esperada" valor={porcentajeTorre(ola.variacionEsperadaPct, 0)} />
        <FilaCifra etiqueta="Brecha del día crítico" valor={numeroConSigno(ola.brechaConductores)} señal={ola.brechaConductores < 0} />
      </div>

      <div className="bg-tc-ink-300" aria-hidden="true" />

      {/* Curva */}
      <div className="flex flex-col overflow-hidden px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-[8.5px] font-extrabold tracking-[0.16em] text-tc-ink-600 uppercase">
            Curva de entregas proyectada
          </p>
          <p className="shrink-0 text-[9px] text-tc-ink-600">
            <span aria-hidden="true">▮</span> proyectado{" "}
            <span aria-hidden="true">▯</span> base{" "}
            <span aria-hidden="true">┄</span> capacidad instalada
          </p>
        </div>
        <div className="grid flex-1 items-end gap-1.5" style={{ gridTemplateColumns: `repeat(${ola.curva.length}, minmax(0, 1fr))` }}>
          {ola.curva.map((punto) => {
            const exceso = Math.max(0, punto.pedidosProyectados - punto.capacidadEstimada);
            const altoTinta = altoBarra(Math.min(punto.pedidosProyectados, punto.capacidadEstimada));
            const altoSenal = altoBarra(exceso);
            return (
              <div key={punto.fecha} className="flex flex-col items-center gap-1">
                <div className="relative flex w-full items-end justify-between" style={{ height: ALTO_PISTA }}>
                  {/* capacidad instalada: línea punteada a su altura proporcional */}
                  <div
                    className="absolute right-0 left-0 border-t-2 border-dashed"
                    style={{ bottom: altoBarra(punto.capacidadEstimada), borderColor: "#605d5d" }}
                    aria-hidden="true"
                  />
                  {/* base: 30% del ancho, outline, transparente */}
                  <div
                    className="border border-tc-ink-500 bg-transparent"
                    style={{ width: "30%", height: altoBarra(punto.pedidosBase) }}
                  />
                  {/* proyectada: 48% del ancho, pegada a la derecha; exceso apilado en Señal */}
                  <div className="flex flex-col justify-end" style={{ width: "48%", height: altoBarra(punto.pedidosProyectados) }}>
                    {altoSenal > 0 ? <div className="bg-tc-senal" style={{ height: altoSenal }} /> : null}
                    <div className="bg-tc-tinta" style={{ height: altoTinta }} />
                  </div>
                </div>
                <p className={`tc-num text-[10px] ${punto.esPeak ? "font-extrabold" : "font-semibold"} text-tc-tinta`}>
                  {numeroTorre(punto.pedidosProyectados)}
                </p>
                <p className="text-[9px] text-tc-ink-600">{punto.etiquetaDia}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FilaCifra({ etiqueta, valor, señal }: { etiqueta: string; valor: string; señal?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <span className="text-[9px] font-bold tracking-[0.1em] text-tc-ink-600 uppercase">{etiqueta}</span>
      <span className={`tc-num text-[17px] font-extrabold ${señal ? "text-tc-senal-text" : "text-tc-tinta"}`}>
        {valor}
      </span>
    </div>
  );
}
