"use client";

/**
 * El lienzo del login: doce módulos, uno encendido.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ ES
 * -----------------------------------------------------------------------------
 * El símbolo de Rutax —dos barras desfasadas— repetido doce veces, con **uno
 * encendido a la vez**. No hay una palabra: es el argumento del producto
 * convertido en textura, y nadie tiene que entenderlo para que funcione.
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
 * Son **24 rectángulos con color de fondo**: sin imagen, sin SVG, sin una
 * tipografía extra. En un login, la velocidad es lo primero que el usuario
 * juzga —es la primera pantalla del producto que ve en el día— y esto pinta
 * antes de que llegue cualquier otra cosa.
 *
 * Las dos alternativas quedaron descartadas y conviene que conste: el símbolo a
 * escala arquitectónica es más rotundo pero **se agota en un vistazo** —a la
 * décima vez que entras es una pared—, y la fotografía a sangre es la más cálida
 * y la única que depende de una compra, de acertarle a la foto, y de una segunda
 * imagen para el tema claro.
 *
 * -----------------------------------------------------------------------------
 * EL MOVIMIENTO, Y SUS DOS PROHIBICIONES
 * -----------------------------------------------------------------------------
 * Un módulo se apaga y otro se enciende **cada 4 s**, con cruce de 200 ms.
 * **Un solo cambio a la vez, nunca dos**, y **nunca dos vecinos seguidos**: dos
 * encendidos simultáneos convierten el gesto en parpadeo, y dos vecinos
 * consecutivos se leen como un movimiento —una cosa que se desliza— en vez de
 * como puntos que se turnan.
 *
 * Con «reducir movimiento» **se queda uno fijo, y sigue comunicando lo mismo**:
 * el lienzo no es información, así que quitarle la animación no le quita nada.
 *
 * Y por eso mismo **bajo `lg` desaparece entero** en vez de reubicarse: nada de
 * lo que hay acá hace falta para entrar. Ésa es justamente la ventaja de un
 * lienzo sobre un panel con contenido.
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
const MS_ENTRE_CAMBIOS = 4000;

/** Ancho y alto que ocupa un módulo completo, con su desfase incluido. */
const MODULO = {
  ancho: BARRA.ancho + DESFASE_X,
  alto: SEPARACION_Y + BARRA.alto,
};

export function LienzoLogin() {
  const [encendido, setEncendido] = useState(0);

  useEffect(() => {
    // Con «reducir movimiento» no se programa nada: queda el módulo inicial.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const id = window.setInterval(() => {
      setEncendido((actual) => {
        // ⚠️ Se elige entre los que **no son vecinos** del actual. Sin este
        // filtro, dos encendidos consecutivos contiguos se leen como algo que se
        // desliza, y el gesto deja de ser «uno se turna con otro».
        const candidatos: number[] = [];
        for (let i = 0; i < MODULOS; i += 1) {
          const contiguoEnFila = Math.abs(i - actual) === 1;
          const contiguoEnColumna = Math.abs(i - actual) === COLUMNAS;
          if (i !== actual && !contiguoEnFila && !contiguoEnColumna) candidatos.push(i);
        }
        return candidatos[Math.floor(Math.random() * candidatos.length)] ?? actual;
      });
    }, MS_ENTRE_CAMBIOS);

    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none flex h-full w-full items-center justify-center overflow-hidden bg-bg-sunken"
    >
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${COLUMNAS}, ${MODULO.ancho}px)`,
          // El aire entre módulos sale de la propia retícula: la separación
          // entre topes de un módulo, otra vez.
          gap: `${SEPARACION_Y}px ${DESFASE_X}px`,
        }}
      >
        {Array.from({ length: MODULOS }).map((_, i) => (
          <Modulo key={i} activo={i === encendido} />
        ))}
      </div>
    </div>
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
        className={
          "absolute transition-colors " + (activo ? "bg-brand" : "bg-line")
        }
        style={{
          width: BARRA.ancho,
          height: BARRA.alto,
          left: DESFASE_X,
          top: SEPARACION_Y,
          // 200 ms y la curva del sistema: el cruce es lo que hace que se lea
          // como un relevo y no como un encendido brusco.
          transitionDuration: "200ms",
          transitionTimingFunction: "var(--rx-ease-estandar, ease)",
        }}
      />
    </div>
  );
}
