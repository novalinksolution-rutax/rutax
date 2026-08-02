/**
 * Tests de `soporte.ts` — sesión de soporte time-boxed del backstage (gap 4,
 * F3-B). Foco:
 * - `iniciarSoporteTenant`: exige AAL2 (ambos roles, no solo `admin_total`),
 *   motivo obligatorio (largo mínimo), bitácora ANTES de setear la cookie, la
 *   cookie NUNCA lleva el motivo.
 * - `exigirSoporteActivo`: sin cookie → falla sin auditar; cookie
 *   expirada/inválida/de-otro-tenant/de-otro-admin → falla Y audita
 *   `plataforma.soporte_expirado`; camino feliz round-trip con la cookie real
 *   emitida por `iniciarSoporteTenant`.
 * - `terminarSoporteTenant`: limpia la cookie + audita si había sesión.
 *
 * Mismo patrón de mocks que `acciones.test.ts`/`acciones-mfa.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: vi.fn(),
}));

vi.mock("@/modules/identidad/auditoria", () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./autorizacion-admin", async (importOriginal) => {
  const real = await importOriginal<typeof import("./autorizacion-admin")>();
  return { ...real, exigirSuperAdmin: vi.fn() };
});

import { cookies } from "next/headers";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { registrarEnBitacora } from "@/modules/identidad/auditoria";
import { exigirSuperAdmin, RequiereAal2, NoAutorizadoAdmin, type ActorSuperAdmin } from "./autorizacion-admin";
import {
  iniciarSoporteTenant,
  exigirSoporteActivo,
  terminarSoporteTenant,
  NoHaySesionSoporte,
  COOKIE_SOPORTE_TENANT,
  DURACION_SOPORTE_MINUTOS,
  LARGO_MINIMO_MOTIVO,
} from "./soporte";

const SECRETO = "secreto-de-prueba-suficientemente-largo-para-hmac";
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const ADMIN_A = "ad000000-0000-0000-0000-000000000001";
const ADMIN_B = "ad000000-0000-0000-0000-000000000002";

function actor(overrides: Partial<ActorSuperAdmin> = {}): ActorSuperAdmin {
  return {
    usuarioId: ADMIN_A,
    email: "admin@rutax.cl",
    nombre: "Fundador Rutax",
    rolAdmin: "admin_total",
    aal: "aal2",
    aalSiguiente: "aal2",
    ...overrides,
  };
}

/** Cookie jar mínimo — soporta get/set/delete y expone qué se llamó. */
function crearAlmacenCookiesMock(inicial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(inicial));
  const orden: string[] = [];
  const almacen = {
    get: vi.fn((nombre: string) => (store.has(nombre) ? { name: nombre, value: store.get(nombre)! } : undefined)),
    set: vi.fn((nombre: string, valor: string, _opciones?: unknown) => {
      store.set(nombre, valor);
      orden.push("cookie_set");
    }),
    delete: vi.fn((nombre: string) => {
      store.delete(nombre);
      orden.push("cookie_delete");
    }),
  };
  return { almacen, store, orden };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPER_ADMIN_SECRET = SECRETO;
  vi.mocked(crearClienteServiceRole).mockReturnValue({} as unknown as ReturnType<typeof crearClienteServiceRole>);
});

afterEach(() => {
  delete process.env.SUPER_ADMIN_SECRET;
});

