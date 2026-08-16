/**
 * Núcleo compartido · reflejar en Rutax una cancelación DETECTADA en una
 * fuente externa (Mercado Libre, Shopify, y cualquier fuente futura).
 * =============================================================================
 * POR QUÉ SE EXTRAE (y por qué AHORA, no antes)
 * -----------------------------------------------------------------------------
 * Hasta esta tarea solo existía `operacion/jobs/procesar-cancelacion-ml.ts`, con
 * toda la lógica de "reflejar una cancelación detectada" incrustada junto con el
 * vocabulario propio de ML (`ml_shipment_id`, `substatus_ml`, la acción de
 * bitácora `pedido.cancelado_por_ml`). Con la entrada de Shopify aparece un
 * SEGUNDO productor del mismo patrón (`operacion/pedido.cancelado-en-fuente`,
 * ver `lib/inngest/eventos.ts`), y con dos copias casi idénticas el riesgo real
 * es el de siempre: dentro de seis meses alguien corrige un bug de idempotencia
 * o de la máquina de estados en una mitad (la que tiene el bug delante) y se le
 * olvida — o ni se entera — que la otra mitad tiene exactamente el mismo bug.
 * Se eligió EXTRAER el núcleo en vez de escribir un job hermano por la misma
 * razón por la que el resto del repo extrae en cuanto aparece un segundo
 * llamador (`ventanas-corte.ts`, compartido entre el alta manual same-day y la
 * ingesta de Shopify; `desactivarAsignacionActivaPedido`, compartida por
 * `cancelarPedido` y el job de ML): la duplicación entre DOS copias completas
 * de la misma máquina de estados es exactamente la clase de bug que este
 * proyecto ya pagó más de una vez (ver `gotcha_check_repuesto_pierde_valor.md`
 * en la memoria del proyecto — una lista que se repone a mano en dos sitios).
 *
 * QUÉ SE MANTIENE IGUAL PARA `procesar-cancelacion-ml.ts` (compatibilidad
 * observable — sus pruebas NO se tocan y deben seguir en verde):
 *   - Los mismos nombres de acción de bitácora (`pedido.cancelado_por_ml`,
 *     `pedido.cancelacion_ml_no_reflejada`).
 *   - La misma forma del `detalle` de bitácora (mismas claves, mismos valores).
 *   - El mismo orden de efectos y el mismo objeto de retorno.
 *   - El mismo tratamiento de `ErrorConflicto` como no-op de la invocación
 *     perdedora, y el mismo trato de idempotencia (evento repetido → no-op).
 *
 * QUÉ VARÍA POR FUENTE (parametrizado vía `IdentidadCancelacionFuente`):
 *   - La acción de bitácora de la transición y la de la anomalía terminal —
 *     nombran la fuente real. Un pedido de Shopify JAMÁS queda con una entrada
 *     que diga "cancelado_por_ml": ver el comentario de
 *     `EventoPedidoCanceladoEnFuente` en `lib/inngest/eventos.ts`.
 *   - Los campos propios de la fuente que se agregan al `detalle` (p. ej.
 *     `ml_shipment_id` + `substatus_ml` para ML; `fuente` + `id_externo` +
 *     `referencia_externa` para el resto).
 *   - El nombre legible de la fuente, usado en el texto de la incidencia de
 *     retiro pendiente ("Pedido cancelado en Mercado Libre..." vs. "...en
 *     Shopify...").
 *   - Una verificación de consistencia OPCIONAL (mlShipmentId real vs. el del
 *     evento; idExterno real vs. el del evento) — nunca bloquea, solo deja
 *     rastro en logger.warn para que se revise la detección en `integraciones`.
 *
 * TERRITORIO: consumidor puro de `operacion`. Nunca llama a `integraciones` ni
 * a ningún proveedor externo — el evento ya trae todo lo necesario. Solo usa
 * los caminos ya existentes de `operacion` (`actualizarEstadoPedido`,
 * `desactivarAsignacionActivaPedido`, `abrirIncidencia`) — el mismo "único
 * camino" que usa la cancelación manual, para que exista un solo lugar que
 * lleve un pedido a 'cancelado' con todas sus consecuencias.
 *
 * MULTI-TENANT: toda lectura/escritura lleva `tenant_id` en el WHERE — nunca se
 * confía en que `pedidoId` sea suficiente.
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { ErrorConflicto } from "@/modules/identidad/errores";
import { actualizarEstadoPedido, desactivarAsignacionActivaPedido } from "../pedidos";
import { abrirIncidencia } from "../incidencias";
import { ESTADOS_TERMINALES } from "../tipos";
import type { EstadoPedido } from "../tipos";

/** Estados desde los que la cancelación reportada por la fuente deja al conductor con un bulto por devolver. */
const ESTADOS_QUE_REQUIEREN_INCIDENCIA_DE_RETIRO: ReadonlySet<EstadoPedido> = new Set([
  "asignado",
  "en_ruta",
]);

