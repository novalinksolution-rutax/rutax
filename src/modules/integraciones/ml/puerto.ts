/**
 * Puerto OAuth de Mercado Libre — adaptador aislado.
 * =====================================================================
 *
 * Esta es la ÚNICA puerta por la que el resto del sistema debe hablar con la
 * API de OAuth de Mercado Libre (regla de límite §11.2 del documento de
 * arquitectura: "Nadie fuera de `integraciones` llama a la API de ML... ni
 * descifra un secreto por su cuenta — siempre a través del adaptador/puerto").
 *
 * Aplica la skill `flex-ml`:
 * - OAuth 2.0 por seller, cuenta PRINCIPAL/manager (la UI de conexión —
 *   trabajo de `frontend`/`ux-ui` — debe explicitar este requisito; este
 *   puerto no puede verificar "es cuenta principal" del lado API, solo puede
 *   dejar evidencia en `ultimo_error`/bitácora si ML lo señala).
 * - Combina con sondeo de respaldo (RF-013, Fase B) — los webhooks se pierden.
 * - Backoff + idempotencia ante límites de tasa (delegado a `cliente-http.ts`
 *   y `resiliencia.ts`).
 *
 * VERIFICACIÓN CONTRA DOCUMENTACIÓN OFICIAL VIGENTE (lo volátil):
 * Fuente: developers.mercadolibre.com(.ar) — "Authentication and
 * Authorization" / "Authorization and Token Best Practices" (consultadas en
 * esta iteración; la skill exige reverificar antes de cada cambio porque
 * "endpoints, TTL de tokens, límites de tasa y campos cambian"):
 *
 * 1. Flujo: Authorization Code Grant — `GET /authorization?response_type=code
 *    &client_id=...&redirect_uri=...&state=...` → el seller autoriza → ML
 *    redirige a `redirect_uri?code=...&state=...` → se intercambia el code
 *    por tokens en `POST https://api.mercadolibre.com/oauth/token`.
 * 2. `expires_in` del access_token: 21600 segundos = 6 horas (valor
 *    consistentemente documentado en los ejemplos oficiales). NO se hardcodea
 *    como constante de negocio — se persiste `token_expira_en = ahora +
 *    expires_in` calculado del valor que el proveedor REALMENTE devuelve en
 *    cada respuesta, exactamente para sobrevivir si ML cambia este número.
 * 3. `refresh_token` es de UN SOLO USO: cada operación de refresco devuelve
 *    un `refresh_token` nuevo y el anterior queda inválido de inmediato. Por
 *    eso `refrescarToken` SIEMPRE persiste el `refresh_token` que vuelve en
 *    la respuesta — nunca conserva el anterior "por si acaso".
 * 4. El intercambio inicial y el refresco usan el MISMO endpoint
 *    `/oauth/token`, cambiando `grant_type` (`authorization_code` ↔
 *    `refresh_token`).
 *
 * Antes de ir a producción: re-confirmar estos tres puntos contra
 * developers.mercadolibre.com.ar/cl vigente — son exactamente "lo volátil"
 * que la skill `flex-ml` pide reverificar (este puerto deja el contrato listo
 * para que el job de Fase B no tenga que re-derivar nada, pero los números
 * pueden moverse entre ahora y la implementación de ese job).
 */

import { inngest } from "@/lib/inngest/cliente";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { cifrarSecreto, descifrarSecreto } from "../secretos";
import type { ReferenciaSecreto } from "../secretos/tipos";
import { ML_AUTH_BASE_URL, ErrorHttpMl, peticionMl, peticionBinariaMl } from "./cliente-http";
import { CacheIdempotencia } from "../resiliencia";
import type {
  ConexionSellerMl,
  EstadoSaludConexionMl,
  IniciarAutorizacionEntrada,
  IniciarAutorizacionResultado,
  IntercambiarCodigoEntrada,
  ObtenerEtiquetaEnvioEntrada,
  ObtenerEtiquetaEnvioResultado,
  RazonFalloRefresco,
  RefrescarTokenEntrada,
  RefrescarTokenResultado,
  ResumenSaludMlTenant,
  RespuestaTokenMl,
} from "./tipos";

/**
 * Errores de integridad al persistir una conexión bajo el modelo 1:N (un seller
 * puede conectar hasta N cuentas ML). Se traducen desde los SQLSTATE que
 * imponen las reglas del esquema (migración
 * `20260630000002_identidad_conexiones_seller_ml_multicuenta.sql`):
 *
 * - `23514` (check_violation) → el trigger de tope disparó: el seller ya tiene
 *   el máximo de cuentas permitidas.
 * - `23505` (unique_violation) → el índice único parcial `(seller_id,
 *   ml_user_id)` disparó: esa misma cuenta ML ya está conectada a este seller.
 *
 * El llamador (route del callback OAuth) los distingue para dar un mensaje
 * accionable en vez de un error genérico.
 */
export class ErrorTopeCuentasMlAlcanzado extends Error {
  readonly sellerId: string;
  constructor(sellerId: string) {
    super(
      `El seller ${sellerId} alcanzó el tope de cuentas de Mercado Libre permitidas. ` +
        "Desconecta una cuenta existente antes de conectar otra.",
    );
    this.name = "ErrorTopeCuentasMlAlcanzado";
    this.sellerId = sellerId;
  }
}

export class ErrorCuentaMlYaConectada extends Error {
  readonly sellerId: string;
  readonly mlUserId: string;
  constructor(sellerId: string, mlUserId: string) {
    super(
      `La cuenta de Mercado Libre ${mlUserId} ya está conectada al seller ${sellerId}.`,
    );
    this.name = "ErrorCuentaMlYaConectada";
    this.sellerId = sellerId;
    this.mlUserId = mlUserId;
  }
}

