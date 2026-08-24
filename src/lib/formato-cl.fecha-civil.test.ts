/**
 * Red del segundo defecto de fechas: **una fecha civil no debe pasar por `Date`.**
 *
 * `formato-cl.zona-horaria.test.ts` cubre el primero —formatear un instante sin
 * fijar `timeZone`—. Éste cubre el contrario, que muerde justo cuando el primero
 * está bien resuelto: si a un formateador **correctamente anclado a Santiago** se
 * le pasa un `YYYY-MM-DD`, `new Date` lo interpreta como medianoche UTC y en
 * Santiago eso es el día anterior a las 20:00. El formateador hace su trabajo; el
 * dato ya venía corrido.
 *
 * Lo tenía la pantalla de Pedidos: el chip del filtro decía `23-08` con el filtro
 * puesto en el 24. Se ve razonable —un día, del mes correcto— y por eso nadie lo
 * mira dos veces.
 */
import { describe, expect, it } from "vitest";

import {
  formatearFechaCivilCorta,
  formatearFechaCivilLarga,
  formatearFechaCorta,
} from "./formato-cl";

describe("formatearFechaCivilCorta", () => {
  it("no corre el día hacia atrás", () => {
    expect(formatearFechaCivilCorta("2026-08-24")).toBe("24-08");
    expect(formatearFechaCivilCorta("2026-01-01")).toBe("01-01");
    expect(formatearFechaCivilCorta("2026-12-31")).toBe("31-12");
  });

  it("es indiferente al huso del runtime, que es todo el punto", () => {
    // Sin `Date` de por medio no hay nada que un cambio de zona pueda mover.
    const antes = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      expect(formatearFechaCivilCorta("2026-08-24")).toBe("24-08");
      process.env.TZ = "Pacific/Kiritimati"; // UTC+14
      expect(formatearFechaCivilCorta("2026-08-24")).toBe("24-08");
    } finally {
      process.env.TZ = antes;
    }
  });

  it("devuelve la raya ante algo que no es una fecha civil", () => {
    expect(formatearFechaCivilCorta("")).toBe("—");
    expect(formatearFechaCivilCorta("24-08-2026")).toBe("—");
    expect(formatearFechaCivilCorta("2026-08-24T10:00:00Z")).toBe("—");
  });

  it("documenta el defecto que motivó el helper", () => {
    // Contraprueba: el formateador de instantes SÍ corre el día con un
    // `YYYY-MM-DD`. Si algún día dejara de hacerlo, esta prueba avisa de que la
    // razón de existir del helper cambió — no de que algo se rompió.
    expect(formatearFechaCorta("2026-08-24")).toBe("23-08");
  });
});

describe("formatearFechaCivilLarga", () => {
  it("no corre el día, y el mes va en minúscula", () => {
    expect(formatearFechaCivilLarga("2026-08-05")).toBe("5 de agosto de 2026");
    expect(formatearFechaCivilLarga("2026-01-01")).toBe("1 de enero de 2026");
    expect(formatearFechaCivilLarga("2026-12-31")).toBe("31 de diciembre de 2026");
  });

  it("no rellena el día con cero: se escribe «5», no «05»", () => {
    expect(formatearFechaCivilLarga("2026-03-07")).toBe("7 de marzo de 2026");
  });

  it("devuelve la raya ante un mes imposible o una cadena que no es fecha", () => {
    expect(formatearFechaCivilLarga("2026-13-01")).toBe("—");
    expect(formatearFechaCivilLarga("ayer")).toBe("—");
  });
});
