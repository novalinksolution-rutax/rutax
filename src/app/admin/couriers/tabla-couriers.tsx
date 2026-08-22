"use client";

/**
 * Tabla del panel de couriers (backstage). Client Component solo para el
 * filtro de búsqueda por nombre (los datos ya vienen completos del server —
 * filtrar en memoria evita un round-trip para una lista que, en la escala
 * actual de couriers de Rutax, cabe cómoda en una sola carga).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import {
  traducirEstadoSuscripcion,
  BADGE_ESTADO_SUSCRIPCION,
} from "@/lib/ui/traduccion-estados";
import type { CourierPanelItem, NivelSaludCourier } from "@/modules/plataforma/panel-couriers";
import type { Periodicidad } from "@/modules/plataforma/tipos";

const TEXTO_PERIODICIDAD: Record<Periodicidad, string> = {
  mensual: "Mensual",
  anual: "Anual",
};

const SALUD_CONFIG: Record<NivelSaludCourier, { texto: string; variant: "success" | "warning" | "error" }> = {
  verde: { texto: "Saludable", variant: "success" },
  amarillo: { texto: "En prueba", variant: "warning" },
  rojo: { texto: "Necesita atención", variant: "error" },
};

interface Props {
  couriers: CourierPanelItem[];
}

export function TablaCouriers({ couriers }: Props) {
  const [busqueda, setBusqueda] = useState("");

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return couriers;
    return couriers.filter((c) => {
      const nombre = (c.nombreFantasia ?? "").toLowerCase();
      return nombre.includes(q) || c.tenantId.toLowerCase().includes(q);
    });
  }, [couriers, busqueda]);

  if (couriers.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        tono="arranque"
        titulo="Sin couriers con suscripción"
        descripcion="Cuando asignes un plan a un courier desde Suscripciones, aparecerá aquí."
        accion={
          <Button asChild size="sm">
            <Link href="/admin/suscripciones">Ir a Suscripciones</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative w-full max-w-xs">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar courier…"
          aria-label="Buscar courier por nombre"
          className="h-9 pl-8"
        />
      </div>

      {filtrados.length === 0 ? (
        <EmptyState
          icon={Search}
          tono="filtro"
          titulo="Ningún courier coincide"
          descripcion="Prueba con otro nombre de búsqueda."
          accion={
            <Button variant="outline" size="sm" onClick={() => setBusqueda("")}>
              Limpiar búsqueda
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Panel de couriers">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-4 py-2">Courier</th>
                  <th scope="col" className="px-4 py-2">Estado</th>
                  <th scope="col" className="hidden px-4 py-2 sm:table-cell">Plan</th>
                  <th scope="col" className="hidden px-4 py-2 md:table-cell">Morosidad</th>
                  <th scope="col" className="px-4 py-2">Salud</th>
                  <th scope="col" className="px-4 py-2 text-right">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtrados.map((c) => {
                  const salud = SALUD_CONFIG[c.salud];
                  return (
                    <tr key={c.tenantId} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium">
                        <Link
                          href={`/admin/couriers/${c.tenantId}`}
                          className="hover:underline hover:underline-offset-2"
                        >
                          {c.nombreFantasia ?? (
                            <span className="font-mono text-xs text-muted-foreground">{c.tenantId.slice(0, 8)}…</span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <BadgeEstado
                          variante={BADGE_ESTADO_SUSCRIPCION[c.estadoSuscripcion]} eje="suscripcion" valor={c.estadoSuscripcion}
                          texto={traducirEstadoSuscripcion(c.estadoSuscripcion)}
                        />
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                        {c.planNombre} · {TEXTO_PERIODICIDAD[c.periodicidad]}
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        {c.periodosVencidos > 0 ? (
                          <Badge variant="error">
                            {c.periodosVencidos} período{c.periodosVencidos !== 1 ? "s" : ""} vencido{c.periodosVencidos !== 1 ? "s" : ""}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">Sin atrasos</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={salud.variant}>{salud.texto}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" asChild>
                            <Link href={`/admin/couriers/${c.tenantId}`}>Ver detalle</Link>
                          </Button>
                          <Button variant="outline" size="sm" asChild>
                            <Link href={`/admin/suscripciones/${c.suscripcionId}`}>Ver suscripción</Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
