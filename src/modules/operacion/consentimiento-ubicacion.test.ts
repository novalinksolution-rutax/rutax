/**
 * Pruebas unitarias del módulo `consentimiento-ubicacion`.
 *
 * Cubre el MECANISMO (tabla + otorgar/revocar/verificar vigencia), no un
 * llamador concreto: desde 2026-08-14 este módulo no tiene ninguna Server
 * Action que lo invoque (se retiró el ping de ubicación en vivo — ver el aviso
 * al inicio de `consentimiento-ubicacion.ts` y
 * `docs/seguridad/punto-de-termino-conductor.md` §1) y se conserva como molde
 * para que la etapa 7 (punto de término del conductor) lo reuse con
 * `finalidad`. Antes cubría también el gate de `actualizarUbicacionConductor`
 * (los tests 5-6 de la numeración original); esa función ya no existe y esos
 * dos tests se retiraron con ella.
 *
 * Cubre:
 * 1. tieneConsentimientoVigente — sin filas → false.
 * 2. tieneConsentimientoVigente — última fila acepto=true, revocado_en=null → true.
 * 3. tieneConsentimientoVigente — última fila acepto=false → false.
 * 4. tieneConsentimientoVigente — última fila acepto=true, revocado_en SET → false.
 * 5. revocarConsentimientoUbicacion marca revocado_en tras bitácora, sin tocar
 *    ninguna otra tabla (ya no borra `ubicacion_conductor` — ver nota arriba).
 * 6. registrarConsentimientoUbicacion: escribe en bitácora ANTES del INSERT.
 * 7. registrarConsentimientoUbicacion: acepto=false → acción _rechazado en bitácora.
 * 8. **La finalidad se filtra de verdad** — la trampa de la etapa 7. Al agregar
 *    la columna `finalidad`, si la consulta no la filtra, un consentimiento de
 *    punto de término empieza a autorizar el rastreo en vivo (y al revés). Los
 *    mocks de este archivo REGISTRAN las columnas filtradas para poder afirmarlo,
 *    en vez de solo devolver una fila y dar por bueno el camino.
 */

import { describe, expect, it } from "vitest";
import {
  tieneConsentimientoVigente,
  registrarConsentimientoUbicacion,
  revocarConsentimientoUbicacion,
  VERSION_TEXTO_CONSENTIMIENTO_UBICACION,
  VERSION_TEXTO_CONSENTIMIENTO_PUNTO_TERMINO,
} from "./consentimiento-ubicacion";

// =============================================================================
// Fixtures
// =============================================================================

const TENANT_A = "aaaa0000-0000-0000-0000-000000000001";
const CONDUCTOR_1 = "dddd0000-0000-0000-0000-000000000010";
const USUARIO_ID = "uuuu0000-0000-0000-0000-000000000001";

// =============================================================================
// Helpers de construcción de mocks
// =============================================================================

/**
 * Construye el mock mínimo del cliente Supabase para pruebas de
 * tieneConsentimientoVigente. Permite configurar el resultado de
 * la query a `consentimientos_ubicacion`.
 *
 * `filtros` acumula los pares (columna, valor) de cada `.eq(...)`: es lo que
 * permite afirmar que la consulta filtra POR FINALIDAD, y no solo que devuelve
 * la fila que el mock le puso delante. Sin esto, quitar el filtro de finalidad
 * dejaría todas las pruebas en verde.
 */
function clienteConsentimientoMock(
  filaResult: {
    data: { id: string; acepto: boolean; revocado_en: string | null } | null;
    error: null | { message: string };
  },
  filtros: [string, unknown][] = [],
) {
  const encadenar = () => ({
    eq: (columna: string, valor: unknown) => {
      filtros.push([columna, valor]);
      return encadenar();
    },
    order: (_col: string, _opts: unknown) => ({
      limit: (_n: number) => ({
        maybeSingle: async () => filaResult,
      }),
    }),
  });

  return {
    from: (tabla: string) => {
      if (tabla === "consentimientos_ubicacion") {
        return { select: (_cols: string) => encadenar() };
      }
      return {};
    },
  } as unknown as Parameters<typeof tieneConsentimientoVigente>[0];
}

// =============================================================================
// 1-4. tieneConsentimientoVigente
// =============================================================================

