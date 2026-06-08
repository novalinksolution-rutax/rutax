/**
 * Job 3 · ml/procesarShipmentActualizado
 * =====================================================================
 * Trigger: evento `ml/shipment.actualizado`
 * (publicado por el webhook handler y por el job de polling de respaldo)
 *
 * Lógica:
 * 1. Resolver qué seller tiene este shipment_id (consulta operacion.pedidos).
 * 2. Obtener el token del seller y llamar GET /shipments/{id} via el puerto ML.
 * 3. Traducir el status de ML al estado interno.
 * 4. Llamar `actualizarEstadoPedido` del módulo `operacion`.
 *
 * Idempotencia:
 * - Si el pedido ya está en el estado traducido → no-op.
 * - Si `actualizarEstadoPedido` lanza `ErrorConflicto` (optimistic locking
 *   perdido ante otra ejecución concurrente) → loguear y terminar sin reintento.
 *
 * SEGURIDAD: el access token nunca aparece en logs ni en el payload del evento.
 */

import { inngest } from "@/lib/inngest/cliente";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { descifrarSecreto } from "../../secretos";
import { ML_API_BASE_URL } from "../cliente-http";
import { traducirEstadoMl } from "../traduccion-estados";
import type {
  ActualizarEstadoEntrada,
  ErrorConflicto,
  EstadoPedidoInterno,
  PedidoResumen,
} from "../tipos-operacion";

/** Respuesta del endpoint /shipments/{id} de ML (campos que usamos). */
interface RespuestaShipmentMl {
  id: number | string;
  status: string;
  substatus?: string | null;
}

/** Fila interna de conexión con la referencia al access token. */
interface FilaConexionToken {
  id: string;
  access_token_ref: string | null;
  estado_salud: string;
}

/**
 * Inyectable para tests: la función real de `actualizarEstadoPedido` del módulo
 * `operacion`. En producción se importa; en tests se provee un mock.
 * El módulo `operacion` aún está siendo construido por el agente `backend`
 * en paralelo — este patrón de inyección desacopla los dos módulos.
 */
export type FnActualizarEstado = (entrada: ActualizarEstadoEntrada) => Promise<void>;

/**
 * Función real de actualización de estado — apunta al módulo `operacion`.
 * Sobrescribible en tests con `setFnActualizarEstado`.
 *
 * Por defecto lanza un error descriptivo hasta que el agente `backend`
 * complete el módulo `operacion` y se conecte la importación real.
 */
async function actualizarEstadoPedidoReal(entrada: ActualizarEstadoEntrada): Promise<void> {
  // Al completarse el módulo `operacion`, reemplazar este cuerpo con:
  // import { actualizarEstadoPedido } from "@/modules/operacion";
  // return actualizarEstadoPedido(entrada);
  void entrada; // evitar "unused variable" mientras es stub
  throw new Error(
    "actualizarEstadoPedido aún no implementado en el módulo `operacion`. " +
      "El agente `backend` debe completar ese módulo.",
  );
}

/** Referencia mutable para inyección de dependencia en tests. */
let fnActualizarEstadoActual: FnActualizarEstado = actualizarEstadoPedidoReal;

/**
 * Permite a los tests sustituir la función de actualización de estado sin
 * importar el módulo `operacion` real (que está siendo construido en paralelo).
 * Solo debe llamarse en contexto de pruebas — no en código de producción.
 */
export function setFnActualizarEstado(fn: FnActualizarEstado): void {
  fnActualizarEstadoActual = fn;
}

export function resetFnActualizarEstado(): void {
  fnActualizarEstadoActual = actualizarEstadoPedidoReal;
}

