"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FranjaModoPruebas } from "@/components/ui/franja-modo-pruebas"
import { BloqueComposicion, type SumandoComposicion } from "@/components/ui/bloque-composicion"
import { formatearCLP } from "@/lib/ui/formato-moneda"

/**
 * ModalActoExplicito — la ceremonia de una acción irreversible.
 *
 * Una sola, para las 26 acciones irreversibles del producto. Reemplaza a
 * `dialog-confirmacion-dinero`, que soportaba dos peldaños de fricción y no el
 * tercero. Fuente: tablero `Rutax P4 Emitir factura` y
 * `RUTAX-SISTEMA-DE-MENSAJES.md` §2, donde cada acción trae su peldaño escrito.
 *
 * LOS TRES PELDAÑOS
 * ---------------------------------------------------------------------------
 *   1 · consecuencia escrita y botón. Para lo reversible con costo.
 *   2 · lo anterior + motivo escrito, cuando un tercero va a leer el porqué.
 *   3 · lo anterior + **escribir el nombre de la contraparte**.
 *
 * POR QUÉ EL PELDAÑO 3 ES ESCRIBIR Y NO UNA CASILLA
 * ---------------------------------------------------------------------------
 * Porque es lo único que obliga a leer **a quién**. El tablero lo dice sin
 * rodeos: *el error real de este flujo no es emitir sin querer, es emitirle al
 * seller equivocado en una lista de diez.* Una casilla se marca sin mirar; un
 * nombre hay que copiarlo del cuadro de arriba.
 *
 * LO QUE NO ES NEGOCIABLE
 * ---------------------------------------------------------------------------
 * · **Describe la consecuencia, no pregunta si estás seguro.** «¿Estás seguro?»
 *   no aporta información y entrena a apretar que sí.
 * · **No se cierra por accidente:** escape no cierra, el clic fuera no cierra,
 *   no hay X. La única salida es «Volver» — que se llama así y no «Cancelar»,
 *   porque en este dominio cancelar es cancelar un pedido (regla 59).
 * · **El botón de confirmar no es destino de tabulación** hasta que la
 *   confirmación calza. Tabular hasta él y apretar enter es exactamente el
 *   accidente que la ceremonia existe para impedir.
 * · **El autor va dentro del modal**, antes de actuar: es parte de lo que se
 *   está firmando, no un dato de auditoría escondido.
 * · **El total lleva su composición.** Regla 21.
 * · **El modo de pruebas usa la trama**, no un color —sería un séptimo tono— y
 *   aparece dos veces: en el marco y **dentro del botón**.
 */

export interface FilaResumen {
  etiqueta: string
  valor: React.ReactNode
  /** En mono: folios, RUT, códigos. */
  mono?: boolean
}

export interface AutorActo {
  nombre: string
  /** Ya formateado en zona de Santiago por quien llama. */
  cuando: string
}

/**
 * El comprobante en sitio — decisión 4 del tablero P4: **el modal no se cierra,
 * se convierte en comprobante**.
 *
 * Antes, toda acción irreversible terminaba con el cuadro desapareciendo y una
 * notificación temporal de 4 segundos. En una emisión eso es exactamente el
 * peor final posible: el folio YA se consumió, la pregunta siguiente de
 * Administración es «¿cuál?», y la respuesta se acaba de esfumar. Es la misma
 * regla 56 que prohíbe el error de dinero en un toast, del otro lado.
 *
 * El camino de vuelta se cierra al confirmar: ya no hay «Volver», hay «Cerrar».
 */
export interface ComprobanteActo {
  /** `progress` para lo que quedó en curso; `balanced` para lo consumado. */
  tono: "progress" | "balanced" | "attention" | "fault"
  titulo: string
  cuerpo: React.ReactNode
  /** Lo que hay que poder leer después. El folio consumido va acá. */
  datos?: FilaResumen[]
  /** Dónde ver el desenlace, que toda acción asíncrona debe ofrecer. */
  enlace?: { texto: string; href: string }
}

