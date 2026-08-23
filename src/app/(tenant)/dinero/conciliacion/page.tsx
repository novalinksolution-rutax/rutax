/**
 * Pantalla D-4 — Conciliación ("Bandeja de excepciones", §1.1 P1).
 *
 * Server Component. Resuelve sesión + RBAC (`puedeVerConciliacion`), carga
 * TODOS los eventos del tenant de una vez (mismo patrón que la versión
 * anterior) y aplica los filtros/orden en memoria — evita duplicar la
 * lógica de filtrado entre el cálculo de los contadores de los chips y la
 * lista renderizada, y `listarEventosConciliacion` no expone hoy un filtro
 * "sin asignar" (solo igualdad exacta), así que filtrar en memoria es más
 * simple que forzar ese caso al backend.
 *
 * Estado vacío ("todo cuadra"): total de eventos en estados NO-terminales
 * === 0 (`esEstadoTerminal`, nunca una lista de estados hardcodeada).
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, SearchX } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeVerConciliacion } from "@/modules/identidad/capacidades";
import { listarEventosConciliacion } from "@/modules/dinero/index";
import { esEstadoTerminal } from "@/modules/dinero/conciliacion-clasificacion";
import type {
  CategoriaNegocioConciliacion,
  EstadoEventoConciliacion,
  TipoDiferenciaConciliacion,
} from "@/modules/dinero/tipos";
import { listarUsuariosInternos, type UsuarioInterno } from "@/modules/identidad/consultas";
import {
  TEXTO_CATEGORIA_NEGOCIO_CONCILIACION,
  TEXTO_TIPO_DIFERENCIA,
  CLASES_BADGE_VARIANTE,
} from "@/lib/ui/traduccion-estados";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable } from "@/components/ui/data-table";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FiltrosConciliacion, SIN_ASIGNAR_FILTRO } from "./filtros-conciliacion";
import { FilaEventoConciliacion } from "./fila-evento-conciliacion";
import { esEventoVencido } from "./semaforo-vencimiento";
import type { EventoConciliacionUI } from "./tipos-ui";

export const metadata: Metadata = {
  title: "Conciliación",
};

// Fija el orden del Select "Estado" (8 valores) — filtro fino, más granular
// que los chips de "vista" (ver `VISTAS` abajo).
const ESTADOS_CONCIL: EstadoEventoConciliacion[] = [
  "pendiente",
  "en_analisis",
  "esperando_info",
  "requiere_ajuste",
  "resuelta_manual",
  "aceptada_justificada",
  "ignorada",
  "resuelta_auto",
];

// Deriva los tipos del propio mapa de traducción, igual que las categorías de
// abajo. Antes era un arreglo a mano y quedó desincronizado: le faltaban 4 de
// los 16 tipos (`payout_revertido_post_confirmacion`,
// `payout_estado_no_reconocido`, `linea_cobro_sin_periodo` y
// `liquidacion_atribuida_a_conductor_incorrecto`), así que esas excepciones de
// dinero existían en la bandeja pero no se podían filtrar. `TEXTO_TIPO_DIFERENCIA`
// es un `Record<TipoDiferenciaConciliacion, string>`: no compila si falta una
// clave, y el orden de declaración fija el orden del desplegable.
const TIPOS_DIFERENCIA = Object.keys(TEXTO_TIPO_DIFERENCIA) as TipoDiferenciaConciliacion[];

// Deriva las 4 categorías del propio mapa de traducción — única fuente de
// verdad, evita otra lista hardcodeada en paralelo.
const CATEGORIAS_CONCIL = Object.keys(
  TEXTO_CATEGORIA_NEGOCIO_CONCILIACION,
) as CategoriaNegocioConciliacion[];

/**
 * Chips de resumen — filtros COMPUESTOS (estado no-terminal + otra
 * condición), no una comparación directa de una columna. Reemplazan los 8
 * chips por-estado de la versión anterior.
 */
type VistaConciliacion = "vencidas" | "abiertas" | "sin_asignar" | "resueltas" | "ignoradas";

const VISTAS: { key: VistaConciliacion; label: string; tono: keyof typeof CLASES_BADGE_VARIANTE }[] = [
  { key: "vencidas", label: "Vencidas", tono: "error" },
  { key: "abiertas", label: "Abiertas", tono: "info" },
  { key: "sin_asignar", label: "Sin asignar", tono: "advertencia" },
  { key: "resueltas", label: "Resueltas", tono: "exito" },
  { key: "ignoradas", label: "Ignoradas", tono: "neutral" },
];

