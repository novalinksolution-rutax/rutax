import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Doble del cliente service_role -----------------------------------------
// Capturamos el payload que se le pasa a `.rpc()` para verificar la redacción y
// que el helper nunca propague un fallo de la RPC.
const rpcMock = vi.fn();
vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: () => ({ rpc: rpcMock }),
}));

import { registrarConsumo } from "./index";
import { MARCA_REDACTADO } from "@/lib/observabilidad/redaccion";

describe("registrarConsumo — invariantes de telemetría", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("llama a la RPC consumo_registrar con el evento mapeado", async () => {
    await registrarConsumo({
      tipoEvento: "ruta.optimizar",
      superficie: "adaptador",
      tenantId: "t-1",
      usuarioId: "u-1",
      tipoUsuario: "conductor",
      proveedorCosto: "google_route_optimization",
      sku: "single_vehicle",
      unidades: 30,
      resultado: "ok",
    });

    expect(rpcMock).toHaveBeenCalledOnce();
    const [nombre, args] = rpcMock.mock.calls[0];
    expect(nombre).toBe("consumo_registrar");
    expect(args).toMatchObject({
      p_tipo_evento: "ruta.optimizar",
      p_superficie: "adaptador",
      p_tenant_id: "t-1",
      p_usuario_id: "u-1",
      p_proveedor_costo: "google_route_optimization",
      p_sku: "single_vehicle",
      p_unidades: 30,
    });
  });

  it("unidades por defecto es 1 y los opcionales viajan como null", async () => {
    await registrarConsumo({ tipoEvento: "ruta.reordenar", superficie: "api_route" });
    const [, args] = rpcMock.mock.calls[0];
    expect(args.p_unidades).toBe(1);
    expect(args.p_tenant_id).toBeNull();
    expect(args.p_proveedor_costo).toBeNull();
  });

  it("REDACTA la metadata sensible antes de enviarla", async () => {
    await registrarConsumo({
      tipoEvento: "whatsapp.enviar",
      superficie: "adaptador",
      metadata: { paradas: 12, access_token: "secretodetoken", direccion: "Av. Falsa 123" },
    });
    const [, args] = rpcMock.mock.calls[0];
    expect(args.p_metadata.paradas).toBe(12);
    expect(args.p_metadata.access_token).toBe(MARCA_REDACTADO);
    expect(args.p_metadata.direccion).toBe(MARCA_REDACTADO);
  });

  it("NUNCA lanza aunque la RPC rechace", async () => {
    rpcMock.mockRejectedValue(new Error("db caída"));
    await expect(
      registrarConsumo({ tipoEvento: "x", superficie: "job" }),
    ).resolves.toBeUndefined();
  });

  it("NUNCA lanza aunque crear el cliente lance (sin metadata)", async () => {
    rpcMock.mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(
      registrarConsumo({ tipoEvento: "x", superficie: "cron" }),
    ).resolves.toBeUndefined();
  });
});
