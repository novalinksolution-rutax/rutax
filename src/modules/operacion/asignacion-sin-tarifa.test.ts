/**
 * Pruebas de `detectarSellersAsignablesSinTarifa` — el aviso "sin tarifa"
 * (tarifa → $0) de la bandeja de asignación.
 *
 * Un doble PROPIO (no el de `asignacion.test.ts`): esta función toca una
 * tabla más (`tarifas`, vía `detectarPedidosSinTarifa` → `resolverTarifaVigente`
 * en `./tarifas`) que el resto del módulo no necesita, así que reimplementar
 * el doble estricto de `asignacion.test.ts` para una sola función no vale la
 * pena. Este doble es deliberadamente más simple: solo entiende los filtros
 * que `resolverTarifaVigente` y esta función realmente usan.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { limitesDelDiaSantiago } from "@/lib/fecha-santiago";
import { detectarSellersAsignablesSinTarifa } from "./asignacion";

const TENANT = "10000000-0000-0000-0000-000000000001";
const SELLER_SAME_DAY_SIN_TARIFA = "60000000-0000-0000-0000-000000000001";
const SELLER_FLEX_CON_TARIFA = "60000000-0000-0000-0000-000000000002";
const SELLER_MIXTO = "60000000-0000-0000-0000-000000000003";

const FECHA = "2026-08-14";
const { desde: INICIO_HOY } = limitesDelDiaSantiago(FECHA);
const HOY_09H = new Date(INICIO_HOY.getTime() + 9 * 3_600_000).toISOString();

let contadorId = 0;
function pedidoSeed(overrides: Partial<{
  id: string;
  tenant_id: string;
  situacion_retiro: string;
  estado: string;
  retirado_en: string;
  seller_id: string;
  tipo_pedido: string;
}>) {
  const n = ++contadorId;
  return {
    id: `ffff0000-0000-0000-0000-${String(n).padStart(12, "0")}`,
    tenant_id: TENANT,
    situacion_retiro: "retirado",
    estado: "pendiente_asignacion",
    retirado_en: HOY_09H,
    seller_id: SELLER_SAME_DAY_SIN_TARIFA,
    tipo_pedido: "same_day",
    ...overrides,
  };
}

// =============================================================================
// Un doble minimalista, genérico solo en lo que hace falta.
// =============================================================================

function crearTablaGenerica(filas: Record<string, unknown>[]) {
  return {
    select() {
      const predicados: Array<(fila: Record<string, unknown>) => boolean> = [];
      let rango: { desde: number; hasta: number } | null = null;
      let limite: number | null = null;

      const builder = {
        eq(col: string, val: unknown) {
          predicados.push((f) => f[col] === val);
          return builder;
        },
        in(col: string, val: readonly unknown[]) {
          predicados.push((f) => val.includes(f[col]));
          return builder;
        },
        lte(col: string, val: unknown) {
          predicados.push((f) => String(f[col]) <= String(val));
          return builder;
        },
        lt(col: string, val: unknown) {
          predicados.push(
            (f) => new Date(String(f[col])).getTime() < new Date(String(val)).getTime(),
          );
          return builder;
        },
        // Un `.or()` por llamada, tal como lo usa `resolverTarifaVigente` — se
        // acumulan como un AND de dos grupos OR, igual que PostgREST.
        or(filtroStr: string) {
          const grupos = filtroStr.split(",").map((parte) => {
            const [col, op, ...restoVal] = parte.split(".");
            return { col, op, val: restoVal.join(".") };
          });
          predicados.push((f) =>
            grupos.some((g) => {
              if (g.op === "is" && g.val === "null") return f[g.col] === null || f[g.col] === undefined;
              if (g.op === "eq") return String(f[g.col]) === g.val;
              if (g.op === "gte") return f[g.col] != null && String(f[g.col]) >= g.val;
              return false;
            }),
          );
          return builder;
        },
        order() {
          return builder;
        },
        limit(n: number) {
          limite = n;
          return builder;
        },
        range(desde: number, hasta: number) {
          rango = { desde, hasta };
          return builder;
        },
        then(resolve: (r: { data: unknown; error: null }) => void) {
          let resultado = filas.filter((f) => predicados.every((p) => p(f)));
          if (rango) resultado = resultado.slice(rango.desde, rango.hasta + 1);
          if (limite !== null) resultado = resultado.slice(0, limite);
          resolve({ data: resultado, error: null });
        },
      };

      return builder;
    },
  };
}

function crearClienteFalso(entrada: {
  pedidos: Record<string, unknown>[];
  tarifas: Record<string, unknown>[];
  sellers: Record<string, unknown>[];
}): SupabaseClient {
  const tablaPedidos = crearTablaGenerica(entrada.pedidos);
  const tablaTarifas = crearTablaGenerica(entrada.tarifas);
  const tablaSellers = crearTablaGenerica(entrada.sellers);

  return {
    from(tabla: string) {
      if (tabla === "tarifas") return tablaTarifas;
      if (tabla === "sellers") return tablaSellers;
      throw new Error(`[doble] tabla inesperada en el esquema por defecto: '${tabla}'`);
    },
    schema(esquema: string) {
      if (esquema !== "operacion") throw new Error(`[doble] esquema inesperado: '${esquema}'`);
      return {
        from(tabla: string) {
          if (tabla !== "pedidos") throw new Error(`[doble] tabla inesperada: '${tabla}'`);
          return tablaPedidos;
        },
      };
    },
  } as unknown as SupabaseClient;
}

const SELLERS_POR_DEFECTO = [
  { id: SELLER_SAME_DAY_SIN_TARIFA, razon_social: "Comercial Andes SpA", tenant_id: TENANT },
  { id: SELLER_FLEX_CON_TARIFA, razon_social: "Full Import SpA", tenant_id: TENANT },
  { id: SELLER_MIXTO, razon_social: "Retail Sur SpA", tenant_id: TENANT },
];

/** Una tarifa activa, vigente hoy, sin fecha de término — el caso normal. */
function tarifaSeed(sellerId: string, tipoEntrega: string) {
  return {
    id: `tarifa-${sellerId}-${tipoEntrega}`,
    tenant_id: TENANT,
    seller_id: sellerId,
    tipo_entrega: tipoEntrega,
    estado: "activa",
    vigente_desde: "2026-01-01",
    vigente_hasta: null,
  };
}

