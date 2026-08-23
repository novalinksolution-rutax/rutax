import { AlertTriangle, CheckCircle2 } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * TarjetaResultadoBloque — qué se hizo, qué no, y por qué.
 *
 * El sistema de diseño la describe en la escena de las 15:50: «la selección se
 * contrae hacia una tarjeta de resultado … trae el conteo, la composición —"30
 * asignados · 24 paradas · 2 comunas"— y el detalle de lo que no se pudo. **Es
 * el momento de más alivio del día y hoy termina en una lista seca.**»
 *
 * LAS TRES PARTES, Y POR QUÉ SON TRES
 * ---------------------------------------------------------------------------
 * 1. **El titular** dice qué pasó, en el tiempo verbal correcto. Si la acción es
 *    asíncrona —emitir facturas encola trabajos— dice «quedaron en curso», no
 *    «se emitieron» (decisión 6 del tablero P4). Alguien que lee «emitidas» va
 *    a buscar los folios y no están.
 * 2. **La composición** son las cifras que uno necesita sin abrir nada: cuánta
 *    plata, cuántas contrapartes. Un resultado de dinero sin monto obliga a
 *    volver a sumar (regla 57).
 * 3. **Lo que no se pudo, con su motivo al lado.** Esta parte no se colapsa
 *    nunca: es la única accionable, y esconderla detrás de un «ver detalle»
 *    convierte un lote parcial en un lote que parece completo.
 *
 * Lo que salió bien **sí** se resume en una cifra en vez de enumerarse: veinte
 * líneas verdes idénticas entierran las tres rojas que importan.
 */

export interface FalloBloque {
  /** Cómo se llama lo que falló, en los términos del usuario. */
  etiqueta: string
  /** Por qué no se pudo. `null` cuando el dominio no dio razón. */
  motivo: string | null
}

export function TarjetaResultadoBloque({
  titulo,
  /** Cifras que se leen sin abrir nada: monto total, cuántas contrapartes. */
  composicion = [],
  fallos = [],
  /** Cuántos salieron bien. Se muestra como cifra, no como lista. */
  exitosos,
  className,
}: {
  titulo: string
  composicion?: string[]
  fallos?: FalloBloque[]
  exitosos: number
  className?: string
}) {
  const hayFallos = fallos.length > 0
  // El tono lo manda lo que quedó pendiente, no lo que salió: un lote con tres
  // errores no es un éxito con nota al pie.
  const tono = hayFallos ? "attention" : "balanced"

  return (
    <div
      className={cn("border border-line bg-bg-sunken", className)}
      style={{ borderTopWidth: 2, borderTopColor: `var(--rx-${tono}-fg)` }}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col gap-1 px-4 py-3">
        <span className="flex items-start gap-2">
          {hayFallos ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-attention-fg" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-balanced-fg" aria-hidden="true" />
          )}
          <span className="font-heading text-[15px] leading-snug font-semibold text-fg">
            {titulo}
          </span>
        </span>
        {composicion.length > 0 ? (
          // En mono y separada por puntos: son cifras, y se leen de un vistazo
          // sin tener que abrir la lista.
          <span className="pl-6 font-mono text-[11.5px] leading-relaxed text-fg-muted tabular-nums">
            {composicion.join(" · ")}
          </span>
        ) : null}
      </div>

      {hayFallos ? (
        <div className="border-t border-line-subtle px-4 py-3">
          <p className="text-xs font-medium text-fg">
            {fallos.length === 1
              ? "Uno no se pudo, y este es el motivo:"
              : `${fallos.length} no se pudieron, y estos son los motivos:`}
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {fallos.map((f, i) => (
              <li key={`${f.etiqueta}-${i}`} className="flex items-start gap-2 text-[12.5px]">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-attention-fg" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="text-fg">{f.etiqueta}</span>
                  {/* El motivo va en la misma fila que su hecho (regla 20). Sin
                      motivo se dice que no lo hay, en vez de dejar el hueco: un
                      espacio en blanco se lee como «no falló». */}
                  <span className="block text-xs text-fg-muted">
                    {f.motivo ?? "Sin motivo registrado."}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {exitosos > 0 ? (
            <p className="mt-3 text-xs text-fg-subtle">
              Los otros {exitosos} sí salieron.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