/**
 * El seller debe re-vincular su cuenta de Mercado Libre (cuenta PRINCIPAL/
 * manager — skill `flex-ml`) antes de poder usar este puerto. Se lanza cuando
 * `refrescarToken` devuelve `requiere_revinculacion` al intentar obtener un
 * access_token vigente para una operación (p. ej. descargar una etiqueta).
 *
 * El llamador (route handler) debe capturar este error específicamente para
 * mostrar un mensaje accionable ("reconecta tu cuenta de Mercado Libre") en
 * vez de un error genérico — distinción exigida por la skill `flex-ml` y §7.
 */
export class ErrorConexionMlRequiereRevinculacion extends Error {
  readonly sellerId: string;
  readonly conexionId: string;

  constructor(sellerId: string, conexionId: string) {
    super(
      `La conexión con Mercado Libre del seller ${sellerId} requiere re-vinculación ` +
        "(el refresh_token fue rechazado/revocado). El seller debe reconectar su cuenta.",
    );
    this.name = "ErrorConexionMlRequiereRevinculacion";
    this.sellerId = sellerId;
    this.conexionId = conexionId;
  }
}

/**
 * Credenciales de la app de Mercado Libre (`client_id`/`client_secret`).
 * Gestionadas como variables de entorno de plataforma — NO son secretos
 * por-tenant (una sola app de ML sirve a todos los couriers/sellers que se
 * conectan), por eso no pasan por `secretos_cifrados` (esa tabla es para
 * secretos *del tenant*). `devops` las rota; nunca se loguean.
 */
function leerCredencialesApp(): { clientId: string; clientSecret: string } {
  const clientId = process.env.ML_APP_CLIENT_ID;
  const clientSecret = process.env.ML_APP_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Faltan credenciales de la app de Mercado Libre " +
        "(ML_APP_CLIENT_ID / ML_APP_CLIENT_SECRET). Configúralas vía el " +
        "gestor de secretos del despliegue — nunca se loguea su valor.",
    );
  }

  return { clientId, clientSecret };
}

/**
 * Caché de idempotencia para el intercambio de código: ML puede reintentar
 * el callback (doble clic, recarga) y un mismo `code` solo puede canjearse
 * una vez — sin esto, el segundo intento fallaría con un error confuso de
 * ML en lugar de devolver la conexión ya creada.
 */
const codigosEnProceso = new CacheIdempotencia(2 * 60_000);

/**
 * Resultado ya persistido de un intercambio de `code`, cacheado por su clave de
 * idempotencia. Bajo el modelo 1:N ya NO se puede resolver "la conexión del
 * seller" en un doble callback (el seller puede tener varias cuentas y el
 * `code` es de un solo uso — no podemos re-canjearlo ni conocer el `user_id`
 * sin re-golpear ML). Por eso memorizamos la conexión que dejó la primera
 * ejecución y la devolvemos tal cual en la segunda. TTL corto (mismo que el
 * marcador anti-doble-canje). Se limpia por edad de forma perezosa.
 */
const resultadosIntercambio = new Map<string, { conexion: ConexionSellerMl; en: number }>();
const TTL_RESULTADO_INTERCAMBIO_MS = 2 * 60_000;

function recordarResultadoIntercambio(clave: string, conexion: ConexionSellerMl): void {
  const ahora = Date.now();
  for (const [k, v] of resultadosIntercambio) {
    if (ahora - v.en > TTL_RESULTADO_INTERCAMBIO_MS) resultadosIntercambio.delete(k);
  }
  resultadosIntercambio.set(clave, { conexion, en: ahora });
}

// ---------------------------------------------------------------------------
// 1. Iniciar autorización
// ---------------------------------------------------------------------------

/**
 * Construye la URL de autorización de Mercado Libre a la que se debe
 * redirigir al seller. No hace ninguna llamada HTTP — es pura construcción
 * de URL (el `state` anti-CSRF lo gestiona el llamador, ver `tipos.ts`).
 *
 * IMPORTANTE (skill flex-ml): la UI debe instruir al seller para que entre
 * con su cuenta PRINCIPAL/manager — un colaborador/operador genera un
 * permiso inválido. Esa instrucción es responsabilidad de `frontend`/
 * `copywriter`; este puerto solo construye el enlace.
 */
export function iniciarAutorizacion(
  entrada: IniciarAutorizacionEntrada,
): IniciarAutorizacionResultado {
  const { clientId } = leerCredencialesApp();

  const parametros = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: entrada.redirectUri,
    state: entrada.state,
  });

  return {
    // Consentimiento en el host de Chile (auth.mercadolibre.cl), NO en el host
    // global de la API. El token sí se intercambia en api.mercadolibre.com.
    urlAutorizacion: `${ML_AUTH_BASE_URL}/authorization?${parametros.toString()}`,
  };
}

// ---------------------------------------------------------------------------
// 2. Intercambiar código por tokens y persistir la conexión
// ---------------------------------------------------------------------------

