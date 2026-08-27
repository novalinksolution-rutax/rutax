/**
 * La lista de pedidos: sus cinco estados, sus dos formas y su pie.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTO ES UN COMPONENTE APARTE Y NO PARTE DE `page.tsx`
 * -----------------------------------------------------------------------------
 * Para que **los cajones lleguen antes que las filas**. Vienen de dos consultas
 * distintas y la de cifras es mucho más barata; si las dos se esperaran en el
 * mismo sitio, la pantalla iría al ritmo de la lenta y el coordinador vería los
 * contadores al mismo tiempo que la primera fila — o sea, tarde.
 *
 * `page.tsx` crea la promesa de pedidos y la pasa **sin `await`**. Este
 * componente la espera, así que se suspende él solo dentro de su `<Suspense>`,
 * y mientras tanto arriba ya están las cifras.
 *
 * -----------------------------------------------------------------------------
 * 🔴 EL ORDEN DE LOS ESTADOS ES LA REGLA
 * -----------------------------------------------------------------------------
 * La falla de lectura se pregunta **antes** que cualquier vacío. Una lectura
 * fallida también devuelve cero filas: si se preguntara primero por
 * `pedidos.length === 0`, la pantalla diría «Aún no hay pedidos para hoy», que
 * es afirmar un hecho que no se comprobó. A las 15:50 eso hace que alguien deje
 * de asignar.
 */

import { DataTable } from "@/components/ui/data-table";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { contarPedidosPorGrupo } from "@/modules/operacion/pedidos";
import { mapaNombresConductores } from "@/modules/identidad/consultas";
import type { PaginadoPedidos, TipoIncidencia } from "@/modules/operacion/tipos";
import type { SupabaseClient } from "@supabase/supabase-js";

import { FichaPedidoMovil } from "./ficha-pedido-movil";
import { FilaPedido } from "./fila-pedido";
import { ReportarIdsVisibles } from "./cambios-en-vivo";
import { ListaAtenuable } from "./vista-previa";
import { PieDeTruncamiento } from "./pie-truncamiento";
import {
  FallaDeLectura,
  VacioArranque,
  VacioFiltroSinResultados,
  VacioSinDireccionesPorRevisar,
} from "./estados-pantalla";

/** Nombre visible de la cuenta de origen: alias → nickname de ML → últimos 4. */
function etiquetaCuentaOrigen(alias: string | null, mlNickname: string | null, mlUserId: string | null): string {
  if (alias && alias.trim()) return alias;
  if (mlNickname && mlNickname.trim()) return mlNickname;
  if (mlUserId && mlUserId.length >= 4) return `···${mlUserId.slice(-4)}`;
  return "Otra cuenta";
}

type Resultado = { ok: true; datos: PaginadoPedidos } | { ok: false };

