/**
 * Candado de regresión — retiro del rastreo de ubicación del conductor (2026-08-14).
 * =============================================================================
 * `docs/seguridad/punto-de-termino-conductor.md` §1 encontró que
 * `operacion.ubicacion_conductor` se alimentaba cada 90 s desde la PWA del
 * conductor sin que ninguna pantalla la leyera, sin purga y sin límite de
 * tiempo — la última posición del día sobrevivía indefinidamente y muchas
 * veces era el domicilio del conductor. Decisión del usuario (2026-08-14):
 * cortar la recolección entera, no solo mitigarla.
 *
 * Lo que se retiró: el componente `ping-ubicacion.tsx`, las Server Actions
 * `actionPingUbicacion`/`actionBorrarUbicacion`/
 * `actionRegistrarConsentimientoUbicacion`/`actionRevocarConsentimientoUbicacion`,
 * y el módulo entero `ubicacion-conductor.ts`
 * (`actualizarUbicacionConductor`/`borrarUbicacionAlCerrarRuta`). La tabla, su
 * RLS y el módulo `consentimiento-ubicacion.ts` (mecanismo, sin interfaz que
 * lo invoque) se CONSERVAN a propósito — ver los avisos en ese módulo y en
 * `migrations/20260814000002_operacion_retirar_rastreo_ubicacion.sql`.
 *
 * Esta prueba fija lo único que de verdad importa para que esto no vuelva por
 * descuido: analiza estáticamente TODO el código fuente de la aplicación (no
 * las migraciones, no los tests, no la documentación) y confirma que ningún
 * archivo llama a `.from("ubicacion_conductor")` — la única forma en que este
 * código toca esa tabla, sea para leerla o para escribirla. A propósito NO se
 * prohíbe el nombre desnudo de la tabla en todo el árbol: varios comentarios
 * "de lápida" (`consentimiento-ubicacion.ts`, `manifiestos.ts`,
 * `purgar-evidencias.ts`, `[pedidoId]/actions.ts`) la mencionan a propósito
 * para explicar qué se retiró y por qué — prohibir el nombre entero habría
 * bloqueado exactamente los comentarios que este cambio pidió escribir. Si
 * algún día una pantalla real vuelve a necesitar esta tabla (o la etapa 7 crea
 * su propio `punto_termino_conductor`, que es una tabla DISTINTA), esta
 * prueba fallará a propósito y quien la toque tendrá que leer este comentario
 * primero.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Raíz de `src/`: este archivo vive en src/modules/operacion/.
const DIR_OPERACION = dirname(fileURLToPath(import.meta.url));
const DIR_SRC = join(DIR_OPERACION, '..', '..');

// La única forma en que el código de aplicación toca la tabla es a través del
// cliente Supabase: `.from("ubicacion_conductor")` o `.from('ubicacion_conductor')`
// (nunca con `.schema(...)` delante — la tabla se expone vía la vista
// `public.ubicacion_conductor`, igual que el resto de tablas de `operacion`
// que el código de aplicación consulta). Cualquier SELECT/INSERT/UPDATE/DELETE
// pasa por aquí.
const PATRON_LLAMADA_A_LA_TABLA = /\.from\(\s*['"]ubicacion_conductor['"]\s*\)/;

/** Lista .ts/.tsx de `src/`, EXCLUYENDO pruebas — solo código que corre en producción. */
function listarArchivosFuente(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    const stat = statSync(ruta);
    if (stat.isDirectory()) {
      if (entrada === 'node_modules' || entrada === '.next') continue;
      salida.push(...listarArchivosFuente(ruta));
    } else if (/\.tsx?$/.test(entrada) && !/\.test\.tsx?$/.test(entrada)) {
      salida.push(ruta);
    }
  }
  return salida;
}

describe('rastreo de ubicación del conductor — retirado 2026-08-14', () => {
  it('sanidad del análisis: el escaneo encuentra archivos de sobra', () => {
    // Si esto falla, la ruta o el filtro se rompieron y la aserción principal
    // sería un falso verde (cero coincidencias porque no se escaneó nada).
    expect(listarArchivosFuente(DIR_SRC).length).toBeGreaterThan(100);
  });

  it('sanidad del patrón: SÍ detecta una llamada real a .from("ubicacion_conductor")', () => {
    // Evita el otro falso verde: que el regex esté mal escrito y nunca calce
    // con nada, dejando pasar cualquier reintroducción sin que la prueba de
    // abajo lo note.
    expect(PATRON_LLAMADA_A_LA_TABLA.test('await cliente.from("ubicacion_conductor").upsert(x)')).toBe(true);
    expect(PATRON_LLAMADA_A_LA_TABLA.test("cliente.from('ubicacion_conductor').delete()")).toBe(true);
    // Y NO debe calzar con una mención en prosa (comentario o docstring).
    expect(PATRON_LLAMADA_A_LA_TABLA.test('la tabla operacion.ubicacion_conductor se vació')).toBe(false);
  });

  it('ningún archivo de código de aplicación llama a .from("ubicacion_conductor")', () => {
    const archivos = listarArchivosFuente(DIR_SRC);
    const conLlamada = archivos.filter((archivo) =>
      PATRON_LLAMADA_A_LA_TABLA.test(readFileSync(archivo, 'utf8')),
    );

    expect(
      conLlamada,
      `Archivos que aún llaman a .from("ubicacion_conductor") (no debería quedar ` +
        `ninguno — ni para leerla ni para escribirla): ${conLlamada.join(', ')}`,
    ).toEqual([]);
  });

  it('el componente y el módulo que pingueaban la ubicación ya no existen', () => {
    expect(existsSync(join(DIR_SRC, 'app/conductor/manifiesto/ping-ubicacion.tsx'))).toBe(false);
    expect(existsSync(join(DIR_OPERACION, 'ubicacion-conductor.ts'))).toBe(false);
  });
});
