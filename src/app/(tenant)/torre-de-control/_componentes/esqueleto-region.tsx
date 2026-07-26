/**
 * Esqueletos de carga por región.
 * =====================================================================
 *
 * Del handoff (§6): **no hay spinner de página**. Cada región llega por su
 * cuenta y ninguna bloquea a otra — mapea directo a un `<Suspense>` por región
 * cuando el dato venga del servidor.
 *
 * El esqueleto es una trama diagonal animada (clase `.tc-cargando`, definida en
 * `globals.css`) **y nombra la región que falta**. Eso último no es decoración:
 * el README dice literalmente «nombrar lo que falta es parte del diseño». Un
 * rectángulo gris anónimo no le dice al coordinador si lo que no llegó es el
 * mapa o el riel de excepciones; con el nombre, sí.
 *
 * Las alturas replican las de la retícula (§4) para que la página no salte
 * cuando el contenido real reemplaza al esqueleto.
 */

interface Props {
  /** Etiqueta de la región, en mayúsculas: `"R3 · MAPA"`. */
  region: string;
  /** Alto fijo de la región, si lo tiene en la retícula. */
  alto?: string;
  className?: string;
}

export function EsqueletoRegion({ region, alto, className }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${region}: cargando`}
      className={`tc-cargando relative flex items-center justify-center bg-tc-papel ${className ?? ""}`}
      style={alto ? { height: alto } : undefined}
    >
      {/* La placa va sobre la trama para que el texto se lea sin competir. */}
      <span className="border-2 border-tc-tinta bg-tc-papel px-3 py-1.5 text-[9px] font-extrabold tracking-[0.14em] text-tc-tinta uppercase">
        {region} — cargando
      </span>
    </div>
  );
}

/**
 * La consola entera en estado `cargando`: cada región con su propio esqueleto,
 * en la misma retícula que ocuparán cuando lleguen.
 *
 * Existe como pieza aparte —y no como una rama dentro de `TorreConsola`—
 * porque cuando el dato venga del servidor cada uno de estos esqueletos pasa a
 * ser el `fallback` del `<Suspense>` de su región, sin reescribirlos.
 */
export function EsqueletoConsola() {
  return (
    <div
      aria-label="Torre de control — cargando"
      className="flex flex-col gap-[var(--tc-regla-may)] bg-tc-chasis"
    >
      <EsqueletoRegion region="R1 · barra superior" alto="var(--tc-h-barra)" />
      <EsqueletoRegion region="R2 · ola entrante" alto="var(--tc-h-ola)" />
      <div className="flex h-[70dvh] min-h-[480px] gap-[var(--tc-regla-may)]">
        <EsqueletoRegion region="R3 · mapa" className="flex-1" />
        <EsqueletoRegion region="R4 · riel" className="w-[var(--tc-w-riel)] shrink-0" />
      </div>
      <EsqueletoRegion region="R5 · línea de tiempo" alto="var(--tc-h-tiempo)" />
    </div>
  );
}
