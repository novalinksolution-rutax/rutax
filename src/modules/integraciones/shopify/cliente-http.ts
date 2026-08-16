/**
 * Cliente HTTP del adaptador de Shopify — Admin API (GraphQL).
 *
 * Sigue el molde de `../ml/cliente-http.ts`: envuelve todo en
 * `reintentarConBackoff` y lanza errores que implementan `ErrorReintentable`,
 * de modo que la política de reintentos del proyecto aplique sin que cada
 * llamador la reimplemente. **Es privado del adaptador**: la superficie pública
 * es `./index.ts` (misma regla que en ML, ver `../README.md`).
 *
 * Tres cosas de Shopify que el molde de ML NO cubre, y que son la razón de ser
 * de este archivo:
 *
 * 1. **HTTP 200 no significa éxito.** GraphQL responde 200 con un arreglo
 *    `errors` en el cuerpo. Un `respuesta.ok` que no mire el cuerpo da por buena
 *    una consulta que falló, y el llamador recibe `data: null` sin enterarse.
 *
 * 2. **El límite de tasa es un balde de puntos, no peticiones por minuto.** Cada
 *    consulta cuesta según su complejidad y el balde se rellena a `restoreRate`
 *    puntos por segundo. Shopify informa el estado en
 *    `extensions.cost.throttleStatus`, y cuando el balde se vacía devuelve 200
 *    con `errors[].extensions.code = 'THROTTLED'`. Ese caso se traduce a un
 *    error reintentable con la espera CALCULADA a partir de cuántos puntos
 *    faltan, en vez de dejar que el backoff a ciegas adivine.
 *
 * 3. **El dominio de la tienda lo escribe el seller.** Llega desde un formulario
 *    del portal, así que se valida contra `*.myshopify.com` antes de construir
 *    la URL. Sin eso, un dominio malicioso pegado en el formulario haría que
 *    Rutax entregue el token de esa tienda al host que le indiquen.
 */

import {
  reintentarConBackoff,
  type ErrorReintentable,
  type OpcionesReintento,
} from "../resiliencia";

/**
 * Versión de la Admin API contra la que hablamos.
 *
 * Shopify versiona trimestralmente y sostiene cada versión ~12 meses; quedarse
 * en una versión fija es lo correcto — subir es una decisión deliberada, con su
 * revisión de changelog, no algo que deba pasar solo. Se puede sobrescribir por
 * entorno para poder probar una versión nueva sin desplegar código.
 */
export const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2026-01";

/**
 * Dominios de tienda admitidos: el subdominio `.myshopify.com` que Shopify
 * asigna a cada tienda, que es estable y no cambia aunque el comerciante ponga
 * un dominio propio. Se exige minúsculas porque la normalización es del
 * llamador — que esta función la aceptara "por comodidad" escondería que dos
 * filas con distinta capitalización son la misma tienda.
 */
const PATRON_SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]\.myshopify\.com$/;

export function esShopDomainValido(dominio: string): boolean {
  return PATRON_SHOP_DOMAIN.test(dominio);
}

