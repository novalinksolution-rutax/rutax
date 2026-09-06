import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const bitacora = vi.fn();
vi.mock("@/modules/identidad/auditoria", () => ({
  registrarEnBitacora: (...args: unknown[]) => bitacora(...args),
}));

import { leerVehiculoConductor, fijarVehiculoConductor } from "./vehiculo-conductor";

/**
 * El vehículo del conductor, ahora suyo (2026-09-05).
 *
 * Lo que importa probar no es que un enum se guarde: es que **no haya forma de
 * cambiarle el vehículo a otro** (este dato ahora gobierna cómo se traza su
 * ruta), que el `null` de «sin declarar» no se invente, y que cada cambio deje
 * bitácora — el «sin que nadie se entere» que la decisión original temía.
 */
function clienteFalso(opciones: {
  fila?: { vehiculo: "moto" | "auto" | null } | null;
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
          const base = opciones.fila === undefined ? { vehiculo: null } : opciones.fila;
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
  vehiculo: "moto" as const,
};

describe("leerVehiculoConductor", () => {
  it("filtra por conductor Y por tenant", async () => {
    const { cliente, filtros } = clienteFalso({});
    await leerVehiculoConductor(cliente, { tenantId: "t1", conductorId: "c1" });
    expect(filtros).toEqual([
      ["id", "c1"],
      ["tenant_id", "t1"],
    ]);
  });

  it("preserva el null de «sin declarar» tal cual, sin inventar auto", async () => {
    // La app muestra Auto por defecto, pero la BASE guarda null hasta que el
    // conductor elige. Inventar 'auto' acá haría a la nómina decir «Auto» de un
    // dato que nadie afirmó.
    const { cliente } = clienteFalso({ fila: { vehiculo: null } });
    const r = await leerVehiculoConductor(cliente, { tenantId: "t1", conductorId: "c1" });
    expect(r).toEqual({ vehiculo: null });
  });

  it("devuelve null cuando el conductor no es de este courier", async () => {
    const { cliente } = clienteFalso({ fila: null });
    expect(await leerVehiculoConductor(cliente, { tenantId: "t1", conductorId: "c1" })).toBeNull();
  });
});

describe("fijarVehiculoConductor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("guarda el vehículo y lo devuelve", async () => {
    const { cliente, updates } = clienteFalso({});
    const r = await fijarVehiculoConductor(cliente, ENTRADA);
    expect(updates).toEqual([{ vehiculo: "moto" }]);
    expect(r.vehiculo).toBe("moto");
  });

  it("deja bitácora ANTES del efecto, con autor y el valor anterior", async () => {
    const { cliente } = clienteFalso({ fila: { vehiculo: "auto" } });
    await fijarVehiculoConductor(cliente, ENTRADA);
    expect(bitacora).toHaveBeenCalledTimes(1);
    const [, arg] = bitacora.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(arg.actorUsuarioId).toBe("u1");
    expect(arg.accion).toBe("conductor.vehiculo_declarado");
    const detalle = arg.detalle as Record<string, unknown>;
    expect(detalle.vehiculo).toBe("moto");
    expect(detalle.vehiculo_anterior).toBe("auto");
    expect(detalle.origen).toBe("app_conductor");
  });

  it("el actor y la entidad son la MISMA persona", async () => {
    const { cliente } = clienteFalso({});
    await fijarVehiculoConductor(cliente, ENTRADA);
    const [, arg] = bitacora.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(arg.entidadTipo).toBe("conductor");
    expect(arg.entidadId).toBe("c1");
  });

  it("no escribe nada si el conductor no es de este courier", async () => {
    const { cliente, updates } = clienteFalso({ fila: null });
    await expect(fijarVehiculoConductor(cliente, ENTRADA)).rejects.toThrow(/ficha de conductor/);
    expect(updates).toEqual([]);
    expect(bitacora).not.toHaveBeenCalled();
  });

  it("el update SIEMPRE lleva el tenant, no solo el id del conductor", async () => {
    const { cliente, filtros } = clienteFalso({});
    await fijarVehiculoConductor(cliente, ENTRADA);
    const conTenant = filtros.filter(([c]) => c === "tenant_id");
    expect(conTenant).not.toHaveLength(0);
    for (const par of conTenant) expect(par[1]).toBe("t1");
  });
});
