/**
 * Pantalla D-4 — Conciliación.
 *
 * Server Component. Criterio C-6: descripción viene del backend, truncar a 120 chars con Tooltip.
 * Si pendienteCount === 0: estado de "todo cuadra" como mensaje de tranquilidad
 * (UX-10 / §M7), no como ausencia. Filtro default: pendiente.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, SearchX } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeVerConciliacion } from "@/modules/identidad/capacidades";
import { listarEventosConciliacion } from "@/modules/dinero/index";
import type {
  EventoConciliacion,
  EstadoEventoConciliacion,
  TipoDiferenciaConciliacion,
} from "@/modules/dinero/tipos";
import {
  traducirEstadoConciliacion,
  COLOR_ESTADO_CONCILIACION,
  TEXTO_ESTADO_CONCILIACION,
  traducirTipoDiferencia,
  TEXTO_TIPO_DIFERENCIA,
} from "@/lib/ui/traduccion-estados";
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
import { MenuAccionesConciliacion } from "./menu-acciones-conciliacion";

export const metadata: Metadata = {
  title: "Conciliación",
};

const ESTADOS_CONCIL: EstadoEventoConciliacion[] = [
  "pendiente",
  "revisado",
  "resuelto",
  "ignorado",
];

const TIPOS_DIFERENCIA: TipoDiferenciaConciliacion[] = [
  "pedido_entregado_sin_linea_cobro",
  "pedido_entregado_sin_linea_liquidacion",
  "linea_cobro_sin_pedido_entregado",
  "folio_consumido_sin_dte_persistido",
  "periodo_cerrado_con_lineas_sueltas",
  "monto_dte_difiere_de_lineas",
];

const COLOR_CHIP: Record<EstadoEventoConciliacion, string> = {
  pendiente: "bg-warning-subtle text-warning-subtle-foreground",
  revisado: "bg-info-subtle text-info-subtle-foreground",
  resuelto: "bg-success-subtle text-success-subtle-foreground",
  ignorado: "bg-muted text-muted-foreground",
};

interface SearchParams {
  estado?: string;
  tipo?: string;
  seller?: string;
}

interface EventoConNombre extends EventoConciliacion {
  sellerNombre: string | null;
}

export default async function PaginaConciliacion({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");
  if (!puedeVerConciliacion(sesion.usuario)) redirect("/dashboard");

  const params = await searchParams;
  const tenantId = sesion.usuario.tenantId;

  const filtroEstado = (params.estado as EstadoEventoConciliacion | "") ?? "pendiente";
  const filtroTipo = (params.tipo as TipoDiferenciaConciliacion | "") ?? "";
  const filtroSeller = params.seller ?? "";

  const cliente = crearClienteServiceRole();
  let eventos: EventoConNombre[] = [];
  let contPendientes = 0;
  let contRevisados = 0;
  let contResueltos = 0;
  let contIgnorados = 0;
  let sellersDisponibles: { id: string; nombre: string }[] = [];
  let errorCarga = false;

  try {
    const { data: sellersData } = await cliente
      .from("sellers")
      .select("id, razon_social")
      .eq("tenant_id", tenantId)
      .order("razon_social");
    sellersDisponibles = (sellersData ?? []).map((s: Record<string, unknown>) => ({
      id: s.id as string,
      nombre: s.razon_social as string,
    }));
    const sellersMap = new Map(sellersDisponibles.map((s) => [s.id, s.nombre]));

    const todosEventos = await listarEventosConciliacion(cliente, tenantId);
    for (const e of todosEventos) {
      if (e.estado === "pendiente") contPendientes++;
      else if (e.estado === "revisado") contRevisados++;
      else if (e.estado === "resuelto") contResueltos++;
      else if (e.estado === "ignorado") contIgnorados++;
    }

    let filtrados = filtroEstado
      ? todosEventos.filter((e) => e.estado === filtroEstado)
      : todosEventos;

    if (filtroTipo) {
      filtrados = filtrados.filter((e) => e.tipoDiferencia === filtroTipo);
    }
    if (filtroSeller) {
      filtrados = filtrados.filter((e) => e.sellerId === filtroSeller);
    }

    const ORDEN: Record<EstadoEventoConciliacion, number> = {
      pendiente: 0,
      revisado: 1,
      resuelto: 2,
      ignorado: 3,
    };
    filtrados.sort((a, b) => {
      const diff = ORDEN[a.estado] - ORDEN[b.estado];
      if (diff !== 0) return diff;
      return b.creadoEn.localeCompare(a.creadoEn);
    });

    eventos = filtrados.map((e) => ({
      ...e,
      sellerNombre: e.sellerId ? (sellersMap.get(e.sellerId) ?? null) : null,
    }));
  } catch {
    errorCarga = true;
  }

  const hayFiltroActivo = !!(filtroTipo || filtroSeller || filtroEstado !== "pendiente");

  function urlConFiltros(overrides: Record<string, string>) {
    const sp = new URLSearchParams();
    if (filtroEstado) sp.set("estado", filtroEstado);
    if (filtroTipo) sp.set("tipo", filtroTipo);
    if (filtroSeller) sp.set("seller", filtroSeller);
    Object.entries(overrides).forEach(([k, v]) => {
      if (v) sp.set(k, v);
      else sp.delete(k);
    });
    const s = sp.toString();
    return `/dinero/conciliacion${s ? `?${s}` : ""}`;
  }

  // Estado de tranquilidad: 0 pendientes = "todo cuadra" (confianza, no ausencia).
  if (!errorCarga && contPendientes === 0) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-bold">Conciliación</h1>
        <EmptyState
          icon={CheckCircle2}
          tono="buen-estado"
          titulo="Sin diferencias — todo cuadra"
          descripcion="Los últimos períodos cerrados no presentaron descuadres entre lo entregado y lo facturado. No necesitas hacer nada."
        />
      </div>
    );
  }

  const chips = [
    { key: "pendiente" as const, label: "Pendientes", count: contPendientes },
    { key: "revisado" as const, label: "Revisados", count: contRevisados },
    { key: "resuelto" as const, label: "Resueltos", count: contResueltos },
    { key: "ignorado" as const, label: "Ignorados", count: contIgnorados },
  ];

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-bold">Conciliación</h1>

      {/* Chips de resumen */}
      {!errorCarga && (
        <div
          className="flex flex-wrap gap-2"
          role="list"
          aria-label="Resumen de eventos de conciliación"
        >
          {chips.map((chip) => {
            const estaActivo = filtroEstado === chip.key;
            return (
              <Link
                key={chip.key}
                href={estaActivo ? "/dinero/conciliacion" : urlConFiltros({ estado: chip.key })}
                role="listitem"
                aria-current={estaActivo ? "true" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-all ${COLOR_CHIP[chip.key]} ${
                  estaActivo ? "ring-2 ring-current ring-offset-1" : "hover:opacity-80"
                }`}
              >
                {chip.label}: <span className="font-bold tabular-nums">{chip.count}</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Filtros */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="f-estado-c" className="text-xs font-medium text-muted-foreground">
            Estado
          </label>
          <select
            id="f-estado-c"
            name="estado"
            defaultValue={filtroEstado}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <option value="">Todos</option>
            {ESTADOS_CONCIL.map((e) => (
              <option key={e} value={e}>
                {TEXTO_ESTADO_CONCILIACION[e]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="f-tipo-c" className="text-xs font-medium text-muted-foreground">
            Tipo de diferencia
          </label>
          <select
            id="f-tipo-c"
            name="tipo"
            defaultValue={filtroTipo}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <option value="">Todos los tipos</option>
            {TIPOS_DIFERENCIA.map((t) => (
              <option key={t} value={t}>
                {TEXTO_TIPO_DIFERENCIA[t]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="f-seller-c" className="text-xs font-medium text-muted-foreground">
            Seller
          </label>
          <select
            id="f-seller-c"
            name="seller"
            defaultValue={filtroSeller}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <option value="">Todos</option>
            {sellersDisponibles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" size="sm">
          Filtrar
        </Button>

        {hayFiltroActivo && (
          <Button asChild variant="ghost" size="sm">
            <Link href="/dinero/conciliacion">Limpiar filtros</Link>
          </Button>
        )}
      </form>

      {/* Error */}
      {errorCarga && (
        <div
          role="alert"
          className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground"
        >
          No se pudo cargar la lista de eventos. Intenta recargar la página.
        </div>
      )}

      {/* Tabla / vacío de filtro */}
      {!errorCarga && eventos.length === 0 ? (
        <EmptyState
          icon={SearchX}
          tono="filtro"
          titulo="Ningún evento coincide"
          descripcion="No hay eventos de conciliación con los filtros aplicados."
          accion={
            hayFiltroActivo ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/dinero/conciliacion">Limpiar filtros</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        !errorCarga && (
          <DataTable>
            <Table densidad="compact" aria-label="Eventos de conciliación">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="px-4" style={{ width: "28%" }}>
                    Tipo diferencia
                  </TableHead>
                  <TableHead className="hidden px-4 sm:table-cell" style={{ width: "14%" }}>
                    Seller
                  </TableHead>
                  <TableHead className="hidden px-4 md:table-cell" style={{ width: "12%" }}>
                    Pedido
                  </TableHead>
                  <TableHead className="px-4" style={{ width: "28%" }}>
                    Descripción
                  </TableHead>
                  <TableHead className="hidden px-4 lg:table-cell" style={{ width: "8%" }}>
                    Estado
                  </TableHead>
                  <TableHead className="px-4 text-right" style={{ width: "10%" }}>
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eventos.map((evento) => (
                  <FilaEvento key={evento.id} evento={evento} />
                ))}
              </TableBody>
            </Table>
          </DataTable>
        )
      )}
    </div>
  );
}

// =============================================================================
// Fila de evento de conciliación
// =============================================================================

const MAX_DESC_CHARS = 120;

function FilaEvento({ evento }: { evento: EventoConNombre }) {
  const badgeClases = COLOR_ESTADO_CONCILIACION[evento.estado];
  const textoEstado = traducirEstadoConciliacion(evento.estado);

  const descripcionCorta =
    evento.descripcion.length > MAX_DESC_CHARS
      ? `${evento.descripcion.slice(0, MAX_DESC_CHARS)}...`
      : evento.descripcion;
  const descripcionCompleta =
    evento.descripcion.length > MAX_DESC_CHARS ? evento.descripcion : null;

  return (
    <TableRow className="group">
      <TableCell className="px-4">
        <p className="text-sm font-medium whitespace-normal">
          {traducirTipoDiferencia(evento.tipoDiferencia)}
        </p>
      </TableCell>

      <TableCell className="hidden px-4 text-muted-foreground sm:table-cell">
        {evento.sellerNombre ?? "—"}
      </TableCell>

      <TableCell className="hidden px-4 md:table-cell">
        {evento.pedidoId ? (
          <Link
            href={`/operaciones/${evento.pedidoId}`}
            className="font-mono text-xs text-primary hover:underline"
          >
            #{evento.pedidoId.slice(0, 8)}
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      <TableCell className="px-4">
        <span
          title={descripcionCompleta ?? undefined}
          className={`text-sm whitespace-normal text-muted-foreground ${descripcionCompleta ? "cursor-help" : ""}`}
        >
          {descripcionCorta}
        </span>
      </TableCell>

      <TableCell className="hidden px-4 lg:table-cell">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badgeClases}`}
        >
          {textoEstado}
        </span>
      </TableCell>

      <TableCell className="px-4 text-right">
        <MenuAccionesConciliacion eventoId={evento.id} estadoActual={evento.estado} />
      </TableCell>
    </TableRow>
  );
}
