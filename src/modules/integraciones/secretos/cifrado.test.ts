/**
 * Test de regresión del round-trip de cifrado a través de la columna `bytea`.
 *
 * Por qué existe: el unit test de `cifrado-primitivas` prueba
 * cifrar→descifrar en MEMORIA (buffers), pero NO la ida-y-vuelta real por
 * `supabase-js`/PostgREST. Un bug crítico se coló justo en esa capa: pasar un
 * `Buffer` crudo a `.insert({ valor_cifrado })` hacía que supabase-js lo
 * serializara como JSON ({"type":"Buffer","data":[...]}), guardando TEXTO en
 * la columna bytea → el secreto quedaba irrecuperable (primer byte `{`=0x7b en
 * vez del byte de versión 0x01) y toda conexión ML terminaba `desvinculada`.
 *
 * Este test mockea el cliente de Supabase capturando lo que se inserta y
 * devolviéndolo en la lectura, ejerciendo el round-trip completo.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let valorCifradoGuardado: unknown = null;

vi.mock("@/lib/supabase/service-role", () => ({
  crearClienteServiceRole: () => ({
    schema: () => ({
      from: () => ({
        insert: (payload: Record<string, unknown>) => {
          valorCifradoGuardado = payload.valor_cifrado;
          return {
            select: () => ({
              single: async () => ({
                data: { referencia_externa_id: "ref-test-1" },
                error: null,
              }),
            }),
          };
        },
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                tipo_secreto: "token_oauth_ml_access",
                valor_cifrado: valorCifradoGuardado,
                metadata: { alg: "aes-256-gcm", kid: "v1" },
                vence_en: null,
              },
              error: null,
            }),
          }),
        }),
      }),
    }),
  }),
}));

import { cifrarSecreto, descifrarSecreto } from "./cifrado";

describe("cifrarSecreto/descifrarSecreto — round-trip por bytea (regresión 0x7b)", () => {
  beforeEach(() => {
    valorCifradoGuardado = null;
    // Clave de prueba de 32 bytes (AES-256) en base64.
    process.env.SECRETOS_CLAVE_CIFRADO_B64 = Buffer.alloc(32, 7).toString("base64");
  });

  it("valor_cifrado se persiste como string hex '\\x...', NO como Buffer/objeto", async () => {
    await cifrarSecreto({
      tenantId: "11111111-1111-1111-1111-111111111111",
      tipoSecreto: "token_oauth_ml_access",
      valor: "APP_USR-token-de-prueba-1234567890",
    });

    expect(typeof valorCifradoGuardado).toBe("string");
    const guardado = valorCifradoGuardado as string;
    expect(guardado).toMatch(/^\\x[0-9a-f]+$/);
    // Primer byte del paquete = versión 0x01 — NUNCA 0x7b ('{', señal del bug).
    expect(guardado.slice(2, 4)).toBe("01");
    expect(guardado.slice(2, 4)).not.toBe("7b");
  });

  it("round-trip completo: cifrar → (bytea) → descifrar devuelve el valor original", async () => {
    const original = "APP_USR-token-secreto-roundtrip-9876";
    const { referenciaExternaId } = await cifrarSecreto({
      tenantId: "11111111-1111-1111-1111-111111111111",
      tipoSecreto: "token_oauth_ml_access",
      valor: original,
    });

    const { valor } = await descifrarSecreto(referenciaExternaId);
    expect(valor).toBe(original);
  });
});
