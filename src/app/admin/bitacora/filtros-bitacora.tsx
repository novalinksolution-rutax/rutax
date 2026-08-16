"use client";

/**
 * Filtros del visor de bitácora del backstage — Client Component. Navega por
 * searchParams (GET), mismo patrón que los filtros del resto de la app
 * (p. ej. `dinero/conciliacion/filtros-conciliacion.tsx`): Select/Input del
 * sistema, cada cambio resetea la paginación (no se preserva `offset`).
 */

import { useRouter, usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FiltroFecha } from "@/components/filtros/filtro-fecha";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SuperAdminListado } from "../sesion-admin";

const TODOS = "__todos__";

interface TenantOpcion {
  id: string;
  nombreFantasia: string | null;
}

interface Props {
  tenants: TenantOpcion[];
  actores: SuperAdminListado[];
  /** "Hoy" civil de Santiago (para los atajos y la etiqueta del filtro de fecha). */
  hoy: string;
  filtroTenant: string;
  filtroAccion: string;
  filtroActor: string;
  /** Día exacto ("" si hay rango). */
  filtroFecha: string;
  /** Rango de fechas ("" si hay día exacto). Params `desde`/`hasta` (histórico). */
  filtroDesde: string;
  filtroHasta: string;
  hayFiltroActivo: boolean;
}

export function FiltrosBitacora({
  tenants,
  actores,
  hoy,
  filtroTenant,
  filtroAccion,
  filtroActor,
  filtroFecha,
  filtroDesde,
  filtroHasta,
  hayFiltroActivo,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [accionLocal, setAccionLocal] = useState(filtroAccion);

  const navegar = useCallback(
    (overrides: Record<string, string>) => {
      const params = new URLSearchParams();
      const valores: Record<string, string> = {
        tenant: filtroTenant,
        accion: filtroAccion,
        actor: filtroActor,
        // La fecha se cambia por su propio control; aquí solo se PRESERVA la
        // selección vigente (día exacto `fecha` o rango `desde`/`hasta`).
        fecha: filtroFecha,
        desde: filtroDesde,
        hasta: filtroHasta,
        ...overrides,
      };
      for (const [clave, valor] of Object.entries(valores)) {
        if (valor) params.set(clave, valor);
      }
      // Cualquier cambio de filtro vuelve a la primera página.
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, filtroTenant, filtroAccion, filtroActor, filtroFecha, filtroDesde, filtroHasta],
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="f-tenant" className="text-xs font-medium text-muted-foreground">
          Courier
        </label>
        <Select
          value={filtroTenant || TODOS}
          onValueChange={(v) => navegar({ tenant: v === TODOS ? "" : v })}
        >
          <SelectTrigger id="f-tenant" size="default" className="h-9 w-52">
            <SelectValue placeholder="Todos los couriers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los couriers</SelectItem>
            {tenants.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.nombreFantasia ?? `${t.id.slice(0, 8)}…`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="f-accion" className="text-xs font-medium text-muted-foreground">
          Acción
        </label>
        <Input
          id="f-accion"
          type="text"
          value={accionLocal}
          placeholder="Ej: tenant.alta"
          onChange={(e) => setAccionLocal(e.target.value)}
          onBlur={() => accionLocal !== filtroAccion && navegar({ accion: accionLocal.trim() })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              navegar({ accion: accionLocal.trim() });
            }
          }}
          className="h-9 w-44"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="f-actor" className="text-xs font-medium text-muted-foreground">
          Actor (super-admin)
        </label>
        <Select
          value={filtroActor || TODOS}
          onValueChange={(v) => navegar({ actor: v === TODOS ? "" : v })}
        >
          <SelectTrigger id="f-actor" size="default" className="h-9 w-48">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos</SelectItem>
            {actores.map((a) => (
              <SelectItem key={a.usuarioId} value={a.usuarioId}>
                {a.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <FiltroFecha
        id="f-fecha-bit"
        label="Fecha"
        hoy={hoy}
        exacto={filtroFecha}
        desde={filtroDesde}
        hasta={filtroHasta}
        paramDesde="desde"
        paramHasta="hasta"
        paramPagina="offset"
      />

      {hayFiltroActivo && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setAccionLocal("");
            router.push(pathname);
          }}
          className="h-9 text-muted-foreground"
        >
          Limpiar filtros
        </Button>
      )}
    </div>
  );
}
