/**
 * Dashboard operativo — el mosaico de magnitudes (tablero B1c).
 *
 * -----------------------------------------------------------------------------
 * QUÉ REEMPLAZA, Y POR QUÉ ERA NECESARIO
 * -----------------------------------------------------------------------------
 * Hasta el 23-08-2026 esta pantalla era una pila de nueve secciones apiladas —
 * banners a ancho completo, KPIs sin denominador, distribución por estado,
 * paquetes por comuna, cortes próximos, analítica financiera y accesos rápidos—
 * heredada de Fase B. El rediseño la reorganiza entera: **ocho magnitudes, cada
 * una enlazando a su listado ya filtrado**, y la tendencia debajo del pliegue.
 *
 * Fue la pantalla que destapó la reconciliación de tableros: su patrón —`mosaico
 * de magnitudes`— nunca entró al checklist de componentes, porque ese checklist
 * enumeraba componentes y esto es una pantalla reorganizada. Ver
 * `docs/diseno/_reconciliacion/02-B1c.md`.
 *
 * -----------------------------------------------------------------------------
 * LAS DOS PREGUNTAS QUE LA PANTALLA CONTESTA
 * -----------------------------------------------------------------------------
 * «¿El día va bien?» y «¿hay algo roto que no me contaron?». De ahí sale todo lo
 * demás: magnitudes con denominador, nada de gráficos sobre el pliegue, y el
 * teñido reservado a las tres cosas que están mal.
 *
 * -----------------------------------------------------------------------------
 * LO QUE SE RETIRÓ, Y NO POR DESCUIDO
 * -----------------------------------------------------------------------------
 * Distribución por estado · paquetes por comuna · cortes próximos · accesos
 * rápidos · la franja de analítica financiera · la banda de la Torre. Decisión
 * del usuario, 23-08-2026. Las magnitudes reemplazan a las dos primeras, la
 * navegación ya hace lo de los accesos, y el enlace a la Torre vive ahora dentro
 * de la tarjeta «en ruta ahora», como lo dibuja el tablero.
 *
 * La ÚNICA excepción declarada al patrón es la franja de folios: no es una
 * magnitud del día, es un bloqueo —sin folios no se emite ninguna factura— y una
 * franja a ancho completo grita más que una tarjeta entre otras siete.
 */

import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  obtenerMetricasDelDia,
  obtenerResumenFinancieroDelMes,
} from "@/modules/operacion/metricas";
import {
  contarConductoresEnRuta,
  obtenerSerieEntregasDiarias,
  type DiaEntregas,
} from "@/modules/operacion/magnitudes-dashboard";
import { obtenerPorPagarConductores } from "@/modules/dinero/magnitudes-dashboard";
import { obtenerFuga } from "@/modules/dinero/analitica";
import { puedeVerReportesEjecutivos } from "@/modules/identidad/capacidades";
import { Button } from "@/components/ui/button";
import { SiguienteAccionTarjeta } from "./siguiente-accion";
import { leerSiguienteAccion } from "./siguiente-accion-datos";
import { Skeleton } from "@/components/ui/skeleton";
import { GraficoBarras } from "@/components/ui/chart";
import {
  MosaicoMagnitudes,
  type Magnitud,
} from "@/components/ui/mosaico-magnitudes";
import { IndicadorEnVivo } from "@/components/tiempo-real/indicador-en-vivo";
import { esIncidenciaSinGestion } from "@/lib/ui/traduccion-estados";
import type { EstadoIncidencia } from "@/modules/operacion/tipos";
import {
  formatearClp,
  formatearFechaLarga,
} from "@/lib/formato-cl";
import { hoyEnSantiago } from "@/lib/fecha-santiago";
import { listarVisitasDelDia } from "@/modules/operacion/retiro/preparacion";
import { obtenerExpectativaDelDia } from "@/modules/operacion/retiro/expectativa";
import { leerTodasLasFilas } from "@/lib/supabase/leer-paginado";
import { contarFoliosDisponibles, nivelFolios } from "@/modules/dinero/folios-disponibles";

// =============================================================================
// Tipos locales
// =============================================================================

interface AlertaFolios {
  foliosRestantes: number;
  folioHasta: number;
  agotado: boolean;
}

interface ConexionCaida {
  /** Nombre del seller, con la cuenta cuando hace falta distinguir cuál cayó. */
  nombre: string;
  /** La última vez que SÍ sincronizó. No es cuándo se cayó — ver la tarjeta. */
  ultimaSyncEn: string | null;
}

