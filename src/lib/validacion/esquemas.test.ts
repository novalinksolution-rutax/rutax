/**
 * Tests de los esquemas de validación compartidos (zod).
 */

import { describe, it, expect } from "vitest";
import { esquemaUuid, esquemaMotivo } from "./esquemas";

describe("esquemaUuid", () => {
  it("acepta un UUID válido", () => {
    expect(esquemaUuid.safeParse("3f2504e0-4f89-41d3-9a0c-0305e82c3301").success).toBe(true);
  });

  it("rechaza strings que no son UUID", () => {
    for (const malo of ["periodo-1", "", "123", "no-es-uuid"]) {
      expect(esquemaUuid.safeParse(malo).success).toBe(false);
    }
  });
});

describe("esquemaMotivo", () => {
  it("acepta texto y lo recorta (trim)", () => {
    const r = esquemaMotivo.safeParse("  tarifa errada  ");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("tarifa errada");
  });

  it("rechaza vacío o solo espacios", () => {
    for (const malo of ["", "   ", "\n\t"]) {
      expect(esquemaMotivo.safeParse(malo).success).toBe(false);
    }
  });

  it("rechaza un motivo demasiado largo (>500)", () => {
    expect(esquemaMotivo.safeParse("a".repeat(501)).success).toBe(false);
  });
});
