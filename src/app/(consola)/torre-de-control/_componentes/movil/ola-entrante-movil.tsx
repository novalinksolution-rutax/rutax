import type { OlaEntrante } from "../../_fixture/estado-torre";
import { numeroConSigno, porcentajeTorre } from "../../_lib/formato";
import { fechaCortaSantiago, rangoFechasCorto } from "../../_lib/tiempo";

/**
 * Ola entrante móvil (README §5, punto 6): nombre, fecha, cuenta atrás y tres
 * cifras en grid. Contexto, al final — después de excepciones y zonas.
 */
export function OlaEntranteMovil({ ola }: { ola: OlaEntrante | null }) {
  if (!ola) return null;

  return (
    // id distinto del de escritorio (`#olas` en r2-ola-entrante.tsx): los dos
    // árboles (escritorio/móvil) están montados a la vez —uno oculto con
    // `display:none`— así que un mismo id colisionaría en el documento.
    <section id="olas-movil" className="bg-tc-papel px-4 py-4">
      <p className="text-[9px] font-extrabold tracking-[0.14em] text-tc-ink-600 uppercase">
        Ola entrante · arquetipo {ola.arquetipo}
      </p>
      <p className="mt-1 text-[18px] font-extrabold tracking-[-0.02em] text-tc-tinta">{ola.nombre}</p>
      <p className="text-[11px] text-tc-ink-700">
        {fechaCortaSantiago(ola.fechaEvento.inicio)} · en {ola.diasParaEvento} días
      </p>
      <div className="mt-3 grid grid-cols-3 gap-3 border-t border-tc-ink-300 pt-3">
        <CifraMovil
          etiqueta="Ventana"
          valor={rangoFechasCorto(ola.ventanaEntregas.inicio, ola.ventanaEntregas.fin ?? ola.ventanaEntregas.inicio)}
        />
        <CifraMovil etiqueta="Variación" valor={porcentajeTorre(ola.variacionEsperadaPct, 0)} />
        <CifraMovil
          etiqueta="Brecha"
          valor={numeroConSigno(ola.brechaConductores)}
          señal={ola.brechaConductores < 0}
        />
      </div>
    </section>
  );
}

function CifraMovil({ etiqueta, valor, señal }: { etiqueta: string; valor: string; señal?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[8.5px] font-bold tracking-[0.1em] text-tc-ink-600 uppercase">{etiqueta}</span>
      <span className={`tc-num text-[14px] font-extrabold ${señal ? "text-tc-senal-text" : "text-tc-tinta"}`}>
        {valor}
      </span>
    </div>
  );
}
