"use client";

/**
 * Cancelar un pedido — con la ceremonia de dinero del sistema.
 * =============================================================================
 *
 * **Fuente del texto: `RUTAX-SISTEMA-DE-MENSAJES.md` → `pedidos.cancelar.conf`,
 * peldaño 2 con motivo.** No se inventa copy acá.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTO ES UNA ACCIÓN DE DINERO Y NO UN CAMBIO DE ESTADO
 * -----------------------------------------------------------------------------
 * Cancelar saca el pedido de una ruta **y anula su línea de cobro**. Cuando el
 * período ya está cerrado ni siquiera puede anularla sola: levanta una excepción
 * bloqueante. Es dinero, y por eso pasa por la misma escalera de fricción que
 * emitir una factura o anular un pago.
 *
 * El diálogo anterior preguntaba «¿estás seguro?» con una descripción genérica:
 * «El pedido pasará a estado Cancelado. No se puede revertir». Correcto y
 * **inútil** — no decía a quién deja sin cobrar, de qué ruta lo saca, ni qué NO
 * hace.
 *
 * -----------------------------------------------------------------------------
 * LA CONSECUENCIA SE ARMA CON DATOS REALES, Y SE CALLA LO QUE NO SABE
 * -----------------------------------------------------------------------------
 * El tablero escribe la frase completa —«Sale de la ruta de R. Muñoz, no se le
 * va a cobrar a Vega Norte y el seguimiento del comprador va a decir que se
 * canceló»— pero cada mitad depende de un dato que puede no existir:
 *
 * · **el conductor**, solo si está asignado;
 * · **el seller**, siempre;
 * · ⚠️ **el seguimiento, SOLO si es de Rutax.** En Flex el comprador ve el de
 *   Mercado Libre y nuestra página de seguimiento ni siquiera responde a ese
 *   pedido. Prometerle que «va a decir que se canceló» sería falso justo en la
 *   fuente que hoy es casi toda la operación.
 *
 * Y la última frase se queda entera porque es la que más se agradece: **«Si el
 * bulto está en tu bodega, queda ahí: esto no organiza la devolución.»** Dice lo
 * que la acción NO hace, que es lo que a las 21:00 nadie tiene claro.
 *
 * -----------------------------------------------------------------------------
 * EL PREFLIGHT DE DOS PASOS SE CONSERVA
 * -----------------------------------------------------------------------------
 * `accionCancelarPedido` trae el preflight adentro: si encuentra líneas de dinero
 * que **no** se anulan solas, responde `requiereConfirmacion` con sus
 * advertencias y el diálogo exige un segundo clic. Eso no es fricción decorativa:
 * es el aviso de que hay plata que va a quedar descuadrada.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DialogConfirmacionDinero } from "@/components/ui/dialog-confirmacion-dinero";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ItemPreflight } from "@/modules/dinero/preflight";

import { accionCancelarPedido } from "./actions-cancelacion";

const MOTIVO_MIN = 10;

interface Props {
  pedidoId: string;
  /** `RX-XXXX-XXXX`, o el identificador de la fuente. Encabeza la consecuencia. */
  codigoVisible: string;
  sellerNombre: string | null;
  /** `null` si todavía no está asignado: entonces no sale de ninguna ruta. */
  conductorNombre: string | null;
  /** `false` en Flex, donde el seguimiento del comprador lo gobierna Mercado Libre. */
  seguimientoEsDeRutax: boolean;
  /**
   * Se llama justo después de cancelar con éxito. Opcional a propósito: en la
   * página completa del pedido (`[pedidoId]/page.tsx`) no hay "panel" que
   * cerrar, y quedarse ahí viendo el pedido ya Cancelado es lo correcto.
   *
   * Quien SÍ lo necesita es el panel lateral de `/operaciones`
   * (`vista-previa.tsx`): sin esto, cancelar dejaba el panel abierto mostrando
   * el mismo pedido —ya cancelado— en vez de volver a la lista, que es donde
   * el coordinador quiere estar para seguir con el siguiente.
   */
  onCancelado?: () => void;
}

