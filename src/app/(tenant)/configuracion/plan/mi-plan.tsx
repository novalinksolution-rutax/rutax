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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import type { VistaMiPlan, Entitlements } from "@/modules/plataforma/superficie-courier";
import { EMAIL_SOPORTE_RUTAX, MAILTO_SOPORTE_RUTAX } from "@/lib/contacto-rutax";
import type { ConsumoTenant } from "@/modules/plataforma/consumo";
import type { EstadoPago } from "@/modules/plataforma/tipos";
import { BloqueCobroAutomatico } from "./bloque-cobro-automatico";
import type { ContadorDelMes } from "@/modules/plataforma/contador-comision";

interface Props {
  miPlan: VistaMiPlan;
  entitlements: Entitlements;
  /** El contador del mes. `null` si el plan no es de comisión. */
  contador: ContadorDelMes | null;
  consumo: ConsumoTenant;
  /** Catálogo de planes activos — alimenta la sección "Cambiar de plan". */
}

function diasRestantesHasta(fechaIso: string): number {
  const ms = new Date(`${fechaIso}T00:00:00`).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export function MiPlan({ miPlan, entitlements, consumo, contador }: Props) {
  const { plan, periodoActual, historialPagos } = miPlan;

  return (
    <div className="space-y-6">
      {/* 1. Cabecera */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{plan.nombre}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <BadgeEstado variante={BADGE_ESTADO_SUSCRIPCION[miPlan.estado]} eje="suscripcion" valor={miPlan.estado} texto={TEXTO_ESTADO_SUSCRIPCION[miPlan.estado]} />
            {/* 🔴 La periodicidad se retiró con la cuota plana: con comisión
                siempre se factura mensual y vencido, así que decir «Facturación
                mensual» era repetir lo único posible. Lo que sí importa es el
                piso, porque explica una boleta que no cuadra con las entregas. */}
            <span className="text-muted-foreground">
              {plan.minimoMensualClp && plan.minimoMensualClp > 0
                ? `Mínimo ${formatearCLP(plan.minimoMensualClp)} al mes`
                : "Sin mínimo mensual"}
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
            {plan.precioPorPedidoClp === null
              ? formatearCLP(plan.precioMensualClp)
              : formatearCLP(plan.precioPorPedidoClp)}
          </p>
          <p className="text-xs text-muted-foreground">
            {plan.precioPorPedidoClp === null ? "por mes" : "por pedido entregado"}
          </p>
        </div>
      </div>

      {(miPlan.estado === "suspendida" || miPlan.estado === "cancelada") && (
        <BannerEstadoNoActivo estado={miPlan.estado} />
      )}

      {/* 2. Período vigente + Consumo del plan */}
      <div className="grid gap-4 sm:grid-cols-2">
        <section aria-labelledby="periodo-vigente-titulo" className="border border-line bg-bg-raised p-5">
          <h2
            id="periodo-vigente-titulo"
            className="mb-3 font-mono text-[10px] font-medium tracking-[0.12em] text-fg-subtle uppercase"
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
                <BadgeEstado variante={BADGE_ESTADO_PERIODO_SUSCRIPCION[periodoActual.estado]} eje="periodo-suscripcion" valor={periodoActual.estado} texto={TEXTO_ESTADO_PERIODO_SUSCRIPCION[periodoActual.estado]} />
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

        {/* 🔴 EL CONTADOR DEL MES, que es lo que hace creer el modelo.
            Con una cuota plana el courier sabía el día 1 lo que iba a pagar; con
            una comisión lo sabría recién al llegar la boleta. Acá lo ve correr.

            Lo que dice es «lo que llevas», NO «lo que vas a pagar»: el mes no ha
            cerrado, una entrega de hoy puede devolverse mañana, y la tarifa que
            se cobra es la vigente al cerrar. */}
        <section aria-labelledby="contador-titulo" className="border border-line bg-bg-raised p-5">
          <h2 id="contador-titulo" className="mb-3 font-mono text-[10px] font-medium tracking-[0.12em] text-fg-subtle uppercase">
            Lo que llevas este mes
          </h2>
          {contador ? (
            <div className="space-y-2">
              <p className="text-2xl font-semibold tabular-nums">
                {formatearCLP(contador.montoClp)}
              </p>
              <p className="text-sm text-muted-foreground">
                <span className="tabular-nums">{contador.pedidosEfectivos}</span>{" "}
                {contador.pedidosEfectivos === 1 ? "entrega" : "entregas"} ×{" "}
                {formatearCLP(contador.precioPorPedidoClp)}
              </p>
              {contador.aplicoMinimo ? (
                <p className="text-sm text-muted-foreground">
                  Se aplica el mínimo de {formatearCLP(contador.minimoMensualClp ?? 0)}: tus
                  entregas de este mes suman menos.
                </p>
              ) : null}
              {contador.esPrimerMes ? (
                <p className="text-sm text-muted-foreground">
                  Tu primer mes no lleva mínimo: se cobra solo lo que entregaste.
                </p>
              ) : null}
              <p className="text-xs text-fg-subtle">
                Cuenta las entregas que hiciste y que quedaron asignadas en Rutax. Se actualiza
                cada pocos minutos y se cierra el último día del mes.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <BloqueConsumo
                etiqueta="Conductores activos"
                usados={consumo.conductoresActivos}
                limite={entitlements.conductoresMax}
              />
            </div>
          )}
        </section>
      </div>

      {/* 🔴 Aquí estaba «Cambiar de plan». Se retiró con la cuota plana: con una
          sola modalidad no hay entre qué elegir, y una pantalla que ofrece una
          decisión inexistente es peor que una que no la ofrece. Con él se fue su
          proración, que arrastraba un hallazgo de severidad alta por comparar
          precios de unidades de tiempo distintas. Si el courier quiere otra
          tarifa, la conversación es con Rutax. */}

      {/* 4. Historial de pagos */}
      <section id="historial-pagos" aria-labelledby="historial-pagos-titulo" className="scroll-mt-24 space-y-3">
        <h2 id="historial-pagos-titulo" className="font-mono text-[10px] font-medium tracking-[0.12em] text-fg-subtle uppercase">
          Historial de pagos
        </h2>

        {historialPagos.length === 0 ? (
          <EmptyState
            icon={Receipt}
            titulo="Aún no hay pagos registrados"
            descripcion="Aquí verás cada pago confirmado cuando se procese tu primer período."
          />
        ) : (
          /* ⚠️ **La primitiva compartida, no una `<table>` a mano.**
              Esta pantalla se escribió antes del rediseño y traía su propia
              tabla, con sus propias clases: cabeceras en `text-xs uppercase`
              donde el resto del producto usa mono de 10 px, y `bg-card` /
              `border` / `text-muted-foreground` donde el resto usa los tokens
              `bg-bg-raised` / `border-line` / `text-fg-muted`. Se veía de otro
              producto, que es exactamente lo que se vino a arreglar.

              ⚠️ NO se usa `TablaFinanciera` pese a que el tablero la nombra:
              ésa desglosa UN documento —concepto, tarifa, subtotal, total— y
              esto es una lista de pagos en el tiempo, con una acción por fila y
              sin nada que sumar. Forzarla perdería la acción y ganaría una fila
              de total que no significa nada. */
          <div className="overflow-x-auto border border-line bg-bg-raised">
            <Table densidad="comfortable" aria-label="Historial de pagos de la suscripción">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="px-4">Fecha de pago</TableHead>
                  <TableHead className="px-4 text-right">Monto</TableHead>
                  <TableHead className="hidden px-4 sm:table-cell">Método</TableHead>
                  <TableHead className="px-4">Estado</TableHead>
                  <TableHead className="px-4 text-right">
                    <span className="sr-only">Comprobante</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historialPagos.map((pago) => (
                  <TableRow key={pago.periodoId}>
                    <TableCell className="px-4 text-fg-muted">
                      {pago.fecha ? formatearFecha(pago.fecha) : "—"}
                    </TableCell>
                    {/* `rx-num`: toda columna de cifras va en tabular para poder
                        compararse entre filas, que es a lo que se viene acá. */}
                    <TableCell className="rx-num px-4 text-right font-medium">
                      {formatearCLP(pago.montoClp)}
                    </TableCell>
                    <TableCell className="hidden px-4 text-fg-muted sm:table-cell">
                      {pago.metodo ? traducirMetodoPago(pago.metodo) : "—"}
                    </TableCell>
                    <TableCell className="px-4">
                      <EstadoPagoBadge estado={pago.estado} />
                    </TableCell>
                    <TableCell className="px-4 text-right">
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
                        <span className="text-xs text-fg-subtle">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* 5. Cobro automático */}
      <div id="cobro-automatico" className="scroll-mt-24">
        <BloqueCobroAutomatico mandatoEstado={miPlan.mandatoEstado} />
      </div>

      {/* 6. Nota de contacto */}
      <p className="text-center text-xs text-muted-foreground">
        ¿Necesitas ajustes de facturación, folios, datos de la factura, o un plan a medida? Escríbenos a{" "}
        <a href={MAILTO_SOPORTE_RUTAX} className="underline underline-offset-2">
          {EMAIL_SOPORTE_RUTAX}
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
            <a href={MAILTO_SOPORTE_RUTAX}>Contactar a Rutax</a>
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
  return <BadgeEstado variante={BADGE_ESTADO_PAGO_SUSCRIPCION[estado]} eje="pago-suscripcion" valor={estado} texto={TEXTO_ESTADO_PAGO_SUSCRIPCION[estado]} />;
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
