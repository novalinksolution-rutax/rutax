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
import { puedeGestionarLiquidacionesConductores, puedeInvitarUsuarios } from "@/modules/identidad/capacidades";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import { traducirEstadoLiquidacion, BADGE_ESTADO_LIQUIDACION } from "@/lib/ui/traduccion-estados";
import type { EstadoLiquidacion, TipoHechoLinea } from "@/modules/dinero/tipos";
import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
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
import { accionAnularLineaLiquidacion } from "./actions-linea";
import { AccesoAppConductor, type EstadoAccesoAppConductor } from "./acceso-app-conductor";
import { Retorno, destinoRetorno } from "@/components/app-shell/retorno";

type Bucket = "acumulando" | "por_pagar" | "pagado";

interface EntregaConsolidada {
  lineaId: string;
  /** NULL en las lineas de retiro en bodega: no cuelgan de ningun pedido. */
  pedidoId: string | null;
  tipoHecho: TipoHechoLinea;
  /** Texto de la linea. En un retiro dice la bodega; ahi no hay destinatario. */
  concepto: string;
  fechaHecho: string | null;
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

// -----------------------------------------------------------------------------
// Acceso a la app — ¿tiene cuenta, invitación pendiente, o nada? El estado se
// resuelve SIEMPRE en el servidor: invitar dos veces al mismo conductor, o no
// saber si ya se invitó, es exactamente la fricción que la sección de abajo
// viene a quitar (encargo).
// -----------------------------------------------------------------------------

async function resolverEstadoAccesoApp(
  cliente: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
  driverId: string,
): Promise<EstadoAccesoAppConductor> {
  const { data: perfil } = await cliente
    .from("usuarios_perfil")
    .select("estado")
    .eq("driver_id", driverId)
    .eq("tenant_id", tenantId)
    .eq("tipo_usuario", "conductor")
    .maybeSingle();

  if (perfil) {
    const estadoPerfil = perfil.estado as string;
    return estadoPerfil === "activo" ? { tipo: "cuenta_activa" } : { tipo: "cuenta_suspendida" };
  }

  const { data: invitacionData } = await cliente
    .from("invitaciones")
    .select("email, estado, expira_en, email_estado, email_motivo")
    .eq("driver_id", driverId)
    .eq("tenant_id", tenantId)
    .eq("tipo_usuario", "conductor")
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!invitacionData) {
    return { tipo: "sin_acceso", ultimaInvitacionVencida: null };
  }

  const invitacion = invitacionData as {
    email: string;
    estado: string;
    expira_en: string;
    email_estado: string | null;
    email_motivo: string | null;
  };
  const expiraEnMs = new Date(invitacion.expira_en).getTime();
  const vigente = invitacion.estado === "pendiente" && expiraEnMs > Date.now();

  if (vigente) {
    return {
      tipo: "invitacion_pendiente",
      email: invitacion.email,
      expiraEn: invitacion.expira_en,
      emailEstado: invitacion.email_estado ?? null,
      emailMotivo: invitacion.email_motivo ?? null,
    };
  }

  // Sin cuenta ni invitación vigente: si la última invitación quedó vencida
  // (pendiente cuyo plazo pasó, o ya marcada `expirada`) se lo decimos al
  // courier en vez de aparentar que nunca se invitó — pero NO para una
  // `revocada`, que es una decisión explícita, no un vencimiento.
  const vencida =
    (invitacion.estado === "pendiente" || invitacion.estado === "expirada") && expiraEnMs <= Date.now();

  return { tipo: "sin_acceso", ultimaInvitacionVencida: vencida ? invitacion.expira_en : null };
}

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ volver?: string }>;
}

