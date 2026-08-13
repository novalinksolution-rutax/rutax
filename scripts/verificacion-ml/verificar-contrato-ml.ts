/**
 * Verificación EN VIVO del contrato con la API de Mercado Libre — SOLO LECTURA.
 * =============================================================================
 * Etapa 1 del plan de retiro y ruteo (`docs/arquitectura/retiro-y-ruteo-plan.md`):
 * «verificación en vivo contra una cuenta ML real, antes de escribir la ingesta».
 * Responde cuatro preguntas contra datos de producción y emite un veredicto por
 * cada una:
 *
 *   1. ¿El id del envío en la orden es `shipping.id` o `shipping.shipment_id`?
 *      ¿Con qué frecuencia viene nulo?
 *   2. ¿Existe `GET /shipments?ids=…`? Si responde, ¿en qué forma — arreglo de
 *      envíos o el formato «verb» (`[{code, body}]`) que ML documenta para
 *      `/items`? ¿Trae lo mismo que `GET /shipments/{id}`?
 *   3. ¿El filtro incremental FILTRA de verdad? ML **ignora en silencio los
 *      parámetros que no reconoce**, así que la única prueba válida es comparar
 *      `paging.total` con y sin filtro sobre la misma cuenta.
 *   4. ¿Qué cambia en el JSON del envío al mandar `x-format-new: true`, y dónde
 *      queda el bloque de dirección y sus coordenadas (el geocoding gratis)?
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTE SCRIPT NO REIMPLEMENTA NADA
 * ---------------------------------------------------------------------------
 * Importa y ejerce EL MISMO código que corre en producción:
 *   · `peticionMl` (`ml/cliente-http.ts`)      → backoff, `Retry-After`, 429/5xx.
 *   · `descifrarSecreto` (`integraciones/secretos`) → AES-256-GCM del proyecto.
 *   · `extraerShipmentId` / `interpretarShipment` (`ml/ingesta-pedidos.ts`)
 *     → los parsers reales de la ingesta.
 * Un script con su propio `fetch` y su propia copia del parser validaría el
 * supuesto contra sí mismo, que es exactamente el error que dejó a producción
 * con 0 pedidos Flex durante meses.
 *
 * ---------------------------------------------------------------------------
 * REGLAS QUE ESTE SCRIPT NO ROMPE (verificables leyendo el código)
 * ---------------------------------------------------------------------------
 * · SOLO LECTURA. `getMl()` es la única puerta a la API y fija `metodo: "GET"`.
 *   Contra Supabase solo hay `.select()`. NO refresca tokens (eso sería un POST
 *   a /oauth/token y además rota el refresh_token): si el access token está
 *   vencido, el script se detiene y lo dice.
 * · EL TOKEN NUNCA SE IMPRIME — ni entero, ni parcial, ni en errores. Vive en
 *   una constante local que se pasa a `peticionMl` y muere con la función.
 * · NINGÚN DATO PERSONAL EN LA SALIDA. El envío trae nombre, dirección y
 *   coordenadas del destinatario: de todo eso se imprime la FORMA (nombres de
 *   campo, presente/ausente, conteos), jamás el contenido. Los únicos valores
 *   que salen son no personales: identificadores, estados, `logistic_type`,
 *   totales de paginación y códigos HTTP.
 * · ACOTADO. ~30 llamadas en total, secuenciales y con pausa entre ellas.
 *
 * ---------------------------------------------------------------------------
 * CÓMO SE CORRE  (ver también el encabezado de `ejecutar.mjs`)
 * ---------------------------------------------------------------------------
 *   node scripts/verificacion-ml/ejecutar.mjs [opciones]
 *
 * Opciones:
 *   --listar            lista las conexiones sanas y termina (no llama a ML).
 *   --conexion <uuid>   usa esa conexión en vez de elegir automáticamente.
 *   --dias <n>          ventana «reciente» de la pregunta 3 (default 7).
 *   --ordenes <n>       órdenes de la muestra de la pregunta 1 (default 50, tope 50).
 *   --envios <n>        envíos a inspeccionar en las preguntas 2 y 4 (default 3, tope 10).
 *
 * Variables de entorno requeridas (las mismas de producción, sin nada fijo en
 * el código): NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY ·
 * SECRETOS_CLAVE_CIFRADO_B64 (y SECRETOS_CIFRADO_KID si se rotó la clave).
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { ahoraEnSantiago } from "@/lib/fecha-santiago";
import { descifrarSecreto } from "@/modules/integraciones/secretos";
import { ErrorHttpMl, peticionMl } from "@/modules/integraciones/ml/cliente-http";
import {
  ENCABEZADO_FORMATO_NUEVO_ML,
  LOGISTIC_TYPE_FLEX,
  extraerShipmentId,
  interpretarShipment,
  type OrderMl,
  type ShipmentMl,
} from "@/modules/integraciones/ml/ingesta-pedidos";

// =============================================================================
// Constantes de la verificación
// =============================================================================

/** Pausa entre llamadas. No es un límite de tasa: es cortesía + margen. */
const RESPIRO_MS = 200;

/** Reintentos por llamada. Menos que en producción: aquí un 5xx se reporta. */
const MAX_INTENTOS_PROBE = 3;

/**
 * Ventana que NO puede contener órdenes. Es la prueba decisiva de la pregunta 3:
 * si un filtro de fechas está vivo, `paging.total` sobre 2015 tiene que ser 0.
 * Si devuelve el total completo de la cuenta, ML lo ignoró en silencio.
 * (La doc de ML dice que las órdenes se consultan hasta 12 meses hacia atrás,
 * así que 2015 está fuera de todo alcance posible.)
 */
const IMPOSIBLE_DESDE = new Date("2015-01-01T00:00:00.000Z");
const IMPOSIBLE_HASTA = new Date("2015-01-02T00:00:00.000Z");

/**
 * Segunda ventana vacía, esta vez DENTRO del alcance de 12 meses.
 *
 * Existe porque la de 2015 tiene un punto ciego: si ML **acota** la consulta a
 * los últimos 12 meses en vez de honrar la fecha pedida, o si la **rechaza** con
 * 400 por estar fuera de rango, el filtro estaría vivo y la medición diría lo
 * contrario. Las dos lecturas erróneas terminan en «no filtra», que es
 * justamente la conclusión que haría rediseñar la ingesta sin motivo.
 *
 * Una ventana de un segundo, a 90 días hacia atrás, no puede caer fuera de
 * rango y la probabilidad de que contenga una orden es despreciable. Si el
 * filtro está vivo, su total es 0; si ML lo ignora, devuelve el total completo.
 */
const VACIA_DIAS_ATRAS = 90;
const VACIA_ANCHO_MS = 1_000;

const TOPE_ORDENES = 50;
const TOPE_ENVIOS = 10;

// =============================================================================
// Salida legible
// =============================================================================

const REGLA = "=".repeat(78);
const SUBREGLA = "-".repeat(78);

function decir(texto = ""): void {
  console.log(texto);
}

function titulo(texto: string): void {
  decir();
  decir(REGLA);
  decir(` ${texto}`);
  decir(REGLA);
}

function seccion(texto: string): void {
  decir();
  decir(SUBREGLA);
  decir(texto);
  decir(SUBREGLA);
}

