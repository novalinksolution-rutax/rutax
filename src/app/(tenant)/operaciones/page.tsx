/**
 * Lista de pedidos — Pantalla 1-A (Flujo 1)
 * RF-015..RF-017, RF-019, RF-020
 *
 * Server Component. Los filtros (seller, estado, fecha) llegan como searchParams.
 * El objetivo: en menos de 10 segundos saber cuántos pedidos hay pendientes y cuáles.
 *
 * Pulido Fase 4 (UX-7 / UI-6): sistema DataTable + Table (densidad compacta,
 * numéricos tabulares), estados de vista con EmptyState, paginación del sistema
 * y color por tokens semánticos.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { Inbox, SearchX } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { listarPedidos } from "@/modules/operacion/pedidos";
import {
  puedeAsignarYReasignarPedidos,
  puedeGestionarIncidencias,
  puedeAjustarOperacionDiaria,
} from "@/modules/identidad/capacidades";
import { traducirEstadoPedido, BADGE_ESTADO_PEDIDO } from "@/lib/ui/traduccion-estados";
import type { EstadoPedido, Pedido } from "@/modules/operacion/tipos";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable } from "@/components/ui/data-table";
import { Pagination } from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

const CONTADORES = [
  { key: "pendiente_asignacion", label: "Pendiente asig.", clases: "bg-warning-subtle text-warning-subtle-foreground" },
  { key: "asignado", label: "Asignados", clases: "bg-info-subtle text-info-subtle-foreground" },
  { key: "en_ruta", label: "En ruta", clases: "bg-info-subtle text-info-subtle-foreground" },
  { key: "entregado", label: "Entregados", clases: "bg-success-subtle text-success-subtle-foreground" },
  { key: "con_problemas", label: "Con problemas", clases: "bg-destructive-subtle text-destructive-subtle-foreground" },
] as const;

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

  const hoyIso = new Date().toISOString().split("T")[0];
  const filtroSeller = params.seller || "";
  const filtroEstado = (params.estado as EstadoPedido | "") || "";
  const filtroFecha = params.fecha || hoyIso;
  const pagina = Math.max(1, parseInt(params.pagina ?? "1", 10));
  const LIMITE = 25;

  const hayFiltroActivo = !!(
    filtroSeller ||
    filtroEstado ||
    (params.fecha && params.fecha !== hoyIso)
  );

  const puedeAsignar = puedeAsignarYReasignarPedidos(sesion.usuario);
  const puedeIncidencias = puedeGestionarIncidencias(sesion.usuario);
  const puedeAjustar = puedeAjustarOperacionDiaria(sesion.usuario);

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
  const tieneAcciones = puedeAsignar || puedeIncidencias || puedeAjustar;

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

  function hrefPagina(p: number): string {
    const sp = new URLSearchParams();
    if (filtroSeller) sp.set("seller", filtroSeller);
    if (filtroEstado) sp.set("estado", filtroEstado);
    if (filtroFecha) sp.set("fecha", filtroFecha);
    if (p > 1) sp.set("pagina", String(p));
    const qs = sp.toString();
    return qs ? `/operaciones?${qs}` : "/operaciones";
  }

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-bold">Pedidos</h1>
        <div className="flex items-center gap-2">
          {puedeIncidencias && (
            <Button asChild variant="outline" size="sm">
              <Link href="/operaciones/incidencias">Ver incidencias</Link>
            </Button>
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
          className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground"
        >
          No se pudo cargar la lista — intenta recargar la página.
        </div>
      )}

      {/* Bloque 1 — Contadores de estado */}
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-5"
        role="list"
        aria-label="Contadores por estado"
      >
        {CONTADORES.map(({ key, label, clases }) => (
          <div key={key} role="listitem" className={`rounded-lg px-3 py-2 ${clases}`}>
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

      {/* Bloque 3 — Tabla / estados de vista */}
      {pedidos.length === 0 && !errorCarga ? (
        hayFiltroActivo ? (
          <EmptyState
            icon={SearchX}
            tono="filtro"
            titulo="Ningún pedido coincide"
            descripcion="No hay pedidos con estos filtros. Prueba cambiando el seller, el estado o la fecha."
            accion={
              <Button asChild variant="outline" size="sm">
                <Link href="/operaciones">Limpiar filtros</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Inbox}
            titulo="No hay pedidos para esta fecha"
            descripcion={
              puedeAjustar
                ? "Llegan solos cuando tus sellers conectan Mercado Libre. También puedes crear un pedido same-day desde el botón de arriba."
                : "Llegan solos cuando tus sellers conectan Mercado Libre."
            }
          />
        )
      ) : (
        <DataTable
          toolbar={
            <span className="text-sm text-muted-foreground tabular-nums">
              {errorCarga ? "—" : `${totalPedidos} pedidos`}
            </span>
          }
          footer={
            totalPaginas > 1 ? (
              <Pagination
                pagina={pagina}
                totalPaginas={totalPaginas}
                hrefPagina={hrefPagina}
              />
            ) : undefined
          }
        >
          <Table densidad="compact" aria-label="Lista de pedidos">
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="px-4">Estado</TableHead>
                <TableHead className="px-4">Destinatario</TableHead>
                <TableHead className="hidden px-4 sm:table-cell">Seller</TableHead>
                <TableHead className="hidden px-4 text-right md:table-cell">
                  Fecha comprometida
                </TableHead>
                <TableHead className="hidden px-4 lg:table-cell">Conductor</TableHead>
                <TableHead className="px-4">Tipo</TableHead>
                {tieneAcciones && (
                  <TableHead className="px-4 text-right">
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pedidos.map((pedido) => (
                <FilaPedido key={pedido.id} pedido={pedido} tieneAcciones={tieneAcciones} />
              ))}
            </TableBody>
          </Table>
        </DataTable>
      )}
    </div>
  );
}

// =============================================================================
// Fila de pedido en la tabla
// =============================================================================

function FilaPedido({ pedido, tieneAcciones }: { pedido: Pedido; tieneAcciones: boolean }) {
  return (
    <TableRow className="group">
      <TableCell className="px-4">
        <Badge variant={BADGE_ESTADO_PEDIDO[pedido.estado]}>
          {traducirEstadoPedido(pedido.estado)}
        </Badge>
      </TableCell>
      <TableCell className="px-4">
        <Link href={`/operaciones/${pedido.id}`} className="font-medium hover:underline">
          {pedido.destinatarioNombre}
        </Link>
        <p className="text-xs text-muted-foreground">{pedido.destinatarioComuna}</p>
      </TableCell>
      <TableCell className="hidden px-4 text-muted-foreground sm:table-cell">
        {pedido.sellerId}
      </TableCell>
      <TableCell className="hidden px-4 text-right font-mono text-muted-foreground tabular-nums md:table-cell">
        {pedido.fechaCompromiso ?? "Sin fecha"}
      </TableCell>
      <TableCell className="hidden px-4 text-muted-foreground lg:table-cell">
        {pedido.driverIdAsignado ? (
          pedido.driverIdAsignado
        ) : (
          <span className="text-warning-subtle-foreground">Sin asignar</span>
        )}
      </TableCell>
      <TableCell className="px-4">
        <Badge variant="neutral">{pedido.tipoPedido === "flex" ? "Flex" : "Same-day"}</Badge>
      </TableCell>
      {tieneAcciones && (
        <TableCell className="px-4 text-right">
          <Link
            href={`/operaciones/${pedido.id}`}
            className="text-xs font-medium text-primary hover:underline"
          >
            Ver detalle
          </Link>
        </TableCell>
      )}
    </TableRow>
  );
}
