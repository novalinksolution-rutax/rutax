import { describe, expect, it } from "vitest";

import { interpretarEstadoCanal, PRESENTACION_EN_VIVO } from "./estado-canal";

describe("interpretarEstadoCanal", () => {
  it("sin estado todavía: conectando", () => {
    expect(interpretarEstadoCanal(null, true).estado).toBe("conectando");
  });

  it("SUBSCRIBED con token propagado: en vivo", () => {
    expect(interpretarEstadoCanal("SUBSCRIBED", true).estado).toBe("en_vivo");
  });

  /**
   * EL CASO QUE ESTUVO MINTIENDO DURANTE MESES. Con el socket autenticado como
   * `anon`, el canal reporta SUBSCRIBED igual pero el servidor descarta la
   * suscripción por RLS y no manda un solo evento. Verde ahí es la peor salida
   * posible: el coordinador mira una cifra vieja convencido de que es la de
   * ahora.
   */
  it("SUBSCRIBED SIN token propagado NO es 'en vivo'", () => {
    expect(interpretarEstadoCanal("SUBSCRIBED", false).estado).toBe("sin_actualizacion");
  });

  it("los tres estados terminales no se disfrazan de 'Conectando…'", () => {
    // Tratarlos como "conectando" deja al usuario esperando para siempre algo
    // que ya no va a ocurrir: el canal no reconecta solo desde ninguno de ellos.
    for (const estado of ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"] as const) {
      expect(interpretarEstadoCanal(estado, true).estado).toBe("sin_actualizacion");
    }
  });

  it("sin autenticar gana sobre cualquier estado del canal", () => {
    for (const estado of [null, "SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"] as const) {
      expect(interpretarEstadoCanal(estado, false).estado).toBe("sin_actualizacion");
    }
  });

  it("cada estado trae etiqueta y detalle no vacíos", () => {
    // El `detalle` es el title: si queda vacío, el usuario ve un punto de color
    // sin ninguna forma de saber qué significa.
    for (const p of Object.values(PRESENTACION_EN_VIVO)) {
      expect(p.etiqueta.length).toBeGreaterThan(0);
      expect(p.detalle.length).toBeGreaterThan(0);
    }
  });

  it("el detalle de 'sin actualización' dice qué hacer, no solo qué pasó", () => {
    expect(PRESENTACION_EN_VIVO.sin_actualizacion.detalle).toMatch(/recarga/i);
  });
});
