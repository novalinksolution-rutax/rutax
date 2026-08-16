/**
 * Interpretación de una orden de Shopify → los datos que necesita un pedido de
 * Rutax. Funciones PURAS: sin red, sin base, sin reloj propio.
 *
 * Está separado de `ingesta-pedidos.ts` porque es la parte que concentra las
 * decisiones discutibles —qué pedido entra, qué se hace con una dirección a
 * medias, de dónde sale la comuna— y esas merecen prueba directa en vez de
 * quedar enterradas detrás de un cliente de Supabase falso.
 *
 * Contraste con Mercado Libre, que explica por qué esto es más simple: en ML el
 * parsing es defensivo hasta la paranoia porque su documentación se contradice y
 * el mismo campo llega en dos formas. Shopify tiene un esquema GraphQL tipado y
 * versionado: si un campo existe, existe. Lo que sí es incierto acá es el
 * CONTENIDO — la dirección la escribe el comprador en un formulario libre.
 */

import { resolverComunaCanonica } from "../geocoding/normalizacion";
import type { OrdenShopify } from "./tipos";

/** Por qué una orden no entra a Rutax. Cada motivo alimenta el resumen del job. */
export type MotivoDescarte =
  | "cancelada_en_tienda"
  | "ya_cumplida"
  | "despacho_parcial"
  | "sin_direccion"
  | "sin_etiqueta_requerida";

export interface DatosPedidoShopify {
  idExterno: string;
  referenciaExterna: string;
  destinatarioNombre: string;
  destinatarioDireccion: string;
  /** Forma canónica del catálogo si la comuna calzó; si no, el texto crudo. */
  destinatarioComuna: string;
  /** `true` si `destinatarioComuna` calzó contra el catálogo de comunas. */
  comunaReconocida: boolean;
  destinatarioTelefono: string | null;
  instruccionesEntrega: string | null;
  /** Coordenada que trae Shopify, si la tiene. Evita una llamada de geocoding. */
  lat: number | null;
  long: number | null;
  creadoEnFuente: string;
}

export type ResultadoInterpretacion =
  | { entra: true; datos: DatosPedidoShopify }
  | { entra: false; motivo: MotivoDescarte };

const NOMBRE_DESTINATARIO_RESPALDO = "Destinatario pendiente";

/** Estados de cumplimiento que significan "ya está despachado, no es nuestro". */
const ESTADOS_YA_DESPACHADOS = new Set(["FULFILLED", "RESTOCKED"]);

/**
 * Despacho parcial: el seller ya envió una parte del pedido por su cuenta.
 *
 * Se descarta, y la decisión merece explicación porque la intuición dice lo
 * contrario —"queda algo por despachar, esa parte es del courier"—. El problema
 * es que Rutax **no modela los ítems de un pedido**: un pedido es una entrega,
 * no una lista de líneas. Ante un despacho parcial no hay forma de saber qué
 * bultos quedan, y un conductor con una parada cuyo contenido nadie puede
 * determinar es peor que una parada que no existe.
 *
 * Además así la función pura coincide con el filtro que se le manda a la API
 * (`fulfillment_status:unfulfilled`), que tampoco los devuelve. Cuando las dos
 * mitades discrepan, la rama que nunca se ejecuta da una falsa sensación de
 * cobertura: parece contemplado y no lo está.
 *
 * Levantarlo es una decisión de producto que exige modelar líneas de pedido.
 */
const ESTADOS_DESPACHO_PARCIAL = new Set(["PARTIALLY_FULFILLED"]);

/** Junta calle y complemento sin dejar comas colgando cuando falta uno. */
export function componerDireccion(
  address1: string | null | undefined,
  address2: string | null | undefined,
): string {
  return [address1, address2]
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0)
    .join(", ");
}

/** `name`, o `firstName + lastName`, o el respaldo. Nunca cadena vacía. */
export function componerNombreDestinatario(orden: OrdenShopify): string {
  const dir = orden.shippingAddress;
  const directo = (dir?.name ?? "").trim();
  if (directo) return directo;
  const compuesto = [dir?.firstName, dir?.lastName]
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0)
    .join(" ");
  return compuesto || NOMBRE_DESTINATARIO_RESPALDO;
}

/**
 * ¿La orden lleva el tag con el que el seller marca lo que va por este courier?
 *
 * Comparación sin distinguir mayúsculas ni espacios sobrantes: el tag lo teclea
 * una persona en el admin de Shopify, y "Rutax" y "rutax" son el mismo tag para
 * cualquiera menos para un `===`. Sin filtro configurado, pasan todas.
 */
export function cumpleFiltroEtiqueta(
  orden: OrdenShopify,
  filtro: string | null | undefined,
): boolean {
  const buscado = (filtro ?? "").trim().toLowerCase();
  if (!buscado) return true;
  return (orden.tags ?? []).some((t) => t.trim().toLowerCase() === buscado);
}

/**
 * Decide si la orden entra y, si entra, con qué datos.
 *
 * Lo que NO decide: si la comuna está dentro de la cobertura del courier. Eso
 * exige consultar las zonas del tenant y por lo tanto no puede vivir en una
 * función pura — lo resuelve `ingesta-pedidos.ts` con el resultado de
 * `resolverZona`. Acá solo se normaliza la comuna y se informa si se reconoció.
 */
export function interpretarOrden(
  orden: OrdenShopify,
  filtroEtiqueta: string | null | undefined,
): ResultadoInterpretacion {
  if (orden.cancelledAt) return { entra: false, motivo: "cancelada_en_tienda" };

  if (
    orden.displayFulfillmentStatus &&
    ESTADOS_YA_DESPACHADOS.has(orden.displayFulfillmentStatus)
  ) {
    return { entra: false, motivo: "ya_cumplida" };
  }

  if (
    orden.displayFulfillmentStatus &&
    ESTADOS_DESPACHO_PARCIAL.has(orden.displayFulfillmentStatus)
  ) {
    return { entra: false, motivo: "despacho_parcial" };
  }

  if (!cumpleFiltroEtiqueta(orden, filtroEtiqueta)) {
    return { entra: false, motivo: "sin_etiqueta_requerida" };
  }

  const dir = orden.shippingAddress;
  const direccion = componerDireccion(dir?.address1, dir?.address2);
  const ciudad = (dir?.city ?? "").trim();

  // Sin calle o sin comuna no hay nada que repartir, y meterlo igual solo
  // ensucia la bandeja del coordinador con filas que no se pueden asignar. El
  // seller lo corrige en su tienda y entra en la pasada siguiente.
  if (!direccion || !ciudad) return { entra: false, motivo: "sin_direccion" };

  const canonica = resolverComunaCanonica(ciudad);

  return {
    entra: true,
    datos: {
      idExterno: orden.id,
      referenciaExterna: orden.name,
      destinatarioNombre: componerNombreDestinatario(orden),
      destinatarioDireccion: direccion,
      // Si no calza el catálogo se conserva el texto del comprador en vez de
      // inventar una comuna: el geocoder tiene más contexto que nosotros para
      // resolverlo, y una comuna adivinada mandaría al conductor a otra parte.
      destinatarioComuna: canonica ?? ciudad,
      comunaReconocida: canonica !== null,
      destinatarioTelefono: (dir?.phone ?? orden.phone ?? "").trim() || null,
      instruccionesEntrega: (orden.note ?? "").trim() || null,
      lat: typeof dir?.latitude === "number" ? dir.latitude : null,
      long: typeof dir?.longitude === "number" ? dir.longitude : null,
      creadoEnFuente: orden.createdAt,
    },
  };
}
