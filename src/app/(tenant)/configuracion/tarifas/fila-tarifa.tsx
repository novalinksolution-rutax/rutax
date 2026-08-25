"use client";

/**
 * La fila de una tarifa — y el clic que abre su panel.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 LA FILA ENTERA ES EL OBJETIVO, COMO EN PEDIDOS
 * -----------------------------------------------------------------------------
 * Decisión del usuario (25-08): que los módulos conversen. En Pedidos se toca la
 * fila y se abre el panel; acá se hacía clic en un botón «Editar» de 50 px al
 * final de una fila de 1.300. Con el lienzo abierto, ese botón queda **a media
 * pantalla de distancia del nombre del seller que uno está mirando**.
 *
 * ⚠️ **Por eso la fila es cliente y la página sigue siendo servidor.** El estado
 * de apertura del panel no puede vivir en un Server Component, y subirlo a la
 * página obligaría a convertirla entera —perdiendo el `await` de las consultas—
 * para resolver un booleano por fila.
 *
 * ⚠️ **Los botones de la última celda paran la propagación.** Sin eso,
 * «Inactivar» abriría además el panel de edición por debajo de su propio
 * diálogo de confirmación: dos cosas al mismo tiempo con un solo clic.
 */

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { etiquetaTipoEntrega } from "@/lib/ui/etiqueta-fuente-pedido";
import { cn } from "@/lib/utils";
import { BotonInactivarTarifa, BotonReactivarTarifa } from "./acciones-fila";
import { PanelTarifa } from "./panel-tarifa";
import type { CajonTarifa } from "./cajon-tarifa";

export interface TarifaFila {
  id: string;
  sellerId: string | null;
  sellerNombre: string | null;
  tipoEntrega: "flex" | "same_day";
  modoCalculo: "monto_fijo" | "por_zona";
  zona: string | null;
  montoClp: number;
  montoConductorClp: number;
  vigenteDesdeFecha: string;
  vigenteHasta: string | null;
  estado: "activa" | "inactiva";
  minimoFacturacionClp: number | null;
  minimoRetiroClp: number | null;
  recargoReprogramacionClp: number | null;
}

