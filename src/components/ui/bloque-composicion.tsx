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

export interface TotalComposicion {
  /** «de margen por entrega», «a pagar». Se lee después de la cifra. */
  concepto: string
  monto: number
}

export function BloqueComposicion({
  sumandos,
  total,
  className,
}: {
  sumandos: SumandoComposicion[]
  /**
   * El resultado de la resta, bajo una regla.
   *
   * **Su presencia cambia la disposición a vertical**, y no es un capricho de
   * maquetación: un total solo tiene sentido debajo de una columna alineada.
   * Puesto en línea —«3.600 cobras − 1.800 pagas = 1.800 de margen»— la
   * igualdad se pierde entre los separadores y hay que leer la frase entera
   * para encontrar el número que importa.
   *
   * Sin `total` el bloque sigue siendo el de siempre, en línea: es como lo usan
   * las liquidaciones y P4, donde el total ya está grande arriba y esto solo lo
   * descompone.
   */
  total?: TotalComposicion
  className?: string
}) {
  // Con un solo sumando no hay resta que mostrar: sale «4.200 entregas», que es
  // el mismo número de arriba con una palabra al lado. Visto en pantalla, en el
  // detalle de una liquidación sin ajustes ni visitas.
  if (sumandos.length < 2) return null

  if (total) {
    return (
      <div
        className={cn(
          "font-mono text-[11px] leading-relaxed text-fg-subtle tabular-nums",
          className
        )}
      >
        {sumandos.map((s, i) => (
          <div key={`${s.concepto}-${i}`}>
            {/* El signo va DELANTE y visible, en su propia columna: la regla 20
                pide un menos real, no un paréntesis ni un rojo que interpretar. */}
            <span className="inline-block w-3">{i > 0 ? (s.resta ? "−" : "+") : ""}</span>
            {formatearMiles(Math.abs(s.monto))} {s.concepto}
          </div>
        ))}
        <div className="mt-1.5 border-t border-line-subtle pt-1.5 font-semibold text-fg">
          <span className="inline-block w-3">=</span>
          {formatearMiles(Math.abs(total.monto))} {total.concepto}
        </div>
      </div>
    )
  }

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
