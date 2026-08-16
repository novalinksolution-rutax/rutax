"use client";

/**
 * Barra de filtros de la lista de pedidos — Client Component.
 * Los filtros se envían como searchParams en la URL (GET navigation).
 */

import { useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import { MapPinOff } from "lucide-react";
import { ESTADOS_PEDIDO, FUENTES_PEDIDO } from "@/modules/operacion/tipos";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { TEXTO_ESTADO_PEDIDO, etiquetaSellerConEstado } from "@/lib/ui/traduccion-estados";
import { etiquetaFuentePedido } from "@/lib/ui/etiqueta-fuente-pedido";
import type { EstadoPedido, FuentePedido } from "@/modules/operacion/tipos";
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
  filtroPorRevisar: boolean;
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
  filtroPorRevisar,
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
      if (campo !== "por_revisar" && filtroPorRevisar) params.set("por_revisar", "1");
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
      filtroPorRevisar,
    ],
  );

  /** Activa/desactiva la bandeja "Por revisar"; es exclusiva con estado/fecha. */
  const togglePorRevisar = useCallback(() => {
    if (filtroPorRevisar) {
      // Desactivar: volver a la vista sin filtros
      router.push(pathname);
    } else {
      // Activar: solo seller + por_revisar (limpia estado y fecha para no confundir)
      const params = new URLSearchParams();
      if (filtroSeller) params.set("seller", filtroSeller);
      params.set("por_revisar", "1");
      router.push(`${pathname}?${params.toString()}`);
    }
  }, [router, pathname, filtroPorRevisar, filtroSeller]);

  return (
    <div className="space-y-3">
      {/* Chip "Por revisar" — bandeja de excepciones geocoding */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={togglePorRevisar}
          aria-pressed={filtroPorRevisar}
          className={[
            "inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-xs font-semibold transition-colors",
            filtroPorRevisar
              ? "border-destructive bg-destructive-subtle text-destructive-subtle-foreground"
              : "border-border bg-muted/50 text-muted-foreground hover:border-destructive/60 hover:text-destructive-subtle-foreground",
          ].join(" ")}
        >
          <MapPinOff className="size-3.5" aria-hidden="true" />
          Direcciones por revisar
        </button>
        {filtroPorRevisar && (
          <span className="text-xs text-muted-foreground">
            Mostrando pedidos con dirección no ubicada, fuera de cobertura o sin tarifa de zona.
          </span>
        )}
      </div>

      {/* Filtros regulares (deshabilitados cuando "por revisar" está activo) */}
      <div className="flex flex-wrap items-end gap-3">
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

        {/* Estado — ocultar cuando "por revisar" está activo */}
        {!filtroPorRevisar && (
          <div className="flex flex-col gap-1">
            <label htmlFor="filtro-estado" className="text-xs font-medium text-muted-foreground">
              Estado
            </label>
            <Select
              value={filtroEstado || TODOS}
              onValueChange={(v) => actualizar("estado", v === TODOS ? "" : v)}
            >
              <SelectTrigger id="filtro-estado" size="default" className="h-9 w-48">
                <SelectValue placeholder="Todos los estados" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos los estados</SelectItem>
                {ESTADOS_PEDIDO.map((estado) => (
                  <SelectItem key={estado} value={estado}>
                    {TEXTO_ESTADO_PEDIDO[estado as EstadoPedido]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Fecha — ocultar cuando "por revisar" está activo */}
        {!filtroPorRevisar && (
          <FiltroFecha
            id="filtro-fecha"
            label="Fecha comprometida"
            hoy={hoy}
            exacto={filtroFecha}
            desde={filtroFechaDesde}
            hasta={filtroFechaHasta}
          />
        )}

        {/* Limpiar filtros — solo visible cuando hay filtros activos */}
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
    </div>
  );
}
