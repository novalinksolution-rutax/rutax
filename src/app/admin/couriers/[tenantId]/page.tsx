import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  Clock,
  PackageSearch,
  ShieldAlert,
  TriangleAlert,
  Wallet,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { tieneSesionAdmin } from "../../sesion-admin";
import {
  obtenerObservabilidadTenant,
  type ObservabilidadTenant,
} from "@/modules/plataforma/observabilidad-tenant";
import { DURACION_SOPORTE_MINUTOS, LARGO_MINIMO_MOTIVO } from "@/modules/plataforma/soporte";
import type { NivelSaludCourier } from "@/modules/plataforma/panel-couriers";
import type { Periodicidad } from "@/modules/plataforma/tipos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatearFechaHora } from "@/lib/formato-cl";
import { cn } from "@/lib/utils";
import { BotonSoporte } from "./boton-soporte";

export const metadata: Metadata = {
  title: "Detalle de courier · Rutax Admin",
};

// El drill-down refleja salud/backlog en vivo; nunca cachear.
export const dynamic = "force-dynamic";

const TEXTO_PERIODICIDAD: Record<Periodicidad, string> = {
  mensual: "Mensual",
  anual: "Anual",
};

/**
 * Mismo semáforo que el panel multi-courier (`tabla-couriers.tsx`) — se
 * duplica a propósito (mismo patrón que usan `metricas/page.tsx` y
 * `salud/page.tsx`: cada pantalla admin mantiene su propia config de
 * presentación) pero el CRITERIO viene de `derivarSaludCourier`
 * (`panel-couriers.ts`), nunca se re-deriva aquí.
 */
const SALUD_CONFIG: Record<NivelSaludCourier, { texto: string; variant: "success" | "warning" | "error" }> = {
  verde: { texto: "Saludable", variant: "success" },
  amarillo: { texto: "En prueba", variant: "warning" },
  rojo: { texto: "Necesita atención", variant: "error" },
};

/**
 * Traducción legible de `accion` de bitácora — SOLO para las acciones
 * curadas de este drill-down (ver `ACCIONES_ALERTA_TENANT` en
 * `observabilidad-tenant.ts`). La bitácora registra decenas de acciones de
 * todo el sistema; no existe (ni se justifica) un traductor genérico
 * compartido para todas ellas — este mapa es chico y acotado a propósito.
 */
const TEXTO_ACCION_ALERTA: Record<string, string> = {
  "notificacion.conexion_caida": "Conexión de Mercado Libre caída",
  "conexion_ml.error_callback": "Error al conectar una cuenta de Mercado Libre",
  "conexion_ml.colision_detectada": "Cuenta de Mercado Libre ya conectada por otro seller",
  "operacion.conductor_caido": "Conductor marcado no disponible (pedidos redistribuidos)",
  "operacion.notificacion_incidencia_sin_gestion": "Incidencia sin gestionar por más de 4 horas",
  "dinero.alerta_morosidad": "Alerta de morosidad enviada a un seller",
  "dinero.alerta_folios_proximos": "Folios DTE por agotarse",
  "plataforma.mandato_fallido": "Falló el mandato de cobro automático",
  "plataforma.pago_suscripcion_monto_discrepante": "Pago de suscripción por un monto distinto al esperado",
};

function traducirAccionAlerta(accion: string): string {
  return TEXTO_ACCION_ALERTA[accion] ?? accion;
}

/** Ídem — tipos de entidad observados en las acciones curadas de arriba. */
const TEXTO_ENTIDAD_TIPO: Record<string, string> = {
  seller: "Seller",
  conductor: "Conductor",
  incidencia: "Incidencia",
  periodo_cobro: "Período de cobro",
  folios_caf: "Folios DTE",
  suscripcion: "Suscripción",
  periodo_suscripcion: "Período de suscripción",
};

function traducirEntidadTipo(tipo: string): string {
  return TEXTO_ENTIDAD_TIPO[tipo] ?? tipo;
}

export default async function PaginaDetalleCourier({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  // Doble verificación (mismo patrón que el resto de `/admin/*`): el código
  // server que lee datos cross-tenant vía service_role NUNCA corre sin sesión
  // admin válida.
  if (!(await tieneSesionAdmin())) {
    redirect("/admin/login");
  }

  const { tenantId } = await params;

  let datos: ObservabilidadTenant | null = null;
  let errorCarga = false;

  try {
    datos = await obtenerObservabilidadTenant(tenantId);
  } catch {
    errorCarga = true;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/admin/couriers"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Couriers
        </Link>

        {/* "Ver como el courier" (gap 4, F3-B): abre un modal que pide motivo
            y, si es válido, redirige a /soporte con la ventana ya activa. Solo
            se ofrece cuando la carga fue exitosa (necesita tenantId/nombre). */}
        {datos && (
          <BotonSoporte
            tenantId={datos.tenantId}
            nombreCourier={datos.nombreFantasia ?? datos.tenantId}
            duracionMinutos={DURACION_SOPORTE_MINUTOS}
            largoMinimoMotivo={LARGO_MINIMO_MOTIVO}
          />
        )}
      </div>

      {errorCarga || !datos ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          No se pudo cargar el detalle de este courier. Intenta recargar la página.
        </div>
      ) : (
        <ContenidoDrillDown datos={datos} />
      )}
    </div>
  );
}

