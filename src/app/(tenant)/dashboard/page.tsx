/**
 * Dashboard del dueño — Flujo 4 (RF-041..RF-046, RF-050)
 *
 * Server Component: los datos se obtienen en el servidor para minimizar
 * el tiempo de primer renderizado. Las dos consultas (métricas + conexiones
 * caídas) se ejecutan en paralelo.
 *
 * Principio "de 30 segundos": el orden visual replica el orden de prioridad.
 * Lo más urgente (conexiones caídas) va arriba. Si no hay nada urgente,
 * el dueño empieza directamente por los KPIs.
 *
 * Pulido Fase 4: color por tokens semánticos (no paleta cruda), distribución
 * coloreada por estado (UI-4) y componentes del sistema (Button/Badge).
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  Package,
  TrendingUp,
  Truck,
  Clock,
  Users,
  MapPin,
} from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  obtenerMetricasDelDia,
  obtenerResumenFinancieroDelMes,
  type ResumenFinancieroMes,
} from "@/modules/operacion/metricas";
import { puedeVerReportesEjecutivos } from "@/modules/identidad/capacidades";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  traducirEstadoPedido,
  traducirTipoIncidencia,
  horasDesde,
  esIncidenciaSinGestion,
  UMBRAL_INCIDENCIA_SIN_GESTION_HORAS,
} from "@/lib/ui/traduccion-estados";
import type { EstadoPedido } from "@/modules/operacion/tipos";

// =============================================================================
// Tipos locales de datos del dashboard
// =============================================================================

interface SellerCaido {
  id: string;
  nombre: string;
}

interface IncidenciaSinGestion {
  id: string;
  tipo: string;
  destinatario: string;
  seller: string;
  horasAbierta: number;
}

interface AlertaFolios {
  foliosRestantes: number;
  folioHasta: number;
  agotado: boolean;
}

/** Relleno semántico de la barra de distribución por estado (UI-4: color = estado). */
const FILL_ESTADO: Record<EstadoPedido, string> = {
  pendiente_asignacion: "bg-warning",
  asignado: "bg-info",
  en_ruta: "bg-primary",
  entregado: "bg-success",
  entregado_manual: "bg-success",
  fallido: "bg-destructive",
  fallido_manual: "bg-destructive",
  cancelado: "bg-muted-foreground",
  devuelto: "bg-warning",
};

async function cargarAlertaFolios(tenantId: string): Promise<AlertaFolios | null> {
  const supabase = crearClienteServiceRole();
  const { data: folios } = await supabase
    .from("folios_caf")
    .select("folio_actual, folio_hasta, estado")
    .eq("tenant_id", tenantId)
    .eq("estado", "vigente")
    .limit(1)
    .maybeSingle();

  if (!folios) return null;
  const foliosRestantes = (folios.folio_hasta as number) - (folios.folio_actual as number);
  if (foliosRestantes >= 50) return null; // Sin alerta — suficientes folios
  return {
    foliosRestantes,
    folioHasta: folios.folio_hasta as number,
    agotado: foliosRestantes <= 0,
  };
}

