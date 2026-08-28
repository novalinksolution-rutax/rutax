import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";
/**
 * Pruebas de POST /api/conductor/manifiesto/iniciar.
 *
 * ANTES de esta ronda de QA esta ruta no tenía NINGÚN archivo de pruebas.
 *
 * El filtro que sustituye a RLS aquí vive en la propia ruta (route.ts:54-60):
 *
 *   cliente.from("manifiestos").select("estado, driver_id")
 *     .eq("id", body.manifiestoId)
 *     .eq("tenant_id", tenantId)   // tenantId = usuario.tenantId (del JWT)
 *     .eq("driver_id", driverId)   // driverId = usuario.driverId (del JWT)
 *     .maybeSingle();
 *
 * `tenantId` y `driverId` SIEMPRE salen del token ya verificado por
 * `autenticarBearer` — nunca del body. Un `manifiestoId` sintácticamente
 * válido pero de OTRO tenant, o de OTRO conductor del MISMO tenant, cae en la
 * misma rama: la consulta no encuentra fila, `manifiesto` es `null` y la ruta
 * responde 404 "Manifiesto no encontrado" sin distinguir el motivo (nunca
 * confirma que el recurso existe).
 *
 * Molde copiado de `src/app/api/operaciones/[pedidoId]/etiqueta/route.test.ts`
 * y `src/app/api/courier/plataforma/comprobantes/[periodoId]/route.test.ts`:
 * doble de `crearClienteServiceRole` con `.eq` como spy + `data: null` para
 * simular "no es tuyo", más aserciones de CON QUÉ argumentos se llamó `.eq`
 * (nunca con el valor "ajeno").
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/autenticar-bearer", () => ({
  autenticarBearer: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/modules/operacion/manifiestos-same-day", () => ({
  transicionarPedidosSameDayAEnRuta: vi.fn().mockResolvedValue(undefined),
}));

import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { transicionarPedidosSameDayAEnRuta } from "@/modules/operacion/manifiestos-same-day";
import { POST } from "./route";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const OTRO_TENANT = "10000000-0000-0000-0000-000000000099";
const DRIVER_1 = "20000000-0000-0000-0000-000000000001";
const OTRO_DRIVER = "20000000-0000-0000-0000-000000000099";
const MANIFIESTO_1 = "30000000-0000-0000-0000-000000000001";

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

/**
 * Doble de `.from('manifiestos')`: la lectura (SELECT ... .maybeSingle()) y
 * la escritura (UPDATE ... sin .select(), resuelto vía `then`, route.ts:72-76)
 * usan builders independientes — cada llamada a `.from()` crea uno nuevo.
 */
function crearCliente(opts: { manifiestoLeido: Record<string, unknown> | null }) {
  function builder() {
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = vi.fn(self);
    b.eq = vi.fn(self);
    b.update = vi.fn(self);
    b.maybeSingle = vi.fn(async () => ({ data: opts.manifiestoLeido, error: null }));
    (b as unknown as { then: (resolve: (r: { error: null }) => void) => void }).then = (resolve) => {
      resolve({ error: null });
    };
    return b;
  }
  return { from: vi.fn(() => builder()) } as unknown as ReturnType<typeof crearClienteServiceRole>;
}

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/conductor/manifiesto/iniciar", {
    method: "POST",
    headers: { authorization: "Bearer token-conductor", "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/conductor/manifiesto/iniciar — auth", () => {
  it("sin usuario autenticado → 401, sin tocar Supabase", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(null);

    const res = await POST(req({ manifiestoId: MANIFIESTO_1 }));

    expect(res.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("conductor con cuenta inactiva → 403", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue({ ...usuarioConductor, estado: "suspendido" });

    const res = await POST(req({ manifiestoId: MANIFIESTO_1 }));

    expect(res.status).toBe(403);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });
});

describe("POST /api/conductor/manifiesto/iniciar — RECHAZO CRUZADO ENTRE COURIERS", () => {
  it("manifiestoId sintácticamente válido pero de OTRO TENANT → 404, jamás 200", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    // Simula lo que hace Postgres cuando la fila existe pero pertenece a otro
    // tenant: el filtro .eq("tenant_id", tenantId) hace que no vuelva nada.
    const cliente = crearCliente({ manifiestoLeido: null });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req({ manifiestoId: MANIFIESTO_1 }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Manifiesto no encontrado" });
    expect(transicionarPedidosSameDayAEnRuta).not.toHaveBeenCalled();

    const fromSpy = cliente.from as unknown as ReturnType<typeof vi.fn>;
    const llamadaLectura = fromSpy.mock.results[0].value as { eq: ReturnType<typeof vi.fn> };
    expect(llamadaLectura.eq).toHaveBeenCalledWith("tenant_id", TENANT_A);
    expect(llamadaLectura.eq).not.toHaveBeenCalledWith("tenant_id", OTRO_TENANT);
  });
});

describe("POST /api/conductor/manifiesto/iniciar — RECHAZO CRUZADO DENTRO DEL MISMO COURIER", () => {
  it("manifiestoId de OTRO CONDUCTOR del MISMO tenant → 404 (el conductor solo ve lo suyo)", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    // La fila existe en el tenant correcto, pero es de otro conductor — el
    // .eq("driver_id", driverId) de la propia ruta la deja fuera igual.
    const cliente = crearCliente({ manifiestoLeido: null });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req({ manifiestoId: MANIFIESTO_1 }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Manifiesto no encontrado" });
    expect(transicionarPedidosSameDayAEnRuta).not.toHaveBeenCalled();

    const fromSpy = cliente.from as unknown as ReturnType<typeof vi.fn>;
    const llamadaLectura = fromSpy.mock.results[0].value as { eq: ReturnType<typeof vi.fn> };
    expect(llamadaLectura.eq).toHaveBeenCalledWith("driver_id", DRIVER_1);
    expect(llamadaLectura.eq).not.toHaveBeenCalledWith("driver_id", OTRO_DRIVER);
  });
});

describe("POST /api/conductor/manifiesto/iniciar — control positivo", () => {
  it("manifiesto propio y 'confirmado' → 200 y transiciona same-day con la identidad del token", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({
      manifiestoLeido: { estado: "confirmado", driver_id: DRIVER_1 },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req({ manifiestoId: MANIFIESTO_1 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ exito: true });
    expect(transicionarPedidosSameDayAEnRuta).toHaveBeenCalledWith(
      cliente,
      MANIFIESTO_1,
      TENANT_A,
      DRIVER_1,
      usuarioConductor,
      // El 6.º argumento es el id de `auth.users`, y va aparte del conductor a
      // propósito: `bitacora_auditoria.actor_usuario_id` tiene FK contra
      // `auth.users(id)`, así que mandar `DRIVER_1` ahí hacía reventar el INSERT
      // y NINGÚN pedido same-day llegaba a `en_ruta` (2026-08-14).
      usuarioConductor.usuarioId,
    );

    // Explícito: los dos ids son distintos y no se pueden confundir.
    expect(usuarioConductor.usuarioId).not.toBe(DRIVER_1);
    const args = vi.mocked(transicionarPedidosSameDayAEnRuta).mock.calls[0];
    expect(args[5]).not.toBe(DRIVER_1);
  });

  it("manifiesto propio pero NO 'confirmado' → 409, no transiciona nada", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({
      manifiestoLeido: { estado: "borrador", driver_id: DRIVER_1 },
    });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req({ manifiestoId: MANIFIESTO_1 }));

    expect(res.status).toBe(409);
    expect(transicionarPedidosSameDayAEnRuta).not.toHaveBeenCalled();
  });
});
