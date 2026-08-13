/**
 * Pruebas de POST /api/conductor/evidencias/upload-url.
 *
 * ANTES de esta ronda de QA esta ruta no tenía NINGÚN archivo de pruebas.
 *
 * ⚠️ EL MOLDE DE "RECHAZO CRUZADO" NO APLICA TAL CUAL EN ESTA RUTA — Y ESO ES
 * EN SÍ MISMO EL HALLAZGO. A diferencia de las otras 8 rutas del conductor,
 * `upload-url/route.ts` NO CONSULTA LA BASE DE DATOS. No hay `.from("pedidos")`
 * ni ninguna otra tabla: el `objectPath` se arma como un string puro
 * (route.ts:44):
 *
 *   const objectPath = `${usuario.tenantId}/${pedidoId}/evidencias/${evidenciaId}.jpg`;
 *
 * y se usa directo para pedirle a Storage una URL de subida firmada. No hay
 * ninguna fila que "no aparezca" para simular con `data: null` — por eso no
 * existe un test de "pedidoId de otro tenant → 404" análogo al de las demás
 * rutas: la ruta jamás verifica si `pedidoId` existe, si pertenece al tenant,
 * ni si está asignado al conductor autenticado.
 *
 * Lo que SÍ se puede afirmar y fijar con pruebas:
 *
 * 1. El segmento de TENANT del path SIEMPRE es `usuario.tenantId` (el del
 *    token verificado) — nunca hay forma de que el cliente lo controle,
 *    porque no hay ningún campo de tenant en el body. Esto acota el radio del
 *    problema: aunque no haya verificación de pertenencia, esta ruta no deja
 *    escribir DENTRO de la carpeta de otro tenant con un valor directo.
 *
 * 2. ⚠️ HALLAZGO (severidad BAJA — informativo, no confirmado como
 *    explotable, no corregido aquí): NO hay verificación de que `pedidoId`
 *    exista, pertenezca al tenant o esté asignado al conductor. Cualquier
 *    conductor activo puede obtener una URL de subida firmada para
 *    `{miTenant}/{cualquierPedidoIdQueElijan}/evidencias/{cualquierId}.jpg`
 *    — incluido el `pedidoId` real de OTRO conductor de su mismo tenant. La
 *    foto subida por esa URL queda "huérfana": para que cuente como evidencia
 *    real todavía hace falta `POST /api/conductor/evidencias`, que SÍ exige
 *    `driver_id_asignado === actor.driverId` (ver `evidencias/route.test.ts`)
 *    — así que esta ruta por sí sola no permite adjuntar evidencia falsa al
 *    pedido de otro. Pero permite escribir/gastar cuota de Storage bajo un
 *    `pedidoId` ajeno sin que nada lo note. Vale la pena que el filtro de
 *    pertenencia se agregue aquí también, por defensa en profundidad y
 *    consistencia con las otras 8 rutas — no se hace en este cambio
 *    (restricción: no editar `route.ts`).
 *
 * 3. ⚠️ HALLAZGO (severidad BAJA — NO VERIFICADO contra Supabase Storage
 *    real, solo documentado): ni `pedidoId` ni `evidenciaId` se sanean antes
 *    de interpolarlos en el key de Storage. Si Supabase Storage (S3-compatible)
 *    NO normaliza segmentos `..` en el key, un `pedidoId` con forma de
 *    path-traversal (`"../OTRO_TENANT_ID/x"`) podría, en teoría, escapar del
 *    prefijo `{tenantId}/`. La prueba de abajo deja constancia de que el
 *    string viaja SIN sanear — no concluye si es explotable (eso depende de
 *    semántica de Storage/S3 fuera del alcance de una prueba unitaria con
 *    mocks). Recomendado: que `devops`/`seguridad-cumplimiento` lo verifiquen
 *    contra el bucket real antes de dar por cerrado.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/autenticar-bearer", () => ({
  autenticarBearer: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { POST } from "./route";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const DRIVER_1 = "20000000-0000-0000-0000-000000000001";
const PEDIDO_1 = "40000000-0000-0000-0000-000000000001";
const PEDIDO_DE_OTRO_CONDUCTOR = "40000000-0000-0000-0000-000000000002";

const usuarioConductor = {
  usuarioId: "usuario-conductor-1",
  tipoUsuario: "conductor" as const,
  driverId: DRIVER_1,
  tenantId: TENANT_A,
  sellerId: null,
  estado: "activo" as const,
  rol: "conductor" as const,
};

function crearCliente() {
  const createSignedUploadUrl = vi.fn(async (objectPath: string) => ({
    data: { signedUrl: `https://storage.example/signed/${objectPath}`, token: "tok-123" },
    error: null,
  }));
  return {
    storage: { from: vi.fn(() => ({ createSignedUploadUrl })) },
  } as unknown as ReturnType<typeof crearClienteServiceRole>;
}

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/conductor/evidencias/upload-url", {
    method: "POST",
    headers: { authorization: "Bearer token-conductor", "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/conductor/evidencias/upload-url — auth", () => {
  it("sin usuario autenticado → 401, sin tocar Supabase", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(null);

    const res = await POST(req({ pedidoId: PEDIDO_1, evidenciaId: "ev-1" }));

    expect(res.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("conductor con cuenta inactiva → 403", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue({ ...usuarioConductor, estado: "suspendido" });

    const res = await POST(req({ pedidoId: PEDIDO_1, evidenciaId: "ev-1" }));

    expect(res.status).toBe(403);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("sin pedidoId o evidenciaId → 400", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);

    const res = await POST(req({ pedidoId: PEDIDO_1 }));

    expect(res.status).toBe(400);
  });
});

describe("POST /api/conductor/evidencias/upload-url — control positivo", () => {
  it("arma el objectPath bajo el tenant del TOKEN y lo usa para pedir la URL firmada", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente();
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await POST(req({ pedidoId: PEDIDO_1, evidenciaId: "ev-1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.objectPath).toBe(`${TENANT_A}/${PEDIDO_1}/evidencias/ev-1.jpg`);
    expect(body.uploadUrl).toContain(TENANT_A);
  });
});

describe("POST /api/conductor/evidencias/upload-url — ⚠️ HALLAZGO: sin verificación de pertenencia (documentado, no corregido)", () => {
  it("el segmento de tenant SIEMPRE es el del token, nunca uno que el body pueda insinuar (no hay campo de tenant en el body)", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente();
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    await POST(req({ pedidoId: PEDIDO_1, evidenciaId: "ev-1" }));

    const createSignedUploadUrl = (cliente.storage.from as unknown as ReturnType<typeof vi.fn>).mock
      .results[0].value.createSignedUploadUrl as ReturnType<typeof vi.fn>;
    const pathUsado = createSignedUploadUrl.mock.calls[0][0] as string;
    expect(pathUsado.startsWith(`${TENANT_A}/`)).toBe(true);
  });

  it("un pedidoId que pertenece a OTRO CONDUCTOR del mismo tenant es aceptado igual → 200 (no hay consulta a `pedidos` que lo rechace)", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente();
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    // Nada distingue este pedidoId de uno propio: la ruta no consulta `pedidos`.
    const res = await POST(req({ pedidoId: PEDIDO_DE_OTRO_CONDUCTOR, evidenciaId: "ev-1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.objectPath).toBe(`${TENANT_A}/${PEDIDO_DE_OTRO_CONDUCTOR}/evidencias/ev-1.jpg`);
  });

  it("un pedidoId con forma de path-traversal viaja SIN sanear hacia el key de Storage (no verificado contra Storage real)", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente();
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const pedidoIdSospechoso = "../otro-tenant-id";
    const res = await POST(req({ pedidoId: pedidoIdSospechoso, evidenciaId: "ev-1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    // El string llega intacto — ni la ruta ni registrarEvidenciaEntrega (que
    // aquí ni se invoca) lo tocan. Si algún día se agrega saneo, este test
    // debe actualizarse para exigirlo.
    expect(body.objectPath).toBe(`${TENANT_A}/${pedidoIdSospechoso}/evidencias/ev-1.jpg`);
  });
});