interface Veredicto {
  pregunta: string;
  estado: "CONFIRMADO" | "DESMENTIDO" | "SIN DATOS" | "ATENCION";
  resumen: string;
}

const veredictos: Veredicto[] = [];

function anotar(pregunta: string, estado: Veredicto["estado"], resumen: string): void {
  veredictos.push({ pregunta, estado, resumen });
  decir();
  decir(`VEREDICTO [${estado}] ${resumen}`);
}

/** Fallo duro: mensaje claro, sin trazas crípticas. */
class ErrorDeUso extends Error {}

// =============================================================================
// Utilidades
// =============================================================================

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function clavesDe(valor: unknown): string[] {
  return esObjeto(valor) ? Object.keys(valor).sort() : [];
}

function porcentaje(parte: number, total: number): string {
  if (total === 0) return "n/d";
  return `${Math.round((parte / total) * 100)}%`;
}

/** Offset de America/Santiago en minutos para un instante dado. */
function offsetSantiagoMinutos(instante: Date): number {
  const enSantiago = new Date(instante.toLocaleString("en-US", { timeZone: "America/Santiago" }));
  const enUtc = new Date(instante.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((enSantiago.getTime() - enUtc.getTime()) / 60_000);
}

/** `2026-08-13T09:00:00.000Z` — el formato que manda hoy la ingesta. */
function isoZulu(instante: Date): string {
  return instante.toISOString();
}

/** `2026-08-13T05:00:00.000-04:00` — el formato con TZD de los ejemplos de ML. */
function isoConOffsetSantiago(instante: Date): string {
  const minutos = offsetSantiagoMinutos(instante);
  const signo = minutos < 0 ? "-" : "+";
  const abs = Math.abs(minutos);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  const local = new Date(instante.getTime() + minutos * 60_000).toISOString().slice(0, 23);
  return `${local}${signo}${hh}:${mm}`;
}

// =============================================================================
// Puerta ÚNICA a la API de ML — solo GET, sin excepciones
// =============================================================================

type Resultado<T> =
  | { ok: true; valor: T }
  | { ok: false; status: number | null; resumen: string };

/**
 * Resume el cuerpo de un error de ML sin volcarlo entero: solo los campos que
 * la API usa para describirse a sí misma (`error`, `status`, `message`), y
 * truncados. Nunca hay token ahí (viaja en la cabecera, jamás en la URL).
 */
function resumirCuerpoError(cuerpo: unknown): string {
  if (typeof cuerpo === "string") return cuerpo.slice(0, 160);
  if (esObjeto(cuerpo)) {
    const partes: string[] = [];
    for (const clave of ["error", "status", "message"]) {
      const valor = cuerpo[clave];
      if (valor === undefined || valor === null) continue;
      partes.push(`${clave}=${String(valor).slice(0, 160)}`);
    }
    if (partes.length > 0) return partes.join(" · ");
    return `claves=[${clavesDe(cuerpo).join(",")}]`;
  }
  return "sin cuerpo legible";
}

let llamadasHechas = 0;

/**
 * ÚNICA función que habla con ML. `metodo` está fijo en GET a propósito: hace
 * imposible que este script escriba, aunque alguien lo extienda distraído.
 */
async function getMl<T>(
  ruta: string,
  accessToken: string,
  encabezadosExtra?: Record<string, string>,
): Promise<Resultado<T>> {
  if (llamadasHechas > 0) await dormir(RESPIRO_MS);
  llamadasHechas += 1;
  try {
    const valor = await peticionMl<T>({
      metodo: "GET",
      ruta,
      accessToken,
      ...(encabezadosExtra ? { encabezadosExtra } : {}),
      opcionesReintento: { maxIntentos: MAX_INTENTOS_PROBE },
    });
    return { ok: true, valor };
  } catch (error) {
    if (error instanceof ErrorHttpMl) {
      return { ok: false, status: error.status, resumen: resumirCuerpoError(error.cuerpo) };
    }
    return {
      ok: false,
      status: null,
      resumen: error instanceof Error ? error.message : "error desconocido",
    };
  }
}

// =============================================================================
// Elección de la conexión
// =============================================================================

interface FilaConexion {
  id: string;
  tenant_id: string;
  seller_id: string;
  ml_user_id: string | null;
  access_token_ref: string | null;
  estado_salud: string;
  token_expira_en: string | null;
  ultima_sync_exitosa_en: string | null;
  alias: string | null;
  sellers: { razon_social: string } | null;
}

interface ConexionElegida {
  id: string;
  mlUserId: string;
  accessTokenRef: string;
  estadoSalud: string;
  tokenExpiraEn: string | null;
  etiqueta: string;
}

function exigirEntorno(): void {
  const faltantes = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SECRETOS_CLAVE_CIFRADO_B64",
  ].filter((nombre) => !process.env[nombre]);

  if (faltantes.length > 0) {
    throw new ErrorDeUso(
      `Faltan variables de entorno: ${faltantes.join(", ")}.\n` +
        "  Este script lee la conexión desde Supabase y descifra el token con la clave\n" +
        "  del proyecto, así que las tres son obligatorias. Apúntalas al entorno que\n" +
        "  quieras verificar (producción trae la conexión viva con ventas Flex).\n" +
        "  Nunca se imprime el valor de ninguna de ellas.",
    );
  }
}

async function leerConexionesSanas(): Promise<FilaConexion[]> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema("identidad")
    .from("conexiones_seller_ml")
    .select(
      "id, tenant_id, seller_id, ml_user_id, access_token_ref, estado_salud, " +
        "token_expira_en, ultima_sync_exitosa_en, alias, sellers:seller_id(razon_social)",
    )
    .neq("estado_salud", "desvinculada")
    .not("ml_user_id", "is", null)
    .not("access_token_ref", "is", null)
    .order("ultima_sync_exitosa_en", { ascending: false, nullsFirst: false });

  if (error) {
    throw new ErrorDeUso(
      `No se pudieron leer las conexiones ML desde Supabase: ${error.message}\n` +
        "  Revisa NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (¿apuntan al\n" +
        "  proyecto correcto? ¿la clave es la de service_role y no la anónima?).",
    );
  }

  return (data ?? []) as unknown as FilaConexion[];
}

function etiquetarConexion(fila: FilaConexion): string {
  const seller = fila.sellers?.razon_social ?? "seller sin razón social";
  const alias = fila.alias ? ` · alias «${fila.alias}»` : "";
  return `seller «${seller}»${alias} · cuenta ML ${fila.ml_user_id} · conexión ${fila.id}`;
}

function elegirConexion(filas: FilaConexion[], pedida: string | null): ConexionElegida {
  if (filas.length === 0) {
    throw new ErrorDeUso(
      "No hay ninguna conexión ML utilizable en esta base de datos.\n" +
        "  Se buscan conexiones con estado_salud distinto de 'desvinculada' y con\n" +
        "  ml_user_id + access_token_ref presentes. Si esperabas ver alguna, revisa\n" +
        "  que las variables de Supabase apunten al entorno correcto.",
    );
  }

  const elegida = pedida ? filas.find((fila) => fila.id === pedida) : filas[0];

  if (!elegida) {
    const disponibles = filas.map((fila) => `    · ${fila.id} — ${etiquetarConexion(fila)}`);
    throw new ErrorDeUso(
      `No existe una conexión utilizable con id ${pedida}.\n  Disponibles:\n${disponibles.join("\n")}`,
    );
  }

  return {
    id: elegida.id,
    mlUserId: elegida.ml_user_id as string,
    accessTokenRef: elegida.access_token_ref as string,
    estadoSalud: elegida.estado_salud,
    tokenExpiraEn: elegida.token_expira_en,
    etiqueta: etiquetarConexion(elegida),
  };
}

