/**
 * Parser de códigos de bulto — normaliza lo que escaneó la cámara a la llave
 * de negocio del bulto, sin tocar Supabase ni el resto del sistema.
 *
 * Espejo TypeScript de `operacion.formato_codigo_bulto`
 * (migración 20260813000004 §1). Hoy dos fuentes reales, más `desconocido`
 * como red de seguridad:
 *
 *   - `flex_qr`       — el JSON de la etiqueta de Mercado Envíos:
 *                        `{"id":"<shipment_id>","sender_id":<ml_user_id>,
 *                          "hash_code":"<32B base64>","security_digit":"0"}`.
 *   - `rutax_interno` — el `codigo_interno` que Rutax ya genera para same-day
 *                        (`RX-XXXX-XXXX`, Base32 Crockford — ver `../codigo-interno`).
 *   - `desconocido`   — cualquier otra cosa. NO es un error: alcance §1.5/§8
 *                        exige que el escaneo se guarde igual (perder un
 *                        escaneo es el único fallo irreversible del retiro —
 *                        el QR de Flex no se puede reimprimir una vez
 *                        retirado el bulto).
 *
 * PREPARADO PARA MÁS FUENTES SIN REFACTOR: agregar un formato nuevo es sumar
 * una función a `DETECTORES` (ver abajo) — el resto del flujo (escritor de
 * lotes, DTO, credencial) no conoce los detalles de cada formato, solo el
 * contrato `CodigoBultoParseado`.
 *
 * SEGURIDAD: este módulo nunca guarda el `codigoCrudo` completo en ningún
 * campo que pueda llegar a un log o a una respuesta HTTP más allá de
 * `muestraCodigo` (≤24 caracteres, y SOLO para `desconocido` — ver el CHECK
 * `bultos_retiro_muestra_solo_desconocido`). El crudo íntegro solo vive,
 * cifrado, en `operacion.bultos_retiro_qr` (ver `qr-credencial.ts`).
 */

import { createHash } from "node:crypto";
import { esCodigoInternoValido } from "../codigo-interno";

/**
 * Espejo de `operacion.formato_codigo_bulto` (migración 20260813000004 §1, más
 * `flex_manual` en 20260815000001).
 *
 * ⚠️ Lista COMPLETA, siempre. Si agregas un valor en SQL, agrégalo aquí en el
 * mismo cambio y repón la lista entera en el `results_eq` de
 * `rls_aislamiento_retiro.test.sql` — copiándola de la base, nunca de una
 * versión vieja de otra migración. Es la disciplina que CLAUDE.md exige para
 * toda lista espejada, y la que faltó en el incidente del CHECK de
 * `tipo_diferencia`: 16 valores antes y 16 después, distinta lista, y el fallo
 * apareció en ejecución dentro de un `step.run`.
 */
export const FORMATOS_CODIGO_BULTO = [
  "flex_qr",
  "flex_manual",
  "rutax_interno",
  "desconocido",
] as const;
export type FormatoCodigoBulto = (typeof FORMATOS_CODIGO_BULTO)[number];

/** Espejo del CHECK `bultos_retiro_codigo_normalizado_largo` (1..128). */
export const LARGO_MAX_CODIGO_NORMALIZADO = 128;

/** Espejo del CHECK `bultos_retiro_muestra_solo_desconocido` (<=24). */
export const LARGO_MUESTRA_DESCONOCIDO = 24;

/**
 * Un `id` de shipment de ML más largo que esto ya no "parece" un shipment id
 * real (los reales son numéricos, de pocos dígitos — el ejemplo verificado en
 * el alcance es "44760788897", 11 dígitos). Es una válvula de seguridad para
 * nunca acercarse al CHECK de 128: ante algo así, el código se trata como
 * `desconocido` en vez de truncarlo — truncar podría hacer que dos ids
 * distintos colisionen en el mismo `codigo_normalizado`.
 */
