import { readFileSync } from "node:fs";
import path from "node:path";
import { feature } from "topojson-client";
import { describe, expect, it } from "vitest";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { puntoDeEtiqueta } from "./punto-de-etiqueta";

describe("punto de etiqueta", () => {
  it("un cuadrado: su centro", () => {
    const r = puntoDeEtiqueta({
      type: "Polygon",
      coordinates: [[[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]]],
    });
    expect(r?.punto[0]).toBeCloseTo(2);
    expect(r?.punto[1]).toBeCloseTo(1);
  });

  it("una «C»: el punto queda dentro, no en el hueco", () => {
    const c = [[[0, 0], [10, 0], [10, 2], [2, 2], [2, 8], [10, 8], [10, 10], [0, 10], [0, 0]]];
    const r = puntoDeEtiqueta({ type: "Polygon", coordinates: c });
    const [x, y] = r!.punto;
    const enBrazoVertical = x >= 0 && x <= 2;
    const enBrazoHorizontal = y <= 2 || y >= 8;
    expect(enBrazoVertical || enBrazoHorizontal).toBe(true);
  });

  it("geometría no poligonal: null", () => {
    expect(puntoDeEtiqueta({ type: "Point", coordinates: [0, 0] })).toBeNull();
  });

  it("las 52 comunas reales tienen punto", () => {
    const ruta = path.join(process.cwd(), "public/mapas/comunas-rm.topojson.json");
    const topo = JSON.parse(readFileSync(ruta, "utf8"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fc = feature(topo, topo.objects.comunas) as any;
    const nombres = new Set<string>();
    for (const f of fc.features) {
      expect(puntoDeEtiqueta(f.geometry)).not.toBeNull();
      nombres.add(f.properties.comuna);
    }
    for (const c of COMUNAS_RM) expect(nombres.has(c)).toBe(true);
  });
});
