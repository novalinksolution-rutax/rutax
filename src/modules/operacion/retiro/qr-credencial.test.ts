/**
 * Pruebas de `guardarCredencialQr`. NO mockea el cifrado (usa las primitivas
 * reales de `integraciones/secretos`) para probar el round-trip real:
 * cifrar → serializar a bytea → descifrar con la MISMA AAD funciona, y con
 * una AAD distinta (otro bulto, otro tenant) el descifrado falla — que es
 * exactamente la garantía por la que existe la AAD.
 *
 * Solo se mockea el cliente Supabase (nunca toca Postgres real).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

import { LONGITUD_CLAVE_BYTES } from "@/modules/integraciones/secretos/cifrado-primitivas";
import { descifrarPaquete, resolverClave } from "@/modules/integraciones/secretos";
import { guardarCredencialQr } from "./qr-credencial";
import type { CredencialQr } from "./parser-codigo";

const TENANT_A = "10000000-0000-0000-0000-000000000001";
const OTRO_TENANT = "10000000-0000-0000-0000-000000000099";
const BULTO_1 = "50000000-0000-0000-0000-000000000001";
const OTRO_BULTO = "50000000-0000-0000-0000-000000000099";

function bufferDesdeInsertPayload(payload: Record<string, unknown>): Buffer {
  const hex = payload.payload_cifrado as string;
  expect(hex.startsWith("\\x")).toBe(true);
  return Buffer.from(hex.slice(2), "hex");
}

/** Doble mínimo: solo entiende `.schema('operacion').from('bultos_retiro_qr').insert(...)`. */
function crearClienteEspia() {
  const insert = vi.fn(async (payload: Record<string, unknown>) => ({ error: null, payload }));
  const from = vi.fn((tabla: string) => {
    if (tabla !== "bultos_retiro_qr") throw new Error(`Tabla no esperada en el doble: ${tabla}`);
    return {
      insert: (payload: Record<string, unknown>) => {
        insert(payload);
        return Promise.resolve({ error: null });
      },
    };
  });
  const cliente = {
    schema: (esquema: string) => {
      if (esquema !== "operacion") throw new Error(`Esquema no esperado: ${esquema}`);
      return { from };
    },
  };
  return { cliente: cliente as never, from, insert };
}

describe("guardarCredencialQr", () => {
  beforeEach(() => {
    process.env.SECRETOS_CLAVE_CIFRADO_B64 = randomBytes(LONGITUD_CLAVE_BYTES).toString("base64");
  });
  afterEach(() => {
    delete process.env.SECRETOS_CLAVE_CIFRADO_B64;
  });

  it("no-op cuando credencial es null (rutax_interno: Rutax siempre puede regenerar la etiqueta)", async () => {
    const { cliente, from } = crearClienteEspia();

    await guardarCredencialQr(cliente, { tenantId: TENANT_A, bultoId: BULTO_1, credencial: null });

    expect(from).not.toHaveBeenCalled();
  });

  it("flex_hash: cifra {hashCode, securityDigit} — NUNCA el id/sender_id (ya viven en pedidos)", async () => {
    const { cliente, insert } = crearClienteEspia();
    const credencial: CredencialQr = {
      tipoPayload: "flex_hash",
      hashCode: "fwH77GO2qbT3SrRS/UKb14MN2s5JA3AhWG4Pen/l6WY=",
      securityDigit: "0",
    };

    await guardarCredencialQr(cliente, { tenantId: TENANT_A, bultoId: BULTO_1, credencial });

    expect(insert).toHaveBeenCalledTimes(1);
    const payload = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.bulto_id).toBe(BULTO_1);
    expect(payload.tenant_id).toBe(TENANT_A);
    expect(payload.tipo_payload).toBe("flex_hash");
    expect(payload.kid).toBe("v1");
    expect(payload.aad_esquema).toBe("v1");

    // Round-trip real, con la MISMA AAD que el módulo debe haber usado.
    const clave = resolverClave("v1");
    const paquete = bufferDesdeInsertPayload(payload);
    const plano = descifrarPaquete(paquete, clave, `${TENANT_A}:${BULTO_1}`);
    expect(JSON.parse(plano.toString("utf8"))).toEqual({
      hashCode: credencial.hashCode,
      securityDigit: credencial.securityDigit,
    });

    // El payload cifrado NUNCA debe contener el hash_code en claro (verifica
    // que de verdad se cifró y no se guardó tal cual con otro nombre de campo).
    expect(paquete.toString("utf8")).not.toContain(credencial.hashCode);
  });

  it("codigo_crudo: cifra el string completo (desconocido — es la única fuente que queda de él)", async () => {
    const { cliente, insert } = crearClienteEspia();
    const credencial: CredencialQr = { tipoPayload: "codigo_crudo", valor: "un-codigo-que-rutax-no-entiende" };

    await guardarCredencialQr(cliente, { tenantId: TENANT_A, bultoId: BULTO_1, credencial });

    const payload = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.tipo_payload).toBe("codigo_crudo");

    const clave = resolverClave("v1");
    const paquete = bufferDesdeInsertPayload(payload);
    const plano = descifrarPaquete(paquete, clave, `${TENANT_A}:${BULTO_1}`);
    expect(plano.toString("utf8")).toBe(credencial.valor);
  });

  it("AAD = tenant_id + ':' + bulto_id — con el bulto_id equivocado, el descifrado FALLA", async () => {
    const { cliente, insert } = crearClienteEspia();
    const credencial: CredencialQr = { tipoPayload: "codigo_crudo", valor: "algo" };

    await guardarCredencialQr(cliente, { tenantId: TENANT_A, bultoId: BULTO_1, credencial });

    const payload = insert.mock.calls[0][0] as Record<string, unknown>;
    const clave = resolverClave("v1");
    const paquete = bufferDesdeInsertPayload(payload);

    expect(() => descifrarPaquete(paquete, clave, `${TENANT_A}:${OTRO_BULTO}`)).toThrow();
  });

  it("AAD = tenant_id + ':' + bulto_id — con el tenant_id equivocado, el descifrado FALLA", async () => {
    const { cliente, insert } = crearClienteEspia();
    const credencial: CredencialQr = { tipoPayload: "codigo_crudo", valor: "algo" };

    await guardarCredencialQr(cliente, { tenantId: TENANT_A, bultoId: BULTO_1, credencial });

    const payload = insert.mock.calls[0][0] as Record<string, unknown>;
    const clave = resolverClave("v1");
    const paquete = bufferDesdeInsertPayload(payload);

    expect(() => descifrarPaquete(paquete, clave, `${OTRO_TENANT}:${BULTO_1}`)).toThrow();
  });

  it("propaga un error claro si el INSERT falla, sin filtrar el valor cifrado", async () => {
    const cliente = {
      schema: () => ({
        from: () => ({
          insert: async () => ({ error: { message: "boom" } }),
        }),
      }),
    } as never;

    await expect(
      guardarCredencialQr(cliente, {
        tenantId: TENANT_A,
        bultoId: BULTO_1,
        credencial: { tipoPayload: "codigo_crudo", valor: "x" },
      }),
    ).rejects.toThrow(/No se pudo guardar la credencial del QR: boom/);
  });
});
