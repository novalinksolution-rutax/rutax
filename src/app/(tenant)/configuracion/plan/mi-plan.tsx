/**
 * "Mi plan" — la suscripción del courier a Rutax. Mayormente de solo lectura
 * (Server Component), salvo dos secciones interactivas aisladas en client
 * components propios: "Cambiar de plan" (`CambiarPlan`, F2 item I) y "Cobro
 * automático" (`BloqueCobroAutomatico`, F1-E). El resto no necesita
 * interactividad más allá del botón de descarga de comprobante (un enlace
 * simple a la ruta `api/courier/plataforma/comprobantes/:periodoId`).
 *
 * Jerarquía (orden fijado por ux-ui):
 *  1. Cabecera — plan, estado, periodicidad, precio.
 *  2. Período vigente + Consumo del plan (misma fila en desktop).
 *  3. Cambiar de plan (única sección de auto-servicio que cobra/programa un cambio).
 *  4. Historial de pagos (con comprobante descargable por pago confirmado).
 *  5. Cobro automático.
 *  6. Nota de contacto.
 *
 */

import { CalendarClock, Download, Receipt, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { formatearCLP, formatearCLPOGuion } from "@/lib/ui/formato-moneda";
import { formatearFecha } from "@/lib/formato-cl";
import {
  BADGE_ESTADO_SUSCRIPCION,
  TEXTO_ESTADO_SUSCRIPCION,
  BADGE_ESTADO_PERIODO_SUSCRIPCION,
  TEXTO_ESTADO_PERIODO_SUSCRIPCION,
  BADGE_ESTADO_PAGO_SUSCRIPCION,
  TEXTO_ESTADO_PAGO_SUSCRIPCION,
  traducirMetodoPago,
} from "@/lib/ui/traduccion-estados";
import type { VistaMiPlan, Entitlements, PlanPublico } from "@/modules/plataforma/superficie-courier";
import type { ConsumoTenant } from "@/modules/plataforma/consumo";
import type { EstadoPago } from "@/modules/plataforma/tipos";
import { BloqueCobroAutomatico } from "./bloque-cobro-automatico";
import { CambiarPlan } from "./cambiar-plan";

interface Props {
  miPlan: VistaMiPlan;
  entitlements: Entitlements;
  consumo: ConsumoTenant;
  /** Catálogo de planes activos — alimenta la sección "Cambiar de plan". */
  planes: PlanPublico[];
}

function diasRestantesHasta(fechaIso: string): number {
  const ms = new Date(`${fechaIso}T00:00:00`).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export function MiPlan({ miPlan, entitlements, consumo, planes }: Props) {
  const { plan, periodoActual, historialPagos } = miPlan;

  return (
    <div className="space-y-6">
      {/* 1. Cabecera */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{plan.nombre}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <BadgeEstado variante={BADGE_ESTADO_SUSCRIPCION[miPlan.estado]} texto={TEXTO_ESTADO_SUSCRIPCION[miPlan.estado]} />
            <span className="text-muted-foreground">
              {miPlan.periodicidad === "mensual" ? "Facturación mensual" : "Facturación anual"}
            </span>
            {miPlan.estado === "trial" && miPlan.trialHasta ? (
              <span className="text-muted-foreground">
                {diasRestantesHasta(miPlan.trialHasta)} día{diasRestantesHasta(miPlan.trialHasta) === 1 ? "" : "s"}{" "}
                de prueba (hasta {formatearFecha(miPlan.trialHasta)})
              </span>
            ) : null}
          </div>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-2xl font-semibold tabular-nums">
            {formatearCLP(miPlan.periodicidad === "mensual" ? plan.precioMensualClp : plan.precioAnualClp)}
          </p>
          <p className="text-xs text-muted-foreground">{miPlan.periodicidad === "mensual" ? "por mes" : "por año"}</p>
        </div>
      </div>

      {(miPlan.estado === "suspendida" || miPlan.estado === "cancelada") && (
        <BannerEstadoNoActivo estado={miPlan.estado} />
      )}

      {/* 2. Período vigente + Consumo del plan */}
      <div className="grid gap-4 sm:grid-cols-2">
        <section aria-labelledby="periodo-vigente-titulo" className="rounded-lg border bg-card p-5 shadow-sm">
          <h2
            id="periodo-vigente-titulo"
            className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Período vigente
          </h2>
          {periodoActual ? (
            <div className="space-y-2">
              <p className="text-sm text-foreground">
                {formatearFecha(periodoActual.periodoInicio)} – {formatearFecha(periodoActual.periodoFin)}
              </p>
              <p className="text-2xl font-semibold tabular-nums">{formatearCLPOGuion(periodoActual.montoClp)}</p>
              <div className="flex flex-wrap items-center gap-2">
                <BadgeEstado variante={BADGE_ESTADO_PERIODO_SUSCRIPCION[periodoActual.estado]} texto={TEXTO_ESTADO_PERIODO_SUSCRIPCION[periodoActual.estado]} />
                {periodoActual.estado === "pendiente" && periodoActual.venceEn ? (
                  <span className="text-xs text-muted-foreground">
                    Vence el {formatearFecha(periodoActual.venceEn)}
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={CalendarClock}
              titulo="Aún no tienes período de cobro"
              descripcion="Tu primer período se genera automáticamente cuando comience el ciclo."
            />
          )}
        </section>

        <section aria-labelledby="consumo-titulo" className="rounded-lg border bg-card p-5 shadow-sm">
          <h2 id="consumo-titulo" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Consumo del plan
          </h2>
          <div className="space-y-4">
            <BloqueConsumo
              etiqueta="Pedidos este mes"
              usados={consumo.pedidosMes}
              limite={entitlements.limitePedidosMes}
            />
            <BloqueConsumo
              etiqueta="Conductores activos"
              usados={consumo.conductoresActivos}
              limite={entitlements.conductoresMax}
            />
          </div>
        </section>
      </div>

      {/* 3. Cambiar de plan — no aplica a una suscripción cancelada (mismo
          guard que `cambiarPlanCourier`, ver `superficie-courier.ts`); el
          banner de arriba ya invita a contactar a Rutax para reactivarla. */}
      {miPlan.estado !== "cancelada" ? (
        <CambiarPlan
          planes={planes}
          planActual={plan}
          periodicidadActual={miPlan.periodicidad}
          periodoActual={
            periodoActual
              ? { periodoInicio: periodoActual.periodoInicio, periodoFin: periodoActual.periodoFin }
              : null
          }
          cambioPendiente={miPlan.cambioPendiente}
        />
      ) : null}

      {/* 4. Historial de pagos */}
      <section aria-labelledby="historial-pagos-titulo" className="space-y-3">
        <h2 id="historial-pagos-titulo" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Historial de pagos
        </h2>

        {historialPagos.length === 0 ? (
          <EmptyState
            icon={Receipt}
            titulo="Aún no hay pagos registrados"
            descripcion="Aquí verás cada pago confirmado cuando se procese tu primer período."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Historial de pagos de la suscripción">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2">Fecha de pago</th>
                    <th className="px-4 py-2">Monto</th>
                    <th className="hidden px-4 py-2 sm:table-cell">Método</th>
                    <th className="px-4 py-2">Estado</th>
                    <th className="px-4 py-2 text-right">
                      <span className="sr-only">Comprobante</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {historialPagos.map((pago) => (
                    <tr key={pago.periodoId} className="transition-colors hover:bg-muted/30">
                      <td className="px-4 py-3 text-muted-foreground">
                        {pago.fecha ? formatearFecha(pago.fecha) : "—"}
                      </td>
                      <td className="px-4 py-3 font-medium tabular-nums">{formatearCLP(pago.montoClp)}</td>
                      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                        {pago.metodo ? traducirMetodoPago(pago.metodo) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <EstadoPagoBadge estado={pago.estado} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {pago.estado === "confirmado" ? (
                          <Button asChild variant="outline" size="sm">
                            <a
                              href={`/api/courier/plataforma/comprobantes/${pago.periodoId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Download className="size-3.5" aria-hidden="true" />
                              Comprobante
                            </a>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* 5. Cobro automático */}
      <BloqueCobroAutomatico mandatoEstado={miPlan.mandatoEstado} />

      {/* 6. Nota de contacto */}
      <p className="text-center text-xs text-muted-foreground">
        ¿Necesitas ajustes de facturación, folios, datos de la factura, o un plan a medida? Escríbenos a{" "}
        <a href="mailto:soporte@plataforma.cl" className="underline underline-offset-2">
          soporte@plataforma.cl
        </a>
        .
      </p>
    </div>
  );
}

function BannerEstadoNoActivo({ estado }: { estado: "suspendida" | "cancelada" }) {
  const esSuspendida = estado === "suspendida";
  return (
    <div
      className={
        esSuspendida
          ? "rounded-lg bg-warning-subtle p-4 text-warning-subtle-foreground"
          : "rounded-lg border border-border bg-muted/40 p-4 text-muted-foreground"
      }
    >
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {esSuspendida ? "Tu suscripción está suspendida." : "Tu suscripción fue cancelada."}
          </p>
          <p className="text-sm">
            {esSuspendida
              ? "Normalmente es por un pago pendiente. Escríbenos y lo resolvemos."
              : "Si quieres reactivarla, contáctanos y te ayudamos a hacerlo."}
          </p>
          <Button asChild variant="outline" size="sm" className="w-fit bg-transparent">
            <a href="mailto:soporte@plataforma.cl">Contactar a Rutax</a>
          </Button>
        </div>
      </div>
    </div>
  );
}

function EstadoPagoBadge({ estado }: { estado: EstadoPago | null }) {
  if (estado === null) {
    return <Badge variant="neutral">Sin pago registrado</Badge>;
  }
  return <BadgeEstado variante={BADGE_ESTADO_PAGO_SUSCRIPCION[estado]} texto={TEXTO_ESTADO_PAGO_SUSCRIPCION[estado]} />;
}

function BloqueConsumo({
  etiqueta,
  usados,
  limite,
}: {
  etiqueta: string;
  usados: number;
  limite: number | null;
}) {
  if (limite === null) {
    return (
      <div className="flex items-center justify-between text-sm">
        <span className="text-foreground">{etiqueta}</span>
        <span className="text-muted-foreground tabular-nums">{usados.toLocaleString("es-CL")} · Ilimitado</span>
      </div>
    );
  }

  const porcentaje = limite > 0 ? Math.round((usados / limite) * 100) : 0;
  const porcentajeBarra = Math.min(100, porcentaje);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-foreground">{etiqueta}</span>
        <span className="text-muted-foreground tabular-nums">
          {usados.toLocaleString("es-CL")} / {limite.toLocaleString("es-CL")}
        </span>
      </div>
      {/* Aviso BLANDO (regla dura): la barra nunca recolorea su indicador — solo
          el texto debajo cambia de tono. <80% sin texto extra. */}
      <Progress value={porcentajeBarra} />
      {porcentaje >= 100 ? (
        <p className="text-xs text-warning">
          Superaste el límite del plan. Cuéntanos: podemos ayudarte a encontrar el plan que necesitas.
        </p>
      ) : porcentaje >= 80 ? (
        <p className="text-xs text-warning">Te acercas al límite del plan.</p>
      ) : null}
    </div>
  );
}
