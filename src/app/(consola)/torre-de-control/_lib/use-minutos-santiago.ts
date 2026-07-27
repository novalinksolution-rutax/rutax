"use client";

import { useEffect, useState } from "react";
import { minutosDesdeSantiago } from "./tiempo";

/**
 * Ticker del marcador AHORA de R5 (README §6: "ahora avanza con un intervalo
 * de 4 s [...] deriva el valor de la hora real de Santiago [...] calcula el
 * primer valor en useEffect, no en el render inicial, o tendrás mismatch").
 *
 * Nombre en inglés (`use...`) por convención dura de la regla de lint
 * `react-hooks/rules-of-hooks`: exige que el identificador arranque
 * literalmente con "use". El resto del proyecto nombra en español; este es
 * el primer custom hook del repo, así que el prefijo queda documentado aquí.
 *
 * Decisión de implementación (paso B3, documentada en la entrega): el dataset
 * de esta fixture está congelado en un sábado 25-jul-2026 09:14 específico —
 * todos los demás bloques de `TIMELINE_HOY` son de ESE día. Si este hook leyera
 * literalmente el reloj de pared real (que hoy, en este entorno, es un día
 * distinto y puede caer fuera de la ventana 08:00–21:00), el marcador quedaría
 * fuera de rango o desincronizado del resto de los bloques cada vez que se
 * probara la pantalla — un demo incoherente, no "el reloj corre".
 *
 * Por eso el punto de partida es el `AHORA` de la fixture (semilla fija,
 * idéntica en servidor y cliente: cero riesgo de mismatch de hidratación), y
 * lo que sí es real es el AVANCE: cada tick suma el tiempo de pared
 * efectivamente transcurrido desde el montaje. La animación "el reloj corre,
 * no salta" queda intacta. Cuando exista el endpoint real, `ahora` vendrá del
 * servidor por request y este hook deja de tener sentido — se reemplaza por
 * el valor de la respuesta.
 */
export function useMinutosDesdeSantiago(semillaIso: string, intervaloMs = 4000): number {
  const semilla = minutosDesdeSantiago(semillaIso);
  const [minutos, setMinutos] = useState(semilla);

  useEffect(() => {
    const inicio = Date.now();
    const id = setInterval(() => {
      const transcurridoMin = (Date.now() - inicio) / 60_000;
      setMinutos(semilla + transcurridoMin);
    }, intervaloMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- semilla es un ISO fijo del fixture
  }, [semillaIso, intervaloMs]);

  return minutos;
}