/**
 * Descifra el access token con la primitiva del proyecto. El valor devuelto se
 * usa solo para construir la cabecera `Authorization` dentro de `peticionMl`.
 */
async function obtenerAccessToken(conexion: ConexionElegida): Promise<string> {
  let descifrado;
  try {
    descifrado = await descifrarSecreto(conexion.accessTokenRef);
  } catch (error) {
    throw new ErrorDeUso(
      `No se pudo descifrar el access token de la conexión ${conexion.id}: ` +
        `${error instanceof Error ? error.message : "error desconocido"}\n` +
        "  Causa típica: SECRETOS_CLAVE_CIFRADO_B64 no es la clave con la que se cifró\n" +
        "  ese token (p. ej. la clave local apuntando a la base de producción).",
    );
  }

  if (typeof descifrado.valor !== "string") {
    throw new ErrorDeUso("El access token descifrado no es texto. Conexión inconsistente.");
  }
  return descifrado.valor;
}

/**
 * Sondeo previo con `GET /users/me` — el mismo que usa el job de salud. Sirve
 * para dar un mensaje claro cuando el token está vencido en vez de que fallen
 * las 25 llamadas siguientes. La respuesta trae datos personales del titular:
 * de ella solo se lee `id` (identificador de cuenta) y jamás se imprime otra cosa.
 */
async function comprobarToken(conexion: ConexionElegida, accessToken: string): Promise<void> {
  const respuesta = await getMl<{ id?: number | string }>("/users/me", accessToken);

  if (respuesta.ok) {
    const idDevuelto = respuesta.valor?.id === undefined ? null : String(respuesta.valor.id);
    const coincide = idDevuelto === conexion.mlUserId;
    decir(`  · GET /users/me → 200. Token vigente.`);
    decir(
      `  · La cuenta que responde ${coincide ? "COINCIDE" : "NO COINCIDE"} con el ml_user_id ` +
        `registrado (${conexion.mlUserId}${coincide ? "" : ` vs ${idDevuelto ?? "sin id"}`}).`,
    );
    if (!coincide) {
      decir("    ATENCION: el token pertenece a otra cuenta ML que la registrada en la fila.");
    }
    return;
  }

  if (respuesta.status === 401 || respuesta.status === 403) {
    throw new ErrorDeUso(
      `El access token de esta conexión no sirve (ML respondió ${respuesta.status}: ${respuesta.resumen}).\n` +
        "  Este script es de SOLO LECTURA y no refresca tokens a propósito: refrescar es\n" +
        "  un POST que además rota el refresh_token.\n" +
        "  Qué hacer: deja que corra el job `ml/refrescarTokens` (o pulsa «Sincronizar\n" +
        "  ahora» en el panel), y vuelve a ejecutar. O prueba con otra conexión:\n" +
        "  `node scripts/verificacion-ml/ejecutar.mjs --listar`.",
    );
  }

  throw new ErrorDeUso(
    `No se pudo contactar a Mercado Libre (status ${respuesta.status ?? "sin status"}: ${respuesta.resumen}).`,
  );
}

// =============================================================================
// PREGUNTA 1 · El campo del envío en la orden
// =============================================================================

interface BusquedaOrdenes {
  results?: OrderMl[];
  paging?: { total?: number; offset?: number; limit?: number };
}

interface MuestraOrdenes {
  ordenes: OrderMl[];
  totalPaging: number;
  shipmentIds: string[];
}

