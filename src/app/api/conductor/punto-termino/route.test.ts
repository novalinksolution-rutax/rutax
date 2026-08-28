import { AREAS_PRODUCTO } from "@/modules/identidad/areas-producto";
/**
 * Pruebas de `GET | PUT | DELETE /api/conductor/punto-termino`.
 *
 * Esta ruta corre con `service_role` y pgTAP NO la cubre (`docs/seguridad/
 * punto-de-termino-conductor.md` §6.3 punto 10) — es exactamente lo que este
 * archivo cierra.
 *
 * Foco:
 *   - Sin token / token de seller / token de interno → 401 (solo `conductor`
 *     puede entrar aquí).
 *   - Conductor `suspendido` → 403.
 *   - `tenantId` y `driverId` salen SIEMPRE del token, NUNCA del body ni del
 *     query — un `conductorId` ajeno en el body se ignora por completo.
 *   - `PUT` con `{ direccion: "..." }` → 400 (nunca se guarda el texto de una
 *     dirección — §8.2 del documento).
 *   - `PUT` sin consentimiento vigente → 409 (`ErrorSinConsentimientoPuntoTermino`).
 *   - `DELETE` dos veces seguidas → las dos veces `ok: true` (idempotente: el
 *     control en la app es de UN TOQUE).
 *
 * Molde: `src/app/api/conductor/evidencias/route.test.ts` (`vi.mock` de
 * `autenticar-bearer` y `service-role`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/autenticar-bearer", () => ({
  autenticarBearer: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/modules/operacion/punto-termino-conductor", async (importActual) => {
  const actual =
    await importActual<typeof import("@/modules/operacion/punto-termino-conductor")>();
  return {
    ...actual,
    definirPuntoTermino: vi.fn(),
    obtenerPuntoTerminoPropio: vi.fn(),
    revocarPuntoTermino: vi.fn(),
  };
});

vi.mock("@/modules/operacion/consentimiento-ubicacion", () => ({
  tieneConsentimientoVigente: vi.fn(),
}));

import { autenticarBearer } from "@/lib/supabase/autenticar-bearer";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  definirPuntoTermino,
  ErrorSinConsentimientoPuntoTermino,
  obtenerPuntoTerminoPropio,
  revocarPuntoTermino,
} from "@/modules/operacion/punto-termino-conductor";
import { tieneConsentimientoVigente } from "@/modules/operacion/consentimiento-ubicacion";
import { GET, PUT, DELETE } from "./route";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const OTRO_TENANT = "10000000-0000-0000-0000-000000000099";
const DRIVER_1 = "20000000-0000-0000-0000-000000000001";
const OTRO_DRIVER = "20000000-0000-0000-0000-000000000099";
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

const usuarioSeller = {
  areasHabilitadas: [...AREAS_PRODUCTO],
  usuarioId: "usuario-seller-1",
  tipoUsuario: "seller" as const,
  driverId: null,
  tenantId: TENANT_A,
  sellerId: SELLER_1,
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

function reqGet() {
  return new Request("http://localhost/api/conductor/punto-termino", {
    method: "GET",
    headers: { authorization: "Bearer token-conductor" },
  }) as unknown as import("next/server").NextRequest;
}

function reqPut(body: Record<string, unknown>) {
  return new Request("http://localhost/api/conductor/punto-termino", {
    method: "PUT",
    headers: { authorization: "Bearer token-conductor", "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

function reqDelete() {
  return new Request("http://localhost/api/conductor/punto-termino", {
    method: "DELETE",
    headers: { authorization: "Bearer token-conductor" },
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(crearClienteServiceRole).mockReturnValue(clienteFalso);
});

// =============================================================================
// Auth — 401 / 403
// =============================================================================

describe("punto-termino — auth", () => {
  it("GET sin token → 401, sin tocar Supabase", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(null);

    const res = await GET(reqGet());

    expect(res.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("GET con token de SELLER → 401 (solo conductor entra aquí)", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioSeller);

    const res = await GET(reqGet());

    expect(res.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("GET con token de INTERNO (dueño/coordinador) → 401", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioInterno);

    const res = await GET(reqGet());

    expect(res.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("PUT sin token → 401, nunca llega a definirPuntoTermino", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(null);

    const res = await PUT(reqPut({ lat: -33.4, long: -70.6 }));

    expect(res.status).toBe(401);
    expect(definirPuntoTermino).not.toHaveBeenCalled();
  });

  it("PUT con token de seller → 401", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioSeller);

    const res = await PUT(reqPut({ lat: -33.4, long: -70.6 }));

    expect(res.status).toBe(401);
    expect(definirPuntoTermino).not.toHaveBeenCalled();
  });

  it("DELETE sin token → 401", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(null);

    const res = await DELETE(reqDelete());

    expect(res.status).toBe(401);
    expect(revocarPuntoTermino).not.toHaveBeenCalled();
  });

  it("DELETE con token de interno → 401", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioInterno);

    const res = await DELETE(reqDelete());

    expect(res.status).toBe(401);
    expect(revocarPuntoTermino).not.toHaveBeenCalled();
  });

  it("conductor SUSPENDIDO → 403, sin tocar Supabase", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue({ ...usuarioConductor, estado: "suspendido" });

    const res = await GET(reqGet());

    expect(res.status).toBe(403);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });

  it("PUT con conductor suspendido → 403, no guarda nada", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue({ ...usuarioConductor, estado: "suspendido" });

    const res = await PUT(reqPut({ lat: -33.4, long: -70.6 }));

    expect(res.status).toBe(403);
    expect(definirPuntoTermino).not.toHaveBeenCalled();
  });
});

// =============================================================================
// tenantId / driverId SIEMPRE del token, nunca del body ni del query
// =============================================================================

describe("punto-termino — el conductor y el tenant salen SIEMPRE del token", () => {
  it("GET ignora cualquier query/param — siempre lee su PROPIO punto (driverId del token)", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    vi.mocked(obtenerPuntoTerminoPropio).mockResolvedValue(null);
    vi.mocked(tieneConsentimientoVigente).mockResolvedValue(false);

    const req = new Request(
      "http://localhost/api/conductor/punto-termino?conductorId=" + OTRO_DRIVER,
      { method: "GET", headers: { authorization: "Bearer token-conductor" } },
    ) as unknown as import("next/server").NextRequest;

    await GET(req);

    expect(obtenerPuntoTerminoPropio).toHaveBeenCalledWith(clienteFalso, TENANT_A, DRIVER_1);
    expect(obtenerPuntoTerminoPropio).not.toHaveBeenCalledWith(
      clienteFalso,
      expect.anything(),
      OTRO_DRIVER,
    );
  });

  it("PUT: un `conductorId` y un `tenantId` de OTRO tenant en el body se ignoran por completo", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    vi.mocked(definirPuntoTermino).mockResolvedValue({
      lat: -33.4,
      long: -70.6,
      comuna: "Santiago",
      definidoEn: "2026-08-14T00:00:00Z",
      actualizadoEn: "2026-08-14T00:00:00Z",
    });

    const res = await PUT(
      reqPut({
        lat: -33.4,
        long: -70.6,
        conductorId: OTRO_DRIVER,
        tenantId: OTRO_TENANT,
      }),
    );

    expect(res.status).toBe(200);
    expect(definirPuntoTermino).toHaveBeenCalledWith(clienteFalso, {
      tenantId: TENANT_A,
      conductorId: DRIVER_1,
      actorUsuarioId: usuarioConductor.usuarioId,
      lat: -33.4,
      long: -70.6,
    });
    // Nunca se llamó con los valores del body — ni como tenant ni como conductor.
    const llamada = vi.mocked(definirPuntoTermino).mock.calls[0][1];
    expect(llamada.tenantId).not.toBe(OTRO_TENANT);
    expect(llamada.conductorId).not.toBe(OTRO_DRIVER);
  });

  it("DELETE: usa el driverId/tenantId del token aunque no reciba body", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    vi.mocked(revocarPuntoTermino).mockResolvedValue(undefined);

    await DELETE(reqDelete());

    expect(revocarPuntoTermino).toHaveBeenCalledWith(clienteFalso, {
      tenantId: TENANT_A,
      conductorId: DRIVER_1,
      actorUsuarioId: usuarioConductor.usuarioId,
    });
  });
});

// =============================================================================
// PUT con `direccion` → 400, nunca se guarda texto
// =============================================================================

describe("PUT /api/conductor/punto-termino — nunca se guarda el texto de una dirección", () => {
  it("un body con `direccion` se rechaza con 400, sin llamar a definirPuntoTermino", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);

    const res = await PUT(
      reqPut({ lat: -33.4, long: -70.6, direccion: "Av. Siempre Viva 742" }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(definirPuntoTermino).not.toHaveBeenCalled();
    // El mensaje no puede reproducir el texto de la dirección que se rechazó.
    expect(JSON.stringify(body)).not.toContain("Siempre Viva");
  });

  it("lat/long faltantes o no numéricos → 400", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);

    const res = await PUT(reqPut({ lat: "no es un número", long: -70.6 }));

    expect(res.status).toBe(400);
    expect(definirPuntoTermino).not.toHaveBeenCalled();
  });
});

// =============================================================================
// PUT sin consentimiento vigente → 409
// =============================================================================

describe("PUT /api/conductor/punto-termino — sin consentimiento vigente", () => {
  it("ErrorSinConsentimientoPuntoTermino → 409 (falla cerrado, no 403)", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    vi.mocked(definirPuntoTermino).mockRejectedValue(new ErrorSinConsentimientoPuntoTermino());

    const res = await PUT(reqPut({ lat: -33.4, long: -70.6 }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/consentimiento/i);
  });
});

// =============================================================================
// DELETE — idempotente: dos toques seguidos, las dos veces ok
// =============================================================================

describe("DELETE /api/conductor/punto-termino — idempotente", () => {
  it("dos DELETE seguidos devuelven ok:true las dos veces", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    vi.mocked(revocarPuntoTermino).mockResolvedValue(undefined);

    const primera = await DELETE(reqDelete());
    const primeraBody = await primera.json();
    const segunda = await DELETE(reqDelete());
    const segundaBody = await segunda.json();

    expect(primera.status).toBe(200);
    // `rutaRecalculada` entra al contrato desde el 2026-08-27: mover o quitar el
    // punto de término cambia dónde termina la ruta, así que la respuesta dice
    // si la secuencia se rehízo. Acá va en `false` porque el conductor no tiene
    // manifiesto vigente en este montaje.
    expect(primeraBody).toEqual({ ok: true, rutaRecalculada: false });
    expect(segunda.status).toBe(200);
    expect(segundaBody).toEqual({ ok: true, rutaRecalculada: false });
    expect(revocarPuntoTermino).toHaveBeenCalledTimes(2);
  });
});
