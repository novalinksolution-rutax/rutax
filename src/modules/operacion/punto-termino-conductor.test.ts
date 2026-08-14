/**
 * Pruebas de la capa de acceso del punto de término del conductor.
 * =============================================================================
 * Lo que se prueba aquí no es "que guarde bien": es que las reglas de privacidad
 * de `docs/seguridad/punto-de-termino-conductor.md` sean mecánicas y no
 * dependan de que el siguiente que llegue lea el documento.
 *
 * 1. `obtenerAnclaFinRuta` devuelve DOS claves y nada más. Es el guardián del
 *    canal 2 (§4.3): lo que no existe en el objeto no se puede serializar por
 *    accidente hacia el navegador del coordinador.
 * 2. Sin consentimiento vigente NO se escribe nada — ni la fila, ni el asiento.
 * 3. El consentimiento se pregunta POR SU FINALIDAD, no en general.
 * 4. La bitácora va ANTES del efecto y **no lleva la coordenada** (§8.8).
 * 5. Redefinir es UPDATE de la misma fila y `definido_en` NO viaja en el
 *    payload — la lección del upsert de PostgREST del 2026-08-13.
 * 6. Se devuelve lo GUARDADO (redondeado por el trigger), no lo pedido.
 * 7. Revocar: bitácora → revocación del consentimiento → DELETE REAL, con
 *    filtro de tenant. Nunca `activa = false`.
 */

import { describe, expect, it } from "vitest";

import {
  ErrorSinConsentimientoPuntoTermino,
  ErrorCoordenadaPuntoTerminoInvalida,
  comunaDeCoordenada,
  definirPuntoTermino,
  obtenerAnclaFinRuta,
  revocarPuntoTermino,
} from "./punto-termino-conductor";

const TENANT_A = "aaaa0000-0000-0000-0000-000000000001";
const CONDUCTOR_1 = "dddd0000-0000-0000-0000-000000000010";
const USUARIO_ID = "uuuu0000-0000-0000-0000-000000000001";

// =============================================================================
// Doble de `service_role`
// =============================================================================

interface EstadoDoble {
  /** Fila existente en punto_termino_conductor, o null. */
  filaExistente: Record<string, unknown> | null;
  /** Consentimiento vigente devuelto por consentimientos_ubicacion. */
  consentimiento: { id: string; acepto: boolean; revocado_en: string | null } | null;
  /** Lo que la BD "devuelve" tras escribir (ya redondeado por el trigger). */
  filaGuardada: Record<string, unknown>;
}

function crearDoble(estado: EstadoDoble) {
  const orden: string[] = [];
  const bitacora: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const filtrosConsentimiento: [string, unknown][] = [];
  const filtrosBorrado: [string, unknown][] = [];
  let borrados = 0;

  /** Cadena de `.eq(...)` que termina en `maybeSingle`. */
  const cadenaLectura = (fila: Record<string, unknown> | null) => {
    const c: Record<string, unknown> = {};
    c.eq = () => c;
    c.maybeSingle = async () => ({ data: fila, error: null });
    return c;
  };

  const tablaPuntoTermino = {
    select: (_cols: string) => cadenaLectura(estado.filaExistente),
    insert: (payload: Record<string, unknown>) => {
      orden.push("insert_punto");
      inserts.push(payload);
      return {
        select: (_cols: string) => ({
          single: async () => ({ data: estado.filaGuardada, error: null }),
        }),
      };
    },
    update: (payload: Record<string, unknown>) => {
      orden.push("update_punto");
      updates.push(payload);
      const c: Record<string, unknown> = {};
      c.eq = () => c;
      c.select = (_cols: string) => ({
        single: async () => ({ data: estado.filaGuardada, error: null }),
      });
      return c;
    },
    delete: () => {
      orden.push("delete_punto");
      const c: Record<string, unknown> = {};
      c.eq = (columna: string, valor: unknown) => {
        filtrosBorrado.push([columna, valor]);
        borrados += 1;
        return { ...c, then: undefined, error: null };
      };
      // El módulo encadena dos `.eq(...)` y hace `await` del resultado.
      c.then = (resolver: (v: unknown) => unknown) => resolver({ error: null });
      return c;
    },
  };

  const cliente = {
    schema: (nombre: string) => {
      if (nombre !== "operacion") throw new Error(`Schema inesperado: ${nombre}`);
      return {
        from: (tabla: string) => {
          if (tabla !== "punto_termino_conductor") {
            throw new Error(`Tabla inesperada en operacion: ${tabla}`);
          }
          return tablaPuntoTermino;
        },
      };
    },
    from: (tabla: string) => {
      if (tabla === "bitacora_auditoria") {
        return {
          insert: (payload: Record<string, unknown>) => {
            orden.push("bitacora");
            bitacora.push(payload);
            return { error: null };
          },
        };
      }
      if (tabla === "consentimientos_ubicacion") {
        const c: Record<string, unknown> = {};
        c.eq = (columna: string, valor: unknown) => {
          filtrosConsentimiento.push([columna, valor]);
          return c;
        };
        c.is = () => c;
        c.order = () => ({
          limit: () => ({ maybeSingle: async () => ({ data: estado.consentimiento, error: null }) }),
        });
        return {
          select: (_cols: string) => {
            orden.push("consentimiento");
            return c;
          },
          update: () => {
            orden.push("update_consentimiento");
            const u: Record<string, unknown> = {};
            u.eq = () => u;
            u.then = (resolver: (v: unknown) => unknown) => resolver({ error: null });
            return u;
          },
        };
      }
      throw new Error(`Tabla inesperada: ${tabla}`);
    },
  };

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cliente: cliente as any,
    orden,
    bitacora,
    inserts,
    updates,
    filtrosConsentimiento,
    filtrosBorrado,
    contarBorrados: () => borrados,
  };
}

