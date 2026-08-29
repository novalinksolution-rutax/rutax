"use client";

/**
 * Tabla del visor de bitácora del backstage. Client Component solo para el
 * expandir/contraer del detalle de cada fila (el resto es presentación pura;
 * la paginación son <Link> server-friendly).
 *
 * `detalle` YA viene saneado de secretos por `identidad/auditoria.ts`
 * (constraint SQL + filtro de aplicación) — esta tabla NO re-filtra nada,
 * solo lo presenta como pares clave/valor en vez de volcar el jsonb crudo.
 *
 * -----------------------------------------------------------------------------
 * 🔴 EN EL TELÉFONO LA FILA SE REACOMODA, NO SE RECORTA
 * -----------------------------------------------------------------------------
 * Medido en 375 px antes de esto: la tabla escondía **Courier** y **Entidad**
 * con `hidden sm:table-cell` / `md:table-cell`. En un visor de auditoría,
 * ocultar justo esas dos columnas es ocultar «sobre qué courier» y «sobre qué»,
 * que es la mitad de la pregunta que esta pantalla existe para responder.
 *
 * ⚠️ Lo que NO era: la página no se arrastraba de lado. La tabla ancha vivía
 * dentro de su `overflow-x-auto` y ahí se quedaba —lo correcto—; el defecto era
 * solo el recorte. (`document.documentElement.scrollWidth` dice lo contrario y
 * miente: reporta el descendiente más ancho aunque esté dentro de un scroller.
 * La medición honesta es `document.body.scrollWidth` o intentar
 * `window.scrollTo(600, 0)` y ver si `window.scrollX` se mueve.)
 *
 * Arquetipo P1 (`FichaFila390`, ya probado en couriers/nómina/incidencias):
 * - `estado` lleva la **fecha**: acá no hay un estado con color que disputarle
 *   el lugar (no es un semáforo de éxito/error), así que ese casillero lo
 *   ocupa el dato que SIEMPRE importa en un log de auditoría — cuándo.
 * - `clasificacion` lleva el **tipo de actor** (Super-admin / Usuario interno
 *   / Sistema), pero **solo cuando hay un nombre que la acompañe**: si el
 *   actor es "Sistema" y no hay `actorNombre`, ponerla igual duplicaría la
 *   misma palabra en `titulo` y en la etiqueta, dos veces el mismo dato.
 * - `titulo` es el **actor** (con el mismo criterio que el escritorio, donde
 *   ya iba en `font-medium`): es el «quién», y es lo que un admin busca con
 *   el pulgar al revisar quién tocó qué.
 * - `detalle` concatena, en el orden canónico de columnas que cae —Acción,
 *   Courier, Entidad—: la acción (el `<code>` técnico del escritorio, p. ej.
 *   `tenant.alta`), el courier (o «Plataforma» si la acción no es de ningún
 *   tenant) y la entidad con su id corto. Nada de esto se pierde.
 *
 * El botón «Detalle» (JSON expandible) es la única acción de la fila, así que
 * en el teléfono la ficha ENTERA es el botón —igual que en nómina e
 * incidencias— y no un botón aparte dentro de la ficha: dos objetos tocables
 * en una fila de 52 px es lo que la regla prohíbe.
 */

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FichaFila390 } from "@/components/ui/ficha-fila-390";
import { formatearFechaHora } from "@/lib/formato-cl";
import type { FilaBitacoraPlataforma } from "@/modules/plataforma/bitacora-consulta";
import type { ActorTipo } from "@/modules/identidad/auditoria";

const TEXTO_ACTOR_TIPO: Record<ActorTipo, string> = {
  super_admin: "Super-admin",
  usuario: "Usuario interno",
  sistema: "Sistema",
};

/**
 * ⚠️ Esto era un `Intl.DateTimeFormat` propio y le faltaba `hour12: false`: la
 * bitácora imprimía «28-08-2026, 10:09 p. m.» donde el resto del producto dice
 * «28-08-2026 22:09». La red mecánica del repo (`formato-cl.zona-horaria.test.ts`)
 * no lo agarró porque solo exige `timeZone`, que sí estaba.
 *
 * Se usa el helper compartido en vez de agregarle la opción al formateador
 * local: una bitácora es donde alguien va a comparar una hora contra otra
 * pantalla, y dos formateadores distintos son dos formatos distintos esperando
 * a divergir otra vez.
 */
function formatearFecha(iso: string): string {
  return formatearFechaHora(iso);
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
      {/* Teléfono: una ficha por entrada de bitácora. Nada se esconde. */}
      <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card shadow-sm sm:hidden">
        {filas.map((f) => {
          const abierta = expandidas.has(f.id);
          const detalleEntries = Object.entries(f.detalle ?? {});
          const courierTexto = f.tenantId
            ? (f.nombreFantasiaTenant ?? `Tenant ${f.tenantId.slice(0, 8)}…`)
            : "Plataforma";
          const entidadTexto = f.entidadId
            ? `${f.entidadTipo} ${f.entidadId.slice(0, 12)}…`
            : f.entidadTipo;
          const ficha = (
            <FichaFila390
              className="flex-1"
              estado={
                <span className="text-xs text-muted-foreground">{formatearFecha(f.creadoEn)}</span>
              }
              clasificacion={f.actorNombre ? TEXTO_ACTOR_TIPO[f.actorTipo] : undefined}
              titulo={f.actorNombre ?? TEXTO_ACTOR_TIPO[f.actorTipo]}
              detalle={[f.accion, courierTexto, entidadTexto].join(" · ")}
            />
          );
          return (
            <li key={f.id}>
              {detalleEntries.length > 0 ? (
                <button
                  type="button"
                  onClick={() => toggle(f.id)}
                  aria-expanded={abierta}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/30"
                >
                  {ficha}
                  {abierta ? (
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                </button>
              ) : (
                <div className="flex items-center gap-3 px-4 py-2">{ficha}</div>
              )}
              {abierta && detalleEntries.length > 0 ? (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-1 border-t border-border bg-muted/20 px-4 py-3">
                  {detalleEntries.map(([clave, valor]) => (
                    <div key={clave} className="flex gap-2 text-xs">
                      <dt className="font-mono font-medium text-muted-foreground">{clave}:</dt>
                      <dd className="break-all">{formatearValorDetalle(valor)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="hidden overflow-hidden rounded-lg border bg-card shadow-sm sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Bitácora de auditoría de plataforma">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-2">Fecha</th>
                <th scope="col" className="px-4 py-2">Acción</th>
                <th scope="col" className="px-4 py-2">Actor</th>
                <th scope="col" className="px-4 py-2">Courier</th>
                <th scope="col" className="px-4 py-2">Entidad</th>
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
                      <td className="px-4 py-3">
                        {f.tenantId ? (
                          f.nombreFantasiaTenant ?? (
                            <span className="font-mono text-xs text-muted-foreground">{f.tenantId.slice(0, 8)}…</span>
                          )
                        ) : (
                          <span className="italic text-muted-foreground">Plataforma</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
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