/** `2026-09-01` → `01/09/2026`. */
function formatearFecha(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

// =============================================================================
// La fila
// =============================================================================

/**
 * Una sola fila para los cuatro cajones.
 *
 * ⚠️ **No hay dos componentes de fila**, que es como estaba antes: la inactiva
 * tenía su propia tabla, con menos columnas y otro orden. Dos filas que
 * muestran el mismo objeto con distinta forma obligan a re-leer la cabecera al
 * cambiar de cajón, y esconden justo la columna que uno viene a comparar —la
 * inactiva no mostraba «pagas».
 *
 * Lo que cambia entre cajones es el **tono**, no la anatomía.
 */
export function FilaTarifa({
  tarifa,
  cajon,
  sellers,
}: {
  tarifa: TarifaFila;
  cajon: CajonTarifa;
  sellers: { id: string; nombre: string }[];
}) {
  const tarifaParaDialog = {
    id: tarifa.id,
    sellerId: tarifa.sellerId,
    tipoEntrega: tarifa.tipoEntrega,
    modoCalculo: tarifa.modoCalculo,
    zona: tarifa.zona,
    montoClp: tarifa.montoClp,
    montoConductorClp: tarifa.montoConductorClp,
    vigenteDesdeFecha: tarifa.vigenteDesdeFecha,
    vigenteHasta: tarifa.vigenteHasta,
    minimoFacturacionClp: tarifa.minimoFacturacionClp,
    minimoRetiroClp: tarifa.minimoRetiroClp,
    recargoReprogramacionClp: tarifa.recargoReprogramacionClp,
  };

  const enJuego = cajon === "vigente" || cajon === "programada";
  const [panelAbierto, setPanelAbierto] = useState(false);
  // Una tarifa inactiva no se edita: su acción es reactivarla. Abrir el panel
  // desde la fila daría un formulario que al guardar la reviviría de rebote.
  const abrible = cajon !== "inactiva";

  return (
    <TableRow
      data-cajon={cajon}
      onClick={abrible ? () => setPanelAbierto(true) : undefined}
      className={cn(
        abrible && "cursor-pointer",
        // La programada lleva el fondo de `progress`: todavía no cobra, ya está
        // decidida. Es el único recurso que la distingue de la vigente, y por
        // eso también lleva su distintivo con la fecha — el color solo no basta.
        cajon === "programada" && "bg-progress-bg",
        // Lo que salió de juego se atenúa, no se esconde.
        !enJuego && "rx-lista-atenuada",
      )}
    >
      <TableCell className="px-4">
        {tarifa.sellerNombre ? (
          <span className="font-medium">{tarifa.sellerNombre}</span>
        ) : (
          <span className="text-fg-muted">Todos · por defecto</span>
        )}
      </TableCell>

      <TableCell className="px-4">
        <Badge variant="outline" className="text-xs">
          {etiquetaTipoEntrega(tarifa.tipoEntrega)}
        </Badge>
      </TableCell>

      <TableCell className="hidden px-4 text-fg-muted sm:table-cell">
        {tarifa.zona ?? "—"}
      </TableCell>

      <TableCell className="rx-num px-4 text-right font-mono font-semibold tabular-nums">
        {formatearCLP(tarifa.montoClp)}
      </TableCell>

      {/*
        Un 0 acá NO es un dato: significa que esa tarifa le liquida $0 al
        conductor por cada entrega. Se marca porque durante meses fue el valor de
        TODAS las tarifas en producción —la columna existía y ningún formulario
        la pedía— y el síntoma aparecía lejos, en la liquidación del conductor,
        sin nada que apuntara a la tarifa.
      */}
      <TableCell className="rx-num px-4 text-right font-mono font-semibold tabular-nums">
        {tarifa.montoConductorClp > 0 ? (
          formatearCLP(tarifa.montoConductorClp)
        ) : (
          <span
            className="font-sans text-xs font-medium text-attention-fg"
            title="Esta tarifa liquida $0 al conductor. Edítala para fijar cuánto le pagas por entrega."
          >
            Sin definir
          </span>
        )}
      </TableCell>

      <TableCell className="hidden px-4 md:table-cell">
        <div className="flex flex-col gap-1">
          <span className="rx-num text-xs whitespace-nowrap tabular-nums text-fg-muted">
            {/* Una tarifa sin término mostraba «01/01/2026 →» con la flecha
                colgando sola. «Desde <fecha>» se lee igual de rápido. */}
            {tarifa.vigenteHasta
              ? `${formatearFecha(tarifa.vigenteDesdeFecha)} → ${formatearFecha(tarifa.vigenteHasta)}`
              : `Desde ${formatearFecha(tarifa.vigenteDesdeFecha)}`}
          </span>
          {cajon === "programada" && (
            <span className="text-xs font-medium text-progress-fg">
              Empieza el {formatearFecha(tarifa.vigenteDesdeFecha)}
            </span>
          )}
          {cajon === "vencida" && (
            <span className="text-xs font-medium text-fg-muted">
              Ya no cobra
            </span>
          )}
          {cajon === "inactiva" && (
            <span className="text-xs font-medium text-fg-muted">Inactiva</span>
          )}
        </div>
      </TableCell>

      {/* ⚠️ `stopPropagation` en la celda entera: sin esto, «Inactivar» abriría
          además el panel de edición por debajo de su propio diálogo de
          confirmación — dos cosas al mismo tiempo con un solo clic. */}
      <TableCell
        className="px-4 text-right"
        onClick={(e) => e.stopPropagation()}
      >
        {cajon === "inactiva" ? (
          <BotonReactivarTarifa tarifaId={tarifa.id} />
        ) : (
          <div className="flex items-center justify-end gap-1">
            {/* El panel ya no tiene disparador propio: lo abre la fila. */}
            <PanelTarifa
              sellers={sellers}
              tarifa={tarifaParaDialog}
              abierto={panelAbierto}
              onOpenChange={setPanelAbierto}
            />
            <BotonInactivarTarifa
              tarifaId={tarifa.id}
              sellerNombre={tarifa.sellerNombre}
            />
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
