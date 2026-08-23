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
import { listarPedidos, contarPedidosPorGrupo } from "@/modules/operacion/pedidos";
import { GRUPOS_ESTADO_PEDIDO } from "@/modules/operacion/tipos";
import type { EstadoPedido, GrupoEstadoPedido } from "@/modules/operacion/tipos";
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
  sanearGrupoEstadoPedido,
  sanearFiltroFuentePedido,
  sanearFiltroUuid,
  sanearFiltroFechaCivil,
  sanearNumeroPagina,
} from "./sanear-filtros";

// =============================================================================
// Contadores de estado agrupados para los chips
// =============================================================================

/**
 * La barra de grupos es la NAVEGACIÓN de estado de la pantalla, no un adorno.
 *
 * Antes eran cinco tarjetas inertes que informaban un número y no llevaban a
 * ningún lado, mientras el estado se elegía en un `<select>` aparte — dos
 * controles para lo mismo. Ahora pulsar un cajón ES filtrar, que es como ya
 * funcionaban los chips de `/dinero/periodos`.
 *
 * `por_revisar` entra como un cajón más: era un botón suelto que además
 * secuestraba el `<h1>` de la pantalla y desactivaba los otros filtros, o sea
 * se comportaba como una vista y no como un filtro.
 *
 * Las cifras vienen de `contarPedidosPorGrupo` (conteo en base sobre todo el
 * conjunto). Las claves y su agrupación viven en `GRUPOS_ESTADO_PEDIDO`, del
 * módulo — no se redefinen aquí, para que el número de arriba y la tabla de
 * abajo no puedan volver a decir cosas distintas.
 */
