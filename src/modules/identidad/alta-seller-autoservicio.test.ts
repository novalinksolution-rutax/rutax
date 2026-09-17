import { describe, expect, it } from "vitest";
import { commitAltaSellerAutoservicio, type DatosAltaSellerAutoservicio } from "./alta-seller-autoservicio";
import { ErrorConflicto, ErrorValidacion } from "./errores";
import { crearClienteAltaSellerFalso } from "./alta-seller-postgrest-falso";

/** RUT verificado (cuerpo 76543210 → DV módulo 11 = 3) — mismo usado en `onboarding.test.ts`. */
const RUT_VALIDO = "76543210-3";

const TENANT_1 = "tenant-1";
const TENANT_2 = "tenant-2";
const AUTH_USER = "auth-1";

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

describe("commitAltaSellerAutoservicio", () => {
  it("crea todo el alta (primera membresía) y nace ACTIVO, sin aprobación", async () => {
    const { cliente, estado } = crearClienteAltaSellerFalso();

    const resultado = await commitAltaSellerAutoservicio(cliente, datosBase());

    expect(resultado.esPrimeraMembresia).toBe(true);
    expect(resultado.tenantId).toBe(TENANT_1);

    expect(estado.sellers).toHaveLength(1);
    expect(estado.sellers[0]).toMatchObject({
      tenant_id: TENANT_1,
      rut: RUT_VALIDO,
      estado: "activo",
      email_contacto: "vendedor@empresa.cl",
    });

    expect(estado.sellerIdentidades).toHaveLength(1);
    expect(estado.sellerIdentidades[0]).toMatchObject({ auth_user_id: AUTH_USER, rut: RUT_VALIDO });

    expect(estado.sellerBodegas).toHaveLength(1);
    expect(estado.sellerBodegas[0]).toMatchObject({ es_principal: true, activa: true, geo_estado: "resuelto" });

    expect(estado.whatsappContactos).toHaveLength(1);
    expect(estado.whatsappContactos[0]).toMatchObject({
      telefono_e164: "56912345678",
      origen: "perfil_seller",
      opt_in_estado: "otorgado",
    });

    expect(estado.sellerFuentes).toHaveLength(1);
    // rutax_manual nace 'conectada' — no necesita token.
    expect(estado.sellerFuentes[0]).toMatchObject({ fuente: "rutax_manual", estado: "conectada" });

    expect(estado.sellerMembresias).toHaveLength(1);
    expect(estado.sellerMembresias[0]).toMatchObject({
      auth_user_id: AUTH_USER,
      tenant_id: TENANT_1,
      estado: "activa",
    });

    // Primera membresía: usuarios_perfil se CREA con tipo_usuario='seller'.
    expect(estado.perfiles).toHaveLength(1);
    expect(estado.perfiles[0]).toMatchObject({
      id: AUTH_USER,
      tenant_id: TENANT_1,
      tipo_usuario: "seller",
      rol: "seller",
      estado: "activo",
    });

    expect(estado.bitacora).toHaveLength(1);
    expect(estado.bitacora[0]).toMatchObject({ accion: "seller.alta_autoservicio", tenant_id: TENANT_1 });
  });

  it("fuentes distintas de rutax_manual nacen 'pendiente'", async () => {
    const { cliente, estado } = crearClienteAltaSellerFalso();
    await commitAltaSellerAutoservicio(cliente, datosBase({ fuentes: ["ml_flex", "shopify"] }));

    expect(estado.sellerFuentes).toHaveLength(2);
    for (const fila of estado.sellerFuentes) {
      expect(fila.estado).toBe("pendiente");
    }
  });

  it("si ya era seller de OTRO courier, REAPUNTA usuarios_perfil en vez de crear uno nuevo", async () => {
    const { cliente, estado } = crearClienteAltaSellerFalso({
      perfiles: [
        {
          id: AUTH_USER,
          tenant_id: TENANT_2,
          seller_id: "seller-en-otro-tenant",
          tipo_usuario: "seller",
          rol: "seller",
          estado: "activo",
        },
      ],
    });

    const resultado = await commitAltaSellerAutoservicio(cliente, datosBase());

    expect(resultado.esPrimeraMembresia).toBe(false);
    // Sigue habiendo UNA sola fila de usuarios_perfil (1:1) — reapuntada a este tenant.
    expect(estado.perfiles).toHaveLength(1);
    expect(estado.perfiles[0]).toMatchObject({ id: AUTH_USER, tenant_id: TENANT_1 });
    expect(estado.perfiles[0].seller_id).toBe(resultado.sellerId);
  });

  it("rechaza si la identidad ya es conductor/interno — defensa en profundidad", async () => {
    const { cliente } = crearClienteAltaSellerFalso({
      perfiles: [{ id: AUTH_USER, tenant_id: TENANT_2, tipo_usuario: "conductor", rol: "conductor", estado: "activo" }],
    });

    await expect(commitAltaSellerAutoservicio(cliente, datosBase())).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it("RUT duplicado en el mismo tenant → ErrorConflicto, sin escribir nada más", async () => {
    const { cliente, estado } = crearClienteAltaSellerFalso({
      sellers: [{ id: "seller-existente", tenant_id: TENANT_1, rut: RUT_VALIDO }],
    });

    await expect(commitAltaSellerAutoservicio(cliente, datosBase())).rejects.toBeInstanceOf(ErrorConflicto);

    // No se creó una segunda fila de sellers, ni nada aguas abajo.
    expect(estado.sellers).toHaveLength(1);
    expect(estado.sellerBodegas).toHaveLength(0);
    expect(estado.sellerMembresias).toHaveLength(0);
    expect(estado.bitacora).toHaveLength(0);
  });

  it("rechaza sin fuentes declaradas", async () => {
    const { cliente } = crearClienteAltaSellerFalso();
    await expect(commitAltaSellerAutoservicio(cliente, datosBase({ fuentes: [] }))).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  it("rechaza sin el opt-in de WhatsApp", async () => {
    const { cliente } = crearClienteAltaSellerFalso();
    await expect(
      commitAltaSellerAutoservicio(
        cliente,
        datosBase({ whatsapp: { telefono: "912345678", acepta: false } }),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it("rechaza un RUT de empresa inválido (dígito verificador incorrecto)", async () => {
    const { cliente } = crearClienteAltaSellerFalso();
    await expect(
      commitAltaSellerAutoservicio(
        cliente,
        datosBase({
          empresa: {
            razonSocial: "X SpA",
            rut: "76543210-9",
            aceptaConsentimientoDatos: true,
            consentimientoDatosEn: new Date().toISOString(),
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it("rechaza si no llegó el consentimiento de datos (Ley 21.719) — defensa en profundidad", async () => {
    const { cliente, estado } = crearClienteAltaSellerFalso();
    await expect(
      commitAltaSellerAutoservicio(
        cliente,
        datosBase({
          empresa: {
            razonSocial: "Empresa Uno SpA",
            rut: RUT_VALIDO,
            aceptaConsentimientoDatos: false,
            consentimientoDatosEn: "",
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    // No se escribió nada: la validación corre antes del primer INSERT.
    expect(estado.sellerIdentidades).toHaveLength(0);
    expect(estado.sellers).toHaveLength(0);
  });

  it("rechaza una comuna fuera de la Región Metropolitana", async () => {
    const { cliente } = crearClienteAltaSellerFalso();
    const datos = datosBase();
    await expect(
      commitAltaSellerAutoservicio(cliente, { ...datos, bodega: { ...datos.bodega, comuna: "Valparaíso" } }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it("si falla un paso tardío (whatsapp), deshace lo insertado ANTES (bodega y seller)", async () => {
    const { cliente, estado } = crearClienteAltaSellerFalso({ forzarErrorEnWhatsapp: true });

    await expect(commitAltaSellerAutoservicio(cliente, datosBase())).rejects.toThrow();

    // Compensación best-effort: no queda ni la fila de sellers ni la de la bodega.
    expect(estado.sellers).toHaveLength(0);
    expect(estado.sellerBodegas).toHaveLength(0);
    expect(estado.sellerMembresias).toHaveLength(0);
    expect(estado.sellerFuentes).toHaveLength(0);
    // Nunca se llegó a escribir usuarios_perfil ni la bitácora.
    expect(estado.perfiles).toHaveLength(0);
    expect(estado.bitacora).toHaveLength(0);
    // seller_identidades SÍ sobrevive (empresa compartida, upsert legítimo aunque el alta en este tenant falle).
    expect(estado.sellerIdentidades).toHaveLength(1);
  });
});
