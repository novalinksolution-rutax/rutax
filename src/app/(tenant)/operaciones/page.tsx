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
import { etiquetaFuenteCorta, etiquetaFuentePedido } from "@/lib/ui/etiqueta-fuente-pedido";
import { Button } from "@/components/ui/button";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { ChevronRight } from "lucide-react";
import { formatearFechaCorta } from "@/lib/formato-cl";
import { cn } from "@/lib/utils";
import { BarraCajonesPedidos } from "./barra-cajones-pedidos";
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
import { FiltrosPedidos } from "./filtros-pedidos";
import {
  FranjaCambiosEnVivo,
  IndicadorCambiosEnVivo,
  ProveedorCambiosEnVivo,
} from "./cambios-en-vivo";
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
/**
 * Los cajones, con su reparto en tres papeles.
 *
 * ⚠️ **Los cinco de `cajones` son los únicos que suman.** «Por revisar» cruza los
 * cinco —un pedido con la dirección por revisar está además en alguno de ellos—
 * y «cancelado» queda fuera del conjunto operativo. Ver `BarraCajonesPedidos`.
 *
 * Antes eran seis botones con clases escritas a mano (`bg-warning-subtle`,
 * `bg-info-subtle`, `bg-destructive-subtle`): colores del ADN anterior que no
 * pasaban por ningún tono del sistema, y sin declarar nunca que la suma no
 * cuadra con el total.
 */
