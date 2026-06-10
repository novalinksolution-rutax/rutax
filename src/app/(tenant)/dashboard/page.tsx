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
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertCircle, AlertTriangle, Package, TrendingUp, Truck, Clock, Users, MapPin } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerMetricasDelDia } from "@/modules/operacion/metricas";
import { puedeVerReportesEjecutivos } from "@/modules/identidad/capacidades";
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

// =============================================================================
// Tipos y datos para alerta de folios (D-5)
// =============================================================================

interface AlertaFolios {
  foliosRestantes: number;
  folioHasta: number;
  agotado: boolean;
}

async function cargarAlertaFolios(
  tenantId: string,
): Promise<AlertaFolios | null> {
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

// =============================================================================
// Carga de datos del servidor
// =============================================================================

async function cargarDatosDashboard(tenantId: string) {
  const cliente = crearClienteServiceRole();
  const hoy = new Date();

  // Métricas e incidencias en paralelo
  const [metricas, incidenciasRaw, sellersRaw] = await Promise.all([
    obtenerMetricasDelDia(cliente, tenantId, hoy),

    // Incidencias abiertas del tenant para el bloque 3
    cliente
      .from("incidencias")
      .select("id, tipo, estado, abierta_en, pedido_id, seller_id")
      .eq("tenant_id", tenantId)
      .eq("estado", "abierta")
      .order("abierta_en", { ascending: true })
      .limit(10),

    // Sellers con conexión caída
    cliente
      .from("conexiones_seller_ml")
      .select("id, seller_id, sellers!conexiones_seller_ml_seller_id_fkey(razon_social)")
      .eq("tenant_id", tenantId)
      .eq("estado_salud", "desvinculada"),
  ]);

  // Filtrar incidencias sin gestión > umbral
  const incidenciasSinGestion: IncidenciaSinGestion[] = (incidenciasRaw.data ?? [])
    .filter((inc) => esIncidenciaSinGestion(inc.estado, inc.abierta_en))
    .slice(0, 5)
    .map((inc) => ({
      id: inc.id,
      tipo: traducirTipoIncidencia(inc.tipo),
      destinatario: inc.pedido_id, // se enriquece con join si es necesario
      seller: inc.seller_id,
      horasAbierta: Math.floor(horasDesde(inc.abierta_en)),
    }));

  // Sellers caídos
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

function BadgeTasaEntrega({ tasa }: { tasa: number }) {
  const pct = Math.round(tasa * 100);
  const color =
    pct >= 85
      ? "text-green-700 bg-green-50"
      : pct >= 70
        ? "text-yellow-700 bg-yellow-50"
        : "text-red-700 bg-red-50";
  return <span className={`text-2xl font-bold ${color} rounded px-1`}>{pct}%</span>;
}

function BarraEstado({ estado, cantidad, total }: { estado: EstadoPedido; cantidad: number; total: number }) {
  const pct = total > 0 ? Math.round((cantidad / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-40 truncate text-sm text-muted-foreground">{traducirEstadoPedido(estado)}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
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

  // Solo el dueño (y quien tenga reportes ejecutivos) accede al dashboard
  if (!puedeVerReportesEjecutivos(sesion.usuario)) {
    redirect("/operaciones");
  }

  const tenantId = sesion.usuario.tenantId;

  let metricas;
  let incidenciasSinGestion: IncidenciaSinGestion[] = [];
  let sellersCaidos: SellerCaido[] = [];
  let errorMetricas = false;
  let alertaFolios: AlertaFolios | null = null;

  try {
    // Cargar métricas y alerta de folios en paralelo (criterio C-4: solo aquí)
    const [datos, alertaFoliosDatos] = await Promise.all([
      cargarDatosDashboard(tenantId),
      cargarAlertaFolios(tenantId),
    ]);
    metricas = datos.metricas;
    incidenciasSinGestion = datos.incidenciasSinGestion;
    sellersCaidos = datos.sellersCaidos;
    alertaFolios = alertaFoliosDatos;
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

  // Estados con al menos 1 pedido, para el bloque de distribución
  const estadosConPedidos = (Object.entries(metricas.porEstado) as [EstadoPedido, number][]).filter(
    ([, cantidad]) => cantidad > 0,
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard operativo</h1>

      {/* Bloque 0.5 — Alerta de folios CAF (D-5, criterio C-4: solo aquí) */}
      {alertaFolios && (
        <div
          role="alert"
          aria-label={
            alertaFolios.agotado
              ? "Sin folios CAF disponibles"
              : "Folios CAF por agotarse"
          }
          className={`rounded-lg px-5 py-4 ${
            alertaFolios.agotado
              ? "bg-red-600 text-white"
              : "bg-yellow-400 text-yellow-900"
          }`}
        >
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-5 flex-shrink-0" aria-hidden="true" />
            {alertaFolios.agotado ? (
              "Sin folios CAF disponibles — la emisión de facturas está detenida. Sube un nuevo CAF inmediatamente."
            ) : (
              <>
                Folios CAF por agotarse — quedan{" "}
                <span className="font-bold">{alertaFolios.foliosRestantes}</span>{" "}
                folio{alertaFolios.foliosRestantes !== 1 ? "s" : ""}
              </>
            )}
          </div>
          {!alertaFolios.agotado && (
            <p className="mt-1 text-sm opacity-80">
              Sube un nuevo archivo CAF para evitar interrupciones.
            </p>
          )}
          <div className="mt-3">
            <Link
              href="/onboarding/folios"
              className={`inline-flex items-center gap-1 rounded px-3 py-1 text-sm font-medium transition-colors ${
                alertaFolios.agotado
                  ? "bg-white/20 text-white hover:bg-white/30"
                  : "bg-yellow-900/20 text-yellow-900 hover:bg-yellow-900/30"
              }`}
            >
              Subir CAF
            </Link>
          </div>
        </div>
      )}

      {/* B-7: Banner de conexiones solo si conexionesCaidas > 0 */}
      {sellersCaidos.length > 0 && (
        <div
          role="alert"
          className="rounded-lg bg-red-600 px-5 py-4 text-white"
          aria-label="Conexiones de Mercado Libre caídas"
        >
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <AlertCircle className="size-5 flex-shrink-0" aria-hidden="true" />
            Conexiones de Mercado Libre caídas ({sellersCaidos.length})
          </div>
          <ul className="space-y-2">
            {sellersCaidos.slice(0, 3).map((seller) => (
              <li key={seller.id} className="flex items-center justify-between gap-4">
                <span className="font-medium">{seller.nombre}</span>
                <Link
                  href={`/portal/conectar-ml?sellerId=${seller.id}`}
                  className="inline-flex items-center gap-1 rounded bg-white/20 px-3 py-1 text-sm font-medium hover:bg-white/30 transition-colors"
                >
                  Reconectar
                </Link>
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
          className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800"
        >
          No se pudieron cargar las métricas del día. Los accesos rápidos siguen disponibles.
        </div>
      )}

      {/* Bloque 1 — KPIs del día */}
      <section aria-labelledby="kpis-titulo">
        <h2 id="kpis-titulo" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Hoy
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {/* Conductores listos hoy */}
          <article className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <Users className="size-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {errorMetricas
                ? "—"
                : `${metricas.conductoresListosHoy} de ${metricas.conductoresActivos}`}
            </p>
            <p className="text-sm text-muted-foreground">Conductores listos hoy</p>
          </article>

          {/* Total del día */}
          <article className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <Package className="size-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {errorMetricas ? "—" : totalPedidos}
            </p>
            <p className="text-sm text-muted-foreground">Total del día</p>
          </article>

          {/* Tasa de entrega */}
          <article className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <TrendingUp className="size-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="mt-2">
              {errorMetricas ? (
                <span className="text-2xl font-bold">—</span>
              ) : (
                <BadgeTasaEntrega tasa={metricas.tasaEntrega} />
              )}
            </p>
            <p className="text-sm text-muted-foreground">Tasa de entrega</p>
          </article>

          {/* En ruta */}
          <article className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <Truck className="size-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {errorMetricas ? "—" : enRuta}
            </p>
            <p className="text-sm text-muted-foreground">En ruta ahora</p>
          </article>

          {/* Pendientes de asignación + CTA */}
          <article className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <Clock className="size-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {errorMetricas ? "—" : pendientesAsignacion}
            </p>
            <p className="text-sm text-muted-foreground">Pendientes de asignación</p>
            {pendientesAsignacion > 0 && !errorMetricas && (
              <Link
                href="/operaciones?estado=pendiente_asignacion"
                className="mt-2 inline-block text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                Asignar ahora
              </Link>
            )}
          </article>
        </div>
      </section>

      {/* Bloque 1.5 — Rezagados de ayer (solo si > 0) */}
      {!errorMetricas && metricas.rezagadosAyer > 0 && (
        <div
          role="alert"
          aria-label="Pedidos rezagados de ayer"
          className="rounded-lg border border-orange-200 bg-orange-50 px-5 py-4 text-orange-800"
        >
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-5 flex-shrink-0" aria-hidden="true" />
            {metricas.rezagadosAyer} pedido{metricas.rezagadosAyer !== 1 ? "s" : ""} de ayer{" "}
            {metricas.rezagadosAyer !== 1 ? "siguen" : "sigue"} sin estado final
          </div>
          <div className="mt-3">
            <Link
              href="/operaciones?rezagados=ayer"
              className="inline-flex items-center gap-1 rounded bg-orange-900/10 px-3 py-1 text-sm font-medium text-orange-900 hover:bg-orange-900/20 transition-colors"
            >
              Revisar rezagados
            </Link>
          </div>
        </div>
      )}

      {/* Bloque 2 — Distribución por estado (B-7: solo si hay pedidos) */}
      {hayPedidos && !errorMetricas && (
        <section aria-labelledby="distribucion-titulo">
          <h2 id="distribucion-titulo" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Distribución por estado
          </h2>
          <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
            {estadosConPedidos.map(([estado, cantidad]) => (
              <BarraEstado
                key={estado}
                estado={estado}
                cantidad={cantidad}
                total={totalPedidos}
              />
            ))}
          </div>
        </section>
      )}

      {/* Bloque 2.5 — Paquetes por comuna (solo si hay pedidos y datos) */}
      {hayPedidos && !errorMetricas && metricas.paquetesPorComuna.length > 0 && (
        <section aria-labelledby="comunas-titulo">
          <h2 id="comunas-titulo" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Paquetes por comuna
          </h2>
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <ul className="divide-y divide-border">
              {metricas.paquetesPorComuna.map(({ comuna, cantidad }) => (
                <li key={comuna} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <MapPin className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="text-sm font-medium">{comuna}</span>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
                    {cantidad}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Bloque 3 — Incidencias sin gestión (B-7: solo si hay al menos una) */}
      {incidenciasSinGestion.length > 0 && (
        <section aria-labelledby="incidencias-titulo">
          <h2 id="incidencias-titulo" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Incidencias sin gestión (más de {UMBRAL_INCIDENCIA_SIN_GESTION_HORAS} horas)
          </h2>
          <div className="rounded-xl border border-red-200 bg-card shadow-sm overflow-hidden">
            <ul className="divide-y divide-border">
              {incidenciasSinGestion.map((inc) => (
                <li key={inc.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{inc.tipo}</p>
                    <p className="text-xs text-muted-foreground">{inc.seller}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                    Sin gestión: {inc.horasAbierta}h
                  </span>
                </li>
              ))}
            </ul>
            <div className="border-t bg-muted/40 px-4 py-2">
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
        <h2 id="accesos-titulo" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Accesos rápidos
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Link
            href="/operaciones"
            className="rounded-xl border bg-card px-4 py-3 text-sm font-medium shadow-sm hover:bg-muted/50 transition-colors"
          >
            Ver todos los pedidos
          </Link>
          <Link
            href="/sellers"
            className="rounded-xl border bg-card px-4 py-3 text-sm font-medium shadow-sm hover:bg-muted/50 transition-colors"
          >
            Gestionar sellers
          </Link>
          <Link
            href="/equipo"
            className="rounded-xl border bg-card px-4 py-3 text-sm font-medium shadow-sm hover:bg-muted/50 transition-colors"
          >
            Gestionar equipo
          </Link>
        </div>
      </section>
    </div>
  );
}
