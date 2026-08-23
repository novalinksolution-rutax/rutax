import { CheckCircle2, Clock, ShieldAlert, TriangleAlert } from "lucide-react"

import { cn } from "@/lib/utils"
import { DistintivoEstado } from "@/components/ui/distintivo-estado"
import type { TonoEstado } from "@/lib/ui/tonos-estado"
import {
  TEXTO_SALUD_CONEXION,
  type EstadoSaludConexion,
} from "@/lib/ui/traduccion-estados"

/**
 * TarjetaSaludConexion — el estado de una cuenta conectada, en un solo idioma.
 *
 * TRES VOCABULARIOS PARA CUATRO ESTADOS
 * ---------------------------------------------------------------------------
 * Los mismos cuatro estados se llamaban de tres formas distintas, en tres
 * archivos:
 *
 * | estado         | `traduccion-estados` | panel de ML                 | panel de Shopify        |
 * |----------------|----------------------|-----------------------------|-------------------------|
 * | `sana`         | Conectado            | Conectada y sincronizando   | Conectada               |
 * | `atencion`     | Requiere atención    | Necesita atención           | **Con problemas**       |
 * | `desvinculada` | Desconectado         | Desconectada — reconéctala  | Desconectada            |
 * | `pendiente`    | Sin conectar         | Configurando…               | Sin sincronizar todavía |
 *
 * Y no es un detalle de estilo: **el seller ve las dos en la misma pantalla**.
 * Su cuenta de ML «necesita atención» y su tienda Shopify está «con problemas»
 * — dos nombres para lo mismo, uno al lado del otro, y nada que le diga que son
 * el mismo estado.
 *
 * Gana la redacción del panel de ML, que era la única **accionable**: dice qué
 * pasa y qué hacer, no solo cómo se llama.
 *
 * EL TONO SALE DEL SISTEMA
 * ---------------------------------------------------------------------------
 * Cada panel tenía su propio mapa de colores con alfas sueltos
 * (`bg-success/15`, `border-warning/30`, `variant="error"`). Acá son los seis
 * tonos, con su glifo: el color nunca es el único canal (regla 5).
 *
 * `pendiente` va en **neutro**, no en ámbar: una cuenta recién creada que
 * todavía no sincronizó no es una advertencia — es el estado normal de algo que
 * acaba de empezar. Mismo criterio que el resto del producto.
 */

const TONO: Record<EstadoSaludConexion, TonoEstado> = {
  sana: "balanced",
  atencion: "attention",
  // `fault` sin matices: dejaron de llegar pedidos. Es una pérdida en curso.
  desvinculada: "fault",
  pendiente: "neutral",
}

const ICONO: Record<EstadoSaludConexion, typeof CheckCircle2> = {
  sana: CheckCircle2,
  atencion: TriangleAlert,
  desvinculada: ShieldAlert,
  pendiente: Clock,
}

// La redacción vive en `traduccion-estados.ts`, que es el único sitio donde
// vive el vocabulario del producto. Tener un TITULO propio acá habría creado el
// cuarto vocabulario, que es justo lo que este componente vino a cerrar.

/** Si reconectar es la salida. `pendiente` y `sana` no la ofrecen. */
export function pideReconectar(estado: EstadoSaludConexion): boolean {
  return estado === "atencion" || estado === "desvinculada"
}

export function tonoSaludConexion(estado: EstadoSaludConexion): TonoEstado {
  return TONO[estado] ?? "neutral"
}

export function TarjetaSaludConexion({
  estado,
  /** Nombre de la cuenta o tienda. Va como identificación, no como marca. */
  nombre,
  /** Segunda línea: última sincronización, desde cuándo está caída. */
  detalle,
  /** Botón de reconexión y demás: los pone el llamador, que sabe a dónde van. */
  acciones,
  /** El `bloque de falla externa`, cuando corresponde. */
  pie,
  className,
}: {
  estado: EstadoSaludConexion
  nombre: React.ReactNode
  detalle?: React.ReactNode
  acciones?: React.ReactNode
  pie?: React.ReactNode
  className?: string
}) {
  const Icono = ICONO[estado] ?? Clock
  const tono = tonoSaludConexion(estado)

  return (
    <div className={cn("border border-line bg-card", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <Icono className="mt-0.5 size-5 shrink-0 text-fg-muted" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium text-fg">{nombre}</span>
              <DistintivoEstado tono={tono} etiqueta={TEXTO_SALUD_CONEXION[estado] ?? estado} />
            </div>
            {detalle ? <div className="text-xs text-fg-muted">{detalle}</div> : null}
          </div>
        </div>
        {acciones ? <div className="flex shrink-0 items-center gap-2">{acciones}</div> : null}
      </div>

      {pie ? <div className="border-t border-line-subtle px-4 py-3">{pie}</div> : null}
    </div>
  )
}
