import Link from "next/link"

import { cn } from "@/lib/utils"
import { formatearCLP } from "@/lib/ui/formato-moneda"

/**
 * TablaFinanciera — la pantalla que compite con la planilla de cálculo.
 *
 * POR QUÉ AGRUPADA POR CONCEPTO Y NO LÍNEA POR LÍNEA
 * ---------------------------------------------------------------------------
 * Porque **285 filas no se auditan**. El tablero B2a lo dice así: tres conceptos
 * con subtotal, los ajustes explícitos con su origen enlazado, y «ver las 285
 * una por una» para cuando hace falta. Eso es lo que permite cuadrar sin
 * exportar — y exportar a Excel es exactamente el momento en que el producto
 * deja de ser la fuente de verdad.
 *
 * LA REGLA CENTRAL DEL PATRÓN
 * ---------------------------------------------------------------------------
 * **La cifra de la cabecera y la del pie son la misma, y las dos llevan su
 * rótulo** —bruto o neto— (regla 18). Hoy, en el detalle de período, la grande
 * es bruto y el pie es neto, y nada lo dice: son dos números distintos con el
 * mismo aspecto. Por eso `rotulo` es obligatorio y no tiene valor por defecto.
 *
 * LOS NEGATIVOS
 * ---------------------------------------------------------------------------
 * Signo menos **real**, tono `fault`, y su causa en la misma fila enlazada al
 * objeto que la originó (regla 20). Nunca un paréntesis y nunca solo color: el
 * paréntesis contable no lo lee quien no es contador, y el color solo desaparece
 * en la impresión y para quien no distingue rojos.
 *
 * LOS IMPUESTOS NO ESTÁN ACÁ
 * ---------------------------------------------------------------------------
 * Regla 22: los calcula y los muestra el documento tributario, no Rutax. Si
 * alguna vez hiciera falta una cifra bruta, iría rotulada «bruto» y con su
 * propio desglose — no como el mismo número con otro nombre.
 */

export type FilaFinanciera =
  | {
      tipo: "linea"
      concepto: string
      entregas?: number
      /** Tarifa unitaria. `undefined` cuando no aplica. */
      tarifa?: number
      monto: number
    }
  | { tipo: "subtotal"; concepto: string; entregas?: number; monto: number }
  | {
      tipo: "ajuste"
      concepto: string
      monto: number
      /** El objeto que lo originó: la incidencia, el pedido. */
      causa?: { texto: string; href?: string }
      /**
       * El motivo escrito, en segunda línea. **Lo lee el conductor** en su
       * liquidación y en su PDF, así que no es una nota interna: es parte de la
       * fila, no un tooltip ni un dato de auditoría.
       */
      motivo?: string
    }
  | { tipo: "total"; concepto: string; entregas?: number; monto: number }

