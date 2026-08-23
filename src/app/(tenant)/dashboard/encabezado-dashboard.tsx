"use client";

/**
 * El reloj del encabezado del mosaico.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ NO SE RENDERIZA EN EL SERVIDOR
 * -----------------------------------------------------------------------------
 * Una hora renderizada en el servidor se congela en el instante del render y se
 * queda ahí hasta que alguien recargue. En una pantalla que a dos centímetros
 * declara «en vivo», eso es exactamente la clase de promesa que la interfaz no
 * puede cumplir (regla 35): el dueño mira «16:04», son las 17:30, y la cifra de
 * al lado hereda esa desconfianza.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ `useSyncExternalStore` Y NO UN `useState` CON `useEffect`
 * -----------------------------------------------------------------------------
 * La hora del reloj es una fuente EXTERNA a React: cambia sola, sin que nadie
 * despache nada. Modelarla con `useState` + `setState` dentro del efecto de
 * montaje dispara un render en cascada —y el lint del repo lo prohíbe con razón—
 * además de arriesgar un desajuste de hidratación si el servidor pintara una
 * hora.
 *
 * Con `useSyncExternalStore` el servidor devuelve `null` (no hay hora), la
 * hidratación calza porque el cliente también empieza en `null`, y a partir de
 * ahí React se suscribe al tic. El snapshot va cacheado por minuto: si devolviera
 * un objeto nuevo en cada llamada, React lo leería como cambio permanente y
 * entraría en un bucle de renders.
 */

import { useSyncExternalStore } from "react";
import { formatearHora } from "@/lib/formato-cl";

interface Marca {
  iso: string;
  texto: string;
}

let cache: { minuto: number; marca: Marca } | null = null;

function leerMarca(): Marca | null {
  const ahora = Date.now();
  const minuto = Math.floor(ahora / 60_000);
  if (!cache || cache.minuto !== minuto) {
    const fecha = new Date(ahora);
    cache = { minuto, marca: { iso: fecha.toISOString(), texto: formatearHora(fecha) } };
  }
  return cache.marca;
}

/** En el servidor no hay hora que mostrar, y decirlo es la respuesta correcta. */
function sinMarca(): Marca | null {
  return null;
}

function suscribir(avisar: () => void): () => void {
  // Cada 15 s, no cada 60: el minuto puede cambiar en cualquier punto del
  // intervalo, así que un tic de un minuto exacto dejaría el reloj hasta 59 s
  // atrasado.
  const id = setInterval(avisar, 15_000);
  return () => clearInterval(id);
}

export function RelojSantiago() {
  const marca = useSyncExternalStore(suscribir, leerMarca, sinMarca);
  if (!marca) return null;
  return (
    <time className="rx-num" dateTime={marca.iso}>
      {marca.texto}
    </time>
  );
}
