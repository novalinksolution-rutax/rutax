/**
 * Tipos del puerto OAuth de Mercado Libre.
 *
 * Espejo en TS de `identidad.conexiones_seller_ml` (migración 0004) y de las
 * formas que expone la API de OAuth de Mercado Libre. Mantener sincronizado
 * si cualquiera de los dos lados cambia.
 */

/** Espejo del enum `identidad.estado_salud_conexion_ml`. */
export type EstadoSaludConexionMl = "sana" | "atencion" | "desvinculada" | "pendiente";

/**
 * Resultado de la fila `identidad.conexiones_seller_ml` tal como el resto del
 * sistema debe consumirla — SIN exponer jamás `access_token_ref`/
 * `refresh_token_ref` como algo más que referencias opacas. Ningún consumidor
 * fuera de este adaptador debería necesitar leerlas directo.
 */
export interface ConexionSellerMl {
  id: string;
  tenantId: string;
  sellerId: string;
  mlUserId: string | null;
  tokenExpiraEn: Date | null;
  estadoSalud: EstadoSaludConexionMl;
  ultimaSyncExitosaEn: Date | null;
  desconectadaDesde: Date | null;
  ultimoError: string | null;
}

/**
 * Respuesta del endpoint `POST https://api.mercadolibre.com/oauth/token` —
 * tanto para `grant_type=authorization_code` como `grant_type=refresh_token`.
 *
 * Verificado contra la documentación oficial vigente (Authentication and
 * Authorization, developers.mercadolibre.com — ver notas en `puerto.ts`):
 * - `expires_in` llega en SEGUNDOS (valor observado: 21600 = 6 horas).
 * - `refresh_token` es de un solo uso: cada refresco devuelve uno nuevo y el
 *   anterior queda inválido — por eso SIEMPRE se persiste el que vuelve en
 *   la respuesta, nunca se reutiliza el viejo.
 */
export interface RespuestaTokenMl {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  user_id: number | string;
  refresh_token?: string;
}

export interface IniciarAutorizacionEntrada {
  tenantId: string;
  sellerId: string;
  /** URL a la que ML redirige tras autorizar — debe estar registrada en la app de ML. */
  redirectUri: string;
  /**
   * Token opaco anti-CSRF (`state`) que el llamador genera y persiste para
   * validar el callback. Este puerto NO lo genera — es responsabilidad de la
   * capa que orquesta el flujo HTTP (evita acoplar este puerto a sesiones web).
   */
  state: string;
}

export interface IniciarAutorizacionResultado {
  /** URL de autorización a la que se debe redirigir al seller. */
  urlAutorizacion: string;
}

export interface IntercambiarCodigoEntrada {
  tenantId: string;
  sellerId: string;
  /** `code` recibido en el callback OAuth. */
  codigo: string;
  /** Debe ser idéntico al `redirect_uri` usado al iniciar la autorización. */
  redirectUri: string;
}

export interface RefrescarTokenEntrada {
  conexionId: string;
}

export interface RefrescarTokenResultado {
  /**
   * Distingue, tal como exige la skill `flex-ml` y §7 del documento de
   * arquitectura, "lo resolví con refresco automático" de "requiere
   * re-vinculación del seller" — el sondeo de salud (Fase B, RF-013) decide
   * qué alerta mostrar según este resultado, sin tener que re-derivar la
   * lógica de "¿qué significa este error de ML?".
   */
  resultado: "refrescado" | "requiere_revinculacion";
  conexion: ConexionSellerMl;
}

/**
 * Códigos de error de la API de OAuth de ML que el adaptador interpreta para
 * decidir si un fallo de refresco es transitorio (reintentar) o definitivo
 * (marcar `desvinculada`, requiere re-vinculación). Verificar contra
 * documentación oficial al implementar el job de refresco (Fase B) — aquí se
 * deja el contrato, no la implementación completa del job.
 */
export type RazonFalloRefresco =
  | "refresh_token_invalido_o_revocado"
  | "credenciales_app_invalidas"
  | "limite_de_tasa"
  | "error_transitorio_proveedor"
  | "desconocido";
