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
