import { describe, it, expect } from "vitest";

import { diasHasta, hitoDe, HITOS_AVISO } from "./alerta-certificado-por-vencer";

/**
 * El aviso de certificado por vencer.
 *
 * Lo que se prueba es **cuándo avisa y cuándo no**, que es donde este job se
 * rompe de las dos formas posibles: no avisar nunca —y el courier se queda sin
 * poder facturar— o avisar todos los días, que enseña a archivar sin leer y
 * termina en lo mismo.
 */

describe("diasHasta", () => {
  it("cuenta días civiles", () => {
    expect(diasHasta("2026-09-12", "2026-08-13")).toBe(30);
    expect(diasHasta("2026-08-14", "2026-08-13")).toBe(1);
    expect(diasHasta("2026-08-13", "2026-08-13")).toBe(0);
  });

  it("una fecha ya pasada da negativo", () => {
    expect(diasHasta("2026-08-10", "2026-08-13")).toBe(-3);
  });

  it("cruza el cambio de mes y de año sin perder un día", () => {
    expect(diasHasta("2026-09-01", "2026-08-31")).toBe(1);
    expect(diasHasta("2027-01-01", "2026-12-31")).toBe(1);
  });

  it("🐞 el cambio de horario NO come un día", () => {
    // Chile mueve el reloj una hora en septiembre. Restando desde medianoche,
    // 30 días con un cambio de hora dan 29,96 y `Math.floor` devolvería 29: el
    // aviso del hito 30 no saldría NUNCA. Por eso las fechas se llevan a
    // mediodía UTC antes de restar.
    expect(diasHasta("2026-10-05", "2026-09-05")).toBe(30);
    expect(diasHasta("2026-04-05", "2026-03-06")).toBe(30);
  });

  it("es simétrico con el año bisiesto", () => {
    expect(diasHasta("2028-03-01", "2028-02-28")).toBe(2); // 2028 es bisiesto
  });
});

describe("hitoDe", () => {
  it("avisa a 30, 7 y 1 día", () => {
    expect(hitoDe(30)).toBe(30);
    expect(hitoDe(7)).toBe(7);
    expect(hitoDe(1)).toBe(1);
  });

  it("SOLO el día exacto: no avisa todos los días desde el 30", () => {
    // Un `<=` mandaría treinta correos seguidos, y treinta correos enseñan a
    // archivar sin leer — que es justo lo que no puede pasar con el último.
    expect(hitoDe(29)).toBeNull();
    expect(hitoDe(15)).toBeNull();
    expect(hitoDe(8)).toBeNull();
    expect(hitoDe(2)).toBeNull();
  });

  it("el día que vence, y cualquier día después, es el hito 0", () => {
    // Dice otra cosa: no «va a pasar» sino «ya pasó y no puedes emitir».
    expect(hitoDe(0)).toBe(0);
    expect(hitoDe(-1)).toBe(0);
    expect(hitoDe(-400)).toBe(0);
  });

  it("los hitos van de mayor a menor y el último es el vencimiento", () => {
    expect([...HITOS_AVISO]).toEqual([30, 7, 1, 0]);
  });

  it("son tres avisos antes, no uno: renovar es un trámite", () => {
    // Lo emite un proveedor acreditado, hay que pagarlo y validar identidad. Un
    // solo aviso a 7 días llega tarde para eso.
    const antesDeVencer = HITOS_AVISO.filter((h) => h > 0);
    expect(antesDeVencer).toHaveLength(3);
    expect(Math.max(...antesDeVencer)).toBeGreaterThanOrEqual(30);
  });
});
