/**
 * Lo que muestra la vista previa de un período de cobro.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ RESPONDE, Y POR QUÉ NO ES UN RESUMEN DE LA FILA
 * -----------------------------------------------------------------------------
 * La fila del listado ya dice seller, estado, líneas y neto. Repetir eso en un
 * panel no vale el gesto de abrirlo. Lo que trae este lector es lo que la fila
 * **no puede** tener y que uno va a buscar al detalle:
 *
 * · **el neto sumado desde las líneas**, contra el guardado en el período. Son
 *   dos números y pueden discrepar: `periodos_cobro.monto_total_clp` se escribe
 *   al cerrar y NO se vuelve a tocar aunque después se anule una línea. Cuando
 *   discrepan, el panel lo dice — es la clase de descuadre que si no se ve acá
 *   aparece cuando el seller reclama la factura;
 * · **de qué se compone**: cuántas líneas llevan ajuste por incidencia y cuánto
 *   suman, y el corte por régimen (Flex / same-day);
 * · **cuántas se anularon**, que es lo que explica la discrepancia de arriba;
 * · **qué lo bloquea**, con la cifra de excepciones de conciliación.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL AISLAMIENTO SE IMPONE ACÁ, EN CADA CONSULTA
 * -----------------------------------------------------------------------------
 * Se llama con `service_role` desde una Server Action, así que RLS no protege
 * nada: **cada consulta filtra por `tenant_id`**, y el período se lee con su id
 * Y su tenant. Un id que no es del tenant devuelve `null`, no un error — desde
 * afuera, «no existe» y «no es tuyo» tienen que ser indistinguibles.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { leerTodasLasFilas } from "@/lib/supabase/leer-paginado";
import { contarBloqueosDeFacturacion } from "./listado-periodos";
import type { EstadoPeriodo, EstadoCobroPeriodo, DocumentoDte } from "./tipos";

export interface VistaPreviaPeriodo {
  id: string;
  sellerId: string;
  sellerNombre: string;
  sellerRut: string | null;
  fechaInicio: string;
  fechaFin: string;
  estado: EstadoPeriodo;

  /** Líneas vigentes (no anuladas) y lo que suman. */
  lineasVigentes: number;
  netoDesdeLineas: number;
  /**
   * El total que quedó guardado al cerrar. `null` en un período abierto.
   *
   * Se muestra **solo cuando discrepa** de `netoDesdeLineas`: si coinciden, dos
   * cifras iguales una al lado de la otra no informan, preocupan.
   */
  netoGuardado: number | null;

  /** Anuladas: lo que explica una discrepancia entre las dos cifras de arriba. */
  lineasAnuladas: number;

  /** Cuántas llevan ajuste por incidencia y cuánto suman (puede ser negativo). */
  lineasConAjuste: number;
  ajusteTotalClp: number;

  /** Corte por régimen. Las claves son `tipo_pedido`, que es la clave de tarifa. */
  porTipoPedido: { flex: number; sameDay: number };

  /** El primer y el último hecho facturado. `null` si no hay líneas vigentes. */
  primerHecho: string | null;
  ultimoHecho: string | null;

  folio: number | null;
  estadoSii: DocumentoDte["estadoSii"] | null;

  estadoCobro: EstadoCobroPeriodo;
  montoPagadoClp: number | null;

  /** Excepciones de conciliación abiertas que impiden emitir. */
  excepcionesBloqueantes: number;
}

interface FilaLinea {
  monto_final_clp: number | null;
  ajuste_incidencia_clp: number | null;
  tipo_pedido: string | null;
  fecha_hecho: string | null;
  anulada: boolean | null;
}

