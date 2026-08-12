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
 * Id de la conexión objetivo de una RECONEXIÓN (modelo 1:N — el seller puede
 * tener varias cuentas). Viaja junto al `state` anti-CSRF para que el callback
 * sepa QUÉ fila reconectar. La resolución dura del UPDATE ya la hace el puerto
 * por `(seller_id, ml_user_id)` de la respuesta de ML (la cuenta con la que el
 * seller volvió a autorizar); este id es la pista del contexto de origen y se
 * verifica contra el seller de la sesión antes de confiar en él (nunca se
 * escribe una fila que no sea del seller). Ausente en alta/conexión inicial.
 */
export const COOKIE_CONEXION_ML = "ml_oauth_conexion";

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

/**
 * Tope de cuentas de Mercado Libre que un seller puede conectar — única
 * fuente de verdad en TypeScript para este número (la usan tanto el panel de
 * conexiones como las pantallas de conectar-ml). El límite duro real lo
 * impone un trigger en `identidad.conexiones_seller_ml` (`supabase/migrations/`);
 * este valor debe coincidir con el de esa migración.
 */
export const MAX_CUENTAS_ML = 10;

/**
 * Punto de entrada al flujo OAuth. Tres variantes bajo el modelo 1:N:
 *   - `conexion_inicial` — el seller conecta su PRIMERA cuenta (aún no tiene
 *     ninguna fila en `conexiones_seller_ml`).
 *   - `reconexion` — vuelve a autorizar una cuenta EXISTENTE que se desvinculó
 *     o necesita atención (lleva el `conexion_id` objetivo en el `state`/cookie).
 *   - `agregar_cuenta` — conecta una cuenta ADICIONAL (ya tiene 1 o más). El
 *     alta está sujeta al tope `MAX_CUENTAS_ML` y a la unicidad
 *     `(seller_id, ml_user_id)`; el callback traduce esos rechazos a
 *     `tope_alcanzado`/`cuenta_ya_conectada`.
 */
export type ModoConexionMl = "conexion_inicial" | "reconexion" | "agregar_cuenta";

export const MODOS_CONEXION_ML: ModoConexionMl[] = [
  "conexion_inicial",
  "reconexion",
  "agregar_cuenta",
];

/** Normaliza el valor crudo (cookie/query) a un `ModoConexionMl` seguro. */
export function leerModoConexionMl(valor: string | null | undefined): ModoConexionMl {
  return (MODOS_CONEXION_ML as string[]).includes(valor ?? "")
    ? (valor as ModoConexionMl)
    : "conexion_inicial";
}

/**
 * Ramificaciones de la Pantalla N (tabla §3.2) que el route handler de
 * callback resuelve y comunica vía `?resultado=` — más dos variantes que la
 * tabla no nombra explícitamente pero que el callback real puede producir
 * (`estado_invalido`: problema de continuidad de sesión/CSRF;
 * `error_sistema`: cualquier fallo no clasificado, nunca un mensaje genérico).
 *
 * Modelo 1:N (seller con hasta N cuentas ML): al conectar una cuenta ADICIONAL
 * el backend puede rechazar por dos reglas del esquema — `tope_alcanzado` (el
 * seller ya tiene el máximo de cuentas) y `cuenta_ya_conectada` (esa misma
 * cuenta ML ya está vinculada a este seller). La UI de "agregar cuenta"
 * (frontend) debe rotular ambos con un mensaje accionable.
 *
 * Y dos más que nacen de la MISMA limitación de Mercado Libre (`/authorization`
 * no admite `prompt`/`select_account`/`login_hint` ni existe logout, así que ML
 * conecta sin preguntar la cuenta con sesión viva en el navegador). Cuando eso
 * ocurre durante una RECONEXIÓN, el seller no arregló lo que quería arreglar:
 *   - `reconexion_otra_cuenta_nueva` — autorizó con una cuenta que no tenía
 *     conectada: se dio de alta como cuenta adicional, y la que quería
 *     reconectar sigue igual de rota.
 *   - `reconexion_otra_cuenta_existente` — autorizó con OTRA de sus cuentas ya
 *     conectadas: se renovó esa, no la que pidió.
 * Ambos son "éxito técnico, fracaso de intención": la pantalla NO puede
 * felicitar, tiene que decir que la conexión objetivo sigue desconectada.
 */
export type ResultadoCallbackMl =
  | "exito"
  | "cuenta_en_otro_courier"
  | "cancelado"
  | "cuenta_colaborador"
  | "error_transitorio"
  | "error_sistema"
  | "estado_invalido"
  | "tope_alcanzado"
  | "cuenta_ya_conectada"
  | "reconexion_otra_cuenta_nueva"
  | "reconexion_otra_cuenta_existente";

export const RESULTADOS_CALLBACK_ML: ResultadoCallbackMl[] = [
  "exito",
  "cuenta_en_otro_courier",
  "cancelado",
  "cuenta_colaborador",
  "error_transitorio",
  "error_sistema",
  "estado_invalido",
  "tope_alcanzado",
  "cuenta_ya_conectada",
  "reconexion_otra_cuenta_nueva",
  "reconexion_otra_cuenta_existente",
];
