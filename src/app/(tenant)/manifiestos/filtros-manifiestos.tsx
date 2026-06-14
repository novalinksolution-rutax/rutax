"use client";

/**
 * Filtros de la lista de manifiestos — Client Component.
 * Navega por searchParams al cambiar, con los componentes del sistema.
 */

import { useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { ESTADOS_MANIFIESTO } from "@/modules/operacion/tipos";
import { TEXTO_ESTADO_MANIFIESTO } from "@/lib/ui/traduccion-estados";
import type { EstadoManifiesto } from "@/modules/operacion/tipos";
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

export function FiltrosManifiestos({ filtroEstado, filtroFecha, hayFiltros }: Props) {
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
        <label htmlFor="f-estado-m" className="text-xs font-medium text-muted-foreground">
          Estado
        </label>
        <Select
          value={filtroEstado || TODOS}
          onValueChange={(v) => actualizar("estado", v === TODOS ? "" : v)}
        >
          <SelectTrigger id="f-estado-m" size="default" className="h-9 w-52">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos</SelectItem>
            {ESTADOS_MANIFIESTO.map((e) => (
              <SelectItem key={e} value={e}>
                {TEXTO_ESTADO_MANIFIESTO[e as EstadoManifiesto]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="f-fecha-m" className="text-xs font-medium text-muted-foreground">
          Fecha de operación
        </label>
        <Input
          id="f-fecha-m"
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
          Limpiar
        </Button>
      )}
    </div>
  );
}
