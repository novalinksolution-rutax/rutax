/**
 * Pruebas de `resolverClave`/`KID_ACTIVO` — extraídos de `cifrado.ts` (donde
 * vivían privados) a este módulo propio para que otros consumidores de
 * `cifrado-primitivas.ts` (hoy: el retiro en bodega, etapa 3 de
 * `retiro-y-ruteo-plan.md`) usen la misma clave maestra y el mismo esquema de
 * `kid` sin duplicar la lectura de variables de entorno.
 *
 * Estas pruebas son una réplica intencional de las que ya cubrían
 * `resolverClave` cuando vivía dentro de `cifrado.test.ts` (indirectamente, a
 * través de `cifrarSecreto`/`descifrarSecreto`) — aquí se prueban DIRECTO,
 * sin mockear Supabase, igual que las primitivas de `cifrado-primitivas.ts`.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LONGITUD_CLAVE_BYTES } from "./cifrado-primitivas";
import { KID_ACTIVO, resolverClave } from "./clave-maestra";

// Variables de entorno que tocan estas pruebas — limpiadas antes y después de
// cada una para no depender de (ni contaminar) el orden de ejecución.
const VARIABLES_DE_PRUEBA = [
  "SECRETOS_CLAVE_CIFRADO_B64",
  "SECRETOS_CLAVE_CIFRADO_B64_v2",
] as const;

function limpiarVariables(): void {
  for (const nombre of VARIABLES_DE_PRUEBA) {
    delete process.env[nombre];
  }
}

describe("KID_ACTIVO", () => {
  it('sin SECRETOS_CIFRADO_KID en el entorno, el kid activo por defecto es "v1"', () => {
    // No se setea `SECRETOS_CIFRADO_KID` en ningún setup global del proyecto
    // (vitest.config.ts no declara `setupFiles`) — este es el valor con el
    // que corre hoy toda la plataforma (Fase A: una sola clave activa).
    expect(KID_ACTIVO).toBe("v1");
  });
});

describe("resolverClave", () => {
  beforeEach(limpiarVariables);
  afterEach(limpiarVariables);

  it('kid "v1" lee la variable SIN sufijo (SECRETOS_CLAVE_CIFRADO_B64) y decodifica el buffer exacto', () => {
    const claveOriginal = randomBytes(LONGITUD_CLAVE_BYTES);
    process.env.SECRETOS_CLAVE_CIFRADO_B64 = claveOriginal.toString("base64");

    const clave = resolverClave("v1");

    expect(Buffer.compare(clave, claveOriginal)).toBe(0);
  });

  it('un kid distinto de "v1" (p. ej. "v2", para rotación) lee la variable CON sufijo `_<KID>`', () => {
    const claveV1 = randomBytes(LONGITUD_CLAVE_BYTES);
    const claveV2 = randomBytes(LONGITUD_CLAVE_BYTES);
    process.env.SECRETOS_CLAVE_CIFRADO_B64 = claveV1.toString("base64");
    process.env.SECRETOS_CLAVE_CIFRADO_B64_v2 = claveV2.toString("base64");

    const clave = resolverClave("v2");

    // Debe tomar la variable CON sufijo, no la de "v1" (que también está seteada).
    expect(Buffer.compare(clave, claveV2)).toBe(0);
    expect(Buffer.compare(clave, claveV1)).not.toBe(0);
  });

  it("lanza un error claro (nombra la variable esperada) si no está configurada — nunca revela un valor porque no hay ninguno", () => {
    expect(() => resolverClave("v1")).toThrow(/SECRETOS_CLAVE_CIFRADO_B64/);
    expect(() => resolverClave("v1")).toThrow(/kid="v1"/);

    expect(() => resolverClave("v2")).toThrow(/SECRETOS_CLAVE_CIFRADO_B64_v2/);
  });

  it("lanza un error claro si la clave decodificada no tiene 32 bytes (AES-256)", () => {
    process.env.SECRETOS_CLAVE_CIFRADO_B64 = randomBytes(16).toString("base64"); // corta

    expect(() => resolverClave("v1")).toThrow(/32 bytes/);
  });

  it("el mensaje de error por longitud inválida NUNCA incluye el valor (base64) de la clave", () => {
    const claveCortaB64 = randomBytes(16).toString("base64");
    process.env.SECRETOS_CLAVE_CIFRADO_B64 = claveCortaB64;

    try {
      resolverClave("v1");
      expect.unreachable("debía lanzar por longitud inválida");
    } catch (error) {
      expect((error as Error).message).not.toContain(claveCortaB64);
    }
  });
});
