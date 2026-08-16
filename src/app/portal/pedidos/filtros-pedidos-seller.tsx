"use client";

/**
 * Filtros de "Mis pedidos" (portal del seller) — Client Component.
 * Navega por searchParams al cambiar, con los componentes del sistema
 * (Select + Input), igual que el resto de los filtros de la app.
 */

import { useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { ESTADOS_PEDIDO } from "@/modules/operacion/tipos";
import { TEXTO_ESTADO_PEDIDO } from "@/lib/ui/traduccion-estados";
import type { EstadoPedido } from "@/modules/operacion/tipos";
import { Button } from "@/components/ui/button";
import { FiltroFecha } from "@/components/filtros/filtro-fecha";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TODOS = "__todos__";

interface Props {
  /** "Hoy" civil de Santiago (para los atajos y la etiqueta del filtro de fecha). */
  hoy: string;
  filtroEstado: string;
  /** Día exacto de fecha de compromiso ("" si hay rango). */
  filtroFecha: string;
  /** Rango de fecha de compromiso ("" si hay día exacto). */
  filtroFechaDesde: string;
  filtroFechaHasta: string;
  hayFiltros: boolean;
}

export function FiltrosPedidosSeller({
  hoy,
  filtroEstado,
  filtroFecha,
  filtroFechaDesde,
  filtroFechaHasta,
  hayFiltros,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const actualizar = useCallback(
    (campo: string, valor: string) => {
      const params = new URLSearchParams();
      if (campo !== "estado" && filtroEstado) params.set("estado", filtroEstado);
      // El filtro de fecha se cambia por su propio control; aquí solo se PRESERVA
      // la selección vigente (día exacto o rango) al tocar otro filtro.
      if (filtroFecha) {
        params.set("fecha", filtroFecha);
      } else {
        if (filtroFechaDesde) params.set("fecha_desde", filtroFechaDesde);
        if (filtroFechaHasta) params.set("fecha_hasta", filtroFechaHasta);
      }
      if (valor) params.set(campo, valor);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, filtroEstado, filtroFecha, filtroFechaDesde, filtroFechaHasta],
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="f-estado-p" className="text-xs font-medium text-muted-foreground">
          Estado
        </label>
        <Select
          value={filtroEstado || TODOS}
          onValueChange={(v) => actualizar("estado", v === TODOS ? "" : v)}
        >
          <SelectTrigger id="f-estado-p" size="default" className="h-9 w-52">
            <SelectValue placeholder="Todos los estados" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los estados</SelectItem>
            {ESTADOS_PEDIDO.map((e) => (
              <SelectItem key={e} value={e}>
                {TEXTO_ESTADO_PEDIDO[e as EstadoPedido]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <FiltroFecha
        id="f-fecha-p"
        label="Fecha de compromiso"
        hoy={hoy}
        exacto={filtroFecha}
        desde={filtroFechaDesde}
        hasta={filtroFechaHasta}
      />

      {hayFiltros && (
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
