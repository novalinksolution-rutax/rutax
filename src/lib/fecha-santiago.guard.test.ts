/**
 * Guard estático de fechas — barre TODO `src/`.
 *
 * Nació acotado a `src/modules/contexto/` (paso A4 de la Torre de control) y se
 * elevó al repo entero cuando la auditoría encontró el mismo bug fuera de ese
 * módulo: las métricas del día del dashboard del dueño se armaban con una
 * ventana en medianoche UTC, y el borde de mes de los períodos de cobro venía
 * con el offset `-03:00` clavado.
 *
 * Qué prohíbe y qué NO
 * --------------------
 * NO prohíbe `toISOString()`. Serializar un instante para escribirlo en una
 * columna `timestamptz` es exactamente lo correcto, y es lo que hace medio
 * repo al estampar `actualizado_en`. Un guard que prohíbe lo legítimo termina
 * con una excepción encima, y esa excepción es por donde después se cuela el
 * bug de verdad.
 *
 * Prohíbe los tres patrones que SÍ son bugs:
 *
 *  1. Derivar una FECHA CIVIL truncando un instante UTC. Desde las 20:00 de
 *     Santiago (21:00 en verano) UTC ya está en el día siguiente, así que
 *     "hoy" se convierte en mañana y la pantalla del día se vacía sola cada
 *     noche.
 *  2. Pegarle una hora UTC (`…Z`) a una fecha civil chilena para armar un
 *     rango de día. Corre la ventana 3–4 horas: entran las filas de la noche
 *     anterior y faltan las de la propia noche.
 *  3. Pegarle un offset NUMÉRICO clavado (`-03:00` / `-04:00`). Santiago es
 *     −04:00 en invierno y −03:00 en verano, así que un offset fijo está mal
 *     la mitad del año. Este patrón se agregó porque el guard original solo
 *     buscaba el sufijo `Z` y por ese hueco se coló `contexto/olas.ts`.
 *
 * La alternativa correcta siempre está en `src/lib/fecha-santiago.ts`:
 * `hoyEnSantiago`, `fechaLocalEnSantiago`, `limitesDelDiaSantiago`,
 * `combinarFechaHoraSantiago`, `sumarDiasCalendario`,
 * `diferenciaEnDiasCalendario`, `diaSemanaCalendario`.
 *
 * Los patrones se arman con `new RegExp` sobre trozos concatenados para que
 * este archivo no contenga los literales que busca — si no, el guard se delata
 * a sí mismo y se auto-reporta como infractor.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const DIR_SRC = dirname(dirname(fileURLToPath(import.meta.url))); // …/src

/**
 * Única exención, y es estructural: `fecha-santiago.ts` es el hogar legítimo
 * del truco `Date.UTC` + truncado. Ahí el patrón no es un bug, es la
 * implementación correcta de aritmética de fecha CIVIL — y está cubierto por
 * su propia batería de tests. Si esta lista crece, algo se hizo mal.
 */
const ARCHIVOS_EXENTOS = new Set(['lib/fecha-santiago.ts']);

const PATRONES_PROHIBIDOS: { motivo: string; regex: RegExp }[] = [
  {
    motivo: 'deriva una fecha civil truncando un instante UTC',
    regex: new RegExp('toISO' + 'String\\(\\)\\s*\\.\\s*(slice|split|substring)'),
  },
  {
    motivo: 'interpreta una fecha civil chilena como instante UTC',
    regex: new RegExp('`\\$\\{[^}]+\\}T(00:00:00|23:59:59)[.\\d]*Z`'),
  },
  {
    motivo:
      'construye un instante pegando el offset de Santiago clavado ' +
      '(es −04:00 en invierno y −03:00 en verano)',
    // Interpolación (`${fecha}T00:00:00-04:00`) o fragmento concatenado
    // ('T00:00:00-04:00'). Un literal ENTERO y fijo —los de la fixture— no
    // entra: ahí el offset no se está aplicando a una fecha variable, es el
    // nombre de un instante concreto y no puede estar mal por temporada.
    regex: new RegExp(
      '`[^`]*\\$\\{[^}]+\\}[^`]*T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?-0[34]:00' +
        "|['\"`]T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?-0[34]:00",
    ),
  },
];

function listarArchivosFuente(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    if (entrada === 'node_modules' || entrada === '.next') continue;
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      salida.push(...listarArchivosFuente(ruta));
    } else if (/\.tsx?$/.test(entrada)) {
      salida.push(ruta);
    }
  }
  return salida;
}

/** Ruta relativa a `src/`, con separadores POSIX (Windows escribe `\`). */
function rutaRelativa(ruta: string): string {
  return relative(DIR_SRC, ruta).split(sep).join('/');
}

describe('guard: ninguna fecha civil se deriva en UTC dentro de src/', () => {
  // Timeout explícito: este guard lee TODO `src/` de disco, así que su costo
  // crece con el repo y compite por I/O con los otros 158 archivos de la suite.
  // Aislado corre en ~2 s, pero dentro de `npm test` completo empezó a pasarse
  // de los 5 s por defecto y a fallar de forma intermitente — un rojo por
  // lentitud, no por un infractor. Subir el techo no relaja la comprobación:
  // sigue escaneando exactamente lo mismo.
  it('no hay infractores', () => {
    const infractores: string[] = [];

    for (const ruta of listarArchivosFuente(DIR_SRC)) {
      const rel = rutaRelativa(ruta);
      if (ARCHIVOS_EXENTOS.has(rel)) continue;

      const texto = readFileSync(ruta, 'utf8');
      for (const { motivo, regex } of PATRONES_PROHIBIDOS) {
        // Se ignoran las líneas de comentario: varios arreglos documentan el
        // patrón viejo para explicar por qué se cambió, y esa nota es
        // justamente lo que evita que alguien lo reintroduzca.
        const lineasMalas = texto
          .split('\n')
          .map((linea, i) => ({ linea: linea.trim(), n: i + 1 }))
          .filter(
            ({ linea }) =>
              !linea.startsWith('*') &&
              !linea.startsWith('//') &&
              !linea.startsWith('/*'),
          )
          .filter(({ linea }) => regex.test(linea));

        for (const { n } of lineasMalas) {
          infractores.push(`${rel}:${n} — ${motivo}`);
        }
      }
    }

    expect(
      infractores,
      'Este repo opera en America/Santiago: usa los helpers de ' +
        'src/lib/fecha-santiago.ts en vez de derivar fechas civiles en UTC. ' +
        `Infractores:\n  ${infractores.join('\n  ')}`,
    ).toEqual([]);
  }, 30_000);

  it('la exención se mantiene chica (si crece, hay deuda que pagar)', () => {
    expect(ARCHIVOS_EXENTOS.size).toBeLessThanOrEqual(1);
  });
});