describe("detectarSellersAsignablesSinTarifa", () => {
  it("sin pedidos asignables hoy, no hay nada que avisar", async () => {
    const cliente = crearClienteFalso({ pedidos: [], tarifas: [], sellers: SELLERS_POR_DEFECTO });

    const resultado = await detectarSellersAsignablesSinTarifa(cliente, { tenantId: TENANT, fecha: FECHA });

    expect(resultado).toEqual([]);
  });

  it("un seller sin tarifa vigente para el régimen de sus pedidos aparece con su conteo", async () => {
    const pedidos = [
      pedidoSeed({ seller_id: SELLER_SAME_DAY_SIN_TARIFA, tipo_pedido: "same_day" }),
      pedidoSeed({ seller_id: SELLER_SAME_DAY_SIN_TARIFA, tipo_pedido: "same_day" }),
    ];
    const cliente = crearClienteFalso({ pedidos, tarifas: [], sellers: SELLERS_POR_DEFECTO });

    const resultado = await detectarSellersAsignablesSinTarifa(cliente, { tenantId: TENANT, fecha: FECHA });

    expect(resultado).toEqual([
      { id: SELLER_SAME_DAY_SIN_TARIFA, nombre: "Comercial Andes SpA", bultos: 2 },
    ]);
  });

  it("un seller CON tarifa vigente para su régimen no aparece", async () => {
    const pedidos = [pedidoSeed({ seller_id: SELLER_FLEX_CON_TARIFA, tipo_pedido: "flex" })];
    const tarifas = [tarifaSeed(SELLER_FLEX_CON_TARIFA, "flex")];
    const cliente = crearClienteFalso({ pedidos, tarifas, sellers: SELLERS_POR_DEFECTO });

    const resultado = await detectarSellersAsignablesSinTarifa(cliente, { tenantId: TENANT, fecha: FECHA });

    expect(resultado).toEqual([]);
  });

  it("resuelve por (seller, régimen): un seller con tarifa flex pero sin tarifa same_day solo cuenta el bulto same_day", async () => {
    const pedidos = [
      pedidoSeed({ seller_id: SELLER_MIXTO, tipo_pedido: "flex" }),
      pedidoSeed({ seller_id: SELLER_MIXTO, tipo_pedido: "same_day" }),
    ];
    const tarifas = [tarifaSeed(SELLER_MIXTO, "flex")]; // solo flex, same_day queda sin tarifa
    const cliente = crearClienteFalso({ pedidos, tarifas, sellers: SELLERS_POR_DEFECTO });

    const resultado = await detectarSellersAsignablesSinTarifa(cliente, { tenantId: TENANT, fecha: FECHA });

    expect(resultado).toEqual([{ id: SELLER_MIXTO, nombre: "Retail Sur SpA", bultos: 1 }]);
  });

  it("respeta las dos rejas de la bandeja: lo no retirado y lo en_ruta no entran al aviso", async () => {
    const pedidos = [
      pedidoSeed({ seller_id: SELLER_SAME_DAY_SIN_TARIFA, situacion_retiro: "pendiente" }),
      pedidoSeed({ seller_id: SELLER_SAME_DAY_SIN_TARIFA, estado: "en_ruta" }),
    ];
    const cliente = crearClienteFalso({ pedidos, tarifas: [], sellers: SELLERS_POR_DEFECTO });

    const resultado = await detectarSellersAsignablesSinTarifa(cliente, { tenantId: TENANT, fecha: FECHA });

    expect(resultado).toEqual([]);
  });

  it("ordena por más bultos primero", async () => {
    const pedidos = [
      pedidoSeed({ seller_id: SELLER_SAME_DAY_SIN_TARIFA, tipo_pedido: "same_day" }),
      pedidoSeed({ seller_id: SELLER_MIXTO, tipo_pedido: "same_day" }),
      pedidoSeed({ seller_id: SELLER_MIXTO, tipo_pedido: "same_day" }),
      pedidoSeed({ seller_id: SELLER_MIXTO, tipo_pedido: "same_day" }),
    ];
    const cliente = crearClienteFalso({ pedidos, tarifas: [], sellers: SELLERS_POR_DEFECTO });

    const resultado = await detectarSellersAsignablesSinTarifa(cliente, { tenantId: TENANT, fecha: FECHA });

    expect(resultado.map((r) => r.id)).toEqual([SELLER_MIXTO, SELLER_SAME_DAY_SIN_TARIFA]);
    expect(resultado[0].bultos).toBe(3);
  });
});
