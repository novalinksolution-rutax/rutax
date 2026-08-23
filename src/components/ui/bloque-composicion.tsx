import { cn } from "@/lib/utils"
import { formatearMiles } from "@/lib/ui/formato-moneda"

/**
 * BloqueComposicion — la resta a la vista, en mono.
 *
 * POR QUÉ ES OBLIGATORIO Y NO UN ADORNO
 * ---------------------------------------------------------------------------
 * Regla 21 del sistema: **va junto a cualquier cifra que no sea la suma trivial
 * de una columna.** Y el tablero P4 dice por qué, en el punto de no retorno:
 * «un total sin composición, en el punto de no retorno, es exactamente la cifra
 * que Administración no puede rastrear — y por la que exportaría a Excel».
 *
 * Ese es el costo real de omitirlo: no es que se vea peor, es que alguien
 * reconstruye el número en una planilla aparte y a partir de ahí el producto
 * deja de ser la fuente de verdad.
 *
 * CÓMO SE LEE
 * ---------------------------------------------------------------------------
 * En mono, para que los dígitos se alineen, y con el signo de cada sumando
 * **delante y visible**: un descuento se lee `− 2.900`, no `(2.900)` ni un rojo
 * que hay que interpretar. La regla 20 pide signo menos real.
 */

export interface SumandoComposicion {
  /** «entregas», «recargos», «ajustes», «mínimo no aplicado». */
  concepto: string
  /** En pesos. El signo lo decide `resta`, no el valor. */
  monto: number
  /** `true` cuando el sumando baja el total. */
  resta?: boolean
}

export function BloqueComposicion({
  sumandos,
  className,
}: {
  sumandos: SumandoComposicion[]
  className?: string
}) {
  if (sumandos.length === 0) return null

  return (
    <p
      className={cn(
        "font-mono text-[11px] leading-relaxed text-fg-subtle tabular-nums",
        className
      )}
    >
      {sumandos.map((s, i) => (
        <span key={`${s.concepto}-${i}`}>
          {i > 0 ? (s.resta ? " − " : " + ") : null}
          {/* Sin símbolo y en valor absoluto: el signo lo pone el separador,
              porque «+ −2.900» se lee peor que «− 2.900», y un `$` por sumando
              compite con la resta, que es lo que hay que leer. */}
          {formatearMiles(Math.abs(s.monto))} {s.concepto}
        </span>
      ))}
    </p>
  )
}
