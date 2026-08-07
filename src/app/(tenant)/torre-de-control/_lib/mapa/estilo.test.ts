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

  it.each(TEMAS)('ninguna capa filtra por `medium_road` (%s)', (tema) => {
    // La clase existe en el ESQUEMA de Protomaps pero no en este extracto de la
    // RM: se verificó sobre el propio PMTiles —16 teselas, z10 a z13, cuatro
    // puntos de la ciudad— y no aparece en ninguna. Las dos capas que la
    // filtraban se veían perfectas en el código y no dibujaban jamás, que es la
    // peor combinación posible. Esta prueba existe para que no vuelvan por
    // simetría con el esquema.
    const estilo = construirEstiloBase({ tema, ...URLS });
    expect(JSON.stringify(estilo.layers)).not.toContain('medium_road');
  });
});

// =============================================================================
// Contraste y separación — medidos, no estimados
// =============================================================================
// Las dos reglas de acá se rompen editando un hex, sin que nada falle y sin que
// se note hasta tener el mapa delante. Por eso van como número y no como
// criterio: son las que el QA visual de la Vía B encontró rotas.

/** Luminancia relativa WCAG de un `#rrggbb`. */
function luminancia(hex: string): number {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Lab D65, para medir cuánto se separan dos superficies contiguas. */
function lab(hex: string): [number, number, number] {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [canal(1), canal(3), canal(5)];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function deltaE(a: string, b: string): number {
  const [A, B] = [lab(a), lab(b)];
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

/** Aplana un `#rrggbbaa` sobre un fondo opaco, con un multiplicador de opacidad. */
function sobre(color8: string, fondo: string, multiplicador = 1): string {
  const alfa = (parseInt(color8.slice(7, 9), 16) / 255) * multiplicador;
  const canal = (i: number) => {
    const f = parseInt(color8.slice(i, i + 2), 16);
    const b = parseInt(fondo.slice(i, i + 2), 16);
    return Math.round(b + alfa * (f - b))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${canal(1)}${canal(3)}${canal(5)}`;
}

describe('contraste y separación del mapa', () => {
  it.each(TEMAS)('el anillo del corte cumple el mínimo WCAG de 3:1 sobre la tierra (%s)', (tema) => {
    // WCAG 1.4.11 (objetos gráficos). El anillo ámbar del `--warning` del sistema
    // daba 2.17:1 en claro: se perdía exactamente sobre el fondo que más ocupa la
    // pantalla, así que la marca de «no alcanza al corte» era invisible.
    const p = paletaDe(tema);
    expect(contraste(p.datos.anilloCorte, p.basemap.tierra)).toBeGreaterThanOrEqual(3);
  });

  it.each(TEMAS)('el anillo del corte no se confunde con el rojo de incidencia (%s)', (tema) => {
    // Corolario de la regla 4. Oscurecer el ámbar para ganar contraste lo empuja
    // hacia el rojo, y un anillo rojizo sobre un punto sano diría «acá pasa algo»
    // justo donde no pasa nada.
    const p = paletaDe(tema);
    expect(deltaE(p.datos.anilloCorte, p.datos.puntoIncidencia)).toBeGreaterThan(20);
  });

  it.each(TEMAS)('los cuatro pasos de la rampa se distinguen entre sí (%s)', (tema) => {
    const p = paletaDe(tema);
    const pasos = p.datos.cargaComuna.map((c) => sobre(c, p.basemap.tierra));
    for (let i = 1; i < pasos.length; i++) {
      expect(deltaE(pasos[i], pasos[i - 1])).toBeGreaterThan(6);
    }
  });

  it.each(TEMAS)('la rampa sigue distinguiéndose atenuada dentro de una comuna (%s)', (tema) => {
    // Dentro de una comuna el relleno baja al 45 %, y ahí la rampa original caía
    // a ΔE 2.6 entre sus dos primeros pasos — bajo el umbral en que el ojo separa
    // dos superficies contiguas. Cuatro pasos declarados, tres a la vista.
    const p = paletaDe(tema);
    const pasos = p.datos.cargaComuna.map((c) => sobre(c, p.basemap.tierra, 0.45));
    for (let i = 1; i < pasos.length; i++) {
      expect(deltaE(pasos[i], pasos[i - 1])).toBeGreaterThan(3);
    }
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
