"use client";

/**
 * Filtros del panel de incidencias — Client Component.
 * Navega por searchParams al cambiar, con los componentes del sistema (shadcn
 * Select + Input), homologado con las barras de /operaciones y /manifiestos.
 */

import { useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { TIPOS_INCIDENCIA, ESTADOS_INCIDENCIA } from "@/modules/operacion/tipos";
import {
  TEXTO_TIPO_INCIDENCIA,
  TEXTO_ESTADO_INCIDENCIA,
  etiquetaSellerConEstado,
} from "@/lib/ui/traduccion-estados";
import type { TipoIncidencia, EstadoIncidencia } from "@/modules/operacion/tipos";
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
  sellers: { id: string; nombre: string; estado: string }[];
  filtroSeller: string;
  filtroTipo: string;
  filtroEstado: string;
  filtroFecha: string;
  hayFiltro: boolean;
}

export function FiltrosIncidencias({
  sellers,
  filtroSeller,
  filtroTipo,
  filtroEstado,
  filtroFecha,
  hayFiltro,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const actualizar = useCallback(
    (campo: string, valor: string) => {
      const params = new URLSearchParams();
      if (campo !== "seller" && filtroSeller) params.set("seller", filtroSeller);
      if (campo !== "tipo" && filtroTipo) params.set("tipo", filtroTipo);
      if (campo !== "estado" && filtroEstado) params.set("estado", filtroEstado);
      if (campo !== "fecha" && filtroFecha) params.set("fecha", filtroFecha);
      if (valor) params.set(campo, valor);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, filtroSeller, filtroTipo, filtroEstado, filtroFecha],
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* Seller */}
      <div className="flex flex-col gap-1">
        <label htmlFor="f-seller" className="text-xs font-medium text-muted-foreground">
          Seller
        </label>
        <Select
          value={filtroSeller || TODOS}
          onValueChange={(v) => actualizar("seller", v === TODOS ? "" : v)}
        >
          <SelectTrigger id="f-seller" size="default" className="h-9 w-48">
            <SelectValue placeholder="Todos los sellers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los sellers</SelectItem>
            {sellers.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {etiquetaSellerConEstado(s.nombre, s.estado)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tipo */}
      <div className="flex flex-col gap-1">
        <label htmlFor="f-tipo" className="text-xs font-medium text-muted-foreground">
          Tipo
        </label>
        <Select
          value={filtroTipo || TODOS}
          onValueChange={(v) => actualizar("tipo", v === TODOS ? "" : v)}
        >
          <SelectTrigger id="f-tipo" size="default" className="h-9 w-48">
            <SelectValue placeholder="Todos los tipos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los tipos</SelectItem>
            {TIPOS_INCIDENCIA.map((t) => (
              <SelectItem key={t} value={t}>
                {TEXTO_TIPO_INCIDENCIA[t as TipoIncidencia]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Estado */}
      <div className="flex flex-col gap-1">
        <label htmlFor="f-estado" className="text-xs font-medium text-muted-foreground">
          Estado
        </label>
        <Select
          value={filtroEstado || TODOS}
          onValueChange={(v) => actualizar("estado", v === TODOS ? "" : v)}
        >
          <SelectTrigger id="f-estado" size="default" className="h-9 w-52">
            <SelectValue placeholder="Abiertas + en gestión" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Abiertas + en gestión</SelectItem>
            {ESTADOS_INCIDENCIA.map((e) => (
              <SelectItem key={e} value={e}>
                {TEXTO_ESTADO_INCIDENCIA[e as EstadoIncidencia]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Desde fecha */}
      <div className="flex flex-col gap-1">
        <label htmlFor="f-fecha" className="text-xs font-medium text-muted-foreground">
          Desde fecha
        </label>
        <Input
          id="f-fecha"
          type="date"
          value={filtroFecha}
          onChange={(e) => actualizar("fecha", e.target.value)}
          className="h-9 w-44"
        />
      </div>

      {hayFiltro && (
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
