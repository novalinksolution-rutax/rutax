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
import { Inbox, SearchX, MapPinOff } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { listarPedidos } from "@/modules/operacion/pedidos";
import { mapaNombresConductores } from "@/modules/identidad/consultas";
import {
  puedeAsignarYReasignarPedidos,
  puedeGestionarIncidencias,
  puedeAjustarOperacionDiaria,
} from "@/modules/identidad/capacidades";
import {
  traducirEstadoPedido,
  BADGE_ESTADO_PEDIDO,
  traducirGeoEstado,
  traducirCoberturaEstado,
  BADGE_GEO_ESTADO,
  BADGE_COBERTURA_ESTADO,
  requiereRevisionGeo,
} from "@/lib/ui/traduccion-estados";
import type { Pedido } from "@/modules/operacion/tipos";
import { etiquetaConductorAusente } from "@/lib/ui/etiqueta-conductor-ausente";
import { etiquetaFuentePedido } from "@/lib/ui/etiqueta-fuente-pedido";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
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
import { IndicadorEnVivo } from "@/components/tiempo-real/indicador-en-vivo";
import { obtenerSellersDelTenant, type SellerFiltro } from "@/lib/datos-tenant/sellers";
import { obtenerConductoresDelTenant } from "@/lib/datos-tenant/conductores";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import {
  sanearFiltroEstadoPedido,
  sanearFiltroFuentePedido,
  sanearFiltroUuid,
  sanearFiltroFechaCivil,
  sanearNumeroPagina,
} from "./sanear-filtros";

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
  { key: "pendiente_asignacion", label: "Pendiente asignación", clases: "bg-warning-subtle text-warning-subtle-foreground" },
  { key: "asignado", label: "Asignados", clases: "bg-info-subtle text-info-subtle-foreground" },
  { key: "en_ruta", label: "En ruta", clases: "bg-info-subtle text-info-subtle-foreground" },
  { key: "entregado", label: "Entregados", clases: "bg-success-subtle text-success-subtle-foreground" },
  { key: "con_problemas", label: "Con problemas", clases: "bg-destructive-subtle text-destructive-subtle-foreground" },
] as const;

/** Nombre visible de la cuenta de origen: alias → nickname de ML → últimos 4. */
function etiquetaCuentaOrigen(alias: string | null, mlNickname: string | null, mlUserId: string | null): string {
  if (alias && alias.trim()) return alias;
  if (mlNickname && mlNickname.trim()) return mlNickname;
  if (mlUserId && mlUserId.length >= 4) return `···${mlUserId.slice(-4)}`;
  return "Otra cuenta";
}

// =============================================================================
// Página principal
// =============================================================================

interface SearchParams {
  seller?: string;
  estado?: string;
  fecha?: string;
  /** Comuna de destino — destino de los enlaces profundos de la Torre (F11). */
  comuna?: string;
  /** Id del conductor — ídem. */
  conductor?: string;
  /** Procedencia del pedido (ml_flex | rutax_manual | shopify). */
  fuente?: string;
  por_revisar?: string;
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

  const hoyIso = fechaLocalEnSantiago(new Date());
  // Saneados ANTES de tocar `listarPedidos`: un valor inválido en la URL (un
  // enlace mal copiado, un marcador viejo, `?estado=todos`) se ignora — se
  // trata como si el filtro no viniera — en vez de llegar intacto a un `.eq()`
  // sobre una columna enum/uuid/date de Postgres y tumbar la lista entera con
  // "No pudimos cargar los pedidos" (ver `sanear-filtros.ts`). `comuna` no
  // necesita saneo: es texto libre contra `ilike`, sin tipo que Postgres pueda
  // rechazar.
  const filtroSeller = sanearFiltroUuid(params.seller);
  const filtroEstado = sanearFiltroEstadoPedido(params.estado);
  const filtroFecha = sanearFiltroFechaCivil(params.fecha) || hoyIso;
  const filtroComuna = params.comuna || "";
  const filtroConductor = sanearFiltroUuid(params.conductor);
  const filtroFuente = sanearFiltroFuentePedido(params.fuente);
  const filtroPorRevisar = params.por_revisar === "1";
  const pagina = sanearNumeroPagina(params.pagina);
  const LIMITE = 25;

  const hayFiltroActivo = !!(
    filtroSeller ||
    filtroEstado ||
    filtroComuna ||
    filtroConductor ||
    filtroFuente ||
    filtroPorRevisar ||
    filtroFecha !== hoyIso
  );

  const puedeAsignar = puedeAsignarYReasignarPedidos(sesion.usuario);
  const puedeIncidencias = puedeGestionarIncidencias(sesion.usuario);
  const puedeAjustar = puedeAjustarOperacionDiaria(sesion.usuario);

