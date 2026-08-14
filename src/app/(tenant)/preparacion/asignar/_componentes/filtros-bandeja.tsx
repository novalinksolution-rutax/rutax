"use client";

/**
 * Filtros de la bandeja de asignación (§5, §9, §10). Server Component +
 * `searchParams` es el patrón de filtros del proyecto (§2.1): este
 * componente solo navega con `router.push`; `page.tsx` vuelve a leer y
 * filtrar en el servidor.
 *
 * Responsive: fila inline en escritorio (≥1024px); en móvil, el buscador
 * queda visible y comuna/seller/estado se agrupan tras un botón "Filtros"
 * que abre una `Sheet` desde abajo (§10).
 */

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Search as SearchIcon, SlidersHorizontal } from "lucide-react";
import type { EstadoAsignable } from "@/modules/operacion/asignacion";
import { etiquetaSellerConEstado } from "@/lib/ui/traduccion-estados";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SelectorComuna, type ComunaOpcion } from "./selector-comuna";

const TODOS_SELLER = "__todos__";

export interface SellerOpcion {
  id: string;
  nombre: string;
  estado: string;
}

export interface FiltrosBandejaProps {
  comunasCatalogo: ComunaOpcion[];
  sellers: SellerOpcion[];
  comunasSeleccionadas: readonly string[];
  sellerId: string | null;
  texto: string;
  estado: EstadoAsignable | null;
  hayFiltros: boolean;
}

interface Cambios {
  comunas?: string[];
  sellerId?: string | null;
  texto?: string;
  estado?: EstadoAsignable | null;
}

export function FiltrosBandeja({
  comunasCatalogo,
  sellers,
  comunasSeleccionadas,
  sellerId,
  texto,
  estado,
  hayFiltros,
}: FiltrosBandejaProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [textoLocal, setTextoLocal] = useState(texto);
  const [sheetAbierto, setSheetAbierto] = useState(false);

  function navegar(cambios: Cambios) {
    const params = new URLSearchParams();
    const comunasFinal = cambios.comunas ?? comunasSeleccionadas;
    const sellerFinal = cambios.sellerId !== undefined ? cambios.sellerId : sellerId;
    const textoFinal = cambios.texto !== undefined ? cambios.texto : texto;
    const estadoFinal = cambios.estado !== undefined ? cambios.estado : estado;

    for (const comuna of comunasFinal) params.append("comuna", comuna);
    if (sellerFinal) params.set("seller", sellerFinal);
    if (textoFinal.trim()) params.set("q", textoFinal.trim());
    if (estadoFinal) params.set("estado", estadoFinal);
    // `pagina` se omite a propósito: cualquier cambio de filtro vuelve a la
    // página 1 (mismo criterio que `filtros-pedidos.tsx`).

    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function limpiarTodo() {
    setTextoLocal("");
    setSheetAbierto(false);
    router.push(pathname);
  }

  function alConfirmarTexto() {
    if (textoLocal !== texto) navegar({ texto: textoLocal });
  }

  const nFiltrosEnSheet =
    (comunasSeleccionadas.length > 0 ? 1 : 0) + (sellerId ? 1 : 0) + (estado ? 1 : 0);

  const controlesFiltro = (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Comuna</span>
        <SelectorComuna
          opciones={comunasCatalogo}
          seleccionadas={comunasSeleccionadas}
          onCambiar={(siguiente) => navegar({ comunas: siguiente })}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="f-seller-asignar" className="text-xs font-medium text-muted-foreground">
          Seller
        </label>
        <Select
          value={sellerId ?? TODOS_SELLER}
          onValueChange={(v) => navegar({ sellerId: v === TODOS_SELLER ? null : v })}
        >
          <SelectTrigger id="f-seller-asignar" size="default" className="h-9 w-52">
            <SelectValue placeholder="Todos los sellers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS_SELLER}>Todos los sellers</SelectItem>
            {sellers.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {etiquetaSellerConEstado(s.nombre, s.estado)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Estado</span>
        <div className="flex items-center gap-1" role="group" aria-label="Filtrar por estado">
          <ChipEstado activo={estado === null} onClick={() => navegar({ estado: null })}>
            Todos
          </ChipEstado>
          <ChipEstado
            activo={estado === "pendiente_asignacion"}
            onClick={() => navegar({ estado: "pendiente_asignacion" })}
          >
            Sin asignar
          </ChipEstado>
          <ChipEstado activo={estado === "asignado"} onClick={() => navegar({ estado: "asignado" })}>
            Asignados
          </ChipEstado>
        </div>
      </div>
    </>
  );

  return (
    <div className="space-y-3">
      {/* Escritorio (≥1024px): fila inline — §9 */}
      <div className="hidden flex-wrap items-end gap-3 lg:flex">
        {controlesFiltro}
        <div className="flex flex-col gap-1">
          <label htmlFor="f-buscar-asignar" className="text-xs font-medium text-muted-foreground">
            Buscar por código de envío
          </label>
          <Input
            id="f-buscar-asignar"
            type="text"
            value={textoLocal}
            placeholder="Últimos dígitos…"
            onChange={(e) => setTextoLocal(e.target.value)}
            onBlur={alConfirmarTexto}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                alConfirmarTexto();
              }
            }}
            className="h-9 w-56"
          />
        </div>
        {hayFiltros && (
          <Button type="button" variant="ghost" size="sm" onClick={limpiarTodo} className="h-9 text-muted-foreground">
            Limpiar filtros
          </Button>
        )}
      </div>

      {/* Móvil (<1024px): trigger de filtros + buscador siempre visible — §10 */}
      <div className="flex items-center gap-2 lg:hidden">
        <Button
          type="button"
          variant="outline"
          size="default"
          className="h-9 shrink-0"
          onClick={() => setSheetAbierto(true)}
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          Filtros{nFiltrosEnSheet > 0 ? ` (${nFiltrosEnSheet})` : ""}
        </Button>
        <div className="relative flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label="Buscar por código de envío"
            type="text"
            value={textoLocal}
            placeholder="Buscar"
            onChange={(e) => setTextoLocal(e.target.value)}
            onBlur={alConfirmarTexto}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                alConfirmarTexto();
              }
            }}
            className="h-9 pl-8"
          />
        </div>
      </div>

      <Sheet open={sheetAbierto} onOpenChange={setSheetAbierto}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Filtros</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-4">
            {controlesFiltro}
            {hayFiltros && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={limpiarTodo}
                className="self-start text-muted-foreground"
              >
                Limpiar filtros
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ChipEstado({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={[
        "inline-flex h-9 items-center rounded-md border px-3 text-xs font-semibold transition-colors",
        activo
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-transparent text-muted-foreground hover:border-primary/40 hover:text-foreground",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
