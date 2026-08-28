/**
 * Períodos de cobro — el listado desde el que se factura.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ CAMBIÓ, Y NO ES COSMÉTICO
 * -----------------------------------------------------------------------------
 * La pantalla tenía **dos listas del mismo dato**: esta tabla, sin casillas, y
 * el checklist del panel `AprobacionLote` encima. La selección de una no tenía
 * relación con la otra. Ahora hay una sola: casillas en la fila, barra de
 * selección al pie, y la ceremonia —peldaño 3, monto en el título, frase a
 * escribir, preflight consolidado— colgando de ahí.
 *
 * -----------------------------------------------------------------------------
 * EL CAJÓN «CON PROBLEMAS» AHORA FILTRA
 * -----------------------------------------------------------------------------
 * Existía, contaba, y al pulsarlo **limpiaba los filtros**: su `href` era la
 * ruta pelada. Contaba, además, solo los DTE rechazados por el SII. Ahora es un
 * cajón de verdad y cuenta lo que un courier llama un problema: **o el SII lo
 * rechazó, o hay una excepción de conciliación que impide emitir**.
 *
 * Ese cajón cruza los estados —un período facturado puede tener problema— así
 * que la suma de cajones NO da el total, y `BarraCajones` lo declara sola. Es
 * correcto: esconderlo obligaría a elegir entre un cajón útil y una suma que
 * cuadra.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeVerPeriodosCobro } from "@/modules/identidad/capacidades";
import { listarPeriodosCobro, listarDocumentosDte } from "@/modules/dinero/index";
import type { PeriodoCobro, DocumentoDte } from "@/modules/dinero/tipos";
import {
  contarBloqueosDeFacturacion,
  etiquetaPeriodo,
  proximoCierreAutomatico,
} from "@/modules/dinero/listado-periodos";
import { hoyEnSantiago } from "@/lib/fecha-santiago";
import { etiquetaFechaCivilCorta } from "@/lib/ui/rango-fecha";

import { FiltrosPeriodosForm } from "./filtros-periodos";
import { IndicadorFolio } from "@/components/ui/indicador-folio";
import { contarFoliosDisponibles } from "@/modules/dinero/folios-disponibles";
import { TablaPeriodos, type FilaPeriodoVista } from "./tabla-periodos";

export const metadata: Metadata = {
  title: "Períodos de cobro",
};

const LIMITE = 20;

/** Clave del cajón transversal: no es un estado del período. */
const CAJON_PROBLEMAS = "problemas";

interface SearchParams {
  seller?: string;
  estado?: string;
  pagina?: string;
}

interface PeriodoEnriquecido extends PeriodoCobro {
  dte: DocumentoDte | null;
  sellerNombre: string;
  sellerRut: string | null;
  excepcionesBloqueantes: number;
  conProblema: boolean;
}

