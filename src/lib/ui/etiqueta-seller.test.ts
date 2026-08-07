import { describe, expect, it } from "vitest";
import { etiquetaSellerConEstado, traducirEstadoSeller } from "./traduccion-estados";

/**
 * El rótulo de estado en los selectores de seller existe para responder una
 * pregunta concreta que se hizo en uso real: "veo el nombre de un seller que
 * nunca terminó de registrarse — ¿está bien que aparezca?".
 *
 * Sí está bien: el seller es un CLIENTE que el courier dio de alta, y puede
 * tener pedidos aunque nadie de esa empresa haya entrado nunca al portal
 * (el courier le crea same-day). Esconderlo rompería el filtro del courier.
 * Lo que faltaba era explicarlo, no ocultarlo.
 */
describe("etiquetaSellerConEstado", () => {
  it("no dice nada cuando el seller está activo — el caso normal no necesita rótulo", () => {
    expect(etiquetaSellerConEstado("Comercial Andes", "activo")).toBe("Comercial Andes");
  });

  it("cuelga el estado cuando el seller aún no entró al portal", () => {
    expect(etiquetaSellerConEstado("Comercial Andes", "invitado")).toBe("Comercial Andes · Invitado");
  });

  it("también marca al suspendido", () => {
    expect(etiquetaSellerConEstado("Comercial Andes", "suspendido")).toBe(
      "Comercial Andes · Suspendido",
    );
  });

  it("degrada sin romper si el estado falta o viene vacío", () => {
    expect(etiquetaSellerConEstado("Comercial Andes", null)).toBe("Comercial Andes");
    expect(etiquetaSellerConEstado("Comercial Andes", undefined)).toBe("Comercial Andes");
    expect(etiquetaSellerConEstado("Comercial Andes", "")).toBe("Comercial Andes");
  });

  it("un estado desconocido se muestra crudo en vez de desaparecer", () => {
    expect(etiquetaSellerConEstado("Comercial Andes", "estado_futuro")).toBe(
      "Comercial Andes · estado_futuro",
    );
  });
});

describe("traducirEstadoSeller", () => {
  it("traduce los tres estados del catálogo", () => {
    expect(traducirEstadoSeller("invitado")).toBe("Invitado");
    expect(traducirEstadoSeller("activo")).toBe("Activo");
    expect(traducirEstadoSeller("suspendido")).toBe("Suspendido");
  });

  it("devuelve el valor crudo si el estado no está en el catálogo", () => {
    expect(traducirEstadoSeller("otra_cosa")).toBe("otra_cosa");
  });
});
