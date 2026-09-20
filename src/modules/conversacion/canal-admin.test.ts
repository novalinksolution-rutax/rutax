import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const registrarEnBitacora = vi.fn().mockResolvedValue(undefined);
vi.mock("@/modules/identidad/auditoria", () => ({ registrarEnBitacora }));

const { guardarConfigCanalConsulta } = await import("./canal-admin");

function clienteFake(opts: { metadatos?: object | null; errorUpsert?: string } = {}) {
  const llamadas: string[] = [];
  const cliente = {
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: opts.metadatos ?? { actualizado_por: null, actualizado_en: null, nota: null },
                error: null,
              }),
          }),
        }),
        upsert: (_row: unknown) => {
          llamadas.push("upsert");
          return opts.errorUpsert
            ? Promise.resolve({ error: { message: opts.errorUpsert } })
            : Promise.resolve({ error: null });
        },
      }),
    }),
    rpc: () =>
      ({
        single: () =>
          Promise.resolve({
            data: {
              canal_activo: false,
              tope_consultas_hora: 20,
              tope_intentos_sin_match_hora: 5,
              configurado: false,
            },
            error: null,
          }),
      }) as unknown,
  } as unknown as SupabaseClient;
  return { cliente, llamadas };
}

describe("guardarConfigCanalConsulta", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rechaza tope_consultas_hora fuera de rango sin tocar la base", async () => {
    const { cliente, llamadas } = clienteFake();
    const resultado = await guardarConfigCanalConsulta(cliente, {
      tenantId: "t1",
      actorUsuarioId: "u1",
      canalActivo: true,
      topeConsultasHora: 500,
      topeIntentosSinMatchHora: 5,
      nota: null,
    });

    expect(resultado.ok).toBe(false);
    expect(llamadas).toHaveLength(0);
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it("rechaza que el umbral de barrido supere al tope general", async () => {
    const { cliente } = clienteFake();
    const resultado = await guardarConfigCanalConsulta(cliente, {
      tenantId: "t1",
      actorUsuarioId: "u1",
      canalActivo: true,
      topeConsultasHora: 5,
      topeIntentosSinMatchHora: 10,
      nota: null,
    });
    expect(resultado.ok).toBe(false);
  });

  it("bitácora se escribe ANTES del upsert, con el actor", async () => {
    const orden: string[] = [];
    registrarEnBitacora.mockImplementation(async () => {
      orden.push("bitacora");
    });
    const { cliente } = clienteFake();

    const resultado = await guardarConfigCanalConsulta(cliente, {
      tenantId: "t1",
      actorUsuarioId: "u1",
      canalActivo: true,
      topeConsultasHora: 20,
      topeIntentosSinMatchHora: 5,
      nota: "piloto",
    });

    expect(resultado.ok).toBe(true);
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: "t1",
        actorUsuarioId: "u1",
        actorTipo: "super_admin",
        accion: "conversacion.canal_config_actualizado",
      }),
    );
  });

  it("propaga el fallo del upsert como resultado, no como excepción", async () => {
    const { cliente } = clienteFake({ errorUpsert: "boom" });
    const resultado = await guardarConfigCanalConsulta(cliente, {
      tenantId: "t1",
      actorUsuarioId: "u1",
      canalActivo: true,
      topeConsultasHora: 20,
      topeIntentosSinMatchHora: 5,
      nota: null,
    });
    expect(resultado).toEqual({ ok: false, mensaje: "No se pudo guardar la configuración del canal." });
  });
});