describe("iniciarSoporteTenant", () => {
  it("sin AAL2 (aal1) → RequiereAal2, no bitácora, no cookie", async () => {
    vi.mocked(exigirSuperAdmin).mockResolvedValue(actor({ aal: "aal1" }));
    const { almacen } = crearAlmacenCookiesMock();
    vi.mocked(cookies).mockResolvedValue(almacen as unknown as Awaited<ReturnType<typeof cookies>>);

    await expect(
      iniciarSoporteTenant({ tenantId: TENANT_A, motivo: "Ticket de soporte #123 del seller" }),
    ).rejects.toBeInstanceOf(RequiereAal2);

    expect(registrarEnBitacora).not.toHaveBeenCalled();
    expect(almacen.set).not.toHaveBeenCalled();
  });

  it("rol soporte_lectura CON aal2 → permitido (ambos roles pueden, es lectura)", async () => {
    vi.mocked(exigirSuperAdmin).mockResolvedValue(actor({ rolAdmin: "soporte_lectura", aal: "aal2" }));
    const { almacen } = crearAlmacenCookiesMock();
    vi.mocked(cookies).mockResolvedValue(almacen as unknown as Awaited<ReturnType<typeof cookies>>);

    const resultado = await iniciarSoporteTenant({
      tenantId: TENANT_A,
      motivo: "Investigar reclamo de facturación del seller X",
    });

    expect(resultado.tenantId).toBe(TENANT_A);
    expect(almacen.set).toHaveBeenCalledTimes(1);
  });

  it("motivo vacío → error de validación, sin bitácora ni cookie", async () => {
    vi.mocked(exigirSuperAdmin).mockResolvedValue(actor());
    const { almacen } = crearAlmacenCookiesMock();
    vi.mocked(cookies).mockResolvedValue(almacen as unknown as Awaited<ReturnType<typeof cookies>>);

    await expect(iniciarSoporteTenant({ tenantId: TENANT_A, motivo: "" })).rejects.toThrow(/motivo/i);
    expect(registrarEnBitacora).not.toHaveBeenCalled();
    expect(almacen.set).not.toHaveBeenCalled();
  });

  it(`motivo más corto que ${LARGO_MINIMO_MOTIVO} caracteres → error de validación`, async () => {
    vi.mocked(exigirSuperAdmin).mockResolvedValue(actor());
    const { almacen } = crearAlmacenCookiesMock();
    vi.mocked(cookies).mockResolvedValue(almacen as unknown as Awaited<ReturnType<typeof cookies>>);

    await expect(iniciarSoporteTenant({ tenantId: TENANT_A, motivo: "corto" })).rejects.toThrow(/motivo/i);
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it("motivo solo espacios → error de validación (trim antes de medir el largo)", async () => {
    vi.mocked(exigirSuperAdmin).mockResolvedValue(actor());
    const { almacen } = crearAlmacenCookiesMock();
    vi.mocked(cookies).mockResolvedValue(almacen as unknown as Awaited<ReturnType<typeof cookies>>);

    await expect(
      iniciarSoporteTenant({ tenantId: TENANT_A, motivo: "                     " }),
    ).rejects.toThrow(/motivo/i);
  });

  it("camino feliz: bitácora ANTES de la cookie, con actorUsuarioId real, motivo y expira_en; la cookie NUNCA lleva el motivo", async () => {
    vi.mocked(exigirSuperAdmin).mockResolvedValue(actor());
    const { almacen, orden, store } = crearAlmacenCookiesMock();
    vi.mocked(cookies).mockResolvedValue(almacen as unknown as Awaited<ReturnType<typeof cookies>>);
    // El mock de bitácora empuja a `orden` para poder afirmar que se llamó
    // ANTES del efecto (setear la cookie) — RNF-04.
    vi.mocked(registrarEnBitacora).mockImplementation(async () => {
      orden.push("bitacora");
    });

    const motivo = "Revisar por qué el seller no ve su factura del período";
    const resultado = await iniciarSoporteTenant({ tenantId: TENANT_A, motivo });

    // Bitácora antes que el efecto (RNF-04 + invariante "bitácora antes que efectos").
    expect(orden).toEqual(["bitacora", "cookie_set"]);
    // Espera a que `registrarEnBitacora` haya sido llamada antes de `set` — la
    // lista `orden` de arriba solo verifica orden de EFECTOS registrados por
    // los propios mocks; forzamos también el push en `registrarEnBitacora`.
    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_A,
        actorUsuarioId: ADMIN_A,
        actorTipo: "super_admin",
        accion: "plataforma.soporte_iniciado",
        entidadTipo: "tenant",
        entidadId: TENANT_A,
        detalle: expect.objectContaining({ motivo }),
      }),
    );

    expect(resultado.tenantId).toBe(TENANT_A);
    expect(resultado.adminId).toBe(ADMIN_A);
    expect(new Date(resultado.expiraEn).getTime()).toBeGreaterThan(Date.now());

    // La cookie es opaca — nunca contiene el motivo en texto plano.
    const tokenGuardado = store.get(COOKIE_SOPORTE_TENANT);
    expect(tokenGuardado).toBeDefined();
    expect(tokenGuardado).not.toContain(motivo);
    expect(tokenGuardado).not.toMatch(/seller|factura|per[ií]odo/i);
  });

  it("cookie seteada con httpOnly + sameSite=strict + maxAge acorde a DURACION_SOPORTE_MINUTOS", async () => {
    vi.mocked(exigirSuperAdmin).mockResolvedValue(actor());
    const { almacen } = crearAlmacenCookiesMock();
    vi.mocked(cookies).mockResolvedValue(almacen as unknown as Awaited<ReturnType<typeof cookies>>);

    await iniciarSoporteTenant({ tenantId: TENANT_A, motivo: "Motivo suficientemente largo para pasar" });

    expect(almacen.set).toHaveBeenCalledWith(
      COOKIE_SOPORTE_TENANT,
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        sameSite: "strict",
        maxAge: DURACION_SOPORTE_MINUTOS * 60,
      }),
    );
  });

  // Registrar el orden real de la llamada a `registrarEnBitacora` respecto de
  // `cookieStore.set` (defensa adicional a la aserción `orden` de arriba).
  beforeEach(() => {
    vi.mocked(registrarEnBitacora).mockImplementation(async () => undefined);
  });
});

