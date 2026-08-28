/**
 * Liquidaciones de conductores — el listado desde el que se paga.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ CAMBIÓ
 * -----------------------------------------------------------------------------
 * Lo mismo que en períodos —una sola lista, con las casillas en la fila y la
 * ceremonia colgando de la barra de selección— más tres cosas propias:
 *
 * 1. **Los chips no navegaban.** Eran `<div role="listitem">`, sin `href` ni
 *    `onClick`: contaban y no filtraban. En períodos sí eran enlaces, o sea que
 *    el mismo patrón se comportaba distinto en dos pantallas del mismo módulo.
 * 2. **Falta el cajón `Pago rechazado`**, aunque el dato ya se cargaba. Una
 *    transferencia que el banco rechazó dejaba la liquidación como `emitida` y
 *    el rechazo se pintaba como un párrafo rojo suelto en la celda de acciones.
 * 3. **La fila mostraba una sola de las dos clases de línea.** Al conductor se
 *    le paga por entregar Y por visitar la bodega del seller; el listado contaba
 *    solo entregas sobre un monto que pagaba las dos.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeVerLiquidaciones } from "@/modules/identidad/capacidades";
import { listarLiquidaciones } from "@/modules/dinero/index";
import type { Liquidacion, EstadoLiquidacion } from "@/modules/dinero/tipos";
import {
  contarComposicionPorLiquidacion,
  frasearRechazoDeBanco,
} from "@/modules/dinero/listado-liquidaciones";
import { etiquetaPeriodo } from "@/modules/dinero/listado-periodos";
import { FiltrosLiquidacionesForm } from "./filtros-liquidaciones";
import { TablaLiquidaciones, type FilaLiquidacionVista } from "./tabla-liquidaciones";

export const metadata: Metadata = {
  title: "Liquidaciones",
};

const ORDEN_ESTADO: Record<EstadoLiquidacion, number> = {
  emitida: 0,
  borrador: 1,
  pagada: 2,
};

/**
 * Estados de payout que importan en la fila: en tránsito o terminal negativo.
 *
 * 🐞 ACÁ HABÍA UN `'procesando'` QUE NO EXISTE en el enum `estado_payout`
 * (`pendiente · enviado · confirmado · rechazado · fallido`). PostgREST rechaza
 * el `.in()` entero con «invalid input value for enum», así que la consulta
 * fallaba SIEMPRE y el mapa de payouts quedaba vacío. Sumado a que la misma
 * consulta ordenaba por una columna inexistente, esta pantalla **nunca mostró
 * un pago en curso, ni uno confirmado, ni un rechazo del banco** — y un pago en
 * tránsito invisible se ve igual que un pago que no existe, así que se podía
 * mandar la transferencia dos veces.
 */
const ESTADOS_PAYOUT_ACTIVOS = [
  "pendiente",
  "enviado",
  "confirmado",
  "rechazado",
  "fallido",
] as const;

type EstadoPayout = (typeof ESTADOS_PAYOUT_ACTIVOS)[number];

/** Clave del cajón transversal: una rechazada sigue siendo `emitida`. */
const CAJON_RECHAZADO = "rechazado";

interface PayoutResumen {
  estado: EstadoPayout;
  errorDescripcion: string | null;
}

interface SearchParams {
  conductor?: string;
  estado?: string;
}

interface LiquidacionEnriquecida extends Liquidacion {
  conductorNombre: string;
  tipoRelacion: string | null;
  payout: PayoutResumen | null;
  entregas: number;
  visitas: number;
  rechazada: boolean;
}

