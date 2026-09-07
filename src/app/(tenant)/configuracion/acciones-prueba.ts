"use server";

/**
 * Herramienta TEMPORAL de QA: crea pedidos same-day de prueba en bloque.
 * =============================================================================
 *
 * Existe para no tener que llenar el formulario de alta una y otra vez cuando se
 * necesita volumen de pedidos same-day para probar asignación, ruteo y el mapa
 * del conductor. NO es una funcionalidad de producto — vive detrás del mismo
 * gate que el alta real (`puedeAjustarOperacionDiaria`) y su panel está marcado
 * como herramienta de prueba.
 *
 * Reusa `crearPedidoSameDay` (el MISMO camino del alta real): tarifa vigente,
 * ventana de corte, bitácora, código interno y evento de geocodificación. Así
 * un pedido de prueba es indistinguible de uno real salvo por el nombre y la
 * dirección de relleno — que es justo lo que se quiere para probar de verdad.
 *
 * Se llama por TANDAS desde el cliente (mismo patrón que la conciliación en
 * lote): el contador «X de N» que ve quien la usa cuenta pedidos ya escritos en
 * base, no una estimación.
 */

import { exigirSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { puedeAjustarOperacionDiaria } from "@/modules/identidad/capacidades";
import { crearPedidoSameDay, cancelarPedido } from "@/modules/operacion/pedidos";
import { guardarCoordenadaElegida } from "@/modules/operacion/coordenada-elegida";
import { puntoAleatorioEnComuna } from "@/lib/geo/punto-en-comuna";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { revalidatePath } from "next/cache";

/** Tope por llamada: el cliente pide de a pocos para poder mostrar el avance. */
const TOPE_POR_TANDA = 5;

export type ResultadoPrueba =
  | { ok: true; creados: number }
  | { ok: false; creados: number; mensaje: string };

/**
 * Crea `cantidad` pedidos same-day de prueba (tope `TOPE_POR_TANDA`) para el
 * seller y la comuna dados. Devuelve cuántos alcanzó a crear: si el seller no
 * tiene tarifa same-day, `crearPedidoSameDay` lanza y se reporta con los que sí
 * se crearon (0 en la primera tanda).
 */
export async function actionCrearSameDayPrueba(
  sellerId: string,
  comuna: string,
  cantidad: number,
): Promise<ResultadoPrueba> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { ok: false, creados: 0, mensaje: "No hay sesión activa." };
  }
  if (!puedeAjustarOperacionDiaria(sesion.usuario)) {
    return { ok: false, creados: 0, mensaje: "No tienes permiso para crear pedidos same-day." };
  }

  if (!sellerId) {
    return { ok: false, creados: 0, mensaje: "Elige un seller." };
  }
  if (!COMUNAS_RM.includes(comuna as (typeof COMUNAS_RM)[number])) {
    return { ok: false, creados: 0, mensaje: "Comuna no válida." };
  }

  const n = Math.min(Math.max(1, Math.floor(cantidad)), TOPE_POR_TANDA);
  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();

  let creados = 0;
  try {
    for (let i = 0; i < n; i++) {
      // Coordenada real al azar dispersa por la comuna: así el pedido entra al
      // motor de ruteo y al mapa del circuito como cualquier real, sin depender
      // de geocodificar una dirección ficticia (que no se podría ubicar). El
      // nombre y la dirección de texto pueden repetirse a propósito.
      const punto = puntoAleatorioEnComuna(comuna);
      const numero = 100 + Math.floor(Math.random() * 9800);
      const { pedido } = await crearPedidoSameDay(cliente, {
        tenantId,
        sellerId,
        destinatarioNombre: `Prueba ${comuna} #${numero}`,
        destinatarioDireccion: `${comuna} ${numero}`,
        destinatarioComuna: comuna,
        instruccionesEntrega: "Pedido de prueba generado desde Configuración.",
        actorUsuarioId: sesion.usuarioId,
      });

      // Escribir la coordenada al azar como si el autocompletado la hubiera
      // resuelto (geo_estado='resuelto'). Falla en silencio a propósito: si no
      // sale, el job geocodifica la dirección de texto — el pedido igual existe.
      if (punto) {
        await guardarCoordenadaElegida(cliente, {
          tenantId,
          pedidoId: pedido.id,
          sellerId,
          lat: punto.lat,
          long: punto.long,
          comunaDeclarada: comuna,
          comunaResuelta: comuna,
        });
      }
      creados++;
    }
  } catch (err) {
    return {
      ok: false,
      creados,
      mensaje: err instanceof Error ? err.message : "Error al crear el pedido de prueba.",
    };
  }

  if (creados > 0) revalidatePath("/operaciones");
  return { ok: true, creados };
}