export default async function PaginaDetalleConductor({ params, searchParams }: Props) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");
  if (!puedeGestionarLiquidacionesConductores(sesion.usuario)) redirect("/conductores");

  const { id: driverId } = await params;
  const { volver } = await searchParams;
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

  // Líneas de liquidación del conductor (no anuladas) + estado de acceso a la
  // app, en paralelo — dos lecturas independientes sobre el mismo conductor.
  const [{ data: lineasData }, estadoAccesoApp] = await Promise.all([
    cliente
      .schema("dinero")
      .from("lineas_liquidacion")
      .select("id, pedido_id, tipo_hecho, concepto, liquidacion_id, monto_final_clp, monto_base_clp, fecha_hecho")
      .eq("tenant_id", tenantId)
      .eq("driver_id", driverId)
      .eq("anulada", false)
      .order("fecha_hecho", { ascending: false }),
    resolverEstadoAccesoApp(cliente, tenantId, driverId),
  ]);

  const lineas = lineasData ?? [];

  // Pedidos y liquidaciones referenciados — dos consultas acotadas (evita joins
  // cross-schema en PostgREST) que luego se combinan en memoria.
  // `.filter(Boolean)` NO es defensivo de mas: desde la etapa 8 una linea puede
  // no tener pedido, y un `null` colandose a `.in("id", …)` sobre una columna
  // uuid hace fallar la consulta ENTERA. El error no se revisa mas abajo
  // (`pedidosRes.data ?? []`), asi que la tabla completa del conductor se
  // quedaria sin nombres ni comunas — no solo la fila del retiro.
  const pedidoIds = Array.from(
    new Set(lineas.map((l) => l.pedido_id as string | null).filter((x): x is string => !!x)),
  );
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
    const ped = l.pedido_id ? pedidoPorId.get(l.pedido_id as string) : undefined;
    const monto = Number(l.monto_final_clp ?? l.monto_base_clp ?? 0);
    return {
      lineaId: l.id as string,
      pedidoId: (l.pedido_id as string | null) ?? null,
      tipoHecho: l.tipo_hecho as TipoHechoLinea,
      concepto: (l.concepto as string | null) ?? "",
      fechaHecho: (l.fecha_hecho as string | null) ?? null,
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
      <Retorno href={destinoRetorno("/conductores", volver)} etiqueta="Volver a conductores" />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">{conductor.nombre_completo as string}</h1>
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

      <AccesoAppConductor
        driverId={driverId}
        nombreConductor={conductor.nombre_completo as string}
        puedeInvitar={puedeInvitarUsuarios(sesion.usuario)}
        estadoInicial={estadoAccesoApp}
      />

      {/* Resumen por estado de pago */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="list" aria-label="Resumen de dinero por estado">
        {tarjetas.map(({ bucket, label, clases }) => (
          <div key={bucket} role="listitem" className={`rounded-lg px-4 py-3 ${clases}`}>
            <p className="text-xs font-medium">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatearCLP(resumen[bucket].totalClp)}</p>
            <p className="text-xs opacity-80 tabular-nums">
              {resumen[bucket].cantidad} entrega{resumen[bucket].cantidad !== 1 ? "s" : ""}
            </p>
          </div>
        ))}
      </div>

      {/* Detalle de entregas */}
      {entregas.length === 0 ? (
        <div className="rounded-lg border bg-card px-6 py-12 text-center">
          <p className="text-muted-foreground">
            Este conductor todavía no tiene entregas que generen liquidación. Aparecerán aquí a
            medida que el motor registre sus entregas.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
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
                      {formatearFechaCorta(e.fechaHecho)}
                    </TableCell>
                    <TableCell className="px-4">
                      {e.pedidoId ? (
                        <>
                          <Link href={`/operaciones/${e.pedidoId}`} className="font-medium hover:underline">
                            {e.destinatarioNombre}
                          </Link>
                          <p className="text-xs text-muted-foreground">{e.destinatarioComuna}</p>
                        </>
                      ) : (
                        // Un retiro no tiene destinatario: lo que identifica la
                        // fila es la bodega, y eso ya viene escrito en el
                        // concepto que dejó el generador.
                        <>
                          <span className="font-medium">{e.concepto || "Retiro en bodega"}</span>
                          <p className="text-xs text-muted-foreground">Pago por visita a bodega</p>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="px-4">
                      {e.liqEstado ? (
                        <BadgeEstado variante={BADGE_ESTADO_LIQUIDACION[e.liqEstado]} eje="liquidacion" valor={e.liqEstado} texto={traducirEstadoLiquidacion(e.liqEstado)} />
                      ) : (
                        <Badge variant="neutral">Acumulando</Badge>
                      )}
                    </TableCell>
                    <TableCell className="px-4 text-right tabular-nums font-medium">
                      {formatearCLP(e.montoClp)}
                    </TableCell>
                    <TableCell className="px-4 text-right">
                      {e.anulable &&
                        (e.pedidoId ? (
                          <DialogAnular
                            pedidoId={e.pedidoId}
                            titulo="Anular la liquidación de esta entrega"
                            descripcion="La línea de liquidación al conductor se anulará y no se pagará. Solo aplica a entregas sin liquidar o en una liquidación en borrador."
                            accion={accionAnularLiquidacionPedido}
                            etiquetaBoton="Anular"
                          />
                        ) : (
                          // El camino de anulación de siempre está cableado por
                          // `pedidoId` de punta a punta, y una línea de retiro no
                          // tiene. Va por id de línea, que es lo único que las dos
                          // clases comparten.
                          <DialogAnular
                            pedidoId={e.lineaId}
                            titulo="Anular el pago de esta visita a bodega"
                            descripcion="La línea de liquidación al conductor se anulará y no se pagará. La visita queda registrada igual: lo que se anula es el pago, no el hecho."
                            accion={accionAnularLineaLiquidacion}
                            etiquetaBoton="Anular"
                          />
                        ))}
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
