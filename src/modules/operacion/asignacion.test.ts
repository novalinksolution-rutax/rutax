/**
 * Pruebas de la capa de lectura de la bandeja de asignación en bloque
 * (etapa 6): `listarPedidosAsignables`, `resolverIdsAsignables`,
 * `listarComunasConAsignables`, `obtenerCargaConductoresDelDia`,
 * `contarAsignablesSinAsignar`.
 *
 * El doble de Supabase de este archivo LANZA ante cualquier tabla, columna,
 * esquema u operador que no esperaba — nunca devuelve vacío en silencio.
 * Mismo criterio que `retiro/preparacion.test.ts` y
 * `auto-asignacion.test.ts:crearClienteFalsoCarga`, generalizado para
 * soportar las tres tablas reales que este módulo toca
 * (`operacion.pedidos`, `sellers` y `identidad.conductores`) con los
 * operadores reales que usa `asignacion.ts` (`eq`, `in`, `not`, `gte`, `lt`,
 * `or`, `order`, `range`, `count`/`head`). Si `asignacion.ts` alguna vez
 * seleccionara o filtrara por una columna fuera de la lista blanca —incluida
 * cualquier columna con dato personal del destinatario—, CUALQUIER prueba de
 * este archivo revienta con un error explícito, no con datos vacíos.
 *
 * También aplica de verdad el tope de 1.000 filas por página de PostgREST
 * (`max_rows`): aunque `asignacion.ts` deje de paginar por accidente, el
 * doble solo entrega 1.000 filas por llamada — así una regresión real hace
 * caer la prueba en vez de pasar por vacuidad.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { limitesDelDiaSantiago } from "@/lib/fecha-santiago";
import {
  listarPedidosAsignables,
  resolverIdsAsignables,
  listarComunasConAsignables,
  obtenerCargaConductoresDelDia,
  contarAsignablesSinAsignar,
  ESTADOS_ASIGNABLES,
} from "./asignacion";
import type { FiltroAsignables } from "./asignacion";
import { ESTADOS_TERMINALES_PEDIDO } from "./metricas";

// =============================================================================
// Fixtures — ids y fechas
// =============================================================================

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const TENANT_B = "10000000-0000-0000-0000-000000000002";

const SELLER_1 = "60000000-0000-0000-0000-000000000001";
const SELLER_2 = "60000000-0000-0000-0000-000000000002";
const CONDUCTOR_1 = "20000000-0000-0000-0000-000000000001";
const CONDUCTOR_2 = "20000000-0000-0000-0000-000000000002";

const FECHA = "2026-08-14";
const MANANA = "2026-08-15";

// Instantes relativos a los propios límites de Santiago del día bajo prueba
// (en vez de asumir a mano el offset UTC-3/UTC-4 según DST): así la prueba
// sigue siendo correcta sin importar en qué mitad del año caiga `FECHA`.
const { desde: INICIO_HOY, hasta: FIN_HOY } = limitesDelDiaSantiago(FECHA);
const HOY_09H = new Date(INICIO_HOY.getTime() + 9 * 3_600_000).toISOString();
const AYER_09H = new Date(INICIO_HOY.getTime() - 15 * 3_600_000).toISOString();
// Un instante que cae EXACTO en el borde superior (excluido: el rango es semiabierto).
const JUSTO_MANANA = FIN_HOY.toISOString();

let contadorId = 0;

// =============================================================================
// Fixtures — filas crudas de operacion.pedidos
// =============================================================================

// El índice de firma (`[key: string]: unknown`) es lo que hace a este tipo
// asignable a `Record<string, unknown>[]` cuando se le pasa al doble
// genérico (`crearTablaFalsa`) más abajo — sin él, TypeScript rechaza la
// asignación aunque las propiedades calcen una a una (una interfaz nombrada
// no sintetiza el índice solo por estructura).
interface FilaPedidoSeed {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  situacion_retiro: "pendiente" | "retirado" | "no_procesado";
  retirado_en: string | null;
  estado: string;
  fecha_compromiso: string | null;
  destinatario_comuna: string;
  seller_id: string;
  driver_id_asignado: string | null;
  ml_shipment_id: string | null;
  codigo_interno: string | null;
}

function pedidoSeed(overrides: Partial<FilaPedidoSeed> = {}): FilaPedidoSeed {
  const n = ++contadorId;
  return {
    id: `ffff0000-0000-0000-0000-${String(n).padStart(12, "0")}`,
    tenant_id: TENANT_A,
    situacion_retiro: "retirado",
    retirado_en: HOY_09H,
    estado: "pendiente_asignacion",
    fecha_compromiso: FECHA,
    destinatario_comuna: "Ñuñoa",
    seller_id: SELLER_1,
    driver_id_asignado: null,
    ml_shipment_id: `4476${String(n).padStart(8, "0")}`,
    codigo_interno: null,
    ...overrides,
  };
}

const SELLERS_POR_DEFECTO = [
  { id: SELLER_1, razon_social: "Comercial Andes SpA", tenant_id: TENANT_A },
  { id: SELLER_2, razon_social: "Full Import SpA", tenant_id: TENANT_A },
];

const CONDUCTORES_POR_DEFECTO = [
  { id: CONDUCTOR_1, nombre_completo: "Pedro Soto", tenant_id: TENANT_A },
  { id: CONDUCTOR_2, nombre_completo: "María Rojas", tenant_id: TENANT_A },
];

// =============================================================================
// El doble de Supabase — genérico pero estricto
// =============================================================================

type Filtro =
  | { tipo: "eq"; col: string; val: unknown }
  | { tipo: "in"; col: string; val: readonly unknown[] }
  | { tipo: "not-is-null"; col: string }
  | { tipo: "not-in"; col: string; val: readonly string[] }
  | { tipo: "gte"; col: string; val: unknown }
  | { tipo: "lt"; col: string; val: unknown }
  | { tipo: "or"; grupos: { col: string; val: string }[] };

interface OrdenSpec {
  col: string;
  ascending: boolean;
  nullsFirst?: boolean;
}

/** `null`/`undefined` nunca satisfacen gte/lt — igual que NULL en SQL. */
function compararFechas(valorFila: unknown, valorFiltro: unknown): number | null {
  if (valorFila === null || valorFila === undefined) return null;
  const a = new Date(String(valorFila)).getTime();
  const b = new Date(String(valorFiltro)).getTime();
  return a === b ? 0 : a < b ? -1 : 1;
}

