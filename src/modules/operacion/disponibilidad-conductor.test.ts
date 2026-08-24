import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const bitacora = vi.fn();
vi.mock("@/modules/identidad/auditoria", () => ({
  registrarEnBitacora: (...args: unknown[]) => bitacora(...args),
}));

import { leerDisponibilidad, marcarmeDisponible } from "./disponibilidad-conductor";

/**
 * La asistencia del conductor, ahora suya.
 *
 * Lo que se prueba acá no es que un booleano se guarde: es **que no haya forma
 * de marcar a otro**. El control que se le quitó al coordinador no puede
 * reaparecer por la puerta de atrás, y la única defensa contra eso es que la
 * función no acepte un identificador de conductor que venga de afuera.
 */
function clienteFalso(opciones: {
  fila?: { disponible: boolean; capacidad_paradas: number | null } | null;
  errorUpdate?: { message: string };
}) {
  const updates: Record<string, unknown>[] = [];
  const filtros: Array<[string, unknown]> = [];
  const cliente = {
    schema: () => ({
      from: () => {
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.update = (v: Record<string, unknown>) => {
          updates.push(v);
          return q;
        };
        q.eq = (col: string, val: unknown) => {
          filtros.push([col, val]);
          return q;
        };
        q.maybeSingle = () => {
          const base =
            opciones.fila === undefined ? { disponible: false, capacidad_paradas: 30 } : opciones.fila;
          // Tras un update, la base devuelve lo ESCRITO. Si el falso devolviera
          // siempre lo mismo, la prueba del valor de vuelta no probaría nada.
          const ultimo = updates[updates.length - 1];
          const data = base && ultimo ? { ...base, ...ultimo } : base;
          return Promise.resolve({
            data,
            error: updates.length > 0 ? (opciones.errorUpdate ?? null) : null,
          });
        };
        return q;
      },
    }),
  } as unknown as SupabaseClient;
  return { cliente, updates, filtros };
}

const ENTRADA = {
  tenantId: "t1",
  conductorId: "c1",
  usuarioId: "u1",
  disponible: true,
};

describe("leerDisponibilidad", () => {
  it("filtra por conductor Y por tenant", async () => {
    const { cliente, filtros } = clienteFalso({});
    await leerDisponibilidad(cliente, { tenantId: "t1", conductorId: "c1" });
    expect(filtros).toEqual([
      ["id", "c1"],
      ["tenant_id", "t1"],
    ]);
  });

  it("devuelve null cuando el conductor no es de este courier", async () => {
    const { cliente } = clienteFalso({ fila: null });
    expect(await leerDisponibilidad(cliente, { tenantId: "t1", conductorId: "c1" })).toBeNull();
  });
});

describe("marcarmeDisponible", () => {
  beforeEach(() => vi.clearAllMocks());

  it("guarda la marca y la devuelve", async () => {
    const { cliente, updates } = clienteFalso({});
    const r = await marcarmeDisponible(cliente, ENTRADA);
    expect(updates).toEqual([{ disponible: true }]);
    expect(r.disponible).toBe(true);
  });

  it("deja bitácora ANTES del efecto, con autor", async () => {
    // Es la marca de asistencia de una persona: si el update falla después,
    // tiene que quedar registrado que lo intentó.
    const { cliente } = clienteFalso({});
    await marcarmeDisponible(cliente, ENTRADA);
    expect(bitacora).toHaveBeenCalledTimes(1);
    const [, arg] = bitacora.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(arg.actorUsuarioId).toBe("u1");
    expect(arg.accion).toBe("conductor.disponible_activado");
  });

  it("el actor y la entidad son la MISMA persona", async () => {
    // Es la señal de que la marca la puso quien trabaja, no quien reparte el
    // trabajo. Si algún día divergen, alguien está marcando por otro.
    const { cliente } = clienteFalso({});
    await marcarmeDisponible(cliente, ENTRADA);
    const [, arg] = bitacora.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(arg.entidadTipo).toBe("conductor");
    expect(arg.entidadId).toBe("c1");
    expect((arg.detalle as Record<string, unknown>).origen).toBe("app_conductor");
  });

  it("distingue apagar de encender en la bitácora", async () => {
    const { cliente } = clienteFalso({});
    await marcarmeDisponible(cliente, { ...ENTRADA, disponible: false });
    const [, arg] = bitacora.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(arg.accion).toBe("conductor.disponible_desactivado");
  });

  it("no escribe nada si el conductor no es de este courier", async () => {
    const { cliente, updates } = clienteFalso({ fila: null });
    await expect(marcarmeDisponible(cliente, ENTRADA)).rejects.toThrow(/ficha de conductor/);
    expect(updates).toEqual([]);
    expect(bitacora).not.toHaveBeenCalled();
  });

  it("el update SIEMPRE lleva el tenant, no solo el id del conductor", async () => {
    // Sin el tenant, un id de conductor de otro courier sería suficiente para
    // escribir en su fila.
    const { cliente, filtros } = clienteFalso({});
    await marcarmeDisponible(cliente, ENTRADA);
    expect(filtros.filter(([c]) => c === "tenant_id")).not.toHaveLength(0);
    for (const par of filtros.filter(([c]) => c === "tenant_id")) {
      expect(par[1]).toBe("t1");
    }
  });
});
