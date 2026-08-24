"use client";

/**
 * El filtro de la pantalla de liquidaciones — hoy solo el conductor.
 *
 * El selector de estado se fue por la misma razón que en períodos: los cajones
 * de la tabla ya eligen el estado y además cuentan. Dos controles para lo mismo,
 * uno de ellos sin contador y capaz de quedar desincronizado del otro, no es una
 * comodidad: es una fuente de confusión.
 *
 * El filtro viaja como `searchParams` (navegación GET): el filtrado sigue
 * viviendo en el servidor.
 */

import { useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Centinela para «sin filtro»: Radix Select no admite items con value="". */
const TODOS = "__todos__";

interface Props {
  conductores: { id: string; nombre: string }[];
  filtroConductor: string;
  hayFiltroActivo: boolean;
}

export function FiltrosLiquidacionesForm({
  conductores,
  filtroConductor,
  hayFiltroActivo,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const actualizar = useCallback(
    (valor: string) => {
      const params = new URLSearchParams();
      if (valor) params.set("conductor", valor);
      // Se suelta el cajón al cambiar de conductor: el conjunto es otro.
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname],
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-conductor-liq" className="text-xs font-medium text-fg-muted">
          Conductor
        </label>
        <Select
          value={filtroConductor || TODOS}
          onValueChange={(v) => actualizar(v === TODOS ? "" : v)}
        >
          <SelectTrigger id="filtro-conductor-liq" size="default" className="h-9 w-56">
            <SelectValue placeholder="Todos los conductores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los conductores</SelectItem>
            {conductores.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {hayFiltroActivo && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => router.push(pathname)}
          className="h-9 text-fg-muted"
        >
          Limpiar filtros
        </Button>
      )}
    </div>
  );
}