function probarIlike(valorFila: unknown, patronConPorcentajes: string): boolean {
  if (valorFila === null || valorFila === undefined) return false;
  const sinPorcentajes = patronConPorcentajes.replace(/^%/, "").replace(/%$/, "");
  return String(valorFila).toLowerCase().includes(sinPorcentajes.toLowerCase());
}

function cumpleFiltros(fila: Record<string, unknown>, filtros: Filtro[]): boolean {
  return filtros.every((f) => {
    switch (f.tipo) {
      case "eq":
        return fila[f.col] === f.val;
      case "in":
        return f.val.includes(fila[f.col]);
      case "not-is-null":
        return fila[f.col] !== null && fila[f.col] !== undefined;
      case "not-in":
        return !f.val.includes(String(fila[f.col]));
      case "gte": {
        const cmp = compararFechas(fila[f.col], f.val);
        return cmp !== null && cmp >= 0;
      }
      case "lt": {
        const cmp = compararFechas(fila[f.col], f.val);
        return cmp !== null && cmp < 0;
      }
      case "or":
        return f.grupos.some((g) => probarIlike(fila[g.col], g.val));
      default:
        return true;
    }
  });
}

function compararValores(a: unknown, b: unknown, ascending: boolean, nullsFirstOpt?: boolean): number {
  const nullsFirst = nullsFirstOpt ?? !ascending; // default Postgres: ASC→nulls last, DESC→nulls first.
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return nullsFirst ? -1 : 1;
  if (bNull) return nullsFirst ? 1 : -1;

  let cmp: number;
  if (typeof a === "string" && typeof b === "string") {
    cmp = a < b ? -1 : a > b ? 1 : 0;
  } else {
    cmp = (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
  }
  return ascending ? cmp : -cmp;
}

function compararFilas(a: Record<string, unknown>, b: Record<string, unknown>, ordenes: OrdenSpec[]): number {
  for (const o of ordenes) {
    const cmp = compararValores(a[o.col], b[o.col], o.ascending, o.nullsFirst);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

function proyectar(fila: Record<string, unknown>, cols: string[]): Record<string, unknown> {
  const resultado: Record<string, unknown> = {};
  for (const c of cols) resultado[c] = fila[c];
  return resultado;
}

/**
 * Una tabla falsa mínima: solo entiende los métodos y columnas que se le
 * declaran. Cualquier otra cosa —tabla, columna, operador de `.not()`— hace
 * `throw`. El tope de 1.000 filas por respuesta se aplica SIEMPRE, con o sin
 * `.range()` explícito, igual que el `max_rows` real de PostgREST.
 */
function crearTablaFalsa(
  nombreTabla: string,
  filasIniciales: Record<string, unknown>[],
  columnasValidas: readonly string[],
) {
  const columnas = new Set(columnasValidas);

  function validarColumna(col: string, contexto: string) {
    if (!columnas.has(col)) {
      throw new Error(`[doble ${nombreTabla}] columna inesperada '${col}' en .${contexto}()`);
    }
  }

  return {
    select(cols: string, opciones: { count?: string; head?: boolean } = {}) {
      const listaCols = cols
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      for (const c of listaCols) {
        if (c === "*") {
          throw new Error(`[doble ${nombreTabla}] select('*') no permitido — lista explícita siempre`);
        }
        validarColumna(c, "select");
      }

      const filtros: Filtro[] = [];
      const ordenes: OrdenSpec[] = [];
      let rango: { desde: number; hasta: number } | null = null;

      const builder = {
        eq(col: string, val: unknown) {
          validarColumna(col, "eq");
          filtros.push({ tipo: "eq", col, val });
          return builder;
        },
        in(col: string, val: readonly unknown[]) {
          validarColumna(col, "in");
          filtros.push({ tipo: "in", col, val });
          return builder;
        },
        not(col: string, op: string, val: unknown) {
          validarColumna(col, "not");
          if (op === "is" && val === null) {
            filtros.push({ tipo: "not-is-null", col });
          } else if (op === "in") {
            const lista = String(val)
              .replace(/^\(/, "")
              .replace(/\)$/, "")
              .split(",");
            filtros.push({ tipo: "not-in", col, val: lista });
          } else {
            throw new Error(`[doble ${nombreTabla}] .not() no soportado: col=${col} op=${op}`);
          }
          return builder;
        },
        gte(col: string, val: unknown) {
          validarColumna(col, "gte");
          filtros.push({ tipo: "gte", col, val });
          return builder;
        },
        lt(col: string, val: unknown) {
          validarColumna(col, "lt");
          filtros.push({ tipo: "lt", col, val });
          return builder;
        },
        or(filtroStr: string) {
          const grupos = filtroStr.split(",").map((parte) => {
            const [col, op, ...restoVal] = parte.split(".");
            validarColumna(col, "or");
            if (op !== "ilike") {
              throw new Error(`[doble ${nombreTabla}] operador no soportado en or(): '${op}'`);
            }
            return { col, val: restoVal.join(".") };
          });
          filtros.push({ tipo: "or", grupos });
          return builder;
        },
        order(col: string, opcionesOrden: { ascending?: boolean; nullsFirst?: boolean } = {}) {
          validarColumna(col, "order");
          ordenes.push({
            col,
            ascending: opcionesOrden.ascending ?? true,
            nullsFirst: opcionesOrden.nullsFirst,
          });
          return builder;
        },
        range(desde: number, hasta: number) {
          rango = { desde, hasta };
          return builder;
        },
        then(resolve: (r: { data: unknown; error: null; count: number | null }) => void) {
          const filtradas = filasIniciales.filter((fila) => cumpleFiltros(fila, filtros));
          const total = opciones.count === "exact" ? filtradas.length : null;

          const ordenadas =
            ordenes.length > 0 ? [...filtradas].sort((a, b) => compararFilas(a, b, ordenes)) : filtradas;

          const ventana = rango ? ordenadas.slice(rango.desde, rango.hasta + 1) : ordenadas;
          // EL TOPE DE 1.000, siempre — lo que hace honesta la prueba de paginación:
          // si `asignacion.ts` dejara de paginar, esto igual corta en 1.000 y la
          // prueba de "supera las 1.000 filas" cae en vez de pasar por vacuidad.
          const capeada = ventana.slice(0, 1000);

          resolve({
            data: opciones.head ? null : capeada.map((fila) => proyectar(fila, listaCols)),
            error: null,
            count: total,
          });
        },
      };

      return builder;
    },
  };
}

const COLUMNAS_PEDIDOS = [
  "id",
  "tenant_id",
  "situacion_retiro",
  "retirado_en",
  "estado",
  "fecha_compromiso",
  "destinatario_comuna",
  "seller_id",
  "driver_id_asignado",
  "ml_shipment_id",
  "codigo_interno",
];
const COLUMNAS_SELLERS = ["id", "razon_social", "tenant_id"];
const COLUMNAS_CONDUCTORES = ["id", "nombre_completo", "tenant_id"];

function crearClienteFalso(
  seed: {
    pedidos?: Record<string, unknown>[];
    sellers?: Record<string, unknown>[];
    conductores?: Record<string, unknown>[];
  } = {},
): SupabaseClient {
  const tablaPedidos = crearTablaFalsa("operacion.pedidos", seed.pedidos ?? [], COLUMNAS_PEDIDOS);
  const tablaSellers = crearTablaFalsa("sellers", seed.sellers ?? SELLERS_POR_DEFECTO, COLUMNAS_SELLERS);
  const tablaConductores = crearTablaFalsa(
    "identidad.conductores",
    seed.conductores ?? CONDUCTORES_POR_DEFECTO,
    COLUMNAS_CONDUCTORES,
  );

  function from(tabla: string) {
    if (tabla !== "sellers") {
      throw new Error(`[doble] tabla inesperada en el esquema por defecto: '${tabla}'`);
    }
    return tablaSellers;
  }

  function schema(esquema: string) {
    if (esquema === "operacion") {
      return {
        from(tabla: string) {
          if (tabla !== "pedidos") {
            throw new Error(`[doble] tabla inesperada en el esquema 'operacion': '${tabla}'`);
          }
          return tablaPedidos;
        },
      };
    }
    if (esquema === "identidad") {
      return {
        from(tabla: string) {
          if (tabla !== "conductores") {
            throw new Error(`[doble] tabla inesperada en el esquema 'identidad': '${tabla}'`);
          }
          return tablaConductores;
        },
      };
    }
    throw new Error(`[doble] esquema inesperado: '${esquema}'`);
  }

  return { from, schema } as unknown as SupabaseClient;
}

function filtroBase(overrides: Partial<FiltroAsignables> = {}): FiltroAsignables {
  return { tenantId: TENANT_A, fecha: FECHA, ...overrides };
}

// =============================================================================
// listarPedidosAsignables
// =============================================================================

describe("listarPedidosAsignables", () => {
  it("aplica las dos rejas siempre: un pedido pendiente de retiro no sale, y uno en_ruta tampoco", async () => {
    const retiradoPendiente = pedidoSeed({ situacion_retiro: "retirado", estado: "pendiente_asignacion" });
    const noRetirado = pedidoSeed({ situacion_retiro: "pendiente", estado: "pendiente_asignacion" });
    const enRuta = pedidoSeed({ situacion_retiro: "retirado", estado: "en_ruta" });

    const cliente = crearClienteFalso({ pedidos: [retiradoPendiente, noRetirado, enRuta] });

    const { pedidos, total } = await listarPedidosAsignables(cliente, filtroBase(), { pagina: 1, porPagina: 50 });

    expect(pedidos.map((p) => p.pedidoId)).toEqual([retiradoPendiente.id]);
    expect(total).toBe(1);
  });

  it("el total es el REAL del filtro, no el largo de la página devuelta", async () => {
    const pedidos5 = Array.from({ length: 5 }, () => pedidoSeed());
    const cliente = crearClienteFalso({ pedidos: pedidos5 });

    const { pedidos, total } = await listarPedidosAsignables(cliente, filtroBase(), { pagina: 1, porPagina: 2 });

    expect(pedidos).toHaveLength(2);
    expect(total).toBe(5);
  });

  it("multi-comuna devuelve la UNIÓN de las comunas seleccionadas, no la intersección ni solo una", async () => {
    const enNunoa = pedidoSeed({ destinatario_comuna: "Ñuñoa" });
    const enProvidencia = pedidoSeed({ destinatario_comuna: "Providencia" });
    const enRenca = pedidoSeed({ destinatario_comuna: "Renca" }); // fuera del filtro

    const cliente = crearClienteFalso({ pedidos: [enNunoa, enProvidencia, enRenca] });

    const { pedidos } = await listarPedidosAsignables(
      cliente,
      filtroBase({ comunas: ["Ñuñoa", "Providencia"] }),
      { pagina: 1, porPagina: 50 },
    );

    expect(new Set(pedidos.map((p) => p.pedidoId))).toEqual(new Set([enNunoa.id, enProvidencia.id]));
  });

  it("una comuna escrita distinto en mayúsculas/sin tilde se encuentra igual (filtro canónico, dato crudo)", async () => {
    const crudoMayusculas = pedidoSeed({ destinatario_comuna: "MAIPU" });
    const otraComuna = pedidoSeed({ destinatario_comuna: "La Florida" });

    const cliente = crearClienteFalso({ pedidos: [crudoMayusculas, otraComuna] });

    const { pedidos } = await listarPedidosAsignables(cliente, filtroBase({ comunas: ["Maipú"] }), {
      pagina: 1,
      porPagina: 50,
    });

    expect(pedidos.map((p) => p.pedidoId)).toEqual([crudoMayusculas.id]);
  });

  it("aísla por tenant: un pedido de otro tenant, aunque cumpla todo lo demás, no aparece", async () => {
    const deA = pedidoSeed({ tenant_id: TENANT_A });
    const deB = pedidoSeed({ tenant_id: TENANT_B });

    const cliente = crearClienteFalso({ pedidos: [deA, deB] });

    const { pedidos, total } = await listarPedidosAsignables(cliente, filtroBase({ tenantId: TENANT_A }), {
      pagina: 1,
      porPagina: 50,
    });

    expect(pedidos.map((p) => p.pedidoId)).toEqual([deA.id]);
    expect(total).toBe(1);
  });

  it("filtra por sellerId", async () => {
    const delSeller1 = pedidoSeed({ seller_id: SELLER_1 });
    const delSeller2 = pedidoSeed({ seller_id: SELLER_2 });

    const cliente = crearClienteFalso({ pedidos: [delSeller1, delSeller2] });

    const { pedidos } = await listarPedidosAsignables(cliente, filtroBase({ sellerId: SELLER_2 }), {
      pagina: 1,
      porPagina: 50,
    });

    expect(pedidos.map((p) => p.pedidoId)).toEqual([delSeller2.id]);
  });

  it("filtra por texto libre contra el código visible (ml_shipment_id O codigo_interno)", async () => {
    const flex = pedidoSeed({ ml_shipment_id: "44760788901", codigo_interno: null });
    const sameDay = pedidoSeed({ ml_shipment_id: null, codigo_interno: "RX-7K2M-9PQR" });
    const otroFlex = pedidoSeed({ ml_shipment_id: "99999999999", codigo_interno: null });

    const cliente = crearClienteFalso({ pedidos: [flex, sameDay, otroFlex] });

    const porFlex = await listarPedidosAsignables(cliente, filtroBase({ texto: "788901" }), {
      pagina: 1,
      porPagina: 50,
    });
    expect(porFlex.pedidos.map((p) => p.pedidoId)).toEqual([flex.id]);

    const porSameDay = await listarPedidosAsignables(cliente, filtroBase({ texto: "7K2M" }), {
      pagina: 1,
      porPagina: 50,
    });
    expect(porSameDay.pedidos.map((p) => p.pedidoId)).toEqual([sameDay.id]);
  });

  it("filtra por estado cuando se pide uno de los dos valores permitidos", async () => {
    const sinAsignar = pedidoSeed({ estado: "pendiente_asignacion" });
    const asignado = pedidoSeed({ estado: "asignado", driver_id_asignado: CONDUCTOR_1 });

    const cliente = crearClienteFalso({ pedidos: [sinAsignar, asignado] });

    const { pedidos } = await listarPedidosAsignables(cliente, filtroBase({ estado: "asignado" }), {
      pagina: 1,
      porPagina: 50,
    });

    expect(pedidos.map((p) => p.pedidoId)).toEqual([asignado.id]);
  });

  it("acota por RETIRO (retirado_en) y no por fecha_compromiso", async () => {
    // Un pedido retirado hoy sale aunque Mercado Libre prometa entregarlo
    // mañana: está en la bodega y el courier entrega todo el mismo día.
    const retiradoHoy = pedidoSeed({ retirado_en: HOY_09H, fecha_compromiso: MANANA });
    const cliente = crearClienteFalso({ pedidos: [retiradoHoy] });

    const { pedidos } = await listarPedidosAsignables(cliente, filtroBase({ fecha: FECHA }), {
      pagina: 1,
      porPagina: 50,
    });

    expect(pedidos.map((p) => p.pedidoId)).toEqual([retiradoHoy.id]);
  });

  /**
   * EL PAQUETE QUE SE PERDÍA. Con el rango cerrado `[hoy, mañana)`, un pedido
   * retirado AYER que nunca llegó a asignarse quedaba invisible para siempre:
   * está físicamente en la bodega, sigue `pendiente_asignacion`, y ninguna
   * pantalla lo vuelve a ofrecer. Nadie lo despacha y nadie se entera.
   *
   * Puede pasar hoy porque el cierre de jornada (etapa 10) todavía no existe:
   * no hay ningún proceso que resuelva lo que quedó colgando al final del día.
   */
  it("un pedido retirado AYER y todavía sin asignar SIGUE apareciendo hoy", async () => {
    const rezagado = pedidoSeed({ retirado_en: AYER_09H, fecha_compromiso: FECHA });
    const deHoy = pedidoSeed({ retirado_en: HOY_09H });

    const cliente = crearClienteFalso({ pedidos: [rezagado, deHoy] });

    const { pedidos, total } = await listarPedidosAsignables(cliente, filtroBase({ fecha: FECHA }), {
      pagina: 1,
      porPagina: 50,
    });

    expect(total).toBe(2);
    expect(pedidos.map((p) => p.pedidoId).sort()).toEqual([deHoy.id, rezagado.id].sort());
  });

  it("el rango de fecha es semiabierto: el instante justo del corte de mañana ya no cuenta como hoy", async () => {
    const enElBorde = pedidoSeed({ retirado_en: JUSTO_MANANA });
    const cliente = crearClienteFalso({ pedidos: [enElBorde] });

    const { total } = await listarPedidosAsignables(cliente, filtroBase(), { pagina: 1, porPagina: 50 });

    expect(total).toBe(0);
  });

  it("resuelve el nombre del seller y, si está asignado, el del conductor actual — vía driver_id_asignado", async () => {
    const asignado = pedidoSeed({
      seller_id: SELLER_2,
      estado: "asignado",
      driver_id_asignado: CONDUCTOR_1,
    });
    const sinAsignar = pedidoSeed({ seller_id: SELLER_1, estado: "pendiente_asignacion" });

    const cliente = crearClienteFalso({ pedidos: [asignado, sinAsignar] });

    const { pedidos } = await listarPedidosAsignables(cliente, filtroBase(), { pagina: 1, porPagina: 50 });

    const dtoAsignado = pedidos.find((p) => p.pedidoId === asignado.id)!;
    expect(dtoAsignado.sellerNombre).toBe("Full Import SpA");
    expect(dtoAsignado.conductorActualId).toBe(CONDUCTOR_1);
    expect(dtoAsignado.conductorActualNombre).toBe("Pedro Soto");

    const dtoSinAsignar = pedidos.find((p) => p.pedidoId === sinAsignar.id)!;
    expect(dtoSinAsignar.sellerNombre).toBe("Comercial Andes SpA");
    expect(dtoSinAsignar.conductorActualId).toBeNull();
    expect(dtoSinAsignar.conductorActualNombre).toBeNull();
  });

  it("ordena por comuna y luego por código, y el DTO no trae ningún dato personal del destinatario", async () => {
    // Comunas sin tilde a propósito: cómo ordena Postgres letras acentuadas
    // depende de la collation de la base (fuera del control de este módulo,
    // que solo llama `.order('destinatario_comuna')`), y un doble en
    // TypeScript no puede replicar esa collation de forma fiable. Lo que SÍ
    // es responsabilidad de este módulo — y lo que esta prueba fija — es que
    // ordena por comuna primero y por código después, con las dos columnas
    // del código (ml_shipment_id/codigo_interno) como criterios separados.
    const providenciaB = pedidoSeed({ destinatario_comuna: "Providencia", ml_shipment_id: "2000000000" });
    const providenciaA = pedidoSeed({ destinatario_comuna: "Providencia", ml_shipment_id: "1000000000" });
    const laFlorida = pedidoSeed({ destinatario_comuna: "La Florida", ml_shipment_id: "5000000000" });

    const cliente = crearClienteFalso({ pedidos: [providenciaB, providenciaA, laFlorida] });

    const { pedidos } = await listarPedidosAsignables(cliente, filtroBase(), { pagina: 1, porPagina: 50 });

    expect(pedidos.map((p) => p.pedidoId)).toEqual([laFlorida.id, providenciaA.id, providenciaB.id]);

    // La forma exacta del DTO — ninguna clave de dato personal del destinatario.
    expect(Object.keys(pedidos[0]).sort()).toEqual(
      [
        "pedidoId",
        "codigoVisible",
        "comuna",
        "sellerId",
        "sellerNombre",
        "estado",
        "conductorActualId",
        "conductorActualNombre",
      ].sort(),
    );
  });

  it("codigoVisible usa ml_shipment_id si existe y cae a codigo_interno si no (same-day)", async () => {
    const sameDay = pedidoSeed({ ml_shipment_id: null, codigo_interno: "RX-7K2M-9PQR" });
    const cliente = crearClienteFalso({ pedidos: [sameDay] });

    const { pedidos } = await listarPedidosAsignables(cliente, filtroBase(), { pagina: 1, porPagina: 50 });

    expect(pedidos[0].codigoVisible).toBe("RX-7K2M-9PQR");
  });
});

// =============================================================================
// resolverIdsAsignables
// =============================================================================

describe("resolverIdsAsignables", () => {
  it("supera las 1.000 filas de PostgREST sin truncarse (1.001 sembrados, 1.001 de vuelta)", async () => {
    const TOTAL = 1001;
    const pedidos = Array.from({ length: TOTAL }, () => pedidoSeed());
    const cliente = crearClienteFalso({ pedidos });

    const ids = await resolverIdsAsignables(cliente, filtroBase());

    // Sin paginar, el doble corta en 1.000 y esto daría 1.000 — nadie se
    // enteraría del que falta.
    expect(ids).toHaveLength(TOTAL);
    expect(new Set(ids).size).toBe(TOTAL);
  });

  it("aplica las dos rejas igual que el listado: descarta lo no retirado y lo en_ruta", async () => {
    const asignable = pedidoSeed({ situacion_retiro: "retirado", estado: "asignado" });
    const noRetirado = pedidoSeed({ situacion_retiro: "pendiente", estado: "pendiente_asignacion" });
    const enRuta = pedidoSeed({ situacion_retiro: "retirado", estado: "en_ruta" });

    const cliente = crearClienteFalso({ pedidos: [asignable, noRetirado, enRuta] });

    const ids = await resolverIdsAsignables(cliente, filtroBase());

    expect(ids).toEqual([asignable.id]);
  });

  it("aísla por tenant", async () => {
    const deA = pedidoSeed({ tenant_id: TENANT_A });
    const deB = pedidoSeed({ tenant_id: TENANT_B });

    const cliente = crearClienteFalso({ pedidos: [deA, deB] });

    const ids = await resolverIdsAsignables(cliente, filtroBase({ tenantId: TENANT_A }));

    expect(ids).toEqual([deA.id]);
  });

  it("filtra por comuna con la misma resolución canónica que el listado", async () => {
    const crudoMayusculas = pedidoSeed({ destinatario_comuna: "NUÑOA" });
    const otraComuna = pedidoSeed({ destinatario_comuna: "Renca" });

    const cliente = crearClienteFalso({ pedidos: [crudoMayusculas, otraComuna] });

    const ids = await resolverIdsAsignables(cliente, filtroBase({ comunas: ["Ñuñoa"] }));

    expect(ids).toEqual([crudoMayusculas.id]);
  });

  it("devuelve [] sin lanzar cuando el filtro de comuna no calza con ninguna comuna de hoy", async () => {
    const pedido = pedidoSeed({ destinatario_comuna: "Renca" });
    const cliente = crearClienteFalso({ pedidos: [pedido] });

    const ids = await resolverIdsAsignables(cliente, filtroBase({ comunas: ["Vitacura"] }));

    expect(ids).toEqual([]);
  });
});

// =============================================================================
// listarComunasConAsignables
// =============================================================================

describe("listarComunasConAsignables", () => {
  it("funde comunas que solo difieren en mayúsculas/acento y devuelve el conteo sumado", async () => {
    const pedidos = [
      pedidoSeed({ destinatario_comuna: "Maipú" }),
      pedidoSeed({ destinatario_comuna: "MAIPU" }),
      pedidoSeed({ destinatario_comuna: "Maipu" }),
    ];
    const cliente = crearClienteFalso({ pedidos });

    const resultado = await listarComunasConAsignables(cliente, { tenantId: TENANT_A, fecha: FECHA });

    expect(resultado).toEqual([{ comuna: "Maipú", total: 3 }]);
  });

  it("'sin comuna conocida' (texto en blanco) va SIEMPRE al final, aunque tenga más pedidos que cualquier comuna real", async () => {
    const conComuna = pedidoSeed({ destinatario_comuna: "Ñuñoa" });
    const sinComuna1 = pedidoSeed({ destinatario_comuna: "" });
    const sinComuna2 = pedidoSeed({ destinatario_comuna: "   " });

    const cliente = crearClienteFalso({ pedidos: [conComuna, sinComuna1, sinComuna2] });

    const resultado = await listarComunasConAsignables(cliente, { tenantId: TENANT_A, fecha: FECHA });

    expect(resultado).toEqual([
      { comuna: "Ñuñoa", total: 1 },
      { comuna: null, total: 2 },
    ]);
  });

  it("respeta las dos rejas: lo no retirado y lo en_ruta no suman al conteo", async () => {
    const cuenta = pedidoSeed({ situacion_retiro: "retirado", estado: "pendiente_asignacion", destinatario_comuna: "Renca" });
    const noRetirado = pedidoSeed({ situacion_retiro: "pendiente", estado: "pendiente_asignacion", destinatario_comuna: "Renca" });
    const enRuta = pedidoSeed({ situacion_retiro: "retirado", estado: "en_ruta", destinatario_comuna: "Renca" });

    const cliente = crearClienteFalso({ pedidos: [cuenta, noRetirado, enRuta] });

    const resultado = await listarComunasConAsignables(cliente, { tenantId: TENANT_A, fecha: FECHA });

    expect(resultado).toEqual([{ comuna: "Renca", total: 1 }]);
  });

  it("aísla por tenant", async () => {
    const deA = pedidoSeed({ tenant_id: TENANT_A, destinatario_comuna: "Renca" });
    const deB = pedidoSeed({ tenant_id: TENANT_B, destinatario_comuna: "Renca" });

    const cliente = crearClienteFalso({ pedidos: [deA, deB] });

    const resultado = await listarComunasConAsignables(cliente, { tenantId: TENANT_A, fecha: FECHA });

    expect(resultado).toEqual([{ comuna: "Renca", total: 1 }]);
  });

  it("supera las 1.000 filas de PostgREST sin truncar el conteo (1.001 sembrados en una sola comuna)", async () => {
    const TOTAL = 1001;
    const pedidos = Array.from({ length: TOTAL }, () => pedidoSeed({ destinatario_comuna: "Renca" }));
    const cliente = crearClienteFalso({ pedidos });

    const resultado = await listarComunasConAsignables(cliente, { tenantId: TENANT_A, fecha: FECHA });

    expect(resultado).toEqual([{ comuna: "Renca", total: TOTAL }]);
  });
});

// =============================================================================
// obtenerCargaConductoresDelDia
// =============================================================================

describe("obtenerCargaConductoresDelDia", () => {
  it("cuenta pedidos abiertos (no terminales) con conductor asignado, agrupados por conductor", async () => {
    const p1 = pedidoSeed({ estado: "asignado", driver_id_asignado: CONDUCTOR_1 });
    const p2 = pedidoSeed({ estado: "en_ruta", driver_id_asignado: CONDUCTOR_1 });
    const p3 = pedidoSeed({ estado: "asignado", driver_id_asignado: CONDUCTOR_2 });
    const sinConductor = pedidoSeed({ estado: "pendiente_asignacion", driver_id_asignado: null });

    const cliente = crearClienteFalso({ pedidos: [p1, p2, p3, sinConductor] });

    const carga = await obtenerCargaConductoresDelDia(cliente, { tenantId: TENANT_A, fecha: FECHA });

    expect(carga.get(CONDUCTOR_1)).toBe(2);
    expect(carga.get(CONDUCTOR_2)).toBe(1);
  });

  it("no cuenta ningún estado de ESTADOS_TERMINALES_PEDIDO aunque tenga conductor y sea de hoy", async () => {
    for (const estadoTerminal of ESTADOS_TERMINALES_PEDIDO) {
      const pedido = pedidoSeed({ estado: estadoTerminal, driver_id_asignado: CONDUCTOR_1 });
      const cliente = crearClienteFalso({ pedidos: [pedido] });

      const carga = await obtenerCargaConductoresDelDia(cliente, { tenantId: TENANT_A, fecha: FECHA });

      expect(carga.get(CONDUCTOR_1), `estado '${estadoTerminal}' no debería contar`).toBeUndefined();
    }
  });

  it("filtra por fecha_compromiso: un pedido de otro día no cuenta aunque esté abierto y asignado", async () => {
    const deOtroDia = pedidoSeed({ estado: "asignado", driver_id_asignado: CONDUCTOR_1, fecha_compromiso: MANANA });
    const cliente = crearClienteFalso({ pedidos: [deOtroDia] });

    const carga = await obtenerCargaConductoresDelDia(cliente, { tenantId: TENANT_A, fecha: FECHA });

    expect(carga.get(CONDUCTOR_1)).toBeUndefined();
  });

  it("aísla por tenant", async () => {
    const deA = pedidoSeed({ tenant_id: TENANT_A, estado: "asignado", driver_id_asignado: CONDUCTOR_1 });
    const deB = pedidoSeed({ tenant_id: TENANT_B, estado: "asignado", driver_id_asignado: CONDUCTOR_1 });

    const cliente = crearClienteFalso({ pedidos: [deA, deB] });

    const carga = await obtenerCargaConductoresDelDia(cliente, { tenantId: TENANT_A, fecha: FECHA });

    expect(carga.get(CONDUCTOR_1)).toBe(1);
  });

  it("supera las 1.000 filas de PostgREST sin truncarse", async () => {
    const TOTAL = 1001;
    const pedidos = Array.from({ length: TOTAL }, () =>
      pedidoSeed({ estado: "asignado", driver_id_asignado: CONDUCTOR_1 }),
    );
    const cliente = crearClienteFalso({ pedidos });

    const carga = await obtenerCargaConductoresDelDia(cliente, { tenantId: TENANT_A, fecha: FECHA });

    expect(carga.get(CONDUCTOR_1)).toBe(TOTAL);
  });
});

// =============================================================================
// contarAsignablesSinAsignar
// =============================================================================

describe("contarAsignablesSinAsignar", () => {
  it("cuenta solo retirado + pendiente_asignacion + hoy", async () => {
    const cuenta1 = pedidoSeed({ situacion_retiro: "retirado", estado: "pendiente_asignacion" });
    const cuenta2 = pedidoSeed({ situacion_retiro: "retirado", estado: "pendiente_asignacion" });

    const cliente = crearClienteFalso({ pedidos: [cuenta1, cuenta2] });

    const total = await contarAsignablesSinAsignar(cliente, { tenantId: TENANT_A, fecha: FECHA });

    expect(total).toBe(2);
  });

  it("no cuenta 'asignado' aunque esté retirado y sea de hoy — eso es la OTRA mitad de la bandeja", async () => {
    const yaAsignado = pedidoSeed({
      situacion_retiro: "retirado",
      estado: "asignado",
      driver_id_asignado: CONDUCTOR_1,
    });
    const cliente = crearClienteFalso({ pedidos: [yaAsignado] });

    const total = await contarAsignablesSinAsignar(cliente, { tenantId: TENANT_A, fecha: FECHA });

    expect(total).toBe(0);
  });

  it("no cuenta lo que nadie retiró", async () => {
    const noRetirado = pedidoSeed({ situacion_retiro: "pendiente", estado: "pendiente_asignacion" });
    const cliente = crearClienteFalso({ pedidos: [noRetirado] });

    expect(await contarAsignablesSinAsignar(cliente, { tenantId: TENANT_A, fecha: FECHA })).toBe(0);
  });

  it("SÍ cuenta lo retirado ayer que sigue sin asignar: el bloque no puede decir cero con paquetes en la bodega", async () => {
    const rezagado = pedidoSeed({
      situacion_retiro: "retirado",
      estado: "pendiente_asignacion",
      retirado_en: AYER_09H,
    });
    const cliente = crearClienteFalso({ pedidos: [rezagado] });

    expect(await contarAsignablesSinAsignar(cliente, { tenantId: TENANT_A, fecha: FECHA })).toBe(1);
  });

  it("aísla por tenant", async () => {
    const deA = pedidoSeed({ tenant_id: TENANT_A, situacion_retiro: "retirado", estado: "pendiente_asignacion" });
    const deB = pedidoSeed({ tenant_id: TENANT_B, situacion_retiro: "retirado", estado: "pendiente_asignacion" });

    const cliente = crearClienteFalso({ pedidos: [deA, deB] });

    const total = await contarAsignablesSinAsignar(cliente, { tenantId: TENANT_A, fecha: FECHA });

    expect(total).toBe(1);
  });
});

// =============================================================================
// ESTADOS_ASIGNABLES — el contrato del que dependen las dos rejas
// =============================================================================

describe("ESTADOS_ASIGNABLES", () => {
  it("es exactamente {pendiente_asignacion, asignado} — ni más ni menos", () => {
    expect([...ESTADOS_ASIGNABLES].sort()).toEqual(["asignado", "pendiente_asignacion"]);
  });
});
