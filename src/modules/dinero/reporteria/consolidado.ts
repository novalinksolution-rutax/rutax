import type { SupabaseClient } from "@supabase/supabase-js";

import { leerTodasLasFilas } from "@/lib/supabase/leer-paginado";
import { etiquetaFuentePedido } from "@/lib/ui/etiqueta-fuente-pedido";

/**
 * Reportería consolidada — el detalle con el que se paga y se cobra a mano.
 * =============================================================================
 *
 * =============================================================================
 * POR QUÉ EXISTE
 * =============================================================================
 * El piloto arranca **sin DTE y sin pagos automáticos**. Alguien en el courier
 * va a facturarle a cada seller y a pagarle a cada conductor con una planilla y
 * una transferencia, y necesita ver lo mismo que vería una factura: qué se
 * entregó, quién lo entregó, con qué tarifa, y cuánto sale cada lado.
 *
 * El único export que existía traía nueve columnas y la primera era el **UUID
 * del pedido**. Nadie paga con eso: no dice el código de envío, ni el
 * destinatario, ni la comuna, ni el conductor, ni la tarifa.
 *
 * ⚠️ **Esto NO se retira cuando se enciendan la facturación y los pagos.** La
 * reportería es lo que deja auditar al motor: el día que el DTE emita solo, la
 * pregunta «¿por qué me cobraron esto?» se sigue respondiendo acá.
 *
 * =============================================================================
 * UNA FILA POR PEDIDO, CON LOS DOS LADOS
 * =============================================================================
 * Cobro y pago van en la MISMA fila. No es comodidad de lectura: las dos líneas
 * nacen del mismo hecho —una entrega— y verlas juntas es lo que deja notar que
 * falta una. Un pedido con cobro y sin liquidación es plata que se cobró y no
 * se pagó, y separado en dos reportes nadie lo ve.
 *
 * Por eso la fila con un lado faltante **no se esconde ni se filtra**: se marca.
 * Es el hallazgo más caro que este reporte puede entregar.
 *
 * =============================================================================
 * ⚠️ NADA DE UUID EN LA SALIDA
 * =============================================================================
 * Decisión del usuario, y es correcta: un identificador que quien paga no puede
 * cruzar con nada es ruido. Cada pedido se nombra con lo que su contraparte
 * reconoce —el **número de venta de Mercado Libre** en Flex, el **código
 * `RX-…`** en same-day— y nada más.
 *
 * =============================================================================
 * ⚠️ SE CONSULTA POR PARTES: PostgREST NO CRUZA ESQUEMAS
 * =============================================================================
 * `dinero.lineas_*` y `operacion.pedidos` viven en esquemas distintos, así que
 * no hay `embed` posible (PGRST200). Se leen por separado y se cruzan acá.
 * Todas las lecturas van paginadas: PostgREST corta en 1000 filas SIN avisar, y
 * de acá salen los totales con los que alguien transfiere dinero.
 */

export interface FiltrosReporte {
  tenantId: string;
  /** Día inclusive, `YYYY-MM-DD`. */
  desde: string;
  /** Día inclusive, `YYYY-MM-DD`. */
  hasta: string;
  sellerId?: string;
  conductorId?: string;
}

/**
 * Qué le pasa a una fila. `null` cuando los dos lados están vivos.
 *
 * 🔴 **«No existe» y «anulada» NO son lo mismo, y confundirlos costó caro el
 * 2026-08-28.** El reporte decía «Falta el pago» en seis entregas cuyas líneas
 * de liquidación **existían y estaban anuladas**. Se leyó como «el motor no
 * alcanzó a escribirlas» y casi se re-dispara el motor sobre ellas — que habría
 * pasado por encima de seis decisiones que alguien tomó con su nombre y su
 * motivo.
 *
 * Piden respuestas opuestas:
 *   · `sin_*`     → el motor nunca la escribió. Se regenera.
 *   · `*_anulado` → alguien la anuló. Se mira quién y por qué, y regenerarla
 *                   sería deshacer esa decisión por la puerta de atrás.
 */
export type Discrepancia =
  | "sin_cobro"
  | "sin_pago"
  | "cobro_anulado"
  | "pago_anulado"
  | null;

