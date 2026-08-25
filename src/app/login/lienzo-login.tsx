"use client";

/**
 * El lienzo del login: doce paradas y una ruta que se traza entre ellas.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ ES
 * -----------------------------------------------------------------------------
 * El símbolo de Rutax —dos barras desfasadas— repetido doce veces, con **uno
 * encendido a la vez**. No hay una palabra: es el argumento del producto
 * convertido en textura, y nadie tiene que entenderlo para que funcione.
 *
 * Cada módulo es **una parada**. Cuando le toca el relevo al siguiente, una
 * línea de acento **viaja hasta él trazando el camino**, lo enciende al llegar y
 * se desvanece. Eso es el ruteo —el corazón del producto— dicho sin nombrarlo.
 *
 * ⚠️ **La ruta va en ángulo recto, nunca en diagonal**: primero horizontal,
 * después vertical. Una diagonal sería la distancia geométrica entre dos puntos,
 * y una ruta real recorre calles. El quiebre es lo que hace que se lea como un
 * recorrido y no como un rayo.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ LA GEOMETRÍA NO SE NEGOCIA
 * -----------------------------------------------------------------------------
 * Barra de **112 × 37 px** (3:1 exacto), desfase de **52 px** —46,7 % de su
 * ancho— y separación entre topes de **67 px**, que son 1,8 veces su alto. Son
 * las proporciones del favicon a 16 px, y por eso el lienzo se lee como la misma
 * marca aunque esté a otra escala.
 *
 * **Si la celda no da, se achica la celda: nunca la barra.** Deformar la barra
 * rompe la relación 3:1 y el lienzo deja de ser el símbolo repetido para pasar a
 * ser un patrón cualquiera.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ PESO 0 KB, Y ES LA MITAD DE POR QUÉ ESTA PIEZA EXISTE
 * -----------------------------------------------------------------------------
 * Son rectángulos con color de fondo: **sin imagen, sin SVG**, sin una
 * tipografía extra. La ruta tampoco es un trazo vectorial — son dos `div` que
 * crecen. En un login, la velocidad es lo primero que el usuario juzga, y esto
 * pinta antes de que llegue cualquier otra cosa.
 *
 * -----------------------------------------------------------------------------
 * EL MOVIMIENTO, Y SUS DOS PROHIBICIONES
 * -----------------------------------------------------------------------------
 * Un ciclo cada **4 s**. **Un solo cambio a la vez, nunca dos**, y **nunca dos
 * vecinos seguidos**: dos encendidos simultáneos convierten el gesto en
 * parpadeo, y un salto a la celda de al lado deja una ruta de un tramo, que se
 * lee como un empujón y no como un recorrido. El filtro de vecinos, que ya
 * existía, ahora además **garantiza que toda ruta tenga su quiebre**.
 *
 * Con «reducir movimiento» **no se traza nada y se queda uno fijo**, y sigue
 * comunicando lo mismo: el lienzo no es información, así que quitarle la
 * animación no le quita nada.
 *
 * Y por eso mismo **bajo `lg` desaparece entero** en vez de reubicarse. Ésa es
 * justamente la ventaja de un lienzo sobre un panel con contenido.
 */

import { useEffect, useState } from "react";

/** 3:1 exacto. Ver el comentario de arriba antes de tocar cualquiera de estos. */
const BARRA = { ancho: 112, alto: 37 };
/** 46,7 % del ancho de la barra. */
const DESFASE_X = 52;
/** 1,8 × el alto de la barra, medido entre topes. */
const SEPARACION_Y = 67;

const MODULOS = 12;
const COLUMNAS = 3;
const FILAS = MODULOS / COLUMNAS;

/** Un ciclo completo: trazar, encender, desvanecer, esperar. */
const MS_CICLO = 4000;
/** Cada tramo de la ruta. Dos tramos = 520 ms hasta llegar. */
const MS_TRAMO = 260;
/** El cruce del encendido y el desvanecido de la ruta. */
const MS_CRUCE = 200;

const MODULO = {
  ancho: BARRA.ancho + DESFASE_X,
  alto: SEPARACION_Y + BARRA.alto,
};

/** Paso de una celda a la siguiente, con el aire de la retícula incluido. */
const PASO = {
  x: MODULO.ancho + DESFASE_X,
  y: MODULO.alto + SEPARACION_Y,
};

/** El punto por el que la ruta entra y sale de un módulo: su barra de acento. */
function ancla(indice: number) {
  const col = indice % COLUMNAS;
  const fila = Math.floor(indice / COLUMNAS);
  return {
    x: col * PASO.x + DESFASE_X + BARRA.ancho / 2,
    y: fila * PASO.y + SEPARACION_Y + BARRA.alto / 2,
  };
}

type Fase = "quieto" | "tramo1" | "tramo2" | "llegada";

