/**
 * Detalle de conductor — vista consolidada de dinero (entrega→liquidación).
 *
 * Reemplaza la trazabilidad de dinero por pedido: en lugar de mostrar por cada
 * pedido si generó cobro/liquidación y su estado de pago, el dinero se ACUMULA y
 * se consolida aquí, por conductor. Se ven todas las entregas que generaron línea
 * de liquidación, agrupadas por estado de pago:
 *   - Acumulando: entregada, aún sin entrar en una liquidación.
 *   - Por pagar:  ya está en una liquidación en borrador o emitida (no pagada).
 *   - Pagado:     la liquidación de esa entrega ya fue pagada.
 *
 * Solo roles con capacidad de liquidaciones (`puedeGestionarLiquidacionesConductores`).
 * Aislamiento por tenant en cada consulta (service_role).
 */

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Wallet } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeGestionarLiquidacionesConductores } from "@/modules/identidad/capacidades";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { traducirEstadoLiquidacion, BADGE_ESTADO_LIQUIDACION } from "@/lib/ui/traduccion-estados";
import type { EstadoLiquidacion } from "@/modules/dinero/tipos";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DialogAnular } from "@/app/(tenant)/operaciones/[pedidoId]/acciones-corregir-dinero";
import { accionAnularLiquidacionPedido } from "@/app/(tenant)/operaciones/[pedidoId]/acciones-dinero";

type Bucket = "acumulando" | "por_pagar" | "pagado";

interface EntregaConsolidada {
  lineaId: string;
  pedidoId: string;
  fechaEntrega: string | null;
  montoClp: number;
  destinatarioNombre: string;
  destinatarioComuna: string;
  bucket: Bucket;
  /** Estado de la liquidación padre, o null si aún no está en una. */
  liqEstado: EstadoLiquidacion | null;
  /** true si la línea puede anularse: sin liquidar o en borrador (dominio bloquea el resto). */
  anulable: boolean;
}

