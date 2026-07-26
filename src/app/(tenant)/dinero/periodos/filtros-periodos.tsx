"use client";

/**
 * Barra de filtros de períodos de cobro — Client Component.
 * Homologa los selects nativos a shadcn Select y auto-navega al cambiar
 * (sin botón "Filtrar"), siguiendo el patrón de filtros-pedidos.tsx.
 * Los filtros viajan como searchParams (GET navigation), la lógica de
 * filtrado sigue viviendo server-side.
 */

import { useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { traducirEstadoPeriodoCobro } from "@/lib/ui/traduccion-estados";
import type { EstadoPeriodo } from "@/modules/dinero/tipos";
import { Button } from "@/components/ui/button";
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
  estados: EstadoPeriodo[];
  filtroSeller: string;
  filtroEstado: string;
  hayFiltroActivo: boolean;
}

export function FiltrosPeriodosForm({
  sellers,
  estados,
  filtroSeller,
  filtroEstado,
  hayFiltroActivo,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const actualizar = useCallback(
    (campo: string, valor: string) => {
      const params = new URLSearchParams();
      if (campo !== "seller" && filtroSeller) params.set("seller", filtroSeller);
      if (campo !== "estado" && filtroEstado) params.set("estado", filtroEstado);
      if (valor) params.set(campo, valor);
      // Al cambiar filtros se resetea a página 1 (no se arrastra 'pagina').
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, filtroSeller, filtroEstado],
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* Seller */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-seller-pc" className="text-xs font-medium text-muted-foreground">
          Seller
        </label>
        <Select
          value={filtroSeller || TODOS}
          onValueChange={(v) => actualizar("seller", v === TODOS ? "" : v)}
        >
          <SelectTrigger id="filtro-seller-pc" size="default" className="h-9 w-48">
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
        <label htmlFor="filtro-estado-pc" className="text-xs font-medium text-muted-foreground">
          Estado
        </label>
        <Select
          value={filtroEstado || TODOS}
          onValueChange={(v) => actualizar("estado", v === TODOS ? "" : v)}
        >
          <SelectTrigger id="filtro-estado-pc" size="default" className="h-9 w-48">
            <SelectValue placeholder="Todos los estados" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los estados</SelectItem>
            {estados.map((e) => (
              <SelectItem key={e} value={e}>
                {traducirEstadoPeriodoCobro(e)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
