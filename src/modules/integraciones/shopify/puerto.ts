/**
 * Puerto de Shopify — conexión de la tienda de un seller y acceso a su token.
 *
 * Es el equivalente de `../ml/puerto.ts`, pero mucho más chico, y la razón es
 * que **no hay OAuth**. El seller crea una app en el **Dev Dashboard** de
 * Shopify, la instala en su propia tienda y pega en el portal de Rutax su
 * Client ID y su Client secret. Rutax los canjea por un token de 24 h cuando lo
 * necesita (client credentials grant, ver `canjearCredencialesApp`): no hay
 * refresh token que rotar ni callback que atender.
 *
 * ⚠️ Hasta septiembre de 2026 esto pedía el `shpat_…` de una *custom app*
 * creada en el admin. Shopify dejó de permitir crear esas apps el 1 de enero de
 * 2026, así que el formulario le pedía al seller algo que ya no podía
 * conseguir. Las conexiones con un `shpat_` guardado (`token_admin_shopify`)
 * siguen andando; toda conexión nueva guarda credenciales
 * (`credencial_app_shopify`).
 *
 * Lo que sí se conserva del molde de ML, porque son reglas del proyecto y no
 * detalles de Mercado Libre:
 *  - el token se cifra con `secretos/cifrado` y la tabla de negocio guarda solo
 *    la referencia opaca;
 *  - `aConexionPublica` nunca deja escapar `token_ref` hacia una capa que
 *    pudiera serializarlo;
 *  - toda escritura va por `service_role`, no por la sesión del usuario.
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { cifrarSecreto, descifrarSecreto, olvidarSecreto } from "../secretos/cifrado";
import {
  peticionShopify,
  canjearCredencialesApp,
  normalizarShopDomain,
  ErrorShopDomainInvalido,
  ErrorHttpShopify,
  type TokenCanjeado,
} from "./cliente-http";
import { SCOPES_REQUERIDOS, type ConexionShopify, type EstadoSaludShopify } from "./tipos";

// =============================================================================
// Errores de dominio
// =============================================================================

export class ErrorCredencialShopifyInvalida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorCredencialShopifyInvalida";
  }
}

export class ErrorScopesShopifyFaltantes extends Error {
  readonly faltantes: string[];
  constructor(faltantes: string[]) {
    super(`A la app de Shopify le faltan permisos: ${faltantes.join(", ")}.`);
    this.name = "ErrorScopesShopifyFaltantes";
    this.faltantes = faltantes;
  }
}

export class ErrorTiendaShopifyYaConectada extends Error {
  constructor(shopDomain: string) {
    super(`La tienda ${shopDomain} ya está conectada a este courier.`);
    this.name = "ErrorTiendaShopifyYaConectada";
  }
}

// =============================================================================
// Validación de la credencial — ANTES de guardarla
// =============================================================================

const CONSULTA_VALIDACION = `
  query ValidarCredencial {
    shop { name myshopifyDomain }
    currentAppInstallation { accessScopes { handle } }
  }
`;

interface RespuestaValidacion {
  shop: { name: string; myshopifyDomain: string };
  currentAppInstallation: { accessScopes: Array<{ handle: string }> } | null;
}

/** Lo que el seller copia de su app en el Dev Dashboard. */
export interface CredencialAppShopify {
  clientId: string;
  clientSecret: string;
}

/**
 * Canjea las credenciales y traduce el rechazo a algo que el seller entienda.
 *
 * Un 4xx del canje significa lo mismo para quien mira la pantalla: copió mal
 * alguno de los dos valores, o la app no está instalada en ESA tienda (el
 * canje exige que lo esté). El detalle crudo queda en el log del servidor; el
 * cuerpo es la respuesta de Shopify, que no contiene el secreto.
 */
async function canjear(shopDomain: string, credencial: CredencialAppShopify): Promise<TokenCanjeado> {
  try {
    return await canjearCredencialesApp({
      shopDomain,
      clientId: credencial.clientId.trim(),
      clientSecret: credencial.clientSecret.trim(),
      opcionesReintento: { maxIntentos: 2 },
    });
  } catch (error) {
    console.error(
      "[shopify/canjear]",
      shopDomain,
      error instanceof ErrorHttpShopify ? `${error.status} ${JSON.stringify(error.cuerpo)}` : error,
    );
    if (error instanceof ErrorHttpShopify && error.status >= 400 && error.status < 500) {
      throw new ErrorCredencialShopifyInvalida(
        "Shopify no aceptó esas credenciales. Revisa el ID de cliente y el Secreto del cliente, y que la app esté instalada en esta tienda.",
      );
    }
    throw new ErrorCredencialShopifyInvalida(
      "No se pudo conectar con la tienda. Inténtalo de nuevo en unos minutos.",
    );
  }
}

