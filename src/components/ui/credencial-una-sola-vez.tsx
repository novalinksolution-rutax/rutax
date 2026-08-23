"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * CredencialUnaSolaVez — un secreto que se muestra una vez y no vuelve.
 *
 * LAS TRES PARTES QUE PIDE LA REGLA 31, Y LA QUE FALTABA
 * ---------------------------------------------------------------------------
 * «Mostrada · copiada · **advertencia previa**». Las dos primeras estaban; la
 * tercera no, y es la que importa:
 *
 * · **La advertencia llegaba DESPUÉS.** El aviso «copia esta clave ahora, no se
 *   mostrará de nuevo» aparecía junto a la clave ya generada. Quien apretó
 *   «Crear» no sabía que estaba abriendo una puerta de un solo sentido.
 * · **Y se podía cerrar sin copiar.** El botón de «Entendido» estaba habilitado
 *   desde el primer instante: un clic de más y la credencial se perdía para
 *   siempre, sin nada que lo impidiera. La única salida es crear otra y cambiarla
 *   donde estuviera puesta.
 *
 * POR QUÉ NO SE OBLIGA A COPIAR
 * ---------------------------------------------------------------------------
 * Forzar el clic en «copiar» sería hostil y además engañoso: mucha gente la
 * anota en su gestor de contraseñas a mano, o la pega directamente en el
 * servidor donde va. Lo que se exige es **declarar que ya está guardada** — es
 * el peldaño 2 de la escalera de fricción aplicado a una puerta de un solo
 * sentido, y copiar marca la casilla solo.
 *
 * El valor va en un `<input readonly>` y no en un `<p>`: se puede seleccionar
 * con el teclado, el lector de pantalla lo anuncia como valor y el gestor de
 * contraseñas lo reconoce.
 */
export function CredencialUnaSolaVez({
  /** El secreto. Se muestra completo: ocultarlo a medias no protege de nada. */
  valor,
  /** Qué es, en los términos de quien lo va a usar. */
  etiqueta,
  /** Qué pasa si se pierde. Es lo que justifica la fricción. */
  consecuencia,
  textoConfirmar = "Ya la guardé",
  onConfirmar,
  className,
}: {
  valor: string
  etiqueta: string
  consecuencia: React.ReactNode
  textoConfirmar?: string
  onConfirmar: () => void
  className?: string
}) {
  const [copiado, setCopiado] = useState(false)
  const [declarado, setDeclarado] = useState(false)

  function copiar() {
    void navigator.clipboard.writeText(valor).then(() => {
      setCopiado(true)
      // Copiar ES declarar: no tiene sentido pedir las dos cosas.
      setDeclarado(true)
    })
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div
        role="alert"
        className="border border-attention-line bg-attention-bg px-3 py-2.5 text-sm leading-relaxed text-attention-fg"
      >
        <strong className="font-semibold">Esta es la única vez que se muestra.</strong>{" "}
        {consecuencia}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="credencial-valor" className="text-xs font-medium text-fg">
          {etiqueta}
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="credencial-valor"
            readOnly
            value={valor}
            className="font-mono text-sm"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={copiar}
            aria-label={copiado ? "Copiada" : "Copiar"}
          >
            {copiado ? (
              <Check className="size-4 text-balanced-fg" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 border border-line p-3 text-sm text-fg">
        <Checkbox
          checked={declarado}
          onCheckedChange={(v) => setDeclarado(v === true)}
          className="mt-0.5"
        />
        <span>La guardé en un lugar seguro.</span>
      </label>

      {/* Deshabilitado hasta que se declare: cerrar sin guardar es perder la
          credencial, y nada lo impedía. */}
      <Button onClick={onConfirmar} disabled={!declarado} className="self-end">
        {textoConfirmar}
      </Button>
    </div>
  )
}
