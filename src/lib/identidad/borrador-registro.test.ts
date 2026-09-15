/**
 * Pruebas del borrador firmado de registro — cookie que sobrevive el
 * ida-y-vuelta a Google (o a la verificación del código OTP) entre el
 * formulario de alta de empresa y la provisión del tenant (F1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// -----------------------------------------------------------------------------
// Doble de `next/headers` — un `Map` en memoria que imita el almacén de
// cookies (get/set/delete), suficiente para lo que este módulo usa.
// -----------------------------------------------------------------------------
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
  COOKIE_BORRADOR_REGISTRO,
  guardarBorrador,
  leerBorrador,
  limpiarBorrador,
  type BorradorTenant,
} from "./borrador-registro";

const DATOS: BorradorTenant = {
  nombreFantasia: "Despachos Rápidos SpA",
  razonSocial: "Despachos Rápidos Sociedad por Acciones",
  rut: "76543210-3",
  nombreDueno: "María Pérez",
  emailDueno: "dueno@despachosrapidos.cl",
  aceptaTerminos: true,
};

describe("borrador-registro", () => {
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

  it("sin cookie, devuelve null", async () => {
    expect(await leerBorrador()).toBeNull();
  });

  it("la cookie es httpOnly, sameSite=lax y con Max-Age acotado (sobrevive la vuelta de Google)", async () => {
    // No podemos leer las opciones vía el doble simplificado de arriba —
    // exponemos un doble más fino en este único test para afirmar las
    // opciones exactas con las que `set` fue invocado.
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

    const modulo = await import("./borrador-registro");
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
    const cookie = almacen.get(COOKIE_BORRADOR_REGISTRO);
    expect(cookie).toBeDefined();
    // Corrompe la firma (después del último punto).
    const separador = cookie!.value.lastIndexOf(".");
    almacen.set(COOKIE_BORRADOR_REGISTRO, {
      value: `${cookie!.value.slice(0, separador)}.firma-forjada`,
    });

    expect(await leerBorrador()).toBeNull();
  });

  it("cuerpo alterado sin resignar → null (la firma ya no calza con el nuevo cuerpo)", async () => {
    await guardarBorrador(DATOS);
    const cookie = almacen.get(COOKIE_BORRADOR_REGISTRO)!;
    const separador = cookie.value.lastIndexOf(".");
    const cuerpoAlterado = Buffer.from(JSON.stringify({ ...DATOS, nombreFantasia: "Otro Nombre SpA" })).toString(
      "base64url",
    );
    almacen.set(COOKIE_BORRADOR_REGISTRO, {
      value: `${cuerpoAlterado}.${cookie.value.slice(separador + 1)}`,
    });

    expect(await leerBorrador()).toBeNull();
  });

  it("borrador vencido (exp en el pasado) → null aunque la firma sea válida", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await guardarBorrador(DATOS);

    // Avanza más allá de los 30 minutos de vigencia.
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