const CAJONES_QUE_SUMAN = [
  { clave: "pendiente_asignacion", etiqueta: "Sin asignar" },
  { clave: "asignado", etiqueta: "Asignados" },
  { clave: "en_ruta", etiqueta: "En ruta" },
  { clave: "entregado", etiqueta: "Entregados" },
  { clave: "con_problemas", etiqueta: "Con problemas" },
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
    <ProveedorCambiosEnVivo>
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-heading text-2xl font-semibold">
              {filtroPorRevisar ? "Direcciones por revisar" : "Pedidos"}
            </h1>
            <IndicadorCambiosEnVivo tenantId={tenantId} />
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

      {/* Bloque 1 — La barra de cajones: es el filtro de estado de la pantalla */}
      <BarraCajonesPedidos
        cajones={CAJONES_QUE_SUMAN.map(({ clave, etiqueta }) => ({
          clave,
          etiqueta,
          conteo: contadores ? contadores[clave] : 0,
        }))}
        transversal={{
          clave: "por_revisar",
          etiqueta: "Por revisar",
          conteo: contadores?.por_revisar ?? 0,
        }}
        excluido={{
          clave: "cancelado",
          etiqueta: "Cancelados",
          conteo: contadores?.cancelado ?? 0,
        }}
        activo={grupoActivo ?? null}
        // El total incluye el excluido y NO el transversal, que ya está contado
        // en los cinco. Sale de los mismos conteos: no hay una consulta más.
        total={
          contadores
            ? CAJONES_QUE_SUMAN.reduce((acc, c) => acc + contadores[c.clave], 0) +
              contadores.cancelado
            : totalPedidos
        }
        destinos={{
          "": hrefCon({ estado: "" }),
          ...Object.fromEntries(
            [...CAJONES_QUE_SUMAN.map((c) => c.clave), "por_revisar", "cancelado"].map((clave) => [
              clave,
              hrefCon({ estado: clave as GrupoEstadoPedido | EstadoPedido }),
            ]),
          ),
        }}
      />

      {/* Bloque 2 — Filtros */}
      <FiltrosPedidos
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

      <FranjaCambiosEnVivo />

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
                <TableHead className="hidden px-4 text-right md:table-cell">Fecha</TableHead>
                {/* ⚠️ **Origen es columna propia, no un chip bajo el destinatario.**
                    Con tres fuentes conviviendo en la misma bandeja, la procedencia
                    dejó de ser un detalle del pedido y pasó a ser un eje de lectura:
                    «¿cuáles de éstos son de Shopify?» se contesta barriendo una
                    columna, no leyendo cincuenta líneas. */}
                <TableHead className="hidden px-4 md:table-cell">Origen</TableHead>
                {/* Motivo estaba **en vez de** fecha, y solo en la bandeja de
                    revisión. Ahora conviven: son dos preguntas distintas —cuándo
                    vence y por qué está así— y la fila tiene sitio para las dos. */}
                <TableHead className="hidden px-4 lg:table-cell">Motivo</TableHead>
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
    </ProveedorCambiosEnVivo>
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

  /**
   * ⚠️ **La fila cancelada se raya, y no es decoración.**
   *
   * Es el mismo recurso del distintivo fuera de juego aplicado a la fila
   * completa: trama diagonal de fondo y el texto apagado. **Sigue siendo
   * consultable, pero deja de competir** — un pedido cancelado en medio de la
   * lista con el mismo peso visual que uno en ruta se lee como trabajo por
   * hacer, y el coordinador lo mira dos veces cada vez que barre la pantalla.
   *
   * La trama es lo que lo distingue en monocromo y para quien no ve el color;
   * bajarle solo la opacidad no lo lograría.
   */
  const fueraDeJuego = pedido.estado === "cancelado";

  return (
    <TableRow
      // 52 px con el dedo, la densidad normal con el puntero. Va por
      // `pointer-coarse` y no por ancho: un iPad de 1024 px es táctil y un
      // portátil del mismo ancho no. Mismo criterio que la casilla de asignar.
      className={cn(
        "group pointer-coarse:[&>td]:h-row-touch",
        fueraDeJuego && "rx-inert-row text-fg-muted",
      )}
    >
      <TableCell className="px-4">
        <BadgeEstado
          variante={BADGE_ESTADO_PEDIDO[pedido.estado]}
          texto={traducirEstadoPedido(pedido.estado)}
          eje="pedido"
          valor={pedido.estado}
        />
      </TableCell>
      <TableCell className="px-4">
        <Link href={`/operaciones/${pedido.id}`} className="font-medium hover:underline">
          {pedido.destinatarioNombre}
        </Link>
        {/* ⚠️ **Lo que se pierde al caer las columnas se recupera acá, no se
            pierde.** Seller cae en `sm`, fecha en `md` y conductor en `lg`: sin
            esto, en un teléfono el coordinador ve un nombre y una comuna, y para
            saber de qué seller es o cuándo vence tiene que abrir el pedido.
            El **código en monoespaciada** es lo que se dicta por teléfono y lo
            que se busca en un manifiesto impreso; en escritorio vive en la
            página de detalle, pero acá es la única forma de identificar la fila
            sin abrirla. */}
        <div className="flex flex-wrap items-center gap-1 mt-0.5">
          {pedido.codigoInterno && (
            <p className="rx-num font-mono text-xs text-fg-muted">{pedido.codigoInterno}</p>
          )}
          <p className="text-xs text-muted-foreground">{pedido.destinatarioComuna}</p>
          {/* El seller, solo mientras su columna esté escondida. */}
          {sellerNombre && (
            <p className="text-xs text-muted-foreground sm:hidden">· {sellerNombre}</p>
          )}
          {/* La fuente **ya no va acá**: tiene columna propia desde que hay tres
              conviviendo. Repetirla bajo el nombre era decir dos veces lo mismo
              en la fila más apretada de la pantalla. En táctil, donde la columna
              cae, vuelve — ahí sí es la única forma de saberlo. */}
          <span className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground md:hidden">
            {etiquetaFuentePedido(pedido.fuente)}
          </span>
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
      <TableCell className="rx-num hidden px-4 text-right font-mono text-fg-muted md:table-cell">
        {/* `24-08`, no `2026-08-24`: son cincuenta filas de la misma semana y el
            año no distingue ninguna. */}
        {pedido.fechaCompromiso ? formatearFechaCorta(pedido.fechaCompromiso) : "Sin fecha"}
      </TableCell>
      <TableCell className="hidden px-4 md:table-cell">
        <span className="font-mono text-[11px] tracking-[0.06em] text-fg-muted uppercase">
          {etiquetaFuenteCorta(pedido.fuente)}
        </span>
        {/* La cuenta de ML solo si el seller tiene más de una conectada: con una
            sola, repetir su nombre en cada fila no informa de nada. */}
        {origen ? <span className="block text-xs text-fg-subtle">{origen}</span> : null}
      </TableCell>
      <TableCell className="hidden px-4 lg:table-cell">
        <BadgesMotivoGeo pedido={pedido} />
      </TableCell>
      <TableCell className="hidden px-4 text-muted-foreground lg:table-cell">
        {pedido.driverIdAsignado ? (
          (conductorNombre ?? pedido.driverIdAsignado)
        ) : (
          <CeldaSinConductor pedido={pedido} />
        )}
      </TableCell>
      {tieneAcciones && (
        <TableCell className="px-4 text-right">
          {/* Un chevrón, no «Ver detalle». La fila entera ya es un enlace al
              pedido —el nombre del destinatario lo es— así que el texto repetía
              cincuenta veces una instrucción que nadie necesita leer dos veces.
              El glifo dice «acá se entra» y devuelve el ancho a las columnas que
              sí llevan dato. El nombre accesible se conserva entero: para un
              lector de pantalla «›» no significa nada. */}
          <Link
            href={`/operaciones/${pedido.id}`}
            aria-label={`Ver el detalle de ${pedido.destinatarioNombre}`}
            className="inline-flex size-7 items-center justify-center text-fg-muted hover:text-fg"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
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
          eje="geo"
          valor={pedido.geoEstado}
        />
      )}
      {tieneCoberturaProblema && (
        <BadgeEstado
          variante={BADGE_COBERTURA_ESTADO[pedido.coberturaEstado]}
          texto={traducirCoberturaEstado(pedido.coberturaEstado)}
          eje="cobertura"
          valor={pedido.coberturaEstado}
        />
      )}
    </div>
  );
}
