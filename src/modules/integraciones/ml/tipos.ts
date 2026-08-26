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
  /** Alias editable por el seller para distinguir la cuenta (modelo 1:N). */
  alias: string | null;
  /** Nickname de la cuenta en ML (capturado al conectar; puede ser null). */
  mlNickname: string | null;
  /**
   * La apagó una PERSONA, no se cayó sola.
   *
   * 🔴 Comparte `estadoSalud = 'desvinculada'` con el token vencido, el
   * revocado y el fallo de descifrado —ése es el estado que corta la ingesta—
   * así que sin esto las cuatro causas son indistinguibles, y las tres
   * superficies que avisan de una caída (el banner del portal, el centro de
   * avisos del seller y el del courier) le gritan al seller por algo que pidió.
   *
   * ⚠️ Es un BOOLEANO derivado, no el id de quien la apagó: este tipo cruza
   * hacia la interfaz y un id de usuario no tiene por qué llegar ahí. El quién
   * vive en la bitácora.
   */
  desconectadaPorPersona: boolean;
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

/**
 * Qué le pasó REALMENTE a `conexiones_seller_ml` al canjear el `code`, bajo el
 * modelo 1:N (un seller puede conectar varias cuentas ML).
 *
 * Por qué el llamador lo necesita: el endpoint `/authorization` de Mercado
 * Libre NO admite ningún parámetro para forzar el selector de cuenta
 * (`prompt`, `select_account`, `approval_prompt`, `max_age` y `login_hint` NO
 * están documentados; los únicos parámetros son `response_type`, `client_id`,
 * `redirect_uri`, `state`, `code_challenge` y `code_challenge_method`), y
 * tampoco existe un endpoint de logout documentado. Consecuencia práctica: si
 * el seller ya tiene sesión abierta en ML y la app autorizada, ML redirige de
 * inmediato con un `code` de LA MISMA cuenta, sin preguntar nada. El único
 * lugar donde se puede saber qué cuenta autorizó es DESPUÉS del canje, en el
 * `user_id` que devuelve `POST /oauth/token`.
 *
 * Sin esta señal, "el seller pidió agregar una cuenta" y "el sistema agregó
 * una cuenta" se confunden, y la UI termina diciendo "agregaste la cuenta"
 * cuando en realidad solo se rotaron los tokens de una conexión que ya existía.
 *
 * - `alta_nueva` — no había fila para `(seller_id, ml_user_id)`: se insertó.
 * - `conexion_existente_actualizada` — ya había fila para esa cuenta: se
 *   actualizaron sus tokens/salud (UPDATE), no se agregó ninguna cuenta.
 */
export type DesenlaceIntercambioMl = "alta_nueva" | "conexion_existente_actualizada";

/**
 * Resultado del intercambio de `code` por tokens: la conexión resultante MÁS
 * el desenlace real de la persistencia. Nunca incluye tokens ni referencias de
 * secreto (ver `ConexionSellerMl`).
 */
export interface IntercambiarCodigoResultado {
  conexion: ConexionSellerMl;
  desenlace: DesenlaceIntercambioMl;
}

/**
 * Resumen agregado de salud de TODAS las conexiones ML de un tenant (todos sus
 * sellers, todas sus cuentas) — para el drill-down por-tenant del backstage
 * `/admin` (`plataforma/observabilidad-tenant.ts`, gap 9). Solo conteos por
 * `estado_salud`; no expone `seller_id`, alias ni nada identificable de la
 * cuenta — el backstage ve salud técnica agregada, no el detalle operativo
 * del courier.
 */
export interface ResumenSaludMlTenant {
  sanas: number;
  atencion: number;
  desvinculadas: number;
  pendientes: number;
  total: number;
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

// ---------------------------------------------------------------------------
// Etiquetas de envío (RF-021)
// ---------------------------------------------------------------------------

export interface ObtenerEtiquetaEnvioEntrada {
  sellerId: string;
  /** `shipment_id` de Mercado Libre — identifica el envío Flex/same-day. */
  mlShipmentId: string;
  /**
   * Cuenta ML de origen del pedido (`operacion.pedidos.ml_user_id`). Bajo el
   * modelo 1:N (un seller puede conectar varias cuentas), el token con el que
   * se descarga la etiqueta debe ser el de la cuenta que generó ESE envío. Si
   * es `null`/omitido (pedido legacy sin estampar, o seller con una sola
   * cuenta) se cae a la conexión representativa del seller.
   */
  mlUserId?: string | null;
}

export interface ObtenerEtiquetaEnvioResultado {
  /** Cuerpo binario de la etiqueta (PDF) — el llamador lo sirve sin transformarlo. */
  contenido: ArrayBuffer;
  /** Content-Type devuelto por ML — esperado `application/pdf`. */
  contentType: string;
}