export interface CredencialValidada {
  shopDomain: string;
  nombreTienda: string;
  scopesOtorgados: string[];
}

/**
 * Comprueba contra Shopify que el par (dominio, token) sirve y trae los permisos
 * necesarios. Se llama en la Server Action de conexión, **antes** de escribir
 * nada.
 *
 * Por qué acá y no en el primer cron: el seller acaba de pegar dos valores en un
 * formulario y está mirando la pantalla. Si el token está mal, o si al crear la
 * custom app olvidó marcar un permiso —que es el paso frágil de todo este
 * flujo—, tiene que enterarse en ese segundo y no doce horas después cuando un
 * job falle en silencio y sus pedidos simplemente no aparezcan.
 */
export async function validarCredencial(
  shopDomainCrudo: string,
  credencial: CredencialAppShopify,
): Promise<CredencialValidada> {
  const shopDomain = normalizarShopDomain(shopDomainCrudo);
  if (!shopDomain) throw new ErrorShopDomainInvalido(shopDomainCrudo);

  const { accessToken } = await canjear(shopDomain, credencial);

  let data: RespuestaValidacion;
  try {
    data = await peticionShopify<RespuestaValidacion>({
      shopDomain,
      accessToken,
      consulta: CONSULTA_VALIDACION,
    });
  } catch (error) {
    // El detalle crudo de Shopify no se propaga al seller: puede traer jerga de
    // GraphQL que no le dice nada. Queda en el log del servidor.
    console.error("[shopify/validarCredencial]", error instanceof Error ? error.message : error);
    throw new ErrorCredencialShopifyInvalida(
      "No se pudo conectar con la tienda. Revisa el dominio y las credenciales.",
    );
  }

  const otorgados = (data.currentAppInstallation?.accessScopes ?? []).map((s) => s.handle);
  const faltantes = SCOPES_REQUERIDOS.filter((s) => !otorgados.includes(s));
  if (faltantes.length > 0) throw new ErrorScopesShopifyFaltantes(faltantes);

  return {
    // El dominio autoritativo lo dice Shopify, no el formulario: si el seller
    // pegó un alias o un dominio propio, esto lo corrige a la forma canónica y
    // evita dos filas para la misma tienda.
    shopDomain: data.shop.myshopifyDomain.toLowerCase(),
    nombreTienda: data.shop.name,
    scopesOtorgados: otorgados,
  };
}

// =============================================================================
// Persistencia
// =============================================================================

const TABLA = "conexiones_seller_shopify";
const COLUMNAS_PUBLICAS =
  "id, tenant_id, seller_id, shop_domain, scopes_otorgados, filtro_etiqueta, estado_salud, " +
  "ultima_sync_exitosa_en, ultimo_error, alias, nombre_tienda, activa, desconectada_por_usuario_id, creado_en";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function aConexionPublica(fila: Record<string, any>): ConexionShopify {
  return {
    id: fila.id,
    tenantId: fila.tenant_id,
    sellerId: fila.seller_id,
    shopDomain: fila.shop_domain,
    // Se expone la REFERENCIA, jamás el valor, y solo cuando el llamador la
    // seleccionó explícitamente: `COLUMNAS_PUBLICAS` no la incluye.
    tokenRef: fila.token_ref ?? null,
    scopesOtorgados: (fila.scopes_otorgados as string[] | null) ?? [],
    filtroEtiqueta: fila.filtro_etiqueta ?? null,
    estadoSalud: (fila.estado_salud ?? "pendiente") as EstadoSaludShopify,
    ultimaSyncExitosaEn: fila.ultima_sync_exitosa_en ?? null,
    ultimoError: fila.ultimo_error ?? null,
    alias: fila.alias ?? null,
    nombreTienda: fila.nombre_tienda ?? null,
    activa: fila.activa ?? true,
    // El id se lee acá y muere acá: hacia afuera sale solo el sí/no.
    desconectadaPorPersona: fila.desconectada_por_usuario_id != null,
    creadoEn: fila.creado_en,
  };
}

