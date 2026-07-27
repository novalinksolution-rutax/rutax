import { ESCALA_RIESGO, escalonDeRiesgo } from "../_lib/riesgo";

/**
 * Patrones de trama a 45° — Torre de control (README §7). Un único `<svg>`
 * oculto define los 5 `<pattern>`; cualquier otro `<svg>` del documento puede
 * rellenar con `fill={idPatronRiesgo(paso)}` porque la resolución de `url(#id)`
 * es global al documento, no al árbol del `<svg>` que la declara.
 *
 * Se monta una sola vez en la raíz de la consola (`TorreConsola`).
 */
export function idPatronRiesgo(paso: 1 | 2 | 3 | 4 | 5): string {
  return `url(#tc-trama-${paso})`;
}

export function DefsPatronesRiesgo() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className="absolute">
      <defs>
        {ESCALA_RIESGO.map((escalon) => (
          <pattern
            key={escalon.paso}
            id={`tc-trama-${escalon.paso}`}
            patternUnits="userSpaceOnUse"
            width={escalon.pitch}
            height={escalon.pitch}
            patternTransform="rotate(45)"
          >
            <rect width={escalon.pitch} height={escalon.pitch} fill={escalon.fondo} />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2={escalon.pitch}
              stroke={escalon.tintaLinea}
              strokeWidth={escalon.grosor}
              strokeOpacity={escalon.opacidad}
            />
          </pattern>
        ))}
      </defs>
    </svg>
  );
}

/** Swatch de la leyenda: 66×18 con la trama real del escalón. */
export function SwatchRiesgo({ paso }: { paso: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <svg
      viewBox="0 0 66 18"
      preserveAspectRatio="none"
      className="h-[18px] w-[66px] shrink-0"
      aria-hidden="true"
    >
      <rect width="66" height="18" fill={idPatronRiesgo(paso)} />
    </svg>
  );
}

/**
 * Barra de riesgo proporcional (0–100), con la trama del escalón que
 * corresponde al valor. Usada en el desglose de zona (barra de factor) y en
 * la fila de zona de la lista (regla de producto 4: el color nunca solo — la
 * cifra y la palabra siempre acompañan a esta barra, nunca va sola).
 */
export function BarraRiesgo({
  valor,
  alturaPx,
  className,
}: {
  valor: number;
  alturaPx: number;
  className?: string;
}) {
  const escalon = escalonDeRiesgo(valor);
  const ancho = Math.max(0, Math.min(100, valor));
  return (
    <div
      className={`relative w-full bg-tc-inserto ${className ?? ""}`}
      style={{ height: alturaPx }}
      role="presentation"
    >
      <div className="absolute inset-y-0 left-0" style={{ width: `${ancho}%` }}>
        <svg
          viewBox={`0 0 100 ${alturaPx}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          aria-hidden="true"
        >
          <rect width="100" height={alturaPx} fill={idPatronRiesgo(escalon.paso)} />
        </svg>
      </div>
    </div>
  );
}