export interface FilaReporte {
  /** El número que la contraparte reconoce. Nunca un UUID. */
  codigo: string;
  /**
   * DE DÓNDE VINO el pedido. Es contra esta fuente que se concilia el cobro, y
   * el valor CRUDO se conserva para poder filtrar y exportar sin depender de
   * cómo se traduzca a texto.
   */
  fuente: string;
  /** La misma fuente en el lenguaje del courier. Una fuente nueva se ve tal cual. */
  fuenteEtiqueta: string;
  /** `flex` | `same_day`. Régimen TARIFARIO, no procedencia. Son ejes distintos. */
  tipo: string;
  fechaHecho: string;
  /**
   * ⚠️ Para ENLAZAR, nunca para mostrar. El usuario fue explícito: nada de UUID
   * en el reporte. Vive en los datos porque el documento por seller se abre con
   * él; no aparece ni en pantalla ni en el CSV, y las columnas exportadas son
   * una lista explícita justamente para que no se cuele por descuido.
   */
  sellerId: string | null;
  sellerNombre: string;
  /** Para emitir el documento. Sin esto hay que abrir otra pantalla por fila. */
  sellerRut: string;
  destinatario: string;
  comuna: string;
  /** Para enlazar el documento del conductor. No se muestra ni se exporta. */
  conductorId: string | null;
  /** `null` si el pedido no llegó a tener conductor asignado. */
  conductorNombre: string | null;
  /** Para la transferencia. `null` cuando no hay conductor. */
  conductorRut: string | null;

  cobroBase: number | null;
  cobroAjuste: number | null;
  cobroFinal: number | null;

  pagoBase: number | null;
  pagoAjuste: number | null;
  pagoFinal: number | null;

  /** Cobro menos pago. `null` si falta un lado — restar contra cero mentiría. */
  margen: number | null;

  /** `true` si algún lado se generó a mano en vez de por el motor. */
  ajustadoAMano: boolean;
  /** Por qué se movió el monto, cuando una incidencia lo movió. */
  motivoAjuste: string | null;
  discrepancia: Discrepancia;
}

/** Una visita a bodega pagada. No cuelga de ningún pedido. */
export interface FilaVisita {
  /** Para enlazar su liquidación. No se muestra ni se exporta. */
  conductorId: string;
  fechaHecho: string;
  conductorNombre: string;
  concepto: string;
  montoFinal: number;
}

export interface TotalPorSeller {
  /** Para enlazar su documento. No se muestra. */
  sellerId: string | null;
  sellerNombre: string;
  entregas: number;
  totalCobro: number;
}

/**
 * Cuánto entró por cada fuente de pedidos.
 *
 * 🔴 Se construye RECORRIENDO las filas, nunca desde una lista fija de fuentes.
 * Es la diferencia entre un reporte que sigue al producto y uno que hay que
 * acordarse de actualizar: el día que entre Falabella —o la que venga después—
 * su fila aparece sola, con su cifra, sin que nadie toque este archivo. Una
 * lista fija haría lo contrario y de la peor forma: la fuente nueva no daría
 * error, simplemente **no se sumaría**, y el total del reporte sería menor que
 * la plata que de verdad se movió.
 */
export interface TotalPorFuente {
  /** Valor crudo — para filtrar y exportar. */
  fuente: string;
  /** Cómo se llama en pantalla. Una fuente sin traducir se muestra tal cual. */
  etiqueta: string;
  entregas: number;
  totalCobro: number;
  totalPago: number;
}

export interface TotalPorConductor {
  /** Para enlazar su liquidación. No se muestra. */
  conductorId: string | null;
  conductorNombre: string;
  entregas: number;
  visitas: number;
  totalEntregas: number;
  totalVisitas: number;
  totalAPagar: number;
}

export interface ReporteConsolidado {
  filas: FilaReporte[];
  visitas: FilaVisita[];
  porSeller: TotalPorSeller[];
  porConductor: TotalPorConductor[];
  porFuente: TotalPorFuente[];
  totalCobro: number;
  totalPago: number;
  /**
   * Cuántas filas tienen un lado que el motor NUNCA escribió. Es la cifra que
   * hay que mirar, y **no incluye las anuladas**: esas no son un hueco, son una
   * decisión con autor. Meterlas acá convertiría el contador en una lista de
   * tareas que no hay que hacer.
   */
  conDiscrepancia: number;
  /** Cuántas filas tienen un lado anulado a mano. Se muestran, no se cuentan arriba. */
  conAnulacion: number;
}