/** Lo mínimo que cualquier evento de cancelación-en-fuente trae, sin importar de dónde venga. */
export interface DatosCancelacionDetectada {
  pedidoId: string;
  tenantId: string;
  sellerId: string;
  /** Estado interno que tenía el pedido al detectarse la cancelación (solo trazabilidad — el control de flujo relee BD). */
  estadoAnterior: string;
}

/**
 * Lo que distingue a UNA fuente de otra dentro del núcleo compartido. Cada
 * job hermano (`procesar-cancelacion-ml.ts`, `procesar-cancelacion-fuente.ts`)
 * arma este objeto a partir de su propio `event.data` antes de delegar aquí.
 */
export interface IdentidadCancelacionFuente {
  /** Acción de bitácora para la transición a 'cancelado'. */
  accionCancelada: string;
  /** Acción de bitácora para la anomalía "el pedido ya estaba en un terminal distinto". */
  accionAnomalia: string;
  /** Nombre legible de la fuente ("Mercado Libre", "Shopify"), para el texto de la incidencia y de la anomalía. */
  nombreFuenteLegible: string;
  /** Campos propios de la fuente que se agregan al `detalle` de AMBAS entradas de bitácora (cancelación y anomalía). Nunca datos personales. */
  detalleFuente: Record<string, unknown>;
  /** Columnas EXTRA (además de las base) a leer de `pedidos`, solo para `advertenciaConsistencia`. */
  columnasExtra?: readonly string[];
  /**
   * Devuelve un mensaje de advertencia si el identificador de la fuente en la
   * fila real no coincide con el del evento, o `null` si coincide (o si la
   * fuente no define esta verificación). NUNCA bloquea — la decisión #1 del
   * job de ML sigue mandando: el estado se refleja siempre.
   */
  advertenciaConsistencia?: (filaCruda: Record<string, unknown>) => string | null;
}

/**
 * `step.run` se tipa SIN el genérico `<T>` a propósito: el `step` real de
 * Inngest v4 devuelve `Promise<Jsonify<Awaited<T>>>`, que TypeScript no acepta
 * como estructuralmente asignable a `Promise<T>` (mismo gotcha que documenta
 * `src/lib/inngest/telemetria-jobs.ts` sobre `stepOutputTransform`). Devolver
 * `Promise<unknown>` aquí SÍ es asignable desde el tipo real (todo es
 * asignable a `unknown`), y cada llamador castea el resultado donde lo usa.
 */
export interface ContextoJobCancelacion {
  step: { run: (label: string, fn: () => Promise<unknown>) => Promise<unknown> };
  logger: { info: (m: string) => void; warn: (m: string) => void };
  runId: string;
}

/** Forma del resultado de la lectura del pedido (paso 1) — unión discriminada por `encontrado`. */
type ResultadoLeerPedido =
  | { encontrado: false }
  | {
      encontrado: true;
      estadoActual: EstadoPedido;
      tipoPedido: string | null;
      sellerIdReal: string;
      advertencia: string | null;
    };

/** Forma del resultado de reflejar la cancelación (paso 2). */
interface ResultadoReflejarCancelacion {
  transicionAplicada: boolean;
}

const COLUMNAS_BASE = ["id", "estado", "tipo_pedido", "seller_id", "driver_id_asignado"] as const;

/**
 * Procesa UNA cancelación detectada en una fuente externa, con toda la lógica
 * de negocio compartida entre ML y el resto de las fuentes. Ver el comentario
 * de cabecera del archivo para el detalle de qué varía por fuente.
 */
