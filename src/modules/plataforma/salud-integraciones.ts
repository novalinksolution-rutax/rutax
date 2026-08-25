/**
 * Salud de integraciones — todas las conexiones, de todos los couriers.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * PARA QUÉ EXISTE ESTA PANTALLA, Y ES UNA SOLA COSA
 * -----------------------------------------------------------------------------
 * **Avisarle al courier antes de que se dé cuenta el seller.** Cada courier ve
 * la salud de SUS conexiones en su panel, y cada seller la suya en su portal;
 * lo que no existe en ninguna parte es la vista de arriba. Sin ella nos
 * enteramos de una caída por el mismo camino que el resto: cuando alguien
 * reclama.
 *
 * -----------------------------------------------------------------------------
 * 🔴 EL CAJÓN QUE JUSTIFICA LA PANTALLA ES «VENCEN PRONTO»
 * -----------------------------------------------------------------------------
 * «Caídas» y «Sanas» son el pasado y el presente, y esos dos ya se ven desde el
 * courier. **«Vencen pronto» es lo único que mira hacia adelante**: es la única
 * vista del producto que ve una caída antes de que ocurra, y es lo que permite
 * llamar el día antes en vez del día después. B6 lo dice con esas palabras.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ Y ES SOLO DE MERCADO LIBRE, AUNQUE EL TABLERO DIBUJE UNA FILA DE SHOPIFY
 * -----------------------------------------------------------------------------
 * La lámina de B6 muestra una tienda de Shopify con «Vence en 3 días». **Eso no
 * puede pasar con nuestro modelo de datos, y no es un olvido:**
 *
 * · `conexiones_seller_ml` tiene `token_expira_en`, porque el OAuth de ML
 *   entrega tokens con caducidad y los rota.
 * · `conexiones_seller_shopify` **no tiene columna de expiración**, porque el
 *   token es un *Admin API token* de una app privada que el seller pega a mano:
 *   no caduca. Se revoca —desinstalando la app o rotándolo— y eso se ve como
 *   caída, no como vencimiento.
 *
 * Así que una conexión de Shopify **nunca** cae en «vencen pronto». Inventarle
 * una fecha para que la pantalla se parezca al dibujo sería fabricar un aviso
 * que no se puede cumplir.
 *
 * -----------------------------------------------------------------------------
 * LA EMPRESA VA PRIMERO, SIEMPRE
 * -----------------------------------------------------------------------------
 * Quien mira esto tiene que llamar a alguien, y a quien llama es al courier. El
 * nombre del seller sin el del courier obliga a una búsqueda más antes de poder
 * hacer nada.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Días de anticipación del cajón que mira hacia adelante. */
export const DIAS_VENCE_PRONTO = 7;

export type CajonSalud = "caida" | "vence_pronto" | "sana";

/** Lo que el enum de la base puede traer, en las dos tablas. */
export type EstadoSaludConexion = "sana" | "atencion" | "desvinculada" | "pendiente";

export interface ConexionSalud {
  id: string;
  /** El courier. Va primero en la fila. */
  empresa: string;
  /** El seller, y la cuenta concreta: el nickname de ML o el dominio de la tienda. */
  seller: string;
  cuenta: string;
  fuente: "ml_flex" | "shopify";
  estadoSalud: EstadoSaludConexion;
  /** Solo ML. `null` en Shopify, que no tiene caducidad. */
  tokenExpiraEn: string | null;
  /** Para poder decir «caída hace 2 h». */
  desconectadaDesde: string | null;
  ultimaSyncExitosaEn: string | null;
}

/**
 * En qué cajón cae una conexión.
 *
 * ⚠️ **El orden de las tres condiciones importa.** Una conexión ya caída cuyo
 * token además venció mañana es una **caída**: lo urgente manda sobre lo
 * anticipado, y ponerla en «vencen pronto» la sacaría de la lista de las que
 * hay que llamar hoy.
 *
 * @param ahoraMs momento de referencia en epoch ms. Lo pasa el llamador para
 * que la clasificación sea pura y comprobable — acá no se llama a `Date.now()`.
 */
export function clasificarConexion(c: ConexionSalud, ahoraMs: number): CajonSalud {
  // `pendiente` es una conexión que nunca llegó a funcionar: cuenta como caída
  // porque el resultado para el courier es el mismo —no entran sus pedidos— y
  // porque es la que más se olvida, al no haber "dejado" de andar nunca.
  if (c.estadoSalud === "desvinculada" || c.estadoSalud === "pendiente") return "caida";
  if (c.estadoSalud === "atencion") return "caida";

  if (c.tokenExpiraEn) {
    const vence = Date.parse(c.tokenExpiraEn);
    // Una fecha ilegible NO se interpreta como «vence pronto»: eso llenaría el
    // cajón de avisos falsos y lo volvería ruido. Se deja como sana.
    if (Number.isFinite(vence)) {
      const limite = ahoraMs + DIAS_VENCE_PRONTO * 24 * 60 * 60 * 1000;
      // Un token ya vencido cuyo estado todavía dice `sana` —el sondeo aún no
      // pasó— es lo más parecido a una caída que se puede afirmar sin mentir.
      if (vence <= ahoraMs) return "caida";
      if (vence <= limite) return "vence_pronto";
    }
  }

  return "sana";
}

