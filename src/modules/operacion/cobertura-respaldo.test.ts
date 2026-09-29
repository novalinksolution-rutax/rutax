/**
 * `obtenerCoberturaPorRespaldo` — el aviso «esta comuna se cobra como Periferia».
 * Llama a la función real; el doble solo contesta las tablas que lee.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { obtenerCoberturaPorRespaldo } from "./cobertura-respaldo";

interface Datos {
  respaldo: { id: string; nombre: string } | null;
  zonasActivas: { id: string }[];
  mapeos: { zona_id: string; comuna: string }[];
  pedidos: { destinatario_comuna: string | null }[];
}

function cliente(d: Datos): SupabaseClient {
  const filas: Record<string, unknown[]> = {
    "identidad.zona_comunas": d.mapeos,
    "operacion.pedidos": d.pedidos,
  };
  return {
    schema(esquema: string) {
      return {
        from(tabla: string) {
          const key = `${esquema}.${tabla}`;
          let esRespaldo = false;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const q: any = {
            select: () => q,
            eq: (col: string, val: unknown) => {
              if (col === "es_respaldo" && val === true) esRespaldo = true;
              return q;
            },
            in: () => q,
            maybeSingle: async () => ({ data: esRespaldo ? d.respaldo : null, error: null }),
            range: async () => ({
              data: key === "identidad.zonas" ? d.zonasActivas : (filas[key] ?? []),
              error: null,
            }),
          };
          return q;
        },
      };
    },
  } as unknown as SupabaseClient;
}

const BASE: Datos = {
  respaldo: { id: "z-per", nombre: "Periferia" },
  zonasActivas: [{ id: "z-1" }, { id: "z-per" }],
  mapeos: [{ zona_id: "z-1", comuna: "Providencia" }],
  pedidos: [],
};

const ENTRADA = { tenantId: "t1", fecha: "2026-09-28" };

describe("obtenerCoberturaPorRespaldo", () => {
  it("sin zona de respaldo no hay nada que avisar (la resolución cae a la tarifa sin zona)", async () => {
    const r = await obtenerCoberturaPorRespaldo(
      cliente({ ...BASE, respaldo: null, pedidos: [{ destinatario_comuna: "Maipú" }] }),
      ENTRADA,
    );
    expect(r).toBeNull();
  });

  it("cuenta y agrupa por comuna las que NO están mapeadas, y omite las mapeadas", async () => {
    const r = await obtenerCoberturaPorRespaldo(
      cliente({
        ...BASE,
        pedidos: [
          { destinatario_comuna: "Providencia" },
          { destinatario_comuna: "Maipú" },
          { destinatario_comuna: "maipu" }, // mismo lugar, distinta escritura
          { destinatario_comuna: "Pudahuel" },
        ],
      }),
      ENTRADA,
    );

    expect(r).toEqual({
      zonaRespaldoNombre: "Periferia",
      totalPedidos: 3,
      comunas: [
        { comuna: "Maipú", pedidos: 2 },
        { comuna: "Pudahuel", pedidos: 1 },
      ],
    });
  });

  it("una comuna mapeada a una zona INACTIVA cuenta como sin zona (igual que la función SQL)", async () => {
    const r = await obtenerCoberturaPorRespaldo(
      cliente({
        ...BASE,
        zonasActivas: [{ id: "z-per" }], // z-1 está inactiva
        pedidos: [{ destinatario_comuna: "Providencia" }],
      }),
      ENTRADA,
    );
    expect(r?.comunas).toEqual([{ comuna: "Providencia", pedidos: 1 }]);
  });

  it("comuna vacía o fuera del catálogo también cae al respaldo, sin perderse", async () => {
    const r = await obtenerCoberturaPorRespaldo(
      cliente({ ...BASE, pedidos: [{ destinatario_comuna: null }, { destinatario_comuna: "Atlantis" }] }),
      ENTRADA,
    );
    expect(r?.totalPedidos).toBe(2);
    expect(r?.comunas.map((c) => c.comuna).sort()).toEqual(["Atlantis", "Sin comuna"]);
  });

  it("todo mapeado → null", async () => {
    const r = await obtenerCoberturaPorRespaldo(
      cliente({ ...BASE, pedidos: [{ destinatario_comuna: "Providencia" }] }),
      ENTRADA,
    );
    expect(r).toBeNull();
  });
});
