import type { ReactNode } from "react";

/**
 * Piezas de las fichas en panel lateral (sellers, períodos): la franja de
 * cifras y las tarjetas con título. Una sola forma para las dos fichas, en vez
 * de dos versiones parecidas que se separan con el tiempo.
 */

/** Una sección de la ficha: recuadro con título y, si hace falta, su acción. */
export function TarjetaFicha({
  titulo,
  accion,
  children,
}: {
  titulo: string;
  accion?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-line bg-bg-raised">
      <div className="flex min-h-10 items-center justify-between gap-2 border-b border-line-subtle px-3">
        <h3 className="text-sm font-medium text-fg">{titulo}</h3>
        {accion}
      </div>
      <div className="px-3 py-2.5">{children}</div>
    </section>
  );
}

/** La franja de cifras de arriba: 2 o 3 magnitudes lado a lado. */
export function FranjaCifras({ children }: { children: ReactNode }) {
  return (
    <div className="grid auto-cols-fr grid-flow-col divide-x divide-line rounded-md border border-line bg-bg-raised">
      {children}
    </div>
  );
}

export function CifraFicha({
  rotulo,
  tono,
  children,
}: {
  rotulo: string;
  tono?: "atencion";
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 px-2.5 py-2.5 sm:px-3">
      <p className="text-[10px] font-medium tracking-[0.1em] text-fg-muted uppercase">{rotulo}</p>
      <p
        className={`rx-num mt-1 truncate text-[15px] font-semibold sm:text-lg ${
          tono === "atencion" ? "text-attention-fg" : "text-fg"
        }`}
      >
        {children}
      </p>
    </div>
  );
}

/** Un dato suelto dentro de una tarjeta: rótulo a la izquierda, valor a la derecha. */
export function FilaDato({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
      <span className="text-fg-muted">{rotulo}</span>
      <span className="rx-num text-right text-fg">{children}</span>
    </div>
  );
}