export interface ConectarTiendaEntrada {
  tenantId: string;
  sellerId: string;
  shopDomain: string;
  credencial: CredencialAppShopify;
  filtroEtiqueta?: string | null;
  alias?: string | null;
}

/**
 * Valida la credencial, la cifra y deja la conexión lista para el primer barrido.
 *
 * Nace `activa` y con salud `sana`: la validación que acabamos de hacer ES la
 * prueba de que la conexión funciona, y arrancar en `pendiente` mostraría al
 * seller un estado de incertidumbre que ya resolvimos.
 */
export async function conectarTienda(entrada: ConectarTiendaEntrada): Promise<ConexionShopify> {
  const validada = await validarCredencial(entrada.shopDomain, entrada.credencial);
  const supabase = crearClienteServiceRole();

  const { data: yaExiste } = await supabase
    .schema("identidad")
    .from(TABLA)
    .select("id")
    .eq("tenant_id", entrada.tenantId)
    .eq("shop_domain", validada.shopDomain)
    .maybeSingle();

  if (yaExiste) throw new ErrorTiendaShopifyYaConectada(validada.shopDomain);

  // El secreto se cifra ANTES del INSERT: si el cifrado falla, no queda una fila
  // de conexión huérfana apuntando a un token que no existe.
  const { referenciaExternaId } = await cifrarSecreto({
    tenantId: entrada.tenantId,
    tipoSecreto: "credencial_app_shopify",
    valor: serializarCredencial(entrada.credencial),
    venceEn: null,
    metadata: { shopDomain: validada.shopDomain },
  });

  const { data, error } = await supabase
    .schema("identidad")
    .from(TABLA)
    .insert({
      tenant_id: entrada.tenantId,
      seller_id: entrada.sellerId,
      shop_domain: validada.shopDomain,
      token_ref: referenciaExternaId,
      scopes_otorgados: validada.scopesOtorgados,
      filtro_etiqueta: entrada.filtroEtiqueta?.trim() || null,
      alias: entrada.alias?.trim() || null,
      nombre_tienda: validada.nombreTienda,
      estado_salud: "sana",
      activa: true,
    })
    .select(COLUMNAS_PUBLICAS)
    .single();

  if (error) {
    // 23505 = carrera contra otra pestaña del mismo seller conectando a la vez.
    if (error.code === "23505") throw new ErrorTiendaShopifyYaConectada(validada.shopDomain);
    throw new Error(`No se pudo guardar la conexión con Shopify: ${error.message}`);
  }

  return aConexionPublica(data);
}

/**
 * Repone el token de una tienda YA conectada — el equivalente del modo
 * `reconexion` del OAuth de ML.
 *
 * Es un UPDATE y no un INSERT, y no es un detalle de estilo: la unicidad
 * `(tenant_id, shop_domain)` **no** es parcial por `activa`, así que una tienda
 * dada de baja sigue ocupando su lugar. Intentar reconectarla con un INSERT
 * choca con 23505. Además el UPDATE es lo correcto por sí mismo: conserva
 * `cursor_ingesta_en`, y con él la memoria de hasta dónde se había ingerido. Un
 * alta nueva empezaría el barrido desde cero y volvería a recorrer semanas.
 *
 * El token viejo NO se borra de `secretos_cifrados`: la referencia deja de
 * apuntarse desde la conexión y la limpieza de secretos huérfanos es un asunto
 * aparte, no algo que deba resolver un seller apretando "Reconectar".
 */
