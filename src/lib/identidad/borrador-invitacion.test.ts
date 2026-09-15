/**
 * Pruebas del borrador firmado de invitación — cookie que sobrevive el
 * ida-y-vuelta a Google (o la verificación del código OTP) entre "aceptar la
 * invitación" y que la identidad quede resuelta (F3).
 *
 * Mismo molde que `borrador-registro.test.ts` — se repiten los casos de
 * fail-closed (firma corrupta, cuerpo alterado, vencimiento) porque el
 * mecanismo es el mismo, solo con otro payload y otra cookie.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const almacen = new Map<string, { value: string }>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nombre: string) => almacen.get(nombre),
    set: (nombre: string, valor: string) => {
      almacen.set(nombre, { value: valor });
    },
    delete: (nombre: string) => {
      almacen.delete(nombre);
    },
  }),
}));

import {
  COOKIE_BORRADOR_INVITACION,
  guardarBorrador,
  leerBorrador,
  limpiarBorrador,
  type BorradorInvitacion,
} from "./borrador-invitacion";

const DATOS: BorradorInvitacion = {
  token: "token-secreto-de-canje",
  optInWhatsApp: true,
  telefonoWhatsApp: "+56 9 1234 5678",
};

describe("borrador-invitacion", () => {
  const secretoOriginal = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    almacen.clear();
    process.env.SUPABASE_SERVICE_ROLE_KEY = "secreto-de-prueba-bien-largo-1234567890";
  });

  afterEach(() => {
    if (secretoOriginal === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = secretoOriginal;
  });

  it("guarda y relee el borrador tal cual se escribió", async () => {
    await guardarBorrador(DATOS);
    const leido = await leerBorrador();
    expect(leido).toEqual(DATOS);
  });

  it("guarda y relee un borrador sin WhatsApp (interno, no seller)", async () => {
    await guardarBorrador({ token: "token-de-interno" });
    const leido = await leerBorrador();
    expect(leido).toEqual({ token: "token-de-interno" });
  });

  it("sin cookie, devuelve null", async () => {
    expect(await leerBorrador()).toBeNull();
  });

  it("usa una cookie DISTINTA de la de registro (rutax_invitacion)", () => {
    expect(COOKIE_BORRADOR_INVITACION).toBe("rutax_invitacion");
    expect(COOKIE_BORRADOR_INVITACION).not.toBe("rutax_registro_borrador");
  });

  it("la cookie es httpOnly, sameSite=lax y con Max-Age acotado (sobrevive la vuelta de Google)", async () => {
    const opciones: Array<Record<string, unknown>> = [];
    const cookiesConOpciones = {
      get: (nombre: string) => almacen.get(nombre),
      set: (nombre: string, valor: string, opts: Record<string, unknown>) => {
        almacen.set(nombre, { value: valor });
        opciones.push(opts);
      },
      delete: (nombre: string) => almacen.delete(nombre),
    };
    vi.doMock("next/headers", () => ({ cookies: async () => cookiesConOpciones }));
    vi.resetModules();

    const modulo = await import("./borrador-invitacion");
    await modulo.guardarBorrador(DATOS);

    expect(opciones).toHaveLength(1);
    expect(opciones[0]).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    expect(opciones[0].maxAge).toBeGreaterThan(0);

    vi.doUnmock("next/headers");
  });

  it("firma inválida (cookie manipulada) → null, fail-closed", async () => {
    await guardarBorrador(DATOS);
    const cookie = almacen.get(COOKIE_BORRADOR_INVITACION);
    expect(cookie).toBeDefined();
    const separador = cookie!.value.lastIndexOf(".");
    almacen.set(COOKIE_BORRADOR_INVITACION, {
      value: `${cookie!.value.slice(0, separador)}.firma-forjada`,
    });

    expect(await leerBorrador()).toBeNull();
  });

  it("cuerpo alterado sin resignar → null (la firma ya no calza con el nuevo cuerpo)", async () => {
    await guardarBorrador(DATOS);
    const cookie = almacen.get(COOKIE_BORRADOR_INVITACION)!;
    const separador = cookie.value.lastIndexOf(".");
    const cuerpoAlterado = Buffer.from(JSON.stringify({ ...DATOS, token: "otro-token-cualquiera" })).toString(
      "base64url",
    );
    almacen.set(COOKIE_BORRADOR_INVITACION, {
      value: `${cuerpoAlterado}.${cookie.value.slice(separador + 1)}`,
    });

    expect(await leerBorrador()).toBeNull();
  });

  it("borrador vencido (exp en el pasado) → null aunque la firma sea válida", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await guardarBorrador(DATOS);

    vi.setSystemTime(new Date("2026-01-01T01:00:00Z"));
    expect(await leerBorrador()).toBeNull();
    vi.useRealTimers();
  });

  it("limpiarBorrador borra la cookie — de un solo uso", async () => {
    await guardarBorrador(DATOS);
    expect(await leerBorrador()).not.toBeNull();

    await limpiarBorrador();

    expect(await leerBorrador()).toBeNull();
  });

  it("sin SUPABASE_SERVICE_ROLE_KEY, guardarBorrador lanza (fail-closed, no un borrador sin firma)", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(guardarBorrador(DATOS)).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
