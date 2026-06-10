"use client";

/**
 * Barra de filtros de la lista de pedidos — Client Component.
 * Los filtros se envían como searchParams en la URL (GET navigation).
 */

import { useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { ESTADOS_PEDIDO } from "@/modules/operacion/tipos";
import { TEXTO_ESTADO_PEDIDO } from "@/lib/ui/traduccion-estados";
import type { EstadoPedido } from "@/modules/operacion/tipos";

interface Props {
  sellers: { id: string; nombre: string }[];
  filtroSeller: string;
  filtroEstado: string;
  filtroFecha: string;
  hayFiltroActivo: boolean;
}

export function FiltrosPedidosForm({
  sellers,
  filtroSeller,
  filtroEstado,
  filtroFecha,
  hayFiltroActivo,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const actualizar = useCallback(
    (campo: string, valor: string) => {
      const params = new URLSearchParams();
      if (campo !== "seller" && filtroSeller) params.set("seller", filtroSeller);
      if (campo !== "estado" && filtroEstado) params.set("estado", filtroEstado);
      if (campo !== "fecha" && filtroFecha) params.set("fecha", filtroFecha);
      if (valor) params.set(campo, valor);
      // Resetear a página 1 al cambiar filtros
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, filtroSeller, filtroEstado, filtroFecha],
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* Seller */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-seller" className="text-xs font-medium text-muted-foreground">
          Seller
        </label>
        <select
          id="filtro-seller"
          value={filtroSeller}
          onChange={(e) => actualizar("seller", e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Todos los sellers</option>
          {sellers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
      </div>

      {/* Estado */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-estado" className="text-xs font-medium text-muted-foreground">
          Estado
        </label>
        <select
          id="filtro-estado"
          value={filtroEstado}
          onChange={(e) => actualizar("estado", e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Todos los estados</option>
          {ESTADOS_PEDIDO.map((estado) => (
            <option key={estado} value={estado}>
              {TEXTO_ESTADO_PEDIDO[estado as EstadoPedido]}
            </option>
          ))}
        </select>
      </div>

      {/* Fecha */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-fecha" className="text-xs font-medium text-muted-foreground">
          Fecha comprometida
        </label>
        <input
          id="filtro-fecha"
          type="date"
          value={filtroFecha}
          onChange={(e) => actualizar("fecha", e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Limpiar filtros — solo visible cuando hay filtros activos */}
      {hayFiltroActivo && (
        <button
          type="button"
          onClick={() => router.push(pathname)}
          className="h-9 rounded-md px-3 text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}
