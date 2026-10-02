/**
 * Pruebas de «Tu empresa»: validación en el servidor, orden bitácora → efecto,
 * idempotencia del reintento y evidencia de aceptación de términos.
 * Llaman la lógica real; solo `onboarding` (tenant + dueño) va simulado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./onboarding", () => ({
  buscarPerfilPorAuthUserId: vi.fn(),
  provisionarTenantParaAuthUser: vi.fn(),
}));

import { ErrorConflicto } from "./errores";
import { buscarPerfilPorAuthUserId, provisionarTenantParaAuthUser } from "./onboarding";
import {
  nombreDesdeIdentidad,
  registrarEmpresaCourier,
  resolverAceptacion,
  validarRegistroEmpresa,
  type AceptacionTerminos,
  type EntradaRegistroEmpresa,
} from "./registro-empresa";

const ENTRADA: EntradaRegistroEmpresa = {
  nombreFantasia: "  Envíos Cordillera ",
  rut: "76.543.210-3",
  nombreDueno: "María Pérez",
  enviosDiaRango: "100_300",
  conductoresRango: "6_15",
  fuentesPedidos: ["mercado_libre_flex", "shopify"],
};

const ACEPTACION: AceptacionTerminos = {
  terminosVersion: "v1",
  privacidadVersion: "v2",
  aceptadoEn: "2026-10-01T15:00:00.000Z",
  via: "intencion_registro",
};

describe("validarRegistroEmpresa", () => {
  it("acepta y normaliza (RUT, espacios, orden de campos)", () => {
    const r = validarRegistroEmpresa(ENTRADA, null);
    expect(r).toMatchObject({
      ok: true,
      datos: { nombreFantasia: "Envíos Cordillera", rut: "76543210-3", nombreDueno: "María Pérez" },
    });
  });

  it("nombre de fantasía vacío / RUT inválido", () => {
    expect(validarRegistroEmpresa({ ...ENTRADA, nombreFantasia: "  " }, null)).toMatchObject({
      ok: false,
      campo: "nombreFantasia",
    });
    expect(validarRegistroEmpresa({ ...ENTRADA, rut: "76543210-9" }, null)).toMatchObject({
      ok: false,
      campo: "rut",
    });
  });

  it("'Tu nombre' es obligatorio SOLO si la identidad no trae nombre; si lo trae, manda la identidad", () => {
    expect(validarRegistroEmpresa({ ...ENTRADA, nombreDueno: "" }, null)).toMatchObject({
      ok: false,
      campo: "nombreDueno",
    });
    const r = validarRegistroEmpresa({ ...ENTRADA, nombreDueno: "Otro Nombre" }, "Nombre De Google");
    expect(r).toMatchObject({ ok: true, datos: { nombreDueno: "Nombre De Google" } });
    expect(validarRegistroEmpresa({ ...ENTRADA, nombreDueno: undefined }, "Nombre De Google").ok).toBe(true);
  });

  it("🔴 las tres preguntas: valor fuera de lista o vacío se rechaza con su campo", () => {
    expect(validarRegistroEmpresa({ ...ENTRADA, enviosDiaRango: "muchos" }, null)).toMatchObject({
      ok: false,
      campo: "enviosDiaRango",
    });
    expect(validarRegistroEmpresa({ ...ENTRADA, conductoresRango: "" }, null)).toMatchObject({
      ok: false,
      campo: "conductoresRango",
    });
    expect(validarRegistroEmpresa({ ...ENTRADA, fuentesPedidos: [] }, null)).toMatchObject({
      ok: false,
      campo: "fuentesPedidos",
    });
    expect(validarRegistroEmpresa({ ...ENTRADA, fuentesPedidos: ["tiktok"] }, null)).toMatchObject({
      ok: false,
      campo: "fuentesPedidos",
    });
  });

  it("🔴 'otra' sin texto (o en blanco, o > 80) se rechaza en fuenteOtra; con texto pasa", () => {
    const base = { ...ENTRADA, fuentesPedidos: ["otra"] };
    expect(validarRegistroEmpresa(base, null)).toMatchObject({ ok: false, campo: "fuenteOtra" });
    expect(validarRegistroEmpresa({ ...base, fuenteOtra: "   " }, null)).toMatchObject({
      ok: false,
      campo: "fuenteOtra",
    });
    expect(validarRegistroEmpresa({ ...base, fuenteOtra: "x".repeat(81) }, null)).toMatchObject({
      ok: false,
      campo: "fuenteOtra",
    });
    expect(validarRegistroEmpresa({ ...base, fuenteOtra: "Instagram" }, null)).toMatchObject({
      ok: true,
      datos: { fuenteOtra: "Instagram" },
    });
  });

  it("sin 'otra', el texto sobrante se descarta (la base exige NULL)", () => {
    const r = validarRegistroEmpresa({ ...ENTRADA, fuenteOtra: "algo" }, null);
    expect(r).toMatchObject({ ok: true, datos: { fuenteOtra: null } });
  });
});

describe("nombreDesdeIdentidad", () => {
  it("lee nombre_completo, full_name o name; null si no hay", () => {
    expect(nombreDesdeIdentidad({ full_name: " Ana Soto " })).toBe("Ana Soto");
    expect(nombreDesdeIdentidad({ name: "Ana" })).toBe("Ana");
    expect(nombreDesdeIdentidad({ nombre_completo: "Luis Rojas", name: "x" })).toBe("Luis Rojas");
    expect(nombreDesdeIdentidad({ email: "a@b.cl" })).toBeNull();
    expect(nombreDesdeIdentidad(null)).toBeNull();
  });
});

describe("resolverAceptacion", () => {
  const vigente = { terminosVersion: "v1", privacidadVersion: "v2", aceptadoEn: "2026-10-02T10:00:00.000Z" };
  it("con intención: la de la cookie (el primer clic), no la de ahora", () => {
    const intencion = { terminosVersion: "v1", privacidadVersion: "v1", aceptadoEn: "2026-10-01T09:00:00.000Z" };
    expect(resolverAceptacion(intencion, false, vigente)).toEqual({ ...intencion, via: "intencion_registro" });
  });
  it("sin intención pero con aviso visible: vigente, vía pantalla_empresa", () => {
    expect(resolverAceptacion(null, true, vigente)).toEqual({ ...vigente, via: "pantalla_empresa" });
  });
  it("🔴 sin intención y sin aviso: null (no se crea una empresa sin evidencia)", () => {
    expect(resolverAceptacion(null, false, vigente)).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// registrarEmpresaCourier con un cliente que registra el ORDEN de las escrituras
// -----------------------------------------------------------------------------

interface Fila {
  terminos_version?: string | null;
  comercial?: boolean;
}

function clienteFalso(estado: Fila = {}, fallos: { insertComercial?: boolean } = {}) {
  const eventos: string[] = [];
  const bitacora: Array<Record<string, unknown>> = [];
  const escrituras: Array<{ tabla: string; op: string; payload?: Record<string, unknown> }> = [];

  const desde = (tabla: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => {
          if (tabla === "tenants") return { data: { terminos_version: estado.terminos_version ?? null }, error: null };
          if (tabla === "courier_perfil_comercial") {
            return { data: estado.comercial ? { tenant_id: "t-1" } : null, error: null };
          }
          return { data: null, error: null };
        },
      }),
    }),
    insert: async (payload: Record<string, unknown>) => {
      if (tabla === "bitacora_auditoria") {
        eventos.push(`bitacora:${String(payload.accion)}`);
        bitacora.push(payload);
        return { error: null };
      }
      eventos.push(`insert:${tabla}`);
      escrituras.push({ tabla, op: "insert", payload });
      if (tabla === "courier_perfil_comercial" && fallos.insertComercial) {
        return { error: { message: "boom" } };
      }
      return { error: null };
    },
    update: (payload: Record<string, unknown>) => ({
      eq: () => ({
        is: async () => {
          eventos.push(`update:${tabla}`);
          escrituras.push({ tabla, op: "update", payload });
          return { error: null };
        },
      }),
    }),
  });

  const cliente = { from: desde, schema: () => ({ from: desde }), auth: {} };
  return { cliente: cliente as never, eventos, bitacora, escrituras };
}

function params(over: Partial<Parameters<typeof registrarEmpresaCourier>[1]> = {}) {
  return {
    authUserId: "auth-1",
    email: "dueno@x.cl",
    nombreIdentidad: null,
    entrada: ENTRADA,
    aceptacion: ACEPTACION,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue(null);
  vi.mocked(provisionarTenantParaAuthUser).mockResolvedValue({ tenantId: "t-1", duenoUsuarioId: "auth-1" });
});

describe("registrarEmpresaCourier", () => {
  it("camino feliz: crea tenant con el dueño como AUTOR, y cada escritura va precedida de su asiento con actorUsuarioId", async () => {
    const { cliente, eventos, bitacora } = clienteFalso();
    const r = await registrarEmpresaCourier(cliente, params());

    expect(r).toEqual({ ok: true, tenantId: "t-1", yaExistia: false });
    expect(provisionarTenantParaAuthUser).toHaveBeenCalledWith(
      cliente,
      "auth-1",
      expect.objectContaining({
        tenant: { nombreFantasia: "Envíos Cordillera", rut: "76543210-3" },
        actor: { usuarioId: "auth-1", tipo: "usuario" },
      }),
      { estado: "activo", compensarAuthUser: false },
    );
    // 🔴 Orden: bitácora ANTES de cada efecto.
    expect(eventos).toEqual([
      "bitacora:registro.terminos_aceptados",
      "update:tenants",
      "bitacora:registro.perfil_comercial_declarado",
      "insert:courier_perfil_comercial",
    ]);
    expect(bitacora.every((b) => b.actor_usuario_id === "auth-1" && b.actor_tipo === "usuario")).toBe(true);
    expect(bitacora.every((b) => b.tenant_id === "t-1")).toBe(true);
  });

  it("persiste versión, instante y autor de la aceptación, y los valores del perfil comercial", async () => {
    const { cliente, escrituras, bitacora } = clienteFalso();
    await registrarEmpresaCourier(cliente, params());

    expect(escrituras.find((e) => e.tabla === "tenants")?.payload).toEqual({
      terminos_version: "v1",
      terminos_aceptados_en: "2026-10-01T15:00:00.000Z",
      terminos_aceptados_por: "auth-1",
      privacidad_version_informada: "v2",
    });
    expect(escrituras.find((e) => e.tabla === "courier_perfil_comercial")?.payload).toEqual({
      tenant_id: "t-1",
      envios_dia_rango: "100_300",
      conductores_rango: "6_15",
      fuentes_pedidos: ["mercado_libre_flex", "shopify"],
      fuente_otra: null,
    });
    expect(bitacora[0].detalle).toMatchObject({ terminos_version: "v1", via: "intencion_registro" });
  });

  it("validación fallida: no toca la base", async () => {
    const { cliente, eventos } = clienteFalso();
    const r = await registrarEmpresaCourier(cliente, params({ entrada: { ...ENTRADA, enviosDiaRango: "zzz" } }));
    expect(r).toMatchObject({ ok: false, tipo: "validacion", campo: "enviosDiaRango" });
    expect(buscarPerfilPorAuthUserId).not.toHaveBeenCalled();
    expect(provisionarTenantParaAuthUser).not.toHaveBeenCalled();
    expect(eventos).toEqual([]);
  });

  it("🔴 RUT duplicado → conflicto_rut con el mensaje de siempre, y no se escribe nada más", async () => {
    vi.mocked(provisionarTenantParaAuthUser).mockRejectedValue(
      new ErrorConflicto("Ya existe un courier registrado con el RUT 76543210-3."),
    );
    const { cliente, eventos } = clienteFalso();
    const r = await registrarEmpresaCourier(cliente, params());
    expect(r).toEqual({
      ok: false,
      tipo: "conflicto_rut",
      mensaje: "Ya existe un courier registrado con el RUT 76543210-3.",
    });
    expect(eventos).toEqual([]);
  });

  it("falla de infraestructura al crear → desconocido sin filtrar el detalle", async () => {
    vi.mocked(provisionarTenantParaAuthUser).mockRejectedValue(new Error("boom interno"));
    const { cliente } = clienteFalso();
    const r = await registrarEmpresaCourier(cliente, params());
    expect(r).toMatchObject({ ok: false, tipo: "desconocido" });
    expect(JSON.stringify(r.ok ? "" : r.mensaje)).not.toContain("boom");
  });

  it("🔴 correo con perfil de OTRO tipo → correo_ocupado, no crea nada", async () => {
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue({
      tenantId: "t-9",
      tipoUsuario: "seller",
      rol: "seller",
      estado: "activo",
    });
    const { cliente, eventos } = clienteFalso();
    const r = await registrarEmpresaCourier(cliente, params());
    expect(r).toMatchObject({ ok: false, tipo: "correo_ocupado" });
    expect(provisionarTenantParaAuthUser).not.toHaveBeenCalled();
    expect(eventos).toEqual([]);
  });

  it("🔴 reintento tras fallo a mitad: dueño ya existe → NO reprovisiona, completa lo que falta", async () => {
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue({
      tenantId: "t-1",
      tipoUsuario: "interno",
      rol: "dueno",
      estado: "activo",
    });
    const { cliente, eventos } = clienteFalso();
    const r = await registrarEmpresaCourier(cliente, params());
    expect(r).toEqual({ ok: true, tenantId: "t-1", yaExistia: true });
    expect(provisionarTenantParaAuthUser).not.toHaveBeenCalled();
    expect(eventos).toContain("insert:courier_perfil_comercial");
  });

  it("reintento con todo ya escrito: no duplica asientos ni pisa la evidencia", async () => {
    vi.mocked(buscarPerfilPorAuthUserId).mockResolvedValue({
      tenantId: "t-1",
      tipoUsuario: "interno",
      rol: "dueno",
      estado: "activo",
    });
    const { cliente, eventos } = clienteFalso({ terminos_version: "v1", comercial: true });
    const r = await registrarEmpresaCourier(cliente, params());
    expect(r).toMatchObject({ ok: true, yaExistia: true });
    expect(eventos).toEqual([]);
  });

  it("falla al guardar el perfil comercial → desconocido, pero el asiento ya quedó ANTES del intento", async () => {
    const { cliente, eventos } = clienteFalso({}, { insertComercial: true });
    const r = await registrarEmpresaCourier(cliente, params());
    expect(r).toMatchObject({ ok: false, tipo: "desconocido" });
    expect(eventos.indexOf("bitacora:registro.perfil_comercial_declarado")).toBeLessThan(
      eventos.indexOf("insert:courier_perfil_comercial"),
    );
  });
});
