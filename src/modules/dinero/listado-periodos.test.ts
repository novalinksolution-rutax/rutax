import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  contarBloqueosDeFacturacion,
  etiquetaPeriodo,
  proximoCierreAutomatico,
} from "./listado-periodos";
import { ESTADOS_NO_TERMINALES_CONCILIACION } from "./conciliacion-clasificacion";

describe("proximoCierreAutomatico", () => {
  it("no dice nada cuando no hay períodos abiertos", () => {
    expect(proximoCierreAutomatico([], "2026-08-23")).toBeNull();
  });

  it("elige el `fecha_fin` más cercano y cuenta cuántos caen ese día", () => {
    const r = proximoCierreAutomatico(
      [{ fechaFin: "2026-08-31" }, { fechaFin: "2026-08-15" }, { fechaFin: "2026-08-15" }],
      "2026-08-10",
    )!;
    expect(r.fecha).toBe("2026-08-15");
    expect(r.cuantos).toBe(2);
    expect(r.vencido).toBe(false);
  });

  it("marca `vencido` cuando la fecha ya pasó y el cron todavía no corre", () => {
    // El cron cierra a las 02:00. Entre el fin del período y esa corrida hay una
    // ventana en que la pantalla diría «cierran el 15-08» estando ya en el 16 —
    // que se lee como que algo se rompió. La bandera deja escribir otra frase.
    const r = proximoCierreAutomatico([{ fechaFin: "2026-08-15" }], "2026-08-16")!;
    expect(r.vencido).toBe(true);
  });

  it("compara fechas como cadenas y no por `Date`", () => {
    // 'YYYY-MM-DD' ordena igual que la fecha. Pasar por `Date` interpretaría el
    // día como medianoche UTC y en Santiago sería el día anterior.
    const r = proximoCierreAutomatico(
      [{ fechaFin: "2026-09-01" }, { fechaFin: "2026-08-31" }],
      "2026-08-20",
    )!;
    expect(r.fecha).toBe("2026-08-31");
  });
});

describe("etiquetaPeriodo", () => {
  it("escribe el mes cuando el período es el mes entero", () => {
    expect(etiquetaPeriodo("2026-08-01", "2026-08-31")).toBe("agosto 2026");
    expect(etiquetaPeriodo("2026-04-01", "2026-04-30")).toBe("abril 2026");
    expect(etiquetaPeriodo("2026-02-01", "2026-02-28")).toBe("febrero 2026");
  });

  it("reconoce febrero bisiesto", () => {
    expect(etiquetaPeriodo("2024-02-01", "2024-02-29")).toBe("febrero 2024");
    expect(etiquetaPeriodo("2000-02-01", "2000-02-29")).toBe("febrero 2000");
    expect(etiquetaPeriodo("1900-02-01", "1900-02-28")).toBe("febrero 1900");
  });

  it("escribe el rango cuando NO es un mes entero", () => {
    // Es la mitad importante: la mayoría factura quincenal, y llamar «agosto
    // 2026» a la primera quincena deja dos períodos distintos del mismo seller
    // con la misma etiqueta.
    expect(etiquetaPeriodo("2026-08-01", "2026-08-15")).toBe("1–15 ago");
    expect(etiquetaPeriodo("2026-08-16", "2026-08-31")).toBe("16–31 ago");
  });

  it("escribe los dos meses cuando el período los cruza", () => {
    expect(etiquetaPeriodo("2026-08-26", "2026-09-10")).toBe("26 ago – 10 sep");
  });
});

// =============================================================================
// contarBloqueosDeFacturacion — la mitad que tiene que espejar al preflight
// =============================================================================

function clienteFalso(filas: { periodo_cobro_id: string | null; seller_id: string | null }[]) {
  const registro = { eq: [] as [string, unknown][], in: [] as [string, unknown][] };
  let entregado = false;

  const chain: Record<string, unknown> = {
    eq: (campo: string, valor: unknown) => {
      registro.eq.push([campo, valor]);
      return chain;
    },
    in: (campo: string, valor: unknown) => {
      registro.in.push([campo, valor]);
      return chain;
    },
    range: () => chain,
    then: (resolve: (r: { data: unknown[]; error: null }) => void) => {
      // Una sola página: la segunda vuelta de `leerTodasLasFilas` viene vacía.
      const data = entregado ? [] : filas;
      entregado = true;
      resolve({ data, error: null });
    },
  };

  const cliente = {
    schema: () => ({ from: () => ({ select: () => chain }) }),
  } as unknown as SupabaseClient;

  return { cliente, registro };
}