const GRUPOS_BARRA: {
  clave: GrupoEstadoPedido;
  etiqueta: string;
  clasesActivo: string;
}[] = [
  {
    clave: "pendiente_asignacion",
    etiqueta: "Pendiente asignación",
    clasesActivo: "bg-warning-subtle text-warning-subtle-foreground ring-warning/40",
  },
  {
    clave: "asignado",
    etiqueta: "Asignados",
    clasesActivo: "bg-info-subtle text-info-subtle-foreground ring-info/40",
  },
  {
    clave: "en_ruta",
    etiqueta: "En ruta",
    clasesActivo: "bg-info-subtle text-info-subtle-foreground ring-info/40",
  },
  {
    clave: "entregado",
    etiqueta: "Entregados",
    clasesActivo: "bg-success-subtle text-success-subtle-foreground ring-success/40",
  },
  {
    clave: "con_problemas",
    etiqueta: "Con problemas",
    clasesActivo: "bg-destructive-subtle text-destructive-subtle-foreground ring-destructive/40",
  },
  {
    clave: "por_revisar",
    etiqueta: "Dirección por revisar",
    clasesActivo: "bg-destructive-subtle text-destructive-subtle-foreground ring-destructive/40",
  },
];

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
  /** Día exacto de `fecha_compromiso` (nombre histórico; deep-links de la Torre). */
  fecha?: string;
  /** Rango de `fecha_compromiso` — excluyente con `fecha`. */
  fecha_desde?: string;
  fecha_hasta?: string;
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
  // `?estado=` es el ÚNICO eje de estado: acepta una clave de grupo (lo que
  // emiten los cajones de la barra) o un `EstadoPedido` suelto (lo que mandan
  // los enlaces profundos que ya existen, como el del dashboard).
  const filtroGrupo = sanearGrupoEstadoPedido(params.estado);
  // `?por_revisar=1` era el parámetro del botón que se retiró. Se sigue leyendo
  // para no romper un marcador guardado, pero la forma canónica es
  // `?estado=por_revisar`.
  const filtroPorRevisar = filtroGrupo === "por_revisar" || params.por_revisar === "1";
  const grupoActivo: GrupoEstadoPedido | "" = filtroPorRevisar
    ? "por_revisar"
    : filtroGrupo && filtroGrupo in GRUPOS_ESTADO_PEDIDO
      ? (filtroGrupo as GrupoEstadoPedido)
      : "";
  // Estado suelto: solo cuando lo que vino NO es una clave de grupo.
  const filtroEstado: EstadoPedido | "" =
    !filtroPorRevisar && filtroGrupo && !(filtroGrupo in GRUPOS_ESTADO_PEDIDO)
      ? (filtroGrupo as EstadoPedido)
      : "";
  const estadosDelGrupo =
    grupoActivo && grupoActivo !== "por_revisar"
      ? GRUPOS_ESTADO_PEDIDO[grupoActivo]
      : undefined;
  // Fecha: día exacto (excluyente) o rango. Si viene un rango válido, manda el
  // rango y NO se aplica el "hoy por defecto"; si no, cae al día exacto (o a hoy
  // cuando la URL no trae fecha alguna). `fecha` gana sobre el rango, igual que
  // en `listarPedidos`.
  const fechaExactaParam = sanearFiltroFechaCivil(params.fecha);
  const fechaDesdeParam = sanearFiltroFechaCivil(params.fecha_desde);
  const fechaHastaParam = sanearFiltroFechaCivil(params.fecha_hasta);
  const hayRangoFecha = !fechaExactaParam && !!(fechaDesdeParam || fechaHastaParam);
  const filtroFecha = hayRangoFecha ? "" : fechaExactaParam || hoyIso;
  const filtroFechaDesde = hayRangoFecha ? fechaDesdeParam : "";
  const filtroFechaHasta = hayRangoFecha ? fechaHastaParam : "";
  const filtroComuna = params.comuna || "";
  const filtroConductor = sanearFiltroUuid(params.conductor);
  const filtroFuente = sanearFiltroFuentePedido(params.fuente);
  const pagina = sanearNumeroPagina(params.pagina);
  const LIMITE = 25;

  const hayFiltroActivo = !!(
    filtroSeller ||
    filtroEstado ||
    grupoActivo ||
    filtroComuna ||
    filtroConductor ||
    filtroFuente ||
    hayRangoFecha ||
    filtroFecha !== hoyIso
  );

  // Filtros que NO son de estado. Son los que comparten el listado y la barra:
  // la barra los respeta para contar lo mismo que la tabla muestra, y NO recibe
  // el eje de estado porque si no, pulsar un cajón dejaría los otros en cero.
  const filtrosBase = {
    tenantId,
    sellerId: filtroSeller || undefined,
    // Comuna y conductor SÍ aplican junto a «dirección por revisar»: es un corte
    // del mismo universo, y acotarlo a una comuna es exactamente lo que se
    // quiere al llegar desde la Torre.
    comuna: filtroComuna || undefined,
    conductorId: filtroConductor || undefined,
    fuente: filtroFuente || undefined,
    fecha: filtroFecha || undefined,
    fechaDesde: filtroFechaDesde || undefined,
    fechaHasta: filtroFechaHasta || undefined,
  };

  const puedeAsignar = puedeAsignarYReasignarPedidos(sesion.usuario);
  const puedeIncidencias = puedeGestionarIncidencias(sesion.usuario);
  const puedeAjustar = puedeAjustarOperacionDiaria(sesion.usuario);

  const cliente = crearClienteServiceRole();

  // listarPedidos y la lista de sellers para los filtros no dependen entre sí:
  // se cargan en paralelo (antes la lista de sellers esperaba a que terminara
  // la carga de pedidos sin necesidad).
  const [resPedidos, resContadores, sellersDisponibles, conductoresDisponibles] = await Promise.all([
    listarPedidos(cliente, {
      ...filtrosBase,
      estado: filtroEstado || undefined,
      estados: estadosDelGrupo,
      porRevisar: filtroPorRevisar || undefined,
      pagina,
      limite: LIMITE,
    }).then(
      (r) => ({ ok: true as const, datos: r }),
      () => ({ ok: false as const }),
    ),
    // La barra se cae sola si falla: la tabla sigue sirviendo sin cifras arriba.
    contarPedidosPorGrupo(cliente, filtrosBase).then(
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
  const contadores = resContadores.ok ? resContadores.datos : null;
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

  /**
   * Construye una URL de la pantalla conservando todo salvo lo que se pide
   * cambiar. Un solo constructor para la paginación y para los cajones de la
   * barra: cuando eran dos, la paginación olvidaba la comuna y el conductor.
   */
  function hrefCon({
    estado,
    pagina: paginaDestino,
  }: {
    estado?: GrupoEstadoPedido | EstadoPedido | "";
    pagina?: number;
  }): string {
    const sp = new URLSearchParams();
    if (filtroSeller) sp.set("seller", filtroSeller);
    if (filtroComuna) sp.set("comuna", filtroComuna);
    if (filtroConductor) sp.set("conductor", filtroConductor);
    if (filtroFuente) sp.set("fuente", filtroFuente);

    const estadoDestino = estado !== undefined ? estado : grupoActivo || filtroEstado;
    if (estadoDestino) sp.set("estado", estadoDestino);

    // La fecha se conserva SIEMPRE, también en «dirección por revisar». Antes se
    // omitía en esa rama, y por eso ese cajón contaba la historia entera
    // mientras los otros cinco contaban el día.
    if (filtroFecha) {
      sp.set("fecha", filtroFecha);
    } else {
      if (filtroFechaDesde) sp.set("fecha_desde", filtroFechaDesde);
      if (filtroFechaHasta) sp.set("fecha_hasta", filtroFechaHasta);
    }

    if (paginaDestino && paginaDestino > 1) sp.set("pagina", String(paginaDestino));
    const qs = sp.toString();
    return qs ? `/operaciones?${qs}` : "/operaciones";
  }

  const hrefPagina = (p: number) => hrefCon({ pagina: p });

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

      {/* Bloque 1 — Barra de grupos: es el filtro de estado de la pantalla */}
      <nav aria-label="Filtrar por estado" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {GRUPOS_BARRA.map(({ clave, etiqueta, clasesActivo }) => {
          const activo = grupoActivo === clave;
          return (
            <Link
              key={clave}
              href={hrefCon({ estado: activo ? "" : clave })}
              aria-current={activo ? "page" : undefined}
              className={[
                "rounded-lg px-3 py-2 text-left ring-1 transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                activo
                  ? clasesActivo
                  : "bg-card text-card-foreground ring-border hover:bg-accent",
              ].join(" ")}
            >
              <p className="text-lg font-semibold tabular-nums">
                {contadores ? contadores[clave] : "—"}
              </p>
              <p className="text-xs font-medium">{etiqueta}</p>
            </Link>
          );
        })}
      </nav>

      {/* Bloque 2 — Filtros */}
      <FiltrosPedidosForm
        sellers={sellersDisponibles}
        conductores={conductoresDisponibles}
        filtroSeller={filtroSeller}
        filtroEstado={grupoActivo || filtroEstado}
        hoy={hoyIso}
        filtroFecha={filtroFecha}
        filtroFechaDesde={filtroFechaDesde}
        filtroFechaHasta={filtroFechaHasta}
        filtroComuna={filtroComuna}
        filtroConductor={filtroConductor}
        filtroFuente={filtroFuente}
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
          {/* Fuente: era columna propia y ocupaba un ancho fijo para repetir el
              mismo valor en casi todas las filas. Aquí acompaña a la comuna,
              junto al resto de los distintivos de la fila. */}
          <span className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
            {etiquetaFuentePedido(pedido.fuente)}
          </span>
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
