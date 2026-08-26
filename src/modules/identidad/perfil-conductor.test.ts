import { describe, expect, it, vi } from "vitest";

import {
  enmascararNumeroCuenta,
  guardarMiPerfilConductor,
  leerMiPerfilConductor,
} from "./perfil-conductor";

const TENANT = "11111111-1111-1111-1111-111111111111";
const CONDUCTOR = "22222222-2222-2222-2222-222222222222";
const USUARIO = "33333333-3333-3333-3333-333333333333";

// ---------------------------------------------------------------------------
// Doble del cliente: registra a qué tabla se escribió y con qué
// ---------------------------------------------------------------------------

interface Escritura {
  tabla: string;
  valores: Record<string, unknown>;
  filtros: Array<[string, unknown]>;
}

function clienteDoble(opts: {
  fila?: Record<string, unknown> | null;
  errorPorTabla?: Record<string, string>;
} = {}) {
  const escrituras: Escritura[] = [];

  const cliente = {
    schema() {
      return {
        from(tabla: string) {
          const filtros: Array<[string, unknown]> = [];
          const constructor = {
            select() {
              return constructor;
            },
            update(valores: Record<string, unknown>) {
              escrituras.push({ tabla, valores, filtros });
              return constructor;
            },
            eq(col: string, val: unknown) {
              filtros.push([col, val]);
              const err = opts.errorPorTabla?.[tabla];
              // El await de un update cae acá: la cadena termina en `.eq()`.
              return Object.assign(
                Promise.resolve({ error: err ? { message: err } : null }),
                constructor,
              );
            },
            maybeSingle() {
              const err = opts.errorPorTabla?.[tabla];
              return Promise.resolve(
                err
                  ? { data: null, error: { message: err } }
                  : { data: opts.fila ?? null, error: null },
              );
            },
          };
          return constructor;
        },
      };
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { cliente: cliente as any, escrituras };
}

const FILA_COMPLETA = {
  nombre_completo: "Juan Pablo Pérez Rojas",
  telefono: "56912345678",
  rut: "12345678-5",
  tipo_relacion: "honorarios",
  estado: "activo",
  creado_en: "2026-01-15T12:00:00.000Z",
  banco: "Banco de Chile",
  tipo_cuenta: "corriente",
  numero_cuenta: "00123456789",
};

// ===========================================================================

describe("enmascararNumeroCuenta", () => {
  it("deja a la vista solo los últimos cuatro", () => {
    expect(enmascararNumeroCuenta("00123456789")).toBe("••••6789");
  });

  it("ignora separadores antes de contar", () => {
    expect(enmascararNumeroCuenta("001-2345-6789")).toBe("••••6789");
  });

  /**
   * 🔴 La contraprueba que importa. «Revelar los últimos cuatro» de una cuenta
   * de cuatro o cinco dígitos es revelar la cuenta entera — la regla de
   * enmascarado se vuelve un adorno justo en el caso donde más protege.
   */
  it("una cuenta corta se enmascara ENTERA, no casi entera", () => {
    expect(enmascararNumeroCuenta("1234")).toBe("••••");
    expect(enmascararNumeroCuenta("123")).toBe("•••");
    expect(enmascararNumeroCuenta("12345")).toBe("••••2345");
  });
});

describe("leerMiPerfilConductor", () => {
  it("nunca devuelve el número de cuenta completo", async () => {
    const { cliente } = clienteDoble({ fila: FILA_COMPLETA });
    const perfil = await leerMiPerfilConductor(cliente, {
      tenantId: TENANT,
      conductorId: CONDUCTOR,
    });

    expect(perfil?.cuentaDePago?.numeroEnmascarado).toBe("••••6789");
    // Contraprueba: el número crudo no aparece en NINGUNA parte de la respuesta.
    expect(JSON.stringify(perfil)).not.toContain("00123456789");
  });

  it("los datos bancarios son los tres o ninguno", async () => {
    // Media cuenta sugeriría que el pago está configurado cuando va a fallar.
    const { cliente } = clienteDoble({
      fila: { ...FILA_COMPLETA, numero_cuenta: null },
    });
    const perfil = await leerMiPerfilConductor(cliente, {
      tenantId: TENANT,
      conductorId: CONDUCTOR,
    });
    expect(perfil?.cuentaDePago).toBeNull();
    // El resto del perfil sí sale: no tener cuenta no te deja sin pantalla.
    expect(perfil?.nombre).toBe("Juan Pablo Pérez Rojas");
  });

  it("devuelve null si el conductor no existe en ese tenant", async () => {
    const { cliente } = clienteDoble({ fila: null });
    await expect(
      leerMiPerfilConductor(cliente, { tenantId: TENANT, conductorId: CONDUCTOR }),
    ).resolves.toBeNull();
  });
});

describe("guardarMiPerfilConductor", () => {
  /**
   * 🔴 La razón de ser de este módulo: el conductor tiene DOS nombres
   * (`conductores.nombre_completo` y `usuarios_perfil.nombre_completo`) y en los
   * datos reales estaban divergiendo. Guardar escribe los dos.
   */
  it("escribe el nombre en las DOS tablas", async () => {
    const { cliente, escrituras } = clienteDoble();
    const r = await guardarMiPerfilConductor(cliente, {
      tenantId: TENANT,
      conductorId: CONDUCTOR,
      usuarioId: USUARIO,
      nombre: "Juan  Pablo   Pérez",
      telefono: "9 1234 5678",
    });

    expect(r.ok).toBe(true);
    expect(escrituras.map((e) => e.tabla)).toEqual(["conductores", "usuarios_perfil"]);
    // Y con el nombre normalizado —espacios colapsados— en las dos, no en una.
    expect(escrituras[0].valores.nombre_completo).toBe("Juan Pablo Pérez");
    expect(escrituras[1].valores.nombre_completo).toBe("Juan Pablo Pérez");
  });

  it("normaliza el teléfono al formato que exige la base, SIN el «+»", async () => {
    // ⚠️ El CHECK de la columna es `^[1-9][0-9]{7,14}$`: dígitos y nada más.
    // Guardarlo con «+» —que es como se escribe E.164 en prosa— revienta la
    // escritura con 23514, y el mensaje de Postgres no menciona el signo.
    const { cliente, escrituras } = clienteDoble();
    await guardarMiPerfilConductor(cliente, {
      tenantId: TENANT,
      conductorId: CONDUCTOR,
      usuarioId: USUARIO,
      nombre: "Ana Soto",
      telefono: "9 1234 5678",
    });
    expect(escrituras[0].valores.telefono).toBe("56912345678");
    expect(escrituras[0].valores.telefono).not.toContain("+");
  });

  it("un teléfono vacío lo BORRA: no es un error", async () => {
    const { cliente, escrituras } = clienteDoble();
    const r = await guardarMiPerfilConductor(cliente, {
      tenantId: TENANT,
      conductorId: CONDUCTOR,
      usuarioId: USUARIO,
      nombre: "Ana Soto",
      telefono: "   ",
    });
    expect(r.ok).toBe(true);
    expect(escrituras[0].valores.telefono).toBeNull();
  });

  it("rechaza un teléfono con forma de teléfono pero mal", async () => {
    const { cliente, escrituras } = clienteDoble();
    const r = await guardarMiPerfilConductor(cliente, {
      tenantId: TENANT,
      conductorId: CONDUCTOR,
      usuarioId: USUARIO,
      nombre: "Ana Soto",
      telefono: "912",
    });
    expect(r.ok).toBe(false);
    // Y no escribe NADA: un guardado a medias dejaría el nombre cambiado con un
    // mensaje de error en pantalla.
    expect(escrituras).toHaveLength(0);
  });

  it("rechaza un nombre vacío", async () => {
    const { cliente, escrituras } = clienteDoble();
    const r = await guardarMiPerfilConductor(cliente, {
      tenantId: TENANT,
      conductorId: CONDUCTOR,
      usuarioId: USUARIO,
      nombre: " ",
      telefono: "",
    });
    expect(r.ok).toBe(false);
    expect(escrituras).toHaveLength(0);
  });

  /** El tenant no es decorativo: acá se corre con `service_role`, sin RLS detrás. */
  it("filtra SIEMPRE por tenant, en las dos escrituras", async () => {
    const { cliente, escrituras } = clienteDoble();
    await guardarMiPerfilConductor(cliente, {
      tenantId: TENANT,
      conductorId: CONDUCTOR,
      usuarioId: USUARIO,
      nombre: "Ana Soto",
      telefono: "",
    });
    for (const e of escrituras) {
      expect(e.filtros).toContainEqual(["tenant_id", TENANT]);
    }
  });

  it("si falla el espejo en usuarios_perfil, el guardado sigue siendo ok", async () => {
    // Lo que el courier ve —manifiesto, liquidación, Torre— sale de
    // `conductores` y ya quedó corregido. Devolver error mandaría al conductor
    // a reintentar algo que en la práctica funcionó.
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente } = clienteDoble({ errorPorTabla: { usuarios_perfil: "boom" } });
    const r = await guardarMiPerfilConductor(cliente, {
      tenantId: TENANT,
      conductorId: CONDUCTOR,
      usuarioId: USUARIO,
      nombre: "Ana Soto",
      telefono: "",
    });
    expect(r.ok).toBe(true);
    expect(espia).toHaveBeenCalled();
    espia.mockRestore();
  });

  it("si falla la escritura de conductores, SÍ devuelve error", async () => {
    const { cliente } = clienteDoble({ errorPorTabla: { conductores: "boom" } });
    const r = await guardarMiPerfilConductor(cliente, {
      tenantId: TENANT,
      conductorId: CONDUCTOR,
      usuarioId: USUARIO,
      nombre: "Ana Soto",
      telefono: "",
    });
    expect(r.ok).toBe(false);
  });
});
