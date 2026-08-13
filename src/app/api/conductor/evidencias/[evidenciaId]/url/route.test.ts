/**
 * Pruebas de GET /api/conductor/evidencias/:evidenciaId/url.
 *
 * ANTES de esta ronda de QA esta ruta no tenía NINGÚN archivo de pruebas.
 *
 * La ruta delega el aislamiento entero en `obtenerUrlFirmadaEvidencia`
 * (evidencias-entrega.ts, función `obtenerUrlFirmadaEvidencia`), que NO tiene
 * ningún test propio (ni de módulo ni de ruta) — se busca
 * "obtenerUrlFirmadaEvidencia" en el repo y no aparece en ningún `*.test.ts`
 * antes de este archivo. Por eso estas pruebas NO mockean esa función: la
 * dejan correr de verdad. (Números de línea de esta cabecera verificados al
 * escribir este archivo — este módulo tiene otra ronda de cambios en curso en
 * paralelo, ver nota de aislamiento del reporte de QA; pueden haberse movido
 * unas pocas líneas desde entonces sin cambiar la lógica citada.)
 *
 * La línea que sustituye a RLS (evidencias-entrega.ts, dentro de
 * `obtenerUrlFirmadaEvidencia`):
 *
 *   cliente.from("evidencias_entrega").select(...)
 *     .eq("id", evidenciaId)
 *     .eq("tenant_id", actor.tenantId ?? "")   // ← del token, nunca de la URL
 *     .maybeSingle();
 *   ...
 *   if (esConductor && evidencia.conductor_id !== actor.driverId) throw ErrorValidacion(...)
 *
 * ⚠️ SOBRE EL "HALLAZGO YA VERIFICADO" DEL ENUNCIADO DE QA — RE-VERIFICADO
 * AQUÍ Y NO SE REPRODUCE COMO COMPORTAMIENTO OBSERVABLE:
 * ---------------------------------------------------------------------------
 * Es LITERALMENTE CIERTO que esta es la ÚNICA de las 9 rutas cuyo `route.ts`
 * NO tiene la línea explícita `if (usuario.estado !== "activo") return 403`
 * que sí tienen `manifiesto/route.ts:26-28`, `evidencias/route.ts`,
 * `entregar/route.ts`, etc. justo después del guard de 401.
 *
 * PERO el test "conductor SUSPENDIDO..." de abajo (ejecutado de verdad contra
 * `obtenerUrlFirmadaEvidencia`, sin mockear esa función) demuestra que el
 * resultado observable NO es 200: es **403**. La razón es que
 * `obtenerUrlFirmadaEvidencia` llama a `puedeMarcarEvidenciasPropias(actor)`,
 * que delega en `tieneCapacidad()` (capacidades.ts:339-342):
 *
 *   export function tieneCapacidad(usuario, capacidad) {
 *     if (!estaActivo(usuario)) return false;   // ← estaActivo = estado === 'activo'
 *     return MATRIZ_ROL_CAPACIDADES[usuario.rol].includes(capacidad);
 *   }
 *
 * Es decir: TODA capacidad de conductor (incluida `marcar_evidencias_propias`,
 * que también usan `registrarPruebaEntrega`, `registrarCierreConductor` y
 * `registrarEvidenciaEntrega`) exige `estado === 'activo'` de forma
 * transitiva e implícita, aunque la ruta no lo pida por su cuenta. Un
 * conductor `suspendido` cae en `ErrorValidacion("El conductor no tiene
 * capacidad para ver sus evidencias.")` → 403, NO en un 200 con la foto.
 *
 * Conclusión de QA: el hallazgo original describe correctamente el CÓDIGO
 * (falta la línea explícita) pero NO el COMPORTAMIENTO (sí rechaza, por una
 * ruta distinta). No es un "0 de severidad" — sigue siendo la única ruta que
 * depende de una protección IMPLÍCITA en vez de un guard explícito y legible
 * (si algún día `puedeMarcarEvidenciasPropias` cambiara de forma, o si
 * `obtenerUrlFirmadaEvidencia` se reutilizara desde un actor que no pase por
 * esa capacidad, el hueco SÍ se abriría) — pero HOY, para el actor conductor
 * vía esta ruta Bearer, no hay fuga. Recomendación: agregar la línea
 * explícita de todos modos, por CONSISTENCIA y defensa en profundidad
 * legible — no por urgencia de seguridad. Reportado a la sesión principal
 * para que reasigne la severidad con esta evidencia.
 *
 * Molde de aislamiento (spy sobre `.eq`, `data: null` = "no es tuyo") copiado
 * de `src/app/api/operaciones/[pedidoId]/etiqueta/route.test.ts`.
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
import { GET } from "./route";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const OTRO_TENANT = "10000000-0000-0000-0000-000000000099";
const DRIVER_1 = "20000000-0000-0000-0000-000000000001";
const OTRO_DRIVER = "20000000-0000-0000-0000-000000000099";
const EVIDENCIA_1 = "50000000-0000-0000-0000-000000000001";

const usuarioConductor = {
  usuarioId: "usuario-conductor-1",
  tipoUsuario: "conductor" as const,
  driverId: DRIVER_1,
  tenantId: TENANT_A,
  sellerId: null,
  estado: "activo" as const,
  rol: "conductor" as const,
};

/** Doble mínimo: `evidencias_entrega` + `storage.from(...).createSignedUrl`. */
function crearCliente(opts: { evidencia: Record<string, unknown> | null }) {
  function builderEvidencias() {
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = vi.fn(self);
    b.eq = vi.fn(self);
    b.maybeSingle = vi.fn(async () => ({ data: opts.evidencia, error: null }));
    return b;
  }
  const createSignedUrl = vi.fn(async (path: string) => ({
    data: { signedUrl: `https://storage.example/signed/${path}` },
    error: null,
  }));
  const from = vi.fn((tabla: string) => {
    if (tabla === "evidencias_entrega") return builderEvidencias();
    throw new Error(`Tabla no mockeada en esta prueba: ${tabla}`);
  });
  return {
    from,
    storage: { from: vi.fn(() => ({ createSignedUrl })) },
  } as unknown as ReturnType<typeof crearClienteServiceRole>;
}

