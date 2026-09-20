import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerConfigCanalConsulta } from "./canal";

function clienteConRpc(fila: {
  canal_activo: boolean;
  tope_consultas_hora: number;
  tope_intentos_sin_match_hora: number;
  configurado: boolean;
} | null, mensajeError?: string) {
  const llamadas: Array<{ fn: string; args: unknown }> = [];
  const cliente = {
    rpc(fn: string, args: unknown) {
      llamadas.push({ fn, args });
      return {
        single: () =>
          mensajeError
            ? Promise.resolve({ data: null, error: { message: mensajeError } })
            : Promise.resolve({ data: fila, error: null }),
      };
    },
  } as unknown as SupabaseClient;
  return { cliente, llamadas };
}

describe("leerConfigCanalConsulta", () => {
  it("courier con fila y canal encendido", async () => {
    const { cliente } = clienteConRpc({
      canal_activo: true,
      tope_consultas_hora: 30,
      tope_intentos_sin_match_hora: 8,
      configurado: true,
    });

    const config = await leerConfigCanalConsulta(cliente, "tenant-1");

    expect(config).toEqual({
      canalActivo: true,
      topeConsultasHora: 30,
      topeIntentosSinMatchHora: 8,
      configurado: true,
    });
  });

  it("courier SIN fila → apagado con los topes por defecto (nunca null)", async () => {
    const { cliente } = clienteConRpc({
      canal_activo: false,
      tope_consultas_hora: 20,
      tope_intentos_sin_match_hora: 5,
      configurado: false,
    });

    const config = await leerConfigCanalConsulta(cliente, "tenant-sin-fila");

    expect(config.canalActivo).toBe(false);
    expect(config.configurado).toBe(false);
    expect(config.topeConsultasHora).toBe(20);
    expect(config.topeIntentosSinMatchHora).toBe(5);
  });

  it("llama a la función RPC fail-closed, nunca a un select crudo", async () => {
    const { cliente, llamadas } = clienteConRpc({
      canal_activo: false,
      tope_consultas_hora: 20,
      tope_intentos_sin_match_hora: 5,
      configurado: false,
    });

    await leerConfigCanalConsulta(cliente, "tenant-1");

    expect(llamadas).toEqual([
      { fn: "whatsapp_canal_consulta_config", args: { p_tenant_id: "tenant-1" } },
    ]);
  });

  it("propaga el error de la RPC en vez de asumir apagado en silencio", async () => {
    const { cliente } = clienteConRpc(null, "boom");
    await expect(leerConfigCanalConsulta(cliente, "tenant-1")).rejects.toThrow(/boom/);
  });
});
