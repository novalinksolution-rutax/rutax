/**
 * Aviso «comunas sin zona que se cobran por la zona de respaldo» (Q6, 2026-09-28).
 * Llama a `obtenerAvisos` real; solo se sustituye la lectura de cobertura.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({ crearClienteServiceRole: vi.fn() }));
vi.mock("@/modules/plataforma/enforcement", () => ({ verificarLimite: vi.fn() }));
vi.mock("@/modules/plataforma/comunicaciones", () => ({
  obtenerComunicacionesActivasParaCourier: vi.fn(),
}));
vi.mock("@/modules/operacion/cobertura-respaldo", () => ({
  obtenerCoberturaPorRespaldo: vi.fn(),
}));

import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { verificarLimite } from "@/modules/plataforma/enforcement";
import { obtenerComunicacionesActivasParaCourier } from "@/modules/plataforma/comunicaciones";
import { obtenerCoberturaPorRespaldo } from "@/modules/operacion/cobertura-respaldo";
import { obtenerAvisos } from "./obtener-avisos";
import type { UsuarioActual } from "@/modules/identidad/usuario-actual";
import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";

function clienteSilencioso() {
  const b: Record<string, unknown> = {};
  for (const m of ["schema", "from", "select", "eq", "is", "in", "not", "lte", "order"]) {
    b[m] = vi.fn(() => b);
  }
  b.limit = vi.fn(() => Promise.resolve({ data: [], error: null }));
  b.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  return b;
}

const dueno: UsuarioActual = {
  tenantId: "tenant-a",
  rol: "dueno",
  tipoUsuario: "interno",
  estado: "activo",
  areasHabilitadas: [...AREAS_PRODUCTO],
  sellerId: null,
  driverId: null,
};
const coordinador: UsuarioActual = { ...dueno, rol: "coordinador" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(crearClienteServiceRole).mockReturnValue(
    clienteSilencioso() as unknown as ReturnType<typeof crearClienteServiceRole>,
  );
  vi.mocked(obtenerComunicacionesActivasParaCourier).mockResolvedValue([]);
  vi.mocked(verificarLimite).mockResolvedValue({
    permitido: true,
    motivo: "ok",
    usoActual: 0,
    limite: null,
    porcentaje: null,
  });
});

describe("obtenerAvisos — comunas por respaldo", () => {
  it("avisa con la zona, el conteo y las comunas, y lleva a la configuración de zonas", async () => {
    vi.mocked(obtenerCoberturaPorRespaldo).mockResolvedValue({
      zonaRespaldoNombre: "Periferia",
      totalPedidos: 5,
      comunas: [
        { comuna: "Maipú", pedidos: 3 },
        { comuna: "Pudahuel", pedidos: 2 },
      ],
    });

    const avisos = await obtenerAvisos("tenant-a", dueno, "user-1");
    const aviso = avisos.find((a) => a.id === "comunas-por-respaldo");

    expect(aviso).toMatchObject({ urgencia: "importante", href: "/configuracion/zonas" });
    expect(aviso?.titulo).toBe("2 comunas sin zona");
    expect(aviso?.descripcion).toContain("5 pedidos");
    expect(aviso?.descripcion).toContain("Periferia");
    expect(aviso?.descripcion).toContain("Maipú, Pudahuel");
  });

  it("una sola comuna nombra la comuna en el título", async () => {
    vi.mocked(obtenerCoberturaPorRespaldo).mockResolvedValue({
      zonaRespaldoNombre: "Periferia",
      totalPedidos: 1,
      comunas: [{ comuna: "Curacaví", pedidos: 1 }],
    });

    const avisos = await obtenerAvisos("tenant-a", dueno, "user-1");

    expect(avisos.find((a) => a.id === "comunas-por-respaldo")?.titulo).toBe("Curacaví no tiene zona");
  });

  it("sin comunas en respaldo no hay aviso", async () => {
    vi.mocked(obtenerCoberturaPorRespaldo).mockResolvedValue(null);

    const avisos = await obtenerAvisos("tenant-a", dueno, "user-1");

    expect(avisos.some((a) => a.id === "comunas-por-respaldo")).toBe(false);
  });

  it("solo lo ve quien puede cambiar tarifas y zonas: el coordinador ni consulta", async () => {
    vi.mocked(obtenerCoberturaPorRespaldo).mockResolvedValue({
      zonaRespaldoNombre: "Periferia",
      totalPedidos: 1,
      comunas: [{ comuna: "Maipú", pedidos: 1 }],
    });

    const avisos = await obtenerAvisos("tenant-a", coordinador, "user-2");

    expect(avisos.some((a) => a.id === "comunas-por-respaldo")).toBe(false);
    expect(obtenerCoberturaPorRespaldo).not.toHaveBeenCalled();
  });

  it("si la lectura falla, el centro de avisos NO cae (defensivo)", async () => {
    vi.mocked(obtenerCoberturaPorRespaldo).mockRejectedValue(new Error("caída"));

    await expect(obtenerAvisos("tenant-a", dueno, "user-1")).resolves.toBeInstanceOf(Array);
  });
});