/**
 * Intercambia el `code` del callback OAuth por `access_token`/`refresh_token`,
 * cifra ambos (vía `cifrarSecreto`) y crea/actualiza la fila en
 * `conexiones_seller_ml` guardando solo sus `*_ref` + `ml_user_id` +
 * `token_expira_en` + `estado_salud='sana'`.
 *
 * Idempotente: si el mismo `code` llega dos veces (doble submit del
 * callback), la segunda llamada no vuelve a golpear la API de ML — devuelve
 * la conexión que la primera ya dejó persistida (memorizada en
 * `resultadosIntercambio`). Esto NO sustituye la idempotencia "dura" a nivel
 * de fila: bajo el modelo 1:N la unicidad la garantizan el índice único
 * parcial `(seller_id, ml_user_id)` y el trigger de tope del esquema; es una
 * defensa adicional contra gastar el `code` (de un solo uso en ML) dos veces.
 *
 * Modelo 1:N (hasta N cuentas por seller): re-hacer el OAuth con OTRA cuenta
 * inserta una fila nueva (sujeta al tope). Re-hacerlo con la MISMA cuenta hace
 * UPDATE de su fila. La resolución fina la hace
 * `persistirTokensYActualizarConexion` por `(seller_id, ml_user_id)`.
 */
export async function intercambiarCodigoPorTokens(
  entrada: IntercambiarCodigoEntrada,
): Promise<ConexionSellerMl> {
  const claveIdempotencia = `ml:intercambio:${entrada.tenantId}:${entrada.sellerId}:${entrada.codigo}`;

  if (!codigosEnProceso.marcarSiEsNuevo(claveIdempotencia)) {
    const memorizado = resultadosIntercambio.get(claveIdempotencia);
    if (memorizado) return memorizado.conexion;
    // Si por algún motivo no quedó memorizada (p. ej. la primera llamada
    // sigue en curso o el TTL expiró), dejamos que el flujo normal continúe.
    // Re-canjear un `code` ya gastado fallará en ML (error no reintentable que
    // el route del callback traduce a "estado_invalido"/"error_sistema") — es
    // el desenlace correcto: no podemos resolver la cuenta a ciegas.
  }

  const { clientId, clientSecret } = leerCredencialesApp();

  const respuestaToken = await peticionMl<RespuestaTokenMl>({
    metodo: "POST",
    ruta: "/oauth/token",
    cuerpoFormulario: {
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code: entrada.codigo,
      redirect_uri: entrada.redirectUri,
    },
  });

  // Best-effort: capturar el nickname de la cuenta (para mostrarla legible en el
  // portal cuando el seller tiene varias). Si falla, la conexión igual se crea
  // (el seller puede ponerle un alias). NUNCA bloquea la conexión ni loguea el token.
  let mlNickname: string | null = null;
  try {
    const me = await peticionMl<{ nickname?: string | null }>({
      metodo: "GET",
      ruta: "/users/me",
      accessToken: respuestaToken.access_token,
    });
    mlNickname = me.nickname ?? null;
  } catch {
    mlNickname = null;
  }

  const conexion = await persistirTokensYActualizarConexion({
    tenantId: entrada.tenantId,
    sellerId: entrada.sellerId,
    respuestaToken,
    estadoSaludResultante: "sana",
    ultimoError: null,
    marcarComoSincronizada: true,
    mlNickname,
  });

  // Memorizar el resultado para un eventual doble callback con el mismo `code`.
  recordarResultadoIntercambio(claveIdempotencia, conexion);

  // Publicar evento de reconexión para que el job de backfill recupere los
  // pedidos del período desconectado (RF-017). Solo si la conexión tiene fecha
  // de desconexión registrada — si es la primera vinculación, `desconectadaDesde`
  // es null y el backfill no aplica.
  // NOTA: se publica DESPUÉS de persistir para garantizar que la conexión
  // existe en BD cuando el job de backfill la lea.
  await inngest.send({
    name: "ml/conexion.reconectada",
    data: {
      conexionId: conexion.id,
      sellerId: conexion.sellerId,
      tenantId: conexion.tenantId,
      // desconectadaDesde es null en primera vinculación — el job de backfill
      // lo maneja (acota a 7 días si es null o si es > 7 días atrás).
      desconectadaDesde: conexion.desconectadaDesde?.toISOString() ?? null,
    },
  });

  return conexion;
}

// ---------------------------------------------------------------------------
// 3. Refresco de tokens — la FORMA que el job de Fase B (RF-012) usará.
//    NO se implementa el job/cron aquí (es explícitamente de Fase B); sí se
//    deja lista la función que ese job invoca por cada conexión vencida.
// ---------------------------------------------------------------------------

/**
 * Refresca el `access_token` de una conexión usando su `refresh_token`
 * vigente. Devuelve si se resolvió solo ("refrescado") o si requiere
 * re-vinculación del seller ("requiere_revinculacion") — la distinción que
 * la skill `flex-ml` y §7 piden para no alarmar de más ni alarmar de menos.
 *
 * Contrato para el futuro job de refresco (RF-012, Fase B):
 * - Invocar `refrescarToken({ conexionId })` por cada fila cuyo
 *   `token_expira_en` esté próximo a vencer (con margen — p. ej. refrescar
 *   30-60 min antes, nunca esperar al filo de las 6 horas).
 * - El job NO decide la interpretación del error: este puerto ya la resuelve
 *   y devuelve `estado_salud` consistente — el job solo debe reaccionar
 *   (notificar, reintentar más tarde, etc.).
 * - Reintentos del propio job ante error transitorio: usar `reintentable` en
 *   el error que esta función propaga (ver `cliente-http.ts`).
 *
 * Idempotente por diseño: si se llama dos veces seguidas para la misma
 * conexión, la segunda usa el `refresh_token` que la primera ya rotó (no el
 * viejo, que ML invalidó) — porque siempre se lee la fila más reciente desde
 * BD justo antes de llamar a ML.
 */