const FILA_GUARDADA = {
  lat: -33.457,
  long: -70.123,
  comuna: "Ñuñoa",
  definido_en: "2026-08-14T12:00:00.000Z",
  actualizado_en: "2026-08-14T12:00:00.000Z",
};

const CONSENTIMIENTO_VIGENTE = { id: "c-1", acepto: true, revocado_en: null };

// =============================================================================
// comunaDeCoordenada
// =============================================================================

describe("comunaDeCoordenada", () => {
  it("atribuye la comuna por centroide más cercano dentro de la RM", () => {
    // Centroide de Maipú: -33.5167 / -70.7667.
    expect(comunaDeCoordenada(-33.517, -70.767)).toBe("Maipú");
  });

  it("devuelve null fuera del radio de cobertura, en vez de mentir", () => {
    // Antofagasta. Ningún centroide de la RM está a menos de 20 km.
    expect(comunaDeCoordenada(-23.65, -70.4)).toBeNull();
  });
});

// =============================================================================
// obtenerAnclaFinRuta — el guardián del canal 2
// =============================================================================

describe("obtenerAnclaFinRuta", () => {
  it("devuelve EXACTAMENTE {lat, long} — no hay dónde meter el resto", async () => {
    const doble = crearDoble({
      filaExistente: { lat: -33.5, long: -70.7 },
      consentimiento: CONSENTIMIENTO_VIGENTE,
      filaGuardada: FILA_GUARDADA,
    });

    const ancla = await obtenerAnclaFinRuta(doble.cliente, TENANT_A, CONDUCTOR_1);

    // Si esta aserción falla porque alguien agregó `comuna` o `conductorId`, no
    // la "arregles" ampliando la lista: el punto del tipo mínimo es que el ancla
    // no tenga forma de fila y no invite a pasarla entera hacia arriba.
    expect(Object.keys(ancla ?? {}).sort()).toEqual(["lat", "long"]);
  });

  it("devuelve null si el conductor no definió punto (la ruta termina en la última parada)", async () => {
    const doble = crearDoble({
      filaExistente: null,
      consentimiento: CONSENTIMIENTO_VIGENTE,
      filaGuardada: FILA_GUARDADA,
    });

    expect(await obtenerAnclaFinRuta(doble.cliente, TENANT_A, CONDUCTOR_1)).toBeNull();
  });
});

// =============================================================================
// definirPuntoTermino
// =============================================================================

