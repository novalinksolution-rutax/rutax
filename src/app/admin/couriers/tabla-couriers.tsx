"use client";

/**
 * Tabla del panel de couriers (backstage). Client Component solo para el
 * filtro de búsqueda por nombre (los datos ya vienen completos del server —
 * filtrar en memoria evita un round-trip para una lista que, en la escala
 * actual de couriers de Rutax, cabe cómoda en una sola carga).
 *
 * -----------------------------------------------------------------------------
 * 🔴 EN EL TELÉFONO LA FILA SE REACOMODA, NO SE RECORTA
 * -----------------------------------------------------------------------------
 * Medido en 375 px antes de esto: de las seis columnas se veían **cuatro**
 * —Courier, Estado, Salud y las acciones— porque Plan y Morosidad estaban en
 * `hidden sm:table-cell` / `md:table-cell`. O sea que en el teléfono la pantalla
 * de couriers no decía a quién hay que cobrarle.
 *
 * ⚠️ Lo que NO era: la página no se arrastraba de lado. La tabla ancha se
 * quedaba dentro de su `overflow-x-auto`, que es lo correcto; el defecto era
 * solo el recorte. (`document.documentElement.scrollWidth` sugiere lo contrario
 * y miente: reporta el descendiente más ancho aunque viva dentro de un
 * scroller. La medición honesta es `document.body.scrollWidth`, o intentar
 * `window.scrollTo(600, 0)` y ver si `window.scrollX` se mueve.)
 *
 * Es el arquetipo P1 que el rediseño fijó para los ~15 listados del producto y
 * que el backstage nunca recibió, porque se dejó fuera a propósito. La pieza
 * (`FichaFila390`) ya existe y está probada en nómina, incidencias y reportería:
 * acá se reusa, no se reinventa.
 *
 * ⚠️ En la ficha la morosidad sube ARRIBA, junto al estado, y no baja a la línea
 * de detalle. Es lo único accionable de esta pantalla: un courier con períodos
 * vencidos es una llamada que hay que hacer hoy. Enterrarlo en la línea gris
 * sería mantener el defecto que esto viene a arreglar, solo que más bonito.
 *
 * ⚠️ La ficha enlaza al DETALLE y no a la suscripción, aunque el escritorio
 * ofrezca los dos botones: dos objetos tocables de 44 px en una fila de 52 no
 * caben sin que uno se toque por error, y el detalle ya lleva su propio «Ver
 * suscripción». Nada queda inalcanzable, solo a un toque más.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, ChevronRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { Button } from "@/components/ui/button";
import { FichaFila390 } from "@/components/ui/ficha-fila-390";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import {
  traducirEstadoSuscripcion,
  BADGE_ESTADO_SUSCRIPCION,
} from "@/lib/ui/traduccion-estados";
import { DESCRIPCION_AREAS, type AreaProducto } from "@/modules/identidad/areas-producto";
import type {
  CourierInvitadoItem,
  CourierPanelItem,
  NivelSaludCourier,
} from "@/modules/plataforma/panel-couriers";
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

/**
 * «2 períodos vencidos» / «1 período vencido». En un solo sitio: lo dicen la
 * tabla y la ficha, y si divergen el backstage se contradice consigo mismo.
 */
function textoMorosidad(vencidos: number): string {
  return `${vencidos} período${vencidos !== 1 ? "s" : ""} vencido${vencidos !== 1 ? "s" : ""}`;
}

/**
 * Las áreas que Rutax le tiene apagadas a este courier.
 *
 * 🔴 Va en `neutral` y no en `warning`: un área apagada es una decisión de
 * Rutax, no una alerta sobre el courier. Con tono de advertencia la pantalla
 * diría que hay algo que arreglar, y lo que hay es algo que todavía no se
 * enciende — que es exactamente lo que este listado tiene que dejar de olvidar.
 */
function AreasApagadas({ areas }: { areas: readonly AreaProducto[] }) {
  if (areas.length === 0) return null;
  const titulos = areas.map(
    (a) => DESCRIPCION_AREAS.find((d) => d.clave === a)?.titulo ?? a,
  );
  return (
    <Badge variant="neutral" title={`Apagadas por Rutax: ${titulos.join(", ")}`}>
      {areas.length} área{areas.length !== 1 ? "s" : ""} apagada
      {areas.length !== 1 ? "s" : ""}
    </Badge>
  );
}

