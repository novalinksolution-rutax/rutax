import { describe, expect, it, vi } from "vitest";
import { registrarEnBitacora } from "./auditoria";
import type { SupabaseClient } from "@supabase/supabase-js";

// Crea un cliente falso que captura lo que se pasa al INSERT.
function crearClienteFalso(opcionError?: { message: string }) {
  const inserts: Array<Record<string, unknown>> = [];

  const clienteFalso = {
    from: vi.fn(() => ({
      insert: vi.fn((fila: Record<string, unknown>) => {
        inserts.push(fila);
        return opcionError
          ? Promise.resolve({ error: opcionError })
          : Promise.resolve({ error: null });
      }),
    })),
  } as unknown as SupabaseClient;

  return { clienteFalso, inserts };
}

const entradaBase = {
  tenantId: "t1",
  actorUsuarioId: "u1",
  actorTipo: "usuario" as const,
  accion: "tenant.alta",
  entidadTipo: "tenant",
  entidadId: "t1",
};

describe("registrarEnBitacora — saneo de secretos", () => {
  it("pasa claves no-sensibles sin modificar", async () => {
    const { clienteFalso, inserts } = crearClienteFalso();
    await registrarEnBitacora(clienteFalso, {
      ...entradaBase,
      detalle: { nombre: "Correos del Sur", rut: "76000000-1" },
    });
    expect(inserts[0].detalle).toEqual({ nombre: "Correos del Sur", rut: "76000000-1" });
  });

  it("elimina 'token' y 'access_token' del nivel superior", async () => {
    const { clienteFalso, inserts } = crearClienteFalso();
    await registrarEnBitacora(clienteFalso, {
      ...entradaBase,
      detalle: { usuario: "ana", token: "abc123", access_token: "xyz" },
    });
    expect(inserts[0].detalle).toEqual({ usuario: "ana" });
    expect(inserts[0].detalle).not.toHaveProperty("token");
    expect(inserts[0].detalle).not.toHaveProperty("access_token");
  });

  it("elimina 'password', 'secret', 'secreto', 'certificado', 'valor_cifrado', 'credenciales', 'api_key', 'apikey', 'refresh_token'", async () => {
    const claves = [
      "password",
      "secret",
      "secreto",
      "certificado",
      "valor_cifrado",
      "credenciales",
      "api_key",
      "apikey",
      "refresh_token",
    ];
    for (const clave of claves) {
      const { clienteFalso, inserts } = crearClienteFalso();
      await registrarEnBitacora(clienteFalso, {
        ...entradaBase,
        detalle: { ok: "si", [clave]: "valor-sensible" },
      });
      expect(inserts[0].detalle, `la clave "${clave}" debe ser eliminada`).not.toHaveProperty(clave);
      expect(inserts[0].detalle).toHaveProperty("ok", "si");
    }
  });

  it("la comparación de clave es insensible a mayúsculas (TOKEN, Password…)", async () => {
    const { clienteFalso, inserts } = crearClienteFalso();
    await registrarEnBitacora(clienteFalso, {
      ...entradaBase,
      detalle: { nombre: "X", TOKEN: "t", Password: "p", API_KEY: "k" },
    });
    const d = inserts[0].detalle as Record<string, unknown>;
    expect(d).toEqual({ nombre: "X" });
  });

  it("elimina claves sensibles en objetos anidados", async () => {
    const { clienteFalso, inserts } = crearClienteFalso();
    await registrarEnBitacora(clienteFalso, {
      ...entradaBase,
      detalle: {
        nivel1: {
          ok: "visible",
          secret: "oculto",
          nivel2: { token: "oculto-tb", info: "visible-tb" },
        },
      },
    });
    const d = inserts[0].detalle as Record<string, unknown>;
    const n1 = d.nivel1 as Record<string, unknown>;
    expect(n1).toHaveProperty("ok", "visible");
    expect(n1).not.toHaveProperty("secret");
    const n2 = n1.nivel2 as Record<string, unknown>;
    expect(n2).not.toHaveProperty("token");
    expect(n2).toHaveProperty("info", "visible-tb");
  });

  it("elimina claves sensibles dentro de arrays de objetos", async () => {
    const { clienteFalso, inserts } = crearClienteFalso();
    await registrarEnBitacora(clienteFalso, {
      ...entradaBase,
      detalle: {
        items: [
          { nombre: "A", token: "secreto-a" },
          { nombre: "B", password: "secreto-b" },
        ],
      },
    });
    const items = (inserts[0].detalle as Record<string, unknown[]>).items as Record<string, unknown>[];
    expect(items[0]).toEqual({ nombre: "A" });
    expect(items[1]).toEqual({ nombre: "B" });
  });

  it("pasa primitivos (string, número, null, boolean) sin tocarlos", async () => {
    const { clienteFalso, inserts } = crearClienteFalso();
    await registrarEnBitacora(clienteFalso, {
      ...entradaBase,
      detalle: { texto: "hola", numero: 42, nulo: null, bool: true },
    });
    expect(inserts[0].detalle).toEqual({ texto: "hola", numero: 42, nulo: null, bool: true });
  });

  it("detalle vacío se persiste como objeto vacío, no falla", async () => {
    const { clienteFalso, inserts } = crearClienteFalso();
    await registrarEnBitacora(clienteFalso, { ...entradaBase });
    expect(inserts[0].detalle).toEqual({});
  });

  it("lanza si el INSERT de bitácora falla — la operación de negocio debe enterarse", async () => {
    const { clienteFalso } = crearClienteFalso({ message: "error simulado de BD" });
    await expect(
      registrarEnBitacora(clienteFalso, { ...entradaBase, accion: "tenant.alta" }),
    ).rejects.toThrow("error simulado de BD");
  });
});
