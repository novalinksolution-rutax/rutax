/**
 * Pantalla D-4 — Conciliación.
 *
 * Server Component. Criterio C-6: descripción viene del backend, truncar a 120 chars con Tooltip.
 * Si pendienteCount === 0: banner verde celebratorio. Filtro default: pendiente.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
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
    // Sellers para el filtro
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

    // Todos los eventos para contadores
    const todosEventos = await listarEventosConciliacion(cliente, tenantId);
    for (const e of todosEventos) {
      if (e.estado === "pendiente") contPendientes++;
      else if (e.estado === "revisado") contRevisados++;
      else if (e.estado === "resuelto") contResueltos++;
      else if (e.estado === "ignorado") contIgnorados++;
    }

    // Filtrar para la tabla
    let filtrados = filtroEstado
      ? todosEventos.filter((e) => e.estado === filtroEstado)
      : todosEventos;

    if (filtroTipo) {
      filtrados = filtrados.filter((e) => e.tipoDiferencia === filtroTipo);
    }
    if (filtroSeller) {
      filtrados = filtrados.filter((e) => e.sellerId === filtroSeller);
    }

    // Ordenar: pendiente primero, luego más reciente
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

  // Banner verde si no hay pendientes
  if (!errorCarga && contPendientes === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Conciliación</h1>
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col items-center justify-center gap-4 rounded-xl border border-green-200 bg-green-50 px-6 py-16 text-center"
        >
          <CheckCircle2 className="size-12 text-green-500" aria-hidden="true" />
          <div>
            <p className="text-lg font-semibold text-green-800">
              Sin diferencias — todo cuadra.
            </p>
            <p className="mt-1 text-sm text-green-700">
              Los últimos períodos cerrados no presentaron diferencias.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const chips = [
    {
      key: "pendiente",
      label: "Pendientes",
      count: contPendientes,
      color: "bg-orange-50 border-orange-200 text-orange-800",
    },
    {
      key: "revisado",
      label: "Revisados",
      count: contRevisados,
      color: "bg-blue-50 border-blue-200 text-blue-800",
    },
    {
      key: "resuelto",
      label: "Resueltos",
      count: contResueltos,
      color: "bg-green-50 border-green-200 text-green-800",
    },
    {
      key: "ignorado",
      label: "Ignorados",
      count: contIgnorados,
      color: "bg-gray-50 border-gray-200 text-gray-700",
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Conciliación</h1>

      {/* Chips de resumen */}
      {!errorCarga && (
        <div className="flex flex-wrap gap-2" role="list" aria-label="Resumen de eventos de conciliación">
          {chips.map((chip) => {
            const estaActivo = filtroEstado === chip.key;
            return (
              <Link
                key={chip.key}
                href={estaActivo ? "/dinero/conciliacion" : urlConFiltros({ estado: chip.key })}
                role="listitem"
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-all ${chip.color} ${
                  estaActivo ? "ring-2 ring-offset-1 ring-current" : "hover:opacity-80"
                }`}
              >
                {chip.label}: <span className="font-bold">{chip.count}</span>
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
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
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
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
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
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {sellersDisponibles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Filtrar
        </button>

        {hayFiltroActivo && (
          <Link
            href="/dinero/conciliacion"
            className="h-9 flex items-center px-3 text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            Limpiar filtros
          </Link>
        )}
      </form>

      {/* Error */}
      {errorCarga && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          No se pudo cargar la lista de eventos. Intenta recargar la página.
        </div>
      )}

      {/* Tabla / vacío */}
      {!errorCarga && eventos.length === 0 ? (
        <div className="rounded-xl border bg-card px-6 py-12 text-center">
          <p className="text-muted-foreground">
            No hay eventos que coincidan con los filtros aplicados.
          </p>
          {hayFiltroActivo && (
            <Link
              href="/dinero/conciliacion"
              className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
            >
              Limpiar filtros
            </Link>
          )}
        </div>
      ) : (
        !errorCarga && (
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Eventos de conciliación">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2" style={{ width: "28%" }}>Tipo diferencia</th>
                    <th className="hidden px-4 py-2 sm:table-cell" style={{ width: "14%" }}>Seller</th>
                    <th className="hidden px-4 py-2 md:table-cell" style={{ width: "12%" }}>Pedido</th>
                    <th className="px-4 py-2" style={{ width: "28%" }}>Descripción</th>
                    <th className="hidden px-4 py-2 lg:table-cell" style={{ width: "8%" }}>Estado</th>
                    <th className="px-4 py-2 text-right" style={{ width: "10%" }}>
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {eventos.map((evento) => (
                    <FilaEvento key={evento.id} evento={evento} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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

  // Criterio C-6: truncar descripción a 120 chars
  const descripcionCorta =
    evento.descripcion.length > MAX_DESC_CHARS
      ? `${evento.descripcion.slice(0, MAX_DESC_CHARS)}...`
      : evento.descripcion;
  const descripcionCompleta =
    evento.descripcion.length > MAX_DESC_CHARS ? evento.descripcion : null;

  return (
    <tr className="group hover:bg-muted/30 transition-colors">
      {/* Tipo diferencia */}
      <td className="px-4 py-3">
        <p className="text-sm font-medium">
          {traducirTipoDiferencia(evento.tipoDiferencia)}
        </p>
      </td>

      {/* Seller */}
      <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
        {evento.sellerNombre ?? "—"}
      </td>

      {/* Pedido */}
      <td className="hidden px-4 py-3 md:table-cell">
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
      </td>

      {/* Descripción — criterio C-6 */}
      <td className="px-4 py-3">
        {descripcionCompleta ? (
          <span
            title={descripcionCompleta}
            className="cursor-help text-sm text-muted-foreground"
          >
            {descripcionCorta}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">{descripcionCorta}</span>
        )}
      </td>

      {/* Estado */}
      <td className="hidden px-4 py-3 lg:table-cell">
        <span
          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${badgeClases}`}
        >
          {textoEstado}
        </span>
      </td>

      {/* Acciones — menú 3 puntos */}
      <td className="px-4 py-3 text-right">
        <MenuAccionesConciliacion
          eventoId={evento.id}
          estadoActual={evento.estado}
        />
      </td>
    </tr>
  );
}