export default async function PaginaPeriodosCobro({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");
  // 🔴 LECTURA, no emisión. Esta pantalla muestra cuánto le debe cada seller, y
  // eso el courier tiene que poder verlo aunque Rutax le tenga apagada la
  // emisión de facturas. Los botones de emitir siguen pidiendo `emitir_facturas`.
  if (!puedeVerPeriodosCobro(sesion.usuario)) redirect("/dashboard");

  const params = await searchParams;
  const tenantId = sesion.usuario.tenantId;

  const filtroSeller = params.seller ?? "";
  const filtroEstado = params.estado ?? "";
  const pagina = Math.max(1, parseInt(params.pagina ?? "1", 10));

  const cliente = crearClienteServiceRole();

  // El indicador de folios va acá y no solo en el dashboard: **esta es la
  // pantalla desde donde se factura**. Hasta ahora el courier se enteraba de que
  // se estaba quedando sin folios en otra pantalla, o al abrir el modal de
  // emisión — o sea con la ceremonia ya empezada.
  const { data: cafVigente } = await cliente
    .schema("identidad")
    .from("folios_caf")
    .select("folio_actual, folio_hasta")
    .eq("tenant_id", tenantId)
    .eq("estado", "vigente")
    .eq("tipo_documento", 33)
    .order("folio_actual", { ascending: true })
    .limit(1)
    .maybeSingle();
  const foliosRestantes = cafVigente
    ? contarFoliosDisponibles({
        folio_actual: cafVigente.folio_actual as number,
        folio_hasta: cafVigente.folio_hasta as number,
      })
    : null;

  let enriquecidos: PeriodoEnriquecido[] = [];
  let sellersDisponibles: { id: string; nombre: string }[] = [];
  let errorCarga = false;

  try {
    const [{ data: sellersData }, todosPeriodos, todosDte] = await Promise.all([
      cliente
        .from("sellers")
        .select("id, razon_social, rut")
        .eq("tenant_id", tenantId)
        .order("razon_social"),
      listarPeriodosCobro(cliente, tenantId, filtroSeller || undefined),
      listarDocumentosDte(cliente, tenantId, filtroSeller || undefined),
    ]);

    const filasSellers = (sellersData ?? []) as Record<string, unknown>[];
    sellersDisponibles = filasSellers.map((s) => ({
      id: s.id as string,
      nombre: s.razon_social as string,
    }));
    const rutPorSeller = new Map(
      filasSellers.map((s) => [s.id as string, (s.rut as string | null) ?? null]),
    );
    const nombrePorSeller = new Map(sellersDisponibles.map((s) => [s.id, s.nombre]));

    // Solo facturas (33): la nota de crédito (61) comparte periodo_cobro_id
    // con la factura que anula y no debe pisarla en este mapa.
    const dtePorPeriodo = new Map<string, DocumentoDte>(
      todosDte.filter((d) => d.tipoDocumento === 33).map((d) => [d.periodoCobroidId, d]),
    );

    // Las excepciones, en una consulta para todo el conjunto filtrado — no una
    // por fila, y no solo por la página: el cajón «Con problemas» cuenta sobre
    // el conjunto, así que necesita el dato de todos.
    const excepciones = await contarBloqueosDeFacturacion(
      cliente,
      tenantId,
      todosPeriodos.map((p) => ({ id: p.id, sellerId: p.sellerId })),
    );

    enriquecidos = todosPeriodos.map((p) => {
      const dte = dtePorPeriodo.get(p.id) ?? null;
      const bloqueantes = excepciones[p.id] ?? 0;
      const siiEnProblema =
        dte?.estadoSii === "rechazado" || dte?.estadoSii === "aceptado_con_discrepancias";
      return {
        ...p,
        dte,
        sellerNombre: nombrePorSeller.get(p.sellerId) ?? p.sellerId,
        sellerRut: rutPorSeller.get(p.sellerId) ?? null,
        excepcionesBloqueantes: bloqueantes,
        conProblema: bloqueantes > 0 || siiEnProblema,
      };
    });
  } catch {
    errorCarga = true;
  }

  // ── Cajones ──────────────────────────────────────────────────────────────
  // Los contadores van sobre el conjunto filtrado MENOS el filtro de estado,
  // que es justo lo que el cajón elige. Un contador que cuenta la página, o que
  // se recalcula con el cajón puesto, es un contador que miente.
  const conteo = (predicado: (p: PeriodoEnriquecido) => boolean) =>
    enriquecidos.filter(predicado).length;

  const cajones = [
    { clave: "abierto", etiqueta: "Abiertos", conteo: conteo((p) => p.estado === "abierto") },
    { clave: "cerrado", etiqueta: "Cerrados", conteo: conteo((p) => p.estado === "cerrado") },
    { clave: "facturado", etiqueta: "Facturados", conteo: conteo((p) => p.estado === "facturado") },
  ];
  // «Con problemas» CRUZA los estados —un cerrado con excepción y un facturado
  // que el SII rechazó cuentan los dos—, así que no suma con los de arriba: sus
  // filas ya están ahí. Va como transversal y la barra lo declara.
  const cajonTransversal = {
    clave: CAJON_PROBLEMAS,
    etiqueta: "Con problemas",
    conteo: conteo((p) => p.conProblema),
  };
  const cajonExcluido = {
    clave: "anulado",
    etiqueta: "Anulados",
    conteo: conteo((p) => p.estado === "anulado"),
  };

  const visibles =
    filtroEstado === CAJON_PROBLEMAS
      ? enriquecidos.filter((p) => p.conProblema)
      : filtroEstado
        ? enriquecidos.filter((p) => p.estado === filtroEstado)
        : enriquecidos;

  const offset = (pagina - 1) * LIMITE;
  const paginados = visibles.slice(offset, offset + LIMITE);
  const totalPaginas = Math.ceil(visibles.length / LIMITE);

  const filas: FilaPeriodoVista[] = paginados.map((p) => ({
    id: p.id,
    sellerNombre: p.sellerNombre,
    sellerRut: p.sellerRut,
    periodoEtiqueta: etiquetaPeriodo(p.fechaInicio, p.fechaFin),
    fechaInicio: p.fechaInicio,
    fechaFin: p.fechaFin,
    estado: p.estado,
    totalLineas: p.totalLineas,
    montoTotalClp: p.montoTotalClp,
    folio: p.dte?.folio ?? null,
    estadoSii: p.dte?.estadoSii ?? null,
    estadoCobro: p.estadoCobro,
    montoPagadoClp: p.montoPagadoClp,
    excepcionesBloqueantes: p.excepcionesBloqueantes,
    tienePdf: Boolean(p.dte?.pdfRef),
    tieneXml: Boolean(p.dte?.xmlDteRef),
  }));

  // ── La bajada del encabezado ─────────────────────────────────────────────
  const abiertos = enriquecidos.filter((p) => p.estado === "abierto");
  const cierre = proximoCierreAutomatico(abiertos, hoyEnSantiago());
  const sellersConPeriodo = new Set(enriquecidos.map((p) => p.sellerId)).size;

  function urlPagina(n: number) {
    const sp = new URLSearchParams();
    if (filtroSeller) sp.set("seller", filtroSeller);
    if (filtroEstado) sp.set("estado", filtroEstado);
    if (n > 1) sp.set("pagina", String(n));
    const s = sp.toString();
    return `/dinero/periodos${s ? `?${s}` : ""}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold">Períodos de cobro</h1>
          {/* La bajada dice lo que va a pasar solo. El tablero escribe «cierre
              sugerido», pero acá no hay nada que sugerir: el cron corre a las
              02:00 y cierra todo período cuya fecha de fin ya pasó. */}
          {!errorCarga ? (
            <p className="rx-num mt-0.5 text-xs text-fg-muted">
              {sellersConPeriodo} {sellersConPeriodo === 1 ? "seller" : "sellers"}
              {cierre ? (
                cierre.vencido ? (
                  <>
                    {" · "}
                    {cierre.cuantos} {cierre.cuantos === 1 ? "período venció" : "períodos vencieron"}{" "}
                    y cierran en la próxima pasada
                  </>
                ) : (
                  <>
                    {" · "}
                    {cierre.cuantos} {cierre.cuantos === 1 ? "cierra solo" : "cierran solos"} el{" "}
                    {etiquetaFechaCivilCorta(cierre.fecha)}
                  </>
                )
              ) : null}
            </p>
          ) : null}
        </div>
        {foliosRestantes !== null ? (
          <IndicadorFolio
            restantes={foliosRestantes}
            accion={
              <Link
                href="/onboarding/folios"
                className="text-xs font-medium text-accent-text hover:underline"
              >
                Subir un CAF ›
              </Link>
            }
          />
        ) : null}
      </div>

      <FiltrosPeriodosForm
        sellers={sellersDisponibles}
        filtroSeller={filtroSeller}
        hayFiltroActivo={Boolean(filtroSeller || filtroEstado)}
      />

      {errorCarga ? (
        <div
          role="alert"
          className="border border-fault-line bg-fault-bg px-4 py-3.5 text-sm leading-relaxed text-fault-fg"
        >
          <strong className="font-medium">No se pudieron leer los períodos.</strong> No emitas
          nada hasta poder verlos — recarga en unos segundos.
        </div>
      ) : visibles.length === 0 ? (
        <div className="border border-line bg-bg-sunken px-6 py-12 text-center">
          {filtroSeller || filtroEstado ? (
            <>
              <p className="text-fg-muted">Ningún período cae en este filtro.</p>
              <Link
                href="/dinero/periodos"
                className="mt-3 inline-block text-sm font-medium text-accent-text hover:underline"
              >
                Ver todos
              </Link>
            </>
          ) : (
            <p className="text-fg-muted">
              Todavía no hay períodos de cobro. Se abren solos con la primera entrega de cada
              seller.
            </p>
          )}
        </div>
      ) : (
        <>
          <TablaPeriodos
            filas={filas}
            cajones={cajones}
            cajonExcluido={cajonExcluido}
            cajonTransversal={cajonTransversal}
            cajonActivo={filtroEstado || null}
            totalFiltrado={visibles.length}
            puedeCerrar
          />

          {totalPaginas > 1 ? (
            <div className="flex items-center justify-end gap-3 text-sm">
              {pagina > 1 ? (
                <Link href={urlPagina(pagina - 1)} className="text-accent-text hover:underline">
                  Anterior
                </Link>
              ) : null}
              <span className="rx-num text-fg-muted">
                {pagina} / {totalPaginas}
              </span>
              {pagina < totalPaginas ? (
                <Link href={urlPagina(pagina + 1)} className="text-accent-text hover:underline">
                  Siguiente
                </Link>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
