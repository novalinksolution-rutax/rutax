import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./auditoria", () => ({
  registrarEnBitacora: vi.fn().mockResolvedValue(undefined),
}));

import { commitAltaSellerAutoservicio, type DatosAltaSellerAutoservicio } from "./alta-seller-autoservicio";
import { ErrorConflicto, ErrorValidacion } from "./errores";
import { registrarEnBitacora } from "./auditoria";
import type { ClienteServicio } from "./onboarding";

/** RUT verificado (cuerpo 76543210 → DV módulo 11 = 3) — mismo usado en `onboarding.test.ts`. */
const RUT_VALIDO = "76543210-3";
const TENANT_1 = "tenant-1";
const AUTH_USER = "auth-1";

/**
 * Toda la escritura del alta vive ahora en la RPC atómica
 * `identidad.alta_seller_autoservicio` (probada contra Postgres real). Acá se
 * prueba lo que sigue en TypeScript: la validación (ANTES), el armado del
 * payload, el mapeo de errores de la RPC y la bitácora (DESPUÉS).
 */
function crearClienteConRpc(respuesta: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn().mockResolvedValue({ data: respuesta.data ?? null, error: respuesta.error ?? null });
  const cliente = {
    schema: () => ({ rpc }),
  } as unknown as ClienteServicio;
  return { cliente, rpc };
}

function datosBase(overrides?: Partial<DatosAltaSellerAutoservicio>): DatosAltaSellerAutoservicio {
  return {
    authUserId: AUTH_USER,
    email: "Vendedor@Empresa.cl",
    tenantId: TENANT_1,
    empresa: {
      razonSocial: "Empresa Uno SpA",
      rut: RUT_VALIDO,
      aceptaConsentimientoDatos: true,
      consentimientoDatosEn: new Date().toISOString(),
    },
    contacto: { nombreContacto: "Juana Pérez", telefono: null },
    bodega: {
      nombre: "Bodega Centro",
      direccion: "Av. Siempre Viva 123",
      comuna: "Santiago",
      instruccionesAcceso: null,
      contactoNombre: null,
      contactoTelefono: null,
      lat: -33.45,
      long: -70.66,
      geoEstado: "resuelto",
      geoConfianza: 0.9,
      geocodificadoEn: new Date().toISOString(),
    },
    whatsapp: { telefono: "912345678", acepta: true },
    fuentes: ["rutax_manual"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("commitAltaSellerAutoservicio — delega en la RPC atómica", () => {
  it("alta feliz: arma el payload, devuelve el resultado de la RPC y audita", async () => {
    const { cliente, rpc } = crearClienteConRpc({
      data: { seller_id: "seller-nuevo", es_primera_membresia: true },
    });

    const resultado = await commitAltaSellerAutoservicio(cliente, datosBase());

    expect(resultado).toEqual({ sellerId: "seller-nuevo", tenantId: TENANT_1, esPrimeraMembresia: true });

    // El payload lleva los datos ya normalizados: RUT válido, email tal cual
    // (la RPC lo baja a minúsculas), WhatsApp en E.164 sin '+', fuentes.
    expect(rpc).toHaveBeenCalledTimes(1);
    const [nombreRpc, args] = rpc.mock.calls[0];
    expect(nombreRpc).toBe("alta_seller_autoservicio");
    expect(args.p_payload).toMatchObject({
      auth_user_id: AUTH_USER,
      tenant_id: TENANT_1,
      rut: RUT_VALIDO,
      whatsapp_e164: "56912345678",
      fuentes: ["rutax_manual"],
    });
    expect(args.p_payload.bodega).toMatchObject({ comuna: "Santiago", geo_estado: "resuelto" });

    expect(registrarEnBitacora).toHaveBeenCalledTimes(1);
    expect(vi.mocked(registrarEnBitacora).mock.calls[0][1]).toMatchObject({
      accion: "seller.alta_autoservicio",
      tenantId: TENANT_1,
      entidadId: "seller-nuevo",
    });
  });

  it("propaga es_primera_membresia=false (reapunte multi-courier lo decide la RPC)", async () => {
    const { cliente } = crearClienteConRpc({
      data: { seller_id: "seller-nuevo", es_primera_membresia: false },
    });

    const resultado = await commitAltaSellerAutoservicio(cliente, datosBase());

    expect(resultado.esPrimeraMembresia).toBe(false);
  });

  it("RUT ocupado por otra identidad (23505) → ErrorConflicto, sin auditar", async () => {
    const { cliente } = crearClienteConRpc({ error: { code: "23505", message: "rut ocupado" } });

    await expect(commitAltaSellerAutoservicio(cliente, datosBase())).rejects.toBeInstanceOf(ErrorConflicto);
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });

  it("perfil existente no-seller (P0001) → ErrorValidacion", async () => {
    const { cliente } = crearClienteConRpc({
      error: { code: "P0001", message: "la cuenta no puede registrarse como seller" },
    });

    await expect(commitAltaSellerAutoservicio(cliente, datosBase())).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it("RPC fuera del caché de PostgREST (PGRST202) → lanza duro, NUNCA finge éxito ni audita", async () => {
    const { cliente } = crearClienteConRpc({
      error: { code: "PGRST202", message: "Could not find the function in the schema cache" },
    });

    const promesa = commitAltaSellerAutoservicio(cliente, datosBase());
    await expect(promesa).rejects.toThrow();
    // No es un conflicto ni una validación: es infra caída, se propaga como error genérico.
    await expect(promesa).rejects.not.toBeInstanceOf(ErrorConflicto);
    expect(registrarEnBitacora).not.toHaveBeenCalled();
  });
});

describe("commitAltaSellerAutoservicio — validación ANTES de tocar la RPC", () => {
  it("rechaza un RUT de empresa inválido y NO llama la RPC", async () => {
    const { cliente, rpc } = crearClienteConRpc({ data: { seller_id: "x", es_primera_membresia: true } });
    await expect(
      commitAltaSellerAutoservicio(cliente, {
        ...datosBase(),
        empresa: {
          razonSocial: "X SpA",
          rut: "76543210-9",
          aceptaConsentimientoDatos: true,
          consentimientoDatosEn: new Date().toISOString(),
        },
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rechaza sin el consentimiento de datos (Ley 21.719)", async () => {
    const { cliente, rpc } = crearClienteConRpc({ data: {} });
    await expect(
      commitAltaSellerAutoservicio(cliente, {
        ...datosBase(),
        empresa: {
          razonSocial: "Empresa Uno SpA",
          rut: RUT_VALIDO,
          aceptaConsentimientoDatos: false,
          consentimientoDatosEn: "",
        },
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rechaza sin fuentes declaradas", async () => {
    const { cliente } = crearClienteConRpc({ data: {} });
    await expect(commitAltaSellerAutoservicio(cliente, datosBase({ fuentes: [] }))).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it("rechaza sin el opt-in de WhatsApp", async () => {
    const { cliente } = crearClienteConRpc({ data: {} });
    await expect(
      commitAltaSellerAutoservicio(cliente, datosBase({ whatsapp: { telefono: "912345678", acepta: false } })),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it("rechaza una comuna fuera de la Región Metropolitana", async () => {
    const { cliente } = crearClienteConRpc({ data: {} });
    const datos = datosBase();
    await expect(
      commitAltaSellerAutoservicio(cliente, { ...datos, bodega: { ...datos.bodega, comuna: "Valparaíso" } }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