const LARGO_MAX_SHIPMENT_ID_PLAUSIBLE = 64;

/** Lo que hay que cifrar y guardar en `bultos_retiro_qr` — ver `qr-credencial.ts`. */
export type CredencialQr =
  | { tipoPayload: "flex_hash"; hashCode: string; securityDigit: string }
  | { tipoPayload: "codigo_crudo"; valor: string };

export interface CodigoBultoParseado {
  formato: FormatoCodigoBulto;
  /** Llave de negocio normalizada — igual para todas las lecturas del mismo bulto físico. */
  codigoNormalizado: string;
  /** Primeros `LARGO_MUESTRA_DESCONOCIDO` caracteres del crudo. Solo para `desconocido`. */
  muestraCodigo: string | null;
  /** Solo para `flex_qr`. */
  mlShipmentId: string | null;
  /** Solo para `flex_qr`, y solo si el payload lo trajo. */
  mlUserId: string | null;
  /**
   * Qué cifrar y guardar en `bultos_retiro_qr`, o `null` si este formato no lo
   * necesita — hoy `rutax_interno`: la etiqueta la emite Rutax y siempre puede
   * regenerarla (alcance §3), así que no hay nada irrecuperable que preservar.
   */
  credencial: CredencialQr | null;
}

// =============================================================================
// flex_qr — el JSON de la etiqueta de Mercado Envíos
// =============================================================================

function comoStringNoVacio(valor: unknown): string | null {
  if (typeof valor === "string") {
    const recortado = valor.trim();
    return recortado.length > 0 ? recortado : null;
  }
  if (typeof valor === "number" && Number.isFinite(valor)) {
    return String(valor);
  }
  return null;
}