/** Normaliza lo que pegue el seller: espacios, mayúsculas, esquema y ruta. */
export function normalizarShopDomain(entrada: string): string | null {
  let v = entrada.trim().toLowerCase();
  v = v.replace(/^https?:\/\//, "");
  v = v.replace(/\/.*$/, "");
  // El seller suele pegar solo el handle ("mi-tienda") desde la barra del admin.
  if (v.length > 0 && !v.includes(".")) v = `${v}.myshopify.com`;
  return esShopDomainValido(v) ? v : null;
}

export class ErrorShopDomainInvalido extends Error {
  constructor(dominio: string) {
    super(
      `Dominio de tienda Shopify no válido: se esperaba algo como "mi-tienda.myshopify.com" y llegó "${dominio}".`,
    );
    this.name = "ErrorShopDomainInvalido";
  }
}

export class ErrorHttpShopify extends Error implements Partial<ErrorReintentable> {
  readonly status: number;
  readonly reintentable?: true;
  readonly retryAfterMs?: number;
  /** Cuerpo de error de Shopify. NO contiene el token: viaja solo en el header. */
  readonly cuerpo: unknown;

  constructor(mensaje: string, status: number, cuerpo: unknown, retryAfterMs?: number) {
    super(mensaje);
    this.name = "ErrorHttpShopify";
    this.status = status;
    this.cuerpo = cuerpo;

    // 429 y 5xx son transitorios; el resto de los 4xx son definitivos y
    // reintentarlos solo gasta cuota. Mismo criterio que `ErrorHttpMl`.
    if (status === 429 || status >= 500) {
      this.reintentable = true;
      if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
    }
  }
}

/**
 * La consulta llegó a Shopify y Shopify la rechazó — HTTP 200 con `errors`.
 *
 * Reintentable SOLO si el motivo es el límite de tasa (`THROTTLED`): un error de
 * sintaxis, un campo inexistente o un scope faltante dan exactamente el mismo
 * resultado por más veces que se pregunte.
 */
export class ErrorGraphqlShopify extends Error implements Partial<ErrorReintentable> {
  readonly reintentable?: true;
  readonly retryAfterMs?: number;
  readonly errores: ErrorGraphql[];
  readonly codigos: string[];

  constructor(mensaje: string, errores: ErrorGraphql[], retryAfterMs?: number) {
    super(mensaje);
    this.name = "ErrorGraphqlShopify";
    this.errores = errores;
    this.codigos = errores
      .map((e) => e.extensions?.code)
      .filter((c): c is string => typeof c === "string");

    if (this.codigos.includes("THROTTLED")) {
      this.reintentable = true;
      if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
    }
  }
}

interface ErrorGraphql {
  message: string;
  extensions?: { code?: string; [k: string]: unknown };
}

interface EstadoBalde {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

interface RespuestaGraphql<T> {
  data?: T;
  errors?: ErrorGraphql[];
  extensions?: {
    cost?: {
      requestedQueryCost?: number;
      actualQueryCost?: number;
      throttleStatus?: EstadoBalde;
    };
  };
}

/**
 * Cuánto esperar para que el balde recupere los puntos que faltan.
 *
 * Se topa en 10 s: si el cálculo diera más, es señal de que la consulta pide más
 * de lo que la tienda repone en un tiempo razonable, y ahí lo que corresponde es
 * dejar que el backoff con jitter separe los reintentos en vez de bloquear un
 * job durante medio minuto.
 */
export function esperaPorBalde(
  balde: EstadoBalde | undefined,
  costoPedido: number | undefined,
): number | undefined {
  if (!balde || !costoPedido || balde.restoreRate <= 0) return undefined;
  const faltan = costoPedido - balde.currentlyAvailable;
  if (faltan <= 0) return undefined;
  return Math.min(10_000, Math.ceil((faltan / balde.restoreRate) * 1000));
}

function leerRetryAfterMs(headers: Headers): number | undefined {
  const valor = headers.get("retry-after");
  if (!valor) return undefined;
  const segundos = Number(valor);
  if (!Number.isNaN(segundos)) return segundos * 1000;
  const fecha = Date.parse(valor);
  if (!Number.isNaN(fecha)) return Math.max(0, fecha - Date.now());
  return undefined;
}

async function leerCuerpoSeguro(respuesta: Response): Promise<unknown> {
  try {
    const texto = await respuesta.text();
    if (!texto) return null;
    try {
      return JSON.parse(texto);
    } catch {
      // Un cuerpo no-JSON suele ser una página de error de infraestructura.
      // Se recorta para no volcar HTML entero al log de un job.
      return texto.slice(0, 500);
    }
  } catch {
    return null;
  }
}

export interface PeticionShopify {
  /** Dominio `*.myshopify.com` ya normalizado. Se valida igual, por si acaso. */
  shopDomain: string;
  /** Admin API access token — NUNCA se loguea; solo arma el header. */
  accessToken: string;
  consulta: string;
  variables?: Record<string, unknown>;
  opcionesReintento?: OpcionesReintento;
}

/**
 * Ejecuta una consulta GraphQL contra la Admin API con reintentos ya aplicados.
 *
 * Devuelve `data` desempaquetado. Lanza `ErrorHttpShopify` (transporte) o
 * `ErrorGraphqlShopify` (la consulta llegó y fue rechazada). Los `userErrors` de
 * una mutación NO se inspeccionan aquí: son resultado de negocio, no de
 * transporte, y cada mutación decide qué significan — ver `cumplimiento.ts`.
 */
export async function peticionShopify<T>(peticion: PeticionShopify): Promise<T> {
  if (!esShopDomainValido(peticion.shopDomain)) {
    throw new ErrorShopDomainInvalido(peticion.shopDomain);
  }

  return reintentarConBackoff(async () => {
    const url = `https://${peticion.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

    const respuesta = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        // Construido en el último momento posible; nunca en una variable de
        // mayor vida ni dentro de un objeto de error.
        "x-shopify-access-token": peticion.accessToken,
      },
      body: JSON.stringify({ query: peticion.consulta, variables: peticion.variables ?? {} }),
    });

    if (!respuesta.ok) {
      throw new ErrorHttpShopify(
        `Shopify respondió ${respuesta.status} para la tienda ${peticion.shopDomain}`,
        respuesta.status,
        await leerCuerpoSeguro(respuesta),
        leerRetryAfterMs(respuesta.headers),
      );
    }

    const cuerpo = (await respuesta.json()) as RespuestaGraphql<T>;

    // [TRAMPA 1] 200 con `errors` es un fallo. Se evalúa ANTES de mirar `data`.
    if (cuerpo.errors && cuerpo.errors.length > 0) {
      const espera = esperaPorBalde(
        cuerpo.extensions?.cost?.throttleStatus,
        cuerpo.extensions?.cost?.requestedQueryCost,
      );
      throw new ErrorGraphqlShopify(
        `Shopify rechazó la consulta: ${cuerpo.errors.map((e) => e.message).join("; ")}`,
        cuerpo.errors,
        espera ?? leerRetryAfterMs(respuesta.headers),
      );
    }

    if (cuerpo.data === undefined || cuerpo.data === null) {
      throw new ErrorGraphqlShopify(
        "Shopify respondió 200 sin `data` ni `errors` — respuesta inesperada.",
        [],
      );
    }

    return cuerpo.data;
  }, peticion.opcionesReintento);
}
