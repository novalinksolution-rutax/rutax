/**
 * «Mis pedidos» — la lista con la que el seller entra al portal.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * LOS CAJONES REEMPLAZAN AL SELECTOR DE NUEVE ESTADOS
 * -----------------------------------------------------------------------------
 * El filtro de estado ofrecía los nueve estados del motor con el vocabulario del
 * courier. El seller no distingue `pendiente_asignacion` de `asignado` —en los
 * dos casos su paquete no salió— y para llegar a «los que tuvieron un problema»
 * tenía que elegir tres veces, una por estado.
 *
 * Ahora son cuatro cajones con su contador (`GRUPOS_PEDIDO_PORTAL`), y
 * `cancelado` va tras el separador porque no pertenece a la suma. La barra
 * declara sola que la suma no da el total.
 *
 * -----------------------------------------------------------------------------
 * EL BUSCADOR, QUE ERA LA ACCIÓN QUE FALTABA
 * -----------------------------------------------------------------------------
 * El seller entra a esta pantalla porque su cliente le escribió por UN pedido.
 * Sin buscador, la única forma de encontrarlo era paginar de a 25 mirando
 * nombres. Busca por código de envío o por destinatario, contra el conjunto
 * completo — no contra la página cargada.
 *
 * -----------------------------------------------------------------------------
 * SE RETIRA LA QUINTA COLUMNA
 * -----------------------------------------------------------------------------
 * Era «Ver detalle» repetido en cada fila más el botón de etiqueta. El nombre
 * del destinatario ya es el enlace, y la etiqueta se imprime desde el detalle y
 * desde la pantalla de recién creado, que son los dos momentos en que se
 * necesita. Una columna entera para decir en cada fila lo que la fila entera ya
 * hace es ruido.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Inbox, SearchX } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { obtenerConexionesPorSeller } from "@/modules/integraciones/ml";
import { BADGE_ESTADO_PEDIDO } from "@/lib/ui/traduccion-estados";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { Button } from "@/components/ui/button";
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
import type { EstadoPedido, Pedido } from "@/modules/operacion/tipos";
import {
  estadoPedidoParaSeller,
  textoLlegada,
  GRUPOS_PEDIDO_PORTAL,
  ETIQUETA_GRUPO_PORTAL,
  normalizarGrupoPortal,
} from "@/lib/ui/vocabulario-portal";
import { FiltrosPedidosSeller } from "./filtros-pedidos-seller";
import { CajonesPedidosSeller, BuscadorPedidosSeller } from "./piezas-listado-seller";
import { PanelCrearSameDay } from "./panel-crear-same-day";
import { ProveedorVistaPreviaSeller, BotonVerPedido } from "./vista-previa-seller";
import { etiquetaFuentePedido } from "@/lib/ui/etiqueta-fuente-pedido";
import { obtenerEstadoAltaSeller } from "./estado-alta-seller";
import { hoyEnSantiago } from "@/lib/fecha-santiago";
import { parsearRangoFecha } from "@/lib/filtros/fecha";

export const metadata: Metadata = {
  title: "Mis pedidos",
};

const LIMITE = 25;

/** Nombre visible de la cuenta de origen: alias → nickname de ML → últimos 4. */
function etiquetaCuentaOrigen(alias: string | null, mlNickname: string | null, mlUserId: string | null): string {
  if (alias && alias.trim()) return alias;
  if (mlNickname && mlNickname.trim()) return mlNickname;
  if (mlUserId && mlUserId.length >= 4) return `···${mlUserId.slice(-4)}`;
  return "Otra cuenta";
}

/**
 * El término de búsqueda, limpio para PostgREST.
 *
 * El texto viaja dentro de `or=(col.ilike.*x*,…)`: una coma, un paréntesis o un
 * asterisco lo parten y la consulta se convierte en otra. Se conservan letras
 * —con tildes y ñ—, dígitos, espacios, guiones y puntos, que es todo lo que
 * puede tener un código de envío o un nombre.
 */
