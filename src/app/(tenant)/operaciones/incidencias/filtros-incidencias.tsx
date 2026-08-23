"use client";

/**
 * Filtros del panel de incidencias — Client Component.
 * Navega por searchParams al cambiar, con los componentes del sistema (shadcn
 * Select + Input), homologado con las barras de /operaciones y /manifiestos.
 */

import { useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { TIPOS_INCIDENCIA } from "@/modules/operacion/tipos";
import {
  TEXTO_TIPO_INCIDENCIA,
  etiquetaSellerConEstado,
} from "@/lib/ui/traduccion-estados";
import type { TipoIncidencia } from "@/modules/operacion/tipos";
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
  /** El ESTADO ya no es un filtro de esta barra: lo eligen los cajones. */
  filtroConductor: string;
  conductores: { id: string; nombre: string }[];
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
  filtroConductor,
  conductores,
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
      if (campo !== "conductor" && filtroConductor) params.set("conductor", filtroConductor);
      // El cajón de estado vive en la barra de cajones, no acá, pero viaja en
      // la misma URL: tocar un filtro no puede tirarlo.
      const cajon = new URLSearchParams(window.location.search).get("estado");
      if (cajon) params.set("estado", cajon);
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
    [router, pathname, filtroSeller, filtroTipo, filtroConductor, filtroFecha, filtroFechaDesde, filtroFechaHasta],
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

      {/* Conductor — el tablero lo pide como filtro de la bandeja: «quién tuvo
          el problema» es la segunda pregunta del supervisor, después de «cuánto
          lleva esperando». La incidencia no guarda conductor; se resuelve por el
          pedido, y por eso el filtro vive en el servidor y no acá. */}
      <div className="flex flex-col gap-1">
        <label htmlFor="f-conductor" className="text-xs font-medium text-muted-foreground">
          Conductor
        </label>
        <Select
          value={filtroConductor || TODOS}
          onValueChange={(v) => actualizar("conductor", v === TODOS ? "" : v)}
        >
          <SelectTrigger id="f-conductor" size="default" className="h-9 w-48">
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