/**
 * Los couriers recién invitados que aún no tienen suscripción.
 *
 * Se muestran aparte de la tabla —y arriba— porque no son lo mismo: son couriers
 * a los que les falta un paso, no filas del panel normal. Cada uno dice CUÁL es
 * el paso que falta: que el dueño entre y complete sus datos, o que Rutax le
 * asigne un plan. Sin esto, el courier que acabas de invitar por correo no se
 * vería en ninguna parte hasta tener plan.
 */
function SeccionInvitados({ invitados }: { invitados: CourierInvitadoItem[] }) {
  if (invitados.length === 0) return null;
  return (
    <section className="rounded-lg border border-dashed border-border bg-muted/20 p-4">
      <h2 className="text-sm font-medium">Invitados, aún sin suscripción</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Couriers a los que ya invitaste. No aparecen en el panel de abajo hasta que
        tengan un plan.
      </p>
      <ul className="mt-3 divide-y divide-border">
        {invitados.map((c) => (
          <li key={c.tenantId} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 truncate text-sm font-medium">
              {c.nombreFantasia ?? `${c.tenantId.slice(0, 8)}…`}
            </span>
            {c.datosPendientes ? (
              <Badge variant="warning">Esperando que el dueño complete sus datos</Badge>
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/suscripciones">Asignar plan</Link>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface Props {
  couriers: CourierPanelItem[];
  invitados: CourierInvitadoItem[];
}

export function TablaCouriers({ couriers, invitados }: Props) {
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
      <div className="space-y-4">
        <SeccionInvitados invitados={invitados} />
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
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SeccionInvitados invitados={invitados} />
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
        <>
          {/* Teléfono: una ficha por courier. Nada se esconde. */}
          <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card shadow-sm sm:hidden">
            {filtrados.map((c) => (
              <li key={c.tenantId}>
                <Link
                  href={`/admin/couriers/${c.tenantId}`}
                  className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/30"
                >
                  <FichaFila390
                    className="flex-1"
                    estado={
                      <>
                        <BadgeEstado
                          variante={BADGE_ESTADO_SUSCRIPCION[c.estadoSuscripcion]}
                          eje="suscripcion"
                          valor={c.estadoSuscripcion}
                          texto={traducirEstadoSuscripcion(c.estadoSuscripcion)}
                        />
                        {c.periodosVencidos > 0 ? (
                          <Badge variant="error">{textoMorosidad(c.periodosVencidos)}</Badge>
                        ) : null}
                        <AreasApagadas areas={c.areasApagadas} />
                      </>
                    }
                    titulo={c.nombreFantasia ?? `${c.tenantId.slice(0, 8)}…`}
                    detalle={`${c.planNombre} · ${TEXTO_PERIODICIDAD[c.periodicidad]} · ${SALUD_CONFIG[c.salud].texto}`}
                  />
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-lg border bg-card shadow-sm sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Panel de couriers">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-4 py-2">Courier</th>
                    <th scope="col" className="px-4 py-2">Estado</th>
                    <th scope="col" className="px-4 py-2">Plan</th>
                    <th scope="col" className="px-4 py-2">Morosidad</th>
                    <th scope="col" className="px-4 py-2">Salud</th>
                    {/* Qué le tiene apagado Rutax. Columna propia y no un
                        adorno del nombre: es la única vista donde se ve de un
                        golpe a quién le falta algo por encender. */}
                    <th scope="col" className="px-4 py-2">Áreas</th>
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
                        <td className="px-4 py-3 text-muted-foreground">
                          {c.planNombre} · {TEXTO_PERIODICIDAD[c.periodicidad]}
                        </td>
                        <td className="px-4 py-3">
                          {c.periodosVencidos > 0 ? (
                            <Badge variant="error">{textoMorosidad(c.periodosVencidos)}</Badge>
                          ) : (
                            <span className="text-muted-foreground">Sin atrasos</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={salud.variant}>{salud.texto}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          {c.areasApagadas.length === 0 ? (
                            <span className="text-muted-foreground">Las cinco</span>
                          ) : (
                            <AreasApagadas areas={c.areasApagadas} />
                          )}
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
        </>
      )}
    </div>
  );
}