function limpiarBusqueda(bruto: string | undefined): string {
  if (!bruto) return "";
  return bruto
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s.\-]/gu, " ")
    .trim()
    .slice(0, 60);
}

interface SearchParams {
  estado?: string;
  q?: string;
  fecha?: string;
  fecha_desde?: string;
  fecha_hasta?: string;
  pagina?: string;
  nuevo?: string;
}

export default async function PaginaPedidosSeller({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) redirect("/login");
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) redirect("/portal");

  const params = await searchParams;
  const sellerId = sesion.usuario.sellerId;
  // Su hora de corte, para el aviso en línea del formulario de alta.
  const estadoAlta = await obtenerEstadoAltaSeller(sesion.usuario.tenantId, sellerId);
  const tenantId = sesion.usuario.tenantId;
  const pedidoNuevoId = params.nuevo ?? null;

  // El cajón activo. Un `?estado=` con un estado crudo del motor —los enlaces
  // que salen del inicio del portal— se sube a su grupo en vez de perderse.
  const grupoActivo = normalizarGrupoPortal(params.estado);
  const busqueda = limpiarBusqueda(params.q);
  const rangoFecha = parsearRangoFecha({
    exacto: params.fecha,
    desde: params.fecha_desde,
    hasta: params.fecha_hasta,
  });
  const hoyIso = hoyEnSantiago();
  const pagina = Math.max(1, parseInt(params.pagina ?? "1", 10));
  const offset = (pagina - 1) * LIMITE;

  // Badge de origen: solo si el seller tiene MÁS DE UNA cuenta ML conectada.
  // Con una sola cuenta no se muestra nada (cero ruido).
  let mostrarOrigen = false;
  const etiquetaPorCuenta: Record<string, string> = {};
  try {
    const conexiones = await obtenerConexionesPorSeller(sellerId);
    mostrarOrigen = conexiones.length > 1;
    if (mostrarOrigen) {
      for (const c of conexiones) {
        if (c.mlUserId) etiquetaPorCuenta[c.mlUserId] = etiquetaCuentaOrigen(c.alias, c.mlNickname, c.mlUserId);
      }
    }
  } catch {
    // best-effort — sin badge si falla la lectura de conexiones.
  }

  const cliente = crearClienteServiceRole();

  /**
   * La consulta base: el seller, su tenant, y los filtros que NO son el cajón.
   *
   * `head` decide si trae filas o solo el conteo. Es un parámetro y no dos
   * funciones porque así los contadores de los cajones se cuentan **sobre
   * exactamente el mismo conjunto** que la tabla — mismo `select`, mismos
   * filtros—, y no hay forma de que uno cuente algo que el otro no muestra.
   *
   * Los contadores cuentan sobre el conjunto filtrado, nunca sobre la página
   * visible: un contador que cuenta la página es un contador que miente.
   */
  function consultaBase(head: boolean) {
    let q = cliente
      .from("pedidos")
      .select("*", { count: "exact", head })
      .eq("seller_id", sellerId)
      .eq("tenant_id", tenantId);
    if (rangoFecha.exacto) {
      q = q.eq("fecha_compromiso", rangoFecha.exacto);
    } else {
      if (rangoFecha.desde) q = q.gte("fecha_compromiso", rangoFecha.desde);
      if (rangoFecha.hasta) q = q.lte("fecha_compromiso", rangoFecha.hasta);
    }
    if (busqueda) {
      q = q.or(
        [
          `destinatario_nombre.ilike.*${busqueda}*`,
          `codigo_interno.ilike.*${busqueda}*`,
          `ml_shipment_id.ilike.*${busqueda}*`,
          `referencia_externa.ilike.*${busqueda}*`,
        ].join(","),
      );
    }
    return q;
  }

  let pedidos: Pedido[] = [];
  const mlUserPorPedido: Record<string, string | null> = {};
  let total = 0;
  let errorCarga = false;
  const conteos: Record<string, number> = {
    en_camino: 0,
    entregado: 0,
    problema: 0,
    cancelado: 0,
  };

  try {
    let query = consultaBase(false)
      .order("fecha_compromiso", { ascending: false })
      .order("creado_en", { ascending: false })
      .range(offset, offset + LIMITE - 1);
    if (grupoActivo) query = query.in("estado", [...GRUPOS_PEDIDO_PORTAL[grupoActivo]]);

    // Los cuatro contadores y el total, en paralelo con la página. Van en `head`
    // —solo el conteo, sin filas— así que no traen los datos dos veces.
    const [resultado, ...contados] = await Promise.all([
      query,
      ...(Object.keys(GRUPOS_PEDIDO_PORTAL) as (keyof typeof GRUPOS_PEDIDO_PORTAL)[]).map((g) =>
        consultaBase(true).in("estado", [...GRUPOS_PEDIDO_PORTAL[g]]),
      ),
      consultaBase(true),
    ]);

    if (resultado.error) throw resultado.error;

    const claves = Object.keys(GRUPOS_PEDIDO_PORTAL);
    claves.forEach((g, i) => {
      conteos[g] = contados[i]?.count ?? 0;
    });
    // El total de la barra es el del conjunto SIN cajón: si dijera el del cajón
    // activo, «281 de 284» pasaría a «6 de 6» al entrar a «En camino» y la
    // referencia con la que se compara desaparecería justo al usarla.
    total = contados[claves.length]?.count ?? 0;

    pedidos = (resultado.data ?? []).map((p: Record<string, unknown>) => {
      mlUserPorPedido[p.id as string] = (p.ml_user_id as string | null) ?? null;
      return {
      id: p.id as string,
      tenantId: p.tenant_id as string,
      sellerId: p.seller_id as string,
      tipoPedido: p.tipo_pedido as Pedido["tipoPedido"],
      fuente: p.fuente as Pedido["fuente"],
      origen: p.origen as Pedido["origen"],
      idExterno: (p.id_externo as string | null) ?? null,
      referenciaExterna: (p.referencia_externa as string | null) ?? null,
      mlOrderId: (p.ml_order_id as string | null) ?? null,
      mlShipmentId: (p.ml_shipment_id as string | null) ?? null,
      // El código con que el seller identifica su envío. `select("*")` ya lo
      // trae; lo que faltaba era mapearlo.
      codigoInterno: (p.codigo_interno as string | null) ?? null,
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
      // Columnas de geocoding (migración 0013 — F4, ítem 1.1)
      lat: (p.lat as number | null) ?? null,
      long: (p.long as number | null) ?? null,
      geoEstado: ((p.geo_estado as string | null) ?? 'pendiente') as import("@/modules/operacion/tipos").EstadoGeocoding,
      geoConfianza: (p.geo_confianza as number | null) ?? null,
      geocodificadoEn: (p.geocodificado_en as string | null) ?? null,
      coberturaEstado: ((p.cobertura_estado as string | null) ?? 'pendiente') as import("@/modules/operacion/tipos").CoberturaEstado,
      };
    });
  } catch {
    errorCarga = true;
  }

  const enCajon = grupoActivo ? conteos[grupoActivo] : total;
  const hayFiltros = !!(grupoActivo || busqueda || rangoFecha.hayFecha);
  const totalPaginas = Math.ceil(enCajon / LIMITE);

  function urlConFiltros(overrides: Record<string, string>) {
    const sp = new URLSearchParams();
    if (grupoActivo) sp.set("estado", grupoActivo);
    if (busqueda) sp.set("q", busqueda);
    if (rangoFecha.exacto) {
      sp.set("fecha", rangoFecha.exacto);
    } else {
      if (rangoFecha.desde) sp.set("fecha_desde", rangoFecha.desde);
      if (rangoFecha.hasta) sp.set("fecha_hasta", rangoFecha.hasta);
    }
    if (pagina > 1) sp.set("pagina", String(pagina));
    Object.entries(overrides).forEach(([k, v]) => {
      if (v) sp.set(k, v);
      else sp.delete(k);
    });
    const s = sp.toString();
    return `/portal/pedidos${s ? `?${s}` : ""}`;
  }

  return (
    <ProveedorVistaPreviaSeller>
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Mis pedidos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Seguimiento de tus entregas. Los estados se actualizan automáticamente.
          </p>
        </div>
        {/* 🔴 Abre el PANEL, no navega. Llevaba a `/portal/pedidos/nuevo` y
            cargar una pantalla entera —perdiendo de vista la lista que estabas
            mirando— por el gesto que más se repite es la fricción más cara del
            portal. La página sigue existiendo para quien llegue por enlace. */}
        <PanelCrearSameDay estadoSeller={estadoAlta} />
      </div>

      {/* Confirmación de envío creado */}
      {pedidoNuevoId && (
        <div role="status" className="rounded-lg bg-success-subtle px-4 py-3 text-sm text-success-subtle-foreground">
          ¡Envío same-day solicitado con éxito! Quedará pendiente de asignación hasta que el courier lo asigne a un conductor.
        </div>
      )}

      {!errorCarga ? (
        <div className="space-y-3">
          <CajonesPedidosSeller
            cajones={(["en_camino", "entregado", "problema"] as const).map((g) => ({
              clave: g,
              etiqueta: ETIQUETA_GRUPO_PORTAL[g],
              conteo: conteos[g],
            }))}
            excluido={{
              clave: "cancelado",
              etiqueta: ETIQUETA_GRUPO_PORTAL.cancelado,
              conteo: conteos.cancelado,
            }}
            activo={grupoActivo}
            total={total}
          />

          {/* Buscador y fecha en la MISMA línea base. El rótulo «Filtros» va
              al principio, como en el listado del courier, para que la fila se
              lea como un grupo y no como dos controles sueltos. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] font-medium tracking-[0.12em] text-fg-subtle uppercase">
              Filtros
            </span>
            <BuscadorPedidosSeller inicial={busqueda} />
            <FiltrosPedidosSeller
              hoy={hoyIso}
              filtroFecha={rangoFecha.exacto}
              filtroFechaDesde={rangoFecha.desde}
              filtroFechaHasta={rangoFecha.hasta}
              hayFiltros={hayFiltros}
            />
          </div>
        </div>
      ) : null}

      {/* Error */}
      {errorCarga && (
        <div role="alert" className="rounded-lg bg-destructive-subtle px-4 py-3 text-sm text-destructive-subtle-foreground">
          No se pudo cargar la lista de pedidos. Intenta recargar la página.
        </div>
      )}

      {/* Tabla / estados de vista */}
      {!errorCarga && pedidos.length === 0 ? (
        hayFiltros ? (
          <EmptyState
            icon={SearchX}
            tono="filtro"
            titulo={busqueda ? `Nada coincide con «${busqueda}»` : "Ningún pedido coincide"}
            descripcion={
              busqueda
                ? "Prueba con el código completo del envío, o con parte del nombre de quien recibe."
                : "No hay pedidos con estos filtros. Prueba cambiando el cajón o la fecha."
            }
            accion={
              <Button asChild variant="outline" size="sm">
                <Link href="/portal/pedidos">Ver todos mis pedidos</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Inbox}
            titulo="Todavía no tienes pedidos"
            descripcion="Aquí verás tus envíos cuando tu empresa de despacho los registre."
          />
        )
      ) : (
        !errorCarga && (
          <DataTable
            footer={
              totalPaginas > 1 ? (
                <Pagination
                  pagina={pagina}
                  totalPaginas={totalPaginas}
                  hrefPagina={(p) => urlConFiltros({ pagina: String(p) })}
                />
              ) : undefined
            }
          >
            <Table densidad="relaxed" aria-label="Mis pedidos">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="px-4">Estado</TableHead>
                  <TableHead className="px-4">Destinatario</TableHead>
                  <TableHead className="hidden px-4 sm:table-cell">Dirección</TableHead>
                  {/* «Llega» y no «F. compromiso»: es la pregunta con la que el
                      seller entra a esta pantalla, y la respuesta era una fecha
                      ISO cruda impresa tal cual. */}
                  <TableHead className="hidden px-4 md:table-cell">Llega</TableHead>
                  {/* 🔴 De dónde vino el pedido, que antes NO estaba en ninguna
                      parte del listado. El seller vende en varios sitios: sin
                      esto, dos pedidos de tiendas distintas se ven idénticos y
                      hay que abrir cada uno para saber cuál es cuál. */}
                  <TableHead className="hidden px-4 lg:table-cell">De dónde vino</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pedidos.map((pedido) => (
                  <TableRow key={pedido.id}>
                    <TableCell className="px-4 align-top">
                      {/* El idioma del seller: «Nadie recibió», no «Fallido».
                          El TONO no cambia — sale del mismo eje y valor—, solo
                          la palabra. */}
                      <BadgeEstado
                        variante={BADGE_ESTADO_PEDIDO[pedido.estado]} eje="pedido" valor={pedido.estado}
                        texto={estadoPedidoParaSeller(pedido.estado)}
                      />
                    </TableCell>
                    <TableCell className="px-4 align-top whitespace-normal">
                      {/* 🔴 El nombre ABRE EL PANEL, ya no navega. Para mirar
                          «¿ya llegó?» de tres pedidos había que entrar y volver
                          tres veces, perdiendo el filtro y el sitio de la lista
                          cada vez. El detalle sigue a un clic, desde el pie del
                          panel. */}
                      <BotonVerPedido
                        pedidoId={pedido.id}
                        destinatario={pedido.destinatarioNombre}
                      >
                        <span className="font-medium">{pedido.destinatarioNombre}</span>
                      </BotonVerPedido>
                      {/* El código de envío bajo el nombre: es con lo que el
                          seller busca el pedido cuando su cliente le escribe. */}
                      <p className="rx-num text-xs text-fg-muted">
                        {pedido.codigoInterno ?? pedido.mlShipmentId ?? pedido.id.slice(0, 8)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {pedido.destinatarioComuna}
                        {mostrarOrigen && etiquetaPorCuenta[mlUserPorPedido[pedido.id] ?? ""] ? (
                          <span className="text-muted-foreground/80">
                            {" · "}
                            {etiquetaPorCuenta[mlUserPorPedido[pedido.id] ?? ""]}
                          </span>
                        ) : null}
                        {/* En teléfono no hay columna «Llega», y es la mitad de
                            la pregunta. Baja acá en vez de desaparecer. */}
                        <span className="md:hidden">
                          {" · "}
                          {textoLlegada(pedido.fechaCompromiso, hoyIso, pedido.estado)}
                        </span>
                      </p>
                    </TableCell>
                    <TableCell className="hidden px-4 align-top text-muted-foreground sm:table-cell">
                      {pedido.destinatarioDireccion}
                    </TableCell>
                    <TableCell className="hidden px-4 align-top text-muted-foreground md:table-cell">
                      {textoLlegada(pedido.fechaCompromiso, hoyIso, pedido.estado)}
                    </TableCell>
                    {/* De dónde vino: la tienda, y el identificador CON EL QUE
                        EL SELLER LA BUSCA ALLÁ. El de Mercado Libre es el número
                        de venta, no el de envío: es el que aparece en su panel
                        de ventas y el que su comprador le menciona. */}
                    <TableCell className="hidden px-4 align-top lg:table-cell">
                      <span className="text-foreground">{etiquetaFuentePedido(pedido.fuente)}</span>
                      {mostrarOrigen && etiquetaPorCuenta[mlUserPorPedido[pedido.id] ?? ""] && (
                        <span className="block text-xs text-muted-foreground">
                          {etiquetaPorCuenta[mlUserPorPedido[pedido.id] ?? ""]}
                        </span>
                      )}
                      {(pedido.mlOrderId ?? pedido.referenciaExterna ?? pedido.idExterno) && (
                        <span className="rx-num block font-mono text-xs text-muted-foreground">
                          {pedido.mlOrderId ?? pedido.referenciaExterna ?? pedido.idExterno}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
        )
      )}
    </div>
    </ProveedorVistaPreviaSeller>
  );
}