export default async function PaginaLiquidaciones({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion) redirect("/login");
  if (!sesion.usuario.tenantId) redirect("/login");
  // 🔴 LECTURA, no pago. Cuánto se le debe a cada conductor se ve aunque Rutax
  // tenga apagado el pago a conductores.
  if (!puedeVerLiquidaciones(sesion.usuario)) redirect("/dashboard");

  const params = await searchParams;
  const tenantId = sesion.usuario.tenantId;

  const filtroConductor = params.conductor ?? "";
  const filtroEstado = params.estado ?? "";

  const cliente = crearClienteServiceRole();
  let enriquecidas: LiquidacionEnriquecida[] = [];
  let conductoresDisponibles: { id: string; nombre: string }[] = [];
  let bancoConectado: boolean | null = null;
  let errorCarga = false;

  try {
    const [{ data: conductoresData }, todas, { data: configCobranza }] = await Promise.all([
      cliente
        .from("conductores")
        .select("id, nombre_completo, tipo_relacion")
        .eq("tenant_id", tenantId)
        .order("nombre_completo"),
      listarLiquidaciones(cliente, tenantId, filtroConductor || undefined),
      // El gemelo del indicador de folios de períodos: si los pagos van en modo
      // de prueba, las transferencias que se manden desde acá NO salen del
      // banco — y eso hay que saberlo ANTES de seleccionar doce liquidaciones,
      // no después de apretar. Mismas dos condiciones que la fábrica de payout:
      // el opt-in del tenant y sus credenciales guardadas.
      cliente
        .schema("identidad")
        .from("courier_config_payout")
        .select("payout_real_habilitado, credenciales_payout_ref")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);

    const filasConductores = (conductoresData ?? []) as Record<string, unknown>[];
    conductoresDisponibles = filasConductores.map((c) => ({
      id: c.id as string,
      nombre: c.nombre_completo as string,
    }));
    const nombrePorConductor = new Map(conductoresDisponibles.map((c) => [c.id, c.nombre]));
    const relacionPorConductor = new Map(
      filasConductores.map((c) => [c.id as string, (c.tipo_relacion as string | null) ?? null]),
    );

    bancoConectado = configCobranza
      ? Boolean(configCobranza.payout_real_habilitado) &&
        Boolean(configCobranza.credenciales_payout_ref)
      : false;

    // Payout más reciente por liquidación (F19)
    const ids = todas.map((l) => l.id);
    const payoutPorLiquidacion = new Map<string, PayoutResumen>();
    if (ids.length > 0) {
      // 🐞 ACÁ PEDÍA `created_at`, Y LA COLUMNA ES `creado_en`.
      //
      // PostgREST rechaza el `order` por una columna que no existe, así que la
      // consulta devolvía error y `data` en null — y como el error se
      // descartaba al desestructurar, el mapa de payouts quedaba VACÍO siempre.
      // O sea: «Pago en proceso», «Pago confirmado» y el aviso de rechazo del
      // banco **nunca aparecieron en esta pantalla**. Se veía como que no había
      // pagos en curso, que es indistinguible de que no los hubiera.
      //
      // El error ya no se traga: si esta lectura falla, la fila no puede decir
      // si el pago salió, y ofrecer «Emitir pago» sobre eso es peor que fallar.
      const { data: payoutsData, error: errorPayouts } = await cliente
        .schema("dinero")
        .from("payouts_conductor")
        .select("liquidacion_id, estado, error_descripcion, creado_en")
        .eq("tenant_id", tenantId)
        .in("liquidacion_id", ids)
        .in("estado", [...ESTADOS_PAYOUT_ACTIVOS])
        .order("creado_en", { ascending: false });

      if (errorPayouts) {
        throw new Error(`Error al leer los pagos en curso: ${errorPayouts.message}`);
      }

      // Solo el primero por liquidación (ya viene ordenado DESC).
      for (const p of payoutsData ?? []) {
        const liqId = p.liquidacion_id as string;
        if (!payoutPorLiquidacion.has(liqId)) {
          payoutPorLiquidacion.set(liqId, {
            estado: p.estado as EstadoPayout,
            errorDescripcion: (p.error_descripcion as string | null) ?? null,
          });
        }
      }
    }

    const composicion = await contarComposicionPorLiquidacion(cliente, tenantId, ids);

    enriquecidas = todas.map((l) => {
      const payout = payoutPorLiquidacion.get(l.id) ?? null;
      return {
        ...l,
        conductorNombre: nombrePorConductor.get(l.driverId) ?? l.driverId,
        tipoRelacion: relacionPorConductor.get(l.driverId) ?? null,
        payout,
        entregas: composicion[l.id]?.entregas ?? l.totalEntregas,
        visitas: composicion[l.id]?.visitas ?? 0,
        rechazada: payout?.estado === "rechazado" || payout?.estado === "fallido",
      };
    });
  } catch {
    errorCarga = true;
  }

  // ── Cajones ──────────────────────────────────────────────────────────────
  const conteo = (p: (l: LiquidacionEnriquecida) => boolean) => enriquecidas.filter(p).length;

  const cajones = [
    { clave: "borrador", etiqueta: "Borrador", conteo: conteo((l) => l.estado === "borrador") },
    { clave: "emitida", etiqueta: "Emitidas", conteo: conteo((l) => l.estado === "emitida") },
    { clave: "pagada", etiqueta: "Pagadas", conteo: conteo((l) => l.estado === "pagada") },
  ];
  // Cruza los estados: una liquidación con el pago rechazado sigue `emitida`.
  const cajonTransversal = {
    clave: CAJON_RECHAZADO,
    etiqueta: "Pago rechazado",
    conteo: conteo((l) => l.rechazada),
  };

  const visibles =
    filtroEstado === CAJON_RECHAZADO
      ? enriquecidas.filter((l) => l.rechazada)
      : filtroEstado
        ? enriquecidas.filter((l) => l.estado === filtroEstado)
        : enriquecidas;

  const ordenadas = [...visibles].sort((a, b) => {
    const diff = ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado];
    if (diff !== 0) return diff;
    return b.fechaFin.localeCompare(a.fechaFin);
  });

  /** Se puede pagar: emitida y sin un payout en tránsito o ya confirmado. */
  const esPagable = (l: LiquidacionEnriquecida) =>
    l.estado === "emitida" &&
    !(
      l.payout &&
      (l.payout.estado === "pendiente" ||
        l.payout.estado === "enviado" ||
        l.payout.estado === "confirmado")
    );

  const neto = (l: LiquidacionEnriquecida) =>
    (l.montoTotalClp ?? 0) + l.bonoClp - l.penalizacionClp;

  const filas: FilaLiquidacionVista[] = ordenadas.map((l) => ({
    id: l.id,
    driverId: l.driverId,
    conductorNombre: l.conductorNombre,
    tipoRelacion: l.tipoRelacion,
    periodoEtiqueta: etiquetaPeriodo(l.fechaInicio, l.fechaFin),
    fechaInicio: l.fechaInicio,
    fechaFin: l.fechaFin,
    estado: l.estado,
    entregas: l.entregas,
    visitas: l.visitas,
    montoBaseClp: l.montoTotalClp,
    bonoClp: l.bonoClp,
    penalizacionClp: l.penalizacionClp,
    notaAjuste: l.notaAjuste,
    netoClp: neto(l),
    pdfRef: l.pdfRef,
    payoutEstado: l.payout?.estado ?? null,
    rechazoTexto: l.rechazada ? frasearRechazoDeBanco(l.payout?.errorDescripcion ?? null) : null,
    elegiblePago: esPagable(l),
  }));

  const conductoresConLiquidacion = new Set(enriquecidas.map((l) => l.driverId)).size;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold">Liquidaciones de conductores</h1>
          {!errorCarga ? (
            <p className="rx-num mt-0.5 text-xs text-fg-muted">
              {conductoresConLiquidacion}{" "}
              {conductoresConLiquidacion === 1 ? "conductor" : "conductores"}
              {" · "}
              {cajones[1].conteo} por pagar
            </p>
          ) : null}
        </div>
        {/* El gemelo del indicador de folios: sin banco no hay transferencia,
            y descubrirlo con doce liquidaciones seleccionadas es tarde. */}
        {bancoConectado !== null ? (
          <p
            className={
              bancoConectado
                ? "rx-num border border-balanced-line bg-balanced-bg px-2.5 py-1 text-[11px] text-balanced-fg"
                : "rx-num border border-attention-line bg-attention-bg px-2.5 py-1 text-[11px] text-attention-fg"
            }
          >
            {bancoConectado ? (
              "Banco conectado"
            ) : (
              // No dice «sin banco»: dice qué pasa si sigues. Una transferencia
              // en modo de prueba se ve exactamente igual que una real hasta
              // que alguien pregunta por qué el conductor no recibió nada.
              <>
                Los pagos no salen del banco todavía ·{" "}
                <Link href="/configuracion" className="underline">
                  Configurar ›
                </Link>
              </>
            )}
          </p>
        ) : null}
      </div>

      <FiltrosLiquidacionesForm
        conductores={conductoresDisponibles}
        filtroConductor={filtroConductor}
        hayFiltroActivo={Boolean(filtroConductor || filtroEstado)}
      />

      {errorCarga ? (
        <div
          role="alert"
          className="border border-fault-line bg-fault-bg px-4 py-3.5 text-sm leading-relaxed text-fault-fg"
        >
          <strong className="font-medium">No se pudieron leer las liquidaciones.</strong> No
          emitas ningún pago hasta poder verlas — recarga en unos segundos.
        </div>
      ) : enriquecidas.length === 0 ? (
        <div className="border border-line bg-bg-sunken px-6 py-12 text-center">
          <p className="text-fg-muted">
            {filtroConductor
              ? "Este conductor no tiene liquidaciones."
              : "Todavía no hay liquidaciones. Se generan solas con las entregas y las visitas a bodega de cada conductor."}
          </p>
        </div>
      ) : (
        <TablaLiquidaciones
          filas={filas}
          cajones={cajones}
          cajonTransversal={cajonTransversal}
          cajonActivo={filtroEstado || null}
          totalFiltrado={enriquecidas.length}
          autorNombre={sesion.nombreCompleto ?? "Tu cuenta"}
        />
      )}
    </div>
  );
}