async function pregunta1(
  conexion: ConexionElegida,
  accessToken: string,
  cantidadOrdenes: number,
): Promise<MuestraOrdenes | null> {
  seccion("PREGUNTA 1 · ¿El id del envío en la orden es `shipping.id`?");

  const consultaBase = { seller: conexion.mlUserId, limit: String(cantidadOrdenes), offset: "0" };

  decir("Qué se probó:");
  decir(`  GET /orders/search?seller=…&sort=date_desc&limit=${cantidadOrdenes}&offset=0`);
  decir("  (sin filtro de fechas y SIN `x-format-new`, igual que la ingesta de hoy)");

  let respuesta = await getMl<BusquedaOrdenes>(
    `/orders/search?${new URLSearchParams({ ...consultaBase, sort: "date_desc" }).toString()}`,
    accessToken,
  );

  // Si `sort` molestara, se reintenta sin él: perder la muestra entera por un
  // parámetro accesorio dejaría también sin datos a las preguntas 2 y 4.
  if (!respuesta.ok) {
    decir();
    decir(
      `  (con sort=date_desc ML respondió ${respuesta.status ?? "sin status"}; se reintenta sin ese parámetro)`,
    );
    respuesta = await getMl<BusquedaOrdenes>(
      `/orders/search?${new URLSearchParams(consultaBase).toString()}`,
      accessToken,
    );
  }

  if (!respuesta.ok) {
    decir();
    decir(`Qué respondió ML: HTTP ${respuesta.status ?? "sin status"} — ${respuesta.resumen}`);
    anotar(
      "1 · campo del envío en la orden",
      "SIN DATOS",
      "la búsqueda de órdenes falló; no hubo muestra que analizar.",
    );
    return null;
  }

  const ordenes = respuesta.valor.results ?? [];
  const totalPaging = respuesta.valor.paging?.total ?? 0;

  const clavesOrden = new Set<string>();
  const clavesShipping = new Set<string>();
  const porEstado = new Map<string, number>();
  let conNodoShipping = 0;
  let conShippingIdUsable = 0;
  let conShippingIdNulo = 0;
  let conCampoInexistente = 0;
  const shipmentIds: string[] = [];

  for (const orden of ordenes) {
    for (const clave of clavesDe(orden)) clavesOrden.add(clave);

    const estado = typeof orden.status === "string" ? orden.status : "(sin status)";
    porEstado.set(estado, (porEstado.get(estado) ?? 0) + 1);

    const shipping: unknown = orden.shipping;
    if (esObjeto(shipping)) {
      conNodoShipping += 1;
      for (const clave of clavesDe(shipping)) clavesShipping.add(clave);
      if (shipping.shipment_id !== undefined) conCampoInexistente += 1;
      if (shipping.id === null || shipping.id === undefined) conShippingIdNulo += 1;
    }

    // El parser REAL de la ingesta, no una copia.
    const id = extraerShipmentId(orden);
    if (id) {
      conShippingIdUsable += 1;
      if (shipmentIds.length < TOPE_ENVIOS) shipmentIds.push(id);
    }
  }

  decir();
  decir("Qué respondió ML:");
  decir(`  · Órdenes en la muestra: ${ordenes.length} (paging.total de la cuenta: ${totalPaging})`);
  decir(`  · Claves de la orden observadas: [${[...clavesOrden].join(", ")}]`);
  decir(`  · Órdenes con nodo \`shipping\`: ${conNodoShipping}/${ordenes.length}`);
  decir(`  · Claves de \`order.shipping\` observadas: [${[...clavesShipping].join(", ")}]`);
  decir(
    `  · \`shipping.id\` presente y no nulo: ${conShippingIdUsable}/${ordenes.length} ` +
      `(${porcentaje(conShippingIdUsable, ordenes.length)}) — vía extraerShipmentId(), el parser real`,
  );
  decir(
    `  · \`shipping.id\` nulo o ausente: ${conShippingIdNulo}/${ordenes.length} ` +
      `(${porcentaje(conShippingIdNulo, ordenes.length)}) — caso ESPERADO: ML aún no creó el envío`,
  );
  decir(`  · \`shipping.shipment_id\` (el campo viejo del bug): ${conCampoInexistente}/${ordenes.length}`);
  decir(
    `  · Estados de orden en la muestra: ${[...porEstado]
      .map(([estado, veces]) => `${estado}=${veces}`)
      .join(", ")}`,
  );

  // Comprobación secundaria: ¿cambia algo si SÍ se manda `x-format-new` a órdenes?
  const conHeader = await getMl<BusquedaOrdenes>(
    `/orders/search?${new URLSearchParams({
      seller: conexion.mlUserId,
      sort: "date_desc",
      limit: "1",
      offset: "0",
    }).toString()}`,
    accessToken,
    { ...ENCABEZADO_FORMATO_NUEVO_ML },
  );

  decir();
  decir("Comprobación secundaria — la misma búsqueda CON `x-format-new: true`:");
  if (!conHeader.ok) {
    decir(`  · HTTP ${conHeader.status ?? "sin status"} — ${conHeader.resumen}`);
  } else {
    const primera = conHeader.valor.results?.[0];
    const shippingConHeader: unknown = primera?.shipping;
    decir(`  · HTTP 200. Claves de la orden: [${clavesDe(primera).join(", ")}]`);
    decir(
      `  · \`shipping\` presente: ${esObjeto(shippingConHeader) ? "sí" : "no"}` +
        (esObjeto(shippingConHeader)
          ? ` · claves: [${clavesDe(shippingConHeader).join(", ")}]` +
            ` · \`shipping.id\` utilizable: ${primera && extraerShipmentId(primera) ? "sí" : "no"}`
          : ""),
    );
  }

  if (ordenes.length === 0) {
    anotar(
      "1 · campo del envío en la orden",
      "SIN DATOS",
      "la cuenta no devolvió ninguna orden; elige otra conexión con --conexion.",
    );
    return { ordenes, totalPaging, shipmentIds };
  }

  if (conShippingIdUsable > 0 && conCampoInexistente === 0) {
    anotar(
      "1 · campo del envío en la orden",
      "CONFIRMADO",
      `el campo real es \`order.shipping.id\` (${conShippingIdUsable}/${ordenes.length} lo traen). ` +
        `\`shipping.shipment_id\` NO existe (0/${ordenes.length}). ` +
        `Nulo en ${conShippingIdNulo}/${ordenes.length} (${porcentaje(conShippingIdNulo, ordenes.length)}), ` +
        "que es el caso esperado «envío aún no creado».",
    );
  } else if (conCampoInexistente > 0) {
    anotar(
      "1 · campo del envío en la orden",
      "ATENCION",
      `apareció \`shipping.shipment_id\` en ${conCampoInexistente}/${ordenes.length} órdenes. ` +
        "Revisar el lector antes de tocar nada más.",
    );
  } else {
    anotar(
      "1 · campo del envío en la orden",
      "DESMENTIDO",
      `ninguna de las ${ordenes.length} órdenes trajo \`shipping.id\` utilizable. ` +
        `Claves de shipping vistas: [${[...clavesShipping].join(", ")}].`,
    );
  }

  return { ordenes, totalPaging, shipmentIds };
}

// =============================================================================
// PREGUNTA 2 · El multiget de envíos
// =============================================================================

interface FormaObservada {
  descripcion: string;
  claves: string[];
}

/** Clasifica la forma de una respuesta sin imprimir un solo valor de negocio. */
function clasificarForma(valor: unknown): FormaObservada {
  if (Array.isArray(valor)) {
    const primero: unknown = valor[0];
    const claves = clavesDe(primero);
    const esVerbo = claves.includes("code") && claves.includes("body");
    return {
      descripcion:
        `arreglo de ${valor.length} elemento(s)` +
        (esVerbo
          ? " en formato «verb» de ML (`{code, body}`)"
          : claves.length > 0
            ? " de objetos planos (NO formato verb)"
            : " sin objetos legibles"),
      claves,
    };
  }
  if (esObjeto(valor)) {
    const claves = Object.keys(valor).sort();
    const pareceEnvio = claves.includes("status") || claves.includes("id");
    return {
      descripcion: pareceEnvio
        ? "objeto único (parece UN envío, no un lote)"
        : "objeto (posible mapa id → envío u otra estructura)",
      claves,
    };
  }
  return { descripcion: `valor escalar (${typeof valor})`, claves: [] };
}

