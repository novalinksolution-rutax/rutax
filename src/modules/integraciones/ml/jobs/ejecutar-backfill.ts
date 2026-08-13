/**
 * Job 5 · ml/ejecutarBackfill
 * =====================================================================
 * Trigger: evento `ml/conexion.reconectada`
 * (publicado por `intercambiarCodigoPorTokens` en puerto.ts cuando el
 * intercambio OAuth es exitoso)
 *
 * Recupera los pedidos de ML del período en que el seller estuvo desconectado
 * y los inserta/actualiza en `operacion.pedidos` con `origen = 'backfill'`.
 *
 * Idempotencia (dos niveles):
 * 1. Unique constraint `(conexion_ml_id, desde, hasta)` en `intentos_backfill`
 *    garantiza que no se puede iniciar el mismo backfill dos veces.
 * 2. Upsert sobre `(tenant_id, ml_shipment_id)` en `operacion.pedidos` absorbe
 *    duplicados si el job se reintenta.
 *
 * Límite de ventana: si `desconectada_desde` es null o > 7 días atrás, se
 * acota a 7 días y se deja constancia en el log.
 *
 * SEGURIDAD: tokens nunca en logs. Del shipment NUNCA se loguea un valor —
 * trae nombre y dirección del destinatario. El diagnóstico de forma solo
 * imprime `Object.keys` (nombres de campo) y en qué rama apareció cada dato.
 *
 * ---------------------------------------------------------------------
 * CONTRATO CON LA API DE ML (verificado 2026-08-12 contra la doc oficial:
 * developers.mercadolibre.cl/es_ar/envios y .../es_ar/gestiona-ventas)
 * ---------------------------------------------------------------------
 * 1. `GET /orders/search?seller=…&order.date_created.from=…&…` — paginado con
 *    `offset`/`limit` (máx. 50). El id del envío es **`order.shipping.id`**
 *    («shipping: ID del envío para esta orden»), y puede venir `null` cuando ML
 *    todavía no creó el envío: caso ESPERADO, se recoge en la próxima pasada.
 *    NO se le manda `x-format-new` — ver `ENCABEZADO_FORMATO_NUEVO_ML`.
 *
 * 2. `GET /shipments/{id}` — **de a uno**, con `x-format-new: true`.
 *    NO existe un batch `GET /shipments?ids=…`: ese patrón («hasta 50 ids
 *    separados por coma») pertenece a OTRO recurso, `/shipment_labels`, que
 *    genera etiquetas y no devuelve `logistic_type` ni coordenadas. Pedirle
 *    `?ids=` a `/shipments` devuelve **404** — y eso es exactamente lo que
 *    mató este job en producción (tres corridas, 0 pedidos ingeridos).
 *    El único detalle de envío documentado es el singular.
 *
 * 3. `x-format-new: true` es OBLIGATORIA en shipments. Cita textual de la doc
 *    oficial: «A partir del 12 de octubre de 2025 […] el envío del header
 *    x-format-new: true pasará a ser obligatorio en todas las solicitudes».
 *    Esa fecha ya pasó.
 *
 * 4. Con el formato nuevo la respuesta cambia de forma, y la doc de ML **se
 *    contradice consigo misma**: la página de envíos muestra el nodo anidado
 *    `logistic: { mode, type, direction }`, mientras que la de Mercado Envíos 2
 *    muestra `logistic_type` plano (en un ejemplo que llama a `/shipments/{id}`
 *    SIN el header). Por eso todo lo que se lee del shipment se lee de forma
 *    DEFENSIVA, aceptando ambas ubicaciones. Lo mismo con la dirección:
 *    `destination.shipping_address` (nuevo) o `receiver_address` (legacy).
 */