interface FilaCobro {
  pedido_id: string;
  seller_id: string;
  monto_base_clp: number | string;
  ajuste_incidencia_clp: number | string;
  monto_final_clp: number | string;
  fecha_hecho: string;
  origen_generacion: string;
  concepto: string;
  anulada: boolean | null;
}

interface FilaLiquidacion {
  pedido_id: string | null;
  driver_id: string;
  monto_base_clp: number | string;
  ajuste_incidencia_clp: number | string;
  monto_final_clp: number | string;
  fecha_hecho: string;
  origen_generacion: string;
  concepto: string;
  tipo_hecho: string;
  anulada: boolean | null;
}

interface FilaPedido {
  id: string;
  /** Eje AUTORITATIVO de procedencia. No confundir con `tipo_pedido`. */
  fuente: string | null;
  tipo_pedido: string;
  /** El nombre visible del pedido EN SU FUENTE (`#1001` en Shopify). */
  referencia_externa: string | null;
  codigo_interno: string | null;
  ml_order_id: string | null;
  ml_shipment_id: string | null;
  destinatario_nombre: string | null;
  destinatario_comuna: string | null;
}

/**
 * El `select` que se le manda a `operacion.pedidos`, y su guarda.
 * =============================================================================
 *
 * 🔴 **Existe por un bug que llegó a producción el 2026-08-28.** El `select` era
 * un literal suelto y se quedó sin `fuente` ni `referencia_externa` mientras la
 * interfaz `FilaPedido` sí las declaraba. **Nada falló**: PostgREST devolvió
 * filas válidas sin esas columnas, y TypeScript no puede comparar un string de
 * `select` contra un tipo. El resultado en pantalla fue que **todas las filas
 * mostraron «—» como fuente** y el desglose por fuente colapsó en un solo grupo
 * sin sentido — justo la parte recién construida para que Falabella entrara
 * sola. Un dato que falta acá no da error: da un guion.
 *
 * La guarda se hace sobre el LITERAL, que es exactamente lo que viaja a
 * PostgREST — no sobre una lista paralela que podría desincronizarse de él, ni
 * sobre un `join()` dinámico, que además rompe la inferencia del cliente.
 */
const SELECT_PEDIDO =
  "id, fuente, tipo_pedido, referencia_externa, codigo_interno, ml_order_id, ml_shipment_id, destinatario_nombre, destinatario_comuna" as const;

/** Parte un literal por su separador. Es lo que deja leer el `select` como tipo. */
type Partir<S extends string, D extends string> = S extends `${infer A}${D}${infer B}`
  ? [A, ...Partir<B, D>]
  : [S];

/**
 * Si `FilaPedido` gana un campo que el `select` no pide, esto **deja de
 * compilar** y el mensaje nombra el que falta.
 */
type ColumnasFaltantes = Exclude<keyof FilaPedido, Partir<typeof SELECT_PEDIDO, ", ">[number]>;
const _elSelectPideTodoLoQueSeLee: ColumnasFaltantes extends never
  ? true
  : ["Falta pedirle estas columnas a operacion.pedidos:", ColumnasFaltantes] = true;
void _elSelectPideTodoLoQueSeLee;

/** Cuántos ids caben en un `.in()` sin que la URL se vuelva un 414. */
const TAMANO_LOTE_IDS = 100;

const n = (v: number | string | null | undefined): number => Number(v ?? 0);

