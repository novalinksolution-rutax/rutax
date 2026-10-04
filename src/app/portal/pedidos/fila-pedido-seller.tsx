"use client";

/**
 * La fila y la ficha de teléfono de «Mis pedidos».
 * =============================================================================
 *
 * Calcadas de `(tenant)/operaciones/fila-pedido.tsx` y `ficha-pedido-movil.tsx`
 * (decisión del usuario, 04-10-2026): el seller y el courier miran la misma
 * lista, con la misma forma. Cambia solo lo que el seller no necesita —seller,
 * conductor y motivo de operación— y el idioma del estado («Nadie recibió», no
 * «Fallido»).
 *
 * Tocar la fila (o la ficha) abre la vista previa; el detalle completo sale del
 * pie del panel, igual que en el courier.
 */

import { ChevronRight } from "lucide-react";

import { BadgeEstado } from "@/components/ui/badge-estado";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { etiquetaFuentePedido } from "@/lib/ui/etiqueta-fuente-pedido";
import { BADGE_ESTADO_PEDIDO } from "@/lib/ui/traduccion-estados";
import { estadoPedidoParaSeller, textoLlegada } from "@/lib/ui/vocabulario-portal";
import type { Pedido } from "@/modules/operacion/tipos";

import { useVistaPreviaSeller } from "./vista-previa-seller";

/** El código con que el seller identifica su envío. */
function codigoVisible(p: Pedido): string {
  return p.codigoInterno ?? p.mlShipmentId ?? p.id.slice(0, 8);
}

export function FilaPedidoSeller({
  pedido,
  hoy,
  cuenta = null,
}: {
  pedido: Pedido;
  hoy: string;
  /** Cuenta de ML de origen, solo si el seller tiene más de una. */
  cuenta?: string | null;
}) {
  const vista = useVistaPreviaSeller();
  const fueraDeJuego = pedido.estado === "cancelado";

  return (
    <TableRow
      onClick={() => vista?.abrir(pedido.id)}
      className={cn(
        "group pointer-coarse:[&>td]:h-row-touch",
        vista && "cursor-pointer",
        vista?.pedidoId === pedido.id && "[&>td:first-child]:border-l-2 [&>td:first-child]:border-l-brand",
        fueraDeJuego && "rx-inert-row text-fg-muted",
      )}
    >
      <TableCell className="px-4">
        <BadgeEstado
          variante={BADGE_ESTADO_PEDIDO[pedido.estado]}
          texto={estadoPedidoParaSeller(pedido.estado)}
          eje="pedido"
          valor={pedido.estado}
        />
      </TableCell>
      <TableCell className="px-4">
        <span className="font-medium">{pedido.destinatarioNombre}</span>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <p className="rx-num font-mono text-xs text-fg-muted">{codigoVisible(pedido)}</p>
          <p className="text-xs text-muted-foreground">{pedido.destinatarioComuna}</p>
          {/* La procedencia tiene columna propia desde `xl`; por debajo vuelve acá. */}
          <span className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground xl:hidden">
            {etiquetaFuentePedido(pedido.fuente)}
          </span>
        </div>
      </TableCell>
      <TableCell className="hidden px-4 text-right text-fg-muted md:table-cell">
        {textoLlegada(pedido.fechaCompromiso, hoy, pedido.estado)}
      </TableCell>
      <TableCell className="hidden px-4 xl:table-cell">
        <span className="text-xs text-fg-muted">{etiquetaFuentePedido(pedido.fuente)}</span>
        {cuenta ? <span className="block text-xs text-fg-subtle">{cuenta}</span> : null}
      </TableCell>
      <TableCell className="px-4 text-right">
        <button
          type="button"
          aria-label={`Ver ${pedido.destinatarioNombre}`}
          className="inline-flex size-7 items-center justify-center text-fg-muted hover:text-fg"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </TableCell>
    </TableRow>
  );
}

export function FichaPedidoSellerMovil({ pedido, hoy }: { pedido: Pedido; hoy: string }) {
  const vista = useVistaPreviaSeller();
  const fueraDeJuego = pedido.estado === "cancelado";
  const linea = [codigoVisible(pedido), pedido.destinatarioComuna, textoLlegada(pedido.fechaCompromiso, hoy, pedido.estado)].filter(Boolean);

  return (
    <button
      type="button"
      onClick={() => vista?.abrir(pedido.id)}
      aria-label={`Ver ${pedido.destinatarioNombre}`}
      className={cn(
        "w-full text-left",
        "flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0",
        vista?.pedidoId === pedido.id && "border-l-2 border-l-brand",
        fueraDeJuego && "rx-inert-row text-fg-muted",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <BadgeEstado
            variante={BADGE_ESTADO_PEDIDO[pedido.estado]}
            texto={estadoPedidoParaSeller(pedido.estado)}
            eje="pedido"
            valor={pedido.estado}
          />
          <span className="truncate text-xs text-fg-muted">{etiquetaFuentePedido(pedido.fuente)}</span>
        </div>
        <p className="mt-1 truncate text-base font-medium text-fg">{pedido.destinatarioNombre}</p>
        <p className="rx-num mt-0.5 truncate font-mono text-xs text-fg-muted">{linea.join(" · ")}</p>
      </div>
      <ChevronRight className="size-5 shrink-0 text-fg-subtle" aria-hidden="true" />
    </button>
  );
}
