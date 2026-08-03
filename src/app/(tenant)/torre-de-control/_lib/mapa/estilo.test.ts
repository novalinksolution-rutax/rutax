import { describe, expect, it } from 'vitest';
import { capasDatos, construirEstiloBase, IDS_CAPAS, IDS_FUENTES } from './estilo';
import { nivelParaZoom, paletaDe, UMBRALES_ZOOM, type TemaMapa } from './paleta';

const TEMAS: TemaMapa[] = ['claro', 'oscuro'];
const URLS = { urlBasemap: 'https://ejemplo/rm.pmtiles', urlGlifos: 'https://ejemplo/fuentes' };

describe('estilo del mapa — invariantes de las dos versiones', () => {
  it('los dos temas producen exactamente las mismas capas, en el mismo orden', () => {
    // Si un tema pierde una capa, el mapa cambia de contenido al conmutar el
    // tema del sistema — y eso se descubre de noche, en producción.
    const ids = TEMAS.map((tema) =>
      construirEstiloBase({ tema, ...URLS }).layers.map((capa) => capa.id),
    );
    expect(ids[0]).toEqual(ids[1]);
    expect(new Set(ids[0]).size).toBe(ids[0].length);
  });

  it('la fuente del basemap declara maxzoom 13', () => {
    // El recorte de la RM llega hasta z13. Sin `maxzoom` MapLibre deja de pedir
    // tiles al pasarlo y el plano DESAPARECE justo en el nivel del punto de
    // entrega, que es donde más se necesita.
    const estilo = construirEstiloBase({ tema: 'claro', ...URLS });
    const fuente = estilo.sources[IDS_FUENTES.basemap];
    expect(fuente).toMatchObject({ type: 'vector', maxzoom: 13 });
  });

  it('degrada sin basemap: fondo pintado, cero fuentes', () => {
    const estilo = construirEstiloBase({ tema: 'oscuro', urlBasemap: null, urlGlifos: null });
    expect(Object.keys(estilo.sources)).toHaveLength(0);
    expect(estilo.layers).toHaveLength(1);
    expect(estilo.layers[0].type).toBe('background');
  });

  it('sin glifos el plano queda mudo a propósito, no roto', () => {
    // Un `glyphs` apuntando a la nada hace que MapLibre descarte la capa symbol
    // entera. Es preferible no declararla a que se caiga sola.
    const estilo = construirEstiloBase({ ...URLS, tema: 'claro', urlGlifos: null });
    expect(estilo.glyphs).toBeUndefined();
    expect(estilo.layers.some((capa) => capa.type === 'symbol')).toBe(false);
  });

  it('la etiqueta de calle local aparece en el mismo zoom que el punto individual', () => {
    // No es coincidencia: la Torre no muestra la dirección, así que el nombre de
    // la calle es lo único que ubica el punto. Si se separan, el nivel 3 queda
    // mostrando puntos sobre un plano anónimo.
    const estilo = construirEstiloBase({ tema: 'claro', ...URLS });
    const etiqueta = estilo.layers.find((capa) => capa.id === 'bm-etq-via-local');
    expect(etiqueta?.minzoom).toBe(UMBRALES_ZOOM.punto);
  });
});

