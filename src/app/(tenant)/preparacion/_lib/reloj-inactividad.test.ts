/**
 * Pruebas del reloj de inactividad — la pieza que más se rompe por descuido en
 * esta pantalla (ver docs/ux/etapa-5-preparacion-del-dia.md §6): si el cálculo
 * se hiciera en el servidor, el caso que más importa (un conductor que dejó de
 * escanear) es justo el que nunca dispara un refresco que lo actualice.
 */

import { describe, expect, it } from "vitest";
import {
  UMBRAL_RETIRO_SIN_NOVEDADES_MINUTOS,
  calcularEstadoReloj,
  formatearDuracion,
  textoCerradaA,
  ultimaSenalDe,
  visitaSuperaUmbral,
} from "./reloj-inactividad";

describe("formatearDuracion", () => {
  it("menos de 1 minuto: instantes", () => {
    expect(formatearDuracion(0)).toBe("instantes");
    expect(formatearDuracion(59_999)).toBe("instantes");
  });

  it("1 minuto exacto", () => {
    expect(formatearDuracion(60_000)).toBe("1 min");
  });

  it("entre 2 y 59 minutos", () => {
    expect(formatearDuracion(14 * 60_000)).toBe("14 min");
    expect(formatearDuracion(59 * 60_000)).toBe("59 min");
  });

  it("60 minutos exactos: horas sin minutos sobrantes", () => {
    expect(formatearDuracion(60 * 60_000)).toBe("1 h");
  });

  it("con minutos sobrantes", () => {
    expect(formatearDuracion(65 * 60_000)).toBe("1 h 5 min");
    expect(formatearDuracion(125 * 60_000)).toBe("2 h 5 min");
  });

  it("nunca da un tiempo negativo aunque el reloj venga desfasado", () => {
    expect(formatearDuracion(-5_000)).toBe("instantes");
  });
});

describe("ultimaSenalDe", () => {
  it("usa el último escaneo cuando existe", () => {
    expect(
      ultimaSenalDe({ ultimoEscaneoEn: "2026-08-13T12:00:00.000Z", abiertaEn: "2026-08-13T10:00:00.000Z" }),
    ).toBe("2026-08-13T12:00:00.000Z");
  });

  it("cae a la hora de apertura cuando todavía no hay escaneos", () => {
    expect(
      ultimaSenalDe({ ultimoEscaneoEn: null, abiertaEn: "2026-08-13T10:00:00.000Z" }),
    ).toBe("2026-08-13T10:00:00.000Z");
  });
});

describe("visitaSuperaUmbral", () => {
  const abiertaEn = "2026-08-13T12:00:00.000Z";

  it(`justo en los ${UMBRAL_RETIRO_SIN_NOVEDADES_MINUTOS} min no supera todavía ("superó" es estrictamente mayor)`, () => {
    const ahoraMs = new Date(abiertaEn).getTime() + UMBRAL_RETIRO_SIN_NOVEDADES_MINUTOS * 60_000;
    expect(visitaSuperaUmbral({ ultimoEscaneoEn: null, abiertaEn, ahoraMs })).toBe(false);
  });

  it("un segundo más allá del umbral sí supera", () => {
    const ahoraMs = new Date(abiertaEn).getTime() + UMBRAL_RETIRO_SIN_NOVEDADES_MINUTOS * 60_000 + 1_000;
    expect(visitaSuperaUmbral({ ultimoEscaneoEn: null, abiertaEn, ahoraMs })).toBe(true);
  });

  it("bajo el umbral no supera", () => {
    const ahoraMs = new Date(abiertaEn).getTime() + 5 * 60_000;
    expect(visitaSuperaUmbral({ ultimoEscaneoEn: null, abiertaEn, ahoraMs })).toBe(false);
  });

  it("cuenta desde el ÚLTIMO ESCANEO, no desde la apertura, cuando ya hay alguno", () => {
    // Abierta hace 40 min, pero con un escaneo hace 2 min: sigue tranquila.
    const ultimoEscaneoEn = "2026-08-13T12:38:00.000Z";
    const ahoraMs = new Date("2026-08-13T12:40:00.000Z").getTime();
    expect(visitaSuperaUmbral({ ultimoEscaneoEn, abiertaEn, ahoraMs })).toBe(false);
  });

  it("un reloj de cliente desfasado hacia atrás no revienta a negativo ni marca aviso falso", () => {
    const ahoraMs = new Date(abiertaEn).getTime() - 60_000; // "ahora" antes que la señal
    expect(visitaSuperaUmbral({ ultimoEscaneoEn: null, abiertaEn, ahoraMs })).toBe(false);
  });
});

describe("calcularEstadoReloj — las cuatro combinaciones de §6, nunca más", () => {
  const abiertaEn = "2026-08-13T12:00:00.000Z";

  it("ya hay escaneos + bajo el umbral → 'Último escaneo hace {t}', gris", () => {
    const ultimoEscaneoEn = "2026-08-13T12:18:00.000Z";
    const ahoraMs = new Date("2026-08-13T12:20:00.000Z").getTime();
    const estado = calcularEstadoReloj({ ultimoEscaneoEn, abiertaEn, ahoraMs });
    expect(estado.texto).toBe("Último escaneo hace 2 min");
    expect(estado.enAviso).toBe(false);
    expect(estado.senalEn).toBe(ultimoEscaneoEn);
  });

  it("ya hay escaneos + sobre el umbral → 'Sin escaneos hace {t}', ámbar", () => {
    const ultimoEscaneoEn = "2026-08-13T12:00:00.000Z";
    const ahoraMs = new Date("2026-08-13T12:14:00.000Z").getTime();
    const estado = calcularEstadoReloj({ ultimoEscaneoEn, abiertaEn, ahoraMs });
    expect(estado.texto).toBe("Sin escaneos hace 14 min");
    expect(estado.enAviso).toBe(true);
  });

  it("sin escaneos todavía + bajo el umbral → 'En la bodega hace {t}', gris", () => {
    const ahoraMs = new Date(abiertaEn).getTime() + 3 * 60_000;
    const estado = calcularEstadoReloj({ ultimoEscaneoEn: null, abiertaEn, ahoraMs });
    expect(estado.texto).toBe("En la bodega hace 3 min");
    expect(estado.enAviso).toBe(false);
    expect(estado.senalEn).toBe(abiertaEn);
  });

  it("sin escaneos todavía + sobre el umbral → 'Sin escaneos hace {t}, desde que llegó', ámbar", () => {
    const ahoraMs = new Date(abiertaEn).getTime() + 45 * 60_000;
    const estado = calcularEstadoReloj({ ultimoEscaneoEn: null, abiertaEn, ahoraMs });
    expect(estado.texto).toBe("Sin escaneos hace 45 min, desde que llegó");
    expect(estado.enAviso).toBe(true);
  });
});

describe("textoCerradaA", () => {
  it("formatea en hora de Santiago explícita (invierno, CLT = UTC-4), no la del navegador", () => {
    // Mismo fixture que src/lib/fecha-santiago.test.ts para horaLocalEnSantiago:
    // agosto es invierno chileno (CLT, UTC-4).
    expect(textoCerradaA("2026-08-13T22:00:00.000Z")).toBe("Cerrada a las 18:00");
  });

  it("formatea en hora de Santiago explícita (verano, CLST = UTC-3)", () => {
    expect(textoCerradaA("2026-01-15T22:00:00.000Z")).toBe("Cerrada a las 19:00");
  });
});
