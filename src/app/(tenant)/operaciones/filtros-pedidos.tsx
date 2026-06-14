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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Sentinela para "sin filtro": Radix Select no admite items con value="". */
const TODOS = "__todos__";

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
        <Select
          value={filtroSeller || TODOS}
          onValueChange={(v) => actualizar("seller", v === TODOS ? "" : v)}
        >
          <SelectTrigger id="filtro-seller" size="default" className="h-9 w-48">
            <SelectValue placeholder="Todos los sellers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los sellers</SelectItem>
            {sellers.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Estado */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-estado" className="text-xs font-medium text-muted-foreground">
          Estado
        </label>
        <Select
          value={filtroEstado || TODOS}
          onValueChange={(v) => actualizar("estado", v === TODOS ? "" : v)}
        >
          <SelectTrigger id="filtro-estado" size="default" className="h-9 w-48">
            <SelectValue placeholder="Todos los estados" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los estados</SelectItem>
            {ESTADOS_PEDIDO.map((estado) => (
              <SelectItem key={estado} value={estado}>
                {TEXTO_ESTADO_PEDIDO[estado as EstadoPedido]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Fecha */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-fecha" className="text-xs font-medium text-muted-foreground">
          Fecha comprometida
        </label>
        <Input
          id="filtro-fecha"
          type="date"
          value={filtroFecha}
          onChange={(e) => actualizar("fecha", e.target.value)}
          className="h-9 w-44"
        />
      </div>

      {/* Limpiar filtros — solo visible cuando hay filtros activos */}
      {hayFiltroActivo && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => router.push(pathname)}
          className="h-9 text-muted-foreground"
        >
          Limpiar filtros
        </Button>
      )}
    </div>
  );
}