export async function refrescarToken(
  entrada: RefrescarTokenEntrada,
): Promise<RefrescarTokenResultado> {
  const conexion = await leerFilaConexionPorId(entrada.conexionId);
  if (!conexion) {
    throw new Error(`No existe la conexión ${entrada.conexionId}.`);
  }
  if (!conexion.refresh_token_ref) {
    const conexionActualizada = await marcarRequiereRevinculacionSync(
      conexion,
      "Conexión sin refresh_token registrado — requiere re-vinculación del seller.",
    );
    return { resultado: "requiere_revinculacion", conexion: conexionActualizada };
  }

  const { clientId, clientSecret } = leerCredencialesApp();

  let refreshTokenEnClaro: string;
  try {
    const descifrado = await descifrarSecreto(conexion.refresh_token_ref);
    if (typeof descifrado.valor !== "string") {
      throw new Error("El refresh_token descifrado no tiene el formato esperado (texto).");
    }
    refreshTokenEnClaro = descifrado.valor;
  } catch (errorDescifrado) {
    // Fallo al descifrar (clave rotada sin migrar, dato corrupto): no es un
    // problema del seller — no marcar como "requiere re-vinculación". Se
    // propaga para que el job lo trate como error operativo/alertable.
    throw new Error(
      `No se pudo preparar el refresco de la conexión ${conexion.id}: ${(errorDescifrado as Error).message}`,
    );
  }

  try {
    const respuestaToken = await peticionMl<RespuestaTokenMl>({
      metodo: "POST",
      ruta: "/oauth/token",
      cuerpoFormulario: {
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshTokenEnClaro,
      },
    });

    const conexionActualizada = await persistirTokensYActualizarConexion({
      tenantId: conexion.tenant_id,
      sellerId: conexion.seller_id,
      respuestaToken,
      estadoSaludResultante: "sana",
      ultimoError: null,
      marcarComoSincronizada: false,
    });

    return { resultado: "refrescado", conexion: conexionActualizada };
  } catch (error) {
    return await interpretarFalloDeRefresco(conexion, error);
  } finally {
    // `refreshTokenEnClaro` sale de scope aquí — no se reasigna a estructuras
    // de mayor vida ni se incluye en el resultado/errores anteriores.
  }
}

/**
 * Traduce un error de la API de ML a la distinción que importa para la
 * salud de la conexión: "transitorio — lo resuelve un reintento del job" vs.
 * "definitivo — el seller debe re-vincular".
 *
 * Heurística basada en los códigos HTTP que la documentación de OAuth de ML
 * documenta para `/oauth/token` (verificar de nuevo al construir el job de
 * Fase B, ya que la skill exige reconfirmar lo volátil):
 * - 400 con `invalid_grant` → el refresh_token fue revocado/expiró/ya se usó
 *   → DEFINITIVO, requiere re-vinculación.
 * - 401/403 → credenciales de la app inválidas → operativo (no del seller),
 *   pero tampoco lo resuelve un refresco — se marca `atencion`, no
 *   `desvinculada` (no es culpa del seller; alertar a `devops`/`integraciones`).
 * - 429/5xx → transitorio → el propio `peticionMl` ya lo marcó `reintentable`;
 *   se conserva `estado_salud` previo y se registra el error para que el job
 *   decida si reintentar.
 */
async function interpretarFalloDeRefresco(
  conexion: FilaConexionInterna,
  error: unknown,
): Promise<RefrescarTokenResultado> {
  if (error instanceof ErrorHttpMl) {
    const razon = clasificarRazonFallo(error);

    if (razon === "refresh_token_invalido_o_revocado") {
      const conexionActualizada = await marcarRequiereRevinculacionSync(
        conexion,
        "Mercado Libre rechazó el refresh_token (revocado/expirado/ya usado) — requiere re-vinculación del seller.",
      );
      return { resultado: "requiere_revinculacion", conexion: conexionActualizada };
    }
  }

  // Para cualquier otro caso (incluido transitorio), no degradamos la
  // conexión — propagamos para que el job decida (reintentar, alertar). Esto
  // evita marcar `desvinculada` por un 500 pasajero de ML.
  throw error;
}

/**
 * Exportada (no solo interna) deliberadamente: es la pieza de lógica de
 * decisión más importante de la resiliencia de este puerto — "¿este fallo de
 * ML lo resuelve un reintento o requiere re-vinculación humana?" — y debe
 * poder probarse de forma aislada sin golpear la red ni Supabase.
 * Ver `__tests__/ml-puerto.test.ts`.
 */
export function clasificarRazonFallo(error: ErrorHttpMl): RazonFalloRefresco {
  if (error.status === 429) return "limite_de_tasa";
  if (error.status >= 500) return "error_transitorio_proveedor";

  if (error.status === 400) {
    const cuerpo = error.cuerpo as { error?: string } | null;
    if (cuerpo && cuerpo.error === "invalid_grant") {
      return "refresh_token_invalido_o_revocado";
    }
  }

  if (error.status === 401 || error.status === 403) {
    return "credenciales_app_invalidas";
  }

  return "desconocido";
}

// ---------------------------------------------------------------------------
// 4. Lectura de salud (consumida por el sondeo de Fase B y por el portal del
//    seller / dashboard del courier — pero siempre a través de este puerto).
// ---------------------------------------------------------------------------

/**
 * Todas las conexiones ML de un seller (modelo 1:N — hasta N cuentas). Es la
 * forma que portal/dashboard deben consumir para listar cuentas y su salud.
 * Orden estable por fecha de creación implícita del `id` no garantizada — se
 * ordena por `ml_user_id` para una lista determinista en la UI.
 */