describe("exigirSoporteActivo", () => {
  it("sin cookie → NoHaySesionSoporte, SIN auditar (evita ruido en navegación normal)", async () => {
    vi.mocked(exigirSuperAdmin).mockResolvedValue(actor());
    const { almacen } = crearAlmacenCookiesMock();
    vi.mocked(cookies).mockResolvedValue(almacen as unknown as Awaited<ReturnType<typeof cookies>>);

    await expect(exigirSoporteActivo(TENANT_A)).rejects.toBeInstanceOf(NoHaySesionSoporte);
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it("cookie con firma inválida (forjada) → falla y audita 'firma_invalida', limpia la cookie", async () => {
    vi.mocked(exigirSuperAdmin).mockResolvedValue(actor());
    const { almacen, store } = crearAlmacenCookiesMock({
      [COOKIE_SOPORTE_TENANT]: `${Buffer.from(JSON.stringify({ tenantId: TENANT_A, adminId: ADMIN_A, exp: Date.now() + 60_000 })).toString("base64url")}.firma-forjada`,
    });
    vi.mocked(cookies).mockResolvedValue(almacen as unknown as Awaited<ReturnType<typeof cookies>>);

    await expect(exigirSoporteActivo(TENANT_A)).rejects.toBeInstanceOf(NoHaySesionSoporte);

    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accion: "plataforma.soporte_expirado",
        actorUsuarioId: ADMIN_A,
        detalle: expect.objectContaining({ motivo_invalidez: "firma_invalida" }),
      }),
    );
    expect(store.has(COOKIE_SOPORTE_TENANT)).toBe(false);
  });

  it("cookie expirada → falla, audita 'expirada' y limpia la cookie", async () => {
    vi.mocked(exigirSuperAdmin).mockResolvedValue(actor());

    // Emitimos una cookie real (vía iniciarSoporteTenant) pero con el reloj
    // adelantado más allá de su expiración antes de validarla.
    const { almacen: almacenInicio, store } = crearAlmacenCookiesMock();
    vi.mocked(cookies).mockResolvedValue(almacenInicio as unknown as Awaited<ReturnType<typeof cookies>>);
    vi.mocked(exigirSuperAdmin).mockResolvedValue(actor({ aal: "aal2" }));
    await iniciarSoporteTenant({ tenantId: TENANT_A, motivo: "Motivo suficientemente largo para pasar" });

    const tokenEmitido = store.get(COOKIE_SOPORTE_TENANT)!;

    const ahoraReal = Date.now;
    Date.now = () => ahoraReal() + (DURACION_SOPORTE_MINUTOS + 1) * 60_000;
    try {
      const { almacen: almacenCheck, store: storeCheck } = crearAlmacenCookiesMock({
        [COOKIE_SOPORTE_TENANT]: tokenEmitido,
      });
      vi.mocked(cookies).mockResolvedValue(almacenCheck as unknown as Awaited<ReturnType<typeof cookies>>);

      await expect(exigirSoporteActivo(TENANT_A)).rejects.toBeInstanceOf(NoHaySesionSoporte);

      expect(registrarEnBitacora).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({
          accion: "plataforma.soporte_expirado",
          tenantId: TENANT_A,
          detalle: expect.objectContaining({ motivo_invalidez: "expirada" }),
        }),
      );
      expect(storeCheck.has(COOKIE_SOPORTE_TENANT)).toBe(false);
    } finally {
      Date.now = ahoraReal;
    }
  });

  it("cookie de OTRO tenant → falla, audita 'tenant_no_coincide' pero NO borra la cookie (puede ser una sesión legítima de otro tenant)", async () => {
    const { almacen: almacenInicio, store } = crearAlmacenCookiesMock();
    vi.mocked(cookies).mockResolvedValue(almacenInicio as unknown as Awaited<ReturnType<typeof cookies>>);
    vi.mocked(exigirSuperAdmin).mockResolvedValue(actor({ aal: "aal2" }));
    await iniciarSoporteTenant({ tenantId: TENANT_A, motivo: "Motivo suficientemente largo para pasar" });
    const tokenParaTenantA = store.get(COOKIE_SOPORTE_TENANT)!;

    const { almacen: almacenCheck, store: storeCheck } = crearAlmacenCookiesMock({
      [COOKIE_SOPORTE_TENANT]: tokenParaTenantA,
    });
    vi.mocked(cookies).mockResolvedValue(almacenCheck as unknown as Awaited<ReturnType<typeof cookies>>);
    vi.mocked(exigirSuperAdmin).mockResolvedValue(actor());

    await expect(exigirSoporteActivo(TENANT_B)).rejects.toBeInstanceOf(NoHaySesionSoporte);

    expect(registrarEnBitacora).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        accion: "plataforma.soporte_expirado",
        detalle: expect.objectContaining({ motivo_invalidez: "tenant_no_coincide" }),
      }),
    );
    // La cookie de la sesión legítima para TENANT_A sigue intacta.
    expect(storeCheck.has(COOKIE_SOPORTE_TENANT)).toBe(true);
  });

  it("cookie de OTRO admin (sesión ajena en el mismo navegador) → falla, audita 'admin_no_coincide' y la limpia", async () => {
    const { almacen: almacenInicio, store } = crearAlmacenCookiesMock();
    vi.mocked(cookies).mockResolvedValue(almacenInicio as unknown as Awaited<ReturnType<typeof cookies>>);
    vi.mocked(exigirSuperAdmin).mockResolvedValue(actor({ usuarioId: ADMIN_A, aal: "aal2" }));
    await iniciarSoporteTenant({ tenantId: TENANT_A, motivo: "Motivo suficientemente largo para pasar" });
    const tokenDeAdminA = store.get(COOKIE_SOPORTE_TENANT)!;

    const { almacen: almacenCheck, store: storeCheck } = crearAlmacenCookiesMock({
      [COOKIE_SOPORTE_TENANT]: tokenDeAdminA,
    });
    vi.mocked(cookies).mockResolvedValue(almacenCheck as unknown as Awaited<ReturnType<typeof cookies>>);
    vi.mocked(exigirSuperAdmin).mockResolvedValue(actor({ usuarioId: ADMIN_B }));

    await expect(exigirSoporteActivo(TENANT_A)).rejects.toBeInstanceOf(NoHaySesionSoporte);

    expect(registrarEnBitacora).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        accion: "plataforma.soporte_expirado",
        actorUsuarioId: ADMIN_B,
        detalle: expect.objectContaining({ motivo_invalidez: "admin_no_coincide" }),
      }),
    );
    expect(storeCheck.has(COOKIE_SOPORTE_TENANT)).toBe(false);
  });

  it("camino feliz: round-trip con la cookie real emitida por iniciarSoporteTenant", async () => {
    const { almacen: almacenInicio, store } = crearAlmacenCookiesMock();
    vi.mocked(cookies).mockResolvedValue(almacenInicio as unknown as Awaited<ReturnType<typeof cookies>>);
    vi.mocked(exigirSuperAdmin).mockResolvedValue(actor());
    const emitida = await iniciarSoporteTenant({
      tenantId: TENANT_A,
      motivo: "Motivo suficientemente largo para pasar",
    });

    const token = store.get(COOKIE_SOPORTE_TENANT)!;
    const { almacen: almacenCheck } = crearAlmacenCookiesMock({ [COOKIE_SOPORTE_TENANT]: token });
    vi.mocked(cookies).mockResolvedValue(almacenCheck as unknown as Awaited<ReturnType<typeof cookies>>);

    vi.mocked(registrarEnBitacora).mockClear();
    const sesion = await exigirSoporteActivo(TENANT_A);

    expect(sesion.tenantId).toBe(TENANT_A);
    expect(sesion.adminId).toBe(ADMIN_A);
    expect(sesion.expiraEn).toBe(emitida.expiraEn);
    // Camino feliz: NO se audita nada (no hubo invalidez que registrar).
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it("sin sesión real de super-admin → propaga NoAutorizadoAdmin, no toca cookies", async () => {
    vi.mocked(exigirSuperAdmin).mockRejectedValue(new NoAutorizadoAdmin());
    const { almacen } = crearAlmacenCookiesMock({ [COOKIE_SOPORTE_TENANT]: "algo" });
    vi.mocked(cookies).mockResolvedValue(almacen as unknown as Awaited<ReturnType<typeof cookies>>);

    await expect(exigirSoporteActivo(TENANT_A)).rejects.toBeInstanceOf(NoAutorizadoAdmin);
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });
});