function intentarFlexQr(crudo: string): CodigoBultoParseado | null {
  let json: unknown;
  try {
    json = JSON.parse(crudo);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;

  const obj = json as Record<string, unknown>;
  const shipmentId = comoStringNoVacio(obj.id);
  if (!shipmentId || shipmentId.length > LARGO_MAX_SHIPMENT_ID_PLAUSIBLE) return null;

  const mlUserId = comoStringNoVacio(obj.sender_id);
  const hashCode = typeof obj.hash_code === "string" ? obj.hash_code : "";
  const securityDigit = comoStringNoVacio(obj.security_digit) ?? "";

  return {
    formato: "flex_qr",
    codigoNormalizado: shipmentId,
    muestraCodigo: null,
    mlShipmentId: shipmentId,
    mlUserId,
    // Sin hash_code no hay nada irrecuperable que cifrar (un flex_qr "vacío"
    // no debería ocurrir en la práctica, pero si ocurre no se inventa una
    // credencial con un hash_code en blanco).
    credencial: hashCode ? { tipoPayload: "flex_hash", hashCode, securityDigit } : null,
  };
}

// =============================================================================
// flex_manual — el MISMO número de envío, pero tecleado por el conductor
// =============================================================================

/**
 * Mínimo de dígitos para considerar que alguien tecleó un shipment id y no se le
 * escapó un número suelto. El ejemplo verificado del alcance §3 tiene 11
 * dígitos (`44760788897`); ML no publica un largo garantizado, así que el piso
 * se pone bajo pero no en 1: un "5" tecleado por accidente no puede convertirse
 * en una búsqueda contra `pedidos.ml_shipment_id`.
 */
const LARGO_MIN_SHIPMENT_ID_TECLEADO = 6;

/**
 * Número de envío de Flex TECLEADO a mano — la vía de excepción cuando la
 * etiqueta no se puede escanear (rota, borrosa, ausente).
 *
 * ## Qué acepta, y por qué tan poco
 *
 * SOLO dígitos, tras quitar espacios, guiones y puntos: un conductor mirando una
 * etiqueta arrugada teclea `4476 0788 897` o `44760788897` con la misma
 * intención, y rechazarle el primero sería obligarlo a pelear con el separador
 * en vez de con el paquete. Nada más se limpia — una letra suelta significa que
 * está leyendo otra cosa, y eso debe caer a `desconocido`, que SE GUARDA IGUAL.
 *
 * ## Por qué comparte `codigoNormalizado` con `flex_qr`
 *
 * Es el shipment id pelado, exactamente el mismo valor que produce
 * `intentarFlexQr` desde el campo `id` del JSON. Así el MISMO bulto tecleado y
 * escaneado se fusiona por la unique `(sesion_retiro_id, codigo_normalizado)` —
 * que es lo correcto: es un bulto, no dos. Y `dto-pedido.ts` lo busca contra la
 * misma columna, así que encuentra su pedido igual que un escaneo.
 *
 * ## Por qué `credencial: null` y no es un olvido
 *
 * Tecleando no hay `hash_code`: es una firma de ML que no se puede calcular ni
 * pedir después (ML no reimprime la etiqueta de un envío ya retirado). No hay
 * nada que preservar, y **eso es justamente lo que el formato propio deja
 * dicho**: este bulto nunca tuvo QR capturado, a diferencia de uno `flex_qr`.
 *
 * ## Orden dentro de `DETECTORES`
 *
 * Va DESPUÉS de `intentarRutaxInterno`. Hoy no compiten —un `RX-XXXX-XXXX`
 * nunca queda en solo dígitos tras limpiar separadores, porque conserva letras—
 * pero el orden se fija a propósito: si algún día un formato interno fuera
 * numérico, el específico tiene que ganarle al genérico.
 */
function intentarFlexManual(crudo: string): CodigoBultoParseado | null {
  // Solo separadores que un humano usa al agrupar dígitos de una etiqueta.
  const limpio = crudo.trim().replace(/[\s.-]/g, "");
  if (!/^\d+$/.test(limpio)) return null;
  if (limpio.length < LARGO_MIN_SHIPMENT_ID_TECLEADO) return null;
  if (limpio.length > LARGO_MAX_SHIPMENT_ID_PLAUSIBLE) return null;

  return {
    formato: "flex_manual",
    codigoNormalizado: limpio,
    muestraCodigo: null,
    mlShipmentId: limpio,
    // Tecleado: no se conoce la cuenta de ML de origen. Se deja null en vez de
    // adivinarla — el pedido ya la trae, y una atribución inventada es peor que
    // ninguna cuando el seller tiene varias cuentas conectadas.
    mlUserId: null,
    credencial: null,
  };
}

// =============================================================================
// rutax_interno — el codigo_interno que Rutax ya genera para same-day
// =============================================================================

function intentarRutaxInterno(crudo: string): CodigoBultoParseado | null {
  const normalizado = crudo.trim().toUpperCase().replace(/\s+/g, "");
  if (!esCodigoInternoValido(normalizado)) return null;

  return {
    formato: "rutax_interno",
    codigoNormalizado: normalizado,
    muestraCodigo: null,
    mlShipmentId: null,
    mlUserId: null,
    // Rutax emitió esta etiqueta: siempre puede regenerarla. Nada que preservar.
    credencial: null,
  };
}

// =============================================================================
// desconocido — la red de seguridad. NUNCA se pierde un escaneo.
// =============================================================================

function comoDesconocido(crudo: string): CodigoBultoParseado {
  // sha256 acota el largo a un valor fijo (71 caracteres con el prefijo, muy
  // por debajo del CHECK de 128) y DEDUPLICA igual: el mismo string ilegible
  // escaneado dos veces produce el mismo codigo_normalizado, así que la unique
  // (sesion_retiro_id, codigo_normalizado) sigue fusionando el doble escaneo
  // físico también para códigos que Rutax no entiende.
  const hash = createHash("sha256").update(crudo, "utf8").digest("hex");

  return {
    formato: "desconocido",
    codigoNormalizado: `sha256:${hash}`,
    // Los primeros 24 caracteres DEL CRUDO (no del hash): es lo que le permite
    // a un humano reconocer el código en la bandeja de excepciones. El CHECK
    // `bultos_retiro_muestra_solo_desconocido` exige <=24 y solo para este formato.
    muestraCodigo: crudo.slice(0, LARGO_MUESTRA_DESCONOCIDO),
    mlShipmentId: null,
    mlUserId: null,
    // De un código que Rutax no entiende no se puede afirmar de qué sistema
    // es: se preserva el crudo completo (cifrado) por si hace falta
    // reconciliarlo a mano más tarde — es la única fuente que queda de él.
    credencial: { tipoPayload: "codigo_crudo", valor: crudo },
  };
}

// =============================================================================
// El registro de detectores, en orden — agregar una fuente nueva es agregar
// una entrada aquí. El resto del flujo (escritor de lotes, DTO, credencial)
// no cambia.
// =============================================================================

const DETECTORES: readonly ((crudo: string) => CodigoBultoParseado | null)[] = [
  intentarFlexQr,
  intentarRutaxInterno,
  // El último de los que reconocen algo: es el más permisivo (cualquier ristra
  // de dígitos plausible) y por eso no puede adelantarse a los específicos.
  intentarFlexManual,
];

/**
 * Clasifica y normaliza un código escaneado. NUNCA lanza y NUNCA devuelve
 * "no reconocido" sin valor: cualquier string, por raro que sea, resuelve a
 * `desconocido` con su credencial preservada. Perder un escaneo por no
 * reconocer el formato es exactamente el fallo que este parser existe para
 * evitar (alcance §3/§8).
 */
export function parsearCodigoBulto(codigoCrudo: string): CodigoBultoParseado {
  for (const detectar of DETECTORES) {
    const resultado = detectar(codigoCrudo);
    if (resultado) return resultado;
  }
  return comoDesconocido(codigoCrudo);
}

/**
 * Código legible para mostrar a un humano, derivado ÚNICAMENTE de lo que ya
 * vive en una fila de `bultos_retiro` (nunca requiere leer `pedidos`).
 * Misma regla que la Torre de control (`ml_shipment_id ?? codigo_interno`,
 * ver `contexto/composer/index.ts:221`): shipment id en Flex, y para
 * `rutax_interno` el propio `codigoNormalizado` YA ES el `codigo_interno`.
 * Para `desconocido` cae a `muestraCodigo` — el `codigoNormalizado` de ese
 * formato es un hash, ilegible para una persona.
 */
export function codigoVisibleDeBulto(params: {
  mlShipmentId: string | null;
  muestraCodigo: string | null;
  codigoNormalizado: string;
}): string {
  return params.mlShipmentId ?? params.muestraCodigo ?? params.codigoNormalizado;
}

/** Espejo de `operacion.formato_codigo_bulto` — qué pasó con el bulto, en el vocabulario del frontend. */
export const RESOLUCIONES_ESCANEO = ["resuelto", "no_procesado", "ilegible"] as const;
export type ResolucionEscaneo = (typeof RESOLUCIONES_ESCANEO)[number];

/**
 * La "resolución" NO es una columna en `bultos_retiro` (migración
 * 20260813000004, cabecera §"LO QUE ESTA MIGRACIÓN SE NIEGA A HACER"): es
 * 100% derivable, y una columna redundante que hay que mantener sincronizada
 * es la misma familia de bug que el incidente del CHECK de `tipo_diferencia`
 * (CLAUDE.md §Invariantes). Esta es la ÚNICA función que la deriva — tanto el
 * escritor de lotes como el detalle de una visita la importan de aquí, para
 * que la regla nunca se desfase entre los dos lugares que la necesitan.
 */
export function derivarResolucionBulto(
  formato: FormatoCodigoBulto,
  pedidoId: string | null,
): ResolucionEscaneo {
  if (formato === "desconocido") return "ilegible";
  return pedidoId ? "resuelto" : "no_procesado";
}