interface SearchParams {
  vista?: string;
  estado?: string;
  categoria?: string;
  tipo?: string;
  seller?: string;
  asignado?: string;
  bloqueado?: string;
  /** Filtro adicional por pedido — deep-link desde el panel de trazabilidad financiera. */
  pedido?: string;
  /** Deep-link a un evento puntual (p. ej. desde un aviso) — auto-abre su Sheet de detalle. */
  evento?: string;
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

  const filtroPedido = params.pedido ?? "";
  const filtroEventoId = params.evento ?? "";
  const filtroEstado = (params.estado as EstadoEventoConciliacion | "") || "";
  const filtroCategoria = (params.categoria as CategoriaNegocioConciliacion | "") || "";
  const filtroTipo = (params.tipo as TipoDiferenciaConciliacion | "") || "";
  const filtroSeller = params.seller ?? "";
  const filtroAsignado = params.asignado ?? "";
  const filtroBloqueado = params.bloqueado === "1";

  // Deep-link (pedido o evento puntual): no forzar el bucket "Abiertas" por
  // defecto — lo que motivó el link puede estar ya resuelto.
  const vistaDefault: VistaConciliacion | "" = filtroPedido || filtroEventoId ? "" : "abiertas";
  const filtroVista = ((params.vista as VistaConciliacion | "") || vistaDefault) as VistaConciliacion | "";

  const cliente = crearClienteServiceRole();
  let eventos: EventoConciliacionUI[] = [];
  let sellersDisponibles: { id: string; nombre: string }[] = [];
  let usuariosInternos: UsuarioInterno[] = [];
  let errorCarga = false;

  let totalNoTerminales = 0;
  const contadoresVista: Record<VistaConciliacion, number> = {
    vencidas: 0,
    abiertas: 0,
    sin_asignar: 0,
    resueltas: 0,
    ignoradas: 0,
  };

  try {
    const [sellersResult, usuariosData, todosEventos] = await Promise.all([
      cliente.from("sellers").select("id, razon_social").eq("tenant_id", tenantId).order("razon_social"),
      listarUsuariosInternos(cliente, tenantId),
      listarEventosConciliacion(cliente, tenantId),
    ]);

    sellersDisponibles = (sellersResult.data ?? []).map((s: Record<string, unknown>) => ({
      id: s.id as string,
      nombre: s.razon_social as string,
    }));
    const sellersMap = new Map(sellersDisponibles.map((s) => [s.id, s.nombre]));
    usuariosInternos = usuariosData;

    for (const e of todosEventos) {
      if (esEstadoTerminal(e.estado)) {
        contadoresVista.resueltas += 1;
        if (e.estado === "ignorada") contadoresVista.ignoradas += 1;
      } else {
        totalNoTerminales += 1;
        contadoresVista.abiertas += 1;
        if (!e.asignadoAUsuarioId) contadoresVista.sin_asignar += 1;
        if (esEventoVencido(e.fechaLimite, e.estado)) contadoresVista.vencidas += 1;
      }
    }

    let filtrados = todosEventos;

    if (filtroEstado) {
      filtrados = filtrados.filter((e) => e.estado === filtroEstado);
    } else if (filtroVista) {
      filtrados = filtrados.filter((e) => {
        switch (filtroVista) {
          case "vencidas":
            return esEventoVencido(e.fechaLimite, e.estado);
          case "abiertas":
            return !esEstadoTerminal(e.estado);
          case "sin_asignar":
            return !esEstadoTerminal(e.estado) && !e.asignadoAUsuarioId;
          case "resueltas":
            return esEstadoTerminal(e.estado);
          case "ignoradas":
            return e.estado === "ignorada";
          default:
            return true;
        }
      });
    }

    if (filtroCategoria) filtrados = filtrados.filter((e) => e.categoriaNegocio === filtroCategoria);
    if (filtroTipo) filtrados = filtrados.filter((e) => e.tipoDiferencia === filtroTipo);
    if (filtroSeller) filtrados = filtrados.filter((e) => e.sellerId === filtroSeller);
    if (filtroAsignado === SIN_ASIGNAR_FILTRO) {
      filtrados = filtrados.filter((e) => !e.asignadoAUsuarioId);
    } else if (filtroAsignado) {
      filtrados = filtrados.filter((e) => e.asignadoAUsuarioId === filtroAsignado);
    }
    if (filtroBloqueado) filtrados = filtrados.filter((e) => e.bloqueaFacturacion || e.bloqueaPago);
    if (filtroPedido) filtrados = filtrados.filter((e) => e.pedidoId === filtroPedido);

    // Orden por urgencia: vencidas primero, luego por fecha límite ascendente
    // (la más próxima primero), y como último criterio lo más reciente.
    filtrados = [...filtrados].sort((a, b) => {
      const aVencida = esEventoVencido(a.fechaLimite, a.estado);
      const bVencida = esEventoVencido(b.fechaLimite, b.estado);
      if (aVencida !== bVencida) return aVencida ? -1 : 1;
      const aFecha = a.fechaLimite ?? "9999-12-31";
      const bFecha = b.fechaLimite ?? "9999-12-31";
      if (aFecha !== bFecha) return aFecha < bFecha ? -1 : 1;
      return b.creadoEn.localeCompare(a.creadoEn);
    });

    eventos = filtrados.map((e) => ({
      ...e,
      sellerNombre: e.sellerId ? (sellersMap.get(e.sellerId) ?? null) : null,
    }));
  } catch {
    errorCarga = true;
  }