import { inngest } from "@/lib/inngest/cliente";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { descifrarSecreto } from "../../secretos";
import { peticionMl, ErrorHttpMl } from "../cliente-http";
import { ahoraEnSantiago, horaAMinutos, fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import { resolverComunaCanonica } from "@/modules/integraciones/geocoding/normalizacion";
import { resolverZona } from "@/modules/operacion/zonas";
import { resolverVentanaCorte } from "@/modules/operacion/ventanas-corte";

const VENTANA_MAXIMA_DIAS = 7;
const PAGE_SIZE = 50;

/**
 * Corte duro de páginas de `/orders/search`. Sin él, un `results: []` con
 * `total > 0` (posible bajo límite de tasa) deja `offset` clavado y el paso
 * gira hasta el timeout de Inngest. El corte por `results` vacío ya rompe ese
 * bucle; esto es el cinturón por si ML devuelve una página no vacía en loop.
 * 200 páginas × 50 = 10.000 órdenes, muy por encima de una ventana de 7 días.
 */
export const MAX_PAGINAS_BACKFILL = 200;

/**
 * Llamadas simultáneas a `GET /shipments/{id}` dentro de una página.
 *
 * Pasamos de 1 llamada por página a N (hasta 50), así que la concurrencia deja
 * de ser un detalle. 6 es deliberadamente conservador: la doc oficial publica
 * 1000 rpm para los recursos Flex y NO publica un número estable para
 * `/shipments`, así que no se rafaguean 50 conexiones de golpe. Cada llamada
 * pasa igual por `peticionMl` → backoff + respeto de `Retry-After`.
 */
export const CONCURRENCIA_SHIPMENTS = 6;

/**
 * Cabecera obligatoria de los recursos de shipments (ver §3 del encabezado).
 * Exportada para que la prueba de regresión pueda fijarla: si alguien la quita,
 * el test falla antes que producción.
 *
 * **NO se le pone a `/orders/search`, a propósito.** Tres razones: (a) el aviso
 * de obligatoriedad de la doc oficial está acotado a «los recursos de
 * shipments»; (b) todos los ejemplos de `/orders/search` en la doc de órdenes
 * la omiten; (c) la respuesta de órdenes YA trae la forma nueva —
 * `"shipping": { "id": … }` — sin el header, y producción lo confirma (el job
 * llegó a pedir shipments, o sea que `shipping.id` venía poblado). Agregarle
 * una cabecera no documentada a la única llamada que hoy funciona es riesgo
 * sin beneficio.
 */
export const ENCABEZADO_FORMATO_NUEVO_ML: Readonly<Record<string, string>> = Object.freeze({
  "x-format-new": "true",
});

/**
 * Tipo logístico de Mercado Libre que corresponde a Flex (el seller/courier
 * hace el last-mile). Es el ÚNICO que este SaaS ingiere: Full (`fulfillment`),
 * Colecta (`cross_docking`) y Agencia (`drop_off`/`xd_drop_off`) los despacha
 * ML, no hay conductor del courier — el motor entrega→dinero no aplica.
 * Fuente: `logistic.type` (formato nuevo) / `logistic_type` (legacy).
 */
export const LOGISTIC_TYPE_FLEX = "self_service";

interface EventoConexionReconectada {
  conexionId: string;
  sellerId: string;
  tenantId: string;
  desconectadaDesde: string | null;
}

interface FilaConexionBackfill {
  id: string;
  seller_id: string;
  tenant_id: string;
  ml_user_id: string | null;
  access_token_ref: string | null;
}

/** Pedido de ML (campos mínimos para el backfill). */
export interface OrderMl {
  id: number | string;
  /**
   * El envío de la orden. El id del shipment es `shipping.id` (ver la nota del
   * encabezado): puede venir `null` mientras ML no crea el envío.
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
 * documentado por ML — la orden se recoge en una pasada posterior del backfill.
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
}

/** Lo que el backfill necesita de un shipment, ya normalizado. */
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
 *   plazo de reembolso, típicamente varios días después; escribirlo en
 *   `fecha_compromiso` mandaría el pedido a un día equivocado del panel.
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
 * Normaliza un shipment crudo de ML a lo que consume el backfill, y produce el
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
}

export interface ResultadoLoteShipments {
  datos: Map<string, DatosShipmentMl>;
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
 * 404 (o cualquier error) se registra en `fallidos` y NO tumba la página.
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
  const fallidos: FalloShipment[] = [];
  let diagnostico: DiagnosticoShipmentMl | null = null;

  if (shipmentIds.length === 0) return { datos, fallidos, diagnostico };

  const resultados = await mapearConConcurrencia(
    shipmentIds,
    opciones.concurrencia ?? CONCURRENCIA_SHIPMENTS,
    async (shipmentId) => {
      try {
        const shipment = await obtenerShipment(shipmentId, accessToken);
        return { shipmentId, interpretado: interpretarShipment(shipment) };
      } catch (error) {
        // `ErrorHttpMl.message` trae método + ruta + status, jamás el cuerpo ni
        // el token. Cualquier otro error se reduce a su `message`.
        const motivo =
          error instanceof ErrorHttpMl
            ? `HTTP ${error.status}`
            : error instanceof Error
              ? error.message
              : "error desconocido";
        return { shipmentId, fallo: motivo };
      }
    },
  );

  for (const resultado of resultados) {
    if ("fallo" in resultado && resultado.fallo) {
      fallidos.push({ shipmentId: resultado.shipmentId, motivo: resultado.fallo });
      continue;
    }
    if ("interpretado" in resultado && resultado.interpretado) {
      datos.set(resultado.shipmentId, resultado.interpretado.datos);
      diagnostico ??= resultado.interpretado.diagnostico;
    }
  }

  return { datos, fallidos, diagnostico };
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
// Job
// =============================================================================

/**
 * Marca el intento como fallido con su mensaje. Escritura PLANA (fuera de
 * `step.run`) a propósito: se ejecuta en el camino de error sin alterar la
 * secuencia de pasos memoizados de Inngest entre reintentos.
 *
 * El mensaje se trunca y NUNCA incluye cuerpos de respuesta de ML ni datos del
 * destinatario — solo el texto del error (método, ruta, status).
 */
async function marcarIntentoFallido(intentoId: string, mensaje: string): Promise<void> {
  const supabase = crearClienteServiceRole();
  await supabase
    .schema("operacion")
    .from("intentos_backfill")
    .update({ estado: "fallido", error: mensaje.slice(0, 500) })
    .eq("id", intentoId);
}

export const jobEjecutarBackfill = inngest.createFunction(
  {
    id: "ml/ejecutarBackfill",
    name: "ML · Backfill de pedidos tras reconexión",
    triggers: [{ event: "ml/conexion.reconectada" }],
    retries: 3,
  },
  async ({ event, step, logger }) => {
    const payload = event.data as EventoConexionReconectada;
    const { conexionId, sellerId, tenantId } = payload;

    // Paso 1: calcular ventana de tiempo y crear/reutilizar el intento de backfill.
    const intentoBackfill = await step.run("crear-o-reutilizar-intento", async () => {
      const ahora = new Date();
      const ventanaMaxima = new Date(ahora.getTime() - VENTANA_MAXIMA_DIAS * 24 * 60 * 60 * 1000);

      let desconectadaDesde: Date;
      let ventanaRecortada = false;

      if (!payload.desconectadaDesde) {
        // Primera vinculación o dato ausente: acotar a 7 días.
        desconectadaDesde = ventanaMaxima;
        ventanaRecortada = true;
        logger.info(
          `Conexión ${conexionId}: desconectada_desde es null. ` +
            `Acotando backfill a ${VENTANA_MAXIMA_DIAS} días.`,
        );
      } else {
        const fechaDesconexion = new Date(payload.desconectadaDesde);
        if (fechaDesconexion < ventanaMaxima) {
          desconectadaDesde = ventanaMaxima;
          ventanaRecortada = true;
          logger.info(
            `Conexión ${conexionId}: desconectada_desde (${payload.desconectadaDesde}) ` +
              `excede ${VENTANA_MAXIMA_DIAS} días. Acotando.`,
          );
        } else {
          desconectadaDesde = fechaDesconexion;
        }
      }

      const supabase = crearClienteServiceRole();

      // Idempotencia: insertar ignorando conflicto de unique constraint.
      const { data: intentoData, error: insertError } = await supabase
        .schema("operacion")
        .from("intentos_backfill")
        .upsert(
          {
            tenant_id: tenantId,
            conexion_ml_id: conexionId,
            seller_id: sellerId,
            desde: desconectadaDesde.toISOString(),
            hasta: ahora.toISOString(),
            estado: "en_progreso",
          },
          {
            onConflict: "conexion_ml_id,desde,hasta",
            ignoreDuplicates: false, // Actualizar si ya existe
          },
        )
        .select("id, desde, hasta, estado")
        .single();

      if (insertError) {
        throw new Error(`Error al crear intento de backfill: ${insertError.message}`);
      }

      return {
        intentoId: intentoData.id as string,
        desde: new Date(intentoData.desde as string),
        hasta: new Date(intentoData.hasta as string),
        ventanaRecortada,
        // Si ya estaba completado, indicarlo para hacer no-op
        yaCompletado: intentoData.estado === "completado",
      };
    });

    // Idempotencia: si ya estaba completado (reintento tras éxito), salir.
    if (intentoBackfill.yaCompletado) {
      logger.info(
        `Backfill ${intentoBackfill.intentoId} ya está completado. No-op idempotente.`,
      );
      return { resultado: "ya_completado", intentoId: intentoBackfill.intentoId };
    }

    // A partir de aquí el intento EXISTE, así que cualquier muerte tiene que
    // quedar escrita en él. Sin este envoltorio, el único camino que escribía
    // `fallido` era el guard de conexión incompleta: los tres intentos que
    // murieron en producción quedaron en `en_progreso` para siempre.
    //
    // Inngest lanza el error del paso dentro del cuerpo de la función cuando el
    // paso agota sus reintentos, así que este catch corre también en el último
    // intento — que es justo el caso que interesa. Si un reintento posterior sí
    // llega al final, `marcar-completado` sobrescribe el `fallido`.
    try {
      // Paso 2: obtener la conexión con el ml_user_id y access_token.
      const conexion = await step.run("obtener-conexion", async () => {
        const supabase = crearClienteServiceRole();
        const { data, error } = await supabase
          .schema("identidad")
          .from("conexiones_seller_ml")
          .select("id, seller_id, tenant_id, ml_user_id, access_token_ref")
          .eq("id", conexionId)
          .single();

        if (error || !data) {
          throw new Error(`No se encontró la conexión ${conexionId}: ${error?.message}`);
        }

        return data as FilaConexionBackfill;
      });

      if (!conexion.ml_user_id || !conexion.access_token_ref) {
        logger.error(
          `Conexión ${conexionId} sin ml_user_id o access_token_ref. Abortando backfill.`,
        );
        await marcarIntentoFallido(
          intentoBackfill.intentoId,
          "Conexión sin datos necesarios para backfill.",
        );
        return { resultado: "fallido", razon: "conexion_incompleta" };
      }

      // Paso 3: paginar sobre los pedidos del seller en el período y hacer upsert.
      const resumen = await step.run("paginar-y-upsert-pedidos", async () => {
        // Descifrar token
        const descifrado = await descifrarSecreto(conexion.access_token_ref!);
        if (typeof descifrado.valor !== "string") {
          throw new Error("access_token descifrado no es texto");
        }
        const accessToken = descifrado.valor;

        const supabase = crearClienteServiceRole();
        let offset = 0;
        let paginas = 0;
        let totalProcesados = 0;
        let totalOmitidosNoFlex = 0;
        let totalSinEnvio = 0;
        let totalShipmentsIlegibles = 0;
        let totalErroresUpsert = 0;
        let primerErrorUpsert: string | null = null;
        let diagnosticoRegistrado = false;
        let hayMas = true;

        // Inngest serializa el retorno de step.run a JSON — las fechas quedan
        // como strings ISO. Usamos directamente el string ya que viene de un
        // toISOString() en el paso anterior.
        const desdeIso = typeof intentoBackfill.desde === "string"
          ? intentoBackfill.desde
          : (intentoBackfill.desde as Date).toISOString();
        const hastaIso = typeof intentoBackfill.hasta === "string"
          ? intentoBackfill.hasta
          : (intentoBackfill.hasta as Date).toISOString();

        while (hayMas) {
          if (paginas >= MAX_PAGINAS_BACKFILL) {
            logger.warn(
              `Backfill conexión ${conexionId}: corte por tope de ${MAX_PAGINAS_BACKFILL} ` +
                "páginas. Quedaron órdenes sin recorrer en esta ventana.",
            );
            break;
          }
          paginas += 1;

          const parametros = new URLSearchParams({
            seller: conexion.ml_user_id!,
            "order.date_created.from": desdeIso,
            "order.date_created.to": hastaIso,
            limit: String(PAGE_SIZE),
            offset: String(offset),
          });

          // `peticionMl` en vez de `fetch` crudo: backoff ante 429/5xx y respeto
          // de `Retry-After`. Sin `x-format-new` — ver ENCABEZADO_FORMATO_NUEVO_ML.
          const body = await peticionMl<{
            results?: OrderMl[];
            paging?: { total?: number; offset?: number; limit?: number };
          }>({
            metodo: "GET",
            ruta: `/orders/search?${parametros.toString()}`,
            accessToken,
          });

          const orders: OrderMl[] = body.results ?? [];
          const total = body.paging?.total ?? 0;

          // Corte de seguridad: una página vacía con `total > 0` (posible bajo
          // límite de tasa) dejaba `offset` clavado y el paso giraba hasta el
          // timeout. Si ML no devuelve nada, se termina.
          if (orders.length === 0) {
            if (total > offset) {
              logger.warn(
                `Backfill conexión ${conexionId}: ML devolvió una página vacía con ` +
                  `total=${total} en offset=${offset}. Se corta el recorrido para no ` +
                  "girar en vacío; la próxima corrida lo retoma.",
              );
            }
            break;
          }

          // El detalle del envío se consulta de a uno (`GET /shipments/{id}`):
          // trae el logistic_type para filtrar a Flex, el domicilio real del
          // destinatario (con `x-format-new` la orden ya no lo trae), el estado
          // del ENVÍO y el compromiso de entrega. De paso, la coordenada cuando
          // ML la tiene: geocoding gratis, sin proveedor de pago.
          const shipmentIdsPagina = orders
            .map((o) => extraerShipmentId(o))
            .filter((id): id is string => id !== null);
          const lote = await obtenerDatosPorShipment(shipmentIdsPagina, accessToken);

          if (!diagnosticoRegistrado && lote.diagnostico) {
            diagnosticoRegistrado = true;
            const d = lote.diagnostico;
            // SOLO nombres de campo y ubicaciones. Ni un valor del shipment.
            logger.info(
              `Backfill conexión ${conexionId}: forma del shipment — ` +
                `claves=[${d.claves.join(",")}] ` +
                `plazos=[${d.clavesPlazos.join(",")}] ` +
                `logistic_type=${d.ubicacionLogisticType} ` +
                `direccion=${d.ubicacionDireccion} ` +
                `fecha_entrega=${d.campoFechaEntrega ?? "ausente"}`,
            );
          }

          if (lote.fallidos.length > 0) {
            totalShipmentsIlegibles += lote.fallidos.length;
            const resumenFallos = lote.fallidos
              .slice(0, 5)
              .map((f) => `${f.shipmentId}:${f.motivo}`)
              .join(", ");
            logger.warn(
              `Backfill conexión ${conexionId}: ${lote.fallidos.length} envíos no se ` +
                `pudieron leer en esta página (${resumenFallos}). Se omiten sin ` +
                "interrumpir; la próxima pasada los reintenta.",
            );
          }

          for (const order of orders) {
            const shipmentId = extraerShipmentId(order);

            // Envío aún no creado por ML (`shipping.id === null`): caso esperado,
            // no error. Se omite en esta pasada — la ventana del backfill vuelve a
            // cubrir la orden en la próxima corrida, y el pedido no se pierde.
            if (!shipmentId) {
              totalSinEnvio++;
              continue;
            }

            const datosShipment = lote.datos.get(shipmentId);

            // Filtro de alcance: solo Flex. Si el tipo no es self_service
            // (Full/Colecta/Agencia) o no se pudo resolver, se omite — nunca se
            // ingiere como Flex. Un shipment ilegible ya se contó aparte.
            if (!datosShipment) continue;
            if (datosShipment.logisticType !== LOGISTIC_TYPE_FLEX) {
              totalOmitidosNoFlex++;
              continue;
            }

            // El domicilio manda el shipment; la orden es respaldo legacy.
            const direccion =
              datosShipment.destinatarioDireccion ??
              order.shipping_address?.address_line ??
              "Dirección pendiente";
            const comuna =
              datosShipment.destinatarioComuna ??
              order.shipping_address?.city?.name ??
              "Santiago";

            // Marca informativa de corte_riesgo (F7, ítem 1.2).
            // NUNCA bloquea ni rechaza — es solo un flag de aviso.
            // Si falla la resolución de ventana se inserta el pedido sin la marca.
            let corteRiesgoFlex = false;
            try {
              const comunaFlexNorm = resolverComunaCanonica(comuna);
              if (comunaFlexNorm) {
                const zonaIdFlex = await resolverZona(supabase, tenantId, comunaFlexNorm);
                const ventanaFlex = await resolverVentanaCorte(
                  supabase,
                  tenantId,
                  sellerId,
                  zonaIdFlex,
                  'flex',
                );
                if (ventanaFlex) {
                  const { hora } = ahoraEnSantiago();
                  corteRiesgoFlex = horaAMinutos(hora) > horaAMinutos(ventanaFlex.horaCorte);
                }
              }
            } catch {
              // Cálculo de corte best-effort — no interrumpir la ingesta.
            }

            // Fecha del panel del día. Sin ella el pedido es invisible en
            // `/operaciones`, que filtra `.eq("fecha_compromiso", hoy)`.
            const fechaCompromiso = derivarFechaCompromiso(
              datosShipment.fechaEntregaIso,
              order.date_created,
            );

            // Upsert en operacion.pedidos con origen = 'backfill'
            // ON CONFLICT (tenant_id, ml_shipment_id) → actualizar estado_ml si difiere.
            // Se retorna creado_en/actualizado_en para detectar si fue INSERT nuevo:
            // cuando ambos valores son idénticos el trigger los pone al mismo instante.
            const { data: filaPedido, error: errorUpsert } = await supabase
              .schema("operacion")
              .from("pedidos")
              .upsert(
                {
                  tenant_id: tenantId,
                  seller_id: sellerId,
                  // Origen de cuenta ML (estable): el backfill ya opera por conexión,
                  // así que estampamos de qué cuenta proviene el pedido. Guardado no
                  // nulo por el guard de arriba (conexión con ml_user_id).
                  ml_user_id: conexion.ml_user_id!,
                  tipo_pedido: "flex",
                  origen: "backfill",
                  ml_order_id: String(order.id),
                  ml_shipment_id: shipmentId,
                  estado: "pendiente_asignacion",
                  // Estado del ENVÍO (`ready_to_ship`, `shipped`, …), no de la
                  // orden: es lo que dice qué hay listo para retirar. Antes se
                  // guardaba `order.status` (`paid`), que no sirve para operar.
                  estado_ml: datosShipment.estadoMl ?? order.status ?? null,
                  subestado_ml: datosShipment.subestadoMl,
                  ultima_sync_ml_en: new Date().toISOString(),
                  // El destinatario sale del shipment. Antes se guardaba el
                  // título del producto como nombre del destinatario.
                  destinatario_nombre:
                    datosShipment.destinatarioNombre ?? "Destinatario pendiente",
                  destinatario_direccion: direccion,
                  destinatario_comuna: comuna,
                  fecha_compromiso: fechaCompromiso,
                  corte_riesgo: corteRiesgoFlex,
                  // Solo se escriben las columnas geo si ML trajo coordenada. Sin
                  // ella el pedido queda en `pendiente` y lo toma la cola de
                  // geocodificación, igual que siempre.
                  ...(datosShipment.lat != null
                    ? {
                        lat: datosShipment.lat,
                        long: datosShipment.long,
                        geo_estado: "resuelto",
                        // La coordenada viene de la propia plataforma que originó
                        // el pedido, no de un geocodificador que interpreta texto.
                        geo_confianza: 1,
                        geocodificado_en: new Date().toISOString(),
                      }
                    : {}),
                },
                {
                  onConflict: "tenant_id,ml_shipment_id",
                  ignoreDuplicates: false,
                },
              )
              .select("id, creado_en, actualizado_en, destinatario_direccion, destinatario_comuna")
              .maybeSingle();

            // El error del upsert NO se ignora. Antes se desestructuraba solo
            // `data` y `totalProcesados++` corría igual: un fallo de RLS, de
            // columna inexistente o de caché de PostgREST era mudo y el contador
            // mentía «completado, N recuperados» sin haber escrito nada.
            if (errorUpsert) {
              totalErroresUpsert++;
              primerErrorUpsert ??= errorUpsert.message;
              logger.error(
                `Backfill conexión ${conexionId}: falló el upsert del envío ` +
                  `${shipmentId}: ${errorUpsert.message}`,
              );
              continue;
            }

            totalProcesados++;

            // Publicar evento de geocodificación SOLO para pedidos genuinamente nuevos
            // (INSERT, no UPDATE). Se detecta comparando creado_en con actualizado_en:
            // en un INSERT el trigger los pone al mismo instante; en un UPDATE difieren.
            // Es best-effort: un fallo de Inngest no debe romper el backfill — el pedido
            // quedó con geo_estado = 'pendiente' y el job barre por índice.
            if (filaPedido && filaPedido.creado_en === filaPedido.actualizado_en) {
              try {
                await inngest.send({
                  name: 'operacion/pedido.ingestado',
                  id: `pedido-ingestado-${filaPedido.id as string}`,
                  data: {
                    pedidoId: filaPedido.id as string,
                    tenantId,
                    sellerId,
                    direccion: (filaPedido.destinatario_direccion as string | null) ?? 'Dirección pendiente',
                    comuna: (filaPedido.destinatario_comuna as string | null) ?? 'Santiago',
                    tipoPedido: 'flex' as const,
                  },
                });
              } catch {
                // Evento best-effort. El pedido ya está en BD con geo_estado = 'pendiente'.
                // El job de geocoding lo procesará por barrido del índice idx_pedidos_geo_pendiente.
              }
            }
          }

          offset += orders.length;
          hayMas = offset < total;
        }

        if (totalOmitidosNoFlex > 0) {
          logger.info(
            `Backfill conexión ${conexionId}: ${totalOmitidosNoFlex} envíos omitidos ` +
              "por no ser Flex (self_service) — Full/Colecta/Agencia fuera de alcance.",
          );
        }

        if (totalSinEnvio > 0) {
          logger.info(
            `Backfill conexión ${conexionId}: ${totalSinEnvio} órdenes sin envío creado ` +
              "todavía (shipping.id null). Caso esperado — se recogen en la próxima pasada.",
          );
        }

        // Un upsert que falla es un pedido que NO entró. Se propaga para que el
        // intento quede `fallido` con su mensaje en vez de mentir «completado».
        if (totalErroresUpsert > 0) {
          throw new Error(
            `Backfill conexión ${conexionId}: ${totalErroresUpsert} pedidos no se ` +
              `pudieron guardar (${totalProcesados} sí). Primer error: ${primerErrorUpsert}`,
          );
        }

        // El accessToken sale de scope aquí.
        return { totalProcesados, totalOmitidosNoFlex, totalSinEnvio, totalShipmentsIlegibles };
      });

      const totalPedidos = resumen.totalProcesados;

      // Paso 4: marcar el intento como completado.
      await step.run("marcar-completado", async () => {
        const supabase = crearClienteServiceRole();
        await supabase
          .schema("operacion")
          .from("intentos_backfill")
          .update({
            estado: "completado",
            pedidos_recuperados: totalPedidos,
            completado_en: new Date().toISOString(),
          })
          .eq("id", intentoBackfill.intentoId);
      });

      logger.info(
        `Backfill completado para conexión ${conexionId}. ` +
          `Pedidos recuperados: ${totalPedidos}. ` +
          (intentoBackfill.ventanaRecortada ? "Ventana recortada a 7 días." : ""),
      );

      return {
        resultado: "completado",
        intentoId: intentoBackfill.intentoId,
        pedidosRecuperados: totalPedidos,
        omitidosNoFlex: resumen.totalOmitidosNoFlex,
        sinEnvio: resumen.totalSinEnvio,
        shipmentsIlegibles: resumen.totalShipmentsIlegibles,
        ventanaRecortada: intentoBackfill.ventanaRecortada,
      };
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      logger.error(`Backfill conexión ${conexionId} falló: ${mensaje}`);
      await marcarIntentoFallido(intentoBackfill.intentoId, mensaje);
      throw error;
    }
  },
);