describe("definirPuntoTermino", () => {
  const entrada = {
    tenantId: TENANT_A,
    conductorId: CONDUCTOR_1,
    actorUsuarioId: USUARIO_ID,
    lat: -33.456789,
    long: -70.123456,
  };

  it("sin consentimiento vigente: lanza y NO escribe absolutamente nada", async () => {
    const doble = crearDoble({
      filaExistente: null,
      consentimiento: null, // nunca lo otorgó
      filaGuardada: FILA_GUARDADA,
    });

    await expect(definirPuntoTermino(doble.cliente, entrada)).rejects.toBeInstanceOf(
      ErrorSinConsentimientoPuntoTermino,
    );

    // Ni la fila ni el asiento: fallar cerrado significa no dejar rastro de un
    // tratamiento que no estaba autorizado.
    expect(doble.inserts).toHaveLength(0);
    expect(doble.bitacora).toHaveLength(0);
  });

  it("con consentimiento revocado tampoco escribe", async () => {
    const doble = crearDoble({
      filaExistente: null,
      consentimiento: { id: "c-2", acepto: true, revocado_en: "2026-08-14T00:00:00.000Z" },
      filaGuardada: FILA_GUARDADA,
    });

    await expect(definirPuntoTermino(doble.cliente, entrada)).rejects.toBeInstanceOf(
      ErrorSinConsentimientoPuntoTermino,
    );
    expect(doble.inserts).toHaveLength(0);
  });

  it("pregunta por la finalidad `punto_termino_ruta`, no por el consentimiento en general", async () => {
    const doble = crearDoble({
      filaExistente: null,
      consentimiento: CONSENTIMIENTO_VIGENTE,
      filaGuardada: FILA_GUARDADA,
    });

    await definirPuntoTermino(doble.cliente, entrada);

    expect(doble.filtrosConsentimiento).toContainEqual(["finalidad", "punto_termino_ruta"]);
  });

  it("bitácora ANTES del efecto, y SIN la coordenada", async () => {
    const doble = crearDoble({
      filaExistente: null,
      consentimiento: CONSENTIMIENTO_VIGENTE,
      filaGuardada: FILA_GUARDADA,
    });

    await definirPuntoTermino(doble.cliente, entrada);

    const posBitacora = doble.orden.indexOf("bitacora");
    const posInsert = doble.orden.indexOf("insert_punto");
    expect(posBitacora).toBeGreaterThanOrEqual(0);
    expect(posBitacora).toBeLessThan(posInsert);

    expect(doble.bitacora[0].accion).toBe("conductor.punto_termino.definido");

    // El asiento registra el HECHO, nunca el valor. Se comprueba sobre el JSON
    // serializado: da igual en qué clave o nivel se colara, la coordenada no
    // puede aparecer.
    const detalleJson = JSON.stringify(doble.bitacora[0].detalle);
    expect(detalleJson).not.toContain("33.456");
    expect(detalleJson).not.toContain("70.123");
    expect(detalleJson).not.toContain("Ñuñoa");
  });

  it("crea con INSERT cuando no existía, y sella `redefinicion: false`", async () => {
    const doble = crearDoble({
      filaExistente: null,
      consentimiento: CONSENTIMIENTO_VIGENTE,
      filaGuardada: FILA_GUARDADA,
    });

    await definirPuntoTermino(doble.cliente, entrada);

    expect(doble.inserts).toHaveLength(1);
    expect(doble.updates).toHaveLength(0);
    expect((doble.bitacora[0].detalle as Record<string, unknown>).redefinicion).toBe(false);
  });

  it("redefinir es UPDATE de la MISMA fila, y `definido_en` no viaja en el payload", async () => {
    const doble = crearDoble({
      filaExistente: { conductor_id: CONDUCTOR_1 },
      consentimiento: CONSENTIMIENTO_VIGENTE,
      filaGuardada: FILA_GUARDADA,
    });

    await definirPuntoTermino(doble.cliente, entrada);

    // Nunca una fila nueva: el histórico es inexpresable por esquema y este es
    // el camino que lo respeta en la aplicación.
    expect(doble.inserts).toHaveLength(0);
    expect(doble.updates).toHaveLength(1);

    // La trampa del upsert de PostgREST (2026-08-13): toda columna del payload
    // es también una escritura en el UPDATE. Si `definido_en` viajara, cada
    // redefinición borraría desde cuándo existe el dato.
    expect(Object.keys(doble.updates[0]).sort()).toEqual(["comuna", "lat", "long"]);
    expect((doble.bitacora[0].detalle as Record<string, unknown>).redefinicion).toBe(true);
  });

  it("devuelve lo GUARDADO (redondeado por el trigger), no lo pedido", async () => {
    const doble = crearDoble({
      filaExistente: null,
      consentimiento: CONSENTIMIENTO_VIGENTE,
      filaGuardada: FILA_GUARDADA,
    });

    const guardado = await definirPuntoTermino(doble.cliente, entrada);

    // Se pidió -33.456789 y la base guardó -33.457. Devolver el input mentiría
    // al conductor sobre con qué precisión quedó su dato.
    expect(guardado.lat).toBe(-33.457);
    expect(guardado.long).toBe(-70.123);
    expect(guardado.lat).not.toBe(entrada.lat);
  });

  it("rechaza una coordenada imposible antes de tocar nada", async () => {
    const doble = crearDoble({
      filaExistente: null,
      consentimiento: CONSENTIMIENTO_VIGENTE,
      filaGuardada: FILA_GUARDADA,
    });

    await expect(
      definirPuntoTermino(doble.cliente, { ...entrada, lat: Number.NaN }),
    ).rejects.toBeInstanceOf(ErrorCoordenadaPuntoTerminoInvalida);

    await expect(
      definirPuntoTermino(doble.cliente, { ...entrada, lat: -700, long: -33 }),
    ).rejects.toBeInstanceOf(ErrorCoordenadaPuntoTerminoInvalida);

    expect(doble.bitacora).toHaveLength(0);
  });
});

