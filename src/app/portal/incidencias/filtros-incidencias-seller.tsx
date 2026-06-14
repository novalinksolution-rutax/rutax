"use client";

/**
 * Filtros de "Mis incidencias" (portal del seller) — Client Component.
 * Navega por searchParams al cambiar, con Select del sistema.
 */

import { useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { TIPOS_INCIDENCIA, ESTADOS_INCIDENCIA } from "@/modules/operacion/tipos";
import {
  TEXTO_TIPO_INCIDENCIA,
  TEXTO_ESTADO_INCIDENCIA,
} from "@/lib/ui/traduccion-estados";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TODOS = "__todos__";

interface Props {
  filtroTipo: string;
  filtroEstado: string;
  hayFiltros: boolean;
}

export function FiltrosIncidenciasSeller({ filtroTipo, filtroEstado, hayFiltros }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const actualizar = useCallback(
    (campo: string, valor: string) => {
      const params = new URLSearchParams();
      if (campo !== "tipo" && filtroTipo) params.set("tipo", filtroTipo);
      if (campo !== "estado" && filtroEstado) params.set("estado", filtroEstado);
      if (valor) params.set(campo, valor);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, filtroTipo, filtroEstado],
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="f-tipo-i" className="text-xs font-medium text-muted-foreground">
          Tipo
        </label>
        <Select
          value={filtroTipo || TODOS}
          onValueChange={(v) => actualizar("tipo", v === TODOS ? "" : v)}
        >
          <SelectTrigger id="f-tipo-i" size="default" className="h-9 w-56">
            <SelectValue placeholder="Todos los tipos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los tipos</SelectItem>
            {TIPOS_INCIDENCIA.map((t) => (
              <SelectItem key={t} value={t}>
                {TEXTO_TIPO_INCIDENCIA[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="f-estado-i" className="text-xs font-medium text-muted-foreground">
          Estado
        </label>
        <Select
          value={filtroEstado || TODOS}
          onValueChange={(v) => actualizar("estado", v === TODOS ? "" : v)}
        >
          <SelectTrigger id="f-estado-i" size="default" className="h-9 w-48">
            <SelectValue placeholder="Todos los estados" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los estados</SelectItem>
            {ESTADOS_INCIDENCIA.map((e) => (
              <SelectItem key={e} value={e}>
                {TEXTO_ESTADO_INCIDENCIA[e]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
