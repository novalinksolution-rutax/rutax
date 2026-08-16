/**
 * Puerto de Shopify — conexión de la tienda de un seller y acceso a su token.
 *
 * Es el equivalente de `../ml/puerto.ts`, pero mucho más chico, y la razón es
 * que **no hay OAuth**. El seller crea una *custom app* en el admin de su propia
 * tienda y pega el Admin API access token en el portal de Rutax. Ese token no
 * expira ni rota: vive hasta que el comerciante desinstala la app. Por eso acá
 * no hay `refrescarToken`, ni `token_expira_en`, ni margen de refresco
 * proactivo, ni el enredo de la doble llamada al callback.
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
import { cifrarSecreto, descifrarSecreto } from "../secretos/cifrado";
import { peticionShopify, normalizarShopDomain, ErrorShopDomainInvalido } from "./cliente-http";
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
  accessToken: string,
): Promise<CredencialValidada> {
  const shopDomain = normalizarShopDomain(shopDomainCrudo);
  if (!shopDomain) throw new ErrorShopDomainInvalido(shopDomainCrudo);

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
      "No se pudo conectar con la tienda. Revisa el dominio y el token de acceso.",
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
  "id, tenant_id, seller_id, shop_domain, scopes_otorgados, filtro_etiqueta, estado_salud, ultima_sync_exitosa_en, ultimo_error, alias, nombre_tienda, activa, creado_en";

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
    creadoEn: fila.creado_en,
  };
}

export interface ConectarTiendaEntrada {
  tenantId: string;
  sellerId: string;
  shopDomain: string;
  accessToken: string;
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
  const validada = await validarCredencial(entrada.shopDomain, entrada.accessToken);
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
    tipoSecreto: "token_admin_shopify",
    valor: entrada.accessToken,
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
  accessToken: string;
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
  const validada = await validarCredencial(existente.shop_domain as string, entrada.accessToken);

  // Y se comprueba que el token nuevo sea DE ESA tienda: pegar por error el
  // token de otra tienda dejaría la conexión apuntando a un catálogo ajeno, con
  // los pedidos de un seller entrando como si fueran de otro.
  if (validada.shopDomain !== existente.shop_domain) {
    throw new ErrorCredencialShopifyInvalida(
      `Ese token pertenece a ${validada.shopDomain}, no a ${existente.shop_domain}.`,
    );
  }

  const { referenciaExternaId } = await cifrarSecreto({
    tenantId: entrada.tenantId,
    tipoSecreto: "token_admin_shopify",
    valor: entrada.accessToken,
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

  const { valor } = await descifrarSecreto(data.token_ref as string);
  if (typeof valor !== "string") {
    throw new ErrorCredencialShopifyInvalida(
      "El token de Shopify se descifró como binario — revisa el tipo de secreto.",
    );
  }
  return valor;
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
