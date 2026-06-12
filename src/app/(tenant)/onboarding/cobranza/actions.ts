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
 *   - El núcleo/UI NUNCA llama a Fintoc directo: el canje del `exchange_token`
 *     del widget por el `link_token` va por el módulo `integraciones/pagos`
 *     (`canjearExchangeToken`).
 *
 * Auditoría: la conexión de cobranza es una acción de acceso/financiera → se
 * registra en bitácora con el autor (`actorUsuarioId`) antes/después del efecto.
 */

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeVerConciliacion } from "@/modules/identidad/capacidades";
import { cifrarSecreto } from "@/modules/integraciones/secretos";
import { canjearExchangeToken } from "@/modules/integraciones/pagos";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
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
// Conectar banco — canjea el exchange_token del widget y guarda el link_token
// cifrado + courier_config_cobranza.
// -----------------------------------------------------------------------------

export type AccionCobranzaResultado =
  | { ok: true; estado: EstadoConfiguracionCobranza }
  | { ok: false; tipo: "permiso" | "validacion" | "proveedor" | "desconocido"; mensaje: string };

export async function conectarBancoCobranza(exchangeToken: string): Promise<AccionCobranzaResultado> {
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

  const token = (exchangeToken ?? "").trim();
  if (!token) {
    return {
      ok: false,
      tipo: "validacion",
      mensaje: "No recibimos la confirmación del banco. Vuelve a intentar la conexión.",
    };
  }

  const tenantId = sesion.usuario.tenantId;

  // 1. Canjear el exchange_token por el link_token vía el módulo integraciones
  //    (el núcleo/UI nunca toca el SDK de Fintoc).
  let canje;
  try {
    canje = await canjearExchangeToken(token);
  } catch {
    return {
      ok: false,
      tipo: "proveedor",
      mensaje:
        "No pudimos confirmar la conexión con tu banco. Es posible que el proceso haya expirado — vuelve a intentarlo.",
    };
  }

  // 2. Cifrar el link_token (secreto por-tenant) con el mecanismo central.
  let referenciaLinkToken: string;
  try {
    const cifrado = await cifrarSecreto({
      tenantId,
      tipoSecreto: "token_link_fintoc",
      valor: canje.linkToken,
      venceEn: null,
      metadata: { proposito: "link_token_cobranza_fintoc" },
    });
    referenciaLinkToken = cifrado.referenciaExternaId;
  } catch {
    return {
      ok: false,
      tipo: "desconocido",
      mensaje:
        "Confirmamos la conexión pero no pudimos guardarla de forma segura por un problema de nuestro sistema. Intenta de nuevo.",
    };
  }

  // 3. Persistir referencia opaca + metadatos NO sensibles en courier_config_cobranza.
  const supabase = crearClienteServiceRole();
  const { error } = await supabase
    .schema("identidad")
    .from("courier_config_cobranza")
    .upsert(
      {
        tenant_id: tenantId,
        link_token_ref: referenciaLinkToken,
        cuenta_banco_alias: canje.cuentaBancoAlias,
        estado_conexion: "conectado",
        actualizado_en: new Date().toISOString(),
      },
      { onConflict: "tenant_id" },
    );

  if (error) {
    return {
      ok: false,
      tipo: "desconocido",
      mensaje:
        "Ciframos la conexión pero no pudimos asociarla por un problema de nuestro sistema. Intenta de nuevo.",
    };
  }

  // 4. Bitácora — acción de acceso/financiera, con autor (RNF-04). El detalle
  //    NO incluye el token: solo metadatos no sensibles.
  await registrarEnBitacora(supabase, {
    tenantId,
    actorUsuarioId: sesion.usuarioId,
    actorTipo: "usuario",
    accion: "cobranza.banco_conectado",
    entidadTipo: "courier_config_cobranza",
    entidadId: tenantId,
    detalle: { cuenta_banco_alias: canje.cuentaBancoAlias },
  });

  return {
    ok: true,
    estado: {
      estadoConexion: "conectado",
      cuentaBancoAlias: canje.cuentaBancoAlias,
      bancoConectado: true,
    },
  };
}
