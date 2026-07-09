"use client";

/**
 * Filtros de la bandeja de excepciones de conciliación (D-4, §1.1 P1) —
 * Client Component. Navega por searchParams (GET) al cambiar cualquier
 * filtro, sin botón de envío. Usa el Select del sistema (no <select> nativo)
 * para consistencia visual y de movimiento (DESIGN_SYSTEM §4).
 *
 * Los chips de "vista" (Vencidas/Abiertas/Sin asignar/Resueltas/Ignoradas)
 * viven en `page.tsx` como <Link> de servidor — este componente cubre los
 * filtros finos de la fila de selects: Estado (8 valores, más granular que
 * los chips) · Categoría · Tipo de diferencia · Seller · Asignado a · "Solo
 * con bloqueo activo". El filtro de Pedido (deep-link) no tiene control
 * propio — se preserva tal cual en cada navegación.
 */

import { useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";
import {
  TEXTO_ESTADO_CONCILIACION,
  TEXTO_TIPO_DIFERENCIA,
  TEXTO_CATEGORIA_NEGOCIO_CONCILIACION,
} from "@/lib/ui/traduccion-estados";
import type {
  CategoriaNegocioConciliacion,
  EstadoEventoConciliacion,
  TipoDiferenciaConciliacion,
} from "@/modules/dinero/tipos";
import type { UsuarioInterno } from "@/modules/identidad/consultas";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TODOS = "__todos__";
/** Valor sentinela del filtro "Asignado a" para "Sin asignar" — reusado por `page.tsx`. */
export const SIN_ASIGNAR_FILTRO = "__sin_asignar__";

interface Props {
  estados: EstadoEventoConciliacion[];
  categorias: CategoriaNegocioConciliacion[];
  tipos: TipoDiferenciaConciliacion[];
  sellers: { id: string; nombre: string }[];
  usuariosInternos: UsuarioInterno[];
  filtroVista: string;
  filtroEstado: string;
  filtroCategoria: string;
  filtroTipo: string;
  filtroSeller: string;
  filtroAsignado: string;
  filtroBloqueado: boolean;
  /** Filtro de pedido (deep-link, sin control de UI propio) — se preserva al cambiar cualquier otro filtro. */
  filtroPedido: string;
  hayFiltroActivo: boolean;
}

export function FiltrosConciliacion({
  estados,
  categorias,
  tipos,
  sellers,
  usuariosInternos,
  filtroVista,
  filtroEstado,
  filtroCategoria,
  filtroTipo,
  filtroSeller,
  filtroAsignado,
  filtroBloqueado,
  filtroPedido,
  hayFiltroActivo,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const actualizar = useCallback(
    (campo: string, valor: string) => {
      const params = new URLSearchParams();
      if (campo !== "vista" && filtroVista) params.set("vista", filtroVista);
      if (campo !== "estado" && filtroEstado) params.set("estado", filtroEstado);
      if (campo !== "categoria" && filtroCategoria) params.set("categoria", filtroCategoria);
      if (campo !== "tipo" && filtroTipo) params.set("tipo", filtroTipo);
      if (campo !== "seller" && filtroSeller) params.set("seller", filtroSeller);
      if (campo !== "asignado" && filtroAsignado) params.set("asignado", filtroAsignado);
      if (campo !== "bloqueado" && filtroBloqueado) params.set("bloqueado", "1");
      if (filtroPedido) params.set("pedido", filtroPedido);
      if (valor) params.set(campo, valor);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [
      router,
      pathname,
      filtroVista,
      filtroEstado,
      filtroCategoria,
      filtroTipo,
      filtroSeller,
      filtroAsignado,
      filtroBloqueado,
      filtroPedido,
    ],
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
        <label htmlFor="f-categoria-c" className="text-xs font-medium text-muted-foreground">
          Categoría de negocio
        </label>
        <Select
          value={filtroCategoria || TODOS}
          onValueChange={(v) => actualizar("categoria", v === TODOS ? "" : v)}
        >
          <SelectTrigger id="f-categoria-c" size="default" className="h-9 w-52">
            <SelectValue placeholder="Todas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas</SelectItem>
            {categorias.map((c) => (
              <SelectItem key={c} value={c}>
                {TEXTO_CATEGORIA_NEGOCIO_CONCILIACION[c]}
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

      <div className="flex flex-col gap-1">
        <label htmlFor="f-asignado-c" className="text-xs font-medium text-muted-foreground">
          Asignado a
        </label>
        <Select
          value={filtroAsignado || TODOS}
          onValueChange={(v) => actualizar("asignado", v === TODOS ? "" : v)}
        >
          <SelectTrigger id="f-asignado-c" size="default" className="h-9 w-48">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos</SelectItem>
            <SelectItem value={SIN_ASIGNAR_FILTRO}>Sin asignar</SelectItem>
            {usuariosInternos.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.nombreCompleto}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <label className="flex h-9 cursor-pointer items-center gap-2 text-sm text-foreground">
        <Checkbox
          checked={filtroBloqueado}
          onCheckedChange={(v) => actualizar("bloqueado", v === true ? "1" : "")}
        />
        Solo con bloqueo activo
      </label>

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
