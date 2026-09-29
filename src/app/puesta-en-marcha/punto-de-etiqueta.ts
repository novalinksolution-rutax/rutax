/**
 * Dónde poner el nombre de una comuna en el mapa.
 * =============================================================================
 * El centro de la caja envolvente cae fuera de comunas alargadas o con forma de
 * «C» (San José de Maipo, Santiago). Se usa el centroide del polígono mayor y,
 * si ese punto quedara fuera, el medio del tramo interior más ancho de la
 * horizontal que lo cruza. Pura y sin dependencias: se prueba sin montar mapa.
 */

type Anillo = readonly (readonly number[])[];
type Poligono = readonly Anillo[];

export interface GeometriaPoligonal {
  type: string;
  coordinates: unknown;
}

function areaYCentroide(anillo: Anillo): { area: number; x: number; y: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < anillo.length - 1; i++) {
    const [x0, y0] = anillo[i];
    const [x1, y1] = anillo[i + 1];
    const cruz = x0 * y1 - x1 * y0;
    a += cruz;
    cx += (x0 + x1) * cruz;
    cy += (y0 + y1) * cruz;
  }
  if (a === 0) return { area: 0, x: anillo[0]?.[0] ?? 0, y: anillo[0]?.[1] ?? 0 };
  return { area: Math.abs(a) / 2, x: cx / (3 * a), y: cy / (3 * a) };
}

/** Abscisas donde la horizontal `y` cruza los anillos del polígono, ordenadas. */
function cruces(poligono: Poligono, y: number): number[] {
  const xs: number[] = [];
  for (const anillo of poligono) {
    for (let i = 0; i < anillo.length - 1; i++) {
      const [x0, y0] = anillo[i];
      const [x1, y1] = anillo[i + 1];
      if (y0 > y !== y1 > y) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
    }
  }
  return xs.sort((p, q) => p - q);
}

function estaAdentro(poligono: Poligono, x: number, y: number): boolean {
  const xs = cruces(poligono, y);
  for (let i = 0; i + 1 < xs.length; i += 2) if (x >= xs[i] && x <= xs[i + 1]) return true;
  return false;
}

/**
 * `[lng, lat]` dentro de la comuna y el área (grados², solo para ordenar:
 * las comunas grandes rotulan primero). `null` si la geometría no es poligonal.
 */
export function puntoDeEtiqueta(
  geometria: GeometriaPoligonal,
): { punto: [number, number]; area: number } | null {
  let poligonos: Poligono[];
  if (geometria.type === "Polygon") poligonos = [geometria.coordinates as Poligono];
  else if (geometria.type === "MultiPolygon") poligonos = geometria.coordinates as Poligono[];
  else return null;

  let mejor: { poligono: Poligono; area: number; x: number; y: number } | null = null;
  let areaTotal = 0;
  for (const p of poligonos) {
    if (!p[0] || p[0].length < 4) continue;
    const c = areaYCentroide(p[0]);
    areaTotal += c.area;
    if (!mejor || c.area > mejor.area) mejor = { poligono: p, ...c };
  }
  if (!mejor) return null;

  if (estaAdentro(mejor.poligono, mejor.x, mejor.y)) return { punto: [mejor.x, mejor.y], area: areaTotal };

  const xs = cruces(mejor.poligono, mejor.y);
  let ancho = -1;
  let medio = mejor.x;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > ancho) {
      ancho = xs[i + 1] - xs[i];
      medio = (xs[i] + xs[i + 1]) / 2;
    }
  }
  return { punto: [medio, mejor.y], area: areaTotal };
}
