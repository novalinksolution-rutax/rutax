"use client";

/**
 * Barra de filtros de liquidaciones — Client Component.
 * Homologa los selects nativos a shadcn Select y auto-navega al cambiar
 * (sin botón "Filtrar"), siguiendo el patrón de filtros-pedidos.tsx.
 * El filtrado sigue viviendo server-side (searchParams / GET navigation).
 */

import { useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { TEXTO_ESTADO_LIQUIDACION } from "@/lib/ui/traduccion-estados";
import type { EstadoLiquidacion } from "@/modules/dinero/tipos";
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
  conductores: { id: string; nombre: string }[];
  estados: EstadoLiquidacion[];
  filtroConductor: string;
  filtroEstado: string;
  hayFiltroActivo: boolean;
}

export function FiltrosLiquidacionesForm({
  conductores,
  estados,
  filtroConductor,
  filtroEstado,
  hayFiltroActivo,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const actualizar = useCallback(
    (campo: string, valor: string) => {
      const params = new URLSearchParams();
      if (campo !== "conductor" && filtroConductor) params.set("conductor", filtroConductor);
      if (campo !== "estado" && filtroEstado) params.set("estado", filtroEstado);
      if (valor) params.set(campo, valor);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, filtroConductor, filtroEstado],
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* Conductor */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-conductor-l" className="text-xs font-medium text-muted-foreground">
          Conductor
        </label>
        <Select
          value={filtroConductor || TODOS}
          onValueChange={(v) => actualizar("conductor", v === TODOS ? "" : v)}
        >
          <SelectTrigger id="filtro-conductor-l" size="default" className="h-9 w-56">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos</SelectItem>
            {conductores.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Estado */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-estado-l" className="text-xs font-medium text-muted-foreground">
          Estado
        </label>
        <Select
          value={filtroEstado || TODOS}
          onValueChange={(v) => actualizar("estado", v === TODOS ? "" : v)}
        >
          <SelectTrigger id="filtro-estado-l" size="default" className="h-9 w-44">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos</SelectItem>
            {estados.map((e) => (
              <SelectItem key={e} value={e}>
                {TEXTO_ESTADO_LIQUIDACION[e]}
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