describe("tieneConsentimientoVigente", () => {
  it("1. sin filas → false", async () => {
    const cliente = clienteConsentimientoMock({ data: null, error: null });
    const resultado = await tieneConsentimientoVigente(
      cliente,
      TENANT_A,
      CONDUCTOR_1,
      "rastreo_en_ruta",
    );
    expect(resultado).toBe(false);
  });

  it("2. última fila acepto=true, revocado_en=null → true", async () => {
    const cliente = clienteConsentimientoMock({
      data: { id: "con-1", acepto: true, revocado_en: null },
      error: null,
    });
    const resultado = await tieneConsentimientoVigente(
      cliente,
      TENANT_A,
      CONDUCTOR_1,
      "rastreo_en_ruta",
    );
    expect(resultado).toBe(true);
  });

  it("3. última fila acepto=false → false", async () => {
    const cliente = clienteConsentimientoMock({
      data: { id: "con-2", acepto: false, revocado_en: null },
      error: null,
    });
    const resultado = await tieneConsentimientoVigente(
      cliente,
      TENANT_A,
      CONDUCTOR_1,
      "rastreo_en_ruta",
    );
    expect(resultado).toBe(false);
  });

  it("4. última fila acepto=true pero revocado_en SET → false", async () => {
    const cliente = clienteConsentimientoMock({
      data: { id: "con-3", acepto: true, revocado_en: new Date().toISOString() },
      error: null,
    });
    const resultado = await tieneConsentimientoVigente(
      cliente,
      TENANT_A,
      CONDUCTOR_1,
      "rastreo_en_ruta",
    );
    expect(resultado).toBe(false);
  });

  /**
   * 8. LA TRAMPA DE LA ETAPA 7, hecha prueba.
   *
   * Hasta el 2026-08-14 esta función no filtraba por finalidad porque solo
   * existía una. Al agregar la columna, si la consulta no la filtra, el
   * consentimiento de punto de término (dónde vives) pasa a autorizar el rastreo
   * en vivo (dónde estás durante el turno) — y al revés. No falla nada, no hay
   * error: simplemente se trata un dato personal para una finalidad que el
   * trabajador nunca aceptó.
   *
   * Se afirma sobre los FILTROS aplicados, no sobre el resultado: el mock
   * devuelve la fila igual, así que un test que solo mirara el booleano pasaría
   * en verde con el filtro borrado.
   */
  it("8. filtra por tenant, conductor Y FINALIDAD — no solo por conductor", async () => {
    const filtros: [string, unknown][] = [];
    const cliente = clienteConsentimientoMock(
      { data: { id: "con-4", acepto: true, revocado_en: null }, error: null },
      filtros,
    );

    await tieneConsentimientoVigente(cliente, TENANT_A, CONDUCTOR_1, "punto_termino_ruta");

    expect(filtros).toEqual([
      ["tenant_id", TENANT_A],
      ["conductor_id", CONDUCTOR_1],
      ["finalidad", "punto_termino_ruta"],
    ]);
  });

  it("8b. preguntar por otra finalidad consulta OTRA finalidad (no reusa la vigente)", async () => {
    const filtros: [string, unknown][] = [];
    const cliente = clienteConsentimientoMock({ data: null, error: null }, filtros);

    const resultado = await tieneConsentimientoVigente(
      cliente,
      TENANT_A,
      CONDUCTOR_1,
      "rastreo_en_ruta",
    );

    expect(resultado).toBe(false);
    expect(filtros).toContainEqual(["finalidad", "rastreo_en_ruta"]);
  });
});

// =============================================================================
// 5. revocarConsentimientoUbicacion
// =============================================================================

