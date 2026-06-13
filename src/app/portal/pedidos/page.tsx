/**
 * Lista de pedidos del seller — Pantalla portal/pedidos (Flujo 4, Fase B)
 *
 * Server Component. Solo lectura. RLS garantiza el aislamiento por seller.
 * Filtros de estado y fecha. Paginación.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  traducirEstadoPedido,
  COLOR_ESTADO_PEDIDO,
  TEXTO_ESTADO_PEDIDO,
} from "@/lib/ui/traduccion-estados";
import { ESTADOS_PEDIDO } from "@/modules/operacion/tipos";
import type { EstadoPedido, Pedido } from "@/modules/operacion/tipos";

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
        <Link
          href="/portal/pedidos/nuevo"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap"
        >
          + Solicitar envío same-day
        </Link>
      </div>

      {/* Confirmación de envío creado */}
      {pedidoNuevoId && (
        <div role="status" className="rounded-lg bg-success-subtle px-4 py-3 text-sm text-success-subtle-foreground">
          ¡Envío same-day solicitado con éxito! Quedará pendiente de asignación hasta que el courier lo asigne a un conductor.
        </div>
      )}

      {/* Filtros */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="f-estado-p" className="text-xs font-medium text-muted-foreground">
            Estado
          </label>
          <select
            id="f-estado-p"
            name="estado"
            defaultValue={filtroEstado}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos los estados</option>
            {ESTADOS_PEDIDO.map((e) => (
              <option key={e} value={e}>
                {TEXTO_ESTADO_PEDIDO[e]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-fecha-p" className="text-xs font-medium text-muted-foreground">
            Fecha de compromiso
          </label>
          <input
            id="f-fecha-p"
            name="fecha"
            type="date"
            defaultValue={filtroFecha}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <button
          type="submit"
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Filtrar
        </button>
        {hayFiltros && (
          <Link
            href="/portal/pedidos"
            className="h-9 flex items-center px-3 text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            Limpiar filtros
          </Link>
        )}
      </form>

      {/* Error */}
      {errorCarga && (
        <div role="alert" className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground">
          No se pudo cargar la lista de pedidos. Intenta recargar la página.
        </div>
      )}

      {/* Contador */}
      {!errorCarga && (
        <p className="text-sm text-muted-foreground">
          {total === 0 ? "Sin pedidos" : `${total} pedido${total !== 1 ? "s" : ""}`}
          {hayFiltros ? " con los filtros aplicados" : ""}
        </p>
      )}

      {/* Tabla */}
      {!errorCarga && pedidos.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Mis pedidos">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2">Estado</th>
                  <th className="px-4 py-2">Destinatario</th>
                  <th className="hidden px-4 py-2 sm:table-cell">Dirección</th>
                  <th className="hidden px-4 py-2 md:table-cell">F. compromiso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pedidos.map((pedido) => (
                  <tr key={pedido.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${COLOR_ESTADO_PEDIDO[pedido.estado]}`}
                      >
                        {traducirEstadoPedido(pedido.estado)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{pedido.destinatarioNombre}</p>
                      <p className="text-xs text-muted-foreground">{pedido.destinatarioComuna}</p>
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                      {pedido.destinatarioDireccion}
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                      {pedido.fechaCompromiso ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Vacío */}
      {!errorCarga && pedidos.length === 0 && (
        <div className="rounded-xl border bg-card px-6 py-12 text-center">
          <p className="text-muted-foreground">
            {hayFiltros
              ? "No hay pedidos que coincidan. Prueba cambiando el estado o la fecha."
              : "Todavía no tienes pedidos registrados."}
          </p>
          {hayFiltros && (
            <Link href="/portal/pedidos" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
              Limpiar filtros
            </Link>
          )}
        </div>
      )}

      {/* Paginación */}
      {!errorCarga && totalPaginas > 1 && (
        <nav aria-label="Paginación" className="flex items-center justify-center gap-2">
          {pagina > 1 && (
            <Link
              href={urlConFiltros({ pagina: String(pagina - 1) })}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted transition-colors"
            >
              Anterior
            </Link>
          )}
          <span className="text-sm text-muted-foreground">
            Página {pagina} de {totalPaginas}
          </span>
          {pagina < totalPaginas && (
            <Link
              href={urlConFiltros({ pagina: String(pagina + 1) })}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted transition-colors"
            >
              Siguiente
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