  const hayFiltroActivo = !!(
    filtroCategoria ||
    filtroTipo ||
    filtroSeller ||
    filtroAsignado ||
    filtroBloqueado ||
    filtroPedido ||
    filtroEstado ||
    (filtroVista && filtroVista !== vistaDefault)
  );

  function urlConFiltros(overrides: Record<string, string>) {
    const sp = new URLSearchParams();
    if (filtroVista) sp.set("vista", filtroVista);
    if (filtroEstado) sp.set("estado", filtroEstado);
    if (filtroCategoria) sp.set("categoria", filtroCategoria);
    if (filtroTipo) sp.set("tipo", filtroTipo);
    if (filtroSeller) sp.set("seller", filtroSeller);
    if (filtroAsignado) sp.set("asignado", filtroAsignado);
    if (filtroBloqueado) sp.set("bloqueado", "1");
    if (filtroPedido) sp.set("pedido", filtroPedido);
    Object.entries(overrides).forEach(([k, v]) => {
      if (v) sp.set(k, v);
      else sp.delete(k);
    });
    const s = sp.toString();
    return `/dinero/conciliacion${s ? `?${s}` : ""}`;
  }

  // Query string a preservar cuando una fila abre/cierra su Sheet de detalle
  // (todo excepto `evento`, que cada fila controla por su cuenta).
  const queryStringFiltros = (() => {
    const sp = new URLSearchParams();
    if (filtroVista) sp.set("vista", filtroVista);
    if (filtroEstado) sp.set("estado", filtroEstado);
    if (filtroCategoria) sp.set("categoria", filtroCategoria);
    if (filtroTipo) sp.set("tipo", filtroTipo);
    if (filtroSeller) sp.set("seller", filtroSeller);
    if (filtroAsignado) sp.set("asignado", filtroAsignado);
    if (filtroBloqueado) sp.set("bloqueado", "1");
    if (filtroPedido) sp.set("pedido", filtroPedido);
    return sp.toString();
  })();

  // Estado de tranquilidad: 0 eventos en estados no-terminales = "todo
  // cuadra" (confianza, no ausencia). Se omite con un deep-link de pedido o
  // evento puntual: lo que motivó el link debe verse igual, no taparse.
  //
  // 🐞 Y SE OMITE TAMBIÉN CON CUALQUIER FILTRO PUESTO. Antes solo miraba
  // `totalNoTerminales`, así que **filtrar por «Resuelta» devolvía «todo cuadra
  // · no necesitas hacer nada»** y las filas resueltas quedaban inalcanzables —
  // con ellas, el botón «Reabrir la excepción», que solo vive ahí. Dos errores
  // a la vez: escondía justo lo que el usuario pidió ver, y afirmaba algo que
  // no había comprobado, que es la misma familia del vacío mentiroso de
  // cobranza. Encontrado verificando la ceremonia de reapertura, que no había
  // forma de alcanzar.
  const hayFiltroPuesto =
    Boolean(filtroEstado) ||
    Boolean(filtroCategoria) ||
    Boolean(filtroTipo) ||
    Boolean(filtroSeller) ||
    Boolean(filtroAsignado) ||
    filtroBloqueado;

