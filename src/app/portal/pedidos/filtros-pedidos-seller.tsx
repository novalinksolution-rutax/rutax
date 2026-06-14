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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TODOS = "__todos__";

interface Props {
  filtroEstado: string;
  filtroFecha: string;
  hayFiltros: boolean;
}

export function FiltrosPedidosSeller({ filtroEstado, filtroFecha, hayFiltros }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const actualizar = useCallback(
    (campo: string, valor: string) => {
      const params = new URLSearchParams();
      if (campo !== "estado" && filtroEstado) params.set("estado", filtroEstado);
      if (campo !== "fecha" && filtroFecha) params.set("fecha", filtroFecha);
      if (valor) params.set(campo, valor);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, filtroEstado, filtroFecha],
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

      <div className="flex flex-col gap-1">
        <label htmlFor="f-fecha-p" className="text-xs font-medium text-muted-foreground">
          Fecha de compromiso
        </label>
        <Input
          id="f-fecha-p"
          type="date"
          value={filtroFecha}
          onChange={(e) => actualizar("fecha", e.target.value)}
          className="h-9 w-44"
        />
      </div>

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