export async function armarVistaPreviaPeriodo(
  cliente: SupabaseClient,
  tenantId: string,
  periodoId: string,
): Promise<VistaPreviaPeriodo | null> {
  const { data: periodo, error } = await cliente
    .schema("dinero")
    .from("periodos_cobro")
    .select(
      "id, seller_id, fecha_inicio, fecha_fin, estado, monto_total_clp, estado_cobro, monto_pagado_clp",
    )
    .eq("id", periodoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  // `null` y no una excepción: desde afuera, «no existe» y «no es de tu tenant»
  // tienen que verse igual.
  if (error || !periodo) return null;

  const sellerId = periodo.seller_id as string;

  // ⚠️ El envoltorio `Promise.resolve(...)` alrededor de cada builder no es
  // adorno: PostgREST devuelve un `PromiseLike`, no una `Promise`, así que
  // encadenarle `.catch()` directamente no compila — y, peor, arrastra el tipo
  // de todo el `Promise.all` a `any`, con lo que se pierde el chequeo de las
  // filas más abajo sin que nada falle.
  const [seller, lineas, dte, bloqueos] = await Promise.all([
    Promise.resolve(
      cliente
        .schema("identidad")
        .from("sellers")
        .select("nombre, rut")
        .eq("id", sellerId)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    )
      .then((r) => r.data)
      .catch(() => null),

    leerTodasLasFilas<FilaLinea>("líneas de cobro del período", (desde, hasta) =>
      cliente
        .schema("dinero")
        .from("lineas_cobro")
        .select("monto_final_clp, ajuste_incidencia_clp, tipo_pedido, fecha_hecho, anulada")
        .eq("tenant_id", tenantId)
        .eq("periodo_cobro_id", periodoId)
        .range(desde, hasta),
    ).catch(() => [] as FilaLinea[]),

    Promise.resolve(
      cliente
        .schema("dinero")
        .from("documentos_dte")
        .select("folio, estado_sii")
        .eq("tenant_id", tenantId)
        .eq("periodo_cobro_id", periodoId)
        .maybeSingle(),
    )
      .then((r) => r.data)
      .catch(() => null),

    contarBloqueosDeFacturacion(cliente, tenantId, [{ id: periodoId, sellerId }]).catch(() => ({})),
  ]);

  const vigentes = lineas.filter((l) => !l.anulada);

  const fechas = vigentes
    .map((l) => l.fecha_hecho)
    .filter((f): f is string => Boolean(f))
    .sort();

  return {
    id: periodo.id as string,
    sellerId,
    sellerNombre: (seller?.nombre as string | undefined) ?? "Seller",
    sellerRut: (seller?.rut as string | undefined) ?? null,
    fechaInicio: periodo.fecha_inicio as string,
    fechaFin: periodo.fecha_fin as string,
    estado: periodo.estado as EstadoPeriodo,

    lineasVigentes: vigentes.length,
    netoDesdeLineas: vigentes.reduce((s, l) => s + (l.monto_final_clp ?? 0), 0),
    netoGuardado: (periodo.monto_total_clp as number | null) ?? null,

    lineasAnuladas: lineas.length - vigentes.length,

    lineasConAjuste: vigentes.filter((l) => (l.ajuste_incidencia_clp ?? 0) !== 0).length,
    ajusteTotalClp: vigentes.reduce((s, l) => s + (l.ajuste_incidencia_clp ?? 0), 0),

    porTipoPedido: {
      flex: vigentes.filter((l) => l.tipo_pedido === "flex").length,
      sameDay: vigentes.filter((l) => l.tipo_pedido === "same_day").length,
    },

    primerHecho: fechas[0] ?? null,
    ultimoHecho: fechas.at(-1) ?? null,

    folio: (dte?.folio as number | null) ?? null,
    estadoSii: (dte?.estado_sii as DocumentoDte["estadoSii"] | undefined) ?? null,

    estadoCobro: periodo.estado_cobro as EstadoCobroPeriodo,
    montoPagadoClp: (periodo.monto_pagado_clp as number | null) ?? null,

    excepcionesBloqueantes: (bloqueos as Record<string, number>)[periodoId] ?? 0,
  };
}
