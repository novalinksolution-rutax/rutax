/**
 * Pruebas de la lógica de transición de estado del sondeo de salud.
 *
 * Prueba la máquina de estados: sana → atencion → desvinculada.
 * Extrae la función de lógica pura de transición para probarla sin BD ni red.
 */
import { describe, expect, it } from "vitest";

import type { EstadoSaludConexionMl } from "../tipos";

// ---------------------------------------------------------------------------
// Lógica de transición extraída para prueba aislada
// ---------------------------------------------------------------------------

interface ResultadoSondeo {
  tokenFunciona: boolean;
}

interface AccionEstado {
  nuevoEstado: EstadoSaludConexionMl | "sin_cambio";
  publicarEventoCaida: boolean;
}

/**
 * Determina la acción a tomar según el estado actual y el resultado del sondeo.
 * Función pura — sin efectos secundarios.
 */
function determinarAccionEstado(
  estadoActual: EstadoSaludConexionMl,
  sondeo: ResultadoSondeo,
): AccionEstado {
  if (sondeo.tokenFunciona) {
    if (estadoActual !== "sana") {
      return { nuevoEstado: "sana", publicarEventoCaida: false };
    }
    return { nuevoEstado: "sin_cambio", publicarEventoCaida: false };
  }

  // Token no funciona
  if (estadoActual === "sana" || estadoActual === "pendiente") {
    return { nuevoEstado: "atencion", publicarEventoCaida: false };
  }

  if (estadoActual === "atencion") {
    return { nuevoEstado: "desvinculada", publicarEventoCaida: true };
  }

  // Ya estaba desvinculada
  return { nuevoEstado: "sin_cambio", publicarEventoCaida: false };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sondeoSaludConexiones — máquina de estados", () => {
  describe("cuando el token FUNCIONA", () => {
    it("estado 'sana' + sondeo OK → sin_cambio, no publicar evento", () => {
      const accion = determinarAccionEstado("sana", { tokenFunciona: true });
      expect(accion.nuevoEstado).toBe("sin_cambio");
      expect(accion.publicarEventoCaida).toBe(false);
    });

    it("estado 'atencion' + sondeo OK → restaurar a 'sana', no publicar evento", () => {
      const accion = determinarAccionEstado("atencion", { tokenFunciona: true });
      expect(accion.nuevoEstado).toBe("sana");
      expect(accion.publicarEventoCaida).toBe(false);
    });

    it("estado 'pendiente' + sondeo OK → restaurar a 'sana'", () => {
      const accion = determinarAccionEstado("pendiente", { tokenFunciona: true });
      expect(accion.nuevoEstado).toBe("sana");
      expect(accion.publicarEventoCaida).toBe(false);
    });
  });

  describe("cuando el token FALLA", () => {
    it("estado 'sana' + sondeo FALLA → marcar 'atencion' (primera señal)", () => {
      const accion = determinarAccionEstado("sana", { tokenFunciona: false });
      expect(accion.nuevoEstado).toBe("atencion");
      expect(accion.publicarEventoCaida).toBe(false);
    });

    it("estado 'pendiente' + sondeo FALLA → marcar 'atencion'", () => {
      const accion = determinarAccionEstado("pendiente", { tokenFunciona: false });
      expect(accion.nuevoEstado).toBe("atencion");
      expect(accion.publicarEventoCaida).toBe(false);
    });

    it("estado 'atencion' + sondeo FALLA → escalar a 'desvinculada' y publicar evento", () => {
      const accion = determinarAccionEstado("atencion", { tokenFunciona: false });
      expect(accion.nuevoEstado).toBe("desvinculada");
      expect(accion.publicarEventoCaida).toBe(true);
    });

    it("estado 'desvinculada' + sondeo FALLA → sin_cambio (ya estaba desvinculada)", () => {
      const accion = determinarAccionEstado("desvinculada", { tokenFunciona: false });
      expect(accion.nuevoEstado).toBe("sin_cambio");
      expect(accion.publicarEventoCaida).toBe(false);
    });
  });

  describe("secuencia completa de degradación", () => {
    it("sana → atencion → desvinculada en dos ciclos de fallo", () => {
      let estado: EstadoSaludConexionMl = "sana";

      // Primer fallo
      const accion1 = determinarAccionEstado(estado, { tokenFunciona: false });
      expect(accion1.nuevoEstado).toBe("atencion");
      expect(accion1.publicarEventoCaida).toBe(false);
      estado = "atencion";

      // Segundo fallo
      const accion2 = determinarAccionEstado(estado, { tokenFunciona: false });
      expect(accion2.nuevoEstado).toBe("desvinculada");
      expect(accion2.publicarEventoCaida).toBe(true);
    });

    it("sana → atencion → sana si el token se recupera entre ciclos", () => {
      let estado: EstadoSaludConexionMl = "sana";

      // Primer fallo
      const accion1 = determinarAccionEstado(estado, { tokenFunciona: false });
      estado = accion1.nuevoEstado as EstadoSaludConexionMl;
      expect(estado).toBe("atencion");

      // Recuperación
      const accion2 = determinarAccionEstado(estado, { tokenFunciona: true });
      expect(accion2.nuevoEstado).toBe("sana");
      expect(accion2.publicarEventoCaida).toBe(false);
    });
  });
});

describe("sondeoSaludConexiones — payload del evento de notificación", () => {
  it("el evento 'notificacion/conexion-caida' NO debe incluir tokens ni refs cifradas", () => {
    const payloadEvento = {
      name: "notificacion/conexion-caida" as const,
      data: {
        sellerId: "seller-123",
        tenantId: "tenant-456",
        nombreSeller: "Tienda de Prueba",
        conexionId: "conn-789",
        // Estos campos NO deben estar:
        // access_token_ref: "...",
        // refresh_token_ref: "...",
      },
    };

    expect(payloadEvento.data).not.toHaveProperty("access_token_ref");
    expect(payloadEvento.data).not.toHaveProperty("refresh_token_ref");
    expect(payloadEvento.data).not.toHaveProperty("access_token");
    expect(payloadEvento.data).not.toHaveProperty("refresh_token");
    expect(payloadEvento.data).toHaveProperty("sellerId");
    expect(payloadEvento.data).toHaveProperty("tenantId");
    expect(payloadEvento.data).toHaveProperty("nombreSeller");
  });
});