export const jobProcesarShipmentActualizado = inngest.createFunction(
  {
    id: "ml/procesarShipmentActualizado",
    name: "ML · Procesar actualización de shipment",
    triggers: [{ event: "ml/shipment.actualizado" }],
    retries: 4,
  },
  async ({ event, step, logger }) => {
    const { shipmentId } = event.data as { shipmentId: string; userId: string; timestamp: string };
    const fnActualizar = fnActualizarEstadoActual;

    // Paso 1: resolver qué seller tiene este shipment en BD.
    const pedido = await step.run("resolver-pedido", async () => {
      const supabase = crearClienteServiceRole();

      const { data, error } = await supabase
        .schema("operacion")
        .from("pedidos")
        .select("id, tenant_id, seller_id, ml_shipment_id, estado, estado_ml")
        .eq("ml_shipment_id", shipmentId)
        .maybeSingle();

      if (error) {
        throw new Error(`Error al buscar pedido por shipment_id: ${error.message}`);
      }

      if (!data) {
        // El shipment no existe en nuestro sistema — ignorar silenciosamente.
        // Puede ocurrir si ML notifica un envío de un seller no conectado.
        logger.info(
          `Shipment ${shipmentId} no encontrado en BD. Puede ser de un seller no conectado.`,
        );
        return null;
      }

      return {
        id: data.id as string,
        tenantId: data.tenant_id as string,
        sellerId: data.seller_id as string,
        mlShipmentId: data.ml_shipment_id as string,
        estado: data.estado as EstadoPedidoInterno,
        estadoMl: data.estado_ml as string | null,
      } satisfies PedidoResumen;
    });

    if (!pedido) return { resultado: "shipment_no_encontrado" };

    // Paso 2: obtener el token del seller y consultar ML.
    const estadoMl = await step.run("consultar-ml", async () => {
      const supabase = crearClienteServiceRole();

      // Obtener el access_token_ref de la conexión del seller
      const { data: conexionData, error: conexionError } = await supabase
        .schema("identidad")
        .from("conexiones_seller_ml")
        .select("id, access_token_ref, estado_salud")
        .eq("seller_id", pedido.sellerId)
        .maybeSingle();

      if (conexionError) {
        throw new Error(`Error al buscar conexión del seller: ${conexionError.message}`);
      }

      const conexion = conexionData as FilaConexionToken | null;

      if (!conexion?.access_token_ref) {
        throw new Error(
          `No hay conexión ML activa para el seller ${pedido.sellerId}. ` +
            "No se puede consultar el shipment.",
        );
      }

      if (conexion.estado_salud === "desvinculada") {
        throw new Error(
          `Conexión ML del seller ${pedido.sellerId} está desvinculada. ` +
            "El sondeo de salud o el job de refresco gestionará la reconexión.",
        );
      }

      // Descifrar token SOLO para este request
      const descifrado = await descifrarSecreto(conexion.access_token_ref);
      if (typeof descifrado.valor !== "string") {
        throw new Error("access_token descifrado no es texto");
      }

      const respuesta = await fetch(`${ML_API_BASE_URL}/shipments/${shipmentId}`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${descifrado.valor}`,
          accept: "application/json",
        },
      });

      if (!respuesta.ok) {
        if (respuesta.status === 404) {
          return null; // Shipment no existe en ML — ignorar
        }
        throw new Error(
          `ML respondió ${respuesta.status} para /shipments/${shipmentId}`,
        );
      }

      const datos = (await respuesta.json()) as RespuestaShipmentMl;
      // El token en claro sale de scope aquí.
      return datos.status;
    });

    if (!estadoMl) return { resultado: "shipment_no_existe_en_ml" };

    // Paso 3: traducir estado y verificar idempotencia.
    const estadoInterno = traducirEstadoMl(estadoMl);

    if (!estadoInterno) {
      logger.info(
        `Estado ML '${estadoMl}' para shipment ${shipmentId} no tiene traducción. Ignorando.`,
      );
      return { resultado: "estado_sin_traduccion", estadoMl };
    }

    // Idempotencia: si el pedido ya está en ese estado, no hacer nada.
    if (pedido.estado === estadoInterno) {
      logger.info(
        `Pedido ${pedido.id} ya está en estado '${estadoInterno}'. No-op idempotente.`,
      );
      return { resultado: "ya_en_estado", estado: estadoInterno };
    }

    // Paso 4: actualizar el estado del pedido en el módulo `operacion`.
    await step.run("actualizar-estado-pedido", async () => {
      try {
        await fnActualizar({
          pedidoId: pedido.id,
          estadoNuevo: estadoInterno,
          estadoEsperado: pedido.estado,
          actuadoPor: "sistema_ml",
          motivo: `Actualización desde ML: status=${estadoMl}`,
        });

        // También actualizar estado_ml / ultima_sync_ml_en en la fila del pedido
        const supabase = crearClienteServiceRole();
        await supabase
          .schema("operacion")
          .from("pedidos")
          .update({
            estado_ml: estadoMl,
            ultima_sync_ml_en: new Date().toISOString(),
          })
          .eq("id", pedido.id);
      } catch (error) {
        // ErrorConflicto: otra ejecución ya ganó la carrera — no reintentar.
        if ((error as ErrorConflicto).name === "ErrorConflicto") {
          logger.warn(
            `Pedido ${pedido.id}: condición de carrera resuelta por otra ejecución. ` +
              "Terminando sin reintento.",
          );
          // Retornar un valor para no lanzar (Inngest no reintentará)
          return { conflicto: true };
        }
        throw error; // Otros errores → Inngest reintenta
      }
    });

    return { resultado: "actualizado", pedidoId: pedido.id, estadoNuevo: estadoInterno };
  },
);