/**
 * Cómo se nombra un pedido en el reporte.
 * =============================================================================
 *
 * 🔴 **Esto es una CADENA DE PRIORIDAD, no un `switch` por fuente — y esa es
 * toda la diferencia.** Hoy son tres fuentes; Falabella está en construcción y
 * detrás vienen más. Un `switch` obliga a editar este archivo por cada una, y
 * el día que alguien lo olvide la fuente nueva no se rompe: cae al `default` y
 * empieza a mostrar un código que su contraparte no reconoce, en un reporte con
 * el que se cobra. Un fallo así no avisa.
 *
 * ⚠️ **La primera versión de esta función ramificaba por `tipo_pedido`**, que es
 * literalmente el bug que CLAUDE.md advierte no volver a cometer: `tipo_pedido`
 * significa régimen de POD y clave de tarifa, NO procedencia. Con esa versión,
 * un pedido de Falabella —que será `tipo_pedido = 'same_day'`— habría caído en
 * la rama del same-day propio y se habría mostrado con su `RX-…` en vez de con
 * el número que Falabella le muestra al seller.
 *
 * El orden y su porqué:
 *
 *   1. `referencia_externa` — **el caso general y el que hace esto escalable**.
 *      La columna existe justamente para esto: «el nombre VISIBLE del pedido en
 *      su fuente, el que el seller y el courier leen y buscan». Toda fuente
 *      nueva que la pueble entra al reporte **sin tocar una línea de acá**.
 *   2. `ml_order_id` — la excepción, y tiene motivo: Flex es anterior a la
 *      columna y la tiene en NULL. Es el número de VENTA, el que el seller ve
 *      en su panel de Mercado Libre; el del envío no le dice nada.
 *   3. `codigo_interno` (`RX-…`) — el same-day propio, que no viene de ninguna
 *      fuente externa, y el respaldo de cualquier fuente cuyo adaptador aún no
 *      escriba su referencia.
 *   4. `ml_shipment_id` — último recurso antes de rendirse.
 *
 * ⚠️ Nunca el `id`. Es un UUID: decisión del usuario, y es correcta — un
 * identificador que quien paga no puede cruzar con nada es ruido.
 */
export function codigoVisible(p: FilaPedido | undefined): string {
  if (!p) return "—";
  return (
    p.referencia_externa ??
    p.ml_order_id ??
    p.codigo_interno ??
    p.ml_shipment_id ??
    "—"
  );
}

