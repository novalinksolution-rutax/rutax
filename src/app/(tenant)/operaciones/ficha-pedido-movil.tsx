"use client";

/**
 * La fila de pedido en un teléfono: una ficha de tres líneas.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL TELÉFONO NO ES UNA REDUCCIÓN DE LA TABLA
 * -----------------------------------------------------------------------------
 * Una tabla de siete columnas a 390 px se puede achicar de dos maneras y las dos
 * son malas: con desplazamiento horizontal —donde el dato que buscas está
 * siempre fuera de pantalla— o encogiendo la tipografía hasta que el nombre del
 * destinatario deje de leerse a un brazo de distancia. Este es el sitio del
 * producto donde eso importa más: el coordinador lo usa **de pie en la bodega,
 * con una mano**, no sentado.
 *
 * Así que a 390 px la fila deja de ser una fila. Es una ficha de tres líneas:
 *
 * · **Arriba**, el estado y la procedencia — lo que se barre.
 * · **Al medio**, el destinatario **a 16 px**, que es el único texto que se lee
 *   de verdad a la distancia de trabajo.
 * · **Abajo**, en monoespaciada, lo que se cayó: código, comuna o motivo, y
 *   conductor. Lo arma `lineaSecundaria`, la misma pieza que usa la tabla.
 *
 * -----------------------------------------------------------------------------
 * LA CASILLA QUE NO ESTÁ
 * -----------------------------------------------------------------------------
 * El tablero dibuja una casilla de selección a la izquierda. **No se construye
 * acá**, y no por olvido: Pedidos no tiene ninguna acción en bloque —la
 * selección múltiple vive en la bandeja de asignar, que sí asigna—. Una casilla
 * que selecciona y no lleva a ninguna parte es peor que ninguna: promete una
 * acción que no existe y ocupa 44 px del ancho más escaso del producto.
 *
 * Entra el día que Pedidos tenga qué hacer con una selección, y ese día llega
 * con `CasillaTactil` y el barrido vertical, que ya están construidos.
 */

import { ChevronRight } from "lucide-react";

import { BadgeEstado } from "@/components/ui/badge-estado";
import { cn } from "@/lib/utils";
import { etiquetaFuenteCorta } from "@/lib/ui/etiqueta-fuente-pedido";
import { BADGE_ESTADO_PEDIDO, traducirEstadoPedido } from "@/lib/ui/traduccion-estados";
import type { Pedido, TipoIncidencia } from "@/modules/operacion/tipos";

import { lineaSecundaria, motivoDeFila, nombreCortoConductor } from "./motivo-fila";
import { MarcaFilaActualizada } from "./cambios-en-vivo";
import { useVistaPrevia } from "./vista-previa";

export function FichaPedidoMovil({
  pedido,
  conductorNombre,
  tipoIncidencia,
}: {
  pedido: Pedido;
  conductorNombre: string | null;
  tipoIncidencia: TipoIncidencia | null;
}) {
  const vistaPrevia = useVistaPrevia();
  const motivo = motivoDeFila(pedido, tipoIncidencia);
  const fueraDeJuego = pedido.estado === "cancelado";

  // En el teléfono **han caído las cuatro columnas y también conductor**, así que
  // la línea de abajo los recupera a todos.
  const linea = lineaSecundaria({
    codigo: pedido.codigoInterno ?? null,
    comuna: pedido.destinatarioComuna ?? null,
    conductor: nombreCortoConductor(conductorNombre),
    motivo,
  });

  return (
    // Un `button`, no un enlace: tocar la ficha **abre la vista previa**, que en
    // 390 px es una hoja inferior al 85 % del alto. El detalle completo sale del
    // pie de esa hoja, igual que en escritorio.
    <button
      type="button"
      onClick={() => vistaPrevia?.abrir(pedido.id)}
      aria-label={`Ver ${pedido.destinatarioNombre}`}
      className={cn(
        "w-full text-left",
        // El borde de «cambió recién» se pinta con `:has()`, igual que en la
        // tabla: la marca vive dentro y la ficha reacciona.
        "flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0",
        "has-[[data-actualizada]]:border-l-2 has-[[data-actualizada]]:border-l-progress-line",
        vistaPrevia?.pedidoId === pedido.id && "border-l-2 border-l-brand",
        fueraDeJuego && "rx-inert-row text-fg-muted",
      )}
    >
      <div className="min-w-0 flex-1">
        {/* 1 · Estado y procedencia: lo que se barre de un vistazo. */}
        <div className="flex items-center gap-2">
          <BadgeEstado
            variante={BADGE_ESTADO_PEDIDO[pedido.estado]}
            texto={traducirEstadoPedido(pedido.estado)}
            eje="pedido"
            valor={pedido.estado}
          />
          <span className="rx-num font-mono text-[11px] tracking-[0.06em] text-fg-muted uppercase">
            {etiquetaFuenteCorta(pedido.fuente)}
          </span>
          <MarcaFilaActualizada id={pedido.id} />
        </div>

        {/* 2 · El destinatario a 16 px. Es el único texto pensado para leerse
            de pie, a un brazo de distancia, con el teléfono en una mano. */}
        <p className="mt-1 truncate text-base font-medium text-fg">{pedido.destinatarioNombre}</p>

        {/* 3 · Lo que se cayó, en monoespaciada. El código se dicta por teléfono
            y se busca en un manifiesto impreso: la proporcional lo vuelve
            ilegible para eso. */}
        {linea.length > 0 && (
          <p className="rx-num mt-0.5 truncate font-mono text-xs text-fg-muted">
            {linea.join(" · ")}
          </p>
        )}
      </div>

      <ChevronRight className="size-5 shrink-0 text-fg-subtle" aria-hidden="true" />
    </button>
  );
}
