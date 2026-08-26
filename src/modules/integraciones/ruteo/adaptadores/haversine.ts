/**
 * Adaptador HAVERSINE de la matriz de ruteo — línea recta sobre la esfera,
 * sin red, determinista. US$0/mes.
 * =====================================================================
 *
 * Adaptador por defecto (y único, hoy) de `PuertoMatriz`. Decisión de
 * producto cerrada (`docs/arquitectura/retiro-y-ruteo.md` §4/§4.1): las
 * alternativas de matriz por calle van de US$600 a US$30.000/mes al volumen
 * del piloto, y las gratuitas (OSRM demo, Valhalla de FOSSGIS, GraphHopper
 * free) prohíben uso comercial.
 *
 * Reusa `distanciaEnMetros` de `lib/geo/distancia.ts` (11 pruebas propias) —
 * este adaptador NO reimplementa geometría, solo la aplica a cada par de
 * puntos y cachea el resultado en una matriz indexada por id.
 *
 * SIMÉTRICO: `distanciaM(a,b) === distanciaM(b,a)` siempre, porque haversine
 * lo es. El motor de 2-opt/Or-opt (`operacion/ruteo/dos-opt.ts`,`or-opt.ts`)
 * se apoya en esa propiedad para evaluar movimientos por delta — ver la nota
 * en esos archivos. Si el día de mañana un adaptador de calles con sentido
 * único reemplaza a este, esa nota deja de ser válida sin más y hay que
 * revisarla ANTES de enchufarlo.
 *
 * Complejidad: O(n²) pares para n puntos. Para el volumen del piloto
 * (25-30 paradas + origen + destino opcional) y el techo medido en el plan
 * (200 paradas) son, como mucho, unos 20.000 pares — cada uno un puñado de
 * operaciones trigonométricas. Trivial frente al costo de la optimización
 * que corre encima (ver `operacion/ruteo/motor.ts`).
 */

import { distanciaEnMetros } from '@/lib/geo/distancia';
import type { PuertoMatriz } from '../puerto';
import type { MatrizDistancias, PuntoRuteo } from '../tipos';

class MatrizHaversine implements MatrizDistancias {
  constructor(private readonly filas: ReadonlyMap<string, ReadonlyMap<string, number>>) {}

  distanciaM(desdeId: string, haciaId: string): number {
    if (desdeId === haciaId) return 0;

    const fila = this.filas.get(desdeId);
    const valor = fila?.get(haciaId);
    if (valor === undefined) {
      // Contrato roto por el llamador: pidió un par de ids que no estaba en
      // los `puntos` con los que se calculó esta matriz. Nunca debería
      // ocurrir si `operacion/ruteo` solo consulta ids que él mismo entregó
      // — fallar fuerte en vez de devolver `NaN`/`Infinity` en silencio, que
      // se propagaría al costo total sin ningún error visible.
      throw new Error(
        `Matriz de ruteo (haversine): no hay distancia calculada entre '${desdeId}' y '${haciaId}'.`,
      );
    }
    return valor;
  }
}

export class HaversineMatrizAdapter implements PuertoMatriz {
  // Sin I/O: no hay nada que esperar. `async` solo para cumplir el contrato
  // `PuertoMatriz` (asíncrono desde el día uno — ver la cabecera de `puerto.ts`).
  async calcularMatriz(puntos: readonly PuntoRuteo[]): Promise<MatrizDistancias> {
    // Defensa en profundidad: `operacion/ruteo/motor.ts` ya valida ids únicos
    // antes de llegar aquí, pero este adaptador construye un Map indexado por
    // id — un duplicado silencioso pisaría filas de la matriz sin que nada lo
    // avise. Nunca confiar en un solo punto de validación (mismo criterio que
    // el resto del proyecto: "cerrado con varias redes").
    const idsVistos = new Set<string>();
    for (const punto of puntos) {
      if (idsVistos.has(punto.id)) {
        throw new Error(`Matriz de ruteo (haversine): id duplicado '${punto.id}' en los puntos a calcular.`);
      }
      idsVistos.add(punto.id);
    }

    const filas = new Map<string, Map<string, number>>();
    for (const punto of puntos) filas.set(punto.id, new Map());

    for (let i = 0; i < puntos.length; i++) {
      for (let j = i + 1; j < puntos.length; j++) {
        const a = puntos[i];
        const b = puntos[j];
        const distancia = distanciaEnMetros(a, b);
        // Simétrica: una sola llamada a `distanciaEnMetros`, escrita en las
        // dos direcciones. Ver la nota de simetría en la cabecera del archivo.
        filas.get(a.id)!.set(b.id, distancia);
        filas.get(b.id)!.set(a.id, distancia);
      }
    }

    return new MatrizHaversine(filas);
  }
}
