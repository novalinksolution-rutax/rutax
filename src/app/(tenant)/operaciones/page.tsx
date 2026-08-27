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

import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { listarPedidos, contarPedidosPorGrupo } from "@/modules/operacion/pedidos";
import { GRUPOS_ESTADO_PEDIDO } from "@/modules/operacion/tipos";
import type { EstadoPedido, GrupoEstadoPedido } from "@/modules/operacion/tipos";
import {
  puedeAsignarYReasignarPedidos,
  puedeGestionarIncidencias,
  puedeAjustarOperacionDiaria,
} from "@/modules/identidad/capacidades";
import { etiquetaFuentePedido } from "@/lib/ui/etiqueta-fuente-pedido";
import { formatearFechaCivilCorta } from "@/lib/formato-cl";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import { Button } from "@/components/ui/button";
import { obtenerSellersDelTenant, type SellerFiltro } from "@/lib/datos-tenant/sellers";
import { obtenerConductoresDelTenant } from "@/lib/datos-tenant/conductores";

import { BarraCajonesPedidos } from "./barra-cajones-pedidos";
import { FormularioPedidoSameDay } from "./formulario-same-day";
import { FiltrosPedidos } from "./filtros-pedidos";
import { FranjaCambiosEnVivo, IndicadorCambiosEnVivo } from "./cambios-en-vivo";
import { EsqueletoLista, SeccionLista } from "./seccion-lista";
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
  /** "1" = solo los pedidos que ya están en un manifiesto. Cualquier otra cosa, sin filtro. */
  en_manifiesto?: string;
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
  // Binario y sin saneo con lista: cualquier cosa que no sea exactamente "1" es
  // «sin filtro». No hay valor inválido que pueda llegar a la consulta.
  const filtroEnManifiesto = params.en_manifiesto === "1";
  const pagina = sanearNumeroPagina(params.pagina);
  // 100, no 25: el pie del tablero dice «las primeras 100 de 284». Con 25 el
  // coordinador pagina cuatro veces para ver el mismo día, y cada paginación
  // vuelve a golpear la base con el mismo filtro.
  const LIMITE = 100;

  const hayFiltroActivo = !!(
    filtroSeller ||
    filtroEstado ||
    grupoActivo ||
    filtroComuna ||
    filtroConductor ||
    filtroFuente ||
    filtroEnManifiesto ||
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
    // Va en `filtrosBase` y no suelto en el listado: así la barra de cajones
    // cuenta lo mismo que la tabla muestra. Con el filtro puesto, «Sin asignar»
    // pasa a ser 0 — y es correcto: un pedido sin asignar no está en ningún
    // manifiesto.
    enManifiesto: filtroEnManifiesto || undefined,
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
  // ⚠️ **La lista NO se espera acá, y ese es el punto.**
  //
  // Los cajones vienen de otra consulta —más barata— y el tablero pide que
  // carguen primero: el coordinador sabe cuánto hay antes de ver una sola fila.
  // Si esta función esperara las dos, la pantalla entera se quedaría al ritmo de
  // la más lenta y las cifras llegarían junto con las filas, que es justo lo
  // contrario.
  //
  // Así que la promesa de pedidos se crea y **se pasa sin `await`** a
  // `SeccionLista`, que se suspende sola dentro de su `<Suspense>`. La consulta
  // arranca acá igual: no esperarla no la retrasa.
  const promesaPedidos = listarPedidos(cliente, {
    ...filtrosBase,
    estado: filtroEstado || undefined,
    estados: estadosDelGrupo,
    porRevisar: filtroPorRevisar || undefined,
    pagina,
    limite: LIMITE,
  }).then(
    (r) => ({ ok: true as const, datos: r }),
    () => ({ ok: false as const }),
  );

  const [resContadores, sellersDisponibles, conductoresDisponibles] = await Promise.all([
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

  const contadores = resContadores.ok ? resContadores.datos : null;
  const tieneAcciones = puedeAsignar || puedeIncidencias || puedeAjustar;

  // Nombres legibles del seller para la columna (UUID → razón social).
  const nombreSellerPorId = Object.fromEntries(
    sellersDisponibles.map((s) => [s.id, s.nombre]),
  );

  /**
   * Los filtros puestos, dichos como los diría una persona.
   *
   * El copy del vacío es «Estás filtrando por Vega Norte, Maipú y 21-08» — con
   * los **valores**, no con los nombres de los campos. Un mensaje que dijera
   * «estás filtrando por seller, comuna y fecha» obliga a mirar los chips para
   * saber cuáles, que es justo el trabajo que el mensaje viene a ahorrar.
   */
  const filtrosPuestosLegibles = [
    filtroSeller ? (sellersDisponibles.find((x) => x.id === filtroSeller)?.nombre ?? null) : null,
    filtroComuna || null,
    filtroConductor
      ? (conductoresDisponibles.find((x) => x.id === filtroConductor)?.nombre ?? null)
      : null,
    filtroFuente ? etiquetaFuentePedido(filtroFuente) : null,
    filtroFecha ? formatearFechaCivilCorta(filtroFecha) : null,
  ].filter((x): x is string => Boolean(x));

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
    if (filtroEnManifiesto) sp.set("en_manifiesto", "1");

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

  // La exportación lleva **exactamente el filtro que se está mirando**: es la
  // salida del truncamiento, así que exportar otra cosa que lo que está en
  // pantalla sería una trampa.
  const hrefExportar = `/api/operaciones/exportar${hrefCon({}).replace("/operaciones", "")}`;

  return (
    <div className="space-y-6">
      {/* ⚠️ **El encabezado envuelve; no se desborda.**
          Era `flex justify-between` sin `flex-wrap` ni control de encogido, así
          que con el título, el indicador en vivo y dos botones **empujaba el
          ancho por encima del contenedor**: la pantalla entera aparecía con
          desplazamiento horizontal y el indicador quedaba aplastado contra el
          botón. En una consola que se mira en tres anchos distintos, eso no es
          un detalle de un ancho raro: pasaba en la tablet. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="font-heading truncate text-2xl font-semibold">
              {filtroPorRevisar ? "Direcciones por revisar" : "Pedidos"}
            </h1>
            <IndicadorCambiosEnVivo />
          </div>
          {filtroPorRevisar && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Pedidos con dirección no ubicada, fuera de cobertura o sin tarifa de zona. Revísalos antes de rutear.
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* En teléfono, «Incidencias» ya es uno de los cuatro destinos de la
              barra inferior: repetirlo acá le quita el sitio al botón que sí
              solo vive en esta pantalla. */}
          {puedeIncidencias && (
            <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
              <Link href="/operaciones/incidencias">Ver incidencias</Link>
            </Button>
          )}
          {puedeAjustar && (
            <FormularioPedidoSameDay sellers={sellersDisponibles} tenantId={tenantId} />
          )}
        </div>
      </div>

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
        // 🔴 Cuando la consulta de cifras falla, la barra NO dibuja ceros: se
        // queda con lo último que leyó y dice de qué hora es. Ver el comentario
        // largo en `barra-cajones-pedidos.tsx`.
        hayCifras={contadores !== null}
        // La firma ata las cifras recordadas a SU filtro: sin ella, cambiar de
        // seller tras una caída pintaría las cifras del filtro anterior, que
        // parecen ciertas y no lo son.
        firmaFiltro={JSON.stringify(filtrosBase)}
        // El total incluye el excluido y NO el transversal, que ya está contado
        // en los cinco. Sale de los mismos conteos: no hay una consulta más.
        total={
          contadores
            ? CAJONES_QUE_SUMAN.reduce((acc, c) => acc + contadores[c.clave], 0) +
              contadores.cancelado
            : 0
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
      {/* El ancla del botón «Afinar el filtro» del pie de truncamiento. Lleva el
          foco a los chips, que están en esta misma pantalla: es lo único
          honesto que ese botón puede hacer. */}
      <div id="filtros-pedidos" className="scroll-mt-24">
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
        filtroEnManifiesto={filtroEnManifiesto}
        hayFiltroActivo={hayFiltroActivo}
      />

      </div>

      <FranjaCambiosEnVivo />

      {/* ───────────────────────────────────────────────────────────────────
          La lista, que llega después que las cifras.
          ────────────────────────────────────────────────────────────────────
          El esqueleto respeta el alto real de la fila, así que nada salta cuando
          llegan los datos — y **pulsa la opacidad en vez de barrer un brillo**:
          un destello que recorre la pantalla cada segundo y medio, en una
          consola que alguien mira diez horas, cansa.
          ─────────────────────────────────────────────────────────────────── */}
      <Suspense fallback={<EsqueletoLista filas={8} />}>
        <SeccionLista
          promesaPedidos={promesaPedidos}
          cliente={cliente}
          tenantId={tenantId}
          limite={LIMITE}
          pagina={pagina}
          filtrosBase={filtrosBase}
          filtroPorRevisar={filtroPorRevisar}
          hayFiltroActivo={hayFiltroActivo}
          hoyIso={hoyIso}
          filtrosPuestosLegibles={filtrosPuestosLegibles}
          puedeAjustar={puedeAjustar}
          // El MISMO panel que el encabezado, no una segunda forma de crear.
          accionCrearSameDay={
            <FormularioPedidoSameDay sellers={sellersDisponibles} variante="vacio" />
          }
          tieneAcciones={tieneAcciones}
          nombreSellerPorId={nombreSellerPorId}
          hrefPagina={hrefPagina}
          hrefExportar={hrefExportar}
          hrefReintentar={hrefCon({})}
        />
      </Suspense>
    </div>
  );
}