export function ContenidoDrillDown({ datos }: { datos: ObservabilidadTenant }) {
  const salud = datos.suscripcion ? SALUD_CONFIG[datos.suscripcion.salud] : null;

  return (
    <div className="space-y-8">
      {/* Cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {datos.nombreFantasia ?? (
              <span className="font-mono text-lg text-muted-foreground">{datos.tenantId.slice(0, 8)}…</span>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Salud de conexiones, backlog operativo, suscripción y alertas recientes de este courier.
          </p>
        </div>
        {salud ? (
          <Badge variant={salud.variant} className="h-6 text-sm">
            {salud.texto}
          </Badge>
        ) : (
          <Badge variant="neutral" className="h-6 text-sm">
            Sin suscripción
          </Badge>
        )}
      </div>

      {/* Conexiones ML */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Wifi className="size-4" aria-hidden="true" />
          Conexiones de Mercado Libre
          <span className="text-xs font-normal text-muted-foreground">
            ({datos.conexionesMl.total} cuenta{datos.conexionesMl.total === 1 ? "" : "s"} en total)
          </span>
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <TarjetaKPI
            icon={CheckCircle2}
            etiqueta="Sanas"
            valor={datos.conexionesMl.sanas}
            ayuda="Conectadas y sincronizando"
          />
          <TarjetaKPI
            icon={TriangleAlert}
            etiqueta="Necesitan atención"
            valor={datos.conexionesMl.atencion}
            ayuda="Con errores operativos"
            alerta={datos.conexionesMl.atencion > 0}
          />
          <TarjetaKPI
            icon={ShieldAlert}
            etiqueta="Desvinculadas"
            valor={datos.conexionesMl.desvinculadas}
            ayuda="Requieren reconexión del seller"
            alerta={datos.conexionesMl.desvinculadas > 0}
          />
          <TarjetaKPI
            icon={Clock}
            etiqueta="Pendientes"
            valor={datos.conexionesMl.pendientes}
            ayuda="Configurándose (transitorio)"
          />
        </div>
      </section>

      {/* Backlog operativo */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <PackageSearch className="size-4" aria-hidden="true" />
          Backlog operativo
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TarjetaKPI
            icon={PackageSearch}
            etiqueta="Pedidos pendientes"
            valor={datos.backlogOperativo.pedidosPendientes}
            ayuda="Fuera de su pipeline (aún no entregados ni cerrados)"
          />
          <TarjetaKPI
            icon={TriangleAlert}
            etiqueta="Incidencias sin gestión"
            valor={datos.backlogOperativo.incidenciasSinGestion}
            ayuda="Abiertas o en gestión"
            alerta={datos.backlogOperativo.incidenciasSinGestion > 0}
          />
        </div>
      </section>

      {/* Suscripción y morosidad */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Wallet className="size-4" aria-hidden="true" />
          Suscripción
        </h2>
        {datos.suscripcion ? (
          <div className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Estado</dt>
                <dd className="mt-1">
                  <Badge variant={SALUD_CONFIG[datos.suscripcion.salud].variant}>
                    {SALUD_CONFIG[datos.suscripcion.salud].texto}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Plan</dt>
                <dd className="mt-1 text-sm font-medium">
                  {datos.suscripcion.planNombre} · {TEXTO_PERIODICIDAD[datos.suscripcion.periodicidad]}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Morosidad</dt>
                <dd className="mt-1">
                  {datos.suscripcion.periodosVencidos > 0 ? (
                    <Badge variant="error">
                      {datos.suscripcion.periodosVencidos} período
                      {datos.suscripcion.periodosVencidos !== 1 ? "s" : ""} vencido
                      {datos.suscripcion.periodosVencidos !== 1 ? "s" : ""}
                    </Badge>
                  ) : (
                    <span className="text-sm text-muted-foreground">Sin atrasos</span>
                  )}
                </dd>
              </div>
            </dl>
            <Button variant="outline" size="sm" asChild className="shrink-0">
              <Link href={`/admin/suscripciones/${datos.suscripcion.suscripcionId}`}>Ver suscripción</Link>
            </Button>
          </div>
        ) : (
          <EmptyState
            icon={Wallet}
            tono="arranque"
            titulo="Este courier aún no tiene suscripción asignada"
            descripcion="El onboarding a Rutax como negocio está incompleto — asígnale un plan desde Suscripciones."
            accion={
              <Button asChild size="sm">
                <Link href="/admin/suscripciones">Ir a Suscripciones</Link>
              </Button>
            }
          />
        )}
      </section>

      {/* Alertas recientes */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Bell className="size-4" aria-hidden="true" />
          Alertas recientes
        </h2>

        {datos.alertasRecientes.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            tono="buen-estado"
            titulo="Sin alertas recientes"
            descripcion="Este courier no tiene eventos que requieran revisión entre los registros más recientes de su bitácora."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Alertas recientes del courier">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-4 py-2">
                      Fecha
                    </th>
                    <th scope="col" className="px-4 py-2">
                      Evento
                    </th>
                    <th scope="col" className="hidden px-4 py-2 sm:table-cell">
                      Entidad
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {datos.alertasRecientes.map((a) => (
                    <tr key={a.id} className="transition-colors hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {formatearFechaHora(a.creadoEn)}
                      </td>
                      <td className="px-4 py-3">{traducirAccionAlerta(a.accion)}</td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <div className="flex flex-col">
                          <span>{traducirEntidadTipo(a.entidadTipo)}</span>
                          {a.entidadId ? (
                            <span className="font-mono text-xs text-muted-foreground">
                              {a.entidadId.slice(0, 12)}…
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export function TarjetaKPI({
  icon: Icon,
  etiqueta,
  valor,
  ayuda,
  alerta = false,
}: {
  icon: LucideIcon;
  etiqueta: string;
  valor: number;
  ayuda: string;
  alerta?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        alerta ? "border-destructive/40 bg-destructive/5" : "bg-card",
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {etiqueta}
      </div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums sm:text-2xl", alerta && "text-destructive")}>
        {valor.toLocaleString("es-CL")}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{ayuda}</div>
    </div>
  );
}
