"use client";

/**
 * Filtros de refinamiento de la lista de pedidos — Client Component.
 * Se envían como searchParams en la URL (GET navigation).
 *
 * ⚠️ **El estado NO se filtra aquí.** Lo hace la barra de grupos de la página,
 * que además muestra la cifra de cada cajón. Mientras existieron los dos, la
 * pantalla tenía dos controles para lo mismo y podían contradecirse. Aquí queda
 * solo el refinamiento, ordenado por frecuencia de uso: la fecha va primero
 * porque es el único que SIEMPRE está puesto (cae a hoy por defecto).
 */

import { useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { FUENTES_PEDIDO } from "@/modules/operacion/tipos";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { etiquetaSellerConEstado } from "@/lib/ui/traduccion-estados";
import { etiquetaFuentePedido } from "@/lib/ui/etiqueta-fuente-pedido";
import type { FuentePedido } from "@/modules/operacion/tipos";
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
  conductores: { id: string; nombre: string }[];
  filtroSeller: string;
  /**
   * Grupo o estado vigente. NO se edita aquí —la barra de la página es su
   * control— pero se recibe para PRESERVARLO al tocar cualquier otro filtro.
   */
  filtroEstado: string;
  /** "Hoy" civil de Santiago (para los atajos y la etiqueta del filtro de fecha). */
  hoy: string;
  /** Día exacto de fecha comprometida ("" si hay rango). */
  filtroFecha: string;
  /** Rango de fecha comprometida ("" si hay día exacto). */
  filtroFechaDesde: string;
  filtroFechaHasta: string;
  filtroComuna: string;
  filtroConductor: string;
  filtroFuente: string;
  hayFiltroActivo: boolean;
}

export function FiltrosPedidosForm({
  sellers,
  conductores,
  filtroSeller,
  filtroEstado,
  hoy,
  filtroFecha,
  filtroFechaDesde,
  filtroFechaHasta,
  filtroComuna,
  filtroConductor,
  filtroFuente,
  hayFiltroActivo,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const actualizar = useCallback(
    (campo: string, valor: string) => {
      const params = new URLSearchParams();
      if (campo !== "seller" && filtroSeller) params.set("seller", filtroSeller);
      if (campo !== "estado" && filtroEstado) params.set("estado", filtroEstado);
      // El filtro de fecha se cambia por su propio control (FiltroFecha, que
      // clona la URL); aquí solo se PRESERVA la selección vigente —día exacto o
      // rango— para que tocar otro filtro no la borre.
      if (filtroFecha) {
        params.set("fecha", filtroFecha);
      } else {
        if (filtroFechaDesde) params.set("fecha_desde", filtroFechaDesde);
        if (filtroFechaHasta) params.set("fecha_hasta", filtroFechaHasta);
      }
      // Comuna y conductor sobreviven al cambio de cualquier otro filtro: se
      // llega desde la Torre con uno puesto y afinar por estado no puede
      // devolver al usuario a la ciudad entera.
      if (campo !== "comuna" && filtroComuna) params.set("comuna", filtroComuna);
      if (campo !== "conductor" && filtroConductor) params.set("conductor", filtroConductor);
      // Fuente sobrevive igual que comuna/conductor: es un corte del mismo
      // universo (con tres fuentes conviviendo en la bandeja, filtrar por
      // estado no puede devolver a "todas las fuentes").
      if (campo !== "fuente" && filtroFuente) params.set("fuente", filtroFuente);
      if (valor) params.set(campo, valor);
      // Resetear a página 1 al cambiar filtros
      router.push(`${pathname}?${params.toString()}`);
    },
    [
      router,
      pathname,
      filtroSeller,
      filtroEstado,
      filtroFecha,
      filtroFechaDesde,
      filtroFechaHasta,
      filtroComuna,
      filtroConductor,
      filtroFuente,
    ],
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* Fecha — primero a propósito: es el único filtro que SIEMPRE está
          puesto (cae a hoy cuando la URL no trae nada), así que es el que el
          coordinador mira y cambia más. Los cuatro selects de abajo son
          refinamiento ocasional. */}
      <FiltroFecha
        id="filtro-fecha"
        label="Fecha comprometida"
        hoy={hoy}
        exacto={filtroFecha}
        desde={filtroFechaDesde}
        hasta={filtroFechaHasta}
      />

      {/* Seller */}
        <div className="flex flex-col gap-1">
          <label htmlFor="filtro-seller" className="text-xs font-medium text-muted-foreground">
            Seller
          </label>
          <Select
            value={filtroSeller || TODOS}
            onValueChange={(v) => actualizar("seller", v === TODOS ? "" : v)}
          >
            <SelectTrigger id="filtro-seller" size="default" className="h-9 w-48">
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

        {/* Fuente — de dónde vino el pedido (ML Flex, Same-day propio, Shopify).
            Con tres fuentes conviviendo en la misma bandeja hace falta poder
            acotar. NO se oculta con "por revisar": mismo criterio que comuna. */}
        <div className="flex flex-col gap-1">
          <label htmlFor="filtro-fuente" className="text-xs font-medium text-muted-foreground">
            Fuente
          </label>
          <Select
            value={filtroFuente || TODOS}
            onValueChange={(v) => actualizar("fuente", v === TODOS ? "" : v)}
          >
            <SelectTrigger id="filtro-fuente" size="default" className="h-9 w-48">
              <SelectValue placeholder="Todas las fuentes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas las fuentes</SelectItem>
              {FUENTES_PEDIDO.map((fuente) => (
                <SelectItem key={fuente} value={fuente}>
                  {etiquetaFuentePedido(fuente as FuentePedido)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Comuna — destino de los enlaces profundos de la Torre (F11). NO se
            oculta con "por revisar": acotar la bandeja de direcciones a una
            comuna es justamente lo que se quiere al llegar desde el mapa. */}
        <div className="flex flex-col gap-1">
          <label htmlFor="filtro-comuna" className="text-xs font-medium text-muted-foreground">
            Comuna
          </label>
          <Select
            value={filtroComuna || TODOS}
            onValueChange={(v) => actualizar("comuna", v === TODOS ? "" : v)}
          >
            <SelectTrigger id="filtro-comuna" size="default" className="h-9 w-48">
              <SelectValue placeholder="Todas las comunas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas las comunas</SelectItem>
              {COMUNAS_RM.map((comuna) => (
                <SelectItem key={comuna} value={comuna}>
                  {comuna}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Conductor — ídem F11: «Pérez · 12 de 40» tiene que llegar acá filtrado. */}
        <div className="flex flex-col gap-1">
          <label htmlFor="filtro-conductor" className="text-xs font-medium text-muted-foreground">
            Conductor
          </label>
          <Select
            value={filtroConductor || TODOS}
            onValueChange={(v) => actualizar("conductor", v === TODOS ? "" : v)}
          >
            <SelectTrigger id="filtro-conductor" size="default" className="h-9 w-48">
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

      {/* Limpiar filtros — solo visible cuando hay filtros activos. Limpia
          también el grupo de estado: es el único "volver al principio". */}
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