async function pregunta2(
  accessToken: string,
  shipmentIds: string[],
): Promise<void> {
  seccion("PREGUNTA 2 · ¿Existe `GET /shipments?ids=…` y en qué forma responde?");

  if (shipmentIds.length === 0) {
    decir("No hubo ningún id de envío en la muestra de la pregunta 1: nada que probar.");
    anotar(
      "2 · multiget de envíos",
      "SIN DATOS",
      "sin ids de envío en la muestra; no se pudo probar el lote.",
    );
    return;
  }

  // ML documenta el multiget para /items con tope de 20 ids y respuesta en
  // formato «verb». Probamos hasta 3: alcanza para ver la forma sin gastar cuota.
  const ids = shipmentIds.slice(0, 3);
  const listaIds = ids.join(",");

  const pruebas: Array<{ etiqueta: string; ruta: string; encabezados?: Record<string, string> }> = [
    {
      etiqueta: `GET /shipments?ids=…  (${ids.length} id${ids.length === 1 ? "" : "s"})  ·  CON x-format-new`,
      ruta: `/shipments?ids=${encodeURIComponent(listaIds)}`,
      encabezados: { ...ENCABEZADO_FORMATO_NUEVO_ML },
    },
    {
      etiqueta: `GET /shipments?ids=…  (${ids.length} id${ids.length === 1 ? "" : "s"})  ·  SIN x-format-new`,
      ruta: `/shipments?ids=${encodeURIComponent(listaIds)}`,
    },
    {
      etiqueta:
        "GET /shipments?ids=…  (1 id)  ·  CON x-format-new — descarta que el problema sea el lote",
      ruta: `/shipments?ids=${encodeURIComponent(ids[0])}`,
      encabezados: { ...ENCABEZADO_FORMATO_NUEVO_ML },
    },
  ];

  decir("Qué se probó: tres variantes del lote, más la llamada individual para comparar.");
  decir();
  decir("Qué respondió ML:");

  const formas: Array<{ etiqueta: string; ok: boolean; status: number | null; forma?: FormaObservada }> =
    [];

  for (const prueba of pruebas) {
    const respuesta = await getMl<unknown>(prueba.ruta, accessToken, prueba.encabezados);
    if (respuesta.ok) {
      const forma = clasificarForma(respuesta.valor);
      formas.push({ etiqueta: prueba.etiqueta, ok: true, status: 200, forma });
      decir(`  · ${prueba.etiqueta}`);
      decir(`      HTTP 200 → ${forma.descripcion}`);
      decir(`      claves del primer elemento: [${forma.claves.join(", ")}]`);
    } else {
      formas.push({ etiqueta: prueba.etiqueta, ok: false, status: respuesta.status });
      decir(`  · ${prueba.etiqueta}`);
      decir(`      HTTP ${respuesta.status ?? "sin status"} → ${respuesta.resumen}`);
    }
  }

  // Llamada individual de referencia.
  const individual = await getMl<ShipmentMl>(
    `/shipments/${encodeURIComponent(ids[0])}`,
    accessToken,
    { ...ENCABEZADO_FORMATO_NUEVO_ML },
  );

  decir();
  decir("  · GET /shipments/{id}  ·  CON x-format-new  (la referencia)");
  if (individual.ok) {
    const clavesIndividual = clavesDe(individual.valor);
    decir(`      HTTP 200 → objeto único con ${clavesIndividual.length} claves`);
    decir(`      claves: [${clavesIndividual.join(", ")}]`);

    const formaLote = formas.find((entrada) => entrada.ok && entrada.forma)?.forma;
    if (formaLote) {
      const clavesLote = formaLote.claves;
      const soloLote = clavesLote.filter((clave) => !clavesIndividual.includes(clave));
      const soloIndividual = clavesIndividual.filter((clave) => !clavesLote.includes(clave));
      decir();
      decir("  Comparación lote vs. individual:");
      decir(`      solo en el lote:       [${soloLote.join(", ") || "—"}]`);
      decir(`      solo en el individual: [${soloIndividual.join(", ") || "—"}]`);
    }
  } else {
    decir(`      HTTP ${individual.status ?? "sin status"} → ${individual.resumen}`);
  }

  const algunLoteRespondio = formas.some((forma) => forma.ok);
  const status404 = formas.every((forma) => !forma.ok && forma.status === 404);

  if (status404) {
    anotar(
      "2 · multiget de envíos",
      "CONFIRMADO",
      "`GET /shipments?ids=…` NO existe: ML responde 404 en las tres variantes. " +
        "La lectura de a uno (`GET /shipments/{id}`) es el único camino, tal como está hoy.",
    );
  } else if (algunLoteRespondio) {
    const conForma = formas.find((forma) => forma.ok && forma.forma);
    anotar(
      "2 · multiget de envíos",
      "ATENCION",
      `el endpoint SÍ respondió: ${conForma?.forma?.descripcion ?? "forma no clasificada"}. ` +
        "Revisar si conviene volver al lote y con qué parser (ver la comparación de claves arriba).",
    );
  } else {
    anotar(
      "2 · multiget de envíos",
      "CONFIRMADO",
      `el lote no sirve: ML respondió ${formas
        .map((forma) => forma.status ?? "sin status")
        .join(" / ")}. Se mantiene la lectura de a uno.`,
    );
  }
}

// =============================================================================
// PREGUNTA 3 · ¿El filtro incremental filtra de verdad?
// =============================================================================

interface CandidatoFiltro {
  etiqueta: string;
  desde: string;
  hasta: string;
  nota: string;
}

const CANDIDATOS: CandidatoFiltro[] = [
  {
    etiqueta: "order.date_created.from / .to",
    desde: "order.date_created.from",
    hasta: "order.date_created.to",
    nota: "el que usa hoy la ingesta y el backfill",
  },
  {
    etiqueta: "date_created.from / .to",
    desde: "date_created.from",
    hasta: "date_created.to",
    nota: "sin el prefijo `order.` — aparece así en parte de la doc de ML",
  },
  {
    etiqueta: "order.date_last_updated.from / .to",
    desde: "order.date_last_updated.from",
    hasta: "order.date_last_updated.to",
    nota: "candidato para un cursor por última modificación",
  },
  {
    etiqueta: "date_last_updated.from / .to",
    desde: "date_last_updated.from",
    hasta: "date_last_updated.to",
    nota: "idem, sin prefijo",
  },
  {
    etiqueta: "CANARIO · rutax.inventado.from / .to",
    desde: "rutax.inventado.from",
    hasta: "rutax.inventado.to",
    nota: "parámetro que NO existe: si esto reduce el total, el método de medición no sirve",
  },
];

async function totalDeBusqueda(
  accessToken: string,
  mlUserId: string,
  extra: Record<string, string>,
): Promise<{ total: number | null; status: number | null; resumen: string }> {
  const parametros = new URLSearchParams({ seller: mlUserId, limit: "1", offset: "0", ...extra });
  const respuesta = await getMl<BusquedaOrdenes>(
    `/orders/search?${parametros.toString()}`,
    accessToken,
  );
  if (!respuesta.ok) {
    return { total: null, status: respuesta.status, resumen: respuesta.resumen };
  }
  return { total: respuesta.valor.paging?.total ?? 0, status: 200, resumen: "" };
}

function celda(valor: number | null, status: number | null): string {
  if (valor !== null) return String(valor);
  return `HTTP ${status ?? "?"}`;
}