export async function reconectarTienda(entrada: {
  conexionId: string;
  tenantId: string;
  credencial: CredencialAppShopify;
}): Promise<ConexionShopify> {
  const supabase = crearClienteServiceRole();

  const { data: existente, error: errorLectura } = await supabase
    .schema("identidad")
    .from(TABLA)
    .select("id, shop_domain")
    .eq("id", entrada.conexionId)
    .eq("tenant_id", entrada.tenantId)
    .maybeSingle();

  if (errorLectura) throw new Error(`No se pudo leer la conexión: ${errorLectura.message}`);
  if (!existente) throw new ErrorCredencialShopifyInvalida("La conexión no existe.");

  // Se valida contra la tienda ANTES de escribir, igual que en el alta.
  const validada = await validarCredencial(existente.shop_domain as string, entrada.credencial);

  // Y se comprueba que el token nuevo sea DE ESA tienda: pegar por error el
  // token de otra tienda dejaría la conexión apuntando a un catálogo ajeno, con
  // los pedidos de un seller entrando como si fueran de otro.
  if (validada.shopDomain !== existente.shop_domain) {
    throw new ErrorCredencialShopifyInvalida(
      `Esa app pertenece a ${validada.shopDomain}, no a ${existente.shop_domain}.`,
    );
  }

  const { referenciaExternaId } = await cifrarSecreto({
    tenantId: entrada.tenantId,
    tipoSecreto: "credencial_app_shopify",
    valor: serializarCredencial(entrada.credencial),
    venceEn: null,
    metadata: { shopDomain: validada.shopDomain },
  });

  const { data, error } = await supabase
    .schema("identidad")
    .from(TABLA)
    .update({
      token_ref: referenciaExternaId,
      scopes_otorgados: validada.scopesOtorgados,
      nombre_tienda: validada.nombreTienda,
      estado_salud: "sana",
      ultimo_error: null,
      activa: true,
      // 🔴 Se limpia el autor: la tienda que vuelve con token nuevo ya no está
      // apagada. Dejarlo puesto la dejaría diciendo «Desconectada por ti»
      // mientras ingiere pedidos.
      desconectada_por_usuario_id: null,
      // `cursor_ingesta_en` NO viaja acá, a propósito: es la memoria de hasta
      // dónde se ingirió y una reconexión no la invalida.
    })
    .eq("id", entrada.conexionId)
    .eq("tenant_id", entrada.tenantId)
    .select(COLUMNAS_PUBLICAS)
    .single();

  if (error) throw new Error(`No se pudo reconectar la tienda: ${error.message}`);
  return aConexionPublica(data);
}

/**
 * Apaga la ingesta de UNA tienda Shopify.
 * =============================================================================
 *
 * Gemela de `desconectarConexionMlPropia` (portal/actions.ts), con la misma
 * frontera: desconectar significa **dejar de traer pedidos a Rutax**, y nada
 * más. NO desinstala la custom app del admin de Shopify ni le revoca nada —
 * eso el seller lo hace en su propia tienda, y la pantalla se lo dice.
 *
 * 🔴 EL ORDEN DE LAS ESCRITURAS (la bitácora la pone el llamador, antes)
 *  1. **La fila**: salud, `activa=false`, autor, y `token_ref` a `null`.
 *  2. **El secreto**, al final. Soltar la referencia ANTES de borrar es lo que
 *     evita la ventana en la que la conexión apunta a un secreto que ya no
 *     existe: ahí cualquier job que la lea falla al descifrar y la marca caída
 *     con un error que no significa nada.
 *
 * ⚠️ Si el paso 2 falla, la tienda **ya no ingiere** y eso es lo que se pidió:
 * no se propaga el error. Un secreto huérfano es basura, no un agujero — nadie
 * lo puede resolver porque su referencia ya no existe en ninguna fila.
 *
 * Se apagan las DOS banderas a propósito. `activa` es la que dice «apagada por
 * decisión» y `estado_salud` es la que ya entiende el resto del sistema (la
 * ingesta filtra por ambas); dejar una sola obligaría a recordar cuál manda.
 */
export async function desconectarTienda(entrada: {
  conexionId: string;
  tenantId: string;
  usuarioId: string;
}): Promise<void> {
  const supabase = crearClienteServiceRole();

  // La referencia al secreto se lee acá y no sale de esta función.
  const { data: fila } = await supabase
    .schema("identidad")
    .from(TABLA)
    .select("token_ref")
    .eq("id", entrada.conexionId)
    .eq("tenant_id", entrada.tenantId)
    .maybeSingle();

  const { error } = await supabase
    .schema("identidad")
    .from(TABLA)
    .update({
      estado_salud: "desvinculada",
      activa: false,
      desconectada_por_usuario_id: entrada.usuarioId,
      token_ref: null,
      // El error anterior deja de aplicar: la tienda no está rota, está apagada.
      ultimo_error: null,
    })
    .eq("id", entrada.conexionId)
    .eq("tenant_id", entrada.tenantId);

  if (error) throw new Error(`No se pudo desconectar la tienda: ${error.message}`);

  try {
    await olvidarSecreto((fila?.token_ref as string | null) ?? null, entrada.tenantId);
  } catch {
    // Silencio deliberado: ver el bloque de arriba.
  }
}

export async function obtenerConexionesPorSeller(
  tenantId: string,
  sellerId: string,
): Promise<ConexionShopify[]> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema("identidad")
    .from(TABLA)
    .select(COLUMNAS_PUBLICAS)
    .eq("tenant_id", tenantId)
    .eq("seller_id", sellerId)
    .order("creado_en", { ascending: true });

  if (error) throw new Error(`No se pudieron leer las conexiones de Shopify: ${error.message}`);
  return (data ?? []).map(aConexionPublica);
}

