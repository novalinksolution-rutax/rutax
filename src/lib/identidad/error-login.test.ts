/**
 * Brecha #7: el login presentaba TODA causa de fallo como error de tipeo.
 *
 * Estas pruebas fijan las dos mitades del problema: que las causas se
 * distingan, y que distinguirlas **no** convierta la pantalla en un oráculo de
 * cuentas (regla 45).
 */

import { describe, expect, it } from "vitest";

import { traducirErrorLogin } from "./error-login";

describe("traducirErrorLogin · las causas se distinguen", () => {
  it("bloqueo por intentos: no invita a reintentar, que es lo que lo alarga", () => {
    const r = traducirErrorLogin({ status: 429, code: null, message: null });
    expect(r.mensaje).toMatch(/demasiados intentos/i);
    expect(r.reintentarNoAyuda).toBe(true);
  });

  it("cuenta suspendida: dice que NO es la contraseña y a quién acudir", () => {
    // El caso que motiva la brecha: alguien suspendido probaba diez claves,
    // usaba «olvidé mi contraseña» y seguía sin entrar.
    const r = traducirErrorLogin({ code: "user_banned", status: 400, message: null });
    expect(r.mensaje).toMatch(/suspendida/i);
    expect(r.mensaje).toMatch(/no es un problema de contraseña/i);
    expect(r.reintentarNoAyuda).toBe(true);
  });

  it("cuenta sin activar: manda al correo de activación, no al teclado", () => {
    const r = traducirErrorLogin({ code: "email_not_confirmed", status: 400, message: null });
    expect(r.mensaje).toMatch(/activada/i);
    expect(r.reintentarNoAyuda).toBe(true);
  });

  it("servicio caído: dice explícitamente que no es la contraseña", () => {
    // Si no lo dice, quien tiene la clave correcta la cambia. Y ahí sí la
    // tiene mal.
    const r = traducirErrorLogin({ status: 503, code: null, message: null });
    expect(r.mensaje).toMatch(/no es tu contraseña/i);
  });

  it("sin red: lo mismo, y sin culpar a la contraseña", () => {
    const r = traducirErrorLogin(null, true);
    expect(r.mensaje).toMatch(/conexión/i);
    expect(r.mensaje).toMatch(/no tiene nada que ver/i);
  });
});

describe("traducirErrorLogin · regla 45, no confirma ni niega", () => {
  it("la credencial equivocada tiene UN solo mensaje", () => {
    // Da igual si el correo existe o no: probando correos no se puede averiguar
    // cuáles están registrados.
    const inexistente = traducirErrorLogin({
      code: "invalid_credentials",
      status: 400,
      message: "Invalid login credentials",
    });
    const claveMala = traducirErrorLogin({
      code: "invalid_credentials",
      status: 400,
      message: "Invalid login credentials",
    });
    expect(inexistente.mensaje).toBe(claveMala.mensaje);
    expect(inexistente.mensaje).not.toMatch(/no existe|no está registrad|no encontrad/i);
  });

  it("un error desconocido cae en credencial inválida, no en un detalle técnico", () => {
    // Nunca se muestra el mensaje crudo del proveedor: «AuthApiError: ...» no
    // le dice nada a nadie y sí dice de más.
    const r = traducirErrorLogin({
      code: "algo_que_no_conocemos",
      status: 418,
      message: "AuthApiError: teapot",
    });
    expect(r.mensaje).not.toMatch(/AuthApiError|teapot/i);
    expect(r.mensaje).toMatch(/no coinciden/i);
  });

  it("sin error tampoco inventa una causa", () => {
    expect(traducirErrorLogin(null).mensaje).toMatch(/no coinciden/i);
  });
});
