/**
 * Prueba de CONTRATO del catálogo de eventos Inngest.
 * =====================================================================
 * Cierra la brecha "evento definido pero nunca publicado" de la auditoría
 * (§2.6 / QW1) y evita que reaparezca. Analiza estáticamente el código y exige:
 *
 *   A. Todo evento CONSUMIDO por un job (`triggers: [{ event: '…' }]`) tiene al
 *      menos un PRODUCTOR (`inngest.send({ name: '…' })`) en el código. Un
 *      consumidor sin productor es un manejador muerto que nunca se dispara.
 *
 *   B. Todo evento DEFINIDO en `eventos.ts` (el catálogo tipado del motor
 *      entrega→dinero) tiene un PRODUCTOR real, o está declarado explícitamente
 *      como punto de extensión conocido. Sin flujos "documentados" que el
 *      sistema no ejecuta.
 *
 * Los nombres de evento tienen forma `namespace/segmento.punteado` en minúscula
 * (p. ej. `dinero/pago.recibido`); los `id:`/`name:` de las funciones son
 * camelCase o texto legible y NO calzan el patrón, así que no se confunden.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Raíz de `src/`: este archivo vive en src/lib/inngest/.
const DIR_INNGEST = dirname(fileURLToPath(import.meta.url));
const DIR_SRC = join(DIR_INNGEST, '..', '..');
const RUTA_EVENTOS = join(DIR_INNGEST, 'eventos.ts');

/**
 * Puntos de extensión conocidos: eventos definidos a propósito para una futura
 * ampliación. Mantener esta lista vacía o mínima — es una excepción
 * documentada, no un cajón de sastre.
 *
 * Motivo válido para estar aquí (ver el filtro de la prueba B más abajo): el
 * evento HOY sí se publica pero puede no tener consumidor todavía. NOTA F2
 * "Ola 3": `plataforma/cobro.fallido` y `plataforma/trial.por-vencer` YA
 * tienen productor Y consumidor real (`jobs/cobrar-periodo-auto.ts` /
 * `jobs/vigilar-trials.ts` como productores, `jobs/notificar-cobro-fallido.ts`
 * / `jobs/notificar-trial-por-vencer.ts` como consumidores) — se retiraron de
 * esta lista.
 */
const PUNTOS_EXTENSION_SIN_CONSUMIDOR = new Set<string>([
  // `dinero/pago.conciliado`: lo publica conciliar-pago.ts; el consumidor
  // (notificación al seller "tu cobro fue pagado") es trabajo futuro.
  'dinero/pago.conciliado',
]);

const PATRON_NOMBRE_EVENTO = /['"]([a-z]+\/[a-z0-9_.-]+)['"]/;
const REGEX_PRODUCTOR = /name:\s*['"]([a-z]+\/[a-z0-9_.-]+)['"]/g;
const REGEX_CONSUMIDOR = /event:\s*['"]([a-z]+\/[a-z0-9_.-]+)['"]/g;

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

function extraerConRegex(texto: string, regex: RegExp): string[] {
  const nombres: string[] = [];
  for (const m of texto.matchAll(regex)) nombres.push(m[1]);
  return nombres;
}

/** Nombres de evento definidos en el catálogo (`name: '…';` de cada interface). */
function eventosDefinidos(): Set<string> {
  const texto = readFileSync(RUTA_EVENTOS, 'utf8');
  const nombres = new Set<string>();
  for (const linea of texto.split('\n')) {
    const m = linea.match(/^\s*name:\s*['"]([a-z]+\/[a-z0-9_.-]+)['"];?\s*$/);
    if (m) nombres.add(m[1]);
  }
  return nombres;
}

const archivos = listarArchivosFuente(DIR_SRC);
const productores = new Set<string>();
const consumidores = new Set<string>();

for (const archivo of archivos) {
  const texto = readFileSync(archivo, 'utf8');
  // El catálogo (eventos.ts) declara nombres con `name:` pero NO es productor.
  if (archivo !== RUTA_EVENTOS) {
    for (const n of extraerConRegex(texto, REGEX_PRODUCTOR)) productores.add(n);
  }
  for (const n of extraerConRegex(texto, REGEX_CONSUMIDOR)) consumidores.add(n);
}

describe('contrato de eventos Inngest', () => {
  it('descubre productores y consumidores en el código (sanidad del análisis)', () => {
    // Si esto queda vacío, el escaneo se rompió (ruta o regex) y las demás
    // aserciones serían falsos verdes.
    expect(productores.size).toBeGreaterThan(0);
    expect(consumidores.size).toBeGreaterThan(0);
    expect(PATRON_NOMBRE_EVENTO.test("name: 'dinero/pago.recibido'")).toBe(true);
  });

  it('A · todo evento consumido por un job tiene un productor (sin manejadores muertos)', () => {
    const consumidosSinProductor = [...consumidores].filter((e) => !productores.has(e));
    expect(
      consumidosSinProductor,
      `Eventos con consumidor pero sin productor (nunca se disparan): ${consumidosSinProductor.join(', ')}`,
    ).toEqual([]);
  });

  it('B · todo evento definido en el catálogo tiene productor o es extensión declarada', () => {
    const definidos = eventosDefinidos();
    const aspiracionales = [...definidos].filter(
      (e) => !productores.has(e) && !PUNTOS_EXTENSION_SIN_CONSUMIDOR.has(e),
    );
    expect(
      aspiracionales,
      `Eventos definidos sin productor real (retíralos o impleméntalos): ${aspiracionales.join(', ')}`,
    ).toEqual([]);
  });

  it('los eventos fantasma retirados ya no están en el catálogo', () => {
    const definidos = eventosDefinidos();
    expect(definidos.has('operacion/corte.proximo')).toBe(false);
    expect(definidos.has('dinero/conciliacion.tres_fuentes')).toBe(false);
  });
});
