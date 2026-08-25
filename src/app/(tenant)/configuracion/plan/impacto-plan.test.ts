import { describe, expect, it } from "vitest";

import { impactoDelPlan, type LimitesDelPlan, type UsoDelCourier } from "./impacto-plan";

const USO: UsoDelCourier = { conductores: 9, pedidosMes: 3410 };

const BODEGA: LimitesDelPlan = { conductoresMax: 6, pedidosMes: 2000 };
const FLOTA: LimitesDelPlan = { conductoresMax: 15, pedidosMes: 5000 };
const GRANDE: LimitesDelPlan = { conductoresMax: 40, pedidosMes: 12000 };
const SIN_TOPE: LimitesDelPlan = { conductoresMax: null, pedidosMes: null };

describe("impactoDelPlan", () => {
  it("🔴 bajar de plan dice cuántos conductores habría que dar de baja", () => {
    // La tarjeta decía «Hasta 6 conductores» y obligaba a restar de cabeza. El
    // precio de equivocarse es contratar un plan que te deja fuera el día 1.
    const r = impactoDelPlan(USO, BODEGA)!;
    expect(r.frase).toBe("Ya tienes 9 conductores: tendrías que dar de baja 3.");
    expect(r.tono).toBe("attention");
    expect(r.conductoresDeMas).toBe(3);
  });

  it("subir sin necesitarlo lo dice, con la cifra real", () => {
    // Decir cuándo NO hace falta es lo que hace que se le crea cuando sí.
    const r = impactoDelPlan(USO, GRANDE)!;
    expect(r.frase).toBe("Con tu ritmo de 3.410 al mes, todavía no te hace falta.");
    expect(r.tono).toBe("neutral");
  });

  it("el plan que le queda justo no dice nada", () => {
    // No se inventa un elogio. 3.410 de 5.000 es más de la mitad: ni «te falta»
    // ni «te sobra».
    expect(impactoDelPlan(USO, FLOTA)).toBeNull();
  });

  it("🔴 el plan ACTUAL no dice nada, aunque no le calce", () => {
    // Ya sabe lo que le pasa con el suyo, y una advertencia sobre el plan
    // vigente se lee como que algo se rompió.
    expect(impactoDelPlan(USO, BODEGA, true)).toBeNull();
  });

  it("lo que impide contratar manda sobre el techo de pedidos", () => {
    // Con los dos excedidos, la frase es la de conductores: es la única
    // accionable —hay que dar de baja gente— y sin eso no se puede contratar.
    const r = impactoDelPlan({ conductores: 9, pedidosMes: 9000 }, BODEGA)!;
    expect(r.frase).toContain("dar de baja");
    expect(r.frase).not.toContain("pedidos");
  });

  it("pasarse solo de pedidos dice otra cosa: no bloquea, se queda corto", () => {
    const r = impactoDelPlan({ conductores: 3, pedidosMes: 9000 }, BODEGA)!;
    expect(r.frase).toBe("Este mes llevas 9.000 pedidos y el tope es 2.000: te quedarías corto.");
    expect(r.tono).toBe("attention");
    expect(r.conductoresDeMas).toBe(0);
  });

  it("un plan sin topes nunca advierte nada", () => {
    expect(impactoDelPlan(USO, SIN_TOPE)).toBeNull();
  });

  it("⚠️ entre la mitad y el tope se calla", () => {
    // «Todavía no te hace falta» con el 90 % consumido sería un mal consejo.
    expect(impactoDelPlan({ conductores: 1, pedidosMes: 4500 }, FLOTA)).toBeNull();
    // Justo en la mitad tampoco: el umbral es estricto.
    expect(impactoDelPlan({ conductores: 1, pedidosMes: 2500 }, FLOTA)).toBeNull();
    // Por debajo, sí.
    expect(impactoDelPlan({ conductores: 1, pedidosMes: 2499 }, FLOTA)?.tono).toBe("neutral");
  });

  it("un solo conductor de más se dice en singular donde corresponde", () => {
    const r = impactoDelPlan({ conductores: 1, pedidosMes: 10 }, { conductoresMax: 0, pedidosMes: null })!;
    expect(r.frase).toBe("Ya tienes 1 conductor: tendrías que dar de baja 1.");
  });

  it("los miles van con separador chileno", () => {
    const r = impactoDelPlan({ conductores: 1, pedidosMes: 3410 }, GRANDE)!;
    expect(r.frase).toContain("3.410");
    expect(r.frase).not.toContain("3,410");
  });
});