describe("contarBloqueosDeFacturacion", () => {
  it("no consulta nada si no hay períodos", async () => {
    const { cliente, registro } = clienteFalso([]);
    expect(await contarBloqueosDeFacturacion(cliente, "t1", [])).toEqual({});
    expect(registro.eq).toEqual([]);
  });

  it("filtra por los CUATRO estados no terminales, no por «pendiente»", async () => {
    // Es la mitad que rompe el espejo con el preflight: una excepción
    // `en_analisis` sigue bloqueando, y filtrar por `pendiente` dejaría la
    // casilla encendida sobre un período que el preflight va a rechazar.
    const { cliente, registro } = clienteFalso([]);
    await contarBloqueosDeFacturacion(cliente, "t1", [{ id: "p1", sellerId: "s1" }]);
    const filtroEstado = registro.in.find(([campo]) => campo === "estado");
    expect(filtroEstado?.[1]).toEqual(ESTADOS_NO_TERMINALES_CONCILIACION);
    expect(ESTADOS_NO_TERMINALES_CONCILIACION.length).toBe(4);
    expect(registro.eq).toContainEqual(["bloquea_facturacion", true]);
  });

  it("cuenta la excepción atada al período, y no toca a otro seller", async () => {
    const { cliente } = clienteFalso([{ periodo_cobro_id: "p1", seller_id: "s1" }]);
    const r = await contarBloqueosDeFacturacion(cliente, "t1", [
      { id: "p1", sellerId: "s1" },
      { id: "p9", sellerId: "s9" },
    ]);
    expect(r).toEqual({ p1: 1 });
  });

  it("una excepción del SELLER sin período bloquea todos sus períodos", async () => {
    // El preflight busca `periodo_cobro_id.eq.X OR seller_id.eq.Y`. Contar solo
    // por período dejaría estas filas seleccionables.
    const { cliente } = clienteFalso([{ periodo_cobro_id: null, seller_id: "s1" }]);
    const r = await contarBloqueosDeFacturacion(cliente, "t1", [
      { id: "p1", sellerId: "s1" },
      { id: "p2", sellerId: "s1" },
      { id: "p3", sellerId: "s2" },
    ]);
    expect(r).toEqual({ p1: 1, p2: 1 });
  });

  it("la excepción que NOMBRA un período bloquea igual los otros de ese seller", async () => {
    // 🐞 Encontrado en pantalla. La primera versión contaba «la del período O la
    // del seller, sin duplicar», así que una excepción atada a `p1` dejaba `p2`
    // y `p3` del mismo seller seleccionables — y el preflight los rechazaba a
    // los tres con la ceremonia ya abierta y el monto escrito en el título.
    //
    // El `.or()` del preflight es más ancho de lo que parece: la excepción trae
    // su `seller_id` igual, así que calza por ese lado para todos.
    const { cliente } = clienteFalso([{ periodo_cobro_id: "p1", seller_id: "s1" }]);
    const r = await contarBloqueosDeFacturacion(cliente, "t1", [
      { id: "p1", sellerId: "s1" },
      { id: "p2", sellerId: "s1" },
      { id: "p3", sellerId: "s2" },
    ]);
    expect(r).toEqual({ p1: 1, p2: 1 });
  });

  it("cuenta una sola vez la excepción que calza por los dos lados", async () => {
    const { cliente } = clienteFalso([
      { periodo_cobro_id: "p1", seller_id: "s1" },
      { periodo_cobro_id: null, seller_id: "s1" },
    ]);
    const r = await contarBloqueosDeFacturacion(cliente, "t1", [{ id: "p1", sellerId: "s1" }]);
    // Son DOS excepciones distintas, no una contada dos veces.
    expect(r).toEqual({ p1: 2 });
  });
});