export function LienzoLogin() {
  const [encendido, setEncendido] = useState(0);
  const [destino, setDestino] = useState<number | null>(null);
  const [fase, setFase] = useState<Fase>("quieto");

  useEffect(() => {
    // Con «reducir movimiento» no se programa nada: queda el módulo inicial y
    // no se traza ninguna ruta.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const relojes: number[] = [];

    const ciclo = window.setInterval(() => {
      setEncendido((actual) => {
        // ⚠️ Se elige entre los que **no son vecinos**. Sin este filtro, la ruta
        // tendría un solo tramo y se leería como un empujón lateral en vez de
        // como un recorrido con su quiebre.
        const candidatos: number[] = [];
        for (let i = 0; i < MODULOS; i += 1) {
          const contiguoEnFila = Math.abs(i - actual) === 1;
          const contiguoEnColumna = Math.abs(i - actual) === COLUMNAS;
          if (i !== actual && !contiguoEnFila && !contiguoEnColumna) candidatos.push(i);
        }
        const siguiente = candidatos[Math.floor(Math.random() * candidatos.length)];
        if (siguiente === undefined) return actual;

        setDestino(siguiente);
        setFase("tramo1");
        relojes.push(window.setTimeout(() => setFase("tramo2"), MS_TRAMO));
        relojes.push(
          window.setTimeout(() => {
            // Al llegar, la parada se enciende y la ruta empieza a irse.
            setFase("llegada");
            setEncendido(siguiente);
          }, MS_TRAMO * 2),
        );
        relojes.push(
          window.setTimeout(() => {
            setFase("quieto");
            setDestino(null);
          }, MS_TRAMO * 2 + MS_CRUCE),
        );
        return actual;
      });
    }, MS_CICLO);

    return () => {
      window.clearInterval(ciclo);
      relojes.forEach(window.clearTimeout);
    };
  }, []);

  const desde = ancla(encendido);
  const hasta = destino !== null ? ancla(destino) : null;
  const trazando = fase !== "quieto" && hasta !== null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none flex h-full w-full items-center justify-center overflow-hidden bg-bg-sunken"
    >
      <div
        className="relative grid"
        style={{
          gridTemplateColumns: `repeat(${COLUMNAS}, ${MODULO.ancho}px)`,
          gridTemplateRows: `repeat(${FILAS}, ${MODULO.alto}px)`,
          gap: `${SEPARACION_Y}px ${DESFASE_X}px`,
        }}
      >
        {Array.from({ length: MODULOS }).map((_, i) => (
          <Modulo key={i} activo={i === encendido} />
        ))}

        {/* ── La ruta ────────────────────────────────────────────────────────
            Dos tramos en ángulo recto. Van con `position:absolute` sobre la
            misma retícula, así que sus coordenadas salen de la geometría de los
            módulos y no de números sueltos que habría que mantener a mano. */}
        {trazando && hasta ? (
          <>
            <Tramo
              // Horizontal primero, desde la parada actual.
              estilo={{
                left: Math.min(desde.x, hasta.x),
                top: desde.y,
                width: fase === "tramo1" ? 0 : Math.abs(hasta.x - desde.x),
                height: 2,
                transformOrigin: hasta.x >= desde.x ? "left center" : "right center",
              }}
              apagandose={fase === "llegada"}
            />
            <Tramo
              // Y el quiebre: vertical hasta la parada de destino.
              estilo={{
                left: hasta.x,
                top: Math.min(desde.y, hasta.y),
                width: 2,
                height: fase === "tramo1" || fase === "tramo2" ? 0 : Math.abs(hasta.y - desde.y),
                transformOrigin: hasta.y >= desde.y ? "center top" : "center bottom",
              }}
              apagandose={fase === "llegada"}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Un tramo de la ruta: un rectángulo de 2 px que crece hasta su destino.
 *
 * ⚠️ Se apaga en la fase **`llegada`**, no en `quieto`: en `quieto` el tramo ya
 * está desmontado, así que ahí la transición de opacidad no se vería nunca. El
 * desvanecido tiene que ocurrir **mientras la parada se enciende** — es el mismo
 * cruce de 200 ms, y es lo que hace que la ruta «entregue» el encendido en vez
 * de desaparecer de golpe. TypeScript lo cazó: la comparación era imposible.
 */
function Tramo({
  estilo,
  apagandose,
}: {
  estilo: React.CSSProperties;
  apagandose: boolean;
}) {
  return (
    <span
      className="absolute bg-brand"
      style={{
        ...estilo,
        opacity: apagandose ? 0 : 0.9,
        transitionProperty: "width, height, opacity",
        transitionDuration: `${MS_TRAMO}ms, ${MS_TRAMO}ms, ${MS_CRUCE}ms`,
        transitionTimingFunction: "var(--rx-ease-estandar, ease)",
      }}
    />
  );
}

function Modulo({ activo }: { activo: boolean }) {
  return (
    <div className="relative" style={{ width: MODULO.ancho, height: MODULO.alto }}>
      {/* La barra de arriba nunca se enciende: en el símbolo es la constante, y
          el acento vive siempre en la de abajo. */}
      <span
        className="absolute top-0 left-0 bg-line"
        style={{ width: BARRA.ancho, height: BARRA.alto }}
      />
      <span
        className={"absolute transition-colors " + (activo ? "bg-brand" : "bg-line")}
        style={{
          width: BARRA.ancho,
          height: BARRA.alto,
          left: DESFASE_X,
          top: SEPARACION_Y,
          transitionDuration: `${MS_CRUCE}ms`,
          transitionTimingFunction: "var(--rx-ease-estandar, ease)",
        }}
      />
    </div>
  );
}
