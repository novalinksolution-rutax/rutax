import { cn } from "@/lib/utils"

/**
 * BloqueFallaExterna — qué se rompió sin poder decir qué, y qué hacer igual.
 *
 * POR QUÉ UN `alert` NO ALCANZA
 * ---------------------------------------------------------------------------
 * Un aviso genérico sirve cuando se sabe qué pasó. Acá el caso típico es el
 * contrario: **el sondeo de salud de Mercado Libre no distingue causas.** Token
 * vencido, token revocado por el seller y fallo de descifrado del secreto
 * terminan los tres en «desconectada», y desde afuera no hay forma de saber
 * cuál fue. Decir «tu token expiró» sería inventar; decir solo «desconectada»
 * deja a la persona sin saber qué se rompió ni qué sigue en pie.
 *
 * ⚠️ REGLA 60 · UN ERROR DE INTEGRACIÓN DICE SIEMPRE QUÉ SIGUE FUNCIONANDO
 * ---------------------------------------------------------------------------
 * Es la parte que casi nunca está y la que más calma. Cuando un seller lee
 * «tu cuenta se desconectó», lo que se pregunta no es qué pasó: es **si perdió
 * los pedidos que ya tenía y si le van a cobrar igual**. Sin esa respuesta,
 * llama por teléfono — y la llamada la contesta el courier, que tampoco sabe.
 *
 * Por eso `sigueFuncionando` **no es opcional**: si no se puede nombrar qué
 * sobrevive, este bloque no es el componente correcto.
 *
 * NO SE MUESTRA EL MENSAJE DEL PROVEEDOR
 * ---------------------------------------------------------------------------
 * «invalid_grant», «AuthApiError», «fetch failed» no le dicen nada a nadie y sí
 * dicen de más sobre cómo está armado el sistema por dentro. El detalle técnico
 * va a la bitácora; acá va lo que la persona puede hacer.
 */
export function BloqueFallaExterna({
  /** Qué dejó de funcionar, en los términos de quien lee. */
  titulo,
  /**
   * Qué se sabe y qué no. Si no se puede determinar la causa, **decirlo** es
   * mejor que elegir una: el que lee va a actuar igual, y si acierta por
   * casualidad la próxima vez confía en un diagnóstico que no existe.
   */
  queSabemos,
  /**
   * Lo que NO se rompió. Obligatorio (regla 60): es lo primero que se pregunta
   * quien lee, y lo que evita la llamada telefónica.
   */
  sigueFuncionando,
  /** La acción que sirve para todas las causas posibles. */
  accion,
  className,
}: {
  titulo: string
  queSabemos: React.ReactNode
  sigueFuncionando: React.ReactNode
  accion?: React.ReactNode
  className?: string
}) {
  return (
    <div
      role="status"
      className={cn("border border-line bg-bg-sunken", className)}
      // `attention` y no `fault`: algo dejó de funcionar, pero nada se perdió y
      // hay una salida. El rojo queda para lo que sí es una pérdida.
      style={{ borderTopWidth: 2, borderTopColor: "var(--rx-attention-fg)" }}
    >
      <div className="flex flex-col gap-2 px-4 py-3">
        <p className="font-heading text-sm leading-snug font-semibold text-fg">{titulo}</p>
        <p className="text-[12.5px] leading-relaxed text-fg-muted">{queSabemos}</p>
      </div>

      {/* Lo que sigue en pie va en su propio bloque, separado por una regla: si
          se mezcla con el problema, se lee como parte del problema. */}
      <div className="border-t border-line-subtle px-4 py-3">
        <p className="text-xs font-medium text-fg">Esto sigue funcionando</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">{sigueFuncionando}</p>
      </div>

      {accion ? <div className="border-t border-line-subtle px-4 py-3">{accion}</div> : null}
    </div>
  )
}