/**
 * El instante contra el que se clasifica toda la pantalla, leído UNA vez.
 *
 * Vive acá y no en el componente por dos razones. La de diseño: si cada fila
 * leyera el reloj por su cuenta, dos conexiones que vencen en el mismo segundo
 * podrían caer en cajones distintos según el orden en que se rendericen. Y la
 * mecánica: `react-hooks/purity` prohíbe `Date.now()` en el cuerpo de un
 * componente, y con razón — leer el reloj es un efecto.
 */
export function instanteDeClasificacion(): number {
  return Date.now();
}

export function contarPorCajonSalud(
  conexiones: readonly ConexionSalud[],
  ahoraMs: number,
): Record<CajonSalud, number> {
  const conteo: Record<CajonSalud, number> = { caida: 0, vence_pronto: 0, sana: 0 };
  for (const c of conexiones) conteo[clasificarConexion(c, ahoraMs)] += 1;
  return conteo;
}

/**
 * Trae todas las conexiones de las dos fuentes, de todos los tenants.
 *
 * ⚠️ **Requiere `service_role` y sesión de super-admin.** Es una lectura
 * deliberadamente cross-tenant: la única del producto sobre estas tablas. El
 * llamador (`admin/salud-integraciones/page.tsx`) la hace después del gate, y
 * el layout del backstage ya exige super-admin con su segundo factor.
 *
 * ⚠️ **NO trae ni una referencia de token.** `access_token_ref`,
 * `refresh_token_ref` y `token_ref` quedan fuera del `select` a propósito: esta
 * pantalla necesita saber si la conexión anda, no cómo se autentica. Un
 * `select("*")` acá pondría punteros a secretos en la memoria de un Server
 * Component por comodidad.
 */
export async function listarConexionesDeTodosLosCouriers(
  cliente: SupabaseClient,
): Promise<ConexionSalud[]> {
  const [ml, shopify, tenants, sellers] = await Promise.all([
    cliente
      .schema("identidad")
      .from("conexiones_seller_ml")
      .select(
        "id, tenant_id, seller_id, ml_nickname, alias, estado_salud, token_expira_en, desconectada_desde, ultima_sync_exitosa_en",
      ),
    cliente
      .schema("identidad")
      .from("conexiones_seller_shopify")
      .select(
        "id, tenant_id, seller_id, shop_domain, nombre_tienda, alias, estado_salud, ultima_sync_exitosa_en, activa",
      ),
    cliente.schema("identidad").from("tenants").select("id, nombre_fantasia"),
    cliente.schema("identidad").from("sellers").select("id, razon_social"),
  ]);

  if (ml.error) throw new Error(`Error al leer conexiones de ML: ${ml.error.message}`);
  if (shopify.error) throw new Error(`Error al leer conexiones de Shopify: ${shopify.error.message}`);
  if (tenants.error) throw new Error(`Error al leer couriers: ${tenants.error.message}`);
  if (sellers.error) throw new Error(`Error al leer sellers: ${sellers.error.message}`);

  const nombreTenant = new Map(
    (tenants.data ?? []).map((t: Record<string, unknown>) => [
      t.id as string,
      // El nombre de fantasía, no la razón social: es como se le llama al
      // courier en el resto del backstage y en el teléfono.
      t.nombre_fantasia as string,
    ]),
  );
  const nombreSeller = new Map(
    (sellers.data ?? []).map((s: Record<string, unknown>) => [
      s.id as string,
      s.razon_social as string,
    ]),
  );

  const deMl: ConexionSalud[] = (ml.data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    empresa: nombreTenant.get(r.tenant_id as string) ?? "—",
    seller: nombreSeller.get(r.seller_id as string) ?? "—",
    // El nickname es lo que el seller reconoce; el alias es como lo bautizó él.
    cuenta: (r.alias as string | null) ?? (r.ml_nickname as string | null) ?? "cuenta sin nombre",
    fuente: "ml_flex",
    estadoSalud: r.estado_salud as EstadoSaludConexion,
    tokenExpiraEn: (r.token_expira_en as string | null) ?? null,
    desconectadaDesde: (r.desconectada_desde as string | null) ?? null,
    ultimaSyncExitosaEn: (r.ultima_sync_exitosa_en as string | null) ?? null,
  }));

  const deShopify: ConexionSalud[] = (shopify.data ?? [])
    // Una conexión archivada por el seller no es una caída que haya que llamar.
    .filter((r: Record<string, unknown>) => r.activa !== false)
    .map((r: Record<string, unknown>) => ({
      id: r.id as string,
      empresa: nombreTenant.get(r.tenant_id as string) ?? "—",
      seller: nombreSeller.get(r.seller_id as string) ?? "—",
      cuenta:
        (r.alias as string | null) ??
        (r.nombre_tienda as string | null) ??
        (r.shop_domain as string),
      fuente: "shopify",
      estadoSalud: r.estado_salud as EstadoSaludConexion,
      // Shopify no caduca: ver la nota de arriba.
      tokenExpiraEn: null,
      desconectadaDesde: null,
      ultimaSyncExitosaEn: (r.ultima_sync_exitosa_en as string | null) ?? null,
    }));

  // La empresa primero, y dentro de ella por seller: quien mira esto llama al
  // courier, así que sus conexiones tienen que quedar juntas.
  return [...deMl, ...deShopify].sort(
    (a, b) =>
      a.empresa.localeCompare(b.empresa, "es") ||
      a.seller.localeCompare(b.seller, "es") ||
      a.cuenta.localeCompare(b.cuenta, "es"),
  );
}