export function DialogCancelarPedido({
  pedidoId,
  codigoVisible,
  sellerNombre,
  conductorNombre,
  seguimientoEsDeRutax,
  onCancelado,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [advertencias, setAdvertencias] = useState<ItemPreflight[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const motivoValido = motivo.trim().length >= MOTIVO_MIN;
  const yaAvisado = advertencias.length > 0;

  function reiniciar() {
    setMotivo("");
    setAdvertencias([]);
    setError(null);
  }

  function manejarCambioAbierto(v: boolean) {
    if (isPending) return;
    setOpen(v);
    if (!v) reiniciar();
  }

  function enviar() {
    setError(null);
    const formData = new FormData();
    formData.set("pedidoId", pedidoId);
    formData.set("motivo", motivo.trim());
    // El segundo envío confirma lo que el preflight advirtió en el primero.
    formData.set("confirmado", yaAvisado ? "true" : "false");

    startTransition(async () => {
      const resultado = await accionCancelarPedido(formData);
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      if ("requiereConfirmacion" in resultado) {
        setAdvertencias(resultado.advertencias);
        return;
      }
      setOpen(false);
      reiniciar();
      // Antes del refresh: el panel se cierra ya mismo, sin esperar al viaje
      // al servidor — la lista de atrás se pone al día sola cuando llegue.
      onCancelado?.();
      toast.success("Pedido cancelado", {
        description: "El pedido quedó en estado Cancelado y se avisó en la bitácora.",
      });
      router.refresh();
    });
  }

  /** Las tres mitades de la frase, cada una solo si su dato existe. */
  const partes = [
    conductorNombre ? `Sale de la ruta de ${conductorNombre}` : null,
    sellerNombre ? `no se le va a cobrar a ${sellerNombre}` : "no se va a cobrar",
    seguimientoEsDeRutax ? "el seguimiento del comprador va a decir que se canceló" : null,
  ].filter(Boolean) as string[];

  const frase =
    partes.length > 1
      ? `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}.`
      : `${partes[0]}.`;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Cancelar pedido
      </Button>

      <DialogConfirmacionDinero
        open={open}
        onOpenChange={manejarCambioAbierto}
        titulo={`Vas a cancelar el pedido ${codigoVisible}`}
        consecuencia={
          <>
            {/* Primero, en mayúscula porque abre la frase. */}
            <span>{frase.charAt(0).toUpperCase() + frase.slice(1)}</span>{" "}
            <span>
              Si el bulto está en tu bodega, queda ahí: esto no organiza la devolución.
            </span>
          </>
        }
        onConfirmar={enviar}
        cargando={isPending}
        textoConfirmar={yaAvisado ? "Cancelar de todos modos" : "Cancelar el pedido"}
        textoCancelar="Volver"
        variante="destructive"
        confirmDeshabilitado={!motivoValido}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="motivo-cancelacion">Motivo de la cancelación</Label>
          {/* Regla 6 de contenido: un motivo que va a leer un externo **se
              declara como tal** en el formulario donde se escribe. */}
          <p className="text-sm text-fg-muted">
            Lo lee el seller en su portal.
            {seguimientoEsDeRutax ? "" : " El comprador ve el seguimiento de Mercado Libre, no el nuestro."}
          </p>
          <Textarea
            id="motivo-cancelacion"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            disabled={isPending}
            rows={3}
            placeholder="Ej.: dirección duplicada, el cliente anuló la compra."
            aria-describedby="motivo-cancelacion-ayuda"
          />
          <p id="motivo-cancelacion-ayuda" className="rx-num text-sm text-fg-muted">
            {motivo.trim().length}/{MOTIVO_MIN} caracteres mínimos
          </p>

          {/* Lo que el preflight encontró: plata que NO se anula sola. Se muestra
              embebido y persistente, nunca en notificación temporal (regla 56). */}
          {yaAvisado && (
            <div className="mt-2 border border-attention-line bg-attention-bg p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-attention-fg">
                <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                Esto deja dinero sin cuadrar
              </p>
              <ul className="mt-1.5 space-y-1 text-sm text-attention-fg">
                {advertencias.map((a, i) => (
                  <li key={i}>
                    {a.titulo}
                    {a.detalle ? <span className="block text-fg-muted">{a.detalle}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-2 border border-fault-line bg-fault-bg p-3 text-sm text-fault-fg">
              {error}
            </p>
          )}
        </div>
      </DialogConfirmacionDinero>
    </>
  );
}