async function pregunta3(
  conexion: ConexionElegida,
  accessToken: string,
  dias: number,
): Promise<void> {
  seccion("PREGUNTA 3 · ¿El filtro incremental FILTRA, o ML lo ignora en silencio?");

  const ahora = new Date();
  const reciente = new Date(ahora.getTime() - dias * 24 * 60 * 60 * 1000);
  const vaciaDesde = new Date(ahora.getTime() - VACIA_DIAS_ATRAS * 24 * 60 * 60 * 1000);
  const vaciaHasta = new Date(vaciaDesde.getTime() + VACIA_ANCHO_MS);

  decir("Qué se probó:");
  decir("  Para cada nombre candidato, la MISMA búsqueda cuatro veces y se compara `paging.total`:");
  decir("    (a) sin filtro                 → total de referencia de la cuenta");
  decir(`    (b) ventana reciente           → ${isoZulu(reciente)} … ${isoZulu(ahora)}`);
  decir(`    (c) ventana imposible (2015)   → ${isoZulu(IMPOSIBLE_DESDE)} … ${isoZulu(IMPOSIBLE_HASTA)}`);
  decir(`    (d) ventana vacía en rango     → ${isoZulu(vaciaDesde)} … ${isoZulu(vaciaHasta)}`);
  decir("  Las ventanas (c) y (d) son la prueba dura: si el filtro está vivo, el total DEBE ser 0.");
  decir("  Si devuelve el mismo total que sin filtro, ML lo ignoró en silencio.");
  decir(
    "  (d) existe porque (c) cae fuera de los 12 meses que ML consulta: si ML acotara la ventana",
  );
  decir("  o la rechazara con 400, (c) sola haría concluir «no filtra» estando vivo el filtro.");

  const base = await totalDeBusqueda(accessToken, conexion.mlUserId, {});
  decir();
  decir(`Total de referencia (sin filtro alguno): ${celda(base.total, base.status)}`);

  if (base.total === null) {
    anotar(
      "3 · filtro incremental",
      "SIN DATOS",
      `la búsqueda sin filtro falló (HTTP ${base.status ?? "?"}: ${base.resumen}); sin referencia no hay comparación.`,
    );
    return;
  }

  if (base.total === 0) {
    anotar(
      "3 · filtro incremental",
      "SIN DATOS",
      "la cuenta no tiene órdenes en la búsqueda de vendedor: con total 0 ningún filtro es distinguible. " +
        "Repite con otra conexión (--listar / --conexion).",
    );
    return;
  }

  interface Medicion {
    candidato: CandidatoFiltro;
    reciente: { total: number | null; status: number | null; resumen: string };
    imposible: { total: number | null; status: number | null; resumen: string };
    vacia: { total: number | null; status: number | null; resumen: string };
    veredicto: string;
  }

  const mediciones: Medicion[] = [];

  for (const candidato of CANDIDATOS) {
    const medicionReciente = await totalDeBusqueda(accessToken, conexion.mlUserId, {
      [candidato.desde]: isoZulu(reciente),
      [candidato.hasta]: isoZulu(ahora),
    });
    const medicionImposible = await totalDeBusqueda(accessToken, conexion.mlUserId, {
      [candidato.desde]: isoZulu(IMPOSIBLE_DESDE),
      [candidato.hasta]: isoZulu(IMPOSIBLE_HASTA),
    });
    const medicionVacia = await totalDeBusqueda(accessToken, conexion.mlUserId, {
      [candidato.desde]: isoZulu(vaciaDesde),
      [candidato.hasta]: isoZulu(vaciaHasta),
    });

    // Basta que UNA de las dos ventanas vacías dé 0 para probar que el filtro
    // está vivo. Un 400 en la de 2015 no es «no filtra»: es ML validando el
    // parámetro, o sea que lo reconoce — por eso la de en-rango manda.
    const vaciasEnCero = [medicionImposible, medicionVacia].filter(
      (medicion) => medicion.total === 0,
    ).length;
    const vaciasEnBase = [medicionImposible, medicionVacia].filter(
      (medicion) => medicion.total === base.total,
    ).length;

    let veredicto: string;
    if (vaciasEnCero > 0) {
      veredicto =
        medicionReciente.total !== null && medicionReciente.total < base.total
          ? "FILTRA"
          : "FILTRA (la ventana reciente cubre todo)";
    } else if (vaciasEnBase === 2) {
      veredicto = "IGNORADO";
    } else if (medicionVacia.total === null) {
      const status = medicionVacia.status;
      veredicto =
        status === 400
          ? "RECHAZADO (400: ML valida el parámetro — lo reconoce)"
          : `ERROR HTTP ${status ?? "?"}`;
    } else {
      veredicto = "AMBIGUO (revisar a mano)";
    }

    mediciones.push({
      candidato,
      reciente: medicionReciente,
      imposible: medicionImposible,
      vacia: medicionVacia,
      veredicto,
    });
  }

  decir();
  decir("Qué respondió ML (paging.total en cada caso):");
  decir();
  // Ancho calculado, no fijo: una etiqueta larga no puede descuadrar la tabla.
  const anchoNombre = Math.max(
    "parámetro".length,
    ...mediciones.map((medicion) => medicion.candidato.etiqueta.length),
  );
  decir(
    "  " +
      "parámetro".padEnd(anchoNombre + 2) +
      "reciente".padEnd(12) +
      "2015".padEnd(12) +
      "vacía-rango".padEnd(14) +
      "veredicto",
  );
  decir("  " + "-".repeat(anchoNombre + 2 + 12 + 12 + 14 + 24));
  for (const medicion of mediciones) {
    decir(
      "  " +
        medicion.candidato.etiqueta.padEnd(anchoNombre + 2) +
        celda(medicion.reciente.total, medicion.reciente.status).padEnd(12) +
        celda(medicion.imposible.total, medicion.imposible.status).padEnd(12) +
        celda(medicion.vacia.total, medicion.vacia.status).padEnd(14) +
        medicion.veredicto,
    );
  }
  decir();
  for (const medicion of mediciones) {
    decir(`  · ${medicion.candidato.etiqueta} — ${medicion.candidato.nota}`);
  }

  // --- Formato de fecha: `Z` (lo que manda la ingesta) vs. TZD con offset -----
  decir();
  decir("Formato de fecha — mismo instante, dos escrituras (ventana imposible):");
  const formatos: Array<{ etiqueta: string; desde: string; hasta: string }> = [
    {
      etiqueta: "order.date_created con offset -04:00/-03:00 (TZD, como los ejemplos de ML)",
      desde: "order.date_created.from",
      hasta: "order.date_created.to",
    },
    {
      etiqueta: "date_created con offset -04:00/-03:00",
      desde: "date_created.from",
      hasta: "date_created.to",
    },
  ];

  for (const formato of formatos) {
    // Se prueba sobre la ventana vacía EN RANGO, no sobre la de 2015: si ML
    // acotara o rechazara el fuera-de-rango, no se sabría si lo que falló fue
    // el formato de la fecha o el rango, que es justo lo que se quiere separar.
    const medicion = await totalDeBusqueda(accessToken, conexion.mlUserId, {
      [formato.desde]: isoConOffsetSantiago(vaciaDesde),
      [formato.hasta]: isoConOffsetSantiago(vaciaHasta),
    });
    const lectura =
      medicion.total === null
        ? `HTTP ${medicion.status ?? "?"} — ${medicion.resumen}`
        : medicion.total === 0
          ? "total=0 → el formato con offset también filtra"
          : medicion.total === base.total
            ? `total=${medicion.total} → IGNORADO con este formato`
            : `total=${medicion.total} → ambiguo`;
    decir(`  · ${formato.etiqueta}: ${lectura}`);
  }

  // --- Veredicto -------------------------------------------------------------
  const canario = mediciones[mediciones.length - 1];
  const elQueUsamos = mediciones[0];
  const filtran = mediciones
    .slice(0, -1)
    .filter((medicion) => medicion.veredicto.startsWith("FILTRA"))
    .map((medicion) => medicion.candidato.etiqueta);
  const ignorados = mediciones
    .slice(0, -1)
    .filter((medicion) => medicion.veredicto === "IGNORADO")
    .map((medicion) => medicion.candidato.etiqueta);

  if (canario.veredicto !== "IGNORADO") {
    anotar(
      "3 · filtro incremental",
      "ATENCION",
      `el CANARIO (un parámetro inventado) dio «${canario.veredicto}» en vez de «IGNORADO». ` +
        "El método de medición no es de fiar en esta cuenta: no concluyas nada de la tabla sin mirarla a mano.",
    );
    return;
  }

  if (elQueUsamos.veredicto.startsWith("FILTRA")) {
    anotar(
      "3 · filtro incremental",
      "CONFIRMADO",
      `\`order.date_created.from/.to\` FILTRA de verdad (ventana vacía → total 0, contra ${base.total} sin filtro). ` +
        `El canario se ignora como debe. Filtran: [${filtran.join(" · ") || "—"}]. ` +
        `Se ignoran: [${ignorados.join(" · ") || "—"}].`,
    );
  } else {
    anotar(
      "3 · filtro incremental",
      "DESMENTIDO",
      `\`order.date_created.from/.to\` NO filtra (veredicto «${elQueUsamos.veredicto}»). ` +
        `Alternativas que sí filtran: [${filtran.join(" · ") || "ninguna"}]. ` +
        "Esto cambia el diseño de la ingesta incremental: hay que revisarlo antes de seguir.",
    );
  }
}