  const cliente = crearClienteServiceRole();

  // listarPedidos y la lista de sellers para los filtros no dependen entre sí:
  // se cargan en paralelo (antes la lista de sellers esperaba a que terminara
  // la carga de pedidos sin necesidad).
  const [resPedidos, sellersDisponibles, conductoresDisponibles] = await Promise.all([
    listarPedidos(cliente, {
      tenantId,
      sellerId: filtroSeller || undefined,
      // Comuna y conductor SÍ aplican junto a «por revisar»: la bandeja de
      // direcciones es un corte del mismo universo, y acotarla a una comuna es
      // exactamente lo que se quiere al llegar desde la Torre.
      comuna: filtroComuna || undefined,
      conductorId: filtroConductor || undefined,
      fuente: filtroFuente || undefined,
      estado: filtroPorRevisar ? undefined : filtroEstado || undefined,
      fecha: filtroPorRevisar ? undefined : filtroFecha || undefined,
      porRevisar: filtroPorRevisar || undefined,
      pagina,
      limite: LIMITE,
    }).then(
      (r) => ({ ok: true as const, datos: r }),
      () => ({ ok: false as const }),
    ),
    // Lista de sellers para el filtro — cacheada por tenant (datos-tenant/sellers).
    obtenerSellersDelTenant(tenantId).catch(() => [] as SellerFiltro[]),
    // Conductores para el filtro (F11). Cacheada por tenant igual que la de
    // sellers: cambia poco y la piden varias pantallas.
    obtenerConductoresDelTenant(tenantId).catch(() => [] as { id: string; nombre: string }[]),
  ]);

  const errorCarga = !resPedidos.ok;
  const resultado = resPedidos.ok
    ? resPedidos.datos
    : { datos: [], total: 0, pagina: 1, limite: LIMITE };

  const pedidos = resultado.datos;
  const totalPedidos = resultado.total;
  const totalPaginas = Math.ceil(totalPedidos / LIMITE);
  const contadores = calcularContadores(pedidos);
  const tieneAcciones = puedeAsignar || puedeIncidencias || puedeAjustar;

  // Nombres legibles del seller para la columna (UUID → razón social).
  const nombreSellerPorId = Object.fromEntries(
    sellersDisponibles.map((s) => [s.id, s.nombre]),
  );

  // El badge de origen (cuenta ML) y los nombres de conductor dependen ambos
  // SOLO de `pedidos`, así que se resuelven en paralelo entre sí (antes eran
  // dos esperas encadenadas). Cada bloque DEVUELVE su mapa — sin reasignar
  // variables externas desde dentro de un closure async.
  const [origenPorPedido, nombreConductorPorId] = await Promise.all([
    // Badge de origen: la cuenta ML de cada pedido, SOLO si el seller tiene más
    // de una cuenta conectada. Dos consultas acotadas — sin tocar el tipo
    // `Pedido` ni el módulo de operación.
    (async (): Promise<Record<string, string | null>> => {
      const mapa: Record<string, string | null> = {};
      try {
        const sellerIds = Array.from(new Set(pedidos.map((p) => p.sellerId)));
        const pedidoIds = pedidos.map((p) => p.id);
        if (sellerIds.length === 0 || pedidoIds.length === 0) return mapa;
        const [conexRes, pedRes] = await Promise.all([
          cliente
            .schema("identidad")
            .from("conexiones_seller_ml")
            .select("seller_id, ml_user_id, alias, ml_nickname")
            .eq("tenant_id", tenantId)
            .in("seller_id", sellerIds),
          cliente
            .schema("operacion")
            .from("pedidos")
            .select("id, seller_id, ml_user_id")
            .in("id", pedidoIds),
        ]);
        const countBySeller: Record<string, number> = {};
        const labelByKey: Record<string, string> = {};
        for (const c of (conexRes.data ?? []) as Array<{
          seller_id: string;
          ml_user_id: string | null;
          alias: string | null;
          ml_nickname: string | null;
        }>) {
          countBySeller[c.seller_id] = (countBySeller[c.seller_id] ?? 0) + 1;
          if (c.ml_user_id) {
            labelByKey[`${c.seller_id}:${c.ml_user_id}`] = etiquetaCuentaOrigen(c.alias, c.ml_nickname, c.ml_user_id);
          }
        }
        for (const p of (pedRes.data ?? []) as Array<{ id: string; seller_id: string; ml_user_id: string | null }>) {
          if ((countBySeller[p.seller_id] ?? 0) > 1 && p.ml_user_id) {
            mapa[p.id] = labelByKey[`${p.seller_id}:${p.ml_user_id}`] ?? null;
          }
        }
      } catch {
        // best-effort — sin badge si falla la resolución de origen.
      }
      return mapa;
    })(),

    // Nombres de conductor para la columna (UUID → nombre).
    (async (): Promise<Record<string, string>> => {
      try {
        const driverIds = Array.from(
          new Set(pedidos.flatMap((p) => (p.driverIdAsignado ? [p.driverIdAsignado] : []))),
        );
        return await mapaNombresConductores(cliente, tenantId, driverIds);
      } catch {
        // best-effort — si falla, la celda cae al UUID.
        return {};
      }
    })(),
  ]);

