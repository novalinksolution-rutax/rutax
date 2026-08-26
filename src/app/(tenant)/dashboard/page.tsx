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
  obtenerSlaPorSeller,
  type SlaPorSeller,
} from "@/modules/operacion/metricas";
import {
  contarConductoresEnRuta,
  obtenerAsignacionListaEn,
  obtenerComparacionAyerAEstaHora,
  obtenerSerieEntregasDiarias,
  type ComparacionAyer,
  type DiaEntregas,
} from "@/modules/operacion/magnitudes-dashboard";
import { obtenerPorPagarConductores } from "@/modules/dinero/magnitudes-dashboard";
import { obtenerFuga } from "@/modules/dinero/analitica";
import { puedeVerReportesEjecutivos } from "@/modules/identidad/capacidades";
import { WidgetSlaPorSeller } from "./widget-sla";
import { RelojSantiago } from "./encabezado-dashboard";
import { Button } from "@/components/ui/button";
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
  formatearFechaCorta,
  formatearFechaLarga,
  formatearHora,
} from "@/lib/formato-cl";
import { fechaLocalEnSantiago, hoyEnSantiago } from "@/lib/fecha-santiago";
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-heading text-2xl font-semibold">
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
    comparacion,
    porPagar,
    fuga,
    conexiones,
    incidencias,
    alertaFolios,
    asignacionListaEn,
    sla,
    serie,
  ] = await Promise.all([
    seguro(() => obtenerMetricasDelDia(cliente, tenantId, ahora), null),
    seguro(() => obtenerResumenFinancieroDelMes(cliente, tenantId, ahora), null),
    seguro(() => contarConductoresEnRuta(cliente, tenantId, ahora), 0),
    seguro<ComparacionAyer | null>(
      () => obtenerComparacionAyerAEstaHora(cliente, tenantId, ahora),
      null,
    ),
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
    seguro<Date | null>(() => obtenerAsignacionListaEn(cliente, tenantId, ahora), null),
    seguro<SlaPorSeller[]>(() => obtenerSlaPorSeller(cliente, tenantId, ahora, "mes"), []),
    seguro<DiaEntregas[]>(() => obtenerSerieEntregasDiarias(cliente, tenantId, ahora), []),
  ]);

  if (!metricas) {
    return (
      <div
        role="alert"
        className="border border-attention-line bg-attention-bg px-4 py-3 text-sm text-attention-fg"
      >
        No pudimos leer las cifras del día. Los pedidos y el dinero siguen
        accesibles desde la navegación; esta pantalla vuelve sola al recargar.
      </div>
    );
  }

  const entregados =
    (metricas.porEstado["entregado"] ?? 0) + (metricas.porEstado["entregado_manual"] ?? 0);
  const total = metricas.totalPedidos;
  // ⚠️ ENTREGADOS SOBRE EL TOTAL DEL DÍA, no sobre lo que ya cerró. Ver la nota
  // larga en `magnitudes-dashboard.ts`: `metricas.tasaEntrega` responde otra
  // pregunta y a media tarde da 97 % con un cuarto del día hecho.
  const pctDelDia = total > 0 ? Math.round((entregados / total) * 100) : null;

  const fugaAbierta =
    fuga?.porTipo.reduce((acc, t) => acc + t.conteoAbierto, 0) ?? 0;

  const magnitudes: Magnitud[] = [
    {
      rotulo: "Entregados hoy",
      cifra: entregados,
      denominador: total > 0 ? `de ${total}` : "sin pedidos hoy",
      bajada:
        pctDelDia === null
          ? "Aún no hay pedidos para hoy"
          : comparacion
            ? `${pctDelDia} % del día · ayer a esta hora, ${comparacion.pct} %`
            : `${pctDelDia} % del día`,
      href: "/operaciones?estado=entregado",
      tintaCifra: "balanced",
      etiquetaEnlace: `Entregados hoy: ${entregados} de ${total}. Ver los pedidos entregados`,
    },
    {
      rotulo: "En ruta ahora",
      cifra: metricas.porEstado["en_ruta"] ?? 0,
      bajada:
        conductoresEnRuta > 0
          ? `${conductoresEnRuta} ${conductoresEnRuta === 1 ? "conductor" : "conductores"} · ver en la Torre`
          : "Nadie en ruta todavía · ver en la Torre",
      href: "/torre-de-control",
      tintaCifra: "progress",
    },
    {
      rotulo: "Incidencias abiertas",
      cifra: incidencias?.abiertas ?? 0,
      denominador:
        incidencias && incidencias.sinGestionar > 0
          ? `· ${incidencias.sinGestionar} sin gestionar`
          : undefined,
      bajada:
        incidencias?.masAntiguaEn
          ? `La más antigua lleva ${formatearAntiguedad(incidencias.masAntiguaEn, ahora)}`
          : "Nada abierto",
      href: "/operaciones/incidencias?estado=abierta",
      // El rojo está reservado a la incidencia abierta, y solo si la hay.
      tono: incidencias && incidencias.abiertas > 0 ? "fault" : undefined,
    },
    {
      rotulo: "Rezagados de ayer",
      cifra: metricas.rezagadosAyer,
      bajada:
        metricas.rezagadosAyer > 0
          ? `Sin cerrar desde el ${formatearFechaCorta(ayerDe(ahora))}`
          : "Ayer cerró completo",
      href: "/operaciones?rezagados=ayer",
      tono: metricas.rezagadosAyer > 0 ? "attention" : undefined,
    },
    {
      rotulo: "Por cobrar este mes",
      cifra: formatearClp(financiero?.porCobrarClp ?? 0),
      bajada: financiero
        ? `${financiero.periodosConSaldo} ${financiero.periodosConSaldo === 1 ? "período" : "períodos"} con saldo · neto`
        : "Sin datos del mes",
      href: "/dinero/periodos",
      escala: "dinero",
    },
    {
      rotulo: "Por pagar a conductores",
      cifra: formatearClp(porPagar?.montoClp ?? 0),
      bajada: porPagar
        ? porPagar.cantidad === 0
          ? "Nada pendiente"
          : `${porPagar.cantidad} sin pagar · ${porPagar.enBorrador} en borrador`
        : "Sin datos de liquidaciones",
      href: "/dinero/liquidaciones",
      escala: "dinero",
    },
    {
      rotulo: "Dinero que no cuadra",
      cifra: formatearClp(fuga?.fugaDetectadaClp ?? 0),
      bajada:
        fugaAbierta > 0
          ? `${fugaAbierta} de fuga de ingreso, sin resolver`
          : "Todo cuadra este mes",
      href: "/dinero/conciliacion",
      escala: "dinero",
      tono: (fuga?.fugaDetectadaClp ?? 0) > 0 ? "fault" : undefined,
    },
    {
      rotulo: "Conexiones caídas",
      cifra: conexiones.length,
      bajada:
        conexiones.length === 0
          ? "Todas sincronizando"
          : // ⚠️ «Sin sincronizar desde», no «caída desde». El tablero dibuja lo
            // segundo y el dato no existe: no hay columna de cuándo se cayó, solo
            // `ultima_sync_exitosa_en`, que es la última vez que SÍ funcionó.
            // Decir «caída desde el 19-08» sería afirmar algo que no sabemos.
            `${conexiones[0].nombre}${
              conexiones[0].ultimaSyncEn
                ? `, sin sincronizar desde el ${formatearFechaCorta(conexiones[0].ultimaSyncEn)}`
                : ", nunca sincronizó"
            }`,
      href: "/sellers",
      escala: "dinero",
      tintaCifra: conexiones.length > 0 ? "attention" : undefined,
    },
  ];

  return (
    <div className="space-y-6">
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
        <RelojSantiago />
        <span aria-hidden="true">·</span>
        <span>
          {asignacionListaEn
            ? `asignación lista a las ${formatearHora(asignacionListaEn)}`
            : "sin manifiestos confirmados todavía"}
        </span>
      </p>

      {/* La única franja del mosaico, y con motivo: no es una magnitud del día,
          es un bloqueo. Sin folios no se emite ninguna factura. */}
      {alertaFolios ? <FranjaFolios alerta={alertaFolios} /> : null}

      <MosaicoMagnitudes magnitudes={magnitudes} />

      {/* ------------------------------------------------------------------
          Bajo el pliegue. La regla del bloque es dura: ningún gráfico arriba.
          ------------------------------------------------------------------ */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="cumplimiento-titulo">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 id="cumplimiento-titulo" className="font-heading text-base font-semibold">
              Cumplimiento por seller
            </h2>
            <span className="text-xs text-fg-muted">objetivo pactado por seller</span>
          </div>
          <p className="mb-3 text-xs text-fg-muted">
            Este mes, del día 1 a hoy.
          </p>
          <WidgetSlaPorSeller datos={sla} />
          <p className="mt-3 text-xs leading-relaxed text-fg-muted">
            La marca del objetivo es el porcentaje pactado con cada seller.{" "}
            <strong className="font-medium text-fg">«Sin datos» es espera, no
            incumplimiento</strong>: ese seller todavía no ha despachado este mes.
          </p>
        </section>

        <section aria-labelledby="serie-titulo">
          <h2 id="serie-titulo" className="mb-3 font-heading text-base font-semibold">
            Entregas por día · últimos 14
          </h2>
          {serie.length > 0 ? (
            <>
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
              <p className="mt-2 text-xs leading-relaxed text-fg-muted">
                Barra, no línea: son días discretos. Hoy va en tinta porque
                todavía está creciendo y no se compara con un día cerrado.
              </p>
            </>
          ) : (
            <p className="text-sm text-fg-muted">
              Todavía no hay entregas registradas en las últimas dos semanas.
            </p>
          )}
        </section>
      </div>
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
      <span className="font-medium">
        {alerta.agotado
          ? "Sin folios del SII: la emisión de facturas está detenida."
          : `Te quedan ${alerta.foliosRestantes} ${alerta.foliosRestantes === 1 ? "folio" : "folios"} hasta el ${alerta.folioHasta}.`}
      </span>
      <span className="opacity-90">
        {alerta.agotado
          ? "Sube un CAF nuevo para poder volver a facturar."
          : "Sube un CAF nuevo antes de que se agoten."}
      </span>
      <Button asChild size="sm" variant="outline" className="ms-auto">
        <Link href="/onboarding/folios">Subir CAF</Link>
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

/** Ayer en calendario de Santiago, como `Date`, para poder formatearlo. */
function ayerDe(ahora: Date): Date {
  const hoyStr = fechaLocalEnSantiago(ahora);
  const [a, m, d] = hoyStr.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d - 1, 12, 0, 0));
}

function EsqueletoMosaico() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <Skeleton className="h-5 w-64" />
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-[108px] min-w-[200px] grow sm:basis-[calc(25%-0.5625rem)]"
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
