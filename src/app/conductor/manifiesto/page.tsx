/**
 * Manifiesto activo del día — Pantalla 3-A (Flujo 3, PWA conductor)
 *
 * Server Component (B-10): el primer renderizado útil es mínimo; datos cargados
 * en el servidor. Banner permanente de "usa la app de Flex" (B-3).
 * Solo lectura — ninguna acción de cambio de estado en este componente (B-2).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Info, Inbox, Clock } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  traducirEstadoPedido,
  traducirTipoIncidencia,
  BADGE_ESTADO_PEDIDO,
} from "@/lib/ui/traduccion-estados";
import type { EstadoManifiesto, EstadoPedido, Pedido, Incidencia, TipoIncidencia } from "@/modules/operacion/tipos";
import { ordenarParadasPorComunaYDireccion } from "@/modules/operacion/orden-paradas";
import { BotonListoParaSalir } from "./boton-listo-para-salir";

// =============================================================================
// Tipos auxiliares
// =============================================================================

interface PedidoEnManifiesto {
  orden: number;
  pedido: Pedido;
  incidenciaAbierta: Incidencia | null;
}

interface ManifiestoConPedidos {
  id: string;
  nombre: string;
  fechaOperacion: string;
  estado: EstadoManifiesto;
  pedidos: PedidoEnManifiesto[];
}

// =============================================================================
// Carga de datos
// =============================================================================

async function cargarManifiestoActivo(
  driverId: string,
  tenantId: string,
): Promise<ManifiestoConPedidos | null> {
  const cliente = crearClienteServiceRole();
  const hoy = new Date().toISOString().slice(0, 10);

  // Buscar manifiesto del conductor para hoy, preferir confirmado/en_ruta sobre borrador
  const { data: manifiestos } = await cliente
    .from("manifiestos")
    .select("id, nombre, fecha_operacion, estado")
    .eq("driver_id", driverId)
    .eq("tenant_id", tenantId)
    .eq("fecha_operacion", hoy)
    .in("estado", ["borrador", "confirmado", "en_ruta", "completado"])
    .order("creado_en", { ascending: false })
    .limit(1);

  if (!manifiestos || manifiestos.length === 0) return null;

  const m = manifiestos[0] as Record<string, unknown>;
  const manifiestoId = m.id as string;

  // Cargar pedidos asignados al manifiesto
  const { data: asignaciones } = await cliente
    .from("asignaciones_pedido")
    .select(
      "id, pedidos(id, tenant_id, seller_id, tipo_pedido, origen, ml_order_id, ml_shipment_id, estado, estado_ml, subestado_ml, ultima_sync_ml_en, driver_id_asignado, destinatario_nombre, destinatario_direccion, destinatario_comuna, destinatario_telefono, instrucciones_entrega, fecha_compromiso, tarifa_aplicable_id, notas_internas, creado_en, actualizado_en)",
    )
    .eq("manifiesto_id", manifiestoId)
    .eq("tenant_id", tenantId)
    .eq("activa", true);

  const pedidosBase: Pedido[] = ((asignaciones ?? []) as Record<string, unknown>[])
    .map((a) => {
      const p = a.pedidos as Record<string, unknown> | null;
      if (!p) return null;
      return {
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
      } satisfies Pedido;
    })
    .filter((p): p is Pedido => p !== null);

  // Incidencias abiertas de estos pedidos
  const incidenciasMap = new Map<string, Incidencia>();
  if (pedidosBase.length > 0) {
    const { data: incidencias } = await cliente
      .from("incidencias")
      .select("*")
      .in(
        "pedido_id",
        pedidosBase.map((p) => p.id),
      )
      .eq("tenant_id", tenantId)
      .in("estado", ["abierta", "en_gestion"]);

    (incidencias ?? []).forEach((inc: Record<string, unknown>) => {
      incidenciasMap.set(inc.pedido_id as string, {
        id: inc.id as string,
        tenantId: inc.tenant_id as string,
        pedidoId: inc.pedido_id as string,
        sellerId: inc.seller_id as string,
        tipo: inc.tipo as TipoIncidencia,
        estado: inc.estado as Incidencia["estado"],
        descripcion: (inc.descripcion as string | null) ?? null,
        notasResolucion: (inc.notas_resolucion as string | null) ?? null,
        afectaCobro: (inc.afecta_cobro as boolean) ?? false,
        afectaLiquidacion: (inc.afecta_liquidacion as boolean) ?? false,
        abiertaPorUsuarioId: (inc.abierta_por_usuario_id as string | null) ?? null,
        resueltaPorUsuarioId: (inc.resuelta_por_usuario_id as string | null) ?? null,
        abiertaEn: inc.abierta_en as string,
        resueltaEn: (inc.resuelta_en as string | null) ?? null,
        creadoEn: inc.creado_en as string,
        actualizadoEn: inc.actualizado_en as string,
      });
    });
  }

  const pedidosOrdenados = ordenarParadasPorComunaYDireccion(pedidosBase);

  const pedidosConOrden: PedidoEnManifiesto[] = pedidosOrdenados.map((pedido, idx) => ({
    orden: idx + 1,
    pedido,
    incidenciaAbierta: incidenciasMap.get(pedido.id) ?? null,
  }));

  return {
    id: manifiestoId,
    nombre: m.nombre as string,
    fechaOperacion: m.fecha_operacion as string,
    estado: m.estado as EstadoManifiesto,
    pedidos: pedidosConOrden,
  };
}

// =============================================================================
// Página
// =============================================================================

export default async function PaginaManifiestoActivo() {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId || !sesion.usuario.driverId) redirect("/login");

  const tenantId = sesion.usuario.tenantId;
  const driverId = sesion.usuario.driverId;

  let manifiesto: ManifiestoConPedidos | null = null;
  let errorCarga = false;

  try {
    manifiesto = await cargarManifiestoActivo(driverId, tenantId);
  } catch {
    errorCarga = true;
  }

  // ==========================================================================
  // Estado: error de red
  // ==========================================================================
  if (errorCarga) {
    return (
      <EmptyState
        icon={AlertTriangle}
        titulo="No se pudo cargar tu manifiesto"
        descripcion="Revisa tu conexión e inténtalo de nuevo."
        accion={
          <form action="/conductor/manifiesto">
            <Button type="submit" size="lg">
              Reintentar
            </Button>
          </form>
        }
      />
    );
  }

  // ==========================================================================
  // Estado: sin manifiesto asignado para hoy
  // ==========================================================================
  if (!manifiesto) {
    return (
      <EmptyState
        icon={Inbox}
        titulo="No tienes una ruta asignada para hoy"
        descripcion="Si crees que es un error, contacta a tu coordinador."
      />
    );
  }

  const esBorrador = manifiesto.estado === "borrador";
  const esConfirmado = manifiesto.estado === "confirmado";
  const esEnRuta = manifiesto.estado === "en_ruta";
  const esCompletado = manifiesto.estado === "completado";

  // ==========================================================================
  // Estado: manifiesto en borrador (no confirmado todavía)
  // ==========================================================================
  if (esBorrador) {
    return (
      <EmptyState
        icon={Clock}
        titulo="Tu ruta de hoy todavía no está lista"
        descripcion="Vuelve a revisar cuando tu coordinador la confirme."
      />
    );
  }

  return (
    <div className="space-y-4 pb-24">
      {/* Encabezado fijo (se incluye en el layout sticky del layout) */}
      <div className="space-y-1">
        <h1 className="text-xl font-bold">{manifiesto.nombre}</h1>
        <p className="text-sm text-muted-foreground">
          {manifiesto.fechaOperacion}{" — "}
          <span className="font-medium text-foreground">
            {manifiesto.pedidos.length} pedido{manifiesto.pedidos.length !== 1 ? "s" : ""} para hoy
          </span>
        </p>
      </div>

      {/* Banner permanente "usa la app de Flex" (B-3).
          NO tiene botón de cerrar. NO es colapsable. Es parte permanente de la UI. */}
      <div
        role="note"
        aria-label="Instrucción de uso de la app de Flex"
        className="rounded-xl bg-info px-4 py-3 text-sm text-info-foreground"
      >
        <div className="flex items-start gap-2">
          <Info className="size-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <p>
            Para registrar la entrega, usa la app de{" "}
            <strong>Mercado Envíos Flex</strong>. Esta app es solo de referencia.
          </p>
        </div>
      </div>

      {/* Estado: manifiesto completado */}
      {esCompletado && (
        <div className="rounded-xl bg-success-subtle px-4 py-3 text-sm text-success-subtle-foreground">
          Ruta completada.
        </div>
      )}

      {/* Lista de cards de pedidos */}
      {manifiesto.pedidos.length > 0 ? (
        <ol className="space-y-3" aria-label="Lista de pedidos del manifiesto">
          {manifiesto.pedidos.map(({ orden, pedido, incidenciaAbierta }) => (
            <li key={pedido.id}>
              <Link
                href={`/conductor/manifiesto/${pedido.id}`}
                className={`block rounded-xl border bg-card p-4 transition-colors hover:bg-muted/30 active:scale-[0.99] ${incidenciaAbierta ? "border-warning" : "border-border"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  {/* Numero de orden — grande, esquina superior izquierda */}
                  <span
                    className="text-2xl font-black leading-none text-muted-foreground/60 tabular-nums flex-shrink-0"
                    aria-label={`Orden ${orden}`}
                  >
                    {orden}
                  </span>

                  {/* Estado — badge esquina superior derecha */}
                  <Badge variant={BADGE_ESTADO_PEDIDO[pedido.estado]} className="shrink-0">
                    {traducirEstadoPedido(pedido.estado)}
                  </Badge>
                </div>

                <div className="mt-2 space-y-1">
                  {/* Nombre del destinatario — grande */}
                  <p className="text-base font-semibold">{pedido.destinatarioNombre}</p>

                  {/* Dirección y comuna */}
                  <p className="text-sm text-muted-foreground">
                    {pedido.destinatarioDireccion}
                    {pedido.destinatarioComuna ? `, ${pedido.destinatarioComuna}` : ""}
                  </p>

                  {/* Instrucciones de entrega (si existen) */}
                  {pedido.instruccionesEntrega && (
                    <p className="text-xs text-muted-foreground italic">
                      {pedido.instruccionesEntrega}
                    </p>
                  )}

                  {/* Incidencia abierta — solo informativo */}
                  {incidenciaAbierta && (
                    <div className="mt-2 flex items-center gap-1.5 rounded-md bg-warning-subtle px-2.5 py-1.5">
                      <AlertTriangle className="size-3.5 shrink-0 text-warning-subtle-foreground" aria-hidden="true" />
                      <p className="text-xs font-medium text-warning-subtle-foreground">
                        Incidencia: {traducirTipoIncidencia(incidenciaAbierta.tipo)}
                      </p>
                    </div>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <div className="rounded-xl border bg-card px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">No hay pedidos en este manifiesto.</p>
        </div>
      )}

      {/* Botón "Listo para salir" — solo si estado = confirmado (B-2) */}
      {(esConfirmado || esEnRuta) && (
        <BotonListoParaSalir
          manifiestoId={manifiesto.id}
          totalPedidos={manifiesto.pedidos.length}
          estaEnRuta={esEnRuta}
        />
      )}
    </div>
  );
}