  function hrefPagina(p: number): string {
    const sp = new URLSearchParams();
    if (filtroSeller) sp.set("seller", filtroSeller);
    if (filtroFuente) sp.set("fuente", filtroFuente);
    if (filtroPorRevisar) {
      sp.set("por_revisar", "1");
    } else {
      if (filtroEstado) sp.set("estado", filtroEstado);
      if (filtroFecha) sp.set("fecha", filtroFecha);
    }
    if (p > 1) sp.set("pagina", String(p));
    const qs = sp.toString();
    return qs ? `/operaciones?${qs}` : "/operaciones";
  }

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-heading text-2xl font-semibold">
              {filtroPorRevisar ? "Direcciones por revisar" : "Pedidos"}
            </h1>
            <IndicadorEnVivo tenantId={tenantId} />
          </div>
          {filtroPorRevisar && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Pedidos con dirección no ubicada, fuera de cobertura o sin tarifa de zona. Revísalos antes de rutear.
            </p>
          )}
        </div>
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
          No pudimos cargar los pedidos. Intenta recargar la página.
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
            <p className="text-lg font-semibold tabular-nums">
              {errorCarga ? "—" : (contadores[key] ?? 0)}
            </p>
            <p className="text-xs font-medium">{label}</p>
          </div>
        ))}
      </div>

      {/* Bloque 2 — Filtros */}
      <FiltrosPedidosForm
        sellers={sellersDisponibles}
        conductores={conductoresDisponibles}
        filtroSeller={filtroSeller}
        filtroEstado={filtroEstado}
        filtroFecha={filtroFecha}
        filtroComuna={filtroComuna}
        filtroConductor={filtroConductor}
        filtroFuente={filtroFuente}
        filtroPorRevisar={filtroPorRevisar}
        hayFiltroActivo={hayFiltroActivo}
      />

      {/* Bloque 3 — Tabla / estados de vista */}
      {pedidos.length === 0 && !errorCarga ? (
        filtroPorRevisar ? (
          <EmptyState
            icon={MapPinOff}
            tono="filtro"
            titulo="Sin direcciones por revisar"
            descripcion="Todos los pedidos tienen dirección ubicada y cobertura confirmada. Buen trabajo."
            accion={
              <Button asChild variant="outline" size="sm">
                <Link href="/operaciones">Ver todos los pedidos</Link>
              </Button>
            }
          />
        ) : hayFiltroActivo ? (
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
            titulo="Aún no hay pedidos para esta fecha"
            descripcion={
              puedeAjustar
                ? "Se sincronizan automáticamente desde las fuentes conectadas (Mercado Libre, Shopify). También puedes crear un pedido same-day desde el botón de arriba."
                : "Se sincronizan automáticamente desde las fuentes conectadas (Mercado Libre, Shopify)."
            }
          />
        )
      ) : (
        <DataTable
          toolbar={
            <span className="text-sm text-muted-foreground tabular-nums">
              {errorCarga ? "—" : `${totalPedidos} ${totalPedidos === 1 ? "pedido" : "pedidos"}`}
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
                {filtroPorRevisar ? (
                  <TableHead className="px-4">Motivo</TableHead>
                ) : (
                  <TableHead className="hidden px-4 text-right md:table-cell">
                    Fecha comprometida
                  </TableHead>
                )}
                <TableHead className="hidden px-4 lg:table-cell">Conductor</TableHead>
                <TableHead className="px-4">Fuente</TableHead>
                {tieneAcciones && (
                  <TableHead className="px-4 text-right">
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pedidos.map((pedido) => (
                <FilaPedido
                  key={pedido.id}
                  pedido={pedido}
                  tieneAcciones={tieneAcciones}
                  modoBandeja={filtroPorRevisar}
                  origen={origenPorPedido[pedido.id] ?? null}
                  sellerNombre={nombreSellerPorId[pedido.sellerId] ?? null}
                  conductorNombre={
                    pedido.driverIdAsignado
                      ? (nombreConductorPorId[pedido.driverIdAsignado] ?? null)
                      : null
                  }
                />
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

function FilaPedido({
  pedido,
  tieneAcciones,
  modoBandeja = false,
  origen = null,
  sellerNombre = null,
  conductorNombre = null,
}: {
  pedido: Pedido;
  tieneAcciones: boolean;
  modoBandeja?: boolean;
  origen?: string | null;
  sellerNombre?: string | null;
  conductorNombre?: string | null;
}) {
  // Determinar si requiere revisión para mostrar badge discreto en la lista normal
  const requiereRevision = requiereRevisionGeo(pedido.geoEstado, pedido.coberturaEstado);
  const estaPendienteGeo = pedido.geoEstado === "pendiente" && !requiereRevision;

  return (
    <TableRow className="group">
      <TableCell className="px-4">
        <BadgeEstado
          variante={BADGE_ESTADO_PEDIDO[pedido.estado]}
          texto={traducirEstadoPedido(pedido.estado)}
        />
      </TableCell>
      <TableCell className="px-4">
        <Link href={`/operaciones/${pedido.id}`} className="font-medium hover:underline">
          {pedido.destinatarioNombre}
        </Link>
        <div className="flex flex-wrap items-center gap-1 mt-0.5">
          <p className="text-xs text-muted-foreground">{pedido.destinatarioComuna}</p>
          {/* Origen de cuenta ML — solo si el seller tiene más de una conexión */}
          {origen && (
            <span className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{origen}</span>
          )}
          {/* Badge discreto de geocoding: solo cuando hay problema, no en modo bandeja (ya tiene columna) */}
          {!modoBandeja && requiereRevision && (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-destructive-subtle px-1.5 py-px text-[10px] font-medium text-destructive-subtle-foreground">
              <MapPinOff className="size-2.5" aria-hidden="true" />
              Por revisar
            </span>
          )}
          {/* Indicador sutil de geocoding en curso */}
          {!modoBandeja && estaPendienteGeo && (
            <span className="text-[10px] text-muted-foreground/70 italic">Ubicando…</span>
          )}
        </div>
      </TableCell>
      <TableCell className="hidden px-4 text-muted-foreground sm:table-cell">
        {sellerNombre ?? pedido.sellerId}
      </TableCell>
      {/* Columna condicional: Motivo en bandeja / Fecha comprometida en lista normal */}
      {modoBandeja ? (
        <TableCell className="px-4">
          <BadgesMotivoGeo pedido={pedido} />
        </TableCell>
      ) : (
        <TableCell className="hidden px-4 text-right font-mono text-muted-foreground tabular-nums md:table-cell">
          {pedido.fechaCompromiso ?? "Sin fecha"}
        </TableCell>
      )}
      <TableCell className="hidden px-4 text-muted-foreground lg:table-cell">
        {pedido.driverIdAsignado ? (
          (conductorNombre ?? pedido.driverIdAsignado)
        ) : (
          <CeldaSinConductor pedido={pedido} />
        )}
      </TableCell>
      <TableCell className="px-4">
        <Badge variant="neutral">{etiquetaFuentePedido(pedido.fuente)}</Badge>
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

/**
 * Columna CONDUCTOR de un pedido sin conductor asignado. El texto y el tono los
 * decide `etiquetaConductorAusente`, que vive aparte y con pruebas: acá solo
 * queda pintarlo.
 */
function CeldaSinConductor({ pedido }: { pedido: Pedido }) {
  const { texto, tono, detalle } = etiquetaConductorAusente(pedido.estado);

  return (
    <span
      className={tono === "pendiente" ? "text-warning-subtle-foreground" : "text-muted-foreground"}
      {...(detalle ? { title: detalle } : {})}
    >
      {texto}
    </span>
  );
}

// =============================================================================
// Badges de motivo de revisión para la bandeja
// =============================================================================

function BadgesMotivoGeo({ pedido }: { pedido: Pedido }) {
  const tieneGeoProblema =
    pedido.geoEstado === "no_resuelto" || pedido.geoEstado === "fuera_cobertura";
  const tieneCoberturaProblema =
    pedido.coberturaEstado === "sin_tarifa_zona" ||
    pedido.coberturaEstado === "requiere_revision";

  if (!tieneGeoProblema && !tieneCoberturaProblema) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {tieneGeoProblema && (
        <BadgeEstado
          variante={BADGE_GEO_ESTADO[pedido.geoEstado]}
          texto={traducirGeoEstado(pedido.geoEstado)}
        />
      )}
      {tieneCoberturaProblema && (
        <BadgeEstado
          variante={BADGE_COBERTURA_ESTADO[pedido.coberturaEstado]}
          texto={traducirCoberturaEstado(pedido.coberturaEstado)}
        />
      )}
    </div>
  );
}
