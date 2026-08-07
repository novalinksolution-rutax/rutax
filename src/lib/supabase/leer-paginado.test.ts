import { describe, expect, it } from 'vitest';
import { leerTodasLasFilas } from './leer-paginado';

/**
 * El tope de `max_rows` de PostgREST es silencioso: no hay error que capturar,
 * solo filas que faltan. Estas pruebas ejercen el helper con un "servidor" que
 * se comporta exactamente así.
 */
function servidorConFilas(total: number, tamano: number) {
  const llamadas: [number, number][] = [];
  const filas = Array.from({ length: total }, (_, i) => ({ id: i }));

  return {
    llamadas,
    consultar(desde: number, hasta: number) {
      llamadas.push([desde, hasta]);
      // PostgREST recorta a `max_rows` aunque el rango pedido sea mayor.
      const pagina = filas.slice(desde, desde + tamano);
      return Promise.resolve({ data: pagina, error: null });
    },
  };
}

describe('leerTodasLasFilas', () => {
  it('trae todas las filas cuando hay más que una página', async () => {
    const servidor = servidorConFilas(2500, 1000);
    const filas = await leerTodasLasFilas('prueba', servidor.consultar, { tamanoPagina: 1000 });

    expect(filas).toHaveLength(2500);
    expect(servidor.llamadas).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('para en la primera página incompleta y no pide una de más', async () => {
    const servidor = servidorConFilas(120, 1000);
    const filas = await leerTodasLasFilas('prueba', servidor.consultar, { tamanoPagina: 1000 });

    expect(filas).toHaveLength(120);
    expect(servidor.llamadas).toHaveLength(1);
  });

  it('un múltiplo exacto del tamaño de página cuesta una llamada extra, y esa es la que confirma que no hay más', async () => {
    const servidor = servidorConFilas(1000, 1000);
    const filas = await leerTodasLasFilas('prueba', servidor.consultar, { tamanoPagina: 1000 });

    expect(filas).toHaveLength(1000);
    expect(servidor.llamadas).toHaveLength(2);
  });

  it('devuelve vacío sin reventar cuando no hay nada', async () => {
    const servidor = servidorConFilas(0, 1000);
    expect(await leerTodasLasFilas('prueba', servidor.consultar)).toEqual([]);
  });

  it('propaga el error de la consulta con la etiqueta, no lo traga', async () => {
    await expect(
      leerTodasLasFilas('clima_horario', () =>
        Promise.resolve({ data: null, error: { message: 'column no existe' } }),
      ),
    ).rejects.toThrow(/clima_horario.*column no existe/);
  });

  it('corta con un error claro al superar el tope: un filtro mal puesto no descarga sin fin', async () => {
    const servidor = servidorConFilas(10_000, 100);
    await expect(
      leerTodasLasFilas('prueba', servidor.consultar, { tamanoPagina: 100, tope: 250 }),
    ).rejects.toThrow(/superó el tope de 250 filas/);
  });
});
