import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/service-role", () => ({ crearClienteServiceRole: () => ({ rpc }) }));

const { jobPurgarTextoEntrantesWhatsApp } = await import("./purgar-texto-entrantes");

/** Ejecuta el handler del job con un `step.run` que corre el paso de verdad. */
async function correrJob() {
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
  const step = { run: async (_id: string, fn: () => Promise<unknown>) => fn() };
  // @ts-expect-error — se invoca el handler directo, sin el runtime de Inngest.
  const salida = await jobPurgarTextoEntrantesWhatsApp.fn({ step, logger });
  return { salida, logger };
}

describe("purga del texto de mensajes entrantes (retención 90 días)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("llama en bucle hasta que la base devuelve 0 y suma lo purgado", async () => {
    rpc
      .mockResolvedValueOnce({ data: 2000, error: null })
      .mockResolvedValueOnce({ data: 340, error: null })
      .mockResolvedValueOnce({ data: 0, error: null });

    const { salida } = await correrJob();

    expect(salida).toMatchObject({ purgados: 2340, tandas: 3, topeAlcanzado: false });
    expect(rpc).toHaveBeenCalledWith("whatsapp_entrantes_purgar_texto", { p_dias: 90, p_tope: 2000 });
  });

  it("nada que purgar: una sola llamada, sin ruido", async () => {
    rpc.mockResolvedValue({ data: 0, error: null });
    const { salida, logger } = await correrJob();
    expect(salida).toMatchObject({ purgados: 0, tandas: 1 });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("un fallo LANZA: una purga que no corre es una retención incumplida en silencio", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "sin permiso" } });
    await expect(correrJob()).rejects.toThrow(/purgar el texto entrante/);
  });

  it("si queda cola, avisa en vez de quedarse iterando para siempre", async () => {
    rpc.mockResolvedValue({ data: 2000, error: null });
    const { salida, logger } = await correrJob();
    expect(salida).toMatchObject({ tandas: 50, topeAlcanzado: true });
    expect(logger.warn).toHaveBeenCalled();
  });
});
