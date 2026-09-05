/**
 * Traspaso de bultos entre conductores (etapa 9).
 *
 * Juan le pasa 8 paquetes a Pedro en la calle; Pedro los escanea y quedan
 * suyos. En Flex esto ya funciona así de suelto —re-escanear un bulto ajeno lo
 * mueve solo, sin pedir permiso— y Rutax calca ese comportamiento a propósito:
 * el traspaso es LIBRE y el autor es quien escanea.
 *
 * =============================================================================
 * ESTE MÓDULO HACE DOS COSAS, Y LA PRIMERA ES LA QUE NO ES OBVIA
 * =============================================================================
 * 1. **Resolver códigos a pedidos.** El conductor escana etiquetas, no UUIDs.
 *    Se reusa exactamente el mismo parseo y la misma búsqueda por columna que
 *    el retiro en bodega (`retiro/parser-codigo.ts` y `retiro/dto-pedido.ts`):
 *    duplicar esa lógica significaría que un formato nuevo de etiqueta funcione
 *    en una pantalla y no en la otra.
 * 2. **Llamar al RPC** `operacion.traspasar_pedidos_a_conductor`, que hace todo
 *    el trabajo transaccional (reja, cerrojo, manifiesto, bitácora).
 *
 * =============================================================================
 * UN CÓDIGO QUE NO RESUELVE NO ES UN ERROR
 * =============================================================================
 * Igual que en el retiro: el conductor está de pie en la calle con el otro
 * esperándolo. Un código ilegible, o de un bulto que Rutax no conoce, se
 * reporta como resultado de ESE bulto y no tumba los otros 7. La respuesta
 * siempre es 200 con el detalle por elemento.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import { parsearCodigoBulto } from "./retiro/parser-codigo";
import { buscarPedidosPorCodigos, type PedidoCandidatoRetiro } from "./retiro/dto-pedido";
import { traspasarPedidosRpc, type ResultadoTraspaso } from "./traspaso-rpc";
import { recalcularRutaTrasCambio } from "./ruta-manifiesto";
import { obtenerManifiestoVigenteDelConductor } from "./manifiesto-vigente";
import type { EstadoManifiesto } from "./tipos";

/** Por qué un bulto escaneado no se traspasó. */
export type MotivoNoTraspasado =
  /** El código no se pudo leer (etiqueta rota, formato desconocido). */
  | "ilegible"
  /** Se leyó bien pero Rutax no conoce ese bulto — de otro courier, o no ingestado. */
  | "sin_pedido"
  /** El pedido existe pero nadie lo tenía asignado: no hay de quién recibirlo. */
  | "sin_asignacion"
  /** Ya era de quien escanea. Es un re-escaneo, el caso más benigno. */
  | "ya_mio"
  /** Entregado, cancelado, devuelto… ya no está en la calle. */
  | "estado_no_traspasable"
  /** Existe en otro courier. Se reporta igual que "sin_pedido" hacia afuera. */
  | "ajeno";

export interface BultoTraspasado {
  /** El código tal como lo escaneó el conductor, normalizado para mostrar. */
  codigoVisible: string;
  /** `null` cuando no se pudo resolver a un pedido. */
  pedidoId: string | null;
  traspasado: boolean;
  motivo: MotivoNoTraspasado | null;
}

export interface ResultadoTraspasoLote {
  manifiestoId: string | null;
  manifiestoCreado: boolean;
  totalEscaneados: number;
  totalTraspasados: number;
  bultos: BultoTraspasado[];
  /**
   * Cuántos bultos vinieron de cada conductor, por NOMBRE. Es lo que permite
   * decirle a Pedro "recibiste 8 de Juan" en vez de un número pelado — y saber
   * de quién los recibió es justamente lo que convierte el gesto en algo
   * verificable para él en el momento.
   */
  origenes: Array<{ conductorId: string; nombre: string; cantidad: number }>;
}

/**
 * Tope de bultos por lote. El MISMO que el retiro (`escaneos.ts`), y por la
 * misma razón: la app trocea a este número y el backend lo impone. Dos topes
 * distintos para dos escáneres serían dos números que se desincronizan.
 */