// =============================================================================
// revocarPuntoTermino
// =============================================================================

describe("revocarPuntoTermino", () => {
  it("bitácora → revocación del consentimiento → DELETE REAL (no `activa = false`)", async () => {
    const doble = crearDoble({
      filaExistente: { conductor_id: CONDUCTOR_1 },
      consentimiento: CONSENTIMIENTO_VIGENTE,
      filaGuardada: FILA_GUARDADA,
    });

    await revocarPuntoTermino(doble.cliente, {
      tenantId: TENANT_A,
      conductorId: CONDUCTOR_1,
      actorUsuarioId: USUARIO_ID,
    });

    // El orden es el del §5.3 y no es decorativo: la bitácora va antes de todo
    // efecto para que la auditoría quede aunque el paso siguiente falle.
    expect(doble.orden[0]).toBe("bitacora");
    expect(doble.orden).toContain("update_consentimiento");
    expect(doble.orden).toContain("delete_punto");
    expect(doble.orden.indexOf("update_consentimiento")).toBeLessThan(
      doble.orden.indexOf("delete_punto"),
    );

    expect(doble.bitacora[0].accion).toBe("conductor.punto_termino.revocado");

    // No hay UPDATE sobre la tabla del punto: la fila se BORRA. Un `activa =
    // false` conservaría el domicilio sin nada colgando de él.
    expect(doble.updates).toHaveLength(0);
  });

  it("el DELETE lleva SIEMPRE su filtro de tenant, aunque conductor_id sea la PK", async () => {
    const doble = crearDoble({
      filaExistente: { conductor_id: CONDUCTOR_1 },
      consentimiento: CONSENTIMIENTO_VIGENTE,
      filaGuardada: FILA_GUARDADA,
    });

    await revocarPuntoTermino(doble.cliente, {
      tenantId: TENANT_A,
      conductorId: CONDUCTOR_1,
      actorUsuarioId: USUARIO_ID,
    });

    expect(doble.filtrosBorrado).toEqual([
      ["tenant_id", TENANT_A],
      ["conductor_id", CONDUCTOR_1],
    ]);
  });

  it("es idempotente: sin consentimiento vigente igual borra y no lanza", async () => {
    const doble = crearDoble({
      filaExistente: null,
      consentimiento: null,
      filaGuardada: FILA_GUARDADA,
    });

    await expect(
      revocarPuntoTermino(doble.cliente, {
        tenantId: TENANT_A,
        conductorId: CONDUCTOR_1,
        actorUsuarioId: USUARIO_ID,
      }),
    ).resolves.toBeUndefined();

    // Revocar dos veces no puede fallar: el control en la app es de UN TOQUE.
    expect(doble.orden).toContain("delete_punto");
  });
});
