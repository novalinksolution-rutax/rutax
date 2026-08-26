/**
 * Lo que el COURIER ve de un seller al tocar su fila.
 * =============================================================================
 *
 * ⚠️ **No confundir con `operacion/vista-previa-seller.ts`**, que es la vista
 * previa de un pedido DENTRO del portal del seller. Ésta es la de acá: el
 * courier mirando a su cliente.
 *
 * -----------------------------------------------------------------------------
 * QUÉ RESPONDE, Y POR QUÉ ESTAS MÉTRICAS Y NO OTRAS
 * -----------------------------------------------------------------------------
 * La tabla de sellers dice quién es y si su conexión está sana. Lo que no dice
 * —y es lo que uno quiere saber antes de llamarlo o de renegociar— es **cuánto
 * pesa y cómo se está portando**:
 *
 * · **el volumen semanal**, promediado sobre las últimas 4 semanas. Un promedio
 *   de un solo día miente con cualquier feriado;
 * · **cómo terminan sus pedidos**: entregados contra fallidos. Un seller con
 *   muchos fallidos cuesta plata —la entrega se hizo y no se cobra— y es una
 *   conversación distinta a la de uno con volumen bajo;
 * · **sus incidencias abiertas**, que es trabajo pendiente del courier;
 * · **lo que se le está cobrando**: el período abierto en curso y lo último
 *   facturado.
 *
 * -----------------------------------------------------------------------------
 * VENTANA DE 28 DÍAS, Y POR QUÉ NO «EL MES»
 * -----------------------------------------------------------------------------
 * 28 días son exactamente 4 semanas, así que el promedio semanal no se
 * distorsiona por cuántos lunes cayeron en el mes. Un «mes en curso» además da
 * un promedio inútil el día 2.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ TOLERA EL FALLO POR BLOQUE
 * -----------------------------------------------------------------------------
 * Si la lectura de dinero falla, las métricas de operación siguen en pie y el
 * panel dibuja lo que sí pudo leer. Un panel que se cae entero porque no pudo
 * contar períodos deja al courier sin la ficha de su cliente por nada.
 *
 * Y el aislamiento se impone acá, en cada consulta: se llama con `service_role`,
 * así que RLS no protege nada. Un seller de otro tenant devuelve `null`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { leerTodasLasFilas } from "@/lib/supabase/leer-paginado";
import { sumarDiasCalendario } from "@/lib/fecha-santiago";

/** La ventana de las métricas: 4 semanas exactas. */
export const DIAS_VENTANA_SELLER = 28;

export interface ConexionSeller {
  tipo: "ml" | "shopify";
  /** Cómo la nombra el seller, o el identificador de la cuenta. */
  nombre: string;
  estadoSalud: string;
  ultimaSyncEn: string | null;
}

export interface VistaPreviaSellerCourier {
  id: string;
  razonSocial: string;
  rut: string | null;
  nombreContacto: string | null;
  emailContacto: string | null;
  estado: string;

  conexiones: ConexionSeller[];

  /** `false` cuando la lectura de operación falló: las cifras no son cero. */
  hayMetricas: boolean;
  /** Pedidos con compromiso dentro de la ventana. */
  pedidosVentana: number;
  promedioSemanal: number;
  entregados: number;
  fallidos: number;
  cancelados: number;
  /** En curso: ni entregados, ni fallidos, ni cancelados. */
  enCurso: number;
  incidenciasAbiertas: number;

  /** `false` cuando la lectura de dinero falló. */
  hayDinero: boolean;
  /** Neto acumulado del período abierto en curso, si tiene uno. */
  periodoAbiertoClp: number | null;
  periodoAbiertoLineas: number;
  /** Lo último que se le facturó, con su fecha de cierre. */
  ultimoFacturadoClp: number | null;
  ultimoFacturadoHasta: string | null;
}

const TERMINALES_ENTREGA = new Set(["entregado", "entregado_manual"]);
const TERMINALES_FALLO = new Set(["fallido", "fallido_manual", "devuelto"]);

