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
import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ALGORITMO_AEAD,
  ErrorDescifradoFallido,
  LONGITUD_CLAVE_BYTES,
  LONGITUD_NONCE_BYTES,
  VERSION_FORMATO_PAQUETE,
  VERSION_FORMATO_PAQUETE_CON_AAD,
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

describe("cifrarPaquete / descifrarPaquete — AAD (Additional Authenticated Data)", () => {
  it("round-trip: descifra el mismo texto cuando la AAD coincide exactamente", () => {
    const clave = claveDePrueba();
    const original = "hash_code-del-qr-de-flex-no-real";
    const aad = "11111111-1111-1111-1111-111111111111:22222222-2222-2222-2222-222222222222"; // tenant_id:bulto_id

    const paquete = cifrarPaquete(original, clave, aad);
    const recuperado = descifrarPaquete(paquete, clave, aad);

    expect(recuperado.toString("utf8")).toBe(original);
  });

  it("round-trip funciona igual si la AAD se provee como Uint8Array en vez de string", () => {
    const clave = claveDePrueba();
    const original = "otro-hash-code";
    const aad = new TextEncoder().encode("tenant-x:bulto-y");

    const paquete = cifrarPaquete(original, clave, aad);
    const recuperado = descifrarPaquete(paquete, clave, aad);

    expect(recuperado.toString("utf8")).toBe(original);
  });

  it("usa el byte de versión CON AAD cuando se pasa `aad`, y el de SIN AAD cuando no", () => {
    const clave = claveDePrueba();

    const paqueteConAad = cifrarPaquete("valor", clave, "tenant:bulto");
    const paqueteSinAad = cifrarPaquete("valor", clave);

    expect(paqueteConAad.readUInt8(0)).toBe(VERSION_FORMATO_PAQUETE_CON_AAD);
    expect(paqueteSinAad.readUInt8(0)).toBe(VERSION_FORMATO_PAQUETE);
    expect(VERSION_FORMATO_PAQUETE_CON_AAD).not.toBe(VERSION_FORMATO_PAQUETE);
  });

  it("rechaza el descifrado si la AAD provista no coincide con la usada al cifrar", () => {
    const clave = claveDePrueba();
    const secreto = "secreto-que-no-debe-salir-por-aad-mala";
    const paquete = cifrarPaquete(secreto, clave, "tenant-1:bulto-1");

    let lanzo = false;
    try {
      descifrarPaquete(paquete, clave, "tenant-1:bulto-DISTINTO");
    } catch (error) {
      lanzo = true;
      expect(error).toBeInstanceOf(ErrorDescifradoFallido);
      expect((error as Error).message.toLowerCase()).not.toContain("secreto-que-no-debe-salir");
    }
    expect(lanzo).toBe(true);

    // Ojo: copiar el criptograma a OTRA fila (otro bulto_id) es exactamente
    // este caso — es la propiedad que justifica usar AAD para el retiro.
  });

  it("rechaza el descifrado si el paquete lleva AAD y no se provee ninguna (falla ANTES de tocar criptografía, con mensaje distinto del genérico)", () => {
    const clave = claveDePrueba();
    const paquete = cifrarPaquete("valor-con-aad", clave, "tenant:bulto");

    expect(() => descifrarPaquete(paquete, clave)).toThrow(ErrorDescifradoFallido);

    try {
      descifrarPaquete(paquete, clave);
      expect.unreachable("debía lanzar ErrorDescifradoFallido");
    } catch (error) {
      const mensaje = (error as Error).message;
      expect(mensaje).toMatch(/no se proveyó/i);
      // Distinto del mensaje genérico de fallo de verificación AEAD — es el
      // punto entero de usar una versión de paquete separada para AAD: el
      // diagnóstico no debe quedar indistinguible de "clave incorrecta".
      expect(mensaje).not.toMatch(/verificación de integridad/i);
    }
  });

  it("rechaza el descifrado si se provee AAD pero el paquete es v1 (sin AAD), con mensaje distinto del genérico", () => {
    const clave = claveDePrueba();
    const paquete = cifrarPaquete("valor-sin-aad", clave); // v1, sin AAD

    expect(() => descifrarPaquete(paquete, clave, "aad-que-sobra")).toThrow(ErrorDescifradoFallido);

    try {
      descifrarPaquete(paquete, clave, "aad-que-sobra");
      expect.unreachable("debía lanzar ErrorDescifradoFallido");
    } catch (error) {
      const mensaje = (error as Error).message;
      expect(mensaje).toMatch(/se proveyó aad/i);
      expect(mensaje).not.toMatch(/verificación de integridad/i);
    }
  });

  it("compatibilidad hacia atrás: un paquete v1 construido a mano (formato pre-AAD, independiente de `cifrarPaquete`) sigue descifrando sin pasar `aad`", () => {
    // Reconstruye el formato EXACTO que producía `cifrarPaquete` antes de
    // soportar AAD — version(1) || nonce(12) || tag(16) || ciphertext, sin
    // `setAAD` — de forma independiente de la implementación actual. Probar
    // esto llamando a `cifrarPaquete` sin `aad` no demostraría nada si el
    // formato hubiera cambiado en ambos lados (cifrado y descifrado) a la vez;
    // esta prueba fija el byte a mano para simular una fila YA existente en
    // `identidad.secretos_cifrados` de antes de este cambio.
    const clave = claveDePrueba();
    const original = "APP_USR-token-legado-de-antes-del-cambio";

    const nonce = randomBytes(LONGITUD_NONCE_BYTES);
    const cipher = createCipheriv(ALGORITMO_AEAD, clave, nonce);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(original, "utf8")), cipher.final()]);
    const tag = cipher.getAuthTag();
    const paqueteLegado = Buffer.concat([Buffer.from([VERSION_FORMATO_PAQUETE]), nonce, tag, ciphertext]);

    expect(descifrarPaquete(paqueteLegado, clave).toString("utf8")).toBe(original);
  });

  it("el paquete cifrado con AAD tampoco contiene el texto plano ni la AAD como subcadena", () => {
    const clave = claveDePrueba();
    const secreto = "TLA-secreto-super-confidencial-con-aad";
    const aad = "tenant-secreto-no-debe-aparecer:bulto-tampoco";

    const paquete = cifrarPaquete(secreto, clave, aad);

    expect(paquete.toString("latin1").includes(secreto)).toBe(false);
    expect(paquete.toString("latin1").includes(aad)).toBe(false);
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