  if (
    !errorCarga &&
    !filtroPedido &&
    !filtroEventoId &&
    !hayFiltroPuesto &&
    totalNoTerminales === 0
  ) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold">Conciliación</h1>
        <EmptyState
          icon={CheckCircle2}
          tono="buen-estado"
          titulo="Sin diferencias — todo cuadra"
          descripcion="Los últimos períodos cerrados no presentaron descuadres entre lo entregado y lo facturado. No necesitas hacer nada."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold">Conciliación</h1>

      {/* Chips de resumen */}
      {!errorCarga && (
        <div
          className="flex flex-wrap gap-2"
          role="list"
          aria-label="Resumen de la bandeja de excepciones"
        >
          {VISTAS.map((v) => {
            const estaActivo = !filtroEstado && filtroVista === v.key;
            return (
              <Link
                key={v.key}
                href={estaActivo ? "/dinero/conciliacion" : urlConFiltros({ vista: v.key, estado: "" })}
                role="listitem"
                aria-current={estaActivo ? "true" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-all ${CLASES_BADGE_VARIANTE[v.tono]} ${
                  estaActivo ? "ring-2 ring-current ring-offset-1" : "hover:opacity-80"
                }`}
              >
                {v.label}: <span className="font-bold tabular-nums">{contadoresVista[v.key]}</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Filtro de pedido activo (deep-link desde el panel de trazabilidad
          financiera) — se muestra aparte de los filtros normales porque no
          tiene su propio control de UI, solo llega por querystring. */}
      {filtroPedido && (
        <div className="flex items-center gap-2 rounded-lg border border-info-subtle bg-info-subtle/40 px-3 py-2 text-sm text-info-subtle-foreground">
          <span>
            Filtrando por pedido <span className="font-mono text-xs">{filtroPedido}</span>
          </span>
          <Link href={urlConFiltros({ pedido: "" })} className="ml-auto text-xs font-medium underline">
            Quitar filtro
          </Link>
        </div>
      )}

      {/* Filtros */}
      <FiltrosConciliacion
        estados={ESTADOS_CONCIL}
        categorias={CATEGORIAS_CONCIL}
        tipos={TIPOS_DIFERENCIA}
        sellers={sellersDisponibles}
        usuariosInternos={usuariosInternos}
        filtroVista={filtroVista}
        filtroEstado={filtroEstado}
        filtroCategoria={filtroCategoria}
        filtroTipo={filtroTipo}
        filtroSeller={filtroSeller}
        filtroAsignado={filtroAsignado}
        filtroBloqueado={filtroBloqueado}
        filtroPedido={filtroPedido}
        hayFiltroActivo={hayFiltroActivo}
      />

      {/* Error */}
      {errorCarga && (
        <div
          role="alert"
          className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground"
        >
          No se pudo cargar la bandeja de excepciones. Intenta recargar la página.
        </div>
      )}

      {/* Tabla / vacío de filtro */}
      {!errorCarga && eventos.length === 0 ? (
        <EmptyState
          icon={SearchX}
          tono="filtro"
          titulo="Ninguna excepción coincide"
          descripcion="No hay excepciones de conciliación con los filtros aplicados."
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
            <Table densidad="compact" aria-label="Excepciones de conciliación">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="px-4">Categoría / Tipo</TableHead>
                  <TableHead className="hidden px-4 sm:table-cell">Estado</TableHead>
                  <TableHead className="hidden px-4 md:table-cell">Vence</TableHead>
                  <TableHead className="hidden px-4 lg:table-cell">Asignado</TableHead>
                  <TableHead className="hidden px-4 xl:table-cell text-right">Diferencia</TableHead>
                  <TableHead className="hidden px-4 2xl:table-cell">Seller</TableHead>
                  <TableHead className="hidden px-4 2xl:table-cell">Pedido</TableHead>
                  <TableHead className="px-4 text-right">
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eventos.map((evento) => (
                  <FilaEventoConciliacion
                    key={evento.id}
                    evento={evento}
                    usuariosInternos={usuariosInternos}
                    usuarioActualId={sesion.usuarioId}
                    abrirInicial={filtroEventoId === evento.id}
                    queryStringFiltros={queryStringFiltros}
                  />
                ))}
              </TableBody>
            </Table>
          </DataTable>
        )
      )}
    </div>
  );
}
