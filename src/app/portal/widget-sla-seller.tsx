/**
 * Widget semáforo SLA del seller (F7, ítem 1.2 — Tarea 5).
 *
 * Server Component — usa el cliente service_role con filtro explicit de
 * seller_id para cumplir con el aislamiento (RLS P2 ya lo garantiza en BD,
 * pero aquí filtramos también en la consulta por claridad y defensa en profundidad).
 *
 * El seller ve SOLO su propio % de cumplimiento.
 * NO ve configuración de zonas ni ventanas de corte (es información interna).
 */

import { TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerSlaPorSeller } from "@/modules/operacion/metricas";
import { semaforoSla } from "@/lib/ui/semaforo-sla";

interface Props {
  tenantId: string;
  sellerId: string;
}

export async function WidgetSlaSeller({ tenantId, sellerId }: Props) {
  let slaDatos: {
    slaPct: number | null;
    objetivoPct: number;
    aTiempo: number;
    totalTerminales: number;
  } | null = null;

  try {
    const cliente = crearClienteServiceRole();
    const resultados = await obtenerSlaPorSeller(
      cliente,
      tenantId,
      new Date(),
      "semana",
    );
    const miDato = resultados.find((r) => r.sellerId === sellerId);
    if (miDato) {
      slaDatos = {
        slaPct: miDato.slaPct,
        objetivoPct: miDato.objetivoPct,
        aTiempo: miDato.aTiempo,
        totalTerminales: miDato.totalTerminales,
      };
    }
  } catch {
    // No crítico: si falla, mostramos estado vacío.
    slaDatos = null;
  }

  if (!slaDatos) {
    return (
      <article className="rounded-xl border border-border bg-card p-5 shadow-xs">
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <TrendingUp className="size-4" aria-hidden="true" />
          Cumplimiento de SLA — últimos 7 días
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Aún no hay pedidos evaluados esta semana para calcular tu nivel de servicio.
        </p>
      </article>
    );
  }

  const semaforo = semaforoSla(slaDatos.slaPct, slaDatos.objetivoPct);
  const pctMostrado =
    slaDatos.slaPct !== null ? `${Math.round(slaDatos.slaPct)}%` : "—";

  return (
    <article
      className="rounded-xl border border-border bg-card p-5 shadow-xs"
      aria-label="Tu nivel de cumplimiento de SLA"
    >
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <TrendingUp className="size-4" aria-hidden="true" />
        Cumplimiento de SLA — últimos 7 días
      </div>

      <div className="flex items-center gap-4">
        {/* Indicador visual (color no es el único portador de significado) */}
        <span
          className={`size-4 rounded-full ${semaforo.clasesColor}`}
          aria-hidden="true"
        />
        <p className="text-3xl font-bold tabular-nums text-foreground">
          {pctMostrado}
        </p>
        <Badge variant={semaforo.variant}>{semaforo.etiqueta}</Badge>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        {slaDatos.aTiempo} de {slaDatos.totalTerminales} pedido
        {slaDatos.totalTerminales !== 1 ? "s" : ""} entregado
        {slaDatos.totalTerminales !== 1 ? "s" : ""} a tiempo.{" "}
        Objetivo: {slaDatos.objetivoPct}%.
      </p>
    </article>
  );
}