export async function obtenerConexionesPorSeller(
  sellerId: string,
): Promise<ConexionSellerMl[]> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema("identidad")
    .from("conexiones_seller_ml")
    .select(COLUMNAS_CONEXION)
    .eq("seller_id", sellerId)
    .order("ml_user_id", { ascending: true, nullsFirst: false });

  if (error) throw new Error(`No se pudieron leer las conexiones ML: ${error.message}`);
  return ((data ?? []) as unknown as FilaConexionInterna[]).map(aConexionPublica);
}

/**
 * Renombra (alias) una conexión del seller. Escritura vía service_role — el
 * seller NO puede escribir directo en `conexiones_seller_ml` (RLS + trigger
 * `solo_interno_edita`). La propiedad se IMPONE en el WHERE: solo actualiza si
 * la fila pertenece al seller (id + seller_id juntos). Devuelve `true` si tocó
 * una fila (existe y es suya), `false` si no. El `alias` ya viene saneado por
 * la capa de acción (server action del portal).
 */
export async function renombrarConexion(entrada: {
  conexionId: string;
  sellerId: string;
  alias: string | null;
}): Promise<boolean> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema("identidad")
    .from("conexiones_seller_ml")
    .update({ alias: entrada.alias })
    .eq("id", entrada.conexionId)
    .eq("seller_id", entrada.sellerId)
    .select("id");

  if (error) throw new Error(`No se pudo renombrar la conexión ML: ${error.message}`);
  return ((data ?? []) as unknown[]).length > 0;
}

/**
 * Estado agregado de la conexión ML de un seller, tolerante a 1:N. Devuelve la
 * conexión "más saludable" (una sana antes que una que requiere atención antes
 * que una desvinculada) para el resumen simple del portal/dashboard que aún no
 * distingue cuentas. Cuando la UI multicuenta exista, debe migrar a
 * `obtenerConexionesPorSeller` (plural) y mostrar cada una.
 *
 * Consciente de cuenta en el sentido mínimo exigido: NO lanza con 2+ filas.
 */
export async function obtenerConexionPorSeller(
  sellerId: string,
): Promise<ConexionSellerMl | null> {
  const conexiones = await obtenerConexionesPorSeller(sellerId);
  if (conexiones.length === 0) return null;
  return conexiones.reduce((mejor, actual) =>
    prioridadSalud(actual.estadoSalud) < prioridadSalud(mejor.estadoSalud) ? actual : mejor,
  );
}

/** Menor número = "más saludable". Orden para elegir la conexión representativa. */
function prioridadSalud(estado: EstadoSaludConexionMl): number {
  switch (estado) {
    case "sana":
      return 0;
    case "pendiente":
      return 1;
    case "atencion":
      return 2;
    case "desvinculada":
      return 3;
    default:
      return 4;
  }
}

/**
 * Resumen agregado de salud de las conexiones ML de UN TENANT (todos sus
 * sellers, todas sus cuentas 1:N) — lector MÍNIMO nuevo para el drill-down
 * por-tenant del backstage `/admin` (gap 9, `plataforma/observabilidad-tenant.ts`).
 * NO toca ni reimplementa el sondeo (`jobs/sondeo-salud.ts`, Job 2): ese sigue
 * siendo la única fuente que ESCRIBE `estado_salud`; esto solo LEE y agrupa lo
 * que el sondeo ya dejó persistido. Trae exclusivamente `estado_salud` (sin
 * `seller_id`, alias, tokens ni nada identificable) — el backstage ve salud
 * técnica agregada del tenant, nunca el detalle operativo de sus sellers.
 */
export async function obtenerResumenSaludMlPorTenant(
  tenantId: string,
): Promise<ResumenSaludMlTenant> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema("identidad")
    .from("conexiones_seller_ml")
    .select("estado_salud")
    .eq("tenant_id", tenantId);

  if (error) {
    throw new Error(`No se pudo leer el resumen de salud ML del tenant: ${error.message}`);
  }

  const resumen: ResumenSaludMlTenant = {
    sanas: 0,
    atencion: 0,
    desvinculadas: 0,
    pendientes: 0,
    total: 0,
  };

  for (const fila of (data ?? []) as { estado_salud: EstadoSaludConexionMl }[]) {
    resumen.total += 1;
    switch (fila.estado_salud) {
      case "sana":
        resumen.sanas += 1;
        break;
      case "atencion":
        resumen.atencion += 1;
        break;
      case "desvinculada":
        resumen.desvinculadas += 1;
        break;
      case "pendiente":
        resumen.pendientes += 1;
        break;
    }
  }

  return resumen;
}

// ---------------------------------------------------------------------------
// 5. Etiquetas de envío (RF-021) — descarga el PDF de `shipment_labels`.
//
// VERIFICACIÓN CONTRA DOCUMENTACIÓN OFICIAL VIGENTE (lo volátil):
// Fuente: developers.mercadolibre.com — "Mercado Envíos / shipment_labels"
// (consultada en esta iteración):
// - Endpoint: `GET /shipment_labels?shipment_ids={id1},{id2}&response_type=pdf`
//   (host `https://api.mercadolibre.com`, igual que el resto del adaptador).
// - `shipment_ids` admite múltiples IDs separados por coma — este puerto solo
//   expone un `shipment_id` a la vez (RF-021 pide etiqueta individual), pero
//   la ruta queda lista para extenderse a lote si se necesita.
// - `response_type=pdf` (alternativa `zpl2`, devuelve un .zip con PDF + .txt
//   para impresora Zebra) — usamos `pdf` porque es lo que RF-021 requiere.
// - Respuesta: binario `application/pdf` (no JSON) — requiere
//   `Authorization: Bearer {access_token}`. Por eso se usa `peticionBinariaMl`
//   en vez de `peticionMl`.
// - Re-confirmar antes de producción: la skill flex-ml exige reverificar
//   "lo volátil" (endpoints, formatos) cada vez que se toque este puerto.
// ---------------------------------------------------------------------------