describe("terminarSoporteTenant", () => {
  it("con sesión activa: audita 'plataforma.soporte_terminado' ANTES de limpiar y borra la cookie", async () => {
    const { almacen: almacenInicio, store } = crearAlmacenCookiesMock();
    vi.mocked(cookies).mockResolvedValue(almacenInicio as unknown as Awaited<ReturnType<typeof cookies>>);
    vi.mocked(exigirSuperAdmin).mockResolvedValue(actor());
    await iniciarSoporteTenant({ tenantId: TENANT_A, motivo: "Motivo suficientemente largo para pasar" });
    const token = store.get(COOKIE_SOPORTE_TENANT)!;

    const { almacen, orden } = crearAlmacenCookiesMock({ [COOKIE_SOPORTE_TENANT]: token });
    vi.mocked(cookies).mockResolvedValue(almacen as unknown as Awaited<ReturnType<typeof cookies>>);
    vi.mocked(registrarEnBitacora).mockClear();

    await terminarSoporteTenant();

    expect(registrarEnBitacora).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_A,
        actorUsuarioId: ADMIN_A,
        accion: "plataforma.soporte_terminado",
      }),
    );
    expect(almacen.delete).toHaveBeenCalledWith(COOKIE_SOPORTE_TENANT);
    expect(orden).toEqual(["cookie_delete"]);
  });

  it("sin cookie previa: no-op silencioso, sin bitácora", async () => {
    vi.mocked(exigirSuperAdmin).mockResolvedValue(actor());
    const { almacen } = crearAlmacenCookiesMock();
    vi.mocked(cookies).mockResolvedValue(almacen as unknown as Awaited<ReturnType<typeof cookies>>);

    await terminarSoporteTenant();

    expect(registrarEnBitacora).not.toHaveBeenCalled();
    expect(almacen.delete).toHaveBeenCalledWith(COOKIE_SOPORTE_TENANT);
  });
});
