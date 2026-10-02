/**
 * Pruebas de la intención de registro (cookie firmada): lo que evidencia qué
 * aviso de términos vio la persona y cuándo.
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
  asegurarIntencion,
  construirIntencionActual,
  COOKIE_INTENCION_REGISTRO,
  guardarIntencion,
  leerIntencion,
  limpiarIntencion,
} from "./intencion-registro";
import { PRIVACIDAD, TERMINOS } from "@/lib/legal/versiones";

const DATOS = { terminosVersion: "v1", privacidadVersion: "v2", aceptadoEn: "2026-10-01T15:00:00.000Z" };

describe("intencion-registro", () => {
  const secretoOriginal = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    almacen.clear();
    process.env.SUPABASE_SERVICE_ROLE_KEY = "secreto-de-prueba-bien-largo-1234567890";
  });
  afterEach(() => {
    vi.useRealTimers();
    if (secretoOriginal === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = secretoOriginal;
  });

  it("guarda y relee la intención tal cual", async () => {
    await guardarIntencion(DATOS);
    expect(await leerIntencion()).toEqual(DATOS);
  });

  it("sin cookie → null", async () => {
    expect(await leerIntencion()).toBeNull();
  });

  it("firma forjada → null", async () => {
    await guardarIntencion(DATOS);
    const c = almacen.get(COOKIE_INTENCION_REGISTRO)!;
    const i = c.value.lastIndexOf(".");
    almacen.set(COOKIE_INTENCION_REGISTRO, { value: `${c.value.slice(0, i)}.firma-forjada` });
    expect(await leerIntencion()).toBeNull();
  });

  it("cuerpo alterado (otra versión) sin resignar → null", async () => {
    await guardarIntencion(DATOS);
    const c = almacen.get(COOKIE_INTENCION_REGISTRO)!;
    const i = c.value.lastIndexOf(".");
    const cuerpo = Buffer.from(JSON.stringify({ ...DATOS, terminosVersion: "v9" })).toString("base64url");
    almacen.set(COOKIE_INTENCION_REGISTRO, { value: `${cuerpo}.${c.value.slice(i + 1)}` });
    expect(await leerIntencion()).toBeNull();
  });

  it("vencida → null aunque la firma sea válida", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    await guardarIntencion(DATOS);
    vi.setSystemTime(new Date("2026-10-01T03:00:00Z"));
    expect(await leerIntencion()).toBeNull();
  });

  it("limpiarIntencion la borra", async () => {
    await guardarIntencion(DATOS);
    await limpiarIntencion();
    expect(await leerIntencion()).toBeNull();
  });

  it("construirIntencionActual toma las versiones de versiones.ts, no del cliente", () => {
    const i = construirIntencionActual(new Date("2026-10-01T12:00:00Z"));
    expect(i).toEqual({
      terminosVersion: TERMINOS.version,
      privacidadVersion: PRIVACIDAD.version,
      aceptadoEn: "2026-10-01T12:00:00.000Z",
    });
  });

  it("asegurarIntencion conserva el PRIMER clic: reenviar no mueve la evidencia", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    const primera = await asegurarIntencion();
    vi.setSystemTime(new Date("2026-10-01T12:20:00Z"));
    const segunda = await asegurarIntencion();
    expect(segunda).toEqual(primera);
    expect(segunda.aceptadoEn).toBe("2026-10-01T12:00:00.000Z");
  });

  it("sin SUPABASE_SERVICE_ROLE_KEY lanza (no se firma con nada)", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(guardarIntencion(DATOS)).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