function evidenciaFila(overrides: Record<string, unknown> = {}) {
  return {
    id: EVIDENCIA_1,
    tenant_id: TENANT_A,
    conductor_id: DRIVER_1,
    foto_object_path: `${TENANT_A}/pedido-1/evidencias/${EVIDENCIA_1}.jpg`,
    ...overrides,
  };
}

function req() {
  return new Request("http://localhost/api/conductor/evidencias/x/url", {
    headers: { authorization: "Bearer token-conductor" },
  }) as unknown as import("next/server").NextRequest;
}

function ctx(evidenciaId: string = EVIDENCIA_1) {
  return { params: Promise.resolve({ evidenciaId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/conductor/evidencias/:evidenciaId/url — auth", () => {
  it("sin usuario autenticado → 401, sin tocar Supabase", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(null);

    const res = await GET(req(), ctx());

    expect(res.status).toBe(401);
    expect(crearClienteServiceRole).not.toHaveBeenCalled();
  });
});

describe("GET /api/conductor/evidencias/:evidenciaId/url — RECHAZO CRUZADO ENTRE COURIERS", () => {
  it("evidenciaId sintácticamente válido pero de OTRO TENANT → 403, nunca entrega la URL", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({ evidencia: null }); // filtrado por tenant_id: no aparece
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await GET(req(), ctx());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toMatch(/no existe o no pertenece al tenant/);

    const fromSpy = cliente.from as unknown as ReturnType<typeof vi.fn>;
    const llamada = fromSpy.mock.results[0].value as { eq: ReturnType<typeof vi.fn> };
    expect(llamada.eq).toHaveBeenCalledWith("tenant_id", TENANT_A);
    expect(llamada.eq).not.toHaveBeenCalledWith("tenant_id", OTRO_TENANT);
  });
});

describe("GET /api/conductor/evidencias/:evidenciaId/url — RECHAZO CRUZADO DENTRO DEL MISMO COURIER", () => {
  it("evidencia capturada por OTRO CONDUCTOR (mismo tenant) → 403, nunca entrega la URL", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({ evidencia: evidenciaFila({ conductor_id: OTRO_DRIVER }) });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await GET(req(), ctx());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toMatch(/El conductor no tiene acceso a esta evidencia/);
  });
});

describe("GET /api/conductor/evidencias/:evidenciaId/url — control positivo", () => {
  it("evidencia propia → 200 con la URL firmada", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue(usuarioConductor);
    const cliente = crearCliente({ evidencia: evidenciaFila({ conductor_id: DRIVER_1 }) });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await GET(req(), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.url).toContain("https://storage.example/signed/");
  });
});

describe("GET /api/conductor/evidencias/:evidenciaId/url — re-verificación del hallazgo de estado (ver cabecera del archivo)", () => {
  it("conductor SUSPENDIDO NO obtiene la URL firmada — 403 vía RBAC transitivo (tieneCapacidad → estaActivo), aunque la ruta no comprueba `estado` por su cuenta", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue({ ...usuarioConductor, estado: "suspendido" });
    const cliente = crearCliente({ evidencia: evidenciaFila({ conductor_id: DRIVER_1 }) });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await GET(req(), ctx());
    const body = await res.json();

    // Comportamiento REAL verificado (no el que describía el enunciado de QA):
    // rechaza igual, por `puedeMarcarEvidenciasPropias` → `tieneCapacidad`
    // → `estaActivo`. Si algún día esa cadena cambiara y dejara de exigir
    // `estado === 'activo'`, este test empezaría a fallar (200) y ahí sí
    // correspondería agregar el guard explícito que hoy falta en la ruta.
    expect(res.status).toBe(403);
    expect(body.error).toBe("El conductor no tiene capacidad para ver sus evidencias.");
  });

  it("conductor INVITADO (aún no activó su cuenta) tampoco obtiene la URL — mismo mecanismo", async () => {
    vi.mocked(autenticarBearer).mockResolvedValue({ ...usuarioConductor, estado: "invitado" });
    const cliente = crearCliente({ evidencia: evidenciaFila({ conductor_id: DRIVER_1 }) });
    vi.mocked(crearClienteServiceRole).mockReturnValue(cliente);

    const res = await GET(req(), ctx());

    expect(res.status).toBe(403);
  });
});
