import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { iniciarLoginConGoogle } from "./iniciar-login-google";

describe("iniciarLoginConGoogle — la sesión vieja se resuelve ANTES del verificador", () => {
  it("espera a getSession y recién después escribe el verificador", async () => {
    const orden: string[] = [];
    const supabase = {
      auth: {
        getSession: vi.fn(async () => {
          orden.push("resolver-sesion-vieja");
          return { data: { session: null }, error: null };
        }),
        signInWithOAuth: vi.fn(async () => {
          orden.push("escribir-verificador");
          return { data: {}, error: null };
        }),
      },
    };

    await iniciarLoginConGoogle(supabase as never, "https://rutax.io/auth/callback");

    // El orden ES el arreglo: al revés, la renovación fallida de la sesión de
    // ayer borra el verificador recién escrito (falla del primer intento del día).
    expect(orden).toEqual(["resolver-sesion-vieja", "escribir-verificador"]);
  });
});

describe("ninguna pantalla inicia el login con Google por fuera de la función", () => {
  it("src/app no llama signInWithOAuth directo", () => {
    const raiz = join(__dirname, "..", "..", "app");
    const culpables: string[] = [];
    const recorrer = (dir: string) => {
      for (const nombre of readdirSync(dir)) {
        const ruta = join(dir, nombre);
        if (statSync(ruta).isDirectory()) recorrer(ruta);
        else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\./.test(nombre)) {
          const codigo = readFileSync(ruta, "utf8")
            .split("\n")
            .filter((l) => !/^\s*(\*|\/\/)/.test(l))
            .join("\n");
          if (/\.signInWithOAuth\(/.test(codigo)) culpables.push(ruta);
        }
      }
    };
    recorrer(raiz);
    expect(culpables, "llamar signInWithOAuth directo reabre la carrera del verificador PKCE").toEqual([]);
  });
});