/**
 * Margen de seguridad antes de que expire el access_token: si vence en menos
 * de este margen (o ya venció), se refresca proactivamente en vez de esperar
 * a que ML responda 401. Evita una ida y vuelta extra con ML en el caso común.
 */
const MARGEN_REFRESCO_PROACTIVO_MS = 5 * 60_000;

/**
 * Obtiene un `access_token` vigente para el seller, refrescándolo primero si
 * está vencido o a punto de vencer (margen de 5 minutos).
 *
 * SOLO para uso inmediato dentro de la misma operación que lo solicita —
 * NUNCA se debe propagar el valor de retorno hacia capas superiores, logs,
 * bitácora ni respuestas HTTP (regla dura del proyecto: secretos nunca en
 * claro fuera de este adaptador).
 *
 * Lanza `ErrorConexionMlRequiereRevinculacion` si el refresco determina que
 * el seller debe reconectar su cuenta — el llamador debe distinguir este caso
 * (skill flex-ml: "lo resolví con refresco" vs. "requiere re-vinculación").
 *
 * Consciente de cuenta (modelo 1:N): si se pasa `mlUserId`, resuelve la
 * conexión por `(seller_id, ml_user_id)` — el token correcto para un envío de
 * ESA cuenta. Sin `mlUserId` (pedido legacy o seller de una sola cuenta) cae a
 * la conexión representativa del seller.
 */
export async function obtenerAccessTokenValido(
  sellerId: string,
  mlUserId?: string | null,
): Promise<string> {
  let conexion = mlUserId
    ? await leerFilaConexionPorSellerYCuenta(sellerId, mlUserId)
    : await leerFilaConexionRepresentativaPorSeller(sellerId);
  if (!conexion) {
    throw new Error(
      mlUserId
        ? `No existe conexión ML para el seller ${sellerId} y cuenta ${mlUserId}.`
        : `No existe conexión ML para el seller ${sellerId}.`,
    );
  }

  if (conexion.estado_salud === "desvinculada") {
    throw new ErrorConexionMlRequiereRevinculacion(sellerId, conexion.id);
  }

  const expiraEn = conexion.token_expira_en ? new Date(conexion.token_expira_en) : null;
  const necesitaRefresco =
    !conexion.access_token_ref ||
    !expiraEn ||
    expiraEn.getTime() - Date.now() < MARGEN_REFRESCO_PROACTIVO_MS;

  if (necesitaRefresco) {
    const resultado = await refrescarToken({ conexionId: conexion.id });
    if (resultado.resultado === "requiere_revinculacion") {
      throw new ErrorConexionMlRequiereRevinculacion(sellerId, conexion.id);
    }

    // Releer la fila tras el refresco para obtener el `access_token_ref`
    // recién persistido (refrescarToken devuelve `ConexionSellerMl`, que NO
    // expone `*_ref` deliberadamente — ver tipos.ts).
    const recargada = await leerFilaConexionPorId(conexion.id);
    if (!recargada || !recargada.access_token_ref) {
      throw new Error(
        `La conexión ML ${conexion.id} quedó sin access_token_ref tras refrescar.`,
      );
    }
    conexion = recargada;
  }

  if (!conexion.access_token_ref) {
    throw new Error(`La conexión ML ${conexion.id} no tiene access_token_ref.`);
  }

  const descifrado = await descifrarSecreto(conexion.access_token_ref);
  if (typeof descifrado.valor !== "string") {
    throw new Error("El access_token descifrado no tiene el formato esperado (texto).");
  }

  // El valor en claro vive solo en esta variable local; el llamador inmediato
  // (obtenerEtiquetaEnvio) lo usa para construir el header Authorization y lo
  // descarta — nunca se reasigna a estructuras de mayor vida ni se loguea.
  return descifrado.valor;
}

/**
 * Descarga la etiqueta de envío (PDF) para un `shipment_id` de Mercado Libre,
 * usando el access_token vigente del seller (refrescando si es necesario).
 *
 * Resiliencia: `peticionBinariaMl` reutiliza `reintentarConBackoff` — 429/5xx
 * de ML se reintentan con backoff respetando `Retry-After`; 4xx definitivos
 * (token inválido, shipment no encontrado) se propagan como `ErrorHttpMl` no
 * reintentable.
 */
export async function obtenerEtiquetaEnvio(
  entrada: ObtenerEtiquetaEnvioEntrada,
): Promise<ObtenerEtiquetaEnvioResultado> {
  const accessToken = await obtenerAccessTokenValido(entrada.sellerId, entrada.mlUserId ?? null);

  const parametros = new URLSearchParams({
    shipment_ids: entrada.mlShipmentId,
    response_type: "pdf",
  });

  const respuesta = await peticionBinariaMl({
    metodo: "GET",
    ruta: `/shipment_labels?${parametros.toString()}`,
    accessToken,
    accept: "application/pdf",
  });

  return { contenido: respuesta.contenido, contentType: respuesta.contentType };
}

// ---------------------------------------------------------------------------
// Helpers internos de persistencia — todos vía service_role (la escritura de
// tokens/salud está reservada a roles internos/jobs, nunca al seller, según
// §8.2 y el trigger `solo_interno_edita`).
// ---------------------------------------------------------------------------