export async function procesarCancelacionDetectadaEnFuente(
  ctx: ContextoJobCancelacion,
  datos: DatosCancelacionDetectada,
  identidad: IdentidadCancelacionFuente,
): Promise<Record<string, unknown>> {
  const { pedidoId, tenantId, sellerId, estadoAnterior } = datos;
  const { step, logger, runId } = ctx;

  const columnas = [...COLUMNAS_BASE, ...(identidad.columnasExtra ?? [])].join(", ");

  // Paso 1: leer el estado REAL del pedido — nunca confiar en `estadoAnterior`
  // del evento (puede estar obsoleto: entre la detección y el procesamiento de
  // este job el estado real pudo cambiar).
  const contexto = (await step.run("leer-pedido", async () => {
    const supabase = crearClienteServiceRole();
    const { data: pedido, error } = await supabase
      .from("pedidos")
      .select(columnas)
      .eq("id", pedidoId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) throw new Error(`Error al leer el pedido: ${error.message}`);

    if (!pedido) {
      return { encontrado: false as const };
    }

    const fila = pedido as unknown as Record<string, unknown>;
    return {
      encontrado: true as const,
      estadoActual: fila.estado as EstadoPedido,
      tipoPedido: (fila.tipo_pedido as string | null) ?? null,
      sellerIdReal: fila.seller_id as string,
      advertencia: identidad.advertenciaConsistencia ? identidad.advertenciaConsistencia(fila) : null,
    };
  })) as ResultadoLeerPedido;

  // Defensivo: `integraciones` resuelve pedidoId antes de publicar el evento,
  // así que esto no debería ocurrir. Si el pedido no existe en este tenant no
  // hay nada que reflejar — se registra y se termina SIN reintento (no es un
  // fallo transitorio: reintentar no hace aparecer un pedido inexistente).
  if (!contexto.encontrado) {
    logger.warn(
      `cancelacion-fuente: pedido ${pedidoId} no existe en el tenant ${tenantId} — nada que reflejar.`,
    );
    return { pedidoId, tenantId, resultado: "pedido_no_encontrado" as const };
  }

  // No bloquea (decisión #1: el estado se refleja siempre) — solo deja rastro
  // de que la detección y el pedido resuelto no coinciden, para que se revise
  // el lado de integraciones.
  if (contexto.advertencia) {
    logger.warn(`cancelacion-fuente: pedido ${pedidoId}: ${contexto.advertencia}`);
  }

  // Idempotencia — el caso más común de "evento repetido": ya está cancelado,
  // no-op total, sin nueva bitácora ni incidencia.
  if (contexto.estadoActual === "cancelado") {
    logger.info(`cancelacion-fuente: pedido ${pedidoId} ya estaba cancelado — no-op.`);
    return { pedidoId, tenantId, resultado: "ya_cancelado" as const };
  }

  // Estado terminal DISTINTO de 'cancelado' (entregado/entregado_manual/
  // devuelto): la máquina de estados no admite salidas desde un terminal —
  // invariante que este job no rompe. Se registra la anomalía para revisión
  // humana y se termina sin reintento.
  if (ESTADOS_TERMINALES.includes(contexto.estadoActual)) {
    await step.run("registrar-anomalia-terminal", async () => {
      const supabase = crearClienteServiceRole();
      await registrarEnBitacora(supabase, {
        tenantId,
        actorUsuarioId: null,
        actorTipo: "sistema",
        accion: identidad.accionAnomalia,
        entidadTipo: "pedido",
        entidadId: pedidoId,
        detalle: {
          ...identidad.detalleFuente,
          estado_actual_rutax: contexto.estadoActual,
          estado_anterior_reportado: estadoAnterior,
          motivo:
            `${identidad.nombreFuenteLegible} reportó la cancelación del pedido, pero el pedido ya está ` +
            `'${contexto.estadoActual}' en Rutax (estado terminal) — no se puede reflejar sin romper la ` +
            `máquina de estados. Requiere revisión manual.`,
          job_run_id: runId,
        },
      });
    });

    logger.warn(
      `cancelacion-fuente: pedido ${pedidoId} ya está en estado terminal '${contexto.estadoActual}' — ` +
        "la cancelación NO se refleja (requiere revisión manual).",
    );
    return {
      pedidoId,
      tenantId,
      resultado: "terminal_previo_no_reflejado" as const,
      estadoActual: contexto.estadoActual,
    };
  }

  // A partir de aquí, estadoActual ∈ {pendiente_asignacion, asignado, en_ruta,
  // fallido, fallido_manual} — todos vivos.
  const estadoAntesDeLaCancelacion = contexto.estadoActual;
  const requiereIncidenciaDeRetiro = ESTADOS_QUE_REQUIEREN_INCIDENCIA_DE_RETIRO.has(
    estadoAntesDeLaCancelacion,
  );

  // Paso 2: reflejar la cancelación — bitácora ANTES del efecto (CLAUDE.md:
  // "bitácora antes que efectos externos"), luego el ÚNICO camino de escritura
  // de estado (`actualizarEstadoPedido`), y por último desactivar la
  // asignación activa (mismo orden y misma razón que `cancelarPedido`: el
  // evento financiero necesita `driver_id_asignado` ANTES de que la
  // desasignación lo ponga en null).
  const resultadoCancelacion = (await step.run("reflejar-cancelacion", async () => {
    const supabase = crearClienteServiceRole();

    await registrarEnBitacora(supabase, {
      tenantId,
      actorUsuarioId: null,
      actorTipo: "sistema",
      accion: identidad.accionCancelada,
      entidadTipo: "pedido",
      entidadId: pedidoId,
      detalle: {
        ...identidad.detalleFuente,
        tipo_pedido: contexto.tipoPedido,
        estado_anterior_rutax: estadoAntesDeLaCancelacion,
        estado_anterior_reportado: estadoAnterior,
        job_run_id: runId,
      },
    });

    try {
      await actualizarEstadoPedido(supabase, {
        pedidoId,
        tenantId,
        estadoNuevo: "cancelado",
        estadoEsperado: estadoAntesDeLaCancelacion,
        ejecutor: "sistema",
        // Sin actuadoPorUsuarioId ni motivo, A PROPÓSITO: nadie humano canceló
        // y no se consulta a la fuente el motivo — las columnas
        // cancelado_por_usuario_id/motivo_cancelacion quedan NULL. La bitácora
        // de arriba es lo único que documenta el origen externo de esta
        // cancelación.
      });
    } catch (err) {
      if (err instanceof ErrorConflicto) {
        // Otra invocación concurrente (reintento de Inngest, evento
        // duplicado) ya movió el pedido — no es un fallo real, es la carrera
        // resolviéndose. La invocación ganadora (o su propio paso 3) es la
        // que decide la incidencia; esta se retira sin más efectos.
        logger.info(
          `cancelacion-fuente: conflicto de optimistic locking en pedido ${pedidoId} — otra ` +
            "invocación ya lo canceló. Tratado como no-op.",
        );
        return { transicionAplicada: false as const };
      }
      throw err;
    }

    // Mismo efecto colateral bloqueante que `cancelarPedido`: si no se
    // desactiva, la parada cancelada sigue viva en la app del conductor.
    await desactivarAsignacionActivaPedido(supabase, pedidoId, tenantId);

    return { transicionAplicada: true as const };
  })) as ResultadoReflejarCancelacion;

  // Paso 3 (condicional): el conductor llevaba el bulto físico — levantar una
  // incidencia para que el coordinador coordine la devolución. Solo si la
  // transición ocurrió en ESTA invocación: si otra invocación ganó la carrera
  // del paso 2, se confía en que ella decide esto.
  if (resultadoCancelacion.transicionAplicada && requiereIncidenciaDeRetiro) {
    await step.run("abrir-incidencia-retiro-pendiente", async () => {
      const supabase = crearClienteServiceRole();
      await abrirIncidencia(supabase, {
        tenantId,
        pedidoId,
        sellerId: contexto.sellerIdReal || sellerId,
        // Sin tipo propio en el catálogo (operacion/tipos.ts TIPOS_INCIDENCIA)
        // para "cancelado en la fuente con el conductor en camino" — se usa
        // 'otro' con descripción explícita, mismo patrón que ya usa
        // `pedidos.ts` para incidencias abiertas automáticamente por el
        // sistema.
        tipo: "otro",
        descripcion:
          `Pedido cancelado en ${identidad.nombreFuenteLegible} mientras el conductor lo llevaba ` +
          `(estaba '${estadoAntesDeLaCancelacion}'). Hay que coordinar la devolución del bulto.`,
        esAccionManual: false,
      });
    });
  }

  logger.info(
    `cancelacion-fuente: pedido ${pedidoId} procesado. estadoAnterior=${estadoAntesDeLaCancelacion}, ` +
      `transicionAplicada=${resultadoCancelacion.transicionAplicada}, ` +
      `incidenciaAbierta=${resultadoCancelacion.transicionAplicada && requiereIncidenciaDeRetiro}.`,
  );

  return {
    pedidoId,
    tenantId,
    resultado: resultadoCancelacion.transicionAplicada
      ? ("cancelado" as const)
      : ("conflicto_concurrente" as const),
    estadoAnterior: estadoAntesDeLaCancelacion,
    incidenciaAbierta: resultadoCancelacion.transicionAplicada && requiereIncidenciaDeRetiro,
  };
}
