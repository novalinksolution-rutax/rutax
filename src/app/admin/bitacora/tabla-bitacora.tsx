"use client";

/**
 * Tabla del visor de bitácora del backstage. Client Component solo para el
 * expandir/contraer del detalle de cada fila (el resto es presentación pura;
 * la paginación son <Link> server-friendly).
 *
 * `detalle` YA viene saneado de secretos por `identidad/auditoria.ts`
 * (constraint SQL + filtro de aplicación) — esta tabla NO re-filtra nada,
 * solo lo presenta como pares clave/valor en vez de volcar el jsonb crudo.
 */

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FilaBitacoraPlataforma } from "@/modules/plataforma/bitacora-consulta";
import type { ActorTipo } from "@/modules/identidad/auditoria";

const TEXTO_ACTOR_TIPO: Record<ActorTipo, string> = {
  super_admin: "Super-admin",
  usuario: "Usuario interno",
  sistema: "Sistema",
};

const FORMATEADOR_FECHA = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatearFecha(iso: string): string {
  return FORMATEADOR_FECHA.format(new Date(iso));
}

function formatearValorDetalle(valor: unknown): string {
  if (valor === null || valor === undefined) return "—";
  if (typeof valor === "string") return valor;
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  try {
    return JSON.stringify(valor);
  } catch {
    return String(valor);
  }
}

interface Props {
  filas: FilaBitacoraPlataforma[];
  total: number;
  limite: number;
  offset: number;
  /** Query string YA construido (sin `offset`) para armar los links de paginación. */
  queryStringSinOffset: string;
}

export function TablaBitacora({ filas, total, limite, offset, queryStringSinOffset }: Props) {
  const [expandidas, setExpandidas] = useState<Set<number>>(new Set());

  function toggle(id: number) {
    setExpandidas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function hrefPagina(nuevoOffset: number): string {
    const sp = new URLSearchParams(queryStringSinOffset);
    if (nuevoOffset > 0) sp.set("offset", String(nuevoOffset));
    const s = sp.toString();
    return `/admin/bitacora${s ? `?${s}` : ""}`;
  }

  const desde = total === 0 ? 0 : offset + 1;
  const hasta = Math.min(offset + limite, total);
  const hayAnterior = offset > 0;
  const haySiguiente = offset + limite < total;

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Bitácora de auditoría de plataforma">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-2">Fecha</th>
                <th scope="col" className="px-4 py-2">Acción</th>
                <th scope="col" className="px-4 py-2">Actor</th>
                <th scope="col" className="hidden px-4 py-2 sm:table-cell">Courier</th>
                <th scope="col" className="hidden px-4 py-2 md:table-cell">Entidad</th>
                <th scope="col" className="px-4 py-2 text-right">
                  <span className="sr-only">Detalle</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filas.map((f) => {
                const abierta = expandidas.has(f.id);
                const detalleEntries = Object.entries(f.detalle ?? {});
                return (
                  <Fragment key={f.id}>
                    <tr className="hover:bg-muted/30 transition-colors">
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {formatearFecha(f.creadoEn)}
                      </td>
                      <td className="px-4 py-3">
                        <code className="font-mono text-xs">{f.accion}</code>
                      </td>
                      <td className="px-4 py-3">
                        {f.actorNombre ? (
                          <div className="flex flex-col">
                            <span className="font-medium">{f.actorNombre}</span>
                            <span className="text-xs text-muted-foreground">{TEXTO_ACTOR_TIPO[f.actorTipo]}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">{TEXTO_ACTOR_TIPO[f.actorTipo]}</span>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        {f.tenantId ? (
                          f.nombreFantasiaTenant ?? (
                            <span className="font-mono text-xs text-muted-foreground">{f.tenantId.slice(0, 8)}…</span>
                          )
                        ) : (
                          <span className="italic text-muted-foreground">Plataforma</span>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        <div className="flex flex-col">
                          <span>{f.entidadTipo}</span>
                          {f.entidadId && (
                            <span className="font-mono text-xs text-muted-foreground">{f.entidadId.slice(0, 12)}…</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {detalleEntries.length > 0 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => toggle(f.id)}
                            aria-expanded={abierta}
                            className="h-8 gap-1 text-muted-foreground"
                          >
                            {abierta ? (
                              <ChevronDown className="size-4" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="size-4" aria-hidden="true" />
                            )}
                            Detalle
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                    {abierta && detalleEntries.length > 0 && (
                      <tr className="bg-muted/20">
                        <td colSpan={6} className="px-4 py-3">
                          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                            {detalleEntries.map(([clave, valor]) => (
                              <div key={clave} className="flex gap-2 text-xs">
                                <dt className="font-mono font-medium text-muted-foreground">{clave}:</dt>
                                <dd className="break-all">{formatearValorDetalle(valor)}</dd>
                              </div>
                            ))}
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Paginación */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Mostrando {desde}–{hasta} de {total}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={!hayAnterior} asChild={hayAnterior}>
            {hayAnterior ? (
              <Link href={hrefPagina(Math.max(offset - limite, 0))}>
                <ChevronLeft className="size-4" aria-hidden="true" />
                Anterior
              </Link>
            ) : (
              <>
                <ChevronLeft className="size-4" aria-hidden="true" />
                Anterior
              </>
            )}
          </Button>
          <Button variant="outline" size="sm" disabled={!haySiguiente} asChild={haySiguiente}>
            {haySiguiente ? (
              <Link href={hrefPagina(offset + limite)}>
                Siguiente
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            ) : (
              <>
                Siguiente
                <ChevronRight className="size-4" aria-hidden="true" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