describe('capas de dato — las reglas de color del alcance', () => {
  it.each(TEMAS)('el rojo lo usa UNA sola capa, y es la de incidencia (%s)', (tema) => {
    // Regla 4: el rojo está reservado a la incidencia abierta. Nada decorativo
    // puede tomarlo — ni un borde, ni un realce, ni un hover.
    const rojo = paletaDe(tema).datos.puntoIncidencia;
    const conRojo = capasDatos(tema, true).filter((capa) => JSON.stringify(capa).includes(rojo));
    expect(conRojo.map((capa) => capa.id)).toEqual([IDS_CAPAS.puntoIncidencia]);
  });

  it.each(TEMAS)('el basemap no toca el rojo de incidencia (%s)', (tema) => {
    const rojo = paletaDe(tema).datos.puntoIncidencia;
    const estilo = construirEstiloBase({ tema, ...URLS });
    expect(JSON.stringify(estilo.layers)).not.toContain(rojo);
  });

  it('la incidencia se pinta al final: nada la tapa', () => {
    const ids = capasDatos('claro', true).map((capa) => capa.id);
    expect(ids.at(-2)).toBe(IDS_CAPAS.puntoIncidencia);
    // Lo único encima es el `+N`, que es texto sobre el propio punto.
    expect(ids.at(-1)).toBe(IDS_CAPAS.puntoAgrupado);
  });

  it.each(TEMAS)('sin glifos no queda una sola capa symbol en el dato (%s)', (tema) => {
    // La misma regla que ya cumplía el plano, que a estas capas se les había
    // escapado: un `text-font` sin glifos publicados no degrada solo, MapLibre
    // descarta la capa entera y lo repite una vez por tesela.
    expect(capasDatos(tema, false).some((capa) => capa.type === 'symbol')).toBe(false);
    expect(capasDatos(tema, true).some((capa) => capa.type === 'symbol')).toBe(true);
  });

  it.each(TEMAS)('sin glifos el `+N` se sustituye por un anillo, no desaparece (%s)', (tema) => {
    // Regla 5 del alcance: el mapa NUNCA esconde carga. El radio del punto
    // depende solo del zoom, así que sin el `+N` un edificio con seis entregas
    // se vería idéntico a uno con una. La cifra se pierde; el hecho, no.
    const sinGlifos = capasDatos(tema, false);
    const anillo = sinGlifos.find((capa) => capa.id === IDS_CAPAS.puntoAgrupadoAnillo);
    expect(anillo).toBeDefined();
    expect(anillo).toMatchObject({ filter: ['>', ['get', 'agrupados'], 1] });

    // Y va DEBAJO de los puntos, para que la incidencia siga siendo la última
    // marca que se pinta.
    const ids = sinGlifos.map((capa) => capa.id);
    expect(ids.indexOf(IDS_CAPAS.puntoAgrupadoAnillo)).toBeLessThan(
      ids.indexOf(IDS_CAPAS.puntoEntregado),
    );
    expect(ids.at(-1)).toBe(IDS_CAPAS.puntoIncidencia);
  });

  it('el anillo del agrupado no existe cuando sí hay glifos', () => {
    // Dos marcas para lo mismo es el ruido que la regla 1 prohíbe: o el número
    // o el anillo, nunca los dos.
    const ids = capasDatos('claro', true).map((capa) => capa.id);
    expect(ids).not.toContain(IDS_CAPAS.puntoAgrupadoAnillo);
  });

  it.each(TEMAS)('la sombra va bajo TODOS los puntos y el entregado no la lleva (%s)', (tema) => {
    // El tratamiento «halo y profundidad»: una sola capa de sombra compartida,
    // debajo de todos los estados. Si se colara por encima de cualquier punto,
    // lo ensuciaría en vez de asentarlo.
    for (const conEtiquetas of [true, false]) {
      const capas = capasDatos(tema, conEtiquetas);
      const ids = capas.map((capa) => capa.id);
      const iSombra = ids.indexOf(IDS_CAPAS.puntoSombra);
      expect(iSombra).toBeGreaterThanOrEqual(0);

      for (const id of [
        IDS_CAPAS.puntoEntregado,
        IDS_CAPAS.puntoPendiente,
        IDS_CAPAS.puntoEnRuta,
        IDS_CAPAS.puntoCorte,
        IDS_CAPAS.puntoIncidencia,
      ]) {
        expect(iSombra).toBeLessThan(ids.indexOf(id));
      }

      // El entregado se apaga Y se hunde: sin sombra no tiene volumen, y eso es
      // lo que lo separa de lo que todavía cuenta sin gastar otro color.
      const sombra = capas[iSombra];
      expect(sombra).toMatchObject({ filter: ['!=', ['get', 'estado'], 'entregado'] });
    }
  });

  it('los pedidos van por fuente GeoJSON, nunca como anclas HTML', () => {
    // Medido: 600 anclas HTML cuestan 31,77 ms/frame (≈31 fps); por GeoJSON las
    // dibuja la GPU. La capa HTML es solo para las ~32 placas de comuna.
    const dePuntos = capasDatos('claro', true).filter((capa) => 'source' in capa && capa.source === IDS_FUENTES.puntos);
    expect(dePuntos.length).toBeGreaterThanOrEqual(5);
  });
});

describe('zoom semántico', () => {
  it('cada zoom cae en un solo nivel, y las fronteras son las declaradas', () => {
    expect(nivelParaZoom(9)).toBe('comuna');
    expect(nivelParaZoom(UMBRALES_ZOOM.comuna - 0.01)).toBe('comuna');
    expect(nivelParaZoom(UMBRALES_ZOOM.comuna)).toBe('agrupacion');
    expect(nivelParaZoom(UMBRALES_ZOOM.punto - 0.01)).toBe('agrupacion');
    expect(nivelParaZoom(UMBRALES_ZOOM.punto)).toBe('punto');
    expect(nivelParaZoom(17)).toBe('punto');
  });
});
