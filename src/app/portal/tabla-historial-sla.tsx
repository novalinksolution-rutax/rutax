/**
 * Tabla de historial SLA — últimas 4 semanas (F13).
 *
 * Server Component. El seller ve SOLO su propio historial.
 * Muestra semana actual + 3 anteriores, con semáforo de color por semana.
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerHistorialSlaSemanas } from "@/modules/operacion/metricas";
import { semaforoSla } from "@/lib/ui/semaforo-sla";

interface Props {
  tenantId: string;
  sellerId: string;
}

function formatearSemana(desde: string, hasta: string): string {
  const fmtCorto = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${d}/${m}`;
  };
  const [a] = hasta.split("-");
  return `${fmtCorto(desde)} – ${fmtCorto(hasta)} ${a}`;
}

export async function TablaHistorialSla({ tenantId, sellerId }: Props) {
  let semanas: Awaited<ReturnType<typeof obtenerHistorialSlaSemanas>> = [];

  try {
    const cliente = crearClienteServiceRole();
    semanas = await obtenerHistorialSlaSemanas(cliente, tenantId, sellerId, 4);
  } catch {
    return null;
  }

  if (semanas.every((s) => s.totalTerminales === 0)) return null;

  return (
    <article className="rounded-lg border border-border bg-card shadow-xs">
      <div className="border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Historial de cumplimiento — últimas 4 semanas
        </h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Historial de SLA por semana">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-2">Semana</th>
              <th className="px-5 py-2 text-right">Entregas evaluadas</th>
              <th className="px-5 py-2 text-right">A tiempo</th>
              <th className="px-5 py-2 text-right">Cumplimiento</th>
              <th className="px-5 py-2 text-right">Objetivo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {semanas.map((s, idx) => {
              const semaforo = semaforoSla(s.slaPct, s.objetivoPct);
              const esSemanaActual = idx === 0;

              return (
                <tr
                  key={s.semanaDesde}
                  className={esSemanaActual ? "bg-muted/20" : ""}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block size-2.5 rounded-full ${s.totalTerminales > 0 ? semaforo.clasesColor : "bg-muted"}`}
                        aria-hidden="true"
                      />
                      <span className={esSemanaActual ? "font-semibold" : "text-muted-foreground"}>
                        {formatearSemana(s.semanaDesde, s.semanaHasta)}
                        {esSemanaActual && (
                          <span className="ml-1.5 text-xs text-muted-foreground">(en curso)</span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                    {s.totalTerminales > 0 ? s.totalTerminales : "—"}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                    {s.totalTerminales > 0 ? s.aTiempo : "—"}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {s.slaPct !== null ? (
                      <span
                        className={`font-mono font-semibold tabular-nums ${
                          s.slaPct >= s.objetivoPct
                            ? "text-success"
                            : s.slaPct >= s.objetivoPct - 5
                              ? "text-warning"
                              : "text-destructive"
                        }`}
                      >
                        {Math.round(s.slaPct)}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                    {s.objetivoPct}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}
