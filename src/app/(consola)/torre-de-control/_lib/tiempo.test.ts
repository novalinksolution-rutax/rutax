/**
 * Tests de tiempo de la Torre de control.
 * =====================================================================
 *
 * El caso que motiva este archivo apareció mirando la pantalla, no leyendo el
 * código: el chip de hito vencido mostraba «18 JUL» con la fixture en
 * `2026-07-19`.
 *
 * Causa: una fecha civil desnuda (`YYYY-MM-DD`) NO es un instante. `new Date()`
 * la parsea como medianoche UTC, y al formatearla en Santiago —−04:00 en
 * invierno, −03:00 en verano— retrocede al día anterior. El contrato tiene
 * varios campos así: `HitoPreparacion.fechaLimite`, `OlaEntrante.diaCritico`,
 * `fechaLimiteCompraPorZona[].fecha`, `PronosticoAire.fecha` y
 * `RestriccionVehicular.fecha`. Todos se corrían un día.
 *
 * Es la misma clase de bug que el módulo persigue en el servidor, así que se
 * fija con tests en vez de con un comentario.
 */

import { describe, it, expect } from "vitest";
import {
  fechaCortaSantiago,
  diaYMesCorto,
  rangoFechasCorto,
  horaSantiago,
  minutosDesdeSantiago,
} from "./tiempo";

describe("fechas civiles desnudas (YYYY-MM-DD) — no se corren un día", () => {
  it("respeta el día tal como viene", () => {
    expect(diaYMesCorto("2026-07-19")).toEqual({ dia: 19, mes: "jul" });
  });

  it("2026-07-19 es domingo, no sábado", () => {
    // El bug daba "sáb 18 jul": retrocedía el día Y con él el día de semana.
    expect(fechaCortaSantiago("2026-07-19")).toBe("dom 19 jul");
  });

  it("el 1 de cada mes no retrocede al mes anterior", () => {
    // El caso más visible del bug: 2026-08-01 caía en 31 de julio.
    expect(fechaCortaSantiago("2026-08-01")).toBe("sáb 1 ago");
  });

  it("el 1 de enero no retrocede al año anterior", () => {
    expect(diaYMesCorto("2026-01-01")).toEqual({ dia: 1, mes: "ene" });
  });

  it("funciona igual en verano, cuando Santiago es −03:00", () => {
    // Un offset hardcodeado acertaría en una estación y fallaría en la otra.
    expect(fechaCortaSantiago("2026-01-15")).toBe("jue 15 ene");
  });

  it("arma rangos sin correr los extremos", () => {
    expect(rangoFechasCorto("2026-08-03", "2026-08-08")).toBe("3–8 ago");
    expect(rangoFechasCorto("2026-07-29", "2026-08-03")).toBe("29 jul – 3 ago");
  });
});

describe("instantes con offset — se resuelven en hora de Santiago", () => {
  const AHORA = "2026-07-25T09:14:00-04:00";

  it("lee la hora local declarada", () => {
    expect(horaSantiago(AHORA)).toBe("09:14");
    expect(fechaCortaSantiago(AHORA)).toBe("sáb 25 jul");
  });

  it("convierte desde UTC a hora de Santiago, no la toma literal", () => {
    // 13:14 UTC son las 09:14 en Santiago (invierno, −04:00): mismo instante.
    expect(horaSantiago("2026-07-25T13:14:00Z")).toBe("09:14");
  });

  it("un instante nocturno UTC sigue siendo el día anterior en Santiago", () => {
    // 2026-07-26T02:00Z son las 22:00 del 25 en Santiago. Es exactamente el
    // escenario que vacía las pantallas del día en el resto del producto.
    expect(fechaCortaSantiago("2026-07-26T02:00:00Z")).toBe("sáb 25 jul");
  });

  it("mide minutos desde las 08:00 para la escala de la línea de tiempo", () => {
    expect(minutosDesdeSantiago(AHORA)).toBeCloseTo(74, 5);
  });
});
