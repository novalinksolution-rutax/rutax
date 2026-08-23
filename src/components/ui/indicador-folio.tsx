import { cn } from "@/lib/utils"
import { DistintivoEstado } from "@/components/ui/distintivo-estado"
import { nivelFolios, type NivelFolios } from "@/modules/dinero/folios-disponibles"

/**
 * IndicadorFolio — cuántos folios quedan, en la pantalla donde importa.
 *
 * DÓNDE FALTABA
 * ---------------------------------------------------------------------------
 * En `/dinero/periodos`, que es **la pantalla desde donde se factura**. Hasta
 * ahora el courier se enteraba de que se estaba quedando sin folios de dos
 * formas: por un banner en el dashboard —otra pantalla— o al abrir el modal de
 * emisión, o sea con la ceremonia ya empezada.
 *
 * LOS TRES ESTADOS
 * ---------------------------------------------------------------------------
 * `normal` no grita: va en neutro y solo informa. `pocos` es `attention`, que
 * significa «míralo», no «se rompió». `agotados` es `fault` porque ahí sí se
 * detiene la facturación — y dice qué hacer.
 *
 * El umbral y el conteo salen de `folios-disponibles.ts`, que es el único lugar
 * donde vive esa aritmética.
 */

const ETIQUETA: Record<NivelFolios, (n: number) => string> = {
  normal: (n) => `${n} folios disponibles`,
  pocos: (n) => (n === 1 ? "Queda 1 folio" : `Quedan ${n} folios`),
  agotados: () => "Sin folios",
}

export function IndicadorFolio({
  restantes,
  /** Se muestra junto al conteo cuando quedan pocos o ninguno. */
  accion,
  className,
}: {
  restantes: number
  accion?: React.ReactNode
  className?: string
}) {
  const nivel = nivelFolios(restantes)

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-2", className)}>
      <DistintivoEstado
        tono={nivel === "agotados" ? "fault" : nivel === "pocos" ? "attention" : "neutral"}
        etiqueta={ETIQUETA[nivel](restantes)}
        // En `normal` el glifo sobra: es un dato, no un estado que mirar.
        conGlifo={nivel !== "normal"}
      />
      {nivel !== "normal" && accion ? accion : null}
    </span>
  )
}