describe("revocarConsentimientoUbicacion", () => {
  /**
   * Cadena del SELECT que busca el consentimiento vigente:
   *   .eq(tenant).eq(conductor).eq(finalidad).eq(acepto).is(revocado_en)
   *     .order().limit().maybeSingle()
   * Acumula los `.eq(...)` para poder afirmar el filtro de finalidad.
   */
  function cadenaBusquedaVigente(
    filtros: [string, unknown][],
    fila: { id: string } | null,
  ) {
    const cadena: Record<string, unknown> = {};
    cadena.eq = (columna: string, valor: unknown) => {
      filtros.push([columna, valor]);
      return cadena;
    };
    cadena.is = (_c: string, _v: unknown) => cadena;
    cadena.order = (_col: string, _opts: unknown) => ({
      limit: (_n: number) => ({
        maybeSingle: async () => ({ data: fila, error: null }),
      }),
    });
    return cadena;
  }

  it("5. revoca el consentimiento vigente (bitácora antes del UPDATE) sin tocar ninguna otra tabla", async () => {
    const bitacoraLlamadas: Array<Record<string, unknown>> = [];
    let updateLlamado = false;
    const tablasConsultadas: string[] = [];
    const filtrosBusqueda: [string, unknown][] = [];

    const cliente = {
      from: (tabla: string) => {
        tablasConsultadas.push(tabla);

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
            select: (_cols: string) => cadenaBusquedaVigente(filtrosBusqueda, { id: "con-1" }),
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

        // Cualquier otra tabla (en particular "ubicacion_conductor", que ya no
        // se borra desde aquí — ver el aviso al inicio del módulo) no debería
        // consultarse nunca: si algo la vuelve a llamar, este `from` no la
        // reconoce y el mock explota, lo cual es la señal que queremos.
        throw new Error(`Tabla inesperada en revocarConsentimientoUbicacion: ${tabla}`);
      },
    } as unknown as Parameters<typeof revocarConsentimientoUbicacion>[0];

    await revocarConsentimientoUbicacion(cliente, {
      tenantId: TENANT_A,
      conductorId: CONDUCTOR_1,
      actorUsuarioId: USUARIO_ID,
      finalidad: "punto_termino_ruta",
    });

    // El SELECT que busca el vigente acota A LA FINALIDAD: sin esto, revocar el
    // punto de término marcaría revocado un consentimiento de rastreo.
    expect(filtrosBusqueda).toContainEqual(["finalidad", "punto_termino_ruta"]);

    // Bitácora registrada (siempre la primera)
    expect(bitacoraLlamadas.length).toBeGreaterThanOrEqual(1);
    expect(bitacoraLlamadas[0].accion).toBe("conductor.ubicacion.consentimiento_revocado");

    // El consentimiento fue marcado como revocado
    expect(updateLlamado).toBe(true);

    // Nunca se tocó "ubicacion_conductor" (ni ninguna tabla fuera de las dos
    // esperadas: bitácora, y consentimientos_ubicacion dos veces — una vez
    // para el SELECT que busca el vigente, otra para el UPDATE que lo marca
    // revocado). La minimización de esa tabla ya no es responsabilidad de
    // esta función, porque nada la alimenta desde 2026-08-14.
    expect(tablasConsultadas).toEqual([
      "bitacora_auditoria",
      "consentimientos_ubicacion",
      "consentimientos_ubicacion",
    ]);
  });

  it("es idempotente: sin consentimiento vigente, no lanza y no intenta actualizar", async () => {
    const bitacoraLlamadas: Array<Record<string, unknown>> = [];
    let updateLlamado = false;

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
            // Sin consentimiento otorgado vigente.
            select: (_cols: string) => cadenaBusquedaVigente([], null),
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

        throw new Error(`Tabla inesperada en revocarConsentimientoUbicacion: ${tabla}`);
      },
    } as unknown as Parameters<typeof revocarConsentimientoUbicacion>[0];

    await expect(
      revocarConsentimientoUbicacion(cliente, {
        tenantId: TENANT_A,
        conductorId: CONDUCTOR_1,
        actorUsuarioId: USUARIO_ID,
        finalidad: "rastreo_en_ruta",
      }),
    ).resolves.toBeUndefined();

    expect(bitacoraLlamadas.length).toBeGreaterThanOrEqual(1);
    expect(updateLlamado).toBe(false);
  });
});

// =============================================================================
// 6-7. registrarConsentimientoUbicacion — bitácora antes del INSERT
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

  it("6. acepto=true: bitácora con acción _otorgado ANTES del INSERT en tabla", async () => {
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
      finalidad: "rastreo_en_ruta",
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

  it("7. acepto=false → acción _rechazado en bitácora y acepto=false en tabla", async () => {
    const { cliente, bitacoraLlamadas, insertLlamadas } = clienteRegistroMock();

    await registrarConsentimientoUbicacion(cliente, {
      tenantId: TENANT_A,
      conductorId: CONDUCTOR_1,
      actorUsuarioId: USUARIO_ID,
      acepto: false,
      versionTexto: VERSION_TEXTO_CONSENTIMIENTO_UBICACION,
      finalidad: "rastreo_en_ruta",
    });

    expect(bitacoraLlamadas[0].accion).toBe("conductor.ubicacion.consentimiento_rechazado");
    expect(insertLlamadas[0].acepto).toBe(false);
  });

  /**
   * La finalidad tiene que llegar a la FILA, no solo al parámetro. Si se
   * perdiera en el camino, el INSERT caería en el default de la columna
   * (`rastreo_en_ruta`) y el consentimiento del punto de término quedaría
   * archivado como si fuera del rastreo: revocar uno apagaría el otro.
   */
  it("8c. la finalidad viaja al INSERT y a la bitácora", async () => {
    const { cliente, bitacoraLlamadas, insertLlamadas } = clienteRegistroMock();

    await registrarConsentimientoUbicacion(cliente, {
      tenantId: TENANT_A,
      conductorId: CONDUCTOR_1,
      actorUsuarioId: USUARIO_ID,
      acepto: true,
      versionTexto: VERSION_TEXTO_CONSENTIMIENTO_PUNTO_TERMINO,
      finalidad: "punto_termino_ruta",
    });

    expect(insertLlamadas[0].finalidad).toBe("punto_termino_ruta");
    expect(
      (bitacoraLlamadas[0].detalle as Record<string, unknown>).finalidad,
    ).toBe("punto_termino_ruta");
  });
});
