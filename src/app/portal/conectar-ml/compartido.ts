/**
 * Tipos y constantes compartidos entre el route handler de callback
 * (`/oauth/ml/callback/route.ts`) y la pantalla de conexión
 * (`/portal/conectar-ml`) — Pantallas M/N (§3.2/§3.3).
 *
 * Vive en un módulo aparte, sin importar nada de ninguno de los dos lados,
 * para evitar el ciclo de imports `route.ts → conectar-ml/actions.ts →
 * (tipos de route.ts)` que rompía el bundling (Turbopack resuelve mal los
 * ciclos entre Route Handlers y Server Actions/Componentes).
 */

export const COOKIE_STATE_ML = "ml_oauth_state";
export const COOKIE_MODO_ML = "ml_oauth_modo";

/**
 * URL base pública canónica de la app, para construir el `redirect_uri` de
 * OAuth y las redirecciones del callback.
 *
 * Por qué no derivarla siempre de los headers de la petición: detrás de un
 * túnel (cloudflared/ngrok) o de algunos proxys, el `Host` que llega al server
 * es `localhost`, no el dominio público — y el `redirect_uri` de OAuth DEBE
 * coincidir EXACTAMENTE con el registrado en Mercado Libre, tanto al iniciar
 * la autorización como al canjear el `code`. Una URL canónica configurable
 * (`APP_PUBLIC_URL`) elimina esa ambigüedad; es también la práctica correcta
 * en producción (dominio fijo y no spoofeable por headers).
 *
 * Si `APP_PUBLIC_URL` no está definida, cae al origin derivado de la petición
 * (comportamiento previo, válido cuando el host público sí llega tal cual).
 */
export function obtenerUrlBasePublica(fallbackOrigin: string): string {
  const configurada = process.env.APP_PUBLIC_URL?.trim();
  if (configurada) return configurada.replace(/\/+$/, "");
  return fallbackOrigin.replace(/\/+$/, "");
}

export type ModoConexionMl = "conexion_inicial" | "reconexion";

/**
 * Ramificaciones de la Pantalla N (tabla §3.2) que el route handler de
 * callback resuelve y comunica vía `?resultado=` — más dos variantes que la
 * tabla no nombra explícitamente pero que el callback real puede producir
 * (`estado_invalido`: problema de continuidad de sesión/CSRF;
 * `error_sistema`: cualquier fallo no clasificado, nunca un mensaje genérico).
 */
export type ResultadoCallbackMl =
  | "exito"
  | "cuenta_en_otro_courier"
  | "cancelado"
  | "cuenta_colaborador"
  | "error_transitorio"
  | "error_sistema"
  | "estado_invalido";

export const RESULTADOS_CALLBACK_ML: ResultadoCallbackMl[] = [
  "exito",
  "cuenta_en_otro_courier",
  "cancelado",
  "cuenta_colaborador",
  "error_transitorio",
  "error_sistema",
  "estado_invalido",
];