export async function obtenerReporteConsolidado(
  cliente: SupabaseClient,
  filtros: FiltrosReporte,
): Promise<ReporteConsolidado> {
  const { tenantId, desde, hasta } = filtros;

  // --- 1. Los dos lados del dinero, en el rango -----------------------------
  const [cobros, liquidaciones] = await Promise.all([
    leerTodasLasFilas<FilaCobro>("reporte · líneas de cobro", (d, h) => {
      let q = cliente
        .schema("dinero")
        .from("lineas_cobro")
        .select(
          "pedido_id, seller_id, monto_base_clp, ajuste_incidencia_clp, monto_final_clp, fecha_hecho, origen_generacion, concepto, anulada",
        )
        .eq("tenant_id", tenantId)
        .gte("fecha_hecho", desde)
        .lte("fecha_hecho", hasta);
      if (filtros.sellerId) q = q.eq("seller_id", filtros.sellerId);
      return q.range(d, h);
    }),
    leerTodasLasFilas<FilaLiquidacion>("reporte · líneas de liquidación", (d, h) => {
      let q = cliente
        .schema("dinero")
        .from("lineas_liquidacion")
        .select(
          "pedido_id, driver_id, monto_base_clp, ajuste_incidencia_clp, monto_final_clp, fecha_hecho, origen_generacion, concepto, tipo_hecho, anulada",
        )
        .eq("tenant_id", tenantId)
        .gte("fecha_hecho", desde)
        .lte("fecha_hecho", hasta);
      if (filtros.conductorId) q = q.eq("driver_id", filtros.conductorId);
      return q.range(d, h);
    }),
  ]);

  // Las anuladas no se cuentan ni se muestran: una línea anulada es un hecho
  // que se deshizo —un fallido que después se devolvió—, y sumarla cobraría o
  // pagaría dos veces.
  const cobrosVivos = cobros.filter((c) => c.anulada !== true);
  const liqVivas = liquidaciones.filter((l) => l.anulada !== true);

  // Las anuladas NO entran a los totales —una línea anulada no es plata que se
  // deba— pero sí hay que saber que existen: es la diferencia entre «el motor no
  // la escribió» y «alguien la anuló».
  const pedidosConCobroAnulado = new Set(
    cobros.filter((c) => c.anulada === true).map((c) => c.pedido_id),
  );
  const pedidosConPagoAnulado = new Set(
    liquidaciones
      .filter((l) => l.anulada === true && l.pedido_id)
      .map((l) => l.pedido_id as string),
  );

  const entregasLiq = liqVivas.filter((l) => l.tipo_hecho !== "retiro_bodega");
  const visitasLiq = liqVivas.filter((l) => l.tipo_hecho === "retiro_bodega");

  // --- 2. Los pedidos de esas líneas, para poder nombrarlas -----------------
  const pedidoIds = [
    ...new Set([
      ...cobrosVivos.map((c) => c.pedido_id),
      ...entregasLiq.map((l) => l.pedido_id).filter((x): x is string => x !== null),
    ]),
  ];

  // ⚠️ Por LOTES de ids, no con un `.in()` de mil UUID. Ese `.in()` construye
  // una URL enorme y el servidor la rechaza con `414 URI too long` — ya mordió
  // en este repo. Y el troceado va explícito y no colgado del paginador de
  // filas: son dos cosas distintas y mezclarlas se lee como un accidente.
  const pedidos: FilaPedido[] = [];
  for (let i = 0; i < pedidoIds.length; i += TAMANO_LOTE_IDS) {
    const lote = pedidoIds.slice(i, i + TAMANO_LOTE_IDS);
    const { data, error } = await cliente
      .schema("operacion")
      .from("pedidos")
      .select(
        SELECT_PEDIDO,
      )
      .eq("tenant_id", tenantId)
      .in("id", lote);
    if (error) {
      throw new Error(`Error al leer los pedidos del reporte: ${error.message}`);
    }
    pedidos.push(...((data ?? []) as FilaPedido[]));
  }

  // El RUT entra porque es lo que se usa para EMITIR y para TRANSFERIR. Un
  // reporte de pagos sin RUT obliga a abrir otra pantalla por cada fila.
  const [sellers, conductores] = await Promise.all([
    leerTodasLasFilas<{ id: string; razon_social: string; rut: string }>(
      "reporte · sellers",
      (d, h) =>
        cliente
          .schema("identidad")
          .from("sellers")
          .select("id, razon_social, rut")
          .eq("tenant_id", tenantId)
          .range(d, h),
    ),
    leerTodasLasFilas<{ id: string; nombre_completo: string; rut: string }>(
      "reporte · conductores",
      (d, h) =>
        cliente
          .schema("identidad")
          .from("conductores")
          .select("id, nombre_completo, rut")
          .eq("tenant_id", tenantId)
          .range(d, h),
    ),
  ]);

  const pedidoPorId = new Map(pedidos.map((p) => [p.id, p]));
  const sellerPorId = new Map(sellers.map((s) => [s.id, s]));
  const conductorPorId = new Map(conductores.map((c) => [c.id, c]));
  const cobroPorPedido = new Map(cobrosVivos.map((c) => [c.pedido_id, c]));
  const liqPorPedido = new Map(
    entregasLiq.filter((l) => l.pedido_id).map((l) => [l.pedido_id as string, l]),
  );

  // --- 3. Una fila por pedido, con los dos lados ---------------------------
  const filas: FilaReporte[] = pedidoIds.map((id) => {
    const p = pedidoPorId.get(id);
    const c = cobroPorPedido.get(id);
    const l = liqPorPedido.get(id);

    const cobroFinal = c ? n(c.monto_final_clp) : null;
    const pagoFinal = l ? n(l.monto_final_clp) : null;

    return {
      codigo: codigoVisible(p),
      fuente: p?.fuente ?? "—",
      fuenteEtiqueta: etiquetaFuentePedido(p?.fuente),
      tipo: p?.tipo_pedido ?? "—",
      fechaHecho: c?.fecha_hecho ?? l?.fecha_hecho ?? "",
      sellerId: c?.seller_id ?? null,
      sellerNombre: c ? (sellerPorId.get(c.seller_id)?.razon_social ?? "—") : "—",
      sellerRut: c ? (sellerPorId.get(c.seller_id)?.rut ?? "—") : "—",
      destinatario: p?.destinatario_nombre ?? "—",
      comuna: p?.destinatario_comuna ?? "—",
      conductorId: l?.driver_id ?? null,
      conductorNombre: l ? (conductorPorId.get(l.driver_id)?.nombre_completo ?? "—") : null,
      conductorRut: l ? (conductorPorId.get(l.driver_id)?.rut ?? "—") : null,

      cobroBase: c ? n(c.monto_base_clp) : null,
      cobroAjuste: c ? n(c.ajuste_incidencia_clp) : null,
      cobroFinal,

      pagoBase: l ? n(l.monto_base_clp) : null,
      pagoAjuste: l ? n(l.ajuste_incidencia_clp) : null,
      pagoFinal,

      // Solo hay margen cuando existen los dos lados. Restar contra cero diría
      // «ganamos $3.000» cuando en realidad falta pagarle a alguien.
      margen: cobroFinal !== null && pagoFinal !== null ? cobroFinal - pagoFinal : null,

      ajustadoAMano:
        c?.origen_generacion === "ajuste_manual" || l?.origen_generacion === "ajuste_manual",
      motivoAjuste:
        (c && n(c.ajuste_incidencia_clp) !== 0) || (l && n(l.ajuste_incidencia_clp) !== 0)
          ? (c?.concepto ?? l?.concepto ?? null)
          : null,
      discrepancia: !c
        ? pedidosConCobroAnulado.has(id)
          ? "cobro_anulado"
          : "sin_cobro"
        : !l
          ? pedidosConPagoAnulado.has(id)
            ? "pago_anulado"
            : "sin_pago"
          : null,
    };
  });

  filas.sort((a, b) => a.fechaHecho.localeCompare(b.fechaHecho) || a.codigo.localeCompare(b.codigo));

  // --- 4. Las visitas a bodega, que se pagan aparte ------------------------
  const visitas: FilaVisita[] = visitasLiq
    .map((v) => ({
      conductorId: v.driver_id,
      fechaHecho: v.fecha_hecho,
      conductorNombre: conductorPorId.get(v.driver_id)?.nombre_completo ?? "—",
      concepto: v.concepto,
      montoFinal: n(v.monto_final_clp),
    }))
    .sort((a, b) => a.fechaHecho.localeCompare(b.fechaHecho));

  // --- 5. Totales, que es con lo que se transfiere -------------------------
  const porSeller = new Map<string, TotalPorSeller>();
  for (const f of filas) {
    if (f.cobroFinal === null) continue;
    const t = porSeller.get(f.sellerNombre) ?? {
      sellerId: f.sellerId,
      sellerNombre: f.sellerNombre,
      entregas: 0,
      totalCobro: 0,
    };
    t.entregas += 1;
    t.totalCobro += f.cobroFinal;
    porSeller.set(f.sellerNombre, t);
  }

  // Por FUENTE. Se recorre lo que hay; no se pregunta por fuentes conocidas.
  const porFuente = new Map<string, TotalPorFuente>();
  for (const f of filas) {
    const t = porFuente.get(f.fuente) ?? {
      fuente: f.fuente,
      etiqueta: f.fuenteEtiqueta,
      entregas: 0,
      totalCobro: 0,
      totalPago: 0,
    };
    t.entregas += 1;
    t.totalCobro += f.cobroFinal ?? 0;
    t.totalPago += f.pagoFinal ?? 0;
    porFuente.set(f.fuente, t);
  }

  const porConductor = new Map<string, TotalPorConductor>();
  const paraConductor = (id: string | null, nombre: string): TotalPorConductor => {
    const t = porConductor.get(nombre) ?? {
      conductorId: id,
      conductorNombre: nombre,
      entregas: 0,
      visitas: 0,
      totalEntregas: 0,
      totalVisitas: 0,
      totalAPagar: 0,
    };
    porConductor.set(nombre, t);
    return t;
  };

  for (const f of filas) {
    if (f.pagoFinal === null || !f.conductorNombre) continue;
    const t = paraConductor(f.conductorId, f.conductorNombre);
    t.entregas += 1;
    t.totalEntregas += f.pagoFinal;
    t.totalAPagar += f.pagoFinal;
  }
  for (const v of visitas) {
    const t = paraConductor(v.conductorId, v.conductorNombre);
    t.visitas += 1;
    t.totalVisitas += v.montoFinal;
    t.totalAPagar += v.montoFinal;
  }

  return {
    filas,
    visitas,
    porSeller: [...porSeller.values()].sort((a, b) => b.totalCobro - a.totalCobro),
    porConductor: [...porConductor.values()].sort((a, b) => b.totalAPagar - a.totalAPagar),
    porFuente: [...porFuente.values()].sort((a, b) => b.entregas - a.entregas),
    totalCobro: filas.reduce((s, f) => s + (f.cobroFinal ?? 0), 0),
    totalPago:
      filas.reduce((s, f) => s + (f.pagoFinal ?? 0), 0) +
      visitas.reduce((s, v) => s + v.montoFinal, 0),
    // Solo lo que el motor no escribió. Lo anulado va aparte: no es un hueco.
    conDiscrepancia: filas.filter(
      (f) => f.discrepancia === "sin_cobro" || f.discrepancia === "sin_pago",
    ).length,
    conAnulacion: filas.filter(
      (f) => f.discrepancia === "cobro_anulado" || f.discrepancia === "pago_anulado",
    ).length,
  };
}
