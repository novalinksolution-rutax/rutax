/**
 * F22 — Franja de analítica financiera del dashboard del dueño.
 *
 * Server Component. Se renderiza solo si el usuario tiene
 * `ver_reportes_ejecutivos` o `ver_conciliacion`.
 *
 * Muestra: Ingreso · Costo · Margen · Costo por entrega ·
 * Fuga recuperada (métrica de venta) · Fuga detectada (pendiente).
 * Opcional: mini-tabla top-5 conductores por costo.
 *
 * El seller NUNCA ve esta sección — revela el markup.
 */

import Link from "next/link";
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Users, Scale, Divide } from "lucide-react";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import type { ResumenFinancieroAnalitica, CostoConductor } from "@/modules/dinero/analitica";

// =============================================================================
// Tipos de props
// =============================================================================

export interface DatosAnaliticaFinanciera {
  resumen: ResumenFinancieroAnalitica;
  topConductores: CostoConductor[];
  /** Etiqueta del período mostrado, p. ej. "junio 2026". */
  etiquetaPeriodo: string;
}

// =============================================================================
// Sub-componentes de tarjeta
// =============================================================================

function TarjetaFinanciera({
  etiqueta,
  valor,
  subtexto,
  colorValor,
  icon: Icon,
}: {
  etiqueta: string;
  valor: string;
  subtexto?: string;
  colorValor?: string;
  icon?: React.ElementType;
}) {
  return (
    <article className="flex flex-col rounded-lg border border-border bg-card p-4 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{etiqueta}</p>
        {Icon && (
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      <p
        className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${colorValor ?? "text-foreground"}`}
      >
        {valor}
      </p>
      {subtexto && <p className="mt-0.5 text-xs text-muted-foreground">{subtexto}</p>}
    </article>
  );
}

// =============================================================================
// Franja principal
// =============================================================================

export function FranjaAnaliticaFinanciera({ datos }: { datos: DatosAnaliticaFinanciera }) {
  const { resumen, topConductores, etiquetaPeriodo } = datos;

  const margenPositivo = resumen.margenClp >= 0;

  return (
    <section aria-labelledby="analitica-titulo">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2
          id="analitica-titulo"
          className="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
        >
          Analítica financiera — {etiquetaPeriodo}
        </h2>
        <Link
          href="/dinero/conciliacion"
          className="text-xs font-medium text-primary hover:underline"
        >
          Ver conciliación
        </Link>
      </div>

      {/* Tarjetas de resumen */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <TarjetaFinanciera
          etiqueta="Ingreso"
          valor={formatearCLP(resumen.ingresoTotalClp)}
          subtexto={`${resumen.totalEntregas} entregas`}
          icon={TrendingUp}
        />
        <TarjetaFinanciera
          etiqueta="Costo conductores"
          valor={formatearCLP(resumen.costoTotalClp)}
          subtexto="Total liquidaciones"
          icon={TrendingDown}
        />
        <TarjetaFinanciera
          etiqueta="Margen"
          valor={formatearCLP(resumen.margenClp)}
          subtexto="Ingreso − Costo"
          colorValor={margenPositivo ? "text-success" : "text-destructive"}
          icon={Scale}
        />
        <TarjetaFinanciera
          etiqueta="Costo por entrega"
          valor={formatearCLP(resumen.costoPromedioEntregaClp)}
          subtexto="Promedio conductores"
          icon={Divide}
        />
        {/* Fuga recuperada — la métrica de venta del producto */}
        <TarjetaFinanciera
          etiqueta="Fuga recuperada"
          valor={
            resumen.fugaRecuperadaClp > 0
              ? formatearCLP(resumen.fugaRecuperadaClp)
              : "—"
          }
          subtexto="Diferencias resueltas"
          colorValor={resumen.fugaRecuperadaClp > 0 ? "text-success" : undefined}
          icon={CheckCircle2}
        />
        {/* Fuga detectada — pendiente de resolver */}
        <TarjetaFinanciera
          etiqueta="Fuga detectada"
          valor={
            resumen.fugaDetectadaClp > 0
              ? formatearCLP(resumen.fugaDetectadaClp)
              : "—"
          }
          subtexto="Pendiente de resolver"
          colorValor={resumen.fugaDetectadaClp > 0 ? "text-destructive" : undefined}
          icon={resumen.fugaDetectadaClp > 0 ? AlertTriangle : undefined}
        />
      </div>

      {/* Mini-tabla top-5 conductores por costo */}
      {topConductores.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card shadow-xs">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Users className="size-4 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-sm font-semibold">
              Top conductores por costo — {etiquetaPeriodo}
            </h3>
          </div>
          <ul
            className="divide-y divide-border"
            aria-label="Conductores ordenados por costo total"
          >
            {topConductores.map((conductor, idx) => (
              <li
                key={conductor.driverId}
                className="flex items-center justify-between gap-4 px-4 py-2.5"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground"
                    aria-hidden="true"
                  >
                    {idx + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{conductor.nombre}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {conductor.entregas} entrega{conductor.entregas !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
                <span className="font-mono text-sm font-semibold tabular-nums">
                  {formatearCLP(conductor.costoTotalClp)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
