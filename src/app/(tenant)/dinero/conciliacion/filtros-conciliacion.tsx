"use client";

/**
 * Filtros de la pantalla de conciliación — Client Component.
 * Navega por searchParams (GET) al cambiar cualquier filtro, sin botón de envío:
 * misma fluidez que el panel de pedidos. Usa el Select del sistema (no <select>
 * nativo) para consistencia visual y de movimiento (DESIGN_SYSTEM §4).
 */

import { useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import {
  TEXTO_ESTADO_CONCILIACION,
  TEXTO_TIPO_DIFERENCIA,
} from "@/lib/ui/traduccion-estados";
import type {
  EstadoEventoConciliacion,
  TipoDiferenciaConciliacion,
} from "@/modules/dinero/tipos";
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
  estados: EstadoEventoConciliacion[];
  tipos: TipoDiferenciaConciliacion[];
  sellers: { id: string; nombre: string }[];
  filtroEstado: string;
  filtroTipo: string;
  filtroSeller: string;
  hayFiltroActivo: boolean;
}

export function FiltrosConciliacion({
  estados,
  tipos,
  sellers,
  filtroEstado,
  filtroTipo,
  filtroSeller,
  hayFiltroActivo,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const actualizar = useCallback(
    (campo: string, valor: string) => {
      const params = new URLSearchParams();
      if (campo !== "estado" && filtroEstado) params.set("estado", filtroEstado);
      if (campo !== "tipo" && filtroTipo) params.set("tipo", filtroTipo);
      if (campo !== "seller" && filtroSeller) params.set("seller", filtroSeller);
      if (valor) params.set(campo, valor);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, filtroEstado, filtroTipo, filtroSeller],
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="f-estado-c" className="text-xs font-medium text-muted-foreground">
          Estado
        </label>
        <Select
          value={filtroEstado || TODOS}
          onValueChange={(v) => actualizar("estado", v === TODOS ? "" : v)}
        >
          <SelectTrigger id="f-estado-c" size="default" className="h-9 w-44">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos</SelectItem>
            {estados.map((e) => (
              <SelectItem key={e} value={e}>
                {TEXTO_ESTADO_CONCILIACION[e]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="f-tipo-c" className="text-xs font-medium text-muted-foreground">
          Tipo de diferencia
        </label>
        <Select
          value={filtroTipo || TODOS}
          onValueChange={(v) => actualizar("tipo", v === TODOS ? "" : v)}
        >
          <SelectTrigger id="f-tipo-c" size="default" className="h-9 w-64">
            <SelectValue placeholder="Todos los tipos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los tipos</SelectItem>
            {tipos.map((t) => (
              <SelectItem key={t} value={t}>
                {TEXTO_TIPO_DIFERENCIA[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="f-seller-c" className="text-xs font-medium text-muted-foreground">
          Seller
        </label>
        <Select
          value={filtroSeller || TODOS}
          onValueChange={(v) => actualizar("seller", v === TODOS ? "" : v)}
        >
          <SelectTrigger id="f-seller-c" size="default" className="h-9 w-48">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos</SelectItem>
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
          className="h-9 text-muted-foreground"
        >
          Limpiar filtros
        </Button>
      )}
    </div>
  );
}
