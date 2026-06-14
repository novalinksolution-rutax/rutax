/**
 * Lista de pedidos del seller — Pantalla portal/pedidos (Flujo 4, Fase B)
 *
 * Server Component. Solo lectura. RLS garantiza el aislamiento por seller.
 * Filtros de estado y fecha. Paginación.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Inbox, SearchX, Plus } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  traducirEstadoPedido,
  BADGE_ESTADO_PEDIDO,
} from "@/lib/ui/traduccion-estados";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { EstadoPedido, Pedido } from "@/modules/operacion/tipos";
import { FiltrosPedidosSeller } from "./filtros-pedidos-seller";

export const metadata: Metadata = {
  title: "Mis pedidos",
};

const LIMITE = 25;

interface SearchParams {
  estado?: string;
  fecha?: string;
  pagina?: string;
  nuevo?: string;
}

export default async function PaginaPedidosSeller({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) redirect("/portal");

  const params = await searchParams;
  const sellerId = sesion.usuario.sellerId;
  const tenantId = sesion.usuario.tenantId;
  const pedidoNuevoId = params.nuevo ?? null;

  const filtroEstado = (params.estado as EstadoPedido | "") ?? "";
  const filtroFecha = params.fecha ?? "";
  const pagina = Math.max(1, parseInt(params.pagina ?? "1", 10));
  const offset = (pagina - 1) * LIMITE;

  const cliente = crearClienteServiceRole();
  let pedidos: Pedido[] = [];
  let total = 0;
  let errorCarga = false;

  try {
    let query = cliente
      .from("pedidos")
      .select("*", { count: "exact" })
      .eq("seller_id", sellerId)
      .eq("tenant_id", tenantId)
      .order("fecha_compromiso", { ascending: false })
      .order("creado_en", { ascending: false })
      .range(offset, offset + LIMITE - 1);

    if (filtroEstado) query = query.eq("estado", filtroEstado);
    if (filtroFecha) query = query.eq("fecha_compromiso", filtroFecha);

    const { data, error, count } = await query;
    if (error) throw error;

    total = count ?? 0;
    pedidos = (data ?? []).map((p: Record<string, unknown>) => ({
      id: p.id as string,
      tenantId: p.tenant_id as string,
      sellerId: p.seller_id as string,
      tipoPedido: p.tipo_pedido as Pedido["tipoPedido"],
      origen: p.origen as Pedido["origen"],
      mlOrderId: (p.ml_order_id as string | null) ?? null,
      mlShipmentId: (p.ml_shipment_id as string | null) ?? null,
      estado: p.estado as EstadoPedido,
      estadoMl: (p.estado_ml as string | null) ?? null,
      subestadoMl: (p.subestado_ml as string | null) ?? null,
      ultimaSyncMlEn: (p.ultima_sync_ml_en as string | null) ?? null,
      driverIdAsignado: (p.driver_id_asignado as string | null) ?? null,
      destinatarioNombre: p.destinatario_nombre as string,
      destinatarioDireccion: p.destinatario_direccion as string,
      destinatarioComuna: p.destinatario_comuna as string,
      destinatarioTelefono: (p.destinatario_telefono as string | null) ?? null,
      instruccionesEntrega: (p.instrucciones_entrega as string | null) ?? null,
      fechaCompromiso: (p.fecha_compromiso as string | null) ?? null,
      tarifaAplicableId: (p.tarifa_aplicable_id as string | null) ?? null,
      notasInternas: (p.notas_internas as string | null) ?? null,
      creadoEn: p.creado_en as string,
      actualizadoEn: p.actualizado_en as string,
    }));
  } catch {
    errorCarga = true;
  }

  const hayFiltros = !!(filtroEstado || filtroFecha);
  const totalPaginas = Math.ceil(total / LIMITE);

  function urlConFiltros(overrides: Record<string, string>) {
    const sp = new URLSearchParams();
    if (filtroEstado) sp.set("estado", filtroEstado);
    if (filtroFecha) sp.set("fecha", filtroFecha);
    if (pagina > 1) sp.set("pagina", String(pagina));
    Object.entries(overrides).forEach(([k, v]) => {
      if (v) sp.set(k, v);
      else sp.delete(k);
    });
    const s = sp.toString();
    return `/portal/pedidos${s ? `?${s}` : ""}`;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Mis pedidos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Seguimiento de tus entregas. Los estados se actualizan automáticamente.
          </p>
        </div>
        <Button asChild className="whitespace-nowrap">
          <Link href="/portal/pedidos/nuevo">
            <Plus className="size-4" aria-hidden="true" />
            Solicitar envío same-day
          </Link>
        </Button>
      </div>

      {/* Confirmación de envío creado */}
      {pedidoNuevoId && (
        <div role="status" className="rounded-lg bg-success-subtle px-4 py-3 text-sm text-success-subtle-foreground">
          ¡Envío same-day solicitado con éxito! Quedará pendiente de asignación hasta que el courier lo asigne a un conductor.
        </div>
      )}

      {/* Filtros */}
      <FiltrosPedidosSeller
        filtroEstado={filtroEstado}
        filtroFecha={filtroFecha}
        hayFiltros={hayFiltros}
      />

      {/* Error */}
      {errorCarga && (
        <div role="alert" className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground">
          No se pudo cargar la lista de pedidos. Intenta recargar la página.
        </div>
      )}

      {/* Tabla / estados de vista */}
      {!errorCarga && pedidos.length === 0 ? (
        hayFiltros ? (
          <EmptyState
            icon={SearchX}
            tono="filtro"
            titulo="Ningún pedido coincide"
            descripcion="No hay pedidos con estos filtros. Prueba cambiando el estado o la fecha."
            accion={
              <Button asChild variant="outline" size="sm">
                <Link href="/portal/pedidos">Limpiar filtros</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Inbox}
            titulo="Todavía no tienes pedidos"
            descripcion="Aquí verás tus envíos cuando tu empresa de despacho los registre."
          />
        )
      ) : (
        !errorCarga && (
          <DataTable
            toolbar={
              <span className="text-sm text-muted-foreground tabular-nums">
                {total} pedido{total !== 1 ? "s" : ""}
                {hayFiltros ? " con filtros" : ""}
              </span>
            }
            footer={
              totalPaginas > 1 ? (
                <Pagination
                  pagina={pagina}
                  totalPaginas={totalPaginas}
                  hrefPagina={(p) => urlConFiltros({ pagina: String(p) })}
                />
              ) : undefined
            }
          >
            <Table densidad="relaxed" aria-label="Mis pedidos">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="px-4">Estado</TableHead>
                  <TableHead className="px-4">Destinatario</TableHead>
                  <TableHead className="hidden px-4 sm:table-cell">Dirección</TableHead>
                  <TableHead className="hidden px-4 md:table-cell">F. compromiso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pedidos.map((pedido) => (
                  <TableRow key={pedido.id}>
                    <TableCell className="px-4">
                      <Badge variant={BADGE_ESTADO_PEDIDO[pedido.estado]}>
                        {traducirEstadoPedido(pedido.estado)}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4">
                      <p className="font-medium">{pedido.destinatarioNombre}</p>
                      <p className="text-xs text-muted-foreground">{pedido.destinatarioComuna}</p>
                    </TableCell>
                    <TableCell className="hidden px-4 text-muted-foreground sm:table-cell">
                      {pedido.destinatarioDireccion}
                    </TableCell>
                    <TableCell className="hidden px-4 text-muted-foreground md:table-cell">
                      {pedido.fechaCompromiso ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
        )
      )}
    </div>
  );
}
