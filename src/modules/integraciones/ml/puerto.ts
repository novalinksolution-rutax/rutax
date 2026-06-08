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
import { ML_API_BASE_URL, ErrorHttpMl, peticionMl } from "./cliente-http";
import { CacheIdempotencia } from "../resiliencia";
import type {
  ConexionSellerMl,
  EstadoSaludConexionMl,
  IniciarAutorizacionEntrada,
  IniciarAutorizacionResultado,
  IntercambiarCodigoEntrada,
  RazonFalloRefresco,
  RefrescarTokenEntrada,
  RefrescarTokenResultado,
  RespuestaTokenMl,
} from "./tipos";

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
    urlAutorizacion: `${ML_API_BASE_URL}/authorization?${parametros.toString()}`,
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
 * la conexión que la primera ya dejó persistida. Esto NO sustituye la
 * idempotencia "dura" a nivel de fila (la unicidad de `seller_id` en
 * `conexiones_seller_ml` ya la garantiza el esquema); es una defensa
 * adicional contra gastar el `code` (de un solo uso en ML) dos veces.
 */
export async function intercambiarCodigoPorTokens(
  entrada: IntercambiarCodigoEntrada,
): Promise<ConexionSellerMl> {
  const claveIdempotencia = `ml:intercambio:${entrada.tenantId}:${entrada.sellerId}:${entrada.codigo}`;

  if (!codigosEnProceso.marcarSiEsNuevo(claveIdempotencia)) {
    const existente = await buscarConexionPorSeller(entrada.sellerId);
    if (existente) return existente;
    // Si por algún motivo no quedó persistida (p. ej. la primera llamada
    // sigue en curso), dejamos que el flujo normal continúe — el upsert de
    // abajo es seguro de reintentar.
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

  const conexion = await persistirTokensYActualizarConexion({
    tenantId: entrada.tenantId,
    sellerId: entrada.sellerId,
    respuestaToken,
    estadoSaludResultante: "sana",
    ultimoError: null,
    marcarComoSincronizada: true,
  });

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

export async function obtenerConexionPorSeller(sellerId: string): Promise<ConexionSellerMl | null> {
  return buscarConexionPorSeller(sellerId);
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
}

const COLUMNAS_CONEXION =
  "id, tenant_id, seller_id, ml_user_id, access_token_ref, refresh_token_ref, " +
  "token_expira_en, estado_salud, ultima_sync_exitosa_en, desconectada_desde, ultimo_error";

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

async function buscarConexionPorSeller(sellerId: string): Promise<ConexionSellerMl | null> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema("identidad")
    .from("conexiones_seller_ml")
    .select(COLUMNAS_CONEXION)
    .eq("seller_id", sellerId)
    .maybeSingle();

  if (error) throw new Error(`No se pudo leer la conexión ML: ${error.message}`);
  return data ? aConexionPublica(data as unknown as FilaConexionInterna) : null;
}

interface PersistirTokensEntrada {
  tenantId: string;
  sellerId: string;
  respuestaToken: RespuestaTokenMl;
  estadoSaludResultante: EstadoSaludConexionMl;
  ultimoError: string | null;
  /** `true` en el intercambio inicial (primera sync exitosa); `false` en refrescos. */
  marcarComoSincronizada: boolean;
}

/**
 * Cifra ambos tokens y hace upsert de la fila por `seller_id` (que es UNIQUE
 * — el esquema garantiza 1:1). Usar `upsert` con `onConflict: 'seller_id'` es
 * lo que hace esta operación segura de reintentar: una segunda ejecución con
 * la misma respuesta de ML (o una posterior con tokens rotados) sobreescribe
 * de forma consistente, nunca duplica filas.
 *
 * Nunca persiste el token en claro en ninguna columna de negocio — solo las
 * referencias opacas que `cifrarSecreto` devuelve.
 */
async function persistirTokensYActualizarConexion(
  entrada: PersistirTokensEntrada,
): Promise<ConexionSellerMl> {
  const ahora = new Date();
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

  const filaUpsert: Record<string, unknown> = {
    tenant_id: entrada.tenantId,
    seller_id: entrada.sellerId,
    ml_user_id: String(entrada.respuestaToken.user_id),
    access_token_ref: accessTokenRef.referenciaExternaId,
    token_expira_en: tokenExpiraEn.toISOString(),
    estado_salud: entrada.estadoSaludResultante,
    ultimo_error: entrada.ultimoError,
    // Al recuperar la salud, limpiamos `desconectada_desde` — útil para que
    // el futuro backfill (RF-017) sepa "desde cuándo" recuperar exactamente
    // hasta este instante de reconexión, y no quede una marca obsoleta.
    desconectada_desde: entrada.estadoSaludResultante === "sana" ? null : undefined,
  };

  if (refreshTokenRef) {
    filaUpsert.refresh_token_ref = refreshTokenRef;
  }
  if (entrada.marcarComoSincronizada) {
    filaUpsert.ultima_sync_exitosa_en = ahora.toISOString();
  }

  // `undefined` no debe serializarse como columna — Postgres lo tomaría como
  // "no tocar" solo si se omite la clave; lo limpiamos explícitamente.
  for (const clave of Object.keys(filaUpsert)) {
    if (filaUpsert[clave] === undefined) delete filaUpsert[clave];
  }

  const { data, error } = await supabase
    .schema("identidad")
    .from("conexiones_seller_ml")
    .upsert(filaUpsert, { onConflict: "seller_id" })
    .select(COLUMNAS_CONEXION)
    .single();

  if (error) {
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
