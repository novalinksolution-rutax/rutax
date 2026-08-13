/**
 * Ingesta de pedidos Flex desde Mercado Libre — LA pieza reutilizable.
 * =============================================================================
 * Antes esta lógica vivía entera dentro del job de backfill, y por eso el
 * sistema tenía UNA sola puerta de entrada: reconectar una cuenta. Un pedido
 * Flex nuevo no entraba solo (bloqueador raíz de CLAUDE.md). Ahora hay tres
 * llamadores y UNA implementación:
 *
 *   1. `jobs/ejecutar-backfill.ts`   — ventana de reconexión (evento OAuth).
 *   2. `jobs/procesar-shipment.ts`   — webhook de ML de un envío desconocido.
 *   3. `jobs/ingesta-pedidos-ml.ts`  — cron de respaldo + sincronización manual.
 *
 * Si se duplicara, el próximo bug se arreglaría en un sitio y no en los otros —
 * que es exactamente lo que ya pasó con el backfill (cinco bugs en fila).
 *
 * ---------------------------------------------------------------------------
 * CONTRATO CON LA API DE ML (verificado 2026-08-12/13 contra la doc oficial:
 * developers.mercadolibre.cl/es_ar/envios y .../es_ar/gestiona-ventas, más el
 * catálogo interno `docs/mercadolibre/04-*.md` y `05-*.md`)
 * ---------------------------------------------------------------------------
 * 1. `GET /orders/search?seller=…` — paginado `offset`/`limit` (50). El id del
 *    envío es `order.shipping.id`, y puede venir `null` cuando ML todavía no lo
 *    creó: caso ESPERADO. NO se le manda `x-format-new` (ver la constante).
 * 2. `GET /shipments/{id}` — **de a uno**, con `x-format-new: true`. NO existe
 *    `GET /shipments?ids=…`: ese batch pertenece a `/shipment_labels`, y pedirlo
 *    aquí devuelve 404 (mató el backfill en producción tres corridas).
 * 3. `x-format-new: true` es OBLIGATORIA en shipments desde el 12-oct-2025
 *    (cita textual de la doc oficial).
 * 4. Con el formato nuevo la doc de ML **se contradice consigo misma**
 *    (`logistic.type` anidado vs. `logistic_type` plano; `destination.
 *    shipping_address` vs. `receiver_address`). Todo se lee de forma DEFENSIVA,
 *    aceptando ambas ubicaciones.
 *
 * SEGURIDAD (no negociable):
 * - El access token viaja por parámetro, nunca a una variable de vida larga,
 *   nunca a un log, nunca a un payload de evento.
 * - Del shipment NUNCA se loguea un valor: trae nombre y dirección del
 *   destinatario. El diagnóstico de forma solo imprime NOMBRES de campo.
 */

