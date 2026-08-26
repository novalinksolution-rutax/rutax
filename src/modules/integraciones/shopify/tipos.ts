/**
 * Tipos del adaptador de Shopify.
 *
 * Dos familias, deliberadamente separadas:
 *  - Lo que Shopify devuelve (`OrdenShopify` y compañía), modelado como llega y
 *    con casi todo opcional, porque una tienda puede no tener dirección de envío,
 *    no tener teléfono o traer campos vacíos y eso no es un error.
 *  - Lo que este módulo expone hacia adentro (`ConexionShopify`, resúmenes),
 *    que nunca incluye el token — solo su referencia opaca.
 *
 * Igual que `../ml/tipos.ts`, no se importa nada del núcleo `operacion`: el
 * mapeo a `operacion.pedidos` vive en `ingesta-pedidos.ts` y es el único punto
 * que conoce las dos formas.
 */

/** Estado de salud de la conexión — espejo del enum SQL de la tabla. */
export type EstadoSaludShopify = "pendiente" | "sana" | "atencion" | "desvinculada";

/**
 * Conexión de una tienda Shopify de un seller, tal como se expone hacia adentro.
 *
 * ⚠️ NO lleva el token, solo `tokenRef` — la referencia opaca a
 * `identidad.secretos_cifrados`. Mismo contrato que `ConexionSellerMl`.
 */
export interface ConexionShopify {
  id: string;
  tenantId: string;
  sellerId: string;
  shopDomain: string;
  /** Referencia OPACA al secreto cifrado. Nunca el valor. */
  tokenRef: string | null;
  scopesOtorgados: string[];
  /** Tag de Shopify con el que el seller acota qué pedidos manda al courier. */
  filtroEtiqueta: string | null;
  estadoSalud: EstadoSaludShopify;
  ultimaSyncExitosaEn: string | null;
  ultimoError: string | null;
  alias: string | null;
  nombreTienda: string | null;
  activa: boolean;
  /**
   * `true` cuando la apagó una persona, no cuando se cayó sola.
   *
   * ⚠️ Es un BOOLEANO, no el id de quien la apagó: la pantalla necesita saber si
   * fue a propósito, no quién — y un id de usuario no tiene por qué llegar al
   * navegador. El quién vive en la bitácora. Mismo criterio que en ML.
   */
  desconectadaPorPersona: boolean;
  creadoEn: string;
}

/**
 * Scopes que la custom app del seller debe otorgar.
 *
 * Los cuatro son necesarios y ninguno sobra:
 *  - `read_orders` para ingestar. Ojo: sin `read_all_orders` solo alcanza los
 *    últimos 60 días, que para un courier same-day sobra.
 *  - `read_fulfillments` para saber si el pedido ya fue cumplido (y no volver a
 *    cumplirlo).
 *  - `write_fulfillments` y `write_merchant_managed_fulfillment_orders` para
 *    marcar el cumplimiento con el número de seguimiento al entregar.
 */
export const SCOPES_REQUERIDOS = [
  "read_orders",
  "read_fulfillments",
  "write_fulfillments",
  "write_merchant_managed_fulfillment_orders",
] as const;

// =============================================================================
// Formas que devuelve la Admin API — modeladas como LLEGAN, no como quisiéramos
// =============================================================================

export interface DireccionEnvioShopify {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  address1?: string | null;
  address2?: string | null;
  /** En Chile las tiendas ponen la COMUNA acá. Es texto libre del comprador. */
  city?: string | null;
  /** Región. No se usa para operar, pero sirve para descartar fuera de la RM. */
  province?: string | null;
  zip?: string | null;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface OrdenShopify {
  /** GID: `gid://shopify/Order/1234567890`. Es el `id_externo` del pedido. */
  id: string;
  /** Lo que el humano ve en el admin: `#1001`. Es la `referencia_externa`. */
  name: string;
  createdAt: string;
  cancelledAt?: string | null;
  /** `UNFULFILLED` | `PARTIALLY_FULFILLED` | `FULFILLED` | `RESTOCKED` … */
  displayFulfillmentStatus?: string | null;
  tags?: string[] | null;
  note?: string | null;
  phone?: string | null;
  shippingAddress?: DireccionEnvioShopify | null;
}

export interface PaginaOrdenes {
  nodes: OrdenShopify[];
  hasNextPage: boolean;
  endCursor: string | null;
}

/** Resumen de una corrida de ingesta — lo que el job devuelve como telemetría. */
export interface ResumenIngestaShopify {
  totalLeidos: number;
  totalInsertados: number;
  totalActualizados: number;
  /** Fuera de la cobertura del courier, o descartados por el filtro de tag. */
  totalOmitidos: number;
  /** Llegaron sin dirección de envío utilizable — no se puede repartir a ciegas. */
  totalSinDireccion: number;
  /** No había tarifa vigente para el seller: el pedido NO se ingesta. */
  totalSinTarifa: number;
  /** Detectados como cancelados en la tienda durante el repaso. */
  totalCancelados: number;
}