// =============================================================================
// Cancelar en lote los same-day activos (limpieza de pruebas)
// =============================================================================

/** Estados same-day que un rol interno puede cancelar (ver maquina-estados). */
const ESTADOS_CANCELABLES = [
  "pendiente_asignacion",
  "asignado",
  "en_ruta",
  "fallido",
  "fallido_manual",
] as const;

/** Motivo fijo que pediste para la limpieza. */
const MOTIVO_LIMPIEZA = "este era un pedido de prueba";

/** Tope por tanda: cancelar es más pesado (bitácora + evento por pedido). */
const TOPE_CANCELAR = 10;

/** Cuántos pedidos same-day activos hay hoy en el tenant. */
export async function actionContarSameDayActivos(): Promise<number> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) return 0;
  if (!puedeAjustarOperacionDiaria(sesion.usuario)) return 0;

  const cliente = crearClienteServiceRole();
  const { count } = await cliente
    .schema("operacion")
    .from("pedidos")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", sesion.usuario.tenantId)
    .eq("tipo_pedido", "same_day")
    .in("estado", ESTADOS_CANCELABLES as unknown as string[]);
  return count ?? 0;
}

export type ResultadoCancelacion = {
  /** Cancelados en ESTA tanda. */
  cancelados: number;
  /** Fallidos en esta tanda (se reintenta en la próxima). */
  fallidos: number;
  /** Cuántos quedan activos tras la tanda (0 = terminó). */
  restantes: number;
  mensaje?: string;
};

/**
 * Cancela una tanda de same-day activos (tope `TOPE_CANCELAR`) con el motivo
 * fijo de limpieza. Itera por `cancelarPedido` —una entrada de bitácora por
 * pedido, con su autor, nunca un UPDATE masivo anónimo (CLAUDE.md §lote)— y
 * devuelve cuántos quedan para que el cliente muestre el avance y reintente.
 */
export async function actionCancelarSameDayActivos(): Promise<ResultadoCancelacion> {
  const sesion = await exigirSesionActual();
  if (!sesion.usuario.tenantId) {
    return { cancelados: 0, fallidos: 0, restantes: 0, mensaje: "No hay sesión activa." };
  }
  if (!puedeAjustarOperacionDiaria(sesion.usuario)) {
    return { cancelados: 0, fallidos: 0, restantes: 0, mensaje: "No tienes permiso para cancelar pedidos." };
  }

  const tenantId = sesion.usuario.tenantId;
  const cliente = crearClienteServiceRole();

  const { data, error } = await cliente
    .schema("operacion")
    .from("pedidos")
    .select("id, estado")
    .eq("tenant_id", tenantId)
    .eq("tipo_pedido", "same_day")
    .in("estado", ESTADOS_CANCELABLES as unknown as string[])
    .limit(TOPE_CANCELAR);

  if (error) {
    return { cancelados: 0, fallidos: 0, restantes: 0, mensaje: `Error al leer pedidos: ${error.message}` };
  }

  const lote = (data ?? []) as { id: string; estado: string }[];
  let cancelados = 0;
  let fallidos = 0;

  for (const p of lote) {
    try {
      await cancelarPedido(
        cliente,
        {
          pedidoId: p.id,
          tenantId,
          estadoEsperado: p.estado as never,
          ejecutor: "interno",
          actuadoPorUsuarioId: sesion.usuarioId,
          motivo: MOTIVO_LIMPIEZA,
        },
        sesion.usuario,
      );
      cancelados++;
    } catch {
      // Una carrera (otro proceso lo movió) o un estado no cancelable no debe
      // frenar el lote: se cuenta como fallido y se reintenta en la próxima
      // tanda (o se reporta si ya no baja).
      fallidos++;
    }
  }

  const restantes = await actionContarSameDayActivos();
  if (cancelados > 0) revalidatePath("/operaciones");
  return { cancelados, fallidos, restantes };
}