export function TablaFinanciera({
  filas,
  /** «neto» o «bruto». Sin valor por defecto a propósito: la regla 18 lo exige. */
  rotulo,
  cabeceras = ["Concepto", "Entregas", "Tarifa", "Monto"],
  className,
}: {
  filas: FilaFinanciera[]
  rotulo: "neto" | "bruto"
  cabeceras?: [string, string, string, string]
  className?: string
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <caption className="sr-only">
          Líneas agrupadas por concepto. Todas las cifras son {rotulo}.
        </caption>
        <thead>
          <tr className="border-b border-line text-left">
            <th scope="col" className="px-3 py-2 font-mono text-[10px] font-medium tracking-[0.1em] text-fg-subtle uppercase">
              {cabeceras[0]}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-mono text-[10px] font-medium tracking-[0.1em] text-fg-subtle uppercase">
              {cabeceras[1]}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-mono text-[10px] font-medium tracking-[0.1em] text-fg-subtle uppercase">
              {cabeceras[2]}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-mono text-[10px] font-medium tracking-[0.1em] text-fg-subtle uppercase">
              {/* El rótulo va en la cabecera Y en el pie. Es la regla 18. */}
              {cabeceras[3]} {rotulo}
            </th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <FilaTabla key={`${f.tipo}-${f.concepto}-${i}`} fila={f} rotulo={rotulo} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FilaTabla({ fila, rotulo }: { fila: FilaFinanciera; rotulo: "neto" | "bruto" }) {
  const negativo = fila.monto < 0

  if (fila.tipo === "total") {
    return (
      <tr className="border-t-2 border-line-strong">
        <th scope="row" className="px-3 py-2.5 text-left text-[13.5px] font-semibold text-fg">
          {fila.concepto} <span className="font-normal text-fg-muted">({rotulo})</span>
        </th>
        <td className="px-3 py-2.5 text-right font-mono text-fg-muted tabular-nums">
          {fila.entregas ?? ""}
        </td>
        <td className="px-3 py-2.5" />
        <td className="px-3 py-2.5 text-right font-mono text-base font-semibold text-fg tabular-nums">
          {formatearCLP(fila.monto)}
        </td>
      </tr>
    )
  }

  if (fila.tipo === "subtotal") {
    return (
      <tr className="border-b border-line bg-bg-inset">
        <th scope="row" className="px-3 py-2 text-left font-medium text-fg">
          {fila.concepto}
        </th>
        <td className="px-3 py-2 text-right font-mono text-fg-muted tabular-nums">
          {fila.entregas ?? ""}
        </td>
        <td className="px-3 py-2" />
        <td className="px-3 py-2 text-right font-mono font-medium text-fg tabular-nums">
          {formatearCLP(fila.monto)}
        </td>
      </tr>
    )
  }

  if (fila.tipo === "ajuste") {
    return (
      <tr className="border-b border-line-subtle">
        <td className="px-3 py-2 text-fg">
          {fila.concepto}
          {fila.motivo ? (
            <span className="mt-0.5 block text-xs text-fg-muted">Motivo: {fila.motivo}</span>
          ) : null}
          {fila.causa ? (
            <>
              {" · "}
              {fila.causa.href ? (
                <Link href={fila.causa.href} className="text-accent-text hover:underline">
                  {fila.causa.texto}
                </Link>
              ) : (
                <span className="text-fg-muted">{fila.causa.texto}</span>
              )}
            </>
          ) : null}
        </td>
        <td className="px-3 py-2 text-right text-fg-subtle">—</td>
        <td className="px-3 py-2 text-right text-fg-subtle">—</td>
        <td
          className={cn(
            "px-3 py-2 text-right font-mono tabular-nums",
            negativo ? "text-fault-fg" : "text-fg"
          )}
        >
          <Monto valor={fila.monto} />
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-b border-line-subtle">
      <td className="px-3 py-2 text-fg">{fila.concepto}</td>
      <td className="px-3 py-2 text-right font-mono text-fg-muted tabular-nums">
        {fila.entregas ?? "—"}
      </td>
      <td className="px-3 py-2 text-right font-mono text-fg-muted tabular-nums">
        {fila.tarifa !== undefined ? formatearCLP(fila.tarifa) : "—"}
      </td>
      <td
        className={cn(
          "px-3 py-2 text-right font-mono tabular-nums",
          negativo ? "text-fault-fg" : "text-fg"
        )}
      >
        <Monto valor={fila.monto} />
      </td>
    </tr>
  )
}

/**
 * El signo menos es **real** (U+2212, no un guion) y va delante, separado. Un
 * paréntesis contable no lo lee quien no es contador, y el color solo se pierde
 * al imprimir.
 */
function Monto({ valor }: { valor: number }) {
  if (valor >= 0) return <>{formatearCLP(valor)}</>
  return (
    <>
      <span aria-hidden="true">− </span>
      <span className="sr-only">menos </span>
      {formatearCLP(Math.abs(valor))}
    </>
  )
}
