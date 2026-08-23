/**
 * `ficha de fila 390` — lo que una fila de tabla se vuelve en el teléfono.
 *
 * -----------------------------------------------------------------------------
 * LA REGLA QUE IMPLEMENTA, Y POR QUÉ EXISTE COMO PIEZA COMPARTIDA
 * -----------------------------------------------------------------------------
 * El arquetipo P1 lo fija para los ~15 listados del producto:
 *
 *   «El teléfono no es una reducción. La fila se convierte en **ficha de tres
 *   líneas**: estado y origen arriba, destinatario a 16 px, y la línea mono con
 *   lo que se cayó.»
 *
 *   «Las columnas caen en orden inverso a la canónica —procedencia, motivo,
 *   seller, fecha— y **lo que cae reaparece bajo el destinatario, en mono**.
 *   Destinatario y código nunca caen.»
 *
 * O sea: en el teléfono **nada se esconde, se reacomoda**. Esconder columnas es
 * exactamente la reducción que la regla prohíbe, y es el atajo que se toma solo
 * cuando cada pantalla resuelve su propio teléfono. De ahí que esto sea una
 * pieza y no tres líneas de Tailwind repetidas quince veces.
 *
 * -----------------------------------------------------------------------------
 * QUÉ NO HACE
 * -----------------------------------------------------------------------------
 * **No es interactiva.** El enlace, la selección y el foco son de la fila que la
 * contiene — que en escritorio es la misma fila con su grilla de columnas. Si
 * esto fuera un botón habría dos objetos tocables anidados y el lector de
 * pantalla anunciaría dos veces la misma parada.
 *
 * Los 52 px de alto y el área tocable de 44 los pone la fila; acá se garantiza
 * el mínimo para que ninguna pantalla lo baje por descuido.
 */

import { cn } from "@/lib/utils";

export function FichaFila390({
  estado,
  clasificacion,
  titulo,
  detalle,
  className,
}: {
  /** Arriba a la izquierda: el distintivo de estado, con su tono. */
  estado: React.ReactNode;
  /**
   * Arriba a la derecha: la etiqueta de clasificación, **sin color**.
   * Es la procedencia en pedidos y la relación laboral en conductores: un dato
   * que clasifica, no un juicio. Con color competiría con el distintivo y no se
   * leería ninguno de los dos.
   */
  clasificacion?: React.ReactNode;
  /**
   * La línea de 16 px: lo que se busca con el pulgar. **Nunca cae.**
   * El destinatario en pedidos, el nombre en conductores.
   */
  titulo: React.ReactNode;
  /**
   * La línea mono: el código y lo que se cayó de la tabla, separado por `·`.
   * **El código nunca cae**: es lo que permite hablar de esta fila con otro.
   */
  detalle?: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("flex min-h-[52px] min-w-0 flex-col justify-center gap-1", className)}>
      <span className="flex items-center gap-2">
        {estado}
        {clasificacion !== undefined ? (
          <span className="rx-num truncate border border-line px-1 py-px text-[10px] leading-none text-fg-muted uppercase">
            {clasificacion}
          </span>
        ) : null}
      </span>
      <span className="truncate text-base leading-tight font-medium text-fg">{titulo}</span>
      {detalle !== undefined ? (
        <span className="rx-num truncate text-xs leading-tight text-fg-muted">{detalle}</span>
      ) : null}
    </span>
  );
}
