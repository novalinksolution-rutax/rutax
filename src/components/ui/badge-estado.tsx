import { DistintivoEstado } from "@/components/ui/distintivo-estado"
import { tonoDeEstado, tonoDesdeVariante, type TonoEstado, type VarianteHeredada } from "@/lib/ui/tonos-estado"
import type { BadgeVariante } from "@/lib/ui/traduccion-estados"

/**
 * BadgeEstado — ⚠️ COMPONENTE PUENTE. Para código nuevo, usa `DistintivoEstado`.
 *
 * Este componente ya no dibuja nada: delega en `DistintivoEstado`, que es el
 * render canónico del sistema de diseño nuevo. Existe solo para que las 42
 * pantallas que ya lo llamaban hereden el sistema **sin tocar un solo archivo**.
 * Es la misma jugada que el puente de tokens, un nivel más arriba.
 *
 * POR QUÉ NO SE REEMPLAZÓ DE UNA
 * ---------------------------------------------------------------------------
 * Porque lo nuevo y lo viejo tienen que convivir meses: esto se construye sobre
 * un producto en producción con clientes reales. Migrar 42 archivos de una vez
 * es un cambio que nadie puede revisar.
 *
 * CÓMO SE MIGRA UNA LLAMADA
 * ---------------------------------------------------------------------------
 * Pásale `eje` y `valor`, y el distintivo aplica las correcciones del sistema
 * de diseño en vez de la traducción mecánica:
 *
 *   antes:  <BadgeEstado variante={BADGE_ESTADO_PEDIDO[p.estado]} texto={…} />
 *   ahora:  <BadgeEstado variante={…} texto={…} eje="pedido" valor={p.estado} />
 *
 * Sin esos dos datos no se puede: la variante heredada ya perdió de qué eje
 * venía, y las correcciones son por `eje:valor`. Un `cancelado` y un `pendiente`
 * llegan acá indistinguibles, los dos como `neutral`, y solo el primero tiene
 * que ir en `inert` con su trama.
 */

/**
 * Traducción mecánica desde las variantes de `<Badge>`. Es la que se aplica
 * cuando la llamada todavía no declara su eje.
 */
const BADGE_A_VARIANTE: Record<BadgeVariante, VarianteHeredada> = {
  success: "exito",
  info: "info",
  warning: "advertencia",
  destructive: "error",
  error: "error",
  neutral: "neutral",
  secondary: "neutral",
  outline: "neutral",
  default: "marca",
}

export function BadgeEstado({
  variante,
  texto,
  conPunto = true,
  eje,
  valor,
  className,
}: {
  variante: BadgeVariante
  texto: string
  /** Antes controlaba el punto de color; ahora controla el glifo, que es su
   *  reemplazo y cumple la misma función mejor: sobrevive al monocromo. */
  conPunto?: boolean
  /** Eje de estado (`pedido`, `seller`, `liquidacion`…). Habilita las correcciones. */
  eje?: string
  /** Valor literal del enum, tal como viene de la base. */
  valor?: string
  className?: string
}) {
  const heredada = BADGE_A_VARIANTE[variante] ?? "neutral"
  const tono: TonoEstado =
    eje && valor ? tonoDeEstado(eje, valor, heredada) : tonoDesdeVariante(heredada)

  return <DistintivoEstado tono={tono} etiqueta={texto} conGlifo={conPunto} className={className} />
}
