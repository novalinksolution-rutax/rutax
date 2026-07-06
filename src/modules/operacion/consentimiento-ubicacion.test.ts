/**
 * Pruebas unitarias del módulo `consentimiento-ubicacion`.
 *
 * Cubre:
 * 1. tieneConsentimientoVigente — sin filas → false.
 * 2. tieneConsentimientoVigente — última fila acepto=true, revocado_en=null → true.
 * 3. tieneConsentimientoVigente — última fila acepto=false → false.
 * 4. tieneConsentimientoVigente — última fila acepto=true, revocado_en SET → false.
 * 5. Gate en actualizarUbicacionConductor: manifiesto en_ruta pero SIN
 *    consentimiento → no-op (null), no llama UPSERT.
 * 6. Gate en actualizarUbicacionConductor: manifiesto en_ruta Y consentimiento
 *    vigente → escribe (UPSERT ejecutado).
 * 7. revocarConsentimientoUbicacion borra la ubicación vigente.
 * 8. registrarConsentimientoUbicacion: escribe en bitácora ANTES del INSERT.
 * 9. registrarConsentimientoUbicacion: acepto=false → acción _rechazado en bitácora.
 */

import { describe, expect, it } from "vitest";
import {
  tieneConsentimientoVigente,
  registrarConsentimientoUbicacion,
  revocarConsentimientoUbicacion,
  VERSION_TEXTO_CONSENTIMIENTO_UBICACION,
} from "./consentimiento-ubicacion";
import { actualizarUbicacionConductor } from "./ubicacion-conductor";

// =============================================================================
// Fixtures
// =============================================================================

const TENANT_A = "aaaa0000-0000-0000-0000-000000000001";
const CONDUCTOR_1 = "dddd0000-0000-0000-0000-000000000010";
const USUARIO_ID = "uuuu0000-0000-0000-0000-000000000001";
const HOY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

// =============================================================================
// Helpers de construcción de mocks
// =============================================================================

/**
 * Construye el mock mínimo del cliente Supabase para pruebas de
 * tieneConsentimientoVigente. Permite configurar el resultado de
 * la query a `consentimientos_ubicacion`.
 */
