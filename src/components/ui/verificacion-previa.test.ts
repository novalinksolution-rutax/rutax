/**
 * Las dos preguntas de la verificación previa, que antes se respondían tres
 * veces —una por cuadro— con tres redacciones distintas de lo mismo.
 *
 * Gobiernan si se puede ejecutar una acción irreversible de dinero, así que
 * valen una prueba propia: el bug que importa acá no es visual.
 */

import { describe, expect, it } from "vitest";

import {
  actoBloqueadoPorVerificacion,
  laVerificacionQuedaOmitida,
} from "./verificacion-previa";
import type { ItemPreflight, ResultadoPreflight } from "@/modules/dinero/preflight";

function item(codigo: string, categoria: ItemPreflight["categoria"]): ItemPreflight {
  return {
    codigo: codigo as ItemPreflight["codigo"],
    categoria,
    titulo: `Reparo ${codigo}`,
  };
}

function resultado({
  bloqueos = [],
  advertencias = [],
}: {
  bloqueos?: ItemPreflight[];
  advertencias?: ItemPreflight[];
}): ResultadoPreflight {
  return {
    tipoAccion: "emitir_factura",
    ok: bloqueos.length === 0,
    bloqueos,
    advertencias,
    informativos: [],
    resumen: {
      tipoAccion: "emitir_factura",
      netoClp: 100,
      ivaClp: 19,
      totalClp: 119,
    } as ResultadoPreflight["resumen"],
    generadoEn: "2026-08-22T00:00:00.000Z",
  };
}

describe("actoBloqueadoPorVerificacion", () => {
  it("mientras verifica, nada se puede confirmar", () => {
    expect(
      actoBloqueadoPorVerificacion({ estado: "verificando", resultado: null, aceptado: true }),
    ).toBe(true);
  });

  it("A · todo en orden: se puede, sin marcar nada", () => {
    expect(
      actoBloqueadoPorVerificacion({ estado: "listo", resultado: resultado({}), aceptado: false }),
    ).toBe(false);
  });

  it("B · con reparos: se puede seguir, pero solo tras el acto explícito", () => {
    const conReparos = resultado({ advertencias: [item("sin_tarifa", "advierte")] });
    expect(
      actoBloqueadoPorVerificacion({ estado: "listo", resultado: conReparos, aceptado: false }),
    ).toBe(true);
    expect(
      actoBloqueadoPorVerificacion({ estado: "listo", resultado: conReparos, aceptado: true }),
    ).toBe(false);
  });

  it("C · bloqueado: NINGUNA casilla lo levanta", () => {
    // Es la diferencia entre los dos desenlaces: un reparo se asume, un bloqueo
    // se resuelve. Si marcar la casilla levantara un bloqueo, la escalera de
    // fricción entera sería decorativa.
    const bloqueado = resultado({ bloqueos: [item("excepcion_bloqueante", "bloquea")] });
    expect(
      actoBloqueadoPorVerificacion({ estado: "listo", resultado: bloqueado, aceptado: true }),
    ).toBe(true);
  });

  it("no se pudo verificar: se puede continuar declarándolo", () => {
    expect(
      actoBloqueadoPorVerificacion({ estado: "no_verificable", resultado: null, aceptado: false }),
    ).toBe(true);
    expect(
      actoBloqueadoPorVerificacion({ estado: "no_verificable", resultado: null, aceptado: true }),
    ).toBe(false);
  });

  it("sin resultado y en estado listo falla cerrado", () => {
    expect(
      actoBloqueadoPorVerificacion({ estado: "listo", resultado: null, aceptado: true }),
    ).toBe(true);
  });
});

describe("laVerificacionQuedaOmitida", () => {
  it("todo en orden no deja constancia de nada", () => {
    expect(
      laVerificacionQuedaOmitida({ estado: "listo", resultado: resultado({}), aceptado: true }),
    ).toBe(false);
  });

  it("seguir con reparos SÍ queda registrado", () => {
    // Es el desenlace del medio del tablero P4, y lo que no existía: antes se
    // emitía con reparos sin que quedara nada anotado.
    expect(
      laVerificacionQuedaOmitida({
        estado: "listo",
        resultado: resultado({ advertencias: [item("minimo_no_alcanzado", "advierte")] }),
        aceptado: true,
      }),
    ).toBe(true);
  });

  it("no marcado, no hay nada que registrar", () => {
    expect(
      laVerificacionQuedaOmitida({
        estado: "no_verificable",
        resultado: null,
        aceptado: false,
      }),
    ).toBe(false);
  });

  it("continuar sin poder verificar queda registrado", () => {
    expect(
      laVerificacionQuedaOmitida({ estado: "no_verificable", resultado: null, aceptado: true }),
    ).toBe(true);
  });
});