export const MAX_BULTOS_POR_TRASPASO = 50;

export class ErrorLoteExcedido extends Error {
  readonly codigo = "lote_excede_maximo";
}

export async function traspasarBultosEscaneados(
  cliente: SupabaseClient,
  entrada: {
    tenantId: string;
    /** El conductor que ESCANEA. Sale de su token, nunca del cuerpo del request. */
    conductorReceptorId: string;
    actorUsuarioId: string;
    codigos: readonly string[];
  },
): Promise<ResultadoTraspasoLote> {
  if (entrada.codigos.length > MAX_BULTOS_POR_TRASPASO) {
    throw new ErrorLoteExcedido(
      `El lote trae ${entrada.codigos.length} bultos y el máximo es ${MAX_BULTOS_POR_TRASPASO}.`,
    );
  }

  // --- 1. Parseo local: qué formato es cada código -----------------------------
  const parseados = entrada.codigos.map((crudo) => ({
    crudo,
    parseado: parsearCodigoBulto(crudo),
  }));

  // --- 2. Resolver los legibles a pedidos, en lote -----------------------------
  const legibles = parseados.filter((p) => p.parseado.formato !== "desconocido");
  const pedidosPorCodigo = legibles.length
    ? await buscarPedidosPorCodigos(
        cliente,
        entrada.tenantId,
        legibles.map((p) => p.parseado),
      )
    : new Map<string, PedidoCandidatoRetiro>();

  // --- 3. Traspasar de una sola llamada ----------------------------------------
  const pedidoIds = [
    ...new Set(
      legibles
        .map((p) => pedidosPorCodigo.get(p.parseado.codigoNormalizado)?.pedidoId)
        .filter((id): id is string => !!id),
    ),
  ];

  // Sin un solo pedido resuelto NO se llama al RPC: lanzaría por lote vacío, y
  // eso convertiría "escaneaste 3 etiquetas que no conozco" en un error 500
  // cuando en realidad es un resultado legítimo que hay que mostrar.
  let resultado: ResultadoTraspaso | null = null;
  if (pedidoIds.length > 0) {
    resultado = await traspasarPedidosRpc(cliente, {
      tenantId: entrada.tenantId,
      conductorReceptorId: entrada.conductorReceptorId,
      fecha: fechaLocalEnSantiago(new Date()),
      pedidoIds,
      actorUsuarioId: entrada.actorUsuarioId,
    });
  }

  // --- 4. Un resultado por bulto escaneado -------------------------------------
  const omitidos = resultado?.omitidos ?? {};
  const bultos: BultoTraspasado[] = parseados.map(({ parseado }) => {
    const codigoVisible = parseado.muestraCodigo ?? parseado.codigoNormalizado;

    if (parseado.formato === "desconocido") {
      return { codigoVisible, pedidoId: null, traspasado: false, motivo: "ilegible" };
    }

    const pedido = pedidosPorCodigo.get(parseado.codigoNormalizado);
    if (!pedido) {
      return { codigoVisible, pedidoId: null, traspasado: false, motivo: "sin_pedido" };
    }

    const motivoSql = omitidos[pedido.pedidoId];
    if (motivoSql) {
      return {
        codigoVisible,
        pedidoId: pedido.pedidoId,
        traspasado: false,
        motivo: motivoSql as MotivoNoTraspasado,
      };
    }

    return { codigoVisible, pedidoId: pedido.pedidoId, traspasado: true, motivo: null };
  });

  // --- 5. De quién vino cada uno, en palabras ----------------------------------
  const origenes = await resolverNombresDeOrigen(
    cliente,
    entrada.tenantId,
    resultado?.origenes ?? {},
  );

  // --- 6. El gatillo del recálculo automático (2026-09-05) --------------------
  // Un traspaso mueve una parada entre DOS manifiestos: el del que la pierde y
  // el del que la gana. Los dos pueden quedar con una secuencia que ya no
  // corresponde a lo que llevan.
  //
  // Cada intento va en SU PROPIO try/catch: que falle el recálculo del
  // receptor no debería impedir que se intente el de cada conductor de
  // origen, y viceversa. Es mejor esfuerzo — el traspaso YA ocurrió, y es lo
  // que no puede perderse.
  if (resultado && resultado.totalTraspasados > 0) {
    const fecha = fechaLocalEnSantiago(new Date());

    // El receptor. Mismo criterio que la asignación en bloque: recién creado
    // nace 'borrador' y no hace falta preguntarle nada a la base.
    if (!resultado.manifiestoCreado) {
      try {
        const { data: manifiestoReceptor } = await cliente
          .from("manifiestos")
          .select("estado")
          .eq("id", resultado.manifiestoId)
          .eq("tenant_id", entrada.tenantId)
          .maybeSingle();
        if (manifiestoReceptor) {
          await recalcularRutaTrasCambio(cliente, {
            tenantId: entrada.tenantId,
            manifiestoId: resultado.manifiestoId as string,
            estadoManifiesto: manifiestoReceptor.estado as EstadoManifiesto,
            actorUsuarioId: entrada.actorUsuarioId,
            motivo: "traspaso-recibido",
          });
        }
      } catch (err) {
        console.error(
          "[traspaso] no se pudo disparar el recálculo del receptor:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Cada conductor de ORIGEN perdió una parada de SU manifiesto vigente.
    // `origenes` ya viene deduplicado por conductor (`resolverNombresDeOrigen`
    // agrupa por id), así que no hace falta deduplicar de nuevo acá.
    for (const { conductorId: conductorOrigenId } of origenes) {
      try {
        const manifiestoOrigen = await obtenerManifiestoVigenteDelConductor(cliente, {
          tenantId: entrada.tenantId,
          driverId: conductorOrigenId,
          fecha,
        });
        if (manifiestoOrigen) {
          await recalcularRutaTrasCambio(cliente, {
            tenantId: entrada.tenantId,
            manifiestoId: manifiestoOrigen.id,
            estadoManifiesto: manifiestoOrigen.estado as EstadoManifiesto,
            actorUsuarioId: entrada.actorUsuarioId,
            motivo: "traspaso-enviado",
          });
        }
      } catch (err) {
        console.error(
          `[traspaso] no se pudo disparar el recálculo del origen '${conductorOrigenId}':`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return {
    manifiestoId: resultado?.manifiestoId ?? null,
    manifiestoCreado: resultado?.manifiestoCreado ?? false,
    totalEscaneados: parseados.length,
    totalTraspasados: resultado?.totalTraspasados ?? 0,
    bultos,
    origenes,
  };
}

/**
 * Convierte el mapa `{pedidoId: conductorOrigenId}` que devuelve el RPC en
 * "N bultos de Juan Pérez".
 *
 * ⚠️ La consulta filtra por `tenant_id` aunque los ids vengan del propio RPC:
 * estas rutas corren con `service_role` y ahí el filtro explícito ES el
 * aislamiento. Un nombre de conductor ajeno filtrado por un id equivocado sería
 * una fuga pequeña pero real.
 */
async function resolverNombresDeOrigen(
  cliente: SupabaseClient,
  tenantId: string,
  origenes: Record<string, string>,
): Promise<Array<{ conductorId: string; nombre: string; cantidad: number }>> {
  const conteo = new Map<string, number>();
  for (const conductorId of Object.values(origenes)) {
    if (conductorId) conteo.set(conductorId, (conteo.get(conductorId) ?? 0) + 1);
  }
  if (conteo.size === 0) return [];

  const { data } = await cliente
    .from("conductores")
    .select("id, nombre_completo")
    .eq("tenant_id", tenantId)
    .in("id", [...conteo.keys()]);

  const nombres = new Map(
    (data ?? []).map((c: Record<string, unknown>) => [c.id as string, c.nombre_completo as string]),
  );

  return [...conteo.entries()].map(([conductorId, cantidad]) => ({
    conductorId,
    // Sin nombre no se rompe la respuesta: el conductor igual necesita saber
    // que recibió N bultos.
    nombre: nombres.get(conductorId) ?? "Otro conductor",
    cantidad,
  }));
}
