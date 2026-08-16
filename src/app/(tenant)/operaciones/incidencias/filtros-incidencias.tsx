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
import { FiltroFecha } from "@/components/filtros/filtro-fecha";
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
  /** "Hoy" civil de Santiago (para los atajos y la etiqueta del filtro de fecha). */
  hoy: string;
  filtroSeller: string;
  filtroTipo: string;
  filtroEstado: string;
  /** Día exacto de apertura ("" si hay rango). */
  filtroFecha: string;
  /** Rango de apertura ("" si hay día exacto). */
  filtroFechaDesde: string;
  filtroFechaHasta: string;
  hayFiltro: boolean;
}

export function FiltrosIncidencias({
  sellers,
  hoy,
  filtroSeller,
  filtroTipo,
  filtroEstado,
  filtroFecha,
  filtroFechaDesde,
  filtroFechaHasta,
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
    [router, pathname, filtroSeller, filtroTipo, filtroEstado, filtroFecha, filtroFechaDesde, filtroFechaHasta],
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

      <FiltroFecha
        id="f-fecha"
        label="Fecha de apertura"
        hoy={hoy}
        exacto={filtroFecha}
        desde={filtroFechaDesde}
        hasta={filtroFechaHasta}
      />

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