interface PulsoIncidencias {
  abiertas: number;
  sinGestionar: number;
  /** Instante en que se abrió la más antigua que sigue abierta. */
  masAntiguaEn: string | null;
}

// =============================================================================
// Carga
// =============================================================================

async function cargarAlertaFolios(tenantId: string): Promise<AlertaFolios | null> {
  const supabase = crearClienteServiceRole();
  // ⚠️ FILTRA POR TIPO DE DOCUMENTO. Antes leía «un CAF vigente cualquiera» con
  // `.limit(1)`, así que con dos CAF cargados podía estar alertando sobre el de
  // notas de crédito (61) mientras el de facturas (33) estaba lleno — o al
  // revés. El 33 es el que detiene la facturación.
  const { data: folios } = await supabase
    .schema("identidad")
    .from("folios_caf")
    .select("folio_actual, folio_hasta, estado")
    .eq("tenant_id", tenantId)
    .eq("estado", "vigente")
    .eq("tipo_documento", 33)
    .order("folio_actual", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!folios) return null;
  // ⚠️ INCLUSIVO, por `contarFoliosDisponibles`. Antes restaba sin el `+1`, así
  // que con `folio_actual === folio_hasta` decía «agotado» quedando un folio
  // que la emisión real sí habría entregado.
  const foliosRestantes = contarFoliosDisponibles({
    folio_actual: folios.folio_actual as number,
    folio_hasta: folios.folio_hasta as number,
  });
  if (nivelFolios(foliosRestantes) === "normal") return null;
  return {
    foliosRestantes,
    folioHasta: folios.folio_hasta as number,
    agotado: foliosRestantes <= 0,
  };
}

/**
 * El pulso de incidencias que necesita la tarjeta: cuántas abiertas, cuántas
 * sin gestionar, y cuánto lleva esperando la más antigua.
 *
 * Se leen TODAS las abiertas y no las diez primeras: la cifra de la tarjeta es
 * un conteo, y contar sobre una página es contar mal.
 */
async function cargarPulsoIncidencias(tenantId: string): Promise<PulsoIncidencias> {
  const cliente = crearClienteServiceRole();
  const filas = await leerTodasLasFilas<{
    estado: EstadoIncidencia;
    abierta_en: string;
  }>(
    "incidencias abiertas",
    (desde, hasta) =>
      cliente
        .schema("operacion")
        .from("incidencias")
        .select("estado, abierta_en")
        .eq("tenant_id", tenantId)
        .in("estado", ["abierta", "en_gestion"])
        .order("abierta_en", { ascending: true })
        .range(desde, hasta),
  );

  return {
    abiertas: filas.length,
    sinGestionar: filas.filter((i) => esIncidenciaSinGestion(i.estado, i.abierta_en)).length,
    masAntiguaEn: filas[0]?.abierta_en ?? null,
  };
}

/**
 * Las conexiones caídas de las DOS fuentes que hoy tienen salud: ML y Shopify.
 *
 * El modelo es 1:N, así que un mismo seller puede aportar varias filas y la
 * clave es la conexión, no el seller. El nombre incluye la cuenta cuando hace
 * falta para saber cuál de las suyas cayó.
 */