function clienteConsentimientoMock(filaResult: {
  data: { id: string; acepto: boolean; revocado_en: string | null } | null;
  error: null | { message: string };
}) {
  return {
    from: (tabla: string) => {
      if (tabla === "consentimientos_ubicacion") {
        return {
          select: (_cols: string) => ({
            eq: (_c: string, _v: unknown) => ({
              eq: (_c2: string, _v2: unknown) => ({
                order: (_col: string, _opts: unknown) => ({
                  limit: (_n: number) => ({
                    maybeSingle: async () => filaResult,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    },
  } as unknown as Parameters<typeof tieneConsentimientoVigente>[0];
}

/**
 * Construye un mock del cliente que responde a:
 * - manifiestos (SELECT id — para la pre-condición de actualizarUbicacionConductor)
 * - consentimientos_ubicacion (SELECT id,acepto,revocado_en)
 * - ubicacion_conductor (UPSERT — cuenta cuántas veces se llama)
 *
 * Retorna el cliente y un contador de llamadas al UPSERT.
 */
function clienteGateMock(opts: {
  manifiestoActivo: boolean;
  consentimientoVigente: boolean;
}) {
  let upsertLlamado = 0;

  const cliente = {
    from: (tabla: string) => {
      if (tabla === "manifiestos") {
        const filaManifiesto = opts.manifiestoActivo
          ? { id: "man-1", conductor_id: CONDUCTOR_1, tenant_id: TENANT_A, estado: "en_ruta", fecha_operacion: HOY }
          : null;
        return {
          select: (_cols: string) => buildEqChain({ data: filaManifiesto, error: null }),
        };
      }

      if (tabla === "consentimientos_ubicacion") {
        const filaConsentimiento = opts.consentimientoVigente
          ? { id: "con-1", acepto: true, revocado_en: null }
          : null;
        return {
          select: (_cols: string) => buildEqChain({ data: filaConsentimiento, error: null }),
        };
      }

      if (tabla === "ubicacion_conductor") {
        return {
          upsert: (_payload: unknown, _opts: unknown) => {
            upsertLlamado++;
            return {
              select: () => ({
                single: async () => ({
                  data: {
                    conductor_id: CONDUCTOR_1,
                    tenant_id: TENANT_A,
                    lat: -33.4,
                    long: -70.6,
                    precision_m: 5,
                    actualizado_en: new Date().toISOString(),
                  },
                  error: null,
                }),
              }),
            };
          },
        };
      }

      return {};
    },
  } as unknown as Parameters<typeof actualizarUbicacionConductor>[0];

  return { cliente, getUpsertLlamado: () => upsertLlamado };
}

/**
 * Construye una cadena de métodos eq+eq+... con maybeSingle o single al final.
 * Soporta hasta 4 niveles de .eq() encadenados.
 */
function buildEqChain(
  resultado: { data: unknown; error: null | { message: string } },
) {
  function chain(): Record<string, unknown> {
    return {
      eq: (_c: string, _v: unknown) => chain(),
      is: (_c: string, _v: unknown) => chain(),
      order: (_c: string, _o: unknown) => chain(),
      limit: (_n: number) => chain(),
      update: (_payload: unknown) => chain(),
      maybeSingle: async () => resultado,
      single: async () => resultado,
    };
  }
  return chain();
}

// =============================================================================
// 1-4. tieneConsentimientoVigente
// =============================================================================

describe("tieneConsentimientoVigente", () => {
  it("1. sin filas → false", async () => {
    const cliente = clienteConsentimientoMock({ data: null, error: null });
    const resultado = await tieneConsentimientoVigente(cliente, TENANT_A, CONDUCTOR_1);
    expect(resultado).toBe(false);
  });

  it("2. última fila acepto=true, revocado_en=null → true", async () => {
    const cliente = clienteConsentimientoMock({
      data: { id: "con-1", acepto: true, revocado_en: null },
      error: null,
    });
    const resultado = await tieneConsentimientoVigente(cliente, TENANT_A, CONDUCTOR_1);
    expect(resultado).toBe(true);
  });

  it("3. última fila acepto=false → false", async () => {
    const cliente = clienteConsentimientoMock({
      data: { id: "con-2", acepto: false, revocado_en: null },
      error: null,
    });
    const resultado = await tieneConsentimientoVigente(cliente, TENANT_A, CONDUCTOR_1);
    expect(resultado).toBe(false);
  });

  it("4. última fila acepto=true pero revocado_en SET → false", async () => {
    const cliente = clienteConsentimientoMock({
      data: { id: "con-3", acepto: true, revocado_en: new Date().toISOString() },
      error: null,
    });
    const resultado = await tieneConsentimientoVigente(cliente, TENANT_A, CONDUCTOR_1);
    expect(resultado).toBe(false);
  });
});

// =============================================================================
// 5-6. Gate en actualizarUbicacionConductor
// =============================================================================

describe("actualizarUbicacionConductor — gate de consentimiento", () => {
  it("5. manifiesto en_ruta pero SIN consentimiento vigente → no-op (null, sin UPSERT)", async () => {
    const { cliente, getUpsertLlamado } = clienteGateMock({
      manifiestoActivo: true,
      consentimientoVigente: false,
    });

    const resultado = await actualizarUbicacionConductor(
      cliente,
      CONDUCTOR_1,
      TENANT_A,
      { lat: -33.4, long: -70.6, precisionM: 5 },
    );

    expect(resultado).toBeNull();
    expect(getUpsertLlamado()).toBe(0);
  });

  it("6. manifiesto en_ruta Y consentimiento vigente → escribe (UPSERT ejecutado)", async () => {
    const { cliente, getUpsertLlamado } = clienteGateMock({
      manifiestoActivo: true,
      consentimientoVigente: true,
    });

    const resultado = await actualizarUbicacionConductor(
      cliente,
      CONDUCTOR_1,
      TENANT_A,
      { lat: -33.4, long: -70.6, precisionM: 5 },
    );

    expect(resultado).not.toBeNull();
    expect(resultado?.conductorId).toBe(CONDUCTOR_1);
    expect(getUpsertLlamado()).toBe(1);
  });
});

// =============================================================================
// 7. revocarConsentimientoUbicacion — borra la ubicación
// =============================================================================

describe("revocarConsentimientoUbicacion", () => {
  it("7. revoca el consentimiento vigente y borra la ubicación del conductor", async () => {
    const bitacoraLlamadas: Array<Record<string, unknown>> = [];
    let updateLlamado = false;
    let deleteLlamado = false;

    const cliente = {
      from: (tabla: string) => {
        if (tabla === "bitacora_auditoria") {
          return {
            insert: (payload: Record<string, unknown>) => {
              bitacoraLlamadas.push(payload);
              return { error: null };
            },
          };
        }

        if (tabla === "consentimientos_ubicacion") {
          return {
            select: (_cols: string) => ({
              eq: (_c: string, _v: unknown) => ({
                eq: (_c2: string, _v2: unknown) => ({
                  eq: (_c3: string, _v3: unknown) => ({
                    is: (_c4: string, _v4: unknown) => ({
                      order: (_col: string, _opts: unknown) => ({
                        limit: (_n: number) => ({
                          maybeSingle: async () => ({
                            data: { id: "con-1" },
                            error: null,
                          }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
            update: (_payload: unknown) => ({
              eq: (_c: string, _v: unknown) => ({
                eq: (_c2: string, _v2: unknown) => {
                  updateLlamado = true;
                  return { error: null };
                },
              }),
            }),
          };
        }

        if (tabla === "ubicacion_conductor") {
          return {
            delete: () => ({
              eq: (_c: string, _v: unknown) => ({
                eq: (_c2: string, _v2: unknown) => {
                  deleteLlamado = true;
                  return { error: null };
                },
              }),
            }),
          };
        }

        return {};
      },
    } as unknown as Parameters<typeof revocarConsentimientoUbicacion>[0];

    await revocarConsentimientoUbicacion(cliente, {
      tenantId: TENANT_A,
      conductorId: CONDUCTOR_1,
      actorUsuarioId: USUARIO_ID,
    });

    // Bitácora registrada (siempre la primera)
    expect(bitacoraLlamadas.length).toBeGreaterThanOrEqual(1);
    expect(bitacoraLlamadas[0].accion).toBe("conductor.ubicacion.consentimiento_revocado");

    // El consentimiento fue marcado como revocado
    expect(updateLlamado).toBe(true);

    // La ubicación fue borrada (minimización inmediata)
    expect(deleteLlamado).toBe(true);
  });
});

// =============================================================================
// 8-9. registrarConsentimientoUbicacion — bitácora antes del INSERT
// =============================================================================

describe("registrarConsentimientoUbicacion", () => {
  function clienteRegistroMock() {
    const bitacoraLlamadas: Array<Record<string, unknown>> = [];
    const insertLlamadas: Array<Record<string, unknown>> = [];

    const cliente = {
      from: (tabla: string) => {
        if (tabla === "bitacora_auditoria") {
          return {
            insert: (payload: Record<string, unknown>) => {
              bitacoraLlamadas.push(payload);
              return { error: null };
            },
          };
        }

        if (tabla === "consentimientos_ubicacion") {
          return {
            insert: (payload: Record<string, unknown>) => {
              insertLlamadas.push(payload);
              return { error: null };
            },
          };
        }

        return {};
      },
    } as unknown as Parameters<typeof registrarConsentimientoUbicacion>[0];

    return { cliente, bitacoraLlamadas, insertLlamadas };
  }

  it("8. acepto=true: bitácora con acción _otorgado ANTES del INSERT en tabla", async () => {
    const orden: string[] = [];
    const bitacoraLlamadas: Array<Record<string, unknown>> = [];
    const insertLlamadas: Array<Record<string, unknown>> = [];

    const cliente = {
      from: (tabla: string) => {
        if (tabla === "bitacora_auditoria") {
          return {
            insert: (payload: Record<string, unknown>) => {
              orden.push("bitacora");
              bitacoraLlamadas.push(payload);
              return { error: null };
            },
          };
        }

        if (tabla === "consentimientos_ubicacion") {
          return {
            insert: (payload: Record<string, unknown>) => {
              orden.push("insert_consentimiento");
              insertLlamadas.push(payload);
              return { error: null };
            },
          };
        }

        return {};
      },
    } as unknown as Parameters<typeof registrarConsentimientoUbicacion>[0];

    await registrarConsentimientoUbicacion(cliente, {
      tenantId: TENANT_A,
      conductorId: CONDUCTOR_1,
      actorUsuarioId: USUARIO_ID,
      acepto: true,
      versionTexto: VERSION_TEXTO_CONSENTIMIENTO_UBICACION,
    });

    // Bitácora va ANTES del INSERT
    expect(orden[0]).toBe("bitacora");
    expect(orden[1]).toBe("insert_consentimiento");

    // Acción correcta en bitácora
    expect(bitacoraLlamadas[0].accion).toBe("conductor.ubicacion.consentimiento_otorgado");

    // El INSERT contiene los datos correctos
    expect(insertLlamadas[0].acepto).toBe(true);
    expect(insertLlamadas[0].tenant_id).toBe(TENANT_A);
    expect(insertLlamadas[0].conductor_id).toBe(CONDUCTOR_1);
    expect(insertLlamadas[0].version_texto).toBe(VERSION_TEXTO_CONSENTIMIENTO_UBICACION);
  });

  it("9. acepto=false → acción _rechazado en bitácora y acepto=false en tabla", async () => {
    const { cliente, bitacoraLlamadas, insertLlamadas } = clienteRegistroMock();

    await registrarConsentimientoUbicacion(cliente, {
      tenantId: TENANT_A,
      conductorId: CONDUCTOR_1,
      actorUsuarioId: USUARIO_ID,
      acepto: false,
      versionTexto: VERSION_TEXTO_CONSENTIMIENTO_UBICACION,
    });

    expect(bitacoraLlamadas[0].accion).toBe("conductor.ubicacion.consentimiento_rechazado");
    expect(insertLlamadas[0].acepto).toBe(false);
  });
});
