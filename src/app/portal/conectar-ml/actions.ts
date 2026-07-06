"use server";

/**
 * Server Actions — Pantallas M/N (conectar/reconectar con Mercado Libre,
 * §3.2/§3.3, RF-010/RF-015/RF-048).
 *
 * Capa delgada: arma la URL de autorización vía `iniciarAutorizacion` (puerto
 * `integraciones/ml`, ya existente) y gestiona el `state` anti-CSRF — que ese
 * mismo puerto documenta como responsabilidad EXPLÍCITA del llamador (ver
 * `tipos.ts`: "Este puerto NO lo genera — es responsabilidad de la capa que
 * orquesta el flujo HTTP"). Aquí, y solo aquí, se genera/persiste.
 *
 * Persistencia del `state`: cookie httpOnly de corta vida (10 min — tiempo
 * generoso para que el seller complete el login en ML sin abrir la ventana a
 * un CSRF de larga duración). Se valida en el route handler del callback
 * (`/oauth/ml/callback/route.ts`) antes de canjear el `code`.
 *
 * `redirectUri`: se arma a partir del host de la petición (mismo patrón que
 * `auth/confirm/route.ts` con `origin`), porque no existe (todavía) una
 * variable de entorno de URL pública del sitio — debe coincidir EXACTAMENTE
 * con la registrada en la app de ML (`developers.mercadolibre.cl`).
 */

import { cookies, headers } from "next/headers";
import { randomBytes } from "node:crypto";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { puedeGestionarConexionMlPropia } from "@/modules/identidad/capacidades";
import { iniciarAutorizacion, obtenerConexionesPorSeller } from "@/modules/integraciones/ml";
import {
  COOKIE_CONEXION_ML,
  COOKIE_MODO_ML,
  COOKIE_STATE_ML,
  obtenerUrlBasePublica,
  type ModoConexionMl,
} from "./compartido";

const VIGENCIA_STATE_SEGUNDOS = 10 * 60;

export interface IniciarConexionMlResultado {
  ok: boolean;
  urlAutorizacion?: string;
  mensaje?: string;
}

/**
 * Arma el `redirect_uri` desde la URL base pública canónica (`APP_PUBLIC_URL`
 * si está configurada; si no, el host de la petición). Debe coincidir EXACTO
 * con el registrado en ML y con el que usa el callback al canjear el `code`.
 */
async function construirRedirectUri(): Promise<string> {
  const cabeceras = await headers();
  const protocolo = cabeceras.get("x-forwarded-proto") ?? "https";
  const host = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host");
  const base = obtenerUrlBasePublica(`${protocolo}://${host}`);
  return `${base}/oauth/ml/callback`;
}

/**
 * Dispara el flujo OAuth — usado desde la Pantalla M (conexión inicial, tras la
 * bienvenida), desde "Reconectar" de una tarjeta del panel (RF-015,
 * "self-service de un clic") y desde "Agregar otra cuenta" (modelo 1:N). Misma
 * acción, distinto punto de entrada — exactamente lo que pide §3.2: "no hay una
 * variante 'distinta' de conectar".
 *
 * `conexionId` (SOLO en reconexión): identifica la fila objetivo. SEGURIDAD —
 * antes de aceptarlo se verifica que esa conexión pertenece al seller de la
 * sesión (se busca entre `obtenerConexionesPorSeller`, que ya filtra por
 * seller); si no calza, se ignora en silencio (no se filtra la existencia de
 * filas ajenas). Viaja en una cookie httpOnly junto al `state`, no en la URL.
 */
export async function iniciarConexionMl(
  modo: ModoConexionMl,
  conexionId?: string,
): Promise<IniciarConexionMlResultado> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId || sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    return { ok: false, mensaje: "No hay una sesión de seller activa." };
  }
  if (!puedeGestionarConexionMlPropia(sesion.usuario)) {
    return { ok: false, mensaje: "Tu cuenta no tiene permiso para gestionar esta conexión." };
  }

  const sellerId = sesion.usuario.sellerId;

  // Verificación de propiedad de `conexionId` (reconexión). El seller NO puede
  // reconectar una fila que no es suya: la única fuente confiable es la lista
  // filtrada por su propio seller. Si el id no está entre las suyas, se descarta.
  let conexionIdVerificada: string | null = null;
  if (modo === "reconexion" && conexionId) {
    try {
      const propias = await obtenerConexionesPorSeller(sellerId);
      if (propias.some((c) => c.id === conexionId)) {
        conexionIdVerificada = conexionId;
      }
    } catch {
      // No bloqueamos el reintento por un fallo de esta verificación de contexto:
      // aunque no se transporte el id, el UPDATE del callback resuelve la fila
      // por `(seller_id, ml_user_id)` de la cuenta con que el seller reautoriza.
      conexionIdVerificada = null;
    }
  }

  const state = randomBytes(32).toString("base64url");
  const redirectUri = await construirRedirectUri();

  let urlAutorizacion: string;
  try {
    ({ urlAutorizacion } = iniciarAutorizacion({
      tenantId: sesion.usuario.tenantId,
      sellerId,
      redirectUri,
      state,
    }));
  } catch {
    // `leerCredencialesApp` lanza si `ML_APP_CLIENT_ID`/`SECRET` no están
    // configurados — un problema de NUESTRO sistema, no del seller.
    return {
      ok: false,
      mensaje: "No pudimos iniciar la conexión con Mercado Libre por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
    };
  }

  const almacenCookies = await cookies();
  const opcionesCookie = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: VIGENCIA_STATE_SEGUNDOS,
  };
  almacenCookies.set(COOKIE_STATE_ML, state, opcionesCookie);
  almacenCookies.set(COOKIE_MODO_ML, modo, opcionesCookie);
  if (conexionIdVerificada) {
    almacenCookies.set(COOKIE_CONEXION_ML, conexionIdVerificada, opcionesCookie);
  } else {
    // Higiene: limpiar un id de un flujo anterior para que no se filtre a este.
    almacenCookies.delete(COOKIE_CONEXION_ML);
  }

  return { ok: true, urlAutorizacion };
}
