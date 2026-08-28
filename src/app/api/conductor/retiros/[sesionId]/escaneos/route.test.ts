import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";
/**
 * Pruebas de POST /api/conductor/retiros/:sesionId/escaneos.
 *
 * `registrarLoteEscaneos` se mockea — su lógica interna (fusión de
 * duplicados, resolución diferida, best-effort) ya está probada en
 * `escaneos.test.ts`. Aquí lo que importa es: el canario de aislamiento de
 * la RUTA (un único `.from('sesiones_retiro')` antes de tocar nada más), la
 * validación del tamaño del lote, y que el `catch` NUNCA loguee el body.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/autenticar-bearer", () => ({
  autenticarBearer: vi.fn(),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));
vi.mock("@/modules/operacion/retiro/escaneos", () => ({
  MAX_ESCANEOS_POR_LOTE: 50,
  registrarLoteEscaneos: vi.fn(),
}));

import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarLoteEscaneos } from "@/modules/operacion/retiro/escaneos";
import { POST } from "./route";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const OTRO_TENANT = "10000000-0000-0000-0000-000000000099";
const DRIVER_1 = "20000000-0000-0000-0000-000000000001";
const OTRO_DRIVER = "20000000-0000-0000-0000-000000000099";
const SESION_1 = "30000000-0000-0000-0000-000000000001";
const SELLER_1 = "60000000-0000-0000-0000-000000000001";

const usuarioConductor = {
  areasHabilitadas: [...AREAS_PRODUCTO],
  usuarioId: "usuario-conductor-1",
  tipoUsuario: "conductor" as const,
  driverId: DRIVER_1,
  tenantId: TENANT_A,
  sellerId: null,
  estado: "activo" as const,
  rol: "conductor" as const,
};

interface FilaFixture {
  [clave: string]: unknown;
}

const CANARIO = "__CANARIO_TABLA_NO_MOCKEADA__";

function crearCliente(sesion: FilaFixture | null) {
  const from = vi.fn((tabla: string) => {
    if (tabla !== "sesiones_retiro") throw new Error(`${CANARIO}:${tabla}`);
    const filtrosEq: { columna: string; valor: unknown }[] = [];
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (columna: string, valor: unknown) => {
      filtrosEq.push({ columna, valor });
      return b;
    };
    b.maybeSingle = async () => {
      const coincide = sesion && filtrosEq.every((flt) => (sesion as FilaFixture)[flt.columna] === flt.valor);
      return { data: coincide ? sesion : null, error: null };
    };
    return b;
  });
  return { from } as unknown as ReturnType<typeof crearClienteServiceRole>;
}

function req(body: unknown) {
  return new Request("http://localhost/api/conductor/retiros/x/escaneos", {
    method: "POST",
    headers: { authorization: "Bearer token-conductor", "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

function ctx(sesionId = SESION_1) {
  return { params: Promise.resolve({ sesionId }) };
}

function escaneo(n: number) {
  return { escaneoId: `esc-${n}`, codigo: `RX-7K2M-000${n}`.slice(0, 12), escaneadoEn: new Date().toISOString() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/conductor/retiros/:sesionId/escaneos — auth", () => {
  it("sin usuario -> 401, sin tocar Supabase", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(null);
    const res = await POST(req({ escaneos: [escaneo(1)] }), ctx());
    expect(res.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("cuenta inactiva -> 403", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue({ ...usuarioConductor, estado: "suspendido" });
    const res = await POST(req({ escaneos: [escaneo(1)] }), ctx());
    expect(res.status).toBe(403);
  });
});

describe("POST /api/conductor/retiros/:sesionId/escaneos — validación del lote", () => {
  it("body inválido (no JSON) -> 400", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const reqInvalido = new Request("http://localhost/x", {
      method: "POST",
      headers: { authorization: "Bearer t" },
      body: "esto no es json",
    }) as unknown as import("next/server").NextRequest;

    const res = await POST(reqInvalido, ctx());
    expect(res.status).toBe(400);
  });

  it("sin escaneos (o vacío) -> 400, sin tocar Supabase", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const res = await POST(req({ escaneos: [] }), ctx());
    expect(res.status).toBe(400);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("lote > 50 -> 400 para TODA la petición, con código y máximo", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const escaneos = Array.from({ length: 51 }, (_, i) => escaneo(i));

    const res = await POST(req({ escaneos }), ctx());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.codigo).toBe("lote_excede_maximo");
    expect(body.maximo).toBe(50);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
    expect(registrarLoteEscaneos).not.toHaveBeenCalled();
  });
});

describe("POST /api/conductor/retiros/:sesionId/escaneos — RECHAZO CRUZADO ENTRE COURIERS Y CONDUCTORES", () => {
  it("sesionId de OTRO TENANT -> 404, NUNCA llega a registrar un solo bulto", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({ id: SESION_1, tenant_id: OTRO_TENANT, conductor_id: DRIVER_1, seller_id: SELLER_1, estado: "abierta" });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req({ escaneos: [escaneo(1)] }), ctx());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/no encontrada/);
    expect(registrarLoteEscaneos).not.toHaveBeenCalled();
  });

  it("sesionId de OTRO CONDUCTOR del MISMO tenant -> 404, nunca 403", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({ id: SESION_1, tenant_id: TENANT_A, conductor_id: OTRO_DRIVER, seller_id: SELLER_1, estado: "abierta" });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req({ escaneos: [escaneo(1)] }), ctx());

    expect(res.status).toBe(404);
    expect(registrarLoteEscaneos).not.toHaveBeenCalled();
  });
});

describe("POST /api/conductor/retiros/:sesionId/escaneos — control positivo", () => {
  it("sesión propia: delega en registrarLoteEscaneos con el contexto correcto (incluida sesionCerrada)", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({
      areasHabilitadas: [...AREAS_PRODUCTO],
      id: SESION_1,
      tenant_id: TENANT_A,
      conductor_id: DRIVER_1,
      seller_id: SELLER_1,
      estado: "cerrada",
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);
    vi.mocked(registrarLoteEscaneos).mockResolvedValue({
      resultados: [{ escaneoId: "esc-0", estado: "registrado", resolucion: "no_procesado", bultoId: "b-1", pedido: null }],
    });

    const unEscaneo = escaneo(0);
    const res = await POST(req({ escaneos: [unEscaneo] }), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.resultados).toHaveLength(1);
    expect(registrarLoteEscaneos).toHaveBeenCalledWith(cliente, {
      tenantId: TENANT_A,
      sesionId: SESION_1,
      conductorId: DRIVER_1,
      sellerIdBodega: SELLER_1,
      sesionCerrada: true, // estado 'cerrada' en la fila -> posterior_al_cierre
      escaneos: [unEscaneo],
    });
  });
});

describe("POST /api/conductor/retiros/:sesionId/escaneos — NUNCA loguea el body", () => {
  it("un fallo interno se loguea SIN el código escaneado, aunque el error lo mencione", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({ id: SESION_1, tenant_id: TENANT_A, conductor_id: DRIVER_1, seller_id: SELLER_1, estado: "abierta" });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const MARCADOR_SECRETO = "MARCADOR_SECRETO_hash_code_UNICO_9f3a";
    // Peor caso: el error interno (hipotéticamente) menciona el secreto.
    vi.mocked(registrarLoteEscaneos).mockRejectedValue(new Error(`fallo con ${MARCADOR_SECRETO}`));

    const spyError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(
      req({
        escaneos: [
          {
            escaneoId: "esc-1",
            codigo: `{"id":"1","hash_code":"${MARCADOR_SECRETO}","security_digit":"0"}`,
            escaneadoEn: new Date().toISOString(),
          },
        ],
      }),
      ctx(),
    );

    expect(res.status).toBe(500);

    const todoLoLogueado = spyError.mock.calls.map((llamada) => JSON.stringify(llamada)).join("\n");
    expect(todoLoLogueado).not.toContain(MARCADOR_SECRETO);
    expect(todoLoLogueado).not.toContain("hash_code");

    spyError.mockRestore();
  });
});
