import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Activity, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { tieneSesionAdmin } from "../sesion-admin";
import {
  obtenerSaludJobs,
  obtenerBacklogSistema,
  type SaludJob,
} from "@/modules/plataforma/salud";

export const metadata: Metadata = {
  title: "Salud del sistema · Rutax Admin",
};

// El tablero refleja el estado en vivo; nunca cachear.
export const dynamic = "force-dynamic";

export default async function PaginaSalud() {
  // Doble verificación (igual que suscripciones): el código server que lee datos
  // cross-tenant vía service_role NUNCA corre sin sesión admin válida.
  if (!(await tieneSesionAdmin())) {
    redirect("/admin/login");
  }

  const [jobs, backlog] = await Promise.all([
    obtenerSaludJobs(),
    obtenerBacklogSistema(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Salud del sistema</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Telemetría de procesos automáticos e integridad del motor entrega→dinero.
          Se actualiza cada carga.
        </p>
      </div>

      {/* Contadores de backlog / integridad */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <TarjetaContador
          etiqueta="Períodos sin cerrar"
          valor={backlog.periodosAbiertosVencidos}
          alerta={backlog.periodosAbiertosVencidos > 0}
          ayuda="Vencidos pero aún 'abierto'"
        />
        <TarjetaContador
          etiqueta="Conciliaciones vencidas"
          valor={backlog.conciliacionesVencidas}
          alerta={backlog.conciliacionesVencidas > 0}
          ayuda={`de ${backlog.conciliacionesPendientes} pendientes`}
        />
        <TarjetaContador
          etiqueta="Líneas huérfanas"
          valor={backlog.lineasHuerfanasPendientes}
          alerta={backlog.lineasHuerfanasPendientes > 0}
          ayuda="Cobro activo sin pedido válido"
        />
        <TarjetaContador
          etiqueta="Jobs con fallo (24h)"
          valor={jobs.filter((j) => j.errores24h > 0).length}
          alerta={jobs.some((j) => j.errores24h > 0)}
          ayuda="Procesos con ≥1 error hoy"
        />
      </section>

      {/* Tabla de jobs */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <Activity className="size-4 text-muted-foreground" aria-hidden="true" />
          Procesos automáticos
        </h2>

        {jobs.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Aún no hay ejecuciones registradas. Los jobs aparecerán aquí tras su
            primera corrida.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Proceso</th>
                  <th className="px-3 py-2 font-medium">Último run</th>
                  <th className="px-3 py-2 font-medium">Última corrida</th>
                  <th className="px-3 py-2 font-medium">Último éxito</th>
                  <th className="px-3 py-2 font-medium text-right">Duración</th>
                  <th className="px-3 py-2 font-medium text-right">24h (err)</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <FilaJob key={j.jobId} job={j} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function TarjetaContador({
  etiqueta,
  valor,
  alerta,
  ayuda,
}: {
  etiqueta: string;
  valor: number;
  alerta: boolean;
  ayuda: string;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        alerta ? "border-destructive/40 bg-destructive/5" : "bg-card"
      }`}
    >
      <div className="text-xs text-muted-foreground">{etiqueta}</div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          alerta ? "text-destructive" : ""
        }`}
      >
        {valor}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{ayuda}</div>
    </div>
  );
}

function FilaJob({ job }: { job: SaludJob }) {
  return (
    <tr className="border-t">
      <td className="px-3 py-2 font-mono text-xs">{job.jobId}</td>
      <td className="px-3 py-2">
        <BadgeEstado estado={job.estado} />
      </td>
      <td className="px-3 py-2 text-muted-foreground">{haceCuanto(job.iniciadoEn)}</td>
      <td className="px-3 py-2 text-muted-foreground">
        {job.ultimoOkEn ? (
          haceCuanto(job.ultimoOkEn)
        ) : (
          <span className="text-destructive">nunca</span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {formatearDuracion(job.duracionMs)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {job.ejecuciones24h}
        {job.errores24h > 0 && (
          <span className="text-destructive"> ({job.errores24h})</span>
        )}
      </td>
    </tr>
  );
}

function BadgeEstado({ estado }: { estado: SaludJob["estado"] }) {
  const config = {
    ok: { Icon: CheckCircle2, clase: "text-success", texto: "OK" },
    error: { Icon: AlertTriangle, clase: "text-destructive", texto: "Error" },
    ejecutando: { Icon: Clock, clase: "text-muted-foreground", texto: "En curso" },
  }[estado];

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${config.clase}`}>
      <config.Icon className="size-3.5" aria-hidden="true" />
      {config.texto}
    </span>
  );
}

// =============================================================================
// Helpers de presentación (solo formato — sin lógica de negocio).
// =============================================================================

/** "hace 5 min" / "hace 2 h" / "hace 3 d". Devuelve "—" si es null. */
function haceCuanto(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "recién";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return `hace ${dias} d`;
}

/** "350 ms" / "1.2 s" / "2.5 min". Devuelve "—" si es null. */
function formatearDuracion(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${(s / 60).toFixed(1)} min`;
}