export function ModalActoExplicito({
  open,
  onOpenChange,
  peldano,
  titulo,
  consecuencia,
  resumen = [],
  total,
  composicion,
  avisos = [],
  motivo,
  confirmacion,
  autor,
  modoPruebas = false,
  onConfirmar,
  cargando = false,
  confirmDeshabilitado = false,
  textoConfirmar,
  subtextoConfirmar,
  variante = "primary",
  children,
  comprobante,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 1 · consecuencia · 2 · + motivo · 3 · + escribir la contraparte. */
  peldano: 1 | 2 | 3
  /** Molde: «Vas a [acción] a [contraparte]», con la contraparte al final. */
  titulo: string
  consecuencia: React.ReactNode
  resumen?: FilaResumen[]
  total?: { etiqueta: string; monto: number }
  composicion?: SumandoComposicion[]
  /** Avisos embebidos: la verificación previa omitida, reparos pendientes. */
  avisos?: { tono: "attention" | "fault"; texto: React.ReactNode }[]
  /** Peldaño 2: el motivo que un tercero va a leer. */
  motivo?: {
    valor: string
    onCambio: (v: string) => void
    etiqueta: string
    /** Se declara cuando un externo lo va a leer (regla 24). */
    ayuda?: string
    minimo?: number
  }
  /** Peldaño 3: la frase exacta que hay que escribir. */
  confirmacion?: { frase: string; rotulo?: React.ReactNode }
  autor?: AutorActo
  modoPruebas?: boolean
  onConfirmar: () => void
  cargando?: boolean
  /**
   * Gate del padre, independiente de los peldaños: la verificación previa
   * encontró bloqueos, falta un dato, el período cambió de estado.
   *
   * ⚠️ Sin esto el modal habilitaría el botón en cuanto la frase calce, aunque
   * hubiera bloqueos vivos. El tablero P4 es explícito: **bloqueado se muestra
   * deshabilitado CON MOTIVO, nunca oculto** — el motivo va en `avisos`.
   */
  confirmDeshabilitado?: boolean
  textoConfirmar?: string
  /** Segunda línea del botón, en mono: «$ 864.100 · folio 1042». */
  subtextoConfirmar?: string
  variante?: "primary" | "destructive"
  children?: React.ReactNode
  /**
   * Cuando llega, el cuadro deja de ser ceremonia y pasa a ser comprobante: se
   * apagan el motivo, la confirmación y el botón de confirmar.
   */
  comprobante?: ComprobanteActo | null
}) {
  const [escrito, setEscrito] = React.useState("")
  const idConfirmacion = React.useId()
  const idMotivo = React.useId()

  // Estado derivado del prop, ajustado en render (patrón del proyecto: nada de
  // `setState` dentro de un effect).
  const [prevOpen, setPrevOpen] = React.useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (!open) setEscrito("")
  }

  const minimoMotivo = motivo?.minimo ?? 5
  const motivoListo = peldano < 2 || !motivo || motivo.valor.trim().length >= minimoMotivo
  // Comparación tolerante con espacios de sobra, estricta con el resto: copiar
  // el nombre y que sobre un espacio no es el error que esto ataja.
  const frase = confirmacion?.frase?.trim() ?? ""
  // ⚠️ FALLA CERRADO. Antes, un peldaño 3 SIN `confirmacion` se daba por listo:
  // `!confirmacion` devolvía `true` y el botón quedaba habilitado sin escribir
  // nada. No es hipotético — el pago a conductor arma su frase con el monto, y
  // el monto puede venir nulo mientras la verificación previa no ha respondido.
  // O sea: la ceremonia más cara del producto se saltaba sola en el peor
  // momento. Si alguien pide peldaño 3, tiene que dar la frase.
  // Y una frase EN BLANCO tampoco es una frase: se normalizaría a "" y calzaría
  // con el campo vacío, o sea un peldaño 3 que no gatea nada.
  const confirmacionLista =
    peldano < 3 || (frase.length > 0 && escrito.trim() === frase)

  const habilitado = !cargando && !confirmDeshabilitado && motivoListo && confirmacionLista

  return (
    <Dialog open={open} onOpenChange={cargando ? undefined : onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-h-[92svh] gap-0 overflow-y-auto p-0 sm:max-w-xl"
        style={{
          borderTopWidth: 2,
          // El filo de arriba cambia con el desenlace: rojo mientras es un acto
          // por firmar, el tono del resultado una vez firmado.
          borderTopColor: comprobante
            ? `var(--rx-${comprobante.tono}-fg)`
            : "var(--rx-fault-fg)",
        }}
      >
        {modoPruebas ? <FranjaModoPruebas /> : null}

        <DialogHeader className="space-y-2 px-5 pt-5 text-left">
          <DialogTitle className="text-xl leading-snug font-semibold">
            {comprobante ? comprobante.titulo : titulo}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {comprobante ? comprobante.cuerpo : consecuencia}
          </DialogDescription>
        </DialogHeader>

        {resumen.length > 0 || total ? (
          <div className="mx-5 mt-4 border border-line bg-bg-sunken">
            {resumen.map((f) => (
              <div
                key={f.etiqueta}
                className="flex items-baseline justify-between gap-4 border-b border-line-subtle px-3 py-2 text-[12.5px]"
              >
                <span className="text-fg-muted">{f.etiqueta}</span>
                <span className={cn("text-right font-medium text-fg", f.mono && "font-mono")}>
                  {f.valor}
                </span>
              </div>
            ))}
            {total ? (
              <>
                {/* La regla de 2 px sobre el total: es la jerarquía de suma que
                    el sistema le pide a toda tabla financiera. */}
                <div className="flex items-baseline justify-between gap-4 border-t-2 border-primary px-3 py-2.5">
                  <span className="text-[13.5px] font-semibold text-fg">{total.etiqueta}</span>
                  <span className="font-mono text-xl font-semibold text-fg tabular-nums">
                    {formatearCLP(total.monto)}
                  </span>
                </div>
                {composicion?.length ? (
                  <BloqueComposicion sumandos={composicion} className="px-3 pb-2.5" />
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {comprobante?.datos?.length ? (
          <div className="mx-5 mt-4 border border-line bg-bg-sunken">
            {comprobante.datos.map((f) => (
              <div
                key={f.etiqueta}
                className="flex items-baseline justify-between gap-4 border-b border-line-subtle px-3 py-2 text-[12.5px] last:border-b-0"
              >
                <span className="text-fg-muted">{f.etiqueta}</span>
                <span className={cn("text-right font-medium text-fg", f.mono && "font-mono")}>
                  {f.valor}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {/* La verificación previa, el motivo y la confirmación son ceremonia:
            una vez firmado el acto, no tienen nada que hacer en pantalla. */}
        {children && !comprobante ? <div className="px-5 pt-4">{children}</div> : null}

        {avisos.map((a, i) => (
          <div
            key={i}
            className={cn(
              "mx-5 mt-4 border px-3 py-2.5 text-xs leading-relaxed",
              a.tono === "fault"
                ? "border-fault-line bg-fault-bg text-fault-fg"
                : "border-attention-line bg-attention-bg text-attention-fg"
            )}
          >
            {a.texto}
          </div>
        ))}

        {peldano >= 2 && motivo && !comprobante ? (
          <div className="space-y-1.5 px-5 pt-4">
            <label htmlFor={idMotivo} className="block text-xs font-medium text-fg">
              {motivo.etiqueta}
            </label>
            <Textarea
              id={idMotivo}
              value={motivo.valor}
              onChange={(e) => motivo.onCambio(e.target.value)}
              disabled={cargando}
              rows={2}
            />
            {motivo.ayuda ? <p className="text-xs text-fg-muted">{motivo.ayuda}</p> : null}
          </div>
        ) : null}

        {peldano >= 3 && confirmacion && !comprobante ? (
          <div className="space-y-1.5 px-5 pt-4">
            <label htmlFor={idConfirmacion} className="block text-xs font-medium text-fg-muted">
              {confirmacion.rotulo ?? (
                <>
                  Escribe <strong className="text-fg">{confirmacion.frase}</strong> para confirmar
                </>
              )}
            </label>
            <Input
              id={idConfirmacion}
              value={escrito}
              onChange={(e) => setEscrito(e.target.value)}
              disabled={cargando}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              // El foco entra acá: es el primer acto de la ceremonia.
              autoFocus
              placeholder={confirmacion.frase}
            />
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-start gap-2.5 border-t border-line-subtle bg-bg-sunken px-5 py-4">
          {comprobante ? (
            <>
              <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
              {comprobante.enlace ? (
                <Button variant="outline" asChild>
                  <a href={comprobante.enlace.href}>{comprobante.enlace.texto}</a>
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Button
                variant={variante === "destructive" ? "destructive" : "default"}
                onClick={onConfirmar}
                disabled={!habilitado}
                loading={cargando}
                // No es destino de tabulación mientras no calce: tabular hasta
                // acá y apretar enter es justo el accidente que esto existe
                // para impedir.
                tabIndex={habilitado ? undefined : -1}
                className="h-auto flex-col items-start gap-0.5 py-2.5 text-left"
              >
                <span>
                  {textoConfirmar ?? "Confirmar"}
                  {modoPruebas ? " en modo de pruebas" : ""}
                </span>
                {subtextoConfirmar ? (
                  <span className="font-mono text-[11px] font-medium opacity-80">
                    {subtextoConfirmar}
                  </span>
                ) : null}
              </Button>
              {/* «Volver», nunca «Cancelar» (regla 59): cancelar es lo que le
                  pasa a un pedido, no lo que hace quien cierra un cuadro. */}
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={cargando}>
                Volver
              </Button>
            </>
          )}
          {autor ? (
            <span className="ml-auto pt-1 text-right font-mono text-[11px] leading-snug text-fg-subtle">
              {autor.nombre}
              <br />
              {autor.cuando}
            </span>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}