import { inngest } from "@/lib/inngest/cliente";
import type { SupabaseClient } from "@supabase/supabase-js";
import { peticionMl, ErrorHttpMl } from "./cliente-http";
import { ahoraEnSantiago, horaAMinutos, fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import { resolverComunaCanonica } from "@/modules/integraciones/geocoding/normalizacion";
import { resolverZona } from "@/modules/operacion/zonas";
import { resolverVentanaCorte } from "@/modules/operacion/ventanas-corte";
import { traducirEstadoMl } from "./traduccion-estados";

// =============================================================================
// Constantes del contrato con ML
// =============================================================================

/**
 * Cabecera obligatoria de los recursos de shipments (ver §3 del encabezado).
 * Exportada para que la prueba de regresión pueda fijarla: si alguien la quita,
 * el test falla antes que producción.
 *
 * **NO se le pone a `/orders/search`, a propósito.** Tres razones: (a) el aviso
 * de obligatoriedad de la doc oficial está acotado a «los recursos de
 * shipments»; (b) todos los ejemplos de `/orders/search` en la doc de órdenes
 * la omiten; (c) la respuesta de órdenes YA trae la forma nueva —
 * `"shipping": { "id": … }` — sin el header, y producción lo confirma.
 */
export const ENCABEZADO_FORMATO_NUEVO_ML: Readonly<Record<string, string>> = Object.freeze({
  "x-format-new": "true",
});

/**
 * Tipo logístico de Mercado Libre que corresponde a Flex (el seller/courier
 * hace el last-mile). Es el ÚNICO que este SaaS ingiere: Full (`fulfillment`),
 * Colecta (`cross_docking`) y Agencia (`drop_off`/`xd_drop_off`) los despacha
 * ML, no hay conductor del courier — el motor entrega→dinero no aplica.
 */
export const LOGISTIC_TYPE_FLEX = "self_service";

/**
 * Llamadas simultáneas a `GET /shipments/{id}`.
 *
 * 6 es deliberadamente conservador: la doc oficial NO publica un número estable
 * de límite de tasa para `/shipments` (el único número oficial, 1500 rpm, es de
 * Global Selling para actualización de ítems y no aplica aquí), así que no se
 * rafaguean 50 conexiones de golpe. Cada llamada pasa igual por `peticionMl`
 * → backoff + respeto de `Retry-After`.
 */
export const CONCURRENCIA_SHIPMENTS = 6;

// =============================================================================
// Forma de la orden (`GET /orders/search`)
// =============================================================================

/** Pedido de ML (campos mínimos para la ingesta). */
export interface OrderMl {
  id: number | string;
  /**
   * El envío de la orden. El id del shipment es `shipping.id`: puede venir
   * `null` mientras ML no crea el envío.
   */
  shipping?: {
    id?: number | string | null;
  } | null;
  order_items?: Array<{
    item?: { title?: string };
  }>;
  buyer?: {
    nickname?: string;
    phone?: { number?: string };
  };
  /**
   * Legacy: con `x-format-new` el JSON de órdenes YA NO trae datos de envío
   * («el nuevo JSON de Orders ya no contendrá datos de Shipping»). Se conserva
   * como respaldo porque hoy la búsqueda de órdenes no manda el header.
   */
  shipping_address?: {
    address_line?: string;
    city?: { name?: string };
  };
  date_created?: string;
  status?: string;
}

/**
 * Extrae el id del envío de una orden de ML.
 *
 * **El campo es `order.shipping.id`.** Un `shipping.shipment_id` (que no existe
 * en la API) devolvía `null` para el 100% de las órdenes y el backfill ingería
 * cero pedidos marcando el intento como `completado` — falla muda. Esta función
 * está exportada a propósito: el test debe ejercer ESTE código y no una copia
 * espejo, que validaba el supuesto contra sí mismo.
 *
 * Devuelve `null` cuando el envío aún no existe (`shipping` ausente o
 * `shipping.id` nulo). Eso NO es un error: es el caso «reintentar después»
 * documentado por ML — la orden se recoge en una pasada posterior.
 */
export function extraerShipmentId(order: OrderMl): string | null {
  const crudo = order.shipping?.id;
  if (crudo === null || crudo === undefined || crudo === "") return null;
  const texto = String(crudo).trim();
  return texto === "" ? null : texto;
}

// =============================================================================
// Forma del shipment (`GET /shipments/{id}` con x-format-new: true)
// =============================================================================

/** Domicilio tal como lo devuelve ML — mismos campos en ambas ubicaciones. */
export interface DireccionShipmentMl {
  latitude?: unknown;
  longitude?: unknown;
  address_line?: string | null;
  street_name?: string | null;
  street_number?: string | number | null;
  city?: { name?: string | null } | null;
  municipality?: { name?: string | null } | null;
  state?: { name?: string | null } | null;
}

/** Nodo de plazos. `lead_time` en el formato nuevo; `shipping_option` legacy. */
export interface PlazosShipmentMl {
  estimated_delivery_time?: { date?: string | null } | null;
  estimated_delivery_final?: { date?: string | null } | null;
  estimated_delivery_limit?: { date?: string | null } | null;
  estimated_delivery_extended?: { date?: string | null } | null;
}

/** Respuesta de `GET /shipments/{id}` — solo los campos que consumimos. */
export interface ShipmentMl {
  id?: number | string;
  status?: string | null;
  substatus?: string | null;
  date_created?: string | null;
  /** Formato nuevo: `logistic: { mode, type, direction }`. */
  logistic?: { mode?: string | null; type?: string | null; direction?: string | null } | null;
  /** Legacy: `logistic_type` plano. La doc de ML muestra las dos formas. */
  logistic_type?: string | null;
  /** Formato nuevo. El domicilio se oculta hasta que el pago está confirmado. */
  destination?: {
    receiver_name?: string | null;
    shipping_address?: DireccionShipmentMl | null;
  } | null;
  /** Legacy. */
  receiver_address?: DireccionShipmentMl | null;
  lead_time?: PlazosShipmentMl | null;
  shipping_option?: PlazosShipmentMl | null;
  /** Legacy: la orden que originó el envío. Puede no venir en el formato nuevo. */
  order_id?: number | string | null;
  /** Formato nuevo (algunas respuestas): lista de órdenes del envío. */
  orders?: Array<{ id?: number | string | null }> | null;
}

/** Lo que la ingesta necesita de un shipment, ya normalizado. */
export interface DatosShipmentMl {
  logisticType: string | null;
  /** Coordenadas del destinatario, cuando ML las trae. Ver la nota de abajo. */
  lat: number | null;
  long: number | null;
  /** `status`/`substatus` DEL ENVÍO (no de la orden). */
  estadoMl: string | null;
  subestadoMl: string | null;
  /** Instante ISO del compromiso de entrega de ML, si vino. */
  fechaEntregaIso: string | null;
  destinatarioNombre: string | null;
  destinatarioDireccion: string | null;
  destinatarioComuna: string | null;
}

/**
 * Diagnóstico de FORMA, no de contenido. Existe porque la doc de ML se
 * contradice y necesitamos saber qué llega de verdad, pero un shipment trae
 * nombre y dirección del destinatario: aquí solo viajan **nombres de campo** y
 * en qué rama apareció cada dato. Ni un valor, nunca.
 */
export interface DiagnosticoShipmentMl {
  claves: string[];
  clavesPlazos: string[];
  ubicacionLogisticType: "anidado" | "plano" | "ausente";
  ubicacionDireccion: "destination" | "receiver_address" | "ausente";
  campoFechaEntrega: string | null;
}

/**
 * Extrae lat/long de un domicilio de ML si vienen y son números válidos.
 *
 * **ML declara los campos siempre, pero los rellena solo a veces** — en el
 * propio ejemplo de su documentación vienen en `null`. Por eso esto es
 * best-effort: cuando hay coordenada nos ahorramos una llamada de geocoding
 * pagado, y cuando no la hay el pedido sigue su curso normal a la cola de
 * geocodificación. Nunca se inventa un punto.
 */
export function coordenadasDeReceiver(
  receiver: { latitude?: unknown; longitude?: unknown } | null | undefined,
): { lat: number | null; long: number | null } {
  // `Number(null)` es 0, y 0 es una coordenada perfectamente válida: sin este
  // descarte previo, una longitud ausente colocaba el pedido en Greenwich.
  const crudoLat = receiver?.latitude;
  const crudoLong = receiver?.longitude;
  if (crudoLat === null || crudoLat === undefined || crudoLat === "") {
    return { lat: null, long: null };
  }
  if (crudoLong === null || crudoLong === undefined || crudoLong === "") {
    return { lat: null, long: null };
  }

  const lat = Number(crudoLat);
  const long = Number(crudoLong);
  const valido =
    Number.isFinite(lat) &&
    Number.isFinite(long) &&
    lat >= -90 &&
    lat <= 90 &&
    long >= -180 &&
    long <= 180 &&
    // (0,0) es el Golfo de Guinea: ML lo devuelve como relleno, no como dato.
    !(lat === 0 && long === 0);

  return valido ? { lat, long } : { lat: null, long: null };
}

function textoONull(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim();
  return limpio === "" ? null : limpio;
}

/**
 * Lee el tipo logístico aceptando las DOS formas que documenta ML: el nodo
 * anidado `logistic.type` (formato nuevo) y el `logistic_type` plano (legacy).
 * Devuelve también dónde lo encontró, para el diagnóstico de forma.
 *
 * No se elige una y se descarta la otra a propósito: la contradicción está en
 * la propia documentación oficial y no está zanjada, así que el código no puede
 * apostar. Si falta en ambas, `null` → el envío se OMITE (nunca se asume Flex).
 */
export function leerLogisticType(shipment: ShipmentMl | null | undefined): {
  valor: string | null;
  ubicacion: DiagnosticoShipmentMl["ubicacionLogisticType"];
} {
  const anidado = textoONull(shipment?.logistic?.type);
  if (anidado) return { valor: anidado, ubicacion: "anidado" };

  const plano = textoONull(shipment?.logistic_type);
  if (plano) return { valor: plano, ubicacion: "plano" };

  return { valor: null, ubicacion: "ausente" };
}

/**
 * Lee el domicilio del destinatario aceptando las dos formas: el nodo nuevo
 * `destination.shipping_address` y el legacy `receiver_address`.
 *
 * Importa más de lo que parece: con `x-format-new` el JSON de órdenes ya no
 * trae datos de envío, así que si esto no leyera del shipment, TODO pedido Flex
 * entraría con «Dirección pendiente» y comuna «Santiago» — y con eso caen la
 * resolución de zona, el corte de riesgo, el geocoding y el ruteo.
 */
export function leerDireccionShipment(shipment: ShipmentMl | null | undefined): {
  direccion: DireccionShipmentMl | null;
  ubicacion: DiagnosticoShipmentMl["ubicacionDireccion"];
} {
  const nueva = shipment?.destination?.shipping_address;
  if (nueva && typeof nueva === "object") return { direccion: nueva, ubicacion: "destination" };

  const legacy = shipment?.receiver_address;
  if (legacy && typeof legacy === "object") {
    return { direccion: legacy, ubicacion: "receiver_address" };
  }

  return { direccion: null, ubicacion: "ausente" };
}

/** Arma la calle a partir de `address_line`, o de `street_name` + número. */
export function calleDeDireccion(direccion: DireccionShipmentMl | null): string | null {
  const linea = textoONull(direccion?.address_line);
  if (linea) return linea;

  const calle = textoONull(direccion?.street_name);
  if (!calle) return null;
  const numero = textoONull(
    typeof direccion?.street_number === "number"
      ? String(direccion.street_number)
      : direccion?.street_number,
  );
  return numero ? `${calle} ${numero}` : calle;
}

/**
 * Id de la orden a partir del shipment, cuando ML lo trae.
 *
 * Existe para el camino del WEBHOOK, que solo conoce el `shipment_id`: sin esto
 * el pedido entraría con `ml_order_id` nulo y se perdería la trazabilidad
 * venta↔envío. Se lee de forma defensiva —`order_id` plano (legacy) y
 * `orders[0].id`— y **puede devolver `null` legítimamente**: el formato nuevo
 * de shipments no garantiza el campo. Nunca se inventa un id, y el llamador
 * NUNCA sobrescribe con `null` un `ml_order_id` ya guardado.
 */
export function leerOrderIdDeShipment(shipment: ShipmentMl | null | undefined): string | null {
  const plano = shipment?.order_id;
  if (plano !== null && plano !== undefined && String(plano).trim() !== "") {
    return String(plano).trim();
  }
  const primera = shipment?.orders?.[0]?.id;
  if (primera !== null && primera !== undefined && String(primera).trim() !== "") {
    return String(primera).trim();
  }
  return null;
}

/**
 * Orden de preferencia para la fecha que ML promete, con el nodo nuevo primero.
 *
 * Qué dice la doc oficial de cada campo (developers.mercadolibre.cl/es_ar/envios,
 * sección «Plazos de entrega»), porque los nombres engañan:
 * - `estimated_delivery_time.date` — la promesa de entrega, la que ML le muestra
 *   al comprador. **Es la que usamos.**
 * - `estimated_delivery_final.date` — «fecha final como plazo para que llegue el
 *   envío y se determine el status final». El plazo duro; respaldo.
 * - `estimated_delivery_limit.date` — **NO se usa**, aunque el nombre suene a
 *   «fecha límite de entrega»: la doc lo define como «fecha límite para que el
 *   comprador pueda cancelar la compra y pedir la devolución de dinero». Es un
 *   plazo de reembolso, típicamente varios días después.
 * - `estimated_delivery_extended.date` — segunda promesa si la primera falla.
 *   Tampoco: describe el fracaso, no el compromiso del día.
 */
const RUTAS_FECHA_ENTREGA = [
  ["lead_time", "estimated_delivery_time"],
  ["lead_time", "estimated_delivery_final"],
  ["shipping_option", "estimated_delivery_time"],
  ["shipping_option", "estimated_delivery_final"],
] as const;

/** Devuelve el instante ISO del compromiso de ML y de qué campo salió. */
export function leerFechaEntregaMl(shipment: ShipmentMl | null | undefined): {
  iso: string | null;
  campo: string | null;
} {
  for (const [nodo, campo] of RUTAS_FECHA_ENTREGA) {
    const plazos = shipment?.[nodo] as PlazosShipmentMl | null | undefined;
    const valor = textoONull(plazos?.[campo]?.date);
    if (valor && !Number.isNaN(new Date(valor).getTime())) {
      return { iso: valor, campo: `${nodo}.${campo}.date` };
    }
  }
  return { iso: null, campo: null };
}

/**
 * La fecha civil (America/Santiago) que va a `operacion.pedidos.fecha_compromiso`.
 *
 * **Por qué es crítica:** `/operaciones` filtra por defecto con
 * `.eq("fecha_compromiso", hoy)`. Un pedido Flex sin esta columna existe en la
 * base y es INVISIBLE en el panel del courier — el backfill nunca la escribía.
 *
 * Cascada (decisión del usuario): la fecha que promete ML y, si no viene, la
 * fecha de creación de la orden. La columna es `date` y el proyecto opera en
 * America/Santiago, así que la conversión pasa por `fechaLocalEnSantiago` y
 * nunca por un truncado de UTC (a las 21:00 de Santiago UTC ya está en el día
 * siguiente y el pedido caería fuera del panel del día).
 */
export function derivarFechaCompromiso(
  fechaEntregaIso: string | null,
  ordenCreadaIso: string | null | undefined,
): string | null {
  for (const candidato of [fechaEntregaIso, ordenCreadaIso]) {
    const texto = textoONull(candidato);
    if (!texto) continue;
    const instante = new Date(texto);
    if (Number.isNaN(instante.getTime())) continue;
    return fechaLocalEnSantiago(instante);
  }
  return null;
}

/**
 * Normaliza un shipment crudo de ML a lo que consume la ingesta, y produce el
 * diagnóstico de forma. Función PURA y exportada: los tests la ejercen tal cual,
 * sin espejos que validen el supuesto contra sí mismo.
 */
export function interpretarShipment(shipment: ShipmentMl): {
  datos: DatosShipmentMl;
  diagnostico: DiagnosticoShipmentMl;
} {
  const { valor: logisticType, ubicacion: ubicacionLogisticType } = leerLogisticType(shipment);
  const { direccion, ubicacion: ubicacionDireccion } = leerDireccionShipment(shipment);
  const { iso: fechaEntregaIso, campo: campoFechaEntrega } = leerFechaEntregaMl(shipment);
  const { lat, long } = coordenadasDeReceiver(direccion);

  const nodoPlazos = (shipment.lead_time ?? shipment.shipping_option ?? null) as Record<
    string,
    unknown
  > | null;

  return {
    datos: {
      logisticType,
      lat,
      long,
      estadoMl: textoONull(shipment.status),
      subestadoMl: textoONull(shipment.substatus),
      fechaEntregaIso,
      destinatarioNombre: textoONull(shipment.destination?.receiver_name),
      destinatarioDireccion: calleDeDireccion(direccion),
      destinatarioComuna:
        textoONull(direccion?.city?.name) ?? textoONull(direccion?.municipality?.name),
    },
    diagnostico: {
      // Solo NOMBRES de campo. Nunca valores: aquí adentro hay PII.
      claves: Object.keys(shipment).sort(),
      clavesPlazos: nodoPlazos ? Object.keys(nodoPlazos).sort() : [],
      ubicacionLogisticType,
      ubicacionDireccion,
      campoFechaEntrega,
    },
  };
}

// =============================================================================
// Lectura de shipments contra la API (de a uno, con concurrencia acotada)
// =============================================================================

/** Un envío que no se pudo leer. `motivo` nunca lleva cuerpo de respuesta. */
export interface FalloShipment {
  shipmentId: string;
  motivo: string;
  /**
   * Status HTTP cuando el fallo vino de ML. Se conserva porque el **404 tiene
   * tratamiento propio**: la doc de ML NO dice qué devuelve para un envío
   * cancelado, así que asumir cancelación por un 404 podría cancelar pedidos
   * vivos ante un error transitorio. Nunca se infiere estado de un 404.
   */
  status?: number;
}

export interface ResultadoLoteShipments {
  datos: Map<string, DatosShipmentMl>;
  /** Shipment crudo, para lo que necesite el llamador (p. ej. el `order_id`). */
  crudos: Map<string, ShipmentMl>;
  fallidos: FalloShipment[];
  /** Forma del PRIMER shipment leído con éxito — para el log de diagnóstico. */
  diagnostico: DiagnosticoShipmentMl | null;
}

/**
 * Recorre `items` con un pool de `limite` trabajadores. Sin dependencias
 * nuevas (CLAUDE.md: nada de colas ni infraestructura propia) y preservando el
 * orden de entrada en la salida.
 */
export async function mapearConConcurrencia<T, R>(
  items: readonly T[],
  limite: number,
  fn: (item: T, indice: number) => Promise<R>,
): Promise<R[]> {
  const salida = new Array<R>(items.length);
  let cursor = 0;

  const trabajadores = Array.from({ length: Math.max(1, Math.min(limite, items.length)) }, () =>
    (async () => {
      for (;;) {
        const indice = cursor;
        cursor += 1;
        if (indice >= items.length) return;
        salida[indice] = await fn(items[indice], indice);
      }
    })(),
  );

  await Promise.all(trabajadores);
  return salida;
}

/** Un solo `GET /shipments/{id}`, con la cabecera obligatoria y backoff. */
export async function obtenerShipment(
  shipmentId: string,
  accessToken: string,
): Promise<ShipmentMl> {
  const respuesta = await peticionMl<ShipmentMl | null>({
    metodo: "GET",
    // El detalle de envío es SINGULAR. No existe `GET /shipments?ids=…`.
    ruta: `/shipments/${encodeURIComponent(shipmentId)}`,
    accessToken,
    encabezadosExtra: { ...ENCABEZADO_FORMATO_NUEVO_ML },
  });
  return respuesta ?? {};
}

/**
 * Trae los datos de una lista de shipments consultándolos **de a uno**, con
 * concurrencia acotada y tolerancia al fallo individual: un envío que devuelve
 * 404 (o cualquier error) se registra en `fallidos` y NO tumba el lote.
 *
 * Antes esto era un `fetch` crudo a `GET /shipments?ids=…` — un endpoint que no
 * existe: 404 duro, página entera perdida, cero pedidos ingeridos.
 */
export async function obtenerDatosPorShipment(
  shipmentIds: string[],
  accessToken: string,
  opciones: { concurrencia?: number } = {},
): Promise<ResultadoLoteShipments> {
  const datos = new Map<string, DatosShipmentMl>();
  const crudos = new Map<string, ShipmentMl>();
  const fallidos: FalloShipment[] = [];
  let diagnostico: DiagnosticoShipmentMl | null = null;

  if (shipmentIds.length === 0) return { datos, crudos, fallidos, diagnostico };

  const resultados = await mapearConConcurrencia(
    shipmentIds,
    opciones.concurrencia ?? CONCURRENCIA_SHIPMENTS,
    async (shipmentId) => {
      try {
        const shipment = await obtenerShipment(shipmentId, accessToken);
        return { shipmentId, shipment, interpretado: interpretarShipment(shipment) };
      } catch (error) {
        // `ErrorHttpMl.message` trae método + ruta + status, jamás el cuerpo ni
        // el token. Cualquier otro error se reduce a su `message`.
        if (error instanceof ErrorHttpMl) {
          return { shipmentId, fallo: `HTTP ${error.status}`, status: error.status };
        }
        return {
          shipmentId,
          fallo: error instanceof Error ? error.message : "error desconocido",
        };
      }
    },
  );

  for (const resultado of resultados) {
    if ("fallo" in resultado && resultado.fallo) {
      fallidos.push({
        shipmentId: resultado.shipmentId,
        motivo: resultado.fallo,
        ...("status" in resultado && typeof resultado.status === "number"
          ? { status: resultado.status }
          : {}),
      });
      continue;
    }
    if ("interpretado" in resultado && resultado.interpretado) {
      datos.set(resultado.shipmentId, resultado.interpretado.datos);
      crudos.set(resultado.shipmentId, resultado.shipment);
      diagnostico ??= resultado.interpretado.diagnostico;
    }
  }

  return { datos, crudos, fallidos, diagnostico };
}

/**
 * Compatibilidad: el filtro a Flex solo necesita el `logistic_type`.
 * Se conserva como envoltorio para no tocar sus llamadores ni sus tests.
 */
export async function obtenerLogisticTypePorShipment(
  shipmentIds: string[],
  accessToken: string,
): Promise<Map<string, string | null>> {
  const { datos } = await obtenerDatosPorShipment(shipmentIds, accessToken);
  return new Map([...datos].map(([id, d]) => [id, d.logisticType]));
}

// =============================================================================
// Persistencia — INSERT vs UPDATE explícitos (NO un upsert ciego)
// =============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Cliente Supabase service_role. Se tipa laxo: el esquema no está generado. */
type ClienteSupabase = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Cómo llegó el pedido al sistema (enum `operacion.origen_pedido`). */
export type OrigenIngestaMl = "ml_ingesta" | "backfill";

/** Logger mínimo — el de Inngest lo cumple; en tests se pasa un doble. */
export interface LoggerIngesta {
  info: (mensaje: string) => void;
  warn: (mensaje: string) => void;
  error: (mensaje: string) => void;
}

/** De qué cuenta/seller/tenant se está ingiriendo. */
export interface ContextoIngestaMl {
  tenantId: string;
  sellerId: string;
  /** Cuenta ML de origen — se estampa en `operacion.pedidos.ml_user_id`. */
  mlUserId: string;
  origen: OrigenIngestaMl;
}

/** Un envío a ingerir, más lo que el llamador ya sepa de su orden. */
export interface EntradaShipmentIngesta {
  shipmentId: string;
  /** Id de la orden si el llamador lo tiene (búsqueda de órdenes). */
  mlOrderId?: string | null;
  /** `order.date_created` — respaldo de `fecha_compromiso`. */
  ordenCreadaIso?: string | null;
  /** Dirección/comuna legacy de la orden, último respaldo. */
  direccionRespaldo?: string | null;
  comunaRespaldo?: string | null;
}

export interface ResumenIngestaMl {
  insertados: number;
  actualizados: number;
  /** insertados + actualizados. */
  procesados: number;
  omitidosNoFlex: number;
  /** Envíos que no se pudieron leer por un motivo distinto de 404. */
  ilegibles: number;
  /**
   * Envíos que ML respondió 404. **NO se asume cancelación**: la doc no dice
   * qué devuelve ML para un envío cancelado y adivinar significaría cancelar
   * pedidos vivos por un error transitorio.
   */
  noEncontrados: string[];
  erroresPersistencia: number;
  primerErrorPersistencia: string | null;
  diagnostico: DiagnosticoShipmentMl | null;
}

function resumenVacio(): ResumenIngestaMl {
  return {
    insertados: 0,
    actualizados: 0,
    procesados: 0,
    omitidosNoFlex: 0,
    ilegibles: 0,
    noEncontrados: [],
    erroresPersistencia: 0,
    primerErrorPersistencia: null,
    diagnostico: null,
  };
}

/**
 * Marca informativa de riesgo de corte (F7). NUNCA bloquea ni rechaza — es un
 * flag de aviso, y describe el momento en que el pedido ENTRÓ. Por eso se
 * calcula solo al insertar: recalcularla en cada re-sincronización la pondría
 * en `true` para todo el padrón a partir de la hora de corte, que es falso.
 */
async function calcularCorteRiesgoFlex(
  supabase: ClienteSupabase,
  tenantId: string,
  sellerId: string,
  comuna: string,
): Promise<boolean> {
  try {
    const comunaNorm = resolverComunaCanonica(comuna);
    if (!comunaNorm) return false;
    const zonaId = await resolverZona(supabase, tenantId, comunaNorm);
    const ventana = await resolverVentanaCorte(supabase, tenantId, sellerId, zonaId, "flex");
    if (!ventana) return false;
    const { hora } = ahoraEnSantiago();
    return horaAMinutos(hora) > horaAMinutos(ventana.horaCorte);
  } catch {
    // Cálculo best-effort — jamás interrumpe la ingesta.
    return false;
  }
}

/** Fila mínima que se lee antes de decidir INSERT vs UPDATE. */
interface FilaPedidoExistente {
  id: string;
  ml_order_id: string | null;
  geo_estado: string | null;
}

export type ResultadoGuardado =
  | { estado: "insertado"; pedidoId: string }
  | { estado: "actualizado"; pedidoId: string }
  | { estado: "error"; mensaje: string };

/**
 * Persiste UN pedido Flex: INSERT si es nuevo, UPDATE acotado si ya existe.
 *
 * ⚠️ **Por qué NO es un `upsert`.** `upsert(..., { onConflict })` escribe TODAS
 * las columnas del payload también en el UPDATE. El backfill lo hacía así y
 * mandaba `estado: 'pendiente_asignacion'` en cada pasada: bastaba con que la
 * ventana volviera a cubrir un pedido ya `asignado`/`en_ruta` para devolverlo a
 * la bandeja sin asignar. Nunca explotó porque el backfill corre una vez al
 * reconectar y en producción no había filas Flex previas — pero una ingesta
 * continua cada 30 minutos lo habría convertido en pérdida de operación diaria.
 *
 * En el UPDATE solo se tocan los campos que ML posee: estado/subestado del
 * envío, marca de sincronización, compromiso, datos del destinatario (ML los
 * revela recién con el pago confirmado) y la coordenada si todavía no la
 * había. NUNCA: `estado`, `origen`, `corte_riesgo`, ni un `ml_order_id` que ya
 * estaba con un `null`.
 */
export async function guardarPedidoFlex(
  supabase: ClienteSupabase,
  ctx: ContextoIngestaMl,
  entrada: EntradaShipmentIngesta,
  datos: DatosShipmentMl,
  mlOrderIdDelShipment: string | null,
): Promise<ResultadoGuardado> {
  const ahoraIso = new Date().toISOString();
  const direccion =
    datos.destinatarioDireccion ?? entrada.direccionRespaldo ?? "Dirección pendiente";
  const comuna = datos.destinatarioComuna ?? entrada.comunaRespaldo ?? "Santiago";
  const fechaCompromiso = derivarFechaCompromiso(datos.fechaEntregaIso, entrada.ordenCreadaIso);
  const mlOrderId = entrada.mlOrderId ?? mlOrderIdDelShipment;

  const { data: existenteData, error: errorLectura } = await supabase
    .schema("operacion")
    .from("pedidos")
    .select("id, ml_order_id, geo_estado")
    .eq("tenant_id", ctx.tenantId)
    .eq("ml_shipment_id", entrada.shipmentId)
    .maybeSingle();

  if (errorLectura) {
    return { estado: "error", mensaje: errorLectura.message };
  }

  const existente = (existenteData as FilaPedidoExistente | null) ?? null;

  if (existente) {
    return actualizarPedidoFlex(supabase, existente, {
      datos,
      direccion,
      comuna,
      fechaCompromiso,
      mlOrderId,
      mlUserId: ctx.mlUserId,
      ahoraIso,
    });
  }

  const corteRiesgo = await calcularCorteRiesgoFlex(
    supabase,
    ctx.tenantId,
    ctx.sellerId,
    comuna,
  );

  // La ingesta SÍ traduce en el INSERT (a diferencia del UPDATE de un pedido
  // existente — ver `actualizarPedidoFlex` más abajo, que NUNCA toca `estado`).
  // Decisión del usuario: "el estado real de ML se refleja siempre en Rutax".
  // Si ML ya reporta un estado avanzado (delivered/shipped/not_delivered/
  // cancelled) al momento en que Rutax DESCUBRE el pedido —por definición
  // tarde, sin conductor asignado todavía—, el pedido nace reflejando esa
  // realidad en vez de nacer `pendiente_asignacion` y quedarse congelado ahí
  // para siempre (el bug que se cierra con este cambio). Si `traducirEstadoMl`
  // no resuelve nada (pre-despacho: ready_to_ship/pending/handling, o un
  // subestado/estado nuevo de ML que aún no mapeamos) se OMITE la clave y
  // manda el DEFAULT de la columna ('pendiente_asignacion'), que es lo
  // correcto — mismo mecanismo de omisión que protegía el INSERT hasta ahora.
  const estadoInsertado = datos.estadoMl
    ? traducirEstadoMl(datos.estadoMl, datos.subestadoMl)
    : null;

  const fila: Record<string, unknown> = {
    tenant_id: ctx.tenantId,
    seller_id: ctx.sellerId,
    ml_user_id: ctx.mlUserId,
    tipo_pedido: "flex",
    origen: ctx.origen,
    ml_shipment_id: entrada.shipmentId,
    ...(estadoInsertado ? { estado: estadoInsertado } : {}),
    estado_ml: datos.estadoMl,
    subestado_ml: datos.subestadoMl,
    ultima_sync_ml_en: ahoraIso,
    destinatario_nombre: datos.destinatarioNombre ?? "Destinatario pendiente",
    destinatario_direccion: direccion,
    destinatario_comuna: comuna,
    fecha_compromiso: fechaCompromiso,
    corte_riesgo: corteRiesgo,
    ...(mlOrderId ? { ml_order_id: mlOrderId } : {}),
    // Solo se escriben las columnas geo si ML trajo coordenada. Sin ella el
    // pedido queda en `pendiente` y lo toma la cola de geocodificación.
    ...(datos.lat != null
      ? {
          lat: datos.lat,
          long: datos.long,
          geo_estado: "resuelto",
          // La coordenada viene de la propia plataforma que originó el pedido,
          // no de un geocodificador que interpreta texto.
          geo_confianza: 1,
          geocodificado_en: ahoraIso,
        }
      : {}),
  };

  const { data: insertada, error: errorInsert } = await supabase
    .schema("operacion")
    .from("pedidos")
    .insert(fila)
    .select("id, destinatario_direccion, destinatario_comuna")
    .maybeSingle();

  if (errorInsert) {
    // 23505 = unique_violation. Otra ejecución concurrente (webhook + cron a la
    // vez) ganó la carrera: no es un error, es el camino idempotente.
    if ((errorInsert as { code?: string }).code === "23505") {
      const { data: reintento } = await supabase
        .schema("operacion")
        .from("pedidos")
        .select("id, ml_order_id, geo_estado")
        .eq("tenant_id", ctx.tenantId)
        .eq("ml_shipment_id", entrada.shipmentId)
        .maybeSingle();
      const fila2 = (reintento as FilaPedidoExistente | null) ?? null;
      if (fila2) {
        return actualizarPedidoFlex(supabase, fila2, {
          datos,
          direccion,
          comuna,
          fechaCompromiso,
          mlOrderId,
          mlUserId: ctx.mlUserId,
          ahoraIso,
        });
      }
    }
    return { estado: "error", mensaje: errorInsert.message };
  }

  const pedidoId = (insertada as { id?: string } | null)?.id;
  if (!pedidoId) {
    return { estado: "error", mensaje: "el INSERT no devolvió el id del pedido" };
  }

  // Gatillo de geocodificación. Best-effort: un fallo de Inngest no puede
  // romper la ingesta. El payload NO lleva nombre ni teléfono.
  //
  // ⚠️ Este evento es el ÚNICO camino a la coordenada. Una versión anterior de
  // este comentario decía que "el job de geocoding barre por índice", y es
  // falso (verificado 2026-08-13): no hay cron, solo este disparo. Un pedido
  // Flex cuyo send falle queda sin ubicar indefinidamente y solo se recupera a
  // mano desde `/operaciones`. Ver la nota extendida en
  // `src/modules/operacion/pedidos.ts`, en el catch del mismo envío.
  try {
    await inngest.send({
      name: "operacion/pedido.ingestado",
      id: `pedido-ingestado-${pedidoId}`,
      data: {
        pedidoId,
        tenantId: ctx.tenantId,
        sellerId: ctx.sellerId,
        direccion,
        comuna,
        tipoPedido: "flex" as const,
      },
    });
  } catch {
    // Silencio deliberado (ver arriba).
  }

  return { estado: "insertado", pedidoId };
}

async function actualizarPedidoFlex(
  supabase: ClienteSupabase,
  existente: FilaPedidoExistente,
  campos: {
    datos: DatosShipmentMl;
    direccion: string;
    comuna: string;
    fechaCompromiso: string | null;
    mlOrderId: string | null;
    mlUserId: string;
    ahoraIso: string;
  },
): Promise<ResultadoGuardado> {
  const { datos } = campos;

  const cambios: Record<string, unknown> = {
    estado_ml: datos.estadoMl,
    subestado_ml: datos.subestadoMl,
    ultima_sync_ml_en: campos.ahoraIso,
    // Estampa la cuenta de origen en pedidos legacy que entraron sin ella.
    ml_user_id: campos.mlUserId,
  };

  // Nunca se pisa un id de orden conocido con un `null`.
  if (campos.mlOrderId && !existente.ml_order_id) {
    cambios.ml_order_id = campos.mlOrderId;
  }
  // El domicilio de ML se oculta hasta que el pago está confirmado, así que un
  // pedido puede entrar con "Dirección pendiente" y recibir la real después.
  // Solo se escribe cuando el shipment TRAJO el dato: nunca al revés.
  if (datos.destinatarioDireccion) cambios.destinatario_direccion = datos.destinatarioDireccion;
  if (datos.destinatarioComuna) cambios.destinatario_comuna = datos.destinatarioComuna;
  if (datos.destinatarioNombre) cambios.destinatario_nombre = datos.destinatarioNombre;
  if (campos.fechaCompromiso) cambios.fecha_compromiso = campos.fechaCompromiso;

  // La coordenada solo se rellena si todavía faltaba. Si ya está resuelta (por
  // ML o por el geocodificador), no se re-escribe: `geocodificado_en` dejaría
  // de significar «cuándo se resolvió».
  if (datos.lat != null && existente.geo_estado !== "resuelto") {
    cambios.lat = datos.lat;
    cambios.long = datos.long;
    cambios.geo_estado = "resuelto";
    cambios.geo_confianza = 1;
    cambios.geocodificado_en = campos.ahoraIso;
  }

  const { error } = await supabase
    .schema("operacion")
    .from("pedidos")
    .update(cambios)
    .eq("id", existente.id);

  if (error) return { estado: "error", mensaje: error.message };
  return { estado: "actualizado", pedidoId: existente.id };
}

// =============================================================================
// Orquestación: lote de envíos → pedidos Flex en BD
// =============================================================================

/**
 * Ingiere un lote de envíos de ML como pedidos Flex.
 *
 * Es LA pieza que comparten backfill, webhook y cron. Consulta cada envío
 * (`GET /shipments/{id}`), filtra a Flex (`self_service`), y persiste con
 * INSERT/UPDATE explícitos. Tolerante al fallo individual: un envío ilegible no
 * tumba el lote.
 *
 * @param accessToken token EN CLARO — se usa solo para construir el header y no
 *   se guarda, loguea ni reenvía. Sale de scope al terminar la función.
 */
export async function ingestarShipmentsMl(
  supabase: ClienteSupabase,
  entradas: readonly EntradaShipmentIngesta[],
  ctx: ContextoIngestaMl,
  accessToken: string,
  opciones: { concurrencia?: number; logger?: LoggerIngesta } = {},
): Promise<ResumenIngestaMl> {
  const resumen = resumenVacio();
  if (entradas.length === 0) return resumen;

  const ids = entradas.map((e) => e.shipmentId);
  const lote = await obtenerDatosPorShipment(ids, accessToken, {
    concurrencia: opciones.concurrencia,
  });
  resumen.diagnostico = lote.diagnostico;

  for (const fallo of lote.fallidos) {
    if (fallo.status === 404) resumen.noEncontrados.push(fallo.shipmentId);
    else resumen.ilegibles += 1;
  }

  for (const entrada of entradas) {
    const datos = lote.datos.get(entrada.shipmentId);
    if (!datos) continue; // ilegible/404: ya contabilizado arriba.

    // Filtro de alcance: solo Flex. Si el tipo no es `self_service`
    // (Full/Colecta/Agencia) o no se pudo resolver, se omite — jamás se
    // ingiere como Flex por descarte.
    if (datos.logisticType !== LOGISTIC_TYPE_FLEX) {
      resumen.omitidosNoFlex += 1;
      continue;
    }

    const crudo = lote.crudos.get(entrada.shipmentId) ?? null;
    const resultado = await guardarPedidoFlex(
      supabase,
      ctx,
      entrada,
      datos,
      leerOrderIdDeShipment(crudo),
    );

    if (resultado.estado === "error") {
      resumen.erroresPersistencia += 1;
      resumen.primerErrorPersistencia ??= resultado.mensaje;
      // El shipment_id no es dato personal (la Torre ya lo muestra); el mensaje
      // de Postgres no lleva PII del destinatario.
      opciones.logger?.error(
        `Ingesta ML: no se pudo guardar el envío ${entrada.shipmentId}: ${resultado.mensaje}`,
      );
      continue;
    }

    if (resultado.estado === "insertado") resumen.insertados += 1;
    else resumen.actualizados += 1;
    resumen.procesados += 1;
  }

  return resumen;
}