/** Forma cruda de la fila tal como vuelve de Postgres (snake_case + refs). */
interface FilaConexionInterna {
  id: string;
  tenant_id: string;
  seller_id: string;
  ml_user_id: string | null;
  access_token_ref: string | null;
  refresh_token_ref: string | null;
  token_expira_en: string | null;
  estado_salud: EstadoSaludConexionMl;
  ultima_sync_exitosa_en: string | null;
  desconectada_desde: string | null;
  ultimo_error: string | null;
  alias: string | null;
  ml_nickname: string | null;
}

const COLUMNAS_CONEXION =
  "id, tenant_id, seller_id, ml_user_id, access_token_ref, refresh_token_ref, " +
  "token_expira_en, estado_salud, ultima_sync_exitosa_en, desconectada_desde, ultimo_error, " +
  "alias, ml_nickname";

function aConexionPublica(fila: FilaConexionInterna): ConexionSellerMl {
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    sellerId: fila.seller_id,
    mlUserId: fila.ml_user_id,
    tokenExpiraEn: fila.token_expira_en ? new Date(fila.token_expira_en) : null,
    estadoSalud: fila.estado_salud,
    ultimaSyncExitosaEn: fila.ultima_sync_exitosa_en ? new Date(fila.ultima_sync_exitosa_en) : null,
    desconectadaDesde: fila.desconectada_desde ? new Date(fila.desconectada_desde) : null,
    ultimoError: fila.ultimo_error,
    alias: fila.alias,
    mlNickname: fila.ml_nickname,
  };
}

async function leerFilaConexionPorId(conexionId: string): Promise<FilaConexionInterna | null> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema("identidad")
    .from("conexiones_seller_ml")
    .select(COLUMNAS_CONEXION)
    .eq("id", conexionId)
    .maybeSingle();

  if (error) throw new Error(`No se pudo leer la conexión ML: ${error.message}`);
  return (data as unknown as FilaConexionInterna | null) ?? null;
}

/**
 * Lee la fila cruda (con `*_ref`) de una conexión por `(seller_id, ml_user_id)`
 * — la clave de resolución del modelo 1:N. `maybeSingle()` es seguro aquí: el
 * índice único parcial `(seller_id, ml_user_id) where ml_user_id is not null`
 * garantiza a lo sumo una fila.
 */
async function leerFilaConexionPorSellerYCuenta(
  sellerId: string,
  mlUserId: string,
): Promise<FilaConexionInterna | null> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema("identidad")
    .from("conexiones_seller_ml")
    .select(COLUMNAS_CONEXION)
    .eq("seller_id", sellerId)
    .eq("ml_user_id", mlUserId)
    .maybeSingle();

  if (error) throw new Error(`No se pudo leer la conexión ML: ${error.message}`);
  return (data as unknown as FilaConexionInterna | null) ?? null;
}

/**
 * Fila cruda de la conexión "representativa" del seller cuando NO se conoce la
 * cuenta (pedido legacy sin `ml_user_id`, o seller de una sola cuenta). Bajo
 * 1:N puede haber varias filas → NUNCA `.maybeSingle()` (erraría con 2+).
 * Se leen todas y se elige la más saludable (misma prioridad que la vista
 * pública), de modo determinista.
 */
async function leerFilaConexionRepresentativaPorSeller(
  sellerId: string,
): Promise<FilaConexionInterna | null> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema("identidad")
    .from("conexiones_seller_ml")
    .select(COLUMNAS_CONEXION)
    .eq("seller_id", sellerId);

  if (error) throw new Error(`No se pudo leer la conexión ML: ${error.message}`);

  const filas = (data ?? []) as unknown as FilaConexionInterna[];
  if (filas.length === 0) return null;
  return filas.reduce((mejor, actual) =>
    prioridadSalud(actual.estado_salud) < prioridadSalud(mejor.estado_salud) ? actual : mejor,
  );
}

interface PersistirTokensEntrada {
  tenantId: string;
  sellerId: string;
  respuestaToken: RespuestaTokenMl;
  estadoSaludResultante: EstadoSaludConexionMl;
  ultimoError: string | null;
  /** `true` en el intercambio inicial (primera sync exitosa); `false` en refrescos. */
  marcarComoSincronizada: boolean;
  /**
   * Nickname de la cuenta en ML (de `/users/me`). Solo se pasa en el intercambio
   * inicial; en refrescos se omite (`undefined`) para NO re-consultar ML ni pisar
   * el valor existente. `null` = se intentó y no vino; `undefined` = no tocar.
   */
  mlNickname?: string | null;
}

/**
 * Persiste los tokens (cifrados) de UNA cuenta ML del seller. Modelo 1:N: la
 * fila se resuelve por `(seller_id, ml_user_id)` — `ml_user_id` SIEMPRE se
 * conoce aquí (viene de `respuestaToken.user_id`, sea intercambio inicial o
 * refresco).
 *
 * Por qué NO `upsert(..., { onConflict })`: supabase-js/PostgREST no puede
 * inferir un árbitro ON CONFLICT sobre un índice único PARCIAL (el índice
 * `(seller_id, ml_user_id) where ml_user_id is not null`), así que se usa
 * lógica explícita:
 *   1. SELECT por `(seller_id, ml_user_id)`.
 *   2. Si existe → UPDATE por `id` (idempotente, rota tokens sin duplicar).
 *   3. Si no → INSERT. El trigger de tope (SQLSTATE 23514) y la unicidad
 *      parcial (23505) del esquema garantizan la integridad; se traducen a
 *      errores de dominio claros.
 *
 * Nunca persiste el token en claro en ninguna columna de negocio — solo las
 * referencias opacas que `cifrarSecreto` devuelve.
 */
