/**
 * Job · ml/rellenarOrderId — barrido hacia atrás del id de orden de ML
 * =============================================================================
 * QUÉ ARREGLA (producción, 2026-09-20): de 132 pedidos Flex solo 39 tenían
 * `operacion.pedidos.ml_order_id`. Los 93 restantes entraron por el WEBHOOK, que
 * solo conoce el `shipment_id`, y hasta hoy el id de la orden se leía del propio
 * shipment — un campo que ML **descontinuó el 12/10/2025** («los campos
 * `order_id` y `external_reference` serán descontinuados en los recursos de
 * shipments y dejarán de ser retornados en las respuestas», doc oficial de
 * envíos). El origen ya quedó cerrado en `../ingesta-pedidos.ts`, que ahora
 * resuelve con `GET /shipments/{id}/orders`. Esto es la cola de atrás.
 *
 * Importa porque el id de la orden (16 dígitos) es el **único** código que el
 * seller ve en su panel de Ventas, y es por el que busca su pedido por WhatsApp
 * (`operacion/consultas/seller.ts`). Sin él, la consulta responde «no
 * encontramos» sobre un pedido que sí existe.
 *
 * -----------------------------------------------------------------------------
 * POR EVENTO, NO POR CRON (decisión, y el porqué)
 * -----------------------------------------------------------------------------
 * Es un trabajo que se agota: con el origen arreglado, no nacen pedidos nuevos
 * sin `ml_order_id`. Un cron seguiría preguntándole a ML —una llamada por
 * pedido— por los que se quedaron sin dato legítimamente (204 No Content), para
 * siempre y sin cambiar nada. Se dispara a mano:
 *
 *     inngest.send({ name: "ml/orderId.relleno-solicitado", data: {} })
 *
 * y es **reejecutable**: cada corrida solo mira los que siguen en `null`, así
 * que repetirlo es barato y converge. `conexionId` acota a una sola cuenta;
 * `tope` acota el gasto de llamadas de la corrida.
 *
 * -----------------------------------------------------------------------------
 * REGLAS DURAS QUE APLICAN AQUÍ
 * -----------------------------------------------------------------------------
 * · **SOLO LECTURA contra ML.** Un `GET` y nada más.
 * · **Nunca se sobrescribe un `ml_order_id` ya guardado**: el filtro pide
 *   `is null` y el UPDATE lo vuelve a exigir (`.is("ml_order_id", null)`), así
 *   que aunque otra corrida gane la carrera, la segunda no pisa nada.
 * · **El payload del UPDATE lleva UNA sola columna.** En PostgREST toda columna
 *   del payload se escribe: mandar `estado`, `origen` o `corte_riesgo` "por si
 *   acaso" es el bug que casi resetea la operación del día con el backfill.
 * · Toda llamada va por `peticionMl` (backoff + `Retry-After`), con la misma
 *   concurrencia acotada que usa el resto de la ingesta.
 * · **Un 404 no se interpreta como nada** —ni cancelación, ni borrado—. Se
 *   cuenta, se registra para revisión humana y el pedido queda intacto.
 *
 * SEGURIDAD: el token se descifra dentro del paso, viaja por parámetro y sale de
 * scope. Nunca a un log, a un error ni al payload de un evento. Del pedido solo
 * se loguean ids de envío, que no son dato personal.
 */

import { inngest } from "@/lib/inngest/cliente";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { capturarMensaje } from "@/lib/observabilidad";
import { descifrarSecreto } from "../../secretos";
import { ErrorHttpMl } from "../cliente-http";
import {
  CONCURRENCIA_SHIPMENTS,
  mapearConConcurrencia,
  obtenerOrderIdDeShipmentMl,
  type LoggerIngesta,
} from "../ingesta-pedidos";
import { leerConexionesParaIngesta, type ConexionIngesta } from "./ingesta-pedidos-ml";