function formatearFechaCorta(iso: string | null): string {
  if (!iso || iso.length < 10) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

function clasificar(liqEstado: EstadoLiquidacion | null): Bucket {
  if (!liqEstado) return "acumulando";
  if (liqEstado === "pagada") return "pagado";
  return "por_pagar"; // borrador | emitida
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function PaginaDetalleConductor({ params }: Props) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");
  if (!puedeGestionarLiquidacionesConductores(sesion.usuario)) redirect("/conductores");

  const { id: driverId } = await params;
  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();

  // Conductor (aislado por tenant).
  const { data: conductor } = await cliente
    .from("conductores")
    .select("id, nombre_completo, estado")
    .eq("id", driverId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!conductor) notFound();

  // Líneas de liquidación del conductor (no anuladas).
  const { data: lineasData } = await cliente
    .schema("dinero")
    .from("lineas_liquidacion")
    .select("id, pedido_id, liquidacion_id, monto_final_clp, monto_base_clp, fecha_entrega")
    .eq("tenant_id", tenantId)
    .eq("driver_id", driverId)
    .eq("anulada", false)
    .order("fecha_entrega", { ascending: false });

  const lineas = lineasData ?? [];

  // Pedidos y liquidaciones referenciados — dos consultas acotadas (evita joins
  // cross-schema en PostgREST) que luego se combinan en memoria.
  const pedidoIds = Array.from(new Set(lineas.map((l) => l.pedido_id as string)));
  const liqIds = Array.from(
    new Set(lineas.map((l) => l.liquidacion_id as string | null).filter((x): x is string => !!x)),
  );

  const [pedidosRes, liqRes] = await Promise.all([
    pedidoIds.length
      ? cliente.from("pedidos").select("id, destinatario_nombre, destinatario_comuna").in("id", pedidoIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    liqIds.length
      ? cliente.schema("dinero").from("liquidaciones").select("id, estado").in("id", liqIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const pedidoPorId = new Map(
    (pedidosRes.data ?? []).map((p: Record<string, unknown>) => [p.id as string, p]),
  );
  const liqEstadoPorId = new Map(
    (liqRes.data ?? []).map((l: Record<string, unknown>) => [l.id as string, l.estado as EstadoLiquidacion]),
  );

  const entregas: EntregaConsolidada[] = lineas.map((l) => {
    const liqEstado = l.liquidacion_id ? liqEstadoPorId.get(l.liquidacion_id as string) ?? null : null;
    const ped = pedidoPorId.get(l.pedido_id as string);
    const monto = Number(l.monto_final_clp ?? l.monto_base_clp ?? 0);
    return {
      lineaId: l.id as string,
      pedidoId: l.pedido_id as string,
      fechaEntrega: (l.fecha_entrega as string | null) ?? null,
      montoClp: monto,
      destinatarioNombre: (ped?.destinatario_nombre as string) ?? "—",
      destinatarioComuna: (ped?.destinatario_comuna as string) ?? "—",
      liqEstado,
      bucket: clasificar(liqEstado),
      // Anulable = sin liquidar (acumulando) o en borrador. El dominio
      // (anularLineaLiquidacionPedido) rechaza emitida/pagada, pero además lo
      // ocultamos aquí para no ofrecer una acción que fallaría.
      anulable: liqEstado === null || liqEstado === "borrador",
    };
  });

  const resumen: Record<Bucket, { cantidad: number; totalClp: number }> = {
    acumulando: { cantidad: 0, totalClp: 0 },
    por_pagar: { cantidad: 0, totalClp: 0 },
    pagado: { cantidad: 0, totalClp: 0 },
  };
  for (const e of entregas) {
    resumen[e.bucket].cantidad++;
    resumen[e.bucket].totalClp += e.montoClp;
  }

  const tarjetas: { bucket: Bucket; label: string; clases: string }[] = [
    { bucket: "acumulando", label: "Acumulando (sin liquidar)", clases: "bg-muted text-muted-foreground" },
    { bucket: "por_pagar", label: "Por pagar", clases: "bg-info-subtle text-info-subtle-foreground" },
    { bucket: "pagado", label: "Pagado", clases: "bg-success-subtle text-success-subtle-foreground" },
  ];

  return (
    <div className="space-y-6">
      <Link
        href="/conductores"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Volver a conductores
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold">{conductor.nombre_completo as string}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dinero consolidado de sus entregas. El detalle por pedido ya no vive en cada pedido:
            se acumula aquí y se cierra en las liquidaciones.
          </p>
        </div>
        <Link
          href={`/dinero/liquidaciones?conductor=${conductor.id as string}`}
          className="inline-flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          <Wallet className="size-4" aria-hidden="true" />
          Ver liquidaciones
        </Link>
      </div>

      {/* Resumen por estado de pago */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="list" aria-label="Resumen de dinero por estado">
        {tarjetas.map(({ bucket, label, clases }) => (
          <div key={bucket} role="listitem" className={`rounded-xl px-4 py-3 ${clases}`}>
            <p className="text-xs font-medium">{label}</p>
            <p className="mt-1 text-xl font-bold tabular-nums">{formatearCLP(resumen[bucket].totalClp)}</p>
            <p className="text-xs opacity-80 tabular-nums">
              {resumen[bucket].cantidad} entrega{resumen[bucket].cantidad !== 1 ? "s" : ""}
            </p>
          </div>
        ))}
      </div>

      {/* Detalle de entregas */}
      {entregas.length === 0 ? (
        <div className="rounded-xl border bg-card px-6 py-12 text-center">
          <p className="text-muted-foreground">
            Este conductor todavía no tiene entregas que generen liquidación. Aparecerán aquí a
            medida que el motor registre sus entregas.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <Table aria-label={`Entregas liquidables de ${conductor.nombre_completo as string}`}>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="px-4">Fecha</TableHead>
                  <TableHead className="px-4">Destinatario</TableHead>
                  <TableHead className="px-4">Estado de pago</TableHead>
                  <TableHead className="px-4 text-right">Monto</TableHead>
                  <TableHead className="px-4 text-right">
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entregas.map((e) => (
                  <TableRow key={e.lineaId} className="group">
                    <TableCell className="px-4 tabular-nums text-muted-foreground">
                      {formatearFechaCorta(e.fechaEntrega)}
                    </TableCell>
                    <TableCell className="px-4">
                      <Link href={`/operaciones/${e.pedidoId}`} className="font-medium hover:underline">
                        {e.destinatarioNombre}
                      </Link>
                      <p className="text-xs text-muted-foreground">{e.destinatarioComuna}</p>
                    </TableCell>
                    <TableCell className="px-4">
                      {e.liqEstado ? (
                        <Badge variant={BADGE_ESTADO_LIQUIDACION[e.liqEstado]}>
                          {traducirEstadoLiquidacion(e.liqEstado)}
                        </Badge>
                      ) : (
                        <Badge variant="neutral">Acumulando</Badge>
                      )}
                    </TableCell>
                    <TableCell className="px-4 text-right tabular-nums font-medium">
                      {formatearCLP(e.montoClp)}
                    </TableCell>
                    <TableCell className="px-4 text-right">
                      {e.anulable && (
                        <DialogAnular
                          pedidoId={e.pedidoId}
                          titulo="Anular la liquidación de esta entrega"
                          descripcion="La línea de liquidación al conductor se anulará y no se pagará. Solo aplica a entregas sin liquidar o en una liquidación en borrador."
                          accion={accionAnularLiquidacionPedido}
                          etiquetaBoton="Anular"
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
