/**
 * Vista del manifiesto — Pantalla 2-B (Flujo 2)
 *
 * Server Component. Encabezado con estado en badge, lista de pedidos asignados
 * (editable si estado = borrador, solo lectura si no), botones de acción según
 * estado y dialog de confirmación antes de confirmar.
 */

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Plus, Package } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeAsignarYReasignarPedidos, puedeGenerarManifiestos } from "@/modules/identidad/capacidades";
import {
  traducirEstadoManifiesto,
  traducirEstadoPedido,
  BADGE_ESTADO_MANIFIESTO,
  BADGE_ESTADO_PEDIDO,
} from "@/lib/ui/traduccion-estados";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable } from "@/components/ui/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Manifiesto, EstadoManifiesto, Pedido, EstadoPedido } from "@/modules/operacion/tipos";
import { ordenarParadasPorComunaYDireccion } from "@/modules/operacion/orden-paradas";
import { BotonConfirmarManifiesto } from "./boton-confirmar-manifiesto";
import { BotonCancelarManifiesto } from "./boton-cancelar-manifiesto";
import { BotonQuitarPedido } from "./boton-quitar-pedido";

// =============================================================================
// Tipos auxiliares
// =============================================================================

interface PedidoAsignado {
  asignacionId: string;
  pedido: Pedido;
}

// =============================================================================
// Carga de datos
// =============================================================================

async function cargarManifiesto(
  manifiestoId: string,
  tenantId: string,
): Promise<Manifiesto | null> {
  const cliente = crearClienteServiceRole();
  const { data, error } = await cliente
    .from("manifiestos")
    .select("*")
    .eq("id", manifiestoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id as string,
    tenantId: data.tenant_id as string,
    driverId: data.driver_id as string,
    nombre: data.nombre as string,
    fechaOperacion: data.fecha_operacion as string,
    estado: data.estado as EstadoManifiesto,
    notas: (data.notas as string | null) ?? null,
    creadoPorUsuarioId: (data.creado_por_usuario_id as string | null) ?? null,
    confirmadoEn: (data.confirmado_en as string | null) ?? null,
    completadoEn: (data.completado_en as string | null) ?? null,
    creadoEn: data.creado_en as string,
    actualizadoEn: data.actualizado_en as string,
  };
}

async function cargarPedidosAsignados(
  manifiestoId: string,
  tenantId: string,
): Promise<PedidoAsignado[]> {
  const cliente = crearClienteServiceRole();
  const { data, error } = await cliente
    .from("asignaciones_pedido")
    .select(
      "id, pedido_id, pedidos(id, tenant_id, seller_id, tipo_pedido, origen, ml_order_id, ml_shipment_id, estado, estado_ml, subestado_ml, ultima_sync_ml_en, driver_id_asignado, destinatario_nombre, destinatario_direccion, destinatario_comuna, destinatario_telefono, instrucciones_entrega, fecha_compromiso, tarifa_aplicable_id, notas_internas, creado_en, actualizado_en)",
    )
    .eq("manifiesto_id", manifiestoId)
    .eq("tenant_id", tenantId)
    .eq("activa", true);

  if (error || !data) return [];

  return data
    .map((row: Record<string, unknown>) => {
      const p = row.pedidos as Record<string, unknown> | null;
      if (!p) return null;
      return {
        asignacionId: row.id as string,
        pedido: {
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
        } satisfies Pedido,
      };
    })
    .filter((x): x is PedidoAsignado => x !== null);
}

async function cargarNombreConductor(driverId: string): Promise<string> {
  const cliente = crearClienteServiceRole();
  const { data } = await cliente
    .from("perfiles_usuario")
    .select("nombre_completo")
    .eq("usuario_id", driverId)
    .maybeSingle();
  return (data?.nombre_completo as string | null) ?? driverId;
}

// =============================================================================
// Página
// =============================================================================

interface Props {
  params: Promise<{ manifiestoId: string }>;
}

