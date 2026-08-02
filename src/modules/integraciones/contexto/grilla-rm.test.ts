import { describe, expect, it } from 'vitest';
import { COMUNAS_RM, type ComunaRM } from '@/lib/ui/comunas-rm';
import { CENTROIDES_RM } from '@/lib/geo/centroides-rm';
import { distanciaEnMetros } from '@/lib/geo/distancia';
import {
  agruparComunasPorPunto,
  DISTANCIA_MAXIMA_GRILLA_M,
  GRILLA_RM,
  puntoDeComuna,
} from './grilla-rm';

describe('GRILLA_RM', () => {
  it('tiene 14 puntos y ninguno repetido', () => {
    expect(GRILLA_RM).toHaveLength(14);
    expect(new Set(GRILLA_RM.map((p) => p.referencia)).size).toBe(14);
  });

  it('sus coordenadas son los centroides reales, no números redondeados a mano', () => {
    // Si alguien «ajusta» un punto a ojo, esto lo caza. Los puntos SON comunas.
    for (const punto of GRILLA_RM) {
      const centroide = CENTROIDES_RM[punto.referencia];
      expect(punto.lat).toBe(centroide.lat);
      expect(punto.long).toBe(centroide.long);
    }
  });

  it('cubre las 52 comunas dentro de la distancia máxima declarada', () => {
    // Es LA prueba de este archivo. La constante documenta el peor caso medido;
    // si alguien quita un punto de la grilla, alguna comuna se aleja y esto
    // falla en vez de degradar el pronóstico en silencio.
    const distancias = COMUNAS_RM.map((comuna) => ({
      comuna,
      metros: distanciaEnMetros(CENTROIDES_RM[comuna], puntoDeComuna(comuna)),
    }));

    const peor = distancias.reduce((a, b) => (b.metros > a.metros ? b : a));
    expect(
      peor.metros,
      `La comuna peor cubierta es ${peor.comuna}, a ${(peor.metros / 1000).toFixed(1)} km`,
    ).toBeLessThanOrEqual(DISTANCIA_MAXIMA_GRILLA_M);
  });

  it('una comuna que ES punto de grilla se asigna a sí misma', () => {
    for (const punto of GRILLA_RM) {
      expect(puntoDeComuna(punto.referencia).referencia).toBe(punto.referencia);
    }
  });
});

describe('agruparComunasPorPunto', () => {
  it('reparte las 52 comunas sin perder ni duplicar ninguna', () => {
    const grupos = agruparComunasPorPunto();
    const repartidas = grupos.flatMap((g) => g.comunas);

    expect(repartidas).toHaveLength(COMUNAS_RM.length);
    expect(new Set(repartidas).size).toBe(COMUNAS_RM.length);
    expect([...repartidas].sort()).toEqual([...COMUNAS_RM].sort());
  });

  it('usa los 14 puntos cuando se piden todas las comunas', () => {
    expect(agruparComunasPorPunto()).toHaveLength(14);
  });

  it('solo pide los puntos que hacen falta: menos comunas, menos llamadas', () => {
    // El ahorro es el punto del módulo. Un courier que opera tres comunas del
    // centro no debe disparar catorce llamadas.
    const grupos = agruparComunasPorPunto(['Santiago', 'Providencia', 'Ñuñoa']);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].punto.referencia).toBe('Santiago');
    expect(grupos[0].comunas).toHaveLength(3);
  });

  it('devuelve los grupos en el orden de la grilla, no en el de llegada', () => {
    const alReves: ComunaRM[] = ['Alhué', 'Santiago'];
    const grupos = agruparComunasPorPunto(alReves);
    expect(grupos.map((g) => g.punto.referencia)).toEqual(['Santiago', 'Alhué']);
  });

  it('sin comunas no pide nada', () => {
    expect(agruparComunasPorPunto([])).toEqual([]);
  });
});
