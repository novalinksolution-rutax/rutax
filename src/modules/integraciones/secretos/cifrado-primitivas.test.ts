/**
 * Pruebas del mecanismo de cifrado/descifrado — la pieza de mayor riesgo de
 * todo el módulo `integraciones` (si falla, expone certificados y tokens).
 *
 * Se prueban las PRIMITIVAS PURAS (`cifrado-primitivas.ts`): no requieren
 * Supabase ni variables de entorno — exactamente el tipo de prueba de
 * resiliencia que importa aquí: ¿el round-trip es correcto? ¿detecta
 * manipulación? ¿rechaza una clave incorrecta sin filtrar nada del contenido?
 *
 * `cifrado.ts` (la capa de persistencia) es un envoltorio delgado sobre estas
 * primitivas — probar las primitivas cubre la garantía criptográfica central
 * sin necesitar una base de datos real.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ErrorDescifradoFallido,
  LONGITUD_CLAVE_BYTES,
  cifrarPaquete,
  descifrarPaquete,
} from "./cifrado-primitivas";
import { CLAVES_PROHIBIDAS_EN_METADATA } from "./tipos";

function claveDePrueba(): Buffer {
  return randomBytes(LONGITUD_CLAVE_BYTES);
}

describe("cifrarPaquete / descifrarPaquete — round trip", () => {
  it("descifra exactamente el mismo texto que se cifró", () => {
    const clave = claveDePrueba();
    const original = "APP_USR-xxxxxxxx-refresh-token-de-prueba-no-real";

    const paquete = cifrarPaquete(original, clave);
    const recuperado = descifrarPaquete(paquete, clave);

    expect(recuperado.toString("utf8")).toBe(original);
  });

  it("descifra exactamente los mismos bytes binarios que se cifraron (p. ej. .pfx)", () => {
    const clave = claveDePrueba();
    const original = randomBytes(2048); // simula contenido binario de un certificado

    const paquete = cifrarPaquete(original, clave);
    const recuperado = descifrarPaquete(paquete, clave);

    expect(Buffer.compare(recuperado, original)).toBe(0);
  });

  it("dos cifrados del mismo valor producen paquetes distintos (nonce aleatorio)", () => {
    const clave = claveDePrueba();
    const original = "mismo-valor";

    const paqueteA = cifrarPaquete(original, clave);
    const paqueteB = cifrarPaquete(original, clave);

    expect(Buffer.compare(paqueteA, paqueteB)).not.toBe(0);

    // Pero ambos deben seguir descifrando al mismo valor original.
    expect(descifrarPaquete(paqueteA, clave).toString("utf8")).toBe(original);
    expect(descifrarPaquete(paqueteB, clave).toString("utf8")).toBe(original);
  });

  it("el paquete cifrado nunca contiene el texto plano como subcadena", () => {
    const clave = claveDePrueba();
    const secreto = "TLA-secreto-super-confidencial-12345";

    const paquete = cifrarPaquete(secreto, clave);

    expect(paquete.toString("latin1").includes(secreto)).toBe(false);
    expect(paquete.toString("base64").includes(secreto)).toBe(false);
    expect(paquete.toString("hex").includes(Buffer.from(secreto).toString("hex"))).toBe(false);
  });
});

describe("descifrarPaquete — resiliencia ante manipulación y caídas", () => {
  it("rechaza el paquete si se altera un solo byte del ciphertext (detección de tamper)", () => {
    const clave = claveDePrueba();
    const paquete = cifrarPaquete("valor-original-intacto", clave);

    const alterado = Buffer.from(paquete);
    const ultimoIndice = alterado.length - 1;
    alterado[ultimoIndice] = (alterado[ultimoIndice]! ^ 0xff) & 0xff; // voltea el último byte

    expect(() => descifrarPaquete(alterado, clave)).toThrow(ErrorDescifradoFallido);
  });

  it("rechaza el paquete si se altera el authentication tag", () => {
    const clave = claveDePrueba();
    const paquete = cifrarPaquete("otro-valor", clave);

    // version(1) + nonce(12) + tag(16) — alteramos un byte dentro del tag.
    const alterado = Buffer.from(paquete);
    alterado[5] = (alterado[5]! ^ 0xff) & 0xff;

    expect(() => descifrarPaquete(alterado, clave)).toThrow(ErrorDescifradoFallido);
  });

  it("rechaza el descifrado con una clave incorrecta sin filtrar nada del contenido", () => {
    const claveCorrecta = claveDePrueba();
    const claveIncorrecta = claveDePrueba();
    const paquete = cifrarPaquete("secreto-que-no-debe-salir", claveCorrecta);

    let lanzo = false;
    try {
      descifrarPaquete(paquete, claveIncorrecta);
    } catch (error) {
      lanzo = true;
      expect(error).toBeInstanceOf(ErrorDescifradoFallido);
      expect((error as Error).message.toLowerCase()).not.toContain("secreto-que-no-debe-salir");
    }
    expect(lanzo).toBe(true);
  });

  it("rechaza un paquete truncado/corrupto en lugar de devolver basura en silencio", () => {
    const clave = claveDePrueba();
    const paquete = cifrarPaquete("valor", clave);

    const truncado = paquete.subarray(0, 5);

    expect(() => descifrarPaquete(truncado, clave)).toThrow(ErrorDescifradoFallido);
  });

  it("rechaza una versión de formato desconocida explícitamente (en vez de intentar parsear a ciegas)", () => {
    const clave = claveDePrueba();
    const paquete = cifrarPaquete("valor", clave);

    const versionFutura = Buffer.from(paquete);
    versionFutura[0] = 99;

    expect(() => descifrarPaquete(versionFutura, clave)).toThrow(ErrorDescifradoFallido);
  });
});

describe("cifrarPaquete / descifrarPaquete — validación de clave", () => {
  it("rechaza claves que no tengan exactamente 32 bytes (AES-256)", () => {
    const claveCorta = randomBytes(16);
    const claveLarga = randomBytes(64);

    expect(() => cifrarPaquete("x", claveCorta)).toThrow(/32 bytes/);
    expect(() => cifrarPaquete("x", claveLarga)).toThrow(/32 bytes/);

    const claveValida = claveDePrueba();
    const paquete = cifrarPaquete("x", claveValida);
    expect(() => descifrarPaquete(paquete, claveCorta)).toThrow(/32 bytes/);
  });
});

describe("contrato de metadata sin secretos (espejo del CHECK de BD)", () => {
  it("la lista de claves prohibidas cubre los nombres comunes de fuga de secretos", () => {
    // Si se amplía el CHECK `secretos_cifrados_metadata_sin_secretos` en la
    // migración, esta prueba debe actualizarse en conjunto — es el contrato
    // espejo que `cifrado.ts#validarMetadataNoSensible` aplica en aplicación.
    const obligatorias = [
      "valor",
      "token",
      "password",
      "secret",
      "access_token",
      "refresh_token",
    ];

    for (const clave of obligatorias) {
      expect(CLAVES_PROHIBIDAS_EN_METADATA).toContain(clave);
    }
  });
});
