"use client";

/**
 * El filtro de la pantalla de períodos — hoy solo el seller.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ SE FUE EL SELECTOR DE ESTADO
 * -----------------------------------------------------------------------------
 * Estaba duplicado. Los cajones de la tabla eligen el estado, con su contador a
 * la vista; un `<Select>` que hace lo mismo, sin contador y dos centímetros más
 * arriba, deja dos controles que pueden mostrar cosas distintas —el select
 * conserva su valor cuando el cajón lo cambia— y ninguna razón para preferir
 * uno. El cajón gana porque cuenta.
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
  sellers: { id: string; nombre: string }[];
  filtroSeller: string;
  hayFiltroActivo: boolean;
}

export function FiltrosPeriodosForm({ sellers, filtroSeller, hayFiltroActivo }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const actualizar = useCallback(
    (valor: string) => {
      const params = new URLSearchParams();
      if (valor) params.set("seller", valor);
      // Al cambiar el seller se vuelve a la página 1 y se suelta el cajón: el
      // conjunto es otro, y «facturados» de un seller que ya no se está mirando
      // no significa nada.
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname],
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-seller-pc" className="text-xs font-medium text-fg-muted">
          Seller
        </label>
        <Select
          value={filtroSeller || TODOS}
          onValueChange={(v) => actualizar(v === TODOS ? "" : v)}
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