async function cargarConexionesCaidas(tenantId: string): Promise<ConexionCaida[]> {
  const cliente = crearClienteServiceRole();
  const [ml, shopify] = await Promise.all([
    cliente
      .schema("identidad")
      .from("conexiones_seller_ml")
      .select(
        "id, seller_id, alias, ml_nickname, ultima_sync_exitosa_en, sellers!conexiones_seller_ml_seller_id_fkey(razon_social)",
      )
      .eq("tenant_id", tenantId)
      .eq("estado_salud", "desvinculada")
      // 🔴 La que apagó el seller a propósito NO es una caída, y este panel es
      // una lista de avisos: mandaría al courier a llamar por teléfono por una
      // decisión de su cliente. Desde el 26-08-2026 el seller puede desconectar
      // sus cuentas desde el portal, así que `desvinculada` ya no implica rota.
      .is("desconectada_por_usuario_id", null),
    // Shopify lo consigue por otra vía: al desconectar se apaga también
    // `activa`, y este filtro ya existía. Misma idea, dos columnas.
    cliente
      .schema("identidad")
      .from("conexiones_seller_shopify")
      .select(
        "id, seller_id, alias, shop_domain, ultima_sync_exitosa_en, sellers!conexiones_seller_shopify_seller_id_fkey(razon_social)",
      )
      .eq("tenant_id", tenantId)
      .eq("estado_salud", "desvinculada")
      .eq("activa", true),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aFila = (row: any, campoCuenta: string): ConexionCaida => {
    const cuenta: string | null = row.alias?.trim() || row[campoCuenta]?.trim() || null;
    const nombreSeller: string = row.sellers?.razon_social ?? row.seller_id;
    return {
      nombre: cuenta ? `${nombreSeller} · ${cuenta}` : nombreSeller,
      ultimaSyncEn: row.ultima_sync_exitosa_en ?? null,
    };
  };

  return [
    ...(ml.data ?? []).map((r) => aFila(r, "ml_nickname")),
    ...(shopify.data ?? []).map((r) => aFila(r, "shop_domain")),
  ];
}

/**
 * Bultos retirados hoy contra los esperados, con las mismas dos funciones que
 * usa Preparación: una sola definición de «retirado» en todo el producto.
 */
async function cargarRetiroDelDia(
  cliente: ReturnType<typeof crearClienteServiceRole>,
  tenantId: string,
): Promise<{ retirados: number; esperados: number }> {
  const fecha = hoyEnSantiago();
  const [visitas, expectativa] = await Promise.all([
    listarVisitasDelDia(cliente, { tenantId, fecha }),
    obtenerExpectativaDelDia(cliente, { tenantId, fecha }),
  ]);
  return {
    retirados: visitas.reduce((acc, v) => acc + v.vivos.total, 0),
    esperados: expectativa.total,
  };
}

/** Degrada un bloque sin llevarse la pantalla entera. */
async function seguro<T>(cargar: () => Promise<T>, siFalla: T): Promise<T> {
  try {
    return await cargar();
  } catch {
    return siFalla;
  }
}

// =============================================================================
// Página
// =============================================================================

export default async function PaginaDashboard() {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");

  if (!puedeVerReportesEjecutivos(sesion.usuario)) {
    redirect("/operaciones");
  }

  const tenantId = sesion.usuario.tenantId;
  // La fecha no necesita base: se pinta en el primer byte, y así el encabezado
  // no parpadea mientras llega el mosaico.
  const hoy = formatearFechaLarga(new Date());

  // §9 de la puesta en marcha v2: sin pedidos reales, el dueño ve UNA acción y
  // no la grilla de KPIs en cero. Los demás roles ven el dashboard de siempre.
  const siguienteAccion =
    sesion.usuario.rol === "dueno"
      ? await leerSiguienteAccion(crearClienteServiceRole(), tenantId)
      : null;
  if (siguienteAccion) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-xl font-semibold sm:text-2xl">Hoy, {hoy}</h1>
        <SiguienteAccionTarjeta accion={siguienteAccion} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-heading text-xl font-semibold sm:text-2xl">
          Hoy, {hoy}
        </h1>
        <IndicadorEnVivo
          tenantId={tenantId}
          tablas={[
            { schema: "operacion", tabla: "pedidos" },
            { schema: "operacion", tabla: "incidencias" },
          ]}
        />
      </div>
      <Suspense fallback={<EsqueletoMosaico />}>
        <SeccionMosaico tenantId={tenantId} />
      </Suspense>
    </div>
  );
}

// =============================================================================
// El mosaico (streamed)
// =============================================================================

async function SeccionMosaico({ tenantId }: { tenantId: string }) {
  const cliente = crearClienteServiceRole();
  const ahora = new Date();

  const [
    metricas,
    financiero,
    conductoresEnRuta,
    porPagar,
    fuga,
    conexiones,
    incidencias,
    alertaFolios,
    serie,
    retiro,
  ] = await Promise.all([
    seguro(() => obtenerMetricasDelDia(cliente, tenantId, ahora), null),
    seguro(() => obtenerResumenFinancieroDelMes(cliente, tenantId, ahora), null),
    seguro(() => contarConductoresEnRuta(cliente, tenantId, ahora), 0),
    seguro(() => obtenerPorPagarConductores(cliente, tenantId), null),
    seguro(
      () =>
        obtenerFuga(cliente, tenantId, {
          desde: `${hoyEnSantiago().slice(0, 7)}-01`,
          hasta: hoyEnSantiago(),
        }),
      null,
    ),
    seguro<ConexionCaida[]>(() => cargarConexionesCaidas(tenantId), []),
    seguro<PulsoIncidencias | null>(() => cargarPulsoIncidencias(tenantId), null),
    seguro<AlertaFolios | null>(() => cargarAlertaFolios(tenantId), null),
    seguro<DiaEntregas[]>(() => obtenerSerieEntregasDiarias(cliente, tenantId, ahora), []),
    seguro(() => cargarRetiroDelDia(cliente, tenantId), null),
  ]);

  if (!metricas) {
    return (
      <div
        role="alert"
        className="border border-attention-line bg-attention-bg px-4 py-3 text-sm text-attention-fg"
      >
        Hubo un error al leer las cifras. Recarga la pantalla.
      </div>
    );
  }

  const entregados =
    (metricas.porEstado["entregado"] ?? 0) + (metricas.porEstado["entregado_manual"] ?? 0);
  const total = metricas.totalPedidos;

  const fugaAbierta =
    fuga?.porTipo.reduce((acc, t) => acc + t.conteoAbierto, 0) ?? 0;

  // 🔴 Rótulo y cifra, nada más. La bajada va SOLO cuando la tarjeta avisa de
  // un problema, y entonces dice qué mirar. Lo demás está a un toque: cada
  // tarjeta enlaza a su listado. (Decisión del usuario, 2026-09-27.)
  const sinAsignar = metricas.porEstado["pendiente_asignacion"] ?? 0;

  const todas: Magnitud[] = [
    {
      // Sin tinte a propósito: a primera hora TODO está sin asignar, y pintarlo
      // sería ruido toda la mañana. La hora de despacho no es un dato del
      // sistema, así que no hay contra qué encenderlo.
      rotulo: "Sin asignar",
      cifra: sinAsignar,
      denominador: total > 0 ? `de ${total}` : undefined,
      href: "/operaciones?estado=pendiente_asignacion",
    },
    {
      rotulo: "Retirados hoy",
      cifra: retiro?.retirados ?? 0,
      denominador: retiro && retiro.esperados > 0 ? `de ${retiro.esperados}` : undefined,
      href: "/preparacion",
    },
    {
      rotulo: "Entregados hoy",
      cifra: entregados,
      denominador: total > 0 ? `de ${total}` : undefined,
      href: "/operaciones?estado=entregado",
      tintaCifra: "balanced",
      etiquetaEnlace: `Entregados hoy: ${entregados} de ${total}. Ver los pedidos entregados`,
    },
    {
      rotulo: "En ruta ahora",
      cifra: metricas.porEstado["en_ruta"] ?? 0,
      denominador:
        conductoresEnRuta > 0
          ? `${conductoresEnRuta} ${conductoresEnRuta === 1 ? "conductor" : "conductores"}`
          : undefined,
      href: "/torre-de-control",
      tintaCifra: "progress",
    },
    {
      rotulo: "Incidencias abiertas",
      cifra: incidencias?.abiertas ?? 0,
      bajada: incidencias?.masAntiguaEn
        ? `La más antigua, hace ${formatearAntiguedad(incidencias.masAntiguaEn, ahora)}`
        : undefined,
      href: "/operaciones/incidencias?estado=abierta",
      // El rojo está reservado a la incidencia abierta, y solo si la hay.
      tono: incidencias && incidencias.abiertas > 0 ? "fault" : undefined,
    },
    {
      rotulo: "Rezagados de ayer",
      cifra: metricas.rezagadosAyer,
      href: "/operaciones?rezagados=ayer",
      tono: metricas.rezagadosAyer > 0 ? "attention" : undefined,
    },
    {
      rotulo: "Por cobrar este mes",
      cifra: formatearClp(financiero?.porCobrarClp ?? 0),
      href: "/dinero/periodos",
      escala: "dinero",
    },
    {
      rotulo: "Por pagar a conductores",
      cifra: formatearClp(porPagar?.montoClp ?? 0),
      href: "/dinero/liquidaciones",
      escala: "dinero",
    },
    {
      rotulo: "Dinero que no cuadra",
      cifra: formatearClp(fuga?.fugaDetectadaClp ?? 0),
      bajada:
        fugaAbierta > 0
          ? `${fugaAbierta} ${fugaAbierta === 1 ? "caso" : "casos"} sin resolver`
          : undefined,
      href: "/dinero/conciliacion",
      escala: "dinero",
      tono: (fuga?.fugaDetectadaClp ?? 0) > 0 ? "fault" : undefined,
    },
    {
      rotulo: "Conexiones caídas",
      cifra: conexiones.length,
      // Nombra la primera: es a quien hay que llamar.
      bajada:
        conexiones.length > 0
          ? conexiones.length === 1
            ? conexiones[0].nombre
            : `${conexiones[0].nombre} y ${conexiones.length - 1} más`
          : undefined,
      href: "/sellers",
      tintaCifra: conexiones.length > 0 ? "attention" : undefined,
    },
  ];

  // 🔴 Las alertas aparecen SOLO cuando hay algo. En un día sano, cuatro
  // tarjetas diciendo «0» eran ruido, y cuando una se enciende destaca de
  // verdad. (Decisión del usuario, 2026-09-27.)
  const hayAlerta: Record<string, boolean> = {
    "Incidencias abiertas": (incidencias?.abiertas ?? 0) > 0,
    "Rezagados de ayer": metricas.rezagadosAyer > 0,
    "Dinero que no cuadra": (fuga?.fugaDetectadaClp ?? 0) > 0,
    "Conexiones caídas": conexiones.length > 0,
  };
  const magnitudes = todas.filter((m) => hayAlerta[m.rotulo] ?? true);

  return (
    <div className="space-y-6">

      {/* La única franja del mosaico, y con motivo: no es una magnitud del día,
          es un bloqueo. Sin folios no se emite ninguna factura. */}
      {alertaFolios ? <FranjaFolios alerta={alertaFolios} /> : null}

      <MosaicoMagnitudes magnitudes={magnitudes} />

      {/* ------------------------------------------------------------------
          Bajo el pliegue. La regla del bloque es dura: ningún gráfico arriba.
          ------------------------------------------------------------------ */}
        <section aria-labelledby="serie-titulo">
          <h2 id="serie-titulo" className="mb-3 font-heading text-base font-semibold">
            Entregas · 14 días
          </h2>
          {serie.length > 0 ? (
              <GraficoBarras
                // El último rótulo lleva su cifra —«hoy · 12»— porque es la
                // única barra que todavía se mueve: quien mira el gráfico a las
                // 17:00 necesita el número, no una barra a media altura que
                // dentro de tres horas será otra.
                datos={serie.map((d, i) => ({
                  dia:
                    i === serie.length - 1
                      ? `hoy · ${d.entregados}`
                      : d.fecha.slice(5),
                  entregados: d.entregados,
                }))}
                series={[{ clave: "entregados", etiqueta: "Entregados" }]}
                ejeCategoria="dia"
                orientacion="vertical"
                destacarUltima
                alto={200}
              />
          ) : (
            <p className="text-sm text-fg-muted">
              Sin entregas en los últimos 14 días.
            </p>
          )}
      </section>
    </div>
  );
}

// =============================================================================
// Piezas
// =============================================================================

function FranjaFolios({ alerta }: { alerta: AlertaFolios }) {
  return (
    <div
      role="alert"
      aria-label={alerta.agotado ? "Sin folios disponibles" : "Folios por agotarse"}
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 border px-4 py-3 text-sm ${
        alerta.agotado
          ? "border-fault-line bg-fault-bg text-fault-fg"
          : "border-attention-line bg-attention-bg text-attention-fg"
      }`}
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 font-medium">
        {alerta.agotado
          ? "Sin folios del SII: la emisión de facturas está detenida."
          : `Te quedan ${alerta.foliosRestantes} ${alerta.foliosRestantes === 1 ? "folio" : "folios"} hasta el ${alerta.folioHasta}.`}
      </span>
      <Button asChild variant="outline" className="min-h-11">
        <Link href="/configuracion/facturacion#folios">Subir CAF</Link>
      </Button>
    </div>
  );
}

/**
 * `35 min` · `4 h 20` · `3 días` — cuánto lleva esperando algo.
 *
 * El tramo de días no es adorno: sin él, una incidencia olvidada dos meses sale
 * como «1802 h 52», que nadie puede leer de un vistazo. Y justamente esa es la
 * que hay que ver.
 */
function formatearAntiguedad(desde: string, ahora: Date): string {
  const minutos = Math.max(
    0,
    Math.floor((ahora.getTime() - new Date(desde).getTime()) / 60_000),
  );
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas >= 48) {
    const dias = Math.floor(horas / 24);
    return `${dias} días`;
  }
  const resto = minutos % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${String(resto).padStart(2, "0")}`;
}

function EsqueletoMosaico() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <Skeleton className="h-5 w-64" />
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:gap-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-[108px] sm:min-w-[200px] sm:grow sm:basis-[calc(25%-0.5625rem)]"
          />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    </div>
  );
}