// =============================================================================
// PREGUNTA 4 · La cabecera obligatoria y la forma del JSON del envío
// =============================================================================

interface LecturaEnvio {
  shipmentId: string;
  ok: boolean;
  status: number | null;
  claves: string[];
  ubicacionDireccion: string;
  clavesDireccion: string[];
  tieneLat: boolean;
  tieneLong: boolean;
  logisticType: string | null;
  ubicacionLogisticType: string;
  estado: string | null;
  subestado: string | null;
  campoFechaEntrega: string | null;
  tieneNombreDestinatario: boolean;
}

/**
 * Lee un envío y devuelve SOLO su forma. Del cuerpo real no sale un solo valor
 * personal: `interpretarShipment` produce el diagnóstico (nombres de campo) y
 * de los datos únicamente se conservan banderas y valores no personales
 * (estado, subestado, logistic_type).
 */
async function leerFormaEnvio(
  shipmentId: string,
  accessToken: string,
  conCabecera: boolean,
): Promise<LecturaEnvio> {
  const vacio: LecturaEnvio = {
    shipmentId,
    ok: false,
    status: null,
    claves: [],
    ubicacionDireccion: "—",
    clavesDireccion: [],
    tieneLat: false,
    tieneLong: false,
    logisticType: null,
    ubicacionLogisticType: "—",
    estado: null,
    subestado: null,
    campoFechaEntrega: null,
    tieneNombreDestinatario: false,
  };

  const respuesta = await getMl<ShipmentMl>(
    `/shipments/${encodeURIComponent(shipmentId)}`,
    accessToken,
    conCabecera ? { ...ENCABEZADO_FORMATO_NUEVO_ML } : undefined,
  );

  if (!respuesta.ok) {
    return { ...vacio, status: respuesta.status };
  }

  const crudo = respuesta.valor ?? {};
  const { datos, diagnostico } = interpretarShipment(crudo);

  // El bloque de dirección se localiza a mano SOLO para listar sus claves.
  const bloque: unknown =
    (esObjeto(crudo.destination) ? crudo.destination.shipping_address : undefined) ??
    crudo.receiver_address;

  const latitud = esObjeto(bloque) ? bloque.latitude : undefined;
  const longitud = esObjeto(bloque) ? bloque.longitude : undefined;

  return {
    shipmentId,
    ok: true,
    status: 200,
    claves: diagnostico.claves,
    ubicacionDireccion: diagnostico.ubicacionDireccion,
    clavesDireccion: clavesDe(bloque),
    tieneLat: latitud !== null && latitud !== undefined && latitud !== "",
    tieneLong: longitud !== null && longitud !== undefined && longitud !== "",
    logisticType: datos.logisticType,
    ubicacionLogisticType: diagnostico.ubicacionLogisticType,
    estado: datos.estadoMl,
    subestado: datos.subestadoMl,
    campoFechaEntrega: diagnostico.campoFechaEntrega,
    tieneNombreDestinatario: datos.destinatarioNombre !== null,
  };
}

function describirLectura(lectura: LecturaEnvio): void {
  if (!lectura.ok) {
    decir(`      HTTP ${lectura.status ?? "sin status"} — no se pudo leer`);
    return;
  }
  decir(`      claves de primer nivel: [${lectura.claves.join(", ")}]`);
  decir(
    `      bloque de dirección en: ${lectura.ubicacionDireccion}` +
      ` · claves: [${lectura.clavesDireccion.join(", ") || "—"}]`,
  );
  decir(
    `      coordenadas: latitude ${lectura.tieneLat ? "con valor" : "nula/ausente"}` +
      ` · longitude ${lectura.tieneLong ? "con valor" : "nula/ausente"}`,
  );
  decir(
    `      logistic_type: ${lectura.logisticType ?? "ausente"} (ubicación: ${lectura.ubicacionLogisticType})`,
  );
  decir(`      status/substatus del ENVÍO: ${lectura.estado ?? "—"} / ${lectura.subestado ?? "—"}`);
  decir(`      compromiso de entrega leído de: ${lectura.campoFechaEntrega ?? "ningún campo"}`);
  decir(
    `      nombre del destinatario presente: ${lectura.tieneNombreDestinatario ? "sí" : "no"} (valor NO impreso)`,
  );
}

async function pregunta4(
  accessToken: string,
  shipmentIds: string[],
  cantidad: number,
): Promise<void> {
  seccion("PREGUNTA 4 · `x-format-new: true` — qué cambia en el JSON del envío");

  if (shipmentIds.length === 0) {
    decir("No hubo ids de envío en la muestra: nada que inspeccionar.");
    anotar("4 · cabecera de shipments", "SIN DATOS", "sin envíos en la muestra.");
    return;
  }

  const ids = shipmentIds.slice(0, cantidad);
  decir(`Qué se probó: GET /shipments/{id} para ${ids.length} envío(s), CON y SIN la cabecera.`);
  decir("De la respuesta se imprime la FORMA (nombres de campo y banderas), nunca el contenido.");

  const conCabecera: LecturaEnvio[] = [];
  const sinCabecera: LecturaEnvio[] = [];

  for (const id of ids) {
    decir();
    decir(`  Envío ${id}`);
    decir("    CON x-format-new: true");
    const lecturaCon = await leerFormaEnvio(id, accessToken, true);
    conCabecera.push(lecturaCon);
    describirLectura(lecturaCon);

    decir("    SIN la cabecera");
    const lecturaSin = await leerFormaEnvio(id, accessToken, false);
    sinCabecera.push(lecturaSin);
    describirLectura(lecturaSin);

    if (lecturaCon.ok && lecturaSin.ok) {
      const soloCon = lecturaCon.claves.filter((clave) => !lecturaSin.claves.includes(clave));
      const soloSin = lecturaSin.claves.filter((clave) => !lecturaCon.claves.includes(clave));
      decir(`    Diferencia de claves — solo CON: [${soloCon.join(", ") || "—"}]`);
      decir(`                           solo SIN: [${soloSin.join(", ") || "—"}]`);
    }
  }

  const leidosCon = conCabecera.filter((lectura) => lectura.ok);
  const leidosSin = sinCabecera.filter((lectura) => lectura.ok);
  const conCoordenada = leidosCon.filter((lectura) => lectura.tieneLat && lectura.tieneLong).length;
  const sinCoordenada = leidosSin.filter((lectura) => lectura.tieneLat && lectura.tieneLong).length;
  const flex = leidosCon.filter((lectura) => lectura.logisticType === LOGISTIC_TYPE_FLEX).length;

  decir();
  decir("Resumen de la muestra:");
  decir(`  · Envíos leídos CON cabecera: ${leidosCon.length}/${ids.length}`);
  decir(`  · Envíos leídos SIN cabecera: ${leidosSin.length}/${ids.length}`);
  decir(
    `  · Con coordenada utilizable (lat y long): ${conCoordenada}/${leidosCon.length} con cabecera, ` +
      `${sinCoordenada}/${leidosSin.length} sin ella  ← esto es el geocoding gratis de Flex`,
  );
  decir(
    `  · Flex (\`${LOGISTIC_TYPE_FLEX}\`): ${flex}/${leidosCon.length}` +
      ` · ubicaciones de logistic_type vistas: [${[
        ...new Set(leidosCon.map((lectura) => lectura.ubicacionLogisticType)),
      ].join(", ")}]`,
  );
  decir(
    `  · Ubicaciones del bloque de dirección — con cabecera: [${[
      ...new Set(leidosCon.map((lectura) => lectura.ubicacionDireccion)),
    ].join(", ")}] · sin cabecera: [${[
      ...new Set(leidosSin.map((lectura) => lectura.ubicacionDireccion)),
    ].join(", ")}]`,
  );

  if (leidosCon.length === 0) {
    anotar(
      "4 · cabecera de shipments",
      "SIN DATOS",
      "ningún envío se pudo leer con la cabecera; revisar los códigos HTTP de arriba.",
    );
    return;
  }

  const ubicacionesCon = new Set(leidosCon.map((lectura) => lectura.ubicacionDireccion));
  const ubicacionesSin = new Set(leidosSin.map((lectura) => lectura.ubicacionDireccion));
  const cambiaDeSitio =
    leidosSin.length > 0 &&
    [...ubicacionesCon].join(",") !== [...ubicacionesSin].join(",");

  anotar(
    "4 · cabecera de shipments",
    cambiaDeSitio ? "CONFIRMADO" : "ATENCION",
    cambiaDeSitio
      ? `con la cabecera el domicilio llega en «${[...ubicacionesCon].join(",")}» y sin ella en ` +
        `«${[...ubicacionesSin].join(",")}»: leer del sitio equivocado deja el pedido sin dirección ` +
        `ni coordenada. Con cabecera, ${conCoordenada}/${leidosCon.length} envíos traen coordenada.`
      : `la ubicación del domicilio NO cambió entre las dos llamadas (${[...ubicacionesCon].join(",")}). ` +
        "Revisar si ML ya migró todas las respuestas o si la muestra es demasiado chica.",
  );
}