/**
 * Descifra el token de una conexión. **Solo para jobs del servidor.**
 *
 * Devuelve el valor en claro; el llamador es responsable de no loguearlo, no
 * meterlo en un payload de Inngest y no dejarlo en un objeto de error. Mismo
 * contrato que `descifrarSecreto` en el resto del proyecto.
 */
export async function obtenerAccessToken(conexionId: string, tenantId: string): Promise<string> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema("identidad")
    .from(TABLA)
    .select("token_ref, shop_domain, activa")
    .eq("id", conexionId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw new Error(`No se pudo leer la conexión de Shopify: ${error.message}`);
  if (!data?.token_ref) {
    throw new ErrorCredencialShopifyInvalida(
      `La conexión ${conexionId} no tiene token guardado — hay que reconectar la tienda.`,
    );
  }

  const tokenRef = data.token_ref as string;
  const enCache = TOKENS_CANJEADOS.get(tokenRef);
  if (enCache && enCache.expiraEn.getTime() - Date.now() > MARGEN_RENOVACION_MS) {
    return enCache.accessToken;
  }

  const { valor, tipoSecreto } = await descifrarSecreto(tokenRef);
  if (typeof valor !== "string") {
    throw new ErrorCredencialShopifyInvalida(
      "El token de Shopify se descifró como binario — revisa el tipo de secreto.",
    );
  }

  // Conexión anterior a 2026: el `shpat_` permanente se usa tal cual.
  if (tipoSecreto === "token_admin_shopify") return valor;

  const canjeado = await canjear(data.shop_domain as string, leerCredencial(valor));
  TOKENS_CANJEADOS.set(tokenRef, canjeado);
  return canjeado.accessToken;
}

/**
 * Tokens de 24 h ya canjeados, por referencia de secreto.
 *
 * Solo memoria del proceso: en serverless se pierde a menudo y no pasa nada,
 * porque el canje es una llamada barata. Lo que evita es canjear en CADA
 * petición de un mismo barrido. Va por `token_ref` y no por conexión: al
 * reconectar cambia la referencia y el token viejo queda inalcanzable solo.
 */
const TOKENS_CANJEADOS = new Map<string, TokenCanjeado>();
const MARGEN_RENOVACION_MS = 30 * 60 * 1000;

function serializarCredencial(c: CredencialAppShopify): string {
  return JSON.stringify({ clientId: c.clientId.trim(), clientSecret: c.clientSecret.trim() });
}

function leerCredencial(valor: string): CredencialAppShopify {
  try {
    const c = JSON.parse(valor) as Partial<CredencialAppShopify>;
    if (typeof c.clientId === "string" && typeof c.clientSecret === "string") {
      return { clientId: c.clientId, clientSecret: c.clientSecret };
    }
  } catch {
    // Cae al error de abajo, sin arrastrar el contenido.
  }
  throw new ErrorCredencialShopifyInvalida(
    "Las credenciales guardadas de la tienda están dañadas. Hay que reconectarla.",
  );
}

/**
 * Proyecta el resultado de un barrido sobre la salud de la conexión.
 *
 * `ultima_sync_exitosa_en` se toca SOLO cuando hubo éxito: es lo que el seller
 * mira para saber si su tienda está al día, y adelantarla tras un fallo le
 * mentiría. El cursor de ingesta vive en su propia columna y lo mueve el job,
 * nunca esta función.
 */
export async function marcarSalud(
  conexionId: string,
  tenantId: string,
  resultado: { ok: true } | { ok: false; error: string },
): Promise<void> {
  const supabase = crearClienteServiceRole();
  const parche: Record<string, unknown> = resultado.ok
    ? { estado_salud: "sana", ultima_sync_exitosa_en: new Date().toISOString(), ultimo_error: null }
    : { estado_salud: "atencion", ultimo_error: resultado.error.slice(0, 500) };

  const { error } = await supabase
    .schema("identidad")
    .from(TABLA)
    .update(parche)
    .eq("id", conexionId)
    .eq("tenant_id", tenantId);

  // Un fallo al anotar la salud no puede tumbar el barrido que sí funcionó.
  if (error) {
    console.error("[shopify/marcarSalud]", error.message);
  }
}
