"use client";

import type { BloqueTimeline, Ventana } from "../_fixture/estado-torre";
import { fechaCortaSantiago, minutosDesdeSantiago } from "../_lib/tiempo";
import { useMinutosDesdeSantiago } from "../_lib/use-minutos-santiago";

const MINUTOS_TOTALES = 780; // 08:00 → 21:00 (README §4)
const HORAS_EJE = Array.from({ length: 14 }, (_, i) => 8 + i); // 08..21

function porcentaje(minutos: number): number {
  return (Math.max(0, Math.min(MINUTOS_TOTALES, minutos)) / MINUTOS_TOTALES) * 100;
}

/**
 * Reloj `HH:MM` a partir de los minutos transcurridos desde las 08:00.
 *
 * El valor puede ser NEGATIVO (son las 00:04, la jornada empieza a las 08:00) o
 * pasar de 780 (son las 23:00). Con la aritmética directa —`(8 + minutos/60) %
 * 24` y `minutos % 60`— eso imprimía `00:-56`, porque el `%` de JavaScript
 * conserva el signo del dividendo. Se vio en pantalla a medianoche.
 *
 * Se normaliza al día completo en vez de recortarlo al rango: el MARCADOR sí se
 * pega al borde de la franja, pero la hora tiene que decir la verdad. Recortarla
 * mostraría «08:00» a medianoche, que es peor que un número raro — es un número
 * creíble y falso.
 */
function relojDesdeInicioJornada(minutos: number): string {
  const total = ((8 * 60 + Math.floor(minutos)) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

interface Props {
  bloques: BloqueTimeline[];
  rango: Ventana;
  ahoraIso: string;
}

/**
 * R5 · Línea de tiempo (README §4, 98 px). Escala 08:00→21:00 = 780 min.
 * El marcador AHORA se mueve con `transition: left 4s linear` — el reloj
 * corre, no salta (ver `usarMinutosDesdeSantiago` para la decisión sobre de
 * dónde sale el valor inicial).
 */
export function R5LineaDeTiempo({ bloques, rango, ahoraIso }: Props) {
  const minutosAhora = useMinutosDesdeSantiago(ahoraIso);
  const leftAhora = porcentaje(minutosAhora);
  // El marcador se pega al borde cuando «ahora» cae fuera de la franja; sin
  // decirlo, un marcador clavado a la izquierda se lee como «son las 08:00».
  const fueraDeJornada = minutosAhora < 0 || minutosAhora > MINUTOS_TOTALES;
  const carriles = Math.max(1, ...bloques.map((b) => b.carril + 1));
  const altoPista = carriles * 20;

  return (
    <section
      aria-label="Línea de tiempo"
      className="grid shrink-0 bg-tc-papel"
      style={{ height: "var(--tc-h-tiempo)", gridTemplateColumns: "148px 1fr" }}
    >
      <div className="flex flex-col justify-center gap-0.5 border-r border-tc-ink-300 px-4">
        <p className="text-[9px] font-extrabold tracking-[0.14em] text-tc-ink-600 uppercase">
          Línea de tiempo
        </p>
        <p className="text-[10px] text-tc-ink-600">{fechaCortaSantiago(rango.inicio)} · Santiago</p>
        <p
          className="tc-num text-[22px] font-extrabold text-tc-tinta"
          title={
            fueraDeJornada ? "Fuera de la ventana de reparto (08:00–21:00)" : undefined
          }
        >
          {relojDesdeInicioJornada(minutosAhora)}
          {fueraDeJornada ? (
            <span className="ml-1 align-middle text-[10px] font-semibold text-tc-ink-600">
              fuera de ventana
            </span>
          ) : null}
        </p>
      </div>

      <div className="relative flex flex-col justify-center overflow-hidden px-4 py-1.5">
        <div className="relative" style={{ height: altoPista }}>
          {bloques.map((bloque) => (
            <BloqueItem key={bloque.id} bloque={bloque} />
          ))}
          <MarcadorAhora leftPct={leftAhora} altoPx={altoPista + 22} />
        </div>

        <div className="relative mt-1 border-t border-tc-ink-300" style={{ height: 22 }}>
          {HORAS_EJE.map((h) => (
            <div
              key={h}
              className="absolute top-0 border-l border-tc-ink-300 pt-1 pl-1 text-[9px] text-tc-ink-600"
              style={{ left: `${porcentaje((h - 8) * 60)}%` }}
            >
              <span className="tc-num">{String(h).padStart(2, "0")}:00</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BloqueItem({ bloque }: { bloque: BloqueTimeline }) {
  const inicioMin = minutosDesdeSantiago(bloque.inicio);
  const finMin = minutosDesdeSantiago(bloque.fin);
  const instantaneo = bloque.inicio === bloque.fin;
  const left = porcentaje(inicioMin);
  const enRiesgo = bloque.tipo === "corte_en_riesgo";
  const top = bloque.carril * 20;

  if (instantaneo) {
    return (
      <div className="absolute" style={{ left: `${left}%`, top }}>
        <div className={`h-[17px] w-[2px] ${enRiesgo ? "bg-tc-senal" : "bg-tc-tinta"}`} aria-hidden="true" />
        <div
          className={[
            "tc-num mt-0.5 border-t-2 pt-0.5 text-[9.5px] font-semibold whitespace-nowrap",
            enRiesgo ? "border-tc-senal text-tc-senal-text" : "border-tc-tinta text-tc-tinta",
          ].join(" ")}
        >
          {bloque.etiqueta}
        </div>
      </div>
    );
  }

  const width = Math.max(0, porcentaje(finMin) - left);
  return (
    <div
      className={[
        "absolute flex h-[17px] items-center overflow-hidden border bg-tc-papel px-1.5 text-[9.5px] font-semibold whitespace-nowrap",
        enRiesgo ? "border-tc-senal text-tc-senal-text" : "border-tc-tinta text-tc-tinta",
      ].join(" ")}
      style={{ left: `${left}%`, width: `${width}%`, top }}
      title={bloque.etiqueta}
    >
      {bloque.etiqueta}
    </div>
  );
}

function MarcadorAhora({ leftPct, altoPx }: { leftPct: number; altoPx: number }) {
  return (
    <div
      className="absolute top-0 z-10 w-[2px] bg-tc-tinta transition-[left] duration-[4000ms] ease-linear"
      style={{ left: `${leftPct}%`, height: altoPx }}
      aria-hidden="true"
    >
      <span className="tc-num absolute -top-[3px] left-0.5 bg-tc-tinta px-1 py-0.5 text-[9px] font-extrabold whitespace-nowrap text-tc-papel">
        AHORA
      </span>
    </div>
  );
}
