"use server";

/**
 * Server Actions — Onboarding "Conectar banco para cobranza" (flujo 1 de
 * Fintoc, capa "pagado" del motor entrega→dinero).
 *
 * Patrón EXACTO del onboarding DTE (`onboarding/dte/actions.ts`):
 *   - Capa delgada de "ruta de servidor": valida sesión + capacidad
 *     (misma capacidad financiera que gobierna la conciliación,
 *     `puedeVerConciliacion`), persiste en `identidad.courier_config_cobranza`.
 *   - El secreto (`link_token`) se cifra con el mecanismo central
 *     `integraciones/secretos` (tipo `token_link_fintoc`) — única vía de cifrado.
 *   - REGLA DE ORO: el valor cifrado NUNCA vuelve al cliente. Esta pantalla solo
 *     conoce metadatos (`cuenta_banco_alias`, `estado_conexion`) — jamás el token.
 *   - El núcleo/UI NUNCA llama a Fintoc directo.
 *
 * ⚠️ AQUÍ NO SE GUARDA LA CONEXIÓN, Y NO ES UN DESCUIDO. El `link_token` del
 * producto "movements" no llega nunca al navegador: Fintoc lo manda UNA sola vez,
 * por la notificación al `webhookUrl`, y jamás se puede volver a pedir («the Link
 * Token is not saved by Fintoc, and can never be retrieved again»). Así que esta
 * pantalla solo ABRE el flujo —`prepararConexionBanco` emite un ticket de un solo
 * uso y devuelve la URL de notificación con su nonce— y después SONDEA
 * `obtenerEstadoConfiguracionCobranza` hasta que el webhook aterrice. Quien
 * escribe `courier_config_cobranza` y la bitácora es
 * `/api/webhooks/fintoc/[tenantId]`.
 *
 * Hubo una versión anterior que esperaba un `exchangeToken` en `onSuccess` y lo
 * canjeaba por `POST /links/exchange`. Ese token NO existe en este producto (el
 * payload real observado es `{id, link:{id}}`): la action se retiró entera.
 */

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeVerConciliacion } from "@/modules/identidad/capacidades";
import { iniciarConexionPendienteCobranza } from "@/modules/integraciones/pagos";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";

// -----------------------------------------------------------------------------
// Estado que el cliente necesita para renderizar
// -----------------------------------------------------------------------------

export interface EstadoConfiguracionCobranza {
  /** Estado de la conexión Fintoc del courier. */
  estadoConexion: "desconectado" | "conectado" | "error" | "revocado";
  /** Alias legible (banco + número enmascarado), o null si aún no se conectó. */
  cuentaBancoAlias: string | null;
  /** `true` si hay un link_token guardado (NUNCA se expone el valor). */
  bancoConectado: boolean;
}

export async function obtenerEstadoConfiguracionCobranza(): Promise<
  { ok: true; estado: EstadoConfiguracionCobranza } | { ok: false; mensaje: string }
> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, mensaje: "No hay una sesión activa." };
  }

  // service_role: courier_config_cobranza es P1 estricta (solo internos); el
  // filtro tenant_id es defensa en profundidad además de la RLS.
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema("identidad")
    .from("courier_config_cobranza")
    .select("estado_conexion, cuenta_banco_alias, link_token_ref")
    .eq("tenant_id", sesion.usuario.tenantId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      mensaje: "No pudimos cargar tu configuración de cobranza por un problema de nuestro sistema.",
    };
  }

  if (!data) {
    return {
      ok: true,
      estado: { estadoConexion: "desconectado", cuentaBancoAlias: null, bancoConectado: false },
    };
  }

  return {
    ok: true,
    estado: {
      estadoConexion: (data.estado_conexion as EstadoConfiguracionCobranza["estadoConexion"]) ?? "desconectado",
      cuentaBancoAlias: (data.cuenta_banco_alias as string | null) ?? null,
      bancoConectado: Boolean(data.link_token_ref),
    },
  };
}

// -----------------------------------------------------------------------------
// Preparar la conexión — emite el ticket de un solo uso y devuelve la URL de
// notificación que el widget necesita. Se llama ANTES de `widget.open()`.
// -----------------------------------------------------------------------------

export type PrepararConexionResultado =
  | { ok: true; webhookUrl: string }
  | { ok: false; tipo: "permiso" | "desconocido"; mensaje: string };

export async function prepararConexionBanco(): Promise<PrepararConexionResultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    return { ok: false, tipo: "permiso", mensaje: "No hay una sesión activa." };
  }
  if (!puedeVerConciliacion(sesion.usuario)) {
    return {
      ok: false,
      tipo: "permiso",
      mensaje: "No tienes permiso para configurar la cobranza — contacta al dueño de la cuenta.",
    };
  }

  try {
    const { webhookUrl } = await iniciarConexionPendienteCobranza({
      tenantId: sesion.usuario.tenantId,
      actorUsuarioId: sesion.usuarioId,
    });
    return { ok: true, webhookUrl };
  } catch {
    // El detalle (variable de entorno faltante, error de BD) no va al cliente.
    return {
      ok: false,
      tipo: "desconocido",
      mensaje: "No pudimos iniciar la conexión con tu banco. Intenta de nuevo.",
    };
  }
}