/* eslint-disable @typescript-eslint/no-explicit-any */
type ClienteSupabase = ReturnType<typeof crearClienteServiceRole> & {
  schema: (s: string) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Tope de pedidos por conexión y corrida. Cada uno cuesta exactamente una
 * llamada a ML, así que el número ES el gasto máximo. 500 cubre de sobra el caso
 * conocido (93) y deja margen; lo que no entra, entra en la corrida siguiente,
 * porque el filtro sigue siendo «los que están en null».
 */
export const TOPE_PEDIDOS_POR_CONEXION = 500;

/** Se miran los pedidos de la fuente ML/Flex, que es la única con orden de ML. */
export const FUENTE_ML_FLEX = "ml_flex";

export interface ResumenRellenoConexion {
  conexionId: string;
  omitida?: "sin_token" | "desvinculada" | "token_ilegible";
  /** Pedidos Flex con `ml_order_id` nulo que esta corrida miró. */
  candidatos: number;
  /** Se resolvió el id de la orden y se escribió. */
  resueltos: number;
  /** ML respondió que el envío no tiene órdenes (204 / lista vacía). */
  sinDato: number;
  /** La consulta falló por algo distinto de un 404. */
  fallidos: number;
  /** Envíos con 404 en ML. **No se asume nada**: quedan para revisión humana. */
  noEncontrados: string[];
  /** El UPDATE falló (o la fila ya tenía id y no se tocó). */
  erroresPersistencia: number;
}

function resumenVacio(conexionId: string): ResumenRellenoConexion {
  return {
    conexionId,
    candidatos: 0,
    resueltos: 0,
    sinDato: 0,
    fallidos: 0,
    noEncontrados: [],
    erroresPersistencia: 0,
  };
}

interface PedidoSinOrderId {
  id: string;
  ml_shipment_id: string;
}

/**
 * Pedidos Flex de esta conexión que siguen sin `ml_order_id`.
 *
 * El eje de procedencia es `fuente` (CLAUDE.md), NUNCA `tipo_pedido`: lo que se
 * pregunta acá es «¿este pedido vino de Mercado Libre?», y esa pregunta tiene
 * una sola columna correcta.
 *
 * La conexión «representativa» del seller carga además con los pedidos legacy
 * sin `ml_user_id` estampado — misma regla que el repaso de estados, para no
 * consultarlos una vez por cada cuenta del seller.
 */
export async function leerPedidosSinOrderId(
  supabase: ClienteSupabase,
  conexion: ConexionIngesta,
  tope: number,
): Promise<PedidoSinOrderId[]> {
  let consulta = supabase
    .schema("operacion")
    .from("pedidos")
    .select("id, ml_shipment_id")
    .eq("tenant_id", conexion.tenantId)
    .eq("seller_id", conexion.sellerId)
    .eq("fuente", FUENTE_ML_FLEX)
    .is("ml_order_id", null)
    .not("ml_shipment_id", "is", null);

  // `.or()` recibe un STRING que PostgREST parsea (no hay parámetro ligado) y
  // `ml_user_id` es una columna `text`: se exige forma numérica antes de
  // interpolar. Misma cautela que en `faseBRepasoEstados`.
  const cuentaInterpolable = /^[0-9]+$/.test(conexion.mlUserId);
  consulta =
    conexion.esRepresentativaDelSeller && cuentaInterpolable
      ? consulta.or(`ml_user_id.eq.${conexion.mlUserId},ml_user_id.is.null`)
      : consulta.eq("ml_user_id", conexion.mlUserId);

  const { data, error } = await consulta
    // Los más recientes primero: son los que un seller puede estar preguntando
    // hoy por WhatsApp.
    .order("creado_en", { ascending: false })
    .limit(tope);

  if (error) {
    throw new Error(`No se pudieron leer los pedidos sin id de orden: ${error.message}`);
  }

  return ((data ?? []) as PedidoSinOrderId[]).filter((p) => !!p.ml_shipment_id);
}

/**
 * Rellena el `ml_order_id` de los pedidos de UNA conexión.
 *
 * Exportada para que las pruebas ejerzan ESTE código y no una copia espejo
 * dentro del test (el error que dejó al job de conciliación con cobertura
 * falsa: tests en verde con el bug vivo).
 */
export async function rellenarOrderIdDeConexion(
  conexion: ConexionIngesta,
  opciones: {
    supabase?: ClienteSupabase;
    logger?: LoggerIngesta;
    tope?: number;
  } = {},
): Promise<ResumenRellenoConexion> {
  const resumen = resumenVacio(conexion.id);
  const supabase = opciones.supabase ?? (crearClienteServiceRole() as ClienteSupabase);
  const logger = opciones.logger ?? { info: () => {}, warn: () => {}, error: () => {} };
  const tope = opciones.tope ?? TOPE_PEDIDOS_POR_CONEXION;

  if (conexion.estadoSalud === "desvinculada") {
    resumen.omitida = "desvinculada";
    return resumen;
  }
  if (!conexion.accessTokenRef || !conexion.mlUserId) {
    resumen.omitida = "sin_token";
    return resumen;
  }

  const pedidos = await leerPedidosSinOrderId(supabase, conexion, tope);
  resumen.candidatos = pedidos.length;
  if (pedidos.length === 0) return resumen;

  let accessToken: string;
  try {
    const descifrado = await descifrarSecreto(conexion.accessTokenRef);
    if (typeof descifrado.valor !== "string") throw new Error("no es texto");
    accessToken = descifrado.valor;
  } catch {
    // El mensaje del error de descifrado no se propaga: podría llevar fragmentos
    // del material cifrado.
    logger.warn(
      `Relleno de id de orden, conexión ${conexion.id}: no se pudo obtener el token. Se omite.`,
    );
    resumen.omitida = "token_ilegible";
    return resumen;
  }

  const resultados = await mapearConConcurrencia(
    pedidos,
    CONCURRENCIA_SHIPMENTS,
    async (pedido) => {
      const shipmentId = String(pedido.ml_shipment_id);
      try {
        const orderId = await obtenerOrderIdDeShipmentMl(shipmentId, accessToken);
        return { pedido, shipmentId, orderId };
      } catch (error) {
        if (error instanceof ErrorHttpMl) {
          return { pedido, shipmentId, fallo: `HTTP ${error.status}`, status: error.status };
        }
        return {
          pedido,
          shipmentId,
          fallo: error instanceof Error ? error.message : "error desconocido",
        };
      }
    },
  );

  for (const r of resultados) {
    if ("fallo" in r && r.fallo) {
      // ⚠️ El 404 no significa nada aquí: ni cancelación, ni pedido borrado. Se
      // cuenta aparte y se reporta; el pedido queda exactamente como estaba.
      if (r.status === 404) resumen.noEncontrados.push(r.shipmentId);
      else resumen.fallidos += 1;
      continue;
    }

    if (!("orderId" in r) || !r.orderId) {
      resumen.sinDato += 1;
      continue;
    }

    // ⚠️ UNA sola columna en el payload. En PostgREST todo lo que va en el
    // objeto se ESCRIBE: `estado`, `origen` y `corte_riesgo` no aparecen acá ni
    // por comodidad ni por simetría con la ingesta.
    // El `.is("ml_order_id", null)` es la segunda mitad de la promesa de no
    // sobrescribir: si otra corrida (o el webhook) ya lo resolvió, este UPDATE
    // no afecta ninguna fila en vez de pisarlo.
    const { error } = await supabase
      .schema("operacion")
      .from("pedidos")
      .update({ ml_order_id: r.orderId })
      .eq("id", r.pedido.id)
      .is("ml_order_id", null);

    if (error) {
      resumen.erroresPersistencia += 1;
      logger.error(
        `Relleno de id de orden: no se pudo escribir el del envío ${r.shipmentId}: ` +
          error.message,
      );
      continue;
    }

    resumen.resueltos += 1;
  }

  // El token en claro sale de scope aquí.
  return resumen;
}

/** Suma los resúmenes por conexión en los totales del run. */
export function agregarResumenesRelleno(
  resultados: Array<PromiseSettledResult<ResumenRellenoConexion>>,
): Omit<ResumenRellenoConexion, "conexionId" | "omitida"> {
  const totales = {
    candidatos: 0,
    resueltos: 0,
    sinDato: 0,
    fallidos: 0,
    noEncontrados: [] as string[],
    erroresPersistencia: 0,
  };

  for (const r of resultados) {
    if (r.status !== "fulfilled" || !r.value) continue;
    totales.candidatos += r.value.candidatos;
    totales.resueltos += r.value.resueltos;
    totales.sinDato += r.value.sinDato;
    totales.fallidos += r.value.fallidos;
    totales.erroresPersistencia += r.value.erroresPersistencia;
    totales.noEncontrados.push(...r.value.noEncontrados);
  }

  return totales;
}

export const jobRellenarOrderIdMl = inngest.createFunction(
  {
    id: "ml/rellenarOrderId",
    name: "ML · Rellenar el id de orden de pedidos Flex antiguos",
    triggers: [{ event: "ml/orderId.relleno-solicitado" }],
    // Un barrido a la vez: dos disparos seguidos no duplican llamadas a ML
    // sobre los mismos pedidos.
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ event, step, logger }) => {
    const { conexionId, tope } = (event.data ?? {}) as {
      conexionId?: string | null;
      tope?: number | null;
      actorUsuarioId?: string | null;
    };

    const conexiones = await step.run("leer-conexiones", async () => {
      const supabase = crearClienteServiceRole() as ClienteSupabase;
      const { conexiones: todas } = await leerConexionesParaIngesta(supabase, logger);
      return conexionId ? todas.filter((c) => c.id === conexionId) : todas;
    });

    if (conexiones.length === 0) {
      logger.warn(
        "Relleno de id de orden: no hay conexiones ML activas que barrer" +
          (conexionId ? ` (se pidió la conexión ${conexionId})` : "") +
          ".",
      );
      return { resultado: "sin_conexiones" };
    }

    const resultados = await Promise.allSettled(
      conexiones.map((conexion) =>
        step.run(`relleno:conexion:${conexion.id}`, async () =>
          rellenarOrderIdDeConexion(conexion, {
            logger,
            ...(typeof tope === "number" && tope > 0 ? { tope } : {}),
          }),
        ),
      ),
    );

    const totales = agregarResumenesRelleno(resultados);

    if (totales.noEncontrados.length > 0) {
      const muestra = totales.noEncontrados.slice(0, 20);
      logger.error(
        `Relleno de id de orden: ${totales.noEncontrados.length} envíos respondieron 404 ` +
          "en ML. NO se asume cancelación ni se tocó ningún pedido. Envíos: " +
          muestra.join(", ") +
          (totales.noEncontrados.length > muestra.length
            ? ` …(+${totales.noEncontrados.length - muestra.length})`
            : ""),
      );
      await capturarMensaje(
        `Relleno de id de orden: ${totales.noEncontrados.length} envíos con 404`,
        "warning",
        {
          origen: "job:ml/rellenarOrderId",
          etiquetas: { motivo: "shipment_404" },
          extra: { shipmentIds: muestra, total: totales.noEncontrados.length },
        },
      );
    }

    logger.info(
      `Relleno de id de orden completado: ${totales.resueltos} resueltos de ` +
        `${totales.candidatos} candidatos; ${totales.sinDato} sin dato en ML, ` +
        `${totales.fallidos} fallidos.`,
    );

    return {
      resultado: "completado",
      conexiones: conexiones.length,
      conexionesConError: resultados.filter((r) => r.status === "rejected").length,
      ...totales,
      noEncontrados: totales.noEncontrados.slice(0, 20),
      totalNoEncontrados: totales.noEncontrados.length,
    };
  },
);
