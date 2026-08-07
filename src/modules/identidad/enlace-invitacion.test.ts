import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { construirEnlaceInvitacion, resolverUrlBaseApp } from "./enlace-invitacion";

const CLAVES = ["APP_BASE_URL", "NEXT_PUBLIC_APP_URL", "VERCEL_URL"] as const;

describe("construirEnlaceInvitacion", () => {
  it("arma la URL de canje sobre la ruta real de la pantalla", () => {
    expect(construirEnlaceInvitacion("https://app.rutax.cl", "abc123")).toBe(
      "https://app.rutax.cl/invitacion/abc123",
    );
  });

  it("no duplica la barra cuando la base viene con barra final", () => {
    expect(construirEnlaceInvitacion("https://app.rutax.cl/", "abc123")).toBe(
      "https://app.rutax.cl/invitacion/abc123",
    );
  });

  it("sirve para un origen local (el botón de copiar usa window.location.origin)", () => {
    expect(construirEnlaceInvitacion("http://localhost:3000", "t-1")).toBe(
      "http://localhost:3000/invitacion/t-1",
    );
  });
});

describe("resolverUrlBaseApp", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const clave of CLAVES) {
      original[clave] = process.env[clave];
      delete process.env[clave];
    }
  });

  afterEach(() => {
    for (const clave of CLAVES) {
      if (original[clave] === undefined) delete process.env[clave];
      else process.env[clave] = original[clave];
    }
  });

  it("devuelve null si el entorno no declara ninguna URL — mejor no enviar que enviar un enlace muerto", () => {
    expect(resolverUrlBaseApp()).toBeNull();
  });

  it("ignora un valor en blanco (una variable vacía en Vercel no es una URL)", () => {
    process.env.NEXT_PUBLIC_APP_URL = "   ";
    expect(resolverUrlBaseApp()).toBeNull();
  });

  it("prefiere APP_BASE_URL por sobre NEXT_PUBLIC_APP_URL", () => {
    process.env.APP_BASE_URL = "https://explicita.cl";
    process.env.NEXT_PUBLIC_APP_URL = "https://publica.cl";
    expect(resolverUrlBaseApp()).toBe("https://explicita.cl");
  });

  it("cae a VERCEL_URL y le agrega el protocolo que Vercel no incluye", () => {
    process.env.VERCEL_URL = "rutax-nine.vercel.app";
    expect(resolverUrlBaseApp()).toBe("https://rutax-nine.vercel.app");
  });
});