async function persistirTokensYActualizarConexion(
  entrada: PersistirTokensEntrada,
): Promise<ConexionSellerMl> {
  const ahora = new Date();
  const mlUserId = String(entrada.respuestaToken.user_id);
  const tokenExpiraEn = new Date(ahora.getTime() + entrada.respuestaToken.expires_in * 1000);

  const accessTokenRef = await cifrarSecreto({
    tenantId: entrada.tenantId,
    tipoSecreto: "token_oauth_ml_access",
    valor: entrada.respuestaToken.access_token,
    venceEn: tokenExpiraEn,
    metadata: { proposito: "oauth_ml_access_token" },
  });

  let refreshTokenRef: ReferenciaSecreto | null = null;
  if (entrada.respuestaToken.refresh_token) {
    const cifrado = await cifrarSecreto({
      tenantId: entrada.tenantId,
      tipoSecreto: "token_oauth_ml_refresh",
      // ML no documenta vencimiento del refresh_token (vive mientras no se
      // use/revoque) — no inventamos una fecha; `venceEn: null` es honesto.
      valor: entrada.respuestaToken.refresh_token,
      venceEn: null,
      metadata: { proposito: "oauth_ml_refresh_token" },
    });
    refreshTokenRef = cifrado.referenciaExternaId;
  }

  const supabase = crearClienteServiceRole();

  // Campos comunes a INSERT y UPDATE. `desconectada_desde` solo se toca si la
  // conexión queda 'sana' (limpiar la marca de caída); en otro caso se omite
  // para no pisar la marca original.
  const campos: Record<string, unknown> = {
    access_token_ref: accessTokenRef.referenciaExternaId,
    token_expira_en: tokenExpiraEn.toISOString(),
    estado_salud: entrada.estadoSaludResultante,
    ultimo_error: entrada.ultimoError,
  };
  if (refreshTokenRef) {
    campos.refresh_token_ref = refreshTokenRef;
  }
  if (entrada.estadoSaludResultante === "sana") {
    campos.desconectada_desde = null;
  }
  if (entrada.marcarComoSincronizada) {
    campos.ultima_sync_exitosa_en = ahora.toISOString();
  }
  // Solo si se pasó explícitamente (intercambio inicial). En refrescos queda
  // `undefined` → no se toca el nickname ya guardado.
  if (entrada.mlNickname !== undefined) {
    campos.ml_nickname = entrada.mlNickname;
  }

  // 1. ¿Ya existe la fila de esta cuenta para este seller?
  const existente = await leerFilaConexionPorSellerYCuenta(entrada.sellerId, mlUserId);

  if (existente) {
    // 2. UPDATE por id — rota tokens/actualiza salud sin duplicar fila.
    const { data, error } = await supabase
      .schema("identidad")
      .from("conexiones_seller_ml")
      .update(campos)
      .eq("id", existente.id)
      .select(COLUMNAS_CONEXION)
      .single();

    if (error) {
      throw new Error(`No se pudo actualizar la conexión ML: ${error.message}`);
    }
    return aConexionPublica(data as unknown as FilaConexionInterna);
  }

  // 3. INSERT — nueva cuenta. El trigger de tope y la unicidad parcial son la
  //    barrera dura; traducimos sus SQLSTATE a errores de dominio.
  const filaInsert: Record<string, unknown> = {
    ...campos,
    tenant_id: entrada.tenantId,
    seller_id: entrada.sellerId,
    ml_user_id: mlUserId,
  };

  const { data, error } = await supabase
    .schema("identidad")
    .from("conexiones_seller_ml")
    .insert(filaInsert)
    .select(COLUMNAS_CONEXION)
    .single();

  if (error) {
    // 23514 (check_violation): trigger de tope → el seller ya tiene el máximo.
    if (error.code === "23514") {
      throw new ErrorTopeCuentasMlAlcanzado(entrada.sellerId);
    }
    // 23505 (unique_violation): dos altas concurrentes de la MISMA cuenta
    // (carrera contra el paso 1) — el índice parcial la rechazó. Es idempotente
    // en la práctica: leemos y devolvemos la fila ganadora.
    if (error.code === "23505") {
      const ganadora = await leerFilaConexionPorSellerYCuenta(entrada.sellerId, mlUserId);
      if (ganadora) return aConexionPublica(ganadora);
      throw new ErrorCuentaMlYaConectada(entrada.sellerId, mlUserId);
    }
    throw new Error(`No se pudo persistir la conexión ML: ${error.message}`);
  }

  return aConexionPublica(data as unknown as FilaConexionInterna);
}

/**
 * Persiste `estado_salud='desvinculada'` + `desconectada_desde` (si aún no
 * estaba marcada — no pisar la marca original con reintentos) + un
 * `ultimo_error` corto y SIN datos sensibles (texto fijo, nunca el cuerpo
 * crudo del error de ML, que podría incluir fragmentos del token o del code).
 */
async function marcarRequiereRevinculacionSync(
  conexion: FilaConexionInterna,
  motivo: string,
): Promise<ConexionSellerMl> {
  const ahora = new Date();
  const supabase = crearClienteServiceRole();

  const { data, error } = await supabase
    .schema("identidad")
    .from("conexiones_seller_ml")
    .update({
      estado_salud: "desvinculada",
      ultimo_error: motivo,
      desconectada_desde: conexion.desconectada_desde ?? ahora.toISOString(),
    })
    .eq("id", conexion.id)
    .select(COLUMNAS_CONEXION)
    .single();

  if (error) {
    throw new Error(`No se pudo actualizar la conexión a 'desvinculada': ${error.message}`);
  }

  return aConexionPublica(data as unknown as FilaConexionInterna);
}
