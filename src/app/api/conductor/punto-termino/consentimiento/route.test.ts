import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";
/**
 * Pruebas de `POST /api/conductor/punto-termino/consentimiento`.
 *
 * Foco:
 *   - Auth: sin token / token de seller / token de interno → 401; suspendido → 403.
 *   - Body inválido / `acepto` no booleano → 400.
 *   - `acepto: false` TAMBIÉN se registra (no es un no-op) — trazabilidad legal.
 *   - `tenantId`/`conductorId` salen del token, nunca del body.
 *   - La versión del texto y la finalidad las pone el SERVIDOR, nunca el cliente
 *     (un `versionTexto` en el body no puede sobrescribir
 *     `VERSION_TEXTO_CONSENTIMIENTO_PUNTO_TERMINO`).
 *   - Otorgar dos veces NO duplica la fila abierta, y el rechazo SÍ se registra
 *     siempre. Es la asimetría deliberada de la ruta: `registrar…` siempre
 *     INSERTA y `revocar…` cierra solo la fila MÁS RECIENTE, así que un
 *     otorgamiento duplicado dejaría una fila `acepto = true, revocado_en = null`
 *     viva para siempre después de que el conductor revoque — invisible hoy
 *     (`tieneConsentimientoVigente` mira solo la última) y trampa mañana, para
 *     quien escriba `where acepto and revocado_en is null` en un job de purga.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/autenticar-bearer", () => ({
  autenticarBearer: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/modules/operacion/consentimiento-ubicacion", async (importActual) => {
  const actual =
    await importActual<typeof import("@/modules/operacion/consentimiento-ubicacion")>();
  return {
    ...actual,
    registrarConsentimientoUbicacion: vi.fn(),
    // Se mockea porque la ruta lo consulta ANTES de otorgar (guarda contra el
    // otorgamiento duplicado). Sin mockearlo, el real intentaría `cliente.from`
    // sobre el cliente falso y la ruta caería al 500 sin llegar a lo que se
    // quiere afirmar.
    tieneConsentimientoVigente: vi.fn(),
  };
});

import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  registrarConsentimientoUbicacion,
  tieneConsentimientoVigente,
  VERSION_TEXTO_CONSENTIMIENTO_PUNTO_TERMINO,
} from "@/modules/operacion/consentimiento-ubicacion";
import { FINALIDAD_PUNTO_TERMINO } from "@/modules/operacion/punto-termino-conductor";
import { POST } from "./route";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const OTRO_TENANT = "10000000-0000-0000-0000-000000000099";
const DRIVER_1 = "20000000-0000-0000-0000-000000000001";
const OTRO_DRIVER = "20000000-0000-0000-0000-000000000099";

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

const usuarioSeller = {
  areasHabilitadas: [...AREAS_PRODUCTO],
  usuarioId: "usuario-seller-1",
  tipoUsuario: "seller" as const,
  driverId: null,
  tenantId: TENANT_A,
  sellerId: "seller-1",
  estado: "activo" as const,
  rol: "supervisor" as const,
};

const usuarioInterno = {
  areasHabilitadas: [...AREAS_PRODUCTO],
  usuarioId: "usuario-interno-1",
  tipoUsuario: "interno" as const,
  driverId: null,
  tenantId: TENANT_A,
  sellerId: null,
  estado: "activo" as const,
  rol: "coordinador" as const,
};

const clienteFalso = { marca: "cliente-service-role" } as unknown as ReturnType<
  typeof crearClienteServiceRole
>;

function req(body: unknown) {
  return new Request("http://localhost/api/conductor/punto-termino/consentimiento", {
    method: "POST",
    headers: { authorization: "Bearer token-conductor", "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(crearClienteServiceRole).mockReturnValue(clienteFalso);
  // Por defecto, el conductor NO tiene consentimiento vigente: es el caso del
  // primer otorgamiento, que es el que ejercitan casi todas las pruebas.
  vi.mocked(tieneConsentimientoVigente).mockResolvedValue(false);
});

describe("POST consentimiento — auth", () => {
  it("sin token → 401", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(null);
    const res = await POST(req({ acepto: true }));
    expect(res.status).toBe(401);
    expect(registrarConsentimientoUbicacion).not.toHaveBeenCalled();
  });

  it("token de seller → 401", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioSeller);
    const res = await POST(req({ acepto: true }));
    expect(res.status).toBe(401);
    expect(registrarConsentimientoUbicacion).not.toHaveBeenCalled();
  });

  it("token de interno → 401", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioInterno);
    const res = await POST(req({ acepto: true }));
    expect(res.status).toBe(401);
    expect(registrarConsentimientoUbicacion).not.toHaveBeenCalled();
  });

  it("conductor suspendido → 403", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue({ ...usuarioConductor, estado: "suspendido" });
    const res = await POST(req({ acepto: true }));
    expect(res.status).toBe(403);
    expect(registrarConsentimientoUbicacion).not.toHaveBeenCalled();
  });
});

describe("POST consentimiento — validación de body", () => {
  it("body inválido (no JSON) → 400", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const malo = new Request("http://localhost/api/conductor/punto-termino/consentimiento", {
      method: "POST",
      headers: { authorization: "Bearer token-conductor", "content-type": "application/json" },
      body: "no es json",
    }) as unknown as import("next/server").NextRequest;

    const res = await POST(malo);
    expect(res.status).toBe(400);
  });

  it("`acepto` ausente o no booleano → 400", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);

    const res1 = await POST(req({}));
    expect(res1.status).toBe(400);

    const res2 = await POST(req({ acepto: "sí" }));
    expect(res2.status).toBe(400);

    expect(registrarConsentimientoUbicacion).not.toHaveBeenCalled();
  });
});

describe("POST consentimiento — acepto:false también se registra", () => {
  it("el rechazo NO es un no-op: se llama igual a registrarConsentimientoUbicacion", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    vi.mocked(registrarConsentimientoUbicacion).mockResolvedValue(undefined);

    const res = await POST(req({ acepto: false }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, acepto: false });
    expect(registrarConsentimientoUbicacion).toHaveBeenCalledWith(
      clienteFalso,
      expect.objectContaining({ acepto: false }),
    );
  });

  it("el rechazo se registra AUNQUE ya haya un consentimiento vigente", async () => {
    // La guarda contra el duplicado es SOLO del otorgamiento. Si también
    // cubriera el rechazo, un conductor que dice "quítamelo" desde esta ruta
    // con un consentimiento vigente no dejaría rastro de haberlo dicho.
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    vi.mocked(tieneConsentimientoVigente).mockResolvedValue(true);
    vi.mocked(registrarConsentimientoUbicacion).mockResolvedValue(undefined);

    const res = await POST(req({ acepto: false }));

    expect(res.status).toBe(200);
    expect(registrarConsentimientoUbicacion).toHaveBeenCalledWith(
      clienteFalso,
      expect.objectContaining({ acepto: false }),
    );
  });
});

describe("POST consentimiento — otorgar dos veces no duplica la fila abierta", () => {
  it("con consentimiento vigente, otorgar de nuevo responde ok y NO inserta", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    vi.mocked(tieneConsentimientoVigente).mockResolvedValue(true);

    const res = await POST(req({ acepto: true }));
    const body = await res.json();

    // Idempotente hacia afuera: la app no tiene que saber si ya había uno.
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, acepto: true });
    // Y sin escribir: la fila abierta que quedaría huérfana no llega a existir.
    expect(registrarConsentimientoUbicacion).not.toHaveBeenCalled();
  });

  it("sin consentimiento vigente sí inserta", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    vi.mocked(tieneConsentimientoVigente).mockResolvedValue(false);
    vi.mocked(registrarConsentimientoUbicacion).mockResolvedValue(undefined);

    const res = await POST(req({ acepto: true }));

    expect(res.status).toBe(200);
    expect(registrarConsentimientoUbicacion).toHaveBeenCalledTimes(1);
  });
});

describe("POST consentimiento — el servidor controla tenant/conductor/versión/finalidad", () => {
  it("ignora cualquier tenantId/conductorId/versionTexto/finalidad que venga en el body", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    vi.mocked(registrarConsentimientoUbicacion).mockResolvedValue(undefined);

    await POST(
      req({
        areasHabilitadas: [...AREAS_PRODUCTO],
        acepto: true,
        tenantId: OTRO_TENANT,
        conductorId: OTRO_DRIVER,
        versionTexto: "v99-hackeado",
        finalidad: "rastreo_en_ruta",
      }),
    );

    expect(registrarConsentimientoUbicacion).toHaveBeenCalledWith(clienteFalso, {
      tenantId: TENANT_A,
      conductorId: DRIVER_1,
      actorUsuarioId: usuarioConductor.usuarioId,
      acepto: true,
      versionTexto: VERSION_TEXTO_CONSENTIMIENTO_PUNTO_TERMINO,
      finalidad: FINALIDAD_PUNTO_TERMINO,
    });
  });
});