async function cargarDatosDashboard(tenantId: string) {
  const cliente = crearClienteServiceRole();
  const hoy = new Date();

  const [metricas, incidenciasRaw, sellersRaw] = await Promise.all([
    obtenerMetricasDelDia(cliente, tenantId, hoy),
    cliente
      .from("incidencias")
      .select("id, tipo, estado, abierta_en, pedido_id, seller_id")
      .eq("tenant_id", tenantId)
      .eq("estado", "abierta")
      .order("abierta_en", { ascending: true })
      .limit(10),
    cliente
      .from("conexiones_seller_ml")
      .select("id, seller_id, sellers!conexiones_seller_ml_seller_id_fkey(razon_social)")
      .eq("tenant_id", tenantId)
      .eq("estado_salud", "desvinculada"),
  ]);

  const incidenciasSinGestion: IncidenciaSinGestion[] = (incidenciasRaw.data ?? [])
    .filter((inc) => esIncidenciaSinGestion(inc.estado, inc.abierta_en))
    .slice(0, 5)
    .map((inc) => ({
      id: inc.id,
      tipo: traducirTipoIncidencia(inc.tipo),
      destinatario: inc.pedido_id,
      seller: inc.seller_id,
      horasAbierta: Math.floor(horasDesde(inc.abierta_en)),
    }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sellersCaidos: SellerCaido[] = (sellersRaw.data ?? []).map((row: any) => ({
    id: row.seller_id,
    nombre: row.sellers?.razon_social ?? row.seller_id,
  }));

  return { metricas, incidenciasSinGestion, sellersCaidos };
}

// =============================================================================
// Componentes de presentación
// =============================================================================

function colorTasaEntrega(pct: number): string {
  if (pct >= 85) return "text-success";
  if (pct >= 70) return "text-warning";
  return "text-destructive";
}

function TarjetaKpi({
  icon: Icon,
  valor,
  etiqueta,
  valorClassName,
  children,
}: {
  icon: typeof Package;
  valor: React.ReactNode;
  etiqueta: string;
  valorClassName?: string;
  children?: React.ReactNode;
}) {
  return (
    <article className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-xs">
      <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
        <Icon className="size-4.5 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className={`mt-3 text-2xl font-bold tabular-nums ${valorClassName ?? ""}`}>{valor}</p>
      <p className="text-sm text-muted-foreground">{etiqueta}</p>
      {children}
    </article>
  );
}

function BarraEstado({
  estado,
  cantidad,
  total,
}: {
  estado: EstadoPedido;
  cantidad: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((cantidad / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-40 truncate text-sm text-muted-foreground">
        {traducirEstadoPedido(estado)}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${FILL_ESTADO[estado]}`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <span className="w-10 text-right text-sm font-semibold tabular-nums">{cantidad}</span>
    </div>
  );
}

// =============================================================================
// Página principal (Server Component)
// =============================================================================

export default async function PaginaDashboard() {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");

  if (!puedeVerReportesEjecutivos(sesion.usuario)) {
    redirect("/operaciones");
  }

  const tenantId = sesion.usuario.tenantId;

  let metricas;
  let incidenciasSinGestion: IncidenciaSinGestion[] = [];
  let sellersCaidos: SellerCaido[] = [];
  let errorMetricas = false;
  let alertaFolios: AlertaFolios | null = null;
  let resumenFinanciero: ResumenFinancieroMes | null = null;

  try {
    const [datos, alertaFoliosDatos, resumenFin] = await Promise.all([
      cargarDatosDashboard(tenantId),
      cargarAlertaFolios(tenantId),
      obtenerResumenFinancieroDelMes(crearClienteServiceRole(), tenantId, new Date()),
    ]);
    metricas = datos.metricas;
    incidenciasSinGestion = datos.incidenciasSinGestion;
    sellersCaidos = datos.sellersCaidos;
    alertaFolios = alertaFoliosDatos;
    resumenFinanciero = resumenFin;
  } catch {
    errorMetricas = true;
    metricas = {
      totalPedidos: 0,
      porEstado: {} as Partial<Record<EstadoPedido, number>>,
      tasaEntrega: 0,
      incidenciasAbiertas: 0,
      conexionesCaidas: 0,
      conductoresActivos: 0,
      conductoresListosHoy: 0,
      paquetesPorComuna: [] as Array<{ comuna: string; cantidad: number }>,
      rezagadosAyer: 0,
    };
  }

  const totalPedidos = metricas.totalPedidos;
  const enRuta = metricas.porEstado["en_ruta"] ?? 0;
  const pendientesAsignacion = metricas.porEstado["pendiente_asignacion"] ?? 0;
  const hayPedidos = totalPedidos > 0;
  const pctTasa = Math.round(metricas.tasaEntrega * 100);

  const estadosConPedidos = (Object.entries(metricas.porEstado) as [EstadoPedido, number][]).filter(
    ([, cantidad]) => cantidad > 0,
  );

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-bold">Dashboard operativo</h1>

      {/* Bloque 0.5 — Alerta de folios CAF (D-5) */}
      {alertaFolios && (
        <div
          role="alert"
          aria-label={
            alertaFolios.agotado ? "Sin folios CAF disponibles" : "Folios CAF por agotarse"
          }
          className={`rounded-lg px-5 py-4 ${
            alertaFolios.agotado
              ? "bg-destructive text-destructive-foreground"
              : "bg-warning text-warning-foreground"
          }`}
        >
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-5 shrink-0" aria-hidden="true" />
            {alertaFolios.agotado ? (
              "Sin folios CAF disponibles — la emisión de facturas está detenida. Sube un nuevo CAF inmediatamente."
            ) : (
              <>
                Folios CAF por agotarse — quedan{" "}
                <span className="font-bold tabular-nums">{alertaFolios.foliosRestantes}</span>{" "}
                folio{alertaFolios.foliosRestantes !== 1 ? "s" : ""}
              </>
            )}
          </div>
          {!alertaFolios.agotado && (
            <p className="mt-1 text-sm opacity-80">
              Sube un nuevo archivo CAF para evitar interrupciones.
            </p>
          )}
          <Button
            asChild
            size="sm"
            className="mt-3 border-transparent bg-white/15 text-current hover:bg-white/25"
          >
            <Link href="/onboarding/folios">Subir CAF</Link>
          </Button>
        </div>
      )}

      {/* Banner de conexiones caídas */}
      {sellersCaidos.length > 0 && (
        <div
          role="alert"
          className="rounded-lg bg-destructive px-5 py-4 text-destructive-foreground"
          aria-label="Conexiones de Mercado Libre caídas"
        >
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
            Conexiones de Mercado Libre caídas ({sellersCaidos.length})
          </div>
          <ul className="space-y-2">
            {sellersCaidos.slice(0, 3).map((seller) => (
              <li key={seller.id} className="flex items-center justify-between gap-4">
                <span className="font-medium">{seller.nombre}</span>
                <Button
                  asChild
                  size="sm"
                  className="border-transparent bg-white/15 text-current hover:bg-white/25"
                >
                  <Link href={`/portal/conectar-ml?sellerId=${seller.id}`}>Reconectar</Link>
                </Button>
              </li>
            ))}
          </ul>
          {sellersCaidos.length > 3 && (
            <Link
              href="/sellers"
              className="mt-3 block text-sm underline opacity-90 hover:opacity-100"
            >
              y {sellersCaidos.length - 3} más — ver todos los sellers
            </Link>
          )}
        </div>
      )}

      {/* Error al cargar métricas — no bloqueante */}
      {errorMetricas && (
        <div
          role="alert"
          className="rounded-lg bg-warning-subtle px-4 py-3 text-sm text-warning-subtle-foreground"
        >
          No se pudieron cargar las métricas del día. Los accesos rápidos siguen disponibles.
        </div>
      )}

      {/* Bloque 1 — KPIs del día */}
      <section aria-labelledby="kpis-titulo">
        <h2
          id="kpis-titulo"
          className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase"
        >
          Hoy
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <TarjetaKpi
            icon={Users}
            valor={
              errorMetricas
                ? "—"
                : `${metricas.conductoresListosHoy} de ${metricas.conductoresActivos}`
            }
            etiqueta="Conductores listos hoy"
          />
          <TarjetaKpi
            icon={Package}
            valor={errorMetricas ? "—" : totalPedidos}
            etiqueta="Total del día"
          />
          <TarjetaKpi
            icon={TrendingUp}
            valor={errorMetricas ? "—" : `${pctTasa}%`}
            valorClassName={errorMetricas ? "" : colorTasaEntrega(pctTasa)}
            etiqueta="Tasa de entrega"
          />
          <TarjetaKpi
            icon={Truck}
            valor={errorMetricas ? "—" : enRuta}
            etiqueta="En ruta ahora"
          />
          <TarjetaKpi
            icon={Clock}
            valor={errorMetricas ? "—" : pendientesAsignacion}
            etiqueta="Pendientes de asignación"
          >
            {pendientesAsignacion > 0 && !errorMetricas && (
              <Link
                href="/operaciones?estado=pendiente_asignacion"
                className="mt-2 inline-block text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                Asignar ahora
              </Link>
            )}
          </TarjetaKpi>
        </div>
      </section>

      {/* Bloque 1.2 — Dinero del mes (UX-2: el estado financiero, prominente) */}
      {resumenFinanciero && resumenFinanciero.periodosTotal > 0 && (
        <section aria-labelledby="dinero-titulo">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2
              id="dinero-titulo"
              className="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
            >
              Dinero del mes
            </h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {resumenFinanciero.periodosFacturados} de {resumenFinanciero.periodosTotal} períodos
              facturados
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <article className="rounded-xl border border-border bg-card p-4 shadow-xs">
              <p className="text-sm text-muted-foreground">Comprometido</p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
                {formatearCLP(resumenFinanciero.montoPeriodoClp)}
              </p>
              <p className="text-xs text-muted-foreground">Suma de los períodos del mes</p>
            </article>
            <article className="rounded-xl border border-border bg-card p-4 shadow-xs">
              <p className="text-sm text-muted-foreground">Cobrado</p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-success">
                {formatearCLP(resumenFinanciero.cobradoClp)}
              </p>
              <p className="text-xs text-muted-foreground">Pagos recibidos y conciliados</p>
            </article>
            <article className="rounded-xl border border-border bg-card p-4 shadow-xs">
              <p className="text-sm text-muted-foreground">Por cobrar</p>
              <p
                className={`mt-1 font-mono text-2xl font-bold tabular-nums ${
                  resumenFinanciero.porCobrarClp > 0 ? "text-warning" : "text-muted-foreground"
                }`}
              >
                {formatearCLP(resumenFinanciero.porCobrarClp)}
              </p>
              <p className="text-xs text-muted-foreground">Saldo pendiente de los sellers</p>
            </article>
          </div>
        </section>
      )}

      {/* Bloque 1.5 — Rezagados de ayer (solo si > 0) */}
      {!errorMetricas && metricas.rezagadosAyer > 0 && (
        <div
          role="alert"
          aria-label="Pedidos rezagados de ayer"
          className="rounded-lg bg-warning-subtle px-5 py-4 text-warning-subtle-foreground"
        >
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-5 shrink-0" aria-hidden="true" />
            {metricas.rezagadosAyer} pedido{metricas.rezagadosAyer !== 1 ? "s" : ""} de ayer{" "}
            {metricas.rezagadosAyer !== 1 ? "siguen" : "sigue"} sin estado final
          </div>
          <Button asChild variant="outline" size="sm" className="mt-3 bg-background/60">
            <Link href="/operaciones?rezagados=ayer">Revisar rezagados</Link>
          </Button>
        </div>
      )}

      {/* Bloque 2 — Distribución por estado (solo si hay pedidos) */}
      {hayPedidos && !errorMetricas && (
        <section aria-labelledby="distribucion-titulo">
          <h2
            id="distribucion-titulo"
            className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase"
          >
            Distribución por estado
          </h2>
          <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-xs">
            {estadosConPedidos.map(([estado, cantidad]) => (
              <BarraEstado key={estado} estado={estado} cantidad={cantidad} total={totalPedidos} />
            ))}
          </div>
        </section>
      )}

      {/* Bloque 2.5 — Paquetes por comuna (solo si hay pedidos y datos) */}
      {hayPedidos && !errorMetricas && metricas.paquetesPorComuna.length > 0 && (
        <section aria-labelledby="comunas-titulo">
          <h2
            id="comunas-titulo"
            className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase"
          >
            Paquetes por comuna
          </h2>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            <ul className="divide-y divide-border">
              {metricas.paquetesPorComuna.map(({ comuna, cantidad }) => (
                <li
                  key={comuna}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <MapPin className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="text-sm font-medium">{comuna}</span>
                  </div>
                  <Badge variant="neutral" className="tabular-nums">
                    {cantidad}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Bloque 3 — Incidencias sin gestión (solo si hay al menos una) */}
      {incidenciasSinGestion.length > 0 && (
        <section aria-labelledby="incidencias-titulo">
          <h2
            id="incidencias-titulo"
            className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase"
          >
            Incidencias sin gestión (más de {UMBRAL_INCIDENCIA_SIN_GESTION_HORAS} horas)
          </h2>
          <div className="overflow-hidden rounded-xl border border-destructive-subtle bg-card shadow-xs">
            <ul className="divide-y divide-border">
              {incidenciasSinGestion.map((inc) => (
                <li key={inc.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{inc.tipo}</p>
                    <p className="text-xs text-muted-foreground">{inc.seller}</p>
                  </div>
                  <Badge variant="error" className="tabular-nums">
                    Sin gestión: {inc.horasAbierta}h
                  </Badge>
                </li>
              ))}
            </ul>
            <div className="border-t border-border bg-muted/40 px-4 py-2">
              <Link
                href="/operaciones/incidencias?estado=abierta"
                className="text-sm font-medium text-primary hover:underline"
              >
                Ver todas las incidencias
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Bloque 4 — Accesos rápidos (siempre visibles) */}
      <section aria-labelledby="accesos-titulo">
        <h2
          id="accesos-titulo"
          className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase"
        >
          Accesos rápidos
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Button asChild variant="outline" className="h-auto justify-start px-4 py-3">
            <Link href="/operaciones">Ver todos los pedidos</Link>
          </Button>
          <Button asChild variant="outline" className="h-auto justify-start px-4 py-3">
            <Link href="/sellers">Gestionar sellers</Link>
          </Button>
          <Button asChild variant="outline" className="h-auto justify-start px-4 py-3">
            <Link href="/equipo">Gestionar equipo</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