// =============================================================================
// Entrada
// =============================================================================

interface Opciones {
  listar: boolean;
  conexion: string | null;
  dias: number;
  ordenes: number;
  envios: number;
}

function leerOpciones(argv: string[]): Opciones {
  const opciones: Opciones = {
    listar: argv.includes("--listar"),
    conexion: null,
    dias: 7,
    ordenes: TOPE_ORDENES,
    envios: 3,
  };

  const numero = (bandera: string, actual: number, tope: number): number => {
    const indice = argv.indexOf(bandera);
    if (indice < 0) return actual;
    const crudo = Number(argv[indice + 1]);
    if (!Number.isFinite(crudo) || crudo <= 0) {
      throw new ErrorDeUso(`La opción ${bandera} necesita un número positivo.`);
    }
    return Math.min(Math.floor(crudo), tope);
  };

  const indiceConexion = argv.indexOf("--conexion");
  if (indiceConexion >= 0) {
    const valor = argv[indiceConexion + 1];
    if (!valor || valor.startsWith("--")) {
      throw new ErrorDeUso("La opción --conexion necesita el uuid de la conexión.");
    }
    opciones.conexion = valor;
  }

  opciones.dias = numero("--dias", opciones.dias, 30);
  opciones.ordenes = numero("--ordenes", opciones.ordenes, TOPE_ORDENES);
  opciones.envios = numero("--envios", opciones.envios, TOPE_ENVIOS);

  return opciones;
}

function imprimirResumen(): void {
  titulo("RESUMEN — pega este bloque completo");
  for (const veredicto of veredictos) {
    decir(`  [${veredicto.estado.padEnd(10)}] ${veredicto.pregunta}`);
    decir(`               ${veredicto.resumen}`);
    decir();
  }
  decir(`  Llamadas a la API de ML en esta corrida: ${llamadasHechas} (todas GET).`);
  decir("  Ninguna escritura: ni a ML, ni a la base de datos.");
}

export async function main(argv: string[]): Promise<number> {
  let opciones: Opciones;
  try {
    opciones = leerOpciones(argv);
  } catch (error) {
    decir(error instanceof Error ? error.message : String(error));
    return 2;
  }

  try {
    exigirEntorno();

    const { fecha, hora } = ahoraEnSantiago();
    const filas = await leerConexionesSanas();

    if (opciones.listar) {
      titulo("CONEXIONES ML UTILIZABLES");
      for (const fila of filas) {
        decir(
          `  · ${fila.id}  [${fila.estado_salud}]  ${etiquetarConexion(fila)}` +
            `  · última sync: ${fila.ultima_sync_exitosa_en ?? "nunca"}`,
        );
      }
      decir();
      decir(`  Total: ${filas.length}. Usa --conexion <uuid> para fijar una.`);
      return 0;
    }

    const conexion = elegirConexion(filas, opciones.conexion);

    titulo("VERIFICACIÓN DEL CONTRATO CON LA API DE MERCADO LIBRE · SOLO LECTURA");
    decir(`  Ejecutado: ${fecha} ${hora} (America/Santiago)`);
    decir(`  Supabase:  ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
    decir(`  Conexiones utilizables encontradas: ${filas.length}`);
    decir(`  Conexión usada: ${conexion.etiqueta}`);
    const vencidoEnBd =
      conexion.tokenExpiraEn !== null && new Date(conexion.tokenExpiraEn).getTime() < Date.now();
    decir(
      `  Estado de salud: ${conexion.estadoSalud} · token expira: ${conexion.tokenExpiraEn ?? "sin registro"}` +
        (vencidoEnBd ? "  ← la base dice que YA VENCIÓ" : ""),
    );
    if (filas.length > 1 && !opciones.conexion) {
      decir("  (había más de una; se eligió la de sincronización más reciente. Usa --conexion para fijar otra.)");
    }

    seccion("Comprobación previa del token (no se imprime ni un fragmento)");
    const accessToken = await obtenerAccessToken(conexion);
    await comprobarToken(conexion, accessToken);

    const muestra = await pregunta1(conexion, accessToken, opciones.ordenes);
    const shipmentIds = muestra?.shipmentIds ?? [];

    await pregunta2(accessToken, shipmentIds);
    await pregunta3(conexion, accessToken, opciones.dias);
    await pregunta4(accessToken, shipmentIds, opciones.envios);

    imprimirResumen();
    return 0;
  } catch (error) {
    decir();
    decir(REGLA);
    if (error instanceof ErrorDeUso) {
      decir(" NO SE PUDO COMPLETAR LA VERIFICACIÓN");
      decir(REGLA);
      decir(error.message);
      return 1;
    }
    decir(" ERROR INESPERADO");
    decir(REGLA);
    decir(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    decir();
    decir("Si el mensaje no alcanza para entenderlo, córrelo de nuevo con --listar para");
    decir("descartar que el problema sea la conexión elegida.");
    return 1;
  }
}
