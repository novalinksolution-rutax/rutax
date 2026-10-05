import { describe, expect, it } from "vitest";

import { AutocompletadoStub } from "./autocompletado-stub";

describe("AutocompletadoStub: la sugerencia es calle y número, como la de Google", () => {
  const stub = new AutocompletadoStub();

  it("quita la comuna escrita al final y la ofrece como comuna", async () => {
    const r = await stub.sugerir({ consulta: "La montaña sur 4603 lampa" });
    expect(r).toHaveLength(1);
    expect(r[0].principal).toBe("La montaña sur 4603");
    expect(r[0].secundaria).toContain("Lampa");
  });

  it("entiende la comuna sin acento y con coma", async () => {
    const r = await stub.sugerir({ consulta: "Av. Pajaritos 1234, maipu" });
    expect(r[0].principal).toBe("Av. Pajaritos 1234");
    expect(r[0].secundaria).toContain("Maipú");
  });

  it("no toca la comuna cuando es el nombre de la calle", async () => {
    const r = await stub.sugerir({ consulta: "Av Providencia 1234" });
    expect(r.every((s) => s.principal === "Av Providencia 1234")).toBe(true);
  });

  it("al resolver devuelve la calle sin comuna y la comuna aparte", async () => {
    const [sug] = await stub.sugerir({ consulta: "La montaña sur 4603 lampa" });
    const d = await stub.resolver({ id: sug.id });
    expect(d?.direccionCorta).toBe("La montaña sur 4603");
    expect(d?.comuna).toBe("Lampa");
  });

  it("sin comuna escrita no inventa comunas: una sola sugerencia, sin comuna", async () => {
    const r = await stub.sugerir({ consulta: "La Montaña sur 4603" });
    expect(r).toHaveLength(1);
    expect(r[0].principal).toBe("La Montaña sur 4603");
    expect(r[0].secundaria).toBe("Región Metropolitana, Chile");
    const d = await stub.resolver({ id: r[0].id });
    expect(d?.direccionCorta).toBe("La Montaña sur 4603");
    expect(d?.comuna).toBeNull();
    expect(d?.lat).toBeNull();
  });
});