export async function SeccionLista({
  promesaPedidos,
  cliente,
  tenantId,
  limite,
  pagina,
  filtrosBase,
  filtroPorRevisar,
  hayFiltroActivo,
  hoyIso,
  filtrosPuestosLegibles,
  puedeAjustar,
  accionCrearSameDay,
  tieneAcciones,
  nombreSellerPorId,
  hrefPagina,
  hrefExportar,
  hrefReintentar,
}: {
  promesaPedidos: Promise<Resultado>;
  cliente: SupabaseClient;
  tenantId: string;
  limite: number;
  pagina: number;
  filtrosBase: { fecha?: string; fechaDesde?: string; fechaHasta?: string };
  filtroPorRevisar: boolean;
  hayFiltroActivo: boolean;
  /** El día de hoy en Santiago. El copy del vacío habla de «hoy», no del día filtrado. */
  hoyIso: string;
  filtrosPuestosLegibles: string[];
  puedeAjustar: boolean;
  /**
   * El disparador del panel de alta, YA RENDERIZADO — nunca el componente.
   * Pasar una función de componente a través de un límite de servidor tumba en
   * ejecución todo lo que el árbol envuelve, y typecheck y lint lo aprueban.
   */
  accionCrearSameDay?: React.ReactNode;
  tieneAcciones: boolean;
  nombreSellerPorId: Record<string, string>;
  hrefPagina: (p: number) => string;
  hrefExportar: string;
  hrefReintentar: string;
}) {
  const resPedidos = await promesaPedidos;
  const errorCarga = !resPedidos.ok;
  const resultado = resPedidos.ok
    ? resPedidos.datos
    : { datos: [], total: 0, pagina: 1, limite };

  const pedidos = resultado.datos;
  const totalPedidos = resultado.total;
  const totalPaginas = Math.ceil(totalPedidos / limite);

  // El badge de origen (cuenta ML) y los nombres de conductor dependen ambos
  // SOLO de `pedidos`, así que se resuelven en paralelo entre sí (antes eran
  // dos esperas encadenadas). Cada bloque DEVUELVE su mapa — sin reasignar
  // variables externas desde dentro de un closure async.
  const [origenPorPedido, tipoIncidenciaPorPedido, nombreConductorPorId] = await Promise.all([
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

    /**
     * El motivo de las filas que tienen una incidencia viva.
     *
     * ⚠️ **Solo `abierta` y `en_gestion`.** Una incidencia resuelta explica el
     * pasado del pedido, no su presente: ponerla en la columna MOTIVO haría que
     * un pedido ya entregado siguiera diciendo «Destinatario ausente» para
     * siempre.
     *
     * Va acotada a los pedidos de ESTA página —nunca a todo el tenant— y es
     * best-effort: si falla, la columna cae a los distintivos de dirección, que
     * es lo que mostraba antes.
     */
    (async (): Promise<Record<string, TipoIncidencia>> => {
      const mapa: Record<string, TipoIncidencia> = {};
      try {
        const pedidoIds = pedidos.map((p) => p.id);
        if (pedidoIds.length === 0) return mapa;
        const { data } = await cliente
          .schema("operacion")
          .from("incidencias")
          .select("pedido_id, tipo, creado_en")
          .eq("tenant_id", tenantId)
          .in("pedido_id", pedidoIds)
          .in("estado", ["abierta", "en_gestion"])
          .order("creado_en", { ascending: false });
        // La más reciente gana: se recorre en orden descendente y solo se
        // escribe la primera que aparece por pedido.
        for (const fila of (data ?? []) as Array<{ pedido_id: string; tipo: TipoIncidencia }>) {
          if (!(fila.pedido_id in mapa)) mapa[fila.pedido_id] = fila.tipo;
        }
      } catch {
        // best-effort — sin motivo de incidencia si falla.
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
   * Las dos cifras que los vacíos necesitan y que **no se pueden inventar**.
   *
   * El copy del tablero es concreto a propósito —«Hay 284 pedidos hoy fuera de
   * ese filtro», «Última revisión: hoy 16:04»— porque un vacío que solo dice
   * «no hay nada» deja al coordinador sin saber si el problema es el filtro o
   * el día. Ese copy exige dos datos que la consulta principal no trae.
   *
   * Se piden **solo cuando la lista salió vacía**: en el camino normal no cuesta
   * una consulta.
   */
  const datosDelVacio =
    pedidos.length === 0 && !errorCarga
      ? await (async () => {
          const [fueraDelFiltro, ultimaRevision, ubicandose] = await Promise.all([
            /**
             * Cuántos pedidos hay **hoy**, ignorando todo filtro.
             *
             * ⚠️ **Hoy, no el día filtrado**, y la diferencia importa: contando
             * sobre la fecha del filtro, un `?fecha=2027-03-15` daba cero y la
             * cláusula desaparecía — justo cuando más falta hace, porque lo que
             * el coordinador necesita saber es que **sí hay trabajo, pero es de
             * otro día**. El copy dice «hoy» y ahora cuenta hoy.
             */
            hayFiltroActivo || filtroPorRevisar
              ? contarPedidosPorGrupo(cliente, { tenantId, fecha: hoyIso })
                  .then((c) => Object.values(c).reduce((a, b) => a + b, 0))
                  .catch(() => null)
              : Promise.resolve(null),
            // Cuándo se revisó por última vez una dirección. Sale del pedido
            // geocodificado más recientemente: es un hecho, no una estimación.
            filtroPorRevisar
              ? Promise.resolve(
                  cliente
                    .schema("operacion")
                    .from("pedidos")
                    .select("geocodificado_en")
                    .eq("tenant_id", tenantId)
                    .not("geocodificado_en", "is", null)
                    .order("geocodificado_en", { ascending: false })
                    .limit(1)
                    .maybeSingle(),
                ).then(
                  (r) => (r.data?.geocodificado_en as string | null) ?? null,
                  () => null,
                )
              : Promise.resolve(null),
            /**
             * ⚠️ **Cuántas siguen ubicándose.** Sin esta cifra el mensaje miente
             * en el caso más común de la mañana: «por revisar» cuenta las
             * direcciones **con problema**, y a las 09:00 no hay ninguna
             * simplemente porque el geocodificador aún no llegó a ellas.
             *
             * Decir ahí «las 13 direcciones de hoy quedaron ubicadas» es afirmar
             * que una revisión terminó cuando ni siquiera empezó — y es
             * exactamente el estado en que el coordinador cierra la pantalla
             * tranquilo.
             */
            filtroPorRevisar
              ? Promise.resolve(
                  (() => {
                    let q = cliente
                      .schema("operacion")
                      .from("pedidos")
                      .select("id", { count: "exact", head: true })
                      .eq("tenant_id", tenantId)
                      .eq("geo_estado", "pendiente");
                    q = q.eq("fecha_compromiso", filtrosBase.fecha ?? hoyIso);
                    return q;
                  })(),
                ).then(
                  (r) => r.count ?? null,
                  () => null,
                )
              : Promise.resolve(null),
          ]);
          return { fueraDelFiltro, ultimaRevision, ubicandose };
        })()
      : null;


  return (
    <ListaAtenuable>
      <ReportarIdsVisibles ids={pedidos.map((p) => p.id)} />
      {/* ───────────────────────────────────────────────────────────────────
          Bloque 3 · LOS CINCO ESTADOS DE LA PANTALLA
          ────────────────────────────────────────────────────────────────────
          🔴 **La falla de lectura va PRIMERO, antes que cualquier vacío.**

          El orden de estos `if` es la regla: si se preguntara antes por
          `pedidos.length === 0`, una lectura fallida —que también devuelve cero
          filas— caería en el vacío de arranque y la pantalla diría «Aún no hay
          pedidos para hoy». Eso es afirmar un hecho que no se comprobó, y a las
          15:50 hace que alguien deje de asignar.
          ─────────────────────────────────────────────────────────────────── */}
      {errorCarga ? (
        <FallaDeLectura hrefReintentar={hrefReintentar} />
      ) : pedidos.length === 0 ? (
        filtroPorRevisar ? (
          <VacioSinDireccionesPorRevisar
            totalDelDia={datosDelVacio?.fueraDelFiltro ?? null}
            ubicandose={datosDelVacio?.ubicandose ?? null}
            ultimaRevision={datosDelVacio?.ultimaRevision ?? null}
          />
        ) : hayFiltroActivo ? (
          <VacioFiltroSinResultados
            filtrosPuestos={filtrosPuestosLegibles}
            fueraDelFiltro={datosDelVacio?.fueraDelFiltro ?? null}
            hrefLimpiar="/operaciones"
          />
        ) : (
          <VacioArranque accionCrear={puedeAjustar ? accionCrearSameDay : undefined} />
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
              <div className="flex w-full flex-col gap-3">
                {/* El aviso de corte va **encima** de la paginación, no al lado:
                    los números de página se leen como «hay más», pero no dicen
                    cuánto más ni ofrecen salida. */}
                <PieDeTruncamiento
                  mostrados={pedidos.length}
                  total={totalPedidos}
                  hrefExportar={hrefExportar}
                  // Lo ve quien ve la pantalla: la exportación no muestra
                  // nada que la tabla no tenga ya delante.
                  puedeExportar
                />
                <Pagination pagina={pagina} totalPaginas={totalPaginas} hrefPagina={hrefPagina} />
              </div>
            ) : undefined
          }
        >
          {/* ───────────────────────────────────────────────────────────────
              A 390 px la fila deja de ser una fila.
              ────────────────────────────────────────────────────────────────
              Se renderizan **las dos formas** y CSS elige. Podría decidirse en
              JavaScript midiendo el ancho, y sería peor: el servidor no sabe el
              ancho, así que la primera pintura saldría con la forma equivocada y
              cambiaría delante del usuario. El costo es marcado duplicado en el
              HTML, que para cien filas es intrascendente.
              ─────────────────────────────────────────────────────────────── */}
          <div className="border border-line md:hidden">
            {pedidos.map((pedido) => (
              <FichaPedidoMovil
                key={pedido.id}
                pedido={pedido}
                tipoIncidencia={tipoIncidenciaPorPedido[pedido.id] ?? null}
                conductorNombre={
                  pedido.driverIdAsignado
                    ? (nombreConductorPorId[pedido.driverIdAsignado] ?? null)
                    : null
                }
              />
            ))}
          </div>

          <Table densidad="compact" aria-label="Lista de pedidos" className="hidden md:table">
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="px-4">Estado</TableHead>
                <TableHead className="px-4">Destinatario</TableHead>
                {/* ⚠️ **LAS COLUMNAS CAEN EN ORDEN INVERSO A LA CANÓNICA**, y el
                    orden no es una preferencia: procedencia primero, después
                    motivo, después seller y por último fecha. Destinatario y
                    código **no caen nunca**.

                    Los dos anchos dibujados fijan los cortes: a 1024 px —la
                    tablet de pie, en la bodega— quedan tres columnas (estado,
                    destinatario y conductor), y a 1280 vuelven las cuatro. Por
                    debajo de `md` la tabla deja de existir: pasa a fichas.

                    Lo que cae **reaparece bajo el destinatario** en la línea
                    monoespaciada; el sitio donde se decide qué entra ahí es
                    `lineaSecundaria`, compartido con la ficha de teléfono. */}
                <TableHead className="hidden px-4 xl:table-cell">Seller</TableHead>
                <TableHead className="hidden px-4 text-right xl:table-cell">Fecha</TableHead>
                {/* ⚠️ **Origen es columna propia, no un chip bajo el destinatario.**
                    Con tres fuentes conviviendo en la misma bandeja, la procedencia
                    dejó de ser un detalle del pedido y pasó a ser un eje de lectura:
                    «¿cuáles de éstos son de Shopify?» se contesta barriendo una
                    columna, no leyendo cincuenta líneas. */}
                <TableHead className="hidden px-4 xl:table-cell">Origen</TableHead>
                {/* Motivo estaba **en vez de** fecha, y solo en la bandeja de
                    revisión. Ahora conviven: son dos preguntas distintas —cuándo
                    vence y por qué está así— y la fila tiene sitio para las dos. */}
                <TableHead className="hidden px-4 xl:table-cell">Motivo</TableHead>
                {/* Conductor es la única de las cinco que aguanta hasta `md`:
                    a 1024 px sigue en pantalla, como en el dibujo de tablet. */}
                <TableHead className="hidden px-4 md:table-cell">Conductor</TableHead>
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
                  tipoIncidencia={tipoIncidenciaPorPedido[pedido.id] ?? null}
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
    </ListaAtenuable>
  );
}

/**
 * El esqueleto de la lista.
 *
 * ⚠️ **Pulso de opacidad, no brillo que barre.** Un destello que recorre la
 * pantalla cada segundo y medio se nota mucho en una consola que alguien tiene
 * abierta diez horas; el pulso dice lo mismo y no persigue la vista.
 *
 * Las filas van con **el alto real**, así que la página no salta cuando llegan
 * los datos — que es el defecto que un esqueleto viene a evitar y el que casi
 * todos terminan causando.
 */
export function EsqueletoLista({ filas = 8 }: { filas?: number }) {
  return (
    <div className="border border-line" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando los pedidos…</span>
      {Array.from({ length: filas }).map((_, i) => (
        <div
          key={i}
          className="flex h-row-desktop pointer-coarse:h-row-touch items-center gap-3 border-b border-line px-4 last:border-b-0 motion-safe:animate-pulse"
        >
          <Skeleton className="h-5 w-20 shrink-0" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="ml-auto hidden h-4 w-24 md:block" />
        </div>
      ))}
    </div>
  );
}
