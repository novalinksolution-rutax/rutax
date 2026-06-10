/**
 * Lista de pedidos — Pantalla 1-A (Flujo 1)
 * RF-015..RF-017, RF-019, RF-020
 *
 * Server Component. Los filtros (seller, estado, fecha) llegan como searchParams.
 * El objetivo: en menos de 10 segundos saber cuántos pedidos hay pendientes y cuáles.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { listarPedidos } from "@/modules/operacion/pedidos";
import {
  puedeAsignarYReasignarPedidos,
  puedeGestionarIncidencias,
  puedeAjustarOperacionDiaria,
} from "@/modules/identidad/capacidades";
import {
  traducirEstadoPedido,
  COLOR_ESTADO_PEDIDO,
  TEXTO_ESTADO_PEDIDO,
} from "@/lib/ui/traduccion-estados";
import { ESTADOS_PEDIDO } from "@/modules/operacion/tipos";
import type { EstadoPedido, Pedido } from "@/modules/operacion/tipos";
import { FormularioPedidoSameDay } from "./formulario-same-day";
import { FiltrosPedidosForm } from "./filtros-pedidos";

// =============================================================================
// Contadores de estado agrupados para los chips
// =============================================================================

function calcularContadores(pedidos: Pedido[]): Record<string, number> {
  const contadores: Record<string, number> = {
    pendiente_asignacion: 0,
    asignado: 0,
    en_ruta: 0,
    entregado: 0,
    con_problemas: 0,
  };

  for (const p of pedidos) {
    if (p.estado === "pendiente_asignacion") contadores.pendiente_asignacion++;
    else if (p.estado === "asignado") contadores.asignado++;
    else if (p.estado === "en_ruta") contadores.en_ruta++;
    else if (p.estado === "entregado" || p.estado === "entregado_manual") contadores.entregado++;
    else if (p.estado === "fallido" || p.estado === "fallido_manual" || p.estado === "devuelto")
      contadores.con_problemas++;
  }

  return contadores;
}

// =============================================================================
// Página principal
// =============================================================================

interface SearchParams {
  seller?: string;
  estado?: string;
  fecha?: string;
  pagina?: string;
}

export default async function PaginaOperaciones({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");

  const params = await searchParams;
  const tenantId = sesion.usuario.tenantId;

  // Filtros desde URL
  const filtroSeller = params.seller || "";
  const filtroEstado = (params.estado as EstadoPedido | "") || "";
  const filtroFecha = params.fecha || new Date().toISOString().split("T")[0];
  const pagina = Math.max(1, parseInt(params.pagina ?? "1", 10));
  const LIMITE = 25;

  const hayFiltroActivo = !!(filtroSeller || filtroEstado || (params.fecha && params.fecha !== new Date().toISOString().split("T")[0]));

  // Capacidades del usuario
  const puedeAsignar = puedeAsignarYReasignarPedidos(sesion.usuario);
  const puedeIncidencias = puedeGestionarIncidencias(sesion.usuario);
  const puedeAjustar = puedeAjustarOperacionDiaria(sesion.usuario);

  // Cargar pedidos
  const cliente = crearClienteServiceRole();
  let resultado;
  let errorCarga = false;

  try {
    resultado = await listarPedidos(cliente, {
      tenantId,
      sellerId: filtroSeller || undefined,
      estado: (filtroEstado as EstadoPedido) || undefined,
      fecha: filtroFecha || undefined,
      pagina,
      limite: LIMITE,
    });
  } catch {
    errorCarga = true;
    resultado = { datos: [], total: 0, pagina: 1, limite: LIMITE };
  }

  const pedidos = resultado.datos;
  const totalPedidos = resultado.total;
  const totalPaginas = Math.ceil(totalPedidos / LIMITE);
  const contadores = calcularContadores(pedidos);

  // Sellers disponibles para el filtro
  let sellersDisponibles: { id: string; nombre: string }[] = [];
  try {
    const { data } = await cliente
      .from("sellers")
      .select("id, razon_social")
      .eq("tenant_id", tenantId)
      .order("razon_social");
    sellersDisponibles = (data ?? []).map((s: { id: string; razon_social: string }) => ({
      id: s.id,
      nombre: s.razon_social,
    }));
  } catch {
    // sin bloquear si falla — el filtro quedará vacío
  }

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Pedidos</h1>
        <div className="flex items-center gap-2">
          {puedeIncidencias && (
            <Link
              href="/operaciones/incidencias"
              className="rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Ver incidencias
            </Link>
          )}
          {puedeAjustar && (
            <FormularioPedidoSameDay sellers={sellersDisponibles} tenantId={tenantId} />
          )}
        </div>
      </div>

      {/* Error de carga */}
      {errorCarga && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          No se pudo cargar la lista — intenta recargar la página.
        </div>
      )}

      {/* Bloque 1 — Contadores de estado */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="list" aria-label="Contadores por estado">
        {[
          { key: "pendiente_asignacion", label: "Pendiente asig.", color: "bg-yellow-50 border-yellow-200 text-yellow-800" },
          { key: "asignado", label: "Asignados", color: "bg-blue-50 border-blue-200 text-blue-800" },
          { key: "en_ruta", label: "En ruta", color: "bg-indigo-50 border-indigo-200 text-indigo-800" },
          { key: "entregado", label: "Entregados", color: "bg-green-50 border-green-200 text-green-800" },
          { key: "con_problemas", label: "Con problemas", color: "bg-red-50 border-red-200 text-red-800" },
        ].map(({ key, label, color }) => (
          <div
            key={key}
            role="listitem"
            className={`rounded-lg border px-3 py-2 ${color}`}
          >
            <p className="text-lg font-bold tabular-nums">
              {errorCarga ? "—" : (contadores[key] ?? 0)}
            </p>
            <p className="text-xs font-medium">{label}</p>
          </div>
        ))}
      </div>

      {/* Bloque 2 — Filtros */}
      <FiltrosPedidosForm
        sellers={sellersDisponibles}
        filtroSeller={filtroSeller}
        filtroEstado={filtroEstado}
        filtroFecha={filtroFecha}
        hayFiltroActivo={hayFiltroActivo}
      />

      {/* Bloque 3 — Tabla */}
      {pedidos.length === 0 && !errorCarga ? (
        <div className="rounded-xl border bg-card px-6 py-12 text-center">
          {hayFiltroActivo ? (
            <>
              <p className="text-muted-foreground">
                No hay pedidos que coincidan. Prueba cambiando el seller o la fecha.
              </p>
              <Link
                href="/operaciones"
                className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
              >
                Limpiar filtros
              </Link>
            </>
          ) : (
            <>
              <p className="text-muted-foreground">No hay pedidos para esta fecha.</p>
              {puedeAjustar && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Puedes crear un pedido same-day usando el botón de arriba.
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-sm text-muted-foreground">
              {errorCarga ? "—" : `${totalPedidos} pedidos`}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Lista de pedidos">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2">Estado</th>
                  <th className="px-4 py-2">Destinatario</th>
                  <th className="hidden px-4 py-2 sm:table-cell">Seller</th>
                  <th className="hidden px-4 py-2 md:table-cell">Fecha comprometida</th>
                  <th className="hidden px-4 py-2 lg:table-cell">Conductor</th>
                  <th className="px-4 py-2">Tipo</th>
                  {(puedeAsignar || puedeIncidencias || puedeAjustar) && (
                    <th className="px-4 py-2">
                      <span className="sr-only">Acciones</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pedidos.map((pedido) => (
                  <FilaPedido
                    key={pedido.id}
                    pedido={pedido}
                    puedeAsignar={puedeAsignar}
                    puedeIncidencias={puedeIncidencias}
                    puedeAjustar={puedeAjustar}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          {totalPaginas > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <span className="text-xs text-muted-foreground">
                Página {pagina} de {totalPaginas}
              </span>
              <div className="flex gap-2">
                {pagina > 1 && (
                  <Link
                    href={`/operaciones?${new URLSearchParams({
                      ...(filtroSeller && { seller: filtroSeller }),
                      ...(filtroEstado && { estado: filtroEstado }),
                      ...(filtroFecha && { fecha: filtroFecha }),
                      pagina: String(pagina - 1),
                    })}`}
                    className="rounded border px-3 py-1 text-xs hover:bg-muted transition-colors"
                  >
                    Anterior
                  </Link>
                )}
                {pagina < totalPaginas && (
                  <Link
                    href={`/operaciones?${new URLSearchParams({
                      ...(filtroSeller && { seller: filtroSeller }),
                      ...(filtroEstado && { estado: filtroEstado }),
                      ...(filtroFecha && { fecha: filtroFecha }),
                      pagina: String(pagina + 1),
                    })}`}
                    className="rounded border px-3 py-1 text-xs hover:bg-muted transition-colors"
                  >
                    Siguiente
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Fila de pedido en la tabla
// =============================================================================

function FilaPedido({
  pedido,
  puedeAsignar,
  puedeIncidencias,
  puedeAjustar,
}: {
  pedido: Pedido;
  puedeAsignar: boolean;
  puedeIncidencias: boolean;
  puedeAjustar: boolean;
}) {
  const tieneAcciones = puedeAsignar || puedeIncidencias || puedeAjustar;
  const estadoClases = COLOR_ESTADO_PEDIDO[pedido.estado];

  return (
    <tr className="group hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${estadoClases}`}
        >
          {traducirEstadoPedido(pedido.estado)}
        </span>
      </td>
      <td className="px-4 py-3">
        <Link href={`/operaciones/${pedido.id}`} className="font-medium hover:underline">
          {pedido.destinatarioNombre}
        </Link>
        <p className="text-xs text-muted-foreground">{pedido.destinatarioComuna}</p>
      </td>
      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
        {pedido.sellerId}
      </td>
      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
        {pedido.fechaCompromiso ?? "Sin fecha"}
      </td>
      <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
        {pedido.driverIdAsignado ? pedido.driverIdAsignado : (
          <span className="text-yellow-600">Sin asignar</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize">
          {pedido.tipoPedido === "flex" ? "Flex" : "Same-day"}
        </span>
      </td>
      {tieneAcciones && (
        <td className="px-4 py-3 text-right">
          <Link
            href={`/operaciones/${pedido.id}`}
            className="text-xs font-medium text-primary hover:underline"
          >
            Ver detalle
          </Link>
        </td>
      )}
    </tr>
  );
}
