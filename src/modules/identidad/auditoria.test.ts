import { afterEach, describe, expect, it, vi } from "vitest";
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

/**
 * Guarda contra el bug de producción del 2026-08-11: el alta de conductores
 * pasaba aquí el cliente de la SESIÓN del usuario y la BD respondía
 * "permission denied for view bitacora_auditoria" (correctamente: `authenticated`
 * no tiene INSERT sobre la bitácora). El error solo aparecía en runtime y era
 * críptico; peor, invitaba a "arreglarlo" con un GRANT que dejaría al usuario
 * final fabricar entradas de auditoría.
 */
describe("registrarEnBitacora — exige cliente service_role", () => {
  const claveServiceRoleOriginal = process.env.SUPABASE_SERVICE_ROLE_KEY;

  afterEach(() => {
    if (claveServiceRoleOriginal === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = claveServiceRoleOriginal;
    }
  });

  /** Cliente falso que además expone `supabaseKey`, como los reales. */
  function crearClienteConClave(clave: string) {
    const { clienteFalso, inserts } = crearClienteFalso();
    (clienteFalso as unknown as { supabaseKey: string }).supabaseKey = clave;
    return { clienteFalso, inserts };
  }

  it("rechaza (y NO intenta el INSERT) un cliente con la clave anon — la sesión del usuario", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-service-role";
    const { clienteFalso, inserts } = crearClienteConClave("clave-anon");

    await expect(
      registrarEnBitacora(clienteFalso, { ...entradaBase, accion: "conductor.alta" }),
    ).rejects.toThrow(/no es service_role/i);

    // Se corta ANTES de tocar la base: el mensaje es de programación, no un 42501.
    expect(inserts).toHaveLength(0);
  });

  it("el mensaje nombra la acción y NUNCA incluye el valor de una clave", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-service-role";
    const { clienteFalso } = crearClienteConClave("clave-anon");

    const error = await registrarEnBitacora(clienteFalso, {
      ...entradaBase,
      accion: "conductor.alta",
    }).catch((err: Error) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("conductor.alta");
    expect((error as Error).message).not.toContain("clave-anon");
    expect((error as Error).message).not.toContain("clave-service-role");
  });

  it("acepta el cliente cuya clave ES la de service_role", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-service-role";
    const { clienteFalso, inserts } = crearClienteConClave("clave-service-role");

    await registrarEnBitacora(clienteFalso, entradaBase);
    expect(inserts).toHaveLength(1);
  });

  it("no bloquea dobles de prueba sin `supabaseKey` (la barrera real es la BD, no esta heurística)", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-service-role";
    const { clienteFalso, inserts } = crearClienteFalso();

    await registrarEnBitacora(clienteFalso, entradaBase);
    expect(inserts).toHaveLength(1);
  });

  it("no bloquea si el entorno no define SUPABASE_SERVICE_ROLE_KEY (no hay con qué comparar)", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { clienteFalso, inserts } = crearClienteConClave("clave-anon");

    await registrarEnBitacora(clienteFalso, entradaBase);
    expect(inserts).toHaveLength(1);
  });
});