export default async function PaginaDetalleManifiesto({ params }: Props) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");

  const { manifiestoId } = await params;
  const tenantId = sesion.usuario.tenantId;

  const [manifiesto, pedidosAsignadosSinOrden] = await Promise.all([
    cargarManifiesto(manifiestoId, tenantId),
    cargarPedidosAsignados(manifiestoId, tenantId),
  ]);

  if (!manifiesto) notFound();

  // D-04 / RF-025: orden básico (sin IA, sin optimizador) por comuna y luego
  // dirección — el mismo orden que verá el conductor en la PWA.
  const pedidosAsignados = ordenarParadasPorComunaYDireccion(
    pedidosAsignadosSinOrden.map((pa) => pa.pedido),
  ).map((pedido) => pedidosAsignadosSinOrden.find((pa) => pa.pedido.id === pedido.id)!);

  const nombreConductor = await cargarNombreConductor(manifiesto.driverId);

  const puedeAsignar = puedeAsignarYReasignarPedidos(sesion.usuario);
  const puedeCrearManifiesto = puedeGenerarManifiestos(sesion.usuario);
  const esBorrador = manifiesto.estado === "borrador";
  const esConfirmado = manifiesto.estado === "confirmado";
  const hayPedidos = pedidosAsignados.length > 0;

  return (
    <div className="space-y-6">
      {/* Volver */}
      <Link
        href="/manifiestos"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Volver a manifiestos
      </Link>

      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{manifiesto.nombre}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Conductor: <span className="font-medium text-foreground">{nombreConductor}</span>
            {" — "}
            Fecha: <span className="font-medium text-foreground">{manifiesto.fechaOperacion}</span>
          </p>
          {manifiesto.notas && (
            <p className="mt-1 text-sm text-muted-foreground italic">{manifiesto.notas}</p>
          )}
        </div>
        <Badge
          variant={BADGE_ESTADO_MANIFIESTO[manifiesto.estado]}
          className="px-3 py-1 text-sm"
          aria-label={`Estado: ${traducirEstadoManifiesto(manifiesto.estado)}`}
        >
          {traducirEstadoManifiesto(manifiesto.estado)}
        </Badge>
      </div>

      {/* Lista de pedidos */}
      <section aria-labelledby="pedidos-titulo">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 id="pedidos-titulo" className="text-base font-semibold">
            Pedidos asignados{" "}
            <span className="text-muted-foreground font-normal">({pedidosAsignados.length})</span>
          </h2>
          {esBorrador && puedeAsignar && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/manifiestos/${manifiestoId}/asignar`}>
                <Plus className="size-4" aria-hidden="true" />
                Agregar pedidos
              </Link>
            </Button>
          )}
        </div>

        {hayPedidos ? (
          <DataTable
            toolbar={
              <span className="text-sm text-muted-foreground tabular-nums">
                {pedidosAsignados.length} pedido{pedidosAsignados.length !== 1 ? "s" : ""}
              </span>
            }
          >
            <Table densidad="comfortable" aria-label="Pedidos asignados al manifiesto">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="px-4 text-center" title="Orden de la ruta (por comuna y dirección)">
                    #
                  </TableHead>
                  <TableHead className="px-4">Estado</TableHead>
                  <TableHead className="px-4">Destinatario</TableHead>
                  <TableHead className="hidden px-4 sm:table-cell">Dirección</TableHead>
                  <TableHead className="hidden px-4 md:table-cell">F. compromiso</TableHead>
                  {esBorrador && puedeAsignar && (
                    <TableHead className="px-4 text-right">
                      <span className="sr-only">Acciones</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pedidosAsignados.map(({ asignacionId, pedido }, idx) => (
                  <TableRow key={pedido.id}>
                    <TableCell className="px-4 text-center font-semibold tabular-nums text-muted-foreground">
                      {idx + 1}
                    </TableCell>
                    <TableCell className="px-4">
                      <Badge variant={BADGE_ESTADO_PEDIDO[pedido.estado]}>
                        {traducirEstadoPedido(pedido.estado)}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4">
                      <Link
                        href={`/operaciones/${pedido.id}`}
                        className="font-medium hover:underline"
                      >
                        {pedido.destinatarioNombre}
                      </Link>
                      <span className="ml-1 text-xs text-muted-foreground">
                        — {pedido.destinatarioComuna}
                      </span>
                    </TableCell>
                    <TableCell className="hidden px-4 text-muted-foreground sm:table-cell">
                      {pedido.destinatarioDireccion}
                    </TableCell>
                    <TableCell className="hidden px-4 text-muted-foreground md:table-cell">
                      {pedido.fechaCompromiso ?? "—"}
                    </TableCell>
                    {esBorrador && puedeAsignar && (
                      <TableCell className="px-4 text-right">
                        <BotonQuitarPedido
                          asignacionId={asignacionId}
                          manifiestoId={manifiestoId}
                          nombreDestinatario={pedido.destinatarioNombre}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
        ) : (
          <EmptyState
            icon={Package}
            titulo="Este manifiesto no tiene pedidos todavía"
            descripcion="Agrega pedidos pendientes para armar la ruta del conductor."
            accion={
              esBorrador && puedeAsignar ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/manifiestos/${manifiestoId}/asignar`}>Agregar pedidos</Link>
                </Button>
              ) : undefined
            }
          />
        )}
      </section>

      {/* Acciones según estado */}
      {(esBorrador && (puedeAsignar || puedeCrearManifiesto)) && (
        <section aria-labelledby="acciones-titulo" className="flex flex-wrap gap-3">
          <h2 id="acciones-titulo" className="sr-only">Acciones del manifiesto</h2>

          {puedeAsignar && (
            <Link
              href={`/manifiestos/${manifiestoId}/asignar`}
              className="inline-flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              <Plus className="size-4" aria-hidden="true" />
              Agregar pedidos
            </Link>
          )}

          {puedeAsignar && (
            <BotonConfirmarManifiesto
              manifiestoId={manifiestoId}
              nombreConductor={nombreConductor}
              totalPedidos={pedidosAsignados.length}
              habilitado={hayPedidos}
            />
          )}

          {puedeCrearManifiesto && (
            <BotonCancelarManifiesto
              manifiestoId={manifiestoId}
            />
          )}
        </section>
      )}

      {esConfirmado && (
        <div className="rounded-xl border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Manifiesto confirmado.{" "}
          <Link
            href={`/conductor/manifiesto`}
            className="font-medium text-foreground hover:underline"
          >
            Ver como lo ve el conductor
          </Link>
        </div>
      )}
    </div>
  );
}
