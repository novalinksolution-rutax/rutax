import { cn } from "@/lib/utils"
import { DistintivoEstado } from "@/components/ui/distintivo-estado"
import { semaforoSla } from "@/lib/ui/semaforo-sla"

/**
 * SemaforoCumplimiento — el % de SLA con su lectura al lado.
 *
 * LA CIFRA Y EL JUICIO, JUNTOS
 * ---------------------------------------------------------------------------
 * «94 %» no dice nada sin el objetivo: contra 90 es holgado y contra 97 es
 * incumplimiento. Por eso el componente muestra los dos números y el veredicto
 * en un distintivo, que lleva glifo además de color — **el color nunca es el
 * único canal** (regla 5), y acá importa el doble porque un semáforo es
 * exactamente el patrón que más se apoya en él.
 *
 * ⚠️ **«Sin datos» va en neutro, no en ámbar.** El helper lo devolvía como
 * `amarillo`, así que un seller que empezó ayer aparecía en advertencia por no
 * tener mediciones todavía. No tener número no es un problema: es el estado
 * normal de algo que aún no ocurre. Lo normal no se alarma.
 *
 * LA BARRA ES OPCIONAL Y NO ES UN GRÁFICO
 * ---------------------------------------------------------------------------
 * Cuando se muestra, la marca del objetivo va **encima** de la barra, en
 * `--rx-chart-target`: sin ella una barra al 94 % se lee como «casi lleno», que
 * es la lectura contraria a la que corresponde si el objetivo era 97. La barra
 * no reemplaza a la cifra, la acompaña.
 */
export function SemaforoCumplimiento({
  /** Porcentaje actual, 0–100. `null` cuando todavía no hay mediciones. */
  pct,
  /** Objetivo pactado con el seller. */
  objetivo,
  /** La barra con su marca de objetivo. Se apaga donde no hay ancho. */
  conBarra = false,
  className,
}: {
  pct: number | null
  objetivo: number
  conBarra?: boolean
  className?: string
}) {
  const semaforo = semaforoSla(pct, objetivo)

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-lg font-semibold text-fg tabular-nums">
          {pct === null ? "—" : `${pct.toFixed(1)}%`}
        </span>
        <span className="font-mono text-[11px] text-fg-subtle tabular-nums">
          objetivo {objetivo}%
        </span>
        <DistintivoEstado tono={semaforo.tono} etiqueta={semaforo.etiqueta} />
      </div>

      {conBarra && pct !== null ? (
        <div
          className="relative h-1.5 w-full bg-bg-inset"
          role="img"
          aria-label={`${pct.toFixed(1)} por ciento de cumplimiento, objetivo ${objetivo} por ciento`}
        >
          <div
            className="h-full"
            style={{
              width: `${Math.min(100, Math.max(0, pct))}%`,
              backgroundColor: `var(--rx-${semaforo.tono}-fg)`,
            }}
          />
          {/* La marca del objetivo, 2 px, por encima del relleno. Sin ella la
              barra miente por omisión: no hay contra qué leer el largo. */}
          <span
            aria-hidden="true"
            className="absolute inset-y-0 w-0.5"
            style={{
              left: `${Math.min(100, Math.max(0, objetivo))}%`,
              backgroundColor: "var(--rx-chart-target)",
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