export async function armarVistaPreviaSellerCourier(
  cliente: SupabaseClient,
  tenantId: string,
  sellerId: string,
  hoyIso: string,
): Promise<VistaPreviaSellerCourier | null> {
  const { data: seller, error } = await cliente
    .schema("identidad")
    .from("sellers")
    .select("id, razon_social, rut, nombre_contacto, email_contacto, estado")
    .eq("id", sellerId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  // `null` y no una excepción: desde afuera, «no existe» y «no es de tu tenant»
  // tienen que verse igual.
  if (error || !seller) return null;

  // ⚠️ **Por `sumarDiasCalendario`, no con `Date` y UTC.** La primera versión
  // hacía `new Date(hoy + "T00:00:00Z")` y restaba días en UTC: eso interpreta
  // una fecha civil chilena como un instante UTC y después la vuelve a truncar,
  // que es la forma de correr la ventana un día entero según la hora. La red
  // mecánica `fecha-santiago.guard.test.ts` lo detectó, y por eso existe.
  const desdeIso = sumarDiasCalendario(hoyIso, -(DIAS_VENTANA_SELLER - 1));

  // ⚠️ `Promise.resolve(...)` alrededor de cada builder: PostgREST devuelve un
  // `PromiseLike` y sin el envoltorio `.catch()` no compila.
  const [conexionesMl, conexionesShopify] = await Promise.all([
    Promise.resolve(
      cliente
        .schema("identidad")
        .from("conexiones_seller_ml")
        .select("alias, ml_nickname, ml_user_id, estado_salud, ultima_sync_exitosa_en")
        .eq("tenant_id", tenantId)
        .eq("seller_id", sellerId),
    )
      .then((r) => r.data ?? [])
      .catch(() => []),
    Promise.resolve(
      cliente
        .schema("identidad")
        .from("conexiones_seller_shopify")
        .select("alias, nombre_tienda, shop_domain, estado_salud, ultima_sync_exitosa_en")
        .eq("tenant_id", tenantId)
        .eq("seller_id", sellerId)
        .eq("activa", true),
    )
      .then((r) => r.data ?? [])
      .catch(() => []),
  ]);

  const conexiones: ConexionSeller[] = [
    ...conexionesMl.map((c) => ({
      tipo: "ml" as const,
      nombre:
        (c.alias as string | null) ??
        (c.ml_nickname as string | null) ??
        `Cuenta ${c.ml_user_id ?? ""}`.trim(),
      estadoSalud: (c.estado_salud as string) ?? "desconocido",
      ultimaSyncEn: (c.ultima_sync_exitosa_en as string | null) ?? null,
    })),
    ...conexionesShopify.map((c) => ({
      tipo: "shopify" as const,
      nombre:
        (c.alias as string | null) ??
        (c.nombre_tienda as string | null) ??
        (c.shop_domain as string),
      estadoSalud: (c.estado_salud as string) ?? "desconocido",
      ultimaSyncEn: (c.ultima_sync_exitosa_en as string | null) ?? null,
    })),
  ];

  // ── Operación ────────────────────────────────────────────────────────────
  let hayMetricas = true;
  let pedidos: { id: string; estado: string | null }[] = [];
  try {
    pedidos = await leerTodasLasFilas<{ id: string; estado: string | null }>(
      "pedidos del seller en la ventana",
      (d, h) =>
        cliente
          .schema("operacion")
          .from("pedidos")
          .select("id, estado")
          .eq("tenant_id", tenantId)
          .eq("seller_id", sellerId)
          .gte("fecha_compromiso", desdeIso)
          .lte("fecha_compromiso", hoyIso)
          .range(d, h),
    );
  } catch {
    hayMetricas = false;
  }

  const entregados = pedidos.filter((p) => p.estado && TERMINALES_ENTREGA.has(p.estado)).length;
  const fallidos = pedidos.filter((p) => p.estado && TERMINALES_FALLO.has(p.estado)).length;
  const cancelados = pedidos.filter((p) => p.estado === "cancelado").length;

  const incidenciasAbiertas = await Promise.resolve(
    cliente
      .schema("operacion")
      .from("incidencias")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("seller_id", sellerId)
      .in("estado", ["abierta", "en_gestion"]),
  )
    .then((r) => r.count ?? 0)
    .catch(() => 0);

  // ── Dinero ───────────────────────────────────────────────────────────────
  let hayDinero = true;
  let periodoAbiertoClp: number | null = null;
  let periodoAbiertoLineas = 0;
  let ultimoFacturadoClp: number | null = null;
  let ultimoFacturadoHasta: string | null = null;

  try {
    const { data: periodos } = await cliente
      .schema("dinero")
      .from("periodos_cobro")
      .select("id, estado, fecha_fin, monto_total_clp")
      .eq("tenant_id", tenantId)
      .eq("seller_id", sellerId)
      .order("fecha_fin", { ascending: false })
      .limit(24);

    const abierto = (periodos ?? []).find((p) => p.estado === "abierto");
    const facturado = (periodos ?? []).find((p) => p.estado === "facturado");

    if (abierto) {
      // ⚠️ El total guardado del período abierto NO sirve: se escribe al cerrar.
      // Mientras está abierto, la única cifra real es la suma de sus líneas.
      const lineas = await leerTodasLasFilas<{ monto_final_clp: number | null; anulada: boolean | null }>(
        "líneas del período abierto",
        (d, h) =>
          cliente
            .schema("dinero")
            .from("lineas_cobro")
            .select("monto_final_clp, anulada")
            .eq("tenant_id", tenantId)
            .eq("periodo_cobro_id", abierto.id as string)
            .range(d, h),
      );
      const vigentes = lineas.filter((l) => !l.anulada);
      periodoAbiertoLineas = vigentes.length;
      periodoAbiertoClp = vigentes.reduce((s, l) => s + (l.monto_final_clp ?? 0), 0);
    }

    if (facturado) {
      ultimoFacturadoClp = (facturado.monto_total_clp as number | null) ?? null;
      ultimoFacturadoHasta = (facturado.fecha_fin as string | null) ?? null;
    }
  } catch {
    hayDinero = false;
  }

  return {
    id: seller.id as string,
    razonSocial: seller.razon_social as string,
    rut: (seller.rut as string | null) ?? null,
    nombreContacto: (seller.nombre_contacto as string | null) ?? null,
    emailContacto: (seller.email_contacto as string | null) ?? null,
    estado: seller.estado as string,

    conexiones,

    hayMetricas,
    pedidosVentana: pedidos.length,
    // Redondeado a un decimal: «31,8 por semana» dice algo que «32» esconde
    // cuando se compara un seller con otro.
    promedioSemanal: Math.round((pedidos.length / (DIAS_VENTANA_SELLER / 7)) * 10) / 10,
    entregados,
    fallidos,
    cancelados,
    enCurso: pedidos.length - entregados - fallidos - cancelados,
    incidenciasAbiertas,

    hayDinero,
    periodoAbiertoClp,
    periodoAbiertoLineas,
    ultimoFacturadoClp,
    ultimoFacturadoHasta,
  };
}
